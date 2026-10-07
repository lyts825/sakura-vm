/**
 * 模块职责：读取 CUDA 与 ROCm 设备状态，报告实际工具输出与不可用原因。
 * Module purpose: Reads CUDA/ROCm device status from actual tooling, reporting unavailable tooling rather than assumed support.
 */
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';

export const gpuComputeInput = z
  .object({
    provider: z.enum(['auto', 'cuda', 'rocm']).default('auto'),
  })
  .strict();

type Probe = { available: boolean; devices: string[]; deviceNodes: boolean; diagnostic?: string };

/**
 * 入口 / Entry: nvidia.
 * 功能：在读取 CUDA 与 ROCm 设备状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ available: query.code === 0 && devices.length > 0 && nodes.code === 0, devices, deviceNodes: nodes.code === 0, ...(query.co…` 供上层消费（`gpu-compute.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpu-compute.ts`; this entry produces `{ available: query.code === 0 && devices.length > 0 && nodes.code === 0, devices, deviceNodes: nodes.code === 0, ...(query.co…` for its caller. Module context: Reads CUDA/ROCm device status from actual tooling, reporting unavailable tooling rather than assumed support.
 * 处理：通过 `machines.exec`, `query.stdout.split().map().filter().slice().map`, `query.stdout.split().map().filter().slice`, `query.stdout.split().map().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.exec`, `query.stdout.split().map().filter().slice().map`, `query.stdout.split().map().filter().slice`, `query.stdout.split().map().filter`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: Promise<Probe>；结果来自 / values from `{ available: query.code === 0 && devices.length > 0 && nodes.code === 0, devices, deviceNodes: nodes.code === 0, ...(query.co…`.
 * 副作用 / Effects: `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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

/**
 * 入口 / Entry: rocm.
 * 功能：在读取 CUDA 与 ROCm 设备状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ available: query.code === 0 && devices.length > 0 && nodes.code === 0, devices, deviceNodes: nodes.code === 0, ...(query.co…` 供上层消费（`gpu-compute.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpu-compute.ts`; this entry produces `{ available: query.code === 0 && devices.length > 0 && nodes.code === 0, devices, deviceNodes: nodes.code === 0, ...(query.co…` for its caller. Module context: Reads CUDA/ROCm device status from actual tooling, reporting unavailable tooling rather than assumed support.
 * 处理：通过 `machines.exec`, `query.stdout.split().map().filter().slice().map`, `query.stdout.split().map().filter().slice`, `query.stdout.split().map().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.exec`, `query.stdout.split().map().filter().slice().map`, `query.stdout.split().map().filter().slice`, `query.stdout.split().map().filter`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: Promise<Probe>；结果来自 / values from `{ available: query.code === 0 && devices.length > 0 && nodes.code === 0, devices, deviceNodes: nodes.code === 0, ...(query.co…`.
 * 副作用 / Effects: `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: gpuComputeStatus.
 * 功能：在读取 CUDA 与 ROCm 设备状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, executed: false, provider, reason: '请先启动实例后检查客户机 GPU 设备。' }` / `{ ready, executed: action === 'run', provider, cuda, rocm: amd, checkedAt: new Date().toISOString(), message: ready ? '客户机驱动工…` 供上层消费（`gpu-compute.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpu-compute.ts`; this entry produces `{ ready: false, executed: false, provider, reason: '请先启动实例后检查客户机 GPU 设备。' }` / `{ ready, executed: action === 'run', provider, cuda, rocm: amd, checkedAt: new Date().toISOString(), message: ready ? '客户机驱动工…` for its caller. Module context: Reads CUDA/ROCm device status from actual tooling, reporting unavailable tooling rather than assumed support.
 * 处理：通过 `gpuComputeInput.parse`, `machines.get`, `machines.state`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `gpuComputeInput.parse`, `machines.get`, `machines.state`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`.
 * 输入 / Inputs: machines: Machines; id: string; raw: unknown; action: 'check' | 'run'; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, provider, reason: '请先启动实例后检查客户机 GPU 设备。' }`; `{ ready, executed: action === 'run', provider, cuda, rocm: amd, checkedAt: new Date().toISOString(), message: ready ? '客户机驱动工…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
