# L4-B1 · while 循环本体：Agent 的本质就是这几行

> 从这一课起进入 L4-B「主循环」。前一层你读的都是几十行的小文件，这一课的教材是全仓**最核心**的一个文件——1,729 行的 `query.ts`。但别慌：本课只要求你精读其中约 90 行，全部围绕一个 `while (true)`。
> 这是全课程最重要的一课。学完它，「AI Agent」这个概念的神秘感会消失：所谓 Agent，就是一个「发给模型 → 收响应 → 有工具调用就执行并回灌 → 没有就停」的循环。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L4-B1（L4-B 主循环第 1 课，共 4 课） |
| ⏱ 时长 | 120 分钟 |
| 前置课时 | [L2-02 跟着循环变量走](../L2/L2-02-跟着循环变量走.md)（纸上模拟循环的基本功）、[L0-08 async与await](../L0/L0-08-async与await.md)（`for await` 读法）、[L3-04 压缩三小件](../L3/L3-04-压缩三小件.md)（循环里压缩那几步的下游）、[06 对话主循环与模型调用](../06-对话主循环与模型调用.md)（章节版速览） |
| 教材清单 | 批注版：[`query.ts`](../../annotated/src/query.ts)（3,304 行批注）／原文：[`query.ts`](../../source/src/query.ts)（**1,729 行**，本文行号以它为准）<br>**只读这几段**：204–217（State 类型）、307–321（循环头）、365、449–451、654–664（发请求）、826–845（判 tool_use）、1062–1063 与 1357（跳出）、1380–1401（执行工具）、1715–1729（回灌）＝约 90 行<br>辅助：[`toolOrchestration.ts`](../../source/src/services/tools/toolOrchestration.ts) 19–24、[`toolExecution.ts`](../../source/src/services/tools/toolExecution.ts) 599–613（权限检查入口，各 10 行） |
| 这节课只解决一件事 | 默写主循环伪代码（过关题），并指出「权限检查」插在第几步 |

> **行号约定**：本文摘录的代码与批注版**逐字一致**，但行号标的是 `source/` 原文行号——批注版在代码之间插了中文注解，同一个 `while (true)` 在原文 307 行、批注版 673 行。原文 1,729 行中约 6 成是 `feature()` 实验开关与恢复路径，初学全部跳过，第 1 节会给你跳过清单。

---

## 1. 全文地图：1,729 行里只读 90 行

| 行号（原文） | 内容 | 初学怎么办 |
| --- | --- | --- |
| 1–122 | imports | 跳过。只认 3 个名字：`runTools`（98 行）、`StreamingToolExecutor`（96 行）、`handleStopHooks`（101 行） |
| 123–179 | 两个小工具函数（补发假 tool_result、识别 max_output_tokens 错误） | 粗读即可 |
| **204–217** | **`State` 类型：循环的「记忆」** | ★ 精读 |
| 219–239 | `query()` 外壳，3 行核心：`yield* queryLoop(...)` | 粗读 |
| 241–306 | `queryLoop` 开头：解构参数、初始化 `state`（268–279 值得看一眼） | 粗读 |
| **307–1728** | **`while (true)` 主循环** | ★ 本课主战场 |
| 1729 | 结束大括号 | —— |

主循环内部 1,423 行的跳过清单（都很重要，但**不是第一遍读的**，后续课时会回来）：400–468 是 snip / microcompact / collapse / autocompact 四层压缩（压缩本体 L3-04 读过，这里只见调用）；654–954 是内层 `while (attemptWithFallback)` 模型降级重试（L4-B4）；788–825 与 1062–1256 是 413 超长、图片超限、输出截断的「先扣下再恢复」机制；1308–1355 是 token 预算自动续跑；1411–1702 是工具摘要、排队命令、附件注入、MCP 刷新。

**留下的骨架**只有：循环头（307–321）→ 算 `messagesForQuery`（365）→ 发请求收响应（654 起）→ 判断有没有 `tool_use`（826–845）→ 没有就 return（1062、1357）→ 有就执行工具（1380–1401）→ 拼下一轮 state（1715–1727）。90 行，就是 Agent 的全部。

---

## 2. 精读正文（行号为 source 原文行号）

### 2.1 循环的「记忆」：State 类型（204–217）

```ts
// query.ts:204-217
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  autoCompactTracking: AutoCompactTrackingState | undefined
  maxOutputTokensRecoveryCount: number
  hasAttemptedReactiveCompact: boolean
  maxOutputTokensOverride: number | undefined
  pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined
  stopHookActive: boolean | undefined
  turnCount: number
  // Why the previous iteration continued. Undefined on first iteration.
  transition: Continue | undefined
}
```

拆解：`while (true)` 没有循环变量，轮与轮之间要传的东西全装进 `State`。真正要盯住的只有两个字段：`messages`（下一轮发给模型的历史，每轮末尾重建，见 2.6）和 `turnCount`（第几轮，276 行初始化为 1，防死循环的 `maxTurns` 检查在 1705 行拿它比较）。其余字段都是「错误恢复的记账本」：压缩失败几次、有没有试过 413 恢复、上一轮为什么 continue（`transition`，测试用它断言恢复路径，不解析消息内容）。

### 2.2 循环头：每轮先「拆包」（307–321）

```ts
// query.ts:307-321
  while (true) {
    // Destructure state at the top of each iteration. toolUseContext alone
    // is reassigned within an iteration (queryTracking, messages updates);
    // the rest are read-only between continue sites.
    let { toolUseContext } = state
    const {
      messages,
      autoCompactTracking,
      maxOutputTokensRecoveryCount,
      hasAttemptedReactiveCompact,
      maxOutputTokensOverride,
      pendingToolUseSummary,
      stopHookActive,
      turnCount,
    } = state
```

拆解三个细节：注释强调 `toolUseContext` 单独用 `let`，因为它在本轮内会被整体重建（360–363 加 `queryTracking`、546–549 换 `messages`），其余字段本轮只读；306 行的 `eslint-disable-next-line no-constant-condition` 是刻意关闭 linter 的「条件恒真」警告——恒真就是设计，退出靠 `return`；解构出的 `messages` 是**上一轮结束时**的，本轮真正发出去的是马上要算的 `messagesForQuery`（最经典的误读点，见第 7 节）。

### 2.3 每轮第二件事：算出「真正要发」的消息（365）

```ts
// query.ts:365
    let messagesForQuery = [...getMessagesAfterCompactBoundary(messages)]
```

一行，但它是后面 100 行加工的起点：工具结果预算（379–394）→ snip（400–410）→ microcompact（414–419）→ collapse（440–447）→ autocompact（454–467），层层处理完都写回 `messagesForQuery`。系统提示词也在这段旁边拼好：

```ts
// query.ts:449-451
    const fullSystemPrompt = asSystemPrompt(
      appendSystemContext(systemPrompt, systemContext),
    )
```

到这里，一轮的**输入**确定了：`messagesForQuery` + `fullSystemPrompt` + 工具清单（`toolUseContext.options.tools`）。

### 2.4 发给 API、收响应（654–664、826–845）

```ts
// query.ts:654-661（内层 while 只管「换模型重试」，见 L4-B4）
      while (attemptWithFallback) {
        attemptWithFallback = false
        try {
          let streamingFallbackOccured = false
          queryCheckpoint('query_api_streaming_start')
          for await (const message of deps.callModel({
            messages: prependUserContext(messagesForQuery, userContext),
            systemPrompt: fullSystemPrompt,
```

`deps.callModel` 就是最终调 API 的地方（真正实现是 `services/api/claude.ts`，L4-B3 的教材）。它返回的是**异步生成器**：一条条消息边生成边吐出来，`for await` 逐条收。收的循环里（708–863）做三件事：给界面 `yield`、把 assistant 消息存进 `assistantMessages`、找 `tool_use` 块：

```ts
// query.ts:826-835
            if (message.type === 'assistant') {
              assistantMessages.push(message)

              const msgToolUseBlocks = message.message.content.filter(
                content => content.type === 'tool_use',
              ) as ToolUseBlock[]
              if (msgToolUseBlocks.length > 0) {
                toolUseBlocks.push(...msgToolUseBlocks)
                needsFollowUp = true
              }
```

`needsFollowUp = true`——**整个循环唯一的「继续信号」**，全文件只有这一处（834 行）会把它置真。为什么不看 API 返回的 `stop_reason`？源码作者在 553–556 行留了注释：`stop_reason === 'tool_use' is unreliable`（不可靠），所以改成「流里真的出现过 tool_use 块才算数」。

### 2.5 退出条件：没有 tool_use 就 return（1062、1357）

```ts
// query.ts:1062-1063
    if (!needsFollowUp) {
      const lastMessage = assistantMessages.at(-1)
```

`!needsFollowUp` 这个大块（1062–1358）里挤满了恢复逻辑：413 超长先试压缩（1085–1183）、输出被截断就注入「接着说」（1188–1256）、stop hook 拦截（1267–1306）。全部失败或不存在后，走到最后：`return { reason: 'completed' }`（1357）。这就是**正常的退出点**：模型这轮纯文本回答、没调任何工具 → 循环结束，把控制权还给用户。除此之外循环还有 11 个 `return` 站点，全部带 `reason` 标签（清单见第 8 节 grep 输出）。

### 2.6 有 tool_use：执行工具（1380–1401）

```ts
// query.ts:1380-1382
    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)

// query.ts:1395-1400（1384-1394 的 hook 拦截判断略）
        toolResults.push(
          ...normalizeMessagesForAPI(
            [update.message],
            toolUseContext.options.tools,
          ).filter(_ => _.type === 'user'),
        )
```

拆解：

1. 两条路：流式执行器（响应还在流的时候就已经开始跑工具，96 行 import 的 `StreamingToolExecutor`）或经典的 `runTools` 一次性执行。初学只看后者这条线。
2. `runTools` 的签名在 `toolOrchestration.ts:19-24`，四个参数里 `canUseTool` 排第三——它是从 `query.ts:186`（`QueryParams` 的字段）一路传进来的，`query.ts:1382` 正是传递现场。权限检查的完整链路下一节展开。
3. `filter(_ => _.type === 'user')`：工具结果被规范化成 **user 角色**的消息（内容是 `tool_result` 块）。回灌的角色是 user，不是 assistant——API 协议规定 tool_result 必须挂在 user 消息上（1535–1536 行的注释警告：不能让 tool_result 和普通 user 消息交错，否则 API 直接报错）。

### 2.7 回灌：拼出下一轮（1715–1729）

```ts
// query.ts:1715-1729
    const next: State = {
      messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
      toolUseContext: toolUseContextWithQueryTracking,
      autoCompactTracking: tracking,
      turnCount: nextTurnCount,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false,
      pendingToolUseSummary: nextPendingToolUseSummary,
      maxOutputTokensOverride: undefined,
      stopHookActive,
      transition: { reason: 'next_turn' },
    }
    state = next
  } // while (true)
}
```

回灌就一行：`messages = 上一轮输入 + 模型这轮说的话 + 工具结果`。三段拼接的顺序就是 API 要求的顺序：assistant（含 tool_use）之后必须紧跟 user（含 tool_result）。`state = next` 之后代码自然落回循环底，进入下一轮 `while (true)`——没有显式 `continue`，这是主路径；错误恢复路径则在各处 `state = next; continue`（如 1114–1115、1304–1305）。

---

## 3. 主循环伪代码：过关标准答案

合上书，默写这 9 行（这是 [docs/00-零基础学习路线.md](../00-零基础学习路线.md) L4-B 的过关题）：

```text
1  取出 state.messages（上一轮的完整历史）
2  算 messagesForQuery：裁剪 + 四层压缩，拼好 fullSystemPrompt
3  把 messagesForQuery 发给 API，流式逐条收响应
4  收到 assistant 消息：存入 assistantMessages；
   其中有 tool_use 块 → 存入 toolUseBlocks，置 needsFollowUp = true
5  needsFollowUp 为假 → 处理 stop hook 后 return 'completed'，循环结束
6  needsFollowUp 为真 → runTools 执行每个工具（执行前先过 canUseTool 权限检查）
7  收集工具结果 → 规范成 user 角色的 tool_result，存入 toolResults
8  next.messages = [...messagesForQuery, ...assistantMessages, ...toolResults]
9  state = next，回到第 1 步
```

标准答案里的两个易丢分点：第 2 步「压缩」不能漏（消息不是原样发出的）；第 6 步括号里的「权限检查」就是下一节的答案。

---

## 4. 三轮推演：消息列表怎么变

假设你问「帮我在 a.ts 里加个日志」，模型先读文件再改文件：

| 轮 | 循环开头 `state.messages` | API 返回 | 轮末 `next.messages`（= 下一轮开头） |
| --- | --- | --- | --- |
| 1 | `[user: 帮我加日志]` | assistant：text「先看看文件」+ `tool_use: Read` | `[user, assistant(text+Read), user(tool_result=文件内容)]` |
| 2 | 同上（3 条） | assistant：text「找到了」+ `tool_use: Edit` | `[user, assistant, user(tool_result), assistant(text+Edit), user(tool_result=编辑成功)]` |
| 3 | 同上（5 条） | assistant：纯 text「加好了」，**无 tool_use** | —— 不再拼 next，`return 'completed'`（1357） |

三个观察：①列表只增不减（「减」是压缩层的事，发生在每轮开头、发送之前）；②每一对 `assistant(含 tool_use)` 后面紧跟 `user(tool_result)`，配对不能乱；③退出不看轮数、不看 stop_reason，只看**这轮响应里有没有 tool_use 块**。

---

## 5. 权限检查插在第几步

答：**第 6 步内部、每个工具真正执行之前的第一道闸门**。它不在 `query.ts` 里，也不在发请求之前——`while` 循环 1,423 行里没有任何一行权限代码。链路是：

```text
query.ts:186   canUseTool: CanUseToolFn        ← 权限函数作为参数从外面传进来
query.ts:1382  runTools(..., canUseTool, ...)  ← 第 6 步把它递给工具编排器
toolOrchestration.ts:22                        ← 再传给串行/并发执行器
toolExecution.ts:599  checkPermissionsAndCallTool(..., canUseTool, ...)
                   ↑ 每个工具执行前都过这里：zod 校验输入 → canUseTool
                     给出 allow / deny / ask → deny 就不执行，回灌一条错误 tool_result
```

`checkPermissionsAndCallTool` 的签名（`toolExecution.ts:599-613`）里 `canUseTool` 是第 5 个参数——权限三态判定逻辑本身在 `utils/permissions/`（[docs/08](../08-权限与安全.md) 与 L4-C 层的主角；执行链路上的几道关 [L4-A4](./L4-A4-工具调用的几道关.md) 已读过前 300 行），主循环只负责「把闸门递到执行现场」。这个分层是有意为之：**循环管节奏，执行层管安全**，权限挂在「执行」而非「循环」，才能覆盖流式执行（工具在模型还在吐字时就开始跑）与普通执行两条路。

---

## 6. 核心问题解答

[docs/00-零基础学习路线.md](../00-零基础学习路线.md) L4-B 的 B-1 卡片问：「`while (true)`——Agent 的本质就是这 8 行」。完整回答分三问。**一问：每一轮的输入是什么？** `messagesForQuery`（上一轮末尾拼好的历史，经压缩层加工）+ `fullSystemPrompt` + 工具清单 + 权限函数 `canUseTool`；首轮 `state.messages` 就是用户那句话（268–269 行 `messages: params.messages`）。**二问：退出条件是什么？** 严格说不是「条件」而是 12 个 `return` 站点，每个都带 `reason` 标签；正常退出只有一条路——本轮响应无 `tool_use` → `needsFollowUp` 为假 → 走完 stop hook 与预算检查 → `return { reason: 'completed' }`（1357），其余 11 个站点全是异常出口。**三问：tool_use 回灌时消息列表怎么变？** 一句话：`next.messages = [...messagesForQuery, ...assistantMessages, ...toolResults]`（1716），assistant 的 tool_use 与 user 的 tool_result 必须成对相邻，且 tool_result 挂在 user 角色上（三轮推演见第 4 节）。

---

## 7. 常见误读

**误读一：「`while (true)` 是死循环，靠抛异常出去。」** 恰好相反。循环唯一的出口设计是 `return`，12 个站点全部显式、全部带 `reason` 标签；异常反而是兜底（955–997 行 catch 之后也规整成 `return { reason: 'model_error' }`）。`reason` 标签组成了 `Terminal` 类型，测试直接断言它们。

**误读二：「发出去的消息就是 `state.messages`。」** 不是。解构出的 `messages`（313 行）只是原料，真正发出去的是 `messagesForQuery`（365 行起），中间隔了裁剪 + 四层压缩。批注版在 673 行附近专门警告过这一点。第二轮之后 `state.messages` 才被 `next` 覆盖成「已发送的 `messagesForQuery` + 新消息」。

**误读三：「权限检查在发请求前，写在 query.ts 里。」** `query.ts` 全文没有权限判定逻辑；`canUseTool` 只是过路参数，真正执行判定在 `toolExecution.ts:599` 的 `checkPermissionsAndCallTool`，时机是**第 6 步、每个工具执行前**。所以模型「想调用」危险工具和「能执行」危险工具之间，隔着一整层用户可见的许可 UI。

---

## 8. 动手验证

在仓库根目录跑（输出均为实跑结果）：

```bash
# 1. 找到主循环本体：开头 + 结尾各一处（654 行那个是内层重试循环，条件不是 true）
$ grep -n "while (true)" source/src/query.ts
307:  while (true) {
1728:  } // while (true)

# 2. 数一数出口：12 个 return 站点，reason 就是循环的「结局清单」
$ grep -n "return { reason" source/src/query.ts
646:        return { reason: 'blocking_limit' }
977:        return { reason: 'image_error' }
996:      return { reason: 'model_error', error }
1051:      return { reason: 'aborted_streaming' }
1175:        return { reason: isWithheldMedia ? 'image_error' : 'prompt_too_long' }
1182:        return { reason: 'prompt_too_long' }
1264:        return { reason: 'completed' }
1279:        return { reason: 'stop_hook_prevented' }
1357:      return { reason: 'completed' }
1515:      return { reason: 'aborted_tools' }
1520:      return { reason: 'hook_stopped' }
1711:      return { reason: 'max_turns', turnCount: nextTurnCount }

# 3. 「继续信号」只在一处置真
$ grep -n "needsFollowUp = true" source/src/query.ts
834:                needsFollowUp = true

# 4. 权限检查的入口（配合第 5 节）
$ grep -n "async function checkPermissionsAndCallTool" source/src/services/tools/toolExecution.ts
599:async function checkPermissionsAndCallTool(
```

批注版读者注意：批注版同一个循环在 673 行（`grep -n "while (true)" annotated/src/query.ts` 得 673 与 3271），行号偏移是因为代码之间插了中文注解。

---

## 9. 合书自测

1. 循环每一轮的**输入**是哪四样东西？首轮的 `state.messages` 从哪来？
<details><summary>答案</summary>messagesForQuery（经裁剪与压缩的发送历史）、fullSystemPrompt、工具清单 toolUseContext.options.tools、canUseTool。首轮 messages 来自 params.messages（268–269 行），即用户那句话。</details>

2. 「继续下一轮」的信号是谁？在哪一行置真？为什么不看 API 的 `stop_reason`？
<details><summary>答案</summary>needsFollowUp；只有 834 行一处（响应里真的出现了 tool_use 块）。553–556 行注释明说 stop_reason === 'tool_use' 不可靠、不总被正确设置，所以以流中实际出现的 tool_use 块为准。</details>

3. 工具结果以什么**角色**回灌？摘出 1716 行的拼接式。
<details><summary>答案</summary>user 角色（tool_result 块挂在 user 消息上，1395–1400 行 filter 出 type === 'user'）。拼接式：messages: [...messagesForQuery, ...assistantMessages, ...toolResults]。</details>

4. 权限检查插在伪代码第几步？函数名与文件？主循环文件里有没有权限判定逻辑？
<details><summary>答案</summary>第 6 步「执行工具」内部、每个工具执行之前；toolExecution.ts:599 的 checkPermissionsAndCallTool 调 canUseTool。query.ts 里没有权限判定，canUseTool 只是从 186 行参数一路传到 1382 行。</details>

5. 不用翻书：`max_turns` 防死循环检查用哪个字段？大概在第几步被检查？
<details><summary>答案</summary>state.turnCount（每轮末 +1，1679 行 nextTurnCount = turnCount + 1），在回灌前的 1705–1712 行检查，超了就 return { reason: 'max_turns' }。</details>

6. 第 4 节三轮表里，第 2 轮发给 API 的消息列表有几条？顺序是什么？
<details><summary>答案</summary>3 条：user（用户问题）→ assistant（text + tool_use: Read）→ user（tool_result = 文件内容）。assistant 与它的 tool_result 必须成对相邻。</details>

---

**下一课**：L4-B2 系统提示词拼装——循环第 3 步里那个 `fullSystemPrompt` 是怎么从 2,000 行的文件里拼出来的。：[L4-B2-系统提示词拼装.md](./L4-B2-系统提示词拼装.md)。
