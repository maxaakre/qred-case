import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../scripts/migrate.js';

let container: StartedPostgreSqlContainer;

/**
 * One Postgres for all tests. Migrations run as the schema owner, like in production;
 * the app under test connects as a login in the `card_api` role (migration 003), so the
 * whole suite proves the app needs no more than those privileges.
 */
export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:18-alpine').start();
  const ownerUrl = container.getConnectionUri();
  await migrate(ownerUrl);

  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("CREATE ROLE card_api_test LOGIN PASSWORD 'card_api_test' IN ROLE card_api");
  await owner.end();

  const appUrl = new URL(ownerUrl);
  appUrl.username = 'card_api_test';
  appUrl.password = 'card_api_test';
  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl.toString());
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}
