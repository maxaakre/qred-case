import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPool, toSafeInteger, withTransaction } from '../src/db.js';
import { testConfig } from './context.js';

describe('database pool', () => {
  it('cancels a query that runs too long, so one slow query cannot hold a connection', async () => {
    const pool = createPool(testConfig.databaseUrl, { statementTimeoutMs: 200 });

    await expect(pool.query('SELECT pg_sleep(2)')).rejects.toThrow(/statement timeout/);
    await pool.end();
  });
});

describe('withTransaction', () => {
  it('rethrows the original error when ROLLBACK fails too, and destroys the broken client', async () => {
    const original = new Error('insert failed');
    const rollbackFailed = new Error('connection lost');
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'ROLLBACK') throw rollbackFailed;
      }),
      release: vi.fn(),
    };
    const pool = { connect: async () => client } as unknown as pg.Pool;

    await expect(withTransaction(pool, async () => Promise.reject(original))).rejects.toBe(original);
    // Releasing with an error makes pg destroy the client instead of reusing it.
    expect(client.release).toHaveBeenCalledWith(rollbackFailed);
  });
});

describe('toSafeInteger', () => {
  it('refuses a bigint that a JS number cannot hold exactly', () => {
    expect(() => toSafeInteger('9007199254740993')).toThrow(/not a safe integer/);
  });

  it('keeps negative amounts', () => {
    expect(toSafeInteger('-300000')).toBe(-300_000);
  });
});
