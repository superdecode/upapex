# 🔧 Modo Debug - Desarrollo sin Autenticación

## 📋 Descripción

El **Modo Debug** permite desarrollar y depurar las aplicaciones del WMS sin necesidad de autenticarse con Google. Ideal para trabajar en el IDE sin interrupciones.

---

## 🚀 Inicio Rápido

### 1. Activar Modo Debug

Abre la **consola del navegador** (F12) y ejecuta:

```javascript
DebugMode.enable()
```

### 2. Recargar la Página

Presiona **F5** o recarga la página.

### 3. ¡Listo!

La aplicación iniciará automáticamente sin pedir login de Google.

---

## 📖 Comandos Disponibles

### Activación/Desactivación

```javascript
// Activar modo debug
DebugMode.enable()

// Desactivar modo debug
DebugMode.disable()

// Verificar si está activo
DebugMode.isEnabled()
// Retorna: true o false
```

### Información y Ayuda

```javascript
// Mostrar ayuda completa
DebugMode.help()
```

### Funciones Avanzadas

```javascript
// Simular autenticación manualmente
DebugMode.mockAuth('NombreApp')

// Mostrar app principal sin login
DebugMode.showMainApp()

// Obtener datos mock para pruebas
DebugMode.getMockData('inventory')  // Inventario
DebugMode.getMockData('orders')     // Órdenes
DebugMode.getMockData('validations') // Validaciones
```

---

## 🎯 Aplicaciones Compatibles

El modo debug está integrado en:

- ✅ **Dispatch** (`/apps/dispatch/`)
- ✅ **Validador** (`/apps/validador/`)
- ✅ **Inventario** (próximamente)
- ✅ **Track** (próximamente)

---

## 💡 Casos de Uso

### Desarrollo en IDE

```javascript
// 1. Activar una sola vez
DebugMode.enable()

// 2. Recargar página
// La app inicia automáticamente

// 3. Desarrollar normalmente
// Todos los cambios se reflejan sin login
```

### Testing de Funcionalidades

```javascript
// Activar debug
DebugMode.enable()

// Recargar y probar funciones
// Ejemplo: probar búsqueda de órdenes
executeSearch()

// Probar validaciones
validateCode('TEST001')
```

### Datos Mock para Pruebas

```javascript
// Obtener datos de prueba
const mockInventory = DebugMode.getMockData('inventory')
console.log(mockInventory)
// [
//   { code: 'TEST001', sku: 'SKU001', ... },
//   { code: 'TEST002', sku: 'SKU002', ... }
// ]
```

---

## 🔐 Datos Simulados

Cuando el modo debug está activo, se simulan estos datos:

```javascript
Usuario: "Debug User"
Email: "debug@wms.local"
Nombre: "Debug User"
```

Estos datos se guardan en `localStorage` igual que una sesión real.

---

## ⚙️ Funcionamiento Interno

### Flujo Normal (Sin Debug)

```
Usuario → Login Google → Token → Cargar Datos → Mostrar App
```

### Flujo con Debug

```
Usuario → Debug Detectado → Simular Usuario → Mostrar App
                ↓
        (Sin llamadas a Google)
```

### Persistencia

El modo debug se guarda en `localStorage`:

```javascript
localStorage.getItem('WMS_DEBUG_MODE')
// 'true' si está activo
// null si está desactivado
```

---

## 🛠️ Integración en Nuevas Apps

Para agregar modo debug a una nueva app:

### 1. Incluir el Script

```html
<script src="../../shared/js/debug-mode.js"></script>
```

### 2. Integrar en Inicialización

```javascript
document.addEventListener('DOMContentLoaded', () => {
    // Debug mode: bypass Google auth
    if (DebugMode.autoInit('NombreApp', (userData) => {
        CURRENT_USER = userData.user;
        USER_EMAIL = userData.email;
        USER_GOOGLE_NAME = userData.name;
        showMainApp();
        updateUserFooter();
        loadDatabase();
    })) {
        return; // Si debug activo, salir
    }
    
    // Modo normal: cargar Google API
    gapi.load('client', initGAPI);
});
```

---

## 📊 Datos Mock Disponibles

### Inventario

```javascript
DebugMode.getMockData('inventory')
```

Retorna:
- 3 productos de prueba
- Códigos: TEST001, TEST002, TEST003
- Con ubicaciones y stock

### Órdenes

```javascript
DebugMode.getMockData('orders')
```

Retorna:
- 2 órdenes de prueba
- Números: 12345, 12346
- Con operador y unidad

### Validaciones

```javascript
DebugMode.getMockData('validations')
```

Retorna:
- 1 validación de prueba
- Código TEST001 validado

---

## ⚠️ Importante

### ✅ Hacer

- Usar para desarrollo local
- Desactivar antes de hacer commit
- Probar funcionalidades sin login
- Verificar lógica de negocio

### ❌ No Hacer

- **NO** usar en producción
- **NO** commitear con debug activo
- **NO** confiar en datos mock para producción
- **NO** dejar activado permanentemente

---

## 🐛 Troubleshooting

### El modo debug no funciona

**Problema**: La app sigue pidiendo login

**Solución**:
```javascript
// Verificar si está activo
DebugMode.isEnabled()

// Si retorna false, activar
DebugMode.enable()

// Recargar página
location.reload()
```

### Datos no se cargan

**Problema**: La app inicia pero no hay datos

**Solución**:
```javascript
// Cargar datos manualmente
loadDatabase()  // o loadAllData() según la app
```

### Quiero desactivar el debug

**Solución**:
```javascript
DebugMode.disable()
// Recargar página
```

---

## 🔍 Verificación

Para verificar que el modo debug está funcionando:

1. Abre la consola (F12)
2. Busca el mensaje: `🔧 DEBUG MODE ACTIVO`
3. Verifica que la app inició sin login
4. Revisa que aparece: `🔧 DEBUG MODE: Sesión simulada`

---

## 📝 Ejemplo Completo

```javascript
// === SESIÓN DE DESARROLLO ===

// 1. Abrir consola del navegador
console.log('Iniciando desarrollo...')

// 2. Activar debug
DebugMode.enable()
// Output: 🔧 DEBUG MODE ENABLED
//         Recarga la página para aplicar cambios

// 3. Recargar página (F5)
// La app inicia automáticamente

// 4. Verificar estado
DebugMode.isEnabled()
// Output: true

// 5. Ver datos mock disponibles
DebugMode.getMockData('inventory')
// Output: [{ code: 'TEST001', ... }, ...]

// 6. Desarrollar normalmente...
// ... tu código aquí ...

// 7. Al terminar, desactivar
DebugMode.disable()
// Output: ✅ DEBUG MODE DISABLED
//         Recarga la página para aplicar cambios
```

---

## 🎓 Tips de Desarrollo

### Workflow Recomendado

1. **Activar debug al inicio del día**
   ```javascript
   DebugMode.enable()
   ```

2. **Desarrollar sin interrupciones**
   - No más logins repetidos
   - Recarga rápida con F5
   - Testing inmediato

3. **Desactivar antes de commit**
   ```javascript
   DebugMode.disable()
   ```

### Atajos Útiles

```javascript
// Alias rápido (opcional)
const D = DebugMode

// Uso
D.enable()
D.isEnabled()
D.help()
```

### Debugging Avanzado

```javascript
// Ver todo el estado actual
console.log({
    debugMode: DebugMode.isEnabled(),
    user: CURRENT_USER,
    email: USER_EMAIL,
    online: IS_ONLINE
})
```

---

## 📚 Referencias

- **Archivo**: `/shared/js/debug-mode.js`
- **Apps integradas**: dispatch, validador
- **Documentación**: Este archivo

---

## 🔄 Changelog

### v1.0.0 (2024-12-30)
- ✅ Creación del módulo debug-mode.js
- ✅ Integración en Dispatch
- ✅ Integración en Validador
- ✅ Datos mock básicos
- ✅ Documentación completa

---

**Desarrollado para facilitar el desarrollo del WMS System**  
**Uso exclusivo para desarrollo local** 🔧
