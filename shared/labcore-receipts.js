// shared/labcore-receipts.js
// LabCore Receipt Engine — save, lookup, print, reprint
(function () {
  'use strict';

  if (window.__lcReceiptsLoaded) return;
  window.__lcReceiptsLoaded = true;

  var STORAGE_KEY = 'labcore_receipts';
  var MAX_ENTRIES = 5000;

  /* =========================================================
     FACILITY CONFIG — edit these to match your lab
  ========================================================= */
  var FACILITY = {
    name: 'LABCORE DIAGNOSTIC LABORATORY',
    tagline: 'Laboratory Information System',
    address: 'Accra, Ghana',
    phone: '+233 XX XXX XXXX',
    email: 'billing@labcore.gh',
    taxId: '',
    footer: 'Thank you for choosing LabCore. This receipt is valid without signature.'
  };

  window.lcReceiptFacility = function () { return Object.assign({}, FACILITY); };
  window.lcReceiptSetFacility = function (opts) {
    Object.assign(FACILITY, opts || {});
    try { localStorage.setItem('labcore_receipt_facility', JSON.stringify(FACILITY)); } catch (e) {}
  };
  (function () {
    try {
      var saved = JSON.parse(localStorage.getItem('labcore_receipt_facility') || 'null');
      if (saved && typeof saved === 'object') Object.assign(FACILITY, saved);
    } catch (e) {}
  })();

  /* =========================================================
     STORAGE
  ========================================================= */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveAll(list) {
    if (list.length > MAX_ENTRIES) list = list.slice(list.length - MAX_ENTRIES);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }
  function actor() {
    var u = (window.lcGetUser && window.lcGetUser()) || null;
    return { name: (u && u.name) || 'Cashier' };
  }

  /* =========================================================
     RECEIPT NUMBER
     Format: LABCORE-YYYYMMDD-<encounterNumber>-<sequence>
     where encounterNumber is a short numeric code from visitId
  ========================================================= */
  function shortVisitCode(visitId) {
    if (!visitId) return '0000';
    // Encounter ID is usually like ENC-20261003-0042 → take last 4 chars
    var parts = String(visitId).split('-');
    var last = parts[parts.length - 1] || '0000';
    last = last.replace(/\D/g, '').slice(-4);
    while (last.length < 4) last = '0' + last;
    return last;
  }

  function nextSeqForDay(dateKey) {
    var list = loadAll();
    var max = 0;
    list.forEach(function (r) {
      if (r.dateKey === dateKey) {
        var n = parseInt(r.sequence, 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    return max + 1;
  }

  function buildReceiptNumber(dateKey, visitId) {
    var seq = nextSeqForDay(dateKey);
    var seqStr = String(seq);
    while (seqStr.length < 3) seqStr = '0' + seqStr;
    return {
      number: 'LABCORE-' + dateKey + '-' + shortVisitCode(visitId) + '-' + seqStr,
      sequence: seq
    };
  }

  /* =========================================================
     SAVE
  ========================================================= */
  window.lcSaveReceipt = function (opts) {
    opts = opts || {};
    var now = new Date();
    var dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');

    var built = buildReceiptNumber(dateKey, opts.visitId);

    var rec = {
      id: built.number,
      receiptNumber: built.number,
      sequence: built.sequence,
      dateKey: dateKey,
      printedAt: now.toISOString(),
      printedBy: actor().name,

      // Patient
      patientId: opts.patientId || '',
      patientName: opts.patientName || '',
      patientMobile: opts.patientMobile || '',
      patientSex: opts.patientSex || '',
      patientDob: opts.patientDob || '',

      // Encounter
      visitId: opts.visitId || '',
      service: opts.service || '',
      encounterDate: opts.encounterDate || '',

      // Billing
      items: Array.isArray(opts.items) ? opts.items.slice() : [],
      totalCharged: Number(opts.totalCharged) || 0,
      previousPaid: Number(opts.previousPaid) || 0,
      amountPaid: Number(opts.amountPaid) || 0,
      balanceRemaining: Number(opts.balanceRemaining) || 0,

      // Payment
      paymentMethod: opts.paymentMethod || 'Cash',
      paymentNote: opts.paymentNote || '',

      // Meta
      isReprint: false,
      reprintLog: []
    };

    var list = loadAll();
    list.push(rec);
    saveAll(list);

    if (window.lcAudit) {
      window.lcAudit('receipt.printed', {
        entity: 'receipt',
        entityId: rec.receiptNumber,
        patientId: rec.patientId,
        patientName: rec.patientName,
        visitId: rec.visitId,
        after: { amountPaid: rec.amountPaid, method: rec.paymentMethod },
        note: 'Receipt ' + rec.receiptNumber + ' · GHS ' + rec.amountPaid.toFixed(2)
      });
    }

    return rec;
  };

  window.lcCacheReceipt = function (receipt) {
    if (!receipt || !receipt.receiptNumber) throw new Error('receiptNumber is required');
    var list = loadAll();
    var index = list.findIndex(function (item) { return item.receiptNumber === receipt.receiptNumber; });
    if (index >= 0) list[index] = receipt;
    else list.push(receipt);
    saveAll(list);
    return receipt;
  };

  window.lcGetReceipt = function (receiptNumber) {
    return loadAll().find(function (r) { return r.receiptNumber === receiptNumber; }) || null;
  };

  window.lcListReceipts = function (filter) {
    filter = filter || {};
    var list = loadAll();

    if (filter.dateFrom) {
      list = list.filter(function (r) { return r.printedAt >= filter.dateFrom; });
    }
    if (filter.dateTo) {
      list = list.filter(function (r) { return r.printedAt <= filter.dateTo; });
    }
    if (filter.patientId) {
      list = list.filter(function (r) { return r.patientId === filter.patientId; });
    }
    if (filter.visitId) {
      list = list.filter(function (r) { return r.visitId === filter.visitId; });
    }
    if (filter.search) {
      var q = String(filter.search).toLowerCase();
      list = list.filter(function (r) {
        return (r.receiptNumber || '').toLowerCase().indexOf(q) >= 0 ||
               (r.patientName || '').toLowerCase().indexOf(q) >= 0 ||
               (r.patientId || '').toLowerCase().indexOf(q) >= 0 ||
               (r.visitId || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    list.sort(function (a, b) { return String(b.printedAt).localeCompare(String(a.printedAt)); });
    return list;
  };

  window.lcRecordReceiptReprint = function (receiptNumber) {
    var list = loadAll();
    var i = list.findIndex(function (r) { return r.receiptNumber === receiptNumber; });
    if (i < 0) return false;
    list[i].reprintLog = list[i].reprintLog || [];
    list[i].reprintLog.push({
      at: new Date().toISOString(),
      by: actor().name
    });
    saveAll(list);

    if (window.lcAudit) {
      window.lcAudit('receipt.reprinted', {
        entity: 'receipt',
        entityId: receiptNumber,
        patientId: list[i].patientId,
        patientName: list[i].patientName,
        note: 'Reprinted by ' + actor().name
      });
    }
    return true;
  };

  /* =========================================================
     DAILY SUMMARY
  ========================================================= */
  window.lcTodayReceiptsSummary = function () {
    var today = new Date().toISOString().slice(0, 10);
    var list = loadAll().filter(function (r) {
      return (r.printedAt || '').slice(0, 10) === today;
    });

    var byMethod = {};
    var total = 0;
    list.forEach(function (r) {
      byMethod[r.paymentMethod] = (byMethod[r.paymentMethod] || 0) + Number(r.amountPaid || 0);
      total += Number(r.amountPaid || 0);
    });

    return {
      date: today,
      count: list.length,
      total: total,
      byMethod: byMethod,
      receipts: list
    };
  };

  /* =========================================================
     RENDER — RECEIPT HTML
  ========================================================= */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    n = Number(n) || 0;
    return 'GHS ' + n.toFixed(2);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Build receipt HTML.
   * @param {object} receipt
   * @param {string} size  'a4' | '58mm' | '80mm'
   */
  window.lcBuildReceiptHTML = function (receipt, size) {
    size = size || 'a4';
    var r = receipt;
    var f = FACILITY;

    if (size === '58mm' || size === '80mm') {
      return buildThermalReceipt(r, size);
    }
    return buildA4Receipt(r);
  };

  /* ---------------------------------------------------------
     A4 LAYOUT
  --------------------------------------------------------- */
  function buildA4Receipt(r) {
    var f = FACILITY;
    var itemRows = (r.items || []).map(function (it, i) {
      return '<tr>' +
        '<td style="text-align:center;width:30px;">' + (i + 1) + '</td>' +
        '<td>' + esc(it.item || it.name || '') + '</td>' +
        '<td style="text-align:right;white-space:nowrap;">' + money(it.amount || 0) + '</td>' +
      '</tr>';
    }).join('');

    if (!itemRows) {
      itemRows = '<tr><td colspan="3" style="text-align:center;color:#888;font-style:italic;">No charge lines</td></tr>';
    }

    return '' +
    '<div class="lc-receipt lc-receipt-a4">' +
      // Header
      '<div class="lc-rcpt-header">' +
        '<div class="lc-rcpt-brand">' +
          '<div class="lc-rcpt-logo">LC</div>' +
          '<div>' +
            '<div class="lc-rcpt-facility">' + esc(f.name) + '</div>' +
            '<div class="lc-rcpt-tagline">' + esc(f.tagline) + '</div>' +
            '<div class="lc-rcpt-addr">' + esc(f.address) + ' · ' + esc(f.phone) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lc-rcpt-meta">' +
          '<div class="lc-rcpt-title">PAYMENT RECEIPT</div>' +
          (r.isReprint ? '<div class="lc-rcpt-reprint">REPRINT</div>' : '') +
          '<div class="lc-rcpt-num">' + esc(r.receiptNumber) + '</div>' +
          '<div class="lc-rcpt-date">' + fmtDate(r.printedAt) + ' · ' + fmtTime(r.printedAt) + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="lc-rcpt-rule"></div>' +

      // Patient info grid
      '<div class="lc-rcpt-patient">' +
        '<div><span>Patient</span>' + esc(r.patientName) + '</div>' +
        '<div><span>Patient ID</span>' + esc(r.patientId) + '</div>' +
        '<div><span>Encounter</span>' + esc(r.visitId) + '</div>' +
        '<div><span>Sex</span>' + esc(r.patientSex) + '</div>' +
        '<div><span>Mobile</span>' + esc(r.patientMobile) + '</div>' +
        '<div><span>Service</span>' + esc(r.service) + '</div>' +
      '</div>' +

      // Line items
      '<table class="lc-rcpt-items">' +
        '<thead>' +
          '<tr>' +
            '<th style="text-align:center;width:30px;">#</th>' +
            '<th>Item</th>' +
            '<th style="text-align:right;">Amount</th>' +
          '</tr>' +
        '</thead>' +
        '<tbody>' + itemRows + '</tbody>' +
      '</table>' +

      // Totals
      '<div class="lc-rcpt-totals">' +
        '<div class="lc-rcpt-row"><span>Total Charged</span><strong>' + money(r.totalCharged) + '</strong></div>' +
        '<div class="lc-rcpt-row"><span>Previously Paid</span><strong>' + money(r.previousPaid) + '</strong></div>' +
        '<div class="lc-rcpt-row lc-rcpt-highlight"><span>Amount Paid Now</span><strong>' + money(r.amountPaid) + '</strong></div>' +
        '<div class="lc-rcpt-row lc-rcpt-balance"><span>Balance Remaining</span><strong>' + money(r.balanceRemaining) + '</strong></div>' +
      '</div>' +

      // Payment method
      '<div class="lc-rcpt-paymethod">' +
        '<span>Payment Method</span>' +
        '<strong>' + esc(r.paymentMethod) + '</strong>' +
        (r.paymentNote ? '<em> · ' + esc(r.paymentNote) + '</em>' : '') +
      '</div>' +

      // Signatures
      '<div class="lc-rcpt-signatures">' +
        '<div class="lc-rcpt-sign-block">' +
          '<div class="lc-rcpt-sign-line"></div>' +
          '<div>Received by: ' + esc(r.printedBy || '—') + '</div>' +
        '</div>' +
        '<div class="lc-rcpt-sign-block">' +
          '<div class="lc-rcpt-sign-line"></div>' +
          '<div>Patient / Guardian signature</div>' +
        '</div>' +
      '</div>' +

      // Footer
      '<div class="lc-rcpt-footer">' +
        '<div>' + esc(f.footer) + '</div>' +
        '<div class="lc-rcpt-printed">Printed: ' + fmtDate(r.printedAt) + ' · ' + fmtTime(r.printedAt) + '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------------------------------------------------
     THERMAL LAYOUT (58mm / 80mm)
  --------------------------------------------------------- */
  function buildThermalReceipt(r, size) {
    var f = FACILITY;
    var wide = size === '80mm';

    var itemRows = (r.items || []).map(function (it) {
      var name = it.item || it.name || '';
      // thermal receipts often use single-line items
      return '<div class="lc-th-line">' +
        '<div class="lc-th-name">' + esc(name) + '</div>' +
        '<div class="lc-th-amount">' + money(it.amount || 0) + '</div>' +
      '</div>';
    }).join('');

    if (!itemRows) {
      itemRows = '<div class="lc-th-line"><div class="lc-th-name" style="color:#666;">No charge lines</div><div></div></div>';
    }

    return '' +
    '<div class="lc-receipt lc-receipt-thermal ' + (wide ? 'lc-receipt-80mm' : 'lc-receipt-58mm') + '">' +
      '<div class="lc-th-center lc-th-facility">' + esc(f.name) + '</div>' +
      '<div class="lc-th-center lc-th-addr">' + esc(f.address) + '</div>' +
      '<div class="lc-th-center lc-th-addr">Tel: ' + esc(f.phone) + '</div>' +
      '<div class="lc-th-divider">--------------------------------</div>' +

      '<div class="lc-th-center lc-th-title">PAYMENT RECEIPT</div>' +
      (r.isReprint ? '<div class="lc-th-center lc-th-reprint">*** REPRINT ***</div>' : '') +
      '<div class="lc-th-center lc-th-num">' + esc(r.receiptNumber) + '</div>' +
      '<div class="lc-th-center lc-th-date">' + fmtDate(r.printedAt) + ' ' + fmtTime(r.printedAt) + '</div>' +

      '<div class="lc-th-divider">--------------------------------</div>' +

      '<div class="lc-th-row"><span>Patient:</span><strong>' + esc(r.patientName) + '</strong></div>' +
      '<div class="lc-th-row"><span>Patient ID:</span><strong>' + esc(r.patientId) + '</strong></div>' +
      '<div class="lc-th-row"><span>Encounter:</span><strong>' + esc(r.visitId) + '</strong></div>' +
      (r.patientSex ? '<div class="lc-th-row"><span>Sex:</span><strong>' + esc(r.patientSex) + '</strong></div>' : '') +

      '<div class="lc-th-divider">--------------------------------</div>' +

      '<div class="lc-th-items">' + itemRows + '</div>' +

      '<div class="lc-th-divider">--------------------------------</div>' +

      '<div class="lc-th-total"><span>Total Charged</span><strong>' + money(r.totalCharged) + '</strong></div>' +
      '<div class="lc-th-total"><span>Prev. Paid</span><strong>' + money(r.previousPaid) + '</strong></div>' +
      '<div class="lc-th-total lc-th-paid"><span>Paid Now</span><strong>' + money(r.amountPaid) + '</strong></div>' +
      '<div class="lc-th-total lc-th-balance"><span>Balance</span><strong>' + money(r.balanceRemaining) + '</strong></div>' +

      '<div class="lc-th-divider">--------------------------------</div>' +

      '<div class="lc-th-row"><span>Method:</span><strong>' + esc(r.paymentMethod) + '</strong></div>' +
      '<div class="lc-th-row"><span>Served by:</span><strong>' + esc(r.printedBy) + '</strong></div>' +

      '<div class="lc-th-divider">--------------------------------</div>' +

      '<div class="lc-th-center lc-th-thanks">Thank you!</div>' +
      '<div class="lc-th-center lc-th-footer">' + esc(f.footer) + '</div>' +
      '<div style="height:24px;"></div>' +
    '</div>';
  }

  /* =========================================================
     PRINT STYLES
  ========================================================= */
  window.lcReceiptStyles = function (size) {
    size = size || 'a4';
    var base = '' +
      '.lc-receipt { color: #111; background: #fff; font-family: "Segoe UI", Arial, sans-serif; box-sizing: border-box; }' +
      '.lc-receipt * { box-sizing: border-box; }' +

      /* A4 */
      '.lc-receipt-a4 { max-width: 210mm; margin: 0 auto; padding: 20px 24px; font-size: 12px; }' +
      '.lc-rcpt-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }' +
      '.lc-rcpt-brand { display: flex; gap: 12px; align-items: center; }' +
      '.lc-rcpt-logo { width: 48px; height: 48px; background: #d5b36a; color: #1a3a5c; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 20px; }' +
      '.lc-rcpt-facility { font-size: 16px; font-weight: 800; color: #1a3a5c; letter-spacing: 0.4px; }' +
      '.lc-rcpt-tagline { font-size: 10px; color: #6b7a8a; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }' +
      '.lc-rcpt-addr { font-size: 10px; color: #6b7a8a; margin-top: 4px; }' +
      '.lc-rcpt-meta { text-align: right; }' +
      '.lc-rcpt-title { font-size: 13px; font-weight: 800; color: #1a3a5c; letter-spacing: 1px; }' +
      '.lc-rcpt-reprint { display: inline-block; background: #b74b43; color: #fff; font-size: 9px; font-weight: 800; padding: 2px 8px; border-radius: 3px; margin-top: 4px; letter-spacing: 1px; }' +
      '.lc-rcpt-num { font-size: 12px; font-weight: 700; color: #1a3a5c; margin-top: 4px; font-family: "Courier New", monospace; }' +
      '.lc-rcpt-date { font-size: 10px; color: #6b7a8a; margin-top: 2px; }' +
      '.lc-rcpt-rule { height: 2px; background: #1a3a5c; margin: 12px 0 14px; }' +
      '.lc-rcpt-patient { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; font-size: 12px; }' +
      '.lc-rcpt-patient > div span { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7a8a; font-weight: 700; margin-bottom: 2px; }' +
      '.lc-rcpt-items { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 14px; }' +
      '.lc-rcpt-items th { background: #f1f4f8; padding: 8px 10px; text-align: left; font-size: 9px; text-transform: uppercase; color: #5a6a7a; border-bottom: 1px solid #e2e8f0; }' +
      '.lc-rcpt-items td { padding: 7px 10px; border-bottom: 1px solid #edf0f2; }' +
      '.lc-rcpt-totals { margin-left: auto; width: 320px; max-width: 100%; }' +
      '.lc-rcpt-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; border-bottom: 1px solid #eee; }' +
      '.lc-rcpt-row strong { font-variant-numeric: tabular-nums; }' +
      '.lc-rcpt-highlight { background: #e8f5ee; padding: 8px 10px; margin-top: 6px; border-radius: 4px; font-size: 13px; border: 1px solid #b6dcc2; }' +
      '.lc-rcpt-highlight strong { color: #2d7a46; }' +
      '.lc-rcpt-balance { background: #fde8e8; padding: 8px 10px; margin-top: 6px; border-radius: 4px; font-size: 13px; border: 1px solid #f0c0c0; }' +
      '.lc-rcpt-balance strong { color: #b74b43; }' +
      '.lc-rcpt-paymethod { margin-top: 14px; padding: 8px 12px; background: #f8fafc; border-left: 3px solid #245b86; font-size: 12px; }' +
      '.lc-rcpt-paymethod span { font-size: 9px; text-transform: uppercase; color: #6b7a8a; font-weight: 700; letter-spacing: 0.5px; display: block; }' +
      '.lc-rcpt-paymethod strong { font-size: 13px; }' +
      '.lc-rcpt-paymethod em { color: #6b7a8a; font-size: 11px; }' +
      '.lc-rcpt-signatures { display: flex; justify-content: space-between; gap: 40px; margin-top: 40px; }' +
      '.lc-rcpt-sign-block { flex: 1; font-size: 11px; color: #6b7a8a; }' +
      '.lc-rcpt-sign-line { border-top: 1px solid #1a1a2e; margin-bottom: 4px; height: 30px; }' +
      '.lc-rcpt-footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #6b7a8a; text-align: center; }' +
      '.lc-rcpt-printed { font-size: 9px; margin-top: 4px; }' +

      /* THERMAL — base */
      '.lc-receipt-thermal { font-family: "Courier New", monospace; font-size: 11px; line-height: 1.35; padding: 4mm 3mm; margin: 0 auto; }' +
      '.lc-receipt-58mm { width: 58mm; }' +
      '.lc-receipt-80mm { width: 80mm; font-size: 12px; }' +
      '.lc-th-center { text-align: center; }' +
      '.lc-th-facility { font-weight: 800; font-size: 13px; letter-spacing: 0.5px; }' +
      '.lc-receipt-80mm .lc-th-facility { font-size: 15px; }' +
      '.lc-th-addr { font-size: 9px; }' +
      '.lc-receipt-80mm .lc-th-addr { font-size: 10px; }' +
      '.lc-th-divider { text-align: center; font-size: 10px; color: #000; margin: 4px 0; }' +
      '.lc-th-title { font-weight: 800; font-size: 12px; letter-spacing: 1px; margin-top: 4px; }' +
      '.lc-receipt-80mm .lc-th-title { font-size: 13px; }' +
      '.lc-th-reprint { font-weight: 800; font-size: 11px; color: #b74b43; letter-spacing: 1px; margin-top: 2px; }' +
      '.lc-th-num { font-weight: 700; font-size: 11px; margin-top: 3px; }' +
      '.lc-th-date { font-size: 10px; }' +
      '.lc-th-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 1px 0; }' +
      '.lc-th-row span { color: #555; }' +
      '.lc-th-row strong { text-align: right; word-break: break-word; }' +
      '.lc-th-items { margin-top: 4px; }' +
      '.lc-th-line { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; padding: 1px 0; }' +
      '.lc-th-name { flex: 1; word-break: break-word; }' +
      '.lc-th-amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }' +
      '.lc-th-total { display: flex; justify-content: space-between; font-size: 11px; padding: 1px 0; }' +
      '.lc-th-paid { font-weight: 800; font-size: 12px; padding-top: 3px; }' +
      '.lc-th-balance { font-weight: 800; font-size: 12px; }' +
      '.lc-th-thanks { font-weight: 800; margin-top: 3px; font-size: 12px; }' +
      '.lc-th-footer { font-size: 9px; margin-top: 2px; }';

    // Print rules depend on target printer
    var print = '';
    if (size === '58mm') {
      print = '@page { size: 58mm auto; margin: 0; } body { margin: 0; }';
    } else if (size === '80mm') {
      print = '@page { size: 80mm auto; margin: 0; } body { margin: 0; }';
    } else {
      print = '@page { size: A4; margin: 8mm; } body { margin: 0; }';
    }

    return base + '@media print { ' + print + ' .no-print { display: none !important; } }';
  };

  /* =========================================================
     PRINT OPEN
  ========================================================= */
  /**
   * Open a new window with the receipt ready to print.
   * @param {object} receipt  full receipt record
   * @param {string} size     'a4' | '58mm' | '80mm'
   */
  window.lcPrintReceipt = function (receipt, size) {
    size = size || 'a4';
    var html = window.lcBuildReceiptHTML(receipt, size);
    var css = window.lcReceiptStyles(size);

    var win = window.open('', '_blank', 'width=' + (size === 'a4' ? 900 : 400) + ',height=800');
    if (!win) {
      if (window.lcToast) window.lcToast('Popup blocked — allow popups for printing', 'warning');
      return false;
    }
    var doc = win.document;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
      esc(receipt.receiptNumber) + '</title><style>' + css +
      'body { background: #f4f5f3; padding: 20px; }' +
      '.no-print-bar { text-align: center; margin-bottom: 12px; }' +
      '.no-print-bar button { padding: 8px 16px; font-size: 13px; margin: 0 4px; cursor: pointer; border-radius: 6px; border: 1px solid #ccc; background: #fff; }' +
      '.no-print-bar button.primary { background: #245b86; color: #fff; border-color: #245b86; }' +
      '@media print { body { background: #fff; padding: 0; } }' +
      '</style></head><body>' +
      '<div class="no-print-bar">' +
        '<button class="primary" onclick="window.print()">🖨️ Print</button>' +
        '<button onclick="window.close()">Close</button>' +
      '</div>' +
      html +
      '</body></html>');
    doc.close();

    // Auto-print after a short delay
    setTimeout(function () {
      try { win.focus(); win.print(); } catch (e) { console.warn('print failed', e); }
    }, 350);

    return true;
  };

  /**
   * Reprint a saved receipt by number.
   * Automatically flags it as a reprint.
   */
  window.lcReprintReceipt = function (receiptNumber, size) {
    var r = window.lcGetReceipt(receiptNumber);
    if (!r) {
      if (window.lcToast) window.lcToast('Receipt not found', 'error');
      return false;
    }
    // Build a reprint copy so we don't mutate the original
    var copy = Object.assign({}, r, { isReprint: true });
    window.lcRecordReceiptReprint(receiptNumber);
    return window.lcPrintReceipt(copy, size || 'a4');
  };

  console.log('🧾 LabCore Receipts Engine loaded');
})();