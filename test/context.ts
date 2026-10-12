import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { signDevToken } from '../src/dev-token.js';
import { checkEveryResponse } from './contract.js';
import { fixtures, type Fixtures } from './fixtures.js';

export const testConfig: Config = {
  logLevel: 'silent',
  demoMode: false,
  port: 0,
  databaseUrl: inject('databaseUrl'),
  jwtSecret: 'test-secret-test-secret-test-secret',
  support: { phone: '+46 8 000 00 00', email: 'support@example.com', url: 'https://example.com/support' },
  // High enough that only the rate-limit tests hit it.
  activationRateLimit: { max: 1000, windowSeconds: 900 },
};

/** The tests' "now": Monday 12 October 2026, 10:00 in Stockholm. */
export const NOW = new Date('2026-10-12T08:00:00Z');

export interface TestContext {
  app: FastifyInstance;
  pool: pg.Pool;
  fx: Fixtures;
  token(userId: string, opts?: { expiresIn?: string }): Promise<string>;
  tokenSignedWith(secret: string, userId: string): Promise<string>;
  tokenWithoutExpiry(userId: string): Promise<string>;
  /** GET as the signed-in user. */
  get(userId: string, url: string): Promise<LightMyRequestResponse>;
  /** POST a JSON body as the signed-in user. */
  post(userId: string, url: string, payload: object): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export async function createTestContext(overrides: Partial<Config> = {}): Promise<TestContext> {
  const pool = new pg.Pool({ connectionString: testConfig.databaseUrl });
  const app = await buildApp({ pool, config: { ...testConfig, ...overrides }, now: () => NOW });
  checkEveryResponse(app);
  const bearer = async (userId: string) => ({
    authorization: `Bearer ${await signDevToken(testConfig.jwtSecret, userId)}`,
  });
  return {
    app,
    pool,
    fx: fixtures(pool),
    token: (userId, opts) => signDevToken(testConfig.jwtSecret, userId, opts?.expiresIn),
    tokenSignedWith: (secret, userId) => signDevToken(secret, userId),
    tokenWithoutExpiry: (userId) => signDevToken(testConfig.jwtSecret, userId, null),
    get: async (userId, url) => app.inject({ method: 'GET', url, headers: await bearer(userId) }),
    post: async (userId, url, payload) => app.inject({ method: 'POST', url, headers: await bearer(userId), payload }),
    async close() {
      await app.close();
      await pool.end();
    },
  };
}
