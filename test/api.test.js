'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tempEnv } = require('./helpers');

const env = tempEnv();
let server, base;

before(async () => {
  require('../src/ingest').ingest(path.join(__dirname, '..', 'data', 'atlas_inventory.csv'));
  const app = require('../src/server');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); env.cleanup(); });

const get = async (p, headers) => {
  const res = await fetch(base + p, { headers });
  return { status: res.status, body: await res.json() };
};

const expectedAccount = {
  account_number: 'ATL-1005', debtor_name: 'Samuel Okafor', phone_number: '+13105550177',
  balance: 3299.99, status: 'Active', client_name: 'Northwind Lending',
};
const stripTs = ({ updated_at, ...rest }) => rest;

test('GET /accounts/:accountNumber returns the stored record', async () => {
  const { status, body } = await get('/accounts/ATL-1005');
  assert.equal(status, 200);
  assert.deepEqual(stripTs(body), expectedAccount);
  assert.match(body.updated_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('GET /accounts?account_number= is equivalent and case-insensitive', async () => {
  const { status, body } = await get('/accounts?account_number=atl-1005');
  assert.equal(status, 200);
  assert.deepEqual(stripTs(body), expectedAccount);
});

test('every field is JSON-typed correctly', async () => {
  const { body } = await get('/accounts/ATL-1004');
  assert.equal(typeof body.balance, 'number');
  assert.equal(body.balance, 0);
  assert.equal(body.status, 'Closed');
});

test('unknown account -> 404 with a clear body', async () => {
  assert.deepEqual(await get('/accounts/NOPE'), { status: 404, body: { error: 'account_not_found', account_number: 'NOPE' } });
  assert.deepEqual(await get('/accounts?account_number=NOPE'), { status: 404, body: { error: 'account_not_found', account_number: 'NOPE' } });
});

test('blank account number -> 400', async () => {
  assert.equal((await get('/accounts?account_number=')).status, 400);
  assert.equal((await get('/accounts?account_number=%20')).status, 400);
  assert.equal((await get('/accounts')).status, 400);
});

test('non-string account numbers -> 400, never stringified', async () => {
  assert.equal((await get('/accounts?account_number=A&account_number=B')).status, 400);
  assert.equal((await get('/accounts?account_number[x]=A')).status, 400);
  const post = (body) => fetch(base + '/retell/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await post('{"args":{"account_number":["ATL-1001"]}}')).status, 400);
  assert.equal((await post('{"args":{"account_number":{"a":1}}}')).status, 400);
  assert.equal((await post('{"args":{"account_number":1001}}')).status, 404); // numbers are allowed, then not found
});

test('hostile inputs are safe: injection, traversal, bad encoding, oversize', async () => {
  assert.equal((await get("/accounts/'%20OR%201=1--")).status, 404);
  assert.equal((await get('/accounts/..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.deepEqual(await get('/accounts/%E0%A4%A'), { status: 400, body: { error: 'bad_request' } });
  const big = await fetch(base + '/retell/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(200000) }) });
  assert.equal(big.status, 413);
});

test('unknown route -> JSON 404', async () => {
  assert.deepEqual(await get('/nope'), { status: 404, body: { error: 'not_found', path: '/nope' } });
});

test('GET /health reports row count', async () => {
  assert.deepEqual(await get('/health'), { status: 200, body: { ok: true, accounts: 8 } });
});

test('POST /retell/lookup reads args.account_number and tolerates a flat body', async () => {
  const post = async (payload) => {
    const res = await fetch(base + '/retell/lookup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });
    return { status: res.status, body: await res.json() };
  };
  let r = await post(JSON.stringify({ name: 'lookup_account', args: { account_number: 'ATL-1003' } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.debtor_name, 'Wei Chen');
  r = await post(JSON.stringify({ account_number: 'ATL-1003' }));
  assert.equal(r.status, 200);
  r = await post(JSON.stringify({ args: { account_number: 'X' } }));
  assert.equal(r.status, 404);
  r = await post('{not json');
  assert.deepEqual(r, { status: 400, body: { error: 'entity.parse.failed' } });
});

test('API_KEY, when set, gates everything except /health', async () => {
  process.env.API_KEY = 'secret';
  try {
    assert.equal((await get('/accounts/ATL-1001')).status, 401);
    assert.equal((await get('/accounts/ATL-1001', { 'x-api-key': 'wrong' })).status, 401);
    assert.equal((await get('/accounts/ATL-1001', { 'x-api-key': 'secret' })).status, 200);
    assert.equal((await get('/accounts/ATL-1001', { authorization: 'Bearer secret' })).status, 200);
    assert.equal((await get('/health')).status, 200);
  } finally {
    delete process.env.API_KEY;
  }
  assert.equal((await get('/accounts/ATL-1001')).status, 200);
});
