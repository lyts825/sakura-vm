/**
 * 中文：组合 React 构建插件、主控制台和单应用双入口，并为浏览器与服务端 SSR 选择适合各自的资源拆分方式。
 * English: Compose the React build plugin and the main/single-app entries, selecting asset boundaries appropriate to browser and server SSR outputs.
 * 设计 / Design: 浏览器目录与终端依赖独立缓存，SSR 入口保持原装配流程 / Browser catalogs and terminal dependencies remain independently cacheable while SSR entries retain their assembly flow.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(
  /**
   * 中文功能：按 Vite 的 SSR 构建标识创建配置，客户端输出资源清单，服务端沿用其独立构建入口。
   * English: Create Vite configuration from the SSR-build flag; browser builds emit an asset manifest while server builds retain their separate entry flow.
   * 输入 / Inputs: `isSsrBuild` 为 Vite 提供的构建模式 / The build mode supplied by Vite.
   * 返回 / Returns: React 插件、输出目录、入口和分块策略组成的配置对象 / Configuration for React, output location, entries and chunk selection.
   */
  ({ isSsrBuild }) => ({
  plugins: [react()],
  build: {
    outDir: 'dist',
    manifest: !isSsrBuild,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: { main: resolve('index.html'), singleApp: resolve('single-app.html') },
      output: {
        /**
         * 中文功能：依据模块路径选择终端、操作目录、插件契约或插件清单的浏览器分块；其它模块交由 Rollup 默认处理。
         * English: Select browser chunks for terminal code, operation catalogs, plugin contracts or plugin catalogs from module paths; leave other modules to Rollup defaults.
         * 输入 / Inputs: `id` 是解析后的模块标识，统一斜杠后进行精确目录匹配 / A resolved module ID, normalized before precise catalog matching.
         * 返回 / Returns: 固定分块名或 `undefined` / A stable chunk name or undefined.
         * 设计思路：先处理独立终端库，再仅在客户端拆目录，避免服务端运行入口依赖浏览器专用分块；目录与界面变动可各自缓存。
         * Design: Handle the separate terminal library first, then split catalogs only for browser builds so server entries do not depend on browser-specific chunks and catalogs remain cacheable across UI changes.
         */
        manualChunks(id) {
          if (id.includes('/node_modules/@xterm/')) return 'terminal';
          const path = id.replaceAll('\\', '/');
          // 仅浏览器拆公共目录；SSR 保留独立入口 / Split shared catalogs only in browser builds; retain independent SSR entries.
          if (!isSsrBuild) {
            // 路由目录与界面独立缓存 / Keep generated wire routing independently cacheable from UI changes.
            if (/\/shared\/contracts\/api-client\.generated\.ts$/.test(path)) return 'operation-catalog';
            if (/\/shared\/plugin-(?:schema|resolver|selection)\.ts$/.test(path)) return 'plugin-contracts';
            if (/\/shared\/(?:plugins|plugin-(?:catalog\.generated|protocol))\.ts$/.test(path) ||
              /\/plugins\/[^/]+\/manifest\.ts$/.test(path) || /\/plugins\/packs\/[^/]+\.ts$/.test(path))
              return 'plugin-catalog';
          }
        },
      },
    },
  },
}));
