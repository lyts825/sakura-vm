import { z } from 'zod';
import { createSchema } from '../shared/contracts/vm.ts';
import { logRetentionRequest } from './log-retention.ts';
import { remoteAuditAction } from './remote-audit.ts';
import { graphqlRequest } from './graphql-api.ts';
import { sessionLockConfiguration, sessionUnlockRequest } from './session-lock.ts';
import {
  accessEnableInput,
  accessLoginInput,
  accessViewerInput,
  accessMemberInput,
  accessPasswordInput,
  accessHandoffInput,
  accessHandoffRedeem,
} from './access-control.ts';
import { projectPermissionInput } from './project-permissions.ts';
import {
  policyBundleApply,
  policyBundleKeyAction,
  policyBundlePreview,
  policyBundleTarget,
} from './policy-bundles.ts';
import { changeRequestInput, changeDecisionInput } from './change-approvals.ts';
import { passkeyRegisterStart, passkeyFinish, passkeyRemove } from './passkeys.ts';
import { ssoBeginInput, ssoOidcInput, ssoSamlInput } from './sso.ts';
import { terminalShareInput } from './terminal-sharing.ts';
import { guestExecutionInput } from './project-execution.ts';
import { webhookRequest } from './webhooks.ts';
import { automationRequest } from './automation-rules.ts';
import { featureRolloutRequest } from './feature-rollouts.ts';
import { fleetRolloutRequest } from './fleet-policy-rollouts.ts';
import { usbHotplugRequest } from './usb-hotplug.ts';
import { gpuProfileRequest } from './gpu-profiles.ts';
import { buildFarmRequest } from './build-farm.ts';
import { mediaDeviceRequest } from './media-devices.ts';
import { memoryReclaimRequest } from './memory-reclaim.ts';
import { hostMountRequest } from './host-mount.ts';
import { hostPeerRequest } from './host-peers.ts';
import { communityPluginRequest } from './community-plugins.ts';
import { mobileAction } from './mobile-companion.ts';
import { assistantRequest } from './local-assistant.ts';
import { nativeRequest } from './native-integration.ts';
import { nativeClipboardRequest } from './native-clipboard.ts';
import { storagePoolInput } from './storage-pools.ts';
import { jitRequestInput, jitDecisionInput } from './jit-privileges.ts';
import { guestInteropRequest } from './process-interop.ts';
import { virtioFsRequest } from './virtio-fs.ts';
import { trustedBootRequest } from './trusted-boot-service.ts';
import { hostRuntimeDiagnosticSchema, networkRuntimeDiagnosticSchema, operationDeclarationSchema } from '../shared/contracts/operations.ts';


const validators = new WeakMap<object, z.ZodType>();
const request = (schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { io: 'input' });
  validators.set(json, schema);
  return json;
};
export const coreRequestSchema = (body: object | undefined) => body && validators.get(body);
const string = { type: 'string' };
export const coreOperations: {
  id: string;
  method: string;
  path: string;
  title: string;
  body?: Record<string, unknown>;
  response?: Record<string, unknown>;
  status?: number;
  media?: string;
  inspect?: boolean;
  public?: boolean;
  projectScoped?: boolean;
}[] = [
  {
    id: 'bootstrap',
    method: 'GET',
    path: '/api/bootstrap',
    title: '未启用账户模式时获取本地控制凭证',
    public: true,
    response: { type: 'object', properties: { token: string }, required: ['token'] },
  },
  { id: 'access.status', method: 'GET', path: '/api/access/status',
    title: '账户模式与会话锁状态', public: true, response: { type: 'object',
      properties: { enabled: { type: 'boolean' }, session: { type: 'object' } },
      required: ['enabled', 'session'] } },
  { id: 'access.ssoProviders', method: 'GET', path: '/api/access/sso/providers',
    title: '列出已配置的单点登录提供商', public: true },
  { id: 'access.ssoStart', method: 'POST', path: '/api/access/sso/start',
    title: '开始 OIDC 或 SAML 登录或账户绑定', public: true,
    body: request(ssoBeginInput) },
  { id: 'access.ssoOidcCallback', method: 'GET', path: '/api/access/sso/oidc/callback',
    title: '接收身份提供商的 OIDC 授权码回调', public: true, media: 'text/html' },
  { id: 'access.ssoSamlCallback', method: 'POST', path: '/api/access/sso/saml/callback',
    title: '接收身份提供商的 SAML POST 断言', public: true, media: 'text/html' },
  { id: 'access.ssoView', method: 'GET', path: '/api/access/sso',
    title: '查看单点登录配置和当前账户关联', inspect: true },
  { id: 'access.ssoOidcConfigure', method: 'PUT', path: '/api/access/sso/oidc',
    title: '管理员配置 OIDC 身份提供商', body: request(ssoOidcInput) },
  { id: 'access.ssoOidcDisable', method: 'DELETE', path: '/api/access/sso/oidc',
    title: '管理员停用 OIDC 并撤销关联会话' },
  { id: 'access.ssoSamlConfigure', method: 'PUT', path: '/api/access/sso/saml',
    title: '管理员导入 SAML IdP 元数据', body: request(ssoSamlInput) },
  { id: 'access.ssoSamlDisable', method: 'DELETE', path: '/api/access/sso/saml',
    title: '管理员停用 SAML 并撤销关联会话' },
  { id: 'access.ssoUnlink', method: 'DELETE', path: '/api/access/sso/link/{provider}',
    title: '解除当前账户的外部身份关联并撤销会话' },
  { id: 'access.login', method: 'POST', path: '/api/access/login',
    title: '使用账户密码登录', public: true, body: request(accessLoginInput) },
  { id: 'access.handoffRedeem', method: 'POST', path: '/api/access/handoff/redeem',
    title: '接收一次性账户会话交接', public: true, body: request(accessHandoffRedeem) },
  { id: 'access.handoffCreate', method: 'POST', path: '/api/access/handoff',
    title: '验证密码并生成两分钟有效的会话交接码', body: request(accessHandoffInput) },
  { id: 'access.handoffCancel', method: 'DELETE', path: '/api/access/handoff',
    title: '取消当前会话待接收的交接码' },
  { id: 'access.terminalShares', method: 'GET', path: '/api/access/terminal-shares',
    title: '列出当前账户可查看的终端共享；可用 vmId、project 查询参数筛选', inspect: true },
  { id: 'access.terminalShareCreate', method: 'POST', path: '/api/access/terminal-shares',
    title: '为只读账户授予运行中 tmux 会话的限时查看权限',
    body: request(terminalShareInput), status: 201 },
  { id: 'access.terminalShareRevoke', method: 'DELETE',
    path: '/api/access/terminal-shares/{id}', title: '撤销终端查看权限及活动连接' },
  { id: 'access.passkeyLoginOptions', method: 'POST', path: '/api/access/passkeys/login/options',
    title: '开始本机通行密钥登录', public: true, body: request(z.object({}).strict()) },
  { id: 'access.passkeyLoginVerify', method: 'POST', path: '/api/access/passkeys/login/verify',
    title: '验证通行密钥并登录', public: true, body: request(passkeyFinish) },
  { id: 'access.passkeys', method: 'GET', path: '/api/access/passkeys',
    title: '列出当前账户的通行密钥', inspect: true },
  { id: 'access.passkeyRegisterOptions', method: 'POST',
    path: '/api/access/passkeys/register/options', title: '验证密码并开始登记通行密钥',
    body: request(passkeyRegisterStart) },
  { id: 'access.passkeyRegisterVerify', method: 'POST',
    path: '/api/access/passkeys/register/verify', title: '验证并登记通行密钥',
    body: request(passkeyFinish), status: 201 },
  { id: 'access.passkeyRemove', method: 'DELETE', path: '/api/access/passkeys/{id}',
    title: '验证密码并撤销通行密钥及其会话', body: request(passkeyRemove) },
  { id: 'access.view', method: 'GET', path: '/api/access/view',
    title: '获授权的实例摘要', inspect: true },
  { id: 'access.logout', method: 'POST', path: '/api/access/logout', title: '撤销当前账户会话' },
  { id: 'access.enable', method: 'POST', path: '/api/access/enable',
    title: '启用账户模式并设置管理员密码', body: request(accessEnableInput) },
  { id: 'access.users', method: 'GET', path: '/api/access/users', title: '列出账户' },
  { id: 'access.createViewer', method: 'POST', path: '/api/access/users',
    title: '创建限定实例的只读账户', body: request(accessViewerInput), status: 201 },
  { id: 'access.removeViewer', method: 'DELETE', path: '/api/access/users/{id}',
    title: '撤销只读账户及其会话' },
  { id: 'access.createMember', method: 'POST', path: '/api/access/members',
    title: '创建默认无项目权限的成员账户', body: request(accessMemberInput), status: 201 },
  { id: 'access.removeMember', method: 'DELETE', path: '/api/access/members/{id}',
    title: '删除项目成员并撤销会话与项目授权' },
  { id: 'access.projects', method: 'GET', path: '/api/access/projects',
    title: '成员列出已获授权的项目', inspect: true },
  { id: 'access.projectPermissions', method: 'GET', path: '/api/access/project-permissions',
    title: '查看指定 vmId 与 projectId 的角色和成员授权', inspect: true },
  { id: 'access.configureProjectPermissions', method: 'PUT',
    path: '/api/access/project-permissions', title: '设置项目角色、权限和成员授权',
    body: request(projectPermissionInput) },
  { id: 'access.policyBundleKeys', method: 'GET',
    path: '/api/access/policy-bundles/keys', title: '查看本机及受信任的策略签名公钥', inspect: true },
  { id: 'access.policyBundleKeyAction', method: 'POST',
    path: '/api/access/policy-bundles/keys', title: '信任或撤销项目策略签名公钥',
    body: request(policyBundleKeyAction) },
  { id: 'access.exportPolicyBundle', method: 'POST',
    path: '/api/access/policy-bundles/export', title: '导出签名的完整项目权限策略',
    body: request(policyBundleTarget) },
  { id: 'access.previewPolicyBundle', method: 'POST',
    path: '/api/access/policy-bundles/preview', title: '验证项目策略包签名并预览目标差异',
    body: request(policyBundlePreview) },
  { id: 'access.applyPolicyBundle', method: 'POST',
    path: '/api/access/policy-bundles/apply', title: '应用受信任且目标版本匹配的项目策略包',
    body: request(policyBundleApply) },
  { id: 'access.changes', method: 'GET', path: '/api/access/changes',
    title: '列出当前账户可查看或审批的项目变更', inspect: true },
  { id: 'access.createChange', method: 'POST', path: '/api/access/changes',
    title: '提交精确配置与基线版本的项目变更', body: request(changeRequestInput), status: 201 },
  { id: 'access.decideChange', method: 'POST', path: '/api/access/changes/{id}/decision',
    title: '由另一账户审批或拒绝项目变更', body: request(changeDecisionInput) },
  { id: 'access.applyChange', method: 'POST', path: '/api/access/changes/{id}/apply',
    title: '申请人一次性应用已批准的变更', body: request(z.object({}).strict()) },
  { id: 'access.password', method: 'POST', path: '/api/access/password',
    title: '更换管理员密码并撤销全部会话', body: request(accessPasswordInput) },
  { id: 'system', method: 'GET', path: '/api/system', title: '主机与插件状态', inspect: true },
  { id: 'network-runtime', method: 'GET', path: '/api/network-runtime', title: '统一网络层运行状态（账户管理员）', inspect: true },
  { id: 'host-runtime', method: 'GET', path: '/api/host-runtime', title: '系统资源与准入状态（账户管理员）', inspect: true },
  { id: 'monitor', method: 'GET', path: '/api/monitor', title: '只读监控快照', inspect: true },
  { id: 'storage-pools.get', method: 'GET', path: '/api/storage-pools',
    title: '本机存储池容量、实例分配与迁移清理状态', inspect: true },
  { id: 'storage-pools.action', method: 'POST', path: '/api/storage-pools',
    title: '创建、移除或清理存储池以及迁移停机实例', body: request(storagePoolInput) },
  {
    id: 'native.get',
    method: 'GET',
    path: '/api/native-integration',
    title: 'Windows 工作区映射与集成设置',
    inspect: true,
  },
  {
    id: 'native.action',
    method: 'POST',
    path: '/api/native-integration',
    title: '配置资源管理器入口、文件关联或打开本机副本',
    body: request(nativeRequest),
  },
  { id: 'native-clipboard.get', method: 'GET', path: '/api/native-clipboard',
    title: 'Windows 应用剪贴板设置、进程状态与拒绝计数', inspect: true },
  { id: 'native-clipboard.action', method: 'POST', path: '/api/native-clipboard',
    title: '绑定、受控启动或停用 Windows 应用剪贴板策略', body: request(nativeClipboardRequest) },
  {
    id: 'assistant.get',
    method: 'GET',
    path: '/api/assistant',
    title: '本地 AI 设置与请求状态',
    inspect: true,
  },
  {
    id: 'assistant.action',
    method: 'POST',
    path: '/api/assistant',
    title: '模型设置、脱敏预览、编程建议或命令规划',
    body: request(assistantRequest),
  },
  {
    id: 'webhooks.get',
    method: 'GET',
    path: '/api/webhooks',
    title: '事件订阅、告警路由与投递记录',
    inspect: true,
  },
  {
    id: 'webhooks.change',
    method: 'POST',
    path: '/api/webhooks',
    title: '管理订阅、测试或处理投递记录',
    body: request(webhookRequest),
  },
  {
    id: 'automation-rules.get', method: 'GET', path: '/api/automation-rules',
    title: '事件自动化规则与执行记录', inspect: true,
  },
  {
    id: 'automation-rules.change', method: 'POST', path: '/api/automation-rules',
    title: '保存、预览或删除事件自动化规则', body: request(automationRequest),
  },
  {
    id: 'feature-rollouts.get', method: 'GET', path: '/api/feature-rollouts',
    title: '插件功能灰度与当前启动状态', inspect: true,
  },
  {
    id: 'feature-rollouts.change', method: 'POST', path: '/api/feature-rollouts',
    title: '保存、预览或删除插件灰度策略', body: request(featureRolloutRequest),
  },
  {
    id: 'fleet-policy-rollouts.get', method: 'GET', path: '/api/fleet-policy-rollouts',
    title: '查看已保存的集群策略发布批次及逐台结果', inspect: true,
  },
  {
    id: 'fleet-policy-rollouts.change', method: 'POST', path: '/api/fleet-policy-rollouts',
    title: '复核目标策略版本并创建或发布集群策略批次', body: request(fleetRolloutRequest),
  },
  { id: 'usb-hotplug.get', method: 'GET', path: '/api/vms/{vmId}/usb-hotplug',
    title: '查看宿主 USB 设备、转发规则与操作记录', inspect: true },
  { id: 'usb-hotplug.change', method: 'POST', path: '/api/vms/{vmId}/usb-hotplug',
    title: '保存 USB 转发规则或动态连接和移除设备', body: request(usbHotplugRequest) },
  { id: 'gpu-profiles.get', method: 'GET', path: '/api/gpu-profiles',
    title: '查看 GPU/vGPU 档案、宿主后端探测和实例应用记录', inspect: true },
  { id: 'gpu-profiles.change', method: 'POST', path: '/api/gpu-profiles',
    title: '保存档案、复核宿主兼容性并应用到停止的实例', body: request(gpuProfileRequest) },
  { id: 'build-farm.get', method: 'GET', path: '/api/build-farm',
    title: '查看构建节点、排队任务及执行记录', inspect: true },
  { id: 'build-farm.change', method: 'POST', path: '/api/build-farm',
    title: '管理构建节点并提交、取消或重试构建', body: request(buildFarmRequest) },
  { id: 'media-devices.get', method: 'GET', path: '/api/vms/{vmId}/media-devices',
    title: '查看虚拟音视频设备、宿主后端、USB 规则与客户机证据', inspect: true },
  { id: 'media-devices.change', method: 'POST', path: '/api/vms/{vmId}/media-devices',
    title: '复核并应用音频设备或管理 USB 摄像头与麦克风转发', body: request(mediaDeviceRequest) },
  { id: 'memory-reclaim.get', method: 'GET', path: '/api/vms/{vmId}/memory-reclaim',
    title: '查看客户机内存压力自动回收策略与最近采样', inspect: true },
  { id: 'memory-reclaim.change', method: 'POST', path: '/api/vms/{vmId}/memory-reclaim',
    title: '保存自动回收策略或立即采样客户机内存', body: request(memoryReclaimRequest) },
  { id: 'host-mount.get', method: 'GET', path: '/api/vms/{vmId}/host-mount',
    title: '查看宿主目录挂载策略、客户机路径和状态', inspect: true },
  { id: 'host-mount.change', method: 'POST', path: '/api/vms/{vmId}/host-mount',
    title: '保存宿主目录挂载策略或挂载、卸载目录', body: request(hostMountRequest) },
  {
    id: 'host-peers.get', method: 'GET', path: '/api/host-peers',
    title: '主机配对、资源和健康状态', inspect: true,
  },
  {
    id: 'host-peers.change', method: 'POST', path: '/api/host-peers',
    title: '管理同伴入口、短码和已配对主机', body: request(hostPeerRequest),
  },
  {
    id: 'cold-migrations.get', method: 'GET', path: '/api/cold-migrations',
    title: '跨主机冷迁移队列及状态', inspect: true,
  },
  {
    id: 'snapshot-replications.get', method: 'GET', path: '/api/snapshot-replications',
    title: '跨主机快照复制队列、校验值及重试状态', inspect: true,
  },
  {
    id: 'session.status',
    method: 'GET',
    path: '/api/session',
    title: '会话锁定状态',
    inspect: true,
    public: true,
  },
  {
    id: 'session.settings',
    method: 'GET',
    path: '/api/session/settings',
    title: '会话锁定配置',
    inspect: true,
  },
  {
    id: 'session.configure',
    method: 'PATCH',
    path: '/api/session/settings',
    title: '保存会话锁定配置',
    body: request(sessionLockConfiguration),
  },
  {
    id: 'session.unlock',
    method: 'POST',
    path: '/api/session/unlock',
    title: '验证密码并解锁',
    public: true,
    body: request(sessionUnlockRequest),
  },
  {
    id: 'session.lock',
    method: 'POST',
    path: '/api/session/lock',
    title: '立即锁定控制面',
    body: request(z.object({}).strict()),
  },
  {
    id: 'session.activity',
    method: 'POST',
    path: '/api/session/activity',
    title: '报告用户操作并延长空闲期限',
    body: request(z.object({}).strict()),
  },
  {
    id: 'graphql.schema',
    method: 'GET',
    path: '/api/graphql-schema',
    title: 'GraphQL Schema 和查询限制',
    inspect: true,
  },
  {
    id: 'graphql.query',
    method: 'POST',
    path: '/api/graphql',
    title: '执行只读 GraphQL 查询',
    body: request(graphqlRequest),
    media: 'application/graphql-response+json',
  },
  {
    id: 'log-retention.get',
    method: 'GET',
    path: '/api/log-retention',
    title: '任务日志保留策略与用量',
    inspect: true,
  },
  {
    id: 'log-retention.change',
    method: 'POST',
    path: '/api/log-retention',
    title: '预览或保存并应用日志保留策略',
    body: request(logRetentionRequest),
  },
  { id: 'audit', method: 'GET', path: '/api/audit', title: '审计链记录' },
  { id: 'audit.remoteStatus', method: 'GET', path: '/api/audit/remote',
    title: '本地审计链与远程对象锁锚点状态', inspect: true },
  { id: 'audit.remoteAction', method: 'POST', path: '/api/audit/remote',
    title: '配置、同步或校验远程不可变审计锚点', body: request(remoteAuditAction) },
  { id: 'plugins.list', method: 'GET', path: '/api/plugins', title: '插件目录与启用状态', inspect: true },
  { id: 'community-plugins.list', method: 'GET', path: '/api/community-plugins',
    title: '第三方签名插件目录、来源与安装状态', inspect: true },
  { id: 'community-plugins.change', method: 'POST', path: '/api/community-plugins',
    title: '信任发布者、管理目录、安装或运行隔离插件', body: request(communityPluginRequest) },
  { id: 'community-plugins.extension', method: 'POST',
    path: '/api/community-plugins/extensions/{pluginId}/{routeId}',
    title: '调用签名插件声明的隔离 HTTP 操作', body: {} },
  { id: 'mobile-companion.get', method: 'GET', path: '/api/mobile-companion',
    title: '查看已配对移动设备及 HTTPS 入口', inspect: true },
  { id: 'mobile-companion.change', method: 'POST', path: '/api/mobile-companion',
    title: '生成手机配对码、修改只读策略或撤销设备', body: request(mobileAction) },
  {
    id: 'plugins.change',
    method: 'PATCH',
    path: '/api/plugins',
    title: '保存插件选择（重启后生效）',
    body: request(
      z.object({ kind: z.enum(['plugin', 'pack']), id: z.string(), enabled: z.boolean() }).strict(),
    ),
  },
  {
    id: 'vms.list',
    method: 'GET',
    path: '/api/vms',
    title: '实例列表',
    inspect: true,
    response: { type: 'array', items: { type: 'object' } },
  },
  {
    id: 'vms.create',
    method: 'POST',
    path: '/api/vms',
    title: '创建实例',
    body: request(createSchema),
    status: 201,
  },
  { id: 'vms.get', method: 'GET', path: '/api/vms/{vmId}', title: '实例详情', inspect: true },
  {
    id: 'vms.update',
    method: 'PATCH',
    path: '/api/vms/{vmId}',
    title: '更新已停止实例配置',
    body: request(createSchema),
  },
  { id: 'vms.delete', method: 'DELETE', path: '/api/vms/{vmId}', title: '删除已停止实例' },
  { id: 'vms.start', method: 'POST', path: '/api/vms/{vmId}/start', title: '启动实例' },
  {
    id: 'vms.stop',
    method: 'POST',
    path: '/api/vms/{vmId}/stop',
    title: '停止实例',
    body: request(z.object({ force: z.boolean().default(false) }).strict()),
  },
  {
    id: 'vms.exec',
    method: 'POST',
    path: '/api/vms/{vmId}/exec',
    title: '按当前或指定项目执行客户机命令；实例管理需明确指定 instance 范围',
    projectScoped: true,
    body: request(guestExecutionInput),
    response: { type: 'object', required: ['stdout', 'stderr', 'code', 'scope'], properties: {
      stdout: string, stderr: string, code: { type: 'integer' }, scope: { enum: ['project', 'instance'] },
      projectId: string, directory: string, networkIsolation: { enum: ['host', 'private'] },
    } },
  },
  {
    id: 'vms.logs',
    method: 'GET',
    path: '/api/vms/{vmId}/logs',
    title: '实例日志',
    response: { type: 'object', properties: { content: string }, required: ['content'] },
  },
  {
    id: 'lockdown.get',
    method: 'GET',
    path: '/api/vms/{vmId}/lockdown',
    title: '应急锁定状态',
    inspect: true,
  },
  {
    id: 'lockdown.set',
    method: 'POST',
    path: '/api/vms/{vmId}/lockdown',
    title: '改变应急锁定状态',
    body: request(z.object({ locked: z.boolean() }).strict()),
  },
  { id: 'jobs.list', method: 'GET', path: '/api/jobs', title: '任务记录' },
  { id: 'jobs.result', method: 'GET', path: '/api/jobs/{jobId}/result', title: '持久化任务结果' },
  { id: 'jobs.cancel', method: 'POST', path: '/api/jobs/{jobId}/cancel', title: '取消任务' },
  { id: 'jobs.retry', method: 'POST', path: '/api/jobs/{jobId}/retry', title: '按原插件规则重试任务' },
  { id: 'events', method: 'GET', path: '/api/events', title: '需要关注的任务事件' },
  { id: 'openapi', method: 'GET', path: '/api/openapi', title: 'OpenAPI 文档' },
  { id: 'sdk', method: 'GET', path: '/api/sdk', title: '生成 JavaScript 客户端文件' },
  { id: 'operations', method: 'GET', path: '/api/operations', title: '可查询的精确操作与权限目录',
    response: z.toJSONSchema(z.object({ operations: z.array(operationDeclarationSchema) })) },
  { id: 'session.passkeyOptions', method: 'POST', path: '/api/session/unlock/passkey/options',
    title: '开始通行密钥解锁', public: true, body: request(z.object({}).strict()) },
  { id: 'session.passkeyVerify', method: 'POST', path: '/api/session/unlock/passkey/verify',
    title: '确认通行密钥解锁', public: true, body: request(passkeyFinish) },
  { id: 'access.jitList', method: 'GET', path: '/api/access/jit', title: '临时授权申请记录' },
  { id: 'access.jitCreate', method: 'POST', path: '/api/access/jit', title: '申请临时授权', body: request(jitRequestInput), status: 201 },
  { id: 'access.jitDecision', method: 'POST', path: '/api/access/jit/{id}/decision', title: '审批临时授权', body: request(jitDecisionInput) },
  { id: 'access.jitExecute', method: 'POST', path: '/api/access/jit/{id}/execute', title: '使用一次性授权', body: request(z.object({}).strict()) },
  { id: 'browserExtensions.list', method: 'GET', path: '/api/browser-extensions', title: '浏览器扩展连接' },
  { id: 'browserExtensions.pair', method: 'POST', path: '/api/browser-extensions', title: '生成扩展配对码', body: request(z.object({}).strict()), status: 201 },
  { id: 'browserExtensions.revoke', method: 'DELETE', path: '/api/browser-extensions/{id}', title: '撤销浏览器扩展' },
  { id: 'extension.connect', method: 'POST', path: '/api/extension/connect', title: '兑换浏览器扩展配对凭证', public: true, status: 201 },
  { id: 'extension.inventory', method: 'GET', path: '/api/extension/inventory', title: '扩展权限内的实例摘要', public: true },
  { id: 'extension.connectOptions', method: 'OPTIONS', path: '/api/extension/connect', title: '扩展预检', public: true, status: 204 },
  { id: 'extension.inventoryOptions', method: 'OPTIONS', path: '/api/extension/inventory', title: '扩展预检', public: true, status: 204 },
  { id: 'guest.interop', method: 'POST', path: '/api/guest/interop', title: '本机客户机互操作凭证入口', public: true, body: request(guestInteropRequest) },
  { id: 'download', method: 'GET', path: '/api/downloads/{ticket}', title: '使用一次性下载票据', public: true, media: 'application/octet-stream' },
  { id: 'virtioFs.get', method: 'GET', path: '/api/vms/{vmId}/virtio-fs', title: 'Virtio-FS状态' },
  { id: 'virtioFs.change', method: 'POST', path: '/api/vms/{vmId}/virtio-fs', title: '配置Virtio-FS', body: request(virtioFsRequest) },
  { id: 'trustedBoot.get', method: 'GET', path: '/api/vms/{vmId}/trusted-boot', title: '受信启动状态' },
  { id: 'trustedBoot.change', method: 'POST', path: '/api/vms/{vmId}/trusted-boot', title: '配置受信启动', body: request(trustedBootRequest) },
];
coreOperations.find((item) => item.id === 'host-runtime')!.response = z.toJSONSchema(hostRuntimeDiagnosticSchema);
coreOperations.find((item) => item.id === 'network-runtime')!.response = z.toJSONSchema(networkRuntimeDiagnosticSchema);
