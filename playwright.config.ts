/**
 * 中文：浏览器 E2E 在固定本机端口启动已构建的 Vite 预览，使用 Chromium 和受控 API 验证界面行为。
 * English: Browser E2E starts the built Vite preview on a fixed loopback port and uses Chromium/controlled APIs to verify UI behavior.
 * 设计 / Design: 双 worker 共享预览，CI 独立启动服务；用例自身决定 API 情景 / Two workers share the preview, CI starts a private server, and each case defines its API scenario.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    // 本地可复用预览，CI 隔离启动 / Reuse a local preview when available; start an isolated preview in CI.
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
