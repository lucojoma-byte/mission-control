const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const auth = require('../lib/auth');
const avisos = require('../lib/avisos');
const campo = require('../api/campo-visitas');

const REGISTRO = {
  id: 'vis-1794550000000-abcdef',
  ticketId: 'TK-000102',
  cliente: 'PRUEBA SINTÉTICA',
  telefono: '3300000000',
  direccion: 'PRUEBA — SIN DOMICILIO REAL',
  servicio: 'Pérgola',
  zona: 'Zapopan',
  capturadoPor: { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo' },
  fotos: [{ pathname: 'campo/fotos/x/01-a.jpg' }],
};

const ENV_CORREO = { AVISOS_RESEND_API_KEY: 'clave-ficticia', AVISOS_EMAIL_DE: 'Guardian <avisos@ejemplo.invalid>', AVISOS_EMAIL_PARA: 'secre@ejemplo.invalid, joe@ejemplo.invalid' };
const ENV_TELEGRAM = { AVISOS_TELEGRAM_BOT_TOKEN: '123:abc', AVISOS_TELEGRAM_CHAT_ID: '-100200' };
const REQ = { headers: { host: 'mission-control-wheat-six.vercel.app' } };

test('sin variables configuradas no envía nada', async () => {
  let llamadas = 0;
  const resultado = await avisos.avisarVisitaNueva(REGISTRO, { req: REQ, env: {}, fetchFn: async () => { llamadas += 1; } });
  assert.deepEqual(resultado, []);
  assert.equal(llamadas, 0);
});

test('correo: manda cliente, servicio, zona, quién capturó y enlace; sin teléfono ni dirección', async () => {
  const enviados = [];
  const fetchFn = async (url, opciones) => { enviados.push({ url, opciones }); return { ok: true, status: 200 }; };
  const resultado = await avisos.avisarVisitaNueva(REGISTRO, { req: REQ, env: ENV_CORREO, fetchFn });
  assert.deepEqual(resultado, [{ canal: 'correo', enviado: true }]);
  assert.equal(enviados[0].url, 'https://api.resend.com/emails');
  assert.equal(enviados[0].opciones.headers.Authorization, 'Bearer clave-ficticia');
  const cuerpo = JSON.parse(enviados[0].opciones.body);
  assert.deepEqual(cuerpo.to, ['secre@ejemplo.invalid', 'joe@ejemplo.invalid']);
  assert.match(cuerpo.subject, /PRUEBA SINTÉTICA · Pérgola/);
  assert.match(cuerpo.text, /Zona: Zapopan/);
  assert.match(cuerpo.text, /Capturó: Luis/);
  assert.match(cuerpo.text, /https:\/\/mission-control-wheat-six\.vercel\.app\/api\/campo-fotos\?visita=vis-1794550000000-abcdef/);
  assert.doesNotMatch(cuerpo.text, /3300000000|SIN DOMICILIO/);
});

test('telegram y correo juntos; si uno falla el otro se reporta enviado', async () => {
  const fetchFn = async (url) => (url.includes('telegram') ? { ok: false, status: 500 } : { ok: true, status: 200 });
  const resultado = await avisos.avisarVisitaNueva(REGISTRO, { req: REQ, env: { ...ENV_CORREO, ...ENV_TELEGRAM }, fetchFn });
  assert.deepEqual(resultado, [
    { canal: 'correo', enviado: true },
    { canal: 'telegram', enviado: false, error: 'no se pudo enviar' },
  ]);
});

test('ignora un host sospechoso y usa AVISOS_URL_BASE si existe', () => {
  assert.equal(avisos.urlBase({ headers: { host: 'evil.com/<x>' } }, {}), '');
  assert.equal(avisos.urlBase(REQ, { AVISOS_URL_BASE: 'https://ops.guardian.mx/' }), 'https://ops.guardian.mx');
});

test('guardar visita llama al aviso y no falla aunque el aviso falle', async () => {
  const anteriores = { p: process.env.MISSION_CONTROL_PASSWORD, s: process.env.MISSION_CONTROL_SESSION_SECRET, n: process.env.NODE_ENV, t: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN };
  process.env.MISSION_CONTROL_PASSWORD = 'prueba-local-segura';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'secreto-local-de-prueba-con-longitud-suficiente';
  process.env.NODE_ENV = 'test';
  delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avisos-'));
  process.chdir(dir);
  let recibido = null;
  campo._setAvisarForTests(async (registro) => { recibido = registro; throw new Error('proveedor caído'); });
  try {
    const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET, Date.now(), { usuario: 'luis.campo', nombre: 'Luis', rol: 'campo' });
    const res = { statusCode: 0, headers: {}, body: '', setHeader(n, v) { this.headers[n] = v; }, end(b) { this.body = String(b || ''); } };
    await campo({ method: 'POST', headers: { cookie: `${auth.COOKIE_NAME}=${encodeURIComponent(token)}` }, body: { visita: { cliente: 'PRUEBA SINTÉTICA', servicio: 'Pérgola' }, fotos: [] } }, res);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(recibido.cliente, 'PRUEBA SINTÉTICA');
    assert.equal(recibido.capturadoPor.nombre, 'Luis');
    assert.deepEqual(JSON.parse(res.body).visita.avisos, []);
  } finally {
    campo._setAvisarForTests(null);
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries({ MISSION_CONTROL_PASSWORD: anteriores.p, MISSION_CONTROL_SESSION_SECRET: anteriores.s, NODE_ENV: anteriores.n, BLOB_PRIVATE_READ_WRITE_TOKEN: anteriores.t })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
