# Plan de Desarrollo - Sistema de Trazabilidad de Guías (Track)

**Fecha de creación:** 4 de marzo de 2026  
**Proyecto:** Sistema de registro y trazabilidad de guías de paquetería mediante escaneo de códigos  
**Base de diseño:** muqui/inventario-app

---

## 1. RESUMEN EJECUTIVO

### 1.1 Objetivo del Sistema
Desarrollar una aplicación web para el registro y trazabilidad de guías de paquetería mediante escaneo de códigos. El sistema organiza las guías en tarimas de 100 paquetes, permitiendo control operativo en tiempo real e historial completo de operaciones.

### 1.2 Stack Técnico Definido
- **Frontend:** React 18 + Vite + TailwindCSS + React Router 6
- **Backend:** Node.js + Express + JWT (autenticación propia sin dependencias externas)
- **Base de datos desarrollo:** PostgreSQL local
- **Base de datos producción:** PostgreSQL en servidor ECS Huawei Cloud (CN-Hong Kong)
- **Estado global:** Zustand con persistencia
- **Queries:** TanStack Query (React Query)
- **Iconos:** Lucide React
- **Exportación:** xlsx (Excel)

### 1.3 Diferencias Clave vs Muqui
1. **Base de datos:** PostgreSQL en lugar de Firebase/Firestore
2. **Autenticación:** JWT propio en lugar de Firebase Auth
3. **Permisos:** Sistema de 5 niveles en lugar de 4
4. **Enfoque:** Operaciones de escaneo en tiempo real vs gestión de inventario

---

## 2. SISTEMA DE PERMISOS - 5 NIVELES

### 2.1 Definición de Niveles

| Nivel | Nombre | Acceso | Descripción |
|-------|--------|--------|-------------|
| 0 | `sin_acceso` | Ninguno | Módulo oculto del sidebar, bloqueado por PermissionRoute |
| 1 | `lectura` | Solo ver | Módulo visible, todos los botones de crear/editar/eliminar ocultos |
| 2 | `escritura` | Crear y editar | Puede crear y editar, botones de eliminar ocultos |
| 3 | `gestion` | **NUEVO** - Crear, editar y eliminar | Puede crear, editar y eliminar registros normales |
| 4 | `total` | Control total | Acceso completo incluyendo desbloqueo de registros bloqueados |

### 2.2 Aplicación por Módulo

#### Módulos del Sistema Track:
- `dashboard` - Dashboard de productividad
- `escaneo` - Escaneo y armado de tarimas
- `historial` - Historial y trazabilidad
- `busqueda` - Búsqueda de guías
- `reportes` - Reportes y métricas
- `configuracion` - Configuración de empresas y canales
- `administracion` - Gestión de usuarios y roles

#### Ejemplos de Permisos por Rol:

**Usuario (Consulta):**
```javascript
{
  dashboard: 'lectura',
  escaneo: 'sin_acceso',
  historial: 'lectura',
  busqueda: 'lectura',
  reportes: 'lectura',
  configuracion: 'sin_acceso',
  administracion: 'sin_acceso'
}
```

**Operador:**
```javascript
{
  dashboard: 'lectura',
  escaneo: 'escritura',      // Puede escanear
  historial: 'lectura',
  busqueda: 'lectura',
  reportes: 'sin_acceso',
  configuracion: 'sin_acceso',
  administracion: 'sin_acceso'
}
```

**Jefe:**
```javascript
{
  dashboard: 'lectura',
  escaneo: 'gestion',        // Puede escanear y eliminar registros
  historial: 'gestion',
  busqueda: 'lectura',
  reportes: 'escritura',
  configuracion: 'escritura',
  administracion: 'sin_acceso'
}
```

**Administrador:**
```javascript
{
  dashboard: 'total',
  escaneo: 'total',          // Puede desbloquear tarimas bloqueadas
  historial: 'total',
  busqueda: 'total',
  reportes: 'total',
  configuracion: 'total',
  administracion: 'total'
}
```

### 2.3 Implementación en authStore.js

```javascript
// Función para resolver permisos con 5 niveles
function resolvePermission(moduloPermisos, accion) {
  if (!moduloPermisos) return false
  
  const level = String(moduloPermisos).toLowerCase()
  
  if (level === 'total') return true
  if (level === 'sin_acceso' || level === '') return false
  if (level === 'lectura') return accion === 'ver'
  if (level === 'escritura') return ['ver', 'crear', 'editar'].includes(accion)
  if (level === 'gestion') return accion !== 'desbloquear' // Todo excepto desbloquear
  
  return false
}

// Funciones de conveniencia
canView: (modulo) => {
  const level = getModulePermissionLevel(get(), modulo)
  return level !== 'sin_acceso'
},

canWrite: (modulo) => {
  const level = getModulePermissionLevel(get(), modulo)
  return ['escritura', 'gestion', 'total'].includes(level)
},

canDelete: (modulo) => {
  const level = getModulePermissionLevel(get(), modulo)
  return ['gestion', 'total'].includes(level)
},

canUnlock: (modulo) => {
  const level = getModulePermissionLevel(get(), modulo)
  return level === 'total'
}
```

---

## 3. ESTRUCTURA DE BASE DE DATOS (PostgreSQL)

### 3.1 Tabla: usuarios
```sql
CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre_completo VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol_id INTEGER REFERENCES roles(id),
  estado VARCHAR(20) DEFAULT 'ACTIVO',
  permisos_override JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_usuarios_codigo ON usuarios(codigo);
CREATE INDEX idx_usuarios_rol_id ON usuarios(rol_id);
```

### 3.2 Tabla: roles
```sql
CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) UNIQUE NOT NULL,
  descripcion TEXT,
  permisos JSONB NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ejemplo de permisos JSONB:
-- {
--   "dashboard": "lectura",
--   "escaneo": "escritura",
--   "historial": "lectura",
--   ...
-- }
```

### 3.3 Tabla: empresas_paqueteria
```sql
CREATE TABLE empresas_paqueteria (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_empresas_codigo ON empresas_paqueteria(codigo);
```

### 3.4 Tabla: canales
```sql
CREATE TABLE canales (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(20) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL,
  descripcion TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_canales_codigo ON canales(codigo);
```

### 3.5 Tabla: tarimas
```sql
CREATE TABLE tarimas (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(50) UNIQUE NOT NULL,
  empresa_id INTEGER REFERENCES empresas_paqueteria(id) NOT NULL,
  canal_id INTEGER REFERENCES canales(id) NOT NULL,
  operador_id INTEGER REFERENCES usuarios(id) NOT NULL,
  estado VARCHAR(20) DEFAULT 'EN_PROCESO',
  cantidad_guias INTEGER DEFAULT 0,
  fecha_inicio TIMESTAMP NOT NULL,
  fecha_cierre TIMESTAMP,
  bloqueada BOOLEAN DEFAULT false,
  bloqueada_por INTEGER REFERENCES usuarios(id),
  bloqueada_fecha TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tarimas_empresa ON tarimas(empresa_id);
CREATE INDEX idx_tarimas_canal ON tarimas(canal_id);
CREATE INDEX idx_tarimas_operador ON tarimas(operador_id);
CREATE INDEX idx_tarimas_estado ON tarimas(estado);
CREATE INDEX idx_tarimas_fecha_inicio ON tarimas(fecha_inicio);
```

### 3.6 Tabla: guias
```sql
CREATE TABLE guias (
  id SERIAL PRIMARY KEY,
  codigo_guia VARCHAR(100) NOT NULL,
  tarima_id INTEGER REFERENCES tarimas(id) NOT NULL,
  posicion INTEGER NOT NULL,
  operador_id INTEGER REFERENCES usuarios(id) NOT NULL,
  timestamp_escaneo TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_guias_codigo_tarima ON guias(codigo_guia, tarima_id);
CREATE INDEX idx_guias_tarima ON guias(tarima_id);
CREATE INDEX idx_guias_codigo ON guias(codigo_guia);
CREATE INDEX idx_guias_timestamp ON guias(timestamp_escaneo);
```

### 3.7 Tabla: sesiones_escaneo
```sql
CREATE TABLE sesiones_escaneo (
  id SERIAL PRIMARY KEY,
  operador_id INTEGER REFERENCES usuarios(id) NOT NULL,
  empresa_id INTEGER REFERENCES empresas_paqueteria(id) NOT NULL,
  canal_id INTEGER REFERENCES canales(id) NOT NULL,
  tarima_actual_id INTEGER REFERENCES tarimas(id),
  fecha_inicio TIMESTAMP NOT NULL,
  fecha_fin TIMESTAMP,
  tarimas_completadas INTEGER DEFAULT 0,
  total_guias INTEGER DEFAULT 0,
  alertas_duplicados INTEGER DEFAULT 0,
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sesiones_operador ON sesiones_escaneo(operador_id);
CREATE INDEX idx_sesiones_activa ON sesiones_escaneo(activa);
```

### 3.8 Tabla: alertas_duplicados
```sql
CREATE TABLE alertas_duplicados (
  id SERIAL PRIMARY KEY,
  codigo_guia VARCHAR(100) NOT NULL,
  tarima_id INTEGER REFERENCES tarimas(id) NOT NULL,
  operador_id INTEGER REFERENCES usuarios(id) NOT NULL,
  guia_original_id INTEGER REFERENCES guias(id),
  timestamp_alerta TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alertas_tarima ON alertas_duplicados(tarima_id);
CREATE INDEX idx_alertas_timestamp ON alertas_duplicados(timestamp_alerta);
```

---

## 4. ARQUITECTURA DEL PROYECTO

### 4.1 Estructura de Carpetas
```
upapex/apps/track/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js          # Configuración PostgreSQL
│   │   │   └── env.js               # Variables de entorno
│   │   ├── middleware/
│   │   │   ├── auth.js              # Middleware JWT
│   │   │   └── permissions.js       # Middleware de permisos
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── tarimas.routes.js
│   │   │   ├── guias.routes.js
│   │   │   ├── empresas.routes.js
│   │   │   ├── usuarios.routes.js
│   │   │   └── reportes.routes.js
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── tarimas.controller.js
│   │   │   ├── guias.controller.js
│   │   │   └── reportes.controller.js
│   │   ├── models/
│   │   │   └── queries/             # Queries SQL organizadas
│   │   ├── utils/
│   │   │   ├── jwt.js
│   │   │   └── validators.js
│   │   └── server.js
│   ├── .env.development
│   ├── .env.production
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── Layout.jsx
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   └── Header.jsx
│   │   │   ├── escaneo/
│   │   │   │   ├── EscaneoForm.jsx
│   │   │   │   ├── TarimaActiva.jsx
│   │   │   │   ├── UltimasGuias.jsx
│   │   │   │   └── AlertaDuplicado.jsx
│   │   │   ├── historial/
│   │   │   │   ├── TarimasList.jsx
│   │   │   │   ├── TarimaDetalle.jsx
│   │   │   │   └── Filtros.jsx
│   │   │   ├── dashboard/
│   │   │   │   ├── TarjetasResumen.jsx
│   │   │   │   ├── GraficaProductividad.jsx
│   │   │   │   └── MetricasEficiencia.jsx
│   │   │   └── common/
│   │   │       ├── ToastContainer.jsx
│   │   │       ├── Modal.jsx
│   │   │       └── LoadingSpinner.jsx
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Escaneo.jsx
│   │   │   ├── Historial.jsx
│   │   │   ├── Busqueda.jsx
│   │   │   ├── Reportes.jsx
│   │   │   ├── Configuraciones.jsx
│   │   │   └── Administracion.jsx
│   │   ├── stores/
│   │   │   ├── authStore.js         # Con 5 niveles de permisos
│   │   │   ├── escaneoStore.js      # Estado de sesión de escaneo
│   │   │   ├── toastStore.js
│   │   │   └── themeStore.js
│   │   ├── services/
│   │   │   ├── api.js               # Axios configurado
│   │   │   ├── authService.js
│   │   │   ├── tarimasService.js
│   │   │   ├── guiasService.js
│   │   │   └── reportesService.js
│   │   ├── hooks/
│   │   │   ├── useEscaneo.js
│   │   │   ├── useTarimas.js
│   │   │   ├── useGuias.js
│   │   │   └── useReportes.js
│   │   ├── utils/
│   │   │   ├── formatters.js
│   │   │   ├── validators.js
│   │   │   └── constants.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── .env.development
│   ├── .env.production
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
│
└── PLAN_DESARROLLO_TRACK.md (este archivo)
```

### 4.2 Variables de Entorno

**Backend - .env.development:**
```env
NODE_ENV=development
PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_NAME=track_dev
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=dev_secret_key_change_in_production
JWT_EXPIRES_IN=24h
```

**Backend - .env.production:**
```env
NODE_ENV=production
PORT=3001
DB_HOST=<huawei_cloud_ip>
DB_PORT=5432
DB_NAME=track_prod
DB_USER=<prod_user>
DB_PASSWORD=<prod_password>
JWT_SECRET=<strong_production_secret>
JWT_EXPIRES_IN=24h
```

**Frontend - .env.development:**
```env
VITE_API_URL=http://localhost:3001/api
```

**Frontend - .env.production:**
```env
VITE_API_URL=https://<production_domain>/api
```

---

## 5. MÓDULOS FUNCIONALES DETALLADOS

### 5.1 Módulo 1 - Escaneo y Armado de Tarimas

#### Componentes Principales:
- **EscaneoForm.jsx** - Formulario de escaneo con auto-focus
- **TarimaActiva.jsx** - Visualización de tarima en progreso
- **UltimasGuias.jsx** - Lista de últimas 10 guías
- **AlertaDuplicado.jsx** - Alerta visual y sonora

#### Flujo de Operación:
1. Operador selecciona empresa de paquetería y canal
2. Sistema crea sesión de escaneo y primera tarima automáticamente
3. Campo de escaneo recibe foco automático
4. Cada escaneo:
   - Valida duplicados (misma tarima y mismo día)
   - Registra con timestamp exacto
   - Actualiza contador (ej: 45/100)
   - Muestra en lista de últimas 10
5. Al llegar a 90 guías: alerta amarilla (quedan 10 espacios)
6. Al llegar a 95 guías: alerta roja (quedan 5 espacios)
7. Al llegar a 100 guías:
   - Cierra tarima automáticamente
   - Crea nueva tarima
   - Continúa escaneo sin interrupción

#### Validaciones:
- Duplicado en misma tarima → Alerta + sonido + no registrar
- Duplicado en otra tarima del mismo día → Alerta + sonido + no registrar
- Guía vacía → No procesar
- Sesión activa requerida

#### Permisos Requeridos:
- `escaneo.escritura` o superior para escanear
- `escaneo.gestion` o superior para eliminar guía individual
- `escaneo.total` para desbloquear tarima completa

### 5.2 Módulo 2 - Historial y Trazabilidad

#### Componentes Principales:
- **TarimasList.jsx** - Listado con filtros
- **TarimaDetalle.jsx** - Detalle completo de tarima
- **Filtros.jsx** - Filtros avanzados

#### Funcionalidades:
1. **Vista de Tarimas:**
   - Filtros: fecha (rango), empresa, canal, estado
   - Columnas: ID, empresa, canal, cantidad, fecha inicio/cierre, operador
   - Paginación
   - Exportar a Excel

2. **Detalle de Tarima:**
   - Información general
   - Listado completo de guías con timestamp
   - Tiempo total de armado
   - Operador responsable
   - Botón eliminar (según permisos)

3. **Búsqueda de Guía:**
   - Campo de búsqueda rápida
   - Muestra: tarima, posición, timestamp, operador
   - Búsqueda por código exacto o parcial

#### Permisos Requeridos:
- `historial.lectura` para ver
- `historial.gestion` para eliminar registros
- `historial.total` para desbloquear tarimas bloqueadas

### 5.3 Módulo 3 - Dashboard de Productividad

#### Componentes Principales:
- **TarjetasResumen.jsx** - Métricas del día
- **GraficaProductividad.jsx** - Gráficas con Recharts
- **MetricasEficiencia.jsx** - Tabla de métricas

#### Métricas Mostradas:
1. **Tarjetas Resumen (Día Actual):**
   - Total guías escaneadas
   - Total tarimas completadas
   - Total tarimas en proceso
   - Total alertas de duplicados

2. **Gráficas:**
   - Guías por hora del día (gráfica de barras)
   - Tarimas completadas por operador (gráfica de barras)
   - Tendencia de escaneo (gráfica de línea)

3. **Métricas de Eficiencia:**
   - Tiempo promedio de armado por tarima
   - Velocidad de escaneo (guías/hora)
   - Guías escaneadas por operador
   - Comparativa por rangos horarios

4. **Exportación:**
   - Botón "Exportar a Excel"
   - Incluye todas las métricas y datos del período seleccionado

#### Permisos Requeridos:
- `dashboard.lectura` para ver métricas básicas
- `reportes.escritura` para exportar

### 5.4 Módulo 4 - Autenticación y Usuarios

#### Componentes Principales:
- **Login.jsx** - Formulario de login
- **UsuariosList.jsx** - Gestión de usuarios
- **RolesList.jsx** - Gestión de roles

#### Sistema de Autenticación:
1. **Login:**
   - Email y contraseña
   - Validación contra PostgreSQL
   - Generación de JWT
   - Almacenamiento en localStorage
   - Carga de permisos desde rol

2. **JWT Payload:**
```javascript
{
  id: usuario.id,
  codigo: usuario.codigo,
  email: usuario.email,
  rol_id: usuario.rol_id,
  permisos: usuario.permisos || role.permisos,
  iat: timestamp,
  exp: timestamp + 24h
}
```

3. **Middleware de Autenticación:**
```javascript
// Verificar token en cada request
// Adjuntar usuario a req.user
// Rechazar si token inválido o expirado
```

4. **Middleware de Permisos:**
```javascript
// requirePermission('modulo.accion')
// Verificar nivel de permiso del usuario
// Permitir o rechazar según nivel requerido
```

#### Gestión de Usuarios:
- Crear, editar, desactivar usuarios
- Asignar rol
- Permisos override (opcional)
- Cambiar contraseña

#### Gestión de Roles:
- Crear, editar roles
- Configurar permisos por módulo (5 niveles)
- Asignar a usuarios

#### Permisos Requeridos:
- `administracion.gestion` para gestionar usuarios
- `administracion.total` para gestionar roles

---

## 6. CONSIDERACIONES DE UX/UI

### 6.1 Interfaz de Escaneo (Móvil/Tablet)
- **Responsive:** Optimizado para tablet (iPad, Android)
- **Auto-focus:** Campo de escaneo siempre enfocado
- **Feedback visual inmediato:**
  - Verde: escaneo exitoso
  - Rojo: duplicado detectado
  - Amarillo: alerta 90 guías
  - Rojo intenso: alerta 95 guías
- **Feedback sonoro:**
  - Beep corto: éxito
  - Beep largo: error/duplicado
- **Tamaño de fuente grande** para lectura en bodega
- **Botones grandes** para touch

### 6.2 Navegación Simple
- Sidebar colapsable (como muqui)
- Iconos claros con Lucide React
- Máximo 2 niveles de navegación
- Breadcrumbs en páginas de detalle

### 6.3 Alertas y Notificaciones
- Toast notifications (esquina superior derecha)
- Modales para confirmaciones críticas
- Alertas en tiempo real durante escaneo

### 6.4 Tema Visual
- Colores basados en muqui:
  - Primary: Azul (#004AFF a #002980)
  - Success: Verde
  - Warning: Amarillo/Naranja
  - Error: Rojo
  - Neutral: Grises

---

## 7. PLAN DE DESARROLLO POR FASES

### FASE 1: Configuración Inicial (Semana 1)
- [ ] Crear estructura de carpetas
- [ ] Configurar PostgreSQL local
- [ ] Crear esquema de base de datos
- [ ] Configurar backend Express
- [ ] Configurar frontend React + Vite
- [ ] Configurar TailwindCSS
- [ ] Implementar sistema JWT básico

### FASE 2: Autenticación y Permisos (Semana 1-2)
- [ ] Implementar authStore con 5 niveles
- [ ] Crear middleware de autenticación
- [ ] Crear middleware de permisos
- [ ] Implementar Login page
- [ ] Implementar ProtectedRoute
- [ ] Implementar PermissionRoute
- [ ] Crear roles iniciales en BD

### FASE 3: Módulo de Escaneo (Semana 2-3)
- [ ] Crear modelos y queries de tarimas
- [ ] Crear modelos y queries de guías
- [ ] Implementar API de escaneo
- [ ] Crear componente EscaneoForm
- [ ] Crear componente TarimaActiva
- [ ] Implementar validación de duplicados
- [ ] Implementar alertas visuales y sonoras
- [ ] Implementar auto-cierre a 100 guías

### FASE 4: Módulo de Historial (Semana 3-4)
- [ ] Crear API de consulta de tarimas
- [ ] Crear API de consulta de guías
- [ ] Implementar TarimasList con filtros
- [ ] Implementar TarimaDetalle
- [ ] Implementar búsqueda de guías
- [ ] Implementar paginación

### FASE 5: Dashboard y Reportes (Semana 4-5)
- [ ] Crear queries de métricas
- [ ] Implementar API de reportes
- [ ] Crear TarjetasResumen
- [ ] Implementar gráficas con Recharts
- [ ] Implementar exportación a Excel
- [ ] Optimizar queries para performance

### FASE 6: Configuración y Administración (Semana 5-6)
- [ ] Implementar gestión de empresas
- [ ] Implementar gestión de canales
- [ ] Implementar gestión de usuarios
- [ ] Implementar gestión de roles
- [ ] Crear página de configuraciones

### FASE 7: Testing y Optimización (Semana 6-7)
- [ ] Testing de flujo completo de escaneo
- [ ] Testing de permisos
- [ ] Optimización de queries
- [ ] Testing en dispositivos móviles/tablet
- [ ] Corrección de bugs

### FASE 8: Preparación para Producción (Semana 7-8)
- [ ] Configurar PostgreSQL en Huawei Cloud
- [ ] Configurar variables de entorno producción
- [ ] Migrar datos iniciales (roles, usuarios admin)
- [ ] Testing en ambiente de producción
- [ ] Documentación de deployment
- [ ] Capacitación de usuarios

---

## 8. QUERIES SQL CRÍTICAS

### 8.1 Validación de Duplicados
```sql
-- Verificar si guía existe en tarima actual
SELECT id FROM guias 
WHERE codigo_guia = $1 AND tarima_id = $2;

-- Verificar si guía existe en tarimas del mismo día
SELECT g.id, t.codigo as tarima_codigo
FROM guias g
JOIN tarimas t ON g.tarima_id = t.id
WHERE g.codigo_guia = $1 
  AND DATE(t.fecha_inicio) = CURRENT_DATE;
```

### 8.2 Métricas del Dashboard
```sql
-- Resumen del día actual
SELECT 
  COUNT(DISTINCT t.id) as total_tarimas,
  COUNT(DISTINCT CASE WHEN t.estado = 'COMPLETA' THEN t.id END) as tarimas_completadas,
  COUNT(DISTINCT CASE WHEN t.estado = 'EN_PROCESO' THEN t.id END) as tarimas_en_proceso,
  COUNT(g.id) as total_guias,
  COUNT(a.id) as total_alertas
FROM tarimas t
LEFT JOIN guias g ON t.id = g.tarima_id
LEFT JOIN alertas_duplicados a ON t.id = a.tarima_id
WHERE DATE(t.fecha_inicio) = CURRENT_DATE;

-- Guías por hora
SELECT 
  EXTRACT(HOUR FROM timestamp_escaneo) as hora,
  COUNT(*) as cantidad
FROM guias
WHERE DATE(timestamp_escaneo) = CURRENT_DATE
GROUP BY hora
ORDER BY hora;

-- Tiempo promedio de armado
SELECT 
  AVG(EXTRACT(EPOCH FROM (fecha_cierre - fecha_inicio))/60) as minutos_promedio
FROM tarimas
WHERE estado = 'COMPLETA' 
  AND DATE(fecha_inicio) = CURRENT_DATE;
```

### 8.3 Búsqueda de Guía
```sql
SELECT 
  g.codigo_guia,
  g.posicion,
  g.timestamp_escaneo,
  t.codigo as tarima_codigo,
  t.estado as tarima_estado,
  e.nombre as empresa,
  c.nombre as canal,
  u.nombre_completo as operador
FROM guias g
JOIN tarimas t ON g.tarima_id = t.id
JOIN empresas_paqueteria e ON t.empresa_id = e.id
JOIN canales c ON t.canal_id = c.id
JOIN usuarios u ON g.operador_id = u.id
WHERE g.codigo_guia ILIKE $1
ORDER BY g.timestamp_escaneo DESC
LIMIT 10;
```

---

## 9. SEGURIDAD Y BUENAS PRÁCTICAS

### 9.1 Backend
- Validación de inputs en todos los endpoints
- Sanitización de datos
- Rate limiting para prevenir ataques
- CORS configurado correctamente
- Passwords hasheados con bcrypt
- JWT con expiración
- Logs de auditoría para acciones críticas

### 9.2 Frontend
- Validación de formularios
- Sanitización de datos antes de enviar
- No exponer información sensible en localStorage
- Manejo seguro de tokens
- Timeout de sesión

### 9.3 Base de Datos
- Índices en columnas frecuentemente consultadas
- Constraints para integridad referencial
- Backups automáticos diarios
- Conexión SSL en producción

---

## 10. DEPLOYMENT

### 10.1 Desarrollo Local
```bash
# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### 10.2 Producción (Huawei Cloud ECS)
1. Configurar PostgreSQL en servidor
2. Configurar variables de entorno
3. Build del frontend: `npm run build`
4. Servir frontend con Nginx
5. Backend con PM2: `pm2 start server.js`
6. Configurar dominio y SSL

---

## 11. PRÓXIMOS PASOS

1. ✅ Revisar y aprobar este plan
2. Crear estructura de carpetas
3. Configurar PostgreSQL local
4. Iniciar Fase 1 de desarrollo

---

**Documento vivo - Se actualizará conforme avance el desarrollo**
