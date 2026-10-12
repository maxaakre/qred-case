import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('GET /v1/me/companies', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(() => ctx.fx.reset());
  afterAll(() => ctx.close());

  const listCompanies = (userId: string) => ctx.get(userId, '/v1/me/companies');

  it("lists only the user's companies, sorted by name", async () => {
    const user = await ctx.fx.user();
    const zeta = await ctx.fx.company('Zeta AB');
    const alfa = await ctx.fx.company('Alfa AB');
    const someoneElses = await ctx.fx.company('Other AB');
    await ctx.fx.member(user, zeta, 'EMPLOYEE');
    await ctx.fx.member(user, alfa, 'OWNER');
    await ctx.fx.member(await ctx.fx.user(), someoneElses);

    const res = await listCompanies(user);

    expect(res.statusCode).toBe(200);
    expect(expectContract(res, 'listMyCompanies')).toEqual({
      items: [
        { id: alfa, name: 'Alfa AB' },
        { id: zeta, name: 'Zeta AB' },
      ],
    });
  });

  it('returns an empty list for a user with no companies', async () => {
    const res = await listCompanies(await ctx.fx.user());

    expect(res.statusCode).toBe(200);
    expect(expectContract(res, 'listMyCompanies')).toEqual({ items: [] });
  });
});
