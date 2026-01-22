// ==================== CONFIGURACIÓN ====================
const CLIENT_ID = '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com';
const SPREADSHEET_BD = '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck';
const SPREADSHEET_WRITE = '1gU5yDb0R4_Mf1fE-lOA7vwYmTUBR0wV7EPGg5zUt2Xo';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile';

// ==================== ESTADO GLOBAL ====================
// NOTA: CURRENT_USER se expone en window para que AvatarSystem pueda actualizarlo
let CURRENT_USER = '';
let USER_EMAIL = '';
let USER_GOOGLE_NAME = '';

// ==================== CONNECTION REHYDRATION SYSTEM ====================
let CONNECTION_STATE = {
    isAuthenticated: false,
    isDatabaseConnected: false,
    isRehydrating: false,
    lastConnectionAttempt: null,
    retryCount: 0,
    maxRetries: 3
};

// Exponer CURRENT_USER globalmente para sincronización con AvatarSystem
Object.defineProperty(window, 'CURRENT_USER', {
    get: function() { return CURRENT_USER; },
    set: function(value) { 
        CURRENT_USER = value;
        console.log('🔄 [GLOBAL] CURRENT_USER actualizado:', value);
    },
    enumerable: true,
    configurable: true
});
let LAST_BD_UPDATE = null;
let BD_LOADING = false; // Bandera para rastrear si la BD está cargando
let BD_DATA_READY = false; // Indica si hay datos disponibles (cache o servidor)
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

// ==================== SISTEMA DE DEDUPLICACIÓN ====================
// Registro de validaciones ya sincronizadas para evitar duplicados (similar a scan.html)
let SYNCED_VALIDATIONS = new Set();

const ValidationDeduplicationManager = {
    // Genera una clave única para una validación
    generateValidationKey(code, obc, location) {
        // Validar que los parámetros existan antes de usar métodos de string
        const safeCode = (code || '').toString().toUpperCase();
        const safeObc = (obc || '').toString().toUpperCase();
        const safeLocation = (location || '').toString().toUpperCase();
        return `${safeCode}|${safeObc}|${safeLocation}`;
    },

    // Verifica si una validación ya fue sincronizada
    isValidationSynced(code, obc, location) {
        const key = this.generateValidationKey(code, obc, location);
        return SYNCED_VALIDATIONS.has(key);
    },

    // Marca una validación como sincronizada
    markValidationAsSynced(code, obc, location) {
        const key = this.generateValidationKey(code, obc, location);
        SYNCED_VALIDATIONS.add(key);
        this.saveSyncedValidations();
        console.log(`✅ [DEDUP] Validación marcada como sincronizada: ${key}`);
    },

    // Guarda el registro en localStorage
    saveSyncedValidations() {
        try {
            localStorage.setItem('validador_synced_validations', JSON.stringify([...SYNCED_VALIDATIONS]));
        } catch (e) {
            console.error('❌ [DEDUP] Error guardando validaciones sincronizadas:', e);
        }
    },

    // Carga el registro desde localStorage
    loadSyncedValidations() {
        try {
            const saved = localStorage.getItem('validador_synced_validations');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    SYNCED_VALIDATIONS = new Set(parsed);
                    console.log(`📂 [DEDUP] Cargadas ${SYNCED_VALIDATIONS.size} validaciones sincronizadas`);
                } else {
                    console.warn('⚠️ [DEDUP] Datos corruptos en localStorage, limpiando...');
                    SYNCED_VALIDATIONS = new Set();
                    this.saveSyncedValidations();
                }
            }
        } catch (e) {
            console.error('❌ [DEDUP] Error cargando validaciones sincronizadas:', e);
            SYNCED_VALIDATIONS = new Set();
            localStorage.removeItem('validador_synced_validations');
        }
    },

    // Limpia validaciones antiguas (más de 24 horas)
    cleanOldValidations() {
        const now = Date.now();
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        let cleaned = 0;

        for (const key of SYNCED_VALIDATIONS) {
            // Las claves tienen formato: CODE|OBC|LOCATION
            const parts = key.split('|');
            if (parts.length >= 2) {
                const obc = parts[1];
                const obcParts = obc.split('-');
                if (obcParts.length >= 2) {
                    try {
                        const timestamp = parseInt(obcParts[1], 36);
                        if (!isNaN(timestamp) && timestamp < oneDayAgo) {
                            SYNCED_VALIDATIONS.delete(key);
                            cleaned++;
                        }
                    } catch (e) {
                        // Si no se puede parsear, mantener la validación
                    }
                }
            }
        }

        if (cleaned > 0) {
            this.saveSyncedValidations();
            console.log(`🧹 [DEDUP] Limpiadas ${cleaned} validaciones antiguas`);
        }
    },

    // Limpia completamente el cache
    clearSyncedValidations() {
        SYNCED_VALIDATIONS.clear();
        localStorage.removeItem('validador_synced_validations');
        console.log('🧹 [DEDUP] Cache de validaciones sincronizadas limpiado completamente');
    }
};

// Exponer globalmente para que AdvancedSyncManager pueda acceder
window.ValidationDeduplicationManager = ValidationDeduplicationManager;

// ==================== CONNECTION REHYDRATION MANAGER ====================
const ConnectionRehydrationManager = {
    /**
     * Intenta rehidratar la conexión automáticamente al cargar la página
     */
    async rehydrateConnection() {
        if (CONNECTION_STATE.isRehydrating) {
            console.log('⏳ [REHYDRATION] Ya hay una rehidratación en progreso...');
            return false;
        }

        CONNECTION_STATE.isRehydrating = true;
        CONNECTION_STATE.lastConnectionAttempt = Date.now();
        
        console.log('🔄 [REHYDRATION] Iniciando rehidratación de conexión...');
        
        try {
            // Paso 1: Verificar y restaurar token de autenticación
            const authRestored = await this.restoreAuthentication();
            if (!authRestored) {
                console.warn('⚠️ [REHYDRATION] No se pudo restaurar autenticación');
                CONNECTION_STATE.isRehydrating = false;
                return false;
            }
            
            CONNECTION_STATE.isAuthenticated = true;
            console.log('✅ [REHYDRATION] Autenticación restaurada');
            
            // Paso 2: Cargar datos desde cache primero (UI instantánea)
            const cacheLoaded = await this.loadFromCache();
            if (cacheLoaded) {
                console.log('✅ [REHYDRATION] Datos cargados desde cache');
                BD_DATA_READY = true;
                showNotification('📦 Datos cargados desde cache', 'info');
            }
            
            // Paso 3: Reconectar base de datos en segundo plano
            this.reconnectDatabaseInBackground();
            
            CONNECTION_STATE.isRehydrating = false;
            return true;
            
        } catch (error) {
            console.error('❌ [REHYDRATION] Error en rehidratación:', error);
            CONNECTION_STATE.isRehydrating = false;
            return false;
        }
    },
    
    /**
     * Restaura la autenticación desde token guardado
     * IMPORTANTE: Token expira después de 12 horas de inactividad
     */
    async restoreAuthentication() {
        const savedToken = localStorage.getItem('google_access_token');
        const tokenExpiry = localStorage.getItem('google_token_expiry');
        const lastActivity = localStorage.getItem('wms_last_activity');

        if (!savedToken || !tokenExpiry) {
            return false;
        }

        const expiryTime = parseInt(tokenExpiry, 10);
        const now = Date.now();

        // NUEVA VALIDACIÓN: Expiración por inactividad de 12 horas
        const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const inactivityTime = now - lastActivityTime;
            if (inactivityTime > TWELVE_HOURS_MS) {
                console.log('⚠️ [REHYDRATION] Sesión expirada por inactividad (12 horas)');
                localStorage.removeItem('google_access_token');
                localStorage.removeItem('google_token_expiry');
                localStorage.removeItem('wms_last_activity');
                return false;
            }
        }

        // Verificar si el token aún es válido (con margen de 5 min)
        if (expiryTime > now + (5 * 60 * 1000)) {
            try {
                // Validar token con Google
                const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                    headers: { Authorization: `Bearer ${savedToken}` }
                });

                if (response.ok) {
                    gapi.client.setToken({ access_token: savedToken });
                    const data = await response.json();
                    USER_EMAIL = data.email || '';
                    USER_GOOGLE_NAME = data.name || 'Usuario';

                    const savedAlias = localStorage.getItem(`wms_alias_${USER_EMAIL}`);
                    const nameToUse = savedAlias || data.name || 'Usuario';
                    CURRENT_USER = window.AvatarSystem?.formatNameToTitle?.(nameToUse) || nameToUse;

                    // Actualizar timestamp de última actividad
                    localStorage.setItem('wms_last_activity', Date.now().toString());

                    return true;
                } else {
                    throw new Error('Token inválido');
                }
            } catch (e) {
                console.log('⚠️ [REHYDRATION] Token inválido o expirado');
                localStorage.removeItem('google_access_token');
                localStorage.removeItem('google_token_expiry');
                localStorage.removeItem('wms_last_activity');
                return false;
            }
        } else {
            console.log('⚠️ [REHYDRATION] Token expirado');
            localStorage.removeItem('google_access_token');
            localStorage.removeItem('google_token_expiry');
            localStorage.removeItem('wms_last_activity');
            return false;
        }
    },
    
    /**
     * Carga datos desde cache local (localStorage/IndexedDB)
     */
    async loadFromCache() {
        try {
            // Cargar OBC_TOTALS desde localStorage
            const totalsRes = await window.storage.get('wms_validador_totals');
            if (totalsRes?.value) {
                const totalsData = JSON.parse(totalsRes.value);
                OBC_TOTALS.clear();
                for (const [obc, total] of Object.entries(totalsData)) {
                    OBC_TOTALS.set(obc, total);
                }
                console.log(`📦 [CACHE] Cargados ${OBC_TOTALS.size} totales de órdenes`);
            }
            
            // Cargar BD desde localStorage
            const bdRes = await window.storage.get('wms_validador_bd');
            if (bdRes?.value) {
                const bdData = JSON.parse(bdRes.value);
                
                // Restaurar BD_CODES
                if (bdData.codes && Array.isArray(bdData.codes)) {
                    BD_CODES = new Set(bdData.codes);
                }
                
                // Restaurar OBC_MAP
                if (bdData.obcMap && Array.isArray(bdData.obcMap)) {
                    OBC_MAP = new Map(bdData.obcMap.map(([k, v]) => [k, new Set(v)]));
                }
                
                // Restaurar OBC_INFO
                if (bdData.obcInfo && Array.isArray(bdData.obcInfo)) {
                    OBC_INFO = new Map(bdData.obcInfo);
                }
                
                console.log(`📦 [CACHE] Cargados ${BD_CODES.size} códigos de BD`);
                
                if (BD_CODES.size > 0) {
                    updateBdInfo('Cache');
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            console.error('❌ [CACHE] Error cargando desde cache:', error);
            return false;
        }
    },
    
    /**
     * Reconecta la base de datos en segundo plano
     */
    async reconnectDatabaseInBackground() {
        console.log('🔄 [REHYDRATION] Reconectando base de datos en segundo plano...');
        
        try {
            await loadDatabase(true); // true = silent mode
            CONNECTION_STATE.isDatabaseConnected = true;
            CONNECTION_STATE.retryCount = 0;
            console.log('✅ [REHYDRATION] Base de datos reconectada exitosamente');
            showNotification('✅ Base de datos actualizada', 'success');
        } catch (error) {
            console.error('❌ [REHYDRATION] Error reconectando base de datos:', error);
            CONNECTION_STATE.isDatabaseConnected = false;
            
            // Intentar retry con backoff exponencial
            if (CONNECTION_STATE.retryCount < CONNECTION_STATE.maxRetries) {
                CONNECTION_STATE.retryCount++;
                const retryDelay = Math.min(1000 * Math.pow(2, CONNECTION_STATE.retryCount), 30000);
                console.log(`🔄 [REHYDRATION] Reintentando en ${retryDelay/1000}s (intento ${CONNECTION_STATE.retryCount}/${CONNECTION_STATE.maxRetries})`);
                
                setTimeout(() => {
                    this.reconnectDatabaseInBackground();
                }, retryDelay);
            } else {
                console.error('❌ [REHYDRATION] Máximo de reintentos alcanzado');
                showNotification('⚠️ No se pudo conectar a la base de datos. Haz clic en "Reconectar"', 'warning');
                createAuthErrorBanner();
            }
        }
    },
    
    /**
     * Verifica el estado de salud de la conexión
     */
    async checkConnectionHealth() {
        try {
            const token = gapi?.client?.getToken();
            if (!token) {
                return { healthy: false, reason: 'No token' };
            }
            
            // Verificar que el token funcione
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token.access_token}` }
            });
            
            if (!response.ok) {
                return { healthy: false, reason: 'Token inválido' };
            }
            
            // Verificar que tengamos datos
            if (BD_CODES.size === 0) {
                return { healthy: false, reason: 'Sin datos de BD' };
            }
            
            return { healthy: true };
        } catch (error) {
            return { healthy: false, reason: error.message };
        }
    },
    
    /**
     * Intenta reconectar manualmente
     * CRÍTICO: Limpia tokens y fuerza nueva autenticación
     */
    async manualReconnect() {
        console.log('🔄 [REHYDRATION] Reconexión manual iniciada...');
        showNotification('🔄 Reconectando...', 'info');

        // Remover banner de error si existe
        const banner = document.getElementById('auth-error-banner');
        if (banner) banner.remove();

        // CRÍTICO: Limpiar tokens inválidos antes de reconectar
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_expiry');
        if (gapi?.client) {
            gapi.client.setToken('');
        }

        CONNECTION_STATE.retryCount = 0;
        CONNECTION_STATE.isAuthenticated = false;

        // Resetear bandera de carga de BD
        BD_LOADING = false;

        // Forzar nueva autenticación a través del flujo de login
        if (window.AuthManager && window.AuthManager.tokenClient) {
            console.log('🔐 [REHYDRATION] Forzando nueva autenticación...');
            try {
                // Solicitar nuevo token con prompt
                window.AuthManager.tokenClient.requestAccessToken({ prompt: '' });
            } catch (e) {
                console.error('❌ [REHYDRATION] Error solicitando token:', e);
                showNotification('❌ Error de autenticación. Recarga la página.', 'error');
            }
        } else {
            // Fallback: mostrar pantalla de login
            showNotification('⚠️ Inicia sesión nuevamente', 'warning');
            showLoginScreen();
        }
    }
};

window.ConnectionRehydrationManager = ConnectionRehydrationManager;

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
            // Columnas: A(Fecha), B(Hora), C(Usuario), D(OBC), E(Código), F(Ubicación), G(Nota)
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_WRITE,
                range: 'Val3!A:G'
            });

            const rows = response.result.values || [];
            const newHistory = new Map();

            // Saltar header (fila 0) y procesar datos
            // Estructura de columnas Val3:
            // A(0)=Fecha, B(1)=Hora, C(2)=Usuario, D(3)=OBC, E(4)=Código, F(5)=Ubicación, G(6)=Nota
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[3] || !row[4]) continue; // Requiere obc y código (columna E, índice 4)

                const obc = row[3]?.toString().trim().toUpperCase();
                const code = row[4]?.toString().trim().toUpperCase(); // Columna E = Código
                const concatenated = code + obc.toLowerCase();

                if (concatenated) {
                    newHistory.set(concatenated, {
                        date: row[0]?.toString().trim() || '',
                        timestamp: row[1]?.toString().trim() || '',
                        user: row[2]?.toString().trim() || '',
                        obc: obc,
                        raw: code, // El raw es el mismo código
                        code: code,
                        location: row[5]?.toString().trim() || '', // Columna F = Ubicación
                        note: row[6]?.toString().trim() || '' // Columna G = Nota
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
// Usar el módulo compartido SyncManager
let syncManager = null;

async function initSyncManager() {
    // Inicializar Advanced Sync Manager
    await initAdvancedSync();
    syncManager = window.syncManager;
    
    // Actualizar estadísticas iniciales
    if (syncManager) {
        const stats = getValidadorSyncStats();
        if (stats) {
            updateSummaryStats(stats);
        }
    }
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

// Actualizar resumen global de la sesión
function updateGlobalSummary() {
    let totalValidated = 0;
    let totalRejected = 0;
    let totalExpected = 0;

    // CORRECCIÓN: Log para debug
    console.log('📊 [VALIDADOR] Actualizando resumen global...');

    // Calcular totales de todas las órdenes activas
    Object.keys(STATE.tabs).forEach(obc => {
        const tab = STATE.tabs[obc];
        const total = OBC_TOTALS.get(obc) || 0;

        // CORRECCIÓN: Log detallado para detectar valores incorrectos
        console.log(`📦 [VALIDADOR] OBC: ${obc}, Total esperado: ${total}, Validadas: ${tab.validations.length}, Rechazadas: ${tab.rejections.length}`);

        // CORRECCIÓN: Validar si el total es sospechosamente alto
        if (total > 10000) {
            console.error(`❌ [VALIDADOR] VALOR ANÓMALO: OBC ${obc} tiene ${total} cajas esperadas (revisar hoja Resumen)`);
        }

        totalValidated += tab.validations.length;
        totalRejected += tab.rejections.length;
        totalExpected += total;
    });

    const grandTotal = totalValidated + totalRejected;

    // CORRECCIÓN: Log del resultado final
    console.log(`✅ [VALIDADOR] Resumen: Validadas=${totalValidated}, Rechazadas=${totalRejected}, Total=${grandTotal}`);

    // Actualizar UI usando SidebarComponent si está disponible
    if (window.sidebarComponent) {
        window.sidebarComponent.updateSummary({
            validated: totalValidated,
            rejected: totalRejected,
            summaryTotal: grandTotal
        });
    } else {
        // Fallback: actualizar elementos DOM directamente
        const validatedEl = document.getElementById('summary-validated');
        const rejectedEl = document.getElementById('summary-rejected');
        const totalEl = document.getElementById('summary-total');

        if (validatedEl) validatedEl.textContent = totalValidated;
        if (rejectedEl) rejectedEl.textContent = totalRejected;
        if (totalEl) totalEl.textContent = grandTotal;
    }
}

// Helper para agregar a la cola de sync usando Advanced Sync Manager
async function addToPendingSync(log) {
    if (!syncManager) {
        console.warn('⚠️ [VALIDADOR] syncManager no disponible, validación no se sincronizará');
        return;
    }

    try {
        // Formatear el registro para el Advanced Sync Manager
        // CRÍTICO: Generar ID único aquí para evitar deduplicación agresiva de escaneos múltiples
        const uniqueId = `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const record = {
            _id: uniqueId, // ID único para bypass de deduplicación por contenido
            date: log.date,
            time: log.timestamp,
            user: log.user,
            obc: log.obc,
            codigo: log.code,
            destino: OBC_INFO.get(log.obc)?.recipient || '-',
            horario: OBC_INFO.get(log.obc)?.arrivalTime || '-',
            ubicacion: log.location || '',
            estatus: 'OK',
            nota: log.note || ''
        };

        await syncManager.addToQueue(record);
        console.log('✅ [VALIDADOR] Validación agregada a cola de sincronización:', log.code, `(ID: ${uniqueId})`);
    } catch (error) {
        console.error('❌ [VALIDADOR] Error al agregar a cola de sync:', error);
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
            if (e.name === 'QuotaExceededError') {
                console.warn(`⚠️ LocalStorage lleno. Limpiando datos antiguos para ${key}...`);
                // Intentar limpiar datos antiguos excepto los críticos
                const criticalKeys = ['wms_validador_state', 'wms_validador_bd'];
                for (let i = 0; i < localStorage.length; i++) {
                    const storageKey = localStorage.key(i);
                    if (storageKey && !criticalKeys.includes(storageKey) && !storageKey.startsWith('wms_')) {
                        localStorage.removeItem(storageKey);
                    }
                }
                // Reintentar guardar
                try {
                    localStorage.setItem(key, value);
                    console.log(`✅ Datos guardados después de limpieza`);
                } catch (retryError) {
                    console.error(`❌ No se pudo guardar ${key} incluso después de limpieza:`, retryError);
                }
            } else {
                console.error(`Error setting ${key}:`, e);
            }
        }
    }
};

async function loadFromStorage() {
    try {
        console.log('⏳ [VALIDADOR] Cargando estado desde storage...');
        const stateRes = await window.storage.get('wms_validador_state');
        if (stateRes?.value) {
            const loaded = JSON.parse(stateRes.value);
            STATE.tabs = loaded.tabs || {};
            STATE.closedTabs = loaded.closedTabs || {};
            STATE.activeOBC = loaded.activeOBC;
            STATE.sessionStats = loaded.sessionStats || { total: 0, valid: 0, invalid: 0 };
            console.log('✅ [VALIDADOR] Estado cargado:', {
                tabs: Object.keys(STATE.tabs).length,
                activeOBC: STATE.activeOBC
            });
        } else {
            console.log('ℹ️ [VALIDADOR] No hay estado previo guardado');
        }

        // Intentar cargar OBC_TOTALS desde localStorage como respaldo
        const totalsRes = await window.storage.get('wms_validador_totals');
        if (totalsRes?.value) {
            const totalsData = JSON.parse(totalsRes.value);
            for (const [obc, total] of Object.entries(totalsData)) {
                OBC_TOTALS.set(obc, total);
            }
            console.log(`✅ [VALIDADOR] ${OBC_TOTALS.size} totales de órdenes cargados desde cache`);
        }

        // El historial ahora se carga desde IndexedDB en HistoryIndexedDBManager.init()
    } catch (e) {
        console.error('❌ [VALIDADOR] Error cargando desde storage:', e);
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
    // ❌ DESHABILITADO: La BD de validación es muy grande (>5MB)
    // No se debe guardar en localStorage ya que causa QuotaExceededError
    // La BD se recarga desde Google Sheets en cada sesión
    console.log('ℹ️ [BD] BD no se guarda en localStorage (se recarga desde Google Sheets en cada sesión)');
    return;
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

// ==================== SIDEBAR COMPONENT ====================
function initSidebarComponent() {
    // Verificar que SidebarComponent esté disponible
    if (typeof SidebarComponent === 'undefined') {
        console.warn('⚠️ SidebarComponent no está disponible, usando implementación local');
        return;
    }

    try {
        // Inicializar SidebarComponent con configuración de validador usando preset
        window.sidebarComponent = new SidebarComponent({
            ...SidebarComponent.presets.validador,
            containerId: 'sidebar',
            syncManager: window.syncManager,
            // Usar las funciones específicas para los botones del footer
            onReloadBD: handleSyncBD,
            onLogout: handleFullLogout,
            onToggleConnection: handleToggleGoogleAuth,
            buttons: [
                { label: 'Nueva Orden', icon: '➕', onClick: 'addOBC()', class: 'sidebar-btn-primary' },
                { label: 'Resumen', icon: '📋', onClick: 'showResumen()', class: 'sidebar-btn-secondary' },
                { label: 'Prerecepción', icon: '📋', onClick: 'showPrerecepcion()', class: 'sidebar-btn-secondary' },
                { label: 'Consulta', icon: '🔎', onClick: 'showConsulta()', class: 'sidebar-btn-secondary' }
            ]
        });

        window.sidebarComponent.render();
        console.log('✅ SidebarComponent renderizado');
    } catch (error) {
        console.error('❌ Error inicializando SidebarComponent:', error);
    }
}

// Función para actualizar BD info en el sidebar
function updateBdInfo() {
    if (window.sidebarComponent) {
        window.sidebarComponent.updateBDInfo(BD_CODES.size);
    }
    
    // Fallback para elementos DOM directos (compatibilidad)
    const countEl = document.getElementById('bd-count');
    const timeEl = document.getElementById('bd-update-time');
    if (countEl) countEl.textContent = BD_CODES.size;
    if (timeEl) timeEl.textContent = LAST_BD_UPDATE
        ? `Actualizado: ${new Date(LAST_BD_UPDATE).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`
        : 'Sin actualizar';
}

// Función reloadBD para el botón del sidebar
async function reloadBD() {
    // Verificar salud de conexión primero
    const health = await ConnectionRehydrationManager.checkConnectionHealth();
    if (!health.healthy) {
        console.warn('⚠️ [RELOAD-BD] Conexión no saludable:', health.reason);
        showNotification('⚠️ Verificando conexión...', 'warning');
        await ConnectionRehydrationManager.manualReconnect();
        return;
    }
    
    await loadDatabase();
}

// Hacer funciones globales
window.reloadBD = reloadBD;
window.handleLogoutAndClearCache = handleLogoutAndClearCache;
window.toggleGoogleConnection = toggleGoogleConnection;

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 [VALIDADOR] Iniciando aplicación...');

    try {
        initAudio();
        console.log('✅ [VALIDADOR] Audio inicializado');

        // Inicializar sistema de cache IndexedDB PRIMERO
        console.log('⏳ [VALIDADOR] Inicializando IndexedDB...');
        await HistoryIndexedDBManager.init();
        console.log('✅ [VALIDADOR] IndexedDB inicializado');

        // Cargar sistema de deduplicación
        console.log('⏳ [VALIDADOR] Cargando sistema de deduplicación...');
        ValidationDeduplicationManager.loadSyncedValidations();
        ValidationDeduplicationManager.cleanOldValidations();
        console.log('✅ [VALIDADOR] Sistema de deduplicación cargado');

        console.log('⏳ [VALIDADOR] Cargando datos de storage...');
        await loadFromStorage();
        await loadPrerecData();
        console.log('✅ [VALIDADOR] Datos cargados');

        console.log('⏳ [VALIDADOR] Configurando listeners...');
        setupListeners();
        setupConnectionMonitor();
        console.log('✅ [VALIDADOR] Listeners configurados');

        console.log('⏳ [VALIDADOR] Inicializando Sync Manager...');
        await initSyncManager();
        console.log('✅ [VALIDADOR] Sync Manager inicializado');

        console.log('⏳ [VALIDADOR] Inicializando SidebarComponent...');
        initSidebarComponent();
        console.log('✅ [VALIDADOR] SidebarComponent inicializado');

        renderValidation();
        console.log('✅ [VALIDADOR] Renderización inicial completada');
        
        // NUEVO: Intentar rehidratación automática si hay token guardado
        console.log('⏳ [VALIDADOR] Verificando rehidratación automática...');
        const hasToken = localStorage.getItem('google_access_token');
        if (hasToken) {
            console.log('🔄 [VALIDADOR] Token encontrado, intentando rehidratación...');
            const rehydrated = await ConnectionRehydrationManager.rehydrateConnection();
            if (rehydrated) {
                showMainApp();
                updateUIAfterAuth();
                startBDAutoRefresh();
                console.log('✅ [VALIDADOR] Rehidratación exitosa');
                return; // Salir para evitar inicializar auth de nuevo
            }
        }
    } catch (error) {
        console.error('❌ [VALIDADOR] Error durante inicialización:', error);
        showNotification('❌ Error al inicializar la aplicación', 'error');
    }
    
    // Debug mode: bypass Google auth
    if (DebugMode.autoInit('Validador', async (userData) => {
        CURRENT_USER = userData.user;
        USER_EMAIL = userData.email;
        USER_GOOGLE_NAME = userData.name;
        showMainApp();
        updateUserFooter();
        showNotification('🔧 DEBUG MODE: Sesión simulada', 'info');
        // Cargar datos mock o reales según necesites
        await loadDatabase();
        // Iniciar auto-refresh de BD cada 30 minutos
        startBDAutoRefresh();
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

        try {
            gapi.load('client', async () => {
                console.log('✅ GAPI client cargado');
                
                // Esperar a que Google Identity Services esté disponible
                let retries = 0;
                const maxRetries = 100; // Máximo 10 segundos
                
                const waitForGIS = () => {
                    if (window.google && google.accounts && google.accounts.oauth2) {
                        console.log('✅ Google Identity Services disponible');
                        initAuthManager();
                    } else if (retries < maxRetries) {
                        retries++;
                        if (retries % 10 === 0) {
                            console.log(`⏳ Esperando Google Identity Services... (${retries}/${maxRetries})`);
                        }
                        setTimeout(waitForGIS, 100);
                    } else {
                        console.error('❌ Timeout esperando Google Identity Services');
                        showNotification('❌ Error cargando Google Identity Services. Verifica tu conexión a internet.', 'error');
                        
                        // Mostrar botón de retry en el login
                        const loginBtn = document.getElementById('login-btn');
                        if (loginBtn) {
                            loginBtn.textContent = '🔄 Reintentar Conexión';
                            loginBtn.disabled = false;
                            loginBtn.onclick = () => {
                                location.reload();
                            };
                        }
                    }
                };
                waitForGIS();
            });
        } catch (error) {
            console.error('❌ Error al cargar GAPI:', error);
            showNotification('❌ Error al inicializar Google API. Recarga la página.', 'error');
        }
    };

    const initAuthManager = async () => {
        try {
            console.log('⏳ [VALIDADOR] Inicializando AuthManager...');
            
            // Intentar restaurar sesión guardada primero
            const restored = await tryRestoreSession();
            if (restored) {
                console.log('✅ [VALIDADOR] Sesión restaurada desde token guardado');
                return;
            }
            
            await AuthManager.init(
                // onAuthSuccess
                async (userData) => {
                    console.log('✅ [VALIDADOR] Autenticación exitosa:', { email: userData.email, user: userData.user });

                    // CRÍTICO: Guardar token con las MISMAS claves que AuthManager
                    // Usar google_access_token (no gapi_token) para consistencia
                    const tokenObj = gapi?.client?.getToken();
                    if (tokenObj && tokenObj.access_token) {
                        localStorage.setItem('google_access_token', tokenObj.access_token);
                        const expiresIn = tokenObj.expires_in || 3600;
                        const expiryTime = Date.now() + (expiresIn * 1000);
                        localStorage.setItem('google_token_expiry', expiryTime.toString());
                        console.log('✅ [VALIDADOR] Token guardado en localStorage (google_access_token)');
                    }

                    USER_EMAIL = userData.email;
                    USER_GOOGLE_NAME = userData.name;

                    // Verificar si hay alias guardado
                    const savedAlias = localStorage.getItem(`wms_alias_${USER_EMAIL}`);
                    if (savedAlias) {
                        CURRENT_USER = savedAlias;
                        console.log('✅ [VALIDADOR] Alias recuperado:', savedAlias);
                    } else {
                        // Aplicar transformación a Title Case
                        const formatted = window.AvatarSystem?.formatNameToTitle?.(userData.user) || userData.user;
                        CURRENT_USER = formatted;
                        console.log('✅ [VALIDADOR] Usando nombre de usuario (Title Case):', formatted);
                    }

                    showMainApp();
                    updateUIAfterAuth();

                    console.log('⏳ [VALIDADOR] Cargando base de datos...');
                    await loadDatabase();

                    // Iniciar auto-refresh de BD cada 30 minutos
                    startBDAutoRefresh();

                    // Si no hay alias guardado, mostrar popup de configuración
                    if (!savedAlias) {
                        setTimeout(() => showAliasPopup(), 500);
                    }
                },
                // onAuthError
                (error) => {
                    console.error('❌ [VALIDADOR] Auth error:', error);
                    showNotification('❌ Error de autenticación', 'error');
                }
            );
            console.log('✅ [VALIDADOR] AuthManager inicializado correctamente');
        } catch (error) {
            console.error('❌ [VALIDADOR] Error crítico en initAuthManager:', error);
            showNotification('❌ Error crítico al inicializar autenticación', 'error');
        }
    };

    initAuth();
});

// ==================== TOKEN PERSISTENCE ====================
async function tryRestoreSession() {
    // NUEVO: Usar ConnectionRehydrationManager para restauración inteligente
    console.log('🔄 [VALIDADOR] Intentando restaurar sesión...');
    
    const rehydrated = await ConnectionRehydrationManager.rehydrateConnection();
    
    if (rehydrated) {
        showMainApp();
        updateUIAfterAuth();
        startBDAutoRefresh();
        showNotification(`✅ Sesión restaurada: ${CURRENT_USER}`, 'success');
        return true;
    }
    
    return false;
}

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
/**
 * Actualiza la UI después de cambios en el estado de autenticación
 */
function updateUIAfterAuth() {
    console.log('🔄 [VALIDADOR] Actualizando UI después de cambio de autenticación...');
    
    // Actualizar indicador de conexión
    updateConnectionUI();
    
    const hasToken = gapi?.client?.getToken();
    
    // Actualizar footer de usuario
    updateUserFooter();
    
    // Actualizar SidebarComponent si existe
    if (window.sidebarComponent) {
        if (hasToken) {
            window.sidebarComponent.setUserEmail(USER_EMAIL);
            window.sidebarComponent.setUserName(CURRENT_USER);
            const token = gapi.client.getToken();
            if (token?.access_token) {
                window.sidebarComponent.saveGoogleConnection(
                    token.access_token,
                    3600
                );
            }
        } else {
            // Limpiar estado de conexión en sidebar (pero mantener nombre de usuario)
            window.sidebarComponent.clearGoogleConnection();
        }
        // Actualizar botones del avatar
        window.sidebarComponent.updateAvatarButtons();
    }
    
    // CRÍTICO: Actualizar icono de conexión en avatar system
    if (window.sidebarComponent && window.sidebarComponent.updateAvatarButtons) {
        window.sidebarComponent.updateAvatarButtons();
    }
    
    // Actualizar botón de autenticación si existe (🔗 = conectado, 🔌 = desconectado)
    const authBtn = document.getElementById('sidebar-auth-btn');
    if (authBtn) {
        authBtn.textContent = hasToken ? '🔗' : '🔌';
        authBtn.title = hasToken ? 'Desconectar Google' : 'Conectar Google';
    }
    
    console.log('✅ [VALIDADOR] UI actualizada:', { hasToken: !!hasToken, user: CURRENT_USER });
}

function handleLogin() {
    try {
        console.log('🔐 [VALIDADOR] Iniciando proceso de login...');
        
        if (!window.AuthManager) {
            console.error('❌ [VALIDADOR] AuthManager no está disponible');
            showNotification('❌ Error: Sistema de autenticación no disponible', 'error');
            return;
        }
        
        // Verificar si tokenClient está listo
        if (!AuthManager.tokenClient) {
            console.warn('⚠️ [VALIDADOR] tokenClient no está listo, esperando...');
            showNotification('⏳ Inicializando autenticación...', 'info');
            
            // Esperar hasta 3 segundos para que tokenClient esté listo
            let attempts = 0;
            const maxAttempts = 30;
            const checkInterval = setInterval(() => {
                attempts++;
                if (AuthManager.tokenClient) {
                    clearInterval(checkInterval);
                    console.log('✅ [VALIDADOR] tokenClient listo, procediendo con login');
                    AuthManager.login();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    console.error('❌ [VALIDADOR] Timeout esperando tokenClient');
                    showNotification('❌ Error: Sistema de autenticación no disponible. Recarga la página.', 'error');
                }
            }, 100);
            return;
        }
        
        AuthManager.login();
    } catch (error) {
        console.error('❌ [VALIDADOR] Error en handleLogin:', error);
        showNotification('❌ Error al iniciar sesión', 'error');
    }
}

// Hacer disponible globalmente
window.handleLogin = handleLogin;
window.updateUIAfterAuth = updateUIAfterAuth;

function showMainApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    renderValidation();
    
    // Configurar listeners de ubicación
    setupValidationListeners();
    
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

// ==================== BOTÓN 1: SINCRONIZAR/ACTUALIZAR BD ====================
/**
 * Fuerza la descarga de datos desde Google Sheets
 */
async function handleSyncBD() {
    try {
        const hasToken = gapi?.client?.getToken();
        if (!hasToken) {
            showNotification('⚠️ Debes conectarte a Google primero', 'warning');
            return;
        }
        
        console.log('🔄 [VALIDADOR] Forzando sincronización de BD...');
        showNotification('🔄 Actualizando base de datos...', 'info');
        
        await loadDatabase(false); // false = no silent, muestra notificaciones
        
        showNotification('✅ Base de datos actualizada correctamente', 'success');
    } catch (error) {
        console.error('❌ [VALIDADOR] Error al sincronizar BD:', error);
        showNotification('❌ Error al actualizar base de datos', 'error');
    }
}

// ==================== BOTÓN 2: CONECTAR/DESCONECTAR GOOGLE ====================
/**
 * Gestiona exclusivamente la conexión con Google (sin cerrar sesión de la app)
 */
async function handleToggleGoogleAuth() {
    try {
        const hasToken = gapi?.client?.getToken();
        
        console.log('🔄 [VALIDADOR] handleToggleGoogleAuth - Estado actual:', { hasToken: !!hasToken });
        
        if (hasToken) {
            // DESCONECTAR - Solo revocar token de Google (mantener usuario en la app)
            if (!confirm('¿Desconectar de Google?\n\nSe revocará el acceso a Google Sheets.\nPodrás reconectar sin perder tu sesión.')) {
                return;
            }
            
            console.log('🔌 [VALIDADOR] Desconectando de Google...');
            
            // 1. Revocar token de Google
            const token = gapi.client.getToken();
            if (token?.access_token) {
                try {
                    google.accounts.oauth2.revoke(token.access_token);
                    console.log('✅ Token de Google revocado');
                } catch (e) {
                    console.warn('⚠️ No se pudo revocar token:', e);
                }
            }
            
            // 2. Limpiar token de gapi (solo en memoria, NO localStorage)
            gapi.client.setToken('');

            // IMPORTANTE: NO borrar tokens de localStorage aquí
            // Solo se borran en logout completo (handleFullLogout)
            // Esto permite reconectar sin pedir credenciales de nuevo

            // 3. Actualizar UI (mantener usuario y datos locales)
            updateUIAfterAuth();
            
            showNotification(' Desconectado de Google. Reconecta para sincronizar.', 'info');
            console.log(' [VALIDADOR] Desconexión de Google completada');
            console.log('✅ [VALIDADOR] Desconexión de Google completada');
            
        } else {
            // CONECTAR - Primero intentar restaurar token desde localStorage
            console.log('🔗 [VALIDADOR] Iniciando conexión con Google...');

            // Intentar restaurar token guardado primero (reconexión rápida)
            const savedToken = localStorage.getItem('google_access_token');
            const tokenExpiry = localStorage.getItem('google_token_expiry');

            if (savedToken && tokenExpiry) {
                const expiryTime = parseInt(tokenExpiry, 10);
                const now = Date.now();

                // Si el token aún es válido, restaurarlo directamente
                if (expiryTime > now + (60 * 1000)) { // Margen de 1 minuto
                    console.log('🔄 [VALIDADOR] Restaurando token desde localStorage...');
                    try {
                        gapi.client.setToken({ access_token: savedToken });

                        // Verificar que el token funcione
                        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                            headers: { Authorization: `Bearer ${savedToken}` }
                        });

                        if (response.ok) {
                            console.log('✅ [VALIDADOR] Token restaurado exitosamente');
                            updateUIAfterAuth();
                            showNotification('✅ Reconectado a Google', 'success');

                            // Recargar BD si es necesario
                            if (BD_CODES.size === 0) {
                                BD_LOADING = false;
                                await loadDatabaseWithRetry();
                                startBDAutoRefresh();
                            }
                            return;
                        }
                    } catch (e) {
                        console.warn('⚠️ [VALIDADOR] Token guardado inválido, solicitando nuevo...');
                    }
                }
            }

            // Si no hay token válido, solicitar nuevo
            if (!AuthManager.tokenClient) {
                console.log('🔄 [VALIDADOR] Reinicializando tokenClient...');
                showNotification('🔄 Inicializando autenticación...', 'info');

                // Reinicializar Google Identity Services
                AuthManager.waitForGIS().then(async () => {
                    console.log('✅ [VALIDADOR] tokenClient reinicializado');
                    await handleReconnectWithDataReload();
                }).catch((error) => {
                    console.error('❌ [VALIDADOR] Error reinicializando tokenClient:', error);
                    showNotification('❌ Error al inicializar autenticación. Recarga la página.', 'error');
                });
            } else {
                await handleReconnectWithDataReload();
            }
        }
    } catch (error) {
        console.error('❌ [VALIDADOR] Error en handleToggleGoogleAuth:', error);
        showNotification('❌ Error al cambiar conexión', 'error');
    }
}

// ==================== BOTÓN 3: SALIR (LOGOUT COMPLETO) ====================
/**
 * Cierre de sesión total: revoca token, limpia localStorage, borra cache IndexedDB, redirige a login
 */
async function handleFullLogout() {
    if (!confirm('¿Salir de la aplicación?\n\n⚠️ Se cerrará completamente la sesión y se limpiará toda la caché.')) {
        return;
    }
    
    try {
        console.log('🚪 [VALIDADOR] Iniciando logout completo...');
        showLoading(true);
        
        // 1. Revocar token de Google
        const token = gapi?.client?.getToken();
        if (token?.access_token) {
            try {
                await google.accounts.oauth2.revoke(token.access_token);
                console.log('✅ Token de Google revocado');
            } catch (e) {
                console.warn('⚠️ No se pudo revocar token:', e);
            }
        }
        
        // 2. Limpiar token de gapi
        if (gapi?.client) {
            gapi.client.setToken('');
        }
        
        // 3. Limpiar TODO el localStorage
        localStorage.removeItem('gapi_token');
        localStorage.removeItem('gapi_token_expiry');
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_expiry');
        localStorage.removeItem('wms_current_user');
        localStorage.removeItem('wms_user_email');
        localStorage.removeItem('wms_google_name');
        
        // 4. Detener sincronizaciones automáticas
        if (window.syncManager && typeof window.syncManager.stopAutoSync === 'function') {
            window.syncManager.stopAutoSync();
            console.log('✅ Auto-sync detenido');
        }
        
        if (typeof HistoryIndexedDBManager !== 'undefined' && HistoryIndexedDBManager.intervalId) {
            clearInterval(HistoryIndexedDBManager.intervalId);
            HistoryIndexedDBManager.intervalId = null;
        }
        
        if (typeof stopBDAutoRefresh === 'function') {
            stopBDAutoRefresh();
        }
        
        // 5. Limpiar cache de IndexedDB
        if (window.processedCacheManager && typeof window.processedCacheManager.clearCache === 'function') {
            await window.processedCacheManager.clearCache();
            console.log('✅ Cache de procesados limpiado');
        }
        
        try {
            indexedDB.deleteDatabase('ValidadorPersistenceDB');
            console.log('✅ IndexedDB eliminado');
        } catch(e) {
            console.warn('⚠️ Error eliminando IndexedDB:', e);
        }
        
        // 6. Limpiar variables globales
        BD_CODES.clear();
        OBC_MAP.clear();
        OBC_TOTALS.clear();
        OBC_INFO.clear();
        HISTORY.clear();
        PREREC_DATA.clear();
        STATE = { 
            activeOBC: null, 
            tabs: {}, 
            closedTabs: {}, 
            sessionStats: { total: 0, valid: 0, invalid: 0 }, 
            currentLocation: '', 
            pendingLocationValidation: null 
        };
        CURRENT_USER = '';
        USER_EMAIL = '';
        USER_GOOGLE_NAME = '';
        
        console.log('✅ [VALIDADOR] Logout completo - Redirigiendo a login...');
        
        // 7. Redirigir a pantalla de login
        showLoading(false);
        showLoginScreen();
        showNotification('👋 Sesión cerrada correctamente', 'success');
        
    } catch (error) {
        console.error('❌ [VALIDADOR] Error durante logout:', error);
        showLoading(false);
        showNotification('❌ Error al cerrar sesión', 'error');
    }
}

// Hacer funciones disponibles globalmente
window.handleSyncBD = handleSyncBD;
window.handleToggleGoogleAuth = handleToggleGoogleAuth;
window.handleFullLogout = handleFullLogout;

// Mantener compatibilidad con código existente
window.toggleGoogleConnection = handleToggleGoogleAuth;

/**
 * Función global para reconectar después de error de autenticación
 * CORREGIDO: Reconexión radical con reintentos automáticos
 */
function handleReconnect() {
    console.log('🔄 [VALIDADOR] Iniciando reconexión...');

    // Cerrar banner de error
    const banner = document.getElementById('auth-error-banner');
    if (banner) banner.remove();

    // CRÍTICO: Resetear BD_LOADING para permitir nueva carga
    BD_LOADING = false;

    // Limpiar token actual
    if (gapi?.client) {
        gapi.client.setToken('');
    }

    // Limpiar tokens guardados para forzar nueva autenticación
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_token_expiry');

    // Iniciar flujo de login con recarga de datos
    handleReconnectWithDataReload();
}

/**
 * CRÍTICO: Reconexión con recarga automática de BD
 * SOLUCIÓN COOP: Usa polling agresivo + detección por localStorage
 */
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let tokenPollingInterval = null;
let reconnectCallbackExecuted = false;

async function handleReconnectWithDataReload() {
    console.log('🔄 [VALIDADOR] Iniciando reconexión con recarga de BD...');
    console.log('🔄 [VALIDADOR] Versión: 3.5.0 - Solución COOP mejorada');

    // CRÍTICO: Resetear BD_LOADING para permitir nueva carga
    BD_LOADING = false;
    reconnectCallbackExecuted = false;

    // Guardar token inicial para detectar cambios
    const initialToken = localStorage.getItem('google_access_token');
    const initialExpiry = localStorage.getItem('google_token_expiry');
    console.log('📝 [VALIDADOR] Token inicial:', initialToken ? 'presente' : 'ausente');

    if (!AuthManager.tokenClient) {
        console.error('❌ [VALIDADOR] tokenClient no disponible');
        showNotification('❌ Error: Sistema de autenticación no disponible', 'error');

        // Intentar reinicializar AuthManager
        if (typeof AuthManager !== 'undefined' && typeof AuthManager.init === 'function') {
            console.log('🔄 [VALIDADOR] Intentando reinicializar AuthManager...');
            try {
                await AuthManager.init();
                if (AuthManager.tokenClient) {
                    console.log('✅ [VALIDADOR] AuthManager reinicializado');
                } else {
                    return;
                }
            } catch (e) {
                console.error('❌ [VALIDADOR] No se pudo reinicializar AuthManager:', e);
                return;
            }
        } else {
            return;
        }
    }

    try {
        showLoading(true);

        // Variable para el listener de foco (se asigna después)
        let handleWindowFocus = null;

        // Función para procesar reconexión exitosa
        const processSuccessfulReconnect = async () => {
            // Evitar ejecución duplicada
            if (reconnectCallbackExecuted) {
                console.log('⏭️ [VALIDADOR] Callback ya ejecutado, ignorando...');
                return;
            }
            reconnectCallbackExecuted = true;

            // Detener polling si está activo
            if (tokenPollingInterval) {
                clearInterval(tokenPollingInterval);
                tokenPollingInterval = null;
            }

            // Remover listener de foco si existe
            if (handleWindowFocus) {
                window.removeEventListener('focus', handleWindowFocus);
            }

        // Reset contador de intentos
        reconnectAttempts = 0;
        console.log('✅ [VALIDADOR] Reconexión exitosa');

        // Verificar y establecer token en gapi si es necesario
        const currentToken = localStorage.getItem('google_access_token');
        if (currentToken && !gapi?.client?.getToken()?.access_token) {
            console.log('🔧 [VALIDADOR] Estableciendo token en gapi desde localStorage...');
            gapi.client.setToken({ access_token: currentToken });
        }

        // Actualizar UI
        updateUIAfterAuth();

        // Cerrar banner de error si existe
        const banner = document.getElementById('auth-error-banner');
        if (banner) banner.remove();

        // CRÍTICO: SIEMPRE recargar BD después de reconexión
        console.log('🔍 [VALIDADOR] Forzando recarga de BD después de reconexión...');
        console.log('  - BD_CODES.size (antes):', BD_CODES.size);
        console.log('  - OBC_TOTALS.size (antes):', OBC_TOTALS.size);

        // CRÍTICO: Resetear BD_LOADING antes de cargar
        BD_LOADING = false;

        try {
            // Forzar recarga completa de BD
            await loadDatabaseWithRetry();

            // Iniciar auto-refresh de BD
            startBDAutoRefresh();

            console.log('✅ [VALIDADOR] BD recargada exitosamente');
            console.log('  - BD_CODES.size (después):', BD_CODES.size);
            console.log('  - OBC_TOTALS.size (después):', OBC_TOTALS.size);

            showLoading(false);
            showNotification('✅ Reconectado y BD actualizada', 'success');
        } catch (dbError) {
            console.error('❌ [VALIDADOR] Error recargando BD:', dbError);
            showLoading(false);
            showNotification('⚠️ Reconectado pero error al cargar BD. Intenta recargar BD manualmente.', 'warning');
        }
    };

        // Configurar callback para manejar la respuesta de autenticación
        AuthManager.tokenClient.callback = async (resp) => {
            console.log('📥 [VALIDADOR] Callback recibido:', resp?.error || 'success');

            if (resp.error) {
                console.error('❌ [VALIDADOR] Error en reconexión:', resp);
                reconnectAttempts++;

                // Detener polling
                if (tokenPollingInterval) {
                    clearInterval(tokenPollingInterval);
                    tokenPollingInterval = null;
                }

                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    const delay = Math.pow(2, reconnectAttempts) * 1000;
                    console.log(`🔄 [VALIDADOR] Reintentando reconexión en ${delay}ms (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    showNotification(`⏳ Reintentando conexión... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`, 'warning');

                    setTimeout(() => {
                        reconnectCallbackExecuted = false;
                        AuthManager.tokenClient.requestAccessToken({ prompt: 'consent' });
                    }, delay);
                } else {
                    showNotification('❌ No se pudo reconectar. Recarga la página.', 'error');
                    showLoading(false);
                    reconnectAttempts = 0;
                }
                return;
            }

            // Procesar éxito
            await processSuccessfulReconnect();
        };

        // NUEVO: Iniciar polling de token como respaldo para COOP
        // Esto detecta cuando el token se actualiza aunque el callback no se dispare
        const startTokenPolling = () => {
            let pollCount = 0;
            const maxPolls = 120; // 2 minutos máximo (120 * 1000ms)

            console.log('🔍 [VALIDADOR] Iniciando polling de token como respaldo COOP...');
            console.log('  - Token inicial:', initialToken ? 'presente' : 'ausente');

            tokenPollingInterval = setInterval(async () => {
                pollCount++;

                // Verificar si ya se procesó por callback
                if (reconnectCallbackExecuted) {
                    clearInterval(tokenPollingInterval);
                    tokenPollingInterval = null;
                    return;
                }

                // Verificar si hay token válido en gapi
                const tokenObj = gapi?.client?.getToken();
                if (tokenObj && tokenObj.access_token) {
                    console.log('✅ [VALIDADOR] Token detectado en gapi por polling, procesando...');
                    clearInterval(tokenPollingInterval);
                    tokenPollingInterval = null;
                    await processSuccessfulReconnect();
                    return;
                }

                // NUEVO: También verificar cambios en localStorage
                // AuthManager.login() guarda el token aquí cuando tiene éxito
                const currentToken = localStorage.getItem('google_access_token');
                const currentExpiry = localStorage.getItem('google_token_expiry');

                // Si el token cambió o es nuevo, y es válido
                if (currentToken && currentExpiry) {
                    const expiryTime = parseInt(currentExpiry);
                    const isNewToken = currentToken !== initialToken || currentExpiry !== initialExpiry;
                    const isValidToken = expiryTime > Date.now();

                    if (isNewToken && isValidToken) {
                        console.log('✅ [VALIDADOR] Nuevo token detectado en localStorage por polling');
                        console.log('  - Token expiración:', new Date(expiryTime).toLocaleTimeString());

                        // Establecer token en gapi si no está
                        if (!gapi?.client?.getToken()?.access_token) {
                            gapi.client.setToken({ access_token: currentToken });
                            console.log('✅ [VALIDADOR] Token establecido en gapi desde localStorage');
                        }

                        clearInterval(tokenPollingInterval);
                        tokenPollingInterval = null;
                        await processSuccessfulReconnect();
                        return;
                    }
                }

                // Log cada 10 segundos para debug
                if (pollCount % 10 === 0) {
                    console.log(`🔍 [VALIDADOR] Polling token... (${pollCount}s)`);
                }

                // Timeout después de 2 minutos
                if (pollCount >= maxPolls) {
                    console.warn('⚠️ [VALIDADOR] Timeout en polling de token');
                    clearInterval(tokenPollingInterval);
                    tokenPollingInterval = null;

                    if (!reconnectCallbackExecuted) {
                        showLoading(false);
                        showNotification('⚠️ Autenticación pendiente. Si ya iniciaste sesión, recarga la página.', 'warning');
                    }
                }
            }, 1000);
        };

        // Iniciar polling antes de solicitar token
        startTokenPolling();

        // NUEVO: Listener de foco para detectar cuando el usuario regresa del popup
        handleWindowFocus = async () => {
            console.log('👁️ [VALIDADOR] Ventana en foco, verificando token...');

            // Esperar un poco para que el token se propague
            await new Promise(resolve => setTimeout(resolve, 500));

            if (reconnectCallbackExecuted) {
                window.removeEventListener('focus', handleWindowFocus);
                return;
            }

            // Verificar token en gapi
            const tokenObj = gapi?.client?.getToken();
            if (tokenObj && tokenObj.access_token) {
                console.log('✅ [VALIDADOR] Token detectado en foco de ventana');
                window.removeEventListener('focus', handleWindowFocus);

                if (tokenPollingInterval) {
                    clearInterval(tokenPollingInterval);
                    tokenPollingInterval = null;
                }

                await processSuccessfulReconnect();
                return;
            }

            // También verificar localStorage
            const currentToken = localStorage.getItem('google_access_token');
            const currentExpiry = localStorage.getItem('google_token_expiry');

            if (currentToken && currentExpiry) {
                const expiryTime = parseInt(currentExpiry);
                const isNewToken = currentToken !== initialToken;
                const isValidToken = expiryTime > Date.now();

                if (isNewToken && isValidToken) {
                    console.log('✅ [VALIDADOR] Nuevo token en localStorage detectado en foco');
                    gapi.client.setToken({ access_token: currentToken });
                    window.removeEventListener('focus', handleWindowFocus);

                    if (tokenPollingInterval) {
                        clearInterval(tokenPollingInterval);
                        tokenPollingInterval = null;
                    }

                    await processSuccessfulReconnect();
                }
            }
        };

        window.addEventListener('focus', handleWindowFocus);

        // Limpiar listener después de 3 minutos por seguridad
        setTimeout(() => {
            window.removeEventListener('focus', handleWindowFocus);
        }, 180000);

        // Solicitar acceso - siempre usar consent para forzar nueva autenticación
        console.log('📤 [VALIDADOR] Solicitando access token...');
        AuthManager.tokenClient.requestAccessToken({ prompt: 'consent' });

    } catch (error) {
        console.error('❌ [VALIDADOR] Error en reconexión:', error);
        showNotification('❌ Error al reconectar', 'error');
        showLoading(false);

        if (tokenPollingInterval) {
            clearInterval(tokenPollingInterval);
            tokenPollingInterval = null;
        }
    }
}

/**
 * Carga la BD con reintentos automáticos
 * NUEVO: Sistema robusto para garantizar carga de BD
 */
async function loadDatabaseWithRetry(maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📊 [VALIDADOR] Intento ${attempt}/${maxRetries} de carga de BD...`);

            // CRÍTICO: Asegurar que BD_LOADING esté en false
            BD_LOADING = false;

            await loadDatabase(false); // false = mostrar mensajes

            // Verificar que la BD se cargó correctamente
            if (BD_CODES.size > 0 && OBC_TOTALS.size > 0) {
                console.log(`✅ [VALIDADOR] BD cargada en intento ${attempt}`);
                return true;
            }

            // Si llegamos aquí, la BD se cargó pero está vacía
            console.warn(`⚠️ [VALIDADOR] BD vacía después de carga (intento ${attempt})`);
            lastError = new Error('BD cargada pero vacía');

        } catch (error) {
            console.error(`❌ [VALIDADOR] Error en intento ${attempt}:`, error);
            lastError = error;

            // Resetear flag para siguiente intento
            BD_LOADING = false;
        }

        // Esperar antes de reintentar (backoff exponencial)
        if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`⏳ [VALIDADOR] Esperando ${delay}ms antes de reintentar...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error('No se pudo cargar la BD después de múltiples intentos');
}

window.handleReconnect = handleReconnect;
window.handleReconnectWithDataReload = handleReconnectWithDataReload;

async function handleLogoutAndClearCache() {
    const confirmLogout = confirm('¿Salir de la aplicación?\n\n⚠️ Se cerrará la sesión de Google y se limpiará toda la caché del navegador.');
    if (!confirmLogout) return;

    try {
        showLoading(true);
        
        // 1. Revocar token de Google
        const token = gapi?.client?.getToken();
        if (token !== null && token?.access_token) {
            try {
                google.accounts.oauth2.revoke(token.access_token);
                console.log('✅ Token de Google revocado');
            } catch (e) {
                console.warn('⚠️ No se pudo revocar token:', e);
            }
            gapi.client.setToken('');
        }

        // 2. Limpiar tokens guardados (ambas versiones por compatibilidad)
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_expiry');
        localStorage.removeItem('gapi_token');
        localStorage.removeItem('gapi_token_expiry');

        // 3. Detener sincronización y CERRAR CONEXIONES DB
        if (window.syncManager) {
            if (typeof window.syncManager.stopAutoSync === 'function') {
                window.syncManager.stopAutoSync();
            }
            // CRÍTICO: Cerrar conexión a IndexedDB antes de intentar borrarla
            // Si no se cierra, el deleteDatabase se bloqueará indefinidamente
            if (window.syncManager.persistenceManager && typeof window.syncManager.persistenceManager.close === 'function') {
                window.syncManager.persistenceManager.close();
            }
            console.log('✅ Sincronización detenida y conexiones cerradas');
        }

        // 4. Detener sincronización automática del historial
        if (typeof HistoryIndexedDBManager !== 'undefined' && HistoryIndexedDBManager.intervalId) {
            clearInterval(HistoryIndexedDBManager.intervalId);
            HistoryIndexedDBManager.intervalId = null;
            console.log('✅ Sincronización de historial detenida');
        }

        // 5. Detener auto-refresh de BD
        if (typeof stopBDAutoRefresh === 'function') {
            stopBDAutoRefresh();
            console.log('✅ Auto-refresh de BD detenido');
        }

        // 6. Limpiar caché procesado
        if (window.processedCacheManager && typeof window.processedCacheManager.clearCache === 'function') {
            await window.processedCacheManager.clearCache();
            console.log('✅ Caché procesado limpiado');
        }

        // 7. Limpiar IndexedDB
        try {
            const dbName = 'ValidadorPersistenceDB';
            const deleteRequest = indexedDB.deleteDatabase(dbName);
            deleteRequest.onsuccess = () => console.log('✅ IndexedDB eliminada');
            deleteRequest.onerror = (e) => console.warn('⚠️ Error eliminando IndexedDB:', e);
        } catch (e) {
            console.warn('⚠️ Error al intentar eliminar IndexedDB:', e);
        }

        // Limpiar datos locales
        BD_CODES.clear();
        OBC_MAP.clear();
        OBC_TOTALS.clear();
        OBC_INFO.clear();
        HISTORY.clear();
        PREREC_DATA.clear();
        STATE = {
            activeOBC: null,
            tabs: {},
            closedTabs: {},
            sessionStats: { total: 0, valid: 0, invalid: 0 },
            currentLocation: '',
            pendingLocationValidation: null
        };

        // AuthManager ya no es necesario, el logout se hace arriba

        // Limpiar localStorage de la app (excepto alias)
        const alias = localStorage.getItem(`wms_alias_${USER_EMAIL}`);
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('validador_') && !key.includes('alias')) {
                localStorage.removeItem(key);
            }
        });
        if (alias && USER_EMAIL) {
            localStorage.setItem(`wms_alias_${USER_EMAIL}`, alias);
        }

        // 6. Limpiar TODA la caché del navegador (localStorage completo)
        console.log('🧹 Limpiando caché completa del navegador...');
        const keysToPreserve = [];
        if (alias && USER_EMAIL) {
            keysToPreserve.push(`wms_alias_${USER_EMAIL}`);
        }
        
        // Guardar claves a preservar
        const preserved = {};
        keysToPreserve.forEach(key => {
            const value = localStorage.getItem(key);
            if (value) preserved[key] = value;
        });
        
        // Limpiar TODO el localStorage
        localStorage.clear();
        
        // Restaurar solo las claves preservadas
        Object.keys(preserved).forEach(key => {
            localStorage.setItem(key, preserved[key]);
        });
        
        // 7. Limpiar IndexedDB si existe
        if (window.indexedDB) {
            try {
                const dbs = await window.indexedDB.databases();
                for (const db of dbs) {
                    if (db.name && (db.name.includes('validador') || db.name.includes('wms'))) {
                        window.indexedDB.deleteDatabase(db.name);
                        console.log(`🗑️ IndexedDB eliminada: ${db.name}`);
                    }
                }
            } catch (e) {
                console.warn('⚠️ No se pudo limpiar IndexedDB:', e);
            }
        }
        
        // 8. Limpiar sessionStorage
        sessionStorage.clear();
        console.log('✅ SessionStorage limpiado');

        // 9. Limpiar sistema de deduplicación
        ValidationDeduplicationManager.clearSyncedValidations();
        console.log('✅ Sistema de deduplicación limpiado');

        // Reiniciar variables
        CURRENT_USER = '';
        USER_EMAIL = '';
        USER_GOOGLE_NAME = '';
        LAST_BD_UPDATE = null;

        showLoading(false);
        showLoginScreen();
        showNotification('✅ Sesión cerrada y caché del navegador limpiada completamente', 'success');
        
        console.log('✅ [LOGOUT] Proceso de salida completado exitosamente');
    } catch (error) {
        console.error('❌ [LOGOUT] Error durante el proceso de salida:', error);
        showLoading(false);
        showNotification('⚠️ Error al cerrar sesión, intenta de nuevo', 'warning');
    }
}

// Mantener handleLogout() para compatibilidad con código existente
async function handleLogout() {
    await handleLogoutAndClearCache();
}

// Hacer disponible globalmente
window.handleLogout = handleLogout;

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
            CURRENT_USER = window.AvatarSystem?.formatNameToTitle?.(savedAlias) || savedAlias;
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

    // Aplicar Title Case al alias antes de guardarlo
    const formattedAlias = window.AvatarSystem?.formatNameToTitle?.(finalAlias) || finalAlias;
    CURRENT_USER = formattedAlias;
    localStorage.setItem(`wms_alias_${USER_EMAIL}`, formattedAlias);

    document.querySelectorAll('.alias-popup-overlay').forEach(e => e.remove());
    showNotification(`✅ ${isGoogleName ? 'Nombre' : 'Alias'} guardado: ${finalAlias}`, 'success');
    updateUserFooter();
}

function changeUserAlias() {
    showAliasPopup();
}

function updateUserFooter() {
    // Usar SidebarComponent compartido
    if (window.sidebarComponent) {
        console.log('✅ [VALIDADOR] Actualizando SidebarComponent');
        
        if (CURRENT_USER) {
            window.sidebarComponent.setUserName(CURRENT_USER);
        }
        if (USER_EMAIL) {
            window.sidebarComponent.setUserEmail(USER_EMAIL);
        }
        
        window.sidebarComponent.updateAvatarDisplay();
    } else {
        console.warn('⚠️ [VALIDADOR] SidebarComponent no disponible aún');
    }

    // Actualizar botón de auth con iconos correctos (🔗 = conectado, 🔌 = desconectado)
    const authBtn = document.getElementById('sidebar-auth-btn');
    const hasToken = gapi?.client?.getToken();
    if (authBtn) {
        authBtn.textContent = hasToken ? '🔗' : '🔌';
        authBtn.title = hasToken ? 'Desconectar Google' : 'Conectar Google';
    }

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

// Alias para compatibilidad
function updateConnectionUI(syncing = false) {
    updateConnectionIndicator(syncing);
}

window.updateConnectionUI = updateConnectionUI;

// ==================== PROGRESSIVE LOADING SYSTEM ====================
let PROGRESSIVE_LOAD_STATE = {
    isLoading: false,
    totalRows: 0,
    loadedRows: 0,
    loadedOrders: 0,
    phase: 'idle' // idle, loading, complete
};

/**
 * Actualiza el preloader con el progreso de carga
 */
function updateLoadingProgress(phase, progress = 0, message = '') {
    const overlay = document.getElementById('loading-overlay');
    const textEl = overlay?.querySelector('.preloader-text');
    const subtextEl = overlay?.querySelector('.preloader-subtext');
    
    if (!overlay) return;
    
    if (phase === 'complete') {
        overlay.style.display = 'none';
        return;
    }
    
    overlay.style.display = 'flex';
    
    if (textEl) {
        textEl.textContent = message || '🎯 Cargando Validador...';
    }
    
    if (subtextEl) {
        if (progress > 0) {
            subtextEl.textContent = `Progreso: ${Math.round(progress)}%`;
        } else {
            subtextEl.textContent = 'Preparando datos...';
        }
    }
}

// ==================== BASE DE DATOS ====================
async function loadDatabase(silent = false) {
    if (!gapi?.client?.sheets) {
        if (!silent) {
            console.warn('⚠️ [VALIDADOR] Google Sheets API no disponible aún');
        }
        return;
    }

    const token = gapi.client.getToken();
    if (!token) {
        showNotification('⚠️ Inicia sesión primero', 'warning');
        return;
    }
    
    // Evitar cargas concurrentes
    if (BD_LOADING) {
        console.log('⏳ [VALIDADOR] BD ya está cargando, esperando...');
        if (!silent) {
            showNotification('⏳ Base de datos cargando...', 'info');
        }
        return;
    }
    
    PROGRESSIVE_LOAD_STATE.isLoading = true;
    PROGRESSIVE_LOAD_STATE.phase = 'loading';
    
    try {
        BD_LOADING = true;
        if (!silent) {
            showLoading(true);
            updateLoadingProgress('loading', 0, '🎯 Cargando Base de Datos...');
        }

        console.groupCollapsed('🔄 [VALIDADOR] Cargando Base de Datos...');
        console.log('🧹 Limpiando cache...');
        OBC_INFO.clear();
        OBC_TOTALS.clear();
        OBC_MAP.clear();
        BD_CODES.clear();

        // Cargar datos desde la hoja BD
        // Estructura de columnas:
        // A: Outbound (Número de Orden/OBC)
        // B: Reference order No.
        // C: Shipping service
        // D: Tracking code
        // E: Expected Arrival Time
        // F: Remark
        // G: Recipient (Destino)
        // H: (vacío)
        // I: Custom box barcode (Código de Caja)
        const bdRes = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_BD,
            range: 'BD!A:I'
        });

        if (!bdRes.result.values || bdRes.result.values.length <= 1) {
            console.groupEnd();
            throw new Error('No hay datos en la hoja BD');
        }

        const rows = bdRes.result.values;
        const totalRows = rows.length - 1;
        console.log(`📊 Total de filas en BD: ${totalRows.toLocaleString()}`);

        // Mapa temporal para agrupar por orden
        const orderGroups = new Map();

        // OPTIMIZACIÓN: Procesamiento por bloques para evitar congelamiento con 225k+ filas
        const CHUNK_SIZE = 5000; // Procesar 5000 filas por bloque
        const totalChunks = Math.ceil(totalRows / CHUNK_SIZE);
        
        console.log(`⚙️ Procesando en ${totalChunks} bloques de ${CHUNK_SIZE} filas...`);
        
        PROGRESSIVE_LOAD_STATE.totalRows = totalRows;

        // Procesar todas las filas en bloques (saltar header en índice 0)
        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
            const startIdx = 1 + (chunkIndex * CHUNK_SIZE);
            const endIdx = Math.min(startIdx + CHUNK_SIZE, rows.length);
            
            // Actualizar progreso
            if (!silent) {
                const progress = ((chunkIndex + 1) / totalChunks) * 100;
                updateLoadingProgress('loading', progress, `🎯 Procesando datos (${chunkIndex + 1}/${totalChunks})`);
            }
            
            // Procesar bloque actual
            for (let i = startIdx; i < endIdx; i++) {
                const row = rows[i];
                
                // Extraer datos de las columnas
                const outbound = (row[0] || '').toString().trim().toUpperCase();
                const referenceNo = (row[1] || '').toString().trim();
                const shippingService = (row[2] || '').toString().trim();
                const trackingCode = (row[3] || '').toString().trim();
                const arrivalTime = (row[4] || '').toString().trim();
                const remark = (row[5] || '').toString().trim();
                const recipient = (row[6] || '').toString().trim(); // Columna G = Recipient
                const boxCode = (row[8] || '').toString().trim().toUpperCase();

                // Validar que tengamos al menos orden y código de caja
                if (!outbound || !boxCode) {
                    continue;
                }

                // Crear clave única: Orden + Código de Caja
                const concatenated = boxCode + outbound.toLowerCase();
                BD_CODES.add(concatenated);

                // Agregar a mapa de orden
                if (!OBC_MAP.has(outbound)) {
                    OBC_MAP.set(outbound, new Set());
                }
                OBC_MAP.get(outbound).add(concatenated);

                // Agrupar por orden para contar totales
                if (!orderGroups.has(outbound)) {
                    orderGroups.set(outbound, {
                        boxes: new Set(),
                        firstRow: {
                            referenceNo,
                            shippingService,
                            trackingCode,
                            arrivalTime,
                            remark,
                            recipient
                        }
                    });
                }
                
                // Agregar código de caja al set (evita duplicados automáticamente)
                orderGroups.get(outbound).boxes.add(boxCode);
            }
            
            // Permitir que el navegador respire entre bloques
            if (chunkIndex < totalChunks - 1) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Calcular totales y extraer metadata de cada orden
        for (const [outbound, data] of orderGroups) {
            const totalBoxes = data.boxes.size;
            
            OBC_TOTALS.set(outbound, totalBoxes);
            OBC_INFO.set(outbound, {
                recipient: data.firstRow.recipient || '-',
                arrivalTime: data.firstRow.arrivalTime || '-',
                referenceNo: data.firstRow.referenceNo || '-',
                shippingService: data.firstRow.shippingService || '-',
                trackingCode: data.firstRow.trackingCode || '-',
                remark: data.firstRow.remark || ''
            });
        }

        console.log(`✅ Procesadas ${orderGroups.size.toLocaleString()} órdenes con ${BD_CODES.size.toLocaleString()} códigos únicos`);
        
        // Guardar OBC_TOTALS en localStorage para persistencia
        const totalsData = {};
        for (const [obc, total] of OBC_TOTALS.entries()) {
            totalsData[obc] = total;
        }
        await window.storage.set('wms_validador_totals', JSON.stringify(totalsData));
        console.log('✅ Totales guardados en localStorage');
        
        console.groupEnd();

        // Cargar historial desde la hoja de validaciones
        console.groupCollapsed('📋 [VALIDADOR] Cargando Historial de Validaciones...');
        try {
            // Leer columnas A-G: Fecha, Hora, Usuario, OBC, Código, Ubicación, Nota
            const histRes = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_WRITE,
                range: 'Val3!A:G'
            });
            if (histRes.result.values?.length > 1) {
                HISTORY.clear();
                const histRows = histRes.result.values;
                const totalHistRows = histRows.length - 1;
                console.log(`📊 Total de registros en historial: ${totalHistRows.toLocaleString()}`);
                
                // OPTIMIZACIÓN: Procesamiento por bloques para historial grande
                const HIST_CHUNK_SIZE = 5000;
                const histChunks = Math.ceil(totalHistRows / HIST_CHUNK_SIZE);
                console.log(`⚙️ Procesando historial en ${histChunks} bloques...`);
                
                // Estructura: A(0)=Fecha, B(1)=Hora, C(2)=Usuario, D(3)=OBC, E(4)=Código, F(5)=Ubicación, G(6)=Nota
                for (let chunkIdx = 0; chunkIdx < histChunks; chunkIdx++) {
                    const startIdx = 1 + (chunkIdx * HIST_CHUNK_SIZE);
                    const endIdx = Math.min(startIdx + HIST_CHUNK_SIZE, histRows.length);
                    
                    for (let i = startIdx; i < endIdx; i++) {
                        const row = histRows[i];
                        const code = (row[4] || '').toUpperCase(); // Columna E = Código
                        const obc = (row[3] || '').toUpperCase();
                        if (code && obc) {
                            const key = code + obc.toLowerCase();
                            HISTORY.set(key, {
                                date: row[0],
                                timestamp: row[1],
                                user: row[2],
                                obc: obc,
                                code: code,
                                location: row[5] || '', // Columna F = Ubicación
                                note: row[6] || '' // Columna G = Nota
                            });
                        }
                    }
                    
                    // Permitir que el navegador respire entre bloques
                    if (chunkIdx < histChunks - 1) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                }
                
                console.log(`✅ Historial cargado: ${HISTORY.size.toLocaleString()} registros únicos`);
            }
        } catch (e) {
            console.warn('⚠️ No se pudo cargar historial:', e.message);
        }
        console.groupEnd();

        LAST_BD_UPDATE = Date.now();
        await saveBD();
        updateBdInfo();
        
        BD_LOADING = false; // Resetear bandera de carga
        BD_DATA_READY = true; // Marcar datos como listos
        PROGRESSIVE_LOAD_STATE.isLoading = false;
        PROGRESSIVE_LOAD_STATE.phase = 'complete';
        PROGRESSIVE_LOAD_STATE.loadedRows = totalRows;
        PROGRESSIVE_LOAD_STATE.loadedOrders = orderGroups.size;
        
        if (!silent) {
            updateLoadingProgress('complete');
            showLoading(false);
            showNotification(`✅ ${BD_CODES.size} códigos cargados de ${orderGroups.size} órdenes`, 'success');
        } else {
            console.log(`🔄 [VALIDADOR] BD actualizada silenciosamente: ${BD_CODES.size} códigos`);
        }
    } catch (error) {
        BD_LOADING = false; // Resetear bandera incluso en error
        PROGRESSIVE_LOAD_STATE.isLoading = false;
        PROGRESSIVE_LOAD_STATE.phase = 'idle';
        console.error('❌ [VALIDADOR] Error loading database:', error);
        
        // Detectar errores de autenticación (401/400/403)
        const errorCode = error.status || error.result?.error?.code;
        const isAuthError = errorCode === 401 || errorCode === 400 || errorCode === 403;

        if (isAuthError) {
            console.error('🔐 [AUTH-ERROR] Error de autenticación al cargar BD, código:', errorCode);

            // Limpiar tokens inválidos
            localStorage.removeItem('google_access_token');
            localStorage.removeItem('google_token_expiry');
            gapi.client.setToken('');

            showNotification('🔐 Sesión expirada. Reconecta para continuar.', 'error');

            // Mostrar banner de reconexión
            if (typeof showAuthErrorBanner === 'function') {
                showAuthErrorBanner();
            } else {
                // Crear banner manualmente
                createAuthErrorBanner();
            }
        } else {
            showNotification('❌ Error cargando base de datos', 'error');
        }
        
        updateBdInfo('Error');
        
        if (!silent) showLoading(false);
    }
}

/**
 * Crea un banner de error de autenticación
 */
function createAuthErrorBanner() {
    // Evitar duplicados
    const existing = document.getElementById('auth-error-banner');
    if (existing) return;
    
    const banner = document.createElement('div');
    banner.id = 'auth-error-banner';
    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #e74c3c, #c0392b);
        color: white;
        padding: 15px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 10000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        animation: slideDown 0.3s ease-out;
    `;
    
    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
            <span style="font-size: 24px;">🔐</span>
            <div>
                <div style="font-weight: 700; font-size: 1.1em;">Sesión expirada o error de conexión</div>
                <div style="font-size: 0.9em; opacity: 0.9;">Tu sesión ha caducado. Reconecta para continuar.</div>
            </div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button onclick="window.handleReconnect()" style="
                background: white;
                color: #e74c3c;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                font-weight: 700;
                cursor: pointer;
                font-size: 1em;
                transition: transform 0.2s;
            ">
                🔄 Reconectar
            </button>
            <button onclick="document.getElementById('auth-error-banner').remove()" style="
                background: rgba(255,255,255,0.2);
                color: white;
                border: none;
                padding: 10px 15px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 1em;
            ">
                ✕
            </button>
        </div>
    `;
    
    document.body.prepend(banner);
    
    // Agregar animación si no existe
    if (!document.getElementById('auth-error-animation')) {
        const style = document.createElement('style');
        style.id = 'auth-error-animation';
        style.textContent = `
            @keyframes slideDown {
                from { transform: translateY(-100%); }
                to { transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }
}

window.createAuthErrorBanner = createAuthErrorBanner;
window.showAuthErrorBanner = createAuthErrorBanner;

// NOTA: window.handleReconnect ya está definido en línea 1713
// Usar ConnectionRehydrationManager.manualReconnect directamente desde el banner

// ==================== AUTO-REFRESH SYSTEM ====================
let BD_AUTO_REFRESH_INTERVAL = null;
const BD_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos

function startBDAutoRefresh() {
    // Limpiar intervalo previo si existe
    if (BD_AUTO_REFRESH_INTERVAL) {
        clearInterval(BD_AUTO_REFRESH_INTERVAL);
    }

    // Configurar nuevo intervalo de 30 minutos
    BD_AUTO_REFRESH_INTERVAL = setInterval(async () => {
        if (IS_ONLINE && gapi?.client?.getToken()) {
            console.log('🔄 [VALIDADOR] Iniciando actualización silenciosa de BD (cada 30 min)...');
            await loadDatabase(true); // true = silent mode
        } else {
            console.log('⚠️ [VALIDADOR] Auto-refresh omitido: sin conexión o sin token');
        }
    }, BD_REFRESH_INTERVAL_MS);

    console.log('✅ [VALIDADOR] Auto-refresh de BD iniciado (cada 30 minutos)');
}

function stopBDAutoRefresh() {
    if (BD_AUTO_REFRESH_INTERVAL) {
        clearInterval(BD_AUTO_REFRESH_INTERVAL);
        BD_AUTO_REFRESH_INTERVAL = null;
        console.log('🛑 [VALIDADOR] Auto-refresh de BD detenido');
    }
}

// Hacer disponibles globalmente
window.startBDAutoRefresh = startBDAutoRefresh;
window.stopBDAutoRefresh = stopBDAutoRefresh;

function startValidation() {
    // CORREGIDO: Referencias a dashboard/validation-screen eliminadas
    // El diseño actual usa empty-state y validation-content

    renderValidation();

    setTimeout(() => {
        const scanner = document.getElementById('scanner');
        if (scanner) scanner.focus();
    }, 100);

    setupValidationListeners();
}

function setupValidationListeners() {
    // FUNCIÓN OBSOLETA: validation-input no existe en el HTML
    // El scanner real es manejado por setupListeners()
    // Solo mantenemos el location-input validation

    const locationInput = document.getElementById('location-input');
    if (!locationInput) {
        console.warn('⚠️ [VALIDADOR] location-input no encontrado');
        return;
    }
    
    // Verificar si ya tiene listeners configurados
    if (locationInput.dataset.listenersConfigured === 'true') {
        console.log('ℹ️ [VALIDADOR] Location input listeners ya configurados');
        return;
    }
    
    // Marcar como configurado
    locationInput.dataset.listenersConfigured = 'true';

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
    
    console.log('✅ [VALIDADOR] Location input listeners configurados');
}

// Flag para prevenir validaciones duplicadas
let isValidatingLocation = false;

function validateLocationInput(location) {
    if (!location || location.trim() === '') {
        return; // No validar ubicaciones vacías
    }
    
    // Prevenir validaciones duplicadas
    if (isValidatingLocation) {
        console.log('⚠️ [VALIDADOR] Validación de ubicación ya en progreso, ignorando');
        return;
    }
    
    isValidatingLocation = true;
    
    // Usar el módulo compartido LocationValidatorUI
    LocationValidatorUI.validate(
        location,
        (normalizedLocation) => {
            isValidatingLocation = false; // Resetear flag
            
            const locationInput = document.getElementById('location-input');
            if (locationInput) {
                locationInput.value = normalizedLocation;
                STATE.currentLocation = normalizedLocation;
                
                // Actualizar ubicación en el tab activo
                if (STATE.activeOBC && STATE.tabs[STATE.activeOBC]) {
                    STATE.tabs[STATE.activeOBC].location = normalizedLocation;
                    saveState();
                }
            }
            showNotification(`✅ Ubicación válida: ${normalizedLocation}`, 'success');
            
            // Mover focus al scanner después de validación exitosa
            const scanner = document.getElementById('scanner');
            if (scanner) {
                scanner.focus();
            }
        },
        (forcedLocation) => {
            isValidatingLocation = false; // Resetear flag
            
            console.log('🔧 [VALIDADOR] Ubicación forzada:', forcedLocation);
            
            const locationInput = document.getElementById('location-input');
            if (locationInput) {
                locationInput.value = forcedLocation;
                STATE.currentLocation = forcedLocation;
                
                // Actualizar ubicación en el tab activo
                if (STATE.activeOBC && STATE.tabs[STATE.activeOBC]) {
                    STATE.tabs[STATE.activeOBC].location = forcedLocation;
                    saveState();
                }
            }
            
            showNotification(`⚠️ Ubicación insertada forzadamente: ${forcedLocation}`, 'warning');
            
            // Mover focus al scanner después de inserción forzada
            setTimeout(() => {
                const scanner = document.getElementById('scanner');
                if (scanner) {
                    scanner.focus();
                }
            }, 100);
            
            console.log('✅ [VALIDADOR] Callback de ubicación forzada completado');
        },
        () => {
            // Callback onClose: resetear flag cuando se cierra sin acción
            isValidatingLocation = false;
            console.log('ℹ️ [VALIDADOR] Popup de ubicación cerrado sin acción');
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

// ==================== CONNECTION MONITOR ====================
function setupConnectionMonitor() {
    // Monitorear cambios de conexión
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Verificar estado inicial
    IS_ONLINE = navigator.onLine;
    updateConnectionUI();
    
    console.log('✅ [VALIDADOR] Monitor de conexión configurado');
}

function handleOnline() {
    console.log('🌐 [VALIDADOR] Conexión restaurada');
    IS_ONLINE = true;
    
    // Mostrar banner de conexión restaurada
    showConnectionBanner('online');
    
    // Actualizar UI
    updateConnectionUI();
    
    // Verificar si hay token de Google
    const hasToken = gapi?.client?.getToken();
    
    if (hasToken) {
        showNotification('✅ Conexión restaurada - Sincronizando datos...', 'success');
        
        // Intentar sincronizar datos pendientes
        setTimeout(() => {
            try {
                if (window.syncManager && typeof window.syncManager.sync === 'function') {
                    window.syncManager.sync(false);
                }
            } catch (error) {
                console.error('Error al sincronizar:', error);
            }
        }, 1000);
    } else {
        // Mostrar pantalla de reconexión solo si el usuario estaba autenticado
        if (CURRENT_USER && USER_EMAIL) {
            showReconnectionScreen();
        }
    }
}

function handleOffline() {
    console.log('⚠️ [VALIDADOR] Conexión perdida');
    IS_ONLINE = false;
    
    // Mostrar banner de sin conexión
    showConnectionBanner('offline');
    
    // Actualizar UI
    updateConnectionUI();
    
    showNotification('⚠️ Sin conexión - Los datos se guardarán localmente', 'warning');
}

function showReconnectionScreen() {
    // Verificar si ya hay una pantalla de reconexión activa
    if (document.getElementById('reconnection-overlay')) {
        return;
    }
    
    const overlay = document.createElement('div');
    overlay.id = 'reconnection-overlay';
    overlay.className = 'reconnection-overlay';
    overlay.innerHTML = `
        <div class="reconnection-modal">
            <div class="reconnection-icon">🔌</div>
            <h2 class="reconnection-title">Conexión con Google Perdida</h2>
            <p class="reconnection-message">
                Tu sesión de Google se ha desconectado.<br>
                Reconecta para sincronizar tus validaciones.
            </p>
            <div class="reconnection-info">
                <div class="reconnection-info-item">
                    <span class="reconnection-info-icon">💾</span>
                    <span>Tus datos están guardados localmente</span>
                </div>
                <div class="reconnection-info-item">
                    <span class="reconnection-info-icon">🔄</span>
                    <span>Se sincronizarán al reconectar</span>
                </div>
            </div>
            <div class="reconnection-buttons">
                <button class="btn btn-secondary" onclick="dismissReconnectionScreen()">Continuar sin sincronizar</button>
                <button class="btn btn-primary" onclick="reconnectGoogle()">🔐 Reconectar con Google</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Animar entrada
    setTimeout(() => {
        overlay.classList.add('active');
    }, 10);
}

function dismissReconnectionScreen() {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}

function reconnectGoogle() {
    dismissReconnectionScreen();
    handleLogin();
}

// Hacer funciones disponibles globalmente
window.dismissReconnectionScreen = dismissReconnectionScreen;
window.reconnectGoogle = reconnectGoogle;

// ==================== LISTENERS ====================
function setupListeners() {
    const scanner = document.getElementById('scanner');
    if (scanner) {
        // Variables para detectar entrada de escáner vs manual
        let lastInputTime = 0;
        let inputBuffer = '';
        const SCANNER_THRESHOLD = 500; // ms - aumentado para códigos largos que tardan en transmitirse
        
        // Bloquear entrada manual - solo permitir escáner o paste
        scanner.addEventListener('keydown', (e) => {
            const now = Date.now();
            const timeDiff = now - lastInputTime;
            
            // Permitir teclas especiales (Enter, Backspace, Delete, Tab, etc.)
            const allowedKeys = ['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
            
            if (allowedKeys.includes(e.key)) {
                if (e.key === 'Enter' && scanner.value.trim()) {
                    e.preventDefault();
                    processScan(scanner.value.trim());
                    scanner.value = '';
                    inputBuffer = '';
                }
                lastInputTime = now;
                return;
            }
            
            // Permitir Ctrl+V, Cmd+V (paste)
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                lastInputTime = now;
                return;
            }
            
            // Detectar entrada rápida (escáner) vs lenta (manual)
            if (timeDiff > SCANNER_THRESHOLD && inputBuffer.length > 0) {
                // Entrada lenta = manual typing - BLOQUEAR
                e.preventDefault();
                showMiniAlert('⚠️ Usa el escáner o pega el código');
                scanner.value = '';
                inputBuffer = '';
                return;
            }
            
            // Entrada rápida = escáner - PERMITIR
            inputBuffer += e.key;
            lastInputTime = now;
        });
        
        // Permitir paste
        scanner.addEventListener('paste', (e) => {
            lastInputTime = Date.now();
            inputBuffer = '';
        });
        
        // Limpiar buffer después de inactividad
        setInterval(() => {
            const now = Date.now();
            if (now - lastInputTime > 1000) {
                inputBuffer = '';
            }
        }, 1000);
    }
}

// ==================== VALIDACIÓN ====================
async function processScan(raw, isManual = false) {
    // Actualizar timestamp de última actividad para mantener sesión
    localStorage.setItem('wms_last_activity', Date.now().toString());

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

    // CRÍTICO: Asegurar que raw sea string para evitar [object Object]
    const rawStr = (raw !== null && raw !== undefined) ? String(raw) : '';
    
    // Usar función compartida normalizeCode de wms-utils.js que maneja extracción y normalización
    const code = normalizeCode(rawStr);
    
    // Generar variaciones para búsqueda inteligente
    const variations = generateCodeVariations(code);
    
    console.log('🔍 [VALIDADOR] Procesando scan:', {
        raw: rawStr,
        normalizedCode: code,
        variations,
        obc,
        isManual
    });
    
    // Buscar el código en BD usando todas las variaciones
    let found = false;
    let concatenated = '';
    for (const variant of variations) {
        concatenated = variant + obc.toLowerCase();
        if (BD_CODES.has(concatenated)) {
            found = true;
            console.log(`✅ [VALIDADOR] Código encontrado con variante: ${variant}`);
            break;
        }
    }

    // Verificar si existe en BD
    if (!found) {
        console.warn('❌ [VALIDADOR] Código NO encontrado en BD:', {
            code,
            variations,
            obc
        });
        await handleRejection('NO_EXISTE_EN_BD', rawStr, code, obc);
        return;
    }

    console.log('✅ [VALIDADOR] Código encontrado en BD:', concatenated);


    // Verificar historial global
    if (HISTORY.has(concatenated)) {
        const histData = HISTORY.get(concatenated);
        lastScanned = { raw: rawStr, code, obc, location, histData, isManual };
        showPopup('history', code, histData);
        playSound('duplicate');
        return;
    }

    // Verificar duplicado en sesión
    const isDup = tab.validations.find(v => v.code === code);
    if (isDup) {
        lastScanned = { raw: rawStr, code, obc, location, duplicate: isDup, isManual };
        showPopup('dup', code, isDup);
        playSound('duplicate');
        return;
    }

    await handleValidationOK(rawStr, code, obc, location, '', isManual);
}

async function handleValidationOK(raw, code, obc, location, note = '', isManual = false) {
    // DEDUPLICACIÓN: Verificar si esta validación ya fue sincronizada
    // MODIFICADO: Permitir múltiples escaneos del mismo código (para contar unidades)
    // La deduplicación técnica de eventos se maneja en AdvancedSyncManager con IDs únicos.
    if (ValidationDeduplicationManager.isValidationSynced(code, obc, location)) {
        console.log(`ℹ️ [DEDUP] Código ${code} ya visto anteriormente en esta ubicación (permitiendo re-escaneo)`);
        // NO BLOQUEAR: Permitir que pase para soportar múltiples unidades
        // showNotification('⚠️ Esta validación ya fue registrada anteriormente', 'warning');
        // playSound('error');
        // return; 
    }

    const timestamp = new Date().toLocaleTimeString();
    const date = new Date().toLocaleDateString('es-MX'); // Formato DD/MM/YYYY
    
    // Crear objeto de log
    const log = {
        date: date,
        timestamp: timestamp,
        user: CURRENT_USER,
        obc: obc,
        code: code,
        location: location,
        note: isManual ? `MANUAL: ${note}` : note,
        raw: raw
    };

    STATE.tabs[obc].validations.push(log);
    const concatenated = code + obc.toLowerCase();
    const historyData = { date: log.date, timestamp: log.timestamp, user: log.user, obc, code, raw, location, note: log.note };
    HISTORY.set(concatenated, historyData);

    // Guardar en IndexedDB para cache persistente
    await HistoryIndexedDBManager.addValidation(concatenated, historyData);

    // CRÍTICO: NO marcar como sincronizada aquí - se marcará DESPUÉS de la escritura exitosa
    // La deduplicación técnica se maneja en AdvancedSyncManager con IDs únicos (_id)
    // ValidationDeduplicationManager.markValidationAsSynced(code, obc, location); // REMOVIDO

    addToPendingSync(log);
    await saveState();
    await saveHistory();

    renderValidation();
    updateSidebar();
    updateGlobalSummary();
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
    
    // Sincronizar rechazo a Google Sheets en hoja Validaciones_RECHAZADAS
    try {
        await syncRejectionToSheets(log);
    } catch (error) {
        console.error('❌ [VALIDADOR] Error sincronizando rechazo:', error);
        // No bloqueamos la operación si falla el sync
    }

    await saveState();
    renderValidation();
    updateGlobalSummary();
    playSound('error');
    flashInput('error');
    showPopup('error', raw, reason);
}

/**
 * Sincroniza un rechazo a la hoja Validaciones_RECHAZADAS en Google Sheets
 */
async function syncRejectionToSheets(rejection) {
    if (!gapi?.client?.sheets) {
        console.warn('⚠️ [VALIDADOR] Google Sheets API no disponible para sincronizar rechazo');
        return;
    }

    try {
        // Asegurar que la fecha esté en formato correcto
        // rejection.date viene como string "DD/M/YYYY" de toLocaleDateString('es-MX')
        const dateStr = rejection.date || new Date().toLocaleDateString('es-MX');
        
        // Convertir códigos técnicos a lenguaje natural
        const reasonText = rejection.reason === 'NO_EXISTE_EN_BD' 
            ? 'No encontrado en Base de Datos' 
            : rejection.reason || '';
        
        const row = [
            dateStr,  // Fecha como string en formato DD/MM/YYYY
            rejection.timestamp || '',
            rejection.user || CURRENT_USER || '',  // Asegurar que se incluya el usuario
            rejection.obc || '',
            rejection.raw || '',
            rejection.code || '',
            reasonText  // Mensaje en lenguaje natural
        ];

        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_WRITE,
            range: 'Validaciones_RECHAZADAS!A:G',
            valueInputOption: 'USER_ENTERED',  // USER_ENTERED para que Sheets interprete tipos de datos
            resource: {
                values: [row]
            }
        });

        console.log(`✅ [VALIDADOR] Rechazo sincronizado a Validaciones_RECHAZADAS: ${rejection.code}`);
    } catch (error) {
        console.error('❌ [VALIDADOR] Error escribiendo rechazo en Google Sheets:', error);
        throw error;
    }
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

// Función local comentada - usar la de wms-utils.js que preserva separadores (/ y -)
// La función global normalizeCode de wms-utils.js ya maneja correctamente:
// - 52187553/29 → 52187553/29 (preserva /)
// - 52187553-29 → 52187553-29 (preserva -)

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
    updateGlobalSummary();
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
    // Focus en ubicación primero, luego el usuario pasa a scanner con Enter
    const locationInput = document.getElementById('location-input');
    if (locationInput) {
        locationInput.focus();
    }
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

function createNewOBC(obcName) {
    STATE.tabs[obcName] = {
        location: '',
        validations: [],
        rejections: [],
        completed: false
    };
    switchOBC(obcName);
    updateGlobalSummary();
    showNotification(`✅ Orden ${obcName} creada`, 'success');
}

async function addOBC() {
    const obc = prompt('Ingresa el número de orden:');
    if (!obc) return;

    const obcName = obc.toUpperCase().trim();
    if (STATE.tabs[obcName]) {
        showNotification('⚠️ Esta orden ya está abierta', 'warning');
        return;
    }

    // Verificar si la base de datos está cargada o cargando
    if (BD_LOADING) {
        showNotification('⏳ Base de datos cargando, espera un momento...', 'info');
        return;
    }
    
    if (BD_CODES.size === 0 || OBC_TOTALS.size === 0) {
        showNotification('⚠️ Base de datos no cargada. Haz click en 🔄 para cargar la BD', 'warning');
        return;
    }

    // Verificar si la OBC existe en la base de datos
    const total = OBC_TOTALS.get(obcName) || 0;
    const obcInfo = OBC_INFO.get(obcName);

    if (total === 0 && !obcInfo) {
        const confirmCreate = confirm(`⚠️ La orden ${obcName} no se encontró en la base de datos.\n\n¿Deseas crearla de todos modos?\n\nNota: No se podrá verificar el total de cajas esperadas.`);
        if (!confirmCreate) {
            return;
        }
    }

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
    // CORREGIDO: Referencias obsoletas eliminadas
    // El diseño actual maneja el estado con renderValidation()
    renderValidation();
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
    const locationInput = document.getElementById('location-input');
    if (locationInput) {
        const location = locationInput.value.toUpperCase().trim();
        if (STATE.tabs[STATE.activeOBC]) {
            STATE.tabs[STATE.activeOBC].location = location;
            STATE.currentLocation = location;
        }
    }
    saveState();
}

// ==================== POPUPS ====================
function showPopup(type, code, data) {
    if (type === 'error') {
        document.getElementById('err-code').textContent = code;
        // Traducir mensaje de error a español
        const errorMessage = data === 'NO_EXISTE_EN_BD' ? 'No encontrado en Base de Datos' : data;
        document.getElementById('err-reason').textContent = errorMessage;
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

        // Obtener fecha de última validación
        let fechaValidacion = '-';
        if (tab.validations && tab.validations.length > 0) {
            // Obtener la fecha más reciente
            const lastValidation = tab.validations[tab.validations.length - 1];
            fechaValidacion = lastValidation.date || '-';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${fechaValidacion}</td>
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
    const summaryEl = document.getElementById('faltantes-summary');

    if (!selectedOBC) {
        if (summaryEl) summaryEl.innerHTML = '';
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">Selecciona una orden para ver los códigos faltantes</div>';
        return;
    }

    const allOrders = { ...STATE.tabs, ...STATE.closedTabs };
    const tab = allOrders[selectedOBC];
    const obcCodes = OBC_MAP.get(selectedOBC);

    if (!obcCodes) {
        if (summaryEl) summaryEl.innerHTML = '';
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">No hay datos para esta orden</div>';
        return;
    }

    // CORRECCIÓN: Combinar validaciones de tab.validations Y del HISTORY global
    // Esto asegura que las validaciones sincronizadas del servidor también se consideren
    const validatedCodes = new Set();

    // 1. Agregar códigos de tab.validations (sesión local)
    if (tab && tab.validations) {
        tab.validations.forEach(v => {
            if (v.code) validatedCodes.add(v.code.toUpperCase());
        });
    }

    // 2. Agregar códigos del HISTORY global (sincronizados del servidor)
    for (const [key, data] of HISTORY.entries()) {
        if (data.obc && data.obc.toUpperCase() === selectedOBC.toUpperCase()) {
            // El código está en la clave: key = código + obc.toLowerCase()
            const code = key.replace(selectedOBC.toLowerCase(), '').toUpperCase();
            if (code) validatedCodes.add(code);
        }
    }

    const totalCodes = obcCodes.size;
    const validatedCount = validatedCodes.size;
    const pendingCount = totalCodes - validatedCount;

    const pending = [];
    for (const concatenated of obcCodes) {
        const code = concatenated.replace(selectedOBC.toLowerCase(), '').toUpperCase();
        if (!validatedCodes.has(code)) {
            pending.push(code);
        }
    }

    // NUEVO: Renderizar resumen como badges compactos
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="faltantes-summary-item total">
                <div class="faltantes-summary-number">${totalCodes}</div>
                <div class="faltantes-summary-label">Total BD</div>
            </div>
            <div class="faltantes-summary-item validados">
                <div class="faltantes-summary-number">${validatedCount}</div>
                <div class="faltantes-summary-label">Validados</div>
            </div>
            <div class="faltantes-summary-item faltantes">
                <div class="faltantes-summary-number">${pendingCount}</div>
                <div class="faltantes-summary-label">Faltantes</div>
            </div>
        `;
    }

    grid.innerHTML = pending.map(code => `
        <div class="faltante-item faltante-pending" data-code="${code}">${code}</div>
    `).join('') || '<div style="grid-column: 1/-1; text-align: center; color: var(--success); padding: 40px; font-size: 1.2em;">✅ Todos los códigos validados</div>';
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

async function executeConsulta() {
    // Actualizar timestamp de última actividad para mantener sesión
    localStorage.setItem('wms_last_activity', Date.now().toString());

    const rawInput = document.getElementById('consulta-scanner').value.trim();

    if (!rawInput) {
        showNotification('⚠️ Ingresa un código o número de orden', 'warning');
        return;
    }

    // Verificar conexión antes de consultar
    if (!IS_ONLINE) {
        showNotification('❌ Sin conexión a internet. No se puede consultar la base de datos.', 'error');
        return;
    }

    // Verificar que la BD esté cargada
    if (OBC_MAP.size === 0) {
        showNotification('❌ Base de datos no cargada. Recarga la página e intenta nuevamente.', 'error');
        return;
    }

    // ========== USO DE CACHE LOCAL ==========
    // El historial se sincroniza automáticamente:
    // 1. Al iniciar la aplicación (carga inicial)
    // 2. Cada 30 minutos en background (auto-refresh silencioso)
    // Las consultas usan el cache local para evitar recargas constantes
    console.log('🔍 [CONSULTA] Usando datos del cache local (última sync: auto)');

    const resultDiv = document.getElementById('consulta-result');
    const matches = [];

    // Detectar si es un número de orden (OBC) o un código de caja
    const inputUpper = rawInput.toUpperCase();
    const isOrderNumber = OBC_MAP.has(inputUpper) || OBC_TOTALS.has(inputUpper);
    
    if (isOrderNumber) {
        // BÚSQUEDA POR NÚMERO DE ORDEN: Mostrar todas las cajas de esa orden
        console.log(`🔍 [CONSULTA] Buscando por número de orden: ${inputUpper}`);
        
        const obc = inputUpper;
        const codes = OBC_MAP.get(obc);
        const total = OBC_TOTALS.get(obc) || 0;
        const info = OBC_INFO.get(obc) || {};
        
        if (!codes || codes.size === 0) {
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = `
                <div class="consulta-result">
                    <div class="consulta-header">
                        <div class="consulta-code-display">
                            <div class="consulta-code-label">Orden</div>
                            <div class="consulta-code-value">${obc}</div>
                        </div>
                        <div class="consulta-status not-found">Sin cajas</div>
                    </div>
                    <p style="text-align: center; color: #666;">Esta orden no tiene cajas registradas</p>
                </div>
            `;
            return;
        }
        
        // Obtener todas las cajas de la orden
        const allBoxes = [];
        for (const concat of codes) {
            // Extraer el código de la caja (remover el sufijo de orden)
            const boxCode = concat.substring(0, concat.length - obc.toLowerCase().length);
            const histKey = concat;
            const histData = HISTORY.get(histKey);
            allBoxes.push({
                code: boxCode,
                isValidated: !!histData,
                histData
            });
        }
        
        // Ordenar: validadas al final, pendientes al inicio
        allBoxes.sort((a, b) => {
            if (a.isValidated === b.isValidated) return 0;
            return a.isValidated ? 1 : -1;
        });
        
        const validated = allBoxes.filter(b => b.isValidated).length;
        const pending = total - validated;
        
        // Calcular porcentaje de progreso
        const progressPct = total > 0 ? Math.round((validated / total) * 100) : 0;
        const isComplete = progressPct >= 100;

        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
            <div class="obc-summary-card">
                <div class="obc-summary-header">
                    <div class="obc-summary-title">
                        <span class="obc-icon">📦</span>
                        <h3>Orden: ${obc}</h3>
                        <span class="obc-status-pill ${isComplete ? 'complete' : 'in-progress'}">
                            ${isComplete ? '✅ Completada' : '🔄 En Proceso'}
                        </span>
                    </div>
                    <div class="obc-progress-ring">
                        <span>${progressPct}%</span>
                    </div>
                </div>
                <div class="obc-summary-stats">
                    <div class="obc-stat">
                        <div class="obc-stat-value">${total}</div>
                        <div class="obc-stat-label">Total</div>
                    </div>
                    <div class="obc-stat success">
                        <div class="obc-stat-value">${validated}</div>
                        <div class="obc-stat-label">Validadas</div>
                    </div>
                    <div class="obc-stat warning">
                        <div class="obc-stat-value">${pending}</div>
                        <div class="obc-stat-label">Pendientes</div>
                    </div>
                </div>
                <div class="obc-summary-info">
                    <div class="obc-info-item">
                        <span class="obc-info-icon">🏢</span>
                        <span class="obc-info-label">Destino:</span>
                        <span class="obc-info-value">${info.recipient || '-'}</span>
                    </div>
                    <div class="obc-info-item">
                        <span class="obc-info-icon">🕐</span>
                        <span class="obc-info-label">Horario:</span>
                        <span class="obc-info-value">${info.arrivalTime || '-'}</span>
                    </div>
                </div>
            </div>
            <div class="obc-boxes-table-wrapper">
                <table class="obc-boxes-table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Validado por</th>
                            <th>Fecha y Hora</th>
                            <th>Estatus</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allBoxes.map(box => `
                            <tr class="${box.isValidated ? 'validated' : 'pending'}">
                                <td class="code-cell">${box.code}</td>
                                <td>${box.isValidated ? box.histData.user : '-'}</td>
                                <td>${box.isValidated ? `${box.histData.date} ${box.histData.timestamp}` : '-'}</td>
                                <td>
                                    <span class="status-pill ${box.isValidated ? 'validated' : 'pending'}">
                                        ${box.isValidated ? '✅ Validada' : '⏳ Pendiente'}
                                    </span>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        showNotification(`📦 Mostrando ${allBoxes.length} cajas de la orden ${obc}`, 'info');
        playSound('ok');

        // ========== LIMPIEZA AUTOMÁTICA DEL SEARCHBOX ==========
        // Limpiar el campo de búsqueda y mantener el foco para el siguiente escaneo
        const scannerInput = document.getElementById('consulta-scanner');
        if (scannerInput) {
            scannerInput.value = '';
            setTimeout(() => scannerInput.focus(), 100); // Refocus después de render
        }
        return;
    }
    
    // BÚSQUEDA POR CÓDIGO DE CAJA: Buscar en todas las órdenes
    console.log(`🔍 [CONSULTA] Buscando por código de caja: ${rawInput}`);
    const code = normalizeCode(rawInput);
    const variations = generateCodeVariations(code);
    
    for (const [obc, codes] of OBC_MAP.entries()) {
        let found = false;
        for (const variant of variations) {
            const concat = variant + obc.toLowerCase();
            if (codes.has(concat)) {
                const histKey = variant + obc.toLowerCase();
                const histData = HISTORY.get(histKey);
                matches.push({ obc, code: variant, isValidated: !!histData, histData });
                found = true;
                break;
            }
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
        playSound('error');

        // ========== LIMPIEZA AUTOMÁTICA DEL SEARCHBOX ==========
        // Limpiar el campo de búsqueda y mantener el foco para el siguiente escaneo
        const scannerInput = document.getElementById('consulta-scanner');
        if (scannerInput) {
            scannerInput.value = '';
            setTimeout(() => scannerInput.focus(), 100); // Refocus después de render
        }
        return;
    }

    // Mostrar múltiples tarjetas si el código pertenece a varias órdenes
    resultDiv.style.display = 'block';
    
    if (matches.length > 1) {
        showNotification(`🔍 Código encontrado en ${matches.length} órdenes`, 'info');
    }
    
    resultDiv.innerHTML = '<div class="obc-cards-container">' + matches.map(match => {
        const info = OBC_INFO.get(match.obc) || {};
        const total = OBC_TOTALS.get(match.obc) || 0;
        const tabData = STATE.tabs[match.obc];
        
        // Contar validaciones desde HISTORY (fuente de verdad) en lugar de solo tabs
        let validated = 0;
        const obcCodes = OBC_MAP.get(match.obc);
        if (obcCodes) {
            for (const concat of obcCodes) {
                if (HISTORY.has(concat)) {
                    validated++;
                }
            }
        }
        // Si hay tab abierto, usar el máximo entre HISTORY y tab.validations
        if (tabData) {
            validated = Math.max(validated, tabData.validations.length);
        }
        
        const progress = total > 0 ? Math.round((validated / total) * 100) : 0;
        const isComplete = tabData?.completed || (validated >= total && total > 0);

        return `
            <div class="obc-card">
                <div class="obc-card-header">
                    <div class="obc-card-title">${match.obc}</div>
                    <div class="obc-card-badge ${isComplete ? 'complete' : validated > 0 ? 'partial' : 'pending'}">
                        ${isComplete ? '✅ Completa' : validated > 0 ? `${progress}%` : 'Pendiente'}
                    </div>
                </div>
                <div class="obc-card-info">
                    <div class="obc-card-info-row">
                        <span class="obc-card-label">Código:</span>
                        <span class="obc-card-value">${match.code}</span>
                    </div>
                    <div class="obc-card-info-row">
                        <span class="obc-card-label">Destino:</span>
                        <span class="obc-card-value">${info.recipient || '-'}</span>
                    </div>
                    <div class="obc-card-info-row">
                        <span class="obc-card-label">Horario:</span>
                        <span class="obc-card-value">${info.arrivalTime || '-'}</span>
                    </div>
                    <div class="obc-card-info-row">
                        <span class="obc-card-label">Estado:</span>
                        <span class="obc-card-value" style="color: ${match.isValidated ? 'var(--success)' : 'var(--warning)'}">
                            ${match.isValidated ? '✅ Validado' : '⏳ Pendiente'}
                        </span>
                    </div>
                    ${match.isValidated ? `
                        <div class="obc-card-info-row">
                            <span class="obc-card-label">Validado por:</span>
                            <span class="obc-card-value">${match.histData.user}</span>
                        </div>
                        <div class="obc-card-info-row">
                            <span class="obc-card-label">Fecha:</span>
                            <span class="obc-card-value">${match.histData.date} ${match.histData.timestamp}</span>
                        </div>
                    ` : ''}
                </div>
                <div class="obc-card-progress">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                        <span style="font-size: 0.85em; color: #666;">Progreso</span>
                        <span style="font-size: 0.85em; font-weight: 700;">${validated}/${total}</span>
                    </div>
                    <div class="obc-card-progress-bar">
                        <div class="obc-card-progress-fill ${isComplete ? 'complete' : ''}" style="width: ${progress}%"></div>
                    </div>
                </div>
                ${!match.isValidated ? `
                    <button class="obc-card-button" onclick="goToValidateOrder('${match.obc}')">
                        🎯 Ir a Validar
                    </button>
                ` : `
                    <div style="text-align: center; padding: 10px; color: var(--success); font-weight: 600;">
                        ✅ Ya validado
                    </div>
                `}
            </div>
        `;
    }).join('') + '</div>';

    playSound('ok');

    // ========== LIMPIEZA AUTOMÁTICA DEL SEARCHBOX ==========
    // Limpiar el campo de búsqueda y mantener el foco para el siguiente escaneo
    const scannerInput = document.getElementById('consulta-scanner');
    if (scannerInput) {
        scannerInput.value = '';
        setTimeout(() => scannerInput.focus(), 100); // Refocus después de render
    }
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

// ==================== EXPORTACIONES GLOBALES ====================
// Asegurar que todas las funciones llamadas desde HTML estén disponibles globalmente
window.addOBC = addOBC;
window.cancelReloadOrder = cancelReloadOrder;
window.closePopup = closePopup;
window.confirmReloadOrder = confirmReloadOrder;
window.continueToNewOrder = continueToNewOrder;
window.continueViewing = continueViewing;
window.exportData = exportData;
window.forceDuplicate = forceDuplicate;
window.forceHistoryValidation = forceHistoryValidation;
window.openManualInput = openManualInput;
window.submitManualCode = submitManualCode;
window.showResumen = showResumen;
window.showFaltantes = showFaltantes;
window.showConsulta = showConsulta;
window.showPrerecepcion = showPrerecepcion;
window.hideResumen = hideResumen;
window.hideFaltantes = hideFaltantes;
window.hideConsulta = hideConsulta;
window.hideReconteo = hideReconteo;
window.openReconteo = openReconteo;
window.clearReconteo = clearReconteo;
window.executeConsulta = executeConsulta;

// Función para ir a validar una orden desde consulta
function goToValidateOrder(obc) {
    hideConsulta();
    
    // Si la orden ya está abierta, cambiar a ella
    if (STATE.tabs[obc]) {
        switchOBC(obc);
        showNotification(`🎯 Cambiado a orden ${obc}`, 'success');
    } else {
        // Si no está abierta, crear nueva tab
        createNewOBC(obc);
        showNotification(`✅ Orden ${obc} abierta para validación`, 'success');
    }
    
    // Enfocar el scanner
    setTimeout(() => {
        document.getElementById('scanner')?.focus();
    }, 100);
}

window.goToValidateOrder = goToValidateOrder;
window.confirmPrerecepcion = confirmPrerecepcion;
window.closePrerecepcion = closePrerecepcion;
window.saveAndClose = saveAndClose;
window.saveAndContinue = saveAndContinue;
window.switchOBC = switchOBC;
window.closeTab = closeTab;
window.updateState = updateState;

console.log('✅ [VALIDADOR] Todas las funciones exportadas globalmente');

function testLocationValidator() {
    console.log('🧪 Testing Location Validator (usando wms-utils.js)...');
    
    const testCases = [
        'A26-06-01-02',  // Debe normalizarse a A1-01-01-01
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
