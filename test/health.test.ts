import { describe, expect, it } from 'vitest';
import { deadPool, useTestContext } from './context.js';

describe('GET /live and GET /health', () => {
  const ctx = useTestContext({}, { reset: false });

  it('reports ok when the database is reachable', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('when the database is unreachable', () => {
  const ctx = useTestContext({}, { reset: false, appPool: deadPool() });

  it('is still alive, so the platform does not restart a healthy instance', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/live' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('is not ready: /health reports 503, so the load balancer sends traffic elsewhere', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
  });
});
