import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/demo.js';
import { seed } from '../scripts/seed.js';
import { createTestContext, NOW, type TestContext } from './context.js';

/** The demo must show exactly what the app view shows. */
describe('demo seed', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
    await seed(ctx.pool, NOW);
  });
  afterAll(() => ctx.close());

  it('reproduces the app view for Anna', async () => {
    const res = await ctx.get(DEMO.anna, `/v1/companies/${DEMO.companyAb}/card-overview`);

    const body = res.json();
    expect(body.company.name).toBe('Company AB');
    // "Remaining spend: 5 400/10 000 kr" in the design.
    expect(body.spend).toMatchObject({ remaining: { minor: 540_000 }, limit: { minor: 1_000_000 }, spent: { minor: 460_000 } });
    expect(body.latestTransactions.totalCount).toBe(57);
    expect(body.latestTransactions.items).toHaveLength(3);
    expect(body.invoiceDue).toMatchObject({ amount: { minor: 387_500 }, isOverdue: false });
  });

  it('gives Erik an inactive card to activate', async () => {
    const res = await ctx.get(DEMO.erik, `/v1/companies/${DEMO.companyAb}/card-overview`);

    const body = res.json();
    expect(body.card).toMatchObject({ status: 'INACTIVE', last4: null });
    expect(body.invoiceDue).toBeNull();
    expect(body.actions.canActivateCard).toBe(true);
  });
});
