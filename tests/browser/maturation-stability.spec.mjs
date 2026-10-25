import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addBatch, addExperiment, addRevision, createInitialState } from '../../src/domain/store.mjs';
import { serializeBackup } from '../../src/domain/backup.mjs';

let fixtureDirectory;
let fixturePath;

function stateWithBatch() {
  let state = createInitialState();
  state = addExperiment(state, { experimentId: 'EXP-MAT-BROWSER', title: 'Maturation browser candidate', objective: 'Record time-based observations.' });
  const experiment = state.experiments.find(item => item.experimentId === 'EXP-MAT-BROWSER');
  state = addRevision(state, experiment.id, { ingredients: [{ materialId: 'material-seed-2', lotId: 'lot-seed-2', quantity: 10, unit: 'g' }] });
  const revision = state.revisions.find(item => item.experimentId === experiment.id);
  return addBatch(state, experiment.id, { id: 'batch-maturation-browser', batchCode: 'BATCH-MAT', formulaRevisionId: revision.id, plannedAmount: 10, unit: 'g', mixingDate: '2026-10-20T10:00:00.000Z', actualAdditions: [{ id: 'addition-maturation-browser', materialId: 'material-seed-2', materialLotId: 'lot-seed-2', amount: 10, unit: 'g', concentration: 100 }] });
}

test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-maturation-browser-'));
  fixturePath = path.join(fixtureDirectory, 'maturation-fixture.json');
  await fs.writeFile(fixturePath, serializeBackup(stateWithBatch()), 'utf8');
});

test.afterAll(async () => { if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true }); });

test('maturation plan schedules custom checkpoints, records evidence, compares timeline, and survives reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles(fixturePath);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#import-replace').click();
  await page.getByRole('button', { name: /Maturation & stability/ }).click();
  await page.getByRole('button', { name: /New observation plan/ }).click();
  await page.locator('#maturation-plan-form input[name="name"]').fill('Amber 7-day tracker');
  await page.locator('#maturation-plan-form textarea[name="purpose"]').fill('Document visible changes without inventing a stability verdict.');
  await page.locator('#maturation-plan-form textarea[name="storageConditions"]').fill('Dark cabinet, sealed amber vial.');
  await page.locator('#maturation-plan-form button[type="submit"]').click();
  const plan = page.locator('[data-maturation-plan-id]').first();
  await expect(plan).toContainText('Amber 7-day tracker');
  await expect(plan).toContainText('upcoming');
  await plan.getByRole('button', { name: /Observe 0h/ }).click();
  await page.locator('#maturation-observation-form textarea[name="appearance"]').fill('Clear');
  await page.locator('#maturation-observation-form textarea[name="clarity"]').fill('Transparent');
  await page.locator('#maturation-observation-form textarea[name="subjectiveOdour"]').fill('Soft citrus impression.');
  await page.locator('#maturation-observation-form input[name="storageTemperature"]').fill('20');
  await page.locator('#maturation-observation-form input[name="storageTemperatureUnit"]').fill('°C');
  await page.locator('#maturation-observation-form input[name="storageLocation"]').fill('Cabinet A');
  await page.locator('#maturation-observation-form button[type="submit"]').click();
  await expect(page.locator('#toast')).toContainText('Maturation observation saved');
  await expect(plan).toContainText('completed');
  await expect(plan).toContainText('Soft citrus impression.');
  await plan.getByRole('button', { name: /Observe 24h/ }).click();
  await page.locator('#maturation-observation-form textarea[name="appearance"]').fill('Slight haze');
  await page.locator('#maturation-observation-form textarea[name="clarity"]').fill('Cloudy');
  await page.locator('#maturation-observation-form textarea[name="deviations"]').fill('Recorded later than planned.');
  await page.locator('#maturation-observation-form button[type="submit"]').click();
  await expect(plan).toContainText('Change observed');
  await expect(plan).toContainText('Recorded later than planned.');
  await page.reload();
  await page.getByRole('button', { name: /Maturation & stability/ }).click();
  await expect(page.locator('#maturation-plan-list')).toContainText('Amber 7-day tracker');
  await expect(page.locator('#maturation-plan-list')).toContainText('Slight haze');
});
