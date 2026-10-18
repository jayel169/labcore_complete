// routes/deliveries.js
const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

function makePin() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/* ---------- ADMIN/STAFF SIDE ---------- */

router.post('/', requireAuth, async (req, res) => {
  const p = req.body || {};
  if (!['email', 'whatsapp', 'telegram'].includes(p.channel) ||
      !String(p.recipient || '').trim() || !p.reportRef || !p.patientId || !p.visitId) {
    return res.status(400).json({ error: 'valid channel, recipient, reportRef, patientId, and visitId required' });
  }
  const patient = await db.prepare('SELECT id FROM patients WHERE id = ?').get(p.patientId);
  const encounter = await db.prepare(
    'SELECT visit_id FROM encounters WHERE visit_id = ? AND patient_id = ?'
  ).get(p.visitId, p.patientId);
  const validatedCount = Number((await db.prepare(
    "SELECT COUNT(*) AS count FROM orders WHERE patient_id=? AND encounter_id=? AND type='Laboratory' " +
    "AND (result_status='Validated' OR status='Validated')"
  ).get(p.patientId, p.visitId)).count);
  if (!patient || !encounter || !validatedCount) {
    return res.status(400).json({ error: 'report_must_have_validated_results' });
  }
  const ttl = Number(p.ttlHours) || 24;
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 168) {
    return res.status(400).json({ error: 'ttlHours must be between 1 and 168' });
  }
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sentToday = Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM deliveries WHERE report_ref=? AND created_at>=? AND created_by=?'
  ).get(p.reportRef, dayStart.toISOString(), req.user.name)).count);
  if (sentToday >= 3) return res.status(429).json({ error: 'daily_report_send_limit' });
  const now = new Date();
  const expires = new Date(now.getTime() + ttl * 3600 * 1000);

  const id = 'DLV-' + Date.now().toString(36).toUpperCase() + '-' + uuid().slice(0, 6).toUpperCase();
  const pin = makePin();

  await db.prepare(`
    INSERT INTO deliveries (id, report_ref, patient_id, visit_id, channel, recipient, recipient_name,
                            ttl_hours, pin, download_limit, downloads, opened, revoked,
                            created_at, expires_at, created_by, open_log_json, meta_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0,?,?,?,?,?)
  `).run(
    id, p.reportRef, p.patientId, p.visitId, p.channel, String(p.recipient).trim(),
    p.recipientName || '', ttl, pin, 1,
    now.toISOString(), expires.toISOString(), req.user.name,
    JSON.stringify([]), JSON.stringify({ note: p.note || '' })
  );

  await writeAudit(req, 'report.sent_' + p.channel, {
    entity: 'delivery', entityId: id,
    patientId: p.patientId, visitId: p.visitId,
    note: `Delivery created · expires ${expires.toLocaleString()}`
  });

  res.json({
    id,
    pin,                       // shown once
    createdAt: now.toISOString(),
    createdBy: req.user.name,
    expiresAt: expires.toISOString(),
    viewerUrl: `/report-viewer.html?t=${id}`,
    channel: p.channel,
    recipient: String(p.recipient).trim(),
    recipientName: p.recipientName || '',
    reportRef: p.reportRef,
    patientId: p.patientId,
    visitId: p.visitId
  });
});

router.get('/patient/:patientId', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM deliveries WHERE patient_id = ? ORDER BY created_at DESC')
    .all(req.params.patientId);
  res.json(rows.map(r => ({
    id: r.id,
    reportRef: r.report_ref,
    channel: r.channel,
    recipient: r.recipient,
    recipientName: r.recipient_name,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    downloads: r.downloads,
    downloadLimit: r.download_limit,
    opened: !!r.opened,
    revoked: !!r.revoked,
    createdBy: r.created_by,
    openLog: r.open_log_json ? JSON.parse(r.open_log_json) : []
  })));
});

router.post('/:id/revoke', requireAuth, async (req, res) => {
  await db.prepare('UPDATE deliveries SET revoked=1 WHERE id = ?').run(req.params.id);
  await writeAudit(req, 'report.link_revoked', { entity: 'delivery', entityId: req.params.id, note: req.body.reason || 'Revoked' });
  res.json({ ok: true });
});

/* ---------- PUBLIC VIEWER SIDE (no auth) ---------- */

/** GET /api/deliveries/public/:id  — returns metadata (not PIN) */
router.get('/public/:id', async (req, res) => {
  const d = await db.prepare(
    `SELECT * FROM deliveries WHERE id = ?${db.postgres ? ' FOR UPDATE' : ''}`
  ).get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not_found' });
  if (d.revoked) return res.status(403).json({ error: 'revoked' });
  if (new Date(d.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'expired' });
  if (d.downloads >= d.download_limit) return res.status(410).json({ error: 'limit' });
  res.json({
    id: d.id,
    reportRef: d.report_ref,
    channel: d.channel,
    recipientName: d.recipient_name,
    expiresAt: d.expires_at
  });
});

/** POST /api/deliveries/public/:id/verify  — { pin } → returns report data if OK */
router.post('/public/:id/verify', async (req, res) => {
  await db.exec('BEGIN IMMEDIATE');
  try {
    const d = await db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!d) { await db.exec('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
    if (d.revoked) { await db.exec('ROLLBACK'); return res.status(403).json({ error: 'revoked' }); }
    if (new Date(d.expires_at).getTime() < Date.now()) { await db.exec('ROLLBACK'); return res.status(410).json({ error: 'expired' }); }
    if (d.downloads >= d.download_limit) { await db.exec('ROLLBACK'); return res.status(410).json({ error: 'limit' }); }
    if (String(req.body && req.body.pin) !== String(d.pin)) {
      await db.exec('ROLLBACK');
      return res.status(401).json({ error: 'wrong_pin' });
    }

    const patient = await db.prepare('SELECT * FROM patients WHERE id = ?').get(d.patient_id);
    const enc = await db.prepare(
      'SELECT * FROM encounters WHERE visit_id = ? AND patient_id = ?'
    ).get(d.visit_id, d.patient_id);
    if (!patient || !enc) {
      await db.exec('ROLLBACK');
      return res.status(404).json({ error: 'report_not_found' });
    }
    const orders = await db.prepare(
      "SELECT * FROM orders WHERE patient_id = ? AND encounter_id = ? AND type='Laboratory' " +
      "AND (result_status='Validated' OR status='Validated')"
    ).all(d.patient_id, d.visit_id);
    const openLog = d.open_log_json ? JSON.parse(d.open_log_json) : [];
    openLog.push({ at: new Date().toISOString(), ua: (req.headers['user-agent'] || '').slice(0, 140) });
    await db.prepare('UPDATE deliveries SET opened=1, downloads=downloads+1, open_log_json=? WHERE id = ?')
      .run(JSON.stringify(openLog), d.id);
    await db.exec('COMMIT');
    return res.json({
      ok: true,
      report: {
        patient: { id: patient.id, fullName: patient.full_name, dob: patient.dob, sex: patient.sex },
        encounter: { visitId: enc.visit_id, date: enc.date, consultant: enc.consultant },
        orders: orders.map(o => {
          const data = JSON.parse(o.data_json || '{}');
          return {
            item: o.item,
            resultStatus: o.result_status,
            status: o.status,
            validatedAt: o.validated_at || data.validatedAt,
            validatedBy: o.validated_by || data.validatedBy,
            panelComment: data.panelComment || '',
            results: data.results || {}
          };
        })
      }
    });
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch (rollbackError) {
      console.error('[deliveries] verification rollback failed:', rollbackError);
    }
    console.error('[deliveries] report verification failed:', error);
    return res.status(500).json({ error: 'verification_failed' });
  }
});

/** POST /api/deliveries/public/:id/download  — increments counter */
router.post('/public/:id/download', async (req, res) => {
  res.status(410).json({ error: 'link_already_consumed' });
});

module.exports = router;