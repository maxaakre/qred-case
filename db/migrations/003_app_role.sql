-- The privileges the app needs at runtime, and nothing more. They are granted to a role
-- without login; each environment creates the login user in this role (docker-compose
-- locally, infrastructure as code and Secrets Manager in AWS), so no password lives in
-- a migration. Migrations and the demo seed run as the schema owner.

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
