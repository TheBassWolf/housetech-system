require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'railway',
  waitForConnections: true, connectionLimit: 8, charset: 'UTF8MB4_UNICODE_CI'
});

const TABLAS = [
`CREATE TABLE IF NOT EXISTS usuario (
  id_usuario INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL,
  correo VARCHAR(100) NOT NULL UNIQUE, contrasena VARCHAR(256) NOT NULL,
  rol ENUM('Admin','Conductor','Cliente','Soporte') NOT NULL DEFAULT 'Cliente',
  estado ENUM('Activo','Inactivo') NOT NULL DEFAULT 'Activo')`,
`ALTER TABLE usuario MODIFY rol ENUM('Admin','Conductor','Cliente','Soporte') NOT NULL DEFAULT 'Cliente'`,
`CREATE TABLE IF NOT EXISTS producto (
  id_producto INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255), tipo ENUM('Producto','Servicio') NOT NULL DEFAULT 'Producto',
  categoria VARCHAR(60) NOT NULL DEFAULT 'General', precio INT NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0, stock_minimo INT NOT NULL DEFAULT 5, activo TINYINT(1) NOT NULL DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS carrito (
  id_usuario INT NOT NULL, id_producto INT NOT NULL, cantidad INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id_usuario, id_producto),
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE,
  FOREIGN KEY (id_producto) REFERENCES producto(id_producto) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS pedido (
  id_pedido INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('Pendiente','Confirmado','Cancelado') NOT NULL DEFAULT 'Pendiente',
  direccion_entrega VARCHAR(200), lat DECIMAL(9,6) NULL, lng DECIMAL(9,6) NULL,
  notas VARCHAR(255), subtotal INT NOT NULL DEFAULT 0,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario))`,
`CREATE TABLE IF NOT EXISTS detalle_pedido (
  id_detalle INT AUTO_INCREMENT PRIMARY KEY, id_pedido INT NOT NULL, id_producto INT NOT NULL,
  cantidad INT NOT NULL, precio_unitario INT NOT NULL,
  FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido) ON DELETE CASCADE,
  FOREIGN KEY (id_producto) REFERENCES producto(id_producto))`,
`CREATE TABLE IF NOT EXISTS factura (
  id_factura INT AUTO_INCREMENT PRIMARY KEY, numero VARCHAR(30) NOT NULL UNIQUE,
  id_pedido INT NOT NULL UNIQUE, fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal INT NOT NULL, iva INT NOT NULL, total INT NOT NULL, metodo_pago VARCHAR(30) NOT NULL,
  FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido))`,
`CREATE TABLE IF NOT EXISTS envio (
  id_envio INT AUTO_INCREMENT PRIMARY KEY, id_pedido INT NOT NULL UNIQUE, id_conductor INT NULL,
  estado ENUM('Preparando','En tránsito','Entregado') NOT NULL DEFAULT 'Preparando',
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  fecha_entrega DATETIME NULL,
  FOREIGN KEY (id_pedido) REFERENCES pedido(id_pedido) ON DELETE CASCADE,
  FOREIGN KEY (id_conductor) REFERENCES usuario(id_usuario) ON DELETE SET NULL)`,
`CREATE TABLE IF NOT EXISTS movimiento_inventario (
  id_mov INT AUTO_INCREMENT PRIMARY KEY, id_producto INT NOT NULL, id_pedido INT NULL,
  tipo ENUM('Salida','Entrada','Ajuste') NOT NULL, cantidad INT NOT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_producto) REFERENCES producto(id_producto))`,
`CREATE TABLE IF NOT EXISTS ticket (
  id_ticket INT AUTO_INCREMENT PRIMARY KEY, id_usuario INT NOT NULL, id_pedido INT NULL,
  asunto VARCHAR(120) NOT NULL,
  categoria ENUM('Producto','Servicio','Pedido','Cuenta','Otro') NOT NULL DEFAULT 'Otro',
  descripcion TEXT NOT NULL,
  estado ENUM('Abierto','En proceso','Resuelto','Cerrado') NOT NULL DEFAULT 'Abierto',
  respuesta TEXT NULL, fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (id_usuario) REFERENCES usuario(id_usuario) ON DELETE CASCADE)`
];

const COLUMNAS_USUARIO = [
  ['telefono', 'VARCHAR(30) NULL'], ['documento', 'VARCHAR(30) NULL'],
  ['direccion', 'VARCHAR(200) NULL'], ['fecha_registro', 'DATETIME NULL DEFAULT CURRENT_TIMESTAMP']
];

// [nombre, descripción, tipo, categoría, precio COP, stock]
const CATALOGO = [
['Portátil HouseTech Pro 15"','Intel Core i7, 16 GB RAM, SSD 512 GB, pantalla Full HD','Producto','Computadores',3450000,12],
['Portátil Lenovo IdeaPad 3','Ryzen 5, 8 GB RAM, SSD 256 GB, 15.6"','Producto','Computadores',2190000,15],
['PC Gamer HouseTech RTX 4060','Ryzen 5, 16 GB DDR4, RTX 4060, SSD 1 TB NVMe','Producto','Computadores',4890000,6],
['Monitor LG 24" Full HD IPS','Panel IPS 75 Hz, HDMI y VGA','Producto','Monitores',520000,20],
['Monitor Samsung 27" Curvo','Curvo 1500R, 144 Hz, FreeSync','Producto','Monitores',890000,9],
['SSD Kingston NV2 500GB NVMe','Unidad de estado sólido M.2 PCIe 4.0','Producto','Componentes',230000,40],
['Memoria RAM Crucial DDR4 8GB','3200 MHz, CL22','Producto','Componentes',125000,50],
['Fuente Corsair CV650 80+ Bronze','650 W certificada 80 Plus Bronze','Producto','Componentes',290000,18],
['Pasta térmica ARCTIC MX-4 4g','Alto rendimiento térmico, no conductora','Producto','Componentes',38000,60],
['Tarjeta de video RTX 4060 8GB','GDDR6, DLSS 3, HDMI y DisplayPort','Producto','Componentes',1390000,7],
['Procesador AMD Ryzen 5 5600','6 núcleos / 12 hilos, socket AM4','Producto','Componentes',620000,14],
['Teclado mecánico Redragon Kumara','Switch rojo, retroiluminado, 87 teclas','Producto','Periféricos',175000,25],
['Mouse Logitech M280 inalámbrico','Receptor USB, 18 meses de batería','Producto','Periféricos',68000,35],
['Diadema HyperX Cloud Stinger','Sonido envolvente, micrófono giratorio','Producto','Periféricos',230000,15],
['Webcam Logitech C920 HD','Full HD 1080p con micrófono estéreo','Producto','Periféricos',310000,12],
['Impresora HP Smart Tank 580','Multifuncional con sistema de tinta continua','Producto','Impresión',850000,8],
['Router TP-Link Archer AX23','Wi-Fi 6 doble banda AX1800','Producto','Redes',245000,22],
['Switch TP-Link 8 puertos Gigabit','No administrable, carcasa metálica','Producto','Redes',95000,25],
['Cable UTP Cat6 (caja 305 m)','Cobre, uso interior','Producto','Redes',480000,10],
['Access Point Ubiquiti UniFi U6 Lite','Wi-Fi 6 para oficinas, alimentación PoE','Producto','Redes',520000,8],
['Bombillo inteligente Wi-Fi RGB','16 millones de colores, control por voz','Producto','Domótica',38000,60],
['Cámara de seguridad Wi-Fi 2K','Visión nocturna, detección de movimiento','Producto','Domótica',165000,28],
['Cerradura inteligente con huella','Apertura por huella, clave y llave','Producto','Domótica',420000,10],
['Enchufe inteligente Wi-Fi','Control remoto y programación horaria','Producto','Domótica',45000,45],
['Hub domótico central','Integra dispositivos Zigbee y Wi-Fi','Producto','Domótica',210000,15],
['Licencia McAfee Total Protection','Antivirus, 1 año, hasta 5 dispositivos','Producto','Software',110000,100],
['Mantenimiento preventivo de PC','Limpieza profunda y cambio de pasta térmica','Servicio','Servicios técnicos',85000,0],
['Mantenimiento correctivo de hardware','Diagnóstico y reparación de fallas físicas','Servicio','Servicios técnicos',120000,0],
['Ensamble de computador personalizado','Armado y pruebas de estrés con tus componentes','Servicio','Servicios técnicos',150000,0],
['Formateo e instalación de sistema operativo','Windows/Linux y programas básicos','Servicio','Servicios técnicos',70000,0],
['Eliminación de malware y optimización','Limpieza de virus y ajuste de rendimiento','Servicio','Servicios técnicos',90000,0],
['Recuperación de datos','Rescate de información de discos dañados','Servicio','Servicios técnicos',240000,0],
['Mantenimiento de impresoras de red','Limpieza, calibración y cambio de repuestos','Servicio','Servicios técnicos',95000,0],
['Instalación de red y cableado estructurado','Precio por punto de red certificado','Servicio','Conectividad',130000,0],
['Instalación de domótica residencial','Configuración de dispositivos y escenas','Servicio','Domótica',280000,0],
['Plan de soporte empresarial mensual','Soporte remoto y visitas programadas','Servicio','Soporte',650000,0]
];

async function migrar() {
  for (const sql of TABLAS) await pool.query(sql);
  for (const [col, def] of COLUMNAS_USUARIO) {
    try { await pool.query(`ALTER TABLE usuario ADD COLUMN ${col} ${def}`); }
    catch (e) { if (e.errno !== 1060) throw e; } // 1060 = la columna ya existe
  }
  const usuarios = [
    ['Administrador HouseTech', 'admin@housetech.com.co', 'Admin'],
    ['Conductor HouseTech', 'conductor@housetech.com.co', 'Conductor'],
    ['Soporte Técnico', 'soporte@housetech.com.co', 'Soporte'],
    ['Cliente Demo', 'cliente@housetech.com.co', 'Cliente']
  ];
  for (const [n, c, r] of usuarios)
    await pool.query(`INSERT IGNORE INTO usuario (nombre, correo, contrasena, rol, estado) VALUES (?, ?, SHA2('123456', 256), ?, 'Activo')`, [n, c, r]);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM producto');
  if (n === 0)
    await pool.query('INSERT INTO producto (nombre, descripcion, tipo, categoria, precio, stock) VALUES ?', [CATALOGO]);
  console.log('Base de datos lista');
}

module.exports = { pool, migrar };
