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
      return rows.map((r) => ({
        id: r.id,
        merchant: r.merchant,
        amountMinor: toSafeInteger(r.amount_minor),
        currency: r.currency,
        status: r.status,
        occurredAt: r.occurred_at,
      }));
    },

    async countTransactions(cardId: string): Promise<number> {
      const { rows } = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM transactions WHERE card_id = $1', [
        cardId,
      ]);
      return toSafeInteger(rows[0]!.count);
    },
  };
}
