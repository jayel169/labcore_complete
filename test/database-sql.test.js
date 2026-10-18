const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { convertPlaceholders, convertNamedPlaceholders, postgresSchema } = require('../db/sql');

test('converts SQLite positional placeholders without rewriting quoted question marks', () => {
  assert.equal(
    convertPlaceholders("SELECT ?, '?' AS literal, \"?\" AS quoted, ? -- ?"),
    "SELECT $1, '?' AS literal, \"?\" AS quoted, $2 -- ?"
  );
});

test('converts SQLite named parameters to PostgreSQL parameters', () => {
  const result = convertNamedPlaceholders(
    "INSERT INTO patients (id, name, note) VALUES (@id, @name, '@ignored') -- @comment\n" +
      "ON CONFLICT(id) DO UPDATE SET name=@name /* @ignored */",
    { id: 'p-1', name: 'Patient' }
  );
  assert.deepEqual(result, {
    sql: "INSERT INTO patients (id, name, note) VALUES ($1, $2, '@ignored') -- @comment\n" +
      "ON CONFLICT(id) DO UPDATE SET name=$2 /* @ignored */",
    params: ['p-1', 'Patient']
  });
});

test('rejects a missing named parameter rather than sending malformed SQL', () => {
  assert.throws(
    () => convertNamedPlaceholders('SELECT @missing', {}),
    /Missing value for named SQL parameter: missing/
  );
});

test('converts the production schema to PostgreSQL-compatible DDL', () => {
  const schema = postgresSchema(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  assert.match(schema, /BIGSERIAL PRIMARY KEY/);
  assert.doesNotMatch(schema, /^\s*PRAGMA\b/m);
  assert.doesNotMatch(schema, /\browid\b|\brandomblob\s*\(|\bstrftime\s*\(/i);
  assert.doesNotMatch(schema, /COLLATE\s+NOCASE/i);
  assert.doesNotMatch(schema, /INSERT INTO specimen_events/i);
  assert.match(schema, /amount\s+DOUBLE PRECISION/i);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS billing_payments/i);
});
