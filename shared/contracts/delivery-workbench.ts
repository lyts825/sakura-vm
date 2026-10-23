/** 交付定义、模板与工作台记录。 Delivery definitions, templates and workbench records. */
import { z } from 'zod';
import { deliveryDefinitionSchema, deliveryScopeSchema } from './delivery-common.ts';

export const deliveryDefinitionRecordSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    revision: z.number().int().positive(),
    definition: deliveryDefinitionSchema,
    archived: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type DeliveryDefinitionRecord = z.infer<typeof deliveryDefinitionRecordSchema>;
export const deliveryTemplateSchema = z
  .object({ id: z.string(), name: z.string(), description: z.string(), definition: deliveryDefinitionSchema })
  .strict();
export type DeliveryTemplate = z.infer<typeof deliveryTemplateSchema>;
export const deliveryWorkbenchSchema = z
  .object({
    definitions: z.array(deliveryDefinitionRecordSchema),
    templates: z.array(deliveryTemplateSchema),
  })
  .strict();
export type DeliveryWorkbenchView = z.infer<typeof deliveryWorkbenchSchema>;
export const deliveryDefinitionSaveSchema = z
  .object({
    id: z.uuid().optional(),
    expectedRevision: z.number().int().nonnegative(),
    definition: deliveryDefinitionSchema,
  })
  .strict();

const environment = { distro: 'alpine', architecture: 'x86_64', network: 'isolated', publicEnvironment: {} };
/** 模板明确声明依赖；捕获前仍须审阅路径、命令及网络。
 * Templates declare dependencies; review paths, commands and networking before capture. */
export const deliveryTemplates: DeliveryTemplate[] = [
  {
    id: 'static',
    name: '静态站点',
    description: '检查 index.html 并封装为可预览站点，不声明测试覆盖率。',
    definition: {
      name: '静态站点交付',
      source: { mode: 'commit', ref: 'HEAD', paths: [] },
      environment,
      steps: [
        {
          id: 'build',
          name: '检查并封装页面',
          command: 'test -f index.html && mkdir -p dist && cp index.html dist/index.html',
          dependsOn: [],
          timeoutSeconds: 60,
          rerunnable: true,
        },
      ],
      outputs: ['dist'],
      reports: [],
      startup: { kind: 'static', root: 'dist', port: 8080, command: '', healthPath: '/', timeoutSeconds: 60 },
      matrix: [],
      maxConcurrency: 1,
      requireTests: false,
    },
  },
  {
    id: 'node',
    name: 'Node 项目',
    description: '项目需提供 build、test 脚本并生成 JUnit 报告；联网安装依赖须显式启用 NAT。',
    definition: {
      name: 'Node 项目交付',
      source: { mode: 'commit', ref: 'HEAD', paths: [] },
      environment,
      steps: [
        {
          id: 'install',
          name: '安装锁定依赖',
          command: 'npm ci --ignore-scripts',
          dependsOn: [],
          timeoutSeconds: 600,
          rerunnable: true,
        },
        {
          id: 'test',
          name: '执行测试',
          command: 'npm test',
          dependsOn: ['install'],
          timeoutSeconds: 300,
          rerunnable: true,
        },
        {
          id: 'build',
          name: '构建',
          command: 'npm run build',
          dependsOn: ['test'],
          timeoutSeconds: 300,
          rerunnable: true,
        },
      ],
      outputs: ['dist'],
      reports: [{ path: 'junit.xml', format: 'junit', required: true }],
      startup: { kind: 'static', root: 'dist', port: 8080, command: '', healthPath: '/', timeoutSeconds: 60 },
      matrix: [],
      maxConcurrency: 1,
      requireTests: true,
    },
  },
  {
    id: 'python',
    name: 'Python 命令行',
    description: '以 main.py 为入口，语法检查后打包；请按项目补充真实测试和报告。',
    definition: {
      name: 'Python 命令行交付',
      source: { mode: 'commit', ref: 'HEAD', paths: [] },
      environment,
      steps: [
        {
          id: 'check',
          name: '检查入口',
          command: 'python3 -m py_compile main.py && mkdir -p dist && cp main.py dist/main.py',
          dependsOn: [],
          timeoutSeconds: 120,
          rerunnable: true,
        },
      ],
      outputs: ['dist'],
      reports: [],
      startup: {
        kind: 'command',
        root: 'dist',
        port: 8080,
        command: 'python3 main.py --help',
        healthPath: '/',
        timeoutSeconds: 60,
      },
      matrix: [],
      maxConcurrency: 1,
      requireTests: false,
    },
  },
  {
    id: 'custom',
    name: '自定义流程',
    description: '从明确的构建命令和输出目录开始。',
    definition: {
      name: '自定义交付',
      source: { mode: 'commit', ref: 'HEAD', paths: [] },
      environment,
      steps: [
        {
          id: 'build',
          name: '构建',
          command: 'test -d dist',
          dependsOn: [],
          timeoutSeconds: 300,
          rerunnable: true,
        },
      ],
      outputs: ['dist'],
      reports: [],
      startup: { kind: 'static', root: 'dist', port: 8080, command: '', healthPath: '/', timeoutSeconds: 60 },
      matrix: [],
      maxConcurrency: 1,
      requireTests: false,
    },
  },
].map((value) => deliveryTemplateSchema.parse(value));
