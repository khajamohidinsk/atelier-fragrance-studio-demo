import test from 'node:test';
import assert from 'node:assert/strict';
import { addPurchase, calculateBatchCost, createInitialState, updatePurchase, validateState } from '../src/domain/store.mjs';
import { mergeBackup, parseBackup, serializeBackup } from '../src/domain/backup.mjs';

function purchaseInput(overrides = {}) {
  return {
    id: 'purchase-1', supplier: 'Studio Supply Co.', purchaseDate: '2026-10-20', receiptNumber: 'INV-100', currency: 'USD', receiptEvidence: { kind: 'reference', reference: 'archive://receipts/INV-100' },
    lineItems: [{ id: 'purchase-line-1', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', quantity: 100, unit: 'g', unitPrice: 2.5, lineTotal: 250 }], ...overrides
  };
}

test('receipt-backed purchase links to the lot and costs actual additions', () => {
  const state = addPurchase(createInitialState(), purchaseInput({ lineItems: [{ id: 'purchase-line-1', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', quantity: 100, unit: 'g', unitPrice: 2.5, lineTotal: 250 }, { id: 'purchase-line-2', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', quantity: 100, unit: 'g', unitPrice: 1, lineTotal: 100 }] }));
  assert.deepEqual(state.materials.find(item => item.id === 'material-seed-1').lots[0].purchaseLineItemIds, ['purchase-line-1']);
  const costing = calculateBatchCost(state, 'batch-seed-1');
  assert.equal(costing.complete, true);
  assert.equal(costing.rows[0].attributableCost, 50);
  assert.equal(costing.total, 130);
  assert.equal(costing.rows[0].receiptNumber, 'INV-100');
});

test('multiple historical receipts preserve prices and require an explicit source when ambiguous', () => {
  let state = addPurchase(createInitialState(), purchaseInput());
  state = addPurchase(state, purchaseInput({ id: 'purchase-2', receiptNumber: 'INV-200', purchaseDate: '2026-10-22', lineItems: [{ id: 'purchase-line-2', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', quantity: 50, unit: 'g', unitPrice: 4, lineTotal: 200 }] }));
  let costing = calculateBatchCost(state, 'batch-seed-1');
  assert.equal(costing.complete, false);
  assert.equal(costing.uncosted[0].reason, 'ambiguous-purchase-source');
  const linked = { ...state.batches[0], actualAdditions: state.batches[0].actualAdditions.map(item => item.materialLotId === 'lot-seed-1' ? { ...item, purchaseLineItemId: 'purchase-line-1' } : item) };
  state = validateState({ ...state, batches: [linked] });
  costing = calculateBatchCost(state, 'batch-seed-1');
  assert.equal(costing.rows.find(row => row.additionId === 'addition-seed-1').attributableCost, 50);
  assert.equal(state.purchaseLineItems.find(item => item.id === 'purchase-line-2').unitPrice, 4);
});

test('missing evidence and incompatible units remain explicitly uncosted', () => {
  let state = addPurchase(createInitialState(), purchaseInput({ id: 'purchase-no-evidence', receiptEvidence: undefined, lineItems: [{ id: 'purchase-line-no-evidence', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', quantity: 100, unit: 'g', unitPrice: 2.5, lineTotal: 250 }] }));
  let costing = calculateBatchCost(state, 'batch-seed-1');
  assert.equal(costing.complete, false);
  assert.equal(costing.uncosted[0].reason, 'missing-receipt-evidence');
  state = addPurchase(createInitialState(), purchaseInput({ id: 'purchase-volume', lineItems: [{ id: 'purchase-line-volume', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', quantity: 100, unit: 'mL', unitPrice: 1, lineTotal: 100 }] }));
  costing = calculateBatchCost(state, 'batch-seed-1');
  assert.equal(costing.uncosted[0].reason, 'incompatible-unit');
});

test('invalid edits preserve the prior purchase and legacy backups remain importable', () => {
  const original = addPurchase(createInitialState(), purchaseInput());
  assert.throws(() => updatePurchase(original, 'purchase-1', { supplier: '', lineItems: original.purchaseLineItems.map(item => ({ ...item, unitPrice: -1 })) }), /supplier|required|zero or greater/);
  assert.equal(original.purchases[0].supplier, 'Studio Supply Co.');
  const legacy = createInitialState(); legacy.version = 1; legacy.purchases = undefined; legacy.purchaseLineItems = undefined;
  const restored = parseBackup(serializeBackup(legacy));
  assert.deepEqual(restored.state.purchases, []);
  assert.deepEqual(restored.state.purchaseLineItems, []);
});

test('backup merge keeps purchase lines linked to existing lots without overwriting current material records', () => {
  const current = createInitialState();
  const incoming = addPurchase(current, purchaseInput());
  const merged = mergeBackup(current, incoming).state;
  assert.equal(merged.purchases.length, 1);
  assert.deepEqual(merged.materials.find(item => item.id === 'material-seed-1').lots[0].purchaseLineItemIds, ['purchase-line-1']);
});
