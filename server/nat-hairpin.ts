/**
 * 模块职责：配置客户机访问自身宿主转发的 NAT 回流，目标必须属于实例当前 TCP 转发。
 * Module purpose: Configures guest access to its own host forwarding, requiring the target to match a current VM TCP forward.
 */
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';

export const natHairpinShape = {
  mode: z.enum(['status', 'verify']).default('status'),
  hostPort: z.number().int().min(1024).max(65535).optional(),
};
export const natHairpinSchema = z.object(natHairpinShape).strict();

/** QEMU user networking configures 10.0.2.2 as the guest-visible host gateway. */
export const guestHostGateway = '10.0.2.2';

/**
 * 入口 / Entry: natHairpin.
 * 功能：在配置客户机访问自身宿主转发的 NAT 回流中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }` / `{ ready: false, executed: false, preview, reason: '请先配置实例 TCP 端口转发。' }` 供上层消费（`nat-hairpin.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `nat-hairpin.ts`; this entry produces `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }` / `{ ready: false, executed: false, preview, reason: '请先配置实例 TCP 端口转发。' }` for its caller. Module context: Configures guest access to its own host forwarding, requiring the target to match a current VM TCP forward.
 * 处理：通过 `natHairpinSchema.parse`, `machines.get().forwards.map`, `machines.get`, `forwards.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `natHairpinSchema.parse`, `machines.get().forwards.map`, `machines.get`, `forwards.find`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`; `action === 'check' || options.mode === 'status'`; `!forwards.length`.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, preview, reason: '请先启动发行版。' }`; `{ ready: false, executed: false, preview, reason: '请先配置实例 TCP 端口转发。' }`; `{ ready: tool.code === 0, executed: false, preview, reason: tool.code === 0 ? '选择一个现有 TCP 转发并执行回流验证。' : '客户机需要安装 Python 3 才能验…`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: `machines.exec`.
 * 拒绝 / Refusals: 条件 / conditions `options.hostPort !== undefined && !selected`; `!selected`; 异常 / errors `new AppError('该宿主端口不属于此实例当前的 TCP 转发', 409)`; `new AppError('请指定要验证的宿主端口', 400)`.
 */
export async function natHairpin(
  machines: Machines,
  id: string,
  input: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const options = natHairpinSchema.parse(input);
  const forwards = machines.get(id).forwards.map(({ name, host, guest }) => ({
    name, hostPort: host, guestPort: guest,
    guestAddress: guestHostGateway,
  }));
  const selected = options.hostPort === undefined
    ? forwards.length === 1 ? forwards[0] : undefined
    : forwards.find((forward) => forward.hostPort === options.hostPort);
  if (options.hostPort !== undefined && !selected)
    throw new AppError('该宿主端口不属于此实例当前的 TCP 转发', 409);
  const preview = { forwards, selected, guestAddress: guestHostGateway };
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, preview, reason: '请先启动发行版。' };
  if (action === 'check' || options.mode === 'status') {
    if (!forwards.length)
      return { ready: false, executed: false, preview, reason: '请先配置实例 TCP 端口转发。' };
    const tool = await machines.exec(id, 'command -v python3 >/dev/null', 10000, signal);
    return { ready: tool.code === 0, executed: false, preview,
      reason: tool.code === 0 ? '选择一个现有 TCP 转发并执行回流验证。' :
        '客户机需要安装 Python 3 才能验证回流。' };
  }
  if (!selected) throw new AppError('请指定要验证的宿主端口', 400);
  signal?.throwIfAborted();
  const result = await machines.exec(id, `python3 - <<'PY'
import socket
with socket.create_connection((${JSON.stringify(guestHostGateway)}, ${selected.hostPort}), 5):
    print('sakura-hairpin-connected')
PY`, 10000, signal);
  return { ready: result.code === 0 && result.stdout.includes('sakura-hairpin-connected'),
    executed: true, preview, exitCode: result.code,
    checkedAt: new Date().toISOString(),
    ...(result.code === 0 ? {} : { reason: result.stderr.trim() || '客户机无法经宿主端口回连服务' }) };
}
