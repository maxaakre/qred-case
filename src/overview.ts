import type pg from 'pg';
import type { Config } from './config.js';
import { withSnapshot } from './db.js';
import { activationBlockedReason, spendSummary } from './domain/card-rules.js';
import { spendPeriodFor } from './domain/spend-period.js';
import type { components } from './generated/api.js';
import { notFound } from './problem.js';
import { type CardRow, cardsRepository, type TransactionRow } from './repositories/cards.js';
import { companiesRepository } from './repositories/companies.js';

type Schemas = components['schemas'];

const LATEST_TRANSACTIONS = 3;

const money = (minor: number, currency: string): Schemas['Money'] => ({ minor, currency });

function toCard(card: CardRow): Schemas['Card'] {
  return {
    id: card.id,
    // The digits are the activation proof, so they stay hidden until the card is active (ADR 0008).
    last4: card.status === 'INACTIVE' ? null : card.last4,
    status: card.status,
    imageUrl: card.imageUrl,
  };
}

export function toTransaction(tx: TransactionRow): Schemas['Transaction'] {
  return {
    id: tx.id,
    merchant: tx.merchant,
    amount: money(tx.amountMinor, tx.currency),
    status: tx.status,
    occurredAt: tx.occurredAt.toISOString(),
  };
}

/** Builds the card overview screen in one snapshot (ADR 0002, ADR 0007). */
export function cardOverviewService(pool: pg.Pool, config: Config, now: () => Date) {
  return {
    async get(userId: string, companyId: string): Promise<Schemas['CardOverview']> {
      return withSnapshot(pool, async (db) => {
        const membership = await companiesRepository(db).findMembership(userId, companyId);
        // Same answer for "does not exist" and "not yours" (ADR 0005).
        if (!membership) throw notFound('Company not found');

        const cards = cardsRepository(db);
        const card = await cards.findCurrentCard(userId, companyId);
        const reason = activationBlockedReason(card);
        const base = {
          company: membership.company,
          invoiceDue: null,
          actions: { canActivateCard: reason === null, activationBlockedReason: reason },
          support: config.support,
        };
        if (!card) return { ...base, card: null, spend: null, latestTransactions: null };

        const period = spendPeriodFor(now());
        const [net, latest, totalCount] = [
          await cards.netPurchases(card.id, period.startsAt, period.endsAt),
          await cards.latestTransactions(card.id, LATEST_TRANSACTIONS),
          await cards.countTransactions(card.id),
        ];
        const { spent, remaining } = spendSummary(net, card.spendLimitMinor);
        return {
          ...base,
          card: toCard(card),
          spend: {
            spent: money(spent, card.currency),
            limit: money(card.spendLimitMinor, card.currency),
            remaining: money(remaining, card.currency),
            periodStart: period.start,
            periodEnd: period.end,
          },
          latestTransactions: { items: latest.map(toTransaction), totalCount },
        };
      });
    },
  };
}
