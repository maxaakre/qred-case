import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate.js';
import { ownerDatabaseUrl } from './context.js';

describe('migrate', () => {
  const DB = 'migrate_race';
  const admin = new pg.Pool({ connectionString: ownerDatabaseUrl });
  const url = Object.assign(new URL(ownerDatabaseUrl), { pathname: `/${DB}` }).toString();
  beforeAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
  });
  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.end();
  });

  it('applies each migration once when two deploys start at the same time', async () => {
    const files = (await readdir('db/migrations')).filter((f) => f.endsWith('.sql')).sort();

    const [first, second] = await Promise.all([migrate(url), migrate(url)]);

    expect([...first, ...second].sort()).toEqual(files);
  });

  describe('on a database already migrated', () => {
    const db = new pg.Pool({ connectionString: url });
    afterAll(() => db.end());
    const isValid = async (index: string) =>
      (await db.query('SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1', [index])).rows[0]
        ?.indisvalid as boolean | undefined;
    // A unique index on a column with duplicates fails half-way, as an interrupted build would.
    const leaveInvalidIndex = async (name: string) => {
      await expect(db.query(`CREATE UNIQUE INDEX CONCURRENTLY ${name} ON cards (company_id)`)).rejects.toThrow(/could not create unique index/);
    };

    it('rebuilds an index that an interrupted run left INVALID, and leaves invalid indexes it did not build alone', async () => {
      await db.query(`INSERT INTO users (id, email, name) VALUES ('01900000-0000-7000-8000-00000000f001', 'm@example.com', 'M')`);
      await db.query(`INSERT INTO companies (id, name, org_number) VALUES ('01900000-0000-7000-8000-00000000f0c1', 'M AB', '556999-0001')`);
      await db.query(
        `INSERT INTO cards (company_id, holder_user_id, last4, status, image_url, credit_limit_minor, spend_limit_minor)
         SELECT '01900000-0000-7000-8000-00000000f0c1', '01900000-0000-7000-8000-00000000f001', '1234', 'INACTIVE', 'https://x', 1, 1
           FROM generate_series(1, 2)`,
      );
      // Migration 008 as if a deploy crashed during its concurrent build.
      await db.query(`DELETE FROM schema_migrations WHERE name = '008_cards_current_index.sql'`);
      await db.query('DROP INDEX cards_holder_open_idx');
      await leaveInvalidIndex('cards_holder_open_idx');
      await leaveInvalidIndex('someone_elses_idx');

      expect(await migrate(url)).toEqual(['008_cards_current_index.sql']);

      expect(await isValid('cards_holder_open_idx')).toBe(true);
      expect(await isValid('someone_elses_idx')).toBe(false);
    });

    it('rolls a failing migration back completely and names it', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
      await writeFile(path.join(dir, '999_broken.sql'), 'CREATE TABLE half_done (id int);\nSELECT 1 / 0;\n');
      try {
        await expect(migrate(url, dir)).rejects.toThrow('Migration 999_broken.sql failed');
      } finally {
        await rm(dir, { recursive: true });
      }

      expect((await db.query(`SELECT to_regclass('half_done') AS t`)).rows[0].t).toBeNull();
      expect((await db.query(`SELECT 1 FROM schema_migrations WHERE name = '999_broken.sql'`)).rowCount).toBe(0);
    });
  });
});
