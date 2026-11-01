import { readFileSync } from 'node:fs';

/**
 * The version this package was published as.
 *
 * Read from `package.json` instead of a literal: a hardcoded value silently
 * drifted (`--version` printed 2.0.0 while the registry served 2.2.1), which
 * makes bug reports and `npm ls` disagree about what is installed.
 */
export const CLI_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
    version: string;
  }
).version;
