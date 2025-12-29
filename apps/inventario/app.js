// ==================== CONFIGURACIÓN ====================
const CONFIG = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile',
    SPREADSHEET_WRITE: '1FBhZloEeT-xTe1yVKzdWxGJa6gKkZQOObmkBMuxqcv8',
    SHEET_NAME: 'BD',
    INVENTORY_CSV_URL: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-HG8HPf-94Ki5Leo5iEF5pyqsiD9CVk-mcl-F8BAw34kT0s3nzNn532YTYDCtkG76NbauiVx0Ffmd/pub?output=csv'
};

// ==================== ESTADO GLOBAL ====================
const STATE = {
    inventory: new Map(),
    inventoryLastUpdate: null,
    pallets: {
        ok: { boxes: [], id: generatePalletId('OK') },
        blocked: { boxes: [], id: generatePalletId('BLK') },
        nowms: { boxes: [], id: generatePalletId('NWS') }
    },
    pendingCode1: null,  // Para sistema Code2
    user: null,
    userEmail: '',
    userName: '',
    userAlias: '',  // Alias personalizado del usuario
    history: [],  // Historial de envíos
    globalSummary: { ok: 0, blocked: 0, nowms: 0, total: 0 }  // Resumen global
};

// Variables globales
let tokenClient;
let gapiInited = false;
let gisInited = false;
let syncManager = null;

// ==================== INICIALIZACIÓN ====================
function initializeApp() {
    initAudio();
    gapiLoaded();
    gisLoaded();
    setupEventListeners();
    setupConnectionMonitor(updateConnectionStatus);
    loadFromStorage();
    updateUI();
}

function gapiLoaded() {
    gapi.load('client', async () => {
        await gapi.client.init({
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
        });
        gapiInited = true;
        maybeEnableButtons();
    });
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: '',
    });
    gisInited = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        console.log('Google APIs initialized');
    }
}

// ==================== AUTENTICACIÓN ====================
function handleLogin() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            console.error('Auth error:', resp);
            showNotification('❌ Error de autenticación', 'error');
            return;
        }
        
        gapi.client.setToken(resp);
        await getUserProfile();
        await loadInventory();
        
        // Inicializar Sync Manager
        syncManager = new SyncManager({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            sheetName: CONFIG.SHEET_NAME,
            storageKey: 'wms_inventory_pending_sync'
        });
        syncManager.init();
        window.syncManager = syncManager;
        
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        updateConnectionStatus();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

async function getUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
        });
        const profile = await response.json();
        STATE.userEmail = profile.email;
        STATE.userName = profile.name || profile.email.split('@')[0];
        
        // Cargar alias guardado
        const savedAlias = localStorage.getItem('wms_user_alias');
        STATE.userAlias = savedAlias || STATE.userName;
        
        updateUserDisplay();
        
        // Mostrar popup de alias si es primera vez
        if (!savedAlias) {
            setTimeout(() => showAliasPopup(), 1000);
        }
    } catch (e) {
        console.error('Error getting profile:', e);
        STATE.userName = 'Usuario';
        STATE.userAlias = 'Usuario';
    }
}

function handleLogout() {
    // Verificar datos sin sincronizar
    if (syncManager && syncManager.getPendingCount() > 0) {
        if (!confirm(`⚠️ Tienes ${syncManager.getPendingCount()} registros sin sincronizar. ¿Salir de todos modos?`)) {
            return;
        }
    }
    
    // Verificar cajas sin enviar
    const totalBoxes = STATE.pallets.ok.boxes.length + STATE.pallets.blocked.boxes.length + STATE.pallets.nowms.boxes.length;
    if (totalBoxes > 0) {
        if (!confirm(`⚠️ Tienes ${totalBoxes} cajas sin enviar. ¿Salir de todos modos?`)) {
            return;
        }
    }
    
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
    }
    
    if (syncManager) {
        syncManager.stopAutoSync();
    }
    
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    updateConnectionStatus();
}

async function loadInventory() {
    showLoading(true);
    try {
        const response = await fetch(CONFIG.INVENTORY_CSV_URL);
        const csvText = await response.text();
        const rows = csvText.split('\n').map(row => row.split(','));
        
        STATE.inventory.clear();
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const code = row[0]?.trim();
            if (code) {
                STATE.inventory.set(code, {
                    code: code,
                    sku: row[1] || '',
                    productName: row[2] || '',
                    cellNo: row[3] || '',
                    availableStock: parseInt(row[4]) || 0,
                    isBlocked: row[5] === 'BLOCKED',
                    isAvailable: parseInt(row[4]) > 0
                });
            }
        }

        updateBdInfo();
        showNotification('✅ Inventario cargado: ' + STATE.inventory.size + ' códigos', 'success');
    } catch (error) {
        console.error('Error loading inventory:', error);
        showNotification('❌ Error al cargar inventario', 'error');
    } finally {
        showLoading(false);
    }
}

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    const scanInput = document.getElementById('scan-input');
    const code2Input = document.getElementById('code2-input');
    
    scanInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && scanInput.value.trim()) {
            e.preventDefault();
            processScan(scanInput.value.trim());
            scanInput.value = '';
        }
    });
    
    code2Input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && code2Input.value.trim()) {
            e.preventDefault();
            processCode2(code2Input.value.trim());
            code2Input.value = '';
        }
    });

    ['ok', 'blocked', 'nowms'].forEach(cat => {
        const locationInput = document.getElementById(`location-${cat}`);
        if (locationInput) {
            locationInput.addEventListener('input', updateSendButtons);
        }
    });
}

// ==================== PROCESAMIENTO DE ESCANEO ====================
function processScan(rawCode) {
    // Búsqueda inteligente usando función compartida
    const result = findCodeInInventory(rawCode, STATE.inventory);
    const code = result.code;
    const item = result.item;
    
    // Verificar duplicados
    const duplicateInfo = findDuplicate(code);
    if (duplicateInfo) {
        showDuplicatePopup(code, duplicateInfo, rawCode);
        flashInput('warning');
        playSound('warning');
        return;
    }
    
    if (!item) {
        // No encontrado - mostrar Code2 input
        STATE.pendingCode1 = { raw: rawCode, code };
        showResultBox('error', code, 'NO ENCONTRADO', 'Código no encontrado en WMS. Ingresa Código 2 o usa INSERTADO.');
        document.getElementById('code2-container').style.display = 'block';
        flashInput('error');
        playSound('error');
        setTimeout(() => document.getElementById('code2-input').focus(), 100);
        return;
    }
    
    // Ocultar code2 container
    document.getElementById('code2-container').style.display = 'none';
    STATE.pendingCode1 = null;
    
    // Determinar estado y agregar a pallet apropiado
    if (item.isBlocked) {
        addBox('blocked', createBoxData(rawCode, code, '', item));
        showResultBox('blocked', code, 'BLOQUEADO', 'Inventario bloqueado');
        playSound('warning');
    } else if (item.isAvailable) {
        addBox('ok', createBoxData(rawCode, code, '', item));
        showResultBox('success', code, 'OK', 'Validado correctamente');
        playSound('success');
    } else {
        addBox('blocked', createBoxData(rawCode, code, '', item));
        showResultBox('blocked', code, 'SIN STOCK', 'Sin stock disponible');
        playSound('warning');
    }
    
    flashInput('success');
}

function processCode2(rawCode2) {
    if (!STATE.pendingCode1) return;
    
    // Búsqueda inteligente para Code2
    const result = findCodeInInventory(rawCode2, STATE.inventory);
    const code2 = result.code;
    const item = result.item;
    
    document.getElementById('code2-container').style.display = 'none';
    
    if (!item) {
        // Ambos códigos fallaron - agregar a No WMS con AMBOS códigos
        addBox('nowms', createBoxData(STATE.pendingCode1.raw, STATE.pendingCode1.code, rawCode2, null));
        showResultBox('error', STATE.pendingCode1.code, 'NO WMS', 
            `Ambos códigos no encontrados. Guardados: ${STATE.pendingCode1.code} y ${code2}`);
        playSound('error');
    } else if (item.isBlocked) {
        addBox('blocked', createBoxData(STATE.pendingCode1.raw, code2, rawCode2, item));
        showResultBox('blocked', code2, 'BLOQUEADO (Código 2)', 'Validado con Código 2 - Bloqueado');
        playSound('warning');
    } else {
        addBox('ok', createBoxData(STATE.pendingCode1.raw, code2, rawCode2, item));
        showResultBox('success', code2, 'OK (Código 2)', 'Validado correctamente con Código 2');
        playSound('success');
    }
    
    STATE.pendingCode1 = null;
    flashInput('success');
    document.getElementById('scan-input').focus();
}

function forceInsert() {
    if (!STATE.pendingCode1) {
        showNotification('⚠️ Primero escanea un código', 'warning');
        return;
    }
    
    const code2Value = document.getElementById('code2-input').value.trim();
    
    // Guardar AMBOS códigos
    addBox('nowms', createBoxData(
        STATE.pendingCode1.raw,
        STATE.pendingCode1.code,
        code2Value,
        null
    ));
    
    const msg = code2Value
        ? `Insertado con códigos: ${STATE.pendingCode1.code} y ${code2Value}`
        : `Insertado con código: ${STATE.pendingCode1.code}`;
    
    showResultBox('error', STATE.pendingCode1.code, 'INSERTADO (No WMS)', msg);
    
    document.getElementById('code2-container').style.display = 'none';
    document.getElementById('code2-input').value = '';
    STATE.pendingCode1 = null;
    
    playSound('warning');
    flashInput('warning');
    document.getElementById('scan-input').focus();
    showNotification('⚡ Registro insertado forzosamente', 'warning');
}

// ==================== DETECCIÓN DE DUPLICADOS ====================
function findDuplicate(code) {
    const categories = ['ok', 'blocked', 'nowms'];
    const categoryNames = { ok: 'OK', blocked: 'Bloqueado', nowms: 'No WMS' };
    
    for (const cat of categories) {
        const boxes = STATE.pallets[cat].boxes;
        const index = boxes.findIndex(b => b.code === code);
        if (index !== -1) {
            const box = boxes[index];
            return {
                category: cat,
                categoryName: categoryNames[cat],
                index,
                box,
                timestamp: box.timestamp,
                user: STATE.userName
            };
        }
    }
    return null;
}

function showDuplicatePopup(code, duplicateInfo, rawCode) {
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content duplicate-popup">
            <div class="popup-header">
                <span>⚠️ Código Duplicado</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <div class="duplicate-info">
                <div class="duplicate-info-row">
                    <span class="duplicate-info-label">Código:</span>
                    <span class="duplicate-info-value"><code>${code}</code></span>
                </div>
                <div class="duplicate-info-row">
                    <span class="duplicate-info-label">Ya registrado en:</span>
                    <span class="duplicate-info-value">${duplicateInfo.categoryName}</span>
                </div>
                <div class="duplicate-info-row">
                    <span class="duplicate-info-label">Hora de registro:</span>
                    <span class="duplicate-info-value">${duplicateInfo.timestamp}</span>
                </div>
                <div class="duplicate-info-row">
                    <span class="duplicate-info-label">Registrado por:</span>
                    <span class="duplicate-info-value">${duplicateInfo.user || 'Usuario'}</span>
                </div>
            </div>
            <p style="font-size: 0.9em; color: #666; margin-bottom: 15px;">
                Este código ya fue escaneado anteriormente. ¿Deseas forzar un nuevo registro?
            </p>
            <div class="popup-buttons">
                <button class="btn btn-warning btn-full" onclick="forceInsertDuplicate('${code}', '${rawCode}'); this.closest('.popup-overlay').remove();">
                    ⚡ Ingreso Forzado (Duplicado)
                </button>
                <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove();">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function forceInsertDuplicate(code, rawCode) {
    // Usar búsqueda inteligente para el duplicado también
    const result = findCodeInInventory(rawCode, STATE.inventory);
    const finalCode = result.code;
    const item = result.item;
    
    if (!item) {
        addBox('nowms', createBoxData(rawCode, finalCode, '', null));
        showNotification('⚡ Duplicado insertado en No WMS', 'warning');
    } else if (item.isBlocked) {
        addBox('blocked', createBoxData(rawCode, finalCode, '', item));
        showNotification('⚡ Duplicado insertado en Bloqueado', 'warning');
    } else {
        addBox('ok', createBoxData(rawCode, finalCode, '', item));
        showNotification('⚡ Duplicado insertado en OK', 'warning');
    }
    
    playSound('warning');
    document.getElementById('scan-input').focus();
}

function createBoxData(raw, code, scan2, item) {
    const cleanScan2 = scan2 ? normalizeCode(scan2) : '';
    return {
        raw,
        code,
        scan1: raw,
        scan2: cleanScan2,
        rawScan2: scan2 || '',
        location: item?.cellNo || '-',
        sku: item?.sku || '-',
        product: item?.productName || '-',
        timestamp: getTimestamp()
    };
}

function addBox(category, boxData) {
    STATE.pallets[category].boxes.push(boxData);
    
    // Actualizar resumen global
    STATE.globalSummary[category]++;
    STATE.globalSummary.total++;
    
    saveToStorage();
    updateUI();
    updateGlobalSummary();
}

function updateUI() {
    ['ok', 'blocked', 'nowms'].forEach(cat => {
        const boxes = STATE.pallets[cat].boxes;
        const list = document.getElementById(`${cat}-list`);
        const count = document.getElementById(`${cat}-count`);
        const palletId = document.getElementById(`${cat}-pallet`);
        
        count.textContent = boxes.length;
        palletId.textContent = STATE.pallets[cat].id;

        if (boxes.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div>Sin cajas</div></div>';
        } else {
            list.innerHTML = boxes.map((box, i) => `
                <div class="box-item ${cat}">
                    <div class="box-info">
                        <div class="box-code">${box.code}</div>
                        <div class="box-meta">${box.timestamp} • ${box.location}</div>
                    </div>
                    <button onclick="deleteBox('${cat}', ${i})" style="background: none; border: none; cursor: pointer; color: var(--error); font-size: 1.2em;">×</button>
                </div>
            `).join('');
        }
    });

    const totalBoxes = STATE.pallets.ok.boxes.length + STATE.pallets.blocked.boxes.length + STATE.pallets.nowms.boxes.length;
    document.getElementById('global-box-count').textContent = totalBoxes;
    
    updateSendButtons();
}

function deleteBox(category, index) {
    if (confirm('¿Eliminar esta caja?')) {
        STATE.pallets[category].boxes.splice(index, 1);
        saveToStorage();
        updateUI();
        showNotification('Caja eliminada', 'info');
    }
}

function updateSendButtons() {
    ['ok', 'blocked', 'nowms'].forEach(cat => {
        const btn = document.getElementById(`send-${cat}-btn`);
        const location = document.getElementById(`location-${cat}`).value.trim();
        const hasBoxes = STATE.pallets[cat].boxes.length > 0;
        btn.disabled = !(hasBoxes && location);
    });
}

// ==================== ENVÍO DE PALLETS ====================
async function sendPallet(category) {
    const pallet = STATE.pallets[category];
    const location = document.getElementById(`location-${category}`).value.trim();
    const originLocation = document.getElementById('origin-location').value.trim().toUpperCase();

    if (pallet.boxes.length === 0) {
        showNotification('⚠️ No hay cajas en esta tarima', 'warning');
        return;
    }

    if (!location) {
        showNotification('⚠️ Ingresa la ubicación destino', 'warning');
        document.getElementById(`location-${category}`).focus();
        return;
    }

    // Validar ubicación con doble confirmación
    const locationCheck = confirmInvalidLocation(location);
    if (!locationCheck.confirmed) {
        showNotification('❌ Envío cancelado - Verifica la ubicación', 'warning');
        document.getElementById(`location-${category}`).focus();
        return;
    }

    const finalLocation = locationCheck.formatted;
    document.getElementById(`location-${category}`).value = finalLocation;

    // Validación ciega si está activada
    if (pallet.blindCount) {
        const blindConfirmed = await confirmBlindCount(category, finalLocation);
        if (!blindConfirmed) {
            showNotification('❌ Envío cancelado', 'warning');
            return;
        }
    } else {
        if (!confirm(`¿Enviar ${pallet.boxes.length} cajas a ${finalLocation}?`)) {
            return;
        }
    }

    showLoading(true);
    try {
        const statusMap = { ok: 'OK', blocked: 'BLOQUEADO', nowms: 'NO WMS' };
        const now = new Date();
        const dateStr = getCurrentDate();
        const timeStr = getCurrentTime();

        // Crear registros para sincronización
        const records = pallet.boxes.map(box => ({
            date: dateStr,
            time: timeStr,
            user: STATE.userName || 'Usuario',
            scan1: box.code,
            scan2: box.scan2 || '',
            location: finalLocation,
            status: statusMap[category],
            note: '',
            pallet: pallet.id,
            originLocation: originLocation
        }));

        // Agregar a historial
        STATE.history = [...records, ...STATE.history].slice(0, 1000);

        // Agregar a cola de sincronización
        if (syncManager) {
            syncManager.addToQueue(records);
            showNotification(`💾 ${records.length} registros agregados a cola de sincronización`, 'info');
            
            // Intentar sincronizar inmediatamente
            if (checkOnlineStatus() && gapi?.client?.getToken()) {
                await syncManager.sync();
            }
        }

        // Resetear pallet
        STATE.pallets[category] = { boxes: [], id: generatePalletId(category.toUpperCase().slice(0, 3)) };
        document.getElementById(`location-${category}`).value = '';
        saveToStorage();
        updateUI();
        playSound('success');

    } catch (error) {
        console.error('Error sending pallet:', error);
        showNotification('❌ Error al procesar envío', 'error');
    } finally {
        showLoading(false);
    }
}

function showResultBox(type, code, title, message) {
    const box = document.getElementById('result-box');
    const icons = { success: '✅', warning: '⚠️', blocked: '⚠️', error: '❌' };
    
    box.className = `result-box show ${type}`;
    document.getElementById('result-icon').textContent = icons[type] || '📦';
    document.getElementById('result-title').textContent = `${title}: ${code}`;
    document.getElementById('result-details').textContent = message;
}

function flashInput(type) {
    const input = document.getElementById('scan-input');
    input.classList.remove('success', 'error');
    input.classList.add(type === 'success' ? 'success' : type === 'error' ? 'error' : '');
    setTimeout(() => input.classList.remove('success', 'error'), 500);
}

function showNotification(message, type = 'info') {
    const container = document.getElementById('notifications');
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    container.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

function showLoading(show) {
    document.getElementById('loading-overlay').classList.toggle('show', show);
}

function playSound(type) {
    const frequencies = { success: 800, warning: 600, error: 400 };
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = frequencies[type] || 500;
    oscillator.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
}

// ==================== FUNCIONES DE UI ====================
function updateConnectionStatus(isOnline) {
    const dot = document.getElementById('connection-dot');
    const text = document.getElementById('connection-text');
    
    if (isOnline === undefined) {
        isOnline = checkOnlineStatus();
    }
    
    if (isOnline) {
        dot?.classList.add('online');
        dot?.classList.remove('offline');
        if (text) text.textContent = 'Online';
    } else {
        dot?.classList.add('offline');
        dot?.classList.remove('online');
        if (text) text.textContent = 'Offline';
    }
}

function updateUserDisplay() {
    const avatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name-display');
    
    const displayName = STATE.userAlias || STATE.userName || 'Usuario';
    
    if (avatar) {
        avatar.textContent = displayName[0].toUpperCase();
        avatar.onclick = () => showAliasPopup();
        avatar.style.cursor = 'pointer';
        avatar.title = 'Click para cambiar nombre';
    }
    
    if (userName) {
        userName.textContent = displayName;
        userName.onclick = () => showAliasPopup();
        userName.style.cursor = 'pointer';
        userName.title = 'Click para cambiar nombre';
    }
}

function updateBdInfo() {
    const bdCount = document.getElementById('bd-count');
    const bdTime = document.getElementById('bd-update-time');
    
    if (bdCount) bdCount.textContent = STATE.inventory.size.toLocaleString();
    if (bdTime) bdTime.textContent = STATE.inventoryLastUpdate || getTimestamp();
}

// ==================== PERSISTENCIA ====================
function saveToStorage() {
    try {
        localStorage.setItem('wms_inventory_state', JSON.stringify({
            pallets: STATE.pallets,
            history: STATE.history.slice(0, 100),
            globalSummary: STATE.globalSummary,
            timestamp: Date.now()
        }));
    } catch (e) {
        console.error('Error saving to storage:', e);
    }
}

function loadFromStorage() {
    try {
        const saved = localStorage.getItem('wms_inventory_state');
        if (saved) {
            const data = JSON.parse(saved);
            STATE.pallets = data.pallets || STATE.pallets;
            STATE.history = data.history || [];
            STATE.globalSummary = data.globalSummary || STATE.globalSummary;
        }
    } catch (e) {
        console.error('Error loading from storage:', e);
    }
}

// ==================== FUNCIONES DE UTILIDAD ====================
function refreshInventory() {
    loadInventory();
}

function startNewSession() {
    if (confirm('¿Iniciar nueva sesión? Se mantendrán los datos actuales.')) {
        document.getElementById('scan-input').focus();
        showNotification('Nueva sesión iniciada', 'success');
    }
}

function showResumen() {
    const currentTotal = STATE.pallets.ok.boxes.length + STATE.pallets.blocked.boxes.length + STATE.pallets.nowms.boxes.length;
    const pending = syncManager ? syncManager.getPendingCount() : 0;
    const lastUpdate = STATE.inventoryLastUpdate || 'Sin actualizar';
    
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 500px;">
            <div class="popup-header">
                <span>📊 Resumen de Sesión</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <div style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 15px; color: var(--primary);">Sesión Actual</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                    <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--success);">${STATE.pallets.ok.boxes.length}</div>
                        <div style="font-size: 0.9em; color: #666;">✅ OK</div>
                    </div>
                    <div style="background: #fff3e0; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--warning);">${STATE.pallets.blocked.boxes.length}</div>
                        <div style="font-size: 0.9em; color: #666;">⚠️ Bloqueado</div>
                    </div>
                    <div style="background: #ffebee; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--error);">${STATE.pallets.nowms.boxes.length}</div>
                        <div style="font-size: 0.9em; color: #666;">❌ No WMS</div>
                    </div>
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; text-align: center;">
                        <div style="font-size: 2em; font-weight: 700; color: var(--info);">${currentTotal}</div>
                        <div style="font-size: 0.9em; color: #666;">📦 Total</div>
                    </div>
                </div>
                
                <h3 style="margin: 20px 0 15px; color: var(--primary);">Resumen Global</h3>
                <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; font-size: 0.9em;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span>Total procesado:</span>
                        <strong>${STATE.globalSummary.total.toLocaleString()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span>✅ OK procesados:</span>
                        <strong>${STATE.globalSummary.ok.toLocaleString()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span>⚠️ Bloqueados:</span>
                        <strong>${STATE.globalSummary.blocked.toLocaleString()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span>❌ No WMS:</span>
                        <strong>${STATE.globalSummary.nowms.toLocaleString()}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                        <span>📋 Envíos realizados:</span>
                        <strong>${STATE.history.length}</strong>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span>⏳ Pendientes sync:</span>
                        <strong style="color: ${pending > 0 ? 'var(--warning)' : 'var(--success)'}">${pending}</strong>
                    </div>
                </div>
                
                <div style="margin-top: 15px; padding: 10px; background: #f9f9f9; border-radius: 6px; font-size: 0.85em; color: #666;">
                    <div>👤 Usuario: <strong>${STATE.userAlias || STATE.userName}</strong></div>
                    <div>📅 BD actualizada: <strong>${lastUpdate}</strong></div>
                    <div>💾 Códigos en BD: <strong>${STATE.inventory.size.toLocaleString()}</strong></div>
                </div>
            </div>
            <div class="popup-buttons">
                <button class="btn btn-primary btn-full" onclick="this.closest('.popup-overlay').remove()">
                    Cerrar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function exportData() {
    if (STATE.history.length === 0) {
        showNotification('No hay datos para exportar', 'warning');
        return;
    }

    const headers = ['FECHA', 'HORA', 'RESPONSABLE', 'SCAN 1', 'SCAN 2', 'UBICACION DESTINO', 'ESTATUS', 'NOTA', 'PALLET', 'UBICACION FISICA ORIGEN'];
    const rows = STATE.history.map(r => [
        r.date, r.time, r.user, r.scan1, r.scan2, r.location, r.status, r.note, r.pallet, r.originLocation || ''
    ]);

    const csvContent = arrayToCSV([headers, ...rows]);
    downloadCSV(csvContent, `inventario_${getCurrentDate()}.csv`);
    showNotification('✅ Datos exportados', 'success');
}

// ==================== SISTEMA DE ALIAS/NICKNAME ====================
function showAliasPopup() {
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 400px;">
            <div class="popup-header">
                <span>👤 Personalizar Nombre</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <div style="margin-bottom: 20px;">
                <p style="color: #666; margin-bottom: 15px;">
                    Ingresa un nombre o alias para identificarte en los registros:
                </p>
                <input type="text" id="alias-input" class="scan-input" 
                       placeholder="Tu nombre o alias..." 
                       value="${STATE.userAlias || STATE.userName || ''}" 
                       autocomplete="off" 
                       style="width: 100%; margin-bottom: 10px;">
                <div style="font-size: 0.85em; color: #999;">
                    💡 Este nombre aparecerá en todos tus registros
                </div>
            </div>
            <div class="popup-buttons">
                <button class="btn btn-primary btn-full" onclick="saveUserAlias()">
                    💾 Guardar
                </button>
                <button class="btn btn-secondary btn-full" onclick="saveUserAlias('${STATE.userName}', true)">
                    Usar nombre de Google
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    setTimeout(() => {
        const input = document.getElementById('alias-input');
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveUserAlias();
            }
        });
    }, 100);
    
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function saveUserAlias(alias, isGoogleName = false) {
    const input = document.getElementById('alias-input');
    const finalAlias = alias || input?.value?.trim() || STATE.userName;
    
    if (!finalAlias) {
        showNotification('⚠️ Ingresa un nombre válido', 'warning');
        return;
    }
    
    STATE.userAlias = finalAlias;
    localStorage.setItem('wms_user_alias', finalAlias);
    
    document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
    updateUserDisplay();
    
    const msg = isGoogleName ? 'Usando nombre de Google' : `Nombre actualizado: ${finalAlias}`;
    showNotification(`✅ ${msg}`, 'success');
    playSound('success');
}

// ==================== RESUMEN GLOBAL EN SIDEBAR ====================
function updateGlobalSummary() {
    // Actualizar contador global en header
    const globalCount = document.getElementById('global-box-count');
    if (globalCount) {
        const total = STATE.pallets.ok.boxes.length + STATE.pallets.blocked.boxes.length + STATE.pallets.nowms.boxes.length;
        globalCount.textContent = total;
    }
}

// ==================== VALIDACIÓN CIEGA (BLIND COUNT) ====================
function toggleBlindCount(category) {
    const pallet = STATE.pallets[category];
    pallet.blindCount = !pallet.blindCount;
    
    const btn = document.getElementById(`send-${category}-btn`);
    if (btn) {
        if (pallet.blindCount) {
            btn.textContent = `🔒 Enviar Tarima ${category.toUpperCase()} (Ciega)`;
            btn.style.background = 'var(--warning)';
            showNotification(`⚠️ Modo ciego activado para ${category.toUpperCase()}`, 'warning');
        } else {
            btn.textContent = `📤 Enviar Tarima ${category.toUpperCase()}`;
            btn.style.background = '';
            showNotification(`✅ Modo normal activado para ${category.toUpperCase()}`, 'success');
        }
    }
}

function confirmBlindCount(category, location) {
    return new Promise((resolve) => {
        const pallet = STATE.pallets[category];
        const boxCount = pallet.boxes.length;
        
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show';
        overlay.innerHTML = `
            <div class="popup-content" style="max-width: 450px;">
                <div class="popup-header" style="background: var(--warning); color: white;">
                    <span>🔒 Validación Ciega</span>
                </div>
                <div style="margin-bottom: 20px;">
                    <p style="font-weight: 600; margin-bottom: 15px; color: var(--warning);">
                        ⚠️ MODO CIEGO ACTIVADO
                    </p>
                    <p style="margin-bottom: 15px; color: #666;">
                        Confirma el conteo físico de cajas en esta tarima:
                    </p>
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 8px;">Ubicación destino:</div>
                        <div style="font-size: 1.2em; font-weight: 700; margin-bottom: 15px;">${location}</div>
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 8px;">Cajas escaneadas en sistema:</div>
                        <div style="font-size: 2em; font-weight: 700; color: var(--primary);">${boxCount}</div>
                    </div>
                    <label style="display: block; margin-bottom: 10px; font-weight: 600;">
                        Ingresa el conteo físico real:
                    </label>
                    <input type="number" id="blind-count-input" class="scan-input" 
                           placeholder="Número de cajas contadas..." 
                           min="0" 
                           autocomplete="off" 
                           style="width: 100%; font-size: 1.5em; text-align: center;">
                </div>
                <div class="popup-buttons">
                    <button class="btn btn-primary btn-full" onclick="validateBlindCount(${boxCount})">
                        ✅ Confirmar Conteo
                    </button>
                    <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove(); window.blindCountResolve(false);">
                        Cancelar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        
        window.blindCountResolve = resolve;
        
        setTimeout(() => {
            const input = document.getElementById('blind-count-input');
            input.focus();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    validateBlindCount(boxCount);
                }
            });
        }, 100);
    });
}

function validateBlindCount(expectedCount) {
    const input = document.getElementById('blind-count-input');
    const physicalCount = parseInt(input.value);
    
    if (isNaN(physicalCount) || physicalCount < 0) {
        showNotification('⚠️ Ingresa un número válido', 'warning');
        input.focus();
        return;
    }
    
    const difference = Math.abs(physicalCount - expectedCount);
    
    if (physicalCount === expectedCount) {
        document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
        showNotification('✅ Conteo correcto - Coincide con sistema', 'success');
        playSound('success');
        window.blindCountResolve(true);
    } else {
        const confirmMsg = `⚠️ DISCREPANCIA DETECTADA\n\n` +
            `Sistema: ${expectedCount} cajas\n` +
            `Físico: ${physicalCount} cajas\n` +
            `Diferencia: ${difference} caja(s)\n\n` +
            `¿Deseas continuar de todos modos?`;
        
        if (confirm(confirmMsg)) {
            document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
            showNotification(`⚠️ Enviado con discrepancia: ${difference} caja(s)`, 'warning');
            playSound('warning');
            window.blindCountResolve(true);
        } else {
            input.focus();
            input.select();
        }
    }
}

// ==================== INICIALIZACIÓN AL CARGAR ====================
window.addEventListener('load', initializeApp);
