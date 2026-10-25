import test from 'node:test';
import assert from 'node:assert/strict';
import { addBatch, addExperiment, addRevision, createBlindSession, createInitialState, lockBlindSession, randomizeBlindSession, recordBlindObservation, shuffleBlindSamples, startBlindSession, unblindSession } from '../src/domain/store.mjs';
import { parseBackup, serializeBackup } from '../src/domain/backup.mjs';

function stateWithTwoBatches() {
  let state = createInitialState();
  state = addExperiment(state, { experimentId: 'EXP-002', title: 'Blind candidate', objective: 'Synthetic blind candidate' });
  const experiment = state.experiments.find(item => item.experimentId === 'EXP-002');
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-2', lotId: 'lot-seed-2', quantity: 10, unit: 'g' }] });
  const revision = state.revisions.find(item => item.experimentId === experiment.id);
  return addBatch(state, experiment.id, { id: 'batch-blind-2', batchCode: 'BATCH-002', formulaRevisionId: revision.id, plannedAmount: 10, unit: 'g', actualAdditions: [{ id: 'addition-blind-2', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 10, unit: 'g', concentration: 100 }] });
}

test('Fisher-Yates blind shuffle is repeatable with an injected random source and preserves every sample once', () => {
  const samples = ['a', 'b', 'c', 'd']; const values = [0.9, 0, 0.5]; let index = 0;
  const shuffled = shuffleBlindSamples(samples, () => values[index++ % values.length]);
  assert.equal(shuffled.length, samples.length);
  assert.deepEqual(new Set(shuffled), new Set(samples));
  assert.deepEqual(samples, ['a', 'b', 'c', 'd']);
});

test('blind session validates candidates, persists opaque assignments, and prevents reshuffle', () => {
  const initial = stateWithTwoBatches();
  assert.throws(() => createBlindSession(initial, { name: 'Too small', purpose: 'Invalid', sessionDate: '2026-10-26', batchIds: ['batch-seed-1'] }), /at least two/);
  let state = createBlindSession(initial, { id: 'blind-session-1', name: 'Cedar comparison', purpose: 'Compare two physical candidates', sessionDate: '2026-10-26', evaluatorLabel: 'Participant A', batchIds: ['batch-seed-1', 'batch-blind-2'] });
  assert.equal(state.blindSessions[0].status, 'draft');
  state = randomizeBlindSession(state, 'blind-session-1', () => 0);
  const samples = state.blindSamples.filter(item => item.sessionId === 'blind-session-1');
  assert.equal(new Set(samples.map(item => item.blindCode)).size, 2);
  assert.deepEqual(new Set(samples.map(item => item.position)), new Set([1, 2]));
  assert.match(samples[0].blindCode, /^BT-[A-Z0-9]{6,}$/);
  assert.throws(() => randomizeBlindSession(state, 'blind-session-1', () => 0), /Only a draft/);
});

test('blind observations require completion before lock and map correctly after explicit unblinding', () => {
  let state = randomizeBlindSession(createBlindSession(stateWithTwoBatches(), { id: 'blind-session-2', name: 'Blind session', purpose: 'Record subjective differences', sessionDate: '2026-10-26', batchIds: ['batch-seed-1', 'batch-blind-2'] }), 'blind-session-2', () => 0.2);
  state = startBlindSession(state, 'blind-session-2');
  const samples = state.blindSamples.filter(item => item.sessionId === 'blind-session-2');
  state = recordBlindObservation(state, 'blind-session-2', samples[0].id, { intervalLabel: 'Opening', evaluatedAt: '2026-10-26T10:00:00.000Z', subjectiveNotes: 'Cool and dry.', descriptors: ['cool', 'dry'], scores: { intensity: 3 } });
  assert.throws(() => lockBlindSession(state, 'blind-session-2'), /incomplete samples/);
  state = recordBlindObservation(state, 'blind-session-2', samples[1].id, { intervalLabel: 'Opening', evaluatedAt: '2026-10-26T10:01:00.000Z', subjectiveNotes: 'Soft and green.', descriptors: ['soft', 'green'], scores: { intensity: 4 } });
  state = lockBlindSession(state, 'blind-session-2');
  assert.equal(state.blindSessions.find(item => item.id === 'blind-session-2').status, 'locked');
  assert.ok(state.evaluations.every(item => item.blindSessionId !== 'blind-session-2' || item.blindLockedAt));
  assert.throws(() => recordBlindObservation(state, 'blind-session-2', samples[0].id, { intervalLabel: 'Correction', subjectiveNotes: 'Changed.' }), /cannot be changed/);
  state = unblindSession(state, 'blind-session-2');
  const unblinded = state.blindSessions.find(item => item.id === 'blind-session-2');
  assert.equal(unblinded.status, 'unblinded');
  assert.equal(state.evaluations.filter(item => item.blindSessionId === 'blind-session-2').length, 2);
  const restored = parseBackup(serializeBackup(state)).state;
  assert.deepEqual(restored.blindSamples, state.blindSamples);
  assert.deepEqual(restored.evaluations.filter(item => item.blindSessionId), state.evaluations.filter(item => item.blindSessionId));
  const legacy = createInitialState(); legacy.version = 1; legacy.blindSessions = undefined; legacy.blindSamples = undefined;
  const legacyRestored = parseBackup(JSON.stringify({ format: 'atelier-scent-lab-backup', backupVersion: 1, schemaVersion: 1, state: legacy })).state;
  assert.deepEqual(legacyRestored.blindSessions, []);
  assert.deepEqual(legacyRestored.blindSamples, []);
});
