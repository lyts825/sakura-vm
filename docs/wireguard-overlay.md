# WireGuard 覆盖网络

启用平台和私密配置插件后，在运行中的 Linux 实例的“能力中心”选择 **WireGuard 覆盖网络**。此功能管理客户机内的 `wg-sakura` 接口；Alpine 会按需安装 `wireguard-tools`，Debian/Ubuntu 会安装 `wireguard-tools` 和 `iproute2`。需要客户机内核支持 WireGuard。Sakura 只管理覆盖网段，不接管默认路由，也不自动更改宿主防火墙或建立入站 UDP 转发。

先生成密钥：

```json
{"mode":"generate-key","secret":"WireGuardPrivate"}
```

返回公钥，将它交给对端配置。私钥只保存到本实例的私密配置，执行结果和磁盘上的覆盖网络配置不包含私钥。接着填写本机隧道地址、监听端口和对端：

```json
{"mode":"save","config":{"address":"10.88.0.1/32","listenPort":51820,"privateKeySecret":"WireGuardPrivate","peers":[{"publicKey":"<对端 44 字符公钥>","endpoint":"vpn.example.com:51820","allowedIPs":["10.88.0.2/32"],"keepaliveSeconds":25}]}}
```

公钥和网段会校验；`allowedIPs` 可以包含 IPv4/IPv6 CIDR，但不能包含 `/0` 默认路由。同一公钥或网段不能重复。`endpoint` 可省略，适用于仅接受对端主动连接的场景；若客户机在 QEMU NAT 后面，请先确保对端可达，通常由客户机主动连接远端，并使用保活。配置保存后提交 `{"mode":"start"}` 创建接口和覆盖路由；`{"mode":"status"}` 返回当前公钥和对端最近握手时间，不返回私钥。`{"mode":"stop"}` 移除该接口及关联路由并关闭开机恢复。修改配置前先停止接口。

启动后，Sakura 每 30 秒检查实例重启状态，并在客户机重新运行时恢复已启用的接口；失败会在状态的 `lastAutoError` 中显示，五分钟后重试。密钥临时传入客户机的 `/run` 文件，权限为 `0600`，配置成功或失败后删除。操作只管理固定名称 `wg-sakura`；如果同名接口使用了别的公钥，Sakura 拒绝接管或删除。

专项验证：`npm run test:wireguard` 在真实 Alpine/QEMU 客户机内创建两个 WireGuard 接口，验证公钥派生、握手、隧道内 ping、停止和重新启动、客户机重启后的自动恢复。`npm test` 覆盖参数注入、重复对端与默认路由拒绝。
