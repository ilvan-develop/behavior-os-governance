import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DNASchema } from '@behavior-os/schemas';
import { load as yamlLoad } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dnasDir = resolve(repoRoot, 'dnas');
const files = readdirSync(dnasDir)
  .filter((file) => file.endsWith('.yaml'))
  .sort();

/**
 * Guards the "21 DNA patterns" claim and the `behavioros compile`/`validate`
 * commands: both load every file in `dnas/` through `DNALoader` (which uses
 * `DNASchema`), so a malformed pattern would break them at runtime.
 */
describe('shipped DNA patterns', () => {
  it(`lists ${files.length} patterns`, () => {
    expect(files.length).toBe(21);
  });

  for (const file of files) {
    it(`${file} satisfies DNASchema`, () => {
      const document = yamlLoad(readFileSync(resolve(dnasDir, file), 'utf8'));
      const result = DNASchema.safeParse(document);
      const issues = result.success
        ? ''
        : result.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join(' | ');
      expect(result.success, `${file}: ${issues}`).toBe(true);
    });
  }
});
