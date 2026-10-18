// shared/labcore-auth.js
// LabCore Auth — Version 2.0
// - Per-role PIN (hashed via btoa)
// - Idle session timeout (default 15 min)
// - Lockout after 5 failed attempts (5 min)
// - All new pages whitelisted
(function () {
  'use strict';

  const STORAGE_KEY = 'labcore_current_user';
  const LOCK_KEY = 'labcore_login_lockouts';
  const ATTEMPTS_KEY = 'labcore_login_attempts';
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000;     // 15 min idle → logout
  const LOCKOUT_MS = 5 * 60 * 1000;            // 5 min after 5 failures
  const MAX_ATTEMPTS = 5;

  const ROLES = {
    scientist: {
      id: 'scientist', label: 'Lab Scientist', short: 'LS',
      defaultPin: '1111',
            pages: [
        'dashboard.html', 'patient-registration.html', 'patient-merge.html',
        'lab-reception.html', 'result-entry.html', 'test-configuration.html',
        'price-management.html', 'reports.html', 'requests.html',
        'label-designer.html', 'data-management.html', 'qc.html',
        'micro-worklist.html', 'micro-report.html', 'messages.html',
        'tat-board.html',
        'nursing-station.html', 'ward-board.html'
      ],
      canEnterResults: true, canValidate: true, canAmend: true,
      canRejectSpecimen: true, canConfig: true, canConsult: false,
      canBill: false, canImaging: false
    },
    doctor: {
      id: 'doctor', label: 'Doctor', short: 'DR',
      defaultPin: '2222',
      pages: [
        'dashboard.html', 'patient-registration.html', 'patient-merge.html',
        'consultation.html', 'result-entry.html', 'reports.html',
        'imaging-worklist.html', 'messages.html', 'tat-board.html'
      ],
      canEnterResults: false, canValidate: false, canAmend: false,
      canRejectSpecimen: false, canConfig: false, canConsult: true,
      canBill: false, canImaging: true
    },
    receptionist: {
      id: 'receptionist', label: 'Receptionist', short: 'RC',
      defaultPin: '3333',
      pages: [
        'dashboard.html', 'receipts.html', 'patient-registration.html', 'patient-merge.html',
        'lab-reception.html', 'billing.html', 'requests.html',
        'label-designer.html', 'messages.html'
      ],
      canEnterResults: false, canValidate: false, canAmend: false,
      canRejectSpecimen: false, canConfig: false, canConsult: false,
      canBill: true, canImaging: false
    },
    billing: {
      id: 'billing', label: 'Billing', short: 'BL',
      defaultPin: '4444',
      pages: [
        'dashboard.html', 'receipts.html', 'patient-registration.html', 'billing.html',
        'price-management.html', 'reports.html', 'messages.html'
      ],
      canEnterResults: false, canValidate: false, canAmend: false,
      canRejectSpecimen: false, canConfig: false, canConsult: false,
      canBill: true, canImaging: false
    },
    nurse: {
      id: 'nurse', label: 'Nurse', short: 'RN',
      defaultPin: '5555',
            pages: [
        'dashboard.html', 'patient-registration.html', 'consultation.html',
        'nursing-station.html', 'ward-board.html',
        'lab-reception.html', 'label-designer.html', 'messages.html',
        'tat-board.html'
      ],
      canEnterResults: false, canValidate: false, canAmend: false,
      canRejectSpecimen: false, canConfig: false, canConsult: true,
      canBill: false, canImaging: false
    },
    sonographer: {
      id: 'sonographer', label: 'Sonographer', short: 'SO',
      defaultPin: '6666',
      pages: [
        'dashboard.html', 'patient-registration.html', 'imaging-worklist.html',
        'messages.html'
      ],
      canEnterResults: false, canValidate: false, canAmend: false,
      canRejectSpecimen: false, canConfig: false, canConsult: false,
      canBill: false, canImaging: true, imagingModality: 'Ultrasound'
    },
    radiographer: {
      id: 'radiographer', label: 'Radiographer', short: 'RG',
      defaultPin: '7777',
      pages: [
        'dashboard.html', 'patient-registration.html', 'imaging-worklist.html',
        'messages.html'
      ],
      canEnterResults: false, canValidate: false, canAmend: false,
      canRejectSpecimen: false, canConfig: false, canConsult: false,
      canBill: false, canImaging: true, imagingModality: 'X-Ray / CT / MRI'
    },
    admin: {
      id: 'admin', label: 'Administrator', short: 'AD',
      defaultPin: '8888',
      pages: [
        'dashboard.html','receipts.html', 'patient-registration.html', 'patient-merge.html',
        'consultation.html', 'lab-reception.html', 'result-entry.html',
        'test-configuration.html', 'price-management.html', 'billing.html',
        'imaging-worklist.html', 'reports.html', 'requests.html',
        'label-designer.html', 'data-management.html', 'qc.html',
        'micro-worklist.html', 'micro-report.html', 'messages.html',
        'tat-board.html'
      ],
      canEnterResults: true, canValidate: true, canAmend: true,
      canRejectSpecimen: true, canConfig: true, canConsult: true,
      canBill: true, canImaging: true
    }
  };

  window.lcRoles = ROLES;

  /* =========================================================
     PIN HASHING (obfuscation, not real crypto — frontend-only)
  ========================================================= */
  function hashPin(pin) {
    // Lightweight obfuscation. Do NOT use for real security.
    let h = 0;
    const s = 'lc:' + String(pin) + ':salt';
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return 'h' + (h >>> 0).toString(36);
  }

  function getRolePin(roleId) {
    const custom = localStorage.getItem('labcore_pin_' + roleId);
    if (custom) return custom;
    const def = ROLES[roleId] ? ROLES[roleId].defaultPin : null;
    return def ? hashPin(def) : null;
  }

  window.lcSetRolePin = function (roleId, newPin) {
    if (!ROLES[roleId] || !newPin) return false;
    localStorage.setItem('labcore_pin_' + roleId, hashPin(newPin));
    return true;
  };

  window.lcVerifyRolePin = function (roleId, pin) {
    const stored = getRolePin(roleId);
    if (!stored) return false;
    return stored === hashPin(pin);
  };

  /* =========================================================
     LOCKOUT
  ========================================================= */
  function readAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeAttempts(obj) {
    try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(obj)); } catch (e) {}
  }
  function readLocks() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeLocks(obj) {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(obj)); } catch (e) {}
  }

  window.lcIsRoleLocked = function (roleId) {
    const locks = readLocks();
    const until = locks[roleId];
    if (!until) return false;
    if (Date.now() >= until) {
      delete locks[roleId];
      writeLocks(locks);
      writeAttempts({});
      return false;
    }
    return true;
  };

  window.lcRoleLockRemainingMs = function (roleId) {
    const locks = readLocks();
    const until = locks[roleId];
    if (!until) return 0;
    return Math.max(0, until - Date.now());
  };

  function recordFailedAttempt(roleId) {
    const attempts = readAttempts();
    attempts[roleId] = (attempts[roleId] || 0) + 1;
    writeAttempts(attempts);
    if (attempts[roleId] >= MAX_ATTEMPTS) {
      const locks = readLocks();
      locks[roleId] = Date.now() + LOCKOUT_MS;
      writeLocks(locks);
      attempts[roleId] = 0;
      writeAttempts(attempts);
      return { locked: true, remainingMs: LOCKOUT_MS };
    }
    return { locked: false, remaining: MAX_ATTEMPTS - attempts[roleId] };
  }

  function clearFailedAttempts(roleId) {
    const attempts = readAttempts();
    delete attempts[roleId];
    writeAttempts(attempts);
  }

  /* =========================================================
     SESSION
  ========================================================= */
  window.lcGetUser = function () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (!u || !u.role || !ROLES[u.role]) return null;

      // Idle timeout check
      const lastActivity = u.lastActivityAt ? new Date(u.lastActivityAt).getTime() : 0;
      if (lastActivity && (Date.now() - lastActivity) > IDLE_TIMEOUT_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }

      return Object.assign({}, ROLES[u.role], {
        name: u.name || ROLES[u.role].label,
        loggedInAt: u.loggedInAt,
        lastActivityAt: u.lastActivityAt
      });
    } catch (e) {
      return null;
    }
  };

    /* =========================================================
     CUSTOM STAFF SESSION (labcore-staff.js bridge)
     When the login page authenticates a custom staff account,
     it calls lcSetStaffUser() instead of lcSetUser().
  ========================================================= */
  window.lcSetStaffUser = function (staff) {
    if (!staff || !staff.role || !ROLES[staff.role]) return false;
    var now = new Date().toISOString();
    var payload = {
      role: staff.role,                 // still a valid role id for page gating
      name: staff.name,
      staffId: staff.id,                // <<< NEW — identifies the custom record
      employeeId: staff.employeeId,
      department: staff.department,
      wardIds: staff.wardIds || [],
      loggedInAt: now,
      lastActivityAt: now
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    clearFailedAttempts(staff.role);

    try {
      if (window.lcAudit) {
        window.lcAudit('session.login', {
          entity: 'staff',
          entityId: staff.id,
          note: 'Login: ' + staff.name + ' (' + staff.employeeId + ')'
        });
      }
    } catch (e) {}
    return true;
  };

  window.lcSetUser = function (roleId, name) {
    if (!ROLES[roleId]) return false;
    const now = new Date().toISOString();
    const payload = {
      role: roleId,
      name: name || ROLES[roleId].label,
      loggedInAt: now,
      lastActivityAt: now
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    clearFailedAttempts(roleId);
    try {
      if (window.lcAudit) {
        window.lcAudit('session.login', {
          entity: 'user',
          entityId: roleId,
          note: 'Login: ' + payload.name
        });
      }
    } catch (e) {}
    return true;
  };

  window.lcLogout = async function (reason) {
    const u = window.lcGetUser();
    try {
      if (window.lcAudit && u) {
        window.lcAudit('session.logout', {
          entity: 'user',
          entityId: u.id,
          note: reason || 'Manual logout'
        });
      }
    } catch (e) {}
    var revokeError = null;
    if (window.lcApiLogout) {
      try { await window.lcApiLogout(); } catch (e) { revokeError = e; }
    }
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('labcore_token');
    localStorage.removeItem('labcore_current_session');
    if (revokeError && window.lcToast) {
      window.lcToast('Signed out locally, but the server session could not be revoked.', 'warning');
    }
    window.location.href = 'login.html';
  };

  /* =========================================================
     ATTEMPT LOGIN (used by login.html)
  ========================================================= */
  window.lcAttemptLogin = function (roleId, name, pin) {
    if (!ROLES[roleId]) return { ok: false, reason: 'unknown_role' };

    if (window.lcIsRoleLocked(roleId)) {
      return {
        ok: false,
        reason: 'locked',
        remainingMs: window.lcRoleLockRemainingMs(roleId)
      };
    }

    if (!window.lcVerifyRolePin(roleId, pin)) {
      const res = recordFailedAttempt(roleId);
      try {
        if (window.lcAudit) {
          window.lcAudit('session.login_failed', {
            entity: 'user',
            entityId: roleId,
            note: res.locked ? 'Locked after max attempts' : 'Wrong PIN'
          });
        }
      } catch (e) {}
      return {
        ok: false,
        reason: res.locked ? 'locked' : 'wrong_pin',
        remainingMs: res.remainingMs,
        attemptsLeft: res.remaining
      };
    }

    window.lcSetUser(roleId, name);
    return { ok: true };
  };

  /* =========================================================
     IDLE ACTIVITY TRACKER
  ========================================================= */
  let _idleTimer = null;
  function startIdleTracker() {
    if (_idleTimer) clearInterval(_idleTimer);

    function touch() {
      const u = lcGetUser();
      if (!u) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try {
        const obj = JSON.parse(raw);
        obj.lastActivityAt = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      } catch (e) {}
    }

    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(function (evt) {
      document.addEventListener(evt, touch, { passive: true });
    });

    _idleTimer = setInterval(function () {
      const u = lcGetUser();
      if (!u) {
        // Session expired → redirect
        const page = (location.pathname.split('/').pop() || '').toLowerCase();
        if (page && page !== 'login.html' && page !== 'report-viewer.html') {
          if (window.lcToast) window.lcToast('Session expired — please log in again', 'warning');
          setTimeout(function () {
            window.location.href = 'login.html';
          }, 1500);
        }
      }
    }, 30 * 1000);
  }

  /* =========================================================
     REQUIRE AUTH
  ========================================================= */
    window.lcRequireAuth = function (opts) {
    opts = opts || {};
    const user = window.lcGetUser();
    const page = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();

    // Public pages
    if (page === 'login.html' || page === 'report-viewer.html') {
      return user;
    }

       if (!user) {
      window.location.href = 'login.html';
      return null;
    }
    // Authorize using the nav link definitions when available
    const navLinks = window.lcNavLinks;
    if (Array.isArray(navLinks) && navLinks.length) {
      const pageLink = navLinks.find(function (link) {
        return String(link[2] || '').toLowerCase() === page;
      });

      // If the page is defined in the nav AND restricted to certain roles,
      // enforce those roles. If it's not in the nav (e.g. a sub-page),
      // allow it — the sidebar simply won't show a link for it.
      if (pageLink && Array.isArray(pageLink[4])) {
        if (pageLink[4].indexOf(user.id) === -1) {
          if (typeof window.lcToast === 'function') {
            window.lcToast('Your role cannot access this page', 'warning');
          }
          window.location.href = 'dashboard.html';
          return user;
        }
      }
      return user;
    }

    // Fallback: nav links not loaded yet — use the role's pages[] array
    if (user.pages && user.pages.indexOf(page) === -1) {
      if (typeof window.lcToast === 'function') {
        window.lcToast('Your role cannot access this page', 'warning');
      }
      window.location.href = 'dashboard.html';
      return user;
    }

    return user;
  };

  window.lcCan = function (permission) {
    const user = window.lcGetUser();
    if (!user) return false;
    return !!user[permission];
  };

  /* =========================================================
     CRITICAL ALERTS (unchanged from v1)
  ========================================================= */
  window.lcGetCriticalAlerts = function () {
    const patients = JSON.parse(localStorage.getItem('hms_patients_v3') || '[]');
    const alerts = [];
    patients.forEach(function (p) {
      (p.encounters || []).forEach(function (enc) {
        (enc.orders || []).forEach(function (o) {
          if (o.type !== 'Laboratory') return;
          const results = o.results || {};
          Object.keys(results).forEach(function (param) {
            const r = results[param];
            if (!r) return;
            const flag = (r.flag || '').toUpperCase();
            if (flag !== 'LL' && flag !== 'HH') return;
            if (r.criticalAcked) return;
            alerts.push({
              patientId: p.id, patientName: p.fullName,
              visitId: enc.visitId, panel: o.item,
              param: param, value: r.value, flag: flag,
              unit: r.unit || '', specimenId: o.specimenId || '',
              at: r.enteredAt || o.validatedAt || o.updatedAt || enc.date
            });
          });
        });
      });
    });
    alerts.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return alerts;
  };

  window.lcAckCritical = function (patientId, visitId, panel, param) {
    const patients = JSON.parse(localStorage.getItem('hms_patients_v3') || '[]');
    const p = patients.find(function (x) { return x.id === patientId; });
    if (!p) return false;
    const enc = (p.encounters || []).find(function (e) { return e.visitId === visitId; });
    if (!enc) return false;
    const order = (enc.orders || []).find(function (o) {
      return o.type === 'Laboratory' && o.item === panel;
    });
    if (!order || !order.results || !order.results[param]) return false;
    order.results[param].criticalAcked = true;
    order.results[param].criticalAckedAt = new Date().toISOString();
    order.results[param].criticalAckedBy = (window.lcGetUser() || {}).name || 'User';
    order.auditTrail = order.auditTrail || [];
    order.auditTrail.push({
      event: 'Critical acknowledged',
      by: (window.lcGetUser() || {}).name || 'User',
      at: new Date().toISOString(),
      note: param + ' = ' + order.results[param].value + ' (' + order.results[param].flag + ')'
    });
    localStorage.setItem('hms_patients_v3', JSON.stringify(patients));
    return true;
  };

  /* =========================================================
     AUTO-START
  ========================================================= */
  document.addEventListener('DOMContentLoaded', function () {
    const page = (location.pathname.split('/').pop() || '').toLowerCase();
    if (page !== 'login.html' && page !== 'report-viewer.html') {
      startIdleTracker();
    }
  });

  console.log('🔐 LabCore Auth v2.0 loaded — PIN + timeout + lockout');
  console.log('   Default PINs: scientist=1111 · doctor=2222 · receptionist=3333');
  console.log('                 billing=4444 · nurse=5555 · sonographer=6666');
  console.log('                 radiographer=7777 · admin=8888');

    /* =========================================================
     STAFF AUTH FALLBACK
     lcGetUser() returns the live staff record when logged in as
     a custom account. When logged in as a built-in role, the
     record is synthesised from ROLES.
  ========================================================= */
  var _origGetUser = window.lcGetUser;
  window.lcGetUser = function () {
    var u = _origGetUser();
    if (!u) return null;
    if (u.staffId && window.lcGetStaff) {
      var live = window.lcGetStaff(u.staffId);
      if (live) {
        // Merge live staff data on top of the ROLES-derived permissions
        return Object.assign({}, u, {
          name: live.name,
          employeeId: live.employeeId,
          department: live.department,
          wardIds: live.wardIds || []
        });
      }
    }
    return u;
  };
})();