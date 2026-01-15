/**
 * SCRIPT DE LIMPIEZA DE LOCALSTORAGE
 *
 * INSTRUCCIONES:
 * 1. Abrir el validador en el navegador
 * 2. Abrir DevTools (F12)
 * 3. Ir a la pestaña "Console"
 * 4. Copiar y pegar todo este código
 * 5. Presionar Enter
 *
 * Este script limpiará el localStorage para liberar espacio
 */

(function() {
    console.log('🧹 Iniciando limpieza de localStorage...');

    // Contar tamaño actual
    let totalSize = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            totalSize += localStorage[key].length + key.length;
        }
    }

    console.log(`📊 Tamaño actual de localStorage: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log(`📊 Items en localStorage: ${localStorage.length}`);

    // Listar todas las keys
    console.log('\n📋 Keys encontradas:');
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const size = localStorage[key].length;
        console.log(`  - ${key}: ${(size / 1024).toFixed(2)} KB`);
    }

    // Eliminar BD vieja (ya no se usa)
    const keysToRemove = ['wms_validador_bd'];

    console.log('\n🗑️ Eliminando keys obsoletas...');
    keysToRemove.forEach(key => {
        if (localStorage.getItem(key)) {
            const size = localStorage.getItem(key).length;
            localStorage.removeItem(key);
            console.log(`  ✅ Eliminado: ${key} (${(size / 1024).toFixed(2)} KB liberados)`);
        }
    });

    // Verificar espacio liberado
    totalSize = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            totalSize += localStorage[key].length + key.length;
        }
    }

    console.log(`\n✅ Limpieza completada!`);
    console.log(`📊 Nuevo tamaño de localStorage: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log(`📊 Nuevo número de items: ${localStorage.length}`);
    console.log('\n💡 Ahora recarga la página para que los cambios surtan efecto');
})();
