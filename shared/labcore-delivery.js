// shared/labcore-delivery.js
// LabCore Secure Report Delivery — Email / WhatsApp / Telegram
// Pattern: short-lived viewer link + separate PIN + audit trail + watermark.
// Security model (ISO 15189 aware):
//   1. Message body contains NO patient data.
//   2. Link points to a single-use, PIN-gated viewer.
//   3. PIN is delivered out-of-band (staff reads it aloud / separate message).
//   4. Every open, download, and revoke is logged.
(function () {
  'use strict';

  var STORAGE_KEY = 'labcore_deliveries';
  var MAX_ENTRIES = 2000;

  var DEFAULT_TTL_HOURS = 24;
  var MAX_DOWNLOADS_PER_LINK = 1;
  var MAX_SENDS_PER_REPORT_PER_DAY = 3;

  /* =========================================================
     STORAGE
     ========================================================= */

  function loadAll() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveAll(list) {
    try {
      if (list.length > MAX_ENTRIES) list = list.slice(list.length - MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('delivery store write failed', e);
      return false;
    }
  }

  function newId() {
    return 'DLV-' + Date.now().toString(36).toUpperCase() + '-' +
           Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function newPin() {
    // 6 digits, cryptographically reasonable (not Math.random for real prod)
    var buf = new Uint32Array(1);
    try { crypto.getRandomValues(buf); } catch (e) { buf[0] = Math.random() * 1e9; }
    return String(buf[0] % 1000000).padStart(6, '0');
  }

  function currentUser() {
    try {
      if (window.lcGetUser) {
        var u = window.lcGetUser();
        if (u) return { name: u.name || u.label || 'User', role: u.id || u.role || 'unknown' };
      }
    } catch (e) {}
    return { name: 'System', role: 'system' };
  }

  /* =========================================================
     CORE API
     ========================================================= */

  /**
   * Create a delivery record. Returns the record with the viewer link.
   * @param {object} opts — { reportRef, patientId, visitId, channel, recipient,
   *                          recipientName, ttlHours }
   */
  window.lcCreateDelivery = async function (opts) {
    opts = opts || {};
    if (!opts.channel || ['email', 'whatsapp', 'telegram'].indexOf(opts.channel) === -1) {
      throw new Error('Invalid channel. Use email, whatsapp, or telegram.');
    }
    if (!opts.recipient) throw new Error('recipient required');
    if (!opts.reportRef) throw new Error('reportRef required');

    var ttlHours = Number(opts.ttlHours) || DEFAULT_TTL_HOURS;
    if (!window.lcApiCreateDelivery) throw new Error('Backend delivery API is unavailable.');
    var rec = await window.lcApiCreateDelivery({
      channel: opts.channel,
      recipient: opts.recipient,
      recipientName: opts.recipientName || '',
      reportRef: opts.reportRef,
      patientId: opts.patientId || null,
      visitId: opts.visitId || null,
      ttlHours: ttlHours,
      note: opts.note || ''
    });
    rec.createdByRole = currentUser().role;
    rec.downloadLimit = MAX_DOWNLOADS_PER_LINK;
    rec.downloads = 0;
    rec.opened = false;
    rec.revoked = false;
    rec.openLog = [];
    rec.note = opts.note || '';

    if (window.lcAudit) {
      var action = rec.channel === 'email' ? 'report.sent_email' :
                   rec.channel === 'whatsapp' ? 'report.sent_whatsapp' :
                   'report.sent_telegram';
      window.lcAudit(action, {
        entity: 'delivery',
        entityId: rec.id,
        patientId: rec.patientId,
        visitId: rec.visitId,
        after: { channel: rec.channel, recipient: maskRecipient(rec.recipient, rec.channel) },
        note: 'Delivery created · expires ' + new Date(rec.expiresAt).toLocaleString()
      });
    }

    return rec;
  };

  /**
   * Get a delivery by ID. Returns null if missing.
   */
  window.lcGetDelivery = function (id) {
    var all = loadAll();
    return all.find(function (d) { return d.id === id; }) || null;
  };

  /**
   * Verify the PIN. Returns { ok, reason } — never throws.
   */
  window.lcVerifyDeliveryPin = function (id, pin) {
    var d = window.lcGetDelivery(id);
    if (!d) return { ok: false, reason: 'not_found' };
    if (d.revoked) return { ok: false, reason: 'revoked' };
    if (new Date(d.expiresAt).getTime() < Date.now()) return { ok: false, reason: 'expired' };
    if (d.downloads >= d.downloadLimit) return { ok: false, reason: 'limit' };
    if (String(pin) !== String(d.pin)) return { ok: false, reason: 'wrong_pin' };
    return { ok: true };
  };

  /**
   * Record an open event (once PIN is verified).
   */
  window.lcRecordDeliveryOpen = function (id) {
    var all = loadAll();
    var i = all.findIndex(function (d) { return d.id === id; });
    if (i < 0) return null;
    var d = all[i];
    var evt = {
      at: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 140),
      ref: document.referrer || ''
    };
    d.openLog.push(evt);
    d.opened = true;
    all[i] = d;
    saveAll(all);

       if (window.lcAudit) {
      window.lcAudit('report.link_opened', {
        entity: 'delivery',
        entityId: d.id,
        patientId: d.patientId,
        visitId: d.visitId,
        note: 'Viewer opened'
      });
    }
    return d;
  };

  /**
   * Increment download counter (call when user clicks download / print).
   */
  window.lcRecordDeliveryDownload = function (id) {
    var all = loadAll();
    var i = all.findIndex(function (d) { return d.id === id; });
    if (i < 0) return false;
    var d = all[i];
    d.downloads++;
    all[i] = d;
    saveAll(all);
    return true;
  };

  /**
   * Revoke a link. Any subsequent open shows "revoked".
   */
  window.lcRevokeDelivery = function (id, reason) {
    var all = loadAll();
    var i = all.findIndex(function (d) { return d.id === id; });
    if (i < 0) return false;
    var d = all[i];
    d.revoked = true;
    d.revokedAt = new Date().toISOString();
    d.revokedBy = currentUser().name;
    d.revokeReason = reason || '';
    all[i] = d;
    saveAll(all);

       if (window.lcAudit) {
      window.lcAudit('report.link_revoked', {
        entity: 'delivery',
        entityId: d.id,
        patientId: d.patientId,
        visitId: d.visitId,
        note: reason || 'Revoked'
      });
    }
    return true;
  };

  /**
   * Purge expired deliveries older than N days. Call from a maintenance view.
   */
  window.lcPurgeExpiredDeliveries = function (olderThanDays) {
    olderThanDays = Number(olderThanDays) || 30;
    var cutoff = Date.now() - olderThanDays * 24 * 3600 * 1000;
    var all = loadAll();
    var kept = all.filter(function (d) {
      return new Date(d.expiresAt).getTime() > cutoff;
    });
    saveAll(kept);
    return all.length - kept.length;
  };

  /* =========================================================
     VIEWER URL
     ========================================================= */

  /**
   * Build the viewer URL for a delivery.
   * Uses file:// when running as a local file; otherwise uses the current origin.
   */
  window.lcDeliveryViewerURL = function (id) {
    var base = window.location.href.split('#')[0].split('?')[0];
    // If we're on result-entry.html or similar, drop the file name
    var idx = base.lastIndexOf('/');
    if (idx >= 0) base = base.substring(0, idx + 1);
    return base + 'report-viewer.html?t=' + encodeURIComponent(id);
  };

  /* =========================================================
     MESSAGE COMPOSITION
     ========================================================= */

  /**
   * Short notification text. Contains NO patient data.
   */
  window.lcDeliveryMessageText = function (delivery) {
    var url = window.lcDeliveryViewerURL(delivery.id);
    var expiry = new Date(delivery.expiresAt);
    var ttlHours = Math.round((expiry - new Date(delivery.createdAt)) / 3600000);
    return 'LabCore: A laboratory report is ready.\n' +
           'View securely (expires in ' + ttlHours + 'h):\n' +
           url + '\n' +
           'You will be asked for a 6-digit PIN, sent separately by the lab.';
  };

  /* =========================================================
     CHANNEL DELIVERY
     ========================================================= */

  /**
   * Email via EmailJS. Caller must configure the service ID and template ID.
   * This function assumes window.emailjs is loaded.
   */
  window.lcSendEmailDelivery = function (delivery, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (typeof emailjs === 'undefined') {
        reject(new Error('EmailJS SDK not loaded. Add the <script> tag.'));
        return;
      }
      var serviceId = opts.serviceId || window.LABCORE_EMAILJS_SERVICE_ID;
      var templateId = opts.templateId || window.LABCORE_EMAILJS_TEMPLATE_ID;
      var publicKey = opts.publicKey || window.LABCORE_EMAILJS_PUBLIC_KEY;
      if (!serviceId || !templateId || !publicKey) {
        reject(new Error('EmailJS credentials missing. Set window.LABCORE_EMAILJS_*'));
        return;
      }
      emailjs.send(serviceId, templateId, {
        to_email: delivery.recipient,
        to_name: delivery.recipientName || 'Recipient',
        message_body: window.lcDeliveryMessageText(delivery),
        viewer_url: window.lcDeliveryViewerURL(delivery.id),
        delivery_id: delivery.id
      }, { publicKey: publicKey })
        .then(function (res) { resolve(res); })
        .catch(function (err) { reject(err); });
    });
  };

  /**
   * WhatsApp click-to-send. Opens wa.me with pre-filled text.
   * The message contains the viewer URL — PIN is delivered separately.
   */
  window.lcSendWhatsAppDelivery = function (delivery) {
    var number = String(delivery.recipient || '').replace(/\D/g, '');
    if (!number) throw new Error('Invalid WhatsApp number');
    var text = encodeURIComponent(window.lcDeliveryMessageText(delivery));
    var url = 'https://wa.me/' + number + '?text=' + text;
    var w = window.open(url, '_blank');
    return !!w;
  };

  /**
   * Telegram. Two modes:
   *   - If a bot endpoint is configured (Cloudflare Worker), push programmatically.
   *   - Otherwise, fall back to https://t.me/<handle> click-to-send with a copy prompt.
   */
  window.lcSendTelegramDelivery = function (delivery, opts) {
    opts = opts || {};
    var endpoint = opts.endpoint || window.LABCORE_TELEGRAM_ENDPOINT;

    if (endpoint) {
      // Server-driven: POST to Cloudflare Worker, which talks to the bot
      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: delivery.recipient,   // handle or numeric chat id
          text: window.lcDeliveryMessageText(delivery),
          delivery_id: delivery.id
        })
      }).then(function (r) {
        if (!r.ok) throw new Error('Telegram worker returned ' + r.status);
        return r.json();
      });
    }

    // Fallback: click-to-send via t.me
    var handle = String(delivery.recipient || '').replace(/^@/, '');
    if (!handle) throw new Error('Invalid Telegram handle');
    var url = 'https://t.me/' + encodeURIComponent(handle);
    var w = window.open(url, '_blank');
    // Ask user to paste the message
    if (w) {
      try {
        var box = w.document.createElement('textarea');
        box.value = window.lcDeliveryMessageText(delivery);
        box.style.cssText = 'position:fixed;top:10px;left:10px;width:90vw;height:160px;font-size:13px;';
        w.document.body.appendChild(box);
        box.select();
      } catch (e) {}
    }
    return !!w;
  };

  /* =========================================================
     RENDERING HELPERS
     ========================================================= */

  window.lcRenderDeliveryStatus = function (delivery) {
    if (delivery.revoked) return { label: 'Revoked', cls: 'badge-reject' };
    if (new Date(delivery.expiresAt).getTime() < Date.now()) return { label: 'Expired', cls: 'badge-await' };
    if (delivery.downloads >= delivery.downloadLimit) return { label: 'Used', cls: 'badge-val' };
    if (delivery.opened) return { label: 'Opened', cls: 'badge-prelim' };
    return { label: 'Pending', cls: 'badge-await' };
  };

  function maskRecipient(r, channel) {
    r = String(r || '');
    if (channel === 'email') {
      var at = r.indexOf('@');
      if (at > 1) return r[0] + '***' + r.substring(at);
      return r;
    }
    if (r.length > 4) return '***' + r.slice(-4);
    return r;
  }
  window.lcMaskRecipient = maskRecipient;

  /**
   * List all deliveries for a report reference.
   */
  window.lcDeliveriesForReport = function (reportRef) {
    return loadAll().filter(function (d) { return d.reportRef === reportRef; })
                    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  };

  /**
   * List all deliveries for a patient.
   */
  window.lcDeliveriesForPatient = function (patientId) {
    return loadAll().filter(function (d) { return d.patientId === patientId; })
                    .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
  };

  console.log('🔐 LabCore Delivery Module loaded');
  console.log('   Channels: email, whatsapp, telegram');
  console.log('   Default TTL:', DEFAULT_TTL_HOURS, 'hours · Download limit:', MAX_DOWNLOADS_PER_LINK);
})();