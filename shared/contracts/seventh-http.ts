/** 固定目录逐插件建立严格线路；内部容量/引用端口不直接发布。 */
import { z } from 'zod';
import catalog from '../seventh-catalog.json';
import * as S from './suite-common.ts';
import * as T from './seventh-common.ts';
import { suiteMethod as method, suiteControls, suiteMaterialMethods, suiteEmpty } from './suite-http.ts';
import { suiteExecutionTool } from './seventh-execution.ts';
import { imageAssetSchema, imageUploadSchema, imageRefSchema } from './image-assets.ts';
import { seventhExchangeMethods } from './seventh-exchange.ts';
type Methods = Record<string, { request: z.ZodType; response: z.ZodType; read: boolean }>;
const materialOnly = [
  'beginUpload',
  'appendUpload',
  'finishUpload',
  'uploads',
  'discardUpload',
  'openRead',
  'readLease',
  'closeRead',
  'readSource',
  'policy',
  'planPolicy',
  'applyPolicy',
];
export const seventhHttpSchemas: Record<string, Record<string, Methods>> = {};
for (const pack of catalog) {
  const group: Record<string, Methods> = {};
  for (const member of pack.members) {
    const domain = member.id.slice(pack.prefix.length + 1);
    if (domain === 'exchange') {
      group[domain] = seventhExchangeMethods();
      continue;
    }
    const methods: Methods = {
      ...suiteControls(S.suiteJson),
      previewAction: method(T.seventhPreview, S.suitePlan),
      executeAction: method(S.suiteApproval, S.suiteRecord),
      status: method(T.seventhJob, T.seventhStatus, true),
      cancel: method(T.seventhJob, T.seventhStatus),
      reconcile: method(T.seventhJob, T.seventhStatus),
      templates: method(suiteEmpty, S.suiteJson, true),
      availableActions: method(suiteEmpty, z.array(z.string().max(128)).max(1000), true),
      view: method(S.suiteScope, S.suiteJson, true),
    };
    if (member.id === pack.root) {
      const all = suiteMaterialMethods();
      for (const key of [
        'createWorkspace',
        'listWorkspaces',
        'workspace',
        'revokeWorkspace',
        'capacity',
        'hostCapacity',
      ] as const)
        methods[key] = all[key];
      methods.archive = method(
        z.union([
          S.suitePin,
          S.suiteScope.extend({ expectedRevision: z.number().int().positive() }).strict(),
        ]),
        z.union([S.suiteRecord, S.suiteWorkspace]),
      );
    }
    if (member.material) {
      const all = suiteMaterialMethods() as Methods;
      for (const key of materialOnly) methods[key] = all[key];
      methods.beginUpload = method(T.seventhMaterialUpload, S.suiteUpload);
      methods.upload = method(T.seventhUpload, S.suiteRecord);
    }
    if (
      ['schedlab-harness', 'extforge-builds', 'protostate-runs', 'virtservice-sessions'].includes(member.id)
    ) {
      methods.tool = method(suiteEmpty, suiteExecutionTool, true);
      methods.images = method(suiteEmpty, z.array(imageAssetSchema).max(1000), true);
      methods.beginImageImport = method(
        imageUploadSchema
          .pick({ digest: true, bytes: true, distro: true, architecture: true, source: true })
          .extend({ distro: z.literal('alpine'), architecture: z.literal('x86_64') })
          .strict(),
        imageUploadSchema,
      );
      methods.appendImageImport = method(
        z
          .object({ id: z.uuid(), offset: z.number().int().nonnegative(), data: z.string().max(700000) })
          .strict(),
        imageUploadSchema,
      );
      methods.finishImageImport = method(z.object({ id: z.uuid() }).strict(), imageAssetSchema);
      methods.imageImports = method(suiteEmpty, z.array(imageUploadSchema).max(1000), true);
      methods.discardImageImport = method(
        z.object({ id: z.uuid() }).strict(),
        z.object({ discarded: z.literal(true) }).strict(),
      );
      methods.verifyImage = method(imageRefSchema, imageAssetSchema);
    }
    for (const name of member.methods) {
      if (Object.hasOwn(methods, name)) continue;
      if (name === 'create' && member.id === pack.root)
        methods[name] = method(z.object({ name: S.suiteName }).strict(), S.suiteWorkspace);
      else if (name === 'pin') methods[name] = method(S.suitePin, S.suiteRecord, true);
      else if (name === 'close')
        methods[name] = method(
          S.suiteScope.extend({ expectedRevision: z.number().int().positive() }).strict(),
          S.suiteWorkspace,
        );
      else methods[name] = method(z.union([T.seventhAction, S.suiteApproval]), S.suiteJson);
    }
    for (const value of Object.values(methods)) {
      value.request = z.preprocess((raw, context) => {
        if (!S.isSuiteJsonBounded(raw))
          context.addIssue({ code: 'custom', message: '请求含保留字段或超出结构限制' });
        return raw;
      }, value.request);
    }
    group[domain] = methods;
  }
  seventhHttpSchemas[pack.prefix] = group;
}
export function seventhSchemas(pluginId: string): Methods {
  const pack = catalog.find((p) => p.members.some((m) => m.id === pluginId));
  if (!pack) throw new Error('SEVENTH_PLUGIN');
  return seventhHttpSchemas[pack.prefix][pluginId.slice(pack.prefix.length + 1)];
}
/** HTTP 发布合同与实际严格处理器共享同一来源。 */
export const seventhHttpRequests = Object.fromEntries(
  Object.entries(seventhHttpSchemas).flatMap(([prefix, domains]) =>
    Object.entries(domains).flatMap(([domain, methods]) =>
      Object.entries(methods).map(([name, value]) => [`${prefix}-${domain}.${name}`, value.request]),
    ),
  ),
);
export const seventhHttpResponses = Object.fromEntries(
  Object.entries(seventhHttpSchemas).flatMap(([prefix, domains]) =>
    Object.entries(domains).flatMap(([domain, methods]) =>
      Object.entries(methods).map(([name, value]) => [`${prefix}-${domain}.${name}`, value.response]),
    ),
  ),
);
