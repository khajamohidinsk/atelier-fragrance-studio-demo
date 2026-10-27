import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addBatch, addExperiment, addRevision, createInitialState } from '../../src/domain/store.mjs';
import { serializeBackup } from '../../src/domain/backup.mjs';

let fixtureDirectory;
let fixturePath;

function stateWithTwoBatches() {
  let state = createInitialState();
  state = addExperiment(state, { experimentId: 'EXP-BLIND', title: 'Blind browser candidate', objective: 'Synthetic browser candidate' });
  const experiment = state.experiments.find(item => item.experimentId === 'EXP-BLIND');
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-2', lotId: 'lot-seed-2', quantity: 10, unit: 'g' }] });
  const revision = state.revisions.find(item => item.experimentId === experiment.id);
  return addBatch(state, experiment.id, { id: 'batch-blind-browser', batchCode: 'BATCH-002', formulaRevisionId: revision.id, plannedAmount: 10, unit: 'g', actualAdditions: [{ id: 'addition-blind-browser', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 10, unit: 'g', concentration: 100 }] });
}

test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-blind-browser-'));
  fixturePath = path.join(fixtureDirectory, 'blind-fixture.json');
  await fs.writeFile(fixturePath, serializeBackup(stateWithTwoBatches()), 'utf8');
});

test.afterAll(async () => {
  if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true });
});

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#stat-journal')).toHaveText('1');
}

async function restoreFixture(page) {
  await page.locator('#import-file').setInputFiles(fixturePath);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#import-replace').click();
  await expect(page.locator('#toast')).toContainText('Backup restored');
}

test('blind session randomizes opaque codes, records observations, locks, unblinds, and survives reload', async ({ page }) => {
  await openApp(page);
  await restoreFixture(page);
  await page.getByRole('button', { name: /Blind sensory testing/ }).click();
  await page.getByRole('button', { name: /New blind session/ }).click();
  await page.locator('#blind-session-form input[name="name"]').fill('Blind cedar comparison');
  await page.locator('#blind-session-form input[name="sessionDate"]').fill('2026-10-26');
  await page.locator('#blind-session-form input[name="evaluatorLabel"]').fill('Participant A');
  await page.locator('#blind-session-form textarea[name="purpose"]').fill('Compare two physical batches without identity cues.');
  await page.locator('#blind-session-form input[name="batchId"]').nth(0).check();
  await page.locator('#blind-session-form input[name="batchId"]').nth(1).check();
  await page.locator('#blind-session-form button[type="submit"]').click();
  await expect(page.locator('#blind-session-list')).toContainText('draft');
  await expect(page.locator('#blind-session-list')).toContainText('BATCH-001');

  const session = page.locator('[data-blind-session-id]').first();
  await session.getByRole('button', { name: /Randomize samples/ }).click();
  await expect(session).toContainText('randomized');
  await expect(session).toContainText('BT-');
  await expect(session).not.toContainText('BATCH-001');
  await expect(session).not.toContainText('Blind browser candidate');

  await session.getByRole('button', { name: /Begin evaluator view/ }).click();
  await expect(session).toContainText('in-progress');
  const observeButtons = session.locator('button[data-action="blind-observe"]');
  await expect(observeButtons).toHaveCount(2);

  await observeButtons.nth(0).click();
  await page.locator('#blind-observation-form input[name="intervalLabel"]').fill('Opening');
  await page.locator('#blind-observation-form input[name="intensity"]').fill('3');
  await page.locator('#blind-observation-form input[name="descriptors"]').fill('cool, dry');
  await page.locator('#blind-observation-form textarea[name="subjectiveNotes"]').fill('A restrained dry opening.');
  await page.locator('#blind-observation-form button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('Blind observation saved');

  await session.getByRole('button', { name: /Lock observations/ }).click();
  await expect(page.locator('#toast')).toContainText('incomplete samples');
  await session.locator('button[data-action="blind-observe"]').nth(1).click();
  await page.locator('#blind-observation-form input[name="intervalLabel"]').fill('Opening');
  await page.locator('#blind-observation-form input[name="intensity"]').fill('4');
  await page.locator('#blind-observation-form input[name="descriptors"]').fill('soft, green');
  await page.locator('#blind-observation-form textarea[name="subjectiveNotes"]').fill('A softer green impression.');
  await page.locator('#blind-observation-form button[type="submit"]').click();
  await session.getByRole('button', { name: /Lock observations/ }).click();
  await expect(session).toContainText('locked');
  await expect(session).not.toContainText('BATCH-001');
  await session.getByRole('button', { name: /Unblind session/ }).click();
  await expect(session).toContainText('unblinded');
  await expect(session).toContainText('BATCH-001');
  await expect(session).toContainText('BATCH-002');

  await page.reload();
  await page.getByRole('button', { name: /Blind sensory testing/ }).click();
  await expect(page.locator('#blind-session-list')).toContainText('unblinded');
  await expect(page.locator('#blind-session-list')).toContainText('BATCH-001');
});
