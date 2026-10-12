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
// Short-lived like a real access token. The docs page fetches a new one when it expires.
const TOKEN_LIFETIME = '1h';

/** A demo user by name (`anna`) or by user id, or undefined for anyone else. */
export function resolveDemoUser(nameOrId: string): DemoUser | undefined {
  if (Object.hasOwn(DEMO_USERS, nameOrId)) return nameOrId as DemoUser;
  return DEMO_USER_NAMES.find((name) => DEMO_USERS[name] === nameOrId);
}

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
      enum: [...DEMO_USER_NAMES, ...Object.values(DEMO_USERS)],
      description: 'A demo user, by name or user id. anna: owner, active card. erik: employee, inactive card (last4 7310).',
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
  app.post<{ Body: { user: string } }>(
    '/demo/token',
    { schema: { body: requestSchema, response: { 200: responseSchema } } },
    // The schema only lets demo names and ids through, so the user always resolves.
    (req) => signDemoToken(jwt, resolveDemoUser(req.body.user)!),
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

  // Every call that needs a token gets a field for its own token or demo user, with a
  // hint about who may call it. The page turns the field into an Authorization header
  // (requestInterceptor below); the server never sees it.
  type Operation = { operationId?: string; security?: unknown[]; parameters?: unknown[] };
  for (const operations of Object.values<Record<string, Operation>>(docs.paths)) {
    for (const operation of Object.values(operations)) {
      if (operation.security?.length === 0) continue; // public, like /health
      operation.parameters = [demoAuthParameter(operation.operationId), ...(operation.parameters ?? [])];
    }
  }

  docs.tags = [
    {
      name: 'Demo',
      description: 'You are signed in as `anna` when the page opens (the locks are closed). Execute `POST /demo/token` with `erik` to switch user and try activation.',
    },
    ...(docs.tags ?? []),
  ];
  docs.paths = { '/demo/token': { post: demoTokenOperation }, ...docs.paths };

  docs.components.parameters.CompanyId.example = DEMO.companyAb;
  docs.components.parameters.CardId.example = DEMO.annaCard;

  const activation = docs.paths['/v1/cards/{cardId}/activation'].post;
  activation.parameters = [
    { ...demoAuthParameter('activateCard'), example: 'erik' },
    { ...docs.components.parameters.CardId, example: DEMO.erikCard, description: "Erik's inactive card (demo)" },
  ];
  activation.requestBody.content['application/json'].examples = {
    wrongDigits: { summary: 'Wrong digits: 422 and one attempt fewer', value: { last4: '0000' } },
    eriksCard: { summary: "Erik's card: 200, the card becomes ACTIVE", value: { last4: '7310' } },
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
 * Swagger UI settings in demo mode: the docs open signed in as anna, and POST /demo/token
 * switches user by signing in with the returned token. Nothing to copy into Authorize.
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
  // Keeps the sign-in across reloads. Demo mode only: these tokens reach only the demo users.
  persistAuthorization: true,
  // When the docs have loaded, sign in as anna, unless a sign-in was kept from before.
  onComplete: function () {
    // Keep a stored sign-in only while its token is still valid.
    try {
      const stored = JSON.parse(localStorage.getItem('authorized') ?? 'null');
      const token: string | undefined = stored?.bearerAuth?.value;
      const expiresAt = token ? JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp : 0;
      if (expiresAt * 1000 > Date.now() + 60_000) return;
    } catch {
      // Unreadable: sign in again.
    }
    fetch('/demo/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'anna' }),
    })
      .then((res) => res.json())
      .then((body: { token: string }) => (window as DemoWindow).demoSwagger?.preauthorizeApiKey('bearerAuth', body.token));
  },
  // X-Demo-Auth becomes the Authorization header for that call only: a pasted token as
  // it is, a demo user name or id as that user's token. An unknown user sends no token,
  // so the call gets a clear 401 instead of silently running as someone else.
  requestInterceptor: function (req) {
    const value = String(req.headers['X-Demo-Auth'] ?? '').trim();
    delete req.headers['X-Demo-Auth'];
    if (!value) return req;
    const token = value.replace(/^Bearer\s+/i, '');
    // A JWT has three dot-separated parts; anything else is a user name or id.
    if (token.split('.').length === 3) {
      req.headers.Authorization = `Bearer ${token}`;
      return req;
    }
    return fetch('/demo/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: value }),
    })
      .then((res) => (res.ok ? res.json() : { token: '' }))
      .then((body: { token: string }) => {
        if (body.token) req.headers.Authorization = `Bearer ${body.token}`;
        else delete req.headers.Authorization;
        return req;
      });
  },
  responseInterceptor: function (res) {
    const token = res.body?.token;
    if (res.ok && res.url.endsWith('/demo/token') && typeof token === 'string') {
      (window as DemoWindow).demoSwagger?.preauthorizeApiKey('bearerAuth', token);
    }
    return res;
  },
};

/** Who may call each operation, shown next to the X-Demo-Auth field. */
const WHO_MAY_CALL: Record<string, string> = {
  listMyCompanies: 'Any signed-in user. `anna` is in two companies, `erik` in one.',
  getCardOverview: 'A member of the company. `anna` (owner) also sees the invoice; `erik` (employee) does not.',
  listCardTransactions: 'Only the card holder. The card filled in is `anna`\'s.',
  activateCard: 'Only the card holder can activate. The card filled in is `erik`\'s.',
};

function demoAuthParameter(operationId?: string) {
  return {
    name: 'X-Demo-Auth',
    in: 'header',
    required: false,
    description: [
      'Demo mode: who this call runs as. Paste a token (with or without `Bearer`), or type a demo user: `anna`, `erik` or their user id. Empty uses Authorize.',
      operationId && WHO_MAY_CALL[operationId],
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: { type: 'string' },
  };
}

const demoTokenOperation = {
  tags: ['Demo'],
  summary: 'Get a token for a demo user',
  description: 'Switches who you are signed in as on this page. The page opens signed in as `anna`.',
  operationId: 'getDemoToken',
  // No lock: this is how you get a token in the first place.
  security: [],
  requestBody: {
    required: true,
    description:
      '`user`: who to sign in as on this page. `anna` (owner, active card) sees the design; `erik` (employee, inactive card, digits 7310) can try activation. A user id works too.',
    content: {
      'application/json': {
        schema: requestSchema,
        examples: {
          anna: { summary: 'anna: owner, active card (the design)', value: { user: 'anna' } },
          erik: { summary: 'erik: employee, inactive card (try activation)', value: { user: 'erik' } },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Token for the user', content: { 'application/json': { schema: responseSchema } } },
    '400': {
      description: 'Unknown user',
      content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
    },
  },
};
