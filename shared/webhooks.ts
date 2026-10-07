/**
 * 模块职责（中文）：Webhook 事件类型、过滤、订阅与投递状态的公共契约，供自动化与投递界面共享。
 * Module responsibility (English): Defining public event, filter, subscription and delivery contracts.
 * 详细范围（中文）：公开入口包括 webhookTypes, webhookJobStatuses, webhookAlertKinds, WebhookEvent, WebhookFilter, WebhookSubscription, WebhookDelivery, WebhookView；职责覆盖定义事件、过滤、订阅和投递公共契约，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include webhookTypes, webhookJobStatuses, webhookAlertKinds, WebhookEvent, WebhookFilter, WebhookSubscription, WebhookDelivery, WebhookView. The scope covers Defining public event, filter, subscription and delivery contracts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
