/**
 * 模块职责：使用 Windows 用户保护保存私密配置，解析引用并为日志提供值级脱敏。
 * Module purpose: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
 */
import { hostExecFile } from './host-process.ts';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { checkedId } from '../shared/paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { readStore, writeStore } from './local-store.ts';
import { rotationPolicySchema, secretRotation, type RotationPolicy } from './secret-rotation.ts';

export const secretName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,59}$/);
export const secretRefsSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), secretName)
  .refine((value) => Object.keys(value).length <= 32, '最多引用 32 个私密配置');
type SecretRecord = {
  name: string;
  ciphertext: string;
  revision?: string;
  updatedAt: string;
  lastChangedAt?: string;
  rotation?: RotationPolicy;
};
/**
 * 签名 / Signature: Protector.Protector.
 * 功能：为使用 Windows 用户保护保存私密配置声明 Protector 的输入与结果契约，所属容器为 Protector。
 * Purpose: Declares the input/result contract for Protector in Protector. Module responsibility: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
 * 输入 / Inputs: operation: 'protect' | 'unprotect'; value: string
 * 输出 / Returns: Promise<string>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type Protector = (operation: 'protect' | 'unprotect', value: string) => Promise<string>;
const dpapiScript = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $request=[Console]::In.ReadToEnd() | ConvertFrom-Json; $bytes=[Convert]::FromBase64String($request.value); $entropy=[Text.Encoding]::UTF8.GetBytes('Sakura private configuration v1'); $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser; if ($request.operation -eq 'protect') { $result=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,$scope) } else { $result=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,$scope) }; [Console]::Out.Write([Convert]::ToBase64String($result))`;
/**
 * 入口 / Entry: dpapi.
 * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result.stdout.trim()` 供上层消费（`secrets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `secrets.ts`; this entry produces `result.stdout.trim()` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
 * 处理：通过 `join`, `hostExecFile`, `result.stdout.trim` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `hostExecFile`, `result.stdout.trim`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: operation; value
 * 输出 / Returns: `result.stdout.trim()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `process.platform !== 'win32'`; `cause instanceof AppError && cause.status === 503`; 异常 / errors `new AppError('私密配置需要 Windows 用户账户保护')`; `cause`.
 * 失败处理：catch 分支执行 `if (cause instanceof AppError && cause.status === 503) throw cause;`; `throw new AppError('无法解密或保护配置，请使用创建它的 Windows 账户');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (cause instanceof AppError && cause.status === 503) throw cause;`; `throw new AppError('无法解密或保护配置，请使用创建它的 Windows 账户');`; these statements determine whether a failure is absorbed or rejected again.
 */
export const dpapi: Protector = async (operation, value) => {
  if (process.platform !== 'win32') throw new AppError('私密配置需要 Windows 用户账户保护');
  const processPath = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  );
  try {
    const result = await hostExecFile(
      'dpapi',
      processPath,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', dpapiScript],
      { timeout: 15000, maxBuffer: 65536, input: JSON.stringify({ operation, value }) },
    );
    return result.stdout.trim();
  } catch (cause) {
    if (cause instanceof AppError && cause.status === 503) throw cause;
    throw new AppError('无法解密或保护配置，请使用创建它的 Windows 账户');
  }
};
export const secretRotationRequest = z.object({ name: secretName, policy: rotationPolicySchema }).strict();

export const secretSaveRequest = z
      .object({ name: secretName, value: z.string().min(1).max(8192) })
      .strict();

export class Secrets {
  /**
   * 入口 / Entry: Secrets.constructor.
   * 功能：建立 Secrets 的使用 Windows 用户保护保存私密配置上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Secrets context for this module's responsibility: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; protect: Protector default=dpapi; directory: default=join(DATA, 'secrets')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private protect: Protector = dpapi,
    private directory = join(DATA, 'secrets'),
  ) {}
  /**
   * 入口 / Entry: Secrets.file.
   * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(this.directory, checkedId(id) + '.json')` 供上层消费（`Secrets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Secrets`; this entry produces `join(this.directory, checkedId(id) + '.json')` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `this.machines.get`, `join`, `checkedId` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `join`, `checkedId`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `join(this.directory, checkedId(id) + '.json')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private file(id: string) {
    this.machines.get(id);
    return join(this.directory, checkedId(id) + '.json');
  }
  /**
   * 入口 / Entry: Secrets.records.
   * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `readStore<SecretRecord[]>(this.file(id), () => [])` 供上层消费（`Secrets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Secrets`; this entry produces `readStore<SecretRecord[]>(this.file(id), () => [])` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `readStore`, `this.file` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `this.file`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `readStore<SecretRecord[]>(this.file(id), () => [])`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private records(id: string) {
    return readStore<SecretRecord[]>(this.file(id), () => []);
  }
  /**
   * 入口 / Entry: Secrets.list.
   * 功能：在使用 Windows 用户保护保存私密配置中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `(await this.records(id)).map(({ name, updatedAt }) => ({ name, updatedAt }))` 供上层消费（`Secrets`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Secrets`; this entry produces `(await this.records(id)).map(({ name, updatedAt }) => ({ name, updatedAt }))` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `inline.map`, `this.records` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `this.records`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `(await this.records(id)).map(({ name, updatedAt }) => ({ name, updatedAt }))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async list(id: string) {
    return (await this.records(id)).map(({ name, updatedAt }) => ({ name, updatedAt }));
  }
  /**
   * 入口 / Entry: Secrets.rotation.
   * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(await this.records(id)).map((item) => secretRotation(item.name, item.lastChangedAt || item.updatedAt, item.rotation), )` 供上层消费（`Secrets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Secrets`; this entry produces `(await this.records(id)).map((item) => secretRotation(item.name, item.lastChangedAt || item.updatedAt, item.rotation), )` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `inline.map`, `this.records` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `this.records`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `(await this.records(id)).map((item) => secretRotation(item.name, item.lastChangedAt || item.updatedAt, item.rotation), )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async rotation(id: string) {
    return (await this.records(id)).map((item) =>
      secretRotation(item.name, item.lastChangedAt || item.updatedAt, item.rotation),
    );
  }
  /**
   * 入口 / Entry: Secrets.setRotation.
   * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.locked(`secrets:${id}`, async () => { const records = await this.records(id), item = records.find((record) => r…` 供上层消费（`Secrets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Secrets`; this entry produces `this.machines.locked(`secrets:${id}`, async () => { const records = await this.records(id), item = records.find((record) => r…` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `secretRotationRequest.parse`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `secretRotationRequest.parse`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.machines.locked(`secrets:${id}`, async () => { const records = await this.records(id), item = records.find((record) => r…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async setRotation(id: string, input: unknown) {
    const value = secretRotationRequest.parse(input);
    /**
     * 入口 / Entry: Secrets.setRotation.callback@75.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.rotation(id)`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `item.rotation`.
     * 拒绝 / Refusals: 条件 / conditions `!item`; 异常 / errors `new AppError('私密配置不存在', 404)`.
     */
    return this.machines.locked(`secrets:${id}`, async () => {
      const records = await this.records(id),
        item = records.find((record) => record.name === value.name);
      if (!item) throw new AppError('私密配置不存在', 404);
      item.rotation = value.policy;
      await writeStore(this.file(id), records);
      return this.rotation(id);
    });
  }
  /**
   * 入口 / Entry: Secrets.save.
   * 功能：在使用 Windows 用户保护保存私密配置中，校验并提交领域状态变更；本入口产生 `this.machines.locked(`secrets:${id}`, async () => { const records = await this.records(id); if (records.length >= 64 && !reco…` 供上层消费（`Secrets`）。
   * Purpose: Validates and commits a domain state change in `Secrets`; this entry produces `this.machines.locked(`secrets:${id}`, async () => { const records = await this.records(id); if (records.length >= 64 && !reco…` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `secretSaveRequest.parse`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `secretSaveRequest.parse`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.machines.locked(`secrets:${id}`, async () => { const records = await this.records(id); if (records.length >= 64 && !reco…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async save(id: string, input: unknown) {
    const value = secretSaveRequest
      .parse(input);
    /**
     * 入口 / Entry: Secrets.save.callback@87.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.list(id)`.
     * 副作用 / Effects: `writeStore`.
     * 拒绝 / Refusals: 条件 / conditions `records.length >= 64 && !records.some((item) => item.name === value.name)`; 异常 / errors `new AppError('最多保存 64 个私密配置')`.
     */
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
          revision: randomUUID(),
          updatedAt: now,
          lastChangedAt: unchanged ? previous.lastChangedAt || previous.updatedAt : now,
          ...(previous?.rotation ? { rotation: previous.rotation } : {}),
        },
      ]);
      return this.list(id);
    });
  }
  /**
   * 入口 / Entry: Secrets.remove.
   * 功能：在使用 Windows 用户保护保存私密配置中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.machines.locked(`secrets:${id}`, async () => { await writeStore( this.file(id), (await this.records(id)).filter((item) =…` 供上层消费（`Secrets`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Secrets`; this entry produces `this.machines.locked(`secrets:${id}`, async () => { await writeStore( this.file(id), (await this.records(id)).filter((item) =…` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `secretName.parse`, `this.machines.locked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `secretName.parse`, `this.machines.locked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `this.machines.locked(`secrets:${id}`, async () => { await writeStore( this.file(id), (await this.records(id)).filter((item) =…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: Secrets.value.
   * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Buffer.from(await this.protect('unprotect', item.ciphertext), 'base64').toString('utf8')` 供上层消费（`Secrets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Secrets`; this entry produces `Buffer.from(await this.protect('unprotect', item.ciphertext), 'base64').toString('utf8')` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `inline.find`, `this.records`, `this.protect` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.find`, `this.records`, `this.protect`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; name: string
   * 输出 / Returns: `Buffer.from(await this.protect('unprotect', item.ciphertext), 'base64').toString('utf8')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!item`; 异常 / errors `new AppError(`缺少私密配置：${name}`)`.
   */
  async value(id: string, name: string) {
    const item = (await this.records(id)).find((value) => value.name === secretName.parse(name));
    if (!item) throw new AppError(`缺少私密配置：${name}`);
    return Buffer.from(await this.protect('unprotect', item.ciphertext), 'base64').toString('utf8');
  }
  /**
   * 入口 / Entry: Secrets.resolve.
   * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.fromEntries( await Promise.all( Object.entries(secretRefsSchema.parse(refs)).map(async ([key, name]) => [ key, await t…` 供上层消费（`Secrets`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Secrets`; this entry produces `Object.fromEntries( await Promise.all( Object.entries(secretRefsSchema.parse(refs)).map(async ([key, name]) => [ key, await t…` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
   * 处理：通过 `Promise.all`, `secretRefsSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `secretRefsSchema.parse`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; refs: Record<string, string> default={}
   * 输出 / Returns: `Object.fromEntries( await Promise.all( Object.entries(secretRefsSchema.parse(refs)).map(async ([key, name]) => [ key, await t…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

  /** 返回不含秘密值的强内容版本；旧记录使用受保护密文的域分隔摘要。
   * Return an opaque reference version without decrypting the secret or hashing its plaintext. */
  async references(id: string, refs: Record<string, string> = {}) {
    const parsed = secretRefsSchema.parse(refs);
    return this.machines.locked(`secrets:${id}`, async () => {
      const records = await this.records(id);
      return Object.fromEntries(Object.entries(parsed).map(([key, name]) => {
        const item = records.find(record => record.name === name);
        if (!item) throw new AppError(`缺少私密配置：${name}`, 404);
        return [key, { name, version: this.referenceVersion(id, item) }];
      }));
    });
  }

  /** 在同一写锁内核对全部版本并解析；轮换、删除或重建使旧计划失效。
   * Check the complete reference set under the writer lock before resolving any protected values. */
  async resolveVersioned(id: string, refs: Record<string, string>, versions: Record<string, string>) {
    const parsed = secretRefsSchema.parse(refs);
    const expected = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).parse(versions);
    if (Object.keys(parsed).sort().join('\n') !== Object.keys(expected).sort().join('\n'))
      throw new AppError('私密配置引用集合已变化，请重新生成计划', 409, 'SECRET_REFERENCE_CHANGED');
    return this.machines.locked(`secrets:${id}`, async () => {
      const records = await this.records(id);
      const selected = Object.entries(parsed).map(([key, name]) => {
        const item = records.find(record => record.name === name);
        if (!item || this.referenceVersion(id, item) !== expected[key])
          throw new AppError('私密配置版本已变化，请重新生成计划', 409, 'SECRET_REFERENCE_CHANGED');
        return [key, item] as const;
      });
      const values: Record<string, string> = Object.create(null);
      for (const [key, item] of selected)
        values[key] = Buffer.from(await this.protect('unprotect', item.ciphertext), 'base64').toString('utf8');
      return values;
    });
  }

  /** 版本绑定 VM、引用名、写入修订和密文，防止同名替换沿用授权。
   * Bind versions to scope, reference name, write revision and protected bytes. */
  private referenceVersion(id: string, item: SecretRecord) {
    return createHash('sha256')
      .update(JSON.stringify(['sakura-secret-reference-v1', id, item.name, item.revision ?? null, item.ciphertext]))
      .digest('hex');
  }
}
/**
 * 入口 / Entry: redactValues.
 * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `text` 供上层消费（`secrets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `secrets.ts`; this entry produces `text` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
 * 处理：通过 `inline.filter().sort`, `inline.filter`, `text.split().join`, `text.split` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.filter().sort`, `inline.filter`, `text.split().join`, `text.split`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string; values: string[]
 * 输出 / Returns: `text`.
 * 副作用 / Effects: 更新 / updates `text`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function redactValues(text: string, values: string[]) {
  for (const value of [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.split(value).join('[私密配置已隐藏]');
  return text;
}
/**
 * 入口 / Entry: privateLog.
 * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ write(text: string) { pending += text; let cut = Math.max(0, pending.length - length); for (const secret of secrets) { let …` 供上层消费（`secrets.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `secrets.ts`; this entry produces `{ write(text: string) { pending += text; let cut = Math.max(0, pending.length - length); for (const secret of secrets) { let …` for its caller. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
 * 处理：通过 `inline.filter`, `secrets.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.filter`, `secrets.map`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: log: (text: string) => void; values: string[]
 * 输出 / Returns: `{ write(text: string) { pending += text; let cut = Math.max(0, pending.length - length); for (const secret of secrets) { let …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function privateLog(log: (text: string) => void, values: string[]) {
  const secrets = [...new Set(values)].filter(Boolean);
  const length = Math.max(1, ...secrets.map((value) => value.length));
  let pending = '';
  return {
    /**
     * 入口 / Entry: privateLog.write.
     * 功能：在使用 Windows 用户保护保存私密配置中，校验并提交领域状态变更；完成下述调用及状态处理（`secrets.ts`）。
     * Purpose: Validates and commits a domain state change in `secrets.ts`; the calls and state transitions below complete the operation. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
     * 处理：通过 `pending.indexOf`, `log`, `redactValues`, `pending.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `pending.indexOf`, `log`, `redactValues`, `pending.slice`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `index + secret.length > cut`; `cut`.
     * 输入 / Inputs: text: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `pending`, `cut`, `index`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: privateLog.flush.
     * 功能：在使用 Windows 用户保护保存私密配置中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`secrets.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `secrets.ts`; the calls and state transitions below complete the operation. Module context: Protects secrets with the Windows user account, resolves references and redacts resolved values from logs.
     * 处理：通过 `log`, `redactValues` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `log`, `redactValues`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `pending`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `pending`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    flush() {
      if (pending) log(redactValues(pending, secrets));
      pending = '';
    },
  };
}
