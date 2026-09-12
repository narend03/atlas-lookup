'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Fresh temp dir + DB_PATH for one test file. Returns { dir, csv(name, text) }. */
function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  return {
    dir,
    csv(name, lines) {
      const p = path.join(dir, name);
      fs.writeFileSync(p, Array.isArray(lines) ? lines.join('\n') : lines);
      return p;
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const HEADER = 'account_number,debtor_name,phone_number,balance,status,client_name';

module.exports = { tempEnv, HEADER };
