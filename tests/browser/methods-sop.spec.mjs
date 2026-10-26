import { test, expect } from '@playwright/test';

test('method library publishes immutable versions and executes the selected version', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Methods & SOPs/ }).click();
  await expect(page.locator('#method-list')).toContainText('No methods match this view');

  await page.getByRole('button', { name: /New method/ }).click();
  await page.locator('#method-form input[name="title"]').fill('Browser gravimetric check');
  await page.locator('#method-form input[name="author"]').fill('Browser tester');
  await page.locator('#method-form textarea[name="purpose"]').fill('Record a repeatable sample reading.');
  await page.locator('#method-form input[name="scope"]').fill('Batch sample');
  await page.locator('#method-form input[name="tags"]').fill('browser, measurement');
  await page.locator('#method-form textarea[name="steps"]').fill('step-1 | instruction | Prepare vessel | Clean and tare the vessel. | required\nstep-2 | measurement | Record sample mass | Record the balance reading. | required | Sample mass | g');
  await page.locator('#method-form textarea[name="measurements"]').fill('Sample mass | g | range | 0.9 | 1.1 | Expected sample range\nSample temperature | °C | range | 20 | 25 | Expected sample temperature');
  await page.locator('#method-form textarea[name="conditions"]').fill('Room temperature | 20–25 | °C | required');
  await page.locator('#method-form textarea[name="observations"]').fill('Appearance | Record visible appearance. | required');
  await page.locator('#method-form textarea[name="evidence"]').fill('Notebook page | required');
  await page.locator('#method-form button[type="submit"]').click();
  await expect(page.locator('#record-dialog-content')).toContainText('Browser gravimetric check');

  await page.getByRole('button', { name: /Publish draft/ }).click();
  await expect(page.locator('#record-dialog-content')).toContainText('Version 1');
  await page.getByRole('button', { name: /Create new draft from latest/ }).click();
  await expect(page.locator('#record-dialog-content')).toContainText('Current draft');
  await page.getByRole('button', { name: /Publish draft/ }).click();
  await expect(page.locator('#record-dialog-content')).toContainText('Version 2');

  await page.getByRole('button', { name: /Execute latest version/ }).click();
  await page.locator('#method-execution-form select[name="experimentId"]').selectOption({ label: 'EXP-001 · Mineral garden accord' });
  await page.locator('#method-execution-form button[type="submit"]').click();
  await expect(page.locator('#record-dialog-content')).toContainText('version 2');
  await expect(page.locator('#record-dialog-content')).toContainText('Acceptance: not-evaluated');

  const stepForms = page.locator('.method-step-form');
  await stepForms.nth(0).locator('select[name="status"]').selectOption('completed');
  await stepForms.nth(0).locator('textarea[name="notes"]').fill('Prepared.');
  await stepForms.nth(0).locator('button[type="submit"]').click();
  await stepForms.nth(1).locator('select[name="status"]').selectOption('completed');
  await stepForms.nth(1).locator('textarea[name="notes"]').fill('Reading taken.');
  await stepForms.nth(1).locator('button[type="submit"]').click();

  await page.locator('#method-measurement-form input[name="value"]').fill('1.02');
  await page.locator('#method-measurement-form input[name="unit"]').fill('g');
  await page.locator('#method-measurement-form select[name="methodMeasurementId"]').selectOption({ index: 0 });
  await page.locator('#method-measurement-form button[type="submit"]').click();
  await page.locator('#method-condition-form select[name="methodConditionId"]').selectOption({ index: 0 });
  await page.locator('#method-condition-form input[name="value"]').fill('22');
  await page.locator('#method-condition-form input[name="unit"]').fill('°C');
  await page.locator('#method-condition-form button[type="submit"]').click();
  await page.locator('#method-evidence-form input[name="reference"]').fill('notebook:page-4');
  await page.locator('#method-evidence-form button[type="submit"]').click();
  await page.locator('#method-observation-form input[name="name"]').fill('Appearance');
  await page.locator('#method-observation-form input[name="value"]').fill('Clear');
  await page.locator('#method-observation-form button[type="submit"]').click();
  await page.locator('#method-measurement-form select[name="methodMeasurementId"]').selectOption({ index: 1 });
  await page.locator('#method-measurement-form input[name="value"]').fill('72');
  await page.locator('#method-measurement-form input[name="unit"]').fill('°F');
  await page.locator('#method-measurement-form button[type="submit"]').click();
  await expect(page.locator('#record-dialog-content')).toContainText('Acceptance: not-evaluated');
  await page.locator('#method-deviation-form textarea[name="description"]').fill('Reading delayed briefly.');
  await page.locator('#method-deviation-form button[type="submit"]').click();
  await page.getByRole('button', { name: /Mark execution completed/ }).click();
  await expect(page.locator('#record-dialog-content')).toContainText('completed');

  await page.getByRole('button', { name: /Close report/ }).click();
  await page.reload();
  await page.getByRole('button', { name: /Methods & SOPs/ }).click();
  await page.locator('[data-method-id]').getByRole('button', { name: /Open method/ }).click();
  await expect(page.locator('#record-dialog-content')).toContainText('Version 1');
  await expect(page.locator('#record-dialog-content')).toContainText('Version 2');
  await expect(page.locator('#record-dialog-content')).toContainText('completed');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('atelier-lab-state-v1')));
  expect(persisted.methods).toHaveLength(1);
  expect(persisted.methodVersions.filter(item => item.status === 'published')).toHaveLength(2);
  expect(persisted.methodExecutions[0].methodVersionId).toBe(persisted.methods[0].currentVersionId);
  const publishedVersion = persisted.methodVersions.find(item => item.id === persisted.methodExecutions[0].methodVersionId);
  expect(persisted.methodExecutions[0].conditions[0].methodConditionId).toBe(publishedVersion.conditions[0].id);
  expect(persisted.methodExecutions[0].evidence[0].requirementId).toBe(publishedVersion.evidenceRequirements[0].id);
  expect(persisted.methodExecutions[0].evidence[0].reference).toBe('notebook:page-4');
});

test('method library remains reachable at phone width and exposes keyboard labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const methodsNav = page.getByRole('button', { name: /Methods & SOPs/ });
  await expect(methodsNav).toBeVisible();
  await methodsNav.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#screen-methods')).toBeVisible();
  await expect(page.getByRole('button', { name: /New method/ })).toBeVisible();
  await expect(page.locator('#method-search')).toHaveAttribute('placeholder', /Search methods/);
});
