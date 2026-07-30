const test = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedSheetTarget } = require('../lib/isolated-sheets-pilot');

test('crea spreadsheet independiente cuando Google lo permite', async () => {
  const sheets = { spreadsheets: {
    create: async () => ({ data: { spreadsheetId: 'new-sheet', spreadsheetUrl: 'https://example.invalid/new-sheet' } }),
    batchUpdate: async () => { throw new Error('no debe llamarse'); },
  } };
  const result = await createIsolatedSheetTarget({ sheets, runId: 123, fallbackSpreadsheetId: 'fallback' });
  assert.deepEqual(result, {
    spreadsheetId: 'new-sheet', spreadsheetUrl: 'https://example.invalid/new-sheet',
    sheetName: 'CRM_TEST', mode: 'new_spreadsheet',
  });
});

test('si la cuenta no puede crear archivo usa una pestaña aislada sin tocar CRM_PROVISIONAL', async () => {
  let addRequest;
  const sheets = { spreadsheets: {
    create: async () => { const error = new Error('The caller does not have permission'); error.code = 403; throw error; },
    batchUpdate: async (input) => { addRequest = input; return { data: {} }; },
  } };
  const result = await createIsolatedSheetTarget({ sheets, runId: 123, fallbackSpreadsheetId: 'shared-sheet' });
  assert.equal(result.spreadsheetId, 'shared-sheet');
  assert.equal(result.sheetName, 'GUARDIAN_ATOMIC_TEST_123');
  assert.equal(result.mode, 'isolated_worksheet');
  assert.equal(addRequest.requestBody.requests[0].addSheet.properties.title, 'GUARDIAN_ATOMIC_TEST_123');
  assert.notEqual(result.sheetName, 'CRM_PROVISIONAL');
});

test('no usa fallback para errores distintos a permisos', async () => {
  const sheets = { spreadsheets: {
    create: async () => { throw new Error('network unavailable'); },
    batchUpdate: async () => {},
  } };
  await assert.rejects(
    () => createIsolatedSheetTarget({ sheets, runId: 123, fallbackSpreadsheetId: 'shared-sheet' }),
    /network unavailable/,
  );
});
