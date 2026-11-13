const test = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedSheetTarget } = require('../lib/isolated-sheets-pilot');

test('crea spreadsheet independiente cuando Google lo permite', async () => {
  const sheets = { spreadsheets: {
    create: async () => ({ data: { spreadsheetId: 'new-sheet', spreadsheetUrl: 'https://example.invalid/new-sheet' } }),
  } };
  const result = await createIsolatedSheetTarget({ sheets, runId: 123 });
  assert.deepEqual(result, {
    spreadsheetId: 'new-sheet', spreadsheetUrl: 'https://example.invalid/new-sheet',
    sheetName: 'CRM_TEST', mode: 'new_spreadsheet',
  });
});

test('usa exclusivamente el spreadsheet de prueba configurado sin crear pestañas', async () => {
  const sheets = { spreadsheets: {
    create: async () => { throw new Error('no debe llamarse'); },
    batchUpdate: async () => { throw new Error('no debe llamarse'); },
  } };
  const result = await createIsolatedSheetTarget({
    sheets,
    runId: 123,
    testSpreadsheetId: 'exclusive-test-sheet',
  });
  assert.deepEqual(result, {
    spreadsheetId: 'exclusive-test-sheet',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/exclusive-test-sheet',
    sheetName: 'CRM_TEST',
    mode: 'configured_test_spreadsheet',
  });
});

test('si Google niega crear una hoja nueva falla sin tocar otro spreadsheet', async () => {
  let batchUpdateCalled = false;
  const sheets = { spreadsheets: {
    create: async () => {
      const error = new Error('The caller does not have permission');
      error.code = 403;
      throw error;
    },
    batchUpdate: async () => { batchUpdateCalled = true; },
  } };
  await assert.rejects(
    () => createIsolatedSheetTarget({ sheets, runId: 123 }),
    /does not have permission/,
  );
  assert.equal(batchUpdateCalled, false);
});

test('no usa fallback para errores distintos a permisos', async () => {
  const sheets = { spreadsheets: {
    create: async () => { throw new Error('network unavailable'); },
    batchUpdate: async () => { throw new Error('no debe llamarse'); },
  } };
  await assert.rejects(
    () => createIsolatedSheetTarget({ sheets, runId: 123 }),
    /network unavailable/,
  );
});
