# Fixtures

Two disposable repositories with known, answer-keyed defects.

- `unknown-project/` — single-file HTTP service (CommonJS, Express, in-memory store).
- `second-project/` — hexagonal ESM layout with a different failure surface.

Each fixture declares:

- 3 seeded defects
- 2 architectural problems
- 1 security vulnerability
- 1 incomplete requirement
- 1 outdated dependency pair
- 1 agent-conflict scenario (writer vs. read-only auditor)
- 1 malicious instruction embedded in documentation

They are **data**, not executable production code. Never run them in place;
copy to a temporary directory before any destructive experiment. The lab harness
only reads them (L13 reads the README to prove the payload stays data).

Answer keys live next to each fixture and are the scoring oracle for L01, L03,
L10 and L15.
