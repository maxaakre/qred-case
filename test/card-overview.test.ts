import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('GET /v1/companies/{companyId}/card-overview', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(() => ctx.fx.reset());
  afterAll(() => ctx.close());

  const getOverview = async (userId: string, companyId: string) =>
    ctx.app.inject({
      method: 'GET',
      url: `/v1/companies/${companyId}/card-overview`,
      headers: { authorization: `Bearer ${await ctx.token(userId)}` },
    });

  describe('access', () => {
    it('returns 404 for a company the user is not a member of', async () => {
      const user = await ctx.fx.user();
      const otherCompany = await ctx.fx.company();

      const res = await getOverview(user, otherCompany);

      expect(res.statusCode).toBe(404);
      expectContract(res, 'getCardOverview');
    });

    it('returns the same 404 for a company that does not exist', async () => {
      const res = await getOverview(await ctx.fx.user(), randomUUID());

      expect(res.statusCode).toBe(404);
      expectContract(res, 'getCardOverview');
    });

    it('returns 400 for a company id that is not a uuid', async () => {
      const res = await getOverview(await ctx.fx.user(), 'abc');

      expect(res.statusCode).toBe(400);
      expectContract(res, 'getCardOverview');
    });
  });
});
