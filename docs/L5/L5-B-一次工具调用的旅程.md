# L5-B · 一次工具调用的旅程：跟着「我要读一个文件」走完全程

> **课时号**：L5-B（L5 全链路毕业课之二，全课程终点）
> **标题**：一次工具调用的旅程——tool_use 从模型响应到回灌消息历史，每一跳的「文件名 + 函数名」
> **⏱ 时长**：半天（约 180 分钟）
> **前置课时**：[L4-B1 while 循环本体](../L4/L4-B1-while循环本体.md)（链路起点：主循环判出 tool_use 那几行）、[L4-A4 工具调用的几道关](../L4/L4-A4-工具调用的几道关.md)（九道关地图，本课逐关验票）、[L4-A1 工具户口本](../L4/L4-A1-工具户口本.md)（Tool 对象的字段）、[08 权限与安全](../08-权限与安全.md)（权限三态章节版；L4-C 精读版尚未上线，权限分层以本文实读为准）
> **教材清单**（每一跳一个文件，行号以 `source/` 原文为准）：
>
> | 跳 | 文件 | 关键函数 |
> | --- | --- | --- |
> | 1 | [`query.ts`](../../source/src/query.ts) | 主循环内判 `tool_use`（826–845） |
> | 2 | [`services/tools/toolOrchestration.ts`](../../source/src/services/tools/toolOrchestration.ts) | `runTools` / `runToolsSerially` / `runToolsConcurrently` |
> | 3 | [`services/tools/toolExecution.ts`](../../source/src/services/tools/toolExecution.ts) | `runToolUse` / `checkPermissionsAndCallTool` |
> | 4 | [`services/tools/toolHooks.ts`](../../source/src/services/tools/toolHooks.ts) | `resolveHookPermissionDecision` |
> | 5 | [`hooks/useCanUseTool.tsx`](../../source/src/hooks/useCanUseTool.tsx) + [`utils/permissions/permissions.ts`](../../source/src/utils/permissions/permissions.ts) | `useCanUseTool` / `hasPermissionsToUseTool` |
> | 6 | [`tools/FileReadTool/FileReadTool.ts`](../../source/src/tools/FileReadTool/FileReadTool.ts) | `checkPermissions` / `validateInput` / `call` |
> | 7 | [`utils/messages.ts`](../../source/src/utils/messages.ts) | `normalizeMessagesForAPI`（1989） |
> | 8 | [`services/api/claude.ts`](../../source/src/services/api/claude.ts) | 下一轮请求（1266） |
>
> **这节课只解决一件事**：说出「一次 Read 至少经过几次权限判定」，并解释为什么有的判定不能被模型说服——然后合上文档，口述 tool_use 的完整往返链路。
> **行号约定**：摘录与 `source/` 原文逐字一致。L4-A4 写于较早版本（toolExecution.ts 当时 1,905 行），本文行号全部按当前实读重新核对。

---

## 1. 链路总图（先背这张，再逐跳验证）

```
模型 SSE 流里出现 tool_use 块（id、name:'Read'、input 的 partial_json 累积）
  ▼
跳1 query.ts 主循环 ─ while(true)(307) 内，826–845 行
  │    filter(type === 'tool_use') → toolUseBlocks；needsFollowUp = true
  ▼
跳2 services/tools/toolOrchestration.ts ─ runTools(19)
  │    partitionToolCalls 分组：只读批 → runToolsConcurrently(152)；写/危险批 → runToolsSerially(118)
  ▼
跳3 services/tools/toolExecution.ts ─ runToolUse(337)
  │  关3  findToolByName(341)；找不到 → 错误 tool_result(400)
  │  关4  zod 形状校验 inputSchema.safeParse(617)
  │  关5  业务校验 tool.validateInput(683)
  │  关6  PreToolUse 钩子 → 关7 权限判定（见跳4）
  │  关8  真正执行 tool.call(1207)
  │  关9  mapToolResultToToolResultBlockParam(1291) + addToolResult(1403)
  ▼
跳4 services/tools/toolHooks.ts ─ resolveHookPermissionDecision(332)
  │    钩子 allow 仍要过规则复查(359)；deny 一票终局(384)
  │    没有钩子裁决 → canUseTool(394)；调用点 toolExecution.ts:921
  ▼
跳5 hooks/useCanUseTool.tsx(28) ─ canUseTool
  │    → permissions.ts hasPermissionsToUseTool：
  │      1a deny 规则(1170) → 1b ask 规则(1183) → 1c 工具自报(1208)
  │      → 1d–1g(1225–1264) → 2a 起的模式与 allow 规则
  │      1c 时 FileReadTool.checkPermissions(398) → filesystem.ts:1030
  │    behavior:'ask' 且不豁免 → 弹权限对话框，等用户点按钮
  ▼
跳6 tools/FileReadTool/FileReadTool.ts ─ call(496)
  │    expandPath 归一 → readFileState 去重(542) → readFileInRange(1022)
  ▼
跳7 toolExecution.ts mapToolResultToToolResultBlockParam(1291)
  │    → { type:'tool_result', tool_use_id, content }
  │    addToolResult(1403) → createUserMessage：挂上 user 角色
  ▼
跳1（回灌）query.ts 1380–1401 收集 toolResults
  │    1715–1727：messages: [...旧历史, ...assistant, ...toolResults]，while 再转一圈
  ▼
跳8 utils/messages.ts normalizeMessagesForAPI(1989)
     → claude.ts(1266) 调它 → tool_result 进下一轮请求体
```

---

## 2. 逐跳精读

### 跳 1｜query.ts：主循环认出 tool_use

```ts
// query.ts:826-833（while (true) 内，收流循环里）
if (message.type === 'assistant') {
  …
  const msgToolUseBlocks = message.message.content.filter(
    content => content.type === 'tool_use',
  ) as ToolUseBlock[]
  if (msgToolUseBlocks.length > 0) {
    toolUseBlocks.push(...msgToolUseBlocks)
    needsFollowUp = true
  }
```
拆解：模型回复在流里以增量到达（L4-B3），`input` 字段是 `partial_json` 一片片拼出来的。拼完的块在这里被「验收」：只要有 tool_use，`needsFollowUp` 置真，`while (true)` 就不会 return。注意 553–556 行的注释：API 的 `stop_reason === 'tool_use'` 不可靠，所以以**流中实际出现的块**为准。数据形状：`ToolUseBlock { id, name:'Read', input:{file_path:…} }`。

### 跳 2｜toolOrchestration.ts：分拨——谁能并行，谁必须排队

```ts
// services/tools/toolOrchestration.ts:19-31（节选）
export async function* runTools(
  toolUseMessages: ToolUseBlock[], …
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext
  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (isConcurrencySafe) {
      …
      for await (const update of runToolsConcurrently(blocks, …)) {
```


拆解：一轮回复可能带**多个** tool_use（比如同时读三个文件）。`partitionToolCalls` 看每个工具的 `isConcurrencySafe` 元数据（L4-A1 的户口本字段）：只读的并发跑（上限见 `getMaxToolUseConcurrency`，默认 10），有副作用的串行。数据形状不变——还是 `ToolUseBlock`，只是排了队。

### 跳 3｜toolExecution.ts：九道关的中枢

```ts
// services/tools/toolExecution.ts:337-349（runToolUse 开头）与 617、683-686
export async function* runToolUse(
  toolUse: ToolUseBlock,
  …
): AsyncGenerator<MessageUpdateLazy, void> {
  const toolName = toolUse.name
  let tool = findToolByName(toolUseContext.options.tools, toolName)
…
const parsedInput = tool.inputSchema.safeParse(input)
…
const isValidCall = await tool.validateInput?.(
  parsedInput.data,
  toolUseContext,
)
```

拆解：关 1 找工具（找不到走关 1b 废弃别名回退，再不行 400 行起 yield 一条 `is_error` 的 tool_result，本跳就结束）；关 3 检查用户是否已按中止；关 4 zod 形状校验——**形状不对的调用不配问权限**（L4-A4 的结论，这里就是代码出处）；关 5 `validateInput` 是每个工具自己的业务校验（FileRead 的在跳 6）。数据形状：`input` 未知形状对象 → zod 解析后的 `parsedInput.data`。

### 跳 4｜toolHooks.ts：钩子裁决与权限的汇合点

```ts
// services/tools/toolHooks.ts:332-340 与 359-362、384-386
export async function resolveHookPermissionDecision(
  hookPermissionResult: PermissionResult | undefined,
  …
): Promise<{ decision: PermissionDecision; input: Record<string, unknown> }> {
  …
  // Hook allow skips the interactive prompt, but deny/ask rules still apply.
  const ruleCheck = await checkRuleBasedPermissions(tool, hookInput, …)
…
if (hookPermissionResult?.behavior === 'deny') {
  …
  return { decision: hookPermissionResult, input }
}
```

拆解：PreToolUse 钩子（用户脚本）可以预先裁决：allow（甚至改写 `updatedInput`）、deny、ask。**钩子 allow 不是免死金牌**——359 行还要复查 deny/ask 规则；钩子 deny 则一票终局。没有钩子裁决（本例默认如此）就落到 `canUseTool`（394 行起）。调用点在 toolExecution.ts:921。数据形状：`PermissionResult { behavior:'allow'|'deny'|'ask', … }`。

### 跳 5｜canUseTool：分层判定，deny 在弹窗之前

```ts
// hooks/useCanUseTool.tsx:28-44（节选）与 permissions.ts:1170-1181、1208-1214
function useCanUseTool(setToolUseConfirmQueue, setToolPermissionContext) {
  …
  t0 = async (tool, input, toolUseContext, …) => new Promise(resolve => {
    const decisionPromise = forceDecision !== undefined ? Promise.resolve(forceDecision) : hasPermissionsToUseTool(tool, input, toolUseContext, assistantMessage, toolUseID);
…
// 1a. Entire tool is denied
const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool)
if (denyRule) {
  return {
    behavior: 'deny',
    …
  }
}
…
// 1c. Ask the tool implementation for a permission result
toolPermissionResult = await tool.checkPermissions(parsedInput, context)
```

拆解：`hasPermissionsToUseTool` 是分层流水线：**1a** 整个工具的 deny 规则 → **1b** ask 规则 → **1c** 工具自报（Read 工具的 `checkPermissions` 在 FileReadTool.ts:398，转手调 `utils/permissions/filesystem.ts:1030` 的 `checkReadPermissionForTool` 做路径规则匹配）→ **1d** 工具拒绝 → **1e** 需要交互的工具 → **1f** 内容级 ask 规则 → **1g** 安全检查（`.git/` 等，连 bypassPermissions 都豁免不了）→ **2a** 起 `bypassPermissions`/模式/allow 规则。全部不命中才返回 `ask`，由 `useCanUseTool` 把对话框推进 `setToolUseConfirmQueue`，Promise 挂起等用户点击。

### 跳 6｜FileReadTool：真正读磁盘

```ts
// tools/FileReadTool/FileReadTool.ts:398-404 与 496-503、542-543、1022
async checkPermissions(input, context): Promise<PermissionDecision> {
  const appState = context.getAppState()
  return checkReadPermissionForTool(
    FileReadTool,
    input,
    …
  )
},
…
async call(
  { file_path, offset = 1, limit = undefined, pages },
  …
) {
  const { readFileState, fileReadingLimits } = context
…
const existingState = dedupKillswitch
  ? undefined : readFileState.get(fullFilePath)
…
await readFileInRange(
```

拆解：`call` 是关 8，在权限判定**之后**才执行（顺序不能反：用户批准的必须是最终参数）。它先查 `readFileState` 去重——同一文件同一范围且 mtime 没变就返回 stub（省缓存 token）；真读走 `readFileInRange`（限长限 token）。数据形状：磁盘字节 → 带 `type:'text'`、行号前缀、大小校验的 `result.data` 对象。

### 跳 7｜回灌：工具输出变成 tool_result 消息

```ts
// services/tools/toolExecution.ts:1291-1295 与 1403-1408
const mappedToolResultBlock = tool.mapToolResultToToolResultBlockParam(
  result.data,
  toolUseID,
)
…
async function addToolResult(toolUseResult: unknown, preMappedBlock?: ToolResultBlockParam) {
  const toolResultBlock = preMappedBlock
    ? await processPreMappedToolResultBlock(…)
    : await processToolResultBlock(tool, toolUseResult, toolUseID)
  const contentBlocks: ContentBlockParam[] = [toolResultBlock]
  …
  resultingMessages.push({
    message: createUserMessage({
      content: contentBlocks,
```
拆解：每个工具自带 `mapToolResultToToolResultBlockParam`（FileRead 把 `result.data` 变成带行号的文本块），包进 `{ type:'tool_result', tool_use_id, content }`；再由 `createUserMessage` 挂到 **user 角色**消息上（`sourceToolAssistantUUID` 记住它回应的是哪条 assistant）。数据形状：工具私有输出 → API 标准的 `ToolResultBlockParam` → `UserMessage`。

### 跳 8｜回到主循环，进下一轮请求

```ts
// query.ts:1380-1382 与 1395-1401、1715-1717
const toolUpdates = streamingToolExecutor
  ? streamingToolExecutor.getRemainingResults()
  : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)
…
toolResults.push(
  …normalizeMessagesForAPI([update.message], …).filter(_ => _.type === 'user'),
)
…
const next: State = {
  messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
…
// utils/messages.ts:1989-1999（下一轮请求前的格式整形）
export function normalizeMessagesForAPI(
  messages: Message[],
  …
): (UserMessage | AssistantMessage)[] {
  const availableToolNames = new Set(tools.map(t => t.name))
```

拆解：`while (true)` 的收尾把三段拼成下一轮历史：**旧历史 + 本轮 assistant（含 tool_use）+ 本轮 tool_result**——assistant 和它的 tool_result 必须成对相邻，否则 API 报 400。`normalizeMessagesForAPI` 做最后的格式整形（剥离虚拟消息、修配对、控制块大小），然后 claude.ts:1266 调它——这就是「下一次请求里 tool_result 长什么样」：`{role:'user', content:[{type:'tool_result', tool_use_id:…, content:'     1\t…'}]}`。

---

## 3. 数据形态变化表

| 跳 | 载体文件 | 数据长什么样 |
| --- | --- | --- |
| 1 | query.ts | SSE 增量拼成的 `ToolUseBlock {id, name:'Read', input:{file_path}}` |
| 2 | toolOrchestration.ts | `ToolUseBlock[]` 按 `isConcurrencySafe` 分成并发批/串行批 |
| 3 | toolExecution.ts | zod 解析后的 `parsedInput.data`（形状合法的输入） |
| 4 | toolHooks.ts | `PermissionResult {behavior, updatedInput?}`（钩子裁决或无） |
| 5 | permissions.ts | 分层判定的 `PermissionDecision`；`ask` 则挂起等用户 |
| 6 | FileReadTool.ts | `result.data {type:'text', file:{filePath, numLines, …}}` |
| 7 | toolExecution.ts | `{type:'tool_result', tool_use_id, content}` → user 角色消息 |
| 8 | query.ts → claude.ts | `state.messages = [...旧历史, ...assistant, ...toolResults]` → 请求体里 `{role:'user', content:[{type:'tool_result',…}]}` |

---

## 4. 常见误读

**误读一：「messages.ts 的 normalizeMessagesForAPI 是这条链的终点」。** 路线图把它排在最后，但 tool_result 消息的**出生地**是 toolExecution.ts 的 `addToolResult`（1403 行）；`normalizeMessagesForAPI` 是「下一轮请求发出前」的格式整形站，属于跳 8 的开头而不是终点。线索没错，时序标错了。

**误读二：L4-A4 的关卡行号照抄会扑空。** L4-A4 写 toolExecution.ts 1,905 行、`runToolUse` 从 415 行起；当前 source 版本是 **1,745 行、337 行**，zod 校验在 617 行（原记 775）、权限判定调用在 921 行（原记 1081）。关卡**顺序与结论不变**，行号以本文实读为准——这正是「以实读为准」这条硬规矩存在的原因。

**误读三：「权限判定只有一次，就在弹窗那一刻」。** 实际至少两层：跳 4 的钩子裁决层（有钩子时；钩子 allow 之后 359 行**还要**复查 deny/ask 规则）和跳 5 的 `hasPermissionsToUseTool`；后者内部又是 1a–1g 的分层串联，其中 1c 还会**再次**进入工具自报（Read 的 `checkPermissions` → filesystem 的路径规则匹配）。弹窗只是 `behavior:'ask'` 的最后出口，不是判定本体。

---

## 5. 动手验证（每跳确认「函数确实被下一跳调用」）

```bash
# 跳1：主循环认出 tool_use 并交给编排层
grep -n "needsFollowUp = true" source/src/query.ts                  # → 837
grep -n "runTools(toolUseBlocks" source/src/query.ts                # → 1382

# 跳2：编排层 import 并调执行层
grep -n "runToolUse\|runToolsSerially\|runToolsConcurrently" source/src/services/tools/toolOrchestration.ts
# → 9 / 66 / 118 / 152

# 跳3→4→5：执行层把权限判定交给钩子汇合层与 canUseTool
grep -n "resolveHookPermissionDecision" source/src/services/tools/toolExecution.ts
# → 127 / 921
grep -n "hasPermissionsToUseTool" source/src/hooks/useCanUseTool.tsx
# → 20 / 37

# 跳5→6：canUseTool 走到的工具自报，与执行入口
grep -n "checkReadPermissionForTool" source/src/tools/FileReadTool/FileReadTool.ts
# → 402
grep -n "await tool.call(" source/src/services/tools/toolExecution.ts
# → 1207

# 跳7：结果变成 tool_result 消息
grep -n "mapToolResultToToolResultBlockParam\|addToolResult(toolOutput" source/src/services/tools/toolExecution.ts
# → 1291 / 1478

# 跳8：回灌拼历史 + 下一轮请求前的整形
grep -n "messages: \[...messagesForQuery" source/src/query.ts       # → 1716
grep -n "normalizeMessagesForAPI(messages" source/src/services/api/claude.ts
# → 1266

# 权限分层 1a–1g 的原文出处
grep -n "// 1a\. \|// 1g\. " source/src/utils/permissions/permissions.ts
# → 1170 / 1252 附近（步骤注释逐条可数）
```

---

## 6. 毕业自测（收口 L4-A/C 工具与权限线）

1. 从 tool_use 到 tool_result 要过哪九道关？权限是第几道，为什么排在执行前、校验后？
<details><summary>答案</summary>找工具（含别名回退）→ 找不到即错误 tool_result → 中止检查 → zod 形状校验 → validateInput 业务校验 → PreToolUse 钩子 → 权限判定 → 执行 → 结果整形回灌。权限是第 7 道：太早判，后面钩子改了输入就「批准了个寂寞」；太晚判，非法输入已经浪费一轮；它是执行前最后一道闸（L4-A4 关卡顺序图）。</details>

2. 一次 Read 至少经过几次权限判定？分别在哪几行代码？
<details><summary>答案</summary>至少两次「判定站」：① 钩子层 toolHooks.ts:921 的 resolveHookPermissionDecision（无钩子时直接落到 canUseTool，394 行）；② canUseTool → useCanUseTool.tsx:37 的 hasPermissionsToUseTool，内部 1a deny 规则（1170）→ 1b ask 规则（1183）→ 1c 工具自报 FileReadTool.ts:398 → filesystem.ts:1030 路径规则匹配 → 1d–1g（1225–1264）→ 2a 起模式与 allow 规则。也就是说 canUseTool 这一站内部本身就是一条分层流水线。</details>

3. 为什么有的判定不能被模型说服？举两处代码证据。
<details><summary>答案</summary>① 1a deny 规则在 permissions.ts:1170 直接 return deny——它根本不产生 ask，没有对话框，模型没有任何「再试一次换个说法」的通道；② 1g 安全检查（.git/ 等路径）连 bypassPermissions 模式都豁免不了；③ 钩子 deny 在 toolHooks.ts:384 一票终局。模型能改的只有输入（换个路径/参数），规则是用户配置的，只有用户改 /permissions 才能解锁。</details>

4. tool_result 为什么挂在 user 角色上？assistant 消息和它的 tool_result 在下一轮历史里必须什么关系？
<details><summary>答案</summary>API 协议规定 tool_result 是 user 消息的 content 块（回应用户对 assistant 工具请求的「答复」）。必须成对相邻：query.ts:1716 的拼接顺序 [...messagesForQuery, ...assistantMessages, ...toolResults] 保证了这一点；乱序会被 claude.ts 的 ensureToolResultPairing 修复或报 400。</details>

5. 多个只读工具和多个写工具同时出现在一轮回复里，执行顺序由谁、按什么决定？第二次读同一个没改过的文件，返回的又是什么？
<details><summary>答案</summary>toolOrchestration.ts 的 partitionToolCalls 按 Tool 元数据 isConcurrencySafe 分组（L4-A1 户口本字段）：只读批进 runToolsConcurrently（152，并发上限默认 10），写/危险批进 runToolsSerially(118)。第一次读同一文件有 readFileState 去重（FileReadTool.ts:542）：同文件同范围且 mtime 未变返回 stub，避免重复全文重发计费 cache_creation（注释引 BQ 数据：约 18% 的 Read 是同文件碰撞）。</details>

---

## 7. 课程毕业标准

对应[零基础学习路线](../00-零基础学习路线.md)第 8 节 L5-B 的验收：**口述「tool_use → 权限 → 执行 → tool_result → 下一轮请求」全链，说出一次 Read 的权限判定次数，并解释为什么有的判定不能被模型说服**。另外一组主线：[L5-A 一句话的旅程](./L5-A-一句话的旅程.md)（stdin → 主循环 → 屏幕）。

### 学完之后去哪

课程到此收官。接下来最好的复习材料是 [`annotated/`](../../annotated/) 里的**任意大文件**——`query.ts`（3,304 行批注）、`services/api/claude.ts`（4,655 行批注）你都已经能定位了。用 L4 学的**选择性精读法**：先 grep 定位函数 → 只读那一段 → 读不懂的再追 import。全读是不可能的，也不必要；能「顺着链路找到该读的那 90 行」，就是这门课想教你的全部。

- 返回：[零基础学习路线 L5 过关标准](../00-零基础学习路线.md)
