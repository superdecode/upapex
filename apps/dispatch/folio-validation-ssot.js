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
        console.warn('⚠️ [SSOT] Google Sheets API no disponible, usando validación local');
        // Fallback a validación local
        return fallbackToLocalValidation(folioNumber, conductor, unidad, dateKey);
    }

    try {
        // Verificar autenticación
        const token = gapi.client.getToken();
        if (!token) {
            console.warn('⚠️ [SSOT] Usuario no autenticado, usando validación local');
            // Fallback a validación local en vez de permitir por defecto
            return fallbackToLocalValidation(folioNumber, conductor, unidad, dateKey);
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

        // Si es error de autenticación, mostrar banner y usar fallback local
        if (error?.result?.error?.code === 401 || error?.status === 401) {
            console.warn('⚠️ [SSOT] Error de autenticación, mostrando banner de reconexión');
            showAuthErrorBanner();
            return fallbackToLocalValidation(folioNumber, conductor, unidad, dateKey);
        }

        // Para otros errores, usar fallback local
        console.warn('⚠️ [SSOT] Usando validación local como fallback');
        return fallbackToLocalValidation(folioNumber, conductor, unidad, dateKey);
    }
}

/**
 * Fallback a validación local cuando SSOT no está disponible
 */
function fallbackToLocalValidation(folioNumber, conductor, unidad, dateKey) {
    console.log('🔄 [FALLBACK] Usando validación local para folio:', folioNumber);

    const foliosDelDia = STATE.foliosDeCargas?.get(dateKey) || new Map();
    const folioInfo = foliosDelDia.get(folioNumber);

    // Si no existe en caché local, está disponible
    if (!folioInfo) {
        return {
            available: true,
            reason: 'Disponible (validación local)'
        };
    }

    // Si es la misma combinación, puede reutilizarse
    if (folioInfo.conductor === conductor && folioInfo.unidad === unidad) {
        return {
            available: true,
            reason: 'Reutilizable (misma combinación)',
            reutilizable: true
        };
    }

    // Ocupado por otra combinación
    return {
        available: false,
        reason: `Usado por ${folioInfo.conductor}/${folioInfo.unidad}`,
        usadoPor: `${folioInfo.conductor}/${folioInfo.unidad}`
    };
}

/**
 * Muestra el banner de error de autenticación
 */
function showAuthErrorBanner() {
    // Evitar múltiples banners
    if (document.getElementById('auth-error-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'auth-error-banner';
    banner.className = 'auth-error-banner slide-down';
    banner.innerHTML = `
        <div class="auth-error-content">
            <span class="auth-error-icon">⚠️</span>
            <span class="auth-error-text">Sesión de Google desconectada. Reconecta para sincronizar con la base de datos.</span>
            <button class="auth-error-btn" onclick="handleReconnectFromBanner()">🔗 Reconectar</button>
            <button class="auth-error-close" onclick="closeAuthErrorBanner()">×</button>
        </div>
    `;

    // Agregar estilos si no existen
    if (!document.getElementById('auth-error-styles')) {
        const styles = document.createElement('style');
        styles.id = 'auth-error-styles';
        styles.textContent = `
            .auth-error-banner {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: linear-gradient(135deg, #ff6b6b, #ee5a24);
                color: white;
                padding: 12px 20px;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transform: translateY(-100%);
                transition: transform 0.3s ease-out;
            }
            .auth-error-banner.slide-down {
                transform: translateY(0);
            }
            .auth-error-content {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                max-width: 1200px;
                margin: 0 auto;
                flex-wrap: wrap;
            }
            .auth-error-icon {
                font-size: 1.2em;
            }
            .auth-error-text {
                font-weight: 500;
            }
            .auth-error-btn {
                background: white;
                color: #ee5a24;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.2s;
            }
            .auth-error-btn:hover {
                background: #f8f8f8;
                transform: scale(1.05);
            }
            .auth-error-close {
                background: transparent;
                border: none;
                color: white;
                font-size: 1.5em;
                cursor: pointer;
                padding: 0 8px;
                opacity: 0.8;
            }
            .auth-error-close:hover {
                opacity: 1;
            }
        `;
        document.head.appendChild(styles);
    }

    document.body.prepend(banner);

    // Trigger animation
    requestAnimationFrame(() => {
        banner.classList.add('slide-down');
    });
}

/**
 * Cierra el banner de error de autenticación
 */
function closeAuthErrorBanner() {
    const banner = document.getElementById('auth-error-banner');
    if (banner) {
        banner.style.transform = 'translateY(-100%)';
        setTimeout(() => banner.remove(), 300);
    }
}

/**
 * Maneja la reconexión desde el banner
 */
async function handleReconnectFromBanner() {
    console.log('🔗 [AUTH] Iniciando reconexión desde banner...');
    closeAuthErrorBanner();

    // Llamar al login de Google
    if (typeof handleLogin === 'function') {
        handleLogin();
    } else if (typeof AuthManager !== 'undefined' && AuthManager.login) {
        AuthManager.login();
    } else {
        showNotification('⚠️ Sistema de autenticación no disponible', 'warning');
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
window.fallbackToLocalValidation = fallbackToLocalValidation;
window.showAuthErrorBanner = showAuthErrorBanner;
window.closeAuthErrorBanner = closeAuthErrorBanner;
window.handleReconnectFromBanner = handleReconnectFromBanner;
