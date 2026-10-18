// utils/audit.js — server-side audit writer
const db = require('../db');
const { v4: uuid } = require('uuid');

async function writeAudit(req, event, payload = {}) {
  try {
    const user = req.user || {};
    await db.prepare(`
      INSERT INTO audit_log
      (audit_id, event, at, by_name, role, role_label, entity, entity_id,
       patient_id, patient_name, visit_id, specimen_id, panel, test,
       department, before_json, after_json, note, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      event,
      new Date().toISOString(),
      user.name || 'Unknown',
      user.role || '',
      '', // roleLabel — fill in if you have a lookup
      payload.entity || '',
      payload.entityId || '',
      payload.patientId || '',
      payload.patientName || '',
      payload.visitId || '',
      payload.specimenId || '',
      payload.panel || '',
      payload.test || '',
      payload.department || '',
      payload.before ? JSON.stringify(payload.before) : null,
      payload.after ? JSON.stringify(payload.after) : null,
      payload.note || '',
      typeof payload.durationMs === 'number' ? payload.durationMs : null
    );
  } catch (e) {
    console.error('[audit] write failed:', e.message);
  }
}

module.exports = { writeAudit };