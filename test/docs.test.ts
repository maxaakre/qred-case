import { describe, expect, it } from 'vitest';
import { useTestContext } from './context.js';

describe('API docs at /docs', () => {
  const ctx = useTestContext({}, { reset: false });

  it('serves Swagger UI without a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('shows the contract itself, not a spec generated from the code', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/json' });

    const spec = res.json();
    expect(spec.info.title).toBe('Card Overview API');
    const operationIds = Object.values(spec.paths).flatMap((ops) => Object.values(ops as object).map((op) => op.operationId));
    expect(operationIds.sort()).toEqual(['activateCard', 'getCardOverview', 'getHealth', 'getLiveness', 'listCardTransactions', 'listMyCompanies']);
  });
});

describe('API docs turned off (DOCS_ENABLED=false)', () => {
  const ctx = useTestContext({ docsEnabled: false }, { reset: false });

  it.each(['/docs/', '/docs/json'])('does not serve %s', async (url) => {
    const res = await ctx.app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(404);
  });
});
