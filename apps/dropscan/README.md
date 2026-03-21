# WMS Profesional - Sistema Modular con DropScan

Sistema de gestión de almacén profesional con arquitectura moderna, iniciando con el módulo **DropScan** para escaneo y trazabilidad de guías de paquetería.

## 🎯 Visión del Proyecto

Este proyecto representa un **nuevo sistema WMS profesional** que:

1. **Inicia** con el módulo DropScan (escaneo de guías)
2. **Establece** la arquitectura base para futuros módulos
3. **Permitirá migrar** los módulos existentes en HTML Vanilla:
   - Inventory (gestión de inventario)
   - Track (rastreo de cajas)
   - Validate (validación de códigos)
   - Dispatch (gestión de despachos)

## 🏗️ Arquitectura

### Stack Tecnológico

**Frontend:**
- React 18 + Vite
- TailwindCSS
- React Router 6
- Zustand (estado global)
- TanStack Query
- Lucide React (iconos)
- Recharts (gráficas)

**Backend:**
- Node.js + Express
- JWT (autenticación propia)
- PostgreSQL
- bcrypt

**Base de Datos:**
- Desarrollo: PostgreSQL local
- Producción: PostgreSQL en ECS Huawei Cloud (CN-Hong Kong)

### Estructura Modular

```
wms-professional/
├── backend/
│   ├── src/
│   │   ├── core/              # Autenticación, usuarios, roles
│   │   ├── shared/            # Middleware, utilidades compartidas
│   │   └── modules/           # Módulos independientes
│   │       ├── dropscan/      # Módulo DropScan
│   │       ├── inventory/     # (Futuro) Migración Inventory
│   │       ├── track/         # (Futuro) Migración Track
│   │       ├── validate/      # (Futuro) Migración Validate
│   │       └── dispatch/      # (Futuro) Migración Dispatch
│   └── server.js
│
└── frontend/
    ├── src/
    │   ├── core/              # Layout, auth, componentes globales
    │   └── modules/           # Módulos independientes
    │       ├── dropscan/      # Módulo DropScan
    │       └── ...            # Futuros módulos
    └── App.jsx
```

## 📦 Módulo DropScan

### Características

- **Escaneo en tiempo real** con validación de duplicados
- **Organización automática** en tarimas de 100 guías
- **Alertas visuales y sonoras** para duplicados y capacidad
- **Historial completo** con trazabilidad
- **Dashboard de productividad** con métricas
- **Búsqueda rápida** integrada
- **Exportación a Excel**

### Flujo de Operación

1. Operador selecciona empresa y canal
2. Sistema crea sesión y primera tarima
3. Escaneo de guías con auto-focus
4. Validación de duplicados en tiempo real
5. Alertas a 90 y 95 guías
6. Auto-cierre a 100 guías
7. Creación automática de nueva tarima

## 🔐 Sistema de Permisos (5 Niveles)

| Nivel | Nombre | Descripción |
|-------|--------|-------------|
| 0 | `sin_acceso` | Sin acceso al módulo |
| 1 | `lectura` | Solo visualización |
| 2 | `escritura` | Crear y editar |
| 3 | `gestion` | Crear, editar y eliminar |
| 4 | `total` | Control total + desbloquear |

### Roles Predefinidos

- **Administrador:** Acceso total
- **Jefe:** Gestión completa (nivel 3)
- **Operador:** Escaneo y edición (nivel 2)
- **Usuario:** Solo consulta (nivel 1)

## 🚀 Instalación

### Prerrequisitos

- Node.js 18+
- PostgreSQL 14+
- npm o yarn

### 1. Configurar Base de Datos

```bash
# Crear base de datos
createdb wms_dev

# Ejecutar schema
psql -d wms_dev -f database/schema_modular.sql
```

### 2. Configurar Backend

```bash
cd backend
npm install

# Crear .env.development
cp .env.example .env.development
```

Editar `.env.development`:
```env
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=wms_dev
DB_USER=postgres
DB_PASSWORD=tu_password
JWT_SECRET=dev_secret_key
JWT_EXPIRES_IN=24h
```

```bash
# Iniciar servidor
npm run dev
```

### 3. Configurar Frontend

```bash
cd frontend
npm install

# Crear .env.development
echo "VITE_API_URL=http://localhost:3001/api" > .env.development

# Iniciar aplicación
npm run dev
```

Aplicación disponible en `http://localhost:5173`

## 📚 Documentación

- **[PLAN_WMS_PROFESIONAL.md](PLAN_WMS_PROFESIONAL.md)** - Plan completo del proyecto
- **[docs/MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md)** - Guía de migración de módulos
- **[docs/PERMISOS_5_NIVELES.md](docs/PERMISOS_5_NIVELES.md)** - Sistema de permisos
- **[docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md)** - Documentación de API
- **[database/schema_modular.sql](database/schema_modular.sql)** - Schema de base de datos

## 🔑 Pilares Arquitectónicos

### 1. Autenticación Unificada
- JWT propio para control total
- Google OAuth opcional
- Sistema centralizado de usuarios

### 2. Configuraciones Compartidas
- Tabla `configuraciones` modular
- Empresas, canales, ubicaciones compartidas
- Sin duplicación entre módulos

### 3. Búsqueda Global
- Hook `useGlobalSearch` compartido
- Búsqueda en todos los módulos activos
- Resultados unificados

### 4. Sidebar Modular
- Navegación dinámica por módulos
- Configuraciones internas (no pestañas separadas)
- Permisos por item

### 5. Permisos de 5 Niveles
- Granularidad mejorada vs 4 niveles
- Nivel `gestion` para eliminar sin desbloquear
- Nivel `total` para operaciones críticas

## 🔄 Migración Futura

### Orden Recomendado

1. ✅ **DropScan** (Actual - Base del sistema)
2. **Validate** (Simple, buena práctica)
3. **Track** (Solo lectura)
4. **Inventory** (Lógica compleja)
5. **Dispatch** (Más complejo)

### Proceso por Módulo

1. Análisis de funcionalidades
2. Diseño de schema de BD
3. Migración de datos
4. Desarrollo backend
5. Desarrollo frontend
6. Testing y validación

Ver [MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md) para detalles.

## 🎨 Principios de Diseño

### Minimizar Pestañas
- Configuraciones dentro de módulos (modales/panels)
- Búsquedas como componentes integrados
- No crear pestañas para funcionalidades pequeñas

### Modularidad
- Módulos independientes pero integrados
- Código compartido en `core/` y `shared/`
- Fácil agregar/quitar módulos

### Escalabilidad
- Preparado para múltiples módulos
- Base de datos modular
- API RESTful con estructura clara

## 📊 Base de Datos

### Tablas Core (Compartidas)
- `usuarios` - Usuarios del sistema
- `roles` - Roles con permisos JSONB
- `configuraciones` - Configuraciones modulares

### Tablas DropScan
- `tarimas` - Tarimas de 100 guías
- `guias` - Guías escaneadas
- `sesiones_escaneo` - Sesiones de operadores
- `alertas_duplicados` - Registro de duplicados

### Tablas Futuras
- `productos` (Inventory)
- `pallets` (Inventory)
- `ordenes_despacho` (Dispatch)
- `folios` (Dispatch)
- etc.

## 🔒 Seguridad

- JWT con expiración de 24h
- Bcrypt para passwords (10 rounds)
- Middleware de autenticación en todas las rutas
- Middleware de permisos por acción
- Rate limiting en login
- Prepared statements (SQL injection prevention)
- Logs de auditoría

## 📱 Mobile-Friendly

- Diseño responsive con TailwindCSS
- Optimizado para tablets
- Auto-focus en inputs de escaneo
- Botones grandes para touch
- Feedback visual y sonoro

## 🚢 Deployment

### Desarrollo
```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

### Producción (Huawei Cloud)
- PostgreSQL en servidor
- Backend con PM2
- Frontend build con Nginx
- SSL con Let's Encrypt
- Dominio personalizado

## 🧪 Testing

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test
```

## 📝 Próximos Pasos

1. ✅ Revisar y aprobar plan arquitectónico
2. Crear estructura de carpetas
3. Configurar PostgreSQL local
4. Desarrollar backend core
5. Desarrollar frontend core
6. Implementar módulo DropScan

## 🤝 Contribución

Proyecto interno. Para cambios:
1. Crear rama desde `main`
2. Realizar cambios
3. Pull Request
4. Revisión técnica

## 📄 Licencia

Propiedad privada - Todos los derechos reservados

---

**Versión:** 1.0.0  
**Última actualización:** 4 de marzo de 2026  
**Equipo:** Desarrollo WMS
