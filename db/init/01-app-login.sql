-- Local only: the API's database login. It is the card_api role itself, which migration 003
-- grants its privileges to. Postgres runs this once, when the database is first created.
-- In AWS card_api has no login; a login user in that role comes from infrastructure as code.
CREATE ROLE card_api LOGIN PASSWORD 'card_api';
