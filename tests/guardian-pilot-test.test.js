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

test('diagnóstico de piloto rechaza solicitudes anónimas antes de tocar servicios externos', async () => {
  const handler = require('../api/guardian-pilot-test');
  const req = { method: 'POST', headers: {}, body: { action: 'blob_probe' } };
  const res = responseCapture();

  await handler(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body).error, 'Autenticación requerida.');
});
