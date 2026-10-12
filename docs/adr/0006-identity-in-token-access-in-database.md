# The token says who you are, the database says what you may see

The JWT only carries the user id (`sub`). Company membership and role are looked up in the database on every request. If a user is removed from a company, or their role changes, it takes effect immediately instead of when their token expires. The cost is one indexed lookup per request.

## Considered Options

- **Memberships and roles as token claims**: no lookup, but stale permissions until expiry, and tokens grow with the number of companies.
