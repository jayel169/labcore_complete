const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'scientist', 'receptionist'));

function timeFromOrder(data, receivedAt) {
  const received = data.specimenReceivedAt || receivedAt ||
    (data.specimenReceivedDate
      ? data.specimenReceivedDate + (data.specimenReceivedTime ? 'T' + data.specimenReceivedTime : 'T00:00')
      : null);
  if (!received) return null;
  const value = String(received);
  const normalized = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(value)
    ? (value.length === 10 ? value + 'T00:00:00Z' : value + 'Z')
    : value;
  return Number.isFinite(Date.parse(normalized)) ? new Date(normalized).toISOString() : null;
}

router.get('/', async (req, res) => {
  const targets = await db.prepare('SELECT panel, target_hours, updated_at, updated_by FROM tat_targets ORDER BY panel').all();
  const targetMap = new Map(targets.map(target => [target.panel.toLowerCase(), target]));
  const rows = await db.prepare(`
    SELECT o.*, p.full_name, e.consultant, e.department,
      COALESCE(e.data_json, '{}') AS encounter_json,
      s.received_at AS registered_specimen_received
    FROM orders o
    JOIN patients p ON p.id=o.patient_id
    JOIN encounters e ON e.visit_id=o.encounter_id
    LEFT JOIN specimens s ON s.specimen_id=o.specimen_id
    WHERE o.type='Laboratory'
    ORDER BY COALESCE(s.received_at, o.ordered_at) ASC LIMIT 5000
  `).all();
  const now = Date.now();
  const open = [];
  const completed = [];
  rows.forEach(row => {
    const data = row.data_json ? JSON.parse(row.data_json) : {};
    const startAt = timeFromOrder(data, row.registered_specimen_received);
    if (!startAt) return;
    const target = targetMap.get(String(row.item || '').toLowerCase());
    const finishAt = row.validated_at || data.validatedAt || null;
    const ageHours = Math.max(0, ((finishAt ? Date.parse(finishAt) : now) - Date.parse(startAt)) / 3600000);
    const item = {
      orderId: row.id,
      patientId: row.patient_id,
      patientName: row.full_name,
      visitId: row.encounter_id,
      specimenId: row.specimen_id || data.specimenId || '',
      panel: row.item || '',
      department: row.department || '',
      clinician: row.consultant || '',
      priority: row.priority || 'Routine',
      status: row.result_status || row.status || 'Pending',
      receivedAt: startAt,
      enteredAt: row.entered_at || data.enteredAt || null,
      validatedAt: finishAt,
      ageHours: Number(ageHours.toFixed(2)),
      targetHours: target ? target.target_hours : null,
      overdue: !!target && !finishAt && ageHours > target.target_hours,
      metTarget: !!target && !!finishAt && ageHours <= target.target_hours
    };
    (finishAt ? completed : open).push(item);
  });

  const byPanel = new Map();
  targets.forEach(target => {
    const key = target.panel.toLowerCase();
    if (!byPanel.has(key)) {
      byPanel.set(target.panel.toLowerCase(), {
        panel: target.panel, total: 0, completed: 0, open: 0, overdue: 0,
        metTarget: 0, tatTotal: 0, tatCount: 0, targetHours: target.target_hours
      });
    }
  });

  open.concat(completed).forEach(item => {
    const key = item.panel.toLowerCase();
    if (!byPanel.has(key)) byPanel.set(key, { panel: item.panel, total: 0, completed: 0, open: 0, overdue: 0, metTarget: 0, tatTotal: 0, tatCount: 0, targetHours: item.targetHours });
    const panel = byPanel.get(key);
    panel.total++;
    if (item.validatedAt) {
      panel.completed++;
      panel.tatTotal += item.ageHours;
      panel.tatCount++;
      if (item.metTarget) panel.metTarget++;
    } else {
      panel.open++;
      if (item.overdue) panel.overdue++;
    }
  });
  const panels = Array.from(byPanel.values()).map(panel => ({
    panel: panel.panel,
    total: panel.total,
    completed: panel.completed,
    open: panel.open,
    overdue: panel.overdue,
    metTarget: panel.metTarget,
    averageHours: panel.tatCount ? Number((panel.tatTotal / panel.tatCount).toFixed(2)) : null,
    targetHours: panel.targetHours
  })).sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.panel.localeCompare(b.panel));
  const validatedOrders = rows.map(row => {
    const data = row.data_json ? JSON.parse(row.data_json) : {};
    const start = timeFromOrder(data, row.registered_specimen_received);
    const finish = row.validated_at || data.validatedAt || null;
    return start && finish ? Math.max(0, (Date.parse(finish) - Date.parse(start)) / 3600000) : null;
  }).filter(value => value !== null);

  res.json({
    generatedAt: new Date(now).toISOString(),
    summary: {
      completedCount: validatedOrders.length,
      averageCompletedHours: validatedOrders.length
        ? Number((validatedOrders.reduce((sum, value) => sum + value, 0) / validatedOrders.length).toFixed(2))
        : null
    },
    open: open.sort((a, b) => b.ageHours - a.ageHours),
    completed: completed.sort((a, b) => Date.parse(b.validatedAt) - Date.parse(a.validatedAt)).slice(0, 200),
    panels,
    targets
  });
});

router.put('/targets/:panel', requireRole('admin'), async (req, res) => {
  const panel = String(req.params.panel || '').trim();
  const raw = (req.body || {}).targetHours;
  const targetHours = (typeof raw === 'number' || typeof raw === 'string') && String(raw).trim() !== '' ? Number(raw) : NaN;
  if (!panel || panel.length > 160 || !Number.isFinite(targetHours) || targetHours <= 0 || targetHours > 720) {
    return res.status(400).json({ error: 'invalid_target', message: 'Enter a target between 0 and 720 hours.' });
  }
  const now = new Date().toISOString();
  const previous = await db.prepare('SELECT panel, target_hours FROM tat_targets WHERE LOWER(panel)=LOWER(?)').get(panel);
  const conflictTarget = db.postgres ? 'ON CONFLICT (LOWER(panel))' : 'ON CONFLICT(panel)';
  await db.prepare(`
    INSERT INTO tat_targets (panel, target_hours, updated_at, updated_by)
    VALUES (?, ?, ?, ?)
    ${conflictTarget} DO UPDATE SET target_hours=excluded.target_hours,
      updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run(panel, targetHours, now, req.user.name);
  await writeAudit(req, 'tat.target.updated', {
    entity: 'tat_target', entityId: panel,
    before: previous ? { targetHours: previous.target_hours } : null,
    after: { targetHours }, note: 'Turnaround target updated in hours'
  });
  res.json({ panel, targetHours, updatedAt: now, updatedBy: req.user.name });
});

module.exports = router;
