import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA, createSchema } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectSchema, type Workspaces } from './workspaces.ts';
import type { Machines } from './machines.ts';

const resourceSchema = z.object({
  cpus: createSchema.shape.cpus,
  memoryMiB: createSchema.shape.memoryMiB,
  diskGiB: createSchema.shape.diskGiB,
  accelerator: createSchema.shape.accelerator,
  distro: z.enum(['alpine', 'debian', 'ubuntu']).default('alpine'),
  firmware: z.enum(['bios', 'uefi']).default('bios'),
  template: z.enum(['none', 'node', 'python', 'rust']).default('none'),
}).strict();
const projectBlueprint = z.object({
  directory: z.literal('/workspace'),
  template: projectSchema.shape.template,
  repository: projectSchema.shape.repository,
  previewPort: projectSchema.shape.previewPort,
  runtimes: projectSchema.shape.runtimes,
}).strict();
const contentSchema = z.object({ resources: resourceSchema, project: projectBlueprint }).strict();
type Content = z.infer<typeof contentSchema>;
const itemSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(64),
  version: z.number().int().min(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  content: contentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), templates: z.array(itemSchema).max(40) }).strict();
type State = z.infer<typeof stateSchema>;

export const teamTemplateInput = z.object({
  mode: z.enum(['list', 'capture', 'inspect', 'create', 'delete']).default('list'),
  name: z.string().trim().min(1).max(64).optional(),
  templateId: z.uuid().optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  previousFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  targetName: createSchema.shape.name.optional(),
}).strict();

const digest = (content: Content) => createHash('sha256').update(JSON.stringify(content)).digest('hex');
const defaults = (): State => ({ version: 1, templates: [] });

/** A host catalog of reviewed, portable VM/project blueprints. */
export class TeamTemplates {
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private file = join(DATA, 'team-templates.json'),
  ) {}

  private async state() {
    const state = stateSchema.parse(await readStore(this.file, defaults));
    for (const item of state.templates)
      if (item.fingerprint !== digest(item.content))
        throw new AppError('团队模板内容校验失败：' + item.id, 409);
    if (new Set(state.templates.map((item) => item.id)).size !== state.templates.length ||
        new Set(state.templates.map((item) => item.name)).size !== state.templates.length)
      throw new AppError('团队模板目录包含重复条目', 409);
    return state;
  }

  private async draft(id: string): Promise<Content> {
    const vm = this.machines.get(id);
    const project = await this.workspaces.config(id);
    let repository = '';
    if (project.repository) {
      const url = new URL(project.repository);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash)
        repository = project.repository;
    }
    return contentSchema.parse({
      resources: {
        cpus: vm.cpus, memoryMiB: vm.memoryMiB, diskGiB: vm.diskGiB,
        accelerator: vm.accelerator, distro: vm.distro || 'alpine',
        firmware: vm.firmware || 'bios', template: project.template,
      },
      project: {
        directory: '/workspace', template: project.template, repository,
        previewPort: project.previewPort, runtimes: project.runtimes,
      },
    });
  }

  private item(state: State, id?: string) {
    const item = state.templates.find((entry) => entry.id === id);
    if (!item) throw new AppError('团队模板不存在', 404);
    return item;
  }

  async action(id: string, input: unknown, action: 'check' | 'run') {
    const value = teamTemplateInput.parse(input);
    this.machines.get(id);
    if (value.mode === 'list') {
      const state = await this.state();
      return { ready: true, executed: false, templates: state.templates.map(
        ({ content: _, ...metadata }) => metadata) };
    }
    if (value.mode === 'capture') {
      if (!value.name) throw new AppError('保存模板需要名称');
      const templateName = value.name;
      const content = await this.draft(id);
      const fingerprint = digest(content);
      if (action === 'check') {
        const existing = value.templateId ? this.item(await this.state(), value.templateId) : undefined;
        return { ready: true, executed: false, name: templateName, fingerprint,
          previousFingerprint: existing?.fingerprint, content,
          excluded: ['环境变量', '私密配置', '服务命令', '安装命令', '启动命令', '端口转发'] };
      }
      if (value.fingerprint !== fingerprint)
        throw new AppError('来源项目或资源已变化，请重新预览模板', 409);
      return this.machines.locked('team-templates', async () => {
        const state = await this.state();
        const existing = value.templateId ? this.item(state, value.templateId) : undefined;
        if (existing && existing.fingerprint !== value.previousFingerprint)
          throw new AppError('团队模板已更新，请重新预览', 409);
        if (existing && existing.name !== templateName)
          throw new AppError('更新模板时名称必须保持不变', 409);
        if (state.templates.some((item) => item.name === templateName && item !== existing))
          throw new AppError('同名团队模板已存在', 409);
        if (!existing && state.templates.length >= 40)
          throw new AppError('最多保留 40 个团队模板', 409);
        if (existing?.fingerprint === fingerprint)
          return { ready: true, executed: false, unchanged: true, template: existing };
        const time = new Date().toISOString();
        const saved = existing
          ? { ...existing, content, fingerprint, version: existing.version + 1, updatedAt: time }
          : { id: randomUUID(), name: templateName, version: 1, content, fingerprint,
              createdAt: time, updatedAt: time };
        if (existing) state.templates[state.templates.indexOf(existing)] = saved;
        else state.templates.push(saved);
        await writeStore(this.file, state);
        return { ready: true, executed: true, template: saved };
      });
    }
    if (!value.templateId) throw new AppError('请选择团队模板');
    if (action === 'check' || value.mode === 'inspect') {
      const template = this.item(await this.state(), value.templateId);
      return { ready: true, executed: false, template,
        message: value.mode === 'create' ? '新实例使用模板中的资源与项目设置，不复制文件、密钥或端口转发。' : undefined };
    }
    if (!value.fingerprint) throw new AppError('请先预览并提交模板指纹', 409);
    return this.machines.locked('team-templates', async () => {
      const state = await this.state();
      const template = this.item(state, value.templateId);
      if (template.fingerprint !== value.fingerprint)
        throw new AppError('团队模板已更新，请重新预览', 409);
      if (value.mode === 'delete') {
        state.templates = state.templates.filter((entry) => entry.id !== template.id);
        await writeStore(this.file, state);
        return { ready: true, executed: true, deleted: template.id };
      }
      if (value.mode !== 'create' || !value.targetName)
        throw new AppError('创建实例需要目标名称');
      const vm = await this.machines.create({ ...template.content.resources,
        name: value.targetName, forwards: [] });
      try {
        await this.workspaces.save(vm.id, template.content.project);
      } catch (error) {
        await this.machines.delete(vm.id);
        throw error;
      }
      return { ready: true, executed: true, templateId: template.id,
        vmId: vm.id, vm: await this.machines.view(vm.id) };
    });
  }
}
