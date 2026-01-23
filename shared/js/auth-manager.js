/**
 * AUTH-MANAGER.JS v3.7.0
 * Sistema compartido de autenticación con Google para todas las apps
 *
 * SIMPLIFICADO: Usa el mismo enfoque que valida.html que NO tiene problemas COOP
 * - Guarda token completo en localStorage
 * - Restaura token al cargar
 * - Si token expira, usuario reconecta manualmente (sin renovación silenciosa)
 * - Evita prompt:'' que causa errores COOP
 */

const AuthManager = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',

    // Storage key - mismo formato que valida.html
    TOKEN_STORAGE_KEY: 'wms_google_token',

    tokenClient: null,
    gapiInited: false,
    gisInited: false,

    currentUser: null,
    userEmail: null,
    userName: null,

    onAuthSuccess: null,
    onAuthError: null,

    /**
     * Inicializar Google API y Google Identity Services
     */
    async init(onSuccess, onError) {
        this.onAuthSuccess = onSuccess;
        this.onAuthError = onError;

        // Cargar GAPI
        await this.initGAPI();

        // Verificar sesión guardada
        await this.checkSavedSession();
    },

    /**
     * Inicializar Google API Client
     */
    async initGAPI() {
        try {
            await gapi.client.init({
                discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
            });
            this.gapiInited = true;

            // Esperar a que Google Identity Services esté disponible
            await this.waitForGIS();

        } catch (error) {
            console.error('❌ AuthManager: Error initializing GAPI:', error);
        }
    },

    /**
     * Esperar a que Google Identity Services esté disponible
     * SIMPLIFICADO: Sin error_callback complejo, igual que valida.html
     */
    async waitForGIS() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 50; // 5 segundos máximo

            const checkGIS = () => {
                if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
                    // Configuración simple como en valida.html
                    this.tokenClient = google.accounts.oauth2.initTokenClient({
                        client_id: this.CLIENT_ID,
                        scope: this.SCOPES,
                        callback: '' // Se configura dinámicamente en login
                    });
                    this.gisInited = true;
                    console.log('✅ AuthManager: Google Identity Services initialized');
                    resolve();
                } else if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(checkGIS, 100);
                } else {
                    console.error('❌ AuthManager: Timeout waiting for Google Identity Services');
                    reject(new Error('Google Identity Services not available'));
                }
            };

            checkGIS();
        });
    },

    /**
     * Verificar si hay una sesión guardada
     * SIMPLIFICADO: Igual que valida.html - restaurar token y validar con getUserProfile
     */
    async checkSavedSession() {
        const savedTokenStr = localStorage.getItem(this.TOKEN_STORAGE_KEY);

        if (!savedTokenStr) {
            console.log('ℹ️ AuthManager: No hay sesión guardada');
            return false;
        }

        try {
            const tokenObj = JSON.parse(savedTokenStr);

            // Restaurar token en gapi
            gapi.client.setToken(tokenObj);

            // Validar que el token funcione llamando a getUserProfile
            // (igual que hace valida.html)
            await this.getUserProfile();

            // Si llegamos aquí, el token es válido
            console.log('✅ AuthManager: Sesión restaurada exitosamente');

            if (this.onAuthSuccess) {
                this.onAuthSuccess({
                    user: this.currentUser,
                    email: this.userEmail,
                    name: this.userName
                });
            }

            return true;

        } catch (error) {
            // Token inválido o expirado - eliminar y requerir nuevo login
            console.warn('⚠️ AuthManager: Token guardado inválido o expirado:', error.message);
            this.clearSession();
            return false;
        }
    },

    /**
     * Iniciar sesión con Google
     * SIMPLIFICADO: Sin prompt especial, igual que valida.html
     */
    login() {
        if (!this.tokenClient) {
            console.error('❌ AuthManager: tokenClient not initialized');

            if (typeof showNotification === 'function') {
                showNotification('⚠️ Inicializando autenticación...', 'warning');
            }

            // Retry después de 1 segundo
            setTimeout(() => {
                if (this.tokenClient) {
                    this.login();
                } else {
                    if (typeof showNotification === 'function') {
                        showNotification('❌ Error: Sistema de autenticación no disponible', 'error');
                    }
                    if (this.onAuthError) {
                        this.onAuthError('TOKEN_CLIENT_NOT_READY');
                    }
                }
            }, 1000);
            return;
        }

        // Configurar callback para recibir el token
        this.tokenClient.callback = async (res) => {
            if (res.error) {
                console.error('❌ AuthManager: Auth error:', res);
                if (typeof showNotification === 'function') {
                    showNotification('❌ Error de autenticación', 'error');
                }
                if (this.onAuthError) {
                    this.onAuthError(res.error);
                }
                return;
            }

            if (res?.access_token) {
                // Guardar token completo como JSON (igual que valida.html)
                gapi.client.setToken(res);
                localStorage.setItem(this.TOKEN_STORAGE_KEY, JSON.stringify(res));

                // Obtener perfil de usuario
                await this.getUserProfile();

                console.log('✅ AuthManager: Login exitoso');

                // Disparar evento para que sync-manager reactive sincronización
                window.dispatchEvent(new CustomEvent('auth-token-updated', {
                    detail: { token: res.access_token, user: this.currentUser }
                }));

                if (this.onAuthSuccess) {
                    this.onAuthSuccess({
                        user: this.currentUser,
                        email: this.userEmail,
                        name: this.userName
                    });
                }
            }
        };

        // Solicitar token con selector de cuenta para permitir cambiar de usuario
        console.log('🔐 AuthManager: Solicitando autenticación...');
        // Usar prompt: 'select_account' para mostrar selector de cuentas
        // Esto permite al usuario elegir con qué cuenta iniciar sesión
        this.tokenClient.requestAccessToken({ prompt: 'select_account' });
    },

    /**
     * Reconectar - solicitar nuevo token
     * SIMPLIFICADO: Igual que login, sin renovación silenciosa
     */
    reconnect() {
        if (!this.tokenClient) {
            console.error('❌ AuthManager: tokenClient not initialized');
            return;
        }

        console.log('🔄 AuthManager: Reconectando...');

        // Configurar callback
        this.tokenClient.callback = async (res) => {
            if (res.error) {
                console.error('❌ AuthManager: Reconnect error:', res);
                if (typeof showNotification === 'function') {
                    showNotification('❌ Error al reconectar', 'error');
                }
                return;
            }

            if (res?.access_token) {
                gapi.client.setToken(res);
                localStorage.setItem(this.TOKEN_STORAGE_KEY, JSON.stringify(res));
                await this.getUserProfile();

                console.log('✅ AuthManager: Reconexión exitosa');

                // Disparar evento para que sync-manager reactive sincronización
                window.dispatchEvent(new CustomEvent('auth-token-updated', {
                    detail: { token: res.access_token, user: this.currentUser }
                }));

                // Notificación ya se muestra desde el listener de auth-token-updated

                if (this.onAuthSuccess) {
                    this.onAuthSuccess({
                        user: this.currentUser,
                        email: this.userEmail,
                        name: this.userName
                    });
                }
            }
        };

        // Solicitar sin parámetros (popup normal)
        this.tokenClient.requestAccessToken();
    },

    /**
     * Obtener perfil de usuario de Google
     * MEJORADO: Detecta cambio de cuenta y limpia datos anteriores
     */
    async getUserProfile() {
        const token = gapi?.client?.getToken();
        if (!token?.access_token) {
            throw new Error('No hay token disponible');
        }

        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { 'Authorization': `Bearer ${token.access_token}` }
        });

        if (!response.ok) {
            throw new Error(`Error obteniendo perfil: ${response.status}`);
        }

        const profile = await response.json();

        // Detectar cambio de cuenta
        const previousEmail = localStorage.getItem('wms_user_email');
        const isNewAccount = previousEmail && previousEmail !== profile.email;

        if (isNewAccount) {
            console.log('🔄 AuthManager: Cambio de cuenta detectado:', previousEmail, '->', profile.email);
            // Limpiar datos de la cuenta anterior que no deben persistir
            // NO limpiar wms_alias_* porque son específicos por email
            localStorage.removeItem('wms_current_user');
            localStorage.removeItem('wms_google_name');
            // Disparar evento para que la app limpie sus datos
            window.dispatchEvent(new CustomEvent('auth-account-changed', {
                detail: { previousEmail, newEmail: profile.email }
            }));
        }

        this.userEmail = profile.email;
        this.userName = profile.name || profile.email.split('@')[0];

        // Verificar si hay alias guardado para ESTE usuario
        const savedAlias = localStorage.getItem(`wms_alias_${this.userEmail}`);
        this.currentUser = savedAlias || this.userName;

        // Guardar en localStorage
        localStorage.setItem('wms_current_user', this.currentUser);
        localStorage.setItem('wms_user_email', this.userEmail);
        localStorage.setItem('wms_google_name', this.userName);

        console.log('✅ AuthManager: User profile loaded:', this.currentUser, '(' + this.userEmail + ')');
    },

    /**
     * Validar que el token actual funcione
     */
    async validateToken() {
        const token = gapi?.client?.getToken();
        if (!token?.access_token) {
            return false;
        }

        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
                headers: { 'Authorization': `Bearer ${token.access_token}` }
            });
            return response.ok;
        } catch (error) {
            console.error('❌ AuthManager: Error validando token:', error);
            return false;
        }
    },

    /**
     * Cerrar sesión
     */
    logout() {
        const token = gapi?.client?.getToken();
        if (token?.access_token) {
            try {
                google.accounts.oauth2.revoke(token.access_token);
            } catch (e) {
                console.warn('⚠️ AuthManager: Error revocando token:', e);
            }
            gapi.client.setToken(null);
        }
        this.clearSession();

        // Disparar evento para que sync-manager y UI se actualicen
        window.dispatchEvent(new CustomEvent('auth-disconnected'));
        console.log('📤 AuthManager: Evento auth-disconnected disparado');
    },

    /**
     * Limpiar sesión guardada
     */
    clearSession() {
        localStorage.removeItem(this.TOKEN_STORAGE_KEY);
        // También limpiar keys legacy por compatibilidad
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_expiry');
        localStorage.removeItem('wms_session_expiry');

        this.currentUser = null;
        this.userEmail = null;
        this.userName = null;

        console.log('🗑️ AuthManager: Sesión limpiada');
    },

    /**
     * Verificar si está autenticado
     */
    isAuthenticated() {
        return gapi?.client?.getToken() !== null;
    },

    /**
     * Obtener token actual
     */
    getToken() {
        return gapi?.client?.getToken();
    }
};

// Hacer disponible globalmente
window.AuthManager = AuthManager;
