# -*- coding: utf-8 -*-
"""mcp/auth.ts 批注 p4：跨进程刷新锁、重试、客户端密钥（1900-2465）。"""

ANNOTATIONS = [
(1922, 'before', '''// 【先通知 UI，再开浏览器 —— 顺序有讲究】
//
//   1924-1926 行把 URL 交给回调（UI 显示出来），
//   然后 1928 行才尝试打开浏览器。
//
//   反过来的话：如果 openBrowser 失败（无 GUI、SSH、容器、默认浏览器配错），
//   用户会看到「正在打开浏览器…」然后什么都没有，
//   而且**没有任何地方能看到那个 URL** —— 他没法手工复制。
//
//   这个顺序保证了「浏览器失败也不影响用户完成认证」。
//
//   ── openBrowser 的失败只记日志，不抛 ──
//
//   1932-1937 行。因为「开不了浏览器」不是认证失败 ——
//   URL 已经在 UI 上了，用户可以自己开。抛错会让整个流程终止。
//
//   【区分「主路径失败」和「辅助手段失败」】辅助失败只降级，不中断。'''),

(1946, 'before', '''// 【PKCE 的 code_verifier 只存内存，不落盘 —— 这是对的】
//
//   verifier 的生命周期极短：从发起授权到换 token，中间就几十秒。
//   存到 keychain 里没有任何好处，反而扩大暴露面
//   （拿到 verifier + 截获 code 就能换 token）。
//
//   所以 saveCodeVerifier 只是赋值给字段。
//
//   ── 代价：跨进程的认证流程无法接续 ──
//
//   假如进程在「打开浏览器」之后、用户点同意之前被杀了，
//   重启后是**没法**用那个 code 的（verifier 丢了）。
//   但这不是问题：直接重新发起一次授权即可，成本是用户再点一次。
//
//   【判断「要不要持久化」的方法】问：丢了它，重来一次的代价是什么？
//   代价低 + 它本身敏感 → 不持久化。'''),

(1960, 'before', '''// 【invalidateCredentials 的五个 scope，语义完全不同】
//
//     'all'        删整个 entry（含 clientId、token、discoveryState、stepUpScope）
//     'client'     只删 clientId + clientSecret（保留 token！）
//     'tokens'     只清 access/refresh/expiresAt，**保留 entry 其余字段**
//     'verifier'   只清内存里的 PKCE verifier（不动存储）
//     'discovery'  清 discoveryState + stepUpScope（重新探服务器）
//
//   ── 最容易搞错的是 'tokens' 和 'all' ──
//
//   它们看起来都是「清 token」，但 'tokens' 把字段设成空值
//   （accessToken: ''、expiresAt: 0、refreshToken: undefined）而**不删 entry**。
//
//   为什么保留 entry？因为 entry 里还有 clientId ——
//   SDK 下次认证时可以直接复用这个 client_id（不用重做 DCR）。
//   如果删了整个 entry，每次刷新失败都要重新注册客户端。
//
//   ── 而 'tokens' 留下的正是那个「假状态」──
//
//   有 entry 无 token → hasMcpDiscoveryButNoToken 返回 true →
//   下次连接直接判定 needs-auth，不做无谓的 401 往返。
//   所以这里的空值不是残留，是**有意的信号**。
//
//   【空值和缺失的区别】在这个存储里，空字符串表示「已知为空」，
//   undefined 表示「不知道」。两者承载不同信息。'''),

(1997, 'before', '''// 【saveDiscoveryState：只存两个 URL，不存完整元数据】
//
//   这个函数最值得读的是 2007-2015 行的注释，它记录了一个真实事故（#30337）：
//
//     authorizationServerMetadata 单独就 1.5-2KB（每种 grant type、
//     PKCE 方法、端点全列出来）。
//     macOS 上 keychain 写入走 `security -i`，而它的 stdin
//     有 **4096 字节的行长度限制**。
//     凭据库用 hex 编码存储 → 2013 字节的 JSON 上限。
//     两个 OAuth MCP 服务器各存一份完整元数据 → 溢出 → 凭据库损坏。
//
//   「凭据库损坏」不是「这个服务器连不上」，而是**所有** MCP 服务器
//   的凭据一起丢。所以这个 bug 的爆炸半径远大于触发条件。
//
//   ── 解法：只存 URL，元数据下次重新 GET ──
//
//   SDK 内部是 `cachedState.authorizationServerMetadata ?? await discover...`。
//   也就是说「缓存命中就用，没命中就自己去取」——
//   所以丢掉元数据不会导致失败，只会多一次 HTTP GET（幂等、便宜）。
//
//   【这是一个「用一次廉价请求换掉一条硬限制」的经典取舍】
//   判断依据：丢掉的东西能不能廉价重建？能，就丢。'''),

(2037, 'before', '''// 【discoveryState 的三级回退，注意第三级是「现场取」】
//
//   ① 凭据库里缓存的（2042 行）→ 最快，直接用
//   ② 配置里给了 authServerMetadataUrl → 现场 GET 一次
//   ③ 都没有 → undefined，让 SDK 自己走完整发现
//
//   ── 一个容易看漏的细节：返回的对象里有两个可能为 undefined 的字段 ──
//
//   2052-2055 行把 resourceMetadata 和 authorizationServerMetadata
//   从缓存里读出来 —— 但 saveDiscoveryState 根本不写这两个字段（2026 行只写两个 URL）。
//
//   所以正常情况下它们**永远是 undefined**。
//   这两行的唯一作用：兼容老版本写进去的完整数据，
//   让「升级前存的缓存」还能被用一次。
//
//   【这就是「读取端要兼容历史写入格式」】即使新的写入已经不再产生那种形状。
//   否则升级后所有用户都会被强制重新发现一次。'''),

(2090, 'before', '''// 【refreshAuthorization：为什么要跨进程锁】
//
//   场景：用户开了两个 CC 实例（两个终端窗口）连同一个 MCP 服务器。
//   token 同时快过期 → 两个进程同时发起刷新。
//
//   ── 没有锁会发生什么 ──
//
//   refresh token rotation 下，第一个刷新成功后旧的 refresh token 立即失效。
//   第二个进程拿着已经失效的 token 去刷 → invalid_grant
//   → 按 invalid_grant 的处理逻辑：清空本地 token
//   → **把这个进程刚写好的新 token 也清掉了**（如果写完了的话）
//   → 两个进程都需要用户重新登录。
//
//   一个本来只在「多开」时出现的偶发问题，表现为「莫名其妙被登出」。
//
//   ── 锁的粒度 ──
//
//   按 serverKey 加锁（2096-2097 行），不是全局锁。
//   不同服务器可以并行刷新，互不影响。
//
//   ── 文件名要清洗 ──
//
//   serverKey 里有 `|`（`name|hash`），不能直接做文件名
//   （某些文件系统会拒绝，Windows 上尤其）。所以 2096 行把
//   非字母数字全换成下划线。
//
//   【这类「把逻辑 key 当文件名用」的地方，必须做字符集清洗】——
//   而且清洗后要仍然唯一（这里 `|` 被换掉，但 hash 部分没变，仍唯一）。'''),

(2099, 'before', '''// 【锁重试策略：5 次，间隔 1-2 秒随机】
//
//   总等待时间上限约 10 秒（5 × 平均 1.5s）。
//   为什么不是「一直等到拿到」？
//
//   因为锁的持有者可能已经死了（进程崩溃但锁文件残留）。
//   无限等待会让所有实例永久卡住。10 秒是个折中：
//   够覆盖一次正常刷新的耗时（几百毫秒到 2 秒），
//   又不至于让用户觉得程序挂了。
//
//   ── 拿不到锁也继续，这是刻意的 fail-open ──
//
//   2131-2136 行：重试用尽后只记一条日志，然后**不带锁继续刷新**。
//
//   为什么？因为「没有锁」的后果是「可能重复刷新」（偶发、可恢复），
//   而「拒绝刷新」的后果是「token 过期 → 用户被登出」（必然、需人工）。
//   两害相权，宁可重复。
//
//   【锁的设计原则】锁是优化，不是正确性保证 ——
//   除非它保护的东西**绝对不能**做两次。
//   这里刷新做两次只是浪费，所以 fail-open 是对的。'''),

(2121, 'before', '''// 【随机抖动防惊群】
//
//   `sleep(1000 + Math.random() * 1000)` —— 1 到 2 秒之间的随机值。
//
//   如果所有等待者都用固定的 1000ms：
//   10 个实例同时被拒 → 同时等 1 秒 → 同时重试 → 9 个又被拒 → 又同时等 1 秒……
//   这种「同步重试」会让冲突持续下去（虽然最终会成功，但慢）。
//
//   加了抖动之后，等待时间被打散，某一个会先成功。
//
//   【凡是「失败后重试」的 sleep，都应该带随机抖动】
//   这是分布式系统里的标准做法（AWS 的 exponential backoff + jitter）。
//   本文件的 _doRefresh 重试（2349 行）**没有**抖动 ——
//   那里是单进程的顺序重试，不存在惊群，所以不需要。'''),

(2139, 'before', '''// 【拿到锁之后必须重新读，不能相信进锁前的值】
//
//   这是「锁 + 缓存」组合的经典陷阱：
//
//     进程 B：读缓存 → 发现 token 还有 10 秒过期 → 决定刷新
//     进程 A：（此刻）刷新完成，写入新 token
//     进程 B：拿到锁 → 用 10 秒前读的旧值判断 → 又刷一次
//              → 但 refresh token 已经被 A 用掉了 → invalid_grant → 清库
//
//   所以 2140 行的 `clearKeychainCache()` 是**必须的**：
//   进锁前的读经过了 keychain 缓存（可能几秒前的），
//   必须强制读一次磁盘才能看到 A 的写入。
//
//   ── 注意这里 clearKeychainCache 是安全的 ──
//
//   因为 refreshAuthorization 是低频路径（最多每 55 分钟一次），
//   不像 tokens() 那样每秒 30 次（见 1541 行的 CPU 说明）。
//
//   【同一个操作在不同频次的路径上，代价差三个数量级。】
//   所以「能不能这么做」的答案取决于「在哪个路径上做」。'''),

(2177, 'before', '''// 【_doRefresh 的三层策略：缓存元数据、白名单重试、精确归因】
//
//   这个函数不算长，但每一段都在处理一种「现实情况」：
//
//     2215-2249  元数据从哪来：内存 → 持久化 → 重新发现（三级）
//     2258-2263  没有 client 信息 → 直接放弃，不重试（重试也没用）
//     2287-2325  invalid_grant → 先查别人刷好没有，再决定清不清
//     2327-2354  只对「临时性」错误重试，指数退避 1/2/4 秒
//
//   ── 一个关键设计：这个函数**从不抛异常** ──
//
//   所有失败都返回 undefined。因为调用方（tokens）需要的是
//   「有没有新 token」这个二元信息，异常只会让它在 SDK 里变成连接错误。
//
//   【「返回 undefined 而不是抛错」是一个明确的接口契约】
//   要写在函数注释里，否则调用方会习惯性 try/catch。'''),

(2207, 'before', '''// 【emitRefreshEvent 把埋点的分支收敛成一个闭包】
//
//   没有这个闭包的话，这个函数里会有 6 处 logEvent：
//     metadata_discovery_failed / no_client_info / no_tokens_returned
//     invalid_grant / transient_retries_exhausted / request_failed
//   每处都要重复 transportType + mcpServerBaseUrl 的拼装，
//   以及那个难看的 as AnalyticsMetadata_... 类型断言。
//
//   收敛之后：每个失败点只写 `emitRefreshEvent('failure', 'xxx')`。
//
//   ── 那个类型断言为什么到处都是 ──
//
//   `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
//   是一个**故意起得很长**的类型名。它的作用是：
//   任何人想把一个可能含用户数据/文件路径的字符串塞进埋点，
//   都得手写这个类型名 —— 写的时候会被这个长名字挡一下，
//   从而想起来「这个值安全吗」。
//
//   【这是用类型系统做代码审查】比 lint 规则更有效，
//   因为你没法「顺手」绕过它。'''),

(2210, 'before', '''// 【MAX_ATTEMPTS = 3，但只在 isRetryable 时才真的重试】
//
//   循环结构容易误解：`for attempt 1..3` 看起来总会跑三次。
//   实际是：不 retryable 的错误在第一次就 return undefined（2337 行）。
//
//   所以这个循环的本质是「最多 3 次尝试」，而不是「一定 3 次」。
//
//   ── 每个 return 都带着一个归因 ──
//
//     metadata 拿不到        → metadata_discovery_failed（不重试）
//     clientInfo 拿不到      → no_client_info（不重试）
//     SDK 返回空             → no_tokens_returned（不重试）
//     invalid_grant          → invalid_grant（不重试，且清库）
//     timeout / 5xx / 429    → 重试，用尽后 transient_retries_exhausted
//     其他（4xx、逻辑错误）    → request_failed（不重试）
//
//   【「不重试」的判据】这个错误重试一次会不会得到不同结果？
//   配置缺失、授权被拒 → 不会。网络超时、限流 → 会。'''),

(2215, 'before', '''// 【元数据缓存的三级优先级，逐级降级】
//
//   ① this._metadata（内存）
//      同一会话内的多次刷新直接命中，零成本。
//
//   ② 持久化的 discoveryState（跨会话）
//      2231-2240 行：如果只存了 authorizationServerUrl 没存元数据
//      （新的存储策略就是这样，见 1997 行），
//      就对那个 URL 做一次 RFC 8414 发现 —— 比完整 RFC 9728 链便宜。
//
//   ③ fetchAuthServerMetadata（完整发现）
//      最贵的一条路，只在前面全空时走。
//
//   ── 为什么优先 ② 而不是直接 ③ ──
//
//   因为 ③ 需要先探 MCP 服务器拿 authorization_servers[0]，
//   再对那个地址做发现 —— 两个请求。
//   而 ② 已经知道 AS 在哪了，一个请求就够。
//
//   【缓存的价值不在于「省一个请求」，而在于「省掉依赖链上的一环」】
//   ② 省掉的是「MCP 服务器必须在线」这个前提。'''),

(2287, 'before', '''// 【invalid_grant 的第一反应不是清库，而是「问别人刷好没有」】
//
//   这个顺序极其重要，写反了就是一个难查的 bug：
//
//   ── 错误顺序 ──
//
//     遇到 invalid_grant → 清空本地 token → 用户被登出
//     但实际上是进程 A 刚刷新成功，B 手里的是旧 refresh token
//     → 清掉的是 A 刚写好的新 token → 两个进程一起被登出
//
//   ── 正确顺序（这里）──
//
//     遇到 invalid_grant → clearKeychainCache + 重新读
//     → 发现 expiresIn > 300（有人刷好了）→ 直接用，不发失败埋点
//     → 确实没有好 token → 才 invalidateCredentials('tokens')
//
//   【「失败」的第一反应应该是「再确认一次状态」，而不是「执行回滚」】
//   因为并发场景下，你看到的失败可能是别人成功之前的残影。
//
//   ── 注意 2294 行的 clearKeychainCache 在这里是必须的 ──
//
//   不加的话读到的还是缓存里的旧值，会误判成「没人刷过」→ 清库。
//   这个操作在低频路径上，代价可接受（对比 tokens() 里的情况，见 1541 行）。'''),

(2306, 'before', '''// 【用别人的结果时不发 success 埋点 —— 遥测准确性的细节】
//
//   注释说得很清楚：
//     "Not emitted as success: this process did not perform a refresh,
//      and the winning process already emitted its own success event.
//      Emitting here would double-count."
//
//   如果不注意，看板上的「刷新成功率」会虚高：
//   一次真实刷新可能被 5 个进程各上报一次成功。
//
//   ── 原则：埋点应该记录「本进程做了什么」，而不是「最终结果如何」 ──
//
//   前者是可加总的（N 个进程的计数加起来 = 总工作量），
//   后者会被重复计数。
//
//   【埋点设计的前置问题】这个指标将来怎么聚合？
//   答不上来就不要加字段。'''),

(2327, 'before', '''// 【重试白名单：三类临时性错误】
//
//     ① message 匹配 timeout|timed out|etimedout|econnreset
//        → 网络层抖动。注意是正则不区分大小写（i 标志）。
//
//     ② SDK 的 ServerError（5xx）
//     ③ SDK 的 TemporarilyUnavailableError（503）
//     ④ SDK 的 TooManyRequestsError（429）
//
//   后三个是 SDK 已经归好类的，比字符串匹配可靠。
//
//   ── 为什么 ① 只能用字符串匹配 ──
//
//   因为网络错误在 Node 里是 Error + code 属性（ECONNRESET 等），
//   不是专门的类。而 axios 的错误、undici 的错误、DNS 错误
//   各有各的形态。匹配 message 是最省事的兜底。
//
//   风险：某些非网络错误的 message 里恰好含 "timeout" 会被误重试。
//   误重试的代价是「多等 3 秒然后同样失败」，可接受。
//
//   【判断错误「可不可重试」的可靠顺序】
//   错误类型 > 错误码 > message 匹配。能用前面的就别用后面的。'''),

(2349, 'before', '''// 【指数退避 1s / 2s / 4s，没有抖动】
//
//   `1000 * Math.pow(2, attempt - 1)`，attempt 从 1 开始：
//   attempt=1 → 1000ms，attempt=2 → 2000ms，attempt=3 → 但 3 次用尽就退出了。
//
//   所以实际只有两次 sleep：1 秒、2 秒。总阻塞上限 3 秒。
//
//   ── 为什么这里不需要抖动 ──
//
//   抖动是为了打散**多个独立客户端**的重试节奏（防止同时打服务器）。
//   这里是单个 CLI 进程内的顺序重试，天然没有同步问题。
//
//   对比 2121 行那个锁重试 —— 那里多个进程在等同一个锁，所以必须抖动。
//
//   【同一个概念（重试退避）在两种场景下的正确形态不同。】
//   照抄代码之前先确认场景是否相同。'''),

(2362, 'before', '''// 【readClientSecret：三种环境的三种处理】
//
//   ① 有环境变量 MCP_CLIENT_SECRET → 直接用（CI / 自动化）
//   ② 没有 TTY → 直接报错，并**告诉用户该怎么办**
//      "No TTY available to prompt for client secret. Set MCP_CLIENT_SECRET env var instead."
//      这是好错误文案：说了现象（没有 TTY）+ 说了方案（设环境变量）。
//   ③ 有 TTY → 交互式读，不回显
//
//   ── ② 那个分支很重要 ──
//
//   如果没有这个检查，在管道/重定向环境下
//   `process.stdin.on('data')` 永远不会收到数据（或者立即 EOF），
//   Promise 永远不 resolve —— 进程静默挂住。
//
//   比报错更糟的是挂住：用户不知道发生了什么。
//
//   【凡是要读 stdin 的地方，先判 isTTY】'''),

(2374, 'before', '''// 【raw mode + 手动处理退格和 Ctrl-C —— 为了不回显】
//
//   `setRawMode(true)` 关掉终端的行缓冲和回显。
//   于是每个按键立即以 data 事件到达，且**不显示在屏幕上**。
//   这就是密码输入框的终端实现方式。
//
//   代价：raw mode 下终端不再帮你处理控制字符，全得自己来：
//
//     Enter      提交（终端发 \\n 或 \\r，两种都要认）
//     Ctrl-C     取消（ETX，码位 \\u0003）→ reject('Cancelled')
//     Backspace  退格（DEL，码位 \\u007F；或 BS，即 \\b）
//                这两个都要处理，不同终端发的不同
//
//   ── 一个细节：每次按键都可能收到多个字符 ──
//
//   粘贴时 `ch.toString()` 会是多个字符。这里用 `secret += c` 追加，
//   所以粘贴也能工作（但没有逐字符回显，用户看到的是「什么都没发生」）。
//   对 client secret 这种一次性输入来说够用。
//
//   ── 退出时没恢复 raw mode 的风险 ──
//
//   只在提交和 Ctrl-C 两个分支恢复。如果进程在这中间被 kill，
//   终端会卡在 raw mode（回车不换行）。这需要 `stty sane` 才能恢复。
//
//   【健壮做法是 try/finally 恢复，这里没做 —— 因为 kill 时 finally 也不执行。】
//   真正可靠的做法是监听 process.on('exit')，但也只能尽力。'''),

(2399, 'before', '''// 【clientSecret 单独存 mcpOAuthClientConfig，和 token 分开】
//
//   这个设计在前面出现过两次（690 行的读取、1482 行的回退），
//   这里补上「为什么」：
//
//   ── 生命周期完全不同 ──
//
//     token         会被频繁清：刷新失败、用户点清除、step-up 重新授权
//     clientSecret  是长期配置：用户 `mcp add` 时填一次，之后不该被动
//
//   如果存在一起（都在 mcpOAuth[serverKey] 里）：
//   `invalidateCredentials('tokens')` 的实现是
//   `tokenData.accessToken = ''` —— 只改 token 字段，secret 确实不受影响。
//
//   但 `invalidateCredentials('all')` 和 `revokeServerTokens` 会删整个 entry。
//   那时候 secret 就跟着丢了。而丢 secret 的后果比丢 token 严重得多：
//   用户得重新去管理员那里要一次密钥。
//
//   ── 另一层理由：secret 不进 token entry 就不会被当成 token 导出 ──
//
//   有些诊断功能会导出「token 状态」（不含值，但含结构）。
//   分开存让这类功能天然不会碰到 secret。
//
//   【存储分组的依据】不是「属于同一个实体」，而是「生命周期和敏感度」
//   是否一致。'''),

(2416, 'before', '''// 【clearMcpClientConfig vs clearServerTokensFromLocalStorage】
//
//   两个函数名字很像，作用域完全不同：
//
//     clearServerTokensFromLocalStorage  删 mcpOAuth[serverKey]（token + clientId + discovery）
//     clearMcpClientConfig               删 mcpOAuthClientConfig[serverKey]（只有 secret）
//
//   ── 谁调 clearMcpClientConfig ──
//
//   用户改配置（换了 secret）、或者 `mcp remove` 时。
//   注意它**不动 token** —— 换了 secret 但 token 还在有效期内时，
//   现有 token 仍然可用（它不依赖 secret 验证），所以不清是对的。
//
//   【两个相似名字的函数，注释里要写清「它和另一个的区别」】
//   否则半年后没人敢动。'''),

(2440, 'before', '''// 【getScopeFromMetadata：三个字段的回退链，全是非标准的】
//
//   OAuth 标准里**没有**任何一个字段表示「这个 AS 默认要什么 scope」。
//   RFC 8414 只定义了 scopes_supported（服务器支持哪些），
//   它是**可用集合**，不是**必需集合**。
//
//   所以这里依次尝试：
//
//     ① scope            非标准，部分服务器这么写
//     ② default_scope    非标准，OIDC 阵营常见
//     ③ scopes_supported 标准，但语义是「支持」不是「默认」
//
//   ── ③ 作为最后兜底其实是有问题的 ──
//
//   把「支持的 20 个 scope」全申请一遍，用户会看到
//   一个要求全部权限的授权页。很多用户会因此拒绝。
//
//   但反过来说，不申请可能不够用（连上就 403）。
//   两害相权，这里选了「多要」—— 因为 403 是硬失败，
//   而授权页太吓人只是体验问题。
//
//   【这是一个可以争论的默认值】注释里没写这个权衡，值得补。
//
//   ── 三个 if 都用了 `'x' in metadata` 而不是直接取属性 ──
//
//   因为 metadata 是联合类型（OAuthMetadata | OpenIdProviderDiscoveryMetadata），
//   直接访问会 TS 报错。`in` 收窄是标准做法。
//   2445 行的返回类型是 string | undefined —— 所有分支都必须有 return。'''),

(2449, 'before', '''// 【顺序本身就是信息：先非标准、后标准】
//
//   看起来应该「先用标准字段」，但这里反过来了。
//
//   原因是语义：
//     scope / default_scope  是「该用什么」→ 明确意图
//     scopes_supported       是「能用什么」→ 能力清单
//
//   当服务器同时提供时，前者的意图更精确。
//   标准字段在这里反而是最粗的那个，所以放最后。
//
//   【「标准优先」不是无条件正确的】
//   标准字段往往是最大公约数（表达力最弱），
//   非标准字段常常表达了标准没覆盖的精确意图。
//
//   判断顺序应该按「哪个更贴近真实意图」，不是按「哪个更标准」。'''),

(2461, 'before', '''// 【数组 join(' ') —— OAuth scope 的传输格式就是空格分隔】
//
//   scopes_supported 是 string[]，但 OAuth 协议里的 scope 参数
//   是**空格分隔的单个字符串**（RFC 6749 §3.3）。
//
//   所以这里必须转换。类似的转换在本文件里出现多次：
//     1628 行  scope.split(' ')     读的时候拆
//     1631 行  pending.split(' ')   比较时拆
//     2462 行  join(' ')            写的时候拼
//
//   ── 这类「存储格式 vs 传输格式」的转换散落各处是个隐患 ──
//
//   如果某天服务器返回的 scope 里含逗号（不规范但存在），
//   split(' ') 就会切错。更稳的做法是 `split(/\\s+/)` + filter(Boolean)，
//   但现状能用，没改。
//
//   【看到同一种转换在文件里出现三次以上，就该抽成工具函数。】
//   这里是本文件里最明确的「该抽而未抽」的一处。'''),
]
