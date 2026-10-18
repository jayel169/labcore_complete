const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const databasePath = path.join(os.tmpdir(), `labcore-runtime-${process.pid}.sqlite`);
process.env.DATABASE_URL = '';
process.env.DB_PATH = databasePath;
const db = require('../db');

test('local async SQLite adapter commits and rolls back transactions', async () => {
  try {
    await db.ready;
    const query = db.prepare('SELECT 1 AS value').get();
    assert.equal(typeof query.then, 'function');
    assert.equal((await query).value, 1);

    await db.exec('BEGIN IMMEDIATE');
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('rollback-test', 'discard');
    await db.exec('ROLLBACK');
    assert.equal(
      await db.prepare('SELECT value FROM settings WHERE key = ?').get('rollback-test'),
      undefined
    );

    await db.exec('BEGIN IMMEDIATE');
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('commit-test', 'saved');
    await db.exec('COMMIT');
    assert.equal(
      (await db.prepare('SELECT value FROM settings WHERE key = ?').get('commit-test')).value,
      'saved'
    );
  } finally {
    await db.close();
    for (const suffix of ['', '-shm', '-wal']) {
      try {
        fs.unlinkSync(databasePath + suffix);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
});
