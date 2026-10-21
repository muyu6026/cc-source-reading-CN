# -*- coding: utf-8 -*-
"""withRetry.ts 批注 2/2：退避计算、错误消息正则解析、四家认证错误、shouldRetry 决策树。"""

ANNOTATIONS = [
(519, 'before', '''// ═══ 读 retry-after ═══
//
// 为什么要写两种取法：error.headers 有两种形态。
//   · 普通对象形态：headers['retry-after']（直接下标）
//   · Headers 实例形态：headers.get('retry-after')
//
// 取决于错误从哪来：SDK 抛的 APIError 一般是 Headers 实例，
// 但经过某些网关/包装层之后可能退化成普通对象。所以先试下标、再试 get。
// 那个 `?.get?.()` 的双问号就是在防「headers 是对象但没有 get 方法」。'''),

(530, 'before', '''// ═══════════════════════════════════════════════════════════════
// getRetryDelay —— 退避计算，14 行，但有两个容易忽略的细节
// ═══════════════════════════════════════════════════════════════'''),

(535, 'before', '''// ⚠ 细节一：服务端给的 retry-after **优先于一切本地计算，且不受 maxDelayMs 约束**。
//
// 看 538 行：`return seconds * 1000` —— 直接返回，没有 Math.min。
// 这是有意的（行 450 的注释也提到了）：服务端的指令应当被尊重。
//
// 代价是理论上可能等很久，所以调用方在 persistent 分支外面
// 又套了一层 PERSISTENT_RESET_CAP_MS（6 小时）兜底（行 446 / 459）——
// 防止一个病态的 header 让进程睡到下辈子。
//
// 另一个细节：parseInt 而不是 Number。'30abc' 会得到 30 而不是 NaN，
// 对 header 这种可能带多余字符的输入更宽容。'''),

(542, 'before', '''// 细节二：**指数退避的上限是 32 秒**（maxDelayMs 默认值）。
//
//   第 1 次 → 0.5s    第 5 次 → 8s
//   第 2 次 → 1s      第 6 次 → 16s
//   第 3 次 → 2s      第 7 次起 → 32s（封顶）
//   第 4 次 → 4s
//
// 10 次重试全耗完约 5 分钟。封顶 32 秒的理由：再长的话用户体验太差，
// 而且真要恢复的话 32 秒足够探测出来（服务端过载通常在秒级恢复）。'''),

(546, 'before', '''// ⚠ 这里用的是「正抖动」（0 到 +25%），不是业界常见的 full jitter
// （0 到 base 的均匀随机）。
//
// 差别很实际：
//   full jitter     可能把 32 秒缩成 2 秒，打散效果好但等待时间不可控
//   正抖动（这里）  保证不低于理论退避值，只在上面加噪声
//
// 目的是一样的：让同时失败的 N 个客户端不要在同一毫秒一起重试
// （thundering herd）。代价是打散效果比 full jitter 弱 ——
// 但对一个桌面 CLI 来说，「不会莫名等很短」比「打散更彻底」更重要。'''),

(550, 'before', '''// ═══ 正则解析错误消息：全文件最脆弱的一段 ═══
//
// 它靠匹配 API 返回的**自然语言**来提取三个数字。看行 569 的格式例子：
//
//     "input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000"
//
// 服务端只要改一个标点（比如把 `+` 换成 `and`、把反引号去掉），
// 这个函数就永远返回 undefined，那条「缩小 max_tokens 再试」的恢复路径
// 就直接失效 —— 而且是**静默失效**，不会有任何报错。
//
// 为什么还是这么写了：因为 API 没有给这三个数字提供结构化字段
// （没有 header、没有 error.details）。只能从文案里抠。
// 这也是为什么上面 385 行的注释说「这个 400 现在根本不该发生了」——
// 新机制用 stop_reason 替代了它，这段代码是给老网关留的后路。'''),

(557, 'before', '''// 三道闸门，缺一不可：状态码必须是 400、必须有 message、
// message 里必须含那句特征串。先便宜后贵，避免每次错误都跑正则。'''),

(590, 'before', '''// parseInt 之后还要防 NaN。理论上正则已经保证是数字了
// （`\\d+`），但防御性检查在这里是必要的——
// 因为如果哪天有人把正则放宽成 `(\\S+)`，NaN 会一路传下去，
// 变成 max_tokens = NaN 发给 API，错误会变得完全不可理解。'''),

(597, 'before', '''// ═══ 快模式被拒绝的识别 ═══
//
// ⚠ 这个函数有一个作者自己标注的 TODO，而且说得很直白：
//
//   "String-matching the error message is fragile and will break
//    if the API wording changes."
//
// 靠字符串 'Fast mode is not enabled' 判断「组织没开快模式」。
// 正确的做法是服务端给一个专用响应头（比如 x-fast-mode-rejected），
// 但那个头还不存在。
//
// 三个「靠文案判断」的地方在这份源码里都很显眼：
//   · 这里（快模式拒绝）
//   · 行 550（上下文溢出，改用正则抠数字）
//   · 行 619（overloaded_error，因为流式时状态码会丢）
// 三个都是同一类妥协：**协议没提供结构化信息时，只能读自然语言。'''
), 

(610, 'before', '''// ═══ is529Error ═══
//
// 注意它有两个判据，第二个（看 message 里有没有 overloaded_error）
// 不是冗余 —— 注释和 719 行都说明了原因：
//
//     SDK 在**流式**响应里有时传不出 529 状态码，status 是空的，
//     只有 body 里的 error type 能认出来。
//
// 这就是为什么 claude.ts 里那么多地方调 is529Error 而不是直接判 status。
// 一个跨层的事实：状态码在流式路径上不可靠。'''),

(623, 'before', '''// ═══ 四家认证错误的识别（623-694）═══
//
// 这段代码存在的唯一理由是：**认证失败时，凭证缓存是脏的**。
// 只重试不清缓存 = 拿着同一个过期 token 再试 10 次，全是 401。
//
// 四家的错误形态完全不同，所以识别逻辑也完全不同：
//
//   第一方 401        APIError.status === 401
//   第一方 403 revoked APIError + message 含 'OAuth token has been revoked'
//   Bedrock           SDK 层的 CredentialsProviderError，或 403
//   Vertex            google-auth-library 的**裸 Error**（没有类型名！），或 401
//
// 下面每一个函数都在做同一件事：把「各家 SDK 五花八门的失败形态」
// 归一成「是不是认证问题」。'''),

(631, 'before', '''// Bedrock 有两种失败形态，注释把区别说清楚了：
//   · .aws 文件里是过期凭证 → AWS SDK **不发请求**就直接拒（CredentialsProviderError）
//   · 发出去之后服务端拒   → 普通 403，message 是
//                             "The security token included in the request is invalid"
//
// 第一种特别坑：它根本不产生网络请求，所以日志里看不到任何 HTTP 痕迹，
// 看起来像「请求凭空消失了」。'''),

(658, 'before', '''// ⚠ 注释点出了 Vertex 比 Bedrock 恶心的地方：
//
//     "google-auth-library throws plain Error (no typed name like AWS's
//      CredentialsProviderError)"
//
// AWS 至少给了一个带名字的错误类型可以 instanceof。Google 的库
// 直接 throw new Error('Could not load the default credentials')，
// 和其他任何普通错误无法区分 —— 只能匹配消息文案。
//
// 三个特征串覆盖三种常见失败：
//   Could not load the default credentials   没配凭证
//   Could not refresh access token           刷新失败
//   invalid_grant                            refresh token 被吊销'''),

(696, 'before', '''// ═══════════════════════════════════════════════════════════════
// shouldRetry —— 「这个错误值不值得再试一次」
//
// 这是全文件最该先读的函数：它定义了「可重试」的边界，主循环只是执行者。
//
// 决策树的顺序**不可调整**，因为后面的判据会被前面的否决。按优先级：
//
//   1. 测试用假错误             → 永不重试（否则 /mock-limits 停不下来）
//   2. persistent + 429/529     → 一律重试（绕过一切门禁，含服务端 header）
//   3. CCR 远程 + 401/403       → 重试（架构保证 key 是好的，只是抖动）
//   4. message 含 overloaded    → 重试（流式丢状态码的兜底）
//   5. 可修的上下文溢出 400      → 重试（参数会改）
//   6. x-should-retry: true     → 重试，但订阅用户除外（他们的 true 意味着「几小时后」）
//   7. x-should-retry: false    → 不重试，唯一例外是 ant + 5xx
//   8. 连接错误（无状态码）      → 重试
//   9. 具体状态码：408 / 409 / 429 / 401 / 403revoked / 5xx
//  10. 其余                     → 不重试
//
// 为什么 6、7 必须排在 9 之前：服务端的显式指令优先于我们对状态码的猜测。
// 一个 500 配 x-should-retry: false，说明服务端知道重试没用（是确定性 bug）。'''),

(697, 'before', '''// 第一条就是测试专用：/mock-limits 造的假 429 必须**立刻**失败，
// 否则测试会被自己的重试逻辑拖住，永远测不完。'''),

(702, 'before', '''// persistent 模式的「超级通行证」：连服务端的 x-should-retry 都不看。
// 理由是场景不同 —— 无人值守任务的目标是「最终跑完」，
// 服务端说「别重试」通常是对交互式会话的建议。
// 注意它仍然只对 429/529 生效，其他错误照常走下面的判断。'''),

(708, 'before', '''// ⚠ CCR（远程容器）模式下的 401/403 语义完全不同，这段注释值得逐字读：
//
//     "auth is via infrastructure-provided JWTs, so a 401/403 is a
//      transient blip (auth service flap, network hiccup) rather than
//      bad credentials."
//
// 关键那半句："the server assumes we'd retry the same bad key,
// but our key is fine" —— 服务端认为「你都 401 了还重试同一个坏 key，
// 没意义」，所以发 x-should-retry: false；但我们的 key 是基础设施注入的，
// 坏不了，所以那个 false 是**基于错误前提**的建议，可以无视。
//
// 这是一个「同一个状态码在不同部署形态下含义不同」的典型例子。'''),

(719, 'before', '''// overloaded_error 的文本匹配放在状态码判断**之前**，
// 因为流式情况下 status 是空的（见 610 行注释）——
// 只靠状态码会漏掉最常见的那种过载。'''),

(726, 'before', '''// 能修的 400 才是可重试的 400。判据就是那个正则能不能解析出三个数字。
// 其他 400（参数错、格式错）重试一万次也一样。'''),

(731, 'before', '''// ═══ 服务端的显式指令 ═══
//
// x-should-retry 不是标准头（注释也说了 "not a standard header"），
// 是 Anthropic API 自己加的。
//
// true 的处理里那个例外非常微妙，值得单独记：
//
//     "For Max and Pro users, should-retry is true, but in several hours,
//      so we shouldn't."
//
// 订阅用户的 429 是**配额窗口**（几小时）造成的，服务端说「可以重试」
// 在法律上正确，但在实践上意味着「几小时后再来」。本地重试毫无意义。
// 而企业用户是 PAYG 计费，429 只是瞬时速率限制，重试有意义。
//
// 「同一个 header 值，对不同付费形态的用户含义不同」—— 这个信息
// header 里没有，只能靠 isClaudeAISubscriber() / isEnterpriseSubscriber() 补。'''),

(744, 'before', '''// false 的处理唯一例外：ant 内部 + 5xx。
// 理由大概是「5xx 是我们自己的服务出错，值得再试一次」，
// 而 401/400/429 这些 false 是可信的。'''),

(753, 'before', '''// APIConnectionError 通常**没有 status**（连接都没建立起来）。
// 所以它必须排在 `if (!error.status) return false` 之前 ——
// 否则所有网络错误都会被判成不可重试，这是最容易写错的地方。'''),

(757, 'before', '''// 到这里还没有状态码 = 不是 HTTP 层的错误，也没有被上面任何规则接住。
// 保守选择：不重试。'''),

(759, 'before', '''// 408 请求超时、409 锁冲突 —— 这两个是「等一下再来真的会好」的经典状态码。'''),

(765, 'before', '''// 429 对订阅用户不重试，和 737 行是同一个逻辑的另一半：
// 订阅者的限流是配额窗口，不是速率限制。企业用户（PAYG）才重试。
// 注意这里用的是同一个表达式 `!isClaudeAISubscriber() || isEnterpriseSubscriber()`，
// 说明这个「谁能重试 429」的判据在两处必须保持一致。'''),

(771, 'before', '''// 401 的处理有副作用：清掉 apiKeyHelper 的缓存。
// 因为 apiKeyHelper 是一个「外部命令取 key」的机制（比如从密钥管理器读），
// 它缓存了结果；401 说明缓存的那个 key 已经失效，必须清掉重取。
//
// 注意注释的边界说明：OAuth 的刷新不在这里做，
// 而是在主循环里（行 240）—— 因为刷新是异步的，而 shouldRetry 是同步纯判断。
// 「纯判断函数不产生异步副作用」这条边界守得很干净。'''),

(783, 'before', '''// 5xx 一律重试。这是最后一条，也是兜底最宽的一条。
// 注意它用 `error.status && error.status >= 500` 而不是直接 `>= 500`，
// 因为 status 可能是 undefined（TS 也要求先判）。'''),

(789, 'before', '''// ═══ 次数配置 ═══
//
// 两层：调用方显式传 > 环境变量 > 默认 10。
// getMaxRetries 用 `??` 而不是 `||`，因为 **0 是合法值** ——
// claude.ts 就传 0（它自己管重试，不想 SDK 再来一层）。'''),

(799, 'before', '''// 快模式冷却的三个时间常量，配合行 284 的逻辑看：
//
//   DEFAULT_FAST_MODE_FALLBACK_HOLD_MS = 30min  服务端没说多久时，冷却 30 分钟
//   SHORT_RETRY_THRESHOLD_MS = 20s              小于这个就原地等，不切档
//   MIN_COOLDOWN_MS = 10min                     切档后至少 10 分钟不切回来
//
// 三个数字合起来是一条「防抖曲线」：短等待忍着，长等待切档，切了就稳住。'''),

(803, 'before', '''// 这两个函数是「从错误里读出时间信息」的两种来源：
//   getRetryAfterMs        读 retry-after（相对秒数）
//   getRateLimitResetDelayMs 读配额重置时间戳（绝对 unix 秒）
//
// 后者只用于 persistent + 429 分支（行 437），因为只有配额窗口类
// 限流才会带那个头。它自己也算了一次 Math.min(delayMs, PERSISTENT_RESET_CAP_MS)，
// 和调用方的 cap 重复了 —— 双重保险，不算问题但可以记一笔。'''),

(814, 'before', '''// 三个细节：
//   1. `headers?.get?.()` 的双问号 —— 和 519 行同一个原因（两种 headers 形态）
//   2. `Number.isFinite` 而不是 isNaN —— 同时挡掉 Infinity
//   3. `delayMs <= 0` 返回 null —— 已经过了重置时间，别返回负数给 sleep
//
// 返回 null 的语义是「这个 header 没用，走指数退避吧」，不是「无限等」。'''),
]
