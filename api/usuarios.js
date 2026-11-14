const { requireAuth } = require('../lib/auth');
const { UsuariosError, crearRepositorioUsuarios } = require('../lib/usuarios');

function responderJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function normalizarBody(body) {
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

// Alta y baja de cuentas por persona. Dueño: todas. Secretaria: solo cuentas de Campo.
async function usuarios(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }
  const sesion = requireAuth(req, res, { roles: ['dueno', 'secretaria'] });
  if (!sesion) return;

  try {
    const repo = usuarios._repositorio();
    if (req.method === 'GET') return responderJson(res, 200, { ok: true, usuarios: await repo.listar() });

    const body = normalizarBody(req.body);
    if (body.accion === 'crear') return responderJson(res, 201, { ok: true, usuario: await repo.crear(sesion, body) });
    if (body.accion === 'activar') return responderJson(res, 200, { ok: true, usuario: await repo.activar(sesion, body.usuario, true) });
    if (body.accion === 'desactivar') return responderJson(res, 200, { ok: true, usuario: await repo.activar(sesion, body.usuario, false) });
    if (body.accion === 'cambiar-password') return responderJson(res, 200, { ok: true, usuario: await repo.cambiarPassword(sesion, body.usuario, body.password) });
    return responderJson(res, 400, { ok: false, error: 'Acción no válida.' });
  } catch (error) {
    if (error instanceof UsuariosError) return responderJson(res, error.statusCode, { ok: false, error: error.message });
    console.error('Usuarios: fallo inesperado', { name: error?.name, message: error?.message });
    return responderJson(res, 500, { ok: false, error: 'No se pudo completar la operación.' });
  }
}

usuarios._repositorio = () => crearRepositorioUsuarios();

module.exports = usuarios;
