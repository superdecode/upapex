/**
 * WMS-UTILS.JS
 * Funciones compartidas para todo el sistema WMS
 * Evita duplicación de código y asegura homogeneidad
 */

// ==================== NORMALIZACIÓN DE CÓDIGOS ====================

/**
 * Normaliza un código eliminando caracteres especiales y convirtiendo a mayúsculas
 * @param {string} rawCode - Código sin procesar
 * @returns {string} - Código normalizado
 */
function normalizeCode(rawCode) {
    if (!rawCode) return '';
    
    let code = rawCode.trim().toUpperCase();
    
    // Patrones de extracción especiales (JSON, etc)
    const jsonMatch = code.match(/"code"\s*:\s*"([^"]+)"/i);
    if (jsonMatch) {
        code = jsonMatch[1];
    }
    
    // Eliminar caracteres especiales excepto guiones y slashes
    code = code.replace(/[^A-Z0-9\-\/]/g, '');
    
    return code;
}

/**
 * Extrae el código base (sin sufijos) para búsquedas flexibles
 * @param {string} code - Código normalizado
 * @returns {string} - Código base
 */
function extractBaseCode(code) {
    if (!code) return '';
    
    // Remover sufijos comunes: -A, -B, -01, etc.
    const baseMatch = code.match(/^([A-Z0-9]+?)(?:-[A-Z0-9]{1,2})?$/);
    return baseMatch ? baseMatch[1] : code;
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
 * Valida el formato de una ubicación de almacén
 * Formato: [LETRA][NÚMERO]-[NÚMERO]-[NÚMERO]-[NÚMERO]
 * Ejemplo: A21-06-05-01
 * 
 * @param {string} location - Ubicación a validar
 * @returns {Object} - {valid: boolean, parsed: object|null, message: string, details: string}
 */
function validateLocation(location) {
    if (!location || typeof location !== 'string') {
        return {
            valid: false,
            parsed: null,
            message: 'Ubicación vacía o inválida',
            details: 'Debes ingresar una ubicación'
        };
    }
    
    const loc = location.trim().toUpperCase();
    
    // Patrón: LETRA + NÚMEROS + GUION + NÚMEROS + GUION + NÚMEROS + GUION + NÚMEROS
    const pattern = /^([A-Z])(\d{1,3})-(\d{1,2})-(\d{1,2})-(\d{1,2})$/;
    const match = loc.match(pattern);
    
    if (!match) {
        // Analizar qué parte falla
        let details = '';
        
        if (!/^[A-Z]/.test(loc)) {
            details = 'Debe comenzar con una letra (área del almacén)';
        } else if (!loc.includes('-')) {
            details = 'Debe incluir guiones separadores (-)';
        } else {
            const parts = loc.split('-');
            if (parts.length !== 4) {
                details = `Debe tener exactamente 4 partes separadas por guiones (tiene ${parts.length})`;
            } else {
                details = 'Verifica que cada parte tenga el formato correcto';
            }
        }
        
        return {
            valid: false,
            parsed: null,
            message: 'Formato de ubicación incorrecto',
            details: details
        };
    }
    
    // Extraer componentes
    const [, area, aisle, rack, level, pallet] = match;
    
    // Formatear con padding
    const formatted = `${area}${aisle.padStart(2, '0')}-${rack.padStart(2, '0')}-${level.padStart(2, '0')}-${pallet.padStart(2, '0')}`;
    
    return {
        valid: true,
        parsed: {
            area,
            aisle: aisle.padStart(2, '0'),
            rack: rack.padStart(2, '0'),
            level: level.padStart(2, '0'),
            pallet: pallet.padStart(2, '0'),
            formatted
        },
        message: 'Ubicación válida',
        details: `Área: ${area}, Pasillo: ${aisle}, Rack: ${rack}, Nivel: ${level}, Palet: ${pallet}`
    };
}

/**
 * Muestra diálogo de confirmación para ubicación inválida (doble confirmación)
 * @param {string} location - Ubicación a confirmar
 * @returns {Object} - {confirmed: boolean, formatted: string|null}
 */
function confirmInvalidLocation(location) {
    const validation = validateLocation(location);
    
    if (validation.valid) {
        return { confirmed: true, formatted: validation.parsed.formatted };
    }
    
    // Primera confirmación
    const firstConfirm = confirm(
        `⚠️ UBICACIÓN CON FORMATO INCORRECTO ⚠️\n\n` +
        `Ubicación ingresada: "${location}"\n\n` +
        `${validation.message}\n` +
        `${validation.details}\n\n` +
        `Formato correcto:\n` +
        `• Área (letra): A, B, C, etc.\n` +
        `• Pasillo (números): 01-99\n` +
        `• Rack (números): 01-99\n` +
        `• Nivel (números): 01-99\n` +
        `• Palet (números): 01-99\n\n` +
        `Ejemplos válidos:\n` +
        `• A21-06-05-01\n` +
        `• B27-01-04-01\n` +
        `• C15-03-02-05\n\n` +
        `¿Estás seguro que deseas usar "${location}"?`
    );
    
    if (!firstConfirm) {
        return { confirmed: false, formatted: null };
    }
    
    // Segunda confirmación (doble check)
    const secondConfirm = confirm(
        `⚠️ SEGUNDA CONFIRMACIÓN REQUERIDA ⚠️\n\n` +
        `Confirma nuevamente que deseas registrar esta ubicación:\n\n` +
        `"${location}"\n\n` +
        `Esta ubicación NO cumple con el formato estándar del almacén.\n\n` +
        `¿CONFIRMAS el uso de esta ubicación?`
    );
    
    return { confirmed: secondConfirm, formatted: secondConfirm ? location.toUpperCase() : null };
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
 * @param {string} type - Tipo de sonido: 'success', 'error', 'warning'
 */
function playSound(type) {
    if (!audioContext) return;
    
    try {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        gain.gain.setValueAtTime(0.3, audioContext.currentTime);
        
        if (type === 'success') {
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
 * Obtiene la fecha actual en formato YYYY-MM-DD
 * @returns {string}
 */
function getCurrentDate() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Obtiene la hora actual en formato HH:MM:SS
 * @returns {string}
 */
function getCurrentTime() {
    return new Date().toTimeString().slice(0, 8);
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

// ==================== EXPORTAR FUNCIONES ====================

// Si se usa como módulo ES6
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        normalizeCode,
        extractBaseCode,
        generateCodeVariations,
        findCodeInInventory,
        validateLocation,
        confirmInvalidLocation,
        initAudio,
        playSound,
        showNotification,
        getCurrentDate,
        getCurrentTime,
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
}
