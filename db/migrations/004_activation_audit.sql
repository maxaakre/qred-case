-- When the last wrong activation attempt happened. With the attempt counter it tells
-- support and fraud monitoring whether a lockout was a slow typo or a burst of guesses.
ALTER TABLE cards ADD COLUMN last_failed_activation_at timestamptz;

GRANT UPDATE (last_failed_activation_at) ON cards TO card_api;
