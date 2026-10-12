# One screen-shaped endpoint for the card overview

The card overview screen gets everything in one call, `GET /v1/companies/{companyId}/card-overview`, shaped like the screen (Backend-for-Frontend). Mobile clients pay for every round trip, and the screen needs card, spend, transactions, invoice and actions together. Derived values (`remaining`, `canActivateCard`, `activationBlockedReason`) are computed on the server so business rules live in one place and not in each client.

We deliberately do not add generic resource endpoints (`/cards/{id}`, `/invoices`) until another screen needs them.

## Consequences

The endpoint is coupled to this screen. When the screen changes, the endpoint changes with it, which is intended: it is owned together with the screen.
