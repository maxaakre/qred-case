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
        latestTransactions: { items: [], totalCount: 0 },
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
    });

    it('shows the newest card that is not closed', async () => {
      const { user, company } = await member();
      const older = await ctx.fx.card({ holder: user, company, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00Z' });
      await ctx.fx.card({ holder: user, company, status: 'CLOSED', createdAt: '2026-06-01T00:00:00Z' });

      const body = (await getOverview(user, company)).json();

      expect(body.card).toMatchObject({ id: older });
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
      await ctx.fx.invoice(company, { amount: 540_000, dueDate: '2026-10-30' });

      const body = (await getOverview(user, company)).json();

      expect(body.invoiceDue).not.toBeNull();
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
