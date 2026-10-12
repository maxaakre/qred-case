import { SignJWT } from 'jose';
import { loadConfig } from '../src/config.js';
import { DEMO } from './seed.js';

/** Prints a demo JWT for a seeded user: npm run token -- anna | erik */
const name = (process.argv[2] ?? 'anna') as 'anna' | 'erik';
const userId = DEMO[name];
if (!userId || !['anna', 'erik'].includes(name)) {
  console.error('Usage: npm run token -- anna | erik');
  process.exit(1);
}
const token = await new SignJWT({})
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(userId)
  .setIssuedAt()
  .setExpirationTime('12h')
  .sign(new TextEncoder().encode(loadConfig().jwtSecret));
console.log(token);
