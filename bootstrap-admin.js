const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
if (!process.env.DATABASE_URL) {
  throw new Error('Administrator bootstrap is restricted to an explicitly configured PostgreSQL database.');
}
const db = require('./db');

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const name = String(process.env.ADMIN_NAME || '').trim();
const pin = String(process.env.ADMIN_PIN || '');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error('Set ADMIN_EMAIL to the initial administrator email address.');
}
if (!name) throw new Error('Set ADMIN_NAME to the initial administrator name.');
if (!/^\d{4}$/.test(pin)) {
  throw new Error('Set ADMIN_PIN to a private 4-digit PIN; do not use the demo PIN.');
}
async function main() {
  await db.ready;
  if (await db.prepare('SELECT id FROM staff LIMIT 1').get()) {
    throw new Error('Staff accounts already exist; bootstrap is only allowed on an empty database.');
  }
  const id = uuid();
  const now = new Date().toISOString();
  await db.exec('BEGIN');
  try {
    await db.prepare(`
      INSERT INTO staff
        (id, employee_id, name, role, department, email, pin_hash, status, created_at, created_by)
      VALUES (?, 'EMP-00001', ?, 'admin', 'Administration', ?, ?, 'active', ?, 'deployment bootstrap')
    `).run(id, name, email, bcrypt.hashSync(pin, 12), now);
    await db.prepare(`
      INSERT INTO audit_log
        (audit_id, event, at, by_name, role, role_label, entity, entity_id, note)
      VALUES (?, 'staff.created', ?, ?, 'admin', 'Administrator', 'staff', ?, 'Initial production administrator provisioned')
    `).run(uuid(), now, name, id);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
  console.log('Initial administrator created:', email);
  console.log('Remove ADMIN_EMAIL, ADMIN_NAME, and ADMIN_PIN from the process environment now.');
}
main().catch(error => {
  console.error('[bootstrap] failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.close());
