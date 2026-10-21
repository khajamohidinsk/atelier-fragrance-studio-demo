import { calculateBatchTotals } from './calculations.mjs';

export const STORAGE_KEY = 'atelier-lab-state-v1';
export const LEGACY_COMPANION_STORAGE_KEY = 'atelier.scent-companion.v1';
export const statuses = ['Draft', 'Mixed', 'Maturing', 'Evaluated', 'Archived'];

const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createInitialState() {
  const revisionId = 'revision-seed-1';
  const experimentId = 'experiment-seed-1';
  const materialId = 'material-seed-1';
  const batchId = 'batch-seed-1';
  return {
    version: 1,
    journalEntries: [{ id: 'journal-seed-1', title: 'Rain on warm stone', observedAt: '2026-10-14T08:30:00.000Z', purpose: 'Explore a mineral-woody balance after a rainy morning.', hypothesis: 'A dry cedar base will keep the mineral accord from feeling austere.', materials: 'Bergamot, cedar, amber accord', opening: 'Cool citrus and wet stone.', heart: 'Green tea with dry cedar.', dryDown: 'Quiet amber and skin musk.', overall: 'Airy, contemplative, and easy to revisit.', descriptors: ['green', 'woody', 'aquatic'], intensity: 3, longevityHours: 5, projection: 2, evaluationTimeMinutes: 30, medium: 'Blotter', environment: 'Open studio, 22°C', personalNotes: 'Personal sensory impression; no instrument measurement.', conclusion: 'Promising opening; revisit on skin.', nextSteps: 'Try a slightly warmer amber base.', tags: ['atmospheric', 'woody'], experimentId, attachmentRefs: [] }],
    experiments: [{ id: experimentId, experimentId: 'EXP-001', title: 'Mineral garden accord', objective: 'Test a fresh woody accord for a quiet daytime profile.', status: 'Maturing', createdAt: '2026-10-10T09:00:00.000Z', formulaRevisionIds: [revisionId], journalEntryIds: ['journal-seed-1'], batchIds: [batchId], evaluationIds: ['evaluation-seed-1'], tags: ['fresh', 'woody'] }],
    revisions: [{ id: revisionId, experimentId, revision: 1, createdAt: '2026-10-10T09:15:00.000Z', objective: 'Initial formula', supersedesRevisionId: null, notes: 'Seed formula. Historical revisions are immutable.', ingredients: [{ materialId, materialName: 'Cedar atlas accord', lotId: 'lot-seed-1', quantity: 20, unit: 'g', stockConcentration: 100, role: 'Base' }, { materialId: 'material-seed-2', materialName: 'Neutral perfumer alcohol', lotId: 'lot-seed-2', quantity: 80, unit: 'g', stockConcentration: 0, role: 'Diluent' }] }],
    materials: [{ id: materialId, name: 'Cedar atlas accord', canonicalIdentity: '', supplier: '', productReference: '', safetyReference: '', storageNotes: 'Store cool and dark.', lots: [{ id: 'lot-seed-1', lotCode: 'DEMO-001', acquiredAt: '2026-10-01', purity: 100, stockConcentration: 100, solvent: 'None', notes: 'Synthetic sample lot.' }] }, { id: 'material-seed-2', name: 'Neutral perfumer alcohol', canonicalIdentity: '', supplier: '', productReference: '', safetyReference: '', storageNotes: 'Closed container.', lots: [{ id: 'lot-seed-2', lotCode: 'DEMO-002', acquiredAt: '2026-10-01', purity: 100, stockConcentration: 0, solvent: 'None', notes: 'Synthetic sample lot.' }] }],
    batches: [{ id: batchId, batchCode: 'BATCH-001', experimentId, formulaRevisionId: revisionId, plannedAmount: 100, unit: 'g', actualAdditions: [{ id: 'addition-seed-1', materialId, materialLotId: 'lot-seed-1', amount: 20, unit: 'g', concentration: 100, addedAt: '2026-10-10T09:30:00.000Z' }, { id: 'addition-seed-2', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 80, unit: 'g', concentration: 0, addedAt: '2026-10-10T09:30:00.000Z' }], procedureNotes: 'Blend slowly, then store covered.', maturationSchedule: 'Evaluate at 0h, 24h, and 7d.', result: 'Awaiting final evaluation.', createdAt: '2026-10-10T09:30:00.000Z' }],
    evaluations: [{ id: 'evaluation-seed-1', experimentId, batchId, revisionId, evaluatedAt: '2026-10-14T08:30:00.000Z', intervalLabel: '96 hours', medium: 'Blotter', environment: 'Open studio, 22°C', descriptors: ['green', 'woody'], scores: { intensity: 3, longevity: 3, projection: 2 }, subjectiveNotes: 'Still fresh with a dry cedar backbone.', measuredResults: '', isMeasured: false }],
    calculations: [], tags: ['atmospheric', 'woody', 'fresh'], attachments: []
    , companionEntries: []
  };
}

export function loadState(storage = globalThis.localStorage) {
  try { const saved = storage?.getItem(STORAGE_KEY); return saved ? normalizeState(JSON.parse(saved)) : createInitialState(); } catch { return createInitialState(); }
}
export function saveState(state, storage = globalThis.localStorage) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); return state; }
  catch { throw new Error('Could not save Atelier data in this browser. Keep this editor open and try again.'); }
}
export function normalizeState(state) { const base = createInitialState(); return { ...base, ...state, journalEntries: state.journalEntries ?? [], experiments: state.experiments ?? [], revisions: state.revisions ?? [], materials: state.materials ?? [], batches: state.batches ?? [], evaluations: state.evaluations ?? [], calculations: state.calculations ?? [], tags: state.tags ?? [], attachments: state.attachments ?? [], companionEntries: state.companionEntries ?? [] }; }
export function addJournalEntry(state, input) { const entry = { id: id('journal'), observedAt: now(), tags: [], descriptors: [], attachmentRefs: [], ...input }; return { ...state, journalEntries: [entry, ...state.journalEntries] }; }
export function normalizeCompanionEntry(input, fallbackId = id('companion')) {
  const createdAt = input.createdAt || now();
  return {
    id: input.id || fallbackId,
    materialName: input.materialName || '',
    evaluationType: input.evaluationType || 'neat',
    concentration: input.concentration || '',
    evaluationMethod: input.evaluationMethod || '',
    elapsedTime: input.elapsedTime || '',
    originalText: input.originalText || '',
    correctedText: input.correctedText ?? input.originalText ?? '',
    createdAt,
    updatedAt: input.updatedAt || createdAt,
    source: input.source === 'speech' ? 'speech' : 'typed',
    aiSuggestions: Array.isArray(input.aiSuggestions) ? input.aiSuggestions : []
  };
}
export function addCompanionEntry(state, input) { return { ...state, companionEntries: [normalizeCompanionEntry(input), ...(state.companionEntries || [])] }; }
export function updateCompanionEntry(state, entryId, input) { return { ...state, companionEntries: (state.companionEntries || []).map(entry => entry.id === entryId ? normalizeCompanionEntry({ ...entry, ...input, id: entry.id, createdAt: entry.createdAt, updatedAt: now() }) : entry) }; }
export function deleteCompanionEntry(state, entryId) { return { ...state, companionEntries: (state.companionEntries || []).filter(entry => entry.id !== entryId) }; }
export function importLegacyCompanionEntries(state, storage = globalThis.localStorage) {
  if (!storage) return { state, imported: 0 };
  try {
    const legacy = JSON.parse(storage.getItem(LEGACY_COMPANION_STORAGE_KEY) || 'null');
    if (!legacy || !Array.isArray(legacy.entries) || legacy.entries.length === 0) return { state, imported: 0 };
    const existing = state.companionEntries || [];
    const seenIds = new Set(existing.map(entry => entry.id).filter(Boolean));
    const seenFingerprints = new Set(existing.map(entry => [entry.materialName, entry.originalText, entry.createdAt].join('\u0000')));
    const entries = legacy.entries.map(entry => normalizeCompanionEntry(entry)).filter(entry => {
      const fingerprint = [entry.materialName, entry.originalText, entry.createdAt].join('\u0000');
      if (seenIds.has(entry.id) || seenFingerprints.has(fingerprint)) return false;
      seenIds.add(entry.id);
      seenFingerprints.add(fingerprint);
      return true;
    });
    return entries.length ? { state: { ...state, companionEntries: [...existing, ...entries] }, imported: entries.length } : { state, imported: 0 };
  } catch { return { state, imported: 0 }; }
}
export function addExperiment(state, input) { const experiment = { id: id('experiment'), experimentId: input.experimentId || `EXP-${String(state.experiments.length + 1).padStart(3, '0')}`, createdAt: now(), status: 'Draft', formulaRevisionIds: [], journalEntryIds: [], batchIds: [], evaluationIds: [], tags: [], ...input }; return { ...state, experiments: [experiment, ...state.experiments] }; }
export function addRevision(state, experimentId, input) {
  const experiment = state.experiments.find(item => item.id === experimentId); if (!experiment) throw new Error('Experiment not found.');
  const revision = { id: id('revision'), experimentId, revision: experiment.formulaRevisionIds.length + 1, createdAt: now(), supersedesRevisionId: experiment.formulaRevisionIds.at(-1) ?? null, ingredients: [], ...input };
  return { ...state, revisions: [revision, ...state.revisions], experiments: state.experiments.map(item => item.id === experimentId ? { ...item, formulaRevisionIds: [...item.formulaRevisionIds, revision.id] } : item) };
}
export function addBatch(state, experimentId, input) {
  const experiment = state.experiments.find(item => item.id === experimentId); if (!experiment) throw new Error('Experiment not found.');
  if (!experiment.formulaRevisionIds.includes(input.formulaRevisionId)) throw new Error('Batch must reference a revision belonging to its experiment.');
  const batch = { id: id('batch'), batchCode: `BATCH-${String(state.batches.length + 1).padStart(3, '0')}`, experimentId, actualAdditions: [], createdAt: now(), ...input };
  return { ...state, batches: [batch, ...state.batches], experiments: state.experiments.map(item => item.id === experimentId ? { ...item, batchIds: [...item.batchIds, batch.id], status: item.status === 'Draft' ? 'Mixed' : item.status } : item) };
}
export function addEvaluation(state, experimentId, input) { const evaluation = { id: id('evaluation'), experimentId, evaluatedAt: now(), descriptors: [], scores: {}, isMeasured: false, ...input }; return { ...state, evaluations: [evaluation, ...state.evaluations], experiments: state.experiments.map(item => item.id === experimentId ? { ...item, evaluationIds: [...item.evaluationIds, evaluation.id], status: 'Evaluated' } : item) }; }
export function batchSummary(batch) { return calculateBatchTotals(batch.actualAdditions, { unit: batch.unit }); }
export function exportState(state) { return JSON.stringify({ ...state, exportedAt: now() }, null, 2); }
