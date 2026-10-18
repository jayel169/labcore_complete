// labcore-pricing.js - Centralized Pricing Configuration (PATCHED)
(function() {
    'use strict';

    // =========================================================
    // PRICE CONFIGURATION DATABASE
    // =========================================================

    const STORAGE_KEY = 'labcore_prices_v2';

    // Default prices
    const DEFAULT_PRICES = {
        services: {
            'OPD': { name: 'OPD Consultation', price: 30.00, code: 'SVC-OPD', category: 'consultation' },
            'ER': { name: 'Emergency Consultation', price: 50.00, code: 'SVC-ER', category: 'consultation' },
            'Consultation': { name: 'Specialist Consultation', price: 80.00, code: 'SVC-CONS', category: 'consultation' },
            'Review': { name: 'Review / Follow-up', price: 40.00, code: 'SVC-REV', category: 'consultation' },
            'Nursing': { name: 'Nursing Procedure', price: 25.00, code: 'SVC-NRS', category: 'consultation' },
            'Pharmacy': { name: 'Pharmacy Service', price: 15.00, code: 'SVC-PHARM', category: 'consultation' },
            'Radiology': { name: 'Radiology Service', price: 20.00, code: 'SVC-RAD', category: 'consultation' },
            'Laboratory': { name: 'Laboratory Service', price: 10.00, code: 'SVC-LAB', category: 'consultation' },
            'Other': { name: 'Other Service', price: 0.00, code: 'SVC-OTHER', category: 'consultation' }
        },
        labTests: {},
        imaging: {},
        pharmacy: {}
    };

    // =========================================================
    // PRICE STORAGE
    // =========================================================

    let priceData = null;

    // FIX #23 (part 1): always guarantee a non-null priceData object.
    function emptyPrices() {
        return {
            services: JSON.parse(JSON.stringify(DEFAULT_PRICES.services)),
            labTests: {},
            imaging: {},
            pharmacy: {}
        };
    }

    function loadPrices() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                priceData = mergePrices(DEFAULT_PRICES, parsed);
                return priceData;
            }
        } catch (e) {
            console.warn('Failed to load prices from localStorage:', e);
        }

        priceData = emptyPrices();
        savePrices();
        return priceData;
    }

    function mergePrices(defaults, custom) {
        const result = emptyPrices();
        // Start from defaults (deep copy of services, empty for the rest)
        if (defaults && defaults.services) {
            result.services = JSON.parse(JSON.stringify(defaults.services));
        }
        if (!custom || typeof custom !== 'object') return result;

        for (const category of ['services', 'labTests', 'imaging', 'pharmacy']) {
            if (custom[category] && typeof custom[category] === 'object') {
                for (const [key, value] of Object.entries(custom[category])) {
                    if (result[category] && result[category][key]) {
                        // Update existing — preserve name if it exists
                        result[category][key].price = Number(value.price) || 0;
                        if (value.code) result[category][key].code = value.code;
                        if (value.category) result[category][key].category = value.category;
                        if (value.name && !result[category][key].name) {
                            result[category][key].name = value.name;
                        }
                    } else {
                        // New item not in defaults
                        result[category][key] = {
                            price: Number(value.price) || 0,
                            code: value.code || key.toUpperCase().replace(/\s+/g, '-'),
                            category: value.category || 'General',
                            name: value.name || key
                        };
                    }
                }
            }
        }
        return result;
    }

    function savePrices() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(priceData));
            return true;
        } catch (e) {
            console.error('Failed to save prices:', e);
            return false;
        }
    }

    // FIX #23 (part 2): guarantee a non-null return even if storage is broken
    function reloadPrices() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                priceData = mergePrices(DEFAULT_PRICES, parsed);
            } else {
                priceData = emptyPrices();
            }
        } catch (e) {
            console.warn('Failed to reload prices:', e);
            priceData = emptyPrices();
        }
        return priceData;
    }

    // FIX #23 (part 3): safe accessor used by every public API
    function ensureLoaded() {
        if (!priceData || typeof priceData !== 'object') {
            reloadPrices();
        }
        // Also guard against a partially-shaped object
        if (!priceData.services) priceData.services = {};
        if (!priceData.labTests) priceData.labTests = {};
        if (!priceData.imaging) priceData.imaging = {};
        if (!priceData.pharmacy) priceData.pharmacy = {};
        return priceData;
    }

    // Initialize
    try { loadPrices(); } catch (e) { priceData = emptyPrices(); }

    // =========================================================
    // PUBLIC API
    // =========================================================

    window.lcGetServicePrice = function(serviceId) {
        ensureLoaded();
        return priceData.services[serviceId] || null;
    };

    window.lcGetAllServices = function() {
        ensureLoaded();
        return priceData.services;
    };

    window.lcGetLabTestPrice = function(testName, defaultPrice = 0) {
        ensureLoaded();
        if (!testName) return defaultPrice;
        if (priceData.labTests[testName]) return priceData.labTests[testName].price;
        const lowerName = String(testName).toLowerCase();
        for (const [key, value] of Object.entries(priceData.labTests)) {
            if (key.toLowerCase() === lowerName) return value.price;
        }
        return defaultPrice;
    };

    window.lcGetLabTestPriceObject = function(testName) {
        ensureLoaded();
        if (!testName) return null;
        const lowerName = String(testName).toLowerCase();
        for (const [key, value] of Object.entries(priceData.labTests)) {
            if (key.toLowerCase() === lowerName) return { ...value, name: key };
        }
        return null;
    };

    window.lcGetAllLabTests = function() {
        ensureLoaded();
        return priceData.labTests;
    };

    window.lcGetImagingPrice = function(testName, defaultPrice = 0) {
        ensureLoaded();
        if (!testName) return defaultPrice;
        const lowerName = String(testName).toLowerCase();
        for (const [key, value] of Object.entries(priceData.imaging)) {
            if (key.toLowerCase() === lowerName) return value.price;
        }
        return defaultPrice;
    };

    window.lcGetAllImaging = function() {
        ensureLoaded();
        return priceData.imaging;
    };

    window.lcGetPharmacyPrice = function(drugName, defaultPrice = 0) {
        ensureLoaded();
        if (!drugName) return defaultPrice;
        const lowerName = String(drugName).toLowerCase();
        for (const [key, value] of Object.entries(priceData.pharmacy)) {
            if (key.toLowerCase() === lowerName) return value.price;
        }
        return defaultPrice;
    };

    window.lcGetAllPharmacy = function() {
        ensureLoaded();
        return priceData.pharmacy;
    };

    window.lcGetConsultationCharge = function(serviceType) {
        ensureLoaded();
        const service = priceData.services[serviceType] || priceData.services['OPD'];
        return service ? service.price : 30.00;
    };

    window.lcUpdatePrice = function(category, key, newPrice) {
        ensureLoaded();
        if (priceData[category] && priceData[category][key]) {
            priceData[category][key].price = Number(newPrice) || 0;
            const saved = savePrices();
            if (saved) {
                console.log('💰 Price updated:', category, key, '→', newPrice);
                return true;
            }
            return false;
        }
        console.warn('Price not found:', category, key);
        return false;
    };

    window.lcAddPriceEntry = function(category, key, data) {
        ensureLoaded();
        if (!key) return false;
        if (!priceData[category]) priceData[category] = {};
        const d = data || {};
        priceData[category][key] = {
            price: Number(d.price) || 0,
            code: d.code || String(key).toUpperCase().replace(/\s+/g, '-'),
            category: d.category || 'General',
            name: d.name || key
        };
        savePrices();
        console.log('💰 Price added:', category, key, '→', priceData[category][key].price);
        return true;
    };

    window.lcRemovePriceEntry = function(category, key) {
        ensureLoaded();
        if (priceData[category] && priceData[category][key]) {
            delete priceData[category][key];
            savePrices();
            console.log('💰 Price removed:', category, key);
            return true;
        }
        return false;
    };

    window.lcResetPrices = function() {
        priceData = emptyPrices();
        savePrices();
        console.log('💰 Prices reset to defaults');
        return true;
    };

    window.lcExportPrices = function() {
        ensureLoaded();
        return JSON.stringify(priceData, null, 2);
    };

    window.lcImportPrices = function(jsonData) {
        try {
            const data = JSON.parse(jsonData);
            priceData = mergePrices(DEFAULT_PRICES, data);
            savePrices();
            console.log('💰 Prices imported successfully');
            return true;
        } catch (e) {
            console.error('Failed to import prices:', e);
            return false;
        }
    };

    window.lcReloadPrices = function() {
        reloadPrices();
        console.log('💰 Prices reloaded from localStorage');
        return priceData;
    };

    window.lcGetPrice = function(category, key) {
        ensureLoaded();
        if (priceData[category] && priceData[category][key]) {
            return priceData[category][key];
        }
        return null;
    };

    // FIX #23 (final): null-safe trailing log so a broken state never
    // throws at module load time.
    console.log('💰 LabCore Pricing Module loaded with',
        priceData && priceData.labTests ? Object.keys(priceData.labTests).length : 0, 'lab tests,',
        priceData && priceData.services ? Object.keys(priceData.services).length : 0, 'services,',
        priceData && priceData.imaging ? Object.keys(priceData.imaging).length : 0, 'imaging tests,',
        priceData && priceData.pharmacy ? Object.keys(priceData.pharmacy).length : 0, 'pharmacy items'
    );
})();