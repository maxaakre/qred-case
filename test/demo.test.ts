import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/demo.js';
import { createTestContext, type TestContext } from './context.js';

const getToken = (ctx: TestContext, user: string) =>
  ctx.app.inject({ method: 'POST', url: '/demo/token', payload: { user } });

describe('demo tokens, DEMO_MODE off (the default)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('has no token endpoint', async () => {
    const res = await getToken(ctx, 'anna');

    expect(res.statusCode).toBe(404);
  });

  // Without demo mode /docs is exactly openapi.yaml, so this also keeps demo data out of the contract.
  it('does not show it, or any demo data, in the docs', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.paths['/demo/token']).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain(DEMO.companyAb);
  });
});

describe('demo tokens, DEMO_MODE on', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ demoMode: true });
  });
  afterAll(() => ctx.close());

  it('returns a token for a demo user that the API accepts', async () => {
    const res = await getToken(ctx, 'anna');

    expect(res.statusCode).toBe(200);
    const { token, userId } = res.json();
    expect(userId).toBe(DEMO.anna);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/companies',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('answers an unknown user with 400 problem+json', async () => {
    const res = await getToken(ctx, 'mallory');

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('shows the endpoint in the docs, without a lock, so it can be called before Authorize', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.paths['/demo/token'].post.security).toEqual([]);
  });

  it("prefills the demo ids, with Erik's inactive card for activation", async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.components.parameters.CompanyId.example).toBe(DEMO.companyAb);
    expect(spec.components.parameters.CardId.example).toBe(DEMO.annaCard);
    expect(spec.paths['/v1/cards/{cardId}/activation'].post.parameters[0]).toMatchObject({
      name: 'cardId',
      in: 'path',
      example: DEMO.erikCard,
    });
  });

  it('offers wrong and right digits as ready-made activation bodies', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();
    const examples = spec.paths['/v1/cards/{cardId}/activation'].post.requestBody.content['application/json'].examples;

    expect(Object.values(examples).map((e: any) => e.value.last4)).toEqual(['0000', '7310']);
  });
});
