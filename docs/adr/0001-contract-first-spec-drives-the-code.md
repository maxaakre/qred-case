# The OpenAPI spec is written first and drives the code

The problem we are solving is that APIs are defined too late, so frontend waits on backend. So `openapi/openapi.yaml` is written and agreed with frontend and product before any backend code exists, and frontend builds against a Prism mock of it from day one.

The spec stays the source of truth after that: Fastify routes and request/response validation are generated from it (`fastify-openapi-glue`), and TypeScript types are generated from it (`openapi-typescript`). Code and contract cannot drift, because the code is built from the contract.

## Considered Options

- **Code-first** (write Fastify schemas, generate the spec): convenient for backend, but the contract only exists once the code does, which is the problem we are trying to fix.
