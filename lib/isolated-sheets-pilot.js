async function createIsolatedSheetTarget({ sheets, runId, testSpreadsheetId }) {
  const sheetName = 'CRM_TEST';
  if (testSpreadsheetId) {
    return {
      spreadsheetId: testSpreadsheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${testSpreadsheetId}`,
      sheetName,
      mode: 'configured_test_spreadsheet',
    };
  }

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Guardian Atomic Pilot ${runId}` },
      sheets: [{ properties: { title: sheetName } }],
    },
    fields: 'spreadsheetId,spreadsheetUrl',
  });
  return {
    spreadsheetId: created.data.spreadsheetId,
    spreadsheetUrl: created.data.spreadsheetUrl,
    sheetName,
    mode: 'new_spreadsheet',
  };
}

module.exports = { createIsolatedSheetTarget };
