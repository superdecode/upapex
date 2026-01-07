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
    closedTabs: {},
    sessionStats: {
        total: 0,
        valid: 0,
        invalid: 0
    },
    currentLocation: '',
    pendingLocationValidation: null
};
let TOKEN_CLIENT, audioCtx;
let lastScanned = null;
let pendingReloadOBC = null;
let RECONTEO_STATE = { obc: null, scans: [], stats: { ok: 0, dup: 0, missing: 0, extra: 0 } };

// ==================== INDEXEDDB CACHE SYSTEM ====================
// Sistema avanzado de cache con IndexedDB para sincronización y validación de duplicados
let HISTORY_DB = null;
let HISTORY_LAST_UPDATE = null;
const HISTORY_DB_NAME = 'WMS_Validador_HistoryDB';
const HISTORY_STORE = 'validations';

const HistoryIndexedDBManager = {
    SYNC_INTERVAL: 30 * 60 * 1000,  // 30 minutos - Sincronización periódica desde servidor
    intervalId: null,
    isLoading: false,

    async init() {
        await this.openDatabase();
        await this.loadFromIndexedDB();
        this.startAutoSync();
        console.log(`📦 [HISTORY-CACHE] Inicializado con ${HISTORY.size} validaciones en cache`);
    },

    async openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(HISTORY_DB_NAME, 1);

            request.onerror = () => {
                console.error('❌ [HISTORY-CACHE] Error abriendo IndexedDB');
                reject(request.error);
            };

            request.onsuccess = () => {
                HISTORY_DB = request.result;
                console.log('✅ [HISTORY-CACHE] IndexedDB abierto correctamente');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                    const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'key' });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('✅ [HISTORY-CACHE] Object store creado');
                }
            };
        });
    },

    async loadFromIndexedDB() {
        if (!HISTORY_DB) return;

        try {
            // Cargar datos de historial de validaciones
            const dataResult = await new Promise((resolve, reject) => {
                const transaction = HISTORY_DB.transaction([HISTORY_STORE], 'readonly');
                const store = transaction.objectStore(HISTORY_STORE);
                const request = store.get('history');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (dataResult?.value) {
                const entries = dataResult.value;
                HISTORY = new Map(entries);
                console.log(`📂 [HISTORY-CACHE] Cargadas ${HISTORY.size} validaciones desde IndexedDB`);
            }

            // Cargar timestamp de última actualización
            const timestampResult = await new Promise((resolve, reject) => {
                const transaction = HISTORY_DB.transaction([HISTORY_STORE], 'readonly');
                const store = transaction.objectStore(HISTORY_STORE);
                const request = store.get('lastUpdate');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (timestampResult?.value) {
                HISTORY_LAST_UPDATE = new Date(timestampResult.value);
                console.log(`📅 [HISTORY-CACHE] Última actualización: ${HISTORY_LAST_UPDATE.toLocaleString('es-MX')}`);
            }
        } catch (error) {
            console.error('❌ [HISTORY-CACHE] Error cargando desde IndexedDB:', error);
        }
    },

    async saveToIndexedDB() {
        if (!HISTORY_DB) return;

        try {
            const transaction = HISTORY_DB.transaction([HISTORY_STORE], 'readwrite');
            const store = transaction.objectStore(HISTORY_STORE);

            // Guardar solo los últimos 30 días de historial para no exceder límites
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const filteredEntries = Array.from(HISTORY.entries()).filter(([key, val]) => {
                const date = new Date(val.date + ' ' + val.timestamp);
                return date.getTime() > thirtyDaysAgo;
            });

            store.put({ key: 'history', value: filteredEntries });
            store.put({ key: 'lastUpdate', value: Date.now() });

            await new Promise((resolve, reject) => {
                transaction.oncomplete = resolve;
                transaction.onerror = reject;
            });

            console.log(`💾 [HISTORY-CACHE] Guardadas ${filteredEntries.length} validaciones en IndexedDB`);
        } catch (error) {
            console.error('❌ [HISTORY-CACHE] Error guardando en IndexedDB:', error);
        }
    },

    startAutoSync() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(() => {
            if (IS_ONLINE && gapi?.client?.getToken()) {
                this.syncFromServer(false);  // sincronización silenciosa
            }
        }, this.SYNC_INTERVAL);  // 30 minutos
        console.log('🔄 [HISTORY-CACHE] Auto-sync iniciado (cada 30 minutos)');
    },

    async syncFromServer(showNotification = true) {
        if (this.isLoading) {
            console.log('⏳ [HISTORY-CACHE] Sincronización ya en progreso...');
            return;
        }

        if (!IS_ONLINE || !gapi?.client?.getToken()) {
            console.log('⚠️ [HISTORY-CACHE] Sin conexión o sin token');
            return;
        }

        this.isLoading = true;
        if (showNotification) {
            window.showNotification?.('🔄 Sincronizando historial de validaciones...', 'info');
        }

        try {
            // Descargar historial de validaciones desde Google Sheets Val3
            // Columnas: A(date), B(timestamp), C(user), D(obc), E(raw), F(code), G(reason), H(location), I(note)
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_WRITE,
                range: 'Val3!A:I'
            });

            const rows = response.result.values || [];
            const newHistory = new Map();

            // Saltar header (fila 0) y procesar datos
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[3] || !row[5]) continue; // Requiere obc y code

                const obc = row[3]?.toString().trim().toUpperCase();
                const code = row[5]?.toString().trim().toUpperCase();
                const concatenated = code + obc.toLowerCase();

                if (concatenated) {
                    newHistory.set(concatenated, {
                        date: row[0]?.toString().trim() || '',
                        timestamp: row[1]?.toString().trim() || '',
                        user: row[2]?.toString().trim() || '',
                        obc: obc,
                        raw: row[4]?.toString().trim() || '',
                        code: code,
                        reason: row[6]?.toString().trim() || '',
                        location: row[7]?.toString().trim() || '',
                        note: row[8]?.toString().trim() || ''
                    });
                }
            }

            // Actualizar HISTORY global con merge (mantener datos locales nuevos)
            const beforeSize = HISTORY.size;
            for (const [key, value] of newHistory) {
                if (!HISTORY.has(key)) {
                    HISTORY.set(key, value);
                }
            }
            const added = HISTORY.size - beforeSize;

            HISTORY_LAST_UPDATE = new Date();
            await this.saveToIndexedDB();

            console.log(`✅ [HISTORY-CACHE] Sincronizadas ${newHistory.size} validaciones del servidor (+${added} nuevas)`);
            if (showNotification) {
                window.showNotification?.(`✅ Historial sincronizado (+${added} nuevas)`, 'success');
            }
        } catch (error) {
            console.error('❌ [HISTORY-CACHE] Error sincronizando desde servidor:', error);
            if (showNotification) {
                window.showNotification?.('❌ Error sincronizando historial', 'error');
            }
        } finally {
            this.isLoading = false;
        }
    },

    async addValidation(concatenated, validationData) {
        if (!concatenated) return;
        HISTORY.set(concatenated, validationData);
        await this.saveToIndexedDB();
    }
};

// ==================== SYNC MANAGER ====================
// Usar el módulo compartido SyncManager
let syncManager = null;

function initSyncManager() {
    syncManager = new SyncManager({
        spreadsheetId: SPREADSHEET_WRITE,
        sheetName: 'Val3',
        autoSyncInterval: 3600000,
        storageKey: 'wms_validador_pending_sync',
        appName: 'Validador',
        appIcon: '🎯',
        formatRecord: (record) => {
            const log = record.log || record;
            return [
                log.date || '',
                log.timestamp || '',
                log.user || '',
                log.obc || '',
                log.raw || '',
                log.code || '',
                log.reason || '',
                log.location || '',
                log.note || ''
            ];
        },
        onSyncStart: () => updateConnectionIndicator(true),
        onSyncEnd: () => updateConnectionIndicator(false),
        onStatusChange: (stats) => updateSummaryStats(stats)
    });
    window.syncManager = syncManager;
    syncManager.init();
}

// Actualizar estadísticas del resumen
function updateSummaryStats(stats) {
    // Actualizar el contador de pendientes si existe
    const badge = document.getElementById('pending-badge');
    if (badge) {
        badge.textContent = stats?.pendingSync || 0;
        badge.style.display = (stats?.pendingSync > 0) ? 'inline-block' : 'none';
    }
}

// Helper para agregar a la cola de sync (compatibilidad)
function addToPendingSync(sheet, log) {
    if (syncManager) {
        syncManager.addToQueue({ sheet, log }, sheet);
    }
}

// Helper para guardar pending sync (compatibilidad)
async function savePendingSync() {
    if (syncManager) {
        syncManager.save();
    }
}

// Helper para cargar pending sync (compatibilidad)
async function loadPendingSync() {
    // El syncManager carga automáticamente al init
}

// ==================== FUNCIONES DE STORAGE ====================
// Sistema de almacenamiento compatible con window.storage (localStorage con API async)
window.storage = {
    async get(key) {
        try {
            const value = localStorage.getItem(key);
            return value ? { value } : null;
        } catch (e) {
            console.error(`Error getting ${key}:`, e);
            return null;
        }
    },

    async set(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            console.error(`Error setting ${key}:`, e);
        }
    }
};

async function loadFromStorage() {
    try {
        const stateRes = await window.storage.get('wms_validador_state');
        if (stateRes?.value) {
            const loaded = JSON.parse(stateRes.value);
            STATE.tabs = loaded.tabs || {};
            STATE.closedTabs = loaded.closedTabs || {};
            STATE.activeOBC = loaded.activeOBC;
            STATE.sessionStats = loaded.sessionStats || { total: 0, valid: 0, invalid: 0 };
            console.log('📂 Estado cargado desde storage');
        }

        const bdRes = await window.storage.get('wms_validador_bd');
        if (bdRes?.value) {
            const cached = JSON.parse(bdRes.value);
            BD_CODES = new Set(cached.codes || []);
            OBC_MAP = new Map((cached.obcMap || []).map(([k, v]) => [k, new Set(v)]));
            OBC_TOTALS = new Map(cached.totals || []);
            OBC_INFO = new Map(cached.info || []);
            LAST_BD_UPDATE = cached.lastUpdate;
            console.log(`📂 BD cargada: ${BD_CODES.size} códigos`);
        }

        // El historial ahora se carga desde IndexedDB en HistoryIndexedDBManager.init()
    } catch (e) {
        console.error('Error cargando desde storage:', e);
    }
}

async function saveState() {
    try {
        await window.storage.set('wms_validador_state', JSON.stringify(STATE));
    } catch (e) {
        console.error('Error guardando estado:', e);
    }
}

async function saveBD() {
    try {
        await window.storage.set('wms_validador_bd', JSON.stringify({
            codes: Array.from(BD_CODES),
            obcMap: Array.from(OBC_MAP.entries()).map(([k, v]) => [k, Array.from(v)]),
            totals: Array.from(OBC_TOTALS.entries()),
            info: Array.from(OBC_INFO.entries()),
            lastUpdate: LAST_BD_UPDATE
        }));
    } catch (e) {
        console.error('Error guardando BD:', e);
    }
}

async function saveHistory() {
    // El historial ahora se guarda automáticamente en IndexedDB por HistoryIndexedDBManager
    // Esta función se mantiene por compatibilidad pero ya no hace nada
}

async function loadPrerecData() {
    try {
        const res = await window.storage.get('wms_validador_prerec');
        if (res?.value) {
            const arr = JSON.parse(res.value);
            PREREC_DATA = new Map(arr);
            console.log(`📂 Precepción cargada: ${PREREC_DATA.size} registros`);
        }
    } catch (e) {
        console.error('Error cargando prerecepción:', e);
    }
}

async function savePrerecData() {
    try {
        await window.storage.set('wms_validador_prerec', JSON.stringify(Array.from(PREREC_DATA.entries())));
    } catch (e) {
        console.error('Error guardando prerecepción:', e);
    }
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    initAudio();

    // Inicializar sistema de cache IndexedDB PRIMERO
    await HistoryIndexedDBManager.init();

    await loadFromStorage();
    await loadPrerecData();
    setupListeners();
    setupConnectionMonitor();
    initSyncManager();
    renderValidation();
    
    // Debug mode: bypass Google auth
    if (DebugMode.autoInit('Validador', (userData) => {
        CURRENT_USER = userData.user;
        USER_EMAIL = userData.email;
        USER_GOOGLE_NAME = userData.name;
        showMainApp();
        updateUserFooter();
        showNotification('🔧 DEBUG MODE: Sesión simulada', 'info');
        // Cargar datos mock o reales según necesites
        loadDatabase();
    })) {
        return; // Si debug está activo, no cargar Google API
    }
    
    // Modo normal: Inicializar AuthManager
    // Esperar a que GAPI y Google Identity Services estén cargados
    const initAuth = async () => {
        if (!window.gapi) {
            console.log('⏳ Esperando GAPI...');
            setTimeout(initAuth, 100);
            return;
        }

        gapi.load('client', async () => {
            // Esperar a que Google Identity Services esté disponible
            let retries = 0;
            const waitForGIS = () => {
                if (window.google && google.accounts && google.accounts.oauth2) {
                    console.log('✅ Google Identity Services disponible');
                    initAuthManager();
                } else if (retries < 50) { // Máximo 5 segundos
                    retries++;
                    setTimeout(waitForGIS, 100);
                } else {
                    console.error('❌ Timeout esperando Google Identity Services');
                    showNotification('❌ Error cargando sistema de autenticación. Recarga la página.', 'error');
                }
            };
            waitForGIS();
        });
    };

    const initAuthManager = async () => {
        await AuthManager.init(
            // onAuthSuccess
            async (userData) => {
                USER_EMAIL = userData.email;
                USER_GOOGLE_NAME = userData.name;

                // Verificar si hay alias guardado
                const savedAlias = localStorage.getItem(`wms_alias_${USER_EMAIL}`);
                if (savedAlias) {
                    CURRENT_USER = savedAlias;
                } else {
                    CURRENT_USER = userData.user;
                }

                showMainApp();
                updateUserFooter();
                loadDatabase();

                // Si no hay alias guardado, mostrar popup de configuración
                if (!savedAlias) {
                    setTimeout(() => showAliasPopup(), 500);
                }
            },
            // onAuthError
            (error) => {
                console.error('Auth error:', error);
                showNotification('❌ Error de autenticación', 'error');
            }
        );
    };

    initAuth();
});

function initAudio() {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        document.addEventListener('click', () => audioCtx.state === 'suspended' && audioCtx.resume(), { once: true });
    } catch (e) {}
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.toggle('show', show);
    }
}

// ==================== AUTENTICACIÓN ====================
function handleLogin() {
    AuthManager.login();
}

function showMainApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    renderValidation();
    
    // Trigger animation for empty state
    setTimeout(() => {
        const emptyState = document.getElementById('empty-state');
        if (emptyState && !emptyState.classList.contains('module-visible')) {
            emptyState.classList.add('module-visible');
        }
    }, 100);
}

function showLoginScreen() {
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
}

function toggleGoogleConnection() {
    if (AuthManager.isAuthenticated()) {
        AuthManager.logout();
        showLoginScreen();
        showNotification('� Desconectado de Google', 'info');
    } else {
        handleLogin();
    }
}

// ==================== GESTIÓN DE ALIAS DE USUARIO ====================
async function getUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
        });
        const data = await response.json();
        USER_EMAIL = data.email || '';
        USER_GOOGLE_NAME = data.name || 'Usuario';

        // Verificar si hay alias guardado para este email
        const savedAlias = localStorage.getItem(`wms_alias_${USER_EMAIL}`);
        if (savedAlias) {
            CURRENT_USER = savedAlias;
            showNotification(`✅ Bienvenido, ${CURRENT_USER}`, 'success');
            updateUserFooter();
        } else {
            // Primera vez - mostrar popup de alias
            showAliasPopup();
        }
    } catch (e) {
        console.error('Error obteniendo perfil:', e);
        CURRENT_USER = 'Usuario';
        updateUserFooter();
    }
}

function showAliasPopup() {
    document.querySelectorAll('.alias-popup-overlay').forEach(e => e.remove());

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay alias-popup-overlay';
    overlay.style.display = 'flex';

    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 400px;">
            <div class="popup-header" style="color: var(--primary);">
                👤 Configura tu Nombre
            </div>

            <div style="text-align: center; margin: 20px 0;">
                <div style="width: 60px; height: 60px; border-radius: 50%; background: var(--primary); margin: 0 auto 15px; display: flex; align-items: center; justify-content: center; font-size: 1.8em; color: white;">
                    ${USER_GOOGLE_NAME.charAt(0).toUpperCase()}
                </div>
                <p style="color: #666; font-size: 0.9em;">${USER_EMAIL}</p>
            </div>

            <p style="margin-bottom: 15px; text-align: center;">
                ¿Cómo quieres que te identifiquemos en el sistema?
            </p>

            <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                <button class="btn btn-primary" onclick="saveUserAlias('${USER_GOOGLE_NAME}', true)">
                    ✅ Usar mi nombre: ${USER_GOOGLE_NAME}
                </button>

                <div style="text-align: center; color: #999; font-size: 0.85em;">o</div>

                <div style="display: flex; gap: 8px;">
                    <input id="custom-alias-input" type="text" placeholder="Escribe un alias personalizado"
                           style="flex: 1; padding: 10px; border: 2px solid #ddd; border-radius: 6px; font-size: 1em;"
                           onkeypress="if(event.key==='Enter') saveUserAlias(this.value, false)">
                    <button class="btn btn-secondary" onclick="saveUserAlias(document.getElementById('custom-alias-input').value, false)">
                        Guardar
                    </button>
                </div>
            </div>

            <p style="text-align: center; font-size: 0.8em; color: #888;">
                💡 Podrás cambiar tu nombre más tarde haciendo click en tu avatar
            </p>
        </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('custom-alias-input')?.focus(), 100);
}

function saveUserAlias(alias, isGoogleName = false) {
    const finalAlias = alias?.trim() || USER_GOOGLE_NAME;
    if (!finalAlias) {
        showNotification('⚠️ Ingresa un nombre válido', 'warning');
        return;
    }

    CURRENT_USER = finalAlias;
    localStorage.setItem(`wms_alias_${USER_EMAIL}`, finalAlias);

    document.querySelectorAll('.alias-popup-overlay').forEach(e => e.remove());
    showNotification(`✅ ${isGoogleName ? 'Nombre' : 'Alias'} guardado: ${finalAlias}`, 'success');
    updateUserFooter();
}

function changeUserAlias() {
    showAliasPopup();
}

function updateUserFooter() {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name-display');
    const authBtn = document.getElementById('sidebar-auth-btn');

    if (avatarEl) {
        avatarEl.textContent = CURRENT_USER ? CURRENT_USER.charAt(0).toUpperCase() : '?';
        avatarEl.title = USER_EMAIL || 'No conectado';
        avatarEl.style.cursor = 'pointer';
        avatarEl.onclick = changeUserAlias;
    }
    if (nameEl) {
        nameEl.textContent = CURRENT_USER || 'No conectado';
        nameEl.title = `Click para cambiar alias\n${USER_EMAIL}`;
        nameEl.style.cursor = 'pointer';
        nameEl.onclick = changeUserAlias;
    }
    if (authBtn) authBtn.textContent = gapi?.client?.getToken() ? '🚪 Salir' : '🔗 Conectar';

    updateConnectionIndicator();
    updateBdInfo();
}

// Hacer funciones globales para que funcionen desde el HTML inline
window.saveUserAlias = saveUserAlias;
window.changeUserAlias = changeUserAlias;

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
        showLoading(true);

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
        showLoading(false);
        showNotification(`✅ ${BD_CODES.size} códigos cargados`, 'success');
    } catch (error) {
        console.error('Error loading database:', error);
        showLoading(false);
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

// Función adicional para mostrar popup de ubicación inválida con justificación
let pendingInvalidLocation = null;

function showInvalidLocationPopup(location, errorMessage) {
    pendingInvalidLocation = location;
    document.getElementById('invalid-location-code').textContent = location;
    document.getElementById('invalid-location-message').textContent = errorMessage;
    document.getElementById('invalid-location-justification').value = '';
    showPopup('invalid-location');
}

function forceInvalidLocation() {
    if (!pendingInvalidLocation) return;

    const justification = document.getElementById('invalid-location-justification').value.trim();
    const finalLocation = justification
        ? `${pendingInvalidLocation} (FORZADO: ${justification})`
        : `${pendingInvalidLocation} (FORZADO)`;

    const locationInput = document.getElementById('location-input');
    if (locationInput) {
        locationInput.value = finalLocation;
        STATE.currentLocation = finalLocation;
    }

    closePopup('invalid-location');
    showNotification(`⚠️ Ubicación forzada: ${pendingInvalidLocation}`, 'warning');
    pendingInvalidLocation = null;
}

window.forceInvalidLocation = forceInvalidLocation;

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
    // Primero extraer el código usando extractCode, luego normalizarlo
    const extractedCode = extractCode(raw);
    const code = normalizeCode(extractedCode);
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
    const concatenated = code + obc.toLowerCase();
    const historyData = { date: log.date, timestamp: log.timestamp, user: log.user, obc, code, raw, location, note: log.note };
    HISTORY.set(concatenated, historyData);

    // Guardar en IndexedDB para cache persistente
    await HistoryIndexedDBManager.addValidation(concatenated, historyData);

    addToPendingSync('Validaciones', log);
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

    if (syncManager) syncManager.sync(false);
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
    addToPendingSync('Rechazos', log);

    await saveState();

    showPopup('error', code, reason);
    playSound('error');
    flashInput('error');
    renderValidation();

    if (syncManager) syncManager.sync(false);
}

// ==================== EXTRACCIÓN Y NORMALIZACIÓN DE CÓDIGOS ====================
// extractCode - Versión avanzada para parsear códigos en múltiples formatos
function extractCode(raw) {
    if (raw === null || raw === undefined) return '';
    let code = String(raw).trim();

    // Remover caracteres invisibles
    code = code.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\uFEFF]/g, '').trim();

    // IMPORTANTE: Convertir *, & y - (entre números) a / ANTES de cualquier extracción
    code = code.replace(/\'/g, '/');
    code = code.replace(/\'/g, '/');
    code = code.replace(/\*/g, '/');
    code = code.replace(/&/g, '/');
    code = code.replace(/(\d)-(\d)/g, '$1/$2'); // 37843434-1 → 37843434/1

    // Normalizar comillas raras
    code = code.replace(/[""«»„‟‚‛''¨]/g, '"');

    // Eliminar caracteres intermedios problemáticos como ñ[, ?
    code = code.replace(/ñ\[/g, '');
    code = code.replace(/\?/g, '');

    // 1) Intento de extraer JSON válido dentro del texto
    try {
        const first = (() => {
            const a = code.indexOf('{');
            const b = code.indexOf('[');
            const aa = a !== -1 ? a : Infinity;
            const bb = b !== -1 ? b : Infinity;
            return Math.min(aa, bb);
        })();

        const last = Math.max(code.lastIndexOf('}'), code.lastIndexOf(']'));

        let candidate = code;
        if (first !== Infinity && last > first) {
            candidate = code.slice(first, last + 1);
        }

        const parsed = JSON.parse(candidate);

        function findKey(obj) {
            if (!obj) return null;
            if (typeof obj === 'string' || typeof obj === 'number') return null;

            if (Array.isArray(obj)) {
                for (const item of obj) {
                    const r = findKey(item);
                    if (r) return r;
                }
                return null;
            }

            if (typeof obj === 'object') {
                for (const k of Object.keys(obj)) {
                    const val = obj[k];
                    const kl = k.toLowerCase();
                    if (['id', 'codigo', 'code', 'cod'].includes(kl)) {
                        if (typeof val === 'string' || typeof val === 'number') {
                            return String(val).trim();
                        }
                    }
                }
                // Búsqueda profunda
                for (const k of Object.keys(obj)) {
                    const r = findKey(obj[k]);
                    if (r) return r;
                }
            }
            return null;
        }
        const found = findKey(parsed);
        if (found) return found;

    } catch (e) {
        // No es JSON válido, continuar con patrones regex
    }

    // 2) Patrones regex para extraer códigos
    const patterns = [
        // [id[ CODE [ - Prioridad alta: formato con slash (49987997/1)
        /\[id\[\s*([A-Za-z0-9]+\/[A-Za-z0-9\/\-\._:]+)\s*\[/i,

        // [id[ CODE [ - formato general
        /\[id\[\s*([A-Za-z0-9\/\-\._:]{3,})\s*\[/i,

        // "id": "CODE" o "id" CODE
        /(?:"|["'])?id(?:"|["'])?\s*[:=]?\s*["']?([A-Za-z0-9]+\/[A-Za-z0-9\/\-\._:]+)["']?/i,
        /(?:"|["'])?id(?:"|["'])?\s*[:=]?\s*["']?([A-Za-z0-9\/\-\._:]{3,})["']?/i,

        // id = CODE
        /\bid\s*[:=]\s*([A-Za-z0-9]+\/[A-Za-z0-9\/\-\._:]+)/i,
        /\bid\s*[:=]\s*([A-Za-z0-9\/\-\._:]{3,})/i,

        // Formatos con slash ABC/123 (alta prioridad)
        /([0-9]+\/[0-9]+)/,
        /([A-Za-z0-9]{2,}\/[A-Za-z0-9\/\-\._:]{1,})/,

        // Cualquier token alfanumérico largo dentro de texto
        /.*?([A-Za-z0-9]{6,}).*/,

        // Super fallback: números largos (000123456)
        /([0-9]{6,})/
    ];

    for (const p of patterns) {
        const m = code.match(p);
        if (m && m[1]) return m[1].trim();
    }

    return code.trim();
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

    // Actualizar UI de sincronización
    if (syncManager) syncManager.updateUI(syncManager.getPendingCount() === 0);
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

// ==================== EXPORTACIÓN DE DATOS ====================
function exportData() {
    const rows = [];
    rows.push('Fecha,Hora,Usuario,Orden,Código,Ubicación,Nota');

    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    for (const obc in allOrders) {
        const order = allOrders[obc];
        if (order.validations) {
            order.validations.forEach(log => {
                // Escapar comas en los datos para CSV
                const escapeCsv = (str) => {
                    if (!str) return '';
                    str = String(str);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                };

                rows.push([
                    escapeCsv(log.date),
                    escapeCsv(log.timestamp),
                    escapeCsv(log.user),
                    escapeCsv(log.obc),
                    escapeCsv(log.code),
                    escapeCsv(log.location || ''),
                    escapeCsv(log.note || '')
                ].join(','));
            });
        }
    }

    if (rows.length === 1) {
        showNotification('⚠️ No hay datos para exportar', 'warning');
        return;
    }

    const csv = '\ufeff' + rows.join('\n'); // BOM para UTF-8
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `validaciones_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();

    showNotification(`📥 Exportadas ${rows.length - 1} validaciones`, 'success');
}

window.exportData = exportData;

// ==================== ESTADÍSTICAS DE USUARIO ====================
function showUserStats() {
    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    const userStats = {};
    let total = 0;

    for (const obc in allOrders) {
        const order = allOrders[obc];
        if (order.validations) {
            order.validations.forEach(val => {
                const user = val.user || 'Usuario';
                if (!userStats[user]) userStats[user] = 0;
                userStats[user]++;
                total++;
            });
        }
    }

    const sortedUsers = Object.entries(userStats).sort((a, b) => b[1] - a[1]);
    const content = document.getElementById('user-stats-content');
    if (!content) {
        showNotification('⚠️ Popup de estadísticas no disponible', 'warning');
        return;
    }

    content.innerHTML = '';

    if (sortedUsers.length === 0) {
        content.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No hay validaciones registradas</p>';
    } else {
        sortedUsers.forEach(([user, count]) => {
            const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
            const div = document.createElement('div');
            div.className = 'user-stat-item';
            div.style.cssText = 'margin-bottom: 20px;';
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <div>
                        <div style="font-weight: 700; font-size: 1.1em;">${user}</div>
                        <div style="color: #666; font-size: 0.9em;">${percentage}% del total</div>
                    </div>
                    <div style="font-size: 1.5em; font-weight: 700; color: var(--primary);">${count}</div>
                </div>
                <div style="background: #e0e0e0; height: 8px; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${percentage}%; height: 100%; background: linear-gradient(90deg, var(--primary), var(--primary-dark)); border-radius: 4px; transition: width 0.3s;"></div>
                </div>
            `;
            content.appendChild(div);
        });

        const totalDiv = document.createElement('div');
        totalDiv.style.cssText = 'margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 8px; text-align: center; font-weight: 700;';
        totalDiv.innerHTML = `Total: <span style="color: var(--primary); font-size: 1.5em;">${total}</span> validaciones`;
        content.appendChild(totalDiv);
    }

    const popup = document.getElementById('user-stats-popup');
    const overlay = document.getElementById('user-stats-overlay');
    if (popup) popup.classList.add('active');
    if (overlay) overlay.classList.add('active');
}

function closeUserStats() {
    const popup = document.getElementById('user-stats-popup');
    const overlay = document.getElementById('user-stats-overlay');
    if (popup) popup.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

window.showUserStats = showUserStats;
window.closeUserStats = closeUserStats;

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
