const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { issueToken, requireAuth, JWT_SECRET } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');
const { generateSecret, verifyCode, encryptSecret, decryptSecret } = require('../utils/totp');

const router = express.Router();
const SESSION_MS = 12 * 60 * 60 * 1000;

function sessionExpiry() {
  return new Date(Date.now() + SESSION_MS).toISOString();
}

async function createSession(staff, token, now) {
  await db.prepare('INSERT INTO sessions (token, staff_id, issued_at, expires_at) VALUES (?,?,?,?)')
    .run(token, staff.id, now, sessionExpiry());
}

async function issueSetupSession(staff, res) {
  const token = jwt.sign({ sub: staff.id, setup: true }, JWT_SECRET, { expiresIn: '15m' });
  await createSession(staff, token, new Date().toISOString());
  return res.json({
    ok: true,
    setupRequired: true,
    token,
    user: { id: staff.id, name: staff.name, role: staff.role, email: staff.email }
  });
}

function passwordIsStrong(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128 &&
    /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
}

async function verifySetupSession(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing setup token' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(401).json({ error: 'Invalid setup session' });
  }
  if (!payload.setup || !payload.sub) return res.status(401).json({ error: 'Invalid setup session' });
  const session = await db.prepare('SELECT revoked, expires_at FROM sessions WHERE token=? AND staff_id=?').get(token, payload.sub);
  const staff = await db.prepare('SELECT * FROM staff WHERE id=? AND status=?').get(payload.sub, 'active');
  if (!session || session.revoked || Date.parse(session.expires_at) <= Date.now() || !staff) {
    return res.status(401).json({ error: 'Setup session expired' });
  }
  req.setupToken = token;
  req.user = staff;
  next();
}

router.post('/login', async (req, res) => {
  const { email, password, pin, totp } = req.body || {};
  const credential = String(password || pin || '');
  if (!email || !credential) return res.status(400).json({ error: 'Email and password required' });

  const staff = await db.prepare('SELECT * FROM staff WHERE LOWER(email) = ?').get(String(email).trim().toLowerCase());
  if (!staff) return res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
  if (staff.status !== 'active') return res.status(403).json({ error: 'disabled', message: 'Account disabled.' });

  if (!staff.password_hash) {
    if (!bcrypt.compareSync(credential, staff.pin_hash)) {
      await writeAudit({ user: { name: staff.name, role: staff.role } }, 'session.login_failed', {
        entity: 'staff', entityId: staff.id, note: 'Invalid initial credential'
      });
      return res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
    }
    await writeAudit({ user: { name: staff.name, role: staff.role } }, 'session.security_setup_required', {
      entity: 'staff', entityId: staff.id, note: 'Initial one-time credential used'
    });
    return await issueSetupSession(staff, res);
  }

  if (!bcrypt.compareSync(credential, staff.password_hash)) {
    await writeAudit({ user: { name: staff.name, role: staff.role } }, 'session.login_failed', {
      entity: 'staff', entityId: staff.id, note: 'Invalid credentials'
    });
    return res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' });
  }
  if (!staff.totp_enabled || !staff.totp_secret) return await issueSetupSession(staff, res);

  let secret;
  try {
    secret = decryptSecret(staff.totp_secret);
  } catch (error) {
    console.error('[auth] could not decrypt MFA secret for staff account:', staff.id);
    return res.status(500).json({ error: 'mfa_configuration_error' });
  }
  const acceptedStep = verifyCode(secret, totp);
  if (acceptedStep === null || (staff.last_totp_step != null && acceptedStep <= staff.last_totp_step)) {
    await writeAudit({ user: { name: staff.name, role: staff.role } }, 'session.login_failed', {
      entity: 'staff', entityId: staff.id, note: 'Invalid or replayed MFA code'
    });
    return res.status(401).json({ error: 'invalid_mfa', message: 'Authenticator code is invalid or has already been used.' });
  }

  const now = new Date().toISOString();
  const token = issueToken(staff);
  await createSession(staff, token, now);
  await db.prepare('UPDATE staff SET last_login_at=?, login_count=COALESCE(login_count,0)+1, last_totp_step=? WHERE id=?')
    .run(now, acceptedStep, staff.id);
  await writeAudit({ user: staff }, 'session.login', { entity: 'staff', entityId: staff.id, note: 'Password and MFA login' });
  res.json({
    ok: true,
    token,
    expiresAt: sessionExpiry(),
    user: {
      id: staff.id, name: staff.name, role: staff.role, email: staff.email,
      department: staff.department, employeeId: staff.employee_id,
      wardIds: staff.ward_ids ? JSON.parse(staff.ward_ids) : []
    }
  });
});

router.post('/security/setup', verifySetupSession, async (req, res) => {
  const { password, secret, code } = req.body || {};
  if (!passwordIsStrong(password)) {
    return res.status(400).json({
      error: 'weak_password',
      message: 'Use 12–128 characters with uppercase and lowercase letters and at least one number.'
    });
  }
  if (!/^[A-Z2-7]{32}$/.test(String(secret || ''))) {
    return res.status(400).json({ error: 'invalid_totp_secret' });
  }
  const acceptedStep = verifyCode(secret, code);
  if (acceptedStep === null) return res.status(400).json({ error: 'invalid_mfa', message: 'Authenticator code does not match the secret.' });

  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync(password, 12);
  const encryptedSecret = encryptSecret(secret);
  await db.exec('BEGIN IMMEDIATE');
  try {
    await db.prepare(`
      UPDATE staff SET password_hash=?, totp_secret=?, totp_enabled=1, last_totp_step=?
      WHERE id=?
    `).run(passwordHash, encryptedSecret, acceptedStep, req.user.id);
    await db.prepare('UPDATE sessions SET revoked=1 WHERE staff_id=?').run(req.user.id);
    const token = issueToken(req.user);
    await createSession(req.user, token, now);
    await db.prepare('UPDATE staff SET last_login_at=?, login_count=COALESCE(login_count,0)+1 WHERE id=?')
      .run(now, req.user.id);
    await db.exec('COMMIT');
    await writeAudit({ user: req.user }, 'account.security_enrolled', {
      entity: 'staff', entityId: req.user.id, note: 'Strong password and authenticator MFA enrolled'
    });
    res.json({
      ok: true, token, expiresAt: sessionExpiry(),
      user: { id: req.user.id, name: req.user.name, role: req.user.role, email: req.user.email }
    });
  } catch (error) {
    await db.exec('ROLLBACK');
    console.error('[auth] security enrollment failed:', error);
    res.status(500).json({ error: 'security_setup_failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const staff = req.user;
  res.json({
    id: staff.id, name: staff.name, role: staff.role, email: staff.email,
    department: staff.department, employeeId: staff.employee_id,
    wardIds: staff.ward_ids ? JSON.parse(staff.ward_ids) : [],
    mfaEnabled: !!staff.totp_enabled
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  await db.prepare('UPDATE sessions SET revoked=1 WHERE token=?').run(req.token);
  await writeAudit(req, 'session.logout', { entity: 'staff', entityId: req.user.id, note: 'Logout' });
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword, totp } = req.body || {};
  if (!bcrypt.compareSync(String(currentPassword || ''), req.user.password_hash || '')) {
    return res.status(401).json({ error: 'invalid_credentials', message: 'Current password is incorrect.' });
  }
  if (!passwordIsStrong(newPassword)) {
    return res.status(400).json({
      error: 'weak_password',
      message: 'Use 12–128 characters with uppercase and lowercase letters and at least one number.'
    });
  }
  const acceptedStep = verifyCode(decryptSecret(req.user.totp_secret), totp);
  if (acceptedStep === null || (req.user.last_totp_step != null && acceptedStep <= req.user.last_totp_step)) {
    return res.status(401).json({ error: 'invalid_mfa', message: 'Authenticator code is invalid or has already been used.' });
  }
  const now = new Date().toISOString();
  await db.prepare('UPDATE staff SET password_hash=?, last_totp_step=? WHERE id=?')
    .run(bcrypt.hashSync(newPassword, 12), acceptedStep, req.user.id);
  await db.prepare('UPDATE sessions SET revoked=1 WHERE staff_id=? AND token!=?').run(req.user.id, req.token);
  await writeAudit(req, 'account.password_changed', { entity: 'staff', entityId: req.user.id, note: 'Password changed; other sessions revoked' });
  res.json({ ok: true, changedAt: now });
});

module.exports = router;
