import type { components } from './generated/api.js';
import type { CardRow, TransactionRow } from './repositories/cards.js';
import type { InvoiceRow } from './repositories/invoices.js';

/** Database rows to API shapes. The only place that decides what the app sees of a row. */
type Schemas = components['schemas'];

export const money = (minor: number, currency: string): Schemas['Money'] => ({ minor, currency });

export function apiCard(card: CardRow): Schemas['Card'] {
  return {
    id: card.id,
    // The digits are the activation proof, so they stay hidden until the card is active (ADR 0008).
    last4: card.status === 'INACTIVE' ? null : card.last4,
    status: card.status,
    imageUrl: card.imageUrl,
  };
}

export function apiTransaction(tx: TransactionRow): Schemas['Transaction'] {
  return {
    id: tx.id,
    merchant: tx.merchant,
    amount: money(tx.amountMinor, tx.currency),
    status: tx.status,
    occurredAt: tx.occurredAt.toISOString(),
  };
}

/** `today` is the Swedish calendar date. Due on the due date, overdue the day after. */
export function apiInvoiceDue(invoice: InvoiceRow, today: string): Schemas['InvoiceDue'] {
  return {
    id: invoice.id,
    amount: money(invoice.amountMinor, invoice.currency),
    dueDate: invoice.dueDate,
    // ISO dates compare correctly as strings.
    isOverdue: invoice.dueDate < today,
  };
}
