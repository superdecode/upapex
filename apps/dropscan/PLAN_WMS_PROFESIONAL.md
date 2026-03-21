# Plan de Desarrollo - WMS Profesional con DropScan

**Fecha:** 4 de marzo de 2026  
**Proyecto:** Nuevo sistema WMS profesional iniciando con módulo DropScan  
**Visión:** Base arquitectónica para migración futura de módulos HTML Vanilla existentes

---

## 🎯 VISIÓN ESTRATÉGICA

### Objetivo Principal
Crear un **nuevo sistema WMS profesional** con arquitectura moderna, iniciando con el módulo **DropScan** (escaneo de guías de paquetería), que servirá como **base arquitectónica** para la futura migración de los módulos existentes desarrollados en HTML Vanilla + Google Sheets.

### Módulos Existentes a Migrar (Futuro)
1. **Inventory** - Gestión de inventario con clasificación automática
2. **Track** - Rastreo y consulta de cajas en tiempo real
3. **Validate** - Validación de códigos con estadísticas
4. **Dispatch** - Gestión y validación de órdenes de despacho

### Estrategia de Desarrollo
1. **Fase 1 (Actual):** Desarrollar DropScan con arquitectura profesional completa
2. **Fase 2 (Futuro):** Migrar módulos existentes uno por uno al nuevo sistema
3. **Fase 3 (Futuro):** Sistema WMS unificado con todos los módulos integrados

---

## 🏗️ ARQUITECTURA PROFESIONAL

### Stack Tecnológico

#### Frontend
```
React 18.2
├── Vite 5.0 (Build tool)
├── React Router 6 (Navegación modular)
├── TailwindCSS 3.3 (Estilos)
├── Zustand 4.4 (Estado global compartido)
├── TanStack Query 5.0 (Data fetching)
├── Lucide React (Iconos)
├── Recharts (Gráficas)
└── xlsx (Exportación Excel)
```

#### Backend
```
Node.js 18+
├── Express 4.18
├── JWT (Autenticación propia)
├── bcrypt (Hash de contraseñas)
├── pg (PostgreSQL client)
└── cors, helmet, express-rate-limit
```

#### Base de Datos
```
PostgreSQL 14+
├── Desarrollo: Local
└── Producción: ECS Huawei Cloud (CN-Hong Kong)
```

### Diferencias vs Sistema Actual (HTML Vanilla)

| Aspecto | Sistema Actual | Nuevo WMS |
|---------|---------------|-----------|
| **Frontend** | HTML Vanilla + JS | React + Vite |
| **Autenticación** | Google OAuth | JWT propio + Google OAuth opcional |
| **Base de Datos** | Google Sheets | PostgreSQL |
| **Estado** | localStorage | Zustand + TanStack Query |
| **Usuarios** | Por app (Google) | Sistema centralizado con roles |
| **Módulos** | Apps independientes | Módulos integrados en un sistema |
| **Configuración** | Por app | Compartida globalmente |
| **Deployment** | GitHub Pages | Servidor propio (Huawei Cloud) |

---

## 📐 DISEÑO ARQUITECTÓNICO MODULAR

### Estructura del Proyecto

```
wms-professional/
├── backend/                          # API Node.js + Express
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js          # PostgreSQL config
│   │   │   ├── jwt.js               # JWT config
│   │   │   └── env.js               # Variables entorno
│   │   ├── shared/                  # 🔑 COMPARTIDO ENTRE MÓDULOS
│   │   │   ├── middleware/
│   │   │   │   ├── auth.js          # Autenticación JWT
│   │   │   │   └── permissions.js   # Sistema de permisos
│   │   │   ├── models/
│   │   │   │   ├── User.js          # Modelo usuario
│   │   │   │   └── Role.js          # Modelo rol
│   │   │   └── utils/
│   │   │       ├── validators.js
│   │   │       └── helpers.js
│   │   ├── modules/                 # 🔑 MÓDULOS INDEPENDIENTES
│   │   │   ├── dropscan/            # Módulo DropScan
│   │   │   │   ├── routes/
│   │   │   │   ├── controllers/
│   │   │   │   ├── models/
│   │   │   │   └── services/
│   │   │   ├── inventory/           # (Futuro) Migración Inventory
│   │   │   ├── track/               # (Futuro) Migración Track
│   │   │   ├── validate/            # (Futuro) Migración Validate
│   │   │   └── dispatch/            # (Futuro) Migración Dispatch
│   │   ├── core/                    # 🔑 CORE DEL SISTEMA
│   │   │   ├── routes/
│   │   │   │   ├── auth.routes.js   # Login, logout, refresh
│   │   │   │   ├── users.routes.js  # Gestión usuarios
│   │   │   │   └── roles.routes.js  # Gestión roles
│   │   │   └── controllers/
│   │   └── server.js
│   ├── .env.development
│   ├── .env.production
│   └── package.json
│
├── frontend/                         # React + Vite
│   ├── src/
│   │   ├── core/                    # 🔑 CORE COMPARTIDO
│   │   │   ├── components/
│   │   │   │   ├── layout/
│   │   │   │   │   ├── MainLayout.jsx      # Layout principal
│   │   │   │   │   ├── Sidebar.jsx         # Sidebar global
│   │   │   │   │   ├── Header.jsx          # Header global
│   │   │   │   │   └── ModuleContainer.jsx # Container módulos
│   │   │   │   ├── auth/
│   │   │   │   │   ├── Login.jsx
│   │   │   │   │   └── ProtectedRoute.jsx
│   │   │   │   └── common/
│   │   │   │       ├── Toast.jsx
│   │   │   │       ├── Modal.jsx
│   │   │   │       ├── LoadingSpinner.jsx
│   │   │   │       └── SearchBar.jsx       # 🔍 Búsqueda global
│   │   │   ├── stores/
│   │   │   │   ├── authStore.js            # Auth + permisos
│   │   │   │   ├── uiStore.js              # UI global
│   │   │   │   └── configStore.js          # Config compartida
│   │   │   ├── services/
│   │   │   │   ├── api.js                  # Axios configurado
│   │   │   │   ├── authService.js
│   │   │   │   └── userService.js
│   │   │   ├── hooks/
│   │   │   │   ├── useAuth.js
│   │   │   │   ├── usePermissions.js
│   │   │   │   └── useGlobalSearch.js      # 🔍 Hook búsqueda
│   │   │   └── utils/
│   │   │       ├── formatters.js
│   │   │       └── validators.js
│   │   ├── modules/                 # 🔑 MÓDULOS INDEPENDIENTES
│   │   │   ├── dropscan/            # Módulo DropScan
│   │   │   │   ├── pages/
│   │   │   │   │   ├── Dashboard.jsx
│   │   │   │   │   ├── Escaneo.jsx
│   │   │   │   │   ├── Historial.jsx
│   │   │   │   │   └── Reportes.jsx
│   │   │   │   ├── components/
│   │   │   │   │   ├── EscaneoForm.jsx
│   │   │   │   │   ├── TarimaActiva.jsx
│   │   │   │   │   └── AlertaDuplicado.jsx
│   │   │   │   ├── services/
│   │   │   │   │   ├── tarimasService.js
│   │   │   │   │   └── guiasService.js
│   │   │   │   ├── hooks/
│   │   │   │   │   └── useEscaneo.js
│   │   │   │   ├── stores/
│   │   │   │   │   └── escaneoStore.js
│   │   │   │   └── routes.jsx       # Rutas del módulo
│   │   │   ├── inventory/           # (Futuro)
│   │   │   ├── track/               # (Futuro)
│   │   │   ├── validate/            # (Futuro)
│   │   │   └── dispatch/            # (Futuro)
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx        # Dashboard global
│   │   │   └── Admin.jsx            # Administración
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.development
│   ├── .env.production
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
│
├── database/
│   ├── migrations/                  # Migraciones SQL
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_dropscan_module.sql
│   │   └── 003_inventory_module.sql # (Futuro)
│   └── seeds/                       # Datos iniciales
│       └── initial_data.sql
│
└── docs/
    ├── ARCHITECTURE.md              # Arquitectura completa
    ├── MIGRATION_GUIDE.md           # Guía migración módulos
    ├── API_DOCUMENTATION.md
    └── DEPLOYMENT.md
```

---

## 🔑 PILARES ARQUITECTÓNICOS PARA MIGRACIÓN

### 1. Sistema de Autenticación Unificado

**Actual (HTML Vanilla):**
- Google OAuth por app
- Token en localStorage por app
- Sin gestión centralizada de usuarios

**Nuevo (WMS Profesional):**
```javascript
// authStore.js - COMPARTIDO
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      
      // Login con JWT
      login: async (email, password) => { ... },
      
      // Login con Google (opcional)
      loginWithGoogle: async (googleToken) => { ... },
      
      // Sistema de permisos de 5 niveles
      hasPermission: (module, action) => { ... },
      canView: (module) => { ... },
      canWrite: (module) => { ... },
      canDelete: (module) => { ... },
      canUnlock: (module) => { ... }
    })
  )
)
```

### 2. Gestión Centralizada de Configuraciones

**Actual:**
- Empresas/canales por app
- Sin compartir entre módulos

**Nuevo:**
```javascript
// configStore.js - COMPARTIDO
export const useConfigStore = create((set) => ({
  // Configuraciones globales compartidas
  empresas: [],           // Empresas de paquetería (DropScan)
  canales: [],            // Canales de escaneo (DropScan)
  ubicaciones: [],        // Ubicaciones de almacén (Inventory)
  transportistas: [],     // Transportistas (Dispatch)
  
  // Cargar configuraciones
  loadConfig: async () => { ... }
}))
```

**Base de Datos:**
```sql
-- Tabla compartida de configuraciones
CREATE TABLE configuraciones (
  id SERIAL PRIMARY KEY,
  modulo VARCHAR(50),           -- 'dropscan', 'inventory', etc.
  tipo VARCHAR(50),             -- 'empresa', 'canal', 'ubicacion'
  codigo VARCHAR(50) UNIQUE,
  nombre VARCHAR(100),
  config_json JSONB,            -- Configuración específica
  activo BOOLEAN DEFAULT true
);
```

### 3. Búsqueda Global Rápida

**Implementación:**
```javascript
// useGlobalSearch.js - HOOK COMPARTIDO
export function useGlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  
  const search = useMemo(() => 
    debounce(async (q) => {
      if (!q) return
      
      // Buscar en todos los módulos activos
      const results = await Promise.all([
        searchInDropScan(q),    // Buscar guías
        searchInInventory(q),   // Buscar productos
        searchInTrack(q),       // Buscar cajas
        searchInDispatch(q)     // Buscar órdenes
      ])
      
      setResults(results.flat())
    }, 300),
    []
  )
  
  return { query, setQuery, results, search }
}
```

**UI Component:**
```jsx
// SearchBar.jsx - En Header global
<div className="global-search">
  <input 
    type="text"
    placeholder="🔍 Buscar en todo el sistema..."
    onChange={(e) => search(e.target.value)}
  />
  {results.length > 0 && (
    <SearchResults>
      {results.map(r => (
        <ResultItem 
          module={r.module}
          type={r.type}
          data={r.data}
          onClick={() => navigateToResult(r)}
        />
      ))}
    </SearchResults>
  )}
</div>
```

### 4. Sidebar Modular con Navegación Inteligente

**Configuración por Módulo:**
```javascript
// dropscan/routes.jsx
export const dropScanModule = {
  id: 'dropscan',
  name: 'DropScan',
  icon: '📦',
  basePath: '/dropscan',
  
  // Items del sidebar
  sidebarItems: [
    {
      path: '/dropscan/dashboard',
      label: 'Dashboard',
      icon: Home,
      permission: 'dropscan.ver'
    },
    {
      path: '/dropscan/escaneo',
      label: 'Escaneo',
      icon: Scan,
      permission: 'dropscan.escanear'
    },
    {
      path: '/dropscan/historial',
      label: 'Historial',
      icon: History,
      permission: 'dropscan.ver'
    }
  ],
  
  // Configuraciones internas (no en sidebar)
  internalRoutes: [
    '/dropscan/configuracion/empresas',
    '/dropscan/configuracion/canales'
  ]
}
```

**Sidebar Global:**
```jsx
// Sidebar.jsx
export default function Sidebar() {
  const modules = [dropScanModule, inventoryModule, ...] // Módulos activos
  const { hasPermission } = useAuthStore()
  
  return (
    <aside>
      {/* Sección global */}
      <NavItem to="/" icon={Home}>Dashboard Global</NavItem>
      
      {/* Módulos dinámicos */}
      {modules.map(module => (
        <ModuleSection key={module.id} module={module}>
          {module.sidebarItems
            .filter(item => hasPermission(item.permission))
            .map(item => (
              <NavItem to={item.path} icon={item.icon}>
                {item.label}
              </NavItem>
            ))
          }
        </ModuleSection>
      ))}
      
      {/* Administración */}
      <NavItem to="/admin" icon={Shield}>Administración</NavItem>
    </aside>
  )
}
```

### 5. Sistema de Permisos de 5 Niveles

**Estructura en Base de Datos:**
```sql
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) UNIQUE,
  descripcion TEXT,
  permisos JSONB NOT NULL
);

-- Ejemplo de permisos JSONB:
{
  "dropscan": {
    "dashboard": "lectura",
    "escaneo": "escritura",
    "historial": "gestion",
    "reportes": "total"
  },
  "inventory": {
    "productos": "lectura",
    "stock": "escritura"
  },
  "global": {
    "configuracion": "gestion",
    "administracion": "sin_acceso"
  }
}
```

**Niveles:**
- `sin_acceso` (0): Módulo oculto
- `lectura` (1): Solo ver
- `escritura` (2): Crear y editar
- `gestion` (3): Crear, editar y eliminar
- `total` (4): Control total + desbloquear

### 6. Configuraciones Internas vs Módulos

**Principio:** Minimizar pestañas en sidebar, integrar configuraciones dentro de módulos

**Implementación:**
```jsx
// En lugar de:
// ❌ /configuracion/empresas (pestaña separada)
// ❌ /configuracion/canales (pestaña separada)

// Usar:
// ✅ Modal o panel dentro del módulo
<DropScanPage>
  <Header>
    <button onClick={() => openConfigModal('empresas')}>
      ⚙️ Empresas
    </button>
  </Header>
  
  <ConfigModal type="empresas" />
</DropScanPage>
```

**O ruta interna:**
```
/dropscan/escaneo              # Vista principal
/dropscan/escaneo?config=empresas  # Query param para config
```

---

## 📊 MAPEO DE FUNCIONALIDADES EXISTENTES

### Módulo: Inventory (HTML Vanilla) → Inventory (Nuevo WMS)

| Funcionalidad Actual | Implementación Nueva |
|---------------------|---------------------|
| Google Sheets como BD | PostgreSQL con tabla `productos` |
| Clasificación OK/Blocked/NoWMS | Estados en BD + lógica backend |
| Pallets en localStorage | Tabla `pallets` en PostgreSQL |
| Envío a Google Sheets | API endpoint `/pallets/send` |
| Búsqueda en Map | Búsqueda SQL optimizada con índices |

### Módulo: Track (HTML Vanilla) → Track (Nuevo WMS)

| Funcionalidad Actual | Implementación Nueva |
|---------------------|---------------------|
| Búsqueda en Google Sheets | Búsqueda en PostgreSQL |
| KPIs en tiempo real | TanStack Query con refetch |
| Tabla de resultados | Componente React reutilizable |

### Módulo: Validate (HTML Vanilla) → Validate (Nuevo WMS)

| Funcionalidad Actual | Implementación Nueva |
|---------------------|---------------------|
| Sesiones en localStorage | Tabla `sesiones_validacion` |
| Estadísticas por sesión | Agregación SQL + dashboard |
| Feedback sonoro | Web Audio API (mantener) |

### Módulo: Dispatch (HTML Vanilla) → Dispatch (Nuevo WMS)

| Funcionalidad Actual | Implementación Nueva |
|---------------------|---------------------|
| OBC_BD en Google Sheets | Tabla `ordenes_despacho` |
| Validaciones en localStorage | Tabla `validaciones_despacho` |
| Folios generados | Tabla `folios` con relaciones |
| Filtros avanzados | Query params + SQL dinámico |

---

## 🚀 PLAN DE DESARROLLO - FASE 1: DROPSCAN

### Semana 1-2: Fundación del Sistema

#### Backend Core
- [ ] Configurar proyecto Node.js + Express
- [ ] Configurar PostgreSQL local
- [ ] Implementar sistema JWT
- [ ] Crear middleware de autenticación
- [ ] Crear middleware de permisos (5 niveles)
- [ ] Implementar CRUD de usuarios
- [ ] Implementar CRUD de roles

#### Frontend Core
- [ ] Configurar proyecto React + Vite
- [ ] Configurar TailwindCSS
- [ ] Crear layout principal (MainLayout)
- [ ] Crear Sidebar global
- [ ] Crear Header global con búsqueda
- [ ] Implementar authStore (Zustand)
- [ ] Implementar Login page
- [ ] Implementar ProtectedRoute

#### Base de Datos
- [ ] Crear schema inicial (usuarios, roles)
- [ ] Crear datos seed (roles iniciales, admin)
- [ ] Configurar migraciones

### Semana 3-4: Módulo DropScan - Escaneo

- [ ] Crear schema de DropScan (tarimas, guías, sesiones)
- [ ] Implementar API de sesiones de escaneo
- [ ] Implementar API de escaneo de guías
- [ ] Validación de duplicados (backend)
- [ ] Crear página de Escaneo (frontend)
- [ ] Componente EscaneoForm con auto-focus
- [ ] Componente TarimaActiva (contador 0/100)
- [ ] Alertas visuales y sonoras
- [ ] Auto-cierre a 100 guías

### Semana 5-6: Módulo DropScan - Historial y Reportes

- [ ] Implementar API de consulta de tarimas
- [ ] Implementar API de búsqueda de guías
- [ ] Crear página de Historial
- [ ] Filtros avanzados (fecha, empresa, canal)
- [ ] Detalle de tarima
- [ ] Crear página de Dashboard
- [ ] Métricas en tiempo real
- [ ] Gráficas con Recharts
- [ ] Exportación a Excel

### Semana 7: Configuraciones Internas

- [ ] CRUD de empresas (modal interno)
- [ ] CRUD de canales (modal interno)
- [ ] Integrar configuraciones en módulo DropScan
- [ ] **NO crear pestañas separadas**

### Semana 8: Testing y Optimización

- [ ] Testing de flujo completo
- [ ] Testing de permisos
- [ ] Optimización de queries
- [ ] Testing en móvil/tablet
- [ ] Documentación

---

## 📋 ESTRATEGIA DE MIGRACIÓN FUTURA

### Orden de Migración Recomendado

1. **DropScan** ✅ (Actual - desde cero)
2. **Validate** (Más simple, buen siguiente paso)
3. **Track** (Consulta, sin escritura compleja)
4. **Inventory** (Más complejo, lógica de pallets)
5. **Dispatch** (Más complejo, múltiples BDs)

### Proceso de Migración por Módulo

#### Paso 1: Análisis
- Identificar todas las funcionalidades
- Mapear estructura de datos (Google Sheets → PostgreSQL)
- Identificar dependencias

#### Paso 2: Schema de BD
- Crear tablas necesarias
- Migrar datos existentes (si aplica)
- Crear índices

#### Paso 3: Backend
- Crear rutas del módulo
- Implementar controllers
- Implementar servicios

#### Paso 4: Frontend
- Crear estructura del módulo
- Migrar componentes HTML → React
- Integrar con API

#### Paso 5: Testing
- Comparar funcionalidad con versión antigua
- Validar que no se pierda nada
- Testing de usuarios

### Coexistencia Temporal

Durante la migración, ambos sistemas pueden coexistir:

```
Sistema Actual (HTML Vanilla)
├── inventory.html (activo)
├── track.html (activo)
├── validate.html (activo)
└── dispatch.html (activo)

Sistema Nuevo (WMS Profesional)
├── /dropscan (nuevo)
├── /validate (migrado) ← Primera migración
└── /track (migrado) ← Segunda migración
```

---

## 🔒 CONSIDERACIONES DE SEGURIDAD

### Autenticación
- JWT con expiración de 24h
- Refresh tokens (opcional)
- Bcrypt para passwords (salt rounds: 10)
- Rate limiting en login

### Autorización
- Middleware de permisos en cada ruta
- Validación de permisos en frontend y backend
- Logs de auditoría para acciones críticas

### Base de Datos
- Prepared statements (prevenir SQL injection)
- Índices en columnas frecuentes
- Backups automáticos
- Conexión SSL en producción

---

## 📦 DEPLOYMENT

### Desarrollo
```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

### Producción (Huawei Cloud ECS)
- PostgreSQL en servidor
- Backend con PM2
- Frontend build servido con Nginx
- SSL con Let's Encrypt
- Dominio personalizado

---

## 📝 PRÓXIMOS PASOS INMEDIATOS

1. ✅ **Revisar y aprobar** este plan arquitectónico
2. **Crear estructura** de carpetas base
3. **Configurar** PostgreSQL local
4. **Iniciar desarrollo** de backend core
5. **Iniciar desarrollo** de frontend core
6. **Implementar** módulo DropScan

---

## 🎯 MÉTRICAS DE ÉXITO

### Fase 1 (DropScan)
- [ ] Sistema de autenticación funcional
- [ ] Permisos de 5 niveles implementados
- [ ] DropScan completamente funcional
- [ ] Performance: < 100ms respuesta API
- [ ] Mobile-friendly (tablet)
- [ ] Documentación completa

### Fase 2 (Migración)
- [ ] Al menos 2 módulos migrados
- [ ] Usuarios satisfechos con nueva UI
- [ ] Sin pérdida de funcionalidad
- [ ] Sistema estable en producción

---

**Documento vivo - Se actualizará durante el desarrollo**
