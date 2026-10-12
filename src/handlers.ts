import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { activationService } from './activation.js';
import type { BodyOf, PathOf, QueryOf, Schemas } from './api.js';
import type { Config } from './config.js';
import { apiCompany } from './mappers.js';
import { cardOverviewService } from './overview.js';
import { HttpProblem } from './problem.js';
import { companiesRepository } from './repositories/companies.js';
import { transactionsService } from './transactions.js';

/** What the handlers need. The app wiring (app.ts) adds the rest. */
export interface HandlerDeps {
  pool: pg.Pool;
  config: Config;
  /** Injected so tests control "now" (spend period, overdue invoices). */
  now: () => Date;
  /** True once shutdown has started: /health fails so the load balancer stops sending traffic. */
  isDraining?: () => boolean;
}

/**
 * One handler per operationId in openapi/openapi.yaml. Handlers stay thin: HTTP in, service call,
 * HTTP out. The services throw HttpProblem for the outcomes the contract defines (404, 409, 422, 423);
 * kept there because each status is part of that use case's contract, not a generic mapping.
 */
export function createHandlers({ pool, config, now, isDraining = () => false }: HandlerDeps) {
  const companies = companiesRepository(pool);
  const overview = cardOverviewService(pool, config, now);
  const transactions = transactionsService(pool);
  const activation = activationService(pool);

  return {
    /** Liveness: the process answers. Never the database, so an outage restarts nothing. */
    async getLiveness(_req: FastifyRequest, reply: FastifyReply) {
      return reply.send({ status: 'ok' });
    },

    /** Readiness: this instance can serve requests, database included. */
    async getHealth(req: FastifyRequest, reply: FastifyReply) {
      if (isDraining()) throw new HttpProblem(503, 'Service Unavailable', 'Shutting down');
      try {
        await pool.query('SELECT 1');
      } catch (err) {
        req.log.warn({ err }, 'Health check: database unreachable');
        throw new HttpProblem(503, 'Service Unavailable', 'Database unreachable');
      }
      return reply.send({ status: 'ok' });
    },

    async listMyCompanies(req: FastifyRequest): Promise<{ items: Schemas['CompanySummary'][] }> {
      return { items: (await companies.listForUser(req.userId)).map(apiCompany) };
    },

    async getCardOverview(req: FastifyRequest<{ Params: PathOf<'getCardOverview'> }>): Promise<Schemas['CardOverview']> {
      return overview.get(req.userId, req.params.companyId);
    },

    async listCardTransactions(
      // Validation fills in the default `limit` from the spec, so it is always there.
      req: FastifyRequest<{ Params: PathOf<'listCardTransactions'>; Querystring: Required<Pick<QueryOf<'listCardTransactions'>, 'limit'>> & QueryOf<'listCardTransactions'> }>,
    ): Promise<Schemas['TransactionPage']> {
      return transactions.list(req.userId, req.params.cardId, req.query.limit, req.query.cursor);
    },

    async activateCard(
      req: FastifyRequest<{ Params: PathOf<'activateCard'>; Body: BodyOf<'activateCard'> }>,
    ): Promise<Schemas['Card']> {
      return activation.activate(req.userId, req.params.cardId, req.body.last4, req.log);
    },
  };
}
