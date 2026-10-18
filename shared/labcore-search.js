// shared/labcore-search.js
// LabCore Global Command Palette — Cmd+K / Ctrl+K
(function () {
  'use strict';

  if (window.__lcSearchLoaded) return;
  window.__lcSearchLoaded = true;

  var isOpen = false;
  var activeIndex = 0;
  var results = [];
  var overlayEl = null;
  var inputEl = null;
  var listEl = null;
  var FULL_INDEX = [];

  /* =========================================================
     DATA SOURCES
  ========================================================= */
  function loadPatients() {
    try { return JSON.parse(localStorage.getItem('hms_patients_v3') || '[]'); }
    catch (e) { return []; }
  }

  function loadSpecimens() {
    try { return JSON.parse(localStorage.getItem('labcore_specimens') || '[]'); }
    catch (e) { return []; }
  }

  function buildIndex() {
    var items = [];
    var patients = loadPatients();

    patients.forEach(function (p) {
      items.push({
        type: 'patient',
        label: p.fullName,
        sub: p.id + ' · ' + (p.sex || '—') + ' · ' + (p.mobile || '—'),
        keywords: (p.fullName + ' ' + p.id + ' ' + (p.mobile || '') + ' ' + (p.nationalId || '')).toLowerCase(),
        action: function () {
          window.location.href = 'patient-registration.html?focus=' + encodeURIComponent(p.id);
        }
      });

      (p.encounters || []).forEach(function (e) {
        items.push({
          type: 'encounter',
          label: e.visitId + ' · ' + p.fullName,
          sub: (e.service || '—') + ' · ' + (e.date || '—') + ' · ' + (e.consultant || '—'),
          keywords: (e.visitId + ' ' + p.fullName + ' ' + p.id + ' ' + (e.service || '')).toLowerCase(),
          action: function () {
            window.location.href = 'consultation.html?patient=' + encodeURIComponent(p.id) + '&visit=' + encodeURIComponent(e.visitId);
          }
        });

        (e.orders || []).forEach(function (o) {
          if (o.type !== 'Laboratory') return;
          items.push({
            type: 'lab-order',
            label: o.item,
            sub: p.fullName + ' · ' + e.visitId + ' · ' + (o.specimenId || '—') + ' · ' + (o.resultStatus || o.status || ''),
            keywords: (o.item + ' ' + p.fullName + ' ' + e.visitId + ' ' + (o.specimenId || '')).toLowerCase(),
            action: function () {
              window.location.href = 'result-entry.html?patient=' + encodeURIComponent(p.id) + '&visit=' + encodeURIComponent(e.visitId);
            }
          });
        });
      });
    });

    loadSpecimens().forEach(function (s) {
      items.push({
        type: 'specimen',
        label: s.specimenId,
        sub: s.patientName + ' · ' + (s.tests || []).join(', ').slice(0, 60),
        keywords: (s.specimenId + ' ' + s.patientName + ' ' + (s.visitId || '')).toLowerCase(),
        action: function () {
          window.location.href = 'label-designer.html?focus=' + encodeURIComponent(s.specimenId);
        }
      });
    });

    return items;
  }

  /* =========================================================
     STATIC PAGE ACTIONS
  ========================================================= */
  var PAGE_ACTIONS = [
    { label: 'Go to Dashboard',        sub: 'dashboard.html',           action: function () { location.href = 'dashboard.html'; } },
    { label: 'New Patient',            sub: 'patient-registration.html', action: function () { location.href = 'patient-registration.html'; } },
    { label: 'Consultation Workspace', sub: 'consultation.html',         action: function () { location.href = 'consultation.html'; } },
    { label: 'Sample Registration',    sub: 'lab-reception.html',         action: function () { location.href = 'lab-reception.html'; } },
    { label: 'Result Entry',           sub: 'result-entry.html',          action: function () { location.href = 'result-entry.html'; } },
    { label: 'Imaging Worklist',       sub: 'imaging-worklist.html',      action: function () { location.href = 'imaging-worklist.html'; } },
    { label: 'Label Designer',         sub: 'label-designer.html',        action: function () { location.href = 'label-designer.html'; } },
    { label: 'Test Configuration',     sub: 'test-configuration.html',    action: function () { location.href = 'test-configuration.html'; } },
    { label: 'Price Management',       sub: 'price-management.html',      action: function () { location.href = 'price-management.html'; } },
    { label: 'Billing Desk',           sub: 'billing.html',               action: function () { location.href = 'billing.html'; } },
    { label: 'Reports & Analytics',    sub: 'reports.html',               action: function () { location.href = 'reports.html'; } },
    { label: 'Logout',                 sub: 'End session',                action: function () { if (window.lcLogout) window.lcLogout('Command palette'); } }
  ];

  /* =========================================================
     FUZZY MATCH
  ========================================================= */
  function fuzzyScore(needle, haystack) {
    needle = needle.toLowerCase();
    haystack = haystack.toLowerCase();
    if (!needle) return 1;
    if (haystack.indexOf(needle) >= 0) return 1000 - haystack.indexOf(needle);
    var idx = 0;
    var score = 0;
    for (var i = 0; i < haystack.length && idx < needle.length; i++) {
      if (haystack[i] === needle[idx]) { idx++; score += 1; }
    }
    return idx === needle.length ? score : 0;
  }

  function search(query) {
    var q = (query || '').trim();
    if (!q) {
      return PAGE_ACTIONS.map(function (a) {
        return { type: 'action', label: a.label, sub: a.sub, action: a.action };
      });
    }

    var pool = [];
    PAGE_ACTIONS.forEach(function (a) {
      pool.push({ type: 'action', label: a.label, sub: a.sub, action: a.action, _kw: (a.label + ' ' + a.sub).toLowerCase() });
    });
    FULL_INDEX.forEach(function (it) {
      pool.push({ type: it.type, label: it.label, sub: it.sub, action: it.action, _kw: it.keywords });
    });

    var scored = pool.map(function (it) {
      return { it: it, s: fuzzyScore(q, it._kw) };
    }).filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 12);

    return scored.map(function (x) {
      return { type: x.it.type, label: x.it.label, sub: x.it.sub, action: x.it.action };
    });
  }

  /* =========================================================
     BUILD DOM
  ========================================================= */
  function buildOverlay() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'lc-cmdk-overlay';
    overlayEl.innerHTML =
      '<div class="lc-cmdk-box" role="dialog" aria-label="Command palette">' +
        '<div class="lc-cmdk-inputwrap">' +
          '<span class="lc-cmdk-icon">🔍</span>' +
          '<input class="lc-cmdk-input" type="text" placeholder="Search patients, specimens, panels, or jump to a page…" autocomplete="off" spellcheck="false">' +
          '<kbd class="lc-cmdk-esc">ESC</kbd>' +
        '</div>' +
        '<div class="lc-cmdk-list" role="listbox"></div>' +
        '<div class="lc-cmdk-foot">' +
          '<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>' +
          '<span><kbd>↵</kbd> open</span>' +
          '<span><kbd>ESC</kbd> close</span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlayEl);

    inputEl = overlayEl.querySelector('.lc-cmdk-input');
    listEl = overlayEl.querySelector('.lc-cmdk-list');

    overlayEl.addEventListener('mousedown', function (e) {
      if (e.target === overlayEl) close();
    });

    inputEl.addEventListener('input', function () {
      render(inputEl.value);
    });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); run(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
  }

  function render(query) {
    results = search(query);
    activeIndex = 0;
    if (!results.length) {
      listEl.innerHTML = '<div class="lc-cmdk-empty">No matches for "' + escHtml(query) + '"</div>';
      return;
    }
    listEl.innerHTML = results.map(function (r, i) {
      return '<div class="lc-cmdk-item' + (i === 0 ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="lc-cmdk-type lc-cmdk-type-' + r.type + '">' + typeIcon(r.type) + '</span>' +
        '<div class="lc-cmdk-text">' +
          '<div class="lc-cmdk-label">' + escHtml(r.label) + '</div>' +
          '<div class="lc-cmdk-sub">' + escHtml(r.sub) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(listEl.querySelectorAll('.lc-cmdk-item'), function (el) {
      el.addEventListener('mouseenter', function () {
        activeIndex = Number(el.dataset.i);
        updateActive();
      });
      el.addEventListener('click', function () {
        activeIndex = Number(el.dataset.i);
        run();
      });
    });
  }

  function move(dir) {
    if (!results.length) return;
    activeIndex = (activeIndex + dir + results.length) % results.length;
    updateActive();
  }

  function updateActive() {
    Array.prototype.forEach.call(listEl.querySelectorAll('.lc-cmdk-item'), function (el, i) {
      el.classList.toggle('active', i === activeIndex);
    });
    var active = listEl.querySelector('.lc-cmdk-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function run() {
    var r = results[activeIndex];
    if (!r) return;
    close();
    setTimeout(function () { if (r.action) r.action(); }, 30);
  }

  function typeIcon(type) {
    if (type === 'patient') return '👤';
    if (type === 'encounter') return '📋';
    if (type === 'lab-order') return '🧪';
    if (type === 'specimen') return '🏷️';
    if (type === 'action') return '⚡';
    return '•';
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function open() {
    buildOverlay();
    FULL_INDEX = buildIndex();
    overlayEl.classList.add('show');
    inputEl.value = '';
    render('');
    setTimeout(function () { inputEl.focus(); }, 30);
    isOpen = true;
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('show');
    isOpen = false;
    document.body.style.overflow = '';
  }

  window.lcOpenCommandPalette = open;

  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (isOpen) close(); else open();
      return;
    }
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      close();
    }
  });

  console.log('🔍 LabCore Command Palette loaded — press Cmd/Ctrl+K');
})();