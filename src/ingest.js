#!/usr/bin/env node
'use strict';
/**
 * Ingest atlas_inventory.csv into SQLite.
 *
 *   npm run ingest                    reads data/atlas_inventory.csv
 *   npm run ingest -- path/to/file.csv
 *
 * Duplicate account_number: LAST ROW WINS (upsert), within a file and across uploads.
 * Invalid rows are skipped and reported; every valid row is committed in one transaction.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { openDb } = require('./db');
const { normalizeHeader, validateRow } = require('./validate');

const REQUIRED = ['account_number', 'debtor_name', 'phone_number', 'balance', 'status', 'client_name'];

const UPSERT = `
  INSERT INTO accounts (account_number, debtor_name, phone_number, balance_cents, status, client_name)
  VALUES (@account_number, @debtor_name, @phone_number, @balance_cents, @status, @client_name)
  ON CONFLICT (account_number) DO UPDATE SET
    debtor_name = excluded.debtor_name, phone_number = excluded.phone_number,
    balance_cents = excluded.balance_cents, status = excluded.status,
    client_name = excluded.client_name, updated_at = datetime('now')`;

function ingest(csvPath) {
  let headers = [];
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), {
    columns: (h) => (headers = h.map(normalizeHeader)),
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true, // keep going; per-row errors surface in info.error below
    info: true, // gives real line numbers and column-count errors per record
  });

  const missing = REQUIRED.filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`missing required column(s): ${missing.join(', ')} (found: ${headers.join(', ')})`);
  if (!rows.length) throw new Error('no data rows');

  const db = openDb();
  const upsert = db.prepare(UPSERT);
  const count = () => db.prepare('SELECT count(*) AS n FROM accounts').get().n;
  const seen = new Set();
  const skipped = [];

  const before = count();
  db.transaction(() => {
    for (const { record: row, info } of rows) {
      const line = info.lines;
      if (info.error) {
        skipped.push({ line, reason: `expected ${headers.length} columns, got ${info.error.record.length}` });
        continue;
      }
      const { record, errors } = validateRow(row);
      if (errors) {
        skipped.push({ line, account_number: row.account_number, reason: errors.join('; ') });
        continue;
      }
      seen.add(record.account_number.toLowerCase());
      upsert.run(record);
    }
  })();
  const inserted = count() - before;

  return {
    total: rows.length,
    inserted,
    updated: seen.size - inserted,
    duplicatesInFile: rows.length - skipped.length - seen.size,
    skipped,
  };
}

if (require.main === module) {
  const csvPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'atlas_inventory.csv'));
  try {
    const s = ingest(csvPath);
    console.log(`Ingested ${csvPath}
  rows in file:        ${s.total}
  new accounts:        ${s.inserted}
  updated accounts:    ${s.updated}
  duplicates in file:  ${s.duplicatesInFile} (last row wins)
  skipped (invalid):   ${s.skipped.length}`);
    for (const e of s.skipped) console.log(`    line ${e.line}${e.account_number ? ` (${e.account_number})` : ''}: ${e.reason}`);
  } catch (err) {
    console.error(`Ingest failed: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { ingest };
