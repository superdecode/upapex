// ==================== MÓDULO RESUMEN DE ENTREGA ====================
// Este módulo maneja la impresión de la hoja adicional "Resumen de Entrega"
// que se agrega al final del folio de entrega principal.

/**
 * Genera el HTML de la hoja "Resumen de Entrega"
 * @param {string} folioCompleto - Folio completo (ej: "DSP-20250129-01")
 * @param {string} conductor - Nombre del conductor
 * @param {string} unidad - Unidad/placas
 * @param {number} totalDespachado - Total de cajas despachadas
 * @returns {string} - HTML de la hoja de resumen
 */
function generateResumenEntregaHTML(folioCompleto, conductor, unidad, totalDespachado) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Resumen de Entrega - ${folioCompleto}</title>
            <style>
                @page {
                    size: letter;
                    margin: 15mm;
                }

                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    font-size: 10pt;
                    line-height: 1.3;
                    color: #334155;
                    background: white;
                }

                /* Header igual al folio principal */
                .header {
                    border: 1px solid #fed7aa;
                    margin-bottom: 12px;
                    padding: 0;
                    page-break-inside: avoid;
                }

                .header-row {
                    display: flex;
                    border-bottom: 1px solid #fed7aa;
                    line-height: 1.2;
                }

                .header-row:last-child {
                    border-bottom: none;
                }

                .header-cell {
                    padding: 5px 8px;
                    border-right: 1px solid #fed7aa;
                    flex: 1;
                    display: flex;
                    align-items: center;
                }

                .header-cell:last-child {
                    border-right: none;
                }

                .header-label {
                    font-weight: 600;
                    color: #78716c;
                    font-size: 8.5pt;
                    margin-right: 4px;
                }

                .header-value {
                    color: #292524;
                    font-weight: 600;
                    font-size: 9pt;
                }

                .header-title {
                    background: #ffedd5;
                    color: #9a3412;
                    padding: 6px;
                    text-align: center;
                    font-weight: 700;
                    font-size: 10pt;
                    letter-spacing: 0.5px;
                }

                /* Resumen de cantidades */
                .resumen-cantidades {
                    border: 1px solid #fed7aa;
                    margin-bottom: 15px;
                    padding: 0;
                }

                .resumen-row {
                    display: flex;
                    background: #fff7ed;
                    border-bottom: 1px solid #fed7aa;
                }

                .resumen-row:last-child {
                    border-bottom: none;
                }

                .resumen-item {
                    flex: 1;
                    padding: 8px 12px;
                    border-right: 1px solid #fed7aa;
                    text-align: center;
                }

                .resumen-item:last-child {
                    border-right: none;
                }

                .resumen-label {
                    font-weight: 600;
                    color: #78716c;
                    font-size: 8.5pt;
                    text-transform: uppercase;
                    display: block;
                    margin-bottom: 4px;
                }

                .resumen-value {
                    font-size: 14pt;
                    font-weight: 700;
                    color: #292524;
                }

                /* Tabla de rechazos */
                .section-title {
                    background: #ffedd5;
                    color: #9a3412;
                    padding: 6px;
                    text-align: center;
                    font-weight: 700;
                    font-size: 10pt;
                    letter-spacing: 0.5px;
                    border: 1px solid #fed7aa;
                    margin-bottom: 10px;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    border: 1px solid #fed7aa;
                    table-layout: fixed;
                }

                th {
                    background: #fff7ed;
                    color: #78716c;
                    padding: 6px 5px;
                    text-align: left;
                    font-size: 8.5pt;
                    font-weight: 600;
                    border-bottom: 1px solid #fed7aa;
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                }

                td {
                    padding: 12px 5px;
                    border-bottom: 1px solid #fed7aa;
                    font-size: 9pt;
                    color: #292524;
                    height: 30px;
                }

                tbody tr:nth-child(even) {
                    background: #fffbeb;
                }

                /* Columnas específicas */
                .col-numero { width: 35px; text-align: center; }
                .col-codigo { width: 35%; }
                .col-cant { width: 15%; text-align: center; }
                .col-observacion { width: 50%; }

                /* Zona de firmas */
                .firmas-container {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 40px;
                    padding-top: 20px;
                }

                .firma-item {
                    flex: 1;
                    text-align: center;
                }

                .firma-linea {
                    border-top: 1px solid #334155;
                    margin: 60px 30px 8px 30px;
                }

                .firma-label {
                    font-weight: 600;
                    color: #78716c;
                    font-size: 9pt;
                }

                .firma-nombre {
                    color: #292524;
                    font-weight: 600;
                    font-size: 9pt;
                }

                /* Footer */
                .footer-info {
                    margin-top: 20px;
                    padding-top: 10px;
                    border-top: 1px solid #fed7aa;
                    text-align: center;
                    font-size: 8pt;
                    color: #78716c;
                }

                @media print {
                    body {
                        print-color-adjust: exact;
                        -webkit-print-color-adjust: exact;
                    }

                    .header-title, .section-title {
                        background: #ffedd5 !important;
                        color: #9a3412 !important;
                    }

                    th {
                        background: #fff7ed !important;
                        color: #78716c !important;
                    }

                    tbody tr:nth-child(even) {
                        background: #fffbeb !important;
                    }

                    .header,
                    table,
                    th,
                    td {
                        border-color: #fed7aa !important;
                    }

                    tr {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <!-- Encabezado (mismo que el folio principal) -->
            <div class="header">
                <div class="header-title">RESUMEN DE ENTREGA</div>
                <div class="header-row">
                    <div class="header-cell">
                        <span class="header-label">Folio:</span>
                        <span class="header-value">${folioCompleto}</span>
                    </div>
                    <div class="header-cell">
                        <span class="header-label">Conductor:</span>
                        <span class="header-value">${conductor}</span>
                    </div>
                    <div class="header-cell">
                        <span class="header-label">Unidad:</span>
                        <span class="header-value">${unidad}</span>
                    </div>
                </div>
            </div>

            <!-- Resumen de cantidades -->
            <div class="resumen-cantidades">
                <div class="resumen-row">
                    <div class="resumen-item">
                        <span class="resumen-label">Despachado</span>
                        <span class="resumen-value">${totalDespachado}</span>
                    </div>
                    <div class="resumen-item">
                        <span class="resumen-label">Entregado</span>
                        <span class="resumen-value">_______</span>
                    </div>
                    <div class="resumen-item">
                        <span class="resumen-label">Cant. Rechazos</span>
                        <span class="resumen-value">_______</span>
                    </div>
                </div>
            </div>

            <!-- Tabla de detallado de rechazos -->
            <div class="section-title">DETALLADO RECHAZOS</div>
            <table>
                <thead>
                    <tr>
                        <th class="col-numero">#</th>
                        <th class="col-codigo">CÓDIGO</th>
                        <th class="col-cant">CANT</th>
                        <th class="col-observacion">OBSERVACIÓN</th>
                    </tr>
                </thead>
                <tbody>
                    ${Array.from({length: 16}, (_, i) => `
                        <tr>
                            <td class="col-numero">${i + 1}</td>
                            <td class="col-codigo"></td>
                            <td class="col-cant"></td>
                            <td class="col-observacion"></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <!-- Zona de firmas -->
            <div class="firmas-container">
                <div class="firma-item">
                    <div class="firma-linea"></div>
                    <div class="firma-label">Conductor Nombre</div>
                    <div class="firma-nombre">${conductor}</div>
                </div>
                <div class="firma-item">
                    <div class="firma-linea"></div>
                    <div class="firma-label">Recibe</div>
                </div>
            </div>

            <!-- Footer -->
            <div class="footer-info">
                📅 Generado el ${new Date().toLocaleString('es-MX')} • Sistema de Despacho WMS
            </div>
        </body>
        </html>
    `;
}

/**
 * Imprime el folio de entrega con o sin el resumen de entrega
 * @param {string} folioCompleto - Folio completo
 * @param {boolean} incluirResumen - Si se incluye la hoja de resumen
 */
function printFolioConResumen(folioCompleto, incluirResumen = true) {
    // Validar que se pasó un folio
    if (!folioCompleto) {
        showNotification('⚠️ No hay folio especificado', 'warning');
        return;
    }

    // Obtener órdenes del folio
    const ordenesDelFolio = STATE.localValidated.filter(record => record.folio === folioCompleto);

    if (ordenesDelFolio.length === 0) {
        showNotification('⚠️ No hay órdenes en este folio', 'warning');
        return;
    }

    // Obtener información del folio
    const primeraOrden = ordenesDelFolio[0];
    const conductor = primeraOrden.operador || primeraOrden.conductor || 'N/A';
    const unidad = primeraOrden.unidad || 'N/A';

    // Calcular total despachado
    const ordenesDetailList = [];
    ordenesDelFolio.forEach(record => {
        const orderData = STATE.obcData.get(record.orden) || {};
        ordenesDetailList.push({
            orden: record.orden,
            cantidadDespachar: record.cantDespacho || record.cantidadDespachar || 0
        });
    });

    const totalDespachado = ordenesDetailList.reduce((sum, item) => sum + item.cantidadDespachar, 0);

    // Imprimir el folio con o sin resumen (ahora en el mismo documento)
    printFolioDelivery(folioCompleto, incluirResumen);

    // Mostrar notificación apropiada
    if (incluirResumen) {
        console.log('✅ Incluyendo hoja de Resumen de Entrega en el mismo documento');
        showNotification('🖨️ Preparando impresión con Resumen de Entrega...', 'info');
    } else {
        showNotification('🖨️ Preparando impresión del folio principal...', 'info');
    }
}

/**
 * Muestra un modal de confirmación para incluir o no el resumen de entrega
 * @param {string} folioCompleto - Folio completo
 */
function showResumenEntregaModal(folioCompleto) {
    // Crear modal si no existe
    let modal = document.getElementById('resumen-entrega-modal');

    if (!modal) {
        // Crear el modal
        modal = document.createElement('div');
        modal.id = 'resumen-entrega-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <div class="modal-title">
                        <span>🖨️</span>
                        <span>Opciones de Impresión</span>
                    </div>
                    <button class="modal-close" onclick="closeResumenEntregaModal()">×</button>
                </div>
                <div class="modal-body">
                    <div style="text-align: center; padding: 20px;">
                        <p style="font-size: 1.1em; color: #666; margin-bottom: 20px;">
                            ¿Deseas incluir la hoja de <strong>Resumen de Entrega</strong> al final del folio?
                        </p>
                        <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 4px; text-align: left; margin-bottom: 15px;">
                            <p style="margin: 0; font-size: 0.9em; color: #1e40af;">
                                <strong>📋 La hoja de Resumen de Entrega incluye:</strong>
                            </p>
                            <ul style="margin: 8px 0 0 20px; font-size: 0.9em; color: #1e40af;">
                                <li>Resumen de cantidades (Despachado/Entregado/Rechazos)</li>
                                <li>Tabla para anotar rechazos manualmente</li>
                                <li>Zona de firmas para el conductor y quien recibe</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="modal-footer" style="justify-content: center; gap: 10px; display: flex; flex-wrap: wrap;">
                    <button class="btn btn-success" onclick="confirmarImpresionConResumen(true)" style="flex: 1; min-width: 140px;">
                        ✅ Sí, incluir Resumen
                    </button>
                    <button class="btn btn-warning" onclick="confirmarImpresionConResumen(false)" style="flex: 1; min-width: 140px; background: var(--warning); color: white;">
                        📄 Solo Folio Principal
                    </button>
                    <button class="btn btn-secondary" onclick="closeResumenEntregaModal()" style="flex: 1; min-width: 140px;">
                        ❌ Cancelar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Mostrar modal
    modal.classList.add('show');

    // Guardar el folio en una variable temporal
    window.tempFolioForPrint = folioCompleto;
}

/**
 * Cierra el modal de confirmación de resumen de entrega
 */
function closeResumenEntregaModal() {
    const modal = document.getElementById('resumen-entrega-modal');
    if (modal) {
        modal.classList.remove('show');
    }
    window.tempFolioForPrint = null;
}

/**
 * Confirma la impresión con o sin resumen
 * @param {boolean} incluirResumen - Si se incluye el resumen
 */
function confirmarImpresionConResumen(incluirResumen) {
    const folioCompleto = window.tempFolioForPrint;

    if (!folioCompleto) {
        showNotification('⚠️ Error: No se encontró el folio', 'warning');
        return;
    }

    closeResumenEntregaModal();

    // Ejecutar impresión
    printFolioConResumen(folioCompleto, incluirResumen);
}

// Exponer funciones globalmente
window.generateResumenEntregaHTML = generateResumenEntregaHTML;
window.printFolioConResumen = printFolioConResumen;
window.showResumenEntregaModal = showResumenEntregaModal;
window.closeResumenEntregaModal = closeResumenEntregaModal;
window.confirmarImpresionConResumen = confirmarImpresionConResumen;
