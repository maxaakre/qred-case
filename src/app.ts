import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createSecurityHandlers } from './auth.js';
import type { Config } from './config.js';
import { createHandlers } from './handlers.js';
import { HttpProblem, registerProblemHandlers } from './problem.js';

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
  // The spec only defines JSON bodies, and only JSON bodies are validated against it.
  // Without this, a text/plain body would skip validation entirely.
  app.removeContentTypeParser('text/plain');
  registerProblemHandlers(app);
  // Only for operations marked `x-fastify-config: { rateLimit: {} }` in the spec.
  // Runs after the bearer check, so it counts per signed-in user, and a stranger
  // cannot use up someone else's attempts. Kept in memory: one count per instance.
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    max: deps.config.activationRateLimit.max,
    timeWindow: deps.config.activationRateLimit.windowSeconds * 1000,
    keyGenerator: (req) => req.userId,
    errorResponseBuilder: (_req, { after }) =>
      new HttpProblem(429, 'Too Many Requests', `Too many attempts. Try again in ${after}.`),
  });
  await app.register(openapiGlue, {
    specification: SPEC,
    serviceHandlers: createHandlers(deps),
    securityHandlers: createSecurityHandlers(deps.config.jwtSecret),
  });
  return app;
}
