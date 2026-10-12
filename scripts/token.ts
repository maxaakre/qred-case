import { loadConfig } from '../src/config.js';
import { DEMO } from '../src/demo.js';
import { signDevToken } from '../src/dev-token.js';

/** Prints a demo JWT for a seeded user: npm run token -- anna | erik */
const name = process.argv[2] ?? 'anna';
if (name !== 'anna' && name !== 'erik') {
  console.error('Usage: npm run token -- anna | erik');
  process.exit(1);
}
console.log(await signDevToken(loadConfig().jwtSecret, DEMO[name], '12h'));
