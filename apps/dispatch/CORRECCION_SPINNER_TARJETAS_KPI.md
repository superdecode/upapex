# Corrección - Spinners en Tarjetas KPI del Modal

## Fecha: 31 de Enero, 2026 (Noche)

## Problema Reportado

Las tarjetas KPI del modal informativo (`.kpi-card-value`) mostraban valores en **cero** cuando los datos de segundo plano (VALIDACION, MNE, TRS) aún no habían terminado de cargar, en lugar de mostrar spinners de carga.

---

## 🎯 OBJETIVO

Mostrar spinners naranjas sutiles en las tarjetas KPI del modal cuando los datos de segundo plano correspondientes aún no están disponibles, y actualizar automáticamente las tarjetas a los valores reales conforme cada dato termine de cargar.

---

## ✅ SOLUCIÓN IMPLEMENTADA

### 1. Renderizado Condicional en Tarjetas KPI

**Ubicación:** [app.js:8342-8367](app.js#L8342-L8367)

Se agregó lógica condicional que verifica el estado de carga de cada fuente de datos antes de renderizar el contenido de las tarjetas:

```javascript
// OPTIMIZACIÓN: Generar contenido de tarjetas según estado de carga de datos
const validacionCardContent = !LOAD_STATE.backgroundData.validacion
    ? `<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
           <div class="spinner-small spinner-orange"></div>
           <span style="font-size: 0.75em; color: #f97316;">Cargando...</span>
       </div>`
    : `${cajasValidadas}/${totalCajas} cajas
       ${totalCajas > 0 ? `
           <div class="kpi-progress">
               <div class="kpi-progress-bar" style="width: ${(cajasValidadas/totalCajas*100).toFixed(0)}%"></div>
           </div>
       ` : ''}`;

const trsCardContent = !LOAD_STATE.backgroundData.trs
    ? `<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
           <div class="spinner-small spinner-orange"></div>
           <span style="font-size: 0.75em; color: #f97316;">Cargando...</span>
       </div>`
    : `${trsCount} relacionados`;

const rastreoCardContent = !LOAD_STATE.backgroundData.mne
    ? `<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
           <div class="spinner-small spinner-orange"></div>
           <span style="font-size: 0.75em; color: #f97316;">Cargando...</span>
       </div>`
    : `${rastreoData.length} cajas`;
```

**Cambios en el HTML de las tarjetas:**

```javascript
// ANTES (mostraba 0):
<div class="kpi-card-value">${cajasValidadas}/${totalCajas} cajas</div>
<div class="kpi-card-value">${trsCount} relacionados</div>
<div class="kpi-card-value">${rastreoData.length} cajas</div>

// DESPUÉS (usa variables condicionales):
<div class="kpi-card-value">${validacionCardContent}</div>
<div class="kpi-card-value">${trsCardContent}</div>
<div class="kpi-card-value">${rastreoCardContent}</div>
```

---

### 2. Función de Actualización Automática

**Ubicación:** [app.js:8280-8311](app.js#L8280-L8311)

Se creó la función `refreshModalKPICardsIfOpen()` que verifica si el modal está abierto y re-renderiza las tarjetas KPI:

```javascript
/**
 * Re-renderiza las tarjetas KPI del modal si el modal está abierto actualmente
 * Se llama cuando los datos de segundo plano (VALIDACION, MNE, TRS) terminan de cargar
 */
function refreshModalKPICardsIfOpen() {
    // Verificar si el modal está abierto y hay una orden actual
    const modal = document.getElementById('info-modal');
    if (!modal || modal.style.display === 'none' || !STATE.currentOrder) {
        return; // Modal cerrado, no hacer nada
    }

    // Obtener datos actuales de la orden
    let orderData = STATE.obcData.get(STATE.currentOrder);
    if (!orderData) {
        const validatedRecord = STATE.localValidated.find(v => v.orden === STATE.currentOrder);
        if (validatedRecord) {
            orderData = {
                orden: validatedRecord.orden,
                recipient: validatedRecord.destino,
                expectedArrival: validatedRecord.horario,
                totalCajas: validatedRecord.totalCajas || 0,
                referenceNo: validatedRecord.referenceNo || '',
                trackingCode: validatedRecord.trackingCode || ''
            };
        }
    }

    if (orderData) {
        console.log(`🔄 [MODAL] Actualizando tarjetas KPI para ${STATE.currentOrder} (datos de segundo plano listos)`);
        renderKPICards(orderData);
    }
}
```

**Características:**
- ✅ Verifica que el modal esté abierto (`modal.style.display !== 'none'`)
- ✅ Verifica que exista una orden actual (`STATE.currentOrder`)
- ✅ Obtiene los datos de la orden (desde `STATE.obcData` o `STATE.localValidated`)
- ✅ Re-renderiza las tarjetas KPI con los datos actualizados
- ✅ Registra en consola cuando actualiza (para debug)

---

### 3. Llamadas de Actualización en Background Loading

**Ubicación:** [app.js:2521-2522, 2545-2546, 2569-2570](app.js#L2521-L2570)

Se agregaron llamadas a `refreshModalKPICardsIfOpen()` después de que cada fuente de datos termina de cargar:

```javascript
// Después de cargar VALIDACION
LOAD_STATE.backgroundData.validacion = true;
completedCount++;
console.log('✅ [BACKGROUND] VALIDACION cargada');
// ... re-render tables ...
refreshModalKPICardsIfOpen(); // ← NUEVO

// Después de cargar MNE
LOAD_STATE.backgroundData.mne = true;
completedCount++;
console.log('✅ [BACKGROUND] MNE cargada');
refreshModalKPICardsIfOpen(); // ← NUEVO

// Después de cargar TRS
LOAD_STATE.backgroundData.trs = true;
completedCount++;
console.log('✅ [BACKGROUND] TRS cargada');
refreshModalKPICardsIfOpen(); // ← NUEVO
```

---

## 🔄 FLUJO DE FUNCIONAMIENTO

### Escenario 1: Usuario Abre Modal ANTES de que Datos Estén Listos

1. Usuario da click en una orden para ver el modal
2. `showOrderInfo()` → `renderKPICards()` se ejecuta
3. `LOAD_STATE.backgroundData.validacion = false` → Muestra **spinner naranja** en tarjeta Validación
4. `LOAD_STATE.backgroundData.mne = false` → Muestra **spinner naranja** en tarjeta Rastreo
5. `LOAD_STATE.backgroundData.trs = false` → Muestra **spinner naranja** en tarjeta TRS
6. Usuario ve 3 tarjetas con spinners mientras los datos cargan

**Actualización Progresiva:**
- 2 segundos después: VALIDACION termina → `refreshModalKPICardsIfOpen()` → Tarjeta Validación muestra **"15/20 cajas"**
- 4 segundos después: MNE termina → `refreshModalKPICardsIfOpen()` → Tarjeta Rastreo muestra **"18 cajas"**
- 6 segundos después: TRS termina → `refreshModalKPICardsIfOpen()` → Tarjeta TRS muestra **"12 relacionados"**

### Escenario 2: Usuario Abre Modal DESPUÉS de que Datos Estén Listos

1. Datos de segundo plano ya terminaron de cargar (`LOAD_STATE.backgroundData.isComplete = true`)
2. Usuario abre modal
3. `renderKPICards()` detecta que datos están listos
4. Muestra valores reales inmediatamente:
   - Validación: "15/20 cajas" con barra de progreso
   - TRS: "12 relacionados"
   - Rastreo: "18 cajas"
5. **No se muestran spinners** porque los datos ya existen

### Escenario 3: Modal Cerrado Durante Carga

1. Usuario abre modal → Ve spinners
2. Usuario cierra modal antes de que terminen de cargar los datos
3. VALIDACION termina de cargar → `refreshModalKPICardsIfOpen()` se ejecuta
4. Función detecta que `modal.style.display === 'none'`
5. **No hace nada** (evita errores de renderizado en modal cerrado)
6. Si usuario vuelve a abrir modal, ya verá los valores reales (porque los datos ya están cargados)

---

## 📋 TARJETAS AFECTADAS

### Tarjeta de Validación (✅)
- **Depende de:** `LOAD_STATE.backgroundData.validacion`
- **Spinner cuando:** `!LOAD_STATE.backgroundData.validacion`
- **Valor real:** `${cajasValidadas}/${totalCajas} cajas` + barra de progreso
- **Fuente de datos:** `STATE.validacionData.get(orden)`

### Tarjeta de TRS (🔄)
- **Depende de:** `LOAD_STATE.backgroundData.trs`
- **Spinner cuando:** `!LOAD_STATE.backgroundData.trs`
- **Valor real:** `${trsCount} relacionados`
- **Fuente de datos:** `STATE.trsData` (búsqueda cruzada por códigos de cajas)

### Tarjeta de Rastreo (📍)
- **Depende de:** `LOAD_STATE.backgroundData.mne`
- **Spinner cuando:** `!LOAD_STATE.backgroundData.mne`
- **Valor real:** `${rastreoData.length} cajas`
- **Fuente de datos:** `STATE.mneData.get(orden)`

### Tarjetas NO Afectadas

#### Orden (📦)
- **No requiere spinner** - datos siempre disponibles desde `orderData.orden`
- Se carga en foreground (datos críticos bloqueantes)

#### Destino (🏢)
- **No requiere spinner** - datos siempre disponibles desde `orderData.recipient`
- Se carga en foreground (datos críticos bloqueantes)

---

## 🎨 DISEÑO VISUAL

### Spinner de Carga
```html
<div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
    <div class="spinner-small spinner-orange"></div>
    <span style="font-size: 0.75em; color: #f97316;">Cargando...</span>
</div>
```

**Características:**
- Color naranja tenue (`#f97316` con opacity 0.8)
- Texto pequeño (0.75em)
- Centrado horizontal y vertical
- Gap de 6px entre spinner y texto
- Clase `.spinner-orange` (ya existente en [styles.css:607-611](styles.css#L607-L611))

---

## 🧪 CASOS DE PRUEBA

### Prueba 1: Modal Antes de Carga Completa
**Pasos:**
1. Recargar página (`F5`)
2. Iniciar despacho con fecha actual
3. **Inmediatamente** (1-2 segundos después) dar click en cualquier orden para abrir modal
4. Observar tarjetas KPI

**Resultado Esperado:**
- ✅ Tarjeta Orden muestra número de orden (sin spinner)
- ✅ Tarjeta Destino muestra nombre de destino (sin spinner)
- 🔄 Tarjeta Validación muestra spinner naranja + "Cargando..."
- 🔄 Tarjeta TRS muestra spinner naranja + "Cargando..."
- 🔄 Tarjeta Rastreo muestra spinner naranja + "Cargando..."
- ✅ Después de 2-10 segundos, spinners se reemplazan por valores reales progresivamente

### Prueba 2: Modal Después de Carga Completa
**Pasos:**
1. Recargar página (`F5`)
2. Iniciar despacho con fecha actual
3. **Esperar 15 segundos** hasta ver mensaje en consola: `✅ [BACKGROUND] Todas las bases pesadas cargadas exitosamente`
4. Dar click en cualquier orden para abrir modal

**Resultado Esperado:**
- ✅ Todas las tarjetas muestran valores reales inmediatamente
- ✅ **No aparecen spinners** en ninguna tarjeta
- ✅ Tarjeta Validación muestra "X/Y cajas" con barra de progreso
- ✅ Tarjeta TRS muestra "X relacionados"
- ✅ Tarjeta Rastreo muestra "X cajas"

### Prueba 3: Cerrar y Re-Abrir Modal
**Pasos:**
1. Abrir modal mientras aún cargan datos (spinners visibles)
2. Cerrar modal
3. Esperar 5 segundos
4. Volver a abrir el mismo modal

**Resultado Esperado:**
- ✅ Modal se abre con valores reales (sin spinners)
- ✅ No hay errores en consola durante el tiempo que estuvo cerrado
- ✅ Mensaje en consola: `🔄 [MODAL] Actualizando tarjetas KPI para OBC123...` (cada vez que datos terminan de cargar mientras modal estaba abierto)

### Prueba 4: Múltiples Órdenes
**Pasos:**
1. Abrir modal de Orden A (con spinners porque datos aún cargan)
2. Cerrar modal de Orden A
3. Abrir modal de Orden B

**Resultado Esperado:**
- ✅ Modal de Orden B muestra spinners en tarjetas correspondientes
- ✅ Cuando datos terminan de cargar, modal de Orden B se actualiza automáticamente
- ✅ `STATE.currentOrder` se actualiza correctamente a Orden B

---

## 📊 LOGS DE DEBUG

### Al Actualizar Tarjetas KPI

```javascript
🔄 [MODAL] Actualizando tarjetas KPI para OBC123 (datos de segundo plano listos)
```

**Cuándo aparece:**
- Cuando VALIDACION termina de cargar y modal está abierto
- Cuando MNE termina de cargar y modal está abierto
- Cuando TRS termina de cargar y modal está abierto

**No aparece si:**
- Modal está cerrado
- No hay orden actual (`STATE.currentOrder === null`)

---

## 🔗 INTEGRACIÓN CON ARQUITECTURA EXISTENTE

### Relación con Optimización de Carga de Segundo Plano

Esta corrección se integra perfectamente con [OPTIMIZACION_CARGA_SEGUNDO_PLANO.md](OPTIMIZACION_CARGA_SEGUNDO_PLANO.md):

- ✅ Usa el mismo sistema de flags `LOAD_STATE.backgroundData`
- ✅ Respeta la arquitectura de carga en dos niveles (foreground/background)
- ✅ Se integra con `loadHeavyReferenceDataInBackground()`
- ✅ Muestra feedback visual consistente con el indicador de la sidebar
- ✅ Usa el mismo spinner naranja sutil (`.spinner-orange`)

### Relación con Correcciones de Pestañas y Surtido

Complementa [CORRECCION_CRITICA_PESTANAS_Y_SURTIDO.md](CORRECCION_CRITICA_PESTANAS_Y_SURTIDO.md):

- ✅ Ambas correcciones usan spinners naranjas para VALIDACION
- ✅ Consistencia visual entre columna de surtido (tabla) y tarjeta de validación (modal)
- ✅ Mismo patrón de renderizado condicional basado en `LOAD_STATE.backgroundData`

---

## ⚠️ CONSIDERACIONES IMPORTANTES

1. **No afecta tarjetas de datos críticos:**
   - Orden y Destino NUNCA muestran spinners
   - Estos datos se cargan en foreground (bloqueantes)
   - Siempre disponibles al abrir modal

2. **Actualización reactiva:**
   - Las tarjetas se actualizan **automáticamente** cuando datos están listos
   - Usuario no necesita cerrar y volver a abrir el modal
   - Actualización progresiva (VALIDACION → MNE → TRS)

3. **Seguridad en edge cases:**
   - Si modal está cerrado, `refreshModalKPICardsIfOpen()` no hace nada
   - Si `STATE.currentOrder` es null, no intenta renderizar
   - Si `orderData` no existe, busca en `STATE.localValidated` como fallback

4. **Performance:**
   - Re-renderiza solo tarjetas KPI (sección pequeña del DOM)
   - No re-renderiza todo el modal body
   - No genera múltiples re-renders innecesarios

---

## ✅ RESULTADO FINAL

### Antes de la Corrección
```
Tarjeta Validación: 0/0 cajas          ❌ (mostraba cero)
Tarjeta TRS: 0 relacionados             ❌ (mostraba cero)
Tarjeta Rastreo: 0 cajas                ❌ (mostraba cero)
```

### Después de la Corrección

**Durante carga (primeros 2-10 segundos):**
```
Tarjeta Validación: [spinner naranja] Cargando...  ✅
Tarjeta TRS: [spinner naranja] Cargando...         ✅
Tarjeta Rastreo: [spinner naranja] Cargando...     ✅
```

**Después de carga (datos listos):**
```
Tarjeta Validación: 15/20 cajas [████░░] 75%  ✅
Tarjeta TRS: 12 relacionados                   ✅
Tarjeta Rastreo: 18 cajas                      ✅
```

---

## 📝 RESUMEN DE CAMBIOS

| Archivo | Líneas Modificadas | Descripción |
|---------|-------------------|-------------|
| `app.js` | 8280-8311 | Agregada función `refreshModalKPICardsIfOpen()` |
| `app.js` | 8342-8367 | Lógica condicional para contenido de tarjetas (spinners vs valores) |
| `app.js` | 8388, 8395, 8402 | Uso de variables condicionales en HTML de tarjetas |
| `app.js` | 2522 | Llamada a `refreshModalKPICardsIfOpen()` después de VALIDACION |
| `app.js` | 2546 | Llamada a `refreshModalKPICardsIfOpen()` después de MNE |
| `app.js` | 2570 | Llamada a `refreshModalKPICardsIfOpen()` después de TRS |

**Total:** 1 nueva función, 3 variables condicionales, 3 llamadas de actualización

---

## 🚀 PRÓXIMOS PASOS

1. **Recargar página** y probar los 4 casos de prueba
2. **Verificar en consola** que aparecen los logs `🔄 [MODAL] Actualizando tarjetas KPI...`
3. **Confirmar** que spinners naranjas aparecen correctamente
4. **Validar** que valores reales se muestran después de que datos cargan
5. **Reportar** cualquier anomalía o comportamiento inesperado

---

**Corrección completada el 31 de Enero, 2026**

Las tarjetas KPI del modal ahora muestran spinners naranjas sutiles mientras los datos de segundo plano cargan, y se actualizan automáticamente a los valores reales conforme cada fuente de datos termina de cargar.
