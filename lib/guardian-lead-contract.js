const ESTADOS_LEAD = Object.freeze([
  'nuevo',
  'por_cotizar',
  'cotizado',
  'ganado',
  'perdido',
]);

const CANALES_LEAD = Object.freeze([
  'whatsapp',
  'instagram',
  'facebook',
  'recomendacion',
  'tiktok',
  'youtube',
  'google_maps',
  'otro',
]);

function texto(valor) {
  return String(valor ?? '').trim();
}

function normalizarLeadId(valor) {
  return texto(valor).toUpperCase();
}

function normalizarLeadGuardian(lead = {}) {
  return {
    schemaVersion: 'guardian.lead.v1',
    leadId: normalizarLeadId(lead.leadId),
    fecha: texto(lead.fecha ?? lead.Fecha),
    nombre: texto(lead.nombre ?? lead.Nombre),
    contacto: texto(lead.contacto ?? lead.Contacto),
    linea: texto(lead.linea ?? lead.Linea).toLowerCase(),
    tipoProyecto: texto(lead.tipoProyecto ?? lead.TipoProyecto),
    canal: texto(lead.canal ?? lead.Canal).toLowerCase(),
    estado: texto(lead.estado ?? lead.Estado).toLowerCase(),
    notas: texto(lead.notas ?? lead.Notas),
    origen: texto(lead.origen) || 'manual',
    revision: lead.revision === false ? false : true,
  };
}

function validarLeadGuardian(lead = {}) {
  const normal = normalizarLeadGuardian(lead);
  const errores = [];
  const obligatorios = [
    ['leadId', 'leadId es obligatorio.'],
    ['fecha', 'Fecha es obligatoria.'],
    ['nombre', 'Nombre es obligatorio.'],
    ['contacto', 'Contacto es obligatorio.'],
    ['linea', 'Linea es obligatoria.'],
    ['tipoProyecto', 'TipoProyecto es obligatorio.'],
    ['canal', 'Canal es obligatorio.'],
    ['estado', 'Estado es obligatorio.'],
  ];

  for (const [campo, mensaje] of obligatorios) {
    if (!normal[campo]) errores.push(mensaje);
  }
  if (normal.estado && !ESTADOS_LEAD.includes(normal.estado)) {
    errores.push(`Estado no permitido: ${normal.estado}.`);
  }
  if (normal.canal && !CANALES_LEAD.includes(normal.canal)) {
    errores.push(`Canal no permitido: ${normal.canal}.`);
  }
  return errores;
}

function prospectoCrmALeadGuardian(prospecto = {}, configuracion = {}) {
  const estadosHeredados = {
    nuevo: 'nuevo',
    pendiente: 'nuevo',
    contactado: 'por_cotizar',
    calificado: 'por_cotizar',
    'cotización enviada': 'cotizado',
    'cotizacion enviada': 'cotizado',
    ganado: 'ganado',
    perdido: 'perdido',
  };
  const estadoHeredado = texto(prospecto.estado).toLowerCase();
  const creadoEn = texto(prospecto.creadoEn);

  return normalizarLeadGuardian({
    leadId: prospecto.leadId,
    fecha: creadoEn ? creadoEn.slice(0, 10) : '',
    nombre: prospecto.cliente,
    contacto: prospecto.telefono,
    linea: configuracion.linea || 'portones',
    tipoProyecto: prospecto.interes,
    canal: configuracion.canal || 'otro',
    estado: estadosHeredados[estadoHeredado] || estadoHeredado,
    notas: prospecto.notasSheets || prospecto.resumen,
    origen: prospecto.origen || 'manual',
    revision: true,
  });
}

function buscarLeadDuplicado(filas = [], lead = {}) {
  const leadId = normalizarLeadId(lead.leadId);
  if (!leadId) return null;
  return filas.find((fila) => normalizarLeadId(fila.leadId) === leadId) || null;
}

function crearRepositorioLeadsEnMemoria(iniciales = []) {
  const porId = new Map();
  for (const lead of iniciales) {
    const normal = normalizarLeadGuardian(lead);
    if (normal.leadId) porId.set(normal.leadId, normal);
  }

  return {
    guardarSiAusente(lead) {
      const normal = normalizarLeadGuardian(lead);
      const errores = validarLeadGuardian(normal);
      if (errores.length) {
        return Promise.reject(new Error(`Lead inválido: ${errores.join(' ')}`));
      }

      const existente = porId.get(normal.leadId);
      if (existente) {
        return Promise.resolve({
          insertado: false,
          idempotent: true,
          lead: { ...existente },
        });
      }

      // La comprobación y el set son sincrónicos: esto evita carreras solo
      // dentro de esta simulación en un único proceso. No garantiza unicidad
      // distribuida y no debe conectarse directamente a Google Sheets.
      porId.set(normal.leadId, normal);
      return Promise.resolve({
        insertado: true,
        idempotent: false,
        lead: { ...normal },
      });
    },

    listar() {
      return Array.from(porId.values(), (lead) => ({ ...lead }));
    },
  };
}

module.exports = {
  ESTADOS_LEAD,
  CANALES_LEAD,
  normalizarLeadId,
  normalizarLeadGuardian,
  validarLeadGuardian,
  prospectoCrmALeadGuardian,
  buscarLeadDuplicado,
  crearRepositorioLeadsEnMemoria,
};
