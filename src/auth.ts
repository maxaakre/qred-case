import type { FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/**
 * Security handlers for openapi-glue, keyed by the scheme name in the spec.
 * The token only proves who the user is (ADR 0006); access is checked per request in the database.
 */
export function createSecurityHandlers(jwtSecret: string) {
  const key = new TextEncoder().encode(jwtSecret);
  return {
    async bearerAuth(req: FastifyRequest) {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer ')) throw Object.assign(new Error('Missing bearer token'), { statusCode: 401 });
      try {
        const { payload } = await jwtVerify(header.slice(7), key, { algorithms: ['HS256'] });
        if (!payload.sub || !UUID.test(payload.sub)) throw new Error('Token subject is not a user id');
        req.userId = payload.sub;
      } catch {
        throw Object.assign(new Error('Invalid bearer token'), { statusCode: 401 });
      }
    },
  };
}
