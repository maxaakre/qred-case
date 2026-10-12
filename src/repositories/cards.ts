import { type Queryable, toSafeInteger } from '../db.js';

export type CardStatus = 'INACTIVE' | 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface CardRow {
  id: string;
  last4: string;
  status: CardStatus;
  imageUrl: string;
  currency: string;
  spendLimitMinor: number;
  failedActivationAttempts: number;
}

export interface TransactionRow {
  id: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  status: 'PENDING' | 'SETTLED' | 'DECLINED';
  occurredAt: Date;
}

const CARD_COLUMNS = `id, last4, status, image_url, currency, spend_limit_minor, failed_activation_attempts`;

function toCard(r: Record<string, unknown>): CardRow {
  return {
    id: r.id as string,
    last4: r.last4 as string,
    status: r.status as CardStatus,
    imageUrl: r.image_url as string,
    currency: r.currency as string,
    spendLimitMinor: toSafeInteger(r.spend_limit_minor as string),
    failedActivationAttempts: r.failed_activation_attempts as number,
  };
}

function toTransactionRow(r: Record<string, unknown>): TransactionRow {
  return {
    id: r.id as string,
    merchant: r.merchant as string,
    amountMinor: toSafeInteger(r.amount_minor as string),
    currency: r.currency as string,
    status: r.status as TransactionRow['status'],
    occurredAt: r.occurred_at as Date,
  };
}

export function cardsRepository(db: Queryable) {
  return {
    /** The holder's most recently created card in the company that is not CLOSED. */
    async findCurrentCard(holderUserId: string, companyId: string): Promise<CardRow | null> {
      const { rows } = await db.query(
        `SELECT ${CARD_COLUMNS}
           FROM cards
          WHERE holder_user_id = $1 AND company_id = $2 AND status <> 'CLOSED'
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [holderUserId, companyId],
      );
      return rows[0] ? toCard(rows[0]) : null;
    },

    /** Net purchases in [from, to): pending and settled count, declined do not. Negative amounts are purchases. */
    async netPurchases(cardId: string, from: Date, to: Date): Promise<number> {
      const { rows } = await db.query<{ net: string }>(
        `SELECT COALESCE(-SUM(amount_minor), 0) AS net
           FROM transactions
          WHERE card_id = $1 AND status IN ('PENDING', 'SETTLED')
            AND occurred_at >= $2 AND occurred_at < $3`,
        [cardId, from, to],
      );
      return toSafeInteger(rows[0]!.net);
    },

    async latestTransactions(cardId: string, limit: number): Promise<TransactionRow[]> {
      const { rows } = await db.query(
        `SELECT id, merchant, amount_minor, currency, status, occurred_at
           FROM transactions
          WHERE card_id = $1
          ORDER BY occurred_at DESC, id DESC
          LIMIT $2`,
        [cardId, limit],
      );
      return rows.map(toTransactionRow);
    },

    /**
     * A card the user holds, in a company they are still a member of. Any status:
     * a closed card's history stays visible. Null means "not found" to the caller (ADR 0005).
     */
    async findHeldCard(cardId: string, userId: string): Promise<CardRow | null> {
      const { rows } = await db.query(
        `SELECT ${CARD_COLUMNS.split(', ').map((c) => `c.${c}`).join(', ')}
           FROM cards c
           JOIN company_members m ON m.company_id = c.company_id AND m.user_id = c.holder_user_id
          WHERE c.id = $1 AND c.holder_user_id = $2`,
        [cardId, userId],
      );
      return rows[0] ? toCard(rows[0]) : null;
    },

    /** Whether a transaction belongs to the card. Used to reject cursors from another card. */
    async hasTransaction(cardId: string, transactionId: string): Promise<boolean> {
      const { rowCount } = await db.query('SELECT 1 FROM transactions WHERE id = $1 AND card_id = $2', [
        transactionId, cardId,
      ]);
      return rowCount === 1;
    },

    /**
     * Newest first, strictly after the cursor transaction in (occurred_at, id) order.
     * Keyset pagination: rows arriving between pages never shift the next page.
     */
    async transactionsPage(cardId: string, limit: number, afterId: string | null): Promise<TransactionRow[]> {
      const { rows } = await db.query(
        `SELECT t.id, t.merchant, t.amount_minor, t.currency, t.status, t.occurred_at
           FROM transactions t
          WHERE t.card_id = $1
            AND ($3::uuid IS NULL OR (t.occurred_at, t.id) <
                 (SELECT c.occurred_at, c.id FROM transactions c WHERE c.id = $3::uuid))
          ORDER BY t.occurred_at DESC, t.id DESC
          LIMIT $2`,
        [cardId, limit, afterId],
      );
      return rows.map(toTransactionRow);
    },

    /**
     * Activates the card if the holder sent the right digits. One atomic statement:
     * Postgres re-checks the WHERE clause under the row lock, so concurrent requests
     * cannot both pass the attempt limit (ADR 0008).
     */
    async activateIfDigitsMatch(cardId: string, holderUserId: string, last4: string, maxAttempts: number) {
      const { rows } = await db.query(
        `UPDATE cards SET status = 'ACTIVE', activated_at = now()
          WHERE id = $1 AND holder_user_id = $2 AND last4 = $3
            AND status = 'INACTIVE' AND failed_activation_attempts < $4
            AND EXISTS (SELECT 1 FROM company_members m
                         WHERE m.company_id = cards.company_id AND m.user_id = cards.holder_user_id)
          RETURNING ${CARD_COLUMNS}`,
        [cardId, holderUserId, last4, maxAttempts],
      );
      return rows[0] ? toCard(rows[0]) : null;
    },

    /** Counts a wrong attempt atomically and returns the new count, or null if the card is not activatable. */
    async recordFailedActivation(cardId: string, holderUserId: string, last4: string, maxAttempts: number) {
      const { rows } = await db.query<{ failed_activation_attempts: number }>(
        `UPDATE cards SET failed_activation_attempts = failed_activation_attempts + 1
          WHERE id = $1 AND holder_user_id = $2 AND last4 <> $3
            AND status = 'INACTIVE' AND failed_activation_attempts < $4
            AND EXISTS (SELECT 1 FROM company_members m
                         WHERE m.company_id = cards.company_id AND m.user_id = cards.holder_user_id)
          RETURNING failed_activation_attempts`,
        [cardId, holderUserId, last4, maxAttempts],
      );
      return rows[0]?.failed_activation_attempts ?? null;
    },

    async countTransactions(cardId: string): Promise<number> {
      const { rows } = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM transactions WHERE card_id = $1', [
        cardId,
      ]);
      return toSafeInteger(rows[0]!.count);
    },
  };
}
