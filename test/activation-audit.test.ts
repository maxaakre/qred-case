import { describe, expect, it } from 'vitest';
import { logCapture, useTestContext } from './context.js';

/** Activation outcomes are audit events: support and fraud monitoring need to see a lockout coming. */
describe('activation audit log', () => {
  const log = logCapture();
  const ctx = useTestContext({}, { logger: log.logger });
  const events = () => log.lines.filter((line) => line.event === 'card_activation');

  it('logs each wrong try with the attempts left, and the lockout as a warning, never the digits', async () => {
    const { user, card } = await ctx.fx.cardHolder();
    log.lines.length = 0;

    for (let i = 0; i < 5; i++) await ctx.activate(user, card, { last4: '0000' });

    expect(events().map((e) => [e.outcome, e.attemptsRemaining])).toEqual([
      ['wrong_digits', 4], ['wrong_digits', 3], ['wrong_digits', 2], ['wrong_digits', 1], ['wrong_digits', 0],
    ]);
    expect(events().at(-1)).toMatchObject({ level: 40, cardId: card, userId: user }); // 40 = warn
    expect(log.lines.some((line) => 'last4' in line || JSON.stringify(line).includes('"last4"'))).toBe(false);
  });

  it('records when the last wrong try happened', async () => {
    const { user, card } = await ctx.fx.cardHolder();

    await ctx.activate(user, card, { last4: '0000' });

    const { rows } = await ctx.pool.query('SELECT last_failed_activation_at FROM cards WHERE id = $1', [card]);
    expect(rows[0].last_failed_activation_at).toBeInstanceOf(Date);
  });

  it('refuses a locked card with 423, and logs the attempt as a warning', async () => {
    const { user, card } = await ctx.fx.cardHolder({ failedActivationAttempts: 5 });
    log.lines.length = 0;

    const res = await ctx.activate(user, card, { last4: '4821' });

    expect(res.statusCode).toBe(423);
    expect(res.json()).toMatchObject({ status: 423, title: 'Locked' });
    expect(events()).toMatchObject([{ outcome: 'locked', cardId: card, userId: user, level: 40 }]);
  });

  it('logs a successful activation', async () => {
    const { user, card } = await ctx.fx.cardHolder();
    log.lines.length = 0;

    await ctx.activate(user, card, { last4: '4821' });

    expect(events()).toMatchObject([{ outcome: 'activated', cardId: card, level: 30 }]);
  });

  it('stores every outcome in card_activation_events, written with the card change itself', async () => {
    const { user, card } = await ctx.fx.cardHolder();
    const locked = await ctx.fx.cardHolder({ failedActivationAttempts: 5 });

    await ctx.activate(user, card, { last4: '0000' });
    await ctx.activate(user, card, { last4: '4821' });
    await ctx.activate(user, card, { last4: '4821' }); // a retry changes nothing, so it is no event
    await ctx.activate(locked.user, locked.card, { last4: '4821' });

    const { rows } = await ctx.pool.query(
      'SELECT card_id, user_id, outcome FROM card_activation_events ORDER BY occurred_at, id',
    );
    expect(rows).toEqual([
      { card_id: card, user_id: user, outcome: 'wrong_digits' },
      { card_id: card, user_id: user, outcome: 'activated' },
      { card_id: locked.card, user_id: locked.user, outcome: 'locked' },
    ]);
  });
});
