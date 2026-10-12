import type pg from 'pg';
import { MAX_ACTIVATION_ATTEMPTS } from './domain/card-rules.js';
import type { components } from './generated/api.js';
import { toCard } from './overview.js';
import { HttpProblem, notFound } from './problem.js';
import { cardsRepository } from './repositories/cards.js';

type Schemas = components['schemas'];

/** Card activation with last4 proof and lockout (ADR 0008). */
export function activationService(pool: pg.Pool) {
  const cards = cardsRepository(pool);
  return {
    async activate(userId: string, cardId: string, last4: string): Promise<Schemas['Card']> {
      const activated = await cards.activateIfDigitsMatch(cardId, userId, last4, MAX_ACTIVATION_ATTEMPTS);
      if (activated) return toCard(activated);

      const failed = await cards.recordFailedActivation(cardId, userId, last4, MAX_ACTIVATION_ATTEMPTS);
      if (failed !== null) {
        throw new HttpProblem(422, 'Unprocessable Content', 'The digits do not match the card', {
          attemptsRemaining: MAX_ACTIVATION_ATTEMPTS - failed,
        });
      }

      // Neither update matched: work out why from the card's current state.
      const card = await cards.findHeldCard(cardId, userId);
      if (!card) throw notFound('Card not found');
      if (card.status === 'ACTIVE') return toCard(card); // idempotent: a retry or double tap
      if (card.status !== 'INACTIVE') throw new HttpProblem(409, 'Conflict', `A ${card.status} card cannot be activated`);
      throw new HttpProblem(423, 'Locked', 'Too many wrong attempts. Contact support to unlock activation.');
    },
  };
}
