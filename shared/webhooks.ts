export const webhookTypes = ['job.finished', 'alert.raised'] as const;
export const webhookJobStatuses = ['done', 'error', 'cancelled', 'interrupted'] as const;
export const webhookAlertKinds = ['cpu', 'memory', 'disk', 'service', 'backup', 'task', 'secret'] as const;
export type WebhookEvent = {
  id: string;
  type: (typeof webhookTypes)[number] | 'test';
  occurredAt: string;
  vmId?: string;
  projectId?: string;
  jobId?: string;
  scope?: string;
  status?: (typeof webhookJobStatuses)[number];
  kind?: (typeof webhookAlertKinds)[number];
  tags: string[];
};
export type WebhookFilter = {
  types: Array<(typeof webhookTypes)[number]>;
  vmIds: string[];
  projectIds: string[];
  tags: string[];
  statuses: Array<(typeof webhookJobStatuses)[number]>;
  kinds: Array<(typeof webhookAlertKinds)[number]>;
};
export type WebhookSubscription = WebhookFilter & {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  version: number;
  createdAt: number;
  hasSecret: boolean;
};
export type WebhookDelivery = {
  id: string;
  subscriptionId: string;
  version: number;
  event: WebhookEvent;
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'cancelled';
  attempts: number;
  nextAttemptAt: number;
  updatedAt: number;
  httpStatus?: number;
  error?: string;
};
export type WebhookView = {
  subscriptions: WebhookSubscription[];
  deliveries: WebhookDelivery[];
  error?: string;
  collecting: boolean;
  limits: { subscriptions: number; pending: number; history: number; attempts: number; sourceHours: number };
};
