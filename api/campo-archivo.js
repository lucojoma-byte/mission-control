const { requireAuth } = require('../lib/auth');
const { CampoStorageError, crearAlmacenCampo, contentTypeDeRuta, tipoDeRuta } = require('../lib/campo-storage');

function responderJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function rutaSolicitada(req) {
  if (req.query && typeof req.query.path === 'string') return req.query.path;
  try {
    return new URL(req.url || '', 'http://localhost').searchParams.get('path') || '';
  } catch {
    return '';
  }
}

// Sirve fotos y registros de Campo desde el Blob privado, solo con sesión válida.
// No existe URL pública: cada lectura pasa por aquí y exige la cookie de sesión.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  if (!requireAuth(req, res)) return;

  const ruta = rutaSolicitada(req);
  if (!tipoDeRuta(ruta)) {
    return responderJson(res, 400, { ok: false, error: 'Ruta de archivo no permitida.' });
  }

  try {
    const contenido = await crearAlmacenCampo().leer(ruta);
    if (!contenido) return responderJson(res, 404, { ok: false, error: 'Archivo no encontrado.' });

    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeDeRuta(ruta));
    res.setHeader('Content-Length', String(contenido.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Content-Disposition', tipoDeRuta(ruta) === 'registro' ? 'attachment' : 'inline');
    return res.end(contenido);
  } catch (error) {
    if (error instanceof CampoStorageError) {
      return responderJson(res, error.statusCode, { ok: false, error: error.message });
    }
    console.error('Campo: fallo al leer archivo', { ruta, name: error?.name, message: error?.message });
    return responderJson(res, 500, { ok: false, error: 'No se pudo leer el archivo.' });
  }
};
