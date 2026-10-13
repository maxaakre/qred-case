import type { LightMyRequestResponse } from 'fastify';
import { describe, expect, it } from 'vitest';
import { expectContract } from './contract.js';

/** The contract check itself: it must fail on what the spec does not allow, or it proves nothing. */
describe('the contract check', () => {
  const response = (statusCode: number, body: unknown, type = 'application/json') =>
    ({ statusCode, headers: { 'content-type': type }, json: () => body }) as unknown as LightMyRequestResponse;
  const company = { id: '01900000-0000-7000-8000-0000000000c1', name: 'Company AB' };
  const wrongDigits = { type: '/problems/wrong-activation-digits', title: 'Unprocessable Content', status: 422, attemptsRemaining: 4 };

  it('accepts a response the spec describes', () => {
    expect(() => expectContract(response(200, { items: [company] }), 'listMyCompanies')).not.toThrow();
  });

  it('refuses a field the spec does not name, also inside a list', () => {
    const leaked = { items: [{ ...company, orgNumber: '556000-0001' }] };

    expect(() => expectContract(response(200, leaked), 'listMyCompanies')).toThrow(/unevaluated properties/);
  });

  it('allows the fields a problem type adds to Problem, and nothing else', () => {
    const problem = (body: object) => response(422, body, 'application/problem+json');

    expect(() => expectContract(problem(wrongDigits), 'activateCard')).not.toThrow();
    expect(() => expectContract(problem({ ...wrongDigits, last4: '4821' }), 'activateCard')).toThrow(/unevaluated properties/);
  });
});
