import { calculateBatchTotals, convertQuantity, validateUnit } from './calculations.mjs';

export const STORAGE_KEY = 'atelier-lab-state-v1';
export const LEGACY_COMPANION_STORAGE_KEY = 'atelier.scent-companion.v1';
export const CURRENT_SCHEMA_VERSION = 2;
export const statuses = ['Draft', 'Mixed', 'Maturing', 'Evaluated', 'Archived'];
export const movementTypes = ['opening', 'receipt', 'return', 'adjustment', 'consumption', 'wastage', 'correction', 'reversal'];
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
    if (reference.materialLotId !== materialLotId) throw new Error('A reversal must reference a movement from the same lot.');
    input = { ...input, direction: movementDirection(reference) > 0 ? 'decrease' : 'increase' };
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
    { id: 'lot-seed-1', materialId, lotCode: 'DEMO-001', acquiredAt: '2026-10-01', receivedAt: '2026-10-01', receivedAmount: 100, receivedUnit: 'g', purity: 100, stockConcentration: 100, solvent: 'None', notes: 'Synthetic sample lot.' },
    { id: 'lot-seed-2', materialId: 'material-seed-2', lotCode: 'DEMO-002', acquiredAt: '2026-10-01', receivedAt: '2026-10-01', receivedAmount: 100, receivedUnit: 'g', purity: 100, stockConcentration: 0, solvent: 'None', notes: 'Synthetic sample lot.' }
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
    calculations: [], tags: ['atmospheric', 'woody', 'fresh'], attachments: [], companionEntries: []
  };
}

const STATE_COLLECTIONS = ['journalEntries', 'experiments', 'revisions', 'materials', 'batches', 'evaluations', 'calculations', 'tags', 'attachments', 'companionEntries', 'stockMovements'];

export function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Atelier state must be a JSON object.');
  if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) throw new Error('Atelier state schema version is invalid.');
  if (input.version > CURRENT_SCHEMA_VERSION) throw new Error(`Atelier data uses unsupported schema version ${input.version}.`);
  const state = { ...clone(input), version: input.version ?? 1 };
  for (const key of STATE_COLLECTIONS) state[key] = Array.isArray(state[key]) ? state[key] : [];
  state.materials = state.materials.map(material => {
    if (!material || typeof material !== 'object') throw new Error('Material records must be JSON objects.');
    return { ...material, lots: Array.isArray(material.lots) ? material.lots.map(lot => { if (!lot || typeof lot !== 'object') throw new Error('Material lot records must be JSON objects.'); return { ...lot, materialId: lot.materialId || material.id }; }) : [] };
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
    }
  }
  const experimentIds = new Set(normalized.experiments.map(item => item.id)); const revisionIds = new Set(normalized.revisions.map(item => item.id)); const batchIds = new Set(normalized.batches.map(item => item.id));
  for (const experiment of normalized.experiments) { if (!statuses.includes(experiment.status)) throw new Error(`Invalid experiment status for ${experiment.id}.`); for (const revisionId of experiment.formulaRevisionIds || []) { const revision = normalized.revisions.find(item => item.id === revisionId); if (!revision || revision.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid revision link.`); } for (const batchId of experiment.batchIds || []) { const batch = normalized.batches.find(item => item.id === batchId); if (!batch || batch.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid batch link.`); } for (const evaluationId of experiment.evaluationIds || []) { const evaluation = normalized.evaluations.find(item => item.id === evaluationId); if (!evaluation || evaluation.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid evaluation link.`); } }
  for (const revision of normalized.revisions) { if (!experimentIds.has(revision.experimentId)) throw new Error(`Revision ${revision.id} references an unknown experiment.`); if (revision.supersedesRevisionId && (!revisionIds.has(revision.supersedesRevisionId) || normalized.revisions.find(item => item.id === revision.supersedesRevisionId).experimentId !== revision.experimentId)) throw new Error(`Revision ${revision.id} has an invalid predecessor.`); for (const ingredient of revision.ingredients || []) { if (!materialIds.has(ingredient.materialId)) throw new Error(`Revision ${revision.id} references an unknown material.`); if (ingredient.lotId && !lotIds.has(ingredient.lotId)) throw new Error(`Revision ${revision.id} references an unknown lot.`); } }
  for (const batch of normalized.batches) { if (!experimentIds.has(batch.experimentId)) throw new Error(`Batch ${batch.id} references an unknown experiment.`); const revision = normalized.revisions.find(item => item.id === batch.formulaRevisionId); if (!revision || revision.experimentId !== batch.experimentId) throw new Error(`Batch ${batch.id} references an invalid revision.`); for (const addition of batch.actualAdditions || []) { validateAddition(normalized, addition); const movement = normalized.stockMovements.find(item => item.id === addition.stockMovementId); if (!movement) throw new Error(`Batch addition ${addition.id} is missing a stock movement.`); if (movement.movementType !== 'consumption') throw new Error(`Batch addition ${addition.id} must link to a consumption movement.`); if (movement.batchId !== batch.id || movement.additionId !== addition.id) throw new Error(`Batch addition ${addition.id} and movement ${movement.id} do not reference each other.`); if (movement.materialId !== addition.materialId || movement.materialLotId !== addition.materialLotId) throw new Error(`Batch addition ${addition.id} and movement ${movement.id} disagree on material or lot.`); if (movement.quantity !== addition.amount || !unitsInterchangeable(movement.unit, addition.unit, movement.density ?? lotOf(normalized, addition.materialLotId).density)) throw new Error(`Batch addition ${addition.id} and movement ${movement.id} disagree on quantity or unit.`); } }
  for (const evaluation of normalized.evaluations) { if (!experimentIds.has(evaluation.experimentId)) throw new Error(`Evaluation ${evaluation.id} references an unknown experiment.`); if (evaluation.batchId) { const batch = normalized.batches.find(item => item.id === evaluation.batchId); if (!batch || batch.experimentId !== evaluation.experimentId) throw new Error(`Evaluation ${evaluation.id} references an invalid batch.`); if (evaluation.revisionId && evaluation.revisionId !== batch.formulaRevisionId) throw new Error(`Evaluation ${evaluation.id} revision does not match its batch.`); } if (evaluation.revisionId && (!revisionIds.has(evaluation.revisionId) || normalized.revisions.find(item => item.id === evaluation.revisionId).experimentId !== evaluation.experimentId)) throw new Error(`Evaluation ${evaluation.id} references an invalid revision.`); }
  for (const movement of normalized.stockMovements) { normalizeMovement(normalized, movement, { allowGeneratedId: true, enforceOpening: false }); if (movement.batchId && !batchIds.has(movement.batchId)) throw new Error(`Movement ${movement.id} references an unknown batch.`); if (movement.movementType === 'consumption' && (!movement.batchId || !movement.additionId)) throw new Error(`Consumption movement ${movement.id} must reference a batch and addition.`); if (movement.movementType === 'consumption') { const batch = normalized.batches.find(item => item.id === movement.batchId); const addition = (batch?.actualAdditions || []).find(item => item.id === movement.additionId); if (!addition) throw new Error(`Consumption movement ${movement.id} references an unknown batch addition.`); if (addition.stockMovementId !== movement.id) throw new Error(`Consumption movement ${movement.id} and addition ${addition.id} do not reference each other.`); if (movement.quantity !== addition.amount || !unitsInterchangeable(movement.unit, addition.unit, movement.density ?? lotOf(normalized, addition.materialLotId).density)) throw new Error(`Consumption movement ${movement.id} and addition ${addition.id} disagree on quantity or unit.`); } }
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
  const batch = { id: batchId, idempotencyKey: input.idempotencyKey, batchCode: input.batchCode || `BATCH-${String(normalized.batches.length + 1).padStart(3, '0')}`, experimentId, formulaRevisionId: revision.id, plannedAmount: positiveFinite(input.plannedAmount, 'Planned amount'), unit: requireText(input.unit, 'Batch unit'), actualAdditions, procedureNotes: input.procedureNotes || '', maturationSchedule: input.maturationSchedule || '', result: input.result || '', createdAt: now() };
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
  if (normalized.stockMovements.some(item => item.materialId === materialId) || normalized.revisions.some(revision => (revision.ingredients || []).some(item => item.materialId === materialId)) || normalized.batches.some(batch => (batch.actualAdditions || []).some(item => item.materialId === materialId))) throw new Error('Referenced materials cannot be deleted; preserve their history instead.');
  return validateState({ ...normalized, materials: normalized.materials.filter(item => item.id !== materialId) });
}

export function deleteLot(state, lotId) {
  const normalized = normalizeState(state); const { material } = findLot(normalized, lotId);
  if (normalized.stockMovements.some(item => item.materialLotId === lotId) || normalized.revisions.some(revision => (revision.ingredients || []).some(item => item.lotId === lotId)) || normalized.batches.some(batch => (batch.actualAdditions || []).some(item => item.materialLotId === lotId))) throw new Error('Referenced lots cannot be deleted; preserve their history instead.');
  return validateState({ ...normalized, materials: normalized.materials.map(item => item.id === material.id ? { ...item, lots: item.lots.filter(lot => lot.id !== lotId) } : item) });
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
