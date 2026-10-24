import { calculateBatchTotals, convertQuantity, validateUnit } from './calculations.mjs';
import { compareBatchToPlan } from './store.mjs';

const stable = (items, key) => [...items].sort((a, b) => String(key(a)).localeCompare(String(key(b))));

function ingredientMap(revision) {
  return new Map((revision.ingredients || []).map(item => [`${item.materialId}|${item.lotId || ''}`, item]));
}

function evaluationEvidence(item) {
  return {
    id: item.id,
    batchId: item.batchId,
    revisionId: item.revisionId,
    evaluatedAt: item.evaluatedAt,
    intervalLabel: item.intervalLabel || 'Unlabelled interval',
    elapsedMinutes: item.elapsedMinutes,
    medium: item.medium || 'Unknown medium',
    environment: item.environment || 'Unknown environment',
    conditions: item.conditions || 'Conditions not recorded',
    descriptors: item.descriptors || [],
    subjectiveNotes: item.subjectiveNotes || '',
    measuredResults: item.measuredResults || '',
    longevity: { observation: item.longevityObservation || '', method: item.longevityMethod || '' },
    projection: { observation: item.projectionObservation || '', method: item.projectionMethod || '' },
    predictedOutcome: item.predictedOutcome || '',
    conclusions: item.conclusions || '',
    nextSteps: item.nextSteps || '',
    isMeasured: item.isMeasured === true,
    provenance: item.provenance || (item.isMeasured ? 'measured' : 'subjective'),
    aiSuggestions: Array.isArray(item.aiSuggestions) ? item.aiSuggestions : []
  };
}

function conditionKey(item) { return `${item.medium || 'unknown'}|${item.environment || 'unknown'}|${item.conditions || 'unknown'}`; }

function batchEvidence(state, batches) {
  return batches.map(batch => {
    let plannedActual;
    try { plannedActual = compareBatchToPlan(state, batch.id); } catch (error) { plannedActual = { error: error.message }; }
    return { batchId: batch.id, batchCode: batch.batchCode, formulaRevisionId: batch.formulaRevisionId, mixingDate: batch.mixingDate || batch.createdAt, plannedAmount: batch.plannedAmount, plannedUnit: batch.unit, actual: batch.actualAdditions?.length ? calculateBatchTotals(batch.actualAdditions, { unit: batch.unit }) : null, plannedActual, deviations: batch.deviations || '', observations: batch.observations || '' };
  });
}

function conditionDifferences(leftEvaluations, rightEvaluations) {
  const keys = ['medium', 'environment', 'conditions'];
  return keys.filter(key => {
    const left = new Set(leftEvaluations.map(item => item[key] || 'unknown'));
    const right = new Set(rightEvaluations.map(item => item[key] || 'unknown'));
    return [...left].some(value => !right.has(value)) || [...right].some(value => !left.has(value));
  }).map(key => ({ field: key, left: [...new Set(leftEvaluations.map(item => item[key] || 'unknown'))].sort(), right: [...new Set(rightEvaluations.map(item => item[key] || 'unknown'))].sort() }));
}

export function compareRevisions(state, leftRevisionId, rightRevisionId) {
  const left = state.revisions.find(item => item.id === leftRevisionId);
  const right = state.revisions.find(item => item.id === rightRevisionId);
  if (!left || !right) throw new Error('Both revisions are required for comparison.');
  const leftMap = ingredientMap(left); const rightMap = ingredientMap(right); const keys = stable(new Set([...leftMap.keys(), ...rightMap.keys()]), item => item);
  const ingredientChanges = [];
  for (const key of keys) { const before = leftMap.get(key); const after = rightMap.get(key); if (!before) ingredientChanges.push({ kind: 'added', key, after }); else if (!after) ingredientChanges.push({ kind: 'removed', key, before }); else { const changed = ['quantity', 'unit', 'stockConcentration', 'role'].some(field => before[field] !== after[field]); if (changed) ingredientChanges.push({ kind: 'changed', key, before, after }); } }
  const leftBatches = stable(state.batches.filter(item => item.formulaRevisionId === left.id), item => `${item.mixingDate || item.createdAt}|${item.id}`);
  const rightBatches = stable(state.batches.filter(item => item.formulaRevisionId === right.id), item => `${item.mixingDate || item.createdAt}|${item.id}`);
  const leftBatchTotals = batchEvidence(state, leftBatches); const rightBatchTotals = batchEvidence(state, rightBatches);
  const leftEvaluations = stable(state.evaluations.filter(item => item.revisionId === left.id || leftBatches.some(batch => batch.id === item.batchId)), item => `${item.evaluatedAt}|${item.id}`).map(evaluationEvidence);
  const rightEvaluations = stable(state.evaluations.filter(item => item.revisionId === right.id || rightBatches.some(batch => batch.id === item.batchId)), item => `${item.evaluatedAt}|${item.id}`).map(evaluationEvidence);
  const allEvaluations = [...leftEvaluations, ...rightEvaluations];
  const conditionChanges = conditionDifferences(leftEvaluations, rightEvaluations);
  const missingEvidence = [];
  if (!leftBatches.length) missingEvidence.push('No physical batch is linked to the left revision.');
  if (!rightBatches.length) missingEvidence.push('No physical batch is linked to the right revision.');
  if (!leftEvaluations.length) missingEvidence.push('No evaluation is linked to the left revision or its batches.');
  if (!rightEvaluations.length) missingEvidence.push('No evaluation is linked to the right revision or its batches.');
  if (allEvaluations.some(item => item.provenance === 'subjective' && item.isMeasured)) missingEvidence.push('At least one evaluation has conflicting subjective/measured provenance flags.');
  const warnings = [
    ...(left.experimentId !== right.experimentId ? ['These revisions belong to different experiments.'] : []),
    ...(conditionChanges.length ? ['Evaluation media, environments, or conditions differ; compare as recorded, not as a controlled trial.'] : []),
    ...(allEvaluations.some(item => !item.revisionId) ? ['Some evaluations lack explicit revision provenance and were linked through their batch.'] : []),
    ...(allEvaluations.some(item => item.predictedOutcome) ? ['Predicted outcomes are separate from observed or measured evidence.'] : []),
    ...(allEvaluations.some(item => item.aiSuggestions.length) ? ['AI-generated suggestions are separate from recorded observations.'] : []),
    ...missingEvidence
  ];
  return {
    leftRevisionId: left.id,
    rightRevisionId: right.id,
    sameExperiment: left.experimentId === right.experimentId,
    ingredientChanges,
    leftBatches,
    rightBatches,
    leftBatchTotals,
    rightBatchTotals,
    leftBatchEvidence: leftBatchTotals,
    rightBatchEvidence: rightBatchTotals,
    leftEvaluations,
    rightEvaluations,
    conditionsCompatible: conditionChanges.length === 0,
    conditionDifferences: conditionChanges,
    missingEvidence,
    warnings: [...new Set(warnings)],
    summary: {
      whatChanged: ingredientChanges,
      whatWasObserved: allEvaluations,
      cannotConclude: [...new Set(['Recorded differences do not establish causation or a winning formula.', ...warnings.filter(item => item.includes('controlled trial') || item.includes('Predicted') || item.includes('AI-generated') || item.includes('No evaluation'))])]
    }
  };
}

export function compareQuantities(left, right, { unit, density } = {}) {
  if (left === undefined || right === undefined) return { status: 'insufficient-data' };
  const targetUnit = unit || left.unit || right.unit; validateUnit(targetUnit);
  try { return { status: 'comparable', delta: convertQuantity(right.amount, right.unit, targetUnit, { density }) - convertQuantity(left.amount, left.unit, targetUnit, { density }), unit: targetUnit }; } catch (error) { return { status: 'incompatible', reason: error.message }; }
}
