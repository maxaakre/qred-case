import { z } from 'zod';

const schema = z.object({
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.url(),
  // HS256 needs a long secret; refuse to start with a weak one.
  JWT_SECRET: z.string().min(32),
  // Who issues the tokens and who they are for. A token for another service is rejected,
  // even when it is signed with the same key. Defaults only outside production (DEV_DEFAULTS).
  JWT_ISSUER: z.string().min(1).optional(),
  JWT_AUDIENCE: z.string().min(1).optional(),
  // Oldest token accepted, counted from when it was issued, whatever its expiry says.
  // Access tokens from the sign-in provider live 5-15 minutes; this is the safety net.
  JWT_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(3600),
  SUPPORT_PHONE: z.string().min(1),
  SUPPORT_EMAIL: z.email(),
  SUPPORT_URL: z.url(),
  // Activation attempts per user per window, across all their cards.
  ACTIVATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  ACTIVATION_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  // Every other signed-in request, per user per minute. Generous: it only stops one user from
  // taking all the database connections.
  READ_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  // Connections per instance. Size it to the database's max_connections divided by the instances.
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Adds POST /demo/token for the seeded users. Only for local demos (docker-compose.yml).
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  // Swagger UI at /docs. On by default only outside production (DEV_DEFAULTS).
  DOCS_ENABLED: z.enum(['true', 'false']).optional(),
  NODE_ENV: z.string().optional(),
});

/**
 * Convenient for local development, unsafe in production: a deploy that forgets JWT_ISSUER
 * would accept dev tokens, and one that forgets DOCS_ENABLED would publish /docs.
 * In production every one of these must be set explicitly.
 */
const DEV_DEFAULTS = { JWT_ISSUER: 'card-overview-dev', JWT_AUDIENCE: 'card-overview-api', DOCS_ENABLED: 'true' } as const;

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
  readRateLimit: { max: number };
  dbPoolMax: number;
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
  const isProduction = e.NODE_ENV === 'production';
  if (isProduction) {
    const missing = (['JWT_ISSUER', 'JWT_AUDIENCE'] as const).filter((key) => e[key] === undefined);
    if (missing.length) throw new Error(`Invalid configuration:\n  ${missing.map((k) => `${k}: required in production`).join('\n  ')}`);
  }
  const issuer = e.JWT_ISSUER ?? DEV_DEFAULTS.JWT_ISSUER;
  const audience = e.JWT_AUDIENCE ?? DEV_DEFAULTS.JWT_AUDIENCE;
  const docs = e.DOCS_ENABLED ?? (isProduction ? 'false' : DEV_DEFAULTS.DOCS_ENABLED);
  return {
    logLevel: e.LOG_LEVEL,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    jwt: { secret: e.JWT_SECRET, issuer, audience, maxAgeSeconds: e.JWT_MAX_AGE_SECONDS },
    support: { phone: e.SUPPORT_PHONE, email: e.SUPPORT_EMAIL, url: e.SUPPORT_URL },
    activationRateLimit: { max: e.ACTIVATION_RATE_LIMIT_MAX, windowSeconds: e.ACTIVATION_RATE_LIMIT_WINDOW_SECONDS },
    readRateLimit: { max: e.READ_RATE_LIMIT_MAX },
    dbPoolMax: e.DB_POOL_MAX,
    demoMode: e.DEMO_MODE === 'true',
    docsEnabled: docs === 'true',
  };
}
