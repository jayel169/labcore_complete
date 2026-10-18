// shared/labcore-connectivity.js
// Simple online / offline banner. Purely cosmetic — does not queue or sync.
(function () {
  'use strict';

  if (window.__lcConnectivityLoaded) return;
  window.__lcConnectivityLoaded = true;

  var banner = null;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.id = 'lcOfflineBanner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;' +
      'background:#b08a2e;color:#fff;text-align:center;' +
      'padding:6px 16px;font-size:12px;font-weight:600;' +
      'letter-spacing:0.02em;box-shadow:0 2px 6px rgba(0,0,0,0.15);' +
      'transform:translateY(-100%);transition:transform 0.25s ease;';
    banner.textContent = '📡 You are offline — changes will sync when reconnected';
    document.body.appendChild(banner);
    return banner;
  }

  function show() {
    var el = ensureBanner();
    el.style.transform = 'translateY(0)';
  }

  function hide() {
    if (!banner) return;
    banner.style.transform = 'translateY(-100%)';
  }

  function sync() {
    if (navigator.onLine) hide(); else show();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      ensureBanner();
      sync();
    });
  } else {
    ensureBanner();
    sync();
  }

  window.addEventListener('online', hide);
  window.addEventListener('offline', show);

  console.log('📡 LabCore Connectivity banner loaded');
})();