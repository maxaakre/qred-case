import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';

/** Rules the database itself enforces, whatever code writes to it. */
describe('database constraints', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(() => ctx.fx.reset());
  afterAll(() => ctx.close());

  it("refuses a transaction in another currency than the card's", async () => {
    const user = await ctx.fx.user();
    const company = await ctx.fx.company();
    const card = await ctx.fx.card({ holder: user, company });

    await expect(
      ctx.fx.transaction(card, { amount: -1000, occurredAt: '2026-10-05T12:00:00Z', currency: 'EUR' }),
    ).rejects.toThrow(/transactions_card_currency_fkey/);
  });
});
