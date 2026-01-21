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
            
            // Esperar a que Google Identity Services esté disponible
            await this.waitForGIS();
            
        } catch (error) {
            console.error('❌ AuthManager: Error initializing GAPI:', error);
        }
    },

    /**
     * Esperar a que Google Identity Services esté disponible
     */
    async waitForGIS() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 50; // 5 segundos máximo
            
            const checkGIS = () => {
                if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
                    // Google Identity Services está disponible
                    this.tokenClient = google.accounts.oauth2.initTokenClient({
                        client_id: this.CLIENT_ID,
                        scope: this.SCOPES,
                        callback: '',
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
     */
    checkSavedSession() {
        const savedToken = localStorage.getItem('google_access_token');
        const savedExpiry = localStorage.getItem('google_token_expiry');
        const sessionExpiry = localStorage.getItem('wms_session_expiry');
        const savedUser = localStorage.getItem('wms_current_user');
        const savedEmail = localStorage.getItem('wms_user_email');
        const savedName = localStorage.getItem('wms_google_name');

        // Verificar si la sesión de 12 horas expiró
        if (sessionExpiry) {
            const sessionExpiryTime = parseInt(sessionExpiry);
            if (Date.now() > sessionExpiryTime) {
                console.log('⏰ AuthManager: Sesión de 12 horas expirada');
                this.clearSession();
                return false;
            }
        }

        if (savedToken && savedExpiry) {
            const expiryTime = parseInt(savedExpiry);
            const timeUntilExpiry = expiryTime - Date.now();

            // Si el token expiró pero la sesión de 12 horas sigue activa, renovar automáticamente
            if (timeUntilExpiry <= 0 && sessionExpiry) {
                const sessionExpiryTime = parseInt(sessionExpiry);
                if (Date.now() < sessionExpiryTime) {
                    console.log('🔄 AuthManager: Token expirado pero sesión activa, renovando...');
                    // Restaurar datos de usuario
                    this.currentUser = savedUser;
                    this.userEmail = savedEmail;
                    this.userName = savedName;

                    // Renovar token en background
                    this.renewToken();

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

            // Si el token expira en menos de 10 minutos, renovarlo en background
            if (timeUntilExpiry < 10 * 60 * 1000 && timeUntilExpiry > 0) {
                console.log('⚠️ AuthManager: Token próximo a expirar, renovando en background...');
                // Usar token actual mientras se renueva
                gapi.client.setToken({ access_token: savedToken });
                this.currentUser = savedUser;
                this.userEmail = savedEmail;
                this.userName = savedName;

                // Renovar en background sin bloquear
                this.renewToken();

                if (this.onAuthSuccess) {
                    this.onAuthSuccess({
                        user: savedUser,
                        email: savedEmail,
                        name: savedName
                    });
                }

                return true;
            }

            // Token válido con suficiente tiempo, restaurar sesión
            if (timeUntilExpiry > 0) {
                gapi.client.setToken({ access_token: savedToken });
                this.currentUser = savedUser;
                this.userEmail = savedEmail;
                this.userName = savedName;

                console.log(`✅ AuthManager: Sesión restaurada (token expira en ${Math.floor(timeUntilExpiry / 60000)} min)`);

                // Programar renovación automática 5 minutos antes de expirar
                this.scheduleTokenRenewal(Math.max(timeUntilExpiry - 5 * 60 * 1000, 0));

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

        // Marcar que estamos renovando para evitar múltiples intentos
        if (this.isRenewing) {
            console.log('⏳ AuthManager: Renovación ya en progreso...');
            return;
        }

        this.isRenewing = true;
        console.log('🔄 AuthManager: Iniciando renovación de token...');

        this.tokenClient.callback = async (resp) => {
            this.isRenewing = false;

            if (resp.error) {
                console.error('❌ AuthManager: Error renovando token:', resp);

                // Si el error es de acceso denegado, mantener sesión y reintentar después
                if (resp.error === 'access_denied' || resp.error === 'immediate_failed') {
                    console.warn('⚠️ AuthManager: Renovación silenciosa falló, reintentando en 5 min...');
                    // Reintentar en 5 minutos
                    this.scheduleTokenRenewal(5 * 60 * 1000);
                } else {
                    // Otros errores: limpiar sesión
                    this.clearSession();
                }
                return;
            }

            // Guardar nuevo token (válido por 1 hora según Google)
            const tokenExpiryTime = Date.now() + (3600 * 1000); // 1 hora
            localStorage.setItem('google_access_token', resp.access_token);
            localStorage.setItem('google_token_expiry', tokenExpiryTime.toString());

            gapi.client.setToken({ access_token: resp.access_token });

            // Programar siguiente renovación 5 minutos antes de expirar (55 min)
            this.scheduleTokenRenewal(55 * 60 * 1000);

            console.log('✅ AuthManager: Token renovado exitosamente (próxima renovación en 55 min)');
        };

        // Intentar renovación silenciosa (sin prompt al usuario)
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

            // Guardar token con tiempo de expiración real de Google (1 hora)
            // Pero mantener sesión activa por 12 horas con renovaciones automáticas
            const tokenExpiryTime = Date.now() + (3600 * 1000); // 1 hora (límite de Google)
            const sessionExpiryTime = Date.now() + (12 * 60 * 60 * 1000); // 12 horas (sesión del usuario)

            localStorage.setItem('google_access_token', resp.access_token);
            localStorage.setItem('google_token_expiry', tokenExpiryTime.toString());
            localStorage.setItem('wms_session_expiry', sessionExpiryTime.toString()); // Expiración de sesión

            gapi.client.setToken({ access_token: resp.access_token });

            // Programar renovación automática 5 minutos antes de expirar el token (55 min)
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
        localStorage.removeItem('wms_session_expiry');

        // Limpiar timeout de renovación si existe
        if (this.renewalTimeout) {
            clearTimeout(this.renewalTimeout);
            this.renewalTimeout = null;
        }

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
