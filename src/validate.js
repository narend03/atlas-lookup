'use strict';

/**
 * Normalise a raw CSV header into snake_case so "Account Number", "AccountNumber"
 * and "account_number" all map to the same field.
 */
function normalizeHeader(h) {
  return String(h || '')
    .replace(/^﻿/, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s\-]+/g, '_')
    .toLowerCase();
}

/** "$1,234.50" -> 123450 cents. Returns null if not a valid non-negative number. */
function parseBalanceCents(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim().replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isFinite(cents) || cents < 0) return null;
  return cents;
}

/** Keep digits only; format US 10-digit numbers as E.164. Otherwise keep trimmed input. */
function normalizePhone(raw) {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return trimmed;
}

/** Title-case the status so "active", "ACTIVE" and "Active" collapse to one value. */
function normalizeStatus(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Validate one CSV row (already keyed by normalised headers).
 * Returns { ok: true, record } or { ok: false, errors: [...] }.
 */
function validateRow(row) {
  const errors = [];

  const account_number = String(row.account_number || '').trim();
  if (!account_number) errors.push('missing account_number');

  const debtor_name = String(row.debtor_name || '').trim();
  if (!debtor_name) errors.push('missing debtor_name');

  const balance_cents = parseBalanceCents(row.balance);
  if (balance_cents === null) errors.push(`invalid balance "${row.balance ?? ''}"`);

  const status = normalizeStatus(row.status);
  if (!status) errors.push('missing status');

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    record: {
      account_number,
      debtor_name,
      phone_number: normalizePhone(row.phone_number),
      balance_cents,
      status,
      client_name: String(row.client_name || '').trim() || null,
    },
  };
}

module.exports = { normalizeHeader, parseBalanceCents, normalizePhone, normalizeStatus, validateRow };
