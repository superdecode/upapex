# Guía de Migración - HTML Vanilla a WMS Profesional

**Propósito:** Documentar el proceso de migración de módulos existentes (HTML Vanilla + Google Sheets) al nuevo sistema WMS profesional (React + PostgreSQL)

---

## 📋 ANÁLISIS DE MÓDULOS EXISTENTES

### 1. Inventory (Gestión de Inventario)

#### Funcionalidades Actuales
- **Autenticación:** Google OAuth
- **Carga de datos:** Google Sheets API (hoja "Inventario")
- **Escaneo:** Input con auto-focus
- **Clasificación:** OK, Blocked, NoWMS
- **Pallets:** 3 columnas con límite de 100 cajas cada una
- **Validación:** Búsqueda en Map con variantes (/, -)
- **Envío:** Append a Google Sheets (hoja "Envios")
- **Feedback:** Sonidos, animaciones, notificaciones
- **Persistencia:** localStorage

#### Estructura de Datos (Google Sheets)
```
Hoja: Inventario
Columnas: Código, SKU, Producto, Ubicación, Stock, Estado, Almacén, Actualización

Hoja: Envios
Columnas: PalletID, Código, Ubicación Destino, Categoría, Timestamp, Usuario
```

#### Migración a PostgreSQL
```sql
-- Tabla productos (equivalente a hoja Inventario)
CREATE TABLE productos (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(100) UNIQUE NOT NULL,
  sku VARCHAR(100),
  nombre VARCHAR(200),
  ubicacion VARCHAR(50),
  stock INTEGER,
  estado VARCHAR(20),
  almacen VARCHAR(50),
  actualizado_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla pallets
CREATE TABLE pallets (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  categoria VARCHAR(20) CHECK (categoria IN ('ok', 'blocked', 'nowms')),
  estado VARCHAR(20) DEFAULT 'EN_PROCESO',
  cantidad_cajas INTEGER DEFAULT 0,
  operador_id INTEGER REFERENCES usuarios(id),
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_envio TIMESTAMP
);

-- Tabla cajas_pallet
CREATE TABLE cajas_pallet (
  id SERIAL PRIMARY KEY,
  pallet_id INTEGER REFERENCES pallets(id) ON DELETE CASCADE,
  producto_id INTEGER REFERENCES productos(id),
  codigo_caja VARCHAR(100),
  ubicacion_destino VARCHAR(50),
  posicion INTEGER,
  timestamp_escaneo TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para búsqueda rápida
CREATE INDEX idx_productos_codigo ON productos(codigo);
CREATE INDEX idx_productos_ubicacion ON productos(ubicacion);
CREATE INDEX idx_cajas_pallet_codigo ON cajas_pallet(codigo_caja);
```

#### Componentes React a Crear
```
inventory/
├── pages/
│   └── InventoryPage.jsx          # Página principal
├── components/
│   ├── ScanInput.jsx               # Input de escaneo
│   ├── PalletColumn.jsx            # Columna de pallet
│   ├── BoxItem.jsx                 # Item de caja
│   └── SendPalletModal.jsx         # Modal de envío
├── services/
│   ├── inventoryService.js         # API calls
│   └── palletService.js
├── hooks/
│   └── useInventoryScan.js         # Lógica de escaneo
└── stores/
    └── inventoryStore.js           # Estado del módulo
```

---

### 2. Track (Rastreo de Cajas)

#### Funcionalidades Actuales
- **Búsqueda:** Input de código
- **Fuente de datos:** Google Sheets (hoja "Inventario")
- **Resultados:** Tabla con detalles
- **KPIs:** Total cajas, ubicaciones, almacenes
- **Normalización:** Variantes de código (/, -)

#### Migración a PostgreSQL
```sql
-- Reutiliza tabla productos del módulo Inventory
-- Agregar tabla de historial de movimientos si es necesario

CREATE TABLE movimientos_producto (
  id SERIAL PRIMARY KEY,
  producto_id INTEGER REFERENCES productos(id),
  tipo_movimiento VARCHAR(50),
  ubicacion_origen VARCHAR(50),
  ubicacion_destino VARCHAR(50),
  cantidad INTEGER,
  operador_id INTEGER REFERENCES usuarios(id),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Componentes React a Crear
```
track/
├── pages/
│   └── TrackPage.jsx               # Página de búsqueda
├── components/
│   ├── SearchBar.jsx               # Barra de búsqueda
│   ├── ResultsTable.jsx            # Tabla de resultados
│   └── KPICards.jsx                # Tarjetas de métricas
├── services/
│   └── trackService.js
└── hooks/
    └── useTrackSearch.js
```

---

### 3. Validate (Validador de Códigos)

#### Funcionalidades Actuales
- **Sesiones:** Inicio/fin de sesión de validación
- **Validación:** Escaneo contra BD
- **Estadísticas:** Valid/Invalid por sesión
- **Feedback:** Visual + sonoro
- **Persistencia:** localStorage

#### Migración a PostgreSQL
```sql
CREATE TABLE sesiones_validacion (
  id SERIAL PRIMARY KEY,
  operador_id INTEGER REFERENCES usuarios(id),
  fecha_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  fecha_fin TIMESTAMP,
  total_validaciones INTEGER DEFAULT 0,
  codigos_validos INTEGER DEFAULT 0,
  codigos_invalidos INTEGER DEFAULT 0,
  activa BOOLEAN DEFAULT true
);

CREATE TABLE validaciones (
  id SERIAL PRIMARY KEY,
  sesion_id INTEGER REFERENCES sesiones_validacion(id),
  codigo VARCHAR(100),
  es_valido BOOLEAN,
  producto_id INTEGER REFERENCES productos(id),
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Componentes React a Crear
```
validate/
├── pages/
│   └── ValidatePage.jsx
├── components/
│   ├── SessionControl.jsx          # Inicio/fin sesión
│   ├── ValidationInput.jsx         # Input validación
│   ├── StatsDisplay.jsx            # Estadísticas
│   └── ValidationHistory.jsx       # Historial
├── services/
│   └── validateService.js
└── stores/
    └── validateStore.js
```

---

### 4. Dispatch (Gestión de Despachos)

#### Funcionalidades Actuales
- **Búsqueda:** Órdenes en Google Sheets (OBC_BD)
- **Validación:** Marcar órdenes como validadas
- **Folios:** Generación de folios de carga
- **Filtros:** Por destino, conductor, unidad, fecha
- **Estados:** Pendiente, Validada, Cancelada, No Procesable
- **Múltiples hojas:** OBC_BD, VALIDADAS_BD, CANCELADAS_BD, FOLIOS_BD

#### Migración a PostgreSQL
```sql
CREATE TABLE ordenes_despacho (
  id SERIAL PRIMARY KEY,
  numero_orden VARCHAR(50) UNIQUE NOT NULL,
  destino VARCHAR(100),
  horario VARCHAR(50),
  referencia VARCHAR(100),
  tracking VARCHAR(100),
  cantidad_cajas INTEGER,
  cantidad_despachar INTEGER,
  porcentaje_surtido DECIMAL(5,2),
  estatus VARCHAR(50),
  calidad VARCHAR(50),
  estado VARCHAR(20) DEFAULT 'PENDIENTE',
  fecha_orden DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE validaciones_despacho (
  id SERIAL PRIMARY KEY,
  orden_id INTEGER REFERENCES ordenes_despacho(id),
  operador_id INTEGER REFERENCES usuarios(id),
  conductor VARCHAR(100),
  unidad VARCHAR(50),
  folio_id INTEGER REFERENCES folios(id),
  fecha_validacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  observaciones TEXT
);

CREATE TABLE folios (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  destino VARCHAR(100),
  conductor VARCHAR(100),
  unidad VARCHAR(50),
  horario_inicial VARCHAR(50),
  horario_final VARCHAR(50),
  cantidad_ordenes INTEGER DEFAULT 0,
  cantidad_cajas INTEGER DEFAULT 0,
  fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  operador_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE ordenes_folio (
  id SERIAL PRIMARY KEY,
  folio_id INTEGER REFERENCES folios(id) ON DELETE CASCADE,
  orden_id INTEGER REFERENCES ordenes_despacho(id),
  posicion INTEGER
);
```

#### Componentes React a Crear
```
dispatch/
├── pages/
│   ├── DispatchPage.jsx            # Página principal
│   ├── FoliosPage.jsx              # Gestión de folios
│   └── FolioDetailPage.jsx         # Detalle de folio
├── components/
│   ├── OrderSearch.jsx             # Búsqueda de órdenes
│   ├── OrdersTable.jsx             # Tabla de órdenes
│   ├── ValidationModal.jsx         # Modal de validación
│   ├── FolioGenerator.jsx          # Generador de folios
│   └── AdvancedFilters.jsx         # Filtros avanzados
├── services/
│   ├── dispatchService.js
│   └── folioService.js
└── stores/
    └── dispatchStore.js
```

---

## 🔄 PROCESO DE MIGRACIÓN PASO A PASO

### Fase 1: Preparación

#### 1.1 Análisis del Módulo
```
✓ Documentar todas las funcionalidades
✓ Identificar flujos de usuario
✓ Mapear estructura de datos
✓ Identificar dependencias con otros módulos
✓ Listar configuraciones necesarias
```

#### 1.2 Diseño de Base de Datos
```sql
-- Crear archivo de migración
-- database/migrations/00X_nombre_modulo.sql

-- 1. Crear tablas
CREATE TABLE ...

-- 2. Crear índices
CREATE INDEX ...

-- 3. Crear triggers/funciones si es necesario
CREATE FUNCTION ...

-- 4. Insertar datos iniciales
INSERT INTO ...
```

#### 1.3 Migración de Datos (si aplica)
```javascript
// scripts/migrate-google-sheets-data.js

// 1. Conectar a Google Sheets
// 2. Leer datos existentes
// 3. Transformar formato
// 4. Insertar en PostgreSQL
// 5. Validar integridad
```

### Fase 2: Backend

#### 2.1 Estructura del Módulo
```
backend/src/modules/[nombre]/
├── routes/
│   └── index.js                    # Rutas del módulo
├── controllers/
│   ├── [nombre].controller.js      # Lógica de negocio
│   └── config.controller.js        # Configuraciones
├── models/
│   └── queries.js                  # Queries SQL
└── services/
    └── [nombre].service.js         # Servicios auxiliares
```

#### 2.2 Implementar Rutas
```javascript
// routes/index.js
const express = require('express')
const router = express.Router()
const { authenticateToken } = require('../../../shared/middleware/auth')
const { requirePermission } = require('../../../shared/middleware/permissions')
const controller = require('../controllers/[nombre].controller')

// Ejemplo: Inventory
router.get('/productos', 
  authenticateToken,
  requirePermission('inventory.ver'),
  controller.getProductos
)

router.post('/pallets', 
  authenticateToken,
  requirePermission('inventory.crear'),
  controller.createPallet
)

module.exports = router
```

#### 2.3 Implementar Controllers
```javascript
// controllers/[nombre].controller.js
const queries = require('../models/queries')

exports.getProductos = async (req, res) => {
  try {
    const productos = await queries.getAllProductos()
    res.json({ productos })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}
```

### Fase 3: Frontend

#### 3.1 Estructura del Módulo
```
frontend/src/modules/[nombre]/
├── pages/                          # Páginas del módulo
├── components/                     # Componentes específicos
├── services/                       # API calls
├── hooks/                          # Custom hooks
├── stores/                         # Estado local del módulo
└── routes.jsx                      # Configuración de rutas
```

#### 3.2 Configuración de Rutas
```javascript
// routes.jsx
import { lazy } from 'react'

const InventoryPage = lazy(() => import('./pages/InventoryPage'))

export const inventoryModule = {
  id: 'inventory',
  name: 'Inventario',
  icon: '📦',
  basePath: '/inventory',
  
  routes: [
    {
      path: '/inventory',
      element: <InventoryPage />,
      permission: 'inventory.ver'
    }
  ],
  
  sidebarItems: [
    {
      path: '/inventory',
      label: 'Gestión',
      icon: Package,
      permission: 'inventory.ver'
    }
  ]
}
```

#### 3.3 Migrar Lógica HTML → React

**Antes (HTML Vanilla):**
```javascript
// app.js
function processScan() {
  const code = document.getElementById('scan-input').value
  const item = STATE.inventory.get(normalizeCode(code))
  
  if (item) {
    addBox('ok', { code, item })
    updateUI()
  } else {
    showNotification('Código no encontrado', 'error')
  }
}
```

**Después (React):**
```javascript
// useInventoryScan.js
export function useInventoryScan() {
  const [code, setCode] = useState('')
  const { data: productos } = useQuery(['productos'], getProductos)
  const addBoxMutation = useMutation(addBox)
  
  const processScan = useCallback(async () => {
    const normalized = normalizeCode(code)
    const producto = productos.find(p => p.codigo === normalized)
    
    if (producto) {
      await addBoxMutation.mutateAsync({
        categoria: 'ok',
        codigo: normalized,
        producto
      })
      toast.success('Caja agregada')
    } else {
      toast.error('Código no encontrado')
    }
    
    setCode('')
  }, [code, productos])
  
  return { code, setCode, processScan }
}

// InventoryPage.jsx
export default function InventoryPage() {
  const { code, setCode, processScan } = useInventoryScan()
  
  return (
    <div>
      <input 
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && processScan()}
        autoFocus
      />
    </div>
  )
}
```

### Fase 4: Testing

#### 4.1 Comparación de Funcionalidades
```
Checklist de Validación:
□ Todas las funcionalidades migradas
□ Performance igual o mejor
□ UI/UX mejorada
□ Sin pérdida de datos
□ Permisos funcionando correctamente
□ Feedback visual/sonoro mantenido
□ Mobile responsive
```

#### 4.2 Testing con Usuarios
```
1. Seleccionar usuarios beta
2. Capacitación en nuevo sistema
3. Uso paralelo (viejo + nuevo)
4. Recolectar feedback
5. Ajustes necesarios
6. Migración completa
```

---

## 🔧 HERRAMIENTAS DE MIGRACIÓN

### Script de Migración de Datos

```javascript
// scripts/migrate-module-data.js
const { google } = require('googleapis')
const { Pool } = require('pg')

async function migrateInventoryData() {
  // 1. Conectar a Google Sheets
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Inventario!A2:H'
  })
  
  // 2. Conectar a PostgreSQL
  const pool = new Pool({ /* config */ })
  
  // 3. Transformar y migrar
  const rows = response.data.values
  for (const row of rows) {
    await pool.query(`
      INSERT INTO productos (codigo, sku, nombre, ubicacion, stock, estado, almacen)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (codigo) DO UPDATE SET
        sku = EXCLUDED.sku,
        nombre = EXCLUDED.nombre,
        ubicacion = EXCLUDED.ubicacion,
        stock = EXCLUDED.stock,
        estado = EXCLUDED.estado,
        almacen = EXCLUDED.almacen,
        actualizado_at = CURRENT_TIMESTAMP
    `, [row[0], row[1], row[2], row[3], row[4], row[5], row[6]])
  }
  
  console.log(`✅ Migrados ${rows.length} productos`)
}
```

### Validador de Migración

```javascript
// scripts/validate-migration.js

async function validateMigration(moduleName) {
  console.log(`🔍 Validando migración de ${moduleName}...`)
  
  // 1. Contar registros en Google Sheets
  const sheetsCount = await countGoogleSheetsRecords()
  
  // 2. Contar registros en PostgreSQL
  const pgCount = await countPostgreSQLRecords()
  
  // 3. Comparar
  if (sheetsCount === pgCount) {
    console.log(`✅ Migración completa: ${pgCount} registros`)
  } else {
    console.error(`❌ Discrepancia: Sheets=${sheetsCount}, PG=${pgCount}`)
  }
  
  // 4. Validar integridad de datos
  await validateDataIntegrity()
}
```

---

## 📊 ORDEN DE MIGRACIÓN RECOMENDADO

### 1. DropScan (Nuevo - Base del sistema)
**Prioridad:** Alta  
**Complejidad:** Media  
**Tiempo estimado:** 8 semanas  
**Estado:** En desarrollo

### 2. Validate (Primera migración)
**Prioridad:** Alta  
**Complejidad:** Baja  
**Tiempo estimado:** 2 semanas  
**Razón:** Módulo simple, buena práctica para proceso de migración

### 3. Track (Segunda migración)
**Prioridad:** Media  
**Complejidad:** Baja  
**Tiempo estimado:** 2 semanas  
**Razón:** Solo lectura, sin lógica compleja de escritura

### 4. Inventory (Tercera migración)
**Prioridad:** Alta  
**Complejidad:** Alta  
**Tiempo estimado:** 4 semanas  
**Razón:** Lógica compleja de pallets, clasificación, envíos

### 5. Dispatch (Cuarta migración)
**Prioridad:** Alta  
**Complejidad:** Muy Alta  
**Tiempo estimado:** 5 semanas  
**Razón:** Múltiples hojas, folios, validaciones complejas

---

## ✅ CHECKLIST DE MIGRACIÓN

### Pre-Migración
- [ ] Análisis completo del módulo
- [ ] Diseño de schema de BD
- [ ] Aprobación de stakeholders
- [ ] Backup de datos existentes

### Durante Migración
- [ ] Desarrollo de backend
- [ ] Desarrollo de frontend
- [ ] Testing unitario
- [ ] Testing de integración
- [ ] Migración de datos

### Post-Migración
- [ ] Testing con usuarios
- [ ] Capacitación
- [ ] Documentación actualizada
- [ ] Monitoreo de errores
- [ ] Feedback y ajustes

---

**Documento vivo - Se actualizará con cada migración**
