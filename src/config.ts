import { z } from 'zod';

const schema = z.object({
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
});

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  support: { phone: string; email: string; url: string };
  activationRateLimit: { max: number; windowSeconds: number };
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
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    support: { phone: e.SUPPORT_PHONE, email: e.SUPPORT_EMAIL, url: e.SUPPORT_URL },
    activationRateLimit: { max: e.ACTIVATION_RATE_LIMIT_MAX, windowSeconds: e.ACTIVATION_RATE_LIMIT_WINDOW_SECONDS },
  };
}
