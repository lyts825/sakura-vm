/**
 * 模块职责（中文）：WebSocket 通道、帧 Schema、长度限制和关闭原因契约，统一升级准入与消息编解码。
 * Module responsibility (English): channel frames, byte limits, authentication and close protocols.
 * 详细范围（中文）：公开入口包括 socketChannels, SocketChannel, SOCKET_CLIENT_BYTES, SOCKET_SERVER_BYTES, terminalInputSchema, terminalOutputSchema, socketFrameSchemas, JsonSocketChannel, RfbStreamFragment, SocketClientMessage, SocketServerMessage, TerminalReady, socketCloseReasons, SocketCloseReason, socketUpgradeStatuses, closeSocket；职责覆盖通道帧、字节限制、认证和关闭协议，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include socketChannels, SocketChannel, SOCKET_CLIENT_BYTES, SOCKET_SERVER_BYTES, terminalInputSchema, terminalOutputSchema, socketFrameSchemas, JsonSocketChannel, RfbStreamFragment, SocketClientMessage, SocketServerMessage, TerminalReady, socketCloseReasons, SocketCloseReason, socketUpgradeStatuses, closeSocket. The scope covers channel frames, byte limits, authentication and close protocols. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';
import { jsonValueSchema } from './json-values.ts';

export const socketChannels = ['events', 'terminal', 'terminal-view', 'logs', 'desktop', 'desktop-view'] as const;
export type SocketChannel = typeof socketChannels[number];
export const SOCKET_CLIENT_BYTES = 65_536;
export const SOCKET_SERVER_BYTES = 1_048_576;
export const terminalInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(32_768) }).strict(),
  // Existing clients may submit an integer size outside the displayed range; the adapter clamps it.
  z.object({ type: z.literal('resize'), cols: z.number().int(), rows: z.number().int() }).strict(),
]);
const data = z.object({ type: z.literal('data'), data: z.string().max(524_288) }).strict();
export const terminalOutputSchema = z.discriminatedUnion('type', [
  data,
  z.object({ type: z.literal('ready'), data: z.object({ projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
    networkIsolation: z.enum(['host', 'private']) }).strict() }).strict(),
  z.object({ type: z.literal('error'), data: z.string().max(1024) }).strict(),
  z.object({ type: z.literal('exit'), data: z.literal(true) }).strict(),
]);
const event = z.object({ type: z.literal('change'), data: z.null() }).strict();
export const socketFrameSchemas = {
  events: { client: z.never(), server: event },
  terminal: { client: terminalInputSchema, server: terminalOutputSchema },
  'terminal-view': { client: z.never(), server: terminalOutputSchema },
  logs: { client: z.never(), server: data },
} as const;

export type JsonSocketChannel = keyof typeof socketFrameSchemas;
/** A fragment of the ordered RFB byte stream, never a complete-packet guarantee. */
// 桌面帧只是有序字节流的一段，消费者必须允许一个 RFB 包跨多个 WebSocket 帧或多个包同帧到达。
export type RfbStreamFragment = Uint8Array;
export type SocketClientMessage<C extends SocketChannel> = C extends JsonSocketChannel
  ? z.infer<(typeof socketFrameSchemas)[C]['client']> : RfbStreamFragment;
export type SocketServerMessage<C extends SocketChannel> = C extends JsonSocketChannel
  ? z.infer<(typeof socketFrameSchemas)[C]['server']> : RfbStreamFragment;
export type TerminalReady = Extract<SocketServerMessage<'terminal'>, { type: 'ready' }>['data'];

/** These are application close frames. Empty close() and terminate() have no wire code/reason. */
export const socketCloseReasons = {
  messageTooLarge: { code: 1009, reason: 'Message too large' },
  unsupportedMessageType: { code: 1003, reason: 'Unsupported message type' },
  readOnlyChannel: { code: 1008, reason: 'Read-only channel' },
  invalidMessage: { code: 1008, reason: 'Invalid message' },
  invalidTerminalInput: { code: 1008, reason: 'invalid message' },
  readOnlyTerminal: { code: 1008, reason: 'Read-only terminal' },
  pluginRevoked: { code: 1008, reason: 'Plugin generation revoked' },
  incidentLockdown: { code: 1008, reason: 'Incident lockdown' },
  slowConsumer: { code: 1008, reason: 'slow consumer' },
  invalidServerMessage: { code: 1011, reason: 'Invalid server message' },
  desktopUnavailable: { code: 1011, reason: 'Desktop unavailable' },
  binaryRfbRequired: { code: 1003, reason: 'Binary RFB required' },
} as const;
export type SocketCloseReason = keyof typeof socketCloseReasons;
export const socketUpgradeStatuses = { accepted: 101, locked: 423, refused: 403 } as const;
/**
 * 中文：在通道帧、字节限制、认证和关闭协议流程中关闭所属连接或存储对象；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
 * English: In channel frames, byte limits, authentication and close protocols, close the owned connection/storage object. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
 * 中文：输入：socket：签名所示 { close(code: number, reason: string): void } 业务值；reason：结束或拒绝操作的可显示原因
 * English: Inputs: socket: the { close(code: number, reason: string): void } domain value in the signature; reason: displayable operation-end/refusal reason
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function closeSocket(socket: { /** 中文：声明以应用关闭码和原因字符串发送关闭帧的 socket 能力，实际连接释放由底层实现负责。 | English: Declare socket capability emitting an application close frame with code/reason, with actual connection release owned by the implementation. | 中文：输入：code：签名所示 number 业务值；reason：结束或拒绝操作的可显示原因 | English: Inputs: code: the number domain value in the signature; reason: displayable operation-end/refusal reason | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ close(code: number, reason: string): void }, reason: SocketCloseReason) {
  const frame = socketCloseReasons[reason];
  socket.close(frame.code, frame.reason);
}
export const readOnlyRfbPolicy = {
  clientPolicy: 'read-only-filter', versions: ['003.007', '003.008'], securityType: 1,
  clientMessageTypes: [0, 2, 3, 150, 248], maxPendingBytes: 65_536, maxEncodings: 256,
  maxFencePayloadBytes: 64, fenceFlagsMask: 3, strippedEncoding: 0xc0a1e5ce,
} as const;

/** Binary desktop messages are ordered RFB byte-stream fragments, not JSON or one packet per frame. */
export const socketContractSchema = z.object({
  version: z.literal(1), encoding: z.enum(['json', 'binary']), protocol: z.enum(['sakura-json-v1', 'rfb-3.7-or-3.8']),
  framing: z.enum(['message', 'byte-stream']), clientMaxBytes: z.number().int().positive(),
  serverMaxBytes: z.number().int().positive(), clientMessages: z.array(z.string()), serverMessages: z.array(z.string()),
  readOnly: z.boolean(),
  clientSchema: z.record(z.string(), jsonValueSchema).optional(), serverSchema: z.record(z.string(), jsonValueSchema).optional(),
  authentication: z.object({
    credential: z.literal('query.token'), sameOrigin: z.literal(true), session: z.literal('unlocked'),
    local: z.literal('controller-token'), accountRoles: z.array(z.enum(['owner', 'viewer'])),
    viewerGrant: z.enum(['none', 'vm', 'terminal']),
  }).strict(),
  lifecycle: z.object({
    upgrade: z.object({ accepted: z.literal(101), locked: z.literal(423), refused: z.literal(403) }).strict(),
    errorMessage: z.enum(['none', 'terminal-error', 'rfb-stream']),
    closeReasons: z.array(z.enum(Object.keys(socketCloseReasons) as [SocketCloseReason, ...SocketCloseReason[]])),
    emptyClose: z.array(z.string()), terminate: z.array(z.string()), replay: z.literal(false),
  }).strict(),
  rfb: z.object({ clientPolicy: z.enum(['passthrough', 'read-only-filter']),
    // Only the read-only filter constrains negotiation and parses client packets.
    versions: z.array(z.string()).optional(), securityType: z.literal(1).optional(),
    clientMessageTypes: z.array(z.number().int()).optional(), maxPendingBytes: z.number().int().optional(),
    maxEncodings: z.number().int().optional(), maxFencePayloadBytes: z.number().int().optional(),
    fenceFlagsMask: z.number().int().optional(), strippedEncoding: z.number().int().optional(),
  }).strict().optional(),
}).strict();
export type SocketContract = z.infer<typeof socketContractSchema>;
export const socketContracts: Readonly<Record<SocketChannel, SocketContract>> = Object.fromEntries(socketChannels.map(/**
 * 中文功能：为每个已声明通道构造编码、消息方向、认证描述和结束原因的契约条目。
 * English: Build each declared channel's encoding, message directions, authentication description and termination-reason contract entry.
 * 输入 / Inputs: channel 为 socketChannels 中的一个通道 ID / one channel ID from socketChannels.
 * 结果与影响：返回 [channel, contract] 元组供 Object.fromEntries 汇总；JSON 通道附带消息 Schema 描述，桌面通道附带 RFB 策略。此处只生成元数据，不执行连接准入。
 * Result and effects: Return a [channel, contract] tuple for Object.fromEntries, with message schemas for JSON channels and RFB policy for desktop channels. This builds metadata and does not perform connection admission.
 * 设计思路：集中按通道决定双向/只读差异和生命周期原因，避免各使用方自行猜测；桌面消息保留有序二进制流语义，desktop 使用透传策略，desktop-view 使用只读过滤策略，其余通道由对应 JSON Schema 表达消息形状。
 * Design: Centralize channel-specific interactive/read-only behavior and lifecycle reasons so consumers do not infer them independently. Desktop traffic retains ordered binary-stream semantics: desktop uses passthrough, desktop-view uses read-only filtering, and other channels describe messages with their JSON schemas.
 */ channel => {
  const binary = channel === 'desktop' || channel === 'desktop-view';
  return [channel, { version: 1, encoding: binary ? 'binary' : 'json', protocol: binary ? 'rfb-3.7-or-3.8' : 'sakura-json-v1',
    framing: binary ? 'byte-stream' : 'message', clientMaxBytes: SOCKET_CLIENT_BYTES, serverMaxBytes: SOCKET_SERVER_BYTES,
    clientMessages: binary ? ['rfb-stream'] : channel === 'terminal' ? ['input', 'resize'] : [],
    serverMessages: binary ? ['rfb-stream'] : channel === 'events' ? ['change'] : channel === 'logs' ? ['data'] : ['ready', 'data', 'error', 'exit'],
    readOnly: channel !== 'terminal' && channel !== 'desktop',
    authentication: { credential: 'query.token', sameOrigin: true, session: 'unlocked', local: 'controller-token',
      accountRoles: channel === 'terminal-view' ? ['viewer'] : channel === 'desktop-view' ? ['owner', 'viewer'] : ['owner'],
      viewerGrant: channel === 'terminal-view' ? 'terminal' : channel === 'desktop-view' ? 'vm' : 'none' },
    lifecycle: { upgrade: socketUpgradeStatuses, errorMessage: binary ? 'rfb-stream' :
      channel === 'terminal' || channel === 'terminal-view' ? 'terminal-error' : 'none',
      closeReasons: ['messageTooLarge', 'unsupportedMessageType', 'pluginRevoked',
        ...(channel === 'events' ? [] : ['incidentLockdown']),
        ...(binary ? ['binaryRfbRequired', 'desktopUnavailable'] : ['slowConsumer', 'invalidServerMessage',
          ...(channel === 'terminal' ? ['invalidMessage', 'invalidTerminalInput'] : ['readOnlyChannel']),
          ...(channel === 'terminal-view' ? ['readOnlyTerminal'] : [])])],
      emptyClose: ['host-shutdown', ...(binary ? ['ssh-close-or-error', 'rfb-stream-close-or-error'] :
        channel === 'terminal' || channel === 'terminal-view' ? ['terminal-setup-failure', 'ssh-close', 'terminal-exit'] : [])],
      terminate: ['session-lock', 'connection-reset', 'account-or-credential-revoked', 'account-expired', 'admission-failed',
        ...(channel === 'terminal-view' ? ['terminal-grant-revoked-or-expired'] : []),
        ...(binary ? ['desktop-session-invalidated'] : [])], replay: false },
    ...(binary ? { rfb: channel === 'desktop' ? { clientPolicy: 'passthrough' } : readOnlyRfbPolicy } : {}),
    ...(!binary ? { clientSchema: z.toJSONSchema(socketFrameSchemas[channel as keyof typeof socketFrameSchemas].client),
      serverSchema: z.toJSONSchema(socketFrameSchemas[channel as keyof typeof socketFrameSchemas].server) } : {}) }];
})) as Record<SocketChannel, SocketContract>;

/**
 * 中文：按 JSON 通道解析文本并用该通道 client Schema 校验，类型重载返回对应消息；desktop/desktop-view 明确拒绝，因为 RFB 使用二进制流而非 JSON 帧。
 * English: Parse text by JSON channel and validate with its client Schema, using typed overloads for corresponding messages. Explicitly reject desktop/desktop-view because RFB uses binary streams rather than JSON frames.
 * 中文：输入：channel：签名所示 C 业务值；text：待处理的文本内容
 * English: Inputs: channel: the C domain value in the signature; text: text content to process
 * 中文：结果：C extends JsonSocketChannel ? SocketClientMessage<C> : never；调用者依赖此类型约定
 * English: Result: C extends JsonSocketChannel ? SocketClientMessage<C> : never; callers depend on this type contract
 */
export function parseSocketInput<C extends SocketChannel>(channel: C, text: string):
  C extends JsonSocketChannel ? SocketClientMessage<C> : never;
/**
 * 中文：按 JSON 通道解析文本并用该通道 client Schema 校验，类型重载返回对应消息；desktop/desktop-view 明确拒绝，因为 RFB 使用二进制流而非 JSON 帧。
 * English: Parse text by JSON channel and validate with its client Schema, using typed overloads for corresponding messages. Explicitly reject desktop/desktop-view because RFB uses binary streams rather than JSON frames.
 * 中文：输入：channel：签名所示 SocketChannel 业务值；text：待处理的文本内容
 * English: Inputs: channel: the SocketChannel domain value in the signature; text: text content to process
 * 中文：拒绝原因：Desktop uses binary RFB frames。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: Desktop uses binary RFB frames. These errors reach the direct caller or this function's catch handler
 */
export function parseSocketInput(channel: SocketChannel, text: string) {
  if (channel === 'desktop' || channel === 'desktop-view') throw new Error('Desktop uses binary RFB frames');
  return socketFrameSchemas[channel].client.parse(JSON.parse(text));
}
/**
 * 中文：按指定 JSON 通道的 server Schema 校验后编码输出，拒绝桌面二进制通道和无效消息，不直接 stringify 未校验数据。
 * English: Validate with the JSON channel's server Schema before encoding output, rejecting desktop binary channels/invalid messages rather than stringifying unchecked data.
 * 中文：输入：channel：签名所示 SocketChannel 业务值；value：待校验、转换或保存的输入值
 * English: Inputs: channel: the SocketChannel domain value in the signature; value: input value to validate/transform/save
 * 中文：结果：string，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: string carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：Desktop uses binary RFB frames。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: Desktop uses binary RFB frames. These errors reach the direct caller or this function's catch handler
 */
export function encodeSocketOutput(channel: SocketChannel, value: unknown): string {
  if (channel === 'desktop' || channel === 'desktop-view') throw new Error('Desktop uses binary RFB frames');
  return JSON.stringify(socketFrameSchemas[channel].server.parse(value));
}
