/**
 * Calculation helpers for fragrance experiments. Concentrations are expressed
 * as percentages (20 means 20%), and amounts are never silently converted
 * between mass and volume without a density.
 */

const MASS_TO_GRAMS = Object.freeze({ mg: 0.001, g: 1, kg: 1000 });
const VOLUME_TO_MILLILITRES = Object.freeze({ mL: 1, L: 1000 });

const units = Object.freeze({
  mass: Object.freeze(Object.keys(MASS_TO_GRAMS)),
  volume: Object.freeze(Object.keys(VOLUME_TO_MILLILITRES)),
});

function finitePositive(value, label, { allowZero = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new Error(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'}.`);
  }
  return value;
}

function concentration(value, label = 'concentration') {
  finitePositive(value, label, { allowZero: true });
  if (value > 100) throw new Error(`${label} must be between 0% and 100%.`);
  return value;
}

/** Return whether a unit is a supported mass or volume unit. */
export function validateUnit(unit) {
  if (typeof unit !== 'string') throw new Error('Unit must be a supported mass or volume unit.');
  const kind = Object.hasOwn(MASS_TO_GRAMS, unit) ? 'mass' : Object.hasOwn(VOLUME_TO_MILLILITRES, unit) ? 'volume' : null;
  if (!kind) throw new Error(`Unsupported unit "${unit}". Use mg, g, kg, mL, or L.`);
  return { unit, kind };
}

/**
 * Convert an amount. Cross-family conversions require density in g/mL.
 * Same-family conversions do not use density and preserve the requested unit.
 */
export function convertQuantity(value, fromUnit, toUnit, { density } = {}) {
  finitePositive(value, 'Quantity');
  const from = validateUnit(fromUnit);
  const to = validateUnit(toUnit);
  if (from.kind !== to.kind && (density === undefined || density === null)) {
    throw new Error('Density (in g/mL) is required to convert between mass and volume.');
  }
  if (density !== undefined) finitePositive(density, 'Density');

  let grams = from.kind === 'mass' ? value * MASS_TO_GRAMS[from.unit] : value * VOLUME_TO_MILLILITRES[from.unit] * density;
  if (from.kind !== to.kind) {
    return to.kind === 'mass' ? grams / MASS_TO_GRAMS[to.unit] : grams / density / VOLUME_TO_MILLILITRES[to.unit];
  }
  return from.kind === 'mass'
    ? grams / MASS_TO_GRAMS[to.unit]
    : (value * VOLUME_TO_MILLILITRES[from.unit]) / VOLUME_TO_MILLILITRES[to.unit];
}

/**
 * Calculate stock and diluent quantities for a target amount.
 * The target must be weaker than the stock; diluent is assumed concentration 0%.
 */
export function calculateDilution({ stockConcentration, targetConcentration, finalAmount, unit = 'g' }) {
  const stock = concentration(stockConcentration, 'Stock concentration');
  const target = concentration(targetConcentration, 'Target concentration');
  finitePositive(finalAmount, 'Final amount');
  validateUnit(unit);
  if (stock <= 0) throw new Error('Stock concentration must be greater than zero.');
  if (target > stock) throw new Error('Target concentration cannot exceed stock concentration.');
  const stockAmount = finalAmount * target / stock;
  return Object.freeze({ stockAmount, diluentAmount: finalAmount - stockAmount, finalAmount, unit, targetConcentration: target });
}

/** Calculate the concentration of a mixture from concentration/amount additions. */
export function calculateFinalConcentration({ additions, unit } = {}) {
  if (!Array.isArray(additions) || additions.length === 0) throw new Error('At least one addition is required.');
  const targetUnit = unit ?? additions[0]?.unit;
  if (!targetUnit) throw new Error('A unit is required for each addition.');
  const targetKind = validateUnit(targetUnit).kind;
  let total = 0;
  let active = 0;
  for (const [index, addition] of additions.entries()) {
    if (!addition || typeof addition !== 'object') throw new Error(`Addition ${index + 1} is invalid.`);
    const additionUnit = addition.unit ?? targetUnit;
    if (!additionUnit) throw new Error(`Addition ${index + 1} is missing a unit.`);
    const additionUnitInfo = validateUnit(additionUnit);
    const amount = finitePositive(addition.amount, `Addition ${index + 1} amount`);
    const percentage = concentration(addition.concentration ?? 0, `Addition ${index + 1} concentration`);
    if (additionUnitInfo.kind !== targetKind) throw new Error('All additions must use compatible units.');
    const normalized = additionUnit !== targetUnit ? convertQuantity(amount, additionUnit, targetUnit, { density: addition.density }) : amount;
    total += normalized;
    active += normalized * percentage / 100;
  }
  return Object.freeze({ concentration: active / total * 100, totalAmount: total, unit: targetUnit });
}

/** Sum batch additions, grouped by material and normalized to one unit family. */
export function calculateBatchTotals(additions, { unit } = {}) {
  if (!Array.isArray(additions) || additions.length === 0) throw new Error('At least one batch addition is required.');
  const targetUnit = unit ?? additions[0]?.unit;
  if (!targetUnit) throw new Error('A unit is required for each batch addition.');
  const targetKind = validateUnit(targetUnit).kind;
  const totals = new Map();
  let totalAmount = 0;
  let totalActiveAmount = 0;
  for (const [index, addition] of additions.entries()) {
    if (!addition?.materialId) throw new Error(`Batch addition ${index + 1} is missing materialId.`);
    const additionUnit = addition.unit ?? targetUnit;
    const amount = finitePositive(addition.amount, `Batch addition ${index + 1} amount`);
    if (validateUnit(additionUnit).kind !== targetKind) throw new Error('All batch additions must use compatible units.');
    const normalized = additionUnit !== targetUnit ? convertQuantity(amount, additionUnit, targetUnit, { density: addition.density }) : amount;
    totalAmount += normalized;
    totalActiveAmount += normalized * concentration(addition.concentration ?? 100, `Batch addition ${index + 1} concentration`) / 100;
    totals.set(addition.materialId, (totals.get(addition.materialId) ?? 0) + normalized);
  }
  return Object.freeze({ totalAmount, totalActiveAmount, unit: targetUnit, byMaterial: Object.fromEntries(totals) });
}

export { units };
