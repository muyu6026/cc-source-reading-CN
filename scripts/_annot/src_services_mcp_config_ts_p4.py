# -*- coding: utf-8 -*-
"""mcp/config.ts 批注 p4：合并优先级、解析、启停的两种极性。"""

ANNOTATIONS = [
(1216, 'before', '''// 【把去重结果报给 UI 的那段，有个细节：注释强调"在 logError 循环之后"】
//
//   "Pushed AFTER the logError loop above so these don't go to the error log
//    — they're informational, not errors."
//
// 这看起来是个顺序问题，实际上是**消息通道复用**的处理：
// `mcpErrors` 这个数组同时承载两种东西 ——
//   · 真正的错误（会被 `logError` 逐条上报）
//   · 信息性提示（"某插件服务器和手工配置重复，已抑制"）
//
// 如果 push 在 logError 循环之前，这条提示就会被当成错误上报纸质日志。
//
// 【这是个"共享通道 + 时序控制"的脆弱设计】
//
//   用同一个数组装两种语义不同的东西，靠**push 的先后顺序**来区分处理方式。
//   将来任何人往这个数组里加东西，都必须知道"我加在循环前还是后，
//   决定了它是错误还是提示"。
//
//   更稳的做法是分成两个数组（`errors` 和 `notices`），
//   在返回时合流给 UI，但上报时分开处理。
//   这里的写法能工作，但需要注释来兜住 —— 而注释是会被忽略的。
//
// ── `name.split(':')` 那几行的脆弱之处 ──
//
//   `name` 形如 `plugin:插件名:服务器名`，代码用 split 拆出插件名和服务器名，
//   并校验 `parts[0] !== 'plugin' || parts.length < 3` 就跳过。
//
//   但 `parts.slice(2).join(':')` 又把后面几段合回去 ——
//   说明服务器名本身**可以含冒号**。而 `addMcpConfig` 里名字
//   是不许含冒号的（`/[^a-zA-Z0-9_-]/`），但插件里的服务器名
//   可能没走那个校验。
//
//   【这是"用分隔符拼标识符"的经典后果：拼的时候随意，拆的时候要猜。】
//   更稳的做法是用不可打印字符做分隔，或者干脆存成结构化对象。'''),

(1230, 'before', '''// 【合并顺序：这一行注释是整个文件的优先级总表】
//
//     // Merge in order of precedence: plugin < user < project < local
//     const configs = Object.assign(
//       {},
//       dedupedPluginServers,
//       userServers,
//       approvedProjectServers,
//       localServers,
//     )
//
// `Object.assign` 是**后者覆盖前者**，所以从左到右优先级递增：
//   插件 < 用户 < 项目 < 本地
//
// ── 为什么项目（.mcp.json，团队共享）比用户（全局）高 ──
//
//   因为项目是"当前工作的具体上下文"。一个团队约定用某个版本的
//   MCP 服务器，就该项目内应该生效，哪怕用户的全局配置里有个同名但
//   不同参数的服务器。
//
//   这和 git 配置的层次直觉一致：仓库配置 > 全局配置。
//
// ── 为什么本地（local）最高 ──
//
//   local 是"我这个人在这个项目里的私有设置"，比 .mcp.json 更具体。
//   典型场景：团队共享的服务器需要额外加 `--verbose` 调试，
//   我就在 local 里覆盖，不影响别人。
//
// ── 注意 claude.ai 不在这条链里 ──
//
//   它在 `getAllMcpConfigs` 里以**最低**优先级合并
//   （`Object.assign({}, dedupedClaudeAi, claudeCodeServers)`）。
//   因为 claude.ai 连接器是"网页端点了一下启用"，意图强度最低。
//
// ── 一个重要的隐含事实 ──
//
//   覆盖是**按 key（服务器名）** 的，不是按签名。
//   所以如果项目里有个叫 `slack` 的、用户全局也有个叫 `slack` 的，
//   项目的会完全替换用户的 —— 即使它们连的是不同服务。
//   这是配置系统的常规行为，但值得知道：**名字冲突就是覆盖，没有合并**。'''),

(1253, 'before', '''// 【getAllMcpConfigs：慢版本，把 claude.ai 连接器也拉进来】
//
// 这个函数和 `getClaudeCodeMcpConfigs` 的关系：
//   后者 = 本地能算出来的（快，启动路径用）
//   前者 = 后者 + 网页端连接器（慢，需要完整列表时用）
//
// 【这里有一处非常漂亮的并发设计，值得逐行看】
//
//   ① 先"点火"，不 await（1269）：
//        const claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
//
//   ② 把它**作为参数**传给快函数（1270-1273）：
//        const { servers } = await getClaudeCodeMcpConfigs({}, claudeaiPromise)
//
//   ③ 快函数内部在插件加载完之后才 await 它（p3 的 1179 行）
//
//   ④ 这里再 await 一次（1274-1276）：
//        const { allowed } = filterMcpServersByPolicy(await claudeaiPromise)
//
//   注释说："Memoized — the awaited call below is a cache hit."
//   也就是第 ④ 步的 await 不会真的再等一次，promise 已经 resolve 了。
//
// ── 时间线 ──
//
//     t=0    点火 claude.ai 请求
//     t=0    开始 loadAllPluginsCacheOnly()
//     t=0.5s 插件加载完 → await claudeaiPromise → 还在跑，继续等
//     t=2s   claude.ai 回来 → 继续
//     t=2s   完成
//
//   串行写法会是 2.5s。这里省掉了 0.5s。
//
// ── 为什么第 ④ 步还要"再 await 一次同一个 promise" ──
//
//   因为第 ② 步只是在函数内部等待它，**返回值里没有它**。
//   外层要拿连接器列表做去重和合并，所以必须自己再取一次。
//   promise 的"多次 await"是合法的（同一个结果），这里正是靠这个特性。
//
// ── 一个隐含的依赖 ──
//
//   `fetchClaudeAIMcpConfigsIfEligible` 必须是**幂等且 memoize** 的，
//   否则"点火一次、await 两次"会发两次网络请求。
//   注释里明确写了 "Memoized"，说明这是个必须满足的契约 ——
//   但这个契约由被调函数保证，调用方只在注释里记着。'''),

(1262, 'before', '''// 【enterprise 独占时，连 claude.ai 都不拉（1263-1265）】
//
//     if (doesEnterpriseMcpConfigExist()) {
//       return getClaudeCodeMcpConfigs()
//     }
//
// 这里有个"早退时直接复用快函数"的写法 ——
// 因为快函数自己会处理 enterprise 独占逻辑（只返回 enterprise，
// 连插件都不读）。所以这里不需要重复那段逻辑，直接委托。
//
// 【但注意：这条早退还有一个性能目的 —— 不发网络请求】
//
//   如果企业锁定了 MCP，claude.ai 连接器本来就会被完全忽略。
//   此时点火那个 promise 纯粹浪费（一次网络往返 + 服务端负载）。
//   所以判断必须在**点火之前**。
//
//   这就是为什么 `if` 在 `fetchClaudeAIMcpConfigsIfEligible()` 的上面 ——
//   如果写在下面，功能相同，但白白发了一个请求。'''),

(1292, 'before', '''// 【parseMcpConfig：两层校验 + 两类警告】
//
//   ① 整个对象过 `McpJsonConfigSchema()`（1307）
//   ② 逐个子服务器做变量展开，收集缺失变量（1327-1372）
//   ③ Windows 上 npx 缺 cmd 包装 → 警告（1350-1369）
//
// ── 第一层失败是"致命"，第二层是"警告" ──
//
//   看 `severity` 字段：
//     · schema 不通过 → `severity: 'fatal'`，直接返回 `config: null`
//     · 缺环境变量   → `severity: 'warning'`，**服务器仍然保留**（1347 行
//                      `configToCheck = expanded` 之后继续）
//
//   为什么缺变量还能保留？
//   因为变量可能在**运行时**才有（比如由登录后的某个流程设置）。
//   现在报个警告，等真的用的时候如果还没有，连接会失败并给出明确原因。
//
//   如果这里直接判死，用户会陷入"配置加载不上 → 看不到那个服务器 →
//   不知道该设什么变量"的死循环。**警告 + 保留** 让问题可见且可修。
//
// ── Windows npx 检查那三个条件（1354-1356）──
//
//     configToCheck.command === 'npx' ||
//     configToCheck.command.endsWith('\\\\npx') ||
//     configToCheck.command.endsWith('/npx')
//
//   第一个是裸命令，后两个覆盖 `C:\\Program Files\\nodejs\\npx`
//   这种绝对路径（正反斜杠各一种）。
//
//   【为什么一定要警告】因为在 Windows 上，`npx` 是个 `.cmd` 批处理文件，
//   不是可执行文件。Node 的 spawn 不经过 shell 时**找不到 .cmd**，
//   报的错是 `ENOENT` —— 看起来像"命令不存在"，实际是"需要 cmd /c 包装"。
//   这个错误信息对用户几乎没有指向性，所以要在解析期就提示。
//
// ── `validatedServers[name] = configToCheck`（1371）──
//
//   注意它存的是**展开后**的 config（`configToCheck`，可能是 `expanded`），
//   不是原始的 `config`。
//   所以返回值里的配置是"已展开"的形态 —— 下游拿到的 URL/command
//   都是真实值，不需要再展开一次。
//
//   【这意味着 `expandVars: false` 时返回的是原始形态，
//     调用方必须知道这个差异。】四个调用点里，project/user/local/enterprise
//   全都传了 `expandVars: true`，所以实际上总是展开的。'''),

(1379, 'before', '''// 【parseMcpConfigFromFilePath：三种失败，三种处理方式】
//
//   ① ENOENT（文件不存在）       → 返回 `config: null` + 一条"not found"错误
//   ② 其他读错误（权限等）        → 返回 `config: null` + 一条"Failed to read"
//   ③ 不是合法 JSON              → 返回 `config: null` + 一条"not a valid JSON"
//
// 【关键设计：ENOENT 也算"错误"，但调用方会把它过滤掉】
//
//   这是一个**刻意的分层**：
//     · 这一层：如实报告"文件不存在"（它确实是个错误事件）
//     · 调用层：根据自己的场景决定这个错误要不要报给用户
//
//   因为"文件不存在"在不同场景下语义不同：
//     · 当前目录读 .mcp.json → 太正常了，忽略
//     · 企业配置文件 → 不存在意味着"企业没锁定"，更要忽略
//     · 命令行指定的文件 → 不存在是用户的错，必须报
//
//   如果在这一层就把 ENOENT 静默掉，第三种场景就没法报错了。
//   **越底层越该如实，越上层越该有判断。**
//
// ── ③ 那条日志里的 `first100` 是个实用的调试技巧（1442）──
//
//     `first100=${jsonStringify(configContent.slice(0, 100))}`
//
//   解析失败时打印前 100 个字符。为什么不用全部？
//   因为 .mcp.json 里可能有 API key（在 env 或 headers 里）。
//   只打前 100 字符，通常足够看出格式问题（比如开头少了个 `{`），
//   又不太可能把密钥打出来。
//
//   【但这仍然不是安全的 —— 如果文件开头就是 headers 里的 key，
//     前 100 字符也会泄漏。】更稳的做法是只打结构信息（长度、
//     第一个非空白字符、是否以 `{` 开头），不打原始内容。
//
//   `length=${configContent.length}` 也在同一行 —— 长度能帮助判断
//   "文件是空的"还是"读到一半断了"。'''),

(1469, 'before', '''// 【doesEnterpriseMcpConfigExist：一个 memoize，一个重要的隐含假设】
//
//     export const doesEnterpriseMcpConfigExist = memoize((): boolean => {
//       const { config } = parseMcpConfigFromFilePath({ ... })
//       return config !== null
//     })
//
// 这是全文件唯一被 memoize 的函数，而它的返回值决定了整个 MCP 体系
// 走"独占"还是"分层"两条完全不同的路。
//
// ── 为什么必须 memoize ──
//
//   它被调用的次数非常多：`addMcpConfig`、`removeMcpConfig`、
//   `getClaudeCodeMcpConfigs`、`getAllMcpConfigs`、
//   `filterMcpServersByPolicy` 的调用链……
//   每次都是一次文件读取 + JSON 解析。在启动路径上这是不可接受的。
//
// ── memoize 带来的隐含假设 ──
//
//   **企业配置文件在进程生命周期内不会变。**
//
//   这个假设在企业环境里基本成立（文件由 IT 部署，改它要重启应用）。
//   但如果：
//     · 用户在一个长会话里让 IT 部署了新配置 → 本进程看不到
//     · 测试环境里动态创建这个文件 → 测试之间会互相污染
//
//   而且它**没有 cache key**（无参数函数），所以也没有办法手动失效。
//   唯一的办法是重启进程。
//
// ── `config !== null` 这个判据值得注意 ──
//
//   它判断的是"能否成功解析"，不只是"文件是否存在"。
//   所以：
//     · 文件存在但 JSON 格式错了 → `config: null` → 判定为"不存在"
//     · 文件存在但 schema 不通过 → `config: null` → 判定为"不存在"
//
//   【这意味着一个写坏的企业配置文件会让整个企业锁定**静默失效**。】
//   用户会退回"分层模式"，可以自由添加 MCP 服务器 ——
//   而预期的行为应该是"配置坏了 → 更严格，不是更宽松"。
//
//   这是 fail-open（失效即放开）而不是 fail-closed（失效即收紧）。
//   对安全相关的开关，通常应该反过来：解析失败时**假定锁定生效**，
//   并报一个显眼的错误。'''),

(1479, 'before', '''// 【shouldAllowManagedMcpServersOnly：一个字段，三重含义】
//
//   `getSettingsForSource('policySettings')?.allowManagedMcpServersOnly === true`
//
// 三个细节：
//
//   ① 只查 `policySettings`，不查合并后的设置。
//      因为"要不要只信 managed"这件事本身，只能由 managed 决定。
//      如果用户能通过自己的配置开启这个开关，那它就没有意义了
//      （虽然开启它反而更严，但逻辑上说不通）。
//
//   ② `=== true` 而不是 truthy 判断。
//      因为配置来自 JSON，可能是 `"true"`（字符串）或 `1`。
//      严格相等避免"字符串 true 被当成真"这类隐蔽的类型问题。
//
//   ③ 影响范围**只有白名单**（见 `getMcpAllowlistSettings`）。
//      黑名单永远合并 —— 这个非对称在前面 p1 的 336 行批注里详细讲过。
//
// 【这个函数的 JSDoc 最后一句是完整的策略总结】
//
//   "When enabled, allowedMcpServers is read exclusively from managed settings.
//    Users can still add their own MCP servers and deny servers via
//    deniedMcpServers."
//
//   注意"Users can still add their own MCP servers" ——
//   这句话听起来和"只信 managed 白名单"矛盾。
//
//   实际上不矛盾：如果 managed 白名单里**没有** command/url 条目，
//   只看名字条目的情况下，用户新加的服务器如果名字不在白名单里就会被拦。
//   但如果 managed 白名单是**空的或未设置**，就是全放行。
//
//   所以"用户仍能加"成立的条件是"企业没设白名单"。这句话有歧义，
//   但代码逻辑是对的。'''),

(1491, 'before', '''// 【areMcpConfigsAllowedWithEnterpriseMcpConfig：一段写在代码里的临时妥协】
//
//     return Object.values(configs).every(
//       c => c.type === 'sdk' && c.name === 'claude-vscode',
//     )
//
// 函数名叫"在 enterprise 配置下所有这些配置是否被允许"，
// 实现是"每一个都必须是 type=sdk 且 name=claude-vscode"。
//
// ── 上面那段注释就是在解释为什么这么窄 ──
//
//   "While all SDK MCP servers should be safe from a security perspective,
//    we are still discussing what the best way to do this is. In the
//    meantime, we are limiting this to claude-vscode for now to unbreak the
//    VSCode extension for certain enterprise customers who have enterprise
//    MCP config enabled."
//
//   拆开看：
//     · 从安全角度，**所有** SDK 服务器都是安全的（它们不 spawn 进程、
//       不开网络连接，见 `filterMcpServersByPolicy` 的批注）
//     · 但"怎么放行"的设计还在讨论
//     · 所以先只放行 `claude-vscode` 这一个，为了让特定企业客户能用 VSCode 扩展
//
// ── 这段注释的信息量很大 ──
//
//   ① 它承认当前实现是**临时方案**，不是最终设计
//   ② 它说明了触发这个临时方案的**具体客户场景**
//   ③ 它给了一个 Slack 链接（`anthropic.slack.com/archives/...`）——
//      这是内部沟通记录，外部读者打不开，但能看出"决策发生在聊天里"
//
// 【这是生产代码里很常见的一种形态：把一个正确的通用判断，
//   临时收窄成特例，以解决某个紧急的具体问题。】
//
//   风险在于：如果没人回来收拾，这个特例会永久存在，
//   然后每个遇到问题的人都在这里加一个 `||`。
//   注释里写清"还在讨论"是唯一的防腐手段 ——
//   但更好的做法是挂一个带 deadline 的 issue 编号。'''),

(1506, 'before', '''// 【DEFAULT_DISABLED_BUILTIN：一个"极性反转"的服务器】
//
//     const DEFAULT_DISABLED_BUILTIN = feature('CHICAGO_MCP')
//       ? require('../../utils/computerUse/common.js').COMPUTER_USE_MCP_SERVER_NAME
//       : null
//
// 注释说明了它的特殊之处：
//   "Unlike user-configured servers (opt-out via disabledMcpServers),
//    this requires explicit opt-in via enabledMcpServers."
//
// ── 两种极性 ──
//
//   普通服务器（opt-out，默认开）：出现在 disabledMcpServers 里 → 禁用
//   内置服务器（opt-in，默认关）：出现在 enabledMcpServers 里 → 启用
//
// **两个列表的语义完全相反。** 这是全文件最容易搞错的地方。
//
// ── 为什么要给内置服务器反过来的默认值 ──
//
//   因为它是**能操作你的电脑**的那个服务器（computer use，
//   截图 / 点击 / 输入）。这种东西绝不能默认开着 ——
//   用户装了 CC 就自动获得"AI 可以控制我的鼠标"，这是不可接受的。
//
//   所以它默认关闭，必须在 /mcp 里显式打开。
//
// 【这是一个"能力的危险程度决定默认值"的例子】
//   同一个系统里，不同的服务器用不同的默认极性 ——
//   不是因为技术原因，是因为风险的期望值不同。
//
// ── 又一次 `feature()` 条件 require ──
//
//   特性关闭时，`DEFAULT_DISABLED_BUILTIN` 是 `null`，
//   于是 `isDefaultDisabledBuiltin()` 永远返回 false，
//   整套 opt-in 逻辑自然失效 —— 不需要额外的开关判断。
//
//   【这是"用数据的存在与否代替条件分支"的手法：
//     把"是否启用这个特性"编码进了一个常量是 null 还是字符串。】'''),

(1523, 'before', '''// 【isMcpServerDisabled：八行代码，两个方向相反的列表】
//
//     if (isDefaultDisabledBuiltin(name)) {
//       const enabledServers = projectConfig.enabledMcpServers || []
//       return !enabledServers.includes(name)     // 不在"已启用"里 = 禁用
//     }
//     const disabledServers = projectConfig.disabledMcpServers || []
//     return disabledServers.includes(name)        // 在"已禁用"里 = 禁用
//
// ── 两个 `return` 的方向正好相反 ──
//
//   内置：`!includes(enabled)` —— 默认不在列表里 → 返回 true（禁用）
//   普通：`includes(disabled)`  —— 默认不在列表里 → 返回 false（启用）
//
// 【这种"同一个函数，两条分支语义相反"的写法极易出错】
//
//   读代码时很容易只看一条分支，然后推理到另一条上。
//   更清晰的写法是让函数的返回值语义一致（都是"是否禁用"），
//   但内部用两个具名的小函数：
//
//       const isBuiltinOptedIn = (n) => (cfg.enabledMcpServers ?? []).includes(n)
//       const isNormalOptedOut = (n) => (cfg.disabledMcpServers ?? []).includes(n)
//       return isDefaultDisabledBuiltin(n) ? !isBuiltinOptedIn(n) : isNormalOptedOut(n)
//
//   语义完全一样，但读的人不会看错方向。
//
// ── `|| []` 而不是 `?? []` ──
//
//   这两个字段在类型上可能是 `string[] | undefined`，
//   用 `??` 更精确（只在 null/undefined 时兜底）。
//   用 `||` 会把**空字符串**也兜成 `[]` ——
//   但这两个字段是数组，不可能是字符串，所以实际无害。
//   属于"能用但不精确"的写法，全文件多处出现。'''),

(1538, 'before', '''// 【toggleMembership：一个小函数，解决"不要产生重复项"】
//
//     if (contains === shouldContain) return list   // 已经是目标状态，原样返回
//     return shouldContain ? [...list, name] : list.filter(s => s !== name)
//
// ── 第一行是最重要的：`contains === shouldContain` 时返回**原引用** ──
//
//   不是返回一个内容相同的新数组，是返回**同一个对象**。
//   这个细节在 `setMcpServerEnabled` 里被用来判断"有没有真的变"：
//
//       const next = toggleMembership(prev, name, enabled)
//       if (next === prev) return current        // 没变就不写盘
//
//   通过**引用相等**来判断"无变化"，从而跳过写盘。
//   这是个很省事的手法，但要求 toggleMembership 必须遵守
//   "无变化时返回原引用"的契约 —— 而这个契约只存在于这两处的配合里。
//
//   【如果将来有人把 toggleMembership 改成总是返回新数组
//     （比如为了"纯函数不可变"的洁癖），这个跳过写盘的优化就
//     静默失效 —— 功能不变，只是每次重复点击都写一次盘。】
//
// ── 为什么不用 Set ──
//
//   因为这两个列表会被**持久化成 JSON 数组**，顺序对用户可能可见
//   （/mcp 里的显示顺序）。用 Set 会丢顺序。
//   `filter` 保留原顺序，`[...list, name]` 追加到末尾 —— 都可预测。'''),

(1548, 'before', '''// 【setMcpServerEnabled：最后那个 `isBuiltinStateChange` 值得推敲】
//
//     const isBuiltinStateChange =
//       isDefaultDisabledBuiltin(name) && isMcpServerDisabled(name) === enabled
//
// 这个表达式在判断什么？
//
//   展开：**是内置服务器** 且 **当前禁用状态 == 目标启用状态**
//
//   设当前 `isMcpServerDisabled(name) = D`（true 表示禁用），
//   目标 `enabled = E`（true 表示想启用）。
//
//   `D === E` 意味着「当前禁用状态 == 期望启用状态」
//   → 等价于「想要的状态 != 当前状态」
//   → 也就是**确实要发生改变**。
//
// 所以变量名 `isBuiltinStateChange` 是准确的：真的要变。
//
// ── 但这个写法很难读 ──
//
//   直觉上的写法是 `isMcpServerDisabled(name) !== !enabled`，
//   或者更清楚：
//
//       const currentlyEnabled = !isMcpServerDisabled(name)
//       const isBuiltinStateChange =
//         isDefaultDisabledBuiltin(name) && currentlyEnabled !== enabled
//
//   两者逻辑等价，后者一眼能懂。这里用了 `D === E` 这种
//   "通过两次取反等于原值"的捷径，读的人要停下来想一下。
//
// ── 它只用于遥测（1571-1577）──
//
//   `if (isBuiltinStateChange) logEvent('tengu_builtin_mcp_toggle', ...)`
//
//   所以它不影响功能，只影响埋点是否准确。
//   但埋点的准确性直接影响"这个内置功能有多少人开了"这个结论 ——
//   如果每次点击都上报（不判断是否真的变），会把数据虚高
//   （用户点两下开、再点两下关，上报 4 次）。
//
// 【所以这个难读的判断是必要的：它保证了埋点只记真实的状态迁移。】
//
// ── 另一处值得注意：`saveCurrentProjectConfig` 的回调（1557-1569）──
//
//   回调里 `if (next === prev) return current` —— 没变化就返回原对象，
//   让上层知道"不用写盘"。
//   这和 toggleMembership 的引用相等契约是配套的（见上一条批注）。
//
//   但注意：内置服务器写 `enabledMcpServers`，普通服务器写
//   `disabledMcpServers`，而且普通那个传的是 `!enabled`（取反）。
//   两个极性在这里第三次出现 —— 前面 `isMcpServerDisabled` 是第一次，
//   `setMcpServerEnabled` 的分支是第二次。'''),

(1571, 'after', '''// 文件结束（1,578 行）。
//
// 【回头看这个文件的结构，其实只有四块】
//
//   ① 写入（writeMcpjsonFile）       —— 44 行，原子写
//   ② 去重（三个 dedup/signature）   —— 约 120 行，签名 + 优先级
//   ③ 读取（getMcpConfigsByScope 等）—— 约 300 行，六种来源
//   ④ 策略（deny / allow / disabled）—— 约 250 行，白黑名单 + 启停
//
// 剩下的是解析、增删、以及大量注释。
//
// 【如果要记住三件事，就是这三件】
//
//   1. **优先级**：plugin < claude.ai < user < project < local，enterprise 独占
//   2. **白黑名单非对称**：白名单能收紧到"只信 managed"，黑名单永远合并
//   3. **启停有两种极性**：普通服务器 opt-out（默认开），
//      内置高风险的 opt-in（默认关）
//
// 【这个文件最值得学的不是具体规则，是它处理"多来源配置"的方法】
//
//   · 每条配置都带 scope 标签（否则合并后就失忆了）
//   · 去重用**内容签名**而不是键（因为键天然不会撞）
//   · 抑制类规则必须保证"被抑制方有替补"（否则两个都不跑）
//   · 读-改-写操作要区分"逻辑视图"和"物理视图"
//   · 策略检查在每个出口都做，不假设来源可信
//
// 这五条和 MCP 协议无关，是做任何"多层配置系统"都用得上的。'''),

]
