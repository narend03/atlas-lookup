'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'atlas.db');
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

/** Open (creating if needed) the SQLite database and apply schema.sql. */
function openDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/** Shape a DB row into the JSON the AI agent expects. */
function toAccountJson(row) {
  return {
    account_number: row.account_number,
    debtor_name: row.debtor_name,
    phone_number: row.phone_number,
    balance: row.balance_cents / 100,
    status: row.status,
    client_name: row.client_name,
    updated_at: row.updated_at,
  };
}

module.exports = { openDb, toAccountJson, DB_PATH };
