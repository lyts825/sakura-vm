/**
 * 中文：真实工作空间的浏览器集成配置，单 worker 串行使用用例自行准备的控制服务与实例，失败时保留追踪与截图。
 * English: Browser integration configuration for a real workspace; one worker runs serially against case-owned controllers/instances and retains failure traces/screenshots.
 * 设计 / Design: 生命周期与客户机初始化共享资源，串行运行避免场景互相干扰 / Serial execution keeps lifecycle and guest-initialization cases from interfering through shared resources.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './integration',
  workers: 1,
  fullyParallel: false,
  // 初始化跨多个异步阶段，保留十分钟上限 / Preserve the ten-minute case limit for multi-stage guest initialization.
  timeout: 600000,
  expect: { timeout: 15000 },
  use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'test-results/integration',
});
