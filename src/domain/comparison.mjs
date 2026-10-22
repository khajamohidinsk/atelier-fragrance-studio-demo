import { calculateBatchTotals, convertQuantity, validateUnit } from './calculations.mjs';

const stable = (items, key) => [...items].sort((a, b) => String(key(a)).localeCompare(String(key(b))));

function ingredientMap(revision) {
  return new Map((revision.ingredients || []).map(item => [`${item.materialId}|${item.lotId || ''}`, item]));
}

export function compareRevisions(state, leftRevisionId, rightRevisionId) {
  const left = state.revisions.find(item => item.id === leftRevisionId);
  const right = state.revisions.find(item => item.id === rightRevisionId);
  if (!left || !right) throw new Error('Both revisions are required for comparison.');
  const leftMap = ingredientMap(left); const rightMap = ingredientMap(right); const keys = stable(new Set([...leftMap.keys(), ...rightMap.keys()]), item => item);
  const ingredientChanges = [];
  for (const key of keys) { const before = leftMap.get(key); const after = rightMap.get(key); if (!before) ingredientChanges.push({ kind: 'added', key, after }); else if (!after) ingredientChanges.push({ kind: 'removed', key, before }); else { const changed = ['quantity', 'unit', 'stockConcentration', 'role'].some(field => before[field] !== after[field]); if (changed) ingredientChanges.push({ kind: 'changed', key, before, after }); } }
  const leftBatches = stable(state.batches.filter(item => item.formulaRevisionId === left.id), item => `${item.createdAt}|${item.id}`);
  const rightBatches = stable(state.batches.filter(item => item.formulaRevisionId === right.id), item => `${item.createdAt}|${item.id}`);
  const batchTotals = batches => batches.map(batch => ({ batchId: batch.id, formulaRevisionId: batch.formulaRevisionId, plannedAmount: batch.plannedAmount, plannedUnit: batch.unit, actual: batch.actualAdditions?.length ? calculateBatchTotals(batch.actualAdditions, { unit: batch.unit }) : null }));
  const leftEvaluations = stable(state.evaluations.filter(item => item.revisionId === left.id || leftBatches.some(batch => batch.id === item.batchId)), item => `${item.evaluatedAt}|${item.id}`);
  const rightEvaluations = stable(state.evaluations.filter(item => item.revisionId === right.id || rightBatches.some(batch => batch.id === item.batchId)), item => `${item.evaluatedAt}|${item.id}`);
  const conditions = new Set([...leftEvaluations, ...rightEvaluations].map(item => `${item.medium || 'unknown'}|${item.environment || 'unknown'}`));
  return { leftRevisionId: left.id, rightRevisionId: right.id, sameExperiment: left.experimentId === right.experimentId, ingredientChanges, leftBatches, rightBatches, leftBatchTotals: batchTotals(leftBatches), rightBatchTotals: batchTotals(rightBatches), leftEvaluations, rightEvaluations, conditionsCompatible: conditions.size <= 1, warnings: [...(left.experimentId !== right.experimentId ? ['These revisions belong to different experiments.'] : []), ...(conditions.size > 1 ? ['Evaluation media or environments differ; compare as recorded, not as a controlled trial.'] : []), ...([...leftEvaluations, ...rightEvaluations].some(item => !item.revisionId) ? ['Some evaluations lack explicit revision provenance and were linked through their batch.'] : [])] };
}

export function compareQuantities(left, right, { unit, density } = {}) {
  if (left === undefined || right === undefined) return { status: 'insufficient-data' };
  const targetUnit = unit || left.unit || right.unit; validateUnit(targetUnit);
  try { return { status: 'comparable', delta: convertQuantity(right.amount, right.unit, targetUnit, { density }) - convertQuantity(left.amount, left.unit, targetUnit, { density }), unit: targetUnit }; } catch (error) { return { status: 'incompatible', reason: error.message }; }
}
