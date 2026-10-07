/**
 * 模块职责（中文）：面向界面的能力动作元数据，描述输入 Schema、示例、写入性质和是否需要客户机。
 * Module responsibility (English): Declaring capability inputs, examples, mutation semantics and guest requirements.
 * 详细范围（中文）：公开入口包括 CapabilityActionView；职责覆盖声明能力输入、示例、写入性质和客户机要求，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include CapabilityActionView. The scope covers Declaring capability inputs, examples, mutation semantics and guest requirements. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type CapabilityActionView = {
  id: string;
  name: string;
  scope: 'suite' | 'extended' | 'next';
  example: Record<string, unknown>;
  note: string;
  requiresGuest: boolean;
  writes: boolean;
  schema: Record<string, unknown>;
};
