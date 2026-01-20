# Implementación de Módulos Embarques y Reparaciones - Track App
**Fecha:** 2026-01-20
**Versión:** 2.0.0

## 🎯 RESUMEN EJECUTIVO

Se han integrado dos nuevas fuentes de datos al sistema de consultas de Track App:
1. **Embarques** - Validación final de mercancía despachada
2. **Reparaciones** - Seguimiento de cajas en reparación

Ambas fuentes incluyen lógicas de búsqueda avanzadas con triangulación de datos y búsqueda fuzzy basada en BaseCode.

---

## 📊 NUEVAS BASES DE DATOS

### 1. BASE DE DATOS: EMBARQUES 🚚

**Propósito:** Validación final de mercancía despachada

**URL:** https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbzg922y1KMVnV0JqBijR43Ma8e5X_AO2KVzjHBnRtGBx-0aXLZ8UUlKCO_XHOpV1qfggQyNjtqde/pub?gid=0&single=true&output=csv

**Hoja:** BD

#### Estructura de Columnas (18 columnas):

| Índice | Columna | Ejemplo | Descripción |
|--------|---------|---------|-------------|
| 0 (A) | Folio | DSP-20260105-01 | ID único del despacho |
| 1 (B) | Fecha | 2026-01-05 | Fecha del despacho |
| 2 (C) | Hora | 9:45:34 | Hora del despacho |
| 3 (D) | Usuario | Bread pandemic | Usuario que procesó |
| 4 (E) | Orden | OBC3272512270RU | Número de OBC |
| 5 (F) | Destino | MXCD05 | Código de destino |
| 6 (G) | Horario | 1/5/2026 11:45:00 | Horario programado |
| 7 (H) | Código | 58652418 | Código base principal |
| 8 (I) | Código 2 | 50974674 | Código base alterno |
| 9 (J) | Estatus | Procesado | Estado del embarque |
| 10 (K) | Cambio Etiqueta | Despacho | Tipo de cambio |
| 11 (L) | Estatus 2 | Completado | Estado secundario |
| 12 (M) | Cant Inicial | 15 | Cantidad total de cajas |
| 13 (N) | Cant Despacho | 14 | Cantidad despachada |
| 14 (O) | Incidencias | Parcial: 14/15 | Incidencias registradas |
| 15 (P) | Operador | FERNANDO CAYETANO | Operador responsable |
| 16 (Q) | Unidad | TRANSIT | Unidad de transporte |
| 17 (R) | Observaciones | Daños en embalaje | Notas adicionales |

#### Campos Mostrados en UI:
- Folio
- Fecha
- Orden
- Destino
- Código
- Código 2
- Estatus
- Cant Inicial
- Cant Despacho
- Operador
- Unidad

#### Lógica de Búsqueda Implementada:

**1. Búsqueda Directa por OBC:**
```javascript
// Si la búsqueda empieza con "OBC"
if (query.toUpperCase().startsWith('OBC')) {
    // Buscar en columna Orden (índice 4)
    // Match exacto o por inclusión
}
```

**2. Búsqueda Fuzzy por BaseCode:**
```javascript
// Si la búsqueda NO es OBC (es código de caja)
// Buscar BaseCode en columnas Código (7) y Código 2 (8)
// Métodos:
// - BaseCode exacto
// - BaseCode por inclusión
// - Coincidencia parcial
```

**3. Triangulación Avanzada:**
```javascript
// Si no encuentra por BaseCode:
// PASO 1: Buscar en OBC_BD todas las OBCs asociadas a esa caja
// PASO 2: Buscar esas OBCs en columna Orden de Embarques
// Retorna: Todos los embarques de las órdenes vinculadas
```

---

### 2. BASE DE DATOS: REPARACIONES 🔧

**Propósito:** Seguimiento de cajas en reparación

**URL:** https://docs.google.com/spreadsheets/d/e/2PACX-1vSe-hbpLGtctz-xY2Tk-9j5p6sbxtCC8dE-84UF7Gc0x4P5uSgygqmPHunD0ZLYVV6RCyvBsHI18OL7/pub?gid=131145537&single=true&output=csv

**Hoja:** BD

#### Estructura de Columnas (10 columnas):

| Índice | Columna | Descripción |
|--------|---------|-------------|
| 0 (A) | FECHA REGISTRO | Fecha de ingreso a reparación |
| 1 (B) | OBC | Número de orden |
| 2 (C) | CODIGO | Código de caja (ID_Caja) |
| 3 (D) | UBICACION | Ubicación física |
| 4 (E) | FECHA ENVIO | Fecha de envío a reparación |
| 5 (F) | HORARIO | Horario de envío |
| 6 (G) | REPARADO | SI/NO - Estado de reparación |
| 7 (H) | ENTREGADO | SI/NO - Estado de entrega |
| 8 (I) | OBSERVACIONES (SURTIDO) | Notas de surtido |
| 9 (J) | OBSERVACIONES (RECIBO) | Notas de recibo |

#### Campos Mostrados en UI:
- Fecha Registro
- OBC
- Código
- Reparado
- Entregado
- Observaciones 1 (Surtido)
- Observaciones 2 (Recibo)

#### Lógica de Búsqueda Booleana (Existe/No Existe):

```javascript
// Búsqueda FUZZY en columna CODIGO (índice 2)
// Métodos:
// 1. Match exacto (100% similaridad)
// 2. Match por inclusión (95% similaridad)
// 3. BaseCode exacto (90% similaridad)
// 4. BaseCode fuzzy (85% similaridad)

// Resultado: SÍ (encontrado) / NO (no encontrado)
```

---

## 🔧 CAMBIOS TÉCNICOS IMPLEMENTADOS

### 1. Configuración de Fuentes de Datos

**Archivo:** `app.js` - Líneas 5-18

```javascript
const CONFIG = {
    SOURCES: {
        // ... fuentes existentes ...
        EMBARQUES: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTmbzg922y1KMVnV0JqBijR43Ma8e5X_AO2KVzjHBnRtGBx-0aXLZ8UUlKCO_XHOpV1qfggQyNjtqde/pub?gid=0&single=true&output=csv',
        REPARACIONES: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSe-hbpLGtctz-xY2Tk-9j5p6sbxtCC8dE-84UF7Gc0x4P5uSgygqmPHunD0ZLYVV6RCyvBsHI18OL7/pub?gid=131145537&single=true&output=csv'
    },
    CACHE_DURATION: 30 * 60 * 1000,
    MAX_RESULTS: 20
};
```

### 2. Actualización de Cache y Estado

**Archivo:** `app.js` - Líneas 20-30, 33-42

```javascript
let DATA_CACHE = {
    // ... caches existentes ...
    embarques: [],
    reparaciones: [],
    lastUpdate: null
};

let SECTION_MODES = {
    // ... modos existentes ...
    embarques: 'exact',
    reparaciones: 'exact'
};
```

### 3. Funciones de Búsqueda Especializadas

#### A) searchEMBARQUES() - Líneas 685-785

**Características:**
- Detección automática de tipo de búsqueda (OBC vs Código de caja)
- Búsqueda directa en columna Orden para OBCs
- Búsqueda fuzzy por BaseCode en columnas Código y Código 2
- **Triangulación** cuando no encuentra coincidencias directas:
  - Busca OBCs asociadas en BD_OBC
  - Busca esas OBCs en Embarques
  - Retorna todos los embarques vinculados

**Métodos de Match:**
- `OBC_directa` - Búsqueda por número de orden
- `BaseCode_codigo` - Match en columna Código
- `BaseCode_codigo2` - Match en columna Código 2
- `Triangulación_OBC` - Match por triangulación de datos

#### B) searchREPARACIONES() - Líneas 787-850

**Características:**
- Búsqueda booleana (existe/no existe)
- Búsqueda fuzzy en columna CODIGO (índice 2)
- Múltiples niveles de coincidencia con diferentes similaridades
- Logs detallados del proceso de búsqueda

**Métodos de Match:**
- `Exacto` (100%) - Coincidencia perfecta
- `Inclusión` (95%) - Código incluido en el campo
- `BaseCode_exacto` (90%) - BaseCode perfecto
- `BaseCode_fuzzy` (85%) - BaseCode parcial

### 4. Actualización de UI

#### A) Tarjetas de Resumen (Summary Cards)

**Archivo:** `app.js` - Líneas 1037-1040, 1046-1051, 1189-1212

```javascript
// Información de las nuevas fuentes
const embarquesInfo = getInfo(results.exact.embarques, results.partial.embarques);
const reparacionesInfo = getInfo(results.exact.reparaciones, results.partial.reparaciones);

// Contadores flexibles
flexibleCounts: {
    // ... existentes ...
    embarques: results.partial.embarques.length,
    reparaciones: results.partial.reparaciones.length
}

// Tarjeta de Embarques - Muestra estatus y progreso
<div class="summary-item ${embarquesInfo ? 'primary' : 'gray'}" onclick="jumpToSection('embarques')">
    <div class="summary-label">🚚 Embarques</div>
    <div class="summary-value">${embarquesInfo ? (embarquesInfo._values?.[9] || 'PROCESADO') : 'SIN DESPACHO'}</div>
    // Contador: X/Y despachadas
</div>

// Tarjeta de Reparaciones - Indicador binario SI/NO
<div class="summary-item ${reparacionesInfo ? 'warning' : 'success'}" onclick="jumpToSection('reparaciones')">
    <div class="summary-label">🔧 Reparaciones</div>
    <div class="summary-value">${reparacionesInfo ? 'SÍ' : 'NO'}</div>
    // Estado: Reparado/Entregado
</div>
```

#### B) Secciones de Datos Detallados

**Archivo:** `app.js` - Líneas 1262-1271, 1484-1507

```javascript
// Nuevas secciones en displaySections()
const sections = [
    // ... secciones existentes ...
    { key: 'embarques', title: '🚚 Embarques - Despacho de Mercancía', color: 'primary' },
    { key: 'reparaciones', title: '🔧 Reparaciones - Cajas en Reparación', color: 'warning' },
    // ...
];

// Campos de tabla para Embarques
embarques: [
    { key: 0, label: 'Folio', type: 'code' },
    { key: 1, label: 'Fecha', type: 'date' },
    { key: 4, label: 'Orden', type: 'code' },
    { key: 5, label: 'Destino', type: 'text' },
    { key: 7, label: 'Código', type: 'code' },
    { key: 8, label: 'Código 2', type: 'code' },
    { key: 9, label: 'Estatus', type: 'status' },
    { key: 12, label: 'Cant Inicial', type: 'number' },
    { key: 13, label: 'Cant Despacho', type: 'number' },
    { key: 15, label: 'Operador', type: 'text' },
    { key: 16, label: 'Unidad', type: 'text' }
],

// Campos de tabla para Reparaciones
reparaciones: [
    { key: 0, label: 'Fecha Registro', type: 'date' },
    { key: 1, label: 'OBC', type: 'code' },
    { key: 2, label: 'Código', type: 'code' },
    { key: 6, label: 'Reparado', type: 'status' },
    { key: 7, label: 'Entregado', type: 'status' },
    { key: 8, label: 'Observaciones 1', type: 'text' },
    { key: 9, label: 'Observaciones 2', type: 'text' }
]
```

### 5. Integración de Funcionalidades Existentes

#### A) Función de Copia (Hover + Click)
✅ **Automáticamente extendida** - Las funciones `makeCopyable()` y `copyToClipboard()` ya funcionan con las nuevas bases porque son genéricas y se aplican a nivel de `formatValue()`.

#### B) Aplicación de BaseCode
✅ **Implementada nativamente** - Ambas funciones de búsqueda (`searchEMBARQUES` y `searchREPARACIONES`) utilizan `extractBaseCode()` para búsqueda fuzzy.

#### C) Exportación y Exportación
✅ **Soporte completo** - Las funciones `exportResults()` y `printResults()` ya incluyen las nuevas fuentes porque iteran dinámicamente sobre `results.exact` y `results.partial`.

---

## 🎨 INDICADORES VISUALES

### Tarjeta de Embarques 🚚
```
┌─────────────────────────────┐
│ 🚚 Embarques                │
│ PROCESADO          [icono]  │
│ 📦 14/15 despachadas        │
└─────────────────────────────┘
```

**Estados:**
- **Primary (azul):** Tiene embarques registrados
- **Gray:** Sin despacho

**Interacción:**
- Click → Redirige a sección de embarques
- Muestra contador de progreso (despachadas/total)

### Tarjeta de Reparaciones 🔧
```
┌─────────────────────────────┐
│ 🔧 Reparaciones             │
│ SÍ                 [icono]  │
│ ✅ Reparado • ✅ Entregado  │
└─────────────────────────────┘
```

**Estados:**
- **Warning (amarillo):** Caja SÍ está en reparaciones
- **Success (verde):** Caja NO está en reparaciones

**Indicadores de Estado:**
- ✅ Reparado - Si columna G = "SI"
- ⏳ En proceso - Si columna G ≠ "SI"
- ✅ Entregado - Si columna H = "SI"

---

## 📈 MEJORAS DE RENDIMIENTO

### 1. Progreso de Carga Actualizado
**Archivo:** `index.html` - Línea 21

```html
<!-- Antes: 0/7 completadas -->
<!-- Ahora: 0/9 completadas -->
<div class="loading-progress" id="loading-progress">0/9 completadas</div>
```

### 2. Logs de Debugging
Ambas funciones de búsqueda incluyen logs detallados:

```javascript
console.log(`🚚 [EMBARQUES] Búsqueda completada:`, {
    query,
    baseCode,
    isOBCQuery,
    directMatches: directMatches.length,
    triangulatedMatches: triangulatedMatches.length,
    total: directMatches.length + triangulatedMatches.length
});

console.log(`🔧 [REPARACIONES] Búsqueda completada:`, {
    query,
    baseCode,
    matches: results.exact[sourceName].length
});
```

---

## 🧪 CASOS DE PRUEBA

### Caso 1: Búsqueda por OBC en Embarques
**Input:** `OBC3272512270RU`
**Esperado:**
- ✅ Busca directamente en columna Orden (índice 4)
- ✅ Retorna todos los embarques de esa OBC
- ✅ Muestra método: `OBC_directa`

### Caso 2: Búsqueda por Código Base en Embarques
**Input:** `PLEC25071567355` (código base sin U###)
**Esperado:**
- ✅ Busca en columnas Código (7) y Código 2 (8)
- ✅ Match por BaseCode fuzzy
- ✅ Muestra método: `BaseCode_codigo` o `BaseCode_codigo2`

### Caso 3: Búsqueda con Triangulación
**Input:** `PLEC25071567355U010` (código completo de caja)
**Flujo Esperado:**
1. ✅ Busca BaseCode en Embarques → No encuentra
2. ✅ Busca en OBC_BD → Encuentra OBC3272512270RU
3. ✅ Busca OBC3272512270RU en Embarques → Encuentra embarques
4. ✅ Retorna resultados con método: `Triangulación_OBC`

### Caso 4: Búsqueda Exacta en Reparaciones
**Input:** `PLEC25071567355U010`
**Esperado:**
- ✅ Busca en columna CODIGO (índice 2)
- ✅ Match exacto → Similaridad 100%
- ✅ Tarjeta muestra: **SÍ**
- ✅ Indica estado: Reparado / En proceso / Entregado

### Caso 5: Búsqueda BaseCode en Reparaciones
**Input:** `PLEC25071567355` (código base)
**Esperado:**
- ✅ Busca por BaseCode fuzzy
- ✅ Match parcial → Similaridad 85-90%
- ✅ Retorna coincidencias
- ✅ Método: `BaseCode_fuzzy` o `BaseCode_exacto`

---

## 🚀 CARACTERÍSTICAS CLAVE

### ✅ Triangulación de Datos (Embarques)
- Soluciona la falta de códigos completos de caja en Embarques
- Usa OBC_BD como puente para asociar cajas con embarques
- Retorna TODAS las órdenes asociadas a una caja

### ✅ Búsqueda Booleana (Reparaciones)
- Indicador claro SI/NO para estado de reparación
- Múltiples niveles de coincidencia fuzzy
- Muestra progreso de reparación (Reparado/Entregado)

### ✅ BaseCode Universal
- Aplica a TODAS las búsquedas en ambas bases
- Permite coincidencias flexibles sin código completo
- Normalización automática de códigos

### ✅ Integración Transparente
- Funciones de copia extendidas automáticamente
- Exportación e impresión sin modificaciones
- UI consistente con bases existentes

---

## 📊 RESUMEN DE ARCHIVOS MODIFICADOS

| Archivo | Líneas Modificadas | Cambios Principales |
|---------|-------------------|---------------------|
| `index.html` | 21 | Progreso de carga: 0/9 |
| `app.js` | 5-18 | CONFIG: Nuevas URLs |
| `app.js` | 20-30 | DATA_CACHE: Nuevos arrays |
| `app.js` | 33-42 | SECTION_MODES: Nuevos modos |
| `app.js` | 92-109 | Mapeo de fuentes |
| `app.js` | 413-423 | results.exact/partial: Nuevas keys |
| `app.js` | 468-476 | Llamadas a searchEMBARQUES y searchREPARACIONES |
| `app.js` | 685-850 | Funciones de búsqueda nuevas (165 líneas) |
| `app.js` | 1037-1040 | Summary: Nuevas variables info |
| `app.js` | 1046-1051 | Summary: Contadores flexibles |
| `app.js` | 1189-1212 | Summary: Nuevas tarjetas UI |
| `app.js` | 1262-1271 | displaySections: Nuevas secciones |
| `app.js` | 1484-1507 | getRelevantFields: Nuevos campos |
| `app.js` | 1609-1620 | getSourceName: Nuevos nombres |

**Total de líneas agregadas:** ~250 líneas
**Total de líneas modificadas:** ~30 líneas

---

## 🔄 PRÓXIMOS PASOS SUGERIDOS

1. **Testing Exhaustivo:**
   - Probar búsquedas por OBC en Embarques
   - Validar triangulación con códigos completos
   - Verificar búsqueda fuzzy en Reparaciones

2. **Optimización:**
   - Cachear resultados de triangulación
   - Indexar códigos base para búsquedas más rápidas

3. **Monitoreo:**
   - Revisar logs de búsqueda en consola
   - Validar similaridades en coincidencias fuzzy

4. **Feedback:**
   - Recopilar experiencia de usuarios con triangulación
   - Evaluar utilidad del indicador SI/NO en Reparaciones

---

**Versión del documento:** 1.0
**Autor:** Claude AI Assistant
**Fecha de implementación:** 2026-01-20
**Estado:** ✅ Completado e integrado
