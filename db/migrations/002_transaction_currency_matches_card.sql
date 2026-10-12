-- A transaction is always in its card's billing currency, so spend can be summed
-- without mixing currencies. Enforced by the database, not by every query.
-- Purchases abroad keep their original amount elsewhere (see README, "With more time").
ALTER TABLE cards ADD CONSTRAINT cards_id_currency_key UNIQUE (id, currency);

ALTER TABLE transactions
  ADD CONSTRAINT transactions_card_currency_fkey
  FOREIGN KEY (card_id, currency) REFERENCES cards (id, currency);
