import { calculateBatchTotals } from './calculations.mjs';
import { compareRevisions } from './comparison.mjs';
import { compareBatchToPlan, experimentDesignReview, maturationPlanTimeline } from './store.mjs';

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
  context.maturation.forEach(item => check(item.plan.name, [item.sourceId, item.batchId ? sourceId('batch', item.batchId) : null].filter(Boolean)));
  context.designs.forEach(item => check(item.design.name, [item.sourceId, ...item.runSourceIds]));
  return invalid;
}

function selectedBatchIds(context) { return new Set(context.batches.map(item => item.batchId)); }

function maturationEvidence(state, experiment, batchIds) {
  const plans = array(state.maturationPlans).filter(plan => plan.experimentId === experiment.id && (!batchIds.size || batchIds.has(plan.batchId)));
  return plans.map(plan => {
    let timeline;
    try { timeline = maturationPlanTimeline(state, plan.id); } catch (error) { return { sourceId: sourceId('maturation-plan', plan.id), plan: { ...plan }, batchId: plan.batchId, observations: [], evidenceStatus: 'unavailable', warnings: [`Maturation timeline unavailable: ${error.message}`] }; }
    const observations = timeline.observations.map(observation => ({ sourceId: sourceId('maturation-observation', observation.id), id: observation.id, checkpointId: observation.checkpointId, observedAt: observation.observedAt, elapsedMinutes: observation.elapsedMinutes, appearance: text(observation.appearance), color: text(observation.color), clarity: text(observation.clarity), sediment: text(observation.sediment), phaseSeparation: text(observation.phaseSeparation), viscosity: text(observation.viscosity), subjectiveOdour: text(observation.subjectiveOdour), deviations: text(observation.deviations), storageLocation: text(observation.storageLocation), containerType: text(observation.containerType), lightExposure: text(observation.lightExposure), measuredValues: array(observation.measuredValues), evidenceStatus: observation.evidenceStatus || 'complete' }));
    return { sourceId: sourceId('maturation-plan', plan.id), plan: { ...plan, batchId: plan.batchId }, batchId: plan.batchId, experimentId: plan.experimentId, revisionId: plan.revisionId, evidenceStatus: timeline.evidenceStatus, baseline: timeline.baseline ? sourceId('maturation-observation', timeline.baseline.id) : null, observations, checkpoints: timeline.checkpoints.map(item => ({ sourceId: sourceId('maturation-checkpoint', item.checkpoint.id), id: item.checkpoint.id, label: item.checkpoint.label, plannedAt: item.plannedAt, status: item.status })), warnings: timeline.checkpoints.filter(item => item.status !== 'completed').map(item => `${item.checkpoint.label} is ${item.status}.`) };
  });
}

function designEvidence(state, experiment) {
  return array(state.experimentDesigns).filter(design => design.experimentId === experiment.id).map(design => {
    try {
      const review = experimentDesignReview(state, design.id);
      const runSourceIds = review.runs.map(run => sourceId('design-run', run.id));
      return { sourceId: sourceId('experiment-design', design.id), design: { id: design.id, name: design.name, researchQuestion: design.researchQuestion, hypothesis: design.hypothesis, controlledConditions: design.controlledConditions || '', protocol: design.protocol || '' }, runSourceIds, review: { warnings: review.warnings, canCompare: review.canCompare, conditions: review.conditions.map(item => ({ sourceId: sourceId('design-condition', item.condition.id), id: item.condition.id, name: item.condition.name, plannedReplicates: item.plannedReplicates, completedReplicates: item.completedReplicates, warnings: item.warnings, responses: item.responses.map(response => ({ name: response.response.name, kind: response.response.kind, unit: response.response.unit, summary: response.summary, warning: response.warning })) })), runs: review.runs.map(run => ({ sourceId: sourceId('design-run', run.id), id: run.id, conditionId: run.conditionId, replicateNumber: run.replicateNumber, status: run.status, batchId: run.batchId, deviationReason: text(run.deviationReason), responseValues: array(run.responseValues) })) } };
    } catch (error) {
      return { sourceId: sourceId('experiment-design', design.id), design: { id: design.id, name: design.name, researchQuestion: design.researchQuestion, hypothesis: design.hypothesis }, runSourceIds: [], review: { warnings: [`Experiment design review unavailable: ${error.message}`], canCompare: false, conditions: [], runs: [] } };
    }
  });
}

function measurementEvidence(state, experiment, batchIds) {
  const measurements = array(state.measurements).filter(item => (item.experimentId === experiment.id || (item.batchId && batchIds.has(item.batchId)) || (item.evaluationId && state.evaluations?.some(evaluation => evaluation.id === item.evaluationId && evaluation.experimentId === experiment.id))));
  return measurements.map(item => ({ sourceId: sourceId('measurement', item.id), id: item.id, batchId: item.batchId, equipmentId: item.equipmentId, quantityType: item.quantityType, value: item.value, unit: item.unit, measuredAt: item.measuredAt, method: text(item.method), conditions: text(item.conditions), notes: text(item.notes) }));
}

function blindEvidence(state, experiment, batchIds) {
  return array(state.blindSessions).flatMap(session => {
    const samples = array(state.blindSamples).filter(sample => sample.sessionId === session.id && sample.experimentId === experiment.id && (!batchIds.size || batchIds.has(sample.batchId)));
    if (!samples.length) return [];
    const revealed = session.status === 'unblinded';
    return [{ sourceId: sourceId('blind-session', session.id), id: session.id, status: session.status, identitiesRevealed: revealed, sampleCount: samples.length, samples: samples.map(sample => ({ sourceId: sourceId('blind-sample', sample.id), id: sample.id, blindCode: sample.blindCode, batchId: revealed ? sample.batchId : undefined, revisionId: revealed ? sample.revisionId : undefined })) }];
  });
}

export function buildExperimentCoachContext(state, { experimentId, batchId, revisionId } = {}) {
  const experiment = state.experiments?.find(item => item.id === experimentId);
  if (!experiment) throw new Error('An experiment is required for the Coach context.');
  const revisions = sorted(state.revisions?.filter(item => (experiment.formulaRevisionIds || []).includes(item.id)), 'revision');
  const selectedRevision = revisionId ? revisions.find(item => item.id === revisionId) : null;
  const batches = sorted(state.batches?.filter(item => (experiment.batchIds || []).includes(item.id) && (!batchId || item.id === batchId)));
  const evaluations = sorted(state.evaluations?.filter(item => (experiment.evaluationIds || []).includes(item.id) && (!batchId || item.batchId === batchId)), 'evaluatedAt');
  const journalEntries = state.journalEntries?.filter(item => item.experimentId === experiment.id) || [];
  const selectedBatchSet = new Set(batches.map(item => item.id));
  const maturation = maturationEvidence(state, experiment, selectedBatchSet);
  const designs = designEvidence(state, experiment);
  const measurements = measurementEvidence(state, experiment, selectedBatchSet);
  const blind = blindEvidence(state, experiment, selectedBatchSet);
  const revisionSources = revisions.map(item => source('revision', item, `Revision ${item.revision}: ${revisionMaterialText(state, item)}`));
  const batchSources = batches.map(item => source('batch', item, `Batch ${item.batchCode}: planned ${item.plannedAmount} ${item.unit}`));
  const blindSessionById = new Map(blind.map(item => [item.id, item]));
  const evaluationSources = evaluations.map(item => {
    const session = item.blindSessionId ? blindSessionById.get(item.blindSessionId) : null;
    const hidden = session && !session.identitiesRevealed;
    return source('evaluation', item, `${item.intervalLabel || 'Evaluation'}: ${hidden ? `blind sample ${item.blindCode || 'code hidden'}` : (text(item.subjectiveNotes) || text(item.measuredResults) || 'No result text recorded.')}`, hidden ? { blindIdentityHidden: true } : {});
  });
  const journalSources = journalEntries.map(item => source('journal', item, `${item.title}: ${text(item.overall) || text(item.opening) || 'No summary recorded.'}`));
  const maturationSources = maturation.flatMap(plan => [source('maturation-plan', { id: plan.plan.id }, `${plan.plan.name}: ${plan.evidenceStatus}`), ...plan.observations.map(item => source('maturation-observation', { id: item.id }, `${item.observedAt}: ${item.appearance || item.subjectiveOdour || 'Observation recorded.'}`)), ...plan.checkpoints.map(item => source('maturation-checkpoint', { id: item.id }, `${item.label}: ${item.status}`))]);
  const designSources = designs.flatMap(item => [source('experiment-design', { id: item.design.id }, `${item.design.name}: ${item.design.researchQuestion}`), ...item.review.conditions.map(condition => source('design-condition', { id: condition.id }, `${condition.name}: ${condition.completedReplicates}/${condition.plannedReplicates} completed`)), ...item.review.runs.map(run => source('design-run', { id: run.id }, `${run.id}: ${run.status}`))]);
  const measurementSources = measurements.map(item => source('measurement', item, `${item.quantityType}: ${item.value} ${item.unit}`));
  const blindSources = blind.map(item => source('blind-session', item, `${item.status}: ${item.sampleCount} sample${item.sampleCount === 1 ? '' : 's'}${item.identitiesRevealed ? '; identities explicitly revealed.' : '; identities remain hidden.'}`));
  const sources = [...revisionSources, ...batchSources, ...evaluationSources, ...journalSources, ...maturationSources, ...designSources, ...measurementSources, ...blindSources];
  const context = {
    experiment: { sourceId: sourceId('experiment', experiment.id), id: experiment.id, experimentId: experiment.experimentId, title: experiment.title, objective: experiment.objective || '', status: experiment.status },
    revisions: revisions.map(item => ({ sourceId: sourceId('revision', item.id), id: item.id, revision: item.revision, notes: text(item.notes), objective: text(item.objective), ingredients: array(item.ingredients).map(ingredient => ({ materialId: ingredient.materialId, materialName: ingredient.materialName || materialName(state, ingredient.materialId), lotId: ingredient.lotId, quantity: ingredient.quantity, unit: ingredient.unit, role: ingredient.role || '' })) })),
    batches: batches.map(item => batchEvidence(state, item)),
    evaluations: evaluations.map(item => {
      const session = item.blindSessionId ? blindSessionById.get(item.blindSessionId) : null;
      const evidence = evaluateEvidence(state, item, batches.find(batch => batch.id === item.batchId));
      return session && !session.identitiesRevealed ? { ...evidence, batchId: undefined, revisionId: undefined, blindCode: item.blindCode, blindSessionId: item.blindSessionId, identitiesRevealed: false } : { ...evidence, identitiesRevealed: true };
    }),
    journalEntries: journalEntries.map(item => ({ sourceId: sourceId('journal', item.id), id: item.id, title: item.title, purpose: text(item.purpose), opening: text(item.opening), heart: text(item.heart), dryDown: text(item.dryDown), overall: text(item.overall), descriptors: array(item.descriptors), provenance: item.provenance || 'recorded' })),
    maturation,
    designs,
    measurements,
    blind,
    revisionComparisons: adjacentRevisionComparisons(state, revisions),
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
  context.maturation.forEach(item => item.warnings.forEach(warning => context.missingEvidence.push({ sourceId: item.sourceId, warning })));
  context.designs.forEach(item => item.review.warnings.forEach(warning => context.missingEvidence.push({ sourceId: item.sourceId, warning })));
  context.blind.filter(item => !item.identitiesRevealed).forEach(item => context.missingEvidence.push({ sourceId: item.sourceId, warning: 'Blind sample identities remain hidden until the existing explicit unblind action.' }));
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
  const baseSources = [context.experiment.sourceId, ...context.revisions.slice(-1).map(item => item.sourceId)].filter(Boolean);
  const baseline = context.evaluations.find(item => item.provenance === 'measured') || context.evaluations[0];
  const latestRevisionComparison = context.revisionComparisons?.find(item => item.ingredientChanges?.length) || null;
  const deviatedBatch = context.batches.find(item => item.plan?.missingAdditions?.length || item.plan?.extraAdditions?.length || item.plan?.quantityDeviations?.length || item.deviations);
  const incompleteDesign = context.designs.find(item => item.review.warnings.length || item.review.conditions.some(condition => condition.completedReplicates < condition.plannedReplicates));
  const changedMaturation = context.maturation.find(item => ['Change observed', 'Incomplete evidence'].includes(item.evidenceStatus) && item.observations.length > 0);
  let why = 'The existing records do not yet isolate a stronger experiment-specific next step.';
  let evidence = baseSources;
  let variable = 'One formula ingredient quantity or role, selected from the next immutable revision; do not change multiple ingredients in the same experiment.';
  let recordNext = 'Record the named response at the same observation intervals, with actual additions and conditions linked to the physical batch.';
  let limitations = ['This is a proposed hypothesis, not a recorded result.', 'The available evidence does not establish causality or statistical significance.'];
  let schedule = ['opening (0–15 minutes)', '24 hours', '7 days'];
  if (incompleteDesign) {
    const condition = incompleteDesign.review.conditions.find(item => item.completedReplicates < item.plannedReplicates) || incompleteDesign.review.conditions[0];
    why = `The recorded experiment design ${incompleteDesign.design.name} has ${condition ? `${condition.plannedReplicates - condition.completedReplicates} incomplete replicate(s) for ${condition.name}` : 'incomplete or non-comparable runs'}; complete or repeat the planned run before changing the formula.`;
    evidence = [incompleteDesign.sourceId, ...incompleteDesign.runSourceIds];
    variable = `Complete the missing independent replicate for ${condition?.name || 'the affected condition'} using the planned factor levels before introducing another factor change.`;
    recordNext = 'Link the actual physical batch, record the execution status, response values, and any deviation reason for the missing run.';
    limitations = [...limitations, ...incompleteDesign.review.warnings];
  } else if (deviatedBatch) {
    why = `${deviatedBatch.batchCode} has recorded actual-versus-planned differences or deviations; a formulation conclusion should wait for a run that documents the intended execution.`;
    evidence = [deviatedBatch.sourceId];
    variable = 'Repeat the same immutable formula revision with actual additions matching the planned condition, changing no other factor unless explicitly documented.';
    recordNext = 'Record each actual addition, lot, quantity, procedure condition, and the same sensory or measured response used for the deviated run.';
    limitations = [...limitations, 'The prior batch is not a clean execution of the planned condition.'];
  } else if (latestRevisionComparison) {
    why = `Revisions ${latestRevisionComparison.leftRevisionId} and ${latestRevisionComparison.rightRevisionId} differ in recorded ingredient lines, but the current evidence does not isolate which difference caused any observed change.`;
    evidence = latestRevisionComparison.sourceIds;
    variable = 'Compare the two existing immutable revisions in matched physical batches, or create one new revision changing only the named ingredient difference.';
    recordNext = 'Use the same evaluator, medium, application amount, timing, and response definition, then record both subjective and measured evidence separately.';
    limitations = [...limitations, ...(latestRevisionComparison.warnings || []), 'Observed revision differences are not causal evidence.'];
  } else if (changedMaturation) {
    const observation = changedMaturation.observations.at(-1);
    why = `The maturation plan ${changedMaturation.plan.name} contains a recorded ${changedMaturation.evidenceStatus.toLowerCase()} observation; follow-up should distinguish continued change from a one-time observation.`;
    evidence = [changedMaturation.sourceId, observation?.sourceId].filter(Boolean);
    variable = 'Hold formula, container, storage location, light exposure, and handling conditions constant while repeating the next scheduled maturation checkpoint.';
    recordNext = 'Record the same appearance, clarity, colour, phase-separation, subjective odour, storage-condition, and optional measured fields at the next checkpoint.';
    schedule = changedMaturation.checkpoints.filter(item => item.status !== 'completed').slice(0, 3).map(item => item.label);
    limitations = [...limitations, ...changedMaturation.warnings, 'A maturation observation alone does not establish stability, safety, or readiness.'];
  } else if (context.measurements.length === 0 && context.evaluations.some(item => item.isMeasured === false)) {
    why = 'The experiment has subjective sensory evidence but no compatible instrument measurement linked to this context; a comparable measurement would help distinguish descriptive impressions from measured change.';
    evidence = context.evaluations.map(item => item.sourceId).slice(0, 3);
    variable = 'Keep the formula and observation conditions constant while adding one explicitly defined measured response with units and method.';
    recordNext = 'Record the instrument, unit, method, conditions, and timestamp alongside the subjective sensory observation.';
    limitations = [...limitations, 'No numerical conclusion can be drawn from the current subjective-only evidence.'];
  }
  return {
    hypothesis: claim(`Changing one selected formula variable may clarify the recorded question: ${why}`, evidence, 'hypothesis'),
    primaryVariable: claim(variable, evidence, 'hypothesis'),
    why: claim(why, evidence, 'recorded-context'),
    evidence: evidence.map(sourceIdValue => ({ sourceId: sourceIdValue, evidenceClass: 'recorded-context' })),
    controls: ['Use one physical batch tied to the exact immutable revision.', 'Keep medium, application amount, evaluator, environment, storage and observation schedule constant where practical.', 'Record actual additions separately from planned quantities.'],
    whatToRecordNext: claim(recordNext, evidence, 'proposed-protocol'),
    limitations,
    observationSchedule: schedule.map(label => ({ label, sourceIds: evidence, evidenceClass: 'proposed-protocol' })),
    successCriterion: claim(baseline ? 'Define success before mixing as a user-supplied change in one named descriptor or measured response at the scheduled checkpoints; the existing record does not establish the threshold.' : 'Define success before mixing as a user-supplied change in one named descriptor or measured response at the scheduled checkpoints; no baseline is currently available.', baseline ? [baseline.sourceId] : baseSources, 'hypothesis'),
    note: 'This is a proposed controlled experiment, not a result, safety determination, stability verdict, or stock instruction.'
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
  const contextClaims = [
    ...context.measurements.map(item => claim(`Measurement ${item.quantityType} records ${item.value} ${item.unit}${item.method ? ` by ${item.method}` : ''}.`, [item.sourceId], 'measured')),
    ...context.maturation.flatMap(item => item.observations.map(observation => claim(`Maturation checkpoint observation records ${observation.appearance || observation.subjectiveOdour || 'recorded change evidence'}${observation.deviations ? `; deviation: ${observation.deviations}` : ''}.`, [observation.sourceId, item.sourceId], 'recorded'))),
    ...context.designs.flatMap(item => item.review.conditions.map(condition => claim(`${condition.name} has ${condition.completedReplicates} completed of ${condition.plannedReplicates} planned replicate(s).`, [item.sourceId, condition.sourceId], condition.completedReplicates >= 2 ? 'recorded' : 'missing-evidence'))),
    ...context.blind.map(item => claim(`Blind session ${item.status} contains ${item.sampleCount} sample(s); ${item.identitiesRevealed ? 'identity mapping was explicitly revealed.' : 'sample identities remain hidden.'}`, [item.sourceId], item.identitiesRevealed ? 'recorded' : 'missing-evidence'))
  ];
  const missingEvidence = [...context.missingEvidence, ...context.contradictions, ...context.invalidSourceReferences];
  const debrief = {
    title: `Experiment Coach · ${context.experiment.title}`,
    experiment: context.experiment,
    claims: {
      experiment: [claim(`${context.experiment.experimentId}: ${context.experiment.title} is currently ${context.experiment.status}.`, [context.experiment.sourceId])],
      revisions: revisionClaims,
      batches: batchClaims,
      sensoryTimeline,
      revisionComparisons,
      recordedContext: contextClaims
    },
    missingEvidence,
    contradictions: context.contradictions,
    promptInjectionWarnings: context.promptInjectionWarnings,
    proposedNextExperiment: proposedExperiment(context),
    sourceIds: [...new Set([context.experiment.sourceId, ...context.sources.map(item => item.id)])],
    readOnly: true,
    disclaimer: 'Claims are limited to the supplied records. Proposed protocol elements are hypotheses, not observations or safety claims.'
  };
  const invalidClaims = debrief.claims.experiment.concat(debrief.claims.revisions, debrief.claims.batches, debrief.claims.sensoryTimeline, debrief.claims.recordedContext).flatMap(item => item.sourceIds.filter(id => !debrief.sourceIds.includes(id)));
  const proposedSourceIds = [debrief.proposedNextExperiment.hypothesis, debrief.proposedNextExperiment.primaryVariable, debrief.proposedNextExperiment.why, debrief.proposedNextExperiment.whatToRecordNext, debrief.proposedNextExperiment.successCriterion].flatMap(item => item?.sourceIds || []).filter(id => !debrief.sourceIds.includes(id));
  if (invalidClaims.length || proposedSourceIds.length) throw new Error(`Coach generated an invalid source reference: ${invalidClaims[0] || proposedSourceIds[0]}`);
  return debrief;
}
