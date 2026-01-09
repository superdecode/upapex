/**
 * SYNC-CONFIG.JS - Inventory App
 * Configuración del sistema de sincronización avanzado para Inventario
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

// Inicializar Advanced Sync Manager para Inventory
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
        console.log('🚀 [INVENTORY] Inicializando Advanced Sync Manager...');
        
        // Configuración del Advanced Sync Manager
        const syncConfig = {
            spreadsheetId: CONFIG.SPREADSHEET_WRITE || '',
            sheetName: 'BD',
            appName: 'Inventory',
            appIcon: '📦',
            autoSyncInterval: 45000,      // 45 segundos
            heartbeatInterval: 10000,     // 10 segundos
            maxRetries: 3,
            retryDelay: 1000,
            storageKey: 'inventory_pending_sync',
            dedupStorageKey: 'inventory_synced_pallets',
            dbName: 'InventoryPersistenceDB',
            
            // Formato de registro para Inventory
            formatRecord: (record) => {
                return [
                    record.date || SyncUtils.formatDate(),
                    record.time || SyncUtils.formatTime(),
                    record.user || '',
                    record.scan1 || record.code || '',
                    record.scan2 || '',
                    record.location || '',
                    record.status || '',
                    record.note || '',
                    record.pallet || '',
                    record.originLocation || ''
                ];
            },
            
            // Callbacks
            onSyncStart: () => {
                console.log('🔄 [INVENTORY] Sincronización iniciada');
                // Actualizar UI si es necesario
            },
            
            onSyncEnd: () => {
                console.log('✅ [INVENTORY] Sincronización finalizada');
                // Actualizar UI si es necesario
            },
            
            onStatusChange: (stats) => {
                console.log('📊 [INVENTORY] Estado actualizado:', stats);
                // Actualizar badge de pendientes si existe
                const badge = document.getElementById('pending-badge') || 
                             document.getElementById('sync-badge');
                if (badge) {
                    badge.textContent = stats.pendingSync || '';
                    badge.style.display = stats.pendingSync > 0 ? 'inline-block' : 'none';
                }
            }
        };
        
        // Crear instancia del Advanced Sync Manager
        advancedSyncManager = new AdvancedSyncManager(syncConfig);
        await advancedSyncManager.init();
        
        // Hacer disponible globalmente
        window.advancedSyncManager = advancedSyncManager;
        window.syncManager = advancedSyncManager; // Compatibilidad con código existente
        
        console.log('✅ [INVENTORY] Advanced Sync Manager inicializado');
        
        // Inicializar Processed Cache Manager
        processedCacheManager = new ProcessedCacheManager({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE || '',
            sheetName: 'BD',
            syncInterval: 60 * 60 * 1000, // 1 hora
            dbName: 'InventoryProcessedCache'
        });
        
        await processedCacheManager.init();
        window.processedCacheManager = processedCacheManager;
        
        console.log('✅ [INVENTORY] Processed Cache Manager inicializado');
        
        return true;
    } catch (error) {
        console.error('❌ [INVENTORY] Error inicializando Advanced Sync:', error);
        return false;
    }
}

// Función auxiliar para agregar registros a la cola
async function addRecordToQueue(recordData) {
    if (!advancedSyncManager) {
        console.error('❌ Advanced Sync Manager no inicializado');
        return false;
    }
    
    // Verificar duplicados antes de agregar
    if (processedCacheManager) {
        const isDuplicate = processedCacheManager.findProcessedBox(
            recordData.scan1 || recordData.code,
            advancedSyncManager.pendingSync
        );
        
        if (isDuplicate) {
            console.warn('⚠️ [INVENTORY] Código duplicado detectado:', isDuplicate);
            if (typeof showNotification === 'function') {
                showNotification(`⚠️ Código ya procesado: ${isDuplicate.source}`, 'warning');
            }
            return false;
        }
    }
    
    const record = {
        date: SyncUtils.formatDate(),
        time: SyncUtils.formatTime(),
        user: recordData.user || '',
        scan1: recordData.scan1 || recordData.code || '',
        scan2: recordData.scan2 || '',
        location: recordData.location || '',
        status: recordData.status || '',
        note: recordData.note || '',
        pallet: recordData.pallet || '',
        originLocation: recordData.originLocation || ''
    };
    
    await advancedSyncManager.addToQueue(record);
    return true;
}

// Función auxiliar para agregar múltiples registros (pallet completo)
async function addPalletToQueue(boxes, palletId, location) {
    if (!advancedSyncManager) {
        console.error('❌ Advanced Sync Manager no inicializado');
        return false;
    }
    
    const records = boxes.map(box => ({
        date: SyncUtils.formatDate(),
        time: SyncUtils.formatTime(),
        user: box.user || '',
        scan1: box.scan1 || box.code || '',
        scan2: box.scan2 || '',
        location: location || '',
        status: box.status || '',
        note: box.note || '',
        pallet: palletId || '',
        originLocation: box.originLocation || ''
    }));
    
    await advancedSyncManager.addToQueue(records);
    return true;
}

// Función auxiliar para sincronizar manualmente
async function syncInventoryData(showMessages = true) {
    if (!advancedSyncManager) {
        console.error('❌ Advanced Sync Manager no inicializado');
        return { success: false };
    }
    
    return await advancedSyncManager.sync(showMessages);
}

// Función auxiliar para obtener estadísticas
function getInventorySyncStats() {
    if (!advancedSyncManager) {
        return null;
    }
    
    return advancedSyncManager.getStats();
}

// Función auxiliar para mostrar panel de estado
function showInventorySyncPanel() {
    if (advancedSyncManager) {
        advancedSyncManager.showPanel();
    }
}

// Función auxiliar para exportar pendientes
function exportInventoryPending() {
    if (advancedSyncManager) {
        advancedSyncManager.exportPending();
    }
}

// Función auxiliar para verificar duplicados
function checkDuplicate(code) {
    if (!processedCacheManager) {
        return null;
    }
    
    return processedCacheManager.findProcessedBox(
        code,
        advancedSyncManager?.pendingSync || []
    );
}

// Exportar funciones para uso global
if (typeof window !== 'undefined') {
    window.initAdvancedSync = initAdvancedSync;
    window.addRecordToQueue = addRecordToQueue;
    window.addPalletToQueue = addPalletToQueue;
    window.syncInventoryData = syncInventoryData;
    window.getInventorySyncStats = getInventorySyncStats;
    window.showInventorySyncPanel = showInventorySyncPanel;
    window.exportInventoryPending = exportInventoryPending;
    window.checkDuplicate = checkDuplicate;
}
