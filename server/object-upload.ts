/**
 * 模块职责：以受限分块缓冲上传对象文件，核对文件长度并处理 multipart 上传回执。
 */
import { open } from 'node:fs/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  DeleteObjectCommand,
  ListMultipartUploadsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { AppError } from '../shared/errors.ts';
import { withoutOperationContext } from './operation-context.ts';
import type { StorageLease } from './storage-runtime.ts';

export const OBJECT_PART_BYTES = 8 * 1024 ** 2;
export const OBJECT_UPLOAD_BUFFERS = 2 * OBJECT_PART_BYTES + 1024 ** 2;

/** Both workers settle before aborting the remote multipart and releasing buffers.
 * Unlike an abort-raced SDK promise, returning here confirms transport settlement. */
export async function uploadObjectFile(
  client: S3Client,
  bucket: string,
  key: string,
  file: string,
  bytes: number,
  signal: AbortSignal,
  lease: StorageLease,
) {
  lease.assertActive();
  signal.throwIfAborted();
  const handle = await open(file, 'r');
  const stop = new AbortController(),
    active = AbortSignal.any([signal, stop.signal]);
  let uploadId: string | undefined,
    completed = false,
    createAttempted = false,
    completeAttempted = false;
  try {
    if ((await handle.stat()).size !== bytes) throw new AppError('上传前备份长度已变化', 409);
    createAttempted = true;
    const created = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: 'application/octet-stream' }),
      { abortSignal: active },
    );
    uploadId = created.UploadId;
    if (!uploadId) throw new AppError('对象存储未返回 multipart 标识', 502);
    let offset = 0,
      number = 0;
    const parts: { ETag: string; PartNumber: number }[] = [];
    const worker = async () => {
      try {
        while (offset < bytes || (!bytes && number === 0)) {
          active.throwIfAborted();
          const start = offset,
            part = ++number,
            length = Math.min(OBJECT_PART_BYTES, bytes - offset);
          offset += length;
          const buffer = Buffer.alloc(length);
          let read = 0;
          while (read < length) {
            active.throwIfAborted();
            const result = await handle.read(buffer, read, length - read, start + read);
            if (!result.bytesRead) throw new AppError('上传过程中备份被截断', 409);
            read += result.bytesRead;
          }
          const uploaded = await client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: part,
              Body: buffer,
              ContentLength: length,
            }),
            { abortSignal: active },
          );
          if (!uploaded.ETag) throw new AppError('对象存储未返回分片回执', 502);
          parts.push({ ETag: uploaded.ETag, PartNumber: part });
        }
      } catch (error) {
        stop.abort(error);
        throw error;
      }
    };
    const results = await Promise.allSettled([worker(), worker()]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    active.throwIfAborted();
    if ((await handle.stat()).size !== bytes) throw new AppError('上传过程中备份长度已变化', 409);
    completeAttempted = true;
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber) },
      }),
      { abortSignal: active },
    );
    completed = true;
  } catch (error) {
    await withoutOperationContext(async () => {
      const cleanupSignal = AbortSignal.timeout(30_000);
      if (createAttempted && !uploadId) {
        // A lost create response may still have allocated an upload. Reconcile the
        // exact object key before declaring cancellation complete.
        try {
          let keyMarker: string | undefined, uploadMarker: string | undefined;
          for (let page = 0; ; page++) {
            const listed = await client.send(
              new ListMultipartUploadsCommand({
                Bucket: bucket,
                Prefix: key,
                KeyMarker: keyMarker,
                UploadIdMarker: uploadMarker,
              }),
              { abortSignal: cleanupSignal },
            );
            for (const item of listed.Uploads || [])
              if (item.Key === key && item.UploadId)
                await client.send(
                  new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: item.UploadId }),
                  { abortSignal: cleanupSignal },
                );
            if (!listed.IsTruncated) break;
            if (page >= 99 || !listed.NextKeyMarker || !listed.NextUploadIdMarker)
              throw new AppError('无法完整核对未确认的 multipart 创建', 503);
            keyMarker = listed.NextKeyMarker;
            uploadMarker = listed.NextUploadIdMarker;
          }
        } catch (cleanup) {
          lease.cleanupPending(cleanup);
          throw cleanup;
        }
      }
      if (uploadId && !completed) {
        try {
          await client.send(
            new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
            {
              abortSignal: cleanupSignal,
            },
          );
        } catch (cleanup) {
          if ((cleanup as Error).name !== 'NoSuchUpload') {
            lease.cleanupPending(cleanup);
            throw cleanup;
          }
        }
      }
      if (completeAttempted && !completed) {
        // NoSuchUpload after a lost complete response can mean the object was
        // committed. Remove that exact unpublished key as well as the multipart.
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
            abortSignal: cleanupSignal,
          });
        } catch (cleanup) {
          lease.cleanupPending(cleanup);
          throw cleanup;
        }
      }
    });
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      lease.cleanupPending(error);
      throw error;
    }
  }
}
