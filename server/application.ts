/**
 * 模块职责：组织宿主资源、领域服务及 HTTP 的启动与关闭；清理未确认时保留数据目录归属。
 */
import { AppError } from '../shared/errors.ts';
import { startApplicationHttp } from './application-http.ts';
import { createApplicationServices } from './application-services.ts';
import { computeRuntime } from './compute-runtime.ts';
import { DataDirectoryOwner } from './data-directory-owner.ts';
import { hostRuntime } from './host-runtime/index.ts';
import { flushMetadata } from './metadata-queue.ts';
import { networkRuntime } from './network/index.ts';
import { DATA, PORT } from './paths.ts';
import { PluginManager } from './plugin-manager.ts';
import { ClosePhase, ResourceScope } from './resource-scope.ts';
import { scheduler } from './scheduler.ts';

/** 先取得数据目录归属再开放请求；启动失败也沿用正常关闭流程核对所有资源。 */
export async function startApplication() {
  const resources = new ResourceScope({ owner: 'core:application' });
  const plugins = new PluginManager();
  resources.defer('plugin-management', () => plugins.system.close(), ClosePhase.services,
    ['features', 'machines', 'audit', 'network', 'compute', 'scheduler']);
  let dataOwner: DataDirectoryOwner | undefined;
  const closeResources = async () => {
    const failures: unknown[] = [];
    try {
      await resources.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await flushMetadata();
    } catch (error) {
      failures.push(error);
    }
    // 资源清理或元数据落盘未确认时，不交还目录归属，避免另一个宿主接管未收尾状态。
    if (!failures.length) {
      const pending = hostRuntime
        .snapshot()
        .resources.filter((resource) => resource.id !== dataOwner?.resourceId);
      if (pending.length)
        failures.push(
          new AppError(`仍有 ${pending.length} 项资源未确认释放`, 503, 'RESOURCE_CLEANUP_PENDING'),
        );
    }
    if (!failures.length) {
      try {
        await dataOwner?.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        hostRuntime.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Host resources require cleanup');
  };
  try {
    dataOwner = await DataDirectoryOwner.acquire(DATA);
    resources.defer('host-admission-drain', () => hostRuntime.beginDrain(), ClosePhase.admission);
    resources.defer('scheduler-drain', () => scheduler.beginDrain(), ClosePhase.admission);
    resources.own('scheduler', scheduler, ClosePhase.plugins + 1);
    resources.defer('compute-drain', () => computeRuntime.beginDrain(), ClosePhase.admission);
    resources.own('compute', computeRuntime, ClosePhase.plugins + 2);
    resources.defer('network-drain', () => networkRuntime.beginDrain(), ClosePhase.admission);
    resources.own('network', networkRuntime, ClosePhase.transport);
    await networkRuntime.start();
    const services = await createApplicationServices(resources, plugins);
    const { engine } = services;
    await startApplicationHttp(services, resources);
    console.log(`Sakura → http://127.0.0.1:${PORT}\n${engine.version} · PosixLoom Native Host`);
    let closing = false;
    async function close() {
      if (closing) return;
      closing = true;
      console.log('Stopping managed virtual machines…');
      let failed = false;
      try {
        await closeResources();
      } catch (error) {
        failed = true;
        console.error('Shutdown cleanup failed:', error);
      }
      process.exit(failed ? 1 : 0);
    }
    process.on('SIGINT', () => void close());
    process.on('SIGTERM', () => void close());
  } catch (error) {
    try {
      await closeResources();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Application startup and cleanup failed');
    }
    throw error;
  }
}
