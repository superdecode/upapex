// ==================== MÓDULO DE EDICIÓN DE FOLIOS ====================

// Variable global para almacenar el folio en edición
let currentEditingFolio = null;
let pendingMergeData = null;
let originalFolioData = null; // Datos históricos del folio

/**
 * Abre el modal de edición de folio
 * @param {string} folioCompleto - Folio completo (ej: "20250109-01")
 */
function openEditFolioModal(folioCompleto) {
    console.log('⚙️ Abriendo modal de edición para folio:', folioCompleto);
    
    currentEditingFolio = folioCompleto;
    
    // Obtener órdenes del folio y eliminar duplicados
    const ordenesDelFolioRaw = STATE.localValidated.filter(r => r.folio === folioCompleto);
    const ordenesDelFolio = removeDuplicateOrders(ordenesDelFolioRaw);

    if (ordenesDelFolio.length === 0) {
        showNotification('❌ No se encontraron órdenes en este folio', 'error');
        return;
    }
    
    // MEJORA 1: Recuperar datos históricos del folio desde BD
    const firstRecord = ordenesDelFolio[0];
    const currentConductor = firstRecord.operador || firstRecord.conductor || '';
    const currentUnidad = firstRecord.unidad || '';
    const currentFolioNumber = folioCompleto.split('-').pop();
    
    // Guardar datos originales para comparación
    originalFolioData = {
        folio: folioCompleto,
        folioNumber: currentFolioNumber,
        conductor: currentConductor,
        unidad: currentUnidad,
        ordersCount: ordenesDelFolio.length
    };
    
    console.log('📋 Datos históricos recuperados:', originalFolioData);
    
    // Mostrar folio actual en tarjeta informativa
    document.getElementById('edit-folio-current').textContent = folioCompleto;
    
    // Mostrar conductor y unidad actuales en tarjeta informativa
    const conductorDisplay = document.getElementById('edit-folio-conductor-display');
    const unidadDisplay = document.getElementById('edit-folio-unidad-display');
    if (conductorDisplay) {
        conductorDisplay.textContent = currentConductor || 'N/A';
    }
    if (unidadDisplay) {
        unidadDisplay.textContent = currentUnidad || 'N/A';
    }
    
    // MEJORA 2: Poblar dropdown de conductores con resaltado del valor actual
    const conductorSelect = document.getElementById('edit-folio-conductor');
    conductorSelect.innerHTML = '<option value="">Seleccionar Conductor...</option>';
    
    // FIX: Usar STATE.operadores (no operadoresData)
    if (STATE.operadores && STATE.operadores.length > 0) {
        console.log('📋 Cargando conductores:', STATE.operadores.length);
        STATE.operadores.forEach(op => {
            const option = document.createElement('option');
            option.value = op;
            
            // Resaltar valor actual con check
            if (op === currentConductor) {
                option.textContent = `✔ ${op} (Actual)`;
                option.selected = true;
                option.setAttribute('data-is-current', 'true');
            } else {
                option.textContent = op;
            }
            
            conductorSelect.appendChild(option);
        });
    } else {
        console.warn('⚠️ STATE.operadores está vacío o no definido');
    }
    
    // Poblar dropdown de unidades basado en conductor seleccionado
    updateEditFolioUnidades();
    
    // Preseleccionar unidad actual
    setTimeout(() => {
        const unidadSelect = document.getElementById('edit-folio-unidad');
        if (unidadSelect && currentUnidad) {
            unidadSelect.value = currentUnidad;
        }
        
        // Actualizar selector de folio
        updateEditFolioNumber();
    }, 100);
    
    // Mostrar modal
    document.getElementById('edit-folio-modal').classList.add('show');
    
    // MEJORA 4: Deshabilitar botón inicialmente
    const saveBtn = document.getElementById('btn-save-folio-edit');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
    }
}

/**
 * Actualiza el dropdown de unidades basado en el conductor seleccionado
 */
function updateEditFolioUnidades() {
    const conductorSelect = document.getElementById('edit-folio-conductor');
    const unidadSelect = document.getElementById('edit-folio-unidad');
    
    if (!conductorSelect || !unidadSelect) return;
    
    const selectedConductor = conductorSelect.value;
    
    unidadSelect.innerHTML = '<option value="">Seleccionar Unidad...</option>';
    
    if (!selectedConductor) return;
    
    // MEJORA 2: Filtrar unidades con resaltado del valor actual
    // FIX: STATE.unidades es un array simple, no tiene estructura de objetos
    if (STATE.unidades && STATE.unidades.length > 0) {
        console.log('📋 Cargando unidades:', STATE.unidades.length);
        
        // Obtener unidad actual si existe
        const currentUnidad = originalFolioData ? originalFolioData.unidad : '';
        
        // Mostrar todas las unidades (no hay filtro por conductor en la estructura actual)
        STATE.unidades.forEach(unidad => {
            const option = document.createElement('option');
            option.value = unidad;
            
            // Resaltar valor actual con check
            if (unidad === currentUnidad && selectedConductor === originalFolioData?.conductor) {
                option.textContent = `✔ ${unidad} (Actual)`;
                option.setAttribute('data-is-current', 'true');
            } else {
                option.textContent = unidad;
            }
            
            unidadSelect.appendChild(option);
        });
    } else {
        console.warn('⚠️ STATE.unidades está vacío o no definido');
    }
}

/**
 * Actualiza el selector de folio y muestra información
 * Usa validación local primero, SSOT como complemento si está disponible
 */
async function updateEditFolioNumber() {
    const conductorSelect = document.getElementById('edit-folio-conductor');
    const unidadSelect = document.getElementById('edit-folio-unidad');
    const folioSelect = document.getElementById('edit-folio-number');

    if (!conductorSelect || !unidadSelect || !folioSelect) return;

    const conductor = conductorSelect.value;
    const unidad = unidadSelect.value;

    if (!conductor || !unidad) {
        folioSelect.innerHTML = '<option value="">Seleccionar Conductor y Unidad primero...</option>';
        folioSelect.disabled = true;
        return;
    }

    folioSelect.disabled = false;

    // PRIORIDAD: Usar validación local (getAvailableFolios) que es más rápida y confiable
    console.log('🔍 [FOLIO EDIT] Obteniendo folios disponibles para:', conductor, unidad);

    let availableFolios;
    try {
        // Usar función local que ya existe en app.js
        if (typeof getAvailableFolios === 'function') {
            availableFolios = getAvailableFolios(conductor, unidad);
            console.log('✅ [FOLIO EDIT] Folios obtenidos localmente:', availableFolios);
        } else {
            console.warn('⚠️ [FOLIO EDIT] getAvailableFolios no disponible, generando lista básica');
            // Generar lista básica de 5 folios
            availableFolios = ['01', '02', '03', '04', '05'].map(f => ({
                value: f,
                folio: f,
                available: true,
                disabled: false
            }));
        }
    } catch (error) {
        console.error('❌ [FOLIO EDIT] Error obteniendo folios:', error);
        // Fallback: generar lista básica
        availableFolios = ['01', '02', '03', '04', '05'].map(f => ({
            value: f,
            folio: f,
            available: true,
            disabled: false
        }));
    }

    const currentFolioNumber = originalFolioData ? originalFolioData.folioNumber : '';
    const currentFolioCompleto = originalFolioData ? originalFolioData.folio : '';

    console.log(`[Folio Edit] Actualizando selector para ${conductor}/${unidad}`, availableFolios);
    console.log(`[Folio Edit] Folio actual: ${currentFolioCompleto} (Número: ${currentFolioNumber})`);

    // Actualizar opciones del selector
    folioSelect.innerHTML = '<option value="">📋 Seleccionar Folio...</option>';

    if (!availableFolios || availableFolios.length === 0) {
        folioSelect.innerHTML = '<option value="">⚠️ No hay folios disponibles</option>';
        return;
    }

    let disponibles = 0;
    let ocupados = 0;

    availableFolios.forEach(folioInfo => {
        const option = document.createElement('option');
        const folioValue = folioInfo.folio || folioInfo.value;
        option.value = folioValue;

        // Resaltar folio actual con check
        const isCurrent = folioValue === currentFolioNumber &&
                          conductor === originalFolioData?.conductor &&
                          unidad === originalFolioData?.unidad;

        if (isCurrent) {
            option.textContent = `✔ ${folioValue} (Folio Actual)`;
            option.setAttribute('data-is-current', 'true');
            disponibles++;
        } else if (folioInfo.reutilizable) {
            option.textContent = `${folioValue} - Puedes reutilizar este folio`;
            disponibles++;
        } else if (folioInfo.disabled === false || folioInfo.available === true) {
            option.textContent = `${folioValue} - Disponible`;
            disponibles++;
        } else {
            // Folio ocupado por otro
            const usadoPor = folioInfo.usadoPor || 'Otro conductor/unidad';
            option.textContent = `${folioValue} - Ocupado (${usadoPor})`;
            option.disabled = true;
            ocupados++;
        }

        folioSelect.appendChild(option);
    });

    console.log(`✅ [FOLIO EDIT] Disponibles: ${disponibles} | Ocupados: ${ocupados} | Total: ${availableFolios.length}`);

    // Validar cambios y actualizar botón
    validateFolioChanges();
}

/**
 * Cierra el modal de edición de folio
 */
function closeEditFolioModal() {
    document.getElementById('edit-folio-modal').classList.remove('show');
    currentEditingFolio = null;
    originalFolioData = null;

    // Limpiar formulario
    document.getElementById('edit-folio-conductor').value = '';
    document.getElementById('edit-folio-unidad').value = '';
    document.getElementById('edit-folio-number').value = '';

    // Rehabilitar botón
    const saveBtn = document.getElementById('btn-save-folio-edit');
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
    }
}

/**
 * Ejecuta la edición del folio
 */
async function executeEditFolio() {
    const conductor = document.getElementById('edit-folio-conductor').value;
    const unidad = document.getElementById('edit-folio-unidad').value;
    const folioNumber = document.getElementById('edit-folio-number').value;
    
    // Validaciones
    if (!conductor || !unidad || !folioNumber) {
        showNotification('⚠️ Debes completar todos los campos', 'warning');
        return;
    }
    
    if (!currentEditingFolio) {
        showNotification('❌ Error: No hay folio seleccionado', 'error');
        return;
    }
    
    // Generar nuevo folio completo
    const newFolioCompleto = generateFolio(folioNumber);
    
    console.log('💾 Ejecutando edición de folio:', {
        folioActual: currentEditingFolio,
        nuevoFolio: newFolioCompleto,
        conductor,
        unidad
    });
    
    // Obtener órdenes del folio actual y eliminar duplicados
    const ordenesDelFolioRaw = STATE.localValidated.filter(r => r.folio === currentEditingFolio);
    const ordenesDelFolio = removeDuplicateOrders(ordenesDelFolioRaw);

    // ESCENARIO A: Sin conflictos (folio nuevo o mismo conductor/unidad)
    const dateKey = getCurrentDateKey();
    const foliosDelDia = STATE.foliosDeCargas.get(dateKey) || new Map();
    const folioInfo = foliosDelDia.get(folioNumber);
    
    const isSameFolio = currentEditingFolio === newFolioCompleto;
    const isNewFolio = !folioInfo;
    const isSameCombo = folioInfo && folioInfo.conductor === conductor && folioInfo.unidad === unidad;
    
    if (isSameFolio && isSameCombo) {
        showNotification('ℹ️ No hay cambios que aplicar', 'info');
        closeEditFolioModal();
        return;
    }
    
    if (isNewFolio || isSameCombo) {
        // ESCENARIO A: Update simple
        await performSimpleUpdate(ordenesDelFolio, newFolioCompleto, conductor, unidad);
    } else {
        // ESCENARIO B: Posible duplicidad - mostrar modal de confirmación
        showMergeFolioModal(ordenesDelFolio, newFolioCompleto, conductor, unidad, folioInfo);
    }
}

/**
 * Realiza un update simple sin conflictos
 */
async function performSimpleUpdate(ordenes, newFolio, conductor, unidad) {
    console.log('✅ ESCENARIO A: Update simple sin conflictos');
    console.log(`   - Folio antiguo: ${currentEditingFolio}`);
    console.log(`   - Folio nuevo: ${newFolio}`);
    console.log(`   - Órdenes a transferir: ${ordenes.length}`);

    try {
        // IMPORTANTE: NO actualizar fecha/hora/usuario/timestamp al cambiar folio
        // Solo actualizar folio, conductor y unidad - preservar historial original
        // NO crear nuevos registros ni eliminar existentes - actualizar en sitio

        // Generar nota de cambio de folio para columna Incidencias (Columna O)
        const now = new Date();
        const fechaCambio = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const horaCambio = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
        const usuarioCambio = CURRENT_USER || 'Usuario';
        const notaCambioFolio = `Cambio de Folio: ${fechaCambio} - ${horaCambio} - ${usuarioCambio}`;

        console.log(`📝 [CAMBIO FOLIO] Nota de incidencia: ${notaCambioFolio}`);

        // Actualizar cada orden en STATE.localValidated IN-PLACE (sin cambiar ubicación)
        for (const orden of ordenes) {
            const index = STATE.localValidated.findIndex(r => r.orden === orden.orden);
            if (index !== -1) {
                const currentRecord = STATE.localValidated[index];

                // Preservar incidencias existentes y agregar nueva nota
                const incidenciasActuales = currentRecord.incidencias || '';
                const nuevasIncidencias = incidenciasActuales
                    ? `${incidenciasActuales} | ${notaCambioFolio}`
                    : notaCambioFolio;

                // Actualizar SOLO los campos de folio/conductor/unidad/incidencias
                // PRESERVAR todos los demás campos (fecha, hora, usuario, timestamp, etc.)
                STATE.localValidated[index] = {
                    ...currentRecord,
                    folio: newFolio,
                    operador: conductor,
                    conductor: conductor,
                    unidad: unidad,
                    incidencias: nuevasIncidencias
                    // NO actualizar: fecha, hora, usuario, timestamp, orden, destino, etc.
                };

                console.log(`   ✓ Orden ${orden.orden} actualizada IN-PLACE a folio ${newFolio}`);
                console.log(`   📝 Incidencia agregada: "${notaCambioFolio}"`);
            }
        }

        // Actualizar folios de carga
        const oldFolioNum = currentEditingFolio.split('-').pop();
        const newFolioNum = newFolio.split('-').pop();

        console.log(`   - Liberando folio antiguo: ${oldFolioNum}`);
        releaseFolio(oldFolioNum);

        console.log(`   - Marcando folio nuevo como usado: ${newFolioNum}`);
        markFolioAsUsed(conductor, unidad, newFolioNum);

        // Guardar estado local
        saveLocalState();

        // Sincronizar con BD de escritura - ACTUALIZAR registros existentes
        console.log('   - Sincronizando con BD de escritura (actualización IN-PLACE)...');
        if (dispatchSyncManager && typeof dispatchSyncManager.updateExistingRecord === 'function') {
            for (const orden of ordenes) {
                const record = STATE.localValidated.find(r => r.orden === orden.orden);
                if (record) {
                    console.log(`   📝 Actualizando registro existente para orden ${orden.orden}...`);
                    const result = await dispatchSyncManager.updateExistingRecord(record);
                    if (result.success) {
                        console.log(`   ✅ Orden ${orden.orden} actualizada en BD (fila ${result.rowIndex || 'N/A'})`);
                    } else {
                        console.warn(`   ⚠️ Error actualizando orden ${orden.orden}:`, result.error || result.message);
                    }
                }
            }
        } else {
            console.warn('   ⚠️ updateExistingRecord no disponible - usando pushImmediate (creará nuevas filas)');
            // Fallback a pushImmediate (creará nuevas filas)
            if (dispatchSyncManager) {
                for (const orden of ordenes) {
                    const record = STATE.localValidated.find(r => r.orden === orden.orden);
                    if (record) {
                        await dispatchSyncManager.pushImmediate(record);
                    }
                }
            }
        }

        console.log('   ✅ Sincronización completada');

        // IMPORTANTE: Actualizar UI completa
        console.log('   - Actualizando interfaz...');
        renderFoliosTable();
        renderValidatedTable();
        updateTabBadges();
        updateSummary();

        showNotification(`✅ Folio actualizado: ${ordenes.length} orden${ordenes.length > 1 ? 'es' : ''} transferida${ordenes.length > 1 ? 's' : ''} a ${newFolio}`, 'success');
        closeEditFolioModal();

    } catch (error) {
        console.error('❌ Error en update simple:', error);
        showNotification('❌ Error al actualizar folio: ' + error.message, 'error');
    }
}

/**
 * Muestra el modal de confirmación de merge
 */
function showMergeFolioModal(ordenesOrigen, folioDestino, conductor, unidad, folioInfo) {
    console.log('⚠️ ESCENARIO B: Posible duplicidad detectada');
    
    // Guardar datos para el merge
    pendingMergeData = {
        ordenesOrigen,
        folioDestino,
        conductor,
        unidad,
        folioInfo
    };
    
    // Obtener órdenes existentes en el folio destino y eliminar duplicados
    const ordenesExistentesRaw = STATE.localValidated.filter(r => r.folio === folioDestino);
    const ordenesExistentes = removeDuplicateOrders(ordenesExistentesRaw);

    // Poblar modal
    document.getElementById('merge-folio-source').textContent = currentEditingFolio;
    document.getElementById('merge-folio-orders-count').textContent = `${ordenesOrigen.length} orden${ordenesOrigen.length > 1 ? 'es' : ''}`;
    document.getElementById('merge-folio-target').textContent = folioDestino;
    document.getElementById('merge-folio-conductor').textContent = folioInfo.conductor;
    document.getElementById('merge-folio-unidad').textContent = folioInfo.unidad;
    document.getElementById('merge-folio-existing-orders').textContent = `${ordenesExistentes.length} orden${ordenesExistentes.length > 1 ? 'es' : ''}`;
    
    // Cerrar modal de edición y abrir modal de merge
    closeEditFolioModal();
    document.getElementById('merge-folio-modal').classList.add('show');
}

/**
 * Cierra el modal de merge
 */
function closeMergeFolioModal() {
    document.getElementById('merge-folio-modal').classList.remove('show');
    pendingMergeData = null;
}

/**
 * Confirma y ejecuta el merge de folios
 */
async function confirmMergeFolio() {
    if (!pendingMergeData) {
        showNotification('❌ Error: No hay datos de merge pendientes', 'error');
        return;
    }

    console.log('✅ Usuario confirmó merge de folios');

    const { ordenesOrigen, folioDestino, conductor, unidad } = pendingMergeData;

    try {
        // IMPORTANTE: NO actualizar fecha/hora/usuario/timestamp al cambiar folio
        // Solo actualizar folio, conductor y unidad - preservar historial original
        // NO crear nuevos registros ni eliminar existentes - actualizar en sitio

        // Generar nota de cambio de folio para columna Incidencias (Columna O)
        const now = new Date();
        const fechaCambio = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const horaCambio = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
        const usuarioCambio = CURRENT_USER || 'Usuario';
        const notaCambioFolio = `Cambio de Folio (Merge): ${fechaCambio} - ${horaCambio} - ${usuarioCambio}`;

        console.log(`📝 [MERGE FOLIO] Nota de incidencia: ${notaCambioFolio}`);

        // Transferir órdenes al folio destino IN-PLACE (sin cambiar ubicación)
        for (const orden of ordenesOrigen) {
            const index = STATE.localValidated.findIndex(r => r.orden === orden.orden);
            if (index !== -1) {
                const currentRecord = STATE.localValidated[index];

                // Preservar incidencias existentes y agregar nueva nota
                const incidenciasActuales = currentRecord.incidencias || '';
                const nuevasIncidencias = incidenciasActuales
                    ? `${incidenciasActuales} | ${notaCambioFolio}`
                    : notaCambioFolio;

                // Actualizar SOLO los campos de folio/conductor/unidad/incidencias
                // PRESERVAR todos los demás campos (fecha, hora, usuario, timestamp, etc.)
                STATE.localValidated[index] = {
                    ...currentRecord,
                    folio: folioDestino,
                    operador: conductor,
                    conductor: conductor,
                    unidad: unidad,
                    incidencias: nuevasIncidencias
                    // NO actualizar: fecha, hora, usuario, timestamp, orden, destino, etc.
                };

                console.log(`   ✓ Orden ${orden.orden} transferida IN-PLACE a folio ${folioDestino}`);
                console.log(`   📝 Incidencia agregada: "${notaCambioFolio}"`);
            }
        }

        // Liberar folio origen
        const oldFolioNum = currentEditingFolio.split('-').pop();
        releaseFolio(oldFolioNum);

        // Guardar estado local
        saveLocalState();

        // Sincronizar con BD de escritura - ACTUALIZAR registros existentes
        console.log('   - Sincronizando con BD de escritura (actualización IN-PLACE)...');
        if (dispatchSyncManager && typeof dispatchSyncManager.updateExistingRecord === 'function') {
            for (const orden of ordenesOrigen) {
                const record = STATE.localValidated.find(r => r.orden === orden.orden);
                if (record) {
                    console.log(`   📝 Actualizando registro existente para orden ${orden.orden}...`);
                    const result = await dispatchSyncManager.updateExistingRecord(record);
                    if (result.success) {
                        console.log(`   ✅ Orden ${orden.orden} actualizada en BD (fila ${result.rowIndex || 'N/A'})`);
                    } else {
                        console.warn(`   ⚠️ Error actualizando orden ${orden.orden}:`, result.error || result.message);
                    }
                }
            }
        } else {
            console.warn('   ⚠️ updateExistingRecord no disponible - usando pushImmediate (creará nuevas filas)');
            // Fallback a pushImmediate (creará nuevas filas)
            if (dispatchSyncManager) {
                for (const orden of ordenesOrigen) {
                    const record = STATE.localValidated.find(r => r.orden === orden.orden);
                    if (record) {
                        await dispatchSyncManager.pushImmediate(record);
                    }
                }
            }
        }

        console.log('   ✅ Sincronización completada');

        // IMPORTANTE: Actualizar UI completa
        console.log('   - Actualizando interfaz...');
        renderFoliosTable();
        renderValidatedTable();
        updateTabBadges();
        updateSummary();

        showNotification(`✅ Merge completado: ${ordenesOrigen.length} orden${ordenesOrigen.length > 1 ? 'es' : ''} transferida${ordenesOrigen.length > 1 ? 's' : ''} a ${folioDestino}`, 'success');
        closeMergeFolioModal();

    } catch (error) {
        console.error('❌ Error en merge de folios:', error);
        showNotification('❌ Error al combinar folios: ' + error.message, 'error');
    }
}

/**
 * MEJORA 4: Valida si hay cambios y habilita/deshabilita el botón de guardar
 */
function validateFolioChanges() {
    if (!originalFolioData) return;
    
    const conductorSelect = document.getElementById('edit-folio-conductor');
    const unidadSelect = document.getElementById('edit-folio-unidad');
    const folioSelect = document.getElementById('edit-folio-number');
    const saveBtn = document.getElementById('btn-save-folio-edit');
    
    if (!conductorSelect || !unidadSelect || !folioSelect || !saveBtn) return;
    
    const newConductor = conductorSelect.value;
    const newUnidad = unidadSelect.value;
    const newFolioNumber = folioSelect.value;
    
    // Verificar si hay cambios
    const hasChanges = (
        newConductor !== originalFolioData.conductor ||
        newUnidad !== originalFolioData.unidad ||
        newFolioNumber !== originalFolioData.folioNumber
    );
    
    // Verificar que todos los campos estén completos
    const allFieldsFilled = newConductor && newUnidad && newFolioNumber;
    
    // Habilitar botón solo si hay cambios Y todos los campos están completos
    if (hasChanges && allFieldsFilled) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.cursor = 'pointer';
        console.log('✅ Cambios detectados - Botón habilitado');
    } else {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.5';
        saveBtn.style.cursor = 'not-allowed';
        
        if (!hasChanges && allFieldsFilled) {
            console.log('ℹ️ Sin cambios - Botón deshabilitado');
        } else if (!allFieldsFilled) {
            console.log('⚠️ Campos incompletos - Botón deshabilitado');
        }
    }
}

// Exponer funciones globalmente
window.openEditFolioModal = openEditFolioModal;
window.closeEditFolioModal = closeEditFolioModal;
window.updateEditFolioUnidades = updateEditFolioUnidades;
window.updateEditFolioNumber = updateEditFolioNumber;
window.executeEditFolio = executeEditFolio;
window.closeMergeFolioModal = closeMergeFolioModal;
window.confirmMergeFolio = confirmMergeFolio;
window.validateFolioChanges = validateFolioChanges;
