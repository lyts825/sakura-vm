import { X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { createSecureContext } from 'node:tls';
import { generate } from 'selfsigned';
import { z } from 'zod';
import {
  certificateActionSchema,
  certificatePolicySchema,
  type CertificatePolicy,
  type CertificateView,
} from '../shared/ingress-certificates.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';

const certificateSchema = z
  .object({
    key: z.string().min(100).max(16000),
    cert: z.string().min(100).max(16000),
    generatedAt: z.string().datetime(),
  })
  .strict();
const stateSchema = z
  .object({
    policy: certificatePolicySchema,
    certificate: certificateSchema.nullable(),
  })
  .strict();
type Certificate = z.infer<typeof certificateSchema>;
type State = z.infer<typeof stateSchema>;
const defaults = (): State => ({ policy: { autoRotate: true, renewBeforeDays: 30 }, certificate: null });

function inspect(certificate: Certificate) {
  createSecureContext({ key: certificate.key, cert: certificate.cert });
  const parsed = new X509Certificate(certificate.cert);
  if (parsed.checkHost('localhost') !== 'localhost' || parsed.checkIP('127.0.0.1') !== '127.0.0.1')
    throw new AppError('入口证书不包含 localhost 和 127.0.0.1', 409);
  return parsed;
}

function rotationAt(certificate: Certificate, policy: CertificatePolicy) {
  return new Date(Date.parse(inspect(certificate).validTo) - policy.renewBeforeDays * 86400000);
}

export class IngressCertificates {
  private state: State = defaults();
  private listeners = new Set<(certificate: Certificate) => void>();
  private pending = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private closed = false;
  private rotationError?: string;

  constructor(private file = join(DATA, 'plugins', 'network', 'certificates.json')) {}

  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (this.state.certificate) inspect(this.state.certificate);
    if (
      this.state.policy.autoRotate &&
      this.state.certificate &&
      rotationAt(this.state.certificate, this.state.policy).getTime() <= Date.now()
    )
      await this.rotate().catch((error) => {
        this.rotationError = (error as Error).message;
      });
    this.timer = setInterval(() => {
      const certificate = this.state.certificate;
      if (
        this.state.policy.autoRotate &&
        certificate &&
        rotationAt(certificate, this.state.policy).getTime() <= Date.now()
      )
        void this.rotate().catch((error) => {
          this.rotationError = (error as Error).message;
        });
    }, 3600000);
    this.timer.unref();
  }

  view(): CertificateView {
    const certificate = this.state.certificate;
    const parsed = certificate && inspect(certificate);
    return {
      policy: { ...this.state.policy },
      certificate:
        certificate && parsed
          ? {
              pem: certificate.cert,
              fingerprint256: parsed.fingerprint256,
              validFrom: parsed.validFrom,
              validTo: parsed.validTo,
              generatedAt: certificate.generatedAt,
            }
          : null,
      nextRotationAt:
        certificate && this.state.policy.autoRotate
          ? rotationAt(certificate, this.state.policy).toISOString()
          : null,
      ...(this.rotationError ? { rotationError: this.rotationError } : {}),
    };
  }

  tlsOptions() {
    const certificate = this.state.certificate;
    if (!certificate) throw new AppError('请先生成入口证书', 409);
    if (Date.parse(inspect(certificate).validTo) <= Date.now())
      throw new AppError('入口证书已过期，请轮换证书', 409);
    return { key: certificate.key, cert: certificate.cert };
  }

  onChange(listener: (certificate: Certificate) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async ensure() {
    return this.serial(async () => {
      const certificate = this.state.certificate;
      if (
        !certificate ||
        (this.state.policy.autoRotate && rotationAt(certificate, this.state.policy).getTime() <= Date.now())
      )
        await this.issue(this.state.policy);
      return this.tlsOptions();
    });
  }

  async action(input: unknown): Promise<CertificateView> {
    const action = certificateActionSchema.parse(input);
    return this.serial(async () => {
      if (action.action === 'rotate') await this.issue(this.state.policy);
      else {
        const policy = action.policy;
        if (
          policy.autoRotate &&
          this.state.certificate &&
          rotationAt(this.state.certificate, policy).getTime() <= Date.now()
        )
          await this.issue(policy);
        else {
          const next = { ...this.state, policy };
          await writeStore(this.file, next);
          this.state = next;
        }
      }
      return this.view();
    });
  }

  rotate() {
    return this.serial(async () => {
      await this.issue(this.state.policy);
      return this.view();
    });
  }

  private serial<T>(work: () => Promise<T>) {
    const operation = this.pending
      .catch(() => {})
      .then(async () => {
        if (this.closed) throw new AppError('证书服务正在关闭', 503);
        return work();
      });
    this.pending = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  private async issue(policy: CertificatePolicy) {
    const before = new Date(Date.now() - 3600000);
    const after = new Date(Date.now() + 365 * 86400000);
    const generated = await generate([{ name: 'commonName', value: 'localhost' }], {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate: before,
      notAfterDate: after,
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    });
    const certificate: Certificate = {
      key: generated.private,
      cert: generated.cert,
      generatedAt: new Date().toISOString(),
    };
    inspect(certificate);
    const previous = this.state.certificate;
    try {
      for (const listener of this.listeners) listener(certificate);
      const next = { policy, certificate };
      await writeStore(this.file, next);
      this.state = next;
      this.rotationError = undefined;
    } catch (error) {
      if (previous) for (const listener of this.listeners) listener(previous);
      throw error;
    }
  }

  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    this.listeners.clear();
  }
}
