import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createSecurityHandlers } from './auth.js';
import type { Config } from './config.js';
import { createHandlers } from './handlers.js';
import { registerProblemHandlers } from './problem.js';

const SPEC = fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url));

export interface AppDeps {
  pool: pg.Pool;
  config: Config;
  /** Injected so tests control "now" (spend period, overdue invoices). */
  now: () => Date;
  /** Pino logger options; off in tests. */
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    ajv: {
      customOptions: {
        // `example` is documentation in the spec, not validation.
        keywords: ['example'],
        // Reject unknown fields instead of silently dropping them (Fastify's default).
        removeAdditional: false,
      },
    },
  });
  app.decorateRequest('userId', '');
  registerProblemHandlers(app);
  await app.register(openapiGlue, {
    specification: SPEC,
    serviceHandlers: createHandlers(deps),
    securityHandlers: createSecurityHandlers(deps.config.jwtSecret),
  });
  return app;
}
