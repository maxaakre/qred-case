import { loadConfig } from '../src/config.js';
import { DEMO_USER_NAMES, resolveDemoUser, signDemoToken } from '../src/demo.js';

/** Prints a demo JWT for a seeded user: npm run token -- anna | erik */
const user = resolveDemoUser(process.argv[2] ?? 'anna');
if (!user) {
  console.error(`Usage: npm run token -- ${DEMO_USER_NAMES.join(' | ')}`);
  process.exit(1);
}
console.log((await signDemoToken(loadConfig().jwt, user)).token);
