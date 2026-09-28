export type AccessPrincipal = {
  id: string;
  username: string;
  role: 'owner' | 'viewer';
  vmIds: string[];
  expiresAt: number;
};

export type AccessStatus = {
  enabled: boolean;
};
