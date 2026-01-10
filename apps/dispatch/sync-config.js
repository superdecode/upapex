/**
 * SYNC-CONFIG.JS - Dispatch App
 * Configuración del sistema de sincronización avanzado para Despacho
 */

// Verificar que las dependencias estén cargadas
if (typeof SyncManager === 'undefined') {
    console.error('❌ SyncManager no está cargado. Verifica que sync-manager.js se cargue antes de sync-config.js');
}

// Inicializar Sync Manager para Dispatch
let syncManager;

async function initAdvancedSync() {
    // Verificar dependencias
    if (typeof SyncManager === 'undefined') {
        throw new Error('SyncManager no está disponible');
    }
    try {
        console.log('🚀 [DISPATCH] Inicializando Sync Manager (legacy)...');
        
        // Configuración del Sync Manager
        const syncConfig = {
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            sheetName: 'BD',
            appName: 'Dispatch',
            appIcon: '🚚',
            autoSyncInterval: 45000,      // 45 segundos
            storageKey: 'dispatch_pending_sync',
            
            // Formato de registro para Dispatch
            // Columnas: Folio, Fecha, Hora, Usuario, Orden, Destino, Horario, Código, Código2, Estatus, Tarea, Estatus2, CantInicial, CantDespacho, Incidencias, Operador, Unidad, Observaciones
            formatRecord: (record) => {
                // Usar fecha/hora del record si existen, sino generar con formato consistente
                let fecha = record?.fecha || '';
                let hora = record?.hora || '';
                
                // Si no hay fecha/hora, generar desde timestamp con formato consistente DD/MM/YYYY y HH:MM
                if ((!fecha || !hora) && record?.timestamp) {
                    const d = new Date(record.timestamp);
                    const day = String(d.getDate()).padStart(2, '0');
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const year = d.getFullYear();
                    const hours = String(d.getHours()).padStart(2, '0');
                    const minutes = String(d.getMinutes()).padStart(2, '0');
                    
                    fecha = fecha || `${day}/${month}/${year}`;
                    hora = hora || `${hours}:${minutes}`;
                }
                
                // Validación final de formato antes de enviar
                if (fecha && !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
                    console.warn(`⚠️ [SYNC-CONFIG] Formato de fecha inconsistente detectado: ${fecha}, corrigiendo...`);
                    const d = new Date(record.timestamp || Date.now());
                    const day = String(d.getDate()).padStart(2, '0');
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const year = d.getFullYear();
                    fecha = `${day}/${month}/${year}`;
                }
                
                if (hora && !/^\d{2}:\d{2}$/.test(hora)) {
                    console.warn(`⚠️ [SYNC-CONFIG] Formato de hora inconsistente detectado: ${hora}, corrigiendo...`);
                    const d = new Date(record.timestamp || Date.now());
                    const hours = String(d.getHours()).padStart(2, '0');
                    const minutes = String(d.getMinutes()).padStart(2, '0');
                    hora = `${hours}:${minutes}`;
                }
                
                // Log de escritura para auditoría
                console.log('📝 [SYNC-CONFIG] Formateando registro para BD:', {
                    orden: record.orden,
                    fecha: fecha,
                    hora: hora,
                    usuario: record.usuario || '',
                    operador: record.operador || '',
                    cantInicial: record.cantInicial || '',
                    cantDespacho: record.cantDespacho || ''
                });
                
                // Normalizar fecha de envío (columna G) si existe
                let horarioNormalizado = record.horario || '';
                if (horarioNormalizado && typeof window.normalizeDeliveryDate === 'function') {
                    horarioNormalizado = window.normalizeDeliveryDate(horarioNormalizado);
                }
                
                return [
                    record.folio || '',              // A: Folio
                    fecha,                           // B: Fecha (DD/MM/YYYY)
                    hora,                            // C: Hora (HH:MM)
                    record.usuario || '',            // D: Usuario
                    record.orden || '',              // E: Orden
                    record.destino || '',            // F: Destino
                    horarioNormalizado,              // G: Horario (Fecha de Envío normalizada ISO 8601)
                    record.codigo || '',             // H: Código
                    record.codigo2 || '',            // I: Código 2
                    record.estatus || '',            // J: Estatus
                    record.tarea || '',              // K: Tarea
                    record.estatus2 || '',           // L: Estatus2
                    record.cantInicial || '',        // M: Cant Inicial
                    record.cantDespacho || '',       // N: Cant Despacho
                    record.incidencias || '',        // O: Incidencias
                    record.operador || '',           // P: Operador
                    record.unidad || '',             // Q: Unidad
                    record.observaciones || ''       // R: Observaciones
                ];
            },
            
            // Callbacks
            onSyncStart: () => {
                console.log('🔄 [DISPATCH] Sincronización iniciada');
                if (typeof updateConnectionIndicator === 'function') {
                    updateConnectionIndicator(true);
                }
            },
            
            onSyncEnd: () => {
                console.log('✅ [DISPATCH] Sincronización finalizada');
                if (typeof updateConnectionIndicator === 'function') {
                    updateConnectionIndicator(false);
                }
            },
            
            onStatusChange: (stats) => {
                console.log('📊 [DISPATCH] Estado actualizado:', stats);
                // Actualizar UI específica de dispatch si es necesario
            }
        };
        
        // Crear instancia del Sync Manager
        syncManager = new SyncManager(syncConfig);
        syncManager.init();
        
        // Hacer disponible globalmente
        window.syncManager = syncManager;
        
        console.log('✅ [DISPATCH] Sync Manager (legacy) inicializado');
        
        return true;
    } catch (error) {
        console.error('❌ [DISPATCH] Error inicializando Advanced Sync:', error);
        return false;
    }
}

// Función auxiliar para agregar despachos a la cola
async function addDispatchToQueue(dispatchData) {
    if (!syncManager) {
        console.error('❌ Sync Manager no inicializado');
        return false;
    }
    
    // El record ya viene con el formato correcto desde confirmDispatch
    syncManager.addToQueue(dispatchData);
    return true;
}

// Función auxiliar para sincronizar manualmente
async function syncDispatchData(showMessages = true) {
    if (!syncManager) {
        console.error('❌ Sync Manager no inicializado');
        return { success: false };
    }
    
    return await syncManager.sync(showMessages);
}

// Función auxiliar para obtener estadísticas
function getDispatchSyncStats() {
    if (!syncManager) {
        return null;
    }
    
    return syncManager.getStats();
}

// Función auxiliar para mostrar panel de estado
function showDispatchSyncPanel() {
    if (syncManager) {
        syncManager.showPanel();
    }
}

// Función auxiliar para exportar pendientes
function exportDispatchPending() {
    if (syncManager) {
        syncManager.exportPending();
    }
}

// Exportar funciones para uso global
if (typeof window !== 'undefined') {
    window.initAdvancedSync = initAdvancedSync;
    window.addDispatchToQueue = addDispatchToQueue;
    window.syncDispatchData = syncDispatchData;
    window.getDispatchSyncStats = getDispatchSyncStats;
    window.showDispatchSyncPanel = showDispatchSyncPanel;
    window.exportDispatchPending = exportDispatchPending;
}
