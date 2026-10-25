import { test, expect } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#stat-journal')).toHaveText('1');
  await page.getByRole('button', { name: /Equipment log/ }).click();
}

test('equipment registry, verification, maintenance, measurement, and reload persistence', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#equipment-summary')).toContainText('EQUIPMENT');
  await page.getByRole('button', { name: /Add equipment/ }).click();
  await page.locator('#equipment-form input[name="name"]').fill('Bench balance');
  await page.locator('#equipment-form select[name="equipmentType"]').selectOption('balance');
  await page.locator('#equipment-form input[name="serialNumber"]').fill('BAL-001');
  await page.locator('#equipment-form input[name="resolution"]').fill('0.001');
  await page.locator('#equipment-form input[name="resolutionUnit"]').fill('g');
  await page.locator('#equipment-form button[type="submit"]').click();
  await expect(page.locator('#equipment-list')).toContainText('Bench balance');
  await expect(page.locator('#equipment-warnings')).toContainText('Verification status unknown');

  const card = page.locator('[data-equipment-id]').filter({ hasText: 'Bench balance' });
  await card.getByRole('button', { name: 'Verification' }).click();
  await page.locator('#verification-form select[name="outcome"]').selectOption('pass');
  await page.locator('#verification-form input[name="method"]').fill('Reference weight');
  await page.locator('#verification-form input[name="nextDueAt"]').fill('2099-01-01');
  await page.locator('#verification-form textarea[name="notes"]').fill('Reference weight recorded.');
  await page.locator('#verification-form button[type="submit"]').click();
  await expect(card).toContainText('Verification: verified');

  await card.getByRole('button', { name: 'Maintenance' }).click();
  await page.locator('#maintenance-form select[name="eventType"]').selectOption('inspection');
  await page.locator('#maintenance-form textarea[name="notes"]').fill('Cleaned and inspected.');
  await page.locator('#maintenance-form select[name="statusAfter"]').selectOption('available');
  await page.locator('#maintenance-form button[type="submit"]').click();
  await expect(card).toContainText('inspection');

  await card.getByRole('button', { name: 'Measurement' }).click();
  await page.locator('#measurement-form input[name="quantityType"]').fill('mass');
  await page.locator('#measurement-form input[name="value"]').fill('12.5');
  await page.locator('#measurement-form input[name="unit"]').fill('g');
  await page.locator('#measurement-form input[name="method"]').fill('Direct reading');
  await page.locator('#measurement-form textarea[name="conditions"]').fill('Room temperature.');
  await page.locator('#measurement-form button[type="submit"]').click();
  await expect(card).toContainText('1 measurement');

  await page.reload();
  await page.getByRole('button', { name: /Equipment log/ }).click();
  await expect(page.locator('#equipment-list')).toContainText('Bench balance');
  await expect(page.locator('#equipment-list')).toContainText('mass 12.5 g');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-lab-state-v1')));
  expect(persisted.equipment).toHaveLength(1);
  expect(persisted.verificationEvents).toHaveLength(1);
  expect(persisted.maintenanceEvents).toHaveLength(1);
  expect(persisted.measurements).toHaveLength(1);
});
