// Avisos de visitas nuevas a la Secretaria (y a quien se configure).
// Canales opcionales, cada uno se activa solo si sus variables existen en Vercel:
//   Correo (Resend):  AVISOS_RESEND_API_KEY, AVISOS_EMAIL_DE, AVISOS_EMAIL_PARA (separados por coma)
//   Telegram:         AVISOS_TELEGRAM_BOT_TOKEN, AVISOS_TELEGRAM_CHAT_ID
// El aviso NO lleva teléfono ni dirección: solo lo necesario para abrir la visita con sesión.
// Un aviso que falla nunca impide guardar la visita.

const TIEMPO_MAXIMO_MS = 4000;

function texto(valor) {
  return String(valor || '').trim();
}

function canalesConfigurados(env = process.env) {
  const canales = [];
  const para = texto(env.AVISOS_EMAIL_PARA).split(',').map((correo) => correo.trim()).filter(Boolean);
  if (texto(env.AVISOS_RESEND_API_KEY) && texto(env.AVISOS_EMAIL_DE) && para.length) {
    canales.push({ tipo: 'correo', apiKey: texto(env.AVISOS_RESEND_API_KEY), de: texto(env.AVISOS_EMAIL_DE), para });
  }
  if (texto(env.AVISOS_TELEGRAM_BOT_TOKEN) && texto(env.AVISOS_TELEGRAM_CHAT_ID)) {
    canales.push({ tipo: 'telegram', token: texto(env.AVISOS_TELEGRAM_BOT_TOKEN), chatId: texto(env.AVISOS_TELEGRAM_CHAT_ID) });
  }
  return canales;
}

function urlBase(req, env = process.env) {
  const configurada = texto(env.AVISOS_URL_BASE).replace(/\/+$/, '');
  if (/^https:\/\/[a-z0-9.-]+$/i.test(configurada)) return configurada;
  const host = texto(req?.headers?.['x-forwarded-host'] || req?.headers?.host).split(',')[0].trim();
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}` : '';
}

function armarMensaje(registro, base) {
  const fotos = Array.isArray(registro.fotos) ? registro.fotos.length : 0;
  const enlace = base ? `${base}/api/campo-fotos?visita=${encodeURIComponent(registro.id)}` : '';
  const lineas = [
    `Nueva visita de Campo — ${texto(registro.ticketId) || 'sin ticket'}`,
    `Cliente: ${texto(registro.cliente) || 'Sin nombre'}`,
    `Servicio: ${texto(registro.servicio) || 'Sin servicio'}`,
    `Zona: ${texto(registro.zona) || 'Sin zona'}`,
    `Capturó: ${texto(registro.capturadoPor?.nombre) || 'Sin dato'}`,
    `Fotos: ${fotos}`,
    enlace ? `Ver visita y fotos (pide contraseña): ${enlace}` : '',
  ].filter(Boolean);
  return {
    asunto: `Nueva visita: ${texto(registro.cliente) || 'Sin nombre'} · ${texto(registro.servicio) || 'Sin servicio'}`,
    cuerpo: lineas.join('\n'),
  };
}

async function conTiempoMaximo(promesa, ms) {
  let temporizador;
  const limite = new Promise((_, reject) => { temporizador = setTimeout(() => reject(new Error('tiempo agotado')), ms); });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

async function enviarCanal(canal, mensaje, fetchFn) {
  if (canal.tipo === 'correo') {
    const respuesta = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${canal.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: canal.de, to: canal.para, subject: mensaje.asunto, text: mensaje.cuerpo }),
    });
    if (!respuesta.ok) throw new Error(`correo respondió ${respuesta.status}`);
    return;
  }
  if (canal.tipo === 'telegram') {
    const respuesta = await fetchFn(`https://api.telegram.org/bot${canal.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: canal.chatId, text: mensaje.cuerpo, disable_web_page_preview: true }),
    });
    if (!respuesta.ok) throw new Error(`telegram respondió ${respuesta.status}`);
  }
}

// Devuelve [{ canal, enviado, error? }]. Nunca lanza.
async function avisarVisitaNueva(registro, { req, env = process.env, fetchFn = globalThis.fetch } = {}) {
  const canales = canalesConfigurados(env);
  if (!canales.length) return [];
  const mensaje = armarMensaje(registro, urlBase(req, env));
  return Promise.all(canales.map(async (canal) => {
    try {
      await conTiempoMaximo(enviarCanal(canal, mensaje, fetchFn), TIEMPO_MAXIMO_MS);
      return { canal: canal.tipo, enviado: true };
    } catch (error) {
      console.error('Avisos: no se pudo enviar', { canal: canal.tipo, message: error?.message });
      return { canal: canal.tipo, enviado: false, error: 'no se pudo enviar' };
    }
  }));
}

module.exports = { avisarVisitaNueva, armarMensaje, canalesConfigurados, urlBase };
