const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { DatabaseSync } = require('node:sqlite');
const {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client
} = require('@aws-sdk/client-s3');

async function verifyLatestBackup(options) {
  options = options || {};
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.AWS_REGION;
  const prefix = (process.env.BACKUP_S3_PREFIX || 'labcore').replace(/^\/+|\/+$/g, '');
  if (!bucket || !region || !prefix || prefix.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Set BACKUP_S3_BUCKET, AWS_REGION, and a safe BACKUP_S3_PREFIX first.');
  }

  const client = options.client || new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true'
  });
  const snapshotPath = path.join(__dirname, 'db', '.restore-check.sqlite');

  try {
    let continuationToken;
    let latest = null;
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix + '/',
        ContinuationToken: continuationToken
      }));
      for (const item of page.Contents || []) {
        if (item.Key && item.LastModified && (!latest || item.LastModified > latest.LastModified)) {
          latest = item;
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    if (!latest) throw new Error('No backups found in s3://' + bucket + '/' + prefix + '/');
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: latest.Key }));
    const body = Buffer.from(await response.Body.transformToByteArray());
    const bytes = body.length;
    let database = 'sqlite';
    if (latest.Key.endsWith('.json')) {
      let backup;
      try { backup = JSON.parse(body.toString('utf8')); }
      catch { throw new Error('Downloaded PostgreSQL backup is not valid JSON.'); }
      const requiredTables = ['staff', 'patients', 'encounters', 'orders', 'appointments', 'audit_log'];
      const missing = requiredTables.filter(table => !Array.isArray(backup.tables && backup.tables[table]));
      if (backup.format !== 'labcore-postgresql-logical-backup' || backup.version !== 1 || missing.length) {
        throw new Error('Downloaded PostgreSQL backup failed format or required-table validation.');
      }
      database = 'postgresql';
    } else {
      fs.writeFileSync(snapshotPath, body, { flag: 'w' });
      const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
      try {
        const result = snapshot.prepare('PRAGMA integrity_check').get();
        if (!result || result.integrity_check !== 'ok') {
          throw new Error('Downloaded backup failed SQLite integrity_check.');
        }
        const requiredTables = ['staff', 'patients', 'encounters', 'orders', 'appointments', 'audit_log'];
        const existing = new Set(snapshot.prepare(
          "SELECT name FROM sqlite_master WHERE type='table'"
        ).all().map(row => row.name));
        const missing = requiredTables.filter(table => !existing.has(table));
        if (missing.length) throw new Error('Backup is missing required tables: ' + missing.join(', '));
      } finally {
        snapshot.close();
      }
    }
    console.log('[backup-verify] downloaded backup passed integrity checks', JSON.stringify({
      bucket,
      key: latest.Key,
      bytes,
      database,
      lastModified: latest.LastModified.toISOString()
    }));
  } finally {
    if (!options.client) client.destroy();
    try { fs.unlinkSync(snapshotPath); } catch (error) { if (error.code !== 'ENOENT') console.error('[backup-verify] cleanup failed:', error.message); }
  }
}

if (require.main === module) {
  verifyLatestBackup().catch(error => {
    console.error('[backup-verify] failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { verifyLatestBackup };
