import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { migrate } from '../scripts/migrate.js';

let container: StartedPostgreSqlContainer;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const url = container.getConnectionUri();
  await migrate(url);
  project.provide('databaseUrl', url);
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
