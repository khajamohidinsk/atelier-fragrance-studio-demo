import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInitialState } from '../../src/domain/store.mjs';
import { serializeBackup } from '../../src/domain/backup.mjs';

let fixtureDirectory;
let validImportPath;
let conflictPath;
let replacementPath;
let malformedPath;
let futurePath;
let structuralPath;

async function writeJson(name, value) {
  const filePath = path.join(fixtureDirectory, name);
  await fs.writeFile(filePath, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}

function stateWithJournal(title) {
  const state = createInitialState();
  state.journalEntries = [{ id: `journal-${title.toLowerCase().replace(/\s+/g, '-')}`, title, observedAt: '2026-10-25T10:00:00.000Z', purpose: 'Synthetic browser acceptance fixture', opening: 'Recorded fixture opening.', descriptors: ['synthetic'], tags: ['b6'], provenance: 'synthetic-demo', experimentId: undefined, attachmentRefs: [] }, ...state.journalEntries];
  return state;
}

test.beforeAll(async () => {
  fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-b6-browser-'));

  const validState = stateWithJournal('Imported portability record');
  validState.companionEntries = [{ id: 'companion-b6-import', materialName: 'Synthetic cedar accord', evaluationType: 'blend', concentration: '10%', evaluationMethod: 'blotter', elapsedTime: '15 minutes', originalText: 'Cool, dry, and slightly waxy.', correctedText: 'Cool, dry, and slightly waxy.', createdAt: '2026-10-25T10:15:00.000Z', updatedAt: '2026-10-25T10:15:00.000Z', source: 'typed', aiSuggestions: [] }];
  validImportPath = await writeJson('valid-import.json', serializeBackup(validState));

  const conflictState = createInitialState();
  conflictState.journalEntries = [{ ...conflictState.journalEntries[0], title: 'Incoming conflicting title' }, ...conflictState.journalEntries.slice(1)];
  conflictPath = await writeJson('conflict.json', serializeBackup(conflictState));

  const replacementState = stateWithJournal('Replacement-only record');
  replacementState.companionEntries = [];
  replacementPath = await writeJson('replacement.json', serializeBackup(replacementState));

  malformedPath = await writeJson('malformed.json', '{');
  futurePath = await writeJson('future.json', { format: 'atelier-scent-lab-backup', backupVersion: 1, schemaVersion: 99, state: {} });
  structuralPath = await writeJson('structural-invalid.json', { format: 'atelier-scent-lab-backup', backupVersion: 1, schemaVersion: 2, state: { ...createInitialState(), experiments: [{ ...createInitialState().experiments[0], formulaRevisionIds: ['missing-revision'] }] } });
});

test.afterAll(async () => {
  if (fixtureDirectory) await fs.rm(fixtureDirectory, { recursive: true, force: true });
});

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#stat-journal')).toHaveText('1');
}

async function importBackup(page, filePath, mode = 'merge') {
  await page.locator('#import-file').setInputFiles(filePath);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await expect(page.locator('#import-preview')).toContainText('Schema');
  await page.locator(mode === 'replace' ? '#import-replace' : '#import-merge').click();
}

async function savedState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('atelier-lab-state-v1')));
}

test('valid import shows preview, applies explicitly, and survives reload', async ({ page }) => {
  await openApp(page);
  await importBackup(page, validImportPath);
  await expect(page.locator('#toast')).toContainText('Backup merged; 2 records added');
  await expect(page.locator('#stat-journal')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#stat-journal')).toHaveText('2');
  const state = await savedState(page);
  expect(state.journalEntries.some(entry => entry.title === 'Imported portability record')).toBe(true);
  expect(state.companionEntries.some(entry => entry.id === 'companion-b6-import')).toBe(true);
});

test('repeated merge of the same backup does not duplicate records or movements', async ({ page }) => {
  await openApp(page);
  await importBackup(page, validImportPath);
  await expect(page.locator('#toast')).toContainText('Backup merged; 2 records added');
  await importBackup(page, validImportPath);
  await expect(page.locator('#toast')).toContainText('Backup merged; 0 records added');
  const state = await savedState(page);
  expect(new Set(state.journalEntries.map(entry => entry.id)).size).toBe(state.journalEntries.length);
  expect(new Set(state.companionEntries.map(entry => entry.id)).size).toBe(state.companionEntries.length);
  expect(new Set(state.stockMovements.map(movement => movement.id)).size).toBe(state.stockMovements.length);
});

test('conflict preview identifies changed IDs and merge preserves the local record', async ({ page }) => {
  await openApp(page);
  await page.locator('#import-file').setInputFiles(conflictPath);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await expect(page.locator('#import-preview')).toContainText('changed IDs: 1');
  await page.locator('#import-merge').click();
  await expect(page.locator('#toast')).toContainText('1 conflicts kept local');
  const state = await savedState(page);
  expect(state.journalEntries.find(entry => entry.id === 'journal-seed-1').title).toBe('Rain on warm stone');
});

test('replace creates recovery and the UI restores the prior local state', async ({ page }) => {
  await openApp(page);
  await importBackup(page, replacementPath, 'replace');
  await expect(page.locator('#toast')).toContainText('previous local state is available for recovery');
  await expect(page.locator('#stat-journal')).toHaveText('2');

  await page.locator('#import-file').setInputFiles(replacementPath);
  await expect(page.locator('#import-dialog')).toBeVisible();
  await expect(page.locator('#import-recovery')).toBeVisible();
  await page.locator('#import-recovery').click();
  await expect(page.locator('#toast')).toContainText('Previous local state restored');
  await page.reload();
  await expect(page.locator('#stat-journal')).toHaveText('1');
  const state = await savedState(page);
  expect(state.journalEntries.some(entry => entry.title === 'Rain on warm stone')).toBe(true);
  expect(state.journalEntries.some(entry => entry.title === 'Replacement-only record')).toBe(false);
});

test('malformed, future, and structurally invalid files do not change persisted state', async ({ page }) => {
  await openApp(page);
  const before = await page.evaluate(() => localStorage.getItem('atelier-lab-state-v1'));
  for (const filePath of [malformedPath, futurePath, structuralPath]) {
    await page.locator('#import-file').setInputFiles(filePath);
    await expect(page.locator('#import-dialog')).toBeHidden();
    await expect(page.locator('#toast')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('atelier-lab-state-v1'))).toBe(before);
  }
  await page.reload();
  await expect(page.locator('#stat-journal')).toHaveText('1');
});

test('actual UI export round-trips Companion records and linked state through a clean profile', async ({ browser, page }) => {
  await openApp(page);
  await page.getByRole('button', { name: /Scent Companion/ }).click();
  await page.locator('input[name="materialName"]').fill('Synthetic sandalwood accord');
  await page.locator('textarea[name="observationText"]').fill('Soft, dry, and quietly creamy.');
  await page.getByRole('button', { name: 'Save observation' }).click();
  await expect(page.locator('#companion-entry-count')).toHaveText('1');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath).toBeTruthy();
  const exported = JSON.parse(await fs.readFile(exportedPath, 'utf8'));
  expect(exported.format).toBe('atelier-scent-lab-backup');
  expect(exported.state.companionEntries).toHaveLength(1);
  expect(exported.state.batches[0].actualAdditions[0].stockMovementId).toBe('movement-seed-1');

  const cleanContext = await browser.newContext();
  const cleanPage = await cleanContext.newPage();
  await openApp(cleanPage);
  await importBackup(cleanPage, exportedPath);
  await cleanPage.getByRole('button', { name: /Scent Companion/ }).click();
  await expect(cleanPage.locator('#companion-entry-count')).toHaveText('1');
  await expect(cleanPage.locator('#companion-entry-list')).toContainText('Synthetic sandalwood accord');
  await cleanPage.reload();
  const restored = await savedState(cleanPage);
  expect(restored.experiments[0].formulaRevisionIds).toEqual(['revision-seed-1']);
  expect(restored.batches[0].actualAdditions[0].stockMovementId).toBe('movement-seed-1');
  expect(restored.evaluations[0].revisionId).toBe('revision-seed-1');
  expect(restored.companionEntries[0].originalText).toBe('Soft, dry, and quietly creamy.');
  expect(new Set(restored.stockMovements.map(movement => movement.id)).size).toBe(restored.stockMovements.length);
  await cleanContext.close();
});
