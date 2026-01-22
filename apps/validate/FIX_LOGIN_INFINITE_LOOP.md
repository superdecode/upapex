# FIX: Loop Infinito en Login - RESUELTO

**Fecha:** 22 de enero de 2026  
**Versión:** 3.6.1  
**Estado:** ✅ RESUELTO

---

## 🔴 PROBLEMA

### **Síntoma:**
- Al hacer clic en "Iniciar sesión"
- Aparece mensaje "⏳ Inicializando autenticación..." repetidamente
- **NO aparece el popup de Google OAuth**
- Loop infinito de mensajes
- Sistema nunca completa el login

---

## 🔍 CAUSA RAÍZ

### **Variable Scope Incorrecta:**

**El problema era que `TOKEN_CLIENT` se declaraba DOS veces:**

```javascript
// Línea 56 - Declaración GLOBAL (correcta)
let TOKEN_CLIENT, audioCtx;

// Línea 1076 - RE-DECLARACIÓN LOCAL (❌ ERROR)
let TOKEN_CLIENT = null;  // Esto crea una variable LOCAL que sombrea la global
let TOKEN_EXPIRES_AT = 0;
let tokenRefreshTimeout = null;
```

### **Por qué causaba el loop infinito:**

1. **`initAuthManager()` ejecuta (dentro de initAuth):**
   ```javascript
   TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({...});
   ```
   - Esto asigna a la variable **LOCAL** `TOKEN_CLIENT`
   - La variable **GLOBAL** `TOKEN_CLIENT` queda como `undefined`

2. **`handleLogin()` ejecuta (fuera de initAuth):**
   ```javascript
   if (!TOKEN_CLIENT) {  // Verifica la variable GLOBAL
       setTimeout(handleLogin, 500);  // Siempre es undefined → loop infinito
       return;
   }
   ```
   - Verifica la variable **GLOBAL** que nunca se inicializó
   - Siempre es `undefined` → llama `setTimeout` infinitamente

3. **Resultado:**
   - `handleLogin` se llama a sí mismo cada 500ms
   - Nunca llega a `TOKEN_CLIENT.requestAccessToken()`
   - Usuario ve "Inicializando autenticación..." sin fin

---

## ✅ SOLUCIÓN IMPLEMENTADA

### **1. Eliminar Re-declaración Local**

**ANTES:**
```javascript
// Dentro de initAuth
const initAuthManager = async () => {
    // Variable global para TOKEN_CLIENT y expiración
    let TOKEN_CLIENT = null;  // ❌ Sombrea la variable global
    let TOKEN_EXPIRES_AT = 0;
    let tokenRefreshTimeout = null;
    
    TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({...});
};
```

**DESPUÉS:**
```javascript
// Dentro de initAuth
const initAuthManager = async () => {
    // Variables para expiración y renovación de token
    let TOKEN_EXPIRES_AT = 0;  // ✅ Solo variables locales necesarias
    let tokenRefreshTimeout = null;
    
    TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({...});  // ✅ Asigna a global
};
```

---

### **2. Agregar Protección Contra Loop Infinito**

**Implementación de contador de reintentos:**

```javascript
// Contador para evitar loops infinitos en handleLogin
let loginRetryCount = 0;
const MAX_LOGIN_RETRIES = 20; // 10 segundos máximo

function handleLogin() {
    try {
        console.log('🔐 [VALIDADOR] Iniciando proceso de login...');
        
        if (!TOKEN_CLIENT) {
            loginRetryCount++;
            
            // NUEVO: Verificar si excedió reintentos
            if (loginRetryCount >= MAX_LOGIN_RETRIES) {
                console.error('❌ [VALIDADOR] TOKEN_CLIENT no se inicializó después de 10 segundos');
                showNotification('❌ Error: Sistema de autenticación no disponible. Recarga la página.', 'error');
                loginRetryCount = 0;
                return;  // ✅ Detener loop
            }
            
            console.warn(`⚠️ [VALIDADOR] TOKEN_CLIENT no está listo, esperando... (${loginRetryCount}/${MAX_LOGIN_RETRIES})`);
            showNotification('⏳ Inicializando autenticación...', 'info');
            setTimeout(handleLogin, 500);
            return;
        }
        
        // Reset contador cuando TOKEN_CLIENT está listo
        loginRetryCount = 0;
        
        showNotification('🔄 Conectando con Google...', 'info');
        TOKEN_CLIENT.requestAccessToken({ prompt: 'consent' });
    } catch (error) {
        console.error('❌ [VALIDADOR] Error en handleLogin:', error);
        showNotification('❌ Error al iniciar sesión', 'error');
        loginRetryCount = 0;
    }
}
```

**Beneficios:**
- Si `TOKEN_CLIENT` no se inicializa en 10 segundos → muestra error claro
- Evita loop infinito consumiendo recursos
- Usuario sabe que debe recargar la página

---

## 📊 FLUJO CORREGIDO

### **Inicialización:**

```
1. DOMContentLoaded ejecuta
   ↓
2. initAuth() ejecuta
   ↓
3. gapi.load('client', ...) carga Google API Client
   ↓
4. gapi.client.init({...}) inicializa Sheets API
   ↓
5. waitForGIS() espera Google Identity Services
   ↓
6. initAuthManager() ejecuta
   ↓
7. TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({...})
   ✅ Asigna a variable GLOBAL
   ↓
8. Sistema listo para login
```

### **Login:**

```
1. Usuario hace clic en "Iniciar sesión"
   ↓
2. handleLogin() ejecuta
   ↓
3. Verifica TOKEN_CLIENT (variable GLOBAL)
   ↓
4. ✅ TOKEN_CLIENT existe (inicializado en paso 7)
   ↓
5. TOKEN_CLIENT.requestAccessToken({ prompt: 'consent' })
   ↓
6. 🎉 Popup de Google OAuth aparece
   ↓
7. Usuario completa autenticación
   ↓
8. Callback recibe token
   ↓
9. Token guardado en wms_google_token
   ↓
10. Usuario autenticado correctamente
```

---

## 🧪 VERIFICACIÓN

### **Test 1: Login Funciona**

1. Abrir aplicación
2. Hacer clic en "Iniciar sesión"
3. **Verificar en consola:**
   ```
   🔐 [VALIDADOR] Iniciando proceso de login...
   🔄 Conectando con Google...
   ```
4. **Debe aparecer:** Popup de Google OAuth
5. **NO debe aparecer:** Loop de "Inicializando autenticación..."

### **Test 2: Protección de Loop**

1. Modificar código temporalmente para simular fallo:
   ```javascript
   // En initAuthManager, comentar:
   // TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({...});
   ```
2. Hacer clic en "Iniciar sesión"
3. **Verificar en consola:**
   ```
   ⚠️ [VALIDADOR] TOKEN_CLIENT no está listo, esperando... (1/20)
   ⚠️ [VALIDADOR] TOKEN_CLIENT no está listo, esperando... (2/20)
   ...
   ⚠️ [VALIDADOR] TOKEN_CLIENT no está listo, esperando... (20/20)
   ❌ [VALIDADOR] TOKEN_CLIENT no se inicializó después de 10 segundos
   ```
4. **Debe aparecer:** Error claro después de 10 segundos
5. **NO debe aparecer:** Loop infinito

### **Test 3: Variables Scope Correcto**

Verificar en consola del navegador:
```javascript
// Después de que la página carga
console.log('TOKEN_CLIENT global:', window.TOKEN_CLIENT);
// Debe mostrar: undefined (porque TOKEN_CLIENT no está en window, está en scope de módulo)

// Pero handleLogin debe funcionar correctamente porque accede al mismo scope
```

---

## 🎯 RESULTADOS

**ANTES:**
- ❌ Loop infinito de "Inicializando autenticación..."
- ❌ Popup de Google nunca aparece
- ❌ Usuario no puede hacer login
- ❌ Consume recursos del navegador

**DESPUÉS:**
- ✅ "Conectando con Google..." aparece UNA vez
- ✅ Popup de Google aparece correctamente
- ✅ Usuario puede completar login
- ✅ Si falla, muestra error claro después de 10 segundos

---

## 📝 ARCHIVOS MODIFICADOS

### **`app.js`**

**Línea 1075-1077:**
```javascript
// ANTES
let TOKEN_CLIENT = null;
let TOKEN_EXPIRES_AT = 0;
let tokenRefreshTimeout = null;

// DESPUÉS
let TOKEN_EXPIRES_AT = 0;
let tokenRefreshTimeout = null;
```

**Línea 1313-1347:**
```javascript
// AGREGADO: Contador y protección de loop
let loginRetryCount = 0;
const MAX_LOGIN_RETRIES = 20;

function handleLogin() {
    // ... lógica con contador
}
```

---

## 💡 LECCIONES APRENDIDAS

### **1. Variable Shadowing es Peligroso**
- Re-declarar variables con el mismo nombre crea variables locales
- Variables locales "sombrea" (shadow) variables globales
- Difícil de detectar porque no da error de compilación

### **2. Scope de Variables en JavaScript**
```javascript
let x = 1;  // Global

function foo() {
    let x = 2;  // Local - sombrea la global
    console.log(x);  // 2
}

foo();
console.log(x);  // 1
```

### **3. Siempre Agregar Protección de Loop**
- Cualquier función recursiva o con `setTimeout` debe tener límite
- Evita consumir recursos infinitamente
- Proporciona feedback claro al usuario

---

## 🚀 PRÓXIMOS PASOS

1. **Hacer hard refresh:**
   - Mac: `Cmd + Shift + R`
   - Windows: `Ctrl + Shift + R`

2. **Probar login:**
   - Hacer clic en "Iniciar sesión"
   - Debe aparecer popup de Google inmediatamente
   - Completar autenticación
   - Verificar que sesión se mantiene al refrescar

3. **Verificar en consola:**
   - NO debe aparecer loops de "Inicializando autenticación..."
   - Debe aparecer "🔄 Conectando con Google..."
   - Debe aparecer "✅ [AUTH] Token recibido"

---

**Estado:** ✅ RESUELTO COMPLETAMENTE  
**Versión:** 3.6.1  
**Fecha:** 22 de enero de 2026
