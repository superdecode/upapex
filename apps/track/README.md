# Sistema de Trazabilidad de Guías (Track)

Sistema web para el registro y trazabilidad de guías de paquetería mediante escaneo de códigos. Organiza las guías en tarimas de 100 paquetes, permitiendo control operativo en tiempo real e historial completo de operaciones.

## 📋 Características Principales

- **Escaneo en tiempo real** con validación de duplicados
- **Organización automática** en tarimas de 100 guías
- **Alertas visuales y sonoras** para duplicados y capacidad
- **Historial completo** de operaciones con trazabilidad
- **Dashboard de productividad** con métricas en tiempo real
- **Sistema de permisos de 5 niveles** para control granular
- **Búsqueda rápida** de guías individuales
- **Exportación a Excel** de reportes

## 🛠 Stack Técnico

### Frontend
- React 18
- Vite
- TailwindCSS
- React Router 6
- Zustand (estado global)
- TanStack Query (React Query)
- Lucide React (iconos)
- Recharts (gráficas)
- xlsx (exportación Excel)

### Backend
- Node.js
- Express
- JWT (autenticación propia)
- PostgreSQL
- bcrypt (hash de contraseñas)

### Base de Datos
- **Desarrollo:** PostgreSQL local
- **Producción:** PostgreSQL en ECS Huawei Cloud (CN-Hong Kong)

## 📁 Estructura del Proyecto

```
track/
├── backend/              # API Node.js + Express
│   ├── src/
│   │   ├── config/      # Configuración DB y env
│   │   ├── middleware/  # Auth y permisos
│   │   ├── routes/      # Rutas de API
│   │   ├── controllers/ # Lógica de negocio
│   │   └── server.js
│   └── package.json
│
├── frontend/            # React + Vite
│   ├── src/
│   │   ├── components/  # Componentes React
│   │   ├── pages/       # Páginas
│   │   ├── stores/      # Zustand stores
│   │   ├── services/    # API services
│   │   ├── hooks/       # Custom hooks
│   │   └── utils/       # Utilidades
│   └── package.json
│
├── database/            # Scripts SQL
│   └── schema.sql       # Esquema completo
│
└── docs/                # Documentación
    ├── PERMISOS_5_NIVELES.md
    ├── API_ENDPOINTS.md
    └── PLAN_DESARROLLO_TRACK.md
```

## 🚀 Instalación y Configuración

### Prerrequisitos
- Node.js 18+
- PostgreSQL 14+
- npm o yarn

### 1. Configurar Base de Datos

```bash
# Crear base de datos
createdb track_dev

# Ejecutar schema
psql -d track_dev -f database/schema.sql
```

### 2. Configurar Backend

```bash
cd backend
npm install

# Crear archivo .env.development
cp .env.example .env.development
```

**Editar `.env.development`:**
```env
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=track_dev
DB_USER=postgres
DB_PASSWORD=tu_password
JWT_SECRET=dev_secret_key_change_in_production
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

# Crear archivo .env.development
echo "VITE_API_URL=http://localhost:3001/api" > .env.development

# Iniciar aplicación
npm run dev
```

La aplicación estará disponible en `http://localhost:5173`

## 👥 Sistema de Permisos (5 Niveles)

El sistema implementa un control de acceso granular con 5 niveles:

| Nivel | Nombre | Permisos |
|-------|--------|----------|
| 0 | `sin_acceso` | Sin acceso al módulo |
| 1 | `lectura` | Solo visualización |
| 2 | `escritura` | Crear y editar (no eliminar) |
| 3 | `gestion` | Crear, editar y eliminar |
| 4 | `total` | Control total + desbloquear |

### Roles Predefinidos

#### Usuario (Consulta)
- Dashboard: lectura
- Historial: lectura
- Búsqueda: lectura

#### Operador
- Dashboard: lectura
- Escaneo: escritura (puede escanear, no eliminar)
- Historial: lectura
- Búsqueda: lectura

#### Jefe/Supervisor
- Dashboard: lectura
- Escaneo: gestion (puede escanear y eliminar)
- Historial: gestion
- Reportes: escritura (puede exportar)
- Configuración: escritura

#### Administrador
- Todos los módulos: total

Ver documentación completa en [`docs/PERMISOS_5_NIVELES.md`](docs/PERMISOS_5_NIVELES.md)

## 📱 Módulos del Sistema

### 1. Escaneo y Armado de Tarimas
- Selección de empresa y canal
- Escaneo con auto-focus
- Validación de duplicados en tiempo real
- Alertas visuales y sonoras
- Auto-cierre a 100 guías
- Creación automática de nueva tarima

### 2. Historial y Trazabilidad
- Listado de tarimas con filtros
- Detalle completo de cada tarima
- Visualización de todas las guías
- Timestamps exactos de escaneo
- Información de operador

### 3. Búsqueda de Guías
- Búsqueda rápida por código
- Localización de tarima
- Información de escaneo
- Operador responsable

### 4. Dashboard de Productividad
- Resumen del día actual
- Gráficas de productividad
- Métricas de eficiencia
- Tiempo promedio de armado
- Velocidad de escaneo

### 5. Reportes
- Métricas por rango de fechas
- Exportación a Excel
- Comparativas por operador
- Análisis por empresa/canal

### 6. Configuración
- Gestión de empresas de paquetería
- Gestión de canales
- Parámetros del sistema

### 7. Administración
- Gestión de usuarios
- Gestión de roles y permisos
- Auditoría de accesos

## 🔐 Autenticación

El sistema utiliza JWT (JSON Web Tokens) para autenticación:

1. Login con email y contraseña
2. Generación de token JWT (válido 24h)
3. Token almacenado en localStorage
4. Header `Authorization: Bearer <token>` en cada request
5. Validación en middleware de backend

**Usuario administrador inicial:**
- Email: `admin@track.com`
- Password: `admin123` (⚠️ CAMBIAR EN PRODUCCIÓN)

## 📊 Base de Datos

### Tablas Principales

- **usuarios** - Usuarios del sistema
- **roles** - Roles con permisos JSONB
- **empresas_paqueteria** - Empresas destino (DHL, FedEx, etc.)
- **canales** - Canales de escaneo
- **tarimas** - Tarimas de 100 guías
- **guias** - Guías escaneadas
- **sesiones_escaneo** - Sesiones de operadores
- **alertas_duplicados** - Registro de duplicados

Ver esquema completo en [`database/schema.sql`](database/schema.sql)

## 🌐 API Endpoints

Documentación completa de endpoints en [`docs/API_ENDPOINTS.md`](docs/API_ENDPOINTS.md)

### Principales Endpoints

```
POST   /api/auth/login              # Login
GET    /api/auth/me                 # Usuario actual

POST   /api/sesiones/start          # Iniciar sesión de escaneo
POST   /api/sesiones/:id/scan       # Escanear guía
POST   /api/sesiones/:id/end        # Finalizar sesión

GET    /api/tarimas                 # Listar tarimas
GET    /api/tarimas/:id             # Detalle de tarima
DELETE /api/tarimas/:id             # Eliminar tarima
POST   /api/tarimas/:id/unlock      # Desbloquear tarima

GET    /api/guias/search            # Buscar guías
DELETE /api/guias/:id               # Eliminar guía

GET    /api/reportes/dashboard      # Métricas dashboard
GET    /api/reportes/metricas       # Métricas con filtros
POST   /api/reportes/export         # Exportar Excel

GET    /api/empresas                # Listar empresas
GET    /api/canales                 # Listar canales
GET    /api/usuarios                # Listar usuarios
GET    /api/roles                   # Listar roles
```

## 📱 UX/UI - Consideraciones Móviles

La interfaz de escaneo está optimizada para tablets y dispositivos móviles:

- **Auto-focus** en campo de escaneo
- **Botones grandes** para touch
- **Fuentes grandes** para lectura en bodega
- **Feedback visual inmediato** (colores)
- **Feedback sonoro** (beeps)
- **Responsive design** con TailwindCSS

## 🚢 Deployment

### Desarrollo Local
```bash
# Backend
cd backend && npm run dev

# Frontend
cd frontend && npm run dev
```

### Producción (Huawei Cloud ECS)

1. **Configurar PostgreSQL en servidor**
2. **Configurar variables de entorno de producción**
3. **Build del frontend:**
   ```bash
   cd frontend
   npm run build
   ```
4. **Servir frontend con Nginx**
5. **Backend con PM2:**
   ```bash
   cd backend
   pm2 start server.js --name track-api
   ```
6. **Configurar dominio y SSL**

## 📝 Plan de Desarrollo

Ver plan detallado en [`PLAN_DESARROLLO_TRACK.md`](PLAN_DESARROLLO_TRACK.md)

### Fases de Desarrollo (8 semanas)

1. **Semana 1:** Configuración inicial + Autenticación
2. **Semana 2-3:** Módulo de Escaneo
3. **Semana 3-4:** Módulo de Historial
4. **Semana 4-5:** Dashboard y Reportes
5. **Semana 5-6:** Configuración y Administración
6. **Semana 6-7:** Testing y Optimización
7. **Semana 7-8:** Preparación para Producción

## 🧪 Testing

```bash
# Backend
cd backend
npm test

# Frontend
cd frontend
npm test
```

## 📖 Documentación Adicional

- [Plan de Desarrollo Completo](PLAN_DESARROLLO_TRACK.md)
- [Sistema de Permisos de 5 Niveles](docs/PERMISOS_5_NIVELES.md)
- [API Endpoints](docs/API_ENDPOINTS.md)
- [Esquema de Base de Datos](database/schema.sql)

## 🤝 Contribución

Este es un proyecto interno. Para cambios:

1. Crear rama desde `main`
2. Realizar cambios
3. Crear Pull Request
4. Revisión por equipo técnico

## 📄 Licencia

Propiedad privada - Todos los derechos reservados

## 📞 Soporte

Para soporte técnico, contactar al equipo de desarrollo.

---

**Versión:** 1.0.0  
**Última actualización:** 4 de marzo de 2026
