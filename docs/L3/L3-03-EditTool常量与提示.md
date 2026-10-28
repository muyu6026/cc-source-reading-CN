# L3-03 · 规矩写在哪

> **课时号**：L3-03　**标题**：规矩写在哪——「必须先 Read 才能 Edit」的两层实现
> **⏱ 时长**：30 分钟　**前置课时**：[L1-02 十一行常量文件](../L1/L1-02-十一行常量文件.md)、[L0-02 import 的两种面孔](../L0/L0-02-import的两种面孔.md)
> **教材清单**：
> - 批注版：[`annotated/src/tools/FileEditTool/constants.ts`](../../annotated/src/tools/FileEditTool/constants.ts)（13 行）、[`annotated/src/tools/FileEditTool/prompt.ts`](../../annotated/src/tools/FileEditTool/prompt.ts)（32 行）
> - 原文：[`source/src/tools/FileEditTool/constants.ts`](../../source/src/tools/FileEditTool/constants.ts)（**11 行**）、[`source/src/tools/FileEditTool/prompt.ts`](../../source/src/tools/FileEditTool/prompt.ts)（**28 行**）——本文行号以原文为准
> - 对照阅读：[`source/src/tools/FileEditTool/FileEditTool.ts`](../../source/src/tools/FileEditTool/FileEditTool.ts)（硬约束那一侧，只读片段）
>
> **这节课只解决一件事**：一条规则可以同时住在两个地方——**提示词里写给模型看**，**代码里拦住不听话的调用**。本课把「必须先 Read 才能 Edit」从文字追到代码，看清软约束与硬约束各负责哪一半。
>
> 说明：L1-02 已从「常量文件格式」角度讲过 `constants.ts`；本课换一个角度——**它服务谁**。

---

## 1. 四份文件，一条规矩

箭头统一为「**被谁引用**」：

```
              constants.ts（11 行，叶子，零 import）
                        │
 ┌───────────┬──────────┼───────────┬──────────────┐
 ▼           ▼          ▼           ▼              ▼
FileEditTool constants/ permissions/ FileWriteTool （共 31 个文件）
  .ts       prompts.ts filesystem.ts  .ts
  │ 54–56 行 import                  43 行 import
  │ prompt() 95 行
  ▼
prompt.ts（28 行）── 1 行 import ──> utils/file.ts（行号前缀格式开关）
  │
  └── 2 行 import ──> FileReadTool/prompt.ts（只要一个名字 'Read'）
  │
  ▼
utils/api.ts:171  description: await tool.prompt({...})  →  模型
```

三条边先记住：

1. **所有箭头指向 `constants.ts`，没有一条从它出去**。它零 `import`，是整张图的叶子；31 个文件引用它也不会成环。
2. `prompt.ts` 在链条中间：上游是常量与开关，下游是 `api.ts`——**位置决定了它的输出会被逐字送进模型**。
3. 第 2 行只从 `FileReadTool/prompt.ts` 取一个字符串，而不是从工具本体取。那一行自己写着理由：「Use a string constant for tool names to avoid circular dependencies」。**为了一个词，也要绕开工具本体。**

---

## 2. `constants.ts`：四个常量，各自服务谁

全文逐字（11 行，空行保留）：

```ts
1  │ // In its own file to avoid circular dependencies
2  │ export const FILE_EDIT_TOOL_NAME = 'Edit'
3  │
4  │ // Permission pattern for granting session-level access to the project's .claude/ folder
5  │ export const CLAUDE_FOLDER_PERMISSION_PATTERN = '/.claude/**'
6  │
7  │ // Permission pattern for granting session-level access to the global ~/.claude/ folder
8  │ export const GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN = '~/.claude/**'
9  │
10 │ export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
11 │   'File has been unexpectedly modified. Read it again before attempting to write it.'
```

L1-02 关心「等号换行怎么写」「`**` 不是 TS 语法」。本课只问：**每个常量被谁拿走、拿去干什么？**

| 常量 | 行 | 实测引用 | 服务的人 |
| --- | --- | --- | --- |
| `FILE_EDIT_TOOL_NAME` | 2 | **31 个文件、80 处** | 所有需要「指认这个工具」的模块：权限、工具清单、压缩白名单、文案、子 agent 工具表 |
| `CLAUDE_FOLDER_PERMISSION_PATTERN` | 5 | 2 文件 3 处 | 权限对话框（会话级 `.claude/`）+ 权限匹配器 |
| `GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN` | 8 | 2 文件 3 处 | 同上，作用于 `~/.claude/` |
| `FILE_UNEXPECTEDLY_MODIFIED_ERROR` | 10–11 | 2 文件 3 处 | `Edit` 与 `Write` 共用同一句报错 |

### 2.1 第 2 行：一个字符串，31 个消费者

`grep -rl` 的结果按角色分四类，各挑一个真实引用点：

| 角色 | 引用点 | 在做什么 |
| --- | --- | --- |
| 工具自身 | `FileEditTool.ts:87` `name: FILE_EDIT_TOOL_NAME` | 工具的身份证。改这里=改工具名，模型看到的名字跟着变 |
| 提示词文案 | `constants/prompts.ts:293` `To edit files use ${FILE_EDIT_TOOL_NAME} instead of sed or awk` | 系统提示里「别用 sed」那句，插的是同一个名字 |
| 白名单 | `constants/tools.ts:63`、`microCompact.ts:48` | 异步 agent 可用工具集、可压缩工具集——`Set` 里的一个成员 |
| 权限授予 | `usePermissionHandler.ts:118` `toolName: FILE_EDIT_TOOL_NAME` | 「允许访问 .claude/」这条规则的作用对象 |

它服务的是「**所有需要提到这个工具的模块**」，不是「文件编辑逻辑」。若它住在 `FileEditTool.ts` 里，这 30 个文件就都得 import 工具本体，而工具本体又 import 权限、UI、utils——环立刻形成。

### 2.2 第 5、8 行：一个当规则，一个当前缀

```ts
// usePermissionHandler.ts:110-113
    const pattern =
      options.scope === 'global-claude-folder'
        ? GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN
        : CLAUDE_FOLDER_PERMISSION_PATTERN
// utils/permissions/filesystem.ts:1284-1286
      (ruleContent.startsWith(CLAUDE_FOLDER_PERMISSION_PATTERN.slice(0, -2)) ||
        ruleContent.startsWith(
          GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN.slice(0, -2),
        ))
```

第二处 `.slice(0, -2)` 把结尾 `/**` 切掉，剩 `/.claude` 前缀，判断已有规则是否在 `.claude/` 底下。**一处当完整规则、一处当前缀**——形状只有一份，两种用法不会漂移。

### 2.3 第 10–11 行：一句话，两个工具

```ts
// FileEditTool.ts:465 与 FileWriteTool.ts:292 两处
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
```

`Edit` 和 `Write` 在「读完之后文件又被改过」时抛**同一句**文案。不是省事，是契约一致：上层重试分类只匹配一次字符串，模型学一次就够。注意这是一条**跨工具目录**的边（`FileWriteTool` → `FileEditTool/constants.ts`）——跨目录引用通常危险，但指向叶子就安全。

---

## 3. `prompt.ts`：28 行，每一句在管什么

全文逐字（28 行）：

```ts
1  │ import { isCompactLinePrefixEnabled } from '../../utils/file.js'
2  │ import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
3  │
4  │ function getPreReadInstruction(): string {
5  │   return `\n- You must use your \`${FILE_READ_TOOL_NAME}\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. `
6  │ }
7  │
8  │ export function getEditToolDescription(): string {
9  │   return getDefaultEditDescription()
10 │ }
11 │
12 │ function getDefaultEditDescription(): string {
13 │   const prefixFormat = isCompactLinePrefixEnabled()
14 │     ? 'line number + tab'
15 │     : 'spaces + line number + arrow'
16 │   const minimalUniquenessHint =
17 │     process.env.USER_TYPE === 'ant'
18 │       ? `\n- Use the smallest old_string that's clearly unique — usually 2-4 adjacent lines is sufficient. Avoid including 10+ lines of context when less uniquely identifies the target.`
19 │       : ''
20 │   return `Performs exact string replacements in files.
21 │
22 │ Usage:${getPreReadInstruction()}
23 │ - When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: ${prefixFormat}. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
24 │ - ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
25 │ - Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
26 │ - The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.${minimalUniquenessHint}
27 │ - Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`
28 │ }
```

### 3.1 第 4–6 行：核心那句

这句有三个成分，缺一个都会弱化：

| 成分 | 作用 |
| --- | --- |
| `You must ... before editing` | 给出**时机**：编辑之前，不是之后 |
| `at least once in the conversation` | 给出**范围**：整段对话读过一次即可 |
| `This tool will error if ...` | 给出**后果**：明说会报错。模型对「会失败」远比对「应该」敏感 |

第 22 行把它插在 `Usage:` 之后——整段描述里**最靠前**的位置。作者没把它混进五条 bullet，而是抽成函数插到最前：**位置本身就是强调**。

### 3.2 第 20–27 行：七句话，各管一种行为

| 行 | 原句（节选） | 约束什么 | 能否用代码检查 |
| --- | --- | --- | --- |
| 20 | `Performs exact string replacements in files.` | **能力边界**：精确字符串替换，不是「第 30 行改成 X」，不是正则 | 只能在失败后 |
| 22 | `Usage:` + 必须先 Read | 前置条件 | **能**（`errorCode: 6`） |
| 23 | `preserve the exact indentation ... AFTER the line number prefix` | 复制 Read 输出时别把行号带进 `old_string` | 能（表现为「找不到字符串」） |
| 24 | `ALWAYS prefer editing existing files ... NEVER write new files` | 行为偏好：能改就不新建 | **不能** |
| 25 | `Only use emojis if the user explicitly requests it` | 输出风格 | 不能 |
| 26 | `The edit will FAIL if old_string is not unique ...` | 预先说出失败条件，并给两条出路 | 能（`errorCode: 9`） |
| 27 | `Use replace_all for replacing and renaming strings` | 给 `replace_all` 一个具体场景 | 不能 |

第 26 行最像「教学」：不只说会失败，还说**失败了怎么办**——加长上下文，或改用 `replace_all`。代码只能返回「找到 3 处但 replace_all 是 false」，把选择题留给模型；prompt 提前把选项摆出来，模型就不用先撞一次墙。

### 3.3 第 16–19 行：只对内部构建下发的一句

`process.env.USER_TYPE === 'ant'` 时多一句「old_string 尽量短，2–4 行就够」。同一个工具对不同读者给出**不同长度**的提示词——prompt 不是事实描述，而是**针对特定读者调参的产物**。

---

## 4. 硬约束那一侧：`errorCode: 6` 与 `readFileState`

prompt 说「会报错」。报错在 `FileEditTool.ts` 的 `validateInput`（第 137 行开始）：

```ts
275 │     const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
276 │     if (!readTimestamp || readTimestamp.isPartialView) {
277 │       return {
278 │         result: false,
279 │         behavior: 'ask',
280 │         message:
281 │           'File has not been read yet. Read it first before writing to it.',
282 │         meta: {
283 │           isFilePathAbsolute: String(isAbsolute(file_path)),
284 │         },
285 │         errorCode: 6,
286 │       }
287 │     }
```

代码里没有「模型有没有调用过 Read」这种检查，它查的是一个 **map**：`toolUseContext.readFileState`。

- **谁写**：`FileReadTool.ts:842`、`:1032` 读完文件后 `readFileState.set(...)`（`BashTool.tsx:404` 也写）；**谁读**：`FileEditTool.ts:275`（校验）、`:453`（写盘前再查）。
- 方向：`FileReadTool` →（写）`readFileState` ←（读）`FileEditTool`。**两个工具不互相 import**，只共享 `toolUseContext` 里的一个 map。

所以这条规矩在代码里比 prompt 更严：**按文件算**（不是按对话）、**部分读取不算**（`isPartialView`）、**读完又被改过也不行**（`errorCode: 7`，第 292–308 行；写盘前二次检查第 452–466 行抛 `FILE_UNEXPECTEDLY_MODIFIED_ERROR`）。

`errorCode` 完整清单：`0` 密钥 / `1` 两个字符串相同 / `2` deny 规则 / `3` 想新建但已存在 / `4` 文件不存在 / `5` 是 `.ipynb` / **`6` 没读过（第 285 行）** / **`7` 读过又被改（第 307 行）** / `8` 找不到字符串 / `9` 多处匹配 / `10` 超过 1 GiB。共 **11 个取值（0–10）**，卡片说的「十个」不精确，以实际为准。注意 `errorCode: 10` 在第 193 行、比 3/4/5 都早——它是后加的检查插在前面，说明**错误码是稳定契约，只能新增不能重排**。

---

## 5. 核心问题：为什么写进 prompt，而不是只靠代码？

**① 模型只看得到 `prompt()` 的返回值。** 工具进 API 时 `description` 来自 `await tool.prompt(...)`（`utils/api.ts:171`）。不写在这里，模型不知道有这条规矩。顺带澄清：`FileEditTool.ts:91-93` 的 `description()` 只返回 `'A tool for editing files'`，那句不进 API。

**② 代码只能事后拒绝，提示词能让它一开始就做对。** `errorCode: 6` 出现在模型已经生成完一次调用**之后**：这一轮生成白花，还要一次工具往返把错误喂回去。提示词把失败提前到生成之前。

**③ 有些规则根本无法用代码判定。** 「优先改已有文件」「别加 emoji」「old_string 尽量短」没有客观判据，写不出 `if`。**判据决定住处**：能判定的进代码，判断类的进提示词。

**④ 有些规则需要模型做决策。** 唯一性失败后，加长上下文还是用 `replace_all`，必须模型选；代码只能报「找到 3 处」。

**⑤ 一份 prompt，所有调用方继承。** 主 agent、子 agent、SDK 都走同一条 `api.ts:171`，规则写一次全部生效。但 prompt 不能替代代码：自然语言没有强制力。**prompt 让守规矩的成本最低，代码让不守规矩的代价确定。**

一句话：**prompt 说目标，代码说后果；重叠的那条规矩，两边各写一半。**

---

## 6. 常见误读

| ❌ 0 基础最可能这样读 | ✅ 实际是什么 |
| --- | --- |
| 「写在 prompt 里 = 只是建议，代码没真检查」 | 代码硬检查在 `FileEditTool.ts:275-287` 的 `errorCode: 6`；prompt 只是把同一件事提前告诉模型 |
| 「prompt 和代码的规则一一对应」 | 不完全对应，且 prompt 更**松**：prompt 说「对话里读过一次」，代码要求「这个文件有完整读取记录」。prompt 抓最常见的错，代码守全部边界 |
| 「`constants.ts` 只是堆字符串，没有逻辑所以不重要」 | 它是依赖图里的叶子：31 个文件靠它拿名字而不成环；一句错误文案还被 `FileWriteTool` 跨目录共享 |
| 「`description()` 那句才是给模型看的」 | 进 API 的是 `prompt()`（`utils/api.ts:171`）；`description()` 是给界面/日志的短描述 |

---

## 7. 动手验证（以下输出是我在本仓库真实跑出来的）

**① 常量被多少文件引用**

```bash
grep -rl "FILE_EDIT_TOOL_NAME" source/src --include=*.ts --include=*.tsx | wc -l
grep -rn "FILE_EDIT_TOOL_NAME" source/src --include=*.ts --include=*.tsx | wc -l
```

实际输出：

```
31
80
```

31 个文件、80 处（含 `constants.ts` 自己的定义处）。`getPreReadInstruction` 没有 export，只有 `prompt.ts` 第 22 行调用——「只为拼这一句而生」；对外出口 `getEditToolDescription` 的调用方只有 `FileEditTool.ts:95`。

**② 硬约束的几个码**

```bash
grep -n "errorCode: 6\|errorCode: 7\|errorCode: 9" source/src/tools/FileEditTool/FileEditTool.ts
```

实际输出：

```
285:        errorCode: 6,
307:            errorCode: 7,
341:        errorCode: 9,
```

第 6 个码对应「没读过」，第 7 个对应「读过又被改」，第 9 个对应「多处匹配」——正是 prompt 第 22、23、26 行提前说过的三种失败。

---

## 8. 合书自测

1. 这条规矩在两处各写了一遍，措辞差别是什么？为什么 prompt 说得比代码松？
2. 如果删掉 `constants.ts`，把 `FILE_EDIT_TOOL_NAME` 写进 `FileEditTool.ts` 再让其他 30 个文件 import 它，会怎样？
3. `readFileState` 是谁写的？`FileEditTool` 和 `FileReadTool` 之间有直接 import 吗？
4. 第 24–25 行那两条规则为什么做不成 `errorCode`？
5. 模型忽略 prompt、直接改没读过的文件，会在哪一行被拦下、返回什么？

<details>
<summary>参考答案（先自己写，再展开）</summary>

1. prompt 说「对话里至少用过一次 Read」；代码要求「**这个文件**有完整读取记录，且读后没被改过」。prompt 更松，因为它要短、要抓最常见失败（完全不读就改）；代码要严，因为它是最后一道门。
2. 会成环：`FileEditTool.ts` 已 import 权限、UI、utils，那 30 个文件（含权限层、压缩层、子 agent 定义）再来 import 工具本体，就形成「权限 → 工具 → 权限」的环。环的代价是模块初始化顺序变成隐式状态。
3. 由 `FileReadTool.ts:842`、`:1032` 写入（`BashTool.tsx:404` 也写），由 `FileEditTool.ts:275`、`:453` 读取。两个工具**没有直接 import**，只共享 `toolUseContext` 里的 map——用共享数据代替互相调用。
4. 没有客观判据。「是否优先改已有文件」要看意图，「是否该加 emoji」要看用户有没有要求，代码判不出来。
5. 在 `FileEditTool.ts:276` 的 `if (!readTimestamp || readTimestamp.isPartialView)` 被拦下，返回 `errorCode: 6`，消息是 `File has not been read yet. Read it first before writing to it.`

</details>

---

## 9. 下一课时

- 下一课：[L3-04 压缩三小件](./L3-04-压缩三小件.md)——换一种多文件关系：不是共享常量，而是同一条流水线上的三个工位。
- 想确认自己的位置：[零基础学习路线 · L3-3](../00-零基础学习路线.md)
- 想补工具系统全景：[工具系统](../04-工具系统.md)
