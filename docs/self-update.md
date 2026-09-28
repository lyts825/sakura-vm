# 独立运行包自更新

在**原安装目录**执行以下命令。新包必须由 `npm run release:prepare` 生成，并已复制到本机目录；检查 SHA-256 清单后才会安装依赖和执行候选代码。

```powershell
npm run update:check -- D:\path\to\new-package
npm run update:stage -- D:\path\to\new-package
# 上一条输出版本路径，如 versions/0123456789abcdef0123456789abcdef
npm run update:activate -- versions/0123456789abcdef0123456789abcdef
# 重启 Sakura；npm start 或托盘会从新版本启动
npm run update:status
```

`stage` 将发行包复制到独立版本目录，使用包的锁文件安装生产依赖，在临时数据目录和随机回环端口启动新服务，并检查 HTTP 健康状态。`activate` 只切换小型启动指针；已运行的旧服务继续运行到重启。启动器在新版本未能就绪时自动切回旧版本。需要主动回退时，在原安装目录运行 `npm run update:rollback`，随后重启服务。`versions/` 中的旧版本保留，不会被自动删除。

原安装目录中的 `.data`、`.tools` 和 `.vendor` 不随应用版本切换。候选版本必须使用相同的固定 QEMU/PosixLoom 运行时；改变其版本时需走完整安装和数据迁移流程。更新清单只校验文件完整性，不认证发布者；请从可信渠道取得本地发行包。回滚恢复应用代码，不倒转新版本已写入的数据或外部存储。升级前应按现有备份流程保护实例数据。
