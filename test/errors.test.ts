import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/demo.js';
import { createTestContext, type TestContext } from './context.js';

/** Error responses say what is wrong, where, and in a form the app can use. */
describe('error responses', () => {
  let ctx: TestContext;
  let user: string;
  let card: string;
  beforeAll(async () => {
    ctx = await createTestContext();
    await ctx.fx.reset();
    const member = await ctx.fx.memberOf();
    user = member.user;
    card = await ctx.fx.card({ holder: user, company: member.company, status: 'INACTIVE', last4: '4821' });
  });
  afterAll(() => ctx.close());

  const activate = (payload: object) => ctx.post(user, `/v1/cards/${card}/activation`, payload);

  it.each([
    ['a missing field', {}, [{ in: 'body', field: 'last4', message: 'is required' }]],
    ['a field that is not allowed', { last4: '4821', pin: '1234' }, [{ in: 'body', field: 'pin', message: 'is not allowed' }]],
    ['a wrong format', { last4: '12a' }, [{ in: 'body', field: 'last4', message: 'must match ^[0-9]{4}$' }]],
  ])('names the field for %s', async (_name, payload, errors) => {
    const res = await activate(payload);

    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual(errors);
  });

  it('lists every problem at once, so the app can mark all fields in one go', async () => {
    const res = await activate({ pin: '1234' });

    expect(res.json().errors).toEqual([
      { in: 'body', field: 'last4', message: 'is required' },
      { in: 'body', field: 'pin', message: 'is not allowed' },
    ]);
    expect(res.json().detail).toBe('last4 is required; pin is not allowed');
  });

  it.each([
    ['a path id', `/v1/companies/not-a-uuid/card-overview`, { in: 'path', field: 'companyId', message: 'must be a uuid' }],
    ['a query limit', `/v1/cards/${DEMO.annaCard}/transactions?limit=500`, { in: 'query', field: 'limit', message: 'must be at most 100' }],
    ['a query type', `/v1/cards/${DEMO.annaCard}/transactions?limit=abc`, { in: 'query', field: 'limit', message: 'must be an integer' }],
  ])('names %s that is wrong', async (_name, url, error) => {
    const res = await ctx.get(user, url);

    expect(res.statusCode).toBe(400);
    expect(res.json().errors).toEqual([error]);
  });

  it('answers a method the route does not have with 405 and the allowed methods', async () => {
    const res = await ctx.app.inject({ method: 'DELETE', url: '/v1/me/companies' });

    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.json()).toMatchObject({ status: 405, title: 'Method Not Allowed' });
  });

  it('says which route was not found', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBe('No route GET /v1/nope');
  });
});

describe('when something unexpected fails', () => {
  it('answers a generic 500 without internals, and keeps serving the next requests', async () => {
    const { default: pg } = await import('pg');
    const { buildApp } = await import('../src/app.js');
    const { NOW, testConfig } = await import('./context.js');
    const { signDevToken } = await import('../src/dev-token.js');
    const deadPool = new pg.Pool({ connectionString: 'postgres://app:app@127.0.0.1:1/none', connectionTimeoutMillis: 300 });
    const app = await buildApp({ pool: deadPool, config: testConfig, now: () => NOW });
    const headers = { authorization: `Bearer ${await signDevToken(testConfig.jwt, DEMO.anna)}` };

    const first = await app.inject({ method: 'GET', url: '/v1/me/companies', headers });
    const second = await app.inject({ method: 'GET', url: '/v1/me/companies', headers });

    expect(first.statusCode).toBe(500);
    expect(first.json()).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500, instance: '/v1/me/companies' });
    expect(second.statusCode).toBe(500);
    await app.close();
    await deadPool.end();
  });
});
