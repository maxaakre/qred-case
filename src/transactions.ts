import type pg from 'pg';
import type { components } from './generated/api.js';
import { apiTransaction } from './mappers.js';
import { HttpProblem, notFound } from './problem.js';
import { cardsRepository } from './repositories/cards.js';
import { isUuid } from './uuid.js';

type Schemas = components['schemas'];

const invalidCursor = () => new HttpProblem(400, 'Bad Request', 'Invalid cursor');

// The cursor is opaque to clients so we can change what is inside without breaking them.
const encodeCursor = (transactionId: string) => Buffer.from(transactionId).toString('base64url');

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!isUuid(id)) throw invalidCursor();
  return id;
}

export function transactionsService(pool: pg.Pool) {
  const cards = cardsRepository(pool);
  return {
    async list(userId: string, cardId: string, limit: number, cursor?: string): Promise<Schemas['TransactionPage']> {
      if (!(await cards.findHeldCard(cardId, userId))) throw notFound('Card not found');

      const afterId = cursor === undefined ? null : decodeCursor(cursor);
      if (afterId && !(await cards.hasTransaction(cardId, afterId))) throw invalidCursor();

      // Fetch one extra row to know whether there is a next page without a COUNT.
      const rows = await cards.transactionsPage(cardId, limit + 1, afterId);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(apiTransaction),
        nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null,
      };
    },
  };
}
