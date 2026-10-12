# PostgreSQL as the database

The data is relational (users, companies, memberships, cards, transactions, invoices) and the screen needs aggregates (spend per month, transaction count) and consistent reads across several tables. PostgreSQL gives us joins, `SUM`/`COUNT` over an index, `CHECK` constraints that keep invalid states out of the database, and snapshot isolation.

## Considered Options

- **DynamoDB**: scales without tuning and fits a serverless AWS setup, but aggregates and multi-entity reads need precomputed counters or several queries, and access patterns must be fixed up front.
