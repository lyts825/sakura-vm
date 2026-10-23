export function publisherKey(publicKey: string): { id: string; publicKey: string };
export function signingPayload(envelope: Record<string, unknown>): string;
export function changePublisher(installation: string, input: unknown, check?: () => void | Promise<void>): Promise<void>;
export function trustedUpdateView(installation: string): Promise<unknown>;
export function checkTrustedUpdate(installation: string, source: string): Promise<{
  path: string; revision: number;
  manifest: { version: string; fingerprint: string; files: unknown[] };
  envelope: { sequence: number; expiresAt: string };
  publisher: { label: string; source: string };
}>;
export function activateTrustedUpdate(installation: string, input: unknown, check?: () => void | Promise<void>): Promise<unknown>;
export function rollbackTrustedUpdate(installation: string, input: unknown, check?: () => void | Promise<void>): Promise<unknown>;
export function stageTrustedUpdate(installation: string, input: unknown, options?: Record<string, unknown>): Promise<unknown>;
