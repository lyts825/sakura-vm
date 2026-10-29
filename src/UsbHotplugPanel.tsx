/**
 * 模块职责（中文）：配置 USB 热插拔匹配规则，查看设备、连接事件并提交挂载/移除操作。
 * Module responsibility (English): Managing USB matching rules, connection events and attachment operations.
 * 详细范围（中文）：公开入口包括 UsbHotplugPanel；职责覆盖管理 USB 匹配规则、连接事件与挂载操作，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include UsbHotplugPanel. The scope covers Managing USB matching rules, connection events and attachment operations. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { useId, useState } from 'react';
import { formatDateTime } from './localization';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';
import './usb-hotplug-panel.css';

type Device = { id: string; vendorId: number; productId: number; ruleId?: string };
type Rule = { id: string; vendorId: number; productId: number; createdAt: string };
type Event = { id: string; operation: 'attach' | 'detach'; status: string;
  vendorId: number; productId: number; source: string; at: string; error?: string };
type View = { ready: boolean; hostDevices: string; hostError: string;
  rules: Rule[]; configured: Device[]; events: Event[] };
/**
 * 中文：把 USB 标识数字转换为四位大写十六进制文本，供表单回显。
 * English: Convert numeric USB identifiers into four-digit uppercase hexadecimal for form display.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const hex = (value: number) => value.toString(16).padStart(4, '0').toUpperCase();
/**
 * 中文：仅四位十六进制文本转换为整数，无效值返回零由表单校验继续处理。
 * English: Convert only four-digit hexadecimal text to an integer; invalid input returns zero for subsequent form validation.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
const parse = (value: string) => /^[0-9a-fA-F]{4}$/.test(value) ? Number.parseInt(value, 16) : 0;

/**
 * 中文：呈现管理 USB 匹配规则、连接事件与挂载操作中的 UsbHotplugPanel 界面，订阅 path，将表单输入和用户动作绑定到当前传入上下文；错误与在途状态由本组件调用的反馈入口显示
 * English: Render the UsbHotplugPanel surface for Managing USB matching rules, connection events and attachment operations, subscribing to path. Bind form input/user actions to the supplied context; the invoked feedback surface displays errors/in-flight state
 * 中文：输入：{ request, vmId } 提供 request（带身份和权限作用域的传输能力）、vmId（当前实例标识） 上下文字段
 * English: Inputs: { request, vmId } provides context fields request (transport capability bound to identity/authority scope), vmId (current VM identifier)
 * 中文：结果：当前状态对应的 React 节点，未满足显示条件的分支可返回空节点
 * English: Result: React nodes for current state; branches without display conditions may return an empty node
 */
export function UsbHotplugPanel({ request, vmId }: { request: Request; vmId: string }) {
  const path = `/vms/${vmId}/usb-hotplug`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [vendor, setVendor] = useState('');
  const [product, setProduct] = useState('');
  const [pendingOperation, setPendingOperation] = useState('');
  const hintId = useId();
  const vendorId = parse(vendor), productId = parse(product);
  /**
   * 中文：提交 POST path，完成管理 USB 匹配规则、连接事件与挂载操作的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Managing USB matching rules, connection events and attachment operations. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：operation：签名所示 'save-rule' | 'attach' 业务值
   * English: Inputs: operation: the 'save-rule' | 'attach' domain value in the signature
   */
  const submit = (operation: 'save-rule' | 'attach') => void action.run(/** 中文：提交 POST path，完成管理 USB 匹配规则、连接事件与挂载操作的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Managing USB matching rules, connection events and attachment operations. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
    setPendingOperation(operation);
    await request(path, 'POST', { operation, vendorId, productId }, signal);
    remote.reload();
  }, operation === 'save-rule' ? '转发规则已保存' : '已向 QEMU 配置临时 USB 转发');
  /**
   * 中文：提交 POST path，完成管理 USB 匹配规则、连接事件与挂载操作的数据交互；异步失败传给此处的捕获分支或外层动作反馈
   * English: Perform POST path for Managing USB matching rules, connection events and attachment operations. Propagate asynchronous failure to this catch path or the outer action feedback
   * 中文：输入：operation：签名所示 'remove-rule' | 'apply-rule' | 'detach' 业务值；value：待校验、转换或保存的输入值
   * English: Inputs: operation: the 'remove-rule' | 'apply-rule' | 'detach' domain value in the signature; value: input value to validate/transform/save
   */
  const apply = (operation: 'remove-rule' | 'apply-rule' | 'detach', value: object) =>
    void action.run(/** 中文：提交 POST path，完成管理 USB 匹配规则、连接事件与挂载操作的数据交互；异步失败传给此处的捕获分支或外层动作反馈 | English: Perform POST path for Managing USB matching rules, connection events and attachment operations. Propagate asynchronous failure to this catch path or the outer action feedback | 中文：输入：signal：本次调用的取消寿命 | English: Inputs: signal: cancellation lifetime for this invocation | 中文：结果：异步完成时兑现 Promise，状态变化通过上述副作用交付；未捕获失败继续拒绝 | English: Result: fulfill the promise at asynchronous completion, delivering changes through the described effects; uncaught failures keep rejecting */ async (signal) => {
      setPendingOperation(operation);
      await request(path, 'POST', { operation, ...value }, signal);
      remote.reload();
    }, operation === 'detach' ? '已请求移除 USB 设备' : 'USB 转发规则已更新');
  const loading = !remote.data && !remote.error;
  const readiness = remote.data ? remote.data.ready ? '当前实例可配置 USB 转发' : '请启动 x86_64 实例后连接设备'
    : loading ? '正在读取 USB 设备与转发状态…' : 'USB 转发状态尚未读取成功。';
  const pendingLabels: Record<string, string> = { 'save-rule': '正在保存启动转发规则…', attach: '正在配置临时 USB 转发…',
    'remove-rule': '正在删除转发规则…', 'apply-rule': '正在应用转发规则…', detach: '正在请求移除 USB 设备…' };
  return <section className="feature-card usb-hotplug-panel" aria-label="USB 热插拔管理">
    <div className="usb-panel-heading"><h4>USB 热插拔</h4>
      <button className="secondary compact" disabled={action.busy} onClick={remote.reload}>刷新设备状态</button>
    </div>
    <p>输入宿主 USB 设备的厂商和产品 ID。持久规则在实例启动后重新配置；临时连接只保留到实例停止。配置转发不代表设备已经在客户机内就绪。</p>
    <Feedback error={action.error || remote.error} message={action.message} />
    <p id={`${hintId}-ready`} className="usb-readiness" role="status">{readiness}</p>
    {remote.error && <p className="subtle-note">{remote.data ? '当前显示上次读取的设备状态，请刷新重试。' : '请刷新设备状态重试。'}</p>}
    {action.busy && <p className="usb-operation-status" role="status">{pendingLabels[pendingOperation] || '正在处理 USB 操作…'}</p>}
    <div className="usb-panel-section">
    <h5>配置转发</h5>
    <p id={`${hintId}-ids`} className="subtle-note">厂商和产品 ID 各为 4 位十六进制，例如 1234 和 5678；不能为 0000。</p>
    <div className="usb-id-fields">
      <label>厂商 ID（4 位十六进制）
        <input aria-label="USB 厂商 ID" value={vendor} maxLength={4}
          aria-describedby={`${hintId}-ids`} spellCheck={false}
          onChange={(event) => setVendor(event.target.value)} placeholder="1234" />
      </label>
      <label>产品 ID（4 位十六进制）
        <input aria-label="USB 产品 ID" value={product} maxLength={4}
          aria-describedby={`${hintId}-ids`} spellCheck={false}
          onChange={(event) => setProduct(event.target.value)} placeholder="5678" />
      </label>
    </div>
    <div className="usb-panel-actions">
    <button className="primary compact" disabled={action.busy || !vendorId || !productId}
      aria-describedby={!vendorId || !productId ? `${hintId}-ids` : undefined}
      onClick={() => submit('save-rule')}>保存启动转发规则</button>
    <button className="secondary compact" disabled={action.busy || !remote.data?.ready ||
      !vendorId || !productId} aria-describedby={`${hintId}-ready ${hintId}-ids`} onClick={() => submit('attach')}>临时连接</button>
    </div>
    </div>
    {remote.data && <>
      <div className="usb-panel-section">
        <h5>宿主可见 USB 设备</h5>
        {remote.data.hostError && <p className="machine-error" role="alert">{remote.data.hostError}</p>}
        {remote.data.hostDevices ? <pre className="feature-log" role="region" aria-label="宿主 USB 设备列表" tabIndex={0} data-locale-ignore>{remote.data.hostDevices}</pre>
          : <p className="usb-empty">{remote.data.hostError ? '宿主设备列表暂不可用。' : '当前没有可列出的设备，或实例未运行。'}</p>}
      </div>
      <div className="usb-panel-section">
        <div className="usb-panel-heading"><h5>持久规则</h5><span className="usb-count">{remote.data.rules.length} 条规则</span></div>
        {!remote.data.rules.length && <p className="usb-empty">尚无规则。</p>}
        <ul className="usb-device-list">
          {remote.data.rules.map((rule, index) => {
            const configured = remote.data!.configured.some((device) => device.ruleId === rule.id);
            const reason = !remote.data!.ready ? '启动 x86_64 实例后才能应用规则。' : configured ? '此规则已配置转发；配置转发不代表设备已在客户机内就绪。' : '';
            const reasonId = `${hintId}-rule-${index}`;
            return <li className="usb-device-item" key={rule.id}>
              <strong className="usb-device-id" data-locale-ignore>{hex(rule.vendorId)}:{hex(rule.productId)}</strong>
              <dl><div><dt>规则标识</dt><dd><code data-locale-ignore>{rule.id}</code></dd></div>
                <div><dt>创建时间</dt><dd><time dateTime={rule.createdAt}>{formatDateTime(rule.createdAt)}</time></dd></div></dl>
              {reason && <p id={reasonId} className="subtle-note">{reason}</p>}
              <div className="usb-panel-actions">
                <button className="secondary compact" disabled={action.busy || !remote.data?.ready || configured}
                  aria-describedby={reason ? reasonId : undefined}
                  onClick={() => apply('apply-rule', { id: rule.id })}>立即应用</button>
                <button className="secondary compact" disabled={action.busy}
                  onClick={() => apply('remove-rule', { id: rule.id })}>删除规则</button>
              </div>
            </li>;
          })}
        </ul>
      </div>
      <div className="usb-panel-section">
        <div className="usb-panel-heading"><h5>当前配置的转发</h5><span className="usb-count">{remote.data.configured.length} 个转发</span></div>
        {!remote.data.configured.length && <p className="usb-empty">当前没有转发。</p>}
        <ul className="usb-device-list">
          {remote.data.configured.map((device) => <li className="usb-device-item" key={device.id}>
            <div className="usb-panel-heading"><strong className="usb-device-id" data-locale-ignore>{hex(device.vendorId)}:{hex(device.productId)}</strong><span className="usb-count">{device.ruleId ? '持久规则' : '临时'}</span></div>
            <dl><div><dt>设备标识</dt><dd><code data-locale-ignore>{device.id}</code></dd></div>
              {device.ruleId && <div><dt>规则标识</dt><dd><code data-locale-ignore>{device.ruleId}</code></dd></div>}</dl>
            <button className="secondary compact" disabled={action.busy}
              onClick={() => apply('detach', { deviceId: device.id })}>移除</button>
          </li>)}
        </ul>
      </div>
      <div className="usb-panel-section">
        <div className="usb-panel-heading"><h5>最近操作</h5><span className="usb-count">显示 {Math.min(remote.data.events.length, 10)} / {remote.data.events.length} 条</span></div>
        {!remote.data.events.length ? <p className="usb-empty">暂无操作记录。</p> : <div className="usb-events" tabIndex={0} role="region" aria-label="USB 最近操作记录">
          <ol>
            {remote.data.events.slice(0, 10).map((event) => <li key={event.id}>
              <div className="usb-panel-heading"><strong>{event.operation === 'attach' ? '连接' : '移除'} · <span data-locale-ignore>{event.status}</span></strong><time dateTime={event.at}>{formatDateTime(event.at)}</time></div>
              <dl><div><dt>厂商与产品 ID</dt><dd data-locale-ignore>{hex(event.vendorId)}:{hex(event.productId)}</dd></div>
                <div><dt>来源</dt><dd data-locale-ignore>{event.source}</dd></div></dl>
              {event.error && <p className="machine-error">{event.error}</p>}
            </li>)}
          </ol>
        </div>}
      </div>
    </>}
  </section>;
}
