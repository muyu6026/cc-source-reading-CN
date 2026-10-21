# -*- coding: utf-8 -*-
"""mcp/auth.ts 批注 p3：step-up 补丁与 ClaudeAuthProvider 上半（1360-1900）。"""

ANNOTATIONS = [
(1344, 'before', '''// 【这段注释描述的是全文件最精妙的一个补丁，值得逐句拆开】
//
//   场景：token 有效，但 scope 不够。服务器返回 403 + 
//        WWW-Authenticate: Bearer error="insufficient_scope", scope="files:write"
//
//   期望行为：重新走一次授权（带更大的 scope），用户点同意，拿到新 token。
//
//   ── 不加这个补丁会发生什么（一段真实的死循环）──
//
//     SDK 收到 403 → 进 authInternal → 看到内存里有 refresh_token
//       → 走刷新路径（**这是错的**，RFC 6749 §6 明确禁止 refresh 提升 scope）
//       → 服务器返回一个同样 scope 的 token（它只能这样）
//       → SDK 认为刷新成功，返回 'AUTHORIZED'，重试原请求
//       → 又是 403 → SDK 放弃，报 "Server returned 403 after trying upscoping"
//
//   关键点：它**永远到不了** redirectToAuthorization（1852 行），
//   而 step-up 的 scope 正是在那里被持久化的。
//   所以下一次重新认证时，我们仍然不知道要申请更大 scope，再进同一个循环。
//
//   ── 补丁的思路：不改 SDK，改它的输入 ──
//
//   在 SDK 处理 403 之前，先把这个 scope 记到 provider 上（markStepUpPending）。
//   然后 tokens() 在 step-up 待处理时**故意不返回 refresh_token**（1690 行）。
//
//   于是 SDK 的 authInternal 发现「没有 refresh token」，
//   只能落回 PKCE 授权码流程 → 走到 redirectToAuthorization → scope 被持久化 → 用户授权。
//
//   【这是一个用「返回值的缺失」改变调用方控制流的技巧】
//   它比 patch SDK、比 fork、比在重试层拦截都便宜，
//   代价是把「tokens() 返回什么」和「SDK 内部走哪条分支」耦合成了一条隐式契约。
//   所以注释里必须把这个耦合写清楚 —— 否则下一个人看到
//   `refresh_token: needsStepUp ? undefined : ...` 会觉得这是个 bug。
//
//   参考 issue: github.com/anthropics/claude-code/issues/28258'''),

(1363, 'before', '''// 【RFC 6750 §3 允许 scope 带引号或不带引号】
//
//   服务器 A:  scope="files:write admin"
//   服务器 B:  scope=files:write
//
//   正则 `scope=(?:"([^"]+)"|([^\\s,]+))` 两个分支分别抓这两种，
//   然后 `match?.[1] ?? match?.[2]` 取非空的那个。
//
//   ── 为什么不直接用 SDK 的解析函数 ──
//
//   注释说 "Same pattern as the SDK's extractFieldFromWwwAuth" ——
//   也就是抄了 SDk 的实现。因为那个函数没导出，只能复制。
//
//   【这是复制代码的合理场景】但不能算好：SDK 改了正则，这里不会跟着改。
//   复制处应该留注释注明来源（这里确实注了）。'''),

(1376, 'before', '''// 【ClaudeAuthProvider 的角色：MCP SDK 的九方法回调面】
//
//   SDK 不认识 keychain、不认识我们的存储格式、不认识 XAA。
//   它只认这个接口：
//
//     clientMetadata()          我是什么应用（给 DCR 用）
//     clientInformation()       我的 client_id / secret
//     saveClientInformation()   DCR 的返回值存起来
//     tokens()                  给我一个可用的 token（每次请求都调！）
//     saveTokens()              换到了，存起来
//     redirectToAuthorization() 打开浏览器
//     saveCodeVerifier()/codeVerifier()   PKCE
//     state()                   CSRF 令牌
//     invalidateCredentials()   某个东西坏了，清掉
//     discoveryState()/saveDiscoveryState()  发现结果缓存
//
//   所有策略（什么时候刷新、什么时候清、什么时候走 XAA）
//   都藏在这些回调的**实现**里，SDK 完全不知情。
//
//   【这是「适配器模式」在认证领域的典型用法】
//   好处：换存储后端（keychain → 文件 → 内存）不用动 SDK。
//   坏处：控制流变得隐晦 —— SDK 什么时候调 tokens() 是它的自由，
//   你只能通过「返回什么」去影响它（见 1690 行那个例子）。'''),

(1388, 'before', '''// 【_refreshInProgress：单飞（single-flight）】
//
//   问题：刷新是网络请求，耗时几百毫秒。
//   而 tokens() 在并发请求下会被同时调用多次
//   （MCP 服务器同时发 5 个工具调用，SDK 会给每个请求都取一次 token）。
//
//   不收敛的话：5 个并发刷新。
//   后果不是「浪费网络」这么轻 —— refresh token 常常是**一次性的**
//   （刷新后旧的立即失效，这是 refresh token rotation）。
//   5 个并发刷新里，只有 1 个成功，另外 4 个拿到 invalid_grant。
//   而那 4 个会把 invalid_grant 当成「token 坏了」→ 清库 → 用户被踢下线。
//
//   所以这里必须把并发合并成一个 Promise：
//   第一个调用创建，后面的 await 同一个（1652-1667 行）。
//
//   【单飞的正确实现要点】
//     ① 用 `.finally()` 清空而不是 `.then()` —— 失败也必须清，否则永久卡住
//     ② 存的是 Promise 不是结果 —— 后来的调用者要能 await
//     ③ 只在「发起」处判空，await 处不能再判（否则中间被清空就漏了）'''),

(1417, 'before', '''// 【clientMetadata：我们在 AS 眼里是什么应用】
//
//   `token_endpoint_auth_method: 'none'` 是关键 —— 声明我们是**公共客户端**。
//   意思是：我们没有 client_secret（或者说有也不用），
//   身份靠 PKCE 的 code_verifier 证明。
//
//   这是 CLI / 桌面应用的唯一正确选择：
//   你没法在用户机器上安全地保存 client_secret（任何人拿到二进制都能提取）。
//   所以规范要求这类应用用 PKCE 而不是密钥。
//
//   ── scope 从元数据里推，而不是写死 ──
//
//   1427 行从 AS 的元数据里读 scope。读的顺序见 2445 行：
//   `scope` → `default_scope` → `scopes_supported`（取并集）。
//
//   为什么这么做？因为不同服务器要求的最低 scope 不同，
//   写死一个要么不够（连上就 403），要么过大（用户看到吓人的授权请求）。
//
//   【客户端应该尽量「问服务器要什么」，而不是自己猜。】'''),

(1439, 'before', '''// 【CIMD（SEP-991）：把 client_id 变成一个 URL】
//
//   传统流程（DCR，Dynamic Client Registration）：
//     客户端 POST /register → 服务器生成 client_id → 存起来
//   问题：每个用户、每台机器都要注册一次，服务器上堆满垃圾记录；
//   而且注册结果是状态，客户端丢了就得重来。
//
//   CIMD 的思路：client_id 直接就是「描述这个应用的 JSON 文档 URL」。
//   服务器自己去 GET 那个 URL 读元数据（client_name、redirect_uris、scope）。
//   无需注册，无状态。
//
//   ── 触发条件 ──
//
//   只有当 AS 元数据里声明 `client_id_metadata_document_supported: true` 时，
//   SDK 才会用这个 URL 当 client_id。否则走 DCR。
//   也就是说**这段代码不需要判断**，它只是「准备好一个 URL 候选」。
//
//   ── MCP_OAUTH_CLIENT_METADATA_URL 这个环境变量的用途 ──
//
//   注释说 "e.g. for testing, FedStart"。FedStart 是合规环境，
//   要求所有元数据文档托管在特定域名下 —— 所以必须能改。
//
//   【这类「测试/合规逃生阀」值得学】默认值写死最安全，
//   但留一个环境变量就能覆盖，成本是一行 if。'''),

(1460, 'before', '''// 【markStepUpPending：一个 setter，改变的是 SDK 的控制流】
//
//   看名字像是「设置一个标记」，实际作用远比名字大 ——
//   它让 tokens() 不再返回 refresh_token（1690 行），
//   从而让 SDK 放弃刷新、改走重新授权。
//
//   【命名建议】这类「改状态以影响外部控制流」的方法，
//   名字最好能体现后果。比如 markStepUpPending 也可以叫
//   forceReauthorizationOnNextTokensCall()—— 但太长了。
//   折中：名字保持简短，**紧邻的注释承担说明责任**（这里做到了）。
//
//   只有 provider 是 transport 挂的那个实例（handleRedirection=false）时，
//   这个标记才有意义 —— 见 1884 行那段关于持久化的注释。'''),

(1482, 'before', '''// 【clientInformation 的三级回退，顺序体现优先级】
//
//   ① 凭据库里存的 clientId       ← DCR 的结果，或者上次认证留下的
//   ② 配置里预置的 clientId       ← 用户手工在 .mcp.json 里填的
//   ③ undefined                  ← 触发 SDK 去做 DCR
//
//   为什么 ① 优先于 ②？
//
//   因为 DCR 的结果是**服务器认可的**。用户手填的 clientId
//   可能已经过期、或者填错了。有服务器认可的，就用它。
//
//   ── 但 ② 的 secret 从另一个地方取 ──
//
//   1500 行读的是 `mcpOAuthClientConfig`（和 token 分开的那个 map，见 690 行）。
//   而 ① 的 secret 在读 `mcpOAuth` 里。
//   两条路径读两个不同的存储位置 —— 这个不对称很容易看漏。
//
//   原因：DCR 回来的 secret 是**服务器发的**，随 token 生命周期走；
//   用户手填的 secret 是**用户配的**，长期有效（2399 行）。
//
//   【返回 undefined 不是错误，是一个指令】—— 告诉 SDK「去注册」。'''),

(1513, 'before', '''// 【saveClientInformation：DCR 的返回值落盘】
//
//   注意 1531-1532 行这两个默认值：
//
//     accessToken: existing...?.accessToken || ''
//     expiresAt:   existing...?.expiresAt   || 0
//
//   为什么需要它们？因为这个 entry 的类型要求这两个字段必填
//   （看 SecureStorageData 的定义）。
//
//   ── 而这两个默认值制造了一个「假状态」──
//
//   写入之后，凭据库里会存在一个 `{clientId, accessToken:'', expiresAt:0}` 的条目。
//   从「有没有 token」的角度看：没有。
//   从「有没有 entry」的角度看：有。
//
//   hasMcpDiscoveryButNoToken（349 行）判的正是「有 entry 无 token」→ 必然 401。
//   如果 DCR 写完、用户还没授权就被打断，下次连接会被判成 needs-auth —— 正确。
//
//   ── 但 XAA 那条路径被这个假状态坑过 ──
//
//   1570-1579 行的长注释解释了：曾经想用「accessToken !== ''」作为
//   「是否需要静默换 token」的判据，结果这个 marker 残留在 keychain 里，
//   导致自动认证永久失效。所以最终没有特判。
//
//   【结论】为了满足类型而写的默认值，会在别处变成「有语义的状态」。
//   写的时候要想到：别人会拿这个值做判断。'''),

(1540, 'before', '''// 【tokens()：本文件最热的方法，每次 MCP 请求都会调】
//
//   调用频率的量级：注释里说 30-40 次/秒（见下一条）。
//   所以这个方法里的每一个操作都要按「会被高频执行」来审视：
//
//     · 能不能避免一次同步 IO？
//     · 能不能避免一次网络请求？
//     · 能不能复用上一次的结果？
//
//   但同时它还要承担**正确性**职责：
//     · 过期了要刷新
//     · step-up 时要隐藏 refresh token
//     · XAA 时要静默换 token
//
//   【热路径 + 复杂逻辑 = 最容易出隐蔽 bug 的组合】
//   因为性能压力会诱使人加缓存，而缓存和「凭据可能被别的进程改掉」直接冲突。
//   下面的注释就是在讲这个冲突怎么折中。'''),

(1541, 'before', '''// 【一条用 CPU profile 换来的注释：不要在这里 clearKeychainCache】
//
//   背景：跨进程场景（开了两个 CC 实例，A 刷新了 token）。
//   B 的 tokens() 读的是 keychain 缓存，可能拿到旧值。
//   直觉的修法：每次读之前 clearKeychainCache() 强制读盘。
//
//   ── 为什么不行 ──
//
//   macOS 上读 keychain 要走 `security find-generic-password`，
//   而 secureStorage 的实现用的是 **spawnSync** —— 同步阻塞地起一个子进程。
//
//   tokens() 每秒被调 30-40 次。每次都 spawnSync 一个进程 →
//   CPU profile 显示 spawnSync 占了总 CPU 的 7.2%（PR #19436 之后测到的）。
//
//   7.2% 的 CPU 只是表面代价。真正的代价是**同步阻塞**：
//   每次 spawnSync 期间事件循环停住，UI 掉帧、其他网络回调延迟。
//
//   ── 那跨进程一致性怎么保证 ──
//
//   ① 读的时候用缓存（这里）
//   ② 真要读最新值时，在**低频路径**上清缓存：
//      - refreshAuthorization 拿到锁之后（2140 行）
//      - _doRefresh 遇到 invalid_grant 之后（2294 行）
//   ③ 本进程自己写的，storage.update() 会主动失效缓存（不用手动清）
//
//   【这是一个「用最终一致换性能」的决定，而且它是对的】
//   因为过期的代价只是「多一次 401 → 触发刷新」，
//   而阻塞事件循环的代价是全局的。'''),

(1554, 'before', '''// 【XAA 静默换 token：把 id_token 当成「另一种 refresh token」】
//
//   UX 上的等价关系：
//     有 refresh_token  → 静默刷出 access_token（1 个请求）
//     有 id_token       → 静默走 XAA 链换 access_token（4 个请求）
//
//   两者都不需要用户操作。所以对用户来说，
//   「id_token 还在缓存里」就等于「不用重新登录」。
//
//   ── 触发条件是三个的合取（1585-1591 行）──
//
//     ① isXaaEnabled() 且 serverConfig.oauth.xaa   这是 XAA 服务器
//     ② !tokenData?.refreshToken                   没有 refresh token
//     ③ !accessToken 或 5 分钟内过期                  当前 token 不可用/快过期
//
//   条件 ② 的意义：如果 AS 给了 refresh token，
//   普通刷新只要 1 个请求，XAA 链要 4 个。有便宜的路就走便宜的。
//
//   但 ② 之后还有个回流：如果刷新被拒（refresh token 被吊销），
//   refreshAuthorization 会 invalidateCredentials('tokens') 清掉它，
//   下一次 tokens() 条件 ② 就成立了 → 落到 XAA 分支。
//   所以两条路是**接续**的，不是互斥的。'''),

(1570, 'before', '''
// 【这段注释值得完整读一遍：它在解释「为什么不做一件看起来更严谨的事」】
//
//   看起来更严谨的判据是：
//     「只有当 accessToken !== '' 时才认为需要换 token」
//   因为空字符串显然代表「没有 token」。
//
//   ── 为什么这个判据会致命 ──
//
//   SDK 在一次认证流程的中途会调用 saveClientInformation，
//   而那里为了满足类型要求写了 `accessToken: ''`（1531 行）。
//   也就是说：**认证进行到一半，凭据库里就有一个 accessToken:'' 的 marker**。
//
//   如果判据是 `accessToken !== ''`：
//     用户上次认证被打断 → marker 留在 keychain
//     → 下次连接：accessToken === '' → 不走 XAA 静默分支
//     → 走普通路径 → 没有 token → 返回 undefined → 401 → needs-auth
//     → 用户点了认证 → 认证中途又写 marker → 又被这个判据挡住
//
//   结果：XAA 的自动认证**永久失效**，用户每次都要手工登录。
//   注释里说 "real bug seen with xaa.dev" —— 这是真发生过的。
//
//   ── 所以最终判据是 `!accessToken`（空字符串也算没有）──
//
//   代价是注释里承认的「无害的重复」：
//   第一次 tokens() 调 XAA 静默换 → 没 id_token → 返回 undefined →
//   auth() 走流程 → 写 marker → 又调 tokens() → 又一次静默换 → 又失败。
//
//   多一次 keychain 读（约 1ms），换来的是「自动认证总能工作」。
//
//   【这段注释的教学价值】它把「一个看似多余的调用」的来源完整交代了。
//   没有它，下一个人优化时会把这个重复调用删掉，然后重新引入同一个 bug。'''),

(1622, 'before', '''// 【过期判定的三个分支，每个通向不同的恢复路径】
//
//     expiresIn <= 0 且无 refresh   → 返回 undefined → SDK 报 401 → needs-auth（要人）
//     expiresIn <= 300 且有 refresh → 主动刷新（1650 行）
//     expiresIn > 300               → 直接用（可能还会因 step-up 隐藏 refresh）
//
//   为什么是 300 秒（5 分钟）而不是 0？
//
//   因为「刚好没过期」的 token 在请求发出去的路上就过期了。
//   实际耗时 = 网络往返 + 排队 + 服务器处理，可能几秒到几十秒。
//   留 5 分钟余量是为了让「取 token」和「用 token」之间不会跨过过期点。
//
//   【刷新窗口的取值原则】应该大于 P99 的「取到用到」耗时。
//   网络抖动时这个值偏小会表现为偶发的 401。
//   5 分钟对 CLI 来说很宽松，代价是稍微频繁的刷新（refresh token 寿命消耗快一点）。'''),

(1625, 'before', '''// 【needsStepUp 的判定：pending scope 里有当前 token 没有的吗】
//
//   1628-1631 行：
//     currentScopes = tokenData.scope?.split(' ') ?? []
//     needsStepUp = pending 存在 && pending 里至少一个不在 current 里
//
//   注意 `?.` 的兜底：tokenData.scope 可能没有（服务器没返回 scope）。
//   这时 currentScopes 是空数组，于是「pending 里任何 scope 都算缺」→ needsStepUp = true。
//
//   这个默认行为是对的：不知道有什么 scope 时，按「什么都没有」处理，
//   多走一次授权比「以为够了然后 403」好。
//
//   ── 为什么要逐个比较而不是字符串相等 ──
//
//   因为 scope 是无序集合，服务器返回的顺序和请求的顺序不一定一致。
//   比 set 包含关系，不比字符串。
//
//   【这类「集合语义 vs 字符串语义」的坑】在 OAuth、CORS、权限系统里到处都是。'''),

(1645, 'before', '''// 【主动刷新：用一次多余的请求换掉一次失败请求的延迟】
//
//   不主动刷新的流程：
//     发请求 → 401 → SDK 刷新 → 重发请求   （用户多等一个往返）
//
//   主动刷新的流程：
//     刷新 → 发请求                          （用户少等一个往返，但可能白刷）
//
//   代价：如果这次 token 其实还能用（比如用户只是刷了一下 /mcp 命令），
//   就白刷了一次。refresh token rotation 下还会消耗一次轮换次数。
//
//   ── 为什么这里选了主动 ──
//
//   1 小时的 token 寿命、5 分钟的刷新窗口，
//   平均每 55 分钟才刷一次。相比「偶发的多等一个往返」，
//   这个代价可以忽略。
//
//   ── 但 step-up 时必须跳过（`!needsStepUp`）──
//
//   因为刷新**不能**提升 scope（RFC 6749 §6）。
//   刷了还是同样的 scope，然后还是 403，白刷一次还多花时间。
//   所以 step-up 待处理时直接跳过刷新，把控制权交给 SDK 的重新授权路径。'''),

(1687, 'before', '''// 【返回的 token 对象：refresh_token 可以是 undefined】
//
//   1690 行 `needsStepUp ? undefined : tokenData.refreshToken`
//   这是 step-up 补丁的落地点（见 1344 行）。
//
//   ── `expires_in: expiresIn` 可能是负数 ──
//
//   如果走到了这里（说明刷新失败或者不需要刷新），
//   而 token 已经过期了（expiresIn < 0），返回的 expires_in 就是负数。
//
//   这看起来像 bug，其实是**刻意的**：
//   SDK 拿到负的 expires_in 会认为 token 已过期，
//   如果它有 refresh_token 就会去刷；没有就报 401。
//   两条路都是我们想要的。
//
//   如果这里「修正」成 `Math.max(0, expiresIn)`，
//   反而会让 SDK 以为 token 还能用几秒，行为不可预测。
//
//   【不要「修正」看起来不合理的值】先想清楚消费方怎么用它。'''),

(1704, 'before', '''// 【saveTokens 第一行清 _pendingStepUpScope —— 位置很关键】
//
//   1705 行 `this._pendingStepUpScope = undefined`
//
//   为什么必须在最前面？因为「保存了新 token」就意味着
//   step-up 已经完成（新 token 带着更大的 scope）。
//   如果不清，下一次 tokens() 会继续隐藏 refresh_token，
//   于是又走一遍授权流程 —— 用户会被反复要求授权。
//
//   ── 必须在任何 await 之前清吗 ──
//
//   这个方法里没有 await（storage.update 是同步的），所以不存在竞态。
//   但如果将来改成异步存储，这个「第一行」就变成了「在 await 之前」的要求 ——
//   否则并发的 tokens() 会在清理之前读到旧标记。
//
//   【状态清理的位置】要么在函数最开头（同步可见），
//   要么在明确的提交点之后。不要在中间。'''),

(1733, 'before', '''// 【xaaRefresh 里的 TODO 是一份诚实的技术债记录，值得逐条看】
//
//   问题：`_refreshInProgress` 只在**一个进程内**去重。
//   两个 CC 实例同时开着，token 都快过期 → 各自跑完整个 4 请求 XAA 链
//   → 各自 storage.update() 写 keychain → 后写的赢，先写的那次作废。
//
//   ── 注释里最值得学的是「为什么这个 race 不致命」的分析 ──
//
//   对比 inc-4829（另一个 race）：那里 id_token 是**单次使用**的，
//   两个进程抢同一个 id_token，一个成功一个失败 —— 那才是真故障。
//
//   这里 id_token 不是单次使用，所以两次交换都成功，
//   两个 access_token 都有效。损失只是：
//     · 多跑一遍 4 个请求（浪费流量）
//     · keychain 写竞争（后写的赢，但两个值都可用）
//
//   【判断 race 的严重程度，看「失败的那一方会留下什么坏状态」】
//   如果什么都不留，那它只是浪费；如果留了半个状态，那就是故障。
//
//   这段注释还指明了解法（抄 refreshAuthorization 的 lockfile 模式），
//   只是没做。这就是好的 TODO：说明现象、评估影响、给出路径，但没有假装已完成。'''),

(1776, 'before', '''// 【soft-fail：静默路径上失败一律返回 undefined，不抛】
//
//   xaaRefresh 是从 tokens() 里调用的。tokens() 的语义是
//   「有就给我，没有就返回 undefined 让我走 401 流程」。
//
//   如果这里抛异常，异常会穿过 tokens() 冒到 SDK 里，
//   而 SDK 对 tokens() 抛错的反应是「连接失败」——
//   用户看到的是「服务器连不上」，而不是「需要重新登录」。
//
//   ── 所以每条失败都要软化成 undefined ──
//
//     没 IdP 配置      → return undefined（用户删了配置）
//     没缓存的 id_token → return undefined（要人登录）
//     缺 clientId/secret → return undefined（配置不全）
//     OIDC 发现失败     → return undefined（网络问题）
//
//   四种原因都归到同一个出口，因为**调用方不需要区分**：
//   它只知道「静默换不到了，走需要人工的流程」。
//
//   【分层的错误处理原则】只在能做出不同决策的层区分错误类型。
//   不能做出不同决策的，就该归一。'''),

(1804, 'before', '''// 【为什么直接写 storage 而不是调 saveTokens —— 一个跨模块的隐性契约】
//
//   表面上 saveTokens 就够了。但 saveTokens 的实现是：
//
//     { ...existing, accessToken, refreshToken, expiresAt, scope }
//
//   它只 **spread 已有数据**，不写 clientId / clientSecret。
//
//   ── 后果链 ──
//
//   如果这是 serverKey 的**第一次**写入（用户配了 XAA 但还没走过完整认证，
//   直接靠静默交换连上），那 entry 里就没有 clientId。
//
//   之后用户点「清除授权」→ revokeServerTokens（467 行）
//   → 读 `tokenData.clientId` 得到 undefined
//   → 发一个不带 client_id 的 RFC 7009 吊销请求
//   → 严格的 AS（Okta / Stytch）直接拒绝
//   → 服务器上的 token 没被吊销，但本地已经清了
//
//   用户以为授权撤销了，实际上服务器上那个 refresh token 还活着。
//   这是一个**安全后果**，不是功能后果。
//
//   【教训】「写入函数」如果只增量更新部分字段，
//   它在不同调用顺序下会留下不同的残缺状态。
//   跨模块依赖这些字段时，必须显式补齐（这里补了 clientId + clientSecret）。'''),

(1852, 'before', '''// 【redirectToAuthorization：scope 的三个来源，按可信度排序】
//
//   ① 授权 URL 里的 scope 参数（1857 行）
//      ← 最可信：这是 SDK 根据 AS 元数据 + step-up 要求拼出来的
//
//   ② 内存里的 _metadata（1872 行）
//      ← 次可信：从 AS 元数据推的（2445 行那个回退链）
//
//   ③ 都没有 → 不设 scope，让服务器用默认值
//
//   为什么不直接用配置里的 scope？
//   因为 step-up 场景下配置里的 scope 是**旧的、不够的**。
//   URL 里带的是这次真正要申请的。
//
//   ── 同时这个函数是「打开浏览器」的唯一位置 ──
//
//   所以它承担了两件事：记录 scope（给 token 交换用）+ 真的开浏览器。
//   两件事分开会更好，但 SDK 的接口只有一个回调点。'''),

(1884, 'before', '''// 【step-up scope 只在 handleRedirection === false 时持久化 —— 为什么要这个守卫】
//
//   provider 有两种实例：
//
//     handleRedirection = true     performMCPOAuthFlow 里 new 的（968 行）
//                                  这是「用户主动点认证」，会真的开浏览器
//
//     handleRedirection = false    transport 挂的那个（client.ts 里 new）
//                                  它永远不开浏览器，只负责在 401/403 时报告
//
//   ── 只有第二种才该持久化 scope ──
//
//   因为它的 scope 来源**必然是**一次 401/403 响应（服务器说「我要更大的」）。
//
//   而第一种的 scope 可能来自元数据的 scopes_supported（2445 行的回退），
//   那是「服务器支持的所有 scope」，不是「这次需要的」。
//   把它当 stepUpScope 存下来，下次认证会申请一个过大的 scope ——
//   用户看到一个吓人的授权页（"这个应用要读你所有文件"）。
//
//   【同一段代码在两种实例下语义不同，必须用标志位区分】
//   这类分支最好紧贴一个说明「为什么」的注释，否则下一个人会当成冗余判断删掉。'''),

(1890, 'before', '''// 【`existing` 判空而不是新建 —— 一个刻意的保守选择】
//
//   1895 行 `if (existing)`：只有当 entry 已经存在时才写 stepUpScope。
//
//   如果 entry 不存在（比如凭据被清光了），这里什么都不做。
//   为什么不新建一个？
//
//   因为新建 entry 需要填 accessToken / expiresAt 这些必填字段，
//   而此刻我们知道的值是「没有 token」—— 写进去就是那个「假状态」
//   （见 1513 行的说明），会让 hasMcpDiscoveryButNoToken 误判。
//
//   【宁可少写一个字段，也不要写一个半真半假的条目。】
//   这类「不完整状态」是凭据库里最难排查的问题。'''),
]
