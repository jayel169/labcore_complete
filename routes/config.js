// routes/config.js
// Read/write endpoints for panels, reference ranges, and units.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

/* =========================================================
   PANELS
   ========================================================= */

/** GET /api/config/panels — list all */
router.get('/panels', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM panels ORDER BY name ASC').all();
  res.json(rows.map(function (r) {
    try { return JSON.parse(r.data_json); } catch (e) { return { id: r.id, name: r.name, code: r.code }; }
  }));
});

/** PUT /api/config/panels/:id — upsert one */
router.put('/panels/:id', requireRole('admin', 'scientist'), async (req, res) => {
  const id = req.params.id;
  const p = req.body || {};
  if (!p.name) return res.status(400).json({ error: 'name is required' });
  try {
    await db.prepare(
      'INSERT INTO panels (id, name, code, data_json) VALUES (?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, data_json=excluded.data_json'
    ).run(id, p.name, p.code || '', JSON.stringify(p));
    await writeAudit(req, 'panel.saved', { entity: 'panel', entityId: id, note: p.name });
    res.json({ ok: true });
  } catch (e) {
    console.error('[config] panel save failed:', e);
    res.status(500).json({ error: 'save_failed', message: e.message });
  }
});

/** DELETE /api/config/panels/:id */
router.delete('/panels/:id', requireRole('admin', 'scientist'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM panels WHERE id = ?').run(req.params.id);
    await writeAudit(req, 'panel.deleted', { entity: 'panel', entityId: req.params.id, note: 'Deleted' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'delete_failed', message: e.message });
  }
});

/* =========================================================
   REFERENCE RANGES (one blob per panel)
   ========================================================= */

/** GET /api/config/reference-ranges — all panels' ranges in one map */
router.get('/reference-ranges', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM reference_ranges').all();
  const out = {};
  rows.forEach(function (r) {
    try { out[r.panel_id] = JSON.parse(r.data_json); } catch (e) {}
  });
  res.json(out);
});

/** GET /api/config/reference-ranges/:panelId */
router.get('/reference-ranges/:panelId', async (req, res) => {
  const row = await db.prepare('SELECT * FROM reference_ranges WHERE panel_id = ?').get(req.params.panelId);
  if (!row) return res.json({});
  try { res.json(JSON.parse(row.data_json)); }
  catch (e) { res.json({}); }
});

/** PUT /api/config/reference-ranges/:panelId — replace the whole blob */
router.put('/reference-ranges/:panelId', requireRole('admin', 'scientist'), async (req, res) => {
  const panelId = req.params.panelId;
  const data = req.body || {};
  try {
    await db.prepare(
      'INSERT INTO reference_ranges (panel_id, data_json) VALUES (?,?) ' +
      'ON CONFLICT(panel_id) DO UPDATE SET data_json=excluded.data_json'
    ).run(panelId, JSON.stringify(data));
    await writeAudit(req, 'ranges.saved', { entity: 'reference-ranges', entityId: panelId, note: 'Ranges updated' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'save_failed', message: e.message });
  }
});

/* =========================================================
   UNITS
   ========================================================= */

/** GET /api/config/units */
router.get('/units', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM units ORDER BY symbol ASC').all();
  res.json(rows.map(function (r) {
    return { id: r.id, symbol: r.symbol, name: r.name, category: r.category };
  }));
});

/** POST /api/config/units — create */
router.post('/units', requireRole('admin', 'scientist'), async (req, res) => {
  const u = req.body || {};
  if (!u.symbol || !u.name) return res.status(400).json({ error: 'symbol and name required' });
  try {
    const id = u.id || ('unit-' + Date.now().toString(36));
    await db.prepare(
      'INSERT INTO units (id, symbol, name, category) VALUES (?,?,?,?) ' +
      'ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol, name=excluded.name, category=excluded.category'
    ).run(id, u.symbol, u.name, u.category || 'Other');
    await writeAudit(req, 'unit.saved', { entity: 'unit', entityId: id, note: u.symbol });
    res.json({ ok: true, id: id });
  } catch (e) {
    res.status(500).json({ error: 'save_failed', message: e.message });
  }
});

/** DELETE /api/config/units/:id */
router.delete('/units/:id', requireRole('admin', 'scientist'), async (req, res) => {
  try {
    await db.prepare('DELETE FROM units WHERE id = ?').run(req.params.id);
    await writeAudit(req, 'unit.deleted', { entity: 'unit', entityId: req.params.id, note: 'Deleted' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'delete_failed', message: e.message });
  }
});

module.exports = router;