import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { useTestContext, testConfig } from './context.js';

/** Rules the database itself enforces, whatever code writes to it. */
describe('database constraints', () => {
  const ctx = useTestContext();

  it("refuses a transaction in another currency than the card's", async () => {
    const { user, company } = await ctx.fx.memberOf();
    const card = await ctx.fx.card({ holder: user, company });

    await expect(
      ctx.fx.transaction(card, { amount: -1000, occurredAt: '2026-10-05T12:00:00Z', currency: 'EUR' }),
    ).rejects.toThrow(/transactions_card_currency_fkey/);
  });
});

/** The app's database user (role `card_api`, migration 003) gets only what the app needs. */
describe("the app's database privileges", () => {
  let appDb: pg.Pool;
  beforeAll(() => {
    appDb = new pg.Pool({ connectionString: testConfig.databaseUrl });
  });
  afterAll(() => appDb.end());

  it.each([
    ['change the schema', 'DROP TABLE invoices'],
    ['delete data', 'DELETE FROM transactions'],
    ['create rows', "INSERT INTO users (email, name) VALUES ('x@example.com', 'X')"],
    ['raise a spend limit', 'UPDATE cards SET spend_limit_minor = 99999999'],
  ])('cannot %s', async (_name, sql) => {
    await expect(appDb.query(sql)).rejects.toThrow(/permission denied|must be owner/);
  });
});
