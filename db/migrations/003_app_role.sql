-- The privileges the app needs at runtime, and nothing more, granted to the role card_api.
-- No password lives in a migration: locally db/init creates card_api itself as the login
-- (so this block skips it); in AWS card_api stays NOLOGIN and infrastructure as code
-- creates a login user in it, with its password in Secrets Manager. The tests do the same
-- (card_api_test IN ROLE card_api). Migrations and the demo seed run as the schema owner.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'card_api') THEN
    CREATE ROLE card_api NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO card_api;
GRANT SELECT ON users, companies, company_members, cards, transactions, invoices TO card_api;

-- Activation is the app's only write, and it touches these three columns.
GRANT UPDATE (status, activated_at, failed_activation_attempts) ON cards TO card_api;
