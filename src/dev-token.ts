import { SignJWT } from 'jose';
import type { JwtSettings } from './config.js';

/**
 * Signs an HS256 token for local demos and tests, with the issuer and audience the API
 * expects. `expiresIn: null` leaves out `exp`, which only tests use, to prove such
 * tokens are rejected.
 */
export function signDevToken(jwt: JwtSettings, userId: string, expiresIn: string | null = '15m') {
  const token = new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(jwt.issuer)
    .setAudience(jwt.audience)
    .setIssuedAt();
  if (expiresIn !== null) token.setExpirationTime(expiresIn);
  return token.sign(new TextEncoder().encode(jwt.secret));
}
