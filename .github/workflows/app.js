// Lógica principal de Revolico GTM
// Maneja carga de DB desde Gist, polling, búsqueda, pedidos y admin
// Actualizado para Opción 1: Token encriptado en database.json con CryptoJS
// Mejora: Inicializa estructura completa si Gist/DB está vacío o incompleto (POST si no existe, init en login)
// FIX: URL raw con OWNER + trim password + anti-crash

const { OWNER, GIST_ID, GIST_FILE, POLL_INTERVAL, ADMIN_USER, ADMIN_PASS_INICIAL, CLAVE_MAESTRA } = window.CONFIG;
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

// Función para cargar database.json desde Gist (lectura anónima) - FIX: Agrega OWNER a URL
async function cargarDatabase() {
    try {
        const urlRaw = `https://gist.githubusercontent.com/${OWNER}/${GIST_ID}/raw/${GIST_FILE}`;
        const respuesta = await fetch(urlRaw);
        if (!respuesta.ok) throw new Error(`Error al cargar Gist: ${respuesta.status} ${respuesta.statusText}`);
        let dbRaw = await respuesta.text();  // Lee como text primero para debug
        database = JSON.parse(dbRaw);
        
        // Trim espacios extra en password (de tu Gist actual)
        if (database.admin && database.admin.password) {
            database.admin.password = database.admin.password.trim();
        }
        
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
        // ANTI-CRASH: Inicializa DB mínima si falla
        database = {
            ultimaActualizacion: new Date().toISOString(),
            admin: { password: btoa(ADMIN_PASS_INICIAL), tokenEncriptado: "" },
            negocios: [],
            pedidos: []
        };
        return database;
    }
}

// Función para actualizar/crear Gist (solo admin, con token desencriptado)
async function actualizarDatabase(nuevaDB) {
    if (!tokenAdmin) {
        alert('Token no disponible. Configura como admin primero.');
        return false;
    }
    try {
        const urlGist = `https://api.github.com/gists/${GIST_ID}`;
        const respuestaGet = await fetch(urlGist, {
            headers: { 'Authorization': `token ${tokenAdmin}` }
        });
        
        let nuevoContenido;
        if (!respuestaGet.ok) {
            if (respuestaGet.status === 404) {
                nuevoContenido = {
                    description: 'DB de Revolico GTM',
                    public: true,
                    files: { [GIST_FILE]: { content: JSON.stringify(nuevaDB, null, 2) } }
                };
                const respuestaPost = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `token ${tokenAdmin}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(nuevoContenido)
                });
                if (!respuestaPost.ok) throw new Error('Error creando Gist nuevo: ' + respuestaPost.statusText);
                alert('Gist creado exitosamente (era nuevo).');
                database = nuevaDB;
                database.ultimaActualizacion = new Date().toISOString();
                return true;
            } else {
                throw new Error('Error accediendo a Gist: ' + respuestaGet.status + ' - ' + respuestaGet.statusText);
            }
        } else {
            const gistActual = await respuestaGet.json();
            nuevoContenido = { ...gistActual, files: { [GIST_FILE]: { 
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
            
            if (!respuestaUpdate.ok) throw new Error('Error actualizando Gist: ' + respuestaUpdate.statusText);
        }
        
        database = nuevaDB;
        database.ultimaActualizacion = new Date().toISOString();
        alert('DB actualizada exitosamente');
        return true;
    } catch (error) {
        console.error('Error actualizando/creando:', error);
        alert('Error: ' + error.message + '. Verifica token y GIST_ID.');
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
            if (callback) callback();
            if (Notification.permission === 'granted') {
                new Notification('Revolico GTM', { body: '¡Actualizaciones nuevas en productos!' });
            }
        }
    }, POLL_INTERVAL);
}

// ========== FUNCIONES PARA INDEX.HTML ==========

async function inicializarIndex() {
    await cargarDatabase();
    if (database && database.negocios !== undefined) {
        ultimoTimestamp = database.ultimaActualizacion;
        poblarCategorias();
        renderizarContenido();
        iniciarPolling(renderizarContenido);
        Notification.requestPermission();
    } else {
        document.getElementById('contenido').innerHTML = '<div class="col-12"><p class="alert alert-warning">Datos no disponibles. Configura el Gist en admin.</p></div>';
    }
}

function poblarCategorias() {
    const negocios = database.negocios || [];
    const categorias = [...new Set(negocios.flatMap(n => (n.productos || []).map(p => p.categoria)))];
    const select = document.getElementById('categoria');
    select.innerHTML = '<option value="">Todas las categorías</option>' + 
        categorias.map(cat => `<option value="${cat}">${cat}</option>`).join('');
}

function renderizarContenido() {
    const negocios = database.negocios || [];
    if (negocios.length === 0) {
        document.getElementById('contenido').innerHTML = '<div class="col-12"><p class="alert alert-info">No hay productos disponibles. Agrega algunos en admin.</p></div>';
        return;
    }
    
    const busqueda = document.getElementById('busqueda').value.toLowerCase();
    const categoria = document.getElementById('categoria').value;
    const ordenFecha = document.getElementById('fechaOrden').value;
    
    let productosFiltrados = negocios.flatMap(negocio => 
        (negocio.productos || []).map(prod => ({ ...prod, negocioNombre: negocio.nombre, negocioDireccion: negocio.direccion, negocioId: negocio.id }))
    ).filter(prod => 
        (busqueda === '' || prod.nombre.toLowerCase().includes(busqueda) || prod.descripcion.toLowerCase().includes(busqueda)) &&
        (categoria === '' || prod.categoria === categoria)
    );
    
    if (ordenFecha === 'reciente') {
        productosFiltrados.sort((a, b) => new Date(b.fechaPublicacion) - new Date(a.fechaPublicacion));
    } else {
        productosFiltrados.sort((a, b) => new Date(a.fechaPublicacion) - new Date(b.fechaPublicacion));
    }
    
    const contenido = document.getElementById('contenido');
    if (productosFiltrados.length === 0) {
        contenido.innerHTML = '<div class="col-12"><p class="alert alert-warning">No hay productos que coincidan con la búsqueda.</p></div>';
        return;
    }
    contenido.innerHTML = productosFiltrados.map(prod => `
        <div class="col-md-4">
            <div class="card producto">
                <h5>${prod.nombre} - ${prod.negocioNombre}</h5>
                <p>${prod.descripcion}</p>
                <p>Precio: Q${prod.precio} | Stock: ${prod.stock} | Categoría: ${prod.categoria}</p>
                ${prod.esOferta ? '<span class="badge bg-warning">Oferta</span>' : ''}
                <p>Dirección: ${prod.negocioDireccion}</p>
                <button onclick="hacerPedido($$ {prod.negocioId}, [ $${prod.id}])" class="btn btn-primary">Pedir</button>
            </div>
        </div>
    `).join('');
}

function buscar() {
    renderizarContenido();
}

function hacerPedido(negocioId, productosIds) {
    const params = new URLSearchParams({ negocioId, productos: JSON.stringify(productosIds) });
    window.location.href = `pedido.html?${params}`;
}

// ========== FUNCIONES PARA PEDIDO.HTML ==========

async function cargarDetallesPedido() {
    if (!window.pedidoData) return;
    await cargarDatabase();
    const negocios = database.negocios || [];
    if (negocios.length === 0) {
        alert('Datos no disponibles. Intenta más tarde.');
        return;
    }
    const negocio = negocios.find(n => n.id === parseInt(window.pedidoData.negocioId));
    if (!negocio) return alert('Negocio no encontrado.');
    
    const productos = window.pedidoData.productosIds.map(id => 
        (negocio.productos || []).find(p => p.id === id)
    ).filter(p => p);
    
    if (productos.length === 0) return alert('Productos no encontrados.');
    
    const total = productos.reduce((sum, p) => sum + p.precio, 0);
    const precioDomicilio = negocio.precioDomicilio || 0;
    
    document.getElementById('detalles-pedido').innerHTML = `
        <h5>Negocio: ${negocio.nombre}</h5>
        <p>Productos: ${productos.map(p => p.nombre).join(', ')}</p>
        <p>Total: Q${total} ${precioDomicilio > 0 ? `+ Domicilio: Q${precioDomicilio}` : ''}</p>
    `;
    document.getElementById('pedido-negocio-id').value = window.pedidoData.negocioId;
}

function toggleDireccion() {
    const tipo = document.getElementById('tipo-entrega').value;
    document.getElementById('direccion-entrega-div').style.display = tipo === 'domicilio' ? 'block' : 'none';
}

async function enviarPedido() {
    database.pedidos = database.pedidos || [];
    const pedido = {
        id: Date.now(),
        negocioId: parseInt(document.getElementById('pedido-negocio-id').value),
        productosIds: window.pedidoData.productosIds,
        tipoEntrega: document.getElementById('tipo-entrega').value,
        direccionEntrega: document.getElementById('tipo-entrega').value === 'domicilio' ? document.getElementById('direccion-entrega').value : null,
        usuarioEmail: document.getElementById('usuario-email').value,
        notas: document.getElementById('notas').value,
        fecha: new Date().toISOString()
    };
    
    database.pedidos.push(pedido);
    const exito = await actualizarDatabase(database);
    if (exito || confirm('Sin token admin, pedido guardado local. ¿Continuar?')) {
        alert('¡Pedido enviado! Te contactaremos pronto.');
        window.history.back();
    }
}

// ========== FUNCIONES PARA ADMIN.HTML ==========

async function inicializarAdmin() {
    await cargarDatabase();
    // Si DB incompleta, inicializa básica
    database.admin = database.admin || { password: btoa(ADMIN_PASS_INICIAL), tokenEncriptado: "" };
    database.ultimaActualizacion = database.ultimaActualizacion || new Date().toISOString();
    database.negocios = database.negocios || [];
    database.pedidos = database.pedidos || [];
    if (localStorage.getItem('adminLogged') && tokenAdmin) {
        mostrarPanelAdmin();
        poblarNegociosSelect();
    }
}

async function loginAdmin() {
    const user = document.getElementById('admin-user').value;
    const pass = btoa(document.getElementById('admin-pass').value);
    
    if (user === ADMIN_USER && (database.admin.password === pass || pass === btoa(ADMIN_PASS_INICIAL))) {
        if (!database.admin.tokenEncriptado || !tokenAdmin) {
            const tokenIngresado = prompt('Ingresa tu Token GitHub (solo esta vez para todos los devices):');
            if (!tokenIngresado) {
                alert('Token requerido para continuar.');
                return;
            }
            const tokenEncriptado = encriptarToken(tokenIngresado, CLAVE_MAESTRA);
            database.admin.tokenEncriptado = tokenEncriptado;
            tokenAdmin = tokenIngresado;
            
            if (database.negocios.length === 0) {
                database.negocios.push({
                    id: 1,
                    nombre: "Negocio Ejemplo 1",
                    direccion: "Guatemala City, Zona 1",
                    precioDomicilio: 15.00,
                    productos: [{
                        id: 1,
                        nombre: "Producto Ejemplo",
                        descripcion: "Descripción del producto con oferta especial.",
                        precio: 25.00,
                        stock: 100,
                        categoria: "Comida",
                        esOferta: true,
                        fechaPublicacion: new Date().toISOString()
                    }],
                    fechaCreacion: new Date().toISOString()
                });
            }
            
            const exito = await actualizarDatabase(database);
            if (!exito) {
                alert('Error guardando config inicial. Verifica token.');
                return;
            }
            localStorage.setItem('adminLogged', 'true');
            alert('Configuración inicial completada. Token y DB guardados.');
        } else {
            tokenAdmin = desencriptarToken(database.admin.tokenEncriptado, CLAVE_MAESTRA);
            if (!tokenAdmin) {
                alert('Error con token. Reconfigura.');
                return;
            }
            localStorage.setItem('adminLogged', 'true');
        }
        
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

function mostrarPanelAdmin() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('admin-panel').style.display = 'block';
    poblarListaNegocios();
}

function logoutAdmin() {
    localStorage.removeItem('adminLogged');
    tokenAdmin = null;
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('admin-panel').style.display = 'none';
}

function poblarNegociosSelect() {
    const select = document.getElementById('negocio-select');
    const negocios = database.negocios || [];
    select.innerHTML = negocios.map(n => `<option value="${n.id}">${n.nombre}</option>`).join('');
}

async function registrarNegocio() {
    database.negocios = database.negocios || [];
    const nuevoNegocio = {
        id: Date.now(),
        nombre: document.getElementById('negocio-nombre').value,
        direccion: document.getElementById('negocio-direccion').value,
        precioDomicilio: parseFloat(document.getElementById('negocio-precio-domicilio').value) || 0,
        productos: [],
        fechaCreacion: new Date().toISOString()
    };
    database.negocios.push(nuevoNegocio);
    const exito = await actualizarDatabase(database);
    if (exito) {
        alert('Negocio registrado');
        poblarNegociosSelect();
        poblarListaNegocios();
        document.getElementById('negocio-nombre').value = '';
        document.getElementById('negocio-direccion').value = '';
        document.getElementById('negocio-precio-domicilio').value = '';
    }
}

async function agregarProducto() {
    const negocioId = parseInt(document.getElementById('negocio-select').value);
    const negocio = (database.negocios || []).find(n => n.id === negocioId);
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
    
    negocio.productos = negocio.productos || [];
    negocio.productos.push(nuevoProducto);
    const exito = await actualizarDatabase(database);
    if (exito) {
        alert('Producto agregado');
        poblarListaNegocios();
        document.querySelectorAll('#admin-panel input, #admin-panel select, #admin-panel textarea').forEach(el => el.value = '');
        document.getElementById('es-oferta').checked = false;
    }
}

function poblarListaNegocios() {
    const lista = document.getElementById('lista-negocios');
    const negocios = database.negocios || [];
    lista.innerHTML = '<h5>Negocios Registrados</h5>' + 
        negocios.map(negocio => `
            <div class="card mb-2">
                <h6>${negocio.nombre} - ${negocio.direccion}</h6>
                <p>Precio domicilio: Q${negocio.precioDomicilio}</p>
                <h6>Productos:</h6>
                <ul>${(negocio.productos || []).map(p => `<li>${p.nombre} - Q${p.precio} (${p.categoria}) - Stock: ${p.stock}</li>`).join('')}</ul>
            </div>
        `).join('');
}
