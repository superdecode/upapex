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
    pendingCode1: null,
    user: null,
    userEmail: '',
    userName: '',
    userAlias: '',
    history: [],
    globalSummary: { ok: 0, blocked: 0, nowms: 0, total: 0 }
};

// Variables globales
let tokenClient;
let gapiInited = false;
let gisInited = false;
let syncManager = null;

// ==================== GLOBAL TABS SYSTEM ====================
const GlobalTabs = {
    tabs: [],
    activeTabId: null,
    tabCounter: 0,

    init() {
        this.loadFromStorage();
        this.render();
        this.updateVisibility();
    },

    createTab(type = null) {
        // Límite máximo de 4 pestañas
        if (this.tabs.length >= 4) {
            showNotification('⚠️ Máximo 4 sesiones permitidas', 'warning');
            playSound('warning');
            return;
        }

        if (!type) {
            this.showWorkTypePopup();
            return;
        }

        const tabId = `tab-${Date.now()}-${++this.tabCounter}`;
        const tab = {
            id: tabId,
            type: type,
            name: type === 'classic' ? 'Clasificado' : 'Unificado',
            createdAt: new Date().toISOString(),
            data: type === 'classic' ? {
                pallets: {
                    ok: { boxes: [], id: generatePalletId('OK') },
                    blocked: { boxes: [], id: generatePalletId('BLK') },
                    nowms: { boxes: [], id: generatePalletId('NWS') }
                },
                originLocation: ''
            } : {
                items: [],
                originLocation: '',
                destLocation: ''
            }
        };

        this.tabs.push(tab);
        this.setActiveTab(tabId);
        this.saveToStorage();
        this.render();
        showNotification(`Nueva sesión ${tab.name} creada`, 'success');
        playSound('success');
    },

    setActiveTab(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        this.activeTabId = tabId;

        // Save current tab data before switching
        this.saveCurrentTabData();

        // Load new tab data
        if (tab.type === 'classic') {
            STATE.pallets = JSON.parse(JSON.stringify(tab.data.pallets));
            const originInput = document.getElementById('origin-location');
            if (originInput) originInput.value = tab.data.originLocation || '';
        } else {
            UnifiedModule.items = tab.data.items || [];
            const originInput = document.getElementById('unified-origin-location');
            const destInput = document.getElementById('unified-dest-location');
            if (originInput) originInput.value = tab.data.originLocation || '';
            if (destInput) destInput.value = tab.data.destLocation || '';
        }

        this.updateVisibility();
        this.render();
        this.saveToStorage();

        // Update UI
        if (tab.type === 'classic') {
            updateUI();
            setTimeout(() => document.getElementById('scan-input')?.focus(), 100);
        } else {
            UnifiedModule.updateUI();
            setTimeout(() => document.getElementById('unified-scan-input')?.focus(), 100);
        }
    },

    saveCurrentTabData() {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (!tab) return;

        if (tab.type === 'classic') {
            tab.data.pallets = JSON.parse(JSON.stringify(STATE.pallets));
            tab.data.originLocation = document.getElementById('origin-location')?.value || '';
        } else {
            tab.data.items = [...UnifiedModule.items];
            tab.data.originLocation = document.getElementById('unified-origin-location')?.value || '';
            tab.data.destLocation = document.getElementById('unified-dest-location')?.value || '';
        }
    },

    closeTab(tabId, event) {
        if (event) event.stopPropagation();

        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return;

        const itemCount = tab.type === 'classic'
            ? (tab.data.pallets.ok.boxes.length + tab.data.pallets.blocked.boxes.length + tab.data.pallets.nowms.boxes.length)
            : tab.data.items.length;

        if (itemCount > 0) {
            if (!confirm(`Esta sesión tiene ${itemCount} registros. ¿Cerrar de todos modos?`)) {
                return;
            }
        }

        const index = this.tabs.findIndex(t => t.id === tabId);
        this.tabs.splice(index, 1);

        if (this.activeTabId === tabId) {
            if (this.tabs.length > 0) {
                this.setActiveTab(this.tabs[Math.max(0, index - 1)].id);
            } else {
                this.activeTabId = null;
            }
        }

        this.updateVisibility();
        this.render();
        this.saveToStorage();
        showNotification('Sesión cerrada', 'info');
    },

    updateVisibility() {
        const welcomeState = document.getElementById('welcome-state');
        const classicModule = document.getElementById('classic-module');
        const unifiedModule = document.getElementById('unified-module');
        const tabsHeader = document.getElementById('tabs-header');

        if (this.tabs.length === 0) {
            welcomeState?.classList.remove('module-hidden');
            welcomeState?.classList.add('module-visible');
            classicModule?.classList.remove('module-visible');
            classicModule?.classList.add('module-hidden');
            unifiedModule?.classList.remove('module-visible');
            unifiedModule?.classList.add('module-hidden');
            if (tabsHeader) tabsHeader.style.display = 'none';
        } else {
            welcomeState?.classList.remove('module-visible');
            welcomeState?.classList.add('module-hidden');
            if (tabsHeader) tabsHeader.style.display = 'flex';

            const activeTab = this.tabs.find(t => t.id === this.activeTabId);
            if (activeTab?.type === 'classic') {
                classicModule?.classList.remove('module-hidden');
                classicModule?.classList.add('module-visible');
                unifiedModule?.classList.remove('module-visible');
                unifiedModule?.classList.add('module-hidden');
            } else if (activeTab?.type === 'unified') {
                unifiedModule?.classList.remove('module-hidden');
                unifiedModule?.classList.add('module-visible');
                classicModule?.classList.remove('module-visible');
                classicModule?.classList.add('module-hidden');
            }
        }
    },

    render() {
        const tabBar = document.getElementById('tab-bar');
        if (!tabBar) return;

        tabBar.innerHTML = this.tabs.map(tab => {
            const itemCount = tab.type === 'classic'
                ? (tab.data.pallets.ok.boxes.length + tab.data.pallets.blocked.boxes.length + tab.data.pallets.nowms.boxes.length)
                : tab.data.items.length;

            const icon = tab.type === 'classic' ? '📋' : '📦';
            const isActive = tab.id === this.activeTabId;
            const typeClass = tab.type === 'classic' ? 'classic' : 'unified';

            return `
                <div class="tab ${typeClass} ${isActive ? 'active' : ''}" onclick="GlobalTabs.setActiveTab('${tab.id}')">
                    <span class="tab-icon">${icon}</span>
                    <span class="tab-name">${tab.name}</span>
                    ${itemCount > 0 ? `<span class="tab-badge">${itemCount}</span>` : ''}
                    <button class="tab-close" onclick="GlobalTabs.closeTab('${tab.id}', event)">×</button>
                </div>
            `;
        }).join('') + `
            <button class="tab-add" onclick="GlobalTabs.createTab()" title="Nueva pestaña">+</button>
        `;
    },

    showWorkTypePopup() {
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show';
        overlay.innerHTML = `
            <div class="popup-content work-type-popup">
                <button class="popup-close-corner" onclick="this.closest('.popup-overlay').remove()">×</button>
                <div class="popup-header-centered">
                    <span class="popup-header-icon">📋</span>
                    <h2>Seleccionar Tipo de Trabajo</h2>
                </div>
                <div class="work-type-options">
                    <div class="work-type-option" onclick="GlobalTabs.selectWorkType('classic', this)">
                        <span class="work-type-icon">📋</span>
                        <div class="work-type-title">Clasificado</div>
                        <div class="work-type-desc">Separar por OK, Bloqueado y No WMS</div>
                    </div>
                    <div class="work-type-option" onclick="GlobalTabs.selectWorkType('unified', this)">
                        <span class="work-type-icon">📦</span>
                        <div class="work-type-title">Unificado</div>
                        <div class="work-type-desc">Registro directo sin clasificación</div>
                    </div>
                </div>
                <div class="popup-buttons">
                    <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove()">
                        Cancelar
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    selectWorkType(type, element) {
        document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
        this.createTab(type);
    },

    getTabCount(tabId) {
        const tab = this.tabs.find(t => t.id === tabId);
        if (!tab) return 0;

        if (tab.type === 'classic') {
            return tab.data.pallets.ok.boxes.length +
                   tab.data.pallets.blocked.boxes.length +
                   tab.data.pallets.nowms.boxes.length;
        }
        return tab.data.items.length;
    },

    saveToStorage() {
        try {
            this.saveCurrentTabData();
            localStorage.setItem('wms_global_tabs', JSON.stringify({
                tabs: this.tabs,
                activeTabId: this.activeTabId,
                tabCounter: this.tabCounter
            }));
        } catch (e) {
            console.error('Error saving tabs:', e);
        }
    },

    loadFromStorage() {
        try {
            const saved = localStorage.getItem('wms_global_tabs');
            if (saved) {
                const data = JSON.parse(saved);
                this.tabs = data.tabs || [];
                this.activeTabId = data.activeTabId;
                this.tabCounter = data.tabCounter || 0;
            }
        } catch (e) {
            console.error('Error loading tabs:', e);
            this.tabs = [];
        }
    }
};

// ==================== UNIFIED MODULE ====================
const UnifiedModule = {
    items: [],
    canceladosMode: false,

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        const scanInput = document.getElementById('unified-scan-input');
        if (scanInput) {
            scanInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && scanInput.value.trim()) {
                    e.preventDefault();
                    this.processScan(scanInput.value.trim());
                    scanInput.value = '';
                }
            });
        }
    },

    processScan(rawCode) {
        const result = findCodeInInventory(rawCode, STATE.inventory);
        const code = result.code;
        const item = result.item;

        // Check duplicates
        const dupIndex = this.items.findIndex(i => i.code === code);
        if (dupIndex !== -1) {
            if (!confirm(`Código ${code} ya registrado. ¿Agregar duplicado?`)) {
                return;
            }
        }

        let status = 'nowms';
        let statusText = 'NO WMS';

        if (item) {
            if (item.isBlocked) {
                status = 'blocked';
                statusText = 'BLOQUEADO';
            } else if (item.isAvailable) {
                status = 'ok';
                statusText = 'OK';
            } else {
                status = 'blocked';
                statusText = 'SIN STOCK';
            }
        }

        const newItem = {
            raw: rawCode,
            code: code,
            status: status,
            statusText: statusText,
            sku: item?.sku || '-',
            product: item?.productName || '-',
            location: item?.cellNo || '-',
            timestamp: getTimestamp()
        };

        this.items.push(newItem);
        this.updateUI();
        this.showResult(status, code, statusText);
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();

        playSound(status === 'ok' ? 'success' : status === 'blocked' ? 'warning' : 'error');
    },

    showResult(type, code, title) {
        const box = document.getElementById('unified-result-box');
        const icons = { ok: '✅', blocked: '⚠️', nowms: '❌' };

        box.className = `result-box show ${type === 'ok' ? 'success' : type === 'blocked' ? 'warning' : 'error'}`;
        document.getElementById('unified-result-icon').textContent = icons[type] || '📦';
        document.getElementById('unified-result-title').textContent = `${title}: ${code}`;
    },

    updateUI() {
        const list = document.getElementById('unified-list');
        const countEl = document.getElementById('unified-box-count');
        const sendBtn = document.getElementById('unified-send-btn');

        if (countEl) countEl.textContent = this.items.length;
        if (sendBtn) sendBtn.disabled = this.items.length === 0;

        if (!list) return;

        if (this.items.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div>Sin registros</div></div>';
            return;
        }

        list.innerHTML = this.items.map((item, i) => `
            <div class="unified-item ${item.status}">
                <div class="unified-item-info">
                    <div class="unified-item-code">${item.code}</div>
                    <div class="unified-item-meta">
                        <span>${item.timestamp}</span>
                        <span>${item.location}</span>
                    </div>
                </div>
                <span class="unified-item-status ${item.status}">${item.statusText}</span>
                <button class="unified-item-delete" onclick="UnifiedModule.deleteItem(${i})">×</button>
            </div>
        `).join('');
    },

    deleteItem(index) {
        if (confirm('¿Eliminar este registro?')) {
            this.items.splice(index, 1);
            this.updateUI();
            GlobalTabs.saveToStorage();
            updateGlobalSummaryFromTabs();
            showNotification('Registro eliminado', 'info');
        }
    },

    clearList() {
        if (this.items.length === 0) return;
        if (confirm(`¿Limpiar ${this.items.length} registros?`)) {
            this.items = [];
            this.updateUI();
            GlobalTabs.saveToStorage();
            updateGlobalSummaryFromTabs();
            showNotification('Lista limpiada', 'info');
        }
    },

    toggleCancelados(isChecked) {
        this.canceladosMode = isChecked;
        const toggleLabel = document.getElementById('cancelados-toggle-label');
        if (toggleLabel) {
            if (isChecked) {
                toggleLabel.classList.add('active');
                showNotification('🚫 Modo CANCELADOS activado', 'warning');
            } else {
                toggleLabel.classList.remove('active');
                showNotification('✅ Modo normal activado', 'success');
            }
        }
        this.updateUI();
        GlobalTabs.saveToStorage();
    },

    isCancelados() {
        return this.canceladosMode || false;
    },

    async sendAll() {
        const originLocation = document.getElementById('unified-origin-location')?.value.trim().toUpperCase() || '';
        const destLocation = document.getElementById('unified-dest-location')?.value.trim().toUpperCase() || '';

        if (!destLocation) {
            showNotification('⚠️ Ingresa la ubicación destino', 'warning');
            document.getElementById('unified-dest-location')?.focus();
            return;
        }

        const locationCheck = confirmInvalidLocation(destLocation);
        if (!locationCheck.confirmed) {
            showNotification('❌ Envío cancelado - Verifica la ubicación', 'warning');
            return;
        }

        const isCancelados = this.isCancelados();
        const modeText = isCancelados ? ' como CANCELADOS' : '';

        if (!confirm(`¿Enviar ${this.items.length} registros a ${locationCheck.formatted}${modeText}?`)) {
            return;
        }

        showLoading(true);
        try {
            const dateStr = getCurrentDate();
            const timeStr = getCurrentTime();
            const palletId = generatePalletId('UNI');

            const statusMap = { ok: 'OK', blocked: 'BLOQUEADO', nowms: 'NO WMS' };

            const records = this.items.map(item => {
                const finalStatus = isCancelados ? 'CANCELADO' : statusMap[item.status];
                const note = isCancelados ? `Original: ${statusMap[item.status]}` : 'UNIFICADO';

                return {
                    date: dateStr,
                    time: timeStr,
                    user: STATE.userAlias || STATE.userName || 'Usuario',
                    scan1: item.code,
                    scan2: '',
                    location: locationCheck.formatted,
                    status: finalStatus,
                    note: note,
                    pallet: palletId,
                    originLocation: originLocation
                };
            });

            STATE.history = [...records, ...STATE.history].slice(0, 1000);

            if (syncManager) {
                syncManager.addToQueue(records);
                if (checkOnlineStatus() && gapi?.client?.getToken()) {
                    await syncManager.sync();
                }
            }

            const count = this.items.length;
            this.items = [];
            this.updateUI();
            GlobalTabs.saveToStorage();
            updateGlobalSummaryFromTabs();

            showNotification(`✅ ${count} registros enviados${modeText}`, 'success');
            playSound('success');
        } catch (error) {
            console.error('Error sending unified:', error);
            showNotification('❌ Error al enviar', 'error');
        } finally {
            showLoading(false);
        }
    }
};

// ==================== INICIALIZACIÓN ====================
function initializeApp() {
    initAudio();
    gapiLoaded();
    gisLoaded();
    setupEventListeners();
    setupConnectionMonitor(updateConnectionStatus);
    loadFromStorage();
    GlobalTabs.init();
    UnifiedModule.init();
    updateUI();
    
    // Inicializar sistema de avatar
    if (window.AvatarSystem) {
        window.AvatarSystem.init();
        window.AvatarSystem.createActions();
    }
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

        syncManager = new SyncManager({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            sheetName: CONFIG.SHEET_NAME,
            storageKey: 'wms_inventory_pending_sync'
        });
        syncManager.init();
        window.syncManager = syncManager;

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        GlobalTabs.updateVisibility();
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
        
        // Integrar con sistema de avatar
        if (window.AvatarSystem) {
            const savedName = window.AvatarSystem.getUserName();
            STATE.userAlias = savedName || STATE.userName;
            
            if (!savedName) {
                window.AvatarSystem.setUserName(STATE.userName);
            }
            window.AvatarSystem.setUserEmail(STATE.userEmail);
            
            // Guardar conexión de Google
            const token = gapi.client.getToken();
            if (token && token.access_token) {
                window.AvatarSystem.saveGoogleConnection(token.access_token, token.expires_in || 3600);
            }
        } else {
            // Fallback si no está disponible el sistema de avatar
            const savedAlias = localStorage.getItem('wms_user_alias');
            STATE.userAlias = savedAlias || STATE.userName;
        }
        
        updateUserDisplay();
        
        // Mostrar popup de alias si es primera vez
        if (!STATE.userAlias || STATE.userAlias === 'Usuario') {
            setTimeout(() => {
                if (window.AvatarSystem) {
                    window.AvatarSystem.showNamePopup();
                } else {
                    showAliasPopup();
                }
            }, 1000);
        }
    } catch (e) {
        console.error('Error getting profile:', e);
        STATE.userName = 'Usuario';
        STATE.userAlias = 'Usuario';
    }
}

function handleLogout() {
    if (syncManager && syncManager.getPendingCount() > 0) {
        if (!confirm(`⚠️ Tienes ${syncManager.getPendingCount()} registros sin sincronizar. ¿Salir de todos modos?`)) {
            return;
        }
    }

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

        STATE.inventoryLastUpdate = getTimestamp();
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

    if (scanInput) {
        scanInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && scanInput.value.trim()) {
                e.preventDefault();
                processScan(scanInput.value.trim());
                scanInput.value = '';
            }
        });
    }

    if (code2Input) {
        code2Input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && code2Input.value.trim()) {
                e.preventDefault();
                processCode2(code2Input.value.trim());
                code2Input.value = '';
            }
        });
    }

    ['ok', 'blocked', 'nowms'].forEach(cat => {
        const locationInput = document.getElementById(`location-${cat}`);
        if (locationInput) {
            locationInput.addEventListener('input', updateSendButtons);
        }
    });
}

// ==================== PROCESAMIENTO DE ESCANEO ====================
function processScan(rawCode) {
    const result = findCodeInInventory(rawCode, STATE.inventory);
    const code = result.code;
    const item = result.item;

    const duplicateInfo = findDuplicate(code);
    if (duplicateInfo) {
        showDuplicatePopup(code, duplicateInfo, rawCode);
        flashInput('warning');
        playSound('warning');
        return;
    }

    if (!item) {
        STATE.pendingCode1 = { raw: rawCode, code };
        showResultBox('error', code, 'NO ENCONTRADO', 'Código no encontrado en WMS. Ingresa Código 2 o usa Insertar.');
        showCode2Inline(true);
        flashInput('error');
        playSound('error');
        setTimeout(() => document.getElementById('code2-input')?.focus(), 100);
        return;
    }

    hideCode2Inline();
    STATE.pendingCode1 = null;

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

function showCode2Inline(show) {
    const code2Inline = document.getElementById('code2-inline');
    const btnInsertar = document.getElementById('btn-insertar');
    if (code2Inline) code2Inline.style.display = show ? 'block' : 'none';
    if (btnInsertar) btnInsertar.style.display = show ? 'block' : 'none';
}

function hideCode2Inline() {
    showCode2Inline(false);
    const code2Input = document.getElementById('code2-input');
    if (code2Input) code2Input.value = '';
}

function processCode2(rawCode2) {
    if (!STATE.pendingCode1) return;

    const result = findCodeInInventory(rawCode2, STATE.inventory);
    const code2 = result.code;
    const item = result.item;

    hideCode2Inline();

    if (!item) {
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
    document.getElementById('scan-input')?.focus();
}

function forceInsert() {
    if (!STATE.pendingCode1) {
        showNotification('⚠️ Primero escanea un código', 'warning');
        return;
    }

    const code2Value = document.getElementById('code2-input')?.value.trim() || '';

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

    hideCode2Inline();
    STATE.pendingCode1 = null;

    playSound('warning');
    flashInput('warning');
    document.getElementById('scan-input')?.focus();
    showNotification('⚡ Registro insertado forzosamente', 'warning');
}

// ==================== DETECCIÓN DE DUPLICADOS ====================
function findDuplicate(code) {
    const categories = ['ok', 'blocked', 'nowms'];
    const categoryNames = { ok: 'OK', blocked: 'Bloqueado', nowms: 'No WMS' };

    for (const cat of categories) {
        const boxes = STATE.pallets[cat].boxes;
        // Buscar en código principal (code)
        let index = boxes.findIndex(b => b.code === code);
        if (index !== -1) {
            const box = boxes[index];
            return {
                category: cat,
                categoryName: categoryNames[cat],
                index,
                box,
                timestamp: box.timestamp,
                user: STATE.userName,
                matchType: 'code'
            };
        }
        
        // VALIDACIÓN CRUZADA: Buscar en scan2 también
        index = boxes.findIndex(b => b.scan2 && b.scan2 === code);
        if (index !== -1) {
            const box = boxes[index];
            return {
                category: cat,
                categoryName: categoryNames[cat],
                index,
                box,
                timestamp: box.timestamp,
                user: STATE.userName,
                matchType: 'scan2',
                message: `Este código ya fue usado como Código 2 en otro registro (Código 1: ${box.code})`
            };
        }
    }
    return null;
}

function showDuplicatePopup(code, duplicateInfo, rawCode) {
    const matchTypeMsg = duplicateInfo.matchType === 'scan2' 
        ? `<div style="background: #fff3e0; padding: 10px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid var(--warning);">
               <strong>⚠️ Validación Cruzada:</strong><br>
               ${duplicateInfo.message}
           </div>`
        : '';
    
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content duplicate-popup">
            <div class="popup-header">
                <span>⚠️ Código Duplicado</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <div style="padding: 20px;">
                ${matchTypeMsg}
                <div class="duplicate-info" style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="display: grid; gap: 10px;">
                        <div>
                            <span style="color: #666; font-size: 0.85em;">Código:</span><br>
                            <code style="font-size: 1.1em; font-weight: 600;">${code}</code>
                        </div>
                        <div>
                            <span style="color: #666; font-size: 0.85em;">Ya registrado en:</span><br>
                            <strong>${duplicateInfo.categoryName}</strong>
                        </div>
                        <div>
                            <span style="color: #666; font-size: 0.85em;">Hora de registro:</span><br>
                            <strong>${duplicateInfo.timestamp}</strong>
                        </div>
                        <div>
                            <span style="color: #666; font-size: 0.85em;">Registrado por:</span><br>
                            <strong>${duplicateInfo.user || 'Usuario'}</strong>
                        </div>
                    </div>
                </div>
                <p style="font-size: 0.9em; color: #666; margin-bottom: 15px;">
                    Este código ya fue escaneado anteriormente. ¿Deseas forzar un nuevo registro?
                </p>
                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button class="btn btn-warning" onclick="forceInsertDuplicate('${code}', '${rawCode}'); this.closest('.popup-overlay').remove();" style="width: 100%;">
                        ⚡ Ingreso Forzado (Duplicado)
                    </button>
                    <button class="btn btn-secondary" onclick="this.closest('.popup-overlay').remove();" style="width: 100%;">
                        Cancelar
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function forceInsertDuplicate(code, rawCode) {
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
    document.getElementById('scan-input')?.focus();
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
        timestamp: getTimestamp(),
        verified: false
    };
}

function addBox(category, boxData) {
    STATE.pallets[category].boxes.push(boxData);
    STATE.globalSummary[category]++;
    STATE.globalSummary.total++;

    saveToStorage();
    updateUI();
    GlobalTabs.saveToStorage();
    updateGlobalSummaryFromTabs();
}

function updateUI() {
    ['ok', 'blocked', 'nowms'].forEach(cat => {
        const boxes = STATE.pallets[cat].boxes;
        const list = document.getElementById(`${cat}-list`);
        const count = document.getElementById(`${cat}-count`);
        const palletId = document.getElementById(`${cat}-pallet`);

        if (count) count.textContent = boxes.length;
        if (palletId) palletId.textContent = STATE.pallets[cat].id;

        if (list) {
            if (boxes.length === 0) {
                list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div>Sin cajas</div></div>';
            } else {
                list.innerHTML = boxes.map((box, i) => {
                    const verifiedClass = box.verified ? 'verified' : '';
                    const checkIcon = cat === 'ok' ? (box.verified ? '✓' : '○') : '';

                    return `
                    <div class="box-item ${cat} ${verifiedClass}">
                        <div class="box-info">
                            <div class="box-code">${box.code}${box.scan2 ? ' / ' + box.scan2 : ''}</div>
                            <div class="box-meta">${box.timestamp} • ${box.location}</div>
                        </div>
                        <div class="box-actions">
                            ${cat === 'ok' ? `<button class="box-action-btn check" onclick="toggleBoxVerified('ok', ${i})" title="Marcar verificado">${checkIcon}</button>` : ''}
                            <button class="box-action-btn copy" onclick="copyToClipboard('${box.code}')" title="Copiar">⧉</button>
                            <button class="box-action-btn move" onclick="showMoveBoxPopup('${cat}', ${i})" title="Mover">⇄</button>
                            <button class="box-action-btn delete" onclick="deleteBox('${cat}', ${i})" title="Eliminar">×</button>
                        </div>
                    </div>
                `}).join('');
            }
        }
    });

    const totalBoxes = STATE.pallets.ok.boxes.length + STATE.pallets.blocked.boxes.length + STATE.pallets.nowms.boxes.length;
    const globalCount = document.getElementById('global-box-count');
    if (globalCount) globalCount.textContent = totalBoxes;

    updateSendButtons();
    updateVerificationBadges();
    GlobalTabs.render();
}

function deleteBox(category, index) {
    if (confirm('¿Eliminar esta caja?')) {
        STATE.pallets[category].boxes.splice(index, 1);
        saveToStorage();
        updateUI();
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();
        showNotification('Caja eliminada', 'info');
    }
}

function updateSendButtons() {
    ['ok', 'blocked', 'nowms'].forEach(cat => {
        const btn = document.getElementById(`send-${cat}-btn`);
        const locationInput = document.getElementById(`location-${cat}`);
        if (btn && locationInput) {
            const location = locationInput.value.trim();
            const hasBoxes = STATE.pallets[cat].boxes.length > 0;
            btn.disabled = !(hasBoxes && location);
        }
    });
}

// ==================== ENVÍO DE PALLETS CON VALIDACIÓN DE CANTIDAD ====================
async function sendPallet(category) {
    const pallet = STATE.pallets[category];
    const location = document.getElementById(`location-${category}`).value.trim();
    const originLocation = document.getElementById('origin-location')?.value.trim().toUpperCase() || '';

    if (pallet.boxes.length === 0) {
        showNotification('⚠️ No hay cajas en esta tarima', 'warning');
        return;
    }

    if (!location) {
        showNotification('⚠️ Ingresa la ubicación destino', 'warning');
        document.getElementById(`location-${category}`)?.focus();
        return;
    }

    // Validar ubicación usando función de wms-utils
    const validation = validateAndNormalizeLocation(location);
    
    let finalLocation = location.toUpperCase();
    
    if (!validation.valid) {
        // Permitir ubicación inválida con confirmación
        const forceInsert = confirm(`⚠️ Ubicación con formato inválido: ${location}\n\n${validation.message || 'Formato incorrecto'}\n\n¿Deseas insertar de todas formas?`);
        if (!forceInsert) {
            document.getElementById(`location-${category}`).focus();
            return;
        }
        // Usar la ubicación tal como está
        finalLocation = location.toUpperCase();
        showNotification('⚠️ Ubicación insertada sin validar', 'warning');
    } else {
        // Si necesita corrección, mostrar confirmación
        if (validation.needsCorrection) {
            if (!confirm(`La ubicación será corregida a: ${validation.normalized}\n\n¿Continuar?`)) {
                document.getElementById(`location-${category}`).focus();
                return;
            }
        }
        finalLocation = validation.normalized;
        document.getElementById(`location-${category}`).value = finalLocation;
    }

    // Mostrar modal de validación de cantidad
    showCountValidationModal(category, pallet.boxes.length, finalLocation, originLocation);
}

function showCountValidationModal(category, actualCount, finalLocation, originLocation) {
    const categoryNames = { ok: 'OK ✅', blocked: 'Bloqueado ⚠️', nowms: 'No WMS ❌' };

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.id = 'count-validation-modal';
    overlay.innerHTML = `
        <div class="popup-content count-validation-popup">
            <button class="popup-close-corner" onclick="this.closest('.popup-overlay').remove()">×</button>
            <div class="popup-header-centered">
                <span class="popup-header-icon">📦</span>
                <h2>Validación de Cantidad</h2>
            </div>
            <div class="validation-info">
                <p>Tarima <strong>${categoryNames[category]}</strong></p>
                <p>Destino: <strong>${finalLocation}</strong></p>
            </div>
            <div class="validation-input-group">
                <label>¿Cuántas cajas hay en la tarima?</label>
                <input type="number" id="count-validation-input" class="count-input"
                       placeholder="Ingresa cantidad" min="1" autocomplete="off">
                <div class="count-blur-display" id="count-blur-display">
                    <span class="blur-number">???</span>
                    <span class="blur-label">cajas registradas</span>
                </div>
            </div>
            <div class="popup-buttons">
                <button class="btn btn-primary btn-full" onclick="validateAndSendPallet('${category}', ${actualCount}, '${finalLocation}', '${originLocation}')">
                    ✅ Validar y Enviar
                </button>
                <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove()">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    setTimeout(() => {
        const input = document.getElementById('count-validation-input');
        if (input) {
            input.focus();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    validateAndSendPallet(category, actualCount, finalLocation, originLocation);
                }
            });
        }
    }, 100);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

async function validateAndSendPallet(category, actualCount, finalLocation, originLocation) {
    const input = document.getElementById('count-validation-input');
    const enteredCount = parseInt(input?.value) || 0;

    if (enteredCount <= 0) {
        showNotification('⚠️ Ingresa una cantidad válida', 'warning');
        input?.focus();
        return;
    }

    // Cerrar modal de validación
    document.getElementById('count-validation-modal')?.remove();

    // Verificar si coincide
    if (enteredCount !== actualCount) {
        const diff = actualCount - enteredCount;
        const message = diff > 0
            ? `⚠️ Diferencia detectada: Faltan ${diff} cajas según el sistema`
            : `⚠️ Diferencia detectada: Hay ${Math.abs(diff)} cajas de más según el sistema`;

        if (!confirm(`${message}\n\nRegistradas: ${actualCount}\nIngresadas: ${enteredCount}\n\n¿Enviar de todos modos?`)) {
            showNotification('❌ Envío cancelado - Verificar conteo', 'warning');
            return;
        }
    }

    // Proceder con el envío
    await executeSendPallet(category, finalLocation, originLocation);
}

async function executeSendPallet(category, finalLocation, originLocation) {
    const pallet = STATE.pallets[category];

    showLoading(true);
    try {
        const statusMap = { ok: 'OK', blocked: 'BLOQUEADO', nowms: 'NO WMS' };
        const dateStr = getCurrentDate();
        const timeStr = getCurrentTime();

        const records = pallet.boxes.map(box => ({
            date: dateStr,
            time: timeStr,
            user: STATE.userAlias || STATE.userName || 'Usuario',
            scan1: box.code,
            scan2: box.scan2 || '',
            location: finalLocation,
            status: statusMap[category],
            note: '',
            pallet: pallet.id,
            originLocation: originLocation
        }));

        STATE.history = [...records, ...STATE.history].slice(0, 1000);

        if (syncManager) {
            syncManager.addToQueue(records);
            showNotification(`💾 ${records.length} registros agregados a cola`, 'info');

            if (checkOnlineStatus() && gapi?.client?.getToken()) {
                await syncManager.sync();
            }
        }

        STATE.pallets[category] = { boxes: [], id: generatePalletId(category.toUpperCase().slice(0, 3)) };
        document.getElementById(`location-${category}`).value = '';
        saveToStorage();
        updateUI();
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();
        playSound('success');
        showNotification(`✅ Tarima ${statusMap[category]} enviada correctamente`, 'success');

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

    if (box) {
        box.className = `result-box show ${type}`;
        document.getElementById('result-icon').textContent = icons[type] || '📦';
        document.getElementById('result-title').textContent = `${title}: ${code}`;
        document.getElementById('result-details').textContent = message;
    }
}

function flashInput(type) {
    const input = document.getElementById('scan-input');
    if (input) {
        input.classList.remove('success', 'error');
        input.classList.add(type === 'success' ? 'success' : type === 'error' ? 'error' : '');
        setTimeout(() => input.classList.remove('success', 'error'), 500);
    }
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.toggle('show', show);
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
    // Usar sistema de avatar si está disponible
    if (window.AvatarSystem) {
        window.AvatarSystem.updateDisplay();
        return;
    }
    
    // Fallback
    const avatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name-display');

    const displayName = STATE.userAlias || STATE.userName || 'Usuario';

    if (avatar) {
        avatar.textContent = displayName[0].toUpperCase();
        avatar.onclick = () => showAliasPopup();
        avatar.style.cursor = 'pointer';
    }

    if (userName) {
        userName.textContent = displayName;
        userName.onclick = () => showAliasPopup();
        userName.style.cursor = 'pointer';
    }
}

function updateBdInfo() {
    const bdCount = document.getElementById('bd-count');
    const bdTime = document.getElementById('bd-update-time');

    if (bdCount) bdCount.textContent = STATE.inventory.size.toLocaleString();
    if (bdTime) bdTime.textContent = STATE.inventoryLastUpdate || getTimestamp();
}

function updateGlobalSummaryFromTabs() {
    let ok = 0, blocked = 0, nowms = 0, total = 0;

    GlobalTabs.tabs.forEach(tab => {
        if (tab.type === 'classic') {
            ok += tab.data.pallets.ok.boxes.length;
            blocked += tab.data.pallets.blocked.boxes.length;
            nowms += tab.data.pallets.nowms.boxes.length;
        } else {
            tab.data.items.forEach(item => {
                if (item.status === 'ok') ok++;
                else if (item.status === 'blocked') blocked++;
                else nowms++;
            });
        }
    });

    total = ok + blocked + nowms;

    const okEl = document.getElementById('global-ok-count');
    const blockedEl = document.getElementById('global-blocked-count');
    const nowmsEl = document.getElementById('global-nowms-count');
    const totalEl = document.getElementById('global-total-count');

    if (okEl) okEl.textContent = ok;
    if (blockedEl) blockedEl.textContent = blocked;
    if (nowmsEl) nowmsEl.textContent = nowms;
    if (totalEl) totalEl.textContent = total;
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

// ==================== SISTEMA DE ALIAS ====================
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
                    Ingresa un nombre para identificarte:
                </p>
                <input type="text" id="alias-input" class="scan-input"
                       placeholder="Tu nombre..."
                       value="${STATE.userAlias || STATE.userName || ''}"
                       autocomplete="off"
                       style="width: 100%; margin-bottom: 10px;">
            </div>
            <div class="popup-buttons">
                <button class="btn btn-primary btn-full" onclick="saveUserAlias()">
                    💾 Guardar
                </button>
                <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove();">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    setTimeout(() => {
        const input = document.getElementById('alias-input');
        if (input) {
            input.focus();
            input.select();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveUserAlias();
                }
            });
        }
    }, 100);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

function saveUserAlias() {
    const input = document.getElementById('alias-input');
    const alias = input?.value?.trim() || STATE.userName;

    if (!alias) {
        showNotification('⚠️ Ingresa un nombre válido', 'warning');
        return;
    }

    STATE.userAlias = alias;
    localStorage.setItem('wms_user_alias', alias);

    document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
    updateUserDisplay();

    showNotification(`✅ Nombre actualizado: ${alias}`, 'success');
    playSound('success');
}

// ==================== TRANSFERENCIA ENTRE TARIMAS ====================
function showMoveBoxPopup(fromCategory, index) {
    const box = STATE.pallets[fromCategory].boxes[index];
    const categories = ['ok', 'blocked', 'nowms'].filter(c => c !== fromCategory);
    const categoryNames = { ok: 'OK ✅', blocked: 'Bloqueado ⚠️', nowms: 'No WMS ❌' };

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 350px;">
            <div class="popup-header">
                <span>↔️ Mover Caja</span>
                <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">×</button>
            </div>
            <p style="margin-bottom: 15px; font-size: 0.9em;">
                <strong>Código:</strong> <code>${box.code}</code><br>
                <strong>Desde:</strong> ${categoryNames[fromCategory]}
            </p>
            <p style="margin-bottom: 10px; font-weight: 600;">Mover a:</p>
            <div class="popup-buttons">
                ${categories.map(cat => `
                    <button class="btn btn-${cat === 'ok' ? 'success' : cat === 'blocked' ? 'warning' : 'danger'} btn-full"
                            onclick="moveBox('${fromCategory}', ${index}, '${cat}'); this.closest('.popup-overlay').remove();">
                        ${categoryNames[cat]}
                    </button>
                `).join('')}
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

function moveBox(fromCategory, index, toCategory) {
    const box = STATE.pallets[fromCategory].boxes.splice(index, 1)[0];
    box.verified = false;
    STATE.pallets[toCategory].boxes.push(JSON.parse(JSON.stringify(box)));
    saveToStorage();
    updateUI();
    GlobalTabs.saveToStorage();
    updateGlobalSummaryFromTabs();
    showNotification(`✅ Caja movida a ${toCategory.toUpperCase()}`, 'success');
    playSound('success');
}

// ==================== MODAL DETALLE DE PALLET ====================
let detailModalSort = { column: 'index', direction: 'asc' };
let detailModalFilter = { code: '', location: '' };

function showPalletDetailModal(category) {
    const pallet = STATE.pallets[category];
    const categoryNames = { ok: 'OK ✅', blocked: 'Bloqueado ⚠️', nowms: 'No WMS ❌' };
    const categoryColors = { ok: 'var(--success)', blocked: 'var(--blocked)', nowms: 'var(--error)' };

    if (pallet.boxes.length === 0) {
        showNotification('⚠️ No hay cajas en esta tarima', 'warning');
        return;
    }

    const verifiedCount = category === 'ok' ? pallet.boxes.filter(b => b.verified).length : 0;
    const pendingCount = pallet.boxes.length - verifiedCount;

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.id = 'pallet-detail-modal';
    overlay.innerHTML = `
        <div class="popup-content pallet-detail-modal-large">
            <button class="popup-close-corner" onclick="this.closest('.popup-overlay').remove()">×</button>
            <div class="pallet-detail-header" style="border-bottom: 3px solid ${categoryColors[category]};">
                <div class="pallet-detail-title">
                    <span class="pallet-category-name" style="color: ${categoryColors[category]};">
                        ${categoryNames[category]}
                    </span>
                    <span class="pallet-id">${pallet.id}</span>
                    <span class="pallet-count">${pallet.boxes.length} cajas</span>
                </div>
                ${category === 'ok' ? `
                    <div class="pallet-detail-counters">
                        <span class="counter-badge ok">✓ ${verifiedCount}</span>
                        <span class="counter-badge pending">○ ${pendingCount}</span>
                    </div>
                ` : ''}
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                <input type="text" class="scan-input" style="flex: 1; min-width: 150px; font-size: 0.9em; padding: 8px;"
                       placeholder="🔍 Filtrar código..." id="detail-filter-code" onkeyup="filterDetailModal('${category}')">
                <input type="text" class="scan-input" style="flex: 1; min-width: 150px; font-size: 0.9em; padding: 8px;"
                       placeholder="📍 Filtrar ubicación..." id="detail-filter-location" onkeyup="filterDetailModal('${category}')">
                <button class="btn btn-small btn-secondary" onclick="clearDetailFilters('${category}')">Limpiar</button>
            </div>
            <div style="max-height: 400px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
                    <thead>
                        <tr style="background: #f5f5f5; position: sticky; top: 0;">
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortDetailModal('${category}', 'index')"># ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortDetailModal('${category}', 'code')">Código ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortDetailModal('${category}', 'scan2')">Código 2 ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortDetailModal('${category}', 'location')">Ubicación ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortDetailModal('${category}', 'timestamp')">Hora ↕</th>
                            <th style="padding: 8px; text-align: center;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="detail-table-body"></tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    renderDetailTable(category);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function renderDetailTable(category) {
    const pallet = STATE.pallets[category];
    const tbody = document.getElementById('detail-table-body');
    if (!tbody) return;

    let filtered = pallet.boxes.map((box, index) => ({ ...box, originalIndex: index }));

    if (detailModalFilter.code) {
        const s = detailModalFilter.code.toUpperCase();
        filtered = filtered.filter(b => b.code.toUpperCase().includes(s) || (b.scan2 && b.scan2.toUpperCase().includes(s)));
    }
    if (detailModalFilter.location) {
        const s = detailModalFilter.location.toUpperCase();
        filtered = filtered.filter(b => b.location.toUpperCase().includes(s));
    }

    filtered.sort((a, b) => {
        let valA, valB;
        switch (detailModalSort.column) {
            case 'code': valA = a.code; valB = b.code; break;
            case 'scan2': valA = a.scan2 || ''; valB = b.scan2 || ''; break;
            case 'location': valA = a.location; valB = b.location; break;
            case 'timestamp': valA = a.timestamp; valB = b.timestamp; break;
            default: valA = a.originalIndex; valB = b.originalIndex;
        }
        if (typeof valA === 'string') return detailModalSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return detailModalSort.direction === 'asc' ? valA - valB : valB - valA;
    });

    tbody.innerHTML = filtered.map((box, i) => {
        const verified = box.verified || false;
        const style = verified ? 'background: rgba(76, 175, 80, 0.1);' : '';
        const checkBtn = category === 'ok' ?
            `<button class="btn btn-small" style="padding: 2px 6px;" onclick="toggleBoxVerifiedModal('${category}', ${box.originalIndex})">${verified ? '✓' : '○'}</button>` : '';

        return `
            <tr style="${style} border-bottom: 1px solid #eee;">
                <td style="padding: 8px;">${i + 1}</td>
                <td style="padding: 8px; font-family: monospace; font-weight: 600;">${box.code}</td>
                <td style="padding: 8px; font-family: monospace;">${box.scan2 || '-'}</td>
                <td style="padding: 8px;">${box.location}</td>
                <td style="padding: 8px;">${box.timestamp}</td>
                <td style="padding: 8px; text-align: center;">
                    <button class="btn btn-small btn-secondary" style="padding: 2px 6px;" onclick="copyToClipboard('${box.code}')" title="Copiar código">⧉</button>
                    ${checkBtn}
                    <button class="btn btn-small btn-secondary" style="padding: 2px 6px;" onclick="showMoveBoxPopup('${category}', ${box.originalIndex}); document.getElementById('pallet-detail-modal')?.remove();" title="Mover">⇄</button>
                    <button class="btn btn-small btn-danger" style="padding: 2px 6px;" onclick="deleteBoxModal('${category}', ${box.originalIndex})" title="Eliminar">✕</button>
                </td>
            </tr>
        `;
    }).join('');
}

function sortDetailModal(category, column) {
    if (detailModalSort.column === column) {
        detailModalSort.direction = detailModalSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        detailModalSort.column = column;
        detailModalSort.direction = 'asc';
    }
    renderDetailTable(category);
}

function filterDetailModal(category) {
    detailModalFilter.code = document.getElementById('detail-filter-code')?.value || '';
    detailModalFilter.location = document.getElementById('detail-filter-location')?.value || '';
    renderDetailTable(category);
}

function clearDetailFilters(category) {
    document.getElementById('detail-filter-code').value = '';
    document.getElementById('detail-filter-location').value = '';
    detailModalFilter = { code: '', location: '' };
    renderDetailTable(category);
}

function deleteBoxModal(category, index) {
    if (confirm('¿Eliminar esta caja?')) {
        STATE.pallets[category].boxes.splice(index, 1);
        saveToStorage();
        updateUI();
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();

        if (STATE.pallets[category].boxes.length === 0) {
            document.getElementById('pallet-detail-modal')?.remove();
            showNotification('Tarima vacía', 'info');
        } else {
            renderDetailTable(category);
            showNotification('Caja eliminada', 'info');
        }
    }
}

// ==================== SISTEMA DE VERIFICACIÓN ====================
function toggleBoxVerified(category, index) {
    const box = STATE.pallets[category].boxes[index];
    box.verified = !box.verified;
    saveToStorage();
    updateUI();
    GlobalTabs.saveToStorage();
}

function toggleBoxVerifiedModal(category, index) {
    toggleBoxVerified(category, index);
    renderDetailTable(category);

    const pallet = STATE.pallets[category];
    const v = pallet.boxes.filter(b => b.verified).length;
    const p = pallet.boxes.length - v;
    const counters = document.querySelector('.pallet-detail-counters');
    if (counters) {
        counters.innerHTML = `<span class="counter-badge ok">✓ ${v}</span><span class="counter-badge pending">○ ${p}</span>`;
    }
}

function updateVerificationBadges() {
    const pallet = STATE.pallets.ok;
    const v = pallet.boxes.filter(b => b.verified).length;
    const p = pallet.boxes.length - v;

    const vBadge = document.getElementById('ok-verified-badge');
    const pBadge = document.getElementById('ok-pending-badge');

    if (pallet.boxes.length > 0) {
        if (vBadge) {
            vBadge.style.display = v > 0 ? 'flex' : 'none';
            const vCount = document.getElementById('ok-verified-count');
            if (vCount) vCount.textContent = v;
        }
        if (pBadge) {
            pBadge.style.display = p > 0 ? 'flex' : 'none';
            const pCount = document.getElementById('ok-pending-count');
            if (pCount) pCount.textContent = p;
        }
    } else {
        if (vBadge) vBadge.style.display = 'none';
        if (pBadge) pBadge.style.display = 'none';
    }
}

// ==================== CONEXIÓN/DESCONEXIÓN GOOGLE ====================
function toggleGoogleConnection() {
    const token = gapi?.client?.getToken();
    const connectBtn = document.getElementById('btn-google-connect');
    const connectText = document.getElementById('google-connect-text');

    if (token) {
        // Desconectar
        if (confirm('¿Desconectar de Google?\n\nLos datos no sincronizados se guardarán localmente.')) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');

            if (syncManager) {
                syncManager.stopAutoSync();
            }

            if (connectBtn) connectBtn.classList.add('disconnected');
            if (connectText) connectText.textContent = 'Desconectado';

            updateConnectionStatus(false);
            showNotification('🔗 Desconectado de Google', 'info');
        }
    } else {
        // Reconectar
        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                console.error('Auth error:', resp);
                showNotification('❌ Error al reconectar', 'error');
                return;
            }

            gapi.client.setToken(resp);

            if (syncManager) {
                syncManager.startAutoSync();
                await syncManager.sync();
            }

            if (connectBtn) connectBtn.classList.remove('disconnected');
            if (connectText) connectText.textContent = 'Conectado';

            updateConnectionStatus(true);
            showNotification('✅ Reconectado a Google', 'success');
            playSound('success');
        };

        tokenClient.requestAccessToken({prompt: ''});
    }
}

function updateGoogleConnectButton() {
    const token = gapi?.client?.getToken();
    const connectBtn = document.getElementById('btn-google-connect');
    const connectText = document.getElementById('google-connect-text');

    if (token) {
        if (connectBtn) connectBtn.classList.remove('disconnected');
        if (connectText) connectText.textContent = 'Conectado';
    } else {
        if (connectBtn) connectBtn.classList.add('disconnected');
        if (connectText) connectText.textContent = 'Desconectado';
    }
}

// ==================== INICIALIZACIÓN AL CARGAR ====================
window.addEventListener('load', initializeApp);

// Exponer funciones globalmente para onclick handlers
window.GlobalTabs = GlobalTabs;
window.UnifiedModule = UnifiedModule;
window.showMoveBoxPopup = showMoveBoxPopup;
window.moveBox = moveBox;
window.showPalletDetailModal = showPalletDetailModal;
window.renderDetailTable = renderDetailTable;
window.sortDetailModal = sortDetailModal;
window.filterDetailModal = filterDetailModal;
window.clearDetailFilters = clearDetailFilters;
window.deleteBoxModal = deleteBoxModal;
window.toggleBoxVerified = toggleBoxVerified;
window.toggleBoxVerifiedModal = toggleBoxVerifiedModal;
window.forceInsert = forceInsert;
window.forceInsertDuplicate = forceInsertDuplicate;
window.deleteBox = deleteBox;
window.sendPallet = sendPallet;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.refreshInventory = refreshInventory;
window.exportData = exportData;
window.saveUserAlias = saveUserAlias;
window.toggleGoogleConnection = toggleGoogleConnection;
window.showCountValidationModal = showCountValidationModal;
window.validateAndSendPallet = validateAndSendPallet;
window.executeSendPallet = executeSendPallet;
