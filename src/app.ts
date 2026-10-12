import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecurityHandlers } from './auth.js';
import type { Config } from './config.js';
import { createHandlers } from './handlers.js';
import { HttpProblem, registerProblemHandlers } from './problem.js';

const SPEC = fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url));

/** A caller's request id is trusted only if it cannot forge log lines or bloat them. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

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
    // Correlation id: reuse the app's X-Request-Id, or create one. Pino puts it on
    // every log line as `reqId`, and it goes back in the response header.
    requestIdHeader: false,
    genReqId: (req) => {
      const id = req.headers['x-request-id'];
      return typeof id === 'string' && SAFE_REQUEST_ID.test(id) ? id : randomUUID();
    },
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
  // onSend runs for every response, errors included: that is where support needs the id.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });
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
  // API docs at /docs. Static mode shows openapi.yaml as written; nothing is generated
  // from the code, so the contract stays the single source.
  await app.register(swagger, { mode: 'static', specification: { path: SPEC, baseDir: dirname(SPEC) } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(openapiGlue, {
    specification: SPEC,
    serviceHandlers: createHandlers(deps),
    securityHandlers: createSecurityHandlers(deps.config.jwtSecret),
  });
  return app;
}
