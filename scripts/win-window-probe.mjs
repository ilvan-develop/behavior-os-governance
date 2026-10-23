#!/usr/bin/env node
/**
 * win-window-probe — measurable detection of visible console windows on Windows.
 *
 * Usage:
 *   node scripts/win-window-probe.mjs -- "pnpm typecheck"
 *   node scripts/win-window-probe.mjs --cwd C:\path -- "biome check ."
 *
 * What it does:
 *   1. Snapshots every process that currently has a visible main window.
 *   2. Runs the given command exactly the way governed engines run it:
 *      spawn + shell + windowsHide + piped stdio.
 *   3. Samples the visible-window set every 50ms while the command runs and
 *      reports (a) exit code, (b) how many NEW visible windows appeared, and
 *      (c) their pid/name/title so the source can be attributed.
 *
 * Exit code: 0 when zero new visible windows appeared, 1 otherwise — so this
 * can run as a UX gate on Windows runners.
 */
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
let cwd = process.cwd();
let command = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cwd') cwd = args[++i];
  else if (args[i] === '--') command = args.slice(i + 1).join(' ');
}
if (!command) {
  console.error('Usage: node scripts/win-window-probe.mjs -- "<command>" [--cwd <dir>]');
  process.exit(2);
}

const psWindowListRaw =
  "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} " +
  '| ForEach-Object {\\"$($_.Id)|$($_.ProcessName)|$($_.MainWindowTitle)\\"}';
/**
 * Single-string with shell:true — DEP0190-safe (no args+shell combination,
 * exactly the spawn shape cycle 1 hardwired for governed engines).
 */
const psWindowList = `powershell -NoProfile -Command "${psWindowListRaw}"`;

async function snapshotVisibleWindows() {
  const snap = spawn(psWindowList, {
    shell: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  });
  let buf = '';
  snap.stdout.on('data', (c) => (buf += c.toString()));
  await new Promise((resolve) => snap.on('close', resolve));
  const pids = new Set();
  for (const line of buf.split(/\r?\n/)) {
    const pid = Number(line.split('|')[0]);
    if (pid) pids.add(pid);
  }
  return pids;
}

const before = await snapshotVisibleWindows();

const child = spawn(command, {
  cwd,
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
child.stdout.resume();
let stderr = '';
child.stderr.on('data', (c) => (stderr = (stderr + c).slice(-4000)));

const sampler = spawn(
  `powershell -NoProfile -Command "while ($true) { ${psWindowListRaw} ; Start-Sleep -Milliseconds 50 }"`,
  { shell: true, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
);
const seen = new Map();
{
  let buf = '';
  sampler.stdout.on('data', (c) => {
    buf += c.toString();
    for (;;) {
      const idx = buf.indexOf('\n');
      if (idx < 0) break;
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      const parts = line.split('|');
      const pid = Number(parts[0]);
      if (parts.length >= 3 && pid) seen.set(pid, `${parts[1]}: ${parts.slice(2).join('|')}`);
    }
  });
}

child.on('close', (code) => {
  sampler.kill();
  setTimeout(() => {
    const fresh = [...seen.entries()].filter(([pid]) => !before.has(pid));
    console.log(`command: ${command}`);
    console.log(
      `exit: ${code}${code !== 0 && stderr.trim() ? `\nstderr (tail): ${stderr.trim()}` : ''}`,
    );
    console.log(`visible windows DURING run: ${fresh.length}`);
    for (const [pid, name] of fresh.slice(0, 20)) console.log(`  pid ${pid} ${name}`);
    process.exit(fresh.length === 0 ? 0 : 1);
  }, 300);
});
