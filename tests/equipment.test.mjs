import test from 'node:test';
import assert from 'node:assert/strict';
import { addEquipment, addMaintenanceEvent, addMeasurement, addVerificationEvent, createInitialState, equipmentSummary, normalizeState, validateState } from '../src/domain/store.mjs';
import { createBackup, parseBackup } from '../src/domain/backup.mjs';

test('equipment collections default safely and survive backup round-trip', () => {
  const sparse = normalizeState({ version: 2 });
  assert.deepEqual(sparse.equipment, []);
  assert.deepEqual(sparse.verificationEvents, []);
  assert.deepEqual(sparse.maintenanceEvents, []);
  assert.deepEqual(sparse.measurements, []);
  const state = addEquipment(createInitialState(), { id: 'equipment-balance-1', name: 'Bench balance', equipmentType: 'balance', resolution: 0.001, resolutionUnit: 'g' });
  const parsed = parseBackup(JSON.stringify(createBackup(state))).state;
  assert.deepEqual(parsed.equipment, state.equipment);
  assert.deepEqual(parsed.verificationEvents, []);
});

test('verification status remains unknown until evidence is recorded, then exposes overdue and failed states', () => {
  let state = addEquipment(createInitialState(), { id: 'equipment-thermo-1', name: 'Thermometer', equipmentType: 'thermometer' });
  assert.equal(equipmentSummary(state)[0].verification.status, 'unknown');
  state = addVerificationEvent(state, 'equipment-thermo-1', { id: 'verification-1', performedAt: '2026-10-01T10:00:00.000Z', outcome: 'pass', nextDueAt: '2026-10-10', method: 'Ice point check', notes: 'Recorded against a known reference.' });
  assert.equal(equipmentSummary(state, { asOf: '2026-10-11T00:00:00.000Z' })[0].verification.status, 'overdue');
  state = addVerificationEvent(state, 'equipment-thermo-1', { id: 'verification-2', performedAt: '2026-10-12T10:00:00.000Z', outcome: 'fail', notes: 'Reference check failed.' });
  assert.equal(equipmentSummary(state)[0].verification.status, 'failed');
});

test('maintenance and measurement records preserve links and reject invalid relationships', () => {
  let state = addEquipment(createInitialState(), { id: 'equipment-balance-2', name: 'Precision balance', equipmentType: 'balance' });
  state = addMaintenanceEvent(state, 'equipment-balance-2', { id: 'maintenance-1', eventType: 'fault', occurredAt: '2026-10-20T09:00:00.000Z', statusAfter: 'out-of-service', notes: 'Display was unstable.' });
  state = addMeasurement(state, 'equipment-balance-2', { id: 'measurement-1', quantityType: 'mass', value: 12.5, unit: 'g', measuredAt: '2026-10-20T10:00:00.000Z', method: 'Direct reading', batchId: 'batch-seed-1', experimentId: 'experiment-seed-1' });
  const record = equipmentSummary(state)[0];
  assert.equal(record.equipment.status, 'out-of-service');
  assert.equal(record.measurements[0].unit, 'g');
  assert.throws(() => addMeasurement(state, 'equipment-balance-2', { id: 'measurement-bad', quantityType: 'mass', value: 1, unit: 'g', measuredAt: '2026-10-20T10:00:00.000Z', batchId: 'batch-seed-1', experimentId: 'unknown-experiment' }), /unknown experiment/);
  assert.throws(() => validateState({ ...state, measurements: [{ id: 'bad', equipmentId: 'equipment-balance-2', quantityType: 'mass', value: NaN, unit: 'g', measuredAt: '2026-10-20T10:00:00.000Z' }] }), /must be finite/);
});
