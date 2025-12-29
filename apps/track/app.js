// ==================== CONFIGURACIÓN ====================
const CONFIG = {
    SOURCES: {
        BD_STOCK: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-HG8HPf-94Ki5Leo5iEF5pyqsiD9CVk-mcl-F8BAw34kT0s3nzNn532YTYDCtkG76NbauiVx0Ffmd/pub?output=csv',
        OBC_BD: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSdSDQ8ktYA3YAsWMUokYd_S6_rANUz8XdfEAjsV-v0eAlfiYZctHuj3hP4m3wOghf4rnT_YvuA4BPA/pub?output=csv',
        VALIDACION: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZMZZCDtTFCebvsme1GMEBiZ1S2Cloh37AR8hHFAwhFPNEMD27G04bzX0theCMJE-nlYOyH2ev115q/pub?output=csv',
        INVENTARIO: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTXzUcwU_ZzJtCQKF6IEXr8Mj-OXvrzkw361v2rVVbb2goPaRMLPm6EbfrhXzeJJfWnvox4PhdGyoxZ/pub?output=csv',
        MNE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRHzXpt4q7KYo8QMnrO92LGcXQbx14lBCQ0wxHGHm2Lz4v5RCJCpQHmS0NhUTHUCCG2Hc1bkvTYhdpz/pub?gid=883314398&single=true&output=csv',
        TRS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ2NOvCCzIW0IS9ANzOYl7GKBq5I-XQM9e_V1tu_2VrDMq4Frgjol5uj6-4dBgEQcfB8b-k6ovaOJGc/pub?output=csv',
        CANCELADO: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSGSl9NnEjrP_3P4iRDSCaE776r2vjzwKthMyavQ4C5DOnmzDuY90YjZjfkLPGouxhyca140srhKaFO/pub?output=csv'
    },
    CACHE_DURATION: 30 * 60 * 1000,
    MAX_RESULTS: 20,
    SIMILARITY_THRESHOLD: 75
};

// ==================== ESTADO GLOBAL ====================
const STATE = {
    dataCache: {
        bdstock: [],
        obcbd: [],
        validacion: [],
        inventario: [],
        mne: [],
        trs: [],
        cancelado: []
    },
    lastUpdate: null,
    currentResult: null,
    currentSearch: '',
    isOnline: navigator.onLine,
    statistics: {
        totalSearches: 0,
        successfulSearches: 0,
        failedSearches: 0,
        lastSearchDate: null,
        sourcesUsed: {}
    }
};

// ==================== INICIALIZACIÓN ====================
function initializeApp() {
    initAudio();
    setupEventListeners();
    setupOfflineMode();
    loadStatistics();
    loadDatabase();
}

// ==================== CARGA DE BASE DE DATOS ====================
async function loadDatabase() {
    showLoading(true);
    updateDbStatus('Cargando base de datos...');
    
    try {
        const promises = Object.entries(CONFIG.SOURCES).map(async ([key, url]) => {
            try {
                const response = await fetch(url);
                const csvText = await response.text();
                const rows = csvText.split('\n')
                    .filter(line => line.trim())
                    .map(row => parseCSVLine(row));
                return { key: key.toLowerCase().replace('_', ''), rows };
            } catch (e) {
                console.warn(`Error loading ${key}:`, e);
                return { key: key.toLowerCase().replace('_', ''), rows: [] };
            }
        });

        const results = await Promise.all(promises);
        
        results.forEach(({ key, rows }) => {
            STATE.dataCache[key] = rows;
        });

        STATE.lastUpdate = new Date();
        const totalRows = Object.values(STATE.dataCache).reduce((sum, rows) => sum + rows.length, 0);
        
        // Guardar en localStorage para modo offline
        saveToLocalStorage();
        
        updateDbStatus(`✅ ${totalRows.toLocaleString()} registros | 🔄 ${STATE.lastUpdate.toLocaleTimeString()}`);
        showNotification(`✅ BD cargada: ${totalRows.toLocaleString()} registros desde ${Object.keys(CONFIG.SOURCES).length} fuentes`, 'success');
    } catch (error) {
        console.error('Error loading database:', error);
        
        // Intentar cargar desde localStorage si falla
        const loaded = loadFromLocalStorage();
        if (loaded) {
            updateDbStatus('⚠️ Usando datos en caché (offline)');
            showNotification('⚠️ Usando datos guardados (modo offline)', 'warning');
        } else {
            updateDbStatus('❌ Error al cargar base de datos');
            showNotification('❌ Error al cargar base de datos', 'error');
        }
    } finally {
        showLoading(false);
    }
}

function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchBox();
        }
    });
}

// ==================== BÚSQUEDA AVANZADA ====================
function searchBox() {
    const searchInput = document.getElementById('search-input');
    const rawCode = searchInput.value.trim();

    if (!rawCode) {
        showNotification('⚠️ Ingresa un código para buscar', 'warning');
        return;
    }

    showLoading(true);
    
    // Normalizar código usando función compartida
    const normalizedCode = normalizeCode(rawCode);
    STATE.currentSearch = normalizedCode;
    
    // Actualizar estadísticas
    STATE.statistics.totalSearches++;
    STATE.statistics.lastSearchDate = new Date().toISOString();
    
    // Generar variantes para búsqueda inteligente
    const variations = generateCodeVariations(normalizedCode);
    const baseCode = extractBaseCode(normalizedCode);
    
    // Buscar en todas las fuentes con algoritmo avanzado
    const results = searchAllSourcesAdvanced(normalizedCode, variations, baseCode);
    
    showLoading(false);
    
    if (!results.hasResults) {
        STATE.statistics.failedSearches++;
        saveStatistics();
        showNotification('❌ Código no encontrado en ninguna fuente', 'error');
        hideResults();
        playSound('error');
        return;
    }

    // Actualizar estadísticas de éxito
    STATE.statistics.successfulSearches++;
    Object.keys(results.exact).forEach(source => {
        if (results.exact[source].length > 0) {
            STATE.statistics.sourcesUsed[source] = (STATE.statistics.sourcesUsed[source] || 0) + 1;
        }
    });
    saveStatistics();

    STATE.currentResult = results;
    displayResults(results, normalizedCode);
    showNotification(`✅ Encontrado en ${results.sourceCount} fuente(s)`, 'success');
    playSound('success');
}

function searchAllSourcesAdvanced(query, variations, baseCode) {
    const results = {
        exact: {},
        partial: {},
        query: query,
        variations: variations,
        baseCode: baseCode,
        hasResults: false,
        sourceCount: 0,
        totalMatches: 0
    };
    
    Object.entries(STATE.dataCache).forEach(([source, rows]) => {
        if (!rows || rows.length === 0) return;
        
        results.exact[source] = [];
        results.partial[source] = [];
        
        // Búsqueda especializada por fuente
        if (source === 'mne') {
            searchMNE(rows, results, source);
        } else if (source === 'cancelado') {
            searchCANCELADO(rows, results, source);
        } else {
            searchGeneric(rows, results, source);
        }
        
        // Contar resultados
        const exactCount = results.exact[source].length;
        const partialCount = results.partial[source].length;
        
        if (exactCount > 0 || partialCount > 0) {
            results.sourceCount++;
            results.totalMatches += exactCount + partialCount;
            results.hasResults = true;
        }
    });
    
    return results;
}

// Búsqueda genérica con fuzzy matching
function searchGeneric(rows, results, sourceName) {
    const query = results.query;
    const variations = results.variations;
    const baseCode = results.baseCode;
    
    rows.forEach((row, index) => {
        if (index === 0) return; // Skip header
        
        let matchType = null;
        let similarity = 0;
        
        // Buscar en todas las celdas
        for (let i = 0; i < row.length; i++) {
            const cell = row[i];
            if (!cell) continue;
            
            const cellUpper = cell.toString().toUpperCase();
            const cellNormalized = normalizeCode(cell);
            
            // Coincidencia exacta
            if (cellNormalized === query || variations.includes(cellNormalized)) {
                matchType = 'exact';
                similarity = 100;
                break;
            }
            
            // Coincidencia de código base
            if (baseCode && cellNormalized.includes(baseCode)) {
                matchType = 'exact';
                similarity = 90;
                break;
            }
            
            // Coincidencia parcial
            if (cellUpper.includes(query)) {
                if (!matchType) {
                    matchType = 'partial';
                    similarity = calculateSimilarity(query, cellUpper);
                }
            }
        }
        
        if (matchType === 'exact') {
            results.exact[sourceName].push({ row, similarity, index });
        } else if (matchType === 'partial' && similarity >= CONFIG.SIMILARITY_THRESHOLD) {
            if (results.partial[sourceName].length < CONFIG.MAX_RESULTS) {
                results.partial[sourceName].push({ row, similarity, index });
            }
        }
    });
    
    // Ordenar por similitud
    results.partial[sourceName].sort((a, b) => b.similarity - a.similarity);
}

// Búsqueda especializada para MNE (columnas 3 y 5)
function searchMNE(rows, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    const searchIndices = [3, 5]; // OBC 出库单, Código 货号
    
    rows.forEach((row, index) => {
        if (index === 0 || !row || row.length < 6) return;
        
        let isMatch = false;
        
        for (const idx of searchIndices) {
            const cell = row[idx];
            if (!cell) continue;
            
            const cellUpper = cell.toString().toUpperCase();
            const cellNormalized = normalizeCode(cell);
            
            if (cellNormalized === query || cellUpper.includes(query)) {
                isMatch = true;
                break;
            }
            
            if (baseCode && cellNormalized.includes(baseCode)) {
                isMatch = true;
                break;
            }
        }
        
        if (isMatch) {
            results.exact[sourceName].push({ row, similarity: 100, index });
        }
    });
}

// Búsqueda especializada para CANCELADO (columnas 1 y 2)
function searchCANCELADO(rows, results, sourceName) {
    const query = results.query;
    const baseCode = results.baseCode;
    const searchIndices = [1, 2]; // CODIGO 1, ORDEN
    
    rows.forEach((row, index) => {
        if (index === 0 || !row || row.length < 3) return;
        
        let isMatch = false;
        
        for (const idx of searchIndices) {
            const cell = row[idx];
            if (!cell) continue;
            
            const cellUpper = cell.toString().toUpperCase();
            const cellNormalized = normalizeCode(cell);
            
            if (cellNormalized === query || cellUpper.includes(query)) {
                isMatch = true;
                break;
            }
            
            if (baseCode && cellNormalized.includes(baseCode)) {
                isMatch = true;
                break;
            }
        }
        
        if (isMatch) {
            results.exact[sourceName].push({ row, similarity: 100, index });
        }
    });
}

// Calcular similitud entre dos strings
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 100;
    
    const editDistance = levenshteinDistance(shorter, longer);
    return ((longer.length - editDistance) / longer.length) * 100;
}

// Distancia de Levenshtein para fuzzy matching
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

// ==================== VISUALIZACIÓN DE RESULTADOS ====================
function displayResults(results, searchCode) {
    document.getElementById('no-results').classList.add('hidden');
    document.getElementById('results-container').classList.remove('hidden');

    // KPI Cards
    const kpiCards = document.getElementById('kpi-cards');
    kpiCards.innerHTML = `
        <div class="kpi-card orden" onclick="copyToClipboard('${searchCode}')" style="cursor: pointer;" title="Click para copiar">
            <div class="kpi-card-label">🔍 Código Buscado</div>
            <div class="kpi-card-value">${searchCode}</div>
        </div>
        <div class="kpi-card destino">
            <div class="kpi-card-label">📊 Fuentes</div>
            <div class="kpi-card-value">${results.sourceCount}</div>
        </div>
        <div class="kpi-card estatus">
            <div class="kpi-card-label">✅ Coincidencias</div>
            <div class="kpi-card-value">${results.totalMatches}</div>
        </div>
        <div class="kpi-card trs">
            <div class="kpi-card-label">🎯 Exactas</div>
            <div class="kpi-card-value">${countExactMatches(results)}</div>
        </div>
        <div class="kpi-card rastreo">
            <div class="kpi-card-label">🔎 Parciales</div>
            <div class="kpi-card-value">${countPartialMatches(results)}</div>
        </div>
    `;

    // Tabla de detalles
    const detailsBody = document.getElementById('details-body');
    let html = '';
    
    // Mostrar coincidencias exactas primero
    Object.entries(results.exact).forEach(([source, matches]) => {
        if (matches.length === 0) return;
        
        html += `<tr style="background: #e8f5e9;"><td colspan="2"><strong style="color: var(--success);">✅ ${getSourceDisplayName(source)} (${matches.length} exactas)</strong></td></tr>`;
        
        matches.slice(0, 10).forEach((match, idx) => {
            const rowData = formatRowData(match.row, source);
            html += `
                <tr>
                    <td style="font-weight: 600;">#${idx + 1}</td>
                    <td>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>${rowData}</span>
                            <button onclick="copyRowData('${escapeHtml(rowData)}')" class="btn btn-small" style="padding: 4px 8px; font-size: 0.8em;">📋</button>
                        </div>
                    </td>
                </tr>
            `;
        });
        
        if (matches.length > 10) {
            html += `<tr><td colspan="2" style="color: #666; font-style: italic;">... y ${matches.length - 10} más</td></tr>`;
        }
    });
    
    // Mostrar coincidencias parciales
    Object.entries(results.partial).forEach(([source, matches]) => {
        if (matches.length === 0) return;
        
        html += `<tr style="background: #fff3e0;"><td colspan="2"><strong style="color: var(--warning);">🔎 ${getSourceDisplayName(source)} (${matches.length} parciales)</strong></td></tr>`;
        
        matches.slice(0, 5).forEach((match, idx) => {
            const rowData = formatRowData(match.row, source);
            html += `
                <tr>
                    <td style="font-weight: 600;">#${idx + 1} (${Math.round(match.similarity)}%)</td>
                    <td>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span>${rowData}</span>
                            <button onclick="copyRowData('${escapeHtml(rowData)}')" class="btn btn-small" style="padding: 4px 8px; font-size: 0.8em;">📋</button>
                        </div>
                    </td>
                </tr>
            `;
        });
        
        if (matches.length > 5) {
            html += `<tr><td colspan="2" style="color: #666; font-style: italic;">... y ${matches.length - 5} más</td></tr>`;
        }
    });
    
    if (html === '') {
        html = '<tr><td colspan="2" style="text-align: center; color: #999;">No hay resultados para mostrar</td></tr>';
    }
    
    detailsBody.innerHTML = html;
}

function countExactMatches(results) {
    let count = 0;
    Object.values(results.exact).forEach(matches => count += matches.length);
    return count;
}

function countPartialMatches(results) {
    let count = 0;
    Object.values(results.partial).forEach(matches => count += matches.length);
    return count;
}

function getSourceDisplayName(source) {
    const names = {
        bdstock: 'BD Stock',
        obcbd: 'OBC BD',
        validacion: 'Validación',
        inventario: 'Inventario',
        mne: 'MNE',
        trs: 'TRS',
        cancelado: 'Cancelado'
    };
    return names[source] || source.toUpperCase();
}

function formatRowData(row, source) {
    if (!row || row.length === 0) return '-';
    
    // Formatear según la fuente
    const relevantData = row.slice(0, 6).filter(cell => cell && cell.toString().trim());
    return relevantData.join(' | ');
}

function escapeHtml(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function copyRowData(data) {
    const unescaped = data.replace(/\\'/g, "'");
    copyToClipboard(unescaped);
}

function hideResults() {
    document.getElementById('results-container').classList.add('hidden');
    document.getElementById('no-results').classList.remove('hidden');
}

function toggleSection(sectionId) {
    const content = document.getElementById(`content-${sectionId}`);
    const toggle = document.getElementById(`toggle-${sectionId}`);
    
    content.classList.toggle('collapsed');
    toggle.textContent = content.classList.contains('collapsed') ? '▶️' : '🔽';
}

// ==================== FUNCIONES DE UTILIDAD ====================
function refreshDatabase() {
    if (confirm('¿Recargar base de datos? Esto puede tardar unos segundos.')) {
        loadDatabase();
    }
}

function exportResults() {
    if (!STATE.currentResult || !STATE.currentResult.hasResults) {
        showNotification('⚠️ No hay resultados para exportar', 'warning');
        return;
    }
    
    const headers = ['FUENTE', 'TIPO', 'SIMILITUD', 'DATOS'];
    const rows = [];
    
    // Exportar coincidencias exactas
    Object.entries(STATE.currentResult.exact).forEach(([source, matches]) => {
        matches.forEach(match => {
            rows.push([
                getSourceDisplayName(source),
                'EXACTA',
                '100%',
                match.row.join(' | ')
            ]);
        });
    });
    
    // Exportar coincidencias parciales
    Object.entries(STATE.currentResult.partial).forEach(([source, matches]) => {
        matches.forEach(match => {
            rows.push([
                getSourceDisplayName(source),
                'PARCIAL',
                `${Math.round(match.similarity)}%`,
                match.row.join(' | ')
            ]);
        });
    });
    
    const csvContent = arrayToCSV([headers, ...rows]);
    downloadCSV(csvContent, `track_${STATE.currentSearch}_${getCurrentDate()}.csv`);
    showNotification('✅ Resultados exportados', 'success');
}

function printResults() {
    if (!STATE.currentResult || !STATE.currentResult.hasResults) {
        showNotification('⚠️ No hay resultados para imprimir', 'warning');
        return;
    }
    
    window.print();
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    container.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function showLoading(show) {
    document.getElementById('loading-overlay').classList.toggle('show', show);
}

// ==================== MODO OFFLINE ====================
function setupOfflineMode() {
    // Detectar cambios en conexión
    window.addEventListener('online', () => {
        STATE.isOnline = true;
        updateOfflineIndicator();
        showNotification('✅ Conexión restaurada', 'success');
        // Intentar recargar BD automáticamente
        loadDatabase();
    });
    
    window.addEventListener('offline', () => {
        STATE.isOnline = false;
        updateOfflineIndicator();
        showNotification('⚠️ Sin conexión - Usando datos en caché', 'warning');
    });
    
    updateOfflineIndicator();
}

function updateOfflineIndicator() {
    const indicator = document.getElementById('offline-indicator');
    if (indicator) {
        indicator.style.display = STATE.isOnline ? 'none' : 'inline-block';
    }
}

function saveToLocalStorage() {
    try {
        const data = {
            dataCache: STATE.dataCache,
            lastUpdate: STATE.lastUpdate?.toISOString(),
            timestamp: Date.now()
        };
        localStorage.setItem('wms_track_cache', JSON.stringify(data));
    } catch (e) {
        console.error('Error saving to localStorage:', e);
    }
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem('wms_track_cache');
        if (!saved) return false;
        
        const data = JSON.parse(saved);
        
        // Verificar que no sea muy antiguo (más de 24 horas)
        const age = Date.now() - data.timestamp;
        if (age > 24 * 60 * 60 * 1000) {
            console.warn('Cached data too old');
            return false;
        }
        
        STATE.dataCache = data.dataCache;
        STATE.lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;
        
        const totalRows = Object.values(STATE.dataCache).reduce((sum, rows) => sum + rows.length, 0);
        console.log(`Loaded ${totalRows} rows from cache`);
        
        return true;
    } catch (e) {
        console.error('Error loading from localStorage:', e);
        return false;
    }
}

function updateDbStatus(message) {
    const statusEl = document.getElementById('db-status');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

// ==================== ESTADÍSTICAS ====================
function loadStatistics() {
    try {
        const saved = localStorage.getItem('wms_track_statistics');
        if (saved) {
            const stats = JSON.parse(saved);
            STATE.statistics = { ...STATE.statistics, ...stats };
        }
    } catch (e) {
        console.error('Error loading statistics:', e);
    }
}

function saveStatistics() {
    try {
        localStorage.setItem('wms_track_statistics', JSON.stringify(STATE.statistics));
    } catch (e) {
        console.error('Error saving statistics:', e);
    }
}

function showStatistics() {
    const successRate = STATE.statistics.totalSearches > 0 
        ? ((STATE.statistics.successfulSearches / STATE.statistics.totalSearches) * 100).toFixed(1)
        : 0;
    
    const topSources = Object.entries(STATE.statistics.sourcesUsed)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const lastSearch = STATE.statistics.lastSearchDate 
        ? new Date(STATE.statistics.lastSearchDate).toLocaleString()
        : 'Nunca';
    
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 500px;">
            <div class="popup-header">
                <span>📊 Estadísticas de Uso</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <div style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 15px; color: var(--primary);">Búsquedas Realizadas</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--info);">${STATE.statistics.totalSearches}</div>
                        <div style="font-size: 0.9em; color: #666;">Total</div>
                    </div>
                    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--success);">${STATE.statistics.successfulSearches}</div>
                        <div style="font-size: 0.9em; color: #666;">Exitosas</div>
                    </div>
                    <div style="background: #ffebee; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--error);">${STATE.statistics.failedSearches}</div>
                        <div style="font-size: 0.9em; color: #666;">Fallidas</div>
                    </div>
                    <div style="background: #fff3e0; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--warning);">${successRate}%</div>
                        <div style="font-size: 0.9em; color: #666;">Tasa de Éxito</div>
                    </div>
                </div>
                
                <h3 style="margin: 20px 0 15px; color: var(--primary);">Fuentes Más Usadas</h3>
                <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; font-size: 0.9em;">
                    ${topSources.length > 0 ? topSources.map(([source, count]) => `
                        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                            <span>${getSourceDisplayName(source)}:</span>
                            <strong>${count} búsquedas</strong>
                        </div>
                    `).join('') : '<div style="color: #999; text-align: center;">No hay datos aún</div>'}
                </div>
                
                <div style="margin-top: 15px; padding: 10px; background: #f9f9f9; border-radius: 6px; font-size: 0.85em; color: #666;">
                    <div>🕐 Última búsqueda: <strong>${lastSearch}</strong></div>
                    <div>📦 Registros en BD: <strong>${Object.values(STATE.dataCache).reduce((sum, rows) => sum + rows.length, 0).toLocaleString()}</strong></div>
                    <div>🔄 Última actualización: <strong>${STATE.lastUpdate ? STATE.lastUpdate.toLocaleString() : 'Sin actualizar'}</strong></div>
                </div>
            </div>
            <div class="popup-buttons">
                <button class="btn btn-secondary btn-full" onclick="resetStatistics(); this.closest('.popup-overlay').remove();">
                    🔄 Reiniciar Estadísticas
                </button>
                <button class="btn btn-primary btn-full" onclick="this.closest('.popup-overlay').remove();">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function resetStatistics() {
    if (confirm('¿Reiniciar todas las estadísticas?')) {
        STATE.statistics = {
            totalSearches: 0,
            successfulSearches: 0,
            failedSearches: 0,
            lastSearchDate: null,
            sourcesUsed: {}
        };
        saveStatistics();
        showNotification('✅ Estadísticas reiniciadas', 'success');
    }
}

// ==================== INICIALIZACIÓN ====================
window.addEventListener('load', initializeApp);
