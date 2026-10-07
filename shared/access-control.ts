/**
 * 模块职责（中文）：控制面账户主体和可访问资源的公共视图类型，供服务端与界面共享权限语义。
 * Module responsibility (English): Defining public views of account principals, roles and access state.
 * 详细范围（中文）：公开入口包括 AccessPrincipal, AccessStatus；职责覆盖定义账户主体、角色与访问状态公共视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include AccessPrincipal, AccessStatus. The scope covers Defining public views of account principals, roles and access state. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type AccessPrincipal = {
  id: string;
  username: string;
  role: 'owner' | 'viewer' | 'member';
  vmIds: string[];
  expiresAt: number;
};

export type AccessStatus = {
  enabled: boolean;
};
