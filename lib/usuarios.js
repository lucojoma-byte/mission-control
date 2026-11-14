const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PRIVATE_TOKEN_ENV } = require('./campo-storage');

// Usuarios por persona (Secretaria, Campo, Dueños adicionales) guardados en el Blob
// privado, fuera de las rutas que sirve /api/campo-archivo. El Dueño principal sigue
// entrando con MISSION_CONTROL_PASSWORD (sin usuario) para no perder el acceso.
const RUTA_USUARIOS = 'sistema/usuarios.json';
const USUARIO_VALIDO = /^[a-z0-9._-]{3,30}$/;
const ROLES_PERSONAS = ['dueno', 'secretaria', 'campo'];
const MIN_PASSWORD = 10;

class UsuariosError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'UsuariosError';
    this.statusCode = statusCode;
  }
}

function texto(valor) {
  return String(valor || '').trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
  const hash = crypto.scryptSync(String(password), salt, 32).toString('base64');
  return { salt, hash };
}

function verificarPassword(password, registro) {
  if (!registro?.salt || !registro?.hash) return false;
  const calculado = Buffer.from(hashPassword(password, registro.salt).hash, 'base64');
  const guardado = Buffer.from(registro.hash, 'base64');
  return calculado.length === guardado.length && crypto.timingSafeEqual(calculado, guardado);
}

function publico(usuario) {
  const { usuario: id, nombre, rol, activo, creadoEn, creadoPor, actualizadoEn } = usuario;
  return { usuario: id, nombre, rol, activo, creadoEn, creadoPor, actualizadoEn };
}

function crearRepositorioUsuarios({ env = process.env, blob = require('@vercel/blob'), cwd = process.cwd() } = {}) {
  const token = texto(env[PRIVATE_TOKEN_ENV]);
  const modo = token ? 'blob' : (env.NODE_ENV !== 'production' ? 'local' : null);
  const rutaLocal = path.join(cwd, '.dev-storage', RUTA_USUARIOS);

  function exigirModo() {
    if (!modo) throw new UsuariosError('Falta conectar el Blob store privado.', 503);
  }

  async function leer() {
    exigirModo();
    if (modo === 'blob') {
      const resultado = await blob.get(RUTA_USUARIOS, { access: 'private', token, useCache: false });
      if (!resultado || resultado.statusCode !== 200 || !resultado.stream) return [];
      const datos = JSON.parse(Buffer.from(await new Response(resultado.stream).arrayBuffer()).toString('utf8'));
      return Array.isArray(datos.usuarios) ? datos.usuarios : [];
    }
    try {
      const datos = JSON.parse(await fs.readFile(rutaLocal, 'utf8'));
      return Array.isArray(datos.usuarios) ? datos.usuarios : [];
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function guardar(usuarios) {
    exigirModo();
    const cuerpo = JSON.stringify({ version: 1, usuarios }, null, 2);
    if (modo === 'blob') {
      await blob.put(RUTA_USUARIOS, cuerpo, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json; charset=utf-8',
        token,
      });
      return;
    }
    await fs.mkdir(path.dirname(rutaLocal), { recursive: true });
    await fs.writeFile(rutaLocal, cuerpo);
  }

  async function autenticar(usuario, password) {
    const id = texto(usuario).toLowerCase();
    const registro = (await leer()).find((item) => item.usuario === id);
    if (!registro || !registro.activo || !verificarPassword(password, registro)) return null;
    return { usuario: registro.usuario, nombre: registro.nombre, rol: registro.rol };
  }

  async function listar() {
    return (await leer()).map(publico);
  }

  // Secretaria solo administra usuarios de Campo; Dueño administra todos.
  function exigirPermiso(actor, rolObjetivo) {
    if (actor.rol === 'dueno') return;
    if (actor.rol === 'secretaria' && rolObjetivo === 'campo') return;
    throw new UsuariosError('Tu usuario no puede administrar este tipo de cuenta.', 403);
  }

  function validarPassword(password) {
    if (String(password || '').length < MIN_PASSWORD) {
      throw new UsuariosError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    }
  }

  async function crear(actor, { usuario, nombre, rol, password }) {
    const id = texto(usuario).toLowerCase();
    if (!USUARIO_VALIDO.test(id) || id === 'dueno') {
      throw new UsuariosError('Usuario no válido: 3 a 30 letras minúsculas, números, punto, guion o guion bajo.');
    }
    if (!texto(nombre)) throw new UsuariosError('Escribe el nombre de la persona.');
    if (!ROLES_PERSONAS.includes(rol)) throw new UsuariosError('Rol no válido.');
    exigirPermiso(actor, rol);
    validarPassword(password);

    const usuarios = await leer();
    if (usuarios.some((item) => item.usuario === id)) throw new UsuariosError('Ese usuario ya existe.', 409);
    const ahora = new Date().toISOString();
    const nuevo = { usuario: id, nombre: texto(nombre).slice(0, 80), rol, activo: true, creadoEn: ahora, creadoPor: actor.usuario, actualizadoEn: ahora, ...hashPassword(password) };
    await guardar([...usuarios, nuevo]);
    return publico(nuevo);
  }

  async function actualizar(actor, id, cambios) {
    const usuarios = await leer();
    const indice = usuarios.findIndex((item) => item.usuario === texto(id).toLowerCase());
    if (indice < 0) throw new UsuariosError('Usuario no encontrado.', 404);
    exigirPermiso(actor, usuarios[indice].rol);
    const actualizado = { ...usuarios[indice], ...cambios, actualizadoEn: new Date().toISOString() };
    usuarios[indice] = actualizado;
    await guardar(usuarios);
    return publico(actualizado);
  }

  return {
    modo,
    autenticar,
    listar,
    crear,
    activar: (actor, id, activo) => actualizar(actor, id, { activo: Boolean(activo) }),
    cambiarPassword: (actor, id, password) => {
      validarPassword(password);
      return actualizar(actor, id, hashPassword(password));
    },
  };
}

module.exports = { RUTA_USUARIOS, ROLES_PERSONAS, MIN_PASSWORD, UsuariosError, crearRepositorioUsuarios, hashPassword, verificarPassword };
