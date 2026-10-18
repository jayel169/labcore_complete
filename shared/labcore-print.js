// shared/labcore-print.js
// LabCore Print Module — production build
// Templates: standard, cumulative, criticalAlert, rejection, referral
// Renders into a hidden container, opens a new window, prints, cleans up.
(function () {
  'use strict';

  /* =========================================================
     TEMPLATE REGISTRY
  ========================================================= */
  var TEMPLATES = [
    { id: 'standard',      label: 'Standard Lab Report',    icon: '🧪' },
    { id: 'cumulative',    label: 'Cumulative Patient Report', icon: '📚' },
    { id: 'criticalAlert', label: 'Critical Alert Notice',  icon: '🚨' },
    { id: 'rejection',     label: 'Specimen Rejection Slip', icon: '🚫' },
    { id: 'referral',      label: 'External Referral Form', icon: '📤' }
  ];

  window.lcPrintTemplates = function () {
    return TEMPLATES.slice();
  };

  /* =========================================================
     HELPERS
  ========================================================= */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('en-GB', {
      year: 'numeric', month: 'short', day: '2-digit'
    });
  }

  function ageFromDob(dob) {
    if (!dob) return '—';
    var b = new Date(dob), t = new Date();
    if (isNaN(b.getTime())) return '—';
    var a = t.getFullYear() - b.getFullYear();
    var m = t.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
    return a + ' yrs';
  }

  function flagClass(flag) {
    if (!flag) return '';
    var f = String(flag).toUpperCase();
    if (f === 'LL' || f === 'HH') return 'flag-critical';
    if (f === 'L' || f === 'H') return 'flag-warning';
    if (f === 'N') return 'flag-normal';
    return 'flag-warning';
  }

  /* =========================================================
     SHARED STYLES
  ========================================================= */
  function buildStyles() {
    return ''
      + '*{box-sizing:border-box;margin:0;padding:0}'
      + 'html,body{background:#f4f5f3;}'
      + 'body{font-family:"Segoe UI",Arial,Helvetica,sans-serif;color:#1a1a2e;line-height:1.45;padding:20px;}'
      + '.print-page{max-width:210mm;margin:0 auto;background:#fff;padding:24px 28px 40px;'
        + 'border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,0.06);}'
      + '.hdr{display:flex;justify-content:space-between;align-items:flex-start;'
        + 'border-bottom:3px solid #1a3a5c;padding-bottom:12px;margin-bottom:16px;}'
      + '.hdr-left{display:flex;gap:12px;align-items:center;}'
      + '.logo{width:52px;height:52px;background:#d5b36a;color:#1a3a5c;border-radius:8px;'
        + 'display:flex;align-items:center;justify-content:center;font-weight:800;font-size:22px;}'
      + '.hdr h1{font-size:20px;font-weight:800;color:#1a3a5c;letter-spacing:0.5px;}'
      + '.hdr .subtitle{font-size:10px;color:#6b7a8a;letter-spacing:1.5px;'
        + 'text-transform:uppercase;margin-top:2px;}'
      + '.hdr-right{text-align:right;font-size:10px;color:#6b7a8a;line-height:1.6;}'
      + '.hdr-right strong{color:#1a3a5c;display:block;font-size:11px;}'
      + '.patient-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px 14px;'
        + 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;'
        + 'padding:12px 14px;margin-bottom:18px;}'
      + '.patient-grid .cell{min-width:0;}'
      + '.patient-grid .label{display:block;font-size:8px;text-transform:uppercase;'
        + 'letter-spacing:0.6px;color:#6b7a8a;font-weight:700;margin-bottom:2px;}'
      + '.patient-grid .value{font-size:12px;font-weight:600;color:#1a1a2e;'
        + 'word-break:break-word;}'
      + '.panel-title{background:#1a3a5c;color:#fff;padding:8px 14px;'
        + 'font-size:11px;font-weight:700;text-transform:uppercase;'
        + 'letter-spacing:0.6px;border-radius:4px 4px 0 0;margin-top:16px;'
        + 'display:flex;justify-content:space-between;align-items:center;}'
      + '.panel-title small{font-size:9px;font-weight:400;opacity:0.85;}'
      + 'table.results{width:100%;border-collapse:collapse;font-size:11px;'
        + 'border:1px solid #e2e8f0;border-top:none;}'
      + 'table.results th{background:#f1f4f8;padding:8px 12px;text-align:left;'
        + 'font-size:9px;text-transform:uppercase;color:#5a6a7a;'
        + 'border-bottom:1px solid #e2e8f0;font-weight:700;letter-spacing:0.4px;}'
      + 'table.results td{padding:7px 12px;border-bottom:1px solid #edf0f2;'
        + 'vertical-align:top;}'
      + 'table.results tr:last-child td{border-bottom:none;}'
      + 'table.results td.result{font-weight:700;font-size:12px;color:#1a1a2e;}'
      + 'table.results td.ref{font-size:10px;color:#6b7a8a;}'
      + '.flag{padding:2px 7px;border-radius:9px;font-size:9px;font-weight:800;'
        + 'letter-spacing:0.3px;}'
      + '.flag-critical{background:#fde8e8;color:#b74b43;}'
      + '.flag-warning{background:#fff3df;color:#9a5b00;}'
      + '.flag-normal{background:#e8f5ee;color:#23714c;}'
      + '.comment-box{background:#f8fafc;border-left:3px solid #245b86;'
        + 'padding:10px 14px;font-size:11px;color:#3a4a5a;margin-top:6px;}'
      + '.comment-box strong{color:#1a3a5c;}'
      + '.sig-row{display:flex;justify-content:space-between;font-size:10px;'
        + 'color:#6b7a8a;margin:8px 0 14px;padding:0 4px;font-style:italic;}'
      + '.section-title{font-size:12px;font-weight:800;color:#1a3a5c;'
        + 'text-transform:uppercase;letter-spacing:0.6px;margin:20px 0 10px;'
        + 'padding-bottom:5px;border-bottom:2px solid #d5b36a;}'
      + '.footer{margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;'
        + 'font-size:9px;color:#8a96a0;text-align:center;line-height:1.7;}'
      + '.footer strong{color:#1a3a5c;}'
      + '.alert-box{border-radius:6px;padding:14px 18px;margin:16px 0;'
        + 'font-size:12px;line-height:1.6;}'
      + '.alert-critical{background:#fde8e8;border:2px solid #b74b43;color:#842029;}'
      + '.alert-critical h2{font-size:15px;font-weight:800;margin-bottom:6px;}'
      + '.alert-warning{background:#fff3df;border:1px solid #e0b566;color:#9a5b00;}'
      + '.alert-info{background:#e3f2fd;border:1px solid #90caf9;color:#1565c0;}'
      + '.kv{display:grid;grid-template-columns:160px 1fr;gap:6px 14px;'
        + 'font-size:12px;margin:10px 0;}'
      + '.kv .k{color:#6b7a8a;font-weight:600;}'
      + '.kv .v{font-weight:600;color:#1a1a2e;}'
      + '.signature-area{margin-top:28px;display:flex;justify-content:space-between;'
        + 'gap:40px;}'
      + '.signature-area .sig-block{flex:1;}'
      + '.signature-area .sig-line{border-top:1px solid #1a1a2e;margin-top:38px;'
        + 'padding-top:4px;font-size:10px;color:#6b7a8a;}'
      + '.referral-box{border:1px dashed #b0bec5;border-radius:6px;padding:14px 16px;'
        + 'background:#fafbfc;margin:14px 0;font-size:11px;color:#546e7a;}'
      + '.critical-panel{border:2px solid #b74b43;border-radius:6px;padding:16px;'
        + 'background:#fef7f7;margin:14px 0;}'
      + '.critical-panel .param{font-size:15px;font-weight:800;color:#b74b43;}'
      + '.critical-panel .value{font-size:22px;font-weight:900;color:#842029;'
        + 'margin:4px 0;}'
      + '.critical-panel .meta{font-size:11px;color:#6b7a8a;margin-top:6px;}'
      + '.stamp{display:inline-block;border:3px solid #b74b43;color:#b74b43;'
        + 'padding:6px 16px;border-radius:6px;font-weight:900;font-size:14px;'
        + 'letter-spacing:2px;transform:rotate(-6deg);opacity:0.85;'
        + 'text-transform:uppercase;margin:10px 0;}'
      + '@media print{'
        + 'body{background:#fff;padding:0;}'
        + '.print-page{box-shadow:none;border-radius:0;padding:14mm 12mm;'
          + 'max-width:none;}'
        + '.no-print{display:none !important;}'
        + '@page{size:A4;margin:8mm;}'
      + '}'
      + '@media (max-width:600px){'
        + '.patient-grid{grid-template-columns:repeat(2,1fr);}'
        + '.hdr{flex-direction:column;gap:10px;}'
        + '.hdr-right{text-align:left;}'
      + '}';
  }

  /* =========================================================
     HEADER / FOOTER
  ========================================================= */
  function buildHeader(reportLabel, subtitle) {
    var now = new Date();

    var s = window.lcSettings || {};
    var facilityName = (s.facilityName ? s.facilityName() : '⚠ Facility name not configured');
    var logoUrl = (s.logoDataUrl ? s.logoDataUrl() : '');
    var shortCode = (s.facilityShort ? s.facilityShort() : '');
    var locationLine = (s.locationLine ? s.locationLine() : '');
    var phoneLine = (s.phoneLine ? s.phoneLine() : '');

    var logoBlock = logoUrl
      ? '<div class="logo" style="background:#fff;overflow:hidden;padding:2px">'
        + '<img src="' + logoUrl + '" alt="logo" style="max-width:100%;max-height:100%;object-fit:contain">'
        + '</div>'
      : '<div class="logo">' + esc((shortCode || 'LC').slice(0, 4).toUpperCase()) + '</div>';

    var rightLines = [];
    if (locationLine) rightLines.push('<strong>' + esc(locationLine) + '</strong>');
    if (phoneLine)    rightLines.push(esc(phoneLine));
    rightLines.push('Printed: ' + fmtDateTime(now.toISOString()));
    if (subtitle) rightLines.push(esc(subtitle));

    return ''
      + '<div class="hdr">'
        + '<div class="hdr-left">'
          + logoBlock
          + '<div>'
            + '<h1>' + esc(facilityName) + '</h1>'
            + '<div class="subtitle">' + esc(reportLabel || 'Laboratory Report') + '</div>'
          + '</div>'
        + '</div>'
        + '<div class="hdr-right">'
          + rightLines.join('<br>')
        + '</div>'
      + '</div>';
  }

   function buildFooter() {
    var s = window.lcSettings || {};
    var facilityName = (s.facilityName ? s.facilityName() : '⚠ Facility name not configured');
    var locationLine = (s.locationLine ? s.locationLine() : '');
    var phoneLine    = (s.phoneLine    ? s.phoneLine()    : '');
    var confidentiality = (s.get ? (s.get().confidentialityNote || '') : '');
    var validity = (s.get ? (s.get().reportValidityNote || '') : '');
    var footerText = (s.reportFooter ? s.reportFooter() : '');

    var line1Parts = [facilityName];
    if (locationLine) line1Parts.push(locationLine);
    if (phoneLine)    line1Parts.push(phoneLine);

    var lines = [];
    lines.push('<strong>' + esc(line1Parts.join(' · ')) + '</strong>');
    if (confidentiality) lines.push(esc(confidentiality));
    if (validity)        lines.push(esc(validity));
    if (footerText)      lines.push(esc(footerText));

    return '<div class="footer">' + lines.join('<br>') + '</div>';
  }

  function buildPatientGrid(patient, encounter) {
    var age = ageFromDob(patient.dob);
    return ''
      + '<div class="patient-grid">'
        + '<div class="cell"><span class="label">Patient Name</span><span class="value">' + esc(patient.fullName || '—') + '</span></div>'
        + '<div class="cell"><span class="label">Patient ID</span><span class="value">' + esc(patient.id || '—') + '</span></div>'
        + '<div class="cell"><span class="label">DOB / Age</span><span class="value">' + esc(patient.dob || '—') + ' (' + esc(age) + ')</span></div>'
        + '<div class="cell"><span class="label">Sex</span><span class="value">' + esc(patient.sex || '—') + '</span></div>'
        + (encounter
          ? '<div class="cell"><span class="label">Encounter</span><span class="value">' + esc(encounter.visitId || '—') + '</span></div>'
            + '<div class="cell"><span class="label">Encounter Date</span><span class="value">' + esc(fmtDate(encounter.date)) + '</span></div>'
            + '<div class="cell"><span class="label">Requesting Doctor</span><span class="value">' + esc(encounter.consultant || '—') + '</span></div>'
            + '<div class="cell"><span class="label">Service</span><span class="value">' + esc(encounter.service || '—') + '</span></div>'
          : '')
      + '</div>';
  }

  /* =========================================================
     BUILDERS — per template
  ========================================================= */

  function renderPanel(order) {
    var results = order.results || {};
    var keys = Object.keys(results);
    var validated = order.validatedAt ? fmtDateTime(order.validatedAt) : '—';
    var html = '';

    html += '<div class="panel-title">'
      + esc(order.item || 'Panel')
      + '<small>'
        + (order.instrument || order.analyser ? 'Instrument: ' + esc(order.instrument || order.analyser) + ' · ' : '')
        + 'Validated: ' + esc(validated)
      + '</small></div>';

    html += '<table class="results"><thead><tr>'
      + '<th style="width:28%">Parameter</th>'
      + '<th style="width:22%">Result</th>'
      + '<th style="width:14%">Unit</th>'
      + '<th style="width:26%">Reference</th>'
      + '<th style="width:10%">Flag</th>'
      + '</tr></thead><tbody>';

    if (!keys.length) {
      html += '<tr><td colspan="5" style="padding:14px;color:#6b7a8a;font-style:italic;">'
        + 'Values not stored on this order.</td></tr>';
    } else {
      keys.forEach(function (param) {
        var r = results[param] || {};
        var flagHtml = '';
        if (r.flag) {
          flagHtml = '<span class="flag ' + flagClass(r.flag) + '">' + esc(r.flag) + '</span>';
        }
        html += '<tr>'
          + '<td>' + esc(param) + '</td>'
          + '<td class="result">' + esc(r.value != null && r.value !== '' ? r.value : '—') + '</td>'
          + '<td>' + esc(r.unit || '—') + '</td>'
          + '<td class="ref">' + esc(r.refText || '—') + '</td>'
          + '<td>' + flagHtml + '</td>'
          + '</tr>';
      });
    }
    html += '</tbody></table>';

    if (order.panelComment) {
      html += '<div class="comment-box"><strong>Comment:</strong> ' + esc(order.panelComment) + '</div>';
    }

    html += '<div class="sig-row">'
      + '<span>Validated by: ' + esc(order.validatedBy || '—') + '</span>'
      + '<span>' + esc(validated) + '</span>'
      + '</div>';

    return html;
  }

  function buildStandard(data) {
    var patient = data.patient || {};
    var encounter = data.encounter || {};
    var orders = Array.isArray(data.orders) ? data.orders : [];

    var html = '<div class="print-page">';
    html += buildHeader('Laboratory Report', 'Standard Report');
    html += buildPatientGrid(patient, encounter);

    if (!orders.length) {
      html += '<div class="alert-box alert-info">No validated results available for this report.</div>';
    } else {
      orders.forEach(function (o) {
        html += renderPanel(o);
      });
    }

    html += buildFooter();
    html += '</div>';
    return html;
  }

  function buildCumulative(data) {
    var patient = data.patient || {};
    var encounters = (data.encounters || patient.encounters || []).slice().reverse();
    var html = '<div class="print-page">';
    html += buildHeader('Cumulative Patient Report', 'All validated results');
    html += buildPatientGrid(patient, null);

    if (!encounters.length) {
      html += '<div class="alert-box alert-info">No encounters on record.</div>';
    } else {
      encounters.forEach(function (enc) {
        var labs = (enc.orders || []).filter(function (o) {
          return o.type === 'Laboratory' &&
            (o.resultStatus === 'Validated' || o.status === 'Validated' || o.status === 'Completed');
        });
        if (!labs.length) return;

        html += '<div class="section-title">'
          + esc(fmtDate(enc.date)) + ' · ' + esc(enc.visitId || '')
          + (enc.consultant ? ' · ' + esc(enc.consultant) : '')
          + '</div>';
        labs.forEach(function (o) {
          html += renderPanel(o);
        });
      });
    }

    html += buildFooter();
    html += '</div>';
    return html;
  }

  function buildCriticalAlert(data) {
    var patient = data.patient || {};
    var encounter = data.encounter || {};
    var order = data.order || {};
    var param = data.param || '';
    var r = (order.results && order.results[param]) || {};

    var html = '<div class="print-page">';
    html += buildHeader('Critical Result Alert', 'Urgent Clinical Notification');
    html += '<div class="alert-box alert-critical"><h2>⚠️ CRITICAL RESULT — IMMEDIATE CLINICAL ACTION ADVISED</h2>'
      + 'This result falls outside the configured critical limits. Please contact the requesting clinician '
      + 'or the laboratory without delay.</div>';
    html += buildPatientGrid(patient, encounter);

    html += '<div class="critical-panel">'
      + '<div class="param">' + esc(param) + '</div>'
      + '<div class="value">' + esc(r.value != null ? r.value : '—') + ' <span style="font-size:14px;font-weight:600;">' + esc(r.unit || '') + '</span></div>'
      + '<div class="meta">Flag: <strong>' + esc(r.flag || '—') + '</strong> · Reference: ' + esc(r.refText || '—') + '</div>'
      + '<div class="meta">Panel: ' + esc(order.item || '—') + ' · Validated: ' + esc(fmtDateTime(order.validatedAt)) + '</div>'
      + '<div class="meta">Validated by: ' + esc(order.validatedBy || '—') + '</div>'
      + '</div>';

    html += '<div class="stamp">Critical · Notified</div>';

    html += '<div class="signature-area">'
      + '<div class="sig-block"><div class="sig-line">Laboratory Scientist</div></div>'
      + '<div class="sig-block"><div class="sig-line">Requesting Clinician</div></div>'
      + '</div>';

    html += buildFooter();
    html += '</div>';
    return html;
  }

  function buildRejection(data) {
    var patient = data.patient || {};
    var encounter = data.encounter || {};
    var order = data.order || {};
    var reason = data.reason || order.rejectReason || '—';

    var html = '<div class="print-page">';
    html += buildHeader('Specimen Rejection Slip', 'Please re-collect and resubmit');
    html += buildPatientGrid(patient, encounter);

    html += '<div class="alert-box alert-warning"><strong>Specimen rejected</strong><br>'
      + 'The specimen received does not meet acceptance criteria for the requested investigation. '
      + 'Please re-collect and resubmit.</div>';

    html += '<div class="section-title">Rejected Investigation</div>';
    html += '<div class="kv">'
      + '<div class="k">Panel / Test</div><div class="v">' + esc(order.item || '—') + '</div>'
      + '<div class="k">Specimen ID</div><div class="v">' + esc(order.specimenId || '—') + '</div>'
      + '<div class="k">Specimen Type</div><div class="v">' + esc(order.specimenType || '—') + '</div>'
      + '<div class="k">Container</div><div class="v">' + esc(order.container || '—') + '</div>'
      + '<div class="k">Received</div><div class="v">' + esc(order.specimenReceivedDate || '—') + ' ' + esc(order.specimenReceivedTime || '') + '</div>'
      + '<div class="k">Rejected by</div><div class="v">' + esc(order.rejectedBy || '—') + '</div>'
      + '<div class="k">Rejected at</div><div class="v">' + esc(fmtDateTime(order.rejectedAt)) + '</div>'
      + '</div>';

    html += '<div class="section-title">Reason for Rejection</div>';
    html += '<div class="alert-box alert-warning" style="font-weight:600;">' + esc(reason) + '</div>';

    html += '<div class="signature-area">'
      + '<div class="sig-block"><div class="sig-line">Lab Scientist Signature</div></div>'
      + '<div class="sig-block"><div class="sig-line">Received by (Ward/Clinic)</div></div>'
      + '</div>';

    html += buildFooter();
    html += '</div>';
    return html;
  }

  function buildReferral(data) {
    var patient = data.patient || {};
    var encounter = data.encounter || {};
    var order = data.order || {};
    var referralLab = data.referralLab || 'External Laboratory';

    var html = '<div class="print-page">';
    html += buildHeader('External Referral Form', 'Outsourced investigation');
    html += buildPatientGrid(patient, encounter);

    html += '<div class="referral-box">'
      + '<strong>Referred to:</strong> ' + esc(referralLab) + '<br>'
      + '<strong>Referred on:</strong> ' + fmtDateTime(new Date().toISOString()) + '<br>'
      + '<strong>Referred by:</strong> LabCore Diagnostic Laboratory'
      + '</div>';

    html += '<div class="section-title">Investigation Requested</div>';
    html += '<div class="kv">'
      + '<div class="k">Panel / Test</div><div class="v">' + esc(order.item || '—') + '</div>'
      + '<div class="k">Priority</div><div class="v">' + esc(order.priority || 'Routine') + '</div>'
      + '<div class="k">Clinical Notes</div><div class="v">' + esc(order.note || order.panelComment || '—') + '</div>'
      + '</div>';

    html += '<div class="section-title">Clinical Summary</div>';
    html += '<div class="referral-box">'
      + (encounter.chiefComplaint ? '<strong>Chief complaint:</strong> ' + esc(encounter.chiefComplaint) + '<br>' : '')
      + (encounter.consultant ? '<strong>Requesting doctor:</strong> ' + esc(encounter.consultant) + '<br>' : '')
      + '<em>Further clinical details available on request.</em>'
      + '</div>';

    html += '<div class="signature-area">'
      + '<div class="sig-block"><div class="sig-line">Referring Lab Scientist</div></div>'
      + '<div class="sig-block"><div class="sig-line">Receiving Laboratory Stamp</div></div>'
      + '</div>';

    html += buildFooter();
    html += '</div>';
    return html;
  }

  /* =========================================================
     MAIN RENDER
  ========================================================= */
  function buildHtml(templateId, data) {
    switch (templateId) {
      case 'cumulative':    return buildCumulative(data);
      case 'criticalAlert': return buildCriticalAlert(data);
      case 'rejection':     return buildRejection(data);
      case 'referral':      return buildReferral(data);
      case 'standard':
      default:              return buildStandard(data);
    }
  }
    // Expose styles for the print-preview module
  window.__lcPrintStyles = buildStyles();


  /* =========================================================
     PUBLIC ENTRY — builds and opens print window
  ========================================================= */
  window.lcPrintBuildHtml = function (templateId, data) {
    return buildHtml(templateId, data);
  };

  window.lcPrintOpen = function (templateId, data) {
    data = data || {};
    var html;
    try {
      html = buildHtml(templateId, data);
    } catch (err) {
      console.error('[lcPrintOpen] build failed:', err);
      if (window.lcToast) window.lcToast('Print build failed: ' + (err.message || err), 'error');
      return false;
    }

    var win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      if (window.lcToast) window.lcToast('Popup blocked — please allow popups for printing', 'warning');
      return false;
    }

    var doc = win.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8">'
      + '<title>' + esc(templateId) + ' — LabCore</title>'
      + '<style>' + buildStyles() + '</style>'
      + '</head><body>' + html + '</body></html>');
    doc.close();

    // Wait for layout, then print
    setTimeout(function () {
      try {
        win.focus();
        win.print();
      } catch (e) {
        console.warn('print failed:', e);
      }
    }, 350);

    return true;
  };

  /* =========================================================
     CONVENIENCE WRAPPERS (legacy call sites)
  ========================================================= */

  // Standard current-encounter report from result-entry.html
  window.lcPrintStandard = function (patient, encounter, orders) {
    return window.lcPrintOpen('standard', {
      patient: patient,
      encounter: encounter,
      orders: orders || []
    });
  };

  // Cumulative for a single patient
  window.lcPrintCumulative = function (patient) {
    return window.lcPrintOpen('cumulative', { patient: patient });
  };

  // Critical alert for one param on one order
  window.lcPrintCritical = function (patient, encounter, order, param) {
    return window.lcPrintOpen('criticalAlert', {
      patient: patient,
      encounter: encounter,
      order: order,
      param: param
    });
  };

  // Rejection slip
  window.lcPrintRejection = function (patient, encounter, order, reason) {
    return window.lcPrintOpen('rejection', {
      patient: patient,
      encounter: encounter,
      order: order,
      reason: reason
    });
  };

  // Referral form
  window.lcPrintReferral = function (patient, encounter, order, referralLab) {
    return window.lcPrintOpen('referral', {
      patient: patient,
      encounter: encounter,
      order: order,
      referralLab: referralLab
    });
  };

  console.log('🖨️  LabCore Print Module loaded — templates:', TEMPLATES.map(function (t) { return t.id; }).join(', '));
})();