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
