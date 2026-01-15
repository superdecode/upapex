/**
 * DISTRIBUTED-LOCK-MANAGER.JS
 * Sistema de locks distribuidos para prevenir condiciones de carrera en escrituras concurrentes
 *
 * Funcionalidad:
 * - Lock distribuido usando celda de control en Google Sheets
 * - Token único (UUID + timestamp) por cada cliente
 * - TTL de 30 segundos para prevenir deadlocks
 * - Renovación automática cada 10 segundos
 * - Force-release si el lock expira
 * - Release automático en beforeunload
 */

class DistributedLockManager {
    constructor(config = {}) {
        this.spreadsheetId = config.spreadsheetId || '';
        this.controlSheet = config.controlSheet || 'ControlSheet';
        this.controlCell = config.controlCell || 'A1';
        this.lockTTL = config.lockTTL || 30000;           // 30 segundos
        this.renewInterval = config.renewInterval || 10000; // 10 segundos
        this.maxWaitTime = config.maxWaitTime || 60000;   // 60 segundos máximo de espera

        this.lockToken = null;
        this.lockAcquired = false;
        this.renewalTimer = null;
        this.lockTimestamp = null;

        // Bind methods
        this._handleBeforeUnload = this._handleBeforeUnload.bind(this);

        // Auto-release al cerrar/recargar página
        window.addEventListener('beforeunload', this._handleBeforeUnload);
    }

    /**
     * Genera un token único para este cliente
     */
    _generateToken() {
        const uuid = this._generateUUID();
        const timestamp = Date.now();
        return `${uuid}_${timestamp}`;
    }

    /**
     * Genera UUID simple
     */
    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Lee el lock actual de la celda de control
     */
    async _readLock() {
        try {
            const range = `${this.controlSheet}!${this.controlCell}`;
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: range
            });

            const values = response.result.values;
            if (!values || values.length === 0 || !values[0] || !values[0][0]) {
                return null; // Celda vacía, no hay lock
            }

            const lockData = values[0][0];

            // Formato esperado: "TOKEN_TIMESTAMP"
            const parts = lockData.split('_');
            if (parts.length < 2) {
                console.warn('⚠️ [LOCK] Formato de lock inválido:', lockData);
                return null;
            }

            const timestamp = parseInt(parts[parts.length - 1]);
            if (isNaN(timestamp)) {
                console.warn('⚠️ [LOCK] Timestamp inválido:', lockData);
                return null;
            }

            return {
                token: lockData,
                timestamp: timestamp
            };
        } catch (error) {
            console.error('❌ [LOCK] Error leyendo lock:', error);
            throw error;
        }
    }

    /**
     * Escribe el lock en la celda de control
     */
    async _writeLock(token) {
        try {
            const range = `${this.controlSheet}!${this.controlCell}`;
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: range,
                valueInputOption: 'RAW',
                resource: {
                    values: [[token]]
                }
            });

            console.log('🔒 [LOCK] Lock escrito:', token.substring(0, 20) + '...');
            return true;
        } catch (error) {
            console.error('❌ [LOCK] Error escribiendo lock:', error);
            throw error;
        }
    }

    /**
     * Limpia la celda de control
     */
    async _clearLock() {
        try {
            const range = `${this.controlSheet}!${this.controlCell}`;
            await gapi.client.sheets.spreadsheets.values.clear({
                spreadsheetId: this.spreadsheetId,
                range: range
            });

            console.log('🔓 [LOCK] Lock liberado');
            return true;
        } catch (error) {
            console.error('❌ [LOCK] Error limpiando lock:', error);
            throw error;
        }
    }

    /**
     * Verifica si el lock ha expirado
     */
    _isLockExpired(lockTimestamp) {
        const now = Date.now();
        const age = now - lockTimestamp;
        return age > this.lockTTL;
    }

    /**
     * Renueva el lock (actualiza timestamp)
     */
    async _renewLock() {
        if (!this.lockAcquired || !this.lockToken) {
            console.warn('⚠️ [LOCK] No se puede renovar: lock no adquirido');
            return false;
        }

        try {
            // Generar nuevo token con timestamp actualizado
            const newToken = this._generateToken();
            await this._writeLock(newToken);

            this.lockToken = newToken;
            this.lockTimestamp = Date.now();

            console.log('🔄 [LOCK] Lock renovado');
            return true;
        } catch (error) {
            console.error('❌ [LOCK] Error renovando lock:', error);
            return false;
        }
    }

    /**
     * Inicia renovación automática del lock
     */
    _startRenewal() {
        if (this.renewalTimer) {
            clearInterval(this.renewalTimer);
        }

        this.renewalTimer = setInterval(async () => {
            try {
                await this._renewLock();
            } catch (error) {
                console.error('❌ [LOCK] Error en renovación automática:', error);
                // Si falla la renovación, detener el timer
                this.stopRenewal();
            }
        }, this.renewInterval);

        console.log('⏰ [LOCK] Renovación automática iniciada');
    }

    /**
     * Detiene renovación automática
     */
    stopRenewal() {
        if (this.renewalTimer) {
            clearInterval(this.renewalTimer);
            this.renewalTimer = null;
            console.log('⏹️ [LOCK] Renovación automática detenida');
        }
    }

    /**
     * Adquiere el lock distribuido
     *
     * Lógica:
     * 1. Generar token único
     * 2. Intentar escribir token en celda de control
     * 3. Leer celda y verificar que nuestro token esté
     * 4. Si hay otro token, verificar TTL
     * 5. Si TTL expirado, forzar lock (tomar control)
     * 6. Si no expirado, esperar y reintentar
     * 7. Si se adquiere, iniciar renovación automática
     */
    async acquireLock() {
        const startTime = Date.now();
        let attempts = 0;

        console.log('🔐 [LOCK] Intentando adquirir lock...');

        while (Date.now() - startTime < this.maxWaitTime) {
            attempts++;

            try {
                // 1. Leer lock actual
                const currentLock = await this._readLock();

                // 2. Si no hay lock, intentar tomar
                if (!currentLock) {
                    const token = this._generateToken();
                    await this._writeLock(token);

                    // Verificar que nuestro token esté (puede haber condición de carrera)
                    await new Promise(resolve => setTimeout(resolve, 200)); // Pequeña espera
                    const verification = await this._readLock();

                    if (verification && verification.token === token) {
                        // ✅ Lock adquirido exitosamente
                        this.lockToken = token;
                        this.lockAcquired = true;
                        this.lockTimestamp = Date.now();
                        this._startRenewal();

                        console.log(`✅ [LOCK] Lock adquirido en intento ${attempts}`);
                        return true;
                    } else {
                        console.log(`⚠️ [LOCK] Conflicto detectado en intento ${attempts}, reintentando...`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        continue;
                    }
                }

                // 3. Hay un lock existente, verificar si expiró
                if (this._isLockExpired(currentLock.timestamp)) {
                    console.log('⏰ [LOCK] Lock expirado detectado, forzando...');

                    // Forzar: tomar el lock
                    const token = this._generateToken();
                    await this._writeLock(token);

                    // Verificar
                    await new Promise(resolve => setTimeout(resolve, 200));
                    const verification = await this._readLock();

                    if (verification && verification.token === token) {
                        this.lockToken = token;
                        this.lockAcquired = true;
                        this.lockTimestamp = Date.now();
                        this._startRenewal();

                        console.log(`✅ [LOCK] Lock forzado adquirido en intento ${attempts}`);
                        return true;
                    }
                }

                // 4. Lock válido en uso, esperar
                console.log(`⏳ [LOCK] Lock en uso, esperando... (intento ${attempts})`);
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error(`❌ [LOCK] Error en intento ${attempts}:`, error);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Timeout alcanzado
        throw new Error(`❌ [LOCK] Timeout: No se pudo adquirir lock después de ${this.maxWaitTime}ms`);
    }

    /**
     * Libera el lock distribuido
     */
    async releaseLock() {
        if (!this.lockAcquired) {
            console.warn('⚠️ [LOCK] No hay lock para liberar');
            return false;
        }

        try {
            // Detener renovación
            this.stopRenewal();

            // Verificar que el lock sigue siendo nuestro antes de limpiar
            const currentLock = await this._readLock();
            if (currentLock && currentLock.token === this.lockToken) {
                await this._clearLock();
            } else {
                console.warn('⚠️ [LOCK] El lock ya fue tomado por otro cliente');
            }

            // Resetear estado
            this.lockToken = null;
            this.lockAcquired = false;
            this.lockTimestamp = null;

            console.log('✅ [LOCK] Lock liberado correctamente');
            return true;

        } catch (error) {
            console.error('❌ [LOCK] Error liberando lock:', error);

            // Resetear estado de todos modos
            this.lockToken = null;
            this.lockAcquired = false;
            this.lockTimestamp = null;
            this.stopRenewal();

            throw error;
        }
    }

    /**
     * Handler para beforeunload - libera lock automáticamente
     */
    _handleBeforeUnload() {
        if (this.lockAcquired) {
            console.log('🚪 [LOCK] Liberando lock por beforeunload...');
            // Sincrónico - no podemos usar async aquí
            this.stopRenewal();

            // Intentar liberar con fetch síncrono (deprecado pero funciona en beforeunload)
            try {
                const range = `${this.controlSheet}!${this.controlCell}`;
                const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}:clear`;
                const token = gapi.client.getToken();

                if (token && token.access_token) {
                    // Usar sendBeacon si está disponible
                    if (navigator.sendBeacon) {
                        const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
                        navigator.sendBeacon(url + `?access_token=${token.access_token}`, blob);
                    }
                }
            } catch (error) {
                console.error('❌ [LOCK] Error en beforeunload:', error);
            }
        }
    }

    /**
     * Destructor - limpia recursos
     */
    destroy() {
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this.stopRenewal();

        if (this.lockAcquired) {
            // Intento de limpieza síncrona
            console.log('🗑️ [LOCK] Destruyendo lock manager...');
        }
    }
}

// Exportar globalmente
if (typeof window !== 'undefined') {
    window.DistributedLockManager = DistributedLockManager;
}
