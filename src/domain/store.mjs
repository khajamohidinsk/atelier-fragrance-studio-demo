import { calculateBatchTotals, convertQuantity, validateUnit } from './calculations.mjs';

export const STORAGE_KEY = 'atelier-lab-state-v1';
export const LEGACY_COMPANION_STORAGE_KEY = 'atelier.scent-companion.v1';
export const CURRENT_SCHEMA_VERSION = 2;
export const statuses = ['Draft', 'Mixed', 'Maturing', 'Evaluated', 'Archived'];
export const movementTypes = ['opening', 'receipt', 'adjustment', 'consumption', 'wastage', 'correction', 'reversal'];

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const clone = value => JSON.parse(JSON.stringify(value));

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function positiveFinite(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
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
  return lot.receivedUnit || lot.defaultUnit || 'g';
}

function movementDirection(movement) {
  if (movement.movementType === 'opening' || movement.movementType === 'receipt') return 1;
  if (movement.movementType === 'consumption' || movement.movementType === 'wastage') return -1;
  if (movement.movementType === 'adjustment' || movement.movementType === 'correction') return movement.direction === 'decrease' ? -1 : 1;
  if (movement.movementType === 'reversal') return movement.direction === 'decrease' ? -1 : 1;
  throw new Error(`Unsupported stock movement type "${movement.movementType}".`);
}

function normalizeMovement(state, input, { allowGeneratedId = false } = {}) {
  const movementType = requireText(input.movementType, 'Movement type');
  if (!movementTypes.includes(movementType)) throw new Error(`Unsupported stock movement type "${movementType}".`);
  const materialId = requireText(input.materialId, 'Movement materialId');
  const material = findMaterial(state, materialId);
  const materialLotId = requireText(input.materialLotId, 'Movement materialLotId');
  const { material: owningMaterial, lot } = findLot(state, materialLotId);
  if (owningMaterial.id !== material.id || lot.materialId && lot.materialId !== material.id) throw new Error('Stock movement material and lot do not match.');
  const unit = requireText(input.unit || lotUnit(lot), 'Movement unit');
  validateUnit(unit);
  const baseUnit = lotUnit(lot);
  validateUnit(baseUnit);
  const density = input.density ?? lot.density;
  const quantity = positiveFinite(input.quantity, 'Movement quantity');
  convertQuantity(quantity, unit, baseUnit, { density });
  if (movementType === 'reversal') {
    const reference = state.stockMovements.find(item => item.id === input.referenceMovementId);
    if (!reference) throw new Error('A reversal must reference an existing stock movement.');
    if (reference.materialLotId !== materialLotId) throw new Error('A reversal must reference a movement from the same lot.');
    input = { ...input, direction: movementDirection(reference) > 0 ? 'decrease' : 'increase' };
  }
  if ((movementType === 'correction' || movementType === 'reversal') && !input.referenceMovementId) throw new Error(`${movementType} movements require referenceMovementId.`);
  if ((movementType === 'adjustment' || movementType === 'correction') && !['increase', 'decrease'].includes(input.direction)) throw new Error(`${movementType} movements require direction increase or decrease.`);
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
    occurredAt: createdAt,
    note: input.note || '',
    batchId: input.batchId,
    additionId: input.additionId,
    referenceMovementId: input.referenceMovementId
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
    const additionsByLot = new Map();
    for (const batch of state.batches) for (const addition of batch.actualAdditions || []) if (addition.materialLotId) additionsByLot.set(addition.materialLotId, [...(additionsByLot.get(addition.materialLotId) || []), { batch, addition }]);
    state.stockMovements = [];
    for (const [lotId, rows] of additionsByLot) {
      const first = rows[0].addition;
      const total = rows.reduce((sum, row) => sum + Number(row.addition.amount || 0), 0);
      const openingId = `movement-legacy-opening-${lotId}`;
      state.stockMovements.push({ id: openingId, materialId: first.materialId, materialLotId: lotId, movementType: 'opening', quantity: total, unit: first.unit, occurredAt: rows[0].batch.createdAt || now(), note: 'Migrated opening balance inferred from legacy batch additions.', provenance: 'migration' });
      for (const row of rows) { const movementId = `movement-legacy-${row.addition.id}`; row.addition.stockMovementId = movementId; state.stockMovements.push({ id: movementId, materialId: row.addition.materialId, materialLotId: row.addition.materialLotId, movementType: 'consumption', quantity: row.addition.amount, unit: row.addition.unit, density: row.addition.density, occurredAt: row.addition.addedAt || row.batch.createdAt || now(), batchId: row.batch.id, additionId: row.addition.id, note: 'Migrated from legacy actual addition.', provenance: 'migration' }); }
      const { lot } = findLot(state, lotId); if (lot.receivedAmount == null) { lot.receivedAmount = total; lot.receivedUnit = first.unit; }
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
  for (const material of normalized.materials) { for (const lot of material.lots || []) { if (!lot.id || lotIds.has(lot.id)) throw new Error('Duplicate or missing material lot id.'); lotIds.add(lot.id); if (lot.materialId !== material.id) throw new Error(`Lot ${lot.id} does not belong to its material.`); validateUnit(lotUnit(lot)); if (lot.receivedAmount !== undefined) positiveFinite(lot.receivedAmount, `Lot ${lot.id} received amount`); } }
  const experimentIds = new Set(normalized.experiments.map(item => item.id)); const revisionIds = new Set(normalized.revisions.map(item => item.id)); const batchIds = new Set(normalized.batches.map(item => item.id)); const movementIds = new Set(normalized.stockMovements.map(item => item.id));
  for (const experiment of normalized.experiments) { if (!statuses.includes(experiment.status)) throw new Error(`Invalid experiment status for ${experiment.id}.`); for (const revisionId of experiment.formulaRevisionIds || []) { const revision = normalized.revisions.find(item => item.id === revisionId); if (!revision || revision.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid revision link.`); } for (const batchId of experiment.batchIds || []) { const batch = normalized.batches.find(item => item.id === batchId); if (!batch || batch.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid batch link.`); } for (const evaluationId of experiment.evaluationIds || []) { const evaluation = normalized.evaluations.find(item => item.id === evaluationId); if (!evaluation || evaluation.experimentId !== experiment.id) throw new Error(`Experiment ${experiment.id} has an invalid evaluation link.`); } }
  for (const revision of normalized.revisions) { if (!experimentIds.has(revision.experimentId)) throw new Error(`Revision ${revision.id} references an unknown experiment.`); if (revision.supersedesRevisionId && (!revisionIds.has(revision.supersedesRevisionId) || normalized.revisions.find(item => item.id === revision.supersedesRevisionId).experimentId !== revision.experimentId)) throw new Error(`Revision ${revision.id} has an invalid predecessor.`); for (const ingredient of revision.ingredients || []) { if (!materialIds.has(ingredient.materialId)) throw new Error(`Revision ${revision.id} references an unknown material.`); if (ingredient.lotId && !lotIds.has(ingredient.lotId)) throw new Error(`Revision ${revision.id} references an unknown lot.`); } }
  for (const batch of normalized.batches) { if (!experimentIds.has(batch.experimentId)) throw new Error(`Batch ${batch.id} references an unknown experiment.`); const revision = normalized.revisions.find(item => item.id === batch.formulaRevisionId); if (!revision || revision.experimentId !== batch.experimentId) throw new Error(`Batch ${batch.id} references an invalid revision.`); for (const addition of batch.actualAdditions || []) { validateAddition(normalized, addition); if (!movementIds.has(addition.stockMovementId)) throw new Error(`Batch addition ${addition.id} is missing a stock movement.`); } }
  for (const evaluation of normalized.evaluations) { if (!experimentIds.has(evaluation.experimentId)) throw new Error(`Evaluation ${evaluation.id} references an unknown experiment.`); if (evaluation.batchId) { const batch = normalized.batches.find(item => item.id === evaluation.batchId); if (!batch || batch.experimentId !== evaluation.experimentId) throw new Error(`Evaluation ${evaluation.id} references an invalid batch.`); if (evaluation.revisionId && evaluation.revisionId !== batch.formulaRevisionId) throw new Error(`Evaluation ${evaluation.id} revision does not match its batch.`); } if (evaluation.revisionId && (!revisionIds.has(evaluation.revisionId) || normalized.revisions.find(item => item.id === evaluation.revisionId).experimentId !== evaluation.experimentId)) throw new Error(`Evaluation ${evaluation.id} references an invalid revision.`); }
  for (const movement of normalized.stockMovements) { normalizeMovement(normalized, movement, { allowGeneratedId: true }); if (movement.batchId && !batchIds.has(movement.batchId)) throw new Error(`Movement ${movement.id} references an unknown batch.`); if (movement.movementType === 'consumption' && (!movement.batchId || !movement.additionId)) throw new Error(`Consumption movement ${movement.id} must reference a batch and addition.`); }
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

function validateAddition(state, addition) {
  if (!addition?.id) throw new Error('Every batch addition needs an id.');
  const material = findMaterial(state, addition.materialId); const { material: owningMaterial, lot } = findLot(state, addition.materialLotId);
  if (material.id !== owningMaterial.id || lot.materialId !== material.id) throw new Error(`Batch addition ${addition.id} material and lot do not match.`);
  positiveFinite(addition.amount, `Batch addition ${addition.id} amount`); validateUnit(addition.unit); finitePercentage(addition.concentration ?? 100, `Batch addition ${addition.id} concentration`); convertQuantity(addition.amount, addition.unit, lotUnit(lot), { density: addition.density ?? lot.density });
}

export function stockBalance(state, materialLotId, unit) {
  const normalized = normalizeState(state); const { lot } = findLot(normalized, materialLotId); const targetUnit = unit || lotUnit(lot); validateUnit(targetUnit); let balance = 0;
  for (const movement of normalized.stockMovements.filter(item => item.materialLotId === materialLotId)) { const amount = convertQuantity(movement.quantity, movement.unit, targetUnit, { density: movement.density ?? lot.density }); let direction = movementDirection(movement); if (movement.movementType === 'reversal') { const original = normalized.stockMovements.find(item => item.id === movement.referenceMovementId); direction = -movementDirection(original); } balance += direction * amount; }
  return balance;
}

export function stockBalances(state, materialLotId) { const { lot } = findLot(normalizeState(state), materialLotId); return { unit: lotUnit(lot), balance: stockBalance(state, materialLotId, lotUnit(lot)) }; }

export function addStockMovement(state, input) {
  const normalized = normalizeState(state); const movement = normalizeMovement(normalized, { ...input, id: input.id || id('movement') }, { allowGeneratedId: true });
  if (normalized.stockMovements.some(item => item.id === movement.id)) throw new Error(`Stock movement ${movement.id} already exists.`);
  const next = { ...normalized, stockMovements: [...normalized.stockMovements, movement] };
  if (stockBalance(next, movement.materialLotId, lotUnit(findLot(next, movement.materialLotId).lot)) < -1e-9) throw new Error('Insufficient stock for this movement.');
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
  const revision = normalized.revisions.find(item => item.id === input.formulaRevisionId); if (!revision || revision.experimentId !== experimentId || !experiment.formulaRevisionIds.includes(revision.id)) throw new Error('Batch must reference a revision belonging to its experiment.');
  const actualAdditions = (input.actualAdditions || []).map(item => ({ ...item, id: item.id || id('addition'), addedAt: item.addedAt || now() })); if (!actualAdditions.length) throw new Error('At least one actual addition is required.');
  const batchId = id('batch');
  const additionIds = new Set(normalized.batches.flatMap(batch => batch.actualAdditions || []).map(item => item.id)); const movementIds = new Set(normalized.stockMovements.map(item => item.id)); const movements = [];
  for (const addition of actualAdditions) { if (additionIds.has(addition.id)) throw new Error(`Batch addition ${addition.id} already exists.`); validateAddition(normalized, addition); const movementId = `movement-${addition.id}`; if (movementIds.has(movementId)) throw new Error(`Stock consumption for addition ${addition.id} already exists.`); const movement = normalizeMovement(normalized, { id: movementId, materialId: addition.materialId, materialLotId: addition.materialLotId, movementType: 'consumption', quantity: addition.amount, unit: addition.unit, density: addition.density, occurredAt: addition.addedAt, batchId, additionId: addition.id, note: `Consumption for batch ${input.batchCode || 'new batch'}` }, { allowGeneratedId: true }); movements.push(movement); addition.stockMovementId = movement.id; }
  const batch = { id: batchId, batchCode: input.batchCode || `BATCH-${String(normalized.batches.length + 1).padStart(3, '0')}`, experimentId, formulaRevisionId: revision.id, plannedAmount: positiveFinite(input.plannedAmount, 'Planned amount'), unit: requireText(input.unit, 'Batch unit'), actualAdditions, procedureNotes: input.procedureNotes || '', maturationSchedule: input.maturationSchedule || '', result: input.result || '', createdAt: now() };
  validateUnit(batch.unit); const next = { ...normalized, batches: [batch, ...normalized.batches], stockMovements: [...normalized.stockMovements, ...movements], experiments: normalized.experiments.map(item => item.id === experimentId ? { ...item, batchIds: [...item.batchIds, batch.id], status: item.status === 'Draft' ? 'Mixed' : item.status } : item) };
  for (const movement of movements) if (stockBalance(next, movement.materialLotId, lotUnit(findLot(next, movement.materialLotId).lot)) < -1e-9) throw new Error('Insufficient stock for one or more batch additions.');
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
