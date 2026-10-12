import type { FastifyError, FastifyInstance } from 'fastify';

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

export function registerProblemHandlers(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | HttpProblem, req, reply) => {
    let problem: HttpProblem;
    if (err instanceof HttpProblem) {
      problem = err;
    } else if ((err as FastifyError).validation) {
      problem = new HttpProblem(400, 'Bad Request', err.message);
    } else if ((err as FastifyError).statusCode === 401) {
      problem = new HttpProblem(401, 'Unauthorized', 'Missing or invalid bearer token');
    } else if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
      problem = new HttpProblem((err as FastifyError).statusCode!, err.name, err.message);
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

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).type('application/problem+json').send({
      type: 'about:blank', title: 'Not Found', status: 404, instance: req.url,
    }),
  );
}
