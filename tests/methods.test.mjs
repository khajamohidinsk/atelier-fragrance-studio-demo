import test from 'node:test';
import assert from 'node:assert/strict';
import { addExperiment, createInitialState } from '../src/domain/store.mjs';
import { completeMethodExecution, createMethod, methodExecutionReport, publishMethod, recordMethodCondition, recordMethodDeviation, recordMethodEvidence, recordMethodMeasurement, recordMethodObservation, recordMethodExecutionStep, retireMethod, startMethodExecution, updateMethodDraft } from '../src/domain/methods.mjs';

function draftInput() {
  return {
    title: 'Gravimetric sample check',
    purpose: 'Record a repeatable mass check without treating missing evidence as a pass.',
    scope: 'Small-batch sample preparation',
    author: 'Alex Doe',
    tags: ['measurement', 'repeatability'],
    steps: [{ type: 'instruction', title: 'Prepare vessel', instruction: 'Clean and tare the vessel.', required: true }, { type: 'measurement', title: 'Record mass', instruction: 'Record the balance reading.', required: true, measurementName: 'Sample mass', unit: 'g' }],
    materials: [{ name: 'Sample', quantity: 1, unit: 'g', notes: 'Use the selected batch sample.' }],
    equipment: [{ name: 'Bench balance', purpose: 'Mass reading' }],
    measurements: [{ name: 'Sample mass', unit: 'g', criterion: { kind: 'range', unit: 'g', min: 0.9, max: 1.1 } }],
    conditions: [{ name: 'Room condition', expected: '20–25 °C', required: true }],
    observations: [{ name: 'Appearance', prompt: 'Record appearance before and after measurement.', required: true }],
    evidenceRequirements: [{ name: 'Balance reading evidence', required: true }]
  };
}

function publishedExecution(overrides = {}) {
  let state = createInitialState();
  state = createMethod(state, { ...draftInput(), ...overrides });
  const method = state.methods[0];
  state = publishMethod(state, method.id);
  const version = state.methodVersions.find(item => item.status === 'published');
  state = startMethodExecution(state, { methodId: method.id, methodVersionId: version.id, experimentId: 'experiment-seed-1', startedAt: '2026-10-26T10:00:00.000Z' });
  return { state, method, version, execution: state.methodExecutions[0] };
}

test('draft methods can be edited, published, and copied without mutating published history', () => {
  let state = createInitialState();
  state = createMethod(state, draftInput());
  const method = state.methods[0];
  state = updateMethodDraft(state, method.id, { purpose: 'Updated purpose.' });
  state = publishMethod(state, method.id);
  const published = state.methodVersions.find(item => item.status === 'published');
  assert.equal(published.version, 1);
  assert.equal(published.purpose, 'Updated purpose.');
  assert.equal(state.methods[0].currentVersionId, published.id);
  assert.throws(() => startMethodExecution(state, { methodId: method.id, methodVersionId: state.methods[0].draftVersionId, experimentId: 'experiment-seed-1' }), /published/);
  const before = JSON.stringify(published);
  state = updateMethodDraft(state, method.id, { purpose: 'Draft v2 purpose.' });
  assert.equal(JSON.stringify(state.methodVersions.find(item => item.id === published.id)), before);
  state = retireMethod(state, method.id);
  assert.throws(() => startMethodExecution(state, { methodId: method.id, methodVersionId: published.id, experimentId: 'experiment-seed-1' }), /Retired/);
});

test('execution preserves selected published version and distinguishes measured acceptance from missing evidence', () => {
  let state = createInitialState();
  state = addExperiment(state, { experimentId: 'EXP-METHOD', title: 'Method execution experiment', objective: 'Exercise a published method.' });
  const experiment = state.experiments[0];
  state = createMethod(state, draftInput());
  const method = state.methods[0];
  state = publishMethod(state, method.id);
  const version = state.methodVersions.find(item => item.status === 'published');
  state = startMethodExecution(state, { methodId: method.id, methodVersionId: version.id, experimentId: experiment.id, startedAt: '2026-10-26T10:00:00.000Z' });
  const execution = state.methodExecutions[0];
  assert.equal(execution.methodVersionId, version.id);
  state = recordMethodExecutionStep(state, execution.id, version.steps[0].id, { status: 'completed', notes: 'Vessel prepared.' });
  state = recordMethodExecutionStep(state, execution.id, version.steps[1].id, { status: 'completed', notes: 'Reading captured.' });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 1.02, unit: 'g', observedAt: '2026-10-26T10:05:00.000Z' });
  state = recordMethodCondition(state, execution.id, { methodConditionId: version.conditions[0].id, value: '22', unit: '°C', observedAt: '2026-10-26T10:05:30.000Z' });
  state = recordMethodObservation(state, execution.id, { name: 'Appearance', value: 'Clear', observedAt: '2026-10-26T10:06:00.000Z' });
  state = recordMethodEvidence(state, execution.id, { requirementId: version.evidenceRequirements[0].id, reference: 'notebook:page-4', recordedAt: '2026-10-26T10:06:30.000Z' });
  state = recordMethodDeviation(state, execution.id, { description: 'Reading delayed by one minute.', reason: 'Balance stabilization.' });
  let report = methodExecutionReport(state, execution.id);
  assert.equal(report.acceptance, 'pass');
  assert.equal(report.canClaimComplete, false);
  assert.deepEqual(report.missingEvidence, []);
  assert.deepEqual(report.missingConditions, []);
  state = completeMethodExecution(state, execution.id);
  report = methodExecutionReport(state, execution.id);
  assert.equal(report.execution.status, 'completed');
  assert.equal(report.canClaimComplete, true);
  assert.equal(report.measurementResults[0].criterionResult, 'pass');
});

test('measurement criteria stay unknown when units cannot be compared', () => {
  let state = createInitialState();
  state = createMethod(state, { ...draftInput(), measurements: [{ name: 'Temperature', unit: '°C', criterion: { kind: 'range', unit: '°C', min: 20, max: 25 } }] });
  const method = state.methods[0]; state = publishMethod(state, method.id); const version = state.methodVersions.find(item => item.status === 'published');
  state = startMethodExecution(state, { methodId: method.id, methodVersionId: version.id, experimentId: 'experiment-seed-1' });
  const execution = state.methodExecutions[0];
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 22, unit: '°F', observedAt: '2026-10-26T10:00:00.000Z' });
  assert.equal(state.methodExecutions[0].measurements[0].criterionResult, 'not-evaluated');
});

test('missing one of two required measurements prevents an overall pass', () => {
  const definitions = [{ name: 'Mass', unit: 'g', criterion: { kind: 'range', unit: 'g', min: 1, max: 2 } }, { name: 'Temperature', unit: '°C', criterion: { kind: 'range', unit: '°C', min: 20, max: 25 } }];
  let { state, version, execution } = publishedExecution({ measurements: definitions });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 1.5, unit: 'g', observedAt: '2026-10-26T10:01:00.000Z' });
  const report = methodExecutionReport(state, execution.id);
  assert.equal(report.acceptance, 'not-evaluated');
  assert.deepEqual(report.missingMeasurements, ['Temperature']);
  assert.equal(report.measurementResults[0].criterionResult, 'pass');
});

test('a recorded measurement without a criterion remains not-evaluated', () => {
  let { state, version, execution } = publishedExecution({ measurements: [{ name: 'Appearance score', unit: 'score' }] });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 3, unit: 'score', observedAt: '2026-10-26T10:01:00.000Z' });
  const report = methodExecutionReport(state, execution.id);
  assert.equal(report.measurementResults[0].criterionResult, 'not-evaluated');
  assert.deepEqual(report.missingAcceptanceCriteria, ['Appearance score']);
  assert.equal(report.acceptance, 'not-evaluated');
});

test('an incompatible-unit measurement prevents an overall pass', () => {
  let { state, version, execution } = publishedExecution({ measurements: [{ name: 'Temperature', unit: '°C', criterion: { kind: 'range', unit: '°C', min: 20, max: 25 } }] });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 72, unit: '°F', observedAt: '2026-10-26T10:01:00.000Z' });
  const report = methodExecutionReport(state, execution.id);
  assert.equal(report.measurementResults[0].criterionResult, 'not-evaluated');
  assert.deepEqual(report.unevaluatedMeasurements, ['Temperature']);
  assert.equal(report.acceptance, 'not-evaluated');
});

test('all required measurements present and passing produces an overall pass', () => {
  const definitions = [{ name: 'Mass', unit: 'g', criterion: { kind: 'range', unit: 'g', min: 1, max: 2 } }, { name: 'Temperature', unit: '°C', criterion: { kind: 'range', unit: '°C', min: 20, max: 25 } }];
  let { state, version, execution } = publishedExecution({ measurements: definitions });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 1.5, unit: 'g', observedAt: '2026-10-26T10:01:00.000Z' });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[1].id, value: 22, unit: '°C', observedAt: '2026-10-26T10:02:00.000Z' });
  const report = methodExecutionReport(state, execution.id);
  assert.equal(report.acceptance, 'pass');
  assert.deepEqual(report.missingMeasurements, []);
  assert.deepEqual(report.unevaluatedMeasurements, []);
});

test('a declared criterion failure produces an overall fail', () => {
  let { state, version, execution } = publishedExecution({ measurements: [{ name: 'Mass', unit: 'g', criterion: { kind: 'range', unit: 'g', min: 1, max: 2 } }] });
  state = recordMethodMeasurement(state, execution.id, { methodMeasurementId: version.measurements[0].id, value: 3, unit: 'g', observedAt: '2026-10-26T10:01:00.000Z' });
  const report = methodExecutionReport(state, execution.id);
  assert.equal(report.measurementResults[0].criterionResult, 'fail');
  assert.deepEqual(report.failedMeasurements, ['Mass']);
  assert.equal(report.acceptance, 'fail');
});
