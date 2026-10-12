import type { components, operations } from './generated/api.js';

/** Shapes from openapi/openapi.yaml, so code and contract cannot drift. */
export type Schemas = components['schemas'];

type Op<K extends keyof operations> = operations[K];
export type PathOf<K extends keyof operations> = Op<K>['parameters']['path'];
export type QueryOf<K extends keyof operations> = NonNullable<Op<K>['parameters']['query']>;
export type BodyOf<K extends keyof operations> = Op<K> extends { requestBody: { content: { 'application/json': infer B } } } ? B : never;
