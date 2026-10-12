# Money is an integer in minor units, with currency

All amounts are stored as `bigint` öre and sent as `{ "minor": 540000, "currency": "SEK" }`. Floats cannot represent money exactly, and an amount without its currency is a bug waiting to happen. Formatting ("5 400 kr") is left to the client so it follows the user's locale.

Transaction amounts are signed: negative is a purchase, positive is a refund. This keeps "spent" a single `SUM`.
