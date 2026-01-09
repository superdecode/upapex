# 🔄 Instrucciones de Recarga - Validador

## ✅ Cambios Aplicados

He agregado parámetros de versión (`?v=3.0.1`) a todos los scripts para forzar que el navegador descargue las nuevas versiones.

**Scripts actualizados:**
- `auth-manager.js?v=3.0.1`
- `sync-utils.js?v=3.0.1`
- `processed-cache-manager.js?v=3.0.1`
- `advanced-sync-manager.js?v=3.0.1`
- `sync-config.js?v=3.0.1`
- `app.js?v=3.0.1`

## 🔄 Pasos para Recargar

### 1. Cerrar COMPLETAMENTE el navegador
```
- Cierra todas las pestañas de validador
- Cierra todas las ventanas del navegador
- Espera 3 segundos
```

### 2. Abrir de nuevo
```
- Abre el navegador
- Ve a: http://localhost:5500/apps/validador/index.html
```

### 3. Verificar en Consola

Abre DevTools (F12) y ejecuta:

```javascript
// Debe mostrar "function"
console.log(typeof initAdvancedSync);

// Debe mostrar "object"
console.log(typeof AdvancedSyncManager);

// Debe mostrar el ID del spreadsheet
console.log(SPREADSHEET_WRITE);
```

## 🎯 Si AÚN Hay Error

Si después de cerrar y abrir el navegador SIGUE el error, ejecuta esto en la consola:

```javascript
// Limpiar todo el localStorage
localStorage.clear();

// Limpiar IndexedDB
indexedDB.databases().then(dbs => {
    dbs.forEach(db => indexedDB.deleteDatabase(db.name));
});

// Recargar
location.reload(true);
```

## 📊 Verificación Final

Después de recargar, NO debe aparecer:
- ❌ `Can't find variable: SyncManager`
- ❌ `tokenClient not initialized`

Debe aparecer:
- ✅ `🚀 [VALIDADOR] Inicializando Advanced Sync Manager...`
- ✅ `✅ AuthManager: Google Identity Services initialized`

## 🆘 Si Nada Funciona

Si después de TODO esto sigue el error, el problema puede ser:

1. **Live Server está cacheando**
   - Detén Live Server (botón "Go Live" en VS Code)
   - Espera 5 segundos
   - Inicia Live Server de nuevo

2. **Proxy/CDN intermedio**
   - Verifica que no haya proxy
   - Desactiva extensiones del navegador

3. **Permisos de archivos**
   - Verifica que los archivos se guardaron correctamente
   - Revisa la fecha de modificación de sync-config.js

---

**Fecha de actualización:** 8 de Enero, 2026 - 21:28  
**Versión:** 3.0.1
