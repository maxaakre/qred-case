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
      await ctx.app.inject({ method: 'POST', url: `/v1/cards/${card}/activation`, payload: { last4: '0000' } });
    }

    const res = await activate(user, card, '4821');

    expect(res.statusCode).toBe(200);
  });
});
