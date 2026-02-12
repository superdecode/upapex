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
let gapiInited = false;
let gisInited = false;
let syncManager = null;
let sidebarComponent = null;

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

        // Save current tab data before switching
        if (this.activeTabId && this.activeTabId !== tabId) {
            this.saveCurrentTabData();
        }

        this.activeTabId = tabId;

        // Load new tab data - use deep copy to avoid reference issues
        if (tab.type === 'classic') {
            STATE.pallets = JSON.parse(JSON.stringify(tab.data.pallets));
            const originInput = document.getElementById('origin-location');
            if (originInput) originInput.value = tab.data.originLocation || '';
        } else {
            UnifiedModule.items = JSON.parse(JSON.stringify(tab.data.items || []));
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
    pendingCode1: null, // Para almacenar el primer código cuando no se encuentra

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        const scanInput = document.getElementById('unified-scan-input');
        const code2Input = document.getElementById('unified-code2-input');

        if (scanInput) {
            scanInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && scanInput.value.trim()) {
                    e.preventDefault();
                    this.processScan(scanInput.value.trim());
                    scanInput.value = '';
                }
            });
        }

        if (code2Input) {
            code2Input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && code2Input.value.trim()) {
                    e.preventDefault();
                    this.processSecondCode(code2Input.value.trim());
                    code2Input.value = '';
                }
            });
        }
    },

    processScan(rawCode) {
        const result = findCodeInInventory(rawCode, STATE.inventory);
        const code = result.code;
        const item = result.item;

        // If no item found, show inline code2 input
        if (!item) {
            this.pendingCode1 = { raw: rawCode, code: code };
            this.showCode2Inline(true);
            this.showResult('error', code, 'NO ENCONTRADO', 'Código no encontrado en WMS. Ingresa Código 2.');
            playSound('error');
            setTimeout(() => document.getElementById('unified-code2-input')?.focus(), 100);
            return;
        }

        // Hide code2 input if visible
        this.hideCode2Inline();
        this.pendingCode1 = null;

        // Check duplicates - verificar en code Y code2
        const dupIndex = this.items.findIndex(i => i.code === code || i.code2 === code);
        if (dupIndex !== -1) {
            if (!confirm(`Código ${code} ya registrado. ¿Agregar duplicado?`)) {
                return;
            }
        }

        let status = 'nowms';
        let statusText = 'NO WMS';

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

    showCode2Inline(show) {
        const code2Inline = document.getElementById('unified-code2-inline');
        if (code2Inline) {
            code2Inline.style.display = show ? 'block' : 'none';
        }
    },

    hideCode2Inline() {
        this.showCode2Inline(false);
        const code2Input = document.getElementById('unified-code2-input');
        if (code2Input) {
            code2Input.value = '';
        }
    },

    processSecondCode(rawCode2) {
        if (!this.pendingCode1) {
            console.warn('⚠️ [UNIFIED] No hay código pendiente para procesar');
            return;
        }

        if (!rawCode2 || !rawCode2.trim()) {
            showNotification('⚠️ Ingresa el Código 2', 'warning');
            return;
        }

        const rawCode1 = this.pendingCode1.raw;
        const code1 = this.pendingCode1.code;

        this.hideCode2Inline();

        const result = findCodeInInventory(rawCode2, STATE.inventory);
        const code2 = result.code;
        const item = result.item;

        // Check duplicates - verificar si code2 ya existe en code O code2 de algún registro
        const dupIndex = this.items.findIndex(i => i.code === code2 || i.code2 === code2);
        if (dupIndex !== -1) {
            if (!confirm(`Código ${code2} ya registrado. ¿Agregar duplicado?`)) {
                this.pendingCode1 = null;
                setTimeout(() => document.getElementById('unified-scan-input')?.focus(), 100);
                return;
            }
        }

        // También verificar si code1 y code2 son el mismo
        if (code1 === code2) {
            showNotification('⚠️ Código 1 y Código 2 son iguales', 'warning');
            this.pendingCode1 = null;
            setTimeout(() => document.getElementById('unified-scan-input')?.focus(), 100);
            return;
        }

        let status = 'nowms';
        let statusText = 'NO WMS';
        let finalCode = code1;      // Por defecto, código 1 en scan1
        let finalCode2 = code2;     // Código 2 en scan2
        let finalRaw = rawCode1;    // Raw del código 1

        // ESCENARIO 1: Código 2 SÍ está en WMS - HACER SWAP
        if (item) {
            // SWAP: code2 pasa a scan1, code1 pasa a scan2
            finalCode = code2;      // Código 2 (que SÍ está en WMS) va a scan1
            finalCode2 = code1;     // Código 1 (que NO estaba) va a scan2
            finalRaw = rawCode2;    // Raw del código 2

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
        // ESCENARIO 2: Código 2 NO está en WMS - NO SWAP, ambos NO WMS
        // finalCode = code1 (ya está por defecto)
        // finalCode2 = code2
        // status = 'nowms', statusText = 'NO WMS'

        const newItem = {
            raw: finalRaw,
            code: finalCode,
            code2: finalCode2,
            status: status,
            statusText: statusText,
            sku: item?.sku || '-',
            product: item?.productName || '-',
            location: item?.cellNo || '-',
            timestamp: getTimestamp()
        };

        this.items.push(newItem);
        this.updateUI();
        this.showResult(status, finalCode, statusText);
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();

        playSound(status === 'ok' ? 'success' : status === 'blocked' ? 'warning' : 'error');

        this.pendingCode1 = null;
        setTimeout(() => document.getElementById('unified-scan-input')?.focus(), 100);
    },

    showResult(type, code, title, details = '') {
        const box = document.getElementById('unified-result-box');
        const icons = { ok: '✅', blocked: '⚠️', nowms: '❌', error: '❌' };

        box.className = `result-box show ${type === 'ok' ? 'success' : type === 'blocked' ? 'warning' : 'error'}`;
        document.getElementById('unified-result-icon').textContent = icons[type] || '📦';
        document.getElementById('unified-result-title').textContent = `${title}: ${code}`;
        document.getElementById('unified-result-details').textContent = details || '';
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

        list.innerHTML = this.items.map((item, i) => {
            const hasCode2 = item.code2 && item.code2.trim();
            const codeDisplay = hasCode2
                ? `<div class="unified-item-code">${item.code} / ${item.code2}</div>`
                : `<div class="unified-item-code">${item.code}</div>`;

            return `
                <div class="unified-item ${item.status}">
                    <div class="unified-item-info">
                        ${codeDisplay}
                        <div class="unified-item-meta">
                            <span>${item.timestamp}</span>
                            <span>${item.location}</span>
                        </div>
                    </div>
                    <span class="unified-item-status ${item.status}">${item.statusText}</span>
                    <button class="unified-item-delete" onclick="UnifiedModule.deleteItem(${i})">×</button>
                </div>
            `;
        }).join('');
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

        if (this.items.length === 0) {
            showNotification('⚠️ No hay registros para enviar', 'warning');
            return;
        }

        const validation = validateAndNormalizeLocation(destLocation);

        let finalLocation = destLocation;

        if (!validation.valid) {
            const forceInsert = confirm(`⚠️ Ubicación con formato inválido: ${destLocation}\n\n${validation.message || 'Formato incorrecto'}\n\n¿Deseas insertar de todas formas?`);
            if (!forceInsert) {
                document.getElementById('unified-dest-location')?.focus();
                return;
            }
            finalLocation = destLocation;
            showNotification('⚠️ Ubicación insertada sin validar', 'warning');
        } else {
            if (validation.needsCorrection) {
                if (!confirm(`La ubicación será corregida a: ${validation.normalized}\n\n¿Continuar?`)) {
                    document.getElementById('unified-dest-location')?.focus();
                    return;
                }
            }
            finalLocation = validation.normalized;
            document.getElementById('unified-dest-location').value = finalLocation;
        }

        const isCancelados = this.isCancelados();
        const modeText = isCancelados ? ' CANCELADOS' : '';

        // Mostrar modal de validación de cantidad
        this.showCountValidationModal(this.items.length, finalLocation, originLocation, isCancelados, modeText);
    },

    showCountValidationModal(actualCount, finalLocation, originLocation, isCancelados, modeText) {
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay show';
        overlay.id = 'unified-count-validation-modal';
        overlay.innerHTML = `
            <div class="popup-content count-validation-popup" style="max-width: 500px; width: 90%;">
                <button class="popup-close-corner" onclick="this.closest('.popup-overlay').remove()">×</button>
                <div class="popup-header-centered">
                    <span class="popup-header-icon">📦</span>
                    <h2>Validación de Cantidad</h2>
                </div>
                <div class="validation-info">
                    <p>Registros${modeText}: <strong>${actualCount}</strong></p>
                    <p>Destino: <strong>${finalLocation}</strong></p>
                </div>
                <div class="validation-input-group">
                    <label>¿Cuántos registros hay realmente?</label>
                    <input type="number" id="unified-count-input" class="count-input"
                           placeholder="Ingresa cantidad" min="1" autocomplete="off">
                    <div class="count-blur-display" id="unified-count-blur-display">
                        <span class="blur-number">???</span>
                        <span class="blur-label">registros en sistema</span>
                    </div>
                </div>
                <div class="popup-buttons">
                    <button class="btn btn-primary btn-full" onclick="UnifiedModule.validateAndExecuteSend('${finalLocation}', '${originLocation}', ${actualCount}, ${isCancelados})">
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
            const input = document.getElementById('unified-count-input');
            if (input) {
                input.focus();
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.validateAndExecuteSend(finalLocation, originLocation, actualCount, isCancelados);
                    }
                });
            }
        }, 100);

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    },

    validateAndExecuteSend(finalLocation, originLocation, actualCount, isCancelados) {
        const input = document.getElementById('unified-count-input');
        const enteredCount = parseInt(input?.value) || 0;

        if (enteredCount <= 0) {
            showNotification('⚠️ Ingresa una cantidad válida', 'warning');
            input?.focus();
            return;
        }

        // Cerrar modal de validación
        document.getElementById('unified-count-validation-modal')?.remove();

        // Verificar si coincide
        if (enteredCount !== actualCount) {
            const diff = actualCount - enteredCount;
            const message = diff > 0
                ? `⚠️ Diferencia detectada: Faltan ${diff} registros según el sistema`
                : `⚠️ Diferencia detectada: Hay ${Math.abs(diff)} registros de más según el sistema`;

            if (!confirm(`${message}\n\nEn sistema: ${actualCount}\nIngresados: ${enteredCount}\n\n¿Enviar de todos modos?`)) {
                showNotification('❌ Envío cancelado - Verificar conteo', 'warning');
                return;
            }
        }

        // Proceder con el envío
        this.executeSendAll(finalLocation, originLocation, isCancelados);
    },

    async executeSendAll(finalLocation, originLocation, isCancelados) {

        console.log(`📤 [UNIFIED] Iniciando envío de ${this.items.length} registros unificados`);

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
                    scan2: item.code2 || '',
                    location: finalLocation,
                    status: finalStatus,
                    note: note,
                    pallet: palletId,
                    originLocation: originLocation
                };
            });

            console.log(`📦 [UNIFIED] Preparados ${records.length} registros para sincronización`);

            STATE.history = [...records, ...STATE.history].slice(0, 1000);

            // CRÍTICO: Verificar que syncManager está disponible
            if (!syncManager) {
                console.error('❌ [UNIFIED] syncManager no está inicializado');
                showNotification('❌ Error: Sistema de sincronización no disponible', 'error');
                return;
            }

            // CRÍTICO: Intentar agregar a la cola con manejo de errores
            try {
                const queueResult = await addPalletToQueue(records, records[0]?.pallet, records[0]?.location);

                if (queueResult === false) {
                    throw new Error('addPalletToQueue retornó false - Error al agregar a cola');
                }

                console.log(`✅ [UNIFIED] ${records.length} registros agregados a cola de sincronización`);

            } catch (queueError) {
                console.error('❌ [UNIFIED] Error CRÍTICO al agregar registros a cola:', queueError);
                showNotification(`❌ Error al guardar datos: ${queueError.message || 'Error desconocido'}`, 'error');

                // NO borrar los items si falló el guardado
                showLoading(false);
                return;
            }

            // CRÍTICO: Intentar sincronizar si estamos online
            let syncSuccess = false;
            if (checkOnlineStatus() && gapi?.client?.getToken()) {
                try {
                    console.log('🔄 [UNIFIED] Iniciando sincronización inmediata...');
                    const syncResult = await syncInventoryData(false); // false = no mostrar notificaciones intermedias

                    if (syncResult && syncResult.success) {
                        console.log('✅ [UNIFIED] Sincronización completada exitosamente');
                        syncSuccess = true;
                    } else {
                        console.warn('⚠️ [UNIFIED] Sincronización pendiente - Los datos están en cola');
                    }

                } catch (syncError) {
                    console.error('❌ [UNIFIED] Error en sincronización inmediata:', syncError);
                    console.warn('⚠️ [UNIFIED] Los datos permanecen en cola para sincronización posterior');
                }
            } else {
                console.warn('⚠️ [UNIFIED] Sin conexión o sin token - Datos guardados en cola');
            }

            // SOLO borrar los items DESPUÉS de guardar exitosamente en la cola
            const count = this.items.length;
            const modeText = isCancelados ? ' CANCELADOS' : '';
            console.log(`🧹 [UNIFIED] Limpiando ${count} items tras guardado exitoso`);

            this.items = [];
            this.updateUI();
            GlobalTabs.saveToStorage();
            updateGlobalSummaryFromTabs();
            playSound('success');

            // Mostrar UNA ÚNICA notificación consolidada
            if (syncSuccess) {
                showNotification(`✅ ${count} registros${modeText} enviados y sincronizados`, 'success');
            } else {
                showNotification(`💾 ${count} registros${modeText} guardados en cola de sincronización`, 'info');
            }

        } catch (error) {
            console.error('❌ [UNIFIED] Error crítico al enviar:', error);
            console.error('Detalles del error:', {
                message: error.message,
                stack: error.stack,
                type: error.constructor.name
            });

            showNotification(`❌ Error al procesar: ${error.message || 'Error desconocido'}`, 'error');

            // NO borrar los items si hubo error
            console.warn('⚠️ [UNIFIED] Items NO borrados debido a error - Los datos se preservan');

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
}

// Inicializar sidebar (se llama después de login)
function initializeSidebar() {
    console.log('🔧 initializeSidebar() llamado');
    console.log('🔍 sidebarComponent existe?', !!sidebarComponent);
    console.log('🔍 window.SidebarComponent existe?', !!window.SidebarComponent);

    const sidebarEl = document.getElementById('sidebar');
    console.log('🔍 Elemento #sidebar existe?', !!sidebarEl);

    if (!sidebarEl) {
        console.error('❌ Elemento #sidebar no encontrado en el DOM');
        return;
    }

    if (sidebarComponent) {
        console.log('⚠️ sidebarComponent ya existe, saltando inicialización');
        return;
    }

    if (window.SidebarComponent) {
        console.log('✅ Usando SidebarComponent compartido...');

        try {
            sidebarComponent = new window.SidebarComponent({
                appName: 'Inventario',
                appIcon: '📦',
                appSubtitle: 'Sistema de gestión',
                containerId: 'sidebar',
                syncManager: syncManager,
                summaryConfig: {
                    title: '📊 Resumen Global',
                    items: [
                        { id: 'global-ok-count', icon: '✅', label: 'OK', class: 'ok' },
                        { id: 'global-blocked-count', icon: '⚠️', label: 'Bloqueado', class: 'blocked' },
                        { id: 'global-nowms-count', icon: '❌', label: 'No WMS', class: 'nowms' },
                        { id: 'global-total-count', icon: '📦', label: 'Total', class: 'total' }
                    ]
                },
                buttons: [
                    { label: '➕ Nuevo', onClick: 'GlobalTabs.createTab()', class: 'sidebar-btn-primary' },
                    { label: '📋 Resumen', onClick: 'showAllRecordsModal()', class: 'sidebar-btn-secondary' }
                ],
                onReloadBD: refreshInventory,
                onLogout: handleLogout,
                onToggleConnection: toggleGoogleConnection
            });

            console.log('🎨 Renderizando sidebar...');
            sidebarComponent.render();
            window.sidebarComponent = sidebarComponent;

            // Verificar que se renderizó
            setTimeout(() => {
                const html = sidebarEl.innerHTML;
                console.log('📊 Sidebar HTML length:', html.length);
                console.log('📊 Sidebar HTML preview:', html.substring(0, 300));

                if (html.length < 100) {
                    console.error('❌ Sidebar no se renderizó correctamente (HTML muy corto)');
                }
            }, 100);

            // Actualizar info de BD si ya está cargada
            if (STATE.inventory.size > 0) {
                console.log('📦 Actualizando BD info:', STATE.inventory.size);
                sidebarComponent.updateBDInfo(STATE.inventory.size);
            }

            console.log('✅ Sidebar inicializado correctamente');

            // Inicializar AccessRequestManager para solicitudes de acceso
            if (typeof AccessRequestManager !== 'undefined') {
                AccessRequestManager.init({
                    appName: 'Inventario',
                    spreadsheetId: CONFIG.SPREADSHEET_WRITE
                });
                console.log('✅ AccessRequestManager inicializado');
            }
        } catch (error) {
            console.error('❌ Error al crear SidebarComponent:', error);
            renderFallbackSidebar();
        }
    } else {
        console.warn('⚠️ window.SidebarComponent no disponible, usando fallback');
        renderFallbackSidebar();
    }
}

// Renderizar sidebar fallback si SidebarComponent no está disponible
function renderFallbackSidebar() {
    console.log('🔄 Renderizando sidebar fallback...');

    const sidebarEl = document.getElementById('sidebar');
    if (!sidebarEl) return;

    sidebarEl.innerHTML = `
        <div class="sidebar-header">
            <h2>📦 Inventario</h2>
            <p>Sistema de gestión</p>
        </div>

        <div class="sync-status sync-ok" onclick="window.syncManager?.showPanel()">
            ✅ Sincronizado
        </div>

        <div class="global-summary-section">
            <div class="summary-title">📊 Resumen Global</div>
            <div class="summary-grid">
                <div class="summary-item ok">
                    <span class="summary-icon">✅</span>
                    <span class="summary-value" id="global-ok-count">0</span>
                    <span class="summary-label">OK</span>
                </div>
                <div class="summary-item blocked">
                    <span class="summary-icon">⚠️</span>
                    <span class="summary-value" id="global-blocked-count">0</span>
                    <span class="summary-label">Bloqueado</span>
                </div>
                <div class="summary-item nowms">
                    <span class="summary-icon">❌</span>
                    <span class="summary-value" id="global-nowms-count">0</span>
                    <span class="summary-label">No WMS</span>
                </div>
                <div class="summary-item total">
                    <span class="summary-icon">📦</span>
                    <span class="summary-value" id="global-total-count">0</span>
                    <span class="summary-label">Total</span>
                </div>
            </div>
        </div>

        <div class="sidebar-section">
            <button class="sidebar-btn sidebar-btn-primary" onclick="GlobalTabs.createTab()">
                ➕ Nuevo
            </button>
            <button class="sidebar-btn sidebar-btn-secondary" onclick="showAllRecordsModal()">
                📋 Resumen
            </button>
        </div>

        <div class="user-footer">
            <div class="user-info">
                <div class="user-avatar" id="user-avatar" onclick="showAliasPopup()" style="cursor: pointer;">?</div>
                <div class="user-details">
                    <div class="user-name" id="user-name-display" onclick="showAliasPopup()" style="cursor: pointer;">No conectado</div>
                    <div class="connection-indicator">
                        <div class="connection-dot" id="connection-dot"></div>
                        <span id="connection-text">Offline</span>
                    </div>
                </div>
            </div>
            <div class="user-footer-actions">
                <button class="btn btn-secondary btn-small" onclick="refreshInventory()" title="Actualizar BD">🔄</button>
                <button class="btn btn-secondary btn-small" onclick="toggleGoogleConnection()" title="Conectar/Desconectar">🔌</button>
                <button class="btn btn-secondary btn-small" onclick="handleLogout()" title="Cerrar Sesión">🚪</button>
            </div>
            <div class="bd-info">
                <div><span id="bd-count">0</span> registros cargados</div>
                <div id="bd-update-time">Sin actualizar</div>
            </div>
        </div>
    `;

    console.log('✅ Sidebar fallback renderizado');

    // Actualizar displays
    updateUserDisplay();
    updateConnectionStatus();
    updateBdInfo();
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
    gisInited = true;
    maybeEnableButtons();
}

async function maybeEnableButtons() {
    if (gapiInited && gisInited) {
        console.log('Google APIs initialized');

        // Verificar que AuthManager esté disponible
        if (typeof AuthManager === 'undefined') {
            console.error('❌ AuthManager no está disponible');
            showNotification('❌ Error: Sistema de autenticación no disponible', 'error');
            return;
        }

        try {
            // Configurar callbacks de AuthManager (sin re-inicializar gapi)
            AuthManager.gapiInited = true;
            AuthManager.onAuthSuccess = async (authData) => {
                console.log('✅ [INVENTORY] AuthManager login exitoso:', authData.email);
                STATE.userEmail = authData.email;
                STATE.userName = authData.name;
                STATE.userAlias = authData.user;

                await loadInventory();
                await initAdvancedSync();
                syncManager = window.syncManager;

                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('main-app').classList.remove('hidden');

                initializeSidebar();
                GlobalTabs.updateVisibility();
                updateConnectionStatus();
            };

            AuthManager.onAuthError = (error) => {
                console.error('❌ [INVENTORY] AuthManager error:', error);
                showNotification('❌ Error de autenticación', 'error');
            };

            // Esperar a que GIS esté listo e inicializar tokenClient
            await AuthManager.waitForGIS();

            // Verificar sesión guardada
            const restored = AuthManager.checkSavedSession();

            console.log('✅ [INVENTORY] AuthManager inicializado' + (restored ? ' (sesión restaurada)' : ''));
        } catch (error) {
            console.error('❌ Error inicializando AuthManager:', error);
            showNotification('❌ Error al inicializar autenticación', 'error');
        }
    }
}

// ==================== AUTENTICACIÓN ====================
function handleLogin() {
    // Usar AuthManager compartido para el login
    AuthManager.login();
}

async function getUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${gapi.client.getToken().access_token}` }
        });
        const profile = await response.json();
        STATE.userEmail = profile.email;
        STATE.userName = profile.name || profile.email.split('@')[0];

        // Obtener nombre guardado desde localStorage (sidebar puede no estar inicializado aún)
        const savedName = localStorage.getItem('wms_user_name') || STATE.userName;
        STATE.userAlias = savedName;

        // Integrar con sidebar component si está disponible
        if (sidebarComponent) {
            if (!localStorage.getItem('wms_user_name')) {
                sidebarComponent.setUserName(STATE.userName);
            }
            sidebarComponent.setUserEmail(STATE.userEmail);

            // Guardar conexión de Google
            const token = gapi.client.getToken();
            if (token && token.access_token) {
                sidebarComponent.saveGoogleConnection(token.access_token, token.expires_in || 3600);
            }

            updateUserDisplay();

            // Mostrar popup de alias si es primera vez
            if (!savedName || savedName === 'Usuario') {
                setTimeout(() => {
                    sidebarComponent.showNameEditPopup();
                }, 1500);
            }
        } else if (window.AvatarSystem) {
            // Fallback a AvatarSystem
            const savedName = window.AvatarSystem.getUserName();
            STATE.userAlias = savedName || STATE.userName;

            if (!savedName) {
                window.AvatarSystem.setUserName(STATE.userName);
            }
            window.AvatarSystem.setUserEmail(STATE.userEmail);

            const token = gapi.client.getToken();
            if (token && token.access_token) {
                window.AvatarSystem.saveGoogleConnection(token.access_token, token.expires_in || 3600);
            }

            updateUserDisplay();

            if (!STATE.userAlias || STATE.userAlias === 'Usuario') {
                setTimeout(() => {
                    window.AvatarSystem.showNamePopup();
                }, 1000);
            }
        } else {
            // Fallback final
            const savedAlias = localStorage.getItem('wms_user_alias');
            STATE.userAlias = savedAlias || STATE.userName;
            updateUserDisplay();

            if (!STATE.userAlias || STATE.userAlias === 'Usuario') {
                setTimeout(() => {
                    showAliasPopup();
                }, 1000);
            }
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

    // Limpiar datos específicos de la app ANTES de logout
    localStorage.removeItem('wms_inventory_state');
    localStorage.removeItem('wms_user_alias');
    
    // Limpiar variables de estado
    STATE.userEmail = '';
    STATE.userName = '';
    STATE.userAlias = '';
    STATE.inventory = new Map();
    STATE.scannedBoxes = { ok: [], blocked: [], nowms: [] };
    STATE.pallets = { ok: { boxes: [] }, blocked: { boxes: [] }, nowms: { boxes: [] } };

    // Usar AuthManager compartido para el logout
    AuthManager.logout();

    if (syncManager) {
        syncManager.stopAutoSync();
    }

    // Limpiar sidebar component
    if (sidebarComponent) {
        sidebarComponent.clearGoogleConnection();
    }

    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    updateConnectionStatus();
}

/**
 * Parser CSV robusto que maneja comillas y comas dentro de valores
 */
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            // Manejar comillas dobles escapadas ""
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Saltar la siguiente comilla
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

async function loadInventory() {
    showLoading(true);

    // Actualizar texto del preloader
    const preloaderSubtext = document.querySelector('.preloader-subtext');
    if (preloaderSubtext) {
        preloaderSubtext.textContent = 'Descargando base de datos desde Google Sheets...';
    }

    try {
        console.log('🔄 [INVENTORY] Iniciando carga de inventario...');

        const response = await fetch(CONFIG.INVENTORY_CSV_URL);

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status} ${response.statusText}`);
        }

        const csvText = await response.text();

        if (!csvText || csvText.trim().length === 0) {
            throw new Error('El archivo CSV está vacío');
        }

        const lines = csvText.split('\n');
        console.log(`📊 [INVENTORY] Total de líneas en CSV: ${lines.length}`);

        STATE.inventory.clear();

        // Mapeo de columnas según el CSV real:
        // Col 0: Box type No./箱类型号
        // Col 1: Customize Barcode/自定义箱条码 (CÓDIGO PRINCIPAL)
        // Col 6: cellNo (UBICACIÓN)
        // Col 9: Available stock/可用库存 (STOCK DISPONIBLE)
        // Col 11: sku
        // Col 12: Product name/产品名称

        let processedCount = 0;
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue; // Saltar líneas vacías

            const row = parseCSVLine(lines[i]);

            // El código principal está en la columna B (índice 1)
            const customBarcode = row[1]?.trim();
            const boxType = row[0]?.trim();

            if (customBarcode) {
                // Indexar por el código de barras personalizado (columna B)
                STATE.inventory.set(customBarcode, {
                    code: customBarcode,
                    boxType: boxType || '',
                    sku: row[11] || '',
                    productName: row[12] || '',
                    cellNo: row[6] || '',
                    availableStock: parseInt(row[9]) || 0,
                    isBlocked: parseInt(row[9]) === 0, // Bloqueado si no hay stock
                    isAvailable: parseInt(row[9]) > 0
                });

                // También indexar por Box Type (columna A) como alternativa
                if (boxType && boxType !== customBarcode) {
                    STATE.inventory.set(boxType, {
                        code: boxType,
                        boxType: boxType,
                        sku: row[11] || '',
                        productName: row[12] || '',
                        cellNo: row[6] || '',
                        availableStock: parseInt(row[9]) || 0,
                        isBlocked: parseInt(row[9]) === 0,
                        isAvailable: parseInt(row[9]) > 0
                    });
                }
                processedCount++;
            }
        }

        STATE.inventoryLastUpdate = getTimestamp();
        updateBdInfo();

        console.log(`✅ [INVENTORY] Inventario cargado exitosamente: ${STATE.inventory.size} códigos únicos de ${processedCount} registros procesados`);
        showNotification('✅ Inventario cargado: ' + STATE.inventory.size + ' códigos', 'success');

    } catch (error) {
        console.error('❌ [INVENTORY] Error al cargar inventario:', error);
        console.error('Detalles del error:', {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
        });

        // Mostrar alerta clara al usuario
        showNotification(`❌ Error al cargar base de datos: ${error.message}`, 'error');

        // Crear banner de error si no existe
        createInventoryErrorBanner(error.message);

    } finally {
        showLoading(false);

        // Limpiar texto del preloader
        if (preloaderSubtext) {
            preloaderSubtext.textContent = 'Descargando base de datos desde Google Sheets';
        }
    }
}

/**
 * Crea un banner de error para la carga de inventario
 */
function createInventoryErrorBanner(errorMessage) {
    // Evitar duplicados
    const existing = document.getElementById('inventory-error-banner');
    if (existing) {
        existing.remove();
    }

    const banner = document.createElement('div');
    banner.id = 'inventory-error-banner';
    banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #e74c3c, #c0392b);
        color: white;
        padding: 15px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 10000;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        animation: slideDown 0.3s ease-out;
    `;

    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px; flex: 1;">
            <span style="font-size: 24px;">⚠️</span>
            <div>
                <div style="font-weight: 700; font-size: 1.1em;">Error al cargar la base de datos</div>
                <div style="font-size: 0.9em; opacity: 0.9;">${errorMessage || 'Error desconocido'}</div>
            </div>
        </div>
        <div style="display: flex; gap: 10px;">
            <button onclick="refreshInventory()" style="
                background: white;
                color: #e74c3c;
                border: none;
                padding: 10px 20px;
                border-radius: 6px;
                font-weight: 700;
                cursor: pointer;
                font-size: 1em;
                transition: transform 0.2s;
            ">
                🔄 Reintentar
            </button>
            <button onclick="document.getElementById('inventory-error-banner').remove()" style="
                background: rgba(255,255,255,0.2);
                color: white;
                border: none;
                padding: 10px 15px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 1em;
            ">
                ✕
            </button>
        </div>
    `;

    document.body.prepend(banner);

    // Agregar animación si no existe
    if (!document.getElementById('inventory-error-animation')) {
        const style = document.createElement('style');
        style.id = 'inventory-error-animation';
        style.textContent = `
            @keyframes slideDown {
                from { transform: translateY(-100%); }
                to { transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);
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

    // Listeners de autenticación
    window.addEventListener('auth-account-changed', (event) => {
        const { previousEmail, newEmail } = event.detail;
        console.log('🔄 [INVENTORY] Cambio de cuenta detectado:', previousEmail, '->', newEmail);

        // CRÍTICO: Limpiar localStorage específico de la app
        localStorage.removeItem('wms_inventory_state');
        localStorage.removeItem('wms_user_alias');

        // Limpiar datos del usuario anterior
        STATE.userEmail = '';
        STATE.userName = '';
        STATE.userAlias = '';

        // Limpiar inventario
        STATE.inventory = new Map();
        STATE.scannedBoxes = { ok: [], blocked: [], nowms: [] };
        STATE.pallets = { ok: { boxes: [] }, blocked: { boxes: [] }, nowms: { boxes: [] } };

        showNotification('🔄 Cambio de cuenta detectado. Recargando datos...', 'info');
    });

    window.addEventListener('auth-needs-name-registration', (event) => {
        const { email, isNewAccount, needsNameRegistration } = event.detail;
        console.log('👤 [INVENTORY] Se requiere registro de nombre:', { email, isNewAccount, needsNameRegistration });

        // Recargar datos del avatar y forzar popup si es necesario
        if (window.sidebarComponent) {
            window.sidebarComponent.reloadAvatarData(needsNameRegistration);
        }

        // Actualizar STATE desde AuthManager
        if (window.AuthManager && window.AuthManager.currentUser) {
            STATE.userAlias = window.AuthManager.currentUser;
        }
    });

    // CRÍTICO: Escuchar actualizaciones del avatar para sincronizar STATE.userAlias
    // Esto asegura que cuando el usuario cambia su nombre, se refleje inmediatamente en los registros
    if (window.sidebarComponent) {
        window.sidebarComponent.onAvatarUpdate((avatarState) => {
            if (avatarState.userName) {
                STATE.userAlias = avatarState.userName;
                console.log('🔄 [INVENTORY] STATE.userAlias sincronizado desde avatar:', STATE.userAlias);
                updateUserDisplay();
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
        <div class="popup-content count-validation-popup" style="max-width: 500px; width: 90%;">
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

    // VALIDACIÓN: Verificar que hay cajas para enviar
    if (!pallet.boxes || pallet.boxes.length === 0) {
        showNotification('⚠️ No hay cajas para enviar en esta tarima', 'warning');
        return;
    }

    console.log(`📤 [INVENTORY] Iniciando envío de tarima ${category}: ${pallet.boxes.length} cajas`);

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

        console.log(`📦 [INVENTORY] Preparados ${records.length} registros para sincronización`);

        STATE.history = [...records, ...STATE.history].slice(0, 1000);

        // CRÍTICO: Verificar que syncManager está disponible
        if (!syncManager) {
            console.error('❌ [INVENTORY] syncManager no está inicializado');
            showNotification('❌ Error: Sistema de sincronización no disponible', 'error');
            return;
        }

        // CRÍTICO: Intentar agregar a la cola con manejo de errores
        try {
            const queueResult = await addPalletToQueue(records, records[0]?.pallet, records[0]?.location);

            if (queueResult === false) {
                throw new Error('addPalletToQueue retornó false - Error al agregar a cola');
            }

            console.log(`✅ [INVENTORY] ${records.length} registros agregados a cola de sincronización`);

        } catch (queueError) {
            console.error('❌ [INVENTORY] Error CRÍTICO al agregar registros a cola:', queueError);
            showNotification(`❌ Error al guardar datos: ${queueError.message || 'Error desconocido'}`, 'error');

            // NO borrar los pallets si falló el guardado
            showLoading(false);
            return;
        }

        // CRÍTICO: Intentar sincronizar si estamos online
        let syncSuccess = false;
        if (checkOnlineStatus() && gapi?.client?.getToken()) {
            try {
                console.log('🔄 [INVENTORY] Iniciando sincronización inmediata...');
                const syncResult = await syncInventoryData(false); // false = no mostrar notificaciones intermedias

                if (syncResult && syncResult.success) {
                    console.log('✅ [INVENTORY] Sincronización completada exitosamente');
                    syncSuccess = true;
                } else {
                    console.warn('⚠️ [INVENTORY] Sincronización pendiente - Los datos están en cola');
                }

            } catch (syncError) {
                console.error('❌ [INVENTORY] Error en sincronización inmediata:', syncError);
                console.warn('⚠️ [INVENTORY] Los datos permanecen en cola para sincronización posterior');
            }
        } else {
            console.warn('⚠️ [INVENTORY] Sin conexión o sin token - Datos guardados en cola');
        }

        // SOLO borrar los pallets DESPUÉS de guardar exitosamente en la cola
        console.log(`🧹 [INVENTORY] Limpiando tarima ${category} tras guardado exitoso`);
        STATE.pallets[category] = { boxes: [], id: generatePalletId(category.toUpperCase().slice(0, 3)) };
        document.getElementById(`location-${category}`).value = '';

        saveToStorage();
        updateUI();
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();
        playSound('success');

        // Mostrar UNA ÚNICA notificación consolidada
        if (syncSuccess) {
            showNotification(`✅ Tarima ${statusMap[category]} enviada: ${records.length} cajas sincronizadas`, 'success');
        } else {
            showNotification(`💾 Tarima ${statusMap[category]} guardada: ${records.length} cajas en cola de sincronización`, 'info');
        }

    } catch (error) {
        console.error('❌ [INVENTORY] Error crítico al procesar envío:', error);
        console.error('Detalles del error:', {
            message: error.message,
            stack: error.stack,
            type: error.constructor.name
        });

        showNotification(`❌ Error al procesar envío: ${error.message || 'Error desconocido'}`, 'error');

        // NO borrar los pallets si hubo error
        console.warn('⚠️ [INVENTORY] Tarima NO borrada debido a error - Los datos se preservan');

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
    // Usar sidebar component si está disponible
    if (sidebarComponent) {
        sidebarComponent.updateAvatarDisplay();
        return;
    }

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
    // Usar sidebar component si está disponible
    if (sidebarComponent) {
        sidebarComponent.updateBDInfo(STATE.inventory.size);
    } else {
        // Fallback
        const bdCount = document.getElementById('bd-count');
        const bdTime = document.getElementById('bd-update-time');

        if (bdCount) bdCount.textContent = STATE.inventory.size.toLocaleString();
        if (bdTime) bdTime.textContent = STATE.inventoryLastUpdate || getTimestamp();
    }
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
    // Recolectar todos los datos de todas las pestañas
    const allData = [];
    
    GlobalTabs.tabs.forEach(tab => {
        if (tab.type === 'classic') {
            ['ok', 'blocked', 'nowms'].forEach(cat => {
                const boxes = tab.data.pallets[cat].boxes || [];
                boxes.forEach(box => {
                    allData.push({
                        tab: tab.name,
                        date: getCurrentDate(),
                        time: box.timestamp || '',
                        user: STATE.userAlias || STATE.userName || 'Usuario',
                        scan1: box.code || box.scan1 || '',
                        scan2: box.scan2 || '',
                        location: box.location || '-',
                        status: cat === 'ok' ? 'OK' : cat === 'blocked' ? 'BLOQUEADO' : 'NO WMS',
                        sku: box.sku || '-',
                        product: box.product || '-',
                        pallet: tab.data.pallets[cat].id || '-',
                        originLocation: tab.data.originLocation || ''
                    });
                });
            });
        } else if (tab.type === 'unified') {
            const items = tab.data.items || [];
            items.forEach(item => {
                allData.push({
                    tab: tab.name,
                    date: getCurrentDate(),
                    time: item.timestamp || '',
                    user: STATE.userAlias || STATE.userName || 'Usuario',
                    scan1: item.code || '',
                    scan2: '',
                    location: item.location || '-',
                    status: item.statusText || item.status || '-',
                    sku: item.sku || '-',
                    product: item.product || '-',
                    pallet: '-',
                    originLocation: tab.data.originLocation || ''
                });
            });
        }
    });

    if (allData.length === 0) {
        showNotification('⚠️ No hay datos para exportar', 'warning');
        return;
    }

    const headers = ['PESTAÑA', 'FECHA', 'HORA', 'RESPONSABLE', 'SCAN 1', 'SCAN 2', 'UBICACION', 'ESTATUS', 'SKU', 'PRODUCTO', 'PALLET', 'ORIGEN'];
    const rows = allData.map(r => [
        r.tab, r.date, r.time, r.user, r.scan1, r.scan2, r.location, r.status, r.sku, r.product, r.pallet, r.originLocation
    ]);

    const csvContent = arrayToCSV([headers, ...rows]);
    downloadCSV(csvContent, `inventario_${getCurrentDate()}_${getCurrentTime().replace(/:/g, '-')}.csv`);
    showNotification(`✅ ${allData.length} registros exportados`, 'success');
    playSound('success');
}

// ==================== SISTEMA DE ALIAS ====================
function showAliasPopup() {
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 450px; width: 90%;">
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

    // Usar sidebar component si está disponible
    if (sidebarComponent) {
        const result = sidebarComponent.setUserName(alias);
        if (!result.success) {
            showNotification(`⚠️ ${result.message}`, 'warning');
            return;
        }
        STATE.userAlias = result.formatted;
    } else {
        STATE.userAlias = alias;
        localStorage.setItem('wms_user_alias', alias);
    }

    document.querySelectorAll('.popup-overlay').forEach(el => el.remove());
    updateUserDisplay();

    showNotification(`✅ Nombre actualizado: ${STATE.userAlias}`, 'success');
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
        <div class="popup-content" style="max-width: 400px; width: 90%;">
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

// ==================== MODAL DE RESUMEN AVANZADO ====================
let allRecordsModalSort = { column: 'timestamp', direction: 'desc' };
let allRecordsModalFilter = { code: '', location: '', pallet: '', status: '' };

function showAllRecordsModal() {
    // Recolectar todos los registros de todas las pestañas
    const allRecords = [];
    
    GlobalTabs.tabs.forEach(tab => {
        if (tab.type === 'classic') {
            ['ok', 'blocked', 'nowms'].forEach(cat => {
                const boxes = tab.data.pallets[cat].boxes || [];
                boxes.forEach((box, index) => {
                    allRecords.push({
                        tabId: tab.id,
                        tabName: tab.name,
                        tabType: tab.type,
                        category: cat,
                        index: index,
                        code: box.code || box.scan1 || '',
                        scan2: box.scan2 || '',
                        location: box.location || '-',
                        status: cat === 'ok' ? 'OK' : cat === 'blocked' ? 'BLOQUEADO' : 'NO WMS',
                        sku: box.sku || '-',
                        product: box.product || '-',
                        pallet: tab.data.pallets[cat].id || '-',
                        originLocation: tab.data.originLocation || '-',
                        timestamp: box.timestamp || '',
                        verified: box.verified || false
                    });
                });
            });
        } else if (tab.type === 'unified') {
            const items = tab.data.items || [];
            items.forEach((item, index) => {
                allRecords.push({
                    tabId: tab.id,
                    tabName: tab.name,
                    tabType: tab.type,
                    category: item.status,
                    index: index,
                    code: item.code || '',
                    scan2: '',
                    location: item.location || '-',
                    status: item.statusText || item.status || '-',
                    sku: item.sku || '-',
                    product: item.product || '-',
                    pallet: '-',
                    originLocation: tab.data.originLocation || '-',
                    timestamp: item.timestamp || '',
                    verified: false
                });
            });
        }
    });

    if (allRecords.length === 0) {
        showNotification('⚠️ No hay registros para mostrar', 'warning');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.id = 'all-records-modal';
    overlay.innerHTML = `
        <div class="popup-content pallet-detail-modal-large" style="max-width: 95vw; max-height: 90vh;">
            <button class="popup-close-corner" onclick="this.closest('.popup-overlay').remove()">×</button>
            <div class="pallet-detail-header" style="border-bottom: 3px solid var(--primary);">
                <div class="pallet-detail-title">
                    <span class="pallet-category-name" style="color: var(--primary);">
                        📋 Todos los Registros
                    </span>
                    <span class="pallet-count" id="all-records-count">${allRecords.length} registros</span>
                </div>
            </div>
            
            <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap;">
                <input type="text" class="scan-input" style="flex: 1; min-width: 150px; font-size: 0.9em; padding: 8px;"
                       placeholder="🔍 Filtrar código..." id="all-filter-code" onkeyup="filterAllRecordsModal()">
                <input type="text" class="scan-input" style="flex: 1; min-width: 150px; font-size: 0.9em; padding: 8px;"
                       placeholder="📍 Filtrar ubicación..." id="all-filter-location" onkeyup="filterAllRecordsModal()">
                <input type="text" class="scan-input" style="flex: 1; min-width: 150px; font-size: 0.9em; padding: 8px;"
                       placeholder="📦 Filtrar pallet..." id="all-filter-pallet" onkeyup="filterAllRecordsModal()">
                <select class="scan-input" style="flex: 0.5; min-width: 120px; font-size: 0.9em; padding: 8px;"
                        id="all-filter-status" onchange="filterAllRecordsModal()">
                    <option value="">Todos los estados</option>
                    <option value="OK">✅ OK</option>
                    <option value="BLOQUEADO">⚠️ Bloqueado</option>
                    <option value="NO WMS">❌ No WMS</option>
                </select>
                <button class="btn btn-small btn-secondary" onclick="clearAllRecordsFilters()">Limpiar</button>
            </div>

            <div style="display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; padding: 10px; background: #f5f5f5; border-radius: 6px;">
                <button class="btn btn-primary btn-small" onclick="syncDatabaseFromModal()" style="flex: 1;">
                    🔄 Sincronizar Bases
                </button>
                <button class="btn btn-warning btn-small" onclick="openAjusteFromModal()" style="flex: 1;">
                    🔧 Ajuste
                </button>
            </div>
            
            <div style="max-height: 450px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">
                    <thead>
                        <tr style="background: #f5f5f5; position: sticky; top: 0; z-index: 10;">
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('tabName')">Pestaña ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('code')">Código ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('scan2')">Código 2 ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('location')">Ubicación ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('status')">Estado ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('pallet')">Pallet ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('originLocation')">Origen ↕</th>
                            <th style="padding: 8px; text-align: left; cursor: pointer;" onclick="sortAllRecordsModal('timestamp')">Hora ↕</th>
                        </tr>
                    </thead>
                    <tbody id="all-records-table-body"></tbody>
                </table>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Store records in window for filtering/sorting
    window.ALL_RECORDS_DATA = allRecords;
    
    renderAllRecordsTable();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function renderAllRecordsTable() {
    const tbody = document.getElementById('all-records-table-body');
    if (!tbody || !window.ALL_RECORDS_DATA) return;

    let filtered = [...window.ALL_RECORDS_DATA];

    // Apply filters
    if (allRecordsModalFilter.code) {
        const s = allRecordsModalFilter.code.toUpperCase();
        filtered = filtered.filter(r => 
            r.code.toUpperCase().includes(s) || 
            (r.scan2 && r.scan2.toUpperCase().includes(s))
        );
    }
    if (allRecordsModalFilter.location) {
        const s = allRecordsModalFilter.location.toUpperCase();
        filtered = filtered.filter(r => r.location.toUpperCase().includes(s));
    }
    if (allRecordsModalFilter.pallet) {
        const s = allRecordsModalFilter.pallet.toUpperCase();
        filtered = filtered.filter(r => r.pallet.toUpperCase().includes(s));
    }
    if (allRecordsModalFilter.status) {
        filtered = filtered.filter(r => r.status === allRecordsModalFilter.status);
    }

    // Apply sorting
    filtered.sort((a, b) => {
        let valA = a[allRecordsModalSort.column];
        let valB = b[allRecordsModalSort.column];
        
        if (typeof valA === 'string') {
            return allRecordsModalSort.direction === 'asc' 
                ? valA.localeCompare(valB) 
                : valB.localeCompare(valA);
        }
        return allRecordsModalSort.direction === 'asc' ? valA - valB : valB - valA;
    });

    // Update count
    const countEl = document.getElementById('all-records-count');
    if (countEl) {
        countEl.textContent = `${filtered.length} de ${window.ALL_RECORDS_DATA.length} registros`;
    }

    // Render rows
    tbody.innerHTML = filtered.map((record, i) => {
        const statusColor = record.status === 'OK' ? 'var(--success)' : 
                           record.status === 'BLOQUEADO' ? 'var(--blocked)' : 
                           'var(--error)';
        const style = record.verified ? 'background: rgba(76, 175, 80, 0.1);' : '';

        return `
            <tr style="${style} border-bottom: 1px solid #eee;">
                <td style="padding: 8px;">
                    <span style="background: #e3f2fd; padding: 2px 6px; border-radius: 4px; font-size: 0.85em;">
                        ${record.tabName}
                    </span>
                </td>
                <td style="padding: 8px; font-family: monospace; font-weight: 600;">${record.code}</td>
                <td style="padding: 8px; font-family: monospace;">${record.scan2 || '-'}</td>
                <td style="padding: 8px;">${record.location}</td>
                <td style="padding: 8px;">
                    <span style="color: ${statusColor}; font-weight: 600;">${record.status}</span>
                </td>
                <td style="padding: 8px; font-family: monospace; font-size: 0.8em;">${record.pallet}</td>
                <td style="padding: 8px;">${record.originLocation}</td>
                <td style="padding: 8px; font-size: 0.85em;">${record.timestamp}</td>
            </tr>
        `;
    }).join('');

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #999;">No se encontraron registros con los filtros aplicados</td></tr>';
    }
}

function sortAllRecordsModal(column) {
    if (allRecordsModalSort.column === column) {
        allRecordsModalSort.direction = allRecordsModalSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        allRecordsModalSort.column = column;
        allRecordsModalSort.direction = 'asc';
    }
    renderAllRecordsTable();
}

function filterAllRecordsModal() {
    allRecordsModalFilter.code = document.getElementById('all-filter-code')?.value || '';
    allRecordsModalFilter.location = document.getElementById('all-filter-location')?.value || '';
    allRecordsModalFilter.pallet = document.getElementById('all-filter-pallet')?.value || '';
    allRecordsModalFilter.status = document.getElementById('all-filter-status')?.value || '';
    renderAllRecordsTable();
}

function clearAllRecordsFilters() {
    document.getElementById('all-filter-code').value = '';
    document.getElementById('all-filter-location').value = '';
    document.getElementById('all-filter-pallet').value = '';
    document.getElementById('all-filter-status').value = '';
    allRecordsModalFilter = { code: '', location: '', pallet: '', status: '' };
    renderAllRecordsTable();
}

async function syncDatabaseFromModal() {
    if (!syncManager) {
        showNotification('⚠️ Sistema de sincronización no disponible', 'warning');
        return;
    }

    const confirmed = confirm('¿Deseas sincronizar la base de datos con Google Sheets?');
    if (!confirmed) return;

    try {
        showLoading(true);
        await syncManager.sync();
        showNotification('✅ Base de datos sincronizada correctamente', 'success');
        playSound('success');
    } catch (error) {
        console.error('Error syncing:', error);
        showNotification('❌ Error al sincronizar', 'error');
    } finally {
        showLoading(false);
    }
}

async function openAjusteFromModal() {
    // Cerrar el modal de todos los registros
    document.getElementById('all-records-modal')?.remove();

    // Solicitar ubicación para buscar pallets
    const location = prompt('🔍 Ingresa la ubicación para buscar pallets:\n\nEjemplo: A1-12-03-02');
    
    if (!location || !location.trim()) {
        showNotification('❌ Operación cancelada', 'info');
        return;
    }

    const normalizedLocation = location.trim().toUpperCase();

    try {
        showLoading(true);

        // Buscar pallets en Google Sheets
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: `${CONFIG.SHEET_NAME}!A:J`
        });

        const rows = response.result.values || [];
        
        // Filtrar por ubicación (columna F, índice 5)
        const matchingRows = rows.filter((row, index) => {
            if (index === 0) return false; // Skip header
            return row[5] && row[5].toUpperCase() === normalizedLocation;
        });

        if (matchingRows.length === 0) {
            showNotification(`❌ No se encontraron pallets en: ${normalizedLocation}`, 'warning');
            showLoading(false);
            return;
        }

        // Agrupar por pallet
        const palletGroups = {};
        matchingRows.forEach(row => {
            const palletCode = row[8] || 'SIN-PALLET';
            if (!palletGroups[palletCode]) {
                palletGroups[palletCode] = {
                    palletCode: palletCode,
                    boxes: [],
                    location: row[5]
                };
            }
            palletGroups[palletCode].boxes.push(row);
        });

        showLoading(false);

        // Mostrar selector de pallet
        showPalletSelectorModal(palletGroups, normalizedLocation);

    } catch (error) {
        console.error('Error searching pallets:', error);
        showNotification('❌ Error al buscar pallets', 'error');
        showLoading(false);
    }
}

function showPalletSelectorModal(palletGroups, location) {
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay show';
    overlay.innerHTML = `
        <div class="popup-content" style="max-width: 750px; width: 90%; max-height: 85vh; overflow-y: auto;">
            <button class="popup-close-corner" onclick="this.closest('.popup-overlay').remove()">×</button>
            <div class="popup-header-centered">
                <span class="popup-header-icon">🔧</span>
                <h2>Seleccionar Pallet para Ajuste</h2>
            </div>
            <p style="text-align: center; color: #666; margin-bottom: 20px;">
                Ubicación: <strong>${location}</strong> • ${Object.keys(palletGroups).length} pallet(s) encontrado(s)
            </p>
            <div style="display: grid; gap: 15px;">
                ${Object.values(palletGroups).map(group => `
                    <div class="pallet-selector-card" onclick="loadPalletForAdjustment('${group.palletCode}', '${location}')" 
                         style="border: 2px solid #e0e0e0; border-radius: 10px; padding: 15px; cursor: pointer; transition: all 0.2s; background: white;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <div style="font-size: 1.1em; font-weight: 700; color: var(--primary); font-family: monospace;">
                                ${group.palletCode}
                            </div>
                            <div style="background: var(--primary); color: white; padding: 4px 10px; border-radius: 12px; font-size: 0.85em; font-weight: 600;">
                                ${group.boxes.length} cajas
                            </div>
                        </div>
                        <div style="font-size: 0.85em; color: #666;">
                            📍 ${group.location}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div style="margin-top: 20px;">
                <button class="btn btn-secondary btn-full" onclick="this.closest('.popup-overlay').remove()">
                    Cancelar
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Add hover effect
    overlay.querySelectorAll('.pallet-selector-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.borderColor = 'var(--primary)';
            card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
            card.style.transform = 'translateY(-2px)';
        });
        card.addEventListener('mouseleave', () => {
            card.style.borderColor = '#e0e0e0';
            card.style.boxShadow = 'none';
            card.style.transform = 'translateY(0)';
        });
    });
}

async function loadPalletForAdjustment(palletCode, location) {
    // Cerrar modal de selección
    document.querySelectorAll('.popup-overlay').forEach(el => el.remove());

    const confirmed = confirm(`¿Cargar pallet ${palletCode} para ajuste?\n\nNOTA: Sin restricción de contraseña en este módulo.`);
    if (!confirmed) return;

    try {
        showLoading(true);

        // Obtener todas las cajas del pallet
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_WRITE,
            range: `${CONFIG.SHEET_NAME}!A:J`
        });

        const rows = response.result.values || [];
        const palletBoxes = rows.filter((row, index) => {
            if (index === 0) return false;
            return row[8] === palletCode && row[5] && row[5].toUpperCase() === location.toUpperCase();
        });

        if (palletBoxes.length === 0) {
            showNotification('❌ No se encontraron cajas para este pallet', 'error');
            showLoading(false);
            return;
        }

        // Verificar si hay datos sin guardar
        const hasUnsavedData = GlobalTabs.tabs.some(tab => {
            if (tab.type === 'classic') {
                return tab.data.pallets.ok.boxes.length > 0 ||
                       tab.data.pallets.blocked.boxes.length > 0 ||
                       tab.data.pallets.nowms.boxes.length > 0;
            }
            return tab.data.items && tab.data.items.length > 0;
        });

        if (hasUnsavedData) {
            const proceed = confirm('⚠️ Hay datos sin guardar en las pestañas actuales.\n\n¿Deseas continuar? Se creará una nueva pestaña para el ajuste.');
            if (!proceed) {
                showLoading(false);
                return;
            }
        }

        // Crear nueva pestaña para el ajuste
        GlobalTabs.createTab('classic');
        
        // Esperar a que se cree la pestaña
        await new Promise(resolve => setTimeout(resolve, 100));

        // Limpiar las secciones actuales
        STATE.pallets.ok.boxes = [];
        STATE.pallets.blocked.boxes = [];
        STATE.pallets.nowms.boxes = [];

        // Cargar cajas del pallet
        const firstBox = palletBoxes[0];
        const originLocation = firstBox[9] || '';

        palletBoxes.forEach(row => {
            const status = row[6] || '';
            const box = {
                code: row[3],
                scan1: row[3],
                scan2: row[4] || '',
                location: row[5],
                sku: '-',
                product: '-',
                timestamp: getTimestamp(),
                verified: false,
                adjustmentMode: true
            };

            if (status.includes('OK') && !status.includes('BLOQUEADO')) {
                STATE.pallets.ok.boxes.push(box);
            } else if (status.includes('BLOQUEADO')) {
                STATE.pallets.blocked.boxes.push(box);
            } else {
                STATE.pallets.nowms.boxes.push(box);
            }
        });

        // Configurar IDs y ubicaciones
        STATE.pallets.ok.id = palletCode;
        STATE.pallets.blocked.id = palletCode;
        STATE.pallets.nowms.id = palletCode;

        document.getElementById('location-ok').value = location;
        document.getElementById('location-blocked').value = location;
        document.getElementById('location-nowms').value = location;
        document.getElementById('origin-location').value = originLocation;

        updateUI();
        GlobalTabs.saveToStorage();
        updateGlobalSummaryFromTabs();

        showLoading(false);
        showNotification(`✅ Pallet ${palletCode} cargado para ajuste (${palletBoxes.length} cajas)`, 'success');
        playSound('success');

    } catch (error) {
        console.error('Error loading pallet:', error);
        showNotification('❌ Error al cargar pallet', 'error');
        showLoading(false);
    }
}

// ==================== CONEXIÓN/DESCONEXIÓN GOOGLE ====================
async function toggleGoogleConnection() {
    const token = gapi?.client?.getToken();
    const connectBtn = document.getElementById('btn-google-connect');
    const connectText = document.getElementById('google-connect-text');

    if (token) {
        // Desconectar - Solo revocar en memoria, NO borrar tokens de localStorage
        if (confirm('¿Desconectar de Google?\n\nLos datos no sincronizados se guardarán localmente.\nPodrás reconectar sin perder tu sesión.')) {
            try {
                google.accounts.oauth2.revoke(token.access_token);
            } catch (e) {
                console.warn('⚠️ No se pudo revocar token:', e);
            }
            gapi.client.setToken('');

            // IMPORTANTE: NO borrar tokens de localStorage aquí
            // Solo se borran en logout completo
            // Esto permite reconectar sin pedir credenciales de nuevo

            if (syncManager) {
                syncManager.stopAutoSync();
            }

            if (sidebarComponent) {
                sidebarComponent.clearGoogleConnection();
            }

            if (connectBtn) connectBtn.classList.add('disconnected');
            if (connectText) connectText.textContent = 'Desconectado';

            updateConnectionStatus(false);
            showNotification('🔌 Desconectado de Google. Reconecta para sincronizar.', 'info');
        }
    } else {
        // CONECTAR - Usar AuthManager para renovar token
        console.log('🔗 [INVENTORY] Iniciando conexión con Google...');

        // Verificar si hay token guardado válido en AuthManager
        const savedToken = localStorage.getItem('google_access_token');
        const tokenExpiry = localStorage.getItem('google_token_expiry');

        if (savedToken && tokenExpiry) {
            const expiryTime = parseInt(tokenExpiry, 10);
            const now = Date.now();

            // Si el token aún es válido, restaurarlo directamente
            if (expiryTime > now + (60 * 1000)) { // Margen de 1 minuto
                console.log('🔄 [INVENTORY] Restaurando token desde AuthManager...');
                try {
                    gapi.client.setToken({ access_token: savedToken });

                    // Verificar que el token funcione
                    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                        headers: { Authorization: `Bearer ${savedToken}` }
                    });

                    if (response.ok) {
                        console.log('✅ [INVENTORY] Token restaurado exitosamente');

                        if (syncManager) {
                            syncManager.startAutoSync();
                            await syncManager.sync();
                        }

                        if (sidebarComponent) {
                            const ttl = Math.floor((expiryTime - now) / 1000);
                            sidebarComponent.saveGoogleConnection(savedToken, ttl);
                        }

                        if (connectBtn) connectBtn.classList.remove('disconnected');
                        if (connectText) connectText.textContent = 'Conectado';

                        updateConnectionStatus(true);
                        showNotification('✅ Reconectado a Google', 'success');
                        playSound('success');
                        return;
                    }
                } catch (e) {
                    console.warn('⚠️ [INVENTORY] Token guardado inválido, solicitando nuevo...');
                }
            }
        }

        // Si no hay token válido, usar AuthManager para renovar
        console.log('🔄 [INVENTORY] Solicitando renovación de token...');

        try {
            // Intentar renovación silenciosa primero
            await new Promise((resolve, reject) => {
                AuthManager.tokenClient.callback = async (resp) => {
                    if (resp.error) {
                        console.error('❌ Error renovando token:', resp);
                        reject(resp.error);
                        return;
                    }

                    const token = gapi.client.getToken();
                    if (token) {
                        if (syncManager) {
                            syncManager.startAutoSync();
                            await syncManager.sync();
                        }

                        if (sidebarComponent) {
                            sidebarComponent.saveGoogleConnection(token.access_token, 3600);
                        }

                        if (connectBtn) connectBtn.classList.remove('disconnected');
                        if (connectText) connectText.textContent = 'Conectado';

                        updateConnectionStatus(true);
                        showNotification('✅ Reconectado a Google', 'success');
                        playSound('success');

                        resolve();
                    } else {
                        reject('No se obtuvo token');
                    }
                };

                AuthManager.tokenClient.requestAccessToken({ prompt: '' });
            });
        } catch (error) {
            console.error('❌ [INVENTORY] Error al reconectar:', error);
            showNotification('❌ Error al reconectar. Intenta cerrar sesión y volver a entrar.', 'error');
        }
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
window.showAliasPopup = showAliasPopup;
window.saveUserAlias = saveUserAlias;
window.toggleGoogleConnection = toggleGoogleConnection;
window.showCountValidationModal = showCountValidationModal;
window.validateAndSendPallet = validateAndSendPallet;
window.executeSendPallet = executeSendPallet;
window.showAllRecordsModal = showAllRecordsModal;
window.sortAllRecordsModal = sortAllRecordsModal;
window.filterAllRecordsModal = filterAllRecordsModal;
window.clearAllRecordsFilters = clearAllRecordsFilters;
window.syncDatabaseFromModal = syncDatabaseFromModal;
window.openAjusteFromModal = openAjusteFromModal;
