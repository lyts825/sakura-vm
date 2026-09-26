import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA, checkedId } from './model.ts';
import type { Machines } from './machines.ts';
import { readStore, writeStore } from './local-store.ts';
import { rotationPolicySchema, secretRotation, type RotationPolicy } from './secret-rotation.ts';

export const secretName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,59}$/);
export const secretRefsSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), secretName)
  .refine((value) => Object.keys(value).length <= 32, '最多引用 32 个私密配置');
type SecretRecord = {
  name: string;
  ciphertext: string;
  updatedAt: string;
  lastChangedAt?: string;
  rotation?: RotationPolicy;
};
export type Protector = (operation: 'protect' | 'unprotect', value: string) => Promise<string>;
const dpapiScript = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $request=[Console]::In.ReadToEnd() | ConvertFrom-Json; $bytes=[Convert]::FromBase64String($request.value); $entropy=[Text.Encoding]::UTF8.GetBytes('Sakura private configuration v1'); $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser; if ($request.operation -eq 'protect') { $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,$scope) } else { $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,$scope) }; [Console]::Out.Write([Convert]::ToBase64String($result))`;
export const dpapi: Protector = async (operation, value) => {
  if (process.platform !== 'win32') throw new AppError('私密配置需要 Windows 用户账户保护');
  return new Promise((resolve, reject) => {
    const processPath = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const child = spawn(processPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', dpapiScript], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new AppError('Windows 数据保护超时'));
    }, 15000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(output.trim());
    };
    child.on('error', () => finish(new AppError('无法调用 Windows 数据保护')));
    child.stdin.on('error', () => finish(new AppError('无法传递数据给 Windows 数据保护')));
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.length > 65536) {
        child.kill();
        finish(new AppError('数据保护响应过大'));
      }
    });
    child.stderr.resume();
    child.on('close', (code) =>
      finish(code === 0 ? undefined : new AppError('无法解密或保护配置，请使用创建它的 Windows 账户')),
    );
    child.stdin.end(JSON.stringify({ operation, value }));
  });
};
export class Secrets {
  constructor(
    private machines: Machines,
    private protect: Protector = dpapi,
    private directory = join(DATA, 'secrets'),
  ) {}
  private file(id: string) {
    this.machines.get(id);
    return join(this.directory, checkedId(id) + '.json');
  }
  private records(id: string) {
    return readStore<SecretRecord[]>(this.file(id), () => []);
  }
  async list(id: string) {
    return (await this.records(id)).map(({ name, updatedAt }) => ({ name, updatedAt }));
  }
  async rotation(id: string) {
    return (await this.records(id)).map((item) =>
      secretRotation(item.name, item.lastChangedAt || item.updatedAt, item.rotation),
    );
  }
  async setRotation(id: string, input: unknown) {
    const value = z.object({ name: secretName, policy: rotationPolicySchema }).strict().parse(input);
    return this.machines.locked(`secrets:${id}`, async () => {
      const records = await this.records(id),
        item = records.find((record) => record.name === value.name);
      if (!item) throw new AppError('私密配置不存在', 404);
      item.rotation = value.policy;
      await writeStore(this.file(id), records);
      return this.rotation(id);
    });
  }
  async save(id: string, input: unknown) {
    const value = z
      .object({ name: secretName, value: z.string().min(1).max(8192) })
      .strict()
      .parse(input);
    return this.machines.locked(`secrets:${id}`, async () => {
      const records = await this.records(id);
      if (records.length >= 64 && !records.some((item) => item.name === value.name))
        throw new AppError('最多保存 64 个私密配置');
      const previous = records.find((item) => item.name === value.name);
      const unchanged =
        previous &&
        Buffer.from(await this.protect('unprotect', previous.ciphertext), 'base64').toString('utf8') ===
          value.value;
      const now = new Date(Date.now()).toISOString();
      const ciphertext = await this.protect('protect', Buffer.from(value.value).toString('base64'));
      await writeStore(this.file(id), [
        ...records.filter((item) => item.name !== value.name),
        {
          name: value.name,
          ciphertext,
          updatedAt: now,
          lastChangedAt: unchanged ? previous.lastChangedAt || previous.updatedAt : now,
          ...(previous?.rotation ? { rotation: previous.rotation } : {}),
        },
      ]);
      return this.list(id);
    });
  }
  async remove(id: string, name: string) {
    secretName.parse(name);
    return this.machines.locked(`secrets:${id}`, async () => {
      await writeStore(
        this.file(id),
        (await this.records(id)).filter((item) => item.name !== name),
      );
      return this.list(id);
    });
  }
  async value(id: string, name: string) {
    const item = (await this.records(id)).find((value) => value.name === secretName.parse(name));
    if (!item) throw new AppError(`缺少私密配置：${name}`);
    return Buffer.from(await this.protect('unprotect', item.ciphertext), 'base64').toString('utf8');
  }
  async resolve(id: string, refs: Record<string, string> = {}) {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(secretRefsSchema.parse(refs)).map(async ([key, name]) => [
          key,
          await this.value(id, name),
        ]),
      ),
    );
  }
}
export function redactValues(text: string, values: string[]) {
  for (const value of [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.split(value).join('[私密配置已隐藏]');
  return text;
}
export function privateLog(log: (text: string) => void, values: string[]) {
  const secrets = [...new Set(values)].filter(Boolean);
  const length = Math.max(1, ...secrets.map((value) => value.length));
  let pending = '';
  return {
    write(text: string) {
      pending += text;
      let cut = Math.max(0, pending.length - length);
      for (const secret of secrets) {
        let index = pending.indexOf(secret);
        while (index >= 0 && index < cut) {
          if (index + secret.length > cut) cut = index;
          index = pending.indexOf(secret, index + 1);
        }
      }
      if (cut) {
        log(redactValues(pending.slice(0, cut), secrets));
        pending = pending.slice(cut);
      }
    },
    flush() {
      if (pending) log(redactValues(pending, secrets));
      pending = '';
    },
  };
}
