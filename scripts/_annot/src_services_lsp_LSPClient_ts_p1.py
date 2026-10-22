# -*- coding: utf-8 -*-
"""src/services/lsp/LSPClient.ts 批注数据"""

ANNOTATIONS = [

    (51, 'before', '''【第 51-54 行】为什么「客户端」和「实例」要拆成两层

本文件（`LSPClient`）只管两件事：**起一个子进程**、**在它的 stdin/stdout 上跑 JSON-RPC**。
它不知道 `stopped/running/error` 是什么意思，也不知道 `maxRestarts`。

`LSPServerInstance` 在它外面包一层，只管状态机和重启策略。
再外面 `LSPServerManager` 负责「按扩展名选哪个实例」。

三层各自的判据很清楚：
- 这层要不要知道协议？→ 要（`$/setTrace`、`initialize`、`initialized`）
- 这层要不要知道业务状态？→ 不要

拆开的好处在这一行就能看到：`onCrash` 是**注入**进来的回调。
客户端不决定「崩了之后干什么」，只负责「崩了要告诉你」。
决策权留在上层，测试时就能塞一个假回调进去。'''),

    (62, 'after', '''【第 62 行】`isStopping` 只干一件事：区分「我们关的」和「它崩的」

同一个 `exit` 事件，两种含义完全相反：
- 我们主动 `stop()` 导致的退出 → 正常，不该报错；
- 进程自己死了 → 崩溃，要报错、要触发 `onCrash`、要重启。

Node 的 `child_process` 不会告诉你区别，所以只能自己打标记：
`stop()` 开头 `isStopping = true`，`finally` 里再改回 `false`（允许重启后再用）。

这个变量在后面出现了 4 次（`error` / `exit` / `stdin error` / `onClose` 各一次），
每次都是 `if (!isStopping)`。**一个布尔量守四个入口**，
比在每个入口自己判断「这次是不是主动关的」可靠得多。

注意 `finally` 里重置的那行注释：*Reset for potential restart* ——
如果忘了重置，第二次 `start()` 之后所有真实崩溃都会被当成正常退出，静默吞掉。'''),

    (63, 'before', '''【第 63-71 行】两个「先注册、后生效」的队列

`pendingHandlers` / `pendingRequestHandlers` 解决的是一个时序问题：
**handler 可能在连接建好之前就被注册**。

为什么会这样：`LSPServerManager.initialize()` 里给每个实例注册
`workspace/configuration` 的 handler，而那时候实例刚创建、连接还没有（懒启动）。
如果没有队列，那次注册要么抛错、要么被静默丢弃 —— 后者更糟，
因为 server 发来请求时没人应答，会永远挂着等（见管理器的注释）。

所以 `onNotification` / `onRequest` 里都有同一个分支：
`if (!connection) { pendingHandlers.push(...); return }`，
然后在 `start()` 里统一回放，回放完 `length = 0` 清空。

这是「**声明式注册**」的通用解法：调用方按逻辑顺序写代码，
时序问题由被调用方用队列吸收。'''),

    (110, 'after_block', '''【第 115-131 行】`spawn()` 返回不等于启动成功 —— Node 子进程的头号坑

注释写得非常准确：
*spawn() returns immediately, but the 'error' event (e.g., ENOENT for command not found)
fires asynchronously. If we use the streams before confirming spawn succeeded,
we get unhandled promise rejections when writes fail on invalid streams.*

也就是说，`spawn('nonexistent-cmd')` **不会抛异常**，它正常返回一个
`ChildProcess` 对象，只是这个对象的 `stdin`/`stdout` 是坏的。
`command not found` 这类错误稍后以 `'error'` 事件的形式到达。

如果直接拿 `process.stdout` 去建 `StreamMessageReader`，
后面任何一次写都会在坏流上失败，而失败又发生在没人 await 的地方 →
unhandled rejection（新版 Node 默认**直接终止进程**）。

所以这里必须 `await` 一个「要么 'spawn' 要么 'error'」的一次性 promise。
注意 `cleanup()` 在两条路径上都调用，用 `once` 而不是 `on` —— 双保险，
防的是某个实现同时触发两个事件留下悬挂监听。

**这条可以原样搬到任何语言**：创建子进程/连接是「发起」，
得到可用的句柄是「确认」，两件事之间必须有一次握手。'''),

    (143, 'before', '''【第 143-154 行】`error` 事件要监听**两次**，两次分工不同

- 第 116-131 行那次是 `once('error')`，只活到「确认 spawn 成功」为止，之后就 `removeListener`；
- 这次是 `on('error')`，从确认成功之后一直常驻。

为什么要两次：`'error'` 事件在生命周期里有两个完全不同的阶段。
启动阶段它代表「根本没起来」（ENOENT / EACCES），要 reject 掉那个 await；
运行阶段它代表「运行中出事了」，只能记下来 + 标记 `startFailed`。

`once` + 手动 `removeListener` 而不是靠事件自然只触发一次，
是因为这两个阶段的语义不同：启动阶段那个监听如果留在运行阶段，
一次运行期错误会被当成「启动失败」，把好好的实例标成坏的。

这里把 `startFailed = true; startError = error` 一起写，
是为了让后续所有 `checkStartFailed()` 调用（`initialize` / `sendRequest` /
`onNotification` 都有）立刻失败，而不是继续在坏连接上试。'''),

    (156, 'before', '''【第 156-167 行】`exit` 里把 `startFailed` **重置为 false**，这不是笔误

```js
if (code !== 0 && code !== null && !isStopping) {
  isInitialized = false
  startFailed = false      // ← 注意这里是 false
  startError = undefined
  ...
  onCrash?.(crashError)
}
```

`startFailed` 的含义是「**启动**失败了」。运行中崩溃不是启动失败，
所以要把旧的启动失败标记清掉，让上层有机会重新启动。

`code !== null` 这个条件是在排除「被信号杀死」的情况（那种情况 code 是 null，signal 才有值）。
这里没有处理 signal —— 也就是说 `kill -9` 掉的语言服务器不会被当成崩溃上报。
算是一个未覆盖的边角（作者显然知道 `_signal` 这个参数存在，但没用）。

`onCrash?.(...)` 的可选调用符号很重要：这个客户端可以脱离 `LSPServerInstance`
单独使用（测试里就是），那时候没人接收崩溃通知，不该报错。'''),

    (171, 'before', '''【第 171-178 行】`stdin` 的错误必须**只记不抛**

注释：*Error is logged but not thrown - the connection error handler will catch this*

`stdin` 上的错误（EPIPE 最常见）几乎总是「对端已经死了」的同义词。
而这个错误发生在一次 `write` 里 —— 那个 `write` 的调用栈可能在
`connection.sendNotification()` 内部，也可能是 JSON-RPC 库自己排队写的。

如果在事件回调里 `throw`，它不会沿着调用栈往上走，而是变成
`uncaughtException`（**直接崩掉整个 CLI**）。所以这里只能记日志，
把「请求失败」这件事交给上层的一次性处理（`sendRequest` 的 catch、
或者 `checkStartFailed` 把后续调用全部挡掉）。

一句话：**事件回调里的异常没有调用方可以接**，所以事件回调永远不该抛。'''),

    (185, 'before', '''【第 185-207 行】`onError` / `onClose` 必须在 `listen()` **之前**注册

顺序：建 connection（183）→ 注册 onError/onClose（187/200）→ `listen()`（210）。

如果反过来（先 listen 再注册），中间那个极短窗口里发生的错误、
或者「连接一建立就立刻关闭」这种情况，会没有任何监听者处理 ——
JSON-RPC 库要么静默、要么抛到全局。

这条和上面 spawn 的 `once('spawn')` 是同一个道理，只是换了一层：
**订阅必须先于启动**。凡是「开始产生事件」的调用，都应该在事件监听就绪之后执行。

看 `onClose` 里的注释：*Don't set startFailed here - the connection may close after
graceful shutdown*。这和 `exit` 里要重置 `startFailed` 是一组对照：
- `exit` 是进程真的没了 → 崩溃要上报；
- `onClose` 可能只是传输层关了（比如 shutdown 流程的正常一步）→ 不能算崩溃。
两个事件靠 `isStopping` 和各自的语义判断区分。'''),

    (212, 'before', '''【第 212-226 行】`trace()` 会发一条通知，而通知也可能失败

`connection.trace(Trace.Verbose, {...})` 内部会发 `$/setTrace` 通知。
如果 server 进程已经退出，这个发送会 reject —— 而这里**没有 await**，
所以必须挂一个 `.catch()`，否则就是 unhandled rejection。

这正是上面 spawn 注释里说的同一类问题，只是 Trigger 从「写坏流」变成「调用链末尾的
fire-and-forget」。

注意 `.catch()` 里的处理是 `logForDebugging` 而不是 `logError`：
追踪功能开启失败不影响任何功能，只是少了调试信息。
**错误的严重性要跟它的功能重要性对齐**，不能一律 `logError` ——
否则真正重要的错误会被淹掉。'''),

    (289, 'before', '''【第 289-314 行】`sendRequest` 的三道前置检查，顺序是「由外到内」

1. `if (!connection) throw 'not started'` —— 连对象都没有；
2. `checkStartFailed()` —— 对象有，但启动阶段就失败了（`startError` 里有原因）；
3. `if (!isInitialized) throw 'not initialized'` —— 起来了，但 `initialize` 握手没完成。

顺序不能换：先说最根本的（没有连接），再说最有信息量的（启动失败的具体错误），
最后说状态类的。**报错信息应该按「最接近根因」优先。**

第 2 步整个抽成了 `checkStartFailed()`，因为它在 `initialize` /
`sendRequest` / `sendNotification` / `onNotification` / `onRequest` 里出现 5 次。
抽出来的收益不是省行数，是保证「启动失败的实例对所有入口表现一致」。'''),

    (316, 'before', '''【第 316-335 行】这里**吞掉了**通知错误 —— 而外层又包了一层会抛的 catch

```js
} catch (error) {
  ...
  logError(...)
  // Don't re-throw for notifications - they're fire-and-forget
  logForDebugging(`Notification ${method} failed but continuing`)
}
```

矛盾在于：`LSPServerInstance.sendNotification()`（上一层）是这样写的：

```js
try { await client.sendNotification(method, params) }
catch (error) { ...; throw notificationError }
```

但 `client.sendNotification` 永远不抛，所以那个 `throw` **永远走不到**。
两层对「通知失败要不要上报」的判断不一致。

实际后果不严重：`didOpen` / `didChange` 失败时，`LSPServerManager` 那边
（比如 `openFile` 的 catch）也就收不到错误，于是 `openedFiles` 不会被写入 ——
下一步 `changeFile` 会重新走 `openFile`，算是**碰巧自愈**。

值得记的是这个模式本身：**「fire-and-forget」是一个需要上下一致的决策**，
某一层吞了错误，上面所有层的错误处理代码都会变成摆设。
读代码时看到「上层写得很认真的 catch」，要顺手确认下层真的会抛。'''),

    (373, 'before', '''【第 373-445 行】`stop()` 的顺序：协议 → 资源 → 监听器 → 进程

1. `shutdown` 请求 + `exit` 通知（LSP 规定的优雅关闭，先问再走）；
2. `connection.dispose()`（释放 JSON-RPC 连接）；
3. `removeAllListeners('error' / 'exit' / stdin 'error' / stderr 'data')`；
4. `process.kill()`。

第 3 步为什么不能省：**子进程对象会被复用**。
`LSPServerInstance.start()` 失败后重试时，`client.start()` 会在同一个 client 上
再 `spawn` 一次，`process` 变量指向新对象 —— 这没问题。
但如果旧对象上的监听器没摘掉，而它又恰好在这时触发 `exit`，
就会对着**新**实例的状态机调 `onCrash`，把它标成 error。

所以「清监听器」不是洁癖，是防跨生命周期的串扰。

`shutdownError` 用变量暂存、在 `finally` 之后再抛，是因为
`finally` 里要做的清理**必须在抛出之前完成**。这是一种
「先保证清理，再传播错误」的写法，比在 catch 里抛、然后指望 finally 执行更明确
（虽然 finally 本来也会执行，但这里需要清理逻辑知道有没有错，见第 433 行）。'''),
]
