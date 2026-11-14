const { requireAuth } = require('../lib/auth');

// Quién está conectado, para que la app muestre su nombre y sus secciones.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    return res.end();
  }
  const sesion = requireAuth(req, res);
  if (!sesion) return;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify({ ok: true, sesion }));
};
