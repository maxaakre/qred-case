import pg from 'pg';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
const app = await buildApp({
  pool,
  config,
  now: () => new Date(),
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Never write tokens to the logs.
    redact: ['req.headers.authorization'],
  },
});

// Finish in-flight requests and close the pool on shutdown (e.g. a Kubernetes rollout).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
