ANNOTATIONS = [
    (1, 'before', '''【第 1-77 行】`growthbook.ts` 是遥测子系统的**引擎**：它封装了 GrowthBook（一个远程开关 / A-B 实验 SDK），
    并给全代码库提供「读一个开关值 / 读一个动态配置」的统一入口。几乎所有其他模块拿到的「要不要开某功能」
    最终都追溯到这里的 `getFeatureValue_CACHED_MAY_BE_STALE`。
    它和 `firstPartyEventLogger.ts` 互相引用（实验曝光要记入 1P），但靠「谁 import 谁」的单向依赖避免循环。'''),

    (49, 'after', '''【第 49-57 行】`MalformedFeatureDefinition` 这个类型本身就是一段**事故记录**：
    API 返回的是 `{ value }` 而不是 SDK 期望的 `{ defaultValue }`，这是后端还没修的 bug，客户端先 workaround。
    第 330-376 行的 `processRemoteEvalPayload` 会把这个 `value` 搬到 `defaultValue` 上。
    → 当上游契约和 SDK 预期对不上时，客户端用一个类型 + 一段转换来兜底，并在注释里标注「TODO 修好 API 就删」。'''),

    (69, 'after', '''【第 69-90 行】四张内存 Map / Set，是这个模块的「状态中枢」，各自管一件事：
    - `experimentDataByFeature`：从 payload 里挖出的实验数据，供曝光上报用
    - `remoteEvalFeatureValues`：**绕过 SDK bug 的自家缓存**（SDK 不尊重 remoteEval 的预求值，见第 378 行）
    - `pendingExposures` / `loggedExposures`：实验曝光「先记待发、再按 session 去重」的两阶段
    第 88-89 行注释点出 `loggedExposures` 的存在理由：避免 `getFeatureValue_CACHED_MAY_BE_STALE`
    在热路径（如 render 循环里的 `isAutoMemoryEnabled`）被反复调用时，刷出重复的曝光事件。'''),

    (91, 'after', '''【第 91-123 行】两个「控制流协调」原语：
    - `reinitializingPromise`（第 94 行）：安全门检查时要**等这次重初始化完成**，避免在 auth 切换的间隙
      拿到过期值（见第 851 行的 `checkSecurityRestrictionGate`）
    - `refreshed` signal（第 107 行）：订阅者通知。注释强调它**不被 `resetGrowthBook` 清理**——
      订阅者通常在 `init.ts` 注册一次、要跨 auth-change 重置存活。
    - `callSafe`（第 110 行）：用 `Promise.resolve(listener()).catch(...)` 把「同步 throw」和「异步 reject」
      **都**导向 `logError`—— 否则异步 listener 的 reject 会变成 unhandled rejection（try/catch 只看到 Promise 本身）。'''),

    (125, 'after', '''【第 125-157 行】`onGrowthBookRefresh` 的**追赶 microtask**（第 144-152 行）是修一个真实竞态：
    外部构建上网络快、MCP 配置重时，GB 的网络响应可能在 REPL 的 `useEffect` 提交前就回来了（~100ms vs ~600ms）。
    如果订阅者还没注册，就错过这次通知。所以「若 Map 已填充，下一个 microtask 补发一次」。
    第 154-156 行的 unsubscribe 还要在 microtask 里再查一次 `subscribed`，因为注册和 microtask 之间可能已被取消。'''),

    (327, 'before', '''【第 327-394 行】`processRemoteEvalPayload` 是整个模块**最危险也最精巧**的一段。
    第 334-340 行有一个防黑屏的判据：`{}` 是**真值**—— 如果少了 `features` 长度检查，
    服务器一次截断的畸形响应（空的 `{features:{}}`）会清空 Map、返回 true、然后 `syncRemoteEvalToDisk`
    把 `{}` **整盘写盘**，导致所有共享 `~/.claude.json` 的进程**所有开关集体黑屏**。
    第 342-371 行：先 `clear` 再重建（让被删的 feature 不会留下 stale 幽灵条目），同时把 `value`→`defaultValue` 修正、
    顺手挖出实验数据。第 382-392 行：把预求值**自己缓存**进 `remoteEvalFeatureValues`（因为 SDK 不尊重 remoteEval）。'''),

    (396, 'after', '''【第 396-417 行】`syncRemoteEvalToDisk` 有两条硬约束，注释写得很重：
    1. **只在成功 payload 路径调用，失败路径永不调用** —— 所以「初始化超时投毒」在结构上不可能发生
       （init 的 `.catch()` 永远到不了这里）
    2. **整盘替换，不合并** —— 服务器删掉的 feature 会在下次成功时从磁盘消失；且 ant 构建 ⊇ 外部构建，
       换构建写盘也安全（总是这个 SDK key 的完整答案）
    第 410-412 行：和当前磁盘值 `isEqual` 相同就直接 return，避免无意义的写盘（「没变化就不写」）。'''),

    (419, 'after', '''【第 419-449 行】`isGrowthBookEnabled()` 只有一行：`return is1PEventLoggingEnabled()`——
    GrowthBook **依赖** 1P 事件日志（因为实验曝光要记到 1P）。这是一个隐式的依赖关系：
    关掉遥测，开关系统也随之失效（退化为默认值），用户感知到的是「所有实验/开关都回到默认」。
    `getApiBaseUrlHost`（第 439 行）处理企业代理部署（Epic / Marble 等）：这些通常走 apiKeyHelper auth，
    导致 `organizationUUID/accountUUID/email` 都缺失，**没有稳定 attribute 可定向**—— 只能靠每设备 ID。
    所以这里只取 host（无 path/query/cred），给这类部署一个可定向的锚点。'''),

    (487, 'after', '''【第 487-617 行】`getGrowthBookClient` 是 `memoize` 的客户端工厂，几个要点：
    - 第 514-521 行：信任未建立时**不传 auth**（避免信任弹窗前执行 apiKeyHelper），并记 `clientCreatedWithAuth`
    - 第 524-546 行：把 `client` 捕获进局部变量 `thisClient`，因为 init 是异步的——
      如果重初始化在 init 完成前发生，回调里必须判断 `client !== thisClient`（第 558、578 行）才能跳过处理旧客户端
    - 第 609-613 行：beforeExit / exit 处理器用**命名引用**注册，这样 `resetGrowthBook` 能精确移除、防止累积
    → 「异步初始化 + 可能重初始化」场景下，用闭包捕获 + 身份比对来避免处理一个已被替换的客户端，是这里的精髓。'''),

    (622, 'after', '''【第 622-664 行】`initializeGrowthBook` 是 `memoize(async)`，**会阻塞等 init**。
    第 632-654 行处理一个时序问题：如果客户端创建时还没有 auth，等 auth 可用后再调本函数时，
    会 `resetGrowthBook()` 重建（因为 `apiHostRequestHeaders` 创建后**不能改**），避免「旧客户端 init 还在跑、
    新客户端又起一个」的双 init。第 660 行在成功后建周期刷新—— 放在这里（而不是别处）保证任何重init后都重建刷新。'''),

    (726, 'before', '''【第 726-775 行】`getFeatureValue_CACHED_MAY_BE_STALE` 是**启动关键路径和同步上下文的首选**读法。
    它**不阻塞**：先查 env override、再查 config override、再查内存 `remoteEvalFeatureValues`、最后回退磁盘缓存。
    第 752-757 行：实验曝光「有数据就记、没有就加到 pendingExposures 待发」—— 因为此时可能还没 init 完。
    注释点出内存 payload 一旦 `processRemoteEvalPayload` 跑过就是权威的，和磁盘等价、但跳过 JSON 解析更快。'''),

    (804, 'before', '''【第 804-837 行】`checkStatsigFeatureGate_CACHED_MAY_BE_STALE` 是**迁移期专用**：把老的 Statsig gate
    搬到 GrowthBook 时，先查 GB 磁盘缓存，没有再回退 `cachedStatsigGates`。
    注释明确它是 `@deprecated`、新代码不该用。这段揭示了一段**真实的迁移史**：Claude Code 曾经用 Statsig，
    现在迁到 GrowthBook，过渡期两套缓存都得认，直到老 Statsig 彻底退役。'''),

    (851, 'before', '''【第 851-889 行】`checkSecurityRestrictionGate` 是**安全关键**的读法：如果 `reinitializingPromise` 在跑
    （auth 刚变），先 `await` 它完成，确保拿到 auth 切换后的**新鲜值**。
    第 874-885 行：先查 Statsig 缓存、再查 GB 缓存—— 注释说「Statsig 优先是安全措施」：
    如果上次登录 session 的 Statsig 缓存说 gate 开着，就**尊重它**（双重保险，宁可多放不可错关安全限制）。'''),

    (904, 'before', '''【第 904-935 行】`checkGate_CACHED_OR_BLOCKING` 是「**快速路径 / 慢速路径**」语义的范本：
    - 磁盘缓存已是 `true` → 立即返回 true（信任缓存，因为服务端才是真正守门人）
    - 磁盘是 `false` / 缺失 → 可能过期，才 `await` 取服务端新鲜值
    注释解释为什么 `true` 可以信、`false` 不能信：对一个「按订阅/org 门控的用户功能」来说，
    **过期的 false 会不公平地拦住用户**，过期的 true 只是让本该被拦的提前用一下（服务端会再拦）。
    这是「stale-while-false-blocking」—— 只对失败方向做阻塞补偿。'''),

    (937, 'before', '''【第 937-982 行】`refreshGrowthBookAfterAuthChange` 必须在 auth 变化（登录/登出）时**销毁并重建**客户端：
    因为 GrowthBook 的 `apiHostRequestHeaders` 创建后不能改。第 953-959 行的细节很关键：
    `resetGrowthBook` 清空了 `remoteEvalFeatureValues`，如果后续重建超时或登出短路，init-callback 的通知永远不触发，
    订阅者会卡在「上一个账号的缓存状态」—— 所以这里**手动再 emit 一次**，至少让它们同步到重置后的状态。
    第 963-975 行：`.catch` 要写在 `.finally` **之前**，否则 `initializeGrowthBook` 的同步 helper 抛错会
    被 `.finally` 重新 settle 成原始 rejection，而外层同步 try/catch 抓不到异步 reject。'''),

    (1012, 'after', '''【第 1012-1024 行】周期刷新间隔：外部构建 **6 小时**、ant **20 分钟**。
    注释说「匹配 Statsig 的 6 小时间隔」—— 又是和迁移前的旧 SDK 对齐。`refreshInterval.unref?.()`（第 1101 行）
    让这个定时器**不阻止进程正常退出**：长驻会话才需要它，临时 `claude -p` 不该因为它赖着不走。'''),

    (1132, 'after', '''【第 1132-1155 行】文件末尾是一组「动态配置」语义封装：
    `getDynamicConfig_BLOCKS_ON_INIT` 就是 `getFeatureValue_DEPRECATED` 的别名（Statsig API 兼容性），
    `getDynamicConfig_CACHED_MAY_BE_STALE` 就是 `getFeatureValue_CACHED_MAY_BE_STALE` 的别名。
    注释说「在 GrowthBook 里，动态配置只是带对象值的 feature」—— 这些 wrapper 纯粹是为了让调用方代码
    读起来像 Statsig（平滑迁移），**没有额外逻辑**。整个文件反复出现 `@deprecated` 标记，都在记录这场迁移。'''),
]
