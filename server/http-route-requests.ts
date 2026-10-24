/**
 * 模块职责：汇集 HTTP 路由的线路输入模式，为请求契约选择提供明确的参数结构。
 * Module purpose: Collects route wire-input schemas, providing explicit parameter shapes for request contract selection.
 */
import { z } from 'zod';
import { deliveryHttpRequests } from '../shared/contracts/delivery-http.ts';
import { foundryHttpRequests } from '../shared/contracts/foundry-http.ts';
import { appRouteRequests } from '../shared/contracts/app-http.ts';
import { dataHttpRequests } from '../shared/contracts/data-http.ts';
import { knowledgeHttpRequests } from '../shared/contracts/knowledge-http.ts';
import { supplyHttpRequests } from '../shared/contracts/supply-http.ts';
import { resilienceHttpRequests } from '../shared/contracts/resilience-http-registry.ts';
import { integrationHttpRequests } from '../shared/contracts/integration-http-registry.ts';
import { cleanupPreviewRequest, cleanupExecuteRequest } from '../shared/contracts/cleanup-plan.ts';
import { MAX_TEXT_BYTES } from './files.ts';
import { singleAppInput, singleAppProgram, singleAppClipboard } from './single-app-windows.ts';
import {
  directoryMigrationPreviewSchema,
  directoryMigrationApplySchema,
} from './project-directory-migration.ts';
import { networkSchema, forwardsSchema } from './network-profiles.ts';
import { projectSchema } from './project-config.ts';
import { recipeSchema } from './recipes.ts';
import { recipeApplyPlanRequestSchema } from '../shared/contracts/recipe-plan.ts';
import { repairActionSchema } from '../shared/contracts/repair-session.ts';

/** HTTP route inputs are used by the handlers, admission and generated clients. */
export const httpRouteRequests = {
  ...deliveryHttpRequests,
  ...foundryHttpRequests,
  ...appRouteRequests,
  ...dataHttpRequests,
  ...knowledgeHttpRequests,
  ...supplyHttpRequests,
  ...resilienceHttpRequests,
  ...integrationHttpRequests,
  'backups.legacy.post.vms.vmId.backup-download': z.object({ backupId: z.uuid() }).strict(),
  'backups.legacy.post.vms.vmId.backups': z
    .object({
      action: z.enum(['run', 'verify', 'restore', 'delete']),
      backupId: z.string().uuid().optional(),
      name: z.string().optional(),
      password: z.string().max(1024).optional(),
    })
    .strict(),
  'code-checks.legacy.post.vms.vmId.debugger': z.discriminatedUnion('action', [
    z.object({ action: z.literal('install') }).strict(),
    z
      .object({
        action: z.literal('start'),
        path: z.string().max(4096),
        breakpoints: z.array(z.number().int().min(1).max(100000)).max(100),
        stopOnEntry: z.boolean().optional(),
        args: z.array(z.string().max(1024)).max(20).optional(),
      })
      .strict(),
    z.object({ action: z.literal('stop'), token: z.uuid() }).strict(),
    z
      .object({
        action: z.literal('breakpoints'),
        token: z.uuid(),
        lines: z.array(z.number().int().min(1).max(100000)).max(100),
      })
      .strict(),
    z
      .object({ action: z.literal('inspect'), token: z.uuid(), frameId: z.number().int().positive() })
      .strict(),
    z
      .object({ action: z.literal('expand'), token: z.uuid(), reference: z.number().int().positive() })
      .strict(),
    z
      .object({ action: z.enum(['continue', 'next', 'stepIn', 'stepOut', 'pause']), token: z.uuid() })
      .strict(),
  ]),
  'code-checks.legacy.post.vms.vmId.language-service': z.discriminatedUnion('action', [
    z.object({ action: z.literal('install') }).strict(),
    z.object({ action: z.literal('apply'), token: z.uuid(), lockToken: z.uuid().optional() }).strict(),
    z.object({ action: z.literal('stop'), token: z.uuid() }).strict(),
    z
      .object({
        action: z.enum(['completion', 'definition', 'diagnostics', 'rename']),
        path: z.string().max(4096),
        content: z.string().max(MAX_TEXT_BYTES),
        position: z
          .object({ line: z.number().int().nonnegative(), character: z.number().int().nonnegative() })
          .strict()
          .optional(),
        newName: z.string().max(128).optional(),
        version: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
  ]),
  'desktop.legacy.post.vms.vmId.desktop': z
    .object({
      action: z.enum(['install', 'start', 'configure', 'stop']),
      preferences: z
        .object({
          sessionType: z.enum(['auto', 'x11', 'wayland']).optional(),
          resolution: z.enum(['1280x800', '1440x900', '1600x1000', '1920x1080']).optional(),
          monitorLayout: z.enum(['single', 'dual-horizontal', 'dual-vertical']).optional(),
          scale: z.number().int().min(100).max(200).optional(),
          theme: z.enum(['sakura', 'midnight', 'paper', 'lavender']).optional(),
          wallpaper: z.enum(['sakura', 'midnight', 'paper', 'plain']).optional(),
          accent: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
          panel: z.enum(['bottom', 'top', 'floating']).optional(),
          autoHidePanel: z.boolean().optional(),
          animations: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  'desktop.legacy.post.vms.vmId.single-app': z.discriminatedUnion('action', [
    singleAppInput.safeExtend({ action: z.literal('start') }),
    z.object({ action: z.literal('stop'), id: z.uuid() }).strict(),
    z
      .object({
        action: z.literal('clipboard-save'),
        program: singleAppProgram,
        clipboard: singleAppClipboard,
      })
      .strict(),
    z.object({ action: z.literal('clipboard-remove'), program: singleAppProgram }).strict(),
  ]),
  'files.legacy.post.vms.vmId.file-lock': z
    .object({
      action: z.enum(['acquire', 'renew', 'release']),
      token: z.uuid().optional(),
    })
    .strict(),
  'files.legacy.put.vms.vmId.file': z
    .object({
      path: z.string(),
      content: z.string().max(MAX_TEXT_BYTES),
      overwrite: z.boolean().default(true),
      expectedVersion: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      lockToken: z.uuid().optional(),
    })
    .strict(),
  'files.legacy.post.vms.vmId.history': z
    .object({
      action: z.enum(['restore', 'purge']),
      id: z.uuid(),
      expectedVersion: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      lockToken: z.uuid().optional(),
    })
    .strict(),
  'files.legacy.post.vms.vmId.file-operation': z
    .object({
      action: z.enum(['mkdir', 'rename', 'delete']),
      path: z.string(),
      destination: z.string().optional(),
      recursive: z.boolean().default(false),
      lockToken: z.uuid().optional(),
    })
    .strict(),
  'ide.legacy.post.vms.vmId.ide': z
    .object({ action: z.enum(['install', 'stop']).default('install') })
    .strict(),
  'library.legacy.post.vms.batch': z
    .object({ ids: z.array(z.string().uuid()).min(1).max(32), action: z.enum(['start', 'stop']) })
    .strict(),
  'maintenance.cleanup.preview': cleanupPreviewRequest,
  'maintenance.cleanup.execute': cleanupExecuteRequest,
  'maintenance.legacy.post.vms.vmId.disk-maintenance': z
    .object({ mode: z.enum(['trim', 'compact']) })
    .strict(),
  'maintenance.legacy.post.vms.vmId.resize': z
    .object({ diskGiB: z.number().int().min(2).max(128).optional(), finish: z.boolean().optional() })
    .strict(),
  'migration.legacy.post.migration': z
    .object({
      action: z.enum(['preview', 'start', 'cancel-activation']),
      target: z.string().max(4096).optional(),
      token: z.string().optional(),
    })
    .strict(),
  'network.legacy.delete.network-profiles': z.object({ id: z.uuid() }).strict(),
  'network.legacy.post.vms.vmId.network': z
    .object({
      action: z.enum(['preview', 'apply', 'restore', 'test']),
      config: networkSchema.optional(),
      token: z.string().optional(),
    })
    .strict(),
  'network.legacy.patch.vms.vmId.services': z.object({ forwards: forwardsSchema }).strict(),
  'pipelines.legacy.delete.vms.vmId.pipelines': z.object({ id: z.uuid() }).strict(),
  'pipelines.legacy.post.vms.vmId.pipelines': z.discriminatedUnion('action', [
    z.object({ action: z.literal('run'), pipelineId: z.uuid() }).strict(),
    z.object({ action: z.literal('rerun'), pipelineId: z.uuid(), sourceRunId: z.uuid(),
      stepIds: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)).min(1).max(20) }).strict(),
  ]),
  'pipelines.legacy.post.vms.vmId.pipeline-artifact': z
    .object({ runId: z.uuid(), index: z.number().int().min(0).max(19) })
    .strict(),
  'projects.legacy.post.vms.vmId.project-directory-migration': z.union([
    directoryMigrationPreviewSchema,
    directoryMigrationApplySchema,
  ]),
  'projects.legacy.post.vms.vmId.projects': z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), name: z.string(), config: projectSchema }).strict(),
    z.object({ action: z.literal('select'), projectId: z.string() }).strict(),
    z.object({ action: z.literal('rename'), projectId: z.string(), name: z.string() }).strict(),
  ]),
  'projects.legacy.post.vms.vmId.project': z
    .object({
      action: z.enum(['setup', 'start', 'stop', 'terminal']),
      service: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,31}$/)
        .optional(),
    })
    .strict(),
  'recipes.legacy.post.recipes': z
    .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), recipe: recipeSchema })
    .strict(),
  'recipes.post.vms.vmId.recipe.plan': recipeSchema,
  'repair.act': repairActionSchema,
  'recipes.post.vms.vmId.recipe.apply-plan': recipeApplyPlanRequestSchema,
  'recipes.legacy.post.vms.vmId.recipe': z.object({ action: z.enum(['read', 'write']) }).strict(),
  'runtimes.legacy.post.vms.vmId.runtimes': z.discriminatedUnion('action', [
    z.object({ action: z.literal('probe') }).strict(),
    z
      .object({
        action: z.literal('select'),
        node: z.string().optional(),
        python: z.string().optional(),
      })
      .strict(),
    z
      .object({ action: z.literal('install'), tool: z.enum(['node', 'python']), version: z.string() })
      .strict(),
  ]),
  'secrets.legacy.delete.vms.vmId.secrets': z.object({ name: z.string() }).strict(),
  'snapshots.legacy.post.vms.vmId.snapshots': z
    .object({
      name: z.string().trim().min(1).max(60),
      online: z.boolean().optional(),
      memory: z.boolean().optional(),
    })
    .strict(),
  'snapshots.legacy.post.vms.vmId.snapshots.snapshotId.restore': z
    .object({ backup: z.boolean().default(true), memory: z.boolean().optional() })
    .strict(),
  'snapshots.legacy.patch.vms.vmId.snapshots.snapshotId': z
    .object({ name: z.string().trim().min(1).max(60), note: z.string().max(1000).default('') })
    .strict(),
  'snapshots.legacy.post.vms.vmId.clone': z
    .object({ name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), snapshot: z.string().uuid().optional() })
    .strict(),
  'sync.legacy.post.vms.vmId.sync-rollback': z.object({ checkpoint: z.uuid() }).strict(),
  'sync.legacy.post.vms.vmId.sync-merge': z
    .object({
      path: z.string().min(1).max(4096),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  'sync.legacy.post.vms.vmId.sync': z
    .object({
      direction: z.enum(['both', 'push', 'pull']),
      token: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      decisions: z
        .record(
          z.string().max(4096),
          z.enum([
            'push',
            'pull',
            'both',
            'skip',
            'merge',
            'manual',
            'delete-host',
            'delete-guest',
            'restore-host',
            'restore-guest',
          ]),
        )
        .optional(),
      merges: z.record(z.string().max(4096), z.string().max(1024 ** 2)).optional(),
    })
    .strict(),
  'terminal-workspace.legacy.post.vms.vmId.terminal-session': z.union([
    z.object({ session: z.string().regex(/^[a-z0-9-]{1,48}$/) }).strict(),
    z.object({ action: z.literal('stop-all') }).strict(),
  ]),
};
