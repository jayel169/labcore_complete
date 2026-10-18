// routes/patients.js
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

function rowToPatient(row) {
  if (!row) return null;
  const base = row.data_json ? JSON.parse(row.data_json) : {};
  return Object.assign({}, base, {
    id: row.id,
    fullName: row.full_name,
    preferredName: row.preferred_name || base.preferredName,
    dob: row.dob,
    sex: row.sex,
    nationalId: row.national_id,
    mobile: row.mobile,
    email: row.email,
    address: row.address,
    emgName: row.emg_name,
    emgRelation: row.emg_relation,
    emgMobile: row.emg_mobile,
    altPhone: row.alt_phone,
    allergies: row.allergies,
    chronic: row.chronic,
    bloodGroup: row.blood_group,
    paymentType: row.payment_type,
    insName: row.ins_name,
    insNumber: row.ins_number,
    status: row.status,
    mergedInto: row.merged_into,
    encounters: base.encounters || [],
    admission: base.admission || null
  });
}

/** GET /api/patients  — list all (or search with ?q=) */
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  let rows;
  if (q) {
    rows = await db.prepare(
      "SELECT * FROM patients " +
      "WHERE status != 'merged' AND (" +
      "  LOWER(full_name) LIKE ? OR LOWER(id) LIKE ? OR LOWER(mobile) LIKE ?" +
      ") " +
      "ORDER BY updated_at DESC LIMIT 500"
    ).all('%' + q + '%', '%' + q + '%', '%' + q + '%');
  } else {
    rows = await db.prepare(
      "SELECT * FROM patients WHERE status != 'merged' ORDER BY updated_at DESC LIMIT 500"
    ).all();
  }
  res.json(rows.map(rowToPatient));
});

/** GET /api/patients/:id */
router.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(rowToPatient(row));
});

/**
 * POST /api/patients  — upsert one or many patients.
 * Body: a single patient object OR { patients: [ ... ] }
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.patients) ? body.patients : [body];

  const now = new Date().toISOString();

  const insertPatient = db.prepare(
    "INSERT INTO patients (id, full_name, preferred_name, dob, sex, national_id, mobile, email, " +
    "                      address, emg_name, emg_relation, emg_mobile, alt_phone, allergies, " +
    "                      chronic, blood_group, payment_type, ins_name, ins_number, status, " +
    "                      merged_into, merged_at, merged_by, created_at, updated_at, data_json) " +
    "VALUES (@id, @full_name, @preferred_name, @dob, @sex, @national_id, @mobile, @email, " +
    "        @address, @emg_name, @emg_relation, @emg_mobile, @alt_phone, @allergies, " +
    "        @chronic, @blood_group, @payment_type, @ins_name, @ins_number, @status, " +
    "        @merged_into, @merged_at, @merged_by, @created_at, @updated_at, @data_json) " +
    "ON CONFLICT(id) DO UPDATE SET " +
    "  full_name=excluded.full_name, preferred_name=excluded.preferred_name, " +
    "  dob=excluded.dob, sex=excluded.sex, national_id=excluded.national_id, " +
    "  mobile=excluded.mobile, email=excluded.email, address=excluded.address, " +
    "  emg_name=excluded.emg_name, emg_relation=excluded.emg_relation, " +
    "  emg_mobile=excluded.emg_mobile, alt_phone=excluded.alt_phone, " +
    "  allergies=excluded.allergies, chronic=excluded.chronic, " +
    "  blood_group=excluded.blood_group, payment_type=excluded.payment_type, " +
    "  ins_name=excluded.ins_name, ins_number=excluded.ins_number, " +
    "  status=excluded.status, merged_into=excluded.merged_into, " +
    "  merged_at=excluded.merged_at, merged_by=excluded.merged_by, " +
    "  updated_at=excluded.updated_at, data_json=excluded.data_json"
  );

  const deleteEncounters = db.prepare('DELETE FROM encounters WHERE patient_id = ?');
  const deleteOrders     = db.prepare('DELETE FROM orders WHERE patient_id = ?');
  const deleteAdmissions = db.prepare('DELETE FROM admissions WHERE patient_id = ?');

  const insertEncounter = db.prepare(
    "INSERT INTO encounters (visit_id, patient_id, date, service, department, consultant, " +
    "                        chief_complaint, priority, status, location_type, triage_level, " +
    "                        triage_note, created_at, closed_at, data_json) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  const insertOrder = db.prepare(
    "INSERT INTO orders (id, encounter_id, patient_id, type, item, priority, status, " +
    "                    requested_by_staff_id, " +
    "                    result_status, specimen_id, ordered_at, entered_at, entered_by, " +
    "                    validated_at, validated_by, data_json) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  const insertAdmission = db.prepare(
    "INSERT INTO admissions (admission_id, patient_id, admitted_at, admitted_by, ward, ward_id, " +
    "                        bed, location_type, status, discharged_at, discharge_diagnosis, data_json) " +
    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  async function saveOnePatient(p) {
    const row = {
      id: p.id,
      full_name: p.fullName || '',
      preferred_name: p.preferredName || '',
      dob: p.dob || null,
      sex: p.sex || null,
      national_id: p.nationalId || null,
      mobile: p.mobile || null,
      email: p.email || null,
      address: p.address || null,
      emg_name: p.emgName || null,
      emg_relation: p.emgRelation || null,
      emg_mobile: p.emgMobile || null,
      alt_phone: p.altPhone || null,
      allergies: p.allergies || null,
      chronic: p.chronic || null,
      blood_group: p.bloodGroup || null,
      payment_type: p.paymentType || null,
      ins_name: p.insName || null,
      ins_number: p.insNumber || null,
      status: p.status || 'active',
      merged_into: p.mergedInto || null,
      merged_at: p.mergedAt || null,
      merged_by: p.mergedBy || null,
      created_at: p.createdAt || now,
      updated_at: now,
      data_json: JSON.stringify(p)
    };
    await insertPatient.run(row);

    // Rebuild child rows
    await deleteEncounters.run(p.id);
    await deleteOrders.run(p.id);
    await deleteAdmissions.run(p.id);

    for (const enc of (p.encounters || [])) {
      const requestingDoctor = enc.consultantId
        ? await db.prepare("SELECT id FROM staff WHERE id=? AND status='active' AND role='doctor'").get(enc.consultantId)
        : null;
      const requesterId = requestingDoctor ? requestingDoctor.id
        : (req.user.role === 'doctor' ? req.user.id : null);
      (enc.orders || []).forEach(order => {
        if (!order.requestedByStaffId) order.requestedByStaffId = requesterId;
      });
      await insertEncounter.run(
        enc.visitId,
        p.id,
        enc.date || null,
        enc.service || null,
        enc.department || null,
        enc.consultant || null,
        enc.chiefComplaint || null,
        enc.priority || null,
        enc.status || null,
        enc.locationType || null,
        enc.triageLevel || null,
        enc.triageNote || null,
        enc.createdAt || now,
        enc.closedAt || null,
        JSON.stringify(enc)
      );

      for (const o of (enc.orders || [])) {
        await insertOrder.run(
          o.id || (enc.visitId + '-' + o.item + '-' + Math.random().toString(36).slice(2, 8)),
          enc.visitId,
          p.id,
          o.type || null,
          o.item || null,
          o.priority || null,
          o.status || null,
          o.requestedByStaffId || null,
          o.resultStatus || null,
          o.specimenId || null,
          o.orderedAt || null,
          o.enteredAt || null,
          o.enteredBy || null,
          o.validatedAt || null,
          o.validatedBy || null,
          JSON.stringify(o)
        );
      }
    }

    if (p.admission) {
      const a = p.admission;
      await insertAdmission.run(
        a.admissionId || (p.id + '-adm'),
        p.id,
        a.admittedAt || null,
        a.admittedBy || null,
        a.ward || null,
        a.wardId || null,
        a.bed || null,
        a.locationType || null,
        a.status || null,
        a.dischargedAt || null,
        a.dischargeDiagnosis || null,
        JSON.stringify(a)
      );
    }
  }

  if (!Array.isArray(list) || list.some(p => !p || !p.id)) {
    return res.status(400).json({ error: 'each patient must include an id' });
  }

  try {
    await db.exec('BEGIN IMMEDIATE');
    for (const p of list) {
      await saveOnePatient(p);
    }
    await db.exec('COMMIT');
  } catch (e) {
    try { await db.exec('ROLLBACK'); } catch (rollbackError) {
      console.error('[patients] rollback failed:', rollbackError);
    }
    console.error('[patients] save failed:', e);
    return res.status(500).json({ error: 'save_failed', message: e.message });
  }

  await writeAudit(req, 'patient.saved', {
    entity: 'patient',
    entityId: list.length === 1 ? list[0].id : (list.length + ' patients'),
    note: list.length === 1
      ? ('Saved patient ' + list[0].id)
      : ('Bulk save of ' + list.length + ' patients')
  });

  res.json({ ok: true, count: list.length });
});

/** DELETE /api/patients/:id  (soft-delete by setting status='deleted') */
router.delete('/:id', async (req, res) => {
  await db.prepare("UPDATE patients SET status='deleted', updated_at=? WHERE id=?")
    .run(new Date().toISOString(), req.params.id);
  await writeAudit(req, 'patient.deleted', {
    entity: 'patient',
    entityId: req.params.id,
    note: 'Soft delete'
  });
  res.json({ ok: true });
});

module.exports = router;