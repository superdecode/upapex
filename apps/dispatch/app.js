// ==================== CONFIGURATION ====================
const CONFIG = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
    SPREADSHEET_WRITE: '1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o',
    // Spreadsheet ID principal para consolidación de órdenes
    SPREADSHEET_ORDENES_ID: '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck',
    // Spreadsheet OBC para Background Index (mismo que ORDENES_ID)
    SPREADSHEET_OBC: '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck',
    SOURCES: {
        // Pestaña "BD" - Base de datos completa de cajas (fuente principal) - IGUAL QUE TRACK OBC_BD
        BD_CAJAS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSdSDQ8ktYA3YAsWMUokYd_S6_rANUz8XdfEAjsV-v0eAlfiYZctHuj3hP4m3wOghf4rnT_YvuA4BPA/pub?output=csv',
        // Sistema de Validación de Surtido - IGUAL QUE TRACK
        VALIDACION: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZMZZCDtTFCebvsme1GMEBiZ1S2Cloh37AR8hHFAwhFPNEMD27G04bzX0theCMJE-nlYOyH2ev115q/pub?output=csv',
        // Rastreo MNE - IGUAL QUE TRACK
        MNE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRHzXpt4q7KYo8QMnrO92LGcXQbx14lBCQ0wxHGHm2Lz4v5RCJCpQHmS0NhUTHUCCG2Hc1bkvTYhdpz/pub?gid=883314398&single=true&output=csv',
        // TRS Etiquetado - IGUAL QUE TRACK
        TRS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ2NOvCCzIW0IS9ANzOYl7GKBq5I-XQM9e_V1tu_2VrDMq4Frgjol5uj6-4dBgEQcfB8b-k6ovaOJGc/pub?output=csv',
        // Conductores y Unidades
        LISTAS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbzg922y1KMVnV0JqBijR43Ma8e5X_AO2KVzjHBnRtGBx-0aXLZ8UUlKCO_XHOpV1qfggQyNjtqde/pub?gid=799838428&single=true&output=csv'
    }
};

// ==================== STATE ====================
let STATE = {
    obcData: new Map(),
    bdCajasData: new Map(),    // NUEVO: Mapa de código → [cajas] desde BD (gid=0)
    obcDataFiltered: new Map(),
    validacionData: new Map(),
    mneData: new Map(),
    trsData: [],
    operadores: [],
    unidades: [],
    currentOrder: null,
    exceptionOrder: null,  // Orden para caso de excepción de fecha
    dateFilter: {
        startDate: null,
        endDate: null,
        active: false
    },
    pendingSync: [],
    // Tabs de validación
    localValidated: [],    // Despachos validados localmente
    localPending: [],      // Despachos pendientes
    activeTab: 'pending',  // Tab activa: 'pending' o 'validated'
    // Real-time sync system
    isOnline: navigator.onLine,
    isReadOnly: false,
    syncInterval: null,
    lastSyncTime: null,
    syncInProgress: false,
    remoteValidacionData: new Map(),  // Remote validation data for real-time sync
    remoteFoliosData: new Map(),      // Remote folios data for real-time sync
    dataVersion: 0,  // Version counter for conflict resolution
    // Sistema de folios de carga
    // Map: fecha → Map(folio → {conductor, unidad})
    // Ejemplo: "2025-12-30" → Map("01" → {conductor: "Juan", unidad: "T-001"})
    foliosDeCargas: new Map(),
    isLoading: false,
    loadingProgress: 0,
    // CHANGE 5: Advanced filter system state
    // selectedValues now stores objects: {criterion, value}
    advancedFilters: {
        orders: {
            criterion: '',
            selectedValues: [] // Array of {criterion, value}
        },
        validated: {
            criterion: '',
            selectedValues: [] // Array of {criterion, value}
        },
        folios: {
            criterion: '',
            selectedValues: [] // Array of {criterion, value}
        },
        'folio-details': {
            criterion: '',
            selectedValues: [] // Array of {criterion, value}
        },
        'folios-mgmt': {
            criterion: '',
            selectedValues: [] // Array of {criterion, value}
        }
    },
    currentFolio: null, // Current folio being viewed in details screen
    // Filter persistence across tabs
    filterPersistence: {
        pending: '',      // Search filter for pending tab
        validated: '',    // Search filter for validated tab
        otros: '',        // Search filter for otros tab
        folios: ''        // Search filter for folios tab
    }
};

// ==================== SYNC MANAGER GLOBALS ====================
let syncManager = null;
let dispatchSyncManager = null;

// ==================== CONNECTION & OFFLINE MODE ====================

// Initialize connection monitoring
function initializeConnectionMonitoring() {
    // Update online status
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Check initial state
    updateConnectionStatus();
}

function handleOnline() {
    STATE.isOnline = true;
    STATE.isReadOnly = false;
    updateConnectionStatus();
    showNotification('🟢 Conexión restaurada - Modo edición activado', 'success');
    
    // Start real-time sync
    startRealtimeSync();
    
    // Sync pending changes
    if (STATE.pendingSync.length > 0) {
        syncPendingChanges();
    }
}

function handleOffline() {
    STATE.isOnline = false;
    STATE.isReadOnly = true;
    updateConnectionStatus();
    showNotification('🔴 Sin conexión - Modo solo lectura', 'warning');
    
    // Stop real-time sync
    stopRealtimeSync();
}

function updateConnectionStatus() {
    const banner = document.getElementById('connection-banner');
    if (!banner) return;
    
    banner.className = 'connection-banner';
    
    if (!STATE.isOnline) {
        banner.classList.add('offline');
        banner.textContent = '🔴 SIN CONEXIÓN - Modo Solo Lectura (Consulta permitida, edición deshabilitada)';
    } else if (STATE.syncInProgress) {
        banner.classList.add('syncing');
        banner.textContent = '🔄 Sincronizando datos...';
    } else if (STATE.lastSyncTime) {
        banner.classList.add('online');
        const timeAgo = getTimeAgo(STATE.lastSyncTime);
        banner.textContent = `🟢 Conectado - Última sincronización: ${timeAgo}`;
        // Auto-hide after 3 seconds
        setTimeout(() => {
            if (STATE.isOnline && !STATE.syncInProgress) {
                banner.style.display = 'none';
            }
        }, 3000);
    }
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'hace unos segundos';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    return `hace ${hours} hora${hours > 1 ? 's' : ''}`;
}

// Cargar estado local al inicio
function loadLocalState() {
    try {
        const saved = localStorage.getItem('dispatch_local_state');
        if (saved) {
            const data = JSON.parse(saved);
            STATE.localValidated = data.localValidated || [];
            STATE.localPending = data.localPending || [];
            STATE.dataVersion = data.dataVersion || 0;

            // Cargar folios de carga (convertir de objeto a Map anidado)
            // Estructura: fecha → Map(folio → {conductor, unidad})
            if (data.foliosDeCargas) {
                STATE.foliosDeCargas = new Map();
                Object.entries(data.foliosDeCargas).forEach(([fecha, foliosObj]) => {
                    const foliosMap = new Map();
                    Object.entries(foliosObj).forEach(([folio, info]) => {
                        foliosMap.set(folio, info);
                    });
                    STATE.foliosDeCargas.set(fecha, foliosMap);
                });
            }
        }
    } catch (e) {
        console.error('Error loading local state:', e);
    }
}

function saveLocalState() {
    try {
        // Convertir Map anidado a objeto para JSON
        // Estructura: fecha → Map(folio → {conductor, unidad})
        const foliosObj = {};
        STATE.foliosDeCargas.forEach((foliosMap, fecha) => {
            const foliosDelDiaObj = {};
            foliosMap.forEach((info, folio) => {
                foliosDelDiaObj[folio] = info;
            });
            foliosObj[fecha] = foliosDelDiaObj;
        });

        localStorage.setItem('dispatch_local_state', JSON.stringify({
            localValidated: STATE.localValidated,
            localPending: STATE.localPending,
            foliosDeCargas: foliosObj,
            dataVersion: STATE.dataVersion,
            lastSyncTime: STATE.lastSyncTime
        }));
    } catch (e) {
        console.error('Error saving local state:', e);
    }
}

// ==================== REAL-TIME SYNC SYSTEM ====================

// Start real-time sync for transactional data (validacion, folios)
function startRealtimeSync() {
    if (STATE.syncInterval) {
        clearInterval(STATE.syncInterval);
    }
    
    // Sync every 30 seconds for real-time collaboration
    STATE.syncInterval = setInterval(async () => {
        if (STATE.isOnline && !STATE.syncInProgress) {
            console.log('🔄 [AUTO-SYNC] Sincronización automática cada 30s...');
            await syncTransactionalData();
        }
    }, 30000); // 30 segundos
    
    // Initial sync
    console.log('🔄 [AUTO-SYNC] Iniciando sincronización automática (intervalo: 30s)');
    syncTransactionalData();
}

function stopRealtimeSync() {
    if (STATE.syncInterval) {
        clearInterval(STATE.syncInterval);
        STATE.syncInterval = null;
    }
}

// ==================== LOAD EXISTING DATA FROM WRITE DATABASE ====================

/**
 * Load existing validated records from write database (with optional date filter)
 * @param {string} startDate - Optional start date filter (YYYY-MM-DD)
 * @param {string} endDate - Optional end date filter (YYYY-MM-DD)
 */
async function loadExistingValidatedRecords(startDate = null, endDate = null) {
    if (!gapi?.client?.sheets) {
        console.log('⚠️ Google Sheets API not available, skipping validated records load');
        return [];
    }

    try {
        console.log('📥 Loading validated records from write database...');
        
        // First, try to get sheet metadata to verify sheet name
        let sheetName = 'BD';  // Default to 'BD' as per syncManager config
        
        try {
            const metadataResponse = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: CONFIG.SPREADSHEET_WRITE
            });
            
            const sheets = metadataResponse.result.sheets;
            console.log('📋 Available sheets:', sheets.map(s => s.properties.title).join(', '));
            
            // Look for common sheet names
            const possibleNames = ['Despachos', 'BD', 'Sheet1', 'Hoja1'];
            for (const name of possibleNames) {
                if (sheets.find(s => s.properties.title === name)) {
                    sheetName = name;
                    console.log(`✅ Found sheet: ${sheetName}`);
                    break;
                }
            }
        } catch (metaError) {
            console.warn('Could not fetch sheet metadata, using default sheet name');
        }
        
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: `${sheetName}!A:R`  // Use detected sheet name (A-R for new columns)
        });

        const rows = response.result.values;
        if (!rows || rows.length <= 1) {
            console.log('ℹ️ No existing validated records found');
            return [];
        }

        // Parse rows (skip header) with optional date filtering
        const validatedRecords = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row.length >= 5) {  // Minimum required columns
                const record = {
                    folio: row[0] || '',           // A: Folio
                    fecha: row[1] || '',           // B: Fecha
                    hora: row[2] || '',            // C: Hora
                    usuario: row[3] || '',         // D: Usuario
                    orden: row[4] || '',           // E: Orden
                    destino: row[5] || '',         // F: Destino
                    horario: row[6] || '',         // G: Horario
                    codigo: row[7] || '',          // H: Código
                    codigo2: row[8] || '',         // I: Código 2
                    estatus: row[9] || '',         // J: Estatus
                    tarea: row[10] || '',          // K: Tarea
                    estatus2: row[11] || '',       // L: Estatus2
                    cantInicial: parseInt(row[12]) || 0,     // M: Cant Inicial (from OBC, read-only)
                    cantDespacho: parseInt(row[13]) || 0,    // N: Cant Despacho (manual input)
                    incidencias: row[14] || '',    // O: Incidencias
                    operador: row[15] || '',       // P: Operador
                    conductor: row[15] || '',      // Alias for operador
                    unidad: row[16] || '',         // Q: Unidad
                    observaciones: row[17] || '',  // R: Observaciones
                    notaDespacho: row[17] || '',   // Alias for observaciones
                    // Use cantDespacho as the primary field
                    cantidadDespachar: parseInt(row[13]) || 0
                };

                if (i <= 3) { // Log primeros 3 registros para debug
                    console.log(`📖 LECTURA BD row ${i}:`, {
                        orden: record.orden,
                        'M[12]-cantInicial': row[12],
                        'N[13]-cantDespacho': row[13],
                        'O[14]-incidencias': row[14],
                        'P[15]-operador': row[15],
                        'Q[16]-unidad': row[16],
                        'R[17]-observaciones': row[17]
                    });
                }

                if (record.orden) {
                    // Apply date filter if provided
                    if (startDate && endDate) {
                        const recordDate = record.fecha; // Format: DD/MM/YYYY
                        if (isDateInRange(recordDate, startDate, endDate)) {
                            validatedRecords.push(record);
                        }
                    } else {
                        validatedRecords.push(record);
                    }
                }
            }
        }

        // Update STATE with loaded records
        STATE.localValidated = validatedRecords;
        
        // Extract and rebuild folios map
        rebuildFoliosFromRecords(validatedRecords);
        
        console.log(`✅ Loaded ${validatedRecords.length} validated records (filtered: ${startDate ? 'YES' : 'NO'})`);
        
        // Save to local storage
        saveLocalState();
        
        return validatedRecords;
        
    } catch (error) {
        console.error('Error loading validated records:', error);
        throw error;
    }
}

/**
 * Check if a date string is within a range
 * @param {string} dateStr - Date in DD/MM/YYYY format
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 */
function isDateInRange(dateStr, startDate, endDate) {
    try {
        // Convert DD/MM/YYYY to YYYY-MM-DD
        const parts = dateStr.split('/');
        if (parts.length !== 3) return false;
        
        const isoDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        
        return isoDate >= startDate && isoDate <= endDate;
    } catch (error) {
        return false;
    }
}

/**
 * Parse cantidad despachar from incidencias field (legacy support)
 * Format: "Parcial: 5/10" -> 5
 * NOTE: This is now deprecated - cantDespacho (Column N) is the primary field
 */
function parseCantidadFromIncidencias(incidencias) {
    if (!incidencias) return 0;
    const match = incidencias.match(/Parcial:\s*(\d+)\/(\d+)/);
    if (match) {
        return parseInt(match[1]) || 0;
    }
    return 0;
}

/**
 * Rebuild folios map from validated records
 */
function rebuildFoliosFromRecords(records) {
    STATE.foliosDeCargas.clear();
    
    records.forEach(record => {
        if (!record.folio || !record.operador || !record.unidad) return;
        
        // Extract date and folio number from folio format: DSP-YYYYMMDD-XX
        const folioMatch = record.folio.match(/DSP-(\d{8})-(\d{2})/);
        if (!folioMatch) return;
        
        const dateStr = folioMatch[1];  // YYYYMMDD
        const folioNum = folioMatch[2]; // XX
        
        // Convert to date key format: YYYY-MM-DD
        const dateKey = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        
        // Add to folios map
        if (!STATE.foliosDeCargas.has(dateKey)) {
            STATE.foliosDeCargas.set(dateKey, new Map());
        }
        
        const foliosDelDia = STATE.foliosDeCargas.get(dateKey);
        if (!foliosDelDia.has(folioNum)) {
            foliosDelDia.set(folioNum, {
                conductor: record.operador,
                unidad: record.unidad
            });
        }
    });
    
    console.log(`📋 Rebuilt ${STATE.foliosDeCargas.size} days of folios from records`);
}

/**
 * Load existing folios (currently rebuilds from validated records)
 */
async function loadExistingFolios() {
    // Folios are already rebuilt from validated records
    // This function exists for future expansion if folios are stored separately
    console.log('✅ Folios loaded from validated records');
}

// ==================== LAZY LOADING WITH DATE FILTER ====================

/**
 * FLUJO CORRECTO DE CARGA:
 * 1. Input Fecha (startDate, endDate)
 * 2. Fetch OBC DB y filtrar por fecha de despacho (expectedArrival)
 * 3. Fetch registros validados desde SPREADSHEET_WRITE
 * 4. Cruzar OBC con validados para identificar cuáles ya fueron despachados
 * 5. Render final (pendientes vs validados)
 * 
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 */
async function lazyLoadDataByDate(startDate, endDate) {
    if (!startDate || !endDate) {
        showNotification('⚠️ Debes seleccionar un rango de fechas', 'warning');
        return;
    }

    // OPTIMIZACIÓN: Verificar si este rango ya fue cargado
    if (!needsDataLoad(startDate, endDate)) {
        console.log('⚡ [LAZY] Usando datos en caché, solo filtrando localmente...');
        filterOrdersByDateRange();
        showNotification('✅ Filtro aplicado (datos en caché)', 'success');
        return;
    }

    const TOTAL_STEPS = 5; // Incrementado para incluir carga de referencias
    
    try {
        console.log('\n========================================');
        console.log(`📅 INICIANDO CARGA DE DATOS`);
        console.log(`   Rango: ${startDate} a ${endDate}`);
        console.log('========================================\n');
        
        // ==================== STEP 1: Fetch OBC DB ====================
        showLoadingOverlay(true, 0, TOTAL_STEPS, '📦 Paso 1/4: Descargando base de órdenes OBC...');
        console.log('👉 PASO 1/4: Descargando BD_CAJAS (OBC orders database)...');
        
        let allOBCOrders = [];
        try {
            const bdCajasResponse = await fetch(CONFIG.SOURCES.BD_CAJAS);
            if (!bdCajasResponse.ok) {
                throw new Error(`HTTP error! status: ${bdCajasResponse.status}`);
            }
            const bdCajasCsv = await bdCajasResponse.text();
            allOBCOrders = parseOBCDataWithDateFilter(bdCajasCsv, startDate, endDate);
            console.log(`✅ PASO 1 COMPLETO: ${allOBCOrders.length} órdenes encontradas en el rango de fechas`);
        } catch (error) {
            console.error('Error loading BD_CAJAS:', error);
            throw new Error('No se pudo cargar la base de órdenes OBC');
        }
        
        if (allOBCOrders.length === 0) {
            showLoadingOverlay(false);
            showNotification('ℹ️ No se encontraron órdenes en el rango de fechas seleccionado', 'info');
            STATE.obcData.clear();
            STATE.obcDataFiltered.clear();
            STATE.localValidated = [];
            updateBdInfo();
            updateSummary();
            return;
        }
        
        // ==================== STEP 2: Fetch Validated Records from SPREADSHEET_WRITE ====================
        showLoadingOverlay(true, 1, TOTAL_STEPS, '📝 Paso 2/5: Cargando registros de despacho (BD Escritura)...');
        console.log('👉 PASO 2/5: Cargando registros validados desde SPREADSHEET_WRITE...');

        let validatedRecords = [];
        try {
            validatedRecords = await fetchValidatedRecordsFromWriteDB();
            console.log(`✅ PASO 2 COMPLETO: ${validatedRecords.length} registros de despacho encontrados`);
        } catch (error) {
            console.warn('Error loading validated records:', error);
            console.log('⚠️ Continuando sin registros validados...');
        }

        // ==================== STEP 3: Load VALIDACION and MNE in parallel (Critical Reference Data) ====================
        showLoadingOverlay(true, 2, TOTAL_STEPS, '📊 Paso 3/5: Cargando datos de Validación de Surtido y MNE en paralelo...');
        console.log('👉 PASO 3/5: Cargando VALIDACION y MNE en paralelo (datos críticos)...');

        const cacheBuster = Date.now();

        // Cargar VALIDACION y MNE en paralelo usando Promise.all
        await Promise.all([
            // VALIDACION
            (async () => {
                try {
                    let validacionCsv;
                    if (dispatchSyncManager) {
                        validacionCsv = await dispatchSyncManager.getReferenceData('validacion', CONFIG.SOURCES.VALIDACION, true);
                    } else {
                        const url = CONFIG.SOURCES.VALIDACION.includes('?')
                            ? `${CONFIG.SOURCES.VALIDACION}&_t=${cacheBuster}`
                            : `${CONFIG.SOURCES.VALIDACION}?_t=${cacheBuster}`;
                        const response = await fetch(url, { cache: 'no-store' });
                        validacionCsv = await response.text();
                    }
                    if (validacionCsv) parseValidacionData(validacionCsv);
                    console.log('✅ VALIDACION cargada en paralelo');
                    return { success: true, type: 'VALIDACION' };
                } catch (e) {
                    console.warn('⚠️ Error cargando VALIDACION:', e);
                    return { success: false, type: 'VALIDACION', error: e };
                }
            })(),

            // MNE
            (async () => {
                try {
                    let mneCsv;
                    if (dispatchSyncManager) {
                        mneCsv = await dispatchSyncManager.getReferenceData('mne', CONFIG.SOURCES.MNE, true);
                    } else {
                        const url = CONFIG.SOURCES.MNE.includes('?')
                            ? `${CONFIG.SOURCES.MNE}&_t=${cacheBuster}`
                            : `${CONFIG.SOURCES.MNE}?_t=${cacheBuster}`;
                        const response = await fetch(url, { cache: 'no-store' });
                        mneCsv = await response.text();
                    }
                    if (mneCsv) parseMNEData(mneCsv);
                    console.log('✅ MNE cargada en paralelo');
                    return { success: true, type: 'MNE' };
                } catch (e) {
                    console.warn('⚠️ Error cargando MNE:', e);
                    return { success: false, type: 'MNE', error: e };
                }
            })()
        ]);

        console.log('✅ PASO 3 COMPLETO: Datos de referencia críticos cargados en paralelo');

        // ==================== STEP 4: Cross-reference OBC with Validated ====================
        showLoadingOverlay(true, 3, TOTAL_STEPS, '🔄 Paso 4/5: Cruzando órdenes con registros validados...');
        console.log('👉 PASO 4/5: Cruzando órdenes OBC con registros validados...');

        const { pendingOrders, validatedOrders, validatedOBCSet } = crossReferenceOrders(allOBCOrders, validatedRecords);

        console.log(`✅ PASO 4 COMPLETO:`);
        console.log(`   - Órdenes pendientes: ${pendingOrders.length}`);
        console.log(`   - Órdenes validadas: ${validatedOrders.length}`);

        // ==================== STEP 5: Update STATE and Render ====================
        showLoadingOverlay(true, 4, TOTAL_STEPS, '✅ Paso 5/5: Preparando visualización...');
        console.log('👉 PASO 5/5: Actualizando estado y preparando render...');
        
        // Clear and populate STATE
        STATE.obcData.clear();
        STATE.obcDataFiltered.clear();
        STATE.localValidated = [];
        
        // Add ALL orders to obcData (for reference)
        allOBCOrders.forEach(order => {
            STATE.obcData.set(order.orden, order);
            STATE.obcDataFiltered.set(order.orden, order);
        });
        
        // Add validated records to localValidated
        STATE.localValidated = validatedOrders;
        
        // Mark validated orders in obcData
        validatedOBCSet.forEach(obcCode => {
            if (STATE.obcData.has(obcCode)) {
                const order = STATE.obcData.get(obcCode);
                order.isValidated = true;
            }
        });
        
        // Rebuild folios from validated records
        rebuildFoliosFromRecords(validatedOrders);

        console.log(`✅ PASO 5 COMPLETO: Estado actualizado`);

        // ==================== COMPLETE ====================
        showLoadingOverlay(true, 5, TOTAL_STEPS, '✅ Carga completada!');
        await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause to show completion
        showLoadingOverlay(false);
        
        const message = `✅ ${pendingOrders.length} pendientes, ${validatedOrders.length} validadas`;
        showNotification(message, 'success');
        
        // Update UI
        updateBdInfo();
        updateSummary();
        updateValidationBadges();
        updateTabBadges();
        
        // OPTIMIZACIÓN: Marcar este rango como cargado para evitar recargas
        markRangeAsLoaded(startDate, endDate);
        
        console.log('\n========================================');
        console.log('✅ CARGA COMPLETADA EXITOSAMENTE');
        console.log(`   - Total OBC: ${STATE.obcData.size}`);
        console.log(`   - Pendientes: ${pendingOrders.length}`);
        console.log(`   - Validadas: ${validatedOrders.length}`);
        console.log('========================================\n');
        
    } catch (error) {
        console.error('Error in lazy loading:', error);
        showLoadingOverlay(false);
        showNotification('❌ Error cargando datos: ' + error.message, 'error');
    }
}

/**
 * Parse OBC data from CSV and filter by date range
 * @param {string} csv - CSV content from BD_CAJAS
 * @param {string} startDate - Start date YYYY-MM-DD
 * @param {string} endDate - End date YYYY-MM-DD
 * @returns {Array} Array of orders within date range
 */
function parseOBCDataWithDateFilter(csv, startDate, endDate) {
    const lines = csv.split('\n').filter(l => l.trim());
    const orders = [];
    
    // Parse dates for comparison
    const startParts = startDate.split('-');
    const filterStartDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
    filterStartDate.setHours(0, 0, 0, 0);
    
    const endParts = endDate.split('-');
    const filterEndDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
    filterEndDate.setHours(23, 59, 59, 999);
    
    console.log(`🔍 Filtrando OBC por fecha: ${filterStartDate.toLocaleDateString('es-MX')} - ${filterEndDate.toLocaleDateString('es-MX')}`);
    
    // Also clear and rebuild bdCajasData for box codes
    STATE.bdCajasData.clear();
    const cajasCountMap = new Map();
    const allBoxCodes = new Map();
    
    let totalRows = 0;
    let matchedRows = 0;
    let sampleDates = [];
    
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        
        if (cols.length >= 9) {
            totalRows++;
            const obc = cols[0]?.trim();
            const expectedArrival = cols[4]?.trim(); // Column E: Expected Arrival (fecha de despacho)
            const codigo = cols[8]?.trim(); // Column I: Custom Barcode
            
            if (obc && expectedArrival) {
                // Parse the order date
                const orderDate = parseOrderDate(expectedArrival);
                
                // Sample dates for debugging (con hora)
                if (sampleDates.length < 5) {
                    const dateTimeStr = orderDate ? 
                        `${orderDate.toLocaleDateString('es-MX')} ${orderDate.toLocaleTimeString('es-MX', {hour: '2-digit', minute: '2-digit'})}` : 
                        'INVALID';
                    sampleDates.push(`${obc}: "${expectedArrival}" → ${dateTimeStr}`);
                }
                
                // Check if order is within date range
                if (orderDate && orderDate >= filterStartDate && orderDate <= filterEndDate) {
                    matchedRows++;
                    
                    // Count boxes per OBC
                    cajasCountMap.set(obc, (cajasCountMap.get(obc) || 0) + 1);
                    
                    // Index by box code
                    if (codigo) {
                        const codigoUpper = codigo.toUpperCase();
                        if (!allBoxCodes.has(codigoUpper)) {
                            allBoxCodes.set(codigoUpper, []);
                        }
                        allBoxCodes.get(codigoUpper).push({
                            obc: obc,
                            referenceNo: cols[1]?.trim() || '',
                            shippingService: cols[2]?.trim() || '',
                            trackingCode: cols[3]?.trim() || '',
                            expectedArrival: expectedArrival,
                            remark: cols[5]?.trim() || '',
                            recipient: cols[6]?.trim() || '',
                            boxType: cols[7]?.trim() || '',
                            codigoCaja: codigo
                        });
                    }
                }
            }
        }
    }
    
    console.log(`📊 Procesadas ${totalRows} filas, ${matchedRows} coinciden con el filtro`);
    console.log(`📅 Muestra de fechas:`, sampleDates);
    
    // Build unique orders array
    const uniqueOrders = new Map();
    
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        
        if (cols.length >= 9) {
            const obc = cols[0]?.trim();
            const expectedArrival = cols[4]?.trim();
            
            if (obc && expectedArrival && cajasCountMap.has(obc) && !uniqueOrders.has(obc)) {
                uniqueOrders.set(obc, {
                    orden: obc,
                    referenceNo: cols[1]?.trim() || '',
                    shippingService: cols[2]?.trim() || '',
                    trackingCode: cols[3]?.trim() || '',
                    expectedArrival: expectedArrival,
                    remark: cols[5]?.trim() || '',
                    recipient: cols[6]?.trim() || '',
                    boxType: cols[7]?.trim() || '',
                    customBarcode: cols[8]?.trim() || '',
                    totalCajas: cajasCountMap.get(obc) || 0,
                    isValidated: false
                });
            }
        }
    }
    
    // Update STATE.bdCajasData
    STATE.bdCajasData = allBoxCodes;
    
    console.log(`✅ ${uniqueOrders.size} órdenes únicas encontradas, ${STATE.bdCajasData.size} códigos de caja indexados`);
    
    return Array.from(uniqueOrders.values());
}

/**
 * Fetch validated records from SPREADSHEET_WRITE (Google Sheets API)
 * @returns {Array} Array of validated dispatch records
 */
async function fetchValidatedRecordsFromWriteDB() {
    if (!gapi?.client?.sheets) {
        console.log('⚠️ Google Sheets API not available');
        return [];
    }

    try {
        console.log(`📥 Fetching from SPREADSHEET_WRITE: ${CONFIG.SPREADSHEET_WRITE}`);
        
        // Get sheet metadata to find correct sheet name
        let sheetName = 'BD';
        
        try {
            const metadataResponse = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: CONFIG.SPREADSHEET_WRITE
            });
            
            const sheets = metadataResponse.result.sheets;
            console.log('📋 Hojas disponibles:', sheets.map(s => s.properties.title).join(', '));
            
            // Try common sheet names
            const possibleNames = ['Despachos', 'BD', 'Sheet1', 'Hoja1'];
            for (const name of possibleNames) {
                if (sheets.find(s => s.properties.title === name)) {
                    sheetName = name;
                    console.log(`✅ Usando hoja: ${sheetName}`);
                    break;
                }
            }
        } catch (metaError) {
            console.warn('No se pudo obtener metadata, usando hoja por defecto:', sheetName);
        }
        
        // Fetch all data from the sheet
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: `${sheetName}!A:R`  // Columns A through R (added M, N columns)
        });

        const rows = response.result.values;
        if (!rows || rows.length <= 1) {
            console.log('ℹ️ No hay registros validados en la BD de escritura');
            return [];
        }

        console.log(`📊 Encontradas ${rows.length - 1} filas en BD de escritura`);
        
        // Parse all records (we'll filter by OBC later)
        const records = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row.length >= 5 && row[4]) {  // Must have orden (column E)
                records.push({
                    folio: row[0] || '',
                    fecha: row[1] || '',
                    hora: row[2] || '',
                    usuario: row[3] || '',
                    orden: row[4] || '',
                    destino: row[5] || '',
                    horario: row[6] || '',
                    codigo: row[7] || '',
                    codigo2: row[8] || '',
                    estatus: row[9] || '',
                    tarea: row[10] || '',
                    estatus2: row[11] || '',
                    cantInicial: parseInt(row[12]) || 0,     // M: Cant Inicial (from OBC, read-only)
                    cantDespacho: parseInt(row[13]) || 0,    // N: Cant Despacho (manual input)
                    incidencias: row[14] || '',    // O: Incidencias
                    operador: row[15] || '',       // P: Operador
                    conductor: row[15] || '',      // Alias for operador
                    unidad: row[16] || '',         // Q: Unidad
                    observaciones: row[17] || '',  // R: Observaciones
                    notaDespacho: row[17] || '',   // Alias for observaciones
                    cantidadDespachar: parseInt(row[13]) || 0  // Use cantDespacho as primary
                });
            }
        }
        
        console.log(`✅ Parseados ${records.length} registros de despacho`);
        return records;
        
    } catch (error) {
        console.error('Error fetching from SPREADSHEET_WRITE:', error);
        throw error;
    }
}

/**
 * Cross-reference OBC orders with validated records
 * @param {Array} obcOrders - Array of OBC orders from BD_CAJAS
 * @param {Array} validatedRecords - Array of validated records from SPREADSHEET_WRITE
 * @returns {Object} { pendingOrders, validatedOrders, validatedOBCSet }
 */
function crossReferenceOrders(obcOrders, validatedRecords) {
    // Create a Set of validated OBC codes for quick lookup
    const validatedOBCSet = new Set();
    const validatedByOBC = new Map(); // OBC -> array of validation records
    
    validatedRecords.forEach(record => {
        if (record.orden) {
            const obcCode = record.orden.trim().toUpperCase();
            validatedOBCSet.add(obcCode);
            
            if (!validatedByOBC.has(obcCode)) {
                validatedByOBC.set(obcCode, []);
            }
            validatedByOBC.get(obcCode).push(record);
        }
    });
    
    console.log(`🔍 Cruzando ${obcOrders.length} órdenes OBC con ${validatedOBCSet.size} órdenes validadas`);
    
    const pendingOrders = [];
    const validatedOrders = [];
    
    obcOrders.forEach(order => {
        const obcCode = order.orden.trim().toUpperCase();
        
        if (validatedOBCSet.has(obcCode)) {
            // This order has been validated - get its validation records
            const validationRecords = validatedByOBC.get(obcCode) || [];
            
            // Add each validation record to validatedOrders
            validationRecords.forEach(record => {
                validatedOrders.push({
                    ...record,
                    // Add OBC data for reference
                    totalCajas: order.totalCajas,
                    recipient: order.recipient,
                    expectedArrival: order.expectedArrival
                });
            });
        } else {
            // This order is still pending
            pendingOrders.push(order);
        }
    });
    
    console.log(`✅ Resultado del cruce:`);
    console.log(`   - Pendientes: ${pendingOrders.length}`);
    console.log(`   - Validadas: ${validatedOrders.length}`);
    console.log(`   - OBCs validados: ${validatedOBCSet.size}`);
    
    return { pendingOrders, validatedOrders, validatedOBCSet };
}

// Sync transactional data (validacion and folios) from Google Sheets
async function syncTransactionalData() {
    if (!STATE.isOnline || STATE.syncInProgress) return;
    
    STATE.syncInProgress = true;
    updateConnectionStatus();
    
    try {
        // Sync validacion data (surtido)
        const validacionResponse = await fetch(CONFIG.SOURCES.VALIDACION);
        const validacionCsv = await validacionResponse.text();
        
        // Parse and merge with local data
        const newValidacionData = new Map();
        const lines = validacionCsv.split('\n').filter(l => l.trim());
        
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCSVLine(lines[i]);
            if (cols.length >= 5) {
                const orden = cols[3]?.trim();
                if (orden) {
                    if (!newValidacionData.has(orden)) {
                        newValidacionData.set(orden, []);
                    }
                    newValidacionData.get(orden).push({
                        fecha: cols[0]?.trim() || '',
                        hora: cols[1]?.trim() || '',
                        usuario: cols[2]?.trim() || '',
                        orden: orden,
                        codigo: cols[4]?.trim() || '',
                        ubicacion: cols[5]?.trim() || '',
                        porcentaje: cols[6]?.trim() || '',
                        nota: cols[7]?.trim() || ''
                    });
                }
            }
        }
        
        // Detect changes and update
        const hasChanges = detectValidacionChanges(STATE.validacionData, newValidacionData);
        if (hasChanges) {
            STATE.validacionData = newValidacionData;
            STATE.dataVersion++;
            console.log('🔄 Validacion data updated from remote');
            
            // Refresh UI if needed
            if (STATE.currentOrder) {
                // Refresh current order view
                updateOrderDisplay();
            }
        }
        
        // Sync validated records from Despachos sheet
        if (gapi?.client?.sheets) {
            await loadExistingValidatedRecords();
        }
        
        STATE.lastSyncTime = Date.now();
        saveLocalState();
        
    } catch (error) {
        console.error('Error syncing transactional data:', error);
    } finally {
        STATE.syncInProgress = false;
        updateConnectionStatus();
    }
}

// Detect if validacion data has changed
function detectValidacionChanges(oldData, newData) {
    if (oldData.size !== newData.size) return true;
    
    for (const [orden, items] of newData.entries()) {
        const oldItems = oldData.get(orden);
        if (!oldItems || oldItems.length !== items.length) return true;
    }
    
    return false;
}

// Sync pending changes to Google Sheets
async function syncPendingChanges() {
    if (!STATE.isOnline || STATE.pendingSync.length === 0) return;
    
    showNotification('🔄 Sincronizando cambios pendientes...', 'info');
    
    const failedSyncs = [];
    
    for (const change of STATE.pendingSync) {
        try {
            // Implement actual sync to Google Sheets here
            // This would use gapi.client.sheets.spreadsheets.values.append
            console.log('Syncing change:', change);
            
            // For now, just mark as synced
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.error('Failed to sync change:', error);
            failedSyncs.push(change);
        }
    }
    
    // Update pending sync queue
    STATE.pendingSync = failedSyncs;
    saveLocalState();
    
    if (failedSyncs.length === 0) {
        showNotification('✅ Todos los cambios sincronizados', 'success');
    } else {
        showNotification(`⚠️ ${failedSyncs.length} cambios pendientes de sincronizar`, 'warning');
    }
}

// Check if user can edit (online mode required)
function canEdit() {
    if (!STATE.isOnline) {
        showNotification('❌ Sin conexión - No se pueden realizar cambios', 'error');
        return false;
    }
    return true;
}

/**
 * Genera el número de folio basado en la fecha del filtro (fecha inicial)
 * REGLA: El folio debe usar la fecha de la mercancía (fecha inicial del filtro), no la fecha actual
 * Ejemplo: Si hoy es 14-01-2026 pero valido mercancía del 15-01-2026, el folio debe ser DSP-20260115-0X
 * @param {string} folioCarga - Número de folio (ej: '01', '02', etc.)
 * @returns {string} - Folio completo en formato DSP-YYYYMMDD-XX
 */
function generateFolio(folioCarga) {
    // Usar getCurrentDateKey() que ya implementa la lógica de fecha del filtro
    const dateKey = getCurrentDateKey(); // Formato: YYYY-MM-DD
    const dateStr = dateKey.replace(/-/g, ''); // Convertir a YYYYMMDD
    const folioCompleto = `DSP-${dateStr}-${folioCarga}`;
    
    console.log(`📋 [FOLIO] Generado: ${folioCompleto} (Fecha: ${dateKey})`);
    return folioCompleto;
}

// Verificar si una orden ya fue despachada (no confundir con validación de surtido)
function isOrderValidated(orden) {
    // Método 1: Verificar el flag isValidated en obcData (set during cross-reference)
    const orderData = STATE.obcData.get(orden) || STATE.obcData.get(orden?.toUpperCase());
    if (orderData && orderData.isValidated) {
        // Find the validation record
        const localMatch = STATE.localValidated.find(v => 
            v.orden === orden || v.orden?.toUpperCase() === orden?.toUpperCase()
        );
        return { validated: true, source: 'crossref', data: localMatch || orderData };
    }
    
    // Método 2: Buscar en despachos validados locales (fallback)
    const localMatch = STATE.localValidated.find(v => 
        v.orden === orden || v.orden?.toUpperCase() === orden?.toUpperCase()
    );
    if (localMatch) return { validated: true, source: 'local', data: localMatch };

    // NO verificar contra STATE.validacionData porque esos son datos de surtido (Val3), no despachos
    // Los despachos solo se verifican contra localValidated y la cola de sync

    return { validated: false };
}

/**
 * Verifica si una orden está en la categoría "Otros" (Cancelada o No Procesable)
 * @param {string} orden - Número de orden
 * @returns {object} - { isOtros: boolean, estatus: string, data: object }
 */
function isOrderOtros(orden) {
    const localMatch = STATE.localValidated.find(v =>
        v.orden === orden || v.orden?.toUpperCase() === orden?.toUpperCase()
    );

    if (localMatch && (localMatch.estatus === 'Cancelada' || localMatch.estatus === 'No Procesable')) {
        return {
            isOtros: true,
            estatus: localMatch.estatus,
            data: localMatch
        };
    }

    return { isOtros: false };
}

// Safe function to update validation badges (prevents ReferenceError)
function updateValidationBadges() {
    try {
        const validatedCount = STATE.localValidated.length;
        const pendingCount = STATE.localPending.length;
        
        // Update badges if elements exist
        const validatedBadge = document.querySelector('[data-badge="validated"]');
        const pendingBadge = document.querySelector('[data-badge="pending"]');
        
        if (validatedBadge) {
            validatedBadge.textContent = validatedCount;
        }
        if (pendingBadge) {
            pendingBadge.textContent = pendingCount;
        }
        
        console.log(`📊 Badges updated: ${validatedCount} validated, ${pendingCount} pending`);
    } catch (error) {
        console.warn('Could not update validation badges:', error);
    }
}

// Validate edit operation with conflict detection
function validateEditOperation(orden, operationType) {
    // Check online status
    if (!canEdit()) {
        return { allowed: false, reason: 'offline' };
    }
    
    // Check for concurrent edits (simple version based on data version)
    const currentVersion = STATE.dataVersion;
    
    // In a full implementation, this would check if another user
    // is currently editing the same record
    
    return { allowed: true, version: currentVersion };
}

// ==================== SISTEMA DE FOLIOS DE CARGA ====================
/**
 * Obtiene la fecha actual en formato YYYY-MM-DD
 */
/**
 * Obtiene la clave de fecha para folios
 * NUEVA LÓGICA: Si hay filtro activo, usa la Fecha Inicial como referencia
 * Si no hay filtro, usa la fecha actual (hoy)
 * @returns {string} Fecha en formato YYYY-MM-DD
 */
function getCurrentDateKey() {
    // REGLA DE NEGOCIO CRÍTICA: Los folios se parametrizan por Fecha Inicial del filtro
    if (STATE.dateFilter.active && STATE.dateFilter.startDate) {
        console.log(`📅 [FOLIO] Usando Fecha Inicial del filtro como referencia: ${STATE.dateFilter.startDate}`);
        return STATE.dateFilter.startDate;
    }

    // Si no hay filtro activo, usar fecha actual
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    console.log(`📅 [FOLIO] Usando fecha actual (sin filtro): ${todayKey}`);
    return todayKey;
}

/**
 * Obtiene los folios disponibles para un conductor y unidad
 * - Si es la misma combinación, puede reutilizar el folio existente
 * - Si es diferente, debe usar un folio no utilizado
 */
/**
 * NUEVA LÓGICA DE FOLIOS DINÁMICOS
 * - Muestra máximo 5 folios disponibles para elegir (sin contar los ya seleccionados por el usuario)
 * - A medida que los folios se ocupen, habilita automáticamente nuevos números
 * - Los folios ya ocupados por el usuario actual se muestran y pueden reutilizarse
 * - Los folios ocupados por otros usuarios se muestran en el historial pero no en la selección activa
 */
function getAvailableFolios(conductor, unidad) {
    const dateKey = getCurrentDateKey();
    const foliosDelDia = STATE.foliosDeCargas.get(dateKey) || new Map();

    // Obtener folios del usuario actual (pueden reutilizarse)
    const foliosDelUsuario = [];
    foliosDelDia.forEach((info, folio) => {
        if (info.conductor === conductor && info.unidad === unidad) {
            foliosDelUsuario.push(folio);
        }
    });

    // Obtener folios ocupados por otros usuarios
    const foliosOcupadosPorOtros = new Set();
    foliosDelDia.forEach((info, folio) => {
        if (info.conductor !== conductor || info.unidad !== unidad) {
            foliosOcupadosPorOtros.add(folio);
        }
    });

    // Generar lista de folios disponibles
    const foliosDisponibles = [];
    let folioNum = 1;
    let disponiblesCount = 0;
    const MAX_DISPONIBLES = 5;

    // Primero agregar los folios del usuario actual (pueden reutilizarse)
    foliosDelUsuario.forEach(folio => {
        foliosDisponibles.push({
            value: folio,
            disabled: false,
            reutilizable: true
        });
    });

    // Luego agregar folios no ocupados hasta completar 5 disponibles
    while (disponiblesCount < MAX_DISPONIBLES && folioNum <= 99) {
        const folioStr = String(folioNum).padStart(2, '0');
        
        // Saltar si ya está en la lista del usuario
        if (foliosDelUsuario.includes(folioStr)) {
            folioNum++;
            continue;
        }

        // Si no está ocupado por otros, agregarlo como disponible
        if (!foliosOcupadosPorOtros.has(folioStr)) {
            foliosDisponibles.push({
                value: folioStr,
                disabled: false
            });
            disponiblesCount++;
        }
        
        folioNum++;
    }

    // Agregar folios ocupados por otros (solo para visualización en historial)
    foliosOcupadosPorOtros.forEach(folio => {
        const folioInfo = foliosDelDia.get(folio);
        foliosDisponibles.push({
            value: folio,
            disabled: true,
            usadoPor: `${folioInfo.conductor}/${folioInfo.unidad}`
        });
    });

    // Ordenar: primero los del usuario, luego disponibles, luego ocupados
    foliosDisponibles.sort((a, b) => {
        if (a.reutilizable && !b.reutilizable) return -1;
        if (!a.reutilizable && b.reutilizable) return 1;
        if (!a.disabled && b.disabled) return -1;
        if (a.disabled && !b.disabled) return 1;
        return parseInt(a.value) - parseInt(b.value);
    });

    console.log(`📋 [FOLIO DINÁMICO] Usuario: ${conductor}/${unidad}`);
    console.log(`   - Folios del usuario: ${foliosDelUsuario.length}`);
    console.log(`   - Folios disponibles: ${disponiblesCount}`);
    console.log(`   - Folios ocupados por otros: ${foliosOcupadosPorOtros.size}`);

    return foliosDisponibles;
}

/**
 * Verifica si ya existe un folio para la fecha actual (del filtro)
 * @param {string} folioNum - Número de folio (ej: '01', '02')
 * @returns {object} - { exists: boolean, folio: string, orders: array }
 */
function checkFolioExists(folioNum) {
    const dateKey = getCurrentDateKey();
    const folioCompleto = generateFolio(folioNum);
    
    // Buscar órdenes con este folio en localValidated
    const ordersWithFolio = STATE.localValidated.filter(record => 
        record.folio === folioCompleto
    );
    
    if (ordersWithFolio.length > 0) {
        console.log(`⚠️ [FOLIO] Ya existe folio ${folioCompleto} con ${ordersWithFolio.length} órdenes`);
        return {
            exists: true,
            folio: folioCompleto,
            orders: ordersWithFolio,
            dateKey: dateKey
        };
    }
    
    return { exists: false, folio: folioCompleto, dateKey: dateKey };
}

/**
 * Marca un folio como utilizado para una combinación conductor-unidad
 */
function markFolioAsUsed(conductor, unidad, folio) {
    const dateKey = getCurrentDateKey();

    if (!STATE.foliosDeCargas.has(dateKey)) {
        STATE.foliosDeCargas.set(dateKey, new Map());
    }

    const foliosDelDia = STATE.foliosDeCargas.get(dateKey);
    foliosDelDia.set(folio, { conductor, unidad });

    console.log(`[Folio de Carga] Marcado como usado: ${folio} para ${conductor}/${unidad} en ${dateKey}`, STATE.foliosDeCargas);
    saveLocalState();
}

/**
 * Libera un folio previamente usado
 */
function releaseFolio(folio) {
    const dateKey = getCurrentDateKey();

    if (STATE.foliosDeCargas.has(dateKey)) {
        const foliosDelDia = STATE.foliosDeCargas.get(dateKey);
        foliosDelDia.delete(folio);
        console.log(`[Folio de Carga] Liberado: ${folio} de ${dateKey}`, STATE.foliosDeCargas);
        saveLocalState();
    }
}

/**
 * Obtiene el próximo folio disponible (no usado por nadie)
 */
function getNextAvailableFolio() {
    const dateKey = getCurrentDateKey();
    const foliosDelDia = STATE.foliosDeCargas.get(dateKey) || new Map();

    const allFolios = ['01', '02', '03', '04', '05'];
    for (const folio of allFolios) {
        if (!foliosDelDia.has(folio)) {
            return folio;
        }
    }

    return null; // Todos los folios están usados
}

/**
 * Verifica si un folio puede ser usado por una combinación conductor-unidad
 */
function canUseFolio(conductor, unidad, folio) {
    const dateKey = getCurrentDateKey();
    const foliosDelDia = STATE.foliosDeCargas.get(dateKey) || new Map();
    const folioInfo = foliosDelDia.get(folio);

    // Si no está usado, puede usarse
    if (!folioInfo) return true;

    // Si está usado por la misma combinación, puede reutilizarse
    if (folioInfo.conductor === conductor && folioInfo.unidad === unidad) return true;

    // Está usado por otra combinación
    return false;
}

/**
 * Actualiza las opciones del selector de folios basado en conductor y unidad actuales
 */
function updateFolioSelector() {
    const conductorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');
    const folioSelect = document.getElementById('modal-folio-carga');

    if (!conductorSelect || !unidadSelect || !folioSelect) return;

    const conductor = conductorSelect.value;
    const unidad = unidadSelect.value;

    if (!conductor || !unidad) {
        folioSelect.disabled = true;
        folioSelect.value = '';
        return;
    }

    folioSelect.disabled = false;
    const availableFolios = getAvailableFolios(conductor, unidad);

    console.log(`[Folio de Carga] Actualizando selector para ${conductor}/${unidad}`, availableFolios);

    // Actualizar opciones del selector
    folioSelect.innerHTML = '<option value="">📋 Seleccionar Folio...</option>';
    availableFolios.forEach(({ value, disabled, reutilizable, usadoPor }) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.disabled = disabled;

        if (reutilizable) {
            option.textContent += ' (Tu folio actual)';
        } else if (disabled) {
            option.textContent += ` (Usado: ${usadoPor})`;
        }

        folioSelect.appendChild(option);
    });
}

/**
 * Configura los event listeners para actualizar el selector de folios
 * IMPORTANTE: Se usa flag para evitar agregar listeners múltiples veces
 */
let folioListenersInitialized = false;
let previousSelectedFolio = '';

function setupFolioSelectorListeners() {
    const conductorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');
    const folioSelect = document.getElementById('modal-folio-carga');

    // Evitar agregar listeners duplicados
    if (folioListenersInitialized) {
        // Solo actualizar el valor previo del folio actual
        previousSelectedFolio = folioSelect ? folioSelect.value : '';
        console.log('[Folio de Carga] Listeners ya configurados, solo actualizando estado');
        return;
    }

    if (conductorSelect) {
        conductorSelect.addEventListener('change', updateFolioSelector);
    }

    if (unidadSelect) {
        unidadSelect.addEventListener('change', updateFolioSelector);
    }

    // NUEVO: Validar existencia de folio al seleccionarlo
    // Guardar folio anterior para detectar cambios reales
    previousSelectedFolio = folioSelect ? folioSelect.value : '';

    if (folioSelect) {
        folioSelect.addEventListener('change', async function() {
            const selectedFolio = this.value;
            if (!selectedFolio) {
                previousSelectedFolio = '';
                return;
            }

            // Solo mostrar alerta si el usuario cambió a un folio DIFERENTE al anterior
            if (selectedFolio === previousSelectedFolio) {
                return; // Mismo folio, no hacer nada
            }

            // Verificar si el folio ya existe (tiene órdenes)
            const folioCheck = checkFolioExists(selectedFolio);

            // Solo mostrar confirmación si:
            // 1. El folio ya tiene órdenes (existe)
            // 2. Es un cambio a un folio diferente al que estaba antes
            if (folioCheck.exists) {
                // Mostrar confirmación al usuario
                const confirmMsg = `⚠️ El folio ${folioCheck.folio} ya existe con ${folioCheck.orders.length} orden(es).\n\n¿Deseas cargar la información existente del folio?`;

                if (confirm(confirmMsg)) {
                    // Auto-cargar información del folio existente
                    await loadExistingFolioData(folioCheck);
                } else {
                    // Usuario decidió no cargar, puede continuar agregando al folio existente
                    console.log(`ℹ️ [FOLIO] Usuario decidió continuar con folio existente sin cargar datos`);
                }
            } else {
                console.log(`✅ [FOLIO] Folio ${folioCheck.folio} disponible para crear`);
            }

            // Actualizar el folio anterior
            previousSelectedFolio = selectedFolio;
        });
    }

    folioListenersInitialized = true;
    console.log('[Folio de Carga] Event listeners configurados');
}

/**
 * Carga automáticamente los datos de un folio existente
 * @param {object} folioCheck - Resultado de checkFolioExists
 */
async function loadExistingFolioData(folioCheck) {
    try {
        console.log(`🔄 [FOLIO] Cargando datos existentes del folio ${folioCheck.folio}`);
        
        // Obtener la primera orden del folio para extraer conductor y unidad
        const firstOrder = folioCheck.orders[0];
        
        if (firstOrder) {
            // Extraer el número de folio (ej: "03" de "DSP-20260115-03")
            const folioNum = folioCheck.folio.split('-').pop();
            
            // Auto-completar conductor y unidad
            const conductorSelect = document.getElementById('modal-operador');
            const unidadSelect = document.getElementById('modal-unidad');
            const folioSelect = document.getElementById('modal-folio-carga');
            
            if (conductorSelect && firstOrder.operador) {
                conductorSelect.value = firstOrder.operador;
            }
            
            if (unidadSelect && firstOrder.unidad) {
                unidadSelect.value = firstOrder.unidad;
            }
            
            // Actualizar el selector de folios con la nueva combinación
            updateFolioSelector();
            
            // IMPORTANTE: Restaurar el folio seleccionado después de actualizar el selector
            if (folioSelect) {
                folioSelect.value = folioNum;
            }
            
            // Mostrar notificación de éxito
            showNotification(
                `✅ Folio ${folioCheck.folio} cargado: ${firstOrder.operador}/${firstOrder.unidad} con ${folioCheck.orders.length} orden(es)`,
                'success'
            );
            
            console.log(`✅ [FOLIO] Datos cargados exitosamente - Folio ${folioNum} seleccionado`);
        }
    } catch (error) {
        console.error('❌ [FOLIO] Error al cargar datos del folio:', error);
        showNotification('❌ Error al cargar datos del folio', 'error');
    }
}

/**
 * Limpia los folios de días anteriores (mantiene solo del día actual)
 */
function cleanOldFolios() {
    const todayStr = getCurrentDateKey();

    const keysToDelete = [];
    STATE.foliosDeCargas.forEach((_value, key) => {
        if (key !== todayStr) {
            keysToDelete.push(key);
        }
    });

    keysToDelete.forEach(key => STATE.foliosDeCargas.delete(key));
    if (keysToDelete.length > 0) {
        saveLocalState();
    }
}

let CURRENT_USER = '';
let USER_EMAIL = '';
let USER_GOOGLE_NAME = '';
let IS_ONLINE = navigator.onLine;

// Try to restore existing Google session
function tryRestoreSession() {
    const savedToken = localStorage.getItem('gapi_token');
    const tokenExpiry = localStorage.getItem('gapi_token_expiry');

    if (savedToken && tokenExpiry) {
        const expiryTime = parseInt(tokenExpiry, 10);
        const now = Date.now();

        // Check if token is still valid (with 5 min margin)
        if (expiryTime > now + (5 * 60 * 1000)) {
            try {
                const tokenObj = JSON.parse(savedToken);
                gapi.client.setToken(tokenObj);

                // Verify token works
                gapi.client.request({
                    path: 'https://www.googleapis.com/oauth2/v2/userinfo',
                }).then(async () => {
                    // Token valid, restore session
                    await getUserProfile();
                    updateUserFooter();
                    updateConnectionIndicator();
                    
                    document.getElementById('login-screen').classList.add('hidden');
                    document.getElementById('main-app').classList.remove('hidden');
                    
                    loadAllData();
                    
                    console.log('✅ Google session restored');
                }).catch(err => {
                    // Token invalid, clear it
                    console.log('Token invalid, requires new login');
                    localStorage.removeItem('gapi_token');
                    localStorage.removeItem('gapi_token_expiry');
                });
            } catch (e) {
                console.error('Error restoring token:', e);
                localStorage.removeItem('gapi_token');
                localStorage.removeItem('gapi_token_expiry');
            }
        } else {
            // Token expired
            console.log('Token expired, requires new login');
            localStorage.removeItem('gapi_token');
            localStorage.removeItem('gapi_token_expiry');
        }
    }
}

// ==================== SESSION GUARD ====================
/**
 * Valida si existe una sesión válida al iniciar la aplicación
 * Previene auto-restauración de sesiones inválidas o expiradas
 */
function validateSessionOnStartup() {
    try {
        const savedState = localStorage.getItem('dispatch_local_state');
        const activeSession = localStorage.getItem('dispatch_active_session');
        
        // Si no hay estado guardado, es inicio limpio (válido)
        if (!savedState && !activeSession) {
            console.log('✅ [SESSION GUARD] Inicio limpio - No hay sesión previa');
            return true;
        }
        
        // Si hay sesión activa, validar timestamp
        if (activeSession) {
            const sessionData = JSON.parse(activeSession);
            const sessionTimestamp = sessionData.timestamp || 0;
            const now = Date.now();
            const sessionAge = now - sessionTimestamp;
            const MAX_SESSION_AGE = 24 * 60 * 60 * 1000; // 24 horas
            
            if (sessionAge > MAX_SESSION_AGE) {
                console.log('⚠️ [SESSION GUARD] Sesión expirada (>24h) - Invalidando');
                return false;
            }
            
            // Validar que tenga filtro de fecha
            if (!sessionData.dateFilter || !sessionData.dateFilter.startDate) {
                console.log('⚠️ [SESSION GUARD] Sesión sin filtro de fecha válido - Invalidando');
                return false;
            }
            
            console.log('✅ [SESSION GUARD] Sesión válida encontrada:', {
                edad: `${Math.round(sessionAge / (60 * 60 * 1000))}h`,
                filtro: `${sessionData.dateFilter.startDate} → ${sessionData.dateFilter.endDate}`
            });
        }
        
        return true;
        
    } catch (e) {
        console.error('❌ [SESSION GUARD] Error validando sesión:', e);
        return false;
    }
}

/**
 * Limpia sesión inválida del localStorage
 */
function clearInvalidSession() {
    console.log('🗑️ [SESSION GUARD] Limpiando sesión inválida...');
    
    try {
        localStorage.removeItem('dispatch_local_state');
        localStorage.removeItem('dispatch_active_session');
        localStorage.removeItem('dispatch_date_filter');
        localStorage.removeItem('localValidated');
        
        console.log('✅ [SESSION GUARD] Sesión inválida limpiada');
    } catch (e) {
        console.error('❌ Error limpiando sesión inválida:', e);
    }
}

/**
 * Guarda marca de sesión activa al aplicar filtro
 */
function markActiveSession() {
    try {
        const sessionData = {
            timestamp: Date.now(),
            dateFilter: {
                startDate: STATE.dateFilter.startDate,
                endDate: STATE.dateFilter.endDate,
                active: STATE.dateFilter.active
            },
            user: CURRENT_USER || USER_EMAIL
        };
        
        localStorage.setItem('dispatch_active_session', JSON.stringify(sessionData));
        console.log('✅ [SESSION] Sesión activa marcada');
    } catch (e) {
        console.error('❌ Error marcando sesión activa:', e);
    }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', async () => {
    // Disable debug mode first
    if (typeof DebugMode !== 'undefined' && typeof DebugMode.disable === 'function') {
        DebugMode.disable();
        console.log('🔧 Debug mode disabled');
    }

    // ==================== SESSION GUARD: Validar sesión antes de inicializar ====================
    console.log('🛡️ [SESSION GUARD] Validando sesión...');
    
    const isValidSession = validateSessionOnStartup();
    
    if (!isValidSession) {
        console.log('⚠️ [SESSION GUARD] Sesión inválida o expirada - Forzando inicio limpio');
        // Limpiar localStorage completamente
        clearInvalidSession();
    }

    // Initialize core components
    loadLocalState();
    cleanOldFolios();
    setupEventListeners();
    
    // Initialize connection monitoring for offline mode
    initializeConnectionMonitoring();
    
    // Initialize sync manager if available
    if (typeof initSyncManager === 'function') {
        setupConnectionMonitoring();
        await initSyncManager();
    }
    
    initSidebarComponent();
    
    console.log('✅ Dispatch app initialized with real-time sync and offline mode support');
});

function initSidebarComponent() {
    // Verificar que SidebarComponent esté disponible
    if (typeof SidebarComponent === 'undefined') {
        console.warn('⚠️ SidebarComponent no está disponible, omitiendo inicialización');
        return;
    }
    
    try {
        // Inicializar SidebarComponent con configuración de dispatch
        window.sidebarComponent = new SidebarComponent({
            ...SidebarComponent.presets.dispatch,
            containerId: 'sidebar',
            syncManager: window.syncManager,
            onReloadBD: reloadData,
            onLogout: handleLogout,
            onToggleConnection: toggleConnection,
            buttons: [
                { label: '🚀 Iniciar Despacho', onClick: 'showSearchPanel()', class: 'sidebar-btn-primary' },
                { label: '📋 Gestión de Folios', onClick: 'showFoliosManagementView()', class: 'sidebar-btn-secondary' },
                { label: '📥 Exportar CSV', onClick: 'exportData()', class: 'sidebar-btn-secondary' }
            ]
        });

        window.sidebarComponent.render();
    } catch (error) {
        console.error('❌ Error inicializando SidebarComponent:', error);
    }
}

function setupEventListeners() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && searchInput.value.trim()) {
                e.preventDefault();
                executeSearch();
            }
        });
    }

    // CHANGE 4: Setup clear button listeners for all search inputs
    setupClearButtonListeners();

    // Setup date input auto-close and format display
    setupDateInputListeners();

    // Setup delegated click handlers for table rows

    // Listeners de autenticación
    window.addEventListener('auth-account-changed', (event) => {
        const { previousEmail, newEmail } = event.detail;
        console.log('🔄 [DISPATCH] Cambio de cuenta detectado:', previousEmail, '->', newEmail);

        // CRÍTICO: Limpiar localStorage específico de la app
        localStorage.removeItem('dispatch_local_state');
        localStorage.removeItem('dispatch_active_session');
        // Limpiar alias del usuario anterior
        if (previousEmail) {
            localStorage.removeItem(`dispatch_alias_${previousEmail}`);
        }

        // Limpiar datos del usuario anterior
        CURRENT_USER = '';
        USER_EMAIL = '';
        USER_GOOGLE_NAME = '';

        // Limpiar datos de despacho
        STATE.localValidated = [];
        STATE.localPending = [];
        STATE.foliosDeCargas.clear();
        STATE.obcData.clear();
        STATE.bdCajasData.clear();

        showNotification('🔄 Cambio de cuenta detectado. Recargando datos...', 'info');
    });

    window.addEventListener('auth-needs-name-registration', (event) => {
        const { email, isNewAccount, needsNameRegistration } = event.detail;
        console.log('👤 [DISPATCH] Se requiere registro de nombre:', { email, isNewAccount, needsNameRegistration });

        // Recargar datos del avatar y forzar popup si es necesario
        if (window.sidebarComponent) {
            window.sidebarComponent.reloadAvatarData(needsNameRegistration);
        }

        // Actualizar CURRENT_USER desde AuthManager
        if (window.AuthManager && window.AuthManager.currentUser) {
            CURRENT_USER = window.AuthManager.currentUser;
        }
    });

    // CRÍTICO: Escuchar actualizaciones del avatar para sincronizar CURRENT_USER
    // Esto asegura que cuando el usuario cambia su nombre, se refleje inmediatamente en los registros
    if (window.sidebarComponent) {
        window.sidebarComponent.onAvatarUpdate((avatarState) => {
            if (avatarState.userName) {
                CURRENT_USER = avatarState.userName;
                console.log('🔄 [DISPATCH] CURRENT_USER sincronizado desde avatar:', CURRENT_USER);
                updateUserFooter();
            }
        });
    }
    setupTableClickDelegation();
}

/**
 * Setup delegated click handlers for table rows
 * Uses document-level delegation to ensure it always works
 */
function setupTableClickDelegation() {
    // Document-level listener with capture phase to ensure we catch all clicks
    document.addEventListener('click', (e) => {
        // Get the actual target element
        const target = e.target;

        // Skip if click was on specific interactive elements that handle their own clicks
        if (target.closest('.copy-icon') ||
            target.closest('.filter-chip-remove') ||
            target.closest('.modal-close') ||
            target.closest('.modal-overlay > .modal-content button')) {
            return;
        }

        // Handle btn-action clicks explicitly
        // BUT only for orders tables (tr with data-orden), NOT for folios table
        const btnAction = target.closest('.btn-action');
        if (btnAction) {
            const row = btnAction.closest('tr[data-orden]');
            if (row) {
                // This is an order row - handle manually
                e.preventDefault();
                e.stopPropagation();
                const orden = row.getAttribute('data-orden');
                if (orden) {
                    showOrderInfo(orden);
                }
                return;
            }
            // If no data-orden (e.g., folios table), let the button's onclick handler work
            return;
        }

        // Handle delete button clicks
        const deleteBtn = target.closest('.btn-delete-validated');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            const row = deleteBtn.closest('tr[data-orden]');
            if (row) {
                const orden = row.getAttribute('data-orden');
                if (orden) {
                    confirmDeleteValidated(orden);
                }
            }
            return;
        }

        // Check for order row click - this handles clicks anywhere on the row
        const row = target.closest('tr[data-orden]');
        if (row) {
            const orden = row.getAttribute('data-orden');
            if (!orden) return;

            // Determine which table this row belongs to
            const tableBody = row.closest('tbody');
            if (!tableBody) return;

            // Only process if click was not on a button or interactive element
            if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (tableBody.id === 'orders-table-body') {
                showOrderInfo(orden);
            } else if (tableBody.id === 'validated-table-body') {
                showValidatedDetails(orden);
            } else if (tableBody.id === 'otros-table-body') {
                showValidatedDetails(orden);
            }
            return;
        }

        // Check for match item click
        const matchItem = target.closest('.match-item');
        if (matchItem) {
            const ordenMatch = matchItem.querySelector('.match-header')?.textContent?.match(/\d+/)?.[0];
            if (ordenMatch) {
                selectMatch(ordenMatch);
            }
        }
    }, true); // Use capture phase
}

/**
 * Setup date input listeners for auto-close on selection
 */
function setupDateInputListeners() {
    const dateInputs = ['date-start', 'date-end', 'folios-date-start', 'folios-date-end'];

    dateInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            // Auto-close calendar picker when date is selected
            input.addEventListener('change', () => {
                // Blur to close the picker
                input.blur();
                // Update display
                updateDateDisplay(input);
            });
        }
    });
}

/**
 * Update the date display span with DD-MM-YYYY format
 */
function updateDateDisplay(input) {
    const displayId = `${input.id}-display`;
    const displaySpan = document.getElementById(displayId);

    if (!displaySpan) return;

    if (input.value) {
        const date = new Date(input.value + 'T00:00:00');
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        displaySpan.textContent = `${day}-${month}-${year}`;
        displaySpan.classList.add('has-value');
    } else {
        displaySpan.textContent = 'Seleccionar fecha...';
        displaySpan.classList.remove('has-value');
    }
}

// CHANGE 4: Clear search input function
function clearSearchInput(inputId) {
    const input = document.getElementById(inputId);
    const clearBtn = document.getElementById(`clear-${inputId}`);

    if (input) {
        input.value = '';
        input.focus();
    }

    if (clearBtn) {
        clearBtn.style.display = 'none';
    }

    // Trigger appropriate filter/search function
    if (inputId === 'filter-folios') {
        filterFoliosTable();
    } else if (inputId === 'filter-orders') {
        filterOrdersTable();
    } else if (inputId === 'filter-validated') {
        filterValidatedTable();
    }
}

// CHANGE 4: Setup listeners for showing/hiding clear buttons
function setupClearButtonListeners() {
    const searchInputs = [
        'search-input',
        'filter-folios',
        'filter-orders',
        'filter-validated'
    ];

    searchInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        const clearBtn = document.getElementById(`clear-${inputId}`);

        if (input && clearBtn) {
            // Show/hide clear button on input
            input.addEventListener('input', () => {
                clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
            });

            // Hide clear button on blur if empty
            input.addEventListener('blur', () => {
                if (!input.value.trim()) {
                    clearBtn.style.display = 'none';
                }
            });

            // Initialize clear button visibility
            clearBtn.style.display = input.value.trim() ? 'flex' : 'none';
        }
    });
}

function setupConnectionMonitoring() {
    window.addEventListener('online', () => {
        IS_ONLINE = true;
        updateConnectionIndicator();
        showNotification('🌐 Conexión restaurada', 'success');
        if (gapi?.client?.getToken() && STATE.pendingSync.length > 0) {
            syncPendingData();
        }
    });

    window.addEventListener('offline', () => {
        IS_ONLINE = false;
        updateConnectionIndicator();
        showNotification('⚠️ Sin conexión a Internet', 'warning');
    });

    updateConnectionIndicator();
}

function updateConnectionIndicator() {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');

    if (!dot || !text) return;

    if (IS_ONLINE && gapi?.client?.getToken()) {
        dot.className = 'connection-dot online';
        text.textContent = 'Online';
    } else if (IS_ONLINE) {
        dot.className = 'connection-dot offline';
        text.textContent = 'No autenticado';
    } else {
        dot.className = 'connection-dot offline';
        text.textContent = 'Offline';
    }
}

// ==================== AUTHENTICATION ====================

// Handle login button click
function handleLogin() {
    if (!tokenClient) {
        console.error('❌ tokenClient not initialized yet');
        showNotification('⏳ Inicializando Google API, intenta de nuevo en un momento', 'warning');
        return;
    }
    
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            console.error('Auth error:', resp);
            showNotification('❌ Error de autenticación', 'error');
            return;
        }

        gapi.client.setToken(resp);

        // Save token to localStorage for persistence
        const tokenObj = gapi.client.getToken();
        if (tokenObj) {
            localStorage.setItem('gapi_token', JSON.stringify(tokenObj));
            // Save expiration time (usually 1 hour)
            const expiresIn = resp.expires_in || 3600; // seconds
            const expiryTime = Date.now() + (expiresIn * 1000);
            localStorage.setItem('gapi_token_expiry', expiryTime.toString());
            console.log('Google token saved to localStorage');
        }

        await getUserProfile();
        
        // Initialize sync manager if not already initialized
        if (!window.syncManager) {
            await initSyncManager();
        }

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');

        updateConnectionIndicator();
        loadAllData();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

async function getUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
        });
        const data = await response.json();
        USER_EMAIL = data.email || '';
        USER_GOOGLE_NAME = data.name || 'Usuario';

        // Update avatar system if available
        if (window.sidebarComponent) {
            window.sidebarComponent.setUserEmail(USER_EMAIL);
            window.sidebarComponent.setUserName(USER_GOOGLE_NAME);
            window.sidebarComponent.saveGoogleConnection(
                gapi.client.getToken().access_token,
                (gapi.client.getToken().expires_in || 3600)
            );
        }

        // Handle user alias
        const savedAlias = localStorage.getItem(`dispatch_alias_${USER_EMAIL}`);
        if (savedAlias) {
            CURRENT_USER = savedAlias;
        } else {
            CURRENT_USER = USER_GOOGLE_NAME;
            localStorage.setItem(`dispatch_alias_${USER_EMAIL}`, USER_GOOGLE_NAME);
        }
        updateUserFooter();
    } catch (e) {
        console.error('Error getting user profile:', e);
        CURRENT_USER = 'Usuario';
        throw e; // Re-throw to handle in the calling function
    }
}

function handleLogout() {
    // Revoke token
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
    }
    
    // Limpiar datos específicos de la app ANTES de logout
    localStorage.removeItem('gapi_token');
    localStorage.removeItem('gapi_token_expiry');
    localStorage.removeItem('dispatch_local_state');
    localStorage.removeItem('dispatch_active_session');
    
    // Limpiar todos los alias de dispatch (son específicos de esta app)
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('dispatch_alias_')) {
            localStorage.removeItem(key);
        }
    });
    
    // Limpiar variables globales
    CURRENT_USER = '';
    USER_EMAIL = '';
    USER_GOOGLE_NAME = '';
    
    // Limpiar estado de la app
    STATE.localValidated = [];
    STATE.localPending = [];
    STATE.foliosDeCargas.clear();
    STATE.obcData.clear();
    STATE.bdCajasData.clear();
    
    // Usar AuthManager si está disponible
    if (window.AuthManager && typeof window.AuthManager.logout === 'function') {
        window.AuthManager.logout();
    }
    
    // Reload to reset the app state
    location.reload();
}

function updateUserFooter() {
    if (window.sidebarComponent) {
        // Usar el sistema de avatar del sidebar component
        if (CURRENT_USER) {
            window.sidebarComponent.setUserName(CURRENT_USER);
        }
        if (USER_EMAIL) {
            window.sidebarComponent.setUserEmail(USER_EMAIL);
        }
        window.sidebarComponent.updateAvatarDisplay();
    }
}


// ==================== DATA LOADING ====================

// Estado de carga para evitar cargas redundantes
const LOAD_STATE = {
    criticalLoaded: false,      // BD Escritura (folios actuales)
    referenceLoaded: false,     // BDs de referencia (LISTAS)
    backgroundLoading: false,   // Carga en segundo plano en progreso
    lastDateFilter: null,       // Último filtro de fecha aplicado
    loadedDateRanges: []        // Rangos de fecha ya cargados
};

/**
 * CARGA INICIAL CRÍTICA
 * Solo carga la BD de Escritura para mostrar folios actuales inmediatamente
 * Las BDs pesadas se cargan en segundo plano después
 */
async function loadCriticalData() {
    if (LOAD_STATE.criticalLoaded) {
        console.log('⚡ [LOAD] Datos críticos ya cargados, omitiendo...');
        return;
    }

    console.log('🚀 [LOAD] Iniciando carga crítica (BD Escritura)...');
    STATE.isLoading = true;
    
    try {
        // PASO 1: Cargar BD de Escritura (folios del usuario)
        showNotification('🔄 Cargando tus folios...', 'info');
        
        if (gapi?.client?.sheets) {
            const validatedRecords = await fetchValidatedRecordsFromWriteDB();
            STATE.localValidated = validatedRecords;
            rebuildFoliosFromRecords(validatedRecords);
            console.log(`✅ [LOAD] ${validatedRecords.length} registros de despacho cargados`);
        }
        
        // PASO 2: Cargar LISTAS (operadores/unidades) - crítico para UI
        try {
            const listasResponse = await fetch(CONFIG.SOURCES.LISTAS);
            const listasCsv = await listasResponse.text();
            parseListasData(listasCsv);
            console.log('✅ [LOAD] Listas de operadores/unidades cargadas');
        } catch (e) {
            console.warn('⚠️ Error cargando LISTAS:', e);
        }
        
        LOAD_STATE.criticalLoaded = true;
        STATE.isLoading = false;
        
        // Actualizar UI inmediatamente
        updateBdInfo();
        updateSummary();
        updateTabBadges();
        
        showNotification('✅ Listo - Selecciona un rango de fechas para ver órdenes', 'success');
        
        // PASO 3: Iniciar carga de BDs de referencia en segundo plano
        loadReferenceDataInBackground();
        
        // PASO 4: Iniciar carga de índice de búsqueda en background
        if (typeof startBackgroundIndexLoad === 'function') {
            console.log('🔄 [Background Index] Iniciando carga de índice...');
            setTimeout(() => {
                startBackgroundIndexLoad();
            }, 2000); // Esperar 2 segundos para no interferir con carga de referencias
        }
        
    } catch (error) {
        console.error('❌ Error en carga crítica:', error);
        STATE.isLoading = false;
        showNotification('❌ Error cargando datos iniciales', 'error');
    }
}

/**
 * CARGA EN SEGUNDO PLANO
 * Carga BDs de referencia secundarias sin bloquear la UI
 * NOTA: VALIDACION y MNE ahora se cargan en paralelo durante lazyLoadDataByDate()
 */
async function loadReferenceDataInBackground() {
    if (LOAD_STATE.referenceLoaded || LOAD_STATE.backgroundLoading) {
        console.log('⚡ [BACKGROUND] Datos de referencia ya cargados o en progreso');
        return;
    }

    LOAD_STATE.backgroundLoading = true;
    console.log('📦 [BACKGROUND] Iniciando carga de BDs de referencia secundarias en segundo plano...');

    // Usar setTimeout para no bloquear el hilo principal
    setTimeout(async () => {
        try {
            // Generar timestamp para cache-busting
            const cacheBuster = Date.now();

            // NOTA: VALIDACION y MNE se cargan ahora en paralelo durante lazyLoadDataByDate()
            // para evitar que aparezcan vacíos inicialmente

            // TRS (Rastreo) - carga en background ya que es menos crítico
            try {
                let trsCsv;
                if (dispatchSyncManager) {
                    // Forzar recarga sin usar caché
                    trsCsv = await dispatchSyncManager.getReferenceData('trs', CONFIG.SOURCES.TRS, true);
                } else {
                    // Agregar cache-busting a la URL
                    const url = CONFIG.SOURCES.TRS.includes('?')
                        ? `${CONFIG.SOURCES.TRS}&_t=${cacheBuster}`
                        : `${CONFIG.SOURCES.TRS}?_t=${cacheBuster}`;
                    const response = await fetch(url, { cache: 'no-store' });
                    trsCsv = await response.text();
                }
                if (trsCsv) parseTRSData(trsCsv);
                console.log('✅ [BACKGROUND] TRS cargada (sin caché)');
            } catch (e) {
                console.warn('⚠️ [BACKGROUND] Error cargando TRS:', e);
            }

            LOAD_STATE.referenceLoaded = true;
            LOAD_STATE.backgroundLoading = false;
            console.log('✅ [BACKGROUND] BDs de referencia secundarias cargadas (sin caché)');

        } catch (error) {
            console.error('❌ [BACKGROUND] Error en carga de referencia:', error);
            LOAD_STATE.backgroundLoading = false;
        }
    }, 100); // Pequeño delay para permitir que la UI se renderice primero
}

/**
 * CARGA OPTIMIZADA POR FILTRO DE FECHA
 * Solo carga datos si el rango no ha sido cargado previamente
 * @param {string} startDate - Fecha inicio YYYY-MM-DD
 * @param {string} endDate - Fecha fin YYYY-MM-DD
 * @returns {boolean} - true si se necesita cargar, false si ya estaba cargado
 */
function needsDataLoad(startDate, endDate) {
    const rangeKey = `${startDate}_${endDate}`;
    
    // Verificar si este rango exacto ya fue cargado
    if (LOAD_STATE.loadedDateRanges.includes(rangeKey)) {
        console.log(`⚡ [LOAD] Rango ${startDate} - ${endDate} ya cargado, usando caché local`);
        return false;
    }
    
    // Verificar si el rango está contenido en uno ya cargado
    for (const loadedRange of LOAD_STATE.loadedDateRanges) {
        const [loadedStart, loadedEnd] = loadedRange.split('_');
        if (startDate >= loadedStart && endDate <= loadedEnd) {
            console.log(`⚡ [LOAD] Rango contenido en ${loadedStart} - ${loadedEnd}, filtrando localmente`);
            return false;
        }
    }
    
    return true;
}

/**
 * Registra un rango de fechas como cargado
 */
function markRangeAsLoaded(startDate, endDate) {
    const rangeKey = `${startDate}_${endDate}`;
    if (!LOAD_STATE.loadedDateRanges.includes(rangeKey)) {
        LOAD_STATE.loadedDateRanges.push(rangeKey);
        // Mantener solo los últimos 5 rangos para no acumular demasiado
        if (LOAD_STATE.loadedDateRanges.length > 5) {
            LOAD_STATE.loadedDateRanges.shift();
        }
    }
    LOAD_STATE.lastDateFilter = rangeKey;
}

/**
 * Limpia el caché de rangos cargados (para forzar recarga)
 */
function clearLoadedRanges() {
    LOAD_STATE.loadedDateRanges = [];
    LOAD_STATE.lastDateFilter = null;
    console.log('🧹 [LOAD] Caché de rangos limpiado');
}

/**
 * FUNCIÓN LEGACY - Mantener compatibilidad
 * Ahora llama a loadCriticalData()
 */
async function loadAllData() {
    await loadCriticalData();
}

/**
 * Fuerza actualización de todas las BDs de referencia (botón manual)
 */
async function forceRefreshReferenceData() {
    showNotification('🔄 Actualizando datos de referencia...', 'info');
    
    if (dispatchSyncManager) {
        await dispatchSyncManager.refreshReferenceData();
    }
    
    // Recargar datos
    await loadAllData();
    
    showNotification('✅ Datos de referencia actualizados', 'success');
}

/**
 * Fuerza actualización de BD operativa (polling manual)
 */
async function forceRefreshOperationalData() {
    if (dispatchSyncManager) {
        showNotification('🔄 Actualizando BD operativa...', 'info');
        await dispatchSyncManager.forceOperationalRefresh();
        showNotification('✅ BD operativa actualizada', 'success');
    }
}

function parseOBCData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.obcData.clear();

    // Parse data from bottom to top (más recientes primero)
    // Esto asegura que en caso de duplicados, prevalezca el registro más reciente
    const ordersArray = [];

    console.log('🔍 Parsing OBC Data - Total lines:', lines.length);

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 6) {
            const orden = cols[0]?.trim();
            if (orden) {
                // Columna F (índice 5): Cantidad de cajas en la pestaña Resumen
                const totalCajasRaw = cols[5]?.trim() || '0';
                const totalCajas = parseInt(totalCajasRaw) || 0;

                // Debug: Log first 3 orders to verify parsing
                if (i <= 3) {
                    console.log(`📦 Order ${orden}: totalCajasRaw="${totalCajasRaw}" → totalCajas=${totalCajas}, cols[5]="${cols[5]}"`);
                }

                ordersArray.push({
                    orden,
                    referenceNo: cols[1]?.trim() || '',
                    shippingService: cols[2]?.trim() || '',
                    trackingCode: cols[3]?.trim() || '',
                    expectedArrival: cols[4]?.trim() || '',
                    totalCajas: totalCajas, // CORREGIDO: Cantidad de cajas desde columna F
                    recipient: cols[6]?.trim() || '',
                    boxType: cols[7]?.trim() || '',
                    customBarcode: cols[8]?.trim() || '',
                    remark: cols[9]?.trim() || '',
                    rowIndex: i
                });
            }
        }
    }

    // Procesamiento Bottom-up: los registros más recientes (al final del CSV) tienen prioridad
    // Invertir el array para procesar de abajo hacia arriba
    ordersArray.reverse();

    // Agregar al Map, los primeros en procesarse sobrescriben duplicados
    ordersArray.forEach(orderData => {
        if (!STATE.obcData.has(orderData.orden)) {
            STATE.obcData.set(orderData.orden, orderData);
        }
    });

    console.log('✅ OBC Data parsed:', STATE.obcData.size, 'orders');
}

function parseBDCajasData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());

    // Limpiar datos previos
    STATE.bdCajasData.clear();
    STATE.obcData.clear();

    // Maps temporales para consolidación
    const cajasCountMap = new Map();      // OBC → cantidad de cajas
    const obcConsolidated = new Map();    // OBC → datos consolidados
    const allBoxCodes = new Map();        // Código → [cajas]

    console.log('🔍 Parsing BD Completa (gid=0) - Total lines:', lines.length);

    // Debug: Mostrar las primeras 3 líneas para verificar estructura
    if (lines.length > 0) {
        console.log('📄 Header (línea 0):', lines[0].substring(0, 200));
    }
    if (lines.length > 1) {
        console.log('📄 Primera fila de datos (línea 1):', lines[1].substring(0, 200));
    }

    // PASO 1: Procesar todas las filas y consolidar por OBC
    let processedCount = 0;
    let skippedCount = 0;

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);

        // Debug para las primeras 3 filas
        if (i <= 3) {
            console.log(`📊 Línea ${i}: ${cols.length} columnas - OBC: "${cols[0]}", Código: "${cols[8]}"`);
        }

        if (cols.length >= 9) {
            const obc = cols[0]?.trim();
            const codigo = cols[8]?.trim();

            if (obc) {
                processedCount++;

                // Consolidar datos de la orden (tomando el primer registro encontrado)
                if (!obcConsolidated.has(obc)) {
                    obcConsolidated.set(obc, {
                        orden: obc,
                        referenceNo: cols[1]?.trim() || '',
                        shippingService: cols[2]?.trim() || '',
                        trackingCode: cols[3]?.trim() || '',
                        expectedArrival: cols[4]?.trim() || '',
                        remark: cols[5]?.trim() || '',
                        recipient: cols[6]?.trim() || '',
                        boxType: cols[7]?.trim() || '',
                        customBarcode: codigo || '',
                        totalCajas: 0,  // Se calculará después
                        totalCajasCalculado: true
                    });
                }

                // Contar cajas por OBC (cada fila = 1 caja)
                cajasCountMap.set(obc, (cajasCountMap.get(obc) || 0) + 1);

                // Indexar por código de caja para búsqueda rápida
                if (codigo) {
                    const codigoUpper = codigo.toUpperCase();
                    if (!allBoxCodes.has(codigoUpper)) {
                        allBoxCodes.set(codigoUpper, []);
                    }
                    allBoxCodes.get(codigoUpper).push({
                        obc: obc,
                        referenceNo: cols[1]?.trim() || '',
                        shippingService: cols[2]?.trim() || '',
                        trackingCode: cols[3]?.trim() || '',
                        expectedArrival: cols[4]?.trim() || '',
                        remark: cols[5]?.trim() || '',
                        recipient: cols[6]?.trim() || '',
                        boxType: cols[7]?.trim() || '',
                        codigoCaja: codigo
                    });
                }
            } else {
                skippedCount++;
            }
        } else {
            skippedCount++;
        }
    }

    console.log(`📊 Procesadas: ${processedCount} filas, Omitidas: ${skippedCount} filas`);

    // PASO 2: Asignar cantidad de cajas a cada orden consolidada
    cajasCountMap.forEach((count, obc) => {
        if (obcConsolidated.has(obc)) {
            obcConsolidated.get(obc).totalCajas = count;
        }
    });

    // PASO 3: Transferir datos consolidados a STATE
    STATE.obcData = obcConsolidated;
    STATE.bdCajasData = allBoxCodes;

    console.log(`✅ BD Completa cargada: ${STATE.obcData.size} órdenes consolidadas, ${STATE.bdCajasData.size} códigos de caja únicos`);
    console.log(`📊 Total de registros procesados: ${lines.length - 1} filas`);

    // 🔍 DEBUG: Auditoría de OBCs problemáticos
    const debugOBCs = ['OBC3822601050RS', 'OBC0592601040S1', 'OBC4102601090RY'];
    debugOBCs.forEach(obc => {
        if (STATE.obcData.has(obc)) {
            const data = STATE.obcData.get(obc);
            console.log(`🔍 AUDIT BD_CAJAS ${obc}:`);
            console.log(`   - Existe en obcData: true`);
            console.log(`   - Total cajas (filas): ${data.totalCajas}`);
            console.log(`   - Destino: ${data.recipient}`);
            console.log(`   - Fecha: ${data.expectedArrival}`);
        } else {
            console.warn(`🔍 AUDIT BD_CAJAS ${obc}: ⚠️ NO ENCONTRADO en obcData`);
        }
    });

    // Debug: Mostrar primeras 3 órdenes
    let debugCount = 0;
    for (const [obc, data] of STATE.obcData.entries()) {
        if (debugCount < 3) {
            console.log(`📦 Orden ${obc}: ${data.totalCajas} cajas, Destino: ${data.recipient}, Fecha: ${data.expectedArrival}`);
            debugCount++;
        }
    }
}

function parseListasData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.operadores = [];
    STATE.unidades = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const operador = cols[1]?.trim().toUpperCase();
        const unidad = cols[3]?.trim().toUpperCase();

        if (operador && !STATE.operadores.includes(operador)) {
            STATE.operadores.push(operador);
        }
        if (unidad && !STATE.unidades.includes(unidad)) {
            STATE.unidades.push(unidad);
        }
    }

    populateOperadoresUnidades();
}

function populateOperadoresUnidades() {
    const operadorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');

    if (operadorSelect) {
        operadorSelect.innerHTML = '<option value="">👤 Seleccionar Conductor...</option>' +
            STATE.operadores.map(op => `<option value="${op}">${op}</option>`).join('');
    }

    if (unidadSelect) {
        unidadSelect.innerHTML = '<option value="">🚛 Seleccionar Unidad/Placas...</option>' +
            STATE.unidades.map(un => `<option value="${un}">${un}</option>`).join('');
    }
}

function parseTRSData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.trsData = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 15 && cols[0]?.startsWith('TRS')) {
            STATE.trsData.push({
                trs: cols[0]?.trim(),
                referencia: cols[6]?.trim() || '',
                codigoOriginal: cols[13]?.trim() || '',
                codigoNuevo: cols[14]?.trim() || ''
            });
        }
    }
}

function parseValidacionData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.validacionData.clear();

    // 🔍 DEBUG: Contadores para auditoría
    const debugOBCs = ['OBC3822601050RS', 'OBC0592601040S1', 'OBC4102601090RY'];
    const debugCounters = new Map();
    const debugCodigosUnicos = new Map();

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 5) {
            const orden = cols[3]?.trim();
            const codigo = cols[4]?.trim();

            if (orden) {
                if (!STATE.validacionData.has(orden)) {
                    STATE.validacionData.set(orden, []);
                }
                STATE.validacionData.get(orden).push({
                    fecha: cols[0]?.trim() || '',
                    hora: cols[1]?.trim() || '',
                    usuario: cols[2]?.trim() || '',
                    orden: orden,
                    codigo: codigo || '',
                    ubicacion: cols[5]?.trim() || '',
                    porcentaje: cols[6]?.trim() || '',
                    nota: cols[7]?.trim() || ''
                });

                // 🔍 DEBUG: Rastrear OBCs problemáticos
                if (debugOBCs.includes(orden)) {
                    debugCounters.set(orden, (debugCounters.get(orden) || 0) + 1);
                    if (!debugCodigosUnicos.has(orden)) {
                        debugCodigosUnicos.set(orden, new Set());
                    }
                    if (codigo) {
                        debugCodigosUnicos.get(orden).add(codigo);
                    }
                }
            }
        }
    }

    console.log('✅ Validacion Data parsed:', STATE.validacionData.size, 'orders');

    // 🔍 DEBUG: Reportar problemas detectados
    debugOBCs.forEach(obc => {
        const registros = debugCounters.get(obc) || 0;
        const codigosUnicos = debugCodigosUnicos.get(obc)?.size || 0;
        const existe = STATE.validacionData.has(obc);

        console.log(`🔍 AUDIT ${obc}:`);
        console.log(`   - Existe en validacionData: ${existe}`);
        console.log(`   - Registros totales: ${registros}`);
        console.log(`   - Códigos únicos: ${codigosUnicos}`);

        if (registros > codigosUnicos) {
            console.warn(`   ⚠️ DUPLICIDAD DETECTADA: ${registros} registros vs ${codigosUnicos} códigos únicos`);
        }

        // Comparar con obcData
        if (STATE.obcData.has(obc)) {
            const totalCajasEsperadas = STATE.obcData.get(obc).totalCajas;
            console.log(`   - Cajas esperadas (obcData): ${totalCajasEsperadas}`);
            if (registros !== totalCajasEsperadas) {
                console.warn(`   ⚠️ DESAJUSTE: ${registros} validaciones vs ${totalCajasEsperadas} cajas esperadas`);
            }
        }
    });
}

/**
 * Cuenta el número de cajas únicas validadas para una orden
 * Maneja duplicados contando solo códigos de caja únicos
 * @param {string} orden - El código OBC de la orden
 * @returns {number} - Cantidad de cajas únicas validadas
 */
function getCajasValidadasUnicas(orden) {
    const validaciones = STATE.validacionData.get(orden) || [];

    if (validaciones.length === 0) {
        return 0;
    }

    // Extraer códigos únicos (ignorando registros duplicados)
    const codigosUnicos = new Set(
        validaciones
            .map(v => v.codigo)
            .filter(c => c && c.trim() !== '') // Ignorar códigos vacíos
            .map(c => c.trim().toUpperCase())   // Normalizar (trim + mayúsculas)
    );

    return codigosUnicos.size;
}

function parseMNEData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.mneData.clear();

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 6) {
            const obc = cols[3]?.trim();
            if (obc && !cols[0]?.toLowerCase().includes('fecha')) {
                if (!STATE.mneData.has(obc)) {
                    STATE.mneData.set(obc, []);
                }
                STATE.mneData.get(obc).push({
                    fecha: cols[0]?.trim() || '',
                    mes: cols[1]?.trim() || '',
                    obc: obc,
                    ib: cols[4]?.trim() || '',
                    codigo: cols[5]?.trim() || '',
                    responsable: cols[12]?.trim() || '',
                    estado: cols[16]?.trim() || '📦 En proceso'
                });
            }
        }
    }
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

async function reloadData() {
    if (!gapi?.client?.getToken()) {
        showNotification('⚠️ No estás autenticado', 'warning');
        return;
    }

    console.log('🔄 [RELOAD] Iniciando recarga completa de datos...');

    showPreloader('Recargando datos...', 'Descargando información actualizada');

    try {
        // OPTIMIZACIÓN: Invalidar TODOS los cachés del sync manager
        if (dispatchSyncManager) {
            console.log('🗑️ [RELOAD] Invalidando caché del sync manager...');
            dispatchSyncManager.cache.operational.data = null;
            dispatchSyncManager.cache.operational.timestamp = 0;
            dispatchSyncManager.cache.operational.version = 0;

            // Invalidar todas las bases de datos de referencia
            console.log('🗑️ [RELOAD] Invalidando cachés de referencia (VALIDACION, MNE, TRS, LISTAS)...');
            dispatchSyncManager.cache.reference.validacion = { data: null, lastUpdate: null };
            dispatchSyncManager.cache.reference.mne = { data: null, lastUpdate: null };
            dispatchSyncManager.cache.reference.trs = { data: null, lastUpdate: null };
            dispatchSyncManager.cache.reference.listas = { data: null, lastUpdate: null };
        }

        // OPTIMIZACIÓN: Limpiar rangos de carga para forzar recarga
        if (typeof clearLoadedRanges === 'function') {
            console.log('🗑️ [RELOAD] Limpiando rangos de carga...');
            clearLoadedRanges();
        }

        // OPTIMIZACIÓN: Resetear flags de carga
        console.log('🗑️ [RELOAD] Reseteando flags de carga...');
        LOAD_STATE.criticalLoaded = false;
        LOAD_STATE.referenceLoaded = false;
        LOAD_STATE.backgroundLoading = false;

        // OPTIMIZACIÓN: Forzar recarga completa
        console.log('📥 [RELOAD] Ejecutando loadAllData...');
        await loadAllData();

        // OPTIMIZACIÓN: Forzar recarga de bases de datos de referencia con cache-busting
        console.log('🔄 [RELOAD] Forzando recarga de bases de datos de referencia...');
        await loadReferenceDataInBackground();

        // OPTIMIZACIÓN: Forzar sincronización transaccional
        console.log('🔄 [RELOAD] Forzando sincronización transaccional...');
        await syncTransactionalData();

        // IMPORTANTE: Actualizar contador de registros después de la recarga
        console.log('📊 [RELOAD] Actualizando contador de registros...');
        updateBdInfo();
        updateSummary();
        updateTabBadges();

        hidePreloader();

        // Mostrar notificación con la cantidad de registros cargados
        const totalRegistros = STATE.obcData.size;
        showNotification(`✅ Datos actualizados: ${totalRegistros} registros cargados`, 'success');

        console.log(`✅ [RELOAD] Recarga completa finalizada - ${totalRegistros} registros`);

    } catch (error) {
        console.error('❌ [RELOAD] Error en recarga de datos:', error);
        hidePreloader();
        showNotification('❌ Error al recargar datos: ' + error.message, 'error');
    }
}

function updateBdInfo() {
    if (window.sidebarComponent) {
        window.sidebarComponent.updateBDInfo(STATE.obcData.size);
    }
}

async function toggleConnection() {
    if (gapi?.client?.getToken()) {
        // Ya está conectado, preguntar si desea desconectar
        if (confirm('¿Desconectar de Google?\n\nLos datos no sincronizados se guardarán localmente.\nPodrás reconectar sin perder tu sesión.')) {
            // Solo desconectar de Google, NO borrar tokens de localStorage
            try {
                const token = gapi.client.getToken();
                if (token?.access_token) {
                    google.accounts.oauth2.revoke(token.access_token);
                }
            } catch (e) {
                console.warn('⚠️ No se pudo revocar token:', e);
            }
            gapi.client.setToken('');

            // IMPORTANTE: NO borrar localStorage tokens aquí
            // Solo se borran en logout completo (handleLogout)

            // Actualizar estado en sidebar
            if (window.sidebarComponent) {
                window.sidebarComponent.avatarState.isGoogleConnected = false;
                window.sidebarComponent.saveAvatarData();
                window.sidebarComponent.updateAvatarButtons();
            }

            showNotification('🔌 Desconectado de Google. Reconecta para sincronizar.', 'info');
        }
    } else {
        // MEJORA: Reconectar sin salir a login - primero intentar desde localStorage
        await handleGoogleReconnect();
    }
}

/**
 * MEJORA: Reconexión de Google sin redirección
 * Primero intenta restaurar token desde localStorage
 */
async function handleGoogleReconnect() {
    console.log('🔗 [DISPATCH] Iniciando conexión con Google...');

    // Intentar restaurar token guardado primero (reconexión rápida)
    const savedToken = localStorage.getItem('gapi_token');
    const tokenExpiry = localStorage.getItem('gapi_token_expiry');

    if (savedToken && tokenExpiry) {
        const expiryTime = parseInt(tokenExpiry, 10);
        const now = Date.now();

        // Si el token aún es válido, restaurarlo directamente
        if (expiryTime > now + (60 * 1000)) { // Margen de 1 minuto
            console.log('🔄 [DISPATCH] Restaurando token desde localStorage...');
            showReconnectOverlay(true);

            try {
                const tokenObj = JSON.parse(savedToken);
                gapi.client.setToken(tokenObj);

                // Verificar que el token funcione
                const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${tokenObj.access_token}` }
                });

                if (response.ok) {
                    console.log('✅ [DISPATCH] Token restaurado exitosamente');

                    // Actualizar estado
                    if (window.sidebarComponent) {
                        window.sidebarComponent.avatarState.isGoogleConnected = true;
                        window.sidebarComponent.saveAvatarData();
                        window.sidebarComponent.updateAvatarButtons();
                    }

                    showReconnectOverlay(false);
                    showNotification('✅ Reconectado a Google', 'success');

                    // Recargar datos si es necesario
                    if (STATE.obcData.size === 0) {
                        await loadAllData();
                    }
                    return;
                }
            } catch (e) {
                console.warn('⚠️ [DISPATCH] Token guardado inválido, solicitando nuevo...');
            }

            showReconnectOverlay(false);
        }
    }

    // Si no hay token válido en localStorage, solicitar nuevo
    if (!tokenClient) {
        showContextualError('auth_error', 'tokenClient no inicializado');
        return;
    }

    // Mostrar overlay de bloqueo
    showReconnectOverlay(true);

    try {
        console.log('🔄 [DISPATCH] Solicitando nuevo token de Google...');

        // Realizar reconexión sin redirección
        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                console.error('Error de reconexión:', resp);
                showContextualError('auth_error', resp.error);
                showReconnectOverlay(false);
                return;
            }

            console.log('✅ [DISPATCH] Reconexión exitosa');

            // Guardar token para futura reconexión rápida
            const tokenObj = gapi.client.getToken();
            if (tokenObj) {
                localStorage.setItem('gapi_token', JSON.stringify(tokenObj));
                const expiresIn = resp.expires_in || 3600;
                const expiryTime = Date.now() + (expiresIn * 1000);
                localStorage.setItem('gapi_token_expiry', expiryTime.toString());
            }

            // Actualizar estado
            if (window.sidebarComponent) {
                window.sidebarComponent.avatarState.isGoogleConnected = true;
                window.sidebarComponent.saveAvatarData();
                window.sidebarComponent.updateAvatarButtons();
            }

            showReconnectOverlay(false);
            showNotification('✅ Cuenta de Google reconectada', 'success');

            // Recargar datos si es necesario
            if (STATE.obcData.size === 0) {
                await loadAllData();
            }
        };

        tokenClient.requestAccessToken({ prompt: '' });

    } catch (error) {
        console.error('Error en reconexión:', error);
        showContextualError('auth_error', error.message);
        showReconnectOverlay(false);
    }
}

/**
 * Muestra overlay de reconexión
 */
function showReconnectOverlay(show) {
    let overlay = document.getElementById('reconnect-overlay');
    
    if (show && !overlay) {
        overlay = document.createElement('div');
        overlay.id = 'reconnect-overlay';
        overlay.className = 'preloader-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="preloader-content">
                <div class="preloader-spinner"></div>
                <div class="preloader-text" style="color: #333;">🔄 Reconectando con Google...</div>
                <div class="preloader-subtext" style="color: #666;">Por favor espere, no cierre esta ventana</div>
            </div>
        `;
        document.body.appendChild(overlay);
    } else if (!show && overlay) {
        overlay.remove();
    }
}

/**
 * MEJORA: Sistema de alertas contextuales para errores
 */
function showContextualError(errorType, details = '') {
    let title, message, action, actionCallback;
    
    switch(errorType) {
        case 'auth_error':
            title = '🔐 Error de Autenticación';
            message = 'Por favor, desconecte manualmente su cuenta de Google y vuelva a conectarla.';
            action = 'Ir a Configuración';
            actionCallback = () => {
                // Abrir panel de usuario
                document.querySelector('.user-avatar')?.click();
            };
            break;
            
        case 'server_error':
            title = '🔴 Problemas de Comunicación';
            message = 'El servidor no responde. Por favor, recargue la página para reintentar.';
            action = 'Recargar Página';
            actionCallback = () => location.reload();
            break;
            
        case 'network_error':
            title = '📡 Sin Conexión a Internet';
            message = 'Verifique su red. Los datos se guardarán localmente hasta que se restablezca la conexión.';
            action = null;
            break;
            
        case 'timeout_error':
            title = '⏱️ Tiempo de Espera Agotado';
            message = 'La operación tardó demasiado. Verifique su conexión e intente nuevamente.';
            action = 'Reintentar';
            actionCallback = () => location.reload();
            break;
            
        default:
            title = '❌ Error';
            message = details || 'Ha ocurrido un error inesperado.';
            action = null;
    }
    
    // Crear modal de error contextual
    const modal = document.createElement('div');
    modal.className = 'popup-overlay show';
    modal.innerHTML = `
        <div class="popup-content" style="max-width: 500px;">
            <div class="popup-header" style="background: #fee2e2; color: #991b1b;">
                <span>${title}</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <div style="padding: 25px;">
                <p style="color: #374151; font-size: 1.05em; line-height: 1.6; margin-bottom: 20px;">
                    ${message}
                </p>
                ${details ? `<p style="color: #6b7280; font-size: 0.9em; background: #f3f4f6; padding: 12px; border-radius: 6px; margin-bottom: 15px;"><strong>Detalles:</strong> ${details}</p>` : ''}
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    ${action ? `<button class="btn btn-primary" onclick="this.closest('.popup-overlay').remove(); (${actionCallback})()">${action}</button>` : ''}
                    <button class="btn btn-secondary" onclick="this.closest('.popup-overlay').remove()">Cerrar</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // También mostrar notificación
    showNotification(`${title}: ${message}`, 'error');
}

// ==================== UI FUNCTIONS ====================
function showSearchPanel() {
    // CHANGE 1: Show global navigation and enforce date filter
    showGlobalNavigation();
    
    // Si venimos de la vista de Gestión de Folios, cerrarla primero con transición
    const foliosMgmtContent = document.getElementById('folios-management-content');
    if (foliosMgmtContent && foliosMgmtContent.style.display !== 'none') {
        isInFoliosManagementView = false;
        foliosMgmtContent.style.display = 'none';
    }
    
    // ==================== FORZAR SELECCIÓN DE FILTRO ====================
    // SIEMPRE mostrar modal de filtro si no hay filtro activo
    // Esto previene el bucle de carga vacía después de cerrar sesión
    if (!STATE.dateFilter.active) {
        console.log('🔄 [INICIO] No hay filtro activo - Forzando selección de filtro');
        showDateFilterForDispatch();
        return;
    }
    
    // Si hay filtro activo pero no hay datos, cargar datos
    if (STATE.obcData.size === 0 && STATE.dateFilter.active) {
        console.log('🔄 [INICIO] Filtro activo pero sin datos - Recargando...');
        showDateFilterForDispatch();
        return;
    }
    
    // ==================== INICIAR DESDE CERO ====================
    // Resetear a vista TODO limpia
    console.log('✅ [INICIO] Iniciando despacho desde cero - Vista TODO');
    
    // Limpiar todos los filtros
    clearAllFilters();
    
    // Resetear selecciones
    resetAllSelections();
    
    // Forzar cambio a pestaña TODO
    switchValidationTab('todo');
}

function showDateFilterForDispatch() {
    const today = new Date();
    
    // Pre-cargar fecha de hoy
    document.getElementById('date-start').value = today.toISOString().slice(0, 10);
    document.getElementById('date-end').value = today.toISOString().slice(0, 10);
    
    // Marcar que es inicio de despacho
    document.getElementById('date-filter-modal').setAttribute('data-dispatch-init', 'true');
    document.getElementById('date-filter-modal').classList.add('show');
}

function activateSearchPanelWithFilter() {
    // Switch to "Todo" tab instead of "Pendientes"
    switchValidationTab('todo');

    setTimeout(() => {
        document.getElementById('search-input')?.focus();
    }, 100);
}

function backToStart() {
    console.log('🔄 [CIERRE SESIÓN] Iniciando limpieza total...');
    
    // Ocultar todos los paneles
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('validated-content').style.display = 'none';
    document.getElementById('folios-content').style.display = 'none';
    document.getElementById('folio-details-content').style.display = 'none';
    const foliosMgmtContent = document.getElementById('folios-management-content');
    if (foliosMgmtContent) foliosMgmtContent.style.display = 'none';
    document.getElementById('welcome-state').style.display = 'flex';
    
    // ==================== LIMPIAR SESIÓN COMPLETA ====================
    // Limpiar filtro de fecha
    STATE.dateFilter.active = false;
    STATE.dateFilter.startDate = null;
    STATE.dateFilter.endDate = null;
    
    // Limpiar datos filtrados
    STATE.obcDataFiltered.clear();
    
    // Limpiar TODOS los datos cargados (forzar recarga en próxima sesión)
    STATE.obcData.clear();
    STATE.validacionData.clear();
    STATE.mneData.clear();
    STATE.bdCajasData.clear();
    STATE.trsData = [];
    
    // Limpiar datos de validación local (se recargarán en próxima sesión)
    STATE.localValidated = [];
    STATE.localPending = [];
    
    // Limpiar folios de cargas
    STATE.foliosDeCargas.clear();
    
    // Limpiar orden actual
    STATE.currentOrder = null;
    STATE.currentFolio = null;
    STATE.exceptionOrder = null;
    
    // Limpiar flags
    STATE.fromFolios = false;
    STATE.fromFoliosManagement = false;
    isInFoliosManagementView = false;
    
    // Reset tabs to pending
    STATE.activeTab = 'pending';
    document.getElementById('tab-pending')?.classList.add('active');
    document.getElementById('tab-validated')?.classList.remove('active');
    
    // ==================== LIMPIAR INPUTS DE FILTRO (UNMOUNT) ====================
    // Limpiar inputs de filtro de fecha para forzar remount
    const dateStart = document.getElementById('date-start');
    const dateEnd = document.getElementById('date-end');
    if (dateStart) {
        dateStart.value = '';
        dateStart.removeAttribute('value');
    }
    if (dateEnd) {
        dateEnd.value = '';
        dateEnd.removeAttribute('value');
    }
    
    // Limpiar displays de filtro
    const dateFilterText = document.getElementById('date-filter-text');
    const dateFilterBtn = document.getElementById('date-filter-display');
    if (dateFilterText) dateFilterText.textContent = 'Seleccionar fechas';
    if (dateFilterBtn) dateFilterBtn.classList.remove('active-filter');
    
    // Limpiar contadores del sidebar
    if (window.sidebarComponent) {
        window.sidebarComponent.updateSummary({
            summaryTotal: 0,
            validated: 0,
            pending: 0
        });
    }

    // ==================== LIMPIEZA TOTAL DE LOCALSTORAGE ====================
    console.log('🗑️ [CIERRE SESIÓN] Limpiando localStorage...');
    
    try {
        // Limpiar estado de despacho
        localStorage.removeItem('dispatch_local_state');
        
        // Limpiar validaciones locales
        localStorage.removeItem('localValidated');
        
        // Limpiar filtros guardados
        localStorage.removeItem('dispatch_date_filter');
        
        // Limpiar sesión activa
        localStorage.removeItem('dispatch_active_session');
        
        // Limpiar índice de background (forzar recarga)
        if (typeof clearBackgroundIndex === 'function') {
            clearBackgroundIndex();
        }
        
        console.log('✅ [CIERRE SESIÓN] localStorage limpiado completamente');
    } catch (e) {
        console.error('❌ Error limpiando localStorage:', e);
    }
    
    // Reset load state para forzar recarga en próxima sesión
    LOAD_STATE.criticalLoaded = false;
    LOAD_STATE.referencesLoaded = false;
    LOAD_STATE.loadedDateRanges = []; // Limpiar rangos cargados en caché

    // CHANGE 1: Hide global navigation on welcome screen
    hideGlobalNavigation();
    
    console.log('✅ [CIERRE SESIÓN] Sesión cerrada completamente - Sistema listo para nueva sesión');
}

/**
 * Show exit confirmation modal
 */
function confirmExit() {
    const modal = document.getElementById('exit-confirm-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Close exit confirmation modal
 */
function closeExitConfirm() {
    const modal = document.getElementById('exit-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Execute exit after confirmation
 */
function executeExit() {
    closeExitConfirm();
    backToStart();
}

function updateSummary() {
    // ==================== USAR MISMA FUENTE QUE TABLAS ====================
    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;
    
    // Contar órdenes totales (OBC) - DIRECTAMENTE desde el Map
    const totalCount = dataToUse.size;
    
    // MEJORA: Configurar deep linking en tarjetas de resumen
    setupSummaryCardLinks();
    
    // Contar validadas - usar la misma lógica que updateTabBadges
    let validatedCount = 0;
    let pendingCount = 0;
    
    // Filtrar validadas por fecha si hay filtro activo
    if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
        const startDate = parseDateLocal(STATE.dateFilter.startDate);
        const endDate = parseDateLocal(STATE.dateFilter.endDate);
        endDate.setHours(23, 59, 59, 999);

        validatedCount = STATE.localValidated.filter(record => {
            const orderData = STATE.obcData.get(record.orden) || {};
            const dateStr = orderData.expectedArrival || record.fecha;
            if (!dateStr) return false;
            const orderDate = parseDateLocal(dateStr);
            return orderDate && orderDate >= startDate && orderDate <= endDate;
        }).length;
    } else {
        validatedCount = STATE.localValidated.length;
    }
    
    // Contar pendientes desde OBC - MISMO LOOP que renderOrdersTable
    for (const [orden] of dataToUse.entries()) {
        const { validated: isValidated } = isOrderValidated(orden);
        if (!isValidated) {
            pendingCount++;
        }
    }
    
    // ==================== VALIDACIÓN DE SINCRONIZACIÓN ====================
    console.log('📊 [SYNC] updateSummary - Contadores calculados:', {
        total: totalCount,
        validadas: validatedCount,
        pendientes: pendingCount,
        fuenteDatos: STATE.dateFilter.active ? 'obcDataFiltered' : 'obcData',
        filtroActivo: STATE.dateFilter.active
    });

    // Actualizar usando sidebarComponent
    if (window.sidebarComponent) {
        window.sidebarComponent.updateSummary({
            summaryTotal: totalCount,
            validated: validatedCount,
            pending: pendingCount
        });
    }

    // Update tab badges as well
    updateTabBadges();
}

/**
 * MEJORA: Configura deep linking en tarjetas de resumen
 */
function setupSummaryCardLinks() {
    // Buscar elementos de resumen específicos del sidebar
    const summaryItems = document.querySelectorAll('.summary-item');
    
    if (summaryItems.length === 0) {
        console.log('⚠️ No se encontraron summary-items para configurar deep linking');
        return;
    }
    
    summaryItems.forEach(function(item) {
        // Buscar el elemento de valor dentro del item
        const valueEl = item.querySelector('.summary-value');
        if (!valueEl) return;
        
        const itemId = valueEl.id;
        let targetTab = null;
        let sectionName = '';
        
        // Determinar tipo de tarjeta según el ID del elemento de valor
        if (itemId === 'summary-total') {
            targetTab = 'todo';
            sectionName = 'Todo';
        } else if (itemId === 'summary-pending') {
            targetTab = 'pending';
            sectionName = 'Pendientes';
        } else if (itemId === 'summary-validated') {
            targetTab = 'validated';
            sectionName = 'Validadas';
        }
        
        if (targetTab) {
            // Configurar estilos y eventos
            item.style.cursor = 'pointer';
            item.style.transition = 'transform 0.2s, box-shadow 0.2s';
            item.setAttribute('title', 'Ir a ' + sectionName);
            
            // Remover listeners previos
            var newItem = item.cloneNode(true);
            if (item.parentNode) {
                item.parentNode.replaceChild(newItem, item);
            }
            
            newItem.onmouseenter = function() {
                this.style.transform = 'translateY(-2px)';
                this.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            };
            
            newItem.onmouseleave = function() {
                this.style.transform = 'translateY(0)';
                this.style.boxShadow = '';
            };
            
            newItem.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('👉 Deep link: Navegando a ' + sectionName);
                
                // Obtener el conteo actual del elemento
                var currentValueEl = this.querySelector('.summary-value');
                var count = currentValueEl ? parseInt(currentValueEl.textContent || '0') : 0;
                
                console.log('📊 Conteo de ' + sectionName + ': ' + count);
                
                // Verificar si hay sección de despacho activa
                var searchPanel = document.getElementById('search-panel');
                var validatedContent = document.getElementById('validated-content');
                var hasActiveDispatch = (searchPanel && searchPanel.style.display !== 'none') || (validatedContent && validatedContent.style.display !== 'none');
                
                if (!hasActiveDispatch && targetTab !== 'todo') {
                    showNotification('ℹ️ Sin sección de despacho activa. Mostrando resumen global', 'info');
                    return;
                }
                
                // Para 'todo' siempre permitir navegación
                // Para otros, verificar si hay registros
                if (count === 0 && targetTab !== 'todo') {
                    showNotification('⚠️ La sección "' + sectionName + '" no contiene registros', 'warning');
                    return;
                }
                
                // Navegar a la pestaña
                try {
                    switchValidationTab(targetTab);
                    showNotification('📍 Navegando a ' + sectionName, 'success', 2000);
                } catch (error) {
                    console.error('Error navegando:', error);
                    showNotification('❌ Error al navegar a la sección', 'error');
                }
            };
        }
    });
}

function filterOrdersByDateRange() {
    STATE.obcDataFiltered.clear();

    if (!STATE.dateFilter.active || !STATE.dateFilter.startDate || !STATE.dateFilter.endDate) {
        return;
    }

    // Parse dates as local time to avoid timezone offset issues
    const startParts = STATE.dateFilter.startDate.split('-');
    const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
    startDate.setHours(0, 0, 0, 0);

    const endParts = STATE.dateFilter.endDate.split('-');
    const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
    endDate.setHours(23, 59, 59, 999);

    console.log(`🔍 Filtrando órdenes por rango: ${startDate.toLocaleDateString('es-ES')} - ${endDate.toLocaleDateString('es-ES')}`);

    let matchCount = 0;
    let sampleDates = [];

    for (const [orden, data] of STATE.obcData.entries()) {
        if (data.expectedArrival) {
            const orderDate = parseOrderDate(data.expectedArrival);

            // Recoger muestras de fechas para debugging
            if (sampleDates.length < 5) {
                sampleDates.push(`${data.expectedArrival} → ${orderDate ? orderDate.toLocaleDateString('es-ES') : 'INVALID'}`);
            }

            if (orderDate && orderDate >= startDate && orderDate <= endDate) {
                STATE.obcDataFiltered.set(orden, data);
                matchCount++;
            }
        }
    }

    console.log(`📊 Resultados del filtro: ${matchCount} órdenes coinciden de ${STATE.obcData.size} totales`);
    console.log(`📅 Muestra de fechas procesadas:`, sampleDates);
}

function parseOrderDate(dateStr) {
    if (!dateStr) return null;

    // Remover espacios extras
    const cleanStr = dateStr.trim();

    // Intentar parse directo (formato ISO: YYYY-MM-DD o YYYY-MM-DD HH:mm:ss)
    let date = new Date(cleanStr);
    if (!isNaN(date.getTime())) return date;

    // Intentar formato ISO 8601 explícito: YYYY-MM-DD HH:mm:ss
    const isoMatch = cleanStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (isoMatch) {
        const [, year, month, day, hours, minutes, seconds] = isoMatch;
        date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), 
                       parseInt(hours), parseInt(minutes), parseInt(seconds));
        if (!isNaN(date.getTime())) return date;
    }

    // Intentar formato dd/mm/yyyy o dd-mm-yyyy
    const parts = cleanStr.split(/[/-]/);
    if (parts.length === 3) {
        let d, m, y;

        // Detectar el formato según la longitud del primer segmento
        if (parts[0].length === 4) {
            // Formato YYYY-MM-DD o YYYY/MM/DD
            y = parseInt(parts[0]);
            m = parseInt(parts[1]);
            d = parseInt(parts[2]);
        } else {
            // Formato DD-MM-YYYY o DD/MM/YYYY
            d = parseInt(parts[0]);
            m = parseInt(parts[1]);
            y = parseInt(parts[2]);
        }

        const year = y < 100 ? 2000 + y : y;

        date = new Date(year, m - 1, d);
        if (!isNaN(date.getTime())) return date;
    }

    // Intentar formato DD/MM/YYYY HH:MM:SS (con hora)
    const partsWithTime = cleanStr.split(' ');
    if (partsWithTime.length >= 2) {
        const datePart = partsWithTime[0];
        const timePart = partsWithTime[1];
        
        const datePartsOnly = datePart.split(/[/-]/);
        const timePartsOnly = timePart.split(':');
        
        if (datePartsOnly.length === 3 && timePartsOnly.length >= 2) {
            const d = parseInt(datePartsOnly[0]);
            const m = parseInt(datePartsOnly[1]);
            const y = parseInt(datePartsOnly[2]);
            const year = y < 100 ? 2000 + y : y;
            
            const hours = parseInt(timePartsOnly[0]) || 0;
            const minutes = parseInt(timePartsOnly[1]) || 0;
            const seconds = timePartsOnly[2] ? parseInt(timePartsOnly[2]) : 0;

            date = new Date(year, m - 1, d, hours, minutes, seconds);
            if (!isNaN(date.getTime())) return date;
        }
    } else if (partsWithTime.length === 1) {
        // Solo fecha sin hora
        const datePart = partsWithTime[0];
        const datePartsOnly = datePart.split(/[/-]/);
        if (datePartsOnly.length === 3) {
            const d = parseInt(datePartsOnly[0]);
            const m = parseInt(datePartsOnly[1]);
            const y = parseInt(datePartsOnly[2]);
            const year = y < 100 ? 2000 + y : y;

            date = new Date(year, m - 1, d);
            if (!isNaN(date.getTime())) return date;
        }
    }

    return null;
}

/**
 * Formatea una fecha ISO 8601 (YYYY-MM-DD HH:mm:ss) a formato legible
 * @param {string} isoDateStr - Fecha en formato ISO 8601
 * @param {boolean} includeTime - Si se debe incluir la hora en el formato de salida
 * @returns {string} Fecha formateada (DD/MM/YYYY o DD/MM/YYYY HH:mm)
 */
function formatISO8601ForDisplay(isoDateStr, includeTime = false) {
    if (!isoDateStr) return '';
    
    const date = parseOrderDate(isoDateStr);
    if (!date || isNaN(date.getTime())) return isoDateStr; // Retornar original si no se puede parsear
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    if (includeTime) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    
    return `${day}/${month}/${year}`;
}

function formatDateDDMMYYYY(date) {
    if (!date) return '';

    // Si es string, intentar convertir a Date
    if (typeof date === 'string') {
        date = parseOrderDate(date) || new Date(date);
    }

    if (!(date instanceof Date) || isNaN(date.getTime())) return '';

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
}

// Format timestamp to display in Fecha Validación column
function formatValidationDateTime(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';

    // Use local timezone methods to avoid UTC offset issues
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${day}-${month}-${year} ${hours}:${minutes}`;
}

function renderOrdersTable(mode = 'pending') {
    const tableBody = document.getElementById('orders-table-body');
    if (!tableBody) return;

    if (STATE.isLoading) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="table-empty-state">
                    <div class="table-empty-icon">⏳</div>
                    <div class="table-empty-text">Cargando datos...</div>
                    <div class="table-empty-subtext">Espera mientras se descargan las bases de datos</div>
                </td>
            </tr>
        `;
        return;
    }

    // ==================== SINCRONIZACIÓN: Usar EXACTAMENTE la misma fuente que contadores ====================
    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;
    
    console.log('📊 [SYNC] renderOrdersTable - Fuente de datos:', {
        mode,
        filtroActivo: STATE.dateFilter.active,
        totalEnFuente: dataToUse.size,
        rangoFiltro: STATE.dateFilter.active ? `${STATE.dateFilter.startDate} → ${STATE.dateFilter.endDate}` : 'Sin filtro'
    });

    if (dataToUse.size === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="table-empty-state">
                    <div class="table-empty-icon">📭</div>
                    <div class="table-empty-text">No hay órdenes</div>
                    <div class="table-empty-subtext">Ajusta el filtro de fechas</div>
                </td>
            </tr>
        `;
        return;
    }

    const ordersArray = Array.from(dataToUse.entries());

    // Filtrar según el modo
    const filteredOrders = ordersArray.filter(([orden]) => {
        const { validated: isValidated, data: validatedData } = isOrderValidated(orden);

        if (mode === 'todo') {
            // Mostrar todas las órdenes (Pendiente + Validada + Otros)
            return true;
        } else if (mode === 'pending') {
            // Solo mostrar órdenes Pendiente o Pendiente Calidad
            // EXCLUIR: Canceladas, No Procesables, y Validadas normales
            if (isValidated && validatedData) {
                const estatus = validatedData.estatus || '';
                const calidad = validatedData.calidad || '';

                // EXCLUIR Canceladas y No Procesables
                if (estatus === 'Cancelada' || estatus === 'No Procesable') {
                    return false;
                }

                // Incluir solo si es Pendiente Calidad
                return calidad.includes('Pendiente') || estatus === 'Pendiente Calidad';
            }
            // Incluir si no está validada (Pendiente genuino)
            return !isValidated;
        }
        return !isValidated;
    });
    
    // ==================== VALIDACIÓN DE SINCRONIZACIÓN ====================
    console.log('📊 [SYNC] Resultados de filtrado:', {
        totalDespuesFiltro: filteredOrders.length,
        modo: mode
    });

    tableBody.innerHTML = filteredOrders.map(([orden, data]) => {
        const validaciones = STATE.validacionData.get(orden) || [];
        const rastreoData = STATE.mneData.get(orden) || [];
        // FIXED: Use totalCajas from OBC database (RESUMEN_ORDENES), not from validation/rastreo
        const totalCajas = data.totalCajas || 0;
        // FIXED: Count unique validated boxes instead of total records
        const cajasValidadas = getCajasValidadasUnicas(orden);
        const porcentajeValidacion = totalCajas > 0 ? Math.round((cajasValidadas / totalCajas) * 100) : 0;

        // 🔍 DEBUG: Auditoría en renderizado
        const debugOBCs = ['OBC3822601050RS', 'OBC0592601040S1', 'OBC4102601090RY'];
        if (debugOBCs.includes(orden)) {
            console.log(`🔍 RENDER ${orden}:`);
            console.log(`   - validaciones.length (registros): ${validaciones.length}`);
            console.log(`   - cajasValidadas (únicos): ${cajasValidadas}`);
            console.log(`   - totalCajas (obcData): ${totalCajas}`);
            console.log(`   - porcentaje calculado: ${porcentajeValidacion}%`);
            console.log(`   - rastreoData.length: ${rastreoData.length}`);

            if (validaciones.length !== cajasValidadas) {
                console.warn(`   ⚠️ DUPLICADOS CORREGIDOS: ${validaciones.length} registros → ${cajasValidadas} cajas únicas`);
            }
        }

        const tieneRastreo = rastreoData.length > 0;
        const { validated: isValidated, data: validatedData } = isOrderValidated(orden);

        // Determinar estado basado en lógica
        let statusBadge = '';

        if (isValidated && validatedData) {
            const estatus = validatedData.estatus || '';
            const calidad = validatedData.calidad || '';

            // Verificar si es "Otros" (Cancelada o No Procesable)
            if (estatus === 'Cancelada') {
                statusBadge = createStatusBadge('cancelada', 'Cancelada');
            } else if (estatus === 'No Procesable') {
                statusBadge = createStatusBadge('no-procesable', 'No Procesable');
            } else if (calidad.includes('Pendiente') || estatus === 'Pendiente Calidad') {
                // Pendiente Calidad
                statusBadge = createStatusBadge('pendiente', 'Pendiente Calidad');
            } else {
                // Validada
                statusBadge = createStatusBadge('validado', 'Validada');
            }
        } else {
            // No validada = Pendiente
            statusBadge = createStatusBadge('pendiente', 'Pendiente');
        }

        // CHANGE 6: Only show validation % if cajasValidadas > 0 AND totalCajas > 0
        // Handle over-validation case (more validated than expected)
        let validationDisplay;
        if (cajasValidadas === 0 || totalCajas === 0) {
            validationDisplay = '<span class="empty-cell">N/A</span>';
        } else if (cajasValidadas > totalCajas) {
            // Over-validation warning
            const exceso = cajasValidadas - totalCajas;
            validationDisplay = `
                <div class="progress-bar"><div class="progress-fill" style="width: 100%; background: #f59e0b;"></div></div>
                <span class="progress-text" style="color: #f59e0b;" title="⚠️ Sobre-validación: ${cajasValidadas} validadas vs ${totalCajas} esperadas (+${exceso})">⚠️ ${porcentajeValidacion}%</span>
            `;
        } else {
            validationDisplay = `<div class="progress-bar"><div class="progress-fill" style="width: ${porcentajeValidacion}%"></div></div><span class="progress-text">${porcentajeValidacion}%</span>`;
        }

        // Add validated-order class for visual highlight
        const rowClass = isValidated ? 'validated-order' : '';

        return `
            <tr data-orden="${orden}" class="${rowClass}">
                <td style="text-align: center;">
                    <input type="checkbox" class="row-checkbox" data-orden="${orden}" onclick="event.stopPropagation(); updateSelectionCount('orders');" style="cursor: pointer;">
                </td>
                <td style="white-space: nowrap;"><span class="order-code">${makeCopyable(orden)}</span></td>
                <td class="td-wrap">${data.recipient || '<span class="empty-cell">Sin destino</span>'}</td>
                <td style="white-space: nowrap;">${data.expectedArrival || '<span class="empty-cell">N/A</span>'}</td>
                <td style="white-space: nowrap;">${makeCopyable(data.referenceNo || 'N/A')}</td>
                <td style="white-space: nowrap;">${makeCopyable(data.trackingCode || 'N/A')}</td>
                <td style="text-align: center;">${totalCajas || '<span class="empty-cell">0</span>'}</td>
                <td>
                    ${validationDisplay}
                </td>
                <td style="text-align: center;">
                    <span class="rastreo-badge ${tieneRastreo ? 'si' : 'no'}">${tieneRastreo ? 'SI' : 'NO'}</span>
                </td>
                <td>
                    ${statusBadge}
                </td>
                <td>
                    <button class="btn-action dispatch" title="Ver detalles de orden">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 7h-9"></path>
                            <path d="M14 17H5"></path>
                            <circle cx="17" cy="17" r="3"></circle>
                            <circle cx="7" cy="7" r="3"></circle>
                        </svg>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Update order and box count badges
    updateOrdersBadges(mode);
}

// Update badges for orders count and boxes count in Pendientes/Todo screens
function updateOrdersBadges(mode) {
    const tableBody = document.getElementById('orders-table-body');
    if (!tableBody) return;

    // Count only visible rows
    const visibleRows = Array.from(tableBody.querySelectorAll('tr[data-orden]')).filter(row => row.style.display !== 'none');
    const totalOrders = visibleRows.length;
    let totalBoxes = 0;

    visibleRows.forEach(row => {
        // Get boxes count from column 6 (Cant. Cajas) - adjusted for checkbox column
        const boxesText = row.cells[6]?.textContent.trim() || '0';
        totalBoxes += parseInt(boxesText) || 0;
    });

    const ordersCountEl = document.getElementById('orders-count');
    const boxesCountEl = document.getElementById('orders-boxes-count');

    if (ordersCountEl) {
        ordersCountEl.textContent = `${totalOrders} ${totalOrders === 1 ? 'orden' : 'órdenes'}`;
    }
    if (boxesCountEl) {
        boxesCountEl.textContent = `${totalBoxes} ${totalBoxes === 1 ? 'caja' : 'cajas'}`;
    }
}

// Mantener compatibilidad con código existente
function renderOrdersList() {
    renderOrdersTable();
}

function filterOrdersTable() {
    // CHANGE 5: Use advanced filters if active - ALWAYS call applyAdvancedFilters
    // This ensures both text search AND dropdown filters work together
    applyAdvancedFilters('orders');
}

function filterValidatedTable() {
    // CHANGE 5: Use advanced filters if active - ALWAYS call applyAdvancedFilters
    // This ensures both text search AND dropdown filters work together
    applyAdvancedFilters('validated');
}

// Mantener compatibilidad con código existente
function filterOrdersList() {
    filterOrdersTable();
}

// ==================== ADVANCED FILTER SYSTEM (CHANGE 5) ====================

/**
 * Get unique values for a given criterion from the data
 * FIXED: Include ALL unique values, even empty ones
 */
function getUniqueFilterValues(view, criterion) {
    const uniqueValues = new Set();

    if (view === 'orders') {
        // Get data from ALL current visible orders in table
        const tableBody = document.getElementById('orders-table-body');
        if (!tableBody) return [];

        const rows = tableBody.querySelectorAll('tr[data-orden]');
        rows.forEach(row => {
            const orden = row.getAttribute('data-orden');
            const order = STATE.obcData.get(orden) || STATE.obcDataFiltered.get(orden);
            if (!order) return;

            let value = '';
            switch(criterion) {
                case 'destino':
                    value = row.cells[2]?.textContent.trim() || ''; // +1 for checkbox
                    break;
                case 'rastreo':
                    // Check rastreo from MNE data
                    // Columns: 0-Checkbox, 1-Orden, 2-Destino, 3-Horario, 4-Código, 5-Track, 6-Cajas, 7-Validaciones, 8-Rastreo, 9-Estatus
                    const rastreoText = row.cells[8]?.textContent.trim() || '';
                    value = rastreoText.includes('SI') ? 'SI' : 'NO';
                    break;
                case 'estatus':
                    // Get estatus from table
                    const estatusText = row.cells[9]?.textContent.trim() || '';
                    value = estatusText;
                    break;
                case 'conductor':
                case 'unidad':
                    // These are not in pending orders table
                    value = '';
                    break;
            }
            // Include ALL values, even empty/N/A
            uniqueValues.add(value || 'N/A');
        });
    } else if (view === 'validated') {
        // Get data from validated orders - from actual table
        // Columns: 0-Checkbox, 1-Orden, 2-FechaVal, 3-Destino, 4-Horario, 5-Cajas, 6-%Surtido, 7-Rastreo, 8-TRS, 9-CantDesp, 10-Estatus, 11-Calidad, 12-Conductor, 13-Unidad, 14-Folio
        const tableBody = document.getElementById('validated-table-body');
        if (!tableBody) return [];

        const rows = tableBody.querySelectorAll('tr[data-orden]');
        rows.forEach(row => {
            let value = '';
            switch(criterion) {
                case 'destino':
                    value = row.cells[3]?.textContent.trim() || 'N/A'; // +1 for checkbox
                    break;
                case 'conductor':
                    value = row.cells[12]?.textContent.trim() || 'N/A'; // +1 for checkbox
                    break;
                case 'unidad':
                    value = row.cells[13]?.textContent.trim() || 'N/A'; // +1 for checkbox
                    break;
                case 'rastreo':
                    const rastreoText = row.cells[7]?.textContent.trim() || ''; // +1 for checkbox
                    value = rastreoText.includes('SI') ? 'SI' : 'NO';
                    break;
                case 'estatus':
                    const estatusText = row.cells[10]?.textContent.trim() || 'N/A'; // +1 for checkbox
                    value = estatusText;
                    break;
            }
            uniqueValues.add(value);
        });
    } else if (view === 'folios') {
        // Get data from folios table
        const tableBody = document.getElementById('folios-table-body');
        if (!tableBody) return [];

        const rows = tableBody.querySelectorAll('tr');
        rows.forEach(row => {
            let value = '';
            switch(criterion) {
                case 'destino':
                    // For folios, we need to get destino from the orders in the folio
                    // This is aggregated, so we'll need a different approach
                    // For now, return empty to skip this filter
                    value = '';
                    break;
                case 'conductor':
                    value = row.cells[6]?.textContent.trim() || 'N/A';
                    break;
                case 'unidad':
                    value = row.cells[7]?.textContent.trim() || 'N/A';
                    break;
            }
            if (value) uniqueValues.add(value);
        });
    } else if (view === 'folio-details') {
        // Get data from folio-details table
        // Columns: 0-Orden, 1-FechaVal, 2-Destino, 3-Horario, 4-Cajas, 5-CantDesp, 6-Estatus, 7-Calidad, 8-Conductor, 9-Unidad
        const tableBody = document.getElementById('folio-details-table-body');
        if (!tableBody) return [];

        const rows = tableBody.querySelectorAll('tr[data-orden]');
        rows.forEach(row => {
            let value = '';
            switch(criterion) {
                case 'destino':
                    value = row.cells[2]?.textContent.trim() || 'N/A';
                    break;
                case 'conductor':
                    value = row.cells[8]?.textContent.trim() || 'N/A';
                    break;
                case 'unidad':
                    value = row.cells[9]?.textContent.trim() || 'N/A';
                    break;
                case 'rastreo':
                    // Rastreo is not shown in folio-details table, use 'N/A'
                    value = 'N/A';
                    break;
                case 'estatus':
                    value = row.cells[6]?.textContent.trim() || 'N/A';
                    break;
            }
            uniqueValues.add(value);
        });
    } else if (view === 'agenda') {
        // Get data from agenda view (grouped by destino)
        if (!STATE.vistaAgenda.datosAgrupados) return [];

        STATE.vistaAgenda.datosAgrupados.forEach(grupo => {
            grupo.ordenes.forEach(orden => {
                let value = '';
                switch(criterion) {
                    case 'destino':
                        value = grupo.destino;
                        break;
                    case 'estatus':
                        value = orden.estatus;
                        break;
                }
                if (value) uniqueValues.add(value);
            });
        });
    } else if (view === 'folios-mgmt') {
        // Get data from folios management table
        const tableBody = document.getElementById('folios-mgmt-table-body');
        if (!tableBody) return [];

        const rows = tableBody.querySelectorAll('tr[data-folio]');
        rows.forEach(row => {
            let value = '';
            switch(criterion) {
                case 'conductor':
                    value = row.cells[6]?.textContent.trim() || 'N/A';
                    break;
                case 'unidad':
                    value = row.cells[7]?.textContent.trim() || 'N/A';
                    break;
            }
            if (value) uniqueValues.add(value);
        });
    }

    return Array.from(uniqueValues).filter(v => v && v !== 'N/A').sort();
}

/**
 * Show filter dropdown with checkboxes for the selected criterion
 * FIXED: Added clear X button that appears when filters are active
 */
function showFilterDropdown(view) {
    const criterionSelect = document.getElementById(`filter-${view}-criterion`);
    const dropdown = document.getElementById(`filter-${view}-dropdown`);
    const criterion = criterionSelect.value;

    if (!criterion) {
        dropdown.style.display = 'none';
        return;
    }

    // Get unique values
    const values = getUniqueFilterValues(view, criterion);

    if (values.length === 0) {
        dropdown.innerHTML = '<div class="filter-dropdown-header">No hay valores disponibles</div>';
        dropdown.style.display = 'block';
        return;
    }

    // Build dropdown content
    const hasActiveFilters = STATE.advancedFilters[view].selectedValues.length > 0;
    let html = `
        <div class="filter-dropdown-header">
            <span>Seleccionar valores:</span>
            ${hasActiveFilters ? `<button class="filter-clear-btn" onclick="clearAdvancedFilters('${view}')" title="Limpiar filtros">✕</button>` : ''}
        </div>
    `;

    values.forEach(value => {
        // Check if this value with this criterion is selected
        const isChecked = STATE.advancedFilters[view].selectedValues.some(
            item => item.value === value && item.criterion === criterion
        );
        const checkboxId = `filter-${view}-${criterion}-${value.replace(/\s+/g, '-').replace(/[^\w-]/g, '_')}`;
        const escapedValue = value.replace(/'/g, "\\'");
        html += `
            <div class="filter-dropdown-item">
                <input type="checkbox"
                       id="${checkboxId}"
                       value="${value}"
                       ${isChecked ? 'checked' : ''}
                       onchange="toggleFilterValue('${view}', '${escapedValue}')">
                <label for="${checkboxId}">${value}</label>
            </div>
        `;
    });

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    // Update state
    STATE.advancedFilters[view].criterion = criterion;
}

/**
 * Toggle a filter value selection
 */
function toggleFilterValue(view, value) {
    const selectedValues = STATE.advancedFilters[view].selectedValues;
    const criterion = STATE.advancedFilters[view].criterion;

    // Find if this value already exists
    const index = selectedValues.findIndex(item => item.value === value && item.criterion === criterion);

    if (index === -1) {
        // Add new filter with criterion and value
        selectedValues.push({ criterion, value });
    } else {
        // Remove existing filter
        selectedValues.splice(index, 1);
    }

    // Apply filters
    applyAdvancedFilters(view);

    // Reset criterion selector back to default
    const criterionSelect = document.getElementById(`filter-${view}-criterion`);
    if (criterionSelect) {
        criterionSelect.value = '';
    }

    // Hide dropdown after selection
    const dropdown = document.getElementById(`filter-${view}-dropdown`);
    if (dropdown) {
        dropdown.style.display = 'none';
    }

    // Update active filter chips
    updateActiveFilterChips(view);
}

/**
 * Clear all advanced filters for a view
 */
function clearAdvancedFilters(view) {
    STATE.advancedFilters[view].selectedValues = [];
    STATE.advancedFilters[view].criterion = '';

    // Reset criterion selector
    const criterionSelect = document.getElementById(`filter-${view}-criterion`);
    if (criterionSelect) {
        criterionSelect.value = '';
    }

    // Hide dropdown
    const dropdown = document.getElementById(`filter-${view}-dropdown`);
    if (dropdown) {
        dropdown.style.display = 'none';
    }

    // Clear active filter chips
    updateActiveFilterChips(view);

    // Reapply filters (which will show all rows since no filters active)
    if (view === 'orders') {
        filterOrdersTable();
    } else if (view === 'validated') {
        filterValidatedTable();
    } else if (view === 'folios') {
        filterFoliosTable();
    }
}

/**
 * Update active filter chips display
 */
function updateActiveFilterChips(view) {
    const container = document.getElementById(`active-filters-${view}`);
    if (!container) return;

    const selectedValues = STATE.advancedFilters[view].selectedValues;

    if (selectedValues.length === 0) {
        container.innerHTML = '';
        return;
    }

    // Get criterion labels
    const criterionLabels = {
        'destino': '🏢',
        'conductor': '👤',
        'unidad': '🚛',
        'rastreo': '📍',
        'estatus': '📊'
    };

    // Each chip gets its own icon based on its criterion
    container.innerHTML = selectedValues.map(item => {
        const icon = criterionLabels[item.criterion] || '🔽';
        const escapedValue = item.value.replace(/'/g, "\\'");
        return `
            <div class="filter-chip">
                <span class="filter-chip-label">${icon} ${item.value}</span>
                <button class="filter-chip-remove" onclick="removeFilterChip('${view}', '${item.criterion}', '${escapedValue}')" title="Eliminar filtro">✕</button>
            </div>
        `;
    }).join('');
}

/**
 * Remove a single filter chip
 */
function removeFilterChip(view, criterion, value) {
    const selectedValues = STATE.advancedFilters[view].selectedValues;
    const index = selectedValues.findIndex(item => item.criterion === criterion && item.value === value);

    if (index > -1) {
        selectedValues.splice(index, 1);
    }

    // If no more selected values, reset criterion
    if (selectedValues.length === 0) {
        STATE.advancedFilters[view].criterion = '';
        const criterionSelect = document.getElementById(`filter-${view}-criterion`);
        if (criterionSelect) {
            criterionSelect.value = '';
        }
        const dropdown = document.getElementById(`filter-${view}-dropdown`);
        if (dropdown) {
            dropdown.style.display = 'none';
        }
    }

    // Update chips display
    updateActiveFilterChips(view);

    // Reapply filters
    applyAdvancedFilters(view);
}

/**
 * Apply filters to agenda view (special handling for grouped data)
 */
function applyAgendaFilters(filterText, selectedValues) {
    if (!STATE.vistaAgenda.datosOriginales) return;

    // Filter the original data based on criteria
    let filteredData = [...STATE.vistaAgenda.datosOriginales];

    // Apply text filter
    if (filterText) {
        filteredData = filteredData.filter(([orden, data]) => {
            const searchText = `${orden} ${data.recipient || ''} ${data.expectedArrival || ''}`.toLowerCase();
            return searchText.includes(filterText);
        });
    }

    // Apply dropdown filters
    if (selectedValues.length > 0) {
        filteredData = filteredData.filter(([orden, data]) => {
            return selectedValues.every(filter => {
                const destino = data.recipient || 'Sin Destino Especificado';
                const { validated: isValidated } = isOrderValidated(orden);
                const estatus = isValidated ? 'Validada' : 'Pendiente';

                let match = false;

                if (filter.criterion === 'destino') {
                    match = destino === filter.value;
                } else if (filter.criterion === 'estatus') {
                    match = estatus === filter.value;
                }

                // Check if any filter in the same criterion group matches
                const sameFilterGroup = selectedValues.filter(f => f.criterion === filter.criterion);
                return sameFilterGroup.some(f => {
                    if (f.criterion === 'destino') {
                        return destino === f.value;
                    } else if (f.criterion === 'estatus') {
                        return estatus === f.value;
                    }
                    return false;
                });
            });
        });
    }

    // Re-group and re-render with filtered data
    const datosAgrupados = groupOrdersByDestino(filteredData);
    STATE.vistaAgenda.datosAgrupados = datosAgrupados;

    // Render filtered results
    const container = document.getElementById('agenda-table-container');

    if (datosAgrupados.length === 0) {
        container.innerHTML = `
            <div class="table-empty-state">
                <div class="table-empty-icon">📭</div>
                <div class="table-empty-text">No hay órdenes que coincidan con los filtros</div>
                <div class="table-empty-subtext">Intenta ajustar los criterios de búsqueda</div>
            </div>
        `;
        updateAgendaSummary({ ordenes: 0, cajas: 0, promedioSurtido: 0, validadas: 0 });
        return;
    }

    let html = '';

    datosAgrupados.forEach(grupo => {
        html += `
            <div class="agenda-group">
                <div class="agenda-group-header">
                    <h3 style="margin: 0; color: var(--primary); font-size: 1.1em; font-weight: 700;">
                        🏢 DESTINO: ${grupo.destino}
                    </h3>
                </div>

                <table class="orders-table agenda-table">
                    <thead>
                        <tr>
                            <th style="width: 120px;">Fecha Horario</th>
                            <th style="width: 150px;">Número de Orden</th>
                            <th style="width: 100px; text-align: center;">Cantidad de Cajas</th>
                            <th style="width: 120px; text-align: center;">% Surtido</th>
                            <th style="width: 150px;">Estatus Actual</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        grupo.ordenes.forEach(orden => {
            const rowClass = orden.esValidada ? 'validated-order' : '';
            const estatusClass = orden.esValidada ? 'success' : 'warning';
            const estatusIcon = orden.esValidada ? '✅' : '⏳';

            html += `
                <tr class="${rowClass}">
                    <td>${orden.horario}</td>
                    <td><span class="order-code">${orden.numeroOrden}</span></td>
                    <td style="text-align: center;"><strong>${orden.cajas}</strong></td>
                    <td style="text-align: center;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <div class="progress-bar" style="width: 60px;">
                                <div class="progress-fill" style="width: ${orden.porcentajeSurtido}%"></div>
                            </div>
                            <span class="progress-text">${orden.porcentajeSurtido}%</span>
                        </div>
                    </td>
                    <td>
                        <span class="status-badge ${estatusClass}">${estatusIcon} ${orden.estatus}</span>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                    <tfoot>
                        <tr class="agenda-subtotal-row">
                            <td colspan="5" style="background: #f1f5f9; padding: 12px; font-weight: 700; color: var(--primary);">
                                📊 SUBTOTAL ${grupo.destino}:
                                <span style="margin-left: 16px;">
                                    ${grupo.subtotales.totalOrdenes} orden${grupo.subtotales.totalOrdenes !== 1 ? 'es' : ''}
                                </span>
                                <span style="margin-left: 12px;">|</span>
                                <span style="margin-left: 12px;">
                                    ${grupo.subtotales.totalCajas} caja${grupo.subtotales.totalCajas !== 1 ? 's' : ''}
                                </span>
                                <span style="margin-left: 12px;">|</span>
                                <span style="margin-left: 12px;">
                                    Promedio: ${grupo.subtotales.promedioSurtido}%
                                </span>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    });

    container.innerHTML = html;

    // Update summary with filtered data
    const totales = calculateGeneralTotals(datosAgrupados);
    updateAgendaSummary(totales);
}

/**
 * Apply advanced filters combining text search and dropdown selections
 */
function applyAdvancedFilters(view) {
    const filterText = document.getElementById(`filter-${view}`)?.value.toLowerCase() || '';
    const selectedValues = STATE.advancedFilters[view].selectedValues;

    // Special handling for agenda view
    if (view === 'agenda') {
        applyAgendaFilters(filterText, selectedValues);
        return;
    }

    let tableBodyId = '';
    if (view === 'orders') tableBodyId = 'orders-table-body';
    else if (view === 'validated') tableBodyId = 'validated-table-body';
    else if (view === 'folios') tableBodyId = 'folios-table-body';
    else if (view === 'folio-details') tableBodyId = 'folio-details-table-body';
    else if (view === 'folios-mgmt') tableBodyId = 'folios-mgmt-table-body';

    const rows = document.querySelectorAll(`#${tableBodyId} tr`);

    rows.forEach(row => {
        // Text search filter
        const text = row.textContent.toLowerCase();
        const textMatch = filterText === '' || text.includes(filterText);

        // Dropdown filter - match against all active filters
        let dropdownMatch = true;
        if (selectedValues.length > 0) {
            const cells = row.cells;

            // Check each filter criterion
            dropdownMatch = selectedValues.every(filter => {
                let cellValue = '';

                if (view === 'orders') {
                    // Map criterion to column index
                    // Columns: 0-Checkbox, 1-Orden, 2-Destino, 3-Horario, 4-Código, 5-Track, 6-Cajas, 7-%Surtido, 8-Rastreo, 9-Estatus, 10-Acción
                    if (filter.criterion === 'destino') {
                        cellValue = cells[2]?.textContent.trim() || '';
                    } else if (filter.criterion === 'rastreo') {
                        cellValue = cells[8]?.textContent.trim() || '';
                    } else if (filter.criterion === 'estatus') {
                        cellValue = cells[9]?.textContent.trim() || '';
                    }
                } else if (view === 'validated') {
                    // Map criterion to column index for validated
                    // Columns: 0-Checkbox, 1-Orden, 2-FechaVal, 3-Destino, 4-Horario, 5-Cajas, 6-%Surtido, 7-Rastreo, 8-TRS, 9-CantDesp, 10-Estatus, 11-Calidad, 12-Conductor, 13-Unidad, 14-Folio
                    if (filter.criterion === 'destino') {
                        cellValue = cells[3]?.textContent.trim() || '';
                    } else if (filter.criterion === 'rastreo') {
                        cellValue = cells[7]?.textContent.trim() || '';
                    } else if (filter.criterion === 'estatus') {
                        cellValue = cells[10]?.textContent.trim() || '';
                    } else if (filter.criterion === 'conductor') {
                        cellValue = cells[12]?.textContent.trim() || '';
                    } else if (filter.criterion === 'unidad') {
                        cellValue = cells[13]?.textContent.trim() || '';
                    }
                } else if (view === 'folios') {
                    // Map criterion to column index for folios
                    if (filter.criterion === 'conductor') {
                        cellValue = cells[6]?.textContent.trim() || '';
                    } else if (filter.criterion === 'unidad') {
                        cellValue = cells[7]?.textContent.trim() || '';
                    }
                } else if (view === 'folio-details') {
                    // Map criterion to column index for folio-details
                    // Columns: 0-Orden, 1-FechaVal, 2-Destino, 3-Horario, 4-Cajas, 5-CantDesp, 6-Estatus, 7-Calidad, 8-Conductor, 9-Unidad
                    if (filter.criterion === 'destino') {
                        cellValue = cells[2]?.textContent.trim() || '';
                    } else if (filter.criterion === 'conductor') {
                        cellValue = cells[8]?.textContent.trim() || '';
                    } else if (filter.criterion === 'unidad') {
                        cellValue = cells[9]?.textContent.trim() || '';
                    } else if (filter.criterion === 'estatus') {
                        cellValue = cells[6]?.textContent.trim() || '';
                    }
                } else if (view === 'folios-mgmt') {
                    // Map criterion to column index for folios-mgmt
                    // Columns: 0-Folio, 1-Fecha, 2-Cajas, 3-Ordenes, 4-HorarioInicial, 5-HorarioFinal, 6-Conductor, 7-Unidad, 8-Acciones
                    if (filter.criterion === 'conductor') {
                        cellValue = cells[6]?.textContent.trim() || '';
                    } else if (filter.criterion === 'unidad') {
                        cellValue = cells[7]?.textContent.trim() || '';
                    }
                }

                // Row must match the filter value
                return filter.value === cellValue;
            });
        }

        // Show row if both filters match
        row.style.display = (textMatch && dropdownMatch) ? '' : 'none';
    });

    // Update badges after filtering
    if (view === 'folios') {
        updateFoliosBadges();
    } else if (view === 'validated') {
        updateValidatedBadges();
    } else if (view === 'folios-mgmt') {
        // For folios-mgmt, we need to count visible rows and update badges
        const visibleRows = Array.from(rows).filter(row => row.style.display !== 'none');
        const foliosData = visibleRows.map(row => {
            const folio = row.getAttribute('data-folio');
            const cajas = parseInt(row.cells[2]?.textContent.trim() || '0');
            const ordenes = parseInt(row.cells[3]?.textContent.trim() || '0');
            return { folio, totalCajas: cajas, ordenes: ordenes };
        });
        updateFoliosManagementBadges(foliosData);
    }
    // Note: orders view doesn't have badges in the table header
}

/**
 * Clear all filters for a view
 */
function clearAllFilters(view) {
    // Reset state
    STATE.advancedFilters[view].criterion = '';
    STATE.advancedFilters[view].selectedValues = [];

    // Reset UI
    const criterionSelect = document.getElementById(`filter-${view}-criterion`);
    if (criterionSelect) criterionSelect.value = '';

    const dropdown = document.getElementById(`filter-${view}-dropdown`);
    if (dropdown) dropdown.style.display = 'none';

    const textInput = document.getElementById(`filter-${view}`);
    if (textInput) textInput.value = '';

    // Re-apply filters (which will show all rows)
    if (view === 'orders') filterOrdersTable();
    else if (view === 'validated') filterValidatedTable();
    else if (view === 'folios') filterFoliosTable();

    // Hide clear button
    updateClearButtonVisibility(view);
}

/**
 * Update visibility of clear all filters button
 */
function updateClearButtonVisibility(view) {
    const clearBtn = document.getElementById(`clear-all-filters-${view}`);
    if (!clearBtn) return;

    const hasFilters = STATE.advancedFilters[view].selectedValues.length > 0 ||
                      STATE.advancedFilters[view].criterion !== '';

    clearBtn.style.display = hasFilters ? 'inline-block' : 'none';
}

// ==================== GLOBAL NAVIGATION & DATE ENFORCEMENT (CHANGE 1) ====================

/**
 * Show and configure the persistent global navigation header
 * DISABLED - Using individual section headers instead
 */
function showGlobalNavigation() {
    // DISABLED - Global navigation is hidden, using individual section headers
    return;
}

/**
 * Hide the global navigation header
 * DISABLED - Using individual section headers instead
 */
function hideGlobalNavigation() {
    // DISABLED - Global navigation is hidden, using individual section headers
    return;
}

/**
 * Update global navigation state (badges, active button, date indicator)
 * DISABLED - Using individual section headers instead
 */
function updateGlobalNavigation() {
    // DISABLED - Global navigation is hidden, using individual section headers
    return;
}

/**
 * Update the date range indicator in global navigation
 * DISABLED - Using individual section headers instead
 */
function updateGlobalDateIndicator() {
    // DISABLED - Global navigation is hidden, using individual section headers
    return;
}

/**
 * Enforce date filter before allowing access to Pendientes or Validadas
 * Returns true if date filter is active, false otherwise
 */
function enforceDateFilter() {
    if (!STATE.dateFilter.active) {
        // Show modal forcing date selection
        showNotification('Por favor selecciona un rango de fechas primero', 'warning');
        showDateFilterForDispatch();
        return false;
    }
    return true;
}

// ==================== TABLE SORTING ====================
let currentSortColumn = -1;
let currentSortDirection = 'asc';
let validatedSortColumn = -1;
let validatedSortDirection = 'asc';

function sortTable(columnIndex) {
    const table = document.getElementById('orders-table');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Si es la misma columna, cambiar dirección
    if (currentSortColumn === columnIndex) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortColumn = columnIndex;
        currentSortDirection = 'asc';
    }

    // Ordenar filas
    rows.sort((a, b) => {
        const cellA = a.cells[columnIndex]?.textContent.trim() || '';
        const cellB = b.cells[columnIndex]?.textContent.trim() || '';

        // Intentar comparación numérica
        const numA = parseFloat(cellA.replace(/[^0-9.-]/g, ''));
        const numB = parseFloat(cellB.replace(/[^0-9.-]/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return currentSortDirection === 'asc' ? numA - numB : numB - numA;
        }

        // Comparación de texto
        return currentSortDirection === 'asc'
            ? cellA.localeCompare(cellB)
            : cellB.localeCompare(cellA);
    });

    // Reordenar tabla
    rows.forEach(row => tbody.appendChild(row));

    // Actualizar indicadores visuales
    updateSortIndicators(table, columnIndex, currentSortDirection);
}

function sortValidatedTable(columnIndex) {
    const table = document.getElementById('validated-table');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Si es la misma columna, cambiar dirección
    if (validatedSortColumn === columnIndex) {
        validatedSortDirection = validatedSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        validatedSortColumn = columnIndex;
        validatedSortDirection = 'asc';
    }

    // Ordenar filas
    rows.sort((a, b) => {
        const cellA = a.cells[columnIndex]?.textContent.trim() || '';
        const cellB = b.cells[columnIndex]?.textContent.trim() || '';

        // Intentar comparación numérica
        const numA = parseFloat(cellA.replace(/[^0-9.-]/g, ''));
        const numB = parseFloat(cellB.replace(/[^0-9.-]/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return validatedSortDirection === 'asc' ? numA - numB : numB - numA;
        }

        // Comparación de texto
        return validatedSortDirection === 'asc'
            ? cellA.localeCompare(cellB)
            : cellB.localeCompare(cellA);
    });

    // Reordenar tabla
    rows.forEach(row => tbody.appendChild(row));

    // Actualizar indicadores visuales
    updateSortIndicators(table, columnIndex, validatedSortDirection);
}

function updateSortIndicators(table, columnIndex, direction) {
    // Limpiar todos los indicadores
    table.querySelectorAll('th').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });

    // Agregar clase a la columna ordenada
    const th = table.querySelectorAll('th')[columnIndex];
    if (th) {
        th.classList.add(direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
}

// ==================== VALIDATION TABS ====================
// Variable global para debouncing de cambio de pestañas
let tabSwitchTimeout = null;

/**
 * Oculta todas las vistas/paneles de contenido
 */
function hideAllContentPanels() {
    const panels = [
        'welcome-state',
        'search-panel',
        'validated-content',
        'otros-content',
        'folios-content',
        'folio-details-content',
        'folios-management-content'
    ];

    panels.forEach(panelId => {
        const panel = document.getElementById(panelId);
        if (panel) {
            // Usar !important para forzar el ocultamiento
            panel.style.setProperty('display', 'none', 'important');
            // Limpiar z-index y visibility
            panel.style.zIndex = '';
            panel.style.visibility = '';
            panel.style.opacity = '';
            // Remover clase active si existe
            panel.classList.remove('active', 'show');
        }
    });
}

/**
 * Muestra un panel específico de forma robusta
 */
function showContentPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        // Remover el estilo inline de display con !important
        panel.style.removeProperty('display');
        // Establecer display: block sin !important para que CSS pueda sobreescribir si es necesario
        panel.style.display = 'block';
        // Asegurar visibilidad
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';
    }
}

/**
 * Limpia todos los filtros de búsqueda y la persistencia (llamado al cambiar de pestaña)
 */
function clearAllFilters() {
    // Limpiar inputs de filtro
    const filterInputs = [
        'filter-orders',
        'filter-validated',
        'filter-otros'
    ];

    filterInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.value = '';
        }

        // Ocultar botón de limpiar si existe
        const clearBtn = document.getElementById(`clear-${inputId}`);
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
    });

    // Limpiar persistencia de filtros en STATE
    STATE.filterPersistence = {
        pending: '',
        validated: '',
        otros: '',
        folios: ''
    };

    // NUEVO: Limpiar filtros avanzados (dropdowns de selección)
    const views = ['orders', 'validated', 'folios', 'folio-details', 'folios-mgmt', 'agenda'];
    views.forEach(view => {
        // Reset advanced filter state
        if (STATE.advancedFilters[view]) {
            STATE.advancedFilters[view].criterion = '';
            STATE.advancedFilters[view].selectedValues = [];
        }

        // Reset criterion selector
        const criterionSelect = document.getElementById(`filter-${view}-criterion`);
        if (criterionSelect) {
            criterionSelect.value = '';
        }

        // Hide dropdown
        const dropdown = document.getElementById(`filter-${view}-dropdown`);
        if (dropdown) {
            dropdown.style.display = 'none';
        }

        // Clear active filter chips
        const chipsContainer = document.getElementById(`active-filters-${view}`);
        if (chipsContainer) {
            chipsContainer.innerHTML = '';
        }
    });

    console.log('🧹 Filtros de búsqueda y selección limpiados');
}

function switchValidationTab(tab) {
    // DEBOUNCING: Prevenir clics múltiples rápidos
    if (tabSwitchTimeout) {
        clearTimeout(tabSwitchTimeout);
    }

    tabSwitchTimeout = setTimeout(() => {
        executeSwitchTab(tab);
    }, 100);
}

function executeSwitchTab(tab) {
    // CHANGE 1: Enforce date filter before switching to pending
    if (tab === 'pending' && !enforceDateFilter()) {
        return; // Don't switch if date filter not active
    }

    // OPTIMIZACIÓN: Verificar si ya tenemos datos en caché para este filtro
    // No hacer nuevas peticiones a BD si solo estamos cambiando de pestaña
    const currentFilterKey = STATE.dateFilter.active ? 
        `${STATE.dateFilter.startDate}_${STATE.dateFilter.endDate}` : null;
    
    if (currentFilterKey && LOAD_STATE.lastDateFilter === currentFilterKey) {
        console.log('⚡ [NAV] Usando datos en caché - No se requiere recarga de BD');
    }

    // CHANGE 1: Show global navigation when switching tabs
    showGlobalNavigation();

    // PASO 1: OCULTAR TODAS LAS VISTAS INMEDIATAMENTE (sin setTimeout)
    hideAllContentPanels();

    // PASO 2: RESETEAR CHECKBOXES Y SELECCIÓN
    resetAllSelections();

    // PASO 3: LIMPIAR FILTROS DE BÚSQUEDA Y PERSISTENCIA
    clearAllFilters();

    // Reset flag de gestión de folios
    isInFoliosManagementView = false;

    STATE.activeTab = tab;

    // CRITICAL: Remove active class from ALL tab buttons first to prevent persistence
    document.querySelectorAll('.status-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Update old tab styles (sidebar tabs - if they exist)
    const tabPending = document.getElementById('tab-pending');
    const tabValidated = document.getElementById('tab-validated');

    // Update header toggle buttons (en panel de búsqueda)
    const toggleTodo = document.getElementById('toggle-todo');
    const togglePending = document.getElementById('toggle-pending');
    const toggleValidated = document.getElementById('toggle-validated');

    // Update header toggle buttons (en panel de validadas)
    const toggleTodoValidated = document.getElementById('toggle-todo-validated');
    const togglePendingValidated = document.getElementById('toggle-pending-validated');
    const toggleValidatedValidated = document.getElementById('toggle-validated-validated');

    // Update header toggle buttons (en panel de folios)
    const toggleTodoFolios = document.getElementById('toggle-todo-folios');
    const togglePendingFolios = document.getElementById('toggle-pending-folios');
    const toggleValidatedFolios = document.getElementById('toggle-validated-folios');

    if (tab === 'todo') {
        // Limpiar flag de "viene desde folios" si estaba activo
        STATE.fromFolios = false;

        // Actualizar tabs del sidebar (si existen)
        tabPending?.classList.remove('active');
        tabValidated?.classList.remove('active');

        // Actualizar botones en panel de búsqueda
        toggleTodo?.classList.add('active');
        togglePending?.classList.remove('active');
        toggleValidated?.classList.remove('active');
        const toggleOtrosHeader = document.getElementById('toggle-otros');
        toggleOtrosHeader?.classList.remove('active');

        // Actualizar botones en panel de validadas
        toggleTodoValidated?.classList.add('active');
        togglePendingValidated?.classList.remove('active');
        toggleValidatedValidated?.classList.remove('active');
        const toggleOtrosValidated = document.getElementById('toggle-otros-validated');
        toggleOtrosValidated?.classList.remove('active');

        // Actualizar botones en panel de folios
        toggleTodoFolios?.classList.add('active');
        togglePendingFolios?.classList.remove('active');
        toggleValidatedFolios?.classList.remove('active');
        const toggleOtrosFolios = document.getElementById('toggle-otros-folios');
        toggleOtrosFolios?.classList.remove('active');

        // PASO 2: Mostrar solo el panel correspondiente
        showContentPanel('search-panel');

        // Render ALL orders (todo)

        // MOSTRAR elementos de escaneo y agenda en vista "Todo"
        const scannerCardTodo = document.getElementById('search-scanner-card');
        const agendaBtnTodo = document.getElementById('btn-ver-agenda');
        const sectionTitleTodo = document.getElementById('orders-section-title');
        const searchPanelTitle = document.getElementById('search-panel-title');
        if (scannerCardTodo) scannerCardTodo.style.display = 'block';
        if (agendaBtnTodo) agendaBtnTodo.style.display = 'flex';
        if (sectionTitleTodo) sectionTitleTodo.textContent = '📋 Órdenes';
        if (searchPanelTitle) searchPanelTitle.textContent = '📋 Órdenes';
        renderOrdersTable('todo');
    } else if (tab === 'pending') {
        // Limpiar flag de "viene desde folios" si estaba activo
        STATE.fromFolios = false;

        // Re-habilitar el botón Pendientes si estaba deshabilitado
        if (togglePendingValidated) {
            togglePendingValidated.disabled = false;
            togglePendingValidated.style.opacity = '1';
            togglePendingValidated.style.cursor = 'pointer';
            togglePendingValidated.title = '';
        }

        // Actualizar tabs del sidebar (si existen)
        tabPending?.classList.add('active');
        tabValidated?.classList.remove('active');

        // Actualizar botones en panel de búsqueda
        toggleTodo?.classList.remove('active');
        togglePending?.classList.add('active');
        toggleValidated?.classList.remove('active');
        const toggleOtrosHeader = document.getElementById('toggle-otros');
        toggleOtrosHeader?.classList.remove('active');

        // Actualizar botones en panel de validadas
        toggleTodoValidated?.classList.remove('active');
        togglePendingValidated?.classList.add('active');
        toggleValidatedValidated?.classList.remove('active');
        const toggleOtrosValidated = document.getElementById('toggle-otros-validated');
        toggleOtrosValidated?.classList.remove('active');

        // Actualizar botones en panel de folios
        toggleTodoFolios?.classList.remove('active');
        togglePendingFolios?.classList.add('active');
        toggleValidatedFolios?.classList.remove('active');
        const toggleOtrosFolios = document.getElementById('toggle-otros-folios');
        toggleOtrosFolios?.classList.remove('active');

        // PASO 2: Mostrar solo el panel correspondiente
        showContentPanel('search-panel');

        // Render pending orders table (filtered)
        renderOrdersTable('pending');

        // OCULTAR elementos de escaneo y agenda en vista "Pendientes"
        const scannerCardPending = document.getElementById('search-scanner-card');
        const agendaBtnPending = document.getElementById('btn-ver-agenda');
        const sectionTitlePending = document.getElementById('orders-section-title');
        const searchPanelTitlePending = document.getElementById('search-panel-title');
        if (scannerCardPending) scannerCardPending.style.display = 'none';
        if (agendaBtnPending) agendaBtnPending.style.display = 'none';
        if (sectionTitlePending) sectionTitlePending.textContent = '📋 Órdenes Pendientes';
        if (searchPanelTitlePending) searchPanelTitlePending.textContent = '📋 Órdenes Pendientes';
    } else if (tab === 'validated') {
        // Si NO venimos desde folios, habilitar el botón normalmente
        if (!STATE.fromFolios && togglePendingValidated) {
            togglePendingValidated.disabled = false;
            togglePendingValidated.style.opacity = '1';
            togglePendingValidated.style.cursor = 'pointer';
            togglePendingValidated.title = '';
        }

        // Actualizar tabs del sidebar (si existen)
        tabPending?.classList.remove('active');
        tabValidated?.classList.add('active');

        // Actualizar botones en panel de búsqueda
        toggleTodo?.classList.remove('active');
        togglePending?.classList.remove('active');
        toggleValidated?.classList.add('active');
        const toggleOtrosHeader = document.getElementById('toggle-otros');
        toggleOtrosHeader?.classList.remove('active');

        // Actualizar botones en panel de validadas
        toggleTodoValidated?.classList.remove('active');
        togglePendingValidated?.classList.remove('active');
        toggleValidatedValidated?.classList.add('active');
        const toggleOtrosValidated = document.getElementById('toggle-otros-validated');
        toggleOtrosValidated?.classList.remove('active');

        // Actualizar botones en panel de folios
        toggleTodoFolios?.classList.remove('active');
        togglePendingFolios?.classList.remove('active');
        toggleValidatedFolios?.classList.add('active');
        const toggleOtrosFolios = document.getElementById('toggle-otros-folios');
        toggleOtrosFolios?.classList.remove('active');

        // PASO 2: Mostrar solo el panel correspondiente
        showContentPanel('validated-content');

        // OPTIMIZACIÓN: Mostrar skeleton/loading y renderizar después
        const tableBody = document.getElementById('validated-table-body');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="15" class="table-empty-state">
                        <div class="table-empty-icon">⏳</div>
                        <div class="table-empty-text">Cargando órdenes validadas...</div>
                    </td>
                </tr>
            `;
        }

        // Diferir el renderizado pesado para que la UI responda primero
        requestAnimationFrame(() => {
            renderValidatedTable();
        });
    } else if (tab === 'otros') {
        // Limpiar flag de "viene desde folios" si estaba activo
        STATE.fromFolios = false;

        // Actualizar tabs del sidebar (si existen)
        tabPending?.classList.remove('active');
        tabValidated?.classList.remove('active');

        // Actualizar botones en panel de búsqueda
        toggleTodo?.classList.remove('active');
        togglePending?.classList.remove('active');
        toggleValidated?.classList.remove('active');
        const toggleOtrosHeader = document.getElementById('toggle-otros');
        toggleOtrosHeader?.classList.add('active');

        // Actualizar botones en panel de validadas
        toggleTodoValidated?.classList.remove('active');
        togglePendingValidated?.classList.remove('active');
        toggleValidatedValidated?.classList.remove('active');
        const toggleOtrosValidated = document.getElementById('toggle-otros-validated');
        toggleOtrosValidated?.classList.add('active');

        // Actualizar botones en panel de folios
        toggleTodoFolios?.classList.remove('active');
        togglePendingFolios?.classList.remove('active');
        toggleValidatedFolios?.classList.remove('active');
        const toggleOtrosFolios = document.getElementById('toggle-otros-folios');
        toggleOtrosFolios?.classList.add('active');

        // Actualizar botones en panel de otros
        const toggleTodoOtros = document.getElementById('toggle-todo-otros');
        const togglePendingOtros = document.getElementById('toggle-pending-otros');
        const toggleValidatedOtros = document.getElementById('toggle-validated-otros');
        const toggleOtrosOtros = document.getElementById('toggle-otros-otros');
        toggleTodoOtros?.classList.remove('active');
        togglePendingOtros?.classList.remove('active');
        toggleValidatedOtros?.classList.remove('active');
        toggleOtrosOtros?.classList.add('active');

        // PASO 2: Mostrar solo el panel correspondiente
        showContentPanel('otros-content');

        // Render otros orders table
        renderOtrosTable();
    }

    // Update badges
    updateTabBadges();

    // CHANGE 1: Update global navigation
    updateGlobalNavigation();
}

/**
 * Renderiza la tabla de órdenes "Otros" (Canceladas y No Procesables)
 */
function renderOtrosTable() {
    const tableBody = document.getElementById('otros-table-body');
    if (!tableBody) return;

    // DEBUG: Ver todos los registros en localValidated
    console.log('🔍 Total registros en localValidated:', STATE.localValidated.length);
    console.log('🔍 Estatus de todos los registros:', STATE.localValidated.map(r => ({ orden: r.orden, estatus: r.estatus })));

    // Filtrar solo órdenes con estatus "Cancelada" o "No Procesable"
    let otrosOrders = STATE.localValidated.filter(record =>
        record.estatus === 'Cancelada' || record.estatus === 'No Procesable'
    );

    console.log('🔍 Órdenes filtradas para Otros:', otrosOrders.length, otrosOrders.map(r => ({ orden: r.orden, estatus: r.estatus })));

    // Aplicar filtro de fecha si está activo
    if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
        const startDate = parseDateLocal(STATE.dateFilter.startDate);
        const endDate = parseDateLocal(STATE.dateFilter.endDate);
        endDate.setHours(23, 59, 59, 999);

        otrosOrders = otrosOrders.filter(record => {
            const orderData = STATE.obcData.get(record.orden) || {};
            const dateStr = record.horario || orderData.expectedArrival;
            if (!dateStr) return false;
            const orderDate = parseOrderDate(dateStr);
            return orderDate && orderDate >= startDate && orderDate <= endDate;
        });
    }

    // Si no hay órdenes, mostrar mensaje
    if (otrosOrders.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #999;">
                    <div style="font-size: 3em; margin-bottom: 10px;">📦</div>
                    <p>No hay órdenes canceladas o no procesables</p>
                </td>
            </tr>
        `;
        updateOtrosBadges(0, 0);
        return;
    }

    // Renderizar filas
    tableBody.innerHTML = otrosOrders.map(record => {
        const orderData = STATE.obcData.get(record.orden) || {};
        const totalCajas = orderData.totalCajas || 0;

        let statusBadge;
        if (record.estatus === 'Cancelada') {
            statusBadge = createStatusBadge('cancelada', 'Cancelada');
        } else {
            statusBadge = createStatusBadge('no-procesable', 'No Procesable');
        }

        return `
            <tr data-orden="${record.orden}" class="clickable-row">
                <td style="text-align: center;">
                    <input type="checkbox" class="row-checkbox" data-orden="${record.orden}" onclick="event.stopPropagation(); updateSelectionCount('otros');" style="cursor: pointer;">
                </td>
                <td>${makeCopyable(record.orden)}</td>
                <td>${record.fecha || 'N/A'}</td>
                <td>${record.destino || 'N/A'}</td>
                <td>${record.horario || 'N/A'}</td>
                <td>${totalCajas}</td>
                <td>
                    ${statusBadge}
                </td>
                <td>${record.usuario || 'N/A'}</td>
                <td class="actions-cell">
                    <div class="actions-buttons">
                        <button class="btn-action dispatch" onclick="showValidatedDetails('${record.orden}')" title="Ver detalles de orden">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 7h-9"></path>
                                <path d="M14 17H5"></path>
                                <circle cx="17" cy="17" r="3"></circle>
                                <circle cx="7" cy="7" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-delete-validated" onclick="revertirOrden('${record.orden}')" title="Revertir orden (eliminar de Otros)">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Actualizar contadores
    const totalCajas = otrosOrders.reduce((sum, r) => sum + (STATE.obcData.get(r.orden)?.totalCajas || 0), 0);
    updateOtrosBadges(otrosOrders.length, totalCajas);
}

/**
 * Actualiza los badges de contadores de la tabla "Otros"
 */
function updateOtrosBadges(ordersCount, boxesCount) {
    const ordersCountEl = document.getElementById('otros-orders-count');
    const boxesCountEl = document.getElementById('otros-boxes-count');

    if (ordersCountEl) {
        ordersCountEl.textContent = `${ordersCount} orden${ordersCount !== 1 ? 'es' : ''}`;
    }
    if (boxesCountEl) {
        boxesCountEl.textContent = `${boxesCount} caja${boxesCount !== 1 ? 's' : ''}`;
    }
}

/**
 * Filtra la tabla de "Otros" según el input de búsqueda
 */
function filterOtrosTable() {
    const filterInput = document.getElementById('filter-otros');
    const clearBtn = document.getElementById('clear-filter-otros');
    const filter = filterInput?.value.toLowerCase() || '';

    // Save filter state to persistence
    STATE.filterPersistence.otros = filter;

    // Show/hide clear button
    if (clearBtn) {
        clearBtn.style.display = filter ? 'flex' : 'none';
    }

    const table = document.getElementById('otros-table');
    const rows = table?.querySelectorAll('tbody tr') || [];

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(filter) ? '' : 'none';
    });
}

/**
 * Ordena la tabla de "Otros"
 */
let otrosSortColumn = null;
let otrosSortDirection = 'asc';

function sortOtrosTable(columnIndex) {
    const table = document.getElementById('otros-table');
    const tbody = table?.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Si es la misma columna, invertir dirección
    if (otrosSortColumn === columnIndex) {
        otrosSortDirection = otrosSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        otrosSortColumn = columnIndex;
        otrosSortDirection = 'asc';
    }

    rows.sort((a, b) => {
        const aCell = a.cells[columnIndex]?.textContent.trim() || '';
        const bCell = b.cells[columnIndex]?.textContent.trim() || '';

        let comparison = 0;
        if (!isNaN(aCell) && !isNaN(bCell)) {
            comparison = Number(aCell) - Number(bCell);
        } else {
            comparison = aCell.localeCompare(bCell);
        }

        return otrosSortDirection === 'asc' ? comparison : -comparison;
    });

    // Reordenar tabla
    rows.forEach(row => tbody.appendChild(row));

    // Actualizar indicadores visuales
    updateSortIndicators(table, columnIndex, otrosSortDirection);
}

/**
 * Revierte una orden desde "Otros" (Cancelada/No Procesable) a estado normal
 */
// Flag para prevenir eliminaciones duplicadas
let deletingOrders = new Set();

async function revertirOrden(orden) {
    // PREVENIR CLICS DUPLICADOS
    if (deletingOrders.has(orden)) {
        console.warn(`⚠️ Ya se está procesando la eliminación de la orden ${orden}`);
        return;
    }

    const record = STATE.localValidated.find(v => v.orden === orden);
    if (!record) {
        showNotification('❌ Orden no encontrada', 'error');
        return;
    }

    const estatusOriginal = record.estatus;
    const confirmed = confirm(
        `¿Revertir el estatus de la orden ${orden}?\n\n` +
        `Estatus actual: ${estatusOriginal}\n\n` +
        `La orden volverá a estar disponible para despacho.`
    );

    if (!confirmed) return;

    // Marcar como "en proceso de eliminación"
    deletingOrders.add(orden);

    try {
        showNotification('🔄 Revirtiendo orden...', 'info');

        // Eliminar registro de localValidated (SOLO UNA VEZ)
        const index = STATE.localValidated.findIndex(v => v.orden === orden);
        if (index !== -1) {
            STATE.localValidated.splice(index, 1);
            saveLocalState();
        } else {
            console.warn(`⚠️ Orden ${orden} no encontrada en localValidated`);
        }

        // Intentar eliminar de Google Sheets si hay syncManager disponible
        if (window.syncManager && typeof window.syncManager.deleteRecord === 'function') {
            await window.syncManager.deleteRecord(record);
        }

        // FORZAR RE-RENDER INMEDIATO de TODAS las tablas para sincronización completa
        const activeTab = STATE.activeTab;

        // Re-renderizar TODAS las tablas, no solo la activa
        renderOtrosTable();
        renderValidatedTable();
        renderOrdersList(); // Esto actualiza pendientes y todo
        
        console.log('✅ Todas las tablas re-renderizadas tras revertir orden');

        // Actualizar badges de TODAS las pestañas
        updateTabBadges();
        updateOrdersBadges(activeTab);
        updateValidatedBadges();
        updateSummary();

        showNotification(`✅ Orden ${orden} revertida exitosamente`, 'success');

    } catch (error) {
        console.error('Error al revertir orden:', error);
        showNotification('❌ Error al revertir la orden: ' + error.message, 'error');
    } finally {
        // Liberar el flag después de un breve delay
        setTimeout(() => {
            deletingOrders.delete(orden);
        }, 500);
    }
}

function renderValidatedTable() {
    const tableBody = document.getElementById('validated-table-body');
    if (!tableBody) return;

    if (STATE.localValidated.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="15" class="table-empty-state">
                    <div class="table-empty-icon">📋</div>
                    <div class="table-empty-text">No hay ordenes validadas</div>
                    <div class="table-empty-subtext">Las ordenes confirmados aparecerán aquí</div>
                </td>
            </tr>
        `;
        updateValidatedBadges();
        updateValidatedFilterIndicator();
        return;
    }

    // Filter validated orders by date range if active
    // CRÍTICO: Excluir "Cancelada" y "No Procesable" de esta pestaña (deben ir a "Otros")
    let filteredValidated = STATE.localValidated.filter(record => {
        const estatus = record.estatus || '';
        return estatus !== 'Cancelada' && estatus !== 'No Procesable';
    });

    if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
        // Parse dates as local time to avoid timezone offset issues
        const startParts = STATE.dateFilter.startDate.split('-');
        const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        startDate.setHours(0, 0, 0, 0);

        const endParts = STATE.dateFilter.endDate.split('-');
        const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
        endDate.setHours(23, 59, 59, 999);

        filteredValidated = filteredValidated.filter(record => {
            // Get the order data to check expectedArrival (delivery date)
            const orderData = STATE.obcData.get(record.orden) || {};
            const dateStr = record.horario || orderData.expectedArrival;

            if (!dateStr) return false;

            const orderDate = parseOrderDate(dateStr);
            return orderDate && orderDate >= startDate && orderDate <= endDate;
        });
    }

    // Update filter indicator
    updateValidatedFilterIndicator();

    // If filter is active but no results
    if (filteredValidated.length === 0 && STATE.dateFilter.active) {
        const start = formatDateDDMMYYYY(new Date(STATE.dateFilter.startDate));
        const end = formatDateDDMMYYYY(new Date(STATE.dateFilter.endDate));
        tableBody.innerHTML = `
            <tr>
                <td colspan="15" class="table-empty-state">
                    <div class="table-empty-icon">🔍</div>
                    <div class="table-empty-text">Sin resultados para el filtro</div>
                    <div class="table-empty-subtext">No hay despachos validados para ${start} → ${end}</div>
                </td>
            </tr>
        `;
        updateValidatedBadges();
        return;
    }

    // Sort by timestamp descending (most recent first)
    const sortedValidated = filteredValidated.sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    tableBody.innerHTML = sortedValidated.map((record, index) => {
        // Obtener datos originales de la orden si existen
        const orderData = STATE.obcData.get(record.orden) || {};
        const validaciones = STATE.validacionData.get(record.orden) || [];
        const rastreoData = STATE.mneData.get(record.orden) || [];
        // FIXED: Use totalCajas from OBC database (RESUMEN_ORDENES) as primary source
        const totalCajas = orderData.totalCajas || record.totalCajas || 0;
        // FIXED: Count unique validated boxes instead of total records
        const cajasValidadas = getCajasValidadasUnicas(record.orden);
        const porcentajeValidacion = totalCajas > 0 ? Math.round((cajasValidadas / totalCajas) * 100) : 0;
        const tieneRastreo = rastreoData.length > 0;

        // CHANGE 6: Only show validation % if cajasValidadas > 0 AND totalCajas > 0
        // Handle over-validation case (more validated than expected)
        let validationDisplay;
        if (cajasValidadas === 0 || totalCajas === 0) {
            validationDisplay = '<span class="empty-cell">N/A</span>';
        } else if (cajasValidadas > totalCajas) {
            // Over-validation warning
            const exceso = cajasValidadas - totalCajas;
            validationDisplay = `
                <div class="progress-bar"><div class="progress-fill" style="width: 100%; background: #f59e0b;"></div></div>
                <span class="progress-text" style="color: #f59e0b;" title="⚠️ Sobre-validación: ${cajasValidadas} validadas vs ${totalCajas} esperadas (+${exceso})">⚠️ ${porcentajeValidacion}%</span>
            `;
        } else {
            validationDisplay = `<div class="progress-bar"><div class="progress-fill" style="width: ${porcentajeValidacion}%"></div></div><span class="progress-text">${porcentajeValidacion}%</span>`;
        }

        // FIXED: Calculate dispatch status instead of sync status
        // IMPORTANTE: cantidadDespachar apunta a cantDespacho (Columna N)
        // PRIORIDAD: Usar cantDespacho directamente, luego cantidadDespachar como fallback
        const cantidadDespachar = record.cantDespacho || record.cantidadDespachar || 0;
        
        // Debug para primeros 5 registros
        if (index < 5) {
            console.log(`🎨 RENDER tabla row ${index}:`, {
                orden: record.orden,
                'cantDespacho (N)': record.cantDespacho,
                'cantidadDespachar (alias)': record.cantidadDespachar,
                'VALOR USADO': cantidadDespachar,
                operador: record.operador,
                unidad: record.unidad
            });
        }
        let dispatchStatus, statusBadge, statusColor;

        if (record.estatus === 'Cancelada') {
            statusBadge = 'Cancelada';
            statusColor = '#ef4444';  // Rojo
        } else if (record.estatus === 'No Procesable') {
            statusBadge = 'No Procesable';
            statusColor = '#eab308';  // Amarillo
        } else {
            dispatchStatus = calculateOrderStatus(totalCajas, cantidadDespachar);
            statusBadge = dispatchStatus.status;
            statusColor = dispatchStatus.color;
        }

        // OPTIMIZACIÓN: Buscar TRS relacionados (simplificado para mejor rendimiento)
        let trsCount = 0;
        if (validaciones.length > 0 || rastreoData.length > 0) {
            const boxCodes = new Set();
            validaciones.forEach(v => { if (v.codigo) boxCodes.add(v.codigo.trim()); });
            rastreoData.forEach(r => { if (r.codigo) boxCodes.add(r.codigo.trim()); });

            // Solo buscar si hay códigos
            if (boxCodes.size > 0 && STATE.trsData.length > 0) {
                for (const t of STATE.trsData) {
                    for (const code of boxCodes) {
                        if ((t.codigoOriginal && t.codigoOriginal.includes(code)) ||
                            (t.codigoNuevo && t.codigoNuevo.includes(code))) {
                            trsCount++;
                            break;
                        }
                    }
                }
            }
        }

        // Estatus de calidad
        let estatusCalidad = 'N/A';
        if (record.qc && record.qc.tasks && record.qc.tasks.length > 0) {
            const statuses = Object.values(record.qc.statuses || {});
            if (statuses.every(s => s === 'completado')) {
                estatusCalidad = '✅ Completado';
            } else if (statuses.some(s => s === 'parcial')) {
                estatusCalidad = '◑ Parcial';
            } else {
                estatusCalidad = '○ Pendiente';
            }
        }

        // Format validation date/time
        const fechaValidacion = record.timestamp ? formatValidationDateTime(record.timestamp) : `${record.fecha || ''} ${record.hora || ''}`;

        // Check if order is cancelled
        const isCancelled = record.estatus === 'Cancelada';
        const rowClass = isCancelled ? 'validated-row cancelled-order' : 'validated-row';

        return `
            <tr data-orden="${record.orden}" class="${rowClass}">
                <td style="text-align: center;">
                    <input type="checkbox" class="row-checkbox" data-orden="${record.orden}" onclick="event.stopPropagation(); updateSelectionCount('validated');" style="cursor: pointer;">
                </td>
                <td><span class="order-code">${makeCopyable(record.orden)}</span></td>
                <td class="fecha-validacion">${fechaValidacion}</td>
                <td class="td-wrap">${record.destino || orderData.recipient || '<span class="empty-cell">N/A</span>'}</td>
                <td>${formatISO8601ForDisplay(record.horario || orderData.expectedArrival) || '<span class="empty-cell">N/A</span>'}</td>
                <td style="text-align: center;">${totalCajas || '<span class="empty-cell">0</span>'}</td>
                <td>
                    ${validationDisplay}
                </td>
                <td style="text-align: center;">
                    ${tieneRastreo ? '<span class="rastreo-badge si">SI</span>' : '<span class="rastreo-badge no">NO</span>'}
                </td>
                <td style="text-align: center;">${trsCount > 0 ? `<span class="order-code">${trsCount}</span>` : '<span class="empty-cell">-</span>'}</td>
                <td style="text-align: center;"><strong>${record.cantDespacho || record.cantidadDespachar || 0}</strong></td>
                <td>
                    <span class="status-badge" style="background-color: ${statusColor}; color: white;">${statusBadge}</span>
                </td>
                <td>${estatusCalidad}</td>
                <td>${record.operador || '<span class="empty-cell">N/A</span>'}</td>
                <td>${record.unidad || '<span class="empty-cell">N/A</span>'}</td>
                <td><span class="order-code">${makeCopyable(record.folio)}</span></td>
                <td class="actions-cell">
                    <div class="actions-buttons">
                        <button class="btn-action dispatch" onclick="showValidatedDetails('${record.orden}')" title="Ver detalles de orden">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 7h-9"></path>
                                <path d="M14 17H5"></path>
                                <circle cx="17" cy="17" r="3"></circle>
                                <circle cx="7" cy="7" r="3"></circle>
                            </svg>
                        </button>
                        <button class="btn-delete-validated" onclick="confirmDeleteValidated('${record.orden}')" title="Eliminar y mover a pendientes">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 6h18"></path>
                                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Actualizar badges de contadores
    updateValidatedBadges();
}

// Actualizar badges de contadores en Órdenes Validadas
// FIXED: Count only VISIBLE rows when filters are active
function updateValidatedBadges() {
    const tableBody = document.getElementById('validated-table-body');
    if (!tableBody) return;

    // Count only visible rows
    const visibleRows = Array.from(tableBody.querySelectorAll('tr[data-orden]')).filter(row => row.style.display !== 'none');
    const totalOrders = visibleRows.length;
    let totalBoxes = 0;

    visibleRows.forEach(row => {
        // Get cantidad from column 9 (Cant. Despachar) - adjusted for checkbox column
        const cantidadText = row.cells[9]?.textContent.trim() || '0';
        totalBoxes += parseInt(cantidadText) || 0;
    });

    const ordersCountEl = document.getElementById('validated-orders-count');
    const boxesCountEl = document.getElementById('validated-boxes-count');

    if (ordersCountEl) {
        ordersCountEl.textContent = `${totalOrders} ${totalOrders === 1 ? 'orden' : 'órdenes'}`;
    }
    if (boxesCountEl) {
        boxesCountEl.textContent = `${totalBoxes} ${totalBoxes === 1 ? 'caja' : 'cajas'}`;
    }
}

// Update the date filter indicator in the Validated section
function updateValidatedFilterIndicator() {
    const filterTextEl = document.getElementById('validated-date-filter-text');
    const filterBtn = document.getElementById('validated-date-filter-display');

    if (!filterTextEl) return;

    if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
        // Parse dates as local time to avoid UTC offset issues
        const startParts = STATE.dateFilter.startDate.split('-');
        const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        
        const endParts = STATE.dateFilter.endDate.split('-');
        const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
        
        const start = formatDateDDMMYYYY(startDate);
        const end = formatDateDDMMYYYY(endDate);
        filterTextEl.textContent = `${start} → ${end}`;
        if (filterBtn) {
            filterBtn.classList.add('active-filter');
        }
    } else {
        filterTextEl.textContent = 'Mostrando todo';
        if (filterBtn) {
            filterBtn.classList.remove('active-filter');
        }
    }
}

// Mantener compatibilidad con código existente
function renderValidatedList() {
    renderValidatedTable();
}

function showValidatedDetails(orden) {
    // Buscar el registro por orden en lugar de por índice
    const record = STATE.localValidated.find(v => v.orden === orden);
    if (!record) {
        showNotification('❌ Registro no encontrado', 'error');
        return;
    }

    // Abrir modal con la orden
    showOrderInfo(orden);
}

// ==================== DELETE VALIDATED ORDER ====================
let pendingDeleteOrden = null;

/**
 * Show confirmation modal to delete validated order
 */
function confirmDeleteValidated(orden) {
    pendingDeleteOrden = orden;
    const record = STATE.localValidated.find(v => v.orden === orden);

    if (!record) {
        showNotification('❌ Orden no encontrada', 'error');
        return;
    }

    // Update modal info
    const infoEl = document.getElementById('delete-orden-info');
    if (infoEl) {
        infoEl.innerHTML = `Orden: <strong>${orden}</strong> | Destino: ${record.destino || 'N/A'}`;
    }

    // Show modal
    document.getElementById('delete-validated-modal').style.display = 'flex';
}

/**
 * Close delete confirmation modal
 */
function closeDeleteValidatedModal() {
    document.getElementById('delete-validated-modal').style.display = 'none';
    pendingDeleteOrden = null;
}

/**
 * Show cancel order confirmation modal
 */
function showCancelOrderModal() {
    const orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) return;

    const rastreoData = STATE.mneData.get(STATE.currentOrder) || [];
    const validaciones = STATE.validacionData.get(STATE.currentOrder) || [];
    const totalCajas = orderData.totalCajas || rastreoData.length || validaciones.length || 0;

    // Fill modal with order data
    document.getElementById('cancel-orden-numero').textContent = STATE.currentOrder;
    document.getElementById('cancel-orden-destino').textContent = orderData.recipient || 'N/A';
    document.getElementById('cancel-orden-cajas').textContent = totalCajas;

    // Show modal
    const modal = document.getElementById('cancel-order-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Close cancel order modal
 */
function closeCancelOrderModal() {
    const modal = document.getElementById('cancel-order-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Show "No Procesable" order modal
 */
function showNoProcesableModal() {
    const orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) return;

    const rastreoData = STATE.mneData.get(STATE.currentOrder) || [];
    const validaciones = STATE.validacionData.get(STATE.currentOrder) || [];
    const totalCajas = orderData.totalCajas || rastreoData.length || validaciones.length || 0;

    // Fill modal with order data
    document.getElementById('noprocesable-orden-numero').textContent = STATE.currentOrder;
    document.getElementById('noprocesable-orden-destino').textContent = orderData.recipient || 'N/A';
    document.getElementById('noprocesable-orden-cajas').textContent = totalCajas;

    // Show modal
    const modal = document.getElementById('noprocesable-order-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

/**
 * Close "No Procesable" order modal
 */
function closeNoProcesableModal() {
    const modal = document.getElementById('noprocesable-order-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Normaliza y valida una fecha de envío para la columna G (Horario/Delivery Date)
 * Asegura formato ISO 8601 (YYYY-MM-DD HH:mm:ss) para evitar conversión a número de serie
 * @param {string|Date} dateInput - Fecha en cualquier formato
 * @returns {string} Fecha normalizada en formato ISO 8601 o string vacío si es inválida
 */
function normalizeDeliveryDate(dateInput) {
    if (!dateInput) return '';
    
    let date;
    
    // Si ya es un objeto Date
    if (dateInput instanceof Date) {
        date = dateInput;
    }
    // Si es string, intentar parsearlo
    else if (typeof dateInput === 'string') {
        const trimmed = dateInput.trim();
        
        // Intentar parsear con parseOrderDate primero (maneja múltiples formatos)
        date = parseOrderDate(trimmed);
        
        // Si falla, intentar Date constructor
        if (!date || isNaN(date.getTime())) {
            date = new Date(trimmed);
        }
    }
    // Si es número (número de serie de Excel), convertir
    else if (typeof dateInput === 'number') {
        // Excel epoch: 1900-01-01 (pero con bug de año bisiesto 1900)
        // Días desde 1900-01-01 (número de serie de Excel)
        const excelEpoch = new Date(1899, 11, 30); // 30 de diciembre de 1899
        date = new Date(excelEpoch.getTime() + dateInput * 86400000);
    }
    else {
        return '';
    }
    
    // Validar que la fecha sea válida
    if (!date || isNaN(date.getTime())) {
        console.warn(`⚠️ [NORMALIZE] Fecha inválida recibida: ${dateInput}`);
        return '';
    }
    
    // Formatear a ISO 8601: YYYY-MM-DD HH:mm:ss
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    const normalized = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    
    console.log(`📅 [NORMALIZE] ${dateInput} → ${normalized}`);
    return normalized;
}

/**
 * Formatea fecha y hora para guardar en la base de datos
 * @param {Date} date - Fecha a formatear
 * @returns {Object} { fecha: string, hora: string } en formato DD/MM/YYYY y HH:MM
 */
function formatDateTimeForDB(date = new Date()) {
    // Convertir a zona horaria de México (America/Mexico_City)
    const d = date instanceof Date ? date : new Date(date);
    const mexicoDate = new Date(d.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    
    const day = String(mexicoDate.getDate()).padStart(2, '0');
    const month = String(mexicoDate.getMonth() + 1).padStart(2, '0');
    const year = mexicoDate.getFullYear();
    const hours = String(mexicoDate.getHours()).padStart(2, '0');
    const minutes = String(mexicoDate.getMinutes()).padStart(2, '0');
    
    return {
        fecha: `${day}/${month}/${year}`,
        hora: `${hours}:${minutes}`
    };
}

/**
 * Formatea la última modificación para mostrar en el modal
 * @param {Object} record - Registro con datos de fecha/hora
 * @returns {string} - Fecha y hora formateada
 */
function formatLastModified(record) {
    if (!record) return '--:--';
    
    // Intentar obtener fecha y hora del registro
    const fecha = record.fecha || record.fechaModificacion;
    const hora = record.hora || record.horaModificacion;
    
    if (fecha && hora) {
        return `${fecha} ${hora}`;
    }
    
    // Fallback: intentar parsear timestamp
    if (record.timestamp) {
        try {
            const d = new Date(record.timestamp);
            const { fecha: f, hora: h } = formatDateTimeForDB(d);
            return `${f} ${h}`;
        } catch (e) {
            console.warn('Error parseando timestamp:', e);
        }
    }
    
    return '--:--';
}

/**
 * Valida la estructura del registro antes de sincronizar
 * @param {Object} record - Registro a validar
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateDispatchRecord(record) {
    const errors = [];
    const requiredFields = ['orden', 'estatus', 'timestamp'];
    
    // Validar campos requeridos
    requiredFields.forEach(field => {
        if (!record[field]) {
            errors.push(`Campo requerido faltante: ${field}`);
        }
    });
    
    // Validar tipos de datos críticos
    if (record.cantInicial !== undefined && typeof record.cantInicial !== 'number') {
        errors.push(`cantInicial debe ser número, recibido: ${typeof record.cantInicial}`);
    }
    if (record.cantDespacho !== undefined && typeof record.cantDespacho !== 'number') {
        errors.push(`cantDespacho debe ser número, recibido: ${typeof record.cantDespacho}`);
    }
    
    // Validar formato de fecha
    if (record.fecha && !/^\d{2}\/\d{2}\/\d{4}$/.test(record.fecha)) {
        errors.push(`Formato de fecha inválido: ${record.fecha} (esperado: DD/MM/YYYY)`);
    }
    
    // Validar formato de hora
    if (record.hora && !/^\d{2}:\d{2}$/.test(record.hora)) {
        errors.push(`Formato de hora inválido: ${record.hora} (esperado: HH:MM)`);
    }
    
    // Log de validación
    if (errors.length > 0) {
        console.error('❌ [VALIDACIÓN] Errores encontrados:', errors);
        console.error('❌ [VALIDACIÓN] Registro:', record);
    } else {
        console.log('✅ [VALIDACIÓN] Registro válido:', {
            orden: record.orden,
            usuario: record.usuario,
            operador: record.operador,
            fecha: record.fecha,
            hora: record.hora,
            cantInicial: record.cantInicial,
            cantDespacho: record.cantDespacho
        });
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Execute order cancellation
 */
async function executeConfirmCancelOrder() {
    if (!STATE.currentOrder) {
        closeCancelOrderModal();
        return;
    }

    const orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) {
        showNotification('❌ Error al obtener datos de la orden', 'error');
        closeCancelOrderModal();
        return;
    }

    try {
        // Get current date and time for validation record
        const now = new Date();
        const { fecha, hora } = formatDateTimeForDB(now);

        // Prepare validation record for cancelled order
        // CORRECCIÓN CRÍTICA: usuario (D) != operador (P)
        const validationRecord = {
            folio: '',                                      // A: Folio (vacío para canceladas)
            timestamp: now.toISOString(),                   // Timestamp ISO para referencia interna
            fecha: fecha,                                   // B: Fecha (DD/MM/YYYY)
            hora: hora,                                     // C: Hora (HH:MM)
            usuario: CURRENT_USER || USER_GOOGLE_NAME || '', // D: Usuario (quien cancela)
            orden: STATE.currentOrder,                      // E: Orden
            destino: orderData.recipient || '',             // F: Destino
            horario: normalizeDeliveryDate(orderData.expectedArrival) || '',  // G: Horario (Fecha de Envío normalizada)
            codigo: orderData.trackingCode || '',           // H: Código
            codigo2: orderData.referenceNo || '',           // I: Código 2
            estatus: 'Cancelada',                           // J: Estatus
            tarea: 'Cancelación',                           // K: Tarea
            estatus2: 'N/A',                                // L: Estatus2
            cantInicial: orderData.totalCajas || 0,         // M: Cant Inicial
            cantDespacho: 0,                                // N: Cant Despacho (0 para canceladas)
            incidencias: '',                                // O: Incidencias
            operador: '',                                   // P: Operador (vacío para canceladas)
            conductor: '',                                  // Alias para operador
            unidad: '',                                     // Q: Unidad (vacía para canceladas)
            observaciones: 'Orden cancelada',               // R: Observaciones
            notaDespacho: 'Orden cancelada',                // Alias para observaciones
            // Campos adicionales para compatibilidad UI
            totalCajas: orderData.totalCajas || 0,
            cantidadDespachar: 0,
            porcentajeSurtido: 0,
            calidad: 'N/A',
            nota: 'Orden cancelada',
            track: orderData.trackingCode || ''
        };
        
        // VALIDACIÓN antes de agregar a sync
        const validation = validateDispatchRecord(validationRecord);
        if (!validation.valid) {
            console.error('❌ Registro de cancelación inválido:', validation.errors);
            showNotification('❌ Error de validación: ' + validation.errors.join(', '), 'error');
            return;
        }

        // Add to local validated
        STATE.localValidated.push(validationRecord);
        saveLocalState();

        // Add to sync queue to write to database
        if (window.syncManager && typeof window.syncManager.pushImmediate === 'function') {
            await window.syncManager.pushImmediate(validationRecord);
        } else if (window.syncManager && typeof window.syncManager.addToQueue === 'function') {
            // Fallback para compatibilidad con versiones anteriores
            await window.syncManager.addToQueue(validationRecord);
        } else {
            console.warn('⚠️ syncManager no disponible - la sincronización se realizará más tarde');
        }

        // Close modals
        closeCancelOrderModal();
        closeInfoModal();

        // Re-render tables and update badges
        renderValidatedTable();
        renderOrdersTable();
        updateTabBadges();

        // Show success notification
        showNotification('🚫 Orden marcada como Cancelada y agregada a sincronización', 'info');

    } catch (error) {
        console.error('Error al cancelar orden:', error);
        showNotification('❌ Error al cancelar la orden: ' + error.message, 'error');
        closeCancelOrderModal();
    }
}

/**
 * Marca una orden como "No Procesable"
 * Similar a cancelación pero con estatus y color diferente (amarillo)
 */
async function executeConfirmNoProcesable() {
    if (!STATE.currentOrder) {
        closeNoProcesableModal();
        return;
    }

    const orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) {
        showNotification('❌ Error al obtener datos de la orden', 'error');
        closeNoProcesableModal();
        return;
    }

    try {
        // Get current date and time for validation record
        const now = new Date();
        const { fecha, hora } = formatDateTimeForDB(now);

        // Prepare validation record for non-processable order
        const validationRecord = {
            folio: '',                                      // A: Folio (vacío para no procesables)
            timestamp: now.toISOString(),                   // Timestamp ISO para referencia interna
            fecha: fecha,                                   // B: Fecha (DD/MM/YYYY)
            hora: hora,                                     // C: Hora (HH:MM)
            usuario: CURRENT_USER || USER_GOOGLE_NAME || '', // D: Usuario (quien marca)
            orden: STATE.currentOrder,                      // E: Orden
            destino: orderData.recipient || '',             // F: Destino
            horario: normalizeDeliveryDate(orderData.expectedArrival) || '',  // G: Horario
            codigo: orderData.trackingCode || '',           // H: Código
            codigo2: orderData.referenceNo || '',           // I: Código 2
            estatus: 'No Procesable',                       // J: Estatus (NUEVO)
            tarea: 'No Procesable',                         // K: Tarea (NUEVO)
            estatus2: 'N/A',                                // L: Estatus2
            cantInicial: orderData.totalCajas || 0,         // M: Cant Inicial
            cantDespacho: 0,                                // N: Cant Despacho (0 para no procesables)
            incidencias: '',                                // O: Incidencias
            operador: '',                                   // P: Operador (vacío)
            conductor: '',                                  // Alias para operador
            unidad: '',                                     // Q: Unidad (vacía)
            observaciones: 'Orden no procesable',           // R: Observaciones
            notaDespacho: 'Orden no procesable',            // Alias para observaciones
            // Campos adicionales para compatibilidad UI
            totalCajas: orderData.totalCajas || 0,
            cantidadDespachar: 0,
            porcentajeSurtido: 0,
            calidad: 'N/A',
            nota: 'Orden no procesable',
            track: orderData.trackingCode || ''
        };

        // VALIDACIÓN antes de agregar a sync
        const validation = validateDispatchRecord(validationRecord);
        if (!validation.valid) {
            console.error('❌ Registro de no procesable inválido:', validation.errors);
            showNotification('❌ Error de validación: ' + validation.errors.join(', '), 'error');
            return;
        }

        // Add to local validated
        STATE.localValidated.push(validationRecord);
        saveLocalState();

        // Add to sync queue to write to database
        if (window.syncManager && typeof window.syncManager.pushImmediate === 'function') {
            await window.syncManager.pushImmediate(validationRecord);
        } else if (window.syncManager && typeof window.syncManager.addToQueue === 'function') {
            // Fallback para compatibilidad con versiones anteriores
            await window.syncManager.addToQueue(validationRecord);
        } else {
            console.warn('⚠️ syncManager no disponible - la sincronización se realizará más tarde');
        }

        // Close modals
        closeNoProcesableModal();
        closeInfoModal();

        // Re-render tables and update badges
        renderValidatedTable();
        renderOrdersTable();
        updateTabBadges();

        // Show success notification
        showNotification('⚠️ Orden marcada como No Procesable y agregada a sincronización', 'info');

    } catch (error) {
        console.error('Error al marcar orden como no procesable:', error);
        showNotification('❌ Error al marcar la orden: ' + error.message, 'error');
        closeNoProcesableModal();
    }
}

/**
 * Execute delete and move order back to pending
 * CORREGIDO: Ahora elimina físicamente la fila de Google Sheets
 */
async function executeDeleteValidated() {
    if (!pendingDeleteOrden) {
        closeDeleteValidatedModal();
        return;
    }

    const orden = pendingDeleteOrden;
    showNotification('🔄 Eliminando registro...', 'info');

    // Find record in localValidated
    const index = STATE.localValidated.findIndex(v => v.orden === orden);
    if (index === -1) {
        showNotification('❌ Orden no encontrada en registros locales', 'error');
        closeDeleteValidatedModal();
        return;
    }

    const record = STATE.localValidated[index];
    console.log('🗑️ Iniciando eliminación de orden:', orden);

    try {
        // PASO 1: Eliminar físicamente de Google Sheets
        const deleteResult = await deleteRowFromWriteDB(record);
        
        if (!deleteResult.success) {
            console.error('❌ Error eliminando de BD:', deleteResult.error);
            showNotification('❌ Error al eliminar de la base de datos: ' + (deleteResult.error || 'Error desconocido'), 'error');
            closeDeleteValidatedModal();
            return;
        }
        
        console.log('✅ Fila eliminada de Google Sheets:', deleteResult);

        // PASO 2: CRÍTICO - Limpiar TODOS los residuos de validación
        // Este es el paso que faltaba y causaba el bug de desincronización
        cleanupValidationResidues(orden);

        // PASO 3: Remover de localValidated (ya verificado en cleanupValidationResidues)
        STATE.localValidated.splice(index, 1);

        // PASO 4: Limpiar de folios si aplica
        if (record.folio) {
            cleanupFolioAfterDelete(record);
        }

        // PASO 5: Guardar estado local
        saveLocalState();

        // PASO 6: Re-render ALL UI tables for complete synchronization
        renderValidatedTable();
        renderOtrosTable(); // Also update Otros table
        renderOrdersList(); // La orden AHORA SÍ reaparecerá en pendientes
        
        // Actualizar vista de folios si está activa
        const currentView = document.querySelector('.main-tab.active')?.getAttribute('data-tab');
        if (currentView === 'folios' && record.folio) {
            renderFolioDetailsTable(record.folio);
        }

        // Update badges and summary
        updateTabBadges();
        updateValidatedBadges();
        updateSummary();

        showNotification(`✅ Orden ${orden} eliminada y regresada a pendientes`, 'success');
        
    } catch (error) {
        console.error('❌ Error en executeDeleteValidated:', error);
        showNotification('❌ Error al eliminar: ' + error.message, 'error');
    }

    closeDeleteValidatedModal();
}

/**
 * Elimina físicamente una fila de la BD de Escritura (Google Sheets)
 * @param {Object} record - Registro a eliminar
 * @returns {Promise<Object>} - {success: boolean, error?: string}
 */
async function deleteRowFromWriteDB(record) {
    if (!gapi?.client?.sheets) {
        return { success: false, error: 'Google Sheets API no disponible' };
    }

    try {
        // Primero, encontrar la fila que contiene este registro
        const sheetName = 'BD';
        
        // Obtener todos los datos para encontrar la fila
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: `${sheetName}!A:E`  // Solo necesitamos las primeras columnas para identificar
        });

        const rows = response.result.values || [];
        let rowIndexToDelete = -1;

        // Buscar la fila que coincide con folio Y orden
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowFolio = row[0] || '';
            const rowOrden = row[4] || '';
            
            if (rowFolio === record.folio && rowOrden === record.orden) {
                rowIndexToDelete = i + 1; // +1 porque Sheets es 1-indexed
                console.log(`📍 Fila encontrada: ${rowIndexToDelete} (folio: ${rowFolio}, orden: ${rowOrden})`);
                break;
            }
        }

        if (rowIndexToDelete === -1) {
            console.warn('⚠️ Fila no encontrada en BD, puede que ya haya sido eliminada');
            return { success: true, message: 'Fila no encontrada (ya eliminada)' };
        }

        // Obtener el sheetId para la operación de borrado
        const metadataResponse = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE
        });
        
        const sheet = metadataResponse.result.sheets.find(s => s.properties.title === sheetName);
        if (!sheet) {
            return { success: false, error: `Hoja '${sheetName}' no encontrada` };
        }
        
        const sheetId = sheet.properties.sheetId;

        // Eliminar la fila usando batchUpdate
        const deleteRequest = {
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            resource: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId: sheetId,
                            dimension: 'ROWS',
                            startIndex: rowIndexToDelete - 1, // 0-indexed
                            endIndex: rowIndexToDelete        // exclusive
                        }
                    }
                }]
            }
        };

        await gapi.client.sheets.spreadsheets.batchUpdate(deleteRequest);
        
        console.log(`✅ Fila ${rowIndexToDelete} eliminada exitosamente de Google Sheets`);
        return { success: true, rowDeleted: rowIndexToDelete };

    } catch (error) {
        console.error('Error en deleteRowFromWriteDB:', error);
        return { success: false, error: error.message || 'Error de API' };
    }
}

/**
 * Limpia referencias de folio después de eliminar un registro
 * @param {Object} record - Registro eliminado
 */
function cleanupFolioAfterDelete(record) {
    if (!record.folio) return;
    
    // Verificar si hay otros registros con el mismo folio
    const otherRecordsWithFolio = STATE.localValidated.filter(r => r.folio === record.folio);
    
    if (otherRecordsWithFolio.length === 0) {
        // No hay más registros con este folio, limpiar del mapa de folios
        const fecha = record.fecha;
        if (fecha && STATE.foliosDeCargas.has(fecha)) {
            const foliosDelDia = STATE.foliosDeCargas.get(fecha);
            // Extraer número de folio (ej: "01" de "DDMMYYYY-01")
            const folioNum = record.folio.split('-').pop();
            if (folioNum && foliosDelDia.has(folioNum)) {
                foliosDelDia.delete(folioNum);
                console.log(`🧹 Folio ${folioNum} limpiado del día ${fecha}`);
            }
        }
    }
}

/**
 * Limpia completamente todos los residuos de validación de una orden
 * Asegura que la orden vuelva a su estado original "Pendiente"
 * @param {string} orden - Número de orden
 */
function cleanupValidationResidues(orden) {
    console.log(`🧹 Limpiando residuos de validación para orden ${orden}...`);
    
    // 1. Limpiar flags en obcData
    if (STATE.obcData.has(orden)) {
        const obcOrder = STATE.obcData.get(orden);
        delete obcOrder.isValidated;
        delete obcOrder.validatedAt;
        delete obcOrder.validatedBy;
        delete obcOrder.folio;
        delete obcOrder.conductor;
        delete obcOrder.unidad;
        delete obcOrder.cantidadDespachar;
        console.log(`  ✓ Residuos limpiados en obcData`);
    }
    
    // 2. Limpiar flags en obcDataFiltered
    if (STATE.obcDataFiltered.has(orden)) {
        const obcOrderFiltered = STATE.obcDataFiltered.get(orden);
        delete obcOrderFiltered.isValidated;
        delete obcOrderFiltered.validatedAt;
        delete obcOrderFiltered.validatedBy;
        delete obcOrderFiltered.folio;
        delete obcOrderFiltered.conductor;
        delete obcOrderFiltered.unidad;
        delete obcOrderFiltered.cantidadDespachar;
        console.log(`  ✓ Residuos limpiados en obcDataFiltered`);
    }
    
    // 3. Verificar que no quede en localValidated (doble verificación)
    const remainingIndex = STATE.localValidated.findIndex(v => v.orden === orden);
    if (remainingIndex > -1) {
        STATE.localValidated.splice(remainingIndex, 1);
        console.log(`  ⚠️ Registro residual encontrado y eliminado de localValidated`);
    }
    
    console.log(`✅ Orden ${orden} restaurada completamente a estado Pendiente`);
}

// ==================== SEARCH ====================
// ==================== SCANNER INPUT NORMALIZATION ====================
// Enhanced normalization based on scan.html implementation

/**
 * MEJORA: Match flexible ignorando / y - para comparaciones
 * @param {string} code1 - Primer código
 * @param {string} code2 - Segundo código
 * @returns {boolean} - True si coinciden ignorando separadores
 */
function flexibleCodeMatch(code1, code2) {
    if (!code1 || !code2) return false;
    
    // Normalizar ambos códigos removiendo / y -
    const normalize = (code) => code.toUpperCase().replace(/[\/\-]/g, '');
    
    return normalize(code1) === normalize(code2);
}

/**
 * MEJORA: Busca un código usando match flexible en un Map
 * @param {string} searchCode - Código a buscar
 * @param {Map} dataMap - Map donde buscar
 * @returns {Object|null} - Objeto encontrado o null
 */
function findWithFlexibleMatch(searchCode, dataMap) {
    if (!searchCode || !dataMap) return null;
    
    // 1. Búsqueda directa
    if (dataMap.has(searchCode)) {
        return dataMap.get(searchCode);
    }
    
    // 2. Búsqueda flexible (ignorando / y -)
    for (const [key, value] of dataMap.entries()) {
        if (flexibleCodeMatch(searchCode, key)) {
            console.log(`✅ Match flexible: "${searchCode}" coincide con "${key}"`);
            return value;
        }
    }
    
    return null;
}

/**
 * REFACTORIZADO: Usa función compartida normalizeCode de wms-utils.js
 * Evita duplicación de código y mantiene consistencia en todo el sistema
 */
function normalizeScannerInput(raw) {
    // Usar función compartida si está disponible
    if (typeof window.normalizeCode === 'function') {
        return window.normalizeCode(raw);
    }
    
    // Fallback básico si no está disponible la función compartida
    if (!raw) return '';
    return raw.trim().toUpperCase().replace(/[^A-Z0-9\-\/]/g, '');
}

/**
 * MEJORA: Normaliza código usando funciones compartidas de wms-utils.js
 * @param {string} rawCode - Código sin procesar
 * @returns {string} - Código normalizado
 */
function normalizeCodeShared(rawCode) {
    // Usar función compartida si está disponible
    if (typeof window.normalizeCode === 'function') {
        return window.normalizeCode(rawCode);
    }
    
    // Fallback a normalización local
    return normalizeScannerInput(rawCode);
}

// Intelligent code search with dash/slash alternation
function findCodeWithVariants(code, dataMap) {
    // Try original
    if (dataMap.has(code)) {
        return { found: true, code: code, variant: 'original' };
    }

    // If contains "/", try with "-"
    if (code.includes('/')) {
        const withDash = code.replace(/\//g, '-');
        if (dataMap.has(withDash)) {
            return { found: true, code: withDash, variant: 'dash' };
        }
    }

    // If contains "-", try with "/"
    if (code.includes('-')) {
        const withSlash = code.replace(/-/g, '/');
        if (dataMap.has(withSlash)) {
            return { found: true, code: withSlash, variant: 'slash' };
        }
    }

    return { found: false, code: code, variant: 'none' };
}

// CHANGE 4: Enhanced executeSearch with scanner normalization + Background Index
async function executeSearch() {
    const searchInput = document.getElementById('search-input');
    const rawQuery = searchInput?.value.trim() || '';

    if (!rawQuery) {
        showNotification('⚠️ Ingresa un código para buscar', 'warning');
        hideNormalizedCodeDisplay();
        return;
    }

    // MEJORA: Normalización previa con función compartida
    const queryNormalized = normalizeCodeShared(rawQuery);
    const query = queryNormalized.toUpperCase();
    
    console.log(`🔍 Búsqueda optimizada multicanal: raw="${rawQuery}" → normalized="${query}"`);
    
    // Mostrar código normalizado en UI
    showNormalizedCodeDisplay(query);

    // Check if user can perform search (online check for edit operations later)
    if (!STATE.isOnline) {
        showNotification('⚠️ Modo offline - Solo consulta disponible', 'warning');
    }
    
    console.log('📊 Búsqueda multicanal iniciada:', {
        rawQuery,
        queryNormalized,
        query,
        'Filtro activo': STATE.dateFilter.active,
        'Órdenes en filtro': STATE.obcDataFiltered.size,
        'Órdenes totales': STATE.obcData.size
    });

    // NUEVA LÓGICA: Búsqueda multicanal con prioridad de filtro
    let foundOrders = [];
    let searchedInBackground = false;
    const isOBC = query.startsWith('OBC');

    if (isOBC) {
        // ===== LÓGICA PARA OBC =====
        // Prioridad 1: Match exacto
        if (STATE.obcData.has(query)) {
            foundOrders.push({ orden: query, source: 'OBC Directo', confidence: 100 });
        } else {
            // Prioridad 2: Match parcial
            for (const orden of STATE.obcData.keys()) {
                if (orden.includes(query)) {
                    foundOrders.push({ orden, source: 'OBC Parcial', confidence: 80 });
                }
            }
        }
    } else {
        // ===== LÓGICA CRÍTICA PARA CÓDIGO DE CAJA =====
        const codeBaseMatch = query.match(/^([A-Z0-9]+?)(?:[U]\d{3})?$/);
        const codeBase = codeBaseMatch ? codeBaseMatch[1] : query;

        // MEJORA: PRIORIDAD 1 - Búsqueda con match flexible
        let foundWithFlexible = findWithFlexibleMatch(query, STATE.bdCajasData);
        
        if (foundWithFlexible) {
            // Encontrado con match flexible
            if (Array.isArray(foundWithFlexible)) {
                foundWithFlexible.forEach(caja => {
                    foundOrders.push({
                        orden: caja.obc,
                        source: `Código (Match Flexible): ${query}`,
                        confidence: 100,
                        matchedCode: query
                    });
                });
            } else {
                foundOrders.push({
                    orden: foundWithFlexible.obc || foundWithFlexible,
                    source: `Código (Match Flexible): ${query}`,
                    confidence: 100,
                    matchedCode: query
                });
            }
        } else if (STATE.bdCajasData.has(query)) {
            // Búsqueda directa tradicional
            const cajas = STATE.bdCajasData.get(query);
            cajas.forEach(caja => {
                foundOrders.push({
                    orden: caja.obc,
                    source: `Código Completo: ${query}`,
                    confidence: 100,
                    matchedCode: query
                });
            });
        }

        // PRIORIDAD 1B: Búsqueda con código normalizado
        if (foundOrders.length === 0) {
            console.log('🔍 DEBUG - Búsqueda con código normalizado:', {
                queryNormalized,
                'Total códigos en BD': STATE.bdCajasData.size
            });
            
            let matchCount = 0;
            for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
                const codigoNormalized = normalizeCode(codigo);
                
                // Log primeros 10 para debugging
                if (matchCount < 10) {
                    console.log(`  📋 Comparando: "${codigo}" → "${codigoNormalized}" vs "${queryNormalized}"`);
                    matchCount++;
                }
                
                if (codigoNormalized === queryNormalized) {
                    console.log(`✅ MATCH ENCONTRADO: "${codigo}" normalizado a "${codigoNormalized}"`);
                    cajas.forEach(caja => {
                        foundOrders.push({
                            orden: caja.obc,
                            source: `Código Normalizado: ${rawQuery}`,
                            confidence: 100,
                            matchedCode: codigo
                        });
                    });
                    break;
                }
            }
            
            if (foundOrders.length === 0) {
                console.warn('⚠️ DEBUG - No se encontró match con código normalizado');
            }
        }

        // PRIORIDAD 2: Código BASE en BD Cajas
        if (foundOrders.length === 0 && codeBase !== query) {
            for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
                const codigoNormalized = normalizeCode(codigo);
                if (codigo.includes(codeBase) || codigoNormalized.includes(queryNormalized)) {
                    cajas.forEach(caja => {
                        if (!foundOrders.some(f => f.orden === caja.obc)) {
                            foundOrders.push({
                                orden: caja.obc,
                                source: `Código Base: ${codeBase}`,
                                confidence: 90,
                                matchedCode: codeBase
                            });
                        }
                    });
                }
            }
        }

        // NUEVA PRIORIDAD 3: Búsqueda por Código Track (trackingCode) - BÚSQUEDA EN CASCADA
        if (foundOrders.length === 0) {
            console.log('🔍 Buscando por Código Track (cascada)...');

            // PASO 1: Buscar por Código Normalizado (exacto y parcial)
            for (const [orden, data] of STATE.obcData.entries()) {
                if (data.trackingCode) {
                    const trackNormalized = normalizeCodeShared(data.trackingCode).toUpperCase();

                    // Match exacto con Código Normalizado
                    if (data.trackingCode.toUpperCase() === query || trackNormalized === queryNormalized) {
                        foundOrders.push({ orden, source: 'Código Track (Normalizado)', confidence: 100 });
                        console.log(`✅ Match Track Normalizado: ${data.trackingCode} → ${orden}`);
                    }
                    // Match parcial con Código Normalizado
                    else if (trackNormalized.includes(queryNormalized)) {
                        foundOrders.push({ orden, source: 'Código Track (Normalizado Parcial)', confidence: 95 });
                        console.log(`✅ Match Track Normalizado Parcial: ${data.trackingCode} → ${orden}`);
                    }
                }
            }

            // PASO 2: Si no hay resultados, buscar por Código Base (sin número de caja)
            if (foundOrders.length === 0) {
                console.log('🔍 Buscando por Código Track BASE (sin número de caja)...');

                // Usar función compartida mejorada para extraer código base
                const queryBase = extractBaseCode(queryNormalized);
                console.log(`   Query Base extraído: "${queryBase}" desde "${queryNormalized}"`);

                for (const [orden, data] of STATE.obcData.entries()) {
                    if (data.trackingCode) {
                        const trackNormalized = normalizeCodeShared(data.trackingCode).toUpperCase();
                        // Usar función compartida para extraer base del tracking
                        const trackBase = extractBaseCode(trackNormalized);

                        // Comparación exacta de códigos base
                        if (queryBase && trackBase && trackBase === queryBase) {
                            foundOrders.push({ orden, source: 'Código Track (Base)', confidence: 85 });
                            console.log(`✅ Match Track Base: ${data.trackingCode} (normalizado: ${trackNormalized}, base: ${trackBase}) → ${orden}`);
                        }
                    }
                }
            }
        }

        // NUEVA PRIORIDAD 4: Búsqueda por Código Referencia (referenceNo) - BÚSQUEDA EN CASCADA
        if (foundOrders.length === 0) {
            console.log('🔍 Buscando por Código Referencia (cascada)...');

            // PASO 1: Buscar por Código Normalizado (exacto y parcial)
            for (const [orden, data] of STATE.obcData.entries()) {
                if (data.referenceNo) {
                    const refNormalized = normalizeCodeShared(data.referenceNo).toUpperCase();

                    // Match exacto con Código Normalizado
                    if (data.referenceNo.toUpperCase() === query || refNormalized === queryNormalized) {
                        foundOrders.push({ orden, source: 'Código Referencia (Normalizado)', confidence: 100 });
                        console.log(`✅ Match Referencia Normalizado: ${data.referenceNo} → ${orden}`);
                    }
                    // Match parcial con Código Normalizado
                    else if (refNormalized.includes(queryNormalized)) {
                        foundOrders.push({ orden, source: 'Código Referencia (Normalizado Parcial)', confidence: 95 });
                        console.log(`✅ Match Referencia Normalizado Parcial: ${data.referenceNo} → ${orden}`);
                    }
                }
            }

            // PASO 2: Si no hay resultados, buscar por Código Base (sin número de caja)
            if (foundOrders.length === 0) {
                console.log('🔍 Buscando por Código Referencia BASE (sin número de caja)...');

                // Usar función compartida mejorada para extraer código base
                const queryBase = extractBaseCode(queryNormalized);
                console.log(`   Query Base extraído: "${queryBase}" desde "${queryNormalized}"`);

                for (const [orden, data] of STATE.obcData.entries()) {
                    if (data.referenceNo) {
                        const refNormalized = normalizeCodeShared(data.referenceNo).toUpperCase();
                        // Usar función compartida para extraer base de referencia
                        const refBase = extractBaseCode(refNormalized);

                        // Comparación exacta de códigos base
                        if (queryBase && refBase && refBase === queryBase) {
                            foundOrders.push({ orden, source: 'Código Referencia (Base)', confidence: 85 });
                            console.log(`✅ Match Referencia Base: ${data.referenceNo} (normalizado: ${refNormalized}, base: ${refBase}) → ${orden}`);
                        }
                    }
                }
            }
        }

        // PRIORIDAD 5: Rastreo MNE
        if (foundOrders.length === 0) {
            for (const [orden, rastreoItems] of STATE.mneData.entries()) {
                const match = rastreoItems.find(r =>
                    (r.codigo && r.codigo.toUpperCase() === query) ||
                    (r.codigo && r.codigo.toUpperCase().includes(codeBase))
                );
                if (match) {
                    foundOrders.push({ orden, source: 'Rastreo MNE', confidence: 95 });
                }
            }
        }

        // PRIORIDAD 6: Validaciones
        if (foundOrders.length === 0) {
            for (const [orden, validaciones] of STATE.validacionData.entries()) {
                const match = validaciones.find(v =>
                    (v.codigo && v.codigo.toUpperCase() === query) ||
                    (v.codigo && v.codigo.toUpperCase().includes(codeBase))
                );
                if (match) {
                    foundOrders.push({ orden, source: 'Validación', confidence: 90 });
                }
            }
        }

        // PRIORIDAD 7: TRS (último recurso)
        if (foundOrders.length === 0) {
            for (const trsEntry of STATE.trsData) {
                if ((trsEntry.codigoOriginal && trsEntry.codigoOriginal.toUpperCase().includes(query)) ||
                    (trsEntry.codigoNuevo && trsEntry.codigoNuevo.toUpperCase().includes(query))) {
                    const ref = trsEntry.referencia;
                    for (const [orden, data] of STATE.obcData.entries()) {
                        if ((data.referenceNo && data.referenceNo.toUpperCase().includes(ref.toUpperCase())) ||
                            (data.trackingCode && data.trackingCode.toUpperCase().includes(ref.toUpperCase()))) {
                            foundOrders.push({ orden, source: `TRS (${trsEntry.trs})`, confidence: 75 });
                            break;
                        }
                    }
                    if (foundOrders.length > 0) break;
                }
            }
        }
    }

    // OPTIMIZACIÓN: Ordenar por confidence (mayor a menor) y eliminar duplicados
    foundOrders.sort((a, b) => b.confidence - a.confidence);
    const uniqueOrders = [];
    const seenOrders = new Set();
    for (const order of foundOrders) {
        if (!seenOrders.has(order.orden)) {
            seenOrders.add(order.orden);
            uniqueOrders.push(order);
        }
    }
    foundOrders = uniqueOrders;

    // ==================== BÚSQUEDA CROSS-FILTER EN ÍNDICE GLOBAL ====================
    console.log('🔍 [DEBUG] Verificando búsqueda cross-filter:', {
        foundOrdersLength: foundOrders.length,
        searchInBackgroundIndexExists: typeof searchInBackgroundIndex === 'function',
        getBackgroundIndexStatusExists: typeof getBackgroundIndexStatus === 'function',
        isBackgroundIndexReadyExists: typeof isBackgroundIndexReady === 'function'
    });
    
    if (foundOrders.length === 0 && typeof searchInBackgroundIndex === 'function') {
        console.log('🔍 [Cross-Filter] No hay resultados en datos cargados, consultando índice global...');
        
        // ==================== STATUS CHECK: Verificar si índice está listo ====================
        const indexStatus = typeof getBackgroundIndexStatus === 'function' ? getBackgroundIndexStatus() : null;
        
        console.log('📊 [DEBUG] Status del índice:', indexStatus);
        
        if (indexStatus && indexStatus.isLoading) {
            // ÍNDICE CARGANDO: Mostrar preloader con progreso
            console.log(`⏳ [Cross-Filter] Índice cargando... ${indexStatus.loadProgress.toFixed(0)}%`);
            
            showSearchLoader(true, `Cargando base de datos histórica... ${indexStatus.loadProgress.toFixed(0)}%`);
            showNotification(`⏳ Búsqueda histórica cargando... ${indexStatus.loadProgress.toFixed(0)}% - Por favor espere`, 'info', 3000);
            
            // ==================== REINTENTO AUTOMÁTICO ====================
            // Esperar a que termine de cargar y reintentar búsqueda
            const retryInterval = setInterval(() => {
                const currentStatus = getBackgroundIndexStatus();
                
                if (currentStatus.isReady) {
                    clearInterval(retryInterval);
                    console.log('✅ [Cross-Filter] Índice listo - Reintentando búsqueda automáticamente...');
                    
                    showSearchLoader(false);
                    showNotification('✅ Base de datos histórica lista - Reintentando búsqueda...', 'success', 2000);
                    
                    // Reintentar búsqueda automáticamente
                    setTimeout(() => {
                        // Restaurar query en input y ejecutar búsqueda
                        if (searchInput) {
                            searchInput.value = rawQuery;
                            executeSearch();
                        }
                    }, 500);
                } else if (!currentStatus.isLoading) {
                    // Si dejó de cargar pero no está listo (error)
                    clearInterval(retryInterval);
                    showSearchLoader(false);
                    showNotification('❌ Error cargando base de datos histórica', 'error');
                }
            }, 1000); // Verificar cada segundo
            
            return; // Salir y esperar reintento
        }
        
        // ÍNDICE LISTO: Buscar en índice
        if (indexStatus && indexStatus.isReady) {
            showSearchLoader(true);
            
            const backgroundResults = searchInBackgroundIndex(query);
            
            if (backgroundResults && backgroundResults.length > 0) {
                console.log(`✅ [Cross-Filter] Encontrados ${backgroundResults.length} OBCs en índice global`);

                // backgroundResults ahora incluye {obc, fecha, recipient, etc} ordenados por fecha
                for (const result of backgroundResults) {
                    foundOrders.push({
                        orden: result.obc,
                        source: 'Búsqueda Histórica (Índice Global)',
                        confidence: 95,
                        fecha: result.fecha,
                        recipient: result.recipient
                    });
                }

                // Log de múltiples coincidencias
                if (backgroundResults.length > 1) {
                    console.log(`📋 [Cross-Filter] Múltiples coincidencias encontradas (${backgroundResults.length}):`,
                        backgroundResults.map(r => `${r.obc} (${r.fecha})`));
                }
                
                searchedInBackground = true;

                // Mostrar alerta con fecha de la primera orden encontrada y status temporal
                const primeraOrden = backgroundResults[0];
                let temporalStatus = '';

                if (STATE.dateFilter.active && primeraOrden.fecha && primeraOrden.fecha !== 'N/A') {
                    const orderDate = new Date(primeraOrden.fecha);
                    const filterStart = new Date(STATE.dateFilter.startDate);
                    const filterEnd = new Date(STATE.dateFilter.endDate);

                    if (orderDate < filterStart) {
                        temporalStatus = ' ⏪ (Orden pasada)';
                    } else if (orderDate > filterEnd) {
                        temporalStatus = ' ⏩ (Orden futura)';
                    }
                }

                showNotification(`📦 ${primeraOrden.obc} - Fecha: ${primeraOrden.fecha}${temporalStatus}`, 'info', 5000);
            }
            
            showSearchLoader(false);
        }
    }

    // MEJORA: Limpiar searchbox siempre después de buscar
    if (searchInput) {
        searchInput.value = '';
    }

    if (foundOrders.length === 0) {
        console.error('❌ No se encontraron resultados para:', {
            rawQuery,
            queryNormalized,
            query,
            'Canales buscados': ['OBC', 'Código Caja', 'Código Track', 'Código Referencia', 'MNE', 'Validaciones', 'TRS', 'Background Index']
        });
        
        // Verificar si el índice está cargando
        if (typeof isBackgroundIndexReady === 'function' && !isBackgroundIndexReady()) {
            const status = getBackgroundIndexStatus();
            if (status.isLoading) {
                showNotification(`⏳ Búsqueda histórica cargando... ${status.loadProgress.toFixed(0)}%`, 'info', 3000);
            } else {
                showNotification('❌ No se encontró la orden o código', 'error');
            }
        } else {
            showNotification('❌ No se encontró la orden o código', 'error');
        }
        return;
    }

    console.log(`✅ Encontradas ${foundOrders.length} coincidencias:`, foundOrders.map(o => `${o.orden} (${o.source})` ));

    // LÓGICA DE SELECCIÓN INTELIGENTE CON PRIORIDAD DE FILTRO
    if (STATE.dateFilter.active) {
        // Filtrar coincidencias que están dentro del rango de fechas activo
        const ordersInFilter = foundOrders.filter(o => STATE.obcDataFiltered.has(o.orden));
        const ordersOutFilter = foundOrders.filter(o => !STATE.obcDataFiltered.has(o.orden));
        
        console.log('📊 Análisis de filtro:', {
            'Total coincidencias': foundOrders.length,
            'Dentro del filtro': ordersInFilter.length,
            'Fuera del filtro': ordersOutFilter.length
        });

        // ESCENARIO A: Coincidencia única dentro del filtro → ABRIR INMEDIATAMENTE
        if (ordersInFilter.length === 1) {
            const foundOrden = ordersInFilter[0].orden;
            const foundSource = ordersInFilter[0].source;
            console.log(`✅ ESCENARIO A: Coincidencia única en filtro - Abriendo ${foundOrden} INMEDIATAMENTE`);
            showNotification(`📦 ${foundSource}: ${foundOrden}`, 'success', 2000);
            showOrderInfo(foundOrden);
            if (searchInput) searchInput.value = '';
            return;
        }
        
        // ESCENARIO B: Múltiples coincidencias dentro del filtro
        if (ordersInFilter.length > 1) {
            console.log(`📋 ESCENARIO B: ${ordersInFilter.length} coincidencias en filtro - Mostrando selector`);
            showMultipleMatchesModal(ordersInFilter, query);
            if (searchInput) searchInput.value = '';
            return;
        }
        
        // ESCENARIO C: Sin coincidencias en filtro, pero sí en historial → MODAL DE CONFIRMACIÓN
        if (ordersInFilter.length === 0 && ordersOutFilter.length > 0) {
            console.log(`⚠️ ESCENARIO C: ${ordersOutFilter.length} coincidencias fuera del filtro - Mostrando modal de confirmación`);

            if (ordersOutFilter.length === 1) {
                // Orden única fuera del filtro: mostrar modal de confirmación
                // Pasar todos los datos disponibles del background index
                const orderMatch = ordersOutFilter[0];
                showHistoricalOrderConfirmationModal(orderMatch.orden, query, {
                    fecha: orderMatch.fecha,
                    recipient: orderMatch.recipient,
                    source: orderMatch.source
                });
            } else {
                // Múltiples órdenes fuera del filtro: mostrar selector
                ordersOutFilter.forEach(o => o.source += ' (Histórico)');
                showMultipleMatchesModal(ordersOutFilter, query);
            }

            if (searchInput) searchInput.value = '';
            return;
        }
    } else {
        // Sin filtro activo: comportamiento tradicional
        if (foundOrders.length === 1) {
            const foundOrden = foundOrders[0].orden;
            const foundSource = foundOrders[0].source;
            console.log(`✅ Orden única encontrada: ${foundOrden}`);
            showNotification(`📦 ${foundSource}: ${foundOrden}`, 'success', 2000);
            showOrderInfo(foundOrden);
            if (searchInput) searchInput.value = '';
            return;
        }
        
        if (foundOrders.length > 1) {
            console.log(`📋 ${foundOrders.length} coincidencias - Mostrando selector`);
            showMultipleMatchesModal(foundOrders, query);
            if (searchInput) searchInput.value = '';
            return;
        }
    }
}

/**
 * Muestra el código normalizado en la UI
 * @param {string} normalizedCode - Código normalizado
 */
function showNormalizedCodeDisplay(normalizedCode) {
    const display = document.getElementById('normalized-code-display');
    const valueEl = document.getElementById('normalized-code-value');
    
    if (display && valueEl) {
        valueEl.textContent = normalizedCode;
        display.style.display = 'flex';
        
        // Guardar en variable global para copiar
        window.lastNormalizedCode = normalizedCode;
    }
}

/**
 * Oculta el display de código normalizado
 */
function hideNormalizedCodeDisplay() {
    const display = document.getElementById('normalized-code-display');
    if (display) {
        display.style.display = 'none';
    }
    window.lastNormalizedCode = null;
}

/**
 * Muestra el loader de búsqueda en background
 * @param {boolean} show - true para mostrar, false para ocultar
 */
function showSearchLoader(show, customMessage = null) {
    const loader = document.getElementById('search-loader');
    if (loader) {
        loader.style.display = show ? 'flex' : 'none';
        
        // Actualizar mensaje si se proporciona uno personalizado
        if (customMessage) {
            const messageElement = loader.querySelector('.search-loader-text');
            if (messageElement) {
                messageElement.textContent = customMessage;
            }
        } else {
            // Restaurar mensaje por defecto
            const messageElement = loader.querySelector('.search-loader-text');
            if (messageElement) {
                messageElement.textContent = 'Buscando en base de datos completa...';
            }
        }
    }
}

/**
 * Copia el código normalizado al portapapeles
 */
function copyNormalizedCode() {
    const code = window.lastNormalizedCode;
    if (!code) {
        showNotification('⚠️ No hay código para copiar', 'warning');
        return;
    }
    
    navigator.clipboard.writeText(code).then(() => {
        showNotification('✅ Código copiado: ' + code, 'success', 2000);
    }).catch(err => {
        console.error('Error al copiar:', err);
        showNotification('❌ Error al copiar código', 'error');
    });
}

function showMultipleMatchesModal(foundOrders, query) {
    // Eliminar duplicados de órdenes (mantener el de mayor confianza)
    const uniqueOrders = new Map();
    foundOrders.forEach(match => {
        if (!uniqueOrders.has(match.orden) ||
            uniqueOrders.get(match.orden).confidence < match.confidence) {
            uniqueOrders.set(match.orden, match);
        }
    });

    const uniqueFoundOrders = Array.from(uniqueOrders.values());

    document.getElementById('matches-count').textContent = uniqueFoundOrders.length;
    const matchesList = document.getElementById('matches-list');

    matchesList.innerHTML = uniqueFoundOrders.map((match) => {
        // Prioridad 1: Usar datos del match si están disponibles (background index)
        // Prioridad 2: Buscar en STATE.obcData (datos del filtro actual)
        const orderData = STATE.obcData.get(match.orden);

        const recipient = match.recipient || orderData?.recipient || 'N/A';
        const expectedArrival = match.fecha || orderData?.expectedArrival || 'N/A';
        const totalCajas = orderData?.totalCajas || 0;

        // Determinar si la orden es del pasado o futuro
        let timeIndicator = '';
        if (STATE.dateFilter.active && expectedArrival !== 'N/A') {
            const orderDate = new Date(expectedArrival);
            const filterStart = new Date(STATE.dateFilter.startDate);
            const filterEnd = new Date(STATE.dateFilter.endDate);

            if (orderDate < filterStart) {
                timeIndicator = ' <span style="color: #6c757d; font-size: 0.9em;">⏪ Pasado</span>';
            } else if (orderDate > filterEnd) {
                timeIndicator = ' <span style="color: #17a2b8; font-size: 0.9em;">⏩ Futuro</span>';
            }
        }

        return `
            <div class="match-item" onclick="selectMatch('${match.orden}')">
                <div class="match-header">
                    <div class="match-obc">${match.orden}${timeIndicator}</div>
                    <div class="match-confidence">${match.confidence}% coincidencia</div>
                </div>
                <div class="match-details">
                    <div class="match-detail">📍 ${recipient}</div>
                    <div class="match-detail">📅 ${expectedArrival}</div>
                    <div class="match-detail">📦 ${totalCajas} cajas</div>
                </div>
                <div class="match-source">Fuente: ${match.source}</div>
            </div>
        `;
    }).join('');

    document.getElementById('multiple-matches-modal').classList.add('show');
}

function selectMatch(orden) {
    closeMultipleMatchesModal();
    showOrderInfo(orden);
}

function closeMultipleMatchesModal() {
    document.getElementById('multiple-matches-modal').classList.remove('show');
}

/**
 * Muestra modal de confirmación para orden histórica (fuera del filtro activo)
 * @param {string} orden - ID de la orden
 * @param {string} searchQuery - Código buscado
 */
async function showHistoricalOrderConfirmationModal(orden, searchQuery, backgroundData = null) {
    console.log('⚠️ [Confirmación Histórica] Mostrando modal para orden fuera del filtro:', orden);

    let orderData = null;
    let recipient = 'N/A';
    let expectedArrival = 'N/A';
    let totalCajas = 0;
    let trackingCode = 'N/A';
    let referenceNo = 'N/A';

    // Prioridad 1: Usar datos del background index si están disponibles
    if (backgroundData && backgroundData.fecha) {
        console.log('✅ [Confirmación Histórica] Usando datos del Background Index:', backgroundData);
        recipient = backgroundData.recipient || 'N/A';
        expectedArrival = backgroundData.fecha || 'N/A';
        trackingCode = 'N/A'; // Background index no tiene trackingCode en este contexto
        referenceNo = 'N/A';  // Background index no tiene referenceNo en este contexto
        totalCajas = 0;
    } else {
        // Prioridad 2: Intentar obtener datos de STATE.obcData (datos completos sin filtro)
        orderData = STATE.obcData.get(orden);

        // Si no está en obcData, cargar desde BD_CAJAS
        if (!orderData) {
            console.log('📥 [Confirmación Histórica] Orden no en caché, cargando desde BD_CAJAS...');
            showNotification('⏳ Cargando datos de la orden...', 'info', 2000);

            try {
                const response = await fetch(CONFIG.SOURCES.BD_CAJAS);
                const csv = await response.text();
                const lines = csv.split('\n').filter(l => l.trim());

                // Buscar la orden en el CSV
                for (let i = 1; i < lines.length; i++) {
                    const cols = parseCSVLine(lines[i]);
                    if (cols.length >= 9 && cols[0]?.trim() === orden) {
                        orderData = {
                            orden: cols[0]?.trim(),
                            referenceNo: cols[1]?.trim() || '',
                            shippingService: cols[2]?.trim() || '',
                            trackingCode: cols[3]?.trim() || '',
                            expectedArrival: cols[4]?.trim() || '',
                            remark: cols[5]?.trim() || '',
                            recipient: cols[6]?.trim() || '',
                            boxType: cols[7]?.trim() || '',
                            customBarcode: cols[8]?.trim() || '',
                            totalCajas: 0,
                            isValidated: false
                        };
                        break;
                    }
                }
            } catch (error) {
                console.error('❌ Error cargando datos de BD_CAJAS:', error);
            }
        }

        if (!orderData) {
            console.error('❌ No se encontraron datos para la orden:', orden);
            showNotification('❌ Error al cargar datos de la orden', 'error');
            return;
        }

        // Obtener información de la orden
        recipient = orderData.recipient || 'N/A';
        expectedArrival = orderData.expectedArrival || 'N/A';
        totalCajas = orderData.totalCajas || 0;
        trackingCode = orderData.trackingCode || 'N/A';
        referenceNo = orderData.referenceNo || 'N/A';
    }

    // Determinar si la orden es del pasado o futuro comparando con el filtro
    let timeStatus = '';
    let timeIcon = '⚠️';
    let timeColor = '#ffc107';

    if (STATE.dateFilter.active && expectedArrival !== 'N/A') {
        const orderDate = new Date(expectedArrival);
        const filterStart = new Date(STATE.dateFilter.startDate);
        const filterEnd = new Date(STATE.dateFilter.endDate);

        if (orderDate < filterStart) {
            timeStatus = 'del pasado';
            timeIcon = '⏪';
            timeColor = '#6c757d';
        } else if (orderDate > filterEnd) {
            timeStatus = 'del futuro';
            timeIcon = '⏩';
            timeColor = '#17a2b8';
        } else {
            timeStatus = 'fuera del rango filtrado';
            timeIcon = '⚠️';
            timeColor = '#ffc107';
        }
    }

    const warningMessage = timeStatus
        ? `Esta orden es <strong>${timeStatus}</strong> y no corresponde al rango de fechas actual.`
        : `Esta orden <strong>no está dentro del rango de fechas del filtro activo</strong>.`;

    // Crear modal HTML
    const modalHTML = `
        <div id="historical-order-modal" class="modal-overlay" style="display: flex; z-index: 10000;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header" style="background: #fff3cd; border-bottom: 2px solid ${timeColor};">
                    <h3 style="margin: 0; color: #856404;">${timeIcon} Orden Fuera del Filtro Activo</h3>
                </div>
                <div class="modal-body" style="padding: 24px;">
                    <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                        <p style="margin: 0 0 12px 0; font-size: 0.95em; color: #6c757d;">
                            ${warningMessage}
                            ¿Estás seguro de que deseas abrirla?
                        </p>
                        <div style="background: white; padding: 12px; border-radius: 6px; border-left: 4px solid ${timeColor};">
                            <div style="font-size: 0.9em; color: #495057; margin-bottom: 8px;">
                                <strong>Código buscado:</strong> ${searchQuery}
                            </div>
                            ${timeStatus ? `<div style="font-size: 0.85em; color: #856404; margin-top: 8px; font-weight: 500;">
                                ${timeIcon} Orden ${timeStatus}
                            </div>` : ''}
                        </div>
                    </div>
                    
                    <div style="border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; background: white;">
                        <h4 style="margin: 0 0 12px 0; font-size: 1.1em; color: #2196f3;">📦 ${orden}</h4>
                        <div style="display: grid; gap: 10px; font-size: 0.9em;">
                            <div style="display: flex; align-items: start; gap: 8px;">
                                <span style="color: #6c757d; min-width: 100px;">📍 Destinatario:</span>
                                <span style="font-weight: 500;">${recipient}</span>
                            </div>
                            <div style="display: flex; align-items: start; gap: 8px;">
                                <span style="color: #6c757d; min-width: 100px;">📅 Fecha Entrega:</span>
                                <span style="font-weight: 500;">${expectedArrival}</span>
                            </div>
                            <div style="display: flex; align-items: start; gap: 8px;">
                                <span style="color: #6c757d; min-width: 100px;">📦 Total Cajas:</span>
                                <span style="font-weight: 500;">${totalCajas}</span>
                            </div>
                            <div style="display: flex; align-items: start; gap: 8px;">
                                <span style="color: #6c757d; min-width: 100px;">🔢 Código Track:</span>
                                <span style="font-weight: 500; font-size: 0.85em;">${trackingCode}</span>
                            </div>
                            <div style="display: flex; align-items: start; gap: 8px;">
                                <span style="color: #6c757d; min-width: 100px;">📋 Referencia:</span>
                                <span style="font-weight: 500; font-size: 0.85em;">${referenceNo}</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="display: flex; gap: 12px; justify-content: flex-end; padding: 16px 24px; background: #f8f9fa; border-top: 1px solid #dee2e6;">
                    <button class="btn btn-secondary" onclick="closeHistoricalOrderModal()" style="min-width: 100px;">
                        ✕ Cancelar
                    </button>
                    <button class="btn btn-primary" onclick="confirmOpenHistoricalOrder('${orden}')" style="min-width: 120px; background: #ffc107; color: #000;">
                        ✓ Abrir Orden
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Insertar modal en el DOM
    const existingModal = document.getElementById('historical-order-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    console.log('✅ Modal de confirmación histórica mostrado');
}

/**
 * Confirma y abre la orden histórica
 */
function confirmOpenHistoricalOrder(orden) {
    console.log('✅ Usuario confirmó apertura de orden histórica:', orden);
    closeHistoricalOrderModal();
    showNotification(`📦 Abriendo orden histórica: ${orden}`, 'info', 2000);
    showOrderInfo(orden);
}

/**
 * Cierra el modal de confirmación histórica
 */
function closeHistoricalOrderModal() {
    const modal = document.getElementById('historical-order-modal');
    if (modal) {
        modal.remove();
    }
}

// ==================== ESTATUS DE ORDEN ====================
/**
 * Calcula el estatus de despacho comparando cantidad despachada vs cantidad original OC
 * @param {number} totalCajas - Cantidad original de cajas (de OBC)
 * @param {number} cantidadDespachar - Cantidad despachada
 * @returns {object} - { status: string, color: string }
 * - Igual → Completado (green)
 * - Despachada < Original → Parcial (orange)
 * - Despachada > Original → Anormalidad (red)
 */
function calculateOrderStatus(totalCajas, cantidadDespachar) {
    if (!totalCajas || totalCajas === 0) return { status: 'Sin Información', color: '#999' };

    if (cantidadDespachar < totalCajas) {
        return { status: 'Parcial', color: '#f59e0b' };
    } else if (cantidadDespachar === totalCajas) {
        return { status: 'Completado', color: '#10b981' };
    } else {
        return { status: 'Anormalidad', color: '#ef4444' };
    }
}

function showDateExceptionDialog(orden, source) {
    STATE.exceptionOrder = orden;
    const orderData = STATE.obcData.get(orden);

    if (!orderData) {
        showNotification('❌ Error al cargar datos de la orden', 'error');
        return;
    }

    // CORREGIDO: Usar expectedArrival que es la fecha correcta
    const orderDate = orderData.expectedArrival || 'N/A';
    const filterStart = STATE.dateFilter.startDate || 'N/A';
    const filterEnd = STATE.dateFilter.endDate || 'N/A';

    const bodyContent = `
        <div style="padding: 10px 0;">
            <div class="info-section" style="background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <div class="info-row" style="margin-bottom: 10px;">
                    <span style="font-weight: 600; color: var(--primary);">Orden encontrada:</span>
                    <span>${orden}</span>
                </div>
                <div class="info-row" style="margin-bottom: 10px;">
                    <span style="font-weight: 600; color: var(--primary);">Encontrado por:</span>
                    <span>${source}</span>
                </div>
                <div class="info-row" style="margin-bottom: 10px;">
                    <span style="font-weight: 600; color: var(--primary);">Destino:</span>
                    <span>${orderData.recipient || 'N/A'}</span>
                </div>
                <div class="info-row" style="margin-bottom: 10px;">
                    <span style="font-weight: 600; color: var(--primary);">Fecha de la orden:</span>
                    <span>${orderDate}</span>
                </div>
                <div class="info-row">
                    <span style="font-weight: 600; color: var(--primary);">Rango filtrado actual:</span>
                    <span>${filterStart} - ${filterEnd}</span>
                </div>
            </div>
            
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
            
            <p style="color: #666; font-size: 0.95em; margin: 0;">
                Esta orden puede procesarse como <strong>caso de excepción</strong>. 
                ¿Deseas continuar y abrir la orden para validar el despacho?
            </p>
        </div>
    `;

    document.getElementById('date-exception-body').innerHTML = bodyContent;
    document.getElementById('date-exception-modal').classList.add('show');
}

function closeDateExceptionModal() {
    document.getElementById('date-exception-modal').classList.remove('show');
    STATE.exceptionOrder = null;
}

function confirmDateException() {
    if (STATE.exceptionOrder) {
        const orden = STATE.exceptionOrder;
        closeDateExceptionModal();
        showOrderInfo(orden);
        showNotification('📦 Orden abierta como excepción', 'info');
    }
}

// ==================== ORDER INFO MODAL ====================
function showOrderInfo(orden) {
    let orderData = STATE.obcData.get(orden);

    // If not found in obcData, try to get from validated records
    if (!orderData) {
        const validatedRecord = STATE.localValidated.find(v => v.orden === orden);
        if (validatedRecord) {
            // Create a minimal orderData from validated record
            orderData = {
                orden: validatedRecord.orden,
                recipient: validatedRecord.destino,
                expectedArrival: validatedRecord.horario,
                totalCajas: validatedRecord.totalCajas || 0,
                referenceNo: validatedRecord.referenceNo || '',
                trackingCode: validatedRecord.trackingCode || ''
            };
        }
    }

    if (!orderData) {
        showNotification('❌ Orden no encontrada', 'error');
        return;
    }

    STATE.currentOrder = orden;

    // Check if order is validated and calculate status badge
    const validationCheck = isOrderValidated(orden);
    let statusBadgeHTML = '';

    if (validationCheck.validated && validationCheck.data) {
        const totalCajas = orderData.totalCajas || 0;
        const cantidadDespachar = validationCheck.data.cantidadDespachar || 0;
        const statusInfo = calculateOrderStatus(totalCajas, cantidadDespachar);

        console.log(`📊 Status Badge - Order ${orden}: totalCajas=${totalCajas}, cantidadDespachar=${cantidadDespachar}, status=${statusInfo.status}`);

        statusBadgeHTML = ` <span class="status-badge-modal" style="background-color: ${statusInfo.color}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 0.75em; font-weight: 600; margin-left: 10px;">${statusInfo.status}</span>`;
    }

    // Update modal title with status badge for validated orders
    document.getElementById('modal-title-text').innerHTML = `Orden ${orden}${statusBadgeHTML}`;

    // Update metadata fields (only show if order is validated)
    const metadataContainer = document.getElementById('modal-metadata');
    const lastModifiedEl = document.getElementById('modal-last-modified');
    const userEl = document.getElementById('modal-user');
    
    if (validationCheck.validated && validationCheck.data) {
        const savedData = validationCheck.data;
        
        // Mostrar metadata
        if (metadataContainer) {
            metadataContainer.style.display = 'flex';
        }
        
        // Formatear última modificación
        if (lastModifiedEl) {
            const lastModified = formatLastModified(savedData);
            lastModifiedEl.textContent = lastModified;
        }
        
        // Mostrar usuario ACTUAL (no el que guardó el registro originalmente)
        if (userEl) {
            // Usar CURRENT_USER actual, no el guardado en el registro
            const userName = CURRENT_USER || USER_GOOGLE_NAME || 'N/A';
            userEl.textContent = userName;
        }
    } else {
        // Ocultar metadata para órdenes no validadas
        if (metadataContainer) {
            metadataContainer.style.display = 'none';
        }
    }

    // Render KPI Cards
    renderKPICards(orderData);

    // Render Modal Body with sections
    renderModalBody(orden, orderData);

    // Populate modal footer with saved data if order is validated
    if (validationCheck.validated && validationCheck.data) {
        const savedData = validationCheck.data;

        // Use setTimeout to ensure DOM elements are ready and dropdowns are populated
        setTimeout(() => {
            // Populate operator/driver dropdown
            const operadorSelect = document.getElementById('modal-operador');
            if (operadorSelect && savedData.operador) {
                operadorSelect.value = savedData.operador;
                console.log(`✅ Operador populated: ${savedData.operador}`);
            }

            // Populate unit/vehicle dropdown
            const unidadSelect = document.getElementById('modal-unidad');
            if (unidadSelect && savedData.unidad) {
                unidadSelect.value = savedData.unidad;
                console.log(`✅ Unidad populated: ${savedData.unidad}`);
            }

            // FIXED: Populate cantidad despachar field from Columna N (cantDespacho)
            const cantidadDespacharInput = document.getElementById('cantidad-despachar');
            if (cantidadDespacharInput) {
                // Usar cantDespacho (Columna N) o cantidadDespachar como fallback
                const valorGuardado = savedData.cantDespacho || savedData.cantidadDespachar || '';
                cantidadDespacharInput.value = valorGuardado;
                console.log('📝 Poblando CANT. DESPACHO desde BD:', valorGuardado);
            }

            // Populate nota despacho field
            const notaDespachoInput = document.getElementById('nota-despacho');
            if (notaDespachoInput && (savedData.observaciones || savedData.notaDespacho)) {
                notaDespachoInput.value = savedData.observaciones || savedData.notaDespacho;
            }
        }, 100);

        // NEW: Populate Quality Control (QC) data if exists
        if (savedData.qc) {
            setTimeout(() => {
                // Enable QC toggle if there was QC data
                const qcToggle = document.getElementById('qc-toggle');
                if (qcToggle && !qcToggle.checked) {
                    qcToggle.checked = true;
                    toggleQualityControl(true);
                }

                // Restore QC tasks and statuses
                if (savedData.qc.tasks && savedData.qc.tasks.length > 0) {
                    savedData.qc.tasks.forEach(taskId => {
                        const checkbox = document.getElementById(`qc-${taskId}`);
                        if (checkbox) {
                            checkbox.checked = true;
                            const statusSelect = document.getElementById(`qc-status-${taskId}`);
                            if (statusSelect) {
                                statusSelect.disabled = false;
                                // Restore status if available
                                if (savedData.qc.statuses && savedData.qc.statuses[taskId]) {
                                    statusSelect.value = savedData.qc.statuses[taskId];
                                }
                            }
                        }
                    });
                }

                // Restore "otros" note if exists
                if (savedData.qc.otrosNote) {
                    const otrosNoteField = document.getElementById('qc-otros-note');
                    if (otrosNoteField) {
                        otrosNoteField.value = savedData.qc.otrosNote;
                        // Show the note container
                        const otrosContainer = document.getElementById('qc-otros-note-container');
                        if (otrosContainer) {
                            otrosContainer.style.display = 'block';
                        }
                    }
                }
            }, 150); // Small delay to ensure DOM elements are rendered
        }

        // Change button text to "Guardar cambios" for validated orders
        const confirmBtn = document.getElementById('confirm-dispatch-btn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '💾 Guardar';
            confirmBtn.onclick = function() { saveValidatedOrderChanges(orden); };
        }

        // Populate folio de carga si existe
        // NOTA: Mover esta lógica al setTimeout de operador/unidad para que el selector
        // se actualice DESPUÉS de que conductor y unidad estén poblados
        const folioSelect = document.getElementById('modal-folio-carga');
        const savedFolio = savedData.folio;

        // Usar setTimeout para asegurar que operador/unidad ya estén poblados (100ms)
        setTimeout(() => {
            if (folioSelect && savedFolio) {
                const folioCarga = savedFolio.split('-').pop();
                updateFolioSelector(); // Ahora conductor y unidad ya están establecidos
                folioSelect.value = folioCarga;
                // Actualizar el previousSelectedFolio para evitar alertas innecesarias
                previousSelectedFolio = folioCarga;
                console.log(`✅ Folio populated: ${folioCarga}`);
            }
        }, 150); // 150ms para asegurar que el setTimeout de 100ms de operador/unidad ya terminó

        // Set cancellation toggle state if order is cancelled
        setTimeout(() => {
            const cancelToggle = document.getElementById('orden-cancelada-toggle');
            const noProcesableToggle = document.getElementById('orden-noprocesable-toggle');

            if (cancelToggle && savedData.estatus === 'Cancelada') {
                cancelToggle.checked = true;
                // Trigger toggle function to disable fields
                toggleOrderCancellation();
            } else if (noProcesableToggle && savedData.estatus === 'No Procesable') {
                noProcesableToggle.checked = true;
                // Trigger toggle function to disable fields
                toggleOrderNoProcesable();
            }
        }, 200);
    } else {
        // Reset button for non-validated orders
        const confirmBtn = document.getElementById('confirm-dispatch-btn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '✅ Confirmar';
            confirmBtn.onclick = function() { confirmDispatch(); };
        }
    }

    // Setup event listeners for folio selector
    setupFolioSelectorListeners();

    // CHANGE 9: Initialize lock mode for validated orders
    if (validationCheck.validated && validationCheck.data) {
        initializeLockMode(true);
    } else {
        initializeLockMode(false);
    }

    // Show modal
    document.getElementById('info-modal').classList.add('show');
}

// CHANGE 9: Lock mode for validated orders
function initializeLockMode(isValidated) {
    const modal = document.getElementById('info-modal');
    if (!modal) return;

    // Get the modal footer INSIDE the info-modal specifically
    const modalFooter = modal.querySelector('.modal-footer');
    const unlockBtn = document.getElementById('unlock-btn');

    if (isValidated) {
        // Apply locked state
        modal.classList.add('locked-mode');

        // Show unlock button if it doesn't exist, or reset it if it does
        if (!unlockBtn && modalFooter) {
            const unlockButton = document.createElement('button');
            unlockButton.id = 'unlock-btn';
            unlockButton.className = 'btn btn-warning';
            unlockButton.innerHTML = '🔓 Desbloquear';
            unlockButton.onclick = toggleLockMode;

            // Insert before the confirm button (which is inside modal-buttons div)
            const confirmBtn = document.getElementById('confirm-dispatch-btn');
            if (confirmBtn && confirmBtn.parentNode) {
                confirmBtn.parentNode.insertBefore(unlockButton, confirmBtn);
            } else {
                // Fallback: append to modal footer
                modalFooter.appendChild(unlockButton);
            }
        } else if (unlockBtn) {
            // Reset button to locked state if it already exists
            unlockBtn.innerHTML = '🔓 Desbloquear';
            unlockBtn.className = 'btn btn-warning';
        }

        // Disable all inputs
        disableModalInputs(true);
    } else {
        // Remove locked state
        modal.classList.remove('locked-mode');

        // Remove unlock button if it exists
        if (unlockBtn) {
            unlockBtn.remove();
        }

        // Enable all inputs
        disableModalInputs(false);
    }
}

function toggleLockMode() {
    const modal = document.getElementById('info-modal');
    const unlockBtn = document.getElementById('unlock-btn');
    const isLocked = modal.classList.contains('locked-mode');

    if (isLocked) {
        // Unlock
        modal.classList.remove('locked-mode');
        disableModalInputs(false);

        if (unlockBtn) {
            unlockBtn.innerHTML = '🔒 Bloquear';
            unlockBtn.className = 'btn btn-secondary';
        }

        showNotification('🔓 Modo edición activado', 'info');
    } else {
        // Lock
        modal.classList.add('locked-mode');
        disableModalInputs(true);

        if (unlockBtn) {
            unlockBtn.innerHTML = '🔓 Desbloquear';
            unlockBtn.className = 'btn btn-warning';
        }

        showNotification('🔒 Orden bloqueada', 'info');
    }
}

function disableModalInputs(disable) {
    // Disable/enable all input fields in the modal
    const operadorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');
    const cantidadInput = document.getElementById('cantidad-despachar');
    const notaInput = document.getElementById('nota-despacho');
    const folioSelect = document.getElementById('modal-folio-carga');
    const confirmBtn = document.getElementById('confirm-dispatch-btn');

    if (operadorSelect) operadorSelect.disabled = disable;
    if (unidadSelect) unidadSelect.disabled = disable;
    if (cantidadInput) cantidadInput.disabled = disable;
    if (notaInput) notaInput.disabled = disable;
    if (folioSelect) folioSelect.disabled = disable;
    if (confirmBtn) confirmBtn.disabled = disable;
}

// Toggle order cancellation state
function toggleOrderCancellation() {
    const toggle = document.getElementById('orden-cancelada-toggle');
    const noProcesableToggle = document.getElementById('orden-noprocesable-toggle');
    const operadorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');
    const folioSelect = document.getElementById('modal-folio-carga');

    if (!toggle) return;

    const isCancelled = toggle.checked;

    // If this is being checked, uncheck No Procesable toggle (mutually exclusive)
    if (isCancelled && noProcesableToggle && noProcesableToggle.checked) {
        noProcesableToggle.checked = false;
    }

    // Disable/enable Conductor, Unidad, and Folio fields based on cancellation state
    if (operadorSelect) operadorSelect.disabled = isCancelled;
    if (unidadSelect) unidadSelect.disabled = isCancelled;
    if (folioSelect) folioSelect.disabled = isCancelled;

    // Add visual feedback
    const fieldsToStyle = [operadorSelect, unidadSelect, folioSelect];
    fieldsToStyle.forEach(field => {
        if (field) {
            if (isCancelled) {
                field.style.opacity = '0.5';
                field.style.background = '#f5f5f5';
            } else {
                field.style.opacity = '1';
                field.style.background = 'white';
            }
        }
    });

    // Show notification
    if (isCancelled) {
        showNotification('⚠️ Orden marcada como Cancelada - Campos bloqueados', 'warning');
    } else {
        showNotification('✅ Orden reactivada - Campos habilitados', 'info');
    }
}

function toggleOrderNoProcesable() {
    const toggle = document.getElementById('orden-noprocesable-toggle');
    const cancelToggle = document.getElementById('orden-cancelada-toggle');
    const operadorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');
    const folioSelect = document.getElementById('modal-folio-carga');

    if (!toggle) return;

    const isNoProcesable = toggle.checked;

    // If this is being checked, uncheck Cancelada toggle (mutually exclusive)
    if (isNoProcesable && cancelToggle && cancelToggle.checked) {
        cancelToggle.checked = false;
    }

    // Disable/enable Conductor, Unidad, and Folio fields based on No Procesable state
    if (operadorSelect) operadorSelect.disabled = isNoProcesable;
    if (unidadSelect) unidadSelect.disabled = isNoProcesable;
    if (folioSelect) folioSelect.disabled = isNoProcesable;

    // Add visual feedback with yellow theme
    const fieldsToStyle = [operadorSelect, unidadSelect, folioSelect];
    fieldsToStyle.forEach(field => {
        if (field) {
            if (isNoProcesable) {
                field.style.opacity = '0.5';
                field.style.background = '#fef9c3';
            } else {
                field.style.opacity = '1';
                field.style.background = 'white';
            }
        }
    });

    // Show notification
    if (isNoProcesable) {
        showNotification('⚠️ Orden marcada como No Procesable - Campos bloqueados', 'warning');
    } else {
        showNotification('✅ Orden reactivada - Campos habilitados', 'info');
    }
}

function renderKPICards(orderData) {
    const kpiCards = document.getElementById('kpi-cards');
    const validaciones = STATE.validacionData.get(orderData.orden) || [];
    // FIXED: Count unique validated boxes instead of total records
    const cajasValidadas = getCajasValidadasUnicas(orderData.orden);
    const rastreoData = STATE.mneData.get(orderData.orden) || [];
    // FIXED: Use totalCajas from OBC database
    const totalCajas = orderData.totalCajas || 0;

    // Búsqueda cruzada TRS usando códigos de cajas
    const boxCodes = new Set();
    validaciones.forEach(v => {
        if (v.codigo) boxCodes.add(v.codigo.trim());
    });
    rastreoData.forEach(r => {
        if (r.codigo) boxCodes.add(r.codigo.trim());
    });

    let trsCount = 0;
    STATE.trsData.forEach(t => {
        for (const code of boxCodes) {
            if ((t.codigoOriginal && t.codigoOriginal.includes(code)) ||
                (t.codigoNuevo && t.codigoNuevo.includes(code))) {
                trsCount++;
                break;
            }
        }
    });

    kpiCards.innerHTML = `
        <div class="kpi-card orden" onclick="scrollToSection('section-detalle-obc')">
            <div class="kpi-card-icon">📦</div>
            <div class="kpi-card-content">
                <div class="kpi-card-label">Orden</div>
                <div class="kpi-card-value">${makeCopyable(orderData.orden)}</div>
            </div>
        </div>
        <div class="kpi-card destino" onclick="scrollToSection('section-general')">
            <div class="kpi-card-icon">🏢</div>
            <div class="kpi-card-content">
                <div class="kpi-card-label">Destino</div>
                <div class="kpi-card-value">${orderData.recipient || 'N/A'}</div>
            </div>
        </div>
        <div class="kpi-card estatus" onclick="scrollToSection('section-validaciones')">
            <div class="kpi-card-icon">✅</div>
            <div class="kpi-card-content">
                <div class="kpi-card-label">Validación</div>
                <div class="kpi-card-value">${cajasValidadas}/${totalCajas} cajas</div>
                ${totalCajas > 0 ? `
                    <div class="kpi-progress">
                        <div class="kpi-progress-bar" style="width: ${(cajasValidadas/totalCajas*100).toFixed(0)}%"></div>
                    </div>
                ` : ''}
            </div>
        </div>
        <div class="kpi-card trs" onclick="scrollToSection('section-trs')">
            <div class="kpi-card-icon">🔄</div>
            <div class="kpi-card-content">
                <div class="kpi-card-label">TRS</div>
                <div class="kpi-card-value">${trsCount} relacionados</div>
            </div>
        </div>
        <div class="kpi-card cajas" onclick="scrollToSection('section-rastreo')">
            <div class="kpi-card-icon">📍</div>
            <div class="kpi-card-content">
                <div class="kpi-card-label">Rastreo</div>
                <div class="kpi-card-value">${rastreoData.length} cajas</div>
            </div>
        </div>
    `;
}

function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        // Expand if collapsed
        const content = section.querySelector('.section-content');
        const toggle = section.querySelector('.section-toggle');
        if (content && content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            if (toggle) toggle.classList.remove('collapsed');
        }

        // Scroll to section
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function renderModalBody(orden, orderData) {
    const modalBody = document.getElementById('modal-body');
    const validaciones = STATE.validacionData.get(orden) || [];
    const rastreoData = STATE.mneData.get(orden) || [];

    // Búsqueda cruzada TRS usando códigos de cajas (no OBC directo)
    const boxCodes = new Set();
    validaciones.forEach(v => {
        if (v.codigo) boxCodes.add(v.codigo.trim());
    });
    rastreoData.forEach(r => {
        if (r.codigo) boxCodes.add(r.codigo.trim());
    });

    // Buscar TRS que coincidan con códigos de cajas
    const trsRelacionados = [];
    STATE.trsData.forEach(t => {
        let matchParam = null;

        // Buscar coincidencia en codigoOriginal o codigoNuevo
        for (const code of boxCodes) {
            if (t.codigoOriginal && t.codigoOriginal.includes(code)) {
                matchParam = code;
                break;
            }
            if (t.codigoNuevo && t.codigoNuevo.includes(code)) {
                matchParam = code;
                break;
            }
        }

        if (matchParam) {
            trsRelacionados.push({
                ...t,
                matchParam: matchParam
            });
        }
    });

    // Detectar si hay TRS para auto-activar Control de Calidad
    const hasTRS = trsRelacionados.length > 0;

    let html = '';

    // Información General con campos editables
    html += `
        <div class="section-card" id="section-general">
            <div class="section-header">
                <div class="section-header-left">
                    <div class="section-title">📋 Información General</div>
                    <div class="qc-toggle-container" style="display: inline-flex; align-items: center; gap: 8px; margin-left: 15px; padding: 6px 12px; background: #fff5ed; border: 1px solid #fed7aa; border-radius: 6px;">
                        <span class="qc-toggle-label" style="font-size: 0.85em; color: #ea580c;">🚫 Cancelada</span>
                        <label class="qc-toggle-switch" style="margin: 0;">
                            <input type="checkbox" id="orden-cancelada-toggle" onchange="toggleOrderCancellation()">
                            <span class="qc-toggle-slider"></span>
                        </label>
                    </div>
                    <div class="qc-toggle-container" style="display: inline-flex; align-items: center; gap: 8px; margin-left: 10px; padding: 6px 12px; background: #fef9c3; border: 1px solid #fde047; border-radius: 6px;">
                        <span class="qc-toggle-label" style="font-size: 0.85em; color: #a16207;">⚠️ No Procesable</span>
                        <label class="qc-toggle-switch" style="margin: 0;">
                            <input type="checkbox" id="orden-noprocesable-toggle" onchange="toggleOrderNoProcesable()">
                            <span class="qc-toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
            <div class="section-content">
                <div class="general-info-grid">
                    <!-- Fila 1: 5 Columnas -->
                    <div class="general-info-field">
                        <div class="general-info-label">ORDEN</div>
                        <div class="general-info-value">${makeCopyable(orderData.orden)}</div>
                    </div>
                    <div class="general-info-field">
                        <div class="general-info-label">DESTINO</div>
                        <div class="general-info-value">${orderData.recipient || 'N/A'}</div>
                    </div>
                    <div class="general-info-field">
                        <div class="general-info-label">FECHA Y HORA</div>
                        <div class="general-info-value">${orderData.expectedArrival || 'N/A'}</div>
                    </div>
                    <div class="general-info-field">
                        <div class="general-info-label">REFERENCIA</div>
                        <div class="general-info-value">${makeCopyable(orderData.referenceNo || 'N/A')}</div>
                    </div>
                    <div class="general-info-field">
                        <div class="general-info-label">CÓDIGO TRACK</div>
                        <div class="general-info-value">${makeCopyable(orderData.trackingCode || 'N/A')}</div>
                    </div>

                    <!-- Fila 2: Distribución Mixta (1fr 1fr 2fr) -->
                    <div class="row-2">
                        <div class="general-info-field">
                            <div class="general-info-label">CANT. CAJAS</div>
                            <div class="general-info-value"><span class="highlight-orange">${orderData.totalCajas || rastreoData.length || validaciones.length || 'N/A'}</span></div>
                        </div>
                        <div class="general-info-field editable">
                            <div class="general-info-label">CANT. DESPACHO</div>
                            <input type="number" class="general-info-input" id="cantidad-despachar" placeholder="Ingresar cantidad validada..." min="0" value="">
                        </div>
                        <div class="general-info-field editable">
                            <div class="general-info-label">NOTA</div>
                            <textarea class="general-info-textarea" id="nota-despacho" placeholder="Observaciones del despacho..." rows="1"></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Validaciones
    if (validaciones.length > 0) {
        html += `
            <div class="section-card" id="section-validaciones">
                <div class="section-header" onclick="toggleSection('section-validaciones-content')">
                    <div class="section-header-left">
                        <div class="section-title">✅ Surtido (${validaciones.length})</div>
                    </div>
                    <span class="section-toggle collapsed" id="section-validaciones-content-toggle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
                <div class="section-content collapsed" id="section-validaciones-content">
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Hora</th>
                                    <th>Usuario</th>
                                    <th>Código</th>
                                    <th>Ubicación</th>
                                    <th>Nota</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${validaciones.map(v => `
                                    <tr>
                                        <td>${v.fecha}</td>
                                        <td>${v.hora}</td>
                                        <td>${v.usuario}</td>
                                        <td><code>${makeCopyable(v.codigo)}</code></td>
                                        <td>${v.ubicacion || '-'}</td>
                                        <td>${v.nota || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // Rastreo
    if (rastreoData.length > 0) {
        html += `
            <div class="section-card" id="section-rastreo">
                <div class="section-header" onclick="toggleSection('section-rastreo-content')">
                    <div class="section-header-left">
                        <div class="section-title">📍 Rastreo de Cajas (${rastreoData.length})</div>
                    </div>
                    <span class="section-toggle collapsed" id="section-rastreo-content-toggle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
                <div class="section-content collapsed" id="section-rastreo-content">
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>IB</th>
                                    <th>Código</th>
                                    <th>Responsable</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rastreoData.map(r => `
                                    <tr>
                                        <td>${r.fecha}</td>
                                        <td>${makeCopyable(r.ib)}</td>
                                        <td><code>${makeCopyable(r.codigo)}</code></td>
                                        <td>${r.responsable || '-'}</td>
                                        <td>${r.estado}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // TRS Relacionados
    if (trsRelacionados.length > 0) {
        html += `
            <div class="section-card" id="section-trs">
                <div class="section-header" onclick="toggleSection('section-trs-content')">
                    <div class="section-header-left">
                        <div class="section-title">🔄 TRS Relacionados (${trsRelacionados.length})</div>
                    </div>
                    <span class="section-toggle" id="section-trs-content-toggle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
                <div class="section-content" id="section-trs-content">
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Código Match</th>
                                    <th>TRS</th>
                                    <th>Referencia</th>
                                    <th>Código Original</th>
                                    <th>Código Nuevo</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${trsRelacionados.map(t => `
                                    <tr>
                                        <td><code class="highlight">${makeCopyable(t.matchParam)}</code></td>
                                        <td><code>${makeCopyable(t.trs)}</code></td>
                                        <td>${t.referencia}</td>
                                        <td><code>${makeCopyable(t.codigoOriginal || '-')}</code></td>
                                        <td><code>${makeCopyable(t.codigoNuevo || '-')}</code></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // Control de Calidad (con toggle manual o auto-activado si hay TRS)
    html += `
        <div class="section-card" id="section-qc">
            <div class="qc-toggle-container">
                <label class="qc-toggle-label">¿Tiene Orden de Trabajo?</label>
                <label class="qc-toggle-switch">
                    <input type="checkbox" id="qc-toggle" ${hasTRS ? 'checked' : ''} onchange="toggleQualityControl(this.checked)">
                    <span class="qc-toggle-slider"></span>
                </label>
            </div>
            <div id="qc-content" style="display: ${hasTRS ? 'block' : 'none'};">
                <div class="section-header" onclick="toggleSection('section-qc-body')">
                    <div class="section-header-left">
                        <div class="section-title">🔧 Control de Calidad</div>
                        <span class="section-badge" id="qc-status-badge">Activo - Orden de Trabajo</span>
                    </div>
                    <span class="section-toggle" id="section-qc-body-toggle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
                <div class="section-content" id="section-qc-body">
                    <div class="qc-tasks-grid">
                        <!-- Tarea: Cambio Etiqueta -->
                        <div class="qc-task-row">
                            <div class="qc-task-checkbox-wrapper">
                                <input type="checkbox" class="qc-checkbox" id="qc-cambio-etiqueta" onchange="toggleQCTaskStatus('cambio-etiqueta', this.checked)">
                                <label for="qc-cambio-etiqueta" class="qc-task-name">Cambio Etiqueta Exterior</label>
                            </div>
                            <select class="qc-status-select" id="qc-status-cambio-etiqueta" disabled>
                                <option value="">Seleccionar estatus...</option>
                                <option value="pendiente">○ Pendiente</option>
                                <option value="parcial">◑ Parcial</option>
                                <option value="completado">✓ Completado</option>
                            </select>
                        </div>

                        <!-- Tarea: Cambio SKU -->
                        <div class="qc-task-row">
                            <div class="qc-task-checkbox-wrapper">
                                <input type="checkbox" class="qc-checkbox" id="qc-cambio-sku" onchange="toggleQCTaskStatus('cambio-sku', this.checked)">
                                <label for="qc-cambio-sku" class="qc-task-name">Cambio SKU</label>
                            </div>
                            <select class="qc-status-select" id="qc-status-cambio-sku" disabled>
                                <option value="">Seleccionar estatus...</option>
                                <option value="pendiente">○ Pendiente</option>
                                <option value="parcial">◑ Parcial</option>
                                <option value="completado">✓ Completado</option>
                            </select>
                        </div>

                        <!-- Tarea: Reparación -->
                        <div class="qc-task-row">
                            <div class="qc-task-checkbox-wrapper">
                                <input type="checkbox" class="qc-checkbox" id="qc-reparacion" onchange="toggleQCTaskStatus('reparacion', this.checked)">
                                <label for="qc-reparacion" class="qc-task-name">Reparación</label>
                            </div>
                            <select class="qc-status-select" id="qc-status-reparacion" disabled>
                                <option value="">Seleccionar estatus...</option>
                                <option value="pendiente">○ Pendiente</option>
                                <option value="parcial">◑ Parcial</option>
                                <option value="completado">✓ Completado</option>
                            </select>
                        </div>

                        <!-- Tarea: Cambio de Caja -->
                        <div class="qc-task-row">
                            <div class="qc-task-checkbox-wrapper">
                                <input type="checkbox" class="qc-checkbox" id="qc-cambio-caja" onchange="toggleQCTaskStatus('cambio-caja', this.checked)">
                                <label for="qc-cambio-caja" class="qc-task-name">Cambio de Caja</label>
                            </div>
                            <select class="qc-status-select" id="qc-status-cambio-caja" disabled>
                                <option value="">Seleccionar estatus...</option>
                                <option value="pendiente">○ Pendiente</option>
                                <option value="parcial">◑ Parcial</option>
                                <option value="completado">✓ Completado</option>
                            </select>
                        </div>

                        <!-- Tarea: Otros -->
                        <div class="qc-task-row">
                            <div class="qc-task-checkbox-wrapper">
                                <input type="checkbox" class="qc-checkbox" id="qc-otros" onchange="toggleQCTaskStatus('otros', this.checked)">
                                <label for="qc-otros" class="qc-task-name">Otros</label>
                            </div>
                            <select class="qc-status-select" id="qc-status-otros" disabled>
                                <option value="">Seleccionar estatus...</option>
                                <option value="pendiente">○ Pendiente</option>
                                <option value="parcial">◑ Parcial</option>
                                <option value="completado">✓ Completado</option>
                            </select>
                        </div>

                        <!-- Campo de nota para "Otros" -->
                        <div id="qc-otros-note-container" style="display: none; grid-column: 1 / -1; margin-top: 10px;">
                            <label style="display: block; font-size: 0.9em; color: var(--primary); margin-bottom: 6px; font-weight: 600;">
                                Especifica la tarea:
                            </label>
                            <textarea
                                id="qc-otros-note"
                                class="general-info-textarea"
                                placeholder="Describe la tarea específica a realizar..."
                                rows="2"
                                style="width: 100%;"
                            ></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ===== SECCIÓN DE DETALLE COMPLETO OBC (similar a Track App) =====
    // Obtener todas las cajas de esta OBC desde bdCajasData
    const allBoxes = [];
    for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
        cajas.forEach(caja => {
            if (caja.obc === orden) {
                allBoxes.push({ codigo, ...caja });
            }
        });
    }

    if (allBoxes.length > 0) {
        html += `
            <div class="section-card" id="section-detalle-obc">
                <div class="section-header" onclick="toggleSection('section-detalle-obc-content')">
                    <div class="section-header-left">
                        <div class="section-title">📦 Orden Detallada <span class="section-badge">${allBoxes.length} cajas</span></div>
                    </div>
                    <span class="section-toggle collapsed" id="section-detalle-obc-content-toggle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
                <div class="section-content collapsed" id="section-detalle-obc-content">
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Código de Caja</th>
                                    <th>Tipo de Caja</th>
                                    <th>Referencia</th>
                                    <th>Tracking</th>
                                    <th>Destino</th>
                                    <th>Fecha Arribo</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${allBoxes.map(box => `
                                    <tr>
                                        <td><code>${makeCopyable(box.codigo)}</code></td>
                                        <td>${box.boxType || '-'}</td>
                                        <td>${makeCopyable(box.referenceNo || '-')}</td>
                                        <td>${makeCopyable(box.trackingCode || '-')}</td>
                                        <td>${box.recipient || '-'}</td>
                                        <td>${box.expectedArrival || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    modalBody.innerHTML = html;

    // Auto-seleccionar y pre-poblar si hay TRS
    if (hasTRS) {
        setTimeout(() => initializeQCFromTRS(trsRelacionados), 100);
    }
}

function toggleSection(sectionId) {
    const content = document.getElementById(sectionId);
    const toggle = document.getElementById(sectionId + '-toggle');

    if (content && toggle) {
        content.classList.toggle('collapsed');
        toggle.classList.toggle('collapsed');
    }
}

function closeInfoModal() {
    document.getElementById('info-modal').classList.remove('show');
    STATE.currentOrder = null;
}

// ==================== DISPATCH CONFIRMATION ====================
/**
 * Save changes to a validated order
 * Allows editing validated orders after confirmation
 */
async function saveValidatedOrderChanges(orden) {
    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const folioCarga = document.getElementById('modal-folio-carga')?.value || '';
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';
    const cancelToggle = document.getElementById('orden-cancelada-toggle');
    const isCancelled = cancelToggle && cancelToggle.checked;

    // If order is being cancelled, show cancel confirmation modal
    if (isCancelled) {
        // Update the current order being edited
        const recordIndex = STATE.localValidated.findIndex(r => r.orden === orden);
        if (recordIndex !== -1) {
            // Update the status to cancelled
            STATE.localValidated[recordIndex].estatus = 'Cancelada';
            STATE.localValidated[recordIndex].cantidadDespachar = 0;
            STATE.localValidated[recordIndex].cantDespacho = 0;  // FIXED: Also update cantDespacho (Columna N)
            STATE.localValidated[recordIndex].conductor = '';
            STATE.localValidated[recordIndex].unidad = '';
            STATE.localValidated[recordIndex].folio = '';
            STATE.localValidated[recordIndex].nota = 'Orden cancelada';

            // Save state
            saveLocalState();

            // Close modal and refresh tables
            closeInfoModal();
            renderValidatedTable();
            updateTabBadges();

            showNotification('🚫 Orden actualizada como Cancelada', 'info');
        }
        return;
    }

    // Validación de campos requeridos (solo para órdenes NO canceladas)
    if (!operador || !unidad) {
        showNotification('⚠️ Debes seleccionar conductor y unidad', 'warning');
        return;
    }

    if (!folioCarga) {
        showNotification('⚠️ Debes seleccionar un Folio de Carga', 'warning');
        return;
    }

    if (!cantidadDespachar || cantidadDespachar <= 0) {
        showNotification('⚠️ Debes ingresar la cantidad a despachar', 'warning');
        return;
    }

    // Find the validated record
    const recordIndex = STATE.localValidated.findIndex(r => r.orden === orden);
    if (recordIndex === -1) {
        showNotification('❌ No se encontró el registro validado', 'error');
        return;
    }

    const orderData = STATE.obcData.get(orden);
    if (!orderData) {
        showNotification('❌ Error al obtener datos de la orden', 'error');
        return;
    }

    // Validación de discrepancia en cantidad
    const totalCajas = orderData.totalCajas || 0;
    const cantidadDespacharNum = parseInt(cantidadDespachar);

    if (totalCajas > 0 && cantidadDespacharNum !== totalCajas) {
        if (!notaDespacho) {
            const mensaje = cantidadDespacharNum < totalCajas
                ? `⚠️ DESPACHO PARCIAL DETECTADO\n\nCajas totales: ${totalCajas}\nCantidad a despachar: ${cantidadDespacharNum}\n\nDebe ingresar una NOTA explicando el motivo del despacho parcial.`
                : `⚠️ DISCREPANCIA DETECTADA\n\nCajas totales: ${totalCajas}\nCantidad a despachar: ${cantidadDespacharNum}\n\nDebe ingresar una NOTA explicando esta diferencia.`;

            alert(mensaje);
            document.getElementById('nota-despacho').focus();
            return;
        }
    }

    const oldRecord = STATE.localValidated[recordIndex];

    // Extract old folio de carga from the full folio (last 2 digits)
    const oldFolioCarga = oldRecord.folio.split('-').pop();

    // Check what changed
    const conductorChanged = oldRecord.operador !== operador;
    const unidadChanged = oldRecord.unidad !== unidad;
    const folioChanged = oldFolioCarga !== folioCarga;

    let newFolio = oldRecord.folio;

    // If anything changed, we need to handle the folio logic
    if (conductorChanged || unidadChanged || folioChanged) {
        // Check if the new folio can be used with the new conductor/unidad combination
        if (!canUseFolio(operador, unidad, folioCarga)) {
            showNotification(`⚠️ El folio de carga ${folioCarga} no está disponible para ${operador}/${unidad}. Está siendo usado por otra combinación. Por favor selecciona otro folio.`, 'warning');
            return;
        }

        // Release the old folio from the old combination
        releaseFolio(oldFolioCarga);

        // Mark the new folio as used for the new combination
        markFolioAsUsed(operador, unidad, folioCarga);

        // Generate the complete folio with current date
        newFolio = generateFolio(folioCarga);
    }

    // Collect QC data if QC toggle is enabled
    let qcData = null;
    const qcToggle = document.getElementById('qc-toggle');
    if (qcToggle && qcToggle.checked) {
        const qcTasks = [];
        const qcStatuses = {};

        ['cambio-etiqueta', 'cambio-sku', 'reparacion', 'cambio-caja', 'otros'].forEach(taskId => {
            const checkbox = document.getElementById(`qc-${taskId}`);
            const statusSelect = document.getElementById(`qc-status-${taskId}`);

            if (checkbox && checkbox.checked) {
                qcTasks.push(taskId);
                if (statusSelect && statusSelect.value) {
                    qcStatuses[taskId] = statusSelect.value;
                }
            }
        });

        const otrosNote = document.getElementById('qc-otros-note')?.value || '';

        qcData = {
            tasks: qcTasks,
            statuses: qcStatuses,
            otrosNote: otrosNote
        };
    }

    // Obtener timestamp y usuario actual para la modificación
    const now = new Date();
    const { fecha, hora } = formatDateTimeForDB(now);
    
    // Update the record
    const updatedRecord = {
        ...oldRecord,
        operador: operador,
        conductor: operador, // Also update conductor field for consistency
        unidad: unidad,
        cantDespacho: cantidadDespacharNum,  // N: Cant Despacho (manual input)
        cantidadDespachar: cantidadDespacharNum,  // Keep for UI compatibility
        notaDespacho: notaDespacho,
        observaciones: notaDespacho, // Also save as observaciones
        folio: newFolio,
        qc: qcData, // Save QC data
        lastModified: now.toISOString(),
        // NUEVO: Registrar fecha, hora y usuario de la modificación
        fecha: fecha,
        hora: hora,
        fechaModificacion: fecha,
        horaModificacion: hora,
        usuario: CURRENT_USER || USER_GOOGLE_NAME || 'Usuario',
        usuarioModificacion: CURRENT_USER || USER_GOOGLE_NAME || 'Usuario',
        timestamp: now.toISOString()
    };

    STATE.localValidated[recordIndex] = updatedRecord;

    // Save to localStorage
    try {
        localStorage.setItem('localValidated', JSON.stringify(STATE.localValidated));
        showNotification('✅ Cambios guardados exitosamente', 'success');

        // Trigger sync if available
        if (window.syncManager) {
            await syncPendingData();
        }

        // Update ALL tables to ensure synchronization
        renderValidatedTable();
        renderOtrosTable(); // Also update Otros table
        renderOrdersList(); // Update pending orders

        // If we're viewing folio details, also update that view
        if (STATE.currentFolio) {
            renderFolioDetailsTable(STATE.currentFolio);
        }
        
        // Update all badges
        updateTabBadges();
        updateValidatedBadges();

        // Close modal
        closeInfoModal();
    } catch (error) {
        console.error('Error saving changes:', error);
        showNotification('❌ Error al guardar cambios: ' + error.message, 'error');
    }
}

async function confirmDispatch() {
    // Validate edit operation (check online status)
    const validation = validateEditOperation(STATE.currentOrder, 'dispatch');
    if (!validation.allowed) {
        if (validation.reason === 'offline') {
            showNotification('❌ Sin conexión - No se pueden realizar cambios', 'error');
            return;
        }
    }
    
    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const folioCarga = document.getElementById('modal-folio-carga')?.value || '';
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';
    const cancelToggle = document.getElementById('orden-cancelada-toggle');
    const noProcesableToggle = document.getElementById('orden-noprocesable-toggle');
    const isCancelled = cancelToggle && cancelToggle.checked;
    const isNoProcesable = noProcesableToggle && noProcesableToggle.checked;

    if (!STATE.currentOrder) {
        showNotification('❌ No hay orden seleccionada', 'error');
        return;
    }

    // If order is marked as cancelled, show cancellation confirmation modal
    if (isCancelled) {
        showCancelOrderModal();
        return;
    }

    // If order is marked as No Procesable, show No Procesable confirmation modal
    if (isNoProcesable) {
        showNoProcesableModal();
        return;
    }

    // Validación de campos requeridos (solo para órdenes NO canceladas)
    if (!operador || !unidad) {
        showNotification('⚠️ Debes seleccionar conductor y unidad', 'warning');
        return;
    }

    if (!folioCarga) {
        showNotification('⚠️ Debes seleccionar un Folio de Carga', 'warning');
        return;
    }

    // SSOT: Validar folio contra BD de escritura antes de continuar
    if (typeof validateFolioBeforeDispatch === 'function') {
        console.log('🔍 [SSOT] Validando folio antes de despacho...');
        const folioValidation = await validateFolioBeforeDispatch(folioCarga, operador, unidad);
        
        if (!folioValidation.valid) {
            const message = `❌ FOLIO NO DISPONIBLE\n\n${folioValidation.message}\n\n` +
                (folioValidation.existingOrders && folioValidation.existingOrders.length > 0
                    ? `Órdenes existentes:\n${folioValidation.existingOrders.map(o => `- ${o.orden}`).join('\n')}`
                    : '');
            
            alert(message);
            showNotification('❌ El folio seleccionado no está disponible', 'error');
            return;
        }
        
        console.log('✅ [SSOT] Folio validado:', folioValidation.message);
    }

    if (!cantidadDespachar || cantidadDespachar <= 0) {
        showNotification('⚠️ Debes ingresar la cantidad a despachar', 'warning');
        return;
    }

    // Verificar si ya fue validada (duplicados)
    const validationCheck = isOrderValidated(STATE.currentOrder);
    if (validationCheck.validated) {
        const source = validationCheck.source === 'local' ? 'localmente' : 'en la base de datos';
        showNotification(`⚠️ Esta orden ya fue procesada ${source}`, 'warning');
        return;
    }

    const orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) {
        showNotification('❌ Error al obtener datos de la orden', 'error');
        return;
    }

    // Validación de discrepancia en cantidad - usar totalCajas de OBC database
    const totalCajas = orderData.totalCajas || 0;
    const cantidadDespacharNum = parseInt(cantidadDespachar);

    if (totalCajas > 0 && cantidadDespacharNum !== totalCajas) {
        if (!notaDespacho) {
            const mensaje = cantidadDespacharNum < totalCajas
                ? `⚠️ DESPACHO PARCIAL DETECTADO\n\nCajas totales: ${totalCajas}\nCantidad a despachar: ${cantidadDespacharNum}\n\nDebe ingresar una NOTA explicando el motivo del despacho parcial.`
                : `⚠️ DISCREPANCIA DETECTADA\n\nCajas totales: ${totalCajas}\nCantidad a despachar: ${cantidadDespacharNum}\n\nDebe ingresar una NOTA explicando esta diferencia.`;

            alert(mensaje);
            document.getElementById('nota-despacho').focus();
            return;
        }
    }

    // NEW: Validación de destino por folio
    // Check if there are other orders in the same folio with different destinations
    const currentDestino = orderData.recipient || '';
    const folioCompleto = generateFolio(folioCarga);
    const ordenesEnFolio = STATE.localValidated.filter(record => record.folio === folioCompleto);

    if (ordenesEnFolio.length > 0 && currentDestino) {
        // Get unique destinations from orders already in this folio
        const destinosEnFolio = [...new Set(ordenesEnFolio.map(r => {
            const dest = r.destino || '';
            return dest;
        }).filter(d => d))];

        // Check if current destination is different from existing ones
        const hayConflictoDestino = destinosEnFolio.length > 0 && !destinosEnFolio.includes(currentDestino);

        if (hayConflictoDestino) {
            const destinosTexto = destinosEnFolio.join(', ');
            const confirmar = confirm(
                `⚠️ ALERTA DE DESTINO DIFERENTE\n\n` +
                `El folio ${folioCompleto} ya contiene órdenes con destino:\n${destinosTexto}\n\n` +
                `La orden actual (${STATE.currentOrder}) va a destino:\n${currentDestino}\n\n` +
                `No se recomienda cargar mercancía de diferentes destinos en el mismo folio.\n\n` +
                `¿Está seguro que desea continuar?`
            );

            if (!confirmar) {
                showNotification('❌ Despacho cancelado - Verifique el folio de carga', 'warning');
                return;
            }
        }
    }

    // Mostrar modal de confirmación
    showConfirmDispatchModal();
}

function showConfirmDispatchModal() {
    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const folioCarga = document.getElementById('modal-folio-carga')?.value || '';
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';

    const orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) return;

    // Obtener estatus de calidad
    const qcToggle = document.getElementById('qc-toggle');
    let estatusCalidad = 'N/A';
    if (qcToggle && qcToggle.checked && selectedQCTasks.size > 0) {
        const statuses = Object.values(qcTaskStatuses);
        if (statuses.every(s => s === 'completado')) {
            estatusCalidad = '✅ Completado';
        } else if (statuses.some(s => s === 'parcial')) {
            estatusCalidad = '◑ Parcial';
        } else {
            estatusCalidad = '○ Pendiente';
        }
    }

    // Llenar modal de confirmación
    document.getElementById('confirm-orden').textContent = STATE.currentOrder;
    document.getElementById('confirm-destino').textContent = orderData.recipient || 'N/A';
    document.getElementById('confirm-horario').textContent = formatISO8601ForDisplay(orderData.expectedArrival) || 'N/A';
    document.getElementById('confirm-cantidad').textContent = cantidadDespachar + ' cajas';
    document.getElementById('confirm-calidad').textContent = estatusCalidad;
    document.getElementById('confirm-conductor').textContent = operador;
    document.getElementById('confirm-unidad').textContent = unidad;
    document.getElementById('confirm-folio').textContent = folioCarga;

    // Mostrar nota si existe
    const notaRow = document.getElementById('confirm-nota-row');
    if (notaDespacho) {
        document.getElementById('confirm-nota').textContent = notaDespacho;
        notaRow.style.display = 'flex';
    } else {
        notaRow.style.display = 'none';
    }

    // Mostrar modal
    document.getElementById('confirm-dispatch-modal').classList.add('show');
}

function closeConfirmDispatch() {
    document.getElementById('confirm-dispatch-modal').classList.remove('show');
}

async function executeConfirmDispatch() {
    // Validate edit operation (check online status)
    const editValidation = validateEditOperation(STATE.currentOrder, 'dispatch');
    if (!editValidation.allowed) {
        if (editValidation.reason === 'offline') {
            showNotification('❌ Sin conexión - No se pueden realizar cambios', 'error');
            closeConfirmDispatch();
            return;
        }
    }

    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const folioCarga = document.getElementById('modal-folio-carga')?.value || '';
    const cantidadDespachar = parseInt(document.getElementById('cantidad-despachar')?.value) || 0;  // FIXED: Use correct ID 'cantidad-despachar' instead of 'modal-cantidad-despachar'
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';

    // Cerrar modal de confirmación
    closeConfirmDispatch();

    const orderData = STATE.obcData.get(STATE.currentOrder);
    // Usar totalCajas de OBC database (fuente correcta)
    const totalCajas = orderData.totalCajas || 0;
    const cantidadDespacharNum = parseInt(cantidadDespachar);

    // Recopilar datos de QC si están activos
    const qcToggle = document.getElementById('qc-toggle');
    const qcData = {};
    if (qcToggle && qcToggle.checked) {
        qcData.tasks = Array.from(selectedQCTasks);
        qcData.statuses = {...qcTaskStatuses};
        if (selectedQCTasks.has('otros')) {
            const otrosNote = document.getElementById('qc-otros-note');
            qcData.otrosNote = otrosNote ? otrosNote.value.trim() : '';
        }
    }

    const timestamp = new Date();
    const { fecha, hora } = formatDateTimeForDB(timestamp);

    // ==================== PROTECCIÓN DE FILTRO DE FECHA ====================
    // IMPORTANTE: Preservar filtro de fecha activo incluso si la caja es de otra fecha
    // El folio SIEMPRE debe generarse con la fecha del filtro activo, NO con la fecha de la caja
    const currentFilterDate = STATE.dateFilter.active ? STATE.dateFilter.startDate : null;
    console.log(`🔒 [VALIDACIÓN] Filtro de fecha protegido: ${currentFilterDate}`);
    console.log(`📦 [VALIDACIÓN] Orden ${STATE.currentOrder} - Fecha caja: ${orderData.expectedArrival || 'N/A'}`);

    if (currentFilterDate) {
        console.log(`✅ [VALIDACIÓN] El folio se generará con fecha del filtro: ${currentFilterDate}`);
    } else {
        console.log(`⚠️ [VALIDACIÓN] No hay filtro activo - usando fecha actual para folio`);
    }

    // Marcar el folio de carga como utilizado
    markFolioAsUsed(operador, unidad, folioCarga);

    // Generar folio con el folio de carga seleccionado
    // NOTA: generateFolio() usa getCurrentDateKey() que respeta el filtro activo
    const folio = generateFolio(folioCarga);

    // Verificar que el folio generado corresponde al filtro activo
    if (currentFilterDate) {
        const expectedDateStr = currentFilterDate.replace(/-/g, '');
        if (!folio.includes(expectedDateStr)) {
            console.error(`❌ [ERROR CRÍTICO] Folio generado ${folio} NO corresponde al filtro ${currentFilterDate}`);
            showNotification('❌ Error: El folio no corresponde a la fecha del filtro activo', 'error');
            return;
        }
        console.log(`✅ [VALIDACIÓN] Folio ${folio} generado correctamente con fecha del filtro`);
    }

    // Estructura para Google Sheets: Folio, Fecha, Hora, Usuario, Orden, Destino, Horario, Código, Código 2, Estatus, Tarea, Estatus2, Cant Inicial, Cant Despacho, Incidencias, Operador, Unidad, Observaciones
    const dispatchRecord = {
        folio: folio,                           // A: Folio
        timestamp: timestamp.toISOString(),     // Timestamp ISO para referencia interna
        fecha: fecha,                           // B: Fecha (DD/MM/YYYY formato consistente)
        hora: hora,                             // C: Hora (HH:MM formato consistente)
        usuario: CURRENT_USER,                  // D: Usuario
        orden: STATE.currentOrder,              // E: Orden
        destino: orderData.recipient || '',     // F: Destino
        horario: normalizeDeliveryDate(orderData.expectedArrival) || '', // G: Horario (Fecha de Envío normalizada ISO 8601)
        codigo: orderData.trackingCode || '',   // H: Código
        codigo2: orderData.referenceNo || '',   // I: Código 2
        estatus: (cantidadDespacharNum < totalCajas) ? 'Parcial' : 'Procesado',  // J: Estatus (Parcial si cantDespacho < cantInicial)
        tarea: 'Despacho',                      // K: Tarea
        estatus2: 'Completado',                 // L: Estatus2
        cantInicial: totalCajas,                // M: Cant Inicial (from OBC, read-only)
        cantDespacho: cantidadDespacharNum,     // N: Cant Despacho (manual input)
        incidencias: (cantidadDespacharNum < totalCajas) ? `Parcial: ${cantidadDespacharNum}/${totalCajas}` : '',  // O: Incidencias (auto-generar cuando es parcial)
        operador: operador,                     // P: Operador (conductor)
        conductor: operador,                    // Alias para operador
        unidad: unidad,                         // Q: Unidad
        observaciones: notaDespacho,            // R: Observaciones
        notaDespacho: notaDespacho,             // Alias para observaciones
        // Datos adicionales para UI
        cantidadDespachar: cantidadDespacharNum,
        totalCajas: totalCajas,
        qc: Object.keys(qcData).length > 0 ? qcData : null
    };
    
    // VALIDACIÓN antes de guardar
    const recordValidation = validateDispatchRecord(dispatchRecord);
    if (!recordValidation.valid) {
        console.error('❌ Registro de despacho inválido:', recordValidation.errors);
        showNotification('❌ Error de validación: ' + recordValidation.errors.join(', '), 'error');
        return;
    }

    console.log('📝 DISPATCH RECORD CREADO:', {
        orden: STATE.currentOrder,
        cantInicial: totalCajas,
        cantDespacho: cantidadDespacharNum,
        operador: operador,
        unidad: unidad,
        observaciones: notaDespacho
    });

    // Guardar en validados locales primero (al inicio para mostrar las más recientes primero)
    STATE.localValidated.unshift(dispatchRecord);
    saveLocalState();

    // PUSH INMEDIATO: Enviar directamente a BD sin esperar cola
    if (dispatchSyncManager) {
        const result = await dispatchSyncManager.pushImmediate(dispatchRecord);
        if (result.success) {
            console.log('✅ [PUSH] Despacho enviado inmediatamente a BD');
        } else if (result.queued) {
            console.log('📥 [PUSH] Despacho en cola local (sin conexión)');
            showNotification('💾 Despacho guardado localmente - Se sincronizará cuando haya conexión', 'warning');
        }
    } else {
        // Fallback a método legacy
        addToDispatchSync(dispatchRecord);
        if (IS_ONLINE && gapi?.client?.getToken()) {
            await syncPendingData();
        } else {
            showNotification('💾 Despacho guardado localmente - Se sincronizará cuando haya conexión', 'warning');
            updateSyncStatus();
        }
    }

    closeInfoModal();
    showNotification(`✅ Despacho confirmado: ${STATE.currentOrder || ''} (${folio || ''})`, 'success');

    // Actualizar UI
    updateTabBadges();
    renderOrdersList();
    updateSummary();

    // Clear selections
    document.getElementById('modal-operador').value = '';
    document.getElementById('modal-unidad').value = '';
}

async function initSyncManager() {
    // Inicializar DispatchSyncManager optimizado (Push Inmediato + Polling 30s + Caché 30min)
    if (typeof DispatchSyncManager === 'undefined') {
        console.error('❌ DispatchSyncManager no está disponible');
        // Fallback a SyncManager legacy
        if (typeof SyncManager !== 'undefined') {
            console.log('⚠️ Usando SyncManager legacy como fallback');
            syncManager = new SyncManager({
                spreadsheetId: CONFIG.SPREADSHEET_WRITE,
                sheetName: 'BD',
                appName: 'Dispatch',
                storageKey: 'dispatch_pending_sync'
            });
            syncManager.init();
            window.syncManager = syncManager;
        }
        return;
    }

    const syncConfig = {
        spreadsheetId: CONFIG.SPREADSHEET_WRITE,
        sheetName: 'BD',
        appName: 'Dispatch',
        storageKey: 'dispatch_pending_sync',
        
        // Formateador de registros para Google Sheets
        formatRecord: (record) => {
            let fecha = record?.fecha || '';
            let hora = record?.hora || '';

            // Si no hay fecha/hora, generar desde timestamp
            if ((!fecha || !hora) && record?.timestamp) {
                const formatted = formatDateTimeForDB(new Date(record.timestamp));
                fecha = fecha || formatted.fecha;
                hora = hora || formatted.hora;
            }

            // Validación de formato
            if (fecha && !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
                const d = new Date(record.timestamp || Date.now());
                fecha = formatDateTimeForDB(d).fecha;
            }

            if (hora && !/^\d{2}:\d{2}$/.test(hora)) {
                const d = new Date(record.timestamp || Date.now());
                hora = formatDateTimeForDB(d).hora;
            }

            // NORMALIZACIÓN: Convertir horario (Columna G) a formato legible
            // Si es un número (serie de Excel), convertirlo a formato de fecha legible
            let horarioNormalizado = record.horario || '';
            if (horarioNormalizado && typeof horarioNormalizado === 'number') {
                // Es un número de serie de Excel, convertir a fecha
                const excelEpoch = new Date(1899, 11, 30);
                const dateFromSerial = new Date(excelEpoch.getTime() + horarioNormalizado * 86400000);

                // Formatear como DD/MM/YYYY HH:mm
                const day = String(dateFromSerial.getDate()).padStart(2, '0');
                const month = String(dateFromSerial.getMonth() + 1).padStart(2, '0');
                const year = dateFromSerial.getFullYear();
                const hours = String(dateFromSerial.getHours()).padStart(2, '0');
                const minutes = String(dateFromSerial.getMinutes()).padStart(2, '0');

                horarioNormalizado = `${day}/${month}/${year} ${hours}:${minutes}`;
            } else if (horarioNormalizado && typeof horarioNormalizado === 'string') {
                // Si ya es string, verificar si necesita normalización
                const parsedDate = parseOrderDate(horarioNormalizado);
                if (parsedDate && !isNaN(parsedDate.getTime())) {
                    // Re-formatear para consistencia
                    const day = String(parsedDate.getDate()).padStart(2, '0');
                    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
                    const year = parsedDate.getFullYear();
                    const hours = String(parsedDate.getHours()).padStart(2, '0');
                    const minutes = String(parsedDate.getMinutes()).padStart(2, '0');

                    horarioNormalizado = `${day}/${month}/${year} ${hours}:${minutes}`;
                }
            }

            return [
                record.folio || '',
                fecha,
                hora,
                record.usuario || '',
                record.orden || '',
                record.destino || '',
                horarioNormalizado,  // Columna G - Ahora normalizada
                record.codigo || '',
                record.codigo2 || '',
                record.estatus || '',
                record.tarea || '',
                record.estatus2 || '',
                record.cantInicial || '',
                record.cantDespacho || '',
                record.incidencias || '',
                record.operador || '',
                record.unidad || '',
                record.observaciones || ''
            ];
        },
        
        // Callbacks
        onSyncStart: () => {
            if (typeof updateConnectionIndicator === 'function') {
                updateConnectionIndicator(true);
            }
        },
        onSyncEnd: () => {
            if (typeof updateConnectionIndicator === 'function') {
                updateConnectionIndicator(false);
            }
        },
        
        // Callback cuando hay nuevos datos del polling (30s)
        onDataUpdate: (update) => {
            console.log('📊 [SYNC] Datos actualizados desde servidor:', update.type);
            if (update.type === 'OPERATIONAL') {
                // Actualizar datos remotos en STATE
                handleRemoteDataUpdate(update.data);
            }
        },
        
        // Callback cuando hay conflicto de concurrencia
        onConflict: (conflict) => {
            console.warn('⚠️ [SYNC] Conflicto de concurrencia detectado:', conflict);
            handleConcurrencyConflict(conflict);
        }
    };

    // Crear instancia del DispatchSyncManager
    dispatchSyncManager = new DispatchSyncManager(syncConfig);
    await dispatchSyncManager.init();
    
    // Exponer globalmente
    window.dispatchSyncManager = dispatchSyncManager;
    window.syncManager = dispatchSyncManager; // Compatibilidad con código existente

    // Actualizar badge inicial
    const stats = dispatchSyncManager.getStats();
    const badge = document.getElementById('pending-badge');
    if (badge && stats.pendingSync > 0) {
        badge.textContent = stats.pendingSync;
        badge.style.display = 'inline-block';
    } else if (badge) {
        badge.style.display = 'none';
    }
    
    console.log('✅ [DISPATCH] DispatchSyncManager inicializado');
    console.log('   - Push Inmediato: Escrituras sin espera');
    console.log('   - Polling: 30s para BD operativa');
    console.log('   - Caché: 30min para BDs de referencia');
}

/**
 * Maneja actualizaciones remotas de datos (polling 30s)
 */
function handleRemoteDataUpdate(rows) {
    if (!rows || rows.length <= 1) return;
    
    console.log(`📥 [SYNC] Procesando ${rows.length - 1} registros remotos...`);
    
    // Parsear registros remotos (skip header)
    const remoteRecords = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length >= 5) {
            remoteRecords.push({
                folio: row[0] || '',
                fecha: row[1] || '',
                hora: row[2] || '',
                usuario: row[3] || '',
                orden: row[4] || '',
                destino: row[5] || '',
                horario: row[6] || '',
                codigo: row[7] || '',
                codigo2: row[8] || '',
                estatus: row[9] || '',
                tarea: row[10] || '',
                estatus2: row[11] || '',
                cantInicial: parseInt(row[12]) || 0,
                cantDespacho: parseInt(row[13]) || 0,
                incidencias: row[14] || '',
                operador: row[15] || '',
                unidad: row[16] || '',
                observaciones: row[17] || '',
                _remote: true
            });
        }
    }
    
    // Detectar nuevos registros que no están en localValidated
    const localFolios = new Set(STATE.localValidated.map(r => r.folio));
    const newRemoteRecords = remoteRecords.filter(r => r.folio && !localFolios.has(r.folio));
    
    if (newRemoteRecords.length > 0) {
        console.log(`🆕 [SYNC] ${newRemoteRecords.length} nuevos registros de otros usuarios`);
        
        // Agregar nuevos registros remotos al estado local
        STATE.localValidated = [...newRemoteRecords, ...STATE.localValidated];
        
        // Actualizar UI
        renderValidatedTable();
        updateTabBadges();
        updateSummary();
        
        // Notificar al usuario
        if (typeof showNotification === 'function') {
            showNotification(`📥 ${newRemoteRecords.length} nuevo(s) despacho(s) de otros usuarios`, 'info');
        }
    }
}

/**
 * Maneja conflictos de concurrencia (bloqueo optimista)
 */
function handleConcurrencyConflict(conflict) {
    // Mostrar modal de conflicto al usuario
    const message = `
        <div style="padding: 15px;">
            <h3 style="color: #e65100; margin-bottom: 10px;">⚠️ Conflicto de Edición</h3>
            <p>El registro fue modificado por otro usuario mientras lo editabas.</p>
            <p><strong>Tu versión:</strong> ${conflict.expected}</p>
            <p><strong>Versión actual:</strong> ${conflict.actual}</p>
            <div style="margin-top: 15px;">
                <button class="btn btn-primary" onclick="resolveConflictKeepLocal()">
                    Mantener mis cambios
                </button>
                <button class="btn btn-secondary" onclick="resolveConflictUseRemote()">
                    Usar versión del servidor
                </button>
            </div>
        </div>
    `;
    
    // Guardar datos del conflicto para resolución
    window._pendingConflict = conflict;
    
    // Mostrar en modal o notificación
    if (typeof showNotification === 'function') {
        showNotification('⚠️ Conflicto de edición detectado - Revisa los cambios', 'warning');
    }
    
    console.warn('⚠️ Conflicto pendiente de resolución:', conflict);
}

/**
 * Resuelve conflicto manteniendo cambios locales
 */
async function resolveConflictKeepLocal() {
    const conflict = window._pendingConflict;
    if (!conflict) return;
    
    // Forzar escritura con nueva versión
    if (dispatchSyncManager) {
        await dispatchSyncManager.pushImmediate(conflict.localData);
    }
    
    window._pendingConflict = null;
    showNotification('✅ Tus cambios han sido guardados', 'success');
}

/**
 * Resuelve conflicto usando datos remotos
 */
function resolveConflictUseRemote() {
    const conflict = window._pendingConflict;
    if (!conflict) return;
    
    // Actualizar estado local con datos remotos
    const index = STATE.localValidated.findIndex(r => r.orden === conflict.remoteData.orden);
    if (index !== -1) {
        STATE.localValidated[index] = conflict.remoteData;
        saveLocalState();
        renderValidatedTable();
    }
    
    window._pendingConflict = null;
    showNotification('✅ Datos actualizados desde el servidor', 'success');
}

function updateTabBadges() {
    // Sidebar badges (if they exist)
    const validatedBadge = document.getElementById('validated-badge');
    const pendingBadge = document.getElementById('pending-badge');

    // Header badges (panel de búsqueda)
    const todoBadgeHeader = document.getElementById('todo-badge-header');
    const validatedBadgeHeader = document.getElementById('validated-badge-header');
    const pendingBadgeHeader = document.getElementById('pending-badge-header');

    // Header badges (panel de validadas)
    const todoBadgeValidated = document.getElementById('todo-badge-validated');
    const validatedBadgeValidated = document.getElementById('validated-badge-validated');
    const pendingBadgeValidated = document.getElementById('pending-badge-validated');

    // Header badges (panel de folios)
    const todoBadgeFolios = document.getElementById('todo-badge-folios');
    const validatedBadgeFolios = document.getElementById('validated-badge-folios');
    const pendingBadgeFolios = document.getElementById('pending-badge-folios');

    // Calculate validated count - EXCLUIR Canceladas y No Procesables
    // Filtrar por fecha si está activo
    let validatedCount = 0;
    let otrosCount = 0;

    if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
        const startParts = STATE.dateFilter.startDate.split('-');
        const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        startDate.setHours(0, 0, 0, 0);

        const endParts = STATE.dateFilter.endDate.split('-');
        const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
        endDate.setHours(23, 59, 59, 999);

        STATE.localValidated.forEach(record => {
            const orderData = STATE.obcData.get(record.orden) || {};
            const dateStr = record.horario || orderData.expectedArrival;
            if (!dateStr) return;
            const orderDate = parseOrderDate(dateStr);
            if (orderDate && orderDate >= startDate && orderDate <= endDate) {
                // Separar "Otros" de "Validadas"
                if (record.estatus === 'Cancelada' || record.estatus === 'No Procesable') {
                    otrosCount++;
                } else {
                    validatedCount++;
                }
            }
        });
    } else {
        // Sin filtro de fecha - contar todos pero separar Otros
        STATE.localValidated.forEach(record => {
            if (record.estatus === 'Cancelada' || record.estatus === 'No Procesable') {
                otrosCount++;
            } else {
                validatedCount++;
            }
        });
    }

    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;
    let pendingCount = 0;
    let pendingCalidadCount = 0;
    let todoCount = dataToUse.size;

    for (const [orden] of dataToUse.entries()) {
        const { validated: isValidated, data: validatedData } = isOrderValidated(orden);

        if (!isValidated) {
            pendingCount++;
        } else if (validatedData) {
            // Verificar si tiene estado "Pendiente Calidad"
            const calidad = validatedData.calidad || '';
            const estatus = validatedData.estatus || '';
            if (calidad.includes('Pendiente') || estatus === 'Pendiente Calidad') {
                pendingCalidadCount++;
                pendingCount++; // También cuenta como pendiente
            }
        }
    }

    // Update sidebar badges
    if (validatedBadge) {
        validatedBadge.textContent = validatedCount;
    }

    if (pendingBadge) {
        pendingBadge.textContent = pendingCount;
    }

    // Update header badges (panel de búsqueda)
    if (todoBadgeHeader) {
        todoBadgeHeader.textContent = todoCount;
    }

    if (validatedBadgeHeader) {
        validatedBadgeHeader.textContent = validatedCount;
    }

    if (pendingBadgeHeader) {
        pendingBadgeHeader.textContent = pendingCount;
    }

    // Update header badges (panel de validadas)
    if (todoBadgeValidated) {
        todoBadgeValidated.textContent = todoCount;
    }

    if (validatedBadgeValidated) {
        validatedBadgeValidated.textContent = validatedCount;
    }

    if (pendingBadgeValidated) {
        pendingBadgeValidated.textContent = pendingCount;
    }

    // Update header badges (panel de folios)
    if (todoBadgeFolios) {
        todoBadgeFolios.textContent = todoCount;
    }

    if (validatedBadgeFolios) {
        validatedBadgeFolios.textContent = validatedCount;
    }

    if (pendingBadgeFolios) {
        pendingBadgeFolios.textContent = pendingCount;
    }

    // Update global navigation badges
    const globalPendingBadge = document.getElementById('global-pending-badge');
    const globalValidatedBadge = document.getElementById('global-validated-badge');

    if (globalPendingBadge) {
        globalPendingBadge.textContent = pendingCount;
    }

    if (globalValidatedBadge) {
        globalValidatedBadge.textContent = validatedCount;
    }

    // Update "Otros" badges (Canceladas + No Procesables)
    const globalOtrosBadge = document.getElementById('global-otros-badge');
    const otrosBadgeHeader = document.getElementById('otros-badge-header');
    const otrosBadgeValidated = document.getElementById('otros-badge-validated');
    const otrosBadgeFolios = document.getElementById('otros-badge-folios');
    const otrosBadgeOtros = document.getElementById('otros-badge-otros');
    const todoBadgeOtros = document.getElementById('todo-badge-otros');
    const pendingBadgeOtros = document.getElementById('pending-badge-otros');
    const validatedBadgeOtros = document.getElementById('validated-badge-otros');

    if (globalOtrosBadge) {
        globalOtrosBadge.textContent = otrosCount;
    }
    if (otrosBadgeHeader) {
        otrosBadgeHeader.textContent = otrosCount;
    }
    if (otrosBadgeValidated) {
        otrosBadgeValidated.textContent = otrosCount;
    }
    if (otrosBadgeFolios) {
        otrosBadgeFolios.textContent = otrosCount;
    }
    if (otrosBadgeOtros) {
        otrosBadgeOtros.textContent = otrosCount;
    }
    if (todoBadgeOtros) {
        todoBadgeOtros.textContent = todoCount;
    }
    if (pendingBadgeOtros) {
        pendingBadgeOtros.textContent = pendingCount;
    }
    if (validatedBadgeOtros) {
        validatedBadgeOtros.textContent = validatedCount;
    }
}

// Funciones de compatibilidad
function loadPendingSync() {
    // El syncManager carga automáticamente al init
}

function savePendingSync() {
    if (syncManager) syncManager.save();
}

async function syncPendingData() {
    if (syncManager) {
        await syncManager.sync(true);
    }
}

function updateSyncStatus() {
    if (syncManager) {
        syncManager.updateUI(syncManager.getPendingCount() === 0);
    }
}

function showSyncPanel() {
    if (syncManager) {
        syncManager.showPanel();
    }
}

// Helper para agregar a la cola de sync
function addToDispatchSync(record) {
    if (syncManager) {
        syncManager.addToQueue(record);
    } else {
        STATE.pendingSync.push(record);
    }
}

// ==================== DATE FILTER ====================
function showDateFilter() {
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    document.getElementById('date-start').value = STATE.dateFilter.startDate || today.toISOString().slice(0, 10);
    document.getElementById('date-end').value = STATE.dateFilter.endDate || endDate.toISOString().slice(0, 10);

    document.getElementById('date-filter-modal').classList.add('show');
}

function closeDateFilter() {
    const modal = document.getElementById('date-filter-modal');
    const isDispatchInit = modal.getAttribute('data-dispatch-init') === 'true';
    
    // Si se cancela el inicio de despacho, volver al inicio
    if (isDispatchInit) {
        modal.removeAttribute('data-dispatch-init');
        showNotification('ℹ️ Debes seleccionar una fecha para iniciar el despacho', 'info');
    }
    
    modal.classList.remove('show');
}

async function applyDateFilter() {
    const startDate = document.getElementById('date-start').value;
    const endDate = document.getElementById('date-end').value;

    if (!startDate || !endDate) {
        showNotification('⚠️ Debes seleccionar ambas fechas', 'warning');
        return;
    }

    // Validar que fecha inicio no sea mayor que fecha fin
    if (startDate > endDate) {
        showNotification('⚠️ La fecha de inicio no puede ser mayor que la fecha de fin', 'warning');
        return;
    }

    // Validar que el rango no sea mayor a 7 días para tabs principales
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 7) {
        showNotification('⚠️ El rango de fechas no puede ser mayor a 7 días', 'warning');
        return;
    }

    // ==================== DETECCIÓN DE CAMBIO DE FILTRO ====================
    const isFilterChange = STATE.dateFilter.active && 
                          (STATE.dateFilter.startDate !== startDate || STATE.dateFilter.endDate !== endDate);
    
    if (isFilterChange) {
        console.log('🔄 [CAMBIO FILTRO] Detectado cambio de filtro de fecha - Limpiando contexto anterior...');
        
        // LIMPIAR DATOS ANTERIORES COMPLETAMENTE
        STATE.obcDataFiltered.clear();
        STATE.obcData.clear();
        STATE.validacionData.clear();
        STATE.mneData.clear();
        STATE.bdCajasData.clear();
        STATE.trsData = [];
        
        // Limpiar validaciones locales del rango anterior
        STATE.localValidated = [];
        STATE.localPending = [];
        
        // Reset load state para forzar recarga completa
        LOAD_STATE.criticalLoaded = false;
        LOAD_STATE.referencesLoaded = false;
        
        console.log('✅ [CAMBIO FILTRO] Contexto anterior eliminado - Preparando nueva carga');
    }

    STATE.dateFilter.startDate = startDate;
    STATE.dateFilter.endDate = endDate;
    STATE.dateFilter.active = true;

    // ✨ LAZY LOADING: Load data on-demand with date filter
    console.log('🚀 [FILTRO] Iniciando carga de datos para nuevo rango:', { startDate, endDate });
    
    try {
        // Mostrar indicador de carga
        STATE.isLoading = true;
        showNotification('⏳ Cargando datos del nuevo rango de fechas...', 'info', 2000);
        
        // ==================== TIMEOUT DE SEGURIDAD ====================
        // Garantizar que el loader NUNCA persista más de 3 segundos
        const safetyTimeout = setTimeout(() => {
            if (STATE.isLoading) {
                console.warn('⚠️ [LOAD] Timeout de seguridad alcanzado - Forzando isLoading = false');
                STATE.isLoading = false;
                renderOrdersList();
                renderValidatedTable();
                updateSummary();
            }
        }, 3000);
        
        // Call lazy loading function to fetch data for this date range
        await lazyLoadDataByDate(startDate, endDate);
        
        // Limpiar timeout si la carga fue exitosa
        clearTimeout(safetyTimeout);
        
        // After lazy loading completes, apply local filtering
        filterOrdersByDateRange();
        
        // ==================== CRÍTICO: LIMPIAR FLAG DE CARGA ====================
        // Limpiar INMEDIATAMENTE después de cargar datos del filtro (Prioridad 1)
        // El índice histórico se carga en background sin bloquear (Prioridad 2)
        STATE.isLoading = false;
        console.log('✅ [LOAD] Datos del filtro cargados - isLoading = false');

        // Verificar si es inicio de despacho
        const modal = document.getElementById('date-filter-modal');
        const isDispatchInit = modal.getAttribute('data-dispatch-init') === 'true';

        if (isDispatchInit) {
            // Activar panel de búsqueda
            modal.removeAttribute('data-dispatch-init');
            activateSearchPanelWithFilter();
        } else {
            // Solo actualizar filtro - Pendientes, Validadas y Otros
            renderOrdersList();
            renderValidatedTable();
            renderOtrosTable(); // También actualizar pestaña Otros con el filtro
            updateSummary();
        }

        // Parse dates as local time to avoid timezone offset in display
        const startParts = startDate.split('-');
        const startDateForDisplay = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
        const endParts = endDate.split('-');
        const endDateForDisplay = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));

        const startFormatted = formatDateDDMMYYYY(startDateForDisplay);
        const endFormatted = formatDateDDMMYYYY(endDateForDisplay);

        // Actualizar botón de filtro en todas las pestañas
        const dateFilterText = document.getElementById('date-filter-text');
        const dateFilterBtn = document.getElementById('date-filter-display');
        if (dateFilterText) {
            dateFilterText.textContent = `${startFormatted} → ${endFormatted}`;
        }
        if (dateFilterBtn) {
            dateFilterBtn.classList.add('active-filter');
        }

        // Actualizar en pestaña Validadas
        const validatedDateFilterText = document.getElementById('validated-date-filter-text');
        const validatedDateFilterBtn = document.getElementById('validated-date-filter-display');
        if (validatedDateFilterText) {
            validatedDateFilterText.textContent = `${startFormatted} → ${endFormatted}`;
        }
        if (validatedDateFilterBtn) {
            validatedDateFilterBtn.classList.add('active-filter');
        }

        // Actualizar en pestaña Otros
        const otrosDateFilterText = document.getElementById('otros-date-filter-text');
        const otrosDateFilterBtn = document.getElementById('otros-date-filter-display');
        if (otrosDateFilterText) {
            otrosDateFilterText.textContent = `${startFormatted} → ${endFormatted}`;
        }
        if (otrosDateFilterBtn) {
            otrosDateFilterBtn.classList.add('active-filter');
        }

        // Actualizar en pestaña Folios
        const foliosDateFilterText = document.getElementById('folios-date-filter-text');
        const foliosDateFilterBtn = document.getElementById('folios-date-filter-display');
        if (foliosDateFilterText) {
            foliosDateFilterText.textContent = `${startFormatted} → ${endFormatted}`;
        }
        if (foliosDateFilterBtn) {
            foliosDateFilterBtn.classList.add('active-filter');
        }

        showNotification(`📅 Filtro aplicado: ${startFormatted} - ${endFormatted} (${STATE.obcDataFiltered.size} órdenes)`, 'success');

        // CHANGE 1: Update global navigation date indicator
        updateGlobalDateIndicator();
        
        // ==================== MARCAR SESIÓN ACTIVA ====================
        // Guardar marca de sesión válida después de aplicar filtro exitosamente
        markActiveSession();
        
    } catch (error) {
        console.error('Error applying date filter with lazy loading:', error);
        showNotification('❌ Error al cargar datos: ' + error.message, 'error');
        
        // CRÍTICO: Limpiar flag incluso en error para no bloquear UI
        STATE.isLoading = false;
    } finally {
        // Garantizar que isLoading siempre se limpie
        STATE.isLoading = false;
        closeDateFilter();
    }
}

function clearDateFilter() {
    STATE.dateFilter.startDate = null;
    STATE.dateFilter.endDate = null;
    STATE.dateFilter.active = false;
    STATE.obcDataFiltered.clear();

    // ✨ Clear lazy-loaded data
    STATE.obcData.clear();
    STATE.bdCajasData.clear();
    STATE.localValidated = [];
    STATE.localPending = [];

    document.getElementById('date-start').value = '';
    document.getElementById('date-end').value = '';
    document.getElementById('date-start-display').textContent = 'Seleccionar fecha...';
    document.getElementById('date-end-display').textContent = 'Seleccionar fecha...';

    // Restaurar texto del botón en todas las pestañas
    const dateFilterText = document.getElementById('date-filter-text');
    const dateFilterBtn = document.getElementById('date-filter-display');
    const validatedDateFilterText = document.getElementById('validated-date-filter-text');
    const validatedDateFilterBtn = document.getElementById('validated-date-filter-display');
    const otrosDateFilterText = document.getElementById('otros-date-filter-text');
    const otrosDateFilterBtn = document.getElementById('otros-date-filter-display');
    const foliosDateFilterText = document.getElementById('folios-date-filter-text');
    const foliosDateFilterBtn = document.getElementById('folios-date-filter-display');

    if (dateFilterText) {
        dateFilterText.textContent = 'Mostrando Todo';
    }
    if (dateFilterBtn) {
        dateFilterBtn.classList.remove('active-filter');
    }
    if (validatedDateFilterText) {
        validatedDateFilterText.textContent = 'Mostrando Todo';
    }
    if (validatedDateFilterBtn) {
        validatedDateFilterBtn.classList.remove('active-filter');
    }
    if (otrosDateFilterText) {
        otrosDateFilterText.textContent = 'Mostrando Todo';
    }
    if (otrosDateFilterBtn) {
        otrosDateFilterBtn.classList.remove('active-filter');
    }
    if (foliosDateFilterText) {
        foliosDateFilterText.textContent = 'Mostrando Todo';
    }
    if (foliosDateFilterBtn) {
        foliosDateFilterBtn.classList.remove('active-filter');
    }

    updateDateFilterDisplay();
    updateValidatedFilterIndicator();
    updateSummary();
    updateTabBadges();
    updateValidationBadges();

    // Clear tables
    const pendingTableBody = document.getElementById('orders-table-body');
    const validatedTableBody = document.getElementById('validated-table-body');
    
    if (pendingTableBody) {
        pendingTableBody.innerHTML = `
            <tr>
                <td colspan="10" class="table-empty-state">
                    📅 Selecciona un rango de fechas para cargar órdenes
                </td>
            </tr>
        `;
    }
    
    if (validatedTableBody) {
        validatedTableBody.innerHTML = `
            <tr>
                <td colspan="15" class="table-empty-state">
                    📅 Selecciona un rango de fechas para cargar registros validados
                </td>
            </tr>
        `;
    }

    closeDateFilter();

    // CHANGE 1: Update global navigation date indicator
    updateGlobalDateIndicator();

    renderOrdersList();
    renderValidatedTable(); // Also update Validadas - shared filter
    updateSummary();
    closeDateFilter();

    showNotification('🔄 Filtro de fecha eliminado', 'info');
}

// ==================== EXPORT ====================
function exportData() {
    // Solo exportar órdenes validadas (en STATE.localValidated)
    if (STATE.localValidated.length === 0) {
        showNotification('⚠️ No hay órdenes validadas para exportar', 'warning');
        return;
    }

    let csv = 'Folio,Fecha,Hora,Usuario,Orden,Destino,Horario,Tracking,Código2,Estatus,Tarea,Estatus2,Incidencias,Operador,Unidad,Observaciones,Cant.Despachar,Total Cajas\n';

    STATE.localValidated.forEach(record => {
        csv += `"${record.folio}","${record.fecha}","${record.hora}","${record.usuario}","${record.orden}","${record.destino}","${record.horario}","${record.codigo}","${record.codigo2 || ''}","${record.estatus}","${record.tarea}","${record.estatus2}","${record.incidencias || ''}","${record.operador}","${record.unidad}","${record.observaciones || ''}","${record.cantidadDespachar}","${record.totalCajas}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const timestamp = formatDateDDMMYYYY(new Date());
    link.download = `despacho_validadas_${timestamp}.csv`;
    link.click();

    showNotification(`✅ ${STATE.localValidated.length} órdenes validadas exportadas`, 'success');
}

// ==================== QUALITY CONTROL ====================
function toggleQualityControl(isChecked) {
    const qcContent = document.getElementById('qc-content');
    if (qcContent) {
        qcContent.style.display = isChecked ? 'block' : 'none';
    }
}

const QC_TASKS = {
    'cambio-etiqueta': 'Cambio Etiqueta Exterior',
    'cambio-sku': 'Cambio SKU',
    'reparacion': 'Reparación',
    'cambio-caja': 'Cambio de Caja',
    'otros': 'Otros'
};

let selectedQCTasks = new Set();
let qcTaskStatuses = {};

// Nueva función para el diseño con dropdowns
function toggleQCTaskStatus(taskId, isChecked) {
    const statusSelect = document.getElementById(`qc-status-${taskId}`);
    const otrosNoteContainer = document.getElementById('qc-otros-note-container');

    if (isChecked) {
        selectedQCTasks.add(taskId);
        statusSelect.disabled = false;
        statusSelect.style.opacity = '1';

        // Mostrar nota para "Otros"
        if (taskId === 'otros' && otrosNoteContainer) {
            otrosNoteContainer.style.display = 'block';
        }
    } else {
        selectedQCTasks.delete(taskId);
        delete qcTaskStatuses[taskId];
        statusSelect.disabled = true;
        statusSelect.value = '';
        statusSelect.style.opacity = '0.5';

        // Ocultar nota para "Otros"
        if (taskId === 'otros' && otrosNoteContainer) {
            otrosNoteContainer.style.display = 'none';
            const otrosNote = document.getElementById('qc-otros-note');
            if (otrosNote) otrosNote.value = '';
        }
    }

    // Actualizar estatus cuando cambia el select
    statusSelect.onchange = () => {
        qcTaskStatuses[taskId] = statusSelect.value;
    };
}

function initializeQCFromTRS(trsRelacionados) {
    // Pre-select tasks based on TRS types (if we can determine from the data)
    // For now, we'll just auto-expand the QC section
    const qcBody = document.getElementById('section-qc-body');
    if (qcBody) {
        qcBody.classList.remove('collapsed');
        const toggle = document.getElementById('section-qc-body-toggle');
        if (toggle) toggle.classList.remove('collapsed');
    }

    // You could add logic here to auto-select certain tasks based on TRS data
    // For example:
    // if (trsRelacionados.some(t => t.trs.includes('ETIQ'))) {
    //     document.getElementById('task-cambio-etiqueta')?.click();
    // }
}

// ==================== UTILITIES ====================
function showPreloader(text = 'Cargando...', subtext = 'Por favor espera') {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.querySelector('.preloader-text').textContent = text;
        overlay.querySelector('.preloader-subtext').textContent = subtext;
        overlay.style.display = 'flex';
    }
}

function hidePreloader() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function showLoadingOverlay(show, current = 0, total = 5, customMessage = null) {
    const overlay = document.getElementById('data-loading-overlay');
    if (!overlay) {
        console.warn('data-loading-overlay not found');
        return;
    }

    if (show) {
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        
        // Update progress bar fill
        const progressFill = document.getElementById('loading-progress-fill');
        if (progressFill) {
            progressFill.style.width = `${percentage}%`;
        }

        // Update progress text
        const progressText = document.getElementById('loading-progress-text');
        if (progressText) {
            progressText.textContent = `${current} / ${total} completadas`;
        }

        // Update main message
        const preloaderText = overlay.querySelector('.preloader-text');
        if (preloaderText && customMessage) {
            preloaderText.textContent = customMessage;
        } else if (preloaderText) {
            preloaderText.textContent = '🔄 Cargando bases de datos...';
        }

        overlay.style.display = 'flex';
        console.log(`📊 Progress: ${current}/${total} (${percentage}%)`);
    } else {
        overlay.style.display = 'none';
    }
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    container.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('show');
    }, 10);

    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function copyToClipboard(text, iconElement) {
    if (!text || text === '-' || text === 'N/A') return;

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
        showNotification('❌ Error al copiar', 'error');
    });
}

function makeCopyable(value) {
    if (!value || value === '-' || value === 'N/A') return value;
    return `<span class="copyable">${value}<span class="copy-icon" onclick="event.stopPropagation(); copyToClipboard('${String(value).replace(/'/g, "\\'")}', this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span></span>`;
}

/**
 * Crea un badge redondeado consistente para estatus
 * @param {string} type - Tipo de estatus: 'validado', 'pendiente', 'otros', 'cancelada', 'no-procesable'
 * @param {string} text - Texto a mostrar en el badge
 * @returns {string} HTML del badge
 */
function createStatusBadge(type, text) {
    const badgeStyles = {
        'validado': {
            bg: '#d1fae5',
            color: '#065f46',
            icon: '✅'
        },
        'pendiente': {
            bg: '#fef3c7',
            color: '#92400e',
            icon: '⏳'
        },
        'otros': {
            bg: '#e5e7eb',
            color: '#374151',
            icon: '📦'
        },
        'cancelada': {
            bg: '#fee2e2',
            color: '#991b1b',
            icon: '🚫'
        },
        'no-procesable': {
            bg: '#fef3c7',
            color: '#92400e',
            icon: '⚠️'
        }
    };

    const style = badgeStyles[type] || badgeStyles['otros'];

    return `<span class="status-badge-unified" style="background: ${style.bg}; color: ${style.color}; padding: 4px 12px; border-radius: 12px; font-size: 0.75em; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
        ${style.icon} ${text}
    </span>`;
}

// CHANGE 11: Format multiple services (comma-separated) with badges
function formatMultipleServices(servicesString) {
    if (!servicesString || servicesString === '-' || servicesString === 'N/A') {
        return '<span class="empty-cell">N/A</span>';
    }

    // Split by comma and trim each service
    const services = servicesString.split(',').map(s => s.trim()).filter(s => s);

    if (services.length === 0) {
        return '<span class="empty-cell">N/A</span>';
    }

    // Create a badge for each service
    const badges = services.map(service => {
        const colors = {
            'ESTANDAR': '#3b82f6',
            'EXPRESS': '#f59e0b',
            'OCURRE': '#10b981',
            'ESPECIAL': '#8b5cf6',
            'DEFAULT': '#64748b'
        };

        const color = colors[service.toUpperCase()] || colors['DEFAULT'];

        return `<span class="service-badge" style="background: ${color}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 0.75em; font-weight: 600; margin-right: 6px; display: inline-block;">${service}</span>`;
    }).join('');

    return `<div style="display: flex; gap: 6px; flex-wrap: wrap;">${badges}</div>`;
}

// ==================== GESTIÓN DE FOLIOS DE CARGA ====================

// Estado para el filtro de folios (pestaña regular - usa filtro global)
let FOLIOS_DATE_FILTER = {
    startDate: null,
    endDate: null,
    active: false
};

// Estado para el filtro de Gestión de Folios (vista independiente desde sidebar)
let FOLIOS_MGMT_DATE_FILTER = {
    startDate: null,
    endDate: null,
    active: false
};

// Flag para saber si estamos en vista de gestión independiente
let isInFoliosManagementView = false;

// Variables para ordenamiento de tabla de folios
let foliosSortColumn = 1; // Por defecto ordenar por fecha
let foliosSortDirection = 'desc';
let foliosMgmtSortColumn = 1;
let foliosMgmtSortDirection = 'desc';

/**
 * Muestra el panel de folios (pestaña dentro de navegación principal)
 */
function showFoliosManagement() {
    // CHANGE 1: Show global navigation
    showGlobalNavigation();

    // Limpiar el flag de "viene desde folios"
    STATE.fromFolios = false;

    // Re-habilitar el botón Pendientes si estaba deshabilitado
    const togglePendingValidated = document.getElementById('toggle-pending-validated');
    if (togglePendingValidated) {
        togglePendingValidated.disabled = false;
        togglePendingValidated.style.opacity = '1';
        togglePendingValidated.style.cursor = 'pointer';
        togglePendingValidated.title = '';
    }

    // Remove active class from all tab buttons across all panels
    document.querySelectorAll('.status-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Add active class to all Folios buttons
    const folioButtons = [
        document.getElementById('toggle-folios'),
        document.getElementById('toggle-folios-validated'),
        document.getElementById('toggle-folios-folios')
    ];
    folioButtons.forEach(btn => {
        if (btn) btn.classList.add('active');
    });

    // Ocultar todos los demás paneles usando la función centralizada
    hideAllContentPanels();
    // Mostrar solo folios-content
    showContentPanel('folios-content');
    
    // Actualizar texto del filtro de fecha según el filtro global (mismo diseño que validated)
    const filterText = document.getElementById('folios-date-filter-text');
    const filterBtn = document.getElementById('folios-date-filter-display');
    if (filterText) {
        if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
            const startFormatted = formatDateForDisplay(STATE.dateFilter.startDate);
            const endFormatted = formatDateForDisplay(STATE.dateFilter.endDate);
            filterText.textContent = `${startFormatted} → ${endFormatted}`;
            if (filterBtn) filterBtn.classList.add('active-filter');
        } else {
            filterText.textContent = 'Mostrando Todo';
            if (filterBtn) filterBtn.classList.remove('active-filter');
        }
    }

    // Renderizar la tabla de folios primero
    renderFoliosTable();

    // IMPORTANTE: Actualizar badges DESPUÉS de renderizar para tener contadores correctos
    // Usar setTimeout para asegurar que el DOM se actualizó
    setTimeout(() => {
        updateTabBadges();
    }, 0);

    // CHANGE 1: Update global navigation
    updateGlobalNavigation();
}

/**
 * Obtiene todos los folios de carga consolidados desde STATE.localValidated
 */
function getAllFolios() {
    const foliosMap = new Map(); // folio completo → datos

    STATE.localValidated.forEach(record => {
        const folioCompleto = record.folio; // Ej: "DSP-20251230-01"
        const folioParts = folioCompleto.split('-');

        if (folioParts.length !== 3) return; // Formato inválido

        const fechaStr = folioParts[1]; // "20251230"
        const folioNum = folioParts[2]; // "01"

        // Convertir fecha a formato legible YYYY-MM-DD
        const fecha = `${fechaStr.substring(0, 4)}-${fechaStr.substring(4, 6)}-${fechaStr.substring(6, 8)}`;

        if (!foliosMap.has(folioCompleto)) {
            foliosMap.set(folioCompleto, {
                folio: folioCompleto,
                folioNum: folioNum,
                fecha: fecha,
                fechaStr: fechaStr,
                conductor: record.operador || record.conductor, // Usar operador (nombre correcto del campo)
                unidad: record.unidad,
                ordenes: [],
                totalCajas: 0,
                horarios: [],
                destinos: new Set() // Set para almacenar destinos únicos
            });
        }

        const folioData = foliosMap.get(folioCompleto);
        folioData.ordenes.push(record.orden);
        folioData.totalCajas += parseInt(record.cantidadDespachar) || 0;

        // Agregar horario si existe
        if (record.horario) {
            folioData.horarios.push(record.horario);
        }

        // Agregar destino si existe
        if (record.destino) {
            folioData.destinos.add(record.destino);
        }
    });

    // Convertir destinos de Set a string consolidado
    return Array.from(foliosMap.values()).map(folio => ({
        ...folio,
        destinos: Array.from(folio.destinos).join(', ') // Convertir Set a string separado por comas
    }));
}

/**
 * Renderiza la tabla de folios
 */
function renderFoliosTable() {
    const tableBody = document.getElementById('folios-table-body');
    if (!tableBody) return;

    let folios = getAllFolios();

    // SINCRONIZACIÓN GLOBAL: La pestaña de Folios usa el filtro global de fecha
    // Si hay filtro global activo, usarlo; si no, usar filtro propio de folios
    let useGlobalFilter = STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate;
    let useFoliosFilter = FOLIOS_DATE_FILTER.active && FOLIOS_DATE_FILTER.startDate && FOLIOS_DATE_FILTER.endDate;
    
    if (useGlobalFilter) {
        // ============================================================
        // NUEVA LÓGICA DE TRIANGULACIÓN (Solo para filtro global)
        // Paso A: Identificar órdenes por Fecha de Envío
        // Paso B: Extraer IDs de Folios de esas órdenes
        // Paso C: Mostrar solo esos folios (DISTINCT)
        // ============================================================
        
        const startDate = parseDateLocal(STATE.dateFilter.startDate);
        const endDate = parseDateLocal(STATE.dateFilter.endDate);
        endDate.setHours(23, 59, 59, 999);

        // PASO A: Filtrar órdenes validadas por Fecha de Envío (columna G - horario)
        const ordenesEnRango = STATE.localValidated.filter(record => {
            const orderData = STATE.obcData.get(record.orden) || {};
            const dateStr = record.horario || orderData.expectedArrival;
            
            if (!dateStr) return false;
            
            const orderDate = parseOrderDate(dateStr);
            return orderDate && orderDate >= startDate && orderDate <= endDate;
        });

        // PASO B: Extraer IDs de Folios únicos (DISTINCT)
        const foliosIdsEnRango = new Set();
        ordenesEnRango.forEach(record => {
            if (record.folio) {
                foliosIdsEnRango.add(record.folio);
            }
        });

        // PASO C: Filtrar folios que estén en el Set de IDs
        folios = folios.filter(folio => foliosIdsEnRango.has(folio.folio));
        
        console.log(`📋 [TRIANGULACIÓN] Filtro Global Activo:`);
        console.log(`   - Órdenes en rango de fecha de envío: ${ordenesEnRango.length}`);
        console.log(`   - Folios únicos encontrados: ${foliosIdsEnRango.size}`);
        console.log(`   - Folios a mostrar: ${folios.length}`);
        
        // Actualizar texto del botón de filtro de folios (mismo formato que otras pestañas)
        const filterText = document.getElementById('folios-date-filter-text');
        if (filterText) {
            const startFormatted = formatDateForDisplay(STATE.dateFilter.startDate);
            const endFormatted = formatDateForDisplay(STATE.dateFilter.endDate);
            filterText.textContent = `${startFormatted} → ${endFormatted}`;
        }
    } else if (useFoliosFilter) {
        // Filtro propio de folios (NO usa triangulación, filtro directo por fecha de folio)
        // Este filtro se usa cuando el usuario aplica filtro desde la pestaña de Folios
        const startDate = parseDateLocal(FOLIOS_DATE_FILTER.startDate);
        const endDate = parseDateLocal(FOLIOS_DATE_FILTER.endDate);
        endDate.setHours(23, 59, 59, 999);

        folios = folios.filter(folio => {
            const folioDate = parseDateLocal(folio.fecha);
            return folioDate >= startDate && folioDate <= endDate;
        });
    }

    // Ordenar folios
    folios.sort((a, b) => {
        let valA, valB;

        switch(foliosSortColumn) {
            case 0: // Folio
                valA = a.folio;
                valB = b.folio;
                break;
            case 1: // Fecha
                valA = a.fecha;
                valB = b.fecha;
                break;
            case 2: // Destino
                valA = a.destinos || '';
                valB = b.destinos || '';
                break;
            case 3: // Cant. Cajas
                valA = a.totalCajas;
                valB = b.totalCajas;
                break;
            case 4: // Cant. Órdenes
                valA = a.ordenes.length;
                valB = b.ordenes.length;
                break;
            case 5: // Horario Inicial
                valA = a.horarios.length > 0 ? Math.min(...a.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                valB = b.horarios.length > 0 ? Math.min(...b.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                break;
            case 6: // Horario Final
                valA = a.horarios.length > 0 ? Math.max(...a.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                valB = b.horarios.length > 0 ? Math.max(...b.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                break;
            case 7: // Conductor
                valA = a.conductor || '';
                valB = b.conductor || '';
                break;
            case 8: // Unidad
                valA = a.unidad || '';
                valB = b.unidad || '';
                break;
            default:
                valA = a.fecha;
                valB = b.fecha;
        }

        if (foliosSortDirection === 'asc') {
            return valA > valB ? 1 : -1;
        } else {
            return valA < valB ? 1 : -1;
        }
    });

    // CHANGE 2: Actualizar badges dinámicos basados en filtros activos
    updateFoliosBadges(folios);

    if (folios.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="table-empty-state">
                    <div class="table-empty-icon">📋</div>
                    <div class="table-empty-text">No hay folios de carga</div>
                    <div class="table-empty-subtext">Los folios generados aparecerán aquí</div>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = folios.map(folio => {
        const horarioInicial = folio.horarios.length > 0
            ? folio.horarios.reduce((min, h) => h < min ? h : min, folio.horarios[0])
            : 'N/A';
        const horarioFinal = folio.horarios.length > 0
            ? folio.horarios.reduce((max, h) => h > max ? h : max, folio.horarios[0])
            : 'N/A';

        // FIX: Formatear fecha correctamente sin offset
        const fechaDisplay = formatDateForDisplay(folio.fecha);

        // Formatear destinos: si hay múltiples, mostrarlos de forma legible
        const destinosDisplay = folio.destinos || '<span class="empty-cell">N/A</span>';

        return `
            <tr class="folio-row-clickable" data-folio="${folio.folio}" style="cursor: pointer; transition: background-color 0.2s;" onmouseenter="this.style.backgroundColor='#fff5ed'" onmouseleave="this.style.backgroundColor=''">
                <td><span class="order-code">${makeCopyable(folio.folio)}</span></td>
                <td>${fechaDisplay}</td>
                <td>${destinosDisplay}</td>
                <td style="text-align: center;">${folio.totalCajas}</td>
                <td style="text-align: center;">${folio.ordenes.length}</td>
                <td>${horarioInicial}</td>
                <td>${horarioFinal}</td>
                <td>${folio.conductor || '<span class="empty-cell">N/A</span>'}</td>
                <td>${folio.unidad || '<span class="empty-cell">N/A</span>'}</td>
                <td onclick="event.stopPropagation()">
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button class="btn-action edit" onclick="event.stopPropagation(); openEditFolioModal('${folio.folio}')" title="Ajustar Folio">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-action print" onclick="event.stopPropagation(); printFolioDelivery('${folio.folio}')" title="Imprimir Folio de Entrega">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                        </button>
                        <button class="btn-action view" onclick="event.stopPropagation(); viewFolioOrders('${folio.folio}')" title="Ver Órdenes">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Actualizar indicadores de ordenamiento
    updateFoliosSortIndicators();
    
    // MEJORA: Añadir event listeners para click en filas
    setupFolioRowClickListeners();
}

/**
 * MEJORA: Configura listeners para click en filas de folios usando event delegation
 * Se llama solo una vez en DOMContentLoaded para evitar duplicados
 */
let folioRowListenerInitialized = false;

function setupFolioRowClickListeners() {
    // PREVENIR MÚLTIPLES LISTENERS: Solo inicializar una vez
    if (folioRowListenerInitialized) {
        return;
    }

    const foliosTableBody = document.getElementById('folios-table-body');
    if (!foliosTableBody) return;

    // Usar EVENT DELEGATION en lugar de listeners individuales
    foliosTableBody.addEventListener('click', (e) => {
        // Buscar la fila clickeable más cercana
        const row = e.target.closest('.folio-row-clickable');
        if (!row) return;

        // No hacer nada si el click fue en un botón o su contenedor
        if (e.target.closest('button') || e.target.closest('.btn-action')) {
            return;
        }

        const folio = row.getAttribute('data-folio');
        if (folio) {
            console.log(`📋 Click en fila de folio: ${folio}`);
            viewFolioOrders(folio);
        }
    });

    folioRowListenerInitialized = true;
    console.log('✅ Folio row click listener initialized (event delegation)');
}

/**
 * CHANGE 2: Actualiza los badges dinámicos de folios basados en datos visibles
 * FIXED: Count only VISIBLE rows when filters are active
 */
function updateFoliosBadges() {
    const tableBody = document.getElementById('folios-table-body');
    if (!tableBody) {
        console.warn('⚠️ folios-table-body no encontrado');
        return;
    }

    // Count visible rows (excluyendo empty state)
    const visibleRows = Array.from(tableBody.querySelectorAll('tr')).filter(row => {
        return row.style.display !== 'none' && !row.classList.contains('table-empty-state');
    });

    const totalFolios = visibleRows.length;
    let totalOrders = 0;
    let totalBoxes = 0;

    console.log('🔍 Folios - Total filas visibles:', totalFolios);

    visibleRows.forEach((row, index) => {
        // Get values from table cells
        // Column 2: Cant. Cajas, Column 3: Cant. Órdenes
        const cajasText = row.cells[2]?.textContent.trim() || '0';
        const ordenesText = row.cells[3]?.textContent.trim() || '0';

        if (index < 3) { // Log primeras 3 filas para debug
            console.log(`🔍 Fila ${index}:`, { cajas: cajasText, ordenes: ordenesText });
        }

        totalBoxes += parseInt(cajasText.replace(/[^\d]/g, '')) || 0;
        totalOrders += parseInt(ordenesText.replace(/[^\d]/g, '')) || 0;
    });

    console.log('🔍 Folios - Totales calculados:', { folios: totalFolios, ordenes: totalOrders, cajas: totalBoxes });

    const foliosCountEl = document.getElementById('folios-count');
    const ordersCountEl = document.getElementById('folios-orders-count');
    const boxesCountEl = document.getElementById('folios-boxes-count');

    if (foliosCountEl) {
        foliosCountEl.textContent = `${totalFolios} ${totalFolios === 1 ? 'folio' : 'folios'}`;
    }
    if (ordersCountEl) {
        ordersCountEl.textContent = `${totalOrders} ${totalOrders === 1 ? 'orden' : 'órdenes'}`;
    }
    if (boxesCountEl) {
        boxesCountEl.textContent = `${totalBoxes} ${totalBoxes === 1 ? 'caja' : 'cajas'}`;
    }
}

/**
 * Ordena la tabla de folios por columna
 */
function sortFoliosTable(columnIndex) {
    if (foliosSortColumn === columnIndex) {
        foliosSortDirection = foliosSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        foliosSortColumn = columnIndex;
        foliosSortDirection = 'asc';
    }

    renderFoliosTable();
}

/**
 * Actualiza los indicadores de ordenamiento en la tabla de folios
 */
function updateFoliosSortIndicators() {
    const table = document.getElementById('folios-table');
    if (!table) return;

    // Limpiar todos los indicadores
    table.querySelectorAll('th').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });

    // Agregar clase a la columna ordenada
    const ths = table.querySelectorAll('th');
    if (ths[foliosSortColumn]) {
        ths[foliosSortColumn].classList.add(foliosSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
}

/**
 * Filtra la tabla de folios
 */
function filterFoliosTable() {
    // CHANGE 5: Use advanced filters if active
    if (STATE.advancedFilters.folios.selectedValues.length > 0) {
        applyAdvancedFilters('folios');
        return;
    }

    const filterInput = document.getElementById('filter-folios');
    if (!filterInput) return;

    const filterValue = filterInput.value.toLowerCase().trim();
    const tableBody = document.getElementById('folios-table-body');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');

    // MEJORA: Búsqueda inteligente por contenido (OBC dentro del folio)
    if (filterValue.startsWith('obc') || filterValue.length >= 8) {
        console.log('🔍 [Filtro Inteligente] Buscando folio que contiene OBC:', filterValue);
        
        rows.forEach((row) => {
            const folioCell = row.cells[0];
            if (!folioCell) {
                row.style.display = 'none';
                return;
            }
            
            const folio = folioCell.textContent.trim();
            
            // Buscar si este folio contiene la OBC
            const ordenesEnFolio = STATE.localValidated.filter(record => 
                record.folio === folio && 
                record.orden && 
                record.orden.toLowerCase().includes(filterValue)
            );
            
            const isVisible = ordenesEnFolio.length > 0 || row.textContent.toLowerCase().includes(filterValue);
            row.style.display = isVisible ? '' : 'none';
            
            if (ordenesEnFolio.length > 0) {
                console.log(`✅ Folio ${folio} contiene ${ordenesEnFolio.length} orden(es) que coinciden`);
            }
        });
    } else {
        // Búsqueda tradicional por texto
        rows.forEach((row) => {
            const text = row.textContent.toLowerCase();
            const isVisible = text.includes(filterValue);
            row.style.display = isVisible ? '' : 'none';
        });
    }

    // Update badges based on visible rows
    updateFoliosBadges();
}

/**
 * Muestra el modal de filtro de fechas para folios (pestaña regular)
 * Este filtro usa FECHA DE ENTREGA de las órdenes
 */
function showFoliosDateFilter() {
    const modal = document.getElementById('folios-date-filter-modal');
    if (modal) {
        modal.style.display = 'flex';
        // Asegurar que NO está marcado como management
        delete modal.dataset.target;
        
        // Restaurar título del modal para pestaña regular
        const modalTitle = document.getElementById('folios-filter-modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Filtrar Folios por Fecha de Entrega';
        }

        // Establecer fecha máxima como hoy (no permitir fechas futuras)
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('folios-date-start').setAttribute('max', today);
        document.getElementById('folios-date-end').setAttribute('max', today);

        // Establecer valores actuales si existen
        if (FOLIOS_DATE_FILTER.startDate) {
            document.getElementById('folios-date-start').value = FOLIOS_DATE_FILTER.startDate;
        }
        if (FOLIOS_DATE_FILTER.endDate) {
            document.getElementById('folios-date-end').value = FOLIOS_DATE_FILTER.endDate;
        }
    }
}

/**
 * Cierra el modal de filtro de fechas para folios
 */
function closeFoliosDateFilter() {
    const modal = document.getElementById('folios-date-filter-modal');
    if (modal) {
        modal.style.display = 'none';
        // Limpiar el target para próxima apertura
        delete modal.dataset.target;
    }
}

/**
 * Aplica el filtro de fechas para folios
 * Maneja tanto la pestaña regular como la vista de gestión (sidebar)
 */
function applyFoliosDateFilter() {
    const startDate = document.getElementById('folios-date-start').value;
    const endDate = document.getElementById('folios-date-end').value;
    const modal = document.getElementById('folios-date-filter-modal');
    const isManagementView = modal?.dataset?.target === 'management';

    if (!startDate || !endDate) {
        showNotification('⚠️ Selecciona ambas fechas', 'warning');
        return;
    }
    
    // Validar que fecha inicio no sea mayor que fecha fin
    if (startDate > endDate) {
        showNotification('⚠️ La fecha de inicio no puede ser mayor que la fecha de fin', 'warning');
        return;
    }
    
    // Solo validar rango máximo de 7 días para pestaña regular (NO para gestión sidebar)
    if (!isManagementView) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays > 7) {
            showNotification('⚠️ El rango de fechas no puede ser mayor a 7 días', 'warning');
            return;
        }
    }

    if (isManagementView) {
        // Aplicar filtro para vista de Gestión de Folios (sidebar)
        FOLIOS_MGMT_DATE_FILTER.startDate = startDate;
        FOLIOS_MGMT_DATE_FILTER.endDate = endDate;
        FOLIOS_MGMT_DATE_FILTER.active = true;

        // Actualizar texto del botón de gestión
        const filterText = document.getElementById('folios-mgmt-date-filter-text');
        if (filterText) {
            filterText.textContent = `${formatDateForDisplay(startDate)} → ${formatDateForDisplay(endDate)}`;
        }

        // Cerrar modal y renderizar
        closeFoliosDateFilter();
        renderFoliosManagementTable();
        showNotification('✅ Filtro aplicado', 'success');
    } else {
        // Aplicar filtro para pestaña regular de Folios
        FOLIOS_DATE_FILTER.startDate = startDate;
        FOLIOS_DATE_FILTER.endDate = endDate;
        FOLIOS_DATE_FILTER.active = true;

        // Actualizar texto y estilo del botón
        const filterText = document.getElementById('folios-date-filter-text');
        const filterBtn = document.getElementById('folios-date-filter-display');
        if (filterText) {
            filterText.textContent = `${formatDateForDisplay(startDate)} → ${formatDateForDisplay(endDate)}`;
        }
        if (filterBtn) {
            filterBtn.classList.add('active-filter');
        }

        closeFoliosDateFilter();
        renderFoliosTable();
        showNotification('✅ Filtro aplicado', 'success');
    }
}

/**
 * Limpia el filtro de fechas para folios
 * Maneja tanto la pestaña regular como la vista de gestión (sidebar)
 */
function clearFoliosDateFilter() {
    const modal = document.getElementById('folios-date-filter-modal');
    const isManagementView = modal?.dataset?.target === 'management';
    
    // Limpiar inputs
    document.getElementById('folios-date-start').value = '';
    document.getElementById('folios-date-end').value = '';

    if (isManagementView) {
        // Limpiar filtro de vista de Gestión
        FOLIOS_MGMT_DATE_FILTER.startDate = null;
        FOLIOS_MGMT_DATE_FILTER.endDate = null;
        FOLIOS_MGMT_DATE_FILTER.active = false;

        // Restaurar texto del botón de gestión
        const filterText = document.getElementById('folios-mgmt-date-filter-text');
        if (filterText) {
            filterText.textContent = 'Mostrando Todo';
        }

        closeFoliosDateFilter();
        renderFoliosManagementTable();
        showNotification('✅ Filtro eliminado', 'success');
    } else {
        // Limpiar filtro de pestaña regular
        FOLIOS_DATE_FILTER.startDate = null;
        FOLIOS_DATE_FILTER.endDate = null;
        FOLIOS_DATE_FILTER.active = false;

        // Restaurar texto y estilo del botón
        const filterText = document.getElementById('folios-date-filter-text');
        const filterBtn = document.getElementById('folios-date-filter-display');
        if (filterText) {
            filterText.textContent = 'Mostrando Todo';
        }
        if (filterBtn) {
            filterBtn.classList.remove('active-filter');
        }

        closeFoliosDateFilter();
        renderFoliosTable();
        showNotification('✅ Filtro eliminado', 'success');
    }
}

/**
 * Confirma la salida del panel de folios
 */
function confirmExitFolios() {
    // Limpiar el flag de "viene desde folios"
    STATE.fromFolios = false;

    // Re-habilitar el botón Pendientes si estaba deshabilitado
    const togglePendingValidated = document.getElementById('toggle-pending-validated');
    if (togglePendingValidated) {
        togglePendingValidated.disabled = false;
        togglePendingValidated.style.opacity = '1';
        togglePendingValidated.style.cursor = 'pointer';
        togglePendingValidated.title = '';
    }

    document.getElementById('folios-content').style.display = 'none';
    document.getElementById('welcome-state').style.display = 'flex';
}

// ==================== VISTA INDEPENDIENTE: GESTIÓN DE FOLIOS (SIDEBAR) ====================

/**
 * Muestra la vista independiente de Gestión de Folios (acceso desde sidebar)
 * Esta vista NO tiene navegación de pestañas y muestra TODOS los folios por defecto
 */
async function showFoliosManagementView() {
    console.log('📋 Abriendo vista independiente de Gestión de Folios');
    
    isInFoliosManagementView = true;
    
    // Ocultar navegación global (esta vista es independiente)
    const globalNav = document.getElementById('global-nav-header');
    if (globalNav) globalNav.style.display = 'none';
    
    // Ocultar todos los demás paneles usando la función centralizada
    hideAllContentPanels();
    // Mostrar solo folios-management-content
    showContentPanel('folios-management-content');
    
    // Mostrar estado de carga inicial
    const tableBody = document.getElementById('folios-mgmt-table-body');
    if (tableBody) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="table-empty-state">
                    <div class="table-empty-icon">⏳</div>
                    <div class="table-empty-text">Cargando folios...</div>
                    <div class="table-empty-subtext">Descargando historial desde la base de datos</div>
                </td>
            </tr>
        `;
    }
    
    // OPTIMIZACIÓN: Cargar folios de forma asíncrona con baja prioridad
    // No bloquear la UI mientras se carga el historial completo
    setTimeout(async () => {
        try {
            await loadAllFoliosForManagement();
            renderFoliosManagementTable();
        } catch (error) {
            console.error('❌ Error cargando folios:', error);
            if (tableBody) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="9" class="table-empty-state">
                            <div class="table-empty-icon">⚠️</div>
                            <div class="table-empty-text">Error cargando folios</div>
                            <div class="table-empty-subtext">${error.message}</div>
                        </td>
                    </tr>
                `;
            }
        }
    }, 100); // Pequeño delay para no bloquear el hilo principal
}

/**
 * Cierra la vista de Gestión de Folios y regresa al welcome
 */
function closeFoliosManagementView() {
    isInFoliosManagementView = false;
    
    // Ocultar vista de gestión
    const foliosMgmtContent = document.getElementById('folios-management-content');
    if (foliosMgmtContent) {
        foliosMgmtContent.style.display = 'none';
    }
    
    // Mostrar welcome
    document.getElementById('welcome-state').style.display = 'flex';
    
    // Restaurar navegación global
    const globalNav = document.getElementById('global-nav-header');
    if (globalNav) globalNav.style.display = 'flex';
}

/**
 * Carga todos los folios para la vista de gestión (sin filtro de fecha por defecto)
 * SIEMPRE carga desde BD de escritura para tener datos actualizados
 */
async function loadAllFoliosForManagement() {
    try {
        console.log('📥 Cargando todos los registros validados para Gestión de Folios...');
        
        // Verificar si Google Sheets API está disponible
        if (!gapi?.client?.sheets) {
            console.warn('⚠️ Google Sheets API no disponible, intentando inicializar...');
            
            // Intentar esperar a que se inicialice
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (!gapi?.client?.sheets) {
                showNotification('⚠️ Inicia sesión para ver los folios', 'warning');
                return;
            }
        }
        
        showNotification('🔄 Cargando historial de folios...', 'info');
        
        // Siempre cargar desde BD de escritura para tener datos actualizados
        const records = await fetchValidatedRecordsFromWriteDB();
        
        console.log(`📊 fetchValidatedRecordsFromWriteDB retornó ${records ? records.length : 0} registros`);
        
        // Actualizar STATE.localValidated con los registros cargados
        if (records && records.length > 0) {
            STATE.localValidated = records;
            // Reconstruir folios desde los registros
            rebuildFoliosFromRecords(records);
            console.log(`✅ Cargados ${STATE.localValidated.length} registros validados`);
            showNotification(`✅ ${STATE.localValidated.length} registros cargados`, 'success');
        } else {
            console.log('ℹ️ No se encontraron registros en la BD de escritura');
            showNotification('ℹ️ No hay folios registrados aún', 'info');
        }
        
    } catch (error) {
        console.error('Error loading folios for management:', error);
        showNotification('⚠️ Error al cargar folios: ' + (error.message || 'Error desconocido'), 'warning');
    }
}

/**
 * Renderiza la tabla de Gestión de Folios (vista independiente)
 */
function renderFoliosManagementTable() {
    const tableBody = document.getElementById('folios-mgmt-table-body');
    if (!tableBody) return;

    // Mostrar indicador de carga inicial
    tableBody.innerHTML = `
        <tr>
            <td colspan="9" class="table-empty-state">
                <div class="table-empty-icon">⏳</div>
                <div class="table-empty-text">Cargando folios...</div>
            </td>
        </tr>
    `;

    // Usar setTimeout para permitir que el UI se actualice
    setTimeout(() => {
        let folios = getAllFolios();

    // Aplicar filtro de fecha SOLO si está activo (por defecto NO está activo)
    if (FOLIOS_MGMT_DATE_FILTER.active && FOLIOS_MGMT_DATE_FILTER.startDate && FOLIOS_MGMT_DATE_FILTER.endDate) {
        // FIX: Usar parse local para evitar -1 día
        const startDate = parseDateLocal(FOLIOS_MGMT_DATE_FILTER.startDate);
        const endDate = parseDateLocal(FOLIOS_MGMT_DATE_FILTER.endDate);
        endDate.setHours(23, 59, 59, 999);

        folios = folios.filter(folio => {
            const folioDate = parseDateLocal(folio.fecha);
            return folioDate >= startDate && folioDate <= endDate;
        });
    }

    // Ordenar folios
    folios.sort((a, b) => {
        let valA, valB;

        switch(foliosMgmtSortColumn) {
            case 0: valA = a.folio; valB = b.folio; break;
            case 1: valA = a.fecha; valB = b.fecha; break;
            case 2: valA = a.destinos || ''; valB = b.destinos || ''; break;
            case 3: valA = a.totalCajas; valB = b.totalCajas; break;
            case 4: valA = a.ordenes.length; valB = b.ordenes.length; break;
            case 5:
                valA = a.horarios.length > 0 ? Math.min(...a.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                valB = b.horarios.length > 0 ? Math.min(...b.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                break;
            case 6:
                valA = a.horarios.length > 0 ? Math.max(...a.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                valB = b.horarios.length > 0 ? Math.max(...b.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                break;
            case 7: valA = a.conductor || ''; valB = b.conductor || ''; break;
            case 8: valA = a.unidad || ''; valB = b.unidad || ''; break;
            default: valA = a.fecha; valB = b.fecha;
        }

        if (foliosMgmtSortDirection === 'asc') {
            return valA > valB ? 1 : -1;
        } else {
            return valA < valB ? 1 : -1;
        }
    });

    // Actualizar badges
    updateFoliosManagementBadges(folios);

    if (folios.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="table-empty-state">
                    <div class="table-empty-icon">📋</div>
                    <div class="table-empty-text">No hay folios de carga</div>
                    <div class="table-empty-subtext">Los folios generados aparecerán aquí</div>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = folios.map(folio => {
        const horarioInicial = folio.horarios.length > 0
            ? folio.horarios.reduce((min, h) => h < min ? h : min, folio.horarios[0])
            : 'N/A';
        const horarioFinal = folio.horarios.length > 0
            ? folio.horarios.reduce((max, h) => h > max ? h : max, folio.horarios[0])
            : 'N/A';

        const fechaDisplay = formatDateForDisplay(folio.fecha);

        // Formatear destinos: si hay múltiples, mostrarlos de forma legible
        const destinosDisplay = folio.destinos || '<span class="empty-cell">N/A</span>';

        return `
            <tr class="folio-row-clickable" data-folio="${folio.folio}" style="cursor: pointer; transition: background-color 0.2s;" onmouseenter="this.style.backgroundColor='#fff5ed'" onmouseleave="this.style.backgroundColor=''">
                <td><span class="order-code">${makeCopyable(folio.folio)}</span></td>
                <td>${fechaDisplay}</td>
                <td>${destinosDisplay}</td>
                <td style="text-align: center;">${folio.totalCajas}</td>
                <td style="text-align: center;">${folio.ordenes.length}</td>
                <td>${horarioInicial}</td>
                <td>${horarioFinal}</td>
                <td>${folio.conductor || '<span class="empty-cell">N/A</span>'}</td>
                <td>${folio.unidad || '<span class="empty-cell">N/A</span>'}</td>
                <td onclick="event.stopPropagation()">
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button class="btn-action edit" onclick="event.stopPropagation(); openEditFolioModal('${folio.folio}')" title="Ajustar Folio">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-action print" onclick="event.stopPropagation(); printFolioDelivery('${folio.folio}')" title="Imprimir Folio de Entrega">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                        </button>
                        <button class="btn-action view" onclick="event.stopPropagation(); viewFolioOrdersFromManagement('${folio.folio}')" title="Ver Órdenes">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    
    // MEJORA: Añadir event listeners para click en filas de gestión de folios
    setupFolioRowClickListeners();
    }, 0); // Close setTimeout
}

/**
 * Ver órdenes de un folio desde la vista de gestión
 */
function viewFolioOrdersFromManagement(folioCompleto) {
    // Guardar que venimos de la vista de gestión
    STATE.fromFoliosManagement = true;
    viewFolioOrders(folioCompleto);
}

/**
 * Actualiza los badges de la vista de Gestión de Folios
 */
function updateFoliosManagementBadges(folios) {
    let totalOrders = 0;
    let totalBoxes = 0;

    folios.forEach(folio => {
        totalOrders += folio.ordenes.length;
        totalBoxes += folio.totalCajas;
    });

    const foliosCountEl = document.getElementById('folios-mgmt-count');
    const ordersCountEl = document.getElementById('folios-mgmt-orders-count');
    const boxesCountEl = document.getElementById('folios-mgmt-boxes-count');

    if (foliosCountEl) foliosCountEl.textContent = `${folios.length} ${folios.length === 1 ? 'folio' : 'folios'}`;
    if (ordersCountEl) ordersCountEl.textContent = `${totalOrders} ${totalOrders === 1 ? 'orden' : 'órdenes'}`;
    if (boxesCountEl) boxesCountEl.textContent = `${totalBoxes} ${totalBoxes === 1 ? 'caja' : 'cajas'}`;
}

/**
 * Ordenar tabla de Gestión de Folios
 */
function sortFoliosManagementTable(columnIndex) {
    if (foliosMgmtSortColumn === columnIndex) {
        foliosMgmtSortDirection = foliosMgmtSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        foliosMgmtSortColumn = columnIndex;
        foliosMgmtSortDirection = 'asc';
    }
    renderFoliosManagementTable();
}

/**
 * Filtrar tabla de Gestión de Folios por texto
 * MEJORA: Búsqueda inteligente por contenido (OBC dentro del folio)
 */
function filterFoliosManagementTable() {
    const filterText = document.getElementById('filter-folios-mgmt')?.value.toLowerCase().trim() || '';
    const rows = document.querySelectorAll('#folios-mgmt-table-body tr');

    if (!filterText) {
        rows.forEach(row => row.style.display = '');
        return;
    }

    // MEJORA: Búsqueda inteligente por contenido (OBC dentro del folio)
    if (filterText.startsWith('obc') || filterText.length >= 8) {
        console.log('🔍 [Filtro Inteligente Mgmt] Buscando folio que contiene OBC:', filterText);
        
        rows.forEach(row => {
            const folioCell = row.cells[0];
            if (!folioCell) {
                row.style.display = 'none';
                return;
            }
            
            const folio = folioCell.textContent.trim();
            
            // Buscar si este folio contiene la OBC
            const ordenesEnFolio = STATE.localValidated.filter(record => 
                record.folio === folio && 
                record.orden && 
                record.orden.toLowerCase().includes(filterText)
            );
            
            const isVisible = ordenesEnFolio.length > 0 || row.textContent.toLowerCase().includes(filterText);
            row.style.display = isVisible ? '' : 'none';
            
            if (ordenesEnFolio.length > 0) {
                console.log(`✅ Folio ${folio} contiene ${ordenesEnFolio.length} orden(es) que coinciden`);
            }
        });
    } else {
        // Búsqueda tradicional por texto
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filterText) ? '' : 'none';
        });
    }
}

/**
 * Mostrar filtro de fecha para Gestión de Folios
 * Este filtro usa FECHA DE CREACIÓN DEL FOLIO (no fecha de entrega)
 */
function showFoliosManagementDateFilter() {
    const modal = document.getElementById('folios-date-filter-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.dataset.target = 'management'; // Marcar que es para gestión
        
        // Cambiar título del modal para indicar que filtra por fecha de creación
        const modalTitle = document.getElementById('folios-filter-modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Filtro por Fecha de Creación';
        }
    }
}

// ==================== FIX: FUNCIONES DE FECHA SIN OFFSET ====================

/**
 * Parsea una fecha en formato YYYY-MM-DD como fecha local (sin timezone offset)
 * @param {string} dateStr - Fecha en formato YYYY-MM-DD
 * @returns {Date} Fecha parseada como local
 */
function parseDateLocal(dateStr) {
    if (!dateStr) return new Date();
    
    // Si ya es un objeto Date, retornarlo
    if (dateStr instanceof Date) return dateStr;
    
    // Formato YYYY-MM-DD
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    
    // Formato DD/MM/YYYY
    const partsSlash = dateStr.split('/');
    if (partsSlash.length === 3) {
        return new Date(parseInt(partsSlash[2]), parseInt(partsSlash[1]) - 1, parseInt(partsSlash[0]));
    }
    
    return new Date(dateStr);
}

/**
 * Formatea una fecha para mostrar en la UI (DD/MM/YYYY)
 * @param {string} dateStr - Fecha en formato YYYY-MM-DD
 * @returns {string} Fecha formateada DD/MM/YYYY
 */
function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    
    const date = parseDateLocal(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
}

/**
 * Filtra las órdenes validadas por folio de carga
 */
function viewFolioOrders(folioCompleto) {
    // Set current folio
    STATE.currentFolio = folioCompleto;

    // Hide all other panels
    document.getElementById('welcome-state').style.display = 'none';
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('validated-content').style.display = 'none';
    document.getElementById('folios-content').style.display = 'none';
    
    // También ocultar vista de gestión de folios si está visible
    const foliosMgmtContent = document.getElementById('folios-management-content');
    if (foliosMgmtContent) foliosMgmtContent.style.display = 'none';
    
    document.getElementById('folio-details-content').style.display = 'block';

    // Update title with folio number
    const titleElement = document.getElementById('folio-details-title');
    if (titleElement) {
        titleElement.textContent = `📋 Detalle de Folio ${folioCompleto}`;
    }

    // Clear filters
    STATE.advancedFilters['folio-details'].selectedValues = [];
    STATE.advancedFilters['folio-details'].criterion = '';
    const filterInput = document.getElementById('filter-folio-details');
    if (filterInput) {
        filterInput.value = '';
    }

    // Render table with orders from this folio
    renderFolioDetailsTable(folioCompleto);

    showNotification(`📋 Mostrando órdenes del folio ${folioCompleto}`, 'info');
}

/**
 * Close folio details and return to appropriate folios screen
 */
function closeFolioDetails() {
    STATE.currentFolio = null;
    
    // Si venimos de la vista de gestión independiente, regresar ahí
    if (STATE.fromFoliosManagement) {
        STATE.fromFoliosManagement = false;
        document.getElementById('folio-details-content').style.display = 'none';
        showFoliosManagementView();
    } else {
        // Regresar a la pestaña regular de folios
        showFoliosManagement();
    }
}

/**
 * Confirm exit from folio details
 */
function confirmExitFolioDetails() {
    STATE.currentFolio = null;
    confirmExit();
}

/**
 * Render the table for folio details screen
 */
function renderFolioDetailsTable(folioCompleto) {
    const tableBody = document.getElementById('folio-details-table-body');
    if (!tableBody) return;

    // Get orders for this folio
    const ordenesDelFolio = STATE.localValidated.filter(record => record.folio === folioCompleto);

    if (ordenesDelFolio.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="13" class="table-empty-state"><div class="table-empty-icon">📋</div><div class="table-empty-text">No hay órdenes en este folio</div></td></tr>';
        updateFolioDetailsBadges(0, 0);
        return;
    }

    let totalCajasDespachar = 0;

    tableBody.innerHTML = ordenesDelFolio.map((record, index) => {
        const orderData = STATE.obcData.get(record.orden) || {};
        
        // Get reference and tracking codes
        const referencia = orderData.referenceNo || record.codigo || 'N/A';
        const tracking = orderData.trackingCode || record.track || 'N/A';

        const destino = record.destino || orderData.recipient || 'N/A';
        const horario = record.horario || orderData.expectedArrival || 'N/A';
        // IMPORTANTE: Usar cantDespacho (Columna N) como prioridad
        const cantDespachar = record.cantDespacho || record.cantidadDespachar || 0;
        totalCajasDespachar += cantDespachar;
        
        // Debug para primeros 5 registros
        if (index < 5) {
            console.log(`🎨 RENDER folio details row ${index}:`, {
                orden: record.orden,
                'cantDespacho (N)': record.cantDespacho,
                'cantidadDespachar (alias)': record.cantidadDespachar,
                'VALOR USADO': cantDespachar,
                operador: record.operador,
                unidad: record.unidad
            });
        }
        
        const estatus = record.estatus || 'Pendiente';
        const calidad = record.calidad || 'N/A';
        const conductor = record.conductor || record.operador || 'N/A';
        const unidad = record.unidad || 'N/A';
        // Use timestamp for full date/time, or fall back to fecha+hora fields
        const fechaValidacion = record.timestamp ? formatValidationDateTime(record.timestamp) :
                                (record.fecha && record.hora ? `${record.fecha} ${record.hora}` : 'N/A');

        return `
            <tr class="validated-row" data-orden="${record.orden}">
                <td><strong>${record.orden}</strong></td>
                <td>${fechaValidacion}</td>
                <td>${destino}</td>
                <td>${horario}</td>
                <td>${referencia}</td>
                <td>${tracking}</td>
                <td style="text-align: center;"><strong>${cantDespachar}</strong></td>
                <td>
                    <span class="status-badge ${estatus === 'Completo' ? 'validated' : 'pending'}">${estatus}</span>
                </td>
                <td>${calidad}</td>
                <td>${conductor}</td>
                <td>${unidad}</td>
                <td class="actions-cell">
                    <div class="actions-buttons">
                        <button class="btn-action dispatch" onclick="showValidatedDetails('${record.orden}')" title="Ver detalles">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="m21 21-4.35-4.35"></path>
                            </svg>
                        </button>
                        <button class="btn-delete-validated" onclick="confirmDeleteValidated('${record.orden}')" title="Eliminar y mover a pendientes">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Update badges with Cantidad a Despachar
    updateFolioDetailsBadges(ordenesDelFolio.length, totalCajasDespachar);
}

/**
 * Update badges for folio details screen
 */
function updateFolioDetailsBadges(ordersCount, boxesCount) {
    const ordersCountEl = document.getElementById('folio-details-orders-count');
    const boxesCountEl = document.getElementById('folio-details-boxes-count');

    if (ordersCountEl) {
        ordersCountEl.textContent = `${ordersCount} orden${ordersCount !== 1 ? 'es' : ''}`;
    }

    if (boxesCountEl) {
        boxesCountEl.textContent = `${boxesCount} caja${boxesCount !== 1 ? 's' : ''}`;
    }
}

/**
 * Filter folio details table
 */
function filterFolioDetailsTable() {
    applyAdvancedFilters('folio-details');
}

/**
 * Sort folio details table
 */
let folioDetailsSortColumn = 0;
let folioDetailsSortDirection = 'asc';

function sortFolioDetailsTable(columnIndex) {
    const tbody = document.getElementById('folio-details-table-body');
    const rows = Array.from(tbody.querySelectorAll('tr'));

    // Toggle sort direction
    if (folioDetailsSortColumn === columnIndex) {
        folioDetailsSortDirection = folioDetailsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        folioDetailsSortColumn = columnIndex;
        folioDetailsSortDirection = 'asc';
    }

    // Sort rows
    rows.sort((a, b) => {
        let aVal = a.cells[columnIndex]?.textContent.trim() || '';
        let bVal = b.cells[columnIndex]?.textContent.trim() || '';

        // Try to parse as numbers
        const aNum = parseFloat(aVal.replace(/[^\d.-]/g, ''));
        const bNum = parseFloat(bVal.replace(/[^\d.-]/g, ''));

        if (!isNaN(aNum) && !isNaN(bNum)) {
            return folioDetailsSortDirection === 'asc' ? aNum - bNum : bNum - aNum;
        }

        // String comparison
        return folioDetailsSortDirection === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
    });

    // Re-append sorted rows
    rows.forEach(row => tbody.appendChild(row));

    // Update sort indicators
    updateFolioDetailsSortIndicators();
}

/**
 * Update sort indicators for folio details table
 */
function updateFolioDetailsSortIndicators() {
    const headers = document.querySelectorAll('#folio-details-table th');
    headers.forEach((header, index) => {
        header.classList.remove('sorted-asc', 'sorted-desc');
        if (index === folioDetailsSortColumn) {
            header.classList.add(folioDetailsSortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });
}

/**
 * Imprime el folio de entrega (PDF)
 */
function printFolioDelivery(folioCompleto) {
    // ==================== PRE-VALIDATION: INTEGRITY CHECK ====================
    // Ensure header counts match body rows before printing
    
    // Obtener todas las órdenes del folio desde la base de datos sincronizada
    const ordenesDelFolio = STATE.localValidated.filter(record => record.folio === folioCompleto);

    if (ordenesDelFolio.length === 0) {
        showNotification('⚠️ No hay órdenes en este folio', 'warning');
        return;
    }

    // Obtener información consolidada del folio
    const primeraOrden = ordenesDelFolio[0];
    const conductor = primeraOrden.operador || primeraOrden.conductor || 'N/A';
    const unidad = primeraOrden.unidad || 'N/A';

    // Obtener horarios
    const horarios = ordenesDelFolio
        .map(o => o.horario)
        .filter(h => h && h !== 'N/A');

    const horarioInicial = horarios.length > 0
        ? horarios.reduce((min, h) => h < min ? h : min, horarios[0])
        : 'N/A';
    const horarioFinal = horarios.length > 0
        ? horarios.reduce((max, h) => h > max ? h : max, horarios[0])
        : 'N/A';

    // Obtener destinos únicos
    const destinosUnicos = [...new Set(ordenesDelFolio.map(o => o.destino || o.recipient || 'N/A'))];
    const destino = destinosUnicos.length === 1 ? destinosUnicos[0] : 'Múltiples destinos';

    // Consolidar cajas por código base
    const cajasMap = new Map(); // código base → { destino, orden, cantidad }
    const ordenesDetailList = []; // Lista de órdenes para el cuerpo de la tabla

    ordenesDelFolio.forEach(record => {
        const orderData = STATE.obcData.get(record.orden) || {};
        const validaciones = STATE.validacionData.get(record.orden) || [];
        const destinoOrden = record.destino || orderData.recipient || 'N/A';

        // Agregar orden al detalle (para contar filas reales)
        ordenesDetailList.push({
            orden: record.orden,
            destino: destinoOrden,
            horario: record.horario || orderData.expectedArrival || 'N/A',
            referencia: orderData.referenceNo || record.codigo || 'N/A',
            tracking: orderData.trackingCode || record.track || 'N/A',
            cantidadDespachar: record.cantDespacho || record.cantidadDespachar || 0  // Prioridad: Columna N
        });

        // Procesar cada caja validada
        validaciones.forEach(caja => {
            const codigoCompleto = caja.codigo || '';
            // Extraer código base (sin número de caja después de /)
            const codigoBase = codigoCompleto.split('/')[0];

            const key = `${record.orden}-${codigoBase}`;

            if (!cajasMap.has(key)) {
                cajasMap.set(key, {
                    destino: destinoOrden,
                    orden: record.orden,
                    codigoBase: codigoBase,
                    cantidad: 0
                });
            }

            cajasMap.get(key).cantidad++;
        });
    });

    const cajasList = Array.from(cajasMap.values());
    
    // ==================== CRITICAL VALIDATION ====================
    // The header must derive counts from actual body rows
    const totalOrdenesFromBody = ordenesDetailList.length; // Actual rows in table
    const totalCajasFromBody = ordenesDetailList.reduce((sum, item) => sum + item.cantidadDespachar, 0);
    
    // Use body counts for header (NOT from filter count)
    const totalOrdenes = totalOrdenesFromBody;
    const totalCajas = totalCajasFromBody;

    // Validation: Ensure header matches body
    if (totalOrdenes !== ordenesDelFolio.length) {
        console.warn('⚠️ Discrepancia detectada: órdenes en header vs body');
    }
    
    console.log('📋 Pre-validación de impresión:', {
        folioCompleto,
        ordenesEnFiltro: ordenesDelFolio.length,
        ordenesEnBody: totalOrdenesFromBody,
        cajasCalculadas: totalCajasFromBody,
        validacionPasada: totalOrdenes === totalOrdenesFromBody
    });

    // ==================== GENERATE PRINT HTML ====================
    // Header counts are now guaranteed to match body rows
    const printHTML = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Folio de Entrega - ${folioCompleto}</title>
            <style>
                @page {
                    size: letter;
                    margin: 15mm;
                }

                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    font-size: 10pt;
                    line-height: 1.3;
                    color: #334155;
                    background: white;
                }

                /* Eco-friendly header with pastel orange */
                .header {
                    border: 1px solid #fed7aa;
                    margin-bottom: 12px;
                    padding: 0;
                    page-break-inside: avoid;
                }

                .header-row {
                    display: flex;
                    border-bottom: 1px solid #fed7aa;
                    line-height: 1.2;
                }

                .header-row:last-child {
                    border-bottom: none;
                }

                .header-cell {
                    padding: 5px 8px;
                    border-right: 1px solid #fed7aa;
                    flex: 1;
                    display: flex;
                    align-items: center;
                }

                .header-cell:last-child {
                    border-right: none;
                }

                .header-label {
                    font-weight: 600;
                    color: #78716c;
                    font-size: 8.5pt;
                    margin-right: 4px;
                }

                .header-value {
                    color: #292524;
                    font-weight: 600;
                    font-size: 9pt;
                }

                .header-title {
                    background: #ffedd5;
                    color: #9a3412;
                    padding: 6px;
                    text-align: center;
                    font-weight: 700;
                    font-size: 10pt;
                    letter-spacing: 0.5px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                    border: 1px solid #fed7aa;
                }

                thead {
                    display: table-header-group;
                }

                tbody {
                    display: table-row-group;
                }

                th {
                    background: #fff7ed;
                    color: #78716c;
                    padding: 6px 5px;
                    text-align: left;
                    font-size: 8.5pt;
                    font-weight: 600;
                    border-bottom: 1px solid #fed7aa;
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                }

                td {
                    padding: 5px;
                    border-bottom: 1px solid #fef3c7;
                    font-size: 9pt;
                    color: #292524;
                }

                tbody tr:nth-child(even) {
                    background: #fffbeb;
                }

                tbody tr:hover {
                    background: #fef3c7;
                }

                .codigo-base {
                    font-family: 'Arial', 'Helvetica', sans-serif;
                    background: transparent;
                    padding: 2px 4px;
                    border-radius: 2px;
                    font-weight: 500;
                    color: #292524;
                }

                .table-footer {
                    margin-top: 15px;
                    padding-top: 10px;
                    border-top: 1px solid #fed7aa;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .footer-info {
                    font-size: 8pt;
                    color: #78716c;
                }

                @media print {
                    body {
                        print-color-adjust: exact;
                        -webkit-print-color-adjust: exact;
                    }

                    /* Eco-friendly: pastel colors optimized for B&W printing */
                    .header-title {
                        background: #ffedd5 !important;
                        color: #9a3412 !important;
                    }

                    th {
                        background: #fff7ed !important;
                        color: #78716c !important;
                    }

                    tbody tr:nth-child(even) {
                        background: #fffbeb !important;
                    }

                    .codigo-base {
                        background: #fed7aa !important;
                        color: #9a3412 !important;
                    }

                    /* Minimize borders for toner savings */
                    .header,
                    table,
                    th,
                    td {
                        border-color: #fed7aa !important;
                    }

                    /* Repeat header on each page */
                    thead {
                        display: table-header-group;
                    }

                    tbody {
                        display: table-row-group;
                    }

                    tr {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <!-- FIXED: Compact repeatable header with folio inside -->
            <div class="header">
                <div class="header-title">FOLIO DE ENTREGA</div>
                <div class="header-row">
                    <div class="header-cell">
                        <span class="header-label">Folio:</span>
                        <span class="header-value">${folioCompleto}</span>
                    </div>
                    <div class="header-cell">
                        <span class="header-label">Conductor:</span>
                        <span class="header-value">${conductor}</span>
                    </div>
                    <div class="header-cell">
                        <span class="header-label">Unidad:</span>
                        <span class="header-value">${unidad}</span>
                    </div>
                </div>
                <div class="header-row">
                    <div class="header-cell">
                        <span class="header-label">Horario:</span>
                        <span class="header-value">${horarioInicial} - ${horarioFinal}</span>
                    </div>
                    <div class="header-cell">
                        <span class="header-label">Total:</span>
                        <span class="header-value">${totalOrdenes} órdenes / ${totalCajas} cajas</span>
                    </div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 35px;">#</th>
                        <th>Destino</th>
                        <th>Orden</th>
                        <th>Horario</th>
                        <th>Referencia</th>
                        <th>Tracking</th>
                        <th style="width: 80px; text-align: center;">Cant. Despachar</th>
                    </tr>
                </thead>
                <tbody>
                    ${ordenesDetailList.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${item.destino || 'N/A'}</td>
                            <td><strong>${item.orden || 'N/A'}</strong></td>
                            <td>${item.horario || 'N/A'}</td>
                            <td><span class="codigo-base">${item.referencia || 'N/A'}</span></td>
                            <td><span class="codigo-base">${item.tracking || 'N/A'}</span></td>
                            <td style="text-align: center;"><strong>${item.cantidadDespachar || 0}</strong></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="table-footer">
                <div class="footer-info">
                    📅 Generado el ${new Date().toLocaleString('es-MX')}
                </div>
                <div class="footer-info">
                    Sistema de Despacho WMS
                </div>
            </div>

            <script>
                // Auto-imprimir cuando se carga la página
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 250);
                };
            </script>
        </body>
        </html>
    `;

    // Crear un iframe oculto para la impresión
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.style.opacity = '0';
    printFrame.style.pointerEvents = 'none';
    document.body.appendChild(printFrame);

    // Escribir el HTML al iframe
    const printDoc = printFrame.contentWindow.document;
    printDoc.open();
    printDoc.write(printHTML);
    printDoc.close();

    // Remover el iframe después de imprimir
    printFrame.contentWindow.onafterprint = function() {
        setTimeout(() => {
            document.body.removeChild(printFrame);
        }, 100);
    };

    showNotification('🖨️ Preparando impresión...', 'info');
}

// ==================== FOLIO DETAILS ACTIONS ====================
/**
 * Print current folio details
 */
function printFolioDetails() {
    if (!STATE.currentFolio) {
        showNotification('⚠️ No hay folio seleccionado', 'warning');
        return;
    }
    printFolioDelivery(STATE.currentFolio);
}

/**
 * Export current folio details to Excel
 */
function exportFolioDetailsToExcel() {
    if (!STATE.currentFolio) {
        showNotification('⚠️ No hay folio seleccionado', 'warning');
        return;
    }

    const ordenesDelFolio = STATE.localValidated.filter(record => record.folio === STATE.currentFolio);

    if (ordenesDelFolio.length === 0) {
        showNotification('⚠️ No hay órdenes en este folio', 'warning');
        return;
    }

    // Prepare data for export
    const exportData = [];

    ordenesDelFolio.forEach(record => {
        const orderData = STATE.obcData.get(record.orden) || {};
        const validaciones = STATE.validacionData.get(record.orden) || [];

        exportData.push({
            'Folio': STATE.currentFolio,
            'N° Orden': record.orden,
            'Fecha Validación': record.timestamp ? new Date(record.timestamp).toLocaleString('es-MX') : `${record.fecha || ''} ${record.hora || ''}`,
            'Destino': record.destino || orderData.recipient || 'N/A',
            'Horario': record.horario || orderData.expectedArrival || 'N/A',
            'Cant. Cajas': validaciones.length,
            'Cant. Despachar': record.cantidadDespachar || 0,
            'Estatus': record.estatus || 'Pendiente',
            'Calidad': record.calidad || 'N/A',
            'Conductor': record.operador || record.conductor || 'N/A',
            'Unidad': record.unidad || 'N/A',
            'Observaciones': record.observaciones || record.notaDespacho || ''
        });
    });

    // Convert to CSV
    const headers = Object.keys(exportData[0]);
    const csvContent = [
        headers.join(','),
        ...exportData.map(row => headers.map(header => {
            const value = row[header] || '';
            // Escape commas and quotes
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');

    // Create download link
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Folio_${STATE.currentFolio}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showNotification(`✅ Folio ${STATE.currentFolio} exportado exitosamente`, 'success');
}

// ==================== VISTA AGENDA ====================

/**
 * Initialize Vista Agenda state
 */
if (!STATE.vistaAgenda) {
    STATE.vistaAgenda = {
        activa: false,
        fechaHeredada: null,
        filtrosHeredados: {},
        datosOriginales: null,
        datosAgrupados: null,
        filtrosLocales: {
            destino: null,
            estatus: null,
            busqueda: ""
        }
    };

    // Initialize advanced filters for agenda
    STATE.advancedFilters.agenda = {
        criterion: '',
        selectedValues: []
    };
}

/**
 * Open Vista Agenda - inherits current date filter from Órdenes Pendientes
 */
function openVistaAgenda() {
    // Capture current state
    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;

    if (dataToUse.size === 0) {
        showNotification('⚠️ No hay órdenes para mostrar en la agenda', 'warning');
        return;
    }

    // Save inherited state
    STATE.vistaAgenda.fechaHeredada = STATE.dateFilter.active ? {
        startDate: STATE.dateFilter.startDate,
        endDate: STATE.dateFilter.endDate,
        formatted: formatDateRangeForAgenda(STATE.dateFilter.startDate, STATE.dateFilter.endDate)
    } : {
        formatted: 'Todas las órdenes'
    };

    // Copy data (don't modify original)
    STATE.vistaAgenda.datosOriginales = Array.from(dataToUse.entries());

    // Mark as active
    STATE.vistaAgenda.activa = true;

    // Hide other panels and show Vista Agenda
    document.getElementById('welcome-state').style.display = 'none';
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('validated-content').style.display = 'none';
    document.getElementById('folio-details-content').style.display = 'none';
    document.getElementById('folios-content').style.display = 'none';
    document.getElementById('vista-agenda-content').style.display = 'block';

    // Scroll to top
    window.scrollTo(0, 0);

    // Update date display
    document.getElementById('agenda-fecha-display').textContent = STATE.vistaAgenda.fechaHeredada.formatted;

    // Generate and render grouped data
    renderVistaAgenda();

    showNotification('📅 Vista Agenda cargada correctamente', 'success');
}

/**
 * Close Vista Agenda and return to Órdenes Pendientes
 */
function closeVistaAgenda() {
    STATE.vistaAgenda.activa = false;

    // Show search panel (Órdenes Pendientes)
    document.getElementById('vista-agenda-content').style.display = 'none';
    document.getElementById('search-panel').style.display = 'block';

    // Clear local filters
    STATE.vistaAgenda.filtrosLocales = {
        destino: null,
        estatus: null,
        busqueda: ""
    };

    // Clear advanced filters
    STATE.advancedFilters.agenda.selectedValues = [];
    STATE.advancedFilters.agenda.criterion = '';

    // Clear search input
    const searchInput = document.getElementById('filter-agenda');
    if (searchInput) searchInput.value = '';

    // Clear criterion select
    const criterionSelect = document.getElementById('filter-agenda-criterion');
    if (criterionSelect) criterionSelect.value = '';

    // Clear active filters display
    updateActiveFilterChips('agenda');

    showNotification('↩️ Regresando a Órdenes Pendientes', 'info');
}

/**
 * Confirm exit from Vista Agenda
 */
function confirmExitVistaAgenda() {
    confirmExit();
}

/**
 * Format date range for agenda display
 */
function formatDateRangeForAgenda(startDate, endDate) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const start = new Date(startDate).toLocaleDateString('es-MX', options);

    if (startDate === endDate) {
        return start;
    }

    const end = new Date(endDate).toLocaleDateString('es-MX', options);
    return `${start} - ${end}`;
}

/**
 * Group orders by Destino and calculate subtotals
 */
function groupOrdersByDestino(ordersData) {
    const grupos = {};

    ordersData.forEach(([orden, data]) => {
        const destino = data.recipient || 'Sin Destino Especificado';

        if (!grupos[destino]) {
            grupos[destino] = {
                destino: destino,
                ordenes: [],
                subtotales: {
                    totalOrdenes: 0,
                    totalCajas: 0,
                    sumaPromedioSurtido: 0
                }
            };
        }

        const validaciones = STATE.validacionData.get(orden) || [];
        const rastreoData = STATE.mneData.get(orden) || [];
        const totalCajas = data.totalCajas || 0;
        // FIXED: Count unique validated boxes instead of total records
        const cajasValidadas = getCajasValidadasUnicas(orden);
        const porcentajeSurtido = totalCajas > 0 ? Math.round((cajasValidadas / totalCajas) * 100) : 0;
        const { validated: isValidated } = isOrderValidated(orden);
        const estatusTexto = isValidated ? 'Validada' : 'Pendiente';

        grupos[destino].ordenes.push({
            horario: data.expectedArrival || 'N/A',
            fechaHorario: data.expectedArrival || 'Z', // For sorting
            numeroOrden: orden,
            codigo: data.referenceNo || 'N/A',
            track: data.trackingCode || 'N/A',
            cajas: totalCajas,
            porcentajeSurtido: porcentajeSurtido,
            estatus: estatusTexto,
            esValidada: isValidated,
            data: data // Keep original data for export
        });

        grupos[destino].subtotales.totalOrdenes++;
        grupos[destino].subtotales.totalCajas += totalCajas;
        grupos[destino].subtotales.sumaPromedioSurtido += porcentajeSurtido;
    });

    // Calculate average for each group and sort orders by horario
    Object.values(grupos).forEach(grupo => {
        if (grupo.subtotales.totalOrdenes > 0) {
            grupo.subtotales.promedioSurtido = Math.round(
                grupo.subtotales.sumaPromedioSurtido / grupo.subtotales.totalOrdenes
            );
        }
        // Sort orders by horario (earliest first)
        grupo.ordenes.sort((a, b) => a.fechaHorario.localeCompare(b.fechaHorario));
    });

    return Object.values(grupos);
}

/**
 * Calculate general totals
 */
function calculateGeneralTotals(grupos) {
    const totales = {
        ordenes: 0,
        cajas: 0,
        sumaPromedioSurtido: 0,
        validadas: 0
    };

    grupos.forEach(grupo => {
        totales.ordenes += grupo.subtotales.totalOrdenes;
        totales.cajas += grupo.subtotales.totalCajas;
        totales.sumaPromedioSurtido += grupo.subtotales.sumaPromedioSurtido;

        grupo.ordenes.forEach(orden => {
            if (orden.esValidada) totales.validadas++;
        });
    });

    if (totales.ordenes > 0) {
        totales.promedioSurtido = Math.round(totales.sumaPromedioSurtido / totales.ordenes);
    } else {
        totales.promedioSurtido = 0;
    }

    return totales;
}

/**
 * Render Vista Agenda with grouped data
 */
function renderVistaAgenda() {
    // Group data by destino
    const datosAgrupados = groupOrdersByDestino(STATE.vistaAgenda.datosOriginales);
    STATE.vistaAgenda.datosAgrupados = datosAgrupados;

    // Render table
    const container = document.getElementById('agenda-table-container');

    if (datosAgrupados.length === 0) {
        container.innerHTML = `
            <div class="table-empty-state">
                <div class="table-empty-icon">📭</div>
                <div class="table-empty-text">No hay órdenes para mostrar</div>
                <div class="table-empty-subtext">Ajusta los filtros o la fecha</div>
            </div>
        `;
        updateAgendaSummary({ ordenes: 0, cajas: 0, promedioSurtido: 0, validadas: 0 });
        return;
    }

    let html = '';

    datosAgrupados.forEach(grupo => {
        // Grupo header
        html += `
            <div class="agenda-group">
                <div class="agenda-group-header">
                    <h3 style="margin: 0; color: var(--primary); font-size: 1.1em; font-weight: 700;">
                        🏢 DESTINO: ${grupo.destino}
                    </h3>
                </div>

                <table class="orders-table agenda-table">
                    <thead>
                        <tr>
                            <th style="width: 120px;">Fecha Horario</th>
                            <th style="width: 150px;">Número de Orden</th>
                            <th style="width: 120px;">Código</th>
                            <th style="width: 120px;">Track</th>
                            <th style="width: 100px; text-align: center;">Cantidad de Cajas</th>
                            <th style="width: 120px; text-align: center;">% Surtido</th>
                            <th style="width: 150px;">Estatus Actual</th>
                            <th style="width: 80px; text-align: center;">Acción</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Orders in this group
        grupo.ordenes.forEach(orden => {
            const rowClass = orden.esValidada ? 'validated-order' : '';
            const estatusClass = orden.esValidada ? 'success' : 'warning';
            const estatusIcon = orden.esValidada ? '✅' : '⏳';

            html += `
                <tr class="${rowClass}">
                    <td>${orden.horario}</td>
                    <td><span class="order-code">${orden.numeroOrden}</span></td>
                    <td>${orden.codigo}</td>
                    <td>${orden.track}</td>
                    <td style="text-align: center;"><strong>${orden.cajas}</strong></td>
                    <td style="text-align: center;">
                        <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <div class="progress-bar" style="width: 60px;">
                                <div class="progress-fill" style="width: ${orden.porcentajeSurtido}%"></div>
                            </div>
                            <span class="progress-text">${orden.porcentajeSurtido}%</span>
                        </div>
                    </td>
                    <td>
                        <span class="status-badge ${estatusClass}">${estatusIcon} ${orden.estatus}</span>
                    </td>
                    <td style="text-align: center;">
                        <button class="btn-action dispatch" onclick="openDispatchFromAgenda('${orden.numeroOrden}')" title="Ir a despacho">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M20 7h-9"></path>
                                <path d="M14 17H5"></path>
                                <circle cx="17" cy="17" r="3"></circle>
                                <circle cx="7" cy="7" r="3"></circle>
                            </svg>
                        </button>
                    </td>
                </tr>
            `;
        });

        // Subtotals row
        html += `
                    </tbody>
                    <tfoot>
                        <tr class="agenda-subtotal-row">
                            <td colspan="8" style="background: #f1f5f9; padding: 12px; font-weight: 700; color: var(--primary);">
                                📊 SUBTOTAL ${grupo.destino}:
                                <span style="margin-left: 16px;">
                                    ${grupo.subtotales.totalOrdenes} orden${grupo.subtotales.totalOrdenes !== 1 ? 'es' : ''}
                                </span>
                                <span style="margin-left: 12px;">|</span>
                                <span style="margin-left: 12px;">
                                    ${grupo.subtotales.totalCajas} caja${grupo.subtotales.totalCajas !== 1 ? 's' : ''}
                                </span>
                                <span style="margin-left: 12px;">|</span>
                                <span style="margin-left: 12px;">
                                    Promedio: ${grupo.subtotales.promedioSurtido}%
                                </span>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    });

    container.innerHTML = html;

    // Update summary
    const totales = calculateGeneralTotals(datosAgrupados);
    updateAgendaSummary(totales);
}

/**
 * Update general summary panel
 */
function updateAgendaSummary(totales) {
    document.getElementById('agenda-total-ordenes').textContent = totales.ordenes;
    document.getElementById('agenda-total-cajas').textContent = totales.cajas;
    document.getElementById('agenda-promedio-surtido').textContent = `${totales.promedioSurtido}%`;
    document.getElementById('agenda-ordenes-validadas').textContent = totales.validadas;

    // Update header badges
    document.getElementById('agenda-total-ordenes-badge').textContent = `${totales.ordenes} orden${totales.ordenes !== 1 ? 'es' : ''}`;
    document.getElementById('agenda-total-cajas-badge').textContent = `${totales.cajas} caja${totales.cajas !== 1 ? 's' : ''}`;
}

/**
 * Filter agenda table
 */
function filterAgendaTable() {
    applyAdvancedFilters('agenda');
}

/**
 * Export agenda to Excel/CSV
 */
function exportAgendaToExcel() {
    if (!STATE.vistaAgenda.datosAgrupados || STATE.vistaAgenda.datosAgrupados.length === 0) {
        showNotification('⚠️ No hay datos para exportar', 'warning');
        return;
    }

    const exportData = [];

    // Add header info
    exportData.push({
        'AGENDA DE ÓRDENES': STATE.vistaAgenda.fechaHeredada.formatted,
        'Fecha de Exportación': new Date().toLocaleString('es-MX')
    });
    exportData.push({}); // Empty row

    // Add data grouped by destino
    STATE.vistaAgenda.datosAgrupados.forEach(grupo => {
        // Grupo header
        exportData.push({
            'Destino': `DESTINO: ${grupo.destino}`,
            'Horario': '',
            'Número de Orden': '',
            'Código': '',
            'Track': '',
            'Cantidad de Cajas': '',
            '% Surtido': '',
            'Estatus': ''
        });

        // Orders
        grupo.ordenes.forEach(orden => {
            exportData.push({
                'Destino': '',
                'Horario': orden.horario,
                'Número de Orden': orden.numeroOrden,
                'Código': orden.codigo,
                'Track': orden.track,
                'Cantidad de Cajas': orden.cajas,
                '% Surtido': `${orden.porcentajeSurtido}%`,
                'Estatus': orden.estatus
            });
        });

        // Subtotal
        exportData.push({
            'Destino': `SUBTOTAL ${grupo.destino}`,
            'Horario': `${grupo.subtotales.totalOrdenes} órdenes`,
            'Número de Orden': `${grupo.subtotales.totalCajas} cajas`,
            'Código': '',
            'Track': '',
            'Cantidad de Cajas': '',
            '% Surtido': `Promedio: ${grupo.subtotales.promedioSurtido}%`,
            'Estatus': ''
        });
        exportData.push({}); // Empty row
    });

    // Add general totals
    const totales = calculateGeneralTotals(STATE.vistaAgenda.datosAgrupados);
    exportData.push({});
    exportData.push({
        'Destino': 'RESUMEN GENERAL',
        'Horario': `Total Órdenes: ${totales.ordenes}`,
        'Número de Orden': `Total Cajas: ${totales.cajas}`,
        'Código': '',
        'Track': '',
        'Cantidad de Cajas': `Promedio Surtido: ${totales.promedioSurtido}%`,
        '% Surtido': `Órdenes Validadas: ${totales.validadas}`,
        'Estatus': ''
    });

    // Convert to CSV
    const headers = ['Destino', 'Horario', 'Número de Orden', 'Código', 'Track', 'Cantidad de Cajas', '% Surtido', 'Estatus'];
    const csvContent = [
        headers.join(','),
        ...exportData.map(row => headers.map(header => {
            const value = row[header] || '';
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');

    // Create download
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset-utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Agenda_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    showNotification('✅ Agenda exportada exitosamente', 'success');
}

/**
 * Print agenda
 */
function printAgenda() {
    if (!STATE.vistaAgenda.datosAgrupados || STATE.vistaAgenda.datosAgrupados.length === 0) {
        showNotification('⚠️ No hay datos para imprimir', 'warning');
        return;
    }

    const totales = calculateGeneralTotals(STATE.vistaAgenda.datosAgrupados);

    let printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Agenda de Órdenes</title>
            <style>
                @page { margin: 1in; }
                body { font-family: Arial, sans-serif; font-size: 12px; }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #f97316; padding-bottom: 15px; }
                .header h1 { margin: 0; color: #f97316; font-size: 24px; }
                .header .date { color: #64748b; font-size: 14px; margin-top: 8px; }
                .group { margin-bottom: 30px; page-break-inside: avoid; }
                .group-title { background: #f1f5f9; padding: 10px; font-weight: 700; color: #f97316; font-size: 14px; margin-bottom: 10px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
                th { background: #f8fafc; color: #475569; padding: 8px; text-align: left; font-weight: 700; border-bottom: 2px solid #e2e8f0; }
                td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
                .subtotal { background: #f1f5f9; font-weight: 700; color: #f97316; }
                .summary { margin-top: 30px; padding: 20px; background: #f8fafc; border-left: 4px solid #f97316; }
                .summary h3 { margin: 0 0 15px 0; color: #f97316; }
                .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                .summary-item { display: flex; justify-content: space-between; padding: 5px 0; }
                .summary-label { color: #64748b; }
                .summary-value { font-weight: 700; color: #f97316; }
                .validated-row { background: #f0fdf4; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📅 AGENDA DE ÓRDENES</h1>
                <div class="date">Fecha: ${STATE.vistaAgenda.fechaHeredada.formatted}</div>
                <div class="date">Generado: ${new Date().toLocaleString('es-MX')}</div>
            </div>
    `;

    STATE.vistaAgenda.datosAgrupados.forEach(grupo => {
        printContent += `
            <div class="group">
                <div class="group-title">🏢 DESTINO: ${grupo.destino}</div>
                <table>
                    <thead>
                        <tr>
                            <th>Horario</th>
                            <th>Número de Orden</th>
                            <th>Código</th>
                            <th>Track</th>
                            <th style="text-align: center;">Cajas</th>
                            <th style="text-align: center;">% Surtido</th>
                            <th>Estatus</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        grupo.ordenes.forEach(orden => {
            const rowClass = orden.esValidada ? 'validated-row' : '';
            printContent += `
                <tr class="${rowClass}">
                    <td>${orden.horario}</td>
                    <td>${orden.numeroOrden}</td>
                    <td>${orden.codigo}</td>
                    <td>${orden.track}</td>
                    <td style="text-align: center;">${orden.cajas}</td>
                    <td style="text-align: center;">${orden.porcentajeSurtido}%</td>
                    <td>${orden.estatus}</td>
                </tr>
            `;
        });

        printContent += `
                    </tbody>
                    <tfoot>
                        <tr class="subtotal">
                            <td colspan="7">
                                📊 SUBTOTAL: ${grupo.subtotales.totalOrdenes} orden${grupo.subtotales.totalOrdenes !== 1 ? 'es' : ''} |
                                ${grupo.subtotales.totalCajas} caja${grupo.subtotales.totalCajas !== 1 ? 's' : ''} |
                                Promedio: ${grupo.subtotales.promedioSurtido}%
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    });

    printContent += `
            <div class="summary">
                <h3>📊 RESUMEN GENERAL</h3>
                <div class="summary-grid">
                    <div class="summary-item">
                        <span class="summary-label">Total de Órdenes:</span>
                        <span class="summary-value">${totales.ordenes}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Total de Cajas:</span>
                        <span class="summary-value">${totales.cajas}</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Promedio Surtido:</span>
                        <span class="summary-value">${totales.promedioSurtido}%</span>
                    </div>
                    <div class="summary-item">
                        <span class="summary-label">Órdenes Validadas:</span>
                        <span class="summary-value">${totales.validadas}</span>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
        printWindow.print();
    }, 250);

    showNotification('🖨️ Preparando impresión...', 'info');
}

/**
 * Open dispatch modal from Vista Agenda
 */
function openDispatchFromAgenda(orden) {
    // Simply call the existing showOrderInfo function
    showOrderInfo(orden);
}

// ==================== VERIFICACIÓN DE DATOS ====================
/**
 * Función de verificación para debugging - llamar desde consola
 * Uso: verificarDatosDespacho('OBC-123')
 */
window.verificarDatosDespacho = function(orden) {
    console.log('\n🔍 ========== VERIFICACIÓN DE DATOS ==========');
    
    // Buscar en validados
    const record = STATE.localValidated.find(r => r.orden === orden);
    
    if (!record) {
        console.log('❌ Orden no encontrada en validados');
        return;
    }
    
    console.log('✅ Registro encontrado:', orden);
    console.log('\n📊 DATOS DEL REGISTRO:');
    console.log('├─ Folio:', record.folio);
    console.log('├─ Fecha:', record.fecha);
    console.log('├─ Hora:', record.hora);
    console.log('├─ Usuario:', record.usuario);
    console.log('├─ Destino:', record.destino);
    console.log('├─ Horario:', record.horario);
    console.log('\n📦 CANTIDADES:');
    console.log('├─ cantInicial (M):', record.cantInicial);
    console.log('├─ cantDespacho (N):', record.cantDespacho);
    console.log('├─ cantidadDespachar (alias):', record.cantidadDespachar);
    console.log('├─ totalCajas:', record.totalCajas);
    console.log('\n👤 TRANSPORTE:');
    console.log('├─ operador (P):', record.operador);
    console.log('├─ conductor (alias):', record.conductor);
    console.log('├─ unidad (Q):', record.unidad);
    console.log('\n📝 NOTAS:');
    console.log('├─ incidencias (O):', record.incidencias);
    console.log('├─ observaciones (R):', record.observaciones);
    console.log('├─ notaDespacho (alias):', record.notaDespacho);
    console.log('\n🔍 VERIFICACIÓN:');
    
    const issues = [];
    if (!record.cantDespacho && record.cantDespacho !== 0) issues.push('⚠️ cantDespacho no definido');
    if (!record.operador) issues.push('⚠️ operador vacío');
    if (!record.unidad) issues.push('⚠️ unidad vacía');
    if (record.cantidadDespachar !== record.cantDespacho) issues.push('⚠️ cantidadDespachar no coincide con cantDespacho');
    
    if (issues.length > 0) {
        console.log('\n❌ PROBLEMAS DETECTADOS:');
        issues.forEach(issue => console.log(issue));
    } else {
        console.log('✅ Todos los campos están correctamente mapeados');
    }
    
    console.log('\n========================================\n');
    return record;
};

/**
 * Verificar todos los registros validados
 */
window.verificarTodosLosDespachos = function() {
    console.log('\n🔍 ========== VERIFICACIÓN MASIVA ==========');
    console.log(`Total de registros: ${STATE.localValidated.length}`);
    
    let sinCantDespacho = 0;
    let sinOperador = 0;
    let sinUnidad = 0;
    let desincronizados = 0;
    
    STATE.localValidated.forEach((record, index) => {
        if (!record.cantDespacho && record.cantDespacho !== 0) sinCantDespacho++;
        if (!record.operador) sinOperador++;
        if (!record.unidad) sinUnidad++;
        if (record.cantidadDespachar !== record.cantDespacho) desincronizados++;
    });
    
    console.log('\n📊 RESUMEN:');
    console.log(`├─ Sin cantDespacho: ${sinCantDespacho}`);
    console.log(`├─ Sin operador: ${sinOperador}`);
    console.log(`├─ Sin unidad: ${sinUnidad}`);
    console.log(`└─ Desincronizados: ${desincronizados}`);
    
    if (sinCantDespacho > 0 || sinOperador > 0 || sinUnidad > 0 || desincronizados > 0) {
        console.log('\n⚠️ Se detectaron problemas. Usa verificarDatosDespacho(orden) para ver detalles.');
    } else {
        console.log('\n✅ Todos los registros están correctos');
    }
    
    console.log('========================================\n');
};

// ==================== EXPOSE FUNCTIONS GLOBALLY ====================
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.showOrderInfo = showOrderInfo;
window.printFolioDetails = printFolioDetails;
window.exportFolioDetailsToExcel = exportFolioDetailsToExcel;
window.openVistaAgenda = openVistaAgenda;
window.closeVistaAgenda = closeVistaAgenda;
window.confirmExitVistaAgenda = confirmExitVistaAgenda;
window.filterAgendaTable = filterAgendaTable;
window.exportAgendaToExcel = exportAgendaToExcel;
window.printAgenda = printAgenda;
window.openDispatchFromAgenda = openDispatchFromAgenda;
// Exponer funciones para sidebar cards
window.switchValidationTab = switchValidationTab;
window.showFoliosManagement = showFoliosManagement;
window.showSearchPanel = showSearchPanel;

// ==================== CLOSE DROPDOWN ON OUTSIDE CLICK ====================
document.addEventListener('click', function(event) {
    // Get all filter dropdowns
    const dropdowns = ['orders', 'validated', 'folios', 'folio-details', 'agenda'];

    dropdowns.forEach(view => {
        const dropdown = document.getElementById(`filter-${view}-dropdown`);
        const criterionSelect = document.getElementById(`filter-${view}-criterion`);
        const wrapper = document.querySelector(`#filter-${view}-criterion`)?.closest('.advanced-filter-wrapper');

        if (!dropdown || !criterionSelect || !wrapper) return;

        // Check if dropdown is visible
        if (dropdown.style.display === 'block') {
            // Check if click is outside the wrapper
            if (!wrapper.contains(event.target)) {
                dropdown.style.display = 'none';
            }
        }
    });
});

// ==================== MULTI-SELECTION SYSTEM ====================

/**
 * Reset all selections across all tables (called when switching tabs)
 */
function resetAllSelections() {
    const tables = ['orders', 'validated', 'otros'];

    tables.forEach(table => {
        // Clear all row checkboxes
        const tableBody = document.getElementById(`${table === 'orders' ? 'orders-table-body' : table === 'validated' ? 'validated-table-body' : 'otros-table-body'}`);
        if (tableBody) {
            tableBody.querySelectorAll('.row-checkbox').forEach(cb => {
                cb.checked = false;
            });
        }

        // Clear select-all checkbox
        const selectAllCheckbox = document.getElementById(`select-all-${table}`);
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }

        // Hide selection header
        const selectionHeader = document.getElementById(`selection-header-${table}`);
        if (selectionHeader) {
            selectionHeader.style.display = 'none';
        }
    });
}

/**
 * Toggle select all checkboxes for a specific table
 */
function toggleSelectAll(table) {
    const selectAllCheckbox = document.getElementById(`select-all-${table}`);
    const tableBody = document.getElementById(`${table === 'orders' ? 'orders-table-body' : table === 'validated' ? 'validated-table-body' : 'otros-table-body'}`);

    if (!tableBody) return;

    const visibleCheckboxes = Array.from(tableBody.querySelectorAll('.row-checkbox'))
        .filter(cb => cb.closest('tr').style.display !== 'none');

    visibleCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });

    updateSelectionCount(table);
}

/**
 * Update selection counter and show/hide export button
 */
function updateSelectionCount(table) {
    const tableBody = document.getElementById(`${table === 'orders' ? 'orders-table-body' : table === 'validated' ? 'validated-table-body' : 'otros-table-body'}`);
    const selectAllCheckbox = document.getElementById(`select-all-${table}`);

    if (!tableBody) return;

    const allCheckboxes = Array.from(tableBody.querySelectorAll('.row-checkbox'))
        .filter(cb => cb.closest('tr').style.display !== 'none');
    const checkedCheckboxes = allCheckboxes.filter(cb => cb.checked);

    // Update select-all checkbox state
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = allCheckboxes.length > 0 && allCheckboxes.length === checkedCheckboxes.length;
        selectAllCheckbox.indeterminate = checkedCheckboxes.length > 0 && checkedCheckboxes.length < allCheckboxes.length;
    }

    // Show/hide selection header
    const selectionCount = checkedCheckboxes.length;
    showSelectionHeader(table, selectionCount);
}

/**
 * Show or hide the selection header with counter and export button
 */
function showSelectionHeader(table, count) {
    let selectionHeader = document.getElementById(`selection-header-${table}`);

    if (count > 0) {
        // Create header if it doesn't exist
        if (!selectionHeader) {
            selectionHeader = document.createElement('div');
            selectionHeader.id = `selection-header-${table}`;
            selectionHeader.className = 'selection-header';
            selectionHeader.innerHTML = `
                <div class="selection-info">
                    <span id="selection-count-${table}" class="selection-count">${count} seleccionada(s)</span>
                </div>
                <div class="selection-actions">
                    <button class="btn btn-primary" onclick="exportSelectedOrders('${table}')">
                        📥 Exportar Selección
                    </button>
                    <button class="btn btn-secondary" onclick="clearSelection('${table}')">
                        ✕ Limpiar
                    </button>
                </div>
            `;

            // Insert header before the table container
            const tableContainer = document.querySelector(`#${table === 'orders' ? 'orders-table' : table === 'validated' ? 'validated-table' : 'otros-table'}`)?.closest('.orders-table-container');
            if (tableContainer) {
                tableContainer.parentElement.insertBefore(selectionHeader, tableContainer);
            }
        } else {
            // Update count
            const countSpan = document.getElementById(`selection-count-${table}`);
            if (countSpan) {
                countSpan.textContent = `${count} seleccionada(s)`;
            }
            selectionHeader.style.display = 'flex';
        }
    } else {
        // Hide header if no selection
        if (selectionHeader) {
            selectionHeader.style.display = 'none';
        }
    }
}

/**
 * Clear all selections for a table
 */
function clearSelection(table) {
    const tableBody = document.getElementById(`${table === 'orders' ? 'orders-table-body' : table === 'validated' ? 'validated-table-body' : 'otros-table-body'}`);
    const selectAllCheckbox = document.getElementById(`select-all-${table}`);

    if (tableBody) {
        tableBody.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = false);
    }

    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }

    updateSelectionCount(table);
}

/**
 * Export selected orders to CSV
 */
function exportSelectedOrders(table) {
    const tableBody = document.getElementById(`${table === 'orders' ? 'orders-table-body' : table === 'validated' ? 'validated-table-body' : 'otros-table-body'}`);

    if (!tableBody) return;

    const selectedCheckboxes = Array.from(tableBody.querySelectorAll('.row-checkbox:checked'));
    const selectedOrders = selectedCheckboxes.map(cb => cb.dataset.orden);

    if (selectedOrders.length === 0) {
        showNotification('⚠️ No hay órdenes seleccionadas', 'warning');
        return;
    }

    // Collect data based on table type
    let csvData = [];
    let headers = [];

    if (table === 'orders') {
        headers = ['N° Orden', 'Destino', 'Horario', 'Código', 'Track', 'Cant. Cajas', 'Cantidad a Despachar', 'Estatus'];
        selectedOrders.forEach(orden => {
            const data = STATE.obcData.get(orden);
            if (data) {
                const { validated } = isOrderValidated(orden);
                const validatedData = validated ? STATE.localValidated.find(v => v.orden === orden) : null;
                const estatus = validatedData ? (validatedData.estatus || 'Validada') : 'Pendiente';

                // Obtener cantidad a despachar
                const cantidadADespachar = validatedData
                    ? (validatedData.cantDespacho || validatedData.cantidadDespachar || data.totalCajas || 0)
                    : (data.totalCajas || 0);

                csvData.push([
                    orden,
                    data.recipient || 'N/A',
                    data.expectedArrival || 'N/A',
                    data.referenceNo || 'N/A',
                    data.trackingCode || 'N/A',
                    data.totalCajas || 0,
                    cantidadADespachar,
                    estatus
                ]);
            }
        });
    } else if (table === 'validated') {
        headers = ['N° Orden', 'Fecha Validación', 'Destino', 'Horario', 'Cant. Cajas', 'Cantidad a Despachar', 'Estatus', 'Conductor', 'Unidad', 'Folio'];
        selectedOrders.forEach(orden => {
            const record = STATE.localValidated.find(v => v.orden === orden);
            if (record) {
                const orderData = STATE.obcData.get(orden) || {};
                // Obtener cantidad a despachar desde cantDespacho (Columna N)
                const cantidadADespachar = record.cantDespacho || record.cantidadDespachar || orderData.totalCajas || 0;
                csvData.push([
                    orden,
                    record.timestamp ? formatValidationDateTime(record.timestamp) : `${record.fecha || ''} ${record.hora || ''}`,
                    record.destino || orderData.recipient || 'N/A',
                    record.horario || orderData.expectedArrival || 'N/A',
                    orderData.totalCajas || record.totalCajas || 0,
                    cantidadADespachar,
                    record.estatus || 'Validada',
                    record.operador || 'N/A',
                    record.unidad || 'N/A',
                    record.folio || 'N/A'
                ]);
            }
        });
    } else if (table === 'otros') {
        headers = ['N° Orden', 'Fecha Marcado', 'Destino', 'Horario', 'Cant. Cajas', 'Cantidad a Despachar', 'Estatus', 'Usuario'];
        selectedOrders.forEach(orden => {
            const record = STATE.localValidated.find(v => v.orden === orden && (v.estatus === 'Cancelada' || v.estatus === 'No Procesable'));
            if (record) {
                const orderData = STATE.obcData.get(orden) || {};
                // Obtener cantidad a despachar (para órdenes canceladas/no procesables, puede ser 0 o la cantidad registrada)
                const cantidadADespachar = record.cantDespacho || record.cantidadDespachar || 0;

                csvData.push([
                    orden,
                    record.fecha || 'N/A',
                    record.destino || 'N/A',
                    record.horario || 'N/A',
                    orderData.totalCajas || 0,
                    cantidadADespachar,
                    record.estatus || 'N/A',
                    record.usuario || 'N/A'
                ]);
            }
        });
    }

    // Generate CSV
    const csvContent = [
        headers.join(','),
        ...csvData.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ordenes_${table}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showNotification(`✅ ${selectedOrders.length} órdenes exportadas correctamente`, 'success');
}
