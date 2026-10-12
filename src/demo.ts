import type { FastifySwaggerUiConfigOptions } from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import type { JwtSettings } from './config.js';
import { signDevToken } from './dev-token.js';

/** The seeded demo users and their companies and cards (see scripts/seed.ts). */
export const DEMO = {
  anna: '01900000-0000-7000-8000-000000000001', // OWNER of Company AB, active card
  erik: '01900000-0000-7000-8000-000000000002', // EMPLOYEE of Company AB, inactive card
  companyAb: '01900000-0000-7000-8000-0000000000c1',
  byggNorr: '01900000-0000-7000-8000-0000000000c2',
  annaCard: '01900000-0000-7000-8000-0000000000a1',
  erikCard: '01900000-0000-7000-8000-0000000000a2',
} as const;

const DEMO_USERS = { anna: DEMO.anna, erik: DEMO.erik } as const;
export type DemoUser = keyof typeof DEMO_USERS;
export const DEMO_USER_NAMES = Object.keys(DEMO_USERS) as DemoUser[];
const TOKEN_LIFETIME = '12h';

export const isDemoUser = (name: string): name is DemoUser => Object.hasOwn(DEMO_USERS, name);

/** A token for a seeded demo user. Shared by POST /demo/token and `npm run token`. */
export async function signDemoToken(jwt: JwtSettings, user: DemoUser) {
  const userId = DEMO_USERS[user];
  return { token: await signDevToken(jwt, userId, TOKEN_LIFETIME), userId, expiresIn: TOKEN_LIFETIME };
}

const requestSchema = {
  type: 'object',
  required: ['user'],
  additionalProperties: false,
  properties: {
    user: {
      type: 'string',
      enum: DEMO_USER_NAMES,
      description: 'anna: owner, active card. erik: employee, inactive card (last4 7310).',
    },
  },
} as const;

const responseSchema = {
  type: 'object',
  required: ['token', 'userId', 'expiresIn'],
  properties: {
    token: { type: 'string', description: 'Paste into Authorize' },
    userId: { type: 'string', format: 'uuid' },
    expiresIn: { type: 'string', example: TOKEN_LIFETIME },
  },
} as const;

/**
 * POST /demo/token: a token for a seeded user, so the docs page can be tried without a
 * terminal. Only registered when DEMO_MODE=true, and not part of the contract
 * (openapi.yaml); it only appears on /docs, via `withDemoDocs` (ADR 0009).
 *
 * Defence in depth: it only signs tokens for the demo user ids. Access comes from
 * membership in the database (ADR 0006), so against a real database without the seed
 * these tokens can see nothing.
 */
export function registerDemoRoutes(app: FastifyInstance, jwt: JwtSettings) {
  app.log.warn('DEMO_MODE is on: anyone can get a token at POST /demo/token. Never enable it in production.');
  app.post<{ Body: { user: DemoUser } }>(
    '/demo/token',
    { schema: { body: requestSchema, response: { 200: responseSchema } } },
    (req) => signDemoToken(jwt, req.body.user),
  );
}

/**
 * The spec shown on /docs in demo mode: the contract plus the demo token endpoint
 * (listed first), the demo ids prefilled, and ready-made activation bodies. The
 * contract file never contains demo data; everything demo-only lives here.
 */
export function withDemoDocs(spec: Readonly<Record<string, unknown>>): Record<string, unknown> {
  // The docs walk an untyped spec object; the shapes used here are fixed by openapi.yaml.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docs: any = structuredClone(spec);

  docs.tags = [
    {
      name: 'Demo',
      description: 'Start here. Execute `POST /demo/token` and you are signed in: the locks close. Run it again with `erik` to try activation.',
    },
    ...(docs.tags ?? []),
  ];
  docs.paths = { '/demo/token': { post: demoTokenOperation }, ...docs.paths };

  docs.components.parameters.CompanyId.example = DEMO.companyAb;
  docs.components.parameters.CardId.example = DEMO.annaCard;

  const activation = docs.paths['/v1/cards/{cardId}/activation'].post;
  activation.parameters = [
    { ...docs.components.parameters.CardId, example: DEMO.erikCard, description: "Erik's inactive card (demo)" },
  ];
  activation.requestBody.content['application/json'].examples = {
    wrongDigits: { summary: 'Wrong digits: 422 and one attempt fewer', value: { last4: '0000' } },
    eriksCard: { summary: "Erik's card: 200, the card becomes ACTIVE (sign in as erik)", value: { last4: '7310' } },
  };
  return docs;
}

// Browser globals for the functions in `demoDocsUiConfig`, which run in Swagger UI, not in Node.
type SwaggerUiPlugin = NonNullable<FastifySwaggerUiConfigOptions['plugins']>[number];
declare const SwaggerUIBundle: { plugins: { DownloadUrl: SwaggerUiPlugin } };
interface SwaggerSystem {
  preauthorizeApiKey(scheme: string, value: string): void;
}
interface DemoWindow {
  demoSwagger?: SwaggerSystem;
}

/**
 * Swagger UI settings in demo mode: when POST /demo/token succeeds, sign in with the
 * returned token, so the flow is "Execute" and go, with nothing to copy into Authorize.
 * @fastify/swagger-ui writes these functions into the page as source, so they must not
 * use anything from this module.
 */
export const demoDocsUiConfig: FastifySwaggerUiConfigOptions = {
  plugins: [
    // Swagger UI's default plugin; setting `plugins` replaces the defaults.
    function downloadUrl(system: unknown) {
      return SwaggerUIBundle.plugins.DownloadUrl(system);
    },
    // Keeps Swagger UI's system object, which the response interceptor signs in with.
    function keepSystem() {
      return {
        afterLoad(system: SwaggerSystem) {
          (window as DemoWindow).demoSwagger = system;
        },
      };
    },
  ],
  responseInterceptor: function (res) {
    const token = res.body?.token;
    if (res.ok && res.url.endsWith('/demo/token') && typeof token === 'string') {
      (window as DemoWindow).demoSwagger?.preauthorizeApiKey('bearerAuth', token);
    }
    return res;
  },
};

const demoTokenOperation = {
  tags: ['Demo'],
  summary: 'Get a token for a demo user',
  description: 'Signs you in on this page as soon as it succeeds (the locks close). `anna` sees the design; use `erik` to try activation.',
  operationId: 'getDemoToken',
  // No lock: this is how you get a token in the first place.
  security: [],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: requestSchema, example: { user: 'anna' } } },
  },
  responses: {
    '200': { description: 'Token for the user', content: { 'application/json': { schema: responseSchema } } },
    '400': {
      description: 'Unknown user',
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
    },
  },
};
