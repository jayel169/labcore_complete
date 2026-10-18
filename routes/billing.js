const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const PAYSTACK_URL = 'https://api.paystack.co';

async function getBill(patientId, visitId) {
  const row = await db.prepare('SELECT data_json FROM patients WHERE id = ?').get(patientId);
  if (!row) return { error: 'Patient not found', status: 404 };
  const patient = JSON.parse(row.data_json || '{}');
  const encounter = (patient.encounters || []).find(item => item.visitId === visitId);
  if (!encounter) return { error: 'Encounter not found', status: 404 };
  const total = (encounter.billing || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const paid = Number(encounter.amountPaid) || 0;
  return { patient, encounter, total, paid, balance: Math.max(0, total - paid) };
}

async function settlePayment(payment, actor) {
  if (payment.status === 'successful') return { ok: true, alreadySettled: true };

  const bill = await getBill(payment.patient_id, payment.visit_id);
  if (bill.error) throw Object.assign(new Error(bill.error), { status: bill.status });
  if (payment.amount <= 0 || payment.amount > bill.balance + 0.001) {
    throw Object.assign(new Error('Payment exceeds the current outstanding balance'), { status: 409 });
  }

  const now = new Date().toISOString();
  bill.encounter.amountPaid = bill.paid + payment.amount;
  bill.encounter.paymentStatus = bill.encounter.amountPaid + 0.001 >= bill.total ? 'paid' : 'partial';
  bill.encounter.paymentMethod = payment.method;
  bill.encounter.paidAt = now;
  bill.encounter.paidBy = actor;
  bill.encounter.payments = Array.isArray(bill.encounter.payments) ? bill.encounter.payments : [];
  bill.encounter.payments.push({
    paymentId: payment.id,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference || payment.provider_reference || '',
    at: now,
    by: actor,
    balanceAfter: Math.max(0, bill.total - bill.encounter.amountPaid)
  });
  bill.patient.encounters = bill.patient.encounters.map(item =>
    item.visitId === payment.visit_id ? bill.encounter : item
  );

  await db.exec('BEGIN IMMEDIATE');
  try {
    const current = await db.prepare(
      `SELECT status FROM billing_payments WHERE id = ?${db.postgres ? ' FOR UPDATE' : ''}`
    ).get(payment.id);
    if (!current) throw Object.assign(new Error('Payment record not found'), { status: 404 });
    if (current.status === 'successful') {
      await db.exec('COMMIT');
      return { ok: true, alreadySettled: true };
    }

    if (db.postgres) {
      await db.prepare('SELECT id FROM patients WHERE id = ? FOR UPDATE').get(payment.patient_id);
    }
    const freshBill = await getBill(payment.patient_id, payment.visit_id);
    if (freshBill.error || payment.amount > freshBill.balance + 0.001) {
      throw Object.assign(new Error('Payment exceeds the current outstanding balance'), { status: 409 });
    }
    freshBill.encounter.amountPaid = freshBill.paid + payment.amount;
    freshBill.encounter.paymentStatus = freshBill.encounter.amountPaid + 0.001 >= freshBill.total ? 'paid' : 'partial';
    freshBill.encounter.paymentMethod = payment.method;
    freshBill.encounter.paidAt = now;
    freshBill.encounter.paidBy = actor;
    freshBill.encounter.payments = Array.isArray(freshBill.encounter.payments) ? freshBill.encounter.payments : [];
    freshBill.encounter.payments.push({
      paymentId: payment.id,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference || payment.provider_reference || '',
      at: now,
      by: actor,
      balanceAfter: Math.max(0, freshBill.total - freshBill.encounter.amountPaid)
    });
    freshBill.patient.encounters = freshBill.patient.encounters.map(item =>
      item.visitId === payment.visit_id ? freshBill.encounter : item
    );
    const dateKey = now.slice(0, 10).replace(/-/g, '');
    const visitCode = payment.visit_id.split('-').pop().replace(/\D/g, '').slice(-4).padStart(4, '0');
    const receipt = {
      id: `LABCORE-${dateKey}-${visitCode}-${payment.id.slice(0, 8).toUpperCase()}`,
      receiptNumber: `LABCORE-${dateKey}-${visitCode}-${payment.id.slice(0, 8).toUpperCase()}`,
      dateKey,
      printedAt: now,
      printedBy: actor,
      patientId: payment.patient_id,
      patientName: freshBill.patient.fullName || '',
      patientMobile: freshBill.patient.mobile || '',
      patientSex: freshBill.patient.sex || '',
      patientDob: freshBill.patient.dob || '',
      visitId: payment.visit_id,
      service: freshBill.encounter.service || '',
      encounterDate: freshBill.encounter.date || '',
      items: freshBill.encounter.billing || [],
      totalCharged: freshBill.total,
      previousPaid: freshBill.paid,
      amountPaid: payment.amount,
      balanceRemaining: Math.max(0, freshBill.total - freshBill.encounter.amountPaid),
      paymentMethod: payment.method,
      paymentNote: payment.reference || payment.provider_reference || '',
      paymentId: payment.id,
      isReprint: false,
      reprintLog: []
    };
    await db.prepare('UPDATE patients SET data_json = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(freshBill.patient), now, payment.patient_id);
    await db.prepare('UPDATE encounters SET data_json = ? WHERE visit_id = ?')
      .run(JSON.stringify(freshBill.encounter), payment.visit_id);
    await db.prepare("UPDATE billing_payments SET status = 'successful', received_at = ?, received_by = ? WHERE id = ?")
      .run(now, actor, payment.id);
    await db.prepare(
      'INSERT INTO receipts (receipt_number, patient_id, patient_name, visit_id, amount_paid, balance_remaining, ' +
      'payment_method, printed_at, printed_by, data_json) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(receipt.receiptNumber, receipt.patientId, receipt.patientName, receipt.visitId,
      receipt.amountPaid, receipt.balanceRemaining, receipt.paymentMethod, receipt.printedAt,
      receipt.printedBy, JSON.stringify(receipt));
    await db.exec('COMMIT');

    await writeAudit({ user: { name: actor, role: payment.role || '' } },
      freshBill.encounter.paymentStatus === 'paid' ? 'bill.paid' : 'bill.partial_payment', {
        entity: 'encounter',
        entityId: payment.visit_id,
        patientId: payment.patient_id,
        patientName: freshBill.patient.fullName,
        visitId: payment.visit_id,
        before: { paid: freshBill.paid },
        after: { paid: freshBill.encounter.amountPaid, balance: Math.max(0, freshBill.total - freshBill.encounter.amountPaid) },
        note: `Payment: GHS ${Number(payment.amount).toFixed(2)} · ${payment.method}`
      });
    return {
      ok: true,
      paymentId: payment.id,
      balance: Math.max(0, freshBill.total - freshBill.encounter.amountPaid),
      receipt
    };
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch (rollbackError) { console.error('[billing] rollback failed:', rollbackError); }
    throw error;
  }
}

async function verifyPaystack(reference) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw Object.assign(new Error('Paystack is not configured on this server'), { status: 503 });
  const response = await fetch(`${PAYSTACK_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const result = await response.json();
  if (!response.ok || !result.status) {
    throw Object.assign(new Error(result.message || 'Paystack verification failed'), { status: 502 });
  }
  return result.data;
}

async function confirmPaystack(reference) {
  const payment = await db.prepare('SELECT * FROM billing_payments WHERE provider_reference = ?').get(reference);
  if (!payment) throw Object.assign(new Error('Payment reference not found'), { status: 404 });
  if (payment.status === 'successful') return { ok: true, alreadySettled: true };

  const verified = await verifyPaystack(reference);
  if (verified.status !== 'success' || verified.currency !== 'GHS' ||
      Number(verified.amount) !== Math.round(Number(payment.amount) * 100)) {
    throw Object.assign(new Error('Paystack payment is not successful or does not match the bill'), { status: 409 });
  }
  const channels = {
    mobile_money: 'Mobile Money',
    card: 'Card',
    bank: 'Bank',
    bank_transfer: 'Bank transfer',
    ussd: 'USSD',
    qr: 'QR'
  };
  payment.method = `Paystack ${channels[verified.channel] || verified.channel || 'checkout'}`;
  await db.prepare("UPDATE billing_payments SET method = ? WHERE id = ? AND status = 'pending'")
    .run(payment.method, payment.id);
  return settlePayment(payment, 'Paystack');
}

router.use('/payments', requireAuth);
router.use('/claims', requireAuth);
router.use('/payments', requireRole('admin', 'billing', 'receptionist'));
router.use('/claims', requireRole('admin', 'billing', 'receptionist'));

router.get('/payments', async (req, res) => {
  const rows = await db.prepare(
    "SELECT id, patient_id AS patientId, visit_id AS visitId, amount, method, status, reference, " +
    "provider_reference AS providerReference, created_at AS createdAt, received_at AS receivedAt, received_by AS receivedBy " +
    "FROM billing_payments WHERE status = ? ORDER BY created_at DESC LIMIT 200"
  ).all(req.query.status || 'pending');
  res.json(rows);
});

router.post('/payments', async (req, res) => {
  const { patientId, visitId, amount, method, reference } = req.body || {};
  const bill = await getBill(patientId, visitId);
  if (bill.error) return res.status(bill.status).json({ error: bill.error });
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0 || value > bill.balance + 0.001) {
    return res.status(400).json({ error: 'Payment amount must be positive and no more than the balance' });
  }
  if (!['Cash', 'Card terminal'].includes(method)) {
    return res.status(400).json({ error: 'Choose cash, a verified card terminal, online checkout, or bank transfer' });
  }

  const payment = {
    id: uuid(), patient_id: patientId, visit_id: visitId, amount: value, method,
    reference: String(reference || '').trim(), provider_reference: null, role: req.user.role
  };
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO billing_payments (id, patient_id, visit_id, amount, method, status, reference, created_at, data_json) ' +
    'VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(payment.id, patientId, visitId, value, method, 'pending', payment.reference, now, JSON.stringify(req.body || {}));
  try {
    const result = await settlePayment(payment, req.user.name);
    res.status(201).json(result);
  } catch (error) {
    await db.prepare('DELETE FROM billing_payments WHERE id = ? AND status = ?').run(payment.id, 'pending');
    throw error;
  }
});

router.post('/payments/bank-transfer', async (req, res) => {
  const { patientId, visitId, amount, reference } = req.body || {};
  const bill = await getBill(patientId, visitId);
  if (bill.error) return res.status(bill.status).json({ error: bill.error });
  const value = Number(amount);
  const bankReference = String(reference || '').trim();
  if (!Number.isFinite(value) || value <= 0 || value > bill.balance + 0.001 || !bankReference) {
    return res.status(400).json({ error: 'Enter a valid amount and bank transaction reference' });
  }
  if (await db.prepare(
    "SELECT id FROM billing_payments WHERE method = 'Bank transfer' AND LOWER(reference) = LOWER(?)"
  ).get(bankReference)) {
    return res.status(409).json({ error: 'That bank transaction reference has already been recorded' });
  }
  const id = uuid();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO billing_payments (id, patient_id, visit_id, amount, method, status, reference, created_at, data_json) ' +
    'VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, patientId, visitId, value, 'Bank transfer', 'pending', bankReference, now, JSON.stringify(req.body || {}));
  await writeAudit(req, 'bill.bank_transfer_pending', {
    entity: 'payment', entityId: id, patientId, visitId,
    note: `Bank transfer pending reconciliation: GHS ${value.toFixed(2)}`
  });
  res.status(201).json({ ok: true, paymentId: id, status: 'pending' });
});

router.post('/payments/:id/reconcile', async (req, res) => {
  const payment = await db.prepare('SELECT * FROM billing_payments WHERE id = ?').get(req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.method !== 'Bank transfer' || payment.status !== 'pending') {
    return res.status(409).json({ error: 'Only pending bank transfers can be reconciled' });
  }
  if (req.body.action === 'confirm') {
    return res.json(await settlePayment(Object.assign({}, payment, { role: req.user.role }), req.user.name));
  }
  if (req.body.action !== 'reject') return res.status(400).json({ error: 'Choose confirm or reject' });
  await db.prepare("UPDATE billing_payments SET status = 'rejected', received_at = ?, received_by = ? WHERE id = ?")
    .run(new Date().toISOString(), req.user.name, payment.id);
  await writeAudit(req, 'bill.bank_transfer_rejected', {
    entity: 'payment', entityId: payment.id, patientId: payment.patient_id, visitId: payment.visit_id,
    note: String(req.body.note || 'Bank transfer could not be verified').slice(0, 200)
  });
  res.json({ ok: true, status: 'rejected' });
});

router.post('/paystack/initialize', requireAuth, requireRole('admin', 'billing', 'receptionist'), async (req, res, next) => {
  try {
    const { patientId, visitId, amount, email } = req.body || {};
    const bill = await getBill(patientId, visitId);
    if (bill.error) return res.status(bill.status).json({ error: bill.error });
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > bill.balance + 0.001) {
      return res.status(400).json({ error: 'Payment amount must be positive and no more than the balance' });
    }
    const customerEmail = String(email || bill.patient.email || '').trim();
    if (!customerEmail) return res.status(400).json({ error: 'A patient email is required for Paystack checkout' });
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(503).json({ error: 'Paystack is not configured. Add PAYSTACK_SECRET_KEY to the backend environment.' });

    const reference = `LC-${uuid()}`;
    const publicAppUrl = (process.env.PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 4000}`)
      .replace(/\/+$/, '');
    const response = await fetch(`${PAYSTACK_URL}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: customerEmail,
        amount: Math.round(value * 100),
        currency: 'GHS',
        reference,
        callback_url: `${publicAppUrl}/billing.html?paystack_ref=${encodeURIComponent(reference)}`
      })
    });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data || !result.data.authorization_url) {
      return res.status(502).json({ error: result.message || 'Could not start Paystack checkout' });
    }

    const id = uuid();
    const now = new Date().toISOString();
    await db.prepare(
      'INSERT INTO billing_payments (id, patient_id, visit_id, amount, method, status, reference, provider_reference, created_at, data_json) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(id, patientId, visitId, value, 'Paystack checkout', 'pending', reference, reference, now,
      JSON.stringify({ email: customerEmail }));
    res.json({ ok: true, paymentId: id, reference, authorizationUrl: result.data.authorization_url });
  } catch (error) { next(error); }
});

router.post('/paystack/verify', requireAuth, requireRole('admin', 'billing', 'receptionist'), async (req, res, next) => {
  try {
    const reference = String((req.body || {}).reference || '').trim();
    if (!reference) return res.status(400).json({ error: 'Payment reference is required' });
    res.json(await confirmPaystack(reference));
  } catch (error) { next(error); }
});

router.post('/paystack/webhook', async (req, res, next) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.status(503).json({ error: 'Paystack is not configured' });
    const signature = req.get('x-paystack-signature') || '';
    const expected = crypto.createHmac('sha512', secret).update(req.rawBody || '').digest('hex');
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return res.status(401).json({ error: 'Invalid Paystack signature' });
    }
    if (req.body.event === 'charge.success' && req.body.data && req.body.data.reference) {
      await confirmPaystack(req.body.data.reference);
    }
    res.json({ received: true });
  } catch (error) { next(error); }
});

router.get('/claims', async (req, res) => {
  const claims = await db.prepare('SELECT * FROM insurance_claims ORDER BY created_at DESC LIMIT 500').all();
  res.json(claims.map(claim => Object.assign({}, JSON.parse(claim.data_json || '{}'), {
    id: claim.id, patientId: claim.patient_id, visitId: claim.visit_id,
    payer: claim.payer, memberNumber: claim.member_number, claimNumber: claim.claim_number,
    amount: claim.amount, status: claim.status, createdAt: claim.created_at,
    updatedAt: claim.updated_at, createdBy: claim.created_by
  })));
});

router.post('/claims', async (req, res) => {
  const { patientId, visitId, payer, memberNumber, claimNumber, amount, notes } = req.body || {};
  const value = Number(amount);
  let claim;
  await db.exec('BEGIN IMMEDIATE');
  try {
    if (db.postgres) {
      await db.prepare('SELECT id FROM patients WHERE id = ? FOR UPDATE').get(patientId);
    }
    const bill = await getBill(patientId, visitId);
    if (bill.error) {
      await db.exec('ROLLBACK');
      return res.status(bill.status).json({ error: bill.error });
    }
    const reserved = await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS amount FROM insurance_claims " +
      "WHERE visit_id = ? AND status IN ('submitted', 'approved')"
    ).get(visitId).amount;
    const claimableBalance = Math.max(0, bill.balance - reserved);
    if (!String(payer || '').trim() || !String(memberNumber || '').trim() ||
        !Number.isFinite(value) || value <= 0 || value > claimableBalance + 0.001) {
      await db.exec('ROLLBACK');
      return res.status(400).json({ error: 'Enter insurer, member number, and a claim amount within the unclaimed balance' });
    }
    const id = uuid();
    const now = new Date().toISOString();
    claim = {
      id, patientId, visitId, payer: String(payer).trim(), memberNumber: String(memberNumber).trim(),
      claimNumber: String(claimNumber || '').trim(), amount: value, notes: String(notes || '').trim(),
      status: 'submitted', createdAt: now, updatedAt: now, createdBy: req.user.name
    };
    await db.prepare(
      'INSERT INTO insurance_claims (id, patient_id, visit_id, payer, member_number, claim_number, amount, status, created_at, updated_at, created_by, data_json) ' +
      'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(id, patientId, visitId, claim.payer, claim.memberNumber, claim.claimNumber, value,
      claim.status, now, now, req.user.name, JSON.stringify(claim));
    await db.exec('COMMIT');
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch (rollbackError) { console.error('[billing] rollback failed:', rollbackError); }
    throw error;
  }
  await writeAudit(req, 'bill.insurance_claim_submitted', {
    entity: 'insurance_claim', entityId: claim.id, patientId, visitId,
    note: `Claim submitted to ${claim.payer}: GHS ${value.toFixed(2)}`
  });
  res.status(201).json(claim);
});

router.patch('/claims/:id', async (req, res) => {
  const claim = await db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Insurance claim not found' });
  const status = String((req.body || {}).status || '');
  if (!['approved', 'rejected', 'paid'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved, rejected, or paid' });
  }
  if (claim.status === 'paid') return res.status(409).json({ error: 'A paid claim cannot be changed' });
  if ((status === 'approved' || status === 'rejected') && claim.status !== 'submitted') {
    return res.status(409).json({ error: 'Only submitted claims can be approved or rejected' });
  }
  if (status === 'paid') {
    if (claim.status !== 'approved') return res.status(409).json({ error: 'Approve the claim before recording insurer payment' });
    let payment = await db.prepare(
      "SELECT * FROM billing_payments WHERE method = 'Insurance' AND reference = ?"
    ).get(claim.id);
    if (!payment) {
      const paymentId = uuid();
      const paymentNow = new Date().toISOString();
      await db.prepare(
        'INSERT INTO billing_payments (id, patient_id, visit_id, amount, method, status, reference, created_at, data_json) ' +
        'VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(paymentId, claim.patient_id, claim.visit_id, claim.amount, 'Insurance', 'pending',
        claim.id, paymentNow, JSON.stringify({ claimId: claim.id, claimNumber: claim.claim_number }));
      payment = await db.prepare('SELECT * FROM billing_payments WHERE id = ?').get(paymentId);
    }
    if (payment.status !== 'successful') {
      try {
        await settlePayment(Object.assign({}, payment, { role: req.user.role }), req.user.name);
      } catch (error) {
        await db.prepare('DELETE FROM billing_payments WHERE id = ? AND status = ?').run(payment.id, 'pending');
        throw error;
      }
    }
  }
  const now = new Date().toISOString();
  const data = JSON.parse(claim.data_json || '{}');
  data.status = status;
  data.updatedAt = now;
  data.resolutionNote = String(req.body.note || '').trim();
  await db.prepare('UPDATE insurance_claims SET status = ?, updated_at = ?, data_json = ? WHERE id = ?')
    .run(status, now, JSON.stringify(data), claim.id);
  await writeAudit(req, `bill.insurance_claim_${status}`, {
    entity: 'insurance_claim', entityId: claim.id, patientId: claim.patient_id, visitId: claim.visit_id,
    note: data.resolutionNote
  });
  res.json(data);
});

module.exports = router;
