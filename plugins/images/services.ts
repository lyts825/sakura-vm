import type { ServiceInterface } from '../../server/service-interface.ts';
import { serviceRef } from '../../server/service-ref.ts';
import type { Images } from '../../server/images.ts';
import type { DiskImports } from '../../server/disk-imports.ts';

export const services = {
  images: serviceRef<ServiceInterface<Images>>('images', 'images'),
  diskImports: serviceRef<ServiceInterface<DiskImports>>('images', 'diskImports'),
};
