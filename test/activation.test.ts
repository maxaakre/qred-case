import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from './context.js';
import { expectContract } from './contract.js';

describe('POST /v1/cards/{cardId}/activation', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(() => ctx.fx.reset());
  afterAll(() => ctx.close());

  const activate = async (userId: string, cardId: string, payload: unknown) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/cards/${cardId}/activation`,
      headers: { authorization: `Bearer ${await ctx.token(userId)}` },
      payload: payload as object,
    });

  const overview = async (userId: string, companyId: string) =>
    expectContract(
      await ctx.app.inject({
        method: 'GET',
        url: `/v1/companies/${companyId}/card-overview`,
        headers: { authorization: `Bearer ${await ctx.token(userId)}` },
      }),
      'getCardOverview',
    );

  async function holderOf(status: 'INACTIVE' | 'ACTIVE' | 'FROZEN' | 'CLOSED' = 'INACTIVE', failedActivationAttempts = 0) {
    const user = await ctx.fx.user();
    const company = await ctx.fx.company();
    await ctx.fx.member(user, company);
    const card = await ctx.fx.card({ holder: user, company, status, last4: '4821', failedActivationAttempts });
    return { user, company, card };
  }

  it('activates the card when the last 4 digits match', async () => {
    const { user, company, card } = await holderOf('INACTIVE');

    const res = await activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(200);
    expect(expectContract(res, 'activateCard')).toMatchObject({ id: card, status: 'ACTIVE', last4: '4821' });
    expect((await overview(user, company)).actions).toEqual({
      canActivateCard: false,
      activationBlockedReason: 'NOT_INACTIVE',
    });
  });

  it('is idempotent: activating an active card again returns 200', async () => {
    const { user, card } = await holderOf('INACTIVE');
    await activate(user, card, { last4: '4821' });

    const res = await activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(200);
    expect(expectContract(res, 'activateCard')).toMatchObject({ status: 'ACTIVE' });
  });

  it('returns 409, not 200, for wrong digits on a card that is already active', async () => {
    const { user, card } = await holderOf('ACTIVE');

    const res = await activate(user, card, { last4: '0000' });

    expect(res.statusCode).toBe(409);
    expectContract(res, 'activateCard');
  });

  it.each(['FROZEN', 'CLOSED'] as const)('returns 409 for a %s card', async (status) => {
    const { user, card } = await holderOf(status);

    const res = await activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(409);
    expectContract(res, 'activateCard');
  });

  it('returns 422 with the attempts left when the digits are wrong', async () => {
    const { user, card } = await holderOf('INACTIVE');

    const res = await activate(user, card, { last4: '0000' });

    expect(res.statusCode).toBe(422);
    expect(expectContract(res, 'activateCard')).toMatchObject({ status: 422, attemptsRemaining: 4 });
  });

  it('locks activation after 5 wrong attempts, even for the right digits', async () => {
    const { user, company, card } = await holderOf('INACTIVE');
    const remaining: number[] = [];
    for (let i = 0; i < 5; i++) remaining.push((await activate(user, card, { last4: '0000' })).json().attemptsRemaining);

    const res = await activate(user, card, { last4: '4821' });

    expect(remaining).toEqual([4, 3, 2, 1, 0]);
    expect(res.statusCode).toBe(423);
    expectContract(res, 'activateCard');
    expect((await overview(user, company)).actions.activationBlockedReason).toBe('LOCKED');
  });

  it('cannot be tricked into extra guesses by concurrent requests', async () => {
    const { user, card } = await holderOf('INACTIVE');

    const responses = await Promise.all(Array.from({ length: 12 }, () => activate(user, card, { last4: '0000' })));

    const wrong = responses.filter((r) => r.statusCode === 422);
    const locked = responses.filter((r) => r.statusCode === 423);
    expect(wrong).toHaveLength(5);
    expect(locked).toHaveLength(7);
    // Each wrong attempt saw a different count: no two requests read the same value.
    expect(wrong.map((r) => r.json().attemptsRemaining).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns 404 for someone else's card, even an owner of the same company", async () => {
    const { company, card } = await holderOf('INACTIVE');
    const owner = await ctx.fx.user();
    await ctx.fx.member(owner, company, 'OWNER');

    const res = await activate(owner, card, { last4: '4821' });

    expect(res.statusCode).toBe(404);
    expectContract(res, 'activateCard');
  });

  it('returns 404 for a card that does not exist', async () => {
    const res = await activate(await ctx.fx.user(), randomUUID(), { last4: '4821' });

    expect(res.statusCode).toBe(404);
    expectContract(res, 'activateCard');
  });

  it.each([
    ['no body field', {}],
    ['three digits', { last4: '482' }],
    ['letters', { last4: 'abcd' }],
    ['extra fields', { last4: '4821', pin: '1234' }],
  ])('returns 400 for %s', async (_name, payload) => {
    const { user, card } = await holderOf('INACTIVE');

    const res = await activate(user, card, payload);

    expect(res.statusCode).toBe(400);
    expectContract(res, 'activateCard');
  });

  it('answers a non-JSON body with a standard problem title', async () => {
    const { user, card } = await holderOf('INACTIVE');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/cards/${card}/activation`,
      headers: { authorization: `Bearer ${await ctx.token(user)}`, 'content-type': 'text/plain' },
      payload: '4821',
    });

    expect(res.statusCode).toBe(415);
    expect(expectContract(res, 'activateCard')).toMatchObject({ status: 415, title: 'Unsupported Media Type' });
  });
});
