// shared/labcore-utils.js
// LabCore Shared Utilities - Version 1.0

(function() {
    'use strict';

    // ---------- HTML ESCAPE ----------
    window.lcEsc = function(str) {
        return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    };

    // ---------- ID GENERATION ----------
    window.lcGenerateId = function(prefix = "ID") {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 4);
        return prefix + "-" + timestamp + "-" + random;
    };

    // ---------- AGE CALCULATION ----------
    window.lcAgeFromDob = function(dob) {
        if (!dob) return null;
        const birth = new Date(dob);
        if (isNaN(birth.getTime())) return null;
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age;
    };

    window.lcAgeDisplay = function(dob) {
        const age = window.lcAgeFromDob(dob);
        return age !== null ? age + " yrs" : "—";
    };

    // ---------- DATE FORMATTING ----------
    window.lcFormatDate = function(dateStr) {
        if (!dateStr) return "—";
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString("en-US", { 
            year: "numeric", month: "short", day: "numeric" 
        });
    };

    window.lcFormatDateTime = function(dateStr) {
        if (!dateStr) return "—";
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString("en-US", { 
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
    };

    // ---------- CURRENCY FORMATTING ----------
    window.lcFormatMoney = function(amount, currency = "GHS") {
        return currency + " " + Number(amount).toFixed(2);
    };

    // ---------- STATUS BADGE ----------
    window.lcStatusBadge = function(status, type = "default") {
        const map = {
            "Waiting": "lc-badge-warning",
            "In Progress": "lc-badge-info",
            "Completed": "lc-badge-success",
            "Validated": "lc-badge-success",
            "Pending": "lc-badge-warning",
            "Awaiting Specimen": "lc-badge-warning",
            "Specimen Received": "lc-badge-info",
            "Preliminary": "lc-badge-prelim",
            "Awaiting Validation": "lc-badge-val",
            "Rejected": "lc-badge-danger",
            "Cancelled": "lc-badge-danger",
            "default": "lc-badge-secondary"
        };
        const cls = map[status] || map.default;
        return `<span class="lc-badge ${cls}">${window.lcEsc(status)}</span>`;
    };

    // ---------- DEBOUNCE ----------
    window.lcDebounce = function(func, wait = 300) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    };

    // ---------- THROTTLE ----------
    window.lcThrottle = function(func, limit = 300) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    };

    // ---------- DEEP CLONE ----------
    window.lcDeepClone = function(obj) {
        return JSON.parse(JSON.stringify(obj));
    };

    // ---------- GENERATE SPECIMEN ID ----------
    window.lcGenerateSpecimenId = function() {
        let counter = Number(localStorage.getItem("hms_specimen_counter") || "100");
        counter++;
        localStorage.setItem("hms_specimen_counter", String(counter));
        const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const n = String(counter).padStart(4, "0");
        return "SP-" + d + "-" + n;
    };

    // ---------- GENERATE PATIENT ID ----------
    window.lcGeneratePatientId = function(patients) {
        const maxNum = patients.reduce((max, p) => {
            const num = parseInt(p.id.replace("PT-", ""), 10);
            return num > max ? num : max;
        }, 123);
        return "PT-" + String(maxNum + 1).padStart(6, "0");
    };

    // ---------- GENERATE ENCOUNTER ID ----------
    window.lcGenerateEncounterId = function() {
        const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
        const seq = String(Math.floor(Math.random() * 9000) + 1000);
        return "ENC-" + d + "-" + seq;
    };

    // ---------- FUZZY SEARCH (simple implementation) ----------
    window.lcFuzzySearch = function(query, items, keys = []) {
        if (!query || query.length < 2) return items;
        const q = query.toLowerCase().trim();
        const results = items.map(item => {
            let score = 0;
            let matchedFields = [];
            const searchTexts = keys.length ? keys.map(k => String(item[k] || "").toLowerCase()) : [String(item).toLowerCase()];
            searchTexts.forEach(text => {
                if (text.includes(q)) {
                    score += 10;
                    matchedFields.push(text);
                }
                // Partial word match
                const words = text.split(/\s+/);
                words.forEach(word => {
                    if (word.startsWith(q)) score += 5;
                    else if (word.includes(q)) score += 3;
                });
            });
            return { item, score };
        });
        return results.filter(r => r.score > 0).sort((a, b) => b.score - a.score).map(r => r.item);
    };

    // ---------- LOADING SPINNER ----------
    window.lcShowLoading = function(containerId, message = "Loading...") {
        const container = document.getElementById(containerId);
        if (!container) return;
        const overlay = document.createElement('div');
        overlay.className = 'lc-loading-overlay';
        overlay.id = 'lc-loading-' + containerId;
        overlay.innerHTML = `
            <div class="lc-loading-spinner"></div>
            <div class="lc-loading-text">${window.lcEsc(message)}</div>
        `;
        container.style.position = 'relative';
        container.appendChild(overlay);
    };

    window.lcHideLoading = function(containerId) {
        const overlay = document.getElementById('lc-loading-' + containerId);
        if (overlay) overlay.remove();
    };

    // ---------- TOAST SYSTEM ----------
    const toastContainer = document.createElement('div');
    toastContainer.className = 'lc-toast-container';
    toastContainer.id = 'lc-toast-container';
    document.addEventListener('DOMContentLoaded', function() {
        if (!document.getElementById('lc-toast-container')) {
            document.body.appendChild(toastContainer);
        }
    });

    window.lcToast = function(message, type = 'info', duration = 4000) {
        const container = document.getElementById('lc-toast-container') || toastContainer;
        if (!container.parentNode) document.body.appendChild(container);
        
        const toast = document.createElement('div');
        toast.className = `lc-toast lc-toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('lc-toast-hide');
            setTimeout(() => toast.remove(), 400);
        }, duration);
    };

    // ---------- LOAD SHARED DATA ----------
    window.lcLoadPatients = function() {
        try {
            return JSON.parse(localStorage.getItem("hms_patients_v3") || "[]");
        } catch (e) {
            return [];
        }
    };

    window.lcSavePatients = function(patients) {
        localStorage.setItem("hms_patients_v3", JSON.stringify(patients));
    };

    window.lcLoadPanels = function() {
        try {
            const panels = JSON.parse(localStorage.getItem("labcore_panels") || "null");
            if (Array.isArray(panels) && panels.length) return panels;
            return JSON.parse(localStorage.getItem("lc_panels") || "[]");
        } catch (e) {
            return [];
        }
    };

    window.lcLoadRanges = function() {
        try {
            return JSON.parse(localStorage.getItem("labcore_reference_ranges") || "null") || {};
        } catch (e) {
            return {};
        }
    };

    window.lcLoadUnits = function() {
        try {
            return JSON.parse(localStorage.getItem("labcore_units") || "[]");
        } catch (e) {
            return [];
        }
    };

    window.lcLoadLabOrders = function() {
        try {
            return JSON.parse(localStorage.getItem("hms_lab_orders") || "[]");
        } catch (e) {
            return [];
        }
    };

    window.lcSaveLabOrders = function(orders) {
        localStorage.setItem("hms_lab_orders", JSON.stringify(orders));
    };

    console.log('🔬 LabCore Utils loaded');
})();