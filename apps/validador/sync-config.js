/**
 * SYNC-CONFIG.JS - Validador App
 * Configuración del sistema de sincronización avanzado para Validador
 */

// Verificar que las dependencias estén cargadas
if (typeof AdvancedSyncManager === 'undefined') {
    console.error('❌ AdvancedSyncManager no está cargado. Verifica que advanced-sync-manager.js se cargue antes de sync-config.js');
}

if (typeof ProcessedCacheManager === 'undefined') {
    console.error('❌ ProcessedCacheManager no está cargado. Verifica que processed-cache-manager.js se cargue antes de sync-config.js');
}

if (typeof SyncUtils === 'undefined') {
    console.error('❌ SyncUtils no está cargado. Verifica que sync-utils.js se cargue antes de sync-config.js');
}

// Inicializar Advanced Sync Manager para Validador
let advancedSyncManager;
let processedCacheManager;

async function initAdvancedSync() {
    // Verificar dependencias
    if (typeof AdvancedSyncManager === 'undefined') {
        throw new Error('AdvancedSyncManager no está disponible');
    }
    if (typeof ProcessedCacheManager === 'undefined') {
        throw new Error('ProcessedCacheManager no está disponible');
    }
    if (typeof SyncUtils === 'undefined') {
        throw new Error('SyncUtils no está disponible');
    }
    try {
        console.log('🚀 [VALIDADOR] Inicializando Advanced Sync Manager...');
        
        // Configuración del Advanced Sync Manager
        const syncConfig = {
            spreadsheetId: SPREADSHEET_WRITE || '',
            sheetName: 'Val3',  // Nombre de la hoja en Google Sheets
            appName: 'Validador',
            appIcon: '🎯',
            autoSyncInterval: 45000,      // 45 segundos
            heartbeatInterval: 10000,     // 10 segundos
            maxRetries: 3,
            retryDelay: 1000,
            storageKey: 'validador_pending_sync',
            dedupStorageKey: 'validador_synced_records',
            dbName: 'ValidadorPersistenceDB',
            
            // Formato de registro para Validador
            formatRecord: (record) => {
                return [
                    record.date || SyncUtils.formatDate(),
                    record.time || SyncUtils.formatTime(),
                    record.user || '',
                    record.obc || '',
                    record.codigo || '',
                    record.destino || '',
                    record.horario || '',
                    record.ubicacion || '',
                    record.estatus || '',
                    record.nota || ''
                ];
            },
            
            // Callbacks
            onSyncStart: () => {
                console.log('🔄 [VALIDADOR] Sincronización iniciada');
                // Actualizar indicador de sync si existe
                const syncStatus = document.getElementById('sync-status');
                if (syncStatus) {
                    syncStatus.className = 'sync-status sync-syncing';
                    syncStatus.textContent = '🔄 Sincronizando...';
                }
            },
            
            onSyncEnd: () => {
                console.log('✅ [VALIDADOR] Sincronización finalizada');
                // Actualizar indicador de sync
                const syncStatus = document.getElementById('sync-status');
                if (syncStatus && advancedSyncManager) {
                    const stats = advancedSyncManager.getStats();
                    if (stats.pendingSync === 0) {
                        syncStatus.className = 'sync-status sync-ok';
                        syncStatus.textContent = '✅ Sincronizado';
                    } else {
                        syncStatus.className = 'sync-status sync-pending';
                        syncStatus.innerHTML = `⏳ ${stats.pendingSync} pendientes`;
                    }
                }
            },
            
            onStatusChange: (stats) => {
                console.log('📊 [VALIDADOR] Estado actualizado:', stats);
                // Actualizar badge de pendientes
                const badge = document.getElementById('pending-badge');
                if (badge) {
                    if (stats.pendingSync > 0) {
                        badge.textContent = stats.pendingSync;
                        badge.style.display = 'inline-block';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            }
        };
        
        // Crear instancia del Advanced Sync Manager
        advancedSyncManager = new AdvancedSyncManager(syncConfig);
        await advancedSyncManager.init();
        
        // Hacer disponible globalmente
        window.advancedSyncManager = advancedSyncManager;
        window.syncManager = advancedSyncManager; // Compatibilidad con código existente
        
        console.log('✅ [VALIDADOR] Advanced Sync Manager inicializado');
        
        // Inicializar Processed Cache Manager
        processedCacheManager = new ProcessedCacheManager({
            spreadsheetId: SPREADSHEET_WRITE || '',
            sheetName: 'Val3',
            syncInterval: 60 * 60 * 1000, // 1 hora
            dbName: 'ValidadorProcessedCache'
        });
        
        await processedCacheManager.init();
        window.processedCacheManager = processedCacheManager;
        
        console.log('✅ [VALIDADOR] Processed Cache Manager inicializado');
        
        return true;
    } catch (error) {
        console.error('❌ [VALIDADOR] Error inicializando Advanced Sync:', error);
        return false;
    }
}

// Función auxiliar para agregar validación a la cola
async function addValidationToQueue(validationData) {
    if (!advancedSyncManager) {
        console.error('❌ Advanced Sync Manager no inicializado');
        return false;
    }
    
    // Verificar duplicados antes de agregar
    if (processedCacheManager) {
        const isDuplicate = processedCacheManager.findProcessedBox(
            validationData.codigo,
            advancedSyncManager.pendingSync
        );
        
        if (isDuplicate) {
            console.warn('⚠️ [VALIDADOR] Código duplicado detectado:', isDuplicate);
            return { duplicate: true, info: isDuplicate };
        }
    }
    
    const record = {
        date: SyncUtils.formatDate(),
        time: SyncUtils.formatTime(),
        user: validationData.user || '',
        obc: validationData.obc || '',
        codigo: validationData.codigo || '',
        destino: validationData.destino || '',
        horario: validationData.horario || '',
        ubicacion: validationData.ubicacion || '',
        estatus: validationData.estatus || 'OK',
        nota: validationData.nota || ''
    };
    
    await advancedSyncManager.addToQueue(record);
    return { duplicate: false };
}

// Función auxiliar para agregar múltiples validaciones
async function addValidationsToQueue(validations) {
    if (!advancedSyncManager) {
        console.error('❌ Advanced Sync Manager no inicializado');
        return false;
    }
    
    const records = validations.map(v => ({
        date: SyncUtils.formatDate(),
        time: SyncUtils.formatTime(),
        user: v.user || '',
        obc: v.obc || '',
        codigo: v.codigo || '',
        destino: v.destino || '',
        horario: v.horario || '',
        ubicacion: v.ubicacion || '',
        estatus: v.estatus || 'OK',
        nota: v.nota || ''
    }));
    
    await advancedSyncManager.addToQueue(records);
    return true;
}

// Función auxiliar para sincronizar manualmente
async function syncValidadorData(showMessages = true) {
    if (!advancedSyncManager) {
        console.error('❌ Advanced Sync Manager no inicializado');
        return { success: false };
    }
    
    return await advancedSyncManager.sync(showMessages);
}

// Función auxiliar para obtener estadísticas
function getValidadorSyncStats() {
    if (!advancedSyncManager) {
        return null;
    }
    
    return advancedSyncManager.getStats();
}

// Función auxiliar para mostrar panel de estado
function showValidadorSyncPanel() {
    if (advancedSyncManager) {
        advancedSyncManager.showPanel();
    }
}

// Función auxiliar para exportar pendientes
function exportValidadorPending() {
    if (advancedSyncManager) {
        advancedSyncManager.exportPending();
    }
}

// Función auxiliar para verificar si un código ya fue validado
function checkCodeValidated(codigo) {
    if (!processedCacheManager) {
        return null;
    }
    
    return processedCacheManager.findProcessedBox(
        codigo,
        advancedSyncManager?.pendingSync || []
    );
}

// Función auxiliar para sincronizar cache desde servidor
async function syncCacheFromServer() {
    if (!processedCacheManager) {
        console.error('❌ Processed Cache Manager no inicializado');
        return false;
    }
    
    await processedCacheManager.syncFromServer(true);
    return true;
}

// Exportar funciones para uso global
if (typeof window !== 'undefined') {
    window.initAdvancedSync = initAdvancedSync;
    window.addValidationToQueue = addValidationToQueue;
    window.addValidationsToQueue = addValidationsToQueue;
    window.syncValidadorData = syncValidadorData;
    window.getValidadorSyncStats = getValidadorSyncStats;
    window.showValidadorSyncPanel = showValidadorSyncPanel;
    window.exportValidadorPending = exportValidadorPending;
    window.checkCodeValidated = checkCodeValidated;
    window.syncCacheFromServer = syncCacheFromServer;
}
