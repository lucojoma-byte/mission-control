const { put } = require('@vercel/blob');
const { google } = require('googleapis');
const { requireAuth } = require('../lib/auth');
const { AtomicLeadWriter, VercelBlobClaimStore, planLegacyBackfill } = require('../lib/atomic-lead-writer');
const { CANONICAL_HEADERS, GoogleSheetsLeadRepository } = require('../lib/google-sheets-lead-repository');

function respond(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function text(value) {
  return String(value || '').trim();
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function normalizedPrivateKey() {
  const raw = text(process.env.GOOGLE_SHEETS_PRIVATE_KEY);
  const candidates = [raw, parseJson(raw), parseJson(raw.replace(/\\n/g, '\n'))]
    .flatMap((item) => (item && typeof item === 'object' ? [item.private_key, item.key] : [item]))
    .filter(Boolean);
  for (const candidate of candidates) {
    const clean = text(candidate).replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n');
    const start = clean.indexOf('-----BEGIN ' + 'PRIVATE KEY-----');
    const end = clean.indexOf('-----END ' + 'PRIVATE KEY-----');
    if (start >= 0 && end >= 0) return clean.slice(start, end + '-----END PRIVATE KEY-----'.length);
  }
  return raw.replace(/\\n/g, '\n');
}

function sheetsClient() {
  const auth = new google.auth.JWT({
    email: text(process.env.GOOGLE_SHEETS_CLIENT_EMAIL),
    key: normalizedPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function blobProbe() {
  const pathname = `guardian-test/atomic-probe-${Date.now()}.json`;
  const options = { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' };
  const first = await put(pathname, JSON.stringify({ fictitious: true, probe: 'atomic-claim' }), options);
  let conflict = null;
  try { await put(pathname, JSON.stringify({ fictitious: true, probe: 'duplicate' }), options); }
  catch (error) { conflict = { name: error?.name || 'Error', message: error?.message || 'unknown' }; }
  return { pathname, firstCreated: Boolean(first?.url), duplicateRejected: Boolean(conflict), conflict };
}

async function fullRun() {
  if (!text(process.env.GOOGLE_SHEETS_CLIENT_EMAIL) || !normalizedPrivateKey()) {
    throw new Error('Credenciales de Google Sheets no disponibles en Preview.');
  }
  const sheets = sheetsClient();
  const runId = Date.now();
  const sheetName = 'CRM_TEST';
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Guardian Atomic Pilot ${runId}` },
      sheets: [{ properties: { title: sheetName } }],
    },
    fields: 'spreadsheetId,spreadsheetUrl',
  });
  const spreadsheetId = created.data.spreadsheetId;
  const spreadsheetUrl = created.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A1:I2`,
    valueInputOption: 'RAW',
    requestBody: { values: [
      CANONICAL_HEADERS,
      ['', '2026-07-30', 'Legacy Ficticio', '0000000000', 'portones', 'corredizo_manual', 'otro', 'nuevo', 'fila legacy aislada'],
    ] },
  });

  const backfill = planLegacyBackfill({
    spreadsheetId,
    sheetName,
    rows: [{ rowNumber: 2, leadId: '' }],
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!A2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[backfill[0].leadId]] },
  });

  const claims = new VercelBlobClaimStore({ prefix: `guardian-test/full-run-${runId}/claims` });
  const legacyClaim = await claims.claim({ leadId: backfill[0].leadId });
  if (!legacyClaim.acquired) throw new Error('No se pudo reclamar la fila legacy recién creada.');
  await claims.commit(backfill[0].leadId);

  const repository = new GoogleSheetsLeadRepository({ sheets, spreadsheetId, sheetName });
  const writer = new AtomicLeadWriter({ claims, repository });
  const lead = {
    leadId: `GDN-PILOT-${runId}`,
    fecha: '2026-07-30',
    nombre: 'Lead Ficticio Atomicidad',
    contacto: '0000000001',
    linea: 'portones',
    tipoProyecto: 'corredizo_manual',
    canal: 'otro',
    estado: 'nuevo',
    notas: 'prueba controlada aislada; no contactar',
  };
  const concurrentResults = await Promise.all([writer.create(lead), writer.create(lead)]);

  const readback = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A:I` });
  const values = readback.data.values || [];
  const ids = values.slice(1).map((row) => text(row[0])).filter(Boolean);
  const uniqueIds = new Set(ids);
  const passed = values.length === 3
    && ids.length === 2
    && uniqueIds.size === 2
    && concurrentResults.filter((item) => item.status === 'created').length === 1
    && concurrentResults.filter((item) => item.status === 'duplicate').length === 1;
  if (!passed) throw new Error('La verificación de filas únicas no pasó.');

  return {
    passed,
    spreadsheetId,
    spreadsheetUrl,
    sheetName,
    backfilledLeadId: backfill[0].leadId,
    concurrentLeadId: lead.leadId,
    concurrentStatuses: concurrentResults.map((item) => item.status).sort(),
    dataRows: ids.length,
    uniqueLeadIds: uniqueIds.size,
  };
}

module.exports = async function guardianPilotTest(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { ok: false, error: 'Método no permitido.' });
  }
  if (!requireAuth(req, res)) return;
  if (process.env.GUARDIAN_PILOT_TEST_ENABLED !== 'true') {
    return respond(res, 404, { ok: false, error: 'Diagnóstico deshabilitado.' });
  }

  try {
    if (req.body?.action === 'blob_probe') {
      const result = await blobProbe();
      return respond(res, result.duplicateRejected ? 200 : 500, { ok: result.duplicateRejected, ...result });
    }
    if (req.body?.action === 'full_run') {
      return respond(res, 200, { ok: true, result: await fullRun() });
    }
    return respond(res, 400, { ok: false, error: 'Acción no permitida.' });
  } catch (error) {
    return respond(res, 500, { ok: false, error: error?.message || 'Falló el diagnóstico.' });
  }
};
