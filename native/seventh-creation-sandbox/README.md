# 原生创作工具沙箱

## 运行职责

此适配器在 Windows x64 上运行固定的经典训练、整数求解和文档提取工具。HTTP 调用只提交 JSON 数据，不能指定解释器、命令、脚本、环境变量或任意文件路径。

`Program.cs` 创建无网络能力的 AppContainer，使用 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子地将 Python 加入 Job，查询真实进程令牌后恢复运行。Job 限制合计 1 GiB 内存、3 个后代进程，并设置关闭即终止。宿主的统一进程适配器另监督原生 owner 和本适配器，共预留 2 个外层进程额度。

包 SID 只获得独立复制的工具目录读取权限和本次工作目录修改权限。工具源目录和系统 Python 的 ACL 不作修改。工作目录采用低完整性标记；只继承输入、输出、错误三个固定文件句柄。

## 准备固定工具

源码构建要求本地已经安装 Windows x64 CPython **3.12.10**、[requirements.txt](requirements.txt) 的固定版本，以及 `C:/Program Files/Tesseract-OCR` 中的 Tesseract **v5.4.0.20240606**。脚本严格核对版本，只复制已经安装的组件，不联网、不安装依赖、不修改系统 Python。发行安装携带完整固定运行时，不需要用户预装这些工具。

在符合锁定版本的构建环境运行：

```powershell
python native/seventh-creation-sandbox/prepare-runtime.py
```

脚本复制解释器、标准库、所需包和英语 OCR 资源，编译本机辅助程序，并在 `.tools/seventh-creation/` 生成逐文件长度及 SHA-256 清单。运行包须同时包含 `sandbox.exe`、根 worker 副本、`runtime-manifest.json` 和完整 `runtime/`。

已验证组合为 Python 3.12.10、NumPy 2.4.4、SciPy 1.17.1、scikit-learn 1.9.0、Pillow 12.2.0、PyMuPDF 1.28.0 和 pytesseract 0.3.13。完整依赖及其版本以清单为准。依赖包中的原有版权和许可材料应随组件保留；项目根许可不替代各依赖许可。

Tesseract 携带英语 `eng.traineddata` 和方向识别 `osd.traineddata`，按清单固定逐文件摘要；其安装包 `doc/` 中的 Apache 2.0 许可、作者和说明原样复制。CPython 的 `LICENSE.txt`、各 Python 发行包的许可和 PyMuPDF 的 AGPL 许可分别保留。项目 MIT 许可不覆盖第三方组件。

## 调用与收尾

`probeCreationNativeAssets` 通过受管存储额度，以 64 KiB 块核验文件摘要及前后身份。它返回工具版本、固定清单摘要、运行时字节和全部必需资产字节。文件变化或取消会拒绝核验。

完整运行时核验在准备阶段创建 guard **之前**完成，原生分区租约持续覆盖准备和首次执行。保存原票据后的执行只重新核验清单、辅助程序和根 worker 的三个摘要，并与批准的工具身份比较。此处不会再次遍历运行时目录，避免完整核验耗时超过 guard 固定的 10 秒等待启动期限。运行期间不得覆盖安装资源；更新完成后须重新预览。

本体先申请进程、内存和存储额度，再调用 `computeSeventhCreation` 的原生动作，并显式传入发行资产和专属数据目录。发行环境使用显式路径，不依据打包后的模块位置猜测目录。

准备阶段先在任何 profile、ACL 或 Job 副作用之前，将 helper 的 PID、创建时间及固定目录写入 AppContainer 不能修改的回执，再建立原 Job。准备回执的 `childPid=0`；只有宿主保存票据后写入固定 start 文件，才启动一次业务。原票据在共享容量账本中保留，成功输出在移交固定修订引用前保留。恢复命令核对原 PID 的创建时间和原命名 Job，只终止、读取和核销该任务，不重放模型、OCR 或求解。

一个安装目录由一个宿主管理。预览核验、准备和执行在该宿主的原生分区中串行准入，避免本次 AppContainer 的临时 ACL 传播与另一次文件身份核验相撞。需要并行运行多个独立宿主时，各自使用完整独立的发行目录和数据目录；不要共享同一份正在授予、撤销包 SID 权限的原生运行时目录。任何复制、更新或身份变化都会使原预览失效，须完成更新后重新预览。

原生任务的外层期限最长 120 秒，其中保留 10 秒给收尾；内层业务执行最多 110 秒。取消写入本次工作目录的固定取消标记，由独立适配器终止 Job。控制器退出后，适配器仍执行自己的截止。只有 Job 中活动进程为 0 时，适配器才输出核销回执；缺少回执时，宿主保留原预留和恢复关联。

训练与推理只接受有限数值矩阵和显式 JSON 模型。求解返回候选后，TypeScript 再用整数精确运算检查赋值。PDF 文本层、OCR 和人工校正分别保留来源，OCR 置信值不解释为内容无误的概率。

## 验证依据

本地验收覆盖真实模型训练与推理、整数求解、PDF/OCR、外部私有文件拒绝、本机真实监听端口拒绝、取消及独立截止。领域用例和原始回执存放于被忽略的 `artifacts/plugin-packs-2.12.0/`，运行包不包含这些测试材料。

AppContainer 启动和能力属性沿用 [Microsoft 的 AppContainer 启动说明](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer)。进程树、内存和关闭行为依据 [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。
