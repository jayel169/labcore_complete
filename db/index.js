const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { convertPlaceholders, convertNamedPlaceholders, postgresSchema } = require('./sql');
const { postgresSsl } = require('./postgres-ssl');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const storage = new AsyncLocalStorage();
const postgres = Boolean(process.env.DATABASE_URL);
let sqlite;
let pool;

function pgQuery(sql, params) {
  const context = storage.getStore();
  return (context && context.client ? context.client : pool).query(convertPlaceholders(sql), params);
}

async function initializePostgres() {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSsl(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  pool.on('error', error => console.error('[db] unexpected PostgreSQL pool error:', error.message));
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = postgresSchema(fs.readFileSync(schemaPath, 'utf8'));
  await pool.query(`
    CREATE TABLE IF NOT EXISTS labcore_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  await pool.query(schema);
  await pool.query('ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_hash TEXT');
  await pool.query('ALTER TABLE staff ADD COLUMN IF NOT EXISTS totp_secret TEXT');
  await pool.query('ALTER TABLE staff ADD COLUMN IF NOT EXISTS totp_enabled INTEGER NOT NULL DEFAULT 0');
  await pool.query('ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_totp_step INTEGER');
  await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS requested_by_staff_id TEXT');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_tat_targets_panel_lower ON tat_targets (LOWER(panel))');
  await pool.query(`
    INSERT INTO specimen_events (id, specimen_id, status, at, by_name, note)
    SELECT 'legacy-received-' || md5(random()::text || clock_timestamp()::text),
      s.specimen_id, 'received',
      COALESCE(s.received_at, to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      COALESCE(s.received_by, 'Legacy record'), 'Initial status imported from specimen record'
    FROM specimens s
    WHERE NOT EXISTS (SELECT 1 FROM specimen_events e WHERE e.specimen_id = s.specimen_id)
  `);
  await pool.query(`
    INSERT INTO labcore_schema_migrations (version, applied_at)
    VALUES (1, $1) ON CONFLICT (version) DO NOTHING
  `, [new Date().toISOString()]);
  await pool.query('SELECT 1');
}

if (!postgres) {
  const { DatabaseSync } = require('node:sqlite');
  const configuredDbPath = process.env.DB_PATH;
  const dbPath = configuredDbPath
    ? (path.isAbsolute(configuredDbPath) ? configuredDbPath : path.resolve(__dirname, '..', configuredDbPath))
    : path.join(__dirname, 'labcore.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const staffColumns = new Set(sqlite.prepare('PRAGMA table_info(staff)').all().map(column => column.name));
  [
    ['password_hash', 'TEXT'],
    ['totp_secret', 'TEXT'],
    ['totp_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_totp_step', 'INTEGER']
  ].forEach(([name, type]) => {
    if (!staffColumns.has(name)) sqlite.exec(`ALTER TABLE staff ADD COLUMN ${name} ${type}`);
  });
  const orderColumns = new Set(sqlite.prepare('PRAGMA table_info(orders)').all().map(column => column.name));
  if (!orderColumns.has('requested_by_staff_id')) {
    sqlite.exec('ALTER TABLE orders ADD COLUMN requested_by_staff_id TEXT');
  }
}

function prepare(sql) {
  if (postgres) {
    async function execute(method, params) {
      const named = params.length === 1 && params[0] && typeof params[0] === 'object' &&
        !Array.isArray(params[0]) && /@[A-Za-z_]\w*/.test(sql);
      const query = named ? convertNamedPlaceholders(sql, params[0]) : {
        sql: convertPlaceholders(sql),
        params
      };
      const result = await pgQuery(query.sql, query.params);
      if (method === 'run') {
        return { changes: result.rowCount, lastInsertRowid: result.rows[0] && result.rows[0].id };
      }
      if (method === 'get') return result.rows[0];
      return result.rows;
    }
    return {
      run: async (...params) => execute('run', params),
      get: async (...params) => execute('get', params),
      all: async (...params) => execute('all', params)
    };
  }
  const stmt = sqlite.prepare(sql);
  return {
    run: async (...params) => stmt.run(...params),
    get: async (...params) => stmt.get(...params),
    all: async (...params) => stmt.all(...params)
  };
}

async function exec(sql) {
  if (!postgres) return sqlite.exec(sql);
  let context = storage.getStore();
  if (!context) {
    context = { client: null };
    storage.enterWith(context);
  }
  if (/^\s*BEGIN(?:\s|;|$)/i.test(sql)) {
    if (context.client) throw new Error('Nested transactions are not supported.');
    context.client = await pool.connect();
    try {
      await context.client.query('BEGIN');
    } catch (error) {
      context.client.release();
      context.client = null;
      throw error;
    }
    return;
  }
  if (/^\s*(COMMIT|ROLLBACK)\b/i.test(sql)) {
    if (!context.client) {
      if (/^\s*ROLLBACK\b/i.test(sql)) return;
      throw new Error('No active transaction.');
    }
    const client = context.client;
    try {
      await client.query(/^\s*COMMIT\b/i.test(sql) ? 'COMMIT' : 'ROLLBACK');
    } finally {
      context.client = null;
      client.release();
    }
    return;
  }
  return pgQuery(sql, []);
}

function requestContext(req, res, next) {
  storage.run({ client: null }, next);
}

const ready = postgres ? initializePostgres() : Promise.resolve();

module.exports = {
  prepare,
  exec,
  query: (sql, params = []) => pgQuery(sql, params),
  ready,
  postgres,
  requestContext,
  close: async () => {
    if (pool) await pool.end();
    if (sqlite) sqlite.close();
  }
};
