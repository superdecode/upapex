# 📦 WMS System - Sistema de Gestión de Almacén

Sistema profesional de gestión de almacén (Warehouse Management System) con 3 aplicaciones web integradas.

## 🎯 Características Principales

- ✅ **100% Vanilla JavaScript** - Sin frameworks, código limpio y mantenible
- 🎨 **CSS Modular** - Estilos compartidos y específicos por aplicación
- 🔗 **Integración Google Sheets** - Base de datos en tiempo real
- 📱 **Responsive Design** - Funciona en desktop y móvil
- 🔒 **Autenticación Google** - Login seguro con OAuth 2.0
- 💾 **LocalStorage** - Persistencia de datos offline
- 🎵 **Feedback Sonoro** - Alertas auditivas para operaciones

## 📁 Estructura del Proyecto

```
wms-system/
├── index.html                 # Página principal con enlaces a las 3 apps
├── apps/
│   ├── inventario/           # 📦 Sistema de Inventario
│   │   ├── index.html
│   │   └── app.js
│   ├── track/                # 🔍 Sistema de Rastreo
│   │   ├── index.html
│   │   └── app.js
│   └── validador/            # 🎯 Sistema de Validación
│       ├── index.html
│       └── app.js
├── shared/
│   ├── css/
│   │   ├── variables.css     # Variables CSS globales
│   │   ├── base.css          # Estilos base y animaciones
│   │   ├── layout.css        # Layouts y estructura
│   │   ├── components.css    # Componentes reutilizables
│   │   ├── inventory.css     # Estilos específicos de Inventario
│   │   ├── track.css         # Estilos específicos de Rastreo
│   │   └── validador.css     # Estilos específicos de Validador
│   ├── js/                   # JavaScript compartido (futuro)
│   └── config/               # Configuraciones compartidas (futuro)
└── docs/
    ├── README.md             # Este archivo
    └── ARCHITECTURE.md       # Documentación técnica
```

## 🚀 Aplicaciones

### 1. 📦 Sistema de Inventario (`/apps/inventario`)

**Funcionalidad:**
- Escaneo de códigos de barras en tiempo real
- Clasificación automática en 3 categorías:
  - ✅ **OK**: Productos disponibles
  - ⚠️ **Bloqueado**: Productos con restricciones
  - ❌ **No WMS**: Productos no encontrados en base de datos
- Gestión de pallets por categoría
- Validación de ubicaciones de almacén
- Envío de datos a Google Sheets
- Exportación de datos en JSON

**Características Especiales:**
- Búsqueda inteligente de códigos (soporta "/" y "-")
- Detección de duplicados
- Contador global de cajas
- Ubicación de origen configurable
- Feedback visual y sonoro

### 2. 🔍 Sistema de Rastreo (`/apps/track`)

**Funcionalidad:**
- Búsqueda de cajas por código
- Visualización de información completa:
  - Código de caja
  - Ubicación en almacén
  - SKU y nombre de producto
  - Stock disponible
  - Estado actual
- Tarjetas KPI con información clave
- Tabla de detalles expandible

**Características Especiales:**
- Búsqueda instantánea
- Interfaz limpia y profesional
- Actualización de base de datos en tiempo real
- Copiado rápido de información

### 3. 🎯 Sistema de Validación (`/apps/validador`)

**Funcionalidad:**
- Validación rápida de códigos
- Dashboard con estadísticas:
  - Total de validaciones
  - Códigos válidos
  - Códigos inválidos
  - Estado de base de datos
- Sesiones de validación
- Feedback inmediato (visual y sonoro)

**Características Especiales:**
- Estadísticas persistentes
- Modo de validación enfocado
- Contador de sesión independiente
- Alertas visuales claras

## ⚙️ Configuración

### 1. Configurar Google Sheets API

Cada aplicación requiere configuración de Google Sheets:

```javascript
const CONFIG = {
    SPREADSHEET_ID: 'TU_ID_DE_SPREADSHEET',
    SHEET_NAME: 'Inventario',
    CLIENT_ID: 'TU_CLIENT_ID.apps.googleusercontent.com'
};
```

### 2. Crear Credenciales OAuth 2.0

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. Habilita Google Sheets API
4. Crea credenciales OAuth 2.0
5. Agrega orígenes autorizados de JavaScript
6. Copia el Client ID a cada `app.js`

### 3. Estructura de Google Sheets

**Hoja: Inventario**
| Código | SKU | Producto | Ubicación | Stock | Estado | Almacén | Actualización |
|--------|-----|----------|-----------|-------|--------|---------|---------------|
| ABC123 | SKU1| Producto1| A21-06-05 | 100   | OK     | WH1     | 2025-01-01    |

**Hoja: Envios** (para Inventario)
| PalletID | Código | Ubicación | Categoría | Timestamp | Usuario |
|----------|--------|-----------|-----------|-----------|---------|
| PLT-123  | ABC123 | A21-06-05 | OK        | 10:30:00  | user@   |

## 🎨 Personalización de Estilos

### Variables CSS Globales

Edita `shared/css/variables.css` para cambiar colores:

```css
:root {
  --primary: #2563eb;        /* Color principal */
  --success: #4CAF50;        /* Verde para éxito */
  --warning: #FF9800;        /* Naranja para advertencias */
  --error: #F44336;          /* Rojo para errores */
  --bg: #f7f7f7;            /* Fondo general */
}
```

### Estilos por Aplicación

Cada app tiene su CSS específico en `shared/css/`:
- `inventory.css` - Columnas, cajas, pallets
- `track.css` - Búsqueda, KPIs, secciones
- `validador.css` - Dashboard, validación

## 📱 Uso

### Iniciar el Sistema

1. Abre `index.html` en un navegador
2. Selecciona la aplicación que necesitas
3. Inicia sesión con Google
4. ¡Comienza a trabajar!

### Flujo de Trabajo - Inventario

1. **Login** → Autenticación con Google
2. **Cargar BD** → Se descarga inventario automáticamente
3. **Escanear** → Ingresa códigos de cajas
4. **Clasificar** → Sistema clasifica automáticamente
5. **Ubicar** → Ingresa ubicación destino
6. **Enviar** → Envía pallet a Google Sheets

### Flujo de Trabajo - Rastreo

1. **Buscar** → Ingresa código de caja
2. **Ver Info** → Revisa detalles completos
3. **Actualizar** → Refresca base de datos si necesario

### Flujo de Trabajo - Validador

1. **Dashboard** → Revisa estadísticas
2. **Iniciar** → Comienza sesión de validación
3. **Escanear** → Valida códigos uno por uno
4. **Revisar** → Ve resultados en tiempo real

## 🔧 Mantenimiento

### Actualizar Base de Datos

Cada app tiene botón "🔄 Actualizar BD" que recarga datos desde Google Sheets.

### Limpiar LocalStorage

```javascript
localStorage.clear(); // En consola del navegador
```

### Exportar Datos

La app de Inventario permite exportar datos en JSON para respaldo.

## 🐛 Solución de Problemas

### Error de Autenticación
- Verifica que el CLIENT_ID sea correcto
- Revisa que los orígenes estén autorizados en Google Cloud Console

### Base de Datos No Carga
- Verifica SPREADSHEET_ID
- Confirma permisos de lectura/escritura
- Revisa que la hoja tenga el nombre correcto

### Códigos No Se Encuentran
- Verifica formato de códigos en Google Sheets
- Revisa función `normalizeCode()` en app.js
- Confirma que la columna de códigos sea la primera (A)

## 📊 Características Técnicas

- **Sin dependencias externas** (excepto Google APIs)
- **Modular y escalable**
- **Código limpio y documentado**
- **Performance optimizado**
- **Compatible con navegadores modernos**

## 🔒 Seguridad

- Autenticación OAuth 2.0
- Tokens manejados por Google
- Sin almacenamiento de credenciales
- Datos locales en LocalStorage (no sensibles)

## 📈 Futuras Mejoras

- [ ] Modo offline completo
- [ ] Sincronización automática
- [ ] Reportes y gráficas
- [ ] Impresión de etiquetas
- [ ] Historial de movimientos
- [ ] Multi-almacén

## 👥 Soporte

Para soporte o preguntas, contacta al administrador del sistema.

## 📄 Licencia

Sistema propietario - Todos los derechos reservados

---

**Versión:** 1.0.0  
**Última actualización:** Diciembre 2025  
**Desarrollado con:** ❤️ y ☕
