# Guía de Implementación - Advanced Sync Manager en Apps

## ✅ Implementación Completada

Se ha integrado el sistema de sincronización avanzado en las siguientes apps:

### 1. **Dispatch** (`apps/dispatch/`)
- ✅ HTML actualizado con nuevos módulos
- ✅ Archivo de configuración `sync-config.js` creado
- ✅ Funciones auxiliares implementadas

### 2. **Inventory** (`apps/inventory/`)
- ✅ HTML actualizado con nuevos módulos
- ✅ Archivo de configuración `sync-config.js` creado
- ✅ Funciones auxiliares implementadas

### 3. **Validador** (`apps/validador/`)
- ✅ HTML actualizado con nuevos módulos
- ✅ Archivo de configuración `sync-config.js` creado
- ✅ Funciones auxiliares implementadas

## 📋 Cambios Realizados

### Archivos HTML Actualizados

Cada app ahora incluye los siguientes scripts en orden:

```html
<!-- Advanced Sync System -->
<script src="../../shared/js/sync-utils.js"></script>
<script src="../../shared/js/processed-cache-manager.js"></script>
<script src="../../shared/js/advanced-sync-manager.js"></script>

<!-- Sync Configuration -->
<script src="sync-config.js"></script>
```

### Archivos de Configuración Creados

Cada app tiene su propio `sync-config.js` con:
- Configuración específica de la app
- Formato de registros personalizado
- Funciones auxiliares para facilitar el uso
- Callbacks personalizados para UI

## 🔧 Integración en el Código Existente

### Paso 1: Inicializar en el Arranque de la App

En el código de inicialización de cada app (generalmente después de login exitoso):

```javascript
// Ejemplo para cualquier app
async function initializeApp() {
    try {
        // ... código existente de inicialización ...
        
        // Inicializar Advanced Sync Manager
        const syncInitialized = await initAdvancedSync();
        
        if (syncInitialized) {
            console.log('✅ Sistema de sincronización avanzado listo');
        } else {
            console.warn('⚠️ Sistema de sincronización en modo degradado');
        }
        
        // ... continuar con inicialización ...
    } catch (error) {
        console.error('Error en inicialización:', error);
    }
}
```

### Paso 2: Reemplazar Llamadas al Sistema Antiguo

#### Para Dispatch:

```javascript
// ANTES
STATE.pendingSync.push(validationData);
localStorage.setItem('dispatch_pending', JSON.stringify(STATE.pendingSync));

// AHORA
await addValidationToQueue(validationData);
```

#### Para Inventory:

```javascript
// ANTES
PENDING_SYNC.push(record);
SyncManager.save();

// AHORA
await addRecordToQueue(record);

// Para pallets completos
await addPalletToQueue(boxes, palletId, location);
```

#### Para Validador:

```javascript
// ANTES
PENDING_SYNC.push(validation);
SyncManager.save();

// AHORA
const result = await addValidationToQueue(validation);

if (result.duplicate) {
    // Manejar duplicado
    console.warn('Código duplicado:', result.info);
}
```

### Paso 3: Sincronización Manual

```javascript
// En cualquier app
async function handleManualSync() {
    const result = await syncInventoryData(true); // o syncDispatchData, syncValidadorData
    
    if (result.success) {
        console.log(`✅ ${result.synced} registros sincronizados`);
    } else {
        console.log('❌ Error en sincronización');
    }
}
```

### Paso 4: Verificación de Duplicados

```javascript
// En Inventory o Validador
function handleScan(code) {
    // Verificar si ya fue procesado
    const duplicate = checkDuplicate(code); // o checkCodeValidated(code)
    
    if (duplicate) {
        showNotification(`⚠️ Código ya procesado en ${duplicate.source}`, 'warning');
        return;
    }
    
    // Continuar con el procesamiento normal
    processCode(code);
}
```

### Paso 5: Mostrar Panel de Estado

```javascript
// Agregar botón o evento para mostrar panel
function showSyncStatus() {
    showInventorySyncPanel(); // o showDispatchSyncPanel, showValidadorSyncPanel
}

// Ejemplo: agregar onclick al elemento sync-status
document.getElementById('sync-status')?.addEventListener('click', showSyncStatus);
```

## 🎯 Funciones Disponibles por App

### Dispatch (`apps/dispatch/sync-config.js`)

```javascript
await initAdvancedSync()              // Inicializar sistema
await addValidationToQueue(data)      // Agregar validación
await syncDispatchData(showMessages)  // Sincronizar
getDispatchSyncStats()                // Obtener estadísticas
showDispatchSyncPanel()               // Mostrar panel
exportDispatchPending()               // Exportar pendientes
```

### Inventory (`apps/inventory/sync-config.js`)

```javascript
await initAdvancedSync()                    // Inicializar sistema
await addRecordToQueue(record)              // Agregar registro
await addPalletToQueue(boxes, id, location) // Agregar pallet completo
await syncInventoryData(showMessages)       // Sincronizar
getInventorySyncStats()                     // Obtener estadísticas
showInventorySyncPanel()                    // Mostrar panel
exportInventoryPending()                    // Exportar pendientes
checkDuplicate(code)                        // Verificar duplicado
```

### Validador (`apps/validador/sync-config.js`)

```javascript
await initAdvancedSync()                  // Inicializar sistema
await addValidationToQueue(validation)    // Agregar validación
await addValidationsToQueue(validations)  // Agregar múltiples
await syncValidadorData(showMessages)     // Sincronizar
getValidadorSyncStats()                   // Obtener estadísticas
showValidadorSyncPanel()                  // Mostrar panel
exportValidadorPending()                  // Exportar pendientes
checkCodeValidated(codigo)                // Verificar si validado
await syncCacheFromServer()               // Sincronizar cache
```

## 📊 Monitoreo y Estadísticas

Obtener estadísticas en cualquier app:

```javascript
const stats = getInventorySyncStats(); // o getDispatchSyncStats, getValidadorSyncStats

console.log('Pendientes:', stats.pendingSync);
console.log('Online:', stats.isOnline);
console.log('Token Google:', stats.hasToken);
console.log('Última sync:', stats.lastSyncTime);
console.log('Pallets en cache:', stats.syncedPalletsCount);
```

## 🔄 Migración Gradual

### Opción 1: Migración Completa (Recomendado)

1. Reemplazar todas las llamadas al sistema antiguo
2. Eliminar código de sincronización legacy
3. Probar exhaustivamente

### Opción 2: Migración Gradual

1. Mantener ambos sistemas temporalmente
2. Usar Advanced Sync para nuevas funcionalidades
3. Migrar funcionalidades existentes progresivamente
4. Eliminar sistema antiguo cuando todo esté migrado

## ⚠️ Consideraciones Importantes

### Compatibilidad

El sistema es compatible con el código existente porque:
- `window.syncManager` apunta a `advancedSyncManager`
- Las funciones básicas mantienen la misma interfaz
- Los datos se migran automáticamente

### Datos Existentes

Los datos en localStorage se migran automáticamente a IndexedDB en la primera inicialización.

### Rendimiento

- El heartbeat se ejecuta cada 10 segundos
- El auto-sync se ejecuta cada 45 segundos
- El cache se sincroniza cada 1 hora

Si esto causa problemas de rendimiento, ajustar en `sync-config.js`:

```javascript
autoSyncInterval: 60000,    // 1 minuto
heartbeatInterval: 30000,   // 30 segundos
```

### Debugging

Todos los módulos generan logs detallados:
- `[DISPATCH]` - Logs de dispatch
- `[INVENTORY]` - Logs de inventory
- `[VALIDADOR]` - Logs de validador
- `[CONCURRENCY]` - Control de concurrencia
- `[PERSISTENCE]` - Operaciones IndexedDB
- `[DEDUP]` - Deduplicación
- `[PROCESSED-CACHE]` - Cache de procesados

## 🧪 Testing

### Test Básico de Inicialización

```javascript
// En consola del navegador
console.log('Sync Manager:', window.advancedSyncManager);
console.log('Cache Manager:', window.processedCacheManager);
console.log('Stats:', getInventorySyncStats()); // o la función correspondiente
```

### Test de Agregar Registro

```javascript
// Ejemplo para Inventory
await addRecordToQueue({
    scan1: 'TEST123',
    location: 'A-01',
    status: 'OK',
    pallet: 'PLT-TEST'
});

console.log('Pendientes:', getInventorySyncStats().pendingSync);
```

### Test de Sincronización

```javascript
const result = await syncInventoryData(true);
console.log('Resultado:', result);
```

### Test de Duplicados

```javascript
const duplicate = checkDuplicate('TEST123');
console.log('Duplicado:', duplicate);
```

## 📝 Próximos Pasos

1. **Probar en desarrollo**
   - Verificar inicialización correcta
   - Probar agregar registros
   - Probar sincronización
   - Verificar deduplicación

2. **Integrar en código existente**
   - Reemplazar llamadas al sistema antiguo
   - Actualizar funciones de envío de datos
   - Actualizar UI de sincronización

3. **Validar en producción**
   - Monitorear logs
   - Verificar métricas
   - Ajustar configuración según necesidad

4. **Optimizar**
   - Ajustar intervalos de sync
   - Optimizar tamaño de cache
   - Limpiar código legacy

## 🆘 Troubleshooting

### Problema: "advancedSyncManager is not defined"

**Solución:** Verificar que `sync-config.js` se carga después de los módulos compartidos.

### Problema: Datos no se sincronizan

**Solución:**
```javascript
const stats = getInventorySyncStats();
console.log('Online:', stats.isOnline);
console.log('Token:', stats.hasToken);
console.log('Pendientes:', stats.pendingSync);
```

### Problema: Duplicados no se detectan

**Solución:**
```javascript
// Sincronizar cache manualmente
await syncCacheFromServer();

// Verificar tamaño del cache
console.log('Cache size:', processedCacheManager.getCount());
```

### Problema: IndexedDB no funciona

**Solución:**
```javascript
const support = await SyncUtils.checkIndexedDBSupport();
console.log('IndexedDB:', support);
```

## 📚 Recursos Adicionales

- **Documentación completa:** `/shared/ADVANCED_SYNC_GUIDE.md`
- **Arquitectura de datos:** `/shared/DATA_ARCHITECTURE.md`
- **Checklist de migración:** `/shared/MIGRATION_CHECKLIST.md`
- **Ejemplo interactivo:** `/shared/IMPLEMENTATION_EXAMPLE.html`

## ✅ Checklist de Implementación

### Para cada app:

- [x] HTML actualizado con nuevos módulos
- [x] Archivo `sync-config.js` creado
- [ ] Función `initAdvancedSync()` llamada en inicialización
- [ ] Llamadas al sistema antiguo reemplazadas
- [ ] UI de sincronización actualizada
- [ ] Tests básicos realizados
- [ ] Validación en desarrollo
- [ ] Validación en producción

---

**Versión:** 1.0.0  
**Fecha:** Enero 2026  
**Apps:** Dispatch, Inventory, Validador
