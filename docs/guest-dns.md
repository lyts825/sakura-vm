# 私有 DNS 与 DNSSEC

实例运行后，在“开发 → 网络配置”输入 DNS 服务器和私有路由域名，例如 `corp.example`；可选择沿用系统 DNSSEC 设置、强制验证、允许降级或关闭验证。私有路由或 DNSSEC 策略都需要明确指定 DNS 服务器。先预览，再应用。私有路由域名会写入 systemd-resolved 的 `Domains=~...` 配置，未指定路由域名时自定义 DNS 沿用 `~.` 全局路由。应用后 Sakura 读取 `resolvectl dns`、`resolvectl domain` 和 `resolvectl dnssec`，逐项确认所选配置已经生效。强制 DNSSEC 可能拒绝未签名的私有域名。

私有路由与 DNSSEC 策略要求客户机启用 systemd-resolved，且 `/etc/resolv.conf` 由它管理。如果链接原先指向直连上游文件，Sakura 会在预览中列出链接变更，应用时切到本地 stub，使普通解析器经过 systemd-resolved；恢复操作会还原原始链接和配置文件。回滚计划在首次写入前保存。外部程序修改过配置文件或链接时，恢复会拒绝覆盖并提示先处理冲突。Alpine 当前只支持静态 DNS 地址，不支持这两项策略。

能力中心的“私有 DNS 与 DNSSEC”可读取客户机当前解析器来源、名称服务器、搜索域、路由域名和 DNSSEC 模式。它还检测可用工具，但不发送外部 DNS 查询，`dnssecValidation` 因而保持 `not-verified`；策略显示为 `yes` 也不等于已证明某次查询的签名有效。

`npx tsx --test tests/network-profiles.test.ts tests/guest-dns.test.ts` 覆盖配置验证、状态核对、链接冲突与回滚。`npm run test:guest-dns` 验证真实 Alpine/QEMU 诊断；`npm run test:private-dns` 在真实 Debian/QEMU 客户机上验证路由查询、DNSSEC 策略和恢复。路由域名与 DNSSEC 模式遵循 [systemd-resolved 的接口语义](https://www.freedesktop.org/software/systemd/man/247/org.freedesktop.resolve1.html)。
