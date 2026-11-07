import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Opt-in marker for a governed project.
 *
 * A globally installed OpenCode plugin must not govern every project on the
 * machine. `setup()` therefore checks this marker before it creates an engine
 * or registers any hook; without it the plugin stays dormant and only exposes
 * the `/bos-init` command. `behavioros init` writes `.behavioros/state.json`,
 * which is accepted as a legacy marker for projects scaffolded by the CLI.
 */
export const GOVERNANCE_CONFIG_RELATIVE = path.join('.behavioros', 'config.json');
export const LEGACY_STATE_RELATIVE = path.join('.behavioros', 'state.json');
export const DNAS_DIRECTORY = 'dnas';

export interface GovernanceConfig {
  governance?: { enabled?: boolean };
  [key: string]: unknown;
}

/** Read and parse `.behavioros/config.json`; `null` when absent or malformed. */
export function readGovernanceConfig(projectDirectory: string): GovernanceConfig | null {
  const file = path.join(projectDirectory, GOVERNANCE_CONFIG_RELATIVE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as GovernanceConfig;
  } catch {
    return null;
  }
}

/**
 * Resolve whether governance is enabled for a project.
 *
 * Order: explicit environment overrides, the project marker, then the legacy
 * `behavioros init` state file. A malformed config is treated as "not opted
 * in" instead of silently enabling governance.
 */
export function isGovernanceEnabled(
  projectDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.BEHAVIOROS_DISABLED === 'true') return false;
  if (env.BEHAVIOROS_FORCE_ENABLED === 'true') return true;

  const config = readGovernanceConfig(projectDirectory);
  if (config) return config.governance?.enabled === true;

  return existsSync(path.join(projectDirectory, LEGACY_STATE_RELATIVE));
}

export interface OptInResult {
  configPath: string;
  dnasDirectory: string;
  copied: string[];
  skipped: string[];
}

/**
 * Write the opt-in marker and copy the bundled DNA patterns into the project.
 * Existing DNA files are never overwritten, so re-running `/bos-init` is safe.
 */
export function enableGovernance(
  projectDirectory: string,
  sourceDirectory: string | null = resolveDnaSourceDirectory(projectDirectory),
): OptInResult {
  const behaviorosDirectory = path.join(projectDirectory, '.behavioros');
  mkdirSync(behaviorosDirectory, { recursive: true });

  const configPath = path.join(projectDirectory, GOVERNANCE_CONFIG_RELATIVE);
  const existing = readGovernanceConfig(projectDirectory) ?? {};
  const next: GovernanceConfig = {
    ...existing,
    governance: { ...(existing.governance ?? {}), enabled: true },
  };
  writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);

  const dnasDirectory = path.join(projectDirectory, DNAS_DIRECTORY);
  mkdirSync(dnasDirectory, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];
  if (sourceDirectory && existsSync(sourceDirectory)) {
    const patterns = readdirSync(sourceDirectory)
      .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
      .sort();
    for (const file of patterns) {
      const destination = path.join(dnasDirectory, file);
      if (existsSync(destination)) {
        skipped.push(file);
        continue;
      }
      copyFileSync(path.join(sourceDirectory, file), destination);
      copied.push(file);
    }
  }

  return { configPath, dnasDirectory, copied, skipped };
}

/**
 * Find the DNA pattern source shipped with the plugin.
 *
 * Priority: explicit environment override, `dist/dnas` next to the compiled
 * entry (published package), then the repository `dnas/` directory (local
 * development and tests).
 */
export function resolveDnaSourceDirectory(projectDirectory: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.BEHAVIOROS_DNAS_DIR,
    path.join(here, 'dnas'),
    path.resolve(here, '..', '..', '..', 'dnas'),
    path.join(projectDirectory, DNAS_DIRECTORY),
  ].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  );

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      if (readdirSync(candidate).some((entry) => entry.endsWith('.yaml'))) return candidate;
    } catch {
      // Try the next candidate rather than failing the opt-in.
    }
  }
  return null;
}
