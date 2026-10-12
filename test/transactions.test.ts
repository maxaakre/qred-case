import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('GET /v1/cards/{cardId}/transactions', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(() => ctx.fx.reset());
  afterAll(() => ctx.close());

  const list = async (userId: string, cardId: string, query = '') =>
    ctx.app.inject({
      method: 'GET',
      url: `/v1/cards/${cardId}/transactions${query}`,
      headers: { authorization: `Bearer ${await ctx.token(userId)}` },
    });

  async function cardWithTransactions(count: number) {
    const user = await ctx.fx.user();
    const company = await ctx.fx.company();
    await ctx.fx.member(user, company);
    const card = await ctx.fx.card({ holder: user, company });
    for (let i = 1; i <= count; i++) {
      await ctx.fx.transaction(card, {
        amount: -100 * i,
        occurredAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
        merchant: `Shop ${i}`,
      });
    }
    return { user, company, card };
  }

  const merchants = (body: { items: { merchant: string }[] }) => body.items.map((t) => t.merchant);

  it('pages through all transactions newest first', async () => {
    const { user, card } = await cardWithTransactions(5);

    const page1 = expectContract(await list(user, card, '?limit=2'), 'listCardTransactions');
    const page2 = expectContract(await list(user, card, `?limit=2&cursor=${page1.nextCursor}`), 'listCardTransactions');
    const page3 = expectContract(await list(user, card, `?limit=2&cursor=${page2.nextCursor}`), 'listCardTransactions');

    expect(merchants(page1)).toEqual(['Shop 5', 'Shop 4']);
    expect(merchants(page2)).toEqual(['Shop 3', 'Shop 2']);
    expect(merchants(page3)).toEqual(['Shop 1']);
    expect(page3.nextCursor).toBeNull();
  });

  it('defaults to 20 per page', async () => {
    const { user, card } = await cardWithTransactions(21);

    const body = expectContract(await list(user, card), 'listCardTransactions');

    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();
  });

  it('does not repeat or skip rows when a new transaction arrives between pages', async () => {
    const { user, card } = await cardWithTransactions(4);
    const page1 = expectContract(await list(user, card, '?limit=2'), 'listCardTransactions');

    await ctx.fx.transaction(card, { amount: -1, occurredAt: '2026-10-11T12:00:00Z', merchant: 'New shop' });
    const page2 = expectContract(await list(user, card, `?limit=2&cursor=${page1.nextCursor}`), 'listCardTransactions');

    expect(merchants(page2)).toEqual(['Shop 2', 'Shop 1']);
  });

  it('keeps a stable order for transactions at the same instant', async () => {
    const { user, card } = await cardWithTransactions(0);
    for (let i = 0; i < 3; i++) {
      await ctx.fx.transaction(card, { amount: -1, occurredAt: '2026-10-05T12:00:00Z', merchant: `Same ${i}` });
    }

    const page1 = expectContract(await list(user, card, '?limit=2'), 'listCardTransactions');
    const page2 = expectContract(await list(user, card, `?limit=2&cursor=${page1.nextCursor}`), 'listCardTransactions');

    const all = [...merchants(page1), ...merchants(page2)];
    expect(new Set(all).size).toBe(3);
  });

  it("returns 404 for a colleague's card", async () => {
    const { company, card } = await cardWithTransactions(1);
    const colleague = await ctx.fx.user();
    await ctx.fx.member(colleague, company, 'OWNER');

    const res = await list(colleague, card);

    expect(res.statusCode).toBe(404);
    expectContract(res, 'listCardTransactions');
  });

  it('returns 404 for a card that does not exist', async () => {
    const res = await list(await ctx.fx.user(), randomUUID());

    expect(res.statusCode).toBe(404);
    expectContract(res, 'listCardTransactions');
  });

  it.each([
    ['a limit above 100', '?limit=101'],
    ['a limit of 0', '?limit=0'],
    ['a cursor that was never issued', '?cursor=bm90LWEtY3Vyc29y'],
  ])('returns 400 for %s', async (_name, query) => {
    const { user, card } = await cardWithTransactions(1);

    const res = await list(user, card, query);

    expect(res.statusCode).toBe(400);
    expectContract(res, 'listCardTransactions');
  });

  it("returns 400 for a cursor from another card's list", async () => {
    const a = await cardWithTransactions(3);
    const page = expectContract(await list(a.user, a.card, '?limit=1'), 'listCardTransactions');
    const otherCard = await ctx.fx.card({ holder: a.user, company: a.company });

    const res = await list(a.user, otherCard, `?cursor=${page.nextCursor}`);

    expect(res.statusCode).toBe(400);
    expectContract(res, 'listCardTransactions');
  });
});
