import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, createMemoryAdapter, createLocalStorageAdapter } from '../src/domain/persistence.mjs';
import { createInitialState, loadState } from '../src/domain/store.mjs';

test('memory persistence adapter supports injected load/save', () => {
  const state = createInitialState();
  const adapter = createMemoryAdapter(state);
  assert.equal(adapter.load(), state);
  const next = { ...state, tags: ['changed'] };
  adapter.save(next);
  assert.deepEqual(adapter.load().tags, ['changed']);
});

test('local storage adapter reports missing storage and preserves the current key', () => {
  assert.throws(() => createLocalStorageAdapter(null).load(), /unavailable/);
  const storage = new Map();
  const adapter = createLocalStorageAdapter({ getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) });
  const saved = adapter.save(createInitialState());
  assert.equal(saved.version, 2);
  assert.equal(adapter.load().version, 2);
});

test('bootstrap after failed load returns locked state that must not be saved', () => {
  const writes = [];
  const storage = { getItem: () => '{bad json', setItem: (...args) => writes.push(args) };
  const boot = bootstrapState(createLocalStorageAdapter(storage));
  assert.equal(boot.locked, true);
  assert.match(boot.error, /malformed/);
  assert.equal(boot.state.version, 2);
  assert.deepEqual(writes, [], 'bootstrap must not write anything to storage');
});

test('bootstrap after successful load is unlocked and preserves saved records', () => {
  const saved = { ...createInitialState(), tags: ['kept'] };
  const storage = new Map();
  const adapter = createLocalStorageAdapter({ getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) });
  adapter.save(saved);
  const boot = bootstrapState(adapter);
  assert.equal(boot.locked, false);
  assert.equal(boot.error, '');
  assert.deepEqual(boot.state.tags, ['kept']);
});

test('bootstrap with empty storage (fresh environment) is unlocked with fresh state', () => {
  const adapter = createLocalStorageAdapter({ getItem: () => null, setItem: () => { throw new Error('should not write'); } });
  const boot = bootstrapState(adapter);
  assert.equal(boot.locked, false);
  assert.equal(boot.error, '');
  assert.equal(boot.state.version, 2);
});

test('loadState rejects malformed saved data instead of returning seed state', () => {
  assert.throws(() => loadState({ getItem: () => '{' }), /malformed/);
  assert.throws(() => loadState({ getItem: () => 'null' }), /malformed/);
  assert.throws(() => loadState({ getItem: () => '[1, 2]' }), /malformed/);
  assert.throws(() => loadState({ getItem: () => '"a string"' }), /malformed/);
  assert.throws(() => loadState({ getItem: () => JSON.stringify({ version: 3 }) }), /unsupported schema version 3/);
});

test('loadState returns empty state for structurally valid but sparse saved data', () => {
  const state = loadState({ getItem: () => JSON.stringify({ version: 2 }) });
  assert.deepEqual(state.materials, []);
  assert.deepEqual(state.stockMovements, []);
  assert.ok(!JSON.stringify(state).includes('seed'));
});

test('legacy version 1 state migrates batch additions into auditable stock movements', () => {
  const current = createInitialState();
  const legacy = { ...current, version: 1, stockMovements: undefined };
  legacy.batches = legacy.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(({ stockMovementId, ...addition }) => addition) }));
  const state = loadState({ getItem: () => JSON.stringify(legacy) });
  assert.equal(state.version, 2);
  assert.ok(state.stockMovements.some(item => item.provenance === 'migration'));
  assert.ok(state.batches[0].actualAdditions.every(addition => addition.stockMovementId));
});

test('legacy migration never infers an opening balance from consumption history', () => {
  // A legacy lot with NO recorded receivedAmount must not gain a fabricated
  // opening movement: the sum of consumption is not an opening balance.
  const base = createInitialState();
  const legacy = { ...base, version: 1, stockMovements: undefined };
  legacy.batches = legacy.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(({ stockMovementId, ...addition }) => addition) }));
  // Strip receivedAmount so the lot has no recorded opening balance at all.
  legacy.materials = legacy.materials.map(material => ({ ...material, lots: material.lots.map(({ receivedAmount, receivedUnit, ...lot }) => lot) }));
  const state = loadState({ getItem: () => JSON.stringify(legacy) });
  const lotIds = new Set(state.materials.flatMap(material => material.lots.map(lot => lot.id)));
  const openings = state.stockMovements.filter(item => item.movementType === 'opening');
  assert.deepEqual(openings, [], 'no opening movement may be synthesized from consumption');
  for (const material of state.materials) for (const lot of material.lots) assert.equal(lot.receivedAmount, undefined, 'receivedAmount must not be backfilled from consumption');
  // Consumption for every legacy addition is still reconstructed and linked.
  assert.ok(state.stockMovements.some(item => item.movementType === 'consumption' && item.provenance === 'migration'));
  assert.ok(state.batches[0].actualAdditions.every(addition => addition.stockMovementId));
  assert.ok([...lotIds].length > 0);
});

test('legacy migration records opening only from an explicitly recorded receivedAmount', () => {
  const base = createInitialState();
  const legacy = { ...base, version: 1, stockMovements: undefined };
  legacy.batches = legacy.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(({ stockMovementId, ...addition }) => addition) }));
  const state = loadState({ getItem: () => JSON.stringify(legacy) });
  const openings = state.stockMovements.filter(item => item.movementType === 'opening');
  // Every seed lot carries receivedAmount 100, so each lot may have exactly one
  // opening movement of exactly 100 — matching the recorded amount, not a sum
  // derived from consumption.
  const lotIds = state.materials.flatMap(material => material.lots.map(lot => lot.id));
  assert.equal(openings.length, lotIds.length);
  for (const opening of openings) assert.equal(opening.quantity, 100);
  for (const opening of openings) assert.ok(lotIds.includes(opening.materialLotId));
  // No opening quantity may equal a fabricated per-lot consumption total.
  for (const lotId of lotIds) {
    const consumed = state.stockMovements.filter(item => item.materialLotId === lotId && item.movementType === 'consumption').reduce((sum, item) => sum + item.quantity, 0);
    const opening = openings.find(item => item.materialLotId === lotId);
    if (opening) assert.notEqual(opening.quantity, consumed);
  }
});
