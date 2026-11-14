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

const ROLES = ['dueno', 'secretaria', 'campo'];
const DUENO = Object.freeze({ usuario: 'dueno', nombre: 'Dueño', rol: 'dueno' });

function crearTokenSesion(secret, ahora = Date.now(), identidad = DUENO) {
  const datos = {
    exp: ahora + (SESSION_TTL_SECONDS * 1000),
    u: identidad.usuario,
    n: identidad.nombre,
    r: identidad.rol,
  };
  const payload = Buffer.from(JSON.stringify(datos), 'utf8').toString('base64url');
  return `${payload}.${firmar(payload, secret)}`;
}

// Devuelve { usuario, nombre, rol } si el token es válido y vigente; null si no.
// Los tokens anteriores a los usuarios por persona (sin rol) cuentan como Dueño.
function leerTokenSesion(token, secret, ahora = Date.now()) {
  const [payload, firma, extra] = String(token || '').split('.');
  if (!payload || !firma || extra) return null;
  if (!compararSeguro(firma, firmar(payload, secret))) return null;

  try {
    const datos = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(datos.exp) || datos.exp <= ahora) return null;
    if (!datos.r) return { ...DUENO };
    if (!ROLES.includes(datos.r)) return null;
    return { usuario: String(datos.u || ''), nombre: String(datos.n || datos.u || ''), rol: datos.r };
  } catch {
    return null;
  }
}

function verificarTokenSesion(token, secret, ahora = Date.now()) {
  return Boolean(leerTokenSesion(token, secret, ahora));
}

function parsearCookies(req) {
  const header = texto(req?.headers?.cookie);
  if (!header) return {};
  return Object.fromEntries(header.split(';').map((parte) => {
    const indice = parte.indexOf('=');
    if (indice < 0) return [parte.trim(), ''];
    const nombre = parte.slice(0, indice).trim();
    const valor = parte.slice(indice + 1).trim();
    try {
      return [nombre, decodeURIComponent(valor)];
    } catch {
      return [nombre, ''];
    }
  }));
}

function leerSesion(req) {
  if (!configuracionDisponible()) return null;
  const token = parsearCookies(req)[COOKIE_NAME];
  return leerTokenSesion(token, texto(process.env.MISSION_CONTROL_SESSION_SECRET));
}

function sesionValida(req) {
  return Boolean(leerSesion(req));
}

function responderJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

// Devuelve la sesión ({ usuario, nombre, rol }) o false tras responder 503/401/403.
function requireAuth(req, res, { roles = ROLES } = {}) {
  if (!configuracionDisponible()) {
    responderJson(res, 503, { ok: false, error: 'Acceso privado no configurado.' });
    return false;
  }
  const sesion = leerSesion(req);
  if (!sesion) {
    responderJson(res, 401, { ok: false, error: 'Autenticación requerida.' });
    return false;
  }
  if (!roles.includes(sesion.rol)) {
    responderJson(res, 403, { ok: false, error: 'Tu usuario no tiene permiso para esta sección.' });
    return false;
  }
  return sesion;
}

function passwordValido(password) {
  return configuracionDisponible() && compararSeguro(password, texto(process.env.MISSION_CONTROL_PASSWORD));
}

function cookieSesion(identidad = DUENO) {
  const token = crearTokenSesion(texto(process.env.MISSION_CONTROL_SESSION_SECRET), Date.now(), identidad);
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
}

function cookieCierre() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

module.exports = {
  COOKIE_NAME,
  ROLES,
  DUENO,
  leerSesion,
  leerTokenSesion,
  cookieCierre,
  compararSeguro,
  configuracionDisponible,
  sesionValida,
  crearTokenSesion,
  verificarTokenSesion,
  requireAuth,
  passwordValido,
  cookieSesion,
};
