// shared/labcore-analytics.js
(function () {
  'use strict';

  const CACHE_KEY = 'labcore_analytics_cache';
  const CACHE_TTL_MS = 60 * 1000; // 60s

  // ---------- WEEK / DATE HELPERS (ISO Mon–Sun) ----------
  function startOfWeek(d) {
    d = d ? new Date(d) : new Date();
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day === 0 ? -6 : 1 - day); // shift so Mon=0
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
  }
  function endOfWeek(d) {
    const mon = startOfWeek(d);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return sun;
  }
  function startOfDay(d) { const x = d ? new Date(d) : new Date(); x.setHours(0,0,0,0); return x; }
  function endOfDay(d) { const x = d ? new Date(d) : new Date(); x.setHours(23,59,59,999); return x; }
  function startOfMonth(d) { const x = d ? new Date(d) : new Date(); x.setDate(1); x.setHours(0,0,0,0); return x; }
  function endOfMonth(d) { const x = d ? new Date(d) : new Date(); x.setMonth(x.getMonth()+1, 0); x.setHours(23,59,59,999); return x; }

  window.lcRangePreset = function (name) {
    const now = new Date();
    switch (name) {
      case 'today':     return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };
      case 'week':      return { from: startOfWeek(now), to: endOfWeek(now), label: 'This week (Mon–Sun)' };
      case 'last7':     { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: startOfDay(f), to: endOfDay(now), label: 'Last 7 days' }; }
      case 'month':     return { from: startOfMonth(now), to: endOfMonth(now), label: 'This month' };
      case 'last30':    { const f = new Date(now); f.setDate(f.getDate() - 29); return { from: startOfDay(f), to: endOfDay(now), label: 'Last 30 days' }; }
      default:          return { from: startOfWeek(now), to: endOfWeek(now), label: 'This week (Mon–Sun)' };
    }
  };

  function inRange(iso, from, to) {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    return t >= from.getTime() && t <= to.getTime();
  }

  // ---------- DATA SOURCES ----------
  function loadPatients() {
    try { return JSON.parse(localStorage.getItem('hms_patients_v3') || '[]'); }
    catch (e) { return []; }
  }
  function loadAuditLog() {
    try { return JSON.parse(localStorage.getItem('labcore_audit_log') || '[]'); }
    catch (e) { return []; }
  }

  // ---------- CORE: WALK PATIENTS → FLATTEN ORDER FACTS ----------
  // Produces one record per (patient, encounter, order) — the atomic "case" unit.
  function flattenOrders() {
    const patients = loadPatients();
    const out = [];
    patients.forEach(function (p) {
      (p.encounters || []).forEach(function (enc) {
        (enc.orders || []).forEach(function (o) {
          if (o.type !== 'Laboratory') return;

          // TAT slices (hours, null if not applicable yet)
          const t_ordered   = o.orderedAt ? new Date(o.orderedAt).getTime() : null;
          const t_received  = (o.specimenReceivedDate)
            ? new Date(o.specimenReceivedDate + (o.specimenReceivedTime ? 'T' + o.specimenReceivedTime : 'T00:00')).getTime()
            : null;
          const t_entered   = o.enteredAt ? new Date(o.enteredAt).getTime() : null;
          const t_validated = o.validatedAt ? new Date(o.validatedAt).getTime() : null;
          const t_reported  = o.reportSentAt ? new Date(o.reportSentAt).getTime() : null;

          const hrs = function (a, b) { return (a && b && b >= a) ? (b - a) / 3600000 : null; };

          const tat_receive_entry  = hrs(t_received, t_entered);
          const tat_entry_valid    = hrs(t_entered, t_validated);
          const tat_receive_valid  = hrs(t_received, t_validated);
          const tat_order_valid    = hrs(t_ordered, t_validated);
          const tat_report         = hrs(t_validated, t_reported);

          // Who touched it (from auditTrail on the order — legacy field still populated)
          const enteredBy   = o.enteredBy   || (o.auditTrail || []).find(a => /entered|Preliminary|Submitted/i.test(a.event || ''))?.by || null;
          const validatedBy = o.validatedBy || (o.auditTrail || []).find(a => /Validated/i.test(a.event || ''))?.by || null;
          const rejectedBy  = o.rejectedBy  || (o.auditTrail || []).find(a => /Rejected/i.test(a.event || ''))?.by || null;
          const amendedBy   = o.amendedBy   || (o.auditTrail || []).find(a => /Amendment/i.test(a.event || ''))?.by || null;

          // Critical / abnormal flags from results
          let criticals = 0, abnormals = 0, resultCount = 0;
          Object.values(o.results || {}).forEach(function (r) {
            if (!r || r.value == null || r.value === '') return;
            resultCount++;
            const f = String(r.flag || '').toUpperCase();
            if (f === 'LL' || f === 'HH') criticals++;
            else if (f === 'L' || f === 'H' || /H\*/.test(f)) abnormals++;
          });

          out.push({
            patientId: p.id,
            patientName: p.fullName,
            patientSex: p.sex,
            patientDob: p.dob,
            visitId: enc.visitId,
            encounterDate: enc.date || (enc.createdAt || '').slice(0, 10),
            doctor: enc.consultant || '',
            department: enc.department || enc.service || '',
            panel: o.item,
            panelCode: o.code || '',
            specimenId: o.specimenId || '',
            priority: o.priority || 'Routine',
            status: o.status || '',
            resultStatus: o.resultStatus || '',
            orderedAt: o.orderedAt || null,
            receivedAt: o.specimenReceivedDate ? (o.specimenReceivedDate + (o.specimenReceivedTime ? 'T' + o.specimenReceivedTime : '')) : null,
            enteredAt: o.enteredAt || null,
            validatedAt: o.validatedAt || null,
            reportedAt: o.reportSentAt || null,
            enteredBy: enteredBy,
            validatedBy: validatedBy,
            rejectedBy: rejectedBy,
            amendedBy: amendedBy,
            isAmended: !!o.amended,
            isRejected: (o.resultStatus === 'Rejected') || !!o.rejectReason,
            criticals: criticals,
            abnormals: abnormals,
            resultCount: resultCount,
            tat_receive_entry: tat_receive_entry,
            tat_entry_valid: tat_entry_valid,
            tat_receive_valid: tat_receive_valid,
            tat_order_valid: tat_order_valid,
            tat_report: tat_report,
            _order: o,
            _enc: enc,
            _patient: p
          });
        });
      });
    });
    return out;
  }

  // ---------- AGGREGATORS ----------
  function median(nums) {
    const a = nums.filter(n => typeof n === 'number' && !isNaN(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(nums) {
    const a = nums.filter(n => typeof n === 'number' && !isNaN(n));
    if (!a.length) return null;
    return a.reduce((s, n) => s + n, 0) / a.length;
  }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 1000) / 10 : 0; }

  // ---------- PUBLIC API ----------
  const analytics = {};

  analytics.flatten = function () { return flattenOrders(); };

  analytics.forUser = function (userName, range) {
    range = range || window.lcRangePreset('week');
    const all = flattenOrders();
    const mine = all.filter(function (r) {
      const touched =
        r.enteredBy === userName ||
        r.validatedBy === userName ||
        r.rejectedBy === userName ||
        r.amendedBy === userName;
      if (!touched) return false;
      // in-range: any timestamp belonging to this user
      const timestamps = [
        r.enteredBy === userName && r.enteredAt,
        r.validatedBy === userName && r.validatedAt,
        r.amendedBy === userName && r.validatedAt,
        r.rejectedBy === userName && (r._order.rejectedAt || r._order.updatedAt)
      ].filter(Boolean);
      return timestamps.some(t => inRange(t, range.from, range.to));
    });

    // Count by action, only counting in-range occurrences
    let entered = 0, validated = 0, amended = 0, rejected = 0;
    const tatsValidated = [];
    const perTest = {};
    const perDay = {};

    mine.forEach(function (r) {
      if (r.enteredBy === userName && inRange(r.enteredAt, range.from, range.to)) {
        entered++;
        const day = (r.enteredAt || '').slice(0, 10);
        perDay[day] = perDay[day] || { entered: 0, validated: 0 };
        perDay[day].entered++;
      }
      if (r.validatedBy === userName && inRange(r.validatedAt, range.from, range.to)) {
        validated++;
        if (r.tat_receive_valid != null) tatsValidated.push(r.tat_receive_valid);
        const day = (r.validatedAt || '').slice(0, 10);
        perDay[day] = perDay[day] || { entered: 0, validated: 0 };
        perDay[day].validated++;
      }
      if (r.amendedBy === userName) amended++;
      if (r.rejectedBy === userName) rejected++;

      perTest[r.panel] = perTest[r.panel] || { count: 0, tatSum: 0, tatN: 0, criticals: 0 };
      perTest[r.panel].count++;
      if (r.tat_receive_valid != null) { perTest[r.panel].tatSum += r.tat_receive_valid; perTest[r.panel].tatN++; }
      perTest[r.panel].criticals += r.criticals;
    });

    Object.values(perTest).forEach(t => {
      t.avgTat = t.tatN ? t.tatSum / t.tatN : null;
      delete t.tatSum; delete t.tatN;
    });

    return {
      user: userName,
      range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      entered, validated, amended, rejected,
      totalTouched: mine.length,
      avgTatValidatedHours: mean(tatsValidated),
      medianTatValidatedHours: median(tatsValidated),
      criticalsAcked: mine.reduce((s, r) => s + r.criticals, 0),
      perTest,
      perDay
    };
  };

  analytics.forRole = function (roleId, range) {
    range = range || window.lcRangePreset('week');
    const log = loadAuditLog();
    const byUser = {};
    log.forEach(function (e) {
      if (e.role !== roleId) return;
      if (!inRange(e.at, range.from, range.to)) return;
      const k = e.by || 'Unknown';
      byUser[k] = byUser[k] || { events: 0, byEventType: {} };
      byUser[k].events++;
      byUser[k].byEventType[e.event] = (byUser[k].byEventType[e.event] || 0) + 1;
    });
    return { role: roleId, range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label }, users: byUser };
  };

  analytics.byTest = function (range, opts) {
    range = range || window.lcRangePreset('week');
    opts = opts || {};
    const all = flattenOrders();
    const bucket = {};

    all.forEach(function (r) {
      // choose anchor timestamp per test row
      const anchor = r.validatedAt || r.enteredAt || r.orderedAt;
      if (!inRange(anchor, range.from, range.to)) return;

      bucket[r.panel] = bucket[r.panel] || {
        panel: r.panel,
        code: r.panelCode,
        performed: 0,
        entered: 0,
        validated: 0,
        rejected: 0,
        amended: 0,
        criticals: 0,
        abnormals: 0,
        tatSum: 0, tatN: 0,
        tatEntrySum: 0, tatEntryN: 0,
        byUser: {}
      };
      const b = bucket[r.panel];
      b.performed++;
      if (r.enteredAt) b.entered++;
      if (r.validatedAt) b.validated++;
      if (r.isRejected) b.rejected++;
      if (r.isAmended) b.amended++;
      b.criticals += r.criticals;
      b.abnormals += r.abnormals;
      if (r.tat_receive_valid != null) { b.tatSum += r.tat_receive_valid; b.tatN++; }
      if (r.tat_receive_entry != null) { b.tatEntrySum += r.tat_receive_entry; b.tatEntryN++; }
      [r.enteredBy, r.validatedBy].filter(Boolean).forEach(u => {
        b.byUser[u] = b.byUser[u] || { entered: 0, validated: 0 };
        if (u === r.enteredBy) b.byUser[u].entered++;
        if (u === r.validatedBy) b.byUser[u].validated++;
      });
    });

    const arr = Object.values(bucket).map(function (b) {
      b.avgTatHours = b.tatN ? b.tatSum / b.tatN : null;
      b.avgTatEntryHours = b.tatEntryN ? b.tatEntrySum / b.tatEntryN : null;
      b.pctCritical = pct(b.criticals, b.performed);
      b.pctAbnormal = pct(b.abnormals, b.performed);
      delete b.tatSum; delete b.tatN; delete b.tatEntrySum; delete b.tatEntryN;
      return b;
    });
    arr.sort((a, b) => b.performed - a.performed);
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label }, tests: arr };
  };

  analytics.tatBreakdown = function (range) {
    range = range || window.lcRangePreset('week');
    const all = flattenOrders().filter(function (r) {
      const anchor = r.validatedAt || r.enteredAt || r.orderedAt;
      return inRange(anchor, range.from, range.to);
    });
    const recEntry = all.map(r => r.tat_receive_entry).filter(v => v != null);
    const entryVal = all.map(r => r.tat_entry_valid).filter(v => v != null);
    const recVal   = all.map(r => r.tat_receive_valid).filter(v => v != null);
    const ordVal   = all.map(r => r.tat_order_valid).filter(v => v != null);
    const valRep   = all.map(r => r.tat_report).filter(v => v != null);
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      receiveToEntry:   { avg: mean(recEntry), median: median(recEntry), n: recEntry.length },
      entryToValidated: { avg: mean(entryVal), median: median(entryVal), n: entryVal.length },
      receiveToValidated:{ avg: mean(recVal),  median: median(recVal),  n: recVal.length },
      orderToValidated: { avg: mean(ordVal),   median: median(ordVal),   n: ordVal.length },
      validatedToReported:{ avg: mean(valRep), median: median(valRep),   n: valRep.length }
    };
  };

  analytics.criticals = function (range) {
    range = range || window.lcRangePreset('week');
    const log = loadAuditLog();
    const all = flattenOrders();
    const list = [];
    all.forEach(function (r) {
      if (!r.criticals) return;
      const anchor = r.validatedAt || r.enteredAt;
      if (!inRange(anchor, range.from, range.to)) return;
      Object.entries(r._order.results || {}).forEach(function ([param, res]) {
        const f = String(res.flag || '').toUpperCase();
        if (f !== 'LL' && f !== 'HH') return;
        const ack = (r._order.auditTrail || []).find(a => /Critical acknowledged/i.test(a.event || '') && (a.note || '').indexOf(param) >= 0);
        list.push({
          patientId: r.patientId, patientName: r.patientName,
          visitId: r.visitId, specimenId: r.specimenId,
          panel: r.panel, param: param, value: res.value, unit: res.unit, flag: f,
          validatedBy: r.validatedBy, validatedAt: r.validatedAt,
          ackedBy: ack ? ack.by : null, ackedAt: ack ? ack.at : null,
          ackDelayMin: ack && r.validatedAt ? Math.round((new Date(ack.at) - new Date(r.validatedAt)) / 60000) : null
        });
      });
    });
    list.sort((a, b) => String(b.validatedAt).localeCompare(String(a.validatedAt)));
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label }, criticals: list };
  };

  analytics.amendments = function (range) {
    range = range || window.lcRangePreset('week');
    const log = loadAuditLog().filter(e => e.event === 'result.amended');
    const inRangeLog = log.filter(e => inRange(e.at, range.from, range.to));
    const byUser = {};
    inRangeLog.forEach(e => {
      byUser[e.by] = byUser[e.by] || { count: 0, items: [] };
      byUser[e.by].count++;
      byUser[e.by].items.push(e);
    });
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label }, total: inRangeLog.length, byUser, entries: inRangeLog };
  };

  analytics.rejections = function (range) {
    range = range || window.lcRangePreset('week');
    const log = loadAuditLog().filter(e => e.event === 'specimen.rejected');
    const inRangeLog = log.filter(e => inRange(e.at, range.from, range.to));
    const byUser = {};
    inRangeLog.forEach(e => {
      byUser[e.by] = byUser[e.by] || { count: 0, reasons: {} };
      byUser[e.by].count++;
      const r = (e.note || 'unspecified').slice(0, 40);
      byUser[e.by].reasons[r] = (byUser[e.by].reasons[r] || 0) + 1;
    });
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label }, total: inRangeLog.length, byUser, entries: inRangeLog };
  };

  analytics.allUsers = function (range) {
    range = range || window.lcRangePreset('week');
    const log = loadAuditLog().filter(e => inRange(e.at, range.from, range.to));
    const map = {};
    log.forEach(e => {
      const k = e.by || 'Unknown';
      map[k] = map[k] || { user: k, role: e.role, roleLabel: e.roleLabel, events: 0, entered: 0, validated: 0, amended: 0, rejected: 0 };
      map[k].events++;
      if (/entered|Preliminary|Submitted/i.test(e.event)) map[k].entered++;
      if (/validated/i.test(e.event)) map[k].validated++;
      if (/amended/i.test(e.event)) map[k].amended++;
      if (/rejected/i.test(e.event)) map[k].rejected++;
    });
    return { range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label }, users: Object.values(map) };
  };

  analytics.overview = function (range) {
    range = range || window.lcRangePreset('week');
    const byTest = analytics.byTest(range);
    const log = loadAuditLog().filter(e => inRange(e.at, range.from, range.to));
    const all = flattenOrders().filter(r => {
      const a = r.validatedAt || r.enteredAt || r.orderedAt;
      return inRange(a, range.from, range.to);
    });
    const totalPerformed = all.length;
    const totalValidated = all.filter(r => r.validatedAt).length;
    const totalCriticals = all.reduce((s, r) => s + r.criticals, 0);
    const totalRejected = all.filter(r => r.isRejected).length;
    const totalAmended = all.filter(r => r.isAmended).length;
    const tats = all.map(r => r.tat_receive_valid).filter(v => v != null);
    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
      totalPerformed, totalValidated, totalCriticals, totalRejected, totalAmended,
      avgTatHours: mean(tats), medianTatHours: median(tats),
      uniqueTests: byTest.tests.length,
      activeUsers: new Set(log.map(e => e.by)).size,
      topTests: byTest.tests.slice(0, 10)
    };
  };

  window.lcAnalytics = analytics;

  console.log('📊 LabCore Analytics engine loaded');
})();