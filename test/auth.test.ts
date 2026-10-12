import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('authentication', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  const listCompanies = (authorization?: string) =>
    ctx.app.inject({
      method: 'GET',
      url: '/v1/me/companies',
      headers: authorization ? { authorization } : {},
    });

  it('rejects a request without a token', async () => {
    const res = await listCompanies();

    expect(res.statusCode).toBe(401);
    expect(expectContract(res, 'listMyCompanies')).toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('rejects a token signed with another secret', async () => {
    const res = await listCompanies(`Bearer ${await ctx.tokenSignedWith('not-the-secret-not-the-secret-123', 'u')}`);

    expect(res.statusCode).toBe(401);
    expectContract(res, 'listMyCompanies');
  });

  it('rejects an expired token', async () => {
    const res = await listCompanies(`Bearer ${await ctx.token('u', { expiresIn: '-1m' })}`);

    expect(res.statusCode).toBe(401);
    expectContract(res, 'listMyCompanies');
  });

  it('rejects a valid token whose subject is not a user id', async () => {
    const res = await listCompanies(`Bearer ${await ctx.token('not-a-uuid')}`);

    expect(res.statusCode).toBe(401);
    expectContract(res, 'listMyCompanies');
  });
});
