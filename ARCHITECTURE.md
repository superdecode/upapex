# 🏗️ Arquitectura del Sistema WMS

Documentación técnica completa del sistema de gestión de almacén.

## 📋 Índice

1. [Visión General](#visión-general)
2. [Arquitectura de Aplicaciones](#arquitectura-de-aplicaciones)
3. [Estructura de CSS](#estructura-de-css)
4. [Flujo de Datos](#flujo-de-datos)
5. [Integración Google Sheets](#integración-google-sheets)
6. [Gestión de Estado](#gestión-de-estado)
7. [Patrones de Diseño](#patrones-de-diseño)
8. [Optimizaciones](#optimizaciones)

## 🎯 Visión General

### Principios de Diseño

1. **Modularidad**: Código compartido vs específico
2. **Mantenibilidad**: Fácil de entender y modificar
3. **Escalabilidad**: Preparado para crecer
4. **Performance**: Optimizado para operaciones rápidas
5. **UX First**: Experiencia de usuario prioritaria

### Stack Tecnológico

```
Frontend:
├── HTML5 (Semántico)
├── CSS3 (Variables, Grid, Flexbox)
└── JavaScript ES6+ (Vanilla)

APIs:
├── Google Sheets API v4
├── Google Identity Services
└── Web Audio API (Feedback sonoro)

Storage:
└── LocalStorage (Persistencia local)
```

## 🏛️ Arquitectura de Aplicaciones

### Estructura Modular

```
┌─────────────────────────────────────┐
│         index.html (Hub)            │
│     Portal de entrada al sistema    │
└─────────────────┬───────────────────┘
                  │
        ┌─────────┴─────────┬─────────┐
        │                   │         │
┌───────▼────────┐  ┌──────▼──────┐  │
│   Inventario   │  │    Track    │  │
│   (Gestión)    │  │  (Consulta) │  │
└───────┬────────┘  └──────┬──────┘  │
        │                   │         │
        └─────────┬─────────┘         │
                  │                   │
          ┌───────▼────────┐  ┌───────▼────────┐
          │   Validador    │  │    Dispatch    │
          │  (Validación)  │  │   (Despacho)   │
          └────────┬───────┘  └───────┬────────┘
                   │                  │
                   └────────┬─────────┘
                            │
                  ┌─────────▼─────────┐
                  │   Shared Assets   │
                  │ (CSS + JS + Auth) │
                  └───────────────────┘
```

### Patrón de Cada Aplicación

```javascript
// Estructura estándar de app.js

// 1. CONFIGURACIÓN
const CONFIG = { ... };

// 2. ESTADO GLOBAL
const STATE = { ... };

// 3. INICIALIZACIÓN
function initializeApp() { ... }

// 4. AUTENTICACIÓN
function handleLogin() { ... }
function handleLogout() { ... }

// 5. CARGA DE DATOS
async function loadData() { ... }

// 6. LÓGICA DE NEGOCIO
function processData() { ... }

// 7. ACTUALIZACIÓN UI
function updateUI() { ... }

// 8. UTILIDADES
function showNotification() { ... }
function showLoading() { ... }
```

## 🎨 Estructura de CSS

### Jerarquía de Estilos

```
1. variables.css     → Definiciones globales
2. base.css          → Reset, animaciones, utilidades
3. layout.css        → Estructura, grids, flexbox
4. components.css    → Botones, modales, notificaciones
5. [app].css         → Estilos específicos de cada app
```

### Sistema de Variables

```css
/* Colores Semánticos */
--primary: #2563eb;      /* Acciones principales */
--success: #4CAF50;      /* Estados exitosos */
--warning: #FF9800;      /* Advertencias */
--error: #F44336;        /* Errores */

/* Colores Funcionales */
--bg: #f7f7f7;          /* Fondo general */
--text: #333;           /* Texto principal */
--border: #e2e8f0;      /* Bordes */
--card: #ffffff;        /* Tarjetas */

/* Efectos */
--shadow: 0 2px 8px rgba(0,0,0,0.1);
--shadow-hover: 0 4px 12px rgba(0,0,0,0.15);
```

### Metodología BEM Adaptada

```css
/* Bloque */
.column { ... }

/* Elemento */
.column-header { ... }
.column-list { ... }

/* Modificador */
.column.ok { ... }
.column.blocked { ... }
```

## 📊 Flujo de Datos

### Inventario App - Flujo Completo

```
┌──────────────┐
│   Usuario    │
│  Escanea     │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  processScan()   │
│  Normaliza código│
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ findInInventory()│
│ Busca en Map     │
└──────┬───────────┘
       │
   ┌───┴───┐
   │       │
   ▼       ▼
┌─────┐ ┌─────┐
│Found│ │ Not │
│     │ │Found│
└──┬──┘ └──┬──┘
   │       │
   ▼       ▼
┌─────────────┐
│ Clasificar  │
│ OK/Blocked/ │
│   NoWMS     │
└──────┬──────┘
       │
       ▼
┌──────────────┐
│  addBox()    │
│ Agregar a    │
│  Pallet      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  updateUI()  │
│ Renderizar   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│saveToStorage │
│ Persistir    │
└──────────────┘
```

### Track App - Flujo de Búsqueda

```
Usuario ingresa código
        ↓
searchBox() normaliza
        ↓
Busca en STATE.database (Map)
        ↓
    ¿Encontrado?
    ↙         ↘
  Sí          No
   ↓           ↓
displayResults()  showNotification()
   ↓
Renderiza KPIs + Tabla
```

### Validador App - Flujo de Validación

```
Sesión iniciada
      ↓
Usuario escanea
      ↓
validateCode()
      ↓
Busca en database
      ↓
  ¿Existe?
  ↙     ↘
Sí      No
 ↓       ↓
Valid  Invalid
 ↓       ↓
Incrementa stats
 ↓       ↓
Feedback visual/sonoro
 ↓       ↓
saveStats()
```

### Dispatch App - Flujo de Despacho

```
Usuario busca orden
      ↓
Busca en OBC_BD
      ↓
  ¿Encontrada?
  ↙         ↘
Sí          No
 ↓           ↓
Muestra detalles  Error
 ↓
Verifica validación
 ↓
¿Ya validada?
↙         ↘
Sí        No
↓          ↓
Muestra   Permite
estado    validar
↓          ↓
Genera folio
↓
Guarda local + BD
↓
Actualiza UI
```

## 🔗 Integración Google Sheets

### Arquitectura de Conexión

```
┌──────────────┐
│  Aplicación  │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│  Google Identity │
│    Services      │
│  (OAuth 2.0)     │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Access Token    │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Google Sheets    │
│     API v4       │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│   Spreadsheet    │
│   (Base Datos)   │
└──────────────────┘
```

### Operaciones CRUD

```javascript
// READ - Cargar inventario
await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: 'Inventario!A2:Z'
});

// WRITE - Enviar pallet
await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: 'Envios!A:F',
    valueInputOption: 'RAW',
    resource: { values: data }
});
```

### Estructura de Datos

**Hoja: Inventario**
```
Row 1: Headers
Row 2+: Data
Columns:
  A: Código (PK)
  B: SKU
  C: Producto
  D: Ubicación
  E: Stock
  F: Estado
  G: Almacén
  H: Actualización
```

**Hoja: Envios**
```
Columns:
  A: PalletID
  B: Código
  C: Ubicación Destino
  D: Categoría
  E: Timestamp
  F: Usuario
```

## 🗄️ Gestión de Estado

### STATE Object Pattern

```javascript
const STATE = {
    // Datos de aplicación
    inventory: new Map(),      // Inventario completo
    database: new Map(),       // Base de datos
    
    // Estado de sesión
    user: null,               // Usuario actual
    isOnline: false,          // Estado conexión
    
    // Datos de trabajo
    pallets: {
        ok: { boxes: [], id: 'PLT-XXX' },
        blocked: { boxes: [], id: 'PLT-YYY' },
        nowms: { boxes: [], id: 'PLT-ZZZ' }
    },
    
    // Estadísticas
    stats: {
        totalValidations: 0,
        validCodes: 0,
        invalidCodes: 0
    }
};
```

### Persistencia Local

```javascript
// Guardar
function saveToStorage() {
    localStorage.setItem('wms_key', JSON.stringify(STATE));
}

// Cargar
function loadFromStorage() {
    const saved = localStorage.getItem('wms_key');
    if (saved) {
        Object.assign(STATE, JSON.parse(saved));
    }
}
```

### Uso de Map para Performance

```javascript
// Map es O(1) para búsquedas
const inventory = new Map();

// Agregar
inventory.set('ABC123', { sku: 'SKU1', ... });

// Buscar (instantáneo)
const item = inventory.get('ABC123');

// Ventaja vs Array.find() que es O(n)
```

## 🎨 Patrones de Diseño

### 1. Module Pattern

```javascript
const InventoryModule = {
    state: { ... },
    init() { ... },
    processScan(code) { ... },
    updateUI() { ... }
};
```

### 2. Observer Pattern (Implícito)

```javascript
// Cambio de estado → Actualización UI
function addBox(category, box) {
    STATE.pallets[category].boxes.push(box);
    saveToStorage();    // Persistir
    updateUI();         // Actualizar vista
}
```

### 3. Factory Pattern

```javascript
function generatePalletId() {
    return 'PLT-' + Date.now().toString(36).toUpperCase();
}

function createBoxData(raw, code, item) {
    return {
        raw,
        code,
        location: item?.cellNo || '-',
        timestamp: new Date().toLocaleTimeString()
    };
}
```

### 4. Strategy Pattern

```javascript
// Diferentes estrategias de búsqueda
function findCodeInInventory(rawCode) {
    // 1. Búsqueda directa
    let item = inventory.get(normalized);
    if (item) return { code: normalized, item };
    
    // 2. Con guión
    if (normalized.includes('/')) {
        const withDash = normalized.replace(/\//g, '-');
        item = inventory.get(withDash);
        if (item) return { code: withDash, item };
    }
    
    // 3. Con slash
    if (normalized.includes('-')) {
        const withSlash = normalized.replace(/-/g, '/');
        item = inventory.get(withSlash);
        if (item) return { code: withSlash, item };
    }
}
```

## ⚡ Optimizaciones

### Performance

1. **Map en lugar de Array**
   - O(1) vs O(n) para búsquedas
   - Crítico con miles de códigos

2. **Event Delegation**
   ```javascript
   // En lugar de múltiples listeners
   list.addEventListener('click', (e) => {
       if (e.target.matches('.delete-btn')) {
           deleteBox(e.target.dataset.index);
       }
   });
   ```

3. **Debouncing en inputs**
   ```javascript
   let timeout;
   input.addEventListener('input', () => {
       clearTimeout(timeout);
       timeout = setTimeout(() => search(), 300);
   });
   ```

### UX Optimizations

1. **Feedback Inmediato**
   - Sonidos en operaciones
   - Animaciones CSS
   - Notificaciones toast

2. **Estados de Carga**
   - Spinners durante API calls
   - Deshabilitación de botones
   - Mensajes informativos

3. **Validación Proactiva**
   - Validación en tiempo real
   - Mensajes de error claros
   - Sugerencias de corrección

### Memory Management

```javascript
// Limpiar referencias
function cleanup() {
    STATE.inventory.clear();
    STATE.database.clear();
    // GC puede liberar memoria
}

// Limitar tamaño de arrays
if (history.length > 1000) {
    history.splice(0, 500); // Mantener últimos 500
}
```

## 🔐 Seguridad

### Autenticación

```javascript
// OAuth 2.0 flow
tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: handleAuthResponse
});
```

### Validación de Datos

```javascript
function validateLocation(location) {
    const pattern = /^([A-Z])(\d{1,3})-(\d{1,2})-(\d{1,2})-(\d{1,2})$/;
    return pattern.test(location);
}

function normalizeCode(raw) {
    // Sanitizar entrada
    return raw.trim()
              .toUpperCase()
              .replace(/[^a-zA-Z0-9\-\/]/g, '');
}
```

## 📈 Escalabilidad

### Preparado para Crecer

1. **Shared JS Module** (futuro)
   ```
   shared/js/
   ├── auth.js       # Autenticación compartida
   ├── api.js        # Llamadas API
   ├── utils.js      # Utilidades
   └── storage.js    # Gestión storage
   ```

2. **Config Centralizado** (futuro)
   ```javascript
   // shared/config/config.js
   export const CONFIG = {
       SPREADSHEET_ID: '...',
       CLIENT_ID: '...',
       SHEETS: {
           INVENTORY: 'Inventario',
           SHIPMENTS: 'Envios'
       }
   };
   ```

3. **Service Workers** (futuro)
   - Modo offline completo
   - Sincronización en background
   - Cache de assets

## 🧪 Testing (Futuro)

```javascript
// Estructura para tests
describe('Inventory Module', () => {
    test('normalizeCode removes special chars', () => {
        expect(normalizeCode('ABC-123!')).toBe('ABC-123');
    });
    
    test('findCodeInInventory tries variants', () => {
        const result = findCodeInInventory('ABC/123');
        expect(result.variant).toBe('dash');
    });
});
```

## 📚 Referencias

- [Google Sheets API v4](https://developers.google.com/sheets/api)
- [Google Identity Services](https://developers.google.com/identity/gsi/web)
- [MDN Web Docs](https://developer.mozilla.org/)
- [CSS Grid Guide](https://css-tricks.com/snippets/css/complete-guide-grid/)

---

**Mantenido por:** Equipo de Desarrollo  
**Última actualización:** Diciembre 2025
