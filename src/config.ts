import { z } from 'zod';

const schema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  // HS256 needs a long secret; refuse to start with a weak one.
  JWT_SECRET: z.string().min(32),
  SUPPORT_PHONE: z.string().min(1),
  SUPPORT_EMAIL: z.string().email(),
  SUPPORT_URL: z.string().url(),
  // Activation attempts per user per window, across all their cards.
  ACTIVATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  ACTIVATION_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  // Adds POST /demo/token for the seeded users. Only for local demos (docker-compose.yml).
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
});

export interface Config {
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  support: { phone: string; email: string; url: string };
  activationRateLimit: { max: number; windowSeconds: number };
  demoMode: boolean;
}

/** Reads and validates all configuration once at startup. Fails fast on anything missing. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${problems}`);
  }
  const e = parsed.data;
  return {
    logLevel: e.LOG_LEVEL,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    support: { phone: e.SUPPORT_PHONE, email: e.SUPPORT_EMAIL, url: e.SUPPORT_URL },
    activationRateLimit: { max: e.ACTIVATION_RATE_LIMIT_MAX, windowSeconds: e.ACTIVATION_RATE_LIMIT_WINDOW_SECONDS },
    demoMode: e.DEMO_MODE === 'true',
  };
}
