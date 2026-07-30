const crypto = require('node:crypto');

const COOKIE_NAME = 'guardian_ops_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function texto(valor) {
  return String(valor || '').trim();
}

function configuracionDisponible() {
  return Boolean(texto(process.env.MISSION_CONTROL_PASSWORD) && texto(process.env.MISSION_CONTROL_SESSION_SECRET));
}

function compararSeguro(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function firmar(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function crearTokenSesion(secret, ahora = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: ahora + (SESSION_TTL_SECONDS * 1000) }), 'utf8').toString('base64url');
  return `${payload}.${firmar(payload, secret)}`;
}

function verificarTokenSesion(token, secret, ahora = Date.now()) {
  const [payload, firma, extra] = String(token || '').split('.');
  if (!payload || !firma || extra) return false;
  if (!compararSeguro(firma, firmar(payload, secret))) return false;

  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(datos.exp) && datos.exp > ahora;
  } catch {
    return false;
  }
}

function parsearCookies(req) {
  const header = texto(req?.headers?.cookie);
  if (!header) return {};
  return Object.fromEntries(header.split(';').map((parte) => {
    const indice = parte.indexOf('=');
    if (indice < 0) return [parte.trim(), ''];
    return [parte.slice(0, indice).trim(), decodeURIComponent(parte.slice(indice + 1).trim())];
  }));
}

function sesionValida(req) {
  if (!configuracionDisponible()) return false;
  const token = parsearCookies(req)[COOKIE_NAME];
  return verificarTokenSesion(token, texto(process.env.MISSION_CONTROL_SESSION_SECRET));
}

function responderJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function requireAuth(req, res) {
  if (!configuracionDisponible()) {
    responderJson(res, 503, { ok: false, error: 'Acceso privado no configurado.' });
    return false;
  }
  if (!sesionValida(req)) {
    responderJson(res, 401, { ok: false, error: 'Autenticación requerida.' });
    return false;
  }
  return true;
}

function passwordValido(password) {
  return configuracionDisponible() && compararSeguro(password, texto(process.env.MISSION_CONTROL_PASSWORD));
}

function cookieSesion() {
  const token = crearTokenSesion(texto(process.env.MISSION_CONTROL_SESSION_SECRET));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

module.exports = {
  COOKIE_NAME,
  configuracionDisponible,
  crearTokenSesion,
  verificarTokenSesion,
  requireAuth,
  passwordValido,
  cookieSesion,
};
