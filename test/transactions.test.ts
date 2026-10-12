import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { useTestContext } from './context.js';

describe('GET /v1/cards/{cardId}/transactions', () => {
  const ctx = useTestContext();

  const list = (userId: string, cardId: string, query = '') => ctx.get(userId, `/v1/cards/${cardId}/transactions${query}`);

  async function cardWithTransactions(count: number) {
    const { user, company } = await ctx.fx.memberOf();
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

    const page1 = (await list(user, card, '?limit=2')).json();
    const page2 = (await list(user, card, `?limit=2&cursor=${page1.nextCursor}`)).json();
    const page3 = (await list(user, card, `?limit=2&cursor=${page2.nextCursor}`)).json();

    expect(merchants(page1)).toEqual(['Shop 5', 'Shop 4']);
    expect(merchants(page2)).toEqual(['Shop 3', 'Shop 2']);
    expect(merchants(page3)).toEqual(['Shop 1']);
    expect(page3.nextCursor).toBeNull();
  });

  it('ends with no cursor when the last page is exactly full', async () => {
    const { user, card } = await cardWithTransactions(4);

    const page1 = (await list(user, card, '?limit=2')).json();
    const page2 = (await list(user, card, `?limit=2&cursor=${page1.nextCursor}`)).json();

    expect(merchants(page2)).toEqual(['Shop 2', 'Shop 1']);
    expect(page2.nextCursor).toBeNull();
  });

  it('returns an empty page for a card with no transactions', async () => {
    const { user, card } = await cardWithTransactions(0);

    const res = await list(user, card);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('still lists the transactions of a closed card', async () => {
    const { user, company } = await ctx.fx.memberOf();
    const card = await ctx.fx.card({ holder: user, company, status: 'CLOSED' });
    await ctx.fx.transaction(card, { amount: -100, occurredAt: '2026-10-01T09:00:00Z', merchant: 'Old shop' });
    await ctx.fx.transaction(card, { amount: -200, occurredAt: '2026-10-02T09:00:00Z', merchant: 'Last shop' });

    const res = await list(user, card);

    expect(res.statusCode).toBe(200);
    expect(merchants(res.json())).toEqual(['Last shop', 'Old shop']);
  });

  it('defaults to 20 per page', async () => {
    const { user, card } = await cardWithTransactions(21);

    const body = (await list(user, card)).json();

    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();
  });

  it('does not repeat or skip rows when a new transaction arrives between pages', async () => {
    const { user, card } = await cardWithTransactions(4);
    const page1 = (await list(user, card, '?limit=2')).json();

    await ctx.fx.transaction(card, { amount: -1, occurredAt: '2026-10-11T12:00:00Z', merchant: 'New shop' });
    const page2 = (await list(user, card, `?limit=2&cursor=${page1.nextCursor}`)).json();

    expect(merchants(page2)).toEqual(['Shop 2', 'Shop 1']);
  });

  it('keeps a stable order for transactions at the same instant', async () => {
    const { user, card } = await cardWithTransactions(0);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await ctx.fx.transaction(card, { amount: -1, occurredAt: '2026-10-05T12:00:00Z', merchant: `Same ${i}` }));
    }

    const page1 = (await list(user, card, '?limit=2')).json();
    const page2 = (await list(user, card, `?limit=2&cursor=${page1.nextCursor}`)).json();
    const page1Again = (await list(user, card, '?limit=2')).json();

    const idsOf = (body: { items: { id: string }[] }) => body.items.map((t) => t.id);
    // Same instant: the id breaks the tie, highest first.
    expect([...idsOf(page1), ...idsOf(page2)]).toEqual([...ids].sort().reverse());
    expect(idsOf(page1Again)).toEqual(idsOf(page1));
  });

  it("returns 404 for a colleague's card", async () => {
    const { company, card } = await cardWithTransactions(1);
    const colleague = await ctx.fx.user();
    await ctx.fx.member(colleague, company, 'OWNER');

    const res = await list(colleague, card);

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 once the holder has left the company, even for their own card', async () => {
    const { user, company, card } = await cardWithTransactions(1);
    await ctx.pool.query('DELETE FROM company_members WHERE user_id = $1 AND company_id = $2', [user, company]);

    const res = await list(user, card);

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a card that does not exist', async () => {
    const res = await list(await ctx.fx.user(), randomUUID());

    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['a limit above 100', '?limit=101'],
    ['a limit of 0', '?limit=0'],
    ['a cursor that was never issued', '?cursor=bm90LWEtY3Vyc29y'],
  ])('returns 400 for %s', async (_name, query) => {
    const { user, card } = await cardWithTransactions(1);

    const res = await list(user, card, query);

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a cursor from another card's list", async () => {
    const a = await cardWithTransactions(3);
    const page = (await list(a.user, a.card, '?limit=1')).json();
    const otherCard = await ctx.fx.card({ holder: a.user, company: a.company });

    const res = await list(a.user, otherCard, `?cursor=${page.nextCursor}`);

    expect(res.statusCode).toBe(400);
    // Its own type, so the app knows to reload from the first page without reading `detail`.
    expect(res.json()).toMatchObject({
      type: '/problems/invalid-cursor',
      errors: [{ in: 'query', field: 'cursor', message: 'is invalid or expired' }],
    });
  });
});
