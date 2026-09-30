# 项目 Envoy 边车

能力中心的“服务网格边车”按实例和项目保存一条环回 TCP 代理策略。先选择项目，在第三批能力操作中提交：

```json
{"mode":"save","policy":{"name":"frontend","listenPort":15001,"upstreamPort":8080}}
```

在运行中的 Linux 实例安装兼容的 Envoy 二进制、tmux 与 Python 3 后，提交 `{"mode":"start"}`。Python 和 Linux 内核需支持 pidfd；启动前会实际打开本进程的 pidfd 检查支持，未通过则拒绝启动。Sakura 生成只监听所选项目 `127.0.0.1:15001`、转发到该项目 `127.0.0.1:8080` 的固定配置，在项目网络内运行 `envoy --mode validate`，然后在专属 tmux 会话中启动代理。项目目录、环境及私密配置在进入网络空间后加载；准备阶段只负责工具和命名空间，不加载项目环境。

私有项目只使用独立命名空间的回环接口，不添加网卡、IPv4/IPv6 路由或对外代理。两个私有项目可以使用相同端口，共享网络项目与私有项目也可以复用端口；两个共享网络项目仍不能保存相同监听端口。将私有项目切换到共享网络时也会重新检查端口冲突。边车关闭热重启并固定一个工作线程，避免多个 Envoy 实例共享默认热重启资源，参数见 [Envoy 官方命令行说明](https://www.envoyproxy.io/docs/envoy/latest/operations/cli)。宿主需要临时访问私有边车时，使用绑定该项目的 [临时 TCP 隧道](reverse-tunnel.md)。

`status` 返回工具可用性、实际代理进程、启动标识及 `bindingValid`。检查包括当前项目、目录、网络模式和策略的绑定摘要、客户机配置文件摘要、唯一窗格与实际 Envoy 程序及参数、工作目录、进程网络空间和属于该进程的回环监听。检查失败时报告未就绪，不把已存在的 tmux 会话直接视为可用代理。项目网络已有额外接口或路由时，启动与使用状态检查都会拒绝。

`stop` 停止此项目的会话，并通过 pidfd 清理仍在使用该项目固定配置文件的 Envoy，包括会话已丢失的遗留代理；其他项目的会话和代理保留。启动失败、超时或取消只清理本次启动标识对应的代理。`remove` 在停止后删除宿主策略与客户机配置文件。更换策略、修改项目目录或网络模式、禁用能力前必须停止边车；暂停实例须先恢复，以核对并停止实际进程。策略保存、启动、停止和能力配置与实例操作互斥，启动时再次核对能力是否已被禁用。

宿主控制服务重启保留已有边车并重新核对绑定；客户机重启后需再次手动启动。原第 1 版策略文件仍可读取。旧版会话缺少绑定元数据时，先 `stop` 再 `start`，不能直接恢复为可信运行状态。仅发现二进制路径、但实际版本检查或配置验证失败的 Envoy 不会被标为可用运行代理。

配置采用 Envoy 官方的 [静态 listener/cluster](https://www.envoyproxy.io/docs/envoy/latest/start/quick-start/configuration-static.html)和 [TCP proxy filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/listeners/network_filters/tcp_proxy_filter) 结构。不提供 Envoy 管理端口、动态 xDS、TLS 凭据、透明流量劫持或跨主机服务发现。网络与进程核对适用于 Sakura 管理的边车；客户机 root 自行改动进程、文件及命名空间仍属于 [项目网络隔离](project-network-isolation.md) 的既有限制。

`npm run test:service-mesh -- debian` 和 `-- ubuntu` 使用真实虚拟机与 [官方 Envoy 1.39.1](https://github.com/envoyproxy/envoy/releases/tag/v1.39.1) 的固定 SHA-256 二进制。已验证三个并行代理使用相同端口而流量与网络分开、目录和环境、Windows DPAPI 密钥加载且结果不暴露密钥、宿主 SSH 桥接、控制服务重启、暂停保护、配置变动拒绝、旧会话与脱离会话代理清理、启动取消、额外路由拒绝，以及真实客户机重启后手动恢复。测试实例独立，结束时关闭并移除。

同一官方 glibc 二进制在当前 Alpine 3.23 加 gcompat 的客户机中缺少 `pthread_cond_clockwait` 和 `__res_init`，未完成真实代理验证。`-- alpine` 当前只验证这个兼容性失败被生产启动入口拒绝、未留下代理，且状态报告未就绪；其成功退出不代表 Alpine 代理流量通过。Alpine 使用前仍需另外安装与该发行版兼容的 Envoy。
