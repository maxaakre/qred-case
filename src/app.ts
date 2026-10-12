import Fastify, { type FastifyInstance } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { createHandlers } from './handlers.js';

const SPEC = fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url));

export interface AppDeps {
  pool: pg.Pool;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // `example` is documentation in the spec, not validation.
    ajv: { customOptions: { keywords: ['example'] } },
  });
  await app.register(openapiGlue, {
    specification: SPEC,
    serviceHandlers: createHandlers(deps),
  });
  return app;
}
