import type { Schemas } from '../api.js';

/** The domain's types. Repositories map rows to these; the rules never see a table. */

export type CardStatus = Schemas['CardStatus'];

export interface Card {
  id: string;
  last4: string;
  status: CardStatus;
  imageUrl: string;
  currency: string;
  spendLimitMinor: number;
  failedActivationAttempts: number;
}

/** What a member may see in a company (CONTEXT.md). Only owners and admins see invoices. */
export type Role = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

export type ActivationBlockedReason = NonNullable<Schemas['Actions']['activationBlockedReason']>;
