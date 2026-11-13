const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AtomicLeadWriter,
  InMemoryAtomicClaimStore,
  deterministicLegacyLeadId,
  planLegacyBackfill,
  VercelBlobClaimStore,
} = require('../lib/atomic-lead-writer');

const validLead = {
  leadId: ' GDN-2026-0001 ',
  fecha: '2026-07-30',
  nombre: 'Lead Ficticio',
  contacto: '3330000000',
  linea: 'portones',
  tipoProyecto: 'corredizo_manual',
  canal: 'whatsapp',
  estado: 'nuevo',
  notas: 'prueba aislada',
};

test('dos escritores concurrentes solo insertan una fila', async () => {
  const claims = new InMemoryAtomicClaimStore();
  const rows = [];
  const repository = {
    async append(lead) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      rows.push(lead);
    },
  };
  const writer = new AtomicLeadWriter({ claims, repository });

  const results = await Promise.all([
    writer.create(validLead),
    writer.create(validLead),
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].leadId, 'GDN-2026-0001');
  assert.deepEqual(results.map((r) => r.status).sort(), ['created', 'duplicate']);
});

test('si Sheets falla después del reclamo no reintenta append ni duplica', async () => {
  const claims = new InMemoryAtomicClaimStore();
  let attempts = 0;
  const repository = {
    async append() {
      attempts += 1;
      throw new Error('sheets unavailable');
    },
  };
  const writer = new AtomicLeadWriter({ claims, repository });

  await assert.rejects(() => writer.create(validLead), /pendiente de conciliación/);
  const retry = await writer.create(validLead);

  assert.equal(retry.status, 'duplicate');
  assert.equal(retry.claimStatus, 'pending_reconciliation');
  assert.equal(attempts, 1);
});

test('leadId histórico es determinista, estable y normalizado', () => {
  const a = deterministicLegacyLeadId({ spreadsheetId: 'sheet-test-1', sheetName: 'CRM', rowNumber: 7 });
  const b = deterministicLegacyLeadId({ spreadsheetId: 'sheet-test-1', sheetName: 'CRM', rowNumber: 7 });
  assert.equal(a, b);
  assert.match(a, /^LEGACY-[A-F0-9]{20}$/);
});

test('backfill conserva IDs existentes y solo propone IDs para filas legacy', () => {
  const plan = planLegacyBackfill({
    spreadsheetId: 'sheet-test-1',
    sheetName: 'CRM',
    rows: [
      { rowNumber: 2, leadId: ' gdn-existing ', nombre: 'Existente' },
      { rowNumber: 3, leadId: '', nombre: 'Legacy' },
    ],
  });
  assert.equal(plan[0].leadId, 'GDN-EXISTING');
  assert.equal(plan[0].needsWrite, false);
  assert.match(plan[1].leadId, /^LEGACY-[A-F0-9]{20}$/);
  assert.equal(plan[1].needsWrite, true);
});

test('adaptador Blob acepta solo el conflicto exacto como duplicado', async () => {
  const calls = [];
  const putFn = async (pathname, body, options) => {
    calls.push({ pathname, body: JSON.parse(body), options });
    if (calls.length === 2) {
      throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
    }
    return { url: 'https://example.invalid/claim' };
  };
  const store = new VercelBlobClaimStore({ putFn, prefix: 'guardian-test/claims' });

  const first = await store.claim({ leadId: 'GDN-2026-0001' });
  const duplicate = await store.claim({ leadId: 'GDN-2026-0001' });
  await store.commit('GDN-2026-0001');

  assert.equal(first.acquired, true);
  assert.deepEqual(duplicate, { acquired: false, state: 'already_claimed' });
  assert.equal(calls[0].options.allowOverwrite, false);
  assert.equal(calls[2].options.allowOverwrite, true);
  assert.equal(calls[0].body.leadId, 'GDN-2026-0001');
  assert.equal(Object.hasOwn(calls[0].body, 'nombre'), false);
});

test('adaptador Blob propaga errores distintos al conflicto de unicidad', async () => {
  const store = new VercelBlobClaimStore({
    putFn: async () => { throw new Error('Vercel Blob: service unavailable'); },
  });
  await assert.rejects(() => store.claim({ leadId: 'GDN-2026-0001' }), /service unavailable/);
});

test('backfill falla cerrado ante leadId duplicado', () => {
  assert.throws(
    () => planLegacyBackfill({
      spreadsheetId: 'sheet-test-1',
      sheetName: 'CRM',
      rows: [
        { rowNumber: 2, leadId: 'DUP-1' },
        { rowNumber: 3, leadId: ' dup-1 ' },
      ],
    }),
    /leadId duplicado/i,
  );
});
