/**
 * PROCESSED-CACHE-MANAGER.JS
 * Sistema de cache para datos procesados del servidor
 * Migrado desde scan.html para uso compartido
 *
 * @version 1.0.0
 * @description Gestión de cache con:
 * - Lazy loading desde servidor
 * - Normalización de códigos
 * - Validación dual (local + servidor)
 * - Auto-sync periódico
 * - Persistencia en IndexedDB
 */

class ProcessedCacheManager {
    constructor(config = {}) {
        this.config = {
            spreadsheetId: config.spreadsheetId || '',
            sheetName: config.sheetName || 'BD',
            syncInterval: config.syncInterval || 60 * 60 * 1000, // 1 hora
            dbName: config.dbName || 'ProcessedBoxesDB',
            storeName: config.storeName || 'boxes',
            ...config
        };

        this.processedBoxesMap = new Map();
        this.lastUpdate = null;
        this.db = null;
        this.intervalId = null;
        this.isLoading = false;
    }

    /**
     * Limpieza profunda de códigos - elimina caracteres invisibles y normaliza
     */
    cleanCode(code) {
        if (code === null || code === undefined) return '';
        return code
            .toString()
            .replace(/[\u200B\uFEFF\u00A0\u2000-\u200F\u2028\u2029]/g, '') // Caracteres invisibles
            .replace(/[\r\n\t]/g, '') // Saltos de línea y tabs
            .trim()
            .toUpperCase();
    }

    /**
     * Inicializa el gestor de cache
     */
    async init() {
        await this.openDatabase();
        await this.loadFromIndexedDB();
        this.startAutoSync();
        console.log(`📦 [PROCESSED-CACHE] Inicializado con ${this.processedBoxesMap.size} cajas procesadas`);
    }

    /**
     * Abre la base de datos IndexedDB
     */
    async openDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.config.dbName, 1);
            
            request.onerror = () => {
                console.error('❌ [PROCESSED-CACHE] Error abriendo IndexedDB');
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.config.storeName)) {
                    db.createObjectStore(this.config.storeName, { keyPath: 'key' });
                }
            };
        });
    }

    /**
     * Carga datos desde IndexedDB
     */
    async loadFromIndexedDB() {
        if (!this.db) return;
        
        try {
            // Cargar datos de cajas procesadas
            const dataResult = await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.config.storeName], 'readonly');
                const store = transaction.objectStore(this.config.storeName);
                const request = store.get('processedBoxes');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            if (dataResult?.value) {
                const entries = dataResult.value;
                this.processedBoxesMap = new Map();
                for (const [key, value] of entries) {
                    const cleanKey = this.cleanCode(key);
                    if (cleanKey && cleanKey.length > 0) {
                        this.processedBoxesMap.set(cleanKey, value);
                    }
                }
                console.log(`📂 [PROCESSED-CACHE] Cargadas ${this.processedBoxesMap.size} cajas desde IndexedDB (normalizadas)`);
            }
            
            // Cargar timestamp de última actualización
            const timestampResult = await new Promise((resolve, reject) => {
                const transaction = this.db.transaction([this.config.storeName], 'readonly');
                const store = transaction.objectStore(this.config.storeName);
                const request = store.get('lastUpdate');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            
            if (timestampResult?.value) {
                this.lastUpdate = new Date(timestampResult.value);
            }
        } catch (error) {
            console.error('❌ [PROCESSED-CACHE] Error cargando desde IndexedDB:', error);
        }
    }

    /**
     * Guarda datos en IndexedDB
     */
    async saveToIndexedDB() {
        if (!this.db) return;
        
        try {
            const transaction = this.db.transaction([this.config.storeName], 'readwrite');
            const store = transaction.objectStore(this.config.storeName);
            
            const entries = [...this.processedBoxesMap.entries()];
            store.put({ key: 'processedBoxes', value: entries });
            store.put({ key: 'lastUpdate', value: Date.now() });
            
            await new Promise((resolve, reject) => {
                transaction.oncomplete = resolve;
                transaction.onerror = reject;
            });
            
            console.log(`💾 [PROCESSED-CACHE] Guardadas ${this.processedBoxesMap.size} cajas en IndexedDB`);
        } catch (error) {
            console.error('❌ [PROCESSED-CACHE] Error guardando en IndexedDB:', error);
        }
    }

    /**
     * Inicia sincronización automática periódica
     */
    startAutoSync() {
        if (this.intervalId) clearInterval(this.intervalId);
        
        this.intervalId = setInterval(() => {
            const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;
            if (isOnline && gapi?.client?.getToken()) {
                this.syncFromServer(false);
            }
        }, this.config.syncInterval);
        
        console.log(`✅ [PROCESSED-CACHE] Auto-sync iniciado - Intervalo: ${this.config.syncInterval}ms`);
    }

    /**
     * Detiene sincronización automática
     */
    stopAutoSync() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    /**
     * Sincroniza datos desde el servidor
     */
    async syncFromServer(showNotification = true) {
        if (this.isLoading) {
            console.log('⏳ [PROCESSED-CACHE] Sincronización ya en progreso...');
            return;
        }

        const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;
        if (!isOnline || !gapi?.client?.getToken()) {
            console.log('⚠️ [PROCESSED-CACHE] Sin conexión o sin token');
            return;
        }

        this.isLoading = true;
        if (showNotification && typeof window.showNotification === 'function') {
            window.showNotification('🔄 Sincronizando cajas procesadas...', 'info');
        }

        try {
            // Descargar columnas ligeras: D(scan1), E(scan2), I(pallet), A(fecha), B(hora), C(usuario), F(location)
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:I`
            });

            const rows = response.result.values || [];
            this.processedBoxesMap.clear();

            // Saltar header (fila 0)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                if (!row || !row[3]) continue; // Columna D (scan1) es requerida

                const scan1 = this.cleanCode(row[3]);
                const scan2 = this.cleanCode(row[4]);
                const pallet = row[8]?.toString().trim() || '';
                const date = row[0]?.toString().trim() || '';
                const time = row[1]?.toString().trim() || '';
                const user = row[2]?.toString().trim() || '';
                const location = row[5]?.toString().trim() || '';

                if (scan1 && scan1.length > 0) {
                    const boxData = {
                        scan1,
                        scan2,
                        pallet,
                        date,
                        time,
                        user,
                        location
                    };

                    this.processedBoxesMap.set(scan1, boxData);

                    // También indexar por scan2 si existe y es diferente
                    if (scan2 && scan2.length > 0 && scan2 !== scan1) {
                        this.processedBoxesMap.set(scan2, boxData);
                    }
                }
            }

            this.lastUpdate = new Date();
            await this.saveToIndexedDB();

            console.log(`✅ [PROCESSED-CACHE] Sincronizadas ${this.processedBoxesMap.size} cajas del servidor`);
            if (showNotification && typeof window.showNotification === 'function') {
                window.showNotification(`✅ ${this.processedBoxesMap.size} cajas procesadas cargadas`, 'success');
            }
        } catch (error) {
            console.error('❌ [PROCESSED-CACHE] Error sincronizando desde servidor:', error);
            if (showNotification && typeof window.showNotification === 'function') {
                window.showNotification('❌ Error sincronizando cajas procesadas', 'error');
            }
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Busca una caja en los registros procesados del servidor
     */
    findInProcessed(code) {
        const normalizedCode = this.cleanCode(code);
        if (!normalizedCode || normalizedCode.length === 0) return null;
        
        const result = this.processedBoxesMap.get(normalizedCode);
        if (result) {
            console.log(`🔍 [PROCESSED-CACHE] Encontrado en cache: ${normalizedCode}`);
        }
        return result || null;
    }

    /**
     * Busca una caja en registros pendientes de sincronización
     */
    findInPendingSync(code, pendingSync = []) {
        const normalizedCode = this.cleanCode(code);
        if (!normalizedCode || normalizedCode.length === 0) return null;

        for (const record of pendingSync) {
            const scan1 = this.cleanCode(record.scan1);
            const scan2 = this.cleanCode(record.scan2);
            
            if ((scan1 && scan1 === normalizedCode) || (scan2 && scan2 === normalizedCode)) {
                console.log(`🔍 [PROCESSED-CACHE] Encontrado en pendientes: ${normalizedCode}`);
                return {
                    scan1: record.scan1,
                    scan2: record.scan2,
                    pallet: record.pallet,
                    date: record.date,
                    time: record.time,
                    user: record.user,
                    location: record.location,
                    source: 'pending_sync'
                };
            }
        }
        return null;
    }

    /**
     * Validación dual: busca en PENDING_SYNC y en cajas procesadas del servidor
     */
    findProcessedBox(code, pendingSync = []) {
        // Paso A: Buscar en registros locales pendientes de sincronizar
        const pendingResult = this.findInPendingSync(code, pendingSync);
        if (pendingResult) {
            return { ...pendingResult, source: 'local_pending' };
        }

        // Paso B: Buscar en listado descargado del servidor
        const serverResult = this.findInProcessed(code);
        if (serverResult) {
            return { ...serverResult, source: 'server' };
        }

        return null;
    }

    /**
     * Obtiene texto de última actualización
     */
    getLastUpdateText() {
        if (!this.lastUpdate) return 'Nunca';
        return this.lastUpdate.toLocaleString();
    }

    /**
     * Obtiene cantidad de cajas en cache
     */
    getCount() {
        return this.processedBoxesMap.size;
    }

    /**
     * Agrega registros recién sincronizados al cache local
     */
    async addSyncedRecords(records) {
        if (!records || records.length === 0) return;

        let added = 0;
        for (const record of records) {
            const scan1 = this.cleanCode(record.scan1);
            const scan2 = this.cleanCode(record.scan2);

            if (scan1 && scan1.length > 0) {
                const boxData = {
                    scan1,
                    scan2,
                    pallet: record.pallet || '',
                    date: record.date || '',
                    time: record.time || '',
                    user: record.user || '',
                    location: record.location || ''
                };

                // Indexar por scan1
                this.processedBoxesMap.set(scan1, boxData);
                added++;

                // También indexar por scan2 si existe y es diferente
                if (scan2 && scan2.length > 0 && scan2 !== scan1) {
                    this.processedBoxesMap.set(scan2, boxData);
                    added++;
                }
            }
        }

        // Guardar en IndexedDB para persistencia
        await this.saveToIndexedDB();
        console.log(`📦 [PROCESSED-CACHE] Agregados ${added} registros sincronizados al cache local`);
    }

    /**
     * Limpia el cache completamente
     */
    async clearCache() {
        this.processedBoxesMap.clear();
        this.lastUpdate = null;
        await this.saveToIndexedDB();
        console.log('🧹 [PROCESSED-CACHE] Cache limpiado completamente');
    }

    /**
     * Obtiene estadísticas del cache
     */
    getStats() {
        return {
            cacheSize: this.processedBoxesMap.size,
            lastUpdate: this.lastUpdate,
            isLoading: this.isLoading,
            autoSyncEnabled: this.intervalId !== null
        };
    }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.ProcessedCacheManager = ProcessedCacheManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProcessedCacheManager;
}
