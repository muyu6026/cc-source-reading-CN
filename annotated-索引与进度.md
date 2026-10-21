# 源码中文批注版 · 索引与进度

> 这里放的是**原文批注版代码**：英文原注释一字不删，每段英文下方紧跟中文对照。
> 顺序完全按 [README 的学习路线](README.md#学习路线七步按顺序读) 走，一步一步来。
>
> 注：本文件放在**根目录**（不在 `annotated/` 里）。因为它属于手册自身的导航，不是源码镜像的一部分 —— `annotated/` 里只放「与 `source/` 同路径」的文件。

---

## `annotated/` 的结构规则（一句话）

**把路径第一段的 `source` 换成 `annotated`，其余一个字都不动。**

```
source/src/setup.ts                 →  annotated/src/setup.ts
source/src/commands/clear/index.ts  →  annotated/src/commands/clear/index.ts
source/package.json                 →  annotated/package.json.annotated.md   ← 例外 1
source/README.md                    →  annotated/README.annotated.md         ← 例外 2
```

两个例外都带 `.annotated.md` 后缀，原因不同：

| 例外 | 为什么改名 |
|------|-----------|
| `package.json.annotated.md` | JSON 里写不了注释，只能改成 md 用「原片段 + 中文说明」对照 |
| `README.annotated.md` | 避免与手册根目录的 `README.md`（主索引）同名不同物，一眼分不清看的是哪一份 |

除这两类之外，`annotated/` 下**不应出现**任何镜像之外的文件（导航、进度、校验脚本都放外面）。
另外：`annotated/` 不是 `source/` 的全量副本 —— `source/src` 有 1902 个文件，这里只批注学习路线走到的那些。

---

## 为什么要单独建 `annotated/`，而不直接改 `source/`

直接在 `source/src/entrypoints/cli.tsx` 里插中文行，会让**后面所有行号整体下移**。而本手册的 15 篇正文里有 **225 处源码链接、48 个精确行号锚点**（如 `Tool.ts:362-416`）——一旦行号漂移，全部失效，而且每加一批注释就要重新校一遍。

所以拆成两套，各管一件事：

| 目录 | 用途 | 是否改动 |
|------|------|---------|
| `source/` | **原版**，行号基准。正文里的链接都指向它 | 永不改动 |
| `annotated/` | **批注版**，学习时读这份 | 持续增补 |

好处：任何时候都能「左边看中文批注、右边对照原版」，两边行号不会互相污染。

---

## 批注约定

代码文件（`.ts` / `.tsx`）里，标注方式固定为四种：

```ts
// Bugfix for corepack auto-pinning, which adds yarnpkg to peoples' package.jsons
// 译：修掉 corepack 自动 pin 的 bug —— 它会把 yarnpkg 写进用户自己的 package.json
process.env.COREPACK_ENABLE_AUTO_PIN = '0';
// 注：COREPACK_ENABLE_AUTO_PIN=0 的意思是「别自动往 package.json 里写 packageManager 字段」。
```

| 标记 | 含义 |
|------|------|
| 原文 | 英文原注释，**一个字都不删** |
| `// 译：` | 紧跟英文之后，是对这段英文的**直译** |
| `// 注：` | 我额外补充的解释（原文没有这句），通常是「为什么这么写」「坑在哪」 |
| `// ── N. xxx ──` | 段落分隔，方便在大文件里定位 |

不支持注释的文件（`.json`）改用 `<原名>.annotated.md`，用「原片段 + 中文说明」对照。Markdown 文件（如仓库自述 `README.md` → `README.annotated.md`）直接在每段英文下方写中文。

**怎么验证没改坏原文**：跑 `python scripts/check-fidelity.py`。它把批注版拆成「代码行 / 注释行 / 批注行」三堆，然后要求：

1. 代码行与原文**逐行完全相等**（少一个 `}` 也会被点名）
2. 原文每行注释都按原顺序出现在批注版里（英文被改写会被抓出来）

只允许变多，不允许变样。

---

## 进度总表

| 学习路线的步骤 | 涉及文件 | 批注版位置 | 状态 |
|---------------|---------|-----------|------|
| **第 1 步** 先认门面（30 分钟） | `package.json` | [`package.json.annotated.md`](annotated/package.json.annotated.md) | ✅ 完成 |
| | `README.md`（仓库自带的） | [`README.annotated.md`](annotated/README.annotated.md) | ✅ 完成 |
| | `src/entrypoints/cli.tsx`（302 行，全文件） | [`src/entrypoints/cli.tsx`](annotated/src/entrypoints/cli.tsx) | ✅ 完成 |
| **第 2 步** 读一个最小模块（1 小时） | `src/commands/clear/index.ts`（19 行） | [`src/commands/clear/index.ts`](annotated/src/commands/clear/index.ts) | ✅ 完成 |
| | `src/tools/BashTool/commandSemantics.ts`（141 行） | [`src/tools/BashTool/commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts) | ✅ 完成 |
| **第 3 步** 读初始化流程（2 小时） | `src/setup.ts`（477 行） | [`src/setup.ts`](annotated/src/setup.ts) | ✅ 完成 |
| **第 4 步** 读工具系统（半天）★ | `src/Tool.ts`、`src/tools.ts`、`BashTool/` | [`Tool.ts`](annotated/src/Tool.ts) ✅<br>[`tools.ts`](annotated/src/tools.ts) ✅<br>[`BashTool.tsx`](annotated/src/tools/BashTool/BashTool.tsx) ✅<br>[`bashSecurity.ts`](annotated/src/tools/BashTool/bashSecurity.ts) ✅<br>`bashPermissions` ⬜ | 🚧 主体完成 |
| **第 5 步** 读主循环（1 天）★★ | `src/constants/prompts.ts`、`src/query.ts`、`src/QueryEngine.ts`、`src/services/api/` | — | ⬜ 待做 |
| **第 6 步** 读服务层（半天） | `src/services/` 各模块 | — | ⬜ 待做 |
| **第 7 步** UI 与多智能体（可选） | `src/components/`、`src/ink/`、`src/coordinator/` | — | ⬜ 待做 |

---

## 第 1 步读完了吗？三个自测问题

读完这三个文件，你应该能不看资料答出下面三题。答不出就说明还没读透，回去补：

**Q1**：用户敲 `claude --version`，从敲下回车到看到版本号，一共加载了几个模块？

<details><summary>点开看答案</summary>

**只有 1 个** —— 就是 `cli.tsx` 自己。

`cli.tsx` 第 37-42 行：只要参数正好是一个 `--version` / `-v` / `-V`，直接 `console.log` 后 `return`，连 `startupProfiler` 都还没加载。文件头注释里那句 `Fast-path for --version has zero imports beyond this file`（译：--version 这条快速路径除了本文件之外零导入）说的就是这个。

</details>

**Q2**：为什么 `cli.tsx` 里所有的 `import` 都写成 `await import(...)`，而不是文件顶部一次性导入？

<details><summary>点开看答案</summary>

**为了让「快速路径」不加载用不上的模块。**

`main.js` 有 789 KB、4600 行。如果顶部就 `import { main } from '../main.js'`，那么连 `claude --version` 都得先把这 789 KB 解析、求值一遍，启动要慢上千毫秒。写成动态 `await import()`，只有真正走到那一步才加载。

**代价**：代码里到处是解构赋值（`const { x } = await import(...)`），比静态导入啰嗦得多。这是拿可读性换启动速度。

</details>

**Q3**：`package.json` 里 `dependencies` 是空的，那它用的 React、Ink、zod 都从哪来？

<details><summary>点开看答案</summary>

**被打包器（Bun）内联进产物了。**

发布出去的是一个自包含的包，所有依赖的代码都被塞进了最终产物文件里，所以 `package.json` 不需要声明依赖。

**后果**：`npm install` 之后跑不起来（缺 100 多个包）。所以这个仓库只能当**源码阅读对象**，不能当可运行工程。

</details>

---

## 第 2 步读完了吗？四个自测问题

这两个文件合起来只有 160 行，但踩中了三类关键设计：惰性加载、能力门禁、语义判定。四题都能答出来才算读过：

**Q1**：用户敲 `/clear`，**哪一行**代码才真正把 `clear` 的实现加载进来？本文件里的 `load` 是什么时候执行的？

<details><summary>点开看答案</summary>

加载发生在 **`src/utils/processUserInput/processSlashCommand.tsx:668`**：

```ts
const mod = await command.load()   // ← 到这一行才真的去读 clear.js
const result = await mod.call(args, context)
```

`clear/index.ts` 里的 `load: () => import('./clear.js')` 只是一个**没被调用的箭头函数**。启动时它躺在命令表里，什么也不做；只有用户真的敲了 `/clear`，才有人去调它。

这就是"元信息与实现分离"：启动只付几十字节的代价，实现（以及它 import 的一堆东西）推迟到用的时候。

</details>

**Q2**：`supportsNonInteractive: false` 具体会造成什么后果？是哪一行代码在管这件事？

<details><summary>点开看答案</summary>

后果：**`-p`（headless / 管道脚本）模式下 `/clear` 根本不在命令列表里**，敲了也匹配不到。

管这事的是 `src/main.tsx:2622`：

```ts
commands.filter(command =>
  command.type === 'prompt' && !command.disableNonInteractive
  || command.type === 'local' && command.supportsNonInteractive)
```

注意这是「白名单」写法：`local` 命令必须**显式为 true** 才能进 headless 列表，不写等于不能用。

原注释 `// Should just create a new session` 说明了理由：headless 是一次性执行，没有"会话"可清空；想要干净上下文就换个新进程。

</details>

**Q3**：模型跑 `grep foo x.txt` 没匹配到（退出码 1），这次工具调用算**成功**还是**失败**？那退出码 2 呢？

<details><summary>点开看答案</summary>

**退出码 1 → 算成功。** 查表命中 `grep` 条目，`isError = exitCode >= 2` → `1 >= 2` 为 false，于是不抛错，输出照常交给模型。

**退出码 2 → 算失败。**（grep 的 2 通常是正则语法错误、文件读不了这类真问题。）此时 `isError` 为 true，`BashTool.tsx:714` 会：

```ts
throw new ShellError('', outputWithSbFailures, result.code, result.interrupted)
```

所以"表里加不加一条"影响的不只是提示文案，而是**这次工具调用成不成立**。

</details>

**Q4**：`cd /tmp && grep -r foo .` 会匹配到哪条语义？`grep foo x || echo none` 为什么会被算错？

<details><summary>点开看答案</summary>

**第一问**：`splitCommand_DEPRECATED` 按 `&&` 拆成两段 → 取**最后一段** `grep -r foo .` → 取首词 `grep` → 命中表。取最后一段是因为 shell 的退出码 = 最后执行的那条命令。

**第二问**：`||` 的情况，最后一段是 `echo none`，于是查 `echo` → 查不到 → 走默认语义（非 0 即错）。但真实退出码是 `echo` 的 0，所以这次判断**碰巧不算错**；反过来 `grep foo x | head` 的退出码其实来自 `head`（管道最后一段），也会和直觉不同。

作者在 `heuristicallyExtractBaseCommand` 上明写了 `May get it super wrong - don't depend this for security`。这是全文件最该记住的一句：**这套解析只用来挑提示语，绝不参与权限判断**（权限走 `src/utils/permissions/` 里的真解析器）。

</details>

**顺带一个读源码才看得出的不一致**：`CommandSemantic` 返回值里的 `message`，在 Bash 侧**压根没被用过**——`PowerShellTool.tsx:649` 把它塞进了 `returnCodeInterpretation`，而 `BashTool.tsx:696/714` 只读 `isError`。所以 `'No matches found'`、`'Files differ'` 这些提示语写了但不会出现在模型眼前。（可以顺手改进，也是"文档说要怎样"和"代码实际怎样"之间的典型缝隙。）

---

## 第 3 步读完了吗？四个自测问题

`setup.ts` 有 477 行，但没有一行在做业务计算 —— 它全是"按正确顺序调用别人的函数"。所以自测题都不问"这行算什么"，只问顺序和分级。

**Q1**：为什么 `setCwd()` 必须在 `captureHooksConfigSnapshot()` 之前？如果反过来会出什么症状？

<details><summary>点开看答案</summary>

因为 hook 配置是从 **`<cwd>/.claude/settings.json`** 读的。cwd 没定就去抓快照，读到的可能是上一个目录的配置。

症状很隐蔽：**不报错**，只表现为"我的 hook 有时候生效、有时候不生效"，或者"在 A 项目里配的 hook 在 B 项目也触发了"。这类"顺序错了但不崩"的 bug 最难查。

源码里连写两行大写 `IMPORTANT` 就是在防这件事。

</details>

**Q2**：`main.tsx:1927` 让 `setup()` 和 `getCommands()` 并行跑，因此产生过一个 bug。那个 bug 是什么、怎么修的？

<details><summary>点开看答案</summary>

**bug**：内置技能/插件的注册原先写在 `setup()` 里，但它前面有约 20ms 的 `await`（UDS socket）。而并行的 `getCommands()` 已经跑完并 **memoize** 了结果 —— 缓存里没有内置技能。等 `setup()` 走到注册那一步，命令表早就定死了。

**修法**：不是加锁，而是把注册**挪到并行启动点之前**（`main.tsx:1923-1926`），让它变成纯内存的数组 push（<1ms、零 IO），必然先于 `getCommands()`。

**教训**：并行化会把"隐式顺序依赖"变成竞态；只要有 memoize，谁先算谁定终身。

同一个文件里还有第二处竞态（插件预取 vs 同步安装），那个**没法**靠调顺序解决，只能用 `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` 彻底不同时做。能靠顺序解决的用顺序，不能的用开关。

</details>

**Q3**：`void lockCurrentVersion()` 里的 `void` 到底做了什么？代价是什么？

<details><summary>点开看答案</summary>

`void` **不改变任何运行时行为** —— 它只是告诉读代码的人和 lint 工具："我知道这是个 Promise，我故意不等它。"

目的：让"装监听器 / 抢锁 / 预热缓存"这类工作不拖慢启动。

**代价**：没人 `catch`，失败就变成 `unhandledRejection`。所以 `main.tsx:1932` 给这些 promise 挂了 `.catch(() => {})` —— 防止启动那 28ms 窗口里的瞬时 rejection 把进程搞崩。

</details>

**Q4**：`--dangerously-skip-permissions` 会做哪些环境校验？为什么 `NODE_ENV === 'test'` 的提前返回放在校验**之后**而不是函数开头？

<details><summary>点开看答案</summary>

**两道闸**：

1. **root 检查**（对所有平台）：是 root 且不在沙箱（`IS_SANDBOX` / bubblewrap 都没有）→ 直接退出。
2. **沙箱 + 断网检查**（仅内部员工、排除 Desktop 两个入口）：必须 `isSandboxed && !hasInternet`。也就是"不在沙箱"或"能上网"都拒绝 —— 因为在沙箱里且离线时，模型乱来的破坏范围被容器和断网限制住了。

**为什么 test 的 return 放在最后**：如果放在函数开头，测试就永远覆盖不到这两道闸 —— 而安全逻辑恰恰最需要被测到。这在源码里也有一句对应的话：`--dangerously-skip-permissions safety gate ... must still run`，说明安全门禁**不受任何模式开关影响**。

</details>

---

## 第 4 步（`Tool.ts` 契约）读完了吗？四个自测问题

`Tool.ts` 792 行里只有 40 行是可执行代码，其余全是类型。所以自测题都不问"语法"，只问"这个字段为什么必须存在"。

**Q1**：`call()` 的第 3 个参数 `canUseTool` 为什么不放进 `ToolUseContext`？

<details><summary>点开看答案</summary>

因为它是**能力凭证**，不是**环境**。

实测：没有任何一个工具在自己的 `call()` 里调用它（5 个工具直接把它命名为 `_canUseTool`，下划线表示不用）。它真正的用途是**往下传** —— `AgentTool`、`SendMessageTool`、`SkillTool` 把它递给子代理的 `runAgent()`，因为子代理执行工具时也要过权限关。

`ToolUseContext` 的其余字段会被 `createSubagentContext` 改写（`setAppState` 甚至被改成空操作），唯独这个凭证必须**原样透传**。放进 context 就会被一起改写，权限链就断了。

</details>

**Q2**：`description()` 和 `prompt()` 都返回"说明文本"，分别给谁看？为什么一个要收 `toolPermissionContext`？

<details><summary>点开看答案</summary>

读者完全不同：

- `prompt()` → **模型**。它就是 API 请求里的 `description` 字段（`utils/api.ts:171`）。所以要长、要全、要带规则和示例。
- `description()` → **人**。实测只有两个调用点：`hooks/useCanUseTool.tsx:56`（权限对话框"这个工具要干什么"）和 `MCPToolDetailView.tsx:70`（详情页）。所以要短、是人话、能带着**具体参数**说清后果。

`description()` 收 `toolPermissionContext`，是因为同一句"将执行 `rm -rf /tmp/x`"，在 bypass 模式下该说"将直接执行"，在 default 模式下该说"将请求你批准"。**说明文本要跟着权限语境变**。

</details>

**Q3**：为什么 `Read` 的 `maxResultSizeChars` 要写 `Infinity`，写 `1e9` 不行吗？

<details><summary>点开看答案</summary>

不行，因为 `Infinity` 在这里是**哨兵值**，不是"一个很大的数"。

`query.ts:391` 是这么筛的：

```ts
.filter(t => !Number.isFinite(t.maxResultSizeChars))
```

`Number.isFinite(1e9)` 是 `true`，所以 `1e9` 会被当成普通工具参与预算计算；只有 `Infinity` 才会被排除。

为什么要排除 Read？源码注释写得很直白：Read 的结果落盘，会导致 **Read → 结果文件 → 再 Read 它** 的循环，指数级放大。而 Read 本身已经用 `fileReadingLimits` 自我约束了。

</details>

**Q4**：一个工具明明返回了 `contextModifier`，却没有任何效果，而且不报错。最可能是什么原因？

<details><summary>点开看答案</summary>

它的 `isConcurrencySafe()` 返回了 `true`。

`Tool.ts:329` 那句注释是全文最容易被忽略的一句：**"contextModifier is only honored for tools that aren't concurrency safe."**

对照 `StreamingToolExecutor.ts:391`：

```ts
if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
```

并发批次里即使返回了也直接丢弃，**静默**。原因也很充分：并发跑的工具如果都能改共享 context，改的顺序就不确定（A 改了 cwd，B 还在按旧 cwd 算路径）。所以"要么串行执行、要么不改环境"，二选一。

</details>

**顺带两个读源码才看得出的问题**（不设问，直接给结论）：

1. **`isDestructive` 是个事实上的死字段** —— 三个外部调用点全部写成 `tool.isDestructive?.({})`（`print.ts:1661`、`MCPToolListView.tsx:62`、`MCPToolDetailView.tsx:48`），传的是空对象；而 `ExitWorktreeTool.ts:168` 的实现是 `return input.action === 'remove'`，永远拿到 `undefined`。结果：CLI 的 MCP 列表里永远不会出现 `[destructive]` 标记。

2. **这份源码不能 `tsc`** —— `Tool.ts` 依赖的 `src/types/message.ts`、`src/types/tools.ts`、`src/types/utils.ts` 在仓库里**不存在**（`types/message.ts` 被 75 个文件 import，是缺失最多的一个）。不影响阅读：全是 `import type`，打包时被整段擦除。副作用是 `DeepImmutable<T>` 的定义看不到，只能按用法推断为"递归 readonly"。

---

---

## 第 4 步后半（`tools.ts` + `BashTool.tsx`）读完了吗？四个自测问题

**1. 四个"取工具列表"的函数，谁是谁？**

`getAllBaseTools()` 是全量清单（不做过滤）；`getTools(ctx)` 在它基础上滤掉特殊工具、deny 规则、`isEnabled()` 为假的；`filterToolsByDenyRules()` 只做 deny 过滤（MCP 工具也要过）；`assembleToolPool(ctx, mcp)` 才是真正在用的"内置 + MCP 合并"。
那 `getMergedTools()` 呢？**它是死代码，外部调用点 0 个。**

**2. `feature('KAIROS')` 和 `process.env.USER_TYPE === 'ant'` 差在哪？**

前者是**构建期**开关 —— 关闭时整段代码被死代码消除删掉，运行时根本不存在，`cli.js` 里一个字节都没有。后者是**运行期**开关 —— 代码进了包，只是对非员工恒为 false。源码里两种写法混用，看着像一回事，其实是两个世界。

**3. `BashTool` 的 `data.stderr` 为什么不装子进程的错误输出？**

因为子进程用了 merged fd（stderr 并进 stdout）。`result.stdout` 里混着两者，且是**真实交错顺序**。`stderr` 字段只在一种情况下有内容：命令把 cwd 改到项目外、被强制拉回时的一句提示。所以埋点里的 `stderr_length: 0` 是写死的常量，不是 bug。

**4. `_simulatedSedEdit` 为什么必须从给模型的 schema 里 omit？**

它不是"内部字段不方便暴露"，而是**安全边界**。一旦模型能填它，就能拿一条无害命令配一次任意文件写入，同时绕开权限检查和沙箱。所以代码用 `fullInputSchema`（含全字段），模型用 `inputSchema`（omit 掉它）——**同一份类型，两套 schema**。

<details>
<summary>点开看三个读源码才看得出的问题</summary>

1. **`specialTools` 里有一条永远不命中** —— `SYNTHETIC_OUTPUT_TOOL_NAME` 被放进过滤集合，但它**根本不在** `getAllBaseTools()` 的清单里。过滤一个不存在的东西，无害，但说明清理时漏了一行。

2. **`BashTool.userFacingName` 里藏着一次 P0 事故的修复**（源码注释 issue #21605）：`shouldUseSandbox → splitCommand → shell-quote` 每次调用都 `new RegExp`，而这个函数对历史里每条 bash 消息都在每次渲染时跑一遍。50 条消息就超过 shimmer 的 tick 间隔 → 动画中断 → 无限重试。修法不是加缓存，而是**把最便宜的判断提到最前面**（先查环境变量），让绝大多数用户根本不执行后面的重活。

3. **`assembleToolPool` 为什么要分两段排序** —— 不是代码风格，是**钱**。服务端在"最后一个内置工具"之后放缓存断点，如果 MCP 工具被整体排序插进内置工具中间，断点之前的序列就变了，prompt cache 全失效，每次请求按全价计费。一个排序细节直接连着运营成本。

</details>

---

## 第 4 步 · `bashSecurity.ts`（2,592 行）读完了吗？四个自测问题

<details>
<summary>点开看四个问题</summary>

**1. `earlyValidators` 里三个 validator 明明返回 `allow`，为什么调用方要把它降级成 `passthrough`？**

因为本函数的结论会被 `bashPermissions` 当成"安全许可"。如果它能返回 allow，那么一个误判就等于**一次自动执行**（跳过规则匹配、分类器、用户确认）。降级成 passthrough 的语义是"我这关没意见，请继续走正常权限流程"——安全检查的能力被限制成**只能否决、不能批准**。副作用：`updatedInput` 变成没人读的死数据。

**2. `nonMisparsingValidators` 只有两个成员。`validateCarriageReturn` 为什么刻意不在里面？**

CR 是**解析器打架**：JS 的 `\s` 包含 `\r`，bash 的 IFS 不含。所以 `TZ=UTC\recho curl evil.com` 在 validator 眼里是 `echo curl evil.com`（命中 `Bash(echo:*)` 允许规则），在 bash 眼里是 `curl evil.com`。放进 `nonMisparsingValidators` 就意味着它的 ask 只值"问一声"、用户可能点允许——而"解析器不可信"的命令不允许被允许。

**3. `isSafeHeredoc` 为什么必须逐行找闭合分隔符，不能用 `[\s\S]*?`？**

懒惰匹配会跳过第一个 `DELIM` 去找后面的 `DELIM)`，把中间的命令当成 body。而 bash 在**第一个**匹配行就闭合了。样本：

```
$(cat <<'EOF'
data
EOF
; rm -rf /
EOF)
```

`[\s\S]*?` 认为 body 是 `data\nEOF\n; rm -rf /`，全在 heredoc 里；bash 在第 3 行闭合，`rm -rf /` 是真命令。

**4. 一条命令过了 `bashToolHasPermission`，但它不是"绝对安全"，只是"权限判定通过了"。为什么这个区别在 `BashTool` 里很要紧？**

因为 `bashSecurity` 只回答"我能不能信任我对这条命令的解析"。它**不知道**用户配了什么规则、当前是什么模式、沙箱是否开启。真正的放行是后面的事，而且可能是自动放行（acceptEdits 模式下全 cwd 路径的 `mv`）。所以"安全检测通过"绝不等于"这条命令无害"——`mv ./decoy '<\n>#' ~/.ssh/id_rsa ./exfil` 就是安全检测通过、权限判定自动允许、然后私钥被移走的例子。

</details>

<details>
<summary>点开看五个读源码才看得出的问题</summary>

1. **两个 `_DEPRECATED` 函数有 80% 是逐字重复** —— 两个前置检查、earlyValidators 循环、19 个 validator 数组、defer 循环全部复制粘贴。改一处必须改两处，漏改不报错，只让两条路径行为不一致。判断走哪条：调用者是 async 就走 async 那个。没有任何机制能发现这种同源分歧。

2. **heredoc 解析做了两遍** —— `isSafeHeredoc`（判安全）用 `line === delimiter`，`stripSafeHeredocSubstitutions`（只剥离）用 `line.startsWith(delimiter)`。同一条命令可能在一个函数里"不安全"、在另一个里"可剥离"。

3. **`UNICODE_WS_RE` 的清单不完整** —— 区间到 `\u200A` 为止，所以 `\u200B`（零宽空格）、`\u200C`/`\u200D`（ZWNJ/ZWJ）都不在检测范围内。但这**不构成漏洞**：这三个字符既不是 bash 的 IFS 成员，也不是 JS 的 `\s`，两个解析器都不当分隔符，没有差异可用。知道清单不完整、也知道为什么不完整，比盲目相信清单有用。

4. **`ZSH_DANGEROUS_COMMANDS` 里混了一个非命令** —— `mapfile` 不是可执行命令，是 `zmodload zsh/mapfile` 之后拿到的关联数组（赋值即写文件）。放进"base command 黑名单"里永远匹配不到。它的实际作用是**写给下一位维护者的备注**。

5. **`validateEmpty` 的 allow 消息用户永远看不到** —— "Empty command is safe" 被降级成 passthrough 的 message，而 passthrough 在最终返回时又被覆盖成 "Command passed all security checks"。空命令这个结论在任何日志里都不存在。

</details>

---

## 继续往下读之前

第 4 步只剩最后一个文件：[`src/tools/BashTool/bashPermissions.ts`](source/src/tools/BashTool/bashPermissions.ts) —— 2,621 行，`bashToolHasPermission` 就在这儿。

它和刚读完的 `bashSecurity.ts` 分工很清楚：**`bashSecurity` 回答"这条命令能不能被信任地解析"，`bashPermissions` 回答"这条命令要不要放行"**。后者会用到前者的结论（第 2085-2107 行那个 misparsing 闸门），再叠上规则匹配、沙箱判定、分类器、用户确认。

`BashTool.tsx` 里 `checkPermissions` 那一行只做转发，真正的判定全在这两个文件里。想彻底搞懂"AI 怎么安全地跑命令"，这两个必须读。

再往下是第 5 步（主循环）：`constants/prompts.ts`、`query.ts`、`QueryEngine.ts`、`services/api/`。

告诉我「继续 bashPermissions」或「继续第 5 步」，我就接着批注。


