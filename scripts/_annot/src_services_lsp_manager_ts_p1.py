# -*- coding: utf-8 -*-
"""src/services/lsp/manager.ts 批注数据"""

ANNOTATIONS = [

    (11, 'after', '''【第 11-40 行】一个模块用 6 个模块级 `let`，是刻意的

`lspManagerInstance` / `initializationState` / `initializationError` /
`initializationGeneration` / `initializationPromise`，加上四态的 `InitializationState` 类型。

为什么不做成一个 `{ instance, state, error }` 对象？因为这个模块对外
只暴露**函数**（`getLspServerManager` / `initializeLspServerManager` / …），
外部拿到的是行为而不是数据。拆成独立变量之后，「状态」自然只有模块内部能改，
比一个可导出的对象更难被误写。

代价是这五个变量之间**必须保持一致的组合**（比如 state 是 `'failed'` 时
instance 必须是 undefined），而这种约束只存在于注释里。
下面每一处赋值都成对出现，就是为了维护这条不变量 —— 读的时候盯住这一点。'''),

    (32, 'after', '''【第 32-35 行】`initializationGeneration` 是「过期 promise 不许改状态」的锁

场景：初始化失败了，用户装了新插件，于是 `reinitializeLspServerManager()` 又发起一次。
如果此时**第一次**的 `initialize()` 才刚 reject 回来，它会把 `initializationState`
写成 `'failed'`、把 `lspManagerInstance` 清空 —— 而第二次其实正在正常进行中，
结果被前一次迟到的回调打断了。

解法不是「取消旧 promise」（promise 没法取消），而是给它一个**代号**：
发起时 `++initializationGeneration` 拿到 `currentGeneration`，
回调里先比较 `currentGeneration === initializationGeneration`，
不相等就直接放弃这次结果。过期回执认得出自己过期，就不会误伤后来者。

这个模式在「可重试的异步单例」里几乎必然出现，比「比较 promise 引用」更可靠
（promise 变量本身会被覆盖，早就不在手里了）。'''),

    (48, 'before', '''【第 48-53 行】`_resetLspManagerForTesting` —— 为什么不能直接用 shutdown

`shutdownLspServerManager()` 是 `async`，而且会去**真的**停掉已连接的语言服务器。
但测试想要的只是「把模块级状态清回初始」，不需要断任何连接
（也没连上，因为测试里根本没启动 server）。

所以单独开一个同步函数只清 5 个变量。注意它**也把 generation 加了 1** ——
不是顺手，是为了让测试里可能还挂着的旧 promise 一并作废，
否则同一个测试分片里后续用例会收到上一用例的迟到回调。

命名前缀 `_` 是这个仓库的约定：内部/测试专用，不算公共 API。'''),

    (63, 'before', '''【第 63-69 行】初始化失败时返回 `undefined`，而不是那个坏实例

`if (initializationState === 'failed') return undefined` 这一行的意思是：
**失败之后不把实例交出去**，即使 `lspManagerInstance` 变量里还有一个对象。

（严格说失败路径已经把 instance 置空了，这行是双保险，防的是两次赋值之间的竞态。）

调用方因此必须处理 `undefined`。这个设计选择值得学：
「返回一个可能半坏的实例，让调用方自己小心」和
「返回 undefined，强迫调用方显式处理」——后者把错误推到了离现场最近的地方。

想区分「还没开始」「正在初始化」「失败了」这三种 undefined，
用下一个函数 `getInitializationStatus()`，它把四态转成可辨识联合。'''),

    (100, 'before', '''【第 100-110 行】`isLspConnected()` 的判据是「**不是 error**」，不是「在 running」

这个函数直接决定 `LSPTool.isEnabled()`，也就是「模型能不能看到 LSP 工具」。

判据：`servers.size > 0` 且**至少有一个** server 的 `state !== 'error'`。

为什么不是要求 `state === 'running'`？因为 LSP server 是**懒启动**的：
初始化阶段只解析配置、建实例，真正 `spawn` 发生在第一次需要它的文件上。
所以绝大多数时刻所有 server 都是 `'stopped'` —— 那时候工具必须可用，
否则整个工具永远处于禁用状态，形成死锁（要用才启动，但不用就不启用）。

反过来，只要有一个 server 处于 `error`（崩了、启动失败），它就不算可用的那一个；
但只要还有别的没坏，工具整体仍然可用。'''),

    (145, 'before', '''【第 145-150 行】`--bare` 模式直接不启 LSP

注释：*LSP is for editor integration (diagnostics, hover, go-to-def in the REPL).
Scripted -p calls have no use for it.*

`claude -p "..."` 是一次性脚本调用：发一次、拿结果、退出。
诊断和跳转是给人看的，脚本没有「人的屏幕」，所以整套 LSP 在 `--bare` 下是纯开销
（解析配置、可能 spawn 一堆语言服务器、然后马上退出）。

这类「功能按运行形态开关」的判断在这份代码里有一致的位置：
都在**最外层入口**做一次 `if (isBareMode()) return`，而不是撒在各个内层函数里。'''),

    (167, 'before', '''【第 167-176 行】同步建实例，异步初始化 —— 这个顺序是关键

`initializeLspServerManager()` 本身是**同步**函数，它在返回之前只做三件事：
建实例、把 state 置为 `'pending'`、启动一个后台 promise。

这样调用方（启动流程）可以立刻继续往下走，而 LSP 的配置加载 + 可能存在的
子进程启动全部发生在后面。如果这里写成 `await`，启动就会被 LSP 拖慢 ——
而 LSP 恰恰是可选的。

需要「等 LSP 就绪」的地方自己调 `waitForInitialization()`，
把「要不要等」的决定权交给调用方，而不是替所有人做一个更慢的选择。'''),

    (210, 'before', '''【第 210-225 行】这条注释记的是一个真实 issue，值得完整读一遍

`https://github.com/anthropics/claude-code/issues/15521`

事情经过：
1. `loadAllPlugins()` 是 **memoized** 的；
2. 它在启动早期就被调用了（`setup.ts` 里的 `getCommands` 预取），
   那时候 marketplace 还没对账完；
3. 于是这一次调用把「空插件列表」记进了 memo；
4. `initializeLspServerManager()` 接着读这个 memo，用 **0 个 server** 完成初始化；
5. 而 LSP 是唯一**不会**在 `refreshActivePlugins()` 之后重初始化的模块
   （commands / agents / hooks / MCP 都会）。

三个条件同时成立才炸：memoize + 早期调用 + 缺少刷新路径。

教学点在于第 5 条：**memoize 引入了一个隐藏的失效责任**。
谁 memo，谁就要回答「什么时候作废」。这个 bug 里没人回答，于是答案变成
「永远不」，而 LSP 恰好是漏掉作废钩子的那个。'''),

    (238, 'before', '''【第 238-244 行】重初始化前先 `shutdown()` 旧实例，且是 fire-and-forget

`void ... .catch(...)` 的意思：不等它、但也不许它抛出未处理拒绝。

为什么要关旧的：`/reload-plugins` 之后如果不关，旧的语言服务器子进程会一直挂着
（父进程还活着，子进程不会因为没人用就自己退）。跑几次 reload 就是几个僵尸进程。

为什么不等：这是「尽力而为」的清理。主要的修复场景（issue #15521）里旧实例是
**0 个 server**，几乎什么都没做；为了一个通常无操作的调用去阻塞 reload 不值得。

真要做严格，应该 `await` 并处理失败。这里明确选了「不阻塞 + 记日志」。'''),

    (267, 'before', '''【第 267-289 行】`shutdown` 吞错误，但状态**无条件**清空

`try { await ... } catch { logError } finally { 清 6 个变量 }`

注释给了理由：*This is acceptable during application exit when recovery is not possible.*

退出路径上的原则和普通路径不同：
- 普通路径：失败要往上抛，让调用方决定怎么办；
- 退出路径：**没有任何人能处理这个失败**，抛出去只会变成一条难看的崩溃堆栈。
  所以「记下来 + 继续清理」是唯一有意义的动作。

注意 `finally` 里 `initializationGeneration++`：即使关不干净，
也要让所有在途的初始化 promise 作废，否则它们回来时会往一个已经关闭的模块里写状态。'''),
]
