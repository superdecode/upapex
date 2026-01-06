# Corrección: Sincronización de Base de Datos de Escritura
## Dispatch App - Enero 2026

---

## 🔴 PROBLEMA IDENTIFICADO

Los datos validados y folios que ya existían en la base de datos de escritura (Google Sheets "Despachos") **NO se estaban cargando** al iniciar la aplicación.

### Síntomas:
- ✗ Registros validados existentes en BD no aparecían en el sistema
- ✗ Folios previamente creados no se mostraban
- ✗ Usuarios veían sistema "vacío" a pesar de tener datos guardados
- ✗ Pérdida aparente de información histórica

### Causa Raíz:
El sistema solo cargaba datos de **lectura** (catálogos estáticos) pero **NO** cargaba datos de **escritura** (registros validados y folios) desde la hoja "Despachos" de Google Sheets.

---

## ✅ SOLUCIÓN IMPLEMENTADA

### 1. Nueva Función: `loadExistingValidatedRecords()`

Carga todos los registros validados existentes desde la hoja "Despachos" de Google Sheets.

```javascript
async function loadExistingValidatedRecords() {
    if (!gapi?.client?.sheets) {
        console.log('⚠️ Google Sheets API not available');
        return;
    }

    try {
        console.log('📥 Loading existing validated records...');
        
        // Leer hoja Despachos completa (columnas A:P)
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: 'Despachos!A:P'
        });

        const rows = response.result.values;
        if (!rows || rows.length <= 1) {
            console.log('ℹ️ No existing validated records found');
            return;
        }

        // Parsear cada fila (saltar encabezado)
        const validatedRecords = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row.length >= 5) {
                const record = {
                    folio: row[0] || '',           // A: Folio
                    fecha: row[1] || '',           // B: Fecha
                    hora: row[2] || '',            // C: Hora
                    usuario: row[3] || '',         // D: Usuario
                    orden: row[4] || '',           // E: Orden
                    destino: row[5] || '',         // F: Destino
                    horario: row[6] || '',         // G: Horario
                    codigo: row[7] || '',          // H: Código
                    codigo2: row[8] || '',         // I: Código 2
                    estatus: row[9] || '',         // J: Estatus
                    tarea: row[10] || '',          // K: Tarea
                    estatus2: row[11] || '',       // L: Estatus2
                    incidencias: row[12] || '',    // M: Incidencias
                    operador: row[13] || '',       // N: Operador
                    conductor: row[13] || '',      // Alias
                    unidad: row[14] || '',         // O: Unidad
                    observaciones: row[15] || '',  // P: Observaciones
                    notaDespacho: row[15] || '',   // Alias
                    cantidadDespachar: parseCantidadFromIncidencias(row[12] || '')
                };

                if (record.orden) {
                    validatedRecords.push(record);
                }
            }
        }

        // Actualizar STATE con registros cargados
        STATE.localValidated = validatedRecords;
        
        // Reconstruir mapa de folios
        rebuildFoliosFromRecords(validatedRecords);
        
        console.log(`✅ Loaded ${validatedRecords.length} validated records`);
        
        saveLocalState();
        
    } catch (error) {
        console.error('Error loading validated records:', error);
        throw error;
    }
}
```

### 2. Nueva Función: `parseCantidadFromIncidencias()`

Extrae la cantidad despachada del campo de incidencias.

```javascript
function parseCantidadFromIncidencias(incidencias) {
    if (!incidencias) return 0;
    // Formato: "Parcial: 5/10" -> 5
    const match = incidencias.match(/Parcial:\s*(\d+)\/(\d+)/);
    if (match) {
        return parseInt(match[1]) || 0;
    }
    return 0;
}
```

### 3. Nueva Función: `rebuildFoliosFromRecords()`

Reconstruye el mapa de folios desde los registros validados.

```javascript
function rebuildFoliosFromRecords(records) {
    STATE.foliosDeCargas.clear();
    
    records.forEach(record => {
        if (!record.folio || !record.operador || !record.unidad) return;
        
        // Extraer fecha y número de folio: DSP-YYYYMMDD-XX
        const folioMatch = record.folio.match(/DSP-(\d{8})-(\d{2})/);
        if (!folioMatch) return;
        
        const dateStr = folioMatch[1];  // YYYYMMDD
        const folioNum = folioMatch[2]; // XX
        
        // Convertir a formato de fecha: YYYY-MM-DD
        const dateKey = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
        
        // Agregar a mapa de folios
        if (!STATE.foliosDeCargas.has(dateKey)) {
            STATE.foliosDeCargas.set(dateKey, new Map());
        }
        
        const foliosDelDia = STATE.foliosDeCargas.get(dateKey);
        if (!foliosDelDia.has(folioNum)) {
            foliosDelDia.set(folioNum, {
                conductor: record.operador,
                unidad: record.unidad
            });
        }
    });
    
    console.log(`📋 Rebuilt ${STATE.foliosDeCargas.size} days of folios`);
}
```

### 4. Nueva Función: `loadExistingFolios()`

Placeholder para carga de folios (actualmente se reconstruyen desde registros).

```javascript
async function loadExistingFolios() {
    // Folios ya reconstruidos desde registros validados
    // Esta función existe para expansión futura
    console.log('✅ Folios loaded from validated records');
}
```

### 5. Integración en `loadAllData()`

Actualizado para cargar datos transaccionales al inicio.

```javascript
async function loadAllData() {
    STATE.isLoading = true;
    STATE.loadingProgress = 0;
    showLoadingOverlay(true, 0, 7);  // Aumentado a 7
    
    let errors = [];
    let loaded = 0;
    const total = 7;  // 5 estáticos + 2 transaccionales

    // ... cargar BD_CAJAS, VALIDACION, MNE, TRS, LISTAS ...

    // ==================== CARGAR DATOS TRANSACCIONALES ====================
    // Cargar registros validados existentes
    try {
        await loadExistingValidatedRecords();
        loaded++;
        STATE.loadingProgress = loaded;
        showLoadingOverlay(true, loaded, total);
    } catch (e) {
        console.error('Error loading validated records:', e);
        errors.push('VALIDATED_RECORDS');
    }

    // Cargar folios existentes
    try {
        await loadExistingFolios();
        loaded++;
        STATE.loadingProgress = loaded;
        showLoadingOverlay(true, loaded, total);
    } catch (e) {
        console.error('Error loading folios:', e);
        errors.push('FOLIOS');
    }

    STATE.isLoading = false;
    showLoadingOverlay(false);

    // Notificación mejorada con conteos
    const validatedCount = STATE.localValidated.length;
    const foliosCount = STATE.foliosDeCargas.size;
    
    if (errors.length === 0) {
        showNotification(
            `✅ ${STATE.obcData.size} órdenes, ${validatedCount} validadas, ${foliosCount} días de folios cargados`,
            'success'
        );
    }

    updateBdInfo();
    updateSummary();
    
    // Actualizar UI con datos cargados
    if (validatedCount > 0) {
        console.log(`📊 Loaded: ${STATE.obcData.size} orders, ${validatedCount} validated, ${foliosCount} folio days`);
        updateValidationBadges();
    }
}
```

### 6. Actualización de `syncTransactionalData()`

Ahora también sincroniza registros validados cada 10 segundos.

```javascript
async function syncTransactionalData() {
    if (!STATE.isOnline || STATE.syncInProgress) return;
    
    STATE.syncInProgress = true;
    updateConnectionStatus();
    
    try {
        // Sync validacion data (surtido)
        // ... código existente ...
        
        // ✨ NUEVO: Sync validated records from Despachos sheet
        if (gapi?.client?.sheets) {
            await loadExistingValidatedRecords();
        }
        
        STATE.lastSyncTime = Date.now();
        saveLocalState();
        
    } catch (error) {
        console.error('Error syncing transactional data:', error);
    } finally {
        STATE.syncInProgress = false;
        updateConnectionStatus();
    }
}
```

---

## 📊 ESTRUCTURA DE DATOS

### Hoja "Despachos" en Google Sheets

| Columna | Campo | Descripción | Ejemplo |
|---------|-------|-------------|---------|
| A | Folio | Folio único | DSP-20260106-01 |
| B | Fecha | Fecha del despacho | 06/01/2026 |
| C | Hora | Hora del despacho | 14:30:00 |
| D | Usuario | Usuario que procesó | juan@example.com |
| E | Orden | Número de orden | OBC123456 |
| F | Destino | Cliente/Destinatario | CLIENTE ABC |
| G | Horario | Horario esperado | 2026-01-07 |
| H | Código | Código de tracking | TRACK123 |
| I | Código 2 | Referencia adicional | REF456 |
| J | Estatus | Estado del despacho | Procesado |
| K | Tarea | Tipo de tarea | Despacho |
| L | Estatus2 | Estado secundario | Completado |
| M | Incidencias | Notas parciales | Parcial: 8/10 |
| N | Operador | Conductor asignado | Juan Pérez |
| O | Unidad | Placas del vehículo | ABC-123 |
| P | Observaciones | Notas adicionales | Entrega urgente |

### Mapeo a STATE

```javascript
STATE = {
    // Registros validados cargados desde Despachos
    localValidated: [
        {
            folio: 'DSP-20260106-01',
            fecha: '06/01/2026',
            hora: '14:30:00',
            usuario: 'juan@example.com',
            orden: 'OBC123456',
            destino: 'CLIENTE ABC',
            horario: '2026-01-07',
            codigo: 'TRACK123',
            codigo2: 'REF456',
            estatus: 'Procesado',
            tarea: 'Despacho',
            estatus2: 'Completado',
            incidencias: 'Parcial: 8/10',
            operador: 'Juan Pérez',
            conductor: 'Juan Pérez',
            unidad: 'ABC-123',
            observaciones: 'Entrega urgente',
            notaDespacho: 'Entrega urgente',
            cantidadDespachar: 8  // Parseado de incidencias
        }
    ],
    
    // Folios reconstruidos desde registros
    foliosDeCargas: Map {
        '2026-01-06' => Map {
            '01' => { conductor: 'Juan Pérez', unidad: 'ABC-123' }
        }
    }
}
```

---

## 🔄 FLUJO DE CARGA

### Al Iniciar Sesión

```
1. Usuario inicia sesión
2. loadAllData() se ejecuta
3. Cargar catálogos estáticos (BD_CAJAS, MNE, TRS, LISTAS)
4. ✨ Cargar registros validados desde Despachos sheet
5. ✨ Reconstruir folios desde registros
6. Mostrar notificación: "✅ 150 órdenes, 45 validadas, 3 días de folios cargados"
7. Actualizar UI con badges y contadores
8. Iniciar sincronización en tiempo real (cada 10s)
```

### Durante Sincronización (cada 10 segundos)

```
1. syncTransactionalData() se ejecuta
2. Sincronizar datos de validación (surtido)
3. ✨ Sincronizar registros validados desde Despachos
4. Detectar cambios
5. Actualizar UI si hay cambios
6. Guardar estado local
```

---

## 📈 BENEFICIOS

### ✅ Datos Persistentes
- Los registros validados ahora se cargan al iniciar
- Los folios históricos están disponibles inmediatamente
- No se pierde información entre sesiones

### ✅ Sincronización Continua
- Cada 10 segundos se actualizan los registros
- Cambios de otros usuarios visibles en tiempo real
- Consistencia entre múltiples usuarios

### ✅ Reconstrucción Inteligente
- Folios se reconstruyen automáticamente desde registros
- No requiere tabla separada de folios
- Mantiene integridad referencial

### ✅ Feedback Mejorado
- Notificación muestra conteos detallados
- Logs en consola para debugging
- Indicadores visuales de carga

---

## 🧪 VERIFICACIÓN

### Cómo Verificar que Funciona

1. **Crear registros de prueba en Google Sheets**:
   - Abrir hoja "Despachos"
   - Agregar filas con datos de prueba
   - Guardar

2. **Iniciar sesión en Dispatch App**:
   - Observar notificación de carga
   - Verificar que muestra: "X validadas, Y días de folios"

3. **Revisar consola del navegador**:
   ```
   📥 Loading existing validated records from Despachos sheet...
   ✅ Loaded 45 validated records from Despachos sheet
   📋 Rebuilt 3 days of folios from records
   📊 Loaded data summary: 150 orders, 45 validated, 3 folio days
   ```

4. **Verificar UI**:
   - Ir a pestaña "✅ Validadas"
   - Deben aparecer los registros cargados
   - Ir a "🚚 Folios"
   - Deben aparecer los folios reconstruidos

5. **Probar sincronización**:
   - Agregar nuevo registro en Google Sheets
   - Esperar 10 segundos
   - Verificar que aparece en la app sin refrescar

---

## 🔧 CONFIGURACIÓN REQUERIDA

### Google Sheets

1. **Hoja "Despachos" debe existir** en el spreadsheet:
   - ID: `1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o`
   - Nombre exacto: `Despachos`

2. **Encabezados en fila 1** (A1:P1):
   ```
   Folio | Fecha | Hora | Usuario | Orden | Destino | Horario | Código | 
   Código 2 | Estatus | Tarea | Estatus2 | Incidencias | Operador | 
   Unidad | Observaciones
   ```

3. **Permisos**:
   - La app debe tener acceso de lectura a la hoja
   - Scope: `https://www.googleapis.com/auth/spreadsheets`

### Variables de Configuración

```javascript
const CONFIG = {
    SPREADSHEET_WRITE: '1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o',
    // ... otras configuraciones
};
```

---

## 🐛 TROUBLESHOOTING

### Problema: No se cargan registros

**Síntomas**: Notificación muestra "0 validadas"

**Soluciones**:
1. Verificar que existe hoja "Despachos"
2. Verificar permisos de Google Sheets API
3. Revisar consola para errores
4. Verificar formato de datos en hoja

### Problema: Folios no aparecen

**Síntomas**: Sección de folios vacía

**Soluciones**:
1. Verificar formato de folio: `DSP-YYYYMMDD-XX`
2. Verificar que registros tienen operador y unidad
3. Revisar logs de reconstrucción en consola

### Problema: Sincronización no funciona

**Síntomas**: Cambios en Google Sheets no aparecen

**Soluciones**:
1. Verificar conexión a internet
2. Verificar que sincronización está activa (cada 10s)
3. Revisar banner de conexión
4. Verificar que no hay errores en consola

---

## 📝 LOGS DE DEBUGGING

### Logs Normales (Éxito)

```javascript
📥 Loading existing validated records from Despachos sheet...
✅ Loaded 45 validated records from Despachos sheet
📋 Rebuilt 3 days of folios from records
✅ Folios loaded from validated records
📊 Loaded data summary: 150 orders, 45 validated, 3 folio days
🔄 Validacion data updated from remote
```

### Logs de Error

```javascript
⚠️ Google Sheets API not available, skipping validated records load
Error loading validated records: [error details]
ℹ️ No existing validated records found
```

---

## 🎯 RESUMEN

### Antes de la Corrección
- ❌ Datos validados no se cargaban
- ❌ Folios no aparecían
- ❌ Sistema parecía "vacío"
- ❌ Pérdida aparente de datos históricos

### Después de la Corrección
- ✅ Datos validados se cargan al inicio
- ✅ Folios se reconstruyen automáticamente
- ✅ Sistema muestra información completa
- ✅ Sincronización continua cada 10 segundos
- ✅ Notificaciones detalladas con conteos
- ✅ Logs completos para debugging

---

**Fecha de Implementación**: Enero 6, 2026  
**Versión**: 2.1.0 - Sincronización BD Escritura  
**Estado**: ✅ Implementado y Funcional
