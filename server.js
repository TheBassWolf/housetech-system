const express = require('express');
const mysql = require('mysql2');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Conexión a MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'housetech_system',
    waitForConnections: true,
    connectionLimit: 10
});

// Endpoint de Login con verificación HASH SHA2 (SHA-256)
app.post('/api/login', (req, res) => {
    const { correo, contrasena } = req.body;
    
    // Generar hash SHA2-256 de la contraseña ingresada
    const hash = crypto.createHash('sha256').update(contrasena).digest('hex');

    const query = 'SELECT id_usuario, nombre, correo, rol FROM usuario WHERE correo = ? AND contrasena = ? AND estado = TRUE';
    db.query(query, [correo, hash], (err, results) => {
        if (err) return res.status(500).json({ error: 'Error interno en la base de datos' });
        if (results.length === 0) {
            return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
        }
        res.json({ success: true, user: results[0] });
    });
});

// Endpoint: Obtener Pedidos (Para el Dashboard de Administración)
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

// Endpoint: Obtener Envíos (Para la App Móvil del Conductor)
app.get('/api/conductor/envios', (req, res) => {
    const query = `
        SELECT e.id_envio, e.direccion_entrega, e.estado_envio, c.nombre AS cliente
        FROM envio e
        JOIN pedido p ON e.id_pedido = p.id_pedido
        JOIN cliente c ON p.id_cliente = c.id_cliente
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).send(err);
        res.json(results);
    });
});

// Endpoint: Actualizar Estado del Despacho
app.post('/api/conductor/actualizar-estado', (req, res) => {
    const { id_envio, nuevo_estado } = req.body;
    const query = 'UPDATE envio SET estado_envio = ? WHERE id_envio = ?';
    db.query(query, [nuevo_estado, id_envio], (err, result) => {
        if (err) return res.status(500).send(err);
        res.json({ success: true });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de HouseTech S.A.S. en ejecución en puerto ${PORT}`));