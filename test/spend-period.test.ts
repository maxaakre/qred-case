import { describe, expect, it } from 'vitest';
import { spendPeriodFor } from '../src/domain/spend-period.js';

describe('spendPeriodFor', () => {
  it('is the calendar month the instant falls in', () => {
    expect(spendPeriodFor(new Date('2026-10-12T08:00:00Z'))).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
      startsAt: new Date('2026-09-30T22:00:00Z'), // 00:00 Stockholm summer time
      endsAt: new Date('2026-10-31T23:00:00Z'), // 00:00 Nov 1, after the switch to winter time
    });
  });

  it('uses Swedish time, so late evening UTC on the last day is already next month', () => {
    // 23:30 UTC on Oct 31 is 00:30 on Nov 1 in Stockholm.
    expect(spendPeriodFor(new Date('2026-10-31T23:30:00Z'))).toMatchObject({ start: '2026-11-01', end: '2026-11-30' });
  });

  it('counts the last minute of the month in Swedish time as that month', () => {
    // 22:59 UTC on Oct 31 is 23:59 on Oct 31 in Stockholm (winter time).
    expect(spendPeriodFor(new Date('2026-10-31T22:59:00Z'))).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
  });

  it('handles February in a leap year', () => {
    expect(spendPeriodFor(new Date('2028-02-15T12:00:00Z'))).toMatchObject({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('rolls over the year in December', () => {
    expect(spendPeriodFor(new Date('2026-12-31T22:59:00Z'))).toEqual({
      start: '2026-12-01',
      end: '2026-12-31',
      startsAt: new Date('2026-11-30T23:00:00Z'),
      endsAt: new Date('2026-12-31T23:00:00Z'),
    });
  });
});
