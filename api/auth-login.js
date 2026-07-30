const { configuracionDisponible, passwordValido, cookieSesion } = require('../lib/auth');

function responderJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function normalizarBody(body) {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return null; }
  }
  return body;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  if (!configuracionDisponible()) {
    return responderJson(res, 503, { ok: false, error: 'Acceso privado no configurado.' });
  }

  const body = normalizarBody(req.body);
  if (!passwordValido(body?.password)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return responderJson(res, 401, { ok: false, error: 'Contraseña incorrecta.' });
  }

  res.setHeader('Set-Cookie', cookieSesion());
  return responderJson(res, 200, { ok: true });
};
