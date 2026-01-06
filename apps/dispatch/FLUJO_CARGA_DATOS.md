# Flujo de Carga de Datos - Sistema de Despacho
## Implementación Enero 2026

---

## 📊 FLUJO CORRECTO DE CARGA

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUJO DE CARGA DE DATOS                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. INPUT FECHA                                                 │
│     └─► Usuario selecciona rango de fechas                      │
│         (startDate, endDate en formato YYYY-MM-DD)              │
│                                                                 │
│  2. FETCH OBC DB (BD_CAJAS) + FILTRAR POR FECHA                │
│     └─► Descargar CSV desde Google Sheets                       │
│     └─► Filtrar por expectedArrival (fecha de despacho)         │
│     └─► Resultado: Array de órdenes OBC en el rango             │
│                                                                 │
│  3. FETCH REGISTROS VALIDADOS (SPREADSHEET_WRITE)              │
│     └─► Usar Google Sheets API para leer BD de escritura        │
│     └─► Obtener TODOS los registros de despacho                 │
│     └─► Resultado: Array de registros validados                 │
│                                                                 │
│  4. CRUZAR OBC CON VALIDADOS                                   │
│     └─► Para cada orden OBC, verificar si existe en validados   │
│     └─► Separar en: pendingOrders vs validatedOrders            │
│     └─► Marcar órdenes con flag isValidated = true              │
│                                                                 │
│  5. RENDER FINAL                                                │
│     └─► Actualizar STATE con datos procesados                   │
│     └─► Renderizar tabla de Pendientes (sin validadas)          │
│     └─► Renderizar tabla de Validadas                           │
│     └─► Actualizar badges y contadores                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔧 IMPLEMENTACIÓN TÉCNICA

### Función Principal: `lazyLoadDataByDate(startDate, endDate)`

```javascript
async function lazyLoadDataByDate(startDate, endDate) {
    const TOTAL_STEPS = 4;
    
    // PASO 1: Fetch OBC DB y filtrar por fecha
    showLoadingOverlay(true, 0, TOTAL_STEPS, '📦 Paso 1/4: Descargando base de órdenes OBC...');
    const allOBCOrders = parseOBCDataWithDateFilter(bdCajasCsv, startDate, endDate);
    
    // PASO 2: Fetch registros validados desde SPREADSHEET_WRITE
    showLoadingOverlay(true, 1, TOTAL_STEPS, '📝 Paso 2/4: Cargando registros de despacho...');
    const validatedRecords = await fetchValidatedRecordsFromWriteDB();
    
    // PASO 3: Cruzar OBC con validados
    showLoadingOverlay(true, 2, TOTAL_STEPS, '🔄 Paso 3/4: Cruzando órdenes con registros validados...');
    const { pendingOrders, validatedOrders, validatedOBCSet } = crossReferenceOrders(allOBCOrders, validatedRecords);
    
    // PASO 4: Actualizar STATE y render
    showLoadingOverlay(true, 3, TOTAL_STEPS, '✅ Paso 4/4: Preparando visualización...');
    // ... actualizar STATE ...
}
```

---

## 📋 FUNCIONES AUXILIARES

### 1. `parseOBCDataWithDateFilter(csv, startDate, endDate)`

**Propósito**: Parsear CSV de BD_CAJAS y filtrar por fecha de despacho

**Entrada**:
- `csv`: Contenido CSV de BD_CAJAS
- `startDate`: Fecha inicio (YYYY-MM-DD)
- `endDate`: Fecha fin (YYYY-MM-DD)

**Proceso**:
1. Parsear cada fila del CSV
2. Extraer `expectedArrival` (columna E) como fecha de despacho
3. Comparar con rango de fechas
4. Si coincide, agregar a lista de órdenes
5. Contar cajas por OBC
6. Indexar códigos de caja

**Salida**: Array de órdenes OBC dentro del rango de fechas

```javascript
function parseOBCDataWithDateFilter(csv, startDate, endDate) {
    // Parse dates for comparison
    const filterStartDate = new Date(startDate);
    const filterEndDate = new Date(endDate);
    
    // Process each row
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const obc = cols[0]?.trim();
        const expectedArrival = cols[4]?.trim(); // Column E
        
        // Parse and compare date
        const orderDate = parseOrderDate(expectedArrival);
        if (orderDate >= filterStartDate && orderDate <= filterEndDate) {
            // Add to filtered orders
        }
    }
    
    return Array.from(uniqueOrders.values());
}
```

---

### 2. `fetchValidatedRecordsFromWriteDB()`

**Propósito**: Obtener registros de despacho desde la BD de escritura

**Proceso**:
1. Verificar disponibilidad de Google Sheets API
2. Obtener metadata para encontrar nombre de hoja correcta
3. Leer rango `{sheetName}!A:P`
4. Parsear cada fila como registro de despacho

**Salida**: Array de registros validados

```javascript
async function fetchValidatedRecordsFromWriteDB() {
    // Get sheet metadata
    const metadataResponse = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: CONFIG.SPREADSHEET_WRITE
    });
    
    // Find correct sheet name
    const possibleNames = ['Despachos', 'BD', 'Sheet1', 'Hoja1'];
    
    // Fetch data
    const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: CONFIG.SPREADSHEET_WRITE,
        range: `${sheetName}!A:P`
    });
    
    // Parse records
    return records;
}
```

**Estructura de registro validado**:
```javascript
{
    folio: '',           // A: Folio
    fecha: '',           // B: Fecha
    hora: '',            // C: Hora
    usuario: '',         // D: Usuario
    orden: '',           // E: Orden (OBC code)
    destino: '',         // F: Destino
    horario: '',         // G: Horario
    codigo: '',          // H: Código
    codigo2: '',         // I: Código 2
    estatus: '',         // J: Estatus
    tarea: '',           // K: Tarea
    estatus2: '',        // L: Estatus2
    incidencias: '',     // M: Incidencias
    operador: '',        // N: Operador
    unidad: '',          // O: Unidad
    observaciones: ''    // P: Observaciones
}
```

---

### 3. `crossReferenceOrders(obcOrders, validatedRecords)`

**Propósito**: Cruzar órdenes OBC con registros validados

**Proceso**:
1. Crear Set de códigos OBC validados
2. Crear Map de OBC → registros de validación
3. Para cada orden OBC:
   - Si está en Set validados → agregar a `validatedOrders`
   - Si no está → agregar a `pendingOrders`

**Salida**:
```javascript
{
    pendingOrders: [],      // Órdenes sin validar
    validatedOrders: [],    // Registros de validación
    validatedOBCSet: Set()  // Set de códigos OBC validados
}
```

```javascript
function crossReferenceOrders(obcOrders, validatedRecords) {
    const validatedOBCSet = new Set();
    const validatedByOBC = new Map();
    
    // Build lookup structures
    validatedRecords.forEach(record => {
        const obcCode = record.orden.trim().toUpperCase();
        validatedOBCSet.add(obcCode);
        validatedByOBC.set(obcCode, [...(validatedByOBC.get(obcCode) || []), record]);
    });
    
    // Cross-reference
    obcOrders.forEach(order => {
        const obcCode = order.orden.trim().toUpperCase();
        
        if (validatedOBCSet.has(obcCode)) {
            // Order is validated
            validatedOrders.push(...validatedByOBC.get(obcCode));
        } else {
            // Order is pending
            pendingOrders.push(order);
        }
    });
    
    return { pendingOrders, validatedOrders, validatedOBCSet };
}
```

---

## 📊 ESTRUCTURA DE DATOS

### STATE después de carga

```javascript
STATE = {
    obcData: Map(),           // OBC code → order data (con flag isValidated)
    obcDataFiltered: Map(),   // Mismo que obcData (filtrado por fecha)
    bdCajasData: Map(),       // Box code → array of box info
    localValidated: [],       // Array de registros validados
    dateFilter: {
        startDate: '2026-01-01',
        endDate: '2026-01-07',
        active: true
    }
}
```

### Orden OBC (en obcData)

```javascript
{
    orden: 'OBC123456',
    referenceNo: 'REF001',
    shippingService: 'Express',
    trackingCode: 'TRK001',
    expectedArrival: '06/01/2026',
    recipient: 'Cliente ABC',
    boxType: 'Caja Grande',
    customBarcode: 'BC001',
    totalCajas: 5,
    isValidated: true  // ← Flag de cruce
}
```

---

## 🎯 RESULTADO ESPERADO

### Tabla de Pendientes
- Solo muestra órdenes donde `isValidated = false`
- No incluye órdenes que ya tienen registro en BD de escritura

### Tabla de Validadas
- Muestra registros de `STATE.localValidated`
- Incluye datos del despacho (folio, fecha, hora, conductor, etc.)

### Badges
- **Pendientes**: Cuenta de órdenes sin validar
- **Validadas**: Cuenta de registros en localValidated

---

## 🔍 DEBUGGING

### Console Logs

```
========================================
📅 INICIANDO CARGA DE DATOS
   Rango: 2026-01-01 a 2026-01-07
========================================

👉 PASO 1/4: Descargando BD_CAJAS (OBC orders database)...
🔍 Filtrando OBC por fecha: 1/1/2026 - 7/1/2026
📊 Procesadas 200000 filas, 150 coinciden con el filtro
📅 Muestra de fechas: ["OBC001: 06/01/2026 → 6/1/2026", ...]
✅ 45 órdenes únicas encontradas, 180 códigos de caja indexados
✅ PASO 1 COMPLETO: 45 órdenes encontradas en el rango de fechas

👉 PASO 2/4: Cargando registros validados desde SPREADSHEET_WRITE...
📥 Fetching from SPREADSHEET_WRITE: 1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o
📋 Hojas disponibles: BD, Sheet1
✅ Usando hoja: BD
📊 Encontradas 120 filas en BD de escritura
✅ Parseados 120 registros de despacho
✅ PASO 2 COMPLETO: 120 registros de despacho encontrados

👉 PASO 3/4: Cruzando órdenes OBC con registros validados...
🔍 Cruzando 45 órdenes OBC con 35 órdenes validadas
✅ Resultado del cruce:
   - Pendientes: 10
   - Validadas: 35
   - OBCs validados: 35
✅ PASO 3 COMPLETO

👉 PASO 4/4: Actualizando estado y preparando render...
✅ PASO 4 COMPLETO: Estado actualizado

========================================
✅ CARGA COMPLETADA EXITOSAMENTE
   - Total OBC: 45
   - Pendientes: 10
   - Validadas: 35
========================================
```

---

## ⚠️ NOTAS IMPORTANTES

1. **Filtro por fecha**: Se aplica sobre `expectedArrival` (columna E de BD_CAJAS)

2. **Cruce de datos**: Se hace por código OBC (case-insensitive)

3. **Órdenes validadas**: No aparecen en tabla de Pendientes

4. **BD de escritura**: Se lee completa y se cruza con OBC filtrados

5. **Progress loader**: Muestra 4 pasos con mensajes descriptivos

---

## 📝 CONFIGURACIÓN

```javascript
CONFIG = {
    SPREADSHEET_WRITE: '1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o',
    SOURCES: {
        BD_CAJAS: 'https://docs.google.com/spreadsheets/d/.../pub?output=csv'
    }
}
```

---

**Fecha de Implementación**: Enero 6, 2026  
**Versión**: 3.0.0 - Flujo de Carga Correcto  
**Estado**: ✅ Implementado y Documentado
