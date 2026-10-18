// shared/labcore-settings.js
// LabCore Facility Settings
// Stores facility identity, contact, location, signatory, report defaults,
// workflow defaults, and theme colors. Nothing about the facility is
// hardcoded anywhere in the app — every printed document reads from here.
(function () {
  'use strict';

  if (window.__lcSettingsLoaded) return;
  window.__lcSettingsLoaded = true;

  var STORAGE_KEY = 'labcore_settings_v1';

  /* =========================================================
     DEFAULTS — everything the operator must fill in is blank.
     Only truly neutral workflow defaults are pre-set.
     ========================================================= */
  var DEFAULTS = {
    // Identity
    facilityName: '',
    facilityShort: '',
    logoDataUrl: '',

    // Contact
    phonePrimary: '',
    phoneSecondary: '',
    email: '',
    website: '',

    // Location
    addressLine1: '',
    addressLine2: '',
    city: '',
    region: '',
    country: '',

    // Lab director / signatory
    directorName: '',
    signatureDataUrl: '',

    // Report defaults
    reportFooter: '',
    reportValidityNote: '',
    confidentialityNote: '',

      // Workflow
    currency: 'GHS',
    defaultTatHours: 24,
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',

    // Per-panel TAT SLAs — map of panelCode -> hours
    // e.g. { "FBC": 2, "CULT": 48 }
    panelTatSla: {},

    // Theme
    brandPrimary: '#2A2656',
    brandAccent: '#C23B6A'
  };

  /* =========================================================
     STORAGE
     ========================================================= */
  function readRaw() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) { return null; }
  }

  function writeRaw(obj) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
      return true;
    } catch (e) {
      console.warn('lcSettings: write failed', e);
      return false;
    }
  }

  /* =========================================================
     MIGRATION — pull legacy facility fields from the old
     receipt facility store (labcore_receipt_facility) so
     existing installs don't lose their name/address/phone.
     ========================================================= */
  function migrateLegacy() {
    if (readRaw()) return;   // already have settings — don't touch
    try {
      var legacyRaw = localStorage.getItem('labcore_receipt_facility');
      if (!legacyRaw) return;
      var legacy = JSON.parse(legacyRaw);
      if (!legacy || typeof legacy !== 'object') return;

      var seed = Object.assign({}, DEFAULTS);
      if (legacy.name)     seed.facilityName  = legacy.name;
      if (legacy.phone)    seed.phonePrimary  = legacy.phone;
      if (legacy.email)    seed.email         = legacy.email;
      if (legacy.address)  seed.addressLine1  = legacy.address;
      if (legacy.footer)   seed.reportFooter  = legacy.footer;

      writeRaw(seed);
      console.log('🌱 lcSettings: migrated legacy facility fields');
    } catch (e) {}
  }

  migrateLegacy();

  /* =========================================================
     GET / SET
     ========================================================= */
  function current() {
    var stored = readRaw() || {};
    return Object.assign({}, DEFAULTS, stored);
  }

  function set(key, value) {
    if (!key) return false;
    var obj = current();
    obj[key] = value;
    return writeRaw(obj);
  }

  function setAll(patch) {
    if (!patch || typeof patch !== 'object') return false;
    var obj = current();
    Object.keys(patch).forEach(function (k) { obj[k] = patch[k]; });
    return writeRaw(obj);
  }

  function reset() {
    return writeRaw(Object.assign({}, DEFAULTS));
  }

  /* =========================================================
     CONVENIENCE HELPERS — used by print / receipt / label
     modules. Each returns a string that is safe to display
     even when the operator hasn't configured the field yet.
     ========================================================= */

  function valOr(key, fallback) {
    var v = current()[key];
    return (v != null && String(v).trim() !== '') ? String(v) : (fallback || '');
  }

  function facilityName()  { return valOr('facilityName',  '⚠ Facility name not configured'); }
  function facilityShort() { return valOr('facilityShort', ''); }

  function phoneLine() {
    var c = current();
    var parts = [];
    if (c.phonePrimary)   parts.push(c.phonePrimary);
    if (c.phoneSecondary) parts.push(c.phoneSecondary);
    return parts.join(' / ');
  }

  function locationLine() {
    var c = current();
    var parts = [];
    [c.city, c.region, c.country].forEach(function (p) {
      if (p && String(p).trim()) parts.push(String(p).trim());
    });
    return parts.join(', ');
  }

  function addressBlock() {
    var c = current();
    return [c.addressLine1, c.addressLine2, locationLine()]
      .filter(function (s) { return s && String(s).trim(); })
      .join('\n');
  }

  function reportFooter() {
    return valOr('reportFooter', '');
  }

  function currency()  { return valOr('currency',  'GHS'); }
  function dateFormat() { return valOr('dateFormat', 'DD/MM/YYYY'); }
  function timeFormat() { return valOr('timeFormat', '24h'); }
  function defaultTatHours() {
    var n = Number(current().defaultTatHours);
    return (n > 0) ? n : 24;
  }

  function logoDataUrl()      { return current().logoDataUrl || ''; }
  function signatureDataUrl() { return current().signatureDataUrl || ''; }

  /* =========================================================
     APPLY THEME — writes brand colors into CSS variables
     on :root so the whole app picks them up.
     ========================================================= */
  function applyTheme() {
    var c = current();
    /* Saved colours that still equal the old navy/teal defaults are upgraded to the current palette */
    var primary = (c.brandPrimary || '').toUpperCase() === '#0B2E4F' ? DEFAULTS.brandPrimary : c.brandPrimary;
    var accent  = (c.brandAccent  || '').toUpperCase() === '#0E7C7B' ? DEFAULTS.brandAccent  : c.brandAccent;
    try {
      document.documentElement.style.setProperty('--lc-brand-primary', primary || DEFAULTS.brandPrimary);
      document.documentElement.style.setProperty('--lc-brand-accent',  accent  || DEFAULTS.brandAccent);
    } catch (e) {}
  }

  /* =========================================================
     FORMAT HELPERS — honor the operator's date/time prefs
     ========================================================= */
  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var yyyy = d.getFullYear();
    if (dateFormat() === 'MM/DD/YYYY') return mm + '/' + dd + '/' + yyyy;
    return dd + '/' + mm + '/' + yyyy;
  }

  function formatTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    var hh = d.getHours();
    var mm = String(d.getMinutes()).padStart(2, '0');
    if (timeFormat() === '12h') {
      var suffix = hh >= 12 ? 'PM' : 'AM';
      var h12 = hh % 12; if (h12 === 0) h12 = 12;
      return h12 + ':' + mm + ' ' + suffix;
    }
    return String(hh).padStart(2, '0') + ':' + mm;
  }

  /* =========================================================
     PUBLIC API
     ========================================================= */
  window.lcSettings = {
    DEFAULTS: DEFAULTS,
    get: current,
    set: set,
    setAll: setAll,
    reset: reset,
    applyTheme: applyTheme,

    // Convenience string helpers for print modules
    facilityName: facilityName,
    facilityShort: facilityShort,
    phoneLine: phoneLine,
    locationLine: locationLine,
    addressBlock: addressBlock,
    reportFooter: reportFooter,
            currency: currency,
    dateFormat: dateFormat,
    timeFormat: timeFormat,
    defaultTatHours: defaultTatHours,

    // TAT SLA helpers
    panelTatSla: function () {
      var m = current().panelTatSla;
      return (m && typeof m === 'object') ? m : {};
    },
    setPanelTatSla: function (code, hours) {
      if (!code) return false;
      var map = Object.assign({}, window.lcSettings.panelTatSla());
      var n = Number(hours);
      if (!n || n <= 0) {
        delete map[code];              // clearing removes the override
      } else {
        map[code] = n;
      }
      return set('panelTatSla', map);
    },
    tatForPanel: function (code) {
      if (code) {
        var m = window.lcSettings.panelTatSla();
        if (m[code] && Number(m[code]) > 0) return Number(m[code]);
      }
      return defaultTatHours();
    },
    logoDataUrl: logoDataUrl,
    signatureDataUrl: signatureDataUrl,

    // Formatters
    formatDate: formatDate,
    formatTime: formatTime
  };

  /* Apply theme colors as soon as the module loads */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTheme);
  } else {
    applyTheme();
  }

  console.log('⚙️  LabCore Settings loaded — facility name:',
    (current().facilityName || '(not configured)'));
})();