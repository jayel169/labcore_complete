// shared/labcore-nursing.js
// LabCore Nursing Engine — vitals history, care plans, MAR wrappers,
// fluid balance, nursing notes, SBAR handover, nursing diagnosis library.
// Backing store: hms_patients_v3 (per-patient admission / encounter structures).
(function () {
  'use strict';

  if (window.__lcNursingLoaded) return;
  window.__lcNursingLoaded = true;

  /* =========================================================
     NURSING DIAGNOSIS LIBRARY
  ========================================================= */
  var NURSING_DIAGNOSES = [
    {
      id: 'nd-acute-pain',
      label: 'Acute Pain',
      relatedTo: 'tissue injury, inflammation, or procedural intervention',
      interventions: [
        'Assess pain using 0–10 numeric rating scale every 4 hours',
        'Administer prescribed analgesia and evaluate response within 60 minutes',
        'Position for comfort; provide quiet environment',
        'Document pain score before and after intervention'
      ]
    },
    {
      id: 'nd-hyperthermia',
      label: 'Hyperthermia',
      relatedTo: 'infectious process or inflammatory response',
      interventions: [
        'Monitor temperature every 4 hours',
        'Apply tepid sponging if temperature > 38.5°C',
        'Administer prescribed antipyretic and re-check in 30 minutes',
        'Encourage oral fluids; monitor intake and output'
      ]
    },
    {
      id: 'nd-risk-infection',
      label: 'Risk for Infection',
      relatedTo: 'compromised immune status, invasive lines, or wound',
      interventions: [
        'Perform hand hygiene before and after every patient contact',
        'Monitor temperature, WBC, and wound site for signs of infection',
        'Maintain aseptic technique for all invasive procedures',
        'Educate patient and family on infection prevention'
      ]
    },
    {
      id: 'nd-deficit-volume',
      label: 'Deficient Fluid Volume',
      relatedTo: 'vomiting, diarrhoea, fever, or reduced oral intake',
      interventions: [
        'Maintain strict intake and output charting',
        'Assess skin turgor, mucous membranes, and capillary refill every shift',
        'Monitor vital signs including orthostatic BP',
        'Administer prescribed IV fluids and monitor for overload'
      ]
    },
    {
      id: 'nd-impaired-mobility',
      label: 'Impaired Physical Mobility',
      relatedTo: 'pain, weakness, or musculoskeletal restriction',
      interventions: [
        'Turn and reposition every 2 hours; use pressure-relieving mattress',
        'Perform passive range-of-motion exercises to affected limbs',
        'Assist with ambulation as tolerated; use gait belt',
        'Assess skin integrity each shift for pressure injury'
      ]
    },
    {
      id: 'nd-fall-risk',
      label: 'Risk for Falls',
      relatedTo: 'altered mobility, sedation, or environmental hazard',
      interventions: [
        'Keep bed in lowest position; raise side rails as appropriate',
        'Ensure call bell is within reach at all times',
        'Assist with toileting every 2 hours',
        'Use non-slip footwear; keep floor dry and clutter-free'
      ]
    },
    {
      id: 'nd-impaired-skin',
      label: 'Impaired Skin Integrity',
      relatedTo: 'pressure, moisture, or immobility',
      interventions: [
        'Assess skin and wound daily; document wound stage and size',
        'Change dressing as prescribed using aseptic technique',
        'Offload pressure with repositioning schedule',
        'Maintain nutrition and hydration to support healing'
      ]
    },
    {
      id: 'nd-ineffective-airway',
      label: 'Ineffective Airway Clearance',
      relatedTo: 'retained secretions, cough suppression, or obstruction',
      interventions: [
        'Auscultate lung fields every 4 hours',
        'Encourage deep breathing and coughing exercises every 2 hours',
        'Perform chest physiotherapy / suction as indicated',
        'Monitor SpO2 and respiratory rate continuously'
      ]
    },
    {
      id: 'nd-activity-intolerance',
      label: 'Activity Intolerance',
      relatedTo: 'imbalance between oxygen supply and demand',
      interventions: [
        'Assess tolerance during activity; monitor HR, BP, SpO2',
        'Cluster nursing care to allow rest periods',
        'Gradually increase activity as tolerated',
        'Stop activity if HR > 120, SpO2 < 90%, or symptomatic'
      ]
    },
    {
      id: 'nd-anxiety',
      label: 'Anxiety',
      relatedTo: 'situational crisis, unfamiliar environment, or fear',
      interventions: [
        'Assess level of anxiety and identify triggers',
        'Provide clear, honest information about care plan',
        'Use therapeutic communication; allow expression of feelings',
        'Teach relaxation techniques (slow breathing, guided imagery)'
      ]
    }
  ];
  window.lcNursingDiagnoses = NURSING_DIAGNOSES;

  /* =========================================================
     PATIENT STORE HELPERS
  ========================================================= */
  function loadPatients() {
    try { return JSON.parse(localStorage.getItem('hms_patients_v3') || '[]'); }
    catch (e) { return []; }
  }
  function savePatients(list) {
    try { localStorage.setItem('hms_patients_v3', JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }
  function findPatient(list, id) {
    return list.find(function (p) { return p.id === id; });
  }
  function currentUserName() {
    if (window.lcCurrentUserName) return window.lcCurrentUserName();
    var u = window.lcGetUser && window.lcGetUser();
    return (u && u.name) || 'Nurse';
  }

  /**
   * Resolve the backing container for a patient + optional visitId.
   * Prefers admission if patient is admitted. Falls back to encounter.
   */
  function resolveContainer(patient, visitId) {
    if (!patient) return null;
    if (patient.admission && patient.admission.status === 'Admitted') {
      return { type: 'admission', node: patient.admission };
    }
    if (visitId) {
      var enc = (patient.encounters || []).find(function (e) { return e.visitId === visitId; });
      if (enc) return { type: 'encounter', node: enc };
    }
    return null;
  }

  /* =========================================================
     VITALS
  ========================================================= */
  window.lcGetVitalsHistory = function (patientId, visitId) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return [];
    var c = resolveContainer(p, visitId);
    if (!c) return [];
    return (c.node.vitals || []).slice();
  };

  /**
   * Record vitals. Delegates to lcRecordVitals when possible (admitted),
   * otherwise writes to the encounter for OPD/ER visits.
   */
  window.lcRecordVitalsExt = function (patientId, visitId, vitals) {
    vitals = vitals || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };

    // Admitted path: use the ward engine so admission.vitals stays canonical
    if (p.admission && p.admission.status === 'Admitted' && typeof window.lcRecordVitals === 'function') {
      return window.lcRecordVitals(patientId, vitals);
    }

    // Non-admitted path: write to encounter.vitals
    var c = resolveContainer(p, visitId);
    if (!c) return { ok: false, error: 'no_container' };

    c.node.vitals = c.node.vitals || [];
    var entry = {
      at: new Date().toISOString(),
      by: currentUserName(),
      bpSys: Number(vitals.bpSys) || null,
      bpDia: Number(vitals.bpDia) || null,
      hr: Number(vitals.hr) || null,
      temp: Number(vitals.temp) || null,
      rr: Number(vitals.rr) || null,
      spo2: Number(vitals.spo2) || null,
      pain: Number(vitals.pain) || null,
      weightKg: Number(vitals.weightKg) || null,
      notes: vitals.notes || ''
    };
    c.node.vitals.push(entry);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('vitals.recorded', {
        entity: c.type,
        entityId: c.node.visitId || p.admission?.admissionId || p.id,
        patientId: p.id,
        patientName: p.fullName,
        visitId: c.node.visitId || null,
        note: 'BP ' + (entry.bpSys || '—') + '/' + (entry.bpDia || '—') +
              ' · HR ' + (entry.hr || '—') +
              ' · T ' + (entry.temp || '—') +
              ' · SpO2 ' + (entry.spo2 || '—')
      });
    }
    return { ok: true, entry: entry };
  };

  /* =========================================================
     CARE PLANS
  ========================================================= */
  function ensureCarePlans(node) {
    node.carePlans = node.carePlans || [];
    return node.carePlans;
  }

  window.lcGetCarePlans = function (patientId, visitId) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return [];
    var c = resolveContainer(p, visitId);
    if (!c) return [];
    return (c.node.carePlans || []).slice();
  };

  window.lcAddCarePlan = function (patientId, visitId, plan) {
    plan = plan || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };
    var c = resolveContainer(p, visitId);
    if (!c) return { ok: false, error: 'no_container' };

    var list = ensureCarePlans(c.node);
    var record = {
      id: 'CP-' + Date.now().toString(36).toUpperCase(),
      diagnosisId: plan.diagnosisId || '',
      diagnosis: plan.diagnosis || '',
      relatedTo: plan.relatedTo || '',
      goal: plan.goal || '',
      interventions: Array.isArray(plan.interventions) ? plan.interventions.slice() : [],
      status: 'Active',
      createdAt: new Date().toISOString(),
      createdBy: currentUserName(),
      evaluations: [],
      resolvedAt: null,
      resolvedBy: null,
      resolvedReason: ''
    };
    list.push(record);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('care-plan.created', {
        entity: c.type,
        entityId: c.node.visitId || p.admission?.admissionId || p.id,
        patientId: p.id,
        patientName: p.fullName,
        visitId: c.node.visitId || null,
        note: record.diagnosis
      });
    }
    return { ok: true, id: record.id, record: record };
  };

  window.lcEvaluateCarePlan = function (patientId, planId, text) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };

    var c = resolveContainer(p, null);
    if (!c) {
      // search admissions + encounters for the plan
      c = { type: 'search', node: null };
    }

    var found = null;
    var containers = [];
    if (p.admission) containers.push(p.admission);
    (p.encounters || []).forEach(function (e) { containers.push(e); });

    for (var i = 0; i < containers.length; i++) {
      var plans = containers[i].carePlans || [];
      found = plans.find(function (pl) { return pl.id === planId; });
      if (found) { c.node = containers[i]; break; }
    }
    if (!found) return { ok: false, error: 'plan_not_found' };

    found.evaluations = found.evaluations || [];
    found.evaluations.push({
      at: new Date().toISOString(),
      by: currentUserName(),
      text: text || ''
    });
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('care-plan.evaluated', {
        entity: 'care-plan',
        entityId: planId,
        patientId: p.id,
        patientName: p.fullName,
        note: text || ''
      });
    }
    return { ok: true };
  };

  window.lcResolveCarePlan = function (patientId, planId, reason) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false };

    var containers = [];
    if (p.admission) containers.push(p.admission);
    (p.encounters || []).forEach(function (e) { containers.push(e); });

    var found = null;
    for (var i = 0; i < containers.length; i++) {
      var plans = containers[i].carePlans || [];
      found = plans.find(function (pl) { return pl.id === planId; });
      if (found) break;
    }
    if (!found) return { ok: false };

    found.status = 'Resolved';
    found.resolvedAt = new Date().toISOString();
    found.resolvedBy = currentUserName();
    found.resolvedReason = reason || '';
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('care-plan.resolved', {
        entity: 'care-plan',
        entityId: planId,
        patientId: p.id,
        patientName: p.fullName,
        note: reason || ''
      });
    }
    return { ok: true };
  };

  /* =========================================================
     MAR WRAPPERS (delegate to ward engine when admitted)
  ========================================================= */
  window.lcNurseAdministerMed = function (patientId, medId, opts) {
    if (typeof window.lcAdministerMedication === 'function') {
      return window.lcAdministerMedication(patientId, medId, opts);
    }
    return { ok: false, error: 'med_engine_missing' };
  };

  /* =========================================================
     FLUID BALANCE
  ========================================================= */
  window.lcRecordFluidBalance = function (patientId, entry) {
    entry = entry || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };

    var c = resolveContainer(p, null);
    if (!c) return { ok: false, error: 'no_container' };

    c.node.fluidBalance = c.node.fluidBalance || [];
    var rec = {
      at: new Date().toISOString(),
      by: currentUserName(),
      type: entry.type === 'Output' ? 'Output' : 'Intake',
      amount: Number(entry.amount) || 0,
      description: entry.description || ''
    };
    c.node.fluidBalance.push(rec);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('fluid.recorded', {
        entity: 'admission',
        entityId: c.node.admissionId || c.node.visitId || p.id,
        patientId: p.id,
        patientName: p.fullName,
        note: rec.type + ' ' + rec.amount + ' mL · ' + rec.description
      });
    }
    return { ok: true, entry: rec };
  };

  window.lcFluidBalanceSummary = function (patientId, sinceIso) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return null;
    var c = resolveContainer(p, null);
    if (!c) return null;

    var list = (c.node.fluidBalance || []).filter(function (e) {
      if (!sinceIso) return true;
      return new Date(e.at).getTime() >= new Date(sinceIso).getTime();
    });

    var intake = 0, output = 0;
    list.forEach(function (e) {
      if (e.type === 'Intake') intake += Number(e.amount) || 0;
      else output += Number(e.amount) || 0;
    });
    return { intake: intake, output: output, balance: intake - output, entries: list };
  };

  /* =========================================================
     NURSING NOTES  — 3-arg signature to match nursing-station.html
  ========================================================= */
  window.lcGetNursingNotes = function (patientId, visitId) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return [];
    var c = resolveContainer(p, visitId);
    if (!c) return [];
    return (c.node.nursingNotes || []).slice();
  };

  window.lcAddNursingNote = function (patientId, visitId, note) {
    // Support both 2-arg (patientId, note) and 3-arg (patientId, visitId, note)
    if (note == null && visitId && typeof visitId === 'object') {
      note = visitId;
      visitId = null;
    }
    note = note || {};

    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };

    var c = resolveContainer(p, visitId);
    if (!c) return { ok: false, error: 'no_container' };

    c.node.nursingNotes = c.node.nursingNotes || [];
    var entry = {
      at: new Date().toISOString(),
      by: currentUserName(),
      category: note.category || 'General',
      text: note.text || ''
    };
    c.node.nursingNotes.push(entry);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('nursing-note.added', {
        entity: c.type,
        entityId: c.node.visitId || p.admission?.admissionId || p.id,
        patientId: p.id,
        patientName: p.fullName,
        visitId: c.node.visitId || null,
        note: entry.category + ': ' + (entry.text || '').slice(0, 80)
      });
    }
    return { ok: true, entry: entry };
  };

  /* =========================================================
     SBAR HANDOVER
  ========================================================= */
  window.lcGetSBARs = function (patientId) {
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p || !p.admission) return [];
    return (p.admission.handovers || []).slice().reverse();
  };

  window.lcSaveSBAR = function (patientId, sbar) {
    sbar = sbar || {};
    var patients = loadPatients();
    var p = findPatient(patients, patientId);
    if (!p) return { ok: false, error: 'patient_not_found' };

    // Prefer admission handovers; fall back to a nursingNotes-adjacent store
    var store = null;
    if (p.admission && p.admission.status === 'Admitted') {
      p.admission.handovers = p.admission.handovers || [];
      store = p.admission.handovers;
    } else {
      p.handovers = p.handovers || [];
      store = p.handovers;
    }

    var record = {
      at: new Date().toISOString(),
      by: currentUserName(),
      situation: sbar.situation || '',
      background: sbar.background || '',
      assessment: sbar.assessment || '',
      recommendation: sbar.recommendation || ''
    };
    store.push(record);
    savePatients(patients);

    if (window.lcAudit) {
      window.lcAudit('handover.saved', {
        entity: 'patient',
        entityId: p.id,
        patientId: p.id,
        patientName: p.fullName,
        note: 'SBAR handover recorded'
      });
    }
    return { ok: true, record: record };
  };

  console.log('🩺 LabCore Nursing engine loaded —',
    NURSING_DIAGNOSES.length, 'diagnoses ·',
    'vitals · care plans · MAR · fluids · notes · SBAR');
})();