import { readdir } from 'node:fs/promises';
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
});
