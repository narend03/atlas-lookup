'use strict';
const express = require('express');
const { openDb, toAccountJson } = require('./db');

const app = express();
app.use(express.json());

const db = openDb();
const findByAccount = db.prepare('SELECT * FROM accounts WHERE account_number = ?');

// Optional shared-secret auth. Set API_KEY in the environment to enable.
app.use((req, res, next) => {
  const required = process.env.API_KEY;
  if (!required || req.path === '/health') return next();
  const supplied = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (supplied !== required) return res.status(401).json({ error: 'unauthorized' });
  next();
});

function lookup(accountNumber, res) {
  const key = String(accountNumber || '').trim();
  if (!key) {
    return res.status(400).json({ error: 'account_number is required' });
  }
  const row = findByAccount.get(key);
  if (!row) {
    return res.status(404).json({ error: 'account_not_found', account_number: key });
  }
  return res.json(toAccountJson(row));
}

app.get('/health', (req, res) => {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM accounts').get();
  res.json({ ok: true, accounts: n });
});

// GET /accounts/:accountNumber
app.get('/accounts/:accountNumber', (req, res) => lookup(req.params.accountNumber, res));

// GET /accounts?account_number=...
app.get('/accounts', (req, res) => {
  if (req.query.account_number === undefined) {
    return res.status(400).json({ error: 'account_number query parameter is required' });
  }
  lookup(req.query.account_number, res);
});

// Retell "custom function" webhook: Retell POSTs { name, args: { account_number } }.
app.post('/retell/lookup', (req, res) => {
  const args = (req.body && req.body.args) || req.body || {};
  lookup(args.account_number, res);
});

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Atlas lookup API listening on :${PORT}`));
