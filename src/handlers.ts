import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from './app.js';
import type { components } from './generated/api.js';
import { notFound } from './problem.js';
import { companiesRepository } from './repositories/companies.js';

type Schemas = components['schemas'];

/** One handler per operationId in openapi/openapi.yaml. */
export function createHandlers({ pool }: AppDeps) {
  const companies = companiesRepository(pool);

  return {
    async getHealth(_req: FastifyRequest, reply: FastifyReply) {
      await pool.query('SELECT 1');
      return reply.send({ status: 'ok' });
    },

    async listMyCompanies(req: FastifyRequest): Promise<{ items: Schemas['CompanySummary'][] }> {
      return { items: await companies.listForUser(req.userId) };
    },

    async getCardOverview(req: FastifyRequest<{ Params: { companyId: string } }>) {
      const membership = await companies.findMembership(req.userId, req.params.companyId);
      // Same answer for "does not exist" and "not yours" (ADR 0005).
      if (!membership) throw notFound('Company not found');
      throw new Error('Not implemented');
    },
  };
}
