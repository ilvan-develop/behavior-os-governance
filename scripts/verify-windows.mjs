#!/usr/bin/env node
/**
 * verify:windows — continuous zero-visible-windows gate (the tracer bullet).
 *
 * WHY: cycle 1 fixed visible CMD flashes by hardwiring `windowsHide` plus
 * `shell: true` with a single-string command (Node DEP0190-safe). A one-time
 * measurement decays; this gate re-measures on every verification run so a
 * spawn-shape regression bites the author immediately, not the user later.
 *
 * Behaviour:
 * - Non-win32: exit 0 with a skip note. The failure mode is Windows-specific;
 *   a non-Windows runner must not turn this gate red for that reason.
 * - Windows: runs `scripts/win-window-probe.mjs` against a representative
 *   governed shard — `pnpm --version`, the exact spawn topology that leaked
 *   windows before (`.cmd` shim resolved via shell:true). Exit 0 only when the
 *   probe observed zero new visible console windows; a failure prints every
 *   new window's pid/name/title so the source can be attributed.
 */
import { spawn } from 'node:child_process';

if (process.platform !== 'win32') {
  console.log('verify:windows: skipped (not Windows — the failure mode is win32-specific)');
  process.exit(0);
}

const probe = spawn(process.execPath, ['scripts/win-window-probe.mjs', '--', 'pnpm --version'], {
  cwd: process.cwd(),
  shell: false,
  stdio: 'inherit',
  windowsHide: true,
});
probe.on('error', (error) => {
  console.error(`verify:windows: could not start the probe — ${error.message}`);
  process.exit(1);
});
probe.on('close', (code) => {
  if (code === 0) {
    console.log('verify:windows: PASS — zero visible console windows during a governed spawn');
  }
  process.exit(code ?? 1);
});
