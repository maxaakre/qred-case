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

  it('does not sign anyone in automatically', async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/docs/static/swagger-initializer.js' });

    expect(page.body).not.toContain('preauthorizeApiKey');
  });

  // Without demo mode /docs is exactly openapi.yaml, so this also keeps demo data out of the contract.
  it('does not show it, or any demo data, in the docs', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.paths['/demo/token']).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain(DEMO.companyAb);
    expect(JSON.stringify(spec)).not.toContain('X-Demo-User');
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

  it('signs in with the token as soon as POST /demo/token succeeds, so there is nothing to copy', async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/docs/static/swagger-initializer.js' });

    expect(page.body).toMatch(/preauthorizeApiKey\(["']bearerAuth["']/);
    expect(page.body).toContain('/demo/token');
  });

  it('opens the docs already signed in as anna, and keeps the sign-in across reloads', async () => {
    const page = await ctx.app.inject({ method: 'GET', url: '/docs/static/swagger-initializer.js' });

    expect(page.body).toMatch(/fetch\(["']\/demo\/token["']/);
    expect(page.body).toMatch(/"persistAuthorization":true/);
  });

  it('lets every call choose its own demo user, with erik ready for activation', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();
    const userParam = (path: string, method: string) =>
      spec.paths[path][method].parameters.find((p: any) => p.name === 'X-Demo-User');

    for (const [path, method] of [
      ['/v1/me/companies', 'get'],
      ['/v1/companies/{companyId}/card-overview', 'get'],
      ['/v1/cards/{cardId}/transactions', 'get'],
      ['/v1/cards/{cardId}/activation', 'post'],
    ]) {
      expect(userParam(path!, method!)).toMatchObject({ in: 'header', schema: { enum: ['anna', 'erik'] } });
    }
    expect(userParam('/v1/cards/{cardId}/activation', 'post').example).toBe('erik');
    expect(spec.paths['/health'].get.parameters ?? []).toEqual([]);
  });

  it('never lets X-Demo-User sign anyone in on the server: the page turns it into a token', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/me/companies', headers: { 'x-demo-user': 'anna' } });
    const page = await ctx.app.inject({ method: 'GET', url: '/docs/static/swagger-initializer.js' });

    expect(res.statusCode).toBe(401);
    expect(page.body).toContain('X-Demo-User');
  });

  it("prefills the demo ids, with Erik's inactive card for activation", async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.components.parameters.CompanyId.example).toBe(DEMO.companyAb);
    expect(spec.components.parameters.CardId.example).toBe(DEMO.annaCard);
    expect(spec.paths['/v1/cards/{cardId}/activation'].post.parameters.find((p: any) => p.name === 'cardId')).toMatchObject({
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
