# -*- coding: utf-8 -*-
"""mcp/config.ts 批注 p2：策略过滤、环境变量展开、增删配置。"""

ANNOTATIONS = [
(510, 'before', '''// 【filterMcpServersByPolicy：为什么需要一个"泛型无约束"的函数】
//
// 上面那段 25 行 JSDoc 是全文件写得最细的一处 —— 因为它要为一个
// **看起来不安全的类型断言**（`config as McpServerConfig`）做辩护。
//
// ── 先看它要解决的问题 ──
//
// `getClaudeCodeMcpConfigs()` 内部已经做了策略过滤。但有两条路径
// **绕过**了它：
//
//   ① `--mcp-config` 命令行参数（main.tsx）
//   ② `mcp_set_servers` 控制消息（print.ts，SDK V2 的 Query.setMcpServers()）
//
// 这两条都是"用户直接给我一批配置，我直接连"，不经过常规的合并流程。
// 所以它们必须**自己**再过一遍策略，否则就是个绕过口子。
//
// 这个函数就是给它们用的。
//
// ── 为什么泛型不加约束（<T> 而不是 <T extends McpServerConfig>）──
//
//   因为两个调用点用的是**不同的类型族**：
//     · main.tsx  → ScopedMcpServerConfig（args: string[] 必填）
//     · print.ts  → McpServerConfigForProcessTransport（args?: string[] 可选）
//
//   这两个类型在结构上兼容，但谁也不是谁的子类型。
//   如果加约束，总有一边编译不过。
//
// ── 为什么 `as McpServerConfig` 这个断言是安全的 ──
//
//   注释给了完整论证，核心两句：
//     "the policy check only reads, never requires any field to be present"
//     "`getServerCommandArray` defaults `args` to `[]` via `?? []`"
//
//   也就是说：策略检查**只读** type / url / command / args 四个字段，
//   而且对缺失字段有兜底。
//   所以传进来一个"结构兼容但没有 args"的对象，不会崩，只是按"没有 args"处理。
//
// 【这段注释的价值不在结论，在方法】
//
//   类型断言（`as`）在 Typescript 里通常是"我知道我在干什么"的免责声明，
//   很少附带理由。这里把**为什么安全**的三层理由都写出来了：
//   ① 这条路径为什么要单独过滤（防绕过）
//   ② 为什么不能加泛型约束（两个不兼容的类型族）
//   ③ 为什么断言是安全的（只读 + 有兜底）
//
//   如果每个 `as` 都这么写，类型系统就不需要被当成敌人了。'''),

(536, 'before', '''// 函数体只有 10 行，但有一个细节必须注意：
//
//     if (c.type === 'sdk' || isMcpServerAllowedByPolicy(name, c))
//
// **sdk 类型直接放行，连策略都不查。**
//
// 【这是全文件唯一一处"豁免策略"的地方，理由值得完整理解】
//
// 注释原话：
//   "SDK-type servers are exempt — they are SDK-managed transport placeholders,
//    not CLI-managed connections. The CLI never spawns a process or opens a
//    network connection for them; tool calls route back to the SDK via
//    mcp_tool_call."
//
// 拆开看：
//   ① sdk 类型的服务器**不是真的连接** —— 它是个传输占位符
//   ② CLI 为它既不 spawn 进程，也不开网络连接
//   ③ 工具调用通过 `mcp_tool_call` **回到 SDK 自己**去执行
//
// 所以：
//   · URL 白名单对它无意义（没有 url）
//   · command 白名单对它无意义（没有 command）
//   · 只按名字拦 → 会**静默丢掉**它
//
// 而丢掉它的后果是什么？注释点出了具体场景：
//   `installPluginsAndApplyMcpInBackground` 里的 `sdkMcpConfigs` carry-forward。
//
// 【安全含义：豁免是否合理？】
//
//   合理，但前提是"SDK 会自己负责安全"。
//   CLI 不执行任何东西，它只是把工具描述转给 SDK —— 真正的执行在宿主进程里，
//   由宿主自己信任的代码完成。企业策略管的是"CLI 不要连乱七八糟的外部服务"，
//   而 sdk 类型压根不是外部服务。
//
//   换句话说：**豁免的不是"这个服务器"，是"这个位置"** ——
//   这里放的是宿主自己的东西，不是配置里来的东西。'''),

(553, 'before', '''// 【expandEnvVars：按类型分支，但一半分支是"原样返回"】
//
// 展开范围：
//   stdio           → command / args[] / env{}          （全展开）
//   sse/http/ws     → url / headers{}                   （全展开）
//   sse-ide         → 不展开
//   ws-ide          → 不展开
//   sdk             → 不展开
//   claudeai-proxy  → 不展开
//
// ── 为什么 IDE 类型不展开 ──
//
//   `sse-ide` / `ws-ide` 的 URL 是 **IDE 自己在运行时给的**
//   （通常是 `http://localhost:<随机端口>/sse`）。
//   它不来自配置文件，也没有任何变量可展开。
//   强行扫一遍只是浪费，而且万一 URL 里恰好有 `${...}` 形状的字符
//   （几乎不可能，但）会被误展开。
//
// ── 为什么 claudeai-proxy 不展开 ──
//
//   因为它的 URL 是**服务端下发的**，下发时已经处理完了。
//   在客户端再展开一遍等于对已展开的内容做第二次插值 —— 如果有
//   变量值本身包含 `${...}`，会被二次展开，这是模板注入的经典形态。
//
// 【missingVars 用 Set 去重（614 行）】
//
//   因为同一个变量可能在 command、args、env 里出现多次。
//   不去重的话，报错信息会变成
//   "Missing environment variables: TOKEN, TOKEN, TOKEN" 这种。
//
// 【注意 missingVars 是"累积"的，不是"遇错即停"】
//
//   `expandString` 把每次的缺失变量 push 进同一个数组，然后继续展开下一个。
//   所以用户能一次看到**所有**缺失的变量，而不是修一个报一个。
//   这是配置校验里值得学的处理方式：**收集全部错误再报告**。'''),

(618, 'before', '''// 【addMcpConfig：八道检查，顺序有讲究】
//
// 按代码顺序：
//   ① 名字字符集（630）        —— 字母/数字/连字符/下划线
//   ② 保留名 claude-in-chrome（637）
//   ③ 保留名 computer-use（641，条件编译）
//   ④ 企业配置存在则直接拒绝（651）
//   ⑤ schema 校验（658）
//   ⑥ 黑名单（668）
//   ⑦ 白名单（675）
//   ⑧ 目标 scope 里是否已存在（682）
//
// ── 为什么 ④ 在 ⑤ 之前 ──
//
//   `doesEnterpriseMcpConfigExist()` 是 memoize 的、只读本地文件，很便宜。
//   策略拒绝不需要先验证 schema —— 反正无论如何都不让加。
//   先拒后验，能省掉一次 schema 解析，也能让错误信息更直接
//   （"企业配置独占"比"你的 JSON 有个字段错了"更接近根本原因）。
//
// ── 为什么 ⑤ 在 ⑥⑦ 之前 ──
//
//   因为黑名单/白名单要按 **command / url** 匹配，而匹配需要
//   `validatedConfig`（解析后的规范形态）。
//   拿原始 unknown 去匹配，字段名/类型都不可信。
//
//   注释里那句 "(needed for command-based policy checks)" 就是在说这个。
//
// ── ① 名字字符集的严格程度 ──
//
//   `/[^a-zA-Z0-9_-]/` 只允许这四类。为什么这么严？
//   因为这个名字会被拼进 **工具名**：`mcp__<server>__<tool>`。
//   如果允许点号、空格、冒号，工具名就可能出现非法字符，
//   而 MCP 工具名在 API 里是有字符集限制的（以及会被模型当标识符读）。
//
//   同样，这个名字还会进 `plugin:x:y` 那种冒号分隔的命名空间，
//   名字里带冒号会破坏解析。
//
// ── ②③ 两个保留名 ──
//
//   `claude-in-chrome`（637）：浏览器扩展用的服务器名，被占用。
//   `computer-use`（645）：同理，但代码在 `feature('CHICAGO_MCP')` 里 ——
//   这个特性关闭时，连检查带 import 一起被 DCE 删掉。
//
//   注意这里用的是 `await import(...)` 而不是顶层 import：
//   在 async 函数里可以动态加载，同样能达到"特性关闭时不加载"的效果。
//   代价是每次调用 addMcpConfig 都要过一次动态 import（有模块缓存）。'''),

(680, 'before', '''// 【重复检查：三种 scope 三个"存在性"来源】
//
//   project → getProjectMcpConfigsFromCwd()  （读当前目录的 .mcp.json）
//   user    → getGlobalConfig().mcpServers
//   local   → getCurrentProjectConfig().mcpServers
//
// 注意 project 用的是 `getProjectMcpConfigsFromCwd()` 而不是
// `getMcpConfigsByScope('project')` —— 这两个差别很大：
//
//   getProjectMcpConfigsFromCwd()  → **只看当前目录**，不向上遍历
//   getMcpConfigsByScope('project') → 从根目录一路找到 CWD，逐级合并
//
// 为什么这里必须用"只看当前目录"的版本？
//
//   因为接下来要**写回 .mcp.json**。如果读到的是多级合并的结果，
//   写回去就会把父目录的服务器**复制**进当前目录的文件里 ——
//   一次 add 操作凭空造出一堆重复配置。
//
// 【这是一个"读-改-写"操作里非常容易犯的错】
//
//   读的时候要读"逻辑视图"（合并后），写的时候必须写"物理视图"（单个文件）。
//   两者混用，就会把合并态固化到某一层。
//   注释里那句 "Used by addMcpConfig and removeMcpConfig to modify the
//   local .mcp.json file" 就是在标记这个约束。'''),

(704, 'before', '''// 【dynamic / enterprise / claudeai 三个 scope 直接抛错（704-709）】
//
// 这三个是**只读来源**，不能从 CLI 添加：
//
//   dynamic     → 运行时由 SDK / 控制消息临时塞进来的，没有持久化位置
//   enterprise  → 系统级文件，普通用户没权限也不该改（企业独占的前提）
//   claudeai    → 服务端下发的，要改得去网页端
//
// 这三次 throw 看起来像防御性代码，实际上是在**明确能力边界**：
// 报错比"静默忽略"好，因为用户会立刻知道"这条路不通"。
//
// 后面那个 switch（713-760）里还有一个 `default: throw` ——
// 那是因为 TS 的穷尽性检查会在 `default` 里把 scope 收窄成 `never`，
// 但运行时仍可能传入未预料的值。多一道保险。'''),

(712, 'before', '''// 【写回 .mcp.json 那段有个细节：`const { scope: _, ...configWithoutScope }`】
//
// 为什么要剥掉 scope？
//   因为 `existingServers` 里的每一项都被 `addScopeToServers` 贴过
//   `scope: 'project'` 标签。这个标签是**服务内部的**，
//   不属于文件格式。
//
//   如果不剥，写出来的 .mcp.json 会长这样：
//
//     { "mcpServers": { "foo": { "command": "npx", "scope": "project" } } }
//
//   下次读回来，schema 会把它当未知字段（或者更糟：如果 schema 允许
//   额外字段，会一直带着这个脏数据）。
//
// 【`scope: _` 这个写法】
//
//   解构时用下划线命名，只是为了"我知道这个变量存在但不用它"。
//   它不会有未使用变量的 lint 警告（因为下划线前缀通常被配置为例外），
//   同时明确告诉读者：这里确实有个 scope 字段，我是故意丢掉的。
//
//   比起 `delete config.scope`（会修改原对象）或
//   `JSON.parse(JSON.stringify(...))`（贵且丢类型），
//   解构排除是最干净的做法。'''),

(763, 'before', '''// 【removeMcpConfig：和 add 镜像对称，但少了三道检查】
//
// 有：名字 → 是否存在于目标 scope → 写回
// 没有：schema 校验（不需要，我们是在删东西）
// 没有：策略检查（不需要，删除永远不违反策略）
// 没有：企业独占检查（不需要，删除 .mcp.json 不影响企业配置）
//
// 【这里体现了一条设计原则：**
//   策略检查只拦"增加能力"的操作，不拦"减少能力"的操作。
//   删掉一个服务器不会打开新的攻击面，所以不需要过白名单。
//   如果这里也做策略检查，会出现"企业禁止了 X，导致用户**无法删除** X"
//   这种荒谬情况。
//
// 【注意 project 分支的 `if (!existingServers[name]) throw`（777）】
//   删除一个不存在的服务器为什么要报错？
//   因为静默成功会让用户以为删掉了。报错让他知道"你要删的东西不在这个 scope"——
//   这个反馈在配置混乱时（同名服务器在多个 scope 都存在）特别有用。'''),

(836, 'before', '''// 【getProjectMcpConfigsFromCwd：只读当前目录，且缺文件不算错】
//
// 两个"容错"细节：
//
// ── ① 缺文件不是错误（860-873）──
//
//   先看代码逻辑：`parseMcpConfigFromFilePath` 对 ENOENT 会返回一条
//   `MCP config file not found` 的 error。这里把这个 error **过滤掉**，
//   只看剩下的"真错误"。
//
//   为什么要过滤？因为**大多数目录没有 .mcp.json**。
//   向上遍历时会走十几个目录，如果每个缺失都当错误，
//   日志会被刷满，用户也会看到一堆无意义的警告。
//
//   但注意它过滤的方式：`e.message.startsWith('MCP config file not found')`。
//   **用错误消息的字符串前缀判断错误类型** —— 这是脆弱的：
//   改一下那句文案，这个过滤就失效，缺失文件会突然变成错误。
//
//   更好的做法是给 ValidationError 加一个 `code` 字段（像 errno 那样），
//   按 code 判而不是按文案判。这是本项目里反复出现的"
//   用自然语言当结构化数据"的模式（withRetry.ts 里解析 PTL 错误消息
//   也是同一类问题）。
//
// ── ② `isSettingSourceEnabled('projectSettings')` 提前返回（848）──
//
//   如果项目级设置在策略上被禁用（企业只允许 managed 设置），
//   就直接返回空，连文件都不读。
//
//   这是"策略前置"而不是"读完再过滤"：
//   读文件本身可能有副作用（触发 hooks、产生访问日志），
//   在明确不该读的时候就不该读。'''),

(883, 'before', '''// 【getMcpConfigsByScope：单来源读取，但 project 分支要向上遍历】
//
// 四个 scope 的处理方式：
//
//   project    → **从根目录找到 CWD**，逐级读 .mcp.json 并合并（909-961）
//   user       → 读全局配置的 mcpServers（962-978）
//   local      → 读当前项目配置的 mcpServers（979-995）
//   enterprise → 读 managed-mcp.json（996-1024）
//
// ── project 分支那 50 行值得细看 ──
//
//   ① 先收集路径（913-920）：
//        while (currentDir !== parse(currentDir).root) {
//          dirs.push(currentDir)
//          currentDir = dirname(currentDir)
//        }
//      从 CWD 一路往上到根，但**不含根目录本身**。
//      不含根是有意的：盘符根（C:/ 或 /）下放 .mcp.json 不是正常用法，
//      而且 Windows 上根目录常常不可读，硬读会产生权限错误。
//
//   ② 然后是 `dirs.reverse()`（923）：
//      收集时是从 CWD 往根，处理时要**从根往 CWD**。
//      因为后面用 `Object.assign(allServers, ...)` 合并，
//      后赋值的赢 —— 所以处理顺序必须是"远的先、近的后"。
//
//      【这是"收集顺序"和"处理顺序"必须相反」的典型场景。
//       如果忘了 reverse，就近的配置会被父目录的覆盖 —— 
//       方向反了，而且没有任何报错。】
//
// ── user / local 分支都走 parseMcpConfig，不读文件 ──
//
//   因为这两处的配置已经在内存里了（`getGlobalConfig()` /
//   `getCurrentProjectConfig()` 是内存对象）。
//   所以它们用 `parseMcpConfig({ configObject: { mcpServers } })`
//   而不是 `parseMcpConfigFromFilePath`。
//
//   注意它传的是 `{ mcpServers }` —— 包了一层，
//   因为 schema 校验的是整个 `McpJsonConfig`（`{ mcpServers: {...} }`），
//   不是单纯的服务器字典。
//
// ── enterprise 分支和 project 一样处理"缺文件" ──
//
//   逻辑完全同构（1005-1018），只是日志文案不同。
//   这种重复在四个分支里出现了两次，可以抽函数，但作者没抽 ——
//   因为抽出来要传 filePath、scope、日志前缀三个参数，
//   收益不明显。'''),

]
