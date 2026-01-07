/**
 * AUTH-MANAGER.JS
 * Sistema compartido de autenticación con Google para todas las apps
 */

const AuthManager = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
    
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
        this.checkSavedSession();
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
            
            // Inicializar Google Identity Services
            if (typeof google !== 'undefined' && google.accounts) {
                this.tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: this.CLIENT_ID,
                    scope: this.SCOPES,
                    callback: '',
                });
                this.gisInited = true;
                console.log('✅ AuthManager: Google Identity Services initialized');
            } else {
                console.error('❌ AuthManager: Google Identity Services not loaded');
            }
        } catch (error) {
            console.error('❌ AuthManager: Error initializing GAPI:', error);
        }
    },

    /**
     * Verificar si hay una sesión guardada
     */
    checkSavedSession() {
        const savedToken = localStorage.getItem('google_access_token');
        const savedExpiry = localStorage.getItem('google_token_expiry');
        const savedUser = localStorage.getItem('wms_current_user');
        const savedEmail = localStorage.getItem('wms_user_email');
        const savedName = localStorage.getItem('wms_google_name');

        if (savedToken && savedExpiry) {
            const expiryTime = parseInt(savedExpiry);
            const timeUntilExpiry = expiryTime - Date.now();

            // Si el token expira en menos de 5 minutos, renovarlo
            if (timeUntilExpiry < 5 * 60 * 1000) {
                console.log('⚠️ AuthManager: Token próximo a expirar, renovando...');
                this.renewToken();
                return false;
            }

            // Token válido, restaurar sesión
            if (timeUntilExpiry > 0) {
                gapi.client.setToken({ access_token: savedToken });
                this.currentUser = savedUser;
                this.userEmail = savedEmail;
                this.userName = savedName;

                console.log(`✅ AuthManager: Sesión restaurada (expira en ${Math.floor(timeUntilExpiry / 60000)} min)`);

                // Programar renovación automática
                this.scheduleTokenRenewal(timeUntilExpiry - 5 * 60 * 1000); // 5 min antes

                if (this.onAuthSuccess) {
                    this.onAuthSuccess({
                        user: savedUser,
                        email: savedEmail,
                        name: savedName
                    });
                }

                return true;
            }
        }

        // Token expirado o no existe
        this.clearSession();
        return false;
    },

    /**
     * Programar renovación automática de token
     */
    scheduleTokenRenewal(delay) {
        if (this.renewalTimeout) {
            clearTimeout(this.renewalTimeout);
        }

        this.renewalTimeout = setTimeout(() => {
            console.log('🔄 AuthManager: Renovando token automáticamente...');
            this.renewToken();
        }, Math.max(delay, 0));
    },

    /**
     * Renovar token silenciosamente
     */
    renewToken() {
        if (!this.tokenClient) {
            console.error('❌ AuthManager: No se puede renovar, tokenClient no disponible');
            return;
        }

        this.tokenClient.callback = async (resp) => {
            if (resp.error) {
                console.error('❌ AuthManager: Error renovando token:', resp);
                this.clearSession();
                return;
            }

            // Guardar nuevo token
            const expiryTime = Date.now() + (3600 * 1000);
            localStorage.setItem('google_access_token', resp.access_token);
            localStorage.setItem('google_token_expiry', expiryTime.toString());

            gapi.client.setToken({ access_token: resp.access_token });

            // Programar siguiente renovación
            this.scheduleTokenRenewal(55 * 60 * 1000); // 55 minutos

            console.log('✅ AuthManager: Token renovado exitosamente');
        };

        // Intentar renovación silenciosa (sin prompt)
        this.tokenClient.requestAccessToken({ prompt: '' });
    },

    /**
     * Iniciar sesión con Google
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
        
        this.tokenClient.callback = async (resp) => {
            if (resp.error) {
                console.error('❌ AuthManager: Auth error:', resp);
                if (typeof showNotification === 'function') {
                    showNotification('❌ Error de autenticación', 'error');
                }
                if (this.onAuthError) {
                    this.onAuthError(resp.error);
                }
                return;
            }

            // Guardar token con tiempo de expiración (1 hora)
            const expiryTime = Date.now() + (3600 * 1000);
            localStorage.setItem('google_access_token', resp.access_token);
            localStorage.setItem('google_token_expiry', expiryTime.toString());

            gapi.client.setToken({ access_token: resp.access_token });

            // Programar renovación automática (55 minutos)
            this.scheduleTokenRenewal(55 * 60 * 1000);

            // Obtener perfil de usuario
            await this.getUserProfile();

            if (this.onAuthSuccess) {
                this.onAuthSuccess({
                    user: this.currentUser,
                    email: this.userEmail,
                    name: this.userName
                });
            }
        };

        this.tokenClient.requestAccessToken({ prompt: 'consent' });
    },

    /**
     * Obtener perfil de usuario de Google
     */
    async getUserProfile() {
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
                headers: { 'Authorization': `Bearer ${gapi.client.getToken().access_token}` }
            });
            const profile = await response.json();
            
            this.userEmail = profile.email;
            this.userName = profile.name || profile.email.split('@')[0];
            
            // Verificar si hay alias guardado
            const savedAlias = localStorage.getItem(`wms_alias_${this.userEmail}`);
            this.currentUser = savedAlias || this.userName;
            
            // Guardar en localStorage
            localStorage.setItem('wms_current_user', this.currentUser);
            localStorage.setItem('wms_user_email', this.userEmail);
            localStorage.setItem('wms_google_name', this.userName);
            
            console.log('✅ AuthManager: User profile loaded:', this.currentUser);
        } catch (error) {
            console.error('❌ AuthManager: Error getting profile:', error);
            this.currentUser = 'Usuario';
            this.userName = 'Usuario';
        }
    },

    /**
     * Cerrar sesión
     */
    logout() {
        const token = gapi?.client?.getToken();
        if (token) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');
        }
        this.clearSession();
    },

    /**
     * Limpiar sesión guardada
     */
    clearSession() {
        localStorage.removeItem('google_access_token');
        localStorage.removeItem('google_token_expiry');
        this.currentUser = null;
        this.userEmail = null;
        this.userName = null;
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
