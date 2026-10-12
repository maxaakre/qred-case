import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** Inserts test data with sensible defaults. Every helper returns the new row's id. */
export function fixtures(pool: pg.Pool) {
  let seq = 0;
  const next = () => ++seq;

  return {
    async reset() {
      await pool.query('TRUNCATE users, companies, company_members, cards, transactions, invoices CASCADE');
    },

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

    async member(userId: string, companyId: string, role: 'OWNER' | 'ADMIN' | 'EMPLOYEE' = 'OWNER') {
      await pool.query('INSERT INTO company_members (user_id, company_id, role) VALUES ($1, $2, $3)', [
        userId, companyId, role,
      ]);
    },
  };
}

export type Fixtures = ReturnType<typeof fixtures>;
