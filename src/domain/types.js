/** @typedef {{ id: string, title: string, observedAt: string, text?: string, tags?: Tag[], evaluations?: SensoryEvaluation[], experimentId?: string, attachments?: Attachment[] }} JournalEntry */
/** @typedef {{ id: string, name: string, status?: 'planned'|'running'|'complete'|'archived', formulaRevisionIds: string[], journalEntryIds?: string[], batchIds?: string[], tags?: Tag[] }} Experiment */
/** @typedef {{ id: string, formulaId: string, revision: number, ingredients: FormulaIngredient[], createdAt: string, supersedesRevisionId?: string, notes?: string }} FormulaRevision */
/** @typedef {{ materialId: string, quantity: number, unit: string, concentration?: number, percentage?: number }} FormulaIngredient */
/** @typedef {{ id: string, name: string, kind?: string, defaultUnit?: string, density?: number, supplier?: string }} Material */
/** @typedef {{ id: string, materialId: string, lotCode: string, receivedAt?: string, density?: number, notes?: string }} MaterialLot */
/** @typedef {{ id: string, experimentId: string, formulaRevisionId: string, plannedAmount: number, unit: string, actualAdditions: ActualAddition[], createdAt: string, completedAt?: string }} Batch */
/** @typedef {{ materialId: string, materialLotId?: string, amount: number, unit: string, concentration?: number, addedAt?: string }} ActualAddition */
/** @typedef {{ stockConcentration: number, targetConcentration: number, finalAmount: number, stockAmount: number, diluentAmount: number, unit: string }} DilutionCalculation */
/** @typedef {{ id?: string, evaluator?: string, recordedAt: string, scores?: Object<string, number>, descriptors?: string[], notes?: string }} SensoryEvaluation */
/** @typedef {{ id: string, name: string, mediaType: string, uri: string, createdAt?: string }} Attachment */
/** @typedef {{ id?: string, name: string, color?: string }} Tag */

export {};
