import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { databaseUrlFromEnv } from './database-url.js';
import { isMain } from './is-main.js';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../db/migrations');

/** Any fixed number; every instance that migrates takes the same lock. */
const MIGRATION_LOCK = 72_421;

/** How long one migration may wait for a table lock. */
const LOCK_TIMEOUT = '5s';

/** First line of a migration that must run outside a transaction, e.g. CREATE INDEX CONCURRENTLY. */
const NO_TRANSACTION = '-- migrate: no-transaction';

/** How long a deploy waits for another deploy's migrations before it gives up. */
const LOCK_WAIT_MS = 5 * 60_000;
const LOCK_POLL_MS = 250;

/**
 * Takes the migration lock, waiting while another deploy holds it. Released when the connection
 * closes, also if this process crashes. Polls instead of blocking in pg_advisory_lock: a session
 * blocked inside a statement holds a snapshot, and CREATE INDEX CONCURRENTLY in the other deploy
 * would wait for that snapshot forever (a deadlock).
 */
async function takeMigrationLock(client: pg.Client) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [MIGRATION_LOCK]);
    if (rows[0]!.locked) return;
    if (Date.now() > deadline) throw new Error('Another deploy is still migrating; gave up waiting for the migration lock');
    await setTimeout(LOCK_POLL_MS);
  }
}

/** The indexes a migration builds with CREATE INDEX CONCURRENTLY IF NOT EXISTS. */
const indexesBuiltBy = (sql: string) =>
  [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+"?(\w+)"?/gi)].map((m) => m[1]!);

/**
 * Of the indexes this migration builds, those left INVALID by an earlier, interrupted run.
 * Any other invalid index (say, a DBA's REINDEX CONCURRENTLY in progress) is not ours to drop.
 */
async function dropInvalidIndexes(client: pg.Client, names: string[]) {
  if (!names.length) return;
  const { rows } = await client.query<{ name: string }>(
    `SELECT format('%I.%I', n.nspname, c.relname) AS name
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT i.indisvalid AND n.nspname = current_schema() AND c.relname = ANY($1)`,
    [names],
  );
  for (const { name } of rows) await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${name}`);
}

/**
 * Applies every .sql file in db/migrations once, in name order, each in its own transaction
 * (unless it starts with NO_TRANSACTION).
 * Two deploys starting at once take turns: the second waits for the lock, then finds nothing to do.
 */
export async function migrate(connectionString: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await takeMigrationLock(client);
    // A migration that waits for a table lock holds up every query queued behind it. Give up
    // after a few seconds instead; the deploy fails clearly and can be retried.
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      if (sql.startsWith(NO_TRANSACTION)) {
        // CREATE INDEX CONCURRENTLY cannot run in a transaction. Such a file holds one
        // idempotent statement (IF NOT EXISTS), so a retry after a crash is safe.
        // A failed concurrent build leaves an INVALID index that IF NOT EXISTS would then
        // skip, so drop those first. No lock timeout here: a concurrent build or drop blocks
        // no writes while it waits, and aborting it is what leaves the invalid index.
        await client.query('SET lock_timeout = 0');
        try {
          await dropInvalidIndexes(client, indexesBuiltBy(sql));
          await client.query(sql);
        } catch (err) {
          throw new Error(`Migration ${file} failed`, { cause: err });
        } finally {
          await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
        }
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        applied.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {}); // keep the migration's error, not the rollback's
        throw new Error(`Migration ${file} failed`, { cause: err });
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (isMain(import.meta.url)) {
  const applied = await migrate(databaseUrlFromEnv());
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
}
