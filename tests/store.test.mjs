import test from 'node:test';
import assert from 'node:assert/strict';
import { addBatch, addCompanionEntry, addEvaluation, addExperiment, addJournalEntry, addMaterial, addMaterialLot, addRevision, addStockMovement, batchSummary, createInitialState, deleteCompanionEntry, deleteLot, deleteMaterial, exportState, importLegacyCompanionEntries, inventorySummary, normalizeState, reconcileLot, reconcileLotOpening, reverseStockMovement, saveState, stockBalance, stockStatus, updateCompanionEntry, updateJournalEntry, validateState } from '../src/domain/store.mjs';

test('normalizeState never fills incomplete state with demo seed records', () => {
  const normalized = normalizeState({ version: 2 });
  assert.deepEqual(normalized.journalEntries, []);
  assert.deepEqual(normalized.experiments, []);
  assert.deepEqual(normalized.revisions, []);
  assert.deepEqual(normalized.materials, []);
  assert.deepEqual(normalized.batches, []);
  assert.deepEqual(normalized.evaluations, []);
  assert.deepEqual(normalized.stockMovements, []);
  assert.deepEqual(normalized.companionEntries, []);
  assert.ok(!JSON.stringify(normalized).includes('seed'), 'normalization must not inject seed records');
});

test('normalizeState preserves provided records without inventing linked records', () => {
  const journal = { id: 'journal-own', title: 'Own entry', observedAt: '2026-10-20T00:00:00.000Z' };
  const normalized = normalizeState({ version: 2, journalEntries: [journal] });
  assert.deepEqual(normalized.journalEntries, [journal]);
  assert.deepEqual(normalized.batches, []);
  assert.deepEqual(normalized.stockMovements, []);
});

test('normalizeState rejects non-object, future, and invalid version input instead of seeding', () => {
  assert.throws(() => normalizeState(null), /must be a JSON object/);
  assert.throws(() => normalizeState('nope'), /must be a JSON object/);
  assert.throws(() => normalizeState([1, 2]), /must be a JSON object/);
  assert.throws(() => normalizeState({ version: 99 }), /unsupported schema version/);
  assert.throws(() => normalizeState({ version: '2' }), /schema version is invalid/);
  assert.throws(() => normalizeState({ version: 1.5 }), /schema version is invalid/);
});

test('normalizeState rejects malformed material records instead of replacing them', () => {
  assert.throws(() => normalizeState({ version: 2, materials: [null] }), /Material records must be JSON objects/);
  assert.throws(() => normalizeState({ version: 2, materials: [{ id: 'm-1', lots: [null] }] }), /Material lot records must be JSON objects/);
});

test('validateState operates on the provided state only', () => {
  const validated = validateState({ version: 2 });
  assert.deepEqual(validated.materials, []);
  assert.deepEqual(validated.stockMovements, []);
});

test('journal, experiment, revision, batch, and evaluation remain linked', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: createInitialState().stockMovements.slice(0, 2) };
  state = addJournalEntry(state, { title: 'Test memory', purpose: 'Check a citrus opening' });
  state = addExperiment(state, { title: 'Citrus trial', objective: 'Test lift', status: 'Draft' });
  const experiment = state.experiments[0];
   state = addRevision(state, experiment.id, { notes: 'Revision one', ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 1, unit: 'g' }] });
  const revision = state.revisions[0];
   state = addBatch(state, experiment.id, { formulaRevisionId: revision.id, plannedAmount: 1, unit: 'g', actualAdditions: [{ materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 1, unit: 'g', concentration: 100 }] });
  const batch = state.batches[0];
  state = addEvaluation(state, experiment.id, { batchId: batch.id, revisionId: revision.id, subjectiveNotes: 'Brighter than expected' });
  assert.deepEqual(state.experiments[0].formulaRevisionIds, [revision.id]);
  assert.deepEqual(state.experiments[0].batchIds, [batch.id]);
  assert.equal(state.experiments[0].evaluationIds.length, 1);
  assert.equal(state.experiments[0].status, 'Evaluated');
});

test('historical formula revisions are appended, never overwritten', () => {
  let state = createInitialState();
  const experimentId = state.experiments[0].id;
  const firstRevisionId = state.experiments[0].formulaRevisionIds[0];
  state = addRevision(state, experimentId, { notes: 'Second pass', ingredients: [] });
  assert.equal(state.revisions.find(item => item.id === firstRevisionId).revision, 1);
  assert.equal(state.revisions.find(item => item.supersedesRevisionId === firstRevisionId).revision, 2);
});

test('batch summary keeps actual material traceability', () => {
  const batch = { unit: 'g', actualAdditions: [{ materialId: 'a', amount: 2, unit: 'g', concentration: 100 }, { materialId: 'b', amount: 8, unit: 'g', concentration: 0 }] };
  assert.deepEqual(batchSummary(batch), { totalAmount: 10, totalActiveAmount: 2, unit: 'g', byMaterial: { a: 2, b: 8 }, byLot: {}, variance: null });
});

test('state export is portable JSON', () => { const exported = JSON.parse(exportState(createInitialState())); assert.equal(exported.version, 2); assert.ok(exported.exportedAt); });

test('companion observations preserve original and corrected text through edits', () => {
  let state = { ...createInitialState(), companionEntries: [] };
  state = addCompanionEntry(state, { materialName: 'Cedarwood', evaluationType: 'stock dilution', concentration: '10%', originalText: 'Dry and pencil-like', correctedText: 'Dry and pencil-like', source: 'speech' });
  const created = state.companionEntries[0];
  assert.equal(created.originalText, 'Dry and pencil-like');
  state = updateCompanionEntry(state, created.id, { correctedText: 'Dry, pencil-like, and quietly smoky', elapsedTime: '15 minutes' });
  assert.equal(state.companionEntries[0].originalText, 'Dry and pencil-like');
  assert.equal(state.companionEntries[0].correctedText, 'Dry, pencil-like, and quietly smoky');
  assert.equal(state.companionEntries[0].elapsedTime, '15 minutes');
  assert.ok(state.companionEntries[0].updatedAt);
});

test('legacy companion storage imports without losing context or timestamps', () => {
  const legacy = { schemaVersion: 1, entries: [{ id: 'legacy-1', materialName: 'Rose', evaluationType: 'blend', concentration: '5%', evaluationMethod: 'blotter', elapsedTime: '30 minutes', originalText: 'Petal-like', correctedText: 'Petal-like and airy', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-10-20T10:05:00.000Z', source: 'typed' }] };
  const storage = { getItem: key => key === 'atelier.scent-companion.v1' ? JSON.stringify(legacy) : null };
  const result = importLegacyCompanionEntries({ ...createInitialState(), companionEntries: [] }, storage);
  assert.equal(result.imported, 1);
  assert.deepEqual({ ...result.state.companionEntries[0], aiSuggestions: undefined }, { ...legacy.entries[0], aiSuggestions: undefined });
});

test('legacy companion import merges older entries even when newer entries already exist', () => {
  const legacy = { schemaVersion: 1, entries: [
    { id: 'legacy-existing', materialName: 'Rose', originalText: 'Already imported', createdAt: '2026-10-20T10:00:00.000Z' },
    { id: 'legacy-older', materialName: 'Iris', originalText: 'Powdery and cool', createdAt: '2026-10-19T10:00:00.000Z' }
  ] };
  const current = { ...createInitialState(), companionEntries: [{ id: 'legacy-existing', materialName: 'Rose', originalText: 'Already imported', correctedText: 'Already imported', createdAt: '2026-10-20T10:00:00.000Z' }, { id: 'new-format', materialName: 'Cedar', originalText: 'Dry', createdAt: '2026-10-21T10:00:00.000Z' }] };
  const storage = { getItem: key => key === 'atelier.scent-companion.v1' ? JSON.stringify(legacy) : null };
  const result = importLegacyCompanionEntries(current, storage);
  assert.equal(result.imported, 1);
  assert.deepEqual(result.state.companionEntries.map(entry => entry.id), ['legacy-existing', 'new-format', 'legacy-older']);
});

test('saveState surfaces storage failures instead of reporting success', () => {
  assert.throws(() => saveState(createInitialState(), { setItem: () => { throw new Error('quota'); } }), /Could not save Atelier data/);
});

test('companion deletion removes only the selected observation', () => {
  let state = { ...createInitialState(), companionEntries: [] };
  state = addCompanionEntry(state, { materialName: 'A', originalText: 'First' });
  state = addCompanionEntry(state, { materialName: 'B', originalText: 'Second' });
  const removedId = state.companionEntries[0].id;
  state = deleteCompanionEntry(state, removedId);
  assert.equal(state.companionEntries.length, 1);
  assert.equal(state.companionEntries[0].materialName, 'A');
});

test('stock movements replay opening, receipt, wastage, and reversal balances', () => {
  let state = createInitialState();
  const before = stockBalance(state, 'lot-seed-1');
  state = addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'receipt', quantity: 10, unit: 'g', note: 'Receipt' });
  state = addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'wastage', quantity: 2, unit: 'g', note: 'Spill' });
  const receipt = state.stockMovements.find(item => item.movementType === 'receipt');
  state = reverseStockMovement(state, receipt.id, 'Receipt correction');
  assert.equal(stockBalance(state, 'lot-seed-1'), before - 2);
  assert.equal(state.stockMovements.filter(item => item.materialLotId === 'lot-seed-1').length, 5);
});

test('stock movement rejects mismatched lots, incompatible units, duplicate ids, and insufficient stock', () => {
  const state = createInitialState();
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-2', materialLotId: 'lot-seed-1', movementType: 'receipt', quantity: 1, unit: 'g' }), /do not match/);
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'receipt', quantity: 1, unit: 'mL' }), /Density/);
  assert.throws(() => addStockMovement(state, { id: 'movement-seed-1', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'receipt', quantity: 1, unit: 'g' }), /already exists/);
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'wastage', quantity: 1000, unit: 'g', note: 'Synthetic spill test' }), /Insufficient/);
});

test('batch consumption is linked once to an exact lot and duplicate additions are rejected', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: createInitialState().stockMovements.slice(0, 2) };
  state = addExperiment(state, { title: 'Lot trial', objective: 'Trace stock' });
  const experiment = state.experiments[0];
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 1, unit: 'g' }] });
  const revision = state.revisions[0];
  state = addBatch(state, experiment.id, { formulaRevisionId: revision.id, plannedAmount: 2, unit: 'g', actualAdditions: [{ id: 'addition-once', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 2, unit: 'g', concentration: 100 }] });
  assert.equal(state.stockMovements.filter(item => item.additionId === 'addition-once').length, 1);
  const consumption = state.stockMovements.find(item => item.additionId === 'addition-once');
  assert.equal(state.batches[0].actualAdditions[0].stockMovementId, consumption.id);
  assert.equal(consumption.batchId, state.batches[0].id);
  assert.throws(() => addBatch(state, experiment.id, { formulaRevisionId: revision.id, plannedAmount: 1, unit: 'g', actualAdditions: [{ id: 'addition-once', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 1, unit: 'g', concentration: 100 }] }), /already exists/);
});

test('validateState rejects a batch addition whose linked movement belongs to another addition', () => {
  const state = createInitialState();
  // Seed has two additions each with its own consumption movement. Redirect
  // addition-1's stockMovementId to addition-2's movement: the movement ID
  // exists, so the old existence-only check passed, but the reciprocal
  // relationship is broken.
  const movementForAddition2 = state.stockMovements.find(item => item.additionId === 'addition-seed-2');
  const broken = { ...state, batches: state.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(addition => addition.id === 'addition-seed-1' ? { ...addition, stockMovementId: movementForAddition2.id } : addition) })) };
  assert.throws(() => validateState(broken), /do not reference each other/);
});

test('validateState rejects a batch addition pointing at a non-consumption movement', () => {
  const state = createInitialState();
  // Point an addition at its lot's opening movement. That movement ID exists,
  // but it is not a consumption, so it cannot back a batch addition.
  const opening = state.stockMovements.find(item => item.movementType === 'opening' && item.materialLotId === 'lot-seed-1');
  const broken = { ...state, batches: state.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(addition => addition.id === 'addition-seed-1' ? { ...addition, stockMovementId: opening.id } : addition) })) };
  assert.throws(() => validateState(broken), /consumption movement/);
});

test('validateState rejects a batch addition whose movement disagrees on material or lot', () => {
  const state = createInitialState();
  const broken = { ...state, stockMovements: state.stockMovements.map(item => item.id === 'movement-seed-1' ? { ...item, materialLotId: 'lot-seed-2' } : item) };
  assert.throws(() => validateState(broken), /disagree on material or lot/);
});

test('validateState rejects a consumption movement not mirrored by its batch addition', () => {
  const state = createInitialState();
  // Break the reverse direction: movement points at an addition that does not
  // point back at it.
  const broken = { ...state, stockMovements: state.stockMovements.map(item => item.id === 'movement-seed-1' ? { ...item, additionId: 'addition-seed-2' } : item) };
  assert.throws(() => validateState(broken), /do not reference each other|unknown batch addition/);
});

test('validateState rejects a batch addition whose movement disagrees on quantity', () => {
  const state = createInitialState();
  // addition-seed-1 is 20 g; its movement-seed-1 says 25 g. IDs, batch, lot and
  // unit all match, so only the quantity check catches this.
  const broken = { ...state, stockMovements: state.stockMovements.map(item => item.id === 'movement-seed-1' ? { ...item, quantity: 25 } : item) };
  assert.throws(() => validateState(broken), /disagree on quantity or unit/);
});

test('validateState rejects a batch addition whose movement disagrees on unit family without density', () => {
  const state = createInitialState();
  // Same numeric value, but mass (g) vs volume (mL) with no density recorded
  // for lot-seed-1, so the units are not interchangeable.
  const broken = { ...state, stockMovements: state.stockMovements.map(item => item.id === 'movement-seed-1' ? { ...item, unit: 'mL', density: undefined } : item) };
  const lot = broken.materials.flatMap(m => m.lots).find(l => l.id === 'lot-seed-1');
  delete lot.density;
  assert.throws(() => validateState(broken), /disagree on quantity or unit/);
});

test('validateState rejects a movement re-expressed in an equivalent but different unit', () => {
  const state = createInitialState();
  // 20 g == 20000 mg is the same physical amount, but the reciprocal link
  // records one exact quantity and unit. Silently re-expressing one side makes
  // the two records disagree on what was written down, so it is rejected
  // rather than left for a later reader to reconcile.
  const converted = { ...state, stockMovements: state.stockMovements.map(item => item.id === 'movement-seed-1' ? { ...item, quantity: 20000, unit: 'mg' } : item) };
  assert.throws(() => validateState(converted), /disagree on quantity or unit/);
});

test('validateState rejects two additions sharing one consumption movement', () => {
  const state = createInitialState();
  // addition-seed-2 already points at movement-seed-2. Redirect it to
  // movement-seed-1 so both additions claim the same consumption.
  const broken = { ...state, batches: state.batches.map(batch => ({ ...batch, actualAdditions: batch.actualAdditions.map(addition => addition.id === 'addition-seed-2' ? { ...addition, stockMovementId: 'movement-seed-1' } : addition) })) };
  assert.throws(() => validateState(broken), /do not reference each other/);
});

test('normalizeMovement rejects a reversal whose reference belongs to another lot', () => {
  const state = createInitialState();
  // movement-seed-1 is a lot-seed-1 consumption. A reversal recorded against
  // lot-seed-2 but pointing at that movement crosses lots, so it is refused.
  assert.throws(
    () => addStockMovement(state, { materialId: 'material-seed-2', materialLotId: 'lot-seed-2', movementType: 'reversal', quantity: 20, unit: 'g', referenceMovementId: 'movement-seed-1' }),
    /same lot/
  );
});

test('reverseStockMovement rejects an unknown movement id', () => {
  const state = createInitialState();
  assert.throws(() => reverseStockMovement(state, 'movement-does-not-exist'), /not found/);
});

test('normalizeMovement rejects a reversal referencing a movement that does not exist', () => {
  const state = createInitialState();
  assert.throws(
    () => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'reversal', quantity: 5, unit: 'g', referenceMovementId: 'movement-nope' }),
    /must reference an existing stock movement/
  );
});

test('validateState accepts a well-formed state after reciprocal checks', () => {
  const state = createInitialState();
  const validated = validateState(state);
  assert.ok(validated.batches.length > 0);
  assert.ok(validated.stockMovements.length > 0);
});

test('relationship helpers reject cross-experiment references and preserve reverse links', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: createInitialState().stockMovements.slice(0, 2) };
  state = addExperiment(state, { title: 'First', objective: 'First' });
  state = addExperiment(state, { title: 'Second', objective: 'Second' });
  const first = state.experiments[1]; const second = state.experiments[0];
  state = addRevision(state, first.id, { ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 1, unit: 'g' }] });
  const firstRevision = state.revisions[0];
  assert.throws(() => addRevision(state, second.id, { supersedesRevisionId: firstRevision.id, ingredients: [] }), /current latest|predecessor/);
  assert.throws(() => addBatch(state, second.id, { formulaRevisionId: firstRevision.id, plannedAmount: 1, unit: 'g', actualAdditions: [{ materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 1, unit: 'g', concentration: 100 }] }), /revision belonging/);
  state = addJournalEntry(state, { title: 'Linked', experimentId: first.id });
  assert.deepEqual(state.experiments.find(item => item.id === first.id).journalEntryIds, [state.journalEntries[0].id]);
});

test('editing a journal entry moves its reverse experiment link without orphaning history', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: createInitialState().stockMovements.slice(0, 2) };
  state = addExperiment(state, { title: 'First', objective: 'First' });
  state = addExperiment(state, { title: 'Second', objective: 'Second' });
  const first = state.experiments[1]; const second = state.experiments[0];
  state = addJournalEntry(state, { title: 'Memory', experimentId: first.id });
  const entry = state.journalEntries[0];
  state = updateJournalEntry(state, entry.id, { experimentId: second.id });
  assert.deepEqual(state.experiments.find(item => item.id === first.id).journalEntryIds, []);
  assert.deepEqual(state.experiments.find(item => item.id === second.id).journalEntryIds, [entry.id]);
});

test('referenced materials and lots cannot be deleted or orphan their history', () => {
  const state = createInitialState();
  assert.throws(() => deleteMaterial(state, 'material-seed-1'), /cannot be deleted/);
  assert.throws(() => deleteLot(state, 'lot-seed-1'), /cannot be deleted/);
});

test('evaluations reject foreign batches and mismatched revisions', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: createInitialState().stockMovements.slice(0, 2) };
  state = addExperiment(state, { title: 'One', objective: 'One' });
  state = addExperiment(state, { title: 'Two', objective: 'Two' });
  const one = state.experiments[1]; const two = state.experiments[0];
  state = addRevision(state, one.id, { ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 1, unit: 'g' }] });
  const revision = state.revisions[0];
  state = addBatch(state, one.id, { formulaRevisionId: revision.id, plannedAmount: 1, unit: 'g', actualAdditions: [{ materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 1, unit: 'g', concentration: 100 }] });
  const batch = state.batches[0];
  assert.throws(() => addEvaluation(state, two.id, { batchId: batch.id }), /does not belong/);
  assert.throws(() => addEvaluation(state, one.id, { batchId: batch.id, revisionId: 'foreign-revision' }), /does not belong/);
});

function lotWithoutOpening() {
  const state = createInitialState();
  return { ...state, materials: state.materials.map(material => ({ ...material, lots: material.lots.map(lot => { const { receivedAmount, receivedUnit, ...rest } = lot; return rest; }) })), stockMovements: state.stockMovements.filter(item => item.movementType !== 'opening') };
}

test('a lot with no trustworthy opening reports an unreconciled status, not a balance', () => {
  const state = lotWithoutOpening();
  const status = stockStatus(state, 'lot-seed-1');
  assert.equal(status.established, false);
  assert.equal(status.balanceKnown, false);
  // The replay is a floor of recorded consumption only, never a stock figure.
  assert.ok(status.balance < 0, `expected a negative floor, got ${status.balance}`);
  assert.match(status.note, /floor/);
});

test('a lot with an established opening reports a reconciled balance', () => {
  const state = createInitialState();
  const status = stockStatus(state, 'lot-seed-1');
  assert.equal(status.established, true);
  assert.equal(status.balanceKnown, true);
  // Seed records 100 g opening and 20 g consumption.
  assert.ok(Math.abs(status.balance - 80) < 1e-9, `expected 80, got ${status.balance}`);
  assert.match(status.note, /established/);
});

test('consumption is blocked on an unreconciled lot until its opening is recorded', () => {
  const state = lotWithoutOpening();
  assert.throws(
    () => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'consumption', quantity: 1, unit: 'g', batchId: 'batch-seed-1', additionId: 'addition-seed-1' }),
    /no established opening balance/
  );
});

test('non-consumption movements stay permitted on an unreconciled lot', () => {
  const state = lotWithoutOpening();
  // A receipt is exactly how a user records stock they then know about.
  const next = addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'receipt', quantity: 50, unit: 'g', note: 'Found the bottle' });
  assert.ok(next.stockMovements.some(item => item.movementType === 'receipt'));
});

test('reconcileLotOpening records a user-supplied opening and unblocks consumption', () => {
  let state = lotWithoutOpening();
  state = reconcileLotOpening(state, 'lot-seed-1', { quantity: 60, unit: 'g' });
  const status = stockStatus(state, 'lot-seed-1');
  assert.equal(status.established, true);
  assert.equal(status.balanceKnown, true);
  // The fixture already carries 20 g of legacy consumption, so a 60 g opening
  // replays to 40 g rather than the raw opening figure.
  assert.ok(Math.abs(status.balance - 40) < 1e-9, `expected 40, got ${status.balance}`);
  // Consumption now proceeds through the real batch workflow: 40 g on hand
  // minus a further 5 g draw. Before reconciliation this same batch would have
  // been refused for having no established opening.
  const after = addBatch(state, 'experiment-seed-1', { formulaRevisionId: 'revision-seed-1', plannedAmount: 5, unit: 'g', actualAdditions: [{ materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 5, unit: 'g', concentration: 100 }] });
  assert.ok(Math.abs(stockBalance(after, 'lot-seed-1') - 35) < 1e-9, `expected 35, got ${stockBalance(after, 'lot-seed-1')}`);
});

test('reconcileLotOpening refuses to overwrite an established opening', () => {
  const state = createInitialState();
  assert.throws(() => reconcileLotOpening(state, 'lot-seed-1', { quantity: 999, unit: 'g' }), /already has an established opening/);
});

test('returns require explicit confirmation and increase the lot balance', () => {
  const before = stockBalance(createInitialState(), 'lot-seed-1');
  assert.throws(() => addStockMovement(createInitialState(), { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'return', quantity: 2, unit: 'g', note: 'Returned' }), /explicit confirmation/);
  const state = addStockMovement(createInitialState(), { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'return', quantity: 2, unit: 'g', confirmedReturn: true, note: 'Customer return confirmed' });
  assert.equal(stockBalance(state, 'lot-seed-1'), before + 2);
});

test('corrections are compensating movements tied to the original lot movement', () => {
  const state = createInitialState();
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'correction', quantity: 1, unit: 'g', direction: 'increase', note: 'Correction' }), /referenceMovementId/);
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-2', materialLotId: 'lot-seed-2', movementType: 'correction', quantity: 1, unit: 'g', direction: 'increase', referenceMovementId: 'movement-seed-opening-1', note: 'Wrong lot' }), /same lot/);
  const withReceipt = addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'receipt', quantity: 3, unit: 'g', note: 'Recorded receipt' });
  const receipt = withReceipt.stockMovements.at(-1);
  const corrected = addStockMovement(withReceipt, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'correction', quantity: 1, unit: 'g', direction: 'decrease', referenceMovementId: receipt.id, note: 'Corrected receipt count' });
  assert.equal(corrected.stockMovements.at(-1).referenceMovementId, receipt.id);
});

test('adjustments and disposals require an auditable reason', () => {
  const state = createInitialState();
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'adjustment', quantity: 1, unit: 'g', direction: 'increase', note: 'Count' }), /explicit verification/);
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'adjustment', quantity: 1, unit: 'g', direction: 'increase', verified: true }), /require a reason/);
  assert.throws(() => addStockMovement(state, { materialId: 'material-seed-1', materialLotId: 'lot-seed-1', movementType: 'wastage', quantity: 1, unit: 'g' }), /require a reason/);
});

test('reconciliation previews and records only the variance', () => {
  const result = reconcileLot(createInitialState(), 'lot-seed-1', { physicalQuantity: 75, unit: 'g', reason: 'Verified bottle count' });
  assert.equal(result.variance, -5);
  assert.equal(stockBalance(result.state, 'lot-seed-1'), 75);
  const adjustment = result.state.stockMovements.at(-1);
  assert.equal(adjustment.movementType, 'adjustment');
  assert.equal(adjustment.direction, 'decrease');
});

test('material and lot operations preserve unknown values and reject duplicate lot codes', () => {
  let state = { ...createInitialState(), materials: [], stockMovements: [], revisions: [], batches: [], experiments: [], evaluations: [], journalEntries: [] };
  state = addMaterial(state, { name: 'Unknown jasmine', supplier: 'Supplier not recorded' });
  const materialId = state.materials[0].id;
  state = addMaterialLot(state, materialId, { lotCode: 'JAS-1' });
  assert.equal(state.materials[0].lots[0].receivedAmount, undefined);
  assert.equal(stockStatus(state, state.materials[0].lots[0].id).balanceKnown, false);
  assert.throws(() => addMaterialLot(state, materialId, { lotCode: 'JAS-1' }), /already used/);
});

test('batch retries with the same idempotency key do not duplicate consumption', () => {
  let state = { ...createInitialState(), experiments: [], revisions: [], journalEntries: [], batches: [], evaluations: [], stockMovements: createInitialState().stockMovements.slice(0, 2) };
  state = addExperiment(state, { title: 'Idempotent trial', objective: 'Retry safety' });
  const experiment = state.experiments[0];
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-1', lotId: 'lot-seed-1', quantity: 1, unit: 'g' }] });
  const revision = state.revisions[0];
  const input = { formulaRevisionId: revision.id, plannedAmount: 1, unit: 'g', idempotencyKey: 'request-1', actualAdditions: [{ id: 'retry-addition', materialId: 'material-seed-1', materialLotId: 'lot-seed-1', amount: 1, unit: 'g', concentration: 100 }] };
  const first = addBatch(state, experiment.id, input);
  const second = addBatch(first, experiment.id, input);
  assert.equal(second.batches.length, first.batches.length);
  assert.equal(second.stockMovements.length, first.stockMovements.length);
});

test('inventory summary exposes unknown, low-stock, and date warnings', () => {
  let state = createInitialState();
  state = { ...state, materials: state.materials.map(material => ({ ...material, lots: material.lots.map(lot => lot.id === 'lot-seed-1' ? { ...lot, lowStockThreshold: 90, expiryDate: '2020-01-01' } : lot) })) };
  const summary = inventorySummary(state, { today: '2026-10-24' });
  assert.equal(summary.lowStock.length, 1);
  assert.equal(summary.dateWarnings.length, 1);
  assert.equal(summary.unknownLots.length, 0);
});
