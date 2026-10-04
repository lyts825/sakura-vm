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

/** Binary desktop messages are ordered RFB byte-stream fragments, not JSON or one packet per frame. */
export const socketContractSchema = z.object({
  version: z.literal(1), encoding: z.enum(['json', 'binary']), protocol: z.enum(['sakura-json-v1', 'rfb-3.7-or-3.8']),
  framing: z.enum(['message', 'byte-stream']), clientMaxBytes: z.number().int().positive(),
  serverMaxBytes: z.number().int().positive(), clientMessages: z.array(z.string()), serverMessages: z.array(z.string()),
  readOnly: z.boolean(),
  clientSchema: z.record(z.string(), jsonValueSchema).optional(), serverSchema: z.record(z.string(), jsonValueSchema).optional(),
}).strict();
export type SocketContract = z.infer<typeof socketContractSchema>;
export const socketContracts: Readonly<Record<SocketChannel, SocketContract>> = Object.fromEntries(socketChannels.map(channel => {
  const binary = channel === 'desktop' || channel === 'desktop-view';
  return [channel, { version: 1, encoding: binary ? 'binary' : 'json', protocol: binary ? 'rfb-3.7-or-3.8' : 'sakura-json-v1',
    framing: binary ? 'byte-stream' : 'message', clientMaxBytes: SOCKET_CLIENT_BYTES, serverMaxBytes: SOCKET_SERVER_BYTES,
    clientMessages: binary ? ['rfb-stream'] : channel === 'terminal' ? ['input', 'resize'] : [],
    serverMessages: binary ? ['rfb-stream'] : channel === 'events' ? ['change'] : channel === 'logs' ? ['data'] : ['ready', 'data', 'error', 'exit'],
    readOnly: channel !== 'terminal' && channel !== 'desktop',
    ...(!binary ? { clientSchema: z.toJSONSchema(socketFrameSchemas[channel as keyof typeof socketFrameSchemas].client),
      serverSchema: z.toJSONSchema(socketFrameSchemas[channel as keyof typeof socketFrameSchemas].server) } : {}) }];
})) as Record<SocketChannel, SocketContract>;

export function parseSocketInput(channel: SocketChannel, text: string) {
  if (channel === 'desktop' || channel === 'desktop-view') throw new Error('Desktop uses binary RFB frames');
  return socketFrameSchemas[channel].client.parse(JSON.parse(text));
}
export function encodeSocketOutput(channel: SocketChannel, value: unknown): string {
  if (channel === 'desktop' || channel === 'desktop-view') throw new Error('Desktop uses binary RFB frames');
  return JSON.stringify(socketFrameSchemas[channel].server.parse(value));
}
