import { z } from 'zod';
import type { Machines } from './machines.ts';

export const gpuComputeInput = z
  .object({
    provider: z.enum(['auto', 'cuda', 'rocm']).default('auto'),
  })
  .strict();

type Probe = { available: boolean; devices: string[]; deviceNodes: boolean; diagnostic?: string };

async function nvidia(machines: Machines, id: string, signal?: AbortSignal): Promise<Probe> {
  const nodes = await machines.exec(
    id,
    'test -c /dev/nvidiactl && for d in /dev/nvidia[0-9]*; do test -c "$d" && exit 0; done; exit 1',
    10000,
    signal,
  );
  const query = await machines.exec(
    id,
    'command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,uuid --format=csv,noheader',
    15000,
    signal,
  );
  const devices =
    query.code === 0
      ? query.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 16)
          .map((line) => line.slice(0, 200))
      : [];
  return {
    available: query.code === 0 && devices.length > 0 && nodes.code === 0,
    devices,
    deviceNodes: nodes.code === 0,
    ...(query.code !== 0 ? { diagnostic: query.stderr.slice(-500) || 'nvidia-smi 不可用或查询失败' } : {}),
  };
}

async function rocm(machines: Machines, id: string, signal?: AbortSignal): Promise<Probe> {
  const nodes = await machines.exec(
    id,
    'test -c /dev/kfd && for d in /dev/dri/renderD*; do test -c "$d" && exit 0; done; exit 1',
    10000,
    signal,
  );
  const query = await machines.exec(id, 'command -v rocminfo >/dev/null && rocminfo', 15000, signal);
  const devices =
    query.code === 0
      ? query.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => /^Device Type:\s*GPU\b/i.test(line) || /^Name:\s*gfx[0-9a-z]+/i.test(line))
          .slice(0, 16)
          .map((line) => line.slice(0, 200))
      : [];
  return {
    available: query.code === 0 && devices.length > 0 && nodes.code === 0,
    devices,
    deviceNodes: nodes.code === 0,
    ...(query.code !== 0 ? { diagnostic: query.stderr.slice(-500) || 'rocminfo 不可用或查询失败' } : {}),
  };
}

/** Reports guest compute device visibility; this does not configure host PCI assignment. */
export async function gpuComputeStatus(
  machines: Machines,
  id: string,
  raw: unknown,
  action: 'check' | 'run',
  signal?: AbortSignal,
) {
  const { provider } = gpuComputeInput.parse(raw);
  machines.get(id);
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, provider, reason: '请先启动实例后检查客户机 GPU 设备。' };
  signal?.throwIfAborted();
  const cuda = provider !== 'rocm' ? await nvidia(machines, id, signal) : null;
  const amd = provider !== 'cuda' ? await rocm(machines, id, signal) : null;
  const ready = Boolean(cuda?.available || amd?.available);
  return {
    ready,
    executed: action === 'run',
    provider,
    cuda,
    rocm: amd,
    checkedAt: new Date().toISOString(),
    message: ready
      ? '客户机驱动工具和 GPU 设备节点可见；尚未运行 CUDA/ROCm 计算负载。'
      : '客户机尚未同时发现可用 GPU、驱动工具与设备节点；此检查不会配置宿主 PCI 直通。',
  };
}
