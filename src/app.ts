import Fastify, { type FastifyInstance } from 'fastify';
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
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // `example` is documentation in the spec, not validation.
    ajv: { customOptions: { keywords: ['example'] } },
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
