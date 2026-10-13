import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { parse } from 'yaml';

/**
 * Seam 3: every response the tests see must match openapi/openapi.yaml.
 * Status code, content type and body are all checked against the spec, automatically
 * for every `app.inject` (see `checkEveryResponse`).
 */
const spec = parse(readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'));

/**
 * The spec leaves objects open, so apps can ignore fields added later. The tests are
 * stricter: a response field the spec does not name fails, so a mapper that leaks a
 * column (say `failedActivationAttempts`) cannot pass unnoticed.
 */
function closeObjects(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(closeObjects);
  if (!node || typeof node !== 'object') return;
  const schema = node as Record<string, any>;
  if (Array.isArray(schema.allOf) && schema.allOf.length > 1) {
    // Parts that add up to one object (Problem + attemptsRemaining) are checked as a whole:
    // inline each part open, and close the combination.
    schema.allOf = schema.allOf.map((part: unknown) => structuredClone(resolve(part)));
    schema.unevaluatedProperties = false;
    for (const part of schema.allOf) Object.values(part.properties ?? {}).forEach(closeObjects);
    return;
  }
  if (schema.properties) schema.unevaluatedProperties = false;
  Object.values(schema).forEach(closeObjects);
}

const strictSpec = structuredClone(spec);
closeObjects(strictSpec.paths);
closeObjects(strictSpec.components);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(strictSpec, 'spec');

const escape = (s: string) => s.replaceAll('~', '~0').replaceAll('/', '~1');

function findOperation(operationId: string) {
  for (const [path, methods] of Object.entries<Record<string, { operationId?: string }>>(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.operationId === operationId) return { path, method, op: op as { responses: Record<string, unknown> } };
    }
  }
  throw new Error(`Unknown operationId ${operationId}`);
}

function resolve<T>(node: T): T {
  const ref = (node as { $ref?: string }).$ref;
  if (!ref) return node;
  return ref.slice(2).split('/').reduce((n: any, key) => n[key], spec) as T;
}

export function expectContract(res: LightMyRequestResponse, operationId: string) {
  const { path, method, op } = findOperation(operationId);
  const status = String(res.statusCode);
  expect(Object.keys(op.responses), `${operationId}: status ${status} is not in the spec`).toContain(status);

  const response = resolve(op.responses[status]) as { content?: Record<string, unknown> };
  const contentType = String(res.headers['content-type'] ?? '').split(';')[0]!;
  const declared = Object.keys(response.content ?? {});
  expect(declared, `${operationId} ${status}: content type`).toContain(contentType);

  const responseRef = (op.responses[status] as { $ref?: string }).$ref;
  const pointer = responseRef
    ? `spec${responseRef}/content/${escape(contentType)}/schema`
    : `spec#/paths/${escape(path)}/${method}/responses/${status}/content/${escape(contentType)}/schema`;
  const validate = ajv.getSchema(pointer);
  if (!validate) throw new Error(`No schema at ${pointer}`);
  const body = res.json();
  if (!validate(body)) {
    throw new Error(
      `${operationId} ${status} does not match the contract:\n${ajv.errorsText(validate.errors, { separator: '\n' })}\n${JSON.stringify(body, null, 2)}`,
    );
  }
  return body;
}

/** The operationId for a request, or undefined for routes outside the contract (/docs, demo mode). */
function operationFor(method: string, url: string): string | undefined {
  const { pathname } = new URL(url, 'http://test');
  for (const [path, methods] of Object.entries<Record<string, { operationId?: string }>>(spec.paths)) {
    const template = new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    const op = methods[method.toLowerCase()];
    if (op?.operationId && template.test(pathname)) return op.operationId;
  }
  return undefined;
}

/**
 * Makes every `app.inject` check its response against the contract, so no test can
 * forget to. A response the spec does not allow fails the test that made the request.
 */
export function checkEveryResponse(app: FastifyInstance) {
  const inject = app.inject.bind(app);
  app.inject = (async (opts: InjectOptions) => {
    const res = await inject(opts);
    const operationId = typeof opts.url === 'string' ? operationFor(opts.method ?? 'GET', opts.url) : undefined;
    if (operationId) expectContract(res, operationId);
    return res;
  }) as FastifyInstance['inject'];
}
