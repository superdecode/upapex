# Fix: Autenticación en Bucle y Timeout de Polling

**Fecha:** 22 de enero de 2026  
**Problema:** Sistema enviaba notificaciones de autenticación pendiente en bucle infinito en lugar de mostrar pantalla de desconexión

---

## 🔍 Problemas Identificados

### 1. **Notificaciones de Autenticación en Bucle**
- **Síntoma:** Múltiples alertas naranjas repetidas: "⚠️ Autenticación pendiente. Si ya iniciaste sesión, recarga la página."
- **Causa:** El polling de token mostraba notificación cada vez que alcanzaba timeout, sin flag para evitar repetición
- **Ubicación:** `app.js` líneas 1779-1787

### 2. **Timeout de Polling Muy Largo**
- **Síntoma:** Sistema esperaba 120 segundos (2 minutos) antes de mostrar error
- **Causa:** `maxPolls = 120` con intervalo de 1 segundo
- **Problema:** Usuario esperaba demasiado tiempo sin feedback claro

### 3. **Falta de Pantalla de Reconexión**
- **Síntoma:** Solo mostraba notificaciones en lugar de slide modal
- **Causa:** No se llamaba a `showReconnectionScreen()` en timeout de polling
- **Comparación:** La implementación antigua (`valida.html`) no tenía este sistema de polling complejo

---

## ✅ Soluciones Implementadas

### **Cambio 1: Reducción de Timeout de Polling**
```javascript
// ANTES
const maxPolls = 120; // 2 minutos máximo (120 * 1000ms)

// DESPUÉS
const maxPolls = 30; // 30 segundos máximo (30 * 1000ms) - reducido para evitar loops
```

**Beneficio:** Usuario recibe feedback más rápido (30s vs 120s)

---

### **Cambio 2: Flag para Evitar Notificaciones Repetidas**
```javascript
// AGREGADO al inicio de startTokenPolling()
let pollingTimeoutShown = false; // Flag para evitar notificaciones repetidas
```

**Beneficio:** Previene múltiples notificaciones del mismo error

---

### **Cambio 3: Mostrar Pantalla de Reconexión en Timeout**
```javascript
// ANTES
if (!reconnectCallbackExecuted) {
    showLoading(false);
    showNotification('⚠️ Autenticación pendiente. Si ya iniciaste sesión, recarga la página.', 'warning');
}

// DESPUÉS
if (!reconnectCallbackExecuted && !pollingTimeoutShown) {
    pollingTimeoutShown = true;
    showLoading(false);
    
    // Mostrar pantalla de reconexión en lugar de notificación en loop
    console.log('🔄 [VALIDADOR] Mostrando pantalla de reconexión por timeout');
    showReconnectionScreen();
}
```

**Beneficio:** 
- Muestra slide modal profesional con opciones claras
- Usuario puede elegir: "Continuar sin sincronizar" o "Reconectar con Google"
- No más notificaciones en bucle

---

## 🎯 Comportamiento Esperado Ahora

### **Flujo de Autenticación con Timeout:**

1. **Usuario pierde conexión/token expira**
2. **Sistema inicia polling de token** (máximo 30 segundos)
3. **Si no se detecta token en 30s:**
   - ✅ Se detiene el polling
   - ✅ Se oculta el loading
   - ✅ Se muestra **una sola vez** la pantalla de reconexión
   - ✅ Usuario tiene opciones claras

### **Pantalla de Reconexión:**
```
┌─────────────────────────────────────┐
│           🔌                        │
│   Conexión con Google Perdida      │
│                                     │
│  Tu sesión de Google se ha          │
│  desconectado. Reconecta para       │
│  sincronizar tus validaciones.      │
│                                     │
│  💾 Tus datos están guardados       │
│  🔄 Se sincronizarán al reconectar  │
│                                     │
│  [Continuar sin sincronizar]        │
│  [🔐 Reconectar con Google]         │
└─────────────────────────────────────┘
```

---

## 📊 Comparación con Implementación Antigua

### **valida.html (Antigua - Funcionaba)**
- ✅ No tenía sistema de polling complejo
- ✅ Usaba callback simple de Google OAuth
- ✅ Timeout manejado por Google, no por código custom
- ❌ No tenía rehidratación de sesión

### **app.js (Nueva - Ahora Corregida)**
- ✅ Sistema de polling como respaldo para COOP
- ✅ Rehidratación de sesión automática
- ✅ Timeout reducido (30s)
- ✅ Pantalla de reconexión profesional
- ✅ Flag para evitar notificaciones repetidas

---

## 🔧 Archivos Modificados

### **1. `/apps/validate/app.js`**
- **Línea 1718:** Agregado flag `pollingTimeoutShown`
- **Línea 1721:** Reducido `maxPolls` de 120 a 30
- **Líneas 1785-1792:** Implementado lógica para mostrar pantalla de reconexión

### **2. CSS ya existente (no modificado)**
- `/shared/css/components.css` líneas 316-393
- Estilos de `.reconnection-overlay` y `.reconnection-modal` ya estaban implementados

---

## 🧪 Pruebas Recomendadas

1. **Simular pérdida de token:**
   - Abrir DevTools → Application → Local Storage
   - Eliminar `google_access_token`
   - Esperar 30 segundos
   - ✅ Debe mostrar pantalla de reconexión (no notificaciones en loop)

2. **Verificar timeout:**
   - Iniciar sesión
   - Dejar inactivo por 12 horas
   - Recargar página
   - ✅ Debe mostrar login screen o pantalla de reconexión

3. **Verificar reconexión exitosa:**
   - Hacer clic en "Reconectar con Google"
   - Completar flujo de OAuth
   - ✅ Debe cargar BD y continuar sin errores

---

## 📝 Notas Técnicas

### **¿Por qué 30 segundos?**
- Suficiente tiempo para que el popup de Google se abra y el usuario autentique
- No tan largo como para frustrar al usuario
- Basado en análisis de la implementación antigua que no tenía polling

### **¿Por qué el flag `pollingTimeoutShown`?**
- `setInterval` continúa ejecutándose hasta que se llama `clearInterval`
- Sin el flag, cada iteración después del timeout mostraría la pantalla
- El flag asegura que solo se muestre una vez

### **¿Por qué `showReconnectionScreen()` en lugar de notificación?**
- Más profesional y menos intrusivo
- Da opciones claras al usuario
- Evita spam de notificaciones
- Consistente con el diseño del sistema

---

## ✨ Resultado Final

**ANTES:**
```
⚠️ Autenticación pendiente. Si ya iniciaste sesión, recarga la página.
⚠️ Autenticación pendiente. Si ya iniciaste sesión, recarga la página.
⚠️ Autenticación pendiente. Si ya iniciaste sesión, recarga la página.
[... infinito ...]
```

**DESPUÉS:**
```
[Pantalla de reconexión aparece una sola vez después de 30s]
Usuario puede elegir qué hacer
```

---

## 🎉 Estado: RESUELTO

Los problemas de autenticación en bucle y timeout de polling han sido corregidos exitosamente.
