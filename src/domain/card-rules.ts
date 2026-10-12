import type { ActivationBlockedReason, Card, Role } from './types.js';

/** Wrong last4 attempts allowed before activation locks (ADR 0008). */
export const MAX_ACTIVATION_ATTEMPTS = 5;

/**
 * Why the user cannot activate the card, or null if they can. The app shows text based on this.
 * The activation UPDATE repeats this rule in SQL (`ACTIVATABLE` in repositories/cards.ts) so it
 * stays atomic; change both together.
 */
export function activationBlockedReason(card: Card | null): ActivationBlockedReason | null {
  if (!card) return 'NO_CARD';
  if (card.status !== 'INACTIVE') return 'NOT_INACTIVE';
  if (card.failedActivationAttempts >= MAX_ACTIVATION_ATTEMPTS) return 'LOCKED';
  return null;
}

/** Only owners and admins see the company's invoices (CONTEXT.md, Role). */
export function canSeeInvoices(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** Remaining spend never goes below zero, and spent never goes below zero (see CONTEXT.md). */
export function spendSummary(netPurchasesMinor: number, spendLimitMinor: number) {
  const spent = Math.max(netPurchasesMinor, 0);
  return { spent, remaining: Math.max(spendLimitMinor - spent, 0) };
}
