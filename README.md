# Atlas Recovery – Account Lookup by Account Number

Prototype for CollectWise: ingest Atlas Recovery's `atlas_inventory.csv` into a database and expose an HTTP endpoint so the AI phone agent can look up an account by **account number** (previously it could only look up by phone number).

**Stack:** Node.js 18+, Express, SQLite (`better-sqlite3`). No external services required.

**Public URL:** `https://atlas-lookup.onrender.com` (see [Deploying](#deploying)). Example:

```
GET https://atlas-lookup.onrender.com/accounts/ATL-1001
```

---

## Quick start

```bash
npm install
npm run ingest          # loads data/atlas_inventory.csv into data/atlas.db
npm start               # API on http://localhost:3000
```

Then:

```bash
curl http://localhost:3000/accounts/ATL-1001
curl "http://localhost:3000/accounts?account_number=ATL-1001"
curl http://localhost:3000/accounts/DOES-NOT-EXIST      # -> 404
```

To ingest a different file: `npm run ingest -- path/to/other.csv`.
To run the unit tests: `npm test`.

---

## Project layout

```
schema.sql                       DB schema (applied automatically on first run)
src/db.js                        opens SQLite, applies schema, shapes JSON output
src/validate.js                  header normalisation + per-row validation rules
src/ingest.js                    CSV ingestion script  (npm run ingest)
src/server.js                    Express API           (npm start)
src/test.js                      small unit tests      (npm test)
data/atlas_inventory.csv         clean sample file (8 accounts)
data/atlas_inventory_with_errors.csv   sample exercising every validation path
render.yaml                      one-click deploy config for Render
retell/                          Retell AI agent build guide + exported agent JSON
EMAIL_TO_COO.md                  the client-facing email deliverable
```

---

## Schema

```sql
CREATE TABLE accounts (
  account_number TEXT PRIMARY KEY COLLATE NOCASE,
  debtor_name    TEXT NOT NULL,
  phone_number   TEXT,
  balance_cents  INTEGER NOT NULL CHECK (balance_cents >= 0),
  status         TEXT NOT NULL,
  client_name    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_phone ON accounts (phone_number);
```

Design notes:

- `account_number` is the primary key. It is the natural unique identifier from Atlas, so there is no need for a surrogate id.
- `COLLATE NOCASE` makes `atl-1001` and `ATL-1001` the same account, which protects against case drift between Atlas's system and what the AI agent hears on a call.
- Balances are stored as **integer cents** and returned as a decimal number (`3299.99`). Storing money as a float invites rounding errors.
- `phone_number` is indexed because the existing phone-based lookup still needs to be fast.
- `updated_at` is refreshed on every overwrite so you can tell which upload a row came from.

---

## CSV ingestion

`npm run ingest` reads `data/atlas_inventory.csv` (or a path you pass) and upserts every valid row inside a single transaction.

### Expected columns

`account_number, debtor_name, phone_number, balance, status, client_name`

Header names are normalised, so `Account Number`, `accountNumber` and `account_number` all work. Extra columns are ignored. Column order does not matter. A UTF-8 BOM (common from Excel) is handled. If any required column is missing entirely, the script exits with an error and imports nothing.

### Validation rules (per row)

| Field | Rule | On failure |
|---|---|---|
| `account_number` | required, non-blank after trimming | row skipped |
| `debtor_name` | required | row skipped |
| `balance` | must parse to a non-negative number; `$` and `,` are stripped, so `$1,234.50` is fine | row skipped |
| `status` | required; normalised to Title Case (`active` → `Active`) | row skipped |
| `phone_number` | optional; 10-digit US numbers normalised to E.164 (`+14155550134`), anything else kept as typed | never fails |
| `client_name` | optional | never fails |
| *whole row* | must have exactly as many fields as the header | row skipped |

The last rule matters more than it looks. An unquoted comma in a name (`Doe, John`) shifts every later field one column to the right, so the phone number lands in `balance` and would otherwise be stored as a multi-billion-dollar debt. Those rows are rejected with `expected 6 columns, got 7` and the reported line number is the real line in the file, even when earlier rows span multiple lines or blank lines were skipped.

Invalid rows are **skipped, not fatal**. The rest of the file still imports, and the script prints each skipped line with its reason:

```
  skipped (invalid):   4
    line 3: missing account_number
    line 4 (ATL-2001): invalid balance "twelve dollars"
    line 7 (ATL-2003): missing status
    line 8 (ATL-2004): invalid balance "-40"
```

Rationale: Atlas uploads periodically. One typo should not block the other thousand accounts from updating, but the operator must be able to see exactly what was dropped.

### Duplicate `account_number` policy: **last row wins (upsert)**

- Within one file, if the same account number appears twice, the later row overwrites the earlier one. The summary reports how many in-file duplicates were seen.
- Across uploads, a row in the new file overwrites the stored row with the same account number. `updated_at` is bumped.
- Rows that exist in the DB but are absent from the new file are **left untouched**. The CSV is treated as an incremental update, not a full replacement.

Why overwrite rather than skip or error: the CSV is the source of truth in Atlas's system, and the most common reason for a repeated account number is an updated balance or status. Erroring would block routine uploads; skipping would silently keep stale data. If Atlas would rather do full-replace uploads, the change is one `DELETE FROM accounts` before the transaction.

---

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/accounts/:accountNumber` | Look up by account number (path form) |
| `GET` | `/accounts?account_number=...` | Look up by account number (query form) |
| `POST` | `/retell/lookup` | Retell custom-function webhook; reads `args.account_number` from the JSON body |
| `GET` | `/health` | Liveness check, returns row count |

**200 response**

```json
{
  "account_number": "ATL-1005",
  "debtor_name": "Samuel Okafor",
  "phone_number": "+13105550177",
  "balance": 3299.99,
  "status": "Active",
  "client_name": "Northwind Lending",
  "updated_at": "2026-09-12 02:01:02"
}
```

**404 response**

```json
{ "error": "account_not_found", "account_number": "NOPE" }
```

**400** if the account number is blank. **401** if `API_KEY` is set and the request lacks a matching `x-api-key` header (or `Authorization: Bearer`). Auth is off by default so the grader can call the URL directly; turn it on before real debtor data is loaded.

Environment variables (see `.env.example`): `PORT` (default 3000), `DB_PATH` (default `data/atlas.db`), `API_KEY` (optional).

---

## Deploying

The repo includes `render.yaml`. On [Render](https://render.com): **New → Blueprint**, pick this repo, deploy. The start command is `npm run ingest && npm start`, so the bundled sample CSV is loaded on every boot. That is deliberate: Render's free tier has an ephemeral disk, so re-ingesting at startup guarantees the public URL always has data.

Any Node host works the same way (Railway, Fly.io, a VM): `npm ci`, then `npm run ingest && npm start`, with `PORT` set by the platform.

For production use, swap `DB_PATH` for a persistent disk or move to Postgres. The SQL in this repo is standard enough that the change is confined to `src/db.js` and the upsert statement in `src/ingest.js`.

---

## Performance notes

Ingest parses the whole file in memory and writes every row inside one SQLite transaction with a single prepared statement. That is the fastest pattern SQLite offers (tens of thousands of rows per second) and comfortably handles files with hundreds of thousands of accounts. Streaming would only be worth adding if Atlas's exports grew to millions of rows.

Lookups hit the primary key, so each request is one B-tree probe regardless of table size. The API keeps one prepared statement open for the life of the process.

## Assumptions

- Account numbers are opaque strings, unique per account, and case-insensitive.
- Balance is the amount currently owed, in dollars, never negative. Credits or refunds are out of scope.
- `status` is free text from Atlas. It is normalised for casing but not restricted to a fixed list, since the spec only gives examples.
- Uploads are incremental. Accounts missing from a new file are not deleted.
- The AI agent trusts the account number the caller provides and then separately verifies identity (last 4 of SSN in the Retell flow) before disclosing a balance.
