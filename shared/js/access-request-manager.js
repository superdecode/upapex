/**
 * ACCESS-REQUEST-MANAGER.JS
 * Sistema simplificado para solicitar acceso a spreadsheets de Google
 *
 * @version 2.1.0
 * @description Muestra un modal con instrucciones para solicitar acceso
 */

const AccessRequestManager = {
    // Configuración por defecto
    config: {
        appName: 'WMS',
        spreadsheetId: null
    },

    // Estado
    isModalVisible: false,

    /**
     * Inicializa el manager con configuración específica de la app
     */
    init(config = {}) {
        this.config = { ...this.config, ...config };
        console.log('✅ AccessRequestManager inicializado para', this.config.appName);
    },

    /**
     * Muestra el modal de solicitud de acceso
     */
    showAccessRequestModal(options = {}) {
        const {
            spreadsheetId = this.config.spreadsheetId,
            spreadsheetName = 'Base de datos',
            errorMessage = 'No tienes permisos para acceder a este recurso.'
        } = options;

        if (this.isModalVisible) return;

        const sheetUrl = spreadsheetId
            ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
            : null;

        const userEmail = this.getCurrentUserEmail();

        const modal = document.createElement('div');
        modal.id = 'access-request-modal';
        modal.className = 'access-request-modal';
        modal.innerHTML = `
            <div class="access-request-overlay" onclick="AccessRequestManager.closeModal()"></div>
            <div class="access-request-content">
                <div class="access-request-icon">🔒</div>
                <h2>Acceso Requerido</h2>
                <p class="access-request-message">${errorMessage}</p>

                <div class="access-request-info">
                    <div class="info-item">
                        <span class="info-label">📊 Recurso:</span>
                        <span class="info-value">${spreadsheetName}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">👤 Tu email:</span>
                        <span class="info-value">${userEmail || 'No identificado'}</span>
                    </div>
                </div>

                <div class="access-request-steps">
                    <p><strong>Pasos para solicitar acceso:</strong></p>
                    <ol>
                        <li>Haz clic en <strong>"Abrir en Google Sheets"</strong></li>
                        <li>En la pantalla de Google, haz clic en <strong>"Solicitar acceso"</strong></li>
                        <li>O pide a un editor que comparta el documento con tu email</li>
                    </ol>
                </div>

                <div class="access-request-actions">
                    <button class="btn-request-access" onclick="AccessRequestManager.openSheet('${sheetUrl}')">
                        🔗 Abrir en Google Sheets
                    </button>
                </div>

                <button class="btn-close-modal" onclick="AccessRequestManager.closeModal()">
                    ✕ Cerrar
                </button>
            </div>
        `;

        document.body.appendChild(modal);
        this.isModalVisible = true;

        requestAnimationFrame(() => modal.classList.add('visible'));
    },

    /**
     * Cierra el modal
     */
    closeModal() {
        const modal = document.getElementById('access-request-modal');
        if (modal) {
            modal.classList.remove('visible');
            setTimeout(() => {
                modal.remove();
                this.isModalVisible = false;
            }, 300);
        }
    },

    /**
     * Abre Google Sheets
     */
    openSheet(url) {
        if (url && url !== 'null') {
            window.open(url, '_blank');
            if (typeof showNotification === 'function') {
                showNotification('📄 Abriendo Google Sheets...', 'info');
            }
            this.closeModal();
        } else {
            if (typeof showNotification === 'function') {
                showNotification('❌ URL no disponible', 'error');
            }
        }
    },

    /**
     * Obtiene el email del usuario actual
     */
    getCurrentUserEmail() {
        if (typeof AuthManager !== 'undefined' && AuthManager.userEmail) {
            return AuthManager.userEmail;
        }
        return localStorage.getItem('wms_user_email') || '';
    },

    /**
     * Muestra un banner compacto de error de permisos
     */
    showPermissionErrorBanner(options = {}) {
        const {
            spreadsheetId = this.config.spreadsheetId,
            spreadsheetName = 'Base de datos',
            message = 'Sin permisos para acceder al spreadsheet'
        } = options;

        const existingBanner = document.getElementById('permission-error-banner');
        if (existingBanner) existingBanner.remove();

        const banner = document.createElement('div');
        banner.id = 'permission-error-banner';
        banner.className = 'permission-error-banner';
        banner.innerHTML = `
            <div class="banner-content">
                <span class="banner-icon">🔒</span>
                <span class="banner-message">${message}</span>
                <button class="banner-btn" onclick="AccessRequestManager.showAccessRequestModal({ spreadsheetId: '${spreadsheetId}', spreadsheetName: '${spreadsheetName}' })">
                    Solicitar Acceso
                </button>
                <button class="banner-close" onclick="this.parentElement.parentElement.remove()">✕</button>
            </div>
        `;

        document.body.appendChild(banner);
        requestAnimationFrame(() => banner.classList.add('visible'));

        setTimeout(() => {
            const b = document.getElementById('permission-error-banner');
            if (b) {
                b.classList.remove('visible');
                setTimeout(() => b.remove(), 300);
            }
        }, 30000);
    }
};

window.AccessRequestManager = AccessRequestManager;
