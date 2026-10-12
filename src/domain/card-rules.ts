import type { CardRow } from '../repositories/cards.js';

/** Wrong last4 attempts allowed before activation locks (ADR 0008). */
export const MAX_ACTIVATION_ATTEMPTS = 5;

export type ActivationBlockedReason = 'NO_CARD' | 'NOT_INACTIVE' | 'LOCKED';

/** Why the user cannot activate the card, or null if they can. The app shows text based on this. */
export function activationBlockedReason(card: CardRow | null): ActivationBlockedReason | null {
  if (!card) return 'NO_CARD';
  if (card.status !== 'INACTIVE') return 'NOT_INACTIVE';
  if (card.failedActivationAttempts >= MAX_ACTIVATION_ATTEMPTS) return 'LOCKED';
  return null;
}

/** Remaining spend never goes below zero, and spent never goes below zero (see CONTEXT.md). */
export function spendSummary(netPurchasesMinor: number, spendLimitMinor: number) {
  const spent = Math.max(netPurchasesMinor, 0);
  return { spent, remaining: Math.max(spendLimitMinor - spent, 0) };
}
