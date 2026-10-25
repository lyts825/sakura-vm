/**
 * 模块职责：执行固定的文件预览与供应审查计算，将有界解析移出主服务线程。
 * Module purpose: Runs fixed file-preview and supply-audit operations in bounded worker threads.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { previewFile } from './file-preview.ts';
import { AppError } from '../shared/errors.ts';
import {
  parseSupplyInventory,
  matchSupplyAdvisories,
  classifySupplyLicenses,
  importSupplyDataset,
} from './suite-supply-analysis.ts';
import { z } from 'zod';
import { parseLocaleCatalog, evaluateLocale, renderLocale } from './suite-locale-analysis.ts';
import * as L from '../shared/contracts/locale-studio.ts';
import { suiteRef } from '../shared/contracts/suite-common.ts';
import { assembleIncidentTimeline, incidentTimelineInput } from './suite-incident-analysis.ts';

try {
  if (workerData?.task === 'incident-desk') {
    z.literal('timeline').parse(workerData.operation);
    const result = assembleIncidentTimeline(incidentTimelineInput.parse(workerData.input));
    parentPort!.postMessage({ ok: true, result });
  } else if (workerData?.task === 'localization-studio') {
    const operation = z.enum(['catalog', 'checks', 'preview']).parse(workerData.operation);
    let result: unknown;
    if (operation === 'catalog')
      result = parseLocaleCatalog(
        z
          .object({
            text: z.string().max(32 * 1024 ** 2),
            language: L.localeLanguage,
            role: z.enum(['source', 'target']),
            source: suiteRef,
            originalDigest: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            originalBytes: z
              .number()
              .int()
              .min(0)
              .max(32 * 1024 ** 2)
              .optional(),
          })
          .strict()
          .parse(workerData.input),
      );
    else if (operation === 'checks')
      result = evaluateLocale(
        z
          .object({
            catalog: L.localeCatalog,
            translation: L.localeTranslation,
            terminology: L.localeTerminology,
            contexts: L.localeContexts.nullable(),
            references: z.object({ catalog: suiteRef, translation: suiteRef }).strict(),
          })
          .strict()
          .parse(workerData.input),
      );
    else
      result = renderLocale(
        z
          .object({
            preview: L.localePreviewInput,
            check: L.localeCheck,
            catalog: L.localeCatalog,
            translation: L.localeTranslation,
          })
          .strict()
          .parse(workerData.input),
      );
    parentPort!.postMessage({ ok: true, result });
  } else if (workerData?.task === 'supply-audit') {
    const operation = z.enum(['inventory', 'dataset', 'advisories', 'licenses']).parse(workerData.operation);
    let result: unknown;
    if (operation === 'inventory')
      result = parseSupplyInventory(
        z
          .object({ text: z.string().max(32 * 1024 ** 2), format: z.string() })
          .strict()
          .parse(workerData.input),
      );
    else if (operation === 'dataset')
      result = importSupplyDataset(
        z
          .object({ text: z.string().max(64 * 1024 ** 2), format: z.string() })
          .strict()
          .parse(workerData.input).text,
      );
    else if (operation === 'advisories')
      result = matchSupplyAdvisories(
        z.object({ inventory: z.unknown(), dataset: z.unknown() }).strict().parse(workerData.input),
      );
    else result = classifySupplyLicenses(workerData.input);
    parentPort!.postMessage({ ok: true, result });
  } else {
    if (
      workerData?.task !== 'file-preview' ||
      typeof workerData.path !== 'string' ||
      !(workerData.data instanceof Uint8Array) ||
      workerData.data.byteLength > 16 * 1024 ** 2 ||
      !Number.isSafeInteger(workerData.size) ||
      workerData.size < workerData.data.byteLength
    )
      throw new AppError('计算输入无效', 400, 'COMPUTE_INPUT');
    const data = Buffer.from(workerData.data.buffer, workerData.data.byteOffset, workerData.data.byteLength);
    parentPort!.postMessage({ ok: true, result: previewFile(workerData.path, data, workerData.size) });
  }
} catch (error) {
  parentPort!.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof AppError ? { status: error.status, code: error.code } : {}),
    ...(error instanceof z.ZodError ? { status: 400, code: 'COMPUTE_INPUT' } : {}),
  });
}
