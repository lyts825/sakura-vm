/** 内置样站只生成合成输入；启动浏览器仍须预览并批准原执行计划。 */
import type { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as B from '../shared/contracts/browser-lab.ts';
import { browserExampleInput, browserTemplate, browserViewInput } from '../shared/contracts/browser-http.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type {
  BrowserTargetsV1,
  BrowserFixturesV1,
  BrowserJourneysV1,
} from './service-contracts/browser-lab.ts';
import { SuiteStore, type SuiteAuthorize } from './suite-store.ts';
import { browserRef } from './suite-browser.ts';
const html = (body: string) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>浏览器演练样站</title><style>body{font:18px sans-serif;margin:32px;color:#18312a;background:#f4f8f6}button,input{font:inherit;padding:12px;border:1px solid #62796f;border-radius:6px}button{background:#d1eee0;cursor:pointer}nav{display:flex;gap:20px}a{color:#205b48}@media(max-width:600px){nav{display:none}nav.open{display:flex;flex-direction:column}}</style>${body}</html>`;
const fixture: B.BrowserWorkerManifest['fixture'] = {
  seed: 'browser-example-1',
  fields: { name: '本地验收' },
  localStorage: {},
  cookies: [],
};
const journey = (
  steps: z.input<typeof B.browserJourneyDefinition>['steps'],
  assertions: z.input<typeof B.browserJourneyDefinition>['assertions'],
  width = 960,
) => ({
  steps,
  assertions,
  viewport: { width, height: 640 },
  timezone: 'UTC' as const,
  visual: { enabled: false, tolerance: 0, masks: [] },
  accessibility: ['document-title', 'control-name'],
});
const templates = browserTemplate.array().parse([
  {
    id: 'form-submit',
    name: '表单提交',
    description: '填写合成姓名并验证提交后的页面文本。',
    site: {
      format: 'sakura-browser-site/1',
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          encoding: 'utf8',
          data: html(
            '<h1>本地表单</h1><form id="form"><label for="name">姓名</label><input id="name" required><button type="submit">提交</button></form><p id="result" role="status"></p><script>document.querySelector("form").onsubmit=e=>{e.preventDefault();document.querySelector("#result").textContent="已提交："+document.querySelector("#name").value}</script>',
          ),
        },
      ],
    },
    fixture,
    journey: journey(
      [
        { name: '填写姓名', action: 'fill', selector: '#name', value: '本地验收' },
        { name: '提交', action: 'click', selector: 'button' },
        { name: '保存页面', action: 'screenshot' },
      ],
      [{ step: 1, kind: 'text', selector: '#result', expected: '已提交：本地验收', comparison: 'equals' }],
    ),
  },
  {
    id: 'responsive-navigation',
    name: '响应式导航',
    description: '在窄视口打开菜单并核对本地锚点导航。',
    site: {
      format: 'sakura-browser-site/1',
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          encoding: 'utf8',
          data: html(
            '<h1>响应式导航</h1><button id="menu" aria-label="打开菜单" onclick="document.querySelector(\'nav\').classList.toggle(\'open\')">菜单</button><nav><a href="#details">详情</a></nav><h2 id="details">本地详情</h2>',
          ),
        },
      ],
    },
    fixture,
    journey: journey(
      [
        { name: '展开菜单', action: 'click', selector: '#menu' },
        { name: '打开详情', action: 'click', selector: 'nav a' },
        { name: '保存窄屏', action: 'screenshot' },
      ],
      [{ step: 1, kind: 'url', expected: '/index.html#details', comparison: 'equals' }],
      390,
    ),
  },
  {
    id: 'visual-change',
    name: '视觉基线',
    description: '生成确定性样站截图；先人工接受基线，再以该基线运行比较。',
    site: {
      format: 'sakura-browser-site/1',
      entry: 'index.html',
      files: [
        {
          path: 'index.html',
          encoding: 'utf8',
          data: html(
            '<h1>视觉基线</h1><section style="border:2px solid #568b76;padding:24px;width:360px"><h2>固定样卡</h2><p>版本 1 · 无动画</p><button>检查按钮</button></section>',
          ),
        },
      ],
    },
    fixture,
    journey: {
      ...journey(
        [{ name: '保存样卡', action: 'screenshot' }],
        [{ step: 0, kind: 'text', selector: 'h2', expected: '固定样卡', comparison: 'equals' }],
      ),
      visual: { enabled: true, tolerance: 0, masks: [] },
    },
  },
]);
export type BrowserWorkbenchPorts = {
  targets: BrowserTargetsV1;
  fixtures: BrowserFixturesV1;
  journeys: BrowserJourneysV1;
} & Record<string, S.SuiteRecordsV1>;
export class BrowserWorkbench extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private ports: BrowserWorkbenchPorts,
  ) {
    super(
      'browser-workbench',
      meta,
      auth,
      ports.targets,
      Object.fromEntries(Object.entries(ports).map(([id, port]) => ['browser-' + id, port])),
    );
  }
  async templates() {
    await this.access();
    return structuredClone(templates);
  }
  async createExample(raw: z.infer<typeof browserExampleInput>) {
    const input = browserExampleInput.parse(raw);
    await this.access();
    const t = templates.find((t) => t.id === input.template)!;
    const workspace = await this.ports.targets.createWorkspace({ name: input.name }),
      scope = { workspaceId: workspace.id };
    const source = await this.ports.targets.upload({
      ...scope,
      name: t.name + '样站',
      site: t.site,
      allowExport: false,
    });
    const target = await this.ports.targets.pin({
      ...scope,
      name: t.name + '固定目标',
      source: browserRef(source),
      image: input.image,
    });
    const fixture = await this.ports.fixtures.generate({
      ...scope,
      name: t.name + '合成数据',
      target: browserRef(target),
      data: t.fixture,
    });
    const journey = await this.ports.journeys.compile({
      ...scope,
      name: t.name + '旅程',
      target: browserRef(target),
      fixture: browserRef(fixture),
      definition: t.journey,
    });
    return { workspace, source, target, fixture, journey };
  }
  async view(raw: z.infer<typeof browserViewInput>) {
    const input = browserViewInput.parse(raw);
    await this.access();
    const workspaces = await this.ports.targets.listWorkspaces();
    if (!input.workspaceId) return { workspaces, workspace: null, domains: [] };
    const scope = { workspaceId: input.workspaceId },
      workspace = await this.ports.targets.workspace(scope),
      domains = [];
    for (const [id, port] of Object.entries(this.ports)) {
      const page = await port.list({
        ...scope,
        cursor: input.cursor ?? 0,
        limit: input.limit ?? 10,
        history: input.history ?? false,
      });
      domains.push({ id: 'browser-' + id, records: page.items, next: page.next });
    }
    return { workspaces, workspace, domains };
  }
}
