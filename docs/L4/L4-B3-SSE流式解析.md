# L4-B3 · SSE 流式解析——流式返回到底长什么样

> **课时号**：L4-B3　**标题**：SSE 流式解析——流式返回到底长什么样
> **⏱ 时长**：35 分钟　**前置课时**：[01 篇 1.6 节「一次完整交互的 15 步」](../01-项目总览与架构.md)、[06 对话主循环与模型调用](../06-对话主循环与模型调用.md)（同层的 L4-B1/B2 待上线，本文不依赖它们）
> **教材清单**：
> - 批注版：[`annotated/src/services/api/claude.ts`](../../annotated/src/services/api/claude.ts)——全文件 4,655 行，**只读 5 段**：2384–2410、2478–2534、2632–2730、2744–2815、2828–3183，合计约 500 行，其余 4,000 行与「流长什么样」无关
> - SDK 原文（第一层解析在 SDK 里）：[`source/node_modules/@anthropic-ai/sdk/core/streaming.mjs`](../../source/node_modules/@anthropic-ai/sdk/core/streaming.mjs) 第 12–60 行
> - 路线图卡片写「3,419 行」：那是 `source/` 原文行数；批注版被中文批注撑到了 4,655 行。**本文所有行号以批注版实际为准**（批注版文件头注释里写的 1932–2403 等旧行号已经漂移，别信它，信你 grep 到的）。
>
> **这节课只解决一件事**：拆开「流式返回」的三个层次——HTTP 分块 → SSE 事件 → 内容增量——看清 CC 在每一层各做什么，以及它和 1.6 节「15 步」的第 6/7 步怎么衔接。

---

## 1. 全文地图：4,655 行里你只需要这 5 段

`claude.ts` 是整个代码库最大的单文件，头注释自己就承认「不要顺序读」。按**实际行号**（grep 验证过）重新分段：

| 段 | 行号（批注版） | 内容 | 初学 |
| --- | --- | --- | --- |
| ① 组装 | 1017–1729 | 查开关、拉 betas、滤工具、拼 system | **跳过**（长但没有分支难度） |
| ② 参数工厂 | 1730–2403 | `paramsFromContext`：一次请求的全部参数 | 跳过 |
| ③ 发请求 | 2412–2517 | `withRetry` 包住，拿到 raw stream | **精读 2478–2517** |
| ④ 解析流 | 2632–3183 | `for await` + 一个大 switch | **全读**（本课核心） |
| ⑤ 降级与收尾 | 3189–4600+ | 流挂了→非流式重试→记日志→释放资源 | 跳过（重试侧见 L4-B4） |

先定位现场，不要翻页找：

```bash
grep -n "case 'message_start'\|case 'content_block_start'\|case 'content_block_delta'\|case 'content_block_stop'\|case 'message_delta'\|case 'message_stop'" annotated/src/services/api/claude.ts
```

实际输出（去掉批注行后就是 switch 的骨架）：

```
2716:          case 'message_start': {
2744:          case 'content_block_start':
2828:          case 'content_block_delta': {
2990:          case 'content_block_stop': {
3043:          case 'message_delta': {
3166:          case 'message_stop':
```

六个 case，从 2716 到 3170，就是「流式解析」的全部。外面一圈是看门狗和 stall 检测（2462 行附近、2662 行附近），里面一圈是每个 delta 的类型细分。

---

## 2. 「流式」的三个层次

初学者常把「流式」当成一件事，其实是三层套娃：

1. **HTTP 分块（chunked transfer）**：网络层的事。服务器一小段一小段地推字节。这一层 CC 完全不碰，交给 `fetch`。
2. **SSE 事件（Server-Sent Events）**：文本协议层。字节流里混着 `event: xxx` 和 `data: {...}` 行，要按空行切分、按行解析。这一层在 **SDK 里**，不在 CC 代码里。
3. **内容增量（delta）**：业务层。每个事件携带一小片内容（几个字、半截 JSON），要把碎片拼回完整消息。这一层才是 `claude.ts` 的 switch。

第 2 层的证据，SDK `core/streaming.mjs` 第 241–257 行（逐字摘录）：

```js
    decode(line) {
        if (line.endsWith('\r')) {
            line = line.substring(0, line.length - 1);
        }
        if (!line) {
            // empty line and we didn't previously encounter any messages
            if (!this.event && !this.data.length)
                return null;
            const sse = {
                event: this.event,
                data: this.data.join('\n'),
                raw: this.chunks,
            };
```

这就是「SSE 解析」的真身：一个 `SSEDecoder` 类，攒 `event:` 和 `data:` 行，遇到空行就把攒的内容打包成一条 `{event, data}`（第 267–272 行只认这两种字段名）。

第 2 层到第 3 层的交界，SDK `core/streaming.mjs` 第 40–48 行（逐字摘录）：

```js
                    if (sse.event === 'message_start' ||
                        sse.event === 'message_delta' ||
                        sse.event === 'message_stop' ||
                        sse.event === 'content_block_start' ||
                        sse.event === 'content_block_delta' ||
                        sse.event === 'content_block_stop') {
                        try {
                            yield JSON.parse(sse.data);
```

SDK 把 6 种事件名的 `data` 行 `JSON.parse` 后 yield 出来——CC 拿到的 `part` 已经是 JS 对象，不再是文本。另外两种：`ping` 直接跳过（第 55–57 行），`error` 直接抛 `APIError`（第 58–60 行）。

---

## 3. 精读正文（批注版逐字摘录 + 拆解）

### 3.1 出发前：半成品状态（2384–2410 行）

```ts
  const newMessages: AssistantMessage[] = []
  let ttftMs = 0
  let partialMessage: BetaMessage | undefined = undefined
  const contentBlocks: (BetaContentBlock | ConnectorTextBlock)[] = []
  let usage: NonNullableUsage = EMPTY_USAGE
  let stopReason: BetaStopReason | null = null
```

批注把这十几个变量叫「流解析的半成品状态」（2386 行）：`partialMessage` 是 `message_start` 给的骨架，`contentBlocks` 按 index 存放正在长大的块。为什么它们不能是函数局部变量？因为要**跨几十个事件存活**，还要在 catch/finally 里被读到（2395 行批注）。

### 3.2 为什么不用官方封装（2478–2507 行）

```ts
        // Use raw stream instead of BetaMessageStream to avoid O(n²) partial JSON parsing
        const result = await anthropic.beta.messages
          .create(
            { ...params, stream: true },
```

官方的 `BetaMessageStream` 会对**每个** `input_json_delta` 做一次部分 JSON 解析——500 个片段就解析 500 遍，O(n²)。CC 的选择：拿 raw stream，碎片只 `+=` 拼字符串，到收口时解析一次。第 3.4 节会看到对应的 `+=`。

### 3.3 主循环骨架（2632–2670 行）

```ts
    try {
      // stream in and accumulate state
      let isFirstChunk = true
      const STALL_THRESHOLD_MS = 30_000 // 30 seconds
      for await (const part of stream) {
        resetStreamIdleTimer()
        const now = Date.now()
```

一个 `for await` + 一个 `switch`（2709 行），结构就这么简单。`resetStreamIdleTimer()` 每块都调：90 秒没收到任何 chunk 就主动 abort（看门狗），30 秒的间隔只记警告（stall 检测）。批注 2669 行点出两者的关系：阈值 30s < 90s，所以日志里「先看到 stall 警告，再看到 idle 超时」。

### 3.4 六个事件分支

**message_start（2716–2729 行）——存骨架、算首字延迟。** 三行核心：`partialMessage = part.message`（骨架，content 为空、output_tokens 为 0）、`ttftMs = Date.now() - start`（衡量服务端响应速度最直接的指标）、`usage = updateUsage(usage, part.message?.usage)`。后面所有内容都往这个骨架上补。

**content_block_start（2744–2801 行）——造空壳。** 关键是 `tool_use` 的 `input` 初始化成**空字符串**而不是 `{}`：

```ts
            switch (part.content_block.type) {
              case 'tool_use':
                contentBlocks[part.index] = {
                  ...part.content_block,
                  input: '',
```

因为 delta 阶段拿到的是 JSON **文本片段**，字段必须是 string 才能 `+=`（2741–2743 行批注）。`text` 块也刻意清空 `text: ''`——SDK 有个 bug，start 里带了部分文本、delta 又重发一遍，无法区分重复还是续写，干脆只信 delta（2776–2784 行）。

**content_block_delta（2828–2965 行）——碎片累加。** 全文件最关键的几行：

```ts
                case 'input_json_delta':
                  if (
                    contentBlock.type !== 'tool_use' &&
                    contentBlock.type !== 'server_tool_use'
                  ) {
                    // ...logEvent + throw（类型不对就报错，绝不静默拼接）
                  }
                  contentBlock.input += delta.partial_json
                  break
```

服务端发的是 `{ partial_json: '{"path":' }`、`{ partial_json: '"a.txt"}' }` 这样的碎片，一路 `+=` 拼成完整 JSON 字符串，到 stop 时才 `JSON.parse`（2872–2874 行批注）。每个 case 都先校验块类型再累加，校验失败就 `throw`——批注 2824–2827 行解释：SSE 是文本协议，服务端若发出意外 delta，不拦会「静默拼出错误内容」，比报错难查得多。

其余三种 delta 一行式累加：`text_delta` → `contentBlock.text += delta.text`（2921 行）、`thinking_delta` → `contentBlock.thinking += delta.thinking`（2963 行）、`signature_delta` → `contentBlock.signature = delta.signature`（2947 行，thinking 块的密码学签名，单独一次 delta）。

**content_block_stop（2990–3033 行）——收口成一条消息：**

```ts
            const m: AssistantMessage = {
              message: {
                ...partialMessage,
                content: normalizeContentFromAPI(
                  [contentBlock] as BetaContentBlock[],
                  tools,
                  options.agentId,
                ),
              },
              requestId: streamRequestId ?? undefined,
              type: 'assistant',
              uuid: randomUUID(),
              timestamp: new Date().toISOString(),
            }
            newMessages.push(m)
            yield m
```

三个要点（2983–2989 行批注）：`normalizeContentFromAPI` 在这里做 `JSON.parse`（把 input 字符串变对象）；content 只放**当前这一块**——一个响应里有 text + tool_use 两个块，就 yield **两条** assistant 消息，上层 `query.ts` 负责摊平；这是累积通道唯一的 yield 点。

**message_delta（3043–3141 行）——结算事件。** usage 的最终值和 `stop_reason` 只在这里出现（message_start 时 output_tokens 是 0）。但 content_block_stop 已经把消息 yield 出去了，所以必须**回头改已 yield 的对象**：

```ts
            stopReason = part.delta.stop_reason

            const lastMsg = newMessages.at(-1)
            if (lastMsg) {
              lastMsg.message.usage = usage
              lastMsg.message.stop_reason = stopReason
            }
```

批注 3059–3075 行逐字引了原注释：必须用**原地改属性**而不是对象替换——会话落盘队列持有的是旧对象的引用，替换对象会让落盘的 usage 变成 0。另外 `stop_reason === 'max_tokens'` 时 yield 一条错误消息（3130–3141 行），让上层 `query.ts` 触发自动升级重试。

**message_stop（3166–3170 行）——什么都不做：**

```ts
          case 'message_stop':
// 它是「流正常结束」的标记，但真实的收尾判断在循环外面（行 2350），
// 因为流也可能**没有** message_stop 就断了 —— 那才是要检测的情况。
            break
```

### 3.5 第二条通道：每个原始事件都转给 UI（3173–3182 行）

```ts
        yield {
          type: 'stream_event',
          event: part,
          ...(part.type === 'message_start' ? { ttftMs } : undefined),
        }
```

所以有两条 yield 通道：**每个**原始事件原样转出去（UI 做打字机效果），**assistant 消息**只在 content_block_stop 时 yield 一次（内部累积通道）。

---

## 4. 事件类型 → 程序做什么（速查表）

| SSE 事件 | claude.ts 做什么 | 行号 |
| --- | --- | --- |
| `message_start` | 存骨架 `partialMessage`、算 TTFT、初始化 usage | 2716–2729 |
| `content_block_start` | 按 4 种块类型造空壳（tool_use/server_tool_use 的 `input: ''`、text 的 `text: ''`、thinking 的 `thinking: ''` + `signature: ''`） | 2744–2815 |
| `content_block_delta`·`input_json_delta` | 校验类型 → `input += partial_json`（拼 JSON 字符串） | 2882–2907 |
| `content_block_delta`·`text_delta` | `text += delta.text` | 2909–2922 |
| `content_block_delta`·`thinking_delta` | `thinking += delta.thinking` | 2951–2964 |
| `content_block_delta`·`signature_delta` | `signature = delta.signature`（thinking 块签名） | 2928–2948 |
| `content_block_delta`·`citations_delta` | 收到但 TODO 未处理，不报错（向前兼容） | 2867–2869 |
| `content_block_stop` | `JSON.parse` 收口 → push + yield 一条 AssistantMessage | 2990–3033 |
| `message_delta` | 回写最终 usage / stop_reason（原地改）、算成本、max_tokens 截断则 yield 错误 | 3043–3141 |
| `message_stop` | 什么都不做 | 3166–3170 |
| `ping`（SDK 层） | 直接跳过 | streaming.mjs 55–57 |
| `error`（SDK 层） | 抛 `APIError`，交给 withRetry | streaming.mjs 58–60 |

---

## 5. 与「一次交互 15 步」的衔接

1.6 节的第 6 步「消息 + 系统提示词 + 工具清单发给 API（流式返回）」——本课的全部内容都发生在**这一步内部**：`query.ts` 主循环调用 `queryModelWithStreaming`，逐事件解析、逐块 yield。而第 7 步「模型返回 `tool_use: Read(a.txt)`」的真相是：模型发的是一串 `content_block_start(tool_use)` → 几十个 `input_json_delta` → `content_block_stop`。**直到 content_block_stop，第 7 步才算发生**——此时 yield 出的消息里才有解析好的工具参数，主循环才有东西送去做权限判定（第 8 步）。流式解析就是第 6 步到第 7 步之间的「翻译官」。

---

## 6. 常见误读

**误读一：「tool_use 的 input 一开始就是对象。」** 不对。start 阶段它是空**字符串**（2749 行 `input: ''`），delta 阶段一路拼字符串，到 stop 时才在 `normalizeContentFromAPI` 里 `JSON.parse`。中途它永远是半截 JSON 文本，没有任何代码去解析中间态。

**误读二：「模型的一次回答 = 一条 assistant 消息。」** 不对。content_block_stop 对**每个块**各 yield 一条消息（2985–2988 行批注明确说了）。一次回答里有 text + tool_use 两个块，上层就收到两条消息，各自 content 只有一块。

**误读三：「message_stop 负责收尾。」** 它一个字都不做（3167 行批注）。真正的收尾判断在循环外面——因为流可能根本没有 message_stop 就断了，「没有到达」才是需要检测的异常。

---

## 7. 动手验证

```bash
# ① 六个 switch 分支的精确位置
grep -n "case 'message_start'\|case 'content_block_start'\|case 'content_block_delta'\|case 'content_block_stop'\|case 'message_delta'\|case 'message_stop'" annotated/src/services/api/claude.ts

# ② 碎片累加的那一行（input_json_delta 的 +=）
grep -n "contentBlock.input += delta.partial_json" annotated/src/services/api/claude.ts

# ③ SDK 层：只认 event/data 两种字段、ping 跳过、error 抛错
grep -n "fieldname === 'event'\|fieldname === 'data'\|sse.event === 'ping'\|sse.event === 'error'" source/node_modules/@anthropic-ai/sdk/core/streaming.mjs
```

实际输出（②③）：

```
2906:                  contentBlock.input += delta.partial_json

267:        if (fieldname === 'event') {
270:        else if (fieldname === 'data') {
55:                    if (sse.event === 'ping') {
58:                    if (sse.event === 'error') {
```

---

## 8. 合书自测

<details><summary>1. 「流式」的三个层次分别是什么？CC 代码亲手处理的是哪层？</summary>

HTTP 分块（fetch/网络层，CC 不碰）→ SSE 事件（SDK 的 SSEDecoder 按 `event:`/`data:` 行解析，`JSON.parse` 后 yield）→ 内容增量（claude.ts 的 `for await` + switch，把 delta 碎片拼回完整消息）。CC 亲手写的是第三层；第二层在 `@anthropic-ai/sdk` 的 `core/streaming.mjs` 里。
</details>

<details><summary>2. tool_use 块从 start 到 stop，input 字段经历了什么形态变化？</summary>

`content_block_start` 时初始化为空字符串 `''` → 每个 `input_json_delta` 做 `input += partial_json`（还是字符串）→ `content_block_stop` 时 `normalizeContentFromAPI` 做 `JSON.parse` 变成对象。全程只解析一次，避免官方封装 O(n²) 的 partialParse。
</details>

<details><summary>3. 为什么 message_delta 要「原地改属性」而不是替换对象？</summary>

content_block_stop 已经把消息 yield 出去，而会话落盘队列持有的是旧对象的**引用**、延迟 100ms 才序列化。替换对象（`{ ...lastMsg.message, usage }`）会让引用脱钩，落盘的是 output_tokens: 0、stop_reason: null 的旧版本；原地改 `lastMsg.message.usage = usage` 才能被 flush 时读到。
</details>

<details><summary>4. message_stop 分支为什么是空的？真正要检测什么？</summary>

它是「流正常结束」的标记，正常结束不需要动作。真正要检测的是它的**缺失**：流可能没有 message_stop 就断了（代理转发到一半断掉），循环外的检查会抓「有 message_start 但没有 content_block_stop / stop_reason」的情况并触发非流式兜底。</details>

<details><summary>5. UI 的打字机效果吃的是哪条数据通道？</summary>

每个原始事件都被 `yield { type: 'stream_event', event: part }` 原样转发（3178 行），UI 吃这条；而 assistant 消息只在 content_block_stop 时 yield 一次，是给主循环用的累积通道。两条通道并行，互不替代。
</details>

<details><summary>6. 对着 15 步说：第 7 步「模型返回 tool_use」到底发生在本课的哪个 case 里？</summary>

发生在 `content_block_stop`：start 只给了空壳，delta 只是碎片，直到 stop 里 `JSON.parse` 完成并 yield 出带完整工具参数的 assistant 消息，主循环才真正「拿到」tool_use，接着才轮到第 8 步权限判定。
</details>

---

**下一课时**：[L4-B4 重试与退避——为什么重试要退避、哪些错误不能重试](../L4/L4-B4-重试与退避.md)
