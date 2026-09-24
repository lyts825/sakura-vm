import type { Features } from '../features.ts';

export const services = [] as const;
export async function activate(_host: Features) {}
export async function route(): Promise<boolean> {
  return false;
}
