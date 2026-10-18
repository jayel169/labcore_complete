// routes/audit.js
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

/** GET /api/audit  — list newest first. Optional filters: ?from= &to= &by= &event= &q= &limit= */
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { from, to, by, event, q } = req.query;
  const limit = Math.min(Number(req.query.limit) || 2000, 5000);

  const where = [];
  const args = [];
  if (from) { where.push('at >= ?'); args.push(from); }
  if (to)   { where.push('at <= ?'); args.push(to); }
  if (by)   { where.push('by_name = ?'); args.push(by); }
  if (event){ where.push('event = ?'); args.push(event); }
  if (q) {
    where.push(`(LOWER(note) LIKE ? OR LOWER(patient_name) LIKE ? OR LOWER(panel) LIKE ?)`);
    const like = `%${String(q).toLowerCase()}%`;
    args.push(like, like, like);
  }
  const sql = `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY at DESC LIMIT ?`;
  args.push(limit);

  const rows = await db.prepare(sql).all(...args);

  res.json(rows.map(r => ({
    id: r.audit_id,
    event: r.event,
    at: r.at,
    by: r.by_name,
    role: r.role,
    roleLabel: r.role_label,
    entity: r.entity,
    entityId: r.entity_id,
    patientId: r.patient_id,
    patientName: r.patient_name,
    visitId: r.visit_id,
    specimenId: r.specimen_id,
    panel: r.panel,
    test: r.test,
    department: r.department,
    before: r.before_json ? JSON.parse(r.before_json) : null,
    after: r.after_json ? JSON.parse(r.after_json) : null,
    note: r.note,
    durationMs: r.duration_ms
  })));
});

/** POST /api/audit  — the frontend can push an audit event (mirrors lcAudit) */
router.post('/', requireAuth, async (req, res) => {
  const p = req.body || {};
  await writeAudit(req, p.event || 'unknown.event', p);
  res.json({ ok: true });
});

/** GET /api/audit/users — distinct names that have events */
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.prepare('SELECT DISTINCT by_name FROM audit_log WHERE by_name IS NOT NULL ORDER BY by_name').all();
  res.json(rows.map(r => r.by_name));
});

module.exports = router;