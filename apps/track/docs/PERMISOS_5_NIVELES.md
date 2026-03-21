# Sistema de Permisos de 5 Niveles - Guía de Implementación

## 1. INTRODUCCIÓN

Este documento detalla la implementación del sistema de permisos de 5 niveles para el sistema Track, basado en el sistema de 4 niveles de muqui/inventario-app pero extendido para mayor control granular.

### Diferencias vs Sistema de 4 Niveles (Muqui)

| Aspecto | Muqui (4 niveles) | Track (5 niveles) |
|---------|-------------------|-------------------|
| Niveles | sin_acceso, lectura, escritura, total | sin_acceso, lectura, escritura, **gestion**, total |
| Eliminar | Solo con "total" | Con "gestion" o "total" |
| Desbloquear | Solo con "total" | Solo con "total" |
| Uso típico | Inventario general | Operaciones críticas con bloqueos |

---

## 2. DEFINICIÓN DE NIVELES

### Nivel 0: `sin_acceso`
**Descripción:** Sin acceso al módulo  
**Comportamiento:**
- Módulo oculto del sidebar
- Ruta bloqueada por `PermissionRoute`
- Retorna `false` para cualquier acción

**Código:**
```javascript
if (level === 'sin_acceso' || level === '') return false
```

### Nivel 1: `lectura`
**Descripción:** Solo visualización  
**Comportamiento:**
- Módulo visible en sidebar
- Puede ver listados y detalles
- Todos los botones de crear/editar/eliminar ocultos
- Solo permite acción `ver`

**Código:**
```javascript
if (level === 'lectura') return accion === 'ver'
```

**UI:**
```javascript
const canWrite = useAuthStore(s => s.canWrite('escaneo'))
// canWrite = false

<button disabled={!canWrite}>Crear</button> // Oculto o deshabilitado
```

### Nivel 2: `escritura`
**Descripción:** Crear y editar  
**Comportamiento:**
- Puede ver, crear y editar
- **NO puede eliminar**
- Botones de eliminar ocultos
- Ideal para operadores

**Código:**
```javascript
if (level === 'escritura') return ['ver', 'crear', 'editar'].includes(accion)
```

**UI:**
```javascript
const canWrite = useAuthStore(s => s.canWrite('escaneo'))
const canDelete = useAuthStore(s => s.canDelete('escaneo'))
// canWrite = true, canDelete = false

<button disabled={!canWrite}>Crear</button> // Visible
<button disabled={!canDelete}>Eliminar</button> // Oculto
```

### Nivel 3: `gestion` ⭐ NUEVO
**Descripción:** Gestión completa de registros normales  
**Comportamiento:**
- Puede ver, crear, editar y **eliminar**
- **NO puede desbloquear** registros bloqueados
- Ideal para jefes/supervisores
- Permite eliminar guías individuales o tarimas no bloqueadas

**Código:**
```javascript
if (level === 'gestion') return accion !== 'desbloquear'
```

**UI:**
```javascript
const canDelete = useAuthStore(s => s.canDelete('escaneo'))
const canUnlock = useAuthStore(s => s.canUnlock('escaneo'))
// canDelete = true, canUnlock = false

<button disabled={!canDelete}>Eliminar Guía</button> // Visible
<button disabled={!canUnlock || tarima.bloqueada}>Desbloquear</button> // Oculto si bloqueada
```

### Nivel 4: `total`
**Descripción:** Control total  
**Comportamiento:**
- Acceso completo sin restricciones
- Puede desbloquear registros bloqueados
- Puede eliminar cualquier registro
- Ideal para administradores

**Código:**
```javascript
if (level === 'total') return true
```

**UI:**
```javascript
const canUnlock = useAuthStore(s => s.canUnlock('escaneo'))
// canUnlock = true

<button disabled={!canUnlock}>Desbloquear Tarima</button> // Siempre visible
```

---

## 3. IMPLEMENTACIÓN EN AUTHSTORE.JS

### 3.1 Función Principal de Resolución

```javascript
/**
 * Resolve a permission check for a module+action.
 * Supports 5-level string format: 'total', 'gestion', 'escritura', 'lectura', 'sin_acceso'
 */
function resolvePermission(moduloPermisos, accion) {
  if (!moduloPermisos) return false
  
  const level = String(moduloPermisos).toLowerCase()
  
  // Nivel 4: Total - acceso completo
  if (level === 'total') return true
  
  // Nivel 0: Sin acceso
  if (level === 'sin_acceso' || level === '') return false
  
  // Nivel 1: Lectura - solo ver
  if (level === 'lectura') return accion === 'ver'
  
  // Nivel 2: Escritura - ver, crear, editar (NO eliminar, NO desbloquear)
  if (level === 'escritura') {
    return ['ver', 'crear', 'editar'].includes(accion)
  }
  
  // Nivel 3: Gestión - todo excepto desbloquear
  if (level === 'gestion') {
    return accion !== 'desbloquear'
  }
  
  return false
}
```

### 3.2 Función para Obtener Nivel de Permiso

```javascript
/**
 * Get the raw permission level string for a module.
 * Returns: 'total' | 'gestion' | 'escritura' | 'lectura' | 'sin_acceso'
 */
function getModulePermissionLevel(state, modulo) {
  const user = state.user
  if (!user) return 'sin_acceso'

  // 1. User-level override (permisos_override)
  if (user.permisos_override && typeof user.permisos_override === 'object') {
    const override = user.permisos_override[modulo]
    if (override !== undefined) {
      return String(override).toLowerCase() || 'sin_acceso'
    }
  }

  // 2. Role-based permissions
  const { cachedRole } = state
  const rolePermisos = cachedRole?.permisos || user.permisos
  if (rolePermisos && typeof rolePermisos === 'object') {
    const moduloPermisos = rolePermisos[modulo]
    if (moduloPermisos !== undefined) {
      return String(moduloPermisos).toLowerCase() || 'sin_acceso'
    }
  }

  // 3. Fallback: admin roles get total
  const rolName = cachedRole?.nombre || user.rol
  if (rolName === 'Administrador') {
    return 'total'
  }

  return 'sin_acceso'
}
```

### 3.3 Funciones de Conveniencia

```javascript
export const useAuthStore = create(
  persist(
    (set, get) => ({
      // ... state ...

      /**
       * Check permission: "modulo.accion" e.g. "escaneo.ver", "escaneo.eliminar"
       */
      hasPermission: (permission) => {
        const user = get().user
        if (!user) return false

        const [modulo, accion] = permission.split('.')
        if (!modulo || !accion) return false

        // 1. User-level override
        if (user.permisos_override && typeof user.permisos_override === 'object') {
          const override = user.permisos_override[modulo]
          if (override !== undefined) {
            return resolvePermission(override, accion)
          }
        }

        // 2. Role-based permissions
        const { cachedRole } = get()
        const rolePermisos = cachedRole?.permisos || user.permisos
        if (rolePermisos && typeof rolePermisos === 'object') {
          const moduloPermisos = rolePermisos[modulo]
          if (moduloPermisos !== undefined) {
            return resolvePermission(moduloPermisos, accion)
          }
        }

        // 3. Fallback: admin roles get full access
        const rolName = cachedRole?.nombre || user.rol
        if (rolName === 'Administrador') {
          return true
        }

        return false
      },

      /**
       * Get the permission level for a module
       */
      getPermissionLevel: (modulo) => {
        return getModulePermissionLevel(get(), modulo)
      },

      /**
       * Check if user can view a module (lectura or higher)
       */
      canView: (modulo) => {
        const level = getModulePermissionLevel(get(), modulo)
        return level !== 'sin_acceso'
      },

      /**
       * Check if user can create/edit (escritura, gestion, or total)
       */
      canWrite: (modulo) => {
        const level = getModulePermissionLevel(get(), modulo)
        return ['escritura', 'gestion', 'total'].includes(level)
      },

      /**
       * Check if user can delete (gestion or total)
       * ⭐ NUEVA FUNCIÓN - ahora incluye 'gestion'
       */
      canDelete: (modulo) => {
        const level = getModulePermissionLevel(get(), modulo)
        return ['gestion', 'total'].includes(level)
      },

      /**
       * Check if user can unlock blocked records (total only)
       * ⭐ NUEVA FUNCIÓN - exclusiva para nivel 'total'
       */
      canUnlock: (modulo) => {
        const level = getModulePermissionLevel(get(), modulo)
        return level === 'total'
      }
    }),
    {
      name: 'auth-storage'
    }
  )
)
```

---

## 4. EJEMPLOS DE USO EN COMPONENTES

### 4.1 Página de Escaneo

```javascript
import { useAuthStore } from '../stores/authStore'

export default function Escaneo() {
  const canWrite = useAuthStore(s => s.canWrite('escaneo'))
  const canDelete = useAuthStore(s => s.canDelete('escaneo'))
  
  if (!canWrite) {
    return <div>No tienes permisos para escanear</div>
  }

  return (
    <div>
      {/* Formulario de escaneo - visible con escritura o superior */}
      <EscaneoForm />
      
      {/* Botón eliminar guía - solo visible con gestion o total */}
      {canDelete && (
        <button onClick={handleDeleteGuia}>
          Eliminar Última Guía
        </button>
      )}
    </div>
  )
}
```

### 4.2 Detalle de Tarima con Bloqueo

```javascript
export default function TarimaDetalle({ tarima }) {
  const canDelete = useAuthStore(s => s.canDelete('historial'))
  const canUnlock = useAuthStore(s => s.canUnlock('historial'))
  
  const handleDelete = async () => {
    if (tarima.bloqueada && !canUnlock) {
      toast.error('No puedes eliminar una tarima bloqueada')
      return
    }
    // Proceder con eliminación
  }
  
  const handleUnlock = async () => {
    // Solo usuarios con nivel 'total' pueden desbloquear
    await api.unlockTarima(tarima.id)
  }

  return (
    <div>
      <h2>Tarima {tarima.codigo}</h2>
      
      {tarima.bloqueada && (
        <div className="bg-red-100 p-4">
          ⚠️ Tarima bloqueada
          {canUnlock && (
            <button onClick={handleUnlock}>Desbloquear</button>
          )}
        </div>
      )}
      
      {/* Botón eliminar - visible con gestion o total */}
      {canDelete && (
        <button 
          onClick={handleDelete}
          disabled={tarima.bloqueada && !canUnlock}
        >
          Eliminar Tarima
        </button>
      )}
    </div>
  )
}
```

### 4.3 Sidebar con Permisos

```javascript
export default function Sidebar() {
  const { hasPermission } = useAuthStore()

  const menuItems = [
    { to: '/', icon: Home, label: 'Dashboard' },
    { to: '/escaneo', icon: Scan, label: 'Escaneo', permission: 'escaneo.ver' },
    { to: '/historial', icon: History, label: 'Historial', permission: 'historial.ver' },
    { to: '/reportes', icon: FileText, label: 'Reportes', permission: 'reportes.ver' },
    { to: '/admin', icon: Shield, label: 'Administración', permission: 'administracion.ver' }
  ]

  const visibleItems = menuItems.filter(item => 
    !item.permission || hasPermission(item.permission)
  )

  return (
    <nav>
      {visibleItems.map(item => (
        <NavLink key={item.to} to={item.to}>
          <item.icon /> {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
```

---

## 5. IMPLEMENTACIÓN EN BACKEND (MIDDLEWARE)

### 5.1 Middleware de Autenticación JWT

```javascript
// middleware/auth.js
const jwt = require('jsonwebtoken')

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' })
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' })
    }
    req.user = user
    next()
  })
}

module.exports = { authenticateToken }
```

### 5.2 Middleware de Permisos

```javascript
// middleware/permissions.js

/**
 * Resolve permission based on 5-level system
 */
function resolvePermission(level, action) {
  if (!level) return false
  
  const lvl = String(level).toLowerCase()
  
  if (lvl === 'total') return true
  if (lvl === 'sin_acceso' || lvl === '') return false
  if (lvl === 'lectura') return action === 'ver'
  if (lvl === 'escritura') return ['ver', 'crear', 'editar'].includes(action)
  if (lvl === 'gestion') return action !== 'desbloquear'
  
  return false
}

/**
 * Middleware to check if user has required permission
 * Usage: requirePermission('escaneo.crear')
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    const user = req.user
    if (!user) {
      return res.status(401).json({ error: 'No autenticado' })
    }

    const [modulo, accion] = permission.split('.')
    if (!modulo || !accion) {
      return res.status(400).json({ error: 'Formato de permiso inválido' })
    }

    // Check permisos_override first
    if (user.permisos_override && user.permisos_override[modulo]) {
      const hasPermission = resolvePermission(user.permisos_override[modulo], accion)
      if (hasPermission) return next()
    }

    // Check role permissions
    if (user.permisos && user.permisos[modulo]) {
      const hasPermission = resolvePermission(user.permisos[modulo], accion)
      if (hasPermission) return next()
    }

    // Admin fallback
    if (user.rol === 'Administrador') {
      return next()
    }

    return res.status(403).json({ 
      error: 'No tienes permisos para realizar esta acción',
      required: permission
    })
  }
}

module.exports = { requirePermission }
```

### 5.3 Uso en Rutas

```javascript
// routes/tarimas.routes.js
const express = require('express')
const router = express.Router()
const { authenticateToken } = require('../middleware/auth')
const { requirePermission } = require('../middleware/permissions')
const tarimasController = require('../controllers/tarimas.controller')

// Ver tarimas - requiere lectura
router.get('/', 
  authenticateToken,
  requirePermission('historial.ver'),
  tarimasController.getTarimas
)

// Crear tarima - requiere escritura
router.post('/', 
  authenticateToken,
  requirePermission('escaneo.crear'),
  tarimasController.createTarima
)

// Eliminar tarima - requiere gestion o total
router.delete('/:id', 
  authenticateToken,
  requirePermission('historial.eliminar'),
  tarimasController.deleteTarima
)

// Desbloquear tarima - requiere total
router.post('/:id/unlock', 
  authenticateToken,
  requirePermission('historial.desbloquear'),
  tarimasController.unlockTarima
)

module.exports = router
```

---

## 6. CASOS DE USO POR ROL

### Usuario (Solo Consulta)
```javascript
{
  dashboard: 'lectura',      // ✓ Ver métricas
  escaneo: 'sin_acceso',     // ✗ No puede escanear
  historial: 'lectura',      // ✓ Ver tarimas y guías
  busqueda: 'lectura',       // ✓ Buscar guías
  reportes: 'lectura',       // ✓ Ver reportes (no exportar)
  configuracion: 'sin_acceso',
  administracion: 'sin_acceso'
}
```

### Operador
```javascript
{
  dashboard: 'lectura',      // ✓ Ver métricas
  escaneo: 'escritura',      // ✓ Escanear, ✗ No eliminar
  historial: 'lectura',      // ✓ Ver tarimas
  busqueda: 'lectura',       // ✓ Buscar guías
  reportes: 'sin_acceso',
  configuracion: 'sin_acceso',
  administracion: 'sin_acceso'
}
```

### Jefe/Supervisor
```javascript
{
  dashboard: 'lectura',      // ✓ Ver métricas
  escaneo: 'gestion',        // ✓ Escanear y eliminar, ✗ No desbloquear
  historial: 'gestion',      // ✓ Ver y eliminar tarimas no bloqueadas
  busqueda: 'lectura',       // ✓ Buscar guías
  reportes: 'escritura',     // ✓ Ver y exportar
  configuracion: 'escritura', // ✓ Gestionar empresas/canales
  administracion: 'sin_acceso'
}
```

### Administrador
```javascript
{
  dashboard: 'total',        // ✓ Todo
  escaneo: 'total',          // ✓ Todo + desbloquear
  historial: 'total',        // ✓ Todo + desbloquear
  busqueda: 'total',         // ✓ Todo
  reportes: 'total',         // ✓ Todo
  configuracion: 'total',    // ✓ Todo
  administracion: 'total'    // ✓ Gestionar usuarios y roles
}
```

---

## 7. TESTING

### 7.1 Tests Unitarios (Jest)

```javascript
// authStore.test.js
import { useAuthStore } from '../stores/authStore'

describe('5-Level Permission System', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: null,
      cachedRole: null
    })
  })

  test('sin_acceso denies all actions', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'sin_acceso' } }
    })
    
    expect(useAuthStore.getState().hasPermission('escaneo.ver')).toBe(false)
    expect(useAuthStore.getState().hasPermission('escaneo.crear')).toBe(false)
  })

  test('lectura allows only ver', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'lectura' } }
    })
    
    expect(useAuthStore.getState().hasPermission('escaneo.ver')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.crear')).toBe(false)
    expect(useAuthStore.getState().hasPermission('escaneo.eliminar')).toBe(false)
  })

  test('escritura allows ver, crear, editar but not eliminar', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'escritura' } }
    })
    
    expect(useAuthStore.getState().hasPermission('escaneo.ver')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.crear')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.editar')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.eliminar')).toBe(false)
    expect(useAuthStore.getState().hasPermission('escaneo.desbloquear')).toBe(false)
  })

  test('gestion allows all except desbloquear', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'gestion' } }
    })
    
    expect(useAuthStore.getState().hasPermission('escaneo.ver')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.crear')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.editar')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.eliminar')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.desbloquear')).toBe(false)
  })

  test('total allows everything', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'total' } }
    })
    
    expect(useAuthStore.getState().hasPermission('escaneo.ver')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.crear')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.eliminar')).toBe(true)
    expect(useAuthStore.getState().hasPermission('escaneo.desbloquear')).toBe(true)
  })

  test('canDelete returns true for gestion and total', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'gestion' } }
    })
    expect(useAuthStore.getState().canDelete('escaneo')).toBe(true)

    useAuthStore.setState({
      user: { permisos: { escaneo: 'total' } }
    })
    expect(useAuthStore.getState().canDelete('escaneo')).toBe(true)

    useAuthStore.setState({
      user: { permisos: { escaneo: 'escritura' } }
    })
    expect(useAuthStore.getState().canDelete('escaneo')).toBe(false)
  })

  test('canUnlock returns true only for total', () => {
    useAuthStore.setState({
      user: { permisos: { escaneo: 'total' } }
    })
    expect(useAuthStore.getState().canUnlock('escaneo')).toBe(true)

    useAuthStore.setState({
      user: { permisos: { escaneo: 'gestion' } }
    })
    expect(useAuthStore.getState().canUnlock('escaneo')).toBe(false)
  })
})
```

---

## 8. MIGRACIÓN DESDE SISTEMA DE 4 NIVELES

Si ya tienes un sistema con 4 niveles y quieres migrar:

### 8.1 Mapeo de Niveles

| Nivel Antiguo | Nivel Nuevo | Notas |
|---------------|-------------|-------|
| sin_acceso | sin_acceso | Sin cambios |
| lectura | lectura | Sin cambios |
| escritura | escritura | Sin cambios |
| total | **gestion** o **total** | Decidir según necesidad de desbloqueo |

### 8.2 Script de Migración (PostgreSQL)

```sql
-- Actualizar roles que tenían 'total' pero no necesitan desbloquear
UPDATE roles 
SET permisos = jsonb_set(
  permisos, 
  '{escaneo}', 
  '"gestion"'
)
WHERE permisos->>'escaneo' = 'total'
  AND nombre != 'Administrador';

-- Los administradores mantienen 'total'
```

---

## 9. CHECKLIST DE IMPLEMENTACIÓN

- [ ] Actualizar `authStore.js` con función `resolvePermission` de 5 niveles
- [ ] Agregar función `canUnlock` a authStore
- [ ] Actualizar función `canDelete` para incluir 'gestion'
- [ ] Crear middleware de permisos en backend
- [ ] Actualizar todas las rutas con permisos correctos
- [ ] Crear roles iniciales en base de datos
- [ ] Actualizar componentes UI con lógica de desbloqueo
- [ ] Escribir tests unitarios para permisos
- [ ] Documentar permisos en README
- [ ] Capacitar usuarios sobre nuevos niveles

---

**Fin del documento**
