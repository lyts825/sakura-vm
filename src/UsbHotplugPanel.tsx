import { useState } from 'react';
import { formatDateTime } from './localization';
import { Feedback, useAction, useRemote, type Request } from './feature-shared';

type Device = { id: string; vendorId: number; productId: number; ruleId?: string };
type Rule = { id: string; vendorId: number; productId: number; createdAt: string };
type Event = { id: string; operation: 'attach' | 'detach'; status: string;
  vendorId: number; productId: number; source: string; at: string; error?: string };
type View = { ready: boolean; hostDevices: string; hostError: string;
  rules: Rule[]; configured: Device[]; events: Event[] };
const hex = (value: number) => value.toString(16).padStart(4, '0').toUpperCase();
const parse = (value: string) => /^[0-9a-fA-F]{4}$/.test(value) ? Number.parseInt(value, 16) : 0;

export function UsbHotplugPanel({ request, vmId }: { request: Request; vmId: string }) {
  const path = `/vms/${vmId}/usb-hotplug`;
  const remote = useRemote<View>(request, path, true, 5000);
  const action = useAction();
  const [vendor, setVendor] = useState('');
  const [product, setProduct] = useState('');
  const vendorId = parse(vendor), productId = parse(product);
  const submit = (operation: 'save-rule' | 'attach') => void action.run(async (signal) => {
    await request(path, 'POST', { operation, vendorId, productId }, signal);
    remote.reload();
  }, operation === 'save-rule' ? '转发规则已保存' : '已向 QEMU 配置临时 USB 转发');
  const apply = (operation: 'remove-rule' | 'apply-rule' | 'detach', value: object) =>
    void action.run(async (signal) => {
      await request(path, 'POST', { operation, ...value }, signal);
      remote.reload();
    }, operation === 'detach' ? '已请求移除 USB 设备' : 'USB 转发规则已更新');
  return <section className="feature-card" aria-label="USB 热插拔管理">
    <h4>USB 热插拔</h4>
    <p>输入宿主 USB 设备的厂商和产品 ID。持久规则在实例启动后重新配置；临时连接只保留到实例停止。配置转发不代表设备已经在客户机内就绪。</p>
    <Feedback error={action.error || remote.error} message={action.message} />
    <p className="subtle-note">{remote.data?.ready ? '当前实例可配置 USB 转发' : '请启动 x86_64 实例后连接设备'}</p>
    <div className="shortcut-fields">
      <label>厂商 ID（4 位十六进制）
        <input aria-label="USB 厂商 ID" value={vendor} maxLength={4}
          onChange={(event) => setVendor(event.target.value)} placeholder="1234" />
      </label>
      <label>产品 ID（4 位十六进制）
        <input aria-label="USB 产品 ID" value={product} maxLength={4}
          onChange={(event) => setProduct(event.target.value)} placeholder="5678" />
      </label>
    </div>
    <button className="primary compact" disabled={action.busy || !vendorId || !productId}
      onClick={() => submit('save-rule')}>保存启动转发规则</button>{' '}
    <button className="secondary compact" disabled={action.busy || !remote.data?.ready ||
      !vendorId || !productId} onClick={() => submit('attach')}>临时连接</button>
    <h4>宿主可见 USB 设备</h4>
    {remote.data?.hostError && <p>{remote.data.hostError}</p>}
    <pre className="feature-log">{remote.data?.hostDevices || '当前没有可列出的设备，或实例未运行。'}</pre>
    <h4>持久规则</h4>
    {!remote.data?.rules.length && <p className="subtle-note">尚无规则。</p>}
    {remote.data?.rules.map((rule) => <div className="host-peer-row" key={rule.id}>
      <span>{hex(rule.vendorId)}:{hex(rule.productId)}</span>
      <button className="secondary compact" disabled={action.busy || !remote.data?.ready ||
        remote.data.configured.some((device) => device.ruleId === rule.id)}
        onClick={() => apply('apply-rule', { id: rule.id })}>立即应用</button>
      <button className="secondary compact" disabled={action.busy}
        onClick={() => apply('remove-rule', { id: rule.id })}>删除规则</button>
    </div>)}
    <h4>当前配置的转发</h4>
    {!remote.data?.configured.length && <p className="subtle-note">当前没有转发。</p>}
    {remote.data?.configured.map((device) => <div className="host-peer-row" key={device.id}>
      <span>{hex(device.vendorId)}:{hex(device.productId)} · {device.ruleId ? '持久规则' : '临时'}</span>
      <button className="secondary compact" disabled={action.busy}
        onClick={() => apply('detach', { deviceId: device.id })}>移除</button>
    </div>)}
    <h4>最近操作</h4>
    {remote.data?.events.slice(0, 10).map((event) => <p key={event.id}>
      {formatDateTime(event.at)} · {hex(event.vendorId)}:{hex(event.productId)} ·
      {event.operation === 'attach' ? '连接' : '移除'} · {event.status}
      {event.error && ` · ${event.error}`}
    </p>)}
  </section>;
}
