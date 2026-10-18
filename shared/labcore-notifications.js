// shared/labcore-notifications.js
// LabCore Notification Center — bell + panel + unread tracking
(function () {
  'use strict';

  if (window.__lcNotifLoaded) return;
  window.__lcNotifLoaded = true;

  var STORAGE_KEY = 'labcore_notifications';
  var MAX_ENTRIES = 300;
  var POLL_MS = 30000;

  /* =========================================================
     STORAGE
  ========================================================= */
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function save(list) {
    if (list.length > MAX_ENTRIES) list = list.slice(list.length - MAX_ENTRIES);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch (e) {}
  }

  /* =========================================================
     PUBLIC API
  ========================================================= */
   window.lcNotify = function (opts) {
    return pushRaw(Object.assign({ kind: 'generic' }, opts || {}));
  };

  /* =========================================================
     AUTO-SCAN — pick up events from patient store + deliveries
  ========================================================= */
  function scanForNewEvents() {
    var lastSeenKey = 'labcore_notif_lastscan';
    var lastSeen = localStorage.getItem(lastSeenKey) || new Date(Date.now() - 3600000).toISOString();

    var me = (window.lcGetUser && window.lcGetUser()) || null;
    var myName = me && me.name;

    /* =========================================================
       LOOK 1: Newly validated lab panels → notify requesting doctor
    ========================================================= */
    try {
      var patients = JSON.parse(localStorage.getItem('hms_patients_v3') || '[]');
      patients.forEach(function (p) {
        (p.encounters || []).forEach(function (enc) {
          (enc.orders || []).forEach(function (o) {
            if (o.type !== 'Laboratory') return;
            if (!o.validatedAt) return;
            if (o.validatedAt <= lastSeen) return;

            // Only notify if the CURRENT user is the requesting doctor
            // (otherwise every user gets every notification)
            var requestingDoctor = enc.consultant || enc.doctor || '';
            var isForMe = !requestingDoctor || requestingDoctor === myName;

            if (!isForMe) return;

            // Dedup: already notified this panel for this patient+visit?
            var existing = load().some(function (n) {
              return n.kind === 'result-validated' &&
                     n.patientId === p.id &&
                     n.visitId === enc.visitId &&
                     n.panel === o.item;
            });
            if (existing) return;

            // Does this order contain any critical result?
            var hasCritical = false;
            Object.keys(o.results || {}).forEach(function (param) {
              var r = o.results[param];
              var f = String((r && r.flag) || '').toUpperCase();
              if (f === 'LL' || f === 'HH') hasCritical = true;
            });

            // Skip criticals here — they get their own row below
            if (hasCritical) return;

            // Create the "results ready" notification
            var bodyParts = [];
            if (p.fullName) bodyParts.push(p.fullName);
            if (o.item) bodyParts.push(o.item);
            if (enc.consultant) bodyParts.push('Dr. ' + enc.consultant);

            pushRaw({
              kind: 'result-validated',
              type: 'success',
              title: 'Results ready: ' + o.item,
              body: p.fullName + ' · ' + enc.visitId + (o.specimenId ? ' · ' + o.specimenId : ''),
              icon: '✅',
              link: 'result-entry.html',
              patientId: p.id,
              patientName: p.fullName,
              visitId: enc.visitId,
              panel: o.item,
              doctor: requestingDoctor
            });
          });
        });
      });
    } catch (e) {}

    /* =========================================================
       LOOK 2: Newly validated criticals → red alert
    ========================================================= */
    try {
      var patients2 = JSON.parse(localStorage.getItem('hms_patients_v3') || '[]');
      patients2.forEach(function (p) {
        (p.encounters || []).forEach(function (enc) {
          (enc.orders || []).forEach(function (o) {
            if (o.type !== 'Laboratory') return;
            if (!o.validatedAt) return;
            if (o.validatedAt <= lastSeen) return;

            var requestingDoctor = enc.consultant || enc.doctor || '';
            var isForMe = !requestingDoctor || requestingDoctor === myName;
            if (!isForMe) return;

            Object.keys(o.results || {}).forEach(function (param) {
              var r = o.results[param];
              if (!r) return;
              var f = String(r.flag || '').toUpperCase();
              if (f !== 'LL' && f !== 'HH') return;

              var existing = load().some(function (n) {
                return n.kind === 'critical' &&
                       n.patientId === p.id &&
                       n.visitId === enc.visitId &&
                       n.panel === o.item &&
                       n.param === param;
              });
              if (existing) return;

              pushRaw({
                kind: 'critical',
                type: 'danger',
                title: 'CRITICAL: ' + param,
                body: p.fullName + ' · ' + o.item + ' · ' + param + ' = ' +
                      r.value + (r.unit ? ' ' + r.unit : '') + ' (' + f + ')',
                icon: '🚨',
                link: 'result-entry.html',
                patientId: p.id,
                patientName: p.fullName,
                visitId: enc.visitId,
                panel: o.item,
                param: param,
                doctor: requestingDoctor
              });
            });
          });
        });
      });
    } catch (e) {}

    /* =========================================================
       LOOK 3: Delivery links opened by recipients
    ========================================================= */
    try {
      var deliveries = JSON.parse(localStorage.getItem('labcore_deliveries') || '[]');
      deliveries.forEach(function (d) {
        if (!d.opened) return;
        var firstOpen = d.openLog && d.openLog[0];
        if (!firstOpen) return;
        if (firstOpen.at <= lastSeen) return;

        var existing = load().some(function (n) {
          return n.kind === 'delivery-opened' && n.deliveryId === d.id;
        });
        if (existing) return;

        pushRaw({
          kind: 'delivery-opened',
          type: 'info',
          title: 'Report link opened',
          body: (d.recipientName || d.recipient) + ' · ' + d.id,
          icon: '👁️',
          link: 'result-entry.html',
          patientId: d.patientId,
          visitId: d.visitId,
          deliveryId: d.id
        });
      });
    } catch (e) {}

    localStorage.setItem(lastSeenKey, new Date().toISOString());
    refreshBadge();
  }

  /* Lower-level writer — takes everything, doesn't dedup internally */
  function pushRaw(opts) {
    var list = load();
    var n = {
      id: 'NOTIF-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(),
      type: opts.type || 'info',
      title: opts.title || 'Notification',
      body: opts.body || '',
      link: opts.link || null,
      icon: opts.icon || '🔔',
      read: false,
      // metadata used for dedup + future filtering
      kind: opts.kind || 'generic',
      patientId: opts.patientId || null,
      patientName: opts.patientName || null,
      visitId: opts.visitId || null,
      panel: opts.panel || null,
      param: opts.param || null,
      doctor: opts.doctor || null,
      deliveryId: opts.deliveryId || null
    };
    list.push(n);
    save(list);
    refreshBadge();
    renderPanel();
    return n;
  }

  /* =========================================================
     UI — bell + panel
  ========================================================= */
  function ensureBell() {
    // If the page already has a critical bell, reuse it
    var existingBell = document.getElementById('critBell');
    if (existingBell) {
      existingBell.onclick = function (e) {
        e.stopPropagation();
        openPanel();
      };
      return existingBell;
    }

    // If we already created ours, don't recreate
    if (document.getElementById('lcNotifBell')) {
      return document.getElementById('lcNotifBell');
    }

    // Otherwise create a floating bell in the top-right
    var btn = document.createElement('button');
    btn.id = 'lcNotifBell';
    btn.className = 'lc-notif-bell';
    btn.title = 'Notifications';
    var navTools = document.querySelector('.lc-nav-tools');
    if (navTools && window.lcIcon) {
      // Sit in the sidebar toolbar so the bell never covers page headers
      btn.className = 'lc-icon-btn lc-notif-bell lc-notif-bell--nav';
      btn.innerHTML = window.lcIcon('bell', 16) + '<span>Alerts</span>' +
        '<span class="lc-notif-badge" style="display:none">0</span>';
      navTools.insertBefore(btn, navTools.firstChild);
    } else {
      btn.innerHTML = '🔔<span class="lc-notif-badge" style="display:none">0</span>';
      document.body.appendChild(btn);
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      openPanel();
    });

    var panel = document.createElement('div');
    panel.id = 'lcNotifPanel';
    panel.className = 'lc-notif-panel';
    panel.innerHTML =
      '<div class="lc-notif-head">' +
        '<strong>Notifications</strong>' +
        '<div>' +
          '<button class="lc-notif-act" data-act="markAll">Mark all read</button>' +
          '<button class="lc-notif-act" data-act="clear">Clear</button>' +
        '</div>' +
      '</div>' +
      '<div class="lc-notif-list" id="lcNotifList"></div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (e) {
      var act = e.target.closest('.lc-notif-act');
      if (!act) return;
      if (act.dataset.act === 'markAll') markAllRead();
      else if (act.dataset.act === 'clear') clearAll();
    });

    document.addEventListener('click', function (e) {
      if (!panel.classList.contains('show')) return;
      if (panel.contains(e.target)) return;
      if (e.target.closest('#lcNotifBell')) return;
      if (e.target.closest('#critBell')) return;
      panel.classList.remove('show');
    });

    return btn;
  }

  function refreshBadge() {
    var list = load();
    var unread = list.filter(function (n) { return !n.read; }).length;
    var badge = document.querySelector('#lcNotifBell .lc-notif-badge') ||
                document.querySelector('#critBadge');
    if (badge) {
      if (unread > 0) {
        badge.style.display = 'flex';
        badge.textContent = unread > 99 ? '99+' : String(unread);
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function renderPanel() {
    var panel = document.getElementById('lcNotifPanel');
    if (!panel) return;
    var box = document.getElementById('lcNotifList');
    if (!box) return;

    var list = load().slice().reverse();

    if (!list.length) {
      box.innerHTML = '<div class="lc-notif-empty">No notifications yet</div>';
      return;
    }

    box.innerHTML = list.map(function (n) {
      return '<div class="lc-notif-item ' + (n.read ? 'read' : '') + ' lc-notif-' + n.type + '" data-id="' + n.id + '">' +
        '<div class="lc-notif-icon">' + n.icon + '</div>' +
        '<div class="lc-notif-body">' +
          '<div class="lc-notif-title">' + escHtml(n.title) + '</div>' +
          '<div class="lc-notif-text">' + escHtml(n.body) + '</div>' +
          '<div class="lc-notif-time">' + timeAgo(n.at) + '</div>' +
        '</div>' +
        (!n.read ? '<span class="lc-notif-dot"></span>' : '') +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('.lc-notif-item'), function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.id;
        markRead(id);
        var all = load();
        var n = all.find(function (x) { return x.id === id; });
        if (n && n.link) window.location.href = n.link;
      });
    });
  }

  function openPanel() {
    ensureBell();
    var panel = document.getElementById('lcNotifPanel');
    if (!panel) return;
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) {
      renderPanel();
      refreshBadge();
    }
  }

  function markRead(id) {
    var list = load();
    var n = list.find(function (x) { return x.id === id; });
    if (n) { n.read = true; save(list); refreshBadge(); renderPanel(); }
  }
  function markAllRead() {
    var list = load();
    list.forEach(function (n) { n.read = true; });
    save(list); refreshBadge(); renderPanel();
  }
  function clearAll() {
    if (!confirm('Clear all notifications?')) return;
    save([]); refreshBadge(); renderPanel();
  }

  function timeAgo(iso) {
    var t = new Date(iso).getTime();
    var s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* =========================================================
     BOOT
  ========================================================= */
  function boot() {
  var page = (location.pathname.split('/').pop() || '').toLowerCase();
  if (page === 'login.html' || page === 'report-viewer.html') return;

  // ensureBell() creates BOTH the bell button AND the panel container.
  // There is no separate ensurePanel() function — the panel is built
  // inside ensureBell as a side-effect.
  ensureBell();
  refreshBadge();
  scanForNewEvents();
  setInterval(scanForNewEvents, POLL_MS);
}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  console.log('🔔 LabCore Notifications loaded');
})();