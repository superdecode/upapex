/**
 * PERSISTENT-STATE-MANAGER.JS
 * Sistema de persistencia de estado de sincronización en IndexedDB
 *
 * Funcionalidad:
 * - Estado de sincronización persistente (no en memoria)
 * - Recuperación automática después de recarga de página
 * - Detección de crashes (timestamp > 5 minutos)
 * - Estado incluye: { sendingInProgress, currentBatchId, lockToken, timestamp, attempts }
 */

class PersistentStateManager {
    constructor(config = {}) {
        this.dbName = config.dbName || 'SyncStateDB';
        this.dbVersion = config.dbVersion || 1;
        this.storeName = 'syncState';
        this.crashThreshold = config.crashThreshold || 5 * 60 * 1000; // 5 minutos

        this.db = null;
    }

    /**
     * Inicializa IndexedDB
     */
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('❌ [STATE] Error abriendo IndexedDB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ [STATE] IndexedDB inicializado');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Crear object store si no existe
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, {
                        keyPath: 'id',
                        autoIncrement: false
                    });

                    // Índice por timestamp para limpieza
                    objectStore.createIndex('timestamp', 'timestamp', { unique: false });

                    console.log('✅ [STATE] Object store creado');
                }
            };
        });
    }

    /**
     * Guarda el estado de sincronización
     *
     * @param {Object} state - Estado a guardar
     *   - sendingInProgress: boolean
     *   - currentBatchId: string (UUID del batch actual)
     *   - lockToken: string (token del lock distribuido)
     *   - timestamp: number (Date.now())
     *   - attempts: number (número de intentos)
     *   - recordCount: number (cantidad de registros en el batch)
     */
    async saveSyncState(state) {
        if (!this.db) {
            console.error('❌ [STATE] DB no inicializado');
            return false;
        }

        try {
            const stateRecord = {
                id: 'current-sync', // Siempre usa el mismo ID (solo un estado activo)
                ...state,
                timestamp: Date.now(),
                savedAt: new Date().toISOString()
            };

            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);

            await new Promise((resolve, reject) => {
                const request = store.put(stateRecord);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            console.log('💾 [STATE] Estado guardado:', {
                sendingInProgress: state.sendingInProgress,
                attempts: state.attempts,
                recordCount: state.recordCount
            });

            return true;

        } catch (error) {
            console.error('❌ [STATE] Error guardando estado:', error);
            return false;
        }
    }

    /**
     * Lee el estado de sincronización
     *
     * Lógica:
     * - Lee el estado desde IndexedDB
     * - Si timestamp > crashThreshold (5 min), considera que hubo crash y limpia
     * - Retorna estado o null
     */
    async getSyncState() {
        if (!this.db) {
            console.error('❌ [STATE] DB no inicializado');
            return null;
        }

        try {
            const tx = this.db.transaction([this.storeName], 'readonly');
            const store = tx.objectStore(this.storeName);

            const state = await new Promise((resolve, reject) => {
                const request = store.get('current-sync');

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });

            if (!state) {
                console.log('📭 [STATE] No hay estado guardado');
                return null;
            }

            // Verificar si el estado es muy antiguo (posible crash)
            const age = Date.now() - state.timestamp;

            if (age > this.crashThreshold) {
                console.warn(`⚠️ [STATE] Estado antiguo detectado (${Math.floor(age / 1000)}s), posible crash`);
                console.warn('🧹 [STATE] Limpiando estado obsoleto...');
                await this.clearSyncState();
                return null;
            }

            console.log('📬 [STATE] Estado recuperado:', {
                sendingInProgress: state.sendingInProgress,
                attempts: state.attempts,
                age: `${Math.floor(age / 1000)}s`
            });

            return state;

        } catch (error) {
            console.error('❌ [STATE] Error leyendo estado:', error);
            return null;
        }
    }

    /**
     * Limpia el estado de sincronización
     */
    async clearSyncState() {
        if (!this.db) {
            console.error('❌ [STATE] DB no inicializado');
            return false;
        }

        try {
            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);

            await new Promise((resolve, reject) => {
                const request = store.delete('current-sync');

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            console.log('🗑️ [STATE] Estado limpiado');
            return true;

        } catch (error) {
            console.error('❌ [STATE] Error limpiando estado:', error);
            return false;
        }
    }

    /**
     * Actualiza solo el timestamp del estado
     * (útil para renovar el TTL sin cambiar otros campos)
     */
    async renewStateTimestamp() {
        const state = await this.getSyncState();

        if (!state) {
            return false;
        }

        state.timestamp = Date.now();
        return await this.saveSyncState(state);
    }

    /**
     * Incrementa el contador de intentos
     */
    async incrementAttempts() {
        const state = await this.getSyncState();

        if (!state) {
            return false;
        }

        state.attempts = (state.attempts || 0) + 1;
        state.timestamp = Date.now(); // Renovar timestamp también

        return await this.saveSyncState(state);
    }

    /**
     * Limpia estados antiguos (más de 1 día)
     */
    async cleanOldStates() {
        if (!this.db) {
            console.error('❌ [STATE] DB no inicializado');
            return false;
        }

        try {
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);

            const tx = this.db.transaction([this.storeName], 'readwrite');
            const store = tx.objectStore(this.storeName);
            const index = store.index('timestamp');

            const range = IDBKeyRange.upperBound(oneDayAgo);
            const request = index.openCursor(range);

            let deletedCount = 0;

            await new Promise((resolve, reject) => {
                request.onsuccess = (event) => {
                    const cursor = event.target.result;

                    if (cursor) {
                        cursor.delete();
                        deletedCount++;
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };

                request.onerror = () => reject(request.error);
            });

            if (deletedCount > 0) {
                console.log(`🧹 [STATE] ${deletedCount} estados antiguos eliminados`);
            }

            return true;

        } catch (error) {
            console.error('❌ [STATE] Error limpiando estados antiguos:', error);
            return false;
        }
    }

    /**
     * Verifica si hay una sincronización en progreso
     */
    async isSyncInProgress() {
        const state = await this.getSyncState();
        return state && state.sendingInProgress === true;
    }

    /**
     * Obtiene información del estado actual
     */
    async getStateInfo() {
        const state = await this.getSyncState();

        if (!state) {
            return {
                exists: false,
                inProgress: false
            };
        }

        const age = Date.now() - state.timestamp;

        return {
            exists: true,
            inProgress: state.sendingInProgress,
            attempts: state.attempts || 0,
            recordCount: state.recordCount || 0,
            age: age,
            ageSeconds: Math.floor(age / 1000),
            isStale: age > this.crashThreshold
        };
    }

    /**
     * Destruye la base de datos (solo para testing/reset)
     */
    async destroyDB() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }

        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(this.dbName);

            request.onsuccess = () => {
                console.log('🗑️ [STATE] Base de datos eliminada');
                resolve();
            };

            request.onerror = () => {
                console.error('❌ [STATE] Error eliminando DB:', request.error);
                reject(request.error);
            };
        });
    }
}

// Exportar globalmente
if (typeof window !== 'undefined') {
    window.PersistentStateManager = PersistentStateManager;
}
