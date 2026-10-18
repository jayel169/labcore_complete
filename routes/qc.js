const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const LAB_ROLES = ['admin', 'scientist'];
router.use(requireAuth, requireRole(...LAB_ROLES));

function isNumericInput(value) {
  return (typeof value === 'number' || typeof value === 'string') &&
    String(value).trim() !== '' && Number.isFinite(Number(value));
}

function facilityDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function controlDto(row) {
  return {
    id: row.id,
    panel: row.panel,
    test: row.test,
    instrument: row.instrument,
    lot: row.lot,
    level: row.level,
    target: row.target,
    lowerLimit: row.lower_limit,
    upperLimit: row.upper_limit,
    expiresOn: row.expires_on,
    active: !!row.active,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

router.get('/controls', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM qc_controls ORDER BY active DESC, panel, test, instrument, level').all();
  res.json(rows.map(controlDto));
});

router.post('/controls', async (req, res) => {
  const p = req.body || {};
  const panel = String(p.panel || '').trim();
  const test = String(p.test || '').trim();
  const instrument = String(p.instrument || '').trim();
  const lot = String(p.lot || '').trim();
  const level = String(p.level || '').trim();
  if (!isNumericInput(p.target) || !isNumericInput(p.lowerLimit) || !isNumericInput(p.upperLimit)) {
    return res.status(400).json({ error: 'invalid_control', message: 'Target and both QC limits are required.' });
  }
  const target = Number(p.target);
  const lowerLimit = Number(p.lowerLimit);
  const upperLimit = Number(p.upperLimit);
  const expiresOn = p.expiresOn ? String(p.expiresOn) : null;

  if (!panel || !test || !instrument || !lot || !level ||
      !Number.isFinite(target) || !Number.isFinite(lowerLimit) ||
      !Number.isFinite(upperLimit) || lowerLimit >= upperLimit ||
      target < lowerLimit || target > upperLimit) {
    return res.status(400).json({ error: 'invalid_control', message: 'Enter panel, analyte, instrument, lot, level and valid target/limits (lower ≤ target ≤ upper).' });
  }
  if (expiresOn) {
    const expiryDate = new Date(expiresOn + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
        !Number.isFinite(expiryDate.getTime()) ||
        expiryDate.toISOString().slice(0, 10) !== expiresOn) {
      return res.status(400).json({ error: 'invalid_expiry_date' });
    }
  }
  if (expiresOn && expiresOn < facilityDate(new Date())) {
    return res.status(400).json({ error: 'control_expired', message: 'An expired control cannot be activated.' });
  }
  const duplicate = await db.prepare(`
    SELECT id FROM qc_controls
    WHERE active = 1 AND LOWER(panel) = LOWER(?) AND LOWER(test) = LOWER(?)
      AND LOWER(instrument) = LOWER(?) AND LOWER(lot) = LOWER(?) AND LOWER(level) = LOWER(?)
  `).get(panel, test, instrument, lot, level);
  if (duplicate) return res.status(409).json({ error: 'control_exists' });

  const id = uuid();
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO qc_controls
      (id, panel, test, instrument, lot, level, target, lower_limit, upper_limit, expires_on, active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, panel, test, instrument, lot, level, target, lowerLimit, upperLimit, expiresOn, now, req.user.name);
  await writeAudit(req, 'qc.control.created', {
    entity: 'qc_control', entityId: id, panel, test,
    after: { instrument, lot, level, target, lowerLimit, upperLimit, expiresOn }
  });
  res.status(201).json(controlDto(await db.prepare('SELECT * FROM qc_controls WHERE id = ?').get(id)));
});

router.patch('/controls/:id/deactivate', async (req, res) => {
  const control = await db.prepare('SELECT * FROM qc_controls WHERE id = ?').get(req.params.id);
  if (!control) return res.status(404).json({ error: 'control_not_found' });
  if (!control.active) return res.json({ ok: true, alreadyInactive: true });
  await db.prepare('UPDATE qc_controls SET active = 0 WHERE id = ?').run(control.id);
  await writeAudit(req, 'qc.control.deactivated', {
    entity: 'qc_control', entityId: control.id, panel: control.panel, test: control.test,
    before: { active: true }, after: { active: false }
  });
  res.json({ ok: true });
});

router.get('/runs', async (req, res) => {
  const rows = await db.prepare(`
    SELECT r.*, c.panel, c.test, c.instrument, c.lot, c.level
    FROM qc_runs r JOIN qc_controls c ON c.id = r.control_id
    ORDER BY r.run_at DESC, r.id DESC LIMIT 300
  `).all();
  res.json(rows.map(row => ({
    id: row.id,
    controlId: row.control_id,
    panel: row.panel,
    test: row.test,
    instrument: row.instrument,
    lot: row.lot,
    level: row.level,
    value: row.value,
    status: row.status,
    runAt: row.run_at,
    runBy: row.run_by,
    note: row.note || ''
  })));
});

router.post('/runs', async (req, res) => {
  const p = req.body || {};
  if (!isNumericInput(p.value)) {
    return res.status(400).json({ error: 'control_and_numeric_value_required' });
  }
  const value = Number(p.value);
  if (!p.controlId || !Number.isFinite(value)) {
    return res.status(400).json({ error: 'control_and_numeric_value_required' });
  }
  const control = await db.prepare('SELECT * FROM qc_controls WHERE id = ? AND active = 1').get(p.controlId);
  if (!control) return res.status(404).json({ error: 'active_control_not_found' });
  const today = facilityDate(new Date());
  if (control.expires_on && control.expires_on < today) {
    return res.status(409).json({ error: 'control_expired', message: 'Expired controls cannot be recorded.' });
  }
  const status = value >= control.lower_limit && value <= control.upper_limit ? 'Pass' : 'Fail';
  const id = uuid();
  const runAt = new Date().toISOString();
  const note = String(p.note || '').trim().slice(0, 1000);
  await db.prepare(`
    INSERT INTO qc_runs (id, control_id, value, status, run_at, run_by, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, control.id, value, status, runAt, req.user.name, note);
  await writeAudit(req, status === 'Pass' ? 'qc.run.passed' : 'qc.run.failed', {
    entity: 'qc_run', entityId: id, panel: control.panel, test: control.test,
    after: { controlId: control.id, value, status, instrument: control.instrument, lot: control.lot, level: control.level },
    note
  });
  res.status(201).json({
    id, controlId: control.id, panel: control.panel, test: control.test,
    instrument: control.instrument, lot: control.lot, level: control.level,
    value, status, runAt, runBy: req.user.name, note
  });
});

module.exports = router;
