'use strict';

const str = (v) => String(v ?? '').trim();

/** "Account Number" / "AccountNumber" / "account-number" -> "account_number". */
const normalizeHeader = (h) =>
  str(h).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase();

/** "$1,234.50" -> 123450. null if not a non-negative number. */
function parseBalanceCents(raw) {
  const cleaned = str(raw).replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** US 10/11-digit numbers -> E.164; anything else kept as typed; blank -> null. */
function normalizePhone(raw) {
  const s = str(raw);
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return s || null;
}

/** "active" / "ACTIVE" -> "Active"; blank -> null. */
function normalizeStatus(raw) {
  const s = str(raw);
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : null;
}

/** Returns { record } when valid, otherwise { errors: [...] }. */
function validateRow(row) {
  const record = {
    account_number: str(row.account_number),
    debtor_name: str(row.debtor_name),
    phone_number: normalizePhone(row.phone_number),
    balance_cents: parseBalanceCents(row.balance),
    status: normalizeStatus(row.status),
    client_name: str(row.client_name) || null,
  };
  const errors = [];
  if (!record.account_number) errors.push('missing account_number');
  if (!record.debtor_name) errors.push('missing debtor_name');
  if (record.balance_cents === null) errors.push(`invalid balance "${str(row.balance)}"`);
  if (!record.status) errors.push('missing status');
  return errors.length ? { errors } : { record };
}

module.exports = { normalizeHeader, parseBalanceCents, normalizePhone, normalizeStatus, validateRow };
