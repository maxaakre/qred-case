import type pg from 'pg';
import type { components } from '../generated/api.js';

type CompanySummary = components['schemas']['CompanySummary'];
export type Role = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

export function companiesRepository(pool: pg.Pool) {
  return {
    async listForUser(userId: string): Promise<CompanySummary[]> {
      const { rows } = await pool.query<CompanySummary>(
        `SELECT c.id, c.name
           FROM companies c
           JOIN company_members m ON m.company_id = c.id
          WHERE m.user_id = $1
          ORDER BY c.name, c.id`,
        [userId],
      );
      return rows;
    },
  };
}
