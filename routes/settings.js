// routes/settings.js
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'facility'").get();
  res.json(row ? JSON.parse(row.value) : {});
});

router.put('/', requireRole('admin'), async (req, res) => {
  const value = JSON.stringify(req.body || {});
  await db.prepare(`
    INSERT INTO settings (key, value) VALUES ('facility', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(value);
  await writeAudit(req, 'settings.updated', { entity: 'facility-settings', note: 'Facility settings saved' });
  res.json({ ok: true });
});

module.exports = router;