# Fastify as the web framework

The spec drives the code (ADR 0001), so the framework must be able to build its routes and validation from `openapi.yaml`. Fastify validates with JSON Schema out of the box, and `fastify-openapi-glue` registers one route per operation, with the spec's own schemas as validation. Nothing about the request shape is written twice.

Other things this service uses that Fastify has built in:

- **`app.inject()`**: a request without opening a port. Every test calls the API this way, and the contract check (`test/contract.ts`) hooks in there, so every response in every test is checked against the spec.
- **Hooks**: `onSend` puts `X-Request-Id` and `Cache-Control: no-store` on every response, errors included; the rate limit runs at `preHandler`, after the token check, so it counts per signed-in user.
- **Logging**: Pino, with the request id on every line, and the `Authorization` header redacted.
- **Errors in async handlers** go straight to one error handler, which turns them into problem+json.

Speed was not the reason. This API waits on the database, not on the framework.

The way of working does not depend on the framework. The contract, the mock, the contract check and the breaking-change check work the same with Express.

## Considered Options

- **Express**: the most widely known, the largest ecosystem, and Express 5 handles errors in async handlers. Contract-first works with `express-openapi-validator`. But validation, logging, request ids and in-process tests (`supertest`) are separate libraries to choose and wire together.
- **NestJS**: structure and dependency injection for a large codebase, but heavy for one screen, and its usual OpenAPI setup (`@nestjs/swagger`) generates the spec from the code, the opposite of contract-first.
- **Hono**: small and fast, built for edge runtimes, but a younger ecosystem for OpenAPI-driven validation on Node.
