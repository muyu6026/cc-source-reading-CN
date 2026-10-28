# L3-02 · GlobTool 三件套：一个工具，三种消费者

> 上一课的四个文件是「一条链上的四段」，方向是从上到下。这一课的三个文件不是链，而是**同一个工具的三张面孔**：一张给执行器，一张给渲染器，一张给模型。
> 三份文件加起来 267 行，其中给模型看的那份只有 7 行——它却是最值得逐字读的一份。

| 项目 | 内容 |
| --- | --- |
| 课时号 | L3-02（L3 层第 2 课，共 4 课） |
| ⏱ 时长 | 60 分钟 |
| 前置课时 | [L0-02 import 的两种面孔](../L0/L0-02-import的两种面孔.md)、[L1-01 两行文件与循环依赖](../L1/L1-01-两行文件与循环依赖.md)、[L1-05 十九行命令声明](../L1/L1-05-十九行命令声明.md)、[L2-01 从出口倒着读](../L2/L2-01-从出口倒着读.md) |
| 教材清单 | 批注版：[`GlobTool.ts`](../../annotated/src/tools/GlobTool/GlobTool.ts)（212 行）、[`UI.tsx`](../../annotated/src/tools/GlobTool/UI.tsx)（67 行）、[`prompt.ts`](../../annotated/src/tools/GlobTool/prompt.ts)（8 行）<br>原文对照：[`GlobTool.ts`](../../source/src/tools/GlobTool/GlobTool.ts)（198 行）、[`UI.tsx`](../../source/src/tools/GlobTool/UI.tsx)（62 行）、[`prompt.ts`](../../source/src/tools/GlobTool/prompt.ts)（7 行） |
| 这节课只解决一件事 | 说清三份文件各自被谁、在什么时机读；以及为什么「给模型看的话」必须单独成文件 |

> **行号约定**：摘录文字与批注版逐字一致，行号标 `source/` 原文行号（批注版插入了中文注解，行号整体后移）。

---

## 1. 三份文件，三种消费者

| 文件 | 行数 | 里面是什么 | 消费者 | 读它的时机 |
| --- | --- | --- | --- | --- |
| `GlobTool.ts` | 198 | schema、`call`、权限、结果映射 | **执行器**：`tools.ts:9` 注册，`toolExecution.ts:1207` 调用 | 启动注册一次；每次工具调用 |
| `UI.tsx` | 62 | 名称、调用行、错误行、结果渲染 | **渲染器**：`AssistantToolUseMessage.tsx:318`、`UserToolSuccessMessage.tsx:65` | 每条消息渲染时，可能每帧 |
| `prompt.ts` | 7 | 工具名 + 5 句描述 | **模型**：`utils/api.ts:171` 写进请求的 `tools[].description` | 每次建请求（按会话缓存） |

三者不是「主程序 + 两个附属」，而是三条独立的读取路径：

```
                       ┌──────────── 模型 ────────────┐
                       │ tools[]: { name, description }│
                       └──────────────▲───────────────┘
                                      │ description: await tool.prompt()
                                      │            utils/api.ts:171
prompt.ts ◀──import── GlobTool.ts ──import──▶ UI.tsx ──import──▶ GrepTool
   ▲                     │                                        （借结果渲染）
   │ 只取名字/描述        │ call()
   │（18 个文件）         ▼
BashTool/prompt.ts …  toolExecution.ts:1207 ──▶ glob() ──▶ filenames
```

注意图里唯一一条「跨工具」的边：`UI.tsx → GrepTool`。方向是单向的——Glob 借 Grep 的结果渲染，Grep 完全不知道 Glob 存在。

**为什么拆**：不是按「代码量」拆，而是按**读取者的身份**拆。执行器要的是行为（`call` 返回什么），渲染器要的是人能看懂的一行字，模型要的是一段自然语言说明书。三者的生命周期也不同：`prompt` 每会话算一次就被缓存，UI 每次重渲染都跑，`call` 每次调用才跑。

---

## 2. 精读正文（行号为 source 原文行号）

### 2.1 `prompt.ts` 全 7 行：每一句都是写给模型的操作指令

```ts
export const GLOB_TOOL_NAME = 'Glob'

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`
```

逐句拆：

| 句子 | 它在教模型什么 |
| --- | --- |
| `Fast … works with any codebase size` | 能力 + 规模承诺。消除「仓库很大，要不要换策略」的犹豫 |
| `Supports glob patterns like "**/*.js" …` | 用两个**例子**代替语法定义。模型学模式靠示例，不靠 EBNF |
| `Returns … sorted by modification time` | 输出形状 + 排序依据。模型据此决定先读哪几个文件 |
| `Use this tool when you need to find files by name patterns` | 触发条件。这是**路由规则**，不是功能介绍 |
| `… open ended search … use the Agent tool instead` | 反向路由。单轮 glob 便宜；多轮搜索交给子代理，避免主对话被中间结果塞满 |

这五句没有一句是「给用户的产品说明」。用户看到的是消息流里的一行 `Search(pattern: "**/*.ts")`，或权限弹窗里的同一行——都不是这段文字。

第一行的 `GLOB_TOOL_NAME` 单独导出，是拆文件的**第一条硬理由**：别的提示词要在句子里按名字引用这个工具，它们只需要这个名字，不需要 198 行的实现。实测有 18 个文件从 `GlobTool/prompt.js` 取东西，其中绝大多数只取名字。

### 2.2 `GlobTool.ts`：执行器那一面

开头两条 import 就是两条边（第 17、18–24 行）：

```ts
import { DESCRIPTION, GLOB_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'
```

**第二条边值得记住**：`GlobTool.ts` 静态 import 了 `UI.js`，也就是说「执行器文件」本身是连着 React 渲染函数的。所以拆分 UI 的动机**不是**「让执行器不加载 React」——这条边根本没断。真正的复用收益在 `prompt.ts`，不在 `UI.tsx`。

schema（第 26–36 行）：

```ts
const inputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string().describe('The glob pattern to match files against'),
    path: z
      .string()
      .optional()
      .describe(
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
      ),
  }),
)
```

三个细节，全部指向「模型的输入质量」：

- `strictObject`：多给字段直接拒绝，防止模型顺手塞 `recursive: true` 之类不存在的参数。
- `lazySchema`：把 zod 对象的构造从「模块加载时」推迟到「第一次访问时」（`utils/lazySchema.ts` 的注释原话：defer Zod schema construction from module init time to first access）。启动时只装一个工厂函数。
- `describe(...)`：这些文字会被 `zodToJsonSchema` 写进 `input_schema` 一起发给模型。`DO NOT enter "undefined" or "null"` 是模型才会犯的错——人不会在输入框里打一个字符串 `"null"`。**schema 里的说明也是给模型看的。**

主流程 `call`（第 154–176 行）：

```ts
  async call(input, { abortController, getAppState, globLimits }) {
    const start = Date.now()
    const appState = getAppState()
    const limit = globLimits?.maxResults ?? 100
    const { files, truncated } = await glob(
      input.pattern,
      GlobTool.getPath(input),
      { limit, offset: 0 },
      abortController.signal,
      appState.toolPermissionContext,
    )
    // Relativize paths under cwd to save tokens (same as GrepTool)
    const filenames = files.map(toRelativePath)
    const output: Output = {
      filenames,
      durationMs: Date.now() - start,
      numFiles: filenames.length,
      truncated,
    }
    return {
      data: output,
    }
  },
```

- `GlobTool.getPath(input)` 而不是直接用 `input.path`：这个方法（第 88–90 行）做的是 `path ? expandPath(path) : getCwd()`。**省略 path 时默认 cwd** 的语义写在这里，不写在 `call` 里。
- 默认 100 条 + `truncated` 标志：截断不是静默的，模型会知道「还有更多」，从而收窄 pattern。
- `toRelativePath`：cwd 下的路径去掉前缀，省 token。注释还特意写了 `same as GrepTool`——两个搜索工具在这条省钱规矩上对齐。

结果映射（第 177 行起，下面是空结果分支 178–184 行）是「执行器 → 模型」的最后一道转换：

```ts
    if (output.filenames.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No files found',
      }
    }
```

空结果给一句 `No files found`，而不是空字符串：让模型区分「搜过了，没有」和「工具没返回」。截断时还会在列表末尾追加 `(Results are truncated. Consider using a more specific path or pattern.)`——这不是给人看的报错，是给模型的下一步建议。

### 2.3 `UI.tsx`：渲染器那一面

```ts
export function userFacingName(): string {
  return 'Search';
}
```

对外名字是 `Search`，和 GrepTool 一样。用户在界面上看到的不是「Glob」和「Grep」两个工具，而是同一个「Search」类别；具体搜什么，看后面的 pattern。

```ts
  if (!path) {
    return `pattern: "${pattern}"`;
  }
  return `pattern: "${pattern}", path: "${verbose ? path : getDisplayPath(path)}"`;
```

渲染的是一行字符串：`pattern: "**/*.ts"`；有 path 时补上，非 verbose 模式把路径缩成相对显示。

```ts
export const renderToolResultMessage = GrepTool.renderToolResultMessage;
```

一行赋值完成复用：Glob 的结果渲染就是 Grep 的实现（一列文件名）。这是「孪生工具共享 UI」最省的做法——比抽公共组件少一层间接。代价是 `UI.tsx` 多了一条指向 `../GrepTool/GrepTool.js` 的边。

错误渲染（第 33–50 行）只做两件事：非 verbose 时把 `File not found` / `Error searching files` 摆出来，其余交给 `FallbackToolUseErrorMessage`。**这一份 UI 薄，是因为结果本身薄**——一串路径，没有表格、没有 diff，能画的东西不多。

---

## 3. 核心问题：工具描述为什么是给模型看的，不是给人看的？

把证据按「它去了哪」串起来，一共五条：

1. **它进了请求体。** `utils/api.ts:171`：`description: await tool.prompt({...})`。`toolToAPISchema()` 把 `prompt()` 的返回值放进工具的 API schema，随 `tools` 数组发给模型。同一行逻辑在 `entrypoints/mcp.ts:85` 还有一份——通过 MCP 暴露时，这段描述发给的是**别的模型**。
2. **人根本看不到它。** 人能看到的只有渲染结果：`UI.tsx:11-13` 的 `Search`，和 `UI.tsx:14-32` 拼出来的 `pattern: "..."`。界面上没有任何地方渲染 `DESCRIPTION`。
3. **文本本身是人称和用途决定的。** 五句话全是祈使句，主语是「你」（`Use this tool when you need…`），内容是「什么时候用我、什么时候改用 Agent」。这是决策规则，不是产品文案。
4. **它是缓存前缀的一部分。** `utils/api.ts` 第 136–140 行的注释写明：`name / description / input_schema` 这些是「session-stable base schema」，每会话算一次并缓存，避免序列化出来的字节中途变化。**改一个字，等于换掉一段提示词前缀。** 所以它必须独立、稳定、不掺实现代码。
5. **机器还会再读它一遍。** `ToolSearchTool` 对延迟加载的工具做关键词打分时，拿的也是 `tool.prompt(...)` 的结果（`ToolSearchTool.ts:63-87`，按工具名 memoize）。同一个字符串，第二个机器消费者。

所以 `prompt.ts` 不是「文档」，是**运行时数据**：它参与请求、参与计费、参与缓存命中。把它和实现分开，是因为它的读者、生命周期、修改理由都和实现不同——实现改一行是修 bug，描述改一个字可能让当前会话的提示词缓存前缀失效。

**三类消费者（外加一个机器读者）各自在什么时机读它**：

| 消费者 | 读的是 | 触发点 | 频率 |
| --- | --- | --- | --- |
| 执行器 | `call` / `validateInput` / `checkPermissions` | 模型发出 `tool_use` 之后，`toolExecution.ts:1207` | 每次调用 |
| 渲染器 | `renderToolUseMessage` / `renderToolResultMessage` / `userFacingName` | 消息进入列表、界面重渲染，`AssistantToolUseMessage.tsx:318` | 每帧/每条消息 |
| 模型 | `name` + `description` + `input_schema` | 每次建 API 请求，`utils/api.ts:171`，按会话缓存 | 每会话一次，之后复用 |
| ToolSearch（机器） | `prompt()` 全文 | 延迟工具需要打分时 | 按需，按工具名缓存 |

---

## 4. 常见误读

| ❌ 0 基础最可能这样读 | ✅ 实际是什么 |
| --- | --- |
| 把 UI 拆出去，是为了让执行器不加载 React | `GlobTool.ts:18-24` 静态 import 了 `./UI.js`，这条边没断。真正「被轻量复用」的是 `prompt.ts`——18 个文件只取名字，不必碰实现 |
| `prompt.ts` 是给人看的帮助文本 | 人看到的是 `Search` 和 `pattern: "..."`；`DESCRIPTION` 只出现在 API 请求的 `tools[].description` 里 |
| 描述里说「按修改时间排序」，就是新改的文件排在前面 | `utils/glob.ts:94` 的注释写明 `--sort=modified` 是 **oldest first**，第 104 行照此传参，后面没有反转。实际是旧文件在前，截断时被切掉的恰恰可能是最新的 |

---

## 5. 动手验证（以下输出是我在本仓库真实跑出来的）

**① 目录内的两条边**

```bash
grep -rn "from './prompt.js'\|from './UI.js'" source/src/tools/GlobTool
```

```
source/src/tools/GlobTool/GlobTool.ts:17:import { DESCRIPTION, GLOB_TOOL_NAME } from './prompt.js'
source/src/tools/GlobTool/GlobTool.ts:24:} from './UI.js'
```

`UI.tsx` 和 `prompt.ts` 都不引用实现，只有实现引用它们：**一个扇出，两条单向边，没有回边**。

**② 谁只要名字、不要实现**

```bash
grep -rl "GlobTool/prompt" source/src --include=*.ts --include=*.tsx | wc -l
```

```
18
```

18 个文件从 `prompt.ts` 取东西（`constants/prompts.ts`、`BashTool/prompt.ts`、`AgentTool/prompt.ts`、三个内置 agent、压缩与记忆提取等）。它们如果改成 import `GlobTool.js`，就会顺带把 zod、文件系统、权限、React 渲染函数全部拖进提示词构建路径。

**③ 反证：没有人单独要 UI**

```bash
grep -rn "GlobTool/UI" source/src --include=*.ts --include=*.tsx | wc -l; grep -rn "from './UI.js'" source/src/tools/GlobTool
```

```
0
source/src/tools/GlobTool/GlobTool.ts:24:} from './UI.js'
```

`UI.tsx` 的唯一消费者是 `GlobTool.ts`。**「拆成三份」不等于「三份都被多方复用」**——被复用的是 `prompt.ts`，`UI.tsx` 只是按职责分家。

**④ 描述到底进了哪**

```bash
grep -rn "description: await tool.prompt" source/src --include=*.ts --include=*.tsx
```

```
source/src/entrypoints/mcp.ts:85:              description: await tool.prompt({
source/src/utils/api.ts:171:      description: await tool.prompt({
```

两处：Anthropic API 请求，和 MCP 服务端对外暴露。**两个消费者都是模型，一个都不是人。**

---

## 6. 合书自测

1. 三份文件分别服务谁？各自在什么时机被读？不看笔记说一遍。
2. `prompt.ts` 只有 7 行，为什么必须单独成文件？给出两个有代码支撑的理由。
3. `UI.tsx` 为什么能薄到 62 行？它和 `GrepTool` 是什么关系？
4. `path` 字段的 `describe` 里为什么要写 `DO NOT enter "undefined" or "null"`？这句话给谁看？
5. 实际上文件是按「新的在前」还是「旧的在前」返回？依据哪一行？

<details>
<summary>参考答案（先自己写，再展开）</summary>

1. `GlobTool.ts` 给执行器（`toolExecution.ts:1207` 调 `call`，每次工具调用）；`UI.tsx` 给渲染器（`AssistantToolUseMessage.tsx:318` / `UserToolSuccessMessage.tsx:65`，每条消息渲染）；`prompt.ts` 给模型（`utils/api.ts:171` 写进 `tools[].description`，每会话算一次并缓存）。
2. ① 它被 18 个文件单独引用，其中多数只要 `GLOB_TOOL_NAME`，不该为此加载 198 行实现和它的依赖；② 它的内容是进 API 请求的运行时数据，属于「每会话稳定」的缓存前缀，需要独立、稳定、不掺实现（`utils/api.ts:136-140`）。
3. 结果本身薄：一串文件路径，没有表格和 diff，直接复用 `GrepTool.renderToolResultMessage`（`UI.tsx:52-53` 一行赋值），自己只写名称、调用行、错误行。
4. 因为模型会把「没有这个参数」错误地表达成字符串 `"undefined"` 或 `"null"`，人不会。它随 schema 一起发给模型，是输入约束，不是用户文档。
5. 旧的在前。依据 `utils/glob.ts:94` 的注释（`--sort=modified`，oldest first）与第 104 行的实际参数，且后续 `slice`（第 127 行）没有反转。

</details>

---

## 7. 下一课时

- 下一课：[L3-03 规矩写在哪](./L3-03-EditTool常量与提示.md)——同样是「给模型看的约束」，这次是一条规矩：「必须先 Read 才能 Edit」。上一课：[L3-01 clear 四件套协作](./L3-01-clear四件套协作.md)。
