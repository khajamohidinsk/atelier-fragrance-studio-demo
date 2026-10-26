# Measurement Methods and SOP Library

Atelier stores reusable measurement methods and standard operating procedures in the same browser-local state as experiments, batches, equipment, measurements, journal entries, and backups.

## Lifecycle

- A method starts as a draft with structured steps, required materials/equipment, measurement definitions, conditions, observations, and evidence requirements.
- Publishing creates an immutable, numbered `methodVersions` record. The method keeps a fresh editable draft so later changes cannot mutate a version already used by an execution.
- Retiring a method keeps published versions and execution links readable.
- Each execution stores `methodVersionId`; it never resolves through the method's latest version after starting.

## Measurement semantics

- Planned criteria are stored on the published method version.
- Measurement definitions are required by default; callers may explicitly mark a definition optional with `required: false`.
- Observed values retain the entered unit, timestamp, equipment reference, conditions, notes, and evidence references.
- Pass/fail is calculated only when an explicit criterion exists and units are compatible. Unsupported or ambiguous conversions remain `not-evaluated`.
- An overall execution acceptance is `pass` only when every required measurement is present, every required measurement declares an explicit criterion, and every required result evaluates to `pass`. Missing measurements, missing criteria, incompatible units, and other unevaluable results keep acceptance at `not-evaluated`; any evaluated failed criterion makes acceptance `fail`.
- Execution status (`in-progress`, `completed`, or `interrupted`), missing requirements, individual measurement results, and overall acceptance remain separate report fields. Completing an execution does not turn incomplete or unevaluable measurements into a pass.
- Subjective observations, measured values, and deviations are separate execution records.
- Completion does not fabricate missing items or imply safety, stability, regulatory, or scientific validity.

## Supported links

An execution can link to an existing experiment, batch, or both. Batch links are checked against their experiment. Materials, equipment, and formula systems remain the existing Atelier entities; the method library does not duplicate them.

## Backup compatibility

State schema version is now `3`. Existing backups retain their envelope and add `methods`, `methodVersions`, and `methodExecutions`. Normal merge/replace validation applies. IDs and historical version references are preserved, conflicts are reported without overwriting current records, and invalid relationships are rejected before persistence. Older backups migrate with empty method collections.

SOP validation checks that execution steps, measurements, conditions, evidence records, and deviation step references resolve to the exact published `methodVersionId`. Required identifiers, timestamps, field types, criterion results, and execution links are validated before imported state is accepted. Evidence `reference` values remain external strings such as `notebook:page-4`; they are not required to match Atelier record IDs.

## UI workflow

Use **Methods & SOPs** to create and edit a draft, publish numbered versions, create a new draft from the latest version, execute a selected version against an experiment/batch, record steps/measurements/conditions/observations/evidence/deviations, and review the evidence-aware execution report. The browser regression flow verifies condition and evidence links survive reload against the exact execution version; domain and backup tests cover missing, unevaluable, passing, failing, and invalid-reference cases.

The feature remains browser-local and does not imply multi-user access control, laboratory accreditation, safety approval, product stability, or regulatory certification.
