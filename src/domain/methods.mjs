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

function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function strictTimestamp(value, label) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a valid timestamp.`);
  return value;
}

function optionalString(value, label) {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${label} must be an array of non-empty strings.`);
  return value;
}

function recordArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
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
  const measurements = Array.isArray(input.measurements) ? input.measurements.map((item, index) => ({ id: item.id || id('method-measurement'), name: text(item.name, `Measurement ${index + 1} name`), unit: text(item.unit, `Measurement ${index + 1} unit`), required: item.required !== false, criterion: normalizeCriterion(item.criterion, `Measurement ${index + 1}`), notes: text(item.notes, `Measurement ${index + 1} notes`, { optional: true }) })) : [];
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

function validateCriterion(criterion, label) {
  if (criterion === undefined || criterion === null) return;
  if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)) throw new Error(`${label} criterion must be an object or null.`);
  identifier(criterion.kind, `${label} criterion kind`);
  if (!['range', 'equals', 'at-least', 'at-most'].includes(criterion.kind)) throw new Error(`${label} criterion kind is unsupported.`);
  identifier(criterion.unit, `${label} criterion unit`);
  if (criterion.kind === 'range') {
    if (criterion.min === undefined && criterion.max === undefined) throw new Error(`${label} range criterion needs a minimum or maximum.`);
    if (criterion.min !== undefined) positive(criterion.min, `${label} criterion minimum`, { allowZero: true });
    if (criterion.max !== undefined) positive(criterion.max, `${label} criterion maximum`, { allowZero: true });
    if (criterion.min !== undefined && criterion.max !== undefined && criterion.min > criterion.max) throw new Error(`${label} criterion minimum cannot exceed maximum.`);
  } else {
    positive(criterion.value, `${label} criterion value`, { allowZero: true });
  }
}

function validateMethodDefinition(version) {
  identifier(version.title, `Method version ${version.id} title`);
  identifier(version.purpose, `Method version ${version.id} purpose`);
  optionalString(version.scope, `Method version ${version.id} scope`);
  if (!Array.isArray(version.tags) || version.tags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new Error(`Method version ${version.id} tags are invalid.`);
  const steps = recordArray(version.steps, `Method version ${version.id} steps`);
  const stepIds = uniqueIds(steps, `method version ${version.id} step`);
  if (!steps.length) throw new Error(`Method version ${version.id} needs at least one procedure step.`);
  for (const [index, step] of steps.entries()) {
    identifier(step.type, `Procedure step ${index + 1} type`);
    identifier(step.title, `Procedure step ${index + 1} title`);
    if (!METHOD_STEP_TYPES.includes(step.type)) throw new Error(`Procedure step ${index + 1} type is unsupported.`);
    if (!Number.isInteger(step.order) || step.order < 1) throw new Error(`Procedure step ${index + 1} order is invalid.`);
    for (const field of ['instruction', 'measurementName', 'unit', 'condition', 'expected']) optionalString(step[field], `Procedure step ${index + 1} ${field}`);
    if (step.required !== undefined && typeof step.required !== 'boolean') throw new Error(`Procedure step ${index + 1} required flag is invalid.`);
    if (step.type === 'measurement' && (!step.measurementName || !step.unit)) throw new Error(`Measurement step ${index + 1} needs a name and declared unit.`);
  }
  const materials = recordArray(version.materials, `Method version ${version.id} materials`);
  uniqueIds(materials, `method version ${version.id} material`);
  for (const [index, material] of materials.entries()) {
    identifier(material.name, `Required material ${index + 1} name`);
    if (material.quantity !== undefined) positive(material.quantity, `Required material ${index + 1} quantity`);
    optionalString(material.unit, `Required material ${index + 1} unit`); optionalString(material.notes, `Required material ${index + 1} notes`);
  }
  const equipment = recordArray(version.equipment, `Method version ${version.id} equipment`);
  uniqueIds(equipment, `method version ${version.id} equipment`);
  for (const [index, item] of equipment.entries()) { identifier(item.name, `Required equipment ${index + 1} name`); optionalString(item.purpose, `Required equipment ${index + 1} purpose`); optionalString(item.notes, `Required equipment ${index + 1} notes`); }
  const measurements = recordArray(version.measurements, `Method version ${version.id} measurements`);
  const measurementIds = uniqueIds(measurements, `method version ${version.id} measurement`);
  for (const [index, measurement] of measurements.entries()) {
    identifier(measurement.name, `Measurement ${index + 1} name`); identifier(measurement.unit, `Measurement ${index + 1} unit`); validateCriterion(measurement.criterion, `Measurement ${index + 1}`);
    if (measurement.required !== undefined && typeof measurement.required !== 'boolean') throw new Error(`Measurement ${index + 1} required flag is invalid.`);
    optionalString(measurement.notes, `Measurement ${index + 1} notes`);
  }
  const conditions = recordArray(version.conditions, `Method version ${version.id} conditions`); const conditionIds = uniqueIds(conditions, `method version ${version.id} condition`);
  for (const [index, condition] of conditions.entries()) { identifier(condition.name, `Required condition ${index + 1} name`); identifier(condition.expected, `Required condition ${index + 1} expected value`); optionalString(condition.unit, `Required condition ${index + 1} unit`); if (condition.required !== undefined && typeof condition.required !== 'boolean') throw new Error(`Required condition ${index + 1} required flag is invalid.`); }
  const observations = recordArray(version.observations, `Method version ${version.id} observations`); const observationIds = uniqueIds(observations, `method version ${version.id} observation`);
  for (const [index, observation] of observations.entries()) { identifier(observation.name, `Required observation ${index + 1} name`); identifier(observation.prompt, `Required observation ${index + 1} prompt`); if (observation.required !== undefined && typeof observation.required !== 'boolean') throw new Error(`Required observation ${index + 1} required flag is invalid.`); }
  const evidenceRequirements = recordArray(version.evidenceRequirements, `Method version ${version.id} evidence requirements`); const evidenceIds = uniqueIds(evidenceRequirements, `method version ${version.id} evidence requirement`);
  for (const [index, requirement] of evidenceRequirements.entries()) { identifier(requirement.name, `Evidence requirement ${index + 1} name`); if (requirement.required !== undefined && typeof requirement.required !== 'boolean') throw new Error(`Evidence requirement ${index + 1} required flag is invalid.`); }
  return { stepIds, measurementIds, conditionIds, observationIds, evidenceIds };
}

export function validateMethodsState(state) {
  const { methods, methodVersions, methodExecutions } = arrays(state);
  const methodIds = uniqueIds(methods, 'method');
  const versionIds = uniqueIds(methodVersions, 'method version');
  uniqueIds(methodExecutions, 'method execution');
  for (const method of methods) {
    identifier(method.id, 'Method id'); identifier(method.title, `Method ${method.id} title`); identifier(method.ownerId, `Method ${method.id} owner`); optionalString(method.author, `Method ${method.id} author`); strictTimestamp(method.createdAt, `Method ${method.id} createdAt`); strictTimestamp(method.updatedAt, `Method ${method.id} updatedAt`);
    if (!Array.isArray(method.tags) || method.tags.some(tag => typeof tag !== 'string' || !tag.trim())) throw new Error(`Method ${method.id} tags are invalid.`);
    if (!METHOD_STATUSES.includes(method.status)) throw new Error(`Method ${method.id} status is invalid.`);
    if (!versionIds.has(method.draftVersionId)) throw new Error(`Method ${method.id} must reference a draft version.`);
    const draft = methodVersions.find(item => item.id === method.draftVersionId);
    if (!draft || draft.methodId !== method.id || draft.status !== 'draft') throw new Error(`Method ${method.id} draft link is invalid.`);
    if (method.currentVersionId && (!versionIds.has(method.currentVersionId) || methodVersions.find(item => item.id === method.currentVersionId).methodId !== method.id || methodVersions.find(item => item.id === method.currentVersionId).status !== 'published')) throw new Error(`Method ${method.id} published version link is invalid.`);
  }
  const versionShapes = new Map();
  for (const version of methodVersions) {
    identifier(version.id, 'Method version id'); identifier(version.methodId, `Method version ${version.id} method`); strictTimestamp(version.createdAt, `Method version ${version.id} createdAt`);
    if (!methodIds.has(version.methodId)) throw new Error(`Method version ${version.id} references an unknown method.`);
    if (!METHOD_VERSION_STATUSES.includes(version.status)) throw new Error(`Method version ${version.id} status is invalid.`);
    if (!Number.isInteger(version.version) || version.version < 0) throw new Error(`Method version ${version.id} number is invalid.`);
    const shape = validateMethodDefinition(version);
    if (version.publishedAt) strictTimestamp(version.publishedAt, `Method version ${version.id} publishedAt`);
    if (version.status === 'published' && !version.publishedAt) throw new Error(`Published method version ${version.id} needs publishedAt.`);
    versionShapes.set(version.id, shape);
  }
  for (const execution of methodExecutions) {
    identifier(execution.id, 'Method execution id'); identifier(execution.methodId, `Method execution ${execution.id} method`); identifier(execution.methodVersionId, `Method execution ${execution.id} version`);
    if (!methodIds.has(execution.methodId) || !versionIds.has(execution.methodVersionId)) throw new Error(`Method execution ${execution.id} has an invalid method link.`);
    const version = methodVersions.find(item => item.id === execution.methodVersionId);
    if (version.methodId !== execution.methodId || version.status !== 'published') throw new Error(`Method execution ${execution.id} must reference a published method version.`);
    if (!METHOD_EXECUTION_STATUSES.includes(execution.status)) throw new Error(`Method execution ${execution.id} status is invalid.`);
    strictTimestamp(execution.startedAt, `Method execution ${execution.id} start`); strictTimestamp(execution.createdAt, `Method execution ${execution.id} createdAt`); strictTimestamp(execution.updatedAt, `Method execution ${execution.id} updatedAt`); if (execution.completedAt !== undefined) strictTimestamp(execution.completedAt, `Method execution ${execution.id} completion`);
    optionalString(execution.experimentId, `Method execution ${execution.id} experiment`); optionalString(execution.batchId, `Method execution ${execution.id} batch`); supportedReference(state, 'experiment', execution.experimentId); supportedReference(state, 'batch', execution.batchId);
    if (!execution.experimentId && !execution.batchId) throw new Error(`Method execution ${execution.id} needs an experiment or batch link.`);
    if (execution.batchId) { const batch = state.batches.find(item => item.id === execution.batchId); if (execution.experimentId && batch.experimentId !== execution.experimentId) throw new Error(`Method execution ${execution.id} batch and experiment do not match.`); }
    if (execution.status === 'completed' && execution.completedAt === undefined) throw new Error(`Method execution ${execution.id} completion timestamp is required.`);
    const shape = versionShapes.get(version.id);
    const steps = recordArray(execution.steps, `Method execution ${execution.id} steps`); const stepIds = new Set();
    for (const step of steps) { identifier(step.stepId, `Method execution ${execution.id} step id`); if (!shape.stepIds.has(step.stepId)) throw new Error(`Method execution ${execution.id} references an unknown step in its published version.`); if (stepIds.has(step.stepId)) throw new Error(`Method execution ${execution.id} contains a duplicate step reference.`); stepIds.add(step.stepId); if (!METHOD_STEP_STATUSES.includes(step.status)) throw new Error(`Method execution ${execution.id} step status is invalid.`); optionalString(step.notes, `Method execution ${execution.id} step notes`); stringArray(step.observations || [], `Method execution ${execution.id} step observations`); }
    const measurements = recordArray(execution.measurements, `Method execution ${execution.id} measurements`); uniqueIds(measurements, `method execution ${execution.id} measurement`);
    for (const measurement of measurements) {
      identifier(measurement.executionId, `Method execution ${execution.id} measurement execution`); if (measurement.executionId !== execution.id) throw new Error(`Method execution ${execution.id} measurement has an invalid execution link.`); identifier(measurement.methodMeasurementId, `Method execution ${execution.id} measurement definition`); if (!shape.measurementIds.has(measurement.methodMeasurementId)) throw new Error(`Method execution ${execution.id} references an unknown measurement in its published version.`);
      const definition = version.measurements.find(item => item.id === measurement.methodMeasurementId); identifier(measurement.name, `Method execution ${execution.id} measurement name`); if (measurement.name !== definition.name) throw new Error(`Method execution ${execution.id} measurement name does not match its published definition.`); positive(measurement.value, `Method execution ${execution.id} measurement`, { allowZero: true }); identifier(measurement.unit, `Method execution ${execution.id} measurement unit`); strictTimestamp(measurement.observedAt, `Method execution ${execution.id} measurement timestamp`); if (!['pass', 'fail', 'not-evaluated'].includes(measurement.criterionResult)) throw new Error(`Method execution ${execution.id} measurement result is invalid.`); identifier(measurement.criterionReason, `Method execution ${execution.id} measurement result reason`); optionalString(measurement.equipmentId, `Method execution ${execution.id} measurement equipment`); optionalString(measurement.condition, `Method execution ${execution.id} measurement condition`); stringArray(measurement.evidenceRefs || [], `Method execution ${execution.id} measurement evidence references`); optionalString(measurement.notes, `Method execution ${execution.id} measurement notes`);
      const expected = evaluateCriterion(definition.criterion, measurement.value, measurement.unit); if (measurement.criterionResult !== expected.status) throw new Error(`Method execution ${execution.id} measurement result does not match its published criterion.`);
    }
    const observations = recordArray(execution.observations, `Method execution ${execution.id} observations`); uniqueIds(observations, `method execution ${execution.id} observation`); for (const observation of observations) { identifier(observation.name, `Method execution ${execution.id} observation name`); optionalString(observation.value, `Method execution ${execution.id} observation value`); strictTimestamp(observation.observedAt, `Method execution ${execution.id} observation timestamp`); optionalString(observation.notes, `Method execution ${execution.id} observation notes`); stringArray(observation.evidenceRefs || [], `Method execution ${execution.id} observation evidence references`); }
    const conditions = recordArray(execution.conditions, `Method execution ${execution.id} conditions`); uniqueIds(conditions, `method execution ${execution.id} condition`); for (const condition of conditions) { identifier(condition.methodConditionId, `Method execution ${execution.id} condition definition`); if (!shape.conditionIds.has(condition.methodConditionId)) throw new Error(`Method execution ${execution.id} references an unknown condition in its published version.`); const definition = version.conditions.find(item => item.id === condition.methodConditionId); identifier(condition.name, `Method execution ${execution.id} condition name`); if (condition.name !== definition.name) throw new Error(`Method execution ${execution.id} condition name does not match its published definition.`); identifier(condition.value, `Method execution ${execution.id} condition value`); optionalString(condition.unit, `Method execution ${execution.id} condition unit`); strictTimestamp(condition.observedAt, `Method execution ${execution.id} condition timestamp`); optionalString(condition.notes, `Method execution ${execution.id} condition notes`); }
    const evidence = recordArray(execution.evidence, `Method execution ${execution.id} evidence`); uniqueIds(evidence, `method execution ${execution.id} evidence`); for (const item of evidence) { identifier(item.requirementId, `Method execution ${execution.id} evidence requirement`); if (!shape.evidenceIds.has(item.requirementId)) throw new Error(`Method execution ${execution.id} references an unknown evidence requirement in its published version.`); identifier(item.reference, `Method execution ${execution.id} evidence reference`); strictTimestamp(item.recordedAt, `Method execution ${execution.id} evidence timestamp`); optionalString(item.notes, `Method execution ${execution.id} evidence notes`); }
    const deviations = recordArray(execution.deviations, `Method execution ${execution.id} deviations`); uniqueIds(deviations, `method execution ${execution.id} deviation`); for (const deviation of deviations) { if (deviation.stepId !== undefined && (!identifier(deviation.stepId, `Method execution ${execution.id} deviation step`) || !shape.stepIds.has(deviation.stepId))) throw new Error(`Method execution ${execution.id} deviation references an unknown step in its published version.`); identifier(deviation.description, `Method execution ${execution.id} deviation description`); strictTimestamp(deviation.recordedAt, `Method execution ${execution.id} deviation timestamp`); optionalString(deviation.reason, `Method execution ${execution.id} deviation reason`); stringArray(deviation.evidenceRefs || [], `Method execution ${execution.id} deviation evidence references`); }
    stringArray(execution.evidenceRefs || [], `Method execution ${execution.id} evidence references`);
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
  if (method.status === 'retired') throw new Error('Retired methods cannot be edited.');
  if (draft.status !== 'draft') throw new Error('Only a draft method can be edited.');
  const nextDraft = { ...draft, ...normalizeDefinition({ ...draft, ...input }), updatedAt: now() };
  const nextMethod = { ...method, title: nextDraft.title, purpose: nextDraft.purpose, scope: nextDraft.scope, tags: nextDraft.tags, author: text(input.author, 'Method author', { optional: true }) || method.author, updatedAt: now() };
  return validateMethodsState({ ...state, methods: state.methods.map(item => item.id === methodId ? nextMethod : item), methodVersions: state.methodVersions.map(item => item.id === draft.id ? nextDraft : item) });
}

export function publishMethod(state, methodId) {
  const method = methodRecord(state, methodId); if (method.status === 'retired') throw new Error('Retired methods cannot be published.'); const draft = methodVersion(state, method.draftVersionId); if (draft.status !== 'draft') throw new Error('Only a draft method can be published.');
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
  const requiredMeasurements = version.measurements.filter(definition => definition.required !== false);
  const missingMeasurements = requiredMeasurements.filter(definition => !execution.measurements.some(item => item.methodMeasurementId === definition.id)).map(item => item.name);
  const missingAcceptanceCriteria = requiredMeasurements.filter(definition => !definition.criterion).map(item => item.name);
  const missingObservations = version.observations.filter(definition => definition.required && !execution.observations.some(item => item.name === definition.name)).map(item => item.name);
  const missingConditions = version.conditions.filter(definition => definition.required && !execution.conditions.some(item => item.methodConditionId === definition.id)).map(item => item.name);
  const missingEvidence = version.evidenceRequirements.filter(definition => definition.required && !(execution.evidence || []).some(item => item.requirementId === definition.id)).map(item => item.name);
  const results = execution.measurements.map(item => ({ ...item, criterion: version.measurements.find(definition => definition.id === item.methodMeasurementId)?.criterion || null }));
  const failedMeasurements = results.filter(item => item.criterion && item.criterionResult === 'fail').map(item => item.name);
  const unevaluatedMeasurements = results.filter(item => item.criterion && !['pass', 'fail'].includes(item.criterionResult)).map(item => item.name);
  const requiredResults = requiredMeasurements.flatMap(definition => execution.measurements.filter(item => item.methodMeasurementId === definition.id));
  const requiredMeasurementsPass = requiredMeasurements.length > 0 && !missingMeasurements.length && !missingAcceptanceCriteria.length && requiredResults.length === requiredMeasurements.length && requiredResults.every(item => item.criterionResult === 'pass');
  const acceptance = failedMeasurements.length ? 'fail' : requiredMeasurementsPass && !unevaluatedMeasurements.length ? 'pass' : 'not-evaluated';
  return { method, version, execution, missingSteps, missingMeasurements, missingAcceptanceCriteria, missingObservations, missingConditions, missingEvidence, failedMeasurements, unevaluatedMeasurements, measurementResults: results, acceptance, canClaimComplete: execution.status === 'completed' && !missingSteps.length && !missingMeasurements.length && !missingAcceptanceCriteria.length && !missingObservations.length && !missingConditions.length && !missingEvidence.length && acceptance === 'pass' };
}

export function clonePublishedMethodToDraft(state, methodId) {
  const method = methodRecord(state, methodId); if (method.status === 'retired') throw new Error('Retired methods cannot be cloned.'); if (!method.currentVersionId) throw new Error('The method has no published version to copy.');
  const published = methodVersion(state, method.currentVersionId); const draft = { ...clone(published), id: id('method-draft'), version: 0, status: 'draft', publishedAt: undefined, createdAt: now() };
  return validateMethodsState({ ...state, methods: state.methods.map(item => item.id === methodId ? { ...item, draftVersionId: draft.id, status: 'draft', updatedAt: now() } : item), methodVersions: [draft, ...state.methodVersions] });
}
