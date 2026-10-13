import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import addFormats from 'ajv-formats';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecurityHandlers } from './auth.js';
import { demoDocsUiConfig, registerDemoRoutes, withDemoDocs } from './demo.js';
import { docsTheme } from './docs-theme.js';
import { createHandlers, type HandlerDeps } from './handlers.js';
import { HttpProblem, registerProblemHandlers } from './problem.js';
import { UUID } from './uuid.js';

const SPEC = fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url));

/** A caller's request id is trusted only if it cannot forge log lines or bloat them. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * ajv-formats, with `uuid` narrowed to what Postgres reads. ajv-formats also accepts
 * `urn:uuid:…`, which the database refuses: a malformed id would become a 500, not a 400.
 * Named like ajv-formats' own plugin, so Fastify does not add that again on top of this one.
 */
function formatsPlugin(ajv: Parameters<typeof addFormats.default>[0]) {
  addFormats.default(ajv);
  return ajv.addFormat('uuid', UUID);
}

export interface AppDeps extends HandlerDeps {
  /** Pino logger options; off in tests. */
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? false,
    // The largest valid body is {"last4":"1234"}. Refuse anything bigger than 1 KiB before
    // parsing it, instead of Fastify's default 1 MiB.
    bodyLimit: 1024,
    // A client that sends its request too slowly gets cut off (slowloris), in case no proxy
    // in front of the service already does it.
    requestTimeout: 10_000,
    // Only the methods in the contract. Fastify would otherwise add a HEAD for every GET.
    exposeHeadRoutes: false,
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
        // Report every invalid field at once. Safe here: bodies are capped at 1 KiB.
        allErrors: true,
      },
      plugins: [formatsPlugin],
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
  // Load balancers and Docker probe /live and /health every few seconds. Log them only
  // when they fail (warn), so the probes do not bury real requests.
  app.addHook('onRoute', (route) => {
    if (route.url === '/live' || route.url === '/health') route.logLevel = 'warn';
  });
  // The spec only defines JSON bodies, and only JSON bodies are validated against it.
  // Without this, a text/plain body would skip validation entirely.
  app.removeContentTypeParser('text/plain');
  registerProblemHandlers(app);
  // Security headers on every response. An API response is JSON that a browser must never
  // run or frame, so its policy allows nothing. /docs gets its own policy below.
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  });
  // Every other /v1 route gets a generous per-user limit, so one user cannot take all the
  // database connections. Must run before the rate-limit plugin's own onRoute hook.
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith('/v1/') && route.config?.rateLimit === undefined) {
      route.config = { ...route.config, rateLimit: { max: deps.config.readRateLimit.max, timeWindow: 60_000 } };
    }
  });
  // The stricter default is for operations marked `x-fastify-config: { rateLimit: {} }` in the
  // spec (activation). Runs after the bearer check, so it counts per signed-in user, and a
  // stranger cannot use up someone else's attempts. Kept in memory: one count per instance.
  await app.register(rateLimit, {
    global: false,
    hook: 'preHandler',
    max: deps.config.activationRateLimit.max,
    timeWindow: deps.config.activationRateLimit.windowSeconds * 1000,
    keyGenerator: (req) => req.userId,
    errorResponseBuilder: (_req, { after }) =>
      new HttpProblem(429, 'Too Many Requests', `Too many attempts. Try again in ${after}.`),
  });
  if (deps.config.docsEnabled) {
    // API docs at /docs. Static mode shows openapi.yaml as written; nothing is generated
    // from the code, so the contract stays the single source.
    await app.register(swagger, { mode: 'static', specification: { path: SPEC, baseDir: dirname(SPEC) } });
    await app.register(swaggerUi, {
      routePrefix: '/docs',
      // The docs page may load its own files and call this API, nothing else. The local mock
      // server from the spec's `servers` only in demo mode. No `upgrade-insecure-requests`: it runs on local http.
      staticCSP: {
        'default-src': ["'self'"],
        'base-uri': ["'self'"],
        'connect-src': ["'self'", ...(deps.config.demoMode ? ['http://localhost:4010'] : [])],
        'font-src': ["'self'", 'data:'],
        'img-src': ["'self'", 'data:'],
        'object-src': ["'none'"],
        'script-src': ["'self'"],
        'script-src-attr': ["'none'"],
        // The hash is one small style Swagger UI injects at runtime; all other inline styles stay blocked.
        'style-src': ["'self'", "'sha256-RL3ie0nH+Lzz2YNqQN83mnU0J1ot4QL7b99vMdIX99w='"],
        'frame-ancestors': ["'none'"],
      },
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
  }
  // Logs "ContentTypeParser for 'application/problem+json' not found" at startup: the plugin
  // also lists response types. That is intended; such request bodies get 415 (tested).
  await app.register(openapiGlue, {
    specification: SPEC,
    serviceHandlers: createHandlers(deps),
    securityHandlers: createSecurityHandlers(deps.config.jwt),
  });
  if (deps.config.demoMode) registerDemoRoutes(app, deps.config.jwt);
  return app;
}
