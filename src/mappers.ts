import type { Schemas } from './api.js';
import type { ActivationBlockedReason, Card, CardStatus, Company, Invoice, Transaction, TransactionStatus } from './domain/types.js';

/** Domain objects to API shapes. The only place that decides what the app sees. */

// The domain owns its enums; the build fails if they drift from the contract's.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const contractMatches: [
  Same<CardStatus, Schemas['CardStatus']>,
  Same<TransactionStatus, Schemas['Transaction']['status']>,
  Same<ActivationBlockedReason, NonNullable<Schemas['Actions']['activationBlockedReason']>>,
] = [true, true, true];
void contractMatches;

export const money = (minor: number, currency: string): Schemas['Money'] => ({ minor, currency });

export function apiCard(card: Card): Schemas['Card'] {
  return {
    id: card.id,
    // The digits are the activation proof, so they stay hidden until the card is active (ADR 0008).
    last4: card.status === 'INACTIVE' ? null : card.last4,
    status: card.status,
    imageUrl: card.imageUrl,
  };
}

export function apiTransaction(tx: Transaction): Schemas['Transaction'] {
  return {
    id: tx.id,
    merchant: tx.merchant,
    amount: money(tx.amountMinor, tx.currency),
    status: tx.status,
    occurredAt: tx.occurredAt.toISOString(),
  };
}

/** `today` is the Swedish calendar date. Due on the due date, overdue the day after. */
export function apiInvoiceDue(invoice: Invoice, today: string): Schemas['InvoiceDue'] {
  return {
    id: invoice.id,
    amount: money(invoice.amountMinor, invoice.currency),
    dueDate: invoice.dueDate,
    // ISO dates compare correctly as strings.
    isOverdue: invoice.dueDate < today,
  };
}

export function apiCompany(company: Company): Schemas['CompanySummary'] {
  return { id: company.id, name: company.name };
}
