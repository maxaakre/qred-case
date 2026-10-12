-- migrate: no-transaction
-- The overview's "holder's newest open card" (findCurrentCard) as one index lookup, no sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS cards_holder_open_idx
  ON cards (company_id, holder_user_id, created_at DESC, id DESC) WHERE status <> 'CLOSED';
