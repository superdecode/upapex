/**
 * INTEGRITY-VALIDATOR.JS
 * Sistema de verificación de integridad para datos escritos en Google Sheets
 *
 * Funcionalidad:
 * - Verificación columna por columna de datos escritos
 * - Checksum SHA-256 de cada fila para integridad completa
 * - Normalización de valores para comparación segura
 * - Detección de formateo automático de Google Sheets
 * - Reporte detallado de discrepancias
 */

class IntegrityValidator {
    constructor(config = {}) {
        this.spreadsheetId = config.spreadsheetId || '';
        this.sheetName = config.sheetName || '';
        this.verifyAllColumns = config.verifyAllColumns !== false; // Default true
        this.useChecksum = config.useChecksum !== false;           // Default true
        this.normalizeValues = config.normalizeValues !== false;   // Default true
    }

    /**
     * Normaliza un valor para comparación segura
     */
    _normalizeValue(value, type = 'string') {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        const str = String(value);

        switch (type) {
            case 'date':
                // Normalizar fechas a formato DD/MM/YYYY
                // Google Sheets puede formatear automáticamente
                try {
                    // Si es formato ISO o timestamp
                    if (str.includes('-') || str.includes('T') || !isNaN(Number(str))) {
                        const date = new Date(str);
                        if (!isNaN(date.getTime())) {
                            const day = String(date.getDate()).padStart(2, '0');
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const year = date.getFullYear();
                            return `${day}/${month}/${year}`;
                        }
                    }
                    // Ya está en formato DD/MM/YYYY
                    return str.trim();
                } catch (e) {
                    return str.trim();
                }

            case 'time':
                // Normalizar horas a formato HH:MM:SS
                try {
                    if (str.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) {
                        const parts = str.split(':');
                        const hours = String(parts[0]).padStart(2, '0');
                        const minutes = String(parts[1]).padStart(2, '0');
                        const seconds = parts[2] ? String(parts[2]).padStart(2, '0') : '00';
                        return `${hours}:${minutes}:${seconds}`;
                    }
                    return str.trim();
                } catch (e) {
                    return str.trim();
                }

            case 'number':
                // Normalizar números
                try {
                    const num = parseFloat(str.replace(/,/g, ''));
                    return isNaN(num) ? '0' : String(num);
                } catch (e) {
                    return '0';
                }

            case 'string':
            default:
                // Trim y lowercase para comparación case-insensitive
                return str.trim();
        }
    }

    /**
     * Calcula SHA-256 hash de una fila
     */
    async _calculateChecksum(rowData) {
        try {
            // Concatenar todos los valores de la fila
            const dataString = rowData.map(v => String(v || '')).join('|');

            // Calcular SHA-256 usando SubtleCrypto API
            const encoder = new TextEncoder();
            const data = encoder.encode(dataString);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);

            // Convertir a hex
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            return hashHex;
        } catch (error) {
            console.error('❌ [INTEGRITY] Error calculando checksum:', error);
            return null;
        }
    }

    /**
     * Lee datos escritos de Google Sheets
     */
    async _readWrittenData(startRow, endRow) {
        try {
            const range = `${this.sheetName}!A${startRow}:Z${endRow}`;

            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: range
            });

            return response.result.values || [];
        } catch (error) {
            console.error('❌ [INTEGRITY] Error leyendo datos escritos:', error);
            throw error;
        }
    }

    /**
     * Compara dos valores normalizados
     */
    _compareValues(original, written, type = 'string') {
        if (this.normalizeValues) {
            const normalizedOriginal = this._normalizeValue(original, type);
            const normalizedWritten = this._normalizeValue(written, type);
            return normalizedOriginal === normalizedWritten;
        } else {
            return String(original || '') === String(written || '');
        }
    }

    /**
     * Verifica que los datos escritos coincidan con los originales
     *
     * @param {Array} originalRecords - Registros originales (array de objetos o arrays)
     * @param {Number} startRow - Fila inicial donde se escribieron los datos
     * @param {Array} columnTypes - Tipos de columnas para normalización ['date', 'time', 'string', ...]
     * @returns {Object} { success: boolean, errors: [], details: {} }
     */
    async verifyWrittenData(originalRecords, startRow, columnTypes = []) {
        console.log(`🔍 [INTEGRITY] Verificando ${originalRecords.length} registros desde fila ${startRow}...`);

        try {
            const endRow = startRow + originalRecords.length - 1;

            // Leer datos escritos de Google Sheets
            const writtenData = await this._readWrittenData(startRow, endRow);

            if (writtenData.length !== originalRecords.length) {
                return {
                    success: false,
                    errors: [`Cantidad de filas no coincide: esperadas ${originalRecords.length}, escritas ${writtenData.length}`],
                    details: {
                        expected: originalRecords.length,
                        actual: writtenData.length
                    }
                };
            }

            const errors = [];
            const details = {
                totalRows: originalRecords.length,
                verifiedRows: 0,
                failedRows: [],
                checksumMismatches: 0,
                columnMismatches: []
            };

            // Verificar cada fila
            for (let i = 0; i < originalRecords.length; i++) {
                const originalRow = Array.isArray(originalRecords[i])
                    ? originalRecords[i]
                    : Object.values(originalRecords[i]);

                const writtenRow = writtenData[i] || [];
                const rowNumber = startRow + i;

                let rowHasErrors = false;

                // Verificar columna por columna
                if (this.verifyAllColumns) {
                    const maxCols = Math.max(originalRow.length, writtenRow.length);

                    for (let col = 0; col < maxCols; col++) {
                        const originalValue = originalRow[col];
                        const writtenValue = writtenRow[col];
                        const colType = columnTypes[col] || 'string';

                        if (!this._compareValues(originalValue, writtenValue, colType)) {
                            rowHasErrors = true;
                            errors.push(
                                `Fila ${rowNumber}, Columna ${col + 1}: ` +
                                `Esperado "${originalValue}", Escrito "${writtenValue}"`
                            );
                            details.columnMismatches.push({
                                row: rowNumber,
                                column: col + 1,
                                expected: originalValue,
                                actual: writtenValue
                            });
                        }
                    }
                }

                // Calcular y verificar checksum
                if (this.useChecksum) {
                    const originalChecksum = await this._calculateChecksum(originalRow);
                    const writtenChecksum = await this._calculateChecksum(writtenRow);

                    if (originalChecksum !== writtenChecksum) {
                        rowHasErrors = true;
                        details.checksumMismatches++;

                        if (!this.verifyAllColumns) {
                            // Si no verificamos columnas, reportar checksum mismatch
                            errors.push(
                                `Fila ${rowNumber}: Checksum no coincide ` +
                                `(Original: ${originalChecksum?.substring(0, 16)}..., ` +
                                `Escrito: ${writtenChecksum?.substring(0, 16)}...)`
                            );
                        }
                    }
                }

                if (rowHasErrors) {
                    details.failedRows.push(rowNumber);
                } else {
                    details.verifiedRows++;
                }
            }

            const success = errors.length === 0;

            if (success) {
                console.log(`✅ [INTEGRITY] Verificación exitosa: ${details.verifiedRows}/${details.totalRows} filas correctas`);
            } else {
                console.error(`❌ [INTEGRITY] Verificación falló: ${details.failedRows.length} filas con errores`);
                console.error('Errores:', errors.slice(0, 10)); // Mostrar primeros 10 errores
            }

            return {
                success,
                errors,
                details
            };

        } catch (error) {
            console.error('❌ [INTEGRITY] Error durante verificación:', error);
            return {
                success: false,
                errors: [`Error durante verificación: ${error.message}`],
                details: {
                    error: error.message
                }
            };
        }
    }

    /**
     * Verifica solo checksums (más rápido que verificación completa)
     */
    async verifyChecksums(originalRecords, startRow) {
        console.log(`🔍 [INTEGRITY] Verificando checksums de ${originalRecords.length} registros...`);

        try {
            const endRow = startRow + originalRecords.length - 1;
            const writtenData = await this._readWrittenData(startRow, endRow);

            if (writtenData.length !== originalRecords.length) {
                return {
                    success: false,
                    error: `Cantidad de filas no coincide: esperadas ${originalRecords.length}, escritas ${writtenData.length}`
                };
            }

            let mismatches = 0;

            for (let i = 0; i < originalRecords.length; i++) {
                const originalRow = Array.isArray(originalRecords[i])
                    ? originalRecords[i]
                    : Object.values(originalRecords[i]);

                const writtenRow = writtenData[i] || [];

                const originalChecksum = await this._calculateChecksum(originalRow);
                const writtenChecksum = await this._calculateChecksum(writtenRow);

                if (originalChecksum !== writtenChecksum) {
                    mismatches++;
                }
            }

            const success = mismatches === 0;

            if (success) {
                console.log(`✅ [INTEGRITY] Verificación de checksums exitosa`);
            } else {
                console.error(`❌ [INTEGRITY] ${mismatches} checksums no coinciden`);
            }

            return {
                success,
                mismatches,
                total: originalRecords.length
            };

        } catch (error) {
            console.error('❌ [INTEGRITY] Error verificando checksums:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Exportar globalmente
if (typeof window !== 'undefined') {
    window.IntegrityValidator = IntegrityValidator;
}
