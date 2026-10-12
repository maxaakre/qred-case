import type { FastifyInstance, FastifyServerOptions, LightMyRequestResponse } from 'fastify';
import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config, JwtSettings } from '../src/config.js';
import { signDevToken } from '../src/dev-token.js';
import { checkEveryResponse } from './contract.js';
import { fixtures, type Fixtures } from './fixtures.js';

export const testConfig: Config = {
  logLevel: 'silent',
  demoMode: false,
  docsEnabled: true,
  port: 0,
  // The app connects with only its runtime privileges (see global-setup.ts).
  databaseUrl: inject('appDatabaseUrl'),
  jwt: { secret: 'test-secret-test-secret-test-secret', issuer: 'test-issuer', audience: 'test-audience', maxAgeSeconds: 3600 },
  support: { phone: '+46 8 000 00 00', email: 'support@example.com', url: 'https://example.com/support' },
  // High enough that only the rate-limit tests hit it.
  activationRateLimit: { max: 1000, windowSeconds: 900 },
  readRateLimit: { max: 1000 },
  dbPoolMax: 10,
};

/** The schema owner: for test data and migrations, never for the app under test. */
export const ownerDatabaseUrl = inject('ownerDatabaseUrl');

/** The tests' "now": Monday 12 October 2026, 10:00 in Stockholm. */
export const NOW = new Date('2026-10-12T08:00:00Z');

export interface TestContext {
  app: FastifyInstance;
  /** Owner connection, for creating test data. The app has its own, less privileged pool. */
  pool: pg.Pool;
  fx: Fixtures;
  token(userId: string, opts?: { expiresIn?: string }): Promise<string>;
  /** A token with some settings changed: another secret, issuer or audience. */
  tokenWith(changes: Partial<JwtSettings>, userId: string): Promise<string>;
  tokenWithoutExpiry(userId: string): Promise<string>;
  /** GET as the signed-in user. */
  get(userId: string, url: string): Promise<LightMyRequestResponse>;
  /** POST a JSON body as the signed-in user. */
  post(userId: string, url: string, payload: object): Promise<LightMyRequestResponse>;
  overview(userId: string, companyId: string): Promise<LightMyRequestResponse>;
  activate(userId: string, cardId: string, body: { last4: string } | object): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export interface AppOptions {
  /** The app's pool; by default one with the app's own, limited database login. */
  appPool?: pg.Pool;
  logger?: FastifyServerOptions['logger'];
  /** The app's "now"; NOW by default. */
  now?: Date;
  /** Whether shutdown has started; never by default. */
  isDraining?: () => boolean;
}

export async function createTestContext(overrides: Partial<Config> = {}, options: AppOptions = {}): Promise<TestContext> {
  const pool = new pg.Pool({ connectionString: ownerDatabaseUrl });
  const appPool = options.appPool ?? new pg.Pool({ connectionString: testConfig.databaseUrl });
  const app = await buildApp({
    pool: appPool,
    config: { ...testConfig, ...overrides },
    now: () => options.now ?? NOW,
    ...(options.isDraining && { isDraining: options.isDraining }),
    ...(options.logger !== undefined && { logger: options.logger }),
  });
  checkEveryResponse(app);
  const token = (userId: string, opts?: { expiresIn?: string }) => signDevToken(testConfig.jwt, userId, opts?.expiresIn);
  const bearer = async (userId: string) => ({ authorization: `Bearer ${await token(userId)}` });
  const get = async (userId: string, url: string) => app.inject({ method: 'GET', url, headers: await bearer(userId) });
  const post = async (userId: string, url: string, payload: object) =>
    app.inject({ method: 'POST', url, headers: await bearer(userId), payload });
  return {
    app,
    pool,
    fx: fixtures(pool),
    token,
    tokenWith: (changes, userId) => signDevToken({ ...testConfig.jwt, ...changes }, userId),
    tokenWithoutExpiry: (userId) => signDevToken(testConfig.jwt, userId, null),
    get,
    post,
    overview: (userId, companyId) => get(userId, `/v1/companies/${companyId}/card-overview`),
    activate: (userId, cardId, body) => post(userId, `/v1/cards/${cardId}/activation`, body),
    async close() {
      await app.close();
      await appPool.end();
      await pool.end();
    },
  };
}

/**
 * One test context for a describe block: built before its tests, closed after them, and
 * by default emptied before each test. Use it like a context: `ctx.fx`, `ctx.get`, ...
 */
export function useTestContext(
  overrides: Partial<Config> = {},
  { reset = true, ...options }: { reset?: boolean } & AppOptions = {},
): TestContext {
  let ctx: TestContext | undefined;
  beforeAll(async () => {
    ctx = await createTestContext(overrides, options);
  });
  if (reset) beforeEach(() => ctx!.fx.reset());
  afterAll(() => ctx?.close());
  return new Proxy({} as TestContext, {
    get: (_target, key) => {
      if (!ctx) throw new Error('The test context is only ready inside tests and hooks');
      return ctx[key as keyof TestContext];
    },
  });
}

/** A pool pointing at a port where no database listens: every query fails to connect. */
export const deadPool = () =>
  new pg.Pool({ connectionString: 'postgres://app:app@127.0.0.1:1/none', connectionTimeoutMillis: 300 });

/** A JSON logger whose lines the test can read. Pass `logger` to the context. */
export function logCapture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  return { lines, logger: { level: 'info', stream } };
}
