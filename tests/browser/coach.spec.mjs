import { test, expect } from '@playwright/test';

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
