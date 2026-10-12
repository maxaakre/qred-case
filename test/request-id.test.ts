import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { isUuid } from '../src/uuid.js';
import { NOW, testConfig } from './context.js';

describe('X-Request-Id', () => {
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
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const health = (headers: Record<string, string> = {}) => app.inject({ method: 'GET', url: '/health', headers });

  it("keeps the caller's id, so the app and the logs share one id", async () => {
    const res = await health({ 'x-request-id': 'app-7f3a.42_x' });

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

  it('is on error responses too, where support needs it most', async () => {
    // Fails validation, before any route hook or handler runs.
    const res = await app.inject({ method: 'GET', url: '/v1/cards/not-a-uuid/transactions', headers: { 'x-request-id': 'support-case-1' } });

    expect(res.statusCode).toBe(400);
    expect(res.headers['x-request-id']).toBe('support-case-1');
  });
});
