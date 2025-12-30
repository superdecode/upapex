# Configuración de Google Spreadsheet para Despachos

## 📋 Problema Identificado

El sistema de Despacho está intentando sincronizar datos a una hoja llamada "Hoja1" que no existe o tiene un nombre diferente en tu Google Spreadsheet.

**Errores que estabas viendo:**
- ❌ Error: Unable to parse range: Hoja1!A:Z
- ⚠️ Esta orden ya fue procesada en la base de datos (falso positivo)

## ✅ Solución Implementada

### 1. Cambio de Nombre de Hoja
Se cambió la configuración de `sheetName: 'Hoja1'` a `sheetName: 'Despachos'`

### 2. Corrección de Validación de Duplicados
Se corrigió la función `isOrderValidated()` para que solo verifique contra despachos locales, no contra datos de validación de surtido (Val3).

## 🔧 Configuración Requerida en Google Sheets

### Opción A: Renombrar la Hoja (Recomendado)
1. Abre tu Google Spreadsheet: `1_dkq4puGs3g9DvOGv96FqsoNGYV7bHXNMX680PU-X_o`
2. Busca la hoja donde quieres guardar los despachos
3. Haz clic derecho en la pestaña de la hoja
4. Selecciona "Cambiar nombre"
5. Renómbrala a: **Despachos**

### Opción B: Crear Nueva Hoja
1. Abre tu Google Spreadsheet
2. Haz clic en el botón "+" para crear una nueva hoja
3. Nómbrala: **Despachos**
4. Agrega los siguientes encabezados en la primera fila:
   - A1: Folio
   - B1: Fecha
   - C1: Hora
   - D1: Usuario
   - E1: Orden
   - F1: Destino
   - G1: Horario
   - H1: Código
   - I1: Código 2
   - J1: Estatus
   - K1: Tarea
   - L1: Estatus2
   - M1: Incidencias
   - N1: Operador
   - O1: Unidad
   - P1: Observaciones

## 📊 Estructura de Datos

Cada despacho se guardará con la siguiente estructura:

| Columna | Campo | Descripción |
|---------|-------|-------------|
| A | Folio | Folio único del despacho (DSP-YYYYMMDD-####) |
| B | Fecha | Fecha del despacho |
| C | Hora | Hora del despacho |
| D | Usuario | Usuario que procesó el despacho |
| E | Orden | Número de orden (OBC) |
| F | Destino | Destinatario/Cliente |
| G | Horario | Horario esperado de llegada |
| H | Código | Código de tracking |
| I | Código 2 | Referencia adicional |
| J | Estatus | Estado del despacho (Procesado) |
| K | Tarea | Tipo de tarea (Despacho) |
| L | Estatus2 | Estado secundario (Completado) |
| M | Incidencias | Notas sobre despachos parciales |
| N | Operador | Conductor asignado |
| O | Unidad | Unidad/Placas del vehículo |
| P | Observaciones | Notas adicionales |

## 🔄 Verificación

Después de configurar la hoja:
1. Recarga la aplicación de Despacho
2. Intenta procesar un despacho de prueba
3. Verifica que se sincronice correctamente
4. Revisa que aparezca en la hoja "Despachos" de Google Sheets

## ⚠️ Notas Importantes

- El sistema ahora diferencia correctamente entre:
  - **Validación de Surtido** (Val3): Escaneo de cajas en almacén
  - **Despacho**: Asignación de conductor y unidad para envío
  
- Una orden puede estar validada en surtido pero no despachada
- El sistema solo marcará como duplicado si intentas despachar la misma orden dos veces
