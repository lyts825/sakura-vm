/** 装配设备、挂载、可信启动和构建服务，保留各服务的降级与清理策略。
 * Compose device, mount, trusted-boot and build services with their existing degradation and cleanup policies. */
import { BuildFarm } from '../build-farm.ts';
import { GpuProfiles } from '../gpu-profiles.ts';
import { HostMounts } from '../host-mount.ts';
import { MediaDevices } from '../media-devices.ts';
import { MemoryReclaim } from '../memory-reclaim.ts';
import { DATA } from '../paths.ts';
import { join } from 'node:path';
import { TrustedBootService } from '../trusted-boot-service.ts';
import { UsbHotplug } from '../usb-hotplug.ts';
import { VirtioFsShares } from '../virtio-fs.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startPlatformServices(system: SystemServices) {

  const usbHotplug = await system.start({
    id: 'usbHotplug',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：从当前输入或状态计算 `new UsbHotplug( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenc…`，供调用方后续验证或使用。
     * Purpose: Computes `new UsbHotplug( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenc…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new UsbHotplug( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenc…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new UsbHotplug(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 220,
  });
  const mediaDevices = await system.start({
    id: 'mediaDevices',
    startup: 'required',
    requires: ['usbHotplug', '@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new MediaDevices( dependencies.vm(), dependencies.get('usbHotplug'), () => !!dependencies.get('@plugins').migration?.blocked,…` 供上层消费（`platform-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `platform-services.ts`; this entry produces `new MediaDevices( dependencies.vm(), dependencies.get('usbHotplug'), () => !!dependencies.get('@plugins').migration?.blocked,…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new MediaDevices( dependencies.vm(), dependencies.get('usbHotplug'), () => !!dependencies.get('@plugins').migration?.blocked,…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new MediaDevices(
        dependencies.vm(),
        dependencies.get('usbHotplug'),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`platform-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `platform-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 230,
  });

  const memoryReclaim = await system.startDegradable({
    id: 'memoryReclaim',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'memory-reclaim.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：从当前输入或状态计算 `new MemoryReclaim( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { depend…`，供调用方后续验证或使用。
     * Purpose: Computes `new MemoryReclaim( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { depend…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new MemoryReclaim( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { depend…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new MemoryReclaim(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 240,
  });
  const hostMounts = await system.start({
    id: 'hostMounts',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：从当前输入或状态计算 `new HostMounts( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get('@p…`，供调用方后续验证或使用。
     * Purpose: Computes `new HostMounts( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get('@p…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new HostMounts( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get('@p…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new HostMounts(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 250,
  });

  const virtioFsShares = await system.start({
    id: 'virtioFsShares',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：从当前输入或状态计算 `new VirtioFsShares( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get…`，供调用方后续验证或使用。
     * Purpose: Computes `new VirtioFsShares( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new VirtioFsShares( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new VirtioFsShares(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 260,
  });

  const trustedBoot = await system.start({
    id: 'trustedBoot',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：从当前输入或状态计算 `new TrustedBootService( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies…`，供调用方后续验证或使用。
     * Purpose: Computes `new TrustedBootService( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new TrustedBootService( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new TrustedBootService(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 270,
  });

  const gpuProfiles = await system.startDegradable({
    id: 'gpuProfiles',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'gpu-profiles.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：从当前输入或状态计算 `new GpuProfiles( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependen…`，供调用方后续验证或使用。
     * Purpose: Computes `new GpuProfiles( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependen…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new GpuProfiles( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependen…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new GpuProfiles(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 280,
  });
  const buildFarm = await system.startDegradable({
    id: 'buildFarm',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'build-farm.json'),
    requires: ['projectTerminals', '@machines', '@plugins'],
    /**
     * 入口 / Entry: startPlatformServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new BuildFarm( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenci…` 供上层消费（`platform-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `platform-services.ts`; this entry produces `new BuildFarm( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenci…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new BuildFarm( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenci…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new BuildFarm(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        undefined,
        dependencies.get('projectTerminals'),
      ),
    /**
     * 入口 / Entry: startPlatformServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startPlatformServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 290,
  });
  return { usbHotplug, mediaDevices, memoryReclaim, hostMounts, virtioFsShares, trustedBoot, gpuProfiles, buildFarm };
}
