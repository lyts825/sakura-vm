/** 烟雾验收：验证后代令牌套件入口，复用普通创建、CLR、扫描仲裁和精确清理场景。 */
// The token suite also executes the ordinary creation, CLR, scan arbitration,
// service-generation and exact cleanup cases against the same exercised build.
if (!process.argv.includes('--token')) process.argv.push('--token');
await import('./smoke-native-clipboard-descendants.mjs');
