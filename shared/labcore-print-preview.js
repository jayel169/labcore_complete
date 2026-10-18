// shared/labcore-print-preview.js
// LabCore Print Preview — shows report in a modal before printing
// Requires: shared/labcore-print.js (for lcPrintBuildHtml)
(function () {
  'use strict';

  if (window.__lcPrintPreviewLoaded) return;
  window.__lcPrintPreviewLoaded = true;

  var overlay = null;
  var currentHtml = '';
  var currentTitle = '';
  var currentSub = '';

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'lc-pp-overlay';
    overlay.innerHTML =
      '<div class="lc-pp-box">' +
        '<div class="lc-pp-head">' +
          '<div>' +
            '<h2 id="lcPpTitle">Print Preview</h2>' +
            '<p id="lcPpSub">Verify contents before printing</p>' +
          '</div>' +
          '<button class="lc-pp-close" title="Close">✕</button>' +
        '</div>' +
        '<div class="lc-pp-body" id="lcPpBody"></div>' +
        '<div class="lc-pp-foot">' +
          '<div class="lc-pp-opts">' +
            '<label><input type="checkbox" id="lcPpCopiesOpt"> Print 2 copies</label>' +
          '</div>' +
          '<div class="lc-pp-actions">' +
            '<button class="lc-pp-btn" id="lcPpCancel">Cancel</button>' +
            '<button class="lc-pp-btn lc-pp-btn-primary" id="lcPpConfirm">🖨️ Print</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.lc-pp-close').addEventListener('click', close);
    overlay.querySelector('#lcPpCancel').addEventListener('click', close);
    overlay.querySelector('#lcPpConfirm').addEventListener('click', confirm);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('show')) close();
    });
  }

  function open(html, title, sub) {
    buildOverlay();
    currentHtml = html;
    currentTitle = title || 'Print Preview';
    currentSub = sub || 'Verify contents before printing';

    overlay.querySelector('#lcPpTitle').textContent = currentTitle;
    overlay.querySelector('#lcPpSub').textContent = currentSub;

    var body = overlay.querySelector('#lcPpBody');
    body.innerHTML = html;

    var style = document.createElement('style');
    style.textContent = (window.__lcPrintStyles || '');
    body.appendChild(style);

    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
    document.body.style.overflow = '';
    overlay.querySelector('#lcPpBody').innerHTML = '';
  }

  function confirm() {
    var copies = overlay.querySelector('#lcPpCopiesOpt').checked ? 2 : 1;
    doPrint(currentHtml, copies);
    close();
  }

  function doPrint(html, copies) {
    var win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) {
      if (window.lcToast) window.lcToast('Popup blocked — allow popups to print', 'warning');
      return;
    }
    var doc = win.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>LabCore Print</title>' +
      '<style>' + (window.__lcPrintStyles || '') + '</style>' +
      '</head><body>' + html + '</body></html>');
    doc.close();

    setTimeout(function () {
      try {
        win.focus();
        for (var i = 0; i < copies; i++) win.print();
      } catch (e) { console.warn('print failed:', e); }
    }, 400);
  }

  window.lcPrintPreviewOpen = function (templateId, data) {
    if (typeof window.lcPrintBuildHtml !== 'function') {
      if (window.lcToast) window.lcToast('Print module not loaded', 'error');
      return false;
    }
    var html;
    try {
      html = window.lcPrintBuildHtml(templateId, data);
    } catch (err) {
      if (window.lcToast) window.lcToast('Preview failed: ' + err.message, 'error');
      return false;
    }
    var titles = {
      standard: ['Standard Lab Report', 'Per-encounter report'],
      cumulative: ['Cumulative Patient Report', 'All validated results'],
      criticalAlert: ['Critical Alert Notice', 'Urgent clinical notification'],
      rejection: ['Specimen Rejection Slip', 'Re-sample required'],
      referral: ['External Referral Form', 'Outsourced investigation']
    };
    var t = titles[templateId] || ['Print Preview', ''];
    open(html, t[0], t[1]);
    return true;
  };

  console.log('🖨️ LabCore Print Preview loaded');
})();