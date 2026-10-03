import { serviceRef } from '../../server/service-ref.ts';
import type { Recipes } from '../../server/recipes.ts';

export const services = {
  recipes: serviceRef<Recipes>('recipes', 'recipes'),
};
