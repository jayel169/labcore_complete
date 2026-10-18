const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { postgresSsl } = require('./db/postgres-ssl');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const {
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');

function requiredConfig() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.AWS_REGION;
  if (!bucket || !region) {
    throw new Error('BACKUP_S3_BUCKET and AWS_REGION are required for remote backups.');
  }
  const prefix = (process.env.BACKUP_S3_PREFIX || 'labcore').replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('BACKUP_S3_PREFIX must be a safe, non-empty object prefix.');
  }
  return { bucket, region, prefix };
}

function configuredDatabasePath() {
  const configuredPath = process.env.DB_PATH;
  return configuredPath
    ? (path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(__dirname, '..', configuredPath))
    : path.join(__dirname, 'db', 'labcore.db');
}

function validateSnapshot(snapshotPath) {
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
  try {
    const result = snapshot.prepare('PRAGMA integrity_check').get();
    if (!result || result.integrity_check !== 'ok') {
      throw new Error('SQLite integrity check failed for the backup snapshot.');
    }
    const requiredTables = ['staff', 'patients', 'encounters', 'orders', 'appointments', 'audit_log'];
    const existing = new Set(snapshot.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map(row => row.name));
    const missing = requiredTables.filter(table => !existing.has(table));
    if (missing.length) {
      throw new Error('Backup snapshot is missing required tables: ' + missing.join(', '));
    }
  } finally {
    snapshot.close();
  }
}

async function createPostgresBackup(config, client) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: postgresSsl()
  });
  let connection;
  try {
    connection = await pool.connect();
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = await connection.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    const required = ['staff', 'patients', 'encounters', 'orders', 'appointments', 'audit_log'];
    const names = tables.rows.map(row => row.table_name);
    const missing = required.filter(name => !names.includes(name));
    if (missing.length) throw new Error('PostgreSQL backup is missing required tables: ' + missing.join(', '));
    const contents = {};
    for (const table of names) {
      const result = await connection.query(`SELECT * FROM public."${table.replace(/"/g, '""')}"`);
      contents[table] = result.rows;
    }
    const sequences = await connection.query(`
      SELECT sequencename, last_value, increment_by
      FROM pg_sequences WHERE schemaname = 'public'
      ORDER BY sequencename
    `);
    await connection.query('COMMIT');
    const bytes = Buffer.from(JSON.stringify({
      format: 'labcore-postgresql-logical-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      tables: contents,
      sequences: sequences.rows
    }));
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const key = config.prefix + '/' + now.toISOString().slice(0, 10) +
      '/labcore-' + stamp + '-' + crypto.randomUUID() + '.json';
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
      Metadata: { 'backup-created-at': now.toISOString(), 'integrity-check': 'ok', 'database-engine': 'postgresql' }
    }));
    return { bucket: config.bucket, key, bytes: bytes.length, createdAt: now.toISOString(), database: 'postgresql' };
  } catch (error) {
    if (connection) await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

async function createAndUploadBackup(options) {
  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw new Error('Production backups require DATABASE_URL; local SQLite data is not uploaded.');
  }
  const config = requiredConfig();
  options = options || {};
  const databasePath = options.databasePath || configuredDatabasePath();
  const client = options.client || new S3Client({
    region: config.region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
  });
  if (process.env.DATABASE_URL) {
    try {
      return await createPostgresBackup(config, client);
    } finally {
      if (!options.client) client.destroy();
    }
  }
  const snapshotPath = path.join(__dirname, 'db', '.backup-snapshot.sqlite');

  try {
    if (!fs.existsSync(databasePath)) {
      throw new Error('Database file does not exist: ' + databasePath);
    }
    try { fs.unlinkSync(snapshotPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const source = new DatabaseSync(databasePath);
    try {
      source.prepare('VACUUM INTO ?').run(snapshotPath);
    } finally {
      source.close();
    }
    validateSnapshot(snapshotPath);

    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const key = config.prefix + '/' + now.toISOString().slice(0, 10) +
      '/labcore-' + stamp + '-' + crypto.randomUUID() + '.sqlite';
    await client.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: fs.createReadStream(snapshotPath),
      ContentLength: fs.statSync(snapshotPath).size,
      ContentType: 'application/vnd.sqlite3',
      ServerSideEncryption: 'AES256',
      Metadata: {
        'backup-created-at': now.toISOString(),
        'integrity-check': 'ok'
      }
    }));
    return { bucket: config.bucket, key, bytes: fs.statSync(snapshotPath).size, createdAt: now.toISOString() };
  } finally {
    if (!options.client) client.destroy();
    try { fs.unlinkSync(snapshotPath); } catch (error) { if (error.code !== 'ENOENT') console.error('[backup] snapshot cleanup failed:', error.message); }
  }
}

if (require.main === module) {
  createAndUploadBackup().then(result => {
    console.log('[backup] verified and uploaded', JSON.stringify(result));
  }).catch(error => {
    console.error('[backup] failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { createAndUploadBackup, configuredDatabasePath, validateSnapshot, createPostgresBackup };
