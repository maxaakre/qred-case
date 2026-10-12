import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('rate limit on POST /v1/cards/{cardId}/activation', () => {
  const MAX = 3;
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ activationRateLimit: { max: MAX, windowSeconds: 900 } });
  });
  beforeEach(() => ctx.fx.reset());
  afterAll(() => ctx.close());

  async function inactiveCardHolder() {
    const { user, company } = await ctx.fx.memberOf();
    const card = await ctx.fx.card({ holder: user, company, status: 'INACTIVE', last4: '4821' });
    return { user, company, card };
  }
  const activate = (userId: string, cardId: string, last4: string) =>
    ctx.post(userId, `/v1/cards/${cardId}/activation`, { last4 });

  it('returns 429 with Retry-After once a user has used up their attempts', async () => {
    const { user, card } = await inactiveCardHolder();
    for (let i = 0; i < MAX; i++) await activate(user, card, '0000');

    const res = await activate(user, card, '4821');

    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(expectContract(res, 'activateCard')).toMatchObject({ status: 429, title: 'Too Many Requests' });
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
    const overview = () => ctx.get(user, `/v1/companies/${company}/card-overview`);
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
