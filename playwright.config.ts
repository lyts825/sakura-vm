/** 浏览器 E2E 使用构建后的 Vite 预览；用例中的受控 API 不要求真实 VM。 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    // 本地复用预览服务，CI 独立启动以免沿用其它任务的产物。
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
