/**
 * SYNC-MANAGER.JS
 * Sistema de sincronización compartido para todo el WMS
 * Maneja la cola de pendientes y sincronización con Google Sheets
 *
 * @version 2.0.0
 * @description Módulo unificado de sincronización con soporte para:
 * - Auto-sync configurable
 * - Sync lenta (batch con delays)
 * - Panel de estado interactivo
 * - Exportación de datos pendientes
 * - Diálogo de salida segura
 * - Protección contra pérdida de datos
 */

class SyncManager {
    constructor(config = {}) {
        this.config = {
            spreadsheetId: config.spreadsheetId || '',
            sheetName: config.sheetName || 'BD',
            autoSyncInterval: config.autoSyncInterval || 30000,
            storageKey: config.storageKey || 'wms_pending_sync',
            batchDelay: config.batchDelay || 100,
            slowSyncDelay: config.slowSyncDelay || 2000,
            appName: config.appName || 'WMS',
            appIcon: config.appIcon || '📦',
            formatRecord: config.formatRecord || null,
            onSyncStart: config.onSyncStart || null,
            onSyncEnd: config.onSyncEnd || null,
            onStatusChange: config.onStatusChange || null,
            ...config
        };

        this.pendingSync = [];
        this.inProgress = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.intervalId = null;
        this.lastErrors = [];
        this.lastSyncTime = null;
        this.initialized = false;
    }

    /**
     * Inicializa el Sync Manager
     */
    init() {
        if (this.initialized) return;

        this.load();
        this.startAutoSync();
        this.setupExitProtection();
        this.updateUI(this.pendingSync.length === 0);
        this.initialized = true;

        console.log(`✅ SyncManager inicializado para ${this.config.appName}`);
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
            if (this._canSync() && this.pendingSync.length > 0) {
                console.log('⏰ Auto-sync triggered');
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
     * Verifica si puede sincronizar
     * @private
     */
    _canSync() {
        const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;
        const hasToken = typeof gapi !== 'undefined' && gapi?.client?.getToken();
        return isOnline && hasToken;
    }

    /**
     * Genera un ID único para evitar duplicados
     * @param {Object} record - Registro a procesar
     */
    generateSyncId(record) {
        const key = `${record.date || ''}_${record.time || ''}_${record.scan1 || record.code || ''}_${record.user || ''}`;
        return key;
    }

    /**
     * Agrega registros a la cola de sincronización evitando duplicados
     * @param {Array|Object} records - Registros a sincronizar
     * @param {string} sheet - Nombre de la hoja (opcional)
     */
    addToQueue(records, sheet = null) {
        if (!Array.isArray(records)) {
            records = [records];
        }

        records.forEach(record => {
            const newId = this.generateSyncId(record);
            const exists = this.pendingSync.some(item => {
                const existingId = this.generateSyncId(item.record || item);
                return existingId === newId;
            });

            if (!exists) {
                if (sheet) {
                    this.pendingSync.push({ sheet, record, syncId: newId });
                } else {
                    this.pendingSync.push(record);
                }
            } else {
                console.warn('⚠️ Registro duplicado no agregado:', newId);
            }
        });

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
            if (showMessages && typeof showNotification === 'function') {
                showNotification('⏳ Sincronización en progreso...', 'info');
            }
            return { success: false };
        }

        const isOnline = typeof checkOnlineStatus === 'function' ? checkOnlineStatus() : navigator.onLine;
        if (!isOnline) {
            if (showMessages && typeof showNotification === 'function') {
                showNotification('⚠️ Sin conexión a internet', 'warning');
            }
            return { success: false };
        }

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

        return await this._doSync(showMessages, false);
    }

    /**
     * Sincronización lenta (más segura, con delays entre registros)
     * @param {boolean} showMessages - Mostrar notificaciones
     */
    async syncSlow(showMessages = true) {
        return await this._doSync(showMessages, true);
    }

    /**
     * Ejecuta la sincronización
     * @private
     */
    async _doSync(showMessages, slow = false) {
        this.inProgress = true;
        this.lastErrors = [];

        if (this.config.onSyncStart) this.config.onSyncStart();
        if (showMessages && typeof showNotification === 'function') {
            showNotification('🔄 Sincronizando...', 'info');
        }

        const total = this.pendingSync.length;
        let success = 0;
        let errors = 0;
        const toRetry = [];
        const delay = slow ? this.config.slowSyncDelay : this.config.batchDelay;

        try {
            // Agrupar por hoja si tienen la propiedad sheet
            const hasSheets = this.pendingSync.length > 0 && this.pendingSync[0].sheet;

            if (hasSheets) {
                // Sincronización por lotes agrupados por hoja
                const grouped = {};
                this.pendingSync.forEach(item => {
                    const sheet = item.sheet || this.config.sheetName;
                    if (!grouped[sheet]) grouped[sheet] = [];
                    grouped[sheet].push(item);
                });

                for (const [sheetName, items] of Object.entries(grouped)) {
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        try {
                            await this._syncSingleRecord(item.record || item, sheetName);
                            success++;
                        } catch (e) {
                            console.error('Sync error for item:', e);
                            this.lastErrors.push({ item, error: e.message });
                            toRetry.push(item);
                            errors++;
                        }

                        if (slow && i < items.length - 1) {
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }
            } else {
                // Sincronización en lote único
                const values = this.pendingSync.map(record => {
                    if (this.config.formatRecord) {
                        return this.config.formatRecord(record);
                    }
                    return this._defaultFormat(record);
                });

                await gapi.client.sheets.spreadsheets.values.append({
                    spreadsheetId: this.config.spreadsheetId,
                    range: `${this.config.sheetName}!A:Z`,
                    valueInputOption: 'USER_ENTERED',
                    insertDataOption: 'INSERT_ROWS',
                    resource: { values }
                });

                success = values.length;
            }

            this.pendingSync = toRetry;
            this.save();
            this.lastSyncTime = new Date();

            if (errors === 0) {
                this.retryCount = 0;
                this.updateUI(true);
                if (showMessages && typeof showNotification === 'function') {
                    showNotification(`✅ ${success} registros sincronizados`, 'success');
                }
                return { success: true, synced: success };
            } else {
                this.retryCount++;
                this.updateUI(false);
                if (showMessages && typeof showNotification === 'function') {
                    showNotification(`⚠️ ${success} OK, ${errors} con error`, 'warning');
                }
                return { success: false, synced: success, failed: errors };
            }

        } catch (e) {
            console.error('Sync error:', e);
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
     * Sincroniza un registro individual
     * @private
     */
    async _syncSingleRecord(record, sheetName) {
        const values = this.config.formatRecord
            ? [this.config.formatRecord(record)]
            : [this._defaultFormat(record)];

        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: this.config.spreadsheetId,
            range: `${sheetName}!A:Z`,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values }
        });
    }

    /**
     * Formato por defecto para registros
     * @private
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
            lastErrors: this.lastErrors
        };
    }

    /**
     * Actualiza la UI del estado de sincronización
     * @param {boolean} synced - Si está sincronizado
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

        // Actualizar badge si existe
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

        // Remover paneles existentes
        document.querySelectorAll('.sync-panel-overlay').forEach(e => e.remove());

        const statusColor = stats.pendingSync === 0 ? 'var(--success)' : 'var(--warning)';

        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show sync-panel-overlay';
        overlay.innerHTML = `
            <div class="popup-content sync-modal-content">
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
                        ${stats.lastSyncTime ? `🕐 Última sync: ${stats.lastSyncTime.toLocaleTimeString()}` : '🕐 Sin sincronizar aún'}
                    </div>

                    ${stats.pendingSync > 0 ? `
                        <div style="padding: 12px; background: #fff3e0; border-radius: 8px; border-left: 4px solid var(--warning); margin-bottom: 15px;">
                            <strong>⚠️ ${stats.pendingSync} registros pendientes</strong><br>
                            <span style="font-size: 0.85em;">Se recomienda sincronizar antes de cerrar.</span>
                        </div>
                    ` : ''}

                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${stats.pendingSync > 0 && stats.isOnline && stats.hasToken ? `
                            <button class="btn btn-primary" onclick="window.syncManager.sync(); this.closest('.popup-overlay').remove();">
                                🔄 Sincronizar Ahora
                            </button>
                            <button class="btn btn-warning" onclick="window.syncManager.syncSlow(); this.closest('.popup-overlay').remove();" style="margin-top: 5px;">
                                ⏱️ Sincronización Lenta (más segura)
                            </button>
                        ` : ''}
                        ${stats.pendingSync > 0 ? `
                            <button class="btn btn-warning" onclick="window.syncManager.exportPending(); this.closest('.popup-overlay').remove();">
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
     * Muestra el diálogo de salida segura
     */
    showExitDialog() {
        const stats = this.getStats();
        const canSync = stats.pendingSync > 0 && stats.isOnline && stats.hasToken;

        document.querySelectorAll('.exit-dialog-overlay').forEach(e => e.remove());

        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show exit-dialog-overlay';
        overlay.innerHTML = `
            <div class="popup-content sync-modal-content">
                <div class="popup-header">
                    <span>⚠️ Salida Segura</span>
                    <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
                </div>
                <div style="padding: 20px;">
                    <div style="padding: 15px; background: #f9f9f9; border-radius: 8px; margin-bottom: 15px;">
                        ⏳ <strong>${stats.pendingSync}</strong> pendientes de sync<br>
                        ${stats.isOnline ? '🟢' : '🔴'} Internet ${stats.isOnline ? 'conectado' : 'desconectado'}<br>
                        ${stats.hasToken ? '🟢' : '🔴'} Google ${stats.hasToken ? 'conectado' : 'desconectado'}
                    </div>

                    ${stats.pendingSync > 0 ? `
                        <div style="padding: 15px; background: #fff3e0; border-radius: 8px; border-left: 4px solid var(--warning); margin-bottom: 15px;">
                            <strong>⚠️ ${stats.pendingSync} sin sincronizar</strong><br>
                            <span style="font-size: 0.85em;">${canSync ? 'Se recomienda sincronizar antes de salir.' : 'Se sincronizarán automáticamente.'}</span>
                        </div>
                    ` : `
                        <div style="padding: 15px; background: #e8f5e9; border-radius: 8px; border-left: 4px solid var(--success); margin-bottom: 15px;">
                            <strong>✅ Todo sincronizado</strong><br>
                            <span style="font-size: 0.85em;">Puedes salir de forma segura.</span>
                        </div>
                    `}

                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${canSync ? `
                            <button id="sync-exit-btn" class="btn btn-success">
                                🔄 Sincronizar y Salir
                            </button>
                        ` : ''}
                        <button class="btn btn-secondary" onclick="this.closest('.popup-overlay').remove();">
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const syncBtn = overlay.querySelector('#sync-exit-btn');
        if (syncBtn) {
            syncBtn.addEventListener('click', async () => {
                syncBtn.disabled = true;
                syncBtn.innerHTML = '🔄 Sincronizando...';
                const result = await this.sync();
                if (result.success || this.pendingSync.length === 0) {
                    overlay.remove();
                    if (typeof showNotification === 'function') {
                        showNotification('✅ Sincronizado. Puedes salir.', 'success');
                    }
                } else {
                    syncBtn.disabled = false;
                    syncBtn.innerHTML = '🔄 Reintentar';
                    if (typeof showNotification === 'function') {
                        showNotification(`⚠️ ${this.pendingSync.length} pendientes aún`, 'warning');
                    }
                }
            });
        }

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

    /**
     * Reconecta con Google (refresca token)
     */
    async reconnectGoogle() {
        try {
            if (typeof tokenClient !== 'undefined' && tokenClient?.requestAccessToken) {
                tokenClient.requestAccessToken({ prompt: '' });
            }
        } catch (e) {
            console.error('Error reconnecting Google:', e);
        }
    }
}

// CSS para el sync status (se inyecta si no existe)
const syncStyles = `
    .sync-status {
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 0.85em;
        font-weight: 600;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        margin-bottom: 10px;
    }
    .sync-status:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .sync-ok {
        background: linear-gradient(135deg, rgba(76, 175, 80, 0.15) 0%, rgba(76, 175, 80, 0.25) 100%);
        color: #2e7d32;
        border: 1px solid rgba(76, 175, 80, 0.3);
    }
    .sync-error {
        background: linear-gradient(135deg, rgba(244, 67, 54, 0.15) 0%, rgba(244, 67, 54, 0.25) 100%);
        color: #c62828;
        border: 1px solid rgba(244, 67, 54, 0.3);
    }
    .sync-warning {
        background: linear-gradient(135deg, rgba(255, 152, 0, 0.15) 0%, rgba(255, 152, 0, 0.25) 100%);
        color: #e65100;
        border: 1px solid rgba(255, 152, 0, 0.3);
    }
    .sync-modal-content {
        max-width: 500px !important;
        width: 90% !important;
    }
    .sync-panel-overlay .popup-content,
    .exit-dialog-overlay .popup-content {
        animation: slideIn 0.3s ease-out;
    }
    @keyframes slideIn {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
    }
`;

// Inyectar estilos si no existen
if (typeof document !== 'undefined' && !document.getElementById('sync-manager-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'sync-manager-styles';
    styleEl.textContent = syncStyles;
    document.head.appendChild(styleEl);
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.SyncManager = SyncManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncManager;
}
