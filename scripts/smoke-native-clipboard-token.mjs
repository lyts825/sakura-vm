/**
 * 模块职责：转入后代验收脚本的 Token 专项并检查子进程退出结果；该入口没有独立测试算法。
 * Module: Dispatch the token-focused descendant smoke and check the child exit result; this entry has no separate test algorithm.
 * 设计思路：编译并驱动自有夹具，在私有 station、独立状态文件与精确出生身份范围内检查实际回执；本脚本会产生临时进程/资产，执行平台及编译器要求由入口校验定义。
 * Design: Compile/drive owned fixtures and check actual receipts within private stations, separate state files and exact process-birth identities. This script creates temporary processes/assets; entry checks define platform/compiler requirements.
 */
// The token suite also executes the ordinary creation, CLR, scan arbitration,
// service-generation and exact cleanup cases against the same exercised build.
if (!process.argv.includes('--token')) process.argv.push('--token');
await import('./smoke-native-clipboard-descendants.mjs');
