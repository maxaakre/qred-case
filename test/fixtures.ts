import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { truncateAll } from '../scripts/seed.js';
import type { CardStatus, Role, TransactionStatus } from '../src/domain/types.js';

/** Inserts test data with sensible defaults. Every helper returns the new row's id. */
export function fixtures(pool: pg.Pool) {
  let seq = 0;
  const next = () => ++seq;

  return {
    reset: () => truncateAll(pool),

    async user(name = `User ${next()}`) {
      const id = randomUUID();
      await pool.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [id, `${id}@example.com`, name]);
      return id;
    },

    async company(name = `Company ${next()}`) {
      const id = randomUUID();
      await pool.query('INSERT INTO companies (id, name, org_number) VALUES ($1, $2, $3)', [id, name, id.slice(0, 11)]);
      return id;
    },

    async member(userId: string, companyId: string, role: Role = 'OWNER') {
      await pool.query('INSERT INTO company_members (user_id, company_id, role) VALUES ($1, $2, $3)', [
        userId, companyId, role,
      ]);
    },

    /** A new user who is a member of a new company with the given role. */
    async memberOf(role: Role = 'OWNER', companyName = 'Company AB') {
      const user = await this.user();
      const company = await this.company(companyName);
      await this.member(user, company, role);
      return { user, company };
    },

    async card(opts: {
      holder: string;
      company: string;
      status?: CardStatus;
      last4?: string;
      creditLimit?: number;
      spendLimit?: number;
      failedActivationAttempts?: number;
      createdAt?: string;
    }) {
      const id = randomUUID();
      const status = opts.status ?? 'ACTIVE';
      await pool.query(
        `INSERT INTO cards (id, company_id, holder_user_id, last4, status, image_url,
                            credit_limit_minor, spend_limit_minor, activated_at,
                            failed_activation_attempts, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id, opts.company, opts.holder, opts.last4 ?? '4821', status, `https://cdn.example.com/cards/${id}.png`,
          opts.creditLimit ?? 2_000_000, opts.spendLimit ?? 1_000_000,
          status === 'INACTIVE' ? null : '2026-09-01T10:00:00Z',
          opts.failedActivationAttempts ?? 0, opts.createdAt ?? new Date().toISOString(),
        ],
      );
      return id;
    },

    /** A member of a new company holding one card (INACTIVE, digits 4821, by default). */
    async cardHolder(opts: { status?: CardStatus; last4?: string; failedActivationAttempts?: number; role?: Role } = {}) {
      const { user, company } = await this.memberOf(opts.role);
      const card = await this.card({ holder: user, company, status: opts.status ?? 'INACTIVE', last4: opts.last4 ?? '4821',
        ...(opts.failedActivationAttempts !== undefined && { failedActivationAttempts: opts.failedActivationAttempts }) });
      return { user, company, card };
    },

    async transaction(cardId: string, opts: {
      amount: number;
      occurredAt: string;
      status?: TransactionStatus;
      merchant?: string;
      currency?: string;
    }) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO transactions (id, card_id, amount_minor, currency, merchant, status, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, cardId, opts.amount, opts.currency ?? 'SEK', opts.merchant ?? 'Merchant', opts.status ?? 'SETTLED', opts.occurredAt],
      );
      return id;
    },

    async invoice(companyId: string, opts: { amount: number; dueDate: string; status?: 'UNPAID' | 'PAID' }) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO invoices (id, company_id, amount_minor, currency, due_date, status) VALUES ($1, $2, $3, 'SEK', $4, $5)`,
        [id, companyId, opts.amount, opts.dueDate, opts.status ?? 'UNPAID'],
      );
      return id;
    },
  };
}

export type Fixtures = ReturnType<typeof fixtures>;
