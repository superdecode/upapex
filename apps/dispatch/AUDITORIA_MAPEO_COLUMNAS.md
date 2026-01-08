# Auditoría de Mapeo de Columnas - Dispatch App

## 🔍 Problemas Identificados por el Usuario

### 1. **Cantidad a Despachar** (CRÍTICO)
- ❌ El campo debe guardar en Columna N de BD de escritura
- ❌ Listados de Validadas deben apuntar a Columna N (no a OBC)
- ❌ Detalle de Folio debe apuntar a Columna N (no a OBC)
- ❌ Impresión debe capturar valor de Columna N

### 2. **Campo Conductor**
- ❌ Aparece vacío en algunos lugares
- ❌ Debe tomar dato de columna correspondiente en BD de validación

### 3. **Campo Unidad (Placas/Vehículo)**
- ❌ Actualmente trae datos de Columna O (Incidencias)
- ❌ Debe corregir puntero para tomar dato de unidad

### 4. **Cantidad Inicial**
- ✅ Debe tomar valor de OBC y escribir en Columna M
- ✅ Debe ser visible pero bloqueado para edición

---

## 📊 Estructura Correcta de BD de Escritura

| Índice | Columna | Campo | Fuente de Datos |
|--------|---------|-------|-----------------|
| 0 | A | Folio | Generado (DSP-YYYYMMDD-XX) |
| 1 | B | Fecha | Timestamp validación |
| 2 | C | Hora | Timestamp validación |
| 3 | D | Usuario | CURRENT_USER |
| 4 | E | Orden | OBC Code |
| 5 | F | Destino | OBC recipient |
| 6 | G | Horario | OBC expectedArrival |
| 7 | H | Código | OBC trackingCode |
| 8 | I | Código 2 | OBC referenceNo |
| 9 | J | Estatus | 'Procesado' / 'Cancelada' |
| 10 | K | Tarea | 'Despacho' |
| 11 | L | Estatus2 | 'Completado' |
| **12** | **M** | **Cant Inicial** | **OBC totalCajas (solo lectura)** |
| **13** | **N** | **Cant Despacho** | **Input manual usuario** |
| 14 | O | Incidencias | Formato "Parcial: X/Y" |
| 15 | P | Operador | Selector conductor |
| 16 | Q | Unidad | Selector placas |
| 17 | R | Observaciones | Textarea nota |

---

## 🔧 Estado Actual del Código

### Función: `loadExistingValidatedRecords` (Líneas 288-311)

```javascript
const record = {
    folio: row[0] || '',           // A: Folio ✅
    fecha: row[1] || '',           // B: Fecha ✅
    hora: row[2] || '',            // C: Hora ✅
    usuario: row[3] || '',         // D: Usuario ✅
    orden: row[4] || '',           // E: Orden ✅
    destino: row[5] || '',         // F: Destino ✅
    horario: row[6] || '',         // G: Horario ✅
    codigo: row[7] || '',          // H: Código ✅
    codigo2: row[8] || '',         // I: Código 2 ✅
    estatus: row[9] || '',         // J: Estatus ✅
    tarea: row[10] || '',          // K: Tarea ✅
    estatus2: row[11] || '',       // L: Estatus2 ✅
    cantInicial: parseInt(row[12]) || 0,     // M: Cant Inicial ✅
    cantDespacho: parseInt(row[13]) || 0,    // N: Cant Despacho ✅
    incidencias: row[14] || '',    // O: Incidencias ✅
    operador: row[15] || '',       // P: Operador ✅
    conductor: row[15] || '',      // Alias ✅
    unidad: row[16] || '',         // Q: Unidad ✅
    observaciones: row[17] || '',  // R: Observaciones ✅
    notaDespacho: row[17] || '',   // Alias ✅
    cantidadDespachar: parseInt(row[13]) || 0  // ✅ Apunta a N
};
```

**Análisis**: ✅ CORRECTO - Mapeo está bien

---

### Función: `fetchValidatedRecordsFromWriteDB` (Líneas 737-759)

```javascript
records.push({
    folio: row[0] || '',           // A ✅
    fecha: row[1] || '',           // B ✅
    hora: row[2] || '',            // C ✅
    usuario: row[3] || '',         // D ✅
    orden: row[4] || '',           // E ✅
    destino: row[5] || '',         // F ✅
    horario: row[6] || '',         // G ✅
    codigo: row[7] || '',          // H ✅
    codigo2: row[8] || '',         // I ✅
    estatus: row[9] || '',         // J ✅
    tarea: row[10] || '',          // K ✅
    estatus2: row[11] || '',       // L ✅
    cantInicial: parseInt(row[12]) || 0,     // M ✅
    cantDespacho: parseInt(row[13]) || 0,    // N ✅
    incidencias: row[14] || '',    // O ✅
    operador: row[15] || '',       // P ✅
    conductor: row[15] || '',      // Alias ✅
    unidad: row[16] || '',         // Q ✅
    observaciones: row[17] || '',  // R ✅
    notaDespacho: row[17] || '',   // Alias ✅
    cantidadDespachar: parseInt(row[13]) || 0  // ✅ Apunta a N
});
```

**Análisis**: ✅ CORRECTO - Mapeo está bien

---

### Función: `SyncManager.formatRecord` (Líneas 5638-5658)

```javascript
formatRecord: (record) => {
    return [
        record.folio || '',                                          // A ✅
        record.fecha || '',                                          // B ✅
        record.hora || '',                                           // C ✅
        record.usuario || '',                                        // D ✅
        record.orden || '',                                          // E ✅
        record.destino || '',                                        // F ✅
        record.horario || '',                                        // G ✅
        record.codigo || record.trackingCode || '',                  // H ✅
        record.codigo2 || record.referenceNo || '',                  // I ✅
        record.estatus || 'Procesado',                               // J ✅
        record.tarea || 'Despacho',                                  // K ✅
        record.estatus2 || 'Completado',                             // L ✅
        record.cantInicial || record.totalCajas || 0,                // M ✅
        record.cantDespacho || record.cantidadDespachar || 0,        // N ✅
        record.incidencias || '',                                    // O ✅
        record.operador || '',                                       // P ✅
        record.unidad || '',                                         // Q ✅
        record.observaciones || record.notaDespacho || record.nota || ''  // R ✅
    ];
}
```

**Análisis**: ✅ CORRECTO - Mapeo está bien

---

### Función: `executeConfirmDispatch` (Líneas 5571-5595)

```javascript
const dispatchRecord = {
    folio: folio,
    timestamp: timestamp.toISOString(),
    fecha: timestamp.toLocaleDateString('es-ES'),
    hora: timestamp.toLocaleTimeString('es-ES'),
    usuario: CURRENT_USER,
    orden: STATE.currentOrder,
    destino: orderData.recipient || '',
    horario: orderData.expectedArrival || '',
    codigo: orderData.trackingCode || '',
    codigo2: orderData.referenceNo || '',
    estatus: 'Procesado',
    tarea: 'Despacho',
    estatus2: 'Completado',
    cantInicial: totalCajas,                    // M ✅ desde OBC
    cantDespacho: cantidadDespacharNum,         // N ✅ desde input manual
    incidencias: totalCajas !== cantidadDespacharNum ? `Parcial: ${cantidadDespacharNum}/${totalCajas}` : '',
    operador: operador,                         // P ✅
    unidad: unidad,                             // Q ✅
    observaciones: notaDespacho,                // R ✅
    // Datos adicionales para UI
    cantidadDespachar: cantidadDespacharNum,    // ✅ Copia para UI
    totalCajas: totalCajas,
    qc: Object.keys(qcData).length > 0 ? qcData : null
};
```

**Análisis**: ✅ CORRECTO - Asignación está bien

---

## 🎯 Verificación de Visualización en Tablas

### Tabla de Validados (renderValidatedTable - Línea 3717)

```javascript
<td style="text-align: center;"><strong>${record.cantidadDespachar || 0}</strong></td>
```

**Análisis**: ✅ CORRECTO - Usa `record.cantidadDespachar` que apunta a Columna N

---

### Tabla de Folio Details (renderFolioDetailsTable - Línea 7267)

```javascript
const cantDespachar = record.cantidadDespachar || 0;
totalCajasDespachar += cantDespachar;
```

```javascript
<td style="text-align: center;"><strong>${cantDespachar}</strong></td>
```

**Análisis**: ✅ CORRECTO - Usa `record.cantidadDespachar` que apunta a Columna N

---

### Impresión de Folio (printFolioDelivery - Línea 7449)

```javascript
ordenesDetailList.push({
    orden: record.orden,
    destino: destinoOrden,
    horario: record.horario || orderData.expectedArrival || 'N/A',
    referencia: orderData.referenceNo || record.codigo || 'N/A',
    tracking: orderData.trackingCode || record.track || 'N/A',
    cantidadDespachar: record.cantidadDespachar || 0  // ✅ Columna N
});
```

```javascript
const totalCajasFromBody = ordenesDetailList.reduce((sum, item) => sum + item.cantidadDespachar, 0);
```

**Análisis**: ✅ CORRECTO - Usa `record.cantidadDespachar` que apunta a Columna N

---

### Export a Excel (exportFolioDetailsToExcel - Línea 7834)

```javascript
'Cant. Despachar': record.cantidadDespachar || 0,
```

**Análisis**: ✅ CORRECTO - Usa `record.cantidadDespachar` que apunta a Columna N

---

## 🔍 Verificación de Campos Conductor y Unidad

### Tabla de Validados (Línea 3722-3723)

```javascript
<td>${record.operador || '<span class="empty-cell">N/A</span>'}</td>
<td>${record.unidad || '<span class="empty-cell">N/A</span>'}</td>
```

**Análisis**: ✅ CORRECTO - Usa campos correctos

---

### Tabla de Folio Details (Línea 7272-7273)

```javascript
const conductor = record.conductor || record.operador || 'N/A';
const unidad = record.unidad || 'N/A';
```

**Análisis**: ✅ CORRECTO - Usa campos correctos

---

### Impresión de Folio (Línea 7414-7415)

```javascript
const conductor = primeraOrden.operador || primeraOrden.conductor || 'N/A';
const unidad = primeraOrden.unidad || 'N/A';
```

**Análisis**: ✅ CORRECTO - Usa campos correctos

---

## ✅ CONCLUSIÓN DE AUDITORÍA

### Mapeo de Lectura/Escritura
- ✅ `loadExistingValidatedRecords`: CORRECTO
- ✅ `fetchValidatedRecordsFromWriteDB`: CORRECTO
- ✅ `SyncManager.formatRecord`: CORRECTO
- ✅ `executeConfirmDispatch`: CORRECTO

### Visualización en Tablas
- ✅ Tabla de Validados: USA Columna N (`record.cantidadDespachar`)
- ✅ Tabla de Folio Details: USA Columna N (`record.cantidadDespachar`)
- ✅ Impresión de Folio: USA Columna N (`record.cantidadDespachar`)
- ✅ Export a Excel: USA Columna N (`record.cantidadDespachar`)

### Campos Conductor y Unidad
- ✅ Conductor: Mapea correctamente a Columna P (`row[15]`)
- ✅ Unidad: Mapea correctamente a Columna Q (`row[16]`)

---

## 🚨 POSIBLES CAUSAS DE PROBLEMAS REPORTADOS

Si el usuario está viendo problemas, las causas podrían ser:

### 1. **Datos Antiguos en BD**
- Registros creados ANTES de la implementación de columnas M y N
- Solución: Esos registros tendrán valores vacíos/0 en M y N

### 2. **Caché del Navegador**
- LocalStorage puede tener datos antiguos
- Solución: Limpiar localStorage y recargar desde BD

### 3. **Sincronización Pendiente**
- SyncManager puede tener cola pendiente con formato antiguo
- Solución: Forzar sincronización o limpiar cola

### 4. **BD No Actualizada**
- La hoja de Google Sheets puede no tener columnas M y N
- Solución: Verificar que la BD tenga 18 columnas (A-R)

---

## 🔧 ACCIONES RECOMENDADAS

1. **Verificar estructura de BD en Google Sheets**
   - Confirmar que existen columnas A-R (18 columnas)
   - Verificar que hay encabezados correctos

2. **Limpiar localStorage**
   ```javascript
   localStorage.removeItem('dispatch_local_state');
   localStorage.removeItem('dispatch_pending_sync');
   ```

3. **Forzar recarga desde BD**
   - Recargar aplicación
   - Verificar consola para logs de carga

4. **Verificar datos de prueba**
   - Crear nuevo despacho
   - Verificar que se escribe en columnas M y N
   - Verificar que se lee correctamente

---

## 📝 NOTAS TÉCNICAS

- El campo `cantidadDespachar` es un alias de `cantDespacho` para compatibilidad con UI
- El campo `conductor` es un alias de `operador` para compatibilidad
- El campo `notaDespacho` es un alias de `observaciones` para compatibilidad
- Todos los mapeos de índices están correctos según la estructura A-R
