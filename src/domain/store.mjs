import { calculateBatchTotals, convertQuantity, validateUnit } from './calculations.mjs';

export const STORAGE_KEY = 'atelier-lab-state-v1';
export const LEGACY_COMPANION_STORAGE_KEY = 'atelier.scent-companion.v1';
export const CURRENT_SCHEMA_VERSION = 2;
export const statuses = ['Draft', 'Mixed', 'Maturing', 'Evaluated', 'Archived'];
export const movementTypes = ['opening', 'receipt', 'return', 'adjustment', 'consumption', 'wastage', 'correction', 'reversal'];
export const equipmentTypes = ['balance', 'pipette', 'thermometer', 'other'];
export const equipmentStatuses = ['available', 'under-maintenance', 'out-of-service', 'retired'];
export const verificationOutcomes = ['pass', 'fail', 'conditional'];
export const maintenanceEventTypes = ['maintenance', 'inspection', 'repair', 'fault'];
export const PURCHASE_EVIDENCE_MAX_BYTES = 2 * 1024 * 1024;
export const purchaseEvidenceKinds = ['file', 'reference'];
export const blindSessionStatuses = ['draft', 'randomized', 'in-progress', 'locked', 'unblinded'];
export const STOCK_PRECISION = 1e-9;

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const roundStock = value => Math.round(value / STOCK_PRECISION) * STOCK_PRECISION;

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function positiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

function nonNegativeFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
  return value;
}

function finitePercentage(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${label} must be between 0% and 100%.`);
  return value;
}

function allIds(records, label) {
  const seen = new Set();
  for (const record of records || []) {
    if (!record?.id || seen.has(record.id)) throw new Error(`Duplicate or missing ${label} id.`);
    seen.add(record.id);
  }
  return seen;
}

function timestamp(value, label) {
  const result = value || now();
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label} is invalid.`);
  return result;
}

function measurementUnit(value, label = 'Measurement unit') {
  const result = requireText(value, label);
  if (result.length > 40) throw new Error(`${label} is too long.`);
  return result;
}

function optionalFinite(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function monetary(value, label, { allowZero = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`);
  const rounded = Math.round((value + Number.EPSILON) * 1e6) / 1e6;
  if (Math.abs(value - rounded) > 1e-9) throw new Error(`${label} has too many decimal places.`);
  return rounded;
}

function currencyCode(value) {
  const result = requireText(value, 'Currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) throw new Error('Currency must be a three-letter ISO-style code.');
  return result;
}

function normalizeReceiptEvidence(input) {
  if (input === undefined || input === null || input === '') return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Receipt evidence must be an object.');
  const kind = input.kind || (input.dataUrl ? 'file' : 'reference');
  if (!purchaseEvidenceKinds.includes(kind)) throw new Error(`Unsupported receipt evidence kind "${kind}".`);
  const evidence = { kind, reference: requireText(input.reference, 'Receipt evidence reference'), fileName: input.fileName || undefined, mediaType: input.mediaType || undefined, sizeBytes: input.sizeBytes, dataUrl: input.dataUrl || undefined };
  if (kind === 'file') {
    if (!evidence.fileName) throw new Error('Receipt file evidence needs a file name.');
    if (!evidence.mediaType || !/^(image\/|application\/pdf$|text\/plain$)/.test(evidence.mediaType)) throw new Error('Receipt file type must be an image, PDF, or plain text file.');
    if (!Number.isInteger(evidence.sizeBytes) || evidence.sizeBytes < 0 || evidence.sizeBytes > PURCHASE_EVIDENCE_MAX_BYTES) throw new Error(`Receipt file must be no larger than ${PURCHASE_EVIDENCE_MAX_BYTES} bytes.`);
    if (evidence.dataUrl && !evidence.dataUrl.startsWith(`data:${evidence.mediaType};`)) throw new Error('Receipt file data does not match its media type.');
  }
  return evidence;
}

function findMaterial(state, materialId) {
  const material = state.materials.find(item => item.id === materialId);
  if (!material) throw new Error(`Material "${materialId}" was not found.`);
  return material;
}

function findLot(state, lotId) {
  for (const material of state.materials) {
    const lot = (material.lots || []).find(item => item.id === lotId);
    if (lot) return { material, lot };
  }
  throw new Error(`Material lot "${lotId}" was not found.`);
}

function lotUnit(lot) {
  return lot.receivedUnit || lot.defaultUnit || lot.remainingUnit;
}

function movementDirection(movement) {
  if (movement.movementType === 'opening' || movement.movementType === 'receipt' || movement.movementType === 'return') return 1;
  if (movement.movementType === 'consumption' || movement.movementType === 'wastage') return -1;
  if (movement.movementType === 'adjustment' || movement.movementType === 'correction') return movement.direction === 'decrease' ? -1 : 1;
  if (movement.movementType === 'reversal') return movement.direction === 'decrease' ? -1 : 1;
  throw new Error(`Unsupported stock movement type "${movement.movementType}".`);
}

// An opening balance is "established" only when the lot records a received
// amount or carries an explicit opening movement. A lot that arrived through
// legacy migration without either has no trustworthy opening: its replayed
// balance is a floor (every known consumption), not a measured stock figure.
function hasOpeningEstablished(state, lotId) {
  if (state.stockMovements.some(item => item.materialLotId === lotId && item.movementType === 'opening')) return true;
  const { lot } = findLot(state, lotId);
  return lot.receivedAmount != null;
}

// Consumption may only be added once a lot's opening is known. Without it we
// cannot tell a valid draw from an overdraft, so we refuse rather than let a
// negative replayed balance masquerade as a real stock figure.
function assertConsumptionAllowed(state, movementType, lotId) {
  if (movementType !== 'consumption') return;
  if (hasOpeningEstablished(state, lotId)) return;
  throw new Error(`Lot "${lotId}" has no established opening balance. Record its opening or received stock before recording consumption.`);
}

function normalizeMovement(state, input, { allowGeneratedId = false, enforceOpening = true } = {}) {
  const movementType = requireText(input.movementType, 'Movement type');
  if (!movementTypes.includes(movementType)) throw new Error(`Unsupported stock movement type "${movementType}".`);
  const materialId = requireText(input.materialId, 'Movement materialId');
  const material = findMaterial(state, materialId);
  const materialLotId = requireText(input.materialLotId, 'Movement materialLotId');
  const { material: owningMaterial, lot } = findLot(state, materialLotId);
  if (owningMaterial.id !== material.id || lot.materialId && lot.materialId !== material.id) throw new Error('Stock movement material and lot do not match.');
  const unit = requireText(input.unit || lotUnit(lot), 'Movement unit');
  validateUnit(unit);
  const baseUnit = lotUnit(lot) || unit;
  validateUnit(baseUnit);
  const density = input.density ?? lot.density;
  const quantity = positiveFinite(input.quantity, 'Movement quantity');
  convertQuantity(quantity, unit, baseUnit, { density });
  // Only new movements are gated. Replaying existing history through
  // validateState must never reject consumption that predates reconciliation.
  if (enforceOpening) assertConsumptionAllowed(state, movementType, materialLotId);
  if (movementType === 'reversal') {
    const reference = state.stockMovements.find(item => item.id === input.referenceMovementId);
    if (!reference) throw new Error('A reversal must reference an existing stock movement.');
    if (reference.id === input.id) throw new Error('A reversal cannot reference itself.');
    if (reference.movementType === 'reversal') throw new Error('A reversal cannot reverse another reversal.');
    if (reference.materialLotId !== materialLotId) throw new Error('A reversal must reference a movement from the same lot.');
    const direction = movementDirection(reference) > 0 ? 'decrease' : 'increase';
    if (input.direction !== undefined && input.direction !== direction) throw new Error('A reversal direction must exactly invert its reference movement.');
    input = { ...input, direction };
  }
  if ((movementType === 'correction' || movementType === 'reversal') && !input.referenceMovementId) throw new Error(`${movementType} movements require referenceMovementId.`);
  if (movementType === 'correction') {
    const reference = state.stockMovements.find(item => item.id === input.referenceMovementId);
    if (!reference) throw new Error('A correction must reference an existing stock movement.');
    if (reference.materialLotId !== materialLotId) throw new Error('A correction must reference a movement from the same lot.');
    if (reference.id === input.id) throw new Error('A correction cannot reference itself.');
  }
  if ((movementType === 'adjustment' || movementType === 'correction') && !['increase', 'decrease'].includes(input.direction)) throw new Error(`${movementType} movements require direction increase or decrease.`);
  if (['adjustment', 'correction', 'wastage'].includes(movementType) && !String(input.note || '').trim()) throw new Error(`${movementType} movements require a reason.`);
  if (movementType === 'adjustment' && input.verified !== true) throw new Error('Adjustments require explicit verification.');
  if (movementType === 'return' && input.confirmedReturn !== true) throw new Error('Returns require explicit confirmation of the quantity returned.');
  if (movementType === 'reversal' && state.stockMovements.some(item => item.movementType === 'reversal' && item.referenceMovementId === input.referenceMovementId && item.id !== input.id)) throw new Error('A stock movement can only be reversed once.');
  const createdAt = input.occurredAt || now();
  if (Number.isNaN(Date.parse(createdAt))) throw new Error('Movement timestamp is invalid.');
  if ((movementType === 'reversal' || movementType === 'correction') && input.referenceMovementId) {
    const reference = state.stockMovements.find(item => item.id === input.referenceMovementId);
    if (reference && Date.parse(createdAt) < Date.parse(reference.occurredAt)) throw new Error(`${movementType} timestamp cannot precede its reference movement.`);
  }
  return {
    id: input.id || (allowGeneratedId ? id('movement') : undefined),
    materialId: material.id,
    materialLotId,
    movementType,
    quantity,
    unit,
    density,
    direction: input.direction,
    verified: input.verified === true,
    confirmedReturn: input.confirmedReturn === true,
    occurredAt: createdAt,
    note: input.note || '',
    batchId: input.batchId,
    additionId: input.additionId,
    referenceMovementId: input.referenceMovementId,
    provenance: input.provenance || 'recorded'
  };
}

export function createInitialState() {
  const revisionId = 'revision-seed-1';
  const experimentId = 'experiment-seed-1';
  const materialId = 'material-seed-1';
  const batchId = 'batch-seed-1';
  const lots = [
    { id: 'lot-seed-1', materialId, lotCode: 'DEMO-001', acquiredAt: '2026-10-01', receivedAt: '2026-10-01', receivedAmount: 100, receivedUnit: 'g', purity: 100, stockConcentration: 100, solvent: 'None', purchaseLineItemIds: [], notes: 'Synthetic sample lot.' },
    { id: 'lot-seed-2', materialId: 'material-seed-2', lotCode: 'DEMO-002', acquiredAt: '2026-10-01', receivedAt: '2026-10-01', receivedAmount: 100, receivedUnit: 'g', purity: 100, stockConcentration: 0, solvent: 'None', purchaseLineItemIds: [], notes: 'Synthetic sample lot.' }
  ];
  return {
    version: CURRENT_SCHEMA_VERSION,
    journalEntries: [{ id: 'journal-seed-1', title: 'Rain on warm stone', observedAt: '2026-10-14T08:30:00.000Z', purpose: 'Explore a mineral-woody balance after a rainy morning.', hypothesis: 'A dry cedar base will keep the mineral accord from feeling austere.', materials: 'Bergamot, cedar, amber accord', opening: 'Cool citrus and wet stone.', heart: 'Green tea with dry cedar.', dryDown: 'Quiet amber and skin musk.', overall: 'Airy, contemplative, and easy to revisit.', descriptors: ['green', 'woody', 'aquatic'], intensity: 3, longevityHours: 5, projection: 2, evaluationTimeMinutes: 30, medium: 'Blotter', environment: 'Open studio, 22°C', personalNotes: 'Personal sensory impression; no instrument measurement.', conclusion: 'Promising opening; revisit on skin.', nextSteps: 'Try a slightly warmer amber base.', tags: ['atmospheric', 'woody'], experimentId, attachmentRefs: [], provenance: 'synthetic-demo' }],
    experiments: [{ id: experimentId, experimentId: 'EXP-001', title: 'Mineral garden accord', objective: 'Test a fresh woody accord for a quiet daytime profile.', status: 'Maturing', createdAt: '2026-10-10T09:00:00.000Z', formulaRevisionIds: [revisionId], journalEntryIds: ['journal-seed-1'], batchIds: [batchId], evaluationIds: ['evaluation-seed-1'], tags: ['fresh', 'woody'] }],
    revisions: [{ id: revisionId, experimentId, revision: 1, createdAt: '2026-10-10T09:15:00.000Z', objective: 'Initial formula', supersedesRevisionId: null, notes: 'Seed formula. Historical revisions are immutable.', ingredients: [{ materialId, materialName: 'Cedar atlas accord', lotId: 'lot-seed-1', quantity: 20, unit: 'g', stockConcentration: 100, role: 'Base' }, { materialId: 'material-seed-2', materialName: 'Neutral perfumer alcohol', lotId: 'lot-seed-2', quantity: 80, unit: 'g', stockConcentration: 0, role: 'Diluent' }] }],
    materials: [{ id: materialId, name: 'Cedar atlas accord', canonicalIdentity: '', supplier: '', productReference: '', safetyReference: '', storageNotes: 'Store cool and dark.', lots: [lots[0]] }, { id: 'material-seed-2', name: 'Neutral perfumer alcohol', canonicalIdentity: '', supplier: '', productReference: '', safetyReference: '', storageNotes: 'Closed container.', lots: [lots[1]] }],
    batches: [{ id: batchId, batchCode: 'BATCH-001', experimentId, formulaRevisionId: revisionId, plannedAmount: 100, unit: 'g', actualAdditions: [{ id: 'addition-seed-1', materialId, materialLotId: 'lot-seed-1', amount: 20, unit: 'g', concentration: 100, addedAt: '2026-10-10T09:30:00.000Z', stockMovementId: 'movement-seed-1' }, { id: 'addition-seed-2', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 80, unit: 'g', concentration: 0, addedAt: '2026-10-10T09:30:00.000Z', stockMovementId: 'movement-seed-2' }], procedureNotes: 'Blend slowly, then store covered.', maturationSchedule: 'Evaluate at 0h, 24h, and 7d.', result: 'Awaiting final evaluation.', createdAt: '2026-10-10T09:30:00.000Z' }],
    evaluations: [{ id: 'evaluation-seed-1', experimentId, batchId, revisionId, evaluatedAt: '2026-10-14T08:30:00.000Z', intervalLabel: '96 hours', medium: 'Blotter', environment: 'Open studio, 22°C', descriptors: ['green', 'woody'], scores: { intensity: 3, longevity: 3, projection: 2 }, subjectiveNotes: 'Still fresh with a dry cedar backbone.', measuredResults: '', isMeasured: false, provenance: 'synthetic-demo' }],
    stockMovements: [
      { id: 'movement-seed-opening-1', materialId, materialLotId: 'lot-seed-1', movementType: 'opening', quantity: 100, unit: 'g', occurredAt: '2026-10-01T00:00:00.000Z', note: 'Synthetic demo opening balance.', provenance: 'synthetic-demo' },
      { id: 'movement-seed-opening-2', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', movementType: 'opening', quantity: 100, unit: 'g', occurredAt: '2026-10-01T00:00:00.000Z', note: 'Synthetic demo opening balance.', provenance: 'synthetic-demo' },
      { id: 'movement-seed-1', materialId, materialLotId: 'lot-seed-1', movementType: 'consumption', quantity: 20, unit: 'g', occurredAt: '2026-10-10T09:30:00.000Z', batchId, additionId: 'addition-seed-1', note: 'Seed batch consumption.', provenance: 'synthetic-demo' },
      { id: 'movement-seed-2', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', movementType: 'consumption', quantity: 80, unit: 'g', occurredAt: '2026-10-10T09:30:00.000Z', batchId, additionId: 'addition-seed-2', note: 'Seed batch consumption.', provenance: 'synthetic-demo' }
    ],
    calculations: [], tags: ['atmospheric', 'woody', 'fresh'], attachments: [], companionEntries: [], equipment: [], verificationEvents: [], maintenanceEvents: [], measurements: [], purchases: [], purchaseLineItems: [], blindSessions: [], blindSamples: []
  };
}

const STATE_COLLECTIONS = ['journalEntries', 'experiments', 'revisions', 'materials', 'batches', 'evaluations', 'calculations', 'tags', 'attachments', 'companionEntries', 'stockMovements', 'equipment', 'verificationEvents', 'maintenanceEvents', 'measurements', 'purchases', 'purchaseLineItems', 'blindSessions', 'blindSamples'];

export function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Atelier state must be a JSON object.');
  if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) throw new Error('Atelier state schema version is invalid.');
  if (input.version > CURRENT_SCHEMA_VERSION) throw new Error(`Atelier data uses unsupported schema version ${input.version}.`);
  const state = { ...clone(input), version: input.version ?? 1 };
  for (const key of STATE_COLLECTIONS) state[key] = Array.isArray(state[key]) ? state[key] : [];
  state.materials = state.materials.map(material => {
    if (!material || typeof material !== 'object') throw new Error('Material records must be JSON objects.');
    return { ...material, lots: Array.isArray(material.lots) ? material.lots.map(lot => { if (!lot || typeof lot !== 'object') throw new Error('Material lot records must be JSON objects.'); return { ...lot, materialId: lot.materialId || material.id, purchaseLineItemIds: Array.isArray(lot.purchaseLineItemIds) ? lot.purchaseLineItemIds : [] }; }) : [] };
  });
  if ((input.version || 1) < CURRENT_SCHEMA_VERSION && (!Array.isArray(input.stockMovements) || input.stockMovements.length === 0)) {
    // Legacy v1 batches recorded actual additions but no stock ledger. We can
    // honestly reconstruct the consumption those additions document, but the
    // opening balance is NOT recoverable from consumption history — inferring
    // it would fabricate inventory. So: record only the consumption movements
    // and leave any lot without a receivedAmount balance unknown. A lot that
    // already carries receivedAmount gets an explicit opening movement for
    // exactly that recorded amount, never for a derived total.
    const additionsByLot = new Map();
    for (const batch of state.batches) for (const addition of batch.actualAdditions || []) if (addition.materialLotId) additionsByLot.set(addition.materialLotId, [...(additionsByLot.get(addition.materialLotId) || []), { batch, addition }]);
    state.stockMovements = [];
    for (const [lotId, rows] of additionsByLot) {
      const { lot } = findLot(state, lotId);
      const unit = lot.receivedUnit || lot.defaultUnit || lot.remainingUnit || rows[0]?.addition.unit;
      let consumptionTotal;
      try { consumptionTotal = unit ? rows.reduce((sum, row) => sum + convertQuantity(row.addition.amount, row.addition.unit, unit, { density: row.addition.density ?? lot.density }), 0) : undefined; } catch { consumptionTotal = undefined; }
      const hasReceived = lot.receivedAmount != null && (lot.receivedUnit || lot.defaultUnit);
      const hasRemaining = lot.remainingAmount != null && Number.isFinite(lot.remainingAmount) && lot.remainingAmount >= 0 && unit && consumptionTotal !== undefined;
      if (hasReceived || hasRemaining) {
        const openingQuantity = hasReceived ? lot.receivedAmount : lot.remainingAmount + consumptionTotal;
        const note = hasReceived ? 'Migrated opening balance from recorded lot received amount.' : 'Migrated opening balance from recorded remaining quantity plus documented historical consumption.';
        state.stockMovements.push({ id: `movement-legacy-opening-${lotId}`, materialId: lot.materialId, materialLotId: lotId, movementType: 'opening', quantity: openingQuantity, unit, density: lot.density, occurredAt: lot.receivedAt || rows[0].batch.createdAt || now(), note, provenance: 'migration' });
        lot.reconciliation = 'established';
      } else {
        // No trustworthy opening exists for this lot. Preserve the historical
        // consumption (below) but flag the lot as unreconciled so its replayed
        // balance is read as a floor, and block further consumption until the
        // real opening is recorded.
        lot.reconciliation = 'unreconciled';
      }
      for (const row of rows) { const movementId = `movement-legacy-${row.addition.id}`; row.addition.stockMovementId = movementId; state.stockMovements.push({ id: movementId, materialId: row.addition.materialId, materialLotId: row.addition.materialLotId, movementType: 'consumption', quantity: row.addition.amount, unit: row.addition.unit, density: row.addition.density, occurredAt: row.addition.addedAt || row.batch.createdAt || now(), batchId: row.batch.id, additionId: row.addition.id, note: 'Migrated from legacy actual addition.', provenance: 'migration' }); }
    }
  }
  state.version = CURRENT_SCHEMA_VERSION;
  return state;
}

export function validateState(state) {
  const normalized = normalizeState(state);
  allIds(normalized.journalEntries, 'journal entry'); allIds(normalized.experiments, 'experiment'); allIds(normalized.revisions, 'revision'); allIds(normalized.batches, 'batch'); allIds(normalized.evaluations, 'evaluation'); allIds(normalized.stockMovements, 'stock movement');
  const equipmentIds = allIds(normalized.equipment, 'equipment'); allIds(normalized.verificationEvents, 'verification event'); allIds(normalized.maintenanceEvents, 'maintenance event'); allIds(normalized.measurements, 'measurement');
  const purchaseIds = allIds(normalized.purchases, 'purchase'); allIds(normalized.purchaseLineItems, 'purchase line item');
  const blindSessionIds = allIds(normalized.blindSessions, 'blind session'); const blindSampleIds = allIds(normalized.blindSamples, 'blind sample');
  const materialIds = allIds(normalized.materials, 'material');
  const lotIds = new Set();
  for (const material of normalized.materials) {
    if (!material.name || typeof material.name !== 'string') throw new Error('Every material needs a name.');
    const lotCodes = new Set();
    for (const lot of material.lots || []) {
      if (!lot.id || lotIds.has(lot.id)) throw new Error('Duplicate or missing material lot id.');
      lotIds.add(lot.id);
      if (lot.materialId !== material.id) throw new Error(`Lot ${lot.id} does not belong to its material.`);
      if (lot.lotCode && (lotCodes.has(lot.lotCode.trim()) || !lot.lotCode.trim())) throw new Error(`Duplicate or ambiguous lot code for material ${material.id}.`);
      if (lot.lotCode) lotCodes.add(lot.lotCode.trim());
      if (lot.receivedUnit) validateUnit(lot.receivedUnit);
      if (lot.defaultUnit) validateUnit(lot.defaultUnit);
      if (lot.receivedAmount !== undefined) positiveFinite(lot.receivedAmount, `Lot ${lot.id} received amount`);
      if (lot.purity !== undefined) finitePercentage(lot.purity, `Lot ${lot.id} purity`);
      if (lot.stockConcentration !== undefined) finitePercentage(lot.stockConcentration, `Lot ${lot.id} concentration`);
      if (lot.density !== undefined) positiveFinite(lot.density, `Lot ${lot.id} density`);
      if (lot.lowStockThreshold !== undefined) nonNegativeFinite(lot.lowStockThreshold, `Lot ${lot.id} low-stock threshold`);
      if (lot.expiryDate && Number.isNaN(Date.parse(lot.expiryDate))) throw new Error(`Lot ${lot.id} expiry date is invalid.`);
      if (lot.retestDate && Number.isNaN(Date.parse(lot.retestDate))) throw new Error(`Lot ${lot.id} retest date is invalid.`);
      if (!Array.isArray(lot.purchaseLineItemIds) || new Set(lot.purchaseLineItemIds).size !== lot.purchaseLineItemIds.length) throw new Error(`Lot ${lot.id} purchase links are invalid.`);
    }
  }
  const experimentIds = new Set(normalized.experiments.map(item => item.id)); const revisionIds = new Set(normalized.revisions.map(item => item.id)); const batchIds = new Set(normalized.batches.map(item => item.id));
  for (const experiment of normalized.experiments) { if (!statuses.includes(experiment.status)) throw new Error(`Invalid experiment status for ${experiment.id}.`); for (const revisionId of experiment.formulaRevisionIds || []) { const revision = normalized.revisions.find(item => item.id === revisionId); if (!revision || revision.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid revision link.`); } for (const batchId of experiment.batchIds || []) { const batch = normalized.batches.find(item => item.id === batchId); if (!batch || batch.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid batch link.`); } for (const evaluationId of experiment.evaluationIds || []) { const evaluation = normalized.evaluations.find(item => item.id === evaluationId); if (!evaluation || evaluation.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid evaluation link.`); } }
  for (const revision of normalized.revisions) { if (!experimentIds.has(revision.experimentId)) throw new Error(`Revision ${revision.id} references an unknown experiment.`); if (revision.supersedesRevisionId && (!revisionIds.has(revision.supersedesRevisionId) || normalized.revisions.find(item => item.id === revision.supersedesRevisionId).experimentId !== revision.experimentId)) throw new Error(`Revision ${revision.id} has an invalid predecessor.`); for (const ingredient of revision.ingredients || []) { if (!materialIds.has(ingredient.materialId)) throw new Error(`Revision ${revision.id} references an unknown material.`); if (ingredient.lotId && !lotIds.has(ingredient.lotId)) throw new Error(`Revision ${revision.id} references an unknown lot.`); } }
  const batchCodes = new Set(); const idempotencyKeys = new Set();
  for (const batch of normalized.batches) { if (!experimentIds.has(batch.experimentId)) throw new Error(`Batch ${batch.id} references an unknown experiment.`); const revision = normalized.revisions.find(item => item.id === batch.formulaRevisionId); if (!revision || revision.experimentId !== batch.experimentId) throw new Error(`Batch ${batch.id} references an invalid revision.`); positiveFinite(batch.plannedAmount, `Batch ${batch.id} planned amount`); validateUnit(batch.unit); if (!batch.batchCode || batchCodes.has(batch.batchCode)) throw new Error(`Duplicate or missing batch code for ${batch.id}.`); batchCodes.add(batch.batchCode); if (batch.idempotencyKey) { if (idempotencyKeys.has(batch.idempotencyKey)) throw new Error(`Duplicate batch idempotency key for ${batch.id}.`); idempotencyKeys.add(batch.idempotencyKey); } if (batch.mixingDate && Number.isNaN(Date.parse(batch.mixingDate))) throw new Error(`Batch ${batch.id} mixing date is invalid.`); for (const addition of batch.actualAdditions || []) { validateAddition(normalized, addition); if (addition.addedAt && Number.isNaN(Date.parse(addition.addedAt))) throw new Error(`Batch addition ${addition.id} timestamp is invalid.`); const movement = normalized.stockMovements.find(item => item.id === addition.stockMovementId); if (!movement) throw new Error(`Batch addition ${addition.id} is missing a stock movement.`); if (movement.movementType !== 'consumption') throw new Error(`Batch addition ${addition.id} must link to a consumption movement.`); if (movement.batchId !== batch.id || movement.additionId !== addition.id) throw new Error(`Batch addition ${addition.id} and movement ${movement.id} do not reference each other.`); if (movement.materialId !== addition.materialId || movement.materialLotId !== addition.materialLotId) throw new Error(`Batch addition ${addition.id} and movement ${movement.id} disagree on material or lot.`); if (movement.quantity !== addition.amount || !unitsInterchangeable(movement.unit, addition.unit, movement.density ?? lotOf(normalized, addition.materialLotId).density)) throw new Error(`Batch addition ${addition.id} and movement ${movement.id} disagree on quantity or unit.`); } }
  for (const material of normalized.materials) for (const lot of material.lots || []) {
    if (!hasOpeningEstablished(normalized, lot.id)) continue;
    const unit = lotUnit(lot) || normalized.stockMovements.find(item => item.materialLotId === lot.id)?.unit;
    if (unit && stockBalance(normalized, lot.id, unit) < -1e-9) throw new Error(`Lot ${lot.id} ledger replay would produce a negative stock balance.`);
  }
  for (const evaluation of normalized.evaluations) { if (!experimentIds.has(evaluation.experimentId)) throw new Error(`Evaluation ${evaluation.id} references an unknown experiment.`); if (evaluation.batchId) { const batch = normalized.batches.find(item => item.id === evaluation.batchId); if (!batch || batch.experimentId !== evaluation.experimentId) throw new Error(`Evaluation ${evaluation.id} references an invalid batch.`); if (evaluation.revisionId && evaluation.revisionId !== batch.formulaRevisionId) throw new Error(`Evaluation ${evaluation.id} revision does not match its batch.`); } if (evaluation.revisionId && (!revisionIds.has(evaluation.revisionId) || normalized.revisions.find(item => item.id === evaluation.revisionId).experimentId !== evaluation.experimentId)) throw new Error(`Evaluation ${evaluation.id} references an invalid revision.`); }
  for (const movement of normalized.stockMovements) { normalizeMovement(normalized, movement, { allowGeneratedId: true, enforceOpening: false }); if (movement.batchId && !batchIds.has(movement.batchId)) throw new Error(`Movement ${movement.id} references an unknown batch.`); if (movement.movementType === 'consumption' && (!movement.batchId || !movement.additionId)) throw new Error(`Consumption movement ${movement.id} must reference a batch and addition.`); if (movement.movementType === 'consumption') { const batch = normalized.batches.find(item => item.id === movement.batchId); const addition = (batch?.actualAdditions || []).find(item => item.id === movement.additionId); if (!addition) throw new Error(`Consumption movement ${movement.id} references an unknown batch addition.`); if (addition.stockMovementId !== movement.id) throw new Error(`Consumption movement ${movement.id} and addition ${addition.id} do not reference each other.`); if (movement.quantity !== addition.amount || !unitsInterchangeable(movement.unit, addition.unit, movement.density ?? lotOf(normalized, addition.materialLotId).density)) throw new Error(`Consumption movement ${movement.id} and addition ${addition.id} disagree on quantity or unit.`); } }
  for (const evaluation of normalized.evaluations) {
    if (!evaluation.id || !evaluation.evaluatedAt || Number.isNaN(Date.parse(evaluation.evaluatedAt))) throw new Error(`Evaluation ${evaluation.id || 'unknown'} has an invalid evaluation timestamp.`);
    if (evaluation.elapsedMinutes !== undefined) nonNegativeFinite(evaluation.elapsedMinutes, `Evaluation ${evaluation.id} elapsed time`);
    if (evaluation.batchId) {
      const batch = normalized.batches.find(item => item.id === evaluation.batchId);
      if (!batch) throw new Error(`Evaluation ${evaluation.id} references an unknown batch.`);
      if (batch.experimentId !== evaluation.experimentId) throw new Error(`Evaluation ${evaluation.id} batch belongs to another experiment.`);
      if (!evaluation.revisionId) throw new Error(`Evaluation ${evaluation.id} must preserve the batch formula revision.`);
      if (evaluation.revisionId !== batch.formulaRevisionId) throw new Error(`Evaluation ${evaluation.id} revision does not match its batch.`);
    }
    if (evaluation.revisionId) {
      const revision = normalized.revisions.find(item => item.id === evaluation.revisionId);
      if (!revision || revision.experimentId !== evaluation.experimentId) throw new Error(`Evaluation ${evaluation.id} references an invalid revision.`);
    }
    if (evaluation.isMeasured && !String(evaluation.measuredResults || '').trim()) throw new Error(`Measured evaluation ${evaluation.id} must include measured results.`);
    if (evaluation.provenance === 'measured' && !evaluation.isMeasured) throw new Error(`Evaluation ${evaluation.id} has measured provenance but is not marked measured.`);
    if (evaluation.provenance === 'ai-generated' && !Array.isArray(evaluation.aiSuggestions)) throw new Error(`AI-generated evaluation ${evaluation.id} must keep suggestions in an array.`);
    if (evaluation.scores && typeof evaluation.scores !== 'object') throw new Error(`Evaluation ${evaluation.id} scores must be an object.`);
  }
  const purchaseLinesByPurchase = new Map();
  for (const purchase of normalized.purchases) {
    requireText(purchase.supplier, `Purchase ${purchase.id} supplier`); timestamp(purchase.purchaseDate, `Purchase ${purchase.id} date`); currencyCode(purchase.currency);
    if (!Array.isArray(purchase.lineItemIds) || new Set(purchase.lineItemIds).size !== purchase.lineItemIds.length) throw new Error(`Purchase ${purchase.id} line links are invalid.`);
    if (purchase.receiptEvidence) normalizeReceiptEvidence(purchase.receiptEvidence);
    monetary(purchase.discount ?? 0, `Purchase ${purchase.id} discount`); monetary(purchase.tax ?? 0, `Purchase ${purchase.id} tax`); monetary(purchase.shipping ?? 0, `Purchase ${purchase.id} shipping`);
    purchaseLinesByPurchase.set(purchase.id, new Set(purchase.lineItemIds));
    for (const lineId of purchase.lineItemIds) if (!normalized.purchaseLineItems.some(item => item.id === lineId)) throw new Error(`Purchase ${purchase.id} references an unknown line item.`);
  }
  for (const line of normalized.purchaseLineItems) {
    if (!purchaseIds.has(line.purchaseId)) throw new Error(`Purchase line item ${line.id} references an unknown purchase.`);
    if (!purchaseLinesByPurchase.get(line.purchaseId)?.has(line.id)) throw new Error(`Purchase ${line.purchaseId} is missing line item link ${line.id}.`);
    if (!materialIds.has(line.materialId)) throw new Error(`Purchase line item ${line.id} references an unknown material.`);
    const { material, lot } = findLot(normalized, line.materialLotId);
    if (material.id !== line.materialId) throw new Error(`Purchase line item ${line.id} material and lot do not match.`);
    positiveFinite(line.quantity, `Purchase line item ${line.id} quantity`); validateUnit(line.unit); monetary(line.unitPrice, `Purchase line item ${line.id} unit price`); monetary(line.lineTotal, `Purchase line item ${line.id} line total`);
    if (Math.abs(line.lineTotal - line.quantity * line.unitPrice) > 0.000001) throw new Error(`Purchase line item ${line.id} line total does not match quantity and unit price.`);
    if (!lot.purchaseLineItemIds.includes(line.id)) throw new Error(`Lot ${line.materialLotId} is missing purchase line link ${line.id}.`);
  }
  for (const purchase of normalized.purchases) {
    const subtotal = normalized.purchaseLineItems.filter(line => line.purchaseId === purchase.id).reduce((sum, line) => sum + line.lineTotal, 0);
    const total = subtotal - (purchase.discount || 0) + (purchase.tax || 0) + (purchase.shipping || 0);
    if (total < -0.000001) throw new Error(`Purchase ${purchase.id} total cannot be negative.`);
  }
  const samplesBySession = new Map();
  for (const session of normalized.blindSessions) {
    requireText(session.name, `Blind session ${session.id} name`); requireText(session.purpose, `Blind session ${session.id} purpose`); timestamp(requireText(session.sessionDate, `Blind session ${session.id} date`), `Blind session ${session.id} date`);
    if (!blindSessionStatuses.includes(session.status)) throw new Error(`Blind session ${session.id} has an invalid status.`);
    if (!Array.isArray(session.sampleIds) || session.sampleIds.length < 2 || new Set(session.sampleIds).size !== session.sampleIds.length) throw new Error(`Blind session ${session.id} must contain at least two unique samples.`);
    if (session.randomizedAt) timestamp(session.randomizedAt, `Blind session ${session.id} randomizedAt`);
    if (session.lockedAt) timestamp(session.lockedAt, `Blind session ${session.id} lockedAt`);
    if (session.unblindedAt) timestamp(session.unblindedAt, `Blind session ${session.id} unblindedAt`);
    if (session.status !== 'draft' && !session.randomizedAt) throw new Error(`Blind session ${session.id} is missing randomizedAt.`);
    if (['locked', 'unblinded'].includes(session.status) && !session.lockedAt) throw new Error(`Blind session ${session.id} is missing lockedAt.`);
    if (session.status === 'unblinded' && !session.unblindedAt) throw new Error(`Blind session ${session.id} is missing unblindedAt.`);
    samplesBySession.set(session.id, new Set(session.sampleIds));
  }
  const codesBySession = new Map(); const positionsBySession = new Map();
  for (const sample of normalized.blindSamples) {
    if (!blindSessionIds.has(sample.sessionId)) throw new Error(`Blind sample ${sample.id} references an unknown session.`);
    const batch = normalized.batches.find(item => item.id === sample.batchId); const revision = normalized.revisions.find(item => item.id === sample.revisionId); const experiment = normalized.experiments.find(item => item.id === sample.experimentId);
    if (!batch || !experiment || !revision) throw new Error(`Blind sample ${sample.id} references missing batch, experiment, or revision.`);
    if (batch.experimentId !== sample.experimentId || batch.formulaRevisionId !== sample.revisionId || revision.experimentId !== sample.experimentId) throw new Error(`Blind sample ${sample.id} has mismatched batch and revision links.`);
    if (!samplesBySession.get(sample.sessionId)?.has(sample.id)) throw new Error(`Blind session ${sample.sessionId} is missing sample ${sample.id}.`);
    const session = normalized.blindSessions.find(item => item.id === sample.sessionId);
    if (sample.blindCode !== undefined && sample.blindCode !== null && sample.blindCode !== '') {
      if (!/^BT-[A-Z0-9]{6,}$/.test(sample.blindCode)) throw new Error(`Blind sample ${sample.id} code is not opaque and valid.`);
      const codes = codesBySession.get(sample.sessionId) || new Set(); if (codes.has(sample.blindCode)) throw new Error(`Blind session ${sample.sessionId} contains duplicate blind codes.`); codes.add(sample.blindCode); codesBySession.set(sample.sessionId, codes);
    }
    if (sample.position !== undefined && sample.position !== null) { if (!Number.isInteger(sample.position) || sample.position < 1 || sample.position > session.sampleIds.length) throw new Error(`Blind sample ${sample.id} position is invalid.`); const positions = positionsBySession.get(sample.sessionId) || new Set(); if (positions.has(sample.position)) throw new Error(`Blind session ${sample.sessionId} contains duplicate sample positions.`); positions.add(sample.position); positionsBySession.set(sample.sessionId, positions); }
    if (session.status !== 'draft' && (!sample.blindCode || sample.position === undefined || sample.position === null)) throw new Error(`Blind sample ${sample.id} is incomplete for a randomized session.`);
  }
  for (const session of normalized.blindSessions) for (const sampleId of session.sampleIds) if (!blindSampleIds.has(sampleId)) throw new Error(`Blind session ${session.id} references an unknown sample.`);
  for (const evaluation of normalized.evaluations) {
    if (!evaluation.blindSessionId && !evaluation.blindSampleId && !evaluation.blindCode) continue;
    if (!evaluation.blindSessionId || !evaluation.blindSampleId || !evaluation.blindCode) throw new Error(`Blind evaluation ${evaluation.id} must preserve session, sample, and code links.`);
    const session = normalized.blindSessions.find(item => item.id === evaluation.blindSessionId); const sample = normalized.blindSamples.find(item => item.id === evaluation.blindSampleId);
    if (!session || !sample || sample.sessionId !== session.id || sample.blindCode !== evaluation.blindCode) throw new Error(`Blind evaluation ${evaluation.id} has invalid session/sample mapping.`);
    if (evaluation.batchId !== sample.batchId || evaluation.revisionId !== sample.revisionId || evaluation.experimentId !== sample.experimentId) throw new Error(`Blind evaluation ${evaluation.id} does not match its assigned batch and revision.`);
    if (evaluation.blindLockedAt) timestamp(evaluation.blindLockedAt, `Blind evaluation ${evaluation.id} lock time`);
    if (['locked', 'unblinded'].includes(session.status) && evaluation.blindLockedAt !== session.lockedAt) throw new Error(`Blind evaluation ${evaluation.id} is not finalized with its locked session.`);
  }
  for (const session of normalized.blindSessions) if (['locked', 'unblinded'].includes(session.status)) for (const sampleId of session.sampleIds) if (!normalized.evaluations.some(item => item.blindSessionId === session.id && item.blindSampleId === sampleId)) throw new Error(`Blind session ${session.id} is finalized with an incomplete sample.`);
  for (const material of normalized.materials) for (const lot of material.lots || []) for (const lineId of lot.purchaseLineItemIds) {
    const line = normalized.purchaseLineItems.find(item => item.id === lineId);
    if (!line || line.materialLotId !== lot.id || line.materialId !== material.id) throw new Error(`Lot ${lot.id} has an invalid purchase line link.`);
  }
  for (const batch of normalized.batches) for (const addition of batch.actualAdditions || []) if (addition.purchaseLineItemId) {
    const line = normalized.purchaseLineItems.find(item => item.id === addition.purchaseLineItemId);
    if (!line || line.materialId !== addition.materialId || line.materialLotId !== addition.materialLotId) throw new Error(`Batch addition ${addition.id} purchase line does not match its material or lot.`);
  }
  for (const equipment of normalized.equipment) {
    requireText(equipment.name, `Equipment ${equipment.id} name`);
    if (!equipmentTypes.includes(equipment.equipmentType)) throw new Error(`Equipment ${equipment.id} has an invalid type.`);
    if (!equipmentStatuses.includes(equipment.status)) throw new Error(`Equipment ${equipment.id} has an invalid status.`);
    if (equipment.acquiredAt && Number.isNaN(Date.parse(equipment.acquiredAt))) throw new Error(`Equipment ${equipment.id} acquisition date is invalid.`);
    if (equipment.lastVerifiedAt && Number.isNaN(Date.parse(equipment.lastVerifiedAt))) throw new Error(`Equipment ${equipment.id} last verified date is invalid.`);
    if (equipment.resolution !== undefined) positiveFinite(equipment.resolution, `Equipment ${equipment.id} resolution`);
    if (equipment.resolutionUnit !== undefined) measurementUnit(equipment.resolutionUnit, `Equipment ${equipment.id} resolution unit`);
  }
  for (const event of normalized.verificationEvents) {
    if (!equipmentIds.has(event.equipmentId)) throw new Error(`Verification event ${event.id} references unknown equipment.`);
    if (!verificationOutcomes.includes(event.outcome)) throw new Error(`Verification event ${event.id} has an invalid outcome.`);
    timestamp(event.performedAt, `Verification event ${event.id} timestamp`);
    if (event.nextDueAt && Number.isNaN(Date.parse(event.nextDueAt))) throw new Error(`Verification event ${event.id} due date is invalid.`);
    if (event.referenceMeasurementId && !normalized.measurements.some(item => item.id === event.referenceMeasurementId)) throw new Error(`Verification event ${event.id} references an unknown measurement.`);
  }
  for (const event of normalized.maintenanceEvents) {
    if (!equipmentIds.has(event.equipmentId)) throw new Error(`Maintenance event ${event.id} references unknown equipment.`);
    if (!maintenanceEventTypes.includes(event.eventType)) throw new Error(`Maintenance event ${event.id} has an invalid type.`);
    timestamp(event.occurredAt, `Maintenance event ${event.id} timestamp`);
    if (event.completedAt && Number.isNaN(Date.parse(event.completedAt))) throw new Error(`Maintenance event ${event.id} completion date is invalid.`);
  }
  const journalIds = new Set(normalized.journalEntries.map(item => item.id));
  for (const measurement of normalized.measurements) {
    if (!equipmentIds.has(measurement.equipmentId)) throw new Error(`Measurement ${measurement.id} references unknown equipment.`);
    requireText(measurement.quantityType, `Measurement ${measurement.id} quantity type`); measurementUnit(measurement.unit, `Measurement ${measurement.id} unit`);
    if (typeof measurement.value !== 'number' || !Number.isFinite(measurement.value)) throw new Error(`Measurement ${measurement.id} value must be finite.`);
    if (measurement.resolution !== undefined) positiveFinite(measurement.resolution, `Measurement ${measurement.id} resolution`);
    timestamp(measurement.measuredAt, `Measurement ${measurement.id} timestamp`);
    if (measurement.batchId && !batchIds.has(measurement.batchId)) throw new Error(`Measurement ${measurement.id} references unknown batch.`);
    if (measurement.experimentId && !experimentIds.has(measurement.experimentId)) throw new Error(`Measurement ${measurement.id} references unknown experiment.`);
    if (measurement.journalEntryId && !journalIds.has(measurement.journalEntryId)) throw new Error(`Measurement ${measurement.id} references unknown journal entry.`);
    if (measurement.evaluationId && !normalized.evaluations.some(item => item.id === measurement.evaluationId)) throw new Error(`Measurement ${measurement.id} references unknown evaluation.`);
    if (measurement.batchId && measurement.experimentId) { const batch = normalized.batches.find(item => item.id === measurement.batchId); if (batch.experimentId !== measurement.experimentId) throw new Error(`Measurement ${measurement.id} batch and experiment do not match.`); }
  }
  return normalized;
}

export function loadState(storage = globalThis.localStorage) {
  if (!storage) return createInitialState();
  let raw;
  try { raw = storage.getItem(STORAGE_KEY); } catch { throw new Error('Atelier storage is unavailable in this browser.'); }
  if (!raw) return createInitialState();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Saved Atelier data is malformed. Import a valid backup before continuing.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved Atelier data is malformed. Import a valid backup before continuing.');
  if (parsed.version > CURRENT_SCHEMA_VERSION) throw new Error(`Saved Atelier data uses unsupported schema version ${parsed.version}.`);
  return validateState(parsed);
}

export function saveState(state, storage = globalThis.localStorage) {
  const validated = validateState(state);
  if (!storage) throw new Error('Atelier storage is unavailable in this browser.');
  try { storage.setItem(STORAGE_KEY, JSON.stringify(validated)); return validated; } catch { throw new Error('Could not save Atelier data in this browser. Keep this editor open and try again.'); }
}

// Whether two unit labels can describe the same measurement: identical labels
// always, or convertible ones when a density bridges mass and volume. This
// answers compatibility only — callers still require the recorded quantities
// to match exactly, so a movement re-expressed as `1000 mg` against a `1 g`
// addition is rejected rather than silently replaying a different balance.
function unitsInterchangeable(fromUnit, toUnit, density) {
  if (fromUnit === toUnit) return true;
  try { convertQuantity(1, fromUnit, toUnit, { density }); return true; } catch { return false; }
}

function lotOf(state, lotId) { return findLot(state, lotId).lot; }

function validateAddition(state, addition) {
  if (!addition?.id) throw new Error('Every batch addition needs an id.');
  const material = findMaterial(state, addition.materialId); const { material: owningMaterial, lot } = findLot(state, addition.materialLotId);
  if (material.id !== owningMaterial.id || lot.materialId !== material.id) throw new Error(`Batch addition ${addition.id} material and lot do not match.`);
  positiveFinite(addition.amount, `Batch addition ${addition.id} amount`); validateUnit(addition.unit); finitePercentage(addition.concentration ?? 100, `Batch addition ${addition.id} concentration`); convertQuantity(addition.amount, addition.unit, lotUnit(lot) || addition.unit, { density: addition.density ?? lot.density });
}

export function stockBalance(state, materialLotId, unit) {
  const normalized = normalizeState(state); const { lot } = findLot(normalized, materialLotId); const targetUnit = unit || lotUnit(lot) || normalized.stockMovements.find(item => item.materialLotId === materialLotId)?.unit; if (!targetUnit) throw new Error(`Lot "${materialLotId}" has no known stock unit.`); validateUnit(targetUnit); let balance = 0;
  for (const movement of normalized.stockMovements.filter(item => item.materialLotId === materialLotId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.id).localeCompare(String(b.id)))) { const amount = convertQuantity(movement.quantity, movement.unit, targetUnit, { density: movement.density ?? lot.density }); let direction = movementDirection(movement); if (movement.movementType === 'reversal') { const original = normalized.stockMovements.find(item => item.id === movement.referenceMovementId); direction = -movementDirection(original); } balance = roundStock(balance + direction * amount); }
  return roundStock(balance);
}

export function stockBalances(state, materialLotId) { const normalized = normalizeState(state); const { lot } = findLot(normalized, materialLotId); const unit = lotUnit(lot) || normalized.stockMovements.find(item => item.materialLotId === materialLotId)?.unit; if (!unit) return { unit: null, balance: null }; return { unit, balance: stockBalance(normalized, materialLotId, unit) }; }

// A lot's opening is either established (a received amount or an explicit
// opening movement) or unreconciled. In the unreconciled case the replayed
// balance is only a floor — the sum of known consumption — and must never be
// presented as a measured stock figure.
export function stockStatus(state, materialLotId) {
  const normalized = normalizeState(state); const { lot } = findLot(normalized, materialLotId); const unit = lotUnit(lot) || normalized.stockMovements.find(item => item.materialLotId === materialLotId)?.unit || null; const established = hasOpeningEstablished(normalized, materialLotId); const balance = unit ? stockBalance(normalized, materialLotId, unit) : null;
  return { materialLotId, unit, established, balance, reconciled: established, balanceKnown: established && unit !== null, note: established ? 'Opening balance established.' : 'Opening balance unknown; balance is a floor of recorded consumption only.' };
}

export function lotMovementHistory(state, materialLotId) {
  const normalized = normalizeState(state); findLot(normalized, materialLotId);
  return normalized.stockMovements.filter(item => item.materialLotId === materialLotId).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)) || String(a.id).localeCompare(String(b.id))).map(item => ({ ...item }));
}

export function inventorySummary(state, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const normalized = normalizeState(state);
  const lots = normalized.materials.flatMap(material => (material.lots || []).map(lot => {
    const status = stockStatus(normalized, lot.id);
    const warnings = [];
    if (!status.balanceKnown) warnings.push('Opening quantity unknown; reconcile physical stock.');
    if (!lot.lotCode) warnings.push('Lot code not recorded.');
    if (lot.expiryDate && lot.expiryDate < today) warnings.push('Expiry date has passed.');
    if (lot.retestDate && lot.retestDate < today) warnings.push('Retest date has passed.');
    if (status.balanceKnown && lot.lowStockThreshold !== undefined && status.balance <= lot.lowStockThreshold) warnings.push('Below low-stock threshold.');
    return { materialId: material.id, materialName: material.name, lot: { ...lot }, ...status, warnings };
  }));
  return { lots, unknownLots: lots.filter(item => !item.balanceKnown), lowStock: lots.filter(item => item.warnings.includes('Below low-stock threshold.')), dateWarnings: lots.filter(item => item.warnings.some(warning => warning.includes('date'))), recentMovements: normalized.stockMovements.slice().sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 12) };
}

function findPurchase(state, purchaseId) {
  const purchase = state.purchases.find(item => item.id === purchaseId);
  if (!purchase) throw new Error(`Purchase "${purchaseId}" was not found.`);
  return purchase;
}

function normalizePurchaseLine(input, purchaseId) {
  const quantity = positiveFinite(Number(input.quantity), 'Purchase quantity');
  const unitPrice = monetary(Number(input.unitPrice), 'Purchase unit price');
  const calculatedTotal = Math.round(quantity * unitPrice * 1e6) / 1e6;
  const lineTotal = monetary(input.lineTotal === undefined || input.lineTotal === '' ? calculatedTotal : Number(input.lineTotal), 'Purchase line total');
  if (Math.abs(lineTotal - calculatedTotal) > 0.000001) throw new Error('Purchase line total must equal quantity multiplied by unit price.');
  return { id: input.id || id('purchase-line'), purchaseId, materialId: requireText(input.materialId, 'Purchase material'), materialLotId: requireText(input.materialLotId, 'Purchase lot'), quantity, unit: requireText(input.unit, 'Purchase unit'), unitPrice, lineTotal, notes: input.notes || '' };
}

function withPurchaseLotLinks(state, lineItems, removeLineIds = new Set()) {
  const byLot = new Map();
  for (const line of lineItems) byLot.set(line.materialLotId, [...(byLot.get(line.materialLotId) || []), line.id]);
  const materials = state.materials.map(material => ({ ...material, lots: (material.lots || []).map(lot => {
    const existing = (lot.purchaseLineItemIds || []).filter(lineId => !removeLineIds.has(lineId));
    const additions = byLot.get(lot.id) || [];
    return { ...lot, purchaseLineItemIds: [...new Set([...existing, ...additions])] };
  }) }));
  return materials;
}

export function purchaseSummary(state, purchaseId) {
  const normalized = normalizeState(state); const purchase = findPurchase(normalized, purchaseId); const lineItems = normalized.purchaseLineItems.filter(item => item.purchaseId === purchase.id);
  const subtotal = lineItems.reduce((sum, line) => sum + line.lineTotal, 0); const adjustments = -(purchase.discount || 0) + (purchase.tax || 0) + (purchase.shipping || 0);
  const adjustmentsAllocatable = subtotal > 0 || Math.abs(adjustments) <= 0.000001;
  const allocations = lineItems.map(line => { const share = subtotal > 0 ? line.lineTotal / subtotal : 0; const effectiveLineTotal = line.lineTotal + adjustments * share; return { ...line, effectiveLineTotal, effectiveUnitPrice: line.quantity > 0 ? effectiveLineTotal / line.quantity : null }; });
  return { purchase: { ...purchase }, lineItems: allocations, subtotal, discount: purchase.discount || 0, tax: purchase.tax || 0, shipping: purchase.shipping || 0, total: subtotal + adjustments, adjustmentsAllocatable, receiptVerified: Boolean(purchase.receiptEvidence) };
}

export function addPurchase(state, input) {
  const normalized = normalizeState(state); const purchaseId = input.id || id('purchase'); const lineInputs = Array.isArray(input.lineItems) ? input.lineItems : [];
  if (!lineInputs.length) throw new Error('At least one purchase line item is required.');
  const lineItems = lineInputs.map(line => normalizePurchaseLine(line, purchaseId));
  const purchase = { id: purchaseId, supplier: requireText(input.supplier, 'Purchase supplier'), purchaseDate: timestamp(requireText(input.purchaseDate, 'Purchase date'), 'Purchase date'), receiptNumber: input.receiptNumber || '', currency: currencyCode(input.currency), receiptEvidence: normalizeReceiptEvidence(input.receiptEvidence), discount: monetary(input.discount === undefined || input.discount === '' ? 0 : Number(input.discount), 'Purchase discount'), tax: monetary(input.tax === undefined || input.tax === '' ? 0 : Number(input.tax), 'Purchase tax'), shipping: monetary(input.shipping === undefined || input.shipping === '' ? 0 : Number(input.shipping), 'Purchase shipping'), notes: input.notes || '', lineItemIds: lineItems.map(line => line.id), createdAt: input.createdAt || now(), updatedAt: now() };
  const next = { ...normalized, purchases: [purchase, ...normalized.purchases], purchaseLineItems: [...lineItems, ...normalized.purchaseLineItems], materials: withPurchaseLotLinks(normalized, lineItems) };
  if (purchaseSummary(next, purchaseId).total < 0) throw new Error('Purchase total cannot be negative.');
  return validateState(next);
}

export function updatePurchase(state, purchaseId, input) {
  const normalized = normalizeState(state); const existing = findPurchase(normalized, purchaseId); const existingLineIds = new Set(existing.lineItemIds || []);
  const lineInputs = input.lineItems === undefined ? normalized.purchaseLineItems.filter(item => item.purchaseId === purchaseId) : input.lineItems;
  if (!Array.isArray(lineInputs) || !lineInputs.length) throw new Error('At least one purchase line item is required.');
  const lineItems = lineInputs.map(line => normalizePurchaseLine(line, purchaseId));
  const merged = { ...existing, ...input, id: existing.id, supplier: requireText(input.supplier ?? existing.supplier, 'Purchase supplier'), purchaseDate: timestamp(requireText(input.purchaseDate ?? existing.purchaseDate, 'Purchase date'), 'Purchase date'), currency: currencyCode(input.currency ?? existing.currency), receiptEvidence: input.receiptEvidence === undefined ? existing.receiptEvidence : normalizeReceiptEvidence(input.receiptEvidence), discount: monetary(input.discount === undefined ? existing.discount : Number(input.discount), 'Purchase discount'), tax: monetary(input.tax === undefined ? existing.tax : Number(input.tax), 'Purchase tax'), shipping: monetary(input.shipping === undefined ? existing.shipping : Number(input.shipping), 'Purchase shipping'), lineItemIds: lineItems.map(line => line.id), updatedAt: now() };
  const retainedLines = normalized.purchaseLineItems.filter(line => !existingLineIds.has(line.id));
  const next = { ...normalized, purchases: normalized.purchases.map(item => item.id === purchaseId ? merged : item), purchaseLineItems: [...lineItems, ...retainedLines], materials: withPurchaseLotLinks(normalized, lineItems, existingLineIds) };
  if (purchaseSummary(next, purchaseId).total < 0) throw new Error('Purchase total cannot be negative.');
  return validateState(next);
}

export function calculateBatchCost(state, batchId) {
  const normalized = normalizeState(state); const batch = normalized.batches.find(item => item.id === batchId); if (!batch) throw new Error(`Batch "${batchId}" was not found.`);
  const rows = []; const uncosted = []; const totalsByCurrency = {};
  for (const addition of batch.actualAdditions || []) {
    const material = findMaterial(normalized, addition.materialId); const base = { additionId: addition.id, materialId: addition.materialId, materialName: material.name, materialLotId: addition.materialLotId, quantity: addition.amount, unit: addition.unit, costable: false };
    if (!addition.materialLotId) { uncosted.push({ ...base, reason: 'missing-lot', message: 'No inventory lot was recorded for this actual addition.' }); rows.push({ ...base, reason: 'missing-lot', message: 'No inventory lot was recorded for this actual addition.' }); continue; }
    const candidates = normalized.purchaseLineItems.filter(line => line.materialLotId === addition.materialLotId && line.materialId === addition.materialId);
    let line = addition.purchaseLineItemId ? normalized.purchaseLineItems.find(item => item.id === addition.purchaseLineItemId) : candidates.length === 1 ? candidates[0] : null;
    if (addition.purchaseLineItemId && (!line || line.materialLotId !== addition.materialLotId || line.materialId !== addition.materialId)) line = null;
    if (!line) { const reason = addition.purchaseLineItemId ? 'invalid-purchase-link' : candidates.length ? 'ambiguous-purchase-source' : 'missing-purchase-price'; const message = addition.purchaseLineItemId ? 'The selected purchase line does not match this addition.' : candidates.length ? 'Multiple purchase lines exist for this lot; select the exact receipt on the actual addition.' : 'No purchase line is linked to this lot.'; const row = { ...base, reason, message }; uncosted.push(row); rows.push(row); continue; }
    const purchase = normalized.purchases.find(item => item.id === line.purchaseId); const summary = purchaseSummary(normalized, purchase.id); const summaryLine = summary.lineItems.find(item => item.id === line.id);
    if (!purchase.receiptEvidence) { const row = { ...base, purchaseLineItemId: line.id, purchaseId: purchase.id, receiptNumber: purchase.receiptNumber, reason: 'missing-receipt-evidence', message: 'Purchase price is recorded but has no receipt evidence; it is not receipt-verified.' }; uncosted.push(row); rows.push(row); continue; }
    if (!summary.adjustmentsAllocatable) { const row = { ...base, purchaseLineItemId: line.id, purchaseId: purchase.id, reason: 'unallocatable-purchase-adjustment', message: 'Purchase-level discount, tax, or shipping cannot be allocated because the receipt subtotal is zero.' }; uncosted.push(row); rows.push(row); continue; }
    let quantityInPurchaseUnit;
    try { quantityInPurchaseUnit = convertQuantity(addition.amount, addition.unit, line.unit, { density: lotOf(normalized, addition.materialLotId).density }); } catch { const row = { ...base, purchaseLineItemId: line.id, purchaseId: purchase.id, reason: 'incompatible-unit', message: `Cannot convert ${addition.unit} to the purchase unit ${line.unit} without compatible units or density.` }; uncosted.push(row); rows.push(row); continue; }
    const cost = quantityInPurchaseUnit * summaryLine.effectiveUnitPrice; const row = { ...base, purchaseLineItemId: line.id, purchaseId: purchase.id, receiptNumber: purchase.receiptNumber, receiptReference: purchase.receiptEvidence.reference, currency: purchase.currency, quantityInPurchaseUnit, purchaseUnit: line.unit, unitCost: summaryLine.effectiveUnitPrice, attributableCost: cost, costable: true };
    rows.push(row); totalsByCurrency[purchase.currency] = (totalsByCurrency[purchase.currency] || 0) + cost;
  }
  const currencies = Object.keys(totalsByCurrency); return { batchId: batch.id, rows, costable: rows.filter(row => row.costable), uncosted, complete: uncosted.length === 0, totalsByCurrency, total: currencies.length === 1 && uncosted.length === 0 ? totalsByCurrency[currencies[0]] : null, currencies };
}

function findBlindSession(state, sessionId) {
  const session = state.blindSessions.find(item => item.id === sessionId);
  if (!session) throw new Error(`Blind session "${sessionId}" was not found.`);
  return session;
}

function randomValue(random) {
  const value = random();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) throw new Error('Random source must return values in [0, 1).');
  return value;
}

export function shuffleBlindSamples(samples, random = Math.random) {
  if (!Array.isArray(samples)) throw new Error('Blind samples must be an array.');
  const result = samples.slice();
  for (let index = result.length - 1; index > 0; index -= 1) { const swapIndex = Math.floor(randomValue(random) * (index + 1)); [result[index], result[swapIndex]] = [result[swapIndex], result[index]]; }
  return result;
}

function blindCode(random, used) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = 'BT-'; for (let index = 0; index < 6; index += 1) code += alphabet[Math.floor(randomValue(random) * alphabet.length)];
    if (!used.has(code)) return code;
  }
  let suffix = used.size + 1; let fallback = `BT-${String(suffix).padStart(6, '0')}`; while (used.has(fallback)) fallback = `BT-${String(++suffix).padStart(6, '0')}`; return fallback;
}

export function createBlindSession(state, input) {
  const normalized = normalizeState(state); const candidates = Array.isArray(input.batchIds) ? input.batchIds : Array.isArray(input.candidates) ? input.candidates.map(item => item.batchId || item.id) : [];
  if (candidates.length < 2 || new Set(candidates).size !== candidates.length) throw new Error('A blind session needs at least two unique physical batches.');
  const sessionId = input.id || id('blind-session');
  const samples = candidates.map(batchId => { const batch = normalized.batches.find(item => item.id === batchId); if (!batch) throw new Error(`Blind session references an unknown batch ${batchId}.`); const experiment = normalized.experiments.find(item => item.id === batch.experimentId); const revision = normalized.revisions.find(item => item.id === batch.formulaRevisionId); if (!experiment || !revision || revision.experimentId !== experiment.id) throw new Error(`Batch ${batchId} has an invalid experiment or formula revision link.`); return { id: id('blind-sample'), sessionId, batchId: batch.id, experimentId: experiment.id, revisionId: revision.id }; });
  const session = { id: sessionId, name: requireText(input.name, 'Blind session name'), purpose: requireText(input.purpose, 'Blind session purpose'), sessionDate: timestamp(requireText(input.sessionDate, 'Blind session date'), 'Blind session date'), protocol: input.protocol || '', evaluatorLabel: input.evaluatorLabel || '', conditions: input.conditions || '', notes: input.notes || '', status: 'draft', sampleIds: samples.map(sample => sample.id), createdAt: now(), updatedAt: now() };
  return validateState({ ...normalized, blindSessions: [session, ...normalized.blindSessions], blindSamples: [...samples, ...normalized.blindSamples] });
}

export function randomizeBlindSession(state, sessionId, random = Math.random) {
  const normalized = normalizeState(state); const session = findBlindSession(normalized, sessionId); if (session.status !== 'draft') throw new Error('Only a draft blind session can be randomized.');
  const samples = session.sampleIds.map(sampleId => normalized.blindSamples.find(item => item.id === sampleId)); const order = shuffleBlindSamples(samples, random); const used = new Set(); const randomizedAt = now();
  const updatedSamples = normalized.blindSamples.map(sample => { const position = order.findIndex(item => item.id === sample.id); if (position < 0) return sample; const code = blindCode(random, used); used.add(code); return { ...sample, position: position + 1, blindCode: code, randomizedAt }; });
  const updatedSession = { ...session, status: 'randomized', randomizedAt, updatedAt: now() };
  return validateState({ ...normalized, blindSessions: normalized.blindSessions.map(item => item.id === sessionId ? updatedSession : item), blindSamples: updatedSamples });
}

export function startBlindSession(state, sessionId) {
  const normalized = normalizeState(state); const session = findBlindSession(normalized, sessionId); if (!['randomized', 'in-progress'].includes(session.status)) throw new Error('A session must be randomized before evaluator entry begins.');
  return validateState({ ...normalized, blindSessions: normalized.blindSessions.map(item => item.id === sessionId ? { ...item, status: 'in-progress', updatedAt: now() } : item) });
}

export function recordBlindObservation(state, sessionId, sampleId, input) {
  const normalized = normalizeState(state); const session = findBlindSession(normalized, sessionId); const sample = normalized.blindSamples.find(item => item.id === sampleId);
  if (!sample || sample.sessionId !== sessionId) throw new Error('Blind sample does not belong to this session.');
  if (!['randomized', 'in-progress'].includes(session.status)) throw new Error('Blind observations cannot be changed after the session is locked.');
  const next = recordSensoryEvaluation(normalized, sample.experimentId, { ...input, id: input.id || id('blind-evaluation'), batchId: sample.batchId, revisionId: sample.revisionId, evaluatedAt: input.evaluatedAt || now() });
  const evaluationId = input.id || next.evaluations[0]?.id;
  const evaluations = next.evaluations.map(item => item.id === evaluationId ? { ...item, blindSessionId: sessionId, blindSampleId: sampleId, blindCode: sample.blindCode } : item);
  const nextSession = session.status === 'randomized' ? { ...session, status: 'in-progress', updatedAt: now() } : session;
  return validateState({ ...next, evaluations, blindSessions: next.blindSessions.map(item => item.id === sessionId ? nextSession : item) });
}

export function lockBlindSession(state, sessionId) {
  const normalized = normalizeState(state); const session = findBlindSession(normalized, sessionId); if (!['randomized', 'in-progress'].includes(session.status)) throw new Error('Only an in-progress blind session can be locked.');
  const incomplete = session.sampleIds.map(sampleId => normalized.blindSamples.find(item => item.id === sampleId)).filter(sample => !normalized.evaluations.some(item => item.blindSessionId === sessionId && item.blindSampleId === sample.id));
  if (incomplete.length) throw new Error(`Cannot lock session; incomplete samples: ${incomplete.map(sample => sample.blindCode).join(', ')}.`);
  const lockedAt = now(); const evaluations = normalized.evaluations.map(item => item.blindSessionId === sessionId ? { ...item, blindLockedAt: lockedAt } : item);
  return validateState({ ...normalized, evaluations, blindSessions: normalized.blindSessions.map(item => item.id === sessionId ? { ...item, status: 'locked', lockedAt, updatedAt: now() } : item) });
}

export function unblindSession(state, sessionId) {
  const normalized = normalizeState(state); const session = findBlindSession(normalized, sessionId); if (session.status !== 'locked') throw new Error('Only a locked blind session can be unblinded.');
  return validateState({ ...normalized, blindSessions: normalized.blindSessions.map(item => item.id === sessionId ? { ...item, status: 'unblinded', unblindedAt: now(), updatedAt: now() } : item) });
}

function findEquipment(state, equipmentId) {
  const equipment = state.equipment.find(item => item.id === equipmentId);
  if (!equipment) throw new Error(`Equipment "${equipmentId}" was not found.`);
  return equipment;
}

export function addEquipment(state, input) {
  const normalized = normalizeState(state);
  const equipment = {
    id: input.id || id('equipment'), name: requireText(input.name, 'Equipment name'), equipmentType: input.equipmentType || 'other',
    manufacturer: input.manufacturer || '', model: input.model || '', serialNumber: input.serialNumber || '', location: input.location || '',
    status: input.status || 'available', acquiredAt: input.acquiredAt || undefined, resolution: optionalFinite(input.resolution, 'Equipment resolution'),
    resolutionUnit: input.resolutionUnit ? measurementUnit(input.resolutionUnit, 'Equipment resolution unit') : undefined,
    notes: input.notes || '', createdAt: input.createdAt || now(), updatedAt: now()
  };
  if (!equipmentTypes.includes(equipment.equipmentType)) throw new Error(`Unsupported equipment type "${equipment.equipmentType}".`);
  if (!equipmentStatuses.includes(equipment.status)) throw new Error(`Unsupported equipment status "${equipment.status}".`);
  timestamp(equipment.createdAt, 'Equipment createdAt');
  if (normalized.equipment.some(item => item.id === equipment.id)) throw new Error(`Equipment ${equipment.id} already exists.`);
  return validateState({ ...normalized, equipment: [equipment, ...normalized.equipment] });
}

export function updateEquipment(state, equipmentId, input) {
  const normalized = normalizeState(state); findEquipment(normalized, equipmentId);
  const nextEquipment = normalized.equipment.map(item => item.id === equipmentId ? {
    ...item, ...input, id: item.id, createdAt: item.createdAt, updatedAt: now(),
    name: requireText(input.name ?? item.name, 'Equipment name'),
    equipmentType: input.equipmentType ?? item.equipmentType, status: input.status ?? item.status,
    resolution: optionalFinite(input.resolution ?? item.resolution, 'Equipment resolution'),
    resolutionUnit: input.resolutionUnit ?? item.resolutionUnit
  } : item);
  return validateState({ ...normalized, equipment: nextEquipment });
}

export function addVerificationEvent(state, equipmentId, input) {
  const normalized = normalizeState(state); const equipment = findEquipment(normalized, equipmentId);
  const event = {
    id: input.id || id('verification'), equipmentId: equipment.id, performedAt: timestamp(input.performedAt, 'Verification date'),
    method: input.method || '', outcome: input.outcome || 'pass', performedBy: input.performedBy || '', notes: input.notes || '',
    nextDueAt: input.nextDueAt || undefined, referenceMeasurementId: input.referenceMeasurementId || undefined, createdAt: now()
  };
  if (normalized.verificationEvents.some(item => item.id === event.id)) throw new Error(`Verification event ${event.id} already exists.`);
  const nextEquipment = normalized.equipment.map(item => item.id === equipment.id ? { ...item, lastVerifiedAt: event.performedAt, updatedAt: now() } : item);
  return validateState({ ...normalized, equipment: nextEquipment, verificationEvents: [event, ...normalized.verificationEvents] });
}

export function addMaintenanceEvent(state, equipmentId, input) {
  const normalized = normalizeState(state); const equipment = findEquipment(normalized, equipmentId);
  const event = {
    id: input.id || id('maintenance'), equipmentId: equipment.id, eventType: input.eventType || 'maintenance', occurredAt: timestamp(input.occurredAt, 'Maintenance date'),
    completedAt: input.completedAt || undefined, performedBy: input.performedBy || '', notes: requireText(input.notes, 'Maintenance notes'), cost: optionalFinite(input.cost, 'Maintenance cost'), createdAt: now()
  };
  if (normalized.maintenanceEvents.some(item => item.id === event.id)) throw new Error(`Maintenance event ${event.id} already exists.`);
  const status = input.statusAfter || (event.eventType === 'fault' ? 'out-of-service' : equipment.status);
  const nextEquipment = normalized.equipment.map(item => item.id === equipment.id ? { ...item, status, updatedAt: now() } : item);
  return validateState({ ...normalized, equipment: nextEquipment, maintenanceEvents: [event, ...normalized.maintenanceEvents] });
}

export function addMeasurement(state, equipmentId, input) {
  const normalized = normalizeState(state); const equipment = findEquipment(normalized, equipmentId);
  const measurement = {
    id: input.id || id('measurement'), equipmentId: equipment.id, quantityType: requireText(input.quantityType, 'Measurement quantity type'),
    value: Number(input.value), unit: measurementUnit(input.unit), measuredAt: timestamp(input.measuredAt, 'Measurement date'),
    resolution: optionalFinite(input.resolution, 'Measurement resolution'), method: input.method || '', conditions: input.conditions || '', notes: input.notes || '',
    batchId: input.batchId || undefined, experimentId: input.experimentId || undefined, journalEntryId: input.journalEntryId || undefined, evaluationId: input.evaluationId || undefined,
    provenance: input.provenance || 'recorded', createdAt: now()
  };
  if (normalized.measurements.some(item => item.id === measurement.id)) throw new Error(`Measurement ${measurement.id} already exists.`);
  return validateState({ ...normalized, measurements: [measurement, ...normalized.measurements] });
}

export function equipmentVerificationSummary(state, equipmentId, { asOf = new Date().toISOString() } = {}) {
  const normalized = normalizeState(state); findEquipment(normalized, equipmentId);
  const events = normalized.verificationEvents.filter(item => item.equipmentId === equipmentId).sort((a, b) => String(b.performedAt).localeCompare(String(a.performedAt)) || b.id.localeCompare(a.id));
  const latest = events[0];
  if (!latest) return { status: 'unknown', latest: null, events };
  if (latest.outcome === 'fail') return { status: 'failed', latest, events };
  if (latest.nextDueAt && Date.parse(latest.nextDueAt) < Date.parse(asOf)) return { status: 'overdue', latest, events };
  return { status: latest.outcome === 'conditional' ? 'conditional' : 'verified', latest, events };
}

export function equipmentSummary(state, { asOf = new Date().toISOString() } = {}) {
  const normalized = normalizeState(state);
  return normalized.equipment.map(equipment => {
    const verification = equipmentVerificationSummary(normalized, equipment.id, { asOf });
    const maintenance = normalized.maintenanceEvents.filter(item => item.equipmentId === equipment.id).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));
    const measurements = normalized.measurements.filter(item => item.equipmentId === equipment.id).sort((a, b) => String(b.measuredAt).localeCompare(String(a.measuredAt)));
    const warnings = [];
    if (verification.status === 'unknown') warnings.push('Verification status unknown; no recorded verification evidence.');
    if (verification.status === 'overdue') warnings.push('Verification is overdue.');
    if (verification.status === 'failed') warnings.push('Latest verification failed.');
    if (verification.status === 'conditional') warnings.push('Latest verification was conditional.');
    if (equipment.status === 'under-maintenance') warnings.push('Equipment is under maintenance.');
    if (equipment.status === 'out-of-service') warnings.push('Equipment is out of service.');
    if (equipment.status === 'retired') warnings.push('Equipment is retired.');
    return { equipment: { ...equipment }, verification, maintenance, measurements, warnings };
  });
}

export function reconcileLot(state, materialLotId, { physicalQuantity, unit, reason, occurredAt, density } = {}) {
  const normalized = normalizeState(state); const { lot } = findLot(normalized, materialLotId); const status = stockStatus(normalized, materialLotId);
  nonNegativeFinite(physicalQuantity, 'Physical count');
  const targetUnit = unit || lotUnit(lot); validateUnit(targetUnit);
  const recorded = status.balanceKnown ? stockBalance(normalized, materialLotId, targetUnit) : undefined;
  if (recorded === undefined) throw new Error('Reconcile the opening balance before comparing a physical count.');
  const variance = roundStock(physicalQuantity - recorded);
  if (Math.abs(variance) <= STOCK_PRECISION) throw new Error('Physical count matches recorded on-hand; no adjustment is required.');
  if (!String(reason || '').trim()) throw new Error('A reconciliation reason is required.');
  return { variance, state: addStockMovement(normalized, { materialId: lot.materialId, materialLotId, movementType: 'adjustment', direction: variance > 0 ? 'increase' : 'decrease', quantity: Math.abs(variance), unit: targetUnit, density, verified: true, occurredAt, note: reason }) };
}

export function addMaterial(state, input) {
  const normalized = normalizeState(state); const material = { id: input.id || id('material'), name: requireText(input.name, 'Material name'), canonicalIdentity: input.canonicalIdentity || '', supplier: input.supplier || '', productReference: input.productReference || '', safetyReference: input.safetyReference || '', storageNotes: input.storageNotes || '', lots: [] };
  if (normalized.materials.some(item => item.id === material.id || (item.canonicalIdentity && material.canonicalIdentity && item.canonicalIdentity === material.canonicalIdentity && item.name === material.name))) throw new Error('A material with this identity already exists.');
  return validateState({ ...normalized, materials: [material, ...normalized.materials] });
}

export function addMaterialLot(state, materialId, input) {
  const normalized = normalizeState(state); const material = findMaterial(normalized, materialId); const lot = { id: input.id || id('lot'), materialId, lotCode: input.lotCode || '', receivedAt: input.receivedAt || input.acquiredAt, receivedAmount: input.receivedAmount, receivedUnit: input.receivedUnit, supplier: input.supplier || '', productReference: input.productReference || '', concentration: input.concentration, stockConcentration: input.stockConcentration, purity: input.purity, density: input.density, expiryDate: input.expiryDate, retestDate: input.retestDate, lowStockThreshold: input.lowStockThreshold, notes: input.notes || '', reconciliation: input.receivedAmount === undefined ? 'unreconciled' : 'established' };
  if (lot.receivedAmount !== undefined && !lot.receivedUnit) throw new Error('A received quantity requires its unit.');
  if (material.lots.some(item => lot.lotCode && item.lotCode === lot.lotCode)) throw new Error(`Lot code "${lot.lotCode}" is already used for this material.`);
  const next = validateState({ ...normalized, materials: normalized.materials.map(item => item.id === materialId ? { ...item, lots: [lot, ...item.lots] } : item) });
  if (lot.receivedAmount === undefined) return next;
  return addStockMovement(next, { id: `movement-${lot.id}`, materialId, materialLotId: lot.id, movementType: 'opening', quantity: lot.receivedAmount, unit: lot.receivedUnit, density: lot.density, occurredAt: lot.receivedAt || now(), note: 'Opening balance recorded with lot.', provenance: 'recorded' });
}

// Record the opening balance for a lot whose stock is still unreconciled. This
// is the only sanctioned way out of the unreconciled state: the amount comes
// from the user's own measurement, never derived from consumption history.
export function reconcileLotOpening(state, materialLotId, { quantity, unit, density, occurredAt, note } = {}) {
  const normalized = normalizeState(state); const { lot } = findLot(normalized, materialLotId);
  if (hasOpeningEstablished(normalized, materialLotId)) throw new Error(`Lot "${materialLotId}" already has an established opening balance.`);
  return addStockMovement(normalized, { id: `movement-opening-${materialLotId}`, materialId: lot.materialId, materialLotId, movementType: 'opening', quantity, unit: unit || lotUnit(lot), density: density ?? lot.density, occurredAt: occurredAt || lot.receivedAt || now(), note: note || 'Opening balance recorded during reconciliation.' });
}

export function addStockMovement(state, input) {
  const normalized = normalizeState(state); const movement = normalizeMovement(normalized, { ...input, id: input.id || id('movement') }, { allowGeneratedId: true });
  if (normalized.stockMovements.some(item => item.id === movement.id)) throw new Error(`Stock movement ${movement.id} already exists.`);
  const next = { ...normalized, stockMovements: [...normalized.stockMovements, movement] };
  const balanceUnit = lotUnit(findLot(next, movement.materialLotId).lot) || movement.unit;
  if (stockBalance(next, movement.materialLotId, balanceUnit) < -1e-9) throw new Error('Insufficient stock for this movement.');
  return validateState(next);
}

export function reverseStockMovement(state, movementId, note = '') {
  const normalized = normalizeState(state); const original = normalized.stockMovements.find(item => item.id === movementId); if (!original) throw new Error('Stock movement to reverse was not found.');
  const inverseDirection = movementDirection(original) > 0 ? 'decrease' : 'increase';
  return addStockMovement(normalized, { materialId: original.materialId, materialLotId: original.materialLotId, movementType: 'reversal', quantity: original.quantity, unit: original.unit, density: original.density, direction: inverseDirection, referenceMovementId: original.id, note: note || `Reversal of ${original.id}` });
}

export function addJournalEntry(state, input) {
  const normalized = normalizeState(state); const entry = { id: id('journal'), observedAt: now(), tags: [], descriptors: [], attachmentRefs: [], provenance: 'recorded', ...input };
  if (entry.experimentId) { const experiment = normalized.experiments.find(item => item.id === entry.experimentId); if (!experiment) throw new Error('Journal entry experiment was not found.'); }
  const next = { ...normalized, journalEntries: [entry, ...normalized.journalEntries] };
  if (entry.experimentId) next.experiments = normalized.experiments.map(item => item.id === entry.experimentId ? { ...item, journalEntryIds: [...new Set([...(item.journalEntryIds || []), entry.id])] } : item);
  return validateState(next);
}

export function updateJournalEntry(state, entryId, input) {
  const normalized = normalizeState(state); const existing = normalized.journalEntries.find(item => item.id === entryId); if (!existing) throw new Error('Journal entry not found.');
  if (input.experimentId) { const experiment = normalized.experiments.find(item => item.id === input.experimentId); if (!experiment) throw new Error('Journal entry experiment was not found.'); }
  const updated = { ...existing, ...input, id: existing.id };
  const experiments = normalized.experiments.map(experiment => {
    const ids = new Set(experiment.journalEntryIds || []);
    if (experiment.id === existing.experimentId) ids.delete(entryId);
    if (experiment.id === updated.experimentId) ids.add(entryId);
    return { ...experiment, journalEntryIds: [...ids] };
  });
  return validateState({ ...normalized, journalEntries: normalized.journalEntries.map(item => item.id === entryId ? updated : item), experiments });
}

export function addExperiment(state, input) {
  const normalized = normalizeState(state); const experimentId = input.experimentId || `EXP-${String(normalized.experiments.length + 1).padStart(3, '0')}`; if (normalized.experiments.some(item => item.experimentId === experimentId)) throw new Error(`Experiment identifier "${experimentId}" already exists.`); if (input.status && !statuses.includes(input.status)) throw new Error('Invalid experiment status.');
  const experiment = { id: id('experiment'), experimentId, title: requireText(input.title, 'Experiment title'), objective: input.objective || '', createdAt: now(), status: input.status || 'Draft', formulaRevisionIds: [], journalEntryIds: [], batchIds: [], evaluationIds: [], tags: input.tags || [] };
  return validateState({ ...normalized, experiments: [experiment, ...normalized.experiments] });
}

export function addRevision(state, experimentId, input) {
  const normalized = normalizeState(state); const experiment = normalized.experiments.find(item => item.id === experimentId); if (!experiment) throw new Error('Experiment not found.'); if (input.experimentId && input.experimentId !== experimentId) throw new Error('Revision experimentId does not match the target experiment.');
  const previousId = experiment.formulaRevisionIds.at(-1) ?? null; if (input.supersedesRevisionId && input.supersedesRevisionId !== previousId) throw new Error('A new revision must supersede the current latest revision.');
  const ingredients = (input.ingredients || []).map(item => ({ ...item }));
  for (const ingredient of ingredients) { if (!ingredient.materialId) throw new Error('Every formula ingredient needs materialId.'); findMaterial(normalized, ingredient.materialId); if (ingredient.lotId) { const { material } = findLot(normalized, ingredient.lotId); if (material.id !== ingredient.materialId) throw new Error('Formula ingredient material and lot do not match.'); } positiveFinite(ingredient.quantity, 'Formula ingredient quantity'); validateUnit(ingredient.unit); }
  const revision = { id: id('revision'), experimentId, revision: experiment.formulaRevisionIds.length + 1, createdAt: now(), supersedesRevisionId: previousId, ingredients, notes: input.notes || '', objective: input.objective || '' };
  return validateState({ ...normalized, revisions: [revision, ...normalized.revisions], experiments: normalized.experiments.map(item => item.id === experimentId ? { ...item, formulaRevisionIds: [...item.formulaRevisionIds, revision.id] } : item) });
}

export function addBatch(state, experimentId, input) {
  const normalized = normalizeState(state); const experiment = normalized.experiments.find(item => item.id === experimentId); if (!experiment) throw new Error('Experiment not found.'); if (input.experimentId && input.experimentId !== experimentId) throw new Error('Batch experimentId cannot override the target experiment.');
  if (input.idempotencyKey) { const existing = normalized.batches.find(item => item.idempotencyKey === input.idempotencyKey); if (existing) return normalized; }
  const revision = normalized.revisions.find(item => item.id === input.formulaRevisionId); if (!revision || revision.experimentId !== experimentId || !experiment.formulaRevisionIds.includes(revision.id)) throw new Error('Batch must reference a revision belonging to its experiment.');
  const actualAdditions = (input.actualAdditions || []).map(item => ({ ...item, id: item.id || id('addition'), addedAt: item.addedAt || now() })); if (!actualAdditions.length) throw new Error('At least one actual addition is required.');
  const batchId = input.id || id('batch');
  const additionIds = new Set(normalized.batches.flatMap(batch => batch.actualAdditions || []).map(item => item.id)); const movementIds = new Set(normalized.stockMovements.map(item => item.id)); const movements = [];
  for (const addition of actualAdditions) { if (additionIds.has(addition.id)) throw new Error(`Batch addition ${addition.id} already exists.`); validateAddition(normalized, addition); const movementId = `movement-${addition.id}`; if (movementIds.has(movementId)) throw new Error(`Stock consumption for addition ${addition.id} already exists.`); const movement = normalizeMovement(normalized, { id: movementId, materialId: addition.materialId, materialLotId: addition.materialLotId, movementType: 'consumption', quantity: addition.amount, unit: addition.unit, density: addition.density, occurredAt: addition.addedAt, batchId, additionId: addition.id, note: `Consumption for batch ${input.batchCode || 'new batch'}` }, { allowGeneratedId: true }); movements.push(movement); addition.stockMovementId = movement.id; }
  const batchCode = input.batchCode || `BATCH-${String(normalized.batches.length + 1).padStart(3, '0')}`;
  if (normalized.batches.some(item => item.batchCode === batchCode)) throw new Error(`Batch identifier "${batchCode}" already exists.`);
  const batch = { id: batchId, idempotencyKey: input.idempotencyKey, batchCode, experimentId, formulaRevisionId: revision.id, plannedAmount: positiveFinite(input.plannedAmount, 'Planned amount'), unit: requireText(input.unit, 'Batch unit'), mixingDate: input.mixingDate || now(), actualAdditions, procedureNotes: input.procedureNotes || '', observations: input.observations || '', deviations: input.deviations || '', maturationSchedule: input.maturationSchedule || '', result: input.result || '', createdAt: now() };
  validateUnit(batch.unit); const next = { ...normalized, batches: [batch, ...normalized.batches], stockMovements: [...normalized.stockMovements, ...movements], experiments: normalized.experiments.map(item => item.id === experimentId ? { ...item, batchIds: [...item.batchIds, batch.id], status: item.status === 'Draft' ? 'Mixed' : item.status } : item) };
  for (const movement of movements) if (stockBalance(next, movement.materialLotId, lotUnit(findLot(next, movement.materialLotId).lot) || movement.unit) < -1e-9) throw new Error('Insufficient stock for one or more batch additions.');
  return validateState(next);
}

export function addEvaluation(state, experimentId, input) {
  const normalized = normalizeState(state); const experiment = normalized.experiments.find(item => item.id === experimentId); if (!experiment) throw new Error('Experiment not found.'); if (input.experimentId && input.experimentId !== experimentId) throw new Error('Evaluation experimentId cannot override the target experiment.');
  const batch = input.batchId ? normalized.batches.find(item => item.id === input.batchId) : null; if (input.batchId && (!batch || batch.experimentId !== experimentId)) throw new Error('Evaluation batch does not belong to the experiment.'); const revisionId = input.revisionId || batch?.formulaRevisionId; if (revisionId) { const revision = normalized.revisions.find(item => item.id === revisionId); if (!revision || revision.experimentId !== experimentId) throw new Error('Evaluation revision does not belong to the experiment.'); if (batch && batch.formulaRevisionId !== revisionId) throw new Error('Evaluation revision does not match the batch revision.'); }
  const evaluation = { id: id('evaluation'), experimentId, batchId: input.batchId, revisionId, evaluatedAt: input.evaluatedAt || now(), descriptors: [], scores: {}, isMeasured: false, provenance: 'recorded', ...input, id: id('evaluation'), experimentId, revisionId };
  const next = { ...normalized, evaluations: [evaluation, ...normalized.evaluations], experiments: normalized.experiments.map(item => item.id === experimentId ? { ...item, evaluationIds: [...new Set([...item.evaluationIds, evaluation.id])], status: 'Evaluated' } : item) };
  return validateState(next);
}

export function deleteMaterial(state, materialId) {
  const normalized = normalizeState(state); findMaterial(normalized, materialId);
  if (normalized.stockMovements.some(item => item.materialId === materialId) || normalized.revisions.some(revision => (revision.ingredients || []).some(item => item.materialId === materialId)) || normalized.batches.some(batch => (batch.actualAdditions || []).some(item => item.materialId === materialId)) || normalized.purchaseLineItems.some(item => item.materialId === materialId)) throw new Error('Referenced materials cannot be deleted; preserve their history instead.');
  return validateState({ ...normalized, materials: normalized.materials.filter(item => item.id !== materialId) });
}

export function deleteLot(state, lotId) {
  const normalized = normalizeState(state); const { material } = findLot(normalized, lotId);
  if (normalized.stockMovements.some(item => item.materialLotId === lotId) || normalized.revisions.some(revision => (revision.ingredients || []).some(item => item.lotId === lotId)) || normalized.batches.some(batch => (batch.actualAdditions || []).some(item => item.materialLotId === lotId)) || normalized.purchaseLineItems.some(item => item.materialLotId === lotId)) throw new Error('Referenced lots cannot be deleted; preserve their history instead.');
  return validateState({ ...normalized, materials: normalized.materials.map(item => item.id === material.id ? { ...item, lots: item.lots.filter(lot => lot.id !== lotId) } : item) });
}

function plannedIngredientKey(ingredient) { return ingredient.lotId ? `${ingredient.materialId}::${ingredient.lotId}` : `${ingredient.materialId}::*`; }

function convertForBatch(state, amount, unit, targetUnit, lotId, density) {
  const lotDensity = lotId ? lotOf(state, lotId).density : undefined;
  return convertQuantity(amount, unit, targetUnit, { density: density ?? lotDensity });
}

export function recordSensoryEvaluation(state, experimentId, input) {
  const normalized = normalizeState(state); const experiment = normalized.experiments.find(item => item.id === experimentId); if (!experiment) throw new Error('Experiment not found.');
  if (!input.batchId) throw new Error('A physical batch is required for a sensory evaluation.');
  const batch = normalized.batches.find(item => item.id === input.batchId); if (!batch || batch.experimentId !== experimentId) throw new Error('Evaluation batch does not belong to the experiment.');
  const revisionId = input.revisionId || batch.formulaRevisionId; if (revisionId !== batch.formulaRevisionId) throw new Error('Evaluation revision must match the physical batch revision.');
  const measured = input.isMeasured === true || Boolean(String(input.measuredResults || '').trim());
  const provenance = input.provenance || (measured ? 'measured' : 'subjective');
  const evaluation = { id: input.id || id('evaluation'), experimentId, batchId: batch.id, revisionId, evaluatedAt: input.evaluatedAt || now(), intervalLabel: input.intervalLabel || 'Unlabelled interval', elapsedMinutes: input.elapsedMinutes, medium: input.medium || '', environment: input.environment || '', conditions: input.conditions || '', descriptors: Array.isArray(input.descriptors) ? input.descriptors : [], subjectiveNotes: input.subjectiveNotes || '', measuredResults: input.measuredResults || '', isMeasured: measured, longevityObservation: input.longevityObservation || '', longevityMethod: input.longevityMethod || '', projectionObservation: input.projectionObservation || '', projectionMethod: input.projectionMethod || '', predictedOutcome: input.predictedOutcome || '', conclusions: input.conclusions || '', nextSteps: input.nextSteps || '', aiSuggestions: Array.isArray(input.aiSuggestions) ? input.aiSuggestions : [], scores: input.scores || {}, provenance };
  const next = { ...normalized, evaluations: [evaluation, ...normalized.evaluations], experiments: normalized.experiments.map(item => item.id === experimentId ? { ...item, evaluationIds: [...new Set([...(item.evaluationIds || []), evaluation.id])], status: 'Evaluated' } : item) };
  return validateState(next);
}

export function compareBatchToPlan(state, batchId) {
  const normalized = normalizeState(state); const batch = typeof batchId === 'string' ? normalized.batches.find(item => item.id === batchId) : batchId; if (!batch) throw new Error('Batch was not found.');
  const revision = normalized.revisions.find(item => item.id === batch.formulaRevisionId); if (!revision) throw new Error(`Batch ${batch.id} references an invalid formula revision.`);
  const planned = (revision.ingredients || []).map((ingredient, index) => ({ key: plannedIngredientKey(ingredient), index, materialId: ingredient.materialId, materialName: ingredient.materialName || findMaterial(normalized, ingredient.materialId).name, lotId: ingredient.lotId, amount: ingredient.quantity, unit: ingredient.unit, amountInBatchUnit: convertForBatch(normalized, ingredient.quantity, ingredient.unit, batch.unit, ingredient.lotId, ingredient.density), role: ingredient.role || '' }));
  const actual = (batch.actualAdditions || []).map(addition => ({ ...addition, amountInBatchUnit: convertForBatch(normalized, addition.amount, addition.unit, batch.unit, addition.materialLotId, addition.density) }));
  const claimedActualIds = new Set();
  const rows = planned.map(item => {
    const candidates = actual.filter(addition => !claimedActualIds.has(addition.id) && addition.materialId === item.materialId && (!item.lotId || addition.materialLotId === item.lotId));
    const selected = candidates.filter(addition => item.lotId ? true : addition.materialId === item.materialId);
    for (const addition of selected) claimedActualIds.add(addition.id);
    const actualAmount = selected.reduce((sum, addition) => sum + addition.amountInBatchUnit, 0);
    const difference = actualAmount - item.amountInBatchUnit;
    return { ...item, actualAmount, difference, actualAdditionIds: selected.map(addition => addition.id), status: selected.length === 0 ? 'missing' : Math.abs(difference) <= STOCK_PRECISION ? 'matched' : 'deviates' };
  });
  const extras = actual.filter(addition => !claimedActualIds.has(addition.id)).map(addition => ({ ...addition, materialName: findMaterial(normalized, addition.materialId).name, lotCode: lotOf(normalized, addition.materialLotId).lotCode || addition.materialLotId }));
  const plannedTotal = rows.reduce((sum, row) => sum + row.amountInBatchUnit, 0);
  const actualTotal = actual.reduce((sum, addition) => sum + addition.amountInBatchUnit, 0);
  return { batchId: batch.id, experimentId: batch.experimentId, formulaRevisionId: batch.formulaRevisionId, unit: batch.unit, plannedTotal, actualTotal, totalDifference: actualTotal - plannedTotal, rows, missingAdditions: rows.filter(row => row.status === 'missing'), quantityDeviations: rows.filter(row => row.status === 'deviates'), extraAdditions: extras };
}

export function batchSummary(batch) { const result = calculateBatchTotals(batch.actualAdditions, { unit: batch.unit }); return { ...result, variance: batch.plannedAmount === undefined ? null : result.totalAmount - batch.plannedAmount }; }
export function exportState(state) { return JSON.stringify({ ...validateState(state), exportedAt: now() }, null, 2); }

export function normalizeCompanionEntry(input, fallbackId = id('companion')) { const createdAt = input.createdAt || now(); return { id: input.id || fallbackId, materialName: input.materialName || '', evaluationType: input.evaluationType || 'neat', concentration: input.concentration || '', evaluationMethod: input.evaluationMethod || '', elapsedTime: input.elapsedTime || '', originalText: input.originalText || '', correctedText: input.correctedText ?? input.originalText ?? '', createdAt, updatedAt: input.updatedAt || createdAt, source: input.source === 'speech' ? 'speech' : 'typed', aiSuggestions: Array.isArray(input.aiSuggestions) ? input.aiSuggestions : [] }; }
export function addCompanionEntry(state, input) { return validateState({ ...normalizeState(state), companionEntries: [normalizeCompanionEntry(input), ...(state.companionEntries || [])] }); }
export function updateCompanionEntry(state, entryId, input) { return validateState({ ...normalizeState(state), companionEntries: (state.companionEntries || []).map(entry => entry.id === entryId ? normalizeCompanionEntry({ ...entry, ...input, id: entry.id, createdAt: entry.createdAt, updatedAt: now() }) : entry) }); }
export function deleteCompanionEntry(state, entryId) { return validateState({ ...normalizeState(state), companionEntries: (state.companionEntries || []).filter(entry => entry.id !== entryId) }); }

export function importLegacyCompanionEntries(state, storage = globalThis.localStorage) {
  if (!storage) return { state, imported: 0 };
  try { const legacy = JSON.parse(storage.getItem(LEGACY_COMPANION_STORAGE_KEY) || 'null'); if (!legacy || legacy.schemaVersion !== 1 || !Array.isArray(legacy.entries)) return { state, imported: 0 }; const current = state.companionEntries || []; const seenIds = new Set(current.map(entry => entry.id).filter(Boolean)); const seenFingerprints = new Set(current.map(entry => [entry.materialName, entry.originalText, entry.createdAt].join('\u0000'))); const entries = legacy.entries.map(entry => normalizeCompanionEntry(entry)).filter(entry => { const fingerprint = [entry.materialName, entry.originalText, entry.createdAt].join('\u0000'); if (seenIds.has(entry.id) || seenFingerprints.has(fingerprint)) return false; seenIds.add(entry.id); seenFingerprints.add(fingerprint); return true; }); return entries.length ? { state: validateState({ ...normalizeState(state), companionEntries: [...current, ...entries] }), imported: entries.length } : { state, imported: 0 }; } catch { return { state, imported: 0 }; }
}
