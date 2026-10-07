/**
 * 模块职责（中文）：把 noVNC 包根入口映射到已有 RFB 类型声明，兼容客户端入口与社区类型包的路径差异。
 * Module responsibility (English): Mapping the package-root entry to existing noVNC RFB type declarations.
 * 详细范围（中文）：内部入口供相邻界面或契约模块使用；职责覆盖把包根入口映射到现有 noVNC RFB 类型声明，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Internal entry points support adjacent UI/contract modules. The scope covers Mapping the package-root entry to existing noVNC RFB type declarations. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
// noVNC 1.7 exposes its ESM client at the package root; the upstream community
// types still name the previous lib/rfb entry point. The RFB API is unchanged.
declare module '@novnc/novnc' {
  export { default } from '@novnc/novnc/lib/rfb';
}
