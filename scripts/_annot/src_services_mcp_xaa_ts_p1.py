# -*- coding: utf-8 -*-
"""mcp/xaa.ts 批注：XAA 两跳换票全流程（1-511）。"""

ANNOTATIONS = [
(1, 'before', '''// ═══════════════════════════════════════════════════════════════
//  XAA（Cross-App Access / SEP-990）—— 不弹同意页也能拿到 token
// ═══════════════════════════════════════════════════════════════
//
// 【它解决的问题】
//
//   普通 MCP 授权流程：点授权 → 浏览器打开 AS 同意页 → 点允许 → 回调拿 code → 换 token。
//   每个 MCP 服务器都要来一遍。企业里挂了 8 个服务器，用户就要点 8 次同意。
//
//   XAA 的承诺是：**只在 IdP 登录一次，之后 N 个服务器全部静默拿到 token**。
//
// 【怎么做到的：两跳换票】
//
//   IdP（企业身份提供商，如 Okta / Azure AD）与每个 MCP 服务器的 AS
//   （授权服务器）是两个互不信任的域。IdP 不知道有哪些 AS 存在，
//   AS 也不认 IdP 发的 access_token。所以中间必须有票据：
//
//     ① id_token  --RFC 8693 Token Exchange-->  ID-JAG
//        在 IdP 的 token 端点做。IdP 认得自己的 id_token，签一张「委托书」：
//        证明「这个用户授权你去那个资源」。ID-JAG =
//        Identity Assertion Authorization Grant。
//
//     ② ID-JAG    --RFC 7523 JWT Bearer Grant-->  access_token
//        在 AS 的 token 端点做。AS 信任 IdP 的公钥，验委托书，发自己的 token。
//
//   关键：**ID-JAG 不是 access_token**。它本身访问不了任何东西，
//   只是「给某个 AS、某个 resource 的授权凭证」。
//   所以 audience 必须填 AS 的 issuer、resource 必须填 MCP server 的 URL ——
//   填反了 AS 会拒，理由是「这不是签发给我的」。
//
// 【文件的四段结构】
//
//   ① 29-122    工具层：超时包装、URL 归一、错误类型、脱敏、Zod schema
//   ② 126-210   Layer 2 发现：PRM → AS metadata（含两道防混淆校验）
//   ③ 214-394   Layer 2 换票：token exchange + jwt-bearer（两次 HTTP POST）
//   ④ 396-511   Layer 3 编排：把四个动作串起来
//
//   为什么刻意拆成「4 个 Layer-2 操作 + 1 个编排器」：
//   注释说形状对齐 TS SDK PR #1593 的 Layer-2 API —— 即「按上游还没合并的
//   接口先写」。将来 SDK 合并了，只需机械替换调用点，逻辑不用重写。
//   这是一种**主动的、有期限的耦合**：用今天的多余一层，换明天的零成本迁移。'''),

(29, 'before', '''// 【30 秒：限制的是每一次请求，不是整个流程】
//
//   XAA 全程 3～4 次网络往返（PRM、AS metadata、两次换票）。
//   按这里的设计，最坏情况是 4 × 30 = 120 秒。
//
//   为什么不给整个流程一个总超时：任何一跳慢都应该单独暴露「是哪一跳慢」。
//   总超时只会变成「120 秒后报 XAA 失败」，排障时毫无信息量。'''),

(31, 'before', '''// 【四个 URN：拼错一个字母，认证永远不通，而且不报错】
//
//   这些不是我们编的标识符，是 IETF 规范里写死的字符串。
//   服务器收到不认识的 grant_type / requested_token_type 时，
//   只会回一个笼统的 unsupported_grant_type ——
//   不会告诉你「你把 jwt-bearer 拼成了 jwt-bearer2」。
//
//   所以必须集中成常量：改只有一处，读的时候一眼看出这是外部契约。'''),

(42, 'before', '''// 【两个取消源必须合并，不能二选一】
//
//   直觉写法是 signal: abortSignal ?? AbortSignal.timeout(30000) ——
//   有用户信号就用用户的，没有就等超时。
//   但这样用户一按 Esc，**30 秒的超时保护就消失了**，
//   请求会一直挂着，直到 TCP 自己放弃（可能是几分钟）。
//
//   AbortSignal.any 让两个信号都生效，谁先触发算谁。
//   这是「组合约束」而不是「选择约束」—— 在只有一个可选项的场景里
//   两者长得几乎一样，但只要多出一个取消源，语义就完全不同。'''),

(61, 'before', '''// 【为什么要「往返 URL」再比字符串】
//
//   RFC 8414 §3.3 要求比较 issuer 前先做 RFC 3986 §6.2.2 的语法归一：
//   scheme 与 host 大小写不敏感、默认端口（https 的 443）可省略、
//   空路径等于根路径。所以下面三个写法是同一个 issuer：
//
//     https://as.example.com
//     https://AS.EXAMPLE.COM:443/
//     https://as.example.com/
//
//   不归一就直接 a === b，会把**合法配置判成攻击**（issuer mismatch），
//   用户看到「XAA 拒绝连接」，真实原因只是自己多写了一个斜杠。
//
//   catch 分支也做了去尾斜杠：两边都是非法 URL 且完全相同的时候，
//   不该在这里抛错 —— 交给下面的 HTTPS 校验去拒绝更准确。'''),

(69, 'before', '''// 【「要不要清缓存」这个判断，只有这里能做】
//
//   调用方 catch 到这个错误后必须决定：把缓存的 id_token 丢掉，还是留着下次再试。
//   这个决定依赖 HTTP 状态码的语义，而**只有抛错的地方看得到状态码**。
//   所以把它编码成一个字段一起抛出，而不是让调用方去猜 message 里有没有 5xx。
//
//   判据不是「失败了没有」，而是「**是谁的错**」：
//     4xx            → id_token 有问题（过期/被吊销/audience 不对）→ 清掉
//     5xx            → IdP 自己挂了，id_token 可能完全正常        → 留着
//     200 但形状不对 → 服务器违反协议，留着也用不了              → 清掉
//     非 JSON        → 强制门户/代理插页                          → 留着
//
//   落地见 269 行的 res.status < 500。'''),

(86, 'before', '''// 【错误响应体也要脱敏 —— 而且顺序是先脱敏后截断】
//
//   常见写法只在「成功路径的调试日志」里脱敏，忘了错误路径。
//   但 OAuth 的错误信封里回显请求参数是很常见的服务端实现（为了排障）：
//
//     HTTP 400 {"error":"invalid_grant","subject_token":"eyJhbGci...","assertion":"..."}
//
//   这条 body 会被拼进 Error.message，写进 --debug 日志、写进崩溃报告。
//   于是一次失败的认证，把 id_token 和 client_secret 都留在了磁盘上。
//
//   正则不锚定嵌套深度（没有 ^ 也没有 $），因为 token 可能出现在
//   {"error":{"details":{"subject_token":"..."}}} 这种多层结构里。
//
//   注意 266 行的顺序：先 redactTokens 再 slice(0, 200)。
//   反过来的话 secret 会被截成半截 —— 半截 secret 依然是泄漏，
//   而且正则再也匹配不上它了。'''),

(94, 'after', '''// 入参是 unknown：既接受已解析的对象（safeParse 失败时用），
// 也接受原始文本（!res.ok 时用）。两条路径都必须能脱敏。'''),

(101, 'before', '''// 【两个 schema 的宽松度不一样，是故意的】
//
//   TokenExchangeResponseSchema 里 access_token 是 optional：
//     下一跳真正需要的是 issued_token_type 校验通过。
//     缺 access_token 时由 293 行显式抛出，错误信息能说清「缺哪个字段」；
//     Zod 直接拒的话只会说「invalid response」，反而更难查。
//
//   z.coerce.number()：PHP 系的 IdP 常把 expires_in 发成字符串 "3600"。
//     这是不合规 JSON，但广泛存在。用 coerce 而不是放宽成 union，
//     是因为 coerce 之后下游拿到的依然是 number，不用处处判类型。'''),

(112, 'before', '''// 【「字段缺失」和「字段错误」要区别对待】
//
//   token_type 给了 default('Bearer')：RFC 6750 里 Bearer 是唯一在用的值，
//   很多 AS 干脆不发这个字段。为了一个纯装饰性的标签拒掉一个有效的
//   access_token，是净损失 —— 用户看到「认证失败」，实际 token 完全能用。
//
//   access_token 用 .min(1)：这是整条链的终点产物，空字符串等于没有。
//   和上一跳的 .optional() 不对称，因为它在流程里的位置不同：
//   第一跳的 access_token 只是 ID-JAG 的载体，第二跳的 access_token 是产出。'''),

(124, 'before', '''// ── 什么是 Layer 2 / Layer 3 ──
//
//   这不是 OAuth 规范的术语，是这份代码自己的分层：
//     Layer 2 = 单个协议动作（发现、交换），每个函数只做一次网络往返
//     Layer 3 = 编排，把四个动作串成流程
//
//   分开的好处不只是整齐：Layer 2 的每个函数都能被 conformance 测试
//   单独调用（try-xaa 脚本就是这么用的），出问题时能精确定位是哪一跳。'''),

(131, 'before', '''// 【第 1 道防混淆闸：PRM 里的 resource 必须等于你请求的服务器】
//
//   RFC 9728 的 PRM（Protected Resource Metadata）是「这个资源该找哪个 AS」的公告板，
//   由**资源服务器自己**提供 —— 如果某个 MCP 服务器的域名被劫持，
//   攻击者就能把 authorization_servers 指向自己的 AS。
//
//   不校验时的链路：
//     请求 https://evil.com/mcp → 拿到「AS 是 https://attacker.as」
//     → 把用户的 id_token 发到 attacker.as 去换 ID-JAG
//     → **id_token 泄漏**
//
//   156 行比的就是 resource 字段。注意是归一化后比较：
//   攻击者写 https://evil.com/mcp/（多一个斜杠）不能因此通过，
//   服务端写 https://EVIL.com/mcp 也不该因此被误拒。'''),

(174, 'before', '''// 【第 2 道闸：AS metadata 自报的 issuer 必须等于你请求它的地址】
//
//   这是同一类攻击的第二跳。假设攻击者已经让自己的 AS 出现在 PRM 里，
//   他还能做另一件事：让 **A 服务器的 metadata 声称自己是 B**。
//   后果是「本该发给 B 的 client_secret 被发给了 A」。
//
//   RFC 8414 §3.3 因此要求校验 issuer，比较前同样要归一化。'''),

(195, 'before', '''// 【第 3 道闸，也是前两道拦不住的那一种】
//
//   前两道都是「**自洽性**」校验：PRM 说自己是谁、AS 说自己是谁。
//   一个完全自洽的 http:// 配置能同时通过两道：
//
//     PRM: resource = http://evil.com/mcp
//     AS:  issuer = http://evil.com, token_endpoint = http://evil.com/token
//
//   两道比较都过 —— 然后 260 行把 id_token 和 client_secret
//   用明文 POST 出去，路上任何一台路由器都能读到。
//
//   所以 HTTPS 必须单独判，而且判的是 **token_endpoint**：
//   真正承载凭据的是那一个 URL。只校验 issuer 是 https 不够 ——
//   AS 完全可以 issuer=https、token_endpoint=http。'''),

(221, 'before', '''// 【第一跳：id_token → ID-JAG，在 IdP 的 token 端点做】
//
//   入参里有四个一眼看不出区别的东西，必须分清楚：
//
//     subject_token      = 用户在这个 IdP 上的 id_token（我是谁）
//     subject_token_type = id_token 的类型 URN
//     audience           = **AS 的 issuer**（不是 MCP server 的 URL）
//     resource           = **MCP server 的 URL**（PRM 里的 resource）
//
//   audience 和 resource 填反，IdP 会返回 invalid_target，
//   或者签出一张没人认的委托书 —— 而错误信息通常不会说「你填反了」。
//
//   为什么 clientSecret 是 optional：有些 IdP 把客户端注册成机密客户端，
//   却在 OIDC 元数据里声称 token_endpoint_auth_method: none。
//   这种自相矛盾的配置真实存在，所以「有就带上，没有也不拦」。'''),

(265, 'before', '''// 【判据用状态码，不用 body 里的 error 字段】
//
//   body 里的 error 在各 IdP 之间格式不统一（有的配 error_description，
//   有的只在顶层给 error，有的两个都给）。而 4xx/5xx 的语义是 HTTP 层的共识。
//
//   这里刻意放弃更精细的判断，换取「在所有 IdP 上都对」。
//   对比 auth.ts 里的 normalizeOAuthErrorBody：那里之所以要归一错误码，
//   是因为 invalid_grant 必须被识别出来才能走自愈路径 ——
//   **精细判断只在它改变控制流时才值得做**，否则就是给自己找 bug。'''),

(275, 'before', '''// 【非 JSON 不等于服务器坏了】
//
//   酒店/机场 WiFi 的强制门户会把第一个 HTTP 请求 302 到登录页，
//   返回 200 + 一段 HTML。此时 res.ok 为 true，res.json() 抛 SyntaxError。
//
//   把这归成「响应格式错误 → 清 id_token」，用户每连一次公共 WiFi
//   就要重新去 IdP 登录一次。所以这里 shouldClear = false。'''),

(285, 'before', '''// 用 safeParse 而不是 parse：parse 抛的 ZodError 的 message 是一大段
// 结构化描述，塞进 Error 里既难读，又会把整个响应体的结构泄漏到日志。
// 所以 288 行的错误信息走 redactTokens，而不是直接拼 parsed.error。'''),

(299, 'before', '''// 【这个校验看着多余，其实是排障的关键】
//
//   RFC 8693 允许 exchange 返回任意类型的 token。如果 IdP 不认 ID-JAG，
//   有的实现会「热心地」直接返回一个普通 access_token。
//
//   不校验的后果：这个 access_token 被当成 ID-JAG 送给 AS，
//   AS 验签失败后回「invalid assertion」——
//   于是你以为是 **AS 配置错了**，实际是 **IdP 根本不支持 ID-JAG**。
//
//   校验之后错误信息直接说「返回了 xxx 类型，不是 id-jag」，一眼定位到 IdP。'''),

(320, 'before', '''// 【这个返回值必须被调用方持久化，否则刷新和吊销都找不到门】
//
//   典型 XAA 部署里，MCP server 的 URL（https://mcp.example.com/mcp）
//   和它的 AS（https://as.example.com）是**两个不同的域名**。
//
//   刷新 token 要向 AS 的 token 端点发请求，吊销要向 AS 的 revocation 端点发请求，
//   而「AS 在哪」这个信息只有在 PRM 发现时才第一次知道。
//
//   不持久化的后果：下次启动想刷新 → 只能重做一次 PRM 发现（多一次往返）；
//   或者更糟 —— 有人拿 MCP server URL 当 issuer 去请求，永远 404。
//   auth.ts 的 _doRefresh 和 revokeServerTokens 都读这个字段。'''),

(330, 'before', '''// 【第二跳：ID-JAG → access_token，在 AS 的 token 端点做】
//
//   grant_type 用 RFC 7523 的 jwt-bearer：把 ID-JAG 当 assertion 递过去，
//   AS 用 IdP 的公钥（JWKS）验签，确认「这个 IdP 确实为这个用户、
//   为这个 resource 签了委托书」，然后发自己的 access_token。
//
//   默认 client_secret_basic 而不是 post：SEP-990 的 conformance 测试要求如此。
//   basic 把凭据放在 Authorization 头，post 放在 body ——
//   body 更容易被中间件写进访问日志。'''),

(360, 'before', '''// 【RFC 6749 §2.3.1：先 form-urlencode，再 base64】
//
//   规范要求 client_id 与 client_secret 在 base64 之前先做
//   application/x-www-form-urlencoded 编码。
//
//   绝大多数实现直接 base64 原文 —— 常规 id/secret 里没有需要编码的字符，
//   结果完全一样。但 secret 里一旦出现冒号，不编码就会解错：
//   basic 认证按**第一个冒号**切分，secret 里有冒号时服务端会切错位置。
//
//   只在少数情况下才炸的规范细节，代价是一行代码，所以照做。'''),

(375, 'before', '''// 注意这里没有 shouldClearIdToken：能走到这一跳，说明 id_token 已经被 IdP 接受了。
// 这一跳失败只意味着 **AS 侧**有问题（公钥没同步、client 未注册、resource 不匹配），
// 清掉 id_token 只会让用户白登一次。
//
// 同一个文件里两种错误类型的设计差异，各自对应「谁能对这次失败负责」。'''),

(396, 'before', '''// ── Layer 3：编排 ──
// 四个动作都齐了，剩下的只是顺序和错误传播。'''),

(417, 'before', '''// 【一次完整的 XAA 是四次网络往返】
//
//   PRM 发现 → AS metadata 发现 → IdP 换 ID-JAG → AS 换 access_token
//
//   编排器里没有 try/catch：每一跳的失败都直接向上抛，因为「该怎么处理」
//   只有调用方知道（重试？清缓存？提示用户重新登录？）。
//   编排器唯一的额外职责是 446 行的「多个 AS 依次尝试」。'''),

(441, 'before', '''// 【「字段缺失」不等于「不支持」】
//
//   grant_types_supported 在 RFC 8414 §2 里是 OPTIONAL。
//   所以判断必须是「**明确声明了列表，且列表里没有 jwt-bearer**」才跳过。
//
//   写成 !meta.grant_types_supported?.includes(...) 就错了：
//   那会把所有没声明这个字段的 AS 全部跳过 ——
//   而这些恰恰最需要「让 token 端点自己去判断」。
//
//   这个判据在本仓库反复出现（mcp/config.ts 的 undefined vs [] 是同一件事）：
//   **缺失是一种信息，但它表示「不知道」，不是「没有」。**'''),

(446, 'before', '''// 【错误聚合，而不是只报最后一个】
//
//   一个企业可能挂了三台 AS，其中两台不支持 jwt-bearer。
//   只保留最后一次错误的话，排障时看到「最后一台说 unsupported_grant_type」，
//   你会去查那台 AS 的配置，而真实原因是三台都不支持。
//
//   把所有尝试过的原因拼起来，一眼就能看出「每个都试过了，各自因为什么」。'''),

(451, 'before', '''// 【用户取消不是「这个 AS 不行」】
//
//   没有这一行，用户按 Esc 之后循环还会继续试剩下的 AS，
//   每一次都要等 30 秒超时，看起来像「取消无效」。
//   取消必须穿透到最外层，不能在这里被降级成「换下一个」。'''),

(472, 'before', '''// 【只在 AS 明确排斥 basic 时才用 post】
//
//   三个合取的实际含义：声明了列表 && 列表里没有 basic && 列表里有 post，
//   也就是「明确说了不支持 basic，但支持 post」。
//
//   其他所有情况（没声明、两个都支持、只声明 basic）都走 basic ——
//   因为 SEP-990 的 conformance 期望默认是 basic。'''),

(487, 'before', '''// 注意 audience 用的是 asMeta.issuer，resource 用的是 prm.resource。
// 这两个值来自两次不同的发现，是整个流程里最容易接错的两根线。'''),

(499, 'before', '''// 第二跳用 config.clientId / clientSecret（在 MCP server 的 AS 上注册的客户端），
// 而第一跳用的是 config.idpClientId / idpClientSecret（在 IdP 上注册的）。
// 同一个流程里两套客户端身份，混用会得到 invalid_client。'''),

(510, 'before', '''// authorizationServerUrl 取 issuer 而不是 token_endpoint：
// 后续刷新和吊销都要**重新发现**端点（AS 可能换域名），
// 而 issuer 是这次发现里唯一稳定的锚点。'''),
]
