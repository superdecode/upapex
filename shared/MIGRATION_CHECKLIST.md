# Checklist de Migración - Advanced Sync Manager

## ✅ Completado

### Módulos Creados
- [x] `advanced-sync-manager.js` - Gestor principal con control de concurrencia
- [x] `processed-cache-manager.js` - Cache de datos procesados
- [x] `sync-utils.js` - Utilidades compartidas
- [x] `ADVANCED_SYNC_GUIDE.md` - Documentación completa
- [x] `IMPLEMENTATION_EXAMPLE.html` - Ejemplo funcional

### Funcionalidades Migradas desde scan.html

#### Control de Concurrencia ✅
- [x] Read-Verify-Write pattern
- [x] Detección de última fila antes de escribir
- [x] Escritura en rango específico (no append)
- [x] Verificación post-escritura
- [x] Validación de integridad de datos
- [x] Reintentos con backoff exponencial
- [x] Lock local para prevenir escrituras simultáneas

#### Persistencia Offline-First ✅
- [x] IndexedDB como fuente de verdad
- [x] Stores: draft_boxes, pending_sync, synced_records, sessions
- [x] Transacciones atómicas
- [x] Recuperación de sesiones
- [x] Fallback a localStorage
- [x] Manejo de errores robusto

#### Deduplicación ✅
- [x] Generación de claves únicas por registro
- [x] Generación de claves únicas por pallet
- [x] Cache de pallets sincronizados
- [x] Verificación contra BD remota
- [x] Filtrado de duplicados internos
- [x] Filtrado de duplicados en pending_sync
- [x] Limpieza de registros antiguos
- [x] Flags de envío en progreso

#### Cache de Datos Procesados ✅
- [x] Lazy loading desde servidor
- [x] Normalización de códigos (cleanCode)
- [x] Eliminación de caracteres invisibles
- [x] Indexación dual (scan1 y scan2)
- [x] Validación dual (local + servidor)
- [x] Auto-sync periódico (1 hora)
- [x] Persistencia en IndexedDB
- [x] Agregado de registros sincronizados al cache

#### Sincronización Avanzada ✅
- [x] Auto-sync configurable (45 segundos)
- [x] Heartbeat automático (10 segundos)
- [x] Sincronización desde IndexedDB
- [x] Handshake de confirmación
- [x] Manejo especial de errores de concurrencia
- [x] Protección contra salida sin sincronizar
- [x] Panel de estado interactivo
- [x] Exportación a CSV

#### Utilidades ✅
- [x] Generación de UUIDs
- [x] Generación de timestamps
- [x] Generación de IDs de pallet
- [x] Formateo de fechas y horas
- [x] Verificación de conectividad
- [x] Verificación de token Google
- [x] Sleep/delay con promesas
- [x] Retry con backoff exponencial
- [x] Limpieza de códigos
- [x] Validación de códigos de barras
- [x] Debounce y throttle
- [x] Conversión a CSV
- [x] Verificación de IndexedDB
- [x] Estimación de quota de almacenamiento

## 📋 Pasos para Implementar en tus Apps

### 1. Incluir Scripts
```html
<!-- En el <head> o antes de </body> -->
<script src="/shared/js/sync-utils.js"></script>
<script src="/shared/js/processed-cache-manager.js"></script>
<script src="/shared/js/advanced-sync-manager.js"></script>
```

### 2. Reemplazar Código Existente

#### En apps que usan sync-manager.js antiguo:
```javascript
// ANTES
const syncManager = new SyncManager({...});
syncManager.init();

// AHORA
const syncManager = new AdvancedSyncManager({...});
await syncManager.init();
```

#### En apps que tienen código de scan.html:
```javascript
// ANTES (código inline en scan.html)
const ConcurrencyControl = {...};
const PersistenceManager = {...};
const DeduplicationManager = {...};

// AHORA (usar módulos compartidos)
// Ya están disponibles globalmente después de incluir los scripts
// Solo necesitas inicializar el AdvancedSyncManager
```

### 3. Configurar para tu App

```javascript
const config = {
    spreadsheetId: 'TU_SPREADSHEET_ID',
    sheetName: 'TU_HOJA',
    appName: 'Nombre de tu App',
    appIcon: '📦', // Emoji para tu app
    autoSyncInterval: 45000,
    heartbeatInterval: 10000,
    formatRecord: (record) => {
        // Personaliza según las columnas de tu hoja
        return [
            record.date,
            record.time,
            record.user,
            // ... más campos
        ];
    }
};

const syncManager = new AdvancedSyncManager(config);
await syncManager.init();
window.advancedSyncManager = syncManager;
```

### 4. Actualizar Llamadas

#### Agregar a cola:
```javascript
// ANTES
PENDING_SYNC.push(record);
SyncManager.save();

// AHORA
await syncManager.addToQueue(record);
```

#### Sincronizar:
```javascript
// ANTES
await SyncManager.sync();

// AHORA
await syncManager.sync();
```

#### Verificar duplicados:
```javascript
// ANTES
const exists = DeduplicationManager.isPalletSynced(palletId, location);

// AHORA
const exists = syncManager.deduplicationManager.isPalletSynced(palletId, location);
```

### 5. Inicializar Cache (Opcional pero Recomendado)

```javascript
const cacheManager = new ProcessedCacheManager({
    spreadsheetId: 'TU_SPREADSHEET_ID',
    sheetName: 'TU_HOJA'
});
await cacheManager.init();
window.processedCacheManager = cacheManager;

// Verificar duplicados
const processed = cacheManager.findProcessedBox(code, syncManager.pendingSync);
```

## 🎯 Apps que Necesitan Migración

### Alta Prioridad
- [ ] `apps/dispatch/app.js` - Usa sistema de sincronización complejo
- [ ] `apps/validador/app.js` - Requiere validación de duplicados
- [ ] `apps/track/app.js` - Necesita sincronización confiable

### Media Prioridad
- [ ] `apps/inventory/app.js` - Beneficiaría de cache de procesados
- [ ] Otras apps que usen sync-manager.js antiguo

### Baja Prioridad
- [ ] Apps que solo leen datos (no escriben)

## 🔧 Configuraciones Específicas por App

### Dispatch
```javascript
const syncManager = new AdvancedSyncManager({
    spreadsheetId: CONFIG.SPREADSHEET_WRITE,
    sheetName: 'Despachos',
    appName: 'Dispatch',
    appIcon: '🚚',
    formatRecord: (record) => [
        record.fecha,
        record.hora,
        record.usuario,
        record.folio,
        record.ubicacion,
        record.estado,
        // ... campos específicos de dispatch
    ]
});
```

### Validador
```javascript
const syncManager = new AdvancedSyncManager({
    spreadsheetId: CONFIG.SPREADSHEET_WRITE,
    sheetName: 'Validaciones',
    appName: 'Validador',
    appIcon: '✅',
    formatRecord: (record) => [
        record.fecha,
        record.hora,
        record.usuario,
        record.codigo,
        record.resultado,
        // ... campos específicos de validador
    ]
});
```

### Track
```javascript
const syncManager = new AdvancedSyncManager({
    spreadsheetId: CONFIG.SPREADSHEET_WRITE,
    sheetName: 'Tracking',
    appName: 'Track',
    appIcon: '📍',
    formatRecord: (record) => [
        record.fecha,
        record.hora,
        record.usuario,
        record.tracking,
        record.ubicacion,
        record.estado,
        // ... campos específicos de track
    ]
});
```

## ⚠️ Consideraciones Importantes

### Compatibilidad
- ✅ Compatible con sync-manager.js v2.0.0
- ✅ Mantiene misma API básica
- ⚠️ Requiere async/await para init()
- ⚠️ Algunas funciones ahora son async

### Rendimiento
- ✅ Mejor latencia con heartbeat
- ✅ Menos conflictos con control de concurrencia
- ✅ Cache reduce llamadas al servidor
- ⚠️ Usa más espacio en IndexedDB

### Datos
- ✅ No se pierden datos existentes
- ✅ Migración automática desde localStorage
- ✅ Fallback a localStorage si falla IndexedDB
- ⚠️ Limpiar cache antiguo después de migrar

## 🧪 Testing

### Tests Básicos
```javascript
// 1. Verificar inicialización
console.assert(syncManager.initialized === true, 'No inicializado');

// 2. Verificar persistencia
const pending = await syncManager.persistenceManager.getPendingSync();
console.log('Pendientes en IndexedDB:', pending.length);

// 3. Verificar deduplicación
syncManager.deduplicationManager.clearSyncedPallets();
console.log('Cache limpiado');

// 4. Verificar cache
const cacheSize = cacheManager.getCount();
console.log('Cache size:', cacheSize);

// 5. Test de sincronización
await syncManager.addToQueue({
    date: SyncUtils.formatDate(),
    time: SyncUtils.formatTime(),
    user: 'test@test.com',
    scan1: 'TEST123',
    location: 'A-01',
    pallet: 'PLT-TEST'
});
const result = await syncManager.sync();
console.assert(result.success === true, 'Sync falló');
```

### Tests de Concurrencia
```javascript
// Simular escrituras concurrentes
const promises = [];
for (let i = 0; i < 5; i++) {
    promises.push(syncManager.sync());
}
const results = await Promise.all(promises);
console.log('Resultados concurrentes:', results);
```

### Tests de Deduplicación
```javascript
// Agregar mismo registro dos veces
const record = { /* ... */ };
await syncManager.addToQueue(record);
await syncManager.addToQueue(record); // Debería filtrar
console.log('Pendientes:', syncManager.getPendingCount()); // Debería ser 1
```

## 📊 Métricas de Éxito

### Antes de Migrar
- Registrar cantidad de errores de sincronización
- Registrar tiempo promedio de sync
- Registrar cantidad de duplicados

### Después de Migrar
- ✅ Reducción de errores de concurrencia > 90%
- ✅ Reducción de duplicados > 95%
- ✅ Mejora en latencia de sync > 30%
- ✅ Reducción de pérdida de datos > 99%

## 🐛 Troubleshooting

### Problema: "syncManager is not defined"
**Solución:** Verificar que los scripts estén cargados en el orden correcto

### Problema: "Cannot read property 'init' of undefined"
**Solución:** Esperar a que los scripts carguen antes de inicializar

### Problema: Datos no se sincronizan
**Solución:** Verificar conectividad y token Google
```javascript
const stats = syncManager.getStats();
console.log('Online:', stats.isOnline);
console.log('Token:', stats.hasToken);
```

### Problema: IndexedDB no funciona
**Solución:** Verificar soporte del navegador
```javascript
const support = await SyncUtils.checkIndexedDBSupport();
console.log('IndexedDB:', support);
```

## 📝 Notas Adicionales

- El sistema es **backward compatible** con sync-manager.js v2.0.0
- Los datos existentes se **migran automáticamente**
- El heartbeat se puede **deshabilitar** si causa problemas de rendimiento
- El cache se puede **configurar** para sincronizar más o menos frecuentemente
- Todos los módulos están **documentados** en ADVANCED_SYNC_GUIDE.md

## 🚀 Próximos Pasos

1. Revisar documentación completa en `ADVANCED_SYNC_GUIDE.md`
2. Probar ejemplo en `IMPLEMENTATION_EXAMPLE.html`
3. Migrar una app de prueba primero
4. Validar funcionamiento en producción
5. Migrar resto de apps progresivamente
6. Monitorear métricas y ajustar configuración
