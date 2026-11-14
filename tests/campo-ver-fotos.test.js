const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const auth = require('../lib/auth');
const campo = require('../api/campo-visitas');
const verFotos = require('../api/campo-fotos');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9]);

function respuestaFalsa() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    end(body) { this.body = String(body || ''); },
  };
}

function cookie() {
  const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET);
  return `${auth.COOKIE_NAME}=${encodeURIComponent(token)}`;
}

const VARIABLES = ['MISSION_CONTROL_PASSWORD', 'MISSION_CONTROL_SESSION_SECRET', 'BLOB_PRIVATE_READ_WRITE_TOKEN', 'NODE_ENV'];
const anteriores = {};
let cwdAnterior;
let dir;

test.beforeEach(() => {
  for (const nombre of VARIABLES) anteriores[nombre] = process.env[nombre];
  process.env.MISSION_CONTROL_PASSWORD = 'prueba-local-segura';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'secreto-local-de-prueba-con-longitud-suficiente';
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  process.env.NODE_ENV = 'test';
  cwdAnterior = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ver-fotos-'));
  process.chdir(dir);
});

test.afterEach(() => {
  process.chdir(cwdAnterior);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const nombre of VARIABLES) {
    if (anteriores[nombre] === undefined) delete process.env[nombre];
    else process.env[nombre] = anteriores[nombre];
  }
});

async function guardarVisita(cliente) {
  const res = respuestaFalsa();
  await campo({
    method: 'POST',
    headers: { cookie: cookie() },
    body: {
      visita: { cliente, servicio: 'Pérgola', zona: 'Zapopan' },
      fotos: [{ nombre: 'a', dataUrl: `data:image/jpeg;base64,${JPEG.toString('base64')}` }],
    },
  }, res);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body).visita;
}

test('sin sesión muestra formulario de acceso y ninguna foto', async () => {
  const visita = await guardarVisita('PRUEBA SINTÉTICA');
  const res = respuestaFalsa();
  await verFotos({ method: 'GET', headers: {}, query: { visita: visita.id } }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.body, /type="password"/);
  assert.doesNotMatch(res.body, /campo-archivo/);
  assert.doesNotMatch(res.body, /PRUEBA SINTÉTICA/);
});

test('con sesión muestra IDs, servicio, zona y fotos por enlace protegido', async () => {
  const visita = await guardarVisita('PRUEBA SINTÉTICA');
  const res = respuestaFalsa();
  await verFotos({ method: 'GET', headers: { cookie: cookie() }, url: `/api/campo-fotos?visita=${visita.id}` }, res);
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.body, new RegExp(visita.ticketId));
  assert.match(res.body, /Pérgola · Zapopan/);
  assert.match(res.body, /<img src="\/api\/campo-archivo\?path=campo%2Ffotos%2F/);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('escapa el nombre del cliente (sin inyección de HTML)', async () => {
  const visita = await guardarVisita('<script>alert(1)</script>');
  const res = respuestaFalsa();
  await verFotos({ method: 'GET', headers: { cookie: cookie() }, query: { visita: visita.id } }, res);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert/);
  assert.match(res.body, /&lt;script&gt;/);
});

test('rechaza IDs de visita inválidos y responde 404 si no existe', async () => {
  for (const id of ['../x', 'vis-1', '', 'vis-1794550000000-ABCDEF']) {
    const res = respuestaFalsa();
    await verFotos({ method: 'GET', headers: { cookie: cookie() }, query: { visita: id } }, res);
    assert.equal(res.statusCode, 400, id);
  }
  const res = respuestaFalsa();
  await verFotos({ method: 'GET', headers: { cookie: cookie() }, query: { visita: 'vis-1794550000000-abcdef' } }, res);
  assert.equal(res.statusCode, 404);
});
