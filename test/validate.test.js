'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseBalanceCents, normalizePhone, normalizeHeader, normalizeStatus, validateRow } = require('../src/validate');

test('parseBalanceCents accepts money formats and rejects everything else', () => {
  const cases = [
    ['1234.5', 123450], ['$1,234.50', 123450], ['0', 0], [' 10 ', 1000], ['3299.99', 329999],
    ['abc', null], ['', null], [undefined, null], [null, null], ['-5', null], ['1e5', null],
    ['12.', null], ['.5', null], ['1.005', 101], ['12.345', 1235], ['12.344', 1234], ['99999999999999999999', null],
    ['1,234', 123400], ['1,234,567.89', 123456789], ['1.234,56', null], ['1,23', null], ['12,3456', null],
  ];
  for (const [input, expected] of cases) assert.equal(parseBalanceCents(input), expected, `input=${input}`);
});

test('normalizePhone formats US numbers as E.164 and leaves others alone', () => {
  assert.equal(normalizePhone('(415) 555-0134'), '+14155550134');
  assert.equal(normalizePhone('1-415-555-0134'), '+14155550134');
  assert.equal(normalizePhone('+1 650 555 0110'), '+16505550110');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+44 20 7946 0958');
  assert.equal(normalizePhone('ext 123'), 'ext 123');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(undefined), null);
});

test('normalizeHeader maps common spellings to snake_case', () => {
  for (const h of ['account_number', 'Account Number', 'accountNumber', 'ACCOUNT-NUMBER', '  account number  ']) {
    assert.equal(normalizeHeader(h), 'account_number', h);
  }
});

test('normalizeStatus title-cases each word', () => {
  assert.equal(normalizeStatus('active'), 'Active');
  assert.equal(normalizeStatus('ACTIVE'), 'Active');
  assert.equal(normalizeStatus('in COLLECTIONS'), 'In Collections');
  assert.equal(normalizeStatus(''), null);
});

test('validateRow reports every problem on a row at once', () => {
  const { errors } = validateRow({ account_number: '', debtor_name: '', balance: 'n/a', status: '' });
  assert.deepEqual(errors, ['missing account_number', 'missing debtor_name', 'invalid balance "n/a"', 'missing status']);
});

test('validateRow produces a normalised record', () => {
  const { record, errors } = validateRow({
    account_number: ' A1 ', debtor_name: 'Jane', phone_number: '4155550134', balance: '$10', status: 'active', client_name: '',
  });
  assert.equal(errors, undefined);
  assert.deepEqual(record, {
    account_number: 'A1', debtor_name: 'Jane', phone_number: '+14155550134', balance_cents: 1000, status: 'Active', client_name: null,
  });
});
