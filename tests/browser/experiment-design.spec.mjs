import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInitialState } from '../../src/domain/store.mjs';
import { serializeBackup } from '../../src/domain/backup.mjs';

let fixtureDirectory;
let fixturePath;

test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-design-browser-'));
  fixturePath = path.join(fixtureDirectory, 'design-fixture.json');
  await fs.writeFile(fixturePath, serializeBackup(createInitialState()), 'utf8');
});

test.afterAll(async () => { if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true }); });

test('experiment design creates a replicate matrix, persists randomization, and links an existing batch run', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import-file').setInputFiles(fixturePath);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#import-replace').click();
  await page.getByRole('button', { name: /Experiment design/ }).click();
  await page.getByRole('button', { name: /New experiment design/ }).click();
  await page.locator('#experiment-design-form input[name="name"]').fill('Temperature repeatability design');
  await page.locator('#experiment-design-form textarea[name="researchQuestion"]').fill('Does temperature change the recorded intensity?');
  await page.locator('#experiment-design-form textarea[name="hypothesis"]').fill('The warm condition will have a higher recorded intensity.');
  await page.locator('#experiment-design-form textarea[name="factorsJson"]').fill(JSON.stringify([{ name: 'Temperature', unit: '°C', levels: [{ label: '20', value: 20 }, { label: '30', value: 30 }] }]));
  await page.locator('#experiment-design-form textarea[name="conditionsJson"]').fill(JSON.stringify([{ name: 'Baseline', revisionId: 'revision-seed-1', factorLevelIds: ['20'], replicateCount: 2 }, { name: 'Warm', revisionId: 'revision-seed-1', factorLevelIds: ['30'], replicateCount: 2 }]));
  await page.locator('#experiment-design-form textarea[name="responsesJson"]').fill(JSON.stringify([{ name: 'Intensity', kind: 'numeric', source: 'manual', unit: 'score' }]));
  await page.locator('#experiment-design-form button[type="submit"]').click();
  const design = page.locator('[data-experiment-design-id]').first();
  await expect(design).toContainText('Temperature repeatability design');
  await expect(design.locator('tbody tr')).toHaveCount(4);
  await design.getByRole('button', { name: /Randomize execution order/ }).click();
  await expect(page.locator('#toast')).toContainText('execution order randomized');
  await expect(design).toContainText('EXECUTION ORDER RANDOMIZED');
  await design.locator('tbody tr').first().getByRole('button', { name: /Update run/ }).click();
  await page.locator('#experiment-design-run-form select[name="status"]').selectOption('started');
  await page.locator('#experiment-design-run-form select[name="batchId"]').selectOption('batch-seed-1');
  await page.locator('#experiment-design-run-form button[type="submit"]').click();
  await expect(design.locator('tbody')).toContainText('started');
  await page.reload();
  await page.getByRole('button', { name: /Experiment design/ }).click();
  await expect(page.locator('#experiment-design-list')).toContainText('Temperature repeatability design');
  await expect(page.locator('#experiment-design-list')).toContainText('started');
  await expect(page.locator('#experiment-design-list')).toContainText('incomplete replication');
});
