import type { Queryable } from '../db.js';
import type { components } from '../generated/api.js';

type CompanySummary = components['schemas']['CompanySummary'];
export type Role = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

export function companiesRepository(pool: Queryable) {
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

    /** The user's membership in a company, or null. Membership is the access boundary (ADR 0006). */
    async findMembership(userId: string, companyId: string): Promise<{ company: CompanySummary; role: Role } | null> {
      const { rows } = await pool.query<{ id: string; name: string; role: Role }>(
        `SELECT c.id, c.name, m.role
           FROM companies c
           JOIN company_members m ON m.company_id = c.id
          WHERE m.user_id = $1 AND c.id = $2`,
        [userId, companyId],
      );
      const row = rows[0];
      return row ? { company: { id: row.id, name: row.name }, role: row.role } : null;
    },
  };
}
