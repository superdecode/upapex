// Core persistence and synchronization system for WMS Validator

// Global state
const PERSISTENCE = {
    DB_NAME: 'WMS_Validator_DB',
    DB_VERSION: 1,
    STORE_NAMES: {
        VALIDATIONS: 'validations',
        PENDING: 'pending',
        QUARANTINE: 'quarantine'
    },
    MAX_RETRY_ATTEMPTS: 3,
    SYNC_INTERVAL: 30000, // 30 seconds
    db: null,
    pendingSync: [],
    isOnline: navigator.onLine,
    isGoogleConnected: false,
    syncInProgress: false,
    healthCheckInterval: null
};

/**
 * Initialize the database and start background processes
 */
async function initPersistence() {
    try {
        await initIndexedDB();
        await loadPendingSync();
        setupConnectionMonitor();
        startHealthCheck();
        startAutoSync();
        setupExitProtection();
        console.log('Persistence system initialized');
    } catch (error) {
        console.error('Failed to initialize persistence system:', error);
        showNotification('⚠️ Error al inicializar el sistema de persistencia', 'error');
    }
}

/**
 * Initialize IndexedDB with required object stores
 */
async function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(PERSISTENCE.DB_NAME, PERSISTENCE.DB_VERSION);
        
        request.onerror = () => {
            console.error('IndexedDB error:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = (event) => {
            PERSISTENCE.db = event.target.result;
            resolve(PERSISTENCE.db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Create object stores if they don't exist
            if (!db.objectStoreNames.contains(PERSISTENCE.STORE_NAMES.VALIDATIONS)) {
                const store = db.createObjectStore(PERSISTENCE.STORE_NAMES.VALIDATIONS, { keyPath: 'id' });
                store.createIndex('by_timestamp', 'timestamp', { unique: false });
            }
            
            if (!db.objectStoreNames.contains(PERSISTENCE.STORE_NAMES.PENDING)) {
                db.createObjectStore(PERSISTENCE.STORE_NAMES.PENDING, { keyPath: 'id' });
            }
            
            if (!db.objectStoreNames.contains(PERSISTENCE.STORE_NAMES.QUARANTINE)) {
                db.createObjectStore(PERSISTENCE.STORE_NAMES.QUARANTINE, { keyPath: 'id' });
            }
        };
    });
}

/**
 * Save validation data with multiple fallbacks
 */
async function saveValidationSafely(validationData) {
    const id = `val_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();
    
    const record = {
        id,
        timestamp,
        data: validationData,
        synced: false,
        attempts: 0
    };
    
    try {
        // Save to IndexedDB
        await saveToStore(PERSISTENCE.STORE_NAMES.VALIDATIONS, record);
        
        // Also save to localStorage as backup
        localStorage.setItem(`validation_${id}`, JSON.stringify(record));
        
        // Try to sync immediately if online
        if (PERSISTENCE.isOnline && PERSISTENCE.isGoogleConnected) {
            await attemptSync(record);
        } else {
            // Add to pending sync queue
            await addToPendingSync(record);
        }
        
        return true;
    } catch (error) {
        console.error('Error saving validation:', error);
        showNotification('⚠️ Error al guardar la validación', 'error');
        return false;
    }
}

/**
 * Save data to IndexedDB
 */
async function saveToStore(storeName, data) {
    return new Promise((resolve, reject) => {
        const transaction = PERSISTENCE.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Add record to pending sync queue
 */
async function addToPendingSync(record) {
    if (!record.id) return;
    
    // Don't add duplicates
    const exists = PERSISTENCE.pendingSync.some(item => item.id === record.id);
    if (exists) return;
    
    PERSISTENCE.pendingSync.push({
        id: record.id,
        timestamp: record.timestamp || Date.now(),
        data: record.data,
        attempts: record.attempts || 0
    });
    
    await savePendingSync();
    updatePendingBadge();
}

/**
 * Save pending sync queue to IndexedDB
 */
async function savePendingSync() {
    try {
        const transaction = PERSISTENCE.db.transaction([PERSISTENCE.STORE_NAMES.PENDING], 'readwrite');
        const store = transaction.objectStore(PERSISTENCE.STORE_NAMES.PENDING);
        
        // Clear existing pending items
        const clearRequest = store.clear();
        
        clearRequest.onsuccess = () => {
            // Add all current pending items
            const requests = PERSISTENCE.pendingSync.map(item => {
                return new Promise((resolve) => {
                    const addRequest = store.add(item);
                    addRequest.onsuccess = resolve;
                    addRequest.onerror = () => {
                        console.error('Error saving pending item:', addRequest.error);
                        resolve();
                    };
                });
            });
            
            Promise.all(requests).catch(console.error);
        };
    } catch (error) {
        console.error('Error saving pending sync:', error);
    }
}

/**
 * Load pending sync queue from IndexedDB
 */
async function loadPendingSync() {
    return new Promise((resolve) => {
        const transaction = PERSISTENCE.db.transaction([PERSISTENCE.STORE_NAMES.PENDING], 'readonly');
        const store = transaction.objectStore(PERSISTENCE.STORE_NAMES.PENDING);
        const request = store.getAll();
        
        request.onsuccess = () => {
            PERSISTENCE.pendingSync = request.result || [];
            updatePendingBadge();
            resolve(PERSISTENCE.pendingSync);
        };
        
        request.onerror = (error) => {
            console.error('Error loading pending sync:', error);
            PERSISTENCE.pendingSync = [];
            resolve([]);
        };
    });
}

/**
 * Update the UI to show number of pending syncs
 */
function updatePendingBadge() {
    const count = PERSISTENCE.pendingSync.length;
    const badge = document.getElementById('pending-badge');
    
    if (badge) {
        badge.textContent = count > 0 ? ` (${count})` : '';
        badge.style.display = count > 0 ? 'inline' : 'none';
    }
    
    // Update document title if there are pending syncs
    if (count > 0) {
        document.title = `(${count}) ${document.title.replace(/^\(\d+\)\s*/, '')}`;
    } else {
        document.title = document.title.replace(/^\(\d+\)\s*/, '');
    }
}

/**
 * Monitor network connection status
 */
function setupConnectionMonitor() {
    window.addEventListener('online', handleConnectionChange);
    window.addEventListener('offline', handleConnectionChange);
    
    // Initial check
    handleConnectionChange();
    
    function handleConnectionChange() {
        PERSISTENCE.isOnline = navigator.onLine;
        const banner = document.getElementById('connection-banner');
        
        if (!PERSISTENCE.isOnline) {
            banner.textContent = '🔴 Sin conexión - Trabajando en modo local';
            banner.style.display = 'block';
            banner.style.backgroundColor = '#ffebee';
        } else if (!PERSISTENCE.isGoogleConnected) {
            banner.textContent = '🟡 Conectado - Esperando autenticación de Google';
            banner.style.display = 'block';
            banner.style.backgroundColor = '#fff8e1';
        } else if (PERSISTENCE.pendingSync.length > 0) {
            banner.textContent = `🟠 ${PERSISTENCE.pendingSync.length} validaciones pendientes de sincronizar`;
            banner.style.display = 'block';
            banner.style.backgroundColor = '#fff3e0';
        } else {
            banner.style.display = 'none';
        }
    }
}

/**
 * Start health check interval
 */
function startHealthCheck() {
    if (PERSISTENCE.healthCheckInterval) {
        clearInterval(PERSISTENCE.healthCheckInterval);
    }
    
    PERSISTENCE.healthCheckInterval = setInterval(async () => {
        if (PERSISTENCE.isOnline) {
            const isHealthy = await checkGoogleSheetsConnection();
            if (!isHealthy && gapi.client.getToken()) {
                showNotification('⚠️ Se perdió la conexión con Google Sheets - Intentando reconectar...', 'warning');
                await attemptReconnection();
            } else if (isHealthy && !PERSISTENCE.isGoogleConnected) {
                PERSISTENCE.isGoogleConnected = true;
                showNotification('✅ Conexión con Google Sheets restablecida', 'success');
                startAutoSync();
            }
        }
    }, 30000); // Check every 30 seconds
}

/**
 * Check if Google Sheets connection is healthy
 */
async function checkGoogleSheetsConnection() {
    if (!gapi.client || !gapi.client.sheets) return false;
    
    try {
        await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_BD,
            fields: 'spreadsheetId'
        });
        return true;
    } catch (error) {
        console.error('Google Sheets connection check failed:', error);
        return false;
    }
}

/**
 * Attempt to reconnect to Google Sheets
 */
async function attemptReconnection() {
    try {
        // Try to refresh the token
        const tokenClient = window.tokenClient || gapi.client.getToken();
        if (tokenClient && tokenClient.requestAccessToken) {
            await tokenClient.requestAccessToken({ prompt: '' });
        }
        
        // Verify connection
        const isHealthy = await checkGoogleSheetsConnection();
        if (isHealthy) {
            PERSISTENCE.isGoogleConnected = true;
            showNotification('✅ Conexión con Google Sheets restablecida', 'success');
            startAutoSync();
            return true;
        }
        
        throw new Error('Connection still not healthy after token refresh');
    } catch (error) {
        console.error('Reconnection attempt failed:', error);
        PERSISTENCE.isGoogleConnected = false;
        showNotification('❌ No se pudo reconectar con Google Sheets - Trabajando en modo local', 'error');
        return false;
    }
}

/**
 * Start automatic sync process
 */
function startAutoSync() {
    // Don't start multiple syncs
    if (PERSISTENCE.syncInProgress) return;
    
    // Only sync if we're online and connected to Google
    if (!PERSISTENCE.isOnline || !PERSISTENCE.isGoogleConnected) {
        console.log('Auto-sync skipped: offline or not connected to Google');
        return;
    }
    
    // Don't sync if there's nothing to sync
    if (PERSISTENCE.pendingSync.length === 0) {
        console.log('Auto-sync skipped: no pending items');
        return;
    }
    
    console.log('Starting auto-sync...');
    PERSISTENCE.syncInProgress = true;
    
    // Process sync in the background
    processSyncQueue()
        .catch(console.error)
        .finally(() => {
            PERSISTENCE.syncInProgress = false;
            console.log('Auto-sync completed');
        });
}

/**
 * Process the sync queue
 */
async function processSyncQueue() {
    if (PERSISTENCE.pendingSync.length === 0) return;
    
    console.log(`Processing ${PERSISTENCE.pendingSync.length} pending items...`);
    
    // Create a copy of pending items to avoid modification during iteration
    const itemsToSync = [...PERSISTENCE.pendingSync];
    const successfulSyncs = [];
    const failedSyncs = [];
    
    for (const item of itemsToSync) {
        try {
            // Skip if max attempts reached
            if (item.attempts >= PERSISTENCE.MAX_RETRY_ATTEMPTS) {
                console.warn(`Max attempts reached for item ${item.id}, moving to quarantine`);
                await moveToQuarantine(item);
                continue;
            }
            
            // Try to sync the item
            const success = await attemptSync(item);
            
            if (success) {
                successfulSyncs.push(item.id);
            } else {
                item.attempts = (item.attempts || 0) + 1;
                failedSyncs.push(item);
            }
        } catch (error) {
            console.error(`Error syncing item ${item.id}:`, error);
            item.attempts = (item.attempts || 0) + 1;
            failedSyncs.push(item);
        }
    }
    
    // Update pending sync queue
    PERSISTENCE.pendingSync = failedSyncs;
    await savePendingSync();
    updatePendingBadge();
    
    // Show notification if we synced anything
    if (successfulSyncs.length > 0) {
        showNotification(`✅ Sincronizadas ${successfulSyncs.length} validaciones`, 'success');
    }
    
    // Show warning if we have failures
    if (failedSyncs.length > 0) {
        showNotification(`⚠️ ${failedSyncs.length} validaciones no se pudieron sincronizar`, 'warning');
    }
    
    return {
        successful: successfulSyncs.length,
        failed: failedSyncs.length
    };
}

/**
 * Attempt to sync a single item
 */
async function attemptSync(item) {
    if (!item || !item.data) return false;
    
    try {
        // Try to write to Google Sheets
        await writeToSheets(item.data.sheet, item.data.log);
        
        // If successful, mark as synced in the database
        await markAsSynced(item.id);
        
        return true;
    } catch (error) {
        console.error(`Sync attempt failed for item ${item.id}:`, error);
        return false;
    }
}

/**
 * Mark a record as synced in the database
 */
async function markAsSynced(id) {
    try {
        // Get the record from the database
        const record = await getFromStore(PERSISTENCE.STORE_NAMES.VALIDATIONS, id);
        
        if (record) {
            // Update the record
            record.synced = true;
            record.syncedAt = Date.now();
            
            // Save the updated record
            await saveToStore(PERSISTENCE.STORE_NAMES.VALIDATIONS, record);
            
            // Remove from pending sync queue
            PERSISTENCE.pendingSync = PERSISTENCE.pendingSync.filter(item => item.id !== id);
            await savePendingSync();
            updatePendingBadge();
            
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error marking record as synced:', error);
        return false;
    }
}

/**
 * Get a record from a store
 */
async function getFromStore(storeName, id) {
    return new Promise((resolve, reject) => {
        const transaction = PERSISTENCE.db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(id);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Move an item to quarantine
 */
async function moveToQuarantine(item) {
    try {
        // Add to quarantine store
        await saveToStore(PERSISTENCE.STORE_NAMES.QUARANTINE, {
            ...item,
            quarantinedAt: Date.now(),
            reason: 'Max sync attempts reached'
        });
        
        // Remove from pending sync
        PERSISTENCE.pendingSync = PERSISTENCE.pendingSync.filter(i => i.id !== item.id);
        await savePendingSync();
        updatePendingBadge();
        
        // Show notification
        showNotification(`⚠️ Se movió a cuarentena: ${item.data?.log?.code || 'validación'}`, 'warning');
        
        return true;
    } catch (error) {
        console.error('Error moving item to quarantine:', error);
        return false;
    }
}

/**
 * Setup exit protection to prevent data loss
 */
function setupExitProtection() {
    let isExiting = false;
    
    window.addEventListener('beforeunload', async (e) => {
        // Don't prevent exit if we're already handling it
        if (isExiting) return;
        
        // Check if we have pending syncs
        if (PERSISTENCE.pendingSync.length > 0) {
            // Cancel the event
            e.preventDefault();
            
            // Chrome requires returnValue to be set
            e.returnValue = '';
            
            // Try to sync one last time
            try {
                isExiting = true;
                await processSyncQueue();
                
                // If we still have pending syncs, show a warning
                if (PERSISTENCE.pendingSync.length > 0) {
                    const msg = `Tienes ${PERSISTENCE.pendingSync.length} validaciones pendientes de sincronizar.\n\n` +
                               'Los datos se guardaron localmente y se sincronizarán automáticamente cuando recuperes la conexión.\n\n' +
                               '¿Estás seguro de que quieres salir?';
                    
                    // Show confirmation dialog
                    if (!confirm(msg)) {
                        isExiting = false;
                        return;
                    }
                }
                
                // If we get here, either sync was successful or user confirmed exit
                isExiting = true;
                window.close();
            } catch (error) {
                console.error('Error during exit sync:', error);
                isExiting = false;
            }
        }
    });
    
    // Add safe exit button to the UI
    addSafeExitButton();
}

/**
 * Add safe exit buttons to the UI (sidebar and dashboard)
 */
function addSafeExitButton() {
    // Check if the button already exists
    if (document.getElementById('safe-exit-button-sidebar')) return;

    // Helper function to create a safe exit button
    function createSafeExitBtn(id, isSmall = false) {
        const button = document.createElement('button');
        button.id = id;
        button.className = isSmall ? 'btn btn-small' : 'btn';
        button.innerHTML = '🚪 Salir con Seguridad';
        button.style.cssText = `
            width: 100%;
            padding: ${isSmall ? '8px 15px' : '15px 30px'};
            background-color: #ed5224;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: ${isSmall ? '0.85em' : '1.1em'};
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 10px;
        `;

        // Add hover effect
        button.addEventListener('mouseover', () => {
            button.style.backgroundColor = '#d4491f';
            button.style.transform = 'translateY(-2px)';
            button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        });

        button.addEventListener('mouseout', () => {
            button.style.backgroundColor = '#ed5224';
            button.style.transform = 'none';
            button.style.boxShadow = 'none';
        });

        // Add click handler
        button.addEventListener('click', showSafeExitDialog);

        return button;
    }

    // 1. Add button to sidebar (after "Sincronizar" button)
    const syncButton = document.querySelector('button[onclick="forceSync()"]');
    if (syncButton && syncButton.parentElement) {
        const sidebarBtn = createSafeExitBtn('safe-exit-button-sidebar', true);
        syncButton.insertAdjacentElement('afterend', sidebarBtn);
    }

    // 2. Add button to dashboard (after "Iniciar Validación" button)
    const startBtn = document.getElementById('start-btn');
    if (startBtn && startBtn.parentElement) {
        const dashboardBtn = createSafeExitBtn('safe-exit-button-dashboard', false);
        startBtn.insertAdjacentElement('afterend', dashboardBtn);
    }
}

/**
 * Show the safe exit dialog
 */
function showSafeExitDialog() {
    // Create the overlay
    const overlay = document.createElement('div');
    overlay.id = 'safe-exit-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    // Create the dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: white;
        border-radius: 10px;
        padding: 25px;
        max-width: 500px;
        width: 90%;
        box-shadow: 0 5px 30px rgba(0, 0, 0, 0.3);
        text-align: center;
    `;
    
    // Add content
    dialog.innerHTML = `
        <h2 style="color: #ed5224; margin-bottom: 20px;">🚪 Salida Segura</h2>
        
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left;">
            <p style="margin: 0 0 10px 0;"><strong>📊 Estado actual:</strong></p>
            <ul style="margin: 0; padding-left: 20px;">
                <li>${PERSISTENCE.pendingSync.length} validaciones pendientes de sincronizar</li>
                <li>${PERSISTENCE.isOnline ? '✅ En línea' : '❌ Sin conexión'}</li>
                <li>${PERSISTENCE.isGoogleConnected ? '✅ Conectado a Google Sheets' : '❌ No conectado a Google Sheets'}</li>
            </ul>
        </div>
        
        ${PERSISTENCE.pendingSync.length > 0 ? `
            <div style="background: #fff3e0; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 0;">
                    <strong>⚠️ Tienes ${PERSISTENCE.pendingSync.length} validaciones pendientes de sincronizar.</strong>
                    Se recomienda sincronizar antes de salir.
                </p>
            </div>
        ` : ''}
        
        <div style="display: flex; gap: 10px; justify-content: center; margin-top: 20px;">
            ${PERSISTENCE.pendingSync.length > 0 && PERSISTENCE.isOnline && PERSISTENCE.isGoogleConnected ? `
                <button id="sync-and-exit" style="background: #4CAF50; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; flex: 1;">
                    🔄 Sincronizar y Salir
                </button>
            ` : ''}
            
            <button id="save-and-exit" style="background: #2196F3; color: white; border: none; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: bold; flex: 1;">
                💾 Guardar y Salir
            </button>
            
            <button id="cancel-exit" style="background: #f5f5f5; border: 1px solid #ddd; padding: 10px 15px; border-radius: 5px; cursor: pointer; font-weight: bold;">
                ❌ Cancelar
            </button>
        </div>
    `;
    
    // Add the dialog to the overlay
    overlay.appendChild(dialog);
    
    // Add the overlay to the page
    document.body.appendChild(overlay);
    
    // Add event listeners
    document.getElementById('sync-and-exit')?.addEventListener('click', async () => {
        const button = document.getElementById('sync-and-exit');
        const originalText = button.innerHTML;
        
        try {
            button.disabled = true;
            button.innerHTML = '🔄 Sincronizando...';
            
            await processSyncQueue();
            
            if (PERSISTENCE.pendingSync.length === 0) {
                showNotification('✅ Todos los datos se sincronizaron correctamente', 'success');
                window.close();
            } else {
                if (confirm(`No se pudieron sincronizar ${PERSISTENCE.pendingSync.length} validaciones. ¿Deseas salir de todos modos? Los datos están guardados localmente.`)) {
                    window.close();
                } else {
                    overlay.remove();
                }
            }
        } catch (error) {
            console.error('Error during sync and exit:', error);
            showNotification('❌ Error al sincronizar', 'error');
            button.disabled = false;
            button.innerHTML = originalText;
        }
    });
    
    document.getElementById('save-and-exit')?.addEventListener('click', () => {
        showNotification('💾 Datos guardados - Puedes cerrar con seguridad', 'success');
        window.close();
    });
    
    document.getElementById('cancel-exit')?.addEventListener('click', () => {
        overlay.remove();
    });
}

// Initialize the persistence system when the DOM is loaded
document.addEventListener('DOMContentLoaded', initPersistence);

// Export functions that need to be called from other scripts
window.persistence = {
    saveValidationSafely,
    processSyncQueue,
    attemptReconnection,
    showSafeExitDialog
};
