import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

/** The smallest environment the API starts with. */
const valid = {
  DATABASE_URL: 'postgres://card_api:secret@localhost:5432/cards',
  JWT_SECRET: 'x'.repeat(32),
  SUPPORT_PHONE: '+46 8 000 00 00',
  SUPPORT_EMAIL: 'support@example.com',
  SUPPORT_URL: 'https://example.com/support',
};

describe('loadConfig', () => {
  it('reads the environment and fills in safe defaults', () => {
    expect(loadConfig(valid)).toEqual({
      logLevel: 'info',
      port: 3000,
      databaseUrl: valid.DATABASE_URL,
      jwt: { secret: valid.JWT_SECRET, issuer: 'card-overview-dev', audience: 'card-overview-api', maxAgeSeconds: 3600 },
      support: { phone: valid.SUPPORT_PHONE, email: valid.SUPPORT_EMAIL, url: valid.SUPPORT_URL },
      activationRateLimit: { max: 10, windowSeconds: 900 },
      readRateLimit: { max: 300 },
      dbPoolMax: 10,
      // Demo shortcuts are off unless asked for.
      demoMode: false,
      docsEnabled: true,
    });
  });

  it('turns numbers and switches from text into real values', () => {
    const config = loadConfig({ ...valid, PORT: '8080', DEMO_MODE: 'true', DOCS_ENABLED: 'false', ACTIVATION_RATE_LIMIT_MAX: '3' });

    expect(config).toMatchObject({ port: 8080, demoMode: true, docsEnabled: false, activationRateLimit: { max: 3 } });
  });

  describe('in production', () => {
    const production = { ...valid, NODE_ENV: 'production', JWT_ISSUER: 'https://id.example.com', JWT_AUDIENCE: 'card-api' };

    it('refuses to start without an explicit issuer and audience', () => {
      expect(() => loadConfig({ ...production, JWT_ISSUER: undefined, JWT_AUDIENCE: undefined })).toThrow(
        /JWT_ISSUER: required in production[\s\S]*JWT_AUDIENCE: required in production/,
      );
    });

    it('keeps /docs off unless asked for', () => {
      expect(loadConfig(production).docsEnabled).toBe(false);
      expect(loadConfig({ ...production, DOCS_ENABLED: 'true' }).docsEnabled).toBe(true);
    });
  });

  it('refuses to start with a weak JWT secret', () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('names every missing or invalid setting at once', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: undefined, SUPPORT_EMAIL: 'not-an-email', LOG_LEVEL: 'loud' })).toThrow(
      /DATABASE_URL[\s\S]*SUPPORT_EMAIL|SUPPORT_EMAIL[\s\S]*DATABASE_URL/,
    );
  });

  it.each([
    ['DEMO_MODE', 'yes'],
    ['PORT', '70000'],
    ['LOG_LEVEL', 'loud'],
  ])('refuses %s=%s instead of guessing', (key, value) => {
    expect(() => loadConfig({ ...valid, [key]: value })).toThrow(new RegExp(key));
  });
});
