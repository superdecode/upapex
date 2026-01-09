/**
 * DISPATCH-SYNC-MANAGER.JS
 * Sistema de sincronización optimizado para Dispatch - Multiusuario
 * 
 * @version 1.0.0
 * @description Implementa:
 * - Push Inmediato: Escrituras sin espera
 * - Polling 30s: BD operativa (datos críticos)
 * - Caché 30min: BDs de referencia/consulta
 * - Bloqueo Optimista: Control de concurrencia multiusuario
 * - Background Sync: Sin bloquear UI
 */

class DispatchSyncManager {
    constructor(config = {}) {
        // Configuración principal
        this.config = {
            spreadsheetId: config.spreadsheetId || '',
            sheetName: config.sheetName || 'BD',
            appName: config.appName || 'Dispatch',
            storageKey: config.storageKey || 'dispatch_pending_sync',
            formatRecord: config.formatRecord || null,
            onSyncStart: config.onSyncStart || null,
            onSyncEnd: config.onSyncEnd || null,
            onDataUpdate: config.onDataUpdate || null,
            onConflict: config.onConflict || null,
            ...config
        };

        // Estado interno
        this.pendingSync = [];
        this.inProgress = false;
        this.initialized = false;
        
        // Intervalos de polling
        this.operationalPollingInterval = null;  // 30s para BD operativa
        this.referencePollingInterval = null;    // 30min para BDs de referencia
        
        // Caché de datos
        this.cache = {
            operational: {
                data: null,
                lastUpdate: null,
                version: 0
            },
            reference: {
                validacion: { data: null, lastUpdate: null },
                mne: { data: null, lastUpdate: null },
                trs: { data: null, lastUpdate: null },
                listas: { data: null, lastUpdate: null }
            }
        };
        
        // Control de concurrencia
        this.lockManager = new OptimisticLockManager();
        
        // Configuración de tiempos
        this.OPERATIONAL_POLL_INTERVAL = 30000;   // 30 segundos
        this.REFERENCE_CACHE_DURATION = 1800000;  // 30 minutos
        
        // Estado de conexión
        this.isOnline = navigator.onLine;
        
        // Worker para background sync (si está disponible)
        this.useBackgroundSync = typeof Worker !== 'undefined';
    }

    /**
     * Inicializa el Sync Manager
     */
    async init() {
        if (this.initialized) return;

        // Cargar cola pendiente de localStorage
        this.loadPendingQueue();
        
        // Configurar listeners de conexión
        this.setupConnectionListeners();
        
        // Configurar protección de salida
        this.setupExitProtection();
        
        // Iniciar polling operacional (30s)
        this.startOperationalPolling();
        
        // Iniciar caché de referencia (30min)
        this.startReferenceCaching();
        
        // Sincronizar pendientes si hay conexión
        if (this.isOnline && this.pendingSync.length > 0) {
            await this.flushPendingQueue();
        }
        
        this.initialized = true;
        console.log(`✅ [DISPATCH-SYNC] Inicializado con polling operacional cada ${this.OPERATIONAL_POLL_INTERVAL/1000}s`);
    }

    // ==================== PUSH INMEDIATO (ESCRITURA) ====================
    
    /**
     * Envía un registro inmediatamente a la BD (sin cola)
     * @param {Object} record - Registro a enviar
     * @returns {Promise<Object>} - Resultado de la operación
     */
    async pushImmediate(record) {
        if (!this.isOnline) {
            // Sin conexión: agregar a cola y guardar localmente
            console.log('📴 [PUSH] Sin conexión - Guardando en cola local');
            this.addToPendingQueue(record);
            return { success: false, queued: true, message: 'Guardado localmente' };
        }

        if (!gapi?.client?.getToken()) {
            console.log('🔐 [PUSH] Sin token - Guardando en cola local');
            this.addToPendingQueue(record);
            return { success: false, queued: true, message: 'Sin autenticación' };
        }

        // Agregar versión para bloqueo optimista
        record._version = Date.now();
        record._clientId = this.getClientId();

        try {
            if (this.config.onSyncStart) this.config.onSyncStart();
            
            // Formatear registro
            const values = this.config.formatRecord 
                ? [this.config.formatRecord(record)]
                : [this.defaultFormat(record)];

            console.log('📤 [PUSH] Enviando inmediatamente:', record.orden || record.folio);

            // Enviar sin esperar cola - PUSH DIRECTO
            const response = await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:R`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values }
            });

            if (response.status === 200) {
                console.log('✅ [PUSH] Registro enviado exitosamente');
                
                // Actualizar versión local del caché
                this.cache.operational.version++;
                
                if (this.config.onSyncEnd) this.config.onSyncEnd();
                return { success: true, response };
            } else {
                throw new Error(`Status ${response.status}`);
            }
        } catch (error) {
            console.error('❌ [PUSH] Error enviando:', error);
            
            // En caso de error, agregar a cola para reintento
            this.addToPendingQueue(record);
            
            if (this.config.onSyncEnd) this.config.onSyncEnd();
            return { success: false, queued: true, error: error.message };
        }
    }

    /**
     * Actualiza un registro existente con bloqueo optimista
     * @param {string} rowIndex - Índice de fila a actualizar
     * @param {Object} record - Datos actualizados
     * @param {number} expectedVersion - Versión esperada para validar concurrencia
     */
    async updateWithLock(rowIndex, record, expectedVersion) {
        if (!this.isOnline || !gapi?.client?.getToken()) {
            return { success: false, message: 'Sin conexión o autenticación' };
        }

        try {
            // PASO 1: Leer versión actual (Read)
            const currentData = await this.readRow(rowIndex);
            const currentVersion = this.extractVersion(currentData);

            // PASO 2: Validar versión (Verify)
            if (currentVersion !== expectedVersion) {
                console.warn('⚠️ [LOCK] Conflicto de versión detectado');
                
                // Notificar conflicto
                if (this.config.onConflict) {
                    this.config.onConflict({
                        type: 'VERSION_MISMATCH',
                        expected: expectedVersion,
                        actual: currentVersion,
                        localData: record,
                        remoteData: currentData
                    });
                }
                
                return { 
                    success: false, 
                    conflict: true, 
                    message: 'Registro modificado por otro usuario',
                    remoteData: currentData
                };
            }

            // PASO 3: Escribir con nueva versión (Write)
            record._version = Date.now();
            record._lastModifiedBy = this.getClientId();

            const values = this.config.formatRecord 
                ? [this.config.formatRecord(record)]
                : [this.defaultFormat(record)];

            const response = await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A${rowIndex}:R${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: { values }
            });

            if (response.status === 200) {
                console.log('✅ [LOCK] Actualización exitosa con bloqueo optimista');
                return { success: true };
            }

            throw new Error(`Status ${response.status}`);
        } catch (error) {
            console.error('❌ [LOCK] Error en actualización:', error);
            return { success: false, error: error.message };
        }
    }

    // ==================== POLLING OPERACIONAL (30s) ====================

    /**
     * Inicia el polling de datos operativos cada 30 segundos
     */
    startOperationalPolling() {
        if (this.operationalPollingInterval) {
            clearInterval(this.operationalPollingInterval);
        }

        console.log('🔄 [POLLING] Iniciando polling operacional (30s)');

        // Polling cada 30 segundos
        this.operationalPollingInterval = setInterval(async () => {
            if (this.isOnline && !this.inProgress) {
                await this.pollOperationalData();
            }
        }, this.OPERATIONAL_POLL_INTERVAL);

        // Ejecutar inmediatamente la primera vez
        if (this.isOnline) {
            this.pollOperationalData();
        }
    }

    /**
     * Detiene el polling operacional
     */
    stopOperationalPolling() {
        if (this.operationalPollingInterval) {
            clearInterval(this.operationalPollingInterval);
            this.operationalPollingInterval = null;
            console.log('⏹️ [POLLING] Polling operacional detenido');
        }
    }

    /**
     * Ejecuta una consulta de datos operativos (BD principal)
     */
    async pollOperationalData() {
        if (!gapi?.client?.getToken()) return;

        try {
            console.log('🔍 [POLLING] Consultando BD operativa...');
            
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:R`
            });

            const rows = response.result.values || [];
            const newVersion = rows.length; // Usar cantidad de filas como indicador de versión

            // Detectar cambios
            if (newVersion !== this.cache.operational.version) {
                console.log(`📊 [POLLING] Cambios detectados: ${this.cache.operational.version} → ${newVersion}`);
                
                // Actualizar caché
                this.cache.operational.data = rows;
                this.cache.operational.version = newVersion;
                this.cache.operational.lastUpdate = Date.now();

                // Notificar cambios a la UI
                if (this.config.onDataUpdate) {
                    // Ejecutar en siguiente tick para no bloquear
                    setTimeout(() => {
                        this.config.onDataUpdate({
                            type: 'OPERATIONAL',
                            data: rows,
                            version: newVersion
                        });
                    }, 0);
                }
            } else {
                console.log('✓ [POLLING] Sin cambios en BD operativa');
            }
        } catch (error) {
            console.error('❌ [POLLING] Error consultando BD operativa:', error);
        }
    }

    /**
     * Fuerza una actualización inmediata de datos operativos
     */
    async forceOperationalRefresh() {
        console.log('🔄 [POLLING] Forzando actualización de BD operativa...');
        await this.pollOperationalData();
    }

    // ==================== CACHÉ DE REFERENCIA (30min) ====================

    /**
     * Inicia el sistema de caché para BDs de referencia
     */
    startReferenceCaching() {
        if (this.referencePollingInterval) {
            clearInterval(this.referencePollingInterval);
        }

        console.log('📦 [CACHE] Iniciando caché de referencia (30min)');

        // Actualizar cada 30 minutos
        this.referencePollingInterval = setInterval(async () => {
            if (this.isOnline) {
                await this.refreshReferenceData();
            }
        }, this.REFERENCE_CACHE_DURATION);
    }

    /**
     * Detiene el caché de referencia
     */
    stopReferenceCaching() {
        if (this.referencePollingInterval) {
            clearInterval(this.referencePollingInterval);
            this.referencePollingInterval = null;
        }
    }

    /**
     * Obtiene datos de referencia (usa caché si está vigente)
     * @param {string} source - Nombre de la fuente (validacion, mne, trs, listas)
     * @param {string} url - URL de la fuente CSV
     * @param {boolean} forceRefresh - Forzar actualización ignorando caché
     */
    async getReferenceData(source, url, forceRefresh = false) {
        const cached = this.cache.reference[source];
        const now = Date.now();

        // Verificar si el caché es válido (menos de 30 min)
        if (!forceRefresh && cached.data && cached.lastUpdate) {
            const age = now - cached.lastUpdate;
            if (age < this.REFERENCE_CACHE_DURATION) {
                console.log(`📦 [CACHE] Usando caché de ${source} (edad: ${Math.round(age/1000)}s)`);
                return cached.data;
            }
        }

        // Caché expirado o forzado - obtener datos frescos
        try {
            console.log(`🔄 [CACHE] Actualizando ${source}...`);
            const response = await fetch(url);
            const data = await response.text();

            // Actualizar caché
            this.cache.reference[source] = {
                data: data,
                lastUpdate: now
            };

            console.log(`✅ [CACHE] ${source} actualizado`);
            return data;
        } catch (error) {
            console.error(`❌ [CACHE] Error actualizando ${source}:`, error);
            // Retornar caché antiguo si existe
            return cached.data || null;
        }
    }

    /**
     * Actualiza todas las BDs de referencia (disparador manual)
     */
    async refreshReferenceData() {
        console.log('🔄 [CACHE] Actualizando todas las BDs de referencia...');
        
        const sources = CONFIG?.SOURCES || {};
        const results = {};

        for (const [key, url] of Object.entries(sources)) {
            const sourceKey = key.toLowerCase();
            if (this.cache.reference[sourceKey] !== undefined) {
                results[sourceKey] = await this.getReferenceData(sourceKey, url, true);
            }
        }

        console.log('✅ [CACHE] BDs de referencia actualizadas');
        return results;
    }

    /**
     * Invalida el caché de una fuente específica
     */
    invalidateCache(source) {
        if (this.cache.reference[source]) {
            this.cache.reference[source].lastUpdate = null;
            console.log(`🗑️ [CACHE] Caché de ${source} invalidado`);
        }
    }

    // ==================== COLA DE PENDIENTES ====================

    /**
     * Agrega un registro a la cola de pendientes
     */
    addToPendingQueue(record) {
        record._queuedAt = Date.now();
        record._clientId = this.getClientId();
        
        this.pendingSync.push(record);
        this.savePendingQueue();
        
        console.log(`📥 [QUEUE] Registro agregado a cola (${this.pendingSync.length} pendientes)`);
    }

    /**
     * Procesa y envía todos los registros pendientes
     */
    async flushPendingQueue() {
        if (this.pendingSync.length === 0) {
            console.log('✓ [QUEUE] Cola vacía');
            return { success: true, processed: 0 };
        }

        if (!this.isOnline || !gapi?.client?.getToken()) {
            console.log('📴 [QUEUE] Sin conexión - Cola pendiente');
            return { success: false, pending: this.pendingSync.length };
        }

        console.log(`🔄 [QUEUE] Procesando ${this.pendingSync.length} registros pendientes...`);
        
        this.inProgress = true;
        let processed = 0;
        let errors = 0;
        const toRetry = [];

        for (const record of this.pendingSync) {
            try {
                const values = this.config.formatRecord 
                    ? [this.config.formatRecord(record)]
                    : [this.defaultFormat(record)];

                await gapi.client.sheets.spreadsheets.values.append({
                    spreadsheetId: this.config.spreadsheetId,
                    range: `${this.config.sheetName}!A:R`,
                    valueInputOption: 'USER_ENTERED',
                    insertDataOption: 'INSERT_ROWS',
                    resource: { values }
                });

                processed++;
            } catch (error) {
                console.error('❌ [QUEUE] Error procesando registro:', error);
                toRetry.push(record);
                errors++;
            }
        }

        // Actualizar cola con los que fallaron
        this.pendingSync = toRetry;
        this.savePendingQueue();
        
        this.inProgress = false;

        console.log(`✅ [QUEUE] Procesados: ${processed}, Errores: ${errors}, Pendientes: ${toRetry.length}`);
        return { success: errors === 0, processed, errors, pending: toRetry.length };
    }

    /**
     * Guarda la cola en localStorage
     */
    savePendingQueue() {
        try {
            localStorage.setItem(this.config.storageKey, JSON.stringify(this.pendingSync));
        } catch (e) {
            console.error('❌ [QUEUE] Error guardando cola:', e);
        }
    }

    /**
     * Carga la cola desde localStorage
     */
    loadPendingQueue() {
        try {
            const saved = localStorage.getItem(this.config.storageKey);
            if (saved) {
                this.pendingSync = JSON.parse(saved);
                console.log(`📥 [QUEUE] Cargados ${this.pendingSync.length} registros pendientes`);
            }
        } catch (e) {
            console.error('❌ [QUEUE] Error cargando cola:', e);
            this.pendingSync = [];
        }
    }

    // ==================== UTILIDADES ====================

    /**
     * Genera un ID único de cliente para identificar sesiones
     */
    getClientId() {
        let clientId = sessionStorage.getItem('dispatch_client_id');
        if (!clientId) {
            clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            sessionStorage.setItem('dispatch_client_id', clientId);
        }
        return clientId;
    }

    /**
     * Lee una fila específica de la hoja
     */
    async readRow(rowIndex) {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: this.config.spreadsheetId,
            range: `${this.config.sheetName}!A${rowIndex}:R${rowIndex}`
        });
        return response.result.values?.[0] || null;
    }

    /**
     * Extrae la versión de un registro
     */
    extractVersion(rowData) {
        // La versión puede estar en una columna específica o usar timestamp
        // Por defecto, usar la fecha/hora como indicador de versión
        if (!rowData) return 0;
        const fecha = rowData[1] || '';
        const hora = rowData[2] || '';
        return `${fecha}_${hora}`;
    }

    /**
     * Formato por defecto para registros
     */
    defaultFormat(record) {
        return [
            record.folio || '',
            record.fecha || '',
            record.hora || '',
            record.usuario || '',
            record.orden || '',
            record.destino || '',
            record.horario || '',
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
    }

    /**
     * Configura listeners de conexión
     */
    setupConnectionListeners() {
        window.addEventListener('online', () => {
            console.log('🟢 [SYNC] Conexión restaurada');
            this.isOnline = true;
            this.startOperationalPolling();
            this.flushPendingQueue();
        });

        window.addEventListener('offline', () => {
            console.log('🔴 [SYNC] Sin conexión');
            this.isOnline = false;
            this.stopOperationalPolling();
        });
    }

    /**
     * Configura protección de salida
     */
    setupExitProtection() {
        window.addEventListener('beforeunload', (e) => {
            if (this.pendingSync.length > 0) {
                e.preventDefault();
                e.returnValue = `¡Tienes ${this.pendingSync.length} registros sin sincronizar! ¿Seguro que quieres salir?`;
                return e.returnValue;
            }
        });
    }

    /**
     * Obtiene estadísticas del sync manager
     */
    getStats() {
        return {
            pendingSync: this.pendingSync.length,
            isOnline: this.isOnline,
            hasToken: !!gapi?.client?.getToken(),
            inProgress: this.inProgress,
            operationalCacheAge: this.cache.operational.lastUpdate 
                ? Math.round((Date.now() - this.cache.operational.lastUpdate) / 1000) 
                : null,
            operationalVersion: this.cache.operational.version
        };
    }

    /**
     * Destructor - limpia intervalos
     */
    destroy() {
        this.stopOperationalPolling();
        this.stopReferenceCaching();
        console.log('🗑️ [SYNC] DispatchSyncManager destruido');
    }
}

// ==================== OPTIMISTIC LOCK MANAGER ====================

/**
 * Gestor de bloqueo optimista para control de concurrencia
 */
class OptimisticLockManager {
    constructor() {
        this.locks = new Map();
        this.LOCK_TIMEOUT = 60000; // 1 minuto
    }

    /**
     * Intenta adquirir un bloqueo sobre un registro
     * @param {string} recordId - ID del registro
     * @param {string} clientId - ID del cliente
     */
    acquireLock(recordId, clientId) {
        const existing = this.locks.get(recordId);
        const now = Date.now();

        // Si existe un bloqueo activo de otro cliente
        if (existing && existing.clientId !== clientId) {
            if (now - existing.timestamp < this.LOCK_TIMEOUT) {
                return { 
                    success: false, 
                    lockedBy: existing.clientId,
                    lockedAt: existing.timestamp
                };
            }
            // Bloqueo expirado, se puede tomar
        }

        // Adquirir bloqueo
        this.locks.set(recordId, {
            clientId,
            timestamp: now
        });

        return { success: true };
    }

    /**
     * Libera un bloqueo
     */
    releaseLock(recordId, clientId) {
        const existing = this.locks.get(recordId);
        if (existing && existing.clientId === clientId) {
            this.locks.delete(recordId);
            return true;
        }
        return false;
    }

    /**
     * Verifica si un registro está bloqueado
     */
    isLocked(recordId, excludeClientId = null) {
        const existing = this.locks.get(recordId);
        if (!existing) return false;
        
        if (excludeClientId && existing.clientId === excludeClientId) {
            return false;
        }

        const now = Date.now();
        if (now - existing.timestamp >= this.LOCK_TIMEOUT) {
            this.locks.delete(recordId);
            return false;
        }

        return true;
    }

    /**
     * Limpia bloqueos expirados
     */
    cleanup() {
        const now = Date.now();
        for (const [recordId, lock] of this.locks.entries()) {
            if (now - lock.timestamp >= this.LOCK_TIMEOUT) {
                this.locks.delete(recordId);
            }
        }
    }
}

// ==================== EXPORTAR ====================

if (typeof window !== 'undefined') {
    window.DispatchSyncManager = DispatchSyncManager;
    window.OptimisticLockManager = OptimisticLockManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DispatchSyncManager, OptimisticLockManager };
}
