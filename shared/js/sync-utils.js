/**
 * SYNC-UTILS.JS
 * Utilidades compartidas para sincronización
 * Funciones auxiliares migradas desde scan.html
 *
 * @version 1.0.0
 */

/**
 * Genera un UUID único
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Genera un timestamp en milisegundos
 */
function generateTimestamp() {
    return Date.now();
}

/**
 * Genera un ID único para pallets con formato: PREFIX-TIMESTAMP-RANDOM
 */
function generatePalletId(prefix = 'PLT') {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substr(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
}

/**
 * Formatea una fecha a string DD/MM/YYYY
 */
function formatDate(date = new Date()) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Formatea una hora a string HH:MM:SS
 */
function formatTime(date = new Date()) {
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

/**
 * Verifica si hay conexión a internet
 */
function checkOnlineStatus() {
    return navigator.onLine;
}

/**
 * Verifica si hay token de Google válido
 */
function hasGoogleToken() {
    return typeof gapi !== 'undefined' && gapi?.client?.getToken() !== null;
}

/**
 * Espera un tiempo determinado (promesa)
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry con backoff exponencial
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelay = 1000) {
    let attempt = 0;
    let delay = initialDelay;

    while (attempt < maxRetries) {
        try {
            attempt++;
            return await fn();
        } catch (error) {
            if (attempt >= maxRetries) {
                throw error;
            }
            console.log(`⏳ Reintento ${attempt}/${maxRetries} en ${delay}ms...`);
            await sleep(delay);
            delay = Math.floor(delay * 1.5); // Backoff exponencial
        }
    }
}

/**
 * Limpia y normaliza un código (elimina caracteres invisibles)
 */
function cleanCode(code) {
    if (code === null || code === undefined) return '';
    return code
        .toString()
        .replace(/[\u200B\uFEFF\u00A0\u2000-\u200F\u2028\u2029]/g, '') // Caracteres invisibles
        .replace(/[\r\n\t]/g, '') // Saltos de línea y tabs
        .trim()
        .toUpperCase();
}

/**
 * Valida formato de código de barras
 */
function validateBarcode(code) {
    const cleaned = cleanCode(code);
    return cleaned.length >= 8 && cleaned.length <= 50;
}

/**
 * Genera un hash simple para deduplicación
 */
function generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(36);
}

/**
 * Formatea bytes a tamaño legible
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Debounce para optimizar llamadas frecuentes
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle para limitar frecuencia de ejecución
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Calcula diferencia de tiempo en formato legible
 */
function getTimeDifference(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} día${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hora${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minuto${minutes > 1 ? 's' : ''}`;
    return `${seconds} segundo${seconds !== 1 ? 's' : ''}`;
}

/**
 * Convierte array de objetos a CSV
 */
function arrayToCSV(data, headers = null) {
    if (!data || data.length === 0) return '';
    
    const rows = [];
    
    // Agregar headers si se proporcionan
    if (headers) {
        rows.push(headers.map(h => `"${h}"`).join(','));
    }
    
    // Agregar datos
    data.forEach(row => {
        const values = Array.isArray(row) ? row : Object.values(row);
        rows.push(values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    });
    
    return rows.join('\n');
}

/**
 * Descarga un archivo CSV
 */
function downloadCSV(data, filename = 'export.csv', headers = null) {
    const csv = arrayToCSV(data, headers);
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Copia texto al portapapeles
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Error copiando al portapapeles:', error);
        return false;
    }
}

/**
 * Obtiene información del navegador
 */
function getBrowserInfo() {
    const ua = navigator.userAgent;
    let browserName = 'Unknown';
    let browserVersion = 'Unknown';
    
    if (ua.indexOf('Firefox') > -1) {
        browserName = 'Firefox';
        browserVersion = ua.match(/Firefox\/(\d+)/)?.[1] || 'Unknown';
    } else if (ua.indexOf('Chrome') > -1) {
        browserName = 'Chrome';
        browserVersion = ua.match(/Chrome\/(\d+)/)?.[1] || 'Unknown';
    } else if (ua.indexOf('Safari') > -1) {
        browserName = 'Safari';
        browserVersion = ua.match(/Version\/(\d+)/)?.[1] || 'Unknown';
    } else if (ua.indexOf('Edge') > -1) {
        browserName = 'Edge';
        browserVersion = ua.match(/Edge\/(\d+)/)?.[1] || 'Unknown';
    }
    
    return { browserName, browserVersion, userAgent: ua };
}

/**
 * Verifica capacidad de IndexedDB
 */
async function checkIndexedDBSupport() {
    try {
        if (!window.indexedDB) {
            return { supported: false, reason: 'IndexedDB no disponible' };
        }
        
        // Test de escritura
        const testDB = await new Promise((resolve, reject) => {
            const request = indexedDB.open('__test__', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('test')) {
                    db.createObjectStore('test');
                }
            };
        });
        
        testDB.close();
        indexedDB.deleteDatabase('__test__');
        
        return { supported: true };
    } catch (error) {
        return { supported: false, reason: error.message };
    }
}

/**
 * Estima espacio disponible en almacenamiento
 */
async function estimateStorageQuota() {
    try {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                quota: estimate.quota,
                usage: estimate.usage,
                available: estimate.quota - estimate.usage,
                percentUsed: ((estimate.usage / estimate.quota) * 100).toFixed(2)
            };
        }
        return null;
    } catch (error) {
        console.error('Error estimando quota de almacenamiento:', error);
        return null;
    }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.SyncUtils = {
        generateUUID,
        generateTimestamp,
        generatePalletId,
        formatDate,
        formatTime,
        checkOnlineStatus,
        hasGoogleToken,
        sleep,
        retryWithBackoff,
        cleanCode,
        validateBarcode,
        generateHash,
        formatBytes,
        debounce,
        throttle,
        getTimeDifference,
        arrayToCSV,
        downloadCSV,
        copyToClipboard,
        getBrowserInfo,
        checkIndexedDBSupport,
        estimateStorageQuota
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        generateUUID,
        generateTimestamp,
        generatePalletId,
        formatDate,
        formatTime,
        checkOnlineStatus,
        hasGoogleToken,
        sleep,
        retryWithBackoff,
        cleanCode,
        validateBarcode,
        generateHash,
        formatBytes,
        debounce,
        throttle,
        getTimeDifference,
        arrayToCSV,
        downloadCSV,
        copyToClipboard,
        getBrowserInfo,
        checkIndexedDBSupport,
        estimateStorageQuota
    };
}
