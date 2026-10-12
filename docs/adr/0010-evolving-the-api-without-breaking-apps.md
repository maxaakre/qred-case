# Evolving the API without breaking installed apps

The app is installed on phones, and old versions stay in use for months. So the contract only grows: new optional fields, new endpoints and new error codes are added freely, and the app must ignore fields it does not know and handle enum values it does not know (show a neutral state). CI enforces the rest: `oasdiff` fails any pull request that removes or renames a field, makes a response field optional, or adds a required input.

When a breaking change is truly needed:

1. **Add the new shape next to the old one**: a new field, or for a different screen a new `/v2/...` path for that endpoint only. Both are served.
2. **Deprecate the old one**: `deprecated: true` in the spec, and `Deprecation` and `Sunset` headers (RFC 9745, RFC 8594) on responses that still use it.
3. **Remove it only when the app no longer needs it**: when the minimum supported app version (enforced by a forced update) no longer reads it, confirmed by request logs. Removal is the one change that needs an explicit override of the `oasdiff` check, so it is a deliberate decision.

The version is in the path (`/v1`) and per endpoint, not per release: most changes never need a new version at all.

## Considered Options

- **A new version of the whole API for every breaking change**: simple rules, but every client must move at once and old versions must run side by side for months.
- **Version in a header** (`Accept: application/vnd.qred.v2+json`): cleaner URLs, but harder to see in logs, caches and Swagger, and easy for a client to forget.
- **Never break anything**: the goal, but some changes (a new card model, for example) are cleaner as a new endpoint than as fields bolted onto the old one.
