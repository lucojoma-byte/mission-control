const { configuracionDisponible, passwordValido, cookieSesion, DUENO } = require('../lib/auth');
const { crearRepositorioUsuarios } = require('../lib/usuarios');

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttemptsByIp = new Map();


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

function ipCliente(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req?.socket?.remoteAddress || 'unknown');
}

function attemptsWithinWindow(ip, now = Date.now()) {
  const attempts = (failedAttemptsByIp.get(ip) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (attempts.length) failedAttemptsByIp.set(ip, attempts);
  else failedAttemptsByIp.delete(ip);
  return attempts;
}

function rateLimited(ip, now = Date.now()) {
  return attemptsWithinWindow(ip, now).length >= MAX_FAILED_ATTEMPTS;
}

function registerFailure(ip, now = Date.now()) {
  const attempts = attemptsWithinWindow(ip, now);
  attempts.push(now);
  failedAttemptsByIp.set(ip, attempts);
}

function clearFailures(ip) {
  failedAttemptsByIp.delete(ip);
}

async function login(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  if (!configuracionDisponible()) {
    return responderJson(res, 503, { ok: false, error: 'Acceso privado no configurado.' });
  }

  const ip = ipCliente(req);
  if (rateLimited(ip)) {
    res.setHeader('Retry-After', String(WINDOW_MS / 1000));
    return responderJson(res, 429, { ok: false, error: 'Demasiados intentos. Intenta más tarde.' });
  }

  const body = normalizarBody(req.body);
  const usuario = String(body?.usuario || '').trim().toLowerCase();

  // Sin usuario (o "dueno"): contraseña principal del Dueño. Con usuario: cuenta por persona.
  let identidad = null;
  if (!usuario || usuario === 'dueno') {
    if (passwordValido(body?.password)) identidad = { ...DUENO };
  } else {
    try {
      identidad = await login._repositorio().autenticar(usuario, body?.password);
    } catch (error) {
      console.error('Login: no se pudieron leer los usuarios', { message: error?.message });
      return responderJson(res, 503, { ok: false, error: 'No se pudo validar el usuario. Intenta de nuevo.' });
    }
  }

  if (!identidad) {
    registerFailure(ip);
    await new Promise((resolve) => setTimeout(resolve, 350));
    return responderJson(res, 401, { ok: false, error: 'Usuario o contraseña incorrectos.' });
  }

  clearFailures(ip);
  res.setHeader('Set-Cookie', cookieSesion(identidad));
  return responderJson(res, 200, { ok: true, sesion: identidad });
}

login._resetRateLimitForTests = () => failedAttemptsByIp.clear();
login._repositorio = () => crearRepositorioUsuarios();

module.exports = login;
