/**
 * SCRIPT DE DEBUG PARA VALIDAR PERSISTENCIA DE DATOS
 * Pega este script en la consola del navegador para diagnosticar problemas de sincronización
 */

console.log('🔍 ===== INICIANDO DEBUG DE SINCRONIZACIÓN =====');

// ==================== FUNCIÓN 1: VERIFICAR ESTADO ACTUAL ====================
async function debugSyncState() {
    console.group('📊 ESTADO ACTUAL DEL SISTEMA');
    
    // Verificar que syncManager existe
    if (!window.syncManager) {
        console.error('❌ syncManager NO EXISTE en window');
        console.groupEnd();
        return;
    }
    
    console.log('✅ syncManager existe');
    console.log('📦 Registros pendientes:', window.syncManager.pendingSync?.length || 0);
    
    if (window.syncManager.pendingSync?.length > 0) {
        console.log('📋 Primeros 5 registros pendientes:');
        window.syncManager.pendingSync.slice(0, 5).forEach((record, idx) => {
            const actualRecord = record.record || record;
            console.log(`  ${idx + 1}.`, {
                _id: actualRecord._id,
                codigo: actualRecord.codigo,
                obc: actualRecord.obc,
                user: actualRecord.user,
                ubicacion: actualRecord.ubicacion,
                _status: actualRecord._status
            });
        });
    }
    
    // Verificar IndexedDB
    try {
        const dbRecords = await window.syncManager.persistenceManager.getPendingSync();
        console.log('💾 Registros en IndexedDB:', dbRecords.length);
    } catch (e) {
        console.error('❌ Error leyendo IndexedDB:', e);
    }
    
    console.groupEnd();
}

// ==================== FUNCIÓN 2: VERIFICAR DEDUPLICACIÓN ====================
function debugDeduplication() {
    console.group('🔍 ANÁLISIS DE DEDUPLICACIÓN');
    
    if (!window.syncManager) {
        console.error('❌ syncManager NO EXISTE');
        console.groupEnd();
        return;
    }
    
    const records = window.syncManager.pendingSync || [];
    console.log('📊 Total de registros en cola:', records.length);
    
    // Analizar claves de deduplicación
    const keys = new Map();
    records.forEach((record, idx) => {
        const actualRecord = record.record || record;
        
        // Generar clave como lo hace _deduplicateBatch
        let key;
        if (actualRecord._id) {
            key = actualRecord._id;
        } else if (actualRecord.codigo || actualRecord.code) {
            const code = actualRecord.codigo || actualRecord.code || '';
            const obc = actualRecord.obc || actualRecord.orden || '';
            const location = actualRecord.ubicacion || actualRecord.location || '';
            const time = actualRecord.time || actualRecord.hora || '';
            key = `${code}|${obc}|${location}|${time}`;
        } else {
            key = JSON.stringify(actualRecord);
        }
        
        if (!keys.has(key)) {
            keys.set(key, []);
        }
        keys.get(key).push(idx);
    });
    
    console.log('🔑 Claves únicas:', keys.size);
    console.log('📦 Registros totales:', records.length);
    
    // Detectar duplicados
    const duplicates = [];
    keys.forEach((indices, key) => {
        if (indices.length > 1) {
            duplicates.push({ key, count: indices.length, indices });
        }
    });
    
    if (duplicates.length > 0) {
        console.warn('⚠️ DUPLICADOS DETECTADOS:', duplicates.length, 'claves duplicadas');
        duplicates.forEach(dup => {
            console.warn(`  - Clave: ${dup.key.substring(0, 50)}... (${dup.count} registros en índices: ${dup.indices.join(', ')})`);
        });
    } else {
        console.log('✅ No hay duplicados internos');
    }
    
    console.groupEnd();
}

// ==================== FUNCIÓN 3: SIMULAR FORMATEO ====================
function debugFormatting() {
    console.group('📝 ANÁLISIS DE FORMATEO');
    
    if (!window.syncManager) {
        console.error('❌ syncManager NO EXISTE');
        console.groupEnd();
        return;
    }
    
    const records = window.syncManager.pendingSync || [];
    if (records.length === 0) {
        console.log('⚠️ No hay registros para formatear');
        console.groupEnd();
        return;
    }
    
    console.log('📊 Formateando', records.length, 'registros...');
    
    const formatted = [];
    records.forEach((record, idx) => {
        const actualRecord = record.record || record;
        
        try {
            let row;
            if (window.syncManager.config.formatRecord) {
                row = window.syncManager.config.formatRecord(actualRecord);
            } else {
                row = [
                    actualRecord.date || '',
                    actualRecord.time || '',
                    actualRecord.user || '',
                    actualRecord.obc || '',
                    actualRecord.codigo || '',
                    actualRecord.ubicacion || '',
                    actualRecord.nota || ''
                ];
            }
            formatted.push(row);
            
            if (idx < 3) {
                console.log(`  ${idx + 1}. Formateado:`, row);
            }
        } catch (e) {
            console.error(`❌ Error formateando registro ${idx + 1}:`, e, actualRecord);
        }
    });
    
    console.log('✅ Registros formateados exitosamente:', formatted.length);
    console.log('📋 Muestra de valores formateados:', formatted.slice(0, 3));
    
    console.groupEnd();
    return formatted;
}

// ==================== FUNCIÓN 4: VERIFICAR ESCRITURA EN GOOGLE SHEETS ====================
async function debugGoogleSheetsWrite() {
    console.group('📤 PRUEBA DE ESCRITURA EN GOOGLE SHEETS');
    
    if (!window.syncManager) {
        console.error('❌ syncManager NO EXISTE');
        console.groupEnd();
        return;
    }
    
    // Verificar token
    const token = gapi?.client?.getToken();
    if (!token) {
        console.error('❌ No hay token de Google');
        console.groupEnd();
        return;
    }
    console.log('✅ Token de Google disponible');
    
    // Verificar configuración
    const config = window.syncManager.config;
    console.log('📋 Configuración:');
    console.log('  - SpreadsheetId:', config.spreadsheetId);
    console.log('  - SheetName:', config.sheetName);
    
    const records = window.syncManager.pendingSync || [];
    if (records.length === 0) {
        console.log('⚠️ No hay registros pendientes para sincronizar');
        console.groupEnd();
        return;
    }
    
    console.log('📊 Registros pendientes:', records.length);
    
    // Deduplicar
    const deduplicated = window.syncManager._deduplicateBatch(
        records.map(r => r.record || r)
    );
    console.log('🔍 Después de deduplicación:', deduplicated.length);
    
    if (deduplicated.length < records.length) {
        console.warn(`⚠️ Se eliminaron ${records.length - deduplicated.length} duplicados`);
    }
    
    // Formatear
    const values = deduplicated.map(r => {
        if (config.formatRecord) {
            return config.formatRecord(r);
        }
        return [r.date, r.time, r.user, r.obc, r.codigo, r.ubicacion, r.nota];
    });
    
    console.log('📝 Valores formateados:', values.length);
    console.log('📋 Primeros 3 valores:', values.slice(0, 3));
    
    console.groupEnd();
    
    return {
        records: records.length,
        deduplicated: deduplicated.length,
        formatted: values.length,
        values: values
    };
}

// ==================== FUNCIÓN 5: SINCRONIZACIÓN DE PRUEBA ====================
async function debugTestSync() {
    console.group('🧪 PRUEBA DE SINCRONIZACIÓN');
    
    const result = await debugGoogleSheetsWrite();
    if (!result || result.formatted === 0) {
        console.error('❌ No hay datos para sincronizar');
        console.groupEnd();
        return;
    }
    
    console.log('⏳ Intentando sincronizar', result.formatted, 'registros...');
    
    try {
        const syncResult = await window.syncManager.syncNow(true);
        console.log('✅ Sincronización completada:', syncResult);
    } catch (e) {
        console.error('❌ Error en sincronización:', e);
    }
    
    console.groupEnd();
}

// ==================== FUNCIÓN 6: VERIFICAR ESCRITURA DIRECTA ====================
async function debugDirectWrite() {
    console.group('🔬 PRUEBA DE ESCRITURA DIRECTA (sin deduplicación)');
    
    if (!gapi?.client?.getToken()) {
        console.error('❌ No hay token de Google');
        console.groupEnd();
        return;
    }
    
    const config = window.syncManager?.config;
    if (!config) {
        console.error('❌ No hay configuración de syncManager');
        console.groupEnd();
        return;
    }
    
    // Crear 3 registros de prueba
    const testRecords = [
        ['TEST1', new Date().toLocaleTimeString(), 'DEBUG_USER', 'TEST_OBC', 'CODE1', 'LOC1', 'Prueba 1'],
        ['TEST2', new Date().toLocaleTimeString(), 'DEBUG_USER', 'TEST_OBC', 'CODE2', 'LOC2', 'Prueba 2'],
        ['TEST3', new Date().toLocaleTimeString(), 'DEBUG_USER', 'TEST_OBC', 'CODE3', 'LOC3', 'Prueba 3']
    ];
    
    console.log('📝 Registros de prueba:', testRecords);
    
    try {
        const range = `${config.sheetName}!A:Z`;
        console.log('📤 Escribiendo en:', range);
        
        const response = await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: config.spreadsheetId,
            range: range,
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: testRecords }
        });
        
        console.log('✅ Escritura exitosa!');
        console.log('📊 Respuesta:', response.result);
        console.log('📍 Rango actualizado:', response.result.updates?.updatedRange);
        console.log('📈 Filas actualizadas:', response.result.updates?.updatedRows);
        
        if (response.result.updates?.updatedRows === testRecords.length) {
            console.log('✅ TODOS LOS REGISTROS SE ESCRIBIERON CORRECTAMENTE');
        } else {
            console.error('❌ PROBLEMA: Solo se escribieron', response.result.updates?.updatedRows, 'de', testRecords.length, 'registros');
        }
        
    } catch (e) {
        console.error('❌ Error en escritura directa:', e);
    }
    
    console.groupEnd();
}

// ==================== FUNCIÓN 7: ANÁLISIS COMPLETO ====================
async function debugFullAnalysis() {
    console.log('🔍 ===== ANÁLISIS COMPLETO DE SINCRONIZACIÓN =====\n');
    
    await debugSyncState();
    console.log('\n');
    
    debugDeduplication();
    console.log('\n');
    
    debugFormatting();
    console.log('\n');
    
    await debugGoogleSheetsWrite();
    console.log('\n');
    
    console.log('🔍 ===== FIN DEL ANÁLISIS =====');
    console.log('\n📋 COMANDOS DISPONIBLES:');
    console.log('  - debugSyncState()         : Ver estado actual');
    console.log('  - debugDeduplication()     : Analizar deduplicación');
    console.log('  - debugFormatting()        : Verificar formateo');
    console.log('  - debugGoogleSheetsWrite() : Simular escritura');
    console.log('  - debugTestSync()          : Sincronizar ahora');
    console.log('  - debugDirectWrite()       : Prueba de escritura directa');
    console.log('  - debugFullAnalysis()      : Ejecutar todo de nuevo');
}

// Hacer funciones disponibles globalmente
window.debugSyncState = debugSyncState;
window.debugDeduplication = debugDeduplication;
window.debugFormatting = debugFormatting;
window.debugGoogleSheetsWrite = debugGoogleSheetsWrite;
window.debugTestSync = debugTestSync;
window.debugDirectWrite = debugDirectWrite;
window.debugFullAnalysis = debugFullAnalysis;

// Ejecutar análisis completo automáticamente
debugFullAnalysis();
