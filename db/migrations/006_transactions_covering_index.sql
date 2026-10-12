-- migrate: no-transaction
-- The spend sum reads only the index, not the table: amount and status are stored in it.
-- Built CONCURRENTLY so writes to transactions never wait for it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS transactions_card_occurred_cover_idx
  ON transactions (card_id, occurred_at DESC, id DESC) INCLUDE (amount_minor, status);
