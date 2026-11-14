const fs = require('node:fs/promises');
const path = require('node:path');

// Las fotos y registros de Campo viven en un Blob store PRIVADO, separado del
// store público histórico. Vercel inyecta este token al conectar el store con
// el prefijo de variables "BLOB_PRIVATE".
const PRIVATE_TOKEN_ENV = 'BLOB_PRIVATE_READ_WRITE_TOKEN';

const MAX_FOTOS = 4;
const MAX_BYTES_FOTO = 1000000; // tras compresión en el cliente
const MAX_BYTES_TOTAL = 3000000; // cabe en el límite de 4.5 MB por request de Vercel (base64)

const RUTA_FOTO = /^campo\/fotos\/vis-\d{10,}-[0-9a-f]{6}\/\d{2}-[a-z0-9._-]{1,80}\.jpg$/;
const RUTA_REGISTRO = /^campo\/visitas\/vis-\d{10,}-[0-9a-f]{6}\.json$/;

class CampoStorageError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'CampoStorageError';
    this.statusCode = statusCode;
  }
}

function texto(valor) {
  return String(valor || '').trim();
}

function tokenPrivado(env = process.env) {
  return texto(env[PRIVATE_TOKEN_ENV]);
}

function modoAlmacenamiento(env = process.env) {
  if (tokenPrivado(env)) return 'vercel-blob-private';
  if (env.NODE_ENV !== 'production') return 'local-dev-fallback';
  return null;
}

function tipoDeRuta(ruta) {
  const valor = String(ruta || '');
  if (RUTA_FOTO.test(valor)) return 'foto';
  if (RUTA_REGISTRO.test(valor)) return 'registro';
  return null;
}

function contentTypeDeRuta(ruta) {
  const tipo = tipoDeRuta(ruta);
  if (tipo === 'foto') return 'image/jpeg';
  if (tipo === 'registro') return 'application/json; charset=utf-8';
  return null;
}

function urlProtegida(ruta) {
  return `/api/campo-archivo?path=${encodeURIComponent(ruta)}`;
}

// Devuelve true si el JPEG trae un segmento APP1 "Exif" (GPS, modelo, fecha, etc.).
function jpegTieneExif(buffer) {
  let i = 2;
  while (i + 4 <= buffer.length) {
    if (buffer[i] !== 0xff) return false;
    const marcador = buffer[i + 1];
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marcador === 0xda || marcador === 0xd9) return false; // inicio de datos de imagen
    const largo = buffer.readUInt16BE(i + 2);
    if (largo < 2) return false;
    if (marcador === 0xe1 && buffer.slice(i + 4, i + 10).toString('latin1') === 'Exif\0\0') return true;
    i += 2 + largo;
  }
  return false;
}

function esJpeg(buffer) {
  return buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function parsearFoto(dataUrl) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new CampoStorageError('Formato de imagen no válido.', 400);
  const contentType = match[1].toLowerCase();
  if (contentType !== 'image/jpeg') {
    throw new CampoStorageError('Solo se aceptan fotos JPEG procesadas por la app.', 400);
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!esJpeg(buffer)) throw new CampoStorageError('El archivo no es un JPEG válido.', 400);
  if (buffer.length > MAX_BYTES_FOTO) {
    throw new CampoStorageError('Una foto supera 1 MB después de comprimir.', 400);
  }
  if (jpegTieneExif(buffer)) {
    throw new CampoStorageError('La foto conserva metadatos EXIF/GPS. No se guardó nada.', 400);
  }
  return buffer;
}

// Valida TODAS las fotos antes de escribir cualquier archivo.
function validarFotos(fotos) {
  const lista = (Array.isArray(fotos) ? fotos : []).filter((foto) => foto && foto.dataUrl);
  if (lista.length > MAX_FOTOS) {
    throw new CampoStorageError(`Máximo ${MAX_FOTOS} fotos por visita.`, 400);
  }
  const procesadas = lista.map((foto) => ({ nombre: foto.nombre, buffer: parsearFoto(foto.dataUrl) }));
  const total = procesadas.reduce((suma, foto) => suma + foto.buffer.length, 0);
  if (total > MAX_BYTES_TOTAL) {
    throw new CampoStorageError('Las fotos superan 3 MB en total. Quita alguna e intenta de nuevo.', 400);
  }
  return procesadas;
}

function rutaLocal(ruta, cwd) {
  return path.join(cwd, '.dev-storage', ruta);
}

function crearAlmacenCampo({ env = process.env, blob = require('@vercel/blob'), cwd = process.cwd() } = {}) {
  const modo = modoAlmacenamiento(env);

  function exigirModo() {
    if (!modo) {
      throw new CampoStorageError(`Falta conectar el Blob store privado (${PRIVATE_TOKEN_ENV}). No se guardó nada.`, 503);
    }
  }

  async function guardar(ruta, buffer) {
    exigirModo();
    if (!tipoDeRuta(ruta)) throw new CampoStorageError('Ruta de archivo no permitida.', 400);
    const contentType = contentTypeDeRuta(ruta);
    if (modo === 'vercel-blob-private') {
      await blob.put(ruta, buffer, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
        token: tokenPrivado(env),
      });
    } else {
      const destino = rutaLocal(ruta, cwd);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, buffer, { flag: 'wx' });
    }
    return { pathname: ruta, url: urlProtegida(ruta), contentType };
  }

  async function borrar(rutas) {
    if (!rutas.length || !modo) return;
    if (modo === 'vercel-blob-private') {
      await blob.del(rutas, { token: tokenPrivado(env) });
    } else {
      await Promise.all(rutas.map((ruta) => fs.rm(rutaLocal(ruta, cwd), { force: true })));
    }
  }

  async function leer(ruta) {
    exigirModo();
    if (!tipoDeRuta(ruta)) throw new CampoStorageError('Ruta de archivo no permitida.', 400);
    if (modo === 'vercel-blob-private') {
      const resultado = await blob.get(ruta, { access: 'private', token: tokenPrivado(env), useCache: false });
      if (!resultado || resultado.statusCode !== 200 || !resultado.stream) return null;
      return Buffer.from(await new Response(resultado.stream).arrayBuffer());
    }
    try {
      return await fs.readFile(rutaLocal(ruta, cwd));
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  // Registros de visita más recientes primero (hasta `limite`).
  async function listarRegistros({ limite = 100 } = {}) {
    exigirModo();
    let rutas = [];
    if (modo === 'vercel-blob-private') {
      let cursor;
      const encontrados = [];
      do {
        const pagina = await blob.list({ prefix: 'campo/visitas/', token: tokenPrivado(env), limit: 1000, cursor });
        encontrados.push(...(pagina.blobs || []));
        cursor = pagina.hasMore ? pagina.cursor : undefined;
      } while (cursor && encontrados.length < 5000);
      rutas = encontrados
        .filter((item) => tipoDeRuta(item.pathname) === 'registro')
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
        .map((item) => item.pathname);
    } else {
      const carpeta = path.join(cwd, '.dev-storage', 'campo', 'visitas');
      const nombres = await fs.readdir(carpeta).catch(() => []);
      rutas = nombres
        .map((nombre) => `campo/visitas/${nombre}`)
        .filter((ruta) => tipoDeRuta(ruta) === 'registro')
        .sort()
        .reverse();
    }

    const registros = await Promise.all(rutas.slice(0, limite).map(async (ruta) => {
      try {
        const contenido = await leer(ruta);
        return contenido ? JSON.parse(contenido.toString('utf8')) : null;
      } catch {
        return null;
      }
    }));
    return registros
      .filter(Boolean)
      .sort((a, b) => String(b.guardadoEn || '').localeCompare(String(a.guardadoEn || '')));
  }

  return { modo, guardar, borrar, leer, listarRegistros };
}

module.exports = {
  PRIVATE_TOKEN_ENV,
  MAX_FOTOS,
  MAX_BYTES_FOTO,
  MAX_BYTES_TOTAL,
  CampoStorageError,
  crearAlmacenCampo,
  modoAlmacenamiento,
  tipoDeRuta,
  contentTypeDeRuta,
  urlProtegida,
  jpegTieneExif,
  validarFotos,
};
