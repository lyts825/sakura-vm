/**
 * 模块职责：浏览器回归模块，围绕 `local-domain` 组织输入、可观察结果与失败边界；用例标题和断言定义最终验收条件。
 * Module: Browser regression for `local-domain`. Arrange inputs, observable results and failure boundaries; case titles and assertions define acceptance.
 * 阅读方式：先看本模块的情景与夹具，再沿具名辅助函数、受控接口和复杂回调阅读；测试替身与模型不构成真实资源隔离的证明。
 * Reading guide: Start with cases/fixtures, then follow named helpers, controlled interfaces and complex callbacks. Test substitutes and models do not attest real resource isolation.
 * 重点情景 / Key scenarios: Chromium opens generated local-domain HTTP and HTTPS service links.
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { HttpIngress } from '../server/http-ingress.ts';
import { IngressCertificates } from '../server/ingress-certificates.ts';
import { Machines } from '../server/machines.ts';
import { createSchema } from '../server/model.ts';
import type { Engine } from '../server/runtime.ts';

/**
 * 中文功能：提供可控的失败路径，使调用者的拒绝、保留或恢复行为能够被断言。
 * English: Provide a controlled failure path so caller rejection, retention or recovery can be asserted.
 * 输入 / Inputs: server: Server。
 * 结果：返回分支计算值（`address.port`），以 Promise 交付。
 * Result: Return the branch-computed value (`address.port`) through a Promise.
 * 失败 / Failure: `new Error('Listener has no TCP port')`；异常由调用者或用例断言接收 / The caller or test assertions observe the exception.
 * 协作入口 / Collaborators: `server.address`.
 */
async function serve(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Listener has no TCP port');
  return address.port;
}

/**
 * 中文功能：计算或提供本组用例需要的受控结果，供调用者继续执行或进行断言。
 * English: Compute or supply the controlled result required by this suite for subsequent execution or assertions.
 * 输入 / Inputs: 无 / none。
 * 结果：返回分支计算值（`port`），以 Promise 交付。
 * Result: Return the branch-computed value (`port`) through a Promise.
 * 协作入口 / Collaborators: `createServer`, `serve`.
 */
async function freePort() {
  const server = createServer();
  const port = await serve(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * 中文功能：执行该回归情景的输入安排、业务调用和断言，核对下述场景的实际结果。
 * English: Arrange inputs, invoke the subject and assert actual results for the regression scenario below.
 * 输入 / Inputs: { browser }。
 * 结果：没有显式结果值；调用者观察执行完成、状态变化或异常。
 * Result: No explicit result value; callers observe completion, state changes or an exception.
 * 验证场景 / Scenario: Chromium opens generated local-domain HTTP and HTTPS service links
 * 状态影响 / State effects: `httpsPort`；仅以实际赋值及本组夹具归属为准 / Follow the assignments and ownership of this fixture.
 * 协作入口 / Collaborators: `mkdtemp`, `join`, `tmpdir`, `createServer`.
 * 设计思路：将结果验证与 `finally` 收尾分离，正常完成和失败都经过相同收尾入口。
 * Design: Separate result verification from finally-based finalization so success and failure share the same finalization entry.
 */
test('Chromium opens generated local-domain HTTP and HTTPS service links', async ({ browser }) => {
  const directory = await mkdtemp(join(tmpdir(), 'sakura-local-domain-'));
  const upstream = createServer((req, res) =>
    res.writeHead(200, { 'content-type': 'text/plain' }).end(String(req.headers['x-forwarded-host'])),
  );
  const upstreamPort = await serve(upstream);
  const httpPort = await freePort();
  let httpsPort = await freePort();
  while (httpsPort === httpPort || httpsPort === upstreamPort) httpsPort = await freePort();
  const machines = new Machines({} as Engine), vmId = randomUUID();
  machines.records.set(vmId, {
    ...createSchema.parse({ name: 'domain-browser', forwards: [{ host: upstreamPort, guest: 3000 }] }),
    id: vmId, createdAt: new Date().toISOString(), snapshots: [],
  });
  machines.live.set(vmId, { status: 'running' } as any);
  const certificates = new IngressCertificates(join(directory, 'certificates.json'));
  const ingress = new HttpIngress(machines, join(directory, 'ingress.json'), certificates);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    await certificates.init();
    await ingress.init();
    /**
     * 中文功能：改变测试状态或保存受控输入，为后续调用和故障分支安排条件。
     * English: Change test state or save controlled input to arrange conditions for later calls and fault branches.
     * 输入 / Inputs: protocol: 'http' | 'https'; listenPort: number。
     * 结果：返回分支计算值（`ingress.action({ action: 'save', entry: { name: protocol, protocol, domainAlias:…`）。
     * Result: Return the branch-computed value (`ingress.action({ action: 'save', entry: { name: protocol, protocol, domainAlias:…`).
     * 验证场景 / Scenario: Chromium opens generated local-domain HTTP and HTTPS service links
     * 协作入口 / Collaborators: `ingress.action`.
     */
    const save = (protocol: 'http' | 'https', listenPort: number) => ingress.action({
      action: 'save', entry: {
        name: protocol, protocol, domainAlias: true, listenPort, pathPrefix: '/',
        vmId, upstreamPort, healthPath: '/', stripPrefix: false,
      },
    });
    const http = (await save('http', httpPort)).entries[0];
    const https = (await save('https', httpsPort)).entries.find((entry) => entry.name === 'https')!;
    const page = await context.newPage();
    for (const entry of [http, https]) {
      const response = await page.goto(entry.url);
      expect(response?.status()).toBe(200);
      expect(await page.locator('body').textContent()).toBe(new URL(entry.url).host);
    }
  } finally {
    await context.close();
    await ingress.close();
    await certificates.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    expect(dirname(directory)).toBe(resolve(tmpdir()));
    expect(basename(directory)).toMatch(/^sakura-local-domain-/);
    await rm(directory, { recursive: true, force: true });
  }
});
