const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../lib/auth');
const crm = require('../api/crm-prospectos');

function respuestaFalsa() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(nombre, valor) { this.headers[nombre] = valor; },
    end(body) { this.body = body || ''; },
  };
}

function hojaFalsa(filasIniciales) {
  const filas = filasIniciales.map((fila) => [...fila]);
  const llamadas = { append: 0 };
  return {
    filas,
    llamadas,
    spreadsheets: {
      values: {
        get: async () => ({ data: { values: filas.map((fila) => [fila[0]]) } }),
        append: async ({ requestBody }) => {
          llamadas.append += 1;
          filas.push(...requestBody.values);
          return { data: { updates: { updatedRange: `CRM_PROVISIONAL!A${filas.length}`, updatedRows: 1 } } };
        },
      },
    },
  };
}

const VARIABLES = ['MISSION_CONTROL_PASSWORD', 'MISSION_CONTROL_SESSION_SECRET', 'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY'];
const anteriores = {};

test.beforeEach(() => {
  for (const nombre of VARIABLES) anteriores[nombre] = process.env[nombre];
  process.env.MISSION_CONTROL_PASSWORD = 'prueba-local-segura';
  process.env.MISSION_CONTROL_SESSION_SECRET = 'secreto-local-de-prueba-con-longitud-suficiente';
  process.env.GOOGLE_SHEETS_CLIENT_EMAIL = 'prueba@ejemplo.invalid';
  process.env.GOOGLE_SHEETS_PRIVATE_KEY = 'clave-ficticia';
});

test.afterEach(() => {
  crm._setSheetsFactoryForTests(null);
  for (const nombre of VARIABLES) {
    if (anteriores[nombre] === undefined) delete process.env[nombre];
    else process.env[nombre] = anteriores[nombre];
  }
});

function solicitud(prospecto) {
  const token = auth.crearTokenSesion(process.env.MISSION_CONTROL_SESSION_SECRET);
  return {
    method: 'POST',
    headers: { cookie: `${auth.COOKIE_NAME}=${encodeURIComponent(token)}` },
    body: { prospecto, visita: { id: 'vis-1', direccion: 'PRUEBA — SIN DOMICILIO REAL' } },
  };
}

test('visita de Campo se escribe una vez con Cliente, Lead y Ticket ID', async () => {
  const hoja = hojaFalsa([['Lead ID']]);
  crm._setSheetsFactoryForTests(() => hoja);

  const res = respuestaFalsa();
  await crm(solicitud({ cliente: 'PRUEBA SINTÉTICA', leadId: 'LE-000101', clienteId: 'CL-000100', ticketId: 'TK-000102', origen: 'campo' }), res);

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(hoja.llamadas.append, 1);
  const fila = hoja.filas[1];
  assert.equal(fila[0], 'LE-000101');
  assert.equal(fila[16], 'CL-000100');
  assert.equal(fila[17], 'TK-000102');
  assert.equal(fila[22], 'campo');
});

test('reenviar el mismo Lead ID (Pasar a CRM o reintento) no crea otra fila', async () => {
  const hoja = hojaFalsa([['Lead ID'], ['LE-000101']]);
  crm._setSheetsFactoryForTests(() => hoja);

  const res = respuestaFalsa();
  await crm(solicitud({ cliente: 'PRUEBA SINTÉTICA', leadId: 'LE-000101' }), res);

  assert.equal(res.statusCode, 200);
  const cuerpo = JSON.parse(res.body);
  assert.equal(cuerpo.duplicate, true);
  assert.equal(cuerpo.sheet.updatedRange, 'CRM_PROVISIONAL!A2');
  assert.equal(hoja.llamadas.append, 0);
  assert.equal(hoja.filas.length, 2);
});

test('el encabezado no cuenta como duplicado', async () => {
  const hoja = hojaFalsa([['LE-000101']]);
  crm._setSheetsFactoryForTests(() => hoja);
  const res = respuestaFalsa();
  await crm(solicitud({ cliente: 'PRUEBA SINTÉTICA', leadId: 'LE-000101' }), res);
  assert.equal(hoja.llamadas.append, 1);
});
