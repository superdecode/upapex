# Guía de Sincronización Avanzada

## Descripción General

Sistema de sincronización compartido que integra las mejores funcionalidades de `scan.html` para uso en todas las apps del WMS.

## Módulos Incluidos

### 1. **AdvancedSyncManager** (`advanced-sync-manager.js`)
Gestor principal de sincronización con:
- ✅ Control de concurrencia (Read-Verify-Write)
- ✅ Persistencia offline-first (IndexedDB)
- ✅ Deduplicación inteligente
- ✅ Heartbeat y auto-sync
- ✅ Manejo robusto de errores
- ✅ Reintentos con backoff exponencial

### 2. **ProcessedCacheManager** (`processed-cache-manager.js`)
Cache de datos procesados con:
- ✅ Lazy loading desde servidor
- ✅ Normalización de códigos
- ✅ Validación dual (local + servidor)
- ✅ Auto-sync periódico
- ✅ Persistencia en IndexedDB

### 3. **SyncUtils** (`sync-utils.js`)
Utilidades compartidas:
- ✅ Generación de UUIDs y timestamps
- ✅ Formateo de fechas y horas
- ✅ Validación de códigos de barras
- ✅ Funciones de retry y backoff
- ✅ Exportación a CSV
- ✅ Verificación de capacidades del navegador

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                  AdvancedSyncManager                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Concurrency  │  │ Persistence  │  │ Deduplication│      │
│  │   Control    │  │   Manager    │  │   Manager    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              ProcessedCacheManager                          │
│  ┌──────────────────────────────────────────────┐          │
│  │  IndexedDB Cache + Auto-sync desde servidor  │          │
│  └──────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     SyncUtils                               │
│  Utilidades compartidas para todas las apps                │
└─────────────────────────────────────────────────────────────┘
```

## Instalación

### 1. Incluir scripts en tu HTML

```html
<!-- Orden de carga importante -->
<script src="/shared/js/sync-utils.js"></script>
<script src="/shared/js/processed-cache-manager.js"></script>
<script src="/shared/js/advanced-sync-manager.js"></script>
```

### 2. Inicializar en tu app

```javascript
// Configuración
const syncConfig = {
    spreadsheetId: 'TU_SPREADSHEET_ID',
    sheetName: 'BD',
    appName: 'Mi App',
    appIcon: '📦',
    autoSyncInterval: 45000,      // 45 segundos
    heartbeatInterval: 10000,     // 10 segundos
    maxRetries: 3,
    retryDelay: 1000,
    formatRecord: (record) => {
        // Personaliza el formato de tus registros
        return [
            record.date,
            record.time,
            record.user,
            record.scan1,
            record.scan2,
            record.location,
            record.status,
            record.note,
            record.pallet,
            record.originLocation || ''
        ];
    }
};

// Inicializar gestor de sincronización
const syncManager = new AdvancedSyncManager(syncConfig);
await syncManager.init();

// Inicializar cache de datos procesados
const cacheManager = new ProcessedCacheManager({
    spreadsheetId: 'TU_SPREADSHEET_ID',
    sheetName: 'BD',
    syncInterval: 60 * 60 * 1000 // 1 hora
});
await cacheManager.init();

// Hacer disponible globalmente
window.advancedSyncManager = syncManager;
window.processedCacheManager = cacheManager;
```

## Uso Básico

### Agregar registros a la cola

```javascript
// Agregar un solo registro
await syncManager.addToQueue({
    date: SyncUtils.formatDate(),
    time: SyncUtils.formatTime(),
    user: 'usuario@example.com',
    scan1: 'CODE123',
    scan2: 'CODE456',
    location: 'A-01',
    status: 'OK',
    note: '',
    pallet: 'PLT-123',
    originLocation: 'B-02'
});

// Agregar múltiples registros
await syncManager.addToQueue([
    { /* registro 1 */ },
    { /* registro 2 */ },
    { /* registro 3 */ }
]);
```

### Sincronizar manualmente

```javascript
// Sincronización con notificaciones
const result = await syncManager.sync(true);

if (result.success) {
    console.log(`✅ ${result.synced} registros sincronizados`);
} else {
    console.log('❌ Error en sincronización');
}
```

### Verificar duplicados

```javascript
// Verificar si un código ya fue procesado
const processed = cacheManager.findProcessedBox('CODE123', syncManager.pendingSync);

if (processed) {
    console.log('⚠️ Código ya procesado:', processed);
    console.log('Fuente:', processed.source); // 'server' o 'local_pending'
} else {
    console.log('✅ Código nuevo, puede procesarse');
}
```

### Obtener estadísticas

```javascript
const stats = syncManager.getStats();
console.log('Pendientes:', stats.pendingSync);
console.log('Online:', stats.isOnline);
console.log('Token Google:', stats.hasToken);
console.log('Última sync:', stats.lastSyncTime);
console.log('Pallets en cache:', stats.syncedPalletsCount);
```

### Mostrar panel de estado

```javascript
// Mostrar panel interactivo
syncManager.showPanel();
```

### Exportar datos pendientes

```javascript
// Exportar a CSV
syncManager.exportPending();
```

## Características Avanzadas

### Control de Concurrencia

El módulo implementa el patrón **Read-Verify-Write** para evitar conflictos:

1. **Lee** la última fila antes de escribir
2. **Escribe** en un rango específico (no usa append)
3. **Verifica** la integridad de los datos escritos
4. **Reintenta** automáticamente en caso de conflicto

```javascript
// Esto se maneja automáticamente
// No necesitas hacer nada especial
await syncManager.sync();
```

### Deduplicación

Previene duplicados en múltiples niveles:

```javascript
// Verificar si un pallet ya fue sincronizado
const isDuplicate = syncManager.deduplicationManager.isPalletSynced(
    'PLT-123',
    'A-01'
);

// Verificar en la base de datos remota
const existsInDB = await syncManager.deduplicationManager.checkPalletExistsInDatabase(
    'PLT-123',
    'TU_SPREADSHEET_ID',
    'BD'
);
```

### Persistencia Offline-First

Los datos se guardan automáticamente en IndexedDB:

```javascript
// Obtener registros pendientes desde IndexedDB
const pending = await syncManager.persistenceManager.getPendingSync();

// Obtener cantidad de pendientes
const count = await syncManager.persistenceManager.getPendingCount();

// Mover registros de draft a pending
await syncManager.persistenceManager.moveToPending(records);
```

### Heartbeat Automático

El heartbeat sincroniza automáticamente cada 10 segundos:

```javascript
// Ya está activo después de init()
// Para detenerlo:
syncManager.stopAutoSync();

// Para reiniciarlo:
syncManager.startAutoSync();
syncManager.startHeartbeat();
```

## Manejo de Errores

### Errores de Concurrencia

```javascript
const result = await syncManager.sync();

if (!result.success && result.reason === 'concurrency_conflict') {
    console.log('⚠️ Conflicto de concurrencia detectado');
    console.log(`${result.pendingCount} registros en cola para reintento`);
    // Los datos permanecen seguros en la cola
    // Se reintentarán automáticamente
}
```

### Errores de Red

```javascript
if (!result.success) {
    // Verificar conectividad
    const stats = syncManager.getStats();
    
    if (!stats.isOnline) {
        console.log('⚠️ Sin conexión a internet');
    }
    
    if (!stats.hasToken) {
        console.log('⚠️ Token de Google expirado');
    }
}
```

### Reintentos Automáticos

```javascript
// Usar utilidad de retry con backoff
const result = await SyncUtils.retryWithBackoff(
    async () => {
        return await syncManager.sync(false);
    },
    3,      // 3 reintentos
    1000    // delay inicial de 1 segundo
);
```

## Optimización de Rendimiento

### Reducir Latencia

```javascript
// Configurar intervalos más cortos
const syncManager = new AdvancedSyncManager({
    autoSyncInterval: 30000,    // 30 segundos (más agresivo)
    heartbeatInterval: 5000,    // 5 segundos
    maxRetries: 2,              // Menos reintentos
    retryDelay: 500             // Delay más corto
});
```

### Batch Processing

```javascript
// Acumular registros y sincronizar en lote
const records = [];

// Agregar registros
records.push(record1);
records.push(record2);
records.push(record3);

// Sincronizar todos de una vez
await syncManager.addToQueue(records);
await syncManager.sync();
```

### Cache Warming

```javascript
// Pre-cargar cache al inicio
await cacheManager.syncFromServer(false);

// Verificar estado del cache
const cacheStats = cacheManager.getStats();
console.log('Cache size:', cacheStats.cacheSize);
console.log('Last update:', cacheStats.lastUpdate);
```

## Migración desde sync-manager.js

### Cambios Principales

```javascript
// ANTES (sync-manager.js)
const syncManager = new SyncManager({
    spreadsheetId: 'ID',
    sheetName: 'BD'
});
syncManager.init();

// AHORA (advanced-sync-manager.js)
const syncManager = new AdvancedSyncManager({
    spreadsheetId: 'ID',
    sheetName: 'BD'
});
await syncManager.init(); // Ahora es async
```

### Nuevas Funcionalidades

```javascript
// Control de concurrencia (NUEVO)
// Se maneja automáticamente, no requiere cambios

// Deduplicación (NUEVO)
const isDuplicate = syncManager.deduplicationManager.isPalletSynced(
    palletId,
    location
);

// Persistencia mejorada (NUEVO)
const pending = await syncManager.persistenceManager.getPendingSync();

// Cache de procesados (NUEVO)
const processed = processedCacheManager.findProcessedBox(code);
```

## Debugging

### Habilitar logs detallados

```javascript
// Los logs están habilitados por defecto
// Busca en consola:
// [CONCURRENCY] - Control de concurrencia
// [PERSISTENCE] - Operaciones de IndexedDB
// [DEDUP] - Deduplicación
// [PROCESSED-CACHE] - Cache de procesados
// [HEARTBEAT] - Heartbeat automático
```

### Verificar estado del sistema

```javascript
// Verificar IndexedDB
const idbSupport = await SyncUtils.checkIndexedDBSupport();
console.log('IndexedDB soportado:', idbSupport.supported);

// Verificar espacio disponible
const quota = await SyncUtils.estimateStorageQuota();
console.log('Espacio usado:', quota.percentUsed + '%');
console.log('Espacio disponible:', SyncUtils.formatBytes(quota.available));

// Verificar navegador
const browser = SyncUtils.getBrowserInfo();
console.log('Navegador:', browser.browserName, browser.browserVersion);
```

### Limpiar datos

```javascript
// Limpiar cola de sincronización
syncManager.clear();

// Limpiar cache de pallets sincronizados
syncManager.deduplicationManager.clearSyncedPallets();

// Limpiar cache de procesados
await cacheManager.clearCache();
```

## Eventos y Callbacks

```javascript
const syncManager = new AdvancedSyncManager({
    spreadsheetId: 'ID',
    sheetName: 'BD',
    
    // Callback al iniciar sincronización
    onSyncStart: () => {
        console.log('🔄 Sincronización iniciada');
        // Mostrar spinner, deshabilitar botones, etc.
    },
    
    // Callback al terminar sincronización
    onSyncEnd: () => {
        console.log('✅ Sincronización terminada');
        // Ocultar spinner, habilitar botones, etc.
    },
    
    // Callback al cambiar estado
    onStatusChange: (stats) => {
        console.log('Estado actualizado:', stats);
        // Actualizar UI personalizada
    }
});
```

## Mejores Prácticas

### 1. Siempre usar async/await

```javascript
// ✅ CORRECTO
await syncManager.init();
await syncManager.addToQueue(records);
const result = await syncManager.sync();

// ❌ INCORRECTO
syncManager.init(); // No espera la inicialización
syncManager.addToQueue(records); // No espera
```

### 2. Verificar conectividad antes de operaciones críticas

```javascript
if (SyncUtils.checkOnlineStatus() && SyncUtils.hasGoogleToken()) {
    await syncManager.sync();
} else {
    console.log('⚠️ Sin conexión, datos en cola');
}
```

### 3. Manejar errores apropiadamente

```javascript
try {
    const result = await syncManager.sync();
    if (!result.success) {
        // Manejar error de sincronización
        console.error('Error sync:', result);
    }
} catch (error) {
    // Manejar error crítico
    console.error('Error crítico:', error);
}
```

### 4. Usar deduplicación antes de agregar

```javascript
// Verificar duplicados antes de agregar
const isDuplicate = cacheManager.findProcessedBox(
    code,
    syncManager.pendingSync
);

if (!isDuplicate) {
    await syncManager.addToQueue(record);
} else {
    console.log('⚠️ Registro duplicado, omitido');
}
```

### 5. Limpiar recursos al salir

```javascript
window.addEventListener('beforeunload', async (e) => {
    if (syncManager.getPendingCount() > 0) {
        // Intentar sincronizar antes de salir
        await syncManager.sync(false);
    }
});
```

## Soporte y Troubleshooting

### Problema: Datos no se sincronizan

**Solución:**
```javascript
// 1. Verificar conectividad
const stats = syncManager.getStats();
console.log('Online:', stats.isOnline);
console.log('Token:', stats.hasToken);

// 2. Verificar pendientes
console.log('Pendientes:', stats.pendingSync);

// 3. Intentar sincronización manual
await syncManager.sync(true);
```

### Problema: Duplicados en la base de datos

**Solución:**
```javascript
// 1. Limpiar cache de pallets
syncManager.deduplicationManager.clearSyncedPallets();

// 2. Verificar antes de agregar
const exists = await syncManager.deduplicationManager.checkPalletExistsInDatabase(
    palletId,
    spreadsheetId,
    sheetName
);

if (!exists) {
    await syncManager.addToQueue(records);
}
```

### Problema: Error de concurrencia persistente

**Solución:**
```javascript
// Los errores de concurrencia se manejan automáticamente
// Si persisten, verificar:

// 1. Que no haya múltiples instancias sincronizando
console.log('En progreso:', syncManager.inProgress);

// 2. Esperar y reintentar
await SyncUtils.sleep(5000);
await syncManager.sync();
```

## Changelog

### v3.0.0 (Actual)
- ✅ Integración completa de funcionalidades de scan.html
- ✅ Control de concurrencia con Read-Verify-Write
- ✅ Persistencia offline-first con IndexedDB
- ✅ Deduplicación inteligente multi-nivel
- ✅ Cache de datos procesados con lazy loading
- ✅ Heartbeat automático
- ✅ Utilidades compartidas

### v2.0.0 (Anterior)
- Auto-sync básico
- Panel de estado
- Exportación CSV
- Protección de salida

### v1.0.0 (Original)
- Sincronización básica con Google Sheets
- Cola de pendientes
- localStorage
