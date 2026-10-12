import type { FastifyReply, FastifyRequest } from 'fastify';
import { activationService } from './activation.js';
import type { AppDeps } from './app.js';
import type { components } from './generated/api.js';
import { cardOverviewService } from './overview.js';
import { HttpProblem } from './problem.js';
import { companiesRepository } from './repositories/companies.js';
import { transactionsService } from './transactions.js';

type Schemas = components['schemas'];

/** One handler per operationId in openapi/openapi.yaml. Handlers stay thin: HTTP in, service call, HTTP out. */
export function createHandlers({ pool, config, now }: AppDeps) {
  const companies = companiesRepository(pool);
  const overview = cardOverviewService(pool, config, now);
  const transactions = transactionsService(pool);
  const activation = activationService(pool);

  return {
    async getHealth(req: FastifyRequest, reply: FastifyReply) {
      try {
        await pool.query('SELECT 1');
      } catch (err) {
        req.log.warn({ err }, 'Health check: database unreachable');
        throw new HttpProblem(503, 'Service Unavailable', 'Database unreachable');
      }
      return reply.send({ status: 'ok' });
    },

    async listMyCompanies(req: FastifyRequest): Promise<{ items: Schemas['CompanySummary'][] }> {
      return { items: await companies.listForUser(req.userId) };
    },

    async getCardOverview(req: FastifyRequest<{ Params: { companyId: string } }>): Promise<Schemas['CardOverview']> {
      return overview.get(req.userId, req.params.companyId);
    },

    async listCardTransactions(
      req: FastifyRequest<{ Params: { cardId: string }; Querystring: { limit: number; cursor?: string } }>,
    ): Promise<Schemas['TransactionPage']> {
      return transactions.list(req.userId, req.params.cardId, req.query.limit, req.query.cursor);
    },

    async activateCard(
      req: FastifyRequest<{ Params: { cardId: string }; Body: { last4: string } }>,
    ): Promise<Schemas['Card']> {
      return activation.activate(req.userId, req.params.cardId, req.body.last4);
    },
  };
}
