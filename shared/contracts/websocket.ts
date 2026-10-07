/**
 * 模块职责：WebSocket 通道、帧 Schema、长度限制和关闭原因契约，统一升级准入与消息编解码。
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
export function closeSocket(socket: { close(code: number, reason: string): void }, reason: SocketCloseReason) {
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
export const socketContracts: Readonly<Record<SocketChannel, SocketContract>> = Object.fromEntries(socketChannels.map(channel => {
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

export function parseSocketInput<C extends SocketChannel>(channel: C, text: string):
  C extends JsonSocketChannel ? SocketClientMessage<C> : never;
export function parseSocketInput(channel: SocketChannel, text: string) {
  if (channel === 'desktop' || channel === 'desktop-view') throw new Error('Desktop uses binary RFB frames');
  return socketFrameSchemas[channel].client.parse(JSON.parse(text));
}
export function encodeSocketOutput(channel: SocketChannel, value: unknown): string {
  if (channel === 'desktop' || channel === 'desktop-view') throw new Error('Desktop uses binary RFB frames');
  return JSON.stringify(socketFrameSchemas[channel].server.parse(value));
}
