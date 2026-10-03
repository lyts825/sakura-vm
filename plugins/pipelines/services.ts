import { serviceRef } from '../../server/service-ref.ts';
import type { Pipelines } from '../../server/pipelines.ts';

export const services = {
  pipelines: serviceRef<Pipelines>('pipelines', 'pipelines'),
};
