# 🚚 Sistema de Despacho WMS

## 📋 Descripción General

El Sistema de Despacho es una aplicación web integrada al WMS que permite gestionar y validar órdenes de despacho logístico, con sincronización automática a Google Sheets y capacidades offline.

---

## 🎯 Características Principales

### ✅ Funcionalidades Core

- **Búsqueda de Órdenes**: Búsqueda rápida por número de orden
- **Validación de Despachos**: Marca órdenes como despachadas con folio único
- **Gestión de Estados**: Sistema de tabs para pendientes y validados
- **Sincronización Automática**: Envío automático a Google Sheets
- **Modo Offline**: Funciona sin conexión con sincronización posterior
- **Múltiples Fuentes de Datos**: Integración con 6 fuentes diferentes

### 🔧 Módulos Compartidos Integrados

- ✅ `wms-utils.js` - Utilidades de validación y normalización
- ✅ `sync-manager.js` - Gestor de sincronización offline/online
- ✅ `sidebar-component.js` - Navegación entre apps
- ✅ `avatar-system.js` - Sistema de avatares de usuario
- ✅ `auth-manager.js` - Autenticación centralizada (en desarrollo)

---

## 📊 Fuentes de Datos

### 1. BD Stock
**URL**: CSV publicado desde Google Sheets  
**Contenido**: Inventario de productos y stock disponible

### 2. OBC BD (Órdenes de Compra)
**URL**: CSV publicado desde Google Sheets  
**Contenido**: Órdenes de compra y despacho  
**Uso**: Base principal para búsqueda de órdenes

### 3. Validación
**URL**: CSV publicado desde Google Sheets  
**Contenido**: Registro de órdenes ya validadas  
**Uso**: Verificar si una orden ya fue despachada

### 4. MNE (Movimientos)
**URL**: CSV publicado desde Google Sheets  
**Contenido**: Movimientos de mercancía

### 5. TRS (Transportes)
**URL**: CSV publicado desde Google Sheets  
**Contenido**: Información de transportes

### 6. LISTAS
**URL**: CSV publicado desde Google Sheets  
**Contenido**: Listas de operadores y unidades de transporte  
**Uso**: Filtros y asignaciones

---

## 🏗️ Arquitectura

### Estado de la Aplicación (STATE)

```javascript
STATE = {
    obcData: new Map(),           // Órdenes de compra
    obcDataFiltered: new Map(),   // Órdenes filtradas
    validacionData: new Map(),    // Órdenes validadas (BD)
    mneData: new Map(),           // Movimientos
    trsData: [],                  // Transportes
    operadores: [],               // Lista de operadores
    unidades: [],                 // Lista de unidades
    currentOrder: null,           // Orden actual seleccionada
    dateFilter: {                 // Filtro de fechas
        startDate: null,
        endDate: null,
        active: false
    },
    pendingSync: [],              // Cola de sincronización
    localValidated: [],           // Validados localmente
    localPending: [],             // Pendientes locales
    activeTab: 'pending',         // Tab activa
    folioCounter: 0               // Contador de folios
}
```

### Persistencia Local

```javascript
// Datos guardados en LocalStorage
{
    dispatch_local_state: {
        localValidated: [],    // Despachos validados
        localPending: [],      // Despachos pendientes
        folioCounter: 0        // Último folio generado
    }
}
```

---

## 🔄 Flujo de Trabajo

### 1. Inicialización

```
Usuario accede → Login Google → Carga de datos
                                      ↓
                    ┌─────────────────┴─────────────────┐
                    ↓                                   ↓
            Cargar 6 fuentes CSV              Cargar estado local
                    ↓                                   ↓
            Procesar y mapear datos           Restaurar validados
                    ↓                                   ↓
                    └─────────────────┬─────────────────┘
                                      ↓
                              App lista para usar
```

### 2. Búsqueda de Orden

```
Usuario ingresa número de orden
        ↓
Buscar en obcData (Map)
        ↓
    ¿Encontrada?
    ↙         ↘
  Sí          No
   ↓           ↓
Mostrar     Mostrar
detalles    error
   ↓
Verificar si ya fue validada
   ↓
¿Ya validada?
↙         ↘
Sí        No
↓          ↓
Mostrar   Permitir
estado    validar
```

### 3. Validación de Despacho

```
Usuario valida orden
        ↓
Generar folio único (DSP-YYYYMMDD-XXXX)
        ↓
Crear registro de validación
        ↓
Guardar en localValidated
        ↓
Guardar en LocalStorage
        ↓
    ¿Online?
    ↙      ↘
  Sí       No
   ↓        ↓
Enviar a  Agregar a
Sheets    pendingSync
   ↓        ↓
Actualizar UI
```

### 4. Sincronización

```
Conexión restaurada
        ↓
¿Hay pendingSync?
    ↙      ↘
  Sí       No
   ↓        ↓
Procesar  Nada que
cola      hacer
   ↓
Enviar cada item a Sheets
   ↓
Limpiar pendingSync
   ↓
Notificar usuario
```

---

## 🎨 Interfaz de Usuario

### Componentes Principales

#### 1. Sidebar de Navegación
- Navegación entre apps del WMS
- Avatar de usuario con nombre editable
- Estado de conexión

#### 2. Área de Búsqueda
- Input para número de orden
- Botón de búsqueda
- Filtros por fecha y operador

#### 3. Sistema de Tabs
- **Pendientes**: Órdenes por validar
- **Validados**: Órdenes ya despachadas

#### 4. Detalles de Orden
- Información completa de la orden
- Botón de validación
- Estado actual

#### 5. Indicadores
- Estado de conexión (online/offline)
- Contador de pendientes de sincronización
- Notificaciones toast

---

## 📝 Generación de Folios

### Formato
```
DSP-YYYYMMDD-XXXX

Donde:
- DSP: Prefijo de Despacho
- YYYYMMDD: Fecha actual (20251230)
- XXXX: Contador secuencial con padding (0001, 0002, etc.)
```

### Ejemplo
```javascript
// Folio generado el 30 de diciembre de 2024
DSP-20241230-0001
DSP-20241230-0002
DSP-20241230-0003
```

### Persistencia
El contador se guarda en LocalStorage y se incrementa con cada validación.

---

## 🔌 Integración con Google Sheets

### Hoja de Escritura
**ID**: `1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o`

### Estructura de Datos Enviados

```javascript
{
    orden: "12345",
    folio: "DSP-20241230-0001",
    timestamp: "2024-12-30 14:30:00",
    usuario: "usuario@email.com",
    operador: "Operador 1",
    unidad: "Unidad A",
    // ... más campos según la orden
}
```

### Operaciones

#### Lectura (GET)
```javascript
// Cargar datos desde CSV publicados
fetch(CONFIG.SOURCES.OBC_BD)
    .then(response => response.text())
    .then(csv => parseCSV(csv))
```

#### Escritura (APPEND)
```javascript
// Enviar validación a Sheets
gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.SPREADSHEET_WRITE,
    range: 'Validaciones!A:Z',
    valueInputOption: 'RAW',
    resource: { values: [data] }
})
```

---

## 🔐 Autenticación

### OAuth 2.0 Flow

```javascript
// Configuración
CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com'
SCOPES: 'https://www.googleapis.com/auth/spreadsheets 
         https://www.googleapis.com/auth/userinfo.profile'

// Inicialización
TOKEN_CLIENT = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: handleAuthResponse
})
```

### Sesión Persistente
- Usuario y email guardados en LocalStorage
- Token manejado por Google Identity Services
- Verificación automática de sesión al cargar

---

## 💾 Gestión de Datos Offline

### Estrategia

1. **Carga Inicial**: Descargar todas las fuentes al iniciar sesión
2. **Operación Local**: Todas las búsquedas y validaciones funcionan localmente
3. **Cola de Sincronización**: Validaciones offline se guardan en `pendingSync`
4. **Sincronización Automática**: Al restaurar conexión, enviar cola automáticamente

### Ventajas

- ✅ Funciona sin conexión a internet
- ✅ No se pierden datos
- ✅ Sincronización transparente
- ✅ Feedback inmediato al usuario

---

## 🎯 Casos de Uso

### Caso 1: Validación Normal (Online)

1. Usuario busca orden "12345"
2. Sistema encuentra orden en OBC_BD
3. Usuario hace clic en "Validar"
4. Sistema genera folio DSP-20241230-0001
5. Guarda localmente y envía a Sheets
6. Muestra confirmación

### Caso 2: Validación Offline

1. Usuario pierde conexión
2. Busca orden "12346"
3. Sistema encuentra orden (datos en memoria)
4. Usuario valida
5. Sistema genera folio y guarda localmente
6. Agrega a cola de sincronización
7. Muestra notificación "Pendiente de sincronización"
8. Al restaurar conexión, sincroniza automáticamente

### Caso 3: Orden Ya Validada

1. Usuario busca orden "12345"
2. Sistema encuentra orden
3. Sistema verifica en validacionData
4. Detecta que ya fue validada
5. Muestra estado "Ya validada" con folio anterior
6. No permite validar nuevamente

---

## 🛠️ Mantenimiento

### Actualizar Fuentes de Datos

```javascript
// Botón "Actualizar BD" recarga todas las fuentes
async function loadAllData() {
    await loadOBCData();
    await loadValidacionData();
    await loadMNEData();
    await loadTRSData();
    await loadListas();
}
```

### Limpiar Estado Local

```javascript
// En consola del navegador
localStorage.removeItem('dispatch_local_state');
```

### Resetear Contador de Folios

```javascript
// En consola del navegador
let state = JSON.parse(localStorage.getItem('dispatch_local_state'));
state.folioCounter = 0;
localStorage.setItem('dispatch_local_state', JSON.stringify(state));
```

---

## 🐛 Solución de Problemas

### Problema: Orden no se encuentra

**Causas posibles:**
- Orden no existe en OBC_BD
- Datos no se cargaron correctamente
- Formato de búsqueda incorrecto

**Solución:**
1. Verificar que la orden existe en Google Sheets
2. Actualizar BD con el botón de recarga
3. Revisar consola para errores

### Problema: No sincroniza

**Causas posibles:**
- Sin conexión a internet
- Token expirado
- Permisos insuficientes

**Solución:**
1. Verificar conexión (indicador en UI)
2. Cerrar sesión y volver a iniciar
3. Verificar permisos en Google Cloud Console

### Problema: Folios duplicados

**Causas posibles:**
- LocalStorage corrupto
- Múltiples pestañas abiertas

**Solución:**
1. Cerrar todas las pestañas excepto una
2. Resetear contador de folios
3. Recargar aplicación

---

## 📈 Métricas y Estadísticas

### Datos Rastreados

- Total de validaciones realizadas
- Validaciones por usuario
- Validaciones por operador
- Validaciones por fecha
- Tiempo promedio de validación

### Futura Implementación

- Dashboard de estadísticas
- Gráficas de tendencias
- Reportes exportables
- Alertas de anomalías

---

## 🔮 Mejoras Futuras

### Corto Plazo
- [ ] Integración completa con AuthManager
- [ ] Búsqueda por múltiples criterios
- [ ] Exportación de reportes
- [ ] Impresión de folios

### Mediano Plazo
- [ ] Escaneo de códigos QR
- [ ] Notificaciones push
- [ ] Firma digital de despachos
- [ ] Fotos de evidencia

### Largo Plazo
- [ ] App móvil nativa
- [ ] Integración con ERP
- [ ] Machine Learning para predicciones
- [ ] API REST para terceros

---

## 📚 Referencias

- [Google Sheets API v4](https://developers.google.com/sheets/api)
- [Google Identity Services](https://developers.google.com/identity/gsi/web)
- [LocalStorage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
- [Fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

---

**Versión:** 1.0.0  
**Última actualización:** Diciembre 2024  
**Mantenido por:** Equipo de Desarrollo WMS
