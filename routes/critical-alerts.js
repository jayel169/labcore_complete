const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const LAB_ROLES = ['admin', 'scientist'];
router.use(requireAuth, requireRole('admin', 'scientist', 'doctor'));

function rowToAlert(row) {
  const ageMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(row.created_at)) / 60000));
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    visitId: row.visit_id,
    specimenId: row.specimen_id,
    panel: row.panel,
    test: row.test,
    value: row.result_value,
    unit: row.result_unit,
    flag: row.result_flag,
    requestingStaffId: row.requesting_staff_id,
    requestingName: row.requesting_name || '',
    createdAt: row.created_at,
    status: row.status,
    ageMinutes,
    overdue: row.status !== 'acknowledged' && ageMinutes >= 15,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    contactedAt: row.contacted_at,
    contactedBy: row.contacted_by,
    contactMethod: row.contact_method,
    contactNote: row.contact_note
  };
}

router.get('/', async (req, res) => {
  const isLab = LAB_ROLES.includes(req.user.role);
  const rows = isLab
    ? await db.prepare('SELECT * FROM critical_alerts ORDER BY CASE status WHEN \'pending\' THEN 0 WHEN \'unassigned\' THEN 1 ELSE 2 END, created_at DESC LIMIT 500').all()
    : await db.prepare('SELECT * FROM critical_alerts WHERE requesting_staff_id=? ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC LIMIT 300').all(req.user.id);
  res.json(rows.map(rowToAlert));
});

router.get('/clinicians', requireRole(...LAB_ROLES), async (req, res) => {
  const clinicians = await db.prepare(
    "SELECT id, name, department FROM staff WHERE role='doctor' AND status='active' ORDER BY name"
  ).all();
  res.json(clinicians);
});

router.post('/:id/assign', requireRole(...LAB_ROLES), async (req, res) => {
  const alert = await db.prepare('SELECT * FROM critical_alerts WHERE id=?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'critical_alert_not_found' });
  if (alert.status === 'acknowledged') return res.status(409).json({ error: 'alert_already_acknowledged' });
  const clinician = await db.prepare(
    "SELECT id, name FROM staff WHERE id=? AND role='doctor' AND status='active'"
  ).get((req.body || {}).staffId);
  if (!clinician) return res.status(400).json({ error: 'active_clinician_required' });
  await db.prepare("UPDATE critical_alerts SET requesting_staff_id=?, requesting_name=?, status='pending' WHERE id=?")
    .run(clinician.id, clinician.name, alert.id);
  await writeAudit(req, 'critical.alert.assigned', {
    entity: 'critical_alert', entityId: alert.id, patientId: alert.patient_id,
    patientName: alert.patient_name, visitId: alert.visit_id, panel: alert.panel, test: alert.test,
    before: { requestingStaffId: alert.requesting_staff_id, status: alert.status },
    after: { requestingStaffId: clinician.id, status: 'pending' },
    note: 'Assigned to ' + clinician.name
  });
  res.json({ ok: true });
});

router.post('/:id/contact', requireRole(...LAB_ROLES), async (req, res) => {
  const alert = await db.prepare('SELECT * FROM critical_alerts WHERE id=?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'critical_alert_not_found' });
  if (alert.status === 'acknowledged') return res.status(409).json({ error: 'alert_already_acknowledged' });
  const method = String((req.body || {}).method || '').trim();
  const note = String((req.body || {}).note || '').trim().slice(0, 1000);
  if (!['phone', 'in_person', 'other'].includes(method) || !note) {
    return res.status(400).json({ error: 'contact_method_and_note_required' });
  }
  const at = new Date().toISOString();
  await db.prepare('UPDATE critical_alerts SET contacted_at=?, contacted_by=?, contact_method=?, contact_note=? WHERE id=?')
    .run(at, req.user.name, method, note, alert.id);
  await writeAudit(req, 'critical.clinician.contacted', {
    entity: 'critical_alert', entityId: alert.id, patientId: alert.patient_id,
    patientName: alert.patient_name, visitId: alert.visit_id,
    panel: alert.panel, test: alert.test,
    after: { contactedAt: at, contactedBy: req.user.name, method, note },
    note: 'Clinician notification recorded; awaiting clinician acknowledgement'
  });
  res.json({ ok: true, contactedAt: at, contactedBy: req.user.name });
});

router.post('/:id/acknowledge', async (req, res) => {
  const alert = await db.prepare('SELECT * FROM critical_alerts WHERE id=?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'critical_alert_not_found' });
  if (req.user.role !== 'doctor' || req.user.id !== alert.requesting_staff_id) {
    return res.status(403).json({ error: 'only_the_requesting_clinician_can_acknowledge' });
  }
  if (alert.status === 'acknowledged') return res.status(409).json({ error: 'alert_already_acknowledged' });
  const at = new Date().toISOString();
  const note = String((req.body || {}).note || '').trim().slice(0, 1000);
  await db.prepare("UPDATE critical_alerts SET status='acknowledged', acknowledged_at=?, acknowledged_by=? WHERE id=?")
    .run(at, req.user.name, alert.id);
  await writeAudit(req, 'critical.alert.acknowledged', {
    entity: 'critical_alert', entityId: alert.id, patientId: alert.patient_id,
    patientName: alert.patient_name, visitId: alert.visit_id,
    specimenId: alert.specimen_id, panel: alert.panel, test: alert.test,
    before: { status: alert.status },
    after: { status: 'acknowledged', acknowledgedAt: at, acknowledgedBy: req.user.name },
    note
  });
  res.json({ ok: true, status: 'acknowledged', acknowledgedAt: at, acknowledgedBy: req.user.name });
});

module.exports = router;
