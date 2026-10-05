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
