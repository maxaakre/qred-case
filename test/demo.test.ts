import { describe, expect, it } from 'vitest';
import { DEMO } from '../src/demo.js';
import { type TestContext, useTestContext } from './context.js';

const getToken = (ctx: TestContext, user: string) =>
  ctx.app.inject({ method: 'POST', url: '/demo/token', payload: { user } });

describe('demo tokens, DEMO_MODE off (the default)', () => {
  const ctx = useTestContext({}, { reset: false });

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
    expect(JSON.stringify(spec)).not.toContain('X-Demo-Auth');
  });
});

describe('demo tokens, DEMO_MODE on', () => {
  const ctx = useTestContext({ demoMode: true }, { reset: false });

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

  it('lets the docs page call the local mock server, so "Try it out" works against Prism', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/' });

    expect(res.headers['content-security-policy']).toContain("connect-src 'self' http://localhost:4010");
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

  it('says on every call who may call it, and leaves the token to Authorize', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();
    const page = await ctx.app.inject({ method: 'GET', url: '/docs/static/swagger-initializer.js' });

    for (const [path, method] of [
      ['/v1/me/companies', 'get'],
      ['/v1/companies/{companyId}/card-overview', 'get'],
      ['/v1/cards/{cardId}/transactions', 'get'],
      ['/v1/cards/{cardId}/activation', 'post'],
    ]) {
      const operation = spec.paths[path!][method!];
      expect(operation.description).toMatch(/\*\*Demo:\*\*/);
      expect((operation.parameters ?? []).filter((p: any) => p.in === 'header')).toEqual([]);
    }
    expect(spec.paths['/v1/cards/{cardId}/activation'].post.description).toMatch(/card holder/i);
    expect(JSON.stringify(spec)).not.toContain('X-Demo-Auth');
    expect(page.body).not.toContain('requestInterceptor');
  });

  it('accepts a demo user id as well as a name, but nobody else', async () => {
    const byId = await getToken(ctx, DEMO.erik);
    const stranger = await getToken(ctx, '01900000-0000-7000-8000-0000000000ff');

    expect(byId.statusCode).toBe(200);
    expect(byId.json().userId).toBe(DEMO.erik);
    expect(stranger.statusCode).toBe(400);
  });

  it('explains the body of every call that has one', async () => {
    const spec = (await ctx.app.inject({ method: 'GET', url: '/docs/json' })).json();

    expect(spec.paths['/demo/token'].post.requestBody.description).toMatch(/`user`/);
    expect(Object.keys(spec.paths['/demo/token'].post.requestBody.content['application/json'].examples)).toEqual(['anna', 'erik']);
    expect(spec.paths['/v1/cards/{cardId}/activation'].post.requestBody.description).toMatch(/`last4`/);
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
