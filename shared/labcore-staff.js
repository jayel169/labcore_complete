// shared/labcore-staff.js
// LabCore Staff Registry — custom accounts + dynamic departments + ward assignment
// Companion to labcore-auth.js. Load AFTER labcore-auth.js, BEFORE labcore-nav.js.
//
// Provides:
//   Staff CRUD:      lcListStaff, lcGetStaff, lcCreateStaff, lcUpdateStaff,
//                    lcDeleteStaff, lcDisableStaff, lcEnableStaff
//   Lookups:         lcStaffByRole, lcStaffByDepartment, lcStaffInWard,
//                    lcDepartments, lcWardsForStaff, lcStaffInitials
//   Productivity:    lcStaffProductivity, lcStaffAuditTimeline
//   Login bridge:    lcStaffAccountsForLogin, lcFindStaffById
//
// Storage keys:
//   labcore_staff_v1       — array of staff records
//   labcore_departments_v1 — array of department names (auto-growing)
//
// A staff record shape:
//   {
//     id: 'staff-xxxx',           // internal unique
//     employeeId: 'EMP-00124',    // human-facing
//     name: 'Dr. Ama Owusu',      // display name
//     role: 'doctor',             // one of labcore-auth ROLES keys
//     department: 'Cardiology',   // free text, auto-adds to dept list
//     wardIds: ['male-med', 'icu'],
//     email: 'ama@example.com',
//     phone: '+233...',
//     pinHash: 'h...',            // same hash as labcore-auth
//     status: 'active',           // 'active' | 'disabled'
//     createdAt: '2026-10-07T...',
//     createdBy: 'System Admin',
//     lastLoginAt: null,
//     loginCount: 0,
//     notes: ''
//   }
(function () {
  'use strict';

  if (window.__lcStaffLoaded) return;
  window.__lcStaffLoaded = true;

  var STORE_KEY  = 'labcore_staff_v1';
  var DEPT_KEY   = 'labcore_departments_v1';

  var SEED_DEPARTMENTS = [
    'General Medicine',
    'Paediatrics',
    'Obstetrics & Gynaecology',
    'Surgery',
    'Cardiology',
    'Orthopaedics',
    'Dermatology',
    'Neurology',
    'Psychiatry',
    'ENT',
    'Laboratory',
    'Radiology',
    'Nursing',
    'Administration'
  ];

  /* =========================================================
     PIN HASH — must match labcore-auth.js exactly
  ========================================================= */
  function hashPin(pin) {
    var h = 0;
    var s = 'lc:' + String(pin) + ':salt';
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return 'h' + (h >>> 0).toString(36);
  }
  window.lcStaffHashPin = hashPin;

  /* =========================================================
     STORAGE
  ========================================================= */
  function loadStaff() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveStaff(list) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('staff save failed', e);
      return false;
    }
  }

  function loadDepartments() {
    try {
      var raw = localStorage.getItem(DEPT_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (e) {}
    // seed on first run
    saveDepartments(SEED_DEPARTMENTS);
    return SEED_DEPARTMENTS.slice();
  }

  function saveDepartments(list) {
    try { localStorage.setItem(DEPT_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  /* =========================================================
     ID GENERATION
  ========================================================= */
  function newStaffId() {
    return 'staff-' + Date.now().toString(36).toUpperCase() +
      '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function nextEmployeeId() {
    var list = loadStaff();
    var maxNum = 123;
    list.forEach(function (s) {
      var m = String(s.employeeId || '').match(/(\d+)$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    return 'EMP-' + String(maxNum + 1).padStart(5, '0');
  }
  window.lcNextEmployeeId = nextEmployeeId;

  /* =========================================================
     CURRENT ACTOR (for createdBy / audit)
  ========================================================= */
  function currentActorName() {
    try {
      if (typeof window.lcGetUser === 'function') {
        var u = window.lcGetUser();
        if (u && (u.name || u.label)) return u.name || u.label;
      }
    } catch (e) {}
    return 'System';
  }

  /* =========================================================
     PUBLIC API — READ
  ========================================================= */
  window.lcListStaff = function (filter) {
    filter = filter || {};
    var list = loadStaff();

    if (filter.role) {
      list = list.filter(function (s) { return s.role === filter.role; });
    }
    if (filter.department) {
      var d = String(filter.department).toLowerCase();
      list = list.filter(function (s) {
        return String(s.department || '').toLowerCase() === d;
      });
    }
    if (filter.wardId) {
      list = list.filter(function (s) {
        return Array.isArray(s.wardIds) && s.wardIds.indexOf(filter.wardId) >= 0;
      });
    }
    if (filter.status) {
      list = list.filter(function (s) { return s.status === filter.status; });
    }
    if (filter.search) {
      var q = String(filter.search).toLowerCase();
      list = list.filter(function (s) {
        return (
          String(s.name || '').toLowerCase().indexOf(q) >= 0 ||
          String(s.employeeId || '').toLowerCase().indexOf(q) >= 0 ||
          String(s.department || '').toLowerCase().indexOf(q) >= 0 ||
          String(s.email || '').toLowerCase().indexOf(q) >= 0 ||
          String(s.phone || '').toLowerCase().indexOf(q) >= 0
        );
      });
    }

    // sort by name
    list.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return list;
  };

  window.lcGetStaff = function (id) {
    if (!id) return null;
    var list = loadStaff();
    return list.find(function (s) { return s.id === id; }) || null;
  };

   window.lcFindStaffById = window.lcGetStaff; // alias

  window.lcFindStaffByEmail = function (email) {
    if (!email) return null;
    var needle = String(email).trim().toLowerCase();
    return loadStaff().find(function (s) {
      return String(s.email || '').toLowerCase() === needle;
    }) || null;
  };

  window.lcStaffByRole = function (role) {
    return window.lcListStaff({ role: role, status: 'active' });
  };

  window.lcStaffByDepartment = function (dept, role) {
    var list = window.lcListStaff({ department: dept, status: 'active' });
    if (role) list = list.filter(function (s) { return s.role === role; });
    return list;
  };

  window.lcStaffInWard = function (wardId, role) {
    var list = window.lcListStaff({ wardId: wardId, status: 'active' });
    if (role) list = list.filter(function (s) { return s.role === role; });
    return list;
  };

  window.lcDepartments = function () {
    // union of seeded departments + any used by staff + any explicitly added
    var list = loadDepartments().slice();
    var used = {};
    loadStaff().forEach(function (s) {
      if (s.department && !list.some(function (d) { return d.toLowerCase() === s.department.toLowerCase(); })) {
        list.push(s.department);
      }
    });
    list.sort();
    return list;
  };

  window.lcAddDepartment = function (name) {
    name = String(name || '').trim();
    if (!name) return false;
    var list = loadDepartments();
    if (list.some(function (d) { return d.toLowerCase() === name.toLowerCase(); })) return true;
    list.push(name);
    list.sort();
    return saveDepartments(list);
  };

  window.lcWardsForStaff = function (staffId) {
    var s = window.lcGetStaff(staffId);
    return s && Array.isArray(s.wardIds) ? s.wardIds.slice() : [];
  };

  window.lcStaffInitials = function (staff) {
    if (!staff || !staff.name) return '—';
    var parts = String(staff.name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  /* =========================================================
     PUBLIC API — WRITE
  ========================================================= */
  window.lcCreateStaff = function (opts) {
    opts = opts || {};
      var name = String(opts.name || '').trim();
    if (!name) throw new Error('Name is required');
    if (!opts.role) throw new Error('Role is required');
    if (!opts.pin || String(opts.pin).length < 4) throw new Error('PIN must be at least 4 digits');

    var email = String(opts.email || '').trim();
    if (!email) throw new Error('Email is required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email address is not valid');
    if (window.lcFindStaffByEmail(email)) {
      throw new Error('Email "' + email + '" is already registered');
    }

    // Auto-register department
    if (opts.department) window.lcAddDepartment(opts.department);
    var rec = {
      id: newStaffId(),
      employeeId: String(opts.employeeId || '').trim() || nextEmployeeId(),
      name: name,
      role: opts.role,
      department: String(opts.department || '').trim(),
      wardIds: Array.isArray(opts.wardIds) ? opts.wardIds.slice() : [],
            email: email,
      phone: String(opts.phone || '').trim(),
      pinHash: hashPin(String(opts.pin)),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: currentActorName(),
      lastLoginAt: null,
      loginCount: 0,
      notes: String(opts.notes || '').trim()
    };

    var list = loadStaff();
    list.push(rec);
    if (!saveStaff(list)) throw new Error('Could not save staff record');

    // audit
    try {
      if (typeof window.lcAudit === 'function') {
        window.lcAudit('staff.created', {
          entity: 'staff',
          entityId: rec.id,
          after: { name: rec.name, role: rec.role, department: rec.department, employeeId: rec.employeeId },
          note: 'Created ' + rec.name + ' (' + rec.employeeId + ')'
        });
      }
    } catch (e) {}

    return rec;
  };

  window.lcUpdateStaff = function (id, changes) {
    if (!id) throw new Error('id required');
    changes = changes || {};
    var list = loadStaff();
    var i = list.findIndex(function (s) { return s.id === id; });
    if (i < 0) throw new Error('Staff not found');

    var before = {
      name: list[i].name,
      role: list[i].role,
      department: list[i].department,
      wardIds: (list[i].wardIds || []).slice(),
      employeeId: list[i].employeeId,
      email: list[i].email,
      phone: list[i].phone,
      status: list[i].status,
      notes: list[i].notes
    };

    // Only allow safe fields
    ['name','role','department','wardIds','email','phone','notes','employeeId'].forEach(function (k) {
      if (changes[k] !== undefined) list[i][k] = changes[k];
    });
    if (changes.department) window.lcAddDepartment(changes.department);

    if (!saveStaff(list)) throw new Error('Save failed');

    try {
      if (typeof window.lcAudit === 'function') {
        window.lcAudit('staff.updated', {
          entity: 'staff',
          entityId: id,
          before: before,
          after: {
            name: list[i].name,
            role: list[i].role,
            department: list[i].department,
            wardIds: list[i].wardIds,
            employeeId: list[i].employeeId,
            email: list[i].email,
            phone: list[i].phone,
            status: list[i].status,
            notes: list[i].notes
          },
          note: 'Updated ' + list[i].name
        });
      }
    } catch (e) {}

    return list[i];
  };

  window.lcResetStaffPin = function (id, newPin) {
    if (!newPin || String(newPin).length < 4) throw new Error('PIN must be at least 4 digits');
    var list = loadStaff();
    var i = list.findIndex(function (s) { return s.id === id; });
    if (i < 0) throw new Error('Staff not found');

    list[i].pinHash = hashPin(String(newPin));
    if (!saveStaff(list)) throw new Error('Save failed');

    try {
      if (typeof window.lcAudit === 'function') {
        window.lcAudit('staff.pin_reset', {
          entity: 'staff',
          entityId: id,
          note: 'PIN reset for ' + list[i].name
        });
      }
    } catch (e) {}

    return true;
  };

  window.lcDisableStaff = function (id, reason) {
    var list = loadStaff();
    var i = list.findIndex(function (s) { return s.id === id; });
    if (i < 0) throw new Error('Staff not found');

    // Never disable the last active administrator
    if (list[i].role === 'admin') {
      var otherActiveAdmins = list.filter(function (s) {
        return s.role === 'admin' && s.status === 'active' && s.id !== id;
      });
      if (otherActiveAdmins.length === 0) {
        throw new Error('Cannot disable the last active administrator');
      }
    }

    list[i].status = 'disabled';
    list[i].disabledAt = new Date().toISOString();
    list[i].disabledBy = currentActorName();
    list[i].disableReason = String(reason || '').trim();
    saveStaff(list);

    try {
      if (typeof window.lcAudit === 'function') {
        window.lcAudit('staff.disabled', {
          entity: 'staff',
          entityId: id,
          note: 'Disabled ' + list[i].name + (reason ? ' — ' + reason : '')
        });
      }
    } catch (e) {}

    return list[i];
  };

  window.lcEnableStaff = function (id) {
    var list = loadStaff();
    var i = list.findIndex(function (s) { return s.id === id; });
    if (i < 0) throw new Error('Staff not found');

    list[i].status = 'active';
    list[i].disabledAt = null;
    list[i].disabledBy = null;
    list[i].disableReason = '';
    saveStaff(list);

    try {
      if (typeof window.lcAudit === 'function') {
        window.lcAudit('staff.enabled', {
          entity: 'staff',
          entityId: id,
          note: 'Re-enabled ' + list[i].name
        });
      }
    } catch (e) {}

    return list[i];
  };

  window.lcDeleteStaff = function (id) {
    var list = loadStaff();
    var i = list.findIndex(function (s) { return s.id === id; });
    if (i < 0) throw new Error('Staff not found');

    var rec = list[i];

    // Never hard-delete someone who has logged in; force disable instead
    if ((rec.loginCount || 0) > 0) {
      throw new Error('This account has logged in before — disable it instead of deleting to preserve history.');
    }

    list.splice(i, 1);
    saveStaff(list);

    try {
      if (typeof window.lcAudit === 'function') {
        window.lcAudit('staff.deleted', {
          entity: 'staff',
          entityId: id,
          before: { name: rec.name, employeeId: rec.employeeId, role: rec.role },
          note: 'Deleted ' + rec.name
        });
      }
    } catch (e) {}

    return true;
  };

  /* =========================================================
     AUTH BRIDGE — used by labcore-auth.js
     Called when a login attempt happens so we can match custom users
  ========================================================= */
  var MAX_PIN_FAILS = 5;
  var PIN_LOCK_MS = 5 * 60 * 1000;
  var FAIL_KEY = 'labcore_staff_pin_fails';
  function readFails() { try { return JSON.parse(localStorage.getItem(FAIL_KEY) || '{}'); } catch (e) { return {}; } }
  function writeFails(o) { try { localStorage.setItem(FAIL_KEY, JSON.stringify(o)); } catch (e) {} }

  /** Check a PIN without side effects (no login count, no audit entry). Still counts failures. */
  window.lcVerifyStaffPin = function (staffId, pin) {
    var s = window.lcGetStaff(staffId);
    if (!s) return { ok: false, reason: 'not_found' };
    if (s.status === 'disabled') return { ok: false, reason: 'disabled' };
    if (s.status === 'locked')   return { ok: false, reason: 'locked' };

    var fails = readFails(), rec = fails[staffId] || { n: 0, until: 0 };
    if (rec.until && Date.now() < rec.until) {
      return { ok: false, reason: 'locked', retryAfterSec: Math.ceil((rec.until - Date.now()) / 1000) };
    }
    if (s.pinHash !== hashPin(String(pin))) {
      rec.n = (rec.until && Date.now() >= rec.until) ? 1 : (rec.n || 0) + 1;
      rec.until = 0;
      if (rec.n >= MAX_PIN_FAILS) { rec.until = Date.now() + PIN_LOCK_MS; rec.n = 0; }
      fails[staffId] = rec; writeFails(fails);
      return { ok: false, reason: rec.until ? 'locked' : 'wrong_pin', attemptsLeft: rec.until ? 0 : MAX_PIN_FAILS - rec.n };
    }
    delete fails[staffId]; writeFails(fails);
    return { ok: true, staff: s };
  };

  window.lcAuthenticateStaff = function (staffId, pin) {
    var check = window.lcVerifyStaffPin(staffId, pin);
    if (!check.ok) return check;
    var s = check.staff;

    // Update counters
    var list = loadStaff();
    var i = list.findIndex(function (x) { return x.id === staffId; });
    if (i >= 0) {
      list[i].lastLoginAt = new Date().toISOString();
      list[i].loginCount = (list[i].loginCount || 0) + 1;
      saveStaff(list);
    }

    // The login audit entry is written once, by lcSetStaffUser().

    return { ok: true, staff: s };
  };

  /* =========================================================
     LOGIN SCREEN BRIDGE
     Returns staff grouped by role for the login page
  ========================================================= */
  window.lcStaffAccountsForLogin = function () {
    var list = window.lcListStaff({ status: 'active' });
    var byRole = {};
    list.forEach(function (s) {
      if (!byRole[s.role]) byRole[s.role] = [];
      byRole[s.role].push(s);
    });
    return byRole;
  };

  /* =========================================================
     PRODUCTIVITY & AUDIT — derived from labcore_audit_log
  ========================================================= */
  function loadAuditLog() {
    try {
      var raw = localStorage.getItem('labcore_audit_log');
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  /**
   * Returns activity counters for a staff member over the last `days` days.
   * Matches on staff.name exactly (audit log records store `by: <name>`).
   */
  window.lcStaffProductivity = function (staffName, days) {
    days = Number(days) || 7;
    var cutoff = Date.now() - days * 24 * 3600 * 1000;
    var log = loadAuditLog().filter(function (e) {
      return e.by === staffName && new Date(e.at).getTime() >= cutoff;
    });

    var out = {
      events: log.length,
      entered: 0,
      validated: 0,
      amended: 0,
      rejected: 0,
      criticalsAcked: 0,
      logins: 0,
      byEvent: {},
      lastEventAt: null
    };

    log.forEach(function (e) {
      out.byEvent[e.event] = (out.byEvent[e.event] || 0) + 1;
      var ev = String(e.event || '').toLowerCase();
      if (ev.indexOf('prelim') >= 0 || ev.indexOf('result.submitted') >= 0 || ev.indexOf('entered') >= 0) out.entered++;
      if (ev.indexOf('validated') >= 0) out.validated++;
      if (ev.indexOf('amend') >= 0) out.amended++;
      if (ev.indexOf('rejected') >= 0) out.rejected++;
      if (ev.indexOf('critical.acked') >= 0) out.criticalsAcked++;
      if (ev.indexOf('session.login') >= 0) out.logins++;
      if (!out.lastEventAt || e.at > out.lastEventAt) out.lastEventAt = e.at;
    });

    return out;
  };

  /**
   * Full event stream for one staff member (most recent first).
   */
  window.lcStaffAuditTimeline = function (staffName, limit) {
    limit = Number(limit) || 50;
    var log = loadAuditLog().filter(function (e) { return e.by === staffName; });
    log.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return log.slice(0, limit);
  };

  /* =========================================================
     MIGRATION — pull names from legacy hardcoded departments
     object into real staff records, once, when the admin opens
     the staff page for the first time.
     Safe: does nothing if staff records already exist.
  ========================================================= */
  window.lcSeedStaffFromLegacy = function () {
    var existing = loadStaff();
    if (existing.length) return 0;

    // Try to find the legacy list from any page that happened to have it in memory
    var legacy = (typeof window.__lcLegacyDepartments === 'object' && window.__lcLegacyDepartments) || null;
    if (!legacy) return 0;

    var created = 0;
    Object.keys(legacy).forEach(function (dept) {
      (legacy[dept] || []).forEach(function (doctorName) {
        try {
          window.lcCreateStaff({
            name: doctorName,
            role: 'doctor',
            department: dept,
            pin: '2222'  // default; admin is expected to reset
          });
          created++;
        } catch (e) {}
      });
    });
    return created;
  };

  /* =========================================================
     INIT
  ========================================================= */
   loadDepartments();  // seeds defaults on first ever run

  /* =========================================================
     SEED DEFAULT ADMIN — first ever run only
     Login:  admin@labcore.local
     PIN:    1789
     ========================================================= */
    (function ensureDefaultAdmin() {
    var list = loadStaff();
    var existing = list.find(function (s) {
      return s.email && s.email.toLowerCase() === 'admin@labcore.local';
    });

    if (existing) {
      // Recovery only: if no active administrator is left, restore the default one.
      // Otherwise leave it alone so PIN changes and disabling stick.
      var anyActiveAdmin = list.some(function (s) { return s.role === 'admin' && s.status === 'active'; });
      if (!anyActiveAdmin) {
        existing.pinHash = hashPin('1789');
        existing.status = 'active';
        existing.role = 'admin';
        saveStaff(list);
      }
      return;
    }

    var seed = {
      id: 'staff-seed-admin',
      employeeId: 'EMP-00001',
      name: 'System Administrator',
      role: 'admin',
      department: 'Administration',
      wardIds: [],
      email: 'admin@labcore.local',
      phone: '',
      pinHash: hashPin('1789'),
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: 'System',
      lastLoginAt: null,
      loginCount: 0,
      notes: 'Default administrator account. Create additional accounts from Staff Accounts.'
    };

    list.push(seed);
    saveStaff(list);
    console.log('🌱 Ensured default admin — admin@labcore.local / 1789');
  })();
  console.log('👥 LabCore Staff Registry loaded — ' + loadStaff().length + ' custom accounts, ' +
    window.lcDepartments().length + ' departments');
})();