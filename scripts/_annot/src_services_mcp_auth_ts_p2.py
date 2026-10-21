# -*- coding: utf-8 -*-
"""mcp/auth.ts 批注 p2：XAA 流程与标准 consent 流程（620-1360）。"""

ANNOTATIONS = [
(636, 'before', '''// 【这两个字段都是从 401 响应头里「捡」来的】
//
//   理想情况下，一次 OAuth 流程用配置里的 scope 就够了。
//   但 MCP 有个「step-up」（渐进提权）场景：
//
//     用基础 scope 连上了 → 调用某个工具 → 服务器返回 403 + 
//     WWW-Authenticate: Bearer scope="files:write", error="insufficient_scope"
//
//   这时正确的行为是「再走一次授权，但这次带上更大的 scope」，
//   而不是「用 refresh token 刷一下」—— 后者被 RFC 6749 §6 明文禁止。
//
//   这两个参数就是那次 403 里带回来的信息，缓存起来给下一轮用。
//
//   注意命名：WWWAuthenticate 拼写跟 HTTP 头一致（没有连字符），
//   这样 grep 头名和 grep 类型名能对上。'''),

(647, 'before', '''// 【XAA = Cross-App Access，企业 SSO 场景的一条捷径】
//
//   标准 consent 流程的问题：**每个 MCP 服务器都要弹一次浏览器**。
//   一家公司接 8 个内部 MCP 服务，员工要登录 8 次。
//
//   XAA 把「人」和「应用」解耦：
//
//     ① 用户在企业 IdP（Okta / Azure AD）登录**一次**
//        → 拿到 id_token，按 issuer 缓存在 keychain
//     ② 对每个 MCP 服务器，用 id_token 走 RFC 8693（token exchange）
//        换出该服务器所属 AS 的 access_token
//     ③ token 存进和普通 OAuth **同一个** keychain 槽位
//
//   第 ③ 步是关键设计：下游代码（client.ts 的 transport 组装）
//   完全不需要知道这个 token 是 XAA 换来的还是浏览器点出来的。
//
//   ── "No silent fallback" 这条约束 ──
//
//   如果 oauth.xaa 设了但 XAA 不可用，**不能**悄悄退回 consent 流程。
//   两个理由（注释里只写了第一个，第二个在 864 行展开）：
//     · 用户显式要求了 XAA，静默降级是意外行为
//     · 两种流程的信任前提不同（consent 走的是服务器自己的授权页，
//       XAA 走的是企业 IdP 的策略）—— 降级相当于绕过了企业策略'''),

(675, 'before', '''// 【配置的两级：IdP 是用户级，AS 是服务器级】
//
//   IdP 连接信息（issuer / clientId / clientSecret / 回调端口）
//   来自 settings.xaaIdp —— 全局一份，一次 `claude mcp xaa setup` 配好。
//
//   AS 的 clientId / clientSecret 是每个 MCP 服务器各自的
//   （在 .mcp.json 的 oauth 字段里）。
//
//   为什么这么分？因为这是两个不同的信任域：
//     IdP 认的是「这家公司的人」
//     AS  认的是「这个应用能访问哪些资源」
//
//   所以两边的密钥存在不同的 keychain 槽位（见 715 行），
//   泄露一个不会连带泄露另一个。'''),

(690, 'before', '''// 【clientSecret 存在另一个 map 里，不在 token entry 里】
//
//   `getMcpClientConfig` 读的是 `mcpOAuthClientConfig`，
//   而 token 存在 `mcpOAuth`。两个独立的顶层 key（见 2399 行）。
//
//   为什么分开？因为 token 会被反复清：
//     · invalidateCredentials('tokens')  刷失败时清
//     · revokeServerTokens               用户点清除时清
//   clientSecret 是**长期配置**，不该跟着 token 一起掉。
//
//   混在一起写的后果：一次刷新失败把 client secret 也删了，
//   用户重登时得重新输入密钥 —— 而他根本没做错什么。
//
//   【存储设计原则】按「生命周期」分组，而不是按「属于哪个实体」分组。'''),

(693, 'before', '''// 【诊断信息只在错误路径上算 —— 这是性能敏感的写法】
//
//   `getServerKey` 要序列化配置 + 算 sha256；
//   `Object.entries(serverConfig.headers)` 要遍历。
//   在成功路径上做这些是纯浪费 —— XAA 认证每次连接都会走一遍。
//
//   ── 这段诊断具体在查什么 bug ──
//
//   日志会打印 `wanted=<算出来的 key>` 和 `have=[keychain 里已有的 key]`。
//   两者不一致就说明「写的时候用的配置」和「读的时候用的配置」不同 ——
//   最常见的原因是用户改了 url 或 headers 里的一个字符。
//
//   没有这行日志，症状是「密钥明明存在，但一直说找不到」，
//   排查起来要手工复算哈希。
//
//   ── headers 里的 authorization 要打码 ──
//
//   699-703 行把 Authorization 头换成 [REDACTED]。
//   注意是大小写不敏感的比较（`k.toLowerCase()`）——
//   HTTP 头名大小写不敏感，用 === 会比漏。'''),

(715, 'before', '''// 【IdP 密钥和 AS 密钥分槽存放：不同的信任域】
//
//   同一台机器上，如果 IdP 密钥和 AS 密钥存在一起，
//   一次凭据库泄漏就同时丢掉「企业身份」和「应用身份」。
//   分开存，攻击者至少要多拿一份。
//
//   `idpClientSecret` 可以是 undefined —— 注释说 "Optional: if absent, PKCE-only"。
//   也就是说 IdP 支持公共客户端注册时不需要密钥，只靠 PKCE 就够。
//
//   【这不是「可选的优化」，是部署灵活性】：
//   有些企业 IdP 不允许创建 confidential client（拿不到 secret），
//   硬要求 secret 就等于不支持那些 IdP。'''),

(719, 'before', '''// 【先偷看一眼缓存，只为了遥测准确】
//
//   722 行这个 `getCachedIdpIdToken(...) !== undefined` 纯粹是为了
//   在下面 logEvent 时能报出 `idTokenCacheHit: true/false`。
//
//   为什么不能等函数返回后再判断？因为 `acquireIdpIdToken` 会**写缓存**。
//   调用完之后再查，永远是 true —— 指标就废了。
//
//   【埋点的一个常见陷阱】读「事后状态」来推断「事前状态」。
//   必须在动作发生**之前**采样。
//
//   这也解释了为什么这行代码看起来多余：它的唯一作用就是采样时机。'''),

(724, 'before', '''// 【用一个游标变量做失败归因，边走边标】
//
//   `failureStage` 初始 'idp_login'，每进入一个阶段就改写它。
//   catch 里直接读，不需要再判断「错误是在哪一步抛的」。
//
//   为什么不用嵌套 try 或者错误类型来区分？
//   因为下面调用的三个函数抛的是**同一种** Error（普通 Error 或
//   XaaTokenExchangeError），没有可供 switch 的类型信息。
//
//   游标写法的前提：阶段是**线性推进**的，不会回退。
//   这个流程正好满足（login → discovery → exchange）。
//
//   【如果阶段是分支/循环的，游标就不够用了，得用显式的 phase 枚举 + 状态机。】'''),

(742, 'before', '''// 【为什么要单独做一次 OIDC 发现】
//
//   XAA 的第二步是 RFC 8693 token exchange：拿 IdP 的 id_token
//   去换 AS 的 access_token。这个交换发生在 **IdP 的 token 端点**上，
//   而那个 URL 只有 IdP 的 OIDC 元数据里才有。
//
//   注意 `performCrossAppAccess` 内部还会做一次 AS 侧发现（PRM + AS metadata），
//   所以这个流程里其实有**两次**发现，打的是两个不同的服务器。
//   790 行那段注释就是在区分这两次发现失败该归到哪个 stage。'''),

(766, 'before', '''// 【错误归因：结构化优先，字符串匹配兜底】
//
//   理想做法：每种失败有自己的错误类型，catch 里 instanceof 分派。
//   现实：`performCrossAppAccess` 内部会抛三类东西
//     · XaaTokenExchangeError（IdP 腿，带 shouldClearIdToken）
//     · 普通 Error，message 里带 "jwt-bearer grant failed"（AS 腿）
//     · discovery 阶段的 Error，message 是各种前缀
//
//   所以这里的策略是分层的：
//     ① 有结构化信息的（XaaTokenExchangeError）→ 用字段判断
//     ② 没有的 → 用 message 前缀匹配，尽量猜准 stage
//
//   ── shouldClearIdToken 为什么用 OAuth 语义而不是字符串 ──
//
//   767-770 行说得很清楚：4xx / 响应体不合法 → 清 id_token（它是坏的）；
//   5xx → 保留（IdP 挂了，不是 token 的问题）。
//   如果这里用 "invalid" 之类的字符串匹配，5xx 的报错文案一变就会误清，
//   用户下次得重新走一遍浏览器登录。
//
//   【「清缓存」这个动作的门槛要高】宁可让用户多点一次重试，
//   也不要在服务器故障时把本地还算好的凭据毁掉。'''),

(793, 'before', '''// 【为什么不复用 provider.saveTokens，而是手写一遍 storage 写入】
//
//   理由是成本：为了写四个字段，要 new 一个 ClaudeAuthProvider
//   （它需要 redirectUri、回调函数等一堆构造参数）。
//   而这里已经在 XAA 流程里，根本不需要 provider 的其它能力。
//
//   ── 但手写带来了一个隐性的重复 ──
//
//   这段写入和 saveTokens（1704 行）、xaaRefresh 里的写入（1813 行）
//   是**三份几乎一样的逻辑**，都往 mcpOAuth[serverKey] 写同一组字段。
//
//   风险：加字段时容易只改一处。事实上 1804-1808 行那段注释
//   就在解释「为什么 xaaRefresh 不能走 saveTokens」——
//   因为 saveTokens 只 spread 已有数据，不会补 clientId。
//
//   【三份重复实现是技术债。抽成一个 `writeTokenEntry(serverKey, patch)`
//     会让这三处都变短，但那是重构，改动面大，注释先记录现状。】'''),

(809, 'before', '''// 【refresh_token 用 `?? prev?.refreshToken` 而不是直接赋值】
//
//   因为 AS 可能不给 refresh token。
//   在 jwt-bearer 授权模式（RFC 7523）里，refresh token 是可选的 ——
//   设计上就是「每次都能用 id_token 重新换一个」，不需要长期凭据。
//
//   如果这里直接写 `refreshToken: tokens.refresh_token`，
//   那些本来有 refresh token 的服务器，在一次「AS 没返回」的响应之后
//   token 就丢了 —— 下次不会再尝试普通刷新路径，
//   而是每次都走 4 个请求的 XAA 链。功能没坏，但慢了三倍。
//
//   【合并策略】局部更新时，undefined 应该被理解为「这次没有」，
//   而不是「改成没有」。只有显式的 null 才表示清除。'''),

(826, 'before', '''// 【成功埋点放在 try 里，失败埋点放在 catch 里 —— 但都只在最外层】
//
//   注意这个函数的埋点结构和 performMCPOAuthFlow 不同：
//   它在**内层**上报 success，在**外层** catch 上报 failure。
//
//   为什么内层 catch（737、764）不上报？
//   因为那些 catch 只是做「转换」（abort → AuthenticationCancelledError，
//   或者修正 failureStage），错误还会继续往外抛，
//   最外层会统一上报一次。如果每层都报，一个失败会被计数三次。'''),

(847, 'before', '''// 【performMCPOAuthFlow：所有认证路径的唯一入口】
//
//   调用它的地方（client.ts + UI 层）不需要知道 XAA 的存在 ——
//   判断在函数内部第一屏就做完了（871 行）。
//
//   签名里的五个参数值得逐个看：
//
//     serverName / serverConfig   要认证谁
//     onAuthorizationUrl          「拿到授权 URL 了」——给 UI 展示、给用户复制
//     abortSignal                 用户按 Esc 取消
//     options.skipBrowserOpen     环境里不能开浏览器（SSH、容器）
//     options.onWaitingForCallback 环境里 localhost 不可达（远程开发），
//                                 需要用户手工粘贴回调 URL
//
//   后两个参数合起来说明一件事：**这个函数必须能在没有浏览器、
//   没有可达 localhost 的环境里工作**。这不是边缘场景，
//   是 CLI 工具的常见部署形态。'''),

(857, 'before', '''// 【XAA 分支：三条必须硬失败的理由】
//
//   ① 用户显式要求（.mcp.json 里写了 oauth.xaa）
//      → 静默降级成 consent 是意外行为
//
//   ② 信任前提不同
//      → consent 流程信任「这个 MCP 服务器自己的授权页」，
//        XAA 信任「企业的 IdP 策略」。降级等于绕过企业策略
//
//   ③ 排查成本
//      → 如果静默降级，用户看到的是「能连上」，
//        但他以为自己在用 SSO，实际用的是个人授权。这种偏差很难发现
//
//   所以 872 行那个 if 抛的是**指路式错误**：
//   告诉用户设哪个环境变量，或者改哪个配置字段。
//
//   【错误文案的标准】用户读完应该知道下一步做什么。
//   "XAA not available" 是坏文案，
//   "set CLAUDE_CODE_ENABLE_XAA=1, or remove 'oauth.xaa' from server 'foo'" 是好文案。'''),

(903, 'before', '''// 【先读缓存，再清库 —— 顺序写反就白干】
//
//   916 行的 clearServerTokensFromLocalStorage 会删掉整个 entry，
//   包括 discoveryState（含 resourceMetadataUrl）和 stepUpScope。
//
//   而这两个值正是接下来要用（922、933 行）的。
//   所以必须先读到局部变量里（908-911），再删。
//
//   ── 为什么要清库 —— 这一行看着很粗暴 ──
//
//   注释说 "to ensure fresh client registration"。
//   场景：服务器的 AS 换了实现（或者用户换了部署），
//   旧的 client_id 在服务器上已经不存在了。
//   如果不清，SDK 会一直用旧 client_id 去请求，得到 invalid_client，
//   然后…… 依赖 1305 行那个自愈分支才清。
//
//   主动清掉重做 DCR（动态客户端注册）更省事：
//   反正只需要一次 POST，而得一个干净的 client_id 更重要。
//
//   【代价】每次重新认证都会重新注册一个客户端。
//   对服务器来说这是垃圾数据累积，所以这个策略只用在「用户主动重新认证」路径上。'''),

(1004, 'before', '''// 【为什么 cleanup 要持有三个外部引用】
//
//   这个 Promise 有**五个**独立的结束途径：
//     ① 回调服务器收到 code
//     ② 回调服务器收到 error
//     ③ 用户手工粘贴了 URL
//     ④ abortSignal 触发（按 Esc）
//     ⑤ 5 分钟超时
//     ⑥ 端口监听失败（EADDRINUSE）
//
//   每一条都要做同一套清理：关服务器、清定时器、摘 abort listener。
//   所以把资源引用提到闭包外层（1005-1007），让 cleanup 能都碰到。
//
//   【如果把这些引用留在各自的闭包里，五条路径就得写五份清理逻辑，
//     必然漏。提成外层变量 + 一个 cleanup 是唯一可靠的做法。】'''),

(1009, 'before', '''// 【removeAllListeners 之后必须补一个空 error handler】
//
//   1012-1013 行这两句是全文件最不显眼、却最容易踩的 Node 坑：
//
//     server.removeAllListeners()
//     server.on('error', () => {})   // 故意吞掉
//
//   为什么？因为 `close()` 是异步的。在 close 完成之前，
//   服务器对象上任何迟到的 error 事件（连接被对端重置、
//   EMFILE 之类）会变成 **uncaught exception**，直接杀掉进程。
//
//   而 removeAllListeners 正好把 1153 行那个 error handler 也摘掉了 ——
//   于是本来被妥善处理的错误，变成了进程崩溃。
//
//   【Node 服务端收尾的标准套件】
//     ① removeAllListeners()
//     ② 补一个吞异常的 error handler
//     ③ close()
//   少第 ② 步，偶发崩溃，且崩溃栈指向莫名其妙的地方。'''),

(1029, 'before', '''// 【resolveOnce / rejectOnce 的幂等性：这个 Promise 有六个出口】
//
//   原生 Promise 的 resolve/reject 第二次调用是静默无效的。
//   听起来无害，但在这里会掩盖 bug：
//
//     超时先触发 → reject(Timeout)
//     两秒后回调到达 → resolve(code)  ← 静默无效，但代码以为成功了
//
//   于是流程继续往下走（1216 行之后），用一个「其实已经超时」的结果
//   去换 token，用户看到的是一个莫名其妙的错误。
//
//   加了 `resolved` 标志位后，第二个出口直接 return，
//   行为变得确定：**先到的那个赢，后面的全部无视**。
//
//   【凡是「多个异步源竞争同一个 Promise」的地方，都需要这个守卫。】'''),

(1042, 'before', '''// 【abort 走同一条幂等出口，还要处理「已经 abort 了」的情况】
//
//   1047-1050 行：
//     if (abortSignal.aborted) { abortHandler(); return }
//
//   为什么需要这个检查？因为 `addEventListener('abort', ...)`
//   **不会**为已经发生的 abort 补发事件（AbortSignal 不重放历史）。
//
//   场景：用户在上一个界面按了 Esc，signal 已经 aborted，
//   然后 UI 又发起了一次认证（带着同一个 signal）。
//   不检查的话会一直等到 5 分钟超时。
//
//   【记住这个模式】订阅之前先查当前状态 —— 所有「事件 + 可能已发生」
//   的场景都适用（另一个例子是 223 行的 signal 合并）。'''),

(1054, 'before', '''// 【手工粘贴回调 URL：为远程开发环境准备的第三条路】
//
//   标准流程假设：浏览器和 CLI 在同一台机器上，
//   127.0.0.1:PORT 两边都能访问。
//
//   远程开发（SSH 到服务器、VS Code Remote、Codespaces、容器）打破了假设：
//   浏览器在本地，回调打到本地 127.0.0.1 上，服务器上的监听器收不到。
//
//   所以这里允许 UI 把 URL 念给用户，用户手工粘回来。
//   1093 行的空 catch 是刻意的：粘贴错了不报错，
//   让用户可以重试（报错会关闭整个表单）。
//
//   ── 注意这里同样校验 state ──
//
//   手工输入路径是**用户可控输入**，比网络回调更容易被社工。
//   1079 行的 state 比对不能省。
//
//   【判断「哪条输入路径更危险」的方法】哪条路上有「人」参与，
//   哪条路就要做更严格的校验 —— 人会复制粘贴钓鱼链接。'''),

(1099, 'before', '''// 【回调服务器的三个响应分支，注意它们都用 HTTP 200】
//
//   1111 行（state 不匹配）用 400，1121 和 1143 用 200。
//
//   为什么错误也用 200？因为**这个页面是给人看的，不是给程序看的**。
//   HTTP 状态码影响的是程序行为，而浏览器展示的是 body。
//   用 400 的唯一效果是某些浏览器把它渲染成错误页，
//   把我们精心写的中文提示盖掉。
//
//   反过来说，1111 那个 400 也有道理：state 不匹配意味着
//   **这个请求可能不是我们期待的**，用 4xx 让日志和代理层能识别出来。
//
//   【这是一个可以争论的选择】两种做法都能自洽，
//   关键是同一个文件里要一致。这里就有点不一致（1111 用 400，1121 用 200）。'''),

(1109, 'before', '''// 【state 校验 = CSRF 防护，不能省】
//
//   攻击模型：攻击者自己发起一次授权，拿到回调 URL
//   （?code=attacker_code&state=xxx），然后诱导受害者点开它。
//   如果服务器不校验 state，受害者的 CLI 就会完成授权 ——
//   **但授权的是攻击者的账号**。之后受害者往里写的所有数据
//   都进了攻击者的账户，而受害者看到的是「连上了」。
//
//   state 是本进程随机生成的（1476 行，32 字节 base64url）。
//   攻击者猜不出来，所以伪造的回调会被 1110 行拦下。
//
//   ── 一个细节：`!error && state !== oauthState` ──
//
//   有 error 时**不校验** state，先处理错误。
//   因为错误分支不涉及「用 code 换 token」，没有 CSRF 风险。
//   如果反过来先校验，某些服务器在错误回调里不带 state，
//   就会变成「报 state 不匹配」，把真正的错误信息盖掉。'''),

(1122, 'before', '''// 【XSS：回调用浏览器打开，所以错误文本是攻击面】
//
//   攻击者可以构造：
//     http://127.0.0.1:PORT/callback?error=<script>...</script>&state=正确值
//
//   受害者点开 → 我们的服务器把 error 原样插进 HTML → 在浏览器里执行。
//
//   1123-1126 行用 `xss()` 库清洗。**注意 error_description 也要清洗** ——
//   它同样是 URL 参数，同样可控。只清洗一个是最常见的漏法。
//
//   ── 严格说这里风险有限 ──
//
//   页面跑在 127.0.0.1 上，CSP 也宽，攻击者能做的有限。
//   但「有限」不等于「可以不清洗」：
//   这类漏洞的利用门槛低，而修复成本只有一次函数调用。
//
//   【原则】凡是「不可信输入 → 拼进 HTML」的地方，无条件转义。
//   不要先论证「这个场景危害不大」再决定 —— 论证成本比转义高。'''),

(1153, 'before', '''// 【EADDRINUSE 不只是报错，要给出可执行的下一步】
//
//   1155-1164 行：端口被占时，根据平台拼一条具体的排查命令
//     Windows:  netstat -ano | findstr :PORT
//     Unix:     lsof -ti:PORT -sTCP:LISTEN
//
//   为什么值得为这个错误单独写代码？
//   因为「端口被占」在自选端口模式下概率不低（findAvailablePort
//   拿到端口到真正 listen 之间有个竞态窗口），
//   而原始错误 "listen EADDRINUSE: address already in use :::34921"
//   对普通用户没有任何可操作性。
//
//   ── 配置固定端口时概率更高 ──
//
//   有些 OAuth 服务器要求把回调 URL 预先注册（redirect_uri 白名单），
//   这时端口不能随机，必须用 serverConfig.oauth.callbackPort（960 行）。
//   同一台机器上开两个 CC 实例就必然冲突。
//
//   【好的错误信息 = 现象 + 原因 + 一条可复制的命令】'''),

(1198, 'before', '''// 【unref()：不让回调服务器把进程钉住】
//
//   Node 的事件循环里，一个 listening server 和一个 pending timer
//   都算「有活儿要干」，进程不会退出。
//
//   正常路径下这不是问题：认证完成 → cleanup → 都关掉了。
//   但有个场景会漏：**UI 组件卸载但没有 abort**。
//   比如父组件拦截了 Esc 键自己处理，signal 从来没被 abort。
//
//   这时按「钉住」的行为：进程还活着，占着端口，等 5 分钟。
//   用户看到的是「按了 Esc 但程序不退」。
//
//   加了 unref 之后：没有任何别的活儿时进程直接退出，端口立即释放。
//   注释说得很直白 —— 宁可让进程退出，也不要挂着占端口。
//
//   【判断要不要 unref】问：这个资源「没人管」的时候，
//   是应该继续活着，还是应该随进程一起死？
//   后台任务（日志 flush）要继续；前台辅助资源（回调服务器）应该死。'''),

(1204, 'before', '''// 【两个超时，差两个数量级，别搞混】
//
//     AUTH_REQUEST_TIMEOUT_MS = 30 秒   （65 行）
//       单个 OAuth HTTP 请求的上限：发现、刷新、换 token。
//
//     5 * 60 * 1000 = 5 分钟            （这里）
//       等**人**在浏览器里点「同意」的上限。
//
//   人的操作时间是秒级到分钟级，网络请求是毫秒级到秒级。
//   把这两个混成一个常量，要么把人的耐心限制在 30 秒（不可用），
//   要么让网络失败要等 5 分钟才报错（不可排查）。
//
//   ── setTimeout 的第三、四个参数 ──
//
//   1205-1211 行把 cleanup 和 rejectOnce 作为参数传进去，
//   而不是直接在闭包里引用。
//   效果一样，但这样写说明了「这两个是这个定时器唯一需要的东西」——
//   读代码时不用往回翻找闭包捕获了哪些变量。
//
//   1213 行的 unref 同理：宁可漏掉这次超时，也不让进程赖着不走。'''),

(1216, 'before', '''// 【一个布尔量，把 try 块切成两段 —— 归因的关键】
//
//   这个赋值的位置非常精确：在「拿到授权码」之后、
//   「用授权码换 token」之前。
//
//   于是 catch 里只要看它，就知道失败发生在哪一半：
//
//     authorizationCodeObtained === true
//       → 失败一定在 token 交换（换 token 被拒、网络错误）
//       → reason = 'token_exchange_failed'
//
//     false
//       → 失败在更早：端口、回调服务器、用户拒绝、超时
//       → 再按 message 细分（1274 行那串 if）
//
//   为什么不在 catch 里靠 message 猜？因为 token 交换失败的消息
//   五花八门（各服务器的错误体不同），而 message 匹配的可靠性
//   远不如「一个精确埋点的布尔量」。
//
//   【通用手法】在长 try 块里埋几个这样的「里程碑布尔量」，
//   归因准确率远高于事后解析错误信息。'''),

(1262, 'before', '''// 【归因链的顺序：从最确定的判据开始】
//
//   ① instanceof AuthenticationCancelledError  → 'cancelled'
//      最确定。这是我们自己抛的类型。
//
//   ② authorizationCodeObtained                → 'token_exchange_failed'
//      次确定。这是上面那个里程碑布尔量。
//
//   ③ message 子串匹配                          → timeout / state_mismatch /
//                                                provider_denied / port_unavailable /
//                                                sdk_auth_failed
//      最不确定，所以放最后，且只作兜底。
//
//   顺序不能反：如果先做 message 匹配，
//   一个「用户取消」的消息里恰好含 "OAuth error" 就会被误归成 provider_denied。
//
//   ── 为什么这些消息串是安全的 ──
//
//   它们都是**这个文件自己拼的**（1116、1138、1161、1194 行），
//   不是来自服务器。所以改文案时编译器不会提醒你 ——
//   这是一处需要人肉维护的耦合。
//
//   【更好的做法】抛自定义错误类型。但这里已经有一堆 SDK 抛的裸 Error，
//   改动面大，所以先用 message 兜着。这是本文件里一处没有标 TODO 的债。'''),

(1293, 'before', '''// 【SDK 不暴露 HTTP 状态码，只能从 message 里抠】
//
//   1301 行的正则 /^HTTP (\\d{3}):/ 匹配的是 SDK 内部的错误文案格式：
//   "HTTP 500: <原始响应体>"（只在响应体解析不了时才这么拼）。
//
//   为什么需要这个状态码？因为埋点里要区分
//     · 400/401 客户端问题（用户或配置错）
//     · 429       限流（等一下就好）
//     · 5xx       服务器故障（不怪用户）
//   这三种在运维看板上是完全不同的信号，合并成一个 request_failed 就失去意义了。
//
//   ── 这是「向上游要能力，还是在下游凑」的取舍 ──
//
//   正确做法是给 SDK 提 PR 让 OAuthError 带 status 字段。
//   用正则抠是权宜之计，一旦 SDK 改文案就静默失效（httpStatus 变 undefined，
//   埋点少一个字段，不报错）。
//
//   【凡是解析别人的字符串格式，都要假设它会变。】
//   这里的做法是「失败就退化成 undefined」，不崩，可接受。'''),

(1305, 'before', '''// 【invalid_client + "Client not found" → 自愈：清掉存的 client_id 重做 DCR】
//
//   场景：服务器重置了数据库 / 换了一套部署，
//   我们存的 client_id 在它那边已经不存在了。
//
//   不处理的话：每次认证都拿旧 client_id → invalid_client → 失败。
//   用户会陷入「点重新认证也没用」的死循环。
//
//   处理方式：把 clientId 和 clientSecret 从凭据里删掉。
//   下次 clientInformation()（1482 行）返回 undefined → SDK 触发 DCR → 拿到新的 client_id。
//
//   ── 为什么这个自愈放在错误处理里，而不是启动时预检 ──
//
//   因为「client_id 无效」只有服务器才知道。
//   本地无法预判，只能等一次失败。所以自愈点必须紧贴失败点。
//
//   ── 注意 message 里必须同时匹配 "Client not found" ──
//
//   只匹配 invalid_client 太宽：密钥错误也会是 invalid_client，
//   那种情况该让用户改密钥，而不是悄悄换一个 client_id。
//
//   【自愈动作的触发条件要窄】宁可多失败一次，
//   也不要在错误的场景下悄悄改变用户的配置。'''),
]
