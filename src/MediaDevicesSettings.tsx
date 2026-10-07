/**
 * 模块职责（中文）：配置虚拟音视频设备规则，预览匹配结果并查看当前设备状态。
 * Module responsibility (English): Configuring virtual media/device rules and previewing matches.
 * 详细范围（中文）：公开入口包括 MediaDevicesSettings；职责覆盖配置虚拟音视频和设备规则并预览匹配，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include MediaDevicesSettings. The scope covers Configuring virtual media/device rules and previewing matches. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useState } from 'react';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

type Mode = 'off' | 'virtual' | 'host';
type Rule = { id: string; vendorId: number; productId: number;
  mediaKind?: 'camera' | 'microphone' | 'headset' };
type Device = { id: string; vendorId: number; productId: number; ruleId?: string };
type View = { vmId: string; vmName: string; status: string;
  audio: string; audioBackend: string;
  support: Record<'none' | 'dsound', { available: boolean; reason?: string }>;
  guest: { audio: string; video: string; error?: string } | null;
  usb: { ready: boolean; hostDevices: string; hostError: string;
    rules: Rule[]; configured: Device[] } };
type Preview = { vmId: string; mode: Mode; ready: boolean; reasons: string[];
  before: object; after: object; qemuAudioArguments: string[]; previewToken: string };
type VM = { id: string; name: string; status: string };
/**
 * 中文：仅四位十六进制文本转换为整数，无效值返回零由表单校验继续处理。
 * English: Convert only four-digit hexadecimal text to an integer; invalid input returns zero for subsequent form validation.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const parseHex = (value: string) => /^[0-9a-fA-F]{4}$/.test(value)
  ? Number.parseInt(value, 16) : 0;
/**
 * 中文：把 USB 标识数字转换为四位大写十六进制文本，供表单回显。
 * English: Convert numeric USB identifiers into four-digit uppercase hexadecimal for form display.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const hex = (value: number) => value.toString(16).padStart(4, '0').toUpperCase();

/**
 * 中文：呈现配置虚拟音视频和设备规则并预览匹配中的 MediaDevicesSettings 界面，订阅 /vms、path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the MediaDevicesSettings surface for Configuring virtual media/device rules and previewing matches, subscribing to /vms, path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request } 提供 request（带身份和权限作用域的传输能力） 上下文字段
 * English: Inputs: { request } provides context fields request (transport capability bound to identity/authority scope)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function MediaDevicesSettings({ request }: { request: Request }) {
  const vms = useRemote<VM[]>(request, '/vms', true, 5000);
  const [target, setTarget] = useState('');
  const vmId = target || vms.data?.[0]?.id || '';
  const path = `/vms/${vmId}/media-devices`;
  const remote = useRemote<View>(request, path, !!vmId, 10000);
  const action = useAction();
  const [mode, setMode] = useState<Mode>('host');
  const [review, setReview] = useState<Preview | null>(null);
  const [kind, setKind] = useState<'camera' | 'microphone' | 'headset'>('camera');
  const [vendor, setVendor] = useState('');
  const [product, setProduct] = useState('');
  const mediaRules = remote.data?.usb.rules.filter((rule) => !!rule.mediaKind) || [];
  /**
   * 中文：提交 POST path，完成配置虚拟音视频和设备规则并预览匹配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Configuring virtual media/device rules and previewing matches. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const audioPreview = () => void action.run(/** 中文：提交 POST path，完成配置虚拟音视频和设备规则并预览匹配的数据交互并更新review 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Configuring virtual media/device rules and previewing matches and update review state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setReview(await request<Preview>(path, 'POST',
      { operation: 'preview-audio', mode }, signal));
  });
  /**
   * 中文：提交 POST path，完成配置虚拟音视频和设备规则并预览匹配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Configuring virtual media/device rules and previewing matches. Propagate asynchronous failure to this catch path or the outer action feedback
   */
  const apply = () => void action.run(/** 中文：提交 POST path，完成配置虚拟音视频和设备规则并预览匹配的数据交互并更新review 状态；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Configuring virtual media/device rules and previewing matches and update review state. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    await request(path, 'POST', { operation: 'apply-audio', mode: review!.mode,
      previewToken: review!.previewToken }, signal);
    setReview(null); remote.reload();
  }, '音频硬件已保存，下次启动实例时生效');
  /**
   * 中文：提交 POST path，完成配置虚拟音视频和设备规则并预览匹配的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Configuring virtual media/device rules and previewing matches. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：operation：签名所示 string 业务值；fields：签名所示 object 业务值；success：签名所示 string 业务值
   * English: Inputs: operation: the string domain value in the signature; fields: the object domain value in the signature; success: the string domain value in the signature
   */
  const usbAction = (operation: string, fields: object, success: string) =>
    void action.run(/** 中文：提交 POST path，完成配置虚拟音视频和设备规则并预览匹配的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Configuring virtual media/device rules and previewing matches. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      await request(path, 'POST', { operation, ...fields }, signal);
      remote.reload();
    }, success);
  return <section className="system-card" aria-label="音视频设备">
    <h3>音视频设备</h3>
    <p>为停止的 x86_64 实例配置双向 HDA 声卡。宿主音频使用 DirectSound；USB 摄像头、麦克风和耳机通过指定设备的厂商/产品 ID 转发。客户机仍需相应驱动。</p>
    <Feedback error={action.error || remote.error || vms.error} message={action.message} />
    <label>目标实例<select aria-label="音视频目标实例" value={vmId}
      onChange={(event) => { setTarget(event.target.value); setReview(null); }}>
      {vms.data?.map((vm) => <option key={vm.id} value={vm.id}>{vm.name} · {vm.status}</option>)}
    </select></label>
    {!vms.data?.length && <p className="subtle-note">请先创建实例。</p>}
    <p className="subtle-note">当前声卡：{remote.data?.audio || '读取中'} · 后端：
      {remote.data?.audioBackend || '读取中'}；DirectSound：
      {remote.data?.support.dsound.available ? '可启动' :
        remote.data?.support.dsound.reason || '探测中'}</p>
    <div className="feature-card">
      <h4>声卡配置</h4>
      <label>音频模式<select aria-label="音频模式" value={mode}
        onChange={(event) => { setMode(event.target.value as Mode); setReview(null); }}>
        <option value="host">宿主输出与麦克风（DirectSound）</option>
        <option value="virtual">仅虚拟声卡（无宿主音频）</option>
        <option value="off">关闭声卡</option>
      </select></label>
      <button className="secondary compact" disabled={action.busy || !vmId}
        onClick={audioPreview}>预览音频配置</button>
      {review && <div className="feature-card" role="region" aria-label="音频配置预览">
        {review.reasons.length > 0 && <p>{review.reasons.join('；')}</p>}
        <pre className="feature-log">{JSON.stringify({ before: review.before,
          after: review.after, qemuAudioArguments: review.qemuAudioArguments }, null, 2)}</pre>
        <button className="primary compact" disabled={action.busy || !review.ready ||
          review.vmId !== vmId || review.mode !== mode} onClick={apply}>应用音频配置</button>
      </div>}
    </div>
    <div className="feature-card">
      <h4>USB 摄像头与麦克风</h4>
      <p>选择宿主列表中的真实 USB 设备。持久规则在实例启动时重新连接；转发成功后再检查客户机设备。未选择的 USB 设备不会连接。</p>
      {remote.data?.usb.hostError && <p>{remote.data.usb.hostError}</p>}
      <pre className="feature-log">{remote.data?.usb.hostDevices || '实例运行后可查看宿主 USB 设备。'}</pre>
      <div className="shortcut-fields">
        <label>设备用途<select aria-label="媒体 USB 用途" value={kind}
          onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="camera">摄像头</option><option value="microphone">麦克风</option>
          <option value="headset">耳机</option>
        </select></label>
        <label>厂商 ID（4 位十六进制）<input aria-label="媒体 USB 厂商 ID"
          value={vendor} maxLength={4} onChange={(event) => setVendor(event.target.value)} /></label>
        <label>产品 ID（4 位十六进制）<input aria-label="媒体 USB 产品 ID"
          value={product} maxLength={4} onChange={(event) => setProduct(event.target.value)} /></label>
      </div>
      <button className="primary compact" disabled={action.busy || !vmId ||
        !parseHex(vendor) || !parseHex(product)} onClick={() => usbAction('save-usb', {
          kind, vendorId: parseHex(vendor), productId: parseHex(product) },
        '媒体设备转发规则已保存')}>保存媒体转发规则</button>
      {!mediaRules.length && <p className="subtle-note">尚无媒体 USB 规则。</p>}
      {mediaRules.map((rule) => <div className="host-peer-row" key={rule.id}>
        <span>{rule.mediaKind} · {hex(rule.vendorId)}:{hex(rule.productId)}</span>
        <button className="secondary compact" disabled={action.busy || !remote.data?.usb.ready ||
          remote.data.usb.configured.some((device) => device.ruleId === rule.id)}
          onClick={() => usbAction('attach-usb', { ruleId: rule.id }, '已请求连接媒体设备')}>
          立即连接</button>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => usbAction('remove-usb', { ruleId: rule.id }, '媒体规则已移除')}>
          删除规则</button>
      </div>)}
      {remote.data?.usb.configured.filter((device) => mediaRules.some((rule) =>
        rule.id === device.ruleId)).map((device) => <div key={device.id} className="host-peer-row">
        <span>已配置 · {hex(device.vendorId)}:{hex(device.productId)}</span>
        <button className="secondary compact" disabled={action.busy}
          onClick={() => usbAction('detach-usb', { deviceId: device.id }, '已请求移除媒体设备')}>
          移除连接</button>
      </div>)}
    </div>
    {remote.data?.guest && <div className="feature-card">
      <h4>客户机识别结果</h4>
      {remote.data.guest.error && <p>{remote.data.guest.error}</p>}
      <pre className="feature-log">声卡：{remote.data.guest.audio || '未识别'}
        {'\n'}视频：{remote.data.guest.video || '未识别'}</pre>
    </div>}
  </section>;
}
