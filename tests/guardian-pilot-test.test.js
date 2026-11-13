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
    if (passwordAnterior === undefined) delete process.env.MISSION_CONTROL_PASSWORD;
    else process.env.MISSION_CONTROL_PASSWORD = passwordAnterior;
    if (secretAnterior === undefined) delete process.env.MISSION_CONTROL_SESSION_SECRET;
    else process.env.MISSION_CONTROL_SESSION_SECRET = secretAnterior;
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
    if (passwordAnterior === undefined) delete process.env.MISSION_CONTROL_PASSWORD;
    else process.env.MISSION_CONTROL_PASSWORD = passwordAnterior;
    if (secretAnterior === undefined) delete process.env.MISSION_CONTROL_SESSION_SECRET;
    else process.env.MISSION_CONTROL_SESSION_SECRET = secretAnterior;
  }
});
