import { serviceRef } from '../../server/service-ref.ts';
import type { Images } from '../../server/images.ts';
import type { DiskImports } from '../../server/disk-imports.ts';

export const services = {
  images: serviceRef<Images>('images', 'images'),
  diskImports: serviceRef<DiskImports>('images', 'diskImports'),
};
