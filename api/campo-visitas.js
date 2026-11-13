const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { put } = require('@vercel/blob');
const { requireAuth } = require('../lib/auth');

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
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return limpio || 'foto';
}

function extensionDesdeMime(mime = '') {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

function consecutivoDesdeTimestamp(timestamp = Date.now(), extra = 0) {
  const base = String(Number(timestamp) + extra).slice(-6);
  return base.padStart(6, '0');
}

function parsearDataUrl(dataUrl = '') {
  const match = /^data:([^;]+);base64,(.+)$/.exec(String(dataUrl));
  if (!match) throw new Error('Formato de imagen no válido.');
  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

async function guardarEnDesarrollo(relPath, buffer, contentType) {
  const root = path.join(process.cwd(), '.dev-storage');
  const absPath = path.join(root, relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, buffer);
  return {
    url: `local://${relPath}`,
    pathname: relPath,
    contentType,
  };
}

async function guardarBlob(relPath, body, contentType) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return put(relPath, body, {
      access: 'public',
      addRandomSuffix: false,
      contentType,
    });
  }

  if (process.env.NODE_ENV !== 'production') {
    return guardarEnDesarrollo(relPath, body, contentType);
  }

  throw new Error('Falta configurar BLOB_READ_WRITE_TOKEN en Vercel para guardar fotos reales.');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return responderJson(res, 405, { ok: false, error: 'Método no permitido.' });
  }

  if (!requireAuth(req, res)) return;

  try {
    const body = normalizarBody(req.body);
    const visita = body && typeof body.visita === 'object' ? body.visita : null;
    const fotos = Array.isArray(body?.fotos) ? body.fotos : [];

    if (!visita || !String(visita.cliente || '').trim() || !String(visita.servicio || '').trim()) {
      return responderJson(res, 400, { ok: false, error: 'Cliente y servicio son obligatorios.' });
    }

    const stamp = Date.now();
    const visitId = `vis-${stamp}-${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const clienteId = `CL-${consecutivoDesdeTimestamp(stamp)}`;
    const leadId = `LE-${consecutivoDesdeTimestamp(stamp, 1)}`;
    const ticketId = `TK-${consecutivoDesdeTimestamp(stamp, 2)}`;

    const fotosGuardadas = [];
    for (let indice = 0; indice < fotos.length; indice += 1) {
      const foto = fotos[indice] || {};
      if (!foto.dataUrl) continue;
      const { contentType, buffer } = parsearDataUrl(foto.dataUrl);
      const extension = extensionDesdeMime(contentType);
      const nombreBase = limpiarNombreArchivo((foto.nombre || `foto-${indice + 1}`).replace(/\.[^.]+$/, ''));
      const relPath = `campo/fotos/${visitId}/${String(indice + 1).padStart(2, '0')}-${nombreBase}.${extension}`;
      const blob = await guardarBlob(relPath, buffer, contentType);
      fotosGuardadas.push({
        nombre: `${nombreBase}.${extension}`,
        url: blob.url,
        pathname: blob.pathname,
        contentType,
      });
    }

    const registro = {
      id: visitId,
      clienteId,
      leadId,
      ticketId,
      guardadoEn: createdAt,
      storage: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local-dev-fallback',
      cliente: visita.cliente || '',
      telefono: visita.telefono || '',
      direccion: visita.direccion || '',
      servicio: visita.servicio || '',
      ancho: visita.ancho || '',
      alto: visita.alto || '',
      condicion: visita.condicion || '',
      notas: visita.notas || '',
      fechaSeguimiento: visita.fechaSeguimiento || '',
      responsable: visita.responsable || '',
      fotosResumen: visita.fotos || '',
      fotos: fotosGuardadas,
    };

    const registroPath = `campo/visitas/${visitId}.json`;
    const registroBlob = await guardarBlob(
      registroPath,
      Buffer.from(JSON.stringify(registro, null, 2), 'utf8'),
      'application/json; charset=utf-8',
    );

    return responderJson(res, 200, {
      ok: true,
      visita: {
        id: visitId,
        clienteId,
        leadId,
        ticketId,
        guardadoEn: createdAt,
        storage: registro.storage,
        registroUrl: registroBlob.url,
        registroPath: registroBlob.pathname,
        fotos: fotosGuardadas,
      },
    });
  } catch (error) {
    return responderJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo guardar la visita.',
    });
  }
};
