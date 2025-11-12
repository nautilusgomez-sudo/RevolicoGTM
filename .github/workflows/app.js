// Lógica principal de Revolico GTM
// Maneja carga de DB desde Gist, polling, búsqueda, pedidos y admin
// Actualizado para Opción 1: Token encriptado en database.json con CryptoJS

const { GIST_ID, GIST_FILE, POLL_INTERVAL, ADMIN_USER, ADMIN_PASS_INICIAL, CLAVE_MAESTRA } = window.CONFIG;
let database = {};  // Cache local de la DB
let ultimoTimestamp = null;  // Para polling
let tokenAdmin = null;  // Token GitHub desencriptado (de DB)

// Función para encriptar token (usa AES de CryptoJS)
function encriptarToken(token, clave) {
    return CryptoJS.AES.encrypt(token, clave).toString();
}

// Función para desencriptar token
function desencriptarToken(tokenEncriptado, clave) {
    try {
        const bytes = CryptoJS.AES.decrypt(tokenEncriptado, clave);
        const tokenDesencriptado = bytes.toString(CryptoJS.enc.Utf8);
        return tokenDesencriptado ? tokenDesencriptado : null;
    } catch (error) {
        console.error('Error desencriptando token:', error);
        return null;
    }
}

// Función para cargar database.json desde Gist (lectura anónima)
async function cargarDatabase() {
    try {
        const urlRaw = `https://gist.githubusercontent.com/${GIST_ID}/raw/${GIST_FILE}`;
        const respuesta = await fetch(urlRaw);
        if (!respuesta.ok) throw new Error('Error al cargar Gist');
        database = await respuesta.json();
        
        // Desencriptar token si existe en DB
        if (database && database.admin && database.admin.tokenEncriptado) {
            tokenAdmin = desencriptarToken(database.admin.tokenEncriptado, CLAVE_MAESTRA);
            if (!tokenAdmin) {
                console.warn('Token inválido o clave maestra incorrecta. Reconfigura como admin.');
                tokenAdmin = null;
            }
        }
        return database;
    } catch (error) {
        console.error('Error cargando DB:', error);
        return null;
    }
}

// Función para actualizar Gist (solo admin, con token desencriptado)
async function actualizarDatabase(nuevaDB) {
    if (!tokenAdmin) {
        alert('Token no disponible. Configura como admin primero (login y token una vez).');
        return false;
    }
    try {
        // Para update, primero GET el Gist actual, luego PATCH
        const urlGist = `https://api.github.com/gists/${GIST_ID}`;
        const respuestaGet = await fetch(urlGist, {
            headers: { 'Authorization': `token ${tokenAdmin}` }
        });
        if (!respuestaGet.ok) throw new Error('Token inválido o sin permisos');
        const gistActual = await respuestaGet.json();
        
        const nuevoContenido = { ...gistActual, files: { [GIST_FILE]: { 
            content: JSON.stringify(nuevaDB, null, 2) 
        } } };
        
        const respuestaUpdate = await fetch(urlGist, {
            method: 'PATCH',
            headers: { 
                'Authorization': `token ${tokenAdmin}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(nuevoContenido)
        });
        
        if (respuestaUpdate.ok) {
            database = nuevaDB;
            database.ultimaActualizacion = new Date().toISOString();
            alert('DB actualizada exitosamente');
            return true;
        } else {
            throw new Error('Error actualizando Gist');
        }
    } catch (error) {
        console.error('Error actualizando:', error);
        alert('Error: ' + error.message + '. Verifica token.');
        return false;
    }
}

// Polling para notificaciones en tiempo real
function iniciarPolling(callback) {
    setInterval(async () => {
        const db = await cargarDatabase();
        if (db && db.ultimaActualizacion !== ultimoTimestamp) {
            ultimoTimestamp = db.ultimaActualizacion;
            database = db;
            if (callback) callback();  // Recarga UI
            if (Notification.permission === 'granted') {
                new Notification('Revolico GTM', { body: '¡Actualizaciones nuevas en productos!' });
            }
        }
    }, POLL_INTERVAL);
}

// ========== FUNCIONES PARA INDEX.HTML ==========

// Inicializar página principal
async function inicializarIndex() {
    await cargarDatabase();
    if (database) {
        ultimoTimestamp = database.ultimaActualizacion;
        poblarCategorias();
        renderizarContenido();
        iniciarPolling(renderizarContenido);
        Notification.requestPermission();
    }
}

// Poblar select de categorías únicas
function poblarCategorias() {
    const categorias = [...new Set(database.negocios.flatMap(n => n.productos.map(p => p.categoria)))];
    const select = document.getElementById('categoria');
    select.innerHTML = '<option value="">Todas las categorías</option>' + 
        categorias.map(cat => `<option value="${cat}">${cat}</option>`).join('');
}

// Renderizar lista de negocios/productos
function renderizarContenido() {
    const busqueda = document.getElementById('busqueda').value.toLowerCase();
    const categoria = document.getElementById('categoria').value;
    const ordenFecha = document.getElementById('fechaOrden').value;
    
    let productosFiltrados = database.negocios.flatMap(negocio => 
        negocio.productos.map(prod => ({ ...prod, negocioNombre: negocio.nombre, negocioDireccion: negocio.direccion, negocioId: negocio.id }))
    ).filter(prod => 
        (busqueda === '' || prod.nombre.toLowerCase().includes(busqueda) || prod.descripcion.toLowerCase().includes(busqueda)) &&
        (categoria === '' || prod.categoria === categoria)
    );
    
    // Ordenar por fecha
    if (ordenFecha === 'reciente') {
        productosFiltrados.sort((a, b) => new Date(b.fechaPublicacion) - new Date(a.fechaPublicacion));
    } else {
        productosFiltrados.sort((a, b) => new Date(a.fechaPublicacion) - new Date(b.fechaPublicacion));
    }
    
    const contenido = document.getElementById('contenido');
    contenido.innerHTML = productosFiltrados.map(prod => `
        <div class="col-md-4">
            <div class="card producto">
                <h5>${prod.nombre} - ${prod.negocioNombre}</h5>
                <p>${prod.descripcion}</p>
                <p>Precio: Q${prod.precio} | Stock: ${prod.stock} | Categoría: ${prod.categoria}</p>
                ${prod.esOferta ? '<span class="badge bg-warning">Oferta</span>' : ''}
                <p>Dirección: ${prod.negocioDireccion}</p>
                <button onclick="hacerPedido(${prod.negocioId}, [${prod.id}])" class="btn btn-primary">Pedir</button>
            </div>
        </div>
    `).join('');
}

// Función de búsqueda
function buscar() {
    renderizarContenido();
}

// Hacer pedido (redirige a pedido.html con params)
function hacerPedido(negocioId, productosIds) {
    const params = new URLSearchParams({ negocioId, productos: JSON.stringify(productosIds) });
    window.location.href = `pedido.html?${params}`;
}

// ========== FUNCIONES PARA PEDIDO.HTML ==========

// Cargar detalles del pedido
async function cargarDetallesPedido() {
    if (!window.pedidoData) return;
    await cargarDatabase();
    const negocio = database.negocios.find(n => n.id === parseInt(window.pedidoData.negocioId));
    const productos = window.pedidoData.productosIds.map(id => 
        negocio.productos.find(p => p.id === id)
    );
    
    const total = productos.reduce((sum, p) => sum + p.precio, 0);
    const precioDomicilio = negocio.precioDomicilio || 0;
    
    document.getElementById('detalles-pedido').innerHTML = `
        <h5>Negocio: ${negocio.nombre}</h5>
        <p>Productos: ${productos.map(p => p.nombre).join(', ')}</p>
        <p>Total: Q${total} ${precioDomicilio > 0 ? `+ Domicilio: Q${precioDomicilio}` : ''}</p>
    `;
    document.getElementById('pedido-negocio-id').value = window.pedidoData.negocioId;
}

// Toggle dirección para domicilio
function toggleDireccion() {
    const tipo = document.getElementById('tipo-entrega').value;
    document.getElementById('direccion-entrega-div').style.display = tipo === 'domicilio' ? 'block' : 'none';
}

// Enviar pedido (guarda en DB y notifica)
async function enviarPedido() {
    const pedido = {
        id: Date.now(),  // ID simple
        negocioId: parseInt(document.getElementById('pedido-negocio-id').value),
        productosIds: window.pedidoData.productosIds,
        tipoEntrega: document.getElementById('tipo-entrega').value,
        direccionEntrega: document.getElementById('tipo-entrega').value === 'domicilio' ? document.getElementById('direccion-entrega').value : null,
        usuarioEmail: document.getElementById('usuario-email').value,
        notas: document.getElementById('notas').value,
        fecha: new Date().toISOString()
    };
    
    database.pedidos.push(pedido);
    const exito = await actualizarDatabase(database);  // Usa token de DB
    if (exito || confirm('Sin token admin, pedido guardado local. ¿Continuar?')) {
        alert('¡Pedido enviado! Te contactaremos pronto.');
        window.history.back();  // Volver a index
    }
}

// ========== FUNCIONES PARA ADMIN.HTML ==========

// Inicializar admin
async function inicializarAdmin() {
    await cargarDatabase();
    if (localStorage.getItem('adminLogged')) {
        mostrarPanelAdmin();
        poblarNegociosSelect();
    }
}

// Login admin (verifica contra DB, hashea pass simple con btoa para demo)
// Actualizado: Maneja token una sola vez, encriptado en DB
async function loginAdmin() {
    const user = document.getElementById('admin-user').value;
    const pass = btoa(document.getElementById('admin-pass').value);  // Hash simple (no seguro)
    
    if (user === ADMIN_USER && (database.admin?.password === pass || pass === btoa(ADMIN_PASS_INICIAL))) {
        // Si no hay token en DB, pide una vez y encripta/guarda en Gist
        if (!database.admin.tokenEncriptado || !tokenAdmin) {
            const tokenIngresado = prompt('Ingresa tu Token GitHub (solo esta vez para todos los devices):');
            if (!tokenIngresado) {
                alert('Token requerido para continuar.');
                return;
            }
            const tokenEncriptado = encriptarToken(tokenIngresado, CLAVE_MAESTRA);
            database.admin.tokenEncriptado = tokenEncriptado;
            tokenAdmin = tokenIngresado;  // Cache para esta sesión
            const exito = await actualizarDatabase(database);  // Guarda en Gist para persistencia global
            if (!exito) {
                alert('Error guardando token. Intenta de nuevo.');
                return;
            }
            localStorage.setItem('adminLogged', 'true');
            alert('Token configurado exitosamente. Ahora disponible en todos los devices.');
        } else {
            // Si ya existe en DB, desencripta y usa
            tokenAdmin = desencriptarToken(database.admin.tokenEncriptado, CLAVE_MAESTRA);
            if (!tokenAdmin) {
                alert('Error desencriptando token. Reconfigura ingresando nuevo token.');
                return;
            }
            localStorage.setItem('adminLogged', 'true');
            alert('Login exitoso. Token cargado desde DB.');
        }
        // Actualiza pass si era inicial
        if (database.admin.password !== pass) {
            database.admin.password = pass;
            await actualizarDatabase(database);
        }
        mostrarPanelAdmin();
        poblarNegociosSelect();
    } else {
        alert('Credenciales incorrectas');
    }
}

// Mostrar/ocultar panel admin
function mostrarPanelAdmin() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    poblarListaNegocios();
}

// Logout
function logoutAdmin() {
    localStorage.removeItem('adminLogged');
    tokenAdmin = null;  // Limpia cache, pero DB retiene token
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('admin-panel').style.display = 'none';
}

// Poblar select de negocios
function poblarNegociosSelect() {
    const select = document.getElementById('negocio-select');
    select.innerHTML = database.negocios.map(n => `<option value="${n.id}">${n.nombre}</option>`).join('');
}

// Registrar negocio nuevo
async function registrarNegocio() {
    const nuevoNegocio = {
        id: Date.now(),
        nombre: document.getElementById('negocio-nombre').value,
        direccion: document.getElementById('negocio-direccion').value,
        precioDomicilio: parseFloat(document.getElementById('negocio-precio-domicilio').value) || 0,
        productos: [],
        fechaCreacion: new Date().toISOString()
    };
    database.negocios.push(nuevoNegocio);
    await actualizarDatabase(database);
    alert('Negocio registrado');
    poblarNegociosSelect();
    poblarListaNegocios();
    // Limpiar form
    document.getElementById('negocio-nombre').value = '';
    document.getElementById('negocio-direccion').value = '';
    document.getElementById('negocio-precio-domicilio').value = '';
}

// Agregar producto a negocio
async function agregarProducto() {
    const negocioId = parseInt(document.getElementById('negocio-select').value);
    const negocio = database.negocios.find(n => n.id === negocioId);
    if (!negocio) return alert('Selecciona un negocio');
    
    const nuevoProducto = {
        id: Date.now(),
        nombre: document.getElementById('producto-nombre').value,
        descripcion: document.getElementById('producto-descripcion').value,
        precio: parseFloat(document.getElementById('producto-precio').value),
        stock: parseInt(document.getElementById('producto-stock').value),
        categoria: document.getElementById('producto-categoria').value,
        esOferta: document.getElementById('es-oferta').checked,
        fechaPublicacion: new Date().toISOString()
    };
    
    negocio.productos.push(nuevoProducto);
    await actualizarDatabase(database);
    alert('Producto agregado');
    poblarListaNegocios();
    // Limpiar form
    document.querySelectorAll('#admin-panel input, #admin-panel select, #admin-panel textarea').forEach(el => el.value = '');
    document.getElementById('es-oferta').checked = false;
}

// Poblar lista de negocios en admin
function poblarListaNegocios() {
    const lista = document.getElementById('lista-negocios');
    lista.innerHTML = '<h5>Negocios Registrados</h5>' + 
        database.negocios.map(negocio => `
            <div class="card mb-2">
                <h6>${negocio.nombre} - ${negocio.direccion}</h6>
                <p>Precio domicilio: Q${negocio.precioDomicilio}</p>
                <h6>Productos:</h6>
                <ul>${negocio.productos.map(p => `<li>${p.nombre} - Q${p.precio} (${p.categoria}) - Stock: ${p.stock}</li>`).join('')}</ul>
            </div>
        `).join('');
}
