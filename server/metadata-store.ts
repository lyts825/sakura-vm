import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { atomicMetadataWrite } from './metadata-io.ts';
import { serializedMetadata, flushMetadataFile } from './metadata-queue.ts';
export { metadataKey, flushMetadata } from './metadata-queue.ts';

export type MetadataRevision = string;
export type MetadataSnapshot<T> = { value: T; revision: MetadataRevision };
export type MetadataWriteOptions = {
  expectedRevision?: MetadataRevision;
  signal?: AbortSignal;
  beforeCommit?: () => void | Promise<void>;
};
const revision = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

function capture<T>(value: T): T {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError('Metadata must be JSON serializable');
  return JSON.parse(text) as T;
}

/** Existing JSON files remain unchanged: revisions identify their exact bytes,
 * so stale revisions are detected after restart without adding a sidecar/envelope.
 * Revisions are content hashes, not monotonic counters. Domain recovery records
 * remain authoritative for external effects and multi-file transactions. */
export class MetadataStore<T> {
  readonly file: string;
  constructor(
    file: string,
    private options: { fallback: () => T; parse?: (value: unknown) => T },
  ) {
    this.file = resolve(file);
  }
  private parse(value: unknown): T {
    return this.options.parse ? this.options.parse(value) : (value as T);
  }
  private async load(): Promise<MetadataSnapshot<T>> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { value: this.parse(capture(this.options.fallback())), revision: 'missing' };
    }
    return { value: this.parse(JSON.parse(text)), revision: revision(text) };
  }
  private check(current: MetadataRevision, options: MetadataWriteOptions) {
    options.signal?.throwIfAborted();
    if (options.expectedRevision !== undefined && options.expectedRevision !== current)
      throw new AppError('元数据已改变，请重新读取后重试', 409, 'METADATA_REVISION_CONFLICT');
  }
  read(signal?: AbortSignal): Promise<MetadataSnapshot<T>> {
    return serializedMetadata(this.file, false, async () => {
      signal?.throwIfAborted();
      return this.load();
    });
  }
  replace(value: T, options: MetadataWriteOptions = {}): Promise<MetadataSnapshot<T>> {
    // Capture immediately, not when an earlier queued write finishes.
    const snapshot = capture(value);
    return serializedMetadata(this.file, true, async (mark) => {
      options.signal?.throwIfAborted();
      if (options.expectedRevision !== undefined) this.check((await this.load()).revision, options);
      const next = this.parse(snapshot);
      const text = JSON.stringify(next, null, 2);
      options.signal?.throwIfAborted();
      await atomicMetadataWrite(
        this.file,
        text,
        async () => {
          options.signal?.throwIfAborted();
          await options.beforeCommit?.();
        },
        mark,
        options.signal,
      );
      return { value: next, revision: revision(text) };
    });
  }
  update<R>(
    edit: (value: T) => R | Promise<R>,
    options: MetadataWriteOptions = {},
  ): Promise<MetadataSnapshot<T> & { result: R }> {
    return serializedMetadata(this.file, true, async (mark) => {
      options.signal?.throwIfAborted();
      const current = await this.load();
      this.check(current.revision, options);
      const result = await edit(current.value);
      const next = this.parse(capture(current.value));
      options.signal?.throwIfAborted();
      await atomicMetadataWrite(
        this.file,
        JSON.stringify(next, null, 2),
        async () => {
          options.signal?.throwIfAborted();
          await options.beforeCommit?.();
        },
        mark,
        options.signal,
      );
      return { value: next, revision: revision(JSON.stringify(next, null, 2)), result };
    });
  }
  remove(options: MetadataWriteOptions = {}) {
    return serializedMetadata(this.file, true, async (mark) => {
      options.signal?.throwIfAborted();
      if (options.expectedRevision !== undefined) this.check((await this.load()).revision, options);
      options.signal?.throwIfAborted();
      mark();
      await rm(this.file, { force: true });
    });
  }
  /** Wait for already admitted work; report the last uncorrected write failure. */
  async flush() {
    await flushMetadataFile(this.file);
  }
}

export function metadataFile<T>(file: string, fallback: () => T, parse?: (value: unknown) => T) {
  return new MetadataStore(file, { fallback, parse });
}

/** Compatibility adapter for callers whose domain lock already captures a full snapshot. */
export async function replaceMetadata<T>(file: string, value: T, options?: MetadataWriteOptions) {
  return metadataFile(file, () => value).replace(value, options);
}
