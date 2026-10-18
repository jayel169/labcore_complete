// shared/labcore-api.js
// Adapter between the LIS frontend and the LabCore backend.
// Load this BEFORE labcore-auth.js and labcore-utils.js.
(function () {
  'use strict';

  // The frontend and API are served from the same origin by the local server.
  // For a separate frontend deployment, set window.__LABCORE_API_BASE__ before this script loads.
  window.LABCORE_API_BASE = window.LABCORE_API_BASE || window.__LABCORE_API_BASE__ || window.location.origin + '/api';

  /* ---------- TOKEN ---------- */
  window.lcGetToken   = function () { return localStorage.getItem('labcore_token'); };
  window.lcSetToken   = function (t) { localStorage.setItem('labcore_token', t); };
  window.lcClearToken = function () { localStorage.removeItem('labcore_token'); };

  /* ---------- STORE USER AFTER LOGIN ---------- */
  window.lcStoreUserFromLogin = function (apiUser) {
    var payload = {
      role: apiUser.role,
      name: apiUser.name,
      id: apiUser.id,
      staffId: apiUser.id,
      employeeId: apiUser.employeeId,
      department: apiUser.department,
      wardIds: apiUser.wardIds || [],
      loggedInAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString()
    };
    localStorage.setItem('labcore_current_user', JSON.stringify(payload));
  };

  /* ---------- FETCH WRAPPER ---------- */
  window.lcApiFetch = async function (path, opts) {
    opts = opts || {};
    var token = window.lcGetToken();
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      opts.headers || {}
    );
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var res;
    try {
      res = await fetch(window.LABCORE_API_BASE + path, Object.assign({}, opts, { headers: headers }));
    } catch (netErr) {
      var e = new Error('Cannot reach backend at ' + window.LABCORE_API_BASE);
      e.status = 0;
      e.data = { error: 'network' };
      throw e;
    }

    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }

    if (!res.ok) {
      if (res.status === 403 && data && data.error === 'security_setup_required') {
        window.lcClearToken();
        localStorage.removeItem('labcore_current_user');
        if (!/\/login\.html$/i.test(window.location.pathname)) window.location.href = 'login.html';
      }
      var err = new Error((data && (data.message || data.error)) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  window.lcApiPublicFetch = async function (path, opts) {
    opts = opts || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var response;
    try {
      response = await fetch(window.LABCORE_API_BASE + path,
        Object.assign({}, opts, { headers: headers, credentials: 'omit' }));
    } catch (networkError) {
      var error = new Error('Cannot reach backend at ' + window.LABCORE_API_BASE);
      error.status = 0;
      error.data = { error: 'network' };
      throw error;
    }
    var text = await response.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (parseError) { data = { raw: text }; }
    if (!response.ok) {
      var requestError = new Error((data && (data.message || data.error)) || ('HTTP ' + response.status));
      requestError.status = response.status;
      requestError.data = data;
      throw requestError;
    }
    return data;
  };

  window.lcApiGetPublicDelivery = function (id) {
    return window.lcApiPublicFetch('/deliveries/public/' + encodeURIComponent(id));
  };

  window.lcApiVerifyPublicDelivery = function (id, pin) {
    return window.lcApiPublicFetch('/deliveries/public/' + encodeURIComponent(id) + '/verify', {
      method: 'POST', body: JSON.stringify({ pin: pin })
    });
  };

  window.lcApiCreateDelivery = function (delivery) {
    return window.lcApiFetch('/deliveries', { method: 'POST', body: JSON.stringify(delivery) });
  };

  /* ---------- LOGIN ---------- */
  window.lcApiLogin = async function (email, password, totp) {
    var data = await window.lcApiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email, password: password, totp: totp || '' })
    });
    if (data && data.token) {
      window.lcSetToken(data.token);
      window.lcStoreUserFromLogin(data.user);
    }
    return data;
  };

  window.lcApiCompleteSecuritySetup = async function (details) {
    var data = await window.lcApiFetch('/auth/security/setup', {
      method: 'POST',
      body: JSON.stringify(details)
    });
    if (data && data.token) {
      window.lcSetToken(data.token);
      window.lcStoreUserFromLogin(data.user);
    }
    return data;
  };

  window.lcApiChangePassword = async function (details) {
    return await window.lcApiFetch('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(details)
    });
  };

  window.lcApiGetCriticalAlerts = async function () {
    var data = await window.lcApiFetch('/critical-alerts');
    return Array.isArray(data) ? data : [];
  };

  window.lcApiGetCriticalClinicians = async function () {
    var data = await window.lcApiFetch('/critical-alerts/clinicians');
    return Array.isArray(data) ? data : [];
  };

  window.lcApiAssignCriticalAlert = async function (alertId, staffId) {
    return await window.lcApiFetch('/critical-alerts/' + encodeURIComponent(alertId) + '/assign', {
      method: 'POST', body: JSON.stringify({ staffId: staffId })
    });
  };

  window.lcApiContactCriticalClinician = async function (alertId, method, note) {
    return await window.lcApiFetch('/critical-alerts/' + encodeURIComponent(alertId) + '/contact', {
      method: 'POST', body: JSON.stringify({ method: method, note: note })
    });
  };

  window.lcApiAcknowledgeCriticalAlert = async function (alertId, note) {
    return await window.lcApiFetch('/critical-alerts/' + encodeURIComponent(alertId) + '/acknowledge', {
      method: 'POST', body: JSON.stringify({ note: note || '' })
    });
  };

  window.lcApiGetTurnaround = async function () {
    return await window.lcApiFetch('/turnaround');
  };

  window.lcApiSetTurnaroundTarget = async function (panel, targetHours) {
    return await window.lcApiFetch('/turnaround/targets/' + encodeURIComponent(panel), {
      method: 'PUT', body: JSON.stringify({ targetHours: targetHours })
    });
  };

  /* ---------- LOGOUT ---------- */
  window.lcApiLogout = async function () {
    try {
      await window.lcApiFetch('/auth/logout', { method: 'POST' });
      return true;
    } finally {
      window.lcClearToken();
      localStorage.removeItem('labcore_current_user');
    }
  };

  /* ---------- HEALTH ---------- */
  window.lcApiHealth = async function () {
    try {
      var h = await window.lcApiFetch('/health');
      return h && h.ok;
    } catch (e) { return false; }
  };
  /* =========================================================
     PATIENT API — used by patient-registration.html
  ========================================================= */

  /** Fetch all patients from the server. Returns an array. */
  window.lcApiGetPatients = async function () {
    var data = await window.lcApiFetch('/patients');
    return Array.isArray(data) ? data : [];
  };

  /** Fetch a single patient by ID. Returns the object or null. */
  window.lcApiGetPatient = async function (id) {
    if (!id) return null;
    try {
      return await window.lcApiFetch('/patients/' + encodeURIComponent(id));
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  };

  /**
   * Save one patient (create or update). Takes the full patient object
   * as stored in localStorage — server extracts the structured fields
   * and keeps the whole JSON blob in data_json for forward compatibility.
   */
  window.lcApiSavePatient = async function (patient) {
    if (!patient || !patient.id) throw new Error('patient.id is required');
    return await window.lcApiFetch('/patients', {
      method: 'POST',
      body: JSON.stringify(patient)
    });
  };

  /**
   * Save many patients at once (bulk). Useful for the initial migration
   * of whatever is currently in localStorage.
   */
  window.lcApiSavePatients = async function (list) {
    if (!Array.isArray(list)) throw new Error('Expected an array');
    if (!list.length) return { ok: true, count: 0 };
    return await window.lcApiFetch('/patients', {
      method: 'POST',
      body: JSON.stringify({ patients: list })
    });
  };

  window.lcApiUpdateOrder = function (visitId, orderId, order) {
    return window.lcApiFetch('/encounters/' + encodeURIComponent(visitId) +
      '/orders/' + encodeURIComponent(orderId), {
        method: 'PUT',
        body: JSON.stringify(order)
      });
  };

  window.lcApiRegisterOrderSpecimens = function (visitId, orders) {
    return window.lcApiFetch('/encounters/' + encodeURIComponent(visitId) + '/specimens', {
      method: 'PUT',
      body: JSON.stringify({ orders: orders })
    });
  };

  window.lcApiGetStaff = function () {
    return window.lcApiFetch('/staff');
  };

  window.lcApiGetStaffDirectory = function () {
    return window.lcApiFetch('/staff/directory');
  };

  window.lcApiGetAppointments = function (opts) {
    opts = opts || {};
    var qs = Object.keys(opts).filter(function (key) {
      return opts[key] !== undefined && opts[key] !== null && opts[key] !== '';
    }).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(opts[key]);
    }).join('&');
    return window.lcApiFetch('/appointments' + (qs ? '?' + qs : ''));
  };

  window.lcApiCreateAppointment = function (appointment) {
    return window.lcApiFetch('/appointments', {
      method: 'POST', body: JSON.stringify(appointment)
    });
  };

  window.lcApiUpdateAppointment = function (id, appointment) {
    return window.lcApiFetch('/appointments/' + encodeURIComponent(id), {
      method: 'PUT', body: JSON.stringify(appointment)
    });
  };

  window.lcApiSetAppointmentStatus = function (id, status) {
    return window.lcApiFetch('/appointments/' + encodeURIComponent(id) + '/status', {
      method: 'PATCH', body: JSON.stringify({ status: status })
    });
  };

  window.lcApiCreateStaff = function (staff) {
    return window.lcApiFetch('/staff', { method: 'POST', body: JSON.stringify(staff) });
  };

  window.lcApiUpdateStaff = function (id, staff) {
    return window.lcApiFetch('/staff/' + encodeURIComponent(id), {
      method: 'PUT', body: JSON.stringify(staff)
    });
  };

  window.lcApiResetStaffPin = function (id, newPin) {
    return window.lcApiFetch('/staff/' + encodeURIComponent(id) + '/reset-pin', {
      method: 'POST', body: JSON.stringify({ newPin: newPin })
    });
  };

  window.lcApiSetStaffStatus = function (id, enabled, reason) {
    return window.lcApiFetch('/staff/' + encodeURIComponent(id) + (enabled ? '/enable' : '/disable'), {
      method: 'POST', body: JSON.stringify({ reason: reason || '' })
    });
  };

  window.lcApiDeleteStaff = function (id) {
    return window.lcApiFetch('/staff/' + encodeURIComponent(id), { method: 'DELETE' });
  };

  window.lcApiRecordPayment = function (payment) {
    return window.lcApiFetch('/billing/payments', {
      method: 'POST',
      body: JSON.stringify(payment)
    });
  };

  window.lcApiCreateBankTransfer = function (transfer) {
    return window.lcApiFetch('/billing/payments/bank-transfer', {
      method: 'POST',
      body: JSON.stringify(transfer)
    });
  };

  window.lcApiGetPendingPayments = function () {
    return window.lcApiFetch('/billing/payments?status=pending');
  };

  window.lcApiReconcilePayment = function (paymentId, action, note) {
    return window.lcApiFetch('/billing/payments/' + encodeURIComponent(paymentId) + '/reconcile', {
      method: 'POST',
      body: JSON.stringify({ action: action, note: note || '' })
    });
  };

  window.lcApiStartPaystack = function (checkout) {
    return window.lcApiFetch('/billing/paystack/initialize', {
      method: 'POST',
      body: JSON.stringify(checkout)
    });
  };

  window.lcApiVerifyPaystack = function (reference) {
    return window.lcApiFetch('/billing/paystack/verify', {
      method: 'POST',
      body: JSON.stringify({ reference: reference })
    });
  };

  window.lcApiGetInsuranceClaims = function () {
    return window.lcApiFetch('/billing/claims');
  };

  window.lcApiSubmitInsuranceClaim = function (claim) {
    return window.lcApiFetch('/billing/claims', {
      method: 'POST',
      body: JSON.stringify(claim)
    });
  };

  window.lcApiUpdateInsuranceClaim = function (claimId, status, note) {
    return window.lcApiFetch('/billing/claims/' + encodeURIComponent(claimId), {
      method: 'PATCH',
      body: JSON.stringify({ status: status, note: note || '' })
    });
  };

  window.lcApiSaveReceipt = function (receipt) {
    return window.lcApiFetch('/receipts', {
      method: 'POST',
      body: JSON.stringify(receipt)
    });
  };

  window.lcApiGetReceipts = async function () {
    var data = await window.lcApiFetch('/receipts');
    return Array.isArray(data) ? data : [];
  };

  /** Soft-delete a patient (marks status='deleted' on the server). */
  window.lcApiDeletePatient = async function (id) {
    if (!id) return false;
    try {
      await window.lcApiFetch('/patients/' + encodeURIComponent(id), { method: 'DELETE' });
      return true;
    } catch (e) {
      return false;
    }
  };

  /** True when the adapter can reach the backend. */
  window.lcApiReady = function () {
    return !!(window.lcGetToken && window.lcGetToken());
  };
    /* =========================================================
     AUDIT API
  ========================================================= */

  /**
   * Push one audit event to the server.
   * Fire-and-forget — we never block the UI on audit writes.
   * The server side fetches the current user from the JWT.
   */
  window.lcApiAudit = function (event, payload) {
    if (!window.lcApiFetch || !window.lcGetToken || !window.lcGetToken()) return;
    payload = payload || {};
    // Don't crash the page if the network is slow — just log.
    window.lcApiFetch('/audit', {
      method: 'POST',
      body: JSON.stringify({
        event: event,
        entity: payload.entity || '',
        entityId: payload.entityId || '',
        patientId: payload.patientId || '',
        patientName: payload.patientName || '',
        visitId: payload.visitId || '',
        specimenId: payload.specimenId || '',
        panel: payload.panel || '',
        test: payload.test || '',
        department: payload.department || '',
        before: payload.before || null,
        after: payload.after || null,
        note: payload.note || '',
        durationMs: payload.durationMs || null
      })
    }).catch(function (e) {
      console.warn('[audit] server write failed:', e.message);
    });
  };

  /**
   * Fetch audit events from the server.
   * @param {object} opts  { from, to, by, event, q, limit }
   * @returns {Promise<Array>}
   */
  window.lcApiGetAudit = async function (opts) {
    opts = opts || {};
    var qs = [];
    if (opts.from)  qs.push('from=' + encodeURIComponent(opts.from));
    if (opts.to)    qs.push('to=' + encodeURIComponent(opts.to));
    if (opts.by)    qs.push('by=' + encodeURIComponent(opts.by));
    if (opts.event) qs.push('event=' + encodeURIComponent(opts.event));
    if (opts.q)     qs.push('q=' + encodeURIComponent(opts.q));
    if (opts.limit) qs.push('limit=' + encodeURIComponent(opts.limit));
    var path = '/audit' + (qs.length ? '?' + qs.join('&') : '');
    var data = await window.lcApiFetch(path);
    return Array.isArray(data) ? data : [];
  };

  /** Fetch the list of distinct users who have audit events. */
  window.lcApiGetAuditUsers = async function () {
    var data = await window.lcApiFetch('/audit/users');
    return Array.isArray(data) ? data : [];
  };

    /* =========================================================
     SPECIMEN API
  ========================================================= */

  /** Fetch all specimens from the server. Returns an array. */
  window.lcApiGetSpecimens = async function () {
    var data = await window.lcApiFetch('/specimens');
    return Array.isArray(data) ? data : [];
  };

  /** Save one specimen (create or update). */
  window.lcApiSaveSpecimen = async function (specimen) {
    if (!specimen || !specimen.specimenId) throw new Error('specimenId is required');
    return await window.lcApiFetch('/specimens', {
      method: 'POST',
      body: JSON.stringify(specimen)
    });
  };

  /** Save many specimens at once. */
  window.lcApiSaveSpecimens = async function (list) {
    if (!Array.isArray(list)) throw new Error('Expected an array');
    if (!list.length) return { ok: true, count: 0 };
    return await window.lcApiFetch('/specimens', {
      method: 'POST',
      body: JSON.stringify(list)
    });
  };

  /** Mark a specimen's label as printed on the server. */
  window.lcApiMarkSpecimenPrinted = async function (specimenId) {
    if (!specimenId) return false;
    try {
      await window.lcApiFetch('/specimens/' + encodeURIComponent(specimenId) + '/mark-printed', {
        method: 'POST'
      });
      return true;
    } catch (e) {
      console.warn('[specimen] mark-printed failed:', e.message);
      return false;
    }
  };

  window.lcApiGetSpecimenEvents = async function (specimenId) {
    return await window.lcApiFetch('/specimens/' + encodeURIComponent(specimenId) + '/events');
  };

  window.lcApiAddSpecimenEvent = async function (specimenId, event) {
    return await window.lcApiFetch('/specimens/' + encodeURIComponent(specimenId) + '/events', {
      method: 'POST',
      body: JSON.stringify(event)
    });
  };

  window.lcApiGetQcControls = async function () {
    var data = await window.lcApiFetch('/qc/controls');
    return Array.isArray(data) ? data : [];
  };

  window.lcApiCreateQcControl = async function (control) {
    return await window.lcApiFetch('/qc/controls', {
      method: 'POST',
      body: JSON.stringify(control)
    });
  };

  window.lcApiDeactivateQcControl = async function (controlId) {
    return await window.lcApiFetch('/qc/controls/' + encodeURIComponent(controlId) + '/deactivate', {
      method: 'PATCH'
    });
  };

  window.lcApiGetQcRuns = async function () {
    var data = await window.lcApiFetch('/qc/runs');
    return Array.isArray(data) ? data : [];
  };

  window.lcApiRecordQcRun = async function (run) {
    return await window.lcApiFetch('/qc/runs', {
      method: 'POST',
      body: JSON.stringify(run)
    });
  };
    /* =========================================================
     ENCOUNTER & ORDER API
  ========================================================= */

  /** All encounters (with orders) for one patient. */
  window.lcApiGetEncounters = async function (patientId) {
    if (!patientId) return [];
    var data = await window.lcApiFetch('/encounters/patient/' + encodeURIComponent(patientId));
    return Array.isArray(data) ? data : [];
  };

  /** One encounter (with orders) by visitId. Returns null if missing. */
  window.lcApiGetEncounter = async function (visitId) {
    if (!visitId) return null;
    try {
      return await window.lcApiFetch('/encounters/' + encodeURIComponent(visitId));
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  };

  /**
   * Search orders across all encounters.
   * @param {object} opts  { type, resultStatus, status, from, to, limit }
   * @returns {Promise<Array>}
   */
  window.lcApiSearchOrders = async function (opts) {
    opts = opts || {};
    var qs = [];
    if (opts.type)         qs.push('type=' + encodeURIComponent(opts.type));
    if (opts.resultStatus) qs.push('resultStatus=' + encodeURIComponent(opts.resultStatus));
    if (opts.status)       qs.push('status=' + encodeURIComponent(opts.status));
    if (opts.from)         qs.push('from=' + encodeURIComponent(opts.from));
    if (opts.to)           qs.push('to=' + encodeURIComponent(opts.to));
    if (opts.limit)        qs.push('limit=' + encodeURIComponent(opts.limit));
    var path = '/encounters' + (qs.length ? '?' + qs.join('&') : '');
    var data = await window.lcApiFetch(path);
    return Array.isArray(data) ? data : [];
  };

  /** Convenience: all Laboratory orders. */
  window.lcApiGetLabOrders = async function (limit) {
    return await window.lcApiSearchOrders({ type: 'Laboratory', limit: limit || 500 });
  };

    /* =========================================================
     CONFIG API — panels, reference ranges, units
  ========================================================= */

  /** All panels. */
  window.lcApiGetPanels = async function () {
    var data = await window.lcApiFetch('/config/panels');
    return Array.isArray(data) ? data : [];
  };

  /** Save one panel (id in the panel object). */
  window.lcApiSavePanel = async function (panel) {
    if (!panel || !panel.id) throw new Error('panel.id is required');
    return await window.lcApiFetch('/config/panels/' + encodeURIComponent(panel.id), {
      method: 'PUT',
      body: JSON.stringify(panel)
    });
  };

  /** Delete a panel. */
  window.lcApiDeletePanel = async function (panelId) {
    if (!panelId) return false;
    try {
      await window.lcApiFetch('/config/panels/' + encodeURIComponent(panelId), { method: 'DELETE' });
      return true;
    } catch (e) { return false; }
  };

  /** All reference ranges (map of panelId -> ranges object). */
  window.lcApiGetReferenceRanges = async function () {
    var data = await window.lcApiFetch('/config/reference-ranges');
    return (data && typeof data === 'object') ? data : {};
  };

  /** Save reference ranges for one panel (replaces the whole blob). */
  window.lcApiSaveReferenceRanges = async function (panelId, ranges) {
    if (!panelId) throw new Error('panelId required');
    return await window.lcApiFetch('/config/reference-ranges/' + encodeURIComponent(panelId), {
      method: 'PUT',
      body: JSON.stringify(ranges || {})
    });
  };

  /** All units. */
  window.lcApiGetUnits = async function () {
    var data = await window.lcApiFetch('/config/units');
    return Array.isArray(data) ? data : [];
  };

  /** Create or update a unit. */
  window.lcApiSaveUnit = async function (unit) {
    return await window.lcApiFetch('/config/units', {
      method: 'POST',
      body: JSON.stringify(unit)
    });
  };

  /** Delete a unit. */
  window.lcApiDeleteUnit = async function (unitId) {
    if (!unitId) return false;
    try {
      await window.lcApiFetch('/config/units/' + encodeURIComponent(unitId), { method: 'DELETE' });
      return true;
    } catch (e) { return false; }
  };
  console.log('🔌 LabCore API adapter loaded — backend:', window.LABCORE_API_BASE);
})();