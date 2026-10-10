require('dotenv').config();
const express = require('express');
const path = require('path');
const { migrar } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); next(); });
app.use(express.json({ limit: '100kb' }));

app.use('/api', require('./routes'));
app.use('/api', (req, res) => res.status(404).json({ mensaje: 'Ruta no encontrada' }));

// Solo se publica la carpeta /public (nunca .env, server.js ni db.js)
app.use(express.static(path.join(__dirname, 'public')));

migrar()
  .then(() => app.listen(PORT, () => console.log(`Servidor ejecutándose en el puerto ${PORT}`)))
  .catch(e => { console.error('Error al preparar la base de datos:', e); process.exit(1); });
