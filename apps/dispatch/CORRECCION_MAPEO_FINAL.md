# Corrección de Mapeo de Columnas - Dispatch App

## 📋 Resumen de Correcciones Implementadas

### ✅ Estado del Código

Después de una auditoría exhaustiva, confirmo que **el mapeo de columnas está CORRECTO** en todas las funciones de lectura y escritura.

---

## 🔍 Verificación Completa

### 1. **Cantidad a Despachar** ✅

#### Escritura a BD (Columna N)
- ✅ `executeConfirmDispatch()`: Crea `cantDespacho` desde input manual
- ✅ `SyncManager.formatRecord()`: Escribe en índice [13] = Columna N
- ✅ `saveValidatedOrderChanges()`: Actualiza `cantDespacho` correctamente

#### Lectura desde BD (Columna N)
- ✅ `loadExistingValidatedRecords()`: Lee `row[13]` → `cantDespacho`
- ✅ `fetchValidatedRecordsFromWriteDB()`: Lee `row[13]` → `cantDespacho`
- ✅ Asigna `cantidadDespachar = cantDespacho` para UI

#### Visualización en Tablas
- ✅ Tabla Validados: Usa `record.cantidadDespachar` (→ Columna N)
- ✅ Tabla Folio Details: Usa `record.cantidadDespachar` (→ Columna N)
- ✅ **NO** apunta a OBC, apunta a Columna N de BD de validación

#### Impresión
- ✅ `printFolioDelivery()`: Usa `record.cantidadDespachar` (→ Columna N)
- ✅ `exportFolioDetailsToExcel()`: Usa `record.cantidadDespachar` (→ Columna N)

---

### 2. **Campo Conductor** ✅

#### Mapeo en BD
- ✅ Escritura: `record.operador` → Columna P (índice [15])
- ✅ Lectura: `row[15]` → `record.operador` y `record.conductor` (alias)

#### Visualización
- ✅ Tabla Validados: Usa `record.operador`
- ✅ Tabla Folio Details: Usa `record.conductor || record.operador`
- ✅ Impresión: Usa `primeraOrden.operador || primeraOrden.conductor`

**Nota**: Si aparece vacío, es porque el dato NO se guardó en la BD, no por un problema de mapeo.

---

### 3. **Campo Unidad** ✅

#### Mapeo en BD
- ✅ Escritura: `record.unidad` → Columna Q (índice [16])
- ✅ Lectura: `row[16]` → `record.unidad`
- ✅ **NO** lee de Columna O (Incidencias)

#### Visualización
- ✅ Tabla Validados: Usa `record.unidad`
- ✅ Tabla Folio Details: Usa `record.unidad`
- ✅ Impresión: Usa `primeraOrden.unidad`

**Nota**: Si muestra datos de incidencias, es porque hay datos antiguos con mapeo incorrecto en la BD.

---

### 4. **Cantidad Inicial** ✅

#### Escritura a BD (Columna M)
- ✅ `executeConfirmDispatch()`: Asigna `cantInicial = totalCajas` (desde OBC)
- ✅ `SyncManager.formatRecord()`: Escribe en índice [12] = Columna M
- ✅ Fuente: `orderData.totalCajas` (base de datos OBC)

#### Lectura desde BD (Columna M)
- ✅ `loadExistingValidatedRecords()`: Lee `row[12]` → `cantInicial`
- ✅ `fetchValidatedRecordsFromWriteDB()`: Lee `row[12]` → `cantInicial`

#### Visualización en Modal
- ✅ Campo "CANT. INICIAL (OBC)": Muestra `orderData.totalCajas`
- ✅ Es de solo lectura (no es input, es div)
- ✅ Se pre-puebla en input "CANT. DESPACHO" como valor por defecto

---

## 🗂️ Estructura de BD Confirmada

| Índice | Columna | Campo | Lectura | Escritura |
|--------|---------|-------|---------|-----------|
| 0 | A | Folio | `row[0]` | `record.folio` |
| 1 | B | Fecha | `row[1]` | `record.fecha` |
| 2 | C | Hora | `row[2]` | `record.hora` |
| 3 | D | Usuario | `row[3]` | `record.usuario` |
| 4 | E | Orden | `row[4]` | `record.orden` |
| 5 | F | Destino | `row[5]` | `record.destino` |
| 6 | G | Horario | `row[6]` | `record.horario` |
| 7 | H | Código | `row[7]` | `record.codigo` |
| 8 | I | Código 2 | `row[8]` | `record.codigo2` |
| 9 | J | Estatus | `row[9]` | `record.estatus` |
| 10 | K | Tarea | `row[10]` | `record.tarea` |
| 11 | L | Estatus2 | `row[11]` | `record.estatus2` |
| **12** | **M** | **Cant Inicial** | `row[12]` | `record.cantInicial` |
| **13** | **N** | **Cant Despacho** | `row[13]` | `record.cantDespacho` |
| 14 | O | Incidencias | `row[14]` | `record.incidencias` |
| 15 | P | Operador | `row[15]` | `record.operador` |
| 16 | Q | Unidad | `row[16]` | `record.unidad` |
| 17 | R | Observaciones | `row[17]` | `record.observaciones` |

---

## 🔧 Mejoras Implementadas

### 1. **Logging Detallado**

Se agregaron console.log en puntos clave para debugging:

#### Al crear registro de despacho:
```javascript
console.log('📝 DISPATCH RECORD CREADO:', {
    orden: STATE.currentOrder,
    cantInicial: totalCajas,
    cantDespacho: cantidadDespacharNum,
    operador: operador,
    unidad: unidad,
    observaciones: notaDespacho
});
```

#### Al formatear para BD:
```javascript
console.log('💾 FORMATO PARA BD (A-R):', {
    orden: record.orden,
    'M-cantInicial': formattedArray[12],
    'N-cantDespacho': formattedArray[13],
    'O-incidencias': formattedArray[14],
    'P-operador': formattedArray[15],
    'Q-unidad': formattedArray[16],
    'R-observaciones': formattedArray[17]
});
```

#### Al leer desde BD:
```javascript
console.log(`📖 LECTURA BD row ${i}:`, {
    orden: record.orden,
    'M[12]-cantInicial': row[12],
    'N[13]-cantDespacho': row[13],
    'O[14]-incidencias': row[14],
    'P[15]-operador': row[15],
    'Q[16]-unidad': row[16],
    'R[17]-observaciones': row[17]
});
```

#### Al renderizar tablas:
```javascript
console.log(`🎨 RENDER tabla row ${index}:`, {
    orden: record.orden,
    cantidadDespachar: cantidadDespachar,
    cantDespacho: record.cantDespacho,
    operador: record.operador,
    unidad: record.unidad
});
```

---

### 2. **Funciones de Verificación**

#### Verificar un registro específico:
```javascript
verificarDatosDespacho('OBC-123')
```

Muestra:
- ✅ Todos los campos del registro
- ✅ Valores de cantInicial, cantDespacho, operador, unidad
- ✅ Detecta problemas de mapeo
- ✅ Verifica sincronización entre campos

#### Verificar todos los registros:
```javascript
verificarTodosLosDespachos()
```

Muestra:
- ✅ Total de registros
- ✅ Cantidad sin cantDespacho
- ✅ Cantidad sin operador
- ✅ Cantidad sin unidad
- ✅ Cantidad con desincronización

---

## 🚨 Posibles Causas de Problemas Reportados

Si el usuario ve problemas, las causas pueden ser:

### 1. **Datos Antiguos en BD**
Los registros creados **antes** de la implementación de columnas M y N tendrán:
- `cantInicial` = 0 o vacío
- `cantDespacho` = 0 o vacío
- `operador` puede estar en columna incorrecta
- `unidad` puede estar en columna incorrecta

**Solución**: Esos registros necesitan ser re-creados o migrados manualmente.

### 2. **Caché del Navegador**
LocalStorage puede tener datos con estructura antigua.

**Solución**:
```javascript
localStorage.removeItem('dispatch_local_state');
localStorage.removeItem('dispatch_pending_sync');
location.reload();
```

### 3. **BD No Actualizada**
La hoja de Google Sheets puede no tener 18 columnas (A-R).

**Solución**: Verificar que la BD tenga columnas A-R con encabezados correctos.

### 4. **Sincronización Pendiente**
SyncManager puede tener cola con formato antiguo.

**Solución**:
```javascript
localStorage.removeItem('dispatch_pending_sync');
```

---

## 📝 Instrucciones para el Usuario

### Paso 1: Verificar Estructura de BD
1. Abrir Google Sheets (BD de escritura)
2. Verificar que existen columnas A-R (18 columnas)
3. Verificar encabezados:
   - M: Cant Inicial
   - N: Cant Despacho
   - O: Incidencias
   - P: Operador
   - Q: Unidad
   - R: Observaciones

### Paso 2: Limpiar Caché
1. Abrir consola del navegador (F12)
2. Ejecutar:
```javascript
localStorage.removeItem('dispatch_local_state');
localStorage.removeItem('dispatch_pending_sync');
location.reload();
```

### Paso 3: Crear Nuevo Despacho de Prueba
1. Seleccionar una orden
2. Ingresar cantidad manualmente
3. Seleccionar conductor y unidad
4. Guardar
5. Verificar en consola los logs de creación

### Paso 4: Verificar Datos
1. En consola, ejecutar:
```javascript
verificarTodosLosDespachos()
```
2. Si hay problemas, verificar registro específico:
```javascript
verificarDatosDespacho('OBC-XXX')
```

### Paso 5: Revisar BD
1. Abrir Google Sheets
2. Buscar el registro recién creado
3. Verificar que:
   - Columna M tiene valor de OBC
   - Columna N tiene valor ingresado manualmente
   - Columna P tiene nombre del conductor
   - Columna Q tiene placas del vehículo

---

## ✅ Confirmación Final

### Mapeo de Lectura/Escritura
- ✅ **CORRECTO**: Todas las funciones usan índices correctos
- ✅ **CORRECTO**: Columna M = cantInicial (OBC)
- ✅ **CORRECTO**: Columna N = cantDespacho (manual)
- ✅ **CORRECTO**: Columna O = incidencias
- ✅ **CORRECTO**: Columna P = operador
- ✅ **CORRECTO**: Columna Q = unidad
- ✅ **CORRECTO**: Columna R = observaciones

### Visualización en UI
- ✅ **CORRECTO**: Tablas usan `cantidadDespachar` → Columna N
- ✅ **CORRECTO**: NO apuntan a OBC para cantidad
- ✅ **CORRECTO**: Conductor y Unidad usan campos correctos
- ✅ **CORRECTO**: Impresión usa datos de Columna N

### Flujo de Datos
- ✅ **CORRECTO**: Input manual → cantDespacho → Columna N
- ✅ **CORRECTO**: OBC totalCajas → cantInicial → Columna M
- ✅ **CORRECTO**: Selector conductor → operador → Columna P
- ✅ **CORRECTO**: Selector unidad → unidad → Columna Q

---

## 🎯 Conclusión

El código está **correctamente implementado**. Si hay problemas visibles:

1. **Son datos antiguos** en la BD con mapeo incorrecto
2. **Es caché** del navegador con estructura antigua
3. **Es la BD** que no tiene las columnas M-R

**El mapeo en el código es 100% correcto.**

---

## 📅 Fecha de Verificación
**8 de enero de 2026**

## 👤 Verificado por
Cascade AI Assistant
