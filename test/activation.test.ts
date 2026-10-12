import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CardStatus } from '../src/domain/types.js';
import { useTestContext } from './context.js';

describe('POST /v1/cards/{cardId}/activation', () => {
  const ctx = useTestContext();

  const activate = (userId: string, cardId: string, payload: object) => ctx.activate(userId, cardId, payload);
  const overview = async (userId: string, companyId: string) => (await ctx.overview(userId, companyId)).json();
  const holderOf = (status: CardStatus = 'INACTIVE') => ctx.fx.cardHolder({ status });

  it('activates the card when the last 4 digits match', async () => {
    const { user, company, card } = await holderOf('INACTIVE');

    const res = await activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: card, status: 'ACTIVE', last4: '4821' });
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
    expect(res.json()).toMatchObject({ status: 'ACTIVE' });
  });

  it('returns 409, not 200, for wrong digits on a card that is already active', async () => {
    const { user, card } = await holderOf('ACTIVE');

    const res = await activate(user, card, { last4: '0000' });

    expect(res.statusCode).toBe(409);
  });

  it.each(['FROZEN', 'CLOSED'] as const)('returns 409 for a %s card', async (status) => {
    const { user, card } = await holderOf(status);

    const res = await activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(409);
  });

  it('returns 422 with the attempts left when the digits are wrong', async () => {
    const { user, card } = await holderOf('INACTIVE');

    const res = await activate(user, card, { last4: '0000' });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ status: 422, attemptsRemaining: 4 });
  });

  it('locks activation after 5 wrong attempts, even for the right digits', async () => {
    const { user, company, card } = await holderOf('INACTIVE');
    const remaining: number[] = [];
    for (let i = 0; i < 5; i++) remaining.push((await activate(user, card, { last4: '0000' })).json().attemptsRemaining);

    const res = await activate(user, card, { last4: '4821' });

    expect(remaining).toEqual([4, 3, 2, 1, 0]);
    expect(res.statusCode).toBe(423);
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

  it('cannot be activated by a holder who has left the company', async () => {
    const { user, company, card } = await holderOf('INACTIVE');
    await ctx.pool.query('DELETE FROM company_members WHERE user_id = $1 AND company_id = $2', [user, company]);

    const res = await activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(404);
    const { rows } = await ctx.pool.query('SELECT status FROM cards WHERE id = $1', [card]);
    expect(rows[0].status).toBe('INACTIVE');
  });

  it('activates once when right and wrong digits arrive together, and counts no wrong try after that', async () => {
    const { user, card } = await holderOf('INACTIVE');

    const responses = await Promise.all([
      activate(user, card, { last4: '0000' }),
      activate(user, card, { last4: '4821' }),
      activate(user, card, { last4: '0000' }),
      activate(user, card, { last4: '0000' }),
    ]);

    // A wrong try before the activation is a 422; after it, the card is ACTIVE and it is a 409.
    expect(responses.map((r) => r.statusCode).filter((s) => s === 200)).toHaveLength(1);
    expect(responses.every((r) => [200, 409, 422].includes(r.statusCode))).toBe(true);
    const { rows } = await ctx.pool.query('SELECT status, failed_activation_attempts FROM cards WHERE id = $1', [card]);
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].failed_activation_attempts).toBe(responses.filter((r) => r.statusCode === 422).length);
  });

  it("returns 404 for someone else's card, even an owner of the same company", async () => {
    const { company, card } = await holderOf('INACTIVE');
    const owner = await ctx.fx.user();
    await ctx.fx.member(owner, company, 'OWNER');

    const res = await activate(owner, card, { last4: '4821' });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a card that does not exist', async () => {
    const res = await activate(await ctx.fx.user(), randomUUID(), { last4: '4821' });

    expect(res.statusCode).toBe(404);
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
  });

  it('refuses a body far larger than any valid request, before parsing it', async () => {
    const { user, card } = await holderOf('INACTIVE');

    const res = await activate(user, card, { last4: '4821', padding: 'x'.repeat(2048) });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ status: 413, title: 'Payload Too Large' });
  });

  it.each([
    ['text/plain', '4821'],
    // Only a response type in the spec; must not become a way around body validation.
    ['application/problem+json', '{"last4":"4821","pin":"1234"}'],
  ])('answers a %s body with 415 and a standard problem title', async (contentType, payload) => {
    const { user, card } = await holderOf('INACTIVE');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/v1/cards/${card}/activation`,
      headers: { authorization: `Bearer ${await ctx.token(user)}`, 'content-type': contentType },
      payload,
    });

    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ status: 415, title: 'Unsupported Media Type' });
  });
});
