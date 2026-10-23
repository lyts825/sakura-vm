/** 绑定插件代次、项目和定义修订的一次性动作计划。 */
import { randomUUID } from 'node:crypto';
import type { PluginContext } from './plugin-api.ts';
import { dataHttpActionSchema, dataPlanSchema, type dataPluginIds } from '../shared/contracts/data-http.ts';
import type { DataScope } from '../shared/contracts/data-common.ts';
import type { DataView, DataAction, DataResult } from '../shared/contracts/data-services.ts';
import { dataHash, sameDataScope } from './data-store.ts';
import { AppError } from '../shared/errors.ts';
type Service = {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
};
type Plan = {
  scope: DataScope;
  plugin: (typeof dataPluginIds)[number];
  generation: string;
  signal: AbortSignal;
  expires: number;
  input: DataAction;
  fingerprint: string;
};
const plans = new Map<string, Plan>();
function fingerprint(view: DataView) {
  return dataHash({
    environments: view.environments,
    sources: view.sources,
    datasets: view.datasets,
    queries: view.queries,
    rules: view.rules,
    notebooks: view.notebooks,
    imports: view.imports,
  });
}
export async function dataHttpAct(
  host: PluginContext,
  plugin: (typeof dataPluginIds)[number],
  scope: DataScope,
  service: Service,
  raw: unknown,
  signal?: AbortSignal,
) {
  const input = dataHttpActionSchema.parse(raw);
  host.signal.throwIfAborted();
  for (const [key, plan] of plans) if (plan.expires < Date.now() || plan.signal.aborted) plans.delete(key);
  if (input.phase === 'preview') {
    if (plans.size >= 1000) throw new AppError('待审阅数据计划过多', 429);
    const token = randomUUID(),
      expires = Date.now() + 10 * 60000;
    const notes = ['计划仅对当前插件代次和项目有效，十分钟后失效；提交时重新检查定义修订。'];
    if (input.input.action === 'capture-postgres')
      notes.push('将连接已固定 IP 与 TLS 主机的 PostgreSQL 18；服务器端读时行为不由客户端沙箱保证。');
    if ('allowDownload' in input.input && input.input.allowDownload)
      notes.push('此操作明确允许联网下载固定版本依赖并生成新环境镜像。');
    if ('allowOutputs' in input.input && input.input.allowOutputs)
      notes.push('导出包含选定的代码、规则、指标和完整执行输出；任意 Python 内容不保证自动脱敏。');
    if ('allowRaw' in input.input && input.input.allowRaw)
      notes.push('此操作包含原始敏感数据；Notebook 输出继承原始级别。');
    if ('environment' in input.input)
      notes.push('每次运行使用专用隔离实例；单次输入 1 GiB、输出 256 MiB，超限失败，不截断成功。');
    plans.set(token, {
      scope,
      plugin,
      generation: String(host.instance.generation),
      signal: host.signal,
      expires,
      input: structuredClone(input.input),
      fingerprint: fingerprint(await service.view(scope)),
    });
    return {
      plan: dataPlanSchema.parse({
        token,
        expiresAt: new Date(expires).toISOString(),
        plugin,
        input: input.input,
        notes,
      }),
    };
  }
  const plan = plans.get(input.token);
  plans.delete(input.token);
  if (
    !plan ||
    plan.plugin !== plugin ||
    !sameDataScope(plan.scope, scope) ||
    plan.generation !== String(host.instance.generation) ||
    plan.signal.aborted ||
    plan.expires < Date.now()
  )
    throw new AppError('数据计划不存在、已消费或已失效，请重新预览', 409, 'DATA_PLAN_STALE');
  if (fingerprint(await service.view(scope)) !== plan.fingerprint)
    throw new AppError('数据定义已变化，请重新预览', 409, 'DATA_PLAN_CHANGED');
  return service.act(scope, plan.input, signal);
}
