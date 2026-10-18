// routes/misc.js
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');
const { v4: uuid } = require('uuid');

const router = express.Router();

/* ---------- PRICES ---------- */
router.get('/prices', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM prices').all();
  const out = { services: {}, labTests: {}, imaging: {}, pharmacy: {} };
  rows.forEach(r => { out[r.category][r.key] = JSON.parse(r.data_json); });
  res.json(out);
});

router.put('/prices/:category/:key', requireAuth, async (req, res) => {
  const { category, key } = req.params;
  const value = JSON.stringify(req.body || {});
  await db.prepare(`
    INSERT INTO prices (category, key, data_json) VALUES (?,?,?)
    ON CONFLICT(category,key) DO UPDATE SET data_json = excluded.data_json
  `).run(category, key, value);
  await writeAudit(req, 'price.changed', { entity: 'price', entityId: `${category}:${key}`, note: key });
  res.json({ ok: true });
});

/* ---------- TEST PANELS ---------- */
router.get('/panels', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM panels').all();
  res.json(rows.map(r => JSON.parse(r.data_json)));
});

router.put('/panels/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const p = req.body || {};
  await db.prepare(`
    INSERT INTO panels (id, name, code, data_json) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, data_json=excluded.data_json
  `).run(id, p.name || '', p.code || '', JSON.stringify(p));
  await writeAudit(req, 'panel.saved', { entity: 'panel', entityId: id, note: p.name || '' });
  res.json({ ok: true });
});

/* ---------- RECEIPTS ---------- */
router.get('/receipts', requireAuth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM receipts ORDER BY printed_at DESC LIMIT 500').all();
  res.json(rows.map(r => ({
    receiptNumber: r.receipt_number,
    patientId: r.patient_id,
    patientName: r.patient_name,
    visitId: r.visit_id,
    amountPaid: r.amount_paid,
    balanceRemaining: r.balance_remaining,
    paymentMethod: r.payment_method,
    printedAt: r.printed_at,
    printedBy: r.printed_by,
    ...JSON.parse(r.data_json || '{}')
  })));
});

router.post('/receipts', requireAuth, async (req, res) => {
  const p = req.body || {};
  await db.prepare(`
    INSERT INTO receipts (receipt_number, patient_id, patient_name, visit_id, amount_paid,
                          balance_remaining, payment_method, printed_at, printed_by, data_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(receipt_number) DO UPDATE SET data_json=excluded.data_json
  `).run(
    p.receiptNumber, p.patientId, p.patientName, p.visitId, p.amountPaid,
    p.balanceRemaining, p.paymentMethod, p.printedAt || new Date().toISOString(),
    p.printedBy || req.user.name, JSON.stringify(p)
  );
  await writeAudit(req, 'receipt.printed', { entity: 'receipt', entityId: p.receiptNumber });
  res.json({ ok: true });
});

/* ---------- NOTIFICATIONS ---------- */
router.get('/notifications', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM notifications
    WHERE staff_name IS NULL OR staff_name = ?
    ORDER BY at DESC LIMIT 100
  `).all(req.user.name);
  res.json(rows.map(r => ({
    id: r.id, kind: r.kind, type: r.type, title: r.title, body: r.body,
    link: r.link, icon: r.icon, read: !!r.read, at: r.at
  })));
});

router.post('/notifications', async (req, res) => {
  const p = req.body || {};
  const id = 'NOTIF-' + uuid().slice(0, 12);
  await db.prepare(`
    INSERT INTO notifications (id, staff_name, kind, type, title, body, link, icon, read, at, meta_json)
    VALUES (?,?,?,?,?,?,?,?,0,?,?)
  `).run(id, p.staffName || null, p.kind || 'generic', p.type || 'info',
         p.title || 'Notification', p.body || '', p.link || null,
         p.icon || '🔔', new Date().toISOString(), JSON.stringify(p));
  res.json({ ok: true, id });
});

router.post('/notifications/:id/read', requireAuth, async (req, res) => {
  await db.prepare('UPDATE notifications SET read=1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;