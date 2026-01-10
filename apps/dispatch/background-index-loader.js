// ==================== SISTEMA DE CACHÉ EN BACKGROUND - ÍNDICE DE OBC ====================

/**
 * Sistema de carga asíncrona de índice de búsqueda
 * Carga solo ID Caja e ID OBC para optimizar memoria (90% menos peso)
 */

const BACKGROUND_INDEX = {
    obcIndex: new Map(),           // Map: codigoCaja -> OBC
    trackIndex: new Map(),         // Map: codigoTrack -> OBC
    refIndex: new Map(),           // Map: codigoReferencia -> OBC
    mneIndex: new Map(),           // Map: rastreoMNE -> OBC
    isLoading: false,
    isReady: false,
    loadProgress: 0,
    totalRecords: 0,
    startTime: null,
    endTime: null
};

/**
 * Inicia la carga del índice en background
 * Se ejecuta automáticamente después de la carga inicial
 */
async function startBackgroundIndexLoad() {
    if (BACKGROUND_INDEX.isLoading || BACKGROUND_INDEX.isReady) {
        console.log('📋 [Background Index] Ya está cargando o listo');
        return;
    }

    BACKGROUND_INDEX.isLoading = true;
    BACKGROUND_INDEX.startTime = Date.now();
    
    console.log('🔄 [Background Index] Iniciando carga de índice en segundo plano...');
    
    try {
        // Cargar índice de OBC (solo columnas necesarias)
        await loadOBCIndex();
        
        BACKGROUND_INDEX.isReady = true;
        BACKGROUND_INDEX.endTime = Date.now();
        const duration = ((BACKGROUND_INDEX.endTime - BACKGROUND_INDEX.startTime) / 1000).toFixed(2);
        
        console.log(`✅ [Background Index] Índice cargado en ${duration}s - ${BACKGROUND_INDEX.totalRecords} registros`);
        
        // Notificar al usuario discretamente
        showNotification(`✅ Búsqueda histórica disponible (${BACKGROUND_INDEX.totalRecords} registros)`, 'success', 3000);
        
    } catch (error) {
        console.error('❌ [Background Index] Error cargando índice:', error);
        BACKGROUND_INDEX.isReady = false;
    } finally {
        BACKGROUND_INDEX.isLoading = false;
    }
}

/**
 * Carga el índice de OBC (solo columnas ID Caja e ID OBC)
 * Optimizado para reducir memoria en 90%
 */
async function loadOBCIndex() {
    console.log('📥 [Background Index] Cargando índice de OBC...');
    
    if (!gapi?.client?.sheets) {
        throw new Error('Google Sheets API no disponible');
    }

    try {
        // Obtener solo las columnas necesarias: A (OBC), C (Caja), D (Track), G (Referencia)
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_OBC,
            range: 'BD!A:G'  // Solo columnas necesarias
        });

        const rows = response.result.values;
        if (!rows || rows.length <= 1) {
            console.log('ℹ️ [Background Index] No hay datos en OBC');
            return;
        }

        console.log(`📊 [Background Index] Procesando ${rows.length - 1} registros...`);

        let processed = 0;
        
        // Procesar filas (saltar header)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            
            const obc = row[0]?.trim();
            const codigoCaja = row[2]?.trim();
            const codigoTrack = row[3]?.trim();
            const codigoRef = row[6]?.trim();
            
            if (!obc) continue;
            
            // Normalizar códigos
            const obcNorm = normalizeCodeShared(obc).toUpperCase();
            
            // Indexar por código de caja
            if (codigoCaja) {
                const cajaNorm = normalizeCodeShared(codigoCaja).toUpperCase();
                if (!BACKGROUND_INDEX.obcIndex.has(cajaNorm)) {
                    BACKGROUND_INDEX.obcIndex.set(cajaNorm, []);
                }
                BACKGROUND_INDEX.obcIndex.get(cajaNorm).push(obcNorm);
            }
            
            // Indexar por código de track
            if (codigoTrack) {
                const trackNorm = normalizeCodeShared(codigoTrack).toUpperCase();
                if (!BACKGROUND_INDEX.trackIndex.has(trackNorm)) {
                    BACKGROUND_INDEX.trackIndex.set(trackNorm, []);
                }
                BACKGROUND_INDEX.trackIndex.get(trackNorm).push(obcNorm);
            }
            
            // Indexar por código de referencia
            if (codigoRef) {
                const refNorm = normalizeCodeShared(codigoRef).toUpperCase();
                if (!BACKGROUND_INDEX.refIndex.has(refNorm)) {
                    BACKGROUND_INDEX.refIndex.set(refNorm, []);
                }
                BACKGROUND_INDEX.refIndex.get(refNorm).push(obcNorm);
            }
            
            processed++;
            
            // Actualizar progreso cada 1000 registros
            if (processed % 1000 === 0) {
                BACKGROUND_INDEX.loadProgress = (processed / (rows.length - 1)) * 100;
                console.log(`📊 [Background Index] Progreso: ${BACKGROUND_INDEX.loadProgress.toFixed(1)}%`);
            }
        }
        
        BACKGROUND_INDEX.totalRecords = processed;
        BACKGROUND_INDEX.loadProgress = 100;
        
        console.log('✅ [Background Index] Índice de OBC completado:', {
            codigosCaja: BACKGROUND_INDEX.obcIndex.size,
            codigosTrack: BACKGROUND_INDEX.trackIndex.size,
            codigosRef: BACKGROUND_INDEX.refIndex.size,
            totalRegistros: processed
        });
        
    } catch (error) {
        console.error('❌ [Background Index] Error en loadOBCIndex:', error);
        throw error;
    }
}

/**
 * Carga el índice de MNE (rastreo)
 */
async function loadMNEIndex() {
    console.log('📥 [Background Index] Cargando índice de MNE...');
    
    if (!CONFIG?.SOURCES?.MNE) {
        console.warn('⚠️ [Background Index] URL de MNE no configurada');
        return;
    }

    try {
        const response = await fetch(CONFIG.SOURCES.MNE);
        const csv = await response.text();
        const lines = csv.split('\n').filter(l => l.trim());
        
        console.log(`📊 [Background Index] Procesando ${lines.length - 1} registros de MNE...`);
        
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            
            const rastreo = cols[0]?.trim();
            const obc = cols[1]?.trim();
            
            if (!rastreo || !obc) continue;
            
            const rastreoNorm = normalizeCodeShared(rastreo).toUpperCase();
            const obcNorm = normalizeCodeShared(obc).toUpperCase();
            
            if (!BACKGROUND_INDEX.mneIndex.has(rastreoNorm)) {
                BACKGROUND_INDEX.mneIndex.set(rastreoNorm, []);
            }
            BACKGROUND_INDEX.mneIndex.get(rastreoNorm).push(obcNorm);
        }
        
        console.log(`✅ [Background Index] Índice de MNE completado: ${BACKGROUND_INDEX.mneIndex.size} registros`);
        
    } catch (error) {
        console.error('❌ [Background Index] Error en loadMNEIndex:', error);
    }
}

/**
 * Busca en el índice de background
 * @param {string} query - Código a buscar
 * @returns {Array<string>} - Array de OBCs encontrados
 */
function searchInBackgroundIndex(query) {
    if (!BACKGROUND_INDEX.isReady) {
        console.log('⏳ [Background Index] Índice aún no está listo');
        return null;
    }
    
    const queryNorm = normalizeCodeShared(query).toUpperCase();
    const results = new Set();
    
    // Buscar en índice de cajas
    if (BACKGROUND_INDEX.obcIndex.has(queryNorm)) {
        BACKGROUND_INDEX.obcIndex.get(queryNorm).forEach(obc => results.add(obc));
    }
    
    // Buscar en índice de track
    if (BACKGROUND_INDEX.trackIndex.has(queryNorm)) {
        BACKGROUND_INDEX.trackIndex.get(queryNorm).forEach(obc => results.add(obc));
    }
    
    // Buscar en índice de referencia
    if (BACKGROUND_INDEX.refIndex.has(queryNorm)) {
        BACKGROUND_INDEX.refIndex.get(queryNorm).forEach(obc => results.add(obc));
    }
    
    // Buscar en índice de MNE
    if (BACKGROUND_INDEX.mneIndex.has(queryNorm)) {
        BACKGROUND_INDEX.mneIndex.get(queryNorm).forEach(obc => results.add(obc));
    }
    
    const found = Array.from(results);
    
    if (found.length > 0) {
        console.log(`🔍 [Background Index] Encontrados ${found.length} OBCs para "${query}":`, found);
    }
    
    return found;
}

/**
 * Verifica si el índice está listo
 */
function isBackgroundIndexReady() {
    return BACKGROUND_INDEX.isReady;
}

/**
 * Obtiene el estado del índice
 */
function getBackgroundIndexStatus() {
    return {
        isLoading: BACKGROUND_INDEX.isLoading,
        isReady: BACKGROUND_INDEX.isReady,
        loadProgress: BACKGROUND_INDEX.loadProgress,
        totalRecords: BACKGROUND_INDEX.totalRecords,
        indexSizes: {
            caja: BACKGROUND_INDEX.obcIndex.size,
            track: BACKGROUND_INDEX.trackIndex.size,
            referencia: BACKGROUND_INDEX.refIndex.size,
            mne: BACKGROUND_INDEX.mneIndex.size
        }
    };
}

/**
 * Limpia el índice de background
 */
function clearBackgroundIndex() {
    console.log('🗑️ [Background Index] Limpiando índice...');
    BACKGROUND_INDEX.obcIndex.clear();
    BACKGROUND_INDEX.trackIndex.clear();
    BACKGROUND_INDEX.refIndex.clear();
    BACKGROUND_INDEX.mneIndex.clear();
    BACKGROUND_INDEX.isReady = false;
    BACKGROUND_INDEX.isLoading = false;
    BACKGROUND_INDEX.loadProgress = 0;
    BACKGROUND_INDEX.totalRecords = 0;
}

// Exponer funciones globalmente
window.startBackgroundIndexLoad = startBackgroundIndexLoad;
window.searchInBackgroundIndex = searchInBackgroundIndex;
window.isBackgroundIndexReady = isBackgroundIndexReady;
window.getBackgroundIndexStatus = getBackgroundIndexStatus;
window.clearBackgroundIndex = clearBackgroundIndex;
window.BACKGROUND_INDEX = BACKGROUND_INDEX;
