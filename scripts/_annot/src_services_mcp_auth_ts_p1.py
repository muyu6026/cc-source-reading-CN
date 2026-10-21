# -*- coding: utf-8 -*-
"""mcp/auth.ts 批注 p1：脱敏、错误归一、发现、serverKey、吊销（1-620）。"""

ANNOTATIONS = [
(62, 'before', '''// 【auth.ts 为什么有 2465 行 —— 读这个文件前先建立的心智模型】
//
//   它实现的不是「OAuth 2.0」，是「OAuth 2.0 在几十个真实服务器上的样子」。
//
//   规范只描述合规的实现。而现实里：
//     · Slack 用 HTTP 200 返回错误体（120 行那段注释）
//     · 有些服务器不实现 RFC 9728，元数据挂在老路径上（240 行）
//     · 有些服务器的吊销端点不认 RFC 7009 的公共客户端写法（370 行）
//     · 有些服务器刷不出更高 scope，但 SDK 会一直去刷（1344 行）
//
//   每一段「奇怪的代码」背后都有一个具体的不合规实现。
//   所以读这个文件的正确姿势不是「顺着规范读」，
//   而是**每看到一处补丁就问：他在补谁的不合规**。
//
// ── 文件的分层 ──
//
//   ① 1-310     工具层：脱敏、错误体归一、带超时的 fetch、元数据发现
//   ② 313-634   凭据寻址与吊销：getServerKey / revokeServerTokens
//   ③ 636-1342  两条认证流程：XAA（企业 SSO）与标准 consent（浏览器同意）
//   ④ 1344-2360 ClaudeAuthProvider：喂给 MCP SDK 的九方法适配器
//   ⑤ 2362-2465 客户端密钥的读写与 scope 提取
//
//   第 ④ 段是核心：SDK 只认这套接口，所有策略都在回调里。'''),

(67, 'before', '''// 【遥测枚举：值一旦发出去就再也不能改名】
//
//   这两个类型（71 行、84 行）不是给自己用的，是给 BigQuery 用的。
//   注释里那句 "Keep stable (do not rename; add new ones)" 是硬约束：
//   看板上的历史数据按这些字符串分组，改名等于把过去的数据全部丢进「其他」。
//
//   所以它们的演化方式是**只增不改**。
//   这也是为什么取值定得这么粗（六个原因覆盖所有情况）：
//   粒度越细，将来想合并就越难；粗一点反而耐用。
//
//   【可以学的做法】埋点枚举当成**外部 API** 对待，加 deprecate 注释而不是直接改。
//   代价是枚举会越来越长 —— 这是可接受的。'''),

(96, 'before', '''// 【这五个参数为什么算敏感】
//
//   state           CSRF 令牌。泄漏 = 攻击者能伪造回调
//   nonce           OIDC 防重放。泄漏 = 能重放 id_token
//   code_verifier   PKCE 的「证明」。泄漏 = 截获 code 就能换 token
//   code_challenge  verifier 的哈希。单独泄漏危害小，但配合别的就危险
//   code            授权码本身。泄漏 = 直接换 token
//
//   注意这里**没有** access_token / refresh_token ——
//   因为它们在 header 或 body 里，不在 URL query 里；
//   而这个函数只处理 URL。
//
//   【判断「什么算敏感」的方法】问：拿到这个值，攻击者能完成哪一步？
//   能完成任意一步的都算。'''),

(112, 'before', '''// 【只在日志里脱敏，不改真实 URL】
//
//   这个函数被调用在 `logMCPDebug` 的参数位置，从不用于实际请求。
//   所以它必须**返回一个可读的完整 URL**（保留 host/path/其余参数），
//   只把五个值换成占位符 —— 否则排障时看不出是哪个端点出错。
//
//   ── catch 分支的处理很关键 ──
//
//   `new URL()` 抛异常时原样返回。这看起来像「脱敏失败就放弃」，
//   但更好的做法是返回一个不含 query 的截断串。
//   现状的风险：畸形 URL 里的敏感参数会原样进日志。
//   实践中畸形到解析不了、又恰好带着 code 的 URL 极少，所以没改。
//
//   【这类「出错路径上的安全降级」是最容易漏的审计点。】'''),

(127, 'before', '''// 【normalizeOAuthErrorBody 存在的原因：一个真实的 Slack 兼容 bug】
//
//   规范的 OAuth 服务器：出错 → HTTP 4xx + {"error":"invalid_grant"}
//   Slack：出错 → HTTP **200** + {"error":"invalid_refresh_token"}
//
//   而 SDK 的 executeTokenRequest 只在 `!response.ok` 时才去解析错误体。
//   2xx 的响应它直接丢给 OAuthTokensSchema.parse() → ZodError。
//   ZodError 在那条链路上会被归成不透明的 request_failed。
//
//   后果不是「报错不好看」，而是**该清 token 的时候不清**：
//
//     invalid_grant  → 走 invalidateCredentials('tokens') → 提示重新登录（自愈）
//     request_failed → 重试三次 → 放弃 → 但坏 token 还留在 keychain 里
//
//   用户看到的现象是「这个 MCP 服务器一直连不上，怎么点重试都没用」。
//
// ── 补丁手法值得学：不改 SDK，只改它的输入 ──
//
//   把「200 + error 体」重写成「400 + 同样的 error 体」，
//   SDK 的既有错误映射就自动生效了。
//   这比 fork SDK 或者在调用处 try/catch 猜错误类型都便宜。
//
//   代价：这是一个**响应体嗅探**，会读掉 response body。
//   所以必须 `new Response(text, response)` 重建 ——
//   直接 return 原对象的话 body 已经被消费，下游读不到。'''),

(170, 'before', '''// 【判定顺序不能反：先认「成功」再认「错误」】
//
//   为什么 OAuthTokensSchema 必须在 OAuthErrorResponseSchema 之前？
//
//   如果反过来，一个**正常的 token 响应**只要恰好有个 error 字段
//   （有些服务器会带 error: null 或者额外的诊断字段），
//   就会被误判成错误响应、改写成 400，然后正常的登录直接失败。
//
//   而先判成功：正常 token 响应一定匹配 Tokens 形状，提前放行。
//   顺序上「先排除正常情况」永远比「先匹配异常特征」安全。
//
//   【通用规则】做异常检测时，先写「什么情况下一定正常」的快速通道。'''),

(177, 'before', '''// 【三个别名归一成 invalid_grant —— 这是自愈的唯一入口】
//
//   Slack 用的是非标准码：
//     invalid_refresh_token    实测于 oauth.v2.user.access
//     expired_refresh_token    刷新令牌轮换文档
//     token_expired            同上
//
//   这三个语义上都是「refresh token 不能用了」，但字符串不同。
//   不归一的话，它们会一路走到 request_failed，
//   而 request_failed 的处理是「重试 3 次然后放弃」——
//   一个本来只需重新登录就能解决的问题，变成了永久性故障。
//
//   归一之后统一是 invalid_grant，命中 `_doRefresh` 里那条分支：
//   先查别的进程有没有刷好 → 没有就清 token → 回到 needs-auth → 用户重新授权。
//
//   【所以「错误码归一」不是代码整洁问题，是功能可用性问题。】'''),

(198, 'before', '''// 【createAuthFetch：每次调用都造一个新 fetch，而不是复用一个】
//
//   为什么不能复用？因为 timeout signal 是一次性的：
//   `AbortSignal.timeout()` 到点就 abort，那个 signal 永久处于 aborted。
//   复用一个带旧 signal 的 fetch，第二次请求会**立刻**被 abort。
//
//   所以这里的「工厂函数」不是风格选择，是正确性要求。
//   注释里 "Prevents stale timeout signals" 说的就是这个。
//
//   【模式名】stale signal 问题在 Node 里很常见，
//   凡是把 AbortSignal 存进对象/闭包长期持有的地方都要警惕。'''),

(203, 'before', '''// 【早退路径故意不做 cleanup】
//
//   `!init.signal` 时直接 fetch 后返回，没有 listener 可摘 ——
//   因为 timeout signal 是本地新建的，没有外部对象持有它。
//
//   对比下面那条路径：一旦把外部 signal 的 listener 挂到本地 controller 上，
//   就**必须**在成功和失败两个出口都摘掉（230 行、233 行）。
//   漏一个就是 listener 泄漏 —— 长跑的 CLI 会慢慢积累。
//
//   【写合并 signal 的检查表】挂 listener 的地方，数一下有几个出口
//   （resolve / reject / 早退 / 超时），每个出口都要有 cleanup。'''),

(211, 'before', '''// 【手写 signal 合并，而不是 AbortSignal.any()】
//
//   `AbortSignal.any([a, b])` 是 Node 20+ 才有的。
//   这个文件要兼容更老的运行时，所以手写：
//   controller + 两个 listener + 手动 cleanup。
//
//   顺带处理了一个边界：如果外部 signal **在挂 listener 之前**就已经 abort 了，
//   addEventListener 不会补发事件（AbortSignal 不重放历史），
//   所以 223 行单独检查 `init.signal.aborted` 手动补一刀。
//
//   【这是所有「事件 + 可能已发生」场景的通病】：
//   订阅之前先查一次当前状态，否则会永久错过。'''),

(239, 'before', '''// 【元数据发现的三条路径，按可靠性从高到低】
//
//   ① 用户在 .mcp.json 里直接给了 authServerMetadataUrl
//      → 一次 GET，最可靠。但这是用户可控输入。
//
//   ② RFC 9728：先探 MCP 服务器上的 /.well-known/oauth-protected-resource，
//      读出 authorization_servers[0]，再对那个 URL 做 RFC 8414。
//      这是 MCP 规范推荐路径（资源服务器和授权服务器可以是不同 host）。
//
//   ③ 直接对 MCP 服务器 URL 做 RFC 8414（**带 path**）。
//      这是给老服务器的兼容路径：它们把元数据挂在
//      /.well-known/oauth-authorization-server/{path} 上，不实现 RFC 9728。
//
//   ── ③ 为什么要自己写，不能用 SDK 的 fallback ──
//
//   因为 SDK 自带的 fallback 会**把 path 剥掉**。
//   对于 URL 是 https://host/api/mcp 的服务器，SDK 会去探
//   https://host/.well-known/...，而它实际挂在 https://host/.well-known/.../api/mcp。
//   所以这里保留了 path-aware 的探法（注释里 "preserves the pre-existing
//   path-aware probe for backward compatibility"）。
//
//   【这条注释的价值】它记录了一个「我们为什么不用上游现成实现」的决定。
//   没有这段注释，下一个人会觉得这是重复造轮子然后删掉。'''),

(263, 'before', '''// 【用户可控的 URL，必须强制 https】
//
//   authServerMetadataUrl 来自 .mcp.json，也就是项目里可以提交的文件。
//   如果不强制 https，恶意的 .mcp.json 可以把元数据指向 http://attacker/
//   或者在本地网络里的一个地址 —— 元数据里包含 token_endpoint，
//   于是授权码会被 POST 到攻击者的服务器。
//
//   注释里说得很准确：schema 校验管不了这件事（URL 格式合法就行），
//   所以这里是**纵深防御**，不是重复校验。
//
//   RFC 8414 本身也要求元数据必须通过 TLS 获取，所以这不额外限制什么合法用法。
//
//   【安全校验的位置】越靠近「使用点」越可靠 ——
//   放在 schema 里会被绕过（同一个 schema 复用于别处），放在这里不会。'''),

(302, 'before', '''// 【root URL 不做 fallback：因为 SDK 已经探过同样的端点了】
//
//   第 ③ 条路径（path-aware RFC 8414）存在的意义是「SDK 剥了 path」。
//   如果 URL 本身就没有 path（pathname === '/'），
//   那 SDK 剥不剥都一样，再探一次是纯粹的重复请求。
//
//   所以这里 return undefined 表示「没有更多信息了」，不是「失败」。
//   调用方拿到 undefined 会走「服务器不支持 OAuth」的分支。
//
//   【这类「为了兼容旧实现而加的补丁，要精确限定它生效的范围」】
//   否则每多一个老服务器，就多一次无谓的网络请求。'''),

(320, 'before', '''// 【getServerKey：凭据的寻址方式，决定了整个凭据库的安全性】
//
//   为什么不直接用服务器名做 key？
//
//   因为名字是用户起的，会重复、会复用。考虑这个序列：
//
//     ① 用户配了 server "foo" 指向 https://a.com，登录，token 存在 "foo"
//     ② 用户把 "foo" 改成指向 https://b.com（不同服务器！）
//     ③ 如果不带 hash，a.com 的 token 会被发给 b.com
//
//   这就是**凭据跨服务器泄漏**。加了配置 hash，
//   改了 url 或 headers 就等于换了一个 key，旧 token 自然不被复用。
//
//   ── 为什么 headers 也算进 hash ──
//
//   因为 headers 常带 Authorization（第三方 API key）。
//   改了 header 就是改了「我是谁」，凭据必须失效。
//
//   注意 `headers || {}`：undefined 和 {} 必须哈希成同一个值，
//   否则「显式写空对象」和「不写」会得到两个 key，导致登录态莫名丢失。'''),

(335, 'before', '''// 【截 16 位十六进制 = 64 bit，这是刻意的取舍】
//
//   完整 sha256 是 64 字符。keychain 的条目名有长度限制，
//   而 key 还要拼进文件名（refresh 锁，见 2096 行）。
//
//   64 bit 够不够？生日碰撞需要约 2^32 个不同配置才可能撞。
//   一个用户的 MCP 服务器数量级是 10，所以实际碰撞概率可忽略。
//
//   【截断哈希的判断标准】算一下「输入域有多大」而不是「输出有多少位」：
//   这里输入域是「用户配过的服务器配置」，上限几百，64 bit 绰绰有余。
//   如果 key 来自不可信的大空间输入（比如任意 URL），就不能这么截。'''),

(343, 'before', '''// 【三态区分：这个函数是整个认证流程的「状态机判定器」】
//
//   一个 MCP 服务器在凭据层面只有三种状态：
//
//   ① 从没探过      → 没有 entry          → 值得连一次（可能根本不需要认证）
//   ② 探过但没有 token → entry 存在、token 空 → 必然 401，直接判定 needs-auth
//   ③ 有 token      → 正常连
//
//   这个函数判的是 ②。跳过连接的理由是**省一次注定失败的往返**：
//   401 会让 transport 报错、UI 闪一下「连接失败」、然后才提示认证。
//   直接判定 needs-auth 体验好得多。
//
//   【这是「用持久化状态避免一次网络往返」的典型用法】——
//   代价是状态可能过期（服务器那边改配置了），
//   但 401 之后还能兜回来，所以是安全的优化。'''),

(353, 'before', '''// 【XAA 是这个判定的例外：没有 token 也可能连得上】
//
//   XAA 服务器有一个特殊能力：缓存的 id_token 可以静默换出 access_token
//   （见 1554 行那段注释）。
//
//   所以「entry 存在但没有 access/refresh token」对 XAA 来说
//   不等于「必然 401」—— 它可能在第 4 步静默换出 token 然后正常连上。
//
//   如果这里不跳过 XAA，会有一个很隐蔽的 bug：
//   用户执行 invalidateCredentials('tokens') 清掉 token 之后，
//   自动认证分支就永远走不到了（因为连接在更早的地方被拒绝）。
//
//   【通用教训】优化用的「快速判定」必须把所有例外都列进来。
//   每加一个新机制（这里是 XAA），都要回头检查所有快速路径。'''),

(365, 'before', '''// 【revokeToken：吊销为什么要比获取更谨慎】
//
//   获取 token 失败 → 用户重试一下就行。
//   吊销失败 → 服务器上留着一个**仍然有效**的 refresh token。
//   如果用户的机器被拷贝、或者凭据被导出，那个 token 还能继续用。
//
//   所以这里的策略是「尽力而为但不静默」：
//   所有失败都 logMCPDebug，但都不抛 —— 因为本地清除才是用户真正要的结果。
//
//   ── RFC 7009 的一个细节 ──
//
//   公共客户端（Claude Code 就是，没有 client_secret）应该把 client_id
//   放在**请求体**里，而不是 Authorization 头。
//
//   为什么？Authorization: Bearer 的语义是「我是资源所有者」，
//   而客户端认证是「我是这个应用」。混用会让服务器分不清。
//
//   但规范没说清吊销怎么做，所以有些服务器只认 Bearer —— 那是 434 行的回退。'''),

(408, 'before', '''// 【三种客户端认证方式的优先级，以及一个必须遵守的互斥规则】
//
//   有 secret 且服务器要 client_secret_post → 放 body
//   有 secret 且默认                          → Basic 头（base64(id:secret)）
//   只有 client_id                            → 放 body
//   什么也没有                                  → 只能裸发，并记一条 debug 日志
//
//   ── Basic 头里的 encodeURIComponent 不能省 ──
//
//   RFC 6749 §2.3.1 要求在 base64 之前对 id 和 secret 做 URL 编码。
//   如果 secret 里带冒号（很多生成器会带），不编码就会把
//   `id:sec:ret` 解成 id=id、secret=sec —— 认证失败且极难排查。
//
//   【这类「一行不起眼的编码」是 OAuth 实现里最常见的兼容性 bug 来源。】'''),

(434, 'before', '''// 【401 回退：不仅要换认证方式，还要**先删掉** body 里的凭据】
//
//   这段是全文件最容易写错的地方。看 446-447 行：
//
//     params.delete('client_id')
//     params.delete('client_secret')
//
//   为什么非删不可？RFC 6749 §2.3.1 明确禁止一次请求用超过一种认证方法。
//   如果保留 body 里的 client_id 又加上 Bearer 头，
//   严格的服务器会直接 400；宽松的服务器行为不确定（可能用错身份）。
//
//   【写回退逻辑的通用检查表】
//     ① 换掉新机制需要的部分
//     ② **清掉旧机制留下的部分**（这一条最容易忘）
//     ③ 只在确实需要时回退（这里是 401 + 有 accessToken 两个条件）
//
//   注意条件里的 `&& accessToken`：没有 access token 就没法用 Bearer 回退，
//   这时候应该把原始错误抛出去，而不是发一个注定失败的请求。'''),

(461, 'before', '''// 【吊销顺序：先 refresh 再 access，解释在注释里但值得展开】
//
//   refresh token 是长寿命的那个。留着它，攻击者能持续换出新的 access token。
//   access token 是短寿命的（通常 1 小时），过期自己就废了。
//
//   所以先断「根」，再断「枝」。
//
//   注释还提到一个实践事实：很多服务器在你吊销 refresh token 时
//   会**隐式**把关联的 access token 一起作废。
//   所以第二步经常是空转 —— 但仍然要做，因为不是所有服务器都这样。
//
//   【顺序类逻辑的判断方法】问「如果中间失败了，剩下的东西危害有多大」。
//   先做危害大的那个，失败时的暴露面最小。'''),

(479, 'before', '''// 【三层嵌套 try，每一层都在防不同的失败】
//
//   外层（481）：元数据发现失败 → 记日志，继续往下（本地照样清）
//   中层（499）：服务器不支持吊销 → 记日志，继续往下
//   内层（525/547）：单个 token 吊销失败 → 记日志，**继续吊销另一个**
//
//   内层那个「继续」很重要：如果 refresh 吊销失败就直接 return，
//   access token 也不会被吊销 —— 白白放过一个能清掉的东西。
//
//   【best-effort 序列的正确写法】
//     每个步骤独立 try，失败只记录不中断，
//     最后统一做那个「无论如何都要做」的动作（这里是 576 行清本地）。
//
//   错误的写法是把整个序列包在一个 try 里 ——
//   第一步失败，后面全跳过。'''),

(523, 'before', '''// 【先吊销 refresh，且用独立 try —— 见上方 479 行的说明】
//
//   一个细节：两次吊销都传了 `accessToken`（533 行、555 行），
//   这是给 revokeToken 的 401 回退用的（434 行）。
//   即使正在吊销的是 refresh token，回退时也要用 access token 去做 Bearer 认证 ——
//   因为此刻 refresh token 已经不可信了，不能拿它当认证凭据。
//
//   【凭据的「用途」和「身份」要分开看】：
//   被吊销的对象 ≠ 用来认证自己的凭据。'''),

(575, 'before', '''// 【无论服务器端结果如何，本地一律清掉】
//
//   这是这个函数真正的契约。上面那一大段网络操作全是「尽力」，
//   这一行才是「保证」。
//
//   为什么本地清除必须无条件做？
//   因为用户的意图是「我要取消这个服务器的授权」。
//   如果因为服务器不可达就保留本地 token，用户会看到
//   「点了清除，但还显示已连接」—— 那是个更糟的状态。
//
//   ── 顺序上有个容易写反的地方 ──
//
//   本地清除会删掉整个 entry，包括 discoveryState 和 stepUpScope。
//   而 581 行之后的条件分支需要这两个值。
//   所以必须先读（477 行 tokenData）、再清（576）、再按需写回（615）。
//
//   【这是「读-删-按需写回」模式】：删除是主体行为，
//   保留是例外行为，所以例外部分要靠前面缓存的副本重建。'''),

(578, 'before', '''// 【两种吊销语义：Clear Auth 与 Re-authenticate】
//
//   preserveStepUpState = false（默认，"Clear Auth"）
//     → 全清。连 discoveryState 一起没。下次认证要从零做 RFC 9728 发现。
//
//   preserveStepUpState = true（重新认证场景）
//     → 保留 stepUpScope 和 discoveryState，下次认证不用再探一遍服务器。
//
//   ── 为什么保留时要把 discoveryState 拆开重写 ──
//
//   看 604-609 行：只保留 authorizationServerUrl 和 resourceMetadataUrl，
//   把 resourceMetadata / authorizationServerMetadata 两个大块**丢掉**。
//
//   原因在 2007 行有完整解释：macOS keychain 写入走 `security -i`，
//   stdin 有 4096 字节行限制，完整元数据会让它溢出并损坏凭据库（#30337）。
//
//   所以这里是「顺手做一次历史数据清理」：
//   老版本存进去的膨胀 blob，在下次重新认证时被缩回两个 URL。
//
//   【迁移策略】不要写一次性迁移脚本，而是在**每次写这个条目的地方**
//   都写成新形状。用户下次走到这条路径就自愈了。'''),
]
