# L4-A2 · Tool 契约字段：一个工具必须提供哪些字段

> 上一课（L4-A1）数清了 54 个工具怎么登记；这一课回答「凭什么算一个工具」。答案在 `Tool.ts`：它定义了工具的**契约**——想进户口本，每个对象必须满足这份契约。
> 教材原文 792 行，批注版约 2,013 行，但我们**只读 interface/type 定义部分**。这一课一半的内容，就是教你「怎么在 2,000 行里只读 interface」。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L4-A2（L4 层工具系统 A 组第 2 课，共 4 课） |
| ⏱ 时长 | 90 分钟 |
| 前置课时 | [L4-A1 工具户口本](./L4-A1-工具户口本.md)（必读：`Tools` 类型与 `getSendMessageTool` 都来自那边的语境）、[L3-02 GlobTool 三件套](../L3/L3-02-GlobTool三件套.md)（必读：执行器/渲染器/模型三种消费者的框架）、[L0-04 对象字面量与 satisfies](../L0/L0-04-对象字面量与satisfies.md) |
| 教材清单 | 批注版：[`src/Tool.ts`](../../annotated/src/Tool.ts)（2,013 行）<br>原文对照：[`src/Tool.ts`](../../source/src/Tool.ts)（792 行）<br>**只读指令**：① 用 grep 定位所有 `type`/`interface` 行号（见第 2 节）；② 精读原文 362-695（`Tool` 类型主体）、697-701（`Tools` 别名）、707-726（`DefaultableToolKeys`/`ToolDef`）、757-769（`TOOL_DEFAULTS`）；③ **跳过** 1-88 的 import、158-300 的 `ToolUseContext`（143 行，都是「工具运行时收到的环境参数」，初学不需要） |
| 这节课只解决一件事 | `Tool` 契约有哪些必填/可选字段、每个字段被谁消费、写一个新工具最少要实现哪几个 |

> **行号约定**：摘录文字与批注版逐字一致，行号标 `source/` 原文行号。批注版行号与原文行号的对应关系见第 2 节的区间表。

---

## 1. 全文地图：792 行分八段

| 段 | 原文行号 | 内容 | 初学策略 |
| --- | --- | --- | --- |
| ① | 1-88 | 全是 `import type` | 跳过。唯一信息：这个文件不 import 任何**值**，纯类型文件（除了末尾 `buildTool`） |
| ② | 90-120 | 三个小类型：`QueryChainTracking`、`ValidationResult`、`SetToolJSXFn` | 扫读；`ValidationResult` 在讲 `validateInput` 时回来看一眼 |
| ③ | 122-148 | `ToolPermissionContext` + 空上下文工厂 | 扫读：知道它是权限过滤的入参即可 |
| ④ | 150-156 | `CompactProgressEvent` | 跳过 |
| ⑤ | 158-300 | `ToolUseContext`：工具执行时收到的「环境大礼包」 | **跳过**（143 行）。只记住一句话：`call` 的第二个参数就是它 |
| ⑥ | 305-343 | `Progress`/`ToolProgress`/`ToolResult`/`AnyObject` | 扫读；`ToolResult`（321-336）是 `call` 的返回类型，值得看 |
| ⑦ | 362-695 | ★ **`Tool` 类型主体**：契约本体 | **全部精读**，本课主菜 |
| ⑧ | 697-792 | `Tools` 别名 + `buildTool` 三件套 | **精读** 707-726、757-769 |

为什么可以只读 type 定义部分：这一课的问题是「字段有哪些、谁消费」——答案全在 `type Tool = {...}` 和 `TOOL_DEFAULTS` 里。⑤ 段 `ToolUseContext` 虽然也是 type，但它是**调用现场的环境参数**，不是工具要**提供**的东西，方向反了，所以跳。

---

## 2. 怎么在 2,013 行里只读 interface：先 grep 定位

大文件选读的第一步永远是用 grep 画地图。对 `Tool.ts` 这样一个类型大文件，搜 `type`/`interface` 关键字就能列出全部类型及其行号：

```bash
$ grep -n -E "^(export )?(interface|type) [A-Za-z]+" annotated/src/Tool.ts
134:export type ToolInputJSONSchema = {
318:export type QueryChainTracking = {
334:export type ValidationResult =
353:export type SetToolJSXFn = (
384:export type ToolPermissionContext = DeepImmutable<{
471:export type CompactProgressEvent =
496:export type ToolUseContext = {
822:export type Progress = ToolProgressData | HookProgress
827:export type ToolProgress<P extends ToolProgressData> = {
859:export type ToolResult<T> = {
893:export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> = (
907:export type AnyObject = z.ZodType<{ [key: string]: unknown }>
959:export type Tool<
1785:export type Tools = readonly Tool[]
1807:type DefaultableToolKeys =
1827:export type ToolDef<
1860:type BuiltTool<D> = Omit<D, DefaultableToolKeys> & {
1957:type ToolDefaults = typeof TOOL_DEFAULTS
1977:type AnyToolDef = ToolDef<any, any, any>
```

（真实输出。注意：全文件**没有一个 `interface`**，全部用 `type` 写——这本身就是个信息。）

从这张地图得到阅读区间表（批注版行号 → 原文行号）：

| 批注版区间 | 原文区间 | 内容 | 策略 |
| --- | --- | --- | --- |
| 959-1782 | 362-695 | `Tool` 契约主体 | **精读** |
| 1785 | 697-701 | `Tools` 别名 | 精读（一行） |
| 1807-2013 | 707-792 | `DefaultableToolKeys`/`ToolDef`/`TOOL_DEFAULTS`/`buildTool` | **精读** |
| 134-907 | 15-343 | 周边小类型 | 扫读/跳过 |
| 496-819 | 158-300 | `ToolUseContext` | **跳过**（最大的一段，与「工具要提供什么」无关） |

一进来先跑这条 grep，2,013 行瞬间变成「读 959-2013、跳 1-958」——这就是 L4 层的「选择性精读」。

---

## 3. 精读正文（行号为 source 原文行号）

### 3.1 契约的形状：泛型三参数 + 一个大对象字面量

```ts
// source/src/Tool.ts:362-371
export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  /**
   * Optional aliases for backwards compatibility when a tool is renamed.
   * The tool can be looked up by any of these names in addition to its primary name.
   */
  aliases?: string[]
```

三个泛型：`Input`（输入 schema 的类型，必须是 Zod 对象）、`Output`（`call` 的返回数据类型）、`P`（进度消息类型）。每个具体工具用这三参数实例化同一份契约，例如 GlobTool 大致是 `Tool<{path: …, pattern: …}, string[], …>`。

### 3.2 必填字段：14 个，逐个过

在 362-695 区间内数「没有 `?` 的成员」，实测 **14 个必填**（验证命令见第 5 节）。逐个列：

| # | 字段 | 原文行号 | 签名要点 | 谁消费 |
| --- | --- | --- | --- | --- |
| 1 | `call` | 379-385 | `(args, context, canUseTool, parentMessage, onProgress?) => Promise<ToolResult<Output>>` | **执行器**：`toolExecution.ts:1207` `await tool.call(` |
| 2 | `description` | 386-393 | 给**这一次调用**的一句话描述（入参是本次 input） | **渲染器/权限 UI**：`hooks/useCanUseTool.tsx:56`、`utils/swarm/inProcessRunner.ts:185` |
| 3 | `inputSchema` | 394 | `readonly inputSchema: Input`（Zod 对象，不是 JSON Schema） | **模型**：`utils/api.ts:160` `zodToJsonSchema(tool.inputSchema)` |
| 4 | `isConcurrencySafe` | 402 | 输入相同时能否并行跑 | **执行器**：决定多个工具调用能否并发 |
| 5 | `isEnabled` | 403 | `(): boolean`，全局开关 | **执行器/清单**：`tools.ts:325-326` 过滤用 |
| 6 | `isReadOnly` | 404 | 只读工具可跳过确认、可折叠显示 | **执行器/渲染器** |
| 7 | `name` | 456 | `readonly name: string` | **三方全用**：模型（`tools[].name`）、查找（`toolMatchesName`，348-353）、注册表 |
| 8 | `maxResultSizeChars` | 466 | 结果超限就落盘、给模型回预览 | **执行器**：结果预算控制 |
| 9 | `checkPermissions` | 500-503 | `Promise<PermissionResult>`，工具专属权限逻辑 | **执行器（权限关）**：`utils/permissions/permissions.ts:1120` |
| 10 | `prompt` | 518-523 | **给模型的说明书**，`Promise<string>` | **模型**：`utils/api.ts:171` `description: await tool.prompt({…})` |
| 11 | `userFacingName` | 524 | 给人看的名字 | **渲染器**：`AssistantToolUseMessage.tsx:77` |
| 12 | `toAutoClassifierInput` | 556 | 给自动审批安全分类器的紧凑摘要 | **执行器（自动权限模式）** |
| 13 | `mapToolResultToToolResultBlockParam` | 557-560 | 把 `Output` 映射成 API 的 `tool_result` 块 | **执行器**：`toolExecution.ts:1292` |
| 14 | `renderToolUseMessage` | 605-608 | 渲染「调用行」；入参是 `Partial<Input>`（流式渲染时参数还没到齐） | **渲染器**：`AssistantToolUseMessage.tsx:318` |

重点字段原文摘录（三段最有讲头的）：

```ts
// source/src/Tool.ts:394-397
  readonly inputSchema: Input
  // Type for MCP tools that can specify their input schema directly in JSON Schema format
  // rather than converting from Zod schema
  readonly inputJSONSchema?: ToolInputJSONSchema
```

```ts
// source/src/Tool.ts:500-503
  checkPermissions(
    input: z.infer<Input>,
    context: ToolUseContext,
  ): Promise<PermissionResult>
```

```ts
// source/src/Tool.ts:601-608
  /**
   * Render the tool use message. Note that `input` is partial because we render
   * the message as soon as possible, possibly before tool parameters have fully
   * streamed in.
   */
  renderToolUseMessage(
    input: Partial<z.infer<Input>>,
    options: { theme: ThemeName; verbose: boolean; commands?: Command[] },
  ): React.ReactNode
```

注意两个易混点：

- **`description` 方法 ≠ `prompt` 方法**。`description(input, options)` 描述「这次调用」（随 input 变化，给人和权限 UI 看）；`prompt(options)` 是「这个工具怎么用」的说明书（每会话算一次进缓存，给模型看）。L3-02 里 `GlobTool/prompt.ts` 的 `DESCRIPTION` 常量就是被 `prompt` 消费的。
- **`inputSchema` 是 Zod，`inputJSONSchema` 是 JSON Schema**。后者是给 MCP 工具的旁路（MCP 协议天生说 JSON Schema），`utils/api.ts:148-159` 显示它还参与请求缓存键。

### 3.3 可选字段：33 个，按消费者分组

同区间内带 `?` 的成员实测 **33 个**。逐字段+消费者：

| 消费者 | 字段（原文行号） |
| --- | --- |
| **模型**（6） | `searchHint`(378，ToolSearch 关键词匹配)、`inputJSONSchema`(397)、`shouldDefer`(442，随请求带 defer_loading)、`alwaysLoad`(449)、`strict`(472，API 严格模式)、`mcpInfo`(455) |
| **执行器/权限**（12） | `outputSchema`(400)、`inputsEquivalent`(401)、`isDestructive`(406)、`interruptBehavior`(416，新消息进来时 cancel 还是 block)、`isOpenWorld`(434)、`requiresUserInteraction`(435)、`isMcp`(436)/`isLsp`(437) 标记、`backfillObservableInput`(481)、`validateInput`(489)、`getPath`(506)、`preparePermissionMatcher`(514) |
| **渲染器**（14） | `isSearchOrReadCommand`(429，折叠显示)、`userFacingNameBackgroundColor`(525)、`isTransparentWrapper`(533)、`getToolUseSummary`(539)、`getActivityDescription`(546，spinner 文案)、`renderToolResultMessage`(566)、`extractSearchText`(599，transcript 搜索索引)、`isResultTruncated`(615)、`renderToolUseTag`(621)、`renderToolUseProgressMessage`(625)、`renderToolUseQueuedMessage`(635)、`renderToolUseRejectedMessage`(641)、`renderToolUseErrorMessage`(659)、`renderGroupedToolUse`(678) |
| **两方共用**（1） | `aliases`(371)：`toolMatchesName`（查找，执行器/渲染器都要用）和 rename 兼容 |

一个字段一个设计决定，举两个值得回看的：

- `isDestructive?`（405 行注释）：「Defaults to false. Only set when the tool performs irreversible operations (delete, overwrite, send).」——默认**不是**破坏性操作，只有真不可逆的工具才标。
- `renderToolResultMessage?`（561-565 行注释）：省略时结果渲染为空——像 TodoWrite 这种结果展示在别处（面板）的工具，就不必实现它。

### 3.4 buildTool 三件套：14 个必填怎么变成「最少写 8 个」

14 个必填是 `Tool` 视角。但写新工具的人不该被迫写满——所以有 `DefaultableToolKeys`：

```ts
// source/src/Tool.ts:707-714
type DefaultableToolKeys =
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'toAutoClassifierInput'
  | 'userFacingName'
```

```ts
// source/src/Tool.ts:721-726
export type ToolDef<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = Omit<Tool<Input, Output, P>, DefaultableToolKeys> &
  Partial<Pick<Tool<Input, Output, P>, DefaultableToolKeys>>
```

```ts
// source/src/Tool.ts:757-769
const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?: unknown) => false,
  isReadOnly: (_input?: unknown) => false,
  isDestructive: (_input?: unknown) => false,
  checkPermissions: (
    input: { [key: string]: unknown },
    _ctx?: ToolUseContext,
  ): Promise<PermissionResult> =>
    Promise.resolve({ behavior: 'allow', updatedInput: input }),
  toAutoClassifierInput: (_input?: unknown) => '',
  userFacingName: (_input?: unknown) => '',
}
```

三个要点：

- `Omit<T, K> & Partial<Pick<T, K>>` 是「把 K 这些键变成可选」的标准配方；不用 `Partial<T>` 是因为那会把 `call` 也变可选。
- 默认值**fail-closed**：`isConcurrencySafe` 默认 `false`（不安全）、`isReadOnly` 默认 `false`（按会写处理）、`checkPermissions` 默认「放行并交还通用权限系统」——宁可多问，不可漏拦。
- `buildTool`（783-792 行）运行时做 `{...TOOL_DEFAULTS, userFacingName: () => def.name, ...def}`：调用方省略的键由默认值补齐，写了的键覆盖默认值。

于是有结论：**经 `buildTool` 写新工具，最少必须手写 8 个成员**：`call`、`description`、`inputSchema`、`name`、`maxResultSizeChars`、`prompt`、`mapToolResultToToolResultBlockParam`、`renderToolUseMessage`。14 − 7（可默认，其中 `isDestructive` 本就可选）= 8。这与 L4-A3 将要读的 FileReadTool 对照时可以验证。

---

## 4. 核心问题完整解答

对应 [学习路线](../00-零基础学习路线.md) L4-A 组卡片 A-2 的一问：「一个工具必须提供哪些字段？」

**第一层：`Tool` 契约（原文 362-695）**——必填 **14** 个（3.2 的表），可选 **33** 个（3.3 的表）。合计 47 个成员，这就是一个工具对象在 TypeScript 里被允许拥有的全部形状。

**第二层：`ToolDef` + `buildTool`（原文 707-792）**——7 个方法可省（`isEnabled`、`isConcurrencySafe`、`isReadOnly`、`isDestructive`、`checkPermissions`、`toAutoClassifierInput`、`userFacingName`），运行时由 `TOOL_DEFAULTS` 补齐。所以「必须亲自提供」收缩到 **8 个**：`name`、`description`、`prompt`、`inputSchema`、`call`、`checkPermissions`（可省，默认放行但建议实现）、`mapToolResultToToolResultBlockParam`、`renderToolUseMessage`（严格说后两个里 `checkPermissions` 可省，故铁打的最小集是 8 个中除它之外的 7 个加渲染）。

**第三层：谁消费**——沿用 L3-02 的三种消费者框架（全部行号已实测）：

- **模型**：`name`、`prompt()`→请求里的 `tools[].description`（`utils/api.ts:171`）、`inputSchema`→`zodToJsonSchema`（`utils/api.ts:160`）、`inputJSONSchema`（`utils/api.ts:148-159`）、`shouldDefer`/`alwaysLoad`/`strict`/`searchHint`。
- **执行器**：`call`（`toolExecution.ts:1207`）、`checkPermissions`（`utils/permissions/permissions.ts:1120`）、`mapToolResultToToolResultBlockParam`（`toolExecution.ts:1292`）、`isEnabled`/`isConcurrencySafe`/`isReadOnly`/`maxResultSizeChars`/`validateInput` 等。
- **渲染器**：`renderToolUseMessage`（`AssistantToolUseMessage.tsx:318`）、`renderToolUseTag`（同文件 218）、`userFacingName`（同文件 77）、其余 13 个渲染方法。

题目里点名的七个字段全部真实存在：`name`(456)、`description`(386)、`prompt`(518)、`inputSchema`(394)、`call`(379)、`checkPermissions`(500)、`renderToolUseMessage`(605)。

---

## 5. 常见误读

1. **「`description` 是个字符串字段」**。契约里没有 `description` 字符串属性；有两个**方法**：`description()`（这次调用的一句话，给人看）和 `prompt()`（工具说明书，给模型看）。「description」这个词只出现在 API 请求的 `tools[].description` 里，由 `utils/api.ts:171` 用 `prompt()` 的返回值填。把 L3-02 的 `prompt.ts` 内容当成 `Tool.description` 是最常见的张冠李戴。
2. **「契约是 `interface Tool`」**。全文件没有一个 `interface`，是 `export type Tool<...> = {...}`（对象字面量类型，方法用冒号写签名）。另外新工具代码里写的多半不是 `Tool` 而是 `ToolDef`（7 个方法可选化）——`satisfies Tool` 与 `buildTool({...})` 是两条都存在的路线（批注版 1838-1842 行注解）。
3. **「可选字段大概 20 个出头」**。批注版 1789 行注解写「14 必填 + 22 可选」，**可选数与实测不符**：逐行数 362-695 区间带 `?` 的成员是 **33 个**（验证命令见下节，输出 33）。批注注解的口径可能未把部分渲染方法计入；按硬规矩以实际代码为准。

---

## 6. 动手验证

```bash
$ grep -n -E "^(export )?(interface|type) [A-Za-z]+" annotated/src/Tool.ts | wc -l
19

$ sed -n '363,694p' source/src/Tool.ts | grep -cE '^  (readonly )?[a-zA-Z]+\?(\(|: )'
33
$ sed -n '363,694p' source/src/Tool.ts | grep -E '^  (readonly )?[a-zA-Z]+(\(|: )' | grep -vc '\?'
14
```

（真实输出：可选 33、必填 14。第二个命令用 `grep -vc '\?'` 排除带问号的行——注意 `description(...)`、`call(...)` 等必填方法签名里不含 `?`，恰好成立。）

消费者定位验证：

```bash
$ grep -n "tool.prompt(\|zodToJsonSchema(tool.inputSchema)" source/src/utils/api.ts | head -3
160:        : zodToJsonSchema(tool.inputSchema)
171:      description: await tool.prompt({

$ grep -n "\.call(\|\.mapToolResultToToolResultBlockParam(" source/src/services/tools/toolExecution.ts
1207:    const result = await tool.call(
1292:    const mappedToolResultBlock = tool.mapToolResultToToolResultBlockParam(

$ grep -rn "\.checkPermissions(" source/src/utils/permissions/permissions.ts | head -2
1120:    toolPermissionResult = await tool.checkPermissions(parsedInput, context)
1216:    toolPermissionResult = await tool.checkPermissions(parsedInput, context)

$ grep -n "\.renderToolUseMessage(\|\.userFacingName(" source/src/components/messages/AssistantToolUseMessage.tsx
 77:        userFacingToolName: tool.userFacingName(data),
318:    return tool.renderToolUseMessage(parsed.data, {
```

---

## 7. 合书自测

1. `Tool` 契约的必填字段有几个？写出其中「8 个经 `buildTool` 仍必须手写」的名单。
2. `description()` 和 `prompt()` 有什么区别？各自的消费者是谁？
3. 模型看到的 `tools[].input_schema` 是 JSON Schema，但契约里 `inputSchema` 是 Zod——中间发生了什么？在哪个文件哪一行？
4. `TOOL_DEFAULTS` 为什么把 `isConcurrencySafe` 默认成 `false`、`isReadOnly` 默认成 `false`？这体现了什么设计原则？
5. `renderToolUseMessage` 的 `input` 参数为什么是 `Partial<z.infer<Input>>`？
6. `ToolUseContext` 有 143 行，为什么这一课敢整段跳过？

<details>
<summary>参考答案（先自己写，再展开）</summary>

1. 必填 14 个。经 `buildTool` 仍须手写 8 个：`call`、`description`、`inputSchema`、`name`、`maxResultSizeChars`、`prompt`、`mapToolResultToToolResultBlockParam`、`renderToolUseMessage`（7 个可默认方法：`isEnabled`、`isConcurrencySafe`、`isReadOnly`、`isDestructive`、`checkPermissions`、`toAutoClassifierInput`、`userFacingName`，其中 `isDestructive` 本就可选）。
2. `description(input, options)` 描述**这一次调用**，入参含本次 input，给人和权限 UI 看（`useCanUseTool.tsx:56`）；`prompt(options)` 是工具的**使用说明书**，与具体调用无关，每会话算一次进缓存，给模型看（`utils/api.ts:171` 填进 `tools[].description`）。
3. `zodToJsonSchema(tool.inputSchema)` 把 Zod schema 转成 JSON Schema，发生在 `utils/api.ts:160`（构建请求的 `tools[]` 时）。
4. fail-closed：默认「不确定能不能并发就别并发」「不确定是不是只读就当会写」——省略一个方法不应放大权限或引入并发 bug。安全相关的默认必须保守。
5. 因为渲染器在**流式输出刚开始**时就要画调用行，此刻模型可能还没把参数吐完（原文 601-604 行注释明说）。
6. 因为它描述的是**工具执行时收到的环境**（abortController、appState、消息列表……），不是工具要**提供**的字段；本课的问题是「必须提供什么」，方向相反。需要时再用同一招 grep 定位回读。

</details>

---

## 8. 下一课时

- 下一课：L4-A3「最小工具的两块骨头」（教材 `FileReadTool/limits.ts` + `prompt.ts`）尚未上线，进度见 [学习路线 L4-A 组](../00-零基础学习路线.md)。上一课：[L4-A1 工具户口本](./L4-A1-工具户口本.md)。
