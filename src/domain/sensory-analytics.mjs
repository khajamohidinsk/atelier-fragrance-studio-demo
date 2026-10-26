const KNOWN_RATING_DIMENSIONS = Object.freeze(['intensity', 'longevity', 'projection']);

function array(value) { return Array.isArray(value) ? value : []; }

function own(record, key) { return Object.prototype.hasOwnProperty.call(record || {}, key); }

function validRating(value) { return Number.isInteger(value) && value >= 1 && value <= 5; }

function dateMatches(value, filters) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  if (filters.dateFrom && time < Date.parse(`${filters.dateFrom}T00:00:00.000Z`)) return false;
  if (filters.dateTo && time > Date.parse(`${filters.dateTo}T23:59:59.999Z`)) return false;
  return true;
}

function evaluationMatches(evaluation, filters) {
  if (filters.sessionId && evaluation.blindSessionId !== filters.sessionId) return false;
  if (filters.sampleId && evaluation.blindSampleId !== filters.sampleId) return false;
  return dateMatches(evaluation.evaluatedAt, filters);
}

function dimensionsFor(evaluations) {
  const dimensions = new Set(KNOWN_RATING_DIMENSIONS);
  for (const evaluation of evaluations) for (const key of Object.keys(evaluation.scores || {})) dimensions.add(key);
  return [...dimensions].sort((left, right) => {
    const leftIndex = KNOWN_RATING_DIMENSIONS.indexOf(left); const rightIndex = KNOWN_RATING_DIMENSIONS.indexOf(right);
    return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right);
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function populationStandardDeviation(values, mean) {
  if (values.length < 2) return values.length ? 0 : null;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
}

function dimensionSummary(evaluations, dimension) {
  const knownScale = KNOWN_RATING_DIMENSIONS.includes(dimension);
  const present = evaluations.filter(evaluation => own(evaluation.scores, dimension));
  const valid = knownScale ? present.filter(evaluation => validRating(evaluation.scores[dimension])) : [];
  const invalid = present.length - valid.length;
  const values = valid.map(evaluation => evaluation.scores[dimension]);
  const counts = Object.fromEntries([1, 2, 3, 4, 5].map(value => [String(value), values.filter(item => item === value).length]));
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  return {
    dimension,
    scale: knownScale ? 'verified ordinal 1–5' : 'unverified scale',
    status: !knownScale && present.length ? 'not-calculated' : values.length ? 'calculated' : 'insufficient-data',
    reason: !knownScale && present.length ? 'The stored dimension is numeric but its scale is not defined as a compatible 1–5 rating.' : values.length ? '' : 'No valid 1–5 ratings were recorded for this dimension.',
    sourceEvaluationIds: valid.map(evaluation => evaluation.id),
    observedRecords: present.length,
    validRatings: values.length,
    missingRatings: evaluations.length - present.length,
    excludedRatings: invalid,
    counts,
    percentages: Object.fromEntries(Object.entries(counts).map(([rating, count]) => [rating, values.length ? count / values.length : null])),
    median: knownScale ? median(values) : null,
    range: values.length ? [Math.min(...values), Math.max(...values)] : null,
    mean: knownScale ? mean : null,
    standardDeviation: knownScale ? populationStandardDeviation(values, mean) : null
  };
}

function descriptorSummary(evaluations) {
  const counts = new Map(); let missing = 0;
  for (const evaluation of evaluations) {
    const descriptors = array(evaluation.descriptors).map(item => String(item).trim()).filter(Boolean);
    if (!descriptors.length) missing += 1;
    for (const descriptor of descriptors) {
      const key = descriptor.toLocaleLowerCase(); const previous = counts.get(key) || { descriptor, count: 0, sourceEvaluationIds: [] };
      previous.count += 1; previous.sourceEvaluationIds.push(evaluation.id); counts.set(key, previous);
    }
  }
  return { terms: [...counts.values()].sort((left, right) => right.count - left.count || left.descriptor.localeCompare(right.descriptor)), missingRecords: missing, records: evaluations.length };
}

function pairMetrics(pairs, basis, candidateRecords, excludedRecords) {
  const exact = pairs.filter(pair => pair.left === pair.right).length;
  const withinOne = pairs.filter(pair => Math.abs(pair.left - pair.right) <= 1).length;
  return {
    status: pairs.length ? 'calculated' : 'insufficient-data',
    reason: pairs.length ? '' : 'At least two valid, explicitly paired 1–5 observations are required.',
    basis,
    candidateRecords,
    excludedRecords,
    validPairs: pairs.length,
    exactAgreement: pairs.length ? exact / pairs.length : null,
    withinOnePointAgreement: pairs.length ? withinOne / pairs.length : null,
    meanAbsoluteDifference: pairs.length ? pairs.reduce((sum, pair) => sum + Math.abs(pair.left - pair.right), 0) / pairs.length : null,
    pairs
  };
}

function trialPairs(state, evaluations, dimension) {
  const selected = new Map(evaluations.map(evaluation => [evaluation.id, evaluation])); const groups = new Map(); const linked = new Set();
  for (const run of array(state.experimentDesignRuns)) {
    for (const evaluationId of array(run.sensoryEvaluationIds)) {
      const evaluation = selected.get(evaluationId); if (!evaluation) continue;
      linked.add(evaluation.id); const value = evaluation.scores?.[dimension]; const key = `${run.designId}|${run.conditionId}|${dimension}`;
      const group = groups.get(key) || []; group.push({ evaluation, run, value }); groups.set(key, group);
    }
  }
  const pairs = []; let candidates = 0; let excluded = 0;
  for (const group of groups.values()) {
    candidates += group.length;
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
      const left = group[leftIndex]; const right = group[rightIndex];
      if (left.run.replicateNumber === right.run.replicateNumber || !validRating(left.value) || !validRating(right.value)) { excluded += 1; continue; }
      pairs.push({ left: left.value, right: right.value, difference: right.value - left.value, sourceEvaluationIds: [left.evaluation.id, right.evaluation.id], replicateNumbers: [left.run.replicateNumber, right.run.replicateNumber], basis: 'experiment-design replicate links' });
    }
  }
  return { pairs, linked, candidates, excluded };
}

function repeatedBatchPairs(evaluations, dimension, linkedEvaluationIds) {
  const groups = new Map(); let candidates = 0; let excluded = 0;
  for (const evaluation of evaluations) {
    if (!evaluation.batchId || linkedEvaluationIds.has(evaluation.id)) continue;
    const value = evaluation.scores?.[dimension]; const key = `${evaluation.batchId}|${dimension}`; const group = groups.get(key) || [];
    group.push({ evaluation, value }); groups.set(key, group);
  }
  const pairs = [];
  for (const group of groups.values()) {
    candidates += group.length;
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
      const left = group[leftIndex]; const right = group[rightIndex];
      if (!validRating(left.value) || !validRating(right.value)) { excluded += 1; continue; }
      pairs.push({ left: left.value, right: right.value, difference: right.value - left.value, sourceEvaluationIds: [left.evaluation.id, right.evaluation.id], basis: 'repeated physical-batch link' });
    }
  }
  return { pairs, candidates, excluded };
}

function repeatabilitySummary(state, evaluations, dimensions) {
  const byDimension = dimensions.map(dimension => {
    const trial = trialPairs(state, evaluations, dimension); const fallback = repeatedBatchPairs(evaluations, dimension, trial.linked);
    const source = trial.pairs.length ? trial : fallback; const basis = trial.pairs.length ? 'Explicit experiment-design replicate links.' : fallback.pairs.length ? 'Repeated evaluations share an explicit physical-batch link; evaluator and trial identity are unavailable.' : 'No explicit replicate or repeated physical-batch pairing produced two valid ratings.';
    return { dimension, ...pairMetrics(source.pairs, basis, trial.candidates + fallback.candidates, trial.excluded + fallback.excluded) };
  });
  return { dimensions: byDimension, limitations: ['Repeatability is descriptive agreement between explicitly linked observations, not chemical measurement accuracy.', 'Evaluator identity is not stored per evaluation, so within-evaluator consistency is not calculated.'] };
}

function maturationAnalytics(state, filters) {
  const plans = array(state.maturationPlans).filter(plan => !filters.maturationPlanId || plan.id === filters.maturationPlanId);
  const checkpoints = array(state.maturationCheckpoints); const observations = array(state.maturationObservations).filter(observation => plans.some(plan => plan.id === observation.planId) && (!filters.checkpointId || observation.checkpointId === filters.checkpointId) && dateMatches(observation.observedAt, filters));
  const summaries = plans.flatMap(plan => array(plan.checkpointIds).map(checkpointId => {
    const checkpoint = checkpoints.find(item => item.id === checkpointId); if (!checkpoint) return null;
    const rows = observations.filter(observation => observation.planId === plan.id && observation.checkpointId === checkpoint.id); const descriptorCounts = new Map();
    for (const row of rows) for (const descriptor of array(row.descriptors)) { const key = String(descriptor).trim().toLocaleLowerCase(); if (key) descriptorCounts.set(key, (descriptorCounts.get(key) || 0) + 1); }
    return { planId: plan.id, planName: plan.name, checkpointId: checkpoint.id, checkpointLabel: checkpoint.label, plannedAt: checkpoint.plannedAt, observedRecords: rows.length, missingObservation: rows.length === 0, incompleteEvidence: rows.filter(row => row.evidenceStatus === 'incomplete').length, descriptors: [...descriptorCounts.entries()].sort((left, right) => right[1] - left[1]).map(([descriptor, count]) => ({ descriptor, count })), sourceObservationIds: rows.map(row => row.id), subjectiveRecords: rows.filter(row => [row.appearance, row.color, row.clarity, row.phaseSeparation, row.viscosity, row.subjectiveOdour, row.notes].some(value => String(value || '').trim())).length };
  }).filter(Boolean));
  return { plans: plans.map(plan => ({ id: plan.id, name: plan.name })), checkpoints: summaries, observedRecords: observations.length, missingCheckpoints: summaries.filter(item => item.missingObservation).length, ratingTrend: { status: 'not-calculated', reason: 'Maturation observations do not store linked sensory rating dimensions, so no paired rating trend is inferred.' }, limitations: ['Checkpoint summaries use recorded subjective fields and descriptors only.', 'Absent checkpoints remain missing; no interpolation or zero values are inserted.'] };
}

export function analyticsFilterOptions(state) {
  const sessions = array(state.blindSessions).map(session => ({ id: session.id, label: session.name }));
  const samples = array(state.blindSamples).filter(sample => sample.blindCode).map(sample => ({ id: sample.id, label: sample.blindCode }));
  const plans = array(state.maturationPlans).map(plan => ({ id: plan.id, label: plan.name }));
  const checkpoints = array(state.maturationCheckpoints).map(checkpoint => ({ id: checkpoint.id, label: checkpoint.label }));
  return { sessions, samples, plans, checkpoints, dimensions: [...KNOWN_RATING_DIMENSIONS] };
}

export function buildSensoryPanelAnalytics(state, filters = {}) {
  const normalizedFilters = { sessionId: '', sampleId: '', dimension: '', dateFrom: '', dateTo: '', maturationPlanId: '', checkpointId: '', ...filters };
  const allEvaluations = array(state.evaluations); const evaluations = allEvaluations.filter(evaluation => evaluationMatches(evaluation, normalizedFilters));
  const dimensions = dimensionsFor(evaluations); const selectedDimensions = normalizedFilters.dimension ? dimensions.filter(dimension => dimension === normalizedFilters.dimension) : dimensions;
  const ratingDimensions = selectedDimensions.map(dimension => dimensionSummary(evaluations, dimension));
  const sessions = new Set(evaluations.map(evaluation => evaluation.blindSessionId).filter(Boolean)); const samples = new Set(evaluations.map(evaluation => evaluation.blindSampleId).filter(Boolean));
  const trialLinks = new Set(array(state.experimentDesignRuns).filter(run => array(run.sensoryEvaluationIds).some(id => evaluations.some(evaluation => evaluation.id === id))).map(run => run.id));
  const validRatingRecords = ratingDimensions.reduce((sum, item) => sum + item.validRatings, 0); const missingRatingRecords = ratingDimensions.reduce((sum, item) => sum + item.missingRatings, 0); const excludedRatingRecords = ratingDimensions.reduce((sum, item) => sum + item.excludedRatings, 0);
  return {
    filters: normalizedFilters,
    scope: { evaluations: evaluations.length, sessions: sessions.size, codedSamples: samples.size, trials: trialLinks.size, evaluators: { available: false, count: null, reason: 'The stored model has one optional session evaluator label, not an evaluator identity per evaluation.' }, unassignedEvaluations: evaluations.filter(evaluation => !evaluation.blindSessionId).length },
    coverage: { validRatingRecords, missingRatingRecords, excludedRatingRecords, descriptorRecords: descriptorSummary(evaluations).records, missingDescriptors: descriptorSummary(evaluations).missingRecords },
    ratingDimensions,
    descriptors: descriptorSummary(evaluations),
    agreement: { status: 'not-calculated', exactAgreement: null, withinOnePointAgreement: null, validPairs: 0, reason: 'Evaluator identity is not stored per evaluation, so panel evaluator agreement cannot be paired without inventing identities.', limitations: ['Agreement is not correctness or proof of quality.'] },
    repeatability: repeatabilitySummary(state, evaluations, selectedDimensions),
    maturation: maturationAnalytics(state, normalizedFilters),
    sourceEvaluationIds: evaluations.map(evaluation => evaluation.id),
    limitations: ['Numeric values are treated as ratings only for the explicitly supported integer 1–5 dimensions: intensity, longevity, and projection.', 'Subjective descriptors and text remain separate from numeric ratings and instrumental measurements.', 'Derived summaries are calculated in memory from source records and are not persisted.']
  };
}

export { KNOWN_RATING_DIMENSIONS };
