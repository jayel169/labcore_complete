// routes/staff.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
const ALLOWED_ROLES = new Set([
  'scientist', 'doctor', 'receptionist', 'billing', 'nurse',
  'sonographer', 'radiographer', 'admin'
]);

function rowToStaff(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    name: r.name,
    role: r.role,
    department: r.department,
    wardIds: r.ward_ids ? JSON.parse(r.ward_ids) : [],
    email: r.email,
    phone: r.phone,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
    createdBy: r.created_by,
    lastLoginAt: r.last_login_at,
    loginCount: r.login_count
  };
}

async function nextEmployeeId() {
  const ids = await db.prepare('SELECT employee_id FROM staff').all();
  const max = ids.reduce((current, row) => {
    const match = String(row.employee_id || '').match(/(\d+)$/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 123);
  let candidate = max + 1;
  while (await db.prepare('SELECT id FROM staff WHERE employee_id = ?').get(
    'EMP-' + String(candidate).padStart(5, '0')
  )) candidate++;
  return 'EMP-' + String(candidate).padStart(5, '0');
}

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const rows = await db.prepare('SELECT * FROM staff ORDER BY name').all();
  res.json(rows.map(rowToStaff));
});

router.get('/directory', requireAuth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT id, employee_id, name, role, department
    FROM staff
    WHERE status = 'active' AND role IN ('doctor', 'nurse', 'sonographer', 'radiographer')
    ORDER BY name
  `).all();
  res.json(rows.map(row => ({
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    role: row.role,
    department: row.department || ''
  })));
});

router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const p = req.body || {};
  if (!p.name || !p.role || !p.pin || !p.email) {
    return res.status(400).json({ error: 'name, role, pin, email required' });
  }
  if (!ALLOWED_ROLES.has(p.role)) return res.status(400).json({ error: 'invalid_role' });
  if (!/^\d{4,}$/.test(String(p.pin))) return res.status(400).json({ error: 'pin must contain at least 4 digits' });
  const email = String(p.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const existing = await db.prepare('SELECT id FROM staff WHERE LOWER(email)=?').get(email);
  if (existing) return res.status(409).json({ error: 'email_taken' });
  const employeeId = String(p.employeeId || '').trim() || await nextEmployeeId();
  if (await db.prepare('SELECT id FROM staff WHERE employee_id = ?').get(employeeId)) {
    return res.status(409).json({ error: 'employee_id_taken' });
  }

  const id = uuid();
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(String(p.pin), 10);

  await db.prepare(`
    INSERT INTO staff (id, employee_id, name, role, department, ward_ids, email, phone,
                       pin_hash, status, notes, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?, 'active', ?, ?, ?)
  `).run(id, employeeId, p.name, p.role, p.department || '', JSON.stringify(p.wardIds || []),
         email, p.phone || '', hash, p.notes || '', now, req.user.name);

  await writeAudit(req, 'staff.created', { entity: 'staff', entityId: id, note: `Created ${p.name} (${employeeId})` });
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  res.json(rowToStaff(row));
});

router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const p = req.body || {};
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (p.role && !ALLOWED_ROLES.has(p.role)) return res.status(400).json({ error: 'invalid_role' });
  const email = p.email == null ? row.email : String(p.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
  const existing = await db.prepare('SELECT id FROM staff WHERE LOWER(email)=? AND id!=?').get(email, id);
  if (existing) return res.status(409).json({ error: 'email_taken' });
  if (p.employeeId != null) {
    const employeeId = String(p.employeeId).trim();
    const existingEmployee = await db.prepare(
      'SELECT id FROM staff WHERE employee_id=? AND id!=?'
    ).get(employeeId, id);
    if (!employeeId || existingEmployee) return res.status(409).json({ error: 'employee_id_taken' });
  }

  await db.prepare(`
    UPDATE staff SET name=?, role=?, department=?, ward_ids=?, email=?, phone=?,
                     notes=?, employee_id=?, status=? WHERE id=?
  `).run(
    p.name ?? row.name,
    p.role ?? row.role,
    p.department ?? row.department,
    JSON.stringify(p.wardIds ?? (row.ward_ids ? JSON.parse(row.ward_ids) : [])),
    email,
    p.phone ?? row.phone,
    p.notes ?? row.notes,
    p.employeeId ?? row.employee_id,
    p.status ?? row.status,
    id
  );

  await writeAudit(req, 'staff.updated', { entity: 'staff', entityId: id, note: 'Updated ' + (p.name || row.name) });
  res.json(rowToStaff(await db.prepare('SELECT * FROM staff WHERE id = ?').get(id)));
});

router.post('/:id/reset-pin', requireAuth, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const { newPin } = req.body || {};
  if (!/^\d{4,}$/.test(String(newPin || ''))) {
    return res.status(400).json({ error: 'pin must contain at least 4 digits' });
  }
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const hash = bcrypt.hashSync(String(newPin), 10);
  await db.prepare(`
    UPDATE staff SET pin_hash=?, password_hash=NULL, totp_secret=NULL,
      totp_enabled=0, last_totp_step=NULL WHERE id=?
  `).run(hash, id);
  await db.prepare('UPDATE sessions SET revoked=1 WHERE staff_id=?').run(id);
  await writeAudit(req, 'staff.pin_reset', { entity: 'staff', entityId: id, note: 'Reset temporary security setup PIN for ' + row.name + '; revoked existing sessions' });
  res.json({ ok: true });
});

router.post('/:id/disable', requireAuth, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (row.role === 'admin') {
    const activeAdmins = await db.prepare("SELECT COUNT(*) as n FROM staff WHERE role='admin' AND status='active' AND id != ?").get(id);
    if (Number(activeAdmins.n) === 0) return res.status(400).json({ error: 'last_admin' });
  }

  await db.prepare("UPDATE staff SET status='disabled' WHERE id = ?").run(id);
  await db.prepare("UPDATE sessions SET revoked=1 WHERE staff_id = ?").run(id);  // kick them out
  await writeAudit(req, 'staff.disabled', {
    entity: 'staff', entityId: id,
    note: String(req.body && req.body.reason || '').trim() || ('Disabled ' + row.name)
  });
  res.json({ ok: true });
});

router.post('/:id/enable', requireAuth, requireRole('admin'), async (req, res) => {
  await db.prepare("UPDATE staff SET status='active' WHERE id = ?").run(req.params.id);
  await writeAudit(req, 'staff.enabled', { entity: 'staff', entityId: req.params.id, note: 'Re-enabled' });
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const row = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if ((row.login_count || 0) > 0) return res.status(400).json({ error: 'has_history' });
  await db.prepare('DELETE FROM staff WHERE id = ?').run(req.params.id);
  await writeAudit(req, 'staff.deleted', { entity: 'staff', entityId: req.params.id, note: 'Deleted ' + row.name });
  res.json({ ok: true });
});

module.exports = router;