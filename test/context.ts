import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  close(): Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const pool = new pg.Pool({ connectionString: inject('databaseUrl') });
  const app = await buildApp({ pool });
  return {
    app,
    pool,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
