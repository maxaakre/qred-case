import type { FastifyInstance } from 'fastify';
import { SignJWT } from 'jose';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { fixtures, type Fixtures } from './fixtures.js';

export const testConfig: Config = {
  port: 0,
  databaseUrl: inject('databaseUrl'),
  jwtSecret: 'test-secret-test-secret-test-secret',
  support: { phone: '+46 8 000 00 00', email: 'support@example.com', url: 'https://example.com/support' },
};

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  fx: Fixtures;
  token(userId: string, opts?: { expiresIn?: string }): Promise<string>;
  tokenSignedWith(secret: string, userId: string): Promise<string>;
  close(): Promise<void>;
}

function sign(secret: string, userId: string, expiresIn = '15m') {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt()
    .setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
}

export async function createTestContext(): Promise<TestContext> {
  const pool = new pg.Pool({ connectionString: testConfig.databaseUrl });
  const app = await buildApp({ pool, config: testConfig });
  return {
    app,
    pool,
    fx: fixtures(pool),
    token: (userId, opts) => sign(testConfig.jwtSecret, userId, opts?.expiresIn),
    tokenSignedWith: (secret, userId) => sign(secret, userId),
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
