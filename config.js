// Configuración global de la app Revolico GTM
// Cambia GIST_ID por el ID real de tu Gist (ej: 'abc123def456')

const CONFIG = {
    GIST_ID: 'TU_GIST_ID_AQUI',  // ID del Gist para database.json
    GIST_FILE: 'database.json',  // Nombre del archivo en el Gist
    POLL_INTERVAL: 30000,        // Intervalo de polling en ms (30 segundos)
    ADMIN_USER: 'admin',         // Usuario master inicial
    ADMIN_PASS_INICIAL: 'admin123'  // Contraseña inicial (se guarda hasheada en DB)
};

// Expone CONFIG globalmente para otros scripts
window.CONFIG = CONFIG;
