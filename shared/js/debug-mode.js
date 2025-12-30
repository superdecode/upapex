/**
 * DEBUG-MODE.JS
 * Sistema de modo debug para desarrollo sin autenticación de Google
 */

const DebugMode = {
    isEnabled() {
        return localStorage.getItem('WMS_DEBUG_MODE') === 'true';
    },

    enable() {
        localStorage.setItem('WMS_DEBUG_MODE', 'true');
        console.log('🔧 DEBUG MODE ENABLED');
        console.log('Recarga la página para aplicar cambios');
    },

    disable() {
        localStorage.removeItem('WMS_DEBUG_MODE');
        console.log('✅ DEBUG MODE DISABLED');
        console.log('Recarga la página para aplicar cambios');
    },

    /**
     * Simula autenticación sin Google
     */
    mockAuth(appName = 'WMS') {
        if (!this.isEnabled()) return false;

        console.log(`🔧 [DEBUG] Simulando autenticación para ${appName}`);

        // Simular datos de usuario
        window.CURRENT_USER = 'Debug User';
        window.USER_EMAIL = 'debug@wms.local';
        window.USER_GOOGLE_NAME = 'Debug User';

        // Guardar en localStorage
        localStorage.setItem('wms_current_user', 'Debug User');
        localStorage.setItem('wms_user_email', 'debug@wms.local');
        localStorage.setItem('wms_google_name', 'Debug User');

        return true;
    },

    /**
     * Muestra la app principal sin login
     */
    showMainApp() {
        const loginScreen = document.getElementById('login-screen');
        const mainApp = document.getElementById('main-app');

        if (loginScreen) loginScreen.classList.add('hidden');
        if (mainApp) mainApp.classList.remove('hidden');

        console.log('🔧 [DEBUG] App principal mostrada');
    },

    /**
     * Mock de token de Google (para APIs que lo requieren)
     */
    mockGoogleToken() {
        if (!this.isEnabled()) return null;

        return {
            access_token: 'DEBUG_TOKEN_' + Date.now(),
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            token_type: 'Bearer'
        };
    },

    /**
     * Inicialización automática si debug está habilitado
     */
    autoInit(appName, onAuthSuccess) {
        if (!this.isEnabled()) {
            console.log(`ℹ️ Debug mode deshabilitado. Para habilitar, ejecuta en consola: DebugMode.enable()`);
            return false;
        }

        console.log(`🔧 [DEBUG MODE] Iniciando ${appName} en modo debug`);
        
        // Mock de autenticación
        this.mockAuth(appName);
        
        // Mostrar app
        this.showMainApp();

        // Llamar callback de éxito si existe
        if (typeof onAuthSuccess === 'function') {
            setTimeout(() => {
                onAuthSuccess({
                    user: 'Debug User',
                    email: 'debug@wms.local',
                    name: 'Debug User'
                });
            }, 100);
        }

        return true;
    },

    /**
     * Mock de datos para desarrollo
     */
    getMockData(dataType) {
        const mockData = {
            inventory: [
                { code: 'TEST001', sku: 'SKU001', product: 'Producto Test 1', location: 'A1-01-01-01', stock: 100 },
                { code: 'TEST002', sku: 'SKU002', product: 'Producto Test 2', location: 'A1-01-01-02', stock: 50 },
                { code: 'TEST003', sku: 'SKU003', product: 'Producto Test 3', location: 'B2-02-01-01', stock: 75 }
            ],
            orders: [
                { orden: '12345', operador: 'Operador 1', unidad: 'Unidad A', fecha: '2024-12-30' },
                { orden: '12346', operador: 'Operador 2', unidad: 'Unidad B', fecha: '2024-12-30' }
            ],
            validations: [
                { code: 'TEST001', timestamp: '2024-12-30 10:00:00', user: 'Debug User', valid: true }
            ]
        };

        return mockData[dataType] || [];
    },

    /**
     * Información de ayuda
     */
    help() {
        console.log(`
╔════════════════════════════════════════════════════════╗
║           🔧 WMS DEBUG MODE - AYUDA                    ║
╚════════════════════════════════════════════════════════╝

📋 COMANDOS DISPONIBLES:

  DebugMode.enable()          - Activar modo debug
  DebugMode.disable()         - Desactivar modo debug
  DebugMode.isEnabled()       - Verificar si está activo
  DebugMode.mockAuth()        - Simular autenticación
  DebugMode.showMainApp()     - Mostrar app sin login
  DebugMode.getMockData(type) - Obtener datos de prueba
  DebugMode.help()            - Mostrar esta ayuda

🎯 USO RÁPIDO:

  1. Activar debug:
     > DebugMode.enable()
  
  2. Recargar página (F5)
  
  3. La app iniciará automáticamente sin login

  4. Para desactivar:
     > DebugMode.disable()

💡 TIPS:

  - El modo debug se mantiene entre sesiones
  - No afecta a producción (solo local)
  - Útil para desarrollo y testing
  - Mock data disponible para pruebas

⚠️  IMPORTANTE:

  - NO usar en producción
  - Desactivar antes de hacer commit
  - Los datos mock son solo para desarrollo
        `);
    }
};

// Hacer disponible globalmente
window.DebugMode = DebugMode;

// Mostrar ayuda al cargar
if (DebugMode.isEnabled()) {
    console.log('🔧 DEBUG MODE ACTIVO - Ejecuta DebugMode.help() para ver comandos');
}
