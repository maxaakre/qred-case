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
    level: config.logLevel,
    // Never write tokens to the logs.
    redact: ['req.headers.authorization'],
  },
});

// An idle client can lose its connection (database restart, failover). pg then emits
// 'error' on the pool; without a listener Node would crash the process. The pool
// drops that client and opens a new one on the next request.
pool.on('error', (err) => app.log.error({ err }, 'Idle database client failed'));

// Finish in-flight requests and close the pool on shutdown (e.g. a Kubernetes rollout).
// Below Docker's 10 s stop grace period, so the timeout is logged before the process is killed.
const SHUTDOWN_TIMEOUT_MS = 8_000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'Shutting down');
    // A stuck request must not keep the process alive until the platform kills it without a log line.
    setTimeout(() => {
      app.log.error('Shutdown timed out');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    try {
      await app.close();
      await pool.end();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Shutdown failed');
      process.exit(1);
    }
  });
}

await app.listen({ port: config.port, host: '0.0.0.0' });
