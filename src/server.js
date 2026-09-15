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
  if (typeof accountNumber === 'number') accountNumber = String(accountNumber);
  if (accountNumber != null && typeof accountNumber !== 'string') {
    return res.status(400).json({ error: 'account_number must be a single string' });
  }
  const key = (accountNumber ?? '').trim();
  if (!key) return res.status(400).json({ error: 'account_number is required' });
  const row = find.get(key);
  if (!row) return res.status(404).json({ error: 'account_not_found', account_number: key });
  res.json(row);
}

const app = express();
app.set('trust proxy', true); // behind Render's TLS terminator, so req.protocol reflects the real scheme
app.use(express.json());
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - t}ms`));
  next();
});

// Optional shared-secret auth: set API_KEY to require `x-api-key` (or Bearer) on everything but /health.
app.use((req, res, next) => {
  const key = process.env.API_KEY;
  if (!key || req.path === '/health') return next();
  const given = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return given === key ? next() : res.status(401).json({ error: 'unauthorized' });
});

app.get('/', (req, res) => res.json({
  service: 'Atlas Recovery account lookup',
  endpoints: ['GET /health', 'GET /accounts/:accountNumber', 'GET /accounts?account_number=...', 'POST /retell/lookup'],
  example: `${req.protocol}://${req.get('host')}/accounts/ATL-1001`,
}));
app.get('/health', (req, res) => res.json({ ok: true, accounts: count.get().n }));
app.get('/accounts/:accountNumber', (req, res) => lookup(req.params.accountNumber, res));
app.get('/accounts', (req, res) => lookup(req.query.account_number, res));
// Retell custom-function webhook: body is { name, args: { account_number } }.
app.post('/retell/lookup', (req, res) => lookup((req.body.args ?? req.body).account_number, res));

app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.type || (status < 500 ? 'bad_request' : 'internal_error') });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Atlas lookup API listening on :${PORT}`));
}

module.exports = app;
