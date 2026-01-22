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
                    // SOLUCIÓN COOP: Usar configuración que evita problemas de Cross-Origin-Opener-Policy
                    this.tokenClient = google.accounts.oauth2.initTokenClient({
                        client_id: this.CLIENT_ID,
                        scope: this.SCOPES,
                        callback: '', // Se configura dinámicamente en login/renewToken
                        error_callback: (err) => {
                            // Manejar errores de popup bloqueado o COOP
                            console.warn('⚠️ AuthManager: Error en flujo OAuth:', err);
                            if (err.type === 'popup_failed_to_open' || err.type === 'popup_closed') {
                                console.log('🔄 AuthManager: Popup bloqueado, usando método alternativo...');
                                this.handlePopupBlocked();
                            }
                        }
                    });
                    this.gisInited = true;
                    console.log('✅ AuthManager: Google Identity Services initialized (COOP-safe)');
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
     * Manejar cuando el popup es bloqueado por COOP
     */
    handlePopupBlocked() {
        console.log('🔄 AuthManager: Intentando autenticación alternativa...');

        // Notificar al usuario
        if (typeof showNotification === 'function') {
            showNotification('🔄 Redirigiendo a Google para autenticación...', 'info');
        }

        // Usar el método de redirección como fallback
        // Guardar estado actual para restaurar después del redirect
        sessionStorage.setItem('auth_redirect_pending', 'true');
        sessionStorage.setItem('auth_redirect_url', window.location.href);

        // Solicitar con prompt de consentimiento para forzar interacción
        if (this.tokenClient) {
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
        }
    },

    /**
     * Verificar si hay una sesión guardada
     * MEJORADO: Valida token con Google antes de restaurar
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

            // Si el token expiró pero la sesión de 12 horas sigue activa
            if (timeUntilExpiry <= 0 && sessionExpiry) {
                const sessionExpiryTime = parseInt(sessionExpiry);
                if (Date.now() < sessionExpiryTime) {
                    console.log('🔄 AuthManager: Token expirado pero sesión activa');
                    // Restaurar datos de usuario primero
                    this.currentUser = savedUser;
                    this.userEmail = savedEmail;
                    this.userName = savedName;

                    // IMPORTANTE: No llamar onAuthSuccess hasta que tengamos token válido
                    // Programar renovación con delay para permitir que GIS se inicialice
                    setTimeout(() => {
                        console.log('🔄 AuthManager: Iniciando renovación de token...');
                        this.renewToken();
                    }, 2000);

                    // Llamar onAuthSuccess con flag indicando que necesita renovación
                    if (this.onAuthSuccess) {
                        this.onAuthSuccess({
                            user: savedUser,
                            email: savedEmail,
                            name: savedName,
                            needsTokenRenewal: true
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

                // Renovar en background sin bloquear (con delay para GIS)
                setTimeout(() => this.renewToken(), 2000);

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
     * SOLUCIÓN COOP: Usa hint para renovación sin popup cuando es posible
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
        this.renewAttempts = (this.renewAttempts || 0) + 1;
        console.log(`🔄 AuthManager: Iniciando renovación de token (intento ${this.renewAttempts})...`);

        // Timeout para detectar si el popup fue bloqueado por COOP
        const renewTimeout = setTimeout(() => {
            if (this.isRenewing) {
                console.warn('⚠️ AuthManager: Timeout en renovación (posible bloqueo COOP)');
                this.isRenewing = false;

                // Si hay token guardado que aún funciona, mantenerlo
                const savedToken = localStorage.getItem('google_access_token');
                if (savedToken && gapi?.client?.getToken()) {
                    console.log('🔄 AuthManager: Manteniendo token actual, reintentando renovación en 10 min...');
                    this.scheduleTokenRenewal(10 * 60 * 1000);
                } else {
                    // Reintentar con prompt de consentimiento
                    console.log('🔄 AuthManager: Reintentando con consentimiento del usuario...');
                    this.scheduleTokenRenewal(30 * 1000); // 30 segundos
                    this.forceConsentOnNextRenew = true;
                }
            }
        }, 15000); // 15 segundos timeout

        this.tokenClient.callback = async (resp) => {
            clearTimeout(renewTimeout);
            this.isRenewing = false;

            if (resp.error) {
                console.error('❌ AuthManager: Error renovando token:', resp);

                // Errores comunes de COOP/popup
                const coopErrors = ['popup_closed', 'popup_failed_to_open', 'access_denied', 'immediate_failed'];
                const isCoopError = coopErrors.includes(resp.error) ||
                                    (resp.error_description && resp.error_description.includes('popup'));

                if (isCoopError) {
                    console.warn('⚠️ AuthManager: Error relacionado con COOP/popup');

                    // Si tenemos token válido en memoria, mantenerlo
                    if (gapi?.client?.getToken()?.access_token) {
                        console.log('🔄 AuthManager: Token en memoria aún válido, reintentando en 5 min...');
                        this.scheduleTokenRenewal(5 * 60 * 1000);
                    } else if (this.renewAttempts < 3) {
                        // Reintentar con consentimiento después de un delay
                        console.log('🔄 AuthManager: Programando reintento con consentimiento...');
                        this.forceConsentOnNextRenew = true;
                        this.scheduleTokenRenewal(60 * 1000); // 1 minuto
                    } else {
                        console.warn('⚠️ AuthManager: Máximos intentos de renovación alcanzados');
                        this.renewAttempts = 0;
                        // NO limpiar sesión, solo programar reintento más tarde
                        this.scheduleTokenRenewal(15 * 60 * 1000); // 15 minutos
                    }
                } else {
                    // Otros errores: reintentar
                    this.scheduleTokenRenewal(5 * 60 * 1000);
                }
                return;
            }

            // Éxito: resetear contador de intentos
            this.renewAttempts = 0;
            this.forceConsentOnNextRenew = false;

            // Guardar nuevo token (válido por 1 hora según Google)
            const tokenExpiryTime = Date.now() + (3600 * 1000); // 1 hora
            localStorage.setItem('google_access_token', resp.access_token);
            localStorage.setItem('google_token_expiry', tokenExpiryTime.toString());

            gapi.client.setToken({ access_token: resp.access_token });

            // Programar siguiente renovación 5 minutos antes de expirar (55 min)
            this.scheduleTokenRenewal(55 * 60 * 1000);

            console.log('✅ AuthManager: Token renovado exitosamente (próxima renovación en 55 min)');
        };

        // SOLUCIÓN COOP: Usar hint con el email del usuario para renovación más confiable
        const renewOptions = {};

        if (this.forceConsentOnNextRenew) {
            // Si falló antes, pedir consentimiento explícito
            renewOptions.prompt = 'consent';
            console.log('🔄 AuthManager: Solicitando con consentimiento explícito');
        } else if (this.userEmail) {
            // Usar hint para renovación silenciosa más confiable
            renewOptions.hint = this.userEmail;
            renewOptions.prompt = '';
            console.log('🔄 AuthManager: Solicitando con hint:', this.userEmail);
        } else {
            renewOptions.prompt = '';
        }

        try {
            this.tokenClient.requestAccessToken(renewOptions);
        } catch (e) {
            clearTimeout(renewTimeout);
            this.isRenewing = false;
            console.error('❌ AuthManager: Excepción en requestAccessToken:', e);
            this.scheduleTokenRenewal(5 * 60 * 1000);
        }
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
        
        // Timeout para detectar si el popup fue bloqueado
        const loginTimeout = setTimeout(() => {
            console.warn('⚠️ AuthManager: Timeout en login (posible bloqueo COOP)');
            if (typeof showNotification === 'function') {
                showNotification('⚠️ Si no ves la ventana de Google, permite popups para este sitio', 'warning');
            }
        }, 10000);

        this.tokenClient.callback = async (resp) => {
            clearTimeout(loginTimeout);

            if (resp.error) {
                console.error('❌ AuthManager: Auth error:', resp);

                // Manejar errores específicos de COOP/popup
                const isPopupError = resp.error === 'popup_closed' ||
                                     resp.error === 'popup_failed_to_open' ||
                                     (resp.error_description && resp.error_description.includes('popup'));

                if (isPopupError) {
                    if (typeof showNotification === 'function') {
                        showNotification('⚠️ Ventana de Google bloqueada. Permite popups y reintenta.', 'warning');
                    }
                } else {
                    if (typeof showNotification === 'function') {
                        showNotification('❌ Error de autenticación', 'error');
                    }
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

            console.log('✅ AuthManager: Login exitoso, sesión válida por 12 horas');

            if (this.onAuthSuccess) {
                this.onAuthSuccess({
                    user: this.currentUser,
                    email: this.userEmail,
                    name: this.userName
                });
            }
        };

        try {
            this.tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch (e) {
            clearTimeout(loginTimeout);
            console.error('❌ AuthManager: Excepción en login:', e);
            if (typeof showNotification === 'function') {
                showNotification('❌ Error al iniciar autenticación', 'error');
            }
        }
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
     * Validar que el token actual funcione con Google
     * @returns {Promise<boolean>} true si el token es válido
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

            if (response.ok) {
                console.log('✅ AuthManager: Token validado correctamente');
                return true;
            } else {
                console.warn('⚠️ AuthManager: Token inválido, status:', response.status);
                return false;
            }
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
        if (token) {
            try {
                google.accounts.oauth2.revoke(token.access_token);
            } catch (e) {
                console.warn('⚠️ AuthManager: Error revocando token:', e);
            }
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
