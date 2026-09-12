'use strict';
// Minimal smoke tests: run with `npm test`. No framework needed.
const assert = require('assert');
const { parseBalanceCents, normalizePhone, validateRow, normalizeHeader } = require('./validate');

assert.strictEqual(parseBalanceCents('1234.5'), 123450);
assert.strictEqual(parseBalanceCents('$1,234.50'), 123450);
assert.strictEqual(parseBalanceCents('0'), 0);
assert.strictEqual(parseBalanceCents('abc'), null);
assert.strictEqual(parseBalanceCents(''), null);
assert.strictEqual(parseBalanceCents('-5'), null);

assert.strictEqual(normalizePhone('(415) 555-0134'), '+14155550134');
assert.strictEqual(normalizePhone('1-415-555-0134'), '+14155550134');
assert.strictEqual(normalizePhone(''), null);

assert.strictEqual(normalizeHeader('Account Number'), 'account_number');
assert.strictEqual(normalizeHeader('accountNumber'), 'account_number');

const bad = validateRow({ account_number: '', debtor_name: 'X', balance: 'n/a', status: 'Active' });
assert.strictEqual(bad.ok, false);
assert.deepStrictEqual(bad.errors, ['missing account_number', 'invalid balance "n/a"']);

const good = validateRow({ account_number: ' A1 ', debtor_name: 'Jane', phone_number: '4155550134', balance: '10', status: 'active', client_name: 'Acme' });
assert.strictEqual(good.ok, true);
assert.strictEqual(good.record.account_number, 'A1');
assert.strictEqual(good.record.status, 'Active');
assert.strictEqual(good.record.balance_cents, 1000);

console.log('All tests passed');
