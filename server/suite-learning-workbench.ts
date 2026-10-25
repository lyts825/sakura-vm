import type { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as L from '../shared/contracts/learning-lab.ts';
import * as H from '../shared/contracts/learning-http.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { SuiteAuthorize } from './suite-store.ts';
import type * as C from './service-contracts/learning-lab.ts';
import {
  LearningDomain,
  learningRef as ref,
  learningScope as scope,
  type LearningPeers,
} from './suite-learning.ts';
const templates = H.learningTemplate.array().parse([
  {
    id: 'files-and-directories',
    name: '文件与目录',
    description: '列举和读取课内文件，创建固定路径文本并按实际内容检查。',
    body: '先读取说明，再在 notes/result.txt 写入“完成”。路径由课程固定。只有实际文件内容符合规则才计入完成。',
    files: [{ path: 'README.txt', content: '请在 notes/result.txt 写入：完成' }],
    steps: [
      { id: 'list', title: '列举文件', instruction: '查看当前文件清单。', action: { kind: 'list' } },
      {
        id: 'read',
        title: '读取说明',
        instruction: '读取 README.txt。',
        action: { kind: 'read', path: 'README.txt' },
      },
      {
        id: 'write',
        title: '写入结果',
        instruction: '在固定路径写入“完成”。',
        action: { kind: 'write', path: 'notes/result.txt', content: '' },
        editableContent: true,
      },
    ],
    rules: [
      { id: 'exists', kind: 'exists', path: 'notes/result.txt', expected: true },
      { id: 'content', kind: 'text', path: 'notes/result.txt', expected: '完成', mode: 'equals' },
    ],
  },
  {
    id: 'configuration-repair',
    name: '配置修复',
    description: '读取损坏的 JSON 配置，修复后核对实际对象值。',
    body: '将 app.json 修复为 {"enabled":true,"port":8080}。JSON 属性顺序不影响检查。',
    files: [{ path: 'app.json', content: '{"enabled":false,"port":0}' }],
    steps: [
      {
        id: 'read',
        title: '读取配置',
        instruction: '查看当前配置。',
        action: { kind: 'read', path: 'app.json' },
      },
      {
        id: 'repair',
        title: '修复配置',
        instruction: '在编辑器写入目标 JSON。',
        action: { kind: 'write', path: 'app.json', content: '{"enabled":false,"port":0}' },
        editableContent: true,
      },
    ],
    rules: [{ id: 'configuration', kind: 'json', path: 'app.json', expected: { enabled: true, port: 8080 } }],
  },
  {
    id: 'request-response',
    name: '请求与响应',
    description: '调用固定本机演示服务并检查关闭后的真实响应。',
    body: '依次启动演示状态、发送受限回显请求、停止演示状态。每步只在自己的隔离副本内短暂启动实际 HTTP 服务，步骤结束后立即关闭。',
    files: [{ path: 'request.txt', content: 'POST /echo 只接收本课程输入' }],
    steps: [
      {
        id: 'start',
        title: '启动演示状态',
        instruction: '在隔离副本内检查服务返回 200。',
        action: { kind: 'demo-start' },
      },
      {
        id: 'request',
        title: '发送回显请求',
        instruction: '编辑 JSON 请求体；只允许固定 /echo。',
        action: { kind: 'request', method: 'POST', path: '/echo', body: { message: '本地请求' } },
        editableBody: true,
      },
      {
        id: 'stop',
        title: '停止演示状态',
        instruction: '检查返回 503，清理原进程。',
        action: { kind: 'demo-stop' },
      },
    ],
    rules: [{ id: 'stopped', kind: 'status', expected: 503 }],
  },
]);
type Ports = {
  courses: C.LearningCoursesV1;
  assets: C.LearningAssetsV1;
  lessons: C.LearningLessonsV1;
  steps: C.LearningStepsV1;
  checks: C.LearningChecksV1;
  environments: C.LearningEnvironmentsV1;
} & Record<string, S.SuiteRecordsV1>;
export class LearningWorkbench extends LearningDomain {
  constructor(
    m: PluginMetadata,
    a: SuiteAuthorize,
    private ports: Ports,
  ) {
    super(
      'learning-workbench',
      m,
      a,
      ports.courses,
      Object.fromEntries(Object.entries(ports).map(([id, port]) => ['learning-' + id, port])),
    );
  }
  async templates() {
    await this.access();
    return structuredClone(templates);
  }
  async createExample(raw: z.infer<typeof L.learningExampleInput>) {
    const i = L.learningExampleInput.parse(raw),
      t = templates.find((t) => t.id === i.template)!;
    await this.access();
    const { workspace, course: draft } = await this.ports.courses.create({
        name: i.name,
        title: t.name,
        description: t.description,
      }),
      s = { workspaceId: workspace.id },
      source = await this.ports.assets.upload({
        ...s,
        name: t.name + '样例',
        files: t.files,
        allowExport: false,
      }),
      asset = await this.ports.assets.pin({
        ...s,
        name: t.name + '课件',
        source: ref(source),
        image: i.image,
      }),
      lesson = await this.ports.lessons.compile({
        ...s,
        name: t.name,
        course: ref(draft),
        asset: ref(asset),
        key: 'lesson-1',
        title: t.name,
        body: t.body,
        prerequisites: [],
      }),
      steps = await this.ports.steps.compile({
        ...s,
        name: t.name + '步骤',
        lesson: ref(lesson),
        steps: t.steps,
      }),
      checks = await this.ports.checks.compile({
        ...s,
        name: t.name + '检查',
        lesson: ref(lesson),
        rules: t.rules,
      }),
      course = await this.ports.courses.sealCourse({ ...s, course: ref(draft), lessons: [ref(lesson)] }),
      environment = await this.ports.environments.prepare({
        ...s,
        name: t.name + '初始环境定义',
        course: ref(course),
        asset: ref(asset),
      });
    return { workspace, course, source, asset, lesson, steps, checks, environment };
  }
  async view(raw: z.infer<typeof H.learningViewInput>) {
    const i = H.learningViewInput.parse(raw);
    await this.access();
    const workspaces = await this.ports.courses.listWorkspaces();
    if (!i.workspaceId) return { workspaces, workspace: null, domains: [] };
    const s = { workspaceId: i.workspaceId },
      workspace = await this.ports.courses.workspace(s),
      domains = [];
    for (const [id, port] of Object.entries(this.ports)) {
      const page = await port.list({
        ...s,
        cursor: i.cursor ?? 0,
        limit: i.limit ?? 10,
        history: i.history ?? false,
      });
      domains.push({ id: 'learning-' + id, records: page.items, next: page.next });
    }
    return { workspaces, workspace, domains };
  }
}
