import type { FastifyRequest } from 'fastify';
import { jwtVerify } from 'jose';
import { isUuid } from './uuid.js';

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
      // The scheme name is case-insensitive in HTTP (RFC 9110), the token is not.
      const token = /^Bearer +(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
      if (!token) throw Object.assign(new Error('Missing bearer token'), { statusCode: 401 });
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          // jose only checks `exp` when present; a token without one would never expire.
          requiredClaims: ['exp', 'sub'],
        });
        if (!payload.sub || !isUuid(payload.sub)) throw new Error('Token subject is not a user id');
        req.userId = payload.sub;
      } catch {
        throw Object.assign(new Error('Invalid bearer token'), { statusCode: 401 });
      }
    },
  };
}
