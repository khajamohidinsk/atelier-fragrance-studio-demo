# Atelier — Scent Lab

Atelier is a standalone, production-minded scent journal and perfume experiment tracker for documenting sensory observations, formula revisions, experimental batches, dilution calculations, and comparisons over time. It is an independent clean-room project with synthetic seed data only.

## Implemented workflow

The core workflow is functional in the browser:

1. Create, edit, duplicate, search, and filter journal entries.
2. Create an experiment with an ID, objective, and workflow status.
3. Add formula revisions without overwriting earlier revisions.
4. Calculate a stock-to-target dilution with an explicit mass or volume basis.
5. Record actual batch additions, lot references, and procedure notes.
6. Add sensory evaluations with intervals, conditions, descriptors, and optional measured-result notes.
7. Compare two formula revisions side by side.
8. Inspect lot-level stock balances and movements, including batch-linked consumption.
9. Export and validate a versioned JSON backup, then merge or replace local state through an explicit import workflow.
10. Compare revisions using deterministic ingredient/evaluation evidence and provenance warnings.
11. Open Scent Companion for editable sensory notes, browser dictation, optional vocabulary guidance, and spoken formulation briefings.
12. Open Experiment Coach for a read-only, source-linked debrief and a proposed next controlled experiment.
13. Register lab equipment, append verification and maintenance history, and record linked measurements without inventing units or calibration evidence.
14. Record receipt-backed purchases against material lots and cost physical batches from their actual additions.
15. Create blind sensory sessions that randomize physical batches into opaque codes, collect evaluator observations, lock progress, and explicitly unblind results.
16. Create maturation and stability observation plans with custom checkpoints, storage conditions, evidence-backed observations, and a chronological comparison timeline.
17. Plan controlled experiments with factors, condition arms, independent replicates, persisted execution randomisation, actual-run links, and cautious descriptive repeatability review.
18. Define versioned measurement methods and SOPs, publish immutable versions, execute an exact version against an existing experiment or batch, and record measurements, observations, evidence, and deviations.
19. Open Sensory Panel Analytics for reproducible 1–5 rating distributions, descriptor coverage, explicit repeat-pair summaries, and maturation checkpoint evidence.

## Features

- Journal records for opening, heart, dry-down, overall impression, purpose, hypothesis, descriptors, intensity, longevity, projection, evaluation time, medium, environment, personal notes, conclusions, and next steps.
- Experiment workflow statuses: Draft, Mixed, Maturing, Evaluated, and Archived. These are workflow labels, not scientific validation claims.
- Immutable formula revision history with `supersedesRevisionId` links.
- Material and lot ledger with optional supplier, product/reference, acquisition date, purity, stock concentration, density, storage notes, safety-reference, expiry, retest, and low-stock threshold fields. Multiple physical lots for one material remain separate.
- Append-only stock movements: opening, receipt, confirmed return, verified adjustment, consumption, wastage/disposal, correction, and reversal. Balances are replayed from movements; they are not independently editable.
- Batch traceability: every batch references an experiment and exact formula revision, while actual additions retain material, exact lot, and exactly one linked consumption movement.
- Physical batch workflow: select an experiment and exact revision, record batch identifier, planned size, mixing date, procedure notes, observations, deviations, and structured lot-specific actual additions. Review planned-versus-actual rows, missing additions, extra additions, quantity deviations, and linked stock movements without editing the formula revision.
- Evidence-aware sensory journal: record multiple timestamped intervals for a physical batch with elapsed time, medium, environment, conditions, descriptors, subjective notes, measured results, longevity/projection methods, predicted outcomes, conclusions, and next steps. Subjective, measured, predicted, AI-generated, synthetic, and missing evidence remain distinct.
- Equipment log: record equipment identity, status, resolution, verification outcomes/due dates, maintenance/fault events, and measurements linked to batches, experiments, journal entries, or evaluations. Verification remains unknown until evidence is recorded; overdue, failed, conditional, maintenance, out-of-service, and retired states stay visible as operational warnings.
- Purchase costs and batch costing: preserve supplier, date, invoice/reference, currency, receipt evidence, line-level quantity/unit/price/total, discount/tax/shipping, lot links, and historical prices. Batch costing uses actual additions and an explicit lot receipt source; missing evidence, ambiguous receipts, and incompatible units remain uncosted instead of being estimated.
- Blind sensory testing: create sessions from existing physical batches, persist a Fisher–Yates randomized order and opaque `BT-` sample codes, record existing sensory-evaluation fields without exposing identities, require one observation per sample before locking, and reveal code-to-batch/formula mappings only through an explicit unblind action. This is a workflow safeguard over browser-local state, not cryptographic access control.
- Maturation & stability tracker: create multiple plans per physical batch with user-defined date or elapsed-time checkpoints, preserve planned versus actual timing, record storage conditions and subjective physical/sensory changes separately from optional measured values, and show upcoming, due, overdue, completed, and evidence-status states without inventing a stability, safety, compliance, or readiness conclusion.
- Experiment Design & Repeatability: define user-owned factors, levels, controlled conditions, response measures, formula-revision-linked condition arms, and planned replicates; persist randomized execution order; link runs to existing physical batches and evidence; and calculate compatible numeric descriptive summaries only when actual completed replication supports them. The workspace does not claim causality, statistical significance, or scientific proof.
- Measurement Methods & SOPs: define structured procedures, required materials/equipment, typed measurement definitions and criteria, required conditions/observations/evidence, publish immutable numbered versions, and execute an exact version against existing experiments or batches. Missing results remain missing; incompatible units remain not evaluated; reports do not imply safety, stability, regulatory approval, or scientific validity.
- Sensory Panel Analytics: derive rating distributions, median/range and descriptive mean/standard deviation for the explicitly supported 1–5 intensity/longevity/projection dimensions; report missing and excluded records; preserve descriptor text; calculate repeat-pair differences only from explicit experiment-design replicate or repeated physical-batch links; and leave evaluator agreement or maturation rating trends uncalculated when the stored relationships cannot support them.
- Sensory timeline records for multiple intervals after mixing and a comparison view that keeps subjective impressions separate from measured-result text.
- Keyboard-friendly dialogs, readable tables, responsive mobile layouts, empty states, sample-data warnings, and local JSON export.

## Architecture and data model

The app is a dependency-free ES module application:

```text
index.html                  Application screens and accessible dialogs
styles.css                  Sage & Ivory responsive laboratory UI
app.js                      UI orchestration and browser event handlers
src/domain/types.js         JSDoc domain models (editor/type tooling friendly)
src/domain/calculations.mjs Pure calculation and unit-validation logic
src/domain/store.mjs        Normalized state, relationship helpers, persistence, equipment log
src/domain/persistence.mjs  Injectable browser-local persistence adapter
src/domain/backup.mjs       Versioned export, validation, merge, and restore
src/domain/comparison.mjs   Pure deterministic revision comparison
src/domain/methods.mjs      Versioned method/SOP lifecycle, executions, criteria, and reports
src/domain/sensory-analytics.mjs  Pure sensory rating, pairing, descriptor, and maturation analytics
src/domain/summaries.mjs    Provenance-aware experiment summaries
src/ui/companion.mjs        Scent Companion editor, speech APIs, AI review flow
src/ui/companion.css        Namespaced Companion styling
tests/calculations.test.mjs Calculation unit tests
tests/store.test.mjs        Store, stock-ledger, and relationship tests
tests/equipment.test.mjs    Equipment, verification, maintenance, measurement tests
tests/purchase-costs.test.mjs Purchase evidence and actual batch costing tests
tests/blind-sensory.test.mjs Blind session, shuffle, lock, and unblind tests
tests/maturation-stability.test.mjs Maturation plans, checkpoints, evidence, and timeline tests
tests/experiment-design.test.mjs Experiment design, randomization, execution, and review tests
tests/methods.test.mjs        Method/SOP lifecycle, execution, criteria, and report tests
tests/sensory-analytics.test.mjs  Rating, missingness, pairing, repeatability, and maturation analytics tests
tests/browser/methods-sop.spec.mjs Browser versioning, execution, reload, phone, and keyboard tests
tests/browser/sensory-panel-analytics.spec.mjs  Analytics filters, coded-data boundaries, phone, and keyboard tests
tests/backup.test.mjs       Backup validation, merge, and round-trip tests
tests/persistence.test.mjs  Adapter and legacy migration tests
tests/comparison.test.mjs   Deterministic comparison and summary tests
scripts/                    Lint, type-model, and static build checks
```

The normalized state contains journal entries, experiments, formula revisions, formula ingredients, materials with lots, batches with actual additions, dilution calculations, sensory evaluations, equipment, verification events, maintenance events, measurements, purchases, purchase line items, blind-testing sessions and samples, maturation plans, checkpoints, and observations, experiment designs, factors, conditions, response measures, planned runs, versioned measurement methods/SOPs, method executions, Companion observations, stock movements, attachments, and tags. The current browser adapter persists the complete state in `localStorage` under `atelier-lab-state-v1`; records are not shared across users or devices.

Sensory Panel Analytics is derived in memory from those existing records. It adds no analytics collection or schema migration and does not write summaries to localStorage or backups.

## Stock ledger and history integrity

Each lot belongs to one material and has a stock unit when known. A movement quantity is always positive; movement type and direction determine whether it increases or decreases the replayed balance. Mass and volume remain separate unless a valid positive density in g/mL is supplied. Consumption is rejected when it would make the lot balance negative. Replayed balances are rounded to a documented `1e-9` base-unit precision after each movement to prevent accumulated floating-point drift; the original quantity, unit, density, and timestamp remain on every movement for auditability.

A lot's opening balance is either **established** or **unreconciled**. It is established when the lot records a received amount or carries an explicit `opening` movement. Otherwise the lot is unreconciled: its replayed balance is a floor derived from recorded consumption, not a measured stock figure, and `stockStatus` reports `balanceKnown: false` so callers never present it as an on-hand quantity. Further consumption on an unreconciled lot is refused, because without an opening there is no way to distinguish a valid draw from an overdraft. Receipts, corrections and reversals stay permitted. `reconcileLotOpening` records a user-supplied opening for such a lot and is the only sanctioned path out of the unreconciled state; the amount always comes from the user's measurement and is never derived from consumption history. A lot with an established opening is reported as reconciled with a real balance.

Batch creation validates the experiment, canonical formula revision, material/lot ownership, units, concentrations, batch identifier, mixing timestamp, and exact addition identifiers before constructing the next state. It appends one `consumption` movement per actual addition and stores that movement ID on the addition. A repeated addition ID, movement ID, batch code, or idempotency key is rejected; a retry with the same idempotency key returns the existing normalized state without another deduction. Corrections are compensating movements; historical movements are never rewritten. Each addition and its movement must also agree on the exact quantity and on interchangeable units, so a re-expressed or altered record is rejected rather than silently replaying a different balance.

`compareBatchToPlan(state, batchId)` deterministically compares the selected revision's planned ingredients with the batch's actual additions in the batch unit. It converts compatible units, requires density for mass/volume conversion, and reports matched rows, missing planned additions, extra actual additions, quantity deviations, and total difference. A batch's planned size is kept separately from the formula ingredient comparison and from the actual measured additions.

Existing version-1 local state is migrated by replaying the consumption that its batch additions document, and the migration is recorded with its provenance. The opening balance is *not* inferred from that consumption, because doing so would fabricate inventory. A lot that already records a received amount gets an explicit `opening` movement for exactly that amount and is left established. A lot without one keeps its historical consumption, is marked unreconciled, and must be reconciled by hand before further consumption is allowed.

Formula revisions are append-only. A new revision must belong to the target experiment and supersede that experiment's current latest revision. Batches retain the exact revision used. Evaluations validate experiment, batch, and revision relationships and derive a missing revision from the selected batch when possible. Journal-to-experiment reverse links are maintained by the domain operation rather than only by the UI.

### Inventory operations

Open **Inventory & materials** from the sidebar to add a material, add separate lots, append receipts/returns/verified adjustments/disposals/corrections, and inspect chronological lot history. Adjustment, correction, and disposal records require a reason; adjustments also require explicit verification. A return requires an explicit confirmation checkbox. Historical movements are never edited. Use **Reconcile** on a lot to compare recorded on-hand with a physical count; the variance is shown before a compensating adjustment is appended. Lots without a trustworthy opening remain visibly unknown and can be given a measured opening through the same workflow.

The inventory dashboard reports known lots, lots requiring reconciliation, low-stock thresholds, expiry/retest reminders, recent movements, missing lot codes, and linked batch usage. These are operational reminders only and do not prove chemical safety, identity, purity, or usability.

### Purchase costs and batch costing

Open **Purchases & costs** to record a supplier receipt and link each purchase line to an existing material lot. Receipt evidence can be a durable local file reference/data URL for a small image, PDF, or text file, or an explicit archive/reference key. Files are kept within the browser-local state and capped at 2 MB; no external service is used. Prices without evidence remain unverified.

Each purchase line preserves its purchased quantity, unit, unit price, line total, and source receipt. Purchase-level discount, tax, and shipping are allocated proportionally across line totals when a non-zero subtotal exists. Actual batch costing uses the quantities recorded in `actualAdditions`, converts only compatible units (or uses the lot density for an explicit mass/volume bridge), and shows costable subtotals by currency separately from uncosted additions. If several receipt lines exist for the same lot, the actual addition must identify the exact purchase line; the system never silently selects a newer price.

### Blind sensory testing

Open **Blind sensory testing** to create a session from two or more physical batches. Draft sessions show candidate identities to the session creator so the candidate set can be checked. Once randomized, the session stores an unbiased Fisher–Yates order and opaque `BT-` codes; the evaluator-facing view exposes only those codes. Observations reuse the existing sensory-evaluation fields and remain subjective/measured/provenance-aware. Every sample needs at least one recorded observation before the session can be locked. Locked observations are finalized, and only an explicit **Unblind session** action reveals the mapping to batch codes, experiment titles, and formula revisions.

Reloading, navigation, and backup restore reuse the saved assignment rather than reshuffling. The browser-local workflow is not a security boundary: someone with access to localStorage or developer tools can inspect the underlying mapping.

## Versioned backup and persistence adapter

Backups use the envelope `{format: "atelier-scent-lab-backup", backupVersion: 1, schemaVersion: 3, application, exportedAt, state}`. Schema versions 1 and 2 are accepted and migrated to the current state schema; future schema versions are rejected before any write. Export includes the complete validated local state, including `methods`, immutable `methodVersions`, and `methodExecutions`; historical method/version links are preserved, conflicts are not silently overwritten, and invalid relationships are rejected before persistence. Planned formula quantities remain separate from actual batch additions, and subjective, measured, predicted, AI-generated, and synthetic-demo records remain distinguishable. See `docs/METHODS_SOP_LIBRARY.md` for the method-library compatibility contract.

Import validates JSON, format/version, record IDs, units, quantities, duplicate movements, reversal references, ledger replay, and entity relationships before applying anything. The import dialog previews new records, changed IDs, identical/preserved IDs, records discarded by replacement, and missing-reference errors. Merge adds only missing IDs and keeps current conflicting records without overwriting them. Replace explicitly replaces the local state only after validation and first stores the current validated state in the same versioned backup envelope as a recovery backup. The recovery action can restore that previous local state after a replacement. Re-importing the same file is idempotent, and a failed persistence or recovery write leaves the prior saved state intact. The current version-1 local state and legacy `atelier.scent-companion.v1` data are migrated without deleting the source until the new state has been saved successfully.

`src/domain/persistence.mjs` defines the small adapter seam used by the app: `load()`, `save(state)`, `saveRecovery(state)`, `loadRecovery()`, `subscribe(listener)`, and `schemaVersion`. The included adapter is synchronous browser `localStorage`; tests use an in-memory adapter. Storage, serialization, malformed-state, quota, recovery, and migration failures are surfaced instead of being reported as successful saves or silently reset.

The browser-local boundary still means no cloud backup, cross-device synchronization, authentication, or multi-user access. The adapter is replaceable later; no remote persistence implementation is included here.

## Recorded-data analysis and provenance

`compareRevisions()` compares stable ingredient keys, quantities, units, concentrations, roles, lots, revision-linked batches, and revision-linked evaluations. It reports incompatible or differing evaluation conditions instead of implying a controlled comparison. `summarizeExperiment()` keeps recorded, measured, subjective, synthetic/demo, and AI-generated categories distinct and emits warnings when evidence is missing or provenance is incomplete. No causal conclusion or missing measurement is invented.

## Experiment Coach

`src/domain/coach.mjs` builds a read-only context from one experiment and its immutable formula revisions, physical batches, actual additions, planned-versus-actual comparison, journal entries, chronological sensory evaluations, equipment measurements, maturation observations, blind sessions, and experiment-design runs. `createExperimentCoachDebrief()` returns evidence-linked claims with stable source IDs, explicit missing/contradictory evidence, provenance labels, and a context-aware proposed next controlled experiment containing what to try, why the recorded evidence motivates it, what to hold constant, what to record next, a schedule, and limitations. Blind sample identities remain hidden until the existing explicit unblind action. Proposed items are labelled hypotheses or protocol suggestions; they are never treated as observations, safety claims, or stock instructions.

The Coach treats free-text observations as quoted, untrusted evidence. Instruction-like text is reported as a prompt-injection warning and is not executed or allowed to change the proposed protocol. The Coach does not write state, modify formulas, alter inventory, or call an AI provider. It reuses deterministic batch and revision comparison logic for arithmetic and provenance checks. The UI keeps this flow read-only and does not add a competing catalogue, research pipeline, or formula engine.

## Scent Companion

Scent Companion stores observations in `state.companionEntries`. Each record retains `materialName`, `evaluationType`, optional concentration/evaluation method/elapsed time, `originalText`, `correctedText`, `createdAt`, `updatedAt`, input `source` (`typed` or `speech`), and reviewed AI suggestions. The existing legacy key `atelier.scent-companion.v1` is imported once when the main Atelier state has no Companion observations; existing records are not discarded.

The dictation controller uses `SpeechRecognition` or `webkitSpeechRecognition` with `continuous` mode where available. Browser services can still end a session, so the controller flushes final results, preserves accumulated text, restarts only while the user has not pressed Stop, and stops after a bounded ten-minute/24-restart limit. Microphone permission denial, unsupported browsers, no-speech, network, and fatal capture errors leave manual typing available. Raw audio is never stored.

Briefing playback uses the browser's built-in `speechSynthesis` / `SpeechSynthesisUtterance` APIs. It does not call an AI speech service and does not require an API key. Voice availability, pronunciation, and offline behavior depend on the browser and installed operating-system voices. Listen becomes available after a briefing has been generated; Pause/Resume and Stop control the active utterance.

The current persistence boundary is browser-local `localStorage`: it survives reloads in the same browser profile but has no cloud backup and does not synchronize across browser profiles, devices, or users. The pure store operations (`addCompanionEntry`, `updateCompanionEntry`, `deleteCompanionEntry`, and `importLegacyCompanionEntries`) are the adapter surface for a future authenticated Ravenn persistence service.

### Browser acceptance tests

The repeatable browser suites are `tests/browser/b6-portability.spec.mjs`, `tests/browser/coach.spec.mjs`, `tests/browser/equipment.spec.mjs`, `tests/browser/purchase-costs.spec.mjs`, `tests/browser/blind-sensory.spec.mjs`, `tests/browser/maturation-stability.spec.mjs`, `tests/browser/experiment-design.spec.mjs`, and `tests/browser/sensory-panel-analytics.spec.mjs`. They use Playwright with isolated browser contexts, real JSON files, the hidden import file input via `setInputFiles()`, actual UI export downloads, reload readback, duplicate-safe merge, conflict preview, replacement recovery, invalid-file safety, Companion/batch/evaluation round trips, equipment registry/history/measurement flows, receipt-backed purchase entry, partial actual batch costing, blind randomization/observation/lock/unblind flows, maturation plan/checkpoint/observation/timeline flows, experiment-design matrix/randomization/execution flows, Sensory Panel Analytics distributions/filtering/insufficient-data/blinding flows, and context-aware Coach recommendation flows. Run `npm run test:browser`; the Playwright Chromium browser is installed with `npx playwright install chromium` when needed. The suites use synthetic fixture data only and do not require AI configuration, credentials, network services, or a database.

### Free local AI with Ollama (no API key)

The server supports Ollama's native local chat endpoint. Install and start Ollama, and ensure the model is available locally. For the current model already used in this project, `qwen2.5-coder:7b`, start the Atelier server in PowerShell like this:

```powershell
$env:AI_PROVIDER = 'ollama'
$env:AI_MODEL = 'qwen2.5-coder:7b'
npm start
```

Ollama's default endpoint is `http://127.0.0.1:11434/api/chat`. Override it with `AI_API_URL` only if Ollama is listening elsewhere. No `AI_API_KEY` is required for local Ollama. The server's default AI timeout is 120 seconds to allow a local model to respond on CPU; adjust `AI_TIMEOUT_MS` if necessary. Check `GET /api/health` for `aiConfigured`, `aiProvider`, and `aiModel`.

To use a remote OpenAI-compatible provider instead, set `AI_PROVIDER=openai-compatible`, `AI_API_URL`, `AI_API_KEY`, and `AI_MODEL`. Keep remote keys server-side; never commit them. The server does not automatically load a `.env` file, and `.env` is ignored by Git.

The browser calls `POST /api/scent-companion/assist` for `chat`, `vocabulary`, `explain`, or `briefing`. The conversational `chat` action accepts a free-form message plus bounded recent history and asks the model to classify the request, answer it, or ask one clarifying question. The server validates requests and returns a generic error when the local model or upstream provider is unavailable. Vocabulary results preserve the user's observation and remain separate until reviewed. Briefings are explicitly intended/predicted from supplied formula information, not physical observations.

## Calculation conventions

Concentrations are percentages from 0 to 100. The stock-to-target dilution uses:

```text
stock amount = final amount × target concentration ÷ stock concentration
```

The diluent is treated as 0%. The calculator requires the target to be no greater than the known stock concentration. Mass units (`mg`, `g`, `kg`) and volume units (`mL`, `L`) are kept separate. Same-family conversion is allowed; mass ↔ volume conversion requires an explicit positive density in g/mL. Grams and millilitres are never silently treated as interchangeable. Calculated values are shown separately from measured additions and are not analytical laboratory measurements.

## Setup and commands

Requires Node.js 18+ and Python is not required.

```bash
npm run check       # lint parse check, domain-model check, tests, and build
npm test            # unit and data-model tests
npm run lint        # syntax-oriented module parse check
npm run typecheck   # verifies the documented JSDoc domain model surface
npm run build       # creates the static dist/ bundle
```

Serve the repository (or `dist/`) from a local HTTP server because ES modules are blocked by some browsers when opened directly from `file://`:

```bash
python -m http.server 8000
```

Open <http://localhost:8000>. Use the sidebar to move through Journal, Experiments, Materials, Dilution lab, Compare, and Export. For AI actions, use the Node server on port 8787 and open the app through that server instead.

## Limitations and safety

This is a local front-end application, not a multi-user server. It has no authentication, database server, file-upload backend, user access control, cloud sync, or real chemical inventory. Attachments are represented by references in the data model but the UI does not upload files. No supplier information, chemical property, safety classification, density, purity, or analytical result is invented; unknown fields remain blank. Users are responsible for their own material handling and safety procedures.

All seed names, records, ratings, materials, lots, and sensory notes are fictional. The project contains no private application source, credentials, API keys, proprietary research, or personal data.

## License

MIT. See `LICENSE`.
