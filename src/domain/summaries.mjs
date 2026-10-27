import { compareRevisions } from './comparison.mjs';

export function summarizeExperiment(state, experimentId) {
  const experiment = state.experiments.find(item => item.id === experimentId);
  if (!experiment) throw new Error('Experiment not found.');
  const revisions = state.revisions.filter(item => experiment.formulaRevisionIds.includes(item.id)).sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id));
  const batches = state.batches.filter(item => experiment.batchIds.includes(item.id)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));
  const evaluations = state.evaluations.filter(item => experiment.evaluationIds.includes(item.id)).sort((a, b) => String(a.evaluatedAt).localeCompare(String(b.evaluatedAt)) || a.id.localeCompare(b.id));
  const warnings = [];
  if (!evaluations.length) warnings.push('No recorded evaluations are available.');
  if (evaluations.some(item => !item.isMeasured && item.measuredResults)) warnings.push('Some evaluation text is marked subjective even though measured-result text is present.');
  if (evaluations.some(item => !item.revisionId)) warnings.push('Some evaluations do not carry explicit revision provenance.');
  if (evaluations.some(item => item.predictedOutcome)) warnings.push('Predicted outcomes are kept separate from observations.');
  if (evaluations.some(item => Array.isArray(item.aiSuggestions) && item.aiSuggestions.length)) warnings.push('AI suggestions are not recorded sensory evidence.');
  return { experimentId, title: experiment.title, provenance: experiment.provenance || 'recorded', revisions, batches, evaluations, chronologicalEvaluations: [...evaluations].sort((a, b) => String(a.evaluatedAt).localeCompare(String(b.evaluatedAt)) || a.id.localeCompare(b.id)), warnings };
}

export function summarizeRevisionComparison(state, leftRevisionId, rightRevisionId) {
  const comparison = compareRevisions(state, leftRevisionId, rightRevisionId);
  const evaluations = [...comparison.leftEvaluations, ...comparison.rightEvaluations];
  return { ...comparison, evidence: { recorded: true, measured: evaluations.filter(item => item.isMeasured), subjective: evaluations.filter(item => item.provenance === 'subjective' || !item.isMeasured), predicted: evaluations.filter(item => item.predictedOutcome), aiGenerated: evaluations.filter(item => item.provenance === 'ai-generated' || item.aiSuggestions?.length), synthetic: [...state.journalEntries, ...state.evaluations].filter(item => item.provenance === 'synthetic-demo'), missing: comparison.missingEvidence } };
}
