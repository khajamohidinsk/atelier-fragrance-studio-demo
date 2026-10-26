import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSensoryPanelAnalytics } from '../src/domain/sensory-analytics.mjs';
import { createInitialState, createMaturationPlan, recordMaturationObservation, recordSensoryEvaluation } from '../src/domain/store.mjs';

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
