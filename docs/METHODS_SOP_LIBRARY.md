# Measurement Methods and SOP Library

Atelier stores reusable measurement methods and standard operating procedures in the same browser-local state as experiments, batches, equipment, measurements, journal entries, and backups.

## Lifecycle

- A method starts as a draft with structured steps, required materials/equipment, measurement definitions, conditions, observations, and evidence requirements.
- Publishing creates an immutable, numbered `methodVersions` record. The method keeps a fresh editable draft so later changes cannot mutate a version already used by an execution.
- Retiring a method keeps published versions and execution links readable.
- Each execution stores `methodVersionId`; it never resolves through the method's latest version after starting.

## Measurement semantics

- Planned criteria are stored on the published method version.
- Observed values retain the entered unit, timestamp, equipment reference, conditions, notes, and evidence references.
- Pass/fail is calculated only when an explicit criterion exists and units are compatible. Unsupported or ambiguous conversions remain `not-evaluated`.
- Subjective observations, measured values, and deviations are separate execution records.
- Completion does not fabricate missing items or imply safety, stability, regulatory, or scientific validity.

## Supported links

An execution can link to an existing experiment, batch, or both. Batch links are checked against their experiment. Materials, equipment, and formula systems remain the existing Atelier entities; the method library does not duplicate them.

## Backup compatibility

State schema version is now `3`. Existing backups retain their envelope and add `methods`, `methodVersions`, and `methodExecutions`. Normal merge/replace validation applies. IDs and historical version references are preserved, conflicts are reported without overwriting current records, and invalid relationships are rejected before persistence. Older backups migrate with empty method collections.

## UI workflow

Use **Methods & SOPs** to create and edit a draft, publish numbered versions, create a new draft from the latest version, execute a selected version against an experiment/batch, record steps/measurements/observations/deviations, and review the evidence-aware execution report.

The feature remains browser-local and does not imply multi-user access control, laboratory accreditation, safety approval, product stability, or regulatory certification.
