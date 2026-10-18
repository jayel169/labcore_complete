const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const TRACKING_ROLES = ['admin', 'scientist', 'receptionist', 'nurse'];
const NEXT_STATUSES = {
  received: ['processing', 'rejected'],
  processing: ['completed', 'rejected'],
  completed: ['dispatched'],
  dispatched: [],
  rejected: []
};
router.use(requireAuth);

function rowToSpecimen(row) {
  return {
    specimenId: row.specimen_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    visitId: row.visit_id,
    tests: row.tests ? JSON.parse(row.tests) : [],
    container: row.container,
    specimenType: row.specimen_type,
    priority: row.priority,
    receivedAt: row.received_at,
    receivedBy: row.received_by,
    labelPrinted: !!row.label_printed,
    labelPrintedAt: row.label_printed_at,
    labelPrintedBy: row.label_printed_by,
    status: row.status || 'received',
    statusAt: row.status_at || row.received_at,
    statusBy: row.status_by || row.received_by
  };
}

router.get('/', async (req, res) => {
  const rows = await db.prepare(`
    SELECT s.*,
      (SELECT e.status FROM specimen_events e WHERE e.specimen_id=s.specimen_id ORDER BY e.at DESC, e.id DESC LIMIT 1) AS status,
      (SELECT e.at FROM specimen_events e WHERE e.specimen_id=s.specimen_id ORDER BY e.at DESC, e.id DESC LIMIT 1) AS status_at,
      (SELECT e.by_name FROM specimen_events e WHERE e.specimen_id=s.specimen_id ORDER BY e.at DESC, e.id DESC LIMIT 1) AS status_by
    FROM specimens s ORDER BY s.received_at DESC LIMIT 500
  `).all();
  res.json(rows.map(rowToSpecimen));
});

router.post('/', requireRole(...TRACKING_ROLES), async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [req.body];
  if (!list.length || list.length > 100 || list.some(s =>
    !s || typeof s.specimenId !== 'string' || !s.specimenId.trim() ||
    (s.tests !== undefined && !Array.isArray(s.tests))
  )) {
    return res.status(400).json({ error: 'invalid_specimen_list' });
  }

  const insert = db.prepare(
    'INSERT INTO specimens (specimen_id, patient_id, patient_name, visit_id, tests, container, ' +
    'specimen_type, priority, received_at, received_by, label_printed) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,0) ' +
    'ON CONFLICT(specimen_id) DO UPDATE SET ' +
    'patient_id=excluded.patient_id, patient_name=excluded.patient_name, ' +
    'visit_id=excluded.visit_id, tests=excluded.tests, container=excluded.container, ' +
    'specimen_type=excluded.specimen_type, priority=excluded.priority, ' +
    'received_at=excluded.received_at, received_by=excluded.received_by'
  );
  const addEvent = db.prepare(
    'INSERT INTO specimen_events (id, specimen_id, status, at, by_name, note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const now = new Date().toISOString();
  let created = 0;

  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const s of list) {
      const specimenId = s.specimenId.trim();
      const existing = await db.prepare('SELECT specimen_id FROM specimens WHERE specimen_id=?').get(specimenId);
      const receivedAt = s.receivedAt || now;
      await insert.run(
        specimenId, s.patientId || null, s.patientName || null, s.visitId || null,
        JSON.stringify(s.tests || []), s.container || null, s.specimenType || null,
        s.priority || 'Routine', receivedAt, req.user.name
      );
      if (!existing) {
        await addEvent.run(uuid(), specimenId, 'received', receivedAt, req.user.name, 'Specimen registered and received');
        created++;
        await writeAudit(req, 'specimen.received', {
          entity: 'specimen', entityId: specimenId, patientId: s.patientId,
          patientName: s.patientName, visitId: s.visitId, specimenId,
          note: (s.specimenType || '') + ' · ' + (s.container || '')
        });
      }
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    console.error('[specimens] save failed:', e);
    return res.status(500).json({ error: 'save_failed', message: e.message });
  }

  res.json({ ok: true, count: list.length, created });
});

router.get('/:id/events', async (req, res) => {
  const exists = await db.prepare('SELECT specimen_id FROM specimens WHERE specimen_id=?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'specimen_not_found' });
  const events = await db.prepare(`
    SELECT status, at, by_name, note FROM specimen_events
    WHERE specimen_id=? ORDER BY at DESC, id DESC
  `).all(req.params.id);
  res.json(events.map(event => ({
    status: event.status, at: event.at, by: event.by_name, note: event.note || ''
  })));
});

router.post('/:id/events', requireRole(...TRACKING_ROLES), async (req, res) => {
  const status = String((req.body || {}).status || '').trim().toLowerCase();
  const note = String((req.body || {}).note || '').trim().slice(0, 1000);
  const specimen = await db.prepare('SELECT * FROM specimens WHERE specimen_id=?').get(req.params.id);
  if (!specimen) return res.status(404).json({ error: 'specimen_not_found' });
  if (!Object.prototype.hasOwnProperty.call(NEXT_STATUSES, status)) {
    return res.status(400).json({ error: 'invalid_specimen_status' });
  }
  const currentEvent = await db.prepare(`
    SELECT status FROM specimen_events WHERE specimen_id=?
    ORDER BY at DESC, id DESC LIMIT 1
  `).get(req.params.id);
  const currentStatus = currentEvent ? currentEvent.status : 'received';
  if (!NEXT_STATUSES[currentStatus] || !NEXT_STATUSES[currentStatus].includes(status)) {
    return res.status(409).json({ error: 'invalid_status_transition', currentStatus, requestedStatus: status });
  }
  if (status === 'rejected' && !note) {
    return res.status(400).json({ error: 'rejection_reason_required' });
  }
  const at = new Date().toISOString();
  await db.prepare(`
    INSERT INTO specimen_events (id, specimen_id, status, at, by_name, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuid(), req.params.id, status, at, req.user.name, note);
  await writeAudit(req, 'specimen.status.changed', {
    entity: 'specimen', entityId: req.params.id, specimenId: req.params.id,
    patientId: specimen.patient_id, patientName: specimen.patient_name, visitId: specimen.visit_id,
    before: { status: currentStatus }, after: { status }, note
  });
  res.status(201).json({ status, at, by: req.user.name, note });
});

router.post('/:id/mark-printed', async (req, res) => {
  const result = await db.prepare(
    'UPDATE specimens SET label_printed=1, label_printed_at=?, label_printed_by=? WHERE specimen_id=?'
  ).run(new Date().toISOString(), req.user.name, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'specimen_not_found' });
  await writeAudit(req, 'label.printed', {
    entity: 'specimen', entityId: req.params.id, specimenId: req.params.id,
    note: 'Marked printed'
  });
  res.json({ ok: true });
});

module.exports = router;
