# -*- coding: utf-8 -*-
"""mcp/config.ts 批注 p3：按名查找与多源合并（前半）。"""

ANNOTATIONS = [
(1028, 'before', '''// 【getMcpConfigByName：优先级在这里第一次以"显式 if 序列"现身】
//
// 顺序：enterprise → local → project → user
//
// 注意这个顺序**和合并时不同**（合并是 plugin < user < project < local，
// 即 local 最高）。这里 enterprise 排第一，是因为它一旦存在就独占，
// 同时 `getMcpConfigByName` 在 plugin-only 模式下只返回 enterprise。
//
// ── 为什么不用循环 / map 查找 ──
//
//   因为每一层都要**单独取一次**（`getMcpConfigsByScope` 每次调用都有开销：
//   读文件、解析、展开变量）。写成 map 也得先全部取一遍。
//
//   而这个函数是"按名查一个"的场景，理论上可以早期退出 ——
//   但代码没有这么做：它先把四层全取了，再按优先级找。
//
//   这是个**可以优化但没优化**的点：如果 enterprise 里就有，
//   local/project/user 三次读取是白读的。
//   不过在配置量级（几十个服务器、4 个文件）下无所谓，
//   而且早期退出会让 `isRestrictedToPluginOnly` 那段逻辑变复杂。
//
// ── plugin-only 模式的特殊处理（1038-1040）──
//
//   `if (isRestrictedToPluginOnly('mcp')) return enterpriseServers[name] ?? null`
//
//   直接返回，连 user/project/local 都不读。
//   注释说 "same as getClaudeCodeMcpConfigs()" —— 两处必须一致，
//   否则会出现"能按名查到但连接时不加载"或者反过来的不一致。
//
//   【这类"两个入口必须保持相同规则"的地方，最安全的做法是抽成一个
//     判定函数。这里没有抽，只靠注释标记一致性 —— 是个潜在漂移点。】'''),

(1062, 'before', '''// 【getClaudeCodeMcpConfigs：全文件的主函数，170 行】
//
// 它做的事，按顺序：
//
//   ① enterprise 存在 → 只返回 enterprise（独占）
//   ② 否则读 user / project / local（plugin-only 模式下跳过）
//   ③ 加载插件的 MCP 服务器（异步，可能含下载）
//   ④ 过滤 project 服务器：只留"已审批"的
//   ⑤ 收集"会真正连接的"手工服务器，作为去重靶子
//   ⑥ 插件服务器拆成 enabled / disabled 两堆，只对 enabled 做去重
//   ⑦ 合并（plugin < user < project < local）
//   ⑧ 策略过滤
//
// 【JSDoc 里那句 "This is fast" 是设计承诺，不是描述】
//
//   "only local file reads; no awaited network calls on the critical path"
//
//   这个函数在**启动路径**上（每次 `claude` 启动都要调）。
//   所以它不能等网络。claude.ai 连接器要联网拉，那部分被拆出去了
//   （`getAllMcpConfigs` 才做）。
//
//   但 `loadAllPluginsCacheOnly()` 也可能慢（读插件目录）。
//   所以有 `extraDedupTargets` 这个参数 —— 把"可能要等的东西"
//   以 **Promise 的形式**传进来，让本函数在合适的时机才 await 它。
//
//   【把 Promise 当参数传，是这个文件里最漂亮的一处并发设计，见
//     getAllMcpConfigs 的批注（p4）。】'''),

(1082, 'before', '''// 【第一道分叉：enterprise 独占，连插件都不留】
//
//    if (doesEnterpriseMcpConfigExist()) {
//      // 只过滤 enterprise 自己的服务器，然后直接 return
//    }
//
// 注释原话：
//   "If an enterprise mcp config exists, do not use any others; this has
//    exclusive control over all MCP servers (enterprise customers often do
//    not want their users to be able to add their own MCP servers)."
//
// 【注意这里有一个"多余的"策略过滤（1086-1093）】
//
//   既然已经独占 enterprise 了，为什么还要 `isMcpServerAllowedByPolicy`？
//
//   因为企业配置里也可能有**该被自己的白名单排除**的条目
//   （配置写错了、或者白名单后来收紧了）。
//   不加这一步，企业自己的配置就能绕过企业自己的白名单。
//
//   【原则：策略检查要在**每一个**出口做，不能假设"来源可信就不检查"。】
//   这里的来源是企业的，但检查依然要做 —— 因为策略和配置是两份文件，
//   它们可能不同步。'''),

(1098, 'before', '''// 【第二道分叉：plugin-only 锁定 —— 和上面那个独占**不一样**】
//
//   const mcpLocked = isRestrictedToPluginOnly('mcp')
//   const noServers = { servers: {} }
//   const { servers: userServers } = mcpLocked ? noServers : getMcpConfigsByScope('user')
//   ... project、local 同理
//
// 注释原话：
//   "Unlike the enterprise-exclusive block above, this keeps plugin servers."
//
// ── 两者对比 ──
//
//   条件                                   | 保留插件？| 保留 user/project/local？
//   --------------------------------------|---------|-----------------------
//   doesEnterpriseMcpConfigExist()         | 否       | 否
//   isRestrictedToPluginOnly('mcp')        | 是       | 否
//
// ── 为什么 plugin-only 要保留插件 ──
//
//   因为它的**语义是"只信任插件"**，不是"只信任企业"。
//   插件是经过审核、可审计的分发渠道；用户自己写的 .mcp.json
//   和命令行加的服务器是不可控的。
//
//   所以 plugin-only 的意思是：企业配置 + 插件 = 允许，
//   用户临时加的 = 不允许。
//
//   「两个都"锁定"，但锁的对象不同」—— 这是配置系统里很典型的
//   命名陷阱：`isRestrictedToPluginOnly` 这个名字说的是
//   "restricted to plugin (only)"，不是 "restricted, to plugin only"。
//
// ── 为什么用 `noServers` 这个共享常量而不是字面量 `{ servers: {} }` 三次 ──
//
//   只是省字节。注意它是**同一个对象**被赋给三个变量 ——
//   如果下游有人改 `userServers.foo = ...`，会同时影响另外两个。
//   这里安全，因为解构后只读。但这是一个"共享空对象"的隐患，
//   换成 `{}` 字面量更安全（多写 20 个字符）。'''),

(1114, 'before', '''// 【加载插件服务器：一个"错误分级"的示范】
//
//    const pluginResult = await loadAllPluginsCacheOnly()
//
// 注意函数名里的 **CacheOnly** —— 它只读已有的插件缓存，不触发下载。
// 因为有下载就会慢，而这是启动路径。
//
// ── 错误处理分两类（1123-1144）──
//
//   第一类（**真的错误**，走 logError）：
//     mcp-config-invalid / mcpb-download-failed /
//     mcpb-extract-failed / mcpb-invalid-manifest
//   → 这四个都表示"插件里声称有 MCP 服务器，但拿不到/解析不了"。
//     这是配置问题，用户该知道。
//
//   第二类（**正常情况**，走 logForDebugging）：
//     其他所有错误类型
//   → 注释原话："Plugin doesn't exist or isn't available - this is common
//     and not necessarily an error. The plugin system will handle installing
//     it if possible."
//
// 【这个分级的意义】
//
//   插件系统有"声明了但没装"的常态。如果这也当错误报，
//   用户每次启动都会看到一堆"插件不存在"的红字 —— 噪音掩盖真问题。
//
//   而 mcpb（MCP Bundle）相关的四种失败是**具体的、可行动的**错误，
//   应该显式说出来。
//
//   这一段体现了日志分级的原则：**按"用户能否行动"分级，不按"技术上是否异常"分级。**
//   一个"正常但需要用户处理"的情况（插件没装）比"异常但无害"的情况更该报。

// ── 并行加载（1147-1154）──
//
//     const pluginServerResults = await Promise.all(
//       pluginResult.enabled.map(plugin => getPluginMcpServers(plugin, mcpErrors)),
//     )
//
//   所有启用插件**并行**取 MCP 服务器。
//   注意 `mcpErrors` 这个数组被**所有** promise 共享并 push ——
//   依赖 JS 单线程（事件循环）保证不会有数据竞争。
//   在别的语言里这种写法需要加锁，在 JS 里是安全的，但要注意
//   push 的顺序不确定（取决于哪个插件先完成）。'''),

(1164, 'before', '''// 【project 服务器必须"已审批"才纳入（1164-1170）】
//
//     if (getProjectMcpServerStatus(name) === 'approved') { ... }
//
// ── 这是整个 MCP 体系里最重要的安全机制，值得单独讲 ──
//
//   `.mcp.json` 是**进版本控制**的 —— clone 一个仓库，就拿到了它的 .mcp.json。
//   而 .mcp.json 里可以写 `command: "node", args: ["evil.js"]`。
//
//   也就是说：**git clone 一个仓库 + 信任它 = 在自己的机器上执行
//   仓库作者指定的命令。**
//
//   这就是典型的"配置即代码执行"风险。
//
// ── 缓解方式是"每个服务器单独审批" ──
//
//   首次遇到 .mcp.json 里的某个服务器，状态是 `pending`（或
//   `rejected`/`changed`，如果内容变了），CLI 会问用户"要允许吗"。
//   只有 `approved` 的才会被真正加载。
//
//   状态存在 `getCurrentProjectMcpServerStatus()` 之类的本地记录里，
//   **不进版本控制** —— 所以别人批准过的服务器，在你这里还是 pending。
//
// ── 注意审批的粒度是"服务器名"，不是"文件" ──
//
//   这也是为什么内容变化要重置状态：如果审批按名字记，
//   攻击者可以保持名字不变、只改 command，就绕过了审批。
//   所以状态里必须包含内容指纹（通常就是 `getMcpServerSignature` 那一套）。
//
// ── 为什么 user / local 不需要审批 ──
//
//   因为它们不在版本控制里。用户自己写 `claude mcp add`，
//   或者在自己机器上的配置里写，那本来就是他的意图 ——
//   没有人能通过 clone 仓库来影响这两处。
//
//   【安全边界跟着"信任边界"走：能随仓库分发的东西要审批，
//     只能本机产生的东西不用。】'''),

(1179, 'before', '''// 【`await extraDedupTargets` 的位置很讲究（1179）】
//
// 这个 await 在**插件全部加载完之后**：
//
//     const pluginResult = await loadAllPluginsCacheOnly()   // ← 磁盘 IO
//     ... 并行取各插件的 MCP 服务器 ...                        // ← 可能下载
//     const extraTargets = await extraDedupTargets            // ← 现在才等
//
// ── 为什么要放在这里，不放在函数开头 ──
//
//   `extraDedupTargets` 通常是"正在联网拉 claude.ai 连接器"的 promise
//   （见 getAllMcpConfigs）。它慢，且结果只用于**去重靶子**。
//
//   如果一开始就 await 它，整个函数就串行化了：
//       等网络（2s）→ 再读插件（0.5s）= 2.5s
//
//   放在插件加载之后，两者**重叠**：
//       开始读插件的同时，网络也在跑 → 总耗时 = max(2s, 0.5s) = 2s
//
//   这就是 JSDoc 里那句 "so the two overlap rather than serialize"。
//
// ── 这个模式的通用形态 ──
//
//   把"可能很慢的异步操作"以 **Promise（尚未 await）** 的形式传进来，
//   让被调方在"真正需要它的前一刻"才 await。
//
//   调用方负责**启动**，被调方负责**等待时机**。
//   这是把并发控制权和业务控制权分开的典型手法。
//
//   代价：函数签名变复杂（多一个 Promise 参数），
//   且依赖"被调方知道该在哪等"这个隐式知识。
//   所以必须写注释说明，否则后来的人会把它挪到函数开头 ——
//   功能完全不变，性能悄悄退化。'''),

(1195, 'before', '''// 【把插件服务器拆成 enabled / disabled 两堆，是为了不破坏"先加载赢"】
//
// 注释原话（1195-1198）：
//   "Split off disabled/policy-blocked plugin servers so they don't win the
//    first-plugin-wins race against an enabled duplicate — same invariant as
//    above. They're merged back after dedup so they still appear in /mcp
//    (policy filtering at the end of this function drops blocked ones)."
//
// ── 还原这个故障 ──
//
//   假设插件 A 和插件 B 都声明了同一个 Slack 服务器（签名相同），
//   而 A 那个被用户禁用了：
//
//   ① 如果**不拆**：遍历时先遇到 A（禁用），`seenPluginSigs` 记下 A 的签名
//      → 后遇到 B（启用）时被判为"重复 A" → **B 被抑制**
//      → 结果：A 因为禁用不连，B 因为被抑制不连 → 两个都不跑
//
//   ② 拆开之后：A 进 disabled 堆，B 进 enabled 堆
//      → 只对 enabled 堆做去重 → B 存活
//      → 最后把 A 合并回来（它仍然出现在 /mcp 里，只是禁用状态）
//
// ── 这和第 290 行那条 `isMcpServerDisabled(name)) continue` 是同一个 bug 的两个位置 ──
//
//   一个是"手工服务器不能用自己的禁用身份去抑制连接器"，
//   一个是"插件服务器不能用自己的禁用身份赢下先加载比赛"。
//   形态完全一样：**禁用状态的东西不该参与"谁赢"的竞争**。
//
//   【这类规则应该抽成一个函数 —— 现在它在两个地方各写了一遍，
//     将来加第三种来源（比如另一种插件类型）时，很容易漏掉第三次。】'''),

]
