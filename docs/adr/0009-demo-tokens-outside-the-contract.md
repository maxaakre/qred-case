# Demo tokens live outside the contract

To try the API from `/docs` without a terminal, `DEMO_MODE=true` adds `POST /demo/token`, which returns a token for a seeded demo user. Demo mode also prefills the demo ids and ready-made activation bodies on `/docs`. None of this is in `openapi.yaml`: it is added to the spec only as the docs page shows it. The contract stays the real API, with no demo data and no endpoint that production must not have.

Demo mode is off by default and only turned on in `docker-compose.yml`. With `NODE_ENV=production`, which the image always sets, it also needs `ALLOW_DEMO_MODE=true`, so one stray `DEMO_MODE` cannot open it in a real deploy; only Compose sets both. The server logs a warning when it is on. If it were turned on by mistake against a real database, the tokens would still see nothing: they are only signed for the demo user ids, and access comes from membership in the database (ADR 0006).

## Considered Options

- **Put the endpoint in `openapi.yaml`**: one source for everything, but the contract would describe an endpoint that must never exist in production, frontend could start depending on it, and demo ids would leak into examples and the mock.
- **Tokens from the terminal only** (`npm run token`): no extra code, but every reviewer has to leave the browser and copy a token by hand.
- **A real login (OIDC with BankID)**: the right answer for production, far beyond the case (README, "With more time").
