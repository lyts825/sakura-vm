import type { SessionLockView } from '../session-lock.ts';

export type System = {
  session?: SessionLockView;
  plugins: string[];
  pluginRuntime?: { version: number; instances: import('./plugin-runtime.ts').PluginInstanceView[] };
  version: string;
  engine: string;
  posixloom: string;
  nativeHost: boolean;
  hostname: string;
  platform: string;
  hostCpus: number;
  hostMemoryMiB: number;
  freeMemoryMiB: number;
  controllerMemoryMiB: number;
  imageReady: boolean;
  imageBytes: number;
};
export type ProjectIndex = { active: string; projects: { id: string; name: string }[] };
