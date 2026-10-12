import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('GET /health', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('reports ok when the database is reachable', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(expectContract(res, 'getHealth')).toEqual({ status: 'ok' });
  });
});
