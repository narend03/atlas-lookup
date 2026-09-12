'use strict';
// Minimal smoke tests: `npm test`. No framework needed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseBalanceCents, normalizePhone, normalizeHeader, validateRow } = require('./validate');

assert.strictEqual(parseBalanceCents('1234.5'), 123450);
assert.strictEqual(parseBalanceCents('$1,234.50'), 123450);
assert.strictEqual(parseBalanceCents('0'), 0);
assert.strictEqual(parseBalanceCents('abc'), null);
assert.strictEqual(parseBalanceCents(''), null);
assert.strictEqual(parseBalanceCents(undefined), null);
assert.strictEqual(parseBalanceCents('-5'), null);
assert.strictEqual(parseBalanceCents('1e5'), null);

assert.strictEqual(normalizePhone('(415) 555-0134'), '+14155550134');
assert.strictEqual(normalizePhone('1-415-555-0134'), '+14155550134');
assert.strictEqual(normalizePhone('+44 20 7946 0958'), '+44 20 7946 0958');
assert.strictEqual(normalizePhone(''), null);

assert.strictEqual(normalizeHeader('Account Number'), 'account_number');
assert.strictEqual(normalizeHeader('accountNumber'), 'account_number');
assert.strictEqual(normalizeHeader('phone-number'), 'phone_number');

const bad = validateRow({ account_number: '', debtor_name: 'X', balance: 'n/a', status: 'Active' });
assert.deepStrictEqual(bad.errors, ['missing account_number', 'invalid balance "n/a"']);

const good = validateRow({ account_number: ' A1 ', debtor_name: 'Jane', phone_number: '4155550134', balance: '10', status: 'active', client_name: 'Acme' });
assert.deepStrictEqual(good.record, { account_number: 'A1', debtor_name: 'Jane', phone_number: '+14155550134', balance_cents: 1000, status: 'Active', client_name: 'Acme' });

// End-to-end ingest against a throwaway DB, including a shifted row (unquoted comma in the name).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
process.env.DB_PATH = path.join(tmp, 't.db');
const { ingest } = require('./ingest');
const csv = path.join(tmp, 'in.csv');
fs.writeFileSync(csv, [
  'Account Number,Debtor Name,Phone Number,Balance,Status,Client Name',
  'A1,Jane Roe,4155550134,"$1,000.00",Active,Acme',
  'A2,Doe, John,4155550135,100,Active,Acme', // 7 columns -> skipped, not ingested with shifted fields
  'A1,Jane Roe,4155550134,900,Active,Acme', // duplicate in file -> last wins
  ',Nobody,4155550136,5,Active,Acme',
  '',
  'A3,Sam Poe,4155550137,twelve,Active,Acme',
].join('\n'));
let s = ingest(csv);
assert.deepStrictEqual(
  { total: s.total, inserted: s.inserted, updated: s.updated, dups: s.duplicatesInFile, skipped: s.skipped.map((e) => e.line) },
  { total: 5, inserted: 1, updated: 0, dups: 1, skipped: [3, 5, 7] },
);
s = ingest(csv); // second upload of the same file: nothing new, A1 overwritten
assert.deepStrictEqual([s.inserted, s.updated], [0, 1]);
const Database = require('better-sqlite3');
assert.deepStrictEqual(new Database(process.env.DB_PATH).prepare('SELECT account_number, balance_cents FROM accounts').all(), [{ account_number: 'A1', balance_cents: 90000 }]);
fs.rmSync(tmp, { recursive: true });

console.log('All tests passed');
