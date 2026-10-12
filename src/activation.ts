import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import type { Schemas } from './api.js';
import { activationBlockedReason, MAX_ACTIVATION_ATTEMPTS } from './domain/card-rules.js';
import { apiCard } from './mappers.js';
import { HttpProblem, notFound, ProblemType } from './problem.js';
import { cardsRepository } from './repositories/cards.js';

/**
 * Card activation with last4 proof and lockout (ADR 0008). Every outcome is stored in
 * card_activation_events and logged, with the card and user, never the digits: support and
 * fraud monitoring need to see a lockout coming.
 */
export function activationService(pool: pg.Pool) {
  const cards = cardsRepository(pool);
  return {
    async activate(userId: string, cardId: string, last4: string, log: FastifyBaseLogger): Promise<Schemas['Card']> {
      const audit = { event: 'card_activation', cardId, userId };
      const activated = await cards.activateIfDigitsMatch(cardId, userId, last4, MAX_ACTIVATION_ATTEMPTS);
      if (activated) {
        log.info({ ...audit, outcome: 'activated' }, 'Card activated');
        return apiCard(activated);
      }

      const failed = await cards.recordFailedActivation(cardId, userId, last4, MAX_ACTIVATION_ATTEMPTS);
      if (failed !== null) {
        const attemptsRemaining = MAX_ACTIVATION_ATTEMPTS - failed;
        // The attempt that locks the card is a warning: someone may be guessing.
        log[attemptsRemaining === 0 ? 'warn' : 'info']({ ...audit, outcome: 'wrong_digits', attemptsRemaining }, 'Wrong activation digits');
        throw new HttpProblem(422, 'Unprocessable Content', 'The digits do not match the card', { attemptsRemaining }, ProblemType.wrongActivationDigits);
      }

      // Neither update matched: work out why from the card's current state,
      // using the same rule the overview shows the app.
      const card = await cards.findHeldCard(cardId, userId);
      if (!card) throw notFound('Card not found');
      // Idempotent: a retry or double tap with the right digits.
      if (card.status === 'ACTIVE' && card.last4 === last4) return apiCard(card);
      switch (activationBlockedReason(card)) {
        case 'LOCKED':
          await cards.recordLockedActivationAttempt(cardId, userId);
          log.warn({ ...audit, outcome: 'locked' }, 'Activation attempt on a locked card');
          throw new HttpProblem(423, 'Locked', 'Too many wrong attempts. Contact support to unlock activation.', {}, ProblemType.activationLocked);
        case 'NOT_INACTIVE':
          throw new HttpProblem(409, 'Conflict', `The card is ${card.status} and cannot be activated`, {}, ProblemType.cardNotActivatable);
        default:
          // The card changed between our statements (e.g. support unlocked it). Safe to retry.
          throw new HttpProblem(409, 'Conflict', 'The card changed during activation. Try again.', {}, ProblemType.cardChanged);
      }
    },
  };
}
