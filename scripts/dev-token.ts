import { SignJWT } from 'jose';

/**
 * Signs an HS256 token for local demos and tests. `expiresIn: null` leaves out
 * `exp`, which only tests use, to prove such tokens are rejected.
 */
export function signDevToken(secret: string, userId: string, expiresIn: string | null = '15m') {
  const jwt = new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt();
  if (expiresIn !== null) jwt.setExpirationTime(expiresIn);
  return jwt.sign(new TextEncoder().encode(secret));
}
