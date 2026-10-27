import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBatchTotals, calculateDilution, calculateFinalConcentration, convertQuantity } from '../src/domain/calculations.mjs';

test('calculates stock dilution and preserves mass/volume basis', () => {
  assert.deepEqual(calculateDilution({ stockConcentration: 50, targetConcentration: 10, finalAmount: 100, unit: 'g' }), {
    stockAmount: 20, diluentAmount: 80, finalAmount: 100, unit: 'g', stockConcentration: 50, targetConcentration: 10,
  });
  assert.equal(calculateDilution({ stockConcentration: 20, targetConcentration: 5, finalAmount: 100, unit: 'mL' }).stockAmount, 25);
});

test('converts compatible units and requires density across families', () => {
  assert.equal(convertQuantity(1, 'kg', 'g'), 1000);
  assert.equal(convertQuantity(1, 'L', 'g', { density: 0.8 }), 800);
  assert.throws(() => convertQuantity(1, 'L', 'g'), /Density/);
  assert.throws(() => convertQuantity(1, 'g', 'mL', { density: 0 }), /Density/);
});

test('converts zero within compatible mass and volume dimensions', () => {
  assert.equal(convertQuantity(0, 'mg', 'g'), 0);
  assert.equal(convertQuantity(0, 'g', 'mg'), 0);
  assert.equal(convertQuantity(0, 'mL', 'L'), 0);
});

test('conversion validation still rejects negative, non-finite, malformed, and invalid-density inputs', () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.throws(() => convertQuantity(value, 'g', 'mg'), /Quantity/);
  assert.throws(() => convertQuantity(0, 'cup', 'mL'), /Unsupported/);
  assert.throws(() => convertQuantity(0, 'g', 'mL', { density: 0 }), /Density/);
  assert.throws(() => convertQuantity(0, 'g', 'mL', { density: Number.NaN }), /Density/);
  assert.throws(() => convertQuantity(0, 'g', 'mL', { density: Number.POSITIVE_INFINITY }), /Density/);
});

test('calculates final concentration by weighted active amount', () => {
  const result = calculateFinalConcentration({ additions: [
    { amount: 20, unit: 'g', concentration: 50 },
    { amount: 80, unit: 'g', concentration: 0 },
  ] });
  assert.equal(result.concentration, 10);
  assert.equal(result.totalAmount, 100);
});

test('rejects impossible and invalid calculations', () => {
  assert.throws(() => calculateDilution({ stockConcentration: 10, targetConcentration: 20, finalAmount: 10 }), /exceed/);
  assert.throws(() => calculateDilution({ stockConcentration: 0, targetConcentration: 0, finalAmount: 10 }), /greater than zero/);
  assert.throws(() => calculateFinalConcentration({ additions: [{ amount: -1, unit: 'g', concentration: 10 }] }), /greater than zero/);
  assert.throws(() => calculateFinalConcentration({ additions: [{ amount: 1, unit: 'cup', concentration: 10 }] }), /Unsupported/);
});

test('batch totals retain material traceability and active amount', () => {
  const result = calculateBatchTotals([
    { materialId: 'rose-lot', amount: 2, unit: 'g', concentration: 100 },
    { materialId: 'rose-lot', amount: 3, unit: 'g', concentration: 100 },
    { materialId: 'carrier-lot', amount: 5, unit: 'g', concentration: 0 },
  ], { unit: 'g' });
  assert.deepEqual(result.byMaterial, { 'rose-lot': 5, 'carrier-lot': 5 });
  assert.deepEqual(result.byLot, {});
  assert.equal(result.totalAmount, 10);
  assert.equal(result.totalActiveAmount, 5);
});
