import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSensoryPanelAnalytics } from '../src/domain/sensory-analytics.mjs';
import { addBatch, createExperimentDesign, createInitialState, createMaturationPlan, recordMaturationObservation, recordSensoryEvaluation, updateExperimentDesignRun } from '../src/domain/store.mjs';

test('rating analytics preserves valid 1–5 denominators, missing values, invalid scales, descriptors, and filters', () => {
  let state = createInitialState();
  state = recordSensoryEvaluation(state, 'experiment-seed-1', { batchId: 'batch-seed-1', evaluatedAt: '2026-10-20T10:00:00.000Z', intervalLabel: 'Panel 1', scores: { intensity: 1, projection: 'strong' }, descriptors: ['Green', 'dry'] });
  state = recordSensoryEvaluation(state, 'experiment-seed-1', { batchId: 'batch-seed-1', evaluatedAt: '2026-10-21T10:00:00.000Z', intervalLabel: 'Panel 2', scores: { intensity: 6, projection: 4 }, descriptors: ['dry'] });
  const report = buildSensoryPanelAnalytics(state, { dimension: 'intensity' });
  const intensity = report.ratingDimensions[0];
  assert.equal(intensity.validRatings, 2);
  assert.equal(intensity.excludedRatings, 1);
  assert.equal(intensity.missingRatings, 0);
  assert.equal(intensity.median, 2);
  assert.equal(intensity.counts['1'], 1);
  assert.equal(intensity.counts['3'], 1);
  assert.equal(report.descriptors.terms.find(item => item.descriptor === 'dry').count, 2);
  assert.equal(report.scope.evaluations, 3);
  assert.equal(report.agreement.status, 'not-calculated');
  const filtered = buildSensoryPanelAnalytics(state, { dimension: 'projection', dateFrom: '2026-10-21', dateTo: '2026-10-21' });
  assert.equal(filtered.scope.evaluations, 1);
  assert.equal(filtered.ratingDimensions[0].validRatings, 1);
  assert.equal(filtered.ratingDimensions[0].median, 4);
  assert.equal(JSON.stringify(state).includes('analytics'), false);
});

test('repeatability uses explicit repeated physical-batch links and does not invent evaluator agreement', () => {
  let state = createInitialState();
  state = recordSensoryEvaluation(state, 'experiment-seed-1', { id: 'repeat-1', batchId: 'batch-seed-1', evaluatedAt: '2026-10-20T10:00:00.000Z', scores: { intensity: 1 } });
  state = recordSensoryEvaluation(state, 'experiment-seed-1', { id: 'repeat-2', batchId: 'batch-seed-1', evaluatedAt: '2026-10-21T10:00:00.000Z', scores: { intensity: 2 } });
  const report = buildSensoryPanelAnalytics(state, { dimension: 'intensity' });
  const repeatability = report.repeatability.dimensions[0];
  assert.equal(repeatability.status, 'calculated');
  assert.equal(repeatability.validPairs, 3);
  assert.equal(repeatability.exactAgreement, 0);
  assert.equal(repeatability.withinOnePointAgreement, 2 / 3);
  assert.match(repeatability.basis, /physical-batch/);
  assert.equal(report.agreement.validPairs, 0);
  assert.equal(report.agreement.exactAgreement, null);
});

test('maturation analytics preserves checkpoint labels, missing observations, descriptors, and no fabricated rating trend', () => {
  let state = createInitialState();
  state = createMaturationPlan(state, { id: 'analytics-plan', name: 'Analytics maturation', purpose: 'Observe checkpoint evidence.', batchId: 'batch-seed-1', maturationStartAt: '2026-10-20T00:00:00.000Z', checkpoints: [{ id: 'analytics-checkpoint-0', label: '0h', offsetMinutes: 0 }, { id: 'analytics-checkpoint-24', label: '24h', offsetMinutes: 1440 }, { id: 'analytics-checkpoint-7d', label: '7d', offsetMinutes: 10080 }] });
  state = recordMaturationObservation(state, 'analytics-plan', 'analytics-checkpoint-0', { observedAt: '2026-10-20T01:00:00.000Z', descriptors: ['bright'], subjectiveOdour: 'Fresh opening' });
  state = recordMaturationObservation(state, 'analytics-plan', 'analytics-checkpoint-24', { observedAt: '2026-10-21T01:00:00.000Z', descriptors: ['soft'], subjectiveOdour: 'Rounder drydown' });
  const report = buildSensoryPanelAnalytics(state, { maturationPlanId: 'analytics-plan' });
  assert.deepEqual(report.maturation.checkpoints.map(item => item.checkpointLabel), ['0h', '24h', '7d']);
  assert.equal(report.maturation.checkpoints.find(item => item.checkpointLabel === '7d').missingObservation, true);
  assert.equal(report.maturation.checkpoints.find(item => item.checkpointLabel === '24h').descriptors[0].descriptor, 'soft');
  assert.equal(report.maturation.ratingTrend.status, 'not-calculated');
  assert.equal(report.maturation.missingCheckpoints, 1);
});

test('analytics returns explicit insufficient-data states for empty populations', () => {
  const report = buildSensoryPanelAnalytics(createInitialState(), { sessionId: 'missing-session', dimension: 'intensity' });
  assert.equal(report.scope.evaluations, 0);
  assert.equal(report.ratingDimensions[0].status, 'insufficient-data');
  assert.equal(report.ratingDimensions[0].median, null);
  assert.equal(report.repeatability.dimensions[0].status, 'insufficient-data');
  assert.equal(report.maturation.checkpoints.length, 0);
});

// Real domain constructors establish two designs, two conditions per design, two replicates per condition.
function replicateFixture(entries) {
  let state = createInitialState();
  for (const id of ['design-a', 'design-b']) state = createExperimentDesign(state, {
    id, name: id, researchQuestion: 'Describe repeat ratings', hypothesis: 'Ratings may differ', experimentId: 'experiment-seed-1',
    factors: [{ name: 'Temperature', levels: [{ label: 'cool' }, { label: 'warm' }] }],
    conditions: ['cool', 'warm'].map(name => ({ name, revisionId: 'revision-seed-1', factorLevelIds: [name], replicateCount: 2 })),
    responses: [{ name: 'Intensity', kind: 'numeric', source: 'manual', unit: 'score' }]
  });
  const runs = state.experimentDesignRuns;
  for (const [index, scores] of entries) {
    const batchId = `analytics-batch-${index}`;
    state = addBatch(state, 'experiment-seed-1', { id: batchId, batchCode: `ANALYTICS-${index}`, formulaRevisionId: 'revision-seed-1', plannedAmount: 1, unit: 'g', actualAdditions: [{ id: `analytics-addition-${index}`, materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 1, unit: 'g', concentration: 100 }] });
    state = recordSensoryEvaluation(state, 'experiment-seed-1', { id: `rating-${index}`, batchId, revisionId: 'revision-seed-1', evaluatedAt: '2030-01-01T10:00:00.000Z', scores });
    state = updateExperimentDesignRun(state, runs[index].id, { batchId, status: 'completed', startedAt: '2030-01-01T08:00:00.000Z', completedAt: '2030-01-01T09:00:00.000Z', sensoryEvaluationIds: [`rating-${index}`] });
  }
  return state;
}

function repeatResult(state, dimension = 'intensity') {
  return buildSensoryPanelAnalytics(state, { dimension, dateFrom: '2030-01-01' }).repeatability.dimensions[0];
}

test('unsupported numeric-looking scales stay unverified for batch and design repeatability', () => {
  const design = replicateFixture([[0, { unfamiliar: 3, intensity: 3 }], [1, { unfamiliar: 4, intensity: 4 }]]);
  const batch = createInitialState();
  batch.evaluations = [0, 1].map(index => ({ id: `batch-rating-${index}`, batchId: 'batch-seed-1', evaluatedAt: '2030-01-01T10:00:00.000Z', scores: { unfamiliar: 3 + index, intensity: 3 + index } }));
  for (const state of [design, batch]) {
    const report = buildSensoryPanelAnalytics(state, { dimension: 'unfamiliar', dateFrom: '2030-01-01' });
    assert.equal(report.ratingDimensions[0].scale, 'unverified scale');
    const result = report.repeatability.dimensions[0];
    assert.equal(result.status, 'not-calculated');
    assert.match(result.reason, /no verified integer 1–5 scale/);
    assert.equal(result.validPairs, 0);
    for (const field of ['exactAgreement', 'withinOnePointAgreement', 'meanAbsoluteDifference']) assert.equal(result[field], null);
    assert.equal(result.excludedRecords, 2);
    const supported = repeatResult(state);
    assert.equal(supported.validPairs, 1);
    assert.equal(supported.withinOnePointAgreement, 1);
    assert.equal(supported.meanAbsoluteDifference, 1);
  }
});

test('replicate pairs require the same design and condition and use valid-pair denominators', () => {
  const state = replicateFixture([[0, { intensity: 3 }], [1, { intensity: 4 }], [2, { intensity: 2 }], [3, { intensity: 2 }], [4, { intensity: 1 }], [5, { intensity: 5 }]]);
  const before = structuredClone(state);
  const result = repeatResult(state);
  assert.equal(result.validPairs, 3); // one per condition/design group, never 6 choose 2
  assert.equal(result.exactAgreement, 1 / 3);
  assert.equal(result.withinOnePointAgreement, 2 / 3);
  assert.equal(result.meanAbsoluteDifference, 5 / 3);
  assert.equal(result.candidateRecords, 6);
  assert.equal(result.includedRecords, 6);
  assert.equal(result.excludedRecords, 0);
  assert.deepEqual(result.pairs.map(pair => pair.sourceEvaluationIds), [['rating-0', 'rating-1'], ['rating-2', 'rating-3'], ['rating-4', 'rating-5']]);
  assert.deepEqual(repeatResult(state), result);
  assert.deepEqual(state, before);
});

test('unmatched designs and conditions do not fall back to batch pairing', () => {
  for (const other of [2, 4]) {
    const result = repeatResult(replicateFixture([[0, { intensity: 3 }], [other, { intensity: 3 }]]));
    assert.equal(result.status, 'insufficient-data');
    assert.equal(result.validPairs, 0);
    assert.equal(result.excludedRecords, 2);
    assert.equal(result.exactAgreement, null);
  }
});

test('missing and invalid ratings count unique excluded records, not rejected pairs', () => {
  const state = replicateFixture([[0, { intensity: 3 }], [1, { intensity: 4 }], [2, {}], [3, { intensity: 6 }]]);
  const result = repeatResult(state);
  assert.equal(result.candidateRecords, 4);
  assert.equal(result.includedRecords, 2);
  assert.equal(result.excludedRecords, 2);
  assert.equal(result.validPairs, 1);
  assert.equal(result.withinOnePointAgreement, 1);
  assert.deepEqual(result.exclusions.map(item => item.reason), ['Missing rating.', 'Invalid integer 1–5 rating.']);
});

test('multiple evaluations on a run remain ambiguous even after date filtering', () => {
  let state = replicateFixture([[0, { intensity: 3 }], [1, { intensity: 4 }]]);
  state = recordSensoryEvaluation(state, 'experiment-seed-1', { id: 'extra-rating', batchId: 'analytics-batch-0', revisionId: 'revision-seed-1', evaluatedAt: '2029-12-31T10:00:00.000Z', scores: { intensity: 3 } });
  state = updateExperimentDesignRun(state, state.experimentDesignRuns[0].id, { sensoryEvaluationIds: ['rating-0', 'extra-rating'] });
  const all = buildSensoryPanelAnalytics(state, { dimension: 'intensity', dateFrom: '2029-12-31' }).repeatability.dimensions[0];
  assert.equal(all.candidateRecords, 3);
  assert.equal(all.excludedRecords, 3);
  assert.equal(all.validPairs, 0);
  const filtered = repeatResult(state);
  assert.equal(filtered.candidateRecords, 2);
  assert.equal(filtered.excludedRecords, 2);
  assert.equal(filtered.validPairs, 0);
  assert.match(filtered.exclusions.find(item => item.evaluationId === 'rating-0').reason, /Multiple evaluations/);
});

test('shared evaluation IDs and duplicate links cannot create self-pairs or inflated counts', () => {
  const state = replicateFixture([[0, { intensity: 3 }], [1, { intensity: 4 }]]);
  // Malformed/imported relationship: one observation claims two different runs.
  state.experimentDesignRuns[2].sensoryEvaluationIds = ['rating-0'];
  let result = repeatResult(state);
  assert.equal(result.candidateRecords, 2);
  assert.equal(result.excludedRecords, 2);
  assert.equal(result.validPairs, 0);
  assert.match(result.exclusions.find(item => item.evaluationId === 'rating-0').reason, /multiple runs/);
  state.experimentDesignRuns[2].sensoryEvaluationIds = [];
  state.experimentDesignRuns[0].sensoryEvaluationIds.push('rating-0');
  result = repeatResult(state);
  assert.equal(result.candidateRecords, 2);
  assert.equal(result.validPairs, 1);
  assert.deepEqual(result.pairs[0].sourceEvaluationIds, ['rating-0', 'rating-1']);
});

test('incomplete replicate relationships cannot fall back to repeated-batch pairing', () => {
  for (const field of ['replicateNumber', 'conditionId', 'designId', 'batchId']) {
    const state = replicateFixture([[0, { intensity: 3 }], [1, { intensity: 4 }]]);
    delete state.experimentDesignRuns[0][field];
    const result = repeatResult(state);
    assert.equal(result.validPairs, 0, field);
    assert.equal(result.excludedRecords, 2, field);
    assert.equal(result.meanAbsoluteDifference, null);
  }
});

test('disjoint batch and design groups contribute their actual pairs without discarding or cross-pairing', () => {
  let state = replicateFixture([[0, { intensity: 3 }], [1, { intensity: 4 }]]);
  for (const id of ['batch-repeat-a', 'batch-repeat-b']) state = recordSensoryEvaluation(state, 'experiment-seed-1', { id, batchId: 'batch-seed-1', evaluatedAt: '2030-01-01T11:00:00.000Z', scores: { intensity: 2 } });
  const result = repeatResult(state);
  assert.equal(result.candidateRecords, 4);
  assert.equal(result.includedRecords, 4);
  assert.equal(result.excludedRecords, 0);
  assert.equal(result.validPairs, 2);
  assert.equal(result.exactAgreement, 0.5);
  assert.equal(result.withinOnePointAgreement, 1);
  assert.equal(result.meanAbsoluteDifference, 0.5);
});
