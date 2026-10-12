import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from './app.js';
import type { components } from './generated/api.js';
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
  };
}
