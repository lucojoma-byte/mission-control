const { google } = require('googleapis');

const SPREADSHEET_ID_POR_DEFECTO = '11t7qh7tnS6za21FAfa9ZCeG3r0hnB7uFmqUkZLK0d2E';
const HOJA_POR_DEFECTO = 'CRM_PROVISIONAL';

function responderJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function normalizarBody(body) {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

function valorTexto(valor) {
  return String(valor || '').trim();
}

function privateKeyNormalizada() {
  return valorTexto(process.env.GOOGLE_SHEETS_PRIVATE_KEY).replace(/\\n/g, '\n');
}

function credencialesDisponibles() {
  return Boolean(valorTexto(process.env.GOOGLE_SHEETS_CLIENT_EMAIL) && privateKeyNormalizada());
}

function authGoogle() {
  return new google.auth.JWT({
    email: valorTexto(process.env.GOOGLE_SHEETS_CLIENT_EMAIL),
    key: privateKeyNormalizada(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function filaDesdeProspecto(prospecto = {}, visita = null) {
  const ahora = new Date().toISOString();
  const notas = valorTexto(prospecto.notasSheets || prospecto.resumen);
  return [
    valorTexto(prospecto.leadId),
    valorTexto(prospecto.creadoEn || ahora),
    ahora,
    valorTexto(prospecto.cliente),
    valorTexto(prospecto.telefono),
    valorTexto(prospecto.direccion || visita?.direccion),
    valorTexto(prospecto.zona),
    valorTexto(process.env.GOOGLE_SHEETS_LINEA || 'Guardián'),
    valorTexto(prospecto.interes),
    valorTexto(process.env.GOOGLE_SHEETS_CANAL || ''),
    valorTexto(process.env.GOOGLE_SHEETS_FUENTE || 'Mission Control'),
    valorTexto(prospecto.estado),
    valorTexto(prospecto.siguienteAccion),
    valorTexto(prospecto.fechaSeguimiento || visita?.fechaSeguimiento),
    valorTexto(prospecto.responsable || visita?.responsable),
    notas,
    valorTexto(prospecto.clienteId),
    valorTexto(prospecto.ticketId),
    valorTexto(prospecto.miembroClub),
    valorTexto(prospecto.nps),
    valorTexto(prospecto.score),
    valorTexto(prospecto.margenReal),
    valorTexto(prospecto.origen || (visita ? 'campo' : 'manual')),
  ];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  try {
    if (!credencialesDisponibles()) {
      return responderJson(res, 503, {
        ok: false,
        error: 'Faltan GOOGLE_SHEETS_CLIENT_EMAIL y GOOGLE_SHEETS_PRIVATE_KEY en el backend.',
      });
    }

    const body = normalizarBody(req.body);
    const prospecto = body && typeof body.prospecto === 'object' ? body.prospecto : null;
    const visita = body && typeof body.visita === 'object' ? body.visita : null;

    if (!prospecto || !valorTexto(prospecto.cliente)) {
      return responderJson(res, 400, { ok: false, error: 'El nombre del cliente es obligatorio.' });
    }

    const auth = authGoogle();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = valorTexto(process.env.GOOGLE_SHEETS_SPREADSHEET_ID) || SPREADSHEET_ID_POR_DEFECTO;
    const sheetName = valorTexto(process.env.GOOGLE_SHEETS_SHEET_NAME) || HOJA_POR_DEFECTO;

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:W`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [filaDesdeProspecto(prospecto, visita)],
      },
    });

    return responderJson(res, 200, {
      ok: true,
      sheet: {
        spreadsheetId,
        sheetName,
        updatedRange: response.data.updates?.updatedRange || '',
        updatedRows: response.data.updates?.updatedRows || 0,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return responderJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo escribir en Google Sheets.',
    });
  }
};
