// ==================== CONFIGURACIÓN ====================
const CLIENT_ID = '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com';
const SPREADSHEET_BD = '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck';
const SPREADSHEET_WRITE = '1gU5yDb0R4_Mf1fE-lOA7vwYmTUBR0wV7EPGg5zUt2Xo';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile';

// ==================== ESTADO GLOBAL ====================
let CURRENT_USER = '';
let USER_EMAIL = '';
let USER_GOOGLE_NAME = '';
let LAST_BD_UPDATE = null;
let BD_CODES = new Set();
let OBC_MAP = new Map();
let OBC_TOTALS = new Map();
let OBC_INFO = new Map();
let HISTORY = new Map();
let PENDING_SYNC = [];
let PREREC_DATA = new Map();
let IS_ONLINE = navigator.onLine;
let STATE = {
    activeOBC: null,
    tabs: {},
    closedTabs: {}
};
let TOKEN_CLIENT, audioCtx;
let lastScanned = null;
let pendingReloadOBC = null;
let RECONTEO_STATE = { obc: null, scans: [], stats: { ok: 0, dup: 0, missing: 0, extra: 0 } };

// ==================== SYNC MANAGER ====================
const SyncManager = {
    AUTO_SYNC_INTERVAL: 3600000,
    BATCH_SIZE: 5,
    intervalId: null,
    inProgress: false,

    init() {
        this.load();
        this.startAutoSync();
        this.setupExitProtection();
        this.updateUI(PENDING_SYNC.length === 0);
    },
    sessionStats: {
        total: 0,
        valid: 0,
        invalid: 0
    },
    currentLocation: '',
    pendingLocationValidation: null
};

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    initAudio();
    await loadFromStorage();
    await loadPendingSync();
    await loadPrerecData();
    setupListeners();
    setupConnectionMonitor();
    SyncManager.init();
    renderValidation();
    gapi.load('client', initGAPI);
});

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        document.addEventListener('click', () => audioCtx.state === 'suspended' && audioCtx.resume(), { once: true });
    } catch (e) {}
}

async function initGAPI() {
    try {
        await gapi.client.init({
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
        });
        TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '',
        });
        checkSavedSession();
    } catch (error) {
        console.error('Error initializing GAPI:', error);
    }
}

function checkSavedSession() {
    const savedUser = localStorage.getItem('wms_current_user');
    if (savedUser) {
        CURRENT_USER = savedUser;
        USER_EMAIL = localStorage.getItem('wms_user_email') || '';
        USER_GOOGLE_NAME = localStorage.getItem('wms_google_name') || '';
        showMainApp();
        updateUserFooter();
        loadDatabase();
    }
}

// ==================== AUTENTICACIÓN ====================
function handleLogin() {
    TOKEN_CLIENT.callback = async (resp) => {
        if (resp.error) {
            console.error('Auth error:', resp);
            showNotification('❌ Error de autenticación', 'error');
            return;
        }
        await getUserProfile();
        showMainApp();
        await loadDatabase();
    };
    TOKEN_CLIENT.requestAccessToken({ prompt: 'consent' });
}

async function getUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { 'Authorization': `Bearer ${gapi.client.getToken().access_token}` }
        });
        const profile = await response.json();
        USER_EMAIL = profile.email;
        USER_GOOGLE_NAME = profile.name || profile.email.split('@')[0];

        const savedAlias = localStorage.getItem(`wms_alias_${USER_EMAIL}`);
        CURRENT_USER = savedAlias || USER_GOOGLE_NAME;

        localStorage.setItem('wms_current_user', CURRENT_USER);
        localStorage.setItem('wms_user_email', USER_EMAIL);
        localStorage.setItem('wms_google_name', USER_GOOGLE_NAME);

        updateUserFooter();
    } catch (error) {
        console.error('Error getting profile:', error);
        CURRENT_USER = 'Usuario';
    }
}

function showMainApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    renderValidation();
}

function showLoginScreen() {
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

function toggleGoogleConnection() {
    if (gapi.client.getToken()) {
        google.accounts.oauth2.revoke(gapi.client.getToken().access_token);
        gapi.client.setToken(null);
        localStorage.removeItem('wms_current_user');
        localStorage.removeItem('wms_user_email');
        localStorage.removeItem('wms_google_name');
        CURRENT_USER = '';
        USER_EMAIL = '';
        showLoginScreen();
        showNotification('👋 Sesión cerrada', 'info');
    } else {
        handleLogin();
    }
}

function updateUserFooter() {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name-display');
    const authBtn = document.getElementById('sidebar-auth-btn');

    if (avatarEl) avatarEl.textContent = CURRENT_USER ? CURRENT_USER.charAt(0).toUpperCase() : '?';
    if (nameEl) nameEl.textContent = CURRENT_USER || 'No conectado';
    if (authBtn) authBtn.textContent = gapi?.client?.getToken() ? '🚪 Salir' : '🔗 Conectar';

    updateConnectionIndicator();
    updateBdInfo();
}

function updateConnectionIndicator(syncing = false) {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    if (!dot || !text) return;

    if (syncing) {
        dot.className = 'connection-dot syncing';
        text.textContent = 'Sincronizando...';
    } else if (IS_ONLINE && gapi?.client?.getToken()) {
        dot.className = 'connection-dot online';
        text.textContent = 'Conectado';
    } else {
        dot.className = 'connection-dot offline';
        text.textContent = 'Offline';
    }
}

function updateBdInfo() {
    const countEl = document.getElementById('bd-count-sidebar');
    const timeEl = document.getElementById('bd-update-time');
    if (countEl) countEl.textContent = BD_CODES.size;
    if (timeEl) timeEl.textContent = LAST_BD_UPDATE
        ? `Actualizado: ${new Date(LAST_BD_UPDATE).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
        : 'Sin actualizar';
}

// ==================== BASE DE DATOS ====================
async function loadDatabase() {
    if (!gapi?.client?.getToken()) {
        showNotification('⚠️ Conecta primero con Google', 'warning');
        return;
    }

    try {
        showNotification('📥 Cargando base de datos...', 'info');

        // Cargar resumen
        const resRes = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_BD,
            range: 'Resumen!A:F'
        });

        if (resRes.result.values) {
            OBC_INFO.clear();
            OBC_TOTALS.clear();
            for (let i = 1; i < resRes.result.values.length; i++) {
                const row = resRes.result.values[i];
                const obc = (row[0] || '').toUpperCase();
                if (obc) {
                    OBC_TOTALS.set(obc, parseInt(row[1]) || 0);
                    OBC_INFO.set(obc, {
                        recipient: row[2] || '-',
                        arrivalTime: row[3] || '-'
                    });
                }
            }
        }

        // Cargar códigos
        const sheets = ['BD', 'Outbound_出库单', 'Sheet1'];
        for (const sheet of sheets) {
            try {
                const codesRes = await gapi.client.sheets.spreadsheets.values.get({
                    spreadsheetId: SPREADSHEET_BD,
                    range: `${sheet}!A:J`
                });
                if (codesRes.result.values?.length > 1) {
                    for (let i = 1; i < codesRes.result.values.length; i++) {
                        const row = codesRes.result.values[i];
                        const code = (row[0] || '').toUpperCase();
                        const obc = (row[4] || '').toUpperCase();
                        if (code && obc) {
                            const concatenated = code + obc.toLowerCase();
                            BD_CODES.add(concatenated);
                            if (!OBC_MAP.has(obc)) OBC_MAP.set(obc, new Set());
                            OBC_MAP.get(obc).add(concatenated);
                        }
                    }
                }
            } catch (e) {
                console.log(`Sheet ${sheet} no disponible`);
            }
        }

        // Cargar historial
        try {
            const histRes = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_WRITE,
                range: 'Validaciones!A:I'
            });
            if (histRes.result.values?.length > 1) {
                HISTORY.clear();
                for (let i = 1; i < histRes.result.values.length; i++) {
                    const row = histRes.result.values[i];
                    const code = (row[5] || '').toUpperCase();
                    const obc = (row[3] || '').toUpperCase();
                    if (code && obc) {
                        const key = code + obc.toLowerCase();
                        HISTORY.set(key, {
                            date: row[0],
                            timestamp: row[1],
                            user: row[2],
                            obc: obc
                        });
                    }
                }
            }
        } catch (e) {
            console.log('No se pudo cargar historial');
        }

        LAST_BD_UPDATE = Date.now();
        await saveBD();
        updateBdInfo();
        showNotification(`✅ ${BD_CODES.size} códigos cargados`, 'success');
    } catch (error) {
        console.error('Error loading database:', error);
        showNotification('❌ Error cargando BD', 'error');
    }
}

function startValidation() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('validation-screen').classList.remove('hidden');
    
    STATE.sessionStats = { total: 0, valid: 0, invalid: 0 };
    STATE.currentLocation = '';
    updateSessionStats();
    
    setTimeout(() => {
        const locationInput = document.getElementById('location-input');
        if (locationInput) {
            locationInput.focus();
        } else {
            document.getElementById('validation-input').focus();
        }
    }, 100);

    setupValidationListeners();
}

function setupValidationListeners() {
    const input = document.getElementById('validation-input');
    const locationInput = document.getElementById('location-input');
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            validateCode(input.value.trim());
            input.value = '';
        }
    });
    
    if (locationInput) {
        locationInput.addEventListener('blur', () => {
            const location = locationInput.value.trim();
            if (location) {
                validateLocationInput(location);
            }
        });
        
        locationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const location = locationInput.value.trim();
                if (location) {
                    validateLocationInput(location);
                }
            }
        });
        
        locationInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }
}

function validateLocationInput(location) {
    // Usar el módulo compartido LocationValidatorUI
    LocationValidatorUI.validate(
        location,
        (normalizedLocation) => {
            const locationInput = document.getElementById('location-input');
            if (locationInput) {
                locationInput.value = normalizedLocation;
                STATE.currentLocation = normalizedLocation;
            }
            showNotification(`✅ Ubicación válida: ${normalizedLocation}`, 'success');
        },
        (forcedLocation) => {
            const locationInput = document.getElementById('location-input');
            if (locationInput) {
                locationInput.value = forcedLocation;
                STATE.currentLocation = forcedLocation;
            }
            showNotification(`⚠️ Ubicación insertada forzadamente: ${forcedLocation}`, 'warning');
        }
    );
}

function showConnectionBanner(status) {
    const banner = document.getElementById('connection-banner');
    if (!banner) return;

    banner.className = `connection-banner ${status}`;
    banner.textContent = status === 'online' ? '✅ Conexión restaurada' : '⚠️ Sin conexión - Los datos se guardarán localmente';

    if (status === 'online') {
        setTimeout(() => banner.className = 'connection-banner', 3000);
    }
}

// ==================== LISTENERS ====================
function setupListeners() {
    const scanner = document.getElementById('scanner');
    if (scanner) {
        scanner.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && scanner.value.trim()) {
                e.preventDefault();
                processScan(scanner.value.trim());
                scanner.value = '';
            }
        });
    }
}

// ==================== VALIDACIÓN ====================
async function processScan(raw, isManual = false) {
    if (!STATE.activeOBC) {
        showNotification('⚠️ Selecciona una orden primero', 'warning');
        return;
    }

    const tab = STATE.tabs[STATE.activeOBC];
    if (tab.completed) {
        showNotification('⚠️ Esta orden ya está completada', 'warning');
        return;
    }

    const obc = STATE.activeOBC;
    const location = tab.location || '';
    const code = normalizeCode(raw);
    const concatenated = code + obc.toLowerCase();

    // Verificar si existe en BD
    if (!BD_CODES.has(concatenated)) {
        await handleRejection('NO_EXISTE_EN_BD', raw, code, obc);
        return;
    }

    // Verificar historial global
    if (HISTORY.has(concatenated)) {
        const histData = HISTORY.get(concatenated);
        lastScanned = { raw, code, obc, location, histData, isManual };
        showPopup('history', code, histData);
        playSound('duplicate');
        return;
    }

    // Verificar duplicado en sesión
    const isDup = tab.validations.find(v => v.code === code);
    if (isDup) {
        lastScanned = { raw, code, obc, location, duplicate: isDup, isManual };
        showPopup('dup', code, isDup);
        playSound('duplicate');
        return;
    }

    await handleValidationOK(raw, code, obc, location, '', isManual);
}

async function handleValidationOK(raw, code, obc, location, note = '', isManual = false) {
    const now = new Date();
    const log = {
        id: Date.now() + Math.random(),
        date: now.toLocaleDateString('es-MX'),
        timestamp: now.toLocaleTimeString('es-MX'),
        user: CURRENT_USER,
        obc,
        raw,
        code,
        location,
        note: isManual ? `MANUAL: ${note}` : note
    };

    STATE.tabs[obc].validations.push(log);
    HISTORY.set(code + obc.toLowerCase(), { date: log.date, timestamp: log.timestamp, user: log.user, obc });

    PENDING_SYNC.push({ sheet: 'Validaciones', log });
    await SyncManager.save();
    await saveState();
    await saveHistory();

    renderValidation();
    updateSidebar();
    playSound('ok');
    flashInput('success');

    // Verificar si se completó
    const total = OBC_TOTALS.get(obc) || 0;
    if (total > 0 && STATE.tabs[obc].validations.length >= total) {
        STATE.tabs[obc].completed = true;
        showOrderCompleted(obc);
    }

    SyncManager.sync();
}

async function handleRejection(reason, raw, code, obc) {
    const now = new Date();
    const log = {
        date: now.toLocaleDateString('es-MX'),
        timestamp: now.toLocaleTimeString('es-MX'),
        user: CURRENT_USER,
        obc,
        raw,
        code,
        reason
    };

    STATE.tabs[obc].rejections.push(log);
    PENDING_SYNC.push({ sheet: 'Rechazos', log });

    await SyncManager.save();
    await saveState();

    showPopup('error', code, reason);
    playSound('error');
    flashInput('error');
    renderValidation();

    SyncManager.sync();
}

function normalizeCode(code) {
    return code.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');
}

// ==================== RENDER ====================
function renderValidation() {
    const emptyState = document.getElementById('empty-state');
    const validationContent = document.getElementById('validation-content');

    if (!STATE.activeOBC || Object.keys(STATE.tabs).length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (validationContent) validationContent.style.display = 'none';
        return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (validationContent) validationContent.style.display = 'block';

    const tab = STATE.tabs[STATE.activeOBC];
    if (!tab) return;

    // Tab bar
    const tabBar = document.getElementById('tab-bar');
    if (tabBar) {
        tabBar.innerHTML = Object.keys(STATE.tabs).map(obc => {
            const t = STATE.tabs[obc];
            const isActive = obc === STATE.activeOBC;
            const isCompleted = t.completed;
            return `
                <div class="tab ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" onclick="switchOBC('${obc}')">
                    ${obc} ${isCompleted ? '✅' : ''}
                    <button class="tab-close" onclick="event.stopPropagation(); closeTab('${obc}')">×</button>
                </div>
            `;
        }).join('') + `<div class="tab new-tab" onclick="addOBC()">➕ Nueva</div>`;
    }

    // Progress
    const total = OBC_TOTALS.get(STATE.activeOBC) || 0;
    const count = tab.validations.length;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const rest = Math.max(0, total - count);

    document.getElementById('prog-obc').textContent = STATE.activeOBC;
    document.getElementById('prog-pct').textContent = `${pct}%`;
    document.getElementById('prog-scan').textContent = count;
    document.getElementById('prog-total').textContent = total;
    document.getElementById('prog-rest').textContent = rest;
    document.getElementById('prog-bar').style.width = `${pct}%`;

    const progressCard = document.querySelector('.progress-card');
    if (progressCard) {
        progressCard.classList.toggle('completed', tab.completed);
    }
    const progressBar = document.getElementById('prog-bar');
    if (progressBar) {
        progressBar.classList.toggle('completed', tab.completed);
    }

    // Info
    const info = OBC_INFO.get(STATE.activeOBC) || {};
    document.getElementById('obc-display').value = STATE.activeOBC;
    document.getElementById('recipient-display').value = info.recipient || '-';
    document.getElementById('time-display').value = info.arrivalTime || '-';
    document.getElementById('location-input').value = tab.location || '';

    // Stats
    document.getElementById('stat-ok').textContent = tab.validations.length;
    document.getElementById('stat-error').textContent = tab.rejections.length;

    // Logs
    const okList = document.getElementById('log-ok');
    const rejectList = document.getElementById('log-reject');

    if (okList) {
        okList.innerHTML = tab.validations.slice(-50).reverse().map(log => `
            <li class="log-item log-ok">
                <div class="log-info">
                    <div class="log-code">${log.code}</div>
                    <div style="font-size: 0.8em; color: #666;">${log.timestamp} - ${log.user}</div>
                    ${log.note ? `<div style="font-size: 0.75em; color: #999;">${log.note}</div>` : ''}
                </div>
            </li>
        `).join('') || '<li style="text-align:center;padding:20px;color:#999;">Sin validaciones</li>';
    }

    if (rejectList) {
        rejectList.innerHTML = tab.rejections.slice(-50).reverse().map(log => `
            <li class="log-item log-reject">
                <div class="log-info">
                    <div class="log-code">${log.code || log.raw}</div>
                    <div style="font-size: 0.8em; color: var(--error);">${log.reason}</div>
                    <div style="font-size: 0.75em; color: #666;">${log.timestamp}</div>
                </div>
            </li>
        `).join('') || '<li style="text-align:center;padding:20px;color:#999;">Sin rechazos</li>';
    }

    updateSidebar();
}

function updateSidebar() {
    const obcList = document.getElementById('obc-list');
    if (!obcList) return;

    obcList.innerHTML = '';
    Object.keys(STATE.tabs).forEach(obc => {
        const tab = STATE.tabs[obc];
        const total = OBC_TOTALS.get(obc) || 0;
        const count = tab.validations.length;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;

        const div = document.createElement('div');
        div.style.cssText = `padding: 8px; margin-bottom: 8px; background: ${tab.completed ? 'rgba(76,175,80,0.2)' : 'rgba(255,255,255,0.1)'}; border-radius: 6px; font-size: 0.8em; cursor: pointer;`;
        div.innerHTML = `<div style="font-weight: 700;">${obc} ${tab.completed ? '✅' : ''}</div><div style="opacity: 0.8; font-size: 0.85em;">${count}/${total} (${pct}%)</div>`;
        div.onclick = () => switchOBC(obc);
        obcList.appendChild(div);
    });

    SyncManager.updateBadge();
}

// ==================== OBC MANAGEMENT ====================
function switchOBC(obc) {
    STATE.activeOBC = obc;
    renderValidation();
    document.getElementById('scanner')?.focus();
    saveState();
}

function closeTab(obc) {
    if (!confirm(`¿Cerrar la orden ${obc}?`)) return;

    STATE.closedTabs[obc] = STATE.tabs[obc];
    delete STATE.tabs[obc];

    if (STATE.activeOBC === obc) {
        const remaining = Object.keys(STATE.tabs);
        STATE.activeOBC = remaining.length > 0 ? remaining[0] : null;
    }

    renderValidation();
    saveState();
    showNotification(`Orden ${obc} cerrada`, 'success');
}

async function addOBC() {
    const obc = prompt('Ingresa el número de orden:');
    if (!obc) return;

    const obcName = obc.toUpperCase().trim();
    if (STATE.tabs[obcName]) {
        showNotification('⚠️ Esta orden ya está abierta', 'warning');
        return;
    }

    const total = OBC_TOTALS.get(obcName) || 0;
    let validatedCount = 0;
    for (const [key, data] of HISTORY.entries()) {
        if (data.obc === obcName) validatedCount++;
    }

    if (total > 0 && validatedCount >= total) {
        document.getElementById('complete-obc').textContent = obcName;
        document.getElementById('complete-count').textContent = `${validatedCount}/${total}`;
        document.getElementById('popup-already-complete').style.display = 'flex';
        playSound('error');
        return;
    }

    if (validatedCount > 0) {
        pendingReloadOBC = obcName;
        document.getElementById('reload-obc').textContent = obcName;
        document.getElementById('reload-validated').textContent = validatedCount;
        document.getElementById('reload-total').textContent = total;
        document.getElementById('reload-pending').textContent = total - validatedCount;
        document.getElementById('popup-reload-order').style.display = 'flex';
        return;
    }

    createNewOBC(obcName);
}

// LocationValidator ahora usa el módulo compartido LocationValidatorUI
// que está definido en shared/js/location-validator-ui.js
// Las funciones de validación están en shared/js/wms-utils.js

function endValidation() {
    document.getElementById('validation-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    updateDashboard();
}

function confirmReloadOrder() {
    if (!pendingReloadOBC) return;
    const obcName = pendingReloadOBC;

    const validations = [];
    for (const [key, data] of HISTORY.entries()) {
        if (data.obc === obcName) {
            const code = key.replace(obcName.toLowerCase(), '');
            validations.push({
                id: Date.now() + Math.random(),
                ...data,
                raw: code,
                code,
                location: '',
                note: 'Cargado desde historial'
            });
        }
    }

    STATE.tabs[obcName] = { location: '', validations, rejections: [], completed: false };
    closePopup('reload-order');
    pendingReloadOBC = null;
    switchOBC(obcName);
    showNotification(`✅ Orden ${obcName} recargada con ${validations.length} validaciones`, 'success');
}

function cancelReloadOrder() {
    closePopup('reload-order');
    pendingReloadOBC = null;
}

function updateState() {
    if (!STATE.activeOBC) return;
    STATE.tabs[STATE.activeOBC].location = document.getElementById('location-input').value.toUpperCase().trim();
    saveState();
}

// ==================== POPUPS ====================
function showPopup(type, code, data) {
    if (type === 'error') {
        document.getElementById('err-code').textContent = code;
        document.getElementById('err-reason').textContent = data;
        document.getElementById('popup-error').style.display = 'flex';
    } else if (type === 'history') {
        document.getElementById('hist-code').textContent = code;
        document.getElementById('hist-obc').textContent = data.obc;
        document.getElementById('hist-when').textContent = `${data.date} ${data.timestamp}`;
        document.getElementById('hist-user').textContent = data.user;
        document.getElementById('popup-history').style.display = 'flex';
    } else if (type === 'dup') {
        document.getElementById('dup-code').textContent = code;
        document.getElementById('dup-when').textContent = `${data.date} ${data.timestamp}`;
        document.getElementById('dup-user').textContent = data.user;
        document.getElementById('popup-dup').style.display = 'flex';
    }
    document.getElementById('scanner')?.blur();
}

function closePopup(type) {
    document.getElementById(`popup-${type}`).style.display = 'none';
    if (!['completed', 'already-complete', 'reload-order', 'prerec'].includes(type)) {
        document.getElementById('scanner')?.focus();
    }
    lastScanned = null;
}

function forceHistoryValidation() {
    const note = prompt('Justificación de la revalidación:') || 'Sin justificación';
    if (lastScanned) {
        const histInfo = `REVALIDACION - Original: ${lastScanned.histData.obc} por ${lastScanned.histData.user}`;
        handleValidationOK(lastScanned.raw, lastScanned.code, lastScanned.obc, lastScanned.location, `${histInfo} - ${note}`, false);
    }
    closePopup('history');
}

function forceDuplicate() {
    const note = prompt('Justificación del duplicado:') || 'Sin justificación';
    if (lastScanned) {
        handleValidationOK(lastScanned.raw, lastScanned.code, lastScanned.obc, lastScanned.location, `DUPLICADO FORZADO: ${note}`, false);
    }
    closePopup('dup');
}

function showOrderCompleted(obc) {
    const tab = STATE.tabs[obc];
    document.getElementById('completed-obc').textContent = obc;
    document.getElementById('completed-count').textContent = tab.validations.length;
    document.getElementById('completed-user').textContent = CURRENT_USER;
    document.getElementById('popup-completed').style.display = 'flex';
    playSound('ok');
}

function continueToNewOrder() {
    const currentOBC = STATE.activeOBC;
    closePopup('completed');
    if (currentOBC && STATE.tabs[currentOBC]) {
        STATE.closedTabs[currentOBC] = STATE.tabs[currentOBC];
        delete STATE.tabs[currentOBC];
    }
    STATE.activeOBC = null;
    saveState();
    addOBC();
}

function saveAndContinue() {
    closePopup('completed');
    addOBC();
}

function saveAndClose() {
    const currentOBC = STATE.activeOBC;
    closePopup('completed');
    if (currentOBC && STATE.tabs[currentOBC]) {
        STATE.closedTabs[currentOBC] = STATE.tabs[currentOBC];
        delete STATE.tabs[currentOBC];
    }
    STATE.activeOBC = null;
    saveState();
    renderValidation();
}

function continueViewing() {
    closePopup('completed');
}

// ==================== MANUAL INPUT ====================
function toggleManualOtherNote() {
    const reason = document.getElementById('manual-reason').value;
    document.getElementById('manual-other-container').style.display = reason === 'Otro' ? 'block' : 'none';
}

function openManualInput() {
    if (!STATE.activeOBC) {
        showNotification('⚠️ Crea una orden primero', 'warning');
        return;
    }
    if (STATE.tabs[STATE.activeOBC].completed) {
        showNotification('⚠️ Esta orden ya está completada', 'warning');
        return;
    }

    document.getElementById('manual-code').value = '';
    document.getElementById('manual-reason').value = '';
    document.getElementById('manual-other-note').value = '';
    document.getElementById('manual-other-container').style.display = 'none';
    document.getElementById('popup-manual').style.display = 'flex';
    document.getElementById('manual-code').focus();
}

async function submitManualCode() {
    const code = document.getElementById('manual-code').value.trim();
    const reason = document.getElementById('manual-reason').value;
    const otherNote = document.getElementById('manual-other-note').value.trim();

    if (!code) { showNotification('⚠️ Ingresa un código', 'warning'); return; }
    if (!reason) { showNotification('⚠️ Selecciona un motivo', 'warning'); return; }
    if (reason === 'Otro' && !otherNote) { showNotification('⚠️ Especifica el motivo', 'warning'); return; }

    const finalNote = reason === 'Otro' ? `Otro: ${otherNote}` : reason;
    closePopup('manual');

    await processScan(code, true);
}

// ==================== MODULES ====================

// Resumen
function showResumen() {
    document.getElementById('validation').style.display = 'none';
    document.getElementById('resumen-module').style.display = 'block';
    renderResumen();
}

function hideResumen() {
    document.getElementById('resumen-module').style.display = 'none';
    document.getElementById('validation').style.display = 'block';
}

function renderResumen() {
    const tbody = document.getElementById('resumen-tbody');
    tbody.innerHTML = '';

    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    Object.keys(allOrders).forEach(obc => {
        const tab = allOrders[obc];
        const total = OBC_TOTALS.get(obc) || 0;
        const validated = tab.validations.length;
        const pct = total > 0 ? Math.round((validated / total) * 100) : 0;
        const info = OBC_INFO.get(obc) || {};
        const prerec = PREREC_DATA.get(obc);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${obc}</strong>${prerec ? '<span class="prerec-indicator">PRE</span>' : ''}</td>
            <td>${total}</td>
            <td>${validated}</td>
            <td>${pct}%</td>
            <td>${info.recipient || '-'}</td>
            <td>${info.arrivalTime || '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterResumen() {
    const search = document.getElementById('search-resumen').value.toLowerCase();
    document.querySelectorAll('#resumen-tbody tr').forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(search) ? '' : 'none';
    });
}

// Faltantes
function showFaltantes() {
    document.getElementById('validation').style.display = 'none';
    document.getElementById('faltantes-module').style.display = 'block';
    populateFaltantesOrders();
    renderFaltantes();
}

function hideFaltantes() {
    document.getElementById('faltantes-module').style.display = 'none';
    document.getElementById('validation').style.display = 'block';
}

function populateFaltantesOrders() {
    const select = document.getElementById('faltantes-order-select');
    select.innerHTML = '<option value="">Seleccionar orden...</option>';
    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    Object.keys(allOrders).forEach(obc => {
        const option = document.createElement('option');
        option.value = obc;
        option.textContent = obc;
        select.appendChild(option);
    });
    if (STATE.activeOBC && allOrders[STATE.activeOBC]) {
        select.value = STATE.activeOBC;
    }
}

function renderFaltantes() {
    const selectedOBC = document.getElementById('faltantes-order-select').value;
    const grid = document.getElementById('faltantes-grid');

    if (!selectedOBC) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">Selecciona una orden</div>';
        return;
    }

    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    const tab = allOrders[selectedOBC];
    const obcCodes = OBC_MAP.get(selectedOBC);

    if (!obcCodes || obcCodes.size === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No hay datos para esta orden</div>';
        return;
    }

    const validated = new Set(tab.validations.map(v => v.code));
    const codesArray = Array.from(obcCodes).map(concat => {
        const obcLower = selectedOBC.toLowerCase();
        return concat.endsWith(obcLower) ? concat.slice(0, -obcLower.length) : concat;
    });

    const pendingCodes = codesArray.filter(code => !validated.has(code));

    if (pendingCodes.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--success);">✅ ¡Todos los códigos validados!</div>';
        return;
    }

    grid.innerHTML = pendingCodes.map(code => `
        <div class="faltante-item faltante-pending" data-code="${code}">${code}</div>
    `).join('');
}

function filterFaltantes() {
    const search = document.getElementById('search-faltantes').value.toLowerCase();
    document.querySelectorAll('.faltante-item').forEach(item => {
        item.style.display = item.dataset.code.toLowerCase().includes(search) ? '' : 'none';
    });
}

// Consulta
function showConsulta() {
    document.getElementById('validation').style.display = 'none';
    document.getElementById('consulta-module').style.display = 'block';
    document.getElementById('consulta-scanner').focus();
}

function hideConsulta() {
    document.getElementById('consulta-module').style.display = 'none';
    document.getElementById('validation').style.display = 'block';
    document.getElementById('consulta-result').style.display = 'none';
}

function handleConsultaScan(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        executeConsulta();
    }
}

function executeConsulta() {
    const code = normalizeCode(document.getElementById('consulta-scanner').value);
    if (!code) {
        showNotification('⚠️ Ingresa un código', 'warning');
        return;
    }

    const resultDiv = document.getElementById('consulta-result');
    const matches = [];

    for (const [obc, codes] of OBC_MAP.entries()) {
        const concat = code + obc.toLowerCase();
        if (codes.has(concat)) {
            const histKey = code + obc.toLowerCase();
            const histData = HISTORY.get(histKey);
            matches.push({ obc, isValidated: !!histData, histData });
        }
    }

    if (matches.length === 0) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div class="consulta-result">
                <div class="consulta-header">
                    <div class="consulta-code-display">
                        <div class="consulta-code-label">Código</div>
                        <div class="consulta-code-value">${code}</div>
                    </div>
                    <div class="consulta-status not-found">No encontrado</div>
                </div>
                <p style="text-align: center; color: #666;">Este código no existe en la base de datos</p>
            </div>
        `;
        return;
    }

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = matches.map(match => {
        const info = OBC_INFO.get(match.obc) || {};
        const total = OBC_TOTALS.get(match.obc) || 0;

        return `
            <div class="consulta-result" style="margin-bottom: 15px;">
                <div class="consulta-header">
                    <div class="consulta-code-display">
                        <div class="consulta-code-label">Código</div>
                        <div class="consulta-code-value">${code}</div>
                    </div>
                    <div class="consulta-obc">${match.obc}</div>
                    <div class="consulta-status ${match.isValidated ? 'validated' : 'pending'}">
                        ${match.isValidated ? '✅ Validado' : '⏳ Pendiente'}
                    </div>
                </div>
                <div class="consulta-grid">
                    <div class="consulta-item">
                        <div class="consulta-item-label">Destino</div>
                        <div class="consulta-item-value">${info.recipient || '-'}</div>
                    </div>
                    <div class="consulta-item">
                        <div class="consulta-item-label">Horario</div>
                        <div class="consulta-item-value">${info.arrivalTime || '-'}</div>
                    </div>
                    <div class="consulta-item">
                        <div class="consulta-item-label">Total Cajas</div>
                        <div class="consulta-item-value">${total}</div>
                    </div>
                </div>
                ${match.isValidated ? `
                    <div class="consulta-validation-info">
                        <strong>Validado por:</strong> ${match.histData.user}<br>
                        <strong>Fecha:</strong> ${match.histData.date} ${match.histData.timestamp}
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Prerecepcion
function showPrerecepcion() {
    document.getElementById('popup-prerec').style.display = 'flex';
    document.getElementById('prerec-scanner').value = '';
    document.getElementById('prerec-order-info').style.display = 'none';
    document.getElementById('prerec-confirm-btn').disabled = true;
    updatePrerecTodayCount();
    setTimeout(() => document.getElementById('prerec-scanner').focus(), 100);
}

function closePrerecepcion() {
    closePopup('prerec');
    resetPrerecModal();
}

function resetPrerecModal() {
    document.getElementById('prerec-scanner').value = '';
    document.getElementById('prerec-order-info').style.display = 'none';
    document.getElementById('prerec-confirm-btn').disabled = true;
}

function handlePrerecScan(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const obc = document.getElementById('prerec-scanner').value.toUpperCase().trim();
        if (obc) showPrerecOrderInfo(obc);
    }
}

function showPrerecOrderInfo(obc) {
    const info = OBC_INFO.get(obc);
    const total = OBC_TOTALS.get(obc) || 0;
    const infoDiv = document.getElementById('prerec-order-info');

    if (!info && total === 0) {
        infoDiv.innerHTML = `<div class="prerec-order-info" style="border-color: var(--error);"><strong style="color: var(--error);">⚠️ Orden no encontrada en BD</strong></div>`;
        infoDiv.style.display = 'block';
        document.getElementById('prerec-confirm-btn').disabled = true;
        return;
    }

    const isPrereceived = PREREC_DATA.has(obc);

    infoDiv.innerHTML = `
        <div class="prerec-order-info">
            <div class="prerec-order-header">
                <span class="prerec-order-code">${obc}</span>
                ${isPrereceived ? '<span class="prerec-badge">Ya prerecibida</span>' : ''}
            </div>
            <div class="prerec-grid">
                <div class="prerec-item">
                    <div class="prerec-item-label">Destino</div>
                    <div class="prerec-item-value">${info?.recipient || '-'}</div>
                </div>
                <div class="prerec-item">
                    <div class="prerec-item-label">Horario</div>
                    <div class="prerec-item-value">${info?.arrivalTime || '-'}</div>
                </div>
                <div class="prerec-item">
                    <div class="prerec-item-label">Total Cajas</div>
                    <div class="prerec-item-value">${total}</div>
                </div>
            </div>
        </div>
    `;
    infoDiv.style.display = 'block';
    document.getElementById('prerec-confirm-btn').disabled = isPrereceived;
}

async function confirmPrerecepcion() {
    const obc = document.getElementById('prerec-scanner').value.toUpperCase().trim();
    if (!obc) return;

    const now = new Date();
    PREREC_DATA.set(obc, {
        user: CURRENT_USER,
        date: now.toLocaleDateString('es-MX'),
        time: now.toLocaleTimeString('es-MX'),
        location: ''
    });

    await savePrerecData();
    showNotification(`✅ Orden ${obc} prerecibida`, 'success');
    updatePrerecTodayCount();
    resetPrerecModal();
    document.getElementById('prerec-scanner').focus();
}

function updatePrerecTodayCount() {
    const today = new Date().toLocaleDateString('es-MX');
    let count = 0;
    for (const [obc, data] of PREREC_DATA.entries()) {
        if (data.date === today) count++;
    }
    document.getElementById('prerec-today-count').textContent = count;
}

// Reconteo
function openReconteo() {
    if (!STATE.activeOBC) {
        showNotification('⚠️ Selecciona una orden primero', 'warning');
        return;
    }
    document.getElementById('validation').style.display = 'none';
    document.getElementById('reconteo-module').style.display = 'block';
    populateReconteoOrders();
    document.getElementById('reconteo-order-select').value = STATE.activeOBC;
    initReconteo();
}

function hideReconteo() {
    document.getElementById('reconteo-module').style.display = 'none';
    document.getElementById('validation').style.display = 'block';
}

function populateReconteoOrders() {
    const select = document.getElementById('reconteo-order-select');
    select.innerHTML = '<option value="">Seleccionar orden...</option>';
    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    Object.keys(allOrders).forEach(obc => {
        const option = document.createElement('option');
        option.value = obc;
        option.textContent = obc;
        select.appendChild(option);
    });
}

function initReconteo() {
    const obc = document.getElementById('reconteo-order-select').value;
    if (!obc) {
        document.getElementById('reconteo-content').style.display = 'none';
        return;
    }

    RECONTEO_STATE = { obc, scans: [], stats: { ok: 0, dup: 0, missing: 0, extra: 0 } };
    document.getElementById('reconteo-content').style.display = 'block';
    updateReconteoStats();
    renderReconteoTable();
    renderReconteoNotScanned();
    setTimeout(() => document.getElementById('reconteo-scanner').focus(), 100);
}

function clearReconteo() {
    if (confirm('¿Limpiar todos los escaneos del reconteo?')) {
        RECONTEO_STATE.scans = [];
        RECONTEO_STATE.stats = { ok: 0, dup: 0, missing: 0, extra: 0 };
        updateReconteoStats();
        renderReconteoTable();
        renderReconteoNotScanned();
        document.getElementById('reconteo-scanner').focus();
    }
}

function handleReconteoScan(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        const raw = document.getElementById('reconteo-scanner').value.trim();
        if (raw) processReconteoScan(raw);
        document.getElementById('reconteo-scanner').value = '';
    }
}

function processReconteoScan(raw) {
    const code = normalizeCode(raw);
    const obc = RECONTEO_STATE.obc;
    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    const tab = allOrders[obc];
    const obcCodes = OBC_MAP.get(obc);

    const now = new Date();
    const scan = {
        code,
        time: now.toLocaleTimeString('es-MX'),
        status: ''
    };

    // Verificar si ya fue escaneado en este reconteo
    if (RECONTEO_STATE.scans.some(s => s.code === code)) {
        scan.status = 'dup';
        RECONTEO_STATE.stats.dup++;
    }
    // Verificar si existe en BD para esta orden
    else if (!obcCodes || !obcCodes.has(code + obc.toLowerCase())) {
        scan.status = 'missing';
        RECONTEO_STATE.stats.missing++;
    }
    // Verificar si no fue validado originalmente
    else if (!tab.validations.some(v => v.code === code)) {
        scan.status = 'extra';
        RECONTEO_STATE.stats.extra++;
    }
    else {
        scan.status = 'ok';
        RECONTEO_STATE.stats.ok++;
    }

    RECONTEO_STATE.scans.push(scan);
    updateReconteoStats();
    renderReconteoTable();
    renderReconteoNotScanned();

    playSound(scan.status === 'ok' ? 'ok' : 'error');
}

function updateReconteoStats() {
    document.getElementById('reconteo-ok').textContent = RECONTEO_STATE.stats.ok;
    document.getElementById('reconteo-dup').textContent = RECONTEO_STATE.stats.dup;
    document.getElementById('reconteo-missing').textContent = RECONTEO_STATE.stats.missing;
    document.getElementById('reconteo-extra').textContent = RECONTEO_STATE.stats.extra;
}

function renderReconteoTable() {
    const tbody = document.getElementById('reconteo-tbody');
    tbody.innerHTML = RECONTEO_STATE.scans.slice().reverse().map((scan, i) => `
        <tr>
            <td>${RECONTEO_STATE.scans.length - i}</td>
            <td>${scan.code}</td>
            <td><span class="status-badge status-${scan.status}">${
                scan.status === 'ok' ? 'OK' :
                scan.status === 'dup' ? 'Duplicado' :
                scan.status === 'missing' ? 'No en BD' : 'No validado'
            }</span></td>
            <td>${scan.time}</td>
            <td>${scan.status === 'extra' ? `<button class="btn-add-validation" onclick="addFromReconteo('${scan.code}')">Agregar</button>` : ''}</td>
        </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#999;">Sin escaneos</td></tr>';
}

function renderReconteoNotScanned() {
    const obc = RECONTEO_STATE.obc;
    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    const tab = allOrders[obc];

    if (!tab) return;

    const scannedCodes = new Set(RECONTEO_STATE.scans.map(s => s.code));
    const notScanned = tab.validations.filter(v => !scannedCodes.has(v.code));

    const grid = document.getElementById('reconteo-not-scanned');
    grid.innerHTML = notScanned.map(v => `
        <div class="faltante-item faltante-pending">${v.code}</div>
    `).join('') || '<div style="grid-column: 1/-1; text-align: center; color: var(--success);">✅ Todos escaneados</div>';
}

async function addFromReconteo(code) {
    const obc = RECONTEO_STATE.obc;
    if (!STATE.tabs[obc]) {
        STATE.tabs[obc] = { location: '', validations: [], rejections: [], completed: false };
    }

    await handleValidationOK(code, code, obc, '', 'Agregado desde reconteo', false);

    // Actualizar stats
    const scanIndex = RECONTEO_STATE.scans.findIndex(s => s.code === code && s.status === 'extra');
    if (scanIndex >= 0) {
        RECONTEO_STATE.scans[scanIndex].status = 'ok';
        RECONTEO_STATE.stats.extra--;
        RECONTEO_STATE.stats.ok++;
    }

    updateReconteoStats();
    renderReconteoTable();
    showNotification(`✅ ${code} agregado a validaciones`, 'success');
}

// ==================== UTILITIES ====================
function playSound(type) {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);

        if (type === 'ok') {
            osc.frequency.setValueAtTime(880, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.15);
        } else if (type === 'error') {
            osc.frequency.setValueAtTime(300, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.35);
        } else if (type === 'duplicate') {
            osc.frequency.setValueAtTime(600, audioCtx.currentTime);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.1);
        }
    } catch (e) {}
}

function flashInput(type) {
    const input = document.getElementById('scanner');
    if (!input) return;
    input.style.borderColor = type === 'success' ? 'var(--success)' : 'var(--error)';
    setTimeout(() => input.style.borderColor = '#ddd', 300);
}

function showNotification(msg, type) {
    const container = document.getElementById('notifications');
    if (!container) return;

    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.innerHTML = `<strong>${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</strong> ${msg}`;
    container.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

function showMiniAlert(message) {
    const alert = document.createElement('div');
    alert.className = 'mini-alert';
    alert.textContent = message;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 400);
}

function testLocationValidator() {
    console.log('🧪 Testing Location Validator (usando wms-utils.js)...');
    
    const testCases = [
        'A26-06-01-02',
        "A26'06'01'02",
        'B11-11-02-01',
        'A1-11-02-01',
        'A1-1-1-1',      // Debe normalizarse a A1-01-01-01
        'C9-11-02-01',
        'INVALID',
        'A26 06 01 02',
        'Z123-45-67-89'
    ];
    
    testCases.forEach(test => {
        const result = validateLocation(test);  // Función de wms-utils.js
        console.log(`Input: "${test}" => Valid: ${result.valid}, Normalized: "${result.normalized}"`);
    });
}

window.addEventListener('load', initializeApp);
