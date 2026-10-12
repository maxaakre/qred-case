import type { Schemas } from '../api.js';
import { type Queryable, toSafeInteger } from '../db.js';
import type { Card, CardStatus } from '../domain/types.js';

export interface TransactionRow {
  id: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  status: Schemas['Transaction']['status'];
  occurredAt: Date;
}

/** Columns as pg returns them: bigint as a string. */
interface CardDbRow {
  id: string;
  last4: string;
  status: CardStatus;
  image_url: string;
  currency: string;
  spend_limit_minor: string;
  failed_activation_attempts: number;
}

interface TransactionDbRow {
  id: string;
  merchant: string;
  amount_minor: string;
  currency: string;
  status: TransactionRow['status'];
  occurred_at: Date;
}

// Every card query aliases the table as `c`, every transaction query as `t`.
const CARD_COLUMNS = 'c.id, c.last4, c.status, c.image_url, c.currency, c.spend_limit_minor, c.failed_activation_attempts';
const TRANSACTION_COLUMNS = 't.id, t.merchant, t.amount_minor, t.currency, t.status, t.occurred_at';

/** The card holder is still a member of the card's company. Removed members lose access at once (ADR 0006). */
const HOLDER_IS_MEMBER = `EXISTS (SELECT 1 FROM company_members m
                                   WHERE m.company_id = c.company_id AND m.user_id = c.holder_user_id)`;

/** A card the holder may activate: inactive and not locked. Same rule as `activationBlockedReason` (domain/card-rules.ts). */
const ACTIVATABLE = `c.id = $1 AND c.holder_user_id = $2
                     AND c.status = 'INACTIVE' AND c.failed_activation_attempts < $4
                     AND ${HOLDER_IS_MEMBER}`;

function cardFromRow(r: CardDbRow): Card {
  return {
    id: r.id,
    last4: r.last4,
    status: r.status,
    imageUrl: r.image_url,
    currency: r.currency,
    spendLimitMinor: toSafeInteger(r.spend_limit_minor),
    failedActivationAttempts: r.failed_activation_attempts,
  };
}

function transactionFromRow(r: TransactionDbRow): TransactionRow {
  return {
    id: r.id,
    merchant: r.merchant,
    amountMinor: toSafeInteger(r.amount_minor),
    currency: r.currency,
    status: r.status,
    occurredAt: r.occurred_at,
  };
}

export function cardsRepository(db: Queryable) {
  return {
    /**
     * The holder's most recently created card in the company that is not CLOSED.
     * A holder can have several open cards: a replacement is issued INACTIVE while the old
     * card still works. The newest is shown, so the app offers to activate the replacement.
     */
    async findCurrentCard(holderUserId: string, companyId: string): Promise<Card | null> {
      const { rows } = await db.query<CardDbRow>(
        `SELECT ${CARD_COLUMNS}
           FROM cards c
          WHERE c.holder_user_id = $1 AND c.company_id = $2 AND c.status <> 'CLOSED'
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 1`,
        [holderUserId, companyId],
      );
      return rows[0] ? cardFromRow(rows[0]) : null;
    },

    /**
     * A card the user holds, in a company they are still a member of. Any status:
     * a closed card's history stays visible. Null means "not found" to the caller (ADR 0005).
     */
    async findHeldCard(cardId: string, userId: string): Promise<Card | null> {
      const { rows } = await db.query<CardDbRow>(
        `SELECT ${CARD_COLUMNS} FROM cards c WHERE c.id = $1 AND c.holder_user_id = $2 AND ${HOLDER_IS_MEMBER}`,
        [cardId, userId],
      );
      return rows[0] ? cardFromRow(rows[0]) : null;
    },

    /**
     * Net purchases in [from, to): pending and settled count, declined do not. Negative amounts
     * are purchases. All amounts share the card's currency (enforced by a foreign key).
     */
    async netPurchases(cardId: string, from: Date, to: Date): Promise<number> {
      const { rows } = await db.query<{ net: string }>(
        `SELECT COALESCE(-SUM(t.amount_minor), 0) AS net
           FROM transactions t
          WHERE t.card_id = $1 AND t.status IN ('PENDING', 'SETTLED')
            AND t.occurred_at >= $2 AND t.occurred_at < $3`,
        [cardId, from, to],
      );
      return toSafeInteger(rows[0]!.net);
    },

    async countTransactions(cardId: string): Promise<number> {
      const { rows } = await db.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM transactions t WHERE t.card_id = $1',
        [cardId],
      );
      return toSafeInteger(rows[0]!.count);
    },

    /**
     * Newest first, strictly after the cursor transaction in (occurred_at, id) order.
     * Keyset pagination: rows arriving between pages never shift the next page.
     * Page 1 (afterId = null) is also the overview's "latest transactions".
     */
    async transactionsPage(cardId: string, limit: number, afterId: string | null): Promise<TransactionRow[]> {
      const { rows } = await db.query<TransactionDbRow>(
        `SELECT ${TRANSACTION_COLUMNS}
           FROM transactions t
          WHERE t.card_id = $1
            AND ($3::uuid IS NULL OR (t.occurred_at, t.id) <
                 (SELECT cur.occurred_at, cur.id FROM transactions cur WHERE cur.id = $3::uuid))
          ORDER BY t.occurred_at DESC, t.id DESC
          LIMIT $2`,
        [cardId, limit, afterId],
      );
      return rows.map(transactionFromRow);
    },

    /**
     * Whether a transaction belongs to the card. Kept as its own lookup so a cursor from
     * another card is a clear 400, not a silently empty page.
     */
    async hasTransaction(cardId: string, transactionId: string): Promise<boolean> {
      const { rowCount } = await db.query('SELECT 1 FROM transactions t WHERE t.id = $1 AND t.card_id = $2', [
        transactionId,
        cardId,
      ]);
      return rowCount === 1;
    },

    /**
     * Activates the card if the holder sent the right digits. One atomic statement:
     * Postgres re-checks the WHERE clause under the row lock, so concurrent requests
     * cannot both pass the attempt limit (ADR 0008).
     */
    async activateIfDigitsMatch(cardId: string, holderUserId: string, last4: string, maxAttempts: number) {
      const { rows } = await db.query<CardDbRow>(
        `UPDATE cards c SET status = 'ACTIVE', activated_at = now()
          WHERE ${ACTIVATABLE} AND c.last4 = $3
          RETURNING ${CARD_COLUMNS}`,
        [cardId, holderUserId, last4, maxAttempts],
      );
      return rows[0] ? cardFromRow(rows[0]) : null;
    },

    /** Counts a wrong attempt atomically and returns the new count, or null if the card is not activatable. */
    async recordFailedActivation(cardId: string, holderUserId: string, last4: string, maxAttempts: number) {
      const { rows } = await db.query<{ failed_activation_attempts: number }>(
        `UPDATE cards c SET failed_activation_attempts = c.failed_activation_attempts + 1,
                            last_failed_activation_at = now()
          WHERE ${ACTIVATABLE} AND c.last4 <> $3
          RETURNING c.failed_activation_attempts`,
        [cardId, holderUserId, last4, maxAttempts],
      );
      return rows[0]?.failed_activation_attempts ?? null;
    },
  };
}
