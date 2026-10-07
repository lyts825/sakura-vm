/**
 * 模块职责（中文）：硬件能力检查条目与主机报告的公共视图，统一可用性和失败原因的呈现。
 * Module responsibility (English): host hardware capabilities and incompatibility reasons.
 * 详细范围（中文）：公开入口包括 HardwareCapabilityRow, HostHardwareReport；职责覆盖主机硬件能力与不兼容原因，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HardwareCapabilityRow, HostHardwareReport. The scope covers host hardware capabilities and incompatibility reasons. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { Hardware } from '../hardware.ts';

export type HardwareCapabilityRow = {
  id: string;
  name: string;
  available: boolean;
  evidence: string;
  reason?: string;
};

/** Public report data shared by the host probe and the capability panel. */
export type HostHardwareReport = {
  ready: boolean;
  checkedAt: string;
  qemuVersion: string;
  host: {
    platform: 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd';
    arch: 'arm' | 'arm64' | 'ia32' | 'loong64' | 'mips' | 'mipsel' | 'ppc64' | 'riscv64' | 's390x' | 'x64';
  };
  probes: { devices: boolean; accelerators: boolean; machines: boolean };
  matrix: {
    devices: HardwareCapabilityRow[];
    accelerators: HardwareCapabilityRow[];
    machines: HardwareCapabilityRow[];
  };
  current: {
    accelerator: 'tcg' | 'whpx';
    networkCard: NonNullable<Hardware['devices']>['networkCard'];
    graphics: NonNullable<Hardware['devices']>['graphics'];
    selectedDevices: string[];
    cpuTopology: NonNullable<Hardware['cpu']> | null;
    memoryHotplug: NonNullable<Hardware['memory']> | null;
    compatible: boolean;
    issues: string[];
  };
  limitation: string;
};
