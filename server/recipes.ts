import { z } from 'zod';
import { posix } from 'node:path';
import { createSchema, AppError } from './model.ts';
import { projectSchema, type Workspaces } from './workspaces.ts';
import type { Machines } from './machines.ts';

export const recipeSchema = z
  .object({
    version: z.literal(1),
    resources: z
      .object({
        cpus: createSchema.shape.cpus,
        memoryMiB: createSchema.shape.memoryMiB,
        diskGiB: createSchema.shape.diskGiB,
        accelerator: createSchema.shape.accelerator,
        distro: createSchema.shape.distro,
        template: createSchema.shape.template,
        forwards: createSchema.shape.forwards,
      })
      .strict()
      .partial()
      .default({}),
    project: projectSchema,
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;
export class Recipes {
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}
  async export(id: string): Promise<Recipe> {
    const { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template } = this.machines.get(id);
    return {
      version: 1,
      resources: { cpus, memoryMiB, diskGiB, distro, accelerator, forwards, template },
      project: await this.workspaces.config(id),
    };
  }
  async read(id: string) {
    const project = await this.workspaces.config(id);
    return recipeSchema.parse(
      JSON.parse(await this.machines.readGuestFile(id, posix.join(project.directory, 'sakura.json'))),
    );
  }
  async write(id: string) {
    const recipe = await this.export(id);
    await this.machines.writeGuestFile(
      id,
      posix.join(recipe.project.directory, 'sakura.json'),
      JSON.stringify(recipe, null, 2) + '\n',
      false,
    );
    return recipe;
  }
  async create(name: string, value: unknown) {
    const recipe = recipeSchema.parse(value);
    const vm = await this.machines.create({ ...recipe.resources, name });
    try {
      await this.workspaces.save(vm.id, recipe.project);
    } catch (error) {
      await this.machines.delete(vm.id);
      throw error;
    }
    return this.machines.view(vm.id);
  }
  async apply(id: string, input: unknown) {
    const recipe = recipeSchema.parse(input);
    const vm = this.machines.get(id);
    // Applying to an existing workspace changes project commands only. Disk and
    // running machine settings remain explicit operations in the resource panel.
    if (this.workspaces.jobs.view(id)?.status === 'running') throw new AppError('请等待项目任务完成', 409);
    await this.workspaces.save(vm.id, recipe.project);
    return this.workspaces.view(id);
  }
}
