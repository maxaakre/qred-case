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

  it('logs a successful activation', async () => {
    const { user, card } = await ctx.fx.cardHolder();
    log.lines.length = 0;

    await ctx.activate(user, card, { last4: '4821' });

    expect(events()).toMatchObject([{ outcome: 'activated', cardId: card, level: 30 }]);
  });
});
