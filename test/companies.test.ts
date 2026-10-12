import { describe, expect, it } from 'vitest';
import { useTestContext } from './context.js';

describe('GET /v1/me/companies', () => {
  const ctx = useTestContext();

  const listCompanies = (userId: string) => ctx.get(userId, '/v1/me/companies');

  it("lists only the user's companies, sorted by name", async () => {
    const user = await ctx.fx.user();
    const zeta = await ctx.fx.company('Zeta AB');
    const alfa = await ctx.fx.company('Alfa AB');
    const someoneElses = await ctx.fx.company('Other AB');
    await ctx.fx.member(user, zeta, 'EMPLOYEE');
    await ctx.fx.member(user, alfa, 'OWNER');
    await ctx.fx.member(await ctx.fx.user(), someoneElses);

    const res = await listCompanies(user);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { id: alfa, name: 'Alfa AB' },
        { id: zeta, name: 'Zeta AB' },
      ],
    });
  });

  it('sorts names the Swedish way: Å, Ä and Ö after Z, whatever the letter case', async () => {
    const user = await ctx.fx.user();
    for (const name of ['Ölands AB', 'Åkeri AB', 'zeta AB', 'Ängel AB', 'Alfa AB']) {
      await ctx.fx.member(user, await ctx.fx.company(name));
    }

    const res = await listCompanies(user);

    expect(res.json().items.map((c: { name: string }) => c.name)).toEqual(['Alfa AB', 'zeta AB', 'Åkeri AB', 'Ängel AB', 'Ölands AB']);
  });

  it('returns an empty list for a user with no companies', async () => {
    const res = await listCompanies(await ctx.fx.user());

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });
});
