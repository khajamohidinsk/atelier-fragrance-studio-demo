# Experiment Coach acceptance

## Decision boundary

Experiment Coach is a deterministic, read-only evidence view over Atelier records. It is not a generic chatbot, formula engine, safety system, catalogue, research pipeline, or stock-authorisation path. It does not write `localStorage`, modify revisions, create batches, change evaluations, or alter inventory.

## Acceptance criteria

- Context is scoped by experiment and can be narrowed by one immutable revision and/or physical batch.
- Formula revisions, actual additions, planned-versus-actual batch evidence, journal entries, and chronological evaluations are retrieved with stable source IDs.
- Debrief claims carry source IDs and an evidence class such as `recorded`, `measured`, `subjective`, `missing-evidence`, or `hypothesis`.
- Missing records, invalid quantities, contradictory evaluation provenance, mismatched batch/revision links, and unavailable batch comparisons are shown explicitly.
- Proposed next work contains a hypothesis, one primary variable, controls, an observation schedule, and a success criterion. These are labelled proposals, not results.
- Instruction-like text in observations is preserved as quoted evidence and reported as a prompt-injection warning; it is not executed.
- Existing Companion, inventory, batch, sensory journal, backup, and comparison flows remain available.

## Executed checks

- B3 exact head `a21158d`: `npm run check` passed, 88 tests.
- B4 exact head `02b1ded`: `npm run check` passed, 94 tests.
- Current B6 head before Coach changes: `npm run check` passed, 107 tests; `npm run test:browser` passed, 6 tests.
- Coach implementation: `npm run check` passed, 112 tests; `npm run test:browser` passed, 7 tests; `git diff --check` passed.

## Known limits

- This is local, synthetic-demo functionality. It makes no production, scientific, safety, cloud-sync, or Ravenn-integration claim.
- The current deterministic debrief does not call a language model. Optional Scent Companion AI remains a separate workflow.
