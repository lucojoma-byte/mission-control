const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CANONICAL_HEADERS,
  GoogleSheetsLeadRepository,
  leadToCanonicalRow,
} = require('../lib/google-sheets-lead-repository');

const lead = {
  leadId: 'GDN-TEST-1', fecha: '2026-07-30', nombre: 'Lead Ficticio',
  contacto: '3330000000', linea: 'portones', tipoProyecto: 'corredizo_manual',
  canal: 'whatsapp', estado: 'nuevo', notas: 'prueba aislada',
};

test('fila canónica conserva el orden de nueve columnas', () => {
  assert.deepEqual(CANONICAL_HEADERS, [
    'leadId', 'Fecha', 'Nombre', 'Contacto', 'Linea', 'TipoProyecto', 'Canal', 'Estado', 'Notas',
  ]);
  assert.deepEqual(leadToCanonicalRow(lead), [
    'GDN-TEST-1', '2026-07-30', 'Lead Ficticio', '3330000000', 'portones',
    'corredizo_manual', 'whatsapp', 'nuevo', 'prueba aislada',
  ]);
});

test('repositorio agrega una sola fila al rango canónico', async () => {
  let request;
  const sheets = { spreadsheets: { values: { append: async (input) => { request = input; return { data: { updates: { updatedRows: 1 } } }; } } } };
  const repository = new GoogleSheetsLeadRepository({ sheets, spreadsheetId: 'sheet-test', sheetName: 'CRM_TEST' });

  const result = await repository.append(lead);

  assert.equal(request.range, "'CRM_TEST'!A:I");
  assert.equal(request.valueInputOption, 'RAW');
  assert.deepEqual(request.requestBody.values, [leadToCanonicalRow(lead)]);
  assert.equal(result.updatedRows, 1);
});
