const CANONICAL_HEADERS = Object.freeze([
  'leadId', 'Fecha', 'Nombre', 'Contacto', 'Linea', 'TipoProyecto', 'Canal', 'Estado', 'Notas',
]);

function leadToCanonicalRow(lead) {
  return [
    lead.leadId,
    lead.fecha,
    lead.nombre,
    lead.contacto,
    lead.linea,
    lead.tipoProyecto,
    lead.canal,
    lead.estado,
    lead.notas,
  ].map((value) => String(value ?? '').trim());
}

function quotedSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

class GoogleSheetsLeadRepository {
  constructor({ sheets, spreadsheetId, sheetName }) {
    if (!sheets?.spreadsheets?.values?.append || !spreadsheetId || !sheetName) {
      throw new Error('Repositorio Sheets incompleto');
    }
    this.sheets = sheets;
    this.spreadsheetId = spreadsheetId;
    this.sheetName = sheetName;
  }

  async append(lead) {
    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${quotedSheetName(this.sheetName)}!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [leadToCanonicalRow(lead)] },
    });
    return {
      updatedRows: response.data.updates?.updatedRows || 0,
      updatedRange: response.data.updates?.updatedRange || '',
    };
  }
}

module.exports = { CANONICAL_HEADERS, GoogleSheetsLeadRepository, leadToCanonicalRow, quotedSheetName };
