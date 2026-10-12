import type { FastifyError, FastifyInstance } from 'fastify';
import { STATUS_CODES } from 'node:http';

/** An error that becomes an RFC 9457 problem+json response. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly detail?: string,
    readonly extensions: Record<string, unknown> = {},
  ) {
    super(detail ?? title);
  }
}

export const notFound = (detail: string) => new HttpProblem(404, 'Not Found', detail);

/** One invalid input, in the OpenAPI terms the app knows from the contract. */
export interface FieldError {
  in: 'body' | 'query' | 'path' | 'header';
  field: string;
  message: string;
}

const LOCATION: Record<string, FieldError['in']> = { body: 'body', querystring: 'query', params: 'path', headers: 'header' };

type AjvError = NonNullable<FastifyError['validation']>[number];

/** Ajv's errors as field, place and a short message, so the app can mark the right field. */
function fieldErrors(err: FastifyError): FieldError[] {
  const location = LOCATION[err.validationContext ?? ''] ?? 'body';
  return (err.validation ?? []).map((e: AjvError) => {
    const params = e.params as Record<string, unknown>;
    const parent = e.instancePath.split('/').filter(Boolean).join('.');
    const at = (child: unknown) => [parent, child].filter(Boolean).join('.');
    switch (e.keyword) {
      case 'required':
        return { in: location, field: at(params.missingProperty), message: 'is required' };
      case 'additionalProperties':
        return { in: location, field: at(params.additionalProperty), message: 'is not allowed' };
      default:
        return { in: location, field: parent, message: describe(e) };
    }
  });
}

function describe(e: AjvError): string {
  const params = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case 'pattern':
      return `must match ${params.pattern}`;
    case 'format':
      return `must be a ${params.format}`;
    case 'type':
      return `must be ${/^[aeiou]/.test(String(params.type)) ? 'an' : 'a'} ${params.type}`;
    case 'maximum':
      return `must be at most ${params.limit}`;
    case 'minimum':
      return `must be at least ${params.limit}`;
    case 'maxLength':
      return `must be at most ${params.limit} characters`;
    case 'enum':
      return `must be one of ${(params.allowedValues as unknown[]).join(', ')}`;
    default:
      return e.message ?? 'is invalid';
  }
}

export function registerProblemHandlers(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | HttpProblem, req, reply) => {
    let problem: HttpProblem;
    if (err instanceof HttpProblem) {
      problem = err;
    } else if ((err as FastifyError).validation) {
      const errors = fieldErrors(err as FastifyError);
      const detail = errors.map((e) => `${e.field} ${e.message}`).join('; ');
      problem = new HttpProblem(400, 'Bad Request', detail, { errors });
    } else if ((err as FastifyError).statusCode === 401) {
      problem = new HttpProblem(401, 'Unauthorized', 'Missing or invalid bearer token');
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      const status = (err as FastifyError).statusCode!;
      // The standard reason phrase, never an internal class name (RFC 9457).
      problem = new HttpProblem(status, STATUS_CODES[status] ?? 'Client Error', err.message);
    } else {
      // Never leak internals; the log has the details.
      req.log.error({ err }, 'Unhandled error');
      problem = new HttpProblem(500, 'Internal Server Error');
    }
    return reply
      .status(problem.status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: problem.title,
        status: problem.status,
        ...(problem.detail && { detail: problem.detail }),
        instance: req.url,
        ...problem.extensions,
      });
  });

  // Every route, to tell "no such route" (404) from "not with this method" (405).
  const routes: { method: string; pattern: RegExp }[] = [];
  app.addHook('onRoute', (route) => {
    const pattern = new RegExp(`^${route.url.replace(/:[^/]+/g, '[^/]+')}/?$`);
    for (const method of [route.method].flat()) routes.push({ method, pattern });
  });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0]!;
    const allowed = [...new Set(routes.filter((r) => r.pattern.test(path)).map((r) => r.method))];
    const problem = allowed.length
      ? new HttpProblem(405, 'Method Not Allowed', `${req.method} is not allowed here. Allowed: ${allowed.join(', ')}`)
      : new HttpProblem(404, 'Not Found', `No route ${req.method} ${path}`);
    if (allowed.length) reply.header('allow', allowed.join(', '));
    return reply.status(problem.status).type('application/problem+json').send({
      type: 'about:blank', title: problem.title, status: problem.status, detail: problem.detail, instance: req.url,
    });
  });
}
