const test = require('node:test');
const assert = require('node:assert/strict');

const {
  crearRepositorioLeadsEnMemoria,
  prospectoCrmALeadGuardian,
} = require('../lib/guardian-lead-contract');

function leadFicticio(sobrescribir = {}) {
  return prospectoCrmALeadGuardian({
    leadId: 'LE-202701-0001',
    creadoEn: '2027-01-05T18:00:00.000Z',
    cliente: 'Caso ficticio',
    telefono: '33 0000 0000',
    interes: 'portón corredizo manual residencial',
    estado: 'Nuevo',
    resumen: 'Simulación; no contactar.',
    ...sobrescribir,
  }, {
    linea: 'portones',
    canal: 'whatsapp',
  });
}

test('simulación aislada: un reintento por leadId no crea una segunda fila', async () => {
  const repositorio = crearRepositorioLeadsEnMemoria();

  const primera = await repositorio.guardarSiAusente(leadFicticio());
  const reintento = await repositorio.guardarSiAusente(leadFicticio({
    cliente: 'Nombre corregido',
  }));

  assert.equal(primera.insertado, true);
  assert.equal(reintento.insertado, false);
  assert.equal(reintento.idempotent, true);
  assert.equal(repositorio.listar().length, 1);
  assert.equal(repositorio.listar()[0].nombre, 'Caso ficticio');
});

test('simulación aislada: dos reintentos inmediatos con el mismo leadId insertan una sola vez', async () => {
  const repositorio = crearRepositorioLeadsEnMemoria();
  const resultados = await Promise.all([
    repositorio.guardarSiAusente(leadFicticio()),
    repositorio.guardarSiAusente(leadFicticio()),
  ]);

  assert.equal(resultados.filter((resultado) => resultado.insertado).length, 1);
  assert.equal(resultados.filter((resultado) => resultado.idempotent).length, 1);
  assert.equal(repositorio.listar().length, 1);
});
