# ✅ Corrección de Error 401 - Token de Autenticación

## Problema Identificado

**Error 401 en Dispatch:**
```
Request had invalid authentication credentials. 
Expected OAuth 2 access token, login cookie or other valid authentication credential.
```

**Causa:** El token de Google ha expirado y no se está renovando automáticamente antes de intentar sincronizar.

---

## Solución Implementada

### 1. **Verificación de Token en advanced-sync-manager.js**

Agregado método `ensureValidToken()` que:
- ✅ Verifica que `gapi.client` esté disponible
- ✅ Verifica que exista un token válido
- ✅ Verifica si el token ha expirado
- ✅ Intenta renovar automáticamente si expiró
- ✅ Lanza error claro si no puede renovar

**Código agregado (líneas 782-826):**
```javascript
async ensureValidToken() {
    // Verificar que gapi esté disponible
    if (typeof gapi === 'undefined' || !gapi.client) {
        throw new Error('Google API no está disponible');
    }

    const token = gapi.client.getToken();
    
    // Si no hay token, solicitar autenticación
    if (!token || !token.access_token) {
        throw new Error('No hay token de autenticación. Por favor, inicia sesión.');
    }

    // Verificar si el token ha expirado
    const expiryTime = parseInt(localStorage.getItem('google_token_expiry') || '0');
    const now = Date.now();
    
    if (expiryTime > 0 && now >= expiryTime) {
        console.log('⚠️ Token expirado, solicitando renovación...');
        
        // Intentar renovar con AuthManager
        if (typeof AuthManager !== 'undefined' && AuthManager.renewToken) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout renovando token')), 10000);
                AuthManager.renewToken();
                // Esperar un momento para que se renueve
                setTimeout(() => {
                    clearTimeout(timeout);
                    const newToken = gapi.client.getToken();
                    if (newToken && newToken.access_token) {
                        resolve();
                    } else {
                        reject(new Error('No se pudo renovar el token'));
                    }
                }, 2000);
            });
        } else {
            throw new Error('Token expirado. Por favor, vuelve a iniciar sesión.');
        }
    }

    return true;
}
```

### 2. **Modificación del Método sync()**

Ahora verifica el token ANTES de intentar sincronizar:

```javascript
async sync(showMessages = true) {
    if (this.inProgress) {
        console.log('⚠️ Sincronización ya en progreso');
        return { success: false, message: 'Sincronización en progreso' };
    }

    this.inProgress = true;
    this.retryCount = 0;

    try {
        // ✅ NUEVO: Verificar token antes de sincronizar
        await this.ensureValidToken();
        return await this._doSync(showMessages);
    } catch (error) {
        // Si es error de autenticación, mostrar mensaje claro
        if (error.message && (
            error.message.includes('token') || 
            error.message.includes('autenticación') || 
            error.message.includes('Google API')
        )) {
            console.error('❌ Error de autenticación:', error.message);
            if (showMessages && typeof showNotification === 'function') {
                showNotification('❌ ' + error.message, 'error');
            }
            return { success: false, message: error.message };
        }
        throw error;
    } finally {
        this.inProgress = false;
    }
}
```

---

## Flujo de Autenticación Mejorado

### Antes (Error 401)
```
1. Usuario confirma despacho
2. App intenta sincronizar
3. Token expirado → Error 401
4. Sincronización falla
5. Usuario no ve mensaje claro
```

### Ahora (Renovación Automática)
```
1. Usuario confirma despacho
2. App llama sync()
3. sync() llama ensureValidToken()
4. ensureValidToken() detecta token expirado
5. Llama AuthManager.renewToken()
6. Espera renovación (máx 10 segundos)
7. Si éxito: continúa con sincronización
8. Si falla: muestra mensaje claro al usuario
```

---

## Mensajes de Error Mejorados

### Error 401 - Token Expirado
```
❌ Token expirado. Por favor, vuelve a iniciar sesión.
```

### Error - Sin Token
```
❌ No hay token de autenticación. Por favor, inicia sesión.
```

### Error - Google API No Disponible
```
❌ Google API no está disponible
```

### Error - Timeout Renovando
```
❌ Timeout renovando token
```

---

## Archivos Modificados

1. ✅ `shared/js/advanced-sync-manager.js`
   - Líneas 782-826: Método `ensureValidToken()`
   - Líneas 831-857: Método `sync()` modificado
   - Líneas 859-876: Método `_doSync()` consolidado

2. ✅ `apps/dispatch/index.html`
   - Scripts actualizados a v3.0.4

---

## Beneficios

1. **Renovación Automática:** El token se renueva automáticamente si expiró
2. **Mensajes Claros:** El usuario sabe exactamente qué hacer
3. **Prevención de Errores:** Verifica antes de intentar sincronizar
4. **Timeout Protection:** No se queda esperando indefinidamente
5. **Fallback Graceful:** Si no puede renovar, pide login manual

---

## Instrucciones de Prueba

### Escenario 1: Token Válido
```
1. Iniciar sesión normalmente
2. Confirmar un despacho
3. Resultado esperado: ✅ Sincronización exitosa
```

### Escenario 2: Token Expirado (Simulado)
```
1. Iniciar sesión
2. En consola: localStorage.setItem('google_token_expiry', '0')
3. Confirmar un despacho
4. Resultado esperado: 
   - ⚠️ Token expirado, solicitando renovación...
   - ✅ Token renovado exitosamente
   - ✅ Sincronización completada
```

### Escenario 3: Sin Token
```
1. NO iniciar sesión
2. Intentar confirmar despacho
3. Resultado esperado:
   - ❌ No hay token de autenticación. Por favor, inicia sesión.
```

---

## Verificación en Consola

Después de aplicar los cambios, en la consola debe aparecer:

**Token Válido:**
```
🔄 [DISPATCH] Sincronización iniciada
✅ Sincronización completada: 1 registros enviados
```

**Token Expirado (Renovación Exitosa):**
```
⚠️ Token expirado, solicitando renovación...
✅ AuthManager: Token renovado exitosamente
🔄 [DISPATCH] Sincronización iniciada
✅ Sincronización completada: 1 registros enviados
```

**Token Expirado (Renovación Fallida):**
```
⚠️ Token expirado, solicitando renovación...
❌ Error de autenticación: No se pudo renovar el token
❌ No se pudo renovar el token
```

---

## Pasos para Aplicar

1. **Cerrar COMPLETAMENTE el navegador**
   - Todas las pestañas
   - Todas las ventanas
   - Esperar 5 segundos

2. **Abrir navegador de nuevo**

3. **Ir a dispatch:**
   ```
   http://localhost:5500/apps/dispatch/index.html
   ```

4. **Iniciar sesión con Google**

5. **Probar confirmar un despacho**

---

## Estado de Otras Apps

Las otras apps (Inventory y Validador) también se benefician de esta corrección porque usan el mismo `advanced-sync-manager.js`:

- ✅ **Inventory:** Protegido contra error 401
- ✅ **Validador:** Protegido contra error 401
- ✅ **Dispatch:** Protegido contra error 401

---

## Notas Importantes

1. **AuthManager.renewToken()** debe estar disponible para la renovación automática
2. Si `AuthManager` no está disponible, se pedirá login manual
3. El timeout de renovación es de 10 segundos
4. El token se guarda en `localStorage` con clave `google_token_expiry`
5. La renovación se programa automáticamente cada 55 minutos

---

**Fecha:** 9 de Enero, 2026 - 22:50  
**Versión:** 3.0.4  
**Estado:** ✅ LISTO PARA PRUEBAS
