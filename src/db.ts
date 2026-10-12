import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings. The default turns them into a JS Date
// at local midnight, which shifts the day depending on the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

/**
 * The app's connection pool. A query that runs too long, or a transaction left open, is
 * cancelled by Postgres, so one slow request cannot hold a connection the others need.
 */
export function createPool(connectionString: string, { statementTimeoutMs = 5_000 } = {}) {
  return new pg.Pool({
    connectionString,
    max: 10,
    statement_timeout: statementTimeoutMs,
    idle_in_transaction_session_timeout: 10_000,
    // Fail fast when the database is unreachable instead of queueing requests.
    connectionTimeoutMillis: 5_000,
  });
}

/** Anything that can run a query: the pool, or a client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

/**
 * Runs `fn` in one transaction on one client. On failure the original error is
 * kept even if ROLLBACK fails too, and a broken client is destroyed instead of
 * going back to the pool.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (db: Queryable) => Promise<T>,
  begin = 'BEGIN',
): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query(begin);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = rollbackErr as Error;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

/**
 * A read-only REPEATABLE READ transaction: every query sees the same snapshot,
 * so numbers read separately always agree (ADR 0007).
 */
export function withSnapshot<T>(pool: pg.Pool, fn: (db: Queryable) => Promise<T>): Promise<T> {
  return withTransaction(pool, fn, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
}

/** Postgres returns bigint and numeric as strings. Money must stay exact, so refuse anything unsafe. */
export function toSafeInteger(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Value ${value} is not a safe integer`);
  return n;
}
