import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings. The default turns them into a JS Date
// at local midnight, which shifts the day depending on the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

/**
 * Runs `fn` in a read-only REPEATABLE READ transaction, so every query sees the
 * same snapshot and numbers read separately always agree (ADR 0007).
 */
export async function withSnapshot<T>(pool: pg.Pool, fn: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Postgres returns bigint and numeric as strings. Money must stay exact, so refuse anything unsafe. */
export function toSafeInteger(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Value ${value} is not a safe integer`);
  return n;
}
