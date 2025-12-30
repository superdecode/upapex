# Plan de Correcciones Dispatch App - Análisis Detallado

## Estado Actual del Código

Después de analizar el código actual en [app.js:1072-1200](app.js#L1072-L1200), identifiqué los siguientes problemas que deben corregirse:

---

## 🔴 PROBLEMA CRÍTICO #1: Búsqueda de Códigos de Caja

### Problema Actual
La función `executeSearch()` **NO** está buscando correctamente en la BD OBC (pestaña BD).

**Línea problemática:** [app.js:1153-1162](app.js#L1153-L1162)
```javascript
// 2.2. Buscar en customBarcode de OBC
if (!foundOrden) {
    for (const [orden, data] of STATE.obcData.entries()) {
        if (data.customBarcode && data.customBarcode.toUpperCase().includes(query)) {
            foundOrden = orden;
            foundSource = 'Código de Caja (customBarcode)';
            break;
        }
    }
}
```

### ¿Por qué falla?
1. **BD OBC no se está cargando desde la pestaña BD**: Actualmente se carga desde "Resumen" (gid=409854413), que es una tabla dinámica consolidada.
2. **La pestaña "Resumen" NO contiene códigos individuales de cajas**, solo órdenes consolidadas.
3. **Para buscar PLEC25033156863U010**, necesitamos cargar la pestaña "BD" (gid=0) que contiene el listado caja por caja.

### Solución Requerida

#### Paso 1: Agregar carga de BD Cajas (listado caja por caja)
Necesitamos agregar un nuevo STATE para almacenar TODAS las cajas individuales:

```javascript
let STATE = {
    obcData: new Map(),           // Órdenes consolidadas (desde Resumen)
    bdCajasData: new Map(),       // NUEVO: Cajas individuales (desde BD)
    obcDataFiltered: new Map(),
    // ... resto del estado
};
```

#### Paso 2: Parsear BD Cajas
Crear función para parsear la pestaña "BD" (gid=0):

```javascript
function parseBDCajasData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.bdCajasData.clear();

    // Parsear cada línea como una caja individual
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 9) {
            const obc = cols[0]?.trim();           // Columna A: OBC
            const codigo = cols[8]?.trim();        // Columna I: Código de caja

            if (obc && codigo) {
                // Guardar referencia: código → OBC
                if (!STATE.bdCajasData.has(codigo)) {
                    STATE.bdCajasData.set(codigo, []);
                }
                STATE.bdCajasData.get(codigo).push({
                    obc: obc,
                    referenceNo: cols[1]?.trim() || '',
                    shippingService: cols[2]?.trim() || '',
                    trackingCode: cols[3]?.trim() || '',
                    expectedArrival: cols[4]?.trim() || '',
                    remark: cols[5]?.trim() || '',
                    recipient: cols[6]?.trim() || '',
                    boxType: cols[7]?.trim() || '',
                    codigoCaja: codigo
                });
            }
        }
    }
}
```

#### Paso 3: Cargar BD Cajas en loadAllData()
Agregar en la función `loadAllData()`:

```javascript
// Load BD_CAJAS (listado caja por caja)
try {
    const bdCajasResponse = await fetch(CONFIG.SOURCES.BD_CAJAS);
    const bdCajasCsv = await bdCajasResponse.text();
    parseBDCajasData(bdCajasCsv);
    loaded++;
} catch (e) {
    console.error('Error loading BD_CAJAS:', e);
    errors.push('BD_CAJAS');
}
```

#### Paso 4: Refactorizar executeSearch() con prioridad correcta

```javascript
function executeSearch() {
    const searchInput = document.getElementById('search-input');
    const query = searchInput?.value.trim().toUpperCase();

    if (!query) {
        showNotification('⚠️ Ingresa un código para buscar', 'warning');
        return;
    }

    let foundOrders = []; // Array para múltiples coincidencias
    const isOBC = query.startsWith('OBC');

    if (!isOBC) {
        // ===== LÓGICA CRÍTICA PARA CÓDIGO DE CAJA =====

        // Extraer código base (eliminar número de caja)
        // PLEC25033156863U010 → PLEC25033156863
        const codeBaseMatch = query.match(/^([A-Z0-9]+?)(?:[U]\d{3})?$/);
        const codeBase = codeBaseMatch ? codeBaseMatch[1] : query;

        // PRIORIDAD 1: Buscar código COMPLETO en BD Cajas
        if (STATE.bdCajasData.has(query)) {
            const cajas = STATE.bdCajasData.get(query);
            cajas.forEach(caja => {
                foundOrders.push({
                    orden: caja.obc,
                    source: `Código Completo en BD: ${query}`,
                    confidence: 100,
                    matchedCode: query
                });
            });
        }

        // PRIORIDAD 2: Si no encontró por código completo, buscar por código BASE
        if (foundOrders.length === 0 && codeBase !== query) {
            for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
                if (codigo.includes(codeBase)) {
                    cajas.forEach(caja => {
                        foundOrders.push({
                            orden: caja.obc,
                            source: `Código Base en BD: ${codeBase}`,
                            confidence: 90,
                            matchedCode: codeBase
                        });
                    });
                }
            }
        }

        // PRIORIDAD 3: Buscar en Rastreo MNE
        if (foundOrders.length === 0) {
            for (const [orden, rastreoItems] of STATE.mneData.entries()) {
                const match = rastreoItems.find(r =>
                    (r.codigo && r.codigo.toUpperCase() === query) ||
                    (r.codigo && r.codigo.toUpperCase().includes(codeBase))
                );
                if (match) {
                    foundOrders.push({
                        orden,
                        source: 'Rastreo MNE',
                        confidence: 95
                    });
                }
            }
        }

        // PRIORIDAD 4: Buscar en Validaciones
        // ... resto de la lógica
    }

    // Si hay múltiples coincidencias
    if (foundOrders.length > 1) {
        showMultipleMatchesModal(foundOrders, query);
        return;
    }

    // Si hay una sola coincidencia
    if (foundOrders.length === 1) {
        const foundOrden = foundOrders[0].orden;
        const foundSource = foundOrders[0].source;
        // Continuar con validación de fecha...
    }

    if (foundOrders.length === 0) {
        showNotification('❌ No se encontró la orden o código', 'error');
        return;
    }
}
```

---

## 🟡 PROBLEMA #2: Cantidad de Cajas Incorrecta

### Problema Actual
**Línea:** [app.js:1212](app.js#L1212) (approx, en `renderKPICards`)

El sistema está tomando la cantidad de cajas desde:
- `validaciones.length` (Val3 - surtido)
- `rastreoData.length` (MNE)

### ¿Por qué es incorrecto?
La cantidad total de cajas debe venir de:
1. **BD OBC - pestaña Resumen, columna F**
2. O bien, **contar todas las cajas en BD OBC (pestaña BD) que pertenezcan a esa OBC**

### Solución
Actualizar `parseOBCData()` para incluir la columna F:

```javascript
function parseOBCData(csv) {
    const lines = csv.split('\n').filter(l => l.trim());
    STATE.obcData.clear();

    const ordersArray = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        if (cols.length >= 6) {
            const orden = cols[0]?.trim();
            if (orden) {
                ordersArray.push({
                    orden,
                    referenceNo: cols[1]?.trim() || '',
                    shippingService: cols[2]?.trim() || '',
                    trackingCode: cols[3]?.trim() || '',
                    expectedArrival: cols[4]?.trim() || '',
                    remark: cols[5]?.trim() || '',
                    recipient: cols[6]?.trim() || '',
                    boxType: cols[7]?.trim() || '',
                    customBarcode: cols[8]?.trim() || '',
                    // NUEVO: Cantidad de cajas desde columna F (índice 5)
                    totalCajas: parseInt(cols[5]?.trim()) || 0,
                    rowIndex: i
                });
            }
        }
    }

    // Procesamiento bottom-up
    ordersArray.reverse();
    ordersArray.forEach(orderData => {
        if (!STATE.obcData.has(orderData.orden)) {
            STATE.obcData.set(orderData.orden, orderData);
        }
    });
}
```

Luego usar `orderData.totalCajas` en lugar de `rastreoData.length`:

```javascript
const totalCajas = orderData.totalCajas || rastreoData.length || validaciones.length || 0;
```

---

## 🟡 PROBLEMA #3: Modal de Excepción de Fecha

### Problema Actual
**Línea:** [app.js:1119-1168](app.js#L1119-L1168) (`showDateExceptionDialog`)

El modal muestra `orderData.date` que **no existe** en el objeto.

### Solución
Usar `orderData.expectedArrival` que es la fecha correcta:

```javascript
const orderDate = orderData.expectedArrival || 'N/A';
```

---

## 🟠 PROBLEMA #4: Modal de Múltiples Coincidencias (NO EXISTE)

### Solución
Crear nuevo modal en `index.html`:

```html
<!-- MODAL DE MÚLTIPLES COINCIDENCIAS -->
<div class="modal-overlay" id="multiple-matches-modal">
    <div class="modal-content" style="max-width: 800px;">
        <div class="modal-header">
            <div class="modal-title">
                <span>🔍</span>
                <span>Múltiples Coincidencias Encontradas</span>
            </div>
            <button class="modal-close" onclick="closeMultipleMatchesModal()">×</button>
        </div>
        <div class="modal-body">
            <p style="margin-bottom: 20px; color: #666;">
                Se encontraron <strong id="matches-count">0</strong> órdenes que coinciden con tu búsqueda.
                Selecciona la orden correcta:
            </p>
            <div id="matches-list"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeMultipleMatchesModal()">Cancelar</button>
        </div>
    </div>
</div>
```

Función JavaScript:

```javascript
function showMultipleMatchesModal(foundOrders, query) {
    document.getElementById('matches-count').textContent = foundOrders.length;

    const matchesList = document.getElementById('matches-list');
    matchesList.innerHTML = foundOrders.map((match, index) => {
        const orderData = STATE.obcData.get(match.orden);
        const totalCajas = orderData?.totalCajas || 0;

        return `
            <div class="match-item" onclick="selectMatch('${match.orden}')">
                <div class="match-header">
                    <div class="match-obc">${match.orden}</div>
                    <div class="match-confidence">${match.confidence}% coincidencia</div>
                </div>
                <div class="match-details">
                    <div class="match-detail">📍 ${orderData?.recipient || 'N/A'}</div>
                    <div class="match-detail">📅 ${orderData?.expectedArrival || 'N/A'}</div>
                    <div class="match-detail">📦 ${totalCajas} cajas</div>
                </div>
                <div class="match-source">Fuente: ${match.source}</div>
            </div>
        `;
    }).join('');

    document.getElementById('multiple-matches-modal').classList.add('show');
}

function selectMatch(orden) {
    closeMultipleMatchesModal();
    showOrderInfo(orden);
}

function closeMultipleMatchesModal() {
    document.getElementById('multiple-matches-modal').classList.remove('show');
}
```

CSS:

```css
.match-item {
    padding: 15px;
    background: #f9fafb;
    border: 2px solid #e5e7eb;
    border-radius: 8px;
    margin-bottom: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
}

.match-item:hover {
    background: #fff5ed;
    border-color: var(--primary);
    transform: translateX(4px);
}

.match-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
}

.match-obc {
    font-weight: 700;
    font-size: 1.1em;
    color: var(--primary);
}

.match-confidence {
    background: rgba(249, 115, 22, 0.15);
    color: var(--primary);
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.85em;
    font-weight: 600;
}

.match-details {
    display: flex;
    gap: 15px;
    margin-bottom: 8px;
}

.match-detail {
    font-size: 0.9em;
    color: #666;
}

.match-source {
    font-size: 0.8em;
    color: #999;
    font-style: italic;
}
```

---

## 🟠 PROBLEMA #5: Estatus de Orden

### Solución
Crear función para calcular estatus:

```javascript
function calculateOrderStatus(totalCajas, cantidadDespachar) {
    if (!totalCajas || totalCajas === 0) return 'Sin Información';

    const porcentaje = (cantidadDespachar / totalCajas) * 100;

    if (porcentaje < 100) {
        return 'Parcial';
    } else if (porcentaje === 100) {
        return 'Completa';
    } else {
        return 'Anormalidad';
    }
}
```

Usar en KPI cards y modal de confirmación.

---

## 🟢 PROBLEMA #6: Resumen Vertical

Ya está implementado en CSS líneas 1666-1752. Solo necesita activarse en el sidebar.

---

## 🔵 PROBLEMA #7: Detalle Completo OBC

Agregar sección en `renderModalBody()`:

```javascript
// Detalle Completo OBC (similar a Track App)
if (orderData) {
    // Obtener todas las cajas de esta OBC desde bdCajasData
    const allBoxes = [];
    for (const [codigo, cajas] of STATE.bdCajasData.entries()) {
        cajas.forEach(caja => {
            if (caja.obc === orden) {
                allBoxes.push({ codigo, ...caja });
            }
        });
    }

    if (allBoxes.length > 0) {
        html += `
            <div class="section-card" id="section-detalle-obc">
                <div class="section-header" onclick="toggleSection('section-detalle-obc-content')">
                    <div class="section-header-left">
                        <div class="section-title">📦 Detalle Completo de Cajas OBC (${allBoxes.length})</div>
                    </div>
                    <span class="section-toggle collapsed" id="section-detalle-obc-content-toggle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </span>
                </div>
                <div class="section-content collapsed" id="section-detalle-obc-content">
                    <div class="table-wrapper">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Código de Caja</th>
                                    <th>Tipo de Caja</th>
                                    <th>Referencia</th>
                                    <th>Tracking</th>
                                    <th>Destino</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${allBoxes.map(box => `
                                    <tr>
                                        <td><code>${makeCopyable(box.codigo)}</code></td>
                                        <td>${box.boxType || '-'}</td>
                                        <td>${makeCopyable(box.referenceNo || '-')}</td>
                                        <td>${makeCopyable(box.trackingCode || '-')}</td>
                                        <td>${box.recipient || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }
}
```

---

## ⏰ PROBLEMA #8: UI del Selector de Fecha

### Problema
Botón "Confirmar" queda oculto detrás del calendario.

### Solución CSS
```css
.modal-footer {
    position: sticky;
    bottom: 0;
    background: #f8f9fa;
    z-index: 20;
}

.modal-footer {
    display: flex;
    gap: 10px;
    justify-content: center; /* Centrar horizontalmente */
}
```

---

## Orden de Implementación Recomendado

1. ✅ **Corregir búsqueda de códigos** (CRÍTICO)
2. ✅ **Corregir cantidad de cajas**
3. ✅ **Agregar modal de múltiples coincidencias**
4. ✅ **Implementar estatus de orden**
5. ✅ **Agregar detalle completo OBC**
6. ✅ **Corregir modal de excepción de fecha**
7. ✅ **Centrar botones en modales**
8. ✅ **Activar resumen vertical**

---

**Fecha:** 2025-12-30
**Desarrollador:** Claude Sonnet 4.5
