# Windows Hello 解锁

在 Windows 上启用 Sakura 账户模式和“控制面锁定”，然后从 `http://localhost:<端口>` 以管理员登录。在“系统设置 → 通行密钥”中勾选“仅使用本机平台认证器”，验证当前账户密码并登记 Windows Hello 或其他本机平台通行密钥。控制面锁定后，选择“使用 Windows Hello / 本机通行密钥解锁”，完成系统提示的用户验证，即可解锁控制面并建立新的管理员会话。解锁密码仍可作为备用方式。

只有管理员已登记、带 `internal` 传输方式的平台通行密钥可用于解锁；只读账户和普通登录挑战均不能解锁。挑战五分钟内有效且只能使用一次，服务端验证来源、RP ID、签名、用户验证和凭证计数器。锁定状态在挑战期间发生变化时，旧挑战会失效。通行密钥私钥留在认证器中；Sakura 只保存公钥及凭证元数据。`127.0.0.1` 页面提供前往 `localhost` 的入口，因为 WebAuthn 凭证绑定后者。

Windows 的 WebAuthn 平台接口可使用 Windows Hello，也可能由系统中其他平台通行密钥提供程序处理。Sakura 要求本机平台凭证，但不会声称识别具体提供程序；实际提示由浏览器和 Windows 决定。参考 [Microsoft WebAuthn 文档](https://learn.microsoft.com/en-us/windows/security/identity-protection/hello-for-business/webauthn-apis)。

验证：`npm run test:hello` 使用真实 Chromium 虚拟平台认证器和编译版服务完成登记、锁定、解锁、重放拒绝及密码回退；单元测试覆盖只读账户、普通登录挑战和旧锁定代次的拒绝。真实 Windows Hello 硬件交互需在配置该认证器的主机上操作。
