import { z } from 'zod';

const schema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.url(),
  // HS256 needs a long secret; refuse to start with a weak one.
  JWT_SECRET: z.string().min(32),
  // Who issues the tokens and who they are for. A token for another service is rejected,
  // even when it is signed with the same key.
  JWT_ISSUER: z.string().min(1).default('card-overview-dev'),
  JWT_AUDIENCE: z.string().min(1).default('card-overview-api'),
  // Oldest token accepted, counted from when it was issued, whatever its expiry says.
  // Access tokens from the sign-in provider live 5-15 minutes; this is the safety net.
  JWT_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
  SUPPORT_PHONE: z.string().min(1),
  SUPPORT_EMAIL: z.email(),
  SUPPORT_URL: z.url(),
  // Activation attempts per user per window, across all their cards.
  ACTIVATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  ACTIVATION_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  // Adds POST /demo/token for the seeded users. Only for local demos (docker-compose.yml).
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  // Swagger UI at /docs. Set to false in production if the API is not meant to be public.
  DOCS_ENABLED: z.enum(['true', 'false']).default('true'),
});

export interface JwtSettings {
  secret: string;
  issuer: string;
  audience: string;
  maxAgeSeconds: number;
}

export interface Config {
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
  port: number;
  databaseUrl: string;
  jwt: JwtSettings;
  support: { phone: string; email: string; url: string };
  activationRateLimit: { max: number; windowSeconds: number };
  demoMode: boolean;
  docsEnabled: boolean;
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
    jwt: { secret: e.JWT_SECRET, issuer: e.JWT_ISSUER, audience: e.JWT_AUDIENCE, maxAgeSeconds: e.JWT_MAX_AGE_SECONDS },
    support: { phone: e.SUPPORT_PHONE, email: e.SUPPORT_EMAIL, url: e.SUPPORT_URL },
    activationRateLimit: { max: e.ACTIVATION_RATE_LIMIT_MAX, windowSeconds: e.ACTIVATION_RATE_LIMIT_WINDOW_SECONDS },
    demoMode: e.DEMO_MODE === 'true',
    docsEnabled: e.DOCS_ENABLED === 'true',
  };
}
