/**
 * LOCATION-VALIDATOR-UI.JS
 * Módulo de UI compartido para validación de ubicaciones
 * Usa las funciones de wms-utils.js para la lógica de validación
 * 
 * Uso:
 * 1. Incluir wms-utils.js antes de este archivo
 * 2. Llamar LocationValidatorUI.validate(location, onSuccess, onForce)
 */

const LocationValidatorUI = {
    currentPopup: null,
    onSuccessCallback: null,
    onForceCallback: null,
    originalLocation: '',

    /**
     * Valida una ubicación y muestra popup si es inválida
     * @param {string} location - Ubicación a validar
     * @param {Function} onSuccess - Callback(normalizedLocation) cuando es válida
     * @param {Function} onForce - Callback(forcedLocation) cuando se fuerza inserción
     */
    validate(location, onSuccess, onForce) {
        // Validar usando wms-utils.js
        const validation = validateLocation(location);
        
        if (validation.valid) {
            // Ubicación válida, ejecutar callback de éxito
            if (onSuccess) {
                onSuccess(validation.normalized);
            }
            return;
        }

        // Ubicación inválida, mostrar popup
        this.showPopup(location, validation, onSuccess, onForce);
    },

    /**
     * Muestra el popup de validación
     */
    showPopup(location, validation, onSuccess, onForce) {
        this.originalLocation = location;
        this.onSuccessCallback = onSuccess;
        this.onForceCallback = onForce;

        const overlay = document.createElement('div');
        overlay.className = 'location-validation-overlay';
        overlay.innerHTML = `
            <div class="location-validation-popup">
                <div class="location-validation-header">
                    <span style="font-size: 2em;">⚠️</span>
                    <h3>Formato de Ubicación Inválido</h3>
                </div>
                
                <div class="location-validation-body">
                    <div class="location-error-box">
                        <strong>Código ingresado:</strong>
                        <div class="location-error-code">${location}</div>
                        ${validation.message ? `<div style="margin-top: 8px; color: #d32f2f; font-size: 0.9em;">${validation.message}</div>` : ''}
                    </div>
                    
                    <div class="location-format-info">
                        <strong>Formato esperado:</strong>
                        <div class="location-format-pattern">Letra(s)-Número(s)-Número(s)-Número(s)</div>
                        
                        <div class="location-examples">
                            <strong>Ejemplos válidos:</strong>
                            <ul>
                                <li>A26-06-01-02</li>
                                <li>B11-11-02-01</li>
                                <li>A1-11-02-01</li>
                                <li>C9-11-02-01</li>
                                <li>A1-01-01-01</li>
                            </ul>
                        </div>
                        
                        <div class="location-tip">
                            <strong>💡 Reglas:</strong>
                            <ul style="margin: 8px 0 0 20px; font-size: 0.9em;">
                                <li>Comillas simples (') se convierten automáticamente a guiones (-)</li>
                                <li>Zona (primer número): puede ser 1-999, sin cero a la izquierda</li>
                                <li>Pasillo, Rack, Nivel: deben ser 01-99, con cero a la izquierda</li>
                                <li>Ejemplo: A1-1-1-1 → A1-01-01-01</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <div class="location-validation-buttons">
                    <button class="btn btn-secondary" onclick="LocationValidatorUI.closePopup()">Corregir</button>
                    <button class="btn btn-warning" onclick="LocationValidatorUI.confirmForce()">Insertar Forzado</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        this.currentPopup = overlay;

        // Cerrar con ESC
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closePopup();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },

    /**
     * Confirma la inserción forzada
     */
    confirmForce() {
        if (this.onForceCallback) {
            this.onForceCallback(this.originalLocation);
        }
        this.closePopup();
    },

    /**
     * Cierra el popup
     */
    closePopup() {
        if (this.currentPopup) {
            this.currentPopup.remove();
            this.currentPopup = null;
        }
    }
};

// Hacer disponible globalmente
if (typeof window !== 'undefined') {
    window.LocationValidatorUI = LocationValidatorUI;
}
