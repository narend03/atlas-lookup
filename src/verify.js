#!/usr/bin/env node
'use strict';
/**
 * Black-box verification of a RUNNING lookup service against the CSV as source of truth.
 *
 *   npm run verify                                   -> http://localhost:3000, data/atlas_inventory.csv
 *   npm run verify -- https://atlas-lookup.onrender.com
 *   npm run verify -- <base-url> path/to/file.csv
 *
 * Exits 1 on any mismatch. No LLM, no eyeballing: every field is compared to what
 * the ingest rules say the API must return for that CSV row.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { normalizeHeader, validateRow } = require('./validate');

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const csvPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'atlas_inventory.csv'));
const headers = { ...(process.env.API_KEY ? { 'x-api-key': process.env.API_KEY } : {}) };

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n      ${detail}`}`);
  if (!ok) failures++;
};
const get = async (p) => {
  const res = await fetch(base + p, { headers });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

(async () => {
  console.log(`Verifying ${base} against ${csvPath}\n`);

  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: (h) => h.map(normalizeHeader), bom: true, trim: true, skip_empty_lines: true });
  const expected = new Map();
  for (const row of rows) {
    const { record } = validateRow(row);
    if (record) expected.set(record.account_number.toLowerCase(), record); // last row wins, like ingest
  }

  const health = await get('/health');
  check(health.status === 200 && health.body.ok === true, 'GET /health is 200 and ok', JSON.stringify(health));
  check(health.body.accounts >= expected.size, `service holds at least ${expected.size} accounts`, `reported ${health.body.accounts}`);

  for (const rec of expected.values()) {
    const want = {
      account_number: rec.account_number, debtor_name: rec.debtor_name, phone_number: rec.phone_number,
      balance: rec.balance_cents / 100, status: rec.status, client_name: rec.client_name,
    };
    for (const p of [`/accounts/${encodeURIComponent(rec.account_number)}`, `/accounts?account_number=${encodeURIComponent(rec.account_number)}`]) {
      const { status, body } = await get(p);
      const got = body && typeof body === 'object' ? Object.fromEntries(Object.keys(want).map((k) => [k, body[k]])) : body;
      const same = status === 200 && JSON.stringify(got) === JSON.stringify(want);
      check(same, `GET ${p}`, same ? '' : `status ${status}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    }
  }

  const nope = await get('/accounts/__does_not_exist__');
  check(nope.status === 404 && nope.body.error === 'account_not_found', 'unknown account -> 404 account_not_found', JSON.stringify(nope));
  const blank = await get('/accounts?account_number=');
  check(blank.status === 400, 'blank account number -> 400', JSON.stringify(blank));
  const route = await get('/definitely/not/a/route');
  check(route.status === 404 && route.body.error === 'not_found', 'unknown route -> JSON 404', JSON.stringify(route));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures ? 1 : 0;
})().catch((err) => {
  console.error(`verify aborted: ${err.message}`);
  process.exitCode = 2;
});
