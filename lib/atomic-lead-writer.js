const { createHash } = require('node:crypto');
const { normalizarLeadGuardian, normalizarLeadId, validarLeadGuardian } = require('./guardian-lead-contract');

function deterministicLegacyLeadId({ spreadsheetId, sheetName, rowNumber }) {
  if (!spreadsheetId || !sheetName || !Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new Error('Se requiere spreadsheetId, sheetName y rowNumber >= 2');
  }
  const fingerprint = `${spreadsheetId.trim()}\u001f${sheetName.trim()}\u001f${rowNumber}`;
  const digest = createHash('sha256').update(fingerprint).digest('hex').slice(0, 20).toUpperCase();
  return `LEGACY-${digest}`;
}

function planLegacyBackfill({ spreadsheetId, sheetName, rows }) {
  const seen = new Set();
  return rows.map((row) => {
    const existing = typeof row.leadId === 'string' ? row.leadId.trim() : '';
    const leadId = existing
      ? normalizarLeadId(existing)
      : deterministicLegacyLeadId({ spreadsheetId, sheetName, rowNumber: row.rowNumber });

    if (seen.has(leadId)) {
      throw new Error(`leadId duplicado durante backfill: ${leadId}`);
    }
    seen.add(leadId);
    return { ...row, leadId, needsWrite: !existing };
  });
}

class InMemoryAtomicClaimStore {
  constructor() {
    this.claims = new Map();
  }

  async claim(lead) {
    if (this.claims.has(lead.leadId)) {
      return { acquired: false, state: this.claims.get(lead.leadId).state };
    }
    this.claims.set(lead.leadId, { state: 'pending_reconciliation', lead });
    return { acquired: true, state: 'pending_reconciliation' };
  }

  async commit(leadId) {
    const record = this.claims.get(leadId);
    if (!record) throw new Error(`No existe reclamo para ${leadId}`);
    this.claims.set(leadId, { ...record, state: 'committed' });
  }
}

class AtomicLeadWriter {
  constructor({ claims, repository }) {
    if (!claims?.claim || !claims?.commit || !repository?.append) {
      throw new Error('AtomicLeadWriter requiere claims y repository válidos');
    }
    this.claims = claims;
    this.repository = repository;
  }

  async create(input) {
    const lead = normalizarLeadGuardian(input);
    const errors = validarLeadGuardian(lead);
    if (errors.length) throw new Error(`Lead inválido: ${errors.join(' ')}`);

    const claim = await this.claims.claim(lead);
    if (!claim.acquired) {
      return { status: 'duplicate', leadId: lead.leadId, claimStatus: claim.state };
    }

    try {
      await this.repository.append(lead);
      await this.claims.commit(lead.leadId);
      return { status: 'created', leadId: lead.leadId };
    } catch (error) {
      throw new Error(
        `Reclamo ${lead.leadId} conservado; pendiente de conciliación: ${error.message}`,
        { cause: error },
      );
    }
  }
}

module.exports = {
  AtomicLeadWriter,
  InMemoryAtomicClaimStore,
  deterministicLegacyLeadId,
  planLegacyBackfill,
};
