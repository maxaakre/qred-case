-- Every activation outcome as an append-only row, written in the same statement as the card
-- change it describes. Logs can be dropped or sampled; this trail cannot lose an activation.
CREATE TABLE card_activation_events (
  id          uuid        PRIMARY KEY DEFAULT uuidv7(),
  card_id     uuid        NOT NULL REFERENCES cards (id),
  user_id     uuid        NOT NULL REFERENCES users (id),
  outcome     text        NOT NULL CHECK (outcome IN ('activated', 'wrong_digits', 'locked')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_activation_events_card_idx ON card_activation_events (card_id, occurred_at DESC);

-- The app may add events, never change or remove them.
GRANT INSERT ON card_activation_events TO card_api;

-- The app never reads users (names and e-mails): identity comes from the token (ADR 0006).
REVOKE SELECT ON users FROM card_api;
