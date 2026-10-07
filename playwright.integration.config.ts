/** 真实工作空间集成入口；单 worker 串行使用用例自行准备的控制服务与实例。 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './integration',
  workers: 1,
  fullyParallel: false,
  // 客户机初始化和安装会跨多个异步阶段，保留现有十分钟单用例上限。
  timeout: 600000,
  expect: { timeout: 15000 },
  use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'test-results/integration',
});
