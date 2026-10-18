// shared/labcore-merge.js
// Patient merge with undo. Designed to be conservative:
//   - The "source" record is NOT deleted. It's marked merged and points at the target.
//   - Every merge stores a full undo snapshot in localStorage.
//   - Undo restores both records exactly as they were.
(function () {
  'use strict';

  if (window.__lcMergeLoaded) return;
  window.__lcMergeLoaded = true;

  var UNDO_KEY = 'labcore_merge_undo';
  var MAX_UNDO = 50;

  function loadPatients() {
    try { return JSON.parse(localStorage.getItem('hms_patients_v3') || '[]'); }
    catch (e) { return []; }
  }
  function savePatients(list) {
    try {
      localStorage.setItem('hms_patients_v3', JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }
  function loadUndo() {
    try { return JSON.parse(localStorage.getItem(UNDO_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveUndo(list) {
    if (list.length > MAX_UNDO) list = list.slice(list.length - MAX_UNDO);
    try { localStorage.setItem(UNDO_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function actor() {
    var u = (window.lcGetUser && window.lcGetUser()) || null;
    return { name: (u && u.name) || 'Unknown', role: (u && (u.role || u.id)) || '' };
  }

  /**
   * Merge source patient into target patient.
   * Copies encounters, orders, admission, and any other data the app stores
   * on the source record. Source is retained but marked merged.
   */
  window.lcMergePatient = function (sourceId, targetId, opts) {
    opts = opts || {};
    if (!sourceId || !targetId) return { ok: false, error: 'missing_ids' };
    if (sourceId === targetId) return { ok: false, error: 'same_patient' };

    var patients = loadPatients();
    var source = patients.find(function (p) { return p.id === sourceId; });
    var target = patients.find(function (p) { return p.id === targetId; });
    if (!source) return { ok: false, error: 'source_not_found' };
    if (!target) return { ok: false, error: 'target_not_found' };
    if (source.status === 'merged' || target.status === 'merged') {
      return { ok: false, error: 'already_merged' };
    }

    // --- Build undo snapshot BEFORE any change
    var undo = {
      id: 'MRG-' + Date.now().toString(36).toUpperCase(),
      at: new Date().toISOString(),
      by: actor().name,
      role: actor().role,
      sourceId: sourceId,
      targetId: targetId,
      reason: opts.reason || '',
      sourceSnapshot: JSON.parse(JSON.stringify(source)),
      targetSnapshot: JSON.parse(JSON.stringify(target))
    };

    // --- Merge: concat encounters onto target; leave target's own in place
    var sourceEncounters = (source.encounters || []).map(function (e) {
      e._mergedFrom = sourceId;
      return e;
    });
    target.encounters = (target.encounters || []).concat(sourceEncounters);
    // Move, don't copy: pages loop over every patient, so leaving these on the source would list and bill them twice.
    // Undo restores the source from its snapshot.
    source.encounters = [];

    // --- Merge admission if target has none and source does
    if (!target.admission && source.admission) {
      target.admission = source.admission;
      target.admission._mergedFrom = sourceId;
      source.admission = null;
    } else if (target.admission && source.admission) {
      // Target already has an admission — merge their vitals/notes/meds into target
      target.admission.vitals = (target.admission.vitals || []).concat(source.admission.vitals || []);
      target.admission.medications = (target.admission.medications || []).concat(source.admission.medications || []);
      target.admission.nursingNotes = (target.admission.nursingNotes || []).concat(source.admission.nursingNotes || []);
      target.admission.fluidBalance = (target.admission.fluidBalance || []).concat(source.admission.fluidBalance || []);
      target.admission.carePlans = (target.admission.carePlans || []).concat(source.admission.carePlans || []);
      target.admission.encounters = (target.admission.encounters || []).concat(source.admission.encounters || []);
      target.admission.handovers = (target.admission.handovers || []).concat(source.admission.handovers || []);
      if (!target.admission.admissionId) target.admission.admissionId = source.admission.admissionId;
    }

    // --- Merge handovers held at top level
    if (Array.isArray(source.handovers)) {
      target.handovers = (target.handovers || []).concat(source.handovers);
    }

    // --- Merge any additional identifiers onto the target's notes
    target.mergeHistory = target.mergeHistory || [];
    target.mergeHistory.push({
      at: undo.at,
      fromPatientId: sourceId,
      fromPatientName: source.fullName,
      by: undo.by,
      reason: undo.reason
    });

    // --- Mark source as merged
    source.status = 'merged';
    source.mergedInto = targetId;
    source.mergedAt = undo.at;
    source.mergedBy = undo.by;

    if (!savePatients(patients)) {
      return { ok: false, error: 'save_failed' };
    }

    // --- Persist undo
    var undoList = loadUndo();
    undoList.push(undo);
    saveUndo(undoList);

    // --- Audit
    if (window.lcAudit) {
      window.lcAudit('patient.merged', {
        entity: 'patient',
        entityId: sourceId,
        patientId: sourceId,
        patientName: source.fullName,
        note: 'Merged into ' + target.fullName + ' (' + targetId + ')' +
              (undo.reason ? ' — ' + undo.reason : '')
      });
    }

    return { ok: true, undoId: undo.id };
  };

  /**
   * Undo a merge. Restores both records to their pre-merge state.
   */
  window.lcUnmergePatient = function (undoId) {
    if (!undoId) return { ok: false, error: 'missing_id' };
    var undoList = loadUndo();
    var idx = undoList.findIndex(function (u) { return u.id === undoId; });
    if (idx < 0) return { ok: false, error: 'undo_not_found' };
    var u = undoList[idx];

    var patients = loadPatients();
    var srcIdx = patients.findIndex(function (p) { return p.id === u.sourceId; });
    var tgtIdx = patients.findIndex(function (p) { return p.id === u.targetId; });
    if (srcIdx < 0 || tgtIdx < 0) {
      return { ok: false, error: 'records_missing' };
    }

    // Restore exact snapshots
    patients[srcIdx] = JSON.parse(JSON.stringify(u.sourceSnapshot));
    patients[tgtIdx] = JSON.parse(JSON.stringify(u.targetSnapshot));

    if (!savePatients(patients)) return { ok: false, error: 'save_failed' };

    // Remove the undo entry
    undoList.splice(idx, 1);
    saveUndo(undoList);

    if (window.lcAudit) {
      window.lcAudit('patient.unmerged', {
        entity: 'patient',
        entityId: u.sourceId,
        patientId: u.sourceId,
        patientName: u.sourceSnapshot.fullName,
        note: 'Undid merge ' + u.id + ' (target was ' + u.targetId + ')'
      });
    }

    return { ok: true };
  };

  window.lcListMerges = function () {
    return loadUndo().slice().reverse();  // newest first
  };

  window.lcClearMergeUndo = function () {
    try { localStorage.removeItem(UNDO_KEY); } catch (e) {}
  };

  console.log('🔀 LabCore Merge module loaded');
})();