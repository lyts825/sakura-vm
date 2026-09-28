import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { AccessControl, type Principal } from './access-control.ts';
import { AppError } from './model.ts';

const ceremonyId = z.string().regex(/^[a-f0-9]{64}$/);
const browserCredential = z.object({ id: z.string().min(16).max(1024) }).passthrough();
export const passkeyRegisterStart = z.object({
  password: z.string().max(256), name: z.string().trim().min(1).max(64),
}).strict();
export const passkeyFinish = z.object({ ceremonyId, response: browserCredential }).strict();
export const passkeyRemove = z.object({ password: z.string().max(256) }).strict();

type Ceremony = { challenge: string; expiresAt: number; accountId?: string; name?: string };

/** Short-lived, one-use WebAuthn ceremonies bound to this local service process. */
export class Passkeys {
  private ceremonies = new Map<string, Ceremony>();
  private readonly rpID = 'localhost';
  private readonly origin: string;
  constructor(private access: AccessControl, port: number, private now = Date.now) {
    this.origin = `http://localhost:${port}`;
  }

  private remember(ceremony: Ceremony) {
    for (const [id, entry] of this.ceremonies)
      if (entry.expiresAt <= this.now()) this.ceremonies.delete(id);
    if (this.ceremonies.size >= 128) throw new AppError('通行密钥请求过多，请稍后重试', 429);
    const id = randomBytes(32).toString('hex');
    this.ceremonies.set(id, ceremony);
    return id;
  }

  private take(id: string, accountId?: string) {
    const entry = this.ceremonies.get(ceremonyId.parse(id));
    this.ceremonies.delete(id);
    if (!entry || entry.expiresAt <= this.now() || entry.accountId !== accountId)
      throw new AppError('通行密钥请求已失效，请重新开始', 409);
    return entry;
  }

  async beginRegistration(principal: Principal, input: unknown) {
    const value = passkeyRegisterStart.parse(input);
    const proof = await this.access.login({ username: principal.username, password: value.password });
    this.access.logout(proof.token);
    const existing = this.access.registeredPasskeysFor(principal.id);
    if (existing.length >= 10) throw new AppError('每个账户最多登记 10 把通行密钥', 409);
    const options = await generateRegistrationOptions({
      rpName: 'Sakura', rpID: this.rpID, userName: principal.username,
      userDisplayName: principal.username,
      userID: Buffer.from(principal.id.replaceAll('-', ''), 'hex'),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: existing.map((item) => ({ id: item.id, transports: item.transports })),
    });
    return { ceremonyId: this.remember({ challenge: options.challenge,
      expiresAt: this.now() + 5 * 60_000, accountId: principal.id, name: value.name }), options };
  }

  async finishRegistration(principal: Principal, input: unknown) {
    const value = passkeyFinish.parse(input);
    const ceremony = this.take(value.ceremonyId, principal.id);
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: value.response as unknown as RegistrationResponseJSON,
        expectedChallenge: ceremony.challenge, expectedOrigin: this.origin,
        expectedRPID: this.rpID, requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch { throw new AppError('通行密钥登记验证失败', 403); }
    if (!verified.verified || verified.registrationInfo.credential.id !== value.response.id)
      throw new AppError('通行密钥登记验证失败', 403);
    const key = verified.registrationInfo.credential;
    return this.access.addPasskey(principal.id, {
      id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'),
      counter: key.counter, transports: key.transports || [],
      name: ceremony.name, createdAt: new Date(this.now()).toISOString(),
    });
  }

  async beginAuthentication() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID, userVerification: 'required',
    });
    return { ceremonyId: this.remember({ challenge: options.challenge,
      expiresAt: this.now() + 5 * 60_000 }), options };
  }

  async finishAuthentication(input: unknown) {
    const value = passkeyFinish.parse(input);
    const ceremony = this.take(value.ceremonyId);
    const registered = this.access.getPasskey(value.response.id);
    if (!registered) throw new AppError('通行密钥验证失败', 403);
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: value.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: ceremony.challenge, expectedOrigin: this.origin,
        expectedRPID: this.rpID, requireUserVerification: true,
        credential: {
          id: registered.key.id,
          publicKey: new Uint8Array(Buffer.from(registered.key.publicKey, 'base64url')),
          counter: registered.key.counter, transports: registered.key.transports,
        },
      });
    } catch { throw new AppError('通行密钥验证失败', 403); }
    if (!verified.verified) throw new AppError('通行密钥验证失败', 403);
    return this.access.completePasskeyLogin(registered.user.id, registered.key.id,
      registered.key.counter, verified.authenticationInfo.newCounter);
  }

  close() { this.ceremonies.clear(); }
}
