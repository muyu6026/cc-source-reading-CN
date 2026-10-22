# -*- coding: utf-8 -*-
"""src/services/SessionMemory/sessionMemoryUtils.ts 批注数据"""

ANNOTATIONS = [

    (1, 'before', '''【第 1-4 行】为什么这几个状态要单独拆一个文件

注释：*These are separate from the main sessionMemory.ts to avoid importing runAgent.*

`sessionMemory.ts` 引入了 `runForkedAgent`（整个子代理执行链）；
而 `compact/` 那边只需要读「上次摘要到哪条消息」「配置的阈值是多少」这几个数。

如果这些状态放在 `sessionMemory.ts` 里，那 `compact` 为了读一个数字，
就得把整条 `runForkedAgent` 依赖图拉进来 —— 循环依赖几乎必然出现
（`sessionMemory` 依赖 `compact` 的判断，`compact` 又依赖它的数据）。

拆法很标准：**把「纯状态 + 纯函数」和「有副作用/重依赖的编排」分开**。
这个文件里没有一个 `import` 是重的：errors / fs / permissions / sleep / analytics。

一个可复用的判断：**如果某段代码被「另一半」需要，但它自己会拖进一堆东西，
就把它拆出来。** 拆出来的门槛不在于「逻辑是否独立」，而在于「依赖是否可控」。'''),

    (12, 'after', '''【第 12-13 行】两个超时，性质完全不同

- `EXTRACTION_WAIT_TIMEOUT_MS = 15000`：**我愿意为它等多久**（上限）。
- `EXTRACTION_STALE_THRESHOLD_MS = 60000`：**多久没动静就认定它死了**（判据）。

为什么两个都要：等待方是压缩流程，它要在「插笔记」之前确保没有正在进行的抽取
（否则会插进一份写了一半的笔记）。但抽取可能因为各种原因卡住
（子代理请求挂着、文件被占用）。没有上限的话，压缩会被无限阻塞 ——
而压缩本身是「上下文快满了」时才触发的，最等不起。

1 分钟这个阈值的含义是「比任何正常抽取都长得多」。正常抽取是一次
forged agent 调用，几秒到十几秒。超过 1 分钟基本可以断定是僵死了，
这时候宁可用旧笔记也不能不压缩。

注意「超时后继续」不是「放弃压缩」，而是**放弃等待**：
`return` 之后流程照常走，只是笔记可能是旧的。'''),

    (89, 'before', '''【第 89-105 行】用 `sleep(1000)` 轮询状态，而不是事件订阅

`while (extractionStartedAt) { ... await sleep(1000) }`

看起来很不「现代」（为什么不用 Promise / EventEmitter），但理由很实在：
`extractionStartedAt` 是一个**模块级变量**，被另一个文件的函数
（`markExtractionStarted` / `markExtractionCompleted`）改。
模块级变量没有内建的变更通知机制，要加订阅就得额外维护一套监听器列表，
而监听器列表又会带来「谁负责清理」的问题。

轮询在这里的代价几乎为零：这不是热路径（压缩时才调一次），
最长等 15 秒，间隔 1 秒 = 最多 15 次循环。

两个提前退出条件都必要：
- `extractionAge > 60000` —— 抽取本身僵死，不等了；
- `Date.now() - startTime > 15000` —— 我自己等太久了，不等了。

**注意第一个条件是在循环里每轮重新算的**，所以它能捕获「等待期间抽取卡住不动」的情况，
而不是只在进入时检查一次。'''),

    (131, 'before', '''【第 131-145 行】`set` 收 `Partial`，`get` 返回**副本** —— 不对称是有意的

```js
export function setSessionMemoryConfig(config: Partial<SessionMemoryConfig>) {
  sessionMemoryConfig = { ...sessionMemoryConfig, ...config }
}
export function getSessionMemoryConfig(): SessionMemoryConfig {
  return { ...sessionMemoryConfig }
}
```

`set`：`Partial` + 展开合并 = 只改传进来的字段，其余保持。
这样新增一个配置项时，所有老调用点都不用改。

`get`：返回 `{ ... }` 而不是直接返回内部对象 —— 这是**防止外部改到内部状态**。
如果直接返回引用，任何调用方写 `getSessionMemoryConfig().minimumTokensBetweenUpdate = 0`
都会静默改掉全局配置，而且**没有任何地方能看出来是谁改的**。

代价是每次读都造一个对象。这个函数在每轮对话里被调用几次，成本可以忽略。

这个「get 返回副本」的模式在这个仓库里到处都是（`emptyUsage` 的 `Readonly`、
`sessionMemoryUtils` 自己的 `DEFAULT_...` 被展开赋值）。
它是 JS 里没有 `private` 时最便宜的封装手段。'''),

    (151, 'before', '''【第 151-153 行】`recordExtractionTokenCount` 记的是**当时的上下文大小**

这个函数本身只有一行赋值，但它是下面那个阈值判断的**另一半**：

```js
hasMetUpdateThreshold(current) {
  return current - tokensAtLastExtraction >= minimumTokensBetweenUpdate
}
```

关键在于这里存的是**绝对值快照**，而判断用的是**差**。
所以：
- 第一次抽取时 `tokensAtLastExtraction = 0`（初值），第一次判断会立刻满足
  （上下文早就不止 5000 token 了）—— 这是对的，第一次总要抽；
- 之后每次抽取都会刷新这个快照，于是「增量」重新从 0 开始累积。

如果初值不是 0 而是某个大数，第一次就永远不满足 —— 而 `sessionMemoryInitialized`
标记已经置上了，于是整个会话都不会抽。**初值的选择直接决定功能是否可用。**

顺带说明为什么不用「累计 token 用量」：累计量只增不减，
一个长会话跑几小时后它永远超过阈值 —— 那不是「该更新了」，只是「跑得久」。'''),

    (184, 'before', '''【第 184-189 行】`hasMetUpdateThreshold` 的判据是「上下文**增长**」，不是「上下文**大小**」

```js
const tokensSinceLastExtraction = currentTokenCount - tokensAtLastExtraction
return tokensSinceLastExtraction >= sessionMemoryConfig.minimumTokensBetweenUpdate
```

对比一下如果写成 `currentTokenCount >= minimumTokensBetweenUpdate`：
一旦上下文超过 5,000 token（几乎必然），这个条件就**恒真** ——
节流阀彻底失效，每轮都抽。

用差值就变成「距离上次抽取又长了 5,000 token」。而上下文在压缩后会**变小**，
那时候差值是负数 → 不满足条件 → 不会刚压缩完就立刻再抽一次。
这个行为恰好是对的，而且是「用差值」的副产品，不是专门写的分支。

**阈值判断要问「相对什么」**：相对上一次抽取（差值），还是相对零点（绝对值）。
写成绝对值几乎总是错的，因为「零点」在长会话里没有意义。'''),
]
