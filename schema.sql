-- Debtor accounts uploaded by Atlas Recovery via atlas_inventory.csv.
-- account_number is the natural key: one row per account, case-insensitive.
-- balance is stored in integer cents to avoid floating-point drift on money.
CREATE TABLE IF NOT EXISTS accounts (
  account_number TEXT PRIMARY KEY COLLATE NOCASE,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  balance_cents  INTEGER NOT NULL CHECK (balance_cents >= 0),
  status         TEXT NOT NULL,
  client_name    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The AI agent already looks up by phone; keep that path fast too.
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts (phone_number);
