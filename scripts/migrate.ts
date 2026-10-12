import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { isMain } from './is-main.js';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../db/migrations');

/** Any fixed number; every instance that migrates takes the same lock. */
const MIGRATION_LOCK = 72_421;

/**
 * Applies every .sql file in db/migrations once, in name order, each in its own transaction.
 * Two deploys starting at once take turns: the second waits for the lock, then finds nothing to do.
 */
export async function migrate(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // Released when the connection closes, also if this process crashes.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
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
  const url = process.env.DATABASE_URL ?? 'postgres://app:app@localhost:5432/cards';
  const applied = await migrate(url);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
}
