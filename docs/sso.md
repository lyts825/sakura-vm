# OIDC 与 SAML 单点登录

先在“系统设置 → 账户与只读分享”启用账户模式，再由管理员在“OIDC 与 SAML 单点登录”配置身份提供商。外部身份不会自动创建 Sakura 账户：管理员、项目成员或只读账户须先用现有登录方式进入 Sakura，在“单点登录身份”中完成一次绑定，之后才能在登录页使用对应提供商。删除账户、解除绑定、停用或更换提供商配置都会使关联身份不能继续登录；解除绑定和配置变更还会撤销其已签发的 Sakura 会话。

## OIDC

在 IdP 中登记回调 `http://localhost:<端口>/api/access/sso/oidc/callback`，使用 Authorization Code 和 PKCE S256。填写 IdP 的精确 Issuer URL、Client ID，以及匹配 IdP 客户端登记的 Token Endpoint 认证方式。机密客户端需要 Client Secret，Sakura 使用当前 Windows 账户的 DPAPI 保护后保存，不在 API 响应中返回。IdP 的发现文档、授权、Token 和 JWKS 端点必须使用 HTTPS；Issuer 必须与发现文档和 ID Token 完全一致。公开客户端选择 `none`，不填写 Client Secret。

## SAML 2.0

在 IdP 中登记界面显示的服务提供商 ID 和 ACS 地址 `http://localhost:<端口>/api/access/sso/saml/callback`，使用 HTTP-Redirect 发起登录、HTTP-POST 返回响应。粘贴 IdP 的单个 `EntityDescriptor` 元数据 XML；Sakura 从中导入 IdP 登录入口和 1–4 张有效签名证书。IdP 需要对响应或断言签名，并在断言中包含指向本次请求的 `InResponseTo` 和指向 ACS 的 Bearer `Recipient`。Sakura 校验签名、证书、Issuer、Audience、时间、请求 ID 和接收地址。证书轮换后应重新导入元数据；这会清除旧绑定，需要账户重新绑定。

当前流程只接受由 Sakura 发起的 SAML 登录，不支持 IdP 发起登录、加密断言或要求 Sakura 对 AuthnRequest 签名的 IdP。SSO 回调使用本机 HTTP 环回地址，需选择允许 localhost 回调的 IdP；远程设备不能直接使用此入口。

## 安全与故障处理

登录在弹出窗口进行，回调只向发起窗口的精确本机来源发送结果。授权状态在服务端保留五分钟且只能使用一次；控制面锁定、服务重启、配置更换会使未完成的流程失效。Sakura 的账户角色、实例授权、会话有效期和控制面锁定规则仍适用于 SSO 登录。若浏览器阻止弹出窗口或 IdP 阻断窗口间通信，请允许该窗口后重试；没有完成绑定的外部身份会被拒绝。

接口见 `/api/openapi`：`/api/access/sso/providers` 公开列出已配置提供商；`/api/access/sso` 查看配置与绑定；`/api/access/sso/start` 发起登录或绑定；管理员使用 `PUT`/`DELETE /api/access/sso/oidc` 和 `/api/access/sso/saml` 管理配置；账户使用 `DELETE /api/access/sso/link/{provider}` 解除自己的绑定。
