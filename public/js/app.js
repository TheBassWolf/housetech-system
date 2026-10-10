/* HouseTech S.A.S. - Frontend web (todos los roles) */
const S = sessionStorage;
const token = S.getItem('ht_token');
const user = JSON.parse(S.getItem('ht_user') || 'null');
const ROLE = document.body.dataset.rol;
if (!token || !user || user.rol !== ROLE) { S.clear(); location.replace('index.html'); }

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$ ' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fdate = d => (d ? new Date(d).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const BC = { Pendiente: 'warn', Confirmado: 'ok', Cancelado: 'bad', Preparando: 'warn', 'En tránsito': 'info', Entregado: 'ok', Abierto: 'warn', 'En proceso': 'info', Resuelto: 'ok', Cerrado: 'gray', Activo: 'ok', Inactivo: 'bad' };
const badge = e => `<span class="badge ${BC[e] || 'gray'}">${esc(e)}</span>`;
const card = (t, b) => `<div class="card">${t ? `<h3>${esc(t)}</h3>` : ''}${b}</div>`;
const opts = (list, sel) => list.map(o => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');

async function api(path, { method = 'GET', body, raw } = {}) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { S.clear(); location.replace('index.html'); throw new Error('Sesión expirada'); }
  if (raw) { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).mensaje || 'Error'); return r; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.mensaje || 'Error inesperado');
  return d;
}
function toast(m, err) { const d = document.createElement('div'); if (err) d.className = 'e'; d.textContent = m; $('#toast').append(d); setTimeout(() => d.remove(), 4200); }
const run = async fn => { try { await fn(); } catch (e) { toast(e.message, true); } };

/* ---------- Modal ---------- */
function modal(title, html, wide) {
  closeModal();
  const o = document.createElement('div'); o.className = 'ov'; o.id = 'ov';
  o.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="mh"><h3>${esc(title)}</h3><button type="button" data-act="close" aria-label="Cerrar">×</button></div><div id="mb">${html}</div></div>`;
  o.addEventListener('mousedown', e => { if (e.target === o) closeModal(); });
  document.body.append(o); return $('#mb');
}
function closeModal() { $('#ov')?.remove(); }

/* ---------- Mapa (Leaflet + OpenStreetMap) ---------- */
const BOG = [4.7110, -74.0721];
const BODEGA = [4.6486, -74.1074]; // Punto de despacho (ajustar a la bodega real)
let maps = [];
function nuevoMapa(id, centro, zoom) {
  const m = L.map(id).setView(centro, zoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m);
  maps.push(m); setTimeout(() => m.invalidateSize(), 200); return m;
}
const limpiarMapas = () => { maps.forEach(m => m.remove()); maps = []; };
function selectorUbicacion(id, pos, onPick) {
  const m = nuevoMapa(id, pos ? [pos.lat, pos.lng] : BOG, pos ? 15 : 12);
  let mk = pos ? L.marker([pos.lat, pos.lng]).addTo(m) : null;
  const set = (la, ln) => { mk ? mk.setLatLng([la, ln]) : (mk = L.marker([la, ln]).addTo(m)); onPick(la, ln); };
  m.on('click', e => set(e.latlng.lat, e.latlng.lng));
  return { m, set };
}
function ordenForm(p) {
  return `<label>Dirección de entrega *</label><div style="display:flex;gap:8px"><input id="f-dir" value="${esc(p.direccion_entrega || '')}" placeholder="Calle, número, barrio, ciudad"><button type="button" class="btn sm" data-act="buscar-dir">Ubicar en mapa</button></div>
  <label>Marca el punto de entrega en el mapa (clic)</label><div id="pick" class="map sm"></div>
  <input type="hidden" id="f-lat" value="${p.lat ?? ''}"><input type="hidden" id="f-lng" value="${p.lng ?? ''}">
  <label>Notas para la entrega</label><textarea id="f-notas" rows="2" maxlength="255">${esc(p.notas || '')}</textarea>`;
}
let picker = null;
function iniciarPicker(p) {
  picker = selectorUbicacion('pick', p.lat != null ? { lat: +p.lat, lng: +p.lng } : null, (la, ln) => { $('#f-lat').value = la.toFixed(6); $('#f-lng').value = ln.toFixed(6); });
}
async function buscarDireccion() {
  const t = $('#f-dir').value.trim(); if (!t) return toast('Escribe una dirección primero', true);
  const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=co&q=' + encodeURIComponent(t + ', Colombia'))).json();
  if (!r.length) return toast('No se encontró la dirección. Marca el punto directamente en el mapa.', true);
  picker.set(+r[0].lat, +r[0].lon); picker.m.setView([+r[0].lat, +r[0].lon], 16);
}
const datosOrden = () => ({ direccion_entrega: $('#f-dir').value, lat: $('#f-lat').value || null, lng: $('#f-lng').value || null, notas: $('#f-notas').value });

/* ---------- Dashboard ---------- */
function seccion(s) {
  if (!s.filas.length) return card(s.titulo, '<p class="muted">Sin datos todavía</p>');
  if (s.tipo === 'barras') {
    const mx = Math.max(...s.filas.map(f => +f[1]), 1);
    return card(s.titulo, s.filas.map(([l, v]) => `<div class="bar"><span>${esc(l)}</span><i style="width:${Math.max(3, (v / mx) * 100)}%"></i><em>${s.m ? money(v) : esc(v)}</em></div>`).join(''));
  }
  return card(s.titulo, `<table>${s.filas.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="right">${BC[b] ? badge(b) : esc(b)}</td></tr>`).join('')}</table>`);
}
async function dashboard(v) {
  const d = await api('/dashboard');
  v.innerHTML = `<h2>Resumen general</h2><div class="tiles">${d.tiles.map(t => `<div class="tile"><span>${esc(t.t)}</span><b>${t.m ? money(t.v) : esc(t.v)}</b></div>`).join('')}</div><div class="grid2">${d.secciones.map(seccion).join('')}</div>`;
}

/* ---------- Catálogo (Cliente) ---------- */
async function catalogo(v) {
  const ps = await api('/productos'), cats = [...new Set(ps.map(p => p.categoria))].sort();
  v.innerHTML = `<h2>Catálogo de productos y servicios</h2><div class="filters"><input id="fq" placeholder="Buscar…"><select id="ft"><option value="">Productos y servicios</option><option>Producto</option><option>Servicio</option></select><select id="fc"><option value="">Todas las categorías</option>${opts(cats)}</select></div><div id="grid" class="cards"></div>`;
  const draw = () => {
    const t = $('#fq').value.toLowerCase(), ty = $('#ft').value, c = $('#fc').value;
    const l = ps.filter(p => (!t || (p.nombre + p.descripcion).toLowerCase().includes(t)) && (!ty || p.tipo === ty) && (!c || p.categoria === c));
    $('#grid').innerHTML = l.map(p => { const ag = p.tipo === 'Producto' && p.stock <= 0; return `<div class="prod"><div>${badge(p.tipo)} <span class="muted">${esc(p.categoria)}</span></div><h4>${esc(p.nombre)}</h4><p>${esc(p.descripcion)}</p><div class="pr">${money(p.precio)}</div><small class="muted">${p.tipo === 'Servicio' ? 'Servicio disponible' : ag ? 'Agotado' : p.stock + ' disponibles'}</small><div class="ad"><input type="number" id="q${p.id_producto}" min="1" value="1" ${ag ? 'disabled' : ''}><button class="btn" data-act="add" data-id="${p.id_producto}" ${ag ? 'disabled' : ''}>Agregar al carrito</button></div></div>`; }).join('') || '<p class="muted">Sin resultados</p>';
  };
  ['fq', 'ft', 'fc'].forEach(i => ($('#' + i).oninput = draw)); draw();
}

/* ---------- Carrito (Cliente) ---------- */
async function actualizarBadge() {
  if (ROLE !== 'Cliente') return;
  const it = await api('/carrito'), n = it.reduce((s, x) => s + x.cantidad, 0), b = $('#cartBadge');
  if (b) { b.textContent = n; b.hidden = !n; }
  return it;
}
async function carrito(v) {
  const it = await actualizarBadge();
  if (!it.length) { v.innerHTML = `<h2>Carrito</h2>${card('', '<p class="muted">Tu carrito está vacío.</p><a class="btn" href="#catalogo">Ir al catálogo</a>')}`; return; }
  const sub = it.reduce((s, x) => s + x.precio * x.cantidad, 0), iva = Math.round(sub * 0.19);
  v.innerHTML = `<h2>Carrito de compras</h2><div class="cols"><div><div class="tw"><table><tr><th>Producto / servicio</th><th>Precio</th><th>Cantidad</th><th>Subtotal</th><th></th></tr>
  ${it.map(x => `<tr><td>${esc(x.nombre)} ${badge(x.tipo)}</td><td>${money(x.precio)}</td><td><input type="number" min="1" value="${x.cantidad}" data-chg="cart-qty" data-id="${x.id_producto}"></td><td>${money(x.precio * x.cantidad)}</td><td><button class="btn sm red" data-act="cart-del" data-id="${x.id_producto}">Quitar</button></td></tr>`).join('')}</table></div>
  <p><button class="btn sm ghost" style="color:var(--bad)" data-act="cart-clear">Vaciar carrito</button></p></div>
  <div>${card('Resumen', `<div class="sum"><div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>IVA 19%</span><span>${money(iva)}</span></div><div class="t"><span>Total</span><span>${money(sub + iva)}</span></div></div>`)}
  ${card('Datos de entrega', ordenForm({}) + '<button class="btn" style="width:100%;margin-top:12px" data-act="checkout">Crear pedido</button><p class="muted" style="font-size:12px">El stock se descuenta cuando confirmas el pedido y se genera la factura.</p>')}</div></div>`;
  iniciarPicker({});
}

/* ---------- Pedidos (Cliente / Admin) ---------- */
async function pedidos(v) {
  const ps = await api('/pedidos'), adm = ROLE === 'Admin';
  v.innerHTML = `<h2>${adm ? 'Pedidos de clientes' : 'Mis pedidos'}</h2>${!adm ? '<p><a class="btn" href="#catalogo">+ Nuevo pedido (desde el catálogo / carrito)</a></p>' : ''}<div class="tw"><table><tr><th>#</th><th>Fecha</th>${adm ? '<th>Cliente</th>' : ''}<th>Ítems</th><th>Total</th><th>Estado</th><th>Envío</th><th>Acciones</th></tr>
  ${ps.map(p => { const pen = p.estado === 'Pendiente'; return `<tr><td>${p.id_pedido}</td><td>${fdate(p.fecha)}</td>${adm ? `<td>${esc(p.cliente)}</td>` : ''}<td>${p.items}</td><td>${money(p.total_estimado)}</td><td>${badge(p.estado)}</td><td>${p.envio_estado ? badge(p.envio_estado) : '—'}</td><td>
  <button class="btn sm ghost" data-act="ped-ver" data-id="${p.id_pedido}">Ver</button>
  ${pen && !adm ? `<button class="btn sm ghost" data-act="ped-edit" data-id="${p.id_pedido}">Editar</button>` : ''}
  ${pen ? `<button class="btn sm green" data-act="ped-conf" data-id="${p.id_pedido}">Confirmar</button><button class="btn sm ghost" data-act="ped-canc" data-id="${p.id_pedido}">Cancelar</button>` : ''}
  ${p.estado !== 'Confirmado' ? `<button class="btn sm red" data-act="ped-del" data-id="${p.id_pedido}">Eliminar</button>` : ''}
  ${p.id_factura ? `<button class="btn sm" data-act="fac-ver" data-id="${p.id_factura}">Factura</button>` : ''}</td></tr>`; }).join('') || `<tr><td colspan="8" class="muted">No hay pedidos</td></tr>`}</table></div>`;
}
const tablaItems = (items, edit) => `<table><tr><th>Descripción</th><th>Precio</th><th>Cant.</th><th>Subtotal</th>${edit ? '<th></th>' : ''}</tr>${items.map(i => `<tr><td>${esc(i.nombre)}</td><td>${money(i.precio_unitario)}</td><td>${edit ? `<input type="number" min="1" value="${i.cantidad}" data-chg="ed-qty" data-id="${i.id_producto}">` : i.cantidad}</td><td>${money(i.precio_unitario * i.cantidad)}</td>${edit ? `<td><button class="btn sm red" data-act="ed-del" data-id="${i.id_producto}">Quitar</button></td>` : ''}</tr>`).join('')}</table>`;
async function verPedido(id) {
  const p = await api('/pedidos/' + id), sub = p.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
  modal(`Pedido #${p.id_pedido}`, `<p>${badge(p.estado)} ${p.envio ? badge(p.envio.estado) : ''}<br><small class="muted">${fdate(p.fecha)} · ${esc(p.cliente)}</small></p><p><b>Entrega:</b> ${esc(p.direccion_entrega)}<br>${p.notas ? `<b>Notas:</b> ${esc(p.notas)}` : ''}</p><div class="tw">${tablaItems(p.items)}</div><div class="sum"><div><span>Subtotal</span><span>${money(sub)}</span></div><div><span>IVA 19%</span><span>${money(Math.round(sub * 0.19))}</span></div><div class="t"><span>Total</span><span>${money(sub + Math.round(sub * 0.19))}</span></div></div>${p.factura ? `<div class="mf"><button class="btn" data-act="fac-ver" data-id="${p.factura.id_factura}">Ver factura ${esc(p.factura.numero)}</button></div>` : ''}`, true);
}
let ed = null;
function pintarEdicion() { $('#ed-items').innerHTML = ed.items.length ? tablaItems(ed.items, true) : '<p class="muted">Sin ítems: agrega al menos uno desde el catálogo.</p>'; }
async function editarPedido(id) {
  const p = await api('/pedidos/' + id); ed = p;
  modal(`Editar pedido #${id}`, `<div id="ed-items" class="tw"></div>${ordenForm(p)}<div class="mf"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="ed-save" data-id="${id}">Guardar cambios</button></div>`, true);
  pintarEdicion(); iniciarPicker(p);
}
function confirmarPedido(id) {
  modal(`Confirmar pedido #${id}`, `<p>Al confirmar se <b>descontará el stock</b> y se generará la <b>factura</b>.</p><label>Método de pago</label><select id="mp"><option>Transferencia</option><option>Tarjeta</option><option>PSE</option><option>Efectivo contra entrega</option></select><p class="muted" style="font-size:12px">El pago se registra manualmente (no hay pasarela bancaria integrada).</p><div class="mf"><button class="btn ghost" data-act="close">Volver</button><button class="btn green" data-act="conf-ok" data-id="${id}">Confirmar y facturar</button></div>`);
}

/* ---------- Facturas ---------- */
async function facturas(v) {
  const fs = await api('/facturas');
  v.innerHTML = `<h2>Facturas</h2><div class="tw"><table><tr><th>N.º</th><th>Fecha</th>${ROLE === 'Admin' ? '<th>Cliente</th>' : ''}<th>Pedido</th><th>Pago</th><th>Total</th><th></th></tr>${fs.map(f => `<tr><td>${esc(f.numero)}</td><td>${fdate(f.fecha)}</td>${ROLE === 'Admin' ? `<td>${esc(f.cliente)}</td>` : ''}<td>#${f.id_pedido}</td><td>${esc(f.metodo_pago)}</td><td>${money(f.total)}</td><td><button class="btn sm" data-act="fac-ver" data-id="${f.id_factura}">Ver</button> <button class="btn sm ghost" data-act="fac-pdf" data-id="${f.id_factura}" data-n="${esc(f.numero)}">PDF</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aún no hay facturas</td></tr>'}</table></div>`;
}
async function verFactura(id) {
  const f = await api('/facturas/' + id), e = f.empresa;
  modal('Factura ' + f.numero, `<div class="inv"><div class="top"><div><h3>${esc(e.nombre)}</h3><small>NIT ${esc(e.nit)}<br>${esc(e.direccion)}, ${esc(e.ciudad)}<br>Tel: ${esc(e.telefono)} · ${esc(e.correo)}</small></div><div class="right"><h3>FACTURA DE VENTA</h3><small>N.º ${esc(f.numero)}<br>${fdate(f.fecha)}<br>Pago: ${esc(f.metodo_pago)}</small></div></div>
  <p><b>Facturado a</b><br>${esc(f.cliente)}<br><small>Documento: ${esc(f.documento || '—')} · ${esc(f.correo)} · Tel: ${esc(f.telefono || '—')}<br>Entrega: ${esc(f.direccion_entrega || '—')}</small></p>
  <div class="tw"><table><tr><th>Descripción</th><th>Tipo</th><th>Cant.</th><th>V. unitario</th><th>Subtotal</th></tr>${f.items.map(i => `<tr><td>${esc(i.nombre)}</td><td>${esc(i.tipo)}</td><td>${i.cantidad}</td><td>${money(i.precio_unitario)}</td><td>${money(i.cantidad * i.precio_unitario)}</td></tr>`).join('')}</table></div>
  <div class="sum" style="max-width:300px;margin-left:auto"><div><span>Subtotal</span><span>${money(f.subtotal)}</span></div><div><span>IVA 19%</span><span>${money(f.iva)}</span></div><div class="t"><span>Total</span><span>${money(f.total)}</span></div></div></div>
  <div class="mf"><button class="btn ghost" data-act="close">Cerrar</button><button class="btn" data-act="fac-pdf" data-id="${f.id_factura}" data-n="${esc(f.numero)}">Descargar PDF</button></div>`, true);
}
async function descargarPDF(id, n) {
  const b = await (await api(`/facturas/${id}/pdf`, { raw: true })).blob(), a = document.createElement('a');
  a.href = URL.createObjectURL(b); a.download = n + '.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------- Envíos (mapa) ---------- */
let ENV = [], mapaEnv = null, rutaEnv = null;
async function envios(v) {
  ENV = await api('/envios');
  const conds = ROLE === 'Admin' ? await api('/usuarios?rol=Conductor') : [];
  v.innerHTML = `<h2>${ROLE === 'Cliente' ? 'Mis envíos' : ROLE === 'Conductor' ? 'Mis entregas asignadas' : 'Envíos'}</h2><div id="mapa" class="map"></div><div class="tw"><table><tr><th>Pedido</th><th>Factura</th>${ROLE !== 'Cliente' ? '<th>Cliente</th>' : ''}<th>Dirección</th><th>Conductor</th><th>Estado</th><th>Acciones</th></tr>
  ${ENV.map(e => `<tr><td>#${e.id_pedido}</td><td>${esc(e.factura || '')}</td>${ROLE !== 'Cliente' ? `<td>${esc(e.cliente)}</td>` : ''}<td>${esc(e.direccion_entrega)}</td>
  <td>${ROLE === 'Admin' ? `<select data-chg="env-cond" data-id="${e.id_envio}"><option value="">Sin asignar</option>${conds.map(c => `<option value="${c.id_usuario}" ${c.id_usuario === e.id_conductor ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>` : esc(e.conductor || 'Por asignar')}</td>
  <td>${ROLE === 'Admin' ? `<select data-chg="env-est" data-id="${e.id_envio}">${opts(['Preparando', 'En tránsito', 'Entregado'], e.estado)}</select>` : badge(e.estado)}${e.fecha_entrega ? `<br><small class="muted">Entregado: ${fdate(e.fecha_entrega)}</small>` : ''}</td>
  <td><button class="btn sm ghost" data-act="env-foco" data-id="${e.id_envio}">Ver en mapa</button>${ROLE === 'Conductor' && e.estado !== 'Entregado' ? `<button class="btn sm" data-act="env-set" data-id="${e.id_envio}" data-est="En tránsito">En tránsito</button><button class="btn sm green" data-act="env-set" data-id="${e.id_envio}" data-est="Entregado">Entregado</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No hay envíos para mostrar</td></tr>'}</table></div>`;
  mapaEnv = nuevoMapa('mapa', BODEGA, 11); rutaEnv = null;
  L.marker(BODEGA).addTo(mapaEnv).bindPopup('<b>HouseTech S.A.S.</b><br>Punto de despacho');
  const pts = [BODEGA];
  ENV.filter(e => e.lat != null).forEach(e => { const p = [+e.lat, +e.lng]; pts.push(p); L.circleMarker(p, { radius: 9, color: '#c53030', fillOpacity: .8 }).addTo(mapaEnv).bindPopup(`<b>Pedido #${e.id_pedido}</b><br>${esc(e.direccion_entrega)}<br>${esc(e.estado)}`); });
  if (pts.length > 1) mapaEnv.fitBounds(pts, { padding: [30, 30] });
}
function enfocarEnvio(id) {
  const e = ENV.find(x => x.id_envio === id);
  if (!e || e.lat == null) return toast('Este pedido no tiene ubicación en el mapa', true);
  if (rutaEnv) rutaEnv.remove();
  rutaEnv = L.polyline([BODEGA, [+e.lat, +e.lng]], { color: '#1f6feb', dashArray: '6 8' }).addTo(mapaEnv);
  mapaEnv.fitBounds(rutaEnv.getBounds(), { padding: [50, 50] }); window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Inventario (Admin) ---------- */
let INV = [];
async function inventario(v) {
  INV = await api('/productos');
  v.innerHTML = `<h2>Inventario de productos y servicios</h2><div class="filters"><input id="iq" placeholder="Buscar…"><select id="it"><option value="">Todos</option><option>Producto</option><option>Servicio</option></select><button class="btn" style="flex:0 0 auto" data-act="prod-new">+ Nuevo</button></div><div class="tw"><table id="itab"></table></div>`;
  const draw = () => {
    const t = $('#iq').value.toLowerCase(), ty = $('#it').value;
    $('#itab').innerHTML = `<tr><th>Nombre</th><th>Tipo</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th></th></tr>` + INV.filter(p => (!t || p.nombre.toLowerCase().includes(t)) && (!ty || p.tipo === ty)).map(p => {
      const bajo = p.tipo === 'Producto' && p.stock <= p.stock_minimo;
      return `<tr><td>${esc(p.nombre)}</td><td>${esc(p.tipo)}</td><td>${esc(p.categoria)}</td><td>${money(p.precio)}</td><td>${p.tipo === 'Servicio' ? '—' : `<span class="badge ${bajo ? 'bad' : 'ok'}">${p.stock}</span>`}</td><td>${badge(p.activo ? 'Activo' : 'Inactivo')}</td><td><button class="btn sm ghost" data-act="prod-edit" data-id="${p.id_producto}">Editar</button><button class="btn sm red" data-act="prod-del" data-id="${p.id_producto}">Eliminar</button></td></tr>`;
    }).join('');
  };
  $('#iq').oninput = draw; $('#it').onchange = draw; draw();
}
function formProducto(p) {
  p = p || { tipo: 'Producto', activo: 1, stock: 0, stock_minimo: 5, precio: 0 };
  const b = modal(p.id_producto ? 'Editar producto / servicio' : 'Nuevo producto / servicio', `<label>Nombre *</label><input id="p-n" value="${esc(p.nombre || '')}"><label>Descripción</label><input id="p-d" value="${esc(p.descripcion || '')}">
  <div class="row"><div><label>Tipo</label><select id="p-t">${opts(['Producto', 'Servicio'], p.tipo)}</select></div><div><label>Categoría</label><input id="p-c" value="${esc(p.categoria || '')}"></div></div>
  <div class="row"><div><label>Precio (COP, sin IVA)</label><input id="p-p" type="number" min="0" value="${p.precio}"></div><div><label>Estado</label><select id="p-a"><option value="1" ${p.activo ? 'selected' : ''}>Activo</option><option value="0" ${p.activo ? '' : 'selected'}>Inactivo</option></select></div></div>
  <div class="row"><div><label>Stock</label><input id="p-s" type="number" min="0" value="${p.stock}"></div><div><label>Stock mínimo (alerta)</label><input id="p-m" type="number" min="0" value="${p.stock_minimo}"></div></div>
  <div class="mf"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="prod-save" data-id="${p.id_producto || ''}">Guardar</button></div>`);
}

/* ---------- Servicio técnico (tickets) ---------- */
async function tickets(v) {
  const ts = await api('/tickets'), gest = ['Admin', 'Soporte'].includes(ROLE), crear = ROLE !== 'Soporte';
  const peds = crear && ['Cliente', 'Admin'].includes(ROLE) ? await api('/pedidos') : [];
  v.innerHTML = `<h2>Servicio Técnico</h2>${crear ? card('Solicitar ayuda', `<div class="row"><div><label>Categoría</label><select id="t-c">${opts(['Producto', 'Servicio', 'Pedido', 'Cuenta', 'Otro'])}</select></div><div><label>Pedido relacionado (opcional)</label><select id="t-p"><option value="">Ninguno</option>${peds.map(p => `<option value="${p.id_pedido}">Pedido #${p.id_pedido}</option>`).join('')}</select></div></div><label>Asunto</label><input id="t-a" maxlength="120"><label>Describe el problema</label><textarea id="t-d" rows="3"></textarea><p><button class="btn" data-act="tk-new">Enviar ticket</button></p>`) : ''}
  <h3>${gest ? 'Todos los tickets' : 'Mis tickets'}</h3>${ts.map(t => `<div class="tk"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>#${t.id_ticket} · ${esc(t.asunto)}</b>${badge(t.estado)}</div><small class="muted">${esc(t.categoria)}${t.id_pedido ? ' · Pedido #' + t.id_pedido : ''} · ${fdate(t.fecha_creacion)}${gest ? ' · ' + esc(t.usuario) + ' (' + esc(t.rol) + ')' : ''}</small><p>${esc(t.descripcion)}</p>${t.respuesta ? `<div class="r"><b>Respuesta de soporte:</b><br>${esc(t.respuesta)}</div>` : ''}
  ${gest ? `<div class="row"><div><label>Estado</label><select id="e${t.id_ticket}">${opts(['Abierto', 'En proceso', 'Resuelto', 'Cerrado'], t.estado)}</select></div><div><label>Respuesta</label><input id="r${t.id_ticket}" value="${esc(t.respuesta || '')}"></div></div><p><button class="btn sm" data-act="tk-save" data-id="${t.id_ticket}">Guardar</button> ${ROLE === 'Admin' ? `<button class="btn sm red" data-act="tk-del" data-id="${t.id_ticket}">Eliminar</button>` : ''}</p>` : t.estado === 'Abierto' ? `<button class="btn sm red" data-act="tk-del" data-id="${t.id_ticket}">Eliminar</button>` : ''}</div>`).join('') || '<p class="muted">No hay tickets</p>'}`;
}

/* ---------- Usuarios (Admin) ---------- */
let USR = [];
async function usuarios(v) {
  USR = await api('/usuarios');
  v.innerHTML = `<h2>Usuarios</h2><p><button class="btn" data-act="usr-new">+ Nuevo usuario</button></p><div class="tw"><table><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Teléfono</th><th></th></tr>${USR.map(u => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.correo)}</td><td>${esc(u.rol)}</td><td>${badge(u.estado)}</td><td>${esc(u.telefono || '—')}</td><td><button class="btn sm ghost" data-act="usr-edit" data-id="${u.id_usuario}">Editar</button>${u.id_usuario !== user.id ? `<button class="btn sm red" data-act="usr-del" data-id="${u.id_usuario}">Eliminar</button>` : ''}</td></tr>`).join('')}</table></div>`;
}
function formUsuario(u) {
  u = u || { rol: 'Cliente', estado: 'Activo' };
  modal(u.id_usuario ? 'Editar usuario' : 'Nuevo usuario', `<label>Nombre *</label><input id="u-n" value="${esc(u.nombre || '')}"><label>Correo *</label><input id="u-c" type="email" value="${esc(u.correo || '')}">
  <label>${u.id_usuario ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña * (mín. 8, letras y números)'}</label><input id="u-p" type="password" autocomplete="new-password">
  <div class="row"><div><label>Rol</label><select id="u-r">${opts(['Admin', 'Cliente', 'Conductor', 'Soporte'], u.rol)}</select></div><div><label>Estado</label><select id="u-e">${opts(['Activo', 'Inactivo'], u.estado)}</select></div></div>
  <div class="row"><div><label>Teléfono</label><input id="u-t" value="${esc(u.telefono || '')}"></div><div><label>Documento</label><input id="u-d" value="${esc(u.documento || '')}"></div></div>
  <div class="mf"><button class="btn ghost" data-act="close">Cancelar</button><button class="btn" data-act="usr-save" data-id="${u.id_usuario || ''}">Guardar</button></div>`);
}

/* ---------- Acciones (delegación de eventos) ---------- */
const val = id => $('#' + id).value;
const ACT = {
  close: closeModal,
  logout: () => { S.clear(); location.replace('index.html'); },
  'buscar-dir': () => run(buscarDireccion),
  add: d => run(async () => { const r = await api('/carrito', { method: 'POST', body: { id_producto: +d.id, cantidad: +val('q' + d.id) } }); toast(r.mensaje); actualizarBadge(); }),
  'cart-del': d => run(async () => { await api('/carrito/' + d.id, { method: 'DELETE' }); route(); }),
  'cart-clear': () => run(async () => { if (confirm('¿Vaciar el carrito?')) { await api('/carrito', { method: 'DELETE' }); route(); } }),
  checkout: () => run(async () => { const r = await api('/pedidos', { method: 'POST', body: { fromCarrito: true, ...datosOrden() } }); toast(r.mensaje); location.hash = '#pedidos'; }),
  'ped-ver': d => run(() => verPedido(d.id)),
  'ped-edit': d => run(() => editarPedido(d.id)),
  'ped-conf': d => confirmarPedido(d.id),
  'conf-ok': d => run(async () => { const r = await api(`/pedidos/${d.id}/confirmar`, { method: 'POST', body: { metodo_pago: val('mp') } }); toast(r.mensaje); closeModal(); await route(); verFactura(r.id_factura); }),
  'ped-canc': d => run(async () => { if (confirm('¿Cancelar este pedido?')) { await api(`/pedidos/${d.id}/cancelar`, { method: 'POST' }); toast('Pedido cancelado'); route(); } }),
  'ped-del': d => run(async () => { if (confirm('¿Eliminar este pedido definitivamente?')) { await api('/pedidos/' + d.id, { method: 'DELETE' }); toast('Pedido eliminado'); route(); } }),
  'ed-del': d => { ed.items = ed.items.filter(i => i.id_producto !== +d.id); pintarEdicion(); },
  'ed-save': d => run(async () => { await api('/pedidos/' + d.id, { method: 'PUT', body: { items: ed.items.map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad })), ...datosOrden() } }); toast('Pedido actualizado'); closeModal(); route(); }),
  'fac-ver': d => run(async () => { closeModal(); await verFactura(d.id); }),
  'fac-pdf': d => run(() => descargarPDF(d.id, d.n || 'factura')),
  'env-foco': d => enfocarEnvio(+d.id),
  'env-set': d => run(async () => { await api('/envios/' + d.id, { method: 'PUT', body: { estado: d.est } }); toast('Envío actualizado'); route(); }),
  'prod-new': () => formProducto(),
  'prod-edit': d => formProducto(INV.find(p => p.id_producto === +d.id)),
  'prod-save': d => run(async () => {
    const body = { nombre: val('p-n'), descripcion: val('p-d'), tipo: val('p-t'), categoria: val('p-c'), precio: val('p-p'), stock: val('p-s'), stock_minimo: val('p-m'), activo: val('p-a') === '1' };
    const r = await api(d.id ? '/productos/' + d.id : '/productos', { method: d.id ? 'PUT' : 'POST', body }); toast(r.mensaje); closeModal(); route();
  }),
  'prod-del': d => run(async () => { if (confirm('¿Eliminar este producto/servicio?')) { const r = await api('/productos/' + d.id, { method: 'DELETE' }); toast(r.mensaje); route(); } }),
  'tk-new': () => run(async () => { const r = await api('/tickets', { method: 'POST', body: { categoria: val('t-c'), id_pedido: val('t-p') || null, asunto: val('t-a'), descripcion: val('t-d') } }); toast(r.mensaje); route(); }),
  'tk-save': d => run(async () => { await api('/tickets/' + d.id, { method: 'PUT', body: { estado: val('e' + d.id), respuesta: val('r' + d.id) } }); toast('Ticket actualizado'); route(); }),
  'tk-del': d => run(async () => { if (confirm('¿Eliminar este ticket?')) { await api('/tickets/' + d.id, { method: 'DELETE' }); route(); } }),
  'usr-new': () => formUsuario(),
  'usr-edit': d => formUsuario(USR.find(u => u.id_usuario === +d.id)),
  'usr-save': d => run(async () => {
    const body = { nombre: val('u-n'), correo: val('u-c'), contrasena: val('u-p'), rol: val('u-r'), estado: val('u-e'), telefono: val('u-t'), documento: val('u-d') };
    const r = await api(d.id ? '/usuarios/' + d.id : '/usuarios', { method: d.id ? 'PUT' : 'POST', body }); toast(r.mensaje); closeModal(); route();
  }),
  'usr-del': d => run(async () => { if (confirm('¿Eliminar este usuario?')) { const r = await api('/usuarios/' + d.id, { method: 'DELETE' }); toast(r.mensaje); route(); } })
};
const CHG = {
  'cart-qty': t => run(async () => { try { await api('/carrito/' + t.dataset.id, { method: 'PUT', body: { cantidad: +t.value } }); } finally { route(); } }),
  'ed-qty': t => { const i = ed.items.find(x => x.id_producto === +t.dataset.id); if (i && +t.value > 0) i.cantidad = +t.value; pintarEdicion(); },
  'env-cond': t => run(async () => { await api('/envios/' + t.dataset.id, { method: 'PUT', body: { id_conductor: t.value || null } }); toast('Conductor asignado'); }),
  'env-est': t => run(async () => { await api('/envios/' + t.dataset.id, { method: 'PUT', body: { estado: t.value } }); toast('Estado actualizado'); })
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && ACT[b.dataset.act]) { e.preventDefault(); ACT[b.dataset.act](b.dataset); } });
document.addEventListener('change', e => { const t = e.target.closest('[data-chg]'); if (t && CHG[t.dataset.chg]) CHG[t.dataset.chg](t); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- Navegación por rol ---------- */
const NAV = [
  { id: 'dashboard', t: 'Dashboard', r: ['Admin', 'Cliente', 'Conductor', 'Soporte'], f: dashboard },
  { id: 'catalogo', t: 'Catálogo', r: ['Cliente'], f: catalogo },
  { id: 'carrito', t: 'Carrito', r: ['Cliente'], f: carrito },
  { id: 'pedidos', t: ROLE === 'Admin' ? 'Pedidos' : 'Mis pedidos', r: ['Cliente', 'Admin'], f: pedidos },
  { id: 'facturas', t: 'Facturas', r: ['Cliente', 'Admin'], f: facturas },
  { id: 'envios', t: ROLE === 'Conductor' ? 'Mis entregas' : 'Envíos', r: ['Cliente', 'Admin', 'Conductor'], f: envios },
  { id: 'inventario', t: 'Inventario', r: ['Admin'], f: inventario },
  { id: 'tickets', t: 'Servicio Técnico', r: ['Cliente', 'Admin', 'Conductor', 'Soporte'], f: tickets },
  { id: 'usuarios', t: 'Usuarios', r: ['Admin'], f: usuarios }
].filter(m => m.r.includes(ROLE));

async function route() {
  closeModal(); limpiarMapas();
  const id = (location.hash || '#dashboard').slice(1), m = NAV.find(x => x.id === id) || NAV[0], v = $('#view');
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === m.id));
  v.innerHTML = '<p class="muted">Cargando…</p>';
  try { await m.f(v); } catch (e) { v.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
if (token && user && user.rol === ROLE) {
  $('#app').innerHTML = `<aside class="side"><div class="brand">House<span>Tech</span></div><nav>${NAV.map(m => `<a href="#${m.id}" data-nav="${m.id}">${m.t}${m.id === 'carrito' ? '<em id="cartBadge" hidden>0</em>' : ''}</a>`).join('')}</nav><div class="who"><b>${esc(user.nombre)}</b><small>${esc(ROLE)}</small><button class="btn ghost sm" data-act="logout">Cerrar sesión</button></div></aside><main><div id="view"></div></main>`;
  window.addEventListener('hashchange', route);
  route(); actualizarBadge().catch(() => {});
}
