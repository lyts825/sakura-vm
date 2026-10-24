# 交互式实验插件包设计

## 1. 版本与使用结果

设计 3.0.0，2026-10-24；基线 2.7.0 / `912287a`。`learning-lab` 含 11 个拟议插件，实现待开始，公共规则见[第三批总览](plugin-pack-suite-design.md)。

用户编写固定课程，在专用环境完成文件、配置和请求实验，查看检查证据与学习进度，再交接课程和个人记录。它在[知识文档](knowledge-studio.md)的阅读之外增加可操作练习，环境制作仍可选用[工坊](foundry-workbench.md)的固定镜像。

首版是本地所有者自学工具，不提供多人考试、隐藏答案保护或认证证书。课内动作限固定文件编辑、内置演示服务和受控请求；任意终端命令、用户脚本、外部网络和生产应用操作留待独立扩展。

## 2. 内部插件与依赖

短依赖前缀为 `learning-`。

| 插件 ID | 专属对象、职责与主要服务方法 | 必需依赖 | 可选依赖 |
| --- | --- | --- | --- |
| `learning-courses` | 空间、课程修订、顺序与适用范围；LearningCoursesV1：create、seal、compare | — | — |
| `learning-assets` | 课件、样例文件、许可和镜像引用；LearningAssetsV1：upload、pin、inspect | courses | @foundry-catalog |
| `learning-lessons` | 讲解、目标、前置课和完成条件；LearningLessonsV1：compile、validateOrder | courses, assets | — |
| `learning-environments` | 专用实验副本、检查点和原身份；LearningEnvironmentsV1：prepare、checkpoint、restore、cleanup | courses, assets, @projects | — |
| `learning-steps` | 固定动作及可编辑字段；LearningStepsV1：compile、previewAction | lessons, assets | — |
| `learning-checks` | 固定检查规则、反馈和评分声明；LearningChecksV1：compile、explainRules | lessons | — |
| `learning-sessions` | 实验会话、逐步执行和真实检查记录；LearningSessionsV1：preview、start、step、cancel、reconcile | environments, steps, checks, lessons | — |
| `learning-progress` | 实际主体、课程修订与尝试记录；LearningProgressV1：viewProgress、compareAttempts | courses, sessions | — |
| `learning-assessments` | 检查结果、人工自评和完成报告；LearningAssessmentsV1：evaluate、recordSelfReview、seal | progress, sessions, checks | — |
| `learning-exchange` | 课程、材料与个人记录交换；LearningExchangeV1：export、inspectImport、acceptImport | courses, assets, lessons, environments, steps, checks, sessions, progress, assessments | — |
| `learning-workbench` | 编课、练习、反馈、进度和交接；LearningWorkbenchV1：view、templates | * | — |

checks 仅编译声明，实际检查由 sessions 的固定工具完成，assessments 消费封存回执，避免 checks 与 sessions 循环依赖。进度归属实际登录主体，用户填写的“学员名称”不改变账号权限。

## 3. 完整用户流程

1. 选择“文件与目录”“配置修复”或“请求与响应”，建立课程并检查前置课关系。
2. 导入课件、固定样例和预备镜像，预览全部动作、可编辑路径和资源预算。
3. 封存课程后创建个人实验会话，显式准备专用 VM。
4. 阅读当前目标，在课内编辑器修改允许文件，或提交固定服务/请求动作，再运行检查。
5. 查看实际反馈和尝试差异；按原环境创建检查点，或显式从检查点建立新会话。
6. 生成注明自学性质的完成记录，导出课程或个人记录，核销专用环境。

## 4. 课程、动作与进度

课程正文采用静态文本和受限图片。图片有尺寸与解码预算，不执行 HTML、脚本、链接资源或包内工具。课程作者可以定义顺序和规则，但不能新增宿主执行方法。

动作集合固定为列举/读取允许文件、写入有界文本、启动或停止内置演示服务、向该服务发送受限请求。路径固定在本次学习项目内，拒绝链接和父目录逃逸。服务和检查器由宿主审核的工具提供，不从课程包加载代码。

每次 step 绑定课程、课节、动作、原会话、实际主体和预期状态。重复提交返回原动作回执。课程内容或环境身份改变后拒绝旧动作计划；学习者修改的文件被捕获为检查输入，结果包含实际摘要。

状态为 `ready → active → paused → finished`，并独立记录 interrupted、结果和清理。暂停先停止本包演示进程；重启仅恢复记录，不恢复服务执行。检查点恢复创建新副本和新会话，保留旧尝试，不把旧通过状态复制成新检查结果。

课程升级显示新增和修改课节，旧进度仍属于旧修订。人工自评、导入的完成声明和本机工具检查分别标记。首版不防范拥有本机管理员权限的使用者改动环境，因此不用于防作弊认证。

## 5. 入口与预算

工作台提供课程编辑、准备检查、课节、文件练习、反馈、尝试历史和交接；CLI 别名 `learning`。

| 操作 | 拟议 HTTP | CLI | 输出 |
| --- | --- | --- | --- |
| 课程校验 | `/api/learning-lessons/compile`、`/api/learning-checks/compile` | `learning lesson compile`、`learning check compile` | 顺序、固定动作与规则缺项 |
| 会话准备 | `/api/learning-sessions/preview`、`start` | `learning session preview/start` | 课程、主体、镜像与原会话 |
| 练习/检查 | `/api/learning-sessions/step` | `learning session step` | 原动作和实际检查输入/结果 |
| 恢复/交接 | `/api/learning-environments/restore`、`/api/learning-exchange/export` | `learning environment restore`、`learning export` | 新会话回执、无执行权限的包 |

拟定每课程 50 课、每课 100 步、100 个样例文件；单文本 1 MiB，课件包 256 MiB。每主体 1 个活动 VM，全包最多 2 台，每台 2 vCPU / 2 GiB、16 GiB 虚拟磁盘。会话 60 分钟，空闲 15 分钟触发原环境停止。总存储 64 GiB，保留检查点最多 5 个；镜像通过独立资产导入，不塞进课件包绕过容量检查。

## 6. 实施与验收

先完成课程、前置关系、固定动作与规则编译；再通过本体 LearningToolSessionsV1 的项目身份、受限路径、截止和收尾门禁；最后完成练习、进度、检查点和交换。领域 LearningSessionsV1 管理课程会话，两种服务各自声明，不能互相替代。

验收覆盖三个模板的真实操作及错误反馈、未完成前置课、越界路径、恶意课程字段、重复 step、课程升级、取消、超时与空闲停止、控制器退出、检查点创建新身份、旧计划拒绝及导入进度不冒充本机成绩。所有运行与恢复须有真实回执，静态课程浏览不算完整实验验收。
