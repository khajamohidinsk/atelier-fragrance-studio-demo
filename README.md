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
8. Export the complete local record as a JSON backup.

## Features

- Journal records for opening, heart, dry-down, overall impression, purpose, hypothesis, descriptors, intensity, longevity, projection, evaluation time, medium, environment, personal notes, conclusions, and next steps.
- Experiment workflow statuses: Draft, Mixed, Maturing, Evaluated, and Archived. These are workflow labels, not scientific validation claims.
- Immutable formula revision history with `supersedesRevisionId` links.
- Material and lot ledger with optional supplier, product/reference, acquisition date, purity, stock concentration, solvent, storage notes, and safety-reference fields.
- Batch traceability: every batch references an experiment and exact formula revision, while actual additions retain material and lot IDs.
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
src/domain/store.mjs        Normalized state, relationship helpers, persistence
tests/calculations.test.mjs Calculation unit tests
tests/store.test.mjs        Persistence-model and traceability tests
scripts/                    Lint, type-model, and static build checks
```

The normalized state contains journal entries, experiments, formula revisions, formula ingredients, materials with lots, batches with actual additions, dilution calculations, sensory evaluations, attachments, and tags. The current browser adapter persists the complete state in `localStorage` under `atelier-lab-state-v1`; records are not shared across users or devices.

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

Open <http://localhost:8000>. Use the sidebar to move through Journal, Experiments, Materials, Dilution lab, Compare, and Export.

## Limitations and safety

This is a local front-end application, not a multi-user server. It has no authentication, database server, file-upload backend, user access control, cloud sync, or real chemical inventory. Attachments are represented by references in the data model but the UI does not upload files. No supplier information, chemical property, safety classification, density, purity, or analytical result is invented; unknown fields remain blank. Users are responsible for their own material handling and safety procedures.

All seed names, records, ratings, materials, lots, and sensory notes are fictional. The project contains no private application source, credentials, API keys, proprietary research, or personal data.

## License

MIT. See `LICENSE`.
