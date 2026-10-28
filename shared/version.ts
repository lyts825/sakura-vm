/**
 * 中文：应用发行版的公开身份，供界面和控制面报告当前版本；维护时同步根包清单、锁文件与内置插件版本。
 * English: Public application release identity used by UI/control-plane version reports. Keep it synchronized with root manifests and the built-in plugin version.
 * 设计 / Design: 单一常量避免不同入口各自定义版本；协议版本仍由各自的契约管理 / A single constant avoids conflicting release identities; protocol versions remain owned by their contracts.
 */
export const APP_VERSION = '2.12.3';
