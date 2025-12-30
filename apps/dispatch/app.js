// ==================== CONFIGURATION ====================
const CONFIG = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
    SPREADSHEET_WRITE: '1T_yXd4MFyp-Ks2iTTr0KAd12QhXjW2eUMVqnAx8XSJM',
    SOURCES: {
        BD_STOCK: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-HG8HPf-94Ki5Leo5iEF5pyqsiD9CVk-mcl-F8BAw34kT0s3nzNn532YTYDCtkG76NbauiVx0Ffmd/pub?output=csv',
        OBC_BD: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSdSDQ8ktYA3YAsWMUokYd_S6_rANUz8XdfEAjsV-v0eAlfiYZctHuj3hP4m3wOghf4rnT_YvuA4BPA/pub?output=csv',
        VALIDACION: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTZMZZCDtTFCebvsme1GMEBiZ1S2Cloh37AR8hHFAwhFPNEMD27G04bzX0theCMJE-nlYOyH2ev115q/pub?output=csv',
        MNE: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRHzXpt4q7KYo8QMnrO92LGcXQbx14lBCQ0wxHGHm2Lz4v5RCJCpQHmS0NhUTHUCCG2Hc1bkvTYhdpz/pub?gid=883314398&single=true&output=csv',
        TRS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ2NOvCCzIW0IS9ANzOYl7GKBq5I-XQM9e_V1tu_2VrDMq4Frgjol5uj6-4dBgEQcfB8b-k6ovaOJGc/pub?output=csv',
        LISTAS: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbzg922y1KMVnV0JqBijR43Ma8e5X_AO2KVzjHBnRtGBx-0aXLZ8UUlKCO_XHOpV1qfggQyNjtqde/pub?gid=799838428&single=true&output=csv'
    }
};

// ==================== STATE ====================
let STATE = {
    obcData: new Map(),
    obcDataFiltered: new Map(),
    validacionData: new Map(),
    mneData: new Map(),
    trsData: [],
    operadores: [],
    unidades: [],
    currentOrder: null,
    dateFilter: {
        startDate: null,
        endDate: null,
        active: false
    },
    pendingSync: []
};

let CURRENT_USER = '';
let USER_EMAIL = '';
let USER_GOOGLE_NAME = '';
let IS_ONLINE = navigator.onLine;
let TOKEN_CLIENT = null;

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    setupConnectionMonitoring();
    loadPendingSync();
    gapi.load('client', initGAPI);
});

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
}

function handleLogout() {
    if (gapi.client.getToken()) {
        google.accounts.oauth2.revoke(gapi.client.getToken().access_token);
        gapi.client.setToken(null);
    }
    location.reload();
}

function updateUserFooter() {
    const avatar = document.getElementById('user-avatar');
    const nameDisplay = document.getElementById('user-name-display');

    if (avatar) {
        avatar.textContent = CURRENT_USER ? CURRENT_USER.charAt(0).toUpperCase() : '?';
        avatar.onclick = changeUserAlias;
    }
    if (nameDisplay) {
        nameDisplay.textContent = CURRENT_USER || 'No conectado';
        nameDisplay.onclick = changeUserAlias;
    }
}

function changeUserAlias() {
    const newAlias = prompt('Ingresa tu nombre:', CURRENT_USER);
    if (newAlias && newAlias.trim()) {
        CURRENT_USER = newAlias.trim();
        localStorage.setItem(`dispatch_alias_${USER_EMAIL}`, CURRENT_USER);
        updateUserFooter();
    }
}

// ==================== DATA LOADING ====================
async function loadAllData() {
    showNotification('🔄 Cargando datos...', 'info');

    let errors = [];
    let loaded = 0;

    // Load OBC_BD
    try {
        const obcResponse = await fetch(CONFIG.SOURCES.OBC_BD);
        const obcCsv = await obcResponse.text();
        parseOBCData(obcCsv);
        loaded++;
    } catch (e) {
        console.error('Error loading OBC_BD:', e);
        errors.push('OBC');
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

    // Load VALIDACION (Val3)
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

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 6) {
            const orden = cols[0]?.trim();
            if (orden) {
                STATE.obcData.set(orden, {
                    orden,
                    referenceNo: cols[1]?.trim() || '',
                    shippingService: cols[2]?.trim() || '',
                    trackingCode: cols[3]?.trim() || '',
                    expectedArrival: cols[4]?.trim() || '',
                    remark: cols[5]?.trim() || '',
                    recipient: cols[6]?.trim() || '',
                    boxType: cols[7]?.trim() || '',
                    customBarcode: cols[8]?.trim() || ''
                });
            }
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
    const bdCount = document.getElementById('bd-count');
    const bdUpdateTime = document.getElementById('bd-update-time');

    if (bdCount) bdCount.textContent = STATE.obcData.size;
    if (bdUpdateTime) bdUpdateTime.textContent = new Date().toLocaleTimeString();
}

// ==================== UI FUNCTIONS ====================
function showSearchPanel() {
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('search-panel').style.display = 'block';

    // Set default date range to today + 7 days
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7);

    STATE.dateFilter.startDate = today.toISOString().slice(0, 10);
    STATE.dateFilter.endDate = endDate.toISOString().slice(0, 10);
    STATE.dateFilter.active = true;

    filterOrdersByDateRange();
    renderOrdersList();
    updateSummary();

    setTimeout(() => {
        document.getElementById('search-input')?.focus();
    }, 100);
}

function backToStart() {
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('empty-state').style.display = 'flex';
    STATE.dateFilter.active = false;
    STATE.obcDataFiltered.clear();
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

    document.getElementById('summary-total').textContent = totalToday;
    document.getElementById('summary-validated').textContent = validatedToday;
    document.getElementById('summary-pending').textContent = pendingToday;
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

function renderOrdersList() {
    const ordersList = document.getElementById('orders-list');
    if (!ordersList) return;

    const dataToUse = STATE.dateFilter.active ? STATE.obcDataFiltered : STATE.obcData;

    if (dataToUse.size === 0) {
        ordersList.innerHTML = `
            <div class="orders-list-empty">
                <div class="orders-list-empty-icon">📭</div>
                <div class="orders-list-empty-text">No hay órdenes</div>
                <div class="orders-list-empty-subtext">Ajusta el filtro de fechas</div>
            </div>
        `;
        return;
    }

    const ordersArray = Array.from(dataToUse.entries());
    ordersList.innerHTML = ordersArray.map(([orden, data]) => {
        const validaciones = STATE.validacionData.get(orden);
        const isValidated = validaciones && validaciones.length > 0;
        const statusClass = isValidated ? 'validated' : 'pending';
        const statusBadge = isValidated ? 'validated' : 'pending';
        const statusText = isValidated ? '✅ Validada' : '⏳ Pendiente';

        return `
            <div class="order-item ${statusClass}" onclick="showOrderInfo('${orden}')">
                <div class="order-item-info">
                    <div class="order-item-obc">${orden}</div>
                    <div class="order-item-meta">
                        <span>🏢 ${data.recipient || 'Sin destino'}</span>
                        <span>📅 ${data.expectedArrival || 'Sin fecha'}</span>
                    </div>
                </div>
                <div class="order-item-actions">
                    <span class="order-item-badge ${statusBadge}">${statusText}</span>
                </div>
            </div>
        `;
    }).join('');
}

function filterOrdersList() {
    const filterText = document.getElementById('filter-orders')?.value.toLowerCase() || '';
    const filterStatus = document.getElementById('filter-status')?.value || 'all';

    const items = document.querySelectorAll('.order-item');
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        const isValidated = item.classList.contains('validated');

        const matchesText = text.includes(filterText);
        const matchesStatus = filterStatus === 'all' ||
            (filterStatus === 'validated' && isValidated) ||
            (filterStatus === 'pending' && !isValidated);

        item.style.display = matchesText && matchesStatus ? 'flex' : 'none';
    });
}

// ==================== SEARCH ====================
function executeSearch() {
    const searchInput = document.getElementById('search-input');
    const query = searchInput?.value.trim().toUpperCase();

    if (!query) {
        showNotification('⚠️ Ingresa un código para buscar', 'warning');
        return;
    }

    // Buscar por OBC exacto
    if (STATE.obcData.has(query)) {
        showOrderInfo(query);
        searchInput.value = '';
        return;
    }

    // Buscar por OBC parcial
    for (const orden of STATE.obcData.keys()) {
        if (orden.includes(query)) {
            showOrderInfo(orden);
            searchInput.value = '';
            return;
        }
    }

    // Buscar por código de caja en customBarcode
    for (const [orden, data] of STATE.obcData.entries()) {
        if (data.customBarcode && data.customBarcode.toUpperCase().includes(query)) {
            showNotification(`📦 Código encontrado en orden: ${orden}`, 'success');
            showOrderInfo(orden);
            searchInput.value = '';
            return;
        }
    }

    // Buscar en validaciones (códigos de caja escaneados)
    for (const [orden, validaciones] of STATE.validacionData.entries()) {
        if (validaciones.some(v => v.codigo && v.codigo.toUpperCase().includes(query))) {
            showNotification(`📦 Código de caja encontrado en: ${orden}`, 'success');
            showOrderInfo(orden);
            searchInput.value = '';
            return;
        }
    }

    // Buscar en rastreo MNE (códigos de tracking)
    for (const [orden, rastreoItems] of STATE.mneData.entries()) {
        if (rastreoItems.some(r => (r.codigo && r.codigo.toUpperCase().includes(query)) ||
                                    (r.ib && r.ib.toUpperCase().includes(query)))) {
            showNotification(`📍 Código de rastreo encontrado en: ${orden}`, 'success');
            showOrderInfo(orden);
            searchInput.value = '';
            return;
        }
    }

    showNotification('❌ No se encontró la orden o código en la base de datos', 'error');
}

// ==================== ORDER INFO MODAL ====================
function showOrderInfo(orden) {
    const orderData = STATE.obcData.get(orden);
    if (!orderData) {
        showNotification('❌ Orden no encontrada', 'error');
        return;
    }

    STATE.currentOrder = orden;

    // Update modal title
    document.getElementById('modal-title-text').textContent = `Orden ${orden}`;

    // Render KPI Cards
    renderKPICards(orderData);

    // Render Modal Body with sections
    renderModalBody(orden, orderData);

    // Show modal
    document.getElementById('info-modal').classList.add('show');
}

function renderKPICards(orderData) {
    const kpiCards = document.getElementById('kpi-cards');
    const validaciones = STATE.validacionData.get(orderData.orden) || [];
    const cajasValidadas = validaciones.length;
    const rastreoData = STATE.mneData.get(orderData.orden) || [];
    const totalCajas = rastreoData.length || cajasValidadas;

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
            <div class="kpi-card-value copyable">
                <span>${orderData.orden}</span>
                <span class="copy-icon" onclick="event.stopPropagation(); copyToClipboard('${orderData.orden}', this)">📋</span>
            </div>
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
                        <div class="general-info-value copyable">
                            <span>${orderData.orden}</span>
                            <span class="copy-icon" onclick="copyToClipboard('${orderData.orden}', this)">📋</span>
                        </div>
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
                        <div class="general-info-value copyable">
                            <span>${orderData.referenceNo || 'N/A'}</span>
                            ${orderData.referenceNo && orderData.referenceNo !== 'N/A' ? `<span class="copy-icon" onclick="copyToClipboard('${orderData.referenceNo}', this)">📋</span>` : ''}
                        </div>
                    </div>
                    <div class="general-info-field">
                        <div class="general-info-label">CÓDIGO TRACK</div>
                        <div class="general-info-value copyable">
                            <span>${orderData.trackingCode || 'N/A'}</span>
                            ${orderData.trackingCode ? `<span class="copy-icon" onclick="copyToClipboard('${orderData.trackingCode}', this)">📋</span>` : ''}
                        </div>
                    </div>

                    <!-- Fila 2: Distribución Mixta (1fr 1fr 3fr) -->
                    <div class="row-2">
                        <div class="general-info-field">
                            <div class="general-info-label">CANT. CAJAS</div>
                            <div class="general-info-value">${rastreoData.length || validaciones.length || 'N/A'}</div>
                        </div>
                        <div class="general-info-field editable">
                            <div class="general-info-label">CANT. DESPACHAR</div>
                            <input type="number" class="general-info-input" id="cantidad-despachar" placeholder="Cantidad..." min="0">
                        </div>
                        <div class="general-info-field editable">
                            <div class="general-info-label">NOTA</div>
                            <textarea class="general-info-textarea" id="nota-despacho" placeholder="Observaciones del despacho..." rows="2"></textarea>
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
                                        <td><code>${v.codigo}</code></td>
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
                                        <td>${r.ib}</td>
                                        <td><code>${r.codigo}</code></td>
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
                                        <td><code class="highlight">${t.matchParam}</code></td>
                                        <td><code>${t.trs}</code></td>
                                        <td>${t.referencia}</td>
                                        <td><code>${t.codigoOriginal || '-'}</code></td>
                                        <td><code>${t.codigoNuevo || '-'}</code></td>
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
            const tipoDiscrepancia = cantidadDespacharNum < totalCajas ? 'parcial' : 'excedente';
            const mensaje = cantidadDespacharNum < totalCajas
                ? `⚠️ DESPACHO PARCIAL DETECTADO\n\nCajas totales: ${totalCajas}\nCantidad a despachar: ${cantidadDespacharNum}\n\nDebe ingresar una NOTA explicando el motivo del despacho parcial.`
                : `⚠️ DISCREPANCIA DETECTADA\n\nCajas totales: ${totalCajas}\nCantidad a despachar: ${cantidadDespacharNum}\n\nDebe ingresar una NOTA explicando esta diferencia.`;

            alert(mensaje);
            document.getElementById('nota-despacho').focus();
            return;
        }
    }

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
    const dispatchRecord = {
        timestamp: timestamp.toISOString(),
        fecha: timestamp.toLocaleDateString('es-ES'),
        hora: timestamp.toLocaleTimeString('es-ES'),
        usuario: CURRENT_USER,
        orden: STATE.currentOrder,
        destino: orderData.recipient,
        operador: operador,
        unidad: unidad,
        trackingCode: orderData.trackingCode,
        referenceNo: orderData.referenceNo,
        cantidadDespachar: cantidadDespacharNum,
        totalCajas: totalCajas,
        nota: notaDespacho,
        qc: Object.keys(qcData).length > 0 ? qcData : null
    };

    // Save to pending sync
    STATE.pendingSync.push(dispatchRecord);
    savePendingSync();

    // Try to sync if online
    if (IS_ONLINE && gapi?.client?.getToken()) {
        await syncPendingData();
    } else {
        showNotification('💾 Despacho guardado localmente - Se sincronizará cuando haya conexión', 'warning');
        updateSyncStatus();
    }

    closeInfoModal();
    showNotification(`✅ Despacho confirmado: ${STATE.currentOrder}`, 'success');

    // Clear selections
    document.getElementById('modal-operador').value = '';
    document.getElementById('modal-unidad').value = '';
}

// ==================== SYNC MANAGEMENT ====================
function loadPendingSync() {
    try {
        const saved = localStorage.getItem('dispatch_pending_sync');
        if (saved) {
            STATE.pendingSync = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Error loading pending sync:', e);
    }
}

function savePendingSync() {
    try {
        localStorage.setItem('dispatch_pending_sync', JSON.stringify(STATE.pendingSync));
    } catch (e) {
        console.error('Error saving pending sync:', e);
    }
}

async function syncPendingData() {
    if (!gapi?.client?.getToken() || !IS_ONLINE || STATE.pendingSync.length === 0) {
        return;
    }

    showNotification('🔄 Sincronizando despachos...', 'info');

    try {
        const values = STATE.pendingSync.map(record => [
            record.fecha,
            record.hora,
            record.usuario,
            record.orden,
            record.destino,
            record.operador,
            record.unidad,
            record.trackingCode,
            record.referenceNo
        ]);

        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: 'Despachos!A:I',
            valueInputOption: 'USER_ENTERED',
            resource: { values }
        });

        STATE.pendingSync = [];
        savePendingSync();
        updateSyncStatus();
        showNotification(`✅ ${values.length} despachos sincronizados`, 'success');
    } catch (error) {
        console.error('Sync error:', error);
        showNotification('❌ Error sincronizando datos', 'error');
    }
}

function updateSyncStatus() {
    const syncStatus = document.getElementById('sync-status-sidebar');
    if (!syncStatus) return;

    if (STATE.pendingSync.length > 0) {
        syncStatus.className = 'sync-status sync-warning';
        syncStatus.textContent = `⚠️ ${STATE.pendingSync.length} pendientes`;
    } else if (IS_ONLINE && gapi?.client?.getToken()) {
        syncStatus.className = 'sync-status sync-ok';
        syncStatus.textContent = '✅ Sincronizado';
    } else {
        syncStatus.className = 'sync-status sync-error';
        syncStatus.textContent = '❌ Sin conexión';
    }
}

function showSyncPanel() {
    if (STATE.pendingSync.length === 0) {
        showNotification('✅ No hay registros pendientes', 'success');
        return;
    }

    const message = `Hay ${STATE.pendingSync.length} despachos pendientes de sincronizar.\n\n¿Deseas sincronizar ahora?`;
    if (confirm(message)) {
        syncPendingData();
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
    document.getElementById('date-filter-modal').classList.remove('show');
}

function applyDateFilter() {
    const startDate = document.getElementById('date-start').value;
    const endDate = document.getElementById('date-end').value;

    if (!startDate || !endDate) {
        showNotification('⚠️ Selecciona ambas fechas', 'warning');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        showNotification('⚠️ La fecha inicial debe ser menor o igual a la final', 'warning');
        return;
    }

    STATE.dateFilter.startDate = startDate;
    STATE.dateFilter.endDate = endDate;
    STATE.dateFilter.active = true;

    filterOrdersByDateRange();
    renderOrdersList();
    updateSummary();
    closeDateFilter();

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
    navigator.clipboard.writeText(text).then(() => {
        iconElement.textContent = '✅';
        iconElement.classList.add('copied');
        showNotification('📋 Copiado al portapapeles', 'success');

        setTimeout(() => {
            iconElement.textContent = '📋';
            iconElement.classList.remove('copied');
        }, 2000);
    }).catch(err => {
        showNotification('❌ Error al copiar', 'error');
    });
}
