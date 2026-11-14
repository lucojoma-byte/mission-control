const crypto = require('node:crypto');
const auth = require('../lib/auth');
const { CampoStorageError, crearAlmacenCampo, tipoDeRuta, urlProtegida } = require('../lib/campo-storage');

const VISITA_ID = /^vis-\d{10,}-[0-9a-f]{6}$/;

function escapar(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function visitaSolicitada(req) {
  if (req.query && typeof req.query.visita === 'string') return req.query.visita;
  try {
    return new URL(req.url || '', 'http://localhost').searchParams.get('visita') || '';
  } catch {
    return '';
  }
}

function pagina(res, statusCode, titulo, cuerpo, nonce = '') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'${nonce ? `; script-src 'nonce-${nonce}'` : ''}`,
  );
  res.end(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapar(titulo)} · Guardián</title>
<style>
  body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0d1117;color:#e6edf3}
  main{max-width:960px;margin:0 auto;padding:20px 16px}
  h1{font-size:20px;margin:0 0 4px} .meta{color:#9da7b3;font-size:14px;margin:0 0 16px}
  .ids{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px;padding:0;list-style:none}
  .ids li{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
  figure{margin:0;background:#161b22;border:1px solid #30363d;border-radius:8px;overflow:hidden}
  img{display:block;width:100%;height:auto} figcaption{padding:6px 8px;font-size:12px;color:#9da7b3}
  form{display:flex;flex-direction:column;gap:10px;max-width:320px}
  input,button{font:inherit;padding:10px;border-radius:6px;border:1px solid #30363d;background:#161b22;color:inherit}
  button{background:#d4a72c;color:#111;border:0;font-weight:600}
  .error{color:#ff7b72;min-height:1.2em}
</style></head><body><main>${cuerpo}</main></body></html>`);
}

function paginaLogin(res) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const cuerpo = `
    <h1>Fotos de visita</h1>
    <p class="meta">Guardian Ops es privado. Escribe la contraseña para ver las fotos.</p>
    <form id="acceso">
      <input type="password" name="password" autocomplete="current-password" placeholder="Contraseña" required>
      <button type="submit">Entrar</button>
      <div class="error" id="error"></div>
    </form>
    <script nonce="${nonce}">
      document.getElementById('acceso').addEventListener('submit', async (evento) => {
        evento.preventDefault();
        const error = document.getElementById('error');
        error.textContent = '';
        const respuesta = await fetch('/api/auth-login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: evento.target.password.value }),
        }).catch(() => null);
        if (respuesta && respuesta.ok) return window.location.reload();
        const datos = respuesta ? await respuesta.json().catch(() => ({})) : {};
        error.textContent = datos.error || 'No se pudo iniciar sesión.';
      });
    </script>`;
  return pagina(res, 401, 'Acceso privado', cuerpo, nonce);
}

// Página protegida con las fotos de una visita de Campo. Se abre desde el enlace
// que queda en la hoja del CRM y funciona en cualquier equipo con la contraseña.
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return pagina(res, 405, 'Método no permitido', '<h1>Método no permitido</h1>');
  }

  if (!auth.configuracionDisponible()) {
    return pagina(res, 503, 'No configurado', '<h1>Acceso privado no configurado</h1>');
  }
  if (!auth.sesionValida(req)) return paginaLogin(res);

  const visitaId = visitaSolicitada(req);
  if (!VISITA_ID.test(visitaId)) {
    return pagina(res, 400, 'Visita no válida', '<h1>Enlace de visita no válido</h1>');
  }

  try {
    const contenido = await crearAlmacenCampo().leer(`campo/visitas/${visitaId}.json`);
    if (!contenido) return pagina(res, 404, 'No encontrada', '<h1>Visita no encontrada</h1>');

    const registro = JSON.parse(contenido.toString('utf8'));
    const fotos = (Array.isArray(registro.fotos) ? registro.fotos : [])
      .filter((foto) => tipoDeRuta(foto?.pathname) === 'foto');

    const galeria = fotos.length
      ? `<div class="grid">${fotos.map((foto, indice) => `
          <figure>
            <a href="${escapar(urlProtegida(foto.pathname))}" target="_blank" rel="noopener">
              <img src="${escapar(urlProtegida(foto.pathname))}" alt="Foto ${indice + 1}" loading="lazy">
            </a>
            <figcaption>${escapar(foto.nombre || `Foto ${indice + 1}`)}</figcaption>
          </figure>`).join('')}</div>`
      : '<p class="meta">Esta visita se guardó sin fotos.</p>';

    const cuerpo = `
      <h1>${escapar(registro.cliente || 'Visita')}</h1>
      <p class="meta">${escapar(registro.servicio || 'Sin servicio')} · ${escapar(registro.zona || 'Sin zona')} · ${escapar(registro.guardadoEn || '')}</p>
      <ul class="ids">
        <li>Cliente ${escapar(registro.clienteId)}</li>
        <li>Lead ${escapar(registro.leadId)}</li>
        <li>Ticket ${escapar(registro.ticketId)}</li>
        <li>${fotos.length} foto(s)</li>
      </ul>
      ${galeria}`;
    return pagina(res, 200, registro.cliente || 'Visita', cuerpo);
  } catch (error) {
    if (error instanceof CampoStorageError) {
      return pagina(res, error.statusCode, 'Error', `<h1>${escapar(error.message)}</h1>`);
    }
    console.error('Campo: fallo al mostrar fotos', { visitaId, name: error?.name, message: error?.message });
    return pagina(res, 500, 'Error', '<h1>No se pudieron cargar las fotos.</h1>');
  }
};
