---
"@behavior-os/cli": patch
---

Fix `behavioros drift-check`: compare every `dnas/*.yaml` snapshot against the
`diff` baseline with `DriftEngine` (governance rules and quality gates added,
removed or changed, plus patterns added or removed), keep the legacy
`selectedDna`/`currentStep` state baseline working, and exit 1 when drift is
detected.
