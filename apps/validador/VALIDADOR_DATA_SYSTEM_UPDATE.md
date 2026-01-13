# Sistema de Datos Validador - Actualización v3.1

## Fecha: 2026-01-13

## Resumen de Cambios

Se ha implementado un nuevo sistema de carga de datos para el Validador que elimina la dependencia de la hoja "Resumen" y realiza agrupación interna de datos directamente desde la hoja "BD".

---

## 1. Nueva Fuente de Datos

### Configuración
- **Spreadsheet ID**: `1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck`
- **Hoja**: `BD`
- **Rango**: `A:I`

### Estructura de Columnas

| Columna | Nombre | Descripción |
|---------|--------|-------------|
| A | Outbound_出库单号 | Número de Orden / OBC |
| B | Reference order No._参考单号 | Número de referencia |
| C | Shipping service_物流渠道 | Servicio de envío |
| D | 货件追踪码/Reference ID | Código de Tracking |
| E | Expected Arrival Time | Fecha de envío/llegada |
| F | Remark_备注 | Observaciones |
| G | Recipient_收件人 | Destino |
| H | (vacío) | - |
| I | Custom box barcode_自定义箱条码 | Código de Caja |

---

## 2. Lógica de Validación Implementada

### Validación por Par Orden-Caja
- **Clave única**: `Código_Caja + Orden.toLowerCase()`
- **Importante**: Un mismo código de caja puede repetirse en la base de datos, pero pertenece a envíos distintos si la orden es diferente
- **Validación**: `ID_Orden + Código_Caja`

### Agrupación Interna
- El sistema realiza agrupación automática por número de orden (Outbound)
- Cuenta las cajas únicas por orden usando `Set()` para evitar duplicados
- No requiere hoja de resumen externa

### Extracción de Metadatos
- Los datos de destino, horario, referencia y tracking se extraen de la **primera fila** de cada grupo de orden
- Estos valores se repiten para todas las filas de una misma orden
- Se almacenan en `OBC_INFO` Map con la siguiente estructura:
  ```javascript
  {
    recipient: string,      // Destino
    arrivalTime: string,    // Horario
    referenceNo: string,    // Número de referencia
    shippingService: string,// Servicio de envío
    trackingCode: string,   // Código de tracking
    remark: string          // Observaciones
  }
  ```

---

## 3. Sistema de Auto-Actualización

### Configuración
- **Intervalo**: 30 minutos (1,800,000 ms)
- **Modo**: Silencioso (sin notificaciones al usuario)
- **Condiciones**: Solo se ejecuta si hay conexión online y token válido

### Funciones Implementadas

#### `startBDAutoRefresh()`
- Inicia el intervalo de actualización automática
- Se ejecuta automáticamente después de cargar la BD
- Limpia intervalos previos si existen

#### `stopBDAutoRefresh()`
- Detiene el intervalo de actualización
- Se ejecuta automáticamente al cerrar sesión

#### `loadDatabase(silent = false)`
- Parámetro `silent`: cuando es `true`, no muestra notificaciones ni loading overlay
- Usado por el auto-refresh para actualizaciones silenciosas

---

## 4. Optimizaciones de Rendimiento

### Cache en Memoria
- `BD_CODES`: Set con todas las combinaciones Orden+Caja
- `OBC_MAP`: Map que agrupa códigos por orden
- `OBC_TOTALS`: Map con el total de cajas por orden
- `OBC_INFO`: Map con metadata de cada orden

### Almacenamiento Local
- Los datos se guardan en localStorage para persistencia
- Se cargan automáticamente al iniciar la aplicación
- Reduce llamadas a la API de Google Sheets

### Validación Instantánea
- El cruce entre orden buscada y cajas validadas es instantáneo
- Usa estructuras de datos optimizadas (Set y Map)
- No requiere búsquedas en arrays

---

## 5. Correcciones de Bugs

### Eliminación de Valores Anómalos
- Se removió la dependencia de la hoja "Resumen" que causaba valores incorrectos
- La agrupación interna garantiza conteos precisos
- Se eliminan duplicados automáticamente usando `Set()`

### Validación de Datos
- Se valida que existan orden y código de caja antes de procesar
- Se detectan y reportan valores sospechosos (>10,000 cajas)
- Logs detallados para debugging

---

## 6. Flujo de Datos

```
1. Usuario se autentica
   ↓
2. loadDatabase() se ejecuta
   ↓
3. Descarga datos de BD!A:I
   ↓
4. Agrupa por Orden (Outbound)
   ↓
5. Cuenta cajas únicas por orden
   ↓
6. Extrae metadata de primera fila
   ↓
7. Guarda en cache (localStorage)
   ↓
8. Inicia auto-refresh (30 min)
   ↓
9. [Cada 30 min] loadDatabase(true) silencioso
```

---

## 7. Compatibilidad

### Mantenida
- Sistema de validación existente
- Historial de validaciones (Val3)
- Sincronización con Google Sheets
- IndexedDB para cache de historial
- Modo offline

### Removida
- Dependencia de hoja "Resumen"
- Carga de múltiples hojas (BD1, BD2, etc.)

---

## 8. Testing Recomendado

### Casos de Prueba
1. ✅ Cargar BD con múltiples órdenes
2. ✅ Validar código de caja con orden correcta
3. ✅ Rechazar código de caja con orden incorrecta
4. ✅ Detectar código de caja duplicado en misma orden
5. ✅ Permitir mismo código de caja en órdenes diferentes
6. ✅ Verificar auto-refresh después de 30 minutos
7. ✅ Validar modo offline con cache
8. ✅ Verificar logout limpia auto-refresh

### Comandos de Verificación
```javascript
// En consola del navegador:
console.log('Órdenes cargadas:', OBC_TOTALS.size);
console.log('Códigos totales:', BD_CODES.size);
console.log('Info de orden:', OBC_INFO.get('OBC123'));
console.log('Auto-refresh activo:', BD_AUTO_REFRESH_INTERVAL !== null);
```

---

## 9. Notas Importantes

⚠️ **Estructura de la Hoja BD**
- La columna I (Custom box barcode) es crítica para el funcionamiento
- La columna A (Outbound) debe contener el número de orden
- No se requiere hoja de resumen adicional

⚠️ **Rendimiento**
- El sistema carga todos los datos en memoria al inicio
- La actualización silenciosa cada 30 minutos no afecta la UX
- El cache local permite funcionamiento offline

⚠️ **Validación**
- La validación es estricta: Orden + Caja deben coincidir exactamente
- Los códigos de caja se normalizan a mayúsculas
- Las órdenes se normalizan a mayúsculas

---

## 10. Archivos Modificados

- `apps/validador/app.js` - Sistema de carga de datos y auto-refresh
- Dispatch app - Cambios revertidos (no requeridos)

---

## Autor
Sistema actualizado el 2026-01-13 por Cascade AI

## Versión
v3.1 - Sistema de Datos con Agrupación Interna y Auto-Refresh
