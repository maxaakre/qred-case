import { loadConfig } from '../src/config.js';
import { DEMO_USER_NAMES, isDemoUser, signDemoToken } from '../src/demo.js';

/** Prints a demo JWT for a seeded user: npm run token -- anna | erik */
const name = process.argv[2] ?? 'anna';
if (!isDemoUser(name)) {
  console.error(`Usage: npm run token -- ${DEMO_USER_NAMES.join(' | ')}`);
  process.exit(1);
}
console.log((await signDemoToken(loadConfig().jwtSecret, name)).token);
