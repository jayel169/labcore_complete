// shared/labcore-labels.js
// LabCore — Label & Barcode Engine
(function () {
  'use strict';

  const TEMPLATE_KEY = 'labcore_label_template';
  const REGISTRY_KEY = 'labcore_specimens';
  const PRINT_LOG_KEY = 'labcore_label_print_log';

  // ---------- DEFAULT TEMPLATE ----------
  // Built dynamically so it always reflects the Settings page.
  function buildDefaultTemplate() {
    var s = window.lcSettings || {};
    var shortName = (s.facilityShort && s.facilityShort()) || 'LABCORE';
    return {
      sizeId: '50x30',
      widthMm: 50,
      heightMm: 30,
      showLogo: false,
      showPatientName: true,
      showPatientId: true,
      showVisitId: true,
      showTests: true,
      showContainer: true,
      showDate: true,
      showPriority: true,
      encodeTestsInBarcode: false,
      barcodeHeightMm: 8,
      headerText: shortName,
      copiesPerSpecimen: 1
    };
  }
  const DEFAULT_TEMPLATE = buildDefaultTemplate();

  const SIZE_PRESETS = {
    '40x25': { widthMm: 40, heightMm: 25, label: '40 × 25 mm (small thermal)' },
    '50x25': { widthMm: 50, heightMm: 25, label: '50 × 25 mm' },
    '50x30': { widthMm: 50, heightMm: 30, label: '50 × 30 mm (standard thermal)' },
    '60x40': { widthMm: 60, heightMm: 40, label: '60 × 40 mm' },
    'a4sheet': { widthMm: 48.5, heightMm: 25.4, label: 'A4 sheet 4×10 (48.5 × 25.4 mm)' }
  };

  // ---------- TEMPLATE STORE ----------
  window.lcLabelGetTemplate = function () {
    try {
      const raw = localStorage.getItem(TEMPLATE_KEY);
      if (raw) return Object.assign({}, DEFAULT_TEMPLATE, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULT_TEMPLATE);
  };

  window.lcLabelSaveTemplate = function (tpl) {
    try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(tpl)); return true; }
    catch (e) { return false; }
  };

  window.lcLabelSizePresets = SIZE_PRESETS;
  window.lcLabelDefaultTemplate = DEFAULT_TEMPLATE;

  // ---------- SPECIMEN REGISTRY ----------
  function readRegistry() {
    try { return JSON.parse(localStorage.getItem(REGISTRY_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function writeRegistry(list) {
    try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  window.lcSpecimenRegister = function (spec) {
    if (!spec || !spec.specimenId) return false;
    const list = readRegistry();
    const i = list.findIndex(s => s.specimenId === spec.specimenId);
    const record = {
      specimenId: spec.specimenId,
      patientId: spec.patientId || '',
      patientName: spec.patientName || '',
      visitId: spec.visitId || '',
      tests: Array.isArray(spec.tests) ? spec.tests : [],
      container: spec.container || '',
      specimenType: spec.specimenType || '',
      priority: spec.priority || 'Routine',
      receivedAt: spec.receivedAt || new Date().toISOString(),
      receivedBy: spec.receivedBy || (window.lcCurrentUserName ? window.lcCurrentUserName() : 'User'),
      labelPrinted: false,
      labelPrintedAt: null,
      labelPrintedBy: null
    };
    if (i >= 0) list[i] = Object.assign(list[i], record);
    else list.push(record);
        // Push to server too (fire-and-forget)
    if (window.lcApiSaveSpecimen) {
      try { window.lcApiSaveSpecimen(record); } catch (e) {}
    }

    return writeRegistry(list);
  };

  window.lcSpecimenAll = function () { return readRegistry(); };

  window.lcSpecimenUnprinted = function (sinceIso) {
    const list = readRegistry().filter(s => !s.labelPrinted);
    if (!sinceIso) return list;
    return list.filter(s => s.receivedAt >= sinceIso);
  };

  window.lcSpecimenByPatient = function (patientId) {
    return readRegistry().filter(s => s.patientId === patientId);
  };

  window.lcSpecimenMarkPrinted = function (specimenId, by) {
    const list = readRegistry();
    const i = list.findIndex(s => s.specimenId === specimenId);
    if (i < 0) return false;
    list[i].labelPrinted = true;
    list[i].labelPrintedAt = new Date().toISOString();
    list[i].labelPrintedBy = by || (window.lcCurrentUserName ? window.lcCurrentUserName() : 'User');

    const ok = writeRegistry(list);
    if (ok && window.lcApiMarkSpecimenPrinted) {
      try { window.lcApiMarkSpecimenPrinted(specimenId); } catch (e) {}
    }
    return ok;
  };

  window.lcSpecimenMarkPrintedBulk = function (specimenIds, by) {
    const list = readRegistry();
    let n = 0;
    const now = new Date().toISOString();
    const who = by || (window.lcCurrentUserName ? window.lcCurrentUserName() : 'User');
    list.forEach(s => {
      if (specimenIds.indexOf(s.specimenId) >= 0 && !s.labelPrinted) {
        s.labelPrinted = true;
        s.labelPrintedAt = now;
        s.labelPrintedBy = who;
        n++;
      }
    });
    writeRegistry(list);

    // Push each marked specimen to the server
    if (window.lcApiMarkSpecimenPrinted) {
      (specimenIds || []).forEach(function (id) {
        try { window.lcApiMarkSpecimenPrinted(id); } catch (e) {}
      });
    }

    return n;
  };

  // ---------- PRINT LOG ----------
  window.lcLabelLogPrint = function (specimenIds, templateSizeId) {
    try {
      const log = JSON.parse(localStorage.getItem(PRINT_LOG_KEY) || '[]');
      log.push({
        at: new Date().toISOString(),
        by: window.lcCurrentUserName ? window.lcCurrentUserName() : 'User',
        specimenIds: specimenIds || [],
        count: (specimenIds || []).length,
        size: templateSizeId || '50x30'
      });
      const trimmed = log.slice(-500);
      localStorage.setItem(PRINT_LOG_KEY, JSON.stringify(trimmed));
    } catch (e) {}
  };

  // ---------- BARCODE RENDERING ----------
  /**
   * Renders a CODE128 barcode on a canvas.
   * @param {string} text  Value to encode
   * @param {object} opts  { width, height, displayValue, fontSize, margin }
   * @returns {HTMLCanvasElement|null}
   */
  window.lcRenderBarcodeCanvas = function (text, opts) {
    if (!text) return null;
    opts = opts || {};
    if (typeof JsBarcode === 'undefined') {
      console.warn('JsBarcode not loaded');
      return null;
    }
    const canvas = document.createElement('canvas');
    try {
      JsBarcode(canvas, String(text), {
        format: 'CODE128',
        width: opts.width || 1.4,
        height: opts.height || 40,
        displayValue: opts.displayValue !== false,
        fontSize: opts.fontSize || 11,
        font: 'monospace',
        textMargin: 2,
        margin: opts.margin == null ? 4 : opts.margin,
        background: '#ffffff',
        lineColor: '#000000'
      });
      return canvas;
    } catch (e) {
      console.warn('Barcode failed:', e);
      return null;
    }
  };

  window.lcRenderBarcodeDataUrl = function (text, opts) {
    const c = window.lcRenderBarcodeCanvas(text, opts);
    return c ? c.toDataURL('image/png') : null;
  };

  // ---------- ZPL BUILDER ----------
  /**
   * Build ZPL for a batch of specimens (203 dpi by default).
   * Layout: 50 × 30 mm label at 203 dpi = 400 × 240 dots.
   */
  window.lcBuildZPL = function (specimens, tpl) {
    tpl = tpl || window.lcLabelGetTemplate();
    const dpi = 203;
    const mmToDots = mm => Math.round(mm * dpi / 25.4);
    const W = mmToDots(tpl.widthMm);
    const H = mmToDots(tpl.heightMm);

    let zpl = '';
    (specimens || []).forEach(s => {
      zpl += '^XA\n';
      zpl += '^CI28\n'; // UTF-8
      zpl += '^PW' + W + '\n';
      zpl += '^LL' + H + '\n';
      zpl += '^LH0,0\n';
      let y = 8;

      // Header text (acts as logo)
      if (tpl.headerText) {
        zpl += '^FO10,' + y + '^A0N,20,20^FD' + tpl.headerText + '^FS\n';
        zpl += '^FO' + (W - 10 - mmToDots(8)) + ',' + y + '^A0N,16,16^FD' + String(s.priority || 'Routine').replace(/[\^~]/g, '') + '^FS\n';
        y += 22;
      }

      // Barcode
      const barcodeValue = tpl.encodeTestsInBarcode
        ? (s.specimenId + ' ' + (s.tests || []).join(','))
        : s.specimenId;
      zpl += '^FO10,' + y + '^BY1.6,2.0,' + mmToDots(tpl.barcodeHeightMm) + '^BCN,,' + (tpl.showTests ? 'N' : 'Y') + ',N,N^FD' + barcodeValue + '^FS\n';
      y += mmToDots(tpl.barcodeHeightMm) + (tpl.showTests ? 4 : 22);

      // Human-readable ID (only if barcode does not display value)
      if (tpl.showTests) {
        zpl += '^FO10,' + y + '^A0N,18,18^FD' + s.specimenId + '^FS\n';
        y += 20;
      }

      if (tpl.showPatientName && s.patientName) {
        zpl += '^FO10,' + y + '^A0N,15,15^FD' + truncate(s.patientName, 28) + '^FS\n';
        y += 16;
      }
      if (tpl.showPatientId || tpl.showVisitId) {
        const line = [];
        if (tpl.showPatientId) line.push(s.patientId);
        if (tpl.showVisitId) line.push(s.visitId);
        zpl += '^FO10,' + y + '^A0N,13,13^FD' + line.join(' · ') + '^FS\n';
        y += 14;
      }
      if (tpl.showTests && s.tests && s.tests.length) {
        const txt = truncate(s.tests.join(', '), 42);
        zpl += '^FO10,' + y + '^A0N,13,13^FD' + txt + '^FS\n';
        y += 14;
      }
      if (tpl.showContainer || tpl.showDate) {
        const parts = [];
        if (tpl.showContainer && s.container) parts.push(s.container);
        if (tpl.showDate && s.receivedAt) parts.push(new Date(s.receivedAt).toISOString().slice(0, 10));
        zpl += '^FO10,' + y + '^A0N,11,11^FD' + parts.join(' · ') + '^FS\n';
      }

      zpl += '^XZ\n';
    });
    return zpl;
  };

  function truncate(str, n) {
    str = String(str || '');
    return str.length <= n ? str : str.slice(0, n - 1) + '…';
  }

  window.lcDownloadText = function (filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  console.log('🏷️ LabCore Labels engine loaded');
})();