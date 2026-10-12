-- Core schema for the card overview screen.
-- Money is stored as integer minor units (öre) to avoid float rounding.

CREATE TABLE users (
  id          uuid PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE companies (
  id          uuid PRIMARY KEY,
  name        text NOT NULL,
  org_number  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- A user can belong to several companies (the dropdown in the view).
-- Membership is also the authorization boundary: no row, no access.
CREATE TABLE company_members (
  user_id     uuid NOT NULL REFERENCES users(id),
  company_id  uuid NOT NULL REFERENCES companies(id),
  role        text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EMPLOYEE')),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX company_members_company_idx ON company_members (company_id);

-- A company can have many cards, each issued to one user.
CREATE TABLE cards (
  id                  uuid PRIMARY KEY,
  company_id          uuid NOT NULL REFERENCES companies(id),
  holder_user_id      uuid NOT NULL REFERENCES users(id),
  last4               char(4) NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  status              text NOT NULL CHECK (status IN ('INACTIVE', 'ACTIVE', 'FROZEN', 'CLOSED')),
  image_url           text NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'SEK',
  -- Limit granted by the lender vs. the limit the user chose ("your set limit").
  credit_limit_minor  bigint NOT NULL CHECK (credit_limit_minor >= 0),
  spend_limit_minor   bigint NOT NULL CHECK (spend_limit_minor >= 0),
  activated_at        timestamptz,
  -- Wrong last4 attempts. Activation is locked at the limit set in code;
  -- support unlocks by resetting this to 0.
  failed_activation_attempts integer NOT NULL DEFAULT 0 CHECK (failed_activation_attempts >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (spend_limit_minor <= credit_limit_minor),
  -- A card lost before activation can be CLOSED without ever being activated.
  CHECK (status <> 'INACTIVE' OR activated_at IS NULL),
  CHECK (status NOT IN ('ACTIVE', 'FROZEN') OR activated_at IS NOT NULL)
);
CREATE INDEX cards_company_holder_idx ON cards (company_id, holder_user_id);

-- Signed amounts: negative = money out (purchase), positive = money in (refund).
CREATE TABLE transactions (
  id            uuid PRIMARY KEY,
  card_id       uuid NOT NULL REFERENCES cards(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor <> 0),
  currency      char(3) NOT NULL,
  merchant      text NOT NULL,
  status        text NOT NULL CHECK (status IN ('PENDING', 'SETTLED', 'DECLINED')),
  occurred_at   timestamptz NOT NULL
);
-- Serves both "latest 3" and cursor pagination (occurred_at, id) in one index.
CREATE INDEX transactions_card_occurred_idx ON transactions (card_id, occurred_at DESC, id DESC);

CREATE TABLE invoices (
  id            uuid PRIMARY KEY,
  company_id    uuid NOT NULL REFERENCES companies(id),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      char(3) NOT NULL,
  due_date      date NOT NULL,
  status        text NOT NULL CHECK (status IN ('UNPAID', 'PAID')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Partial index: we only ever look up open invoices.
CREATE INDEX invoices_company_unpaid_idx ON invoices (company_id, due_date) WHERE status = 'UNPAID';
