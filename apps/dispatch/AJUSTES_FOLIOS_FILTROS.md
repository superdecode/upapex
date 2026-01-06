# Ajustes y Optimización: Sistema de Despachos y Folios
## Implementación Enero 2026

---

## 📋 RESUMEN DE CAMBIOS IMPLEMENTADOS

### 1. ✅ Sincronización Global de Filtros

**Descripción**: Cuando el usuario selecciona una fecha para despacho, este filtro se aplica automáticamente a todas las pestañas.

**Implementación**:
- La pestaña de **Folios** ahora usa el filtro global de fecha (`STATE.dateFilter`)
- Si hay filtro global activo, se muestra "(Global)" en el botón de filtro
- Al navegar entre Pendientes, Validadas y Folios, el filtro se mantiene

**Código clave** (`renderFoliosTable`):
```javascript
// SINCRONIZACIÓN GLOBAL: La pestaña de Folios usa el filtro global de fecha
let useGlobalFilter = STATE.dateFilter.active && STATE.dateFilter.startDate && STATE.dateFilter.endDate;

if (useGlobalFilter) {
    const startDate = parseDateLocal(STATE.dateFilter.startDate);
    const endDate = parseDateLocal(STATE.dateFilter.endDate);
    // ... filtrar folios
}
```

---

### 2. ✅ Nueva Vista Independiente: Gestión de Folios

**Descripción**: Pantalla adicional para consulta general y administrativa de folios históricos.

**Características**:
- **Acceso**: Solo desde el botón "Gestión de Folios" en la barra lateral (Sidebar)
- **Sin filtro de fecha por defecto**: Muestra TODOS los folios
- **Sin navegación de pestañas**: Diseño limpio con solo título y botón de cierre
- **Filtro opcional**: Puede aplicar filtro de fecha si lo desea

**Nuevo HTML** (`index.html`):
```html
<!-- INDEPENDENT FOLIOS MANAGEMENT VIEW (accessed from sidebar) -->
<div id="folios-management-content" class="tab-content" style="display: none;">
    <div class="header">
        <div class="header-left">
            <h1>📋 Gestión General de Folios</h1>
            <button class="btn btn-secondary date-filter-btn" onclick="showFoliosManagementDateFilter()">
                📅 <span id="folios-mgmt-date-filter-text">Mostrando Todo</span>
            </button>
        </div>
        <div class="header-right">
            <button class="btn-close-modern" onclick="closeFoliosManagementView()" title="Cerrar">×</button>
        </div>
    </div>
    <!-- ... tabla de folios ... -->
</div>
```

**Nuevas funciones JavaScript**:
- `showFoliosManagementView()` - Abre la vista independiente
- `closeFoliosManagementView()` - Cierra y regresa al welcome
- `renderFoliosManagementTable()` - Renderiza tabla sin filtro por defecto
- `loadAllFoliosForManagement()` - Carga todos los folios desde BD
- `viewFolioOrdersFromManagement()` - Ver órdenes desde vista de gestión

---

### 3. ✅ Diferenciación de Pantallas de Folios

| Característica | Pestaña Folios (Regular) | Gestión de Folios (Sidebar) |
|----------------|--------------------------|------------------------------|
| **Acceso** | Navegación de pestañas | Botón en Sidebar |
| **Filtro por defecto** | Usa filtro global (máx 7 días) | Sin filtro (muestra todo) |
| **Navegación** | Con pestañas (Pendientes, Validadas, etc.) | Sin pestañas (vista limpia) |
| **Propósito** | Control del día a día | Consulta histórica/administrativa |

---

### 4. ✅ Corrección de Renderizado de Fechas (-1 día)

**Problema**: El sistema restaba un día al valor seleccionado por el usuario debido a problemas de timezone.

**Causa**: `new Date('YYYY-MM-DD')` interpreta la fecha como UTC, causando offset en zonas horarias negativas.

**Solución**: Nueva función `parseDateLocal()` que parsea fechas como hora local:

```javascript
/**
 * Parsea una fecha en formato YYYY-MM-DD como fecha local (sin timezone offset)
 */
function parseDateLocal(dateStr) {
    if (!dateStr) return new Date();
    
    // Si ya es un objeto Date, retornarlo
    if (dateStr instanceof Date) return dateStr;
    
    // Formato YYYY-MM-DD - parsear como local
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    
    // Formato DD/MM/YYYY
    const partsSlash = dateStr.split('/');
    if (partsSlash.length === 3) {
        return new Date(parseInt(partsSlash[2]), parseInt(partsSlash[1]) - 1, parseInt(partsSlash[0]));
    }
    
    return new Date(dateStr);
}
```

**Función complementaria** para mostrar fechas:
```javascript
/**
 * Formatea una fecha para mostrar en la UI (DD/MM/YYYY)
 */
function formatDateForDisplay(dateStr) {
    if (!dateStr) return '';
    
    const date = parseDateLocal(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    return `${day}/${month}/${year}`;
}
```

---

## 📊 ESTRUCTURA DE ARCHIVOS MODIFICADOS

### `index.html`
- ➕ Agregado nuevo `<div id="folios-management-content">` para vista independiente
- ✅ Tabla con mismas columnas que folios regular
- ✅ Sin navegación de pestañas (diseño limpio)

### `app.js`
- ➕ `FOLIOS_MGMT_DATE_FILTER` - Estado para filtro de vista de gestión
- ➕ `isInFoliosManagementView` - Flag para saber si estamos en vista independiente
- ➕ `showFoliosManagementView()` - Mostrar vista independiente
- ➕ `closeFoliosManagementView()` - Cerrar vista independiente
- ➕ `renderFoliosManagementTable()` - Renderizar tabla de gestión
- ➕ `loadAllFoliosForManagement()` - Cargar todos los folios
- ➕ `viewFolioOrdersFromManagement()` - Ver órdenes desde gestión
- ➕ `updateFoliosManagementBadges()` - Actualizar badges
- ➕ `sortFoliosManagementTable()` - Ordenar tabla
- ➕ `filterFoliosManagementTable()` - Filtrar por texto
- ➕ `parseDateLocal()` - Parsear fechas sin offset
- ➕ `formatDateForDisplay()` - Formatear fechas para UI
- ✏️ `renderFoliosTable()` - Usa filtro global + fix de fechas
- ✏️ `closeFolioDetails()` - Maneja retorno desde gestión
- ✏️ `viewFolioOrders()` - Oculta vista de gestión si está visible
- ✏️ Sidebar button cambiado a `showFoliosManagementView()`

---

## 🎯 FLUJO DE USUARIO

### Flujo Operativo (Día a Día)
```
1. Usuario inicia sesión
2. Selecciona fecha de despacho (filtro global)
3. Navega entre pestañas:
   - Pendientes → Filtro aplicado
   - Validadas → Filtro aplicado
   - Folios → Filtro aplicado (muestra "(Global)")
4. El filtro se mantiene en todas las vistas
```

### Flujo Administrativo (Consulta Histórica)
```
1. Usuario hace clic en "Gestión de Folios" (Sidebar)
2. Se abre vista independiente SIN filtro
3. Ve TODOS los folios históricos
4. Puede aplicar filtro de fecha si lo desea
5. Cierra con botón × y regresa al welcome
```

---

## 🔧 VARIABLES DE ESTADO

```javascript
// Filtro global de fecha (usado por Pendientes, Validadas, Folios regular)
STATE.dateFilter = {
    startDate: '2026-01-01',
    endDate: '2026-01-07',
    active: true
};

// Filtro de Folios regular (fallback si no hay filtro global)
FOLIOS_DATE_FILTER = {
    startDate: null,
    endDate: null,
    active: false
};

// Filtro de Gestión de Folios (vista independiente)
FOLIOS_MGMT_DATE_FILTER = {
    startDate: null,
    endDate: null,
    active: false  // Por defecto NO activo (muestra todo)
};

// Flag para saber si estamos en vista de gestión
isInFoliosManagementView = false;

// Flag para saber si venimos de gestión al ver detalles de folio
STATE.fromFoliosManagement = false;
```

---

## ✅ CHECKLIST DE VERIFICACIÓN

- [x] Filtro global se aplica a Pendientes
- [x] Filtro global se aplica a Validadas
- [x] Filtro global se aplica a Folios (pestaña)
- [x] Vista de Gestión de Folios accesible desde Sidebar
- [x] Vista de Gestión muestra todos los folios por defecto
- [x] Vista de Gestión no tiene navegación de pestañas
- [x] Fechas se muestran correctamente (sin -1 día)
- [x] Botón de cierre en vista de Gestión funciona
- [x] Ver órdenes de folio desde Gestión funciona
- [x] Regresar de detalles de folio va a la vista correcta

---

**Fecha de Implementación**: Enero 6, 2026  
**Versión**: 3.1.0 - Ajustes de Folios y Filtros  
**Estado**: ✅ Implementado
