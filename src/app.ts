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
import { demoDocsUiConfig, registerDemoRoutes, withDemoDocs } from './demo.js';
import { docsTheme } from './docs-theme.js';
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
    // Personal financial data: no proxy, CDN or device cache may keep a copy.
    // Static docs assets set their own caching and are left alone.
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });
  // Load balancers and Docker probe /health every few seconds. Log it only when it fails
  // (warn), so the probes do not bury real requests.
  app.addHook('onRoute', (route) => {
    if (route.url === '/health') route.logLevel = 'warn';
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
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    theme: { title: 'Card Overview API', css: [{ filename: 'theme.css', content: docsTheme }] },
    uiConfig: {
      // Every operation is ready to Execute, and shows how long the call took.
      tryItOutEnabled: true,
      displayRequestDuration: true,
      // The guide and the operations come first; schemas stay folded at the bottom.
      defaultModelsExpandDepth: 0,
      ...(deps.config.demoMode && demoDocsUiConfig),
    },
    ...(deps.config.demoMode && { transformSpecification: withDemoDocs }),
  });
  // Logs "ContentTypeParser for 'application/problem+json' not found" at startup: the plugin
  // also lists response types. That is intended; such request bodies get 415 (tested).
  await app.register(openapiGlue, {
    specification: SPEC,
    serviceHandlers: createHandlers(deps),
    securityHandlers: createSecurityHandlers(deps.config.jwtSecret),
  });
  if (deps.config.demoMode) registerDemoRoutes(app, deps.config.jwtSecret);
  return app;
}
