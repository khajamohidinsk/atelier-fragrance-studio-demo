# Sensory Panel Analytics

Sensory Panel Analytics is a read-only, browser-local view over existing sensory evaluations, blind-session coded samples, experiment-design runs, repeated physical-batch links, and maturation checkpoint observations. It does not add records or persist derived summaries.

## Rating summaries

- The supported rating scale is the existing integer `1–5` scale for `intensity`, `longevity`, and `projection`.
- Counts and percentages use valid ratings for that dimension as the denominator.
- Missing score fields and invalid/out-of-scale values are reported separately and are excluded from the denominator.
- Median and range are descriptive ordinal summaries. Mean and population standard deviation are shown only for the explicitly supported 1–5 dimensions.
- Other numeric score keys are shown as an unverified scale and are not coerced into an ordinal distribution.
- Descriptors remain text records. They are grouped case-insensitively for counting and are never converted into numeric ratings.

## Agreement and repeatability

Evaluator agreement is not calculated because the stored model has an optional session-level evaluator label, not an evaluator identity on each evaluation. A shared session label cannot establish evaluator pairs.

Repeatability summaries use only explicit relationships:

1. experiment-design runs with linked sensory evaluation IDs and distinct replicate numbers; or
2. repeated evaluations sharing the same physical-batch ID when no explicit design-run pairing is available.

For valid paired 1–5 ratings, exact agreement is equal-value pairs divided by all valid pairs, and within-one-point agreement is pairs with an absolute difference no greater than one divided by all valid pairs. Pair counts, excluded records, mean absolute difference, and pairing basis remain visible. These are descriptive repeat observations, not evidence of chemical measurement accuracy, evaluator correctness, causality, or consensus.

Kappa, intraclass correlation, significance tests, and other inferential statistics are omitted because evaluator identity, pairing completeness, and scale assumptions are not available in the current model.

## Maturation evidence

Maturation summaries use plan/checkpoint links, recorded labels, timestamps, descriptors, subjective fields, evidence status, and source observation IDs. Missing checkpoints remain missing. No interpolation, zero-filling, or continuous trend is created.

Maturation observations do not link to sensory rating dimensions, so the view reports checkpoint descriptor evidence while marking a paired maturation rating trend as not calculated. Instrumental measured values remain distinct from subjective observations.

## Blinding and provenance

The analytics UI exposes only stored coded sample labels, session names, counts, and derived summaries. It does not render batch codes, experiment titles, formula revisions, or code-to-batch mappings. The existing explicit unblind workflow remains the only mapping workflow. Every summary is derived on demand from source records; raw evaluations and maturation observations are unchanged.
