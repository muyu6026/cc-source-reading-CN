# -*- coding: utf-8 -*-
"""src/services/lsp/LSPServerManager.ts 批注数据"""

ANNOTATIONS = [

    (45, 'before', '''【第 45-59 行】为什么用「工厂函数 + 闭包」而不是 `class`

注释直接写了：*Uses factory function pattern with closures for state encapsulation (avoiding classes).*

它省掉的东西比想象中多：
- `class` 的 `private` 只是 TypeScript 编译期的承诺，运行时照样能从外面 `obj._state` 摸到；
  闭包里的变量**运行时真的拿不到**。
- 不需要 `this`，所以方法可以随便当回调传出去（`servers.map(s => s.stop())` 不会丢 this）。
- 类型用 `type LSPServerManager = { ... }` 单独声明，导出的接口比 class 更干净
  （不会把私有成员也带进类型里）。

代价是每个实例都**重新创建**一份所有函数（class 的方法在原型上共享）。
这里创建次数是「每配置一个 LSP server 一次」，个位数，完全无所谓。
如果是要创建几万个的工厂，就得回头看这一条。'''),

    (61, 'after', '''【第 61-64 行】三张 Map，对应三种完全不同的问题

- `servers: 名字 → 实例` —— 生命周期（启动 / 停止 / 查状态）；
- `extensionMap: 扩展名 → 名字数组` —— 路由（这个文件该交给谁）；
- `openedFiles: uri → 名字` —— 协议同步状态（这个文件在这个 server 上是否已 didOpen）。

把三者混在一张表里（比如给 server 加个 `files: Set`）也能跑，但会带来两个麻烦：
路由是**只读的静态映射**（配置决定，运行期不变），
同步状态是**每打开一个文件就变**的。混在一起之后，「重建路由」和
「丢掉同步状态」就绑死了 —— 而实际上重载配置时你只想重建前者。

一张表只管一件事，是这里最清楚的信号。'''),

    (89, 'before', '''【第 89-145 行】一个 server 配置坏掉，不许影响其它 server

`for` 循环体里整段 `try/catch`，catch 里只 `logError` 然后继续下一轮。
注释：*Continue with other servers - don't fail entire initialization.*

这条和 `config.ts` 里「单个插件抛错不拖垮整体」是同一条原则的两个层级：
插件层 → 每个插件的 server 集合；server 层 → 每个 server 的配置。

值得注意的细节：`createLSPServerInstance` 抛错也在这个 try 里，
所以「配置校验失败」和「实例构造失败」走同一条降级路径 —— 都是跳过这一个。'''),

    (97, 'after', '''【第 97-104 行】为什么「`extensionToLanguage` 为空」要当成错误

因为**路由完全靠它**。`getServerForFile()` 用 `path.extname()` 查
`extensionMap`，而 `extensionMap` 是从每个 server 的
`extensionToLanguage` 的**键**里建出来的。

空表意味着这个 server 永远不会被选中 —— 它会安安静静地存在、占着内存、
可能还被 `isLspConnected()` 算进「可用」里，但对任何文件都不会响应。

这种情况提前抛错的收益很实在：
- 配错的人立刻在日志里看到 `missing required 'extensionToLanguage' field`；
- 而不是以后花两小时怀疑「为什么跳转没反应」。

**校验的判据不是「这字段合不合法」，而是「缺了它以后这个对象还能不能履行它的职责」。**'''),

    (123, 'before', '''【第 123-135 行】客户端能力声明说「不支持」，TypeScript server 照样发请求

注释把矛盾讲得很白：
*Some servers (like TypeScript) send these even when we say we don't support them.*

`InitializeParams.capabilities.workspace.configuration` 传的是 `false`，
按 LSP 规范 server 就不该发 `workspace/configuration`。但现实里 server 会发，
而且**如果你不回，它会一直挂着等**（JSON-RPC 请求是有 id 的，不响应就是永远 pending）。

所以这里必须注册一个 handler，回一个长度与 `params.items` 相同的 `null` 数组：
**满足协议格式，但不提供任何真实配置**。注释原话：
*This satisfies the protocol without providing actual configuration.*

这条经验可以推广：跟第三方实现对接时，
「声明不支持」和「对方不发」是两个独立事件。
能力声明只约束**守规矩的实现**，对不守规矩的那部分，你还是得准备一个兜底处理。'''),

    (157, 'before', '''【第 157-185 行】`shutdown` 的三个决定，每个都有理由

1. **只关 `running` / `error` 的**：`stopped` 的本来就没进程；`starting` / `stopping`
   的正在路上，硬关会和正在进行的转换打架。
2. **用 `Promise.allSettled` 而不是 `all`**：一个 server 关不掉不能让其它 server 的关闭结果丢失。
3. **先 `clear()` 三张表，再判断要不要抛错**：状态清理是无条件的。
   否则「有一个关不掉」会导致三张表留着旧数据，下次初始化时
   `servers.set()` 会盖掉一部分、留一部分 —— 变成两个配置混合的怪物。

抛出前把每个失败拼成 `名字: 原因`，是为了日志能直接看出是哪个 server 的问题。'''),

    (192, 'before', '''【第 192-207 行】同一个扩展名有多个 server 时，取**第一个注册的**

注释：*Use first server (can add priority later)* —— 明确承认这是尚未实现的优先级。

不过 `extensionMap` 是 `Map<string, string[]>`，**数组**本身就为「以后加优先级」留了位置：
现在是 `serverNames[0]`，将来排序一下就能按优先级取。

真正要注意的是「第一个」由什么决定：配置对象的 `Object.entries()` 顺序，
也就是插件加载顺序。所以两个插件都声称处理 `.ts` 时，谁后加载不影响结果
（`config.ts` 里后者会覆盖同名的，但不同名的两个 server 都会进数组），
**先加载的那个赢**。

这也是为什么 `config.ts` 要费力保证合并顺序稳定 —— 顺序在这里变成了行为。'''),

    (270, 'before', '''【第 270-310 行】`openFile` 的幂等：didOpen 一个 URI 只能发一次

`if (openedFiles.get(fileUri) === server.name) return`

为什么必须挡住重复：LSP 里 `textDocument/didOpen` 的语义是
「**从现在开始**这个文档由客户端托管」，server 会为它建一份内存文档。
同一个 URI 发两次 didOpen，server 侧的状态就不可预测了
（有的实现会当第二次是新的覆盖，有的直接报错，有的两份并存）。

所以这里用 `openedFiles` 做「已经打开过」的凭据。注意值存的是
**server 名字**而不是 `true` —— 因为同一个文件可能被不同 server 打开过
（比如 `.vue` 同时被 vue server 和 ts server 处理）。存名字才能判断
「是不是**这个** server 已经打开过它」。'''),

    (312, 'before', '''【第 312-324 行】`changeFile` 的两条回退路径，都指向 `openFile`

两种情况：
1. `server.state !== 'running'` —— server 还没起来，那当然没 didOpen 过；
2. `openedFiles.get(fileUri) !== server.name` —— server 在跑，但**这个文件**没打开过。

两种都直接 `return openFile(filePath, content)`，因为 LSP 要求
**didOpen 必须先于 didChange**，否则 server 会忽略你这个变更（它没有基线可以改）。

这条「协议有前置依赖，所以函数要能自愈」的模式很值得记：
调用方不需要知道「我这个文件之前打开过没有」——
`changeFile` 自己判断，并且在必要时降级成 `openFile`。'''),

    (326, 'before', '''【第 326-333 行】`version: 1` 恒不变 —— 一个已知的不规范之处

真实 LSP 要求每次 `didChange` 的 `version` **严格递增**，server 用它判断顺序、
丢弃过期的增量。这里固定写 1。

为什么没出问题：`contentChanges: [{ text: content }]` 是 **full text sync**
（没带 `range`），也就是每次发整份文件。server 拿到的是完整内容，
不依赖 version 做增量合并，所以 version 单调与否不影响正确性。

但它是**技术债**：一旦某个 server 在 full sync 模式下仍然按 version 去重，
或者将来要改成增量同步，这里立刻就是 bug。

读源码时看到这类「明显该递增却写死」的地方，正确反应不是「作者不会写」，
而是「为什么这样也能跑」—— 答案通常会带出协议的某个细节。'''),

    (349, 'before', '''【第 349-368 行】`didSave` 不带内容，只有一个 URI

`{ textDocument: { uri } }` —— 没有 `text` 字段。

因为 `didSave` 的用途不是传内容（内容已经在 didChange 里同步过了），
而是**通知一个事件**：这个文件刚被写到磁盘，现在是个适合做完整分析的时刻。

对语言服务器来说这是一个信号，最常见的作用是**触发诊断**：
很多 server 平时只做增量检查，收到 didSave 才跑全量 lint。
管理器的注释也点了这点：*Called after file is written to disk to trigger diagnostics.*

所以 `saveFile()` 是诊断链路里的一环，不是「保存文件」那个动作本身。'''),

    (377, 'before', '''【第 377-379 行】`closeFile` 写好了，但**没人调用** —— 注释自己说了

*NOTE: Currently available but not yet integrated with compact flow.
TODO: Integrate with compact - call closeFile() when compact removes files from context.*

这是一个很典型的「已实现但未接线」的功能。它的后果不是错误，而是**资源缓慢增长**：
压缩把一堆文件从上下文里移除之后，LSP server 那边仍然认为这些文件是打开的，
诊断还会继续针对它们上报，服务器内存也一直不释放。

为什么值得单独标出来：这类「写完了但没接」的代码，光看调用图是发现不了的
（调用图里它就是孤立的），只有注释会告诉你「本来打算接在哪」。
读大项目时，`TODO` 里最有价值的往往不是「要做什么」，而是「**为什么这里断了一截**」。'''),

    (402, 'before', '''【第 402-405 行】`isFileOpen` 只看 uri，不看 server

`openedFiles.has(fileUri)` —— 因为 `openedFiles` 的键是 uri、值是 server 名，
`has` 只能回答「有没有任何 server 打开过它」。

这在当前用法下够用（调用方只想知道「值不值得发 didChange」），
但如果将来要问「**这个** server 打开过它吗」，得改成
`get(uri) === serverName`。

这类「函数的语义边界正好卡在数据结构的能力边界上」的情况，
是读代码时判断「将来会不会被改坏」的好线索。'''),
]
