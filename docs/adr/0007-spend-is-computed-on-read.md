# Spend is computed on read, from one snapshot

"Spent" is a `SUM` over the card's transactions in the current spend period, computed on every request, not a stored counter. A counter must be updated correctly on every insert, status change and refund, and drifts silently when one path forgets. With the `(card_id, occurred_at)` index, a month of transactions is cheap to sum.

The overview reads spend, latest transactions and total count in one `REPEATABLE READ` transaction, so the numbers on screen always agree with each other.

## Consequences

If card volume grows to the point where the sum is slow, the next step is a monthly counter maintained by the database, with the `SUM` kept as a reconciliation check.
