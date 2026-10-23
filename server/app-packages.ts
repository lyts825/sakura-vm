/** 应用制品自己的命名空间、封存记录与引用；共享有界内容存储实现。 */
import type { PluginMetadata } from './plugin-metadata.ts';
import { ArtifactStore } from './artifact-store.ts';
import { appActionSchemas, type AppAction } from '../shared/contracts/app-http.ts';
import { appPackageSchema, appStartupSchema, type AppPackage } from '../shared/contracts/app-runtime.ts';
import type { DeliveryReleasesV1 } from './service-contracts/delivery-quality.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import { AppStore, appHash, appNow, appNewId, appView, appRequire } from './app-store.ts';
import { AppError } from '../shared/errors.ts';
const scope = (appId: string) => ({ vmId: 'app-runtime', projectId: appId });
export class AppPackages {
  private store: AppStore<AppPackage>;
  private artifacts: ArtifactStore;
  constructor(
    metadata: PluginMetadata,
    blobs: PluginMetadata,
    authorize: () => Promise<void>,
    private delivery?: { releases: DeliveryReleasesV1; artifacts: DeliveryArtifactsV1 },
  ) {
    this.store = new AppStore(metadata, appPackageSchema, authorize);
    this.artifacts = new ArtifactStore(blobs, authorize, 'app-packages');
  }
  async view(appId?: string) {
    return appView({
      packages: await this.store.read(appId),
      capabilities: [
        {
          id: 'delivery-import',
          ready: !!this.delivery,
          reason: this.delivery ? '可复核固定交付版本及当前信任' : '未启用可选交付来源，本地文件封存仍可使用',
        },
      ],
    });
  }
  async act(appId: string, raw: AppAction) {
    const input = appActionSchemas.packages.parse(raw),
      s = scope(appId);
    if (input.action === 'cleanup-preview') {
      const p = await this.artifacts.cleanupPlan(s);
      return appView({
        artifactCleanup: {
          token: p.token,
          expiresAt: p.expiresAt,
          bytes: p.bytes,
          uploads: p.uploads.length,
          manifests: p.manifests.length,
          protected: p.protected.length,
        },
        selectedId: p.token,
      });
    }
    if (input.action === 'cleanup') {
      await this.artifacts.cleanup(s, input.token);
      return this.view(appId);
    }
    if (input.action === 'import-delivery') {
      if (!this.delivery) throw new AppError('请启用可选 delivery-releases 和 delivery-artifacts', 409);
      const origin = { vmId: input.vmId, projectId: input.projectId },
        authorize = () =>
          this.delivery!.releases.authorizeUse(origin, {
            id: input.releaseId,
            releaseCoreDigest: input.releaseCoreDigest,
          });
      const release = await authorize(),
        source = await this.delivery.artifacts.get(origin, release.candidate.manifestId);
      if (source.files.reduce((n, f) => n + f.bytes, 0) > 1024 ** 3)
        throw new AppError('安装包超过 1 GiB', 413);
      const started = release.candidate.startup,
        startup = appStartupSchema.parse({
          kind: started.kind,
          command: started.kind === 'static' ? '' : `cd payload\n${started.command}`,
          directory: started.root === '.' ? 'payload' : 'payload/' + started.root,
          port: started.port,
          healthPath: started.healthPath,
          healthCommand: '',
          timeoutSeconds: started.timeoutSeconds,
        });
      if (
        startup.kind === 'static' &&
        !source.files.some((f) => 'payload/' + f.path === startup.directory + '/index.html')
      )
        throw new AppError('交付静态制品缺少 index.html', 409);
      const read = await this.delivery.artifacts.openRead(origin, source.id),
        files = [];
      try {
        for (const f of source.files) {
          const upload = await this.artifacts.begin(s, { bytes: f.bytes, sha256: f.sha256 });
          let offset = 0;
          while (offset < f.bytes) {
            if (Date.parse(read.expiresAt) <= Date.now()) throw new AppError('交付读取租约到期', 409);
            const part = await this.delivery.artifacts.read(
              origin,
              f.blobId,
              offset,
              Math.min(512 * 1024, f.bytes - offset),
            );
            const next = (await this.artifacts.chunk(s, upload.id, offset, part.data)).offset;
            if (next <= offset || next !== part.offset) throw new AppError('来源分块偏移不符', 409);
            offset = next;
          }
          const blob = await this.artifacts.complete(s, upload.id);
          files.push({ ...blob, path: 'payload/' + f.path, mode: f.mode });
        }
        await authorize();
        const manifest = await this.artifacts.seal(s, {
          label: release.namespace + '@' + release.version,
          kind: 'import',
          files,
        });
        const item = appPackageSchema.parse({
          appId,
          id: appNewId(),
          name: (release.namespace + '@' + release.version).slice(0, 100),
          manifestId: manifest.id,
          digest: appHash([manifest.digest, startup]),
          startup,
          source: 'delivery',
          sourceDigest: release.releaseCoreDigest,
          sourceReference: { ...origin, releaseId: release.id, releaseCoreDigest: release.releaseCoreDigest },
          createdAt: appNow(),
          archived: false,
        });
        await this.artifacts.retain(s, manifest.id, 'app-package:' + item.id);
        await this.store.write((rows) => rows.push(item));
        return appView({ ...(await this.view(appId)), selectedId: item.id });
      } finally {
        await this.delivery.artifacts.closeRead(origin, read.token);
      }
    }
    if (input.action === 'begin') {
      const u = await this.artifacts.begin(s, { sha256: input.sha256, bytes: input.bytes });
      return appView({
        uploads: [{ id: u.id, offset: u.offset, bytes: u.bytes, sha256: u.sha256 }],
        selectedId: u.id,
      });
    }
    if (input.action === 'chunk') {
      const out = await this.artifacts.chunk(s, input.id, input.offset, input.data);
      return appView({
        selectedId: input.id,
        transfer: { id: input.id, offset: out.offset },
      });
    }
    if (input.action === 'complete') return appView({ blobs: [await this.artifacts.complete(s, input.id)] });
    if (input.action === 'seal') {
      if (input.files.reduce((n, f) => n + f.bytes, 0) > 1024 ** 3)
        throw new AppError('安装包总量不得超过 1 GiB', 413);
      if (
        input.startup.kind === 'static' &&
        !input.files.some((f) => f.path === input.startup.directory + '/index.html')
      )
        throw new AppError('静态包缺少目录中的 index.html', 400);
      if (input.startup.kind !== 'static' && !input.startup.command.trim())
        throw new AppError('服务或命令必须声明启动命令', 400);
      const manifest = await this.artifacts.seal(s, {
        label: input.name,
        kind: 'output',
        files: input.files,
      });
      const item = appPackageSchema.parse({
        appId,
        id: appNewId(),
        name: input.name,
        manifestId: manifest.id,
        digest: appHash([manifest.digest, input.startup]),
        startup: input.startup,
        source: 'local-reviewed',
        createdAt: appNow(),
        archived: false,
      });
      await this.artifacts.retain(s, manifest.id, 'app-package:' + item.id);
      await this.store.write((rows) => {
        rows.push(item);
      });
      return appView({ ...(await this.view(appId)), selectedId: item.id });
    }
    await this.store.write((rows) => {
      appRequire(
        rows.find((r) => r.appId === appId && r.id === input.id),
        '应用制品不存在',
      ).archived = true;
    });
    return this.view(appId);
  }
  async files(appId: string, id: string) {
    const item = appRequire(
      (await this.store.read(appId)).find((r) => r.id === id),
      '应用制品不存在',
    );
    if (item.sourceReference) {
      if (!this.delivery) throw new AppError('交付来源服务已停用，不能复核当前信任', 409);
      await this.delivery.releases.authorizeUse(
        { vmId: item.sourceReference.vmId, projectId: item.sourceReference.projectId },
        { id: item.sourceReference.releaseId, releaseCoreDigest: item.sourceReference.releaseCoreDigest },
      );
    }
    await this.artifacts.verify(scope(appId), item.manifestId);
    return (await this.artifacts.get(scope(appId), item.manifestId)).files;
  }
  read(appId: string, blobId: string, offset: number, length: number) {
    return this.artifacts.read(scope(appId), blobId, offset, length);
  }
  close() {
    return this.artifacts.close();
  }
}
