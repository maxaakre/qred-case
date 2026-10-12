import type pg from 'pg';
import type { Schemas } from './api.js';
import type { Config } from './config.js';
import { withSnapshot } from './db.js';
import { activationBlockedReason, canSeeInvoices, spendSummary } from './domain/card-rules.js';
import { spendPeriodFor, swedishDate } from './domain/spend-period.js';
import { apiCard, apiInvoiceDue, apiTransaction, money } from './mappers.js';
import { notFound } from './problem.js';
import { cardsRepository } from './repositories/cards.js';
import { companiesRepository } from './repositories/companies.js';
import { invoicesRepository } from './repositories/invoices.js';

const LATEST_TRANSACTIONS = 3;

/** Builds the card overview screen in one snapshot (ADR 0002, ADR 0007). */
export function cardOverviewService(pool: pg.Pool, config: Config, clock: () => Date) {
  return {
    async get(userId: string, companyId: string): Promise<Schemas['CardOverview']> {
      const now = clock(); // one instant for the whole screen
      return withSnapshot(pool, async (db) => {
        const membership = await companiesRepository(db).findMembership(userId, companyId);
        // Same answer for "does not exist" and "not yours" (ADR 0005).
        if (!membership) throw notFound('Company not found');

        const invoice = canSeeInvoices(membership.role) ? await invoicesRepository(db).oldestUnpaid(companyId) : null;
        const cards = cardsRepository(db);
        const card = await cards.findCurrentCard(userId, companyId);
        const reason = activationBlockedReason(card);
        const base = {
          company: membership.company,
          invoiceDue: invoice && apiInvoiceDue(invoice, swedishDate(now)),
          actions: { canActivateCard: reason === null, activationBlockedReason: reason },
          support: config.support,
        };
        if (!card) return { ...base, card: null, spend: null, latestTransactions: null };

        // A replacement waiting for activation has no purchases yet: show the spend of the
        // card still in use, so the screen does not claim the whole limit is left.
        const spending = (card.status === 'INACTIVE' && (await cards.findCardInUse(userId, companyId))) || card;

        // Sequential on purpose: one client runs one query at a time inside the snapshot.
        const period = spendPeriodFor(now);
        const net = await cards.netPurchases(spending.id, period.startsAt, period.endsAt);
        const latest = await cards.transactionsPage(spending.id, LATEST_TRANSACTIONS, null);
        const totalCount = await cards.countTransactions(spending.id);

        const { spent, remaining } = spendSummary(net, spending.spendLimitMinor);
        return {
          ...base,
          card: apiCard(card),
          spend: {
            spent: money(spent, spending.currency),
            limit: money(spending.spendLimitMinor, spending.currency),
            remaining: money(remaining, spending.currency),
            periodStart: period.start,
            periodEnd: period.end,
          },
          latestTransactions: { cardId: spending.id, items: latest.map(apiTransaction), totalCount },
        };
      });
    },
  };
}
