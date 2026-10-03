// The token suite also executes the ordinary creation, CLR, scan arbitration,
// service-generation and exact cleanup cases against the same exercised build.
if (!process.argv.includes('--token')) process.argv.push('--token');
await import('./smoke-native-clipboard-descendants.mjs');
