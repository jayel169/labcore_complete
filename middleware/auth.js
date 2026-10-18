// middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../db');

if (process.env.NODE_ENV === 'production' &&
    (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Production requires a JWT_SECRET of at least 32 characters.');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

/** Issues a signed JWT for a staff member. */
function issueToken(staff) {
  const payload = {
    sub: staff.id,
    role: staff.role,
    name: staff.name
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });
}

/** Verifies the Bearer token, loads the staff, attaches to req.user. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (payload.setup) return res.status(401).json({ error: 'security_setup_required' });

  // Confirm the login session exists, remains active, and has not expired.
  const session = await db.prepare('SELECT revoked, expires_at FROM sessions WHERE token = ?').get(token);
  if (!session || session.revoked || Date.parse(session.expires_at) <= Date.now()) {
    return res.status(401).json({ error: 'Session revoked' });
  }

  const staff = await db.prepare('SELECT * FROM staff WHERE id = ?').get(payload.sub);
  if (!staff || staff.status !== 'active') {
    return res.status(401).json({ error: 'Account inactive' });
  }
  if (!staff.password_hash || !staff.totp_enabled || !staff.totp_secret) {
    return res.status(403).json({
      error: 'security_setup_required',
      message: 'Sign-in now requires a strong password and authenticator app setup.'
    });
  }

  req.user = staff;
  req.token = token;
  next();
}

/** Role gate. Usage: requireRole('admin') or requireRole('admin','scientist'). */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

module.exports = { issueToken, requireAuth, requireRole, JWT_SECRET };