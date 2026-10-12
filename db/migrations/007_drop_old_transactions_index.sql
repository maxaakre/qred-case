-- migrate: no-transaction
-- Replaced by transactions_card_occurred_cover_idx (006), which has the same key columns.
DROP INDEX CONCURRENTLY IF EXISTS transactions_card_occurred_idx;
