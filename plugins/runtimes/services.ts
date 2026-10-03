import { serviceRef } from '../../server/service-ref.ts';
import type { RuntimeVersions } from '../../server/runtime-versions.ts';

export const services = {
  runtimes: serviceRef<RuntimeVersions>('runtimes', 'runtimes'),
};
