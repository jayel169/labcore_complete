// shared/labcore-scan.js
// Barcode scan input helper. Any page can call lcScanStart() and it will
// open a small overlay that keeps a text input focused. A USB barcode
// scanner types the code + Enter, so we capture on Enter. The overlay
// never steals focus from the rest of the page until it's opened.
(function () {
  'use strict';

  if (window.__lcScanLoaded) return;
  window.__lcScanLoaded = true;

  var overlay = null;
  var input = null;
  var label = null;
  var active = false;
  var onScanCallback = null;

  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'lcScanOverlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10000;background:rgba(11,46,79,0.55);' +
      'backdrop-filter:blur(2px);display:none;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML =
      '<div style="background:#fff;border-radius:10px;width:min(520px,100%);padding:26px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;">' +
        '<div style="font-size:40px;margin-bottom:8px;">📷</div>' +
        '<div id="lcScanLabel" style="font-size:16px;font-weight:700;margin-bottom:6px;">Scan barcode</div>' +
        '<div id="lcScanHint" style="font-size:12px;color:#7a7f7b;margin-bottom:18px;">Point the scanner at a label and pull the trigger. Press Esc to cancel.</div>' +
        '<input id="lcScanInput" type="text" autocomplete="off" spellcheck="false" ' +
          'placeholder="Waiting for scan…" ' +
          'style="width:100%;padding:14px 16px;font-size:18px;font-family:Courier New,monospace;' +
          'letter-spacing:0.1em;text-align:center;border:2px solid #d1d3d0;border-radius:8px;outline:none;">' +
        '<div style="display:flex;justify-content:center;gap:8px;margin-top:18px;">' +
          '<button id="lcScanCancelBtn" style="padding:9px 16px;border:1px solid #d1d3d0;background:#fff;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    input = overlay.querySelector('#lcScanInput');
    label = overlay.querySelector('#lcScanLabel');
    overlay.querySelector('#lcScanCancelBtn').addEventListener('click', close);

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        var code = input.value.trim();
        if (!code) return;
        var cb = onScanCallback;
        close();
        if (typeof cb === 'function') cb(code);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!active) return;
      if (e.key === 'Escape') close();
    });
  }

  function open(opts) {
    opts = opts || {};
    build();
    onScanCallback = opts.onScan || null;
    label.textContent = opts.title || 'Scan barcode';
    overlay.querySelector('#lcScanHint').textContent =
      opts.hint || 'Point the scanner at a label and pull the trigger. Press Esc to cancel.';
    input.value = '';
    overlay.style.display = 'flex';
    active = true;
    setTimeout(function () { input.focus(); }, 30);
  }

  function close() {
    if (!overlay) return;
    overlay.style.display = 'none';
    active = false;
    onScanCallback = null;
  }

  window.lcScanStart = open;
  window.lcScanClose = close;
  window.lcScanIsOpen = function () { return active; };

  console.log('📷 LabCore Scan helper loaded');
})();