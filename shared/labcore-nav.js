// shared/labcore-nav.js
// LabCore shared navigation — v4.0
// - SVG icons via labcore-icons.js
// - Role-aware sections (Main / Laboratory / Configuration / Administration)
// - Administation → Staff Accounts visible to admin only
// - Mobile toggle + overlay
// - Notification module owns the bell; sidebar has logout only
(function () {
  'use strict';

  if (window.__lcNavLoaded) return;
  window.__lcNavLoaded = true;

  var current = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();

  /* =========================================================
     NAV DEFINITION
     [iconName, label, href, section, rolesArray|null]
     roles null = visible to everyone
     ========================================================= */
    window.lcNavLinks = [
    // --- Main ---
        ['dashboard',    'Dashboard',        'dashboard.html',             'main', null],
    ['account',      'My Account',       'my-account.html',            'main', null],
        ['patients',     'Patients',         'patient-registration.html',  'main', null],
        ['consultation', 'Appointments',     'appointments.html',          'main', ['admin', 'receptionist', 'doctor', 'nurse', 'sonographer', 'radiographer']],
    ['merge',        'Patient Merge',    'patient-merge.html',         'main', ['receptionist', 'admin']],
    ['consultation', 'Consultation',     'consultation.html',          'main', ['doctor', 'nurse', 'admin']],
    ['nursing',      'Nursing Station',  'nursing-station.html',       'main', ['nurse', 'admin', 'scientist']],
    ['ward',         'Ward Board',       'ward-board.html',            'main', ['nurse', 'doctor', 'admin', 'scientist']],
    ['triage',       'Triage Board',     'triage-board.html',          'main', ['nurse', 'doctor', 'receptionist', 'admin']],
    ['billing',      'Billing',          'billing.html',               'main', ['billing', 'receptionist', 'admin']],
    ['receipts',     'Receipts',         'receipts.html',              'main', ['billing', 'receptionist', 'admin']],

    // --- Laboratory ---
    ['requests',     'Requests',         'requests.html',              'lab',  ['scientist', 'receptionist', 'admin']],
    ['specimens',    'Sample Registration', 'lab-reception.html',      'lab',  ['scientist', 'receptionist', 'nurse', 'admin']],
    ['specimens',    'Specimen Tracking', 'specimen-tracking.html',   'lab',  ['scientist', 'receptionist', 'nurse', 'admin']],
    ['results',      'Quality Control',  'quality-control.html',      'lab',  ['scientist', 'admin']],
    ['results',      'Results',          'result-entry.html',          'lab',  ['scientist', 'doctor', 'admin']],
    ['critical',     'Critical Follow-up', 'critical-followup.html',    'lab',  ['scientist', 'doctor', 'admin']],
    ['reports',      'Turnaround Monitor', 'turnaround-monitor.html',   'lab',  ['scientist', 'receptionist', 'admin']],
    ['reports',      'Reports',          'reports.html',               'lab',  null],
    ['imaging',      'Imaging',          'imaging-worklist.html',      'lab',  ['sonographer', 'radiographer', 'doctor', 'admin']],

    // --- Configuration ---
    ['testPanels',   'Test Panels',      'test-configuration.html',    'config', ['scientist', 'admin']],
    ['prices',       'Price Management', 'price-management.html',      'config', ['admin', 'scientist', 'billing']],
    ['labels',       'Label Designer',   'label-designer.html',        'config', ['scientist', 'receptionist', 'admin']],

         // --- Administration (admin only) ---
    ['staff',        'Staff Accounts',   'staff-accounts.html',        'admin', ['admin']],
    ['settings',     'Settings',         'settings.html',              'admin', ['admin']],
    ['audit',        'Audit Log',        'audit-log.html',             'admin', ['admin']]
  ];

  var SECTION_LABELS = {
    main:   'Main',
    lab:    'Laboratory',
    config: 'Configuration',
    admin:  'Administration'
  };

  /* =========================================================
     USER HELPERS
     ========================================================= */
  function getUser() {
    if (typeof window.lcGetUser === 'function') return window.lcGetUser();
    try {
      var raw = localStorage.getItem('labcore_current_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function doLogout() {
    if (!confirm('Log out of LabCore?')) return;
    if (typeof window.lcLogout === 'function') {
      try { window.lcLogout('Manual logout'); return; }
      catch (e) { console.warn('lcLogout failed, falling back:', e); }
    }
    try {
      localStorage.removeItem('labcore_current_user');
      localStorage.removeItem('labcore_current_session');
    } catch (e) {}
    window.location.href = 'login.html';
  }

  /* =========================================================
     BUILD SIDEBAR
     ========================================================= */
  function buildSidebar() {
    var aside = document.querySelector('aside.sidebar');
    if (!aside) return;
    if (current === 'login.html' || current === 'report-viewer.html') return;

    var user = getUser();
    var roleId = user ? (user.role || user.id) : null;

    aside.innerHTML = '';
    aside.className = 'sidebar';

    var wrap = document.createElement('div');
    wrap.className = 'lc-shared-nav';

    /* --- Brand --- */
    var brand = document.createElement('div');
    brand.className = 'lc-brand';
    brand.innerHTML =
      '<div class="lc-brand-mark">' + (window.lcIcon ? window.lcIcon('logo', 22) : 'LC') + '</div>' +
      '<div class="lc-brand-text">' +
        '<div class="name">LabCore</div>' +
        '<div class="sub">Laboratory System</div>' +
      '</div>';
    wrap.appendChild(brand);

    /* --- Nav --- */
    var nav = document.createElement('nav');
    nav.className = 'lc-nav';

    var lastSection = '';
        window.lcNavLinks.forEach(function (item) {
      var iconName = item[0];
      var label = item[1];
      var href = item[2];
      var section = item[3];
      var roles = item[4];

      // Role gate
      if (roles && roleId && roles.indexOf(roleId) === -1) return;
      if (roles && !roleId) return; // no user → hide role-gated links

      // Section header
      if (section !== lastSection) {
        var s = document.createElement('div');
        s.className = 'lc-section';
        s.textContent = SECTION_LABELS[section] || section;
        nav.appendChild(s);
        lastSection = section;
      }

      var a = document.createElement('a');
      a.className = 'lc-link' + (current === href.toLowerCase() ? ' active' : '');
      a.href = href;
      a.innerHTML =
        (window.lcIcon ? window.lcIcon(iconName, 18, 'lc-icon') : '<span class="lc-icon"></span>') +
        '<span>' + label + '</span>';
      nav.appendChild(a);
    });

    wrap.appendChild(nav);

    /* --- User box --- */
    var userBox = document.createElement('div');
    userBox.className = 'lc-user';

    var initials = '—';
    if (user) {
      var display = user.name || user.label || 'User';
      initials = display
        .split(/\s+/)
        .map(function (w) { return w[0]; })
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }

    userBox.innerHTML =
      '<div class="lc-avatar">' + initials + '</div>' +
      '<div class="lc-user-meta">' +
        '<strong>' + ((user && user.name) || 'Not signed in') + '</strong>' +
        '<span>' + ((user && user.label) || '') + '</span>' +
      '</div>';
    wrap.appendChild(userBox);

    /* --- Tools row: logout only --- */
    var tools = document.createElement('div');
    tools.className = 'lc-nav-tools';
    tools.innerHTML =
      '<button type="button" id="lcNavLogoutBtn" class="lc-logout-btn" title="Logout">' +
        (window.lcIcon ? window.lcIcon('logout', 14) : '') +
        '<span>Logout</span>' +
      '</button>';
    wrap.appendChild(tools);

    aside.appendChild(wrap);

    /* --- Wire logout --- */
    var logoutBtn = document.getElementById('lcNavLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        doLogout();
      });
    }
  }

  /* =========================================================
     MOBILE TOGGLE
     ========================================================= */
  function setupMobileToggle() {
    var toggle = document.querySelector('.lc-mobile-toggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.className = 'lc-mobile-toggle';
      toggle.setAttribute('aria-label', 'Toggle navigation');
      toggle.innerHTML = '&#9776;';
      document.body.prepend(toggle);
    }

    var overlay = document.querySelector('.lc-sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'lc-sidebar-overlay';
      document.body.prepend(overlay);
    }

    if (toggle.dataset.bound) return;
    toggle.dataset.bound = '1';
    toggle.setAttribute('aria-controls', 'lcPrimaryNavigation');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
    var nav = document.querySelector('.sidebar .lc-nav');
    if (nav) nav.id = 'lcPrimaryNavigation';

    function setSidebarOpen(open) {
      var sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      sidebar.classList.toggle('open', open);
      toggle.classList.toggle('active', open);
      overlay.classList.toggle('active', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      document.body.style.overflow = open ? 'hidden' : '';
    }

    toggle.addEventListener('click', function () {
      var sidebar = document.querySelector('.sidebar');
      if (sidebar) setSidebarOpen(!sidebar.classList.contains('open'));
    });
    overlay.addEventListener('click', function () { setSidebarOpen(false); });
    document.querySelectorAll('.sidebar .lc-link').forEach(function (link) {
      link.addEventListener('click', function () { setSidebarOpen(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var sidebar = document.querySelector('.sidebar');
        if (sidebar && sidebar.classList.contains('open')) setSidebarOpen(false);
      }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 960) setSidebarOpen(false);
    });
  }

  /* =========================================================
     DEPENDENCY FALLBACK — load auth if missing
     ========================================================= */
  function loadDeps() {
    if (typeof window.lcGetUser === 'undefined') {
      var s = document.createElement('script');
      s.src = 'shared/labcore-auth.js';
      s.onload = function () {
        if (current !== 'login.html' && typeof window.lcRequireAuth === 'function') {
          window.lcRequireAuth();
        }
      };
      document.head.appendChild(s);
    } else if (current !== 'login.html' && current !== 'report-viewer.html' && window.lcRequireAuth) {
      window.lcRequireAuth();
    }
  }

  /* =========================================================
     INIT
     ========================================================= */
  function init() {
    try {
      loadDeps();
      buildSidebar();
      setupMobileToggle();
    } catch (err) {
      console.error('LabCore nav failed to initialise:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 20);
  }

  console.log('🧭 LabCore Navigation v4.0 loaded');
})();