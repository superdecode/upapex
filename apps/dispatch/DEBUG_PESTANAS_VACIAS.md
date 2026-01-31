# Debug - Pestañas Vacías Después de Correcciones

## Fecha: 31 de Enero, 2026 (Noche)

## Problema Reportado

Después de implementar las correcciones de spinner naranja y optimización de carga, las pestañas **Validadas**, **Otros** y **Folios** vuelven a presentar problemas (vacías o sin datos).

---

## 🔍 LOGS DE DEBUG AGREGADOS

He agregado logs extensivos para diagnosticar el problema. Al recargar la página e iniciar despacho, se mostrarán en la consola:

### 1. Cuando VALIDACION Termina de Cargar

**Ubicación:** [app.js:2507-2520](app.js#L2507-L2520)

```javascript
console.log('🔄 [BACKGROUND] Re-renderizando tablas con datos de VALIDACION...');
console.log(`   - STATE.localValidated.length: ${STATE.localValidated.length}`);
console.log(`   - STATE.validacionData.size: ${STATE.validacionData.size}`);
console.log(`   - STATE.dateFilter.active: ${STATE.dateFilter.active}`);
if (STATE.dateFilter.active) {
    console.log(`   - Rango filtro: ${STATE.dateFilter.startDate} a ${STATE.dateFilter.endDate}`);
}
```

**Qué Verificar:**
- ✅ `STATE.localValidated.length` debe ser > 0 si hay órdenes validadas
- ✅ `STATE.validacionData.size` debe ser > 0 después de cargar VALIDACION
- ✅ `STATE.dateFilter.active` debe ser `true`
- ✅ Rango de filtro debe coincidir con la fecha seleccionada

---

### 2. Al Renderizar Tabla Validadas

**Ubicación:** [app.js:5727-5795](app.js#L5727-L5795)

```javascript
console.log(`🔍 [DEBUG renderValidatedTable] STATE.localValidated.length: ${STATE.localValidated.length}`);
console.log(`🔍 [DEBUG] Después de filtrar Canceladas/No Procesables: ${filteredValidated.length}`);
console.log(`🔍 [DEBUG] Después de filtrar por fecha: ${filteredValidated.length}`);
```

**Qué Verificar:**
- ✅ Primera línea muestra cuántas órdenes validadas hay en total
- ✅ Segunda línea muestra cuántas quedan después de excluir Canceladas/No Procesables
- ✅ Tercera línea muestra cuántas quedan después del filtro de fecha

**Si tercera línea es 0:**
- Significa que las fechas de despacho no coinciden con el rango del filtro
- Verás logs adicionales mostrando qué órdenes están fuera de rango

---

### 3. Detalle de Órdenes Fuera de Rango

**Ubicación:** [app.js:5778-5787](app.js#L5778-L5787)

```javascript
console.log(`⚠️ [DEBUG] Registro sin fecha: ${record.orden}`);
console.log(`⚠️ [DEBUG] Fecha inválida para ${record.orden}: ${fechaDespacho}`);
console.log(`🔍 [DEBUG] Orden ${record.orden} fuera de rango: ${fechaDespacho}...`);
```

**Qué Verificar:**
- ⚠️ Si aparecen registros sin fecha, hay problema en cómo se guardan
- ⚠️ Si aparecen fechas inválidas, hay problema de formato
- 🔍 Si aparecen órdenes fuera de rango, el filtro de fecha está funcionando correctamente pero las órdenes tienen fechas diferentes

---

## 📋 PASOS PARA DIAGNOSTICAR

### Paso 1: Abrir Consola de Desarrollador
1. Presionar `F12` o `Cmd+Option+I` (Mac)
2. Ir a pestaña "Console"
3. Limpiar consola (botón 🚫 o `Ctrl+L`)

### Paso 2: Recargar Página e Iniciar Despacho
1. Recargar página (`F5` o `Cmd+R`)
2. Dar click en "Iniciar Despacho"
3. Seleccionar una fecha (ej: 31/01/2026)
4. Esperar ~10 segundos

### Paso 3: Revisar Logs en Consola
Buscar los siguientes mensajes en orden:

```
📦 [BACKGROUND] Iniciando carga de datos pesados (VALIDACION, MNE, TRS)...
📅 [OPTIMIZACIÓN] VALIDACION se cargará con rango: 2026-01-24 a 2026-01-31
✅ [BACKGROUND] VALIDACION cargada
🔄 [BACKGROUND] Re-renderizando tablas con datos de VALIDACION...
   - STATE.localValidated.length: X
   - STATE.validacionData.size: Y
   - STATE.dateFilter.active: true
   - Rango filtro: 2026-01-31 a 2026-01-31
```

### Paso 4: Ir a Pestaña "Validadas"
1. Dar click en pestaña "Validadas"
2. Buscar en consola:

```
🔍 [DEBUG renderValidatedTable] STATE.localValidated.length: X
🔍 [DEBUG] Después de filtrar Canceladas/No Procesables: Y
🔍 [DEBUG] Después de filtrar por fecha: Z
```

### Paso 5: Analizar Resultados

#### Escenario A: `STATE.localValidated.length: 0`
**Problema:** No hay órdenes validadas en la BD de escritura
**Causa:** BD de escritura está vacía o no se cargó correctamente
**Solución:** Verificar que `fetchValidatedRecordsFromWriteDB()` funciona

#### Escenario B: `Después de filtrar Canceladas/No Procesables: 0`
**Problema:** Todas las órdenes son Canceladas o No Procesables
**Causa:** Solo hay órdenes en pestaña "Otros"
**Solución:** Ir a pestaña "Otros" para verificar que ahí sí aparecen

#### Escenario C: `Después de filtrar por fecha: 0` (pero líneas anteriores > 0)
**Problema:** Filtro de fecha está descartando todas las órdenes
**Causa:** Las fechas de despacho no coinciden con el rango seleccionado
**Solución:** Revisar logs de órdenes fuera de rango:

```
🔍 [DEBUG] Orden OBC123 fuera de rango: 30/01/2026 (2026-01-30)
  no está entre 2026-01-31 y 2026-01-31
```

---

## 🔧 POSIBLES SOLUCIONES SEGÚN ESCENARIO

### Solución Escenario C: Fechas No Coinciden

**Causa Raíz:** Las órdenes fueron validadas en una fecha (ej: 30/01) pero el usuario filtró por otra (ej: 31/01)

**Opciones:**

1. **Ampliar rango de filtro:**
   - En lugar de seleccionar solo 31/01, seleccionar 30/01 a 31/01
   - Esto mostrará órdenes despachadas en ambos días

2. **Verificar fecha de validación:**
   - Las órdenes se marcan con `record.fecha` = fecha de HOY cuando se validan
   - Si validaste una orden ayer (30/01) y filtras por hoy (31/01), NO aparecerá
   - Esto es correcto: el filtro muestra órdenes DESPACHADAS en el rango

3. **Corregir lógica de fecha (si es bug):**
   - Si las órdenes deberían aparecer pero no lo hacen, hay que verificar:
     - ¿`record.fecha` se guarda correctamente?
     - ¿El formato es DD/MM/YYYY?
     - ¿La zona horaria es correcta?

---

## 📊 EJEMPLO DE LOGS ESPERADOS (FUNCIONAMIENTO CORRECTO)

```
📦 [BACKGROUND] Iniciando carga de datos pesados (VALIDACION, MNE, TRS)...
📅 [OPTIMIZACIÓN] VALIDACION se cargará con rango: 2026-01-24 a 2026-01-31
✅ [BACKGROUND] VALIDACION cargada
🔄 [BACKGROUND] Re-renderizando tablas con datos de VALIDACION...
   - STATE.localValidated.length: 15
   - STATE.validacionData.size: 42
   - STATE.dateFilter.active: true
   - Rango filtro: 2026-01-31 a 2026-01-31

🔍 [DEBUG renderValidatedTable] STATE.localValidated.length: 15
🔍 [DEBUG] Después de filtrar Canceladas/No Procesables: 12
🔍 [DEBUG] Después de filtrar por fecha: 8

✅ RESULTADO: 8 órdenes mostradas en pestaña Validadas
```

---

## 📊 EJEMPLO DE LOGS CON PROBLEMA (FECHAS NO COINCIDEN)

```
📦 [BACKGROUND] Iniciando carga de datos pesados (VALIDACION, MNE, TRS)...
📅 [OPTIMIZACIÓN] VALIDACION se cargará con rango: 2026-01-24 a 2026-01-31
✅ [BACKGROUND] VALIDACION cargada
🔄 [BACKGROUND] Re-renderizando tablas con datos de VALIDACION...
   - STATE.localValidated.length: 15
   - STATE.validacionData.size: 42
   - STATE.dateFilter.active: true
   - Rango filtro: 2026-01-31 a 2026-01-31

🔍 [DEBUG renderValidatedTable] STATE.localValidated.length: 15
🔍 [DEBUG] Después de filtrar Canceladas/No Procesables: 12
🔍 [DEBUG] Orden OBC123 fuera de rango: 30/01/2026 (2026-01-30) no está entre 2026-01-31 y 2026-01-31
🔍 [DEBUG] Orden OBC456 fuera de rango: 29/01/2026 (2026-01-29) no está entre 2026-01-31 y 2026-01-31
...
🔍 [DEBUG] Después de filtrar por fecha: 0

❌ PROBLEMA: Todas las órdenes fueron despachadas en fechas anteriores
✅ SOLUCIÓN: Ampliar rango de filtro a 29/01 - 31/01
```

---

## ⚠️ NOTAS IMPORTANTES

1. **El filtro de fecha es CORRECTO:**
   - Muestra órdenes DESPACHADAS en el rango seleccionado
   - Si una orden fue despachada el 30/01 y filtras por 31/01, NO aparece
   - Esto es intencional y lógico

2. **Las pestañas dependen de `STATE.localValidated`:**
   - Este array se carga de la BD de escritura (SPREADSHEET_WRITE)
   - Si está vacío, ninguna pestaña mostrará datos
   - Verificar que la carga inicial funciona correctamente

3. **VALIDACION NO afecta las pestañas vacías:**
   - VALIDACION solo afecta el % de surtido
   - Las pestañas se llenan con `STATE.localValidated`
   - Si las pestañas están vacías, el problema NO es VALIDACION

---

## 📋 CHECKLIST DE VERIFICACIÓN

Antes de reportar problema, verificar:

- [ ] ¿Hay órdenes validadas en la BD de escritura? (verificar Google Sheets)
- [ ] ¿`STATE.localValidated.length` es > 0 en los logs?
- [ ] ¿El rango de filtro coincide con las fechas de las órdenes?
- [ ] ¿Las órdenes son "Validadas" y NO "Canceladas" o "No Procesables"?
- [ ] ¿La fecha de despacho (`record.fecha`) está en formato DD/MM/YYYY?
- [ ] ¿Esperaste ~10 segundos para que VALIDACION termine de cargar?

---

## 🚀 PRÓXIMOS PASOS

1. **Recargar página** y seguir los pasos de diagnóstico
2. **Copiar logs de consola** (los mensajes que empiezan con 🔍, ⚠️, ✅)
3. **Reportar hallazgos:**
   - ¿Cuántas órdenes en `STATE.localValidated`?
   - ¿Cuántas después de filtrar por fecha?
   - ¿Qué fechas tienen las órdenes que están fuera de rango?
4. **Verificar en Google Sheets** si las órdenes existen y tienen `fecha` correcta

Con esta información podremos identificar si:
- A) El filtro está funcionando correctamente pero el usuario espera ver órdenes de otras fechas
- B) Hay un bug real en el filtrado que necesita corrección
