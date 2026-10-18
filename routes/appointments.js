const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const BOOKING_ROLES = ['admin', 'receptionist', 'doctor', 'nurse', 'sonographer', 'radiographer'];
const PROVIDER_ROLES = new Set(['doctor', 'nurse', 'sonographer', 'radiographer']);
const STATUSES = new Set(['Scheduled', 'Confirmed', 'Checked In', 'Completed', 'Cancelled', 'No Show']);
const ACTIVE_STATUSES = ['Scheduled', 'Confirmed', 'Checked In'];

router.use(requireAuth);

function rowToAppointment(row) {
  const data = JSON.parse(row.data_json || '{}');
  return Object.assign({}, data, {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientNumber: row.patient_number,
    patientMobile: row.patient_mobile || '',
    staffId: row.staff_id,
    staffName: row.staff_name,
    staffRole: row.staff_role,
    department: row.department || '',
    appointmentAt: row.appointment_at,
    durationMinutes: row.duration_minutes,
    type: row.type,
    status: row.status,
    reason: row.reason || '',
    notes: row.notes || '',
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at
  });
}

async function getAppointment(id) {
  return await db.prepare(`
    SELECT a.*, p.full_name AS patient_name, p.id AS patient_number, p.mobile AS patient_mobile,
           s.name AS staff_name, s.role AS staff_role, s.department
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN staff s ON s.id = a.staff_id
    WHERE a.id = ?
  `).get(id);
}

function parseInput(body, existing) {
  const p = body || {};
  const appointmentAt = new Date(p.appointmentAt || (existing && existing.appointment_at));
  const durationMinutes = Number(p.durationMinutes ?? (existing && existing.duration_minutes) ?? 30);
  const type = String(p.type ?? (existing && existing.type) ?? 'Consultation').trim();
  const status = String((existing && existing.status) || p.status || 'Scheduled').trim();
  const patientId = String(p.patientId ?? (existing && existing.patient_id) ?? '').trim();
  const staffId = String(p.staffId ?? (existing && existing.staff_id) ?? '').trim();
  const reason = String(p.reason ?? (existing && existing.reason) ?? '').trim();
  const notes = String(p.notes ?? (existing && existing.notes) ?? '').trim();

  if (!patientId || !staffId || !Number.isFinite(appointmentAt.getTime())) {
    return { error: 'patient, clinician and a valid appointment date/time are required' };
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480) {
    return { error: 'duration must be between 5 and 480 minutes' };
  }
  if (!type || type.length > 80 || !STATUSES.has(status)) {
    return { error: 'invalid appointment type or status' };
  }
  if (reason.length > 500 || notes.length > 4000) {
    return { error: 'reason or notes exceed the allowed length' };
  }
  return {
    value: {
      patientId,
      staffId,
      appointmentAt: appointmentAt.toISOString(),
      durationMinutes,
      type,
      status,
      reason,
      notes
    }
  };
}

async function validateReferences(value, res) {
  const patient = await db.prepare(
    "SELECT id, full_name FROM patients WHERE id = ? AND status = 'active'"
  ).get(value.patientId);
  if (!patient) {
    res.status(400).json({ error: 'invalid_patient', message: 'Select an active saved patient.' });
    return null;
  }
  const provider = await db.prepare(
    "SELECT id, name, role FROM staff WHERE id = ? AND status = 'active'"
  ).get(value.staffId);
  if (!provider || !PROVIDER_ROLES.has(provider.role)) {
    res.status(400).json({ error: 'invalid_clinician', message: 'Select an active clinician account.' });
    return null;
  }
  return { patient, provider };
}

async function hasScheduleConflict(value, excludeId) {
  const start = Date.parse(value.appointmentAt);
  const end = start + value.durationMinutes * 60000;
  const appointments = await db.prepare(`
    SELECT id, appointment_at, duration_minutes
    FROM appointments
    WHERE staff_id = ? AND status IN ('Scheduled', 'Confirmed', 'Checked In')
      AND id != ?
  `).all(value.staffId, excludeId || '');
  return appointments.some(item => {
    const existingStart = Date.parse(item.appointment_at);
    const existingEnd = existingStart + Number(item.duration_minutes) * 60000;
    return start < existingEnd && end > existingStart;
  });
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

router.get('/', requireRole(...BOOKING_ROLES), async (req, res) => {
  const params = [];
  const conditions = [];
  const { from, to, status, q, staffId } = req.query;
  if (from) {
    if (!isValidDateOnly(from)) return res.status(400).json({ error: 'invalid_from_date' });
    conditions.push("a.appointment_at >= ?");
    params.push(new Date(from + 'T00:00:00.000Z').toISOString());
  }
  if (to) {
    if (!isValidDateOnly(to)) return res.status(400).json({ error: 'invalid_to_date' });
    conditions.push("a.appointment_at < ?");
    params.push(new Date(new Date(to + 'T00:00:00.000Z').getTime() + 86400000).toISOString());
  }
  if (status) {
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'invalid_status' });
    conditions.push('a.status = ?');
    params.push(status);
  }
  if (staffId) {
    conditions.push('a.staff_id = ?');
    params.push(String(staffId));
  }
  if (q) {
    const term = '%' + String(q).trim().toLowerCase() + '%';
    conditions.push("(LOWER(p.full_name) LIKE ? OR LOWER(p.id) LIKE ? OR LOWER(p.mobile) LIKE ? OR LOWER(s.name) LIKE ?)");
    params.push(term, term, term, term);
  }
  const rows = await db.prepare(`
    SELECT a.*, p.full_name AS patient_name, p.id AS patient_number, p.mobile AS patient_mobile,
           s.name AS staff_name, s.role AS staff_role, s.department
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN staff s ON s.id = a.staff_id
    ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
    ORDER BY a.appointment_at ASC
    LIMIT 1000
  `).all(...params);
  res.json(rows.map(rowToAppointment));
});

router.post('/', requireRole(...BOOKING_ROLES), async (req, res) => {
  const parsed = parseInput(req.body);
  if (parsed.error) return res.status(400).json({ error: 'invalid_appointment', message: parsed.error });
  const refs = await validateReferences(parsed.value, res);
  if (!refs) return;
  const now = new Date().toISOString();
  const id = 'APT-' + uuid().slice(0, 12).toUpperCase();
  const appointment = Object.assign({}, parsed.value, {
    id,
    patientName: refs.patient.full_name,
    staffName: refs.provider.name,
    createdAt: now,
    createdBy: req.user.name,
    updatedAt: now
  });
  await db.exec('BEGIN IMMEDIATE');
  try {
    if (db.postgres) {
      await db.prepare('SELECT id FROM staff WHERE id = ? FOR UPDATE').get(appointment.staffId);
    }
    if (await hasScheduleConflict(parsed.value)) {
      await db.exec('ROLLBACK');
      return res.status(409).json({ error: 'schedule_conflict', message: 'This clinician already has an appointment during that time.' });
    }
    await db.prepare(`
      INSERT INTO appointments
        (id, patient_id, staff_id, appointment_at, duration_minutes, type, status,
         reason, notes, created_at, created_by, updated_at, data_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, appointment.patientId, appointment.staffId, appointment.appointmentAt,
      appointment.durationMinutes, appointment.type, appointment.status,
      appointment.reason, appointment.notes, now, req.user.name, now, JSON.stringify(appointment)
    );
    await writeAudit(req, 'appointment.created', {
      entity: 'appointment', entityId: id, patientId: appointment.patientId,
      patientName: refs.patient.full_name, department: refs.provider.role,
      after: appointment, note: appointment.type
    });
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
  res.status(201).json(rowToAppointment(await getAppointment(id)));
});

router.put('/:id', requireRole(...BOOKING_ROLES), async (req, res) => {
  const existing = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.status === 'Cancelled' || existing.status === 'Completed' || existing.status === 'No Show') {
    return res.status(409).json({ error: 'appointment_closed', message: 'Closed appointments cannot be edited.' });
  }
  const parsed = parseInput(req.body, existing);
  if (parsed.error) return res.status(400).json({ error: 'invalid_appointment', message: parsed.error });
  const refs = await validateReferences(parsed.value, res);
  if (!refs) return;

  const before = rowToAppointment(await getAppointment(existing.id));
  const now = new Date().toISOString();
  const appointment = Object.assign({}, before, parsed.value, { updatedAt: now });
  await db.exec('BEGIN IMMEDIATE');
  try {
    if (db.postgres) {
      await db.prepare('SELECT id FROM staff WHERE id = ? FOR UPDATE').get(appointment.staffId);
    }
    if (await hasScheduleConflict(parsed.value, existing.id)) {
      await db.exec('ROLLBACK');
      return res.status(409).json({ error: 'schedule_conflict', message: 'This clinician already has an appointment during that time.' });
    }
    await db.prepare(`
      UPDATE appointments SET patient_id=?, staff_id=?, appointment_at=?, duration_minutes=?,
        type=?, status=?, reason=?, notes=?, updated_at=?, data_json=? WHERE id=?
    `).run(
      appointment.patientId, appointment.staffId, appointment.appointmentAt,
      appointment.durationMinutes, appointment.type, appointment.status,
      appointment.reason, appointment.notes, now, JSON.stringify(appointment), existing.id
    );
    await writeAudit(req, 'appointment.updated', {
      entity: 'appointment', entityId: existing.id, patientId: appointment.patientId,
      patientName: refs.patient.full_name, before, after: appointment, note: appointment.type
    });
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
  res.json(rowToAppointment(await getAppointment(existing.id)));
});

router.patch('/:id/status', requireRole(...BOOKING_ROLES), async (req, res) => {
  const row = await db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const status = String((req.body || {}).status || '');
  if (!STATUSES.has(status)) return res.status(400).json({ error: 'invalid_status' });
  if (['Cancelled', 'Completed', 'No Show'].includes(row.status)) {
    return res.status(409).json({ error: 'appointment_closed', message: 'Closed appointments cannot be changed.' });
  }
  const transitions = {
    Scheduled: new Set(['Confirmed', 'Checked In', 'Cancelled', 'No Show']),
    Confirmed: new Set(['Checked In', 'Cancelled', 'No Show']),
    'Checked In': new Set(['Completed', 'Cancelled'])
  };
  if (!transitions[row.status] || !transitions[row.status].has(status)) {
    return res.status(409).json({ error: 'invalid_status_transition', message: 'That appointment status change is not allowed.' });
  }
  const before = rowToAppointment(await getAppointment(row.id));
  const now = new Date().toISOString();
  const appointment = Object.assign({}, before, { status, updatedAt: now });
  await db.prepare('UPDATE appointments SET status=?, updated_at=?, data_json=? WHERE id=?')
    .run(status, now, JSON.stringify(appointment), row.id);
  await writeAudit(req, 'appointment.status_changed', {
    entity: 'appointment', entityId: row.id, patientId: row.patient_id,
    patientName: before.patientName, before, after: appointment, note: status
  });
  res.json(rowToAppointment(await getAppointment(row.id)));
});

module.exports = router;
