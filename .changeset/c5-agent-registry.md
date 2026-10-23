---
"@behavior-os/cli": patch
"@behavior-os/core": patch
---

`behavioros agent` now reads the SQLite agent registry (`--db`,
`<dir>/behavioros.db` or `<dir>/.behavioros/behavioros.db`) and lists every
registered agent; a missing registry is reported as empty, while an unreadable
one exits 1. `SqliteStore` now closes its connection when `PRAGMA`/migration
fails, so a corrupt database no longer leaks an open handle (notably on
Windows).
