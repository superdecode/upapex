# Arquitectura de Datos - Sistema de Sincronización Compartido

## Esquema de Datos Unificado

### Estructura de Registro Base

Todos los registros que se sincronizan deben seguir esta estructura base:

```javascript
{
    // Campos obligatorios
    date: String,           // Formato: DD/MM/YYYY
    time: String,           // Formato: HH:MM:SS
    user: String,           // Email del usuario
    scan1: String,          // Código principal (obligatorio)
    location: String,       // Ubicación (obligatorio)
    pallet: String,         // ID del pallet (obligatorio)
    
    // Campos opcionales
    scan2: String,          // Código secundario
    status: String,         // Estado del registro
    note: String,           // Notas adicionales
    originLocation: String, // Ubicación de origen
    
    // Metadatos (agregados automáticamente)
    _id: String,            // UUID único
    _timestamp: Number,     // Timestamp en ms
    _status: String,        // 'pending' | 'synced'
    _syncedAt: Number       // Timestamp de sincronización
}
```

### Mapeo de Columnas en Google Sheets

| Columna | Índice | Campo | Tipo | Requerido |
|---------|--------|-------|------|-----------|
| A | 0 | date | String | ✅ |
| B | 1 | time | String | ✅ |
| C | 2 | user | String | ✅ |
| D | 3 | scan1 | String | ✅ |
| E | 4 | scan2 | String | ❌ |
| F | 5 | location | String | ✅ |
| G | 6 | status | String | ❌ |
| H | 7 | note | String | ❌ |
| I | 8 | pallet | String | ✅ |
| J | 9 | originLocation | String | ❌ |

### Formato de Datos por Tipo

#### Fechas
```javascript
// Formato estándar
SyncUtils.formatDate() // "08/01/2026"

// Validación
const isValidDate = /^\d{2}\/\d{2}\/\d{4}$/.test(dateString);
```

#### Horas
```javascript
// Formato estándar
SyncUtils.formatTime() // "20:51:30"

// Validación
const isValidTime = /^\d{2}:\d{2}:\d{2}$/.test(timeString);
```

#### Códigos de Barras
```javascript
// Normalización
const cleanCode = SyncUtils.cleanCode(rawCode);

// Validación
const isValid = SyncUtils.validateBarcode(code);
// Longitud: 8-50 caracteres
// Solo alfanuméricos y guiones
```

#### IDs de Pallet
```javascript
// Generación estándar
const palletId = SyncUtils.generatePalletId('PREFIX');
// Formato: PREFIX-TIMESTAMP-RANDOM
// Ejemplo: PLT-1KXYZ123-ABC45

// Validación
const isValidPallet = /^[A-Z]+-[A-Z0-9]+-[A-Z0-9]+$/.test(palletId);
```

## Stores de IndexedDB

### 1. draft_boxes
Almacena cajas en borrador (tarima activa)

```javascript
{
    _id: String,           // UUID único
    _category: String,     // 'ok' | 'blocked' | 'nowms'
    _palletId: String,     // ID del pallet
    _sessionId: String,    // ID de sesión
    _timestamp: Number,    // Timestamp de creación
    
    // Datos del registro
    ...baseRecord
}
```

**Índices:**
- `_category` - Para filtrar por categoría
- `_palletId` - Para filtrar por pallet
- `_sessionId` - Para filtrar por sesión
- `_timestamp` - Para ordenar cronológicamente

### 2. pending_sync_v2
Almacena registros pendientes de sincronización

```javascript
{
    _id: String,           // UUID único
    _status: String,       // 'pending' | 'syncing' | 'error'
    _timestamp: Number,    // Timestamp de creación
    _retries: Number,      // Número de reintentos
    
    // Datos del registro
    ...baseRecord
}
```

**Índices:**
- `_status` - Para filtrar por estado
- `_timestamp` - Para ordenar cronológicamente

### 3. synced_records
Almacena registros ya sincronizados (auditoría)

```javascript
{
    _id: String,           // UUID único (mismo que en pending)
    _status: String,       // 'synced'
    _syncedAt: Number,     // Timestamp de sincronización
    _sheetRow: Number,     // Fila en Google Sheets
    
    // Datos del registro
    ...baseRecord
}
```

**Índices:**
- `_syncedAt` - Para ordenar por fecha de sync

### 4. sessions
Almacena sesiones de trabajo

```javascript
{
    id: String,            // UUID de sesión
    createdAt: Number,     // Timestamp de creación
    closedAt: Number,      // Timestamp de cierre
    closed: Boolean,       // Si está cerrada
    user: String,          // Usuario de la sesión
    appName: String,       // Nombre de la app
    
    // Estadísticas
    stats: {
        totalRecords: Number,
        syncedRecords: Number,
        pendingRecords: Number
    }
}
```

**Índices:**
- `createdAt` - Para ordenar cronológicamente

## Claves de Deduplicación

### Clave de Registro
```javascript
// Formato
const recordKey = `${pallet}|${scan1}|${location}`;

// Ejemplo
"PLT-123|CODE456|A-01"
```

### Clave de Pallet
```javascript
// Formato
const palletKey = `${palletId}|${location}`;

// Ejemplo
"PLT-123|A-01"
```

### Clave de Sincronización
```javascript
// Formato
const syncKey = `${date}_${time}_${scan1}_${user}`;

// Ejemplo
"08/01/2026_20:51:30_CODE123_user@example.com"
```

## Flujo de Datos

### 1. Captura → Draft
```
Usuario escanea
    ↓
Validación de código
    ↓
Verificación de duplicados (cache)
    ↓
Creación de registro con metadatos
    ↓
Guardado en draft_boxes (IndexedDB)
    ↓
Actualización de UI
```

### 2. Draft → Pending
```
Usuario confirma pallet
    ↓
Validación de pallet completo
    ↓
Filtrado de duplicados
    ↓
Transacción atómica:
  - Eliminar de draft_boxes
  - Agregar a pending_sync_v2
    ↓
Actualización de contador
```

### 3. Pending → Synced
```
Trigger de sincronización (auto/manual)
    ↓
Verificación de conectividad
    ↓
Filtrado de duplicados (dedup manager)
    ↓
Control de concurrencia:
  - Read última fila
  - Write en rango específico
  - Verify integridad
    ↓
Handshake confirmado
    ↓
Transacción atómica:
  - Eliminar de pending_sync_v2
  - Agregar a synced_records
  - Actualizar cache de procesados
    ↓
Actualización de UI
```

## Consistencia de Datos

### Reglas de Validación

#### 1. Campos Obligatorios
```javascript
function validateRecord(record) {
    const required = ['date', 'time', 'user', 'scan1', 'location', 'pallet'];
    
    for (const field of required) {
        if (!record[field] || record[field].trim() === '') {
            throw new Error(`Campo obligatorio faltante: ${field}`);
        }
    }
    
    return true;
}
```

#### 2. Formato de Datos
```javascript
function validateFormats(record) {
    // Fecha
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(record.date)) {
        throw new Error('Formato de fecha inválido');
    }
    
    // Hora
    if (!/^\d{2}:\d{2}:\d{2}$/.test(record.time)) {
        throw new Error('Formato de hora inválido');
    }
    
    // Email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.user)) {
        throw new Error('Email inválido');
    }
    
    // Código
    if (!SyncUtils.validateBarcode(record.scan1)) {
        throw new Error('Código de barras inválido');
    }
    
    return true;
}
```

#### 3. Integridad Referencial
```javascript
async function validateIntegrity(record, syncManager) {
    // Verificar que el pallet no esté duplicado
    const isDuplicate = syncManager.deduplicationManager.isPalletSynced(
        record.pallet,
        record.location
    );
    
    if (isDuplicate) {
        throw new Error('Pallet ya sincronizado');
    }
    
    // Verificar que el código no esté procesado
    const processed = await syncManager.processedCacheManager?.findProcessedBox(
        record.scan1,
        syncManager.pendingSync
    );
    
    if (processed) {
        throw new Error('Código ya procesado');
    }
    
    return true;
}
```

### Normalización de Datos

#### 1. Códigos de Barras
```javascript
// Siempre normalizar antes de guardar o comparar
const normalized = SyncUtils.cleanCode(rawCode);

// Elimina:
// - Espacios en blanco
// - Caracteres invisibles
// - Saltos de línea
// - Convierte a mayúsculas
```

#### 2. Ubicaciones
```javascript
function normalizeLocation(location) {
    return location
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '-'); // Espacios → guiones
}

// Ejemplos:
// "a 01" → "A-01"
// "  B-02  " → "B-02"
```

#### 3. Estados
```javascript
// Estados válidos
const VALID_STATUSES = ['OK', 'BLOCKED', 'NOWMS', 'ERROR'];

function normalizeStatus(status) {
    const normalized = status.trim().toUpperCase();
    
    if (!VALID_STATUSES.includes(normalized)) {
        return 'OK'; // Default
    }
    
    return normalized;
}
```

## Migración de Datos

### De localStorage a IndexedDB

```javascript
async function migrateFromLocalStorage(syncManager) {
    // 1. Cargar datos antiguos
    const oldPending = localStorage.getItem('pd_pending_sync');
    const oldSynced = localStorage.getItem('pd_synced_pallets');
    
    if (oldPending) {
        const records = JSON.parse(oldPending);
        
        // 2. Migrar a IndexedDB
        for (const record of records) {
            // Agregar metadatos si faltan
            if (!record._id) {
                record._id = SyncUtils.generateUUID();
            }
            if (!record._timestamp) {
                record._timestamp = Date.now();
            }
            if (!record._status) {
                record._status = 'pending';
            }
            
            // Guardar en IndexedDB
            await syncManager.persistenceManager.saveDraftBox(record);
        }
        
        console.log(`✅ Migrados ${records.length} registros a IndexedDB`);
    }
    
    if (oldSynced) {
        const pallets = JSON.parse(oldSynced);
        syncManager.deduplicationManager.syncedPallets = new Set(pallets);
        syncManager.deduplicationManager.saveSyncedPallets();
        
        console.log(`✅ Migrados ${pallets.length} pallets sincronizados`);
    }
}
```

### Versionado de Esquema

```javascript
// Incrementar DB_VERSION cuando cambie el esquema
const DB_VERSION = 3; // v3: Agregado campo originLocation

// En onupgradeneeded
request.onupgradeneeded = (event) => {
    const db = event.target.result;
    const oldVersion = event.oldVersion;
    
    // Migración de v1 a v2
    if (oldVersion < 2) {
        // Agregar índice _status
        const store = transaction.objectStore('pending_sync');
        if (!store.indexNames.contains('_status')) {
            store.createIndex('_status', '_status', { unique: false });
        }
    }
    
    // Migración de v2 a v3
    if (oldVersion < 3) {
        // Agregar campo originLocation a registros existentes
        const store = transaction.objectStore('pending_sync');
        const request = store.openCursor();
        
        request.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const record = cursor.value;
                if (!record.originLocation) {
                    record.originLocation = '';
                    cursor.update(record);
                }
                cursor.continue();
            }
        };
    }
};
```

## Configuración por App

### Dispatch App
```javascript
const DISPATCH_SCHEMA = {
    spreadsheetId: 'DISPATCH_SHEET_ID',
    sheetName: 'Despachos',
    columns: {
        fecha: 0,
        hora: 1,
        usuario: 2,
        folio: 3,
        ubicacion: 5,
        estado: 6,
        notas: 7,
        pallet: 8
    },
    formatRecord: (record) => [
        record.date,
        record.time,
        record.user,
        record.folio,
        record.scan2 || '',
        record.location,
        record.status,
        record.note,
        record.pallet,
        record.originLocation || ''
    ]
};
```

### Validador App
```javascript
const VALIDATOR_SCHEMA = {
    spreadsheetId: 'VALIDATOR_SHEET_ID',
    sheetName: 'Validaciones',
    columns: {
        fecha: 0,
        hora: 1,
        usuario: 2,
        codigo: 3,
        ubicacion: 5,
        resultado: 6
    },
    formatRecord: (record) => [
        record.date,
        record.time,
        record.user,
        record.scan1,
        record.scan2 || '',
        record.location,
        record.status,
        record.note,
        record.pallet,
        ''
    ]
};
```

### Track App
```javascript
const TRACK_SCHEMA = {
    spreadsheetId: 'TRACK_SHEET_ID',
    sheetName: 'Tracking',
    columns: {
        fecha: 0,
        hora: 1,
        usuario: 2,
        tracking: 3,
        ubicacion: 5,
        estado: 6
    },
    formatRecord: (record) => [
        record.date,
        record.time,
        record.user,
        record.scan1,
        record.scan2 || '',
        record.location,
        record.status,
        record.note,
        record.pallet,
        record.originLocation || ''
    ]
};
```

## Límites y Cuotas

### IndexedDB
- **Tamaño máximo:** ~50% del espacio disponible en disco
- **Verificación:** `SyncUtils.estimateStorageQuota()`
- **Recomendación:** Limpiar registros sincronizados > 30 días

### Google Sheets API
- **Lecturas:** 100 requests/100 segundos/usuario
- **Escrituras:** 100 requests/100 segundos/usuario
- **Celdas por request:** 10,000,000
- **Mitigación:** Usar batch updates y control de concurrencia

### localStorage (Fallback)
- **Tamaño máximo:** ~5-10 MB
- **Uso:** Solo como fallback si IndexedDB falla
- **Limitación:** No soporta transacciones atómicas

## Monitoreo y Logs

### Eventos a Registrar

```javascript
// 1. Operaciones de sincronización
console.log('[SYNC]', {
    action: 'sync_start',
    pendingCount: count,
    timestamp: Date.now()
});

// 2. Errores de concurrencia
console.error('[CONCURRENCY]', {
    action: 'conflict_detected',
    attempt: attemptNumber,
    error: errorMessage
});

// 3. Deduplicación
console.warn('[DEDUP]', {
    action: 'duplicate_filtered',
    key: recordKey,
    source: 'pending_sync'
});

// 4. Cache
console.log('[CACHE]', {
    action: 'sync_from_server',
    cacheSize: size,
    duration: durationMs
});
```

### Métricas Clave

```javascript
const metrics = {
    // Sincronización
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    avgSyncDuration: 0,
    
    // Deduplicación
    duplicatesFiltered: 0,
    duplicatesInPending: 0,
    duplicatesInServer: 0,
    
    // Concurrencia
    concurrencyConflicts: 0,
    retriesExecuted: 0,
    
    // Cache
    cacheHits: 0,
    cacheMisses: 0,
    cacheSize: 0
};
```

## Backup y Recuperación

### Exportar Datos
```javascript
async function exportAllData(syncManager) {
    const data = {
        pending: await syncManager.persistenceManager.getPendingSync(),
        synced: syncManager.deduplicationManager.syncedPallets,
        cache: [...syncManager.processedCacheManager.processedBoxesMap.entries()],
        timestamp: Date.now()
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
```

### Importar Datos
```javascript
async function importData(file, syncManager) {
    const text = await file.text();
    const data = JSON.parse(text);
    
    // Restaurar pending
    for (const record of data.pending) {
        await syncManager.persistenceManager.saveDraftBox(record);
    }
    
    // Restaurar synced pallets
    syncManager.deduplicationManager.syncedPallets = new Set(data.synced);
    syncManager.deduplicationManager.saveSyncedPallets();
    
    // Restaurar cache
    for (const [key, value] of data.cache) {
        syncManager.processedCacheManager.processedBoxesMap.set(key, value);
    }
    await syncManager.processedCacheManager.saveToIndexedDB();
    
    console.log('✅ Datos importados correctamente');
}
```

## Seguridad

### Validación de Entrada
```javascript
function sanitizeInput(input) {
    return input
        .replace(/[<>]/g, '') // Eliminar < >
        .replace(/javascript:/gi, '') // Eliminar javascript:
        .replace(/on\w+=/gi, '') // Eliminar event handlers
        .trim();
}
```

### Prevención de Inyección
```javascript
// Nunca usar eval() o Function() con datos del usuario
// Siempre validar antes de guardar
// Usar prepared statements en queries
```

### Control de Acceso
```javascript
// Verificar autenticación antes de operaciones
if (!SyncUtils.hasGoogleToken()) {
    throw new Error('No autenticado');
}

// Verificar permisos del usuario
if (!user.hasPermission('write')) {
    throw new Error('Sin permisos de escritura');
}
```
