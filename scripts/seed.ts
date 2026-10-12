import pg from 'pg';
import { spendPeriodFor } from '../src/domain/spend-period.js';
import { loadConfig } from '../src/config.js';
import { type Queryable, withTransaction } from '../src/db.js';
import { DEMO } from '../src/demo.js';
import { isMain } from './is-main.js';

const MERCHANTS = ['Clas Ohlson', 'Circle K', 'Bauhaus', 'SJ', 'Webhallen', 'Espresso House', 'Biltema', 'Postnord'];

/** Empties every table. Shared by the seed and the test fixtures. */
export async function truncateAll(db: Queryable) {
  await db.query('TRUNCATE users, companies, company_members, cards, transactions, invoices CASCADE');
}

/**
 * Demo data that reproduces the app view: "Company AB", "Remaining spend: 5 400/10 000 kr"
 * (4 600 kr spent this month), 57 transactions ("54 more items"), an invoice due, and a
 * second user with an inactive card to demo activation. Dates are relative to now, so the demo works any day.
 * Re-running replaces all data.
 */
export async function seed(pool: pg.Pool, now = new Date()) {
  const period = spendPeriodFor(now);
  await withTransaction(pool, async (client) => {
    await truncateAll(client);

    await client.query(
      `INSERT INTO users (id, email, name) VALUES
         ($1, 'anna@company-ab.se', 'Anna Andersson'),
         ($2, 'erik@company-ab.se', 'Erik Eriksson')`,
      [DEMO.anna, DEMO.erik],
    );
    await client.query(
      `INSERT INTO companies (id, name, org_number) VALUES
         ($1, 'Company AB', '556000-0001'),
         ($2, 'Bygg Norr AB', '556000-0002')`,
      [DEMO.companyAb, DEMO.byggNorr],
    );
    await client.query(
      `INSERT INTO company_members (user_id, company_id, role) VALUES
         ($1, $3, 'OWNER'), ($1, $4, 'ADMIN'), ($2, $3, 'EMPLOYEE')`,
      [DEMO.anna, DEMO.erik, DEMO.companyAb, DEMO.byggNorr],
    );
    await client.query(
      `INSERT INTO cards (id, company_id, holder_user_id, last4, status, image_url,
                          credit_limit_minor, spend_limit_minor, activated_at) VALUES
         ($1, $3, $4, '4821', 'ACTIVE',   'https://cdn.example.com/cards/black.png', 5000000, 1000000, now() - interval '90 days'),
         ($2, $3, $5, '7310', 'INACTIVE', 'https://cdn.example.com/cards/black.png', 2000000,  500000, NULL)`,
      [DEMO.annaCard, DEMO.erikCard, DEMO.companyAb, DEMO.anna, DEMO.erik],
    );

    // This month: purchases and a refund netting exactly 4 600 kr (5 400 kr remaining), plus a declined one that must not count.
    const thisMonth: [amount: number, status: string][] = [
      [-120000, 'SETTLED'], [-89900, 'SETTLED'], [-45000, 'SETTLED'], [-70000, 'SETTLED'],
      [-64900, 'SETTLED'], [25000, 'SETTLED'], [-95200, 'PENDING'], [-300000, 'DECLINED'],
    ];
    const elapsed = Math.max(now.getTime() - period.startsAt.getTime(), 60_000);
    const rows: [number, string, Date][] = thisMonth.map(([amount, status], i) => [
      amount,
      status,
      new Date(period.startsAt.getTime() + (elapsed * (i + 1)) / (thisMonth.length + 1)),
    ]);
    // Earlier months: the rest of the 57 transactions.
    for (let i = 0; i < 57 - thisMonth.length; i++) {
      rows.push([-(5000 + ((i * 7919) % 200000)), 'SETTLED', new Date(period.startsAt.getTime() - (i + 1) * 36 * 3600_000)]);
    }
    for (const [i, [amount, status, at]] of rows.entries()) {
      await client.query(
        `INSERT INTO transactions (card_id, amount_minor, currency, merchant, status, occurred_at)
         VALUES ($1, $2, 'SEK', $3, $4, $5)`,
        [DEMO.annaCard, amount, MERCHANTS[i % MERCHANTS.length], status, at],
      );
    }

    await client.query(
      `INSERT INTO invoices (company_id, amount_minor, currency, due_date, status) VALUES
         ($1, 412300, 'SEK', $2, 'PAID'),
         ($1, 387500, 'SEK', $3, 'UNPAID')`,
      [DEMO.companyAb, period.start, period.end],
    );
  });
}

if (isMain(import.meta.url)) {
  const pool = new pg.Pool({ connectionString: loadConfig().databaseUrl });
  await seed(pool);
  await pool.end();
  console.log('Seeded demo data. Get a token from POST /demo/token on /docs, or with: npm run token -- anna');
}
