// Configuración global de la app Revolico GTM
const CONFIG = {
    OWNER: 'nautilusgomez-sudo',  // Tu username GitHub (dueño del Gist)
    GIST_ID: '0fa357699d922bb270bccf7e5edceb1d', // ID del Gist para database.json
    GIST_FILE: 'database.json', // Nombre del archivo en el Gist
    POLL_INTERVAL: 30000, // Intervalo de polling en ms (30 segundos)
    ADMIN_USER: 'admin', // Usuario master inicial
    ADMIN_PASS_INICIAL: 'admin123', // Contraseña inicial (se guarda hasheada en DB)
    CLAVE_MAESTRA: 'miClaveSecretaGTM123' // Clave para encriptar/desencriptar token (¡CÁMBIALA y no la compartas!)
};
window.CONFIG = CONFIG;
