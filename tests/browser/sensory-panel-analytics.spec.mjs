import { test, expect } from '@playwright/test';

async function addPanelFixture(page) {
  await page.evaluate(async () => {
    const { createInitialState } = await import('/src/domain/store.mjs');
    const state = createInitialState();
    const sessionId = 'analytics-browser-session'; const lockedAt = '2026-10-25T09:00:00.000Z';
    const samples = [
      { id: 'analytics-browser-sample-a', sessionId, batchId: 'batch-seed-1', experimentId: 'experiment-seed-1', revisionId: 'revision-seed-1', blindCode: 'BT-ANALYT1', position: 1, randomizedAt: '2026-10-25T08:00:00.000Z' },
      { id: 'analytics-browser-sample-b', sessionId, batchId: 'batch-seed-1', experimentId: 'experiment-seed-1', revisionId: 'revision-seed-1', blindCode: 'BT-ANALYT2', position: 2, randomizedAt: '2026-10-25T08:00:00.000Z' }
    ];
    state.blindSessions.push({ id: sessionId, name: 'Browser panel', purpose: 'Analytics fixture', sessionDate: '2026-10-25', evaluatorLabel: 'Participant A', status: 'unblinded', sampleIds: samples.map(item => item.id), randomizedAt: '2026-10-25T08:00:00.000Z', lockedAt, unblindedAt: '2026-10-25T10:00:00.000Z', createdAt: '2026-10-25T08:00:00.000Z', updatedAt: '2026-10-25T10:00:00.000Z' });
    state.blindSamples.push(...samples);
    const evaluations = samples.map((sample, index) => ({ id: `analytics-browser-evaluation-${index}`, experimentId: sample.experimentId, batchId: sample.batchId, revisionId: sample.revisionId, evaluatedAt: `2026-10-25T0${index + 1}:00:00.000Z`, intervalLabel: 'Panel opening', descriptors: [index ? 'soft' : 'green'], scores: { intensity: index ? 4 : 3, longevity: 3, projection: 2 }, subjectiveNotes: 'Recorded panel note.', measuredResults: '', isMeasured: false, provenance: 'subjective', blindSessionId: sessionId, blindSampleId: sample.id, blindCode: sample.blindCode, blindLockedAt: lockedAt }));
    state.evaluations.push(...evaluations);
    const experiment = state.experiments.find(item => item.id === 'experiment-seed-1'); experiment.evaluationIds.push(...evaluations.map(item => item.id));
    localStorage.setItem('atelier-lab-state-v1', JSON.stringify(state));
  });
  await page.reload();
}

test('Sensory Panel Analytics shows coded distributions, filters, repeatability limits, and maturation gaps', async ({ page }) => {
  await page.goto('/');
  await addPanelFixture(page);
  await page.getByRole('button', { name: /Sensory Panel Analytics/ }).click();
  await expect(page.locator('#screen-analytics')).toBeVisible();
  await expect(page.locator('#analytics-scope')).toContainText('3 evaluation record(s)');
  await expect(page.locator('#analytics-rating-distributions')).toContainText('intensity');
  await expect(page.locator('#analytics-rating-distributions')).toContainText('Median');
  await expect(page.locator('#analytics-agreement')).toContainText('Evaluator identity is not stored');
  await expect(page.locator('#analytics-maturation')).toContainText('No maturation checkpoints');
  await expect(page.locator('#analytics-output')).not.toContainText('BATCH-001');

  await page.locator('#analytics-sessionId').selectOption({ label: 'Browser panel' });
  await expect(page.locator('#analytics-scope')).toContainText('2 evaluation record(s)');
  await page.locator('#analytics-sampleId').selectOption({ label: 'BT-ANALYT1' });
  await expect(page.locator('#analytics-scope')).toContainText('1 evaluation record(s)');
  await page.locator('#analytics-dimension').selectOption('intensity');
  await expect(page.locator('[data-analytics-dimension="intensity"]')).toContainText('3');
});

test('Sensory Panel Analytics is reachable by keyboard at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const analyticsNav = page.getByRole('button', { name: /Sensory Panel Analytics/ });
  await analyticsNav.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#screen-analytics')).toBeVisible();
  await expect(page.getByRole('combobox', { name: /Filter analytics by rating dimension/ })).toBeVisible();
});
