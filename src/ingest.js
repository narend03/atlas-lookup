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

function readUtf8(csvPath) {
  const buf = fs.readFileSync(csvPath);
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) {
    throw new Error('file is UTF-16; re-export it as "CSV UTF-8"');
  }
  const text = buf.toString('utf8');
  if (text.includes('\uFFFD')) throw new Error('file is not valid UTF-8 (names would be garbled); re-export it as "CSV UTF-8"');
  return text;
}

/** Parse a CSV into { headers, rows: [{ record, info }] } with the exact rules ingest uses. */
function readCsv(csvPath) {
  let headers = [];
  const rows = parse(readUtf8(csvPath), {
    columns: (h) => (headers = h.map(normalizeHeader)),
    bom: true,
    trim: true,
    skip_empty_lines: true,
    record_delimiter: ['\r\n', '\n', '\r'], // accept mixed line endings within one file
    relax_column_count: true, // keep going; per-row errors surface in info.error below
    info: true, // gives real line numbers and column-count errors per record
  });
  return { headers, rows };
}

function ingest(csvPath) {
  const { headers, rows } = readCsv(csvPath);
  if (!headers.length) throw new Error('file is empty');
  if (headers.length === 1) throw new Error(`only one column found ("${headers[0]}"); is the file comma-separated?`);
  const dupes = [...new Set(headers.filter((h, i) => headers.indexOf(h) !== i))];
  if (dupes.length) throw new Error(`duplicate column(s): ${dupes.join(', ')}`);
  const missing = REQUIRED.filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`missing required column(s): ${missing.join(', ')} (found: ${headers.join(', ')})`);
  if (!rows.length) throw new Error('no data rows');

  const db = openDb();
  const upsert = db.prepare(UPSERT);
  const count = () => db.prepare('SELECT count(*) AS n FROM accounts').get().n;
  const seen = new Set();
  const skipped = [];

  // Upsert reports 1 change for both insert and update, so derive inserts from the row-count delta.
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

module.exports = { ingest, readCsv };
