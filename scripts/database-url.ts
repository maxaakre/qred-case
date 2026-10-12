/** The database for scripts (migrate, seed). Only DATABASE_URL is needed, not the API's whole config. */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Run `npm run setup`, or set it in .env.');
  return url;
}
