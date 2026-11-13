const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const auth = require('../lib/auth');
const storage = require('../lib/campo-storage');
const campo = require('../api/campo-visitas');
const archivo = require('../api/campo-archivo');

const JFIF = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9]);
const EXIF = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(8)]);

function jpeg({ conExif = false } = {}) {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), JFIF, ...(conExif ? [EXIF] : []), SCAN]);
}

function dataUrl(buffer, mime = 'image/jpeg') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function respuestaFalsa() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    end(body) { this.body = body || ''; },
  };
}

function cookieValida() {
  const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET);
  return `${auth.COOKIE_NAME}=${encodeURIComponent(token)}`;
}

function visitaBase() {
  return { cliente: 'PRUEBA SINTÉTICA', servicio: 'portones', telefono: '0000000000', direccion: 'PRUEBA — SIN DOMICILIO REAL' };
}

const envAnterior = {};
const VARIABLES = ['MISSION_CONTROL_PASSWORD', 'MISSION_CONTROL_SESSION_SECRET', 'BLOB_PRIVATE_READ_WRITE_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'NODE_ENV'];
let cwdAnterior;
let dirTemporal;

test.beforeEach(() => {
  for (const nombre of VARIABLES) envAnterior[nombre] = process.env[nombre];
  process.env.MISSION_CONTROL_PASSWORD = 'prueba-local-segura';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'secreto-local-de-prueba-con-longitud-suficiente';
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.env.NODE_ENV = 'test';
  cwdAnterior = process.cwd();
  dirTemporal = fs.mkdtempSync(path.join(os.tmpdir(), 'campo-privado-'));
  process.chdir(dirTemporal);
});

test.afterEach(() => {
  process.chdir(cwdAnterior);
  fs.rmSync(dirTemporal, { recursive: true, force: true });
  for (const nombre of VARIABLES) {
    if (envAnterior[nombre] === undefined) delete process.env[nombre];
    else process.env[nombre] = envAnterior[nombre];
  }
});

function archivosGuardados() {
  const raiz = path.join(dirTemporal, '.dev-storage');
  if (!fs.existsSync(raiz)) return [];
  return fs.readdirSync(raiz, { recursive: true }).filter((item) => fs.statSync(path.join(raiz, item)).isFile());
}

test('detecta EXIF en JPEG y acepta JPEG limpio', () => {
  assert.equal(storage.jpegTieneExif(jpeg()), false);
  assert.equal(storage.jpegTieneExif(jpeg({ conExif: true })), true);
});

test('visita con foto limpia guarda en privado y devuelve solo URL protegida', async () => {
  const res = respuestaFalsa();
  await campo({
    method: 'POST',
    headers: { cookie: cookieValida() },
    body: { visita: visitaBase(), fotos: [{ nombre: 'Foto A.HEIC', dataUrl: dataUrl(jpeg()) }] },
  }, res);

  assert.equal(res.statusCode, 200, res.body);
  const { visita } = JSON.parse(res.body);
  assert.equal(visita.fotos.length, 1);
  assert.match(visita.fotos[0].url, /^\/api\/campo-archivo\?path=campo%2Ffotos%2Fvis-/);
  assert.match(visita.registroUrl, /^\/api\/campo-archivo\?path=campo%2Fvisitas%2Fvis-/);
  assert.doesNotMatch(res.body, /blob\.vercel-storage\.com|public/);
  assert.equal(archivosGuardados().length, 2);
});

test('foto con EXIF/GPS se rechaza y no se escribe ningún archivo', async () => {
  const res = respuestaFalsa();
  await campo({
    method: 'POST',
    headers: { cookie: cookieValida() },
    body: { visita: visitaBase(), fotos: [{ nombre: 'a', dataUrl: dataUrl(jpeg()) }, { nombre: 'b', dataUrl: dataUrl(jpeg({ conExif: true })) }] },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /EXIF/);
  assert.equal(archivosGuardados().length, 0);
});

test('rechaza más de 4 fotos, formatos no JPEG y fotos de más de 1 MB sin escribir nada', async () => {
  const casos = [
    Array.from({ length: 5 }, (_, i) => ({ nombre: `f${i}`, dataUrl: dataUrl(jpeg()) })),
    [{ nombre: 'png', dataUrl: dataUrl(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png') }],
    [{ nombre: 'falso', dataUrl: dataUrl(Buffer.from('<html></html>')) }],
    [{ nombre: 'grande', dataUrl: dataUrl(Buffer.concat([jpeg(), Buffer.alloc(1000001)])) }],
  ];
  for (const fotos of casos) {
    const res = respuestaFalsa();
    await campo({ method: 'POST', headers: { cookie: cookieValida() }, body: { visita: visitaBase(), fotos } }, res);
    assert.equal(res.statusCode, 400, res.body);
  }
  assert.equal(archivosGuardados().length, 0);
});

test('en producción sin Blob privado responde 503 y no cae al store público', async () => {
  process.env.NODE_ENV = 'production';
  process.env.BLOB_READ_WRITE_TOKEN = 'token-publico-que-no-debe-usarse';
  const res = respuestaFalsa();
  await campo({
    method: 'POST',
    headers: { cookie: cookieValida() },
    body: { visita: visitaBase(), fotos: [{ nombre: 'a', dataUrl: dataUrl(jpeg()) }] },
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(archivosGuardados().length, 0);
});

test('si falla una escritura a mitad, borra lo que ya se había subido', async () => {
  const subidos = [];
  const borrados = [];
  let llamadas = 0;
  const blobFalso = {
    put: async (ruta, _cuerpo, opciones) => {
      assert.equal(opciones.access, 'private');
      assert.equal(opciones.token, 'token-privado');
      llamadas += 1;
      if (llamadas === 2) throw new Error('red caída');
      subidos.push(ruta);
      return {};
    },
    del: async (rutas) => { borrados.push(...rutas); },
  };
  const almacen = storage.crearAlmacenCampo({ env: { BLOB_PRIVATE_READ_WRITE_TOKEN: 'token-privado', NODE_ENV: 'production' }, blob: blobFalso });
  assert.equal(almacen.modo, 'vercel-blob-private');
  const ruta1 = 'campo/fotos/vis-1794550000000-abcdef/01-a.jpg';
  await almacen.guardar(ruta1, jpeg());
  await assert.rejects(() => almacen.guardar('campo/fotos/vis-1794550000000-abcdef/02-b.jpg', jpeg()), /red caída/);
  await almacen.borrar(subidos);
  assert.deepEqual(borrados, [ruta1]);
});

test('archivo protegido: 401 sin sesión, 401 con sesión vencida, 200 con sesión', async () => {
  const guardado = respuestaFalsa();
  await campo({
    method: 'POST',
    headers: { cookie: cookieValida() },
    body: { visita: visitaBase(), fotos: [{ nombre: 'a', dataUrl: dataUrl(jpeg()) }] },
  }, guardado);
  const ruta = JSON.parse(guardado.body).visita.fotos[0].pathname;

  const anonimo = respuestaFalsa();
  await archivo({ method: 'GET', headers: {}, query: { path: ruta } }, anonimo);
  assert.equal(anonimo.statusCode, 401);

  const vencido = respuestaFalsa();
  const tokenViejo = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET, Date.now() - (9 * 60 * 60 * 1000));
  await archivo({ method: 'GET', headers: { cookie: `${auth.COOKIE_NAME}=${encodeURIComponent(tokenViejo)}` }, query: { path: ruta } }, vencido);
  assert.equal(vencido.statusCode, 401);

  const valido = respuestaFalsa();
  await archivo({ method: 'GET', headers: { cookie: cookieValida() }, url: `/api/campo-archivo?path=${encodeURIComponent(ruta)}` }, valido);
  assert.equal(valido.statusCode, 200);
  assert.equal(valido.headers['Content-Type'], 'image/jpeg');
  assert.equal(valido.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(Buffer.from(valido.body), jpeg());
});

test('archivo protegido rechaza rutas fuera de Campo o con traversal', async () => {
  const rutas = ['../.env', 'campo/fotos/../../secreto.jpg', 'crm/export.json', 'campo/fotos/vis-1/01-a.jpg', ''];
  for (const ruta of rutas) {
    const res = respuestaFalsa();
    await archivo({ method: 'GET', headers: { cookie: cookieValida() }, query: { path: ruta } }, res);
    assert.equal(res.statusCode, 400, ruta);
  }
});

test('lectura en Blob usa acceso privado con el token privado', async () => {
  let opcionesGet;
  const blobFalso = {
    get: async (_ruta, opciones) => {
      opcionesGet = opciones;
      return { statusCode: 200, stream: new Blob([jpeg()]).stream() };
    },
  };
  const almacen = storage.crearAlmacenCampo({ env: { BLOB_PRIVATE_READ_WRITE_TOKEN: 'token-privado', NODE_ENV: 'production' }, blob: blobFalso });
  const contenido = await almacen.leer('campo/fotos/vis-1794550000000-abcdef/01-a.jpg');
  assert.deepEqual(contenido, jpeg());
  assert.equal(opcionesGet.access, 'private');
  assert.equal(opcionesGet.token, 'token-privado');
});
