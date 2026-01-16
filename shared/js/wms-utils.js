/**
 * WMS-UTILS.JS
 * Funciones compartidas para todo el sistema WMS
 * Evita duplicación de código y asegura homogeneidad
 */

// ==================== NORMALIZACIÓN DE CÓDIGOS ====================

/**
 * Normaliza un código eliminando caracteres especiales y convirtiendo a mayúsculas
 * Soporta patrones complejos de escaneo incluyendo JSON estructurado y variaciones de caracteres especiales
 * @param {string} rawCode - Código sin procesar
 * @returns {string} - Código normalizado
 */
/**
 * Normaliza un código para ESCANEO - incluye procesamiento completo de patrones
 * NOTA: Esta función solo debe usarse durante escaneo, NO durante carga de datos
 * @param {string} rawCode - Código sin procesar
 * @param {boolean} verbose - Si true, muestra logs (default: false)
 * @returns {string} - Código normalizado
 */
function normalizeCode(rawCode, verbose = false) {
    if (!rawCode) return '';

    let code = String(rawCode).trim();

    // Remove control characters and scanner prefixes
    code = code.replace(/[\x00-\x1F\x7F]/g, '');
    code = code.replace(/^GS1:|^\]C1|^\]E0|^\]d2/i, '');

    // PRIORIDAD MÁXIMA: Detectar JSON válido primero (antes de normalizar caracteres)
    // Ejemplo: {"ID":"49570640/2","REFERENCE_ID":"49570640/2",...}
    const jsonMatch = code.match(/"ID"\s*:\s*"(\d+[\/\-]\d+)"/i);
    if (jsonMatch && jsonMatch[1]) {
        if (verbose) console.log(` [WMS-UTILS] Código extraído de JSON: ${jsonMatch[1]}`);
        return jsonMatch[1];
    }

    // Normalizar caracteres especiales comunes en scanners
    code = code.replace(/ö/gi, 'o');
    code = code.replace(/ï/gi, 'i');
    code = code.replace(/Ñ/g, ':');  // Ñ suele ser : en estos formatos
    code = code.replace(/ñ/g, ':');
    code = code.replace(/\^/g, '');
    code = code.replace(/¨/g, '"');
    code = code.replace(/\[/g, '"'); // [ suele representar " en escáneres
    code = code.replace(/\]/g, '"');

    // Normalizar separadores alternativos
    code = code.replace(/\'/g, '/');
    code = code.replace(/\*/g, '');  // Asteriscos son terminadores, no separadores
    code = code.replace(/&/g, '/');

    // Normalizar comillas raras
    code = code.replace(/[""«»„‟‚‛''¨]/g, '"');

    // Eliminar caracteres intermedios problemáticos
    code = code.replace(/\?/g, '_');  // ? suele ser _ en estos formatos

    // Convertir a mayúsculas para búsqueda de patrones
    const codeUpper = code.toUpperCase();

    // PRIORIDAD ALTA: Patrones específicos para formatos de escáner con caracteres especiales
    // Estos patrones buscan el ID/REFERENCE_ID en formatos como:
    // ^¨id¨Ñ¨50323850-9¨ → después de normalizar: "ID":"50323850-9"
    // ¨[ID[ñ [50336999-4[ → después de normalizar: "ID": "50336999-4"
    const complexPatterns = [
        // Patrón JSON normalizado: "ID":"CODIGO" o "ID" : "CODIGO"
        /"ID"\s*:\s*"?(\d+[\/\-]\d+)"?/i,

        // Patrón REFERENCE_ID (alternativo)
        /"REFERENCE_ID"\s*:\s*"?(\d+[\/\-]\d+)"?/i,

        // Patrón 1: [ID[N [CODIGO[ con separador - captura completa
        /\[ID\[N\s*\[([\d]+[\/\-][\d]+)/i,
        /\[ID\[.*?\[([\d]+[\/\-][\d]+)/i,

        // Patrón 2: "[ID"N"CODIGO" con separador
        /"\[ID"N"([\d]+[\/\-][\d]+)/i,
        /"\[ID".*?"([\d]+[\/\-][\d]+)/i,

        // Patrón 3: JSON con "id":"CODIGO"
        /"ID"\s*[N:"]+\s*"([\d]+[\/\-][\d]+)"/i,
        /"CODE"\s*:\s*"([^"]+)"/i,

        // Patrón 4: ID seguido de código (después de normalización)
        /\bID\s*:\s*"?(\d+[\/\-]\d+)/i,
        /\bID"?"?(\d+[\/\-]\d+)/i,

        // Patrón 5: Código al inicio con separador
        /^"?(\d+[\/\-]\d+)"?/,

        // Patrón 6: Secuencia numérica con separador en cualquier parte del string
        // (6+ dígitos + separador + 1-4 dígitos)
        /(\d{6,}[\/\-]\d{1,4})/
    ];

    for (const pattern of complexPatterns) {
        const match = codeUpper.match(pattern);
        if (match && match[1]) {
            const extracted = match[1].replace(/"/g, ''); // Limpiar comillas residuales
            // Validar formato: números + separador + números (más flexible)
            if (/^\d{6,}[\/\-]\d{1,4}$/.test(extracted)) {
                if (verbose) console.log(` [WMS-UTILS] Código extraído con separador: ${extracted}`);
                return extracted; // PRESERVAR el separador original
            }
        }
    }

    // Patrón especial: IDxxxxxx-xx... → extraer solo xxxxxx-xx
    const idPattern = /^ID(\d+[-\/]\d+)/i;
    const idMatch = codeUpper.match(idPattern);
    if (idMatch) {
        if (verbose) console.log(` [WMS-UTILS] Código extraído de patrón ID: ${idMatch[1]}`);
        return idMatch[1]; // PRESERVAR el separador
    }

    // CRÍTICO: NO eliminar separadores - solo limpiar ruido
    // Eliminar caracteres especiales EXCEPTO guiones, slashes y alfanuméricos
    const cleaned = codeUpper.replace(/[^A-Z0-9\-\/]/g, '');

    return cleaned;
}

/**
 * Normalización RÁPIDA para carga de datos (sin patrones complejos ni logs)
 * Optimizada para procesar miles de registros rápidamente
 * @param {string} rawCode - Código sin procesar
 * @returns {string} - Código normalizado (solo mayúsculas y limpieza básica)
 */
function normalizeCodeFast(rawCode) {
    if (!rawCode) return '';
    // Solo trim, mayúsculas y eliminar caracteres no alfanuméricos (excepto - y /)
    return String(rawCode).trim().toUpperCase().replace(/[^A-Z0-9\-\/]/g, '');
}

/**
 * Extrae el código base (sin sufijos) para búsquedas flexibles
 * Remueve sufijos numéricos, slashes, guiones y variantes comunes
 *
 * @param {string} code - Código normalizado
 * @returns {string} - Código base sin sufijos
 *
 * @example
 * // Sufijos con slash (/)
 * extractBaseCode('58470794/1')          → '58470794'
 * extractBaseCode('50243727/36')         → '50243727'
 *
 * // Sufijos con guión (-)
 * extractBaseCode('58470794-A')          → '58470794'
 *
 * // Sufijos U + dígitos
 * extractBaseCode('FBA178RH0NL9U000001') → 'FBA178RH0NL9'
 * extractBaseCode('FBA178RH0NL9U001')    → 'FBA178RH0NL9'
 * extractBaseCode('FBA178RH0NL9U01')     → 'FBA178RH0NL9'
 * extractBaseCode('xzh2509038316u001')   → 'XZH2509038316'
 * extractBaseCode('xzh2509038316u011')   → 'XZH2509038316'
 * extractBaseCode('xzh2509038316u100')   → 'XZH2509038316'
 *
 * // Secuencias de 2-8 ceros + dígitos
 * extractBaseCode('ABC12300')            → 'ABC123'
 * extractBaseCode('ABC123000')           → 'ABC123'
 * extractBaseCode('ABC1230001')          → 'ABC123'
 * extractBaseCode('ABC123000001')        → 'ABC123'
 * extractBaseCode('XYZ00000000')         → 'XYZ'
 */
function extractBaseCode(code) {
    if (!code) return '';

    // Convertir a mayúsculas para procesamiento consistente
    let baseCode = code.toUpperCase();

    // Paso 1: Remover todo después de "/" (número de caja con slash)
    baseCode = baseCode.split('/')[0];

    // Paso 2: Remover todo después de "-" (sufijos con guión)
    baseCode = baseCode.split('-')[0];

    // Paso 3: Remover sufijos con patrón U + cualquier cantidad de dígitos
    // Ejemplos:
    //   FBA178RH0NL9U000001 → FBA178RH0NL9
    //   FBA178RH0NL9U001    → FBA178RH0NL9
    //   FBA178RH0NL9U01     → FBA178RH0NL9
    //   xzh2509038316u001   → xzh2509038316 (case insensitive)
    //   xzh2509038316u011   → xzh2509038316
    //   xzh2509038316u100   → xzh2509038316
    const uSuffixMatch = baseCode.match(/^(.+?)U\d+$/);
    if (uSuffixMatch) {
        baseCode = uSuffixMatch[1];
    }

    // Paso 4: Remover secuencias numéricas con 2-8 ceros al final seguidos de dígitos
    // Ejemplos:
    //   
    //   ABC123000 → ABC123     (3 ceros)
    //   ABC1230001 → ABC123    (3 ceros + 1)
    //   ABC12300001 → ABC123   (4 ceros + 1)
    //   ABC123000001 → ABC123  (5 ceros + 1)
    //   XYZ00000000 → XYZ      (8 ceros)
    const longZeroMatch = baseCode.match(/^(.+?)0{3,8}\d*$/);
    if (longZeroMatch) {
        baseCode = longZeroMatch[1];
    }

    // Retornar en el mismo case que el original
    return baseCode || code.toUpperCase();
}

/**
 * Genera variantes de un código para búsqueda inteligente
 * @param {string} code - Código normalizado
 * @returns {Array<string>} - Array de variantes
 */
function generateCodeVariations(code) {
    if (!code) return [];
    
    const variations = [code];
    
    // Variante con guiones convertidos a slashes
    if (code.includes('-')) {
        variations.push(code.replace(/-/g, '/'));
    }
    
    // Variante con slashes convertidos a guiones
    if (code.includes('/')) {
        variations.push(code.replace(/\//g, '-'));
    }
    
    // Código base
    const baseCode = extractBaseCode(code);
    if (baseCode !== code) {
        variations.push(baseCode);
    }
    
    return [...new Set(variations)]; // Eliminar duplicados
}

/**
 * Busca un código en un inventario Map con búsqueda inteligente
 * @param {string} rawCode - Código sin procesar
 * @param {Map} inventory - Map de inventario
 * @returns {Object} - {code: string, item: object|null, variant: string}
 */
function findCodeInInventory(rawCode, inventory) {
    const normalized = normalizeCode(rawCode);
    
    // 1. Intentar búsqueda directa
    let item = inventory.get(normalized);
    if (item) {
        return { code: normalized, item, variant: 'original' };
    }
    
    // 2. Intentar con guión si tiene slash
    if (normalized.includes('/')) {
        const withDash = normalized.replace(/\//g, '-');
        item = inventory.get(withDash);
        if (item) {
            return { code: withDash, item, variant: 'dash' };
        }
    }
    
    // 3. Intentar con slash si tiene guión
    if (normalized.includes('-')) {
        const withSlash = normalized.replace(/-/g, '/');
        item = inventory.get(withSlash);
        if (item) {
            return { code: withSlash, item, variant: 'slash' };
        }
    }
    
    // 4. No encontrado
    return { code: normalized, item: null, variant: 'none' };
}

// ==================== VALIDACIÓN DE UBICACIONES ====================

/**
 * Normaliza una ubicación aplicando las reglas del sistema
 * Reglas:
 * - Convierte comillas simples a guiones: A26'06'01'02 → A26-06-01-02
 * - Zona (primer número): NO requiere cero a la izquierda si < 10
 * - Resto de números: SÍ requieren cero a la izquierda (01-99)
 * - Ejemplo: A1-1-1-1 → A1-01-01-01
 * 
 * @param {string} location - Ubicación sin normalizar
 * @returns {string} - Ubicación normalizada
 */
function normalizeLocation(location) {
    if (!location || typeof location !== 'string') return '';
    
    return location
        .trim()
        .toUpperCase()
        .replace(/['´`'\/]/g, '-')  // Comillas y slashes a guiones
        .replace(/\s+/g, '');        // Eliminar espacios
}

/**
 * Valida el formato de una ubicación de almacén con reglas estrictas de negocio
 * Formato: {Area}{Aisle}-{Rack}-{Level}-{Position}
 * 
 * REGLAS ESTRICTAS:
 * - Areas permitidas: A, B, C, D (solo mayúsculas)
 * - Aisles (Pasillos): mínimo 1, máximo 32
 * - Racks (Estantes): mínimo 01, máximo 20 (2 dígitos con padding)
 * - Levels (Niveles): mínimo 01, máximo 06 (2 dígitos con padding)
 * - Positions (Posiciones): mínimo 01, máximo 02 (2 dígitos con padding)
 * 
 * Ejemplo máximo válido: D32-20-06-02
 * 
 * @param {string} location - Ubicación a validar
 * @returns {Object} - {valid: boolean, normalized: string, parsed: object|null, message: string, original: string}
 */
function validateLocation(location) {
    if (!location || typeof location !== 'string') {
        return {
            valid: false,
            normalized: '',
            parsed: null,
            message: 'Ubicación vacía o inválida',
            original: location
        };
    }
    
    const normalized = normalizeLocation(location);
    
    // Patrón: AREA (A-D) + AISLE (número) + GUION + RACK + GUION + LEVEL + GUION + POSITION
    const pattern = /^([A-D])(\d+)-(\d+)-(\d+)-(\d+)$/;
    const match = normalized.match(pattern);
    
    if (!match) {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Formato incorrecto. Use: {Area}{Aisle}-{Rack}-{Level}-{Position} (ej: A1-01-01-01)',
            original: location
        };
    }
    
    // Extraer componentes
    const [, area, aisle, rack, level, position] = match;
    
    // Validar rangos numéricos
    const aisleNum = parseInt(aisle, 10);
    const rackNum = parseInt(rack, 10);
    const levelNum = parseInt(level, 10);
    const positionNum = parseInt(position, 10);
    
    // Validar Area (solo A, B, C, D)
    if (!['A', 'B', 'C', 'D'].includes(area)) {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Área inválida. Solo se permiten: A, B, C, D',
            original: location
        };
    }
    
    // Validar Aisle (1-32) - NO debe tener ceros a la izquierda
    if (aisleNum < 1 || aisleNum > 32) {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Pasillo inválido. Rango permitido: 1-32',
            original: location
        };
    }
    
    // Rechazar si el pasillo tiene ceros a la izquierda (ej: 07, 01)
    if (aisle.length > 1 && aisle[0] === '0') {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Pasillo no debe tener ceros a la izquierda. Use: A7-11-02-01 (no A07-11-02-01)',
            original: location
        };
    }
    
    // Validar Rack (01-20)
    if (rackNum < 1 || rackNum > 20) {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Rack inválido. Rango permitido: 01-20',
            original: location
        };
    }
    
    // Validar Level (01-06)
    if (levelNum < 1 || levelNum > 6) {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Nivel inválido. Rango permitido: 01-06',
            original: location
        };
    }
    
    // Validar Position (01-02)
    if (positionNum < 1 || positionNum > 2) {
        return {
            valid: false,
            normalized: normalized,
            parsed: null,
            message: 'Posición inválida. Rango permitido: 01-02',
            original: location
        };
    }
    
    // Formatear: aisle SIN padding, resto CON padding de 2 dígitos
    const formatted = `${area}${aisle}-${rack.padStart(2, '0')}-${level.padStart(2, '0')}-${position.padStart(2, '0')}`;
    
    return {
        valid: true,
        normalized: formatted,
        parsed: {
            area,           // A, B, C, o D
            aisle,          // 1-32 (sin padding)
            rack: rack.padStart(2, '0'),       // 01-20
            level: level.padStart(2, '0'),     // 01-06
            position: position.padStart(2, '0'), // 01-02
            formatted
        },
        message: 'Ubicación válida',
        original: location
    };
}

/**
 * Valida y normaliza una ubicación con auto-corrección
 * Si la ubicación es válida pero mal formateada, retorna la versión normalizada
 * @param {string} location - Ubicación a validar
 * @returns {Object} - {valid: boolean, normalized: string, needsCorrection: boolean, original: string}
 */
function validateAndNormalizeLocation(location) {
    const validation = validateLocation(location);
    
    if (validation.valid) {
        const needsCorrection = validation.normalized !== validation.original.toUpperCase();
        return {
            valid: true,
            normalized: validation.normalized,
            needsCorrection,
            original: location,
            parsed: validation.parsed
        };
    }
    
    return {
        valid: false,
        normalized: validation.normalized,
        needsCorrection: false,
        original: location,
        parsed: null,
        message: validation.message
    };
}

// ==================== AUDIO FEEDBACK ====================

let audioContext = null;

/**
 * Inicializa el contexto de audio
 */
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        document.addEventListener('click', () => {
            if (audioContext?.state === 'suspended') {
                audioContext.resume();
            }
        }, { once: true });
    } catch (e) {
        console.warn('Audio not supported:', e);
    }
}

/**
 * Reproduce un sonido según el tipo de evento
 * @param {string} type - Tipo de sonido: 'success', 'error', 'warning', 'ok'
 */
function playSound(type) {
    if (!audioContext) return;
    
    try {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        
        if (type === 'success' || type === 'ok') {
            osc.frequency.setValueAtTime(880, audioContext.currentTime);
            osc.start();
            osc.stop(audioContext.currentTime + 0.15);
        } else if (type === 'error') {
            osc.frequency.setValueAtTime(300, audioContext.currentTime);
            osc.frequency.exponentialRampToValueAtTime(150, audioContext.currentTime + 0.3);
            osc.start();
            osc.stop(audioContext.currentTime + 0.35);
        } else if (type === 'warning') {
            osc.frequency.setValueAtTime(600, audioContext.currentTime);
            osc.start();
            osc.stop(audioContext.currentTime + 0.1);
        }
    } catch (e) {
        console.warn('Error playing sound:', e);
    }
}

// ==================== NOTIFICACIONES ====================

/**
 * Muestra una notificación toast
 * @param {string} message - Mensaje a mostrar
 * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duración en ms (default: 4000)
 */
function showNotification(message, type = 'info', duration = 4000) {
    const container = document.getElementById('notifications') || createNotificationContainer();
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `<span style="margin-right: 8px;">${icons[type]}</span>${message}`;
    
    container.appendChild(notification);
    setTimeout(() => notification.remove(), duration);
}

/**
 * Crea el contenedor de notificaciones si no existe
 */
function createNotificationContainer() {
    let container = document.getElementById('notifications');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notifications';
        container.className = 'notification-container';
        document.body.appendChild(container);
    }
    return container;
}

// ==================== UTILIDADES DE FECHA/HORA ====================

/**
 * Obtiene la fecha actual en formato YYYY-MM-DD (LOCAL TIME)
 * @returns {string}
 */
function getCurrentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Obtiene la hora actual en formato HH:MM:SS (LOCAL TIME)
 * @returns {string}
 */
function getCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Obtiene fecha y hora local
 * @returns {Object} - {dateStr: string, timeStr: string}
 */
function getLocalDateTime() {
    return {
        dateStr: getCurrentDate(),
        timeStr: getCurrentTime()
    };
}

/**
 * Obtiene timestamp legible
 * @returns {string}
 */
function getTimestamp() {
    return new Date().toLocaleTimeString();
}

// ==================== GENERADORES DE IDs ====================

/**
 * Genera un ID único para pallet
 * @param {string} prefix - Prefijo (default: 'PLT')
 * @returns {string}
 */
function generatePalletId(prefix = 'PLT') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}-${timestamp}-${random}`;
}

/**
 * Genera un ID único para tab/sesión
 * @returns {string}
 */
function generateTabId() {
    return 'TAB-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
}

// ==================== UTILIDADES DE PORTAPAPELES ====================

/**
 * Copia texto al portapapeles
 * @param {string} text - Texto a copiar
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('📋 Copiado al portapapeles', 'success', 2000);
    } catch (e) {
        // Fallback para navegadores antiguos
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showNotification('📋 Copiado', 'success', 2000);
    }
}

// ==================== UTILIDADES DE CSV ====================

/**
 * Parsea una línea CSV respetando comillas
 * @param {string} line - Línea CSV
 * @returns {Array<string>}
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Convierte array a CSV con BOM para UTF-8
 * @param {Array<Array>} data - Array de arrays
 * @returns {string}
 */
function arrayToCSV(data) {
    const csv = data.map(row => 
        row.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    return '\ufeff' + csv; // BOM para UTF-8
}

/**
 * Descarga un CSV
 * @param {string} csvContent - Contenido CSV
 * @param {string} filename - Nombre del archivo
 */
function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

// ==================== MONITOR DE CONEXIÓN ====================

let isOnline = navigator.onLine;

/**
 * Configura el monitor de conexión a internet
 * @param {Function} callback - Función a llamar cuando cambie el estado
 */
function setupConnectionMonitor(callback) {
    window.addEventListener('online', () => {
        isOnline = true;
        if (callback) callback(true);
    });
    
    window.addEventListener('offline', () => {
        isOnline = false;
        if (callback) callback(false);
    });
}

/**
 * Verifica si hay conexión a internet
 * @returns {boolean}
 */
function checkOnlineStatus() {
    return isOnline;
}

// ==================== VALIDACIÓN DE USO DIARIO DE UBICACIONES ====================

/**
 * Valida si una ubicación ya fue usada hoy en la sesión local
 * @param {string} location - Ubicación a validar
 * @param {Array} history - Historial de registros locales
 * @returns {Object} - {valid: boolean, message: string, usedAt: string|null}
 */
function validateLocationDailyUsage(location, history = []) {
    const today = getCurrentDate();
    const normalizedLocation = normalizeLocation(location);
    
    // Buscar si la ubicación fue usada hoy en el historial local
    const usedToday = history.find(record => {
        const recordDate = record.date || '';
        const recordLocation = normalizeLocation(record.location || '');
        return recordDate === today && recordLocation === normalizedLocation;
    });
    
    if (usedToday) {
        return {
            valid: false,
            message: `Esta ubicación ya fue usada hoy (${usedToday.time || 'hora desconocida'})`,
            usedAt: usedToday.time || null
        };
    }
    
    return {
        valid: true,
        message: 'Ubicación disponible para uso hoy',
        usedAt: null
    };
}

/**
 * Valida si una ubicación ya fue usada hoy en la base de datos
 * @param {string} location - Ubicación a validar
 * @param {Array} dbRecords - Registros de la base de datos (filas del sheet)
 * @returns {Object} - {valid: boolean, message: string, usedAt: string|null, usedBy: string|null}
 */
function validateLocationDailyUsageDB(location, dbRecords = []) {
    const today = getCurrentDate();
    const normalizedLocation = normalizeLocation(location);
    
    // Buscar en registros de la BD (columnas: A=date, B=time, C=user, F=location)
    for (let i = 1; i < dbRecords.length; i++) { // Skip header
        const row = dbRecords[i];
        if (!row || row.length < 6) continue;
        
        const recordDate = row[0] || '';
        const recordTime = row[1] || '';
        const recordUser = row[2] || '';
        const recordLocation = normalizeLocation(row[5] || '');
        
        if (recordDate === today && recordLocation === normalizedLocation) {
            return {
                valid: false,
                message: `Esta ubicación ya fue usada hoy por ${recordUser} a las ${recordTime}`,
                usedAt: recordTime,
                usedBy: recordUser
            };
        }
    }
    
    return {
        valid: true,
        message: 'Ubicación disponible para uso hoy',
        usedAt: null,
        usedBy: null
    };
}

// ==================== EXPORTAR FUNCIONES ====================

// Exponer funciones al ámbito global (window) para compatibilidad
const WMS_UTILS = {
    normalizeCode,
    normalizeCodeFast,
    extractBaseCode,
    generateCodeVariations,
    findCodeInInventory,
    normalizeLocation,
    validateLocation,
    validateAndNormalizeLocation,
    validateLocationDailyUsage,
    validateLocationDailyUsageDB,
    initAudio,
    playSound,
    showNotification,
    getCurrentDate,
    getCurrentTime,
    getLocalDateTime,
    getTimestamp,
    generatePalletId,
    generateTabId,
    copyToClipboard,
    parseCSVLine,
    arrayToCSV,
    downloadCSV,
    setupConnectionMonitor,
    checkOnlineStatus
};

// Si se usa en un navegador, exponer al objeto window
if (typeof window !== 'undefined') {
    Object.assign(window, WMS_UTILS);
}

// Si se usa como módulo ES6/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WMS_UTILS;
}
