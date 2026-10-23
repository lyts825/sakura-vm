import './plugin-fonts.css';
/** 应用运行包的表单工作台；计划、审批和执行分别操作。 */
import { useEffect, useState } from 'react';
import {
  appViewSchema,
  appSections,
  type AppSection,
  type AppView,
  type AppStartup,
} from '../shared/contracts/app-runtime';
import type { FeatureProps } from './feature-shared';
import { useRemote, useAction, Feedback } from './feature-shared';
import { DeliveryHash } from './delivery-transfer';
import './app-runtime.css';
const names: Record<AppSection, string> = {
  targets: '运行目标',
  packages: '安装制品',
  config: '应用配置',
  data: '持久数据',
  observe: '运行观测',
  routes: '应用入口',
  recovery: '冷备与恢复',
  deploy: '安装与变更',
  workbench: '工作台',
};
const empty = () => appViewSchema.parse({});
function pairs(text: string) {
  const result: Record<string, string> = {};
  for (const line of text.split('\n').filter((l) => l.trim())) {
    const n = line.indexOf('=');
    if (n < 1) throw new Error('每行填写 KEY=value');
    const k = line.slice(0, n).trim();
    if (k in result) throw new Error('配置键重复：' + k);
    result[k] = line.slice(n + 1);
  }
  return result;
}
function base64(bytes: Uint8Array) {
  let result = '';
  for (let n = 0; n < bytes.length; n += 8192) result += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(result);
}
type AppRuntimeProps = Omit<FeatureProps, 'vm'> & { vm?: FeatureProps['vm']; section: AppSection };
export function AppRuntimePanel(props: AppRuntimeProps) {
  return <AppPanel key={props.token + ':' + props.section + ':' + (props.vm?.id || '')} {...props} />;
}
function AppPanel({ section, request, vm, projectId }: AppRuntimeProps) {
  const [appId, setAppId] = useState(''),
    [tab, setTab] = useState<AppSection>(section === 'workbench' ? 'targets' : section),
    [name, setName] = useState('我的应用'),
    [reviewed, setReviewed] = useState(false),
    [distro, setDistro] = useState('alpine'),
    [imageId, setImageId] = useState(''),
    [memory, setMemory] = useState(1024),
    [disk, setDisk] = useState(8),
    [files, setFiles] = useState<File[]>([]),
    [artifactCleanup, setArtifactCleanup] = useState<AppView['artifactCleanup']>(),
    [startup, setStartup] = useState<AppStartup>({
      kind: 'static',
      command: '',
      directory: 'public',
      port: 8080,
      healthPath: '/',
      healthCommand: '',
      timeoutSeconds: 60,
    }),
    [environment, setEnvironment] = useState(''),
    [secrets, setSecrets] = useState(''),
    [packageId, setPackageId] = useState(''),
    [configId, setConfigId] = useState(''),
    [kind, setKind] = useState('install'),
    [checkpoint, setCheckpoint] = useState(false),
    [backupHours, setBackupHours] = useState(24),
    [migration, setMigration] = useState(''),
    [verification, setVerification] = useState(''),
    [fromSchema, setFromSchema] = useState('1'),
    [toSchema, setToSchema] = useState('2'),
    [dataName, setDataName] = useState('data'),
    [dataBudget, setDataBudget] = useState(1024),
    [dataSchema, setDataSchema] = useState('1'),
    [selectedPlan, setSelectedPlan] = useState(''),
    [checkpointId, setCheckpointId] = useState(''),
    [restoreName, setRestoreName] = useState('app-restored'),
    [notice, setNotice] = useState(''),
    [logText, setLogText] = useState(''),
    [destinations, setDestinations] = useState(''),
    [networkMinutes, setNetworkMinutes] = useState(15),
    [deliveryVm, setDeliveryVm] = useState(vm?.id || ''),
    [deliveryProject, setDeliveryProject] = useState(vm ? projectId || 'default' : ''),
    [deliveryRelease, setDeliveryRelease] = useState(''),
    [deliveryDigest, setDeliveryDigest] = useState(''),
    [deletePlan, setDeletePlan] = useState<{ id: string; token: string } | null>(null),
    [adoptVm, setAdoptVm] = useState(vm?.id || ''),
    [adoptProject, setAdoptProject] = useState(vm ? projectId || 'default' : '');
  const action = useAction(),
    remote = useRemote<AppView>(
      request,
      '/app-' + section + (appId ? '?appId=' + encodeURIComponent(appId) : ''),
      true,
      4000,
    ),
    targetList = useRemote<AppView>(request, '/app-targets', section !== 'packages', 5000);
  let data = empty(),
    parseError = '';
  try {
    if (remote.data) data = appViewSchema.parse(remote.data);
  } catch {
    parseError = '服务器响应不符合应用契约，已停止展示。';
  }
  const target = (targetList.data?.targets || data.targets).find((t) => t.appId === appId),
    plan = data.plans.find((p) => p.id === selectedPlan) || data.plans.at(-1);
  useEffect(() => {
    setReviewed(false);
    setDeletePlan(null);
  }, [
    appId,
    name,
    startup,
    environment,
    secrets,
    kind,
    packageId,
    configId,
    checkpoint,
    migration,
    verification,
    distro,
    memory,
    disk,
    dataName,
    dataBudget,
    dataSchema,
    restoreName,
    backupHours,
    deliveryVm,
    deliveryProject,
    deliveryRelease,
    deliveryDigest,
    imageId,
    selectedPlan,
    adoptVm,
    adoptProject,
    destinations,
    networkMinutes,
  ]);
  const post = async (s: AppSection, body: unknown, signal?: AbortSignal, id = appId) => {
    if (!id) throw new Error('先选择或填写应用标识');
    const value = appViewSchema.parse(
      await request('/app-' + s + '?appId=' + encodeURIComponent(id), 'POST', body, signal),
    );
    remote.reload();
    targetList.reload();
    return value;
  };
  const run = (s: AppSection, body: unknown) =>
    action.run(async (signal) => {
      const value = await post(s, body, signal);
      if (value.artifactCleanup) {
        setArtifactCleanup(value.artifactCleanup);
        setReviewed(false);
      }
      if ((body as { action: string }).action === 'rebind-preview') setReviewed(false);
      if (s === 'deploy' && (body as { action: string }).action === 'preview')
        setSelectedPlan(value.selectedId || '');
      if (s === 'observe' && (body as { action: string }).action === 'logs')
        setLogText(value.observations[0]?.detail || '暂无日志');
      setNotice(value.selectedId ? '记录：' + value.selectedId : '操作已提交，结果以状态记录为准');
    }, '请求已处理');
  const create = (adopt: boolean) =>
    action.run(async (signal) => {
      const id = appId && !target ? appId : crypto.randomUUID();
      await post(
        'targets',
        adopt
          ? { action: 'adopt', name, vmId: adoptVm, projectId: adoptProject, reviewed: true }
          : {
              action: 'create',
              name,
              distro,
              architecture: 'x86_64',
              memoryMiB: memory,
              cpus: 1,
              diskGiB: disk,
              reviewed: true,
              ...(imageId
                ? {
                    imageRef: { assetId: imageId, digest: data.images.find((i) => i.id === imageId)?.digest },
                  }
                : {}),
            },
        signal,
        id,
      );
      setAppId(id);
      setNotice('已提交目标操作。创建任务可在任务中心查看。');
    });
  const upload = () =>
    action.run(async (signal) => {
      if (!files.length) throw new Error('请选择实际运行文件');
      const result = [];
      let total = 0;
      for (const file of files) {
        total += file.size;
        if (total > 1024 ** 3) throw new Error('安装包总量最多 1 GiB');
        const hash = new DeliveryHash();
        for (let n = 0; n < file.size; n += 512 * 1024) {
          signal.throwIfAborted();
          hash.update(new Uint8Array(await file.slice(n, n + 512 * 1024).arrayBuffer()));
        }
        const sha256 = hash.digest(),
          begin = await post('packages', { action: 'begin', sha256, bytes: file.size }, signal),
          id = begin.selectedId!;
        for (let offset = 0; offset < file.size; offset += 512 * 1024) {
          signal.throwIfAborted();
          const chunk = new Uint8Array(await file.slice(offset, offset + 512 * 1024).arrayBuffer());
          await post('packages', { action: 'chunk', id, offset, data: base64(chunk) }, signal);
          setNotice(
            '上传 ' + file.name + '：' + Math.min(offset + chunk.length, file.size) + ' / ' + file.size,
          );
        }
        const completed = await post('packages', { action: 'complete', id }, signal),
          blob = completed.blobs[0];
        if (blob.sha256 !== sha256 || blob.bytes !== file.size) throw new Error('上传回执内容不符');
        const path =
          file.webkitRelativePath || (startup.kind === 'static' ? startup.directory + '/' : '') + file.name;
        result.push({ path, ...blob, mode: 420 });
      }
      const sealed = await post(
        'packages',
        { action: 'seal', name, startup, files: result, reviewed: true },
        signal,
      );
      setPackageId(sealed.selectedId || '');
      setNotice('已校验并封存安装包：' + sealed.selectedId);
    });
  const visible = (s: AppSection) => tab === s;
  return (
    <section className="app-runtime-panel">
      <header>
        <div>
          <h3>应用运行与运维</h3>
          <p>固定目标、审阅变更，保留应用数据与实际执行证据。</p>
        </div>
        <button
          onClick={() => {
            remote.reload();
            targetList.reload();
          }}
        >
          刷新
        </button>
      </header>
      <div className="app-runtime-selection">
        <label>
          应用
          <select
            value={appId}
            onChange={(e) => {
              setAppId(e.target.value);
              setSelectedPlan('');
            }}
          >
            <option value="">选择应用</option>
            {(targetList.data?.targets || data.targets).map((t) => (
              <option key={t.appId} value={t.appId}>
                {t.name} · {t.state}
              </option>
            ))}
          </select>
        </label>
        <label>
          应用标识
          <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="已有应用 UUID" />
        </label>
        <button
          disabled={action.busy}
          onClick={() => {
            setAppId(crypto.randomUUID());
            setSelectedPlan('');
            setPackageId('');
            setConfigId('');
            setNotice('已生成新应用标识，可先上传制品，再创建运行目标。');
          }}
        >
          新应用标识
        </button>
      </div>
      {section === 'workbench' && (
        <nav aria-label="应用流程">
          {appSections
            .filter((s) => s !== 'workbench')
            .map((s) => (
              <button key={s} aria-pressed={tab === s} onClick={() => setTab(s)}>
                {names[s]}
              </button>
            ))}
        </nav>
      )}
      {(remote.error || targetList.error || parseError) && (
        <p role="alert" className="app-runtime-error">
          {parseError || remote.error || targetList.error}
        </p>
      )}
      {target && (
        <p className="app-runtime-summary">
          {target.name} · {target.desired === 'running' ? '期望运行' : '期望停止'} · {target.state} · VM{' '}
          {target.vmId}
          {target.lease ? ' · 变更处理中' : ''}
        </p>
      )}
      <Feedback {...action} />
      {notice && <p role="status">{notice}</p>}
      {logText && (
        <details open>
          <summary>当前应用日志</summary>
          <pre>{logText}</pre>
        </details>
      )}
      <label className="app-runtime-review">
        <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
        已审阅当前表单中的目标、命令、配置和数据影响
      </label>
      {visible('targets') && (
        <div className="app-runtime-card">
          <h4>创建或接管专用实例</h4>
          <div className="app-runtime-grid">
            <label>
              应用名称
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              基础镜像
              <select value={distro} onChange={(e) => setDistro(e.target.value)}>
                <option value="alpine">Alpine</option>
                <option value="debian">Debian</option>
                <option value="ubuntu">Ubuntu</option>
              </select>
            </label>
            <label>
              内存 MiB
              <input
                type="number"
                min="512"
                max="32768"
                value={memory}
                onChange={(e) => setMemory(Number(e.target.value))}
              />
            </label>
            <label>
              磁盘预算 GiB
              <input
                type="number"
                min="4"
                max="128"
                value={disk}
                onChange={(e) => setDisk(Number(e.target.value))}
              />
            </label>
          </div>
          <p>使用已准备的镜像，创建长期保留且默认断网的独立 VM。缺少运行时会阻断安装。</p>
          <label>
            已登记镜像资产
            <select value={imageId} onChange={(e) => setImageId(e.target.value)}>
              <option value="">使用已准备的默认基础镜像</option>
              {data.images.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.distro} · {i.digest.slice(0, 16)} · {Math.round(i.virtualBytes / 1024 ** 3)} GiB
                </option>
              ))}
            </select>
          </label>
          <p>
            应用镜像需要 Python 3、tmux、C 编译器和 libc/Linux 头文件、iproute2、openssl、shadow 与
            nftables。有限出站还需要 iptables 和 ip6tables。
          </p>
          <button disabled={!reviewed || action.busy} onClick={() => create(false)}>
            创建目标
          </button>
          <details>
            <summary>接管已运行的专用 VM</summary>
            <label>
              VM 标识
              <input value={adoptVm} onChange={(e) => setAdoptVm(e.target.value)} />
            </label>
            <label>
              项目标识
              <input value={adoptProject} onChange={(e) => setAdoptProject(e.target.value)} />
            </label>
            <p>已有服务、仓库配置、多项目或已登记应用会拒绝接管。</p>
            <button
              disabled={!reviewed || !adoptVm || !adoptProject || action.busy}
              onClick={() => create(true)}
            >
              审阅后接管
            </button>
          </details>
          {appId && (
            <button disabled={action.busy} onClick={() => run('targets', { action: 'reconcile' })}>
              核对目标身份
            </button>
          )}
          {appId && (
            <details>
              <summary>有限出站授权</summary>
              <p>
                仅允许明确 IPv4、TCP/UDP 和端口。域名、IPv6 不受支持；DNS
                也需单独授权。计划到期后内核阻断出站，重启保持隔离。
              </p>
              <label>
                每行填写 IPv4,协议,端口
                <textarea
                  value={destinations}
                  onChange={(e) => setDestinations(e.target.value)}
                  placeholder="203.0.113.10,tcp,443"
                />
              </label>
              <label>
                有效分钟数
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={networkMinutes}
                  onChange={(e) => setNetworkMinutes(Number(e.target.value))}
                />
              </label>
              <button
                disabled={action.busy}
                onClick={() =>
                  run('targets', {
                    action: 'network-preview',
                    destinations: destinations
                      .split('\n')
                      .filter((l) => l.trim())
                      .map((l) => {
                        const [address, protocol, port] = l.split(',').map((s) => s.trim());
                        return { address, protocol, port: Number(port) };
                      }),
                    expiresAt: new Date(Date.now() + networkMinutes * 60000).toISOString(),
                  })
                }
              >
                预览网络计划
              </button>
              {data.networkPlans.map((n) => (
                <article key={n.id}>
                  <p>
                    {n.state} · 到期 {n.expiresAt}
                  </p>
                  <code>{n.destinations.map((d) => `${d.address}:${d.port}/${d.protocol}`).join(', ')}</code>
                  <p>{n.reason}</p>
                  <small>计划摘要 {n.digest}</small>
                  {n.state === 'planned' && (
                    <button
                      disabled={!reviewed || action.busy}
                      onClick={() =>
                        run('targets', {
                          action: 'network-apply',
                          id: n.id,
                          digest: n.digest,
                          reviewed: true,
                        })
                      }
                    >
                      审阅后授权
                    </button>
                  )}
                  <button
                    disabled={action.busy}
                    onClick={() => run('targets', { action: 'network-observe', id: n.id })}
                  >
                    核验实际规则
                  </button>
                  <button
                    disabled={action.busy}
                    onClick={() => run('targets', { action: 'network-revoke', id: n.id })}
                  >
                    撤回网络授权
                  </button>
                </article>
              ))}
            </details>
          )}
          {data.targetReceipts
            .filter((r) => r.cleanup !== 'confirmed' && !data.targets.some((t) => t.vmId === r.vmId))
            .map((r) => (
              <article key={r.token}>
                <p>
                  未登记目标 {r.vmId} · 清理状态 {r.cleanup}
                </p>
                <button
                  disabled={!reviewed || action.busy}
                  onClick={() => run('targets', { action: 'cleanup-target', token: r.token, reviewed: true })}
                >
                  核对归属后清理
                </button>
              </article>
            ))}
        </div>
      )}
      {visible('packages') && (
        <div className="app-runtime-card">
          <h4>封存实际运行文件</h4>
          <details>
            <summary>清理未完成上传</summary>
            <button
              disabled={!appId || action.busy}
              onClick={() => run('packages', { action: 'cleanup-preview' })}
            >
              预览可清理内容
            </button>
            {artifactCleanup && (
              <>
                <p>
                  未完成上传 {artifactCleanup.uploads} 项 · 可清理 {artifactCleanup.bytes} 字节 · 受保护引用{' '}
                  {artifactCleanup.protected} 项 · 到期 {artifactCleanup.expiresAt}
                </p>
                <button
                  disabled={!reviewed || action.busy}
                  onClick={() =>
                    run('packages', { action: 'cleanup', token: artifactCleanup.token, reviewed: true })
                  }
                >
                  审阅后清理
                </button>
              </>
            )}
          </details>
          <details>
            <summary>从已登记交付版本导入</summary>
            <p>要求启用可选交付来源插件。复制前后复核固定版本、当前规则、运行清理及信任；部署时再次核验。</p>
            <div className="app-runtime-grid">
              <label>
                来源 VM
                <input value={deliveryVm} onChange={(e) => setDeliveryVm(e.target.value)} />
              </label>
              <label>
                来源项目
                <input value={deliveryProject} onChange={(e) => setDeliveryProject(e.target.value)} />
              </label>
              <label>
                版本标识
                <input value={deliveryRelease} onChange={(e) => setDeliveryRelease(e.target.value)} />
              </label>
              <label>
                版本核心 SHA-256
                <input value={deliveryDigest} onChange={(e) => setDeliveryDigest(e.target.value)} />
              </label>
            </div>
            <button
              disabled={
                !reviewed ||
                !appId ||
                action.busy ||
                !data.capabilities.some((c) => c.id === 'delivery-import' && c.ready)
              }
              onClick={() =>
                run('packages', {
                  action: 'import-delivery',
                  vmId: deliveryVm,
                  projectId: deliveryProject,
                  releaseId: deliveryRelease,
                  releaseCoreDigest: deliveryDigest,
                  reviewed: true,
                })
              }
            >
              复核来源并导入
            </button>
          </details>
          <label>
            安装包名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            运行方式
            <select
              value={startup.kind}
              onChange={(e) => setStartup({ ...startup, kind: e.target.value as AppStartup['kind'] })}
            >
              <option value="static">静态站点</option>
              <option value="service">持续服务</option>
              <option value="command">一次性命令</option>
            </select>
          </label>
          {startup.kind === 'static' ? (
            <label>
              静态目录
              <input
                value={startup.directory}
                onChange={(e) => setStartup({ ...startup, directory: e.target.value })}
              />
            </label>
          ) : (
            <label>
              启动命令
              <textarea
                value={startup.command}
                onChange={(e) => setStartup({ ...startup, command: e.target.value })}
                placeholder="node server.js 或 python3 main.py"
              />
            </label>
          )}
          <div className="app-runtime-grid">
            <label>
              服务端口
              <input
                type="number"
                value={startup.port}
                onChange={(e) => setStartup({ ...startup, port: Number(e.target.value) })}
              />
            </label>
            <label>
              健康路径
              <input
                value={startup.healthPath}
                onChange={(e) => setStartup({ ...startup, healthPath: e.target.value })}
              />
            </label>
          </div>
          <label>
            可选命令探针
            <textarea
              value={startup.healthCommand}
              onChange={(e) => setStartup({ ...startup, healthCommand: e.target.value })}
            />
          </label>
          <label>
            运行文件
            <input
              type="file"
              multiple
              onChange={(e) => {
                setFiles(Array.from(e.target.files || []));
                setReviewed(false);
              }}
            />
          </label>
          <p>静态文件放入所填目录；单个安装包最多 1 GiB，上传后核对完整摘要。</p>
          <button disabled={!reviewed || !appId || !files.length || action.busy} onClick={upload}>
            上传并封存
          </button>
          {data.packages.map((p) => (
            <article key={p.id}>
              <b>{p.name}</b>
              <p>
                {p.startup.kind} · {p.source} · {p.id}
              </p>
              <code>{p.digest}</code>
              <button disabled={action.busy} onClick={() => run('packages', { action: 'archive', id: p.id })}>
                归档
              </button>
            </article>
          ))}
        </div>
      )}
      {visible('config') && (
        <div className="app-runtime-card">
          <h4>配置修订</h4>
          <label>
            公开配置，每行 KEY=value
            <textarea
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              placeholder="NODE_ENV=production"
            />
          </label>
          <label>
            私密引用，每行环境变量=已有引用名
            <textarea
              value={secrets}
              onChange={(e) => setSecrets(e.target.value)}
              placeholder="API_TOKEN=my-token"
            />
          </label>
          <p>服务端保存引用版本；私密值不进入计划或浏览器响应。</p>
          <button
            disabled={!reviewed || !appId || action.busy}
            onClick={() =>
              action.run(async (signal) => {
                const v = await post(
                  'config',
                  {
                    action: 'save',
                    expectedRevision: Math.max(0, ...data.configs.map((c) => c.revision)),
                    values: pairs(environment),
                    secretRefs: pairs(secrets),
                  },
                  signal,
                );
                setConfigId(v.selectedId || '');
              })
            }
          >
            保存新修订
          </button>
          {data.configs.map((c) => (
            <article key={c.id}>
              <b>修订 {c.revision}</b>
              <p>{c.id}</p>
              <p>
                公开键：{Object.keys(c.values).join('、') || '无'}；私密键：
                {Object.keys(c.secretRefs).join('、') || '无'}
              </p>
              <button onClick={() => run('config', { action: 'verify', id: c.id })}>核验引用版本</button>
            </article>
          ))}
        </div>
      )}
      {visible('data') && (
        <div className="app-runtime-card">
          <h4>持久数据目录</h4>
          <div className="app-runtime-grid">
            <label>
              目录名称
              <input value={dataName} onChange={(e) => setDataName(e.target.value)} />
            </label>
            <label>
              数据模式版本
              <input value={dataSchema} onChange={(e) => setDataSchema(e.target.value)} />
            </label>
            <label>
              容量预算 MiB
              <input
                type="number"
                value={dataBudget}
                onChange={(e) => setDataBudget(Number(e.target.value))}
              />
            </label>
          </div>
          <p>容量预算执行预检，不冒充文件系统硬配额。升级保留独立数据目录。</p>
          <button
            disabled={!reviewed || !appId || action.busy}
            onClick={() =>
              run('data', {
                action: 'create',
                name: dataName,
                schemaVersion: dataSchema,
                budgetBytes: dataBudget * 1024 ** 2,
                reviewed: true,
              })
            }
          >
            创建目录
          </button>
          <button disabled={!appId || action.busy} onClick={() => run('data', { action: 'inspect' })}>
            检查容量
          </button>
          {data.datasets.map((d) => (
            <article key={d.id}>
              <b>{d.name}</b>
              <p>
                模式 {d.schemaVersion} · 数据代号 {d.generation} · {d.path}
              </p>
              <button
                disabled={action.busy}
                onClick={() =>
                  action.run(async (signal) => {
                    const v = await post('data', { action: 'plan-delete', id: d.id }, signal);
                    setDeletePlan({ id: d.id, token: v.selectedId! });
                    setReviewed(false);
                  })
                }
              >
                预览永久删除
              </button>
              {deletePlan?.id === d.id && (
                <p>
                  将永久删除此目录。
                  <button
                    disabled={!reviewed || action.busy}
                    onClick={() =>
                      run('data', { action: 'delete', id: d.id, token: deletePlan.token, reviewed: true })
                    }
                  >
                    确认删除此目录
                  </button>
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {visible('deploy') && (
        <div className="app-runtime-card">
          <h4>生成不可变变更计划</h4>
          <div className="app-runtime-grid">
            <label>
              变更类型
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  ['install', '首次安装'],
                  ['upgrade', '升级'],
                  ['rollback', '兼容性回退'],
                  ['stop', '停止'],
                  ['uninstall', '卸载并保留数据'],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              安装包
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                <option value="">请选择</option>
                {data.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <input
                placeholder="或粘贴安装包 ID"
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
              />
            </label>
            <label>
              配置修订
              <select value={configId} onChange={(e) => setConfigId(e.target.value)}>
                <option value="">请选择</option>
                {data.configs.map((c) => (
                  <option key={c.id} value={c.id}>
                    修订 {c.revision}
                  </option>
                ))}
              </select>
              <input
                placeholder="或粘贴配置 ID"
                value={configId}
                onChange={(e) => setConfigId(e.target.value)}
              />
            </label>
          </div>
          <label>
            <input type="checkbox" checked={checkpoint} onChange={(e) => setCheckpoint(e.target.checked)} />
            变更前关闭 VM 并创建已校验冷备
          </label>
          <details>
            <summary>数据迁移</summary>
            <div className="app-runtime-grid">
              <label>
                起始模式
                <input value={fromSchema} onChange={(e) => setFromSchema(e.target.value)} />
              </label>
              <label>
                目标模式
                <input value={toSchema} onChange={(e) => setToSchema(e.target.value)} />
              </label>
            </div>
            <label>
              迁移命令
              <textarea value={migration} onChange={(e) => setMigration(e.target.value)} />
            </label>
            <label>
              迁移验证命令
              <textarea value={verification} onChange={(e) => setVerification(e.target.value)} />
            </label>
            <p>迁移必须开启冷备。迁移结果不明时禁止盲目回退或重试。</p>
          </details>
          <button
            disabled={!appId || action.busy}
            onClick={() =>
              run('deploy', {
                action: 'preview',
                kind,
                ...(packageId ? { packageId } : {}),
                ...(configId ? { configId } : {}),
                checkpoint,
                migration: migration ? { command: migration, verification, fromSchema, toSchema } : null,
              })
            }
          >
            预览变更
          </button>
          {plan && (
            <article>
              <h4>计划 {plan.id}</h4>
              <p>
                {plan.action} · 目标修订 {plan.targetRevision} ·{' '}
                {plan.checkpoint ? '需要关机冷备' : '不创建冷备'} · 当前流程包含维护停机
              </p>
              <p>
                制品 {plan.packageId || '不变'}；配置 {plan.configId || '不变'}
              </p>
              <code>{plan.digest}</code>
              <p>有效期至 {plan.expiresAt}</p>
              <button
                disabled={!reviewed || !!plan.usedBy || action.busy}
                onClick={() =>
                  run('deploy', { action: 'approve', id: plan.id, digest: plan.digest, reviewed: true })
                }
              >
                确认此计划
              </button>
              <button
                disabled={!plan.approvedAt || !!plan.usedBy || action.busy}
                onClick={() => run('deploy', { action: 'apply', id: plan.id })}
              >
                执行已确认计划
              </button>
            </article>
          )}
          {data.operations.map((o) => (
            <article key={o.id}>
              <b>{o.phase}</b>
              <p>
                执行：{o.status}；清理：{o.cleanup}
              </p>
              {o.error && <p role="alert">{o.error}</p>}
              <code>{o.id}</code>
              <button onClick={() => run('deploy', { action: 'cancel', id: o.id })}>取消</button>
              <button onClick={() => run('deploy', { action: 'reconcile', id: o.id })}>核销并保持停止</button>
              {['failed', 'unknown', 'cancelled'].includes(o.status) && (
                <>
                  <label>
                    恢复检查点
                    <select
                      value={checkpointId}
                      onChange={(e) => {
                        setCheckpointId(e.target.value);
                        setReviewed(false);
                      }}
                    >
                      <option value="">先在冷备页恢复独立副本</option>
                      {data.checkpoints
                        .filter((c) => c.restoredVmId && !c.activatedAt)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.id} · {c.createdAt}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    disabled={!reviewed || !checkpointId || action.busy}
                    onClick={() =>
                      run('deploy', {
                        action: 'recover-from-checkpoint',
                        id: o.id,
                        checkpointId,
                        reviewed: true,
                      })
                    }
                  >
                    核销原进程并交接恢复副本
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      {visible('observe') && (
        <div className="app-runtime-card">
          <h4>运行证据</h4>
          <button disabled={!appId || action.busy} onClick={() => run('observe', { action: 'logs' })}>
            读取有界日志
          </button>
          {data.observations
            .slice()
            .reverse()
            .map((o) => (
              <article key={o.id}>
                <b>{o.status}</b>
                <p>
                  {o.checkedAt} · 安装 {o.installationId || '未绑定'}
                </p>
                <pre>{o.detail}</pre>
              </article>
            ))}
          {!data.observations.length && <p>尚无运行证据，首次安装后会记录真实探测结果。</p>}
        </div>
      )}
      {visible('routes') && (
        <div className="app-runtime-card">
          <h4>应用入口</h4>
          {data.routes
            .slice()
            .reverse()
            .map((r) => (
              <article key={r.id}>
                <b>
                  {r.state} · 修订 {r.revision}
                </b>
                <p>
                  {r.state === 'open' ? (
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.url}
                    </a>
                  ) : (
                    r.url
                  )}
                </p>
                <p>安装 {r.installationId}</p>
                {r.state === 'open' && (
                  <button onClick={() => run('routes', { action: 'close', expectedRevision: r.revision })}>
                    关闭入口
                  </button>
                )}
              </article>
            ))}
          <button disabled={!appId || action.busy} onClick={() => run('routes', { action: 'reconcile' })}>
            核销重启前入口
          </button>
        </div>
      )}
      {visible('recovery') && (
        <div className="app-runtime-card">
          <h4>关机冷备与独立恢复</h4>
          <details>
            <summary>普通重启后重新绑定</summary>
            <p>
              先启动原
              VM。核对同一磁盘和新启动身份后，关闭旧入口、停止项目并清除临时秘密。完成后应用保持停止，需重新生成部署计划。未核销租约或未知迁移会阻断。
            </p>
            <button
              disabled={!appId || action.busy}
              onClick={() => run('recovery', { action: 'rebind-preview' })}
            >
              预览新的启动基线
            </button>
            {target?.rebind && (
              <article>
                <p>
                  状态：{target.rebind.state} · 计划：{target.rebind.id}
                </p>
                <p>
                  VM：{target.rebind.vmId} · 原启动：{target.rebind.fromBootId} · 新启动：
                  {target.rebind.toBootId}
                </p>
                <p>
                  磁盘：<code>{target.rebind.diskIdentity}</code>
                </p>
                <p>批准期限：{target.rebind.expiresAt}</p>
                <code>{target.rebind.digest}</code>
                <button
                  disabled={!reviewed || action.busy || target.rebind.state === 'applied'}
                  onClick={() =>
                    run('recovery', {
                      action: 'rebind',
                      id: target.rebind!.id,
                      digest: target.rebind!.digest,
                      reviewed: true,
                    })
                  }
                >
                  核销旧运行并重新绑定
                </button>
              </article>
            )}
          </details>
          <details>
            <summary>定时冷备策略</summary>
            <p>仅在应用已停止且 VM 已运行时执行。运行中跳过；失败后暂停并保留待核销记录。</p>
            <label>
              间隔小时
              <input
                type="number"
                min="1"
                max="168"
                value={backupHours}
                onChange={(e) => setBackupHours(Number(e.target.value))}
              />
            </label>
            <button
              disabled={!reviewed || !appId || action.busy}
              onClick={() =>
                run('recovery', {
                  action: 'schedule',
                  enabled: true,
                  intervalHours: backupHours,
                  reviewed: true,
                })
              }
            >
              保存并启用
            </button>
            <button
              disabled={!reviewed || !appId || action.busy}
              onClick={() =>
                run('recovery', {
                  action: 'schedule',
                  enabled: false,
                  intervalHours: backupHours,
                  reviewed: true,
                })
              }
            >
              暂停定时冷备
            </button>
            {data.backupPolicies.map((p) => (
              <p key={p.id}>
                {p.enabled ? '已启用' : '已暂停'} · 下次 {p.nextAt} · {p.reason}
              </p>
            ))}
          </details>
          <p>冷备会停止服务并关闭专用 VM，校验后重启 VM；应用保持停止，后续显式安装计划恢复服务。</p>
          <button
            disabled={!reviewed || !appId || action.busy}
            onClick={() => run('recovery', { action: 'checkpoint', reviewed: true })}
          >
            创建冷备检查点
          </button>
          <label>
            恢复实例名称
            <input value={restoreName} onChange={(e) => setRestoreName(e.target.value)} />
          </label>
          {data.checkpoints
            .slice()
            .reverse()
            .map((c) => (
              <article key={c.id}>
                <b>{c.state}</b>
                <p>
                  {c.createdAt} · {c.id}
                </p>
                {c.error && <p role="alert">{c.error}</p>}
                {c.restoredVmId && (
                  <p>
                    独立恢复实例：{c.restoredVmId} · {c.activatedAt ? '已交接运行目标' : '保持停止，等待交接'}
                  </p>
                )}
                {c.restoredVmId && !c.activatedAt && (
                  <button
                    disabled={!reviewed || action.busy}
                    onClick={() => run('recovery', { action: 'activate-restored', id: c.id, reviewed: true })}
                  >
                    停止原目标并交接恢复副本
                  </button>
                )}
                <button
                  disabled={!c.backupId || action.busy}
                  onClick={() => run('recovery', { action: 'verify', id: c.id })}
                >
                  校验备份
                </button>
                <button
                  disabled={!reviewed || !c.backupId || action.busy}
                  onClick={() =>
                    run('recovery', { action: 'restore', id: c.id, name: restoreName, reviewed: true })
                  }
                >
                  恢复为新实例
                </button>
                <button
                  disabled={action.busy}
                  onClick={() => run('recovery', { action: 'reconcile', id: c.id })}
                >
                  核对中断状态
                </button>
              </article>
            ))}
        </div>
      )}
    </section>
  );
}
