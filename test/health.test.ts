import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { createTestContext, NOW, testConfig, type TestContext } from './context.js';
import { checkEveryResponse, expectContract } from './contract.js';

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

  it('reports 503 when the database is unreachable', async () => {
    const deadPool = new pg.Pool({ connectionString: 'postgres://app:app@127.0.0.1:1/none', connectionTimeoutMillis: 500 });
    const app = await buildApp({ pool: deadPool, config: testConfig, now: () => NOW });
    checkEveryResponse(app);

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expectContract(res, 'getHealth');
    await app.close();
    await deadPool.end();
  });
});
