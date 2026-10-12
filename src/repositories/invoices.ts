import { type Queryable, toSafeInteger } from '../db.js';
import type { Invoice } from '../domain/types.js';

/** Columns as pg returns them: bigint as a string, DATE as 'YYYY-MM-DD' (db.ts). */
interface InvoiceDbRow {
  id: string;
  amount_minor: string;
  currency: string;
  due_date: string;
}

export function invoicesRepository(db: Queryable) {
  return {
    /** The company's unpaid invoice with the earliest due date. Uses the partial index on unpaid invoices. */
    async oldestUnpaid(companyId: string): Promise<Invoice | null> {
      const { rows } = await db.query<InvoiceDbRow>(
        `SELECT id, amount_minor, currency, due_date
           FROM invoices
          WHERE company_id = $1 AND status = 'UNPAID'
          ORDER BY due_date, id
          LIMIT 1`,
        [companyId],
      );
      const r = rows[0];
      return r ? { id: r.id, amountMinor: toSafeInteger(r.amount_minor), currency: r.currency, dueDate: r.due_date } : null;
    },
  };
}
