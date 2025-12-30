/**
 * SIDEBAR-COMPONENT.JS
 * Componente de sidebar compartido para aplicaciones WMS
 * Proporciona funcionalidad unificada para todas las apps
 *
 * @version 1.0.0
 */

class SidebarComponent {
    constructor(config = {}) {
        this.config = {
            appName: config.appName || 'WMS',
            appIcon: config.appIcon || '📦',
            appSubtitle: config.appSubtitle || 'Sistema de gestión',
            containerId: config.containerId || 'sidebar',
            syncManager: config.syncManager || null,
            summaryConfig: config.summaryConfig || null,
            buttons: config.buttons || [],
            onReloadBD: config.onReloadBD || null,
            onLogout: config.onLogout || null,
            onToggleConnection: config.onToggleConnection || null,
            showSummary: config.showSummary !== false,
            ...config
        };

        this.user = null;
        this.bdCount = 0;
        this.bdUpdateTime = null;
        this.isOnline = navigator.onLine;
    }

    /**
     * Inicializa el sidebar
     */
    init() {
        this.setupConnectionListeners();
        this.updateConnectionUI();
    }

    /**
     * Configura los listeners de conexión
     */
    setupConnectionListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionUI();
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateConnectionUI();
        });
    }

    /**
     * Actualiza la información del usuario
     * @param {Object} user - Datos del usuario
     */
    setUser(user) {
        this.user = user;
        this.updateUserUI();
    }

    /**
     * Actualiza el UI del usuario
     */
    updateUserUI() {
        const avatarEl = document.getElementById('user-avatar');
        const nameEl = document.getElementById('user-name-display');

        if (this.user) {
            if (avatarEl) {
                if (this.user.picture) {
                    avatarEl.innerHTML = `<img src="${this.user.picture}" alt="${this.user.name}" referrerpolicy="no-referrer">`;
                } else {
                    const initials = this.user.name
                        ? this.user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                        : '?';
                    avatarEl.textContent = initials;
                }
            }
            if (nameEl) {
                nameEl.textContent = this.user.name || this.user.email || 'Usuario';
            }
        } else {
            if (avatarEl) avatarEl.textContent = '?';
            if (nameEl) nameEl.textContent = 'No conectado';
        }
    }

    /**
     * Actualiza el UI de conexión
     */
    updateConnectionUI() {
        const dot = document.getElementById('connection-dot');
        const text = document.getElementById('connection-text');

        if (dot) {
            dot.className = `connection-dot ${this.isOnline ? 'online' : 'offline'}`;
        }
        if (text) {
            text.textContent = this.isOnline ? 'Online' : 'Offline';
        }
    }

    /**
     * Actualiza la información de la base de datos
     * @param {number} count - Cantidad de registros
     */
    updateBDInfo(count) {
        this.bdCount = count;
        this.bdUpdateTime = new Date();

        const countEl = document.getElementById('bd-count') || document.getElementById('bd-count-sidebar');
        const timeEl = document.getElementById('bd-update-time');

        if (countEl) countEl.textContent = count;
        if (timeEl) timeEl.textContent = `Actualizado: ${this.bdUpdateTime.toLocaleTimeString()}`;
    }

    /**
     * Actualiza el resumen global
     * @param {Object} summary - Objeto con los valores del resumen
     */
    updateSummary(summary = {}) {
        // Para inventario: ok, blocked, nowms, total
        if (summary.ok !== undefined) {
            const okEl = document.getElementById('global-ok-count');
            if (okEl) okEl.textContent = summary.ok;
        }
        if (summary.blocked !== undefined) {
            const blockedEl = document.getElementById('global-blocked-count');
            if (blockedEl) blockedEl.textContent = summary.blocked;
        }
        if (summary.nowms !== undefined) {
            const nowmsEl = document.getElementById('global-nowms-count');
            if (nowmsEl) nowmsEl.textContent = summary.nowms;
        }
        if (summary.total !== undefined) {
            const totalEl = document.getElementById('global-total-count');
            if (totalEl) totalEl.textContent = summary.total;
        }

        // Para dispatch: total, validated, pending
        if (summary.validated !== undefined) {
            const validatedEl = document.getElementById('summary-validated');
            if (validatedEl) validatedEl.textContent = summary.validated;
        }
        if (summary.pending !== undefined) {
            const pendingEl = document.getElementById('summary-pending');
            if (pendingEl) pendingEl.textContent = summary.pending;
        }
        if (summary.summaryTotal !== undefined) {
            const summaryTotalEl = document.getElementById('summary-total');
            if (summaryTotalEl) summaryTotalEl.textContent = summary.summaryTotal;
        }
    }

    /**
     * Muestra el panel de sincronización
     */
    showSyncPanel() {
        if (this.config.syncManager) {
            this.config.syncManager.showPanel();
        } else if (window.syncManager) {
            window.syncManager.showPanel();
        }
    }

    /**
     * Ejecuta la acción de recarga de BD
     */
    async reloadBD() {
        if (this.config.onReloadBD) {
            await this.config.onReloadBD();
        }
    }

    /**
     * Ejecuta la acción de logout
     */
    handleLogout() {
        if (this.config.onLogout) {
            this.config.onLogout();
        }
    }

    /**
     * Ejecuta la acción de toggle de conexión
     */
    toggleConnection() {
        if (this.config.onToggleConnection) {
            this.config.onToggleConnection();
        }
    }

    /**
     * Genera el HTML del sidebar
     * @returns {string} HTML del sidebar
     */
    generateHTML() {
        const summaryHTML = this.config.showSummary ? this._generateSummaryHTML() : '';
        const buttonsHTML = this._generateButtonsHTML();

        return `
            <div class="sidebar-header">
                <h2>${this.config.appIcon} ${this.config.appName}</h2>
                <p>${this.config.appSubtitle}</p>
            </div>

            <div id="sync-status" class="sync-status sync-ok" onclick="window.sidebarComponent?.showSyncPanel() || window.syncManager?.showPanel()">
                ✅ Sincronizado
            </div>

            ${summaryHTML}

            ${buttonsHTML}

            <div class="user-footer">
                <div class="user-info">
                    <div class="user-avatar" id="user-avatar">?</div>
                    <div class="user-details">
                        <div class="user-name" id="user-name-display">No conectado</div>
                        <div class="connection-indicator">
                            <div class="connection-dot" id="connection-dot"></div>
                            <span id="connection-text">Offline</span>
                        </div>
                    </div>
                </div>
                <div class="user-footer-actions">
                    <button class="btn btn-secondary btn-small" onclick="window.sidebarComponent?.reloadBD() || reloadBD()" title="Actualizar BD">🔄 BD</button>
                    <button class="btn btn-secondary btn-small" onclick="window.sidebarComponent?.toggleConnection() || toggleGoogleConnection()" id="sidebar-auth-btn" title="Conectar/Desconectar">🔗</button>
                    <button class="btn btn-secondary btn-small" onclick="window.sidebarComponent?.handleLogout() || handleLogout()" title="Cerrar Sesión">🚪</button>
                </div>
                <div class="bd-info">
                    <div><span id="bd-count">0</span> registros cargados</div>
                    <div id="bd-update-time">Sin actualizar</div>
                </div>
            </div>
        `;
    }

    /**
     * Genera el HTML del resumen
     * @private
     */
    _generateSummaryHTML() {
        if (this.config.summaryConfig) {
            const items = this.config.summaryConfig.items || [];
            const title = this.config.summaryConfig.title || '📊 Resumen';

            return `
                <div class="global-summary-section" id="global-summary-section">
                    <div class="summary-title">${title}</div>
                    <div class="summary-grid">
                        ${items.map(item => `
                            <div class="summary-item ${item.class || ''}">
                                <span class="summary-icon">${item.icon}</span>
                                <span class="summary-value" id="${item.id}">0</span>
                                <span class="summary-label">${item.label}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        return '';
    }

    /**
     * Genera el HTML de los botones
     * @private
     */
    _generateButtonsHTML() {
        if (this.config.buttons.length === 0) return '';

        return `
            <div class="sidebar-section">
                ${this.config.buttons.map(btn => `
                    <button class="sidebar-btn ${btn.class || 'sidebar-btn-secondary'}" onclick="${btn.onClick}">
                        ${btn.icon ? btn.icon + ' ' : ''}${btn.label}
                    </button>
                `).join('')}
            </div>
        `;
    }

    /**
     * Renderiza el sidebar en el contenedor especificado
     */
    render() {
        const container = document.getElementById(this.config.containerId);
        if (container) {
            container.innerHTML = this.generateHTML();
            this.init();
        }
    }
}

// Configuraciones predefinidas para cada app
SidebarComponent.presets = {
    inventario: {
        appName: 'Inventario',
        appIcon: '📦',
        appSubtitle: 'Sistema de gestión',
        summaryConfig: {
            title: '📊 Resumen Global',
            items: [
                { id: 'global-ok-count', icon: '✅', label: 'OK', class: 'ok' },
                { id: 'global-blocked-count', icon: '⚠️', label: 'Bloqueado', class: 'blocked' },
                { id: 'global-nowms-count', icon: '❌', label: 'No WMS', class: 'nowms' },
                { id: 'global-total-count', icon: '📦', label: 'Total', class: 'total' }
            ]
        }
    },
    validador: {
        appName: 'Validador',
        appIcon: '🎯',
        appSubtitle: 'Validación de cajas',
        summaryConfig: {
            title: '📊 Resumen',
            items: [
                { id: 'summary-validated', icon: '✅', label: 'Validadas', class: 'validated' },
                { id: 'summary-pending', icon: '⏳', label: 'Pendientes', class: 'pending' },
                { id: 'summary-total', icon: '📦', label: 'Total', class: 'total' }
            ]
        }
    },
    dispatch: {
        appName: 'Despacho',
        appIcon: '🚚',
        appSubtitle: 'Gestión de despachos',
        summaryConfig: {
            title: '📊 Resumen del Día',
            items: [
                { id: 'summary-total', icon: '📦', label: 'Total', class: 'total' },
                { id: 'summary-validated', icon: '✅', label: 'Validadas', class: 'validated' },
                { id: 'summary-pending', icon: '⏳', label: 'Pendientes', class: 'pending' }
            ]
        }
    }
};

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.SidebarComponent = SidebarComponent;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidebarComponent;
}
