const db = require('../db');

function facilityDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Accra',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

async function checkQcForOrder(order) {
  const results = order.results && typeof order.results === 'object' ? order.results : {};
  const holds = [];

  for (const test of Object.keys(results)) {
    const controls = await db.prepare(`
      SELECT * FROM qc_controls
      WHERE active = 1 AND LOWER(panel) = LOWER(?) AND LOWER(test) = LOWER(?)
    `).all(order.item || '', test);
    if (!controls.length) continue;

    const instrument = String(order.instrument || order.analyser || '').trim();
    if (!instrument) {
      holds.push({ test, reason: 'instrument_missing' });
      continue;
    }
    const matching = controls.filter(control =>
      control.instrument.trim().toLowerCase() === instrument.toLowerCase()
    );
    if (!matching.length) continue;

    const today = facilityDate(new Date());
    for (const control of matching) {
      if (control.expires_on && control.expires_on < today) {
        holds.push({ test, instrument, level: control.level, reason: 'control_expired' });
        continue;
      }
      const latest = await db.prepare(`
        SELECT status, run_at FROM qc_runs
        WHERE control_id = ? AND substr(run_at, 1, 10) = ?
        ORDER BY run_at DESC, id DESC LIMIT 1
      `).get(control.id, today);
      if (!latest || latest.status !== 'Pass') {
        holds.push({
          test,
          instrument,
          level: control.level,
          reason: latest ? 'latest_qc_failed' : 'qc_not_run_today'
        });
      }
    }
  }

  return holds;
}

module.exports = { checkQcForOrder };
