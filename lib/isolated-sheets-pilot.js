async function createIsolatedSheetTarget({ sheets, runId, fallbackSpreadsheetId }) {
  const sheetName = 'CRM_TEST';
  try {
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
  } catch (error) {
    const permissionDenied = error?.code === 403 || /does not have permission/i.test(String(error?.message || ''));
    if (!permissionDenied || !fallbackSpreadsheetId) throw error;
  }

  const isolatedName = `GUARDIAN_ATOMIC_TEST_${runId}`;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: fallbackSpreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: isolatedName } } }] },
  });
  return {
    spreadsheetId: fallbackSpreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${fallbackSpreadsheetId}`,
    sheetName: isolatedName,
    mode: 'isolated_worksheet',
  };
}

module.exports = { createIsolatedSheetTarget };
