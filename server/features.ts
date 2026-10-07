/**
 * 模块职责：保留旧 Features 名称作为 PluginRuntime 的兼容导出，不另建插件运行状态。
 * Module purpose: Preserves the Features compatibility name as PluginRuntime without introducing separate plugin state.
 */
/** API composition facade. Runtime state belongs to the unified plugin manager. */
export { PluginRuntime as Features } from './plugin-runtime.ts';
