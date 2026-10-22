ANNOTATIONS = [
    (14, 'after',
     "文件头四句话定调：\n"
     "1) 服务对象是企业客户——Console 用户（API key）全部 eligible；OAuth 用户只有 Enterprise/C4E 和 Team eligible；\n"
     "2) **fail open**：拉取失败就当成没有远程设置继续跑，绝不阻塞启动。整个文件所有 catch 分支都在实践这条；\n"
     "3) 没有托管设置的用户，API 返回空而不是报错；\n"
     "4) 用 checksum 做 HTTP 缓存验证，把网络流量压到最低。"),

    (54, 'after',
     "三个常量：10 秒拉取超时（设置拉取挡启动路，不能长）、5 次重试、1 小时后台轮询。\n"
     "轮询 1 小时是为了让管理员改的设置在一小时内生效——不用重登。"),

    (66, 'after',
     "loading promise 的 30 秒兜底超时。为什么需要：loadRemoteManagedSettings() 在 main.tsx 路径里一定会被调用，\n"
     "但 Agent SDK 测试等场景不走 main.tsx——没有它，await 这个 promise 的系统会永久挂起。\n"
     "30 秒是「正常拉取（含重试）最坏耗时」之上留的余量。"),

    (99, 'after',
     "initializeRemoteManagedSettingsLoadingPromise 在 init.ts 早期调用，让别的系统能在 loadRemoteManagedSettings()\n"
     "还没跑时就先 await 上。只有 eligible 用户才建 promise——不 eligible 的系统本来也不该等。\n"
     "注意 promise 构造器里那个 setTimeout：它保证即使 load 永远不来，等待方最多等 30 秒。"),

    (107, 'after',
     "端点拼在 OAuth config 的 BASE_API_URL 后面——跟着登录环境（生产/ staging）走，不写死。"),

    (124, 'after',
     "sortKeysDeep 存在的唯一理由：服务端用 Python 的 json.dumps(sort_keys=True) 算校验和。\n"
     "JS 对象键序不保证，不递归排序的话同一份设置每次 stringify 出的字节序可能不同，checksum 就会漂。\n"
     "数组元素顺序不动（服务端也不动）。"),

    (137, 'after',
     "checksum 必须和服务端逐字节一致：json.dumps(settings, sort_keys=True, separators=(\",\", \":\"))——\n"
     "注意分隔符后无空格（jsonStringify 默认就是这样，但这是硬约束，写进注释防手滑）。\n"
     "格式是 sha256: 前缀 + hex。导出成公开函数就是为了让测试能验证和服务端的兼容性。"),

    (159, 'after',
     "waitForRemoteManagedSettingsToLoad 是给「启动时要读设置的系统」用的闸门：\n"
     "不 eligible / 已加载完 / 从未启动加载，三种情况都立即返回，不会挂。"),

    (203, 'after',
     "取 auth 头有三处刻意的设计：\n"
     "1) **先 API key 后 OAuth**——Console 用户走 key，Claude.ai 用户回退 Bearer；\n"
     "2) skipRetrievingKeyFromApiKeyHelper：apiKeyHelper 会调用户自己的脚本，而那个脚本可能要读 settings——\n"
     "   在设置加载链路里触发它就是循环依赖，所以这里明确跳过；\n"
     "3) try-catch 包住 key 获取：CI/测试环境没有 key 时 getAnthropicApiKeyWithSource 会抛，\n"
     "   但这里抛出不应该是致命错误，继续试 OAuth 就行。\n"
     "拿不到任何凭据时不抛异常，返回 error 字段让调用方决定（调用方会标 skipRetry）。"),

    (242, 'after',
     "fetchWithRetry 的结构：attempt 从 1 到 6（DEFAULT_MAX_RETRIES=5 次重试 + 首次共 6 次尝试）。\n"
     "两条提前退出：成功立即返回；skipRetry（auth 类错误）不重试——key 没权限，重试 6 次只是浪费时间。\n"
     "退避用 getRetryDelay(attempt)，和 api/withRetry.ts 同一套，保证全项目重试节奏一致。\n"
     "最后的 return lastResult! 逻辑上不可达（循环里每个分支都 return 了），是 TS 穷尽性检查的通行税。"),

    (295, 'after',
     "304 Not Modified 的处理：settings 返回 null 当作「缓存仍有效」的信号（不是「没有设置」）。\n"
     "调用方靠 null 和非 null 区分这两件事——这个约定写在 types.ts 的 RemoteManagedSettingsFetchResult 注释里。"),

    (306, 'after',
     "204/404 返回空对象 {} 而不是 null，这是个容易搞反的点：返回 null 会让调用方以为「该用缓存」，\n"
     "而 204/404 的真实语义是「服务端确认没有设置」——此时应该清掉本地旧缓存，而不是继续用它。\n"
     "用 {} 把「无设置」和「缓存有效」区分开。"),

    (319, 'after',
     "第一层 Zod 校验：响应信封（uuid + checksum + settings）。用的是 types.ts 里那个宽松的 record schema——\n"
     "那里解释了为什么不用 SettingsSchema（循环依赖）。"),

    (331, 'after',
     "第二层校验：信封通过了不算完，settings 本体还要过完整的 SettingsSchema。\n"
     "两层分开是有意的——信封 schema 必须宽松（避免循环依赖），严格校验留到能安全 import SettingsSchema 的这里做。"),

    (360, 'after',
     "catch 里的错误分类：\n"
     "- status 404 → 当成 success + 空设置（「没有配置」不是错误）；\n"
     "- auth（401/403）→ 带 skipRetry，重试无意义；\n"
     "- timeout / network → 可重试的瞬时故障；\n"
     "- default → 原样带出 message。\n"
     "classifyAxiosError 把 axios 的异常归一成 kind/status/message 三件套，避免到处手撕 error.response?.status。"),

    (386, 'after',
     "saveSettings 三个细节：\n"
     "1) 0o600 打开——远程设置可能含敏感策略（权限、环境变量），不给同机其他用户读；\n"
     "2) datasync() 强制落盘再返回——设置是启动路径上的数据，不能停在 OS 缓冲区里；\n"
     "3) 写失败只 log 不抛：磁盘写不进去不影响本次运行，下次启动会重新拉。"),

    (408, 'after',
     "clearRemoteManagedSettingsCache 清四样：停轮询、清 session 缓存、清 loading promise 状态、删磁盘文件。\n"
     "unlink 的 ENOENT 是预期内（文件本来就不存在），吞掉。\n"
     "登录/登出时 refreshRemoteManagedSettings 会先调它——不清干净的话前一个账号的远程设置会漏给下一个账号。"),

    (426, 'after',
     "读文件缓存，并在本地重算它的 checksum——不信任磁盘上存的任何 checksum 字段，现算现用。\n"
     "这个本地 checksum 就是下面 If-None-Match 的值：服务器说 304 就等于确认「你缓存的和服务器上的一致」。"),

    (443, 'after',
     "fetch 失败时的降级链：有磁盘缓存 → 用 stale 缓存继续（graceful degradation）；\n"
     "没有缓存 → fail open 返回 null，当没有远程设置。\n"
     "「用过期的设置」比「起不来」好——这是文件头 fail open 原则的落地。"),

    (474, 'after',
     "新设置应用前的最后一道人工闸门：checkManagedSettingsSecurity（securityCheck.tsx）。\n"
     "用户拒绝就用回缓存的旧设置——远程推送的危险设置不会静默生效。\n"
     "通过才 setSessionCache + saveSettings 双写（内存 + 磁盘）。"),

    (503, 'after',
     "空设置（服务端 404）的分支：setSessionCache({}) 之后删掉磁盘缓存文件。\n"
     "这一步是防「用户远程设置被管理员撤掉后，本地 stale 文件永远生效」——\n"
     "只清内存不清磁盘的话，下次启动又会把旧设置读回来。ENOENT 之外的错误才 log。"),

    (555, 'after',
     "loadRemoteManagedSettings 是 CLI 初始化入口，两个设计点：\n"
     "1) **cache-first**：磁盘有缓存就立即 apply 并 resolve loading promise，让等待方（print 模式启动路径）\n"
     "   马上解阻塞——省掉约 77ms 的 fetch 等待。fetch 仍然继续跑，notifyChange 也仍然在 fetch 后发一次，\n"
     "   所以「先放行再更新」不会丢变更通知；\n"
     "2) finally 里无条件 resolve：哪怕 fetch 抛异常，等待方也必须被放行（fail open）。"),

    (579, 'after',
     "refreshRemoteManagedSettings 用于登录/登出导致的身份变化：先清缓存（防止上一个身份的设置残留），\n"
     "再重新拉。注意不 eligible 时也发一次 notifyChange('policySettings')——\n"
     "告诉监听方「策略设置现在变成空了」，否则已加载的旧设置不会从各消费点撤掉。"),

    (606, 'after',
     "pollRemoteSettings 的变更检测：拉取前后各 jsonStringify 一次缓存做字符串对比，\n"
     "只有真变了才 notifyChange。避免了「每小时无脑触发全设置重载」的浪费。\n"
     "catch 里什么都不做——后台轮询失败不该以任何方式影响前台。"),

    (628, 'after',
     "startBackgroundPolling 三个细节：\n"
     "1) pollingIntervalId 非 null 早退——重复调用不会叠加多个定时器（load 和 auth 变化都可能触发它）；\n"
     "2) unref()——这个定时器不挡进程退出，用户 Ctrl-C 不用等它；\n"
     "3) registerCleanup 停机时清——和 gracefulShutdown 管线对接。"),

    (638, 'after',
     "stopBackgroundPolling 是 start 的逆操作，clearInterval 后把 id 置回 null（置回 null 才能再次 start）。"),
]
