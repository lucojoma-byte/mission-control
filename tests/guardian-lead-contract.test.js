const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ESTADOS_LEAD,
  CANALES_LEAD,
  normalizarLeadGuardian,
  validarLeadGuardian,
  buscarLeadDuplicado,
  prospectoCrmALeadGuardian,
} = require('../lib/guardian-lead-contract');

const leadBase = {
  leadId: 'LE-202701-0001',
  fecha: '2027-01-05',
  nombre: 'Cliente de prueba',
  contacto: '33 0000 0000',
  linea: 'portones',
  tipoProyecto: 'portón corredizo manual residencial',
  canal: 'whatsapp',
  estado: 'nuevo',
  notas: 'Caso ficticio. No contactar.',
};

test('normaliza un lead de portones al contrato canónico sin inventar datos', () => {
  const normal = normalizarLeadGuardian({
    ...leadBase,
    nombre: '  Cliente de prueba  ',
    canal: 'WhatsApp',
    estado: 'Nuevo',
  });

  assert.deepEqual(normal, {
    schemaVersion: 'guardian.lead.v1',
    leadId: 'LE-202701-0001',
    fecha: '2027-01-05',
    nombre: 'Cliente de prueba',
    contacto: '33 0000 0000',
    linea: 'portones',
    tipoProyecto: 'portón corredizo manual residencial',
    canal: 'whatsapp',
    estado: 'nuevo',
    notas: 'Caso ficticio. No contactar.',
    origen: 'manual',
    revision: true,
  });
});

test('rechaza estados y canales fuera del pipeline Guardián', () => {
  const errores = validarLeadGuardian({
    ...leadBase,
    estado: 'calificado',
    canal: 'maps',
  });

  assert.deepEqual(ESTADOS_LEAD, ['nuevo', 'por_cotizar', 'cotizado', 'ganado', 'perdido']);
  assert.ok(CANALES_LEAD.includes('google_maps'));
  assert.match(errores.join(' | '), /Estado no permitido/);
  assert.match(errores.join(' | '), /Canal no permitido/);
});

test('exige identidad, línea y datos mínimos antes de preparar una escritura', () => {
  const errores = validarLeadGuardian({
    leadId: '',
    fecha: '',
    nombre: '',
    contacto: '',
    linea: '',
    tipoProyecto: '',
    canal: 'otro',
    estado: 'nuevo',
  });

  assert.ok(errores.includes('leadId es obligatorio.'));
  assert.ok(errores.includes('Fecha es obligatoria.'));
  assert.ok(errores.includes('Nombre es obligatorio.'));
  assert.ok(errores.includes('Contacto es obligatorio.'));
  assert.ok(errores.includes('Linea es obligatoria.'));
  assert.ok(errores.includes('TipoProyecto es obligatorio.'));
});

test('exige canal y estado como parte del contrato canónico', () => {
  const errores = validarLeadGuardian({
    ...leadBase,
    canal: '',
    estado: '',
  });

  assert.ok(errores.includes('Canal es obligatorio.'));
  assert.ok(errores.includes('Estado es obligatorio.'));
});

test('un campo canónico vacío no se reemplaza silenciosamente por su alias legacy', () => {
  const normal = normalizarLeadGuardian({
    ...leadBase,
    nombre: '',
    Nombre: 'Valor legacy que no debe sobrescribir',
  });

  assert.equal(normal.nombre, '');
  assert.ok(validarLeadGuardian(normal).includes('Nombre es obligatorio.'));
});

test('detecta reintentos por leadId y evita depender del nombre del cliente', () => {
  const filas = [
    { leadId: 'LE-202701-0001', nombre: 'Nombre original' },
    { leadId: 'LE-202701-0002', nombre: 'Mismo nombre' },
  ];

  assert.equal(buscarLeadDuplicado(filas, { leadId: '  le-202701-0001  ', nombre: 'Nombre cambiado' }), filas[0]);
  assert.equal(buscarLeadDuplicado(filas, { leadId: 'LE-202701-0003', nombre: 'Mismo nombre' }), null);
});

test('traduce los estados heredados de Guardian Ops al pipeline canónico', () => {
  const baseCrm = {
    leadId: 'LE-202701-0004',
    creadoEn: '2027-01-05T18:00:00.000Z',
    cliente: 'Caso ficticio',
    telefono: '33 0000 0000',
    interes: 'portón corredizo manual residencial',
    estado: 'Calificado',
    resumen: 'Datos de simulación.',
  };

  const lead = prospectoCrmALeadGuardian(baseCrm, {
    linea: 'portones',
    canal: 'whatsapp',
  });

  assert.equal(lead.fecha, '2027-01-05');
  assert.equal(lead.estado, 'por_cotizar');
  assert.equal(lead.linea, 'portones');
  assert.equal(lead.tipoProyecto, 'portón corredizo manual residencial');
  assert.equal(lead.revision, true);
});

test('traduce la etiqueta heredada Pendiente a nuevo', () => {
  const lead = prospectoCrmALeadGuardian({
    leadId: 'LE-202701-0005',
    creadoEn: '2027-01-05T18:00:00.000Z',
    cliente: 'Caso ficticio',
    telefono: '33 0000 0000',
    interes: 'portón residencial',
    estado: 'Pendiente',
  });

  assert.equal(lead.estado, 'nuevo');
});
