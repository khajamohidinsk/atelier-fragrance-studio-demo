import { readFile } from 'node:fs/promises';

const source = await readFile('src/domain/types.js', 'utf8');
const required = ['JournalEntry', 'Experiment', 'FormulaRevision', 'FormulaIngredient', 'Material', 'MaterialLot', 'Batch', 'ActualAddition', 'DilutionCalculation', 'SensoryEvaluation', 'Attachment', 'Tag', 'MethodStep', 'MethodCriterion', 'MethodVersion', 'MeasurementMethod', 'MethodExecution'];
const missing = required.filter(name => !source.includes(`@typedef` + ` {{` ) || !source.includes(` ${name} */`));
if (missing.length) throw new Error(`typecheck: missing domain typedefs: ${missing.join(', ')}`);
console.log(`typecheck: verified ${required.length} JSDoc domain models`);
