import { z } from 'zod';
import { join } from 'node:path';
import { vmDir } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { withinWindow } from '../shared/time-windows.ts';

const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const timeWindowSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .refine((days) => new Set(days).size === days.length, '星期不能重复'),
    start: clock,
    end: clock,
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, '需要有效的 IANA 时区'),
  })
  .strict();
export const maintenanceSchema = z
  .object({
    enabled: z.boolean(),
    windows: z.array(timeWindowSchema).max(32),
  })
  .strict();
const policyFile = (id: string) => join(vmDir(id), 'automation-policy.json');
export async function maintenancePolicy(id: string) {
  return maintenanceSchema.parse(await readStore(policyFile(id), () => ({ enabled: false, windows: [] })));
}
export async function saveMaintenancePolicy(id: string, input: unknown) {
  const policy = maintenanceSchema.parse(input);
  await writeStore(policyFile(id), policy);
  return policy;
}
export async function inMaintenance(id: string, now: Date | number = Date.now()) {
  const policy = await maintenancePolicy(id);
  return policy.enabled && policy.windows.some((window) => withinWindow(window, now));
}
