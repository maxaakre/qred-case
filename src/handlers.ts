import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from './app.js';

/** One handler per operationId in openapi/openapi.yaml. */
export function createHandlers({ pool }: AppDeps) {
  return {
    async getHealth(_req: FastifyRequest, reply: FastifyReply) {
      await pool.query('SELECT 1');
      return reply.send({ status: 'ok' });
    },
  };
}
