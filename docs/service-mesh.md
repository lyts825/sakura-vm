# 项目 Envoy 边车

能力中心的“服务网格边车”按实例和项目保存一条环回 TCP 代理策略。先选择项目，在第三批能力操作中提交：

```json
{"mode":"save","policy":{"name":"frontend","listenPort":15001,"upstreamPort":8080}}
```

在运行中的 Linux 实例安装 Envoy 与 tmux 后，提交 `{"mode":"start"}`。Sakura 将生成只监听客户机 `127.0.0.1:15001`、转发到 `127.0.0.1:8080` 的固定 Envoy 配置，用 `envoy --mode validate` 验证，再在专属 tmux 会话中启动。`status` 返回策略、工具探测与运行状态。`stop` 停止此项目的会话；`remove` 在停止后删除宿主策略与客户机配置文件。更换策略或禁用能力前必须停止运行中的边车；同一实例的两个项目不能占用相同监听端口。

配置采用 Envoy 官方的 [静态 listener/cluster](https://www.envoyproxy.io/docs/envoy/latest/start/quick-start/configuration-static.html)和 [TCP proxy filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/listeners/network_filters/tcp_proxy_filter) 结构。没有 Envoy 管理端口、动态 xDS、TLS 凭据、透明流量劫持或跨主机服务发现。客户机重启后需再次手动启动边车；宿主策略会保留。该功能需要用户预先安装兼容的 Envoy 二进制。当前验证覆盖配置生成、项目隔离、缺失依赖拒绝、保存与停止流程；本机没有运行中的 Envoy，因此未宣称完成真实代理流量的客户机端到端验证。
