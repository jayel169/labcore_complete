// shared/labcore-ward.js
// LabCore Ward / Admission / Triage Engine
// Provides: ward catalogue, triage levels, admission CRUD, vitals, MAR
(function () {
  'use strict';

  if (window.__lcWardLoaded) return;
  window.__lcWardLoaded = true;

  /* =========================================================
     CONSTANTS
  ========================================================= */
  var WARDS = [
    { id: 'male-med',    name: 'Male Medical Ward',   beds: 24, type: 'Medical' },
    { id: 'female-med',  name: 'Female Medical Ward', beds: 24, type: 'Medical' },
    { id: 'male-surg',   name: 'Male Surgical Ward',  beds: 18, type: 'Surgical' },
    { id: 'female-surg', name: 'Female Surgical Ward',beds: 18, type: 'Surgical' },
    { id: 'paeds',       name: 'Paediatric Ward',     beds: 20, type: 'Paediatric' },
    { id: 'obs',         name: 'Obstetric Ward',      beds: 16, type: 'Obstetric' },
    { id: 'icu',         name: 'Intensive Care Unit', beds: 8,  type: 'Critical' },
    { id: 'hdu',         name: 'High Dependency Unit',beds: 6,  type: 'Critical' },
    { id: 'theatre',     name: 'Theatre / Recovery',  beds: 4,  type: 'Surgical' },
    { id: 'day-case',    name: 'Day Case Unit',       beds: 6,  type: 'Outpatient' },
    { id: 'isolation',   name: 'Isolation Ward',      beds: 6,  type: 'Infectious' }
  ];

  var TRIAGE_LEVELS = [
    { level: 1, label: 'Resuscitation',   color: '#b74b43', maxWait: 'Immediate' },
    { level: 2, label: 'Emergent',        color: '#e67e22', maxWait: '10 min' },
    { level: 3, label: 'Urgent',          color: '#b08a2e', maxWait: '30 min' },
    { level: 4, label: 'Less Urgent',     color: '#2d7a46', maxWait: '60 min' },
    { level: 5, label: 'Non-Urgent',      color: '#7a8791', maxWait: '120 min' }
  ];

  var LOCATION_TYPES = [
    { id: 'OPD',       label: 'OPD (Outpatient)',    requiresAdmission: false },
    { id: 'Emergency', label: 'Emergency',           requiresAdmission: false, requiresTriage: true },
    { id: 'Ward',      label: 'Ward (Inpatient)',    requiresAdmission: true  },
    { id: 'ICU',       label: 'ICU',                 requiresAdmission: true  },
    { id: 'HDU',       label: 'HDU',                 requiresAdmission: true  },
    { id: 'Theatre',   label: 'Theatre',             requiresAdmission: true  },
    { id: 'DayCase',   label: 'Day Case',            requiresAdmission: true, shortStay: true },
    { id: 'Review',    label: 'Review / Follow-up',  requiresAdmission: false }
  ];

  window.lcWardCatalogue = {
    wards: WARDS,
    triageLevels: TRIAGE_LEVELS,
    locationTypes: LOCATION_TYPES
  };

  /* =========================================================
     STORAGE HELPERS
  ========================================================= */
  function loadPatients() {
    try { return JSON.parse(localStorage.getItem('hms_patients_v3') || '[]'); }
    catch (e) { return []; }
  }
  function savePatients(list) {
    try { localStorage.setItem('hms_patients_v3', JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }
  function findPatient(patients, patientId) {
    return patients.find(function (p) { return p.id === patientId; });
  }

  /* =========================================================
     ADMISSION CRUD
  ========================================================= */
  window.lcAdmit = function (patientId, opts) {
    opts = opts || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };

    if (p.admission && p.admission.status === 'Admitted') {
      return { ok: false, error: 'already_admitted', admissionId: p.admission.admissionId };
    }

    var now = new Date();
    var dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
    var seq = String(Math.floor(Math.random() * 9000) + 1000);
    var admissionId = 'ADM-' + dateKey + '-' + seq;

    var user = (window.lcGetUser && window.lcGetUser()) || null;

    p.admission = {
      admissionId: admissionId,
      admittedAt: now.toISOString(),
      admittedBy: (user && user.name) || opts.admittedBy || 'Unknown',
      admittedByRole: (user && user.id) || 'unknown',
      ward: opts.ward || '',
      wardId: opts.wardId || '',
      bed: opts.bed || '',
      locationType: opts.locationType || 'Ward',
      triageLevel: opts.triageLevel || null,
      triageNote: opts.triageNote || '',
      triageVitals: opts.triageVitals || null,
      admissionDiagnosis: opts.diagnosis || '',
      expectedStay: opts.expectedStay || '',
      attendingDoctor: opts.attendingDoctor || '',
      primaryNurse: opts.primaryNurse || '',
      status: 'Admitted',
      dischargedAt: null,
      dischargedBy: null,
      dischargeDiagnosis: null,
      dischargeSummary: null,
      encounters: [],       // daily ward round encounters
      vitals: [],           // nurse-charted vitals
      medications: [],      // MAR
      nursingNotes: [],     // free-text nursing notes
      fluidBalance: []      // intake/output
    };

    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('admission.created', {
        entity: 'patient',
        entityId: p.id,
        patientId: p.id,
        patientName: p.fullName,
        note: 'Admitted to ' + (opts.ward || '—') + ' bed ' + (opts.bed || '—') +
              (opts.triageLevel ? ' · Triage ' + opts.triageLevel : '')
      });
    }

    return { ok: true, admissionId: admissionId, admission: p.admission };
  };

  window.lcDischarge = function (patientId, opts) {
    opts = opts || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission || p.admission.status !== 'Admitted') {
      return { ok: false, error: 'not_admitted' };
    }

    var user = (window.lcGetUser && window.lcGetUser()) || null;
    p.admission.status = 'Discharged';
    p.admission.dischargedAt = new Date().toISOString();
    p.admission.dischargedBy = (user && user.name) || 'Unknown';
    p.admission.dischargeDiagnosis = opts.diagnosis || '';
    p.admission.dischargeSummary = opts.summary || '';
    p.admission.dischargeMedications = opts.medications || '';
    p.admission.followUpDate = opts.followUpDate || null;
    p.admission.followUpNotes = opts.followUpNotes || '';

    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('admission.discharged', {
        entity: 'patient',
        entityId: p.id,
        patientId: p.id,
        patientName: p.fullName,
        note: 'Discharged from ' + p.admission.ward +
              ' · ' + (opts.diagnosis || 'no diagnosis')
      });
    }

    return { ok: true };
  };

  window.lcTransferWard = function (patientId, newWard, newBed, reason) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission || p.admission.status !== 'Admitted') {
      return { ok: false, error: 'not_admitted' };
    }
    var user = (window.lcGetUser && window.lcGetUser()) || null;
    var fromWard = p.admission.ward;
    var fromBed = p.admission.bed;
    p.admission.ward = newWard;
    p.admission.bed = newBed;
    p.admission.transfers = p.admission.transfers || [];
    p.admission.transfers.push({
      at: new Date().toISOString(),
      by: (user && user.name) || 'Unknown',
      from: fromWard + ' / ' + fromBed,
      to: newWard + ' / ' + newBed,
      reason: reason || ''
    });
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('admission.transferred', {
        entity: 'patient',
        entityId: p.id,
        patientId: p.id,
        patientName: p.fullName,
        note: fromWard + '/' + fromBed + ' → ' + newWard + '/' + newBed +
              (reason ? ' · ' + reason : '')
      });
    }
    return { ok: true };
  };

  /* =========================================================
     WARD ROUND ENCOUNTERS
  ========================================================= */
  window.lcCreateWardRound = function (patientId, opts) {
    opts = opts || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission || p.admission.status !== 'Admitted') {
      return { ok: false, error: 'not_admitted' };
    }

    var now = new Date();
    var dateKey = now.toISOString().slice(0, 10).replace(/-/g, '');
    var seq = String(Math.floor(Math.random() * 9000) + 1000);
    var visitId = 'WR-' + dateKey + '-' + seq;

    var user = (window.lcGetUser && window.lcGetUser()) || null;
    var encounter = {
      visitId: visitId,
      type: 'Ward Round',
      date: now.toISOString().slice(0, 10),
      createdAt: now.toISOString(),
      consultant: (user && user.name) || opts.consultant || '',
      status: 'In Progress',
      chiefComplaint: opts.chiefComplaint || '',
      clinicalNotes: opts.clinicalNotes || { subjective: '', objective: '', assessment: '', plan: '' },
      orders: [],
      billing: []
    };
    p.admission.encounters.push(encounter);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('ward-round.started', {
        entity: 'admission',
        entityId: p.admission.admissionId,
        patientId: p.id,
        patientName: p.fullName,
        visitId: visitId,
        note: 'Ward round started'
      });
    }
    return { ok: true, visitId: visitId, encounter: encounter };
  };

  /* =========================================================
     VITALS
  ========================================================= */
  window.lcRecordVitals = function (patientId, vitals) {
    vitals = vitals || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission || p.admission.status !== 'Admitted') {
      return { ok: false, error: 'not_admitted' };
    }
    var user = (window.lcGetUser && window.lcGetUser()) || null;
    var entry = {
      at: new Date().toISOString(),
      by: (user && user.name) || 'Unknown',
      bpSys: Number(vitals.bpSys) || null,
      bpDia: Number(vitals.bpDia) || null,
      hr: Number(vitals.hr) || null,
      temp: Number(vitals.temp) || null,
      rr: Number(vitals.rr) || null,
      spo2: Number(vitals.spo2) || null,
      pain: Number(vitals.pain) || null,
      gcs: vitals.gcs || null,
      notes: vitals.notes || ''
    };
    p.admission.vitals.push(entry);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('vitals.recorded', {
        entity: 'admission',
        entityId: p.admission.admissionId,
        patientId: p.id,
        patientName: p.fullName,
        note: 'BP ' + (entry.bpSys || '—') + '/' + (entry.bpDia || '—') +
              ' · HR ' + (entry.hr || '—') +
              ' · T ' + (entry.temp || '—') +
              ' · SpO2 ' + (entry.spo2 || '—')
      });
    }
    return { ok: true, entry: entry };
  };

  /* =========================================================
     MEDICATIONS (MAR)
  ========================================================= */
  window.lcAddMedication = function (patientId, med) {
    med = med || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission || p.admission.status !== 'Admitted') {
      return { ok: false, error: 'not_admitted' };
    }

    var id = 'MED-' + Date.now().toString(36).toUpperCase();
    var scheduled = med.scheduled || [];
    var record = {
      id: id,
      drug: med.drug || '',
      dose: med.dose || '',
      route: med.route || 'Oral',
      frequency: med.frequency || '',
      scheduledTimes: scheduled,
      startDate: med.startDate || new Date().toISOString().slice(0, 10),
      endDate: med.endDate || null,
      prescribedBy: med.prescribedBy || '',
      prescribedAt: new Date().toISOString(),
      administered: [],   // { at, by, scheduledFor, note }
      status: 'Active'    // Active | Stopped | Completed
    };
    p.admission.medications.push(record);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('medication.prescribed', {
        entity: 'admission',
        entityId: p.admission.admissionId,
        patientId: p.id,
        patientName: p.fullName,
        note: record.drug + ' ' + record.dose + ' ' + record.frequency
      });
    }
    return { ok: true, id: id, record: record };
  };

  window.lcAdministerMedication = function (patientId, medId, opts) {
    opts = opts || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission) return { ok: false, error: 'not_admitted' };

    var med = p.admission.medications.find(function (m) { return m.id === medId; });
    if (!med) return { ok: false, error: 'med_not_found' };

    var user = (window.lcGetUser && window.lcGetUser()) || null;
    med.administered.push({
      at: new Date().toISOString(),
      by: (user && user.name) || 'Unknown',
      scheduledFor: opts.scheduledFor || null,
      note: opts.note || ''
    });
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('medication.administered', {
        entity: 'admission',
        entityId: p.admission.admissionId,
        patientId: p.id,
        patientName: p.fullName,
        note: med.drug + ' ' + med.dose + ' given'
      });
    }
    return { ok: true };
  };

  window.lcStopMedication = function (patientId, medId, reason) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission) return { ok: false };
    var med = p.admission.medications.find(function (m) { return m.id === medId; });
    if (!med) return { ok: false };
    med.status = 'Stopped';
    med.stoppedAt = new Date().toISOString();
    med.stopReason = reason || '';
    savePatients(patients);
    return { ok: true };
  };

  /* =========================================================
     NURSING NOTES
  ========================================================= */
  window.lcAddNursingNote = function (patientId, note) {
    note = note || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission) return { ok: false, error: 'not_admitted' };

    var user = (window.lcGetUser && window.lcGetUser()) || null;
    var entry = {
      at: new Date().toISOString(),
      by: (user && user.name) || 'Unknown',
      category: note.category || 'General',
      text: note.text || ''
    };
    p.admission.nursingNotes.push(entry);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('nursing-note.added', {
        entity: 'admission',
        entityId: p.admission.admissionId,
        patientId: p.id,
        patientName: p.fullName,
        note: entry.category + ': ' + entry.text.slice(0, 80)
      });
    }
    return { ok: true, entry: entry };
  };

  /* =========================================================
     FLUID BALANCE
  ========================================================= */
  window.lcRecordFluid = function (patientId, entry) {
    entry = entry || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission) return { ok: false };

    var user = (window.lcGetUser && window.lcGetUser()) || null;
    var rec = {
      at: new Date().toISOString(),
      by: (user && user.name) || 'Unknown',
      type: entry.type || 'Intake',      // Intake | Output
      amount: Number(entry.amount) || 0, // mL
      description: entry.description || ''
    };
    p.admission.fluidBalance.push(rec);
    savePatients(patients);
    return { ok: true, entry: rec };
  };

  /* =========================================================
     QUERIES
  ========================================================= */
  window.lcGetAdmittedPatients = function () {
    var patients = loadPatients();
    return patients.filter(function (p) {
      return p.admission && p.admission.status === 'Admitted';
    });
  };

  window.lcGetAdmissionsByWard = function (wardId) {
    return window.lcGetAdmittedPatients().filter(function (p) {
      return p.admission.wardId === wardId;
    });
  };

  window.lcGetWard = function (wardId) {
    return WARDS.find(function (w) { return w.id === wardId; }) || null;
  };

  window.lcGetTriageLevel = function (level) {
    return TRIAGE_LEVELS.find(function (t) { return t.level === Number(level); }) || null;
  };

  window.lcGetTriageCounts = function () {
    var counts = {};
    TRIAGE_LEVELS.forEach(function (t) { counts[t.level] = 0; });
    loadPatients().forEach(function (p) {
      // Count triage from OPEN Emergency encounters
      (p.encounters || []).forEach(function (e) {
        if (e.locationType === 'Emergency' && e.status !== 'Completed' && e.triageLevel) {
          counts[e.triageLevel] = (counts[e.triageLevel] || 0) + 1;
        }
      });
    });
    return counts;
  };

  /* =========================================================
     SBAR HANDOVER
  ========================================================= */
  window.lcSaveHandover = function (patientId, sbar) {
    sbar = sbar || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission) return { ok: false };

    var user = (window.lcGetUser && window.lcGetUser()) || null;
    p.admission.handovers = p.admission.handovers || [];
    p.admission.handovers.push({
      at: new Date().toISOString(),
      by: (user && user.name) || 'Unknown',
      situation: sbar.situation || '',
      background: sbar.background || '',
      assessment: sbar.assessment || '',
      recommendation: sbar.recommendation || ''
    });
    savePatients(patients);
    return { ok: true };
  };

  console.log('🏥 LabCore Ward / Admission Engine loaded');
  console.log('   Wards:', WARDS.length, '· Triage levels:', TRIAGE_LEVELS.length, '· Locations:', LOCATION_TYPES.length);
})();