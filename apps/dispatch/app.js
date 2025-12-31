// ==================== CONFIGURATION ====================
const CONFIG = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
    SPREADSHEET_WRITE: '1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o',
    // Spreadsheet ID principal para consolidación de órdenes
    SPREADSHEET_ORDENES_ID: '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck',
    SOURCES: {
        // Pestaña "Resumen" - Órdenes consolidadas por OBC (Opción B - optimizada)
        RESUMEN_ORDENES: 'https://docs.google.com/spreadsheets/d/1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck/export?format=csv&gid=409854413',
        // Pestaña "BD" - Listado caja por caja (respaldo para consolidación manual si es necesario)
        BD_CAJAS: 'https://docs.google.com/spreadsheets/d/1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck/export?format=csv&gid=0',
        // Base de datos de validación TRS (OBC BD)
        OBC_BD: 'https://docs.google.com/spreadsheets/d/1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck/export?format=csv&gid=218802190',
        // Otras fuentes (mantener las originales para rastreo y listas)
        MNE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRHzXpt4q7KYo8QMnrO92LGcXQbx14lBCQ0wxHGHm2Lz4v5RCJCpQHmS0NhUTHUCCG2Hc1bkvTYhdpz/pub?gid=883314398&single=true&output=csv',
        TRS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ2NOvCCzIW0IS9ANzOYl7GKBq5I-XQM9e_V1tu_2VrDMq4Frgjol5uj6-4dBgEQcfB8b-k6ovaOJGc/pub?output=csv',
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
    folioCounter: 0        // Contador de folios
};

// Cargar estado local al inicio
function loadLocalState() {
    try {
        const saved = localStorage.getItem('dispatch_local_state');
        if (saved) {
            const data = JSON.parse(saved);
            STATE.localValidated = data.localValidated || [];
            STATE.localPending = data.localPending || [];
            STATE.folioCounter = data.folioCounter || 0;
        }
    } catch (e) {
        console.error('Error loading local state:', e);
    }
}

function saveLocalState() {
    try {
        localStorage.setItem('dispatch_local_state', JSON.stringify({
            localValidated: STATE.localValidated,
            localPending: STATE.localPending,
            folioCounter: STATE.folioCounter
        }));
    } catch (e) {
        console.error('Error saving local state:', e);
    }
}

function generateFolio() {
    STATE.folioCounter++;
    saveLocalState();
    const date = new Date();
    const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `DSP-${dateStr}-${String(STATE.folioCounter).padStart(4, '0')}`;
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

let CURRENT_USER = '';
let USER_EMAIL = '';
let USER_GOOGLE_NAME = '';
let IS_ONLINE = navigator.onLine;
let TOKEN_CLIENT = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    loadLocalState();
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
            { label: '➕ Nuevo Despacho', onClick: 'showSearchPanel()', class: 'sidebar-btn-primary' },
            { label: '📅 Filtrar por Fecha', onClick: 'showDateFilter()', class: 'sidebar-btn-secondary' },
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

    // Load RESUMEN_ORDENES (Opción B - consolidado por OBC desde pestaña Resumen)
    try {
        const resumenResponse = await fetch(CONFIG.SOURCES.RESUMEN_ORDENES);
        const resumenCsv = await resumenResponse.text();
        parseOBCData(resumenCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading RESUMEN_ORDENES:', e);
        errors.push('RESUMEN_ORDENES');
    }

    // Load BD_CAJAS (Listado caja por caja - CRÍTICO para búsqueda de códigos)
    try {
        const bdCajasResponse = await fetch(CONFIG.SOURCES.BD_CAJAS);
        const bdCajasCsv = await bdCajasResponse.text();
        parseBDCajasData(bdCajasCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading BD_CAJAS:', e);
        errors.push('BD_CAJAS');
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

    // Load OBC_BD (Base de validación - gid=218802190)
    try {
        const validacionResponse = await fetch(CONFIG.SOURCES.OBC_BD);
        const validacionCsv = await validacionResponse.text();
        parseValidacionData(validacionCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading OBC_BD (validación):', e);
        errors.push('OBC_BD');
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
    STATE.bdCajasData.clear();

    // Map para contar cajas por OBC
    const cajasCountMap = new Map();

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 9) {
            const obc = cols[0]?.trim();
            const codigo = cols[8]?.trim();

            if (obc && codigo) {
                const codigoUpper = codigo.toUpperCase();

                // Indexar por código de caja para búsqueda rápida
                if (!STATE.bdCajasData.has(codigoUpper)) {
                    STATE.bdCajasData.set(codigoUpper, []);
                }
                STATE.bdCajasData.get(codigoUpper).push({
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

                // Contar cajas por OBC (cada fila = 1 caja)
                cajasCountMap.set(obc, (cajasCountMap.get(obc) || 0) + 1);
            }
        }
    }

    // Actualizar totalCajas en obcData basado en el conteo real de la pestaña BD
    cajasCountMap.forEach((count, obc) => {
        if (STATE.obcData.has(obc)) {
            const orderData = STATE.obcData.get(obc);
            orderData.totalCajas = count; // Sobrescribir con el conteo real
            orderData.totalCajasCalculado = true; // Marcar como calculado dinámicamente
        }
    });

    console.log(`✅ BD Cajas parsed: ${STATE.bdCajasData.size} códigos únicos, ${cajasCountMap.size} órdenes con conteo actualizado`);
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

    for (const [orden, data] of STATE.obcData.entries()) {
        if (data.expectedArrival) {
            const orderDate = parseOrderDate(data.expectedArrival);
            if (orderDate && orderDate >= startDate && orderDate <= endDate) {
                STATE.obcDataFiltered.set(orden, data);
            }
        }
    }
}

function parseOrderDate(dateStr) {
    if (!dateStr) return null;

    let date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;

    const parts = dateStr.split(/[/-]/);
    if (parts.length === 3) {
        const d = parseInt(parts[0]);
        const m = parseInt(parts[1]);
        const y = parseInt(parts[2]);
        const year = y < 100 ? 2000 + y : y;

        date = new Date(year, m - 1, d);
        if (!isNaN(date.getTime())) return date;
    }

    return null;
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
                    <span class="rastreo-icon">${tieneRastreo ? '✅' : '❌'}</span>
                </td>
                <td>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </td>
                <td onclick="event.stopPropagation(); showOrderInfo('${orden}')">
                    <button class="btn-action">📦 Despachar</button>
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
                    <span class="rastreo-icon">${tieneRastreo ? '✅' : '❌'}</span>
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
function executeSearch() {
    const searchInput = document.getElementById('search-input');
    const query = searchInput?.value.trim().toUpperCase();

    if (!query) {
        showNotification('⚠️ Ingresa un código para buscar', 'warning');
        return;
    }

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

        // PRIORIDAD 1: Código COMPLETO en BD Cajas
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

        // PRIORIDAD 2: Código BASE en BD Cajas
        if (foundOrders.length === 0 && codeBase !== query) {
            for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
                if (codigo.includes(codeBase)) {
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
        if (notaDespachoInput && savedData.notaDespacho) {
            notaDespachoInput.value = savedData.notaDespacho;
        }

        // Change button text to "Guardar cambios" for validated orders
        const confirmBtn = document.getElementById('confirm-dispatch-btn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '💾 Guardar Cambios';
            confirmBtn.onclick = function() { saveValidatedOrderChanges(orden); };
        }
    } else {
        // Reset button for non-validated orders
        const confirmBtn = document.getElementById('confirm-dispatch-btn');
        if (confirmBtn) {
            confirmBtn.innerHTML = '✅ Confirmar Despacho';
            confirmBtn.onclick = function() { confirmDispatch(); };
        }
    }

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
                        <div class="section-title">📦 Detalle Completo de Cajas OBC <span class="section-badge">${allBoxes.length} cajas</span></div>
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
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';

    // Validación de campos requeridos
    if (!operador || !unidad) {
        showNotification('⚠️ Debes seleccionar conductor y unidad', 'warning');
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

    // Update the record
    const updatedRecord = {
        ...STATE.localValidated[recordIndex],
        operador: operador,
        unidad: unidad,
        cantidadDespachar: cantidadDespacharNum,
        notaDespacho: notaDespacho,
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
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';

    // Validación de campos requeridos
    if (!operador || !unidad) {
        showNotification('⚠️ Debes seleccionar conductor y unidad', 'warning');
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

    // Validación de discrepancia en cantidad
    const validaciones = STATE.validacionData.get(STATE.currentOrder) || [];
    const rastreoData = STATE.mneData.get(STATE.currentOrder) || [];
    const totalCajas = rastreoData.length || validaciones.length;
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
    // Cerrar modal de confirmación
    closeConfirmDispatch();

    const operador = document.getElementById('modal-operador')?.value || '';
    const unidad = document.getElementById('modal-unidad')?.value || '';
    const cantidadDespachar = document.getElementById('cantidad-despachar')?.value || '';
    const notaDespacho = document.getElementById('nota-despacho')?.value?.trim() || '';

    const orderData = STATE.obcData.get(STATE.currentOrder);
    const validaciones = STATE.validacionData.get(STATE.currentOrder) || [];
    const rastreoData = STATE.mneData.get(STATE.currentOrder) || [];
    const totalCajas = rastreoData.length || validaciones.length;
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
    const folio = generateFolio();

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

    // Guardar en validados locales primero
    STATE.localValidated.push(dispatchRecord);
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

    const start = new Date(startDate).toLocaleDateString('es-ES');
    const end = new Date(endDate).toLocaleDateString('es-ES');
    showNotification(`📅 Filtro aplicado: ${start} - ${end} (${STATE.obcDataFiltered.size} órdenes)`, 'success');
}

function clearDateFilter() {
    STATE.dateFilter.startDate = null;
    STATE.dateFilter.endDate = null;
    STATE.dateFilter.active = false;
    STATE.obcDataFiltered.clear();

    renderOrdersList();
    updateSummary();
    closeDateFilter();

    showNotification('🔄 Filtro de fecha eliminado', 'info');
}

// ==================== EXPORT ====================
function exportData() {
    const dataToExport = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;

    if (dataToExport.size === 0) {
        showNotification('⚠️ No hay datos para exportar', 'warning');
        return;
    }

    let csv = 'Orden,Referencia,Servicio,Tracking,Llegada Esperada,Destino,Tipo Caja,Observaciones\n';

    for (const [orden, data] of dataToExport.entries()) {
        csv += `"${data.orden}","${data.referenceNo}","${data.shippingService}","${data.trackingCode}","${data.expectedArrival}","${data.recipient}","${data.boxType}","${data.remark}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `despacho_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    showNotification('✅ Datos exportados', 'success');
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
