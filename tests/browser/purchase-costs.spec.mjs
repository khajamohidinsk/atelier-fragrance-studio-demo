import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#stat-journal')).toHaveText('1');
}

test('records a receipt-backed purchase, persists it, and shows partial actual batch costing', async ({ page, browser }) => {
  await openApp(page);
  await page.getByRole('button', { name: /Purchases & costs/ }).click();
  await page.getByRole('button', { name: /Add purchase/ }).click();
  await page.locator('#purchase-form input[name="supplier"]').fill('Studio Supply Co.');
  await page.locator('#purchase-form input[name="purchaseDate"]').fill('2026-10-20');
  await page.locator('#purchase-form input[name="receiptNumber"]').fill('INV-100');
  await page.locator('#purchase-form input[name="currency"]').fill('USD');
  await page.locator('#purchase-form input[name="receiptFile"]').setInputFiles({ name: 'receipt.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic receipt evidence') });
  const line = page.locator('#purchase-lines .purchase-line-row').first();
  await line.locator('input[name="quantity"]').fill('100');
  await line.locator('select[name="unit"]').selectOption('g');
  await line.locator('input[name="unitPrice"]').fill('2.5');
  await line.locator('input[name="lineTotal"]').fill('250');
  await page.locator('#purchase-form button[type="submit"]').click();
  await expect(page.locator('#purchase-list')).toContainText('receipt-verified');
  await expect(page.locator('#purchase-list')).toContainText('INV-100');

  await page.reload();
  await page.getByRole('button', { name: /Purchases & costs/ }).click();
  await expect(page.locator('#purchase-list')).toContainText('INV-100');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-lab-state-v1')));
  expect(persisted.purchases).toHaveLength(1);
  expect(persisted.purchaseLineItems).toHaveLength(1);
  expect(persisted.materials[0].lots[0].purchaseLineItemIds).toEqual([persisted.purchaseLineItems[0].id]);

  await page.getByRole('button', { name: /Experiments/ }).click();
  await page.locator('#experiment-list .experiment-card').first().click();
  await page.locator('#record-dialog').getByRole('button', { name: 'Review batch' }).click();
  await expect(page.locator('[data-batch-costing]')).toContainText('Costable subtotal: 50.00 USD');
  await expect(page.locator('[data-batch-costing]')).toContainText('1 uncosted addition');
  await page.locator('#record-dialog [data-close="record-dialog"]').click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const download = await downloadPromise;
  const exportedPath = await download.path();
  expect(exportedPath).toBeTruthy();
  const cleanContext = await browser.newContext();
  const cleanPage = await cleanContext.newPage();
  await openApp(cleanPage);
  await cleanPage.locator('#import-file').setInputFiles(exportedPath);
  await cleanPage.locator('#import-merge').click();
  await cleanPage.getByRole('button', { name: /Purchases & costs/ }).click();
  await expect(cleanPage.locator('#purchase-list')).toContainText('INV-100');
  await cleanContext.close();
  await fs.rm(exportedPath, { force: true });
});
