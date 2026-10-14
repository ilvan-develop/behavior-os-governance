/**
 * Governed code editing.
 *
 * This is the only module in Behavior-OS that writes to source files, and it is
 * built so that a mistaken proposal cannot do damage:
 *
 * - **Dry-run by default** — {@link CodeEditEngine.preview} computes the change
 *   and hashes without touching the file. `apply` is a separate, explicit step.
 * - **Confined to a workspace root** (default `process.cwd()`): the file must
 *   resolve *and* realpath inside the root, so `../` traversal and symlink
 *   escapes are refused.
 * - **Extension allowlist**: only known text source extensions can be edited, so
 *   a lockfile, an image or a private key can never be rewritten.
 * - **Exact match required**: the searched text must occur exactly once, so an
 *   ambiguous edit fails instead of editing the wrong place.
 * - **Optimistic locking**: the caller can pass the `beforeHash` it previewed;
 *   a file that changed in the meantime is refused instead of overwritten.
 * - **Atomic write**: content goes to a temp file in the same directory and is
 *   then `rename`d over the target, so a crash cannot leave a half-written file.
 *
 * The engine is pure I/O + hashing: the governance locks (opt-in flag, explicit
 * `apply: true`, optional vote/quorum) live in `BehaviorOS.applyCodeEdit`.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Extensions a governed edit may touch. Everything else is refused. */
export const DEFAULT_EDITABLE_EXTENSIONS: readonly string[] = [
  '.c',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.md',
  '.mjs',
  '.php',
  '.prisma',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
];

/** Default cap on the size of a file a governed edit may rewrite (1 MiB). */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export interface CodeEditEngineConfig {
  /** Workspace root. Every edit must resolve inside it. Defaults to `process.cwd()`. */
  root?: string;
  /** Overrides {@link DEFAULT_EDITABLE_EXTENSIONS}. */
  extensions?: readonly string[];
  /** Overrides {@link DEFAULT_MAX_FILE_BYTES}. */
  maxFileBytes?: number;
}

export interface CodeEditRequest {
  /** Path of the file to edit, absolute or relative to the root. */
  file: string;
  /** Exact text to find. It must occur exactly once. */
  find: string;
  /** Replacement text. */
  replace: string;
}

export interface CodeEditPreview {
  /** Path relative to the root, with `/` separators (portable in records). */
  file: string;
  absolutePath: string;
  /** `sha256:<hex>` of the file before the edit. */
  beforeHash: string;
  /** `sha256:<hex>` of the content after the edit. */
  afterHash: string;
  bytesBefore: number;
  bytesAfter: number;
  addedLines: number;
  removedLines: number;
  /** Occurrences of `find`. Exactly 1 is required for `apply`. */
  occurrences: number;
  /** Single-hunk unified diff of the change. */
  diff: string;
}

/** Thrown when an edit is refused by a guard rail. */
export class CodeEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeEditError';
  }
}

export interface CodeEditApplyOptions {
  /**
   * Hash returned by a previous {@link CodeEditEngine.preview}. When set, the
   * edit is refused if the file changed in the meantime.
   */
  expectedBeforeHash?: string;
}

export class CodeEditEngine {
  private readonly root: string;
  private readonly extensions: readonly string[];
  private readonly maxFileBytes: number;

  constructor(config: CodeEditEngineConfig = {}) {
    const requested = resolve(config.root ?? process.cwd());
    this.root = existsSync(requested) ? realpathSync(requested) : requested;
    this.extensions = config.extensions ?? DEFAULT_EDITABLE_EXTENSIONS;
    this.maxFileBytes = config.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Workspace root, resolved and symlink-free. */
  getRoot(): string {
    return this.root;
  }

  private hash(content: string): string {
    return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
  }

  /**
   * Resolve a request to a safe absolute path.
   *
   * Refuses: paths escaping the root, non-files, oversized files and
   * extensions outside the allowlist. Symlinks are resolved first, so a link
   * pointing outside the root is refused too.
   */
  private resolveTarget(file: string): string {
    if (!file?.trim()) throw new CodeEditError('no file given');
    const candidate = isAbsolute(file) ? resolve(file) : resolve(this.root, file);
    const relativePath = relative(this.root, candidate);
    if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new CodeEditError(`refusing to edit outside the workspace root: ${file}`);
    }
    if (!existsSync(candidate)) throw new CodeEditError(`file not found: ${relativePath}`);
    const real = realpathSync(candidate);
    const realRelative = relative(this.root, real);
    if (realRelative.startsWith('..') || isAbsolute(realRelative)) {
      throw new CodeEditError(`refusing to follow a symlink outside the root: ${file}`);
    }
    const stats = statSync(real);
    if (!stats.isFile()) throw new CodeEditError(`not a file: ${relativePath}`);
    const extension = extname(real).toLowerCase();
    if (!this.extensions.includes(extension)) {
      throw new CodeEditError(
        `extension "${extension || '(none)'}" is not editable (allowed: ${this.extensions.join(', ')})`,
      );
    }
    if (stats.size > this.maxFileBytes) {
      throw new CodeEditError(
        `file is ${stats.size} bytes, above the ${this.maxFileBytes}-byte limit`,
      );
    }
    return real;
  }

  /** Portable, root-relative path for records. */
  private relativePath(absolutePath: string): string {
    return relative(this.root, absolutePath).split(sep).join('/');
  }

  /**
   * Validate a request and compute the resulting content, hashes and diff
   * **without touching the file**. Throws {@link CodeEditError} when refused.
   */
  preview(request: CodeEditRequest): CodeEditPreview {
    const absolutePath = this.resolveTarget(request.file);
    if (!request.find) throw new CodeEditError('`find` must be a non-empty string');
    if (request.find === request.replace) {
      throw new CodeEditError('`find` and `replace` are identical — nothing to change');
    }

    const before = readFileSync(absolutePath, 'utf8');
    const occurrences = before.split(request.find).length - 1;
    if (occurrences === 0) throw new CodeEditError('`find` does not occur in the file');
    if (occurrences > 1) {
      throw new CodeEditError(`\`find\` occurs ${occurrences} times — it must be unique`);
    }

    const index = before.indexOf(request.find);
    const after = `${before.slice(0, index)}${request.replace}${before.slice(index + request.find.length)}`;
    const startLine = before.slice(0, index).split('\n').length;
    const removedLines = request.find.split('\n').length;
    const addedLines = request.replace.split('\n').length;
    const diff = [
      `@@ -${startLine},${removedLines} +${startLine},${addedLines} @@`,
      ...request.find.split('\n').map((line) => `-${line}`),
      ...request.replace.split('\n').map((line) => `+${line}`),
    ].join('\n');

    return {
      file: this.relativePath(absolutePath),
      absolutePath,
      beforeHash: this.hash(before),
      afterHash: this.hash(after),
      bytesBefore: Buffer.byteLength(before, 'utf8'),
      bytesAfter: Buffer.byteLength(after, 'utf8'),
      addedLines,
      removedLines,
      occurrences,
      diff,
    };
  }

  /**
   * Write the edit atomically. Callers must have already passed the governance
   * locks; this method only enforces the I/O-level guards (path, uniqueness,
   * optimistic hash) and never partially writes.
   */
  apply(request: CodeEditRequest, options: CodeEditApplyOptions = {}): CodeEditPreview {
    const preview = this.preview(request);
    if (options.expectedBeforeHash && options.expectedBeforeHash !== preview.beforeHash) {
      throw new CodeEditError(
        `stale edit: file is now ${preview.beforeHash} (expected ${options.expectedBeforeHash})`,
      );
    }

    const before = readFileSync(preview.absolutePath, 'utf8');
    const index = before.indexOf(request.find);
    const after = `${before.slice(0, index)}${request.replace}${before.slice(index + request.find.length)}`;
    const temporaryPath = `${preview.absolutePath}.bos-edit-${process.pid}-${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, after, 'utf8');
      renameSync(temporaryPath, preview.absolutePath);
    } catch (error) {
      if (existsSync(temporaryPath)) {
        try {
          unlinkSync(temporaryPath);
        } catch {
          // Leaving a stray temp file is preferable to masking the real error.
        }
      }
      throw error instanceof CodeEditError
        ? error
        : new CodeEditError(
            `failed to write ${preview.file}: ${error instanceof Error ? error.message : String(error)}`,
          );
    }
    return preview;
  }
}
