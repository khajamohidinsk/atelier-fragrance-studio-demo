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
