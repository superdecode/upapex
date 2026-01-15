/**
 * SIDEBAR-COMPONENT.JS
 * Componente de sidebar compartido para aplicaciones WMS
 * Proporciona funcionalidad unificada para todas las apps
 * Incluye: Sistema de avatar integrado, validación de nombres, gestión de Google
 *
 * @version 2.0.0
 *
 * IMPORTANTE: Este archivo depende de que avatar-system.js se cargue PRIMERO
 * para definir window.AVATAR_CONFIG
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
        
        this.avatarState = {
            userName: '',
            userEmail: '',
            isGoogleConnected: false,
            onUpdateCallbacks: []
        };
        
        this.loadAvatarData();
    }

    /**
     * Inicializa el sidebar
     */
    init() {
        this.setupConnectionListeners();
        this.updateConnectionUI();
        this.setupAvatarUI();
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
            this.updateAvatarDisplay();
        }
    }

    loadAvatarData() {
        const savedName = localStorage.getItem(window.AVATAR_CONFIG.storageKeys.userName);
        const savedEmail = localStorage.getItem(window.AVATAR_CONFIG.storageKeys.userEmail);
        
        if (savedName) {
            this.avatarState.userName = savedName;
        }
        if (savedEmail) {
            this.avatarState.userEmail = savedEmail;
        }
        
        this.checkGoogleConnection();
    }

    checkGoogleConnection() {
        const token = localStorage.getItem(window.AVATAR_CONFIG.storageKeys.googleToken);
        const expiry = localStorage.getItem(window.AVATAR_CONFIG.storageKeys.googleExpiry);
        
        if (token && expiry) {
            const expiryTime = parseInt(expiry, 10);
            if (Date.now() < expiryTime) {
                this.avatarState.isGoogleConnected = true;
                return true;
            } else {
                this.clearGoogleConnection();
            }
        }
        
        this.avatarState.isGoogleConnected = false;
        return false;
    }

    saveGoogleConnection(token, expiresIn = 3600) {
        const expiryTime = Date.now() + (expiresIn * 1000);
        localStorage.setItem(window.AVATAR_CONFIG.storageKeys.googleToken, token);
        localStorage.setItem(window.AVATAR_CONFIG.storageKeys.googleExpiry, expiryTime.toString());
        this.avatarState.isGoogleConnected = true;
        this.notifyAvatarUpdate();
        this.updateAvatarButtons();
    }

    clearGoogleConnection() {
        localStorage.removeItem(window.AVATAR_CONFIG.storageKeys.googleToken);
        localStorage.removeItem(window.AVATAR_CONFIG.storageKeys.googleExpiry);
        this.avatarState.isGoogleConnected = false;
        this.notifyAvatarUpdate();
        this.updateAvatarButtons();
    }

    validateName(name) {
        if (!name || typeof name !== 'string') {
            return { valid: false, message: 'El nombre es requerido' };
        }
        
        const trimmed = name.trim();
        const words = trimmed.split(/\s+/);
        
        if (words.length < 2) {
            return { valid: false, message: 'Ingresa nombre y apellido (mínimo 2 palabras)' };
        }
        
        return { valid: true, formatted: this.formatNameToTitle(trimmed) };
    }

    formatNameToTitle(name) {
        return name
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    setUserName(name) {
        const validation = this.validateName(name);
        
        if (!validation.valid) {
            return { success: false, message: validation.message };
        }
        
        this.avatarState.userName = validation.formatted;
        localStorage.setItem(window.AVATAR_CONFIG.storageKeys.userName, validation.formatted);
        this.notifyAvatarUpdate();
        
        return { success: true, formatted: validation.formatted };
    }

    setUserEmail(email) {
        this.avatarState.userEmail = email;
        localStorage.setItem(window.AVATAR_CONFIG.storageKeys.userEmail, email);
        this.notifyAvatarUpdate();
    }

    setupAvatarUI() {
        const avatarContainer = document.querySelector('.user-info');
        if (!avatarContainer) return;
        
        this.updateAvatarDisplay();
        
        const avatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name-display');
        
        if (avatar) {
            avatar.onclick = () => this.showNameEditPopup();
            avatar.style.cursor = 'pointer';
            avatar.title = 'Click para editar nombre';
        }
        
        if (userName) {
            userName.onclick = () => this.showNameEditPopup();
            userName.style.cursor = 'pointer';
            userName.title = 'Click para editar nombre';
        }
    }

    updateAvatarDisplay() {
        const avatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name-display');
        
        const displayName = this.avatarState.userName || 'Usuario';
        
        if (avatar) {
            avatar.textContent = displayName.charAt(0).toUpperCase();
        }
        
        if (userName) {
            userName.textContent = displayName;
        }
        
        this.updateAvatarButtons();
    }

    updateAvatarButtons() {
        const actionsContainer = document.querySelector('.user-footer-actions');
        if (!actionsContainer) return;
        
        const googleBtn = actionsContainer.querySelector('#sidebar-auth-btn');
        if (googleBtn) {
            if (this.avatarState.isGoogleConnected) {
                googleBtn.textContent = '🔗';
                googleBtn.title = 'Desconectar Google';
                googleBtn.classList.add('connected');
            } else {
                googleBtn.textContent = '🔌';
                googleBtn.title = 'Conectar Google';
                googleBtn.classList.remove('connected');
            }
        }
    }

    showNameEditPopup() {
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show';
        overlay.innerHTML = `
            <div class="popup-content" style="max-width: 450px;">
                <div class="popup-header">
                    <span>👤 Editar Nombre</span>
                    <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
                </div>
                <div style="padding: 20px;">
                    <p style="color: #666; margin-bottom: 15px; font-size: 0.95em;">
                        Ingresa tu nombre y apellido para identificarte en los registros:
                    </p>
                    <input type="text" id="avatar-name-input" 
                           placeholder="Nombre Apellido" 
                           value="${this.avatarState.userName || ''}" 
                           autocomplete="off" 
                           style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 1em; margin-bottom: 8px;">
                    <p style="color: #999; font-size: 0.8em; margin-bottom: 15px;">
                        💡 Ejemplo: JUAN PEREZ → Se guardará como "Juan Pérez"
                    </p>
                    <div id="avatar-name-error" style="color: var(--error); font-size: 0.85em; margin-bottom: 10px; display: none;"></div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-primary" onclick="window.sidebarComponent.saveAvatarName()" style="flex: 1;">
                            💾 Guardar
                        </button>
                        <button class="btn btn-secondary" onclick="this.closest('.popup-overlay').remove()">
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        const input = document.getElementById('avatar-name-input');
        input.focus();
        input.select();
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveAvatarName();
            }
        });
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    saveAvatarName() {
        const input = document.getElementById('avatar-name-input');
        const errorDiv = document.getElementById('avatar-name-error');
        const name = input.value.trim();
        
        const result = this.setUserName(name);
        
        if (!result.success) {
            errorDiv.textContent = '⚠️ ' + result.message;
            errorDiv.style.display = 'block';
            input.focus();
            return;
        }
        
        this.updateAvatarDisplay();
        document.querySelector('.popup-overlay')?.remove();
        
        if (typeof showNotification === 'function') {
            showNotification(`✅ Nombre actualizado: ${result.formatted}`, 'success');
        }
    }

    handleAvatarAction(action) {
        switch (action) {
            case 'refresh':
                this.reloadBD();
                break;
                
            case 'google':
                this.handleToggleConnection();
                break;
                
            case 'logout':
                this.handleLogout();
                break;
        }
    }

    handleToggleConnection() {
        if (this.avatarState.isGoogleConnected) {
            if (confirm('¿Desconectar de Google? Deberás volver a iniciar sesión.')) {
                this.clearGoogleConnection();
                if (typeof showNotification === 'function') {
                    showNotification('🔌 Desconectado de Google', 'info');
                }
            }
        } else {
            this.toggleConnection();
        }
    }

    onAvatarUpdate(callback) {
        if (typeof callback === 'function') {
            this.avatarState.onUpdateCallbacks.push(callback);
        }
    }

    notifyAvatarUpdate() {
        this.avatarState.onUpdateCallbacks.forEach(callback => {
            try {
                callback(this.avatarState);
            } catch (e) {
                console.error('Error in avatar update callback:', e);
            }
        });
    }

    getUserName() {
        return this.avatarState.userName;
    }

    getUserEmail() {
        return this.avatarState.userEmail;
    }

    isGoogleConnected() {
        return this.avatarState.isGoogleConnected;
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
        // MEJORA: Configurar deep linking en tarjetas
        const onCardClick = this.config.onCardClick || {};
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

        // Para dispatch y validador: total, validated, pending, rejected
        if (summary.validated !== undefined) {
            const validatedEl = document.getElementById('summary-validated');
            if (validatedEl) validatedEl.textContent = summary.validated;
        }
        if (summary.pending !== undefined) {
            const pendingEl = document.getElementById('summary-pending');
            if (pendingEl) pendingEl.textContent = summary.pending;
        }
        if (summary.rejected !== undefined) {
            const rejectedEl = document.getElementById('summary-rejected');
            if (rejectedEl) rejectedEl.textContent = summary.rejected;
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
                    <button class="btn btn-secondary btn-small" onclick="window.sidebarComponent?.handleAvatarAction('refresh')" title="Actualizar BD">🔄</button>
                    <button class="btn btn-secondary btn-small" onclick="window.sidebarComponent?.handleAvatarAction('google')" id="sidebar-auth-btn" title="Conectar/Desconectar">🔌</button>
                    <button class="btn btn-secondary btn-small" onclick="window.sidebarComponent?.handleAvatarAction('logout')" title="Cerrar Sesión">🚪</button>
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
                        ${items.map(item => {
                            const clickHandler = item.onClick ? `onclick="${item.onClick}"` : '';
                            const cursorStyle = item.onClick ? 'cursor: pointer;' : '';
                            const hoverTitle = item.onClick ? `title="Ir a ${item.label}"` : '';
                            return `
                            <div class="summary-item ${item.class || ''}" ${clickHandler} ${hoverTitle} style="${cursorStyle}">
                                <span class="summary-icon">${item.icon}</span>
                                <span class="summary-value" id="${item.id}">0</span>
                                <span class="summary-label">${item.label}</span>
                            </div>
                        `;
                        }).join('')}
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
        appSubtitle: 'Validación de cajas WMS',
        summaryConfig: {
            title: '📊 Resumen Global',
            items: [
                { id: 'summary-validated', icon: '✅', label: 'Validadas', class: 'validated' },
                { id: 'summary-rejected', icon: '❌', label: 'Rechazadas', class: 'nowms' },
                { id: 'summary-total', icon: '📦', label: 'Total', class: 'total' }
            ]
        }
    },
    dispatch: {
        appName: 'Despacho',
        appIcon: '🚚',
        appSubtitle: 'Gestión de despachos',
        summaryConfig: {
            title: '📊 Resumen',
            items: [
                { id: 'summary-total', icon: '📦', label: 'Total', class: 'total', onClick: 'switchValidationTab("todo")' },
                { id: 'summary-validated', icon: '✅', label: 'Validadas', class: 'validated', onClick: 'switchValidationTab("validated")' },
                { id: 'summary-pending', icon: '⏳', label: 'Pendientes', class: 'pending', onClick: 'switchValidationTab("pending")' }
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
