# API Endpoints - Sistema Track

## Base URL
- **Desarrollo:** `http://localhost:3001/api`
- **Producción:** `https://[domain]/api`

## Autenticación
Todas las rutas (excepto `/auth/login`) requieren header de autenticación:
```
Authorization: Bearer <JWT_TOKEN>
```

---

## 1. AUTENTICACIÓN

### POST /auth/login
Iniciar sesión y obtener token JWT

**Request:**
```json
{
  "email": "operador@track.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "codigo": "OPR001",
    "nombre_completo": "Juan Pérez",
    "email": "operador@track.com",
    "rol_id": 3,
    "rol": "Operador",
    "permisos": {
      "dashboard": "lectura",
      "escaneo": "escritura",
      "historial": "lectura"
    }
  }
}
```

**Errores:**
- `400` - Email y contraseña requeridos
- `401` - Credenciales inválidas
- `403` - Usuario inactivo

---

### POST /auth/logout
Cerrar sesión (opcional - el cliente elimina el token)

**Response (200):**
```json
{
  "success": true,
  "message": "Sesión cerrada"
}
```

---

### GET /auth/me
Obtener información del usuario actual

**Permisos:** Autenticado

**Response (200):**
```json
{
  "id": 1,
  "codigo": "OPR001",
  "nombre_completo": "Juan Pérez",
  "email": "operador@track.com",
  "rol": "Operador",
  "permisos": { ... }
}
```

---

## 2. SESIONES DE ESCANEO

### POST /sesiones/start
Iniciar nueva sesión de escaneo

**Permisos:** `escaneo.crear`

**Request:**
```json
{
  "empresa_id": 1,
  "canal_id": 2
}
```

**Response (201):**
```json
{
  "sesion": {
    "id": 15,
    "operador_id": 3,
    "empresa_id": 1,
    "canal_id": 2,
    "tarima_actual_id": 45,
    "fecha_inicio": "2026-03-04T14:30:00Z",
    "activa": true,
    "tarimas_completadas": 0,
    "total_guias": 0
  },
  "tarima_actual": {
    "id": 45,
    "codigo": "TAR-20260304-001",
    "cantidad_guias": 0,
    "estado": "EN_PROCESO"
  }
}
```

---

### POST /sesiones/:id/scan
Escanear una guía en la sesión activa

**Permisos:** `escaneo.crear`

**Request:**
```json
{
  "codigo_guia": "GU123456789"
}
```

**Response (201) - Éxito:**
```json
{
  "success": true,
  "guia": {
    "id": 234,
    "codigo_guia": "GU123456789",
    "tarima_id": 45,
    "posicion": 23,
    "timestamp_escaneo": "2026-03-04T14:35:22Z"
  },
  "tarima": {
    "id": 45,
    "codigo": "TAR-20260304-001",
    "cantidad_guias": 23,
    "estado": "EN_PROCESO"
  },
  "alerta": null,
  "tarima_completada": false
}
```

**Response (200) - Tarima completada:**
```json
{
  "success": true,
  "guia": { ... },
  "tarima": {
    "id": 45,
    "cantidad_guias": 100,
    "estado": "COMPLETA",
    "fecha_cierre": "2026-03-04T14:45:00Z"
  },
  "nueva_tarima": {
    "id": 46,
    "codigo": "TAR-20260304-002",
    "cantidad_guias": 0,
    "estado": "EN_PROCESO"
  },
  "tarima_completada": true
}
```

**Response (409) - Duplicado:**
```json
{
  "success": false,
  "error": "DUPLICADO",
  "message": "Guía ya escaneada",
  "guia_original": {
    "id": 200,
    "tarima_codigo": "TAR-20260304-001",
    "posicion": 15,
    "timestamp_escaneo": "2026-03-04T14:20:00Z"
  }
}
```

---

### POST /sesiones/:id/end
Finalizar sesión de escaneo

**Permisos:** `escaneo.editar`

**Response (200):**
```json
{
  "success": true,
  "sesion": {
    "id": 15,
    "fecha_fin": "2026-03-04T16:00:00Z",
    "activa": false,
    "tarimas_completadas": 5,
    "total_guias": 487,
    "alertas_duplicados": 3
  }
}
```

---

### GET /sesiones/active
Obtener sesión activa del usuario

**Permisos:** `escaneo.ver`

**Response (200):**
```json
{
  "sesion": {
    "id": 15,
    "empresa_id": 1,
    "canal_id": 2,
    "tarima_actual_id": 45,
    "fecha_inicio": "2026-03-04T14:30:00Z",
    "tarimas_completadas": 2,
    "total_guias": 223
  },
  "tarima_actual": {
    "id": 45,
    "codigo": "TAR-20260304-003",
    "cantidad_guias": 23,
    "estado": "EN_PROCESO"
  },
  "ultimas_guias": [
    {
      "codigo_guia": "GU123456789",
      "posicion": 23,
      "timestamp_escaneo": "2026-03-04T15:45:22Z"
    }
  ]
}
```

**Response (404) - Sin sesión activa:**
```json
{
  "sesion": null
}
```

---

## 3. TARIMAS

### GET /tarimas
Listar tarimas con filtros

**Permisos:** `historial.ver`

**Query Params:**
- `fecha_inicio` - Fecha inicio (YYYY-MM-DD)
- `fecha_fin` - Fecha fin (YYYY-MM-DD)
- `empresa_id` - ID de empresa
- `canal_id` - ID de canal
- `estado` - Estado (EN_PROCESO, COMPLETA, CANCELADA)
- `operador_id` - ID de operador
- `page` - Página (default: 1)
- `limit` - Resultados por página (default: 20)

**Response (200):**
```json
{
  "tarimas": [
    {
      "id": 45,
      "codigo": "TAR-20260304-001",
      "empresa_nombre": "DHL Express",
      "canal_nombre": "Bodega A",
      "operador_nombre": "Juan Pérez",
      "estado": "COMPLETA",
      "cantidad_guias": 100,
      "fecha_inicio": "2026-03-04T14:00:00Z",
      "fecha_cierre": "2026-03-04T14:45:00Z",
      "tiempo_armado_segundos": 2700,
      "bloqueada": false
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8
  }
}
```

---

### GET /tarimas/:id
Obtener detalle de tarima

**Permisos:** `historial.ver`

**Response (200):**
```json
{
  "tarima": {
    "id": 45,
    "codigo": "TAR-20260304-001",
    "empresa_id": 1,
    "empresa_nombre": "DHL Express",
    "canal_id": 2,
    "canal_nombre": "Bodega A",
    "operador_id": 3,
    "operador_nombre": "Juan Pérez",
    "estado": "COMPLETA",
    "cantidad_guias": 100,
    "fecha_inicio": "2026-03-04T14:00:00Z",
    "fecha_cierre": "2026-03-04T14:45:00Z",
    "tiempo_armado_segundos": 2700,
    "bloqueada": false
  },
  "guias": [
    {
      "id": 1234,
      "codigo_guia": "GU123456789",
      "posicion": 1,
      "timestamp_escaneo": "2026-03-04T14:00:15Z",
      "operador_nombre": "Juan Pérez"
    }
  ]
}
```

---

### DELETE /tarimas/:id
Eliminar tarima

**Permisos:** `historial.eliminar` (gestion o total)

**Validación:** No se puede eliminar si está bloqueada (excepto con nivel total)

**Response (200):**
```json
{
  "success": true,
  "message": "Tarima eliminada correctamente"
}
```

**Errores:**
- `403` - Tarima bloqueada y usuario sin permiso de desbloqueo
- `404` - Tarima no encontrada

---

### POST /tarimas/:id/lock
Bloquear tarima

**Permisos:** `historial.editar`

**Request:**
```json
{
  "razon": "Tarima con inconsistencias - requiere revisión"
}
```

**Response (200):**
```json
{
  "success": true,
  "tarima": {
    "id": 45,
    "bloqueada": true,
    "bloqueada_por": 1,
    "bloqueada_fecha": "2026-03-04T15:00:00Z",
    "bloqueada_razon": "Tarima con inconsistencias - requiere revisión"
  }
}
```

---

### POST /tarimas/:id/unlock
Desbloquear tarima

**Permisos:** `historial.desbloquear` (solo nivel total)

**Response (200):**
```json
{
  "success": true,
  "tarima": {
    "id": 45,
    "bloqueada": false,
    "bloqueada_por": null,
    "bloqueada_fecha": null,
    "bloqueada_razon": null
  }
}
```

---

## 4. GUÍAS

### GET /guias/search
Buscar guías por código

**Permisos:** `busqueda.ver`

**Query Params:**
- `q` - Código de guía (búsqueda parcial)
- `limit` - Resultados (default: 10)

**Response (200):**
```json
{
  "guias": [
    {
      "id": 1234,
      "codigo_guia": "GU123456789",
      "posicion": 45,
      "timestamp_escaneo": "2026-03-04T14:30:00Z",
      "tarima_id": 45,
      "tarima_codigo": "TAR-20260304-001",
      "tarima_estado": "COMPLETA",
      "empresa_nombre": "DHL Express",
      "canal_nombre": "Bodega A",
      "operador_nombre": "Juan Pérez"
    }
  ]
}
```

---

### DELETE /guias/:id
Eliminar guía individual

**Permisos:** `escaneo.eliminar` (gestion o total)

**Validación:** No se puede eliminar si la tarima está bloqueada (excepto con nivel total)

**Response (200):**
```json
{
  "success": true,
  "message": "Guía eliminada correctamente",
  "tarima_actualizada": {
    "id": 45,
    "cantidad_guias": 99
  }
}
```

---

## 5. REPORTES Y MÉTRICAS

### GET /reportes/dashboard
Métricas del dashboard (día actual)

**Permisos:** `dashboard.ver`

**Response (200):**
```json
{
  "fecha": "2026-03-04",
  "resumen": {
    "total_guias": 1250,
    "total_tarimas": 13,
    "tarimas_completadas": 12,
    "tarimas_en_proceso": 1,
    "alertas_duplicados": 8
  },
  "guias_por_hora": [
    { "hora": 8, "cantidad": 150 },
    { "hora": 9, "cantidad": 200 },
    { "hora": 10, "cantidad": 180 }
  ],
  "tarimas_por_operador": [
    { "operador": "Juan Pérez", "tarimas": 5, "guias": 487 },
    { "operador": "María López", "tarimas": 7, "guias": 763 }
  ],
  "metricas_eficiencia": {
    "tiempo_promedio_armado_minutos": 42.5,
    "velocidad_escaneo_guias_hora": 125.3
  }
}
```

---

### GET /reportes/metricas
Métricas con rango de fechas

**Permisos:** `reportes.ver`

**Query Params:**
- `fecha_inicio` - Fecha inicio (YYYY-MM-DD)
- `fecha_fin` - Fecha fin (YYYY-MM-DD)
- `empresa_id` - Filtrar por empresa (opcional)
- `canal_id` - Filtrar por canal (opcional)

**Response (200):**
```json
{
  "periodo": {
    "fecha_inicio": "2026-03-01",
    "fecha_fin": "2026-03-04"
  },
  "totales": {
    "guias": 5230,
    "tarimas": 53,
    "alertas": 25
  },
  "por_dia": [
    {
      "fecha": "2026-03-01",
      "guias": 1200,
      "tarimas": 12,
      "tiempo_promedio_minutos": 45.2
    }
  ],
  "por_empresa": [
    {
      "empresa": "DHL Express",
      "guias": 2100,
      "tarimas": 21
    }
  ]
}
```

---

### POST /reportes/export
Exportar reporte a Excel

**Permisos:** `reportes.escritura`

**Request:**
```json
{
  "tipo": "tarimas",
  "fecha_inicio": "2026-03-01",
  "fecha_fin": "2026-03-04",
  "empresa_id": 1
}
```

**Response (200):**
```json
{
  "success": true,
  "url": "/downloads/reporte-tarimas-20260304.xlsx",
  "filename": "reporte-tarimas-20260304.xlsx"
}
```

---

## 6. CONFIGURACIÓN

### GET /empresas
Listar empresas de paquetería

**Permisos:** `configuracion.ver`

**Response (200):**
```json
{
  "empresas": [
    {
      "id": 1,
      "codigo": "DHL",
      "nombre": "DHL Express",
      "descripcion": "Empresa de paquetería internacional",
      "activo": true
    }
  ]
}
```

---

### POST /empresas
Crear empresa

**Permisos:** `configuracion.crear`

**Request:**
```json
{
  "codigo": "FEDEX",
  "nombre": "FedEx",
  "descripcion": "Empresa de paquetería y logística",
  "activo": true
}
```

---

### PUT /empresas/:id
Actualizar empresa

**Permisos:** `configuracion.editar`

---

### DELETE /empresas/:id
Eliminar empresa

**Permisos:** `configuracion.eliminar`

---

### GET /canales
Listar canales

**Permisos:** `configuracion.ver`

---

### POST /canales
Crear canal

**Permisos:** `configuracion.crear`

---

## 7. ADMINISTRACIÓN

### GET /usuarios
Listar usuarios

**Permisos:** `administracion.ver`

**Response (200):**
```json
{
  "usuarios": [
    {
      "id": 1,
      "codigo": "OPR001",
      "nombre_completo": "Juan Pérez",
      "email": "juan@track.com",
      "rol_id": 3,
      "rol_nombre": "Operador",
      "estado": "ACTIVO",
      "ultimo_acceso": "2026-03-04T15:30:00Z"
    }
  ]
}
```

---

### POST /usuarios
Crear usuario

**Permisos:** `administracion.crear`

**Request:**
```json
{
  "codigo": "OPR002",
  "nombre_completo": "María López",
  "email": "maria@track.com",
  "password": "password123",
  "rol_id": 3,
  "estado": "ACTIVO"
}
```

---

### PUT /usuarios/:id
Actualizar usuario

**Permisos:** `administracion.editar`

---

### DELETE /usuarios/:id
Desactivar usuario

**Permisos:** `administracion.eliminar`

---

### GET /roles
Listar roles

**Permisos:** `administracion.ver`

**Response (200):**
```json
{
  "roles": [
    {
      "id": 1,
      "nombre": "Administrador",
      "descripcion": "Acceso total al sistema",
      "permisos": {
        "dashboard": "total",
        "escaneo": "total",
        "historial": "total"
      },
      "activo": true
    }
  ]
}
```

---

### POST /roles
Crear rol

**Permisos:** `administracion.total`

**Request:**
```json
{
  "nombre": "Supervisor",
  "descripcion": "Supervisor de área",
  "permisos": {
    "dashboard": "lectura",
    "escaneo": "gestion",
    "historial": "gestion",
    "reportes": "escritura"
  }
}
```

---

### PUT /roles/:id
Actualizar rol

**Permisos:** `administracion.total`

---

## 8. CÓDIGOS DE ERROR

| Código | Descripción |
|--------|-------------|
| 400 | Bad Request - Datos inválidos |
| 401 | Unauthorized - No autenticado |
| 403 | Forbidden - Sin permisos |
| 404 | Not Found - Recurso no encontrado |
| 409 | Conflict - Duplicado o conflicto |
| 500 | Internal Server Error |

---

**Fin del documento**
