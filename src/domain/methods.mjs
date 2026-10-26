import { convertQuantity } from './calculations.mjs';

export const METHOD_STATUSES = ['draft', 'retired'];
export const METHOD_VERSION_STATUSES = ['draft', 'published'];
export const METHOD_EXECUTION_STATUSES = ['in-progress', 'completed', 'interrupted'];
export const METHOD_STEP_TYPES = ['instruction', 'measurement', 'observation', 'wait', 'condition-checkpoint', 'review'];
export const METHOD_STEP_STATUSES = ['not-started', 'completed', 'skipped'];

const clone = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function text(value, label, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    throw new Error(`${label} is required.`);
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function timestamp(value, label) {
  const result = value || now();
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label} must be a valid timestamp.`);
  return result;
}

function positive(value, label, { allowZero = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`);
  return value;
}

function arrays(state) {
  return {
    methods: Array.isArray(state.methods) ? state.methods : [],
    methodVersions: Array.isArray(state.methodVersions) ? state.methodVersions : [],
    methodExecutions: Array.isArray(state.methodExecutions) ? state.methodExecutions : []
  };
}

function uniqueIds(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (!record?.id || seen.has(record.id)) throw new Error(`Duplicate or missing ${label} id.`);
    seen.add(record.id);
  }
  return seen;
}

function methodVersion(state, versionId) {
  const version = state.methodVersions.find(item => item.id === versionId);
  if (!version) throw new Error(`Method version "${versionId}" was not found.`);
  return version;
}

function methodRecord(state, methodId) {
  const method = state.methods.find(item => item.id === methodId);
  if (!method) throw new Error(`Method "${methodId}" was not found.`);
  return method;
}

function supportedReference(state, type, referenceId) {
  if (!referenceId) return null;
  const collection = type === 'batch' ? state.batches : state.experiments;
  const record = collection.find(item => item.id === referenceId);
  if (!record) throw new Error(`Method execution references an unknown ${type}.`);
  return record;
}

function normalizeCriterion(criterion, label) {
  if (criterion === undefined || criterion === null || criterion === '') return null;
  if (!criterion || typeof criterion !== 'object') throw new Error(`${label} criterion must be an object.`);
  const kind = text(criterion.kind, `${label} criterion kind`);
  if (!['range', 'equals', 'at-least', 'at-most'].includes(kind)) throw new Error(`${label} criterion kind is unsupported.`);
  const unit = text(criterion.unit, `${label} criterion unit`);
  const normalized = { kind, unit };
  if (kind === 'range') {
    if (criterion.min === undefined && criterion.max === undefined) throw new Error(`${label} range criterion needs a minimum or maximum.`);
    if (criterion.min !== undefined) positive(criterion.min, `${label} criterion minimum`, { allowZero: true });
    if (criterion.max !== undefined) positive(criterion.max, `${label} criterion maximum`, { allowZero: true });
    if (criterion.min !== undefined && criterion.max !== undefined && criterion.min > criterion.max) throw new Error(`${label} criterion minimum cannot exceed maximum.`);
    if (criterion.min !== undefined) normalized.min = criterion.min;
    if (criterion.max !== undefined) normalized.max = criterion.max;
  } else {
    positive(criterion.value, `${label} criterion value`, { allowZero: true });
    normalized.value = criterion.value;
  }
  return normalized;
}

function normalizeDefinition(input, { published = false } = {}) {
  const steps = Array.isArray(input.steps) ? input.steps.map((step, index) => {
    const normalized = {
      id: step.id || id('method-step'),
      order: Number.isInteger(step.order) ? step.order : index + 1,
      type: text(step.type, `Procedure step ${index + 1} type`),
      title: text(step.title, `Procedure step ${index + 1} title`),
      instruction: text(step.instruction, `Procedure step ${index + 1} instruction`, { optional: true }),
      required: step.required !== false,
      measurementName: step.measurementName ? text(step.measurementName, `Procedure step ${index + 1} measurement name`) : undefined,
      unit: step.unit ? text(step.unit, `Procedure step ${index + 1} unit`) : undefined,
      condition: step.condition ? text(step.condition, `Procedure step ${index + 1} condition`) : undefined,
      expected: step.expected ? text(step.expected, `Procedure step ${index + 1} expected value`) : undefined
    };
    if (!METHOD_STEP_TYPES.includes(normalized.type)) throw new Error(`Procedure step ${index + 1} type is unsupported.`);
    if (normalized.type === 'measurement' && (!normalized.measurementName || !normalized.unit)) throw new Error(`Measurement step ${index + 1} needs a name and declared unit.`);
    return normalized;
  }) : [];
  const materials = Array.isArray(input.materials) ? input.materials.map((item, index) => ({
    id: item.id || id('method-material'), name: text(item.name, `Required material ${index + 1}`), quantity: item.quantity === undefined || item.quantity === '' ? undefined : positive(Number(item.quantity), `Required material ${index + 1} quantity`), unit: item.unit ? text(item.unit, `Required material ${index + 1} unit`) : undefined, notes: text(item.notes, `Required material ${index + 1} notes`, { optional: true })
  })) : [];
  const equipment = Array.isArray(input.equipment) ? input.equipment.map((item, index) => ({ id: item.id || id('method-equipment'), name: text(item.name, `Required equipment ${index + 1}`), purpose: text(item.purpose, `Required equipment ${index + 1} purpose`, { optional: true }), notes: text(item.notes, `Required equipment ${index + 1} notes`, { optional: true }) })) : [];
  const measurements = Array.isArray(input.measurements) ? input.measurements.map((item, index) => ({ id: item.id || id('method-measurement'), name: text(item.name, `Measurement ${index + 1} name`), unit: text(item.unit, `Measurement ${index + 1} unit`), criterion: normalizeCriterion(item.criterion, `Measurement ${index + 1}`), notes: text(item.notes, `Measurement ${index + 1} notes`, { optional: true }) })) : [];
  const conditions = Array.isArray(input.conditions) ? input.conditions.map((item, index) => ({ id: item.id || id('method-condition'), name: text(item.name, `Required condition ${index + 1} name`), unit: item.unit ? text(item.unit, `Required condition ${index + 1} unit`) : undefined, expected: text(item.expected, `Required condition ${index + 1} expected value`), required: item.required !== false })) : [];
  const observations = Array.isArray(input.observations) ? input.observations.map((item, index) => ({ id: item.id || id('method-observation'), name: text(item.name, `Required observation ${index + 1} name`), prompt: text(item.prompt, `Required observation ${index + 1} prompt`), required: item.required !== false })) : [];
  const evidenceRequirements = Array.isArray(input.evidenceRequirements) ? input.evidenceRequirements.map((item, index) => ({ id: item.id || id('method-evidence'), name: text(item.name, `Evidence requirement ${index + 1}`), required: item.required !== false })) : [];
  const normalized = {
    title: text(input.title, 'Method title'), purpose: text(input.purpose, 'Method purpose'), scope: text(input.scope, 'Method scope', { optional: true }), tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(item => text(item, 'Method tag')))] : [],
    steps, materials, equipment, measurements, conditions, observations, evidenceRequirements
  };
  if (!steps.length) throw new Error('A method needs at least one procedure step.');
  return normalized;
}

function normalizeMeasurement(methodVersion, input, executionId) {
  const definition = methodVersion.measurements.find(item => item.id === input.methodMeasurementId);
  if (!definition) throw new Error('Measurement references an unknown method measurement definition.');
  const value = Number(input.value);
  positive(value, 'Observed measurement value', { allowZero: true });
  const unit = text(input.unit, 'Observed measurement unit');
  const observedAt = timestamp(input.observedAt, 'Observed measurement timestamp');
  const result = evaluateCriterion(definition.criterion, value, unit);
  return { id: input.id || id('method-reading'), executionId, methodMeasurementId: definition.id, name: definition.name, value, unit, observedAt, equipmentId: input.equipmentId || undefined, condition: text(input.condition, 'Measurement condition', { optional: true }), evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(Boolean) : [], notes: text(input.notes, 'Measurement notes', { optional: true }), criterionResult: result.status, criterionReason: result.reason };
}

export function evaluateCriterion(criterion, value, unit) {
  if (!criterion) return { status: 'not-evaluated', reason: 'No acceptance criterion was declared.' };
  let comparable = value;
  if (unit !== criterion.unit) {
    try { comparable = convertQuantity(value, unit, criterion.unit, {}); } catch { return { status: 'not-evaluated', reason: `Units ${unit} and ${criterion.unit} are not compatible.` }; }
  }
  if (criterion.kind === 'range') {
    const pass = (criterion.min === undefined || comparable >= criterion.min) && (criterion.max === undefined || comparable <= criterion.max);
    return { status: pass ? 'pass' : 'fail', reason: pass ? 'Observed value is within the declared range.' : 'Observed value is outside the declared range.' };
  }
  if (criterion.kind === 'equals') return { status: comparable === criterion.value ? 'pass' : 'fail', reason: comparable === criterion.value ? 'Observed value matches the declared value.' : 'Observed value does not match the declared value.' };
  if (criterion.kind === 'at-least') return { status: comparable >= criterion.value ? 'pass' : 'fail', reason: comparable >= criterion.value ? 'Observed value meets the minimum.' : 'Observed value is below the minimum.' };
  return { status: comparable <= criterion.value ? 'pass' : 'fail', reason: comparable <= criterion.value ? 'Observed value meets the maximum.' : 'Observed value exceeds the maximum.' };
}

export function validateMethodsState(state) {
  const { methods, methodVersions, methodExecutions } = arrays(state);
  const methodIds = uniqueIds(methods, 'method');
  const versionIds = uniqueIds(methodVersions, 'method version');
  const executionIds = uniqueIds(methodExecutions, 'method execution');
  for (const method of methods) {
    text(method.title, `Method ${method.id} title`); timestamp(method.createdAt, `Method ${method.id} createdAt`); timestamp(method.updatedAt, `Method ${method.id} updatedAt`);
    if (!METHOD_STATUSES.includes(method.status)) throw new Error(`Method ${method.id} status is invalid.`);
    if (!methodIds.has(method.id)) throw new Error(`Method ${method.id} is invalid.`);
    if (!method.draftVersionId || !versionIds.has(method.draftVersionId)) throw new Error(`Method ${method.id} must reference a draft version.`);
    const draft = methodVersions.find(item => item.id === method.draftVersionId);
    if (!draft || draft.methodId !== method.id || draft.status !== 'draft') throw new Error(`Method ${method.id} draft link is invalid.`);
    if (method.currentVersionId && (!versionIds.has(method.currentVersionId) || methodVersions.find(item => item.id === method.currentVersionId).methodId !== method.id)) throw new Error(`Method ${method.id} published version link is invalid.`);
  }
  for (const version of methodVersions) {
    if (!methodIds.has(version.methodId)) throw new Error(`Method version ${version.id} references an unknown method.`);
    if (!METHOD_VERSION_STATUSES.includes(version.status)) throw new Error(`Method version ${version.id} status is invalid.`);
    if (!Number.isInteger(version.version) || version.version < 0) throw new Error(`Method version ${version.id} number is invalid.`);
    normalizeDefinition(version, { published: version.status === 'published' });
    timestamp(version.createdAt, `Method version ${version.id} createdAt`);
    if (version.publishedAt) timestamp(version.publishedAt, `Method version ${version.id} publishedAt`);
    if (version.status === 'published' && !version.publishedAt) throw new Error(`Published method version ${version.id} needs publishedAt.`);
  }
  for (const execution of methodExecutions) {
    if (!methodIds.has(execution.methodId) || !versionIds.has(execution.methodVersionId)) throw new Error(`Method execution ${execution.id} has an invalid method link.`);
    const version = methodVersions.find(item => item.id === execution.methodVersionId);
    if (version.methodId !== execution.methodId || version.status !== 'published') throw new Error(`Method execution ${execution.id} must reference a published method version.`);
    if (!METHOD_EXECUTION_STATUSES.includes(execution.status)) throw new Error(`Method execution ${execution.id} status is invalid.`);
    supportedReference(state, 'experiment', execution.experimentId); supportedReference(state, 'batch', execution.batchId);
    if (!execution.experimentId && !execution.batchId) throw new Error(`Method execution ${execution.id} needs an experiment or batch link.`);
    if (execution.batchId) { const batch = state.batches.find(item => item.id === execution.batchId); if (execution.experimentId && batch.experimentId !== execution.experimentId) throw new Error(`Method execution ${execution.id} batch and experiment do not match.`); }
    for (const measurement of execution.measurements || []) { positive(measurement.value, `Method execution ${execution.id} measurement`, { allowZero: true }); text(measurement.unit, 'Observed measurement unit'); timestamp(measurement.observedAt, 'Observed measurement timestamp'); }
    if (execution.completedAt && execution.status !== 'completed') throw new Error(`Method execution ${execution.id} completion timestamp requires completed status.`);
  }
  return state;
}

export function createMethod(state, input) {
  const { methods, methodVersions } = arrays(state);
  const methodId = input.id || id('method');
  const createdAt = now();
  const draft = { id: id('method-draft'), methodId, version: 0, status: 'draft', createdAt, ...normalizeDefinition(input) };
  const method = { id: methodId, title: draft.title, purpose: draft.purpose, scope: draft.scope, author: text(input.author, 'Method author', { optional: true }) || 'Local user', ownerId: text(input.ownerId, 'Method owner', { optional: true }) || 'local-user', tags: draft.tags, status: 'draft', draftVersionId: draft.id, currentVersionId: undefined, createdAt, updatedAt: createdAt };
  return validateMethodsState({ ...state, methods: [method, ...methods], methodVersions: [draft, ...methodVersions] });
}

export function updateMethodDraft(state, methodId, input) {
  const method = methodRecord(state, methodId); const draft = methodVersion(state, method.draftVersionId);
  if (draft.status !== 'draft') throw new Error('Only a draft method can be edited.');
  const nextDraft = { ...draft, ...normalizeDefinition({ ...draft, ...input }), updatedAt: now() };
  const nextMethod = { ...method, title: nextDraft.title, purpose: nextDraft.purpose, scope: nextDraft.scope, tags: nextDraft.tags, author: text(input.author, 'Method author', { optional: true }) || method.author, updatedAt: now() };
  return validateMethodsState({ ...state, methods: state.methods.map(item => item.id === methodId ? nextMethod : item), methodVersions: state.methodVersions.map(item => item.id === draft.id ? nextDraft : item) });
}

export function publishMethod(state, methodId) {
  const method = methodRecord(state, methodId); const draft = methodVersion(state, method.draftVersionId); if (draft.status !== 'draft') throw new Error('Only a draft method can be published.');
  const publishedNumber = Math.max(0, ...state.methodVersions.filter(item => item.methodId === methodId && item.status === 'published').map(item => item.version)) + 1;
  const published = { ...clone(draft), id: id('method-version'), version: publishedNumber, status: 'published', publishedAt: now(), createdAt: now() };
  const nextDraft = { ...clone(published), id: id('method-draft'), version: 0, status: 'draft', createdAt: now() };
  delete nextDraft.publishedAt;
  const nextMethod = { ...method, title: published.title, purpose: published.purpose, scope: published.scope, tags: published.tags, status: 'draft', currentVersionId: published.id, draftVersionId: nextDraft.id, updatedAt: now() };
  return validateMethodsState({ ...state, methods: state.methods.map(item => item.id === methodId ? nextMethod : item), methodVersions: [nextDraft, published, ...state.methodVersions.filter(item => item.id !== draft.id)] });
}

export function retireMethod(state, methodId) {
  methodRecord(state, methodId);
  return validateMethodsState({ ...state, methods: state.methods.map(item => item.id === methodId ? { ...item, status: 'retired', updatedAt: now() } : item) });
}

export function startMethodExecution(state, input) {
  const method = methodRecord(state, input.methodId); if (method.status === 'retired') throw new Error('Retired methods cannot start new executions.'); if (!method.currentVersionId) throw new Error('A published method version must be selected.');
  const version = methodVersion(state, input.methodVersionId || method.currentVersionId); if (version.methodId !== method.id || version.status !== 'published') throw new Error('Execution must reference a published version of the selected method.');
  const batch = supportedReference(state, 'batch', input.batchId); const experiment = supportedReference(state, 'experiment', input.experimentId || batch?.experimentId); const experimentId = input.experimentId || batch?.experimentId;
  const startedAt = timestamp(input.startedAt, 'Execution start');
  const execution = { id: input.id || id('method-execution'), methodId: method.id, methodVersionId: version.id, experimentId: experiment?.id || experimentId, batchId: batch?.id || undefined, status: 'in-progress', startedAt, completedAt: undefined, steps: version.steps.map(step => ({ stepId: step.id, status: 'not-started', notes: '', observations: [] })), measurements: [], observations: [], conditions: [], deviations: [], evidence: [], evidenceRefs: [], createdAt: startedAt, updatedAt: startedAt };
  return validateMethodsState({ ...state, methodExecutions: [execution, ...state.methodExecutions] });
}

export function recordMethodExecutionStep(state, executionId, stepId, input = {}) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const version = methodVersion(state, execution.methodVersionId); const step = version.steps.find(item => item.id === stepId); if (!step) throw new Error('Execution step was not found in the selected method version.');
  const status = input.status || 'completed'; if (!METHOD_STEP_STATUSES.includes(status)) throw new Error('Execution step status is invalid.');
  const nextSteps = execution.steps.map(item => item.stepId === stepId ? { ...item, status, notes: text(input.notes, 'Step notes', { optional: true }), observations: Array.isArray(input.observations) ? input.observations.filter(Boolean) : item.observations } : item);
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, steps: nextSteps, updatedAt: now() } : item) });
}

export function recordMethodMeasurement(state, executionId, input) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const version = methodVersion(state, execution.methodVersionId); const measurement = normalizeMeasurement(version, input, executionId);
  if (execution.measurements.some(item => item.id === measurement.id)) throw new Error('Measurement record already exists.');
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, measurements: [...item.measurements, measurement], updatedAt: now() } : item) });
}

export function recordMethodObservation(state, executionId, input) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const observation = { id: input.id || id('method-observation'), name: text(input.name, 'Observation name'), value: text(input.value, 'Observation', { optional: true }), observedAt: timestamp(input.observedAt, 'Observation timestamp'), notes: text(input.notes, 'Observation notes', { optional: true }), evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(Boolean) : [] };
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, observations: [...item.observations, observation], updatedAt: now() } : item) });
}

export function recordMethodCondition(state, executionId, input) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const version = methodVersion(state, execution.methodVersionId); const definition = version.conditions.find(item => item.id === input.methodConditionId); if (!definition) throw new Error('Condition references an unknown method condition definition.');
  const condition = { id: input.id || id('method-condition'), methodConditionId: definition.id, name: definition.name, value: text(input.value, 'Observed condition'), unit: input.unit ? text(input.unit, 'Observed condition unit') : definition.unit, observedAt: timestamp(input.observedAt, 'Condition timestamp'), notes: text(input.notes, 'Condition notes', { optional: true }) };
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, conditions: [...item.conditions, condition], updatedAt: now() } : item) });
}

export function recordMethodEvidence(state, executionId, input) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const version = methodVersion(state, execution.methodVersionId); const requirement = version.evidenceRequirements.find(item => item.id === input.requirementId); if (!requirement) throw new Error('Evidence references an unknown method requirement.');
  const evidence = { id: input.id || id('method-evidence'), requirementId: requirement.id, reference: text(input.reference, 'Evidence reference'), recordedAt: timestamp(input.recordedAt, 'Evidence timestamp'), notes: text(input.notes, 'Evidence notes', { optional: true }) };
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, evidence: [...(item.evidence || []), evidence], evidenceRefs: [...new Set([...(item.evidenceRefs || []), requirement.id])], updatedAt: now() } : item) });
}

export function recordMethodDeviation(state, executionId, input) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const deviation = { id: input.id || id('method-deviation'), stepId: input.stepId || undefined, description: text(input.description, 'Deviation description'), recordedAt: timestamp(input.recordedAt, 'Deviation timestamp'), reason: text(input.reason, 'Deviation reason', { optional: true }), evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.filter(Boolean) : [] };
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, deviations: [...item.deviations, deviation], updatedAt: now() } : item) });
}

export function completeMethodExecution(state, executionId) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.'); if (execution.status === 'completed') throw new Error('Method execution is already completed.');
  const completedAt = now(); return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? { ...item, status: 'completed', completedAt, updatedAt: completedAt } : item) });
}

export function interruptMethodExecution(state, executionId, reason = '') {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const next = { ...execution, status: 'interrupted', updatedAt: now(), deviations: [...execution.deviations, { id: id('method-deviation'), description: text(reason, 'Interruption reason'), recordedAt: now(), reason: 'Execution interrupted.' }] };
  return validateMethodsState({ ...state, methodExecutions: state.methodExecutions.map(item => item.id === executionId ? next : item) });
}

export function methodExecutionReport(state, executionId) {
  const execution = state.methodExecutions.find(item => item.id === executionId); if (!execution) throw new Error('Method execution was not found.');
  const method = methodRecord(state, execution.methodId); const version = methodVersion(state, execution.methodVersionId);
  const missingSteps = version.steps.filter(step => step.required && !execution.steps.some(item => item.stepId === step.id && item.status === 'completed')).map(step => step.title);
  const missingMeasurements = version.measurements.filter(definition => !execution.measurements.some(item => item.methodMeasurementId === definition.id)).map(item => item.name);
  const missingObservations = version.observations.filter(definition => definition.required && !execution.observations.some(item => item.name === definition.name)).map(item => item.name);
  const missingConditions = version.conditions.filter(definition => definition.required && !execution.conditions.some(item => item.methodConditionId === definition.id)).map(item => item.name);
  const missingEvidence = version.evidenceRequirements.filter(definition => definition.required && !(execution.evidence || []).some(item => item.requirementId === definition.id)).map(item => item.name);
  const results = execution.measurements.map(item => ({ ...item, criterion: version.measurements.find(definition => definition.id === item.methodMeasurementId)?.criterion || null }));
  const evaluated = results.filter(item => item.criterionResult === 'pass' || item.criterionResult === 'fail');
  const acceptance = evaluated.length !== results.filter(item => item.criterion).length || !results.length ? 'not-evaluated' : results.some(item => item.criterionResult === 'fail') ? 'fail' : 'pass';
  return { method, version, execution, missingSteps, missingMeasurements, missingObservations, missingConditions, missingEvidence, measurementResults: results, acceptance, canClaimComplete: execution.status === 'completed' && !missingSteps.length && !missingMeasurements.length && !missingObservations.length && !missingConditions.length && !missingEvidence.length && acceptance !== 'fail' };
}

export function clonePublishedMethodToDraft(state, methodId) {
  const method = methodRecord(state, methodId); if (!method.currentVersionId) throw new Error('The method has no published version to copy.');
  const published = methodVersion(state, method.currentVersionId); const draft = { ...clone(published), id: id('method-draft'), version: 0, status: 'draft', publishedAt: undefined, createdAt: now() };
  return validateMethodsState({ ...state, methods: state.methods.map(item => item.id === methodId ? { ...item, draftVersionId: draft.id, status: 'draft', updatedAt: now() } : item), methodVersions: [draft, ...state.methodVersions] });
}
