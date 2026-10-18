// shared/labcore-timeline.js
// LabCore Patient Timeline — vertical event stream
(function () {
  'use strict';

  if (window.__lcTimelineLoaded) return;
  window.__lcTimelineLoaded = true;

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function collectEvents(patient) {
    var events = [];

    (patient.encounters || []).forEach(function (enc) {
      events.push({
        type: 'visit',
        at: enc.createdAt || (enc.date + 'T00:00:00'),
        icon: '📋',
        color: 'blue',
        title: enc.service || 'Encounter',
        subtitle: enc.consultant || enc.doctor || '',
        details: [
          ['Visit ID', enc.visitId],
          ['Date', fmtDate(enc.date)],
          ['Department', enc.department || '—'],
          ['Priority', enc.priority || 'Routine'],
          ['Chief complaint', enc.chiefComplaint || '—'],
          ['Status', enc.status || '—']
        ]
      });

      (enc.orders || []).forEach(function (o) {
        var orderTime = o.orderedAt || enc.createdAt || (enc.date + 'T00:00:00');
        var typeLabel = o.type === 'Laboratory' ? 'Lab order' :
                        o.type === 'Pharmacy' ? 'Prescription' :
                        o.type === 'Radiology' ? 'Imaging request' :
                        (o.type || 'Order');
        var icon = o.type === 'Laboratory' ? '🧪' :
                   o.type === 'Pharmacy' ? '💊' :
                   o.type === 'Radiology' ? '🩻' : '📦';
        var color = o.type === 'Laboratory' ? 'sky' :
                    o.type === 'Pharmacy' ? 'green' :
                    o.type === 'Radiology' ? 'amber' : 'gray';

        events.push({
          type: 'order',
          at: orderTime,
          icon: icon,
          color: color,
          title: typeLabel + ': ' + (o.item || '—'),
          subtitle: o.resultStatus || o.status || 'Pending',
          details: [
            ['Specimen', o.specimenId || '—'],
            ['Priority', o.priority || 'Routine'],
            ['Ordered', fmtDate(orderTime) + ' ' + fmtTime(orderTime)],
            o.resultStatus ? ['Result status', o.resultStatus] : null,
            o.validatedBy ? ['Validated by', o.validatedBy] : null,
            o.validatedAt ? ['Validated', fmtDate(o.validatedAt) + ' ' + fmtTime(o.validatedAt)] : null,
            o.note ? ['Note', o.note] : null
          ].filter(Boolean)
        });

        if (o.results && (o.resultStatus === 'Validated' || o.status === 'Validated')) {
          Object.keys(o.results).forEach(function (param) {
            var r = o.results[param];
            if (!r || r.value == null || r.value === '') return;
            var flag = String(r.flag || '').toUpperCase();
            var crit = (flag === 'LL' || flag === 'HH');
            events.push({
              type: 'result',
              at: o.validatedAt || orderTime,
              icon: crit ? '🚨' : '✅',
              color: crit ? 'red' : 'green',
              title: o.item + ' — ' + param,
              subtitle: r.value + (r.unit ? ' ' + r.unit : '') + (r.flag ? ' · ' + r.flag : ''),
              details: [
                ['Value', r.value + (r.unit ? ' ' + r.unit : '')],
                ['Reference', r.refText || '—'],
                ['Flag', r.flag || 'Normal'],
                ['Panel', o.item],
                ['Validated by', o.validatedBy || '—']
              ]
            });
          });
        }
      });

      if (enc.billing && enc.billing.length) {
        var total = enc.billing.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
        events.push({
          type: 'billing',
          at: enc.closedAt || enc.createdAt || (enc.date + 'T00:00:00'),
          icon: '💰',
          color: 'gold',
          title: 'Bill finalized',
          subtitle: 'GHS ' + total.toFixed(2) + (enc.paymentStatus ? ' · ' + enc.paymentStatus : ''),
          details: [
            ['Items', enc.billing.length],
            ['Total', 'GHS ' + total.toFixed(2)],
            ['Paid', 'GHS ' + (Number(enc.amountPaid) || 0).toFixed(2)],
            ['Status', enc.paymentStatus || 'unpaid']
          ]
        });
      }
    });

    events.sort(function (a, b) {
      return new Date(b.at).getTime() - new Date(a.at).getTime();
    });

    return events;
  }

  window.lcRenderPatientTimeline = function (containerId, patient, opts) {
    opts = opts || {};
    var container = document.getElementById(containerId);
    if (!container) return;

    var events = collectEvents(patient);
    var filter = opts.filter || 'all';

    if (filter !== 'all') {
      events = events.filter(function (e) {
        if (filter === 'visits') return e.type === 'visit';
        if (filter === 'orders') return e.type === 'order';
        if (filter === 'results') return e.type === 'result';
        if (filter === 'critical') return e.color === 'red';
        return true;
      });
    }

    var html = '';
    html += '<div class="lc-tl-filters">';
    html += '<button class="lc-tl-filter ' + (filter === 'all' ? 'active' : '') + '" data-filter="all">All</button>';
    html += '<button class="lc-tl-filter ' + (filter === 'visits' ? 'active' : '') + '" data-filter="visits">Visits</button>';
    html += '<button class="lc-tl-filter ' + (filter === 'orders' ? 'active' : '') + '" data-filter="orders">Orders</button>';
    html += '<button class="lc-tl-filter ' + (filter === 'results' ? 'active' : '') + '" data-filter="results">Results</button>';
    html += '<button class="lc-tl-filter ' + (filter === 'critical' ? 'active' : '') + '" data-filter="critical">Criticals</button>';
    html += '<span class="lc-tl-count">' + events.length + ' event(s)</span>';
    html += '</div>';

    if (!events.length) {
      html += '<div class="lc-tl-empty">No events to show' + (filter !== 'all' ? ' in this filter' : '') + '.</div>';
      container.innerHTML = html;
      return;
    }

    html += '<div class="lc-tl-stream">';
    events.forEach(function (ev, i) {
      html += '<div class="lc-tl-event lc-tl-' + ev.color + '" data-i="' + i + '">';
      html +=   '<div class="lc-tl-marker"><span class="lc-tl-icon">' + ev.icon + '</span></div>';
      html +=   '<div class="lc-tl-content">';
      html +=     '<div class="lc-tl-head">';
      html +=       '<div class="lc-tl-title">' + esc(ev.title) + '</div>';
      html +=       '<div class="lc-tl-when">' + fmtDate(ev.at) + ' · ' + fmtTime(ev.at) + '</div>';
      html +=     '</div>';
      if (ev.subtitle) {
        html += '<div class="lc-tl-sub">' + esc(ev.subtitle) + '</div>';
      }
      if (ev.details && ev.details.length) {
        html += '<div class="lc-tl-details">';
        ev.details.forEach(function (d) {
          html += '<div class="lc-tl-row"><span class="k">' + esc(d[0]) + '</span><span class="v">' + esc(d[1]) + '</span></div>';
        });
        html += '</div>';
      }
      html +=   '</div>';
      html += '</div>';
    });
    html += '</div>';

    container.innerHTML = html;

    container.querySelectorAll('.lc-tl-filter').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.lcRenderPatientTimeline(containerId, patient, { filter: btn.dataset.filter });
      });
    });

    container.querySelectorAll('.lc-tl-event').forEach(function (el) {
      el.addEventListener('click', function () {
        el.classList.toggle('expanded');
      });
    });
  };

  console.log('📅 LabCore Patient Timeline loaded');
})();