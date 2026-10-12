import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signDevToken } from '../src/dev-token.js';
import { useTestContext, testConfig } from './context.js';

describe('authentication', () => {
  const ctx = useTestContext({}, { reset: false });

  const listCompanies = (authorization?: string) =>
    ctx.app.inject({
      method: 'GET',
      url: '/v1/me/companies',
      headers: authorization ? { authorization } : {},
    });

  it('rejects a request without a token, and says to use a bearer token', async () => {
    const res = await listCompanies();

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.json()).toMatchObject({ status: 401, title: 'Unauthorized' });
  });

  it('accepts the scheme in any letter case, as HTTP allows', async () => {
    const res = await listCompanies(`bearer ${await ctx.token(randomUUID())}`);

    expect(res.statusCode).toBe(200);
  });

  it.each([
    ['signed with another secret', { secret: 'not-the-secret-not-the-secret-123' }],
    ['from another issuer', { issuer: 'someone-else' }],
    ['meant for another service', { audience: 'another-api' }],
  ])('rejects a token %s', async (_name, changes) => {
    const res = await listCompanies(`Bearer ${await ctx.tokenWith(changes, randomUUID())}`);

    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const user = randomUUID();
    const expired = await listCompanies(`Bearer ${await ctx.token(user, { expiresIn: '-1m' })}`);
    // Same user, not expired: proves the expiry is what fails.
    const valid = await listCompanies(`Bearer ${await ctx.token(user, { expiresIn: '1m' })}`);

    expect(expired.statusCode).toBe(401);
    expect(valid.statusCode).toBe(200);
  });

  it('rejects a valid token whose subject is not a user id', async () => {
    const res = await listCompanies(`Bearer ${await ctx.token('not-a-uuid')}`);

    expect(res.statusCode).toBe(401);
  });

  it('rejects a token issued more than an hour ago, even if it has not expired', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    const longLived = await signDevToken(testConfig.jwt, randomUUID(), '3h', { issuedAt: twoHoursAgo });

    const res = await listCompanies(`Bearer ${longLived}`);

    expect(res.statusCode).toBe(401);
  });

  it('rejects a token without an expiry, so no token is valid forever', async () => {
    const res = await listCompanies(`Bearer ${await ctx.tokenWithoutExpiry(randomUUID())}`);

    expect(res.statusCode).toBe(401);
  });
});

describe('every protected operation', () => {
  const ctx = useTestContext({}, { reset: false });

  const id = randomUUID();
  const operations: [string, 'GET' | 'POST', string, object?][] = [
    ['card overview', 'GET', `/v1/companies/${id}/card-overview`],
    ['transactions', 'GET', `/v1/cards/${id}/transactions`],
    ['activation', 'POST', `/v1/cards/${id}/activation`, { last4: '4821' }],
    ['companies', 'GET', '/v1/me/companies'],
  ];
  const cases = operations.flatMap(([name, method, url, payload]) => [
    [name, 'without a token', method, url, payload, undefined],
    [name, 'with a bad token', method, url, payload, 'Bearer not-a-jwt'],
  ] as const);

  it.each(cases)('%s: returns 401 %s', async (_name, _how, method, url, payload, authorization) => {
    const res = await ctx.app.inject({
      method,
      url,
      headers: authorization ? { authorization } : {},
      ...(payload && { payload }),
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });
});
