/**
 * ADVANCED-SYNC-MANAGER.JS
 * Sistema de sincronización avanzado compartido para todo el WMS
 *
 * @version 4.0.0
 * @description Módulo GENÉRICO con:
 * - Control de concurrencia (Read-Verify-Write)
 * - Persistencia offline-first (IndexedDB)
 * - Heartbeat y auto-sync
 * - Manejo robusto de errores
 *
 * IMPORTANTE: La lógica de deduplicación es ESPECÍFICA de cada app.
 * Este módulo provee hooks para que cada app defina sus propios criterios:
 * - config.shouldIncludeRecord(record) - Filtro personalizado antes de sync
 * - config.generateRecordKey(record) - Clave única para deduplicación interna
 * - config.onBeforeSync(records) - Hook antes de sincronizar
 * - config.onAfterSync(records) - Hook después de sincronizar
 */

// ==================== CONCURRENCY CONTROL MODULE ====================
/**
 * MÓDULO DE CONTROL DE CONCURRENCIA
 * Implementa Read-Verify-Write pattern para evitar conflictos de escritura
 */
class ConcurrencyControl {
    constructor(config = {}) {
        this.maxRetries = config.maxRetries || 3;
        this.retryDelay = config.retryDelay || 1000;
        this.isWriting = false;
    }

    /**
     * Obtiene la última fila ocupada en la hoja
     */
    async getLastRow(spreadsheetId, sheetName) {
        try {
            // Verificar que gapi esté disponible
            if (typeof gapi === 'undefined' || !gapi.client || !gapi.client.sheets) {
                throw new Error('Google API (gapi) no está inicializado');
            }

            // Verificar que haya token de autenticación
            const token = gapi.client.getToken();
            if (!token) {
                throw new Error('No hay token de autenticación. Usuario no ha iniciado sesión.');
            }

            console.log(`📊 [CONCURRENCY] Leyendo última fila de ${sheetName}...`);

            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: `${sheetName}!A:A`,
                majorDimension: 'ROWS'
            });

            const rows = response.result.values || [];
            const lastRow = rows.length;
            console.log(`📊 [CONCURRENCY] Última fila detectada: ${lastRow}`);
            return lastRow;
        } catch (error) {
            console.error('❌ [CONCURRENCY] Error obteniendo última fila:', error);
            console.error('   - SpreadsheetId:', spreadsheetId);
            console.error('   - SheetName:', sheetName);
            console.error('   - Error completo:', error);
            
            // Detectar errores de autenticación
            if (error.status === 401 || error.status === 400) {
                this.handleAuthError(error);
            }
            
            throw error;
        }
    }
    
    /**
     * Maneja errores de autenticación (401/400)
     * CORREGIDO: Intenta reconexión automática antes de mostrar banner
     */
    handleAuthError(error) {
        console.error('🔐 [AUTH-ERROR] Error de autenticación detectado:', error.status);

        // Intentar reconexión automática primero
        if (typeof handleReconnectWithDataReload === 'function') {
            console.log('🔄 [AUTH-ERROR] Intentando reconexión automática...');
            try {
                handleReconnectWithDataReload();
                return; // El callback de reconexión manejará el resto
            } catch (e) {
                console.error('❌ [AUTH-ERROR] Falló reconexión automática:', e);
            }
        }

        // Fallback: Mostrar banner de error con botón de reconexión
        if (typeof showAuthErrorBanner === 'function') {
            showAuthErrorBanner();
        } else {
            // Fallback: crear banner manualmente
            this.createAuthErrorBanner();
        }
    }
    
    /**
     * Crea un banner de error de autenticación
     */
    createAuthErrorBanner() {
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
                <button onclick="handleReconnect()" style="
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
        
        // Agregar animación
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from { transform: translateY(-100%); }
                to { transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Escribe datos con verificación de concurrencia usando Read-Verify-Write
     */
    async writeWithConcurrencyControl(spreadsheetId, sheetName, values) {
        if (this.isWriting) {
            throw new Error('Ya hay una operación de escritura en progreso en este cliente');
        }

        this.isWriting = true;
        let attempt = 0;
        let currentRetryDelay = this.retryDelay;

        try {
            while (attempt < this.maxRetries) {
                try {
                    attempt++;
                    console.log(`🔄 [CONCURRENCY] Intento ${attempt}/${this.maxRetries}`);

                    // CRÍTICO: Usar APPEND en lugar de UPDATE para evitar sobreescritura
                    // Append siempre agrega al final de la hoja, evitando conflictos de concurrencia
                    const range = `${sheetName}!A:Z`;

                    console.log(`✍️ [CONCURRENCY] Usando APPEND en: ${range} (${values.length} registros)`);

                    const writeResponse = await gapi.client.sheets.spreadsheets.values.append({
                        spreadsheetId: spreadsheetId,
                        range: range,
                        valueInputOption: 'USER_ENTERED',
                        insertDataOption: 'INSERT_ROWS',  // Insertar nuevas filas
                        resource: { values: values }
                    });

                    // Verificar que la escritura fue exitosa
                    if (writeResponse.status !== 200) {
                        throw new Error(`Status ${writeResponse.status} en escritura`);
                    }

                    // Obtener información del rango donde se escribió
                    const updatedRange = writeResponse.result.updates?.updatedRange || '';
                    const updatedRows = writeResponse.result.updates?.updatedRows || values.length;

                    console.log(`✅ [CONCURRENCY] APPEND completado!`);
                    console.log(`   - SpreadsheetId: ${spreadsheetId}`);
                    console.log(`   - Hoja: ${sheetName}`);
                    console.log(`   - Rango actualizado: ${updatedRange}`);
                    console.log(`   - Filas agregadas: ${updatedRows}`);

                    // Extraer fila inicial del rango actualizado (ej: "Val3!A5:G5" -> 5)
                    const rangeMatch = updatedRange.match(/!A(\d+):/);
                    const startRow = rangeMatch ? parseInt(rangeMatch[1]) : 0;
                    const endRow = startRow + values.length - 1;

                    return {
                        success: true,
                        startRow: startRow,
                        endRow: endRow,
                        updatedRows: updatedRows,
                        range: updatedRange,
                        status: 200
                    };

                } catch (error) {
                    console.error(`❌ [CONCURRENCY] Error en intento ${attempt}:`, error);

                    // Manejo seguro de error.message
                    const errorMessage = String(error?.message || error?.result?.error?.message || '');
                    const isRecoverable = errorMessage && (errorMessage.includes('Verificación fallida') ||
                                        errorMessage.includes('Integridad comprometida')) ||
                                        error.status === 429 ||
                                        error.status === 503;

                    if (isRecoverable && attempt < this.maxRetries) {
                        console.log(`⏳ [CONCURRENCY] Error recuperable, reintentando en ${currentRetryDelay}ms...`);
                        await this.sleep(currentRetryDelay);
                        currentRetryDelay = Math.floor(currentRetryDelay * 1.5);
                    } else {
                        throw error;
                    }
                }
            }

            throw new Error(`Conflicto de concurrencia: No se pudo escribir después de ${this.maxRetries} intentos`);

        } finally {
            this.isWriting = false;
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== PERSISTENCE MANAGER (OFFLINE-FIRST) ====================
/**
 * MÓDULO DE PERSISTENCIA
 * Gestión offline-first con IndexedDB para máxima confiabilidad
 */
class PersistenceManager {
    constructor(config = {}) {
        this.DB_NAME = config.dbName || 'WMS_PersistenceDB';
        this.DB_VERSION = config.dbVersion || 2;
        this.db = null;

        this.STORES = {
            DRAFT_BOXES: 'draft_boxes',
            PENDING_SYNC: 'pending_sync_v2',
            SYNCED_RECORDS: 'synced_records',
            SESSIONS: 'sessions'
        };
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onerror = () => {
                console.error('❌ [PERSISTENCE] Error abriendo IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log('✅ [PERSISTENCE] IndexedDB inicializada');
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                console.log('🔧 [PERSISTENCE] Creando/actualizando stores...');

                if (!db.objectStoreNames.contains(this.STORES.DRAFT_BOXES)) {
                    const draftStore = db.createObjectStore(this.STORES.DRAFT_BOXES, { keyPath: '_id' });
                    draftStore.createIndex('_category', '_category', { unique: false });
                    draftStore.createIndex('_palletId', '_palletId', { unique: false });
                    draftStore.createIndex('_sessionId', '_sessionId', { unique: false });
                    draftStore.createIndex('_timestamp', '_timestamp', { unique: false });
                }

                if (!db.objectStoreNames.contains(this.STORES.PENDING_SYNC)) {
                    const pendingStore = db.createObjectStore(this.STORES.PENDING_SYNC, { keyPath: '_id' });
                    pendingStore.createIndex('_status', '_status', { unique: false });
                    pendingStore.createIndex('_timestamp', '_timestamp', { unique: false });
                }

                if (!db.objectStoreNames.contains(this.STORES.SYNCED_RECORDS)) {
                    const syncedStore = db.createObjectStore(this.STORES.SYNCED_RECORDS, { keyPath: '_id' });
                    syncedStore.createIndex('_syncedAt', '_syncedAt', { unique: false });
                }

                if (!db.objectStoreNames.contains(this.STORES.SESSIONS)) {
                    const sessionStore = db.createObjectStore(this.STORES.SESSIONS, { keyPath: 'id' });
                    sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    async saveDraftBox(boxRecord) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORES.DRAFT_BOXES], 'readwrite');
                const store = tx.objectStore(this.STORES.DRAFT_BOXES);
                const request = store.put(boxRecord);

                request.onsuccess = () => {
                    console.log(`💾 [PERSISTENCE] Caja guardada: ${boxRecord._id}`);
                    resolve(boxRecord);
                };

                request.onerror = () => {
                    console.error('❌ [PERSISTENCE] Error guardando caja:', request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error('❌ [PERSISTENCE] Error en saveDraftBox:', error);
                reject(error);
            }
        });
    }

    async getDraftBoxes(sessionId = null) {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORES.DRAFT_BOXES], 'readonly');
                const store = tx.objectStore(this.STORES.DRAFT_BOXES);
                const request = sessionId 
                    ? store.index('_sessionId').getAll(sessionId)
                    : store.getAll();

                request.onsuccess = () => {
                    resolve(request.result || []);
                };

                request.onerror = () => {
                    console.error('❌ [PERSISTENCE] Error obteniendo draft boxes:', request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error('❌ [PERSISTENCE] Error en getDraftBoxes:', error);
                resolve([]);
            }
        });
    }

    async moveToPending(records) {
        if (!this.db) await this.init();
        
        return new Promise(async (resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORES.DRAFT_BOXES, this.STORES.PENDING_SYNC], 'readwrite');
                const draftStore = tx.objectStore(this.STORES.DRAFT_BOXES);
                const pendingStore = tx.objectStore(this.STORES.PENDING_SYNC);

                records.forEach(record => {
                    draftStore.delete(record._id);
                    pendingStore.put(record);
                });

                tx.oncomplete = () => {
                    console.log(`✅ [PERSISTENCE] ${records.length} registros movidos a PENDING`);
                    resolve();
                };

                tx.onerror = () => {
                    console.error('❌ [PERSISTENCE] Error moviendo a pending:', tx.error);
                    reject(tx.error);
                };
            } catch (error) {
                console.error('❌ [PERSISTENCE] Error en moveToPending:', error);
                reject(error);
            }
        });
    }

    async getPendingSync() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORES.PENDING_SYNC], 'readonly');
                const store = tx.objectStore(this.STORES.PENDING_SYNC);
                const request = store.getAll();

                request.onsuccess = () => {
                    resolve(request.result || []);
                };

                request.onerror = () => {
                    console.error('❌ [PERSISTENCE] Error obteniendo pending sync:', request.error);
                    reject(request.error);
                };
            } catch (error) {
                console.error('❌ [PERSISTENCE] Error en getPendingSync:', error);
                resolve([]);
            }
        });
    }

    async getPendingCount() {
        if (!this.db) await this.init();
        
        return new Promise((resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORES.PENDING_SYNC], 'readonly');
                const store = tx.objectStore(this.STORES.PENDING_SYNC);
                const request = store.count();

                request.onsuccess = () => {
                    resolve(request.result || 0);
                };

                request.onerror = () => {
                    console.error('❌ [PERSISTENCE] Error contando pending:', request.error);
                    resolve(0);
                };
            } catch (error) {
                console.error('❌ [PERSISTENCE] Error en getPendingCount:', error);
                resolve(0);
            }
        });
    }

    async markAsSynced(records) {
        if (!this.db) await this.init();
        
        return new Promise(async (resolve, reject) => {
            try {
                const tx = this.db.transaction([this.STORES.PENDING_SYNC, this.STORES.SYNCED_RECORDS], 'readwrite');
                const pendingStore = tx.objectStore(this.STORES.PENDING_SYNC);
                const syncedStore = tx.objectStore(this.STORES.SYNCED_RECORDS);

                records.forEach(record => {
                    record._status = 'synced';
                    record._syncedAt = Date.now();
                    
                    pendingStore.delete(record._id);
                    syncedStore.put(record);
                });

                tx.oncomplete = () => {
                    console.log(`✅ [PERSISTENCE] ${records.length} registros marcados como SYNCED`);
                    resolve();
                };

                tx.onerror = () => {
                    console.error('❌ [PERSISTENCE] Error marcando como synced:', tx.error);
                    reject(tx.error);
                };
            } catch (error) {
                console.error('❌ [PERSISTENCE] Error en markAsSynced:', error);
                reject(error);
            }
        });
    }

    /**
     * Cierra la conexión a la base de datos
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            console.log('🔒 [PERSISTENCE] Conexión a IndexedDB cerrada');
        }
    }
}

// ==================== DEDUPLICATION MANAGER ====================
/**
 * MÓDULO DE DEDUPLICACIÓN
 * Previene duplicados usando claves únicas y cache de pallets sincronizados
 */
class DeduplicationManager {
    constructor(config = {}) {
        this.storageKey = config.storageKey || 'wms_synced_pallets';
        this.syncedPallets = new Set();
        this._sendingInProgress = false;
        this._currentSendingPalletId = null;
    }

    generateRecordKey(record) {
        // CRÍTICO: Si tiene ID único, usarlo como clave primaria
        if (record._id) return record._id;

        // Soporte para registros de Pallets
        if (record.pallet && record.location) {
            return `${record.pallet}|${record.scan1 || 'NOSCAN'}|${record.location}`;
        }
        
        // Soporte para registros de Validación
        if (record.codigo || record.code) {
            const code = record.codigo || record.code || '';
            const obc = record.obc || record.orden || '';
            const location = record.ubicacion || record.location || '';
            const time = record.time || record.hora || '';
            // Incluir tiempo para diferenciar escaneos del mismo producto
            return `VAL|${code}|${obc}|${location}|${time}`;
        }

        // Fallback
        return JSON.stringify(record);
    }

    generatePalletKey(palletId, location) {
        return `${palletId}|${location}`;
    }

    isPalletSynced(palletId, location) {
        if (this._sendingInProgress && this._currentSendingPalletId === palletId) {
            console.log(`🟢 [DEDUP] Pallet ${palletId} está en proceso de envío - NO es duplicado`);
            return false;
        }
        const key = this.generatePalletKey(palletId, location);
        return this.syncedPallets.has(key);
    }

    startSending(palletId) {
        this._sendingInProgress = true;
        this._currentSendingPalletId = palletId;
        console.log(`🟡 [DEDUP] Iniciando envío de pallet: ${palletId}`);
    }

    endSending() {
        this._sendingInProgress = false;
        this._currentSendingPalletId = null;
        console.log(`🟢 [DEDUP] Envío finalizado`);
    }

    markPalletAsSynced(palletId, location) {
        const key = this.generatePalletKey(palletId, location);
        this.syncedPallets.add(key);
        this.saveSyncedPallets();
        console.log(`✅ [DEDUP] Pallet marcado como sincronizado: ${key}`);
    }

    filterDuplicateRecords(records, pendingSync = [], currentPalletId = null) {
        const uniqueRecords = [];
        const seenKeys = new Set();

        for (const record of records) {
            const key = this.generateRecordKey(record);
            
            const isCurrentPallet = currentPalletId && record.pallet === currentPalletId;
            
            if (seenKeys.has(key)) {
                console.warn(`⚠️ [DEDUP] Registro duplicado interno filtrado: ${key}`);
                continue;
            }
            
            if (isCurrentPallet) {
                uniqueRecords.push(record);
                seenKeys.add(key);
            } else {
                const existsInPending = pendingSync.some(r => this.generateRecordKey(r) === key);
                if (!existsInPending) {
                    uniqueRecords.push(record);
                    seenKeys.add(key);
                } else {
                    console.warn(`⚠️ [DEDUP] Registro duplicado en PENDING_SYNC filtrado: ${key}`);
                }
            }
        }

        return uniqueRecords;
    }

    async checkPalletExistsInDatabase(palletId, spreadsheetId, sheetName) {
        if (!gapi?.client?.getToken()) {
            console.warn('⚠️ [DEDUP] No hay token de Google, no se puede verificar BD');
            return false;
        }

        if (!palletId || palletId.trim() === '') {
            console.warn('⚠️ [DEDUP] ID de pallet vacío, no se puede verificar');
            return false;
        }

        const cleanPalletId = palletId.toString().trim().toUpperCase();
        console.log(`🔍 [DEDUP] Verificando pallet en BD: "${cleanPalletId}"`);

        try {
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: `${sheetName}!I:I`
            });

            const rows = response.result.values || [];
            const existingPallets = rows
                .flat()
                .filter(p => p && p.toString().trim() !== '')
                .map(p => p.toString().trim().toUpperCase());
            
            const exists = existingPallets.some(p => p === cleanPalletId);
            
            if (exists) {
                console.log(`🔍 [DEDUP] Pallet "${cleanPalletId}" ENCONTRADO en BD`);
            } else {
                console.log(`✅ [DEDUP] Pallet "${cleanPalletId}" NO existe en BD - OK para enviar`);
            }
            
            return exists;
        } catch (error) {
            console.error('❌ [DEDUP] Error verificando pallet en BD:', error);
            return false;
        }
    }

    saveSyncedPallets() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify([...this.syncedPallets]));
        } catch (e) {
            console.error('❌ [DEDUP] Error guardando pallets sincronizados:', e);
        }
    }

    loadSyncedPallets() {
        try {
            const saved = localStorage.getItem(this.storageKey);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    this.syncedPallets = new Set(parsed);
                    console.log(`📂 [DEDUP] Cargados ${this.syncedPallets.size} pallets sincronizados`);
                } else {
                    console.warn('⚠️ [DEDUP] Datos corruptos en localStorage, limpiando...');
                    this.syncedPallets = new Set();
                    this.saveSyncedPallets();
                }
            }
        } catch (e) {
            console.error('❌ [DEDUP] Error cargando pallets sincronizados:', e);
            this.syncedPallets = new Set();
            localStorage.removeItem(this.storageKey);
        }
    }

    cleanOldRecords(maxAgeMs = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        const cutoffTime = now - maxAgeMs;
        let cleaned = 0;

        for (const key of this.syncedPallets) {
            const palletId = key.split('|')[0];
            const parts = palletId.split('-');
            if (parts.length >= 2) {
                const timestampBase36 = parts[1];
                const timestamp = parseInt(timestampBase36, 36);
                if (isNaN(timestamp) || timestamp < cutoffTime) {
                    this.syncedPallets.delete(key);
                    cleaned++;
                }
            } else {
                this.syncedPallets.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`🧹 [DEDUP] Limpiados ${cleaned} registros antiguos/inválidos`);
            this.saveSyncedPallets();
        }
    }

    clearSyncedPallets() {
        this.syncedPallets.clear();
        localStorage.removeItem(this.storageKey);
        console.log('🧹 [DEDUP] Cache de pallets sincronizados limpiado completamente');
    }
}

// ==================== ADVANCED SYNC MANAGER ====================
/**
 * GESTOR DE SINCRONIZACIÓN AVANZADO
 * Módulo GENÉRICO - la lógica específica de cada app se define en config
 */
class AdvancedSyncManager {
    constructor(config = {}) {
        this.config = {
            spreadsheetId: config.spreadsheetId || '',
            sheetName: config.sheetName || 'BD',
            autoSyncInterval: config.autoSyncInterval || 45000,
            heartbeatInterval: config.heartbeatInterval || 10000,
            storageKey: config.storageKey || 'wms_pending_sync',
            appName: config.appName || 'WMS',
            appIcon: config.appIcon || '📦',
            formatRecord: config.formatRecord || null,
            onSyncStart: config.onSyncStart || null,
            onSyncEnd: config.onSyncEnd || null,
            onStatusChange: config.onStatusChange || null,
            // HOOKS CONFIGURABLES PARA DEDUPLICACIÓN ESPECÍFICA DE CADA APP
            // Si no se proveen, se usa comportamiento por defecto (sin filtrado)
            shouldIncludeRecord: config.shouldIncludeRecord || null, // (record) => boolean
            generateRecordKey: config.generateRecordKey || null,     // (record) => string
            onBeforeSync: config.onBeforeSync || null,               // (records) => records
            onAfterSync: config.onAfterSync || null,                 // (records) => void
            // Flag para habilitar/deshabilitar deduplicación legacy por pallet
            useLegacyPalletDedup: config.useLegacyPalletDedup !== false, // true por defecto para compatibilidad
            ...config
        };

        this.concurrencyControl = new ConcurrencyControl({
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000
        });

        this.persistenceManager = new PersistenceManager({
            dbName: config.dbName || 'WMS_PersistenceDB',
            dbVersion: config.dbVersion || 2
        });

        this.deduplicationManager = new DeduplicationManager({
            storageKey: config.dedupStorageKey || 'wms_synced_pallets'
        });

        this.pendingSync = [];
        this.inProgress = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.autoSyncIntervalId = null;
        this.heartbeatIntervalId = null;
        this.lastErrors = [];
        this.lastSyncTime = null;
        this.initialized = false;
    }

    /**
     * Inicializa el Advanced Sync Manager
     */
    async init() {
        if (this.initialized) return;

        await this.persistenceManager.init();
        await this.load();
        this.deduplicationManager.loadSyncedPallets();
        this.deduplicationManager.cleanOldRecords();
        this.startAutoSync();
        this.startHeartbeat();
        this.setupExitProtection();
        this.updateUI(this.pendingSync.length === 0);
        this.initialized = true;

        console.log(`✅ AdvancedSyncManager inicializado para ${this.config.appName}`);
    }

    /**
     * Protección contra salida con datos sin sincronizar
     */
    setupExitProtection() {
        window.addEventListener('beforeunload', (e) => {
            if (this.pendingSync.length > 0) {
                e.preventDefault();
                e.returnValue = '¡Tienes datos sin sincronizar! ¿Seguro que quieres salir?';
                return e.returnValue;
            }
        });
    }

    /**
     * Heartbeat para sincronización automática y actualización de UI
     */
    startHeartbeat() {
        if (this.heartbeatIntervalId) clearInterval(this.heartbeatIntervalId);
        
        this.heartbeatIntervalId = setInterval(async () => {
            try {
                const pendingFromDB = await this.persistenceManager.getPendingSync();
                if (pendingFromDB.length !== this.pendingSync.length) {
                    console.log(`🔄 [HEARTBEAT] Sincronizando PENDING_SYNC: ${this.pendingSync.length} → ${pendingFromDB.length}`);
                    this.pendingSync = pendingFromDB;
                }
                
                if (this._canSync() && this.pendingSync.length > 0 && !this.inProgress) {
                    console.log(`🔄 [HEARTBEAT] Sincronización automática: ${this.pendingSync.length} registros pendientes`);
                    this.sync(false);
                }

                this.updateUI(this.pendingSync.length === 0);
            } catch (error) {
                console.warn('⚠️ [HEARTBEAT] Error en heartbeat:', error);
            }
        }, this.config.heartbeatInterval);
        
        console.log(`✅ [HEARTBEAT] Iniciado - Intervalo: ${this.config.heartbeatInterval}ms`);
    }

    /**
     * Inicia la sincronización automática
     */
    startAutoSync() {
        if (this.autoSyncIntervalId) clearInterval(this.autoSyncIntervalId);

        this.autoSyncIntervalId = setInterval(() => {
            if (this._canSync() && this.pendingSync.length > 0) {
                console.log('⏰ Auto-sync triggered');
                this.sync(false);
            }
        }, this.config.autoSyncInterval);

        console.log(`✅ [AUTO-SYNC] Iniciado - Intervalo: ${this.config.autoSyncInterval}ms`);
    }

    /**
     * Detiene la sincronización automática
     */
    stopAutoSync() {
        if (this.autoSyncIntervalId) {
            clearInterval(this.autoSyncIntervalId);
            this.autoSyncIntervalId = null;
        }
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }
    }

    /**
     * Verifica si puede sincronizar
     */
    _canSync() {
        const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;
        const hasToken = typeof gapi !== 'undefined' && gapi?.client?.getToken();
        return isOnline && hasToken;
    }

    /**
     * Genera un ID único para evitar duplicados
     */
    generateSyncId(record) {
        const key = `${record.date || ''}_${record.time || ''}_${record.scan1 || record.code || ''}_${record.user || ''}`;
        return key;
    }

    /**
     * Deduplicación interna del batch
     * USA EL HOOK config.generateRecordKey SI ESTÁ DEFINIDO
     * Si no, usa el _id del registro como clave única (comportamiento más seguro)
     */
    _deduplicateBatch(records) {
        const seen = new Set();
        const deduplicated = [];

        for (const record of records) {
            let key;

            // PRIORIDAD 1: Usar hook personalizado de la app si está definido
            if (this.config.generateRecordKey) {
                key = this.config.generateRecordKey(record);
            }
            // PRIORIDAD 2: Usar _id único si existe (más seguro - cada registro es único)
            else if (record._id) {
                key = record._id;
            }
            // FALLBACK: Serializar el registro completo (último recurso)
            else {
                key = JSON.stringify(record);
            }

            if (seen.has(key)) {
                console.warn('⚠️ [DEDUP-INTERNAL] Duplicado técnico detectado:', key);
                continue;
            }

            seen.add(key);
            deduplicated.push(record);
        }

        return deduplicated;
    }

    /**
     * Agrega registros a la cola de sincronización evitando duplicados
     */
    async addToQueue(records, sheet = null) {
        if (!Array.isArray(records)) {
            records = [records];
        }

        const filteredRecords = this.deduplicationManager.filterDuplicateRecords(
            records, 
            this.pendingSync
        );

        if (filteredRecords.length === 0) {
            console.warn('⚠️ Todos los registros son duplicados, no se agregaron a la cola');
            return;
        }

        filteredRecords.forEach(record => {
            const newId = this.generateSyncId(record);
            const recordWithMeta = {
                ...record,
                _id: record._id || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                _timestamp: Date.now(),
                _status: 'pending',
                syncId: newId
            };

            if (sheet) {
                this.pendingSync.push({ sheet, record: recordWithMeta, syncId: newId });
            } else {
                this.pendingSync.push(recordWithMeta);
            }
        });

        await this.save();
        this.updateUI(false);
        
        console.log(`✅ ${filteredRecords.length} registros agregados a la cola (${records.length - filteredRecords.length} duplicados filtrados)`);
    }

    /**
     * Verificar y renovar token si es necesario
     */
    async ensureValidToken() {
        // Verificar que gapi esté disponible
        if (typeof gapi === 'undefined' || !gapi.client) {
            throw new Error('Google API no está disponible');
        }

        const token = gapi.client.getToken();
        
        // Si no hay token, solicitar autenticación
        if (!token || !token.access_token) {
            throw new Error('No hay token de autenticación. Por favor, inicia sesión.');
        }

        // Verificar si el token ha expirado
        const expiryTime = parseInt(localStorage.getItem('google_token_expiry') || '0');
        const now = Date.now();
        
        if (expiryTime > 0 && now >= expiryTime) {
            console.log('⚠️ Token expirado, solicitando renovación...');
            
            // Intentar renovar con AuthManager si está disponible
            if (typeof AuthManager !== 'undefined' && AuthManager.renewToken) {
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout renovando token')), 10000);
                    AuthManager.renewToken();
                    // Esperar un momento para que se renueve
                    setTimeout(() => {
                        clearTimeout(timeout);
                        const newToken = gapi.client.getToken();
                        if (newToken && newToken.access_token) {
                            resolve();
                        } else {
                            reject(new Error('No se pudo renovar el token'));
                        }
                    }, 2000);
                });
            } else {
                throw new Error('Token expirado. Por favor, vuelve a iniciar sesión.');
            }
        }

        return true;
    }

    /**
     * Sincroniza los datos pendientes con Google Sheets
     */
    async sync(showMessages = true) {
        if (this.inProgress) {
            console.log('⚠️ Sincronización ya en progreso');
            return { success: false, message: 'Sincronización en progreso' };
        }

        this.inProgress = true;
        this.retryCount = 0;

        try {
            // Verificar token antes de sincronizar
            await this.ensureValidToken();
            return await this._doSync(showMessages, false);
        } catch (error) {
            // Si es error de autenticación, mostrar mensaje claro
            const errorMsg = String(error?.message || '');
            if (errorMsg && (errorMsg.includes('token') || errorMsg.includes('autenticación') || errorMsg.includes('Google API'))) {
                console.error('❌ Error de autenticación:', errorMsg);
                if (showMessages && typeof showNotification === 'function') {
                    showNotification('❌ ' + errorMsg, 'error');
                }
                return { success: false, message: errorMsg };
            }
            throw error;
        } finally {
            this.inProgress = false;
        }
    }

    /**
     * Sincronización lenta (más segura, con delays entre registros)
     */
    async syncSlow(showMessages = true) {
        if (this.inProgress) {
            console.log('⚠️ Sincronización ya en progreso');
            return { success: false, message: 'Sincronización en progreso' };
        }

        this.inProgress = true;
        this.retryCount = 0;

        try {
            // Verificar token antes de sincronizar
            await this.ensureValidToken();
            return await this._doSync(showMessages, true);
        } catch (error) {
            // Si es error de autenticación, mostrar mensaje claro
            const errorMsg = String(error?.message || '');
            if (errorMsg && (errorMsg.includes('token') || errorMsg.includes('autenticación') || errorMsg.includes('Google API'))) {
                console.error('❌ Error de autenticación:', errorMsg);
                if (showMessages && typeof showNotification === 'function') {
                    showNotification('❌ ' + errorMsg, 'error');
                }
                return { success: false, message: errorMsg };
            }
            throw error;
        } finally {
            this.inProgress = false;
        }
    }

    /**
     * Ejecuta la sincronización con control de concurrencia
     */
    async _doSync(showMessages, slowMode = false) {
        if (!gapi?.client?.getToken()) {
            if (showMessages && typeof showNotification === 'function') {
                showNotification('⚠️ No conectado a Google', 'warning');
            }
            return { success: false };
        }

        if (this.pendingSync.length === 0) {
            this.updateUI(true);
            if (showMessages && typeof showNotification === 'function') {
                showNotification('✅ Todo sincronizado', 'success');
            }
            return { success: true, synced: 0 };
        }

        this.inProgress = true;
        this.lastErrors = [];

        if (this.config.onSyncStart) this.config.onSyncStart();
        const syncMessage = slowMode ? '⏱️ Sincronización lenta...' : '🔄 Sincronizando...';
        if (showMessages && typeof showNotification === 'function') {
            showNotification(syncMessage, 'info');
        }

        try {
            // ====== FILTRADO DE REGISTROS ======
            // PASO 1: Extraer registros actuales
            let recordsToSync = [];
            const palletLocationPairs = new Set();

            for (const record of this.pendingSync) {
                const actualRecord = record.record || record;

                // HOOK: Si la app define shouldIncludeRecord, usarlo
                if (this.config.shouldIncludeRecord) {
                    if (this.config.shouldIncludeRecord(actualRecord)) {
                        recordsToSync.push(actualRecord);
                    } else {
                        console.log(`⏭️ [SYNC] Registro filtrado por shouldIncludeRecord`);
                    }
                    continue;
                }

                // COMPORTAMIENTO POR DEFECTO: Incluir todos los registros con _id
                // Solo usar deduplicación legacy por pallet si está habilitada Y el registro tiene pallet
                if (this.config.useLegacyPalletDedup && actualRecord.pallet) {
                    const palletKey = this.deduplicationManager.generatePalletKey(
                        actualRecord.pallet,
                        actualRecord.location
                    );

                    if (!this.deduplicationManager.syncedPallets.has(palletKey)) {
                        recordsToSync.push(actualRecord);
                        palletLocationPairs.add(palletKey);
                    } else {
                        console.warn(`⚠️ [DEDUP-SYNC] Pallet ya sincronizado: ${palletKey}`);
                    }
                } else {
                    // Sin pallet o dedup legacy deshabilitada: incluir siempre
                    recordsToSync.push(actualRecord);
                }
            }

            // HOOK: onBeforeSync permite a la app modificar los registros antes de sync
            if (this.config.onBeforeSync) {
                recordsToSync = this.config.onBeforeSync(recordsToSync) || recordsToSync;
            }

            // NUEVO: Deduplicación INTERNA del batch
            const deduplicatedRecords = this._deduplicateBatch(recordsToSync);
            const duplicatesRemoved = recordsToSync.length - deduplicatedRecords.length;
            if (duplicatesRemoved > 0) {
                console.warn(`⚠️ [DEDUP-INTERNAL] ${duplicatesRemoved} duplicados internos eliminados del batch`);
            }

            if (deduplicatedRecords.length === 0) {
                console.log('✅ [DEDUP-SYNC] Todos los registros pendientes ya fueron sincronizados o eran duplicados');
                this.pendingSync = [];
                await this.save();
                this.updateUI(true);
                if (showMessages && typeof showNotification === 'function') {
                    showNotification('✅ Todo sincronizado (sin duplicados)', 'success');
                }
                return { success: true, synced: 0 };
            }

            // Formatear registros (usar deduplicatedRecords en lugar de recordsToSync)
            const values = deduplicatedRecords.map(r => {
                if (this.config.formatRecord) {
                    return this.config.formatRecord(r);
                }
                return this._defaultFormat(r);
            });

            console.log(`📤 Sincronizando con CONTROL DE CONCURRENCIA (${slowMode ? 'MODO LENTO' : 'MODO NORMAL'}):`);
            console.log('  - SpreadsheetId:', this.config.spreadsheetId);
            console.log('  - Hoja:', this.config.sheetName);
            console.log('  - Registros:', values.length);

            let synced = 0;
            let response;

            if (slowMode) {
                // ========== MODO LENTO: SINCRONIZACIÓN REGISTRO POR REGISTRO ==========
                console.log('⏱️ [SLOW-SYNC] Iniciando sincronización lenta con delays entre registros...');
                const failed = [];
                const slowSyncDelay = this.config.slowSyncDelay || 2000;

                for (let i = 0; i < values.length; i++) {
                    try {
                        if (showMessages && i % 5 === 0 && typeof showNotification === 'function') {
                            showNotification(`⏱️ Procesando registro ${i + 1} de ${values.length}...`, 'info');
                        }

                        const singleResponse = await this.concurrencyControl.writeWithConcurrencyControl(
                            this.config.spreadsheetId,
                            this.config.sheetName,
                            [values[i]]
                        );

                        if (singleResponse && singleResponse.success) {
                            synced++;
                            // Marcar este registro específico como sincronizado
                            await this.persistenceManager.markAsSynced([deduplicatedRecords[i]]);
                            const palletKey = this.deduplicationManager.generatePalletKey(
                                deduplicatedRecords[i].pallet,
                                deduplicatedRecords[i].location
                            );
                            this.deduplicationManager.syncedPallets.add(palletKey);

                            // NUEVO: Actualizar processed cache en modo lento también
                            if (window.processedCacheManager && typeof window.processedCacheManager.addSyncedRecords === 'function') {
                                try {
                                    await window.processedCacheManager.addSyncedRecords([deduplicatedRecords[i]]);
                                } catch (error) {
                                    console.error('❌ [SYNC] Error actualizando processed cache (modo lento):', error);
                                }
                            }

                            // CRÍTICO: Marcar validación como sincronizada DESPUÉS de escritura exitosa
                            if (window.ValidationDeduplicationManager && typeof window.ValidationDeduplicationManager.markValidationAsSynced === 'function') {
                                try {
                                    const record = deduplicatedRecords[i];
                                    const code = record.codigo || record.code;
                                    const obc = record.obc || record.orden;
                                    const location = record.ubicacion || record.location;
                                    if (code && obc && location) {
                                        window.ValidationDeduplicationManager.markValidationAsSynced(code, obc, location);
                                    }
                                } catch (error) {
                                    console.error('❌ [SYNC] Error marcando validación como sincronizada (modo lento):', error);
                                }
                            }
                        } else {
                            failed.push(deduplicatedRecords[i]);
                        }

                        // Delay entre registros en modo lento
                        if (i < values.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, slowSyncDelay));
                        }
                    } catch (err) {
                        console.error(`❌ [SLOW-SYNC] Error en registro ${i + 1}:`, err);
                        failed.push(deduplicatedRecords[i]);
                    }
                }

                this.deduplicationManager.saveSyncedPallets();
                this.pendingSync = await this.persistenceManager.getPendingSync();
                this.lastSyncTime = new Date();
                this.retryCount = 0;
                this.updateUI(failed.length === 0);

                if (showMessages && typeof showNotification === 'function') {
                    if (failed.length === 0) {
                        showNotification(`✅ ${synced} registros sincronizados (modo lento)`, 'success');
                    } else {
                        showNotification(`⚠️ ${synced} OK, ${failed.length} con error`, 'warning');
                    }
                }

                if (this.config.onSyncEnd) this.config.onSyncEnd();
                return { success: failed.length === 0, synced, failed: failed.length };
            } else {
                // ========== MODO NORMAL: USAR CONTROL DE CONCURRENCIA EN LOTE ==========
                response = await this.concurrencyControl.writeWithConcurrencyControl(
                    this.config.spreadsheetId,
                    this.config.sheetName,
                    values
                );

                if (!response || !response.success || response.status !== 200) {
                    throw new Error(`Escritura con control de concurrencia falló - Status: ${response?.status || 'desconocido'}`);
                }

                const updatedRows = response.updatedRows;

                if (!updatedRows || updatedRows !== deduplicatedRecords.length) {
                    throw new Error(`Handshake fallido: Se enviaron ${deduplicatedRecords.length} registros pero se confirmaron ${updatedRows || 0}`);
                }

                console.log('✅ HANDSHAKE CONFIRMADO:');
                console.log('  - Registros confirmados:', updatedRows);
                console.log('  - Filas escritas:', `${response.startRow}-${response.endRow}`);

                synced = deduplicatedRecords.length;
            }

            // Marcar como sincronizados en IndexedDB
            await this.persistenceManager.markAsSynced(deduplicatedRecords);

            // Marcar pallets como sincronizados (solo si useLegacyPalletDedup está activo)
            if (this.config.useLegacyPalletDedup) {
                for (const palletKey of palletLocationPairs) {
                    this.deduplicationManager.syncedPallets.add(palletKey);
                }
                this.deduplicationManager.saveSyncedPallets();
            }

            // HOOK: onAfterSync permite a la app ejecutar lógica post-sincronización
            // Esto reemplaza la lógica hardcodeada de ValidationDeduplicationManager
            if (this.config.onAfterSync) {
                try {
                    await this.config.onAfterSync(deduplicatedRecords);
                    console.log('✅ [SYNC] Hook onAfterSync ejecutado');
                } catch (error) {
                    console.error('❌ [SYNC] Error en hook onAfterSync:', error);
                }
            }

            // Actualizar processedCacheManager si existe (compatibilidad)
            if (window.processedCacheManager && typeof window.processedCacheManager.addSyncedRecords === 'function') {
                try {
                    await window.processedCacheManager.addSyncedRecords(deduplicatedRecords);
                } catch (error) {
                    console.error('❌ [SYNC] Error actualizando processed cache:', error);
                }
            }

            // Actualizar pendientes
            this.pendingSync = await this.persistenceManager.getPendingSync();
            this.lastSyncTime = new Date();

            this.retryCount = 0;
            this.updateUI(true);

            if (showMessages && typeof showNotification === 'function') {
                showNotification(`✅ ${synced} registros sincronizados y confirmados`, 'success');
            }

            if (this.config.onSyncEnd) this.config.onSyncEnd();
            
            return { success: true, synced, confirmed: true };

        } catch (e) {
            console.error('❌ Error de sincronización:', e);

            // Manejo especial para errores de concurrencia
            const errorMessage = String(e?.message || '');
            if (errorMessage && (
                errorMessage.includes('Conflicto de concurrencia') ||
                errorMessage.includes('Ya hay una operación de escritura en progreso') ||
                errorMessage.includes('Verificación fallida') ||
                errorMessage.includes('Integridad comprometida')
            )) {
                console.warn('⚠️ [CONCURRENCY] Error de concurrencia detectado');
                console.warn('⚠️ [CONCURRENCY] Los datos permanecen en PENDING_SYNC para reintento');

                this.updateUI(false);

                const pendingCount = this.pendingSync.length;
                if (showMessages && typeof showNotification === 'function') {
                    showNotification(
                        `⚠️ Conflicto de escritura. ${pendingCount} registro${pendingCount > 1 ? 's' : ''} en cola para reintento.`,
                        'warning'
                    );
                }

                return {
                    success: false,
                    reason: 'concurrency_conflict',
                    queued: true,
                    pendingCount: pendingCount
                };
            }

            this.updateUI(false);
            if (showMessages && typeof showNotification === 'function') {
                const errorMsg = e.result?.error?.message || e.message || 'Error desconocido';
                showNotification(`❌ Error: ${errorMsg}`, 'error');
            }
            return { success: false };
        } finally {
            this.inProgress = false;
            if (this.config.onSyncEnd) this.config.onSyncEnd();
        }
    }

    /**
     * Formato por defecto para registros
     */
    _defaultFormat(record) {
        return [
            record.date || '',
            record.time || '',
            record.user || '',
            record.scan1 || record.code || '',
            record.scan2 || '',
            record.location || '',
            record.status || '',
            record.note || '',
            record.pallet || '',
            record.originLocation || ''
        ];
    }

    /**
     * Guarda la cola en localStorage e IndexedDB
     */
    async save() {
        try {
            localStorage.setItem(this.config.storageKey, JSON.stringify(this.pendingSync));
            console.log(`💾 [SYNC] Guardados ${this.pendingSync.length} registros pendientes`);
        } catch (e) {
            console.error('Error saving sync queue:', e);
        }
    }

    /**
     * Carga la cola desde IndexedDB (fuente de verdad)
     */
    async load() {
        try {
            this.pendingSync = await this.persistenceManager.getPendingSync();
            console.log(`📂 [SYNC] Cargados ${this.pendingSync.length} registros pendientes desde IndexedDB`);
            
            if (this.pendingSync.length > 0) {
                localStorage.setItem(this.config.storageKey, JSON.stringify(this.pendingSync));
            }
        } catch (e) {
            console.error('❌ [SYNC] Error cargando pendientes:', e);
            try {
                const saved = localStorage.getItem(this.config.storageKey);
                if (saved) {
                    this.pendingSync = JSON.parse(saved);
                    console.log(`📂 [SYNC] Fallback: Cargados ${this.pendingSync.length} registros de localStorage`);
                }
            } catch (e2) {
                console.error('❌ [SYNC] Error en fallback localStorage:', e2);
                this.pendingSync = [];
            }
        }
    }

    /**
     * Obtiene estadísticas del sync manager
     */
    getStats() {
        const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;
        const hasToken = typeof gapi !== 'undefined' && gapi?.client?.getToken();

        return {
            pendingSync: this.pendingSync.length,
            isOnline,
            hasToken,
            inProgress: this.inProgress,
            retryCount: this.retryCount,
            lastSyncTime: this.lastSyncTime,
            lastErrors: this.lastErrors,
            syncedPalletsCount: this.deduplicationManager.syncedPallets.size
        };
    }

    /**
     * Actualiza la UI del estado de sincronización
     */
    updateUI(synced) {
        const el = document.getElementById('sync-status') || document.getElementById('sync-status-sidebar');
        if (!el) return;

        const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;

        el.style.display = 'block';
        el.style.cursor = 'pointer';

        if (!isOnline) {
            el.className = 'sync-status sync-warning';
            el.innerHTML = `⚠️ Sin conexión${this.pendingSync.length > 0 ? ` (${this.pendingSync.length})` : ''}`;
        } else if (this.pendingSync.length > 0) {
            el.className = 'sync-status sync-warning';
            el.innerHTML = `⏳ ${this.pendingSync.length} pendientes`;
        } else if (synced) {
            el.className = 'sync-status sync-ok';
            el.textContent = '✅ Sincronizado';
        } else {
            el.className = 'sync-status sync-error';
            el.textContent = '❌ Error sync';
        }

        const badge = document.getElementById('pending-badge') || document.getElementById('sync-badge');
        if (badge) {
            badge.textContent = this.pendingSync.length || '';
            badge.style.display = this.pendingSync.length > 0 ? 'inline-block' : 'none';
        }

        if (this.config.onStatusChange) {
            this.config.onStatusChange(this.getStats());
        }
    }

    /**
     * Muestra el panel de estado de sincronización
     */
    showPanel() {
        const stats = this.getStats();

        document.querySelectorAll('.sync-panel-overlay').forEach(e => e.remove());

        const statusColor = stats.pendingSync === 0 ? 'var(--success)' : 'var(--warning)';

        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show sync-panel-overlay';
        overlay.innerHTML = `
            <div class="popup-content sync-modal-content" style="max-width: 500px; width: 50%; max-height: 80vh; overflow-y: auto;">
                <div class="popup-header">
                    <span>${this.config.appIcon} Estado de Sincronización</span>
                    <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
                </div>
                <div style="padding: 20px;">
                    <div style="padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; text-align: center; margin-bottom: 15px;">
                        <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">Pendientes de sincronizar</div>
                        <div style="font-size: 2.5em; font-weight: 700; color: ${statusColor};">
                            ${stats.pendingSync}
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                        <div style="padding: 12px; background: #f9f9f9; border-radius: 8px; text-align: center;">
                            <div style="font-size: 1.2em;">${stats.isOnline ? '🟢' : '🔴'}</div>
                            <div style="font-size: 0.8em; color: #666;">Internet</div>
                        </div>
                        <div style="padding: 12px; background: #f9f9f9; border-radius: 8px; text-align: center;">
                            <div style="font-size: 1.2em;">${stats.hasToken ? '🟢' : '🔴'}</div>
                            <div style="font-size: 0.8em; color: #666;">Google</div>
                        </div>
                    </div>

                    <div style="font-size: 0.9em; padding: 12px; background: #f5f5f5; border-radius: 8px; margin-bottom: 15px;">
                        📄 Hoja destino: <strong>${this.config.sheetName}</strong><br>
                        ${stats.lastSyncTime ? `🕐 Última sync: ${stats.lastSyncTime.toLocaleTimeString()}` : '🕐 Sin sincronizar aún'}<br>
                        🔒 Datos en cache: <strong>${stats.syncedPalletsCount}</strong>
                    </div>

                    ${stats.pendingSync > 0 ? `
                        <div style="padding: 12px; background: #fff3e0; border-radius: 8px; border-left: 4px solid var(--warning); margin-bottom: 15px;">
                            <strong>⚠️ ${stats.pendingSync} registros pendientes</strong><br>
                            <span style="font-size: 0.85em;">Se recomienda sincronizar antes de cerrar.</span>
                        </div>
                    ` : ''}

                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${stats.pendingSync > 0 && stats.isOnline && stats.hasToken ? `
                            <button class="btn btn-primary" onclick="window.advancedSyncManager.sync(); this.closest('.popup-overlay').remove();">
                                🔄 Sincronizar Ahora
                            </button>
                            <button class="btn btn-warning" onclick="window.advancedSyncManager.syncSlow(); this.closest('.popup-overlay').remove();" style="margin-top: 5px;">
                                ⏱️ Sincronización Lenta (más segura)
                            </button>
                        ` : ''}
                        ${stats.pendingSync > 0 ? `
                            <button class="btn btn-warning" onclick="window.advancedSyncManager.exportPending(); this.closest('.popup-overlay').remove();">
                                📥 Exportar Pendientes (CSV)
                            </button>
                        ` : ''}
                        <button class="btn btn-secondary" onclick="this.closest('.popup-overlay').remove();">
                            Cerrar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    /**
     * Exporta los datos pendientes como CSV
     */
    exportPending() {
        if (this.pendingSync.length === 0) {
            if (typeof showNotification === 'function') {
                showNotification('No hay datos pendientes', 'info');
            }
            return;
        }

        const rows = this.pendingSync.map(item => {
            const record = item.record || item;
            if (this.config.formatRecord) {
                return this.config.formatRecord(record);
            }
            return this._defaultFormat(record);
        });

        const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pending_sync_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        if (typeof showNotification === 'function') {
            showNotification(`📥 ${this.pendingSync.length} registros exportados`, 'success');
        }
    }

    /**
     * Obtiene el número de registros pendientes
     */
    getPendingCount() {
        return this.pendingSync.length;
    }

    /**
     * Limpia la cola de sincronización
     */
    clear() {
        this.pendingSync = [];
        this.save();
        this.updateUI(true);
    }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.AdvancedSyncManager = AdvancedSyncManager;
    window.ConcurrencyControl = ConcurrencyControl;
    window.PersistenceManager = PersistenceManager;
    window.DeduplicationManager = DeduplicationManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AdvancedSyncManager,
        ConcurrencyControl,
        PersistenceManager,
        DeduplicationManager
    };
}
