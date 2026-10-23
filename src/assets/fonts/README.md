# Sakura 本地字体

字体随应用构建提供，运行时无需联网或安装系统字体。三个 WOFF2 文件共约 411 KiB，保留 400～700 可变字重。CSS 中使用独立的 Sakura 字族名称，字体内部名称也已同步修改。

| 本地字族     | 上游                                                                                                           | 使用场景                 |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Sakura Sans  | [Noto Sans SC](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/notosanssc)   | 正文、导航、表单和数据   |
| Sakura Serif | [Noto Serif SC](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/notoserifsc) | 标题、品牌和日式题字     |
| Sakura Mono  | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono/tree/19371302b95d218af43299bce79ddbddd0bc364d)     | 终端、代码、路径和版本号 |

Sans 和 Serif 保留原有 621 个码点，涵盖既有界面文字和标点。交付面板使用 Sans，本轮补充了交付界面、模板、插件名称和服务端提示所需的 195 个码点，Sans 共覆盖 816 个码点。Serif 和 Mono 的文件保持不变。

[ui-coverage.json](ui-coverage.json) 保存原覆盖基线、来源提交和各字族的源码范围。生成器使用 TypeScript 语法树提取这些文件中的字符串、模板片段和 JSX 文本，不收集注释或测试材料。新增界面文案后，先按实际字体用途更新源码范围，再重新生成并检查分发体积。

未纳入明确范围的界面文字，以及用户输入、文件名和终端中的其他字符，通过 CSS 字体栈回退。Mono 保留上游完整字符覆盖，终端和编辑器关闭连字以保持代码符号易辨认。

字体使用 `font-display: swap` 并预加载；终端在等宽字体加载后重新计算字符尺寸，调整字号时不会重建 SSH 会话。

## 重新生成

预生成文件已提交 Git，普通 `npm run build` 和 `npm start` 不需要 Python。字体生成需要 Node.js、已安装的项目依赖和 Python。仅更新字体时，在仓库根目录执行：

```powershell
python -m pip install --target .tools/font-python -r scripts/font-requirements.txt
python scripts/build-fonts.py
npm run build
```

脚本优先复用本地字体缓存，缺少时从固定的上游 Git 提交下载。生成前验证 Git blob SHA-1，生成后检查字符覆盖及字重范围，保留原版权信息。原文件和 Python 依赖缓存于 Git 忽略的 `.tools/`；[manifest.json](manifest.json) 记录来源、大小及输出 SHA-256。

## 许可

三个字体均采用 SIL Open Font License 1.1。以下原始版权与许可文件随字体一并分发：

- [Noto Sans SC 许可](sakura-sans-ui-OFL.txt)
- [Noto Serif SC 许可](sakura-serif-ui-OFL.txt)
- [JetBrains Mono 许可](sakura-mono-OFL.txt)

Sakura 的 MIT 代码许可不替代这些字体的 OFL 许可。
