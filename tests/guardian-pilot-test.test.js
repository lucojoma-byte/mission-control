const test = require('node:test');
const assert = require('node:assert/strict');

function responseCapture() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value = '') { this.body = value; },
  };
}

function restoreEnvironment(name, previous) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test('diagnóstico de piloto devuelve 503 cuando falta configurar acceso privado', async () => {
  const handler = require('../api/guardian-pilot-test');
  const passwordAnterior = process.env.MISSION_CONTROL_PASSWORD;
  const secretAnterior = process.env.MISSION_CONTROL_SESSION_SECRET;
  delete process.env.MISSION_CONTROL_PASSWORD;
  delete process.env.MISSION_CONTROL_SESSION_SECRET;

  try {
    const req = { method: 'POST', headers: {}, body: { action: 'blob_probe' } };
    const res = responseCapture();
    await handler(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(JSON.parse(res.body).error, 'Acceso privado no configurado.');
  } finally {
    restoreEnvironment('MISSION_CONTROL_PASSWORD', passwordAnterior);
    restoreEnvironment('MISSION_CONTROL_SESSION_SECRET', secretAnterior);
  }
});

test('diagnóstico de piloto rechaza solicitudes anónimas con acceso privado configurado', async () => {
  const handler = require('../api/guardian-pilot-test');
  const passwordAnterior = process.env.MISSION_CONTROL_PASSWORD;
  const secretAnterior = process.env.MISSION_CONTROL_SESSION_SECRET;
  process.env.MISSION_CONTROL_PASSWORD = 'test-password-only';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'test-session-secret-only';

  try {
    const req = { method: 'POST', headers: {}, body: { action: 'blob_probe' } };
    const res = responseCapture();
    await handler(req, res);

    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'Autenticación requerida.');
  } finally {
    restoreEnvironment('MISSION_CONTROL_PASSWORD', passwordAnterior);
    restoreEnvironment('MISSION_CONTROL_SESSION_SECRET', secretAnterior);
  }
});

test('diagnóstico no expone el mensaje interno cuando falla', async () => {
  const handler = require('../api/guardian-pilot-test');
  const previous = {
    password: process.env.MISSION_CONTROL_PASSWORD,
    secret: process.env.MISSION_CONTROL_SESSION_SECRET,
    enabled: process.env.GUARDIAN_PILOT_TEST_ENABLED,
    email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
    key: process.env.GOOGLE_SHEETS_PRIVATE_KEY,
  };
  process.env.MISSION_CONTROL_PASSWORD = 'test-password-only';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'test-session-secret-only';
  process.env.GUARDIAN_PILOT_TEST_ENABLED = 'true';
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'not-an-email';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = 'not-a-private-key';
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);

  try {
    const auth = require('../lib/auth');
    const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET);
    const req = {
      method: 'POST',
      headers: { cookie: `${auth.COOKIE_NAME}=${encodeURIComponent(token)}` },
      body: { action: 'full_run' },
    };
    const res = responseCapture();
    await handler(req, res);

    const payload = JSON.parse(res.body);
    assert.equal(res.statusCode, 500);
    assert.equal(payload.error, 'Falló el diagnóstico. Revisa los registros del servidor.');
    assert.doesNotMatch(payload.error, /Credenciales|Google|private/i);
    assert.equal(logs.length, 1);
  } finally {
    console.error = originalError;
    restoreEnvironment('MISSION_CONTROL_PASSWORD', previous.password);
    restoreEnvironment('MISSION_CONTROL_SESSION_SECRET', previous.secret);
    restoreEnvironment('GUARDIAN_PILOT_TEST_ENABLED', previous.enabled);
    restoreEnvironment('GOOGLE_SHEETS_CLIENT_EMAIL', previous.email);
    restoreEnvironment('GOOGLE_SHEETS_PRIVATE_KEY', previous.key);
  }
});
