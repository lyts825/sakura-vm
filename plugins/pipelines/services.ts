import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Pipelines } from '../../server/pipelines.ts';

export const services = {
  pipelines: serviceRef<ServiceInterface<Pipelines>>('pipelines', 'pipelines'),
};
