import { describe, expect, it } from 'vitest';
import { createPool } from '../src/db.js';
import { testConfig } from './context.js';

describe('database pool', () => {
  it('cancels a query that runs too long, so one slow query cannot hold a connection', async () => {
    const pool = createPool(testConfig.databaseUrl, { statementTimeoutMs: 200 });

    await expect(pool.query('SELECT pg_sleep(2)')).rejects.toThrow(/statement timeout/);
    await pool.end();
  });
});
