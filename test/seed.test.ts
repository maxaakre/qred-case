import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, seed } from '../scripts/seed.js';
import { createTestContext, NOW, type TestContext } from './context.js';
import { expectContract } from './contract.js';

/** The demo must show exactly what the app view shows. */
describe('demo seed', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
    await seed(ctx.pool, NOW);
  });
  afterAll(() => ctx.close());

  it('reproduces the app view for Anna', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/companies/${DEMO.companyAb}/card-overview`,
      headers: { authorization: `Bearer ${await ctx.token(DEMO.anna)}` },
    });

    const body = expectContract(res, 'getCardOverview');
    expect(body.company.name).toBe('Company AB');
    expect(body.spend).toMatchObject({ spent: { minor: 540_000 }, limit: { minor: 1_000_000 } });
    expect(body.latestTransactions.totalCount).toBe(57);
    expect(body.latestTransactions.items).toHaveLength(3);
    expect(body.invoiceDue).toMatchObject({ amount: { minor: 540_000 }, isOverdue: false });
  });

  it('gives Erik an inactive card to activate', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/v1/companies/${DEMO.companyAb}/card-overview`,
      headers: { authorization: `Bearer ${await ctx.token(DEMO.erik)}` },
    });

    const body = expectContract(res, 'getCardOverview');
    expect(body.card).toMatchObject({ status: 'INACTIVE', last4: null });
    expect(body.invoiceDue).toBeNull();
    expect(body.actions.canActivateCard).toBe(true);
  });
});
