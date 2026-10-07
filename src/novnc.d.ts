/**
 * 模块职责：把 noVNC 包根入口映射到已有 RFB 类型声明，兼容客户端入口与社区类型包的路径差异。
 */
// noVNC 1.7 exposes its ESM client at the package root; the upstream community
// types still name the previous lib/rfb entry point. The RFB API is unchanged.
declare module '@novnc/novnc' {
  export { default } from '@novnc/novnc/lib/rfb';
}
