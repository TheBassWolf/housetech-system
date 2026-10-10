const express = require('express');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const { pool } = require('./db');

const SECRET = process.env.JWT_SECRET || 'cambiar-este-secreto-en-produccion';
const IVA = 0.19;
const ROLES = ['Admin', 'Conductor', 'Cliente', 'Soporte'];
const EMPRESA = {
  nombre: 'HouseTech S.A.S.',
  nit: process.env.EMP_NIT || '900.000.000-0',
  direccion: process.env.EMP_DIRECCION || 'Calle 00 # 00-00',
  ciudad: 'Bogotá D.C., Colombia',
  telefono: process.env.EMP_TELEFONO || '+57 300 000 0000',
  correo: process.env.EMP_CORREO || 'contacto@housetech.com.co',
  web: 'https://housetech-system.onrender.com'
};

const r = express.Router();
const q = async (sql, p = []) => (await pool.query(sql, p))[0];
const E = (s, m) => Object.assign(new Error(m), { status: s });
const pick = (v, list, def) => (list.includes(v) ? v : def);
const num = v => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
const money = n => '$ ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const w = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (e.status) return res.status(e.status).json({ mensaje: e.message });
  if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ mensaje: 'Ya existe un registro con esos datos' });
  console.error(e);
  res.status(500).json({ mensaje: 'Error interno del servidor' });
});
async function tx(fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const out = await fn(c); await c.commit(); return out; }
  catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
}

/* ---------- Seguridad ---------- */
const sign = u => jwt.sign({ id: u.id_usuario, rol: u.rol, nombre: u.nombre }, SECRET, { expiresIn: '8h' });
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ mensaje: 'Sesión no válida o expirada' }); }
};
const need = (...roles) => (req, res, next) =>
  roles.includes(req.user.rol) ? next() : res.status(403).json({ mensaje: 'No tienes permiso para esta acción' });
const intentos = new Map();
const limite = (req, res, next) => {
  const ahora = Date.now(), a = (intentos.get(req.ip) || []).filter(t => ahora - t < 9e5);
  if (a.length >= 15) return res.status(429).json({ mensaje: 'Demasiados intentos. Intenta de nuevo en unos minutos.' });
  a.push(ahora); intentos.set(req.ip, a); next();
};
const claveValida = p => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const correoValido = c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);

/* ---------- Autenticación y registro (públicos) ---------- */
r.post('/login', limite, w(async (req, res) => {
  const correo = (req.body.correo || req.body.email || '').trim().toLowerCase();
  const pass = req.body.contrasena || req.body.password;
  if (!correo || !pass) throw E(400, 'Por favor ingrese correo y contraseña');
  const [u] = await q('SELECT id_usuario, nombre, correo, rol, estado FROM usuario WHERE correo = ? AND contrasena = SHA2(?, 256)', [correo, pass]);
  if (!u) throw E(401, 'Credenciales incorrectas');
  if (u.estado === 'Inactivo') throw E(403, 'El usuario se encuentra inactivo');
  res.json({ mensaje: 'Login exitoso', token: sign(u), rol: u.rol, nombre: u.nombre, id_usuario: u.id_usuario });
}));

r.get('/email-disponible', w(async (req, res) => {
  const c = (req.query.correo || '').trim().toLowerCase();
  if (!correoValido(c)) throw E(400, 'Correo electrónico no válido');
  res.json({ disponible: (await q('SELECT 1 FROM usuario WHERE correo = ?', [c])).length === 0 });
}));

r.post('/register', limite, w(async (req, res) => {
  const b = req.body, correo = (b.correo || '').trim().toLowerCase();
  if (!b.nombre || b.nombre.trim().length < 3) throw E(400, 'Ingresa tu nombre completo');
  if (!correoValido(correo)) throw E(400, 'Correo electrónico no válido');
  if (!claveValida(b.contrasena)) throw E(400, 'La contraseña debe tener mínimo 8 caracteres, con letras y números');
  if ((await q('SELECT 1 FROM usuario WHERE correo = ?', [correo])).length) throw E(409, 'Ya existe una cuenta con ese correo');
  const [ins] = await pool.query(
    `INSERT INTO usuario (nombre, correo, contrasena, rol, estado, documento, telefono, direccion) VALUES (?, ?, SHA2(?, 256), 'Cliente', 'Activo', ?, ?, ?)`,
    [b.nombre.trim(), correo, b.contrasena, (b.documento || '').trim() || null, (b.telefono || '').trim() || null, (b.direccion || '').trim() || null]);
  const u = { id_usuario: ins.insertId, nombre: b.nombre.trim(), rol: 'Cliente' };
  res.status(201).json({ mensaje: 'Cuenta creada correctamente', token: sign(u), rol: 'Cliente', nombre: u.nombre, id_usuario: u.id_usuario });
}));

r.use(auth);

r.get('/me', w(async (req, res) => {
  const [u] = await q('SELECT id_usuario, nombre, correo, rol, telefono, documento, direccion FROM usuario WHERE id_usuario = ?', [req.user.id]);
  res.json(u);
}));

/* ---------- Inventario: productos y servicios (CRUD) ---------- */
function validarProducto(b) {
  const tipo = pick(b.tipo, ['Producto', 'Servicio'], 'Producto');
  const precio = parseInt(b.precio), stock = tipo === 'Servicio' ? 0 : parseInt(b.stock);
  if (!b.nombre || b.nombre.trim().length < 3) throw E(400, 'El nombre es obligatorio');
  if (!(precio >= 0)) throw E(400, 'Precio no válido');
  if (!(stock >= 0)) throw E(400, 'Stock no válido');
  return [b.nombre.trim(), (b.descripcion || '').trim(), tipo, (b.categoria || 'General').trim(), precio, stock, parseInt(b.stock_minimo) >= 0 ? parseInt(b.stock_minimo) : 5, b.activo === false || b.activo === 0 ? 0 : 1];
}
r.get('/productos', w(async (req, res) => {
  res.json(await q(`SELECT * FROM producto ${req.user.rol === 'Admin' ? '' : 'WHERE activo = 1'} ORDER BY tipo, categoria, nombre`));
}));
r.post('/productos', need('Admin'), w(async (req, res) => {
  const v = validarProducto(req.body);
  const [ins] = await pool.query('INSERT INTO producto (nombre, descripcion, tipo, categoria, precio, stock, stock_minimo, activo) VALUES (?,?,?,?,?,?,?,?)', v);
  if (v[5] > 0) await q("INSERT INTO movimiento_inventario (id_producto, tipo, cantidad) VALUES (?, 'Entrada', ?)", [ins.insertId, v[5]]);
  res.status(201).json({ mensaje: 'Creado correctamente', id_producto: ins.insertId });
}));
r.put('/productos/:id', need('Admin'), w(async (req, res) => {
  const id = +req.params.id, v = validarProducto(req.body);
  const [p] = await q('SELECT stock FROM producto WHERE id_producto = ?', [id]);
  if (!p) throw E(404, 'No encontrado');
  await q('UPDATE producto SET nombre=?, descripcion=?, tipo=?, categoria=?, precio=?, stock=?, stock_minimo=?, activo=? WHERE id_producto=?', [...v, id]);
  if (v[5] !== p.stock) await q("INSERT INTO movimiento_inventario (id_producto, tipo, cantidad) VALUES (?, 'Ajuste', ?)", [id, v[5] - p.stock]);
  res.json({ mensaje: 'Actualizado correctamente' });
}));
r.delete('/productos/:id', need('Admin'), w(async (req, res) => {
  const id = +req.params.id;
  try {
    await q('DELETE FROM producto WHERE id_producto = ?', [id]);
    res.json({ mensaje: 'Eliminado correctamente' });
  } catch (e) {
    if (e.code !== 'ER_ROW_IS_REFERENCED_2') throw e;
    await q('UPDATE producto SET activo = 0 WHERE id_producto = ?', [id]);
    res.json({ mensaje: 'Tiene historial de ventas: se desactivó en lugar de eliminarse' });
  }
}));

/* ---------- Carrito (Cliente) ---------- */
r.get('/carrito', need('Cliente'), w(async (req, res) => {
  res.json(await q(`SELECT c.id_producto, c.cantidad, p.nombre, p.tipo, p.precio, p.stock, p.activo
    FROM carrito c JOIN producto p ON p.id_producto = c.id_producto WHERE c.id_usuario = ? ORDER BY p.nombre`, [req.user.id]));
}));
async function fijarCarrito(uid, id, cant, sumar) {
  const [p] = await q('SELECT * FROM producto WHERE id_producto = ? AND activo = 1', [id]);
  if (!p) throw E(404, 'Producto no disponible');
  const [c] = await q('SELECT cantidad FROM carrito WHERE id_usuario = ? AND id_producto = ?', [uid, id]);
  const total = sumar ? (c ? c.cantidad : 0) + cant : cant;
  if (!(total >= 1)) throw E(400, 'Cantidad no válida');
  if (p.tipo === 'Producto' && total > p.stock) throw E(409, `Stock insuficiente (disponible: ${p.stock})`);
  await q('INSERT INTO carrito (id_usuario, id_producto, cantidad) VALUES (?,?,?) ON DUPLICATE KEY UPDATE cantidad = ?', [uid, id, total, total]);
}
r.post('/carrito', need('Cliente'), w(async (req, res) => {
  await fijarCarrito(req.user.id, +req.body.id_producto, parseInt(req.body.cantidad) || 1, true);
  res.json({ mensaje: 'Agregado al carrito' });
}));
r.put('/carrito/:id', need('Cliente'), w(async (req, res) => {
  await fijarCarrito(req.user.id, +req.params.id, parseInt(req.body.cantidad), false);
  res.json({ mensaje: 'Cantidad actualizada' });
}));
r.delete('/carrito/:id', need('Cliente'), w(async (req, res) => {
  await q('DELETE FROM carrito WHERE id_usuario = ? AND id_producto = ?', [req.user.id, +req.params.id]);
  res.json({ mensaje: 'Eliminado del carrito' });
}));
r.delete('/carrito', need('Cliente'), w(async (req, res) => {
  await q('DELETE FROM carrito WHERE id_usuario = ?', [req.user.id]);
  res.json({ mensaje: 'Carrito vaciado' });
}));

/* ---------- Pedidos (CRUD; el stock solo cambia al confirmar) ---------- */
async function resolver(c, items) {
  const m = new Map();
  for (const i of items || []) {
    const id = +i.id_producto, n = parseInt(i.cantidad);
    if (!id || !(n > 0) || n > 999) throw E(400, 'Cantidad no válida');
    m.set(id, (m.get(id) || 0) + n);
  }
  if (!m.size) throw E(400, 'El pedido debe tener al menos un producto o servicio');
  const out = [];
  for (const [id, n] of m) {
    const [[p]] = await c.query('SELECT * FROM producto WHERE id_producto = ? AND activo = 1', [id]);
    if (!p) throw E(404, `El producto #${id} no está disponible`);
    if (p.tipo === 'Producto' && n > p.stock) throw E(409, `Stock insuficiente de "${p.nombre}" (disponible: ${p.stock})`);
    out.push({ id, n, precio: p.precio });
  }
  return out;
}
async function guardarLineas(c, idPedido, ls) {
  await c.query('DELETE FROM detalle_pedido WHERE id_pedido = ?', [idPedido]);
  for (const l of ls) await c.query('INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES (?,?,?,?)', [idPedido, l.id, l.n, l.precio]);
  await c.query('UPDATE pedido SET subtotal = ? WHERE id_pedido = ?', [ls.reduce((s, l) => s + l.n * l.precio, 0), idPedido]);
}
async function pedidoCompleto(id, user) {
  const [p] = await q('SELECT p.*, u.nombre cliente FROM pedido p JOIN usuario u ON u.id_usuario = p.id_usuario WHERE p.id_pedido = ?', [id]);
  if (!p || (user.rol !== 'Admin' && p.id_usuario !== user.id)) throw E(404, 'Pedido no encontrado');
  p.items = await q(`SELECT d.id_producto, d.cantidad, d.precio_unitario, pr.nombre, pr.tipo, pr.stock
    FROM detalle_pedido d JOIN producto pr ON pr.id_producto = d.id_producto WHERE d.id_pedido = ? ORDER BY pr.nombre`, [id]);
  [p.factura] = await q('SELECT id_factura, numero, total FROM factura WHERE id_pedido = ?', [id]);
  [p.envio] = await q('SELECT estado FROM envio WHERE id_pedido = ?', [id]);
  return p;
}

r.get('/pedidos', need('Cliente', 'Admin'), w(async (req, res) => {
  const adm = req.user.rol === 'Admin';
  res.json(await q(`SELECT p.*, u.nombre cliente, f.id_factura, ROUND(p.subtotal * ${1 + IVA}) total_estimado, e.estado envio_estado,
      (SELECT COUNT(*) FROM detalle_pedido d WHERE d.id_pedido = p.id_pedido) items
    FROM pedido p JOIN usuario u ON u.id_usuario = p.id_usuario
    LEFT JOIN factura f ON f.id_pedido = p.id_pedido LEFT JOIN envio e ON e.id_pedido = p.id_pedido
    ${adm ? '' : 'WHERE p.id_usuario = ?'} ORDER BY p.id_pedido DESC`, adm ? [] : [req.user.id]));
}));
r.get('/pedidos/:id', need('Cliente', 'Admin'), w(async (req, res) => res.json(await pedidoCompleto(+req.params.id, req.user))));

r.post('/pedidos', need('Cliente'), w(async (req, res) => {
  const b = req.body;
  if (!b.direccion_entrega || b.direccion_entrega.trim().length < 5) throw E(400, 'Ingresa la dirección de entrega');
  const id = await tx(async c => {
    let items = b.items;
    if (b.fromCarrito) [items] = await c.query('SELECT id_producto, cantidad FROM carrito WHERE id_usuario = ?', [req.user.id]);
    const ls = await resolver(c, items);
    const [ins] = await c.query('INSERT INTO pedido (id_usuario, direccion_entrega, lat, lng, notas) VALUES (?,?,?,?,?)',
      [req.user.id, b.direccion_entrega.trim(), num(b.lat), num(b.lng), (b.notas || '').slice(0, 255)]);
    await guardarLineas(c, ins.insertId, ls);
    if (b.fromCarrito) await c.query('DELETE FROM carrito WHERE id_usuario = ?', [req.user.id]);
    return ins.insertId;
  });
  res.status(201).json({ mensaje: 'Pedido creado. Confírmalo para generar la factura.', id_pedido: id });
}));

r.put('/pedidos/:id', need('Cliente'), w(async (req, res) => {
  const id = +req.params.id, b = req.body;
  await tx(async c => {
    const [[p]] = await c.query('SELECT * FROM pedido WHERE id_pedido = ? AND id_usuario = ? FOR UPDATE', [id, req.user.id]);
    if (!p) throw E(404, 'Pedido no encontrado');
    if (p.estado !== 'Pendiente') throw E(409, 'Solo se pueden modificar pedidos pendientes');
    if (b.direccion_entrega !== undefined && b.direccion_entrega.trim().length < 5) throw E(400, 'Ingresa la dirección de entrega');
    if (b.items) await guardarLineas(c, id, await resolver(c, b.items));
    await c.query('UPDATE pedido SET direccion_entrega = ?, lat = ?, lng = ?, notas = ? WHERE id_pedido = ?', [
      b.direccion_entrega !== undefined ? b.direccion_entrega.trim() : p.direccion_entrega,
      b.lat !== undefined ? num(b.lat) : p.lat, b.lng !== undefined ? num(b.lng) : p.lng,
      b.notas !== undefined ? String(b.notas).slice(0, 255) : p.notas, id]);
  });
  res.json({ mensaje: 'Pedido actualizado' });
}));

r.delete('/pedidos/:id', need('Cliente', 'Admin'), w(async (req, res) => {
  const p = await pedidoCompleto(+req.params.id, req.user);
  if (p.estado === 'Confirmado') throw E(409, 'Un pedido confirmado y facturado no se puede eliminar');
  await q('DELETE FROM pedido WHERE id_pedido = ?', [p.id_pedido]);
  res.json({ mensaje: 'Pedido eliminado' });
}));

r.post('/pedidos/:id/cancelar', need('Cliente', 'Admin'), w(async (req, res) => {
  const p = await pedidoCompleto(+req.params.id, req.user);
  if (p.estado !== 'Pendiente') throw E(409, 'Solo se pueden cancelar pedidos pendientes');
  await q("UPDATE pedido SET estado = 'Cancelado' WHERE id_pedido = ?", [p.id_pedido]);
  res.json({ mensaje: 'Pedido cancelado' });
}));

// Confirmar = descontar stock + registrar movimientos + generar factura + crear envío (todo atómico)
r.post('/pedidos/:id/confirmar', need('Cliente', 'Admin'), w(async (req, res) => {
  const id = +req.params.id;
  const metodo = pick(req.body.metodo_pago, ['Transferencia', 'Tarjeta', 'PSE', 'Efectivo contra entrega'], null);
  if (!metodo) throw E(400, 'Selecciona un método de pago');
  const idFactura = await tx(async c => {
    const [[p]] = await c.query('SELECT * FROM pedido WHERE id_pedido = ? FOR UPDATE', [id]);
    if (!p || (req.user.rol !== 'Admin' && p.id_usuario !== req.user.id)) throw E(404, 'Pedido no encontrado');
    if (p.estado !== 'Pendiente') throw E(409, 'El pedido ya fue procesado');
    const [ls] = await c.query(`SELECT d.*, pr.nombre, pr.tipo, pr.stock FROM detalle_pedido d
      JOIN producto pr ON pr.id_producto = d.id_producto WHERE d.id_pedido = ? ORDER BY d.id_producto FOR UPDATE`, [id]);
    if (!ls.length) throw E(400, 'El pedido no tiene productos');
    let sub = 0, fisico = false;
    for (const l of ls) {
      sub += l.cantidad * l.precio_unitario;
      if (l.tipo === 'Producto') {
        fisico = true;
        if (l.stock < l.cantidad) throw E(409, `Stock insuficiente de "${l.nombre}" (disponible: ${l.stock})`);
      }
    }
    for (const l of ls.filter(x => x.tipo === 'Producto')) {
      await c.query('UPDATE producto SET stock = stock - ? WHERE id_producto = ?', [l.cantidad, l.id_producto]);
      await c.query("INSERT INTO movimiento_inventario (id_producto, id_pedido, tipo, cantidad) VALUES (?,?,'Salida',?)", [l.id_producto, id, l.cantidad]);
    }
    const iva = Math.round(sub * IVA);
    const [f] = await c.query('INSERT INTO factura (numero, id_pedido, subtotal, iva, total, metodo_pago) VALUES (?,?,?,?,?,?)',
      ['T' + Date.now() + Math.floor(Math.random() * 1e4), id, sub, iva, sub + iva, metodo]);
    await c.query('UPDATE factura SET numero = ? WHERE id_factura = ?', [`FAC-${new Date().getFullYear()}-${String(f.insertId).padStart(6, '0')}`, f.insertId]);
    await c.query("UPDATE pedido SET estado = 'Confirmado', subtotal = ? WHERE id_pedido = ?", [sub, id]);
    if (fisico) await c.query('INSERT INTO envio (id_pedido) VALUES (?)', [id]);
    return f.insertId;
  });
  res.json({ mensaje: 'Pedido confirmado y factura generada', id_factura: idFactura });
}));

/* ---------- Facturas ---------- */
async function facturaCompleta(id, user) {
  const [f] = await q(`SELECT f.*, p.id_usuario, p.direccion_entrega, u.nombre cliente, u.correo, u.telefono, u.documento
    FROM factura f JOIN pedido p ON p.id_pedido = f.id_pedido JOIN usuario u ON u.id_usuario = p.id_usuario WHERE f.id_factura = ?`, [id]);
  if (!f || (user.rol !== 'Admin' && f.id_usuario !== user.id)) throw E(404, 'Factura no encontrada');
  f.items = await q(`SELECT d.cantidad, d.precio_unitario, pr.nombre, pr.tipo FROM detalle_pedido d
    JOIN producto pr ON pr.id_producto = d.id_producto WHERE d.id_pedido = ?`, [f.id_pedido]);
  f.empresa = EMPRESA;
  return f;
}
r.get('/facturas', need('Cliente', 'Admin'), w(async (req, res) => {
  const adm = req.user.rol === 'Admin';
  res.json(await q(`SELECT f.id_factura, f.numero, f.fecha, f.total, f.metodo_pago, f.id_pedido, u.nombre cliente
    FROM factura f JOIN pedido p ON p.id_pedido = f.id_pedido JOIN usuario u ON u.id_usuario = p.id_usuario
    ${adm ? '' : 'WHERE p.id_usuario = ?'} ORDER BY f.id_factura DESC`, adm ? [] : [req.user.id]));
}));
r.get('/facturas/:id', need('Cliente', 'Admin'), w(async (req, res) => res.json(await facturaCompleta(+req.params.id, req.user))));

r.get('/facturas/:id/pdf', need('Cliente', 'Admin'), w(async (req, res) => {
  const f = await facturaCompleta(+req.params.id, req.user), e = f.empresa;
  const d = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${f.numero}.pdf"`);
  d.pipe(res);
  d.font('Helvetica-Bold').fontSize(20).fillColor('#0b3d91').text(e.nombre, 48, 48);
  d.font('Helvetica').fontSize(9).fillColor('#444').text(`NIT ${e.nit}\n${e.direccion}, ${e.ciudad}\nTel: ${e.telefono}  |  ${e.correo}\n${e.web}`, 48, 74);
  d.font('Helvetica-Bold').fontSize(16).fillColor('#111').text('FACTURA DE VENTA', 300, 48, { width: 247, align: 'right' });
  d.font('Helvetica').fontSize(10).text(`N.º ${f.numero}\nFecha: ${new Date(f.fecha).toLocaleDateString('es-CO')}\nPago: ${f.metodo_pago}`, 300, 72, { width: 247, align: 'right' });
  d.moveTo(48, 128).lineTo(547, 128).strokeColor('#cccccc').stroke();
  d.font('Helvetica-Bold').fontSize(10).fillColor('#0b3d91').text('FACTURADO A', 48, 140);
  d.font('Helvetica').fillColor('#111').text(`${f.cliente}\nDocumento: ${f.documento || '-'}\nCorreo: ${f.correo}\nTeléfono: ${f.telefono || '-'}\nDirección de entrega: ${f.direccion_entrega || '-'}`, 48, 156, { width: 499 });
  let y = 250;
  const fila = (cols, bold) => {
    d.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? '#fff' : '#111');
    d.text(cols[0], 54, y + 6, { width: 230, lineBreak: false }).text(cols[1], 290, y + 6, { width: 60, lineBreak: false })
      .text(cols[2], 350, y + 6, { width: 40, align: 'right', lineBreak: false })
      .text(cols[3], 395, y + 6, { width: 70, align: 'right', lineBreak: false })
      .text(cols[4], 470, y + 6, { width: 73, align: 'right', lineBreak: false });
  };
  d.rect(48, y, 499, 22).fill('#0b3d91'); fila(['Descripción', 'Tipo', 'Cant.', 'V. unitario', 'Subtotal'], true); y += 22;
  for (const i of f.items) {
    if (y > 730) { d.addPage(); y = 60; }
    fila([i.nombre, i.tipo, String(i.cantidad), money(i.precio_unitario), money(i.cantidad * i.precio_unitario)]);
    y += 22; d.moveTo(48, y).lineTo(547, y).strokeColor('#e5e5e5').stroke();
  }
  y += 14; if (y > 700) { d.addPage(); y = 60; }
  const tot = (l, v, b) => { d.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(b ? 12 : 10).fillColor('#111').text(l, 350, y, { width: 100 }).text(v, 440, y, { width: 107, align: 'right' }); y += b ? 20 : 16; };
  tot('Subtotal', money(f.subtotal)); tot('IVA (19%)', money(f.iva)); tot('TOTAL', money(f.total), true);
  d.font('Helvetica').fontSize(8).fillColor('#777').text('Documento generado por el sistema HouseTech S.A.S. Conserve esta factura como soporte de su compra y para trámites de garantía.', 48, 770, { width: 499, align: 'center' });
  d.end();
}));

/* ---------- Envíos ---------- */
r.get('/envios', need('Cliente', 'Admin', 'Conductor'), w(async (req, res) => {
  const cond = req.user.rol === 'Admin' ? ['1=1', []] : req.user.rol === 'Conductor' ? ['e.id_conductor = ?', [req.user.id]] : ['p.id_usuario = ?', [req.user.id]];
  res.json(await q(`SELECT e.*, p.direccion_entrega, p.lat, p.lng, u.nombre cliente, c.nombre conductor, f.numero factura
    FROM envio e JOIN pedido p ON p.id_pedido = e.id_pedido JOIN usuario u ON u.id_usuario = p.id_usuario
    LEFT JOIN usuario c ON c.id_usuario = e.id_conductor LEFT JOIN factura f ON f.id_pedido = p.id_pedido
    WHERE ${cond[0]} ORDER BY e.id_envio DESC`, cond[1]));
}));
r.put('/envios/:id', need('Admin', 'Conductor'), w(async (req, res) => {
  const id = +req.params.id, b = req.body, adm = req.user.rol === 'Admin';
  const [e] = await q('SELECT * FROM envio WHERE id_envio = ?', [id]);
  if (!e || (!adm && e.id_conductor !== req.user.id)) throw E(404, 'Envío no encontrado');
  const est = pick(b.estado, ['Preparando', 'En tránsito', 'Entregado'], e.estado);
  let cond = e.id_conductor;
  if (adm && 'id_conductor' in b) {
    cond = b.id_conductor ? +b.id_conductor : null;
    if (cond && !(await q("SELECT 1 FROM usuario WHERE id_usuario = ? AND rol = 'Conductor' AND estado = 'Activo'", [cond])).length) throw E(400, 'El conductor no es válido');
  }
  await q('UPDATE envio SET estado = ?, id_conductor = ?, fecha_entrega = ? WHERE id_envio = ?', [est, cond, est === 'Entregado' ? e.fecha_entrega || new Date() : null, id]);
  res.json({ mensaje: 'Envío actualizado' });
}));

/* ---------- Servicio técnico: tickets ---------- */
r.get('/tickets', w(async (req, res) => {
  const gest = ['Admin', 'Soporte'].includes(req.user.rol);
  res.json(await q(`SELECT t.*, u.nombre usuario, u.rol FROM ticket t JOIN usuario u ON u.id_usuario = t.id_usuario
    ${gest ? '' : 'WHERE t.id_usuario = ?'} ORDER BY FIELD(t.estado,'Abierto','En proceso','Resuelto','Cerrado'), t.id_ticket DESC`, gest ? [] : [req.user.id]));
}));
r.post('/tickets', need('Cliente', 'Admin', 'Conductor'), w(async (req, res) => {
  const b = req.body, asunto = (b.asunto || '').trim(), desc = (b.descripcion || '').trim();
  if (asunto.length < 5 || asunto.length > 120) throw E(400, 'El asunto debe tener entre 5 y 120 caracteres');
  if (desc.length < 10) throw E(400, 'Describe el problema con más detalle (mínimo 10 caracteres)');
  let idPedido = null;
  if (b.id_pedido) {
    const [p] = await q('SELECT id_usuario FROM pedido WHERE id_pedido = ?', [+b.id_pedido]);
    if (!p || (req.user.rol !== 'Admin' && p.id_usuario !== req.user.id)) throw E(400, 'El pedido indicado no es válido');
    idPedido = +b.id_pedido;
  }
  const [ins] = await pool.query('INSERT INTO ticket (id_usuario, id_pedido, asunto, categoria, descripcion) VALUES (?,?,?,?,?)',
    [req.user.id, idPedido, asunto, pick(b.categoria, ['Producto', 'Servicio', 'Pedido', 'Cuenta', 'Otro'], 'Otro'), desc]);
  res.status(201).json({ mensaje: 'Ticket enviado. Soporte técnico lo atenderá pronto.', id_ticket: ins.insertId });
}));
r.put('/tickets/:id', need('Admin', 'Soporte'), w(async (req, res) => {
  const [t] = await q('SELECT * FROM ticket WHERE id_ticket = ?', [+req.params.id]);
  if (!t) throw E(404, 'Ticket no encontrado');
  await q('UPDATE ticket SET estado = ?, respuesta = ? WHERE id_ticket = ?',
    [pick(req.body.estado, ['Abierto', 'En proceso', 'Resuelto', 'Cerrado'], t.estado), req.body.respuesta !== undefined ? String(req.body.respuesta).slice(0, 2000) : t.respuesta, t.id_ticket]);
  res.json({ mensaje: 'Ticket actualizado' });
}));
r.delete('/tickets/:id', w(async (req, res) => {
  const [t] = await q('SELECT * FROM ticket WHERE id_ticket = ?', [+req.params.id]);
  const adm = req.user.rol === 'Admin';
  if (!t || (!adm && t.id_usuario !== req.user.id)) throw E(404, 'Ticket no encontrado');
  if (!adm && t.estado !== 'Abierto') throw E(409, 'Solo puedes eliminar tickets que aún no han sido atendidos');
  await q('DELETE FROM ticket WHERE id_ticket = ?', [t.id_ticket]);
  res.json({ mensaje: 'Ticket eliminado' });
}));

/* ---------- Usuarios (Admin) ---------- */
r.get('/usuarios', need('Admin'), w(async (req, res) => {
  const f = ROLES.includes(req.query.rol);
  res.json(await q(`SELECT id_usuario, nombre, correo, rol, estado, telefono, documento, direccion FROM usuario ${f ? 'WHERE rol = ?' : ''} ORDER BY rol, nombre`, f ? [req.query.rol] : []));
}));
r.post('/usuarios', need('Admin'), w(async (req, res) => {
  const b = req.body, correo = (b.correo || '').trim().toLowerCase();
  if (!b.nombre || b.nombre.trim().length < 3) throw E(400, 'El nombre es obligatorio');
  if (!correoValido(correo)) throw E(400, 'Correo electrónico no válido');
  if (!claveValida(b.contrasena)) throw E(400, 'La contraseña debe tener mínimo 8 caracteres, con letras y números');
  await q('INSERT INTO usuario (nombre, correo, contrasena, rol, estado, telefono, documento, direccion) VALUES (?,?,SHA2(?,256),?,?,?,?,?)',
    [b.nombre.trim(), correo, b.contrasena, pick(b.rol, ROLES, 'Cliente'), pick(b.estado, ['Activo', 'Inactivo'], 'Activo'), b.telefono || null, b.documento || null, b.direccion || null]);
  res.status(201).json({ mensaje: 'Usuario creado' });
}));
r.put('/usuarios/:id', need('Admin'), w(async (req, res) => {
  const id = +req.params.id, b = req.body, correo = (b.correo || '').trim().toLowerCase();
  const rol = pick(b.rol, ROLES, 'Cliente'), estado = pick(b.estado, ['Activo', 'Inactivo'], 'Activo');
  if (!b.nombre || b.nombre.trim().length < 3 || !correoValido(correo)) throw E(400, 'Nombre o correo no válidos');
  if (id === req.user.id && (rol !== 'Admin' || estado !== 'Activo')) throw E(400, 'No puedes quitarte el rol Admin ni desactivar tu propia cuenta');
  if (b.contrasena) {
    if (!claveValida(b.contrasena)) throw E(400, 'La contraseña debe tener mínimo 8 caracteres, con letras y números');
    await q('UPDATE usuario SET contrasena = SHA2(?,256) WHERE id_usuario = ?', [b.contrasena, id]);
  }
  await q('UPDATE usuario SET nombre=?, correo=?, rol=?, estado=?, telefono=?, documento=?, direccion=? WHERE id_usuario=?',
    [b.nombre.trim(), correo, rol, estado, b.telefono || null, b.documento || null, b.direccion || null, id]);
  res.json({ mensaje: 'Usuario actualizado' });
}));
r.delete('/usuarios/:id', need('Admin'), w(async (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) throw E(400, 'No puedes eliminar tu propia cuenta');
  try { await q('DELETE FROM usuario WHERE id_usuario = ?', [id]); res.json({ mensaje: 'Usuario eliminado' }); }
  catch (e) {
    if (e.code !== 'ER_ROW_IS_REFERENCED_2') throw e;
    await q("UPDATE usuario SET estado = 'Inactivo' WHERE id_usuario = ?", [id]);
    res.json({ mensaje: 'El usuario tiene pedidos asociados: se marcó como Inactivo en lugar de eliminarse' });
  }
}));

/* ---------- Dashboard por rol ---------- */
const cnt = async (sql, p = []) => Object.values((await q(sql, p))[0] || { n: 0 })[0] || 0;
const porEstado = rows => rows.map(x => [x.estado, +x.n]);
r.get('/dashboard', w(async (req, res) => {
  const u = req.user.id, t = [], s = [];
  if (req.user.rol === 'Admin') {
    const [ventas, fact, pend, conf, prods, env, tk, usr, mes, bajo, top, pe, ee] = await Promise.all([
      cnt('SELECT SUM(total) FROM factura'), cnt('SELECT COUNT(*) FROM factura'),
      cnt("SELECT COUNT(*) FROM pedido WHERE estado='Pendiente'"), cnt("SELECT COUNT(*) FROM pedido WHERE estado='Confirmado'"),
      cnt('SELECT COUNT(*) FROM producto WHERE activo=1'), cnt("SELECT COUNT(*) FROM envio WHERE estado<>'Entregado'"),
      cnt("SELECT COUNT(*) FROM ticket WHERE estado IN ('Abierto','En proceso')"), cnt("SELECT COUNT(*) FROM usuario WHERE estado='Activo'"),
      q("SELECT DATE_FORMAT(fecha,'%Y-%m') mes, SUM(total) total FROM factura GROUP BY mes ORDER BY mes DESC LIMIT 6"),
      q("SELECT nombre, stock, stock_minimo FROM producto WHERE tipo='Producto' AND activo=1 AND stock<=stock_minimo ORDER BY stock LIMIT 6"),
      q("SELECT pr.nombre, SUM(d.cantidad) n FROM detalle_pedido d JOIN pedido p ON p.id_pedido=d.id_pedido AND p.estado='Confirmado' JOIN producto pr ON pr.id_producto=d.id_producto GROUP BY pr.id_producto, pr.nombre ORDER BY n DESC LIMIT 5"),
      q('SELECT estado, COUNT(*) n FROM pedido GROUP BY estado'), q('SELECT estado, COUNT(*) n FROM envio GROUP BY estado')
    ]);
    t.push({ t: 'Ventas totales', v: ventas, m: 1 }, { t: 'Facturas emitidas', v: fact }, { t: 'Pedidos pendientes', v: pend }, { t: 'Pedidos confirmados', v: conf },
      { t: 'Productos y servicios activos', v: prods }, { t: 'Envíos en curso', v: env }, { t: 'Tickets abiertos', v: tk }, { t: 'Usuarios activos', v: usr });
    s.push({ titulo: 'Ventas por mes', tipo: 'barras', m: 1, filas: mes.reverse().map(x => [x.mes, +x.total]) },
      { titulo: 'Pedidos por estado', tipo: 'barras', filas: porEstado(pe) },
      { titulo: 'Más vendidos (unidades)', tipo: 'barras', filas: top.map(x => [x.nombre, +x.n]) },
      { titulo: 'Envíos por estado', tipo: 'barras', filas: porEstado(ee) },
      { titulo: 'Alerta de stock bajo', tipo: 'tabla', filas: bajo.map(x => [x.nombre, `${x.stock} (mín. ${x.stock_minimo})`]) });
  } else if (req.user.rol === 'Cliente') {
    const [pend, conf, gasto, car, env, tk, ped, ee] = await Promise.all([
      cnt("SELECT COUNT(*) FROM pedido WHERE id_usuario=? AND estado='Pendiente'", [u]), cnt("SELECT COUNT(*) FROM pedido WHERE id_usuario=? AND estado='Confirmado'", [u]),
      cnt('SELECT SUM(f.total) FROM factura f JOIN pedido p ON p.id_pedido=f.id_pedido WHERE p.id_usuario=?', [u]),
      cnt('SELECT COALESCE(SUM(cantidad),0) FROM carrito WHERE id_usuario=?', [u]),
      cnt("SELECT COUNT(*) FROM envio e JOIN pedido p ON p.id_pedido=e.id_pedido WHERE p.id_usuario=? AND e.estado<>'Entregado'", [u]),
      cnt("SELECT COUNT(*) FROM ticket WHERE id_usuario=? AND estado IN ('Abierto','En proceso')", [u]),
      q('SELECT id_pedido, estado, subtotal FROM pedido WHERE id_usuario=? ORDER BY id_pedido DESC LIMIT 5', [u]),
      q('SELECT e.id_pedido, e.estado FROM envio e JOIN pedido p ON p.id_pedido=e.id_pedido WHERE p.id_usuario=? ORDER BY e.id_envio DESC LIMIT 5', [u])
    ]);
    t.push({ t: 'Pedidos pendientes', v: pend }, { t: 'Pedidos confirmados', v: conf }, { t: 'Total comprado', v: gasto, m: 1 },
      { t: 'Artículos en el carrito', v: car }, { t: 'Envíos en camino', v: env }, { t: 'Tickets abiertos', v: tk });
    s.push({ titulo: 'Últimos pedidos', tipo: 'tabla', filas: ped.map(x => [`Pedido #${x.id_pedido}`, x.estado]) },
      { titulo: 'Estado de mis envíos', tipo: 'tabla', filas: ee.map(x => [`Pedido #${x.id_pedido}`, x.estado]) });
  } else if (req.user.rol === 'Conductor') {
    const [asig, trans, ent, prox] = await Promise.all([
      cnt('SELECT COUNT(*) FROM envio WHERE id_conductor=?', [u]), cnt("SELECT COUNT(*) FROM envio WHERE id_conductor=? AND estado='En tránsito'", [u]),
      cnt("SELECT COUNT(*) FROM envio WHERE id_conductor=? AND estado='Entregado'", [u]),
      q("SELECT e.id_pedido, p.direccion_entrega, e.estado FROM envio e JOIN pedido p ON p.id_pedido=e.id_pedido WHERE e.id_conductor=? AND e.estado<>'Entregado' LIMIT 6", [u])
    ]);
    t.push({ t: 'Envíos asignados', v: asig }, { t: 'En tránsito', v: trans }, { t: 'Entregados', v: ent });
    s.push({ titulo: 'Próximas entregas', tipo: 'tabla', filas: prox.map(x => [`#${x.id_pedido} · ${x.direccion_entrega}`, x.estado]) });
  } else {
    const [ee, rec] = await Promise.all([q('SELECT estado, COUNT(*) n FROM ticket GROUP BY estado'), q('SELECT id_ticket, asunto, estado FROM ticket ORDER BY id_ticket DESC LIMIT 6')]);
    for (const e of ['Abierto', 'En proceso', 'Resuelto', 'Cerrado']) t.push({ t: `Tickets ${e.toLowerCase()}s`.replace('procesos', 'en proceso'), v: +(ee.find(x => x.estado === e)?.n || 0) });
    s.push({ titulo: 'Tickets recientes', tipo: 'tabla', filas: rec.map(x => [`#${x.id_ticket} · ${x.asunto}`, x.estado]) });
  }
  res.json({ tiles: t, secciones: s });
}));

module.exports = r;
