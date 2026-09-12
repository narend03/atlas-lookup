'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tempEnv, HEADER } = require('./helpers');

const env = tempEnv();
const { ingest } = require('../src/ingest');
const { openDb } = require('../src/db');
const all = () => openDb().prepare('SELECT * FROM accounts ORDER BY account_number').all();
const reset = () => openDb().exec('DELETE FROM accounts');
after(env.cleanup);

test('sample file loads every row', () => {
  reset();
  const s = ingest(path.join(__dirname, '..', 'data', 'atlas_inventory.csv'));
  assert.deepEqual([s.total, s.inserted, s.updated, s.duplicatesInFile, s.skipped], [8, 8, 0, 0, []]);
  assert.equal(all().length, 8);
});

test('error sample skips exactly the bad rows with line numbers and reasons', () => {
  reset();
  const s = ingest(path.join(__dirname, '..', 'data', 'atlas_inventory_with_errors.csv'));
  assert.deepEqual([s.total, s.inserted, s.updated, s.duplicatesInFile], [7, 2, 0, 1]);
  assert.deepEqual(s.skipped, [
    { line: 3, account_number: '', reason: 'missing account_number' },
    { line: 4, account_number: 'ATL-2001', reason: 'invalid balance "twelve dollars"' },
    { line: 7, account_number: 'ATL-2003', reason: 'missing status' },
    { line: 8, account_number: 'ATL-2004', reason: 'invalid balance "-40"' },
  ]);
  assert.deepEqual(all().map((r) => [r.account_number, r.debtor_name, r.balance_cents]), [
    ['ATL-1001', 'John Doe', 260000],
    ['ATL-2002', 'Dup Row Last', 20000], // last row wins
  ]);
});

test('a row with the wrong number of fields is rejected, not ingested shifted', () => {
  reset();
  const s = ingest(env.csv('shifted.csv', [HEADER, 'A1,Doe, John,4155550134,100,Active,Acme', 'A2,Ok Row,4155550135,100,Active,Acme']));
  assert.deepEqual(s.skipped, [{ line: 2, reason: 'expected 6 columns, got 7' }]);
  assert.deepEqual(all().map((r) => r.account_number), ['A2']);
});

test('quoted commas, CRLF, BOM, header variants and extra columns are all fine', () => {
  reset();
  const text = '﻿Account Number,Debtor Name,Phone Number,Balance,Status,Client Name,Extra\r\n'
    + 'A1,"Doe, John","(415) 555-0134","$1,000.00",active,Acme,ignored\r\n';
  const s = ingest(env.csv('messy.csv', text));
  assert.deepEqual([s.inserted, s.skipped], [1, []]);
  const [r] = all();
  assert.deepEqual([r.debtor_name, r.phone_number, r.balance_cents, r.status], ['Doe, John', '+14155550134', 100000, 'Active']);
});

test('re-uploading overwrites by account number, case-insensitively, and bumps updated_at', () => {
  reset();
  ingest(env.csv('v1.csv', [HEADER, 'ABC-1,Jane,4155550134,100,Active,Acme']));
  const [before] = all();
  openDb().exec("UPDATE accounts SET updated_at = '2000-01-01 00:00:00'");
  const s = ingest(env.csv('v2.csv', [HEADER, 'abc-1,Jane Roe,4155550134,50,Closed,Acme']));
  assert.deepEqual([s.inserted, s.updated], [0, 1]);
  const rows = all();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].debtor_name, rows[0].balance_cents, rows[0].status], ['Jane Roe', 5000, 'Closed']);
  assert.equal(rows[0].created_at, before.created_at);
  assert.notEqual(rows[0].updated_at, '2000-01-01 00:00:00');
});

test('accounts absent from a new file are kept', () => {
  reset();
  ingest(env.csv('a.csv', [HEADER, 'A1,Jane,,100,Active,Acme', 'A2,Joe,,100,Active,Acme']));
  ingest(env.csv('b.csv', [HEADER, 'A2,Joe,,1,Active,Acme']));
  assert.deepEqual(all().map((r) => [r.account_number, r.balance_cents]), [['A1', 10000], ['A2', 100]]);
});

test('a missing required column aborts the whole file and changes nothing', () => {
  reset();
  ingest(env.csv('ok.csv', [HEADER, 'A1,Jane,,100,Active,Acme']));
  assert.throws(() => ingest(env.csv('nobal.csv', ['account_number,debtor_name,status', 'A9,X,Active'])), /missing required column\(s\): phone_number, balance, client_name/);
  assert.deepEqual(all().map((r) => r.account_number), ['A1']);
});

test('mixed line endings in one file do not merge rows', () => {
  reset();
  const s = ingest(env.csv('mixed.csv', HEADER + '\r\nA1,Jane,,1,Active,Acme\nA2,Joe,,2,Active,Acme\r\nA3,Jo,,3,Active,Acme\r'));
  assert.deepEqual([s.inserted, s.skipped], [3, []]);
});

test('file-level problems abort with a specific message and change nothing', () => {
  reset();
  ingest(env.csv('ok.csv', [HEADER, 'A1,Jane,,100,Active,Acme']));
  const bad = [
    ['empty.csv', '', /file is empty/],
    ['header-only.csv', HEADER + '\n', /no data rows/],
    ['semicolon.csv', HEADER.replace(/,/g, ';') + '\nA9;X;;1;Active;Acme', /only one column found.*comma-separated/],
    ['dupcol.csv', HEADER + ',balance\nA9,X,,1,Active,Acme,999', /duplicate column\(s\): balance/],
    ['utf16.csv', Buffer.from('\uFEFF' + HEADER + '\nA9,X,,1,Active,Acme', 'utf16le'), /UTF-16/],
    ['latin1.csv', Buffer.from(HEADER + '\nA9,José,,1,Active,Acme', 'latin1'), /not valid UTF-8/],
    ['badquote.csv', HEADER + '\nA9,"Jane,,1,Active,Acme', /Quote Not Closed/],
  ];
  for (const [name, content, re] of bad) assert.throws(() => ingest(env.csv(name, content)), re, name);
  assert.throws(() => ingest(path.join(env.dir, 'nope.csv')), /ENOENT/);
  assert.deepEqual(all().map((r) => r.account_number), ['A1']);
});

test('100k rows ingest in under 10 seconds', () => {
  reset();
  const lines = [HEADER];
  for (let i = 0; i < 100000; i++) lines.push(`B${i},Name ${i},4155550134,${i}.${i % 100},Active,Acme`);
  const t = Date.now();
  const s = ingest(env.csv('big.csv', lines));
  assert.equal(s.inserted, 100000);
  assert.ok(Date.now() - t < 10000);
});
