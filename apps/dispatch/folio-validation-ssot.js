// ==================== VALIDACIÓN DE FOLIOS CONTRA BD DE ESCRITURA (SSOT) ====================

/**
 * Valida si un folio está disponible consultando directamente la BD de escritura
 * Single Source of Truth (SSOT) - NO usa caché local
 * 
 * @param {string} folioNumber - Número de folio (ej: "01", "02")
 * @param {string} conductor - Nombre del conductor
 * @param {string} unidad - Unidad/Placas
 * @param {string} dateKey - Fecha en formato YYYY-MM-DD
 * @returns {Promise<Object>} - {available: boolean, reason?: string, existingOrders?: Array}
 */
async function validateFolioAgainstWriteDB(folioNumber, conductor, unidad, dateKey) {
    console.log('🔍 [SSOT] Validando folio contra BD de escritura:', {
        folioNumber,
        conductor,
        unidad,
        dateKey
    });

    // Verificar que Google Sheets API esté disponible
    if (!gapi?.client?.sheets) {
        console.error('❌ [SSOT] Google Sheets API no disponible');
        return {
            available: false,
            reason: 'API no disponible'
        };
    }

    try {
        // Verificar autenticación
        const token = gapi.client.getToken();
        if (!token) {
            console.warn('⚠️ [SSOT] Usuario no autenticado, no se puede validar folio');
            return {
                available: true, // Permitir por defecto si no hay autenticación
                reason: 'No autenticado - validación omitida'
            };
        }

        // Construir el folio completo en formato esperado
        const dateStr = dateKey.replace(/-/g, ''); // YYYY-MM-DD → YYYYMMDD
        const folioCompleto = `DSP-${dateStr}-${folioNumber}`;
        
        console.log('📋 [SSOT] Buscando folio completo:', folioCompleto);

        // Obtener nombre de la hoja
        let sheetName = 'BD';
        try {
            const metadataResponse = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: CONFIG.SPREADSHEET_WRITE
            });
            const sheets = metadataResponse.result.sheets;
            if (sheets && sheets.length > 0) {
                sheetName = sheets[0].properties.title;
            }
        } catch (e) {
            console.warn('⚠️ [SSOT] No se pudo obtener metadata, usando nombre por defecto:', e.message);
        }

        // Consultar DIRECTAMENTE la BD de escritura
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: `${sheetName}!A:R`
        });

        const rows = response.result.values;
        if (!rows || rows.length <= 1) {
            console.log('✅ [SSOT] BD vacía - Folio disponible');
            return {
                available: true,
                reason: 'BD vacía'
            };
        }

        // Buscar registros con este folio
        const matchingRecords = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowFolio = row[9]?.trim(); // Columna J (índice 9) = Folio
            
            if (rowFolio === folioCompleto) {
                matchingRecords.push({
                    rowIndex: i + 1,
                    orden: row[0]?.trim(),
                    operador: row[6]?.trim(),
                    unidad: row[7]?.trim(),
                    folio: rowFolio
                });
            }
        }

        console.log(`📊 [SSOT] Encontrados ${matchingRecords.length} registros con folio ${folioCompleto}`);

        // Si no hay registros, el folio está disponible
        if (matchingRecords.length === 0) {
            console.log('✅ [SSOT] Folio disponible - No existe en BD');
            return {
                available: true,
                reason: 'No existe en BD'
            };
        }

        // Si hay registros, verificar si son de la misma combinación conductor/unidad
        const sameCombo = matchingRecords.every(record => 
            record.operador === conductor && record.unidad === unidad
        );

        if (sameCombo) {
            console.log('✅ [SSOT] Folio reutilizable - Misma combinación conductor/unidad');
            return {
                available: true,
                reason: 'Reutilizable (misma combinación)',
                existingOrders: matchingRecords
            };
        }

        // Folio ocupado por otra combinación
        const firstRecord = matchingRecords[0];
        console.log('❌ [SSOT] Folio ocupado por otra combinación:', {
            conductor: firstRecord.operador,
            unidad: firstRecord.unidad,
            ordenes: matchingRecords.length
        });

        return {
            available: false,
            reason: `Folio usado por ${firstRecord.operador}/${firstRecord.unidad}`,
            existingOrders: matchingRecords
        };

    } catch (error) {
        console.error('❌ [SSOT] Error validando folio:', error);
        return {
            available: false,
            reason: 'Error de validación: ' + error.message
        };
    }
}

/**
 * Obtiene folios disponibles consultando la BD de escritura (SSOT)
 * Reemplaza la lógica basada en caché local
 * 
 * @param {string} conductor - Nombre del conductor
 * @param {string} unidad - Unidad/Placas
 * @param {string} dateKey - Fecha en formato YYYY-MM-DD (opcional, usa hoy por defecto)
 * @returns {Promise<Array>} - Array de objetos {folio, available, reason, existingOrders}
 */
async function getAvailableFoliosFromWriteDB(conductor, unidad, dateKey = null) {
    const date = dateKey || getCurrentDateKey();
    
    console.log('🔍 [SSOT] Obteniendo folios disponibles desde BD:', {
        conductor,
        unidad,
        date
    });

    const allFolios = ['01', '02', '03', '04', '05'];
    const results = [];

    // Validar cada folio contra la BD
    for (const folioNum of allFolios) {
        const validation = await validateFolioAgainstWriteDB(folioNum, conductor, unidad, date);
        
        results.push({
            folio: folioNum,
            available: validation.available,
            reason: validation.reason,
            existingOrders: validation.existingOrders || [],
            // Para compatibilidad con código existente
            value: folioNum,
            disabled: !validation.available,
            reutilizable: validation.reason?.includes('Reutilizable'),
            usadoPor: validation.reason?.includes('usado por') ? validation.reason.replace('Folio usado por ', '') : null
        });
    }

    console.log('📊 [SSOT] Resultados de validación:', results);
    return results;
}

/**
 * Valida un folio antes de confirmar despacho (modal de confirmación)
 * Usa SSOT para evitar conflictos
 * 
 * @param {string} folioNumber - Número de folio
 * @param {string} conductor - Conductor
 * @param {string} unidad - Unidad
 * @returns {Promise<Object>} - {valid: boolean, message: string}
 */
async function validateFolioBeforeDispatch(folioNumber, conductor, unidad) {
    console.log('🔍 [SSOT] Validando folio antes de despacho:', {
        folioNumber,
        conductor,
        unidad
    });

    const dateKey = getCurrentDateKey();
    const validation = await validateFolioAgainstWriteDB(folioNumber, conductor, unidad, dateKey);

    if (validation.available) {
        return {
            valid: true,
            message: validation.reason === 'No existe en BD' 
                ? 'Folio nuevo - Disponible para uso'
                : `Folio reutilizable (${validation.existingOrders.length} orden${validation.existingOrders.length > 1 ? 'es' : ''} existente${validation.existingOrders.length > 1 ? 's' : ''})`
        };
    }

    return {
        valid: false,
        message: validation.reason,
        existingOrders: validation.existingOrders
    };
}

/**
 * Limpia el caché local de folios (forzar recarga desde BD)
 */
function clearFoliosCache() {
    console.log('🗑️ [SSOT] Limpiando caché local de folios');
    STATE.foliosDeCargas.clear();
    saveLocalState();
}

// Exponer funciones globalmente
window.validateFolioAgainstWriteDB = validateFolioAgainstWriteDB;
window.getAvailableFoliosFromWriteDB = getAvailableFoliosFromWriteDB;
window.validateFolioBeforeDispatch = validateFolioBeforeDispatch;
window.clearFoliosCache = clearFoliosCache;
