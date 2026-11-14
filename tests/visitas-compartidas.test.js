const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const auth = require('../lib/auth');
const campo = require('../api/campo-visitas');
const storage = require('../lib/campo-storage');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0x11, 0xff, 0xd9]);
const DUENO = { ...auth.DUENO };
const SECRE = { usuario: 'ana.secre', nombre: 'Ana', rol: 'secretaria' };
const LUIS = { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo' };
const PEPE = { usuario: 'pepe.campo', nombre: 'Pepe', rol: 'campo' };

function respuestaFalsa() {
  return { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, end(b) { this.body = String(b || ''); } };
}

function cookieDe(identidad) {
  return `${auth.COOKIE_NAME}=${encodeURIComponent(auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET, Date.now(), identidad))}`;
}

const VARIABLES = ['MISSION_CONTROL_PASSWORD', 'MISSION_CONTROL_SESSION_SECRET', 'BLOB_PRIVATE_READ_WRITE_TOKEN', 'NODE_ENV'];
const anteriores = {};
let cwdAnterior;
let dir;

test.beforeEach(() => {
  for (const n of VARIABLES) anteriores[n] = process.env[n];
  process.env.MISSION_CONTROL_PASSWORD = 'prueba-local-segura';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'secreto-local-de-prueba-con-longitud-suficiente';
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  process.env.NODE_ENV = 'test';
  cwdAnterior = process.cwd();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compartidas-'));
  process.chdir(dir);
});

test.afterEach(() => {
  process.chdir(cwdAnterior);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const n of VARIABLES) {
    if (anteriores[n] === undefined) delete process.env[n];
    else process.env[n] = anteriores[n];
  }
});

async function guardar(quien, cliente, conFoto = false) {
  const res = respuestaFalsa();
  await campo({
    method: 'POST',
    headers: { cookie: cookieDe(quien) },
    body: {
      visita: { cliente, servicio: 'Pérgola', zona: 'Zapopan' },
      fotos: conFoto ? [{ nombre: 'a', dataUrl: `data:image/jpeg;base64,${JPEG.toString('base64')}` }] : [],
    },
  }, res);
  assert.equal(res.statusCode, 200, res.body);
  await new Promise((r) => setTimeout(r, 5));
  return JSON.parse(res.body).visita;
}

async function listar(quien) {
  const res = respuestaFalsa();
  await campo({ method: 'GET', headers: quien ? { cookie: cookieDe(quien) } : {} }, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('Dueño y Secretaria ven todas las visitas, la más reciente primero', async () => {
  await guardar(LUIS, 'PRUEBA LUIS');
  await guardar(PEPE, 'PRUEBA PEPE', true);
  for (const quien of [DUENO, SECRE]) {
    const { status, body } = await listar(quien);
    assert.equal(status, 200);
    assert.deepEqual(body.visitas.map((v) => v.cliente), ['PRUEBA PEPE', 'PRUEBA LUIS']);
  }
});

test('Campo solo ve las visitas que capturó', async () => {
  await guardar(LUIS, 'PRUEBA LUIS');
  await guardar(PEPE, 'PRUEBA PEPE');
  const { body } = await listar(LUIS);
  assert.deepEqual(body.visitas.map((v) => v.cliente), ['PRUEBA LUIS']);
});

test('la lista trae IDs, quién capturó y fotos por enlace protegido', async () => {
  const guardada = await guardar(PEPE, 'PRUEBA PEPE', true);
  const { body } = await listar(SECRE);
  const visita = body.visitas[0];
  assert.equal(visita.id, guardada.id);
  assert.equal(visita.ticketId, guardada.ticketId);
  assert.equal(visita.zona, 'Zapopan');
  assert.equal(visita.capturadoPor.nombre, 'Pepe');
  assert.equal(visita.fotosRemotas.length, 1);
  assert.match(visita.fotosRemotas[0].url, /^\/api\/campo-archivo\?path=campo%2Ffotos%2F/);
  assert.match(visita.registroUrl, /^\/api\/campo-archivo\?path=campo%2Fvisitas%2F/);
});

test('sin sesión no lista nada', async () => {
  await guardar(LUIS, 'PRUEBA LUIS');
  const { status } = await listar(null);
  assert.equal(status, 401);
});

test('en Blob lista con acceso privado y ordena por fecha de subida', async () => {
  const registros = {
    'campo/visitas/vis-1794550000000-aaaaaa.json': { id: 'vis-1794550000000-aaaaaa', cliente: 'Vieja', guardadoEn: '2026-11-01T00:00:00.000Z' },
    'campo/visitas/vis-1794560000000-bbbbbb.json': { id: 'vis-1794560000000-bbbbbb', cliente: 'Nueva', guardadoEn: '2026-11-10T00:00:00.000Z' },
  };
  let opcionesList;
  const blobFalso = {
    list: async (opciones) => {
      opcionesList = opciones;
      return {
        blobs: [
          { pathname: 'campo/visitas/vis-1794550000000-aaaaaa.json', uploadedAt: '2026-11-01T00:00:00.000Z' },
          { pathname: 'campo/visitas/vis-1794560000000-bbbbbb.json', uploadedAt: '2026-11-10T00:00:00.000Z' },
          { pathname: 'campo/visitas/otro.txt', uploadedAt: '2026-11-11T00:00:00.000Z' },
        ],
        hasMore: false,
      };
    },
    get: async (ruta, opciones) => {
      assert.equal(opciones.access, 'private');
      return { statusCode: 200, stream: new Blob([JSON.stringify(registros[ruta])]).stream() };
    },
  };
  const almacen = storage.crearAlmacenCampo({ env: { BLOB_PRIVATE_READ_WRITE_TOKEN: 'token-privado', NODE_ENV: 'production' }, blob: blobFalso });
  const lista = await almacen.listarRegistros();
  assert.equal(opcionesList.prefix, 'campo/visitas/');
  assert.equal(opcionesList.token, 'token-privado');
  assert.deepEqual(lista.map((r) => r.cliente), ['Nueva', 'Vieja']);
});
