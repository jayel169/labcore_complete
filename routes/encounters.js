// routes/encounters.js
// Read-only endpoints for encounters and orders.
// Writes happen via POST /api/patients (which rebuilds encounters + orders).
const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { checkQcForOrder } = require('../utils/qc-gate');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

/* =========================================================
   HELPERS
   ========================================================= */

function rowToEncounter(row) {
  if (!row) return null;
  const base = row.data_json ? JSON.parse(row.data_json) : {};
  return Object.assign({}, base, {
    visitId: row.visit_id,
    patientId: row.patient_id,
    date: row.date,
    service: row.service,
    department: row.department,
    consultant: row.consultant,
    chiefComplaint: row.chief_complaint,
    priority: row.priority,
    status: row.status,
    locationType: row.location_type,
    triageLevel: row.triage_level,
    triageNote: row.triage_note,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    orders: base.orders || []
  });
}

function rowToOrder(row) {
  if (!row) return null;
  const base = row.data_json ? JSON.parse(row.data_json) : {};
  return Object.assign({}, base, {
    id: row.id,
    encounterId: row.encounter_id,
    patientId: row.patient_id,
    type: row.type,
    item: row.item,
    priority: row.priority,
    status: row.status,
    resultStatus: row.result_status,
    requestedByStaffId: row.requested_by_staff_id || base.requestedByStaffId || null,
    specimenId: row.specimen_id,
    orderedAt: row.ordered_at,
    enteredAt: row.entered_at,
    enteredBy: row.entered_by,
    validatedAt: row.validated_at,
    validatedBy: row.validated_by,
    results: base.results || {}
  });
}

/* =========================================================
   PUT /api/encounters/:visitId/specimens
   Register received specimens on existing laboratory orders.
   ========================================================= */
router.put('/:visitId/specimens', requireRole('admin', 'scientist', 'receptionist', 'nurse'), async (req, res) => {
  const orders = req.body && req.body.orders;
  if (!Array.isArray(orders) || !orders.length || orders.length > 100 ||
      orders.some(order => !order || typeof order.id !== 'string' ||
        typeof order.specimenId !== 'string' || !order.specimenId.trim() ||
        typeof order.specimenReceivedDate !== 'string' ||
        typeof order.specimenReceivedTime !== 'string' ||
        typeof order.container !== 'string' || !order.container.trim())) {
    return res.status(400).json({ error: 'invalid_specimen_registration' });
  }
  const orderIds = orders.map(order => order.id);
  if (new Set(orderIds).size !== orderIds.length) {
    return res.status(400).json({ error: 'duplicate_order_id' });
  }

  const rows = [];
  for (const orderId of orderIds) {
    const row = await db.prepare(
      'SELECT * FROM orders WHERE id = ? AND encounter_id = ?'
    ).get(orderId, req.params.visitId);
    if (!row) return res.status(404).json({ error: 'order_not_found', orderId });
    if (String(row.type || '').toLowerCase() !== 'laboratory') {
      return res.status(400).json({ error: 'not_a_laboratory_order', orderId });
    }
    if (!['pending', 'awaiting specimen', 'awaiting sample', 'sample pending']
      .includes(String(row.status || '').trim().toLowerCase())) {
      return res.status(409).json({ error: 'specimen_already_registered', orderId });
    }
    rows.push(row);
  }

  const patient = await db.prepare('SELECT data_json FROM patients WHERE id = ?').get(rows[0].patient_id);
  const encounter = await db.prepare(
    'SELECT data_json FROM encounters WHERE visit_id = ? AND patient_id = ?'
  ).get(req.params.visitId, rows[0].patient_id);
  if (!patient || !encounter || rows.some(row => row.patient_id !== rows[0].patient_id)) {
    return res.status(404).json({ error: 'patient_or_encounter_not_found' });
  }

  const now = new Date().toISOString();
  const updatedOrders = rows.map(row => {
    const registration = orders.find(order => order.id === row.id);
    const updated = Object.assign({}, row.data_json ? JSON.parse(row.data_json) : {}, {
      id: row.id,
      encounterId: row.encounter_id,
      patientId: row.patient_id,
      type: row.type,
      item: row.item,
      priority: row.priority,
      status: 'Specimen Received',
      specimenId: registration.specimenId.trim(),
      specimenType: String(registration.specimenType || ''),
      specimenReceivedDate: registration.specimenReceivedDate,
      specimenReceivedTime: registration.specimenReceivedTime,
      container: registration.container.trim(),
      specimenCondition: String(registration.specimenCondition || ''),
      receivedFrom: String(registration.receivedFrom || ''),
      receivedBy: req.user.name,
      remarks: String(registration.remarks || '').slice(0, 1000),
      specimenBarcode: {
        specimenId: registration.specimenId.trim(),
        tests: Array.isArray(registration.specimenBarcode && registration.specimenBarcode.tests)
          ? registration.specimenBarcode.tests.filter(test => typeof test === 'string').slice(0, 100)
          : [],
        container: registration.container.trim(),
        specimenType: String(registration.specimenType || ''),
        generatedAt: now,
        generatedBy: req.user.name,
        labelPrinted: false,
        labelPrintedAt: null,
        labelPrintedBy: null
      },
      specimenIds: [{
        id: registration.specimenId.trim(),
        type: String(registration.specimenType || ''),
        container: registration.container.trim(),
        receivedAt: registration.specimenReceivedDate + 'T' + registration.specimenReceivedTime,
        condition: String(registration.specimenCondition || ''),
        receivedFrom: String(registration.receivedFrom || ''),
        receivedBy: req.user.name,
        remarks: String(registration.remarks || '').slice(0, 1000)
      }]
    });
    return { row, updated };
  });

  const patientData = patient.data_json ? JSON.parse(patient.data_json) : {};
  const encounterData = encounter.data_json ? JSON.parse(encounter.data_json) : {};
  function syncOrderSnapshot(list, updated) {
    const items = Array.isArray(list) ? list : [];
    const index = items.findIndex(item => item.id === updated.id);
    if (index >= 0) items[index] = updated;
    else items.push(updated);
    return items;
  }
  encounterData.orders = updatedOrders.reduce(
    (list, entry) => syncOrderSnapshot(list, entry.updated), encounterData.orders || []
  );
  const patientEncounter = (patientData.encounters || []).find(
    item => item.visitId === req.params.visitId
  );
  if (patientEncounter) {
    patientEncounter.orders = updatedOrders.reduce(
      (list, entry) => syncOrderSnapshot(list, entry.updated), patientEncounter.orders || []
    );
  }
  if (Array.isArray(patientData.orders)) {
    patientData.orders = updatedOrders.reduce(
      (list, entry) => syncOrderSnapshot(list, entry.updated), patientData.orders
    );
  }

  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of updatedOrders) {
      await db.prepare(
        'UPDATE orders SET status=?, specimen_id=?, data_json=? WHERE id=?'
      ).run('Specimen Received', entry.updated.specimenId, JSON.stringify(entry.updated), entry.row.id);
    }
    await db.prepare('UPDATE encounters SET data_json=? WHERE visit_id=? AND patient_id=?')
      .run(JSON.stringify(encounterData), req.params.visitId, rows[0].patient_id);
    await db.prepare('UPDATE patients SET data_json=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(patientData), now, rows[0].patient_id);
    await db.exec('COMMIT');
  } catch (error) {
    await db.exec('ROLLBACK');
    console.error('[encounters] specimen registration failed:', error);
    return res.status(500).json({ error: 'specimen_registration_failed' });
  }

  for (const entry of updatedOrders) {
    await writeAudit(req, 'specimen.received', {
      entity: 'order',
      entityId: entry.row.id,
      patientId: entry.row.patient_id,
      visitId: req.params.visitId,
      specimenId: entry.updated.specimenId,
      panel: entry.row.item,
      after: { status: 'Specimen Received', specimenId: entry.updated.specimenId }
    });
  }
  res.json({ ok: true, count: updatedOrders.length });
});

/* =========================================================
   PUT /api/encounters/:visitId/orders/:orderId
   Persist a result-entry order and its patient/encounter snapshots.
   ========================================================= */
router.put('/:visitId/orders/:orderId', requireRole('admin', 'scientist'), async (req, res) => {
  const order = req.body || {};
  const row = await db.prepare(
    'SELECT * FROM orders WHERE id = ? AND encounter_id = ?'
  ).get(req.params.orderId, req.params.visitId);
  if (!row) return res.status(404).json({ error: 'order_not_found' });
  if (order.id && order.id !== row.id) return res.status(400).json({ error: 'order_id_mismatch' });

  const patient = await db.prepare('SELECT data_json FROM patients WHERE id = ?').get(row.patient_id);
  const encounter = await db.prepare(
    'SELECT data_json FROM encounters WHERE visit_id = ? AND patient_id = ?'
  ).get(req.params.visitId, row.patient_id);
  if (!patient || !encounter) return res.status(404).json({ error: 'patient_or_encounter_not_found' });

  const updated = Object.assign({}, row.data_json ? JSON.parse(row.data_json) : {}, order, {
    id: row.id,
    encounterId: row.encounter_id,
    patientId: row.patient_id,
    type: row.type,
    item: row.item,
    priority: row.priority,
    requestedByStaffId: row.requested_by_staff_id || (row.data_json ? JSON.parse(row.data_json).requestedByStaffId : null),
    specimenId: row.specimen_id,
    orderedAt: row.ordered_at
  });
  if (updated.resultStatus === 'Validated' || updated.status === 'Validated') {
    const holds = await checkQcForOrder(updated);
    if (holds.length) {
      return res.status(409).json({
        error: 'qc_hold',
        message: 'Validation is on hold: configured QC must pass today for this panel, analyte and instrument.',
        holds
      });
    }
  }
  const previousResultStatus = row.result_status;
  const patientData = patient.data_json ? JSON.parse(patient.data_json) : {};
  const encounterData = encounter.data_json ? JSON.parse(encounter.data_json) : {};
  await db.exec('BEGIN IMMEDIATE');
  try {
    await db.prepare(
      'UPDATE orders SET status=?, result_status=?, entered_at=?, entered_by=?, ' +
      'validated_at=?, validated_by=?, requested_by_staff_id=?, data_json=? WHERE id=?'
    ).run(
      updated.status ?? row.status, updated.resultStatus ?? row.result_status,
      updated.enteredAt ?? row.entered_at, updated.enteredBy ?? row.entered_by,
      updated.validatedAt ?? row.validated_at, updated.validatedBy ?? row.validated_by,
      updated.requestedByStaffId || row.requested_by_staff_id || null,
      JSON.stringify(updated), row.id
    );
    function syncOrderSnapshot(data) {
      let matched = false;
      (data.encounters || []).forEach(function (enc) {
        if (enc.visitId !== req.params.visitId) return;
        (enc.orders || []).forEach(function (item, index) {
          if (item.id === row.id || (!item.id && item.item === row.item &&
              (item.specimenId || null) === (row.specimen_id || null))) {
            enc.orders[index] = updated;
            matched = true;
          }
        });
      });
      if (Array.isArray(data.orders)) {
        data.orders.forEach(function (item, index) {
          if (item.id === row.id) {
            data.orders[index] = updated;
            matched = true;
          }
        });
      }
      return matched;
    }
    let encounterOrderMatched = false;
    (encounterData.orders || []).forEach(function (item, index) {
      if (item.id === row.id || (!item.id && item.item === row.item &&
          (item.specimenId || null) === (row.specimen_id || null))) {
        encounterData.orders[index] = updated;
        encounterOrderMatched = true;
      }
    });
    if (!encounterOrderMatched) {
      encounterData.orders = (await db.prepare(
        'SELECT * FROM orders WHERE encounter_id = ? ORDER BY ordered_at ASC'
      ).all(req.params.visitId)).map(rowToOrder);
    }
    syncOrderSnapshot(encounterData);
    const patientEncounter = (patientData.encounters || []).find(function (enc) {
      return enc.visitId === req.params.visitId;
    });
    if (patientEncounter) {
      patientEncounter.orders = patientEncounter.orders || [];
      let patientOrderMatched = false;
      patientEncounter.orders.forEach(function (item, index) {
        if (item.id === row.id || (!item.id && item.item === row.item &&
            (item.specimenId || null) === (row.specimen_id || null))) {
          patientEncounter.orders[index] = updated;
          patientOrderMatched = true;
        }
      });
      if (!patientOrderMatched) patientEncounter.orders.push(updated);
    }
    await db.prepare('UPDATE encounters SET data_json=? WHERE visit_id=?').run(
      JSON.stringify(encounterData), req.params.visitId
    );
    await db.prepare('UPDATE patients SET data_json=?, updated_at=? WHERE id=?').run(
      JSON.stringify(patientData), new Date().toISOString(), row.patient_id
    );
    if (updated.type === 'Laboratory' &&
        (updated.resultStatus === 'Validated' || updated.status === 'Validated') &&
        previousResultStatus !== 'Validated') {
      const requesterId = updated.requestedByStaffId || encounterData.consultantId || null;
      const requester = requesterId
        ? await db.prepare("SELECT id, name FROM staff WHERE id=? AND status='active' AND role='doctor'").get(requesterId)
        : null;
      const patientRow = await db.prepare('SELECT full_name FROM patients WHERE id=?').get(row.patient_id);
      for (const [test, result] of Object.entries(updated.results || {})) {
        if (!result || !['LL', 'HH'].includes(String(result.flag || '').toUpperCase())) continue;
        const alertId = uuid();
        const createdAt = new Date().toISOString();
        await db.prepare(`
          INSERT INTO critical_alerts
            (id, order_id, patient_id, patient_name, visit_id, specimen_id, panel, test,
             result_value, result_unit, result_flag, requesting_staff_id, requesting_name,
             created_at, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          alertId, row.id, row.patient_id, patientRow.full_name, row.encounter_id,
          row.specimen_id, row.item || '', test, String(result.value), result.unit || '',
          String(result.flag).toUpperCase(), requester ? requester.id : null,
          requester ? requester.name : null, createdAt, requester ? 'pending' : 'unassigned'
        );
        await writeAudit(req, 'critical.alert.created', {
          entity: 'critical_alert', entityId: alertId, patientId: row.patient_id,
          patientName: patientRow.full_name, visitId: row.encounter_id,
          specimenId: row.specimen_id, panel: row.item, test,
          after: { value: String(result.value), flag: String(result.flag).toUpperCase() },
          note: requester ? 'Assigned to requesting clinician ' + requester.name : 'No requesting clinician account could be matched'
        }
        );
      }
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    console.error('[encounters] order update failed:', e);
    return res.status(500).json({ error: 'order_update_failed' });
  }

  res.json(rowToOrder(await db.prepare('SELECT * FROM orders WHERE id = ?').get(row.id)));
});

/* =========================================================
   GET /api/encounters/patient/:patientId
   All encounters for one patient (newest first).
   ========================================================= */
router.get('/patient/:patientId', async (req, res) => {
  const rows = await db.prepare(
    'SELECT * FROM encounters WHERE patient_id = ? ORDER BY created_at DESC LIMIT 500'
  ).all(req.params.patientId);

  // Attach orders to each encounter (efficient: one query per encounter, or bulk)
  const orderStmt = db.prepare(
    'SELECT * FROM orders WHERE encounter_id = ? ORDER BY ordered_at ASC'
  );

  const out = await Promise.all(rows.map(async function (e) {
    const enc = rowToEncounter(e);
    const orderRows = await orderStmt.all(e.visit_id);
    enc.orders = orderRows.map(rowToOrder);
    return enc;
  }));

  res.json(out);
});

/* =========================================================
   GET /api/encounters/:visitId
   One encounter with all its orders.
   ========================================================= */
router.get('/:visitId', async (req, res) => {
  const row = await db.prepare('SELECT * FROM encounters WHERE visit_id = ?').get(req.params.visitId);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const enc = rowToEncounter(row);
  const orderRows = await db.prepare(
    'SELECT * FROM orders WHERE encounter_id = ? ORDER BY ordered_at ASC'
  ).all(req.params.visitId);
  enc.orders = orderRows.map(rowToOrder);
  res.json(enc);
});

/* =========================================================
   GET /api/encounters
   Query params:
     ?type=Laboratory       filter orders by type
     ?resultStatus=Validated
     ?status=Waiting
     ?from=ISO &to=ISO      (encounter date range)
     ?limit=500             (default 500, max 2000)
   Returns a flat list of ORDERS across encounters, with
   patient + encounter context attached.
   ========================================================= */
router.get('/', async (req, res) => {
  const type         = req.query.type;
  const resultStatus = req.query.resultStatus;
  const status       = req.query.status;
  const from         = req.query.from;
  const to           = req.query.to;
  const limit        = Math.min(Number(req.query.limit) || 500, 2000);

  const where = [];
  const args = [];

  if (type)         { where.push('o.type = ?');          args.push(type); }
  if (resultStatus) { where.push('o.result_status = ?'); args.push(resultStatus); }
  if (status)       { where.push('o.status = ?');        args.push(status); }
  if (from)         { where.push('e.created_at >= ?');   args.push(from); }
  if (to)           { where.push('e.created_at <= ?');   args.push(to); }

  const sql =
    'SELECT o.*, e.visit_id AS enc_visit_id, e.patient_id AS enc_patient_id, ' +
    '       e.date AS enc_date, e.service AS enc_service, e.consultant AS enc_consultant ' +
    'FROM orders o ' +
    'JOIN encounters e ON e.visit_id = o.encounter_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY o.ordered_at DESC LIMIT ?';
  args.push(limit);

  const rows = await db.prepare(sql).all(...args);

  // Also fetch patient name for each (join optional; small set)
  const patientStmt = db.prepare('SELECT full_name FROM patients WHERE id = ?');

  const out = await Promise.all(rows.map(async function (r) {
    const o = rowToOrder(r);
    const p = await patientStmt.get(r.patient_id);
    return Object.assign(o, {
      patientName: p ? p.full_name : '',
      encounterDate: r.enc_date,
      service: r.enc_service,
      consultant: r.enc_consultant
    });
  }));

  res.json(out);
});

module.exports = router;