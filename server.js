const express = require('express');
const mysql = require('mysql2');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Conexión a MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', // Tu contraseña de MySQL
    database: process.env.DB_NAME || 'housetech_system',
    waitForConnections: true,
    connectionLimit: 10
});

// 1. AUTENTICACIÓN
app.post('/api/login', (req, res) => {
    const correo = req.body.correo;
    const contrasena = req.body.contrasena || req.body.contraseña;

    if (!correo || !contrasena) {
        return res.status(400).json({ success: false, message: 'Ingrese correo y contraseña' });
    }

    const hash = crypto.createHash('sha256').update(contrasena).digest('hex');
    const query = 'SELECT id_usuario, nombre, correo, rol FROM usuario WHERE correo = ? AND contrasena = ? AND estado = TRUE';

    db.query(query, [correo, hash], (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        if (results.length === 0) return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        res.json({ success: true, user: results[0] });
    });
});

// 2. DASHBOARD - LISTAR PEDIDOS
app.get('/api/admin/pedidos', (req, res) => {
    const query = `
        SELECT p.id_pedido, c.nombre AS cliente, p.estado, 
               IFNULL(SUM(dp.cantidad * dp.precio_unitario), 0) AS monto_total
        FROM pedido p
        JOIN cliente c ON p.id_cliente = c.id_cliente
        LEFT JOIN detalle_pedido dp ON p.id_pedido = dp.id_pedido
        GROUP BY p.id_pedido, c.nombre, p.estado
        ORDER BY p.id_pedido DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 3. CAMBIAR ESTADO DE PEDIDO
app.post('/api/admin/pedido/estado', (req, res) => {
    const { id_pedido, nuevo_estado } = req.body;
    db.query('UPDATE pedido SET estado = ? WHERE id_pedido = ?', [nuevo_estado, id_pedido], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true });
    });
});

// 4. CREAR UN NUEVO PEDIDO Y PROCESAR TRIGGER DE STOCK (HU-001 y HU-002)
app.post('/api/admin/pedido/nuevo', (req, res) => {
    const { id_cliente, id_producto, cantidad, precio_unitario } = req.body;

    // Insertar Pedido
    db.query('INSERT INTO pedido (id_cliente, estado) VALUES (?, "Pendiente")', [id_cliente], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const id_pedido = result.insertId;

        // Insertar Detalle (Dispara el TRIGGER 'descontar_stock' automáticamente)
        db.query(
            'INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
            [id_pedido, id_producto, cantidad, precio_unitario],
            (err2) => {
                if (err2) return res.status(500).json({ error: err2.message });
                
                // Crear Registro de Envío para la App Móvil del Conductor
                db.query(
                    'INSERT INTO envio (id_pedido, direccion_entrega, estado_envio) VALUES (?, "Calle 100 # 15-20", "PENDIENTE")',
                    [id_pedido],
                    () => res.json({ success: true, id_pedido })
                );
            }
        );
    });
});

// 5. INVENTARIO Y BODEGAS
app.get('/api/admin/productos', (req, res) => {
    db.query('SELECT * FROM producto', (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// 6. LOGÍSTICA DEL CONDUCTOR (HU-004)
app.get('/api/conductor/envios', (req, res) => {
    const query = `
        SELECT e.id_envio, e.direccion_entrega, e.estado_envio, c.nombre AS cliente
        FROM envio e
        JOIN pedido p ON e.id_pedido = p.id_pedido
        JOIN cliente c ON p.id_cliente = c.id_cliente
        ORDER BY e.id_envio DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

app.post('/api/conductor/actualizar-estado', (req, res) => {
    const { id_envio, nuevo_estado } = req.body;
    db.query('UPDATE envio SET estado_envio = ? WHERE id_envio = ?', [nuevo_estado, id_envio], (err) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de HouseTech S.A.S. en ejecución en puerto ${PORT}`));