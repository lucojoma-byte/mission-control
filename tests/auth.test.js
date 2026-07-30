const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/auth');
const login = require('../api/auth-login');
const crm = require('../api/crm-prospectos');
const campo = require('../api/campo-visitas');

function respuestaFalsa() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    end(body) { this.body = body || ''; },
  };
}

function prepararEnv() {
  process.env.MISSION_CONTROL_PASSWORD = 'prueba-local-segura';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'secreto-local-de-prueba-con-longitud-suficiente';
}

test.beforeEach(prepararEnv);

test('token firmado acepta sesión vigente y rechaza alteración/expiración', () => {
  const ahora = Date.now();
  const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET, ahora);
  assert.equal(auth.verificarTokenSesion(token, process.env.MISSION_CONTROL_SESSION_SECRET, ahora + 1000), true);
  assert.equal(auth.verificarTokenSesion(`${token}x`, process.env.MISSION_CONTROL_SESSION_SECRET, ahora + 1000), false);
  assert.equal(auth.verificarTokenSesion(token, process.env.MISSION_CONTROL_SESSION_SECRET, ahora + (9 * 60 * 60 * 1000)), false);
});

test('login válido entrega cookie HttpOnly y SameSite', async () => {
  const res = respuestaFalsa();
  await login({ method: 'POST', body: { password: 'prueba-local-segura' }, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Set-Cookie'], /HttpOnly/);
  assert.match(res.headers['Set-Cookie'], /SameSite=Strict/);
  assert.match(res.headers['Set-Cookie'], /Secure/);
});

test('login inválido devuelve 401 sin cookie', async () => {
  const res = respuestaFalsa();
  await login({ method: 'POST', body: { password: 'incorrecta' }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('cookie firmada permite continuar a un endpoint protegido', () => {
  const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET);
  const res = respuestaFalsa();
  const permitido = auth.requireAuth({
    headers: { cookie: `${auth.COOKIE_NAME}=${encodeURIComponent(token)}` },
  }, res);
  assert.equal(permitido, true);
  assert.equal(res.statusCode, 0);
});

test('CRM anónimo devuelve 401 antes de consultar Google', async () => {
  const res = respuestaFalsa();
  await crm({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('Campo anónimo devuelve 401 antes de guardar blobs', async () => {
  const res = respuestaFalsa();
  await campo({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
});
