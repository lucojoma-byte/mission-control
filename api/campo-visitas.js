const crypto = require('node:crypto');
const { requireAuth } = require('../lib/auth');
const { avisarVisitaNueva } = require('../lib/avisos');

let avisar = avisarVisitaNueva;
const { CampoStorageError, crearAlmacenCampo, validarFotos, tipoDeRuta, urlProtegida } = require('../lib/campo-storage');

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

function limpiarNombreArchivo(nombre = 'foto') {
  const limpio = String(nombre)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return limpio || 'foto';
}

function consecutivoDesdeTimestamp(timestamp = Date.now(), extra = 0) {
  const base = String(Number(timestamp) + extra).slice(-6);
  return base.padStart(6, '0');
}

// Forma que usa la app para mostrar una visita (mismas claves que guarda el POST).
function visitaParaApp(registro) {
  const fotos = (Array.isArray(registro.fotos) ? registro.fotos : [])
    .filter((foto) => tipoDeRuta(foto?.pathname) === 'foto')
    .map((foto) => ({ nombre: foto.nombre, pathname: foto.pathname, contentType: foto.contentType, url: urlProtegida(foto.pathname) }));
  const registroPath = `campo/visitas/${registro.id}.json`;
  return {
    id: registro.id,
    clienteId: registro.clienteId,
    leadId: registro.leadId,
    ticketId: registro.ticketId,
    guardadoEn: registro.guardadoEn,
    storage: registro.storage,
    cliente: registro.cliente,
    telefono: registro.telefono,
    direccion: registro.direccion,
    servicio: registro.servicio,
    zona: registro.zona,
    ancho: registro.ancho,
    alto: registro.alto,
    condicion: registro.condicion,
    notas: registro.notas,
    fechaSeguimiento: registro.fechaSeguimiento,
    responsable: registro.responsable,
    capturadoPor: registro.capturadoPor || null,
    fotos: registro.fotosResumen || '',
    fotosRemotas: fotos,
    registroPath,
    registroUrl: urlProtegida(registroPath),
  };
}

// Lista compartida: Dueño y Secretaria ven todas; Campo solo las que capturó.
async function listarVisitas(req, res, sesion) {
  try {
    const almacen = crearAlmacenCampo();
    if (!almacen.modo) throw new CampoStorageError('Falta conectar el Blob store privado.', 503);
    const registros = await almacen.listarRegistros({ limite: 100 });
    const visibles = sesion.rol === 'campo'
      ? registros.filter((registro) => registro.capturadoPor?.usuario === sesion.usuario)
      : registros;
    res.setHeader('Cache-Control', 'no-store');
    return responderJson(res, 200, { ok: true, visitas: visibles.map(visitaParaApp) });
  } catch (error) {
    if (error instanceof CampoStorageError) return responderJson(res, error.statusCode, { ok: false, error: error.message });
    console.error('Campo: fallo al listar visitas', { name: error?.name, message: error?.message });
    return responderJson(res, 500, { ok: false, error: 'No se pudieron cargar las visitas.' });
  }
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  const sesion = requireAuth(req, res);
  if (!sesion) return;
  if (req.method === 'GET') return listarVisitas(req, res, sesion);

  const guardados = [];
  let almacen = null;
  try {
    const body = normalizarBody(req.body);
    const visita = body && typeof body.visita === 'object' ? body.visita : null;

    if (!visita || !String(visita.cliente || '').trim() || !String(visita.servicio || '').trim()) {
      return responderJson(res, 400, { ok: false, error: 'Cliente y servicio son obligatorios.' });
    }

    // Se valida todo antes de escribir: si una foto falla, no queda nada a medias.
    const fotos = validarFotos(body.fotos);
    almacen = crearAlmacenCampo();
    if (!almacen.modo) {
      throw new CampoStorageError('Falta conectar el Blob store privado. No se guardó nada.', 503);
    }

    const stamp = Date.now();
    const visitId = `vis-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const clienteId = `CL-${consecutivoDesdeTimestamp(stamp)}`;
    const leadId = `LE-${consecutivoDesdeTimestamp(stamp, 1)}`;
    const ticketId = `TK-${consecutivoDesdeTimestamp(stamp, 2)}`;

    const fotosGuardadas = [];
    for (let indice = 0; indice < fotos.length; indice += 1) {
      const nombreBase = limpiarNombreArchivo(String(fotos[indice].nombre || `foto-${indice + 1}`).replace(/\.[^.]+$/, ''));
      const ruta = `campo/fotos/${visitId}/${String(indice + 1).padStart(2, '0')}-${nombreBase}.jpg`;
      const archivo = await almacen.guardar(ruta, fotos[indice].buffer);
      guardados.push(archivo.pathname);
      fotosGuardadas.push({
        nombre: `${nombreBase}.jpg`,
        url: archivo.url,
        pathname: archivo.pathname,
        contentType: archivo.contentType,
      });
    }

    const registro = {
      id: visitId,
      clienteId,
      leadId,
      ticketId,
      guardadoEn: createdAt,
      storage: almacen.modo,
      cliente: visita.cliente || '',
      telefono: visita.telefono || '',
      direccion: visita.direccion || '',
      servicio: visita.servicio || '',
      zona: visita.zona || '',
      ancho: visita.ancho || '',
      alto: visita.alto || '',
      condicion: visita.condicion || '',
      notas: visita.notas || '',
      fechaSeguimiento: visita.fechaSeguimiento || '',
      responsable: visita.responsable || sesion.nombre || '',
      capturadoPor: { usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol },
      fotosResumen: visita.fotos || '',
      fotos: fotosGuardadas.map(({ nombre, pathname, contentType }) => ({ nombre, pathname, contentType })),
    };

    const registroArchivo = await almacen.guardar(
      `campo/visitas/${visitId}.json`,
      Buffer.from(JSON.stringify(registro, null, 2), 'utf8'),
    );
    guardados.length = 0;

    // La visita ya quedó guardada: el aviso es de mejor esfuerzo y no cambia la respuesta.
    const avisos = await avisar(registro, { req }).catch(() => []);

    return responderJson(res, 200, {
      ok: true,
      visita: {
        id: visitId,
        clienteId,
        leadId,
        ticketId,
        guardadoEn: createdAt,
        storage: almacen.modo,
        registroUrl: registroArchivo.url,
        registroPath: registroArchivo.pathname,
        responsable: registro.responsable,
        capturadoPor: registro.capturadoPor,
        fotos: fotosGuardadas,
        avisos,
      },
    });
  } catch (error) {
    if (guardados.length && almacen) {
      try {
        await almacen.borrar(guardados);
      } catch (limpiezaError) {
        console.error('Campo: no se pudieron limpiar archivos parciales', { rutas: guardados, message: limpiezaError?.message });
      }
    }
    if (error instanceof CampoStorageError) {
      return responderJson(res, error.statusCode, { ok: false, error: error.message });
    }
    console.error('Campo: fallo al guardar visita', { name: error?.name, message: error?.message });
    return responderJson(res, 500, { ok: false, error: 'No se pudo guardar la visita. Intenta de nuevo.' });
  }
};

module.exports._setAvisarForTests = (fn) => { avisar = fn || avisarVisitaNueva; };
