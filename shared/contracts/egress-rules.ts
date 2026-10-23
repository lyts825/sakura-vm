/** 有限出站只接受明确 IPv4、协议和端口，不隐式授权 DNS 或重定向目标。 */
import { z } from 'zod';
export const egressDestinationSchema = z.object({
  address: z.ipv4(), protocol: z.enum(['tcp', 'udp']), port: z.number().int().min(1).max(65535),
}).strict();
export const egressInputSchema = z.object({
  vmId: z.uuid(), owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$/),
  destinations: z.array(egressDestinationSchema).min(1).max(32), expiresAt: z.iso.datetime(),
}).strict();
export const egressPlanSchema = egressInputSchema.extend({
  id: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(), approveBefore: z.iso.datetime(),
  vmCreatedAt: z.string(), startedAt: z.string(), bootId: z.uuid(),
  state: z.enum(['planned', 'installing', 'active', 'revoked', 'expired', 'unknown']),
  ruleDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(), observedAt: z.iso.datetime().nullable(),
  isolated: z.boolean().nullable(), reason: z.string().max(2000),
}).strict();
export type EgressInput = z.infer<typeof egressInputSchema>;
export type EgressPlan = z.infer<typeof egressPlanSchema>;
