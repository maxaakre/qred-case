/**
 * The domain's types. Repositories map rows to these; the rules never see a table, and never
 * the API contract: mappers.ts translates to the contract and fails the build on drift.
 */

export type CardStatus = 'INACTIVE' | 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface Card {
  id: string;
  last4: string;
  status: CardStatus;
  imageUrl: string;
  currency: string;
  spendLimitMinor: number;
  failedActivationAttempts: number;
}

export type TransactionStatus = 'PENDING' | 'SETTLED' | 'DECLINED';

export interface Transaction {
  id: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  status: TransactionStatus;
  occurredAt: Date;
}

export interface Invoice {
  id: string;
  amountMinor: number;
  currency: string;
  /** Swedish calendar date, YYYY-MM-DD. */
  dueDate: string;
}

export interface Company {
  id: string;
  name: string;
}

/** What a member may see in a company (CONTEXT.md). */
export type Role = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

export interface Membership {
  company: Company;
  role: Role;
}

export type ActivationBlockedReason = 'NO_CARD' | 'NOT_INACTIVE' | 'LOCKED';
