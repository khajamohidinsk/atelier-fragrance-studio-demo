import { calculateBatchTotals } from './calculations.mjs';
import { compareRevisions } from './comparison.mjs';
import { compareBatchToPlan } from './store.mjs';

const COACH_EVIDENCE_LIMIT = 1600;
const INSTRUCTION_LIKE_TEXT = /\b(ignore|disregard|override|system message|developer message|assistant|prompt injection|follow these instructions)\b/i;

const array = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const sourceId = (kind, id) => `${kind}:${id}`;
const source = (kind, record, summary, extra = {}) => ({ id: sourceId(kind, record.id), kind, recordId: record.id, summary: String(summary || '').slice(0, COACH_EVIDENCE_LIMIT), ...extra });

function sorted(items, dateKey = 'createdAt') {
  return [...items].sort((a, b) => String(a[dateKey] || '').localeCompare(String(b[dateKey] || '')) || String(a.id).localeCompare(String(b.id)));
}

function materialName(state, materialId) {
  return state.materials?.find(item => item.id === materialId)?.name || materialId;
}

function revisionMaterialText(state, revision) {
  return array(revision.ingredients).map(item => `${item.materialName || materialName(state, item.materialId)} ${item.quantity} ${item.unit}`).join(', ') || 'No ingredients recorded.';
}

function inspectInstructionLikeText(value, sourceRef) {
  return INSTRUCTION_LIKE_TEXT.test(text(value)) ? [{ sourceId: sourceRef, warning: 'Instruction-like text was treated as quoted observation text, not as an instruction.' }] : [];
}

function invalidQuantity(value, label, sourceRef) {
  return typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ? [{ sourceId: sourceRef, warning: `${label} is missing or invalid; no arithmetic was inferred.` }] : [];
}

function evaluateEvidence(state, evaluation, batch) {
  const ref = sourceId('evaluation', evaluation.id);
  const contradictions = [];
  if (evaluation.batchId && (!batch || batch.id !== evaluation.batchId)) contradictions.push({ sourceId: ref, warning: 'Evaluation batch reference does not resolve to the selected experiment.' });
  if (batch && evaluation.revisionId && evaluation.revisionId !== batch.formulaRevisionId) contradictions.push({ sourceId: ref, warning: 'Evaluation revision does not match its batch revision.' });
  if (evaluation.elapsedMinutes !== undefined && (typeof evaluation.elapsedMinutes !== 'number' || !Number.isFinite(evaluation.elapsedMinutes) || evaluation.elapsedMinutes < 0)) contradictions.push({ sourceId: ref, warning: 'Elapsed time is invalid.' });
  if (evaluation.isMeasured && !text(evaluation.measuredResults)) contradictions.push({ sourceId: ref, warning: 'Evaluation is marked measured but has no measured result text.' });
  if (!evaluation.isMeasured && text(evaluation.measuredResults)) contradictions.push({ sourceId: ref, warning: 'Measured result text is present while the evaluation is not marked measured.' });
  if (evaluation.provenance === 'measured' && !evaluation.isMeasured) contradictions.push({ sourceId: ref, warning: 'Measured provenance conflicts with the measured flag.' });
  const instructionWarnings = [evaluation.subjectiveNotes, evaluation.measuredResults, evaluation.predictedOutcome, evaluation.conclusions, evaluation.nextSteps].flatMap(value => inspectInstructionLikeText(value, ref));
  return {
    sourceId: ref,
    batchId: evaluation.batchId,
    revisionId: evaluation.revisionId,
    evaluatedAt: evaluation.evaluatedAt,
    elapsedMinutes: evaluation.elapsedMinutes,
    intervalLabel: evaluation.intervalLabel || 'Unlabelled interval',
    medium: evaluation.medium || 'Unknown medium',
    environment: evaluation.environment || 'Unknown environment',
    conditions: evaluation.conditions || 'Conditions not recorded',
    descriptors: array(evaluation.descriptors),
    subjectiveNotes: text(evaluation.subjectiveNotes),
    measuredResults: text(evaluation.measuredResults),
    predictedOutcome: text(evaluation.predictedOutcome),
    conclusions: text(evaluation.conclusions),
    nextSteps: text(evaluation.nextSteps),
    provenance: evaluation.provenance || (evaluation.isMeasured ? 'measured' : 'subjective'),
    isMeasured: evaluation.isMeasured === true,
    contradictions: [...contradictions, ...instructionWarnings]
  };
}

function batchEvidence(state, batch) {
  const ref = sourceId('batch', batch.id);
  const contradictions = [...invalidQuantity(batch.plannedAmount, 'Planned batch quantity', ref)];
  let plan = null;
  try { plan = compareBatchToPlan(state, batch.id); } catch (error) { contradictions.push({ sourceId: ref, warning: `Planned-versus-actual comparison unavailable: ${error.message}` }); }
  let actual = null;
  if (!array(batch.actualAdditions).length) contradictions.push({ sourceId: ref, warning: 'No actual additions are recorded; a formula revision is not proof that this batch was mixed.' });
  else {
    for (const addition of batch.actualAdditions) contradictions.push(...invalidQuantity(addition.amount, `Actual addition ${addition.id} quantity`, sourceId('addition', addition.id)));
    try { actual = calculateBatchTotals(batch.actualAdditions, { unit: batch.unit }); } catch (error) { contradictions.push({ sourceId: ref, warning: `Actual addition totals unavailable: ${error.message}` }); }
  }
  return { sourceId: ref, batchId: batch.id, batchCode: batch.batchCode, revisionId: batch.formulaRevisionId, mixingDate: batch.mixingDate || batch.createdAt, plannedAmount: batch.plannedAmount, plannedUnit: batch.unit, actual, plan, deviations: text(batch.deviations), observations: text(batch.observations), contradictions };
}

function adjacentRevisionComparisons(state, revisions) {
  const result = [];
  for (let index = 1; index < revisions.length; index += 1) {
    const left = revisions[index - 1]; const right = revisions[index];
    try {
      const comparison = compareRevisions(state, left.id, right.id);
      result.push({ leftRevisionId: left.id, rightRevisionId: right.id, sourceIds: [sourceId('revision', left.id), sourceId('revision', right.id)], ingredientChanges: comparison.ingredientChanges, warnings: comparison.warnings, missingEvidence: comparison.missingEvidence });
    } catch (error) {
      result.push({ leftRevisionId: left.id, rightRevisionId: right.id, sourceIds: [sourceId('revision', left.id), sourceId('revision', right.id)], ingredientChanges: [], warnings: [`Revision comparison unavailable: ${error.message}`], missingEvidence: ['Revision comparison could not be completed.'] });
    }
  }
  return result;
}

function sourceIntegrity(context) {
  const known = new Set(context.sources.map(item => item.id));
  const invalid = [];
  const check = (claim, ids = []) => ids.forEach(id => { if (!known.has(id)) invalid.push({ claim, sourceId: id, warning: 'Claim references a source that is not present in the context.' }); });
  context.revisions.forEach(item => check(`revision:${item.revision}`, [item.sourceId]));
  context.batches.forEach(item => check(`batch:${item.batchCode}`, [item.sourceId]));
  context.evaluations.forEach(item => check(item.intervalLabel, [item.sourceId, item.batchId ? sourceId('batch', item.batchId) : null].filter(Boolean)));
  return invalid;
}

export function buildExperimentCoachContext(state, { experimentId, batchId, revisionId } = {}) {
  const experiment = state.experiments?.find(item => item.id === experimentId);
  if (!experiment) throw new Error('An experiment is required for the Coach context.');
  const revisions = sorted(state.revisions?.filter(item => (experiment.formulaRevisionIds || []).includes(item.id)), 'revision');
  const selectedRevision = revisionId ? revisions.find(item => item.id === revisionId) : null;
  const batches = sorted(state.batches?.filter(item => (experiment.batchIds || []).includes(item.id) && (!batchId || item.id === batchId)));
  const evaluations = sorted(state.evaluations?.filter(item => (experiment.evaluationIds || []).includes(item.id) && (!batchId || item.batchId === batchId)), 'evaluatedAt');
  const journalEntries = state.journalEntries?.filter(item => item.experimentId === experiment.id) || [];
  const revisionSources = revisions.map(item => source('revision', item, `Revision ${item.revision}: ${revisionMaterialText(state, item)}`));
  const batchSources = batches.map(item => source('batch', item, `Batch ${item.batchCode}: planned ${item.plannedAmount} ${item.unit}`));
  const evaluationSources = evaluations.map(item => source('evaluation', item, `${item.intervalLabel || 'Evaluation'}: ${text(item.subjectiveNotes) || text(item.measuredResults) || 'No result text recorded.'}`));
  const journalSources = journalEntries.map(item => source('journal', item, `${item.title}: ${text(item.overall) || text(item.opening) || 'No summary recorded.'}`));
  const sources = [...revisionSources, ...batchSources, ...evaluationSources, ...journalSources];
  const context = {
    experiment: { sourceId: sourceId('experiment', experiment.id), id: experiment.id, experimentId: experiment.experimentId, title: experiment.title, objective: experiment.objective || '', status: experiment.status },
    revisions: revisions.map(item => ({ sourceId: sourceId('revision', item.id), id: item.id, revision: item.revision, notes: text(item.notes), objective: text(item.objective), ingredients: array(item.ingredients).map(ingredient => ({ materialId: ingredient.materialId, materialName: ingredient.materialName || materialName(state, ingredient.materialId), lotId: ingredient.lotId, quantity: ingredient.quantity, unit: ingredient.unit, role: ingredient.role || '' })) })),
    batches: batches.map(item => batchEvidence(state, item)),
    evaluations: evaluations.map(item => evaluateEvidence(state, item, batches.find(batch => batch.id === item.batchId))),
    journalEntries: journalEntries.map(item => ({ sourceId: sourceId('journal', item.id), id: item.id, title: item.title, purpose: text(item.purpose), opening: text(item.opening), heart: text(item.heart), dryDown: text(item.dryDown), overall: text(item.overall), descriptors: array(item.descriptors), provenance: item.provenance || 'recorded' })),
    selectedRevisionId: selectedRevision?.id || null,
    sources: [source('experiment', experiment, `${experiment.experimentId}: ${experiment.title}`), ...sources],
    missingEvidence: [],
    contradictions: [],
    promptInjectionWarnings: [],
    state
  };
  if (!context.revisions.length) context.missingEvidence.push({ sourceId: context.experiment.sourceId, warning: 'No immutable formula revisions are linked to this experiment.' });
  if (!context.batches.length) context.missingEvidence.push({ sourceId: context.experiment.sourceId, warning: 'No physical batch is linked to this experiment.' });
  if (!context.evaluations.length) context.missingEvidence.push({ sourceId: context.experiment.sourceId, warning: 'No sensory evaluations are linked to this experiment.' });
  context.contradictions.push(...context.batches.flatMap(item => item.contradictions), ...context.evaluations.flatMap(item => item.contradictions));
  context.revisions.forEach(revision => revision.ingredients.forEach(ingredient => context.contradictions.push(...invalidQuantity(ingredient.quantity, `Formula ingredient ${ingredient.materialId} quantity`, revision.sourceId))));
  context.promptInjectionWarnings.push(...context.evaluations.flatMap(item => item.contradictions.filter(warning => warning.warning.includes('Instruction-like'))));
  context.sources.push(...context.batches.flatMap(item => array(item.plan?.rows).map(row => ({ id: `batch-plan:${item.batchId}:${row.key}`, kind: 'batch-plan', recordId: item.batchId, summary: `${row.materialName}: planned ${row.amount} ${row.unit}, actual ${row.actualAmount}` }))));
  context.invalidSourceReferences = sourceIntegrity(context);
  return context;
}

function claim(textValue, sourceIds, evidenceClass = 'recorded') {
  return { text: textValue, sourceIds: [...new Set(sourceIds)], evidenceClass };
}

function proposedExperiment(context) {
  const sourceIds = [context.experiment.sourceId, ...context.revisions.slice(-1).map(item => item.sourceId)].filter(Boolean);
  const baseline = context.evaluations.find(item => item.provenance === 'measured') || context.evaluations[0];
  const schedule = ['opening (0–15 minutes)', '24 hours', '7 days'];
  return {
    hypothesis: claim('Changing one selected formula variable while holding batch size, application medium, evaluator, and observation schedule constant may change the recorded sensory outcome.', sourceIds, 'hypothesis'),
    primaryVariable: claim('One formula ingredient quantity or role, selected from the next immutable revision; do not change multiple ingredients in the same experiment.', sourceIds, 'hypothesis'),
    controls: ['Use one physical batch tied to the exact immutable revision.', 'Keep medium, application amount, evaluator, environment, and schedule constant where practical.', 'Record actual additions separately from planned quantities.'],
    observationSchedule: schedule.map(label => ({ label, sourceIds, evidenceClass: 'proposed-protocol' })),
    successCriterion: claim(baseline ? 'Define success before mixing as a pre-specified change in one named descriptor or measured observation at the scheduled checkpoints; the existing record does not establish the threshold.' : 'Define success before mixing as a pre-specified change in one named descriptor or measured observation at the scheduled checkpoints; no baseline is currently available.', baseline ? [baseline.sourceId] : sourceIds, 'hypothesis'),
    note: 'This is a proposed controlled experiment, not a result or safety determination.'
  };
}

export function createExperimentCoachDebrief(context) {
  if (!context?.experiment?.sourceId) throw new Error('A valid Coach context is required.');
  const revisionComparisons = adjacentRevisionComparisons(context.state, context.revisions);
  const revisionClaims = context.revisions.map(item => claim(`Revision ${item.revision} records ${item.ingredients.length} ingredient line${item.ingredients.length === 1 ? '' : 's'}: ${item.ingredients.map(ingredient => `${ingredient.materialName} ${ingredient.quantity} ${ingredient.unit}`).join(', ') || 'none'}.`, [item.sourceId]));
  const batchClaims = context.batches.map(item => {
    if (!item.plan) return claim(`${item.batchCode} records planned ${item.plannedAmount} ${item.plannedUnit}; actual-versus-planned evidence is unavailable.`, [item.sourceId], 'missing-evidence');
    const difference = `${item.plan.totalDifference >= 0 ? '+' : ''}${item.plan.totalDifference} ${item.plan.unit}`;
    const exceptions = [...item.plan.missingAdditions.map(row => `missing ${row.materialName}`), ...item.plan.extraAdditions.map(row => `extra ${row.materialName}`), ...item.plan.quantityDeviations.map(row => `quantity deviation ${row.materialName}`)];
    return claim(`${item.batchCode} records planned ${item.plannedAmount} ${item.plannedUnit}; actual-versus-planned total difference is ${difference}${exceptions.length ? `; exceptions: ${exceptions.join(', ')}` : ''}.`, [item.sourceId], 'measured');
  });
  const sensoryTimeline = context.evaluations.map(item => claim(`${item.intervalLabel} at ${item.elapsedMinutes ?? 'unknown'} minutes is ${item.provenance} evidence${item.subjectiveNotes ? `: ${item.subjectiveNotes}` : item.measuredResults ? `: ${item.measuredResults}` : '.'}`, [item.sourceId, item.batchId ? sourceId('batch', item.batchId) : item.sourceId], item.isMeasured ? 'measured' : item.provenance));
  const missingEvidence = [...context.missingEvidence, ...context.contradictions, ...context.invalidSourceReferences];
  const debrief = {
    title: `Experiment Coach · ${context.experiment.title}`,
    experiment: context.experiment,
    claims: {
      experiment: [claim(`${context.experiment.experimentId}: ${context.experiment.title} is currently ${context.experiment.status}.`, [context.experiment.sourceId])],
      revisions: revisionClaims,
      batches: batchClaims,
      sensoryTimeline,
      revisionComparisons
    },
    missingEvidence,
    contradictions: context.contradictions,
    promptInjectionWarnings: context.promptInjectionWarnings,
    proposedNextExperiment: proposedExperiment(context),
    sourceIds: [...new Set([context.experiment.sourceId, ...context.sources.map(item => item.id)])],
    readOnly: true,
    disclaimer: 'Claims are limited to the supplied records. Proposed protocol elements are hypotheses, not observations or safety claims.'
  };
  const invalidClaims = debrief.claims.experiment.concat(debrief.claims.revisions, debrief.claims.batches, debrief.claims.sensoryTimeline).flatMap(item => item.sourceIds.filter(id => !debrief.sourceIds.includes(id)));
  if (invalidClaims.length) throw new Error(`Coach generated an invalid source reference: ${invalidClaims[0]}`);
  return debrief;
}
