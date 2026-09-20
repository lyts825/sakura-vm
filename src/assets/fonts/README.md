# Sakura 本地字体

字体随应用构建提供，运行时无需联网或安装系统字体。三个 WOFF2 文件共约 365 KiB，保留 400–700 可变字重。CSS 中使用独立的 Sakura 字族名称，字体内部名称也已同步修改。

| 本地字族     | 上游                                                                                                           | 使用场景                 |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Sakura Sans  | [Noto Sans SC](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/notosanssc)   | 正文、导航、表单和数据   |
| Sakura Serif | [Noto Serif SC](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/notoserifsc) | 标题、品牌和日式题字     |
| Sakura Mono  | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono/tree/19371302b95d218af43299bce79ddbddd0bc364d)     | 终端、代码、路径和版本号 |

Sans 和 Serif 包含源码中的中文、日文、拉丁文及常用标点；新增界面文案后应重新裁剪。用户输入、文件名或终端中的其他字符通过 CSS 字体栈回退。Mono 保留上游完整字符覆盖，终端和编辑器关闭连字以保持代码符号易辨认。

字体使用 `font-display: swap` 并预加载；终端在等宽字体加载后重新计算字符尺寸，调整字号时不会重建 SSH 会话。

## 重新生成

预生成文件已提交 Git，普通 `npm run build` 和 `npm start` 不需要 Python。仅更新字体时，在仓库根目录执行：

```powershell
python -m pip install --target .tools/font-python -r scripts/font-requirements.txt
python scripts/build-fonts.py
npm run build
```

脚本从固定的上游 Git 提交下载字体和许可，验证 Git blob SHA-1，保留版权信息，并检查输出的字符覆盖及字重范围。原文件和 Python 依赖缓存于 Git 忽略的 `.tools/`；[manifest.json](manifest.json) 记录来源、大小及输出 SHA-256。

## 许可

三个字体均采用 SIL Open Font License 1.1。以下原始版权与许可文件随字体一并分发：

- [Noto Sans SC 许可](sakura-sans-ui-OFL.txt)
- [Noto Serif SC 许可](sakura-serif-ui-OFL.txt)
- [JetBrains Mono 许可](sakura-mono-OFL.txt)

Sakura 的 MIT 代码许可不替代这些字体的 OFL 许可。
