const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const auth = require('../lib/auth');
const login = require('../api/auth-login');
const usuarios = require('../api/usuarios');
const sesion = require('../api/sesion');
const crm = require('../api/crm-prospectos');
const campo = require('../api/campo-visitas');
const archivo = require('../api/campo-archivo');

function respuestaFalsa() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    end(body) { this.body = String(body || ''); },
  };
}

function cookieDe(identidad) {
  const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET, Date.now(), identidad);
  return `${auth.COOKIE_NAME}=${encodeURIComponent(token)}`;
}

const DUENO = { ...auth.DUENO };
const SECRE = { usuario: 'ana.secre', nombre: 'Ana', rol: 'secretaria' };
const CAMPO = { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo' };

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usuarios-'));
  process.chdir(dir);
  login._resetRateLimitForTests();
});

test.afterEach(() => {
  process.chdir(cwdAnterior);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const nombre of VARIABLES) {
    if (anteriores[nombre] === undefined) delete process.env[nombre];
    else process.env[nombre] = anteriores[nombre];
  }
});

async function llamar(handler, req) {
  const res = respuestaFalsa();
  await handler({ headers: {}, ...req }, res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
}

async function crear(actor, datos) {
  return llamar(usuarios, { method: 'POST', headers: { cookie: cookieDe(actor) }, body: { accion: 'crear', ...datos } });
}

test('Dueño crea Secretaria y Campo; la lista nunca expone contraseñas', async () => {
  assert.equal((await crear(DUENO, { usuario: 'ana.secre', nombre: 'Ana', rol: 'secretaria', password: 'secreta-ana-01' })).status, 201);
  assert.equal((await crear(DUENO, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo', password: 'secreto-luis-01' })).status, 201);
  const lista = await llamar(usuarios, { method: 'GET', headers: { cookie: cookieDe(DUENO) } });
  assert.equal(lista.status, 200);
  assert.equal(lista.body.usuarios.length, 2);
  assert.doesNotMatch(JSON.stringify(lista.body), /"hash"|"salt"|secreta-ana|secreto-luis/);
});

test('Secretaria solo crea usuarios de Campo; Campo no administra usuarios', async () => {
  assert.equal((await crear(SECRE, { usuario: 'pepe.campo', nombre: 'Pepe', rol: 'campo', password: 'secreto-pepe-01' })).status, 201);
  assert.equal((await crear(SECRE, { usuario: 'otra.secre', nombre: 'Otra', rol: 'secretaria', password: 'secreto-otra-01' })).status, 403);
  assert.equal((await crear(SECRE, { usuario: 'otro.dueno', nombre: 'Otro', rol: 'dueno', password: 'secreto-otro-01' })).status, 403);
  assert.equal((await llamar(usuarios, { method: 'GET', headers: { cookie: cookieDe(CAMPO) } })).status, 403);
});

test('valida usuario, contraseña mínima y duplicados', async () => {
  assert.equal((await crear(DUENO, { usuario: 'X', nombre: 'X', rol: 'campo', password: 'secreto-largo-01' })).status, 400);
  assert.equal((await crear(DUENO, { usuario: 'dueno', nombre: 'X', rol: 'campo', password: 'secreto-largo-01' })).status, 400);
  assert.equal((await crear(DUENO, { usuario: 'corto.pw', nombre: 'X', rol: 'campo', password: 'corta' })).status, 400);
  assert.equal((await crear(DUENO, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo', password: 'secreto-luis-01' })).status, 201);
  assert.equal((await crear(DUENO, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo', password: 'secreto-luis-01' })).status, 409);
});

test('login por usuario da sesión con su rol; contraseña mala o usuario desactivado no entra', async () => {
  await crear(DUENO, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo', password: 'secreto-luis-01' });

  const ok = await llamar(login, { method: 'POST', body: { usuario: 'Luis.Campo', password: 'secreto-luis-01' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.sesion, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo' });
  const cookie = ok.headers['Set-Cookie'].split(';')[0];
  const quien = await llamar(sesion, { method: 'GET', headers: { cookie } });
  assert.equal(quien.body.sesion.rol, 'campo');

  assert.equal((await llamar(login, { method: 'POST', body: { usuario: 'luis.campo', password: 'incorrecta-123' } })).status, 401);

  await llamar(usuarios, { method: 'POST', headers: { cookie: cookieDe(DUENO) }, body: { accion: 'desactivar', usuario: 'luis.campo' } });
  assert.equal((await llamar(login, { method: 'POST', body: { usuario: 'luis.campo', password: 'secreto-luis-01' } })).status, 401);
});

test('el Dueño sigue entrando sin usuario con la contraseña principal', async () => {
  const ok = await llamar(login, { method: 'POST', body: { password: 'prueba-local-segura' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.sesion.rol, 'dueno');
});

test('Campo no puede leer la cartera del CRM', async () => {
  const res = await llamar(crm, { method: 'GET', headers: { cookie: cookieDe(CAMPO) } });
  assert.equal(res.status, 403);
});

test('cada visita registra quién la capturó y lo usa como responsable', async () => {
  const res = await llamar(campo, {
    method: 'POST',
    headers: { cookie: cookieDe(CAMPO) },
    body: { visita: { cliente: 'PRUEBA SINTÉTICA', servicio: 'Pérgola' }, fotos: [] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.visita.capturadoPor, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo' });
  assert.equal(res.body.visita.responsable, 'Luis');
  const registro = JSON.parse(fs.readFileSync(path.join(dir, '.dev-storage', res.body.visita.registroPath), 'utf8'));
  assert.equal(registro.capturadoPor.usuario, 'luis.campo');
});

test('el archivo de usuarios nunca se sirve por el visor de archivos', async () => {
  await crear(DUENO, { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo', password: 'secreto-luis-01' });
  const res = await llamar(archivo, { method: 'GET', headers: { cookie: cookieDe(DUENO) }, query: { path: 'sistema/usuarios.json' } });
  assert.equal(res.status, 400);
});
