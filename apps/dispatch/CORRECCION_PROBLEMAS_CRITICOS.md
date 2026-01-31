# Corrección de Problemas Críticos - Sistema de Despacho

## Fecha: 31 de Enero, 2026 (Noche - Correcciones Finales)

## 🚨 PROBLEMAS REPORTADOS

### 1. Error 401 en Carga de BD_CAJAS ✅ CORREGIDO

**Síntoma:**
```
[Error] Error loading BD_CAJAS:
TypeError: Load failed
	lazyLoadDataByDate (app.js:526)
[Error] Failed to load resource: the server responded with a status of 401
```

**Causa:**
Durante la optimización de carga, se cambió de usar `dispatchSyncManager.getReferenceData()` a `fetch()` directo, eliminando el manejo de autenticación y caché.

**Solución Aplicada:**
Restaurar el uso de `dispatchSyncManager` con fallback a fetch directo:

```javascript
// ANTES (causaba error 401):
const bdCajasResponse = await fetch(CONFIG.SOURCES.BD_CAJAS);

// DESPUÉS (usa syncManager con fallback):
let bdCajasCsv;
if (dispatchSyncManager) {
    bdCajasCsv = await dispatchSyncManager.getReferenceData('bd_cajas', CONFIG.SOURCES.BD_CAJAS, true);
} else {
    const cacheBuster = Date.now();
    const url = CONFIG.SOURCES.BD_CAJAS.includes('?')
        ? `${CONFIG.SOURCES.BD_CAJAS}&_t=${cacheBuster}`
        : `${CONFIG.SOURCES.BD_CAJAS}?_t=${cacheBuster}`;
    const bdCajasResponse = await fetch(url, { cache: 'no-store' });
    bdCajasCsv = await bdCajasResponse.text();
}
```

**Ubicación:** [app.js:517-537](app.js#L517-L537)

---

### 2. Desincronización Entre Contador y Registros de Tabla

**Síntoma:**
Al cambiar el rango de fechas, el contador muestra "75 órdenes" pero la tabla muestra solo 5 registros.

**Causa:**
- `updateSummary()` cuenta desde `STATE.obcDataFiltered`
- Las tablas renderizan desde `STATE.obcDataFiltered` pero aplican filtros adicionales (estatus, calidad, etc.)
- No hay limpieza del estado anterior antes de aplicar nuevo filtro

**Análisis del Flujo Actual:**
```
lazyLoadDataByDate()
  ↓
parseOBCDataWithDateFilter() → filtra por fecha → STATE.obcDataFiltered
  ↓
updateSummary() → cuenta: totalCount = STATE.obcDataFiltered.size
  ↓
renderOrdersTable('pending') → filtra adicionalmente:
  - Excluye Canceladas
  - Excluye No Procesables
  - Excluye Validadas (excepto Pendiente Calidad)
  ↓
RESULTADO: contador (75) ≠ registros visibles (5)
```

**Solución a Implementar:**
1. Limpiar `STATE.obcDataFiltered` antes de aplicar nuevo filtro
2. Hacer que `updateSummary()` cuente exactamente lo mismo que se renderiza en las tablas
3. Usar función centralizada `getFilteredOrders(mode)` que devuelva array filtrado

---

### 3. Inconsistencia de Fechas Entre Pestañas

**Síntoma:**
- Pestaña "Todo" muestra fechas: `01/02/26` (MM/DD/YY)
- Pestaña "Validadas" muestra fechas: `02-01-26` (DD-MM-YY)
- Una orden que cumple criterios no aparece en ambas pestañas

**Causa:**
Las pestañas filtran por diferentes campos de fecha:

| Pestaña | Campo Usado | Formato | Fuente |
|---------|-------------|---------|--------|
| Todo | `expectedArrival` | YYYY-MM-DD HH:mm:ss | BD_CAJAS (OBC) |
| Validadas | `record.fecha` | DD/MM/YYYY | SPREADSHEET_WRITE |

**Problema de Lógica:**
```javascript
// Pestaña "Todo" - filtra en parseOBCDataWithDateFilter:
const orderDate = parseOrderDate(expectedArrival); // 2026-01-31 10:00:00
if (orderDate < filterStartDate || orderDate > filterEndDate) continue;

// Pestaña "Validadas" - filtra en renderValidatedTable:
const fechaDespacho = record.fecha; // "31/01/2026"
const despachoDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
if (despachoDate < startDate || despachoDate > endDate) return false;
```

**Escenario de Fallo:**
1. Orden `OBC123` tiene `expectedArrival = "2026-01-30 14:00:00"`
2. Usuario filtra por fecha `2026-01-31`
3. Orden NO aparece en "Todo" (filtrada por expectedArrival = 30/01)
4. Usuario valida la orden el 31/01 → `record.fecha = "31/01/2026"`
5. Orden SÍ aparece en "Validadas" (fecha de despacho = 31/01)
6. **RESULTADO: Orden validada que no existe en "Todo"** ❌

**Solución a Implementar:**
Homogeneizar el filtrado para que SIEMPRE se use el mismo criterio de fecha:

**Opción A: Filtrar por Fecha de Entrega (expectedArrival)**
- Pro: Muestra órdenes que deben ser entregadas ese día
- Contra: Órdenes validadas en fecha diferente no aparecerán

**Opción B: Filtrar por Fecha de Despacho (record.fecha para validadas, expectedArrival para pendientes)**
- Pro: Más intuitivo - "órdenes despachadas hoy"
- Contra: Requiere sincronizar ambos campos

**Recomendación: Opción B** - Filtrar por fecha de despacho real

---

### 4. Modal de Detalles Muestra Campos Vacíos

**Síntoma:**
Al abrir una orden desde "Validadas", el modal muestra campos vacíos o sin información.

**Causa:**
La función `showOrderInfo()` busca primero en `STATE.obcData.get(orden)`, pero si la orden no está en `obcDataFiltered` (por filtro de fechas diferente), crea objeto mínimo desde `STATE.localValidated`.

**Código Actual:**
```javascript
function showOrderInfo(orden) {
    let orderData = STATE.obcData.get(orden);

    if (!orderData) {
        const validatedRecord = STATE.localValidated.find(v => v.orden === orden);
        if (validatedRecord) {
            // Objeto mínimo - campos limitados
            orderData = {
                orden: validatedRecord.orden,
                recipient: validatedRecord.destino,
                expectedArrival: validatedRecord.horario,
                totalCajas: validatedRecord.totalCajas || 0,
                referenceNo: validatedRecord.referenceNo || '',
                trackingCode: validatedRecord.trackingCode || ''
            };
        }
    }
}
```

**Problema:**
El objeto mínimo solo tiene 6 campos, pero el modal necesita muchos más campos que no están en `validatedRecord`:
- `referencia`, `cajasDescripcion`, `notas`, `estado`, `prioridad`, etc.

**Solución a Implementar:**
1. Cargar datos completos de BD_CAJAS para la orden específica si no está en cache
2. O mejor: incluir TODOS los campos necesarios en `validatedRecord` al guardar

---

### 5. Mapeo de Estados Erróneos

**Síntoma:**
Las órdenes Canceladas muestran el estatus "Parcial" en el modal.

**Causa:**
La función `calculateOrderStatus()` no está considerando el campo `estatus` del record validado.

**Código Actual:**
```javascript
function calculateOrderStatus(totalCajas, cantidadDespachar) {
    if (!totalCajas || totalCajas === 0) {
        if (cantidadDespachar && cantidadDespachar > 0) {
            return { status: 'Completado', color: '#10b981' };
        }
        return { status: 'Sin Información', color: '#999' };
    }

    if (cantidadDespachar === 0) {
        return { status: 'No Despachado', color: '#ef4444' };
    }

    const porcentaje = (cantidadDespachar / totalCajas) * 100;

    if (porcentaje >= 100) {
        return { status: 'Completado', color: '#10b981' };
    } else if (porcentaje > 0) {
        return { status: 'Parcial', color: '#f59e0b' };
    }

    return { status: 'Pendiente', color: '#6b7280' };
}
```

**Problema:**
La función NO recibe el campo `estatus` del record, por lo que no puede distinguir:
- Cancelada
- No Procesable
- Pendiente Calidad

**Solución a Implementar:**
Modificar función para recibir y priorizar el estatus del record:

```javascript
function calculateOrderStatus(totalCajas, cantidadDespachar, estatusRecord) {
    // PRIORIDAD 1: Si el record tiene estatus explícito, usarlo
    if (estatusRecord === 'Cancelada') {
        return { status: 'Cancelada', color: '#ef4444' };
    }
    if (estatusRecord === 'No Procesable') {
        return { status: 'No Procesable', color: '#f97316' };
    }
    if (estatusRecord === 'Pendiente Calidad') {
        return { status: 'Pendiente Calidad', color: '#eab308' };
    }

    // PRIORIDAD 2: Calcular basado en cantidades
    // ... lógica actual ...
}
```

---

### 6. Porcentaje de Surtido N/A en Pestaña Validadas

**Síntoma:**
En la pestaña "Validadas", el porcentaje de surtido aparece como `N/A` incluso después de cargar las bases de datos.

**Causa:**
La columna de surtido en `renderValidatedTable()` verifica `LOAD_STATE.backgroundData.validacion`, pero puede haber otros problemas:
1. `getCajasValidadasUnicas()` no encuentra cajas
2. `totalCajas` es 0
3. La orden no existe en `STATE.validacionData`

**Código Actual:**
```javascript
const validacionCargada = LOAD_STATE.backgroundData.validacion;

if (!validacionCargada) {
    validationDisplay = `<div class="spinner-small spinner-orange">...</div>`;
} else if (cajasValidadas === 0 || totalCajas === 0) {
    validationDisplay = '<span class="empty-cell">N/A</span>';
} else {
    validationDisplay = `<div class="progress-bar">...</div>`;
}
```

**Problema:**
Si VALIDACION cargó pero `cajasValidadas === 0`, muestra `N/A` cuando debería mostrar `0%` o `0/X cajas`.

**Solución a Implementar:**
Distinguir entre "sin datos" y "0% validado":

```javascript
if (!validacionCargada) {
    // Aún cargando
    validationDisplay = `<div class="spinner-small spinner-orange">...</div>`;
} else if (totalCajas === 0) {
    // No hay información de cajas totales
    validationDisplay = '<span class="empty-cell">Sin Info</span>';
} else if (cajasValidadas === 0) {
    // 0% validado (diferente a N/A)
    validationDisplay = `<div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
        <span class="progress-text">0%</span>
    </div>`;
} else {
    // Mostrar porcentaje real
    validationDisplay = `<div class="progress-bar">...</div>`;
}
```

---

## 📋 PLAN DE CORRECCIÓN

### Fase 1: Correcciones Críticas (Bloqueantes) ✅
1. [x] Error 401 en carga de BD_CAJAS
2. [ ] Sincronización contador vs tabla
3. [ ] Homogeneización de filtros de fecha

### Fase 2: Correcciones de Datos
4. [ ] Modal con campos vacíos
5. [ ] Mapeo de estados erróneos
6. [ ] Porcentaje de surtido N/A

### Fase 3: Validación y Testing
7. [ ] Verificar sincronización en todas las pestañas
8. [ ] Probar filtros de fecha con múltiples escenarios
9. [ ] Validar que contadores coincidan con registros visibles

---

## 🔧 ORDEN DE IMPLEMENTACIÓN

1. **Crear función centralizada de filtrado** ✅ En Progreso
   - `getFilteredOrders(mode, dateFilter)`
   - Retorna array filtrado según modo y fecha
   - Usada por `updateSummary()` y `renderOrdersTable()`

2. **Homogeneizar parseo de fechas**
   - Usar siempre `parseOrderDate()` para consistencia
   - Normalizar formato de salida

3. **Corregir `calculateOrderStatus()`**
   - Agregar parámetro `estatusRecord`
   - Priorizar estatus explícito sobre cálculo

4. **Mejorar `showOrderInfo()`**
   - Cargar datos completos del OBC si no están en cache
   - O expandir objeto mínimo con todos los campos necesarios

5. **Refinar lógica de surtido**
   - Distinguir entre "sin datos", "sin info" y "0%"
   - Mostrar información apropiada en cada caso

---

## 🧪 CASOS DE PRUEBA

### Test 1: Sincronización de Contador
**Pasos:**
1. Filtrar por fecha 31/01/2026
2. Ver contador en sidebar
3. Contar registros en tabla "Todo"
4. Verificar que coincidan

**Esperado:** Contador = Registros visibles

### Test 2: Consistencia de Fechas
**Pasos:**
1. Filtrar por fecha 31/01/2026
2. Validar una orden que tiene `expectedArrival = 30/01/2026`
3. Verificar que aparece en ambas pestañas o en ninguna (consistencia)

**Esperado:** Orden aparece en ambas o no aparece en ninguna

### Test 3: Modal con Datos Completos
**Pasos:**
1. Abrir modal desde pestaña "Validadas"
2. Verificar que todos los campos se muestran correctamente

**Esperado:** No hay campos vacíos

### Test 4: Estado Cancelada
**Pasos:**
1. Marcar orden como "Cancelada"
2. Abrir modal
3. Verificar badge de estatus

**Esperado:** Badge muestra "Cancelada" (no "Parcial")

### Test 5: Surtido 0%
**Pasos:**
1. Crear orden con 10 cajas
2. No validar ninguna caja
3. Ver columna de surtido en "Validadas"

**Esperado:** Muestra "0%" (no "N/A")

---

**Nota:** Este documento se actualizará conforme se implementen las correcciones.
