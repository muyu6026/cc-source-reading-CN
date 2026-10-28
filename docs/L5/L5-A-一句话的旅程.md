# L5-A · 一句话的旅程：跟着「hello」走完全程

> **课时号**：L5-A（L5 全链路毕业课之一，共 2 课）
> **标题**：一句话的旅程——从键盘到屏幕，全链路每一跳的「文件名 + 函数名」
> **⏱ 时长**：半天（约 180 分钟）
> **前置课时**：[L4-B1 while 循环本体](../L4/L4-B1-while循环本体.md)（链路中段就是它的 `while (true)`）、[L4-B3 SSE 流式解析](../L4/L4-B3-SSE流式解析.md)（响应怎么被切成增量）、[L4-A4 工具调用的几道关](../L4/L4-A4-工具调用的几道关.md)（链路分岔口「有 tool_use 怎么走」，本课只路过）、[08 对话主循环与模型调用](../06-对话主循环与模型调用.md)（章节版速查）
> **教材清单**（每一跳一个文件，行号以 `source/` 原文为准）：
>
> | 跳 | 文件 | 关键函数 |
> | --- | --- | --- |
> | 1 | [`ink/components/App.tsx`](../../source/src/ink/components/App.tsx) | `handleSetRawMode` / `handleReadable` |
> | 2 | [`ink/parse-keypress.ts`](../../source/src/ink/parse-keypress.ts) | `parseMultipleKeypresses` |
> | 3 | [`ink/hooks/use-input.ts`](../../source/src/ink/hooks/use-input.ts) | `useInput` |
> | 4 | [`hooks/useTextInput.ts`](../../source/src/hooks/useTextInput.ts) + [`components/PromptInput/PromptInput.tsx`](../../source/src/components/PromptInput/PromptInput.tsx) | `useTextInput` / `onSubmit` |
> | 5 | [`screens/REPL.tsx`](../../source/src/screens/REPL.tsx) + [`utils/handlePromptSubmit.ts`](../../source/src/utils/handlePromptSubmit.ts) + [`utils/processUserInput/processTextPrompt.ts`](../../source/src/utils/processUserInput/processTextPrompt.ts) | `onQuery` / `handlePromptSubmit` / `processTextPrompt` |
> | 6 | [`utils/messageQueueManager.ts`](../../source/src/utils/messageQueueManager.ts) + [`hooks/useQueueProcessor.ts`](../../source/src/hooks/useQueueProcessor.ts) | `enqueue` / `processQueueIfReady` |
> | 7 | [`query.ts`](../../source/src/query.ts) + [`query/deps.ts`](../../source/src/query/deps.ts) | `query` / `deps.callModel` |
> | 8 | [`services/api/claude.ts`](../../source/src/services/api/claude.ts) + [`utils/messages.ts`](../../source/src/utils/messages.ts) | `queryModelWithStreaming` / `normalizeMessagesForAPI` |
> | 9 | [`ink/reconciler.ts`](../../source/src/ink/reconciler.ts) | `resetAfterCommit` → `onRender` |
>
> **这节课只解决一件事**：合上所有文档，能口述「用户敲 hello 到它变成屏幕上的字」的完整链路，允许跳 2 跳。

> **行号约定**：本文摘录与 `source/` 原文逐字一致，行号为原文行号。`annotated/` 批注版插了中文注解，行号会偏移，验证命令见第 6 节。

---

## 1. 链路总图（先背这张，再逐跳验证）

```
用户按键盘
  │  原始字节（'h' 'e' 'l' 'l' 'o' '\r'，含转义序列）
  ▼
跳1 ink/components/App.tsx ─ handleSetRawMode(210)
  │    stdin.addListener('readable', this.handleReadable)   ← 231 行
  │  handleReadable(332)：stdin.read() 读出字符串 chunk
  ▼
跳2 ink/parse-keypress.ts ─ parseMultipleKeypresses(213)
  │    App.tsx processInput(309) 调它：字节 → ParsedKey 数组
  │  processKeysInBatch(444)：emit('input', event)   ← 507 行
  ▼
跳3 ink/hooks/use-input.ts ─ useInput(订阅 'input' 事件，84 行)
  │    PromptInput/TextInput 各自的 useInput 回调收到 (char, key)
  ▼
跳4 hooks/useTextInput.ts ─ useTextInput
  │    可打印字符 → onChange 拼 input 字符串；key.return → onSubmit   ← 366 / 498 行
  │  components/PromptInput/PromptInput.tsx onSubmit(984)
  ▼
跳5 screens/REPL.tsx ─ onSubmitProp → handlePromptSubmit
  │    utils/handlePromptSubmit.ts handlePromptSubmit(120)
  │    → processUserInput → processTextPrompt(19)
  │    → utils/messages.ts createUserMessage(460)：文本 → UserMessage 对象
  │  空闲：handlePromptSubmit(560) 直接 await onQuery(newMessages, …)
  │  忙碌：REPL.tsx(2877) enqueue → 队列排队，轮空时
  │        hooks/useQueueProcessor.ts processQueueIfReady 取出再走 onQuery
  ▼
跳6 utils/messageQueueManager.ts ─ enqueue(128)（仅模型忙碌时）
  ▼
跳7 query.ts ─ query(219) → queryLoop 内 while(true)(307)
  │    组装 messagesForQuery + fullSystemPrompt + tools
  ▼
跳7（续）query.ts(659) deps.callModel → query/deps.ts productionDeps(21)
  │    实际函数：services/api/claude.ts queryModelWithStreaming(752)
  │    → queryModel(1017)
  │    → normalizeMessagesForAPI(1266，实现在 utils/messages.ts 1989)
  │    → anthropic.beta.messages.create({…, stream: true})   ← 1822 行
  ▼
跳8（续）claude.ts(1940) for await (const part of stream)
  │    SSE 增量 → 拼回完整 AssistantMessage → query yield 事件
  │  REPL.tsx(2793) for await (const event of query(…))
  │    onQueryEvent(2584) → handleMessageFromStream → setMessages
  ▼
跳9 React 状态更新 → ink/reconciler.ts
     createReconciler(224) 做调和，commit 后 resetAfterCommit(247)
     → rootNode.onComputeLayout(278) → rootNode.onRender(304) 画到终端
```

---

## 2. 逐跳精读

### 跳 1｜App.tsx：stdin 的唯一读者（字节 → 字符串 chunk）

```ts
// ink/components/App.tsx:224-231（handleSetRawMode 内）与 343-347（handleReadable 内）
stdin.setEncoding('utf8');
if (isEnabled) {
  // Ensure raw mode is enabled only once
  if (this.rawModeEnabledCount === 0) {
    stdin.ref();
    stdin.setRawMode(true);
    stdin.addListener('readable', this.handleReadable);
…
let chunk;
while ((chunk = this.props.stdin.read() as string | null) !== null) {
  // Process the input chunk
  this.processInput(chunk);
}
```
拆解：`raw mode` 意思是终端不帮你做「回退一格、攒一行」这些处理，按什么键就给什么字节，CC 全权接手。`setEncoding('utf8')` 之后 `stdin.read()` 读到的已经是字符串了，但**一次可能粘着一串按键**（粘贴、快速输入），所以还要进下一跳解析。数据形状：一个可能很长的字符串 chunk。

### 跳 2｜parse-keypress.ts：字符串 → 按键对象

```ts
// ink/components/App.tsx:309-320（processInput）与 505-507（processKeysInBatch 内）
processInput = (input: string | Buffer | null): void => {
  // Parse input using our state machine
  const [keys, newState] = parseMultipleKeypresses(this.keyParseState, input);
  this.keyParseState = newState;
  …
  if (keys.length > 0) {
    reconciler.discreteUpdates(processKeysInBatch, this, keys, undefined, undefined);
  }
…
app.handleInput(sequence);
const event = new InputEvent(item);
app.internal_eventEmitter.emit('input', event);
```

拆解：`'h'` 是一个字符，但 `ESC [ A` 是「上箭头」、`Ctrl+C` 是 `\x03`——把转义序列还原成「一次按键」的活儿由 `parseMultipleKeypresses` 的状态机完成。之后每个按键被包成 `InputEvent`，从事件总线 `emit('input', …)` 广播出去。数据形状：字符串 chunk → `ParsedKey[]`（每个含 `sequence`、`name`、`ctrl` 等字段）。

### 跳 3｜use-input.ts：按键分发给每个组件

```ts
// ink/hooks/use-input.ts:73-79
const { input, key } = event
…
if (!(input === 'c' && key.ctrl) || !internal_exitOnCtrlC) {
  inputHandler(input, key, event)
}
```

拆解：`useInput(cb)` 是 Ink 的公开钩子，84 行 `internal_eventEmitter?.on('input', handleData)` 完成订阅；任何组件都能用，CC 里同时有几十个 `useInput` 在听（页脚、弹窗、输入框……），靠 `isActive`/context 分流。打到输入框的字符下一跳才会被「攒起来」。数据形状：`(input: string, key: Key)` 二元组，input 通常是单字符。

### 跳 4｜useTextInput + PromptInput：攒成一行，回车提交

```ts
// hooks/useTextInput.ts:366-368 与 490-499（节选）
case key.return:
  // Must come before key.meta so Option+Return inserts newline
  return () => handleEnter(key)
…
if (
  filteredInput.length > 1 &&
  filteredInput.endsWith('\r') &&
  …
) {
  onSubmit?.(nextCursor.text)
}
```

拆解：`useTextInput` 维护 `value`（当前 input 字符串）与光标位置；普通字符走 `onChange` 把字符拼进字符串——**这就是「按键变成一行文本」的那一跳**。按下 Return 且不在多行续行模式，调 `onSubmit(整串文本)`。`PromptInput.tsx:984` 的 `onSubmit` 接住，经一系列前置检查（斜杠命令、建议列表、stashed 输入……）后最终把文本交给 `onSubmitProp`，即 REPL 传入的提交处理器。数据形状：一个普通字符串 `"hello"`。

### 跳 5｜REPL + handlePromptSubmit + processTextPrompt：文本 → 消息对象

```ts
// utils/processUserInput/processTextPrompt.ts:19-28
export function processTextPrompt(
  input: string | Array<ContentBlockParam>,
  imageContentBlocks: ContentBlockParam[],
  imagePasteIds: number[],
  …
): {
  messages: (UserMessage | AttachmentMessage | SystemMessage)[]
  shouldQuery: boolean
} {
```

```ts
// utils/processUserInput/processTextPrompt.ts:89-96
const userMessage = createUserMessage({
  content: input,
  uuid,
  permissionMode,
  isMeta: isMeta || undefined,
})

return {
  messages: [userMessage, ...attachmentMessages],
  shouldQuery: true,
}
```

拆解：`createUserMessage`（`utils/messages.ts:460`）把字符串包成带 `uuid`、时间戳、`message: { role: 'user', content: [...] }` 的**消息对象**。这是数据第一次长出「API 的形状」。之后两条路：模型空闲时 `handlePromptSubmit.ts:560` 直接 `await onQuery(newMessages, …)`；模型忙时，REPL.tsx:2877 先 `enqueue` 进队列。数据形状：字符串 → `UserMessage` 对象（JSON 可序列化）。

### 跳 6｜队列：忙时的候车室

```ts
// utils/messageQueueManager.ts:128-134
export function enqueue(command: QueuedCommand): void {
  commandQueue.push({ ...command, priority: command.priority ?? 'next' })
  notifySubscribers()
  logOperation(
    'enqueue',
    typeof command.value === 'string' ? command.value : undefined,
  )
}
```

拆解：队列是**模块级单例**（不挂在 React 上），三级优先级 `now > next > later`（见 154–158 行 `PRIORITY_ORDER`）——用户输入永远压过系统通知。模型闲下来时 `hooks/useQueueProcessor.ts` 的 `processQueueIfReady` 出队，重新走一遍跳 5 的提交路径。`hooks/useCommandQueue.ts` 只是一个 15 行的只读订阅 hook（`useSyncExternalStore`），让 UI 能显示「队列里有 N 条」——**它不搬运数据**。数据形状：`QueuedCommand { value, priority, mode }`。

### 跳 7｜query.ts：主循环拿到消息，组装请求

```ts
// query.ts:659-667（query(219) 定义、while (true)(307) 之内）
for await (const message of deps.callModel({
  messages: prependUserContext(messagesForQuery, userContext),
  systemPrompt: fullSystemPrompt,
  thinkingConfig: toolUseContext.options.thinkingConfig,
  tools: toolUseContext.options.tools,
  signal: toolUseContext.abortController.signal,
  options: {
```

拆解：REPL.tsx:2793 的 `for await (const event of query({ messages, systemPrompt, … }))` 把整轮对话历史、系统提示词、工具清单交给 `query()`。注意 `deps.callModel` 不是直接 import——`query/deps.ts:21` 的 `productionDeps()` 把真实函数 `queryModelWithStreaming` 注入进来，测试可以换成假模型。这一跳里消息还会经过压缩/裁剪（L3-04），形状不变、条数变少。

### 跳 8｜claude.ts：消息数组 → HTTP 请求体 → SSE 增量

```ts
// services/api/claude.ts:1822-1829 与 1940（normalizeMessagesForAPI 调用在 1266 行）
let messagesForAPI = normalizeMessagesForAPI(messages, filteredTools)
…
const result = await anthropic.beta.messages
  .create(
    { ...params, stream: true },
    {
      signal,
      …
    },
…
for await (const part of stream) {
```

拆解：`normalizeMessagesForAPI`（实现在 `utils/messages.ts:1989`）把 CC 内部丰富的消息类型（附件、虚拟消息、合成错误……）收敛成 API 认识的 `[{role, content}]`。`stream: true` 让响应变成 SSE 事件流：`message_start` → `content_block_delta`（文字一片片来）→ `message_stop`（L4-B3 逐字读过）。拼回完整 `AssistantMessage` 后由 `query()` `yield` 出去。数据形状：消息对象数组 → 请求体 JSON → SSE 增量 → 完整助手消息。

### 跳 9｜reconciler.ts：React 状态 → 屏幕

```ts
// ink/reconciler.ts:224-226 与 277-278、304（resetAfterCommit 内）
const reconciler = createReconciler<
  ElementNames,
  Props,
…
if (typeof rootNode.onComputeLayout === 'function') {
  rootNode.onComputeLayout()
}
…
rootNode.onRender?.()
```

拆解：`setMessages` 触发 React 重渲染，但 React 不知道终端是什么——`reconciler.ts` 就是 React 的「终端后端」：它把组件树变成 `DOMElement` 树（`ink/dom.ts`），commit 完成时 `resetAfterCommit` 先用 Yoga 算布局，再调 `rootNode.onRender()` 把整棵树渲染成 ANSI 字符串写到 stdout。至此，「hello」从按键回到你的屏幕。数据形状：React 元素树 → 布局后的节点树 → 终端字符流。

---

## 3. 数据形态变化表

| 跳 | 载体文件 | 数据长什么样 |
| --- | --- | --- |
| 1 | App.tsx | 原始字节流 → utf8 字符串 chunk（可能粘一串键） |
| 2 | parse-keypress.ts | `ParsedKey[]`：`{sequence:'h', name:'h', ctrl:false, …}` |
| 3 | use-input.ts | `(input:'h', key:Key)`，按组件分发 |
| 4 | useTextInput.ts | `value:"hello"`：字符逐个拼进字符串，Return 触发 `onSubmit("hello")` |
| 5 | processTextPrompt.ts | `UserMessage { message:{role:'user', content:[{type:'text', text:'hello'}]}, uuid }` |
| 6 | messageQueueManager.ts | （仅忙时）`QueuedCommand { value:'hello', priority:'next' }` |
| 7 | query.ts | `messagesForQuery`：UserMessage + 历史消息数组 |
| 8 | claude.ts | 请求体 `{model, messages, system, stream:true}` → SSE `content_block_delta` 片段 → `AssistantMessage` |
| 9 | reconciler.ts | React 元素树 → Yoga 布局树 → ANSI 终端字符串 |

---

## 4. 常见误读

**误读一：「useCommandQueue 把按键变成一行文本」。** 路线图线索链把 `hooks/useCommandQueue.ts` 放在第二跳，实读发现它只有 15 行：一个 `useSyncExternalStore` 只读订阅器，给 UI 显示队列长度用。真正「攒字符成行」的是 `hooks/useTextInput.ts`；队列（`messageQueueManager.ts`）只在**模型忙时**才接住提交，空闲路径根本不进队列。线索没错，但职能标错了位置。

**误读二：「query.ts → services/api/claude.ts」是直连。** 中间还有一层：`query.ts:659` 调的是 `deps.callModel`，由 `query/deps.ts` 的 `productionDeps()` 注入真实的 `queryModelWithStreaming`（依赖注入，为了测试时替换假模型）。顺带一提，`annotated/` 里**没有** `query/deps.ts` 的批注版（`annotated/src/query/` 目录不存在），这层只能读原文。

**误读三：「reconciler.ts 是渲染的最后一跳」。** 它只是 React 调和器——把组件树变成内部节点树。真正画屏的是它 commit 后回调的 `rootNode.onRender()`（304 行），实现在 `ink/render-to-screen.ts` 一族里。另外整条链路的中枢 `screens/REPL.tsx`（5,005 行，队列出队、onQuery、事件回流都在它身上）**没有出现在路线图线索里**，批注版里也没有它——两个版本都只能读原文。

---

## 5. 动手验证（每跳确认「函数确实被下一跳调用」）

```bash
# 跳1-2：stdin 监听 → 解析 → 广播，全在 App.tsx
grep -n "addListener('readable'\|parseMultipleKeypresses\|emit('input'" source/src/ink/components/App.tsx
# → 231 / 311 / 507

# 跳3-4：useInput 订阅跳2 的事件；回车触发 onSubmit
grep -n "on('input'" source/src/ink/hooks/use-input.ts          # → 84
grep -n "case key.return" source/src/hooks/useTextInput.ts      # → 366

# 跳5：文本变消息、交给 onQuery
grep -n "createUserMessage" source/src/utils/processUserInput/processTextPrompt.ts  # → 11 / 75 / 89
grep -n "await onQuery(" source/src/utils/handlePromptSubmit.ts                     # → 560

# 跳6-7：队列出队后仍走提交路径；REPL 把消息交给 query()
grep -n "processQueueIfReady" source/src/hooks/useQueueProcessor.ts                 # → 11 / 56
grep -n "for await (const event of query({" source/src/screens/REPL.tsx             # → 2793

# 跳7-8：deps 注入真实模型函数；请求体真的开了流
grep -n "queryModelWithStreaming" source/src/query/deps.ts    # → 2 / 21 / 27
grep -n "stream: true" source/src/services/api/claude.ts      # → 1823（非流式路径 864 附近）

# 跳9：commit 后回调画屏
grep -n "rootNode.onRender" source/src/ink/reconciler.ts      # → 304

# 批注版行号对拍：同一 while 在原文 307、批注版 673/3271
grep -n "while (true)" annotated/src/query.ts                 # → 673 / 3271
```

---

## 6. 毕业自测（收口 L4-B 主循环线）

1. `query()` 每一轮（`while (true)` 一次迭代）的输入是哪四样？首轮的 `messages` 从哪来？
<details><summary>答案</summary>messagesForQuery（发送历史）、fullSystemPrompt、工具清单 `toolUseContext.options.tools`、`canUseTool`。首轮 messages 来自 `params.messages`——即跳 5 里 `createUserMessage` 造出的那条 UserMessage 连同历史（见 L4-B1 第 2.1 节 State 拆解）。</details>

2. 模型的回复怎么「流」回来？SSE 的哪三类事件构成了文字消息？
<details><summary>答案</summary>claude.ts:1940 的 `for await (const part of stream)` 逐事件读：`message_start`（取 usage/元数据）、`content_block_delta`（`text_delta` 拼正文）、`message_stop`（收尾）。拼完的 AssistantMessage 由 `query()` yield，REPL.tsx:2802 `onQueryEvent` 接住（L4-B3）。</details>

3. 「hello」这句话如果模型只回文字不调工具，`while (true)` 怎么退出？
<details><summary>答案</summary>本轮没有产生 tool_use 块，`needsFollowUp` 保持 false，循环走到 return（1062/1357 行附近），`query()` 生成器结束，REPL 的 `for await` 自然结束，进入跳 9 渲染（L4-B1 第 2.5 节）。</details>

4. 模型回复的「hello 的回答」和用户排队输入的第二句话，谁先上屏？为什么？
<details><summary>答案</summary>回复先。排队输入在队列里是 `QueuedCommand`，`useQueueProcessor` 要等 `queryGuard` 显示查询结束才出队，出队后重新走跳 5——它是「下一轮 query 的起点」，不是本轮渲染的一部分。</details>

5. `deps.callModel` 为什么要绕一层依赖注入而不是直接 `import`？
<details><summary>答案</summary>`query/deps.ts` 头注：测试注入假依赖代替「每个测试文件对模块做 spyOn」的样板代码；`productionDeps()` 用 `typeof fn` 保持签名同步。代价是初读链路会「断」一跳——这也是它进了本文误读清单的原因。</details>

6. 从跳 5 到跳 7，消息内容被「改写」过几次？分别在哪？
<details><summary>答案</summary>至少三处：① `processTextPrompt` 把字符串包成 UserMessage 并追加附件消息；② `query()` 内压缩/裁剪把 `messagesForQuery` 变短（L3-04）；③ claude.ts `normalizeMessagesForAPI` 把内部消息类型收敛成 API 格式。文本 `"hello"` 本身始终原样。</details>

---

## 7. 课程毕业标准

对应[零基础学习路线](../00-零基础学习路线.md)第 8 节 L5-A 的验收：**不看文档，口述「键盘 → 屏幕」全链路，允许跳过 2 跳以内**；每一跳能说出「文件名 + 函数名 + 数据在这里变成了什么形状」。做不到，回到第 1 节总图，从错的那跳重读。

- 全链路另一条线（工具调用）：[L5-B 一次工具调用的旅程](./L5-B-一次工具调用的旅程.md)
- 返回：[零基础学习路线 L5 过关标准](../00-零基础学习路线.md)
