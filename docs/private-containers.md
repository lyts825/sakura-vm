# 私有项目容器

Debian 和 Ubuntu 项目选择“独立命名空间”后，可在容器面板安装 Docker / Compose，再启动该项目的 Docker 环境。每个项目拥有独立的 Docker、containerd、Unix 套接字、镜像、容器和数据卷；两个项目可以使用相同的容器名和应用端口。Alpine 容器面板目前不支持此路径。

Docker 与 containerd 由未启用开机自启的 systemd 服务放入项目网络命名空间。容器的 `host` 网络是这个项目的仅回环网络。Sakura 不为项目创建网桥、转发、NAT 或端口发布，也不通过客户机共享 Docker 启动私有工作负载。启动和每次执行核对服务、文件内容、启动标识、程序参数、实际进程与容器的网络空间，以及接口和 IPv4/IPv6 路由。

## 镜像与构建

先在容器面板的镜像输入框填入所需镜像，点“拉取镜像”。Sakura 使用客户机共享网络预取镜像，导出后导入本项目的 Docker。准备步骤只加载实例网络配置；项目环境和密钥随后在私有执行阶段加载。项目保存的 `DOCKER_HOST`、Docker context 或 TLS 配置不能改变受管客户端的连接。

Dockerfile 模式在项目网络中构建，将项目挂载到 `/workspace`，并传入解析后的项目环境。联网的 `RUN` 步骤会失败；基础镜像和依赖需预先准备。已有同名容器直接启动，更新构建需要先删除旧容器。

## Compose 与 Dev Container

私有 Compose 的每个服务必须显式设置 `network_mode: host`，使用应用自身的监听端口，省略 `ports` 和 `networks`。例如：

```yaml
services:
  app:
    image: your-prepared-image:tag
    network_mode: host
    command: ["your-app", "--listen", "127.0.0.1:8080"]
```

Sakura 解析最终 Compose 配置，拒绝特权容器及 `NET_ADMIN`、`SYS_ADMIN`、`ALL` 额外能力，固定构建网络并将重启策略设为 `no`。未被服务引用的顶层网络定义会移除，以统一 Compose v1 与 v2 的处理且不创建网桥。配置中的项目环境替换发生在项目网络中；含密钥的临时配置使用受限权限，在完成、失败或取消后删除。数据卷保留在此项目的 Docker 数据目录。

安装官方 Dev Container CLI 后，可按 `devcontainer.json` 创建镜像或 Dockerfile 环境，也可使用符合上述条件的 Compose 配置。CLI 使用固定的项目 Docker 和 Compose 客户端；客户端拒绝切换连接、网桥网络、上述额外权限及自行开机恢复。CLI 的下载、功能包或创建后脚本如需联网，应预先准备所需内容。模板元数据与模板应用属于共享网络准备步骤，不加载项目密钥。

## 数据库预设

能力中心的 PostgreSQL 16、MySQL 8、Redis 7 预设也可用于私有项目，需要同时启用容器插件并安装 Docker。预设先准备项目 Docker 和镜像，核对项目端口未被占用，再让数据库直接监听项目 `127.0.0.1` 上指定的端口，创建项目内的数据卷。启动后通过数据库自带客户端进行认证查询，退出或未就绪会使任务失败并清理本次容器。不同项目可复用相同的数据库名称和端口；复用保留的数据卷时需使用原有数据库凭据。

任务输出遮盖数据库密码及项目密钥；容器列表不返回命令参数。读取日志时另核对容器环境中的密码、令牌和密钥字段以及 Redis `--requirepass` 参数，遮盖对应值。数据库仍可能按自己的日志格式输出其他敏感内容，日志遮盖范围由这些已知配置值决定。

## 停止、恢复与绑定

“停止项目 Docker 环境”先停止此项目容器，再停止其 Docker / containerd，保留容器记录、镜像和数据卷。控制服务重载保留仍有效的客户机环境；客户机重启后需要先启动项目 Docker，再启动原容器。Sakura 不在客户机开机时直接恢复未经项目绑定核对的容器。

修改项目目录或网络模式前，先移除项目容器并停止环境；已停止的容器也阻止变更。该保护位于项目核心服务，停用容器插件仍然有效。暂停实例须先恢复。若在停机期间修改绑定，而旧 Docker 数据中仍有容器，下次启动会拒绝使用；恢复旧设置、移除旧容器并停止环境后再修改。共享项目改成私有项目时也必须先清理原有受管容器。

配置文件被改动或实际网络不符时，面板显示原因并禁止工作负载操作，仍提供停止环境入口。失败或取消只清理本次创建的容器，不停止其他项目。独立 Docker 会增加客户机内存和镜像存储占用；容器数据不在项目目录配额范围内。

这是 Sakura 托管容器的网络分段。独立 SSH、显式实例管理命令、客户机 root、自行使用 Docker API 或启动的进程仍沿用 [项目网络隔离](project-network-isolation.md) 的边界。

## 验证

`npm run test:private-containers -- debian|ubuntu` 创建独立临时虚拟机，安装客户机 Docker / Compose 与官方 CLI，使用本地 BusyBox 测试镜像，复核两个私有项目的同端口 HTTP、实际网络、环境和 Windows DPAPI 密钥、Compose、Dockerfile、Dev Container、绑定保护、取消及真实实例重启。数据库流程使用真实 Redis 镜像和协议，不使用数据库假服务。

Docker Hub 不可达时，测试可以先从 Docker 官方镜像的 ECR 发布源准备相同镜像，再验证生产预取、导入和数据库入口：

```powershell
$env:SAKURA_REDIS_SMOKE_IMAGE='public.ecr.aws/docker/library/redis:7-alpine'
npm run test:private-containers -- debian
```

此变量只用于测试镜像准备，不改变生产数据库预设的镜像源。`npm run test:private-databases -- debian|ubuntu` 另通过三种数据库的官方镜像和原生客户端验证认证查询、同端口和同名容器、两项目各自的数据、容器重启持久化、实际进程网络与外网拒绝。数据库验证从 Docker 官方 ECR 发布源准备镜像，再核对生产导入后的镜像标识；下载失败最多重试两次，仍失败则报告错误。

x86 实例固定使用支持 x86-64-v2 的 `Nehalem-v1` 虚拟 CPU，满足当前 MySQL 8 镜像的指令要求；ARM64 仍使用 `cortex-a57`。变更在下次实例启动时生效，磁盘内容保留；旧 x86 CPU 下保存的内存快照不能在新 CPU 上恢复，需重新制作内存快照。在线迁移在修改实例状态前核对两端实际 CPU 类型与拓扑。

设计依据：[Docker 多守护程序](https://docs.docker.com/reference/cli/dockerd/#run-multiple-daemons)、[host 网络](https://docs.docker.com/engine/network/drivers/host/)、[Compose network_mode](https://docs.docker.com/reference/compose-file/services/#network_mode)、[Dev Container CLI 0.82.0](https://github.com/devcontainers/cli/blob/v0.82.0/src/spec-node/devContainersSpecCLI.ts)、[Docker 官方 ECR 镜像目录](https://gallery.ecr.aws/docker/)。Docker 将同机多个守护程序标为实验性用法；本实现限定上述两个发行版并分别验证。
