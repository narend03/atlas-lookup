#!/usr/bin/env node
'use strict';
/**
 * Ingest atlas_inventory.csv into SQLite.
 *
 * Usage:  npm run ingest                      (reads data/atlas_inventory.csv)
 *         npm run ingest -- path/to/file.csv
 *
 * Duplicate account_number policy: LAST ROW WINS (upsert).
 *   - Within a file, a later row overwrites an earlier one.
 *   - Across uploads, the new file overwrites the stored row.
 * Invalid rows are skipped and reported; valid rows are still committed.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { openDb } = require('./db');
const { normalizeHeader, validateRow } = require('./validate');

const REQUIRED_COLUMNS = ['account_number', 'debtor_name', 'phone_number', 'balance', 'status', 'client_name'];

function ingest(csvPath) {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV not found: ${csvPath}`);
  }

  const rows = parse(fs.readFileSync(csvPath, 'utf8'), {
    columns: (header) => header.map(normalizeHeader),
    bom: true,
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  if (rows.length === 0) {
    throw new Error('CSV has no data rows');
  }

  const present = Object.keys(rows[0]);
  const missingCols = REQUIRED_COLUMNS.filter((c) => !present.includes(c));
  if (missingCols.length) {
    throw new Error(`CSV is missing required column(s): ${missingCols.join(', ')}. Found: ${present.join(', ')}`);
  }

  const db = openDb();
  const upsert = db.prepare(`
    INSERT INTO accounts (account_number, debtor_name, phone_number, balance_cents, status, client_name)
    VALUES (@account_number, @debtor_name, @phone_number, @balance_cents, @status, @client_name)
    ON CONFLICT(account_number) DO UPDATE SET
      debtor_name   = excluded.debtor_name,
      phone_number  = excluded.phone_number,
      balance_cents = excluded.balance_cents,
      status        = excluded.status,
      client_name   = excluded.client_name,
      updated_at    = datetime('now')
  `);

  const summary = { total: rows.length, inserted: 0, updated: 0, skipped: 0, duplicatesInFile: 0, errors: [] };
  const seen = new Set();

  const run = db.transaction(() => {
    rows.forEach((row, i) => {
      const line = i + 2; // +1 for header, +1 for 1-based
      const result = validateRow(row);
      if (!result.ok) {
        summary.skipped++;
        summary.errors.push({ line, account_number: row.account_number || '', errors: result.errors });
        return;
      }
      const key = result.record.account_number.toLowerCase();
      if (seen.has(key)) summary.duplicatesInFile++;
      seen.add(key);

      upsert.run(result.record);
    });
  });

  // Upsert can't tell us insert-vs-update per row, so derive it from the row count delta.
  const before = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  run();
  const after = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  const valid = rows.length - summary.skipped;
  summary.inserted = after - before;
  summary.updated = valid - summary.inserted;
  db.close();
  return summary;
}

if (require.main === module) {
  const csvPath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'atlas_inventory.csv'));
  try {
    const s = ingest(csvPath);
    console.log(`Ingested ${csvPath}`);
    console.log(`  rows in file:        ${s.total}`);
    console.log(`  new accounts:        ${s.inserted}`);
    console.log(`  updated accounts:    ${s.updated}`);
    console.log(`  duplicates in file:  ${s.duplicatesInFile} (last row wins)`);
    console.log(`  skipped (invalid):   ${s.skipped}`);
    for (const e of s.errors) {
      console.log(`    line ${e.line}${e.account_number ? ` (${e.account_number})` : ''}: ${e.errors.join('; ')}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(`Ingest failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { ingest };
