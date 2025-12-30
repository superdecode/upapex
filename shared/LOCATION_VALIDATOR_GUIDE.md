# 📍 Guía de Integración - Validador de Ubicaciones

## 🎯 Módulo Compartido para Todos los Apps

Este módulo proporciona validación de ubicaciones de almacén de forma consistente en toda la aplicación WMS.

---

## 📦 Componentes

### 1. **`wms-utils.js`** - Lógica de Validación
Funciones de validación y normalización de ubicaciones.

### 2. **`location-validator-ui.js`** - Interfaz de Usuario
Popup visual para validación con opciones de corrección o inserción forzada.

### 3. **`validador.css`** - Estilos del Popup
Estilos compartidos para el popup de validación.

---

## 🚀 Cómo Integrar en tu Módulo

### Paso 1: Incluir los Scripts

Agrega estos scripts en tu HTML **antes** de tu archivo JS principal:

```html
<!-- En el <head> o antes de cerrar </body> -->
<script src="../../shared/js/wms-utils.js"></script>
<script src="../../shared/js/location-validator-ui.js"></script>
```

### Paso 2: Incluir los Estilos

```html
<link rel="stylesheet" href="../../shared/css/validador.css">
```

### Paso 3: Usar el Validador

```javascript
// Ejemplo básico
LocationValidatorUI.validate(
    ubicacionIngresada,
    (ubicacionNormalizada) => {
        // ✅ Ubicación válida
        console.log('Ubicación válida:', ubicacionNormalizada);
        // Guardar o usar la ubicación normalizada
    },
    (ubicacionForzada) => {
        // ⚠️ Usuario forzó la inserción
        console.log('Ubicación forzada:', ubicacionForzada);
        // Guardar con advertencia
    }
);
```

---

## 📋 Ejemplos de Uso

### Ejemplo 1: Validación en Input Field

```javascript
const locationInput = document.getElementById('location-input');

locationInput.addEventListener('blur', () => {
    const location = locationInput.value.trim();
    if (location) {
        LocationValidatorUI.validate(
            location,
            (normalized) => {
                locationInput.value = normalized;
                showNotification('✅ Ubicación válida', 'success');
            },
            (forced) => {
                locationInput.value = forced;
                showNotification('⚠️ Ubicación insertada forzadamente', 'warning');
            }
        );
    }
});
```

### Ejemplo 2: Validación al Presionar Enter

```javascript
locationInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        const location = locationInput.value.trim();
        
        LocationValidatorUI.validate(
            location,
            (normalized) => {
                // Ubicación válida, continuar con el flujo
                processLocation(normalized);
            },
            (forced) => {
                // Usuario decidió forzar, registrar advertencia
                logWarning('Ubicación no estándar forzada', forced);
                processLocation(forced);
            }
        );
    }
});
```

### Ejemplo 3: Validación Silenciosa (sin UI)

Si solo necesitas validar sin mostrar popup:

```javascript
// Usar directamente la función de wms-utils.js
const validation = validateLocation('A1-1-1-1');

if (validation.valid) {
    console.log('Válida:', validation.normalized); // "A1-01-01-01"
    console.log('Componentes:', validation.parsed);
} else {
    console.log('Inválida:', validation.message);
}
```

---

## 🔧 Funciones Disponibles

### `LocationValidatorUI.validate(location, onSuccess, onForce)`

**Parámetros:**
- `location` (string): Ubicación a validar
- `onSuccess` (function): Callback cuando la ubicación es válida
  - Recibe: `normalizedLocation` (string)
- `onForce` (function): Callback cuando el usuario fuerza la inserción
  - Recibe: `forcedLocation` (string)

**Comportamiento:**
- Si la ubicación es válida → llama a `onSuccess` con la versión normalizada
- Si es inválida → muestra popup con opciones "Corregir" o "Insertar Forzado"

---

### `validateLocation(location)` (de wms-utils.js)

**Parámetros:**
- `location` (string): Ubicación a validar

**Retorna:**
```javascript
{
    valid: boolean,           // true si es válida
    normalized: string,       // Versión normalizada
    parsed: {                 // Componentes (solo si válida)
        area: string,         // Letra(s): A, B, C
        zone: string,         // Zona: 1, 26, 123 (sin padding)
        aisle: string,        // Pasillo: 01-99 (con padding)
        rack: string,         // Rack: 01-99 (con padding)
        level: string,        // Nivel: 01-99 (con padding)
        formatted: string     // Versión completa normalizada
    },
    message: string,          // Mensaje descriptivo
    original: string          // Ubicación original
}
```

---

### `normalizeLocation(location)` (de wms-utils.js)

**Parámetros:**
- `location` (string): Ubicación sin normalizar

**Retorna:**
- `string`: Ubicación normalizada (mayúsculas, comillas → guiones, sin espacios)

**Ejemplo:**
```javascript
normalizeLocation("a26'06'01'02")  // → "A26-06-01-02"
normalizeLocation("B11 11 02 01")  // → "B11-11-02-01"
```

---

## 📐 Reglas de Normalización

### Formato Esperado
```
[LETRA(S)][ZONA]-[PASILLO]-[RACK]-[NIVEL]
```

### Reglas Específicas

1. **Área (Letras):**
   - Una o más letras: A, B, C, AB, etc.
   - Siempre en mayúsculas

2. **Zona (Primer Número):**
   - Rango: 1-999
   - **NO requiere cero a la izquierda** si es menor a 10
   - Ejemplos: `1`, `9`, `26`, `123`

3. **Pasillo, Rack, Nivel:**
   - Rango: 01-99
   - **SÍ requieren cero a la izquierda**
   - Ejemplos: `01`, `05`, `11`, `99`

4. **Conversión Automática:**
   - Comillas simples (`'`) → Guiones (`-`)
   - Espacios → Eliminados
   - Minúsculas → Mayúsculas

### Ejemplos de Normalización

| Entrada | Salida | Descripción |
|---------|--------|-------------|
| `A1-1-1-1` | `A1-01-01-01` | Zona sin padding, resto con padding |
| `A26'06'01'02` | `A26-06-01-02` | Comillas a guiones |
| `b11-11-02-01` | `B11-11-02-01` | Mayúsculas |
| `A 1-1-1-1` | `A1-01-01-01` | Espacios eliminados + padding |
| `C9-11-02-01` | `C9-11-02-01` | Ya normalizado |

---

## 🎨 Personalización del Popup

El popup usa las clases CSS de `validador.css`. Puedes personalizarlo modificando:

```css
/* Color del overlay */
.location-validation-overlay {
    background: rgba(0, 0, 0, 0.7);
}

/* Tamaño del popup */
.location-validation-popup {
    max-width: 550px;
}

/* Color del código inválido */
.location-error-code {
    color: var(--error);
}
```

---

## 🧪 Testing

Función de prueba incluida en `app.js`:

```javascript
testLocationValidator();
```

Casos de prueba:
- ✅ `A26-06-01-02` → Válido
- ✅ `A26'06'01'02` → Válido (normalizado)
- ✅ `A1-1-1-1` → Válido (normalizado a `A1-01-01-01`)
- ✅ `B11-11-02-01` → Válido
- ❌ `INVALID` → Inválido
- ❌ `A26 06 01 02` → Inválido (espacios)

---

## 📱 Integración en Módulos Existentes

### Inventario App

```javascript
// En tu archivo de inventario
function validatePalletLocation(location) {
    LocationValidatorUI.validate(
        location,
        (normalized) => {
            // Asignar ubicación al pallet
            currentPallet.location = normalized;
            updatePalletDisplay();
        },
        (forced) => {
            // Registrar advertencia en el sistema
            logLocationWarning(currentPallet.id, forced);
            currentPallet.location = forced;
            updatePalletDisplay();
        }
    );
}
```

### Track App

```javascript
// En tu módulo de tracking
function updateItemLocation(itemId, newLocation) {
    LocationValidatorUI.validate(
        newLocation,
        (normalized) => {
            // Actualizar ubicación en base de datos
            updateDatabase(itemId, normalized);
            showNotification('Ubicación actualizada', 'success');
        },
        (forced) => {
            // Actualizar con flag de advertencia
            updateDatabase(itemId, forced, { warning: true });
            showNotification('Ubicación forzada - Revisar formato', 'warning');
        }
    );
}
```

---

## 🔍 Validación Avanzada

### Validar sin Mostrar Popup

```javascript
const validation = validateLocation('A1-1-1-1');

if (validation.valid) {
    // Usar validation.normalized
    console.log('Normalizada:', validation.normalized); // "A1-01-01-01"
    
    // Acceder a componentes
    console.log('Área:', validation.parsed.area);      // "A"
    console.log('Zona:', validation.parsed.zone);      // "1"
    console.log('Pasillo:', validation.parsed.aisle);  // "01"
} else {
    // Manejar error
    console.error(validation.message);
}
```

### Normalizar sin Validar

```javascript
const normalized = normalizeLocation("a26'06'01'02");
console.log(normalized); // "A26-06-01-02"
```

---

## ⚠️ Consideraciones Importantes

1. **Orden de Scripts:** Asegúrate de cargar `wms-utils.js` **antes** de `location-validator-ui.js`

2. **Dependencias CSS:** El popup requiere los estilos de `validador.css`

3. **Callback Obligatorios:** Siempre proporciona ambos callbacks (onSuccess y onForce)

4. **Zona sin Padding:** Recuerda que la zona NO lleva cero a la izquierda:
   - ✅ Correcto: `A1-01-01-01`
   - ❌ Incorrecto: `A01-01-01-01`

5. **Validación en Tiempo Real:** Considera validar en `blur` o `Enter`, no en cada `input`

---

## 📊 Flujo de Validación

```
Usuario ingresa ubicación
         ↓
LocationValidatorUI.validate()
         ↓
normalizeLocation() → Limpia y formatea
         ↓
validateLocation() → Valida formato y rangos
         ↓
    ¿Es válida?
    ↙        ↘
  SÍ          NO
   ↓           ↓
onSuccess   Mostrar Popup
            ↙        ↘
      Corregir    Insertar Forzado
         ↓              ↓
    Cerrar popup    onForce
```

---

## 🎯 Checklist de Integración

- [ ] Incluir `wms-utils.js` en HTML
- [ ] Incluir `location-validator-ui.js` en HTML
- [ ] Incluir `validador.css` en HTML
- [ ] Implementar callback `onSuccess`
- [ ] Implementar callback `onForce`
- [ ] Agregar event listeners (blur, keydown)
- [ ] Probar con casos válidos e inválidos
- [ ] Verificar normalización de `A1-1-1-1` → `A1-01-01-01`
- [ ] Verificar conversión de comillas a guiones
- [ ] Documentar uso específico en tu módulo

---

## 🆘 Soporte

Si tienes dudas sobre la integración:

1. Revisa los ejemplos en `/apps/validador/app.js`
2. Ejecuta `testLocationValidator()` en consola
3. Verifica que los scripts estén cargados correctamente
4. Revisa la consola del navegador para errores

---

## 📝 Changelog

### v1.0.0 (2025-12-29)
- ✅ Validación de formato Letra-Número-Número-Número
- ✅ Normalización automática de comillas a guiones
- ✅ Zona sin padding obligatorio (A1 es válido)
- ✅ Pasillo, Rack, Nivel con padding obligatorio (01-99)
- ✅ Popup inteligente con opciones Corregir/Forzar
- ✅ Módulo compartido para todos los apps
- ✅ Funciones públicas en wms-utils.js
- ✅ UI compartida en location-validator-ui.js

---

**¡El validador está listo para usar en todos los módulos del sistema WMS!** 🎉
