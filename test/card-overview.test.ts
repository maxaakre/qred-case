import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Role } from '../src/domain/types.js';
import { testConfig, useTestContext } from './context.js';

describe('GET /v1/companies/{companyId}/card-overview', () => {
  const ctx = useTestContext();

  const getOverview = (userId: string, companyId: string) =>
    ctx.overview(userId, companyId);
  const member = (role: Role = 'EMPLOYEE') => ctx.fx.memberOf(role);

  describe('access', () => {
    it('returns 404 for a company the user is not a member of', async () => {
      const user = await ctx.fx.user();
      const otherCompany = await ctx.fx.company();

      const res = await getOverview(user, otherCompany);

      expect(res.statusCode).toBe(404);
    });

    it('returns the same 404 for a company that does not exist', async () => {
      const res = await getOverview(await ctx.fx.user(), randomUUID());

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for a company id that is not a uuid', async () => {
      const res = await getOverview(await ctx.fx.user(), 'abc');

      expect(res.statusCode).toBe(400);
    });
  });

  describe('member without a card', () => {
    it('returns an empty state instead of an error', async () => {
      const { user, company } = await member();

      const res = await getOverview(user, company);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        company: { id: company, name: 'Company AB' },
        card: null,
        invoiceDue: null,
        spend: null,
        latestTransactions: null,
        actions: { canActivateCard: false, activationBlockedReason: 'NO_CARD' },
        support: testConfig.support,
      });
    });
  });

  describe('member whose only card is closed', () => {
    it('returns the same empty state as a member without a card', async () => {
      const { user, company } = await member();
      await ctx.fx.card({ holder: user, company, status: 'CLOSED' });

      const res = await getOverview(user, company);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        company: { id: company, name: 'Company AB' },
        card: null,
        invoiceDue: null,
        spend: null,
        latestTransactions: null,
        actions: { canActivateCard: false, activationBlockedReason: 'NO_CARD' },
        support: testConfig.support,
      });
    });
  });

  describe('card', () => {
    it("shows the user's active card with spend and an empty transaction list", async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, status: 'ACTIVE', last4: '4821', spendLimit: 1_000_000 });

      const res = await getOverview(user, company);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        card: { id: card, last4: '4821', status: 'ACTIVE', imageUrl: `https://cdn.example.com/cards/${card}.png` },
        spend: {
          spent: { minor: 0, currency: 'SEK' },
          limit: { minor: 1_000_000, currency: 'SEK' },
          remaining: { minor: 1_000_000, currency: 'SEK' },
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
        },
        latestTransactions: { cardId: card, items: [], totalCount: 0 },
        actions: { canActivateCard: false, activationBlockedReason: 'NOT_INACTIVE' },
      });
    });

    it('hides last4 and offers activation while the card is inactive', async () => {
      const { user, company } = await member();
      await ctx.fx.card({ holder: user, company, status: 'INACTIVE', last4: '4821' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toMatchObject({ status: 'INACTIVE', last4: null });
      expect(body.actions).toEqual({ canActivateCard: true, activationBlockedReason: null });
    });

    it('tells the app activation is locked after 5 wrong attempts', async () => {
      const { user, company } = await member();
      await ctx.fx.card({ holder: user, company, status: 'INACTIVE', failedActivationAttempts: 5 });

      const body = (await getOverview(user, company)).json();

      expect(body.actions).toEqual({ canActivateCard: false, activationBlockedReason: 'LOCKED' });
    });

    it('shows a frozen card so the user understands why it does not work', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, status: 'FROZEN' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toMatchObject({ id: card, status: 'FROZEN' });
      expect(body.actions).toEqual({ canActivateCard: false, activationBlockedReason: 'NOT_INACTIVE' });
      expect(body.spend).toMatchObject({ spent: { minor: 0 }, limit: { minor: 1_000_000 }, remaining: { minor: 1_000_000 } });
    });

    it('shows the newest card that is not closed', async () => {
      const { user, company } = await member();
      const older = await ctx.fx.card({ holder: user, company, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z' });
      await ctx.fx.card({ holder: user, company, status: 'CLOSED', createdAt: '2026-06-01T00:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toMatchObject({ id: older });
    });

    it('offers to activate a replacement card, but shows the spend of the card still in use', async () => {
      const { user, company } = await member();
      const old = await ctx.fx.card({ holder: user, company, status: 'ACTIVE', spendLimit: 1_000_000, createdAt: '2026-01-01T00:00:00Z' });
      const replacement = await ctx.fx.card({ holder: user, company, status: 'INACTIVE', spendLimit: 1_000_000, createdAt: '2026-09-01T00:00:00Z' });
      await ctx.fx.transaction(old, { amount: -250_000, occurredAt: '2026-10-05T12:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toMatchObject({ id: replacement, status: 'INACTIVE', last4: null });
      expect(body.actions).toEqual({ canActivateCard: true, activationBlockedReason: null });
      expect(body.spend).toMatchObject({ spent: { minor: 250_000 }, remaining: { minor: 750_000 } });
      expect(body.latestTransactions).toMatchObject({ cardId: old, totalCount: 1 });
    });

    it('shows the spend of a frozen old card while its replacement waits for activation', async () => {
      const { user, company } = await member();
      const old = await ctx.fx.card({ holder: user, company, status: 'FROZEN', createdAt: '2026-01-01T00:00:00Z' });
      const replacement = await ctx.fx.card({ holder: user, company, status: 'INACTIVE', createdAt: '2026-09-01T00:00:00Z' });
      await ctx.fx.transaction(old, { amount: -250_000, occurredAt: '2026-10-05T12:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toMatchObject({ id: replacement, status: 'INACTIVE' });
      expect(body.spend).toMatchObject({ spent: { minor: 250_000 } });
      expect(body.latestTransactions).toMatchObject({ cardId: old, totalCount: 1 });
    });

    it('shows the new card on its own once the old one is closed', async () => {
      const { user, company } = await member();
      const old = await ctx.fx.card({ holder: user, company, status: 'CLOSED', createdAt: '2026-01-01T00:00:00Z' });
      const replacement = await ctx.fx.card({ holder: user, company, status: 'INACTIVE', createdAt: '2026-09-01T00:00:00Z' });
      await ctx.fx.transaction(old, { amount: -250_000, occurredAt: '2026-10-05T12:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.spend).toMatchObject({ spent: { minor: 0 } });
      expect(body.latestTransactions).toEqual({ cardId: replacement, items: [], totalCount: 0 });
    });

    it('only shows a card from the company asked for', async () => {
      const { user, company: a } = await member();
      const b = await ctx.fx.company('Other AB');
      await ctx.fx.member(user, b);
      const card = await ctx.fx.card({ holder: user, company: b });
      await ctx.fx.transaction(card, { amount: -100_000, occurredAt: '2026-10-05T09:00:00Z' });

      const inA = (await getOverview(user, a)).json();
      const inB = (await getOverview(user, b)).json();

      expect(inA).toMatchObject({
        card: null,
        spend: null,
        latestTransactions: null,
        actions: { canActivateCard: false, activationBlockedReason: 'NO_CARD' },
      });
      expect(inB.card).toMatchObject({ id: card });
      expect(inB.latestTransactions.totalCount).toBe(1);
    });

    it("never shows a colleague's card", async () => {
      const { user, company } = await member();
      const colleague = await ctx.fx.user();
      await ctx.fx.member(colleague, company);
      await ctx.fx.card({ holder: colleague, company });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toBeNull();
    });
  });

  describe('spend', () => {
    it('counts pending and settled purchases this month, minus refunds, ignoring declined', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, spendLimit: 1_000_000 });
      await ctx.fx.transaction(card, { amount: -300_000, occurredAt: '2026-10-02T09:00:00Z', status: 'SETTLED' });
      await ctx.fx.transaction(card, { amount: -210_000, occurredAt: '2026-10-10T09:00:00Z', status: 'PENDING' });
      await ctx.fx.transaction(card, { amount: 50_000, occurredAt: '2026-10-11T09:00:00Z', status: 'SETTLED' });
      await ctx.fx.transaction(card, { amount: -999_000, occurredAt: '2026-10-11T10:00:00Z', status: 'DECLINED' });
      await ctx.fx.transaction(card, { amount: -400_000, occurredAt: '2026-09-30T21:59:00Z' }); // 23:59 Sep 30 in Stockholm

      const body = (await getOverview(user, company)).json();

      // 3 000 + 2 100 - 500 = 4 600 kr spent, so 5 400 of 10 000 kr remaining: the numbers in the app view.
      expect(body.spend).toMatchObject({
        spent: { minor: 460_000, currency: 'SEK' },
        limit: { minor: 1_000_000, currency: 'SEK' },
        remaining: { minor: 540_000, currency: 'SEK' },
      });
    });

    it('counts a purchase at 00:30 on the 1st in Stockholm as this month', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, spendLimit: 1_000_000 });
      await ctx.fx.transaction(card, { amount: -100_000, occurredAt: '2026-09-30T22:30:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.spend.spent.minor).toBe(100_000);
    });

    it('counts a purchase at the exact start of the month, and not one at the exact start of the next', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, spendLimit: 1_000_000 });
      await ctx.fx.transaction(card, { amount: -100_000, occurredAt: '2026-09-30T22:00:00Z' }); // 00:00 Oct 1 in Stockholm
      await ctx.fx.transaction(card, { amount: -20_000, occurredAt: '2026-10-31T23:00:00Z' }); // 00:00 Nov 1 in Stockholm

      const body = (await getOverview(user, company)).json();

      expect(body.spend.spent.minor).toBe(100_000);
    });

    it('never shows remaining below zero when spent is over the limit', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, spendLimit: 100_000 });
      await ctx.fx.transaction(card, { amount: -150_000, occurredAt: '2026-10-05T09:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.spend).toMatchObject({ spent: { minor: 150_000 }, remaining: { minor: 0 } });
    });

    it('does not let a refund for last month push spent below zero', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company, spendLimit: 1_000_000 });
      await ctx.fx.transaction(card, { amount: -50_000, occurredAt: '2026-10-05T09:00:00Z' });
      await ctx.fx.transaction(card, { amount: 200_000, occurredAt: '2026-10-06T09:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.spend).toMatchObject({ spent: { minor: 0 }, remaining: { minor: 1_000_000 } });
    });
  });

  describe('latest transactions', () => {
    it('returns the 3 newest and the total count, so the app can say "N more"', async () => {
      const { user, company } = await member();
      const card = await ctx.fx.card({ holder: user, company });
      for (let day = 1; day <= 57; day++) {
        const date = new Date(Date.UTC(2026, 7, 1 + day, 12)).toISOString();
        await ctx.fx.transaction(card, { amount: -day * 100, occurredAt: date, merchant: `Shop ${day}` });
      }

      const body = (await getOverview(user, company)).json();

      expect(body.latestTransactions.totalCount).toBe(57);
      expect(body.latestTransactions.items.map((t: { merchant: string }) => t.merchant)).toEqual([
        'Shop 57', 'Shop 56', 'Shop 55',
      ]);
      expect(body.latestTransactions.items[0]).toMatchObject({
        amount: { minor: -5_700, currency: 'SEK' },
        status: 'SETTLED',
        occurredAt: '2026-09-27T12:00:00.000Z',
      });
    });
  });

  describe('invoice due', () => {
    it('shows the oldest unpaid invoice to an owner', async () => {
      const { user, company } = await member('OWNER');
      await ctx.fx.invoice(company, { amount: 100_000, dueDate: '2026-09-30', status: 'PAID' });
      const oldestUnpaid = await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-30' });
      await ctx.fx.invoice(company, { amount: 70_000, dueDate: '2026-11-30' });

      const body = (await getOverview(user, company)).json();

      expect(body.invoiceDue).toEqual({
        id: oldestUnpaid,
        amount: { minor: 540_000, currency: 'SEK' },
        dueDate: '2026-10-30',
        isOverdue: false,
      });
    });

    it('shows the invoice to an admin', async () => {
      const { user, company } = await member('ADMIN');
      const invoice = await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-30' });

      const body = (await getOverview(user, company)).json();

      expect(body.invoiceDue).toEqual({
        id: invoice,
        amount: { minor: 540_000, currency: 'SEK' },
        dueDate: '2026-10-30',
        isOverdue: false,
      });
    });

    it("never shows another company's invoice, even an older one", async () => {
      const { user, company: a } = await member('OWNER');
      const b = await ctx.fx.company('Other AB');
      await ctx.fx.member(user, b, 'OWNER');
      await ctx.fx.invoice(b, { amount: 70_000, dueDate: '2026-09-01' });
      const own = await ctx.fx.invoice(a, { amount: 540_000, dueDate: '2026-10-30' });

      const body = (await getOverview(user, a)).json();

      expect(body.invoiceDue).toMatchObject({ id: own });
    });

    it('shows no invoice when only another company has one', async () => {
      const { user, company: a } = await member('OWNER');
      const b = await ctx.fx.company('Other AB');
      await ctx.fx.member(user, b, 'OWNER');
      await ctx.fx.invoice(b, { amount: 70_000, dueDate: '2026-09-01' });

      const body = (await getOverview(user, a)).json();

      expect(body.invoiceDue).toBeNull();
    });

    it('hides the invoice from an employee', async () => {
      const { user, company } = await member('EMPLOYEE');
      await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-30' });

      const body = (await getOverview(user, company)).json();

      expect(body.invoiceDue).toBeNull();
    });

    it('marks the invoice overdue once the due date has passed in Swedish time', async () => {
      const { user, company } = await member('OWNER');
      await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-11' }); // "now" is Oct 12

      const body = (await getOverview(user, company)).json();

      expect(body.invoiceDue).toMatchObject({ dueDate: '2026-10-11', isOverdue: true });
    });

    it('is not overdue on the due date itself', async () => {
      const { user, company } = await member('OWNER');
      await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-12' });

      const body = (await getOverview(user, company)).json();

      expect(body.invoiceDue).toMatchObject({ isOverdue: false });
    });

    it('shows the invoice even when the owner has no card of their own', async () => {
      const { user, company } = await member('OWNER');
      await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-30' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toBeNull();
      expect(body.invoiceDue).toMatchObject({ amount: { minor: 540_000 } });
    });
  });
});

describe('card overview just after midnight in Sweden', () => {
  // 22:30 UTC on Oct 12 is 00:30 on Oct 13 in Stockholm.
  const ctx = useTestContext({}, { now: new Date('2026-10-12T22:30:00Z') });

  it('marks an invoice due Oct 12 overdue, though it is still Oct 12 in UTC', async () => {
    const { user, company } = await ctx.fx.memberOf('OWNER');
    await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-12' });

    const body = (await ctx.overview(user, company)).json();

    expect(body.invoiceDue).toMatchObject({ dueDate: '2026-10-12', isOverdue: true });
  });
});
