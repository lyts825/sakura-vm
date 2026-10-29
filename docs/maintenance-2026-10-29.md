# 2026-10-29 项目整理

应用版本保持 2.12.10，基线为 `f2d7d84b`。文档整理已完成，文件清理阻塞，尚未完成全部整理目标。

## 文档调整

更新记录集中到根目录 [CHANGELOG.md](../CHANGELOG.md)，新增 39 条历史导航。原状态页的历史正文完整保留，日期、提交和验证边界未改写。

[PROJECT_STATUS.md](../PROJECT_STATUS.md) 从 707 行压缩到 25 行，只呈现当前基线、维护状态、阻塞和下一步。README 增加使用导航，文档索引单列更新入口，原功能文档链接保持有效。维护指南更新到当前版本，并说明各文档的职责。

## 文件清理

审计覆盖 3,665 个跟踪文件，未发现空文件；核查的 Markdown、TypeScript、TSX、MJS、CSS 和 JSON 文件没有字节重复。304 个现有 CI 测试文件保留，运行数据、恢复资料、依赖、构建入口和正式资源保持原状。

本次删除计划包含以下 7 个文件，共 118,105 字节：

| 文件 | 判定依据 |
| --- | --- |
| `tsconfig.tsbuildinfo` | 旧增量缓存；当前编译配置和构建入口不使用它。 |
| `artifacts/performance-2.12.10/locale/localization.instrumented.ts` | 验证脚本在每次导入前重新生成，可重建。 |
| `artifacts/ui-2.12.3/verification-interactions.json` | 与保留的 `verification--interactions.json` 字节相同，脚本使用后者。 |
| `artifacts/prepare-plugin-ui-commit.mjs` | 已完成旧提交所用的一次性准备脚本，不属于运行或验证入口。 |
| `artifacts/plugin-ui-previous/PluginCenter.tsx` | 旧源码快照，内容已在 `b1bc806f` 保存。 |
| `artifacts/plugin-ui-previous/plugins.css` | 同上，可从 Git 恢复。 |
| `artifacts/plugin-ui-previous/plugin-center.spec.ts` | 同上，可从 Git 恢复。 |

自动审批以 `blocked by policy` 拒绝删除上述文件及清理后空目录的命令。命令未执行，实际删除为 0；7 个目标仍存在，没有重试或绕过。旧测试状态标记 `test-results/.last-run.json` 也保留。此前受阻目录保持不动。

审计、路径与摘要清单位于已忽略的 `artifacts/project-cleanup-2026-10-29/`。`pending-cleanup.json` 记录本次 7 个待清理文件；`cleanup-audit.json` 另保留可选候选和此前排除的目标。必要基准、报告和复现脚本继续保留。

## 验证与交付

246 份 Markdown 的 1,566 个本地链接有效，本次修改所涉及的 49 个锚点通过检查。历史正文与基线逐字一致，仅统一换行后比较。应用版本常量、包清单与 `v2.12.10` 标签均保持不变，差异检查通过。

本轮只修改文档，未改动应用实现、依赖、配置或现有测试；未重复运行应用构建和功能测试。本次使用独立维护提交，保留原应用发布标签和服务契约基线。未推送、发布或部署。

恢复步骤：由用户处理清单中的文件，或在环境明确允许后重新核对文件用途和摘要再清理。确认实际删除结果后，更新当前状态和本条维护记录。文件清理完成前，本轮目标保持部分完成。
