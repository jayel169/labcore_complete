// shared/labcore-audit.js
(function () {
  'use strict';

  const LOG_KEY = 'labcore_audit_log';
  const MAX_LOG = 20000; // safety cap; oldest trimmed

  function currentActor() {
    const u = (typeof window.lcGetUser === 'function') ? window.lcGetUser() : null;
    return {
      name: (u && u.name) || 'Unknown User',
      role: (u && u.id) || 'unknown',
      roleLabel: (u && u.label) || 'Unknown Role'
    };
  }

  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function writeLog(list) {
    if (list.length > MAX_LOG) list = list.slice(-MAX_LOG);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e) {
      // Storage full — trim harder
      list = list.slice(-Math.floor(MAX_LOG / 2));
      try { localStorage.setItem(LOG_KEY, JSON.stringify(list)); } catch (e2) {}
    }
  }

  /**
   * lcAudit(event, payload)
   * event:  e.g. 'result.entered', 'result.validated', 'specimen.received'
   * payload: {
   *   entity, entityId,           // e.g. 'order', 'LAB-...'
   *   patientId, patientName, visitId, specimenId,
   *   panel, test, department,
   *   before, after,              // optional snapshots
   *   note,                       // free text
   *   durationMs,                 // optional pre-measured TAT slice
   *   orderRef                    // optional live order object to also update auditTrail[]
   * }
   */
  window.lcAudit = function (event, payload) {
    payload = payload || {};
    const actor = currentActor();
    const entry = {
      id: 'AUD-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      event: event,
      at: new Date().toISOString(),
      by: actor.name,
      role: actor.role,
      roleLabel: actor.roleLabel,
      entity: payload.entity || '',
      entityId: payload.entityId || '',
      patientId: payload.patientId || '',
      patientName: payload.patientName || '',
      visitId: payload.visitId || '',
      specimenId: payload.specimenId || '',
      panel: payload.panel || '',
      test: payload.test || '',
      department: payload.department || '',
      before: payload.before || null,
      after: payload.after || null,
      note: payload.note || '',
      durationMs: (typeof payload.durationMs === 'number') ? payload.durationMs : null
    };

    const log = readLog();
    log.push(entry);
    writeLog(log);

    // Mirror to order.auditTrail[] if an order reference is provided
    if (payload.orderRef && typeof payload.orderRef === 'object') {
      payload.orderRef.auditTrail = payload.orderRef.auditTrail || [];
      payload.orderRef.auditTrail.push({
        event: event,
        by: actor.name,
        role: actor.role,
        at: entry.at,
        note: entry.note
      });
    }

    // Invalidate analytics cache so reports pick up the change
    try { localStorage.removeItem('labcore_analytics_cache'); } catch (e) {}
    // Push to the server too (fire-and-forget, never blocks UI)
    if (window.lcApiAudit) {
      try { window.lcApiAudit(event, payload); } catch (e) {}
    }



    return entry;
  };

  // billing, price-management and result-entry call window.auditLog(...) behind
  // an `if (window.auditLog)` guard. Alias it so those events are actually recorded.
  window.auditLog = window.lcAudit;

  window.lcReadAuditLog = readLog;
  window.lcClearAuditLog = function () {
    try { localStorage.removeItem(LOG_KEY); } catch (e) {}
  };

  /** Convenience: current user's display name (replaces hardcoded strings) */
  window.lcCurrentUserName = function () {
    return currentActor().name;
  };

  console.log('📝 LabCore Audit bus loaded');
})();