---
---

Bring `examples/` into the pnpm workspace and cover it from the root test
ladder. The example package gains its own Vitest config (it previously
inherited the root `projects` glob and found none) and a `clean` script. No
published package behaviour changes, so no version bump.
