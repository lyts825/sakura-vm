/**
 * 模块职责：面向界面的能力动作元数据，描述输入 Schema、示例、写入性质和是否需要客户机。
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
