const CONFIG = {
    CLIENT_ID: '1013623813866-70ovrtt690fbka3a97h4fenpp54hm7j8.apps.googleusercontent.com',
    SPREADSHEET_BD: '1nKqd0mqEkZ1l8wqW83_d5fyarp5BKbV1nXSNJBk4-Ck',
    SPREADSHEET_WRITE: '1gU5yDb0R4_Mf1fE-lOA7vwYmTUBR0wV7EPGg5zUt2Xo',
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.profile'
};

const STATE = {
    database: new Map(),
    stats: {
        totalValidations: 0,
        validCodes: 0,
        invalidCodes: 0
    },
    sessionStats: {
        total: 0,
        valid: 0,
        invalid: 0
    }
};

let tokenClient;
let gapiInited = false;
let gisInited = false;

function initializeApp() {
    gapiLoaded();
    gisLoaded();
    loadStats();
    updateDashboard();
    autoLogin();
}

function gapiLoaded() {
    gapi.load('client', async () => {
        await gapi.client.init({
            discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
        });
        gapiInited = true;
    });
}

function gisLoaded() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope: CONFIG.SCOPES,
        callback: '',
    });
    gisInited = true;
}

function autoLogin() {
    if (!gapiInited || !gisInited) {
        setTimeout(autoLogin, 100);
        return;
    }

    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            console.error('Auth error:', resp);
            return;
        }
        await loadDatabase();
    };

    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
        tokenClient.requestAccessToken({prompt: ''});
    }
}

async function loadDatabase() {
    if (!gapi.client.getToken()) {
        showNotification('⚠️ Conecta primero con Google Sheets', 'warning');
        return;
    }

    showLoading(true);
    try {
        const resRes = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: CONFIG.SPREADSHEET_BD,
            range: 'Resumen!A:F'
        });

        const sheets = ['BD', 'Outbound_出库单', 'Sheet1'];
        for (const sheet of sheets) {
            try {
                const codesRes = await gapi.client.sheets.spreadsheets.values.get({
                    spreadsheetId: CONFIG.SPREADSHEET_BD,
                    range: `${sheet}!A:J`
                });

                const rows = codesRes.result.values;
                if (rows?.length > 1) {
                    STATE.database.clear();
                    
                    for (let i = 1; i < rows.length; i++) {
                        const code = rows[i][0];
                        if (code) {
                            STATE.database.set(code.toUpperCase(), {
                                code: code,
                                sku: rows[i][1] || '-',
                                productName: rows[i][2] || '-',
                                cellNo: rows[i][3] || '-',
                                status: rows[i][5] || 'OK'
                            });
                        }
                    }
                }
            } catch (e) {
                console.log(`Sheet ${sheet} no disponible:`, e);
            }
        }

        updateDashboard();
        showNotification(`✅ Base de datos cargada: ${STATE.database.size} códigos`, 'success');
    } catch (error) {
        console.error('Error loading database:', error);
        showNotification('❌ Error al cargar base de datos', 'error');
    } finally {
        showLoading(false);
    }
}

function startValidation() {
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('validation-screen').classList.remove('hidden');
    
    STATE.sessionStats = { total: 0, valid: 0, invalid: 0 };
    updateSessionStats();
    
    setTimeout(() => {
        document.getElementById('validation-input').focus();
    }, 100);

    setupValidationListeners();
}

function setupValidationListeners() {
    const input = document.getElementById('validation-input');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
            e.preventDefault();
            validateCode(input.value.trim());
            input.value = '';
        }
    });
}

function validateCode(rawCode) {
    const code = rawCode.toUpperCase();
    const result = STATE.database.get(code);
    
    STATE.sessionStats.total++;
    STATE.stats.totalValidations++;

    const resultDiv = document.getElementById('validation-result');
    
    if (result) {
        STATE.sessionStats.valid++;
        STATE.stats.validCodes++;
        
        resultDiv.className = 'validation-result show success';
        resultDiv.innerHTML = `
            <div style="font-size: 2em; margin-bottom: 10px;">✅</div>
            <div style="font-size: 1.2em; font-weight: 700; margin-bottom: 10px;">CÓDIGO VÁLIDO</div>
            <div style="font-size: 0.9em;">
                <strong>${code}</strong><br>
                ${result.productName}<br>
                📍 ${result.cellNo}
            </div>
        `;
        playSound('success');
    } else {
        STATE.sessionStats.invalid++;
        STATE.stats.invalidCodes++;
        
        resultDiv.className = 'validation-result show error';
        resultDiv.innerHTML = `
            <div style="font-size: 2em; margin-bottom: 10px;">❌</div>
            <div style="font-size: 1.2em; font-weight: 700; margin-bottom: 10px;">CÓDIGO NO ENCONTRADO</div>
            <div style="font-size: 0.9em;">
                <strong>${code}</strong><br>
                No existe en la base de datos
            </div>
        `;
        playSound('error');
    }

    updateSessionStats();
    saveStats();
}

function endValidation() {
    document.getElementById('validation-screen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    updateDashboard();
}

function updateDashboard() {
    document.getElementById('total-validations').textContent = STATE.stats.totalValidations;
    document.getElementById('valid-codes').textContent = STATE.stats.validCodes;
    document.getElementById('invalid-codes').textContent = STATE.stats.invalidCodes;
    document.getElementById('db-count').textContent = STATE.database.size;
}

function updateSessionStats() {
    document.getElementById('session-total').textContent = STATE.sessionStats.total;
    document.getElementById('session-valid').textContent = STATE.sessionStats.valid;
    document.getElementById('session-invalid').textContent = STATE.sessionStats.invalid;
}

function refreshDatabase() {
    loadDatabase();
}

function goToHome() {
    window.location.href = '../../index.html';
}

function saveStats() {
    localStorage.setItem('wms_validator_stats', JSON.stringify(STATE.stats));
}

function loadStats() {
    const saved = localStorage.getItem('wms_validator_stats');
    if (saved) {
        STATE.stats = JSON.parse(saved);
    }
}

function playSound(type) {
    const frequencies = { success: 800, error: 400 };
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    oscillator.frequency.value = frequencies[type] || 500;
    oscillator.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
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

window.addEventListener('load', initializeApp);
