/** 独立网络进程持有的绝对截止时间；父进程冻结不延长外连。 */
export class BoundedQmpPolicy {
  constructor(qmp, failClosed) { this.qmp = qmp; this.failClosed = failClosed; this.entries = new Map(); this.queues = new Map(); }
  serial(id, work) {
    const result = (this.queues.get(id) || Promise.resolve()).then(work);
    this.queues.set(id, result.catch(() => {}));
    return result;
  }
  state(entry) { return { isolated: entry.isolated, expiresAt: entry.expiresAt, observedAt: new Date().toISOString() }; }
  async replace(entry, isolated) {
    entry.isolated = null;
    try {
      await this.qmp('netdev_del', { id: entry.hub.id });
      await this.qmp('netdev_del', { id: entry.config.id });
      await this.qmp('netdev_add', { ...entry.config, restrict: isolated, ipv6: false });
      await this.qmp('netdev_add', entry.hub);
      entry.isolated = isolated;
    } catch (error) { this.failClosed(error); throw error; }
  }
  apply(input) {
    const { config, hub, isolated, expiresAt } = input;
    if (!config || config.type !== 'user' || !/^n[a-f0-9]{32}u$/.test(config.id) ||
        !hub || hub.type !== 'hubport' || hub.id !== config.id.slice(0, -1) + 'hu' || hub.netdev !== config.id ||
        typeof isolated !== 'boolean' || (!isolated && (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 86400000)))
      throw new Error('Invalid bounded network policy');
    return this.serial(config.id, async () => {
      const previous = this.entries.get(config.id);
      if (previous) clearTimeout(previous.timer);
      const entry = { config, hub, isolated: null, expiresAt: isolated ? null : expiresAt, timer: undefined };
      this.entries.set(config.id, entry);
      await this.replace(entry, true);
      if (!isolated) {
        // Register the independent deadline before connectivity can be enabled.
        entry.timer = setTimeout(() => {
          void this.serial(config.id, async () => {
            if (this.entries.get(config.id) !== entry) return;
            await this.replace(entry, true);
          }).catch(error => this.failClosed(error));
        }, Math.max(1, expiresAt - Date.now()));
        if (expiresAt <= Date.now()) throw new Error('Network policy expired during installation');
        await this.replace(entry, false);
      }
      return this.state(entry);
    });
  }
  observe(id) { return this.serial(id, () => { const entry = this.entries.get(id); return entry ? this.state(entry) : null; }); }
  forget(id) { return this.serial(id, () => { const entry = this.entries.get(id); if (entry) clearTimeout(entry.timer); this.entries.delete(id); }); }
  close() { for (const entry of this.entries.values()) clearTimeout(entry.timer); this.entries.clear(); }
}
