import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
import { HostRuntime } from '../server/host-runtime/index.ts';
import { StorageRuntime, type StorageLease } from '../server/storage-runtime.ts';
import { OBJECT_PART_BYTES, OBJECT_UPLOAD_BUFFERS, uploadObjectFile } from '../server/object-upload.ts';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function fixture(bytes = OBJECT_PART_BYTES + 1) {
  const root = await mkdtemp(join(tmpdir(), 'sakura-multipart-budget-')),
    file = join(root, 'backup');
  await writeFile(file, Buffer.alloc(bytes));
  const host = new HostRuntime(),
    storage = new StorageRuntime(host),
    abort = new AbortController();
  let lease!: StorageLease;
  return {
    root,
    file,
    host,
    abort,
    upload: (client: S3Client) =>
      storage.run(
        {
          owner: 'test:multipart',
          taskId: 'upload',
          label: 'Upload',
          mode: 'read',
          paths: [file],
          buffers: OBJECT_UPLOAD_BUFFERS,
          files: 1,
          signal: abort.signal,
        },
        (owned) => {
          lease = owned;
          return uploadObjectFile(client, 'bucket', 'backup/new/data', file, bytes, abort.signal, owned);
        },
      ),
    async close() {
      lease?.release();
      host.close();
      assert.equal(dirname(root), resolve(tmpdir()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('multipart cancellation waits for both part transports and the remote abort receipt before releasing buffers', async () => {
  const f = await fixture(),
    entered = deferred(),
    settle = deferred(),
    abortEntered = deferred(),
    confirm = deferred();
  let workers = 0,
    remoteAborted = false,
    finished = false;
  const client = {
    send: async (command: object, options?: { abortSignal?: AbortSignal }) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'allocated' };
        case 'UploadPartCommand':
          if (++workers === 2) entered.resolve();
          await settle.promise;
          options!.abortSignal!.throwIfAborted();
          return { ETag: 'part' };
        case 'AbortMultipartUploadCommand':
          assert.equal(workers, 2);
          abortEntered.resolve();
          await confirm.promise;
          remoteAborted = true;
          return {};
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  const result = f.upload(client).finally(() => {
    finished = true;
  });
  const rejection = assert.rejects(result, { name: 'AbortError' });
  try {
    await entered.promise;
    f.abort.abort();
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(finished, false);
    assert.equal(f.host.snapshot().resources[0].cost['io.buffers'], OBJECT_UPLOAD_BUFFERS);
    settle.resolve();
    await abortEntered.promise;
    assert.equal(finished, false, 'An outstanding remote cleanup receipt still owns the file/buffer budget');
    confirm.resolve();
    await rejection;
    assert.equal(remoteAborted, true);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    settle.resolve();
    confirm.resolve();
    await f.close();
  }
});

test('a missing remote multipart cleanup receipt remains charged after cancellation', async () => {
  const f = await fixture(1);
  const client = {
    send: async (command: object) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'allocated' };
        case 'UploadPartCommand':
          f.abort.abort();
          throw f.abort.signal.reason;
        case 'AbortMultipartUploadCommand':
          throw new Error('remote cleanup unavailable');
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  try {
    await assert.rejects(f.upload(client), { code: 'STORAGE_CLEANUP_PENDING' });
    assert.equal(f.host.snapshot().resources[0].state, 'cleanup-pending');
    assert.equal(f.host.snapshot().resources[0].cost['io.buffers'], OBJECT_UPLOAD_BUFFERS);
  } finally {
    await f.close();
  }
});

test('lost multipart completion response reconciles both the upload and an already committed object', async () => {
  const f = await fixture(1),
    calls: string[] = [];
  const client = {
    send: async (command: object) => {
      calls.push(command.constructor.name);
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          return { UploadId: 'allocated' };
        case 'UploadPartCommand':
          return { ETag: 'part' };
        case 'CompleteMultipartUploadCommand':
          throw new Error('lost completion response');
        case 'AbortMultipartUploadCommand':
          throw Object.assign(new Error('gone'), { name: 'NoSuchUpload' });
        case 'DeleteObjectCommand':
          return {};
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  try {
    await assert.rejects(f.upload(client), /lost completion response/);
    assert.deepEqual(calls.slice(-2), ['AbortMultipartUploadCommand', 'DeleteObjectCommand']);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    await f.close();
  }
});

test('lost multipart allocation response checks only the exact unpublished key before releasing admission', async () => {
  const f = await fixture(1),
    aborted: string[] = [];
  const client = {
    send: async (command: { input: { Key?: string; UploadId?: string } }) => {
      switch (command.constructor.name) {
        case 'CreateMultipartUploadCommand':
          throw new Error('lost allocation response');
        case 'ListMultipartUploadsCommand':
          return {
            Uploads: [
              { Key: 'backup/new/data', UploadId: 'orphan' },
              { Key: 'backup/new/data-other', UploadId: 'unrelated' },
            ],
          };
        case 'AbortMultipartUploadCommand':
          aborted.push(command.input.UploadId!);
          return {};
        default:
          throw new Error('Unexpected ' + command.constructor.name);
      }
    },
  } as unknown as S3Client;
  try {
    await assert.rejects(f.upload(client), /lost allocation response/);
    assert.deepEqual(aborted, ['orphan']);
    assert.equal(f.host.snapshot().resources.length, 0);
  } finally {
    await f.close();
  }
});
