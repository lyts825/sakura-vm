# 客户机 DNS 与 DNSSEC 诊断

在实例运行后，进入“能力中心”，选择“私有 DNS 与 DNSSEC”进行检查或运行。Sakura 在客户机内读取 `/etc/resolv.conf`，报告实际文件来源、名称服务器和搜索域；同时检测 `resolvectl`、`dig`、`delv`、`drill`、`unbound-host` 是否可用。如果客户机安装了 `resolvectl`，还显示它报告的 DNSSEC 状态。运行会生成可在任务历史中查看的诊断结果。

诊断不修改 DNS 设置，也不向外部域名发送测试查询。工具存在和解析器配置可读并不等于 DNSSEC 验证已生效，所以结果中的 `dnssecValidation` 固定为 `not-verified`。客户机停机或配置不可读时不会报告就绪；错误输出不保存在诊断结果中。

`npx tsx --test tests/guest-dns.test.ts` 覆盖结构化结果、停机、失败和任务历史；`npm run test:guest-dns` 在真实 Alpine/QEMU 客户机上运行诊断。缺少 DNSSEC 工具时会如实返回空列表。
