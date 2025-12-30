# 🔧 Instrucciones para Activar Debug Mode

## Pasos para usar el servidor de desarrollo

### 1. El servidor ya está corriendo en:
- **URL**: http://localhost:3000
- **Dispatch**: http://localhost:3000/apps/dispatch/

### 2. Activar Debug Mode (IMPORTANTE)

Abre la aplicación en tu navegador y sigue estos pasos:

1. **Abre la consola del navegador**:
   - Presiona `F12` o `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows)
   - Ve a la pestaña "Console"

2. **Ejecuta este comando**:
   ```javascript
   DebugMode.enable()
   ```

3. **Recarga la página**:
   - Presiona `F5` o `Cmd+R`

4. **¡Listo!** La aplicación iniciará sin pedir login de Google

### 3. Verificar que funciona

En la consola deberías ver:
```
🔧 DEBUG MODE ACTIVO
🔧 DEBUG MODE: Sesión simulada
```

## Comandos útiles

```javascript
// Ver si está activo
DebugMode.isEnabled()

// Desactivar (cuando termines)
DebugMode.disable()

// Ver ayuda completa
DebugMode.help()
```

## URLs disponibles

- Principal: http://localhost:3000/
- Dispatch: http://localhost:3000/apps/dispatch/
- Validador: http://localhost:3000/apps/validador/
- Inventario: http://localhost:3000/apps/inventario/
- Track: http://localhost:3000/apps/track/

## Detener el servidor

Presiona `Ctrl+C` en la terminal donde está corriendo el servidor.
