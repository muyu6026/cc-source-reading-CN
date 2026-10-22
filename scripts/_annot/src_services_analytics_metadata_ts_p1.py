ANNOTATIONS = [
    (1, 'before', '''【第 1-35 行】`metadata.ts` 是整个遥测子系统的**字段单一事实来源**：所有后端（Datadog / 1P）
    共用的事件元数据，都在这里收集、整形、格式化。第 1 行 `biome-ignore-all` 注释是重点——
    因为下面有几处 `ANT-ONLY import markers` 必须保持特定顺序（ant 构建独有的 import），
    biome 的自动整理 import 会破坏它。→ 有时「看起来乱、但乱是有意的」代码，注释会告诉你别动。'''),

    (44, 'after', '''【第 44-57 行】又是 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 这个 `never` 标记类型。
    这里把它的设计意图讲得最透：**类型本身就是 `never`，永远不能真正持有值**，只用作类型转换
    来「记录开发者的意图」。它把「这个 string 里没有代码/路径」这件事变成了一个**编译期可检查的声明**，
    而不是靠 code review 人肉把关。整个 `analytics/` 反复出现，是这个子系统最重要的「命名即 lint」约定。'''),

    (59, 'after', '''【第 59-77 行】`sanitizeToolNameForAnalytics` 把 MCP 工具名（`mcp__server__tool`）压成 `'mcp_tool'`，
    但**保留**内置工具名（Bash / Read / Write 等）。注释说 MCP 名是 **PII-medium**：
    因为 `server` 部分可能暴露「用户自己的 MCP 配置」（比如 `mcp__my-internal-company-tool`）。
    → 同样是工具名，内置的是安全的、用户配置的是敏感的，脱敏口径要分。'''),

    (90, 'after', '''【第 90-116 行】`isAnalyticsToolDetailsLoggingEnabled` 决定「**在什么情况下才允许记真实的 MCP 名**」，
    给出了三个例外（都对应「这里没有用户特定泄露风险」）：
    - Cowork 入口（`local-agent`）：没有 ZDR 概念，全记
    - claude.ai 代理的连接器：永远来自 claude.ai 官方列表，不是用户配的
    - URL 命中官方 MCP registry 的目录连接器（`claude mcp add` 加的，不是客户定制配置）
    自定义 / 用户配置的 MCP 一律走脱敏。这是「**默认脱敏、按需放开**」的最小权限思路。'''),

    (118, 'after', '''【第 118-138 行】`BUILTIN_MCP_SERVER_NAMES` 是个**按 feature flag 门控 + 按需 require** 的集合：
    只有 `feature('CHICAGO_MCP')` 开启时，才 `require(...).COMPUTER_USE_MCP_SERVER_NAME` 把一个保留名加进来。
    注释解释为什么这么绕：这个保留名本身也是 feature-gated 的，所以在没开这个 feature 的构建里，
    用户**可能**配置出一个同名 `computer-use`—— 必须和上面那个「URL/transport 门控」叠加判断，
    stdio 型内置否则会漏过。门控 + require（而不是顶层静态 import）是为了**推迟 129KB 的加载**（只有需要时才读）。'''),

    (176, 'after', '''【第 176-206 行】`extractMcpToolDetails` 用 `split('__')` 拆 MCP 名。
    注意第 194 行 `parts.slice(2).join('__')`：因为工具名**本身可能含 `__`**（比如 `mcp__slack__read__channel`），
    所以不能简单取 `parts[2]`，要把第 3 个及以后的段重新拼回。这是个容易被 `parts[2]` 写错的地方，注释补了说明。'''),

    (236, 'after', '''【第 236-283 行】`truncateToolInputValue` 对工具输入做**递归截断**：字符串超 512 截断到 128 + 标原长，
    数组最多 20 项、对象最多 20 键、嵌套深度最多 2 层（第 239-240 行）。
    第 272-273 行有个取证考量：过滤掉下划线开头的内部标记键（如 `_simulatedSedEdit`），
    **不让它们漏进遥测**。截断的取舍是「保留有取证价值的字段（路径、URL、MCP 参数），但把体积压住」。'''),

    (305, 'after', '''【第 305-337 行】`getFileExtensionForAnalytics` 用 `path.extname` 取扩展名，但**超过 10 个字符的扩展名
    一律记成 `'other'`**（第 311 行 `MAX_FILE_EXTENSION_LENGTH`）。
    为什么？因为像 `key-hash-abcd-123-456` 这种「伪扩展名」（其实是哈希文件名）会暴露敏感信息，
    且基数爆炸。和前面 `datadog.ts` 的「模型名超集归 'other'」是同一种防御：**把高基数 / 可能敏感的值压成常量**。'''),

    (339, 'after', '''【第 339-364 行】`getFileExtensionsFromBashCommand` 是 best-effort 的 Bash 命令扩展名提取：
    只在 `FILE_COMMANDS`（rm/mv/cp/cat/grep/rg/sed 等 18 个）的白名单里才扫参数（第 340-358 行），
    且跳过以 `-` 开头的 flag（第 401 行 `charCodeAt(0) === 45`）。注释解释为什么不做重型 shell 解析：
    grep 的正则、sed 的脚本几乎不会被误判成文件路径，所以轻量启发式足够。→ 「够用就好」比「完美解析」更划算。'''),

    (510, 'after', '''【第 510-561 行】`getAgentIdentification` 的**优先级链**写得很清楚（也是注释明说的）：
    AsyncLocalStorage 上下文（同进程里的 subagent）> 环境变量（swarm teammates）> bootstrap state（plan→impl 的 parent session）。
    第 539-544 行对「standalone agent」的判定：有 agentId 但不是 teammate，才算 standalone。
    这种「多来源、按可信度排序、逐级回退」是配置/身份解析的常见模式。'''),

    (563, 'after', '''【第 563-569 行】`getVersionBase` 用 `memoize` 把 `MACRO.VERSION` 里的前三段（`2.0.36-dev`）抽出来缓存。
    正则 `^\\d+\\.\\d+\\.\\d+(?:-[a-z]+)?` 既吃正式版也吃 dev 版。memoize 在这里是「解析结果只算一次」。'''),

    (571, 'after', '''【第 571-638 行】`buildEnvContext` 是 `memoize(async ...)`，一次性收集平台/架构/包管理器/CI/distro/vcs 等。
    第 584-587 行有个细微但重要的点：`platformRaw` 用**原始** `process.platform`（freebsd/openbsd 等），
    而 `platform` 用 `getHostPlatformForAnalytics()`（把那些归并成 'linux'）—— 同一个事实，两个字段，
    一个给你真相、一个给你可聚合的桶。`versionBase` 故意**不**进这个 memoized env（第 732 行注释解释：
    `setKairosActive()` 在 main.tsx 首次事件之后才跑，env 已经被缓存，所以 kairosActive 要每次事件现读）。'''),

    (640, 'after', '''【第 640-682 行】CPU% 的**增量追踪**用两个模块级变量（`prevCpuUsage` / `prevWallTimeMs`），
    注释说「inherently process-global，和 datadog.ts 的 logBatch/flushTimer 同一种模式」。
    第 654-662 行：CPU 百分比 = 两次采样的 user+system 微秒差 / 墙钟毫秒差 / 1000 * 100。
    这种「差值」算法必须保住上一次的状态，所以放在模块级、不能进 memoized 函数。
    `buildProcessMetrics` 整个包在 try 里，失败返回 undefined（metrics 丢了不影响主流程）。'''),

    (693, 'before', '''【第 693-743 行】`getEventMetadata` 是**所有**遥测事件共用的核心收集函数，返回 `EventMetadata`。
    它 `Promise.all` 并行取 `buildEnvContext`（memoized）和 `getRepoRemoteHash`，再取 process metrics。
    第 725-739 行把 agent 身份、`subscriptionType`、`kairosActive`、`rh`（仓库远程 URL 哈希）等按需展开——
    注意 `kairosActive` 走 `feature('KAIROS') && getKairosActive()`（现读），印证了上面第 584 行说的「不进 memoized env」。'''),

    (746, 'after', '''【第 746-784 行】两套 1P 格式类型：`FirstPartyEventLoggingCoreMetadata`（snake_case 的核心字段）
    和 `FirstPartyEventLoggingMetadata`（env + process + auth + core + additional 的完整包）。
    第 774-776 行注释：**`account_id` 故意省略**，只客户端填 UUID 字段（account_uuid / organization_uuid）——
    这是数据最小化：客户端不该自己宣称 account_id（那是服务端权威字段），只给它能确定的 UUID。'''),

    (796, 'before', '''【第 796-973 行】`to1PEventFormat` 把 camelCase 的 `EventMetadata` 翻成 snake_case 给 BigQuery。
    这是整个文件里**注释最重**的一段，因为它踩过的坑最多：
    - 第 811-819 行：`env` 用** proto 生成的类型** `EnvironmentMetadata`，而不是手写并行类型——
      因为手写的版本曾让 #11318 / #13924 / #19448 / coworker_type **这四批字段悄悄没进 BQ**
      （生成代码的 `toJSON()` 会静默丢未知键，手写类型不会在编译期报错）。所以「加字段必须先改 monorepo proto，
      再 `bun run generate:proto`」是硬约束。
    - 第 935-948 行：从 `userMetadata` 取 `githubActionsMetadata` 和 `auth`，同样映射到 proto 类型。
    - 第 958-972 行：`process` 字段把 process metrics **base64(JSON)** 后塞进去（体积大，所以编码），
      `additional` 收 `rh` / `kairosActive` / `skillMode` / `observerMode` 等「差异字段」。
    → 这段是「**类型系统能查的，绝不靠人记**」的最佳范例：用 proto 生成类型把「漏字段」从运行时 bug 变成编译错误。'''),
]
