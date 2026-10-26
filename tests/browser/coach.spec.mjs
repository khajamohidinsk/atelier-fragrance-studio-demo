import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInitialState } from '../../src/domain/store.mjs';
import { serializeBackup } from '../../src/domain/backup.mjs';

let fixtureDirectory;
let deviationFixture;

test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-coach-browser-'));
  deviationFixture = path.join(fixtureDirectory, 'coach-deviation.json');
  const state = createInitialState();
  state.batches = state.batches.map(batch => batch.id === 'batch-seed-1' ? { ...batch, deviations: 'Actual handling deviated from the planned procedure.' } : batch);
  await fs.writeFile(deviationFixture, serializeBackup(state), 'utf8');
});

test.afterAll(async () => { if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true }); });

test('Experiment Coach builds a read-only source-linked debrief without changing local state', async ({ page }) => {
  await page.goto('/');
  const before = await page.evaluate(() => localStorage.getItem('atelier-lab-state-v1'));
  await page.getByRole('button', { name: /Experiment Coach/ }).click();
  await expect(page.locator('#coach-experiment')).toHaveValue('experiment-seed-1');
  await page.getByRole('button', { name: 'Build debrief' }).click();
  await expect(page.locator('#coach-output')).toContainText('Read-only debrief.');
  await expect(page.locator('#coach-output')).toContainText('experiment:experiment-seed-1');
  await expect(page.locator('#coach-output')).toContainText('revision:revision-seed-1');
  await expect(page.locator('#coach-output')).toContainText('PROPOSED NEXT CONTROLLED EXPERIMENT');
  expect(await page.evaluate(() => localStorage.getItem('atelier-lab-state-v1'))).toBe(before);
});

test('Experiment Coach recommendation responds to recorded batch deviation', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles(deviationFixture);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#import-replace').click();
  await page.getByRole('button', { name: /Experiment Coach/ }).click();
  await page.getByRole('button', { name: 'Build debrief' }).click();
  await expect(page.locator('#coach-output')).toContainText('recorded actual-versus-planned differences or deviations');
  await expect(page.locator('#coach-output')).toContainText('batch:batch-seed-1');
  await expect(page.locator('#coach-output')).toContainText('Read-only debrief.');
});
