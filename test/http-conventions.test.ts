import { describe, expect, it } from 'vitest';
import { isUuid } from '../src/uuid.js';
import { logCapture, useTestContext } from './context.js';

describe('HTTP conventions on every response', () => {
  const log = logCapture();
  const ctx = useTestContext({}, { reset: false, logger: log.logger });
  const logLines = log.lines;

  const health = (headers: Record<string, string> = {}) => ctx.app.inject({ method: 'GET', url: '/health', headers });

  it("keeps the caller's id, so the app and the logs share one id", async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/companies', headers: { 'x-request-id': 'app-7f3a.42_x' } });

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
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/companies' });

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sends security headers, and a policy that lets an API response run nothing in a browser', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/companies' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
  });

  it('lets the docs page load its own scripts and call the API, nothing else', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/' });
    const csp = String(res.headers['content-security-policy']);

    expect(csp).toContain("script-src 'self'");
    // The local mock server is only allowed in demo mode (see demo.test.ts).
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("style-src 'self' 'sha256-");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('keeps health checks out of the logs, so probes every few seconds do not bury real requests', async () => {
    logLines.length = 0;

    await health({ 'x-request-id': 'probe-1' });

    expect(logLines.filter((line) => line.reqId === 'probe-1')).toEqual([]);
  });

  it('is on error responses too, where support needs it most', async () => {
    // Fails validation, before any route hook or handler runs.
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/cards/not-a-uuid/transactions', headers: { 'x-request-id': 'support-case-1' } });

    expect(res.statusCode).toBe(400);
    expect(res.headers['x-request-id']).toBe('support-case-1');
  });
});
