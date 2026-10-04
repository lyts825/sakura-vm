import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { RuntimeVersions } from '../../server/runtime-versions.ts';

export const services = {
  runtimes: serviceRef<ServiceInterface<RuntimeVersions>>('runtimes', 'runtimes'),
};
