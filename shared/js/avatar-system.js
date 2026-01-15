/**
 * AVATAR-SYSTEM.JS
 * Sistema global de avatar compartido para todas las apps WMS
 * Incluye: validación de nombre, botones de acción, persistencia de sesión Google
 */

// ==================== CONFIGURACIÓN ====================
// Definir en window para que esté disponible globalmente
window.AVATAR_CONFIG = {
    storageKeys: {
        userName: 'wms_user_name',
        userEmail: 'wms_user_email',
        googleToken: 'wms_google_token',
        googleExpiry: 'wms_google_expiry'
    }
};

// Referencia local para uso interno
const AVATAR_CONFIG = window.AVATAR_CONFIG;

// ==================== ESTADO DEL AVATAR ====================
const AvatarState = {
    userName: '',
    userEmail: '',
    isGoogleConnected: false,
    onUpdateCallbacks: []
};

// ==================== INICIALIZACIÓN ====================
function initAvatarSystem() {
    loadAvatarData();
    setupAvatarUI();
}

function loadAvatarData() {
    const savedName = localStorage.getItem(AVATAR_CONFIG.storageKeys.userName);
    const savedEmail = localStorage.getItem(AVATAR_CONFIG.storageKeys.userEmail);
    
    if (savedName) {
        AvatarState.userName = savedName;
    }
    if (savedEmail) {
        AvatarState.userEmail = savedEmail;
    }
    
    checkGoogleConnection();
}

function checkGoogleConnection() {
    const token = localStorage.getItem(AVATAR_CONFIG.storageKeys.googleToken);
    const expiry = localStorage.getItem(AVATAR_CONFIG.storageKeys.googleExpiry);
    
    if (token && expiry) {
        const expiryTime = parseInt(expiry, 10);
        if (Date.now() < expiryTime) {
            AvatarState.isGoogleConnected = true;
            return true;
        } else {
            clearGoogleConnection();
        }
    }
    
    AvatarState.isGoogleConnected = false;
    return false;
}

function saveGoogleConnection(token, expiresIn = 3600) {
    const expiryTime = Date.now() + (expiresIn * 1000);
    localStorage.setItem(AVATAR_CONFIG.storageKeys.googleToken, token);
    localStorage.setItem(AVATAR_CONFIG.storageKeys.googleExpiry, expiryTime.toString());
    AvatarState.isGoogleConnected = true;
    notifyUpdate();
}

function clearGoogleConnection() {
    localStorage.removeItem(AVATAR_CONFIG.storageKeys.googleToken);
    localStorage.removeItem(AVATAR_CONFIG.storageKeys.googleExpiry);
    AvatarState.isGoogleConnected = false;
    notifyUpdate();
}

// ==================== VALIDACIÓN DE NOMBRE ====================
function validateName(name) {
    if (!name || typeof name !== 'string') {
        return { valid: false, message: 'El nombre es requerido' };
    }
    
    const trimmed = name.trim();
    const words = trimmed.split(/\s+/);
    
    if (words.length < 2) {
        return { valid: false, message: 'Ingresa nombre y apellido (mínimo 2 palabras)' };
    }
    
    return { valid: true, formatted: formatNameToTitle(trimmed) };
}

function formatNameToTitle(name) {
    return name
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function setUserName(name) {
    const validation = validateName(name);
    
    if (!validation.valid) {
        return { success: false, message: validation.message };
    }
    
    AvatarState.userName = validation.formatted;
    localStorage.setItem(AVATAR_CONFIG.storageKeys.userName, validation.formatted);
    notifyUpdate();
    
    return { success: true, formatted: validation.formatted };
}

function setUserEmail(email) {
    AvatarState.userEmail = email;
    localStorage.setItem(AVATAR_CONFIG.storageKeys.userEmail, email);
    notifyUpdate();
}

// ==================== UI DEL AVATAR ====================
function setupAvatarUI() {
    const avatarContainer = document.querySelector('.user-info');
    if (!avatarContainer) return;
    
    updateAvatarDisplay();
    
    const avatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name-display');
    
    if (avatar) {
        avatar.onclick = () => showNameEditPopup();
        avatar.style.cursor = 'pointer';
        avatar.title = 'Click para editar nombre';
    }
    
    if (userName) {
        userName.onclick = () => showNameEditPopup();
        userName.style.cursor = 'pointer';
        userName.title = 'Click para editar nombre';
    }
}

function updateAvatarDisplay() {
    const avatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name-display');
    
    const displayName = AvatarState.userName || 'Usuario';
    
    if (avatar) {
        avatar.textContent = displayName.charAt(0).toUpperCase();
    }
    
    if (userName) {
        userName.textContent = displayName;
    }
    
    updateAvatarButtons();
}

function updateAvatarButtons() {
    const actionsContainer = document.querySelector('.avatar-actions');
    if (!actionsContainer) return;
    
    const googleBtn = actionsContainer.querySelector('[data-action="google"]');
    if (googleBtn) {
        const icon = googleBtn.querySelector('.action-icon');
        const tooltip = googleBtn.querySelector('.action-tooltip');
        
        if (AvatarState.isGoogleConnected) {
            icon.textContent = '🔗';
            tooltip.textContent = 'Desconectar Google';
            googleBtn.classList.add('connected');
        } else {
            icon.textContent = '🔌';
            tooltip.textContent = 'Conectar Google';
            googleBtn.classList.remove('connected');
        }
    }
}

// ==================== POPUP DE EDICIÓN DE NOMBRE ====================
function showNameEditPopup() {
    // CRÍTICO: Remover cualquier popup existente para evitar congelamiento
    document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
    
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.id = 'avatar-name-popup';
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
                       value="${AvatarState.userName || ''}" 
                       autocomplete="off" 
                       style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 1em; margin-bottom: 8px;">
                <p style="color: #999; font-size: 0.8em; margin-bottom: 15px;">
                    💡 Ejemplo: JUAN PEREZ → Se guardará como "Juan Pérez"
                </p>
                <div id="avatar-name-error" style="color: var(--error); font-size: 0.85em; margin-bottom: 10px; display: none;"></div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-primary" onclick="saveAvatarName()" style="flex: 1;">
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
            saveAvatarName();
        }
    });
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function saveAvatarName() {
    const input = document.getElementById('avatar-name-input');
    const errorDiv = document.getElementById('avatar-name-error');
    const name = input.value.trim();
    
    const result = setUserName(name);
    
    if (!result.success) {
        errorDiv.textContent = '⚠️ ' + result.message;
        errorDiv.style.display = 'block';
        input.focus();
        return;
    }
    
    // CRÍTICO: Actualizar CURRENT_USER globalmente para que se use en envíos
    if (typeof window.CURRENT_USER !== 'undefined') {
        window.CURRENT_USER = result.formatted;
        console.log('✅ [AVATAR] CURRENT_USER actualizado globalmente:', result.formatted);
    }
    
    // También actualizar en localStorage para persistencia
    const userEmail = AvatarState.userEmail || localStorage.getItem('wms_user_email') || '';
    if (userEmail) {
        localStorage.setItem(`wms_alias_${userEmail}`, result.formatted);
    }
    
    updateAvatarDisplay();
    document.querySelector('.popup-overlay')?.remove();
    
    // Notificar a la app que el usuario cambió
    if (typeof window.updateUserFooter === 'function') {
        window.updateUserFooter();
    }
    
    if (typeof showNotification === 'function') {
        showNotification(`✅ Nombre actualizado: ${result.formatted}`, 'success');
    }
}

// ==================== BOTONES DE ACCIÓN ====================
function createAvatarActions() {
    const userFooter = document.querySelector('.user-footer');
    if (!userFooter) return;
    
    const existingActions = userFooter.querySelector('.avatar-actions');
    if (existingActions) {
        existingActions.remove();
    }
    
    const actionsHTML = `
        <div class="avatar-actions">
            <button class="avatar-action-btn" data-action="refresh" onclick="handleAvatarAction('refresh')" title="Actualizar BD">
                <span class="action-icon">🔄</span>
                <span class="action-tooltip">Actualizar BD</span>
            </button>
            <button class="avatar-action-btn" data-action="google" onclick="handleAvatarAction('google')" title="Conectar/Desconectar Google">
                <span class="action-icon">🔌</span>
                <span class="action-tooltip">Conectar Google</span>
            </button>
            <button class="avatar-action-btn" data-action="logout" onclick="handleAvatarAction('logout')" title="Cerrar sesión">
                <span class="action-icon">🚪</span>
                <span class="action-tooltip">Cerrar sesión</span>
            </button>
        </div>
    `;
    
    const userInfo = userFooter.querySelector('.user-info');
    if (userInfo) {
        userInfo.insertAdjacentHTML('afterend', actionsHTML);
    }
    
    updateAvatarButtons();
}

function handleAvatarAction(action) {
    switch (action) {
        case 'refresh':
            if (typeof refreshInventory === 'function') {
                refreshInventory();
            } else if (typeof loadInventory === 'function') {
                loadInventory();
            }
            break;
            
        case 'google':
            toggleGoogleConnection();
            break;
            
        case 'logout':
            if (typeof handleLogout === 'function') {
                handleLogout();
            }
            break;
    }
}

function toggleGoogleConnection() {
    if (AvatarState.isGoogleConnected) {
        if (confirm('¿Desconectar de Google? Deberás volver a iniciar sesión.')) {
            clearGoogleConnection();
            if (typeof showNotification === 'function') {
                showNotification('🔌 Desconectado de Google', 'info');
            }
        }
    } else {
        if (typeof handleLogin === 'function') {
            handleLogin();
        } else {
            if (typeof showNotification === 'function') {
                showNotification('⚠️ Función de login no disponible', 'warning');
            }
        }
    }
}

// ==================== CALLBACKS Y NOTIFICACIONES ====================
function onAvatarUpdate(callback) {
    if (typeof callback === 'function') {
        AvatarState.onUpdateCallbacks.push(callback);
    }
}

function notifyUpdate() {
    AvatarState.onUpdateCallbacks.forEach(callback => {
        try {
            callback(AvatarState);
        } catch (e) {
            console.error('Error in avatar update callback:', e);
        }
    });
}

// ==================== API PÚBLICA ====================
window.AvatarSystem = {
    init: initAvatarSystem,
    setUserName,
    setUserEmail,
    getUserName: () => AvatarState.userName,
    getUserEmail: () => AvatarState.userEmail,
    isGoogleConnected: () => AvatarState.isGoogleConnected,
    saveGoogleConnection,
    clearGoogleConnection,
    onUpdate: onAvatarUpdate,
    createActions: createAvatarActions,
    showNamePopup: showNameEditPopup,
    updateDisplay: updateAvatarDisplay,
    formatNameToTitle: formatNameToTitle,  // Exponer función de formateo
    getState: () => AvatarState  // Exponer estado para debugging
};
