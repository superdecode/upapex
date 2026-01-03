// Script de prueba para verificar el parsing del CSV
const https = require('https');

const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS-HG8HPf-94Ki5Leo5iEF5pyqsiD9CVk-mcl-F8BAw34kT0s3nzNn532YTYDCtkG76NbauiVx0Ffmd/pub?output=csv';

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

https.get(CSV_URL, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        const lines = data.split('\n');
        console.log('=== HEADERS ===');
        console.log(parseCSVLine(lines[0]));
        console.log('\n=== Buscando código 49162343 ===');
        
        let found = 0;
        for (let i = 1; i < lines.length && found < 5; i++) {
            if (lines[i].includes('49162343')) {
                const parsed = parseCSVLine(lines[i]);
                console.log(`\nLínea ${i}:`);
                console.log('Raw:', lines[i].substring(0, 200));
                console.log('Parsed:', parsed);
                console.log('Columna A (código):', parsed[0]);
                console.log('Columna B (SKU):', parsed[1]);
                found++;
            }
        }
        
        if (found === 0) {
            console.log('No se encontró el código 49162343');
        }
    });
}).on('error', (err) => {
    console.error('Error:', err.message);
});
