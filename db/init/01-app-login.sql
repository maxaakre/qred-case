-- Local only: the API's database login, in the card_api role that migration 003 grants
-- its privileges to. Postgres runs this once, when the database is first created.
-- In AWS this user and its password come from infrastructure as code and Secrets Manager.
CREATE ROLE card_api LOGIN PASSWORD 'card_api';
