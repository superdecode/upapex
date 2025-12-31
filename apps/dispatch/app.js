// ==================== CONFIGURATION ====================
const CONFIG = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
    SPREADSHEET_WRITE: '1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o',
    // Spreadsheet ID principal para consolidación de órdenes
    SPREADSHEET_ORDENES_ID: '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck',
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
    // Sistema de folios de carga
    // Map: fecha → Map(folio → {conductor, unidad})
    // Ejemplo: "2025-12-30" → Map("01" → {conductor: "Juan", unidad: "T-001"})
    foliosDeCargas: new Map()
};

// Cargar estado local al inicio
function loadLocalState() {
    try {
        const saved = localStorage.getItem('dispatch_local_state');
        if (saved) {
            const data = JSON.parse(saved);
            STATE.localValidated = data.localValidated || [];
            STATE.localPending = data.localPending || [];

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
            foliosDeCargas: foliosObj
        }));
    } catch (e) {
        console.error('Error saving local state:', e);
    }
}

function generateFolio(folioCarga) {
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `DSP-${dateStr}-${folioCarga}`;
}

// Verificar si una orden ya fue despachada (no confundir con validación de surtido)
function isOrderValidated(orden) {
    // Buscar en despachos validados locales
    const localMatch = STATE.localValidated.find(v => v.orden === orden);
    if (localMatch) return { validated: true, source: 'local', data: localMatch };

    // NO verificar contra STATE.validacionData porque esos son datos de surtido (Val3), no despachos
    // Los despachos solo se verifican contra localValidated y la cola de sync

    return { validated: false };
}

// ==================== SISTEMA DE FOLIOS DE CARGA ====================
/**
 * Obtiene la fecha actual en formato YYYY-MM-DD
 */
function getCurrentDateKey() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

/**
 * Obtiene los folios disponibles para un conductor y unidad
 * - Si es la misma combinación, puede reutilizar el folio existente
 * - Si es diferente, debe usar un folio no utilizado
 */
function getAvailableFolios(conductor, unidad) {
    const dateKey = getCurrentDateKey();
    const foliosDelDia = STATE.foliosDeCargas.get(dateKey) || new Map();

    const allFolios = ['01', '02', '03', '04', '05'];

    return allFolios.map(folio => {
        const folioInfo = foliosDelDia.get(folio);

        // Si el folio no está usado, está disponible
        if (!folioInfo) {
            return { value: folio, disabled: false };
        }

        // Si el folio está usado por la misma combinación conductor+unidad, puede reutilizarse
        if (folioInfo.conductor === conductor && folioInfo.unidad === unidad) {
            return { value: folio, disabled: false, reutilizable: true };
        }

        // Si el folio está usado por otra combinación, está bloqueado
        return { value: folio, disabled: true, usadoPor: `${folioInfo.conductor}/${folioInfo.unidad}` };
    });
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
 */
function setupFolioSelectorListeners() {
    const conductorSelect = document.getElementById('modal-operador');
    const unidadSelect = document.getElementById('modal-unidad');

    if (conductorSelect && unidadSelect) {
        // Remover listeners anteriores si existen
        const newConductorSelect = conductorSelect.cloneNode(true);
        const newUnidadSelect = unidadSelect.cloneNode(true);
        conductorSelect.parentNode.replaceChild(newConductorSelect, conductorSelect);
        unidadSelect.parentNode.replaceChild(newUnidadSelect, unidadSelect);

        // Agregar nuevos listeners
        newConductorSelect.addEventListener('change', updateFolioSelector);
        newUnidadSelect.addEventListener('change', updateFolioSelector);
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
let TOKEN_CLIENT = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();
    cleanOldFolios();  // Limpiar folios de días anteriores
    setupEventListeners();
    setupConnectionMonitoring();
    initSyncManager();
    initSidebarComponent();
    
    // Debug mode: bypass Google auth
    if (DebugMode.autoInit('Dispatch', (userData) => {
        CURRENT_USER = userData.user;
        USER_EMAIL = userData.email;
        USER_GOOGLE_NAME = userData.name;
        updateUserFooter();
        showNotification('🔧 DEBUG MODE: Sesión simulada', 'info');
        // Cargar datos mock o reales según necesites
        loadAllData();
    })) {
        return; // Si debug está activo, no cargar Google API
    }
    
    // Modo normal: cargar Google API
    gapi.load('client', initGAPI);
});

function initSidebarComponent() {
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
            { label: '📋 Gestión de Folios', onClick: 'showFoliosManagement()', class: 'sidebar-btn-primary' },
            { label: '📥 Exportar CSV', onClick: 'exportData()', class: 'sidebar-btn-secondary' }
        ]
    });

    window.sidebarComponent.render();
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

// ==================== GOOGLE API ====================
async function initGAPI() {
    try {
        await gapi.client.init({
            discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"]
        });
        TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({
            client_id: CONFIG.CLIENT_ID,
            scope: CONFIG.SCOPES,
            callback: handleAuthCallback,
            error_callback: (error) => {
                hidePreloader();
                if (error.type !== 'popup_closed') {
                    showNotification('❌ Error de autenticación: ' + error.message, 'error');
                } else {
                    showNotification('⚠️ Autenticación cancelada', 'warning');
                }
            }
        });
    } catch (e) {
        hidePreloader();
        showNotification('Error inicializando API', 'error');
    }
}

async function handleAuthCallback(response) {
    if (response?.access_token) {
        gapi.client.setToken(response);
        
        // Guardar token en el sistema de avatar
        if (window.sidebarComponent) {
            window.sidebarComponent.saveGoogleConnection(response.access_token, response.expires_in || 3600);
        }
        
        showPreloader('Cargando base de datos...', 'Obteniendo información del sistema');
        await getUserProfile();
        await loadAllData();
        hidePreloader();
        updateConnectionIndicator();
        updateSyncStatus();
        showNotification('✅ Conexión exitosa - BD cargada', 'success');
        showApp();

        if (STATE.pendingSync.length > 0) {
            setTimeout(() => syncPendingData(), 1000);
        }
    }
}

function handleLogin() {
    showPreloader('Conectando con Google Sheets...', 'Por favor autoriza el acceso en la ventana emergente');
    TOKEN_CLIENT?.requestAccessToken();
}

async function getUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
        });
        const data = await response.json();
        USER_EMAIL = data.email || '';
        USER_GOOGLE_NAME = data.name || 'Usuario';

        const savedAlias = localStorage.getItem(`dispatch_alias_${USER_EMAIL}`);
        if (savedAlias) {
            CURRENT_USER = savedAlias;
        } else {
            CURRENT_USER = USER_GOOGLE_NAME;
            localStorage.setItem(`dispatch_alias_${USER_EMAIL}`, USER_GOOGLE_NAME);
        }
        updateUserFooter();
    } catch (e) {
        CURRENT_USER = 'Usuario';
    }
}

function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');

    // REMOVED: Sidebar validation tabs eliminated per user request
    // Toggle buttons now only appear in header, not in sidebar
}

function handleLogout() {
    if (gapi.client.getToken()) {
        google.accounts.oauth2.revoke(gapi.client.getToken().access_token);
        gapi.client.setToken(null);
    }
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
async function loadAllData() {
    showNotification('🔄 Cargando datos...', 'info');

    let errors = [];
    let loaded = 0;

    // Load BD_CAJAS PRIMERO (Pestaña BD - gid=0 - FUENTE PRINCIPAL)
    // Esta es la base de datos completa con todas las cajas individuales
    try {
        const bdCajasResponse = await fetch(CONFIG.SOURCES.BD_CAJAS);
        const bdCajasCsv = await bdCajasResponse.text();
        parseBDCajasData(bdCajasCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading BD_CAJAS:', e);
        errors.push('BD_CAJAS');
    }

    // Load VALIDACION (Sistema de Validación de Surtido)
    try {
        const validacionResponse = await fetch(CONFIG.SOURCES.VALIDACION);
        const validacionCsv = await validacionResponse.text();
        parseValidacionData(validacionCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading VALIDACION:', e);
        errors.push('VALIDACION');
    }

    // Load MNE (Rastreo)
    try {
        const mneResponse = await fetch(CONFIG.SOURCES.MNE);
        const mneCsv = await mneResponse.text();
        parseMNEData(mneCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading MNE:', e);
        errors.push('MNE');
    }

    // Load TRS
    try {
        const trsResponse = await fetch(CONFIG.SOURCES.TRS);
        const trsCsv = await trsResponse.text();
        parseTRSData(trsCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading TRS:', e);
        errors.push('TRS');
    }

    // Load LISTAS (Operadores y Unidades)
    try {
        const listasResponse = await fetch(CONFIG.SOURCES.LISTAS);
        const listasCsv = await listasResponse.text();
        parseListasData(listasCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading LISTAS:', e);
        errors.push('LISTAS');
    }

    // Show appropriate notification
    if (errors.length > 0 && loaded === 0) {
        showNotification('❌ Error cargando todas las bases de datos', 'error');
    } else if (errors.length > 0) {
        showNotification(`⚠️ ${STATE.obcData.size} órdenes cargadas (advertencia: algunas fuentes fallaron)`, 'warning');
    } else {
        showNotification(`✅ ${STATE.obcData.size} órdenes cargadas exitosamente`, 'success');
    }

    updateBdInfo();
    updateSummary();
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

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 5) {
            const orden = cols[3]?.trim();
            if (orden) {
                if (!STATE.validacionData.has(orden)) {
                    STATE.validacionData.set(orden, []);
                }
                STATE.validacionData.get(orden).push({
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
    showPreloader('Recargando datos...', 'Descargando información actualizada');
    await loadAllData();
    hidePreloader();
    showNotification('✅ Datos actualizados', 'success');
}

function updateBdInfo() {
    if (window.sidebarComponent) {
        window.sidebarComponent.updateBDInfo(STATE.obcData.size);
    }
}

function toggleConnection() {
    if (gapi?.client?.getToken()) {
        // Ya está conectado, preguntar si desea desconectar
        if (confirm('¿Desconectar de Google? Deberás volver a iniciar sesión.')) {
            handleLogout();
        }
    } else {
        // No está conectado, iniciar login
        handleLogin();
    }
}

// ==================== UI FUNCTIONS ====================
function showSearchPanel() {
    // Mostrar modal de fecha obligatorio antes de iniciar
    showDateFilterForDispatch();
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
    document.getElementById('welcome-state').style.display = 'none';
    document.getElementById('validated-content').style.display = 'none';
    document.getElementById('search-panel').style.display = 'block';

    filterOrdersByDateRange();
    renderOrdersList();
    updateSummary();

    setTimeout(() => {
        document.getElementById('search-input')?.focus();
    }, 100);
}

function backToStart() {
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('validated-content').style.display = 'none';
    document.getElementById('welcome-state').style.display = 'flex';
    STATE.dateFilter.active = false;
    STATE.obcDataFiltered.clear();
    // Reset tabs to pending
    STATE.activeTab = 'pending';
    document.getElementById('tab-pending')?.classList.add('active');
    document.getElementById('tab-validated')?.classList.remove('active');
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
    const today = new Date().toISOString().slice(0, 10);
    let totalToday = 0;
    let validatedToday = 0;
    let pendingToday = 0;

    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;

    for (const [orden, data] of dataToUse.entries()) {
        const validaciones = STATE.validacionData.get(orden);
        if (validaciones && validaciones.length > 0) {
            validatedToday++;
        } else {
            pendingToday++;
        }
        totalToday++;
    }

    // Actualizar usando sidebarComponent
    if (window.sidebarComponent) {
        window.sidebarComponent.updateSummary({
            summaryTotal: totalToday,
            validated: validatedToday,
            pending: pendingToday
        });
    }

    // Update tab badges as well
    updateTabBadges();
}

function filterOrdersByDateRange() {
    STATE.obcDataFiltered.clear();

    if (!STATE.dateFilter.active || !STATE.dateFilter.startDate || !STATE.dateFilter.endDate) {
        return;
    }

    const startDate = new Date(STATE.dateFilter.startDate);
    const endDate = new Date(STATE.dateFilter.endDate);
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

    // Intentar parse directo (formato ISO: YYYY-MM-DD)
    let date = new Date(cleanStr);
    if (!isNaN(date.getTime())) return date;

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
    if (partsWithTime.length >= 1) {
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

function renderOrdersTable() {
    const tableBody = document.getElementById('orders-table-body');
    if (!tableBody) return;

    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;

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
    tableBody.innerHTML = ordersArray.map(([orden, data]) => {
        const validaciones = STATE.validacionData.get(orden) || [];
        const rastreoData = STATE.mneData.get(orden) || [];
        // FIXED: Use totalCajas from OBC database (RESUMEN_ORDENES), not from validation/rastreo
        const totalCajas = data.totalCajas || 0;
        const cajasValidadas = validaciones.length;
        const porcentajeValidacion = totalCajas > 0 ? Math.round((cajasValidadas / totalCajas) * 100) : 0;

        const tieneRastreo = rastreoData.length > 0;
        const { validated: isValidated } = isOrderValidated(orden);

        const statusClass = isValidated ? 'success' : 'warning';
        const statusText = isValidated ? '✅ Validada' : '⏳ Pendiente';

        return `
            <tr onclick="showOrderInfo('${orden}')" data-orden="${orden}">
                <td><span class="order-code">${makeCopyable(orden)}</span></td>
                <td class="td-wrap">${data.recipient || '<span class="empty-cell">Sin destino</span>'}</td>
                <td>${data.expectedArrival || '<span class="empty-cell">N/A</span>'}</td>
                <td>${makeCopyable(data.referenceNo || 'N/A')}</td>
                <td>${makeCopyable(data.trackingCode || 'N/A')}</td>
                <td style="text-align: center;">${totalCajas || '<span class="empty-cell">0</span>'}</td>
                <td>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${porcentajeValidacion}%"></div>
                    </div>
                    <span class="progress-text">${porcentajeValidacion}%</span>
                </td>
                <td style="text-align: center;">
                    <span class="rastreo-icon">${tieneRastreo ? 'SI' : 'NO'}</span>
                </td>
                <td>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td onclick="event.stopPropagation(); showOrderInfo('${orden}')">
                    <button class="btn-action dispatch">
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
}

// Mantener compatibilidad con código existente
function renderOrdersList() {
    renderOrdersTable();
}

function filterOrdersTable() {
    const filterText = document.getElementById('filter-orders')?.value.toLowerCase() || '';
    const rows = document.querySelectorAll('#orders-table-body tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(filterText) ? '' : 'none';
    });
}

function filterValidatedTable() {
    const filterText = document.getElementById('filter-validated')?.value.toLowerCase() || '';
    const rows = document.querySelectorAll('#validated-table-body tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(filterText) ? '' : 'none';
    });
}

// Mantener compatibilidad con código existente
function filterOrdersList() {
    filterOrdersTable();
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
function switchValidationTab(tab) {
    STATE.activeTab = tab;

    // Update old tab styles (sidebar tabs - if they exist)
    const tabPending = document.getElementById('tab-pending');
    const tabValidated = document.getElementById('tab-validated');

    // Update header toggle buttons (en panel de búsqueda)
    const togglePending = document.getElementById('toggle-pending');
    const toggleValidated = document.getElementById('toggle-validated');

    // Update header toggle buttons (en panel de validadas)
    const togglePendingValidated = document.getElementById('toggle-pending-validated');
    const toggleValidatedValidated = document.getElementById('toggle-validated-validated');

    if (tab === 'pending') {
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
        togglePending?.classList.add('active');
        toggleValidated?.classList.remove('active');

        // Actualizar botones en panel de validadas
        togglePendingValidated?.classList.add('active');
        toggleValidatedValidated?.classList.remove('active');

        // Show search panel / orders
        document.getElementById('welcome-state').style.display = 'none';
        document.getElementById('validated-content').style.display = 'none';
        document.getElementById('search-panel').style.display = 'block';

        // Render pending orders table
        renderOrdersTable();
    } else {
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
        togglePending?.classList.remove('active');
        toggleValidated?.classList.add('active');

        // Actualizar botones en panel de validadas
        togglePendingValidated?.classList.remove('active');
        toggleValidatedValidated?.classList.add('active');

        // Show validated content
        document.getElementById('welcome-state').style.display = 'none';
        document.getElementById('search-panel').style.display = 'none';
        document.getElementById('validated-content').style.display = 'block';

        // Render validated orders table
        renderValidatedTable();
    }

    // Update badges
    updateTabBadges();
}

function renderValidatedTable() {
    const tableBody = document.getElementById('validated-table-body');
    if (!tableBody) return;

    if (STATE.localValidated.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="14" class="table-empty-state">
                    <div class="table-empty-icon">📋</div>
                    <div class="table-empty-text">No hay despachos validados</div>
                    <div class="table-empty-subtext">Los despachos confirmados aparecerán aquí</div>
                </td>
            </tr>
        `;
        updateValidatedBadges();
        return;
    }

    // Sort by timestamp descending (most recent first)
    const sortedValidated = [...STATE.localValidated].sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
    });

    tableBody.innerHTML = sortedValidated.map((record, index) => {
        // Obtener datos originales de la orden si existen
        const orderData = STATE.obcData.get(record.orden) || {};
        const validaciones = STATE.validacionData.get(record.orden) || [];
        const rastreoData = STATE.mneData.get(record.orden) || [];
        // FIXED: Use totalCajas from OBC database (RESUMEN_ORDENES) as primary source
        const totalCajas = orderData.totalCajas || record.totalCajas || 0;
        const cajasValidadas = validaciones.length;
        const porcentajeValidacion = totalCajas > 0 ? Math.round((cajasValidadas / totalCajas) * 100) : 0;
        const tieneRastreo = rastreoData.length > 0;

        // FIXED: Calculate dispatch status instead of sync status
        const cantidadDespachar = record.cantidadDespachar || 0;
        const dispatchStatus = calculateOrderStatus(totalCajas, cantidadDespachar);
        const statusBadge = dispatchStatus.status;
        const statusColor = dispatchStatus.color;

        // Buscar TRS relacionados
        const boxCodes = new Set();
        validaciones.forEach(v => { if (v.codigo) boxCodes.add(v.codigo.trim()); });
        rastreoData.forEach(r => { if (r.codigo) boxCodes.add(r.codigo.trim()); });

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

        return `
            <tr onclick="showValidatedDetails(${index})" data-orden="${record.orden}">
                <td><span class="order-code">${makeCopyable(record.orden)}</span></td>
                <td class="td-wrap">${record.destino || orderData.recipient || '<span class="empty-cell">N/A</span>'}</td>
                <td>${record.horario || orderData.expectedArrival || '<span class="empty-cell">N/A</span>'}</td>
                <td>${makeCopyable(record.codigo2 || orderData.referenceNo || 'N/A')}</td>
                <td>${makeCopyable(record.codigo || orderData.trackingCode || 'N/A')}</td>
                <td style="text-align: center;">${totalCajas || '<span class="empty-cell">0</span>'}</td>
                <td>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${porcentajeValidacion}%"></div>
                    </div>
                    <span class="progress-text">${porcentajeValidacion}%</span>
                </td>
                <td style="text-align: center;">
                    <span class="rastreo-icon">${tieneRastreo ? '✅' : ''}</span>
                </td>
                <td style="text-align: center;">${trsCount > 0 ? `<span class="order-code">${trsCount} TRS</span>` : '<span class="empty-cell">N/A</span>'}</td>
                <td style="text-align: center;"><strong>${record.cantidadDespachar || 0}</strong></td>
                <td>
                    <span class="status-badge" style="background-color: ${statusColor}; color: white;">${statusBadge}</span>
                </td>
                <td>${estatusCalidad}</td>
                <td>${record.operador || '<span class="empty-cell">N/A</span>'}</td>
                <td><span class="order-code">${makeCopyable(record.folio)}</span></td>
            </tr>
        `;
    }).join('');

    // Actualizar badges de contadores
    updateValidatedBadges();
}

// Actualizar badges de contadores en Órdenes Validadas
function updateValidatedBadges() {
    const totalOrders = STATE.localValidated.length;
    let totalBoxes = 0;

    STATE.localValidated.forEach(record => {
        totalBoxes += parseInt(record.cantidadDespachar) || 0;
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

// Mantener compatibilidad con código existente
function renderValidatedList() {
    renderValidatedTable();
}

function showValidatedDetails(index) {
    const record = STATE.localValidated[index];
    if (!record) return;

    // Try to show the order info modal with existing data
    if (STATE.obcData.has(record.orden)) {
        showOrderInfo(record.orden);
    } else {
        // Show a simple notification with details
        const details = `
Folio: ${record.folio}
Orden: ${record.orden}
Destino: ${record.destino || 'N/A'}
Fecha: ${record.fecha}
Hora: ${record.hora}
Operador: ${record.operador}
Unidad: ${record.unidad}
Cajas: ${record.cantidadDespachar || 0}
Observaciones: ${record.observaciones || 'Ninguna'}
        `.trim();

        alert(details);
    }
}

// ==================== SEARCH ====================
function normalizeCode(code) {
    if (!code) return '';

    return String(code)
        .replace(/&/g, '/')
        .replace(/-/g, '/')
        .toLowerCase()
        .trim();
}

function executeSearch() {
    const searchInput = document.getElementById('search-input');
    const rawQuery = searchInput?.value.trim() || '';

    if (!rawQuery) {
        showNotification('⚠️ Ingresa un código para buscar', 'warning');
        return;
    }

    // Normalizar el query
    const queryNormalized = normalizeCode(rawQuery);
    const query = rawQuery.toUpperCase();

    let foundOrders = [];
    const isOBC = query.startsWith('OBC');

    if (isOBC) {
        // ===== LÓGICA PARA OBC =====
        if (STATE.obcData.has(query)) {
            foundOrders.push({ orden: query, source: 'OBC Directo', confidence: 100 });
        } else {
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

        // PRIORIDAD 1: Código COMPLETO en BD Cajas (exacto)
        if (STATE.bdCajasData.has(query)) {
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
            for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
                const codigoNormalized = normalizeCode(codigo);
                if (codigoNormalized === queryNormalized) {
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

        // PRIORIDAD 3: Rastreo MNE
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

        // PRIORIDAD 4: Validaciones
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

        // PRIORIDAD 5: TRS (último recurso)
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

    if (foundOrders.length === 0) {
        showNotification('❌ No se encontró la orden o código', 'error');
        return;
    }

    if (foundOrders.length > 1) {
        showMultipleMatchesModal(foundOrders, query);
        searchInput.value = '';
        return;
    }

    const foundOrden = foundOrders[0].orden;
    const foundSource = foundOrders[0].source;

    // Validar si la orden corresponde al filtro de fecha activo
    if (STATE.dateFilter.active) {
        const isInFilteredRange = STATE.obcDataFiltered.has(foundOrden);
        
        if (!isInFilteredRange) {
            // Orden encontrada pero no corresponde al rango de fechas
            showDateExceptionDialog(foundOrden, foundSource);
            searchInput.value = '';
            return;
        }
    }

    // Orden válida, abrir normalmente
    showNotification(`📦 ${foundSource} encontrado: ${foundOrden}`, 'success');
    showOrderInfo(foundOrden);
    searchInput.value = '';
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
        const orderData = STATE.obcData.get(match.orden);
        const totalCajas = orderData?.totalCajas || 0;

        return `
            <div class="match-item" onclick="selectMatch('${match.orden}')">
                <div class="match-header">
                    <div class="match-obc">${match.orden}</div>
                    <div class="match-confidence">${match.confidence}% coincidencia</div>
                </div>
                <div class="match-details">
                    <div class="match-detail">📍 ${orderData?.recipient || 'N/A'}</div>
                    <div class="match-detail">📅 ${orderData?.expectedArrival || 'N/A'}</div>
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
    const orderData = STATE.obcData.get(orden);
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

    // Render KPI Cards
    renderKPICards(orderData);

    // Render Modal Body with sections
    renderModalBody(orden, orderData);

    // Populate modal footer with saved data if order is validated
    if (validationCheck.validated && validationCheck.data) {
        const savedData = validationCheck.data;

        // Populate operator/driver dropdown
        const operadorSelect = document.getElementById('modal-operador');
        if (operadorSelect && savedData.operador) {
            operadorSelect.value = savedData.operador;
        }

        // Populate unit/vehicle dropdown
        const unidadSelect = document.getElementById('modal-unidad');
        if (unidadSelect && savedData.unidad) {
            unidadSelect.value = savedData.unidad;
        }

        // FIXED: Populate cantidad despachar field
        const cantidadDespacharInput = document.getElementById('cantidad-despachar');
        if (cantidadDespacharInput && savedData.cantidadDespachar) {
            cantidadDespacharInput.value = savedData.cantidadDespachar;
        }

        // Populate nota despacho field
        const notaDespachoInput = document.getElementById('nota-despacho');
        if (notaDespachoInput && (savedData.observaciones || savedData.notaDespacho)) {
            notaDespachoInput.value = savedData.observaciones || savedData.notaDespacho;
        }

        // Change button text to "Guardar cambios" for validated orders
        const confirmBtn = document.getElementById('confirm-dispatch-btn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '💾 Guardar Cambios';
            confirmBtn.onclick = function() { saveValidatedOrderChanges(orden); };
        }

        // Populate folio de carga si existe
        const folioSelect = document.getElementById('modal-folio-carga');
        if (folioSelect && savedData.folio) {
            const folioCarga = savedData.folio.split('-').pop();
            updateFolioSelector();
            folioSelect.value = folioCarga;
        }
    } else {
        // Reset button for non-validated orders
        const confirmBtn = document.getElementById('confirm-dispatch-btn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '✅ Confirmar Despacho';
            confirmBtn.onclick = function() { confirmDispatch(); };
        }
    }

    // Setup event listeners for folio selector
    setupFolioSelectorListeners();

    // Show modal
    document.getElementById('info-modal').classList.add('show');
}

function renderKPICards(orderData) {
    const kpiCards = document.getElementById('kpi-cards');
    const validaciones = STATE.validacionData.get(orderData.orden) || [];
    const cajasValidadas = validaciones.length;
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
        <div class="kpi-card orden" onclick="scrollToSection('section-general')">
            <div class="kpi-card-label">📦 Orden</div>
            <div class="kpi-card-value">${makeCopyable(orderData.orden)}</div>
        </div>
        <div class="kpi-card destino" onclick="scrollToSection('section-general')">
            <div class="kpi-card-label">🏢 Destino</div>
            <div class="kpi-card-value">${orderData.recipient || 'N/A'}</div>
        </div>
        <div class="kpi-card estatus" onclick="scrollToSection('section-validaciones')">
            <div class="kpi-card-label">✅ Validación</div>
            <div class="kpi-card-value">${cajasValidadas}/${totalCajas} cajas</div>
            ${totalCajas > 0 ? `
                <div class="kpi-progress">
                    <div class="kpi-progress-bar" style="width: ${(cajasValidadas/totalCajas*100).toFixed(0)}%"></div>
                </div>
            ` : ''}
        </div>
        <div class="kpi-card trs" onclick="scrollToSection('section-trs')">
            <div class="kpi-card-label">🔄 TRS</div>
            <div class="kpi-card-value">${trsCount} relacionados</div>
        </div>
        <div class="kpi-card cajas" onclick="scrollToSection('section-rastreo')">
            <div class="kpi-card-label">📍 Rastreo</div>
            <div class="kpi-card-value">${rastreoData.length} cajas</div>
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
                        <div class="general-info-label">HORARIO</div>
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

                    <!-- Fila 2: Distribución Mixta (1fr 1fr 3fr) -->
                    <div class="row-2">
                        <div class="general-info-field">
                            <div class="general-info-label">CANT. CAJAS</div>
                            <div class="general-info-value">${orderData.totalCajas || rastreoData.length || validaciones.length || 'N/A'}</div>
                        </div>
                        <div class="general-info-field editable">
                            <div class="general-info-label">CANT. DESPACHAR</div>
                            <input type="number" class="general-info-input" id="cantidad-despachar" placeholder="Cantidad..." min="0" value="${orderData.totalCajas || ''}">
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
                        <div class="section-title">✅ Validación de Surtido (${validaciones.length})</div>
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

    // Validación de campos requeridos
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

    // Verificar si cambió el conductor o la unidad
    const conductorChanged = oldRecord.operador !== operador;
    const unidadChanged = oldRecord.unidad !== unidad;

    let newFolio = oldRecord.folio;

    if (conductorChanged || unidadChanged) {
        // Extraer el folio de carga del folio actual (últimos 2 dígitos)
        const folioCarga = oldRecord.folio.split('-').pop();

        // Verificar si el folio puede ser usado por la nueva combinación
        if (!canUseFolio(operador, unidad, folioCarga)) {
            showNotification(`⚠️ El folio de carga ${folioCarga} no está disponible para ${operador}/${unidad}. Está siendo usado por otra combinación. Debes usar un conductor/unidad diferente.`, 'warning');
            return;
        }

        // Liberar el folio de la combinación anterior
        releaseFolio(folioCarga);

        // Marcar el folio como usado para la nueva combinación
        markFolioAsUsed(operador, unidad, folioCarga);

        // Regenerar el folio completo (la fecha sigue siendo la misma)
        newFolio = generateFolio(folioCarga);
    }

    // Update the record
    const updatedRecord = {
        ...oldRecord,
        operador: operador,
        unidad: unidad,
        cantidadDespachar: cantidadDespacharNum,
        notaDespacho: notaDespacho,
        folio: newFolio,
        lastModified: new Date().toISOString()
    };

    STATE.localValidated[recordIndex] = updatedRecord;

    // Save to localStorage
    try {
        localStorage.setItem('localValidated', JSON.stringify(STATE.localValidated));
        showNotification('✅ Cambios guardados exitosamente', 'success');

        // Trigger sync if available
        if (window.syncManager && typeof window.syncManager.syncData === 'function') {
            await window.syncManager.syncData();
        }

        // Update validated table
        renderValidatedTable();

        // Close modal
        closeInfoModal();
    } catch (error) {
        console.error('Error saving changes:', error);
        showNotification('❌ Error al guardar cambios: ' + error.message, 'error');
    }
}

async function confirmDispatch() {
    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const folioCarga = document.getElementById('modal-folio-carga')?.value || '';
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';

    // Validación de campos requeridos
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

    if (!STATE.currentOrder) {
        showNotification('❌ No hay orden seleccionada', 'error');
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
    document.getElementById('confirm-horario').textContent = orderData.expectedArrival || 'N/A';
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
    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const folioCarga = document.getElementById('modal-folio-carga')?.value || '';
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
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

    // Marcar el folio de carga como utilizado
    markFolioAsUsed(operador, unidad, folioCarga);

    // Generar folio con el folio de carga seleccionado
    const folio = generateFolio(folioCarga);

    // Estructura para Google Sheets: Folio, Fecha, Hora, Usuario, Orden, Destino, Horario, Código, Código 2, Estatus, Tarea, Estatus2, Incidencias, Operador, Unidad, Observaciones
    const dispatchRecord = {
        folio: folio,
        timestamp: timestamp.toISOString(),
        fecha: timestamp.toLocaleDateString('es-ES'),
        hora: timestamp.toLocaleTimeString('es-ES'),
        usuario: CURRENT_USER,
        orden: STATE.currentOrder,
        destino: orderData.recipient || '',
        horario: orderData.expectedArrival || '',
        codigo: orderData.trackingCode || '',
        codigo2: orderData.referenceNo || '',
        estatus: 'Procesado',
        tarea: 'Despacho',
        estatus2: 'Completado',
        incidencias: totalCajas !== cantidadDespacharNum ? `Parcial: ${cantidadDespacharNum}/${totalCajas}` : '',
        operador: operador,
        unidad: unidad,
        observaciones: notaDespacho,
        // Datos adicionales para UI
        cantidadDespachar: cantidadDespacharNum,
        totalCajas: totalCajas,
        qc: Object.keys(qcData).length > 0 ? qcData : null
    };

    // Guardar en validados locales primero (al inicio para mostrar las más recientes primero)
    STATE.localValidated.unshift(dispatchRecord);
    saveLocalState();

    // Agregar a la cola de sync usando el módulo compartido
    addToDispatchSync(dispatchRecord);

    // Intentar sincronizar si hay conexión
    if (IS_ONLINE && gapi?.client?.getToken()) {
        await syncPendingData();
    } else {
        showNotification('💾 Despacho guardado localmente - Se sincronizará cuando haya conexión', 'warning');
        updateSyncStatus();
    }

    closeInfoModal();
    showNotification(`✅ Despacho confirmado: ${STATE.currentOrder} (${folio})`, 'success');

    // Actualizar UI
    updateTabBadges();
    renderOrdersList();
    updateSummary();

    // Clear selections
    document.getElementById('modal-operador').value = '';
    document.getElementById('modal-unidad').value = '';
}

// ==================== SYNC MANAGEMENT ====================
// Usar el módulo compartido SyncManager
let syncManager = null;

function initSyncManager() {
    syncManager = new SyncManager({
        spreadsheetId: CONFIG.SPREADSHEET_WRITE,
        sheetName: 'BD',
        autoSyncInterval: 30000,
        storageKey: 'dispatch_pending_sync',
        appName: 'Despacho',
        appIcon: '🚚',
        // Estructura: Folio, Fecha, Hora, Usuario, Orden, Destino, Horario, Código, Código 2, Estatus, Tarea, Estatus2, Incidencias, Operador, Unidad, Observaciones
        formatRecord: (record) => {
            return [
                record.folio || '',
                record.fecha || '',
                record.hora || '',
                record.usuario || '',
                record.orden || '',
                record.destino || '',
                record.horario || '',
                record.codigo || record.trackingCode || '',
                record.codigo2 || record.referenceNo || '',
                record.estatus || 'Procesado',
                record.tarea || 'Despacho',
                record.estatus2 || 'Completado',
                record.incidencias || '',
                record.operador || '',
                record.unidad || '',
                record.observaciones || record.nota || ''
            ];
        },
        onStatusChange: () => {
            updateSummary();
            updateTabBadges();
        }
    });
    window.syncManager = syncManager;
    syncManager.init();
}

function updateTabBadges() {
    // Sidebar badges (if they exist)
    const validatedBadge = document.getElementById('validated-badge');
    const pendingBadge = document.getElementById('pending-badge');

    // Header badges (panel de búsqueda)
    const validatedBadgeHeader = document.getElementById('validated-badge-header');
    const pendingBadgeHeader = document.getElementById('pending-badge-header');

    // Header badges (panel de validadas)
    const validatedBadgeValidated = document.getElementById('validated-badge-validated');
    const pendingBadgeValidated = document.getElementById('pending-badge-validated');

    // Calculate counts
    const validatedCount = STATE.localValidated.length;

    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;
    let pendingCount = 0;

    for (const [orden] of dataToUse.entries()) {
        // Check if not in local validated
        const inLocalValidated = STATE.localValidated.some(v => v.orden === orden);
        // No verificar contra validación de surtido, solo contra despachos locales
        if (!inLocalValidated) {
            pendingCount++;
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
    if (validatedBadgeHeader) {
        validatedBadgeHeader.textContent = validatedCount;
    }

    if (pendingBadgeHeader) {
        pendingBadgeHeader.textContent = pendingCount;
    }

    // Update header badges (panel de validadas)
    if (validatedBadgeValidated) {
        validatedBadgeValidated.textContent = validatedCount;
    }

    if (pendingBadgeValidated) {
        pendingBadgeValidated.textContent = pendingCount;
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

function applyDateFilter() {
    const startDate = document.getElementById('date-start').value;
    const endDate = document.getElementById('date-end').value;

    if (!startDate || !endDate) {
        showNotification('⚠️ Debes seleccionar ambas fechas', 'warning');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        showNotification('⚠️ La fecha de inicio debe ser anterior a la fecha fin', 'warning');
        return;
    }

    STATE.dateFilter.startDate = startDate;
    STATE.dateFilter.endDate = endDate;
    STATE.dateFilter.active = true;

    filterOrdersByDateRange();
    
    // Verificar si es inicio de despacho
    const modal = document.getElementById('date-filter-modal');
    const isDispatchInit = modal.getAttribute('data-dispatch-init') === 'true';
    
    if (isDispatchInit) {
        // Activar panel de búsqueda
        modal.removeAttribute('data-dispatch-init');
        closeDateFilter();
        activateSearchPanelWithFilter();
    } else {
        // Solo actualizar filtro
        renderOrdersList();
        updateSummary();
        closeDateFilter();
    }

    const start = formatDateDDMMYYYY(new Date(startDate));
    const end = formatDateDDMMYYYY(new Date(endDate));

    // Actualizar botón de filtro
    const dateFilterText = document.getElementById('date-filter-text');
    if (dateFilterText) {
        dateFilterText.textContent = `${start} → ${end}`;
    }

    showNotification(`📅 Filtro aplicado: ${start} - ${end} (${STATE.obcDataFiltered.size} órdenes)`, 'success');
}

function clearDateFilter() {
    STATE.dateFilter.startDate = null;
    STATE.dateFilter.endDate = null;
    STATE.dateFilter.active = false;
    STATE.obcDataFiltered.clear();

    // Restaurar texto del botón
    const dateFilterText = document.getElementById('date-filter-text');
    if (dateFilterText) {
        dateFilterText.textContent = 'Filtrar Fecha';
    }

    renderOrdersList();
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

// ==================== GESTIÓN DE FOLIOS DE CARGA ====================

// Estado para el filtro de folios
let FOLIOS_DATE_FILTER = {
    startDate: null,
    endDate: null,
    active: false
};

// Variables para ordenamiento de tabla de folios
let foliosSortColumn = 1; // Por defecto ordenar por fecha
let foliosSortDirection = 'desc';

/**
 * Muestra el panel de gestión de folios
 */
function showFoliosManagement() {
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

    // Ocultar todos los demás paneles
    document.getElementById('welcome-state').style.display = 'none';
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('validated-content').style.display = 'none';
    document.getElementById('folios-content').style.display = 'block';

    // Renderizar la tabla de folios
    renderFoliosTable();
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
                horarios: []
            });
        }

        const folioData = foliosMap.get(folioCompleto);
        folioData.ordenes.push(record.orden);
        folioData.totalCajas += parseInt(record.cantidadDespachar) || 0;

        // Agregar horario si existe
        if (record.horario) {
            folioData.horarios.push(record.horario);
        }
    });

    return Array.from(foliosMap.values());
}

/**
 * Renderiza la tabla de folios
 */
function renderFoliosTable() {
    const tableBody = document.getElementById('folios-table-body');
    if (!tableBody) return;

    let folios = getAllFolios();

    // Aplicar filtro de fecha si está activo
    if (FOLIOS_DATE_FILTER.active && FOLIOS_DATE_FILTER.startDate && FOLIOS_DATE_FILTER.endDate) {
        const startDate = new Date(FOLIOS_DATE_FILTER.startDate);
        const endDate = new Date(FOLIOS_DATE_FILTER.endDate);

        folios = folios.filter(folio => {
            const folioDate = new Date(folio.fecha);
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
            case 2: // Cant. Cajas
                valA = a.totalCajas;
                valB = b.totalCajas;
                break;
            case 3: // Cant. Órdenes
                valA = a.ordenes.length;
                valB = b.ordenes.length;
                break;
            case 4: // Horario Inicial
                valA = a.horarios.length > 0 ? Math.min(...a.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                valB = b.horarios.length > 0 ? Math.min(...b.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                break;
            case 5: // Horario Final
                valA = a.horarios.length > 0 ? Math.max(...a.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                valB = b.horarios.length > 0 ? Math.max(...b.horarios.map(h => new Date(`2000-01-01 ${h}`).getTime())) : 0;
                break;
            case 6: // Conductor
                valA = a.conductor || '';
                valB = b.conductor || '';
                break;
            case 7: // Unidad
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

    // Actualizar contador
    const foliosCount = document.getElementById('folios-count');
    if (foliosCount) {
        foliosCount.textContent = `${folios.length} ${folios.length === 1 ? 'folio' : 'folios'}`;
    }

    if (folios.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="table-empty-state">
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

        return `
            <tr>
                <td><span class="order-code">${makeCopyable(folio.folio)}</span></td>
                <td>${folio.fecha}</td>
                <td style="text-align: center;">${folio.totalCajas}</td>
                <td style="text-align: center;">${folio.ordenes.length}</td>
                <td>${horarioInicial}</td>
                <td>${horarioFinal}</td>
                <td>${folio.conductor || '<span class="empty-cell">N/A</span>'}</td>
                <td>${folio.unidad || '<span class="empty-cell">N/A</span>'}</td>
                <td>
                    <div style="display: flex; gap: 8px; justify-content: center;">
                        <button class="btn-action print" onclick="printFolioDelivery('${folio.folio}')" title="Imprimir Folio de Entrega">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                                <rect x="6" y="14" width="12" height="8"></rect>
                            </svg>
                        </button>
                        <button class="btn-action view" onclick="viewFolioOrders('${folio.folio}')" title="Ver Órdenes">
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
    const filterInput = document.getElementById('filter-folios');
    if (!filterInput) return;

    const filterValue = filterInput.value.toLowerCase();
    const tableBody = document.getElementById('folios-table-body');
    if (!tableBody) return;

    const rows = tableBody.querySelectorAll('tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(filterValue) ? '' : 'none';
    });
}

/**
 * Muestra el modal de filtro de fechas para folios
 */
function showFoliosDateFilter() {
    const modal = document.getElementById('folios-date-filter-modal');
    if (modal) {
        modal.classList.add('show');

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
        modal.classList.remove('show');
    }
}

/**
 * Aplica el filtro de fechas para folios
 */
function applyFoliosDateFilter() {
    const startDate = document.getElementById('folios-date-start').value;
    const endDate = document.getElementById('folios-date-end').value;

    if (!startDate || !endDate) {
        showNotification('⚠️ Selecciona ambas fechas', 'warning');
        return;
    }

    FOLIOS_DATE_FILTER.startDate = startDate;
    FOLIOS_DATE_FILTER.endDate = endDate;
    FOLIOS_DATE_FILTER.active = true;

    // Actualizar texto del botón
    const filterText = document.getElementById('folios-date-filter-text');
    if (filterText) {
        filterText.textContent = `${startDate} → ${endDate}`;
    }

    closeFoliosDateFilter();
    renderFoliosTable();
    showNotification('✅ Filtro aplicado', 'success');
}

/**
 * Limpia el filtro de fechas para folios
 */
function clearFoliosDateFilter() {
    FOLIOS_DATE_FILTER.startDate = null;
    FOLIOS_DATE_FILTER.endDate = null;
    FOLIOS_DATE_FILTER.active = false;

    document.getElementById('folios-date-start').value = '';
    document.getElementById('folios-date-end').value = '';

    // Restaurar texto del botón
    const filterText = document.getElementById('folios-date-filter-text');
    if (filterText) {
        filterText.textContent = 'Filtrar Fecha';
    }

    closeFoliosDateFilter();
    renderFoliosTable();
    showNotification('✅ Filtro eliminado', 'success');
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

/**
 * Filtra las órdenes validadas por folio de carga
 */
function viewFolioOrders(folioCompleto) {
    // Primero cerrar el panel de folios
    document.getElementById('folios-content').style.display = 'none';

    // Marcar que venimos desde folios para deshabilitar botón Pendientes
    STATE.fromFolios = true;

    // Cambiar a la vista de órdenes validadas
    switchValidationTab('validated');

    // Deshabilitar botón Pendientes cuando venimos desde folios
    const togglePendingValidated = document.getElementById('toggle-pending-validated');
    if (togglePendingValidated) {
        togglePendingValidated.disabled = true;
        togglePendingValidated.style.opacity = '0.5';
        togglePendingValidated.style.cursor = 'not-allowed';
        togglePendingValidated.title = 'No disponible cuando se visualiza desde folios';
    }

    // Aplicar filtro por folio en la tabla de validadas
    const filterInput = document.getElementById('filter-validated');
    if (filterInput) {
        filterInput.value = folioCompleto;

        // Disparar el evento de input manualmente para activar el filtro
        const event = new Event('input', { bubbles: true });
        filterInput.dispatchEvent(event);

        // También llamar directamente a la función de filtrado
        filterValidatedTable();
    }

    showNotification(`📋 Mostrando órdenes del folio ${folioCompleto}`, 'info');
}

/**
 * Imprime el folio de entrega (PDF)
 */
function printFolioDelivery(folioCompleto) {
    // Obtener todas las órdenes del folio
    const ordenesDelFolio = STATE.localValidated.filter(record => record.folio === folioCompleto);

    if (ordenesDelFolio.length === 0) {
        showNotification('⚠️ No hay órdenes en este folio', 'warning');
        return;
    }

    // Obtener información consolidada del folio
    const primeraOrden = ordenesDelFolio[0];
    const conductor = primeraOrden.conductor || 'N/A';
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

    ordenesDelFolio.forEach(record => {
        const orderData = STATE.obcData.get(record.orden) || {};
        const validaciones = STATE.validacionData.get(record.orden) || [];
        const destinoOrden = record.destino || orderData.recipient || 'N/A';

        // Procesar cada caja validada
        validaciones.forEach(caja => {
            const codigoCompleto = caja.codigoCaja || '';
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
    const totalOrdenes = ordenesDelFolio.length;
    const totalCajas = cajasList.reduce((sum, item) => sum + item.cantidad, 0);

    // Verificar si hay códigos base válidos
    console.log('📋 Datos para impresión:', { cajasList, totalOrdenes, totalCajas });

    // Generar HTML del documento
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
                    font-family: Arial, sans-serif;
                    font-size: 11pt;
                    line-height: 1.4;
                    color: #1e293b;
                    background: white;
                }

                .header {
                    text-align: center;
                    margin-bottom: 20px;
                    border-bottom: 2px solid #cbd5e1;
                    padding-bottom: 15px;
                }

                .header h1 {
                    margin: 0;
                    font-size: 20pt;
                    color: #1e293b;
                    font-weight: 700;
                }

                .header h2 {
                    margin: 5px 0 0 0;
                    font-size: 14pt;
                    color: #64748b;
                    font-weight: 500;
                }

                .info-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 12px;
                    margin-bottom: 20px;
                    background: #f8fafc;
                    padding: 16px;
                    border-radius: 8px;
                    border: 1px solid #e2e8f0;
                }

                .info-item {
                    display: flex;
                    gap: 8px;
                    align-items: baseline;
                }

                .info-label {
                    font-weight: 600;
                    color: #475569;
                    min-width: 120px;
                }

                .info-value {
                    color: #1e293b;
                    font-weight: 500;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 15px;
                    border: 1px solid #e2e8f0;
                }

                th {
                    background: #f1f5f9;
                    color: #475569;
                    padding: 10px 8px;
                    text-align: left;
                    font-size: 10pt;
                    font-weight: 600;
                    border-bottom: 2px solid #cbd5e1;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }

                td {
                    padding: 8px;
                    border-bottom: 1px solid #e2e8f0;
                    font-size: 10pt;
                    color: #334155;
                }

                tbody tr:nth-child(even) {
                    background: #f8fafc;
                }

                tbody tr:hover {
                    background: #f1f5f9;
                }

                .codigo-base {
                    font-family: 'Courier New', monospace;
                    background: #e2e8f0;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-weight: 600;
                    color: #1e293b;
                }

                .table-footer {
                    margin-top: 20px;
                    padding-top: 15px;
                    border-top: 2px solid #cbd5e1;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .footer-info {
                    font-size: 9pt;
                    color: #64748b;
                }

                @media print {
                    body {
                        print-color-adjust: exact;
                        -webkit-print-color-adjust: exact;
                    }
                    .info-grid {
                        background: #f8fafc;
                    }
                    tbody tr:nth-child(even) {
                        background: #f8fafc;
                    }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📋 FOLIO DE ENTREGA</h1>
                <h2>${folioCompleto}</h2>
            </div>

            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">👤 Conductor:</span>
                    <span class="info-value">${conductor}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">🚛 Unidad:</span>
                    <span class="info-value">${unidad}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">📍 Destino:</span>
                    <span class="info-value">${destino}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">⏰ Horario Inicial:</span>
                    <span class="info-value">${horarioInicial}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">⏰ Horario Final:</span>
                    <span class="info-value">${horarioFinal}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">📦 Total Órdenes:</span>
                    <span class="info-value">${totalOrdenes}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">📦 Total Cajas:</span>
                    <span class="info-value">${totalCajas}</span>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 50px;">#</th>
                        <th>Destino</th>
                        <th>Orden</th>
                        <th>Código de Caja (Base)</th>
                        <th style="width: 120px; text-align: center;">Cantidad de Cajas</th>
                    </tr>
                </thead>
                <tbody>
                    ${cajasList.map((item, index) => `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${item.destino || 'N/A'}</td>
                            <td>${item.orden || 'N/A'}</td>
                            <td><span class="codigo-base">${item.codigoBase || 'N/A'}</span></td>
                            <td style="text-align: center;"><strong>${item.cantidad || 0}</strong></td>
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
