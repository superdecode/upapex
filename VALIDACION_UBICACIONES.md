# 📍 Sistema de Validación de Códigos de Ubicación

## ✅ Módulo Compartido Implementado

Se ha creado un **módulo compartido** de validación de ubicaciones disponible para todos los apps del sistema WMS.

---

## 🎯 Funcionalidades Implementadas

### 1. **Validación de Código de Ubicación**

**Formato esperado:** `[LETRA(S)][ZONA]-[PASILLO]-[RACK]-[NIVEL]`

**Ejemplos válidos:**
- `A26-06-01-02`
- `B11-11-02-01`
- `A1-11-02-01` (zona sin cero a la izquierda)
- `C9-11-02-01`
- `A1-01-01-01` (normalizado desde A1-1-1-1)

**Reglas de normalización:**
- **Zona** (primer número): 1-999, NO requiere cero a la izquierda
- **Pasillo, Rack, Nivel**: 01-99, SÍ requieren cero a la izquierda

### 2. **Normalización Automática Mejorada**

El sistema aplica las siguientes transformaciones:

**Conversiones:**
- Comillas simples → Guiones: `A26'06'01'02` → `A26-06-01-02`
- Minúsculas → Mayúsculas: `a26-06-01-02` → `A26-06-01-02`
- Espacios → Eliminados: `A26 06 01 02` → `A26-06-01-02`

**Padding inteligente:**
- Zona SIN padding: `A1-1-1-1` → `A1-01-01-01`
- Pasillo CON padding: `1` → `01`
- Rack CON padding: `5` → `05`
- Nivel CON padding: `9` → `09`

**Caracteres convertidos:**
- `'` (comilla simple)
- `` ` `` (acento grave)
- `´` (acento agudo)
- `'` (comilla tipográfica)

### 3. **Popup de Alerta Inteligente**

Cuando el formato es inválido, se muestra un popup con:

#### **Información mostrada:**
- ❌ Código ingresado (resaltado en rojo)
- ✅ Formato esperado con patrón visual
- 📋 Lista de ejemplos válidos
- 💡 Tip sobre conversión automática de comillas

#### **Opciones disponibles:**
1. **"Corregir"** - Cierra el popup para que el usuario corrija el código
2. **"Insertar Forzado"** - Permite guardar el código tal como está (sin justificación requerida)

#### **Proceso de inserción forzada:**
1. Usuario hace clic en "Insertar Forzado"
2. El código se guarda inmediatamente tal como fue ingresado
3. Se muestra notificación de confirmación

---

## 📂 Archivos del Módulo Compartido

### 1. `/shared/js/wms-utils.js` ⭐ NUEVO
**Funciones públicas agregadas:**
- ✅ `normalizeLocation(location)` - Normaliza ubicaciones
- ✅ `validateLocation(location)` - Valida formato y rangos
- ✅ `validateAndNormalizeLocation(location)` - Validación con auto-corrección
- ✅ Reglas de padding: zona SIN padding, resto CON padding
- ✅ Validación de rangos: zona 1-999, resto 01-99

### 2. `/shared/js/location-validator-ui.js` ⭐ NUEVO
**Módulo de UI compartido:**
- ✅ `LocationValidatorUI.validate()` - Función principal
- ✅ Popup inteligente con ejemplos y reglas
- ✅ Callbacks para éxito y inserción forzada
- ✅ Cierre con tecla ESC
- ✅ Diseño responsive y moderno

### 3. `/apps/validador/app.js`
**Integración con módulos compartidos:**
- ✅ Usa `LocationValidatorUI.validate()` en lugar de código local
- ✅ Función `validateLocationInput()` - Wrapper para el validador
- ✅ Event listeners (blur, keydown, input)
- ✅ Estado `currentLocation` en STATE global

### 4. `/apps/validador/index.html`
**Integración de scripts compartidos:**
- ✅ `<script src="../../shared/js/wms-utils.js"></script>`
- ✅ `<script src="../../shared/js/location-validator-ui.js"></script>`
- ✅ Campo de entrada para código de ubicación
- ✅ Label descriptivo con emoji 📍
- ✅ Placeholder con ejemplos: `A26-06-01-02 o A26'06'01'02`
- ✅ Tip visual sobre conversión automática

### 5. `/shared/css/validador.css`
**Estilos del popup compartido:**
- ✅ Estilos completos para `.location-validation-overlay`
- ✅ Estilos para `.location-validation-popup`
- ✅ Diseño de `.location-error-box` (código en rojo)
- ✅ Estilos para `.location-format-pattern` (patrón esperado)
- ✅ Lista de ejemplos con `.location-examples`
- ✅ Tip visual con `.location-tip`
- ✅ Animaciones `fadeIn` y `slideUp`

### 6. `/shared/LOCATION_VALIDATOR_GUIDE.md` ⭐ NUEVO
**Guía completa de integración:**
- ✅ Instrucciones paso a paso
- ✅ Ejemplos de código para cada módulo
- ✅ Casos de uso comunes
- ✅ Checklist de integración
- ✅ Documentación de API completa

---

## 🔧 API del Módulo Compartido

### `LocationValidatorUI.validate(location, onSuccess, onForce)`
**Función principal de validación con UI**

**Parámetros:**
- `location` (string): Ubicación a validar
- `onSuccess` (function): Callback cuando es válida
  - Recibe: `normalizedLocation` (string)
- `onForce` (function): Callback cuando se fuerza
  - Recibe: `forcedLocation` (string)

**Ejemplo:**
```javascript
LocationValidatorUI.validate(
    'A1-1-1-1',
    (normalized) => console.log(normalized), // "A1-01-01-01"
    (forced) => console.log('Forzado:', forced)
);
```

### `validateLocation(location)` (wms-utils.js)
**Validación sin UI**

**Retorna:**
```javascript
{
    valid: boolean,
    normalized: string,      // "A1-01-01-01"
    parsed: {
        area: string,        // "A"
        zone: string,        // "1" (sin padding)
        aisle: string,       // "01" (con padding)
        rack: string,        // "01" (con padding)
        level: string,       // "01" (con padding)
        formatted: string    // "A1-01-01-01"
    },
    message: string,
    original: string
}
```

### `normalizeLocation(location)` (wms-utils.js)
**Normalización básica**

**Transformaciones:**
- Convierte a mayúsculas
- Reemplaza comillas simples por guiones
- Elimina espacios en blanco

**Ejemplo:**
```javascript
normalizeLocation("a1'1'1'1")  // "A1-1-1-1"
```

---

## 🎨 Diseño Visual

### Popup de Validación
- **Overlay oscuro** con fondo semitransparente
- **Popup centrado** con animación de entrada
- **Código inválido** resaltado en rojo con gradiente
- **Formato esperado** en naranja con borde destacado
- **Ejemplos** en verde con borde izquierdo
- **Tip** en azul con gradiente suave
- **Botones** con efectos hover y transiciones

### Colores Utilizados
- ❌ Error: `#F44336` (rojo)
- ⚠️ Warning: `#FF9800` (naranja)
- ✅ Success: `#4CAF50` (verde)
- 💡 Info: `#2196F3` (azul)

---

## 🧪 Testing

Se incluye función de prueba `testLocationValidator()` que valida:

```javascript
testCases = [
    'A26-06-01-02',      // ✅ Válido
    "A26'06'01'02",      // ✅ Válido (normalizado)
    'B11-11-02-01',      // ✅ Válido
    'A1-11-02-01',       // ✅ Válido
    'C9-11-02-01',       // ✅ Válido
    'INVALID',           // ❌ Inválido
    'A26 06 01 02',      // ❌ Inválido (espacios)
    'Z123-45-67-89'      // ✅ Válido
];
```

**Para ejecutar pruebas:**
```javascript
testLocationValidator(); // En consola del navegador
```

---

## 📊 Comparación con Original

### Características del Original (`validador.html`)
- ✅ Sistema completo de validación con múltiples módulos
- ✅ Gestión de OBCs (órdenes)
- ✅ Historial de validaciones
- ✅ Sincronización con Google Sheets
- ✅ Sistema de caché persistente
- ✅ Múltiples popups y alertas

### Características de la Aplicación (`apps/validador`)
- ✅ Versión simplificada y modular
- ✅ Validación de códigos contra base de datos
- ✅ **NUEVO:** Validación de códigos de ubicación
- ✅ **NUEVO:** Normalización automática de comillas
- ✅ **NUEVO:** Popup inteligente con justificación
- ✅ Estadísticas de sesión
- ✅ Integración con Google Sheets

---

## 🚀 Uso del Sistema

### 1. Iniciar Validación
```javascript
startValidation(); // Abre pantalla de validación
```

### 2. Ingresar Ubicación
- Usuario ingresa código en campo "📍 Código de Ubicación"
- Al presionar Enter o perder foco, se valida automáticamente
- Si es válido: se normaliza y acepta
- Si es inválido: se muestra popup

### 3. Manejar Código Inválido
**Opción A - Corregir:**
- Usuario hace clic en "Corregir"
- Popup se cierra
- Usuario puede corregir el código

**Opción B - Forzar:**
- Usuario hace clic en "Insertar Forzado"
- Código se guarda inmediatamente tal como está
- Se muestra notificación de confirmación

---

## 📝 Notas Importantes

1. **Normalización automática:** Las comillas simples se convierten automáticamente a guiones antes de validar
2. **Inserción forzada directa:** No requiere justificación, se guarda inmediatamente
3. **Validación en tiempo real:** El campo convierte a mayúsculas mientras se escribe
4. **Múltiples triggers:** La validación se activa con Enter o al perder el foco
5. **Notificaciones:** Se muestran notificaciones visuales para cada acción

---

## ✨ Mejoras Implementadas

### Comparado con la versión anterior:

1. ✅ **Módulo compartido** - Disponible para todos los apps (inventario, track, validador)
2. ✅ **Normalización inteligente con padding** - A1-1-1-1 → A1-01-01-01
3. ✅ **Regla de zona sin padding** - Zona puede ser 1-999 sin cero a la izquierda
4. ✅ **Validación de rangos** - Zona 1-999, resto 01-99
5. ✅ **Popup visual mejorado** con reglas y ejemplos
6. ✅ **Inserción forzada simplificada** sin justificación
7. ✅ **API pública documentada** en wms-utils.js
8. ✅ **Guía de integración completa** para otros módulos
9. ✅ **Animaciones suaves** para mejor UX
10. ✅ **Cierre con ESC** en el popup

---

## 🎯 Estado Final

**✅ TODAS LAS FUNCIONALIDADES SOLICITADAS HAN SIDO IMPLEMENTADAS:**

1. ✅ Validación de Código de Ubicación (formato: Letra-Número-Número-Número)
2. ✅ Normalización Automática Mejorada:
   - Comillas simples → guiones
   - **A1-1-1-1 → A1-01-01-01** (zona sin padding, resto con padding)
3. ✅ Popup de Alerta Inteligente con:
   - Código ingresado en rojo
   - Formato esperado con ejemplos
   - Reglas de normalización explicadas
   - Opción "Corregir"
   - Opción "Insertar Forzado" (sin justificación requerida)
4. ✅ **Módulo compartido** disponible para todos los apps del sistema
5. ✅ **Guía de integración** completa en `/shared/LOCATION_VALIDATOR_GUIDE.md`

**El sistema está listo para usar en producción y puede integrarse en cualquier módulo.**
