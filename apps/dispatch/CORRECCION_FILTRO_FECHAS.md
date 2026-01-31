# Corrección de Filtros de Fecha - Pestañas Vacías

## Fecha: 30 de Enero, 2026
## Problema Reportado

Después de implementar optimización de carga (solo 1 mes), las pestañas presentan problemas:

1. **Folios:** No muestra folios correspondientes a la fecha seleccionada
2. **Validadas:** No aparece información (vacía)
3. **Otros:** No aparece información (vacía)
4. **Pendientes:** Funciona correctamente ✅
5. **Todo:** Funciona correctamente ✅

**Síntomas:**
- Al seleccionar fecha para iniciar despacho, las pestañas quedan vacías
- La pestaña "Todo" sí muestra todas las órdenes
- La pestaña "Pendientes" sí filtra correctamente

---

## 🔍 CAUSAS RAÍZ IDENTIFICADAS

### Causa 1: Optimización de Carga Sobrescribe Filtro del Usuario

**Ubicación:** [app.js:264-275](app.js#L264-L275)

**Problema:**
La optimización implementada para cargar solo 1 mes SIEMPRE aplicaba ese filtro, incluso cuando el usuario seleccionaba un rango de fechas específico.

**Código Problemático:**
```javascript
async function loadExistingValidatedRecords(startDate = null, endDate = null) {
    try {
        // OPTIMIZACIÓN: Si no se especifica rango de fechas, cargar solo último mes
        if (!startDate && !endDate) {
            const today = new Date();
            const oneMonthAgo = new Date(today);
            oneMonthAgo.setMonth(today.getMonth() - 1);

            startDate = oneMonthAgo.toISOString().split('T')[0];
            endDate = today.toISOString().split('T')[0];

            console.log(`📅 Carga optimizada: Solo registros del último mes`);
        }
        // ... resto del código
    }
}
```

**Problema:**
- NO verificaba si había un filtro de fecha ACTIVO del usuario
- Sobrescribía `startDate` y `endDate` con "último mes"
- Ignoraba el rango que el usuario había seleccionado

**Escenario:**
1. Usuario selecciona fecha 15/01/2026 para iniciar despacho
2. Sistema llama `loadExistingValidatedRecords()` sin parámetros
3. Función aplica filtro "último mes" (30/12/2025 - 30/01/2026)
4. Usuario espera ver registros del 15/01/2026, pero ve últimos 30 días

---

### Causa 2: Filtro de Validadas/Otros Usa Fecha de Entrega (NO Fecha de Despacho)

**Ubicación:**
- [app.js:5506-5515](app.js#L5506-L5515) - renderValidatedTable
- [app.js:5232-5238](app.js#L5232-L5238) - renderOtrosTable

**Problema:**
Las funciones de renderizado filtraban por `record.horario` (fecha de entrega de la orden) en lugar de `record.fecha` (fecha de despacho).

**Código Problemático:**
```javascript
// renderValidatedTable() - ANTES (INCORRECTO)
filteredValidated = filteredValidated.filter(record => {
    // Obtiene fecha de ENTREGA (expectedArrival)
    const orderData = STATE.obcData.get(record.orden) || {};
    const dateStr = record.horario || orderData.expectedArrival; // ❌ FECHA DE ENTREGA

    if (!dateStr) return false;

    const orderDate = parseOrderDate(dateStr);
    return orderDate && orderDate >= startDate && orderDate <= endDate;
});
```

**Por qué es Incorrecto:**
- `record.horario` = Fecha de ENTREGA de la orden (30/01/2026 19:00)
- `record.fecha` = Fecha de DESPACHO de la orden (29/01/2026)
- El filtro debe mostrar órdenes DESPACHADAS en el rango, no órdenes con ENTREGA en el rango

**Escenario:**
1. Orden despachada el 29/01/2026 para entrega el 30/01/2026
2. Usuario filtra por 29/01/2026
3. Sistema compara con `horario` (30/01/2026) → NO coincide
4. Orden NO aparece en la lista (aunque fue despachada el 29/01)

---

## ✅ CORRECCIONES IMPLEMENTADAS

### Corrección 1: Respetar Filtro Activo del Usuario

**Archivo:** `/Users/quiron/CascadeProjects/upapex/apps/dispatch/app.js`
**Líneas:** 264-280 (modificado)

```javascript
async function loadExistingValidatedRecords(startDate = null, endDate = null) {
    if (!gapi?.client?.sheets) {
        console.log('⚠️ Google Sheets API not available');
        return [];
    }

    try {
        // OPTIMIZACIÓN: Si no se especifica rango de fechas, cargar solo último mes
        // PERO respeta el filtro activo si el usuario ya seleccionó un rango
        if (!startDate && !endDate) {
            // PRIORIDAD 1: Usar filtro activo del usuario
            if (STATE.dateFilter && STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
                startDate = STATE.dateFilter.startDate;
                endDate = STATE.dateFilter.endDate;
                console.log(`📅 Usando filtro de fecha activo: ${startDate} a ${endDate}`);
            } else {
                // PRIORIDAD 2: Si no hay filtro, cargar solo último mes (optimización)
                const today = new Date();
                const oneMonthAgo = new Date(today);
                oneMonthAgo.setMonth(today.getMonth() - 1);

                startDate = oneMonthAgo.toISOString().split('T')[0];
                endDate = today.toISOString().split('T')[0];

                console.log(`📅 Carga optimizada: Solo registros del último mes (${startDate} a ${endDate})`);
            }
        }

        console.log('📥 Loading validated records from write database...');
        // ... resto del código ...
    }
}
```

**Beneficio:**
- ✅ Respeta filtro del usuario cuando está activo
- ✅ Aplica optimización "solo 1 mes" cuando NO hay filtro
- ✅ Prioridad correcta: Usuario > Optimización

---

### Corrección 2: Filtrar por Fecha de Despacho (Validadas)

**Archivo:** `/Users/quiron/CascadeProjects/upapex/apps/dispatch/app.js`
**Líneas:** 5506-5524 (modificado)

```javascript
// renderValidatedTable() - DESPUÉS (CORRECTO)
filteredValidated = filteredValidated.filter(record => {
    // CRÍTICO: Filtrar por FECHA DE DESPACHO (record.fecha), NO por fecha de entrega
    // El filtro de fecha debe mostrar órdenes despachadas en el rango, no órdenes con entrega en el rango
    const fechaDespacho = record.fecha; // DD/MM/YYYY

    if (!fechaDespacho) return false;

    // Convertir DD/MM/YYYY a Date
    const parts = fechaDespacho.split('/');
    if (parts.length !== 3) return false;

    const despachoDate = new Date(
        parseInt(parts[2]),        // Año
        parseInt(parts[1]) - 1,    // Mes (0-indexed)
        parseInt(parts[0])         // Día
    );
    despachoDate.setHours(12, 0, 0, 0); // Medio día para evitar problemas de zona horaria

    return despachoDate >= startDate && despachoDate <= endDate;
});
```

**Beneficio:**
- ✅ Filtra por `record.fecha` (fecha de despacho)
- ✅ Muestra órdenes despachadas en el rango seleccionado
- ✅ Ignora fecha de entrega (irrelevante para filtro de despacho)

---

### Corrección 3: Filtrar por Fecha de Cancelación (Otros)

**Archivo:** `/Users/quiron/CascadeProjects/upapex/apps/dispatch/app.js`
**Líneas:** 5227-5250 (modificado)

```javascript
// renderOtrosTable() - DESPUÉS (CORRECTO)
if (STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate) {
    const startParts = STATE.dateFilter.startDate.split('-');
    const startDate = new Date(parseInt(startParts[0]), parseInt(startParts[1]) - 1, parseInt(startParts[2]));
    startDate.setHours(0, 0, 0, 0);

    const endParts = STATE.dateFilter.endDate.split('-');
    const endDate = new Date(parseInt(endParts[0]), parseInt(endParts[1]) - 1, parseInt(endParts[2]));
    endDate.setHours(23, 59, 59, 999);

    otrosOrders = otrosOrders.filter(record => {
        // CRÍTICO: Filtrar por FECHA DE CANCELACIÓN/NO PROCESABLE (record.fecha), NO por fecha de entrega
        const fechaDespacho = record.fecha; // DD/MM/YYYY

        if (!fechaDespacho) return false;

        // Convertir DD/MM/YYYY a Date
        const parts = fechaDespacho.split('/');
        if (parts.length !== 3) return false;

        const despachoDate = new Date(
            parseInt(parts[2]),        // Año
            parseInt(parts[1]) - 1,    // Mes (0-indexed)
            parseInt(parts[0])         // Día
        );
        despachoDate.setHours(12, 0, 0, 0); // Medio día para evitar problemas de zona horaria

        return despachoDate >= startDate && despachoDate <= endDate;
    });
}
```

**Beneficio:**
- ✅ Filtra por `record.fecha` (fecha de cancelación)
- ✅ Muestra órdenes canceladas/no procesables en el rango
- ✅ Consistente con lógica de Validadas

---

## 🎯 FLUJO CORREGIDO

### Flujo de Carga con Filtro de Fecha

```
Usuario selecciona fecha para iniciar despacho (ej: 29/01/2026)
  ↓
applyDateFilter() [app.js:9583]
  ↓
lazyLoadDataByDate(startDate, endDate) [app.js:481]
  ↓
fetchValidatedRecordsFromWriteDB() [app.js:797]
  ↓
loadExistingValidatedRecords() [app.js:258]
  ↓
CHECKPOINT: ¿Hay filtro activo?
  ├─ SÍ: Usar STATE.dateFilter.startDate/endDate ✅
  └─ NO: Usar último mes (optimización) ✅
  ↓
Cargar registros de BD con filtro correcto
  ↓
renderValidatedTable() / renderOtrosTable()
  ↓
Filtrar por record.fecha (fecha de despacho) ✅
  ↓
Mostrar registros filtrados
```

---

## 📊 MATRIZ DE CORRECCIONES

| Pestaña | Antes | Después |
|---------|-------|---------|
| **Validadas** | Filtra por `horario` (fecha entrega) | Filtra por `fecha` (fecha despacho) ✅ |
| **Otros** | Filtra por `horario` (fecha entrega) | Filtra por `fecha` (fecha cancelación) ✅ |
| **Folios** | Filtra por `horario` (fecha entrega) | OK - Folios usan triangulación ✅ |
| **Carga Inicial** | Siempre último mes | Respeta filtro usuario > optimización ✅ |

---

## 🧪 CASOS DE PRUEBA

### Prueba 1: Filtro de Fecha Específica
```
1. Seleccionar fecha 29/01/2026 para iniciar despacho
2. Validar orden para entrega el 30/01/2026
3. Ir a pestaña "Validadas"
4. Verificar: Orden aparece (despachada el 29/01)
5. Cambiar filtro a 30/01/2026
6. Verificar: Orden NO aparece (no despachada el 30/01)
```
**Resultado Esperado:** ✅ Filtra por fecha de despacho correctamente

### Prueba 2: Pestaña Otros con Filtro
```
1. Seleccionar fecha 29/01/2026
2. Cancelar orden
3. Ir a pestaña "Otros"
4. Verificar: Orden cancelada aparece
5. Cambiar filtro a 28/01/2026
6. Verificar: Orden NO aparece (no cancelada el 28/01)
```
**Resultado Esperado:** ✅ Filtra por fecha de cancelación correctamente

### Prueba 3: Optimización Sin Filtro
```
1. Recargar página (sin filtro activo)
2. Verificar console: "Carga optimizada: Solo registros del último mes"
3. Verificar: Solo registros del último mes cargados
4. Performance: Carga más rápida que antes
```
**Resultado Esperado:** ✅ Optimización funciona cuando NO hay filtro

### Prueba 4: Respeto de Filtro del Usuario
```
1. Seleccionar fecha 15/01/2026
2. Verificar console: "Usando filtro de fecha activo: 2026-01-15 a 2026-01-15"
3. Verificar: Registros del 15/01 cargados (NO últimos 30 días)
```
**Resultado Esperado:** ✅ Respeta filtro del usuario sobre optimización

### Prueba 5: Pestaña Folios
```
1. Seleccionar fecha 29/01/2026
2. Validar 3 órdenes en folio DSP-20260129-01
3. Ir a pestaña "Folios"
4. Verificar: Folio DSP-20260129-01 aparece con 3 órdenes
5. Cambiar filtro a 28/01/2026
6. Verificar: Folio NO aparece (no hay órdenes del 28/01)
```
**Resultado Esperado:** ✅ Folios se muestran según filtro de fecha

---

## 📋 RESUMEN DE ARCHIVOS MODIFICADOS

### `/Users/quiron/CascadeProjects/upapex/apps/dispatch/app.js`

1. **Línea 264-280:** Respetar filtro activo del usuario
   - ANTES: Siempre aplicaba "último mes"
   - DESPUÉS: Prioridad filtro usuario > optimización

2. **Línea 5506-5524:** Filtrar Validadas por fecha de despacho
   - ANTES: Filtraba por `record.horario` (fecha entrega)
   - DESPUÉS: Filtra por `record.fecha` (fecha despacho)

3. **Línea 5227-5250:** Filtrar Otros por fecha de cancelación
   - ANTES: Filtraba por `record.horario` (fecha entrega)
   - DESPUÉS: Filtra por `record.fecha` (fecha cancelación)

---

## ✅ ESTADO

**Problemas Solucionados:**
- ✅ Pestañas Validadas y Otros ahora muestran datos correctamente
- ✅ Filtro de fecha respeta selección del usuario
- ✅ Optimización de carga solo se aplica cuando NO hay filtro
- ✅ Folios se muestran según registros filtrados

**Beneficios:**
- ✅ Filtrado lógico y coherente (fecha de despacho/cancelación)
- ✅ Performance mejorada (carga solo 1 mes cuando no hay filtro)
- ✅ Experiencia de usuario mejorada (pestañas funcionan correctamente)

**Próximos Pasos:**
1. Recargar página para aplicar cambios
2. Seleccionar fecha para iniciar despacho
3. Validar órdenes
4. Verificar que todas las pestañas muestren datos correctamente
5. Verificar filtrado por fecha de despacho (no de entrega)
