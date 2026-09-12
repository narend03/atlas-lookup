'use strict';
const express = require('express');
const { openDb } = require('./db');

const db = openDb();
const find = db.prepare(`
  SELECT account_number, debtor_name, phone_number, balance_cents / 100.0 AS balance,
         status, client_name, updated_at
  FROM accounts WHERE account_number = ?`);
const count = db.prepare('SELECT count(*) AS n FROM accounts');

function lookup(accountNumber, res) {
  const key = String(accountNumber ?? '').trim();
  if (!key) return res.status(400).json({ error: 'account_number is required' });
  const row = find.get(key);
  if (!row) return res.status(404).json({ error: 'account_not_found', account_number: key });
  res.json(row);
}

const app = express();
app.use(express.json());

// Optional shared-secret auth: set API_KEY to require `x-api-key` (or Bearer) on everything but /health.
app.use((req, res, next) => {
  const key = process.env.API_KEY;
  if (!key || req.path === '/health') return next();
  const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return given === key ? next() : res.status(401).json({ error: 'unauthorized' });
});

app.get('/health', (req, res) => res.json({ ok: true, accounts: count.get().n }));
app.get('/accounts/:accountNumber', (req, res) => lookup(req.params.accountNumber, res));
app.get('/accounts', (req, res) => lookup(req.query.account_number, res));
// Retell custom-function webhook: body is { name, args: { account_number } }.
app.post('/retell/lookup', (req, res) => lookup((req.body.args ?? req.body).account_number, res));

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.type || 'internal_error' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Atlas lookup API listening on :${PORT}`));
