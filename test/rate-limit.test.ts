import { describe, expect, it } from 'vitest';
import { useTestContext } from './context.js';

describe('rate limit on POST /v1/cards/{cardId}/activation', () => {
  const MAX = 3;
  const ctx = useTestContext({ activationRateLimit: { max: MAX, windowSeconds: 900 } });

  const inactiveCardHolder = () => ctx.fx.cardHolder();
  const activate = (userId: string, cardId: string, last4: string) => ctx.activate(userId, cardId, { last4 });

  it('returns 429 with Retry-After once a user has used up their attempts', async () => {
    const { user, card } = await inactiveCardHolder();
    for (let i = 0; i < MAX; i++) await activate(user, card, '0000');

    const res = await activate(user, card, '4821');

    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });
  });

  it('counts per user, so one user cannot block another', async () => {
    const first = await inactiveCardHolder();
    const second = await inactiveCardHolder();
    for (let i = 0; i <= MAX; i++) await activate(first.user, first.card, '0000');

    const res = await activate(second.user, second.card, '4821');

    expect(res.statusCode).toBe(200);
  });

  it('only limits activation, so the screen can be reloaded any number of times', async () => {
    const { user, company } = await inactiveCardHolder();
    const overview = () => ctx.overview(user, company);
    for (let i = 0; i < MAX; i++) await overview();

    const res = await overview();

    expect(res.statusCode).toBe(200);
  });

  it('does not count requests without a valid token', async () => {
    const { user, card } = await inactiveCardHolder();
    for (let i = 0; i <= MAX; i++) {
      const anonymous = await ctx.app.inject({ method: 'POST', url: `/v1/cards/${card}/activation`, payload: { last4: '0000' } });
      expect(anonymous.statusCode).toBe(401);
    }

    const res = await activate(user, card, '4821');

    expect(res.statusCode).toBe(200);
  });
});

describe('rate limit on reading', () => {
  const MAX = 2;
  const ctx = useTestContext({ readRateLimit: { max: MAX } });

  it('returns 429 once one user has made too many requests, and says how many are left before that', async () => {
    const user = await ctx.fx.user();
    const first = await ctx.get(user, '/v1/me/companies');
    await ctx.get(user, '/v1/me/companies');

    const res = await ctx.get(user, '/v1/me/companies');

    expect(first.headers['x-ratelimit-limit']).toBe(String(MAX));
    expect(first.headers['x-ratelimit-remaining']).toBe(String(MAX - 1));
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts per user', async () => {
    const busy = await ctx.fx.user();
    for (let i = 0; i <= MAX; i++) await ctx.get(busy, '/v1/me/companies');

    const res = await ctx.get(await ctx.fx.user(), '/v1/me/companies');

    expect(res.statusCode).toBe(200);
  });
});
