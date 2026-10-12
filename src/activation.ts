import type pg from 'pg';
import { activationBlockedReason, MAX_ACTIVATION_ATTEMPTS } from './domain/card-rules.js';
import type { components } from './generated/api.js';
import { apiCard } from './mappers.js';
import { HttpProblem, notFound } from './problem.js';
import { cardsRepository } from './repositories/cards.js';

type Schemas = components['schemas'];

/** Card activation with last4 proof and lockout (ADR 0008). */
export function activationService(pool: pg.Pool) {
  const cards = cardsRepository(pool);
  return {
    async activate(userId: string, cardId: string, last4: string): Promise<Schemas['Card']> {
      const activated = await cards.activateIfDigitsMatch(cardId, userId, last4, MAX_ACTIVATION_ATTEMPTS);
      if (activated) return apiCard(activated);

      const failed = await cards.recordFailedActivation(cardId, userId, last4, MAX_ACTIVATION_ATTEMPTS);
      if (failed !== null) {
        throw new HttpProblem(422, 'Unprocessable Content', 'The digits do not match the card', {
          attemptsRemaining: MAX_ACTIVATION_ATTEMPTS - failed,
        });
      }

      // Neither update matched: work out why from the card's current state,
      // using the same rule the overview shows the app.
      const card = await cards.findHeldCard(cardId, userId);
      if (!card) throw notFound('Card not found');
      // Idempotent: a retry or double tap with the right digits.
      if (card.status === 'ACTIVE' && card.last4 === last4) return apiCard(card);
      switch (activationBlockedReason(card)) {
        case 'LOCKED':
          throw new HttpProblem(423, 'Locked', 'Too many wrong attempts. Contact support to unlock activation.');
        case 'NOT_INACTIVE':
          throw new HttpProblem(409, 'Conflict', `A ${card.status} card cannot be activated`);
        default:
          // The card changed between our statements (e.g. support unlocked it). Safe to retry.
          throw new HttpProblem(409, 'Conflict', 'The card changed during activation. Try again.');
      }
    },
  };
}
