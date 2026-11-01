import { readFileSync } from 'node:fs';

/**
 * The version this package was published as, reported to MCP clients in
 * `serverInfo.version`.
 *
 * Read from `package.json` instead of a literal: a hardcoded value silently
 * drifted (`serverInfo.version` reported 2.0.0 while the registry served
 * 2.2.1), so a host could not tell which engine it was talking to.
 */
export const SERVER_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
    version: string;
  }
).version;
