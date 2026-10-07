/**
 * 模块职责：控制面账户主体和可访问资源的公共视图类型，供服务端与界面共享权限语义。
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
