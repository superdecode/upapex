// ==================== TRACK APP - JAVASCRIPT COMPLETO ====================
// Réplica exacta de la funcionalidad del archivo original track.html

// ==================== CONFIGURATION ====================
const CONFIG = {
    SOURCES: {
        BD_STOCK: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-HG8HPf-94Ki5Leo5iEF5pyqsiD9CVk-mcl-F8BAw34kT0s3nzNn532YTYDCtkG76NbauiVx0Ffmd/pub?output=csv',
        OBC_BD: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSdSDQ8ktYA3YAsWMUokYd_S6_rANUz8XdfEAjsV-v0eAlfiYZctHuj3hP4m3wOghf4rnT_YvuA4BPA/pub?output=csv',
        VALIDACION: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZMZZCDtTFCebvsme1GMEBiZ1S2Cloh37AR8hHFAwhFPNEMD27G04bzX0theCMJE-nlYOyH2ev115q/pub?output=csv',
        INVENTARIO: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTXzUcwU_ZzJtCQKF6IEXr8Mj-OXvrzkw361v2rVVbb2goPaRMLPm6EbfrhXzeJJfWnvox4PhdGyoxZ/pub?output=csv',
        MNE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRHzXpt4q7KYo8QMnrO92LGcXQbx14lBCQ0wxHGHm2Lz4v5RCJCpQHmS0NhUTHUCCG2Hc1bkvTYhdpz/pub?gid=883314398&single=true&output=csv',
        TRS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ2NOvCCzIW0IS9ANzOYl7GKBq5I-XQM9e_V1tu_2VrDMq4Frgjol5uj6-4dBgEQcfB8b-k6ovaOJGc/pub?output=csv',
        CANCELADO: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSGSl9NnEjrP_3P4iRDSCaE776r2vjzwKthMyavQ4C5DOnmzDuY90YjZjfkLPGouxhyca140srhKaFO/pub?output=csv',
        EMBARQUES: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbzg922y1KMVnV0JqBijR43Ma8e5X_AO2KVzjHBnRtGBx-0aXLZ8UUlKCO_XHOpV1qfggQyNjtqde/pub?gid=0&single=true&output=csv',
        REPARACIONES: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSe-hbpLGtctz-xY2Tk-9j5p6sbxtCC8dE-84UF7Gc0x4P5uSgygqmPHunD0ZLYVV6RCyvBsHI18OL7/pub?gid=131145537&single=true&output=csv'
    },
    CACHE_DURATION: 30 * 60 * 1000, // 30 minutos
    MAX_RESULTS: 500
};

// ==================== STATE ====================
let DATA_CACHE = {
    bdStock: [],
    obcBd: [],
    validacion: [],
    inventario: [],
    mne: [],
    trs: [],
    cancelado: [],
    embarques: [],
    reparaciones: [],
    lastUpdate: null
};

let CURRENT_SEARCH = null;
let GLOBAL_SEARCH_MODE = 'exact'; // 'exact' or 'flexible'

// Background loading state
let BACKGROUND_LOADING = {
    active: false,
    startTime: null,
    totalSources: 0,
    completedSources: 0,
    completedNames: [],
    pendingNames: [],
    sourceTimes: [] // durations in ms per source for ETA calc
};

let SECTION_MODES = {
    bdStock: 'exact',
    obcBd: 'exact',
    validacion: 'exact',
    inventario: 'exact',
    mne: 'exact',
    trs: 'exact',
    cancelado: 'exact',
    embarques: 'exact',
    reparaciones: 'exact'
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadAllData();
    checkCacheExpiration();
});

function setupEventListeners() {
    const input = document.getElementById('search-input');
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Check cache every 5 minutes
    setInterval(checkCacheExpiration, 5 * 60 * 1000);
}

function checkCacheExpiration() {
    if (DATA_CACHE.lastUpdate) {
        const elapsed = Date.now() - DATA_CACHE.lastUpdate;
        if (elapsed > CONFIG.CACHE_DURATION) {
            document.getElementById('reload-banner').classList.add('show');
        }
    }
}

function forceReloadData() {
    document.getElementById('reload-banner').classList.remove('show');
    loadAllData();
}

// ==================== DATA LOADING ====================
async function loadAllData() {
    showLoading(true);

    // OPTIMIZACIÓN: Cargar solo bases críticas primero
    const criticalSources = {
        OBC_BD: CONFIG.SOURCES.OBC_BD,
        VALIDACION: CONFIG.SOURCES.VALIDACION,
        REPARACIONES: CONFIG.SOURCES.REPARACIONES
    };

    const secondarySources = {
        BD_STOCK: CONFIG.SOURCES.BD_STOCK,
        INVENTARIO: CONFIG.SOURCES.INVENTARIO,
        MNE: CONFIG.SOURCES.MNE,
        TRS: CONFIG.SOURCES.TRS,
        CANCELADO: CONFIG.SOURCES.CANCELADO,
        EMBARQUES: CONFIG.SOURCES.EMBARQUES
    };

    let completed = 0;
    const totalSources = Object.keys(criticalSources).length + Object.keys(secondarySources).length;
    updateLoadingProgress(0, totalSources);

    try {
        console.log('⚡ FASE 1: Cargando bases críticas (OBC_BD, VALIDACION, REPARACIONES)...');

        // FASE 1: Cargar bases críticas
        const criticalResults = await Promise.allSettled(
            Object.entries(criticalSources).map(async ([key, url]) => {
                const data = await fetchCSV(url, key);
                completed++;
                updateLoadingProgress(completed, totalSources);
                return { key, data };
            })
        );

        criticalResults.forEach(result => {
            if (result.status === 'fulfilled') {
                const { key, data } = result.value;
                const mappedKey = {
                    OBC_BD: 'obcBd',
                    VALIDACION: 'validacion',
                    REPARACIONES: 'reparaciones'
                }[key];
                DATA_CACHE[mappedKey] = data;
            }
        });

        console.log('✅ FASE 1 completa - App lista para búsquedas');
        showNotification('✅ Bases críticas cargadas - App lista', 'success');
        showLoading(false);

        // FASE 2: Cargar bases secundarias en background
        console.log('📦 FASE 2: Cargando bases secundarias en segundo plano...');

        const secondaryKeys = Object.keys(secondarySources);
        BACKGROUND_LOADING = {
            active: true,
            startTime: Date.now(),
            totalSources: secondaryKeys.length,
            completedSources: 0,
            completedNames: [],
            pendingNames: [...secondaryKeys],
            sourceTimes: []
        };

        setTimeout(async () => {
            const secondaryResults = await Promise.allSettled(
                Object.entries(secondarySources).map(async ([key, url]) => {
                    const sourceStart = Date.now();
                    const data = await fetchCSV(url, key);
                    const sourceTime = Date.now() - sourceStart;
                    BACKGROUND_LOADING.sourceTimes.push(sourceTime);
                    BACKGROUND_LOADING.completedSources++;
                    BACKGROUND_LOADING.completedNames.push(key);
                    BACKGROUND_LOADING.pendingNames = BACKGROUND_LOADING.pendingNames.filter(k => k !== key);
                    completed++;
                    updateLoadingProgress(completed, totalSources);
                    return { key, data };
                })
            );

            secondaryResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    const { key, data } = result.value;
                    const mappedKey = {
                        BD_STOCK: 'bdStock',
                        INVENTARIO: 'inventario',
                        MNE: 'mne',
                        TRS: 'trs',
                        CANCELADO: 'cancelado',
                        EMBARQUES: 'embarques'
                    }[key];
                    DATA_CACHE[mappedKey] = data;
                }
            });

            BACKGROUND_LOADING.active = false;
            DATA_CACHE.lastUpdate = Date.now();
            saveToCache();
            console.log('✅ FASE 2 completa - Todas las bases cargadas');
            showNotification('✅ Todas las bases de datos cargadas', 'success', 2000);
        }, 1000); // Esperar 1 segundo después de la carga crítica

    } catch (e) {
        console.error('Error loading data:', e);
        showNotification('❌ Error al cargar algunas bases de datos', 'error');
        loadFromCache();
        showLoading(false);
    }
}

function updateLoadingProgress(completed, total) {
    const percent = (completed / total) * 100;
    document.getElementById('progress-fill').style.width = `${percent}%`;
    document.getElementById('loading-progress').textContent = `${completed}/${total} completadas`;
}

async function fetchCSV(url, sourceName = '') {
    const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache'
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csv = await response.text();
    return parseCSV(csv, sourceName);
}

function parseCSV(csv, sourceName = '') {
    const startTime = performance.now();
    const lines = csv.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];

    const headers = parseCSVLine(lines[0]);
    const data = [];

    // CARGA COMPLETA: Sin límite de filas para garantizar búsqueda total
    const totalLines = lines.length - 1;
    console.log(`📊 [${sourceName}] Procesando ${totalLines.toLocaleString()} registros (carga completa)`);

    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > 0) {
            const row = {};
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            // Store raw values array for index-based access
            row._values = values;
            data.push(row);
        }
    }

    const endTime = performance.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    if (sourceName) {
        console.log(`✅ [${sourceName}] Procesado: ${data.length.toLocaleString()} registros en ${duration}s`);
    }

    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

function saveToCache() {
    let sizeInMB = '?';
    try {
        const dataToSave = JSON.stringify(DATA_CACHE);
        sizeInMB = (new Blob([dataToSave]).size / (1024 * 1024)).toFixed(2);
        console.log(`💾 Intentando guardar cache: ${sizeInMB}MB`);

        localStorage.setItem('box_query_cache', dataToSave);
        console.log(`✅ Cache guardado: ${sizeInMB}MB`);
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            console.warn(`⚠️ Cache demasiado grande (${sizeInMB}MB) para LocalStorage`);
            localStorage.removeItem('box_query_cache');
            console.log('🧹 Cache limpiado - Los datos permanecen en memoria y se recargarán al refrescar');
        } else {
            console.error('Error saving to cache:', e);
        }
    }
}

function loadFromCache() {
    try {
        const cached = localStorage.getItem('box_query_cache');
        if (cached) {
            const parsed = JSON.parse(cached);
            if (parsed.lastUpdate && Date.now() - parsed.lastUpdate < CONFIG.CACHE_DURATION) {
                DATA_CACHE = parsed;
                showNotification('ℹ️ Usando datos en caché', 'info');
                return true;
            }
        }
    } catch (e) {
        console.error('Error loading from cache:', e);
    }
    return false;
}

// ==================== SEARCH ====================
function getBackgroundETA() {
    const bg = BACKGROUND_LOADING;
    if (!bg.active || bg.completedSources === 0) {
        // No data yet to estimate - use a default
        return { seconds: 30, pending: bg.pendingNames };
    }
    const avgTimePerSource = bg.sourceTimes.reduce((a, b) => a + b, 0) / bg.sourceTimes.length;
    const remaining = bg.totalSources - bg.completedSources;
    const etaMs = avgTimePerSource * remaining;
    return { seconds: Math.max(1, Math.ceil(etaMs / 1000)), pending: bg.pendingNames };
}

function performSearch() {
    const input = document.getElementById('search-input');
    const query = normalizeCode(input.value.trim());

    if (!query) {
        showNotification('⚠️ Ingresa un código o número de orden', 'warning');
        return;
    }

    // Check if background loading is still active
    if (BACKGROUND_LOADING.active) {
        const eta = getBackgroundETA();
        const pendingList = eta.pending.map(k => {
            const names = { BD_STOCK: 'BD Stock', INVENTARIO: 'Inventario', MNE: 'MNE', TRS: 'TRS', CANCELADO: 'Otros', EMBARQUES: 'Embarques' };
            return names[k] || k;
        }).join(', ');

        const userChoice = confirm(
            `⏳ Aún se están cargando bases de datos en segundo plano.\n\n` +
            `📊 Progreso: ${BACKGROUND_LOADING.completedSources}/${BACKGROUND_LOADING.totalSources} bases listas\n` +
            `⏱️ Tiempo estimado restante: ~${eta.seconds} segundos\n` +
            `📋 Pendientes: ${pendingList}\n\n` +
            `¿Deseas buscar ahora con los datos ya cargados?\n` +
            `(Los resultados pueden estar incompletos)\n\n` +
            `• Aceptar = Buscar ahora (datos parciales)\n` +
            `• Cancelar = Esperar a que terminen de cargar`
        );

        if (!userChoice) {
            showNotification(`⏳ Esperando carga... ~${eta.seconds}s restantes. Intenta de nuevo cuando termine.`, 'info', 5000);
            return;
        }
        showNotification('⚠️ Buscando con datos parciales - algunas bases aún cargan', 'warning', 4000);
    }

    // Show preloader and hide other elements
    showSearchPreloader(true);

    // Use setTimeout to allow the browser to render the preloader
    setTimeout(() => {
        try {
            CURRENT_SEARCH = query;
            const results = searchAllSources(query);
            displayResults(results, query);

            // Clear input after successful search
            input.value = '';

            // Show success notification
            const totalResults = Object.values(results.exact).reduce((sum, arr) => sum + arr.length, 0);
            if (totalResults > 0) {
                const partialWarning = BACKGROUND_LOADING.active ? ' (⚠️ datos parciales)' : '';
                showNotification(`✅ Búsqueda completada: ${totalResults} coincidencia${totalResults > 1 ? 's' : ''} encontrada${totalResults > 1 ? 's' : ''}${partialWarning}`, 'success');
            } else {
                const partialWarning = BACKGROUND_LOADING.active ? ' - Algunas bases aún cargan, intenta de nuevo en unos segundos' : '';
                showNotification(`ℹ️ No se encontraron resultados${partialWarning}`, 'info');
            }
        } catch (error) {
            console.error('Error during search:', error);
            showNotification('❌ Error al realizar la búsqueda', 'error');
        } finally {
            showSearchPreloader(false);
        }
    }, 100);
}

function showSearchPreloader(show) {
    const preloader = document.getElementById('search-preloader');
    const resultsContainer = document.getElementById('results-container');
    const emptyState = document.getElementById('empty-state');
    const searchBtn = document.getElementById('search-btn');

    if (show) {
        preloader.classList.add('show');
        resultsContainer.classList.remove('show');
        emptyState.style.display = 'none';
        searchBtn.disabled = true;
        searchBtn.style.opacity = '0.6';
    } else {
        preloader.classList.remove('show');
        searchBtn.disabled = false;
        searchBtn.style.opacity = '1';
    }
}

function toggleGlobalSearchMode() {
    const toggle = document.getElementById('global-mode-toggle');
    const statusEl = document.getElementById('global-mode-status');

    GLOBAL_SEARCH_MODE = toggle.checked ? 'flexible' : 'exact';

    if (GLOBAL_SEARCH_MODE === 'flexible') {
        statusEl.textContent = 'Exactas + Flexibles';
        statusEl.className = 'toggle-status flexible';
    } else {
        statusEl.textContent = 'Solo Exactas';
        statusEl.className = 'toggle-status exact';
    }

    // Reset all section modes to match global
    Object.keys(SECTION_MODES).forEach(key => {
        SECTION_MODES[key] = GLOBAL_SEARCH_MODE;
    });

    // Re-render if search is active
    if (CURRENT_SEARCH) {
        const results = searchAllSources(CURRENT_SEARCH);
        displayResults(results, CURRENT_SEARCH);
    }
}

function toggleSectionMode(sectionKey) {
    SECTION_MODES[sectionKey] = SECTION_MODES[sectionKey] === 'exact' ? 'flexible' : 'exact';

    if (CURRENT_SEARCH) {
        const results = searchAllSources(CURRENT_SEARCH);
        displayResults(results, CURRENT_SEARCH);
    }
}

function normalizeCode(raw) {
    let code = String(raw).replace(/\s+/g, '').trim().toUpperCase();

    // Extract from JSON patterns
    const patterns = [
        /\[id\[.*?\[([^\[]+)\[/i,
        /¨id¨.*?¨([^¨]+)¨/i,
        /"id"\s*:\s*"([^"]+)"/i
    ];

    for (const pattern of patterns) {
        const match = code.match(pattern);
        if (match) return match[1].replace(/\s+/g, '');
    }

    // Normalize different types of dashes/separators
    code = code.replace(/[—–‐‑‒―]+/g, '-');
    code = code.replace(/[-]{2,}/g, '-');

    return code.replace(/[^a-zA-Z0-9\-\/\']/g, '');
}

function generateCodeVariations(code) {
    const variations = new Set([code]);

    const separators = ['/', '-', '\''];

    separators.forEach(sep => {
        if (code.includes(sep)) {
            separators.forEach(newSep => {
                if (sep !== newSep) {
                    variations.add(code.replace(new RegExp('\\' + sep, 'g'), newSep));
                }
            });
        }
    });

    return Array.from(variations);
}

function getTruncatedCode(code) {
    if (/U\d{3,4}$/i.test(code)) {
        return code.replace(/U\d{3,4}$/i, '');
    }

    const separators = ['/', '-', '\''];
    for (const sep of separators) {
        const lastIndex = code.lastIndexOf(sep);
        if (lastIndex > 0) {
            return code.substring(0, lastIndex);
        }
    }

    return code;
}

function extractBaseCode(code) {
    if (/U\d{3,4}$/i.test(code)) {
        return code.replace(/U\d{3,4}$/i, '');
    }

    const separators = ['/', '-', '\''];
    for (const sep of separators) {
        const lastIndex = code.lastIndexOf(sep);
        if (lastIndex > 0) {
            return code.substring(0, lastIndex);
        }
    }

    return code;
}

function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 100;

    if (longer.includes(shorter)) {
        return (shorter.length / longer.length) * 100;
    }

    // Levenshtein distance
    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else if (j > 0) {
                let newValue = costs[j - 1];
                if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }

    return ((longer.length - costs[shorter.length]) / longer.length) * 100;
}

function searchAllSources(query) {
    const results = {
        exact: {
            bdStock: [],
            obcBd: [],
            validacion: [],
            inventario: [],
            mne: [],
            trs: [],
            cancelado: [],
            embarques: [],
            reparaciones: []
        },
        partial: {
            bdStock: [],
            obcBd: [],
            validacion: [],
            inventario: [],
            mne: [],
            trs: [],
            cancelado: [],
            embarques: [],
            reparaciones: []
        },
        query,
        baseCode: extractBaseCode(query),
        variations: generateCodeVariations(query),
        truncatedCode: getTruncatedCode(query)
    };

    // Search with similarity tracking - reverse for recent records first
    searchInSourceWithSimilarity(DATA_CACHE.bdStock.slice().reverse(), results, 'bdStock', [
        'Customize Barcode/自定义箱条码',
        'Box type No./箱类型号'
    ]);

    searchInSourceWithSimilarity(DATA_CACHE.obcBd.slice().reverse(), results, 'obcBd', [
        'Custom box barcode_自定义箱条码',
        'Outbound_出库单号',
        'Reference order No._参考单号'
    ]);

    searchInSourceWithSimilarity(DATA_CACHE.validacion.slice().reverse(), results, 'validacion', [
        'Codigo',
        'Orden'
    ]);

    // Search INVENTARIO - reverse for recent records first
    searchInventario(DATA_CACHE.inventario.slice().reverse(), results, 'inventario');

    // Search MNE - reverse for recent records first
    searchMNE(DATA_CACHE.mne.slice().reverse(), results, 'mne');

    // Special search for TRS - reverse for recent records first
    searchTRS(DATA_CACHE.trs.slice().reverse(), results, 'trs');

    // Search CANCELADO - reverse for recent records first
    searchCANCELADO(DATA_CACHE.cancelado.slice().reverse(), results, 'cancelado');

    // Search EMBARQUES - reverse for recent records first
    searchEMBARQUES(DATA_CACHE.embarques.slice().reverse(), results, 'embarques');

    // Search REPARACIONES - reverse for recent records first
    searchREPARACIONES(DATA_CACHE.reparaciones.slice().reverse(), results, 'reparaciones');

    return results;
}

function searchTRS(data, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    const searchIndices = [6, 13, 14]; // Índices para códigos de caja
    const trsNumberIndex = 0; // Índice para número de TRS

    const exactMatches = [];
    const baseCodeMatches = [];

    data.forEach(row => {
        if (!row._values || !row._values[0] || !row._values[0].toString().startsWith('TRS')) {
            return;
        }

        let matchType = null;

        // ========== BÚSQUEDA POR NÚMERO DE TRS (Índice 0) ==========
        const trsNumber = row._values[trsNumberIndex]?.toString().toUpperCase() || '';
        const queryUpper = query.toUpperCase();

        if (trsNumber === queryUpper || trsNumber.includes(queryUpper)) {
            matchType = 'exact';
        }

        // ========== BÚSQUEDA POR CÓDIGOS DE CAJA (Índices 6, 13, 14) ==========
        if (!matchType) {
            for (const idx of searchIndices) {
                const cellValue = row._values[idx] || '';
                if (!cellValue) continue;

                const cellUpper = cellValue.toString().toUpperCase();

                if (cellUpper === queryUpper || cellUpper.includes(queryUpper)) {
                    matchType = 'exact';
                    break;
                }

                const normalizedCell = normalizeCode(cellValue);
                if (normalizedCell === query || normalizedCell.includes(query)) {
                    matchType = 'exact';
                    break;
                }
            }
        }

        // ========== BÚSQUEDA FUZZY POR BASECODE ==========
        if (!matchType && baseCode && baseCode !== query) {
            for (const idx of searchIndices) {
                const cellValue = row._values[idx] || '';
                if (!cellValue) continue;

                const normalizedCell = normalizeCode(cellValue);
                const cellBaseCode = extractBaseCode(cellValue);

                if (cellBaseCode === baseCode || normalizedCell.includes(baseCode)) {
                    matchType = 'baseCode';
                    break;
                }
            }
        }

        if (matchType === 'exact') {
            exactMatches.push({ ...row, _matchType: 'exact', _similarity: 100 });
        } else if (matchType === 'baseCode') {
            baseCodeMatches.push({ ...row, _matchType: 'baseCode', _similarity: 90 });
        }
    });

    if (exactMatches.length > 0) {
        results.exact[sourceName].push(...exactMatches);
    } else if (baseCodeMatches.length > 0) {
        results.exact[sourceName].push(...baseCodeMatches);
    }
}

function searchMNE(data, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    const searchIndices = [3, 5];

    data.forEach(row => {
        if (!row._values || row._values.length < 6) return;

        const firstVal = row._values[0]?.toString() || '';
        if (!firstVal || firstVal.toLowerCase().includes('fecha')) return;

        let isMatch = false;

        for (const idx of searchIndices) {
            const cellValue = row._values[idx] || '';
            if (!cellValue) continue;

            const cellUpper = cellValue.toString().toUpperCase();
            const queryUpper = query.toUpperCase();

            if (cellUpper === queryUpper) {
                isMatch = true;
                break;
            }

            if (cellUpper.includes(queryUpper)) {
                isMatch = true;
                break;
            }

            if (baseCode) {
                const normalizedCell = normalizeCode(cellValue);
                if (normalizedCell.includes(baseCode)) {
                    isMatch = true;
                    break;
                }
            }
        }

        if (isMatch) {
            const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100 };
            results.exact[sourceName].push(enrichedRow);
        }
    });
}

function searchInventario(data, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    // Search in columns: SCAN 1 (index 3), SCAN 2 (index 4), PALLET (index 7)
    const searchIndices = [3, 4, 7];

    data.forEach(row => {
        if (!row._values || row._values.length < 5) return;

        const firstVal = row._values[0]?.toString() || '';
        if (!firstVal || firstVal.toLowerCase().includes('fecha')) return;

        let isMatch = false;

        for (const idx of searchIndices) {
            const cellValue = row._values[idx] || '';
            if (!cellValue) continue;

            const cellUpper = cellValue.toString().toUpperCase();
            const queryUpper = query.toUpperCase();

            if (cellUpper === queryUpper) {
                isMatch = true;
                break;
            }

            if (cellUpper.includes(queryUpper)) {
                isMatch = true;
                break;
            }

            if (baseCode) {
                const normalizedCell = normalizeCode(cellValue);
                if (normalizedCell.includes(baseCode)) {
                    isMatch = true;
                    break;
                }
            }
        }

        if (isMatch) {
            const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100 };
            results.exact[sourceName].push(enrichedRow);
        }
    });
}

function searchCANCELADO(data, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    const queryUpper = query.toUpperCase();
    // Buscar en CODIGO 1 (idx 1), CODIGO 2 (idx 2), UBICACION (idx 3), NOTA (idx 5)
    const searchIndices = [1, 2, 3, 5];

    data.forEach(row => {
        if (!row._values || row._values.length < 3) return;

        const firstVal = row._values[0]?.toString() || '';
        if (firstVal.toLowerCase().includes('fecha') && firstVal.toLowerCase().includes('codigo')) return;

        let isMatch = false;

        for (const idx of searchIndices) {
            const cellValue = row._values[idx] || '';
            if (!cellValue) continue;

            const cellUpper = cellValue.toString().toUpperCase();

            // Match exacto
            if (cellUpper === queryUpper) {
                isMatch = true;
                break;
            }

            // Match por inclusión en valor RAW (ej: "49033248" en "49033248/391")
            if (cellUpper.includes(queryUpper)) {
                isMatch = true;
                break;
            }

            // Match por código normalizado
            const normalizedCell = normalizeCode(cellValue);
            if (normalizedCell.includes(query)) {
                isMatch = true;
                break;
            }

            // Match por baseCode
            if (baseCode && baseCode !== query) {
                if (normalizedCell.includes(baseCode) || cellUpper.includes(baseCode)) {
                    isMatch = true;
                    break;
                }
            }
        }

        if (isMatch) {
            const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100 };
            results.exact[sourceName].push(enrichedRow);
        }
    });
}

/**
 * BÚSQUEDA EN EMBARQUES - Con Lógica de Triangulación
 * Columnas BD Embarques (índices):
 * 0-A: Folio, 1-B: Fecha, 2-C: Hora, 3-D: Usuario, 4-E: Orden (OBC)
 * 5-F: Destino, 6-G: Horario, 7-H: Código, 8-I: Código 2
 * 9-J: Estatus, 10-K: Cambio Etiqueta, 11-L: Estatus 2
 * 12-M: Cant Inicial, 13-N: Cant Despacho, 14-O: Incidencias
 * 15-P: Operador, 16-Q: Unidad, 17-R: Observaciones
 *
 * Lógica de Búsqueda:
 * 1. Si query es OBC: buscar directamente en columna Orden (índice 4)
 * 2. Si query es código de caja:
 *    a) Buscar por BaseCode en columnas Código (7) y Código 2 (8) - FUZZY
 *    b) Si no encuentra, hacer triangulación:
 *       - Buscar OBCs asociadas en BD_OBC
 *       - Buscar esas OBCs en columna Orden de Embarques
 */
function searchEMBARQUES(data, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    const directMatches = [];
    const triangulatedMatches = [];

    // PASO 1: Detectar si es búsqueda por OBC (típicamente empieza con "OBC")
    const isOBCQuery = query.toUpperCase().startsWith('OBC');

    if (isOBCQuery) {
        // Búsqueda directa por número de orden en columna Orden (índice 4)
        data.forEach(row => {
            if (!row._values || row._values.length < 5) return;

            const ordenValue = row._values[4]?.toString().toUpperCase() || '';
            if (ordenValue === query || ordenValue.includes(query)) {
                const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100, _searchMethod: 'OBC_directa' };
                directMatches.push(enrichedRow);
            }
        });

        // Agregar resultados directos
        results.exact[sourceName].push(...directMatches);
    } else {
        // PASO 2: Búsqueda por código de caja usando BaseCode en Código (7) y Código 2 (8)
        // IMPORTANTE: Búsqueda FUZZY porque no hay códigos completos de caja en Embarques
        data.forEach(row => {
            if (!row._values || row._values.length < 9) return;

            const codigo = row._values[7]?.toString() || '';
            const codigo2 = row._values[8]?.toString() || '';

            // Buscar por BaseCode en ambos códigos
            if (codigo && baseCode) {
                const normalizedCodigo = normalizeCode(codigo);
                const codigoBaseCode = extractBaseCode(codigo);

                if (normalizedCodigo === baseCode || codigoBaseCode === baseCode ||
                    normalizedCodigo.includes(baseCode) || codigo.toUpperCase().includes(baseCode)) {
                    const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100, _searchMethod: 'BaseCode_codigo' };
                    directMatches.push(enrichedRow);
                    return; // Ya encontró match, no seguir buscando en esta fila
                }
            }

            if (codigo2 && baseCode) {
                const normalizedCodigo2 = normalizeCode(codigo2);
                const codigo2BaseCode = extractBaseCode(codigo2);

                if (normalizedCodigo2 === baseCode || codigo2BaseCode === baseCode ||
                    normalizedCodigo2.includes(baseCode) || codigo2.toUpperCase().includes(baseCode)) {
                    const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100, _searchMethod: 'BaseCode_codigo2' };
                    directMatches.push(enrichedRow);
                }
            }
        });

        // PASO 3: Si no se encontró nada con BaseCode, hacer TRIANGULACIÓN
        if (directMatches.length === 0) {
            // 3.1 Buscar en OBC_BD todas las órdenes asociadas a esta caja
            const associatedOBCs = new Set();
            DATA_CACHE.obcBd.forEach(row => {
                const codigoField = row['Custom box barcode_自定义箱条码'] || '';
                if (codigoField) {
                    const normalizedField = normalizeCode(codigoField);
                    const fieldBaseCode = extractBaseCode(codigoField);

                    if (normalizedField === query || fieldBaseCode === baseCode ||
                        normalizedField.includes(query) || normalizedField.includes(baseCode)) {
                        const obcValue = row['Outbound_出库单号'] || '';
                        if (obcValue) {
                            associatedOBCs.add(obcValue.toUpperCase());
                        }
                    }
                }
            });

            // 3.2 Buscar esas OBCs en la base de Embarques
            if (associatedOBCs.size > 0) {
                data.forEach(row => {
                    if (!row._values || row._values.length < 5) return;

                    const ordenValue = row._values[4]?.toString().toUpperCase() || '';
                    if (associatedOBCs.has(ordenValue)) {
                        const enrichedRow = {
                            ...row,
                            _matchType: 'exact',
                            _similarity: 90,
                            _searchMethod: 'Triangulación_OBC',
                            _triangulatedOBCs: Array.from(associatedOBCs)
                        };
                        triangulatedMatches.push(enrichedRow);
                    }
                });
            }
        }

        // Agregar resultados (primero directos, luego triangulados)
        results.exact[sourceName].push(...directMatches);
        results.exact[sourceName].push(...triangulatedMatches);
    }

    console.log(`🚚 [EMBARQUES] Búsqueda completada:`, {
        query,
        baseCode,
        isOBCQuery,
        directMatches: directMatches.length,
        triangulatedMatches: triangulatedMatches.length,
        total: directMatches.length + triangulatedMatches.length
    });
}

/**
 * BÚSQUEDA EN REPARACIONES - Búsqueda Booleana (Existe/No Existe)
 * Columnas BD Reparaciones (índices):
 * 0-A: FECHA REGISTRO, 1-B: OBC, 2-C: CODIGO (ID_Caja)
 * 3-D: UBICACION, 4-E: FECHA ENVIO, 5-F: HORARIO
 * 6-G: REPARADO, 7-H: ENTREGADO
 * 8-I: OBSERVACIONES (SURTIDO), 9-J: OBSERVACIONES (RECIBO)
 *
 * Lógica de Búsqueda:
 * - Búsqueda FUZZY por BaseCode en columna CODIGO (índice 2)
 * - Si encuentra match exacto, retornar ese registro
 * - Si no, buscar por coincidencia abierta con BaseCode
 */
function searchREPARACIONES(data, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    // MEJORA: Buscar en columna B (OBC) Y columna C (CODIGO)
    const searchIndices = [1, 2]; // B: OBC (índice 1), C: CODIGO (índice 2)
    const exactMatches = [];
    const fuzzyMatches = [];

    console.log(`🪚 [REPARACIONES] Buscando "${query}" en columnas B (OBC) y C (CODIGO)...`);

    data.forEach(row => {
        if (!row._values || row._values.length < 3) return;

        // Saltar encabezados
        const firstVal = row._values[0]?.toString() || '';
        if (!firstVal || firstVal.toLowerCase().includes('fecha')) return;

        let matchType = null; // 'exact' o 'fuzzy'
        let matchMethod = '';
        let similarity = 0;

        for (const idx of searchIndices) {
            const cellValue = row._values[idx] || '';
            if (!cellValue) continue;

            const cellUpper = cellValue.toString().toUpperCase();
            const queryUpper = query.toUpperCase();
            const columnName = idx === 1 ? 'OBC (Col B)' : 'CODIGO (Col C)';

            // ========== MATCH EXACTO (100%) ==========
            if (cellUpper === queryUpper) {
                matchType = 'exact';
                matchMethod = `Exacto en ${columnName}`;
                similarity = 100;
                console.log(`✅ [REPARACIONES] Match exacto en ${columnName}: "${cellValue}"`);
                break;
            }

            // ========== MATCHES FUZZY (< 100%) ==========
            // Solo buscar fuzzy si no hubo match exacto

            // MATCH POR INCLUSIÓN (95%)
            if (!matchType && cellUpper.includes(queryUpper)) {
                matchType = 'fuzzy';
                matchMethod = `Inclusión en ${columnName}`;
                similarity = 95;
                console.log(`✅ [REPARACIONES] Match parcial en ${columnName}: "${cellValue}"`);
                break;
            }

            // MATCH POR BASECODE (90% o 85%)
            if (!matchType && baseCode) {
                const normalizedCell = normalizeCode(cellValue);
                const cellBaseCode = extractBaseCode(cellValue);

                if (normalizedCell === baseCode || cellBaseCode === baseCode) {
                    matchType = 'fuzzy';
                    matchMethod = 'BaseCode_exacto';
                    similarity = 90;
                    break;
                }

                if (normalizedCell.includes(baseCode) || cellUpper.includes(baseCode)) {
                    matchType = 'fuzzy';
                    matchMethod = 'BaseCode_fuzzy';
                    similarity = 85;
                    break;
                }
            }
        }

        // Separar en exact o partial según el tipo de match
        if (matchType === 'exact') {
            const enrichedRow = {
                ...row,
                _matchType: 'exact',
                _similarity: similarity,
                _searchMethod: matchMethod
            };
            exactMatches.push(enrichedRow);
        } else if (matchType === 'fuzzy') {
            const enrichedRow = {
                ...row,
                _matchType: 'fuzzy',
                _similarity: similarity,
                _searchMethod: matchMethod
            };
            fuzzyMatches.push(enrichedRow);
        }
    });

    // Agregar matches exactos a results.exact
    results.exact[sourceName].push(...exactMatches);

    // Agregar matches fuzzy a results.partial
    results.partial[sourceName].push(...fuzzyMatches);

    console.log(`🪚 [REPARACIONES] Búsqueda completada:`, {
        query,
        baseCode,
        exactMatches: exactMatches.length,
        fuzzyMatches: fuzzyMatches.length,
        total: exactMatches.length + fuzzyMatches.length
    });
}

function searchInSourceWithSimilarity(data, results, sourceName, fields) {
    const query = results.query;
    const variations = results.variations;
    const baseCode = results.baseCode;
    const SIMILARITY_THRESHOLD = 75;

    data.forEach(row => {
        let bestMatch = { type: null, similarity: 0, field: null };

        fields.forEach(field => {
            const matchResult = checkFieldMatch(row[field], query, variations, baseCode);
            if (matchResult && matchResult.similarity > bestMatch.similarity) {
                bestMatch = matchResult;
            }
        });

        if (sourceName === 'trs' && bestMatch.type !== 'exact') {
            Object.values(row).forEach(cellValue => {
                if (typeof cellValue === 'string' && cellValue.trim()) {
                    const matchResult = checkFieldMatch(cellValue, query, variations, baseCode);
                    if (matchResult && matchResult.similarity > bestMatch.similarity) {
                        bestMatch = matchResult;
                    }
                }
            });
        }

        if (bestMatch.type === 'exact') {
            const enrichedRow = { ...row, _matchType: 'exact', _similarity: 100 };
            results.exact[sourceName].push(enrichedRow);
        } else if (bestMatch.type === 'fuzzy' && bestMatch.similarity >= SIMILARITY_THRESHOLD) {
            if (results.partial[sourceName].length < CONFIG.MAX_RESULTS) {
                const enrichedRow = { ...row, _matchType: 'fuzzy', _similarity: Math.round(bestMatch.similarity) };
                results.partial[sourceName].push(enrichedRow);
            }
        }
    });

    results.partial[sourceName].sort((a, b) => (b._similarity || 0) - (a._similarity || 0));
}

function checkFieldMatch(rawValue, query, variations, baseCode) {
    if (!rawValue || !String(rawValue).trim()) return null;

    const rawUpper = String(rawValue).trim().toUpperCase();
    const value = normalizeCode(rawValue);
    if (!value) return null;

    // === EXACT MATCH CHECKS ===
    if (value === query || variations.includes(value)) {
        return { type: 'exact', similarity: 100 };
    }

    const valueBaseCode = extractBaseCode(value);
    if (valueBaseCode === query || variations.includes(valueBaseCode)) {
        return { type: 'exact', similarity: 100 };
    }

    if (value.startsWith(query) && value.length > query.length) {
        const suffix = value.substring(query.length);
        if (/^[U\-\/\'\d]/.test(suffix)) {
            return { type: 'exact', similarity: 100 };
        }
    }

    if (query.startsWith(value) && query.length > value.length) {
        const suffix = query.substring(value.length);
        if (/^[U\-\/\'\d]/.test(suffix)) {
            return { type: 'exact', similarity: 100 };
        }
    }

    if (value.includes(query) && query.length >= 8) {
        const idx = value.indexOf(query);
        const charBefore = idx > 0 ? value[idx - 1] : '';
        const charAfter = idx + query.length < value.length ? value[idx + query.length] : '';
        const isAtBoundary = (idx === 0 || !/[A-Z0-9]/.test(charBefore)) &&
                            (idx + query.length === value.length || !/[A-Z]/.test(charAfter));
        if (isAtBoundary) {
            return { type: 'exact', similarity: 100 };
        }
    }

    if (rawUpper.includes(query) && query.length >= 8) {
        return { type: 'exact', similarity: 100 };
    }

    // === FLEXIBLE/FUZZY MATCH CHECKS ===
    let bestFuzzy = { type: null, similarity: 0 };

    if (baseCode && baseCode !== query && valueBaseCode === baseCode) {
        bestFuzzy = { type: 'fuzzy', similarity: 95 };
    }

    if (value.includes(query) || query.includes(value)) {
        const overlapRatio = Math.min(query.length, value.length) / Math.max(query.length, value.length) * 100;
        if (overlapRatio > bestFuzzy.similarity) {
            bestFuzzy = { type: 'fuzzy', similarity: overlapRatio };
        }
    }

    const similarity = calculateSimilarity(query, value);
    if (similarity >= 75 && similarity > bestFuzzy.similarity) {
        bestFuzzy = { type: 'fuzzy', similarity };
    }

    return bestFuzzy.type ? bestFuzzy : null;
}

// ==================== DISPLAY RESULTS ====================
function displayResults(results, query) {
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('results-container').classList.add('show');

    displaySummary(results);
    displaySections(results);
}

function displaySummary(results) {
    const card = document.getElementById('summary-card');
    const isExactMode = GLOBAL_SEARCH_MODE === 'exact';

    const getInfo = (exactArr, partialArr) => {
        if (isExactMode) {
            return exactArr[0] || null;
        }
        return exactArr[0] || partialArr[0] || null;
    };

    const stockInfo = getInfo(results.exact.bdStock, results.partial.bdStock);
    const obcInfo = getInfo(results.exact.obcBd, results.partial.obcBd);
    const mneInfo = getInfo(results.exact.mne, results.partial.mne);
    const validacionInfo = getInfo(results.exact.validacion, results.partial.validacion);
    const inventarioInfo = getInfo(results.exact.inventario, results.partial.inventario);
    const trsInfo = getInfo(results.exact.trs, results.partial.trs);
    const canceladoInfo = getInfo(results.exact.cancelado, results.partial.cancelado);
    const embarquesInfo = getInfo(results.exact.embarques, results.partial.embarques);
    const reparacionesInfo = getInfo(results.exact.reparaciones, results.partial.reparaciones);

    const totalExact = Object.values(results.exact).reduce((sum, arr) => sum + arr.length, 0);
    const totalPartial = Object.values(results.partial).reduce((sum, arr) => sum + arr.length, 0);

    const flexibleCounts = {
        bdStock: results.partial.bdStock.length,
        obcBd: results.partial.obcBd.length,
        validacion: results.partial.validacion.length,
        inventario: results.partial.inventario.length,
        mne: results.partial.mne.length,
        trs: results.partial.trs.length,
        cancelado: results.partial.cancelado.length,
        embarques: results.partial.embarques.length,
        reparaciones: results.partial.reparaciones.length
    };

    const flexIndicator = (source) => {
        if (isExactMode && results.exact[source].length === 0 && flexibleCounts[source] > 0) {
            return `<span class="badge warning" style="font-size: 0.6em; margin-left: 4px;" title="Hay ${flexibleCounts[source]} coincidencias flexibles disponibles">~${flexibleCounts[source]}</span>`;
        }
        return '';
    };

    const obcExact = results.exact.obcBd.length > 0;
    const obcMultiple = isExactMode ? results.exact.obcBd.length : results.exact.obcBd.length + results.partial.obcBd.length;

    let obcOrden = '-';
    let obcBoxCount = 0;
    let obcInTrackingCount = 0;
    let obcValidatedCount = 0;
    let obcValidationPercent = 0;

    if (obcExact && obcInfo) {
        obcOrden = obcInfo['Outbound_出库单号'] || obcInfo['Reference order No._参考单号'];

        const obcCode = obcInfo['Outbound_出库单号'];
        if (obcCode) {
            obcBoxCount = DATA_CACHE.obcBd.filter(r => r['Outbound_出库单号'] === obcCode).length;
            obcInTrackingCount = DATA_CACHE.mne.filter(r =>
                normalizeCode(r['Orden OBC'] || '').includes(obcCode)
            ).length;

            obcValidatedCount = DATA_CACHE.validacion.filter(r =>
                normalizeCode(r['Orden'] || '').includes(obcCode)
            ).length;

            if (obcBoxCount > 0) {
                obcValidationPercent = Math.min(100, Math.round((obcValidatedCount / obcBoxCount) * 100));
            }
        }
    } else if (!isExactMode && obcMultiple > 1) {
        obcOrden = `${obcMultiple} coincidencias`;
    } else if (!isExactMode && obcInfo) {
        obcOrden = obcInfo['Outbound_出库单号'] || obcInfo['Reference order No._参考单号'] || '-';
    }

    const trsExact = results.exact.trs.length > 0;
    const trsMultipleExact = results.exact.trs.length;
    const trsMultipleFlex = results.partial.trs.length;
    const getTrsNumber = (info) => info?._values?.[0] || null;

    let trsOrden = 'NO';
    if (isExactMode) {
        if (trsExact && trsInfo) {
            trsOrden = trsMultipleExact > 1 ? `${trsMultipleExact} TRS` : getTrsNumber(trsInfo);
        }
    } else {
        const trsTotal = trsMultipleExact + trsMultipleFlex;
        if (trsInfo) {
            trsOrden = trsTotal > 1 ? `${trsTotal} TRS` : getTrsNumber(trsInfo) || 'NO';
        }
    }

    const stockLocations = new Set();
    const stockSource = isExactMode ? results.exact.bdStock : [...results.exact.bdStock, ...results.partial.bdStock];
    stockSource.forEach(r => {
        if (r['cellNo']) stockLocations.add(r['cellNo']);
    });

    card.innerHTML = `
        <div class="summary-header">
            <div class="summary-title">
                📦 ${makeCopyable(results.query)}
                ${totalExact > 0 ? '<span class="badge success">Exacta</span>' : isExactMode ? '<span class="badge gray">Sin Exactas</span>' : '<span class="badge warning">Flexible</span>'}
                ${isExactMode && totalExact === 0 && totalPartial > 0 ? `<span class="badge warning" style="margin-left: 4px;">~${totalPartial} flexibles</span>` : ''}
            </div>
            <div class="summary-actions">
                <button class="btn btn-success" onclick="exportResults()">📥 Exportar</button>
                <button class="btn btn-secondary" onclick="printResults()">🖨️ Imprimir</button>
            </div>
        </div>

        <div class="summary-grid">
            <div class="summary-item primary" onclick="jumpToSection('obcBd')">
                ${obcMultiple > 1 ? `<span class="count-indicator" onclick="event.stopPropagation(); jumpToSection('obcBd')">${obcMultiple}</span>` : ''}
                <div class="summary-label">
                    📋 Número de Orden ${flexIndicator('obcBd')}
                </div>
                <div class="summary-value">${makeCopyable(obcOrden)}</div>
                ${obcBoxCount > 0 ? `<div style="font-size: 0.75em; color: #666; margin-top: 4px;">📦 ${obcBoxCount} cajas</div>` : ''}
            </div>

            <div class="summary-item info" onclick="jumpToSection('obcBd')">
                <div class="summary-label">👤 Destino/Cliente ${flexIndicator('obcBd')}</div>
                <div class="summary-value">${obcInfo?.['Recipient_收件人'] || '-'}</div>
                ${obcInfo?.['Expected Arrival Time _ 期望到仓时间'] ? `<div style="font-size: 0.75em; color: #666; margin-top: 4px;">📅 ${obcInfo['Expected Arrival Time _ 期望到仓时间']}</div>` : ''}
            </div>

            <div class="summary-item success" onclick="jumpToSection('bdStock')">
                ${stockLocations.size > 1 ? `<span class="count-indicator" onclick="event.stopPropagation(); jumpToSection('bdStock')">${stockLocations.size}</span>` : ''}
                <div class="summary-label">📍 Ubicación Actual WMS ${flexIndicator('bdStock')}</div>
                <div class="summary-value">${makeCopyable(stockInfo?.['cellNo'] || (isExactMode ? '-' : inventarioInfo?.['UBICACION']) || '-')}</div>
            </div>

            <div class="summary-item gray" onclick="jumpToSection('inventario')">
                <div class="summary-label">🕐 Último Movimiento ${flexIndicator('inventario')}</div>
                <div class="summary-value">${inventarioInfo ? `${inventarioInfo['FECHA']} ${inventarioInfo['HORA']} - ${inventarioInfo['USUARIO']}` : '-'}</div>
            </div>

            <div class="summary-item ${mneInfo ? 'error' : 'success'}" onclick="jumpToSection('mne')">
                ${results.exact.mne.length > 1 ? `<span class="count-indicator" onclick="event.stopPropagation(); jumpToSection('mne')">${results.exact.mne.length}</span>` : ''}
                <div class="summary-label">🔍 Estatus en Rastreo ${flexIndicator('mne')}</div>
                <div class="summary-value">${mneInfo ? 'REGISTRADA' : 'SIN REGISTRO'}</div>
            </div>

            <div class="summary-item ${validacionInfo ? 'success' : 'gray'}" onclick="jumpToSection('validacion')">
                <div class="summary-label">✅ Estatus Validación ${flexIndicator('validacion')}</div>
                <div class="summary-value">${validacionInfo ? 'VALIDADA' : 'SIN VALIDAR'}</div>
                ${validacionInfo ? `<div style="font-size:0.75em;color:#666;margin-top:4px;">
                    <span style="color:${obcValidationPercent >= 100 ? '#4CAF50' : obcValidationPercent >= 50 ? '#FF9800' : '#F44336'};">
                        ${obcValidationPercent >= 100 ? '✅' : '⌛'} ${obcValidatedCount || 0}/${obcBoxCount || 0} (${obcValidationPercent || 0}%)
                    </span>
                    ${obcInTrackingCount > 0 ? ` • 🔍 ${obcInTrackingCount} rastreo` : ''}
                </div>` : ''}
            </div>

            <div class="summary-item ${trsExact ? 'primary' : (isExactMode ? 'gray' : trsMultipleFlex > 0 ? 'warning' : 'gray')}" onclick="jumpToSection('trs')">
                ${(isExactMode ? trsMultipleExact : trsMultipleExact + trsMultipleFlex) > 1 ? `<span class="count-indicator" onclick="event.stopPropagation(); jumpToSection('trs')">${isExactMode ? trsMultipleExact : trsMultipleExact + trsMultipleFlex}</span>` : ''}
                <div class="summary-label">
                    🔧 Orden de Trabajo ${flexIndicator('trs')}
                </div>
                <div class="summary-value">${makeCopyable(trsOrden)}</div>
            </div>

            <div class="summary-item ${reparacionesInfo ? 'warning' : 'success'}" onclick="jumpToSection('reparaciones')">
                <div class="summary-label">🪚 Reparaciones ${flexIndicator('reparaciones')}</div>
                <div class="summary-value">${reparacionesInfo ? 'SÍ' : 'NO'}</div>
                ${reparacionesInfo && reparacionesInfo._values ? `
                    <div style="font-size: 0.75em; color: #666; margin-top: 4px;">
                        ${reparacionesInfo._values[6] === 'SI' ? '✅ Reparado' : '⏳ En proceso'}
                        ${reparacionesInfo._values[7] === 'SI' ? ' • ✅ Entregado' : ''}
                    </div>
                ` : ''}
            </div>

            <div class="summary-item ${embarquesInfo ? 'primary' : 'gray'}" onclick="jumpToSection('embarques')">
                ${results.exact.embarques.length > 1 ? `<span class="count-indicator" onclick="event.stopPropagation(); jumpToSection('embarques')">${results.exact.embarques.length}</span>` : ''}
                <div class="summary-label">🚚 Embarques ${flexIndicator('embarques')}</div>
                <div class="summary-value">${embarquesInfo ? (embarquesInfo._values?.[9] || 'PROCESADO') : 'SIN DESPACHO'}</div>
                ${embarquesInfo && embarquesInfo._values ? `
                    <div style="font-size: 0.75em; color: #666; margin-top: 4px;">
                        📦 ${embarquesInfo._values[13] || 0}/${embarquesInfo._values[12] || 0} despachadas
                    </div>
                ` : ''}
            </div>

            <div class="summary-item ${canceladoInfo ? 'error' : 'success'}" onclick="jumpToSection('cancelado')">
                ${results.exact.cancelado.length > 1 ? `<span class="count-indicator" onclick="event.stopPropagation(); jumpToSection('cancelado')">${results.exact.cancelado.length}</span>` : ''}
                <div class="summary-label">🏷️ Otros ${flexIndicator('cancelado')}</div>
                <div class="summary-value">${canceladoInfo ? 'OTROS' : 'SIN REGISTRO'}</div>
            </div>
        </div>
    `;
}

// Copy to clipboard functionality
function copyToClipboard(text, iconElement) {
    if (!text || text === '-') return;

    navigator.clipboard.writeText(text).then(() => {
        iconElement.classList.add('copied');
        iconElement.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

        setTimeout(() => {
            iconElement.classList.remove('copied');
            iconElement.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        }, 1500);

        showNotification('📋 Copiado al portapapeles', 'success');
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

function makeCopyable(value) {
    if (!value || value === '-') return value;
    return `<span class="copyable">${value}<span class="copy-icon" onclick="event.stopPropagation(); copyToClipboard('${value.replace(/'/g, "\\'")}', this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span></span>`;
}

function jumpToSection(sectionKey) {
    document.querySelectorAll('.section-content').forEach(el => {
        if (!el.classList.contains('collapsed')) {
            el.classList.add('collapsed');
            const toggle = document.getElementById(`${el.id}-toggle`);
            if (toggle) toggle.classList.add('collapsed');
        }
    });

    const targetSection = document.getElementById(`section-${sectionKey}`);
    if (targetSection) {
        targetSection.classList.remove('collapsed');
        const toggle = document.getElementById(`section-${sectionKey}-toggle`);
        if (toggle) toggle.classList.remove('collapsed');
        targetSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function displaySections(results) {
    const container = document.getElementById('sections-container');
    container.innerHTML = '';

    const sections = [
        { key: 'bdStock', title: '📦 BD Stock - Inventario Actual', color: 'success' },
        { key: 'obcBd', title: '📋 OBC BD - Órdenes de Salida', color: 'primary' },
        { key: 'validacion', title: '✅ Sistema Validación Surtido', color: 'success' },
        { key: 'inventario', title: '📊 Inventario Escaneo - Movimientos', color: 'info' },
        { key: 'mne', title: '🔍 Rastreo MNE - Mercancía No Encontrada', color: 'error' },
        { key: 'trs', title: '🔧 TRS Etiquetado - Órdenes de Trabajo', color: 'warning' },
        { key: 'reparaciones', title: '🪚 Reparaciones - Cajas en Reparación', color: 'warning' },
        { key: 'embarques', title: '🚚 Embarques - Despacho de Mercancía', color: 'primary' },
        { key: 'cancelado', title: '🏷️ Otros', color: 'error' }
    ];

    let hasResults = false;

    sections.forEach(section => {
        const mode = SECTION_MODES[section.key];
        const exact = results.exact[section.key];
        const partial = results.partial[section.key];

        const dataToShow = mode === 'exact' ? exact : [...exact, ...partial];

        if (dataToShow.length > 0) {
            hasResults = true;
            container.appendChild(createSectionCard(section, exact, partial, mode));
        }
    });

    if (!hasResults) {
        const isExactMode = GLOBAL_SEARCH_MODE === 'exact';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <div class="empty-text">No se encontraron resultados para "${results.query}"</div>
                <div class="empty-subtext">
                    ${isExactMode
                        ? '💡 Intenta activar <strong>Búsqueda Flexible</strong> para ver coincidencias parciales'
                        : '🤔 Verifica que el código sea correcto o intenta con otro formato'}
                </div>
            </div>
        `;
    }
}

function createSectionCard(section, exactResults, partialResults, mode) {
    const dataToShow = mode === 'exact' ? exactResults : [...exactResults, ...partialResults];
    const card = document.createElement('div');
    card.className = 'section-card';

    const sectionId = `section-${section.key}`;

    card.innerHTML = `
        <div class="section-header">
            <div class="section-header-left">
                <div class="section-title-wrapper" onclick="toggleSection('${sectionId}')">
                    <div class="section-title">
                        ${section.title}
                        <span class="section-count">${dataToShow.length}</span>
                    </div>
                </div>
                <div class="section-mode-toggle" onclick="event.stopPropagation(); toggleSectionMode('${section.key}')">
                    <span class="mode-label ${mode === 'exact' ? 'active' : ''}">Exacta</span>
                    <input type="checkbox" ${mode === 'flexible' ? 'checked' : ''} onclick="event.preventDefault();">
                    <span class="mode-label ${mode === 'flexible' ? 'active' : ''}">Flexible</span>
                </div>
            </div>
            <span class="section-toggle" id="${sectionId}-toggle" onclick="toggleSection('${sectionId}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </span>
        </div>
        <div class="section-content" id="${sectionId}">
            ${mode === 'exact' && exactResults.length > 0 ? `
                <div class="match-info exact">
                    ✅ <strong>${exactResults.length}</strong> coincidencia${exactResults.length > 1 ? 's' : ''} exacta${exactResults.length > 1 ? 's' : ''}
                </div>
                ${renderTable(exactResults, section.key)}
            ` : mode === 'exact' && exactResults.length === 0 ? `
                <div class="empty-state" style="padding: 30px;">
                    <div class="empty-icon" style="font-size: 2em;">🔍</div>
                    <div class="empty-text" style="font-size: 1em;">Sin coincidencias exactas</div>
                    <div class="empty-subtext">Activa "Flexible" para ver coincidencias parciales</div>
                </div>
            ` : ''}

            ${mode === 'flexible' ? `
                ${exactResults.length > 0 ? `
                    <div class="match-info exact">
                        ✅ <strong>${exactResults.length}</strong> coincidencia${exactResults.length > 1 ? 's' : ''} exacta${exactResults.length > 1 ? 's' : ''}
                    </div>
                    ${renderTable(exactResults, section.key)}
                ` : ''}

                ${partialResults.length > 0 ? `
                    <div class="match-info">
                        ⚠️ <strong>${partialResults.length}</strong> coincidencia${partialResults.length > 1 ? 's' : ''} parcial${partialResults.length > 1 ? 'es' : ''}
                        ${partialResults.length >= CONFIG.MAX_RESULTS ? ` (mostrando primeras ${CONFIG.MAX_RESULTS})` : ''}
                    </div>
                    ${renderTable(partialResults, section.key)}
                ` : ''}
            ` : ''}
        </div>
    `;

    return card;
}

function renderTable(data, sourceKey) {
    if (data.length === 0) return '<div class="empty-state" style="padding: 20px;"><div class="empty-text" style="font-size: 0.9em;">📭 Sin coincidencias</div></div>';

    const fields = getRelevantFields(sourceKey);

    return `
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th style="width: 40px;">#</th>
                        ${fields.map(f => `<th${f.type === 'stock' ? ' class="col-stock"' : ''}>${f.label}</th>`).join('')}
                        <th style="width: 80px;">Tipo</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map((row, idx) => `
                        <tr>
                            <td style="text-align: center; color: #999; font-weight: 600;">${idx + 1}</td>
                            ${fields.map(f => `<td${f.type === 'stock' ? ' class="col-stock"' : ''}>${formatValue(getRowValue(row, f.key), f.type)}</td>`).join('')}
                            <td style="text-align: center;">
                                ${row._matchType === 'exact'
                                    ? '<span class="badge success">Exacta</span>'
                                    : `<span class="badge warning">~${Math.round(row._similarity || 0)}%</span>`
                                }
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${data.length >= CONFIG.MAX_RESULTS ? '<div class="print-notice">⚠️ Mostrando primeros ' + CONFIG.MAX_RESULTS + ' resultados</div>' : ''}
        </div>
    `;
}

function getRowValue(row, keyPattern) {
    if (typeof keyPattern === 'number') {
        if (row._values && row._values[keyPattern] !== undefined) {
            const val = row._values[keyPattern];
            return val && val.trim() ? val : 'Vacío';
        }
        return 'Vacío';
    }

    if (row[keyPattern] !== undefined && row[keyPattern] !== '') {
        return row[keyPattern];
    }

    for (const [colName, value] of Object.entries(row)) {
        if (colName === '_values' || colName === '_matchType' || colName === '_similarity') continue;
        if (colName.includes(keyPattern)) {
            return value && value.trim() ? value : 'Vacío';
        }
        if (colName.toLowerCase().includes(keyPattern.toLowerCase())) {
            return value && value.trim() ? value : 'Vacío';
        }
    }

    return 'Vacío';
}

function getRelevantFields(sourceKey) {
    const fieldMap = {
        bdStock: [
            { key: 'Customize Barcode/自定义箱条码', label: 'Código Caja', type: 'code' },
            { key: 0, label: 'Box Type', type: 'text' },
            { key: 'cellNo', label: 'Ubicación', type: 'text' },
            { key: 'Available stock/可用库存', label: 'Disponible', type: 'stock' },
            { key: 'Locked Inventory/锁定库存', label: 'Bloqueado', type: 'stock' },
            { key: 4, label: 'Medida', type: 'text' },
            { key: 5, label: 'Peso', type: 'text' },
            { key: 'sku', label: 'SKU', type: 'text' }
        ],
        obcBd: [
            { key: 'Custom box barcode_自定义箱条码', label: 'Código Caja', type: 'code' },
            { key: 'Outbound_出库单号', label: 'Número Orden', type: 'code' },
            { key: 'Recipient_收件人', label: 'Destinatario', type: 'text' },
            { key: 'Expected Arrival Time _ 期望到仓时间', label: 'Fecha Entrega', type: 'datetime' },
            { key: 'Reference order No._参考单号', label: 'Referencia', type: 'text' },
            { key: 'Shipping service_物流渠道', label: 'Servicio', type: 'text' }
        ],
        validacion: [
            { key: 'Fecha', label: 'Fecha', type: 'date' },
            { key: 'Hora', label: 'Hora', type: 'time' },
            { key: 'Validador', label: 'Validador', type: 'text' },
            { key: 'Orden', label: 'Orden', type: 'code' },
            { key: 'Codigo', label: 'Código', type: 'code' },
            { key: 'Ubicación', label: 'Ubicación', type: 'text' },
            { key: 'Nota', label: 'Nota', type: 'text' }
        ],
        inventario: [
            { key: 0, label: 'Fecha', type: 'date' },
            { key: 1, label: 'Hora', type: 'time' },
            { key: 2, label: 'Usuario', type: 'text' },
            { key: 3, label: 'Código 1', type: 'code' },
            { key: 4, label: 'Código 2', type: 'code' },
            { key: 5, label: 'Ubicación', type: 'text' },
            { key: 6, label: 'Estatus', type: 'status' },
            { key: 7, label: 'Pallet', type: 'text' }
        ],
        mne: [
            { key: 0, label: 'Fecha', type: 'date' },
            { key: 1, label: 'Mes', type: 'text' },
            { key: 3, label: 'Orden', type: 'code' },
            { key: 5, label: 'Código', type: 'code' },
            { key: 12, label: 'Responsable', type: 'text' },
            { key: 16, label: 'Estatus', type: 'text' }
        ],
        trs: [
            { key: 0, label: 'No. Servicio', type: 'code' },
            { key: 5, label: 'Fecha Esperada', type: 'datetime' },
            { key: 6, label: 'Referencia', type: 'code' },
            { key: 13, label: 'Código Original', type: 'code' },
            { key: 14, label: 'Código Nuevo', type: 'code' },
            { key: 16, label: 'Tipo Instrucción', type: 'text' }
        ],
        cancelado: [
            { key: 0, label: 'Fecha', type: 'date' },
            { key: 1, label: 'Código 1', type: 'code' },
            { key: 2, label: 'Código 2', type: 'code' },
            { key: 3, label: 'Ubicación', type: 'text' },
            { key: 4, label: 'Responsable', type: 'text' },
            { key: 5, label: 'Nota', type: 'text' }
        ],
        embarques: [
            { key: 0, label: 'Folio', type: 'code' },
            { key: 1, label: 'Fecha', type: 'date' },
            { key: 4, label: 'Orden', type: 'code' },
            { key: 5, label: 'Destino', type: 'text' },
            { key: 7, label: 'Código', type: 'code' },
            { key: 8, label: 'Código 2', type: 'code' },
            { key: 9, label: 'Estatus', type: 'status' },
            { key: 12, label: 'Cant Inicial', type: 'number' },
            { key: 13, label: 'Cant Despacho', type: 'number' },
            { key: 15, label: 'Operador', type: 'text' },
            { key: 16, label: 'Unidad', type: 'text' }
        ],
        reparaciones: [
            { key: 0, label: 'Fecha Registro', type: 'date' },
            { key: 1, label: 'OBC', type: 'code' },
            { key: 2, label: 'Código', type: 'code' },
            { key: 6, label: 'Reparado', type: 'status' },
            { key: 7, label: 'Entregado', type: 'status' },
            { key: 8, label: 'Observaciones 1', type: 'text' },
            { key: 9, label: 'Observaciones 2', type: 'text' }
        ]
    };

    return fieldMap[sourceKey] || [];
}

function formatValue(value, type) {
    if (!value || value === '') return '-';

    switch (type) {
        case 'code':
            return `<code>${value}</code>`;
        case 'status':
            const statusMap = {
                'OK': 'success',
                'BLOQUEADO': 'error',
                'NO WMS': 'warning',
                'processing': 'warning',
                'completed': 'success'
            };
            const badgeType = statusMap[value] || 'gray';
            return `<span class="badge ${badgeType}">${value}</span>`;
        case 'number':
            return parseFloat(value).toLocaleString();
        case 'stock':
            return `<span class="stock-value">${value}</span>`;
        case 'datetime':
        case 'date':
        case 'time':
            return value;
        default:
            return value;
    }
}

function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const toggle = document.getElementById(`${sectionId}-toggle`);

    content.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
}

// ==================== EXPORT & PRINT ====================
function exportResults() {
    if (!CURRENT_SEARCH) return;

    const results = searchAllSources(CURRENT_SEARCH);
    const data = [];

    data.push(['FUENTE', 'TIPO COINCIDENCIA', 'INFORMACIÓN']);

    Object.keys(results.exact).forEach(key => {
        results.exact[key].forEach(row => {
            const info = Object.entries(row)
                .filter(([k]) => !k.startsWith('_'))
                .map(([k, v]) => `${k}: ${v}`)
                .join(' | ');
            data.push([getSourceName(key), 'EXACTA', info]);
        });
    });

    Object.keys(results.partial).forEach(key => {
        results.partial[key].forEach(row => {
            const info = Object.entries(row)
                .filter(([k]) => !k.startsWith('_'))
                .map(([k, v]) => `${k}: ${v}`)
                .join(' | ');
            data.push([getSourceName(key), 'PARCIAL', info]);
        });
    });

    const csv = '\ufeff' + data.map(row =>
        row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `consulta_${CURRENT_SEARCH}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    showNotification('✅ Resultados exportados', 'success');
}

function printResults() {
    const body = document.body;
    body.classList.remove('print-limit-exact', 'print-limit-flexible');

    if (GLOBAL_SEARCH_MODE === 'exact') {
        body.classList.add('print-limit-exact');
    } else {
        body.classList.add('print-limit-flexible');
    }

    window.print();
}

function getSourceName(key) {
    const names = {
        bdStock: 'BD Stock',
        obcBd: 'OBC BD',
        validacion: 'Validación Surtido',
        inventario: 'Inventario Escaneo',
        mne: 'Rastreo MNE',
        trs: 'TRS Etiquetado',
        embarques: 'Embarques',
        reparaciones: 'Reparaciones',
        cancelado: 'Otros'
    };
    return names[key] || key;
}

// ==================== UI UTILITIES ====================
function clearSearch() {
    document.getElementById('search-input').value = '';
    document.getElementById('results-container').classList.remove('show');
    document.getElementById('empty-state').style.display = 'block';
    CURRENT_SEARCH = null;
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.toggle('show', show);
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<span style="margin-right: 8px;">${icons[type]}</span>${message}`;

    container.appendChild(notification);
    setTimeout(() => notification.remove(), 4000);
}
