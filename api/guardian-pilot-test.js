const { put } = require('@vercel/blob');
const { requireAuth } = require('../lib/auth');

function respond(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
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

  const action = req.body?.action;
  if (action !== 'blob_probe') {
    return respond(res, 400, { ok: false, error: 'Acción no permitida.' });
  }

  const pathname = `guardian-test/atomic-probe-${Date.now()}.json`;
  const options = {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: 'application/json',
  };

  try {
    const first = await put(pathname, JSON.stringify({ fictitious: true, probe: 'atomic-claim' }), options);
    let conflict = null;
    try {
      await put(pathname, JSON.stringify({ fictitious: true, probe: 'duplicate' }), options);
    } catch (error) {
      conflict = { name: error?.name || 'Error', message: error?.message || 'unknown' };
    }
    return respond(res, conflict ? 200 : 500, {
      ok: Boolean(conflict),
      pathname,
      firstCreated: Boolean(first?.url),
      duplicateRejected: Boolean(conflict),
      conflict,
    });
  } catch (error) {
    return respond(res, 500, {
      ok: false,
      error: error?.message || 'No se pudo probar Blob.',
      errorName: error?.name || 'Error',
    });
  }
};
