import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError } from './model.ts';

export const natHairpinShape = {
  mode: z.enum(['status', 'verify']).default('status'),
  hostPort: z.number().int().min(1024).max(65535).optional(),
};
export const natHairpinSchema = z.object(natHairpinShape).strict();

/** QEMU user networking configures 10.0.2.2 as the guest-visible host gateway. */
export const guestHostGateway = '10.0.2.2';

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
