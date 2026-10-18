// db/seed.js — creates the default admin + a few departments
const db = require('./index');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

async function main() {
await db.ready;
if (db.postgres || process.env.NODE_ENV === 'production') {
  throw new Error('The demo seed is disabled for PostgreSQL and production; use npm run admin:bootstrap.');
}
const now = new Date().toISOString();

// Default admin:  admin@labcore.local  /  PIN 1789
const adminPinHash = bcrypt.hashSync('1789', 10);

const existing = await db.prepare("SELECT id FROM staff WHERE email = ?").get('admin@labcore.local');

if (!existing) {
  await db.prepare(`
    INSERT INTO staff (id, employee_id, name, role, department, email, pin_hash,
                       status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 'seed')
  `).run(
    uuid(),
    'EMP-00001',
    'System Administrator',
    'admin',
    'Administration',
    'admin@labcore.local',
    adminPinHash,
    now
  );
  console.log('✅ Default admin created: admin@labcore.local / PIN 1789');
} else {
  console.log('ℹ️  Admin already exists');
}

// Seed empty settings row
const settingsRow = await db.prepare("SELECT key FROM settings WHERE key = 'facility'").get();
if (!settingsRow) {
  await db.prepare("INSERT INTO settings (key, value) VALUES ('facility', ?)")
    .run(JSON.stringify({
      facilityName: '',
      facilityShort: '',
      currency: 'GHS',
      defaultTatHours: 24,
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      brandPrimary: '#2A2656',
      brandAccent: '#C23B6A'
    }));
  console.log('✅ Default settings seeded');
}

console.log('🎉 Seed complete');
}
main().catch(error => {
  console.error('[seed] failed:', error.message);
  process.exitCode = 1;
}).finally(() => db.close());