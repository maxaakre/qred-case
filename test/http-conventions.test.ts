import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { checkEveryResponse } from './contract.js';
import { isUuid } from '../src/uuid.js';
import { NOW, testConfig } from './context.js';

describe('HTTP conventions on every response', () => {
  const logLines: { reqId?: string }[] = [];
  let pool: pg.Pool;
  let app: FastifyInstance;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: testConfig.databaseUrl });
    const stream = new Writable({
      write(chunk, _enc, done) {
        logLines.push(JSON.parse(chunk.toString()));
        done();
      },
    });
    app = await buildApp({ pool, config: testConfig, now: () => NOW, logger: { level: 'info', stream } });
    checkEveryResponse(app);
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const health = (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: '/health', headers });

  it("keeps the caller's id, so the app and the logs share one id", async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me/companies', headers: { 'x-request-id': 'app-7f3a.42_x' } });

    expect(res.headers['x-request-id']).toBe('app-7f3a.42_x');
    expect(logLines.some((line) => line.reqId === 'app-7f3a.42_x')).toBe(true);
  });

  it('creates a uuid when the caller sends none', async () => {
    const res = await health();

    expect(isUuid(String(res.headers['x-request-id']))).toBe(true);
  });

  it.each([
    ['a line break (fake log lines)', 'abc\nlevel=error'],
    ['more than 128 characters', 'a'.repeat(129)],
  ])('replaces an id with %s', async (_name, id) => {
    const res = await health({ 'x-request-id': id });

    expect(isUuid(String(res.headers['x-request-id']))).toBe(true);
  });

  it('tells every cache not to store API responses, which hold personal financial data', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me/companies' });

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends security headers, and a policy that lets an API response run nothing in a browser', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/me/companies' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
  });

  it('lets the docs page load its own scripts and call the API and the mock, nothing else', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    const csp = String(res.headers['content-security-policy']);

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' http://localhost:4010");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('keeps health checks out of the logs, so probes every few seconds do not bury real requests', async () => {
    logLines.length = 0;

    await health({ 'x-request-id': 'probe-1' });

    expect(logLines.filter((line) => line.reqId === 'probe-1')).toEqual([]);
  });

  it('is on error responses too, where support needs it most', async () => {
    // Fails validation, before any route hook or handler runs.
    const res = await app.inject({ method: 'GET', url: '/v1/cards/not-a-uuid/transactions', headers: { 'x-request-id': 'support-case-1' } });

    expect(res.statusCode).toBe(400);
    expect(res.headers['x-request-id']).toBe('support-case-1');
  });
});
