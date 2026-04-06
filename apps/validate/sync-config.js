/**
 * SYNC-CONFIG.JS - Validador App
 * Configuración del sistema de sincronización avanzado para Validador
 *
 * IMPORTANTE: Este archivo define la lógica de deduplicación ESPECÍFICA para Validador.
 * El módulo advanced-sync-manager.js es genérico y usa los hooks definidos aquí.
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

            // ====== CONFIGURACIÓN ESPECÍFICA DE VALIDADOR ======

            // DESACTIVAR deduplicación legacy por pallet (Validador NO usa pallets)
            useLegacyPalletDedup: false,

            // HOOK: Determina si un registro debe incluirse en la sincronización
            // Para Validador: SIEMPRE incluir todos los registros (cada escaneo es único)
            shouldIncludeRecord: () => {
                // Validador incluye TODOS los registros - cada _id es único
                // No filtrar por código/ubicación porque queremos múltiples escaneos
                return true;
            },

            // HOOK: Genera clave DETERMINISTA para deduplicación INTERNA del batch
            // CORREGIDO: Usar contenido real (código+obc+hora) en vez de _id aleatorio.
            // Con _id aleatorio el sistema NUNCA podía detectar duplicados reales.
            // La clave se basa en código + obc + hora del escaneo, que identifica
            // unívocamente cada evento de validación.
            generateRecordKey: (record) => {
                const code = (record.codigo || record.code || '').toString().toUpperCase();
                const obc = (record.obc || '').toString().toUpperCase();
                const time = record.time || record.timestamp || '';
                return `VAL|${code}|${obc}|${time}`;
            },

            // HOOK: Se ejecuta DESPUÉS de sincronización exitosa
            // Para Validador: marcar validaciones en ValidationDeduplicationManager
            onAfterSync: async (syncedRecords) => {
                if (window.ValidationDeduplicationManager &&
                    typeof window.ValidationDeduplicationManager.markValidationAsSynced === 'function') {
                    syncedRecords.forEach(record => {
                        const code = record.codigo || record.code;
                        const obc = record.obc || record.orden;
                        const location = record.ubicacion || record.location;
                        if (code && obc) {
                            window.ValidationDeduplicationManager.markValidationAsSynced(code, obc, location || '');
                        }
                    });
                    console.log(`✅ [VALIDADOR] ${syncedRecords.length} validaciones marcadas como sincronizadas`);
                }
            },

            // Formato de registro para Validador
            // IMPORTANTE: Enviar datos como strings para evitar problemas de formato
            // 7 columnas: A=Fecha, B=Hora, C=Usuario, D=OBC, E=Código, F=Ubicación, G=Nota
            formatRecord: (record) => {
                // CRÍTICO: Usar string de fecha en formato DD/MM/YYYY
                // NO usar Date objects porque Google Sheets puede formatearlos incorrectamente
                const dateStr = record.date || SyncUtils.formatDate();

                // CRÍTICO: Obtener el nombre del usuario EN TIEMPO REAL
                // Prioridad: 1) record.user, 2) window.CURRENT_USER, 3) AvatarSystem, 4) fallback
                const currentUser = record.user ||
                                   window.CURRENT_USER ||
                                   (window.AvatarSystem?.getUserName?.()) ||
                                   '';

                return [
                    dateStr,  // A: Fecha como string DD/MM/YYYY
                    record.time || SyncUtils.formatTime(),  // B: Hora
                    currentUser,  // C: Usuario activo (obtenido en tiempo real)
                    record.obc || '',  // D: OBC
                    record.codigo || '',  // E: Código
                    record.ubicacion || '',  // F: Ubicación
                    record.nota || ''  // G: Nota (ingreso forzado, observaciones, etc.)
                ];
            },

            // Callbacks de UI
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
        console.error('❌ [VALIDADOR] Advanced Sync Manager no inicializado');
        if (typeof showNotification === 'function') {
            showNotification('❌ Sistema de sincronización no disponible', 'error');
        }
        return false;
    }

    // Verificar que los datos sean válidos
    if (!validationData || !validationData.codigo) {
        console.error('❌ [VALIDADOR] Datos de validación inválidos:', validationData);
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

    // CORREGIDO: Generar _id DETERMINISTA basado en contenido
    const timeStr = SyncUtils.formatTime();
    const dateStr = SyncUtils.formatDate();
    const deterministicId = `VAL_${validationData.obc}_${validationData.codigo}_${timeStr}`.replace(/[^a-zA-Z0-9_]/g, '_');
    const record = {
        _id: deterministicId,
        date: dateStr,
        time: timeStr,
        user: validationData.user || '',
        obc: validationData.obc || '',
        codigo: validationData.codigo || '',
        ubicacion: validationData.ubicacion || '',
        nota: validationData.nota || ''  // Columna G: ingreso forzado, observaciones, etc.
    };

    try {
        await advancedSyncManager.addToQueue(record);
        console.log(`✅ [VALIDADOR] Validación agregada a cola: ${record.codigo}`);
        return { duplicate: false };

    } catch (error) {
        console.error('❌ [VALIDADOR] Error al agregar validación a cola:', error);
        if (typeof showNotification === 'function') {
            showNotification(`❌ Error al guardar validación: ${error.message}`, 'error');
        }
        return false;
    }
}

// Función auxiliar para agregar múltiples validaciones
async function addValidationsToQueue(validations) {
    if (!advancedSyncManager) {
        console.error('❌ [VALIDADOR] Advanced Sync Manager no inicializado');
        if (typeof showNotification === 'function') {
            showNotification('❌ Sistema de sincronización no disponible', 'error');
        }
        return false;
    }

    // Validar que hay validaciones para agregar
    if (!Array.isArray(validations) || validations.length === 0) {
        console.warn('⚠️ [VALIDADOR] No hay validaciones para agregar');
        return false;
    }

    // CORREGIDO: Generar _id DETERMINISTA basado en contenido
    const batchTime = SyncUtils.formatTime();
    const batchDate = SyncUtils.formatDate();
    const records = validations.map((v, index) => ({
        _id: `VAL_${v.obc}_${v.codigo}_${index}_${batchTime}`.replace(/[^a-zA-Z0-9_]/g, '_'),
        date: batchDate,
        time: batchTime,
        user: v.user || '',
        obc: v.obc || '',
        codigo: v.codigo || '',
        ubicacion: v.ubicacion || '',
        nota: v.nota || ''  // Columna G: ingreso forzado, observaciones, etc.
    }));

    try {
        await advancedSyncManager.addToQueue(records);
        console.log(`✅ [VALIDADOR] ${records.length} validaciones agregadas a cola con IDs únicos`);
        return true;

    } catch (error) {
        console.error('❌ [VALIDADOR] Error al agregar validaciones a cola:', error);
        if (typeof showNotification === 'function') {
            showNotification(`❌ Error al guardar validaciones: ${error.message}`, 'error');
        }
        return false;
    }
}

// Función auxiliar para sincronizar manualmente
async function syncValidadorData(showMessages = true) {
    if (!advancedSyncManager) {
        console.error('❌ [VALIDADOR-SYNC] Advanced Sync Manager no inicializado');
        if (showMessages && typeof showNotification === 'function') {
            showNotification('❌ Sistema de sincronización no disponible', 'error');
        }
        return { success: false, reason: 'sync_manager_not_initialized' };
    }

    try {
        console.log('🔄 [VALIDADOR-SYNC] Iniciando sincronización...');
        const result = await advancedSyncManager.sync(showMessages);

        console.log('📊 [VALIDADOR-SYNC] Resultado de sincronización:', result);

        // Validar que el resultado tenga la estructura esperada
        if (!result || typeof result !== 'object') {
            console.error('❌ [VALIDADOR-SYNC] Resultado inválido de sincronización');
            return { success: false, reason: 'invalid_result' };
        }

        return result;

    } catch (error) {
        console.error('❌ [VALIDADOR-SYNC] Error crítico en sincronización:', error);
        console.error('Detalles del error:', {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
        });

        if (showMessages && typeof showNotification === 'function') {
            showNotification(`❌ Error en sincronización: ${error.message || 'Error desconocido'}`, 'error');
        }

        return { success: false, reason: 'sync_error', error: error.message };
    }
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
