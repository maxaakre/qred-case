import type pg from 'pg';
import type { Schemas } from './api.js';
import type { Config } from './config.js';
import { withSnapshot } from './db.js';
import { activationBlockedReason, spendSummary } from './domain/card-rules.js';
import { spendPeriodFor, swedishDate } from './domain/spend-period.js';
import type { Role } from './domain/types.js';
import { apiCard, apiInvoiceDue, apiTransaction, money } from './mappers.js';
import { notFound } from './problem.js';
import { cardsRepository } from './repositories/cards.js';
import { companiesRepository } from './repositories/companies.js';
import { invoicesRepository } from './repositories/invoices.js';

const LATEST_TRANSACTIONS = 3;

/** Roles that may see the company's invoices. */
const INVOICE_ROLES: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN']);

/** Builds the card overview screen in one snapshot (ADR 0002, ADR 0007). */
export function cardOverviewService(pool: pg.Pool, config: Config, clock: () => Date) {
  return {
    async get(userId: string, companyId: string): Promise<Schemas['CardOverview']> {
      const now = clock(); // one instant for the whole screen
      return withSnapshot(pool, async (db) => {
        const membership = await companiesRepository(db).findMembership(userId, companyId);
        // Same answer for "does not exist" and "not yours" (ADR 0005).
        if (!membership) throw notFound('Company not found');

        const invoice = INVOICE_ROLES.has(membership.role) ? await invoicesRepository(db).oldestUnpaid(companyId) : null;
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

        // Sequential on purpose: one client runs one query at a time inside the snapshot.
        const period = spendPeriodFor(now);
        const net = await cards.netPurchases(card.id, period.startsAt, period.endsAt);
        const latest = await cards.transactionsPage(card.id, LATEST_TRANSACTIONS, null);
        const totalCount = await cards.countTransactions(card.id);

        const { spent, remaining } = spendSummary(net, card.spendLimitMinor);
        return {
          ...base,
          card: apiCard(card),
          spend: {
            spent: money(spent, card.currency),
            limit: money(card.spendLimitMinor, card.currency),
            remaining: money(remaining, card.currency),
            periodStart: period.start,
            periodEnd: period.end,
          },
          latestTransactions: { items: latest.map(apiTransaction), totalCount },
        };
      });
    },
  };
}
