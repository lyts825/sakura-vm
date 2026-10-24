/** 插件包页面的有界请求与会话取消。 */
import { useEffect, useRef } from 'react';
import type { Request } from './feature-shared';
import type { z } from 'zod';
export type ClientMethods = Readonly<
  Record<string, Readonly<Record<string, { request: z.ZodType; response: z.ZodType }>>>
>;
export function useSuiteClient(request: Request, prefix: string, schemas: ClientMethods) {
  const controller = useRef(new AbortController());
  useEffect(() => {
    if (controller.current.signal.aborted) controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  return async <T>(domain: string, method: string, input: unknown = {}): Promise<T> => {
    const contract = schemas[domain]?.[method];
    if (!contract) throw new Error('操作未登记');
    const signal = controller.current.signal;
    signal.throwIfAborted();
    const value = await request(
      `/${prefix}-${domain}/${method.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}`,
      'POST',
      contract.request.parse(input),
      signal,
    );
    signal.throwIfAborted();
    return contract.response.parse(value) as T;
  };
}
export const suiteReference = (row: { domain: string; id: string; revision: string }) => ({
  domain: row.domain,
  id: row.id,
  revision: row.revision,
});
export const suiteReferenceKey = (row: { id: string; revision: string }) => row.id + ':' + row.revision;
export function suiteBase64(bytes: Uint8Array) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 16384)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(text);
}
export function suiteUnbase64(text: string) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export async function suiteDigest(bytes: Uint8Array) {
  const data = new Uint8Array(bytes).buffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
export function suiteDownload(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
