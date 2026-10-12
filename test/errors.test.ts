import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/demo.js';
import { deadPool, useTestContext } from './context.js';

/** Error responses say what is wrong, where, and in a form the app can use. */
describe('error responses', () => {
  const ctx = useTestContext({}, { reset: false });
  let user: string;
  let card: string;
  beforeAll(async () => {
    await ctx.fx.reset();
    ({ user, card } = await ctx.fx.cardHolder());
  });

  const activate = (payload: object) => ctx.activate(user, card, payload);

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
    expect(res.headers.allow).toBe('GET');
    expect(res.json()).toMatchObject({ status: 405, title: 'Method Not Allowed' });
  });

  it('has no HEAD routes outside the contract', async () => {
    const res = await ctx.app.inject({ method: 'HEAD', url: '/v1/me/companies' });

    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('GET');
  });

  it('puts the path in `instance`, never the query, which can hold a cursor', async () => {
    const res = await ctx.get(user, `/v1/cards/${card}/transactions?cursor=bm90LWEtY3Vyc29y`);

    expect(res.statusCode).toBe(400);
    expect(res.json().instance).toBe(`/v1/cards/${card}/transactions`);
  });

  it('says which route was not found', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/nope' });

    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBe('No route GET /v1/nope');
  });
});

describe('when the database is down', () => {
  const ctx = useTestContext({}, { reset: false, appPool: deadPool() });

  it('answers 503 with Retry-After, so the app can offer "Try again"', async () => {
    const res = await ctx.get(DEMO.anna, '/v1/me/companies');

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.json()).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The service is temporarily unavailable',
      instance: '/v1/me/companies',
    });
  });
});

describe('when something unexpected fails', () => {
  // A bug, not an outage: a query that throws an ordinary error.
  const buggyPool = {
    query: async () => Promise.reject(new Error('column "x" does not exist')),
    end: async () => {},
  } as unknown as pg.Pool;
  const ctx = useTestContext({}, { reset: false, appPool: buggyPool });

  it('answers a generic 500 without internals, and keeps serving the next requests', async () => {
    const first = await ctx.get(DEMO.anna, '/v1/me/companies');
    const second = await ctx.get(DEMO.anna, '/v1/me/companies');

    expect(first.statusCode).toBe(500);
    expect(first.json()).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500, instance: '/v1/me/companies' });
    expect(second.statusCode).toBe(500);
  });
});
