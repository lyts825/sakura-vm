# eBPF 内核性能分析

在运行中的实例打开“能力中心”，选择“eBPF 性能分析”，设置采样秒数（1–10）和每秒频率（10–99 Hz）。执行器在客户机使用 `bpftrace` 的 `profile:hz` 探针聚合内核调用栈，返回热点函数、采样数和可下载的完整 JSON 报告。配置和采样目标由 Sakura 固定生成，不接受任意 bpftrace 程序。

客户机需要安装 `bpftrace`，并由其内核与权限允许加载 eBPF 程序。输出上限为 750 KB，最多解析 500 条调用栈；超过上限会标记为截断。工具缺失、采样失败或没有有效内核栈时明确报错，不能仅凭工具探测宣称分析成功。

探针与退出语法参见 [bpftrace 官方语言文档](https://bpftrace.org/docs/release_025/language)；调用栈聚合格式参见 [官方示例](https://bpftrace.org/tutorial-one-liners)。
