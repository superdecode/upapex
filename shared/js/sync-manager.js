/**
 * SYNC-MANAGER.JS
 * Sistema de sincronización compartido para todo el WMS
 * Maneja la cola de pendientes y sincronización con Google Sheets
 */

class SyncManager {
    constructor(config) {
        this.config = {
            spreadsheetId: config.spreadsheetId,
            sheetName: config.sheetName,
            autoSyncInterval: config.autoSyncInterval || 30000,
            storageKey: config.storageKey || 'wms_pending_sync',
            ...config
        };
        
        this.pendingSync = [];
        this.inProgress = false;
        this.retryCount = 0;
        this.intervalId = null;
    }
    
    /**
     * Inicializa el Sync Manager
     */
    init() {
        this.load();
        this.startAutoSync();
        this.setupExitProtection();
        this.updateUI(this.pendingSync.length === 0);
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
     * Inicia la sincronización automática
     */
    startAutoSync() {
        if (this.intervalId) clearInterval(this.intervalId);
        
        this.intervalId = setInterval(() => {
            if (checkOnlineStatus() && gapi?.client?.getToken() && this.pendingSync.length > 0) {
                this.sync(false);
            }
        }, this.config.autoSyncInterval);
    }
    
    /**
     * Detiene la sincronización automática
     */
    stopAutoSync() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    
    /**
     * Agrega registros a la cola de sincronización
     * @param {Array} records - Array de registros a sincronizar
     */
    addToQueue(records) {
        if (!Array.isArray(records)) {
            records = [records];
        }
        
        this.pendingSync = [...this.pendingSync, ...records];
        this.save();
        this.updateUI(false);
    }
    
    /**
     * Sincroniza los datos pendientes con Google Sheets
     * @param {boolean} showMessages - Mostrar notificaciones
     * @returns {Promise<Object>} - {success: boolean, synced: number}
     */
    async sync(showMessages = true) {
        if (this.inProgress) {
            if (showMessages) showNotification('⏳ Sincronización en progreso...', 'info');
            return { success: false };
        }
        
        if (!checkOnlineStatus()) {
            if (showMessages) showNotification('⚠️ Sin conexión a internet', 'warning');
            return { success: false };
        }
        
        if (!gapi?.client?.getToken()) {
            if (showMessages) showNotification('⚠️ No conectado a Google', 'warning');
            return { success: false };
        }
        
        if (this.pendingSync.length === 0) {
            this.updateUI(true);
            if (showMessages) showNotification('✅ Todo sincronizado', 'success');
            return { success: true, synced: 0 };
        }
        
        return await this._doSync(showMessages);
    }
    
    /**
     * Ejecuta la sincronización
     * @private
     */
    async _doSync(showMessages) {
        this.inProgress = true;
        
        if (showMessages) showNotification('🔄 Sincronizando...', 'info');
        
        try {
            // Preparar valores según el formato configurado
            const values = this.pendingSync.map(record => {
                if (this.config.formatRecord) {
                    return this.config.formatRecord(record);
                }
                // Formato por defecto (10 columnas para Inventario)
                return [
                    record.date,
                    record.time,
                    record.user,
                    record.scan1,
                    record.scan2 || '',
                    record.location,
                    record.status,
                    record.note || '',
                    record.pallet || '',
                    record.originLocation || ''
                ];
            });
            
            await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: this.config.spreadsheetId,
                range: `${this.config.sheetName}!A:Z`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                resource: { values }
            });
            
            const synced = this.pendingSync.length;
            this.pendingSync = [];
            this.save();
            this.updateUI(true);
            
            if (showMessages) showNotification(`✅ ${synced} registros sincronizados`, 'success');
            return { success: true, synced };
            
        } catch (e) {
            console.error('Sync error:', e);
            this.updateUI(false);
            if (showMessages) {
                const errorMsg = e.result?.error?.message || e.message || 'Error desconocido';
                showNotification(`❌ Error: ${errorMsg}`, 'error');
            }
            return { success: false };
        } finally {
            this.inProgress = false;
        }
    }
    
    /**
     * Guarda la cola en localStorage
     */
    save() {
        try {
            localStorage.setItem(this.config.storageKey, JSON.stringify(this.pendingSync));
        } catch (e) {
            console.error('Error saving sync queue:', e);
        }
    }
    
    /**
     * Carga la cola desde localStorage
     */
    load() {
        try {
            const saved = localStorage.getItem(this.config.storageKey);
            if (saved) {
                this.pendingSync = JSON.parse(saved);
            }
        } catch (e) {
            console.error('Error loading sync queue:', e);
            this.pendingSync = [];
        }
    }
    
    /**
     * Actualiza la UI del estado de sincronización
     * @param {boolean} synced - Si está sincronizado
     */
    updateUI(synced) {
        const el = document.getElementById('sync-status');
        if (!el) return;
        
        const isOnline = checkOnlineStatus();
        
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
    }
    
    /**
     * Muestra el panel de estado de sincronización
     */
    showPanel() {
        const isOnline = checkOnlineStatus();
        const hasToken = gapi?.client?.getToken();
        
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show';
        overlay.innerHTML = `
            <div class="popup-content" style="max-width: 450px;">
                <div class="popup-header">
                    <span>📊 Estado de Sincronización</span>
                    <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
                </div>
                <div style="margin-bottom: 15px;">
                    <div style="padding: 15px; background: #f5f5f5; border-radius: 8px; margin-bottom: 10px; text-align: center;">
                        <div style="font-size: 0.85em; color: #666;">Pendientes de sincronizar</div>
                        <div style="font-size: 2em; font-weight: 700; color: ${this.pendingSync.length > 0 ? 'var(--warning)' : 'var(--success)'};">
                            ${this.pendingSync.length}
                        </div>
                    </div>
                    <div style="font-size: 0.9em; padding: 10px; background: #f9f9f9; border-radius: 6px;">
                        ${isOnline ? '🟢 Conectado a internet' : '🔴 Sin conexión'}<br>
                        ${hasToken ? '🟢 Google conectado' : '🔴 Google desconectado'}<br>
                        📄 Hoja destino: <strong>${this.config.sheetName}</strong>
                    </div>
                </div>
                <div class="popup-buttons">
                    ${this.pendingSync.length > 0 && isOnline && hasToken ? `
                        <button class="btn btn-success btn-full" onclick="window.syncManager.sync(); this.closest('.popup-overlay').remove();">
                            🔄 Sincronizar Ahora
                        </button>
                    ` : ''}
                    <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove();">
                        Cerrar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }
    
    /**
     * Obtiene el número de registros pendientes
     * @returns {number}
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
    window.SyncManager = SyncManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncManager;
}
