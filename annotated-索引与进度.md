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

| 例外                          | 为什么改名                                       |
| --------------------------- | ------------------------------------------- |
| `package.json.annotated.md` | JSON 里写不了注释，只能改成 md 用「原片段 + 中文说明」对照         |
| `README.annotated.md`       | 避免与手册根目录的 `README.md`（主索引）同名不同物，一眼分不清看的是哪一份 |

除这两类之外，`annotated/` 下**不应出现**任何镜像之外的文件（导航、进度、校验脚本都放外面）。  
另外：`annotated/` 不是 `source/` 的全量副本 —— `source/src` 有 1902 个文件，这里只批注学习路线走到的那些。

---

## 为什么要单独建 `annotated/`，而不直接改 `source/`

直接在 `source/src/entrypoints/cli.tsx` 里插中文行，会让**后面所有行号整体下移**。而本手册的 15 篇正文里有 **225 处源码链接、48 个精确行号锚点**（如 `Tool.ts:362-416`）——一旦行号漂移，全部失效，而且每加一批注释就要重新校一遍。

所以拆成两套，各管一件事：

| 目录           | 用途                     | 是否改动 |
| ------------ | ---------------------- | ---- |
| `source/`    | **原版**，行号基准。正文里的链接都指向它 | 永不改动 |
| `annotated/` | **批注版**，学习时读这份         | 持续增补 |

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

| 标记                | 含义                                |
| ----------------- | --------------------------------- |
| 原文                | 英文原注释，**一个字都不删**                  |
| `// 译：`           | 紧跟英文之后，是对这段英文的**直译**              |
| `// 注：`           | 我额外补充的解释（原文没有这句），通常是「为什么这么写」「坑在哪」 |
| `// ── N. xxx ──` | 段落分隔，方便在大文件里定位                    |

不支持注释的文件（`.json`）改用 `<原名>.annotated.md`，用「原片段 + 中文说明」对照。Markdown 文件（如仓库自述 `README.md` → `README.annotated.md`）直接在每段英文下方写中文。

**怎么验证没改坏原文**：跑 `python scripts/check-fidelity.py`。它把批注版拆成「代码行 / 注释行 / 批注行」三堆，然后六条判据：

| # | 判据 | 拦什么 |
| --- | --- | --- |
| 1【硬】 | 代码行与原文**逐行完全相等** | 少一个 `}` 也会被点名 |
| 2【硬】 | 原文每行注释按原顺序出现在批注版里 | 英文被改写、被挤出顺序 |
| 3【硬】 | 块注释内部不许出现中文 | `/** */` 被中文从中间截断（语法合法，但难读） |
| 4【硬】 | 多行模板字符串内部不许出现中文 | 注释变成提示词正文（**代码行为被改变**） |
| 5【硬】 | 不劈开未结束的多行表达式 | `const x =` 后面插一段再给值 |
| 6【硬】 | 批注版不得含控制字符 | 批注里的 `\n`、`\0`、`\x1b` 被 Python 转义成真实字节（NUL 会让 `grep` 把文件当二进制，ESC 直接把转义序列写进源码） |

另外还有一条软统计：每个文件多了多少行注释，用来发现「批注密度突然异常」。

**两个自动例外**：

- 内联 `sourceMappingURL`（一行几万到十六万字符的 base64）会被换成一句中文说明，校验时标成 `OK*` 而不是失败。共 4 个文件命中（`cli.tsx` / `ink.tsx` / `AgentTool.tsx` / `BashTool.tsx`）
- 原文里 CRLF 行尾的文件，批注版统一成 LF（否则会是「代码行 CRLF + 批注行 LF」的混合行尾）。git 仓库里本来就存 LF，所以这一步在 diff 上看不出变化

然后跑 `python scripts/check-links.py` 检查所有 Markdown 链接（源码链接 + 文档内链）。

**总原则：只允许变多，不允许变样。**

---

## 进度总表

| 学习路线的步骤                 | 涉及文件                                                                               | 批注版位置                                                                                                                                                                                                                                                                                                       | 状态     |
| ----------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **第 1 步** 先认门面（30 分钟）   | `package.json`                                                                     | [`package.json.annotated.md`](annotated/package.json.annotated.md)                                                                                                                                                                                                                                          | ✅ 完成   |
|                         | `README.md`（仓库自带的）                                                                 | [`README.annotated.md`](annotated/README.annotated.md)                                                                                                                                                                                                                                                      | ✅ 完成   |
|                         | `src/entrypoints/cli.tsx`（302 行，全文件）                                               | [`src/entrypoints/cli.tsx`](annotated/src/entrypoints/cli.tsx)                                                                                                                                                                                                                                              | ✅ 完成   |
| **第 2 步** 读一个最小模块（1 小时） | `src/commands/clear/index.ts`（19 行）                                                | [`src/commands/clear/index.ts`](annotated/src/commands/clear/index.ts)                                                                                                                                                                                                                                      | ✅ 完成   |
|                         | `src/tools/BashTool/commandSemantics.ts`（141 行）                                    | [`src/tools/BashTool/commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts)                                                                                                                                                                                                                | ✅ 完成   |
| **第 3 步** 读初始化流程（2 小时）  | `src/setup.ts`（477 行）                                                              | [`src/setup.ts`](annotated/src/setup.ts)                                                                                                                                                                                                                                                                    | ✅ 完成   |
| **第 4 步** 读工具系统（半天）★    | `src/Tool.ts`、`src/tools.ts`、`BashTool/`                                           | [`Tool.ts`](annotated/src/Tool.ts) ✅<br />[`tools.ts`](annotated/src/tools.ts) ✅<br />[`BashTool.tsx`](annotated/src/tools/BashTool/BashTool.tsx) ✅<br />[`bashSecurity.ts`](annotated/src/tools/BashTool/bashSecurity.ts) ✅<br />[`bashPermissions.ts`](annotated/src/tools/BashTool/bashPermissions.ts) ✅ | ✅ 完成   |
| **第 5 步** 读主循环（1 天）★★   | `src/constants/prompts.ts`、`src/query.ts`、`src/QueryEngine.ts`、`src/services/api/` | [`prompts.ts`](annotated/src/constants/prompts.ts) ✅<br />[`query.ts`](annotated/src/query.ts) ✅<br />[`QueryEngine.ts`](annotated/src/QueryEngine.ts) ✅<br />[`claude.ts`](annotated/src/services/api/claude.ts) ✅                                                                                         | ✅ 完成   |
| **第 6 步** 读服务层（半天）      | `src/services/` 各模块                                                                | [`withRetry.ts`](annotated/src/services/api/withRetry.ts) ✅<br />[`compact/` 全 11 个文件](annotated/src/services/compact/) ✅<br />[`mcp/client.ts`](annotated/src/services/mcp/client.ts) ✅<br />[`mcp/config.ts`](annotated/src/services/mcp/config.ts) ✅<br />[`mcp/auth.ts`](annotated/src/services/mcp/auth.ts) ✅<br />[`mcp/xaa*.ts`](annotated/src/services/mcp/xaa.ts) ✅<br />[`useManageMCPConnections.ts`](annotated/src/services/mcp/useManageMCPConnections.ts) ✅ | ✅ 完成 |
| **第 7 步** UI 与多智能体（可选）  | `src/components/`、`src/ink/`、`src/coordinator/`                                    | [`coordinatorMode.ts`](annotated/src/coordinator/coordinatorMode.ts) ✅<br />[`AgentTool.tsx`](annotated/src/tools/AgentTool/AgentTool.tsx) ✅<br />[`AgentTool/prompt.ts`](annotated/src/tools/AgentTool/prompt.ts) ✅<br />[`forkSubagent.ts`](annotated/src/tools/AgentTool/forkSubagent.ts) ✅ | ✅ 多智能体主线完成 |
| **第 8 步** 终端渲染器（进阶，可选） | `src/ink/`（自研 Ink，1.3 万行）                                                        | [`reconciler.ts`](annotated/src/ink/reconciler.ts) ✅<br />[`dom.ts`](annotated/src/ink/dom.ts) ✅<br />[`ink.tsx`](annotated/src/ink/ink.tsx) ✅<br />[`screen.ts`](annotated/src/ink/screen.ts) ✅<br />[`render-node-to-output.ts`](annotated/src/ink/render-node-to-output.ts) ✅<br />[`log-update.ts`](annotated/src/ink/log-update.ts) ✅ | ✅ 三上三下全通 |

---

## 第 1 步读完了吗？三个自测问题

读完这三个文件，你应该能不看资料答出下面三题。答不出就说明还没读透，回去补：

**Q1**：用户敲 `claude --version`，从敲下回车到看到版本号，一共加载了几个模块？

<details>

<summary>\*\*只有 1 个\** —— 就是 \`cli.tsx\` 自己。</summary>

`cli.tsx` 第 37-42 行：只要参数正好是一个 `--version` / `-v` / `-V`，直接 `console.log` 后 `return`，连 `startupProfiler` 都还没加载。文件头注释里那句 `Fast-path for --version has zero imports beyond this file`（译：--version 这条快速路径除了本文件之外零导入）说的就是这个。

</details>

**Q2**：为什么 `cli.tsx` 里所有的 `import` 都写成 `await import(...)`，而不是文件顶部一次性导入？

<details>

<summary>\*\*为了让「快速路径」不加载用不上的模块。\*\*</summary>

`main.js` 有 789 KB、4600 行。如果顶部就 `import { main } from '../main.js'`，那么连 `claude --version` 都得先把这 789 KB 解析、求值一遍，启动要慢上千毫秒。写成动态 `await import()`，只有真正走到那一步才加载。

**代价**：代码里到处是解构赋值（`const { x } = await import(...)`），比静态导入啰嗦得多。这是拿可读性换启动速度。

</details>

**Q3**：`package.json` 里 `dependencies` 是空的，那它用的 React、Ink、zod 都从哪来？

<details>

<summary>\*\*被打包器（Bun）内联进产物了。\*\*</summary>

发布出去的是一个自包含的包，所有依赖的代码都被塞进了最终产物文件里，所以 `package.json` 不需要声明依赖。

**后果**：`npm install` 之后跑不起来（缺 100 多个包）。所以这个仓库只能当**源码阅读对象**，不能当可运行工程。

</details>

---

## 第 2 步读完了吗？四个自测问题

这两个文件合起来只有 160 行，但踩中了三类关键设计：惰性加载、能力门禁、语义判定。四题都能答出来才算读过：

**Q1**：用户敲 `/clear`，**哪一行**代码才真正把 `clear` 的实现加载进来？本文件里的 `load` 是什么时候执行的？

<details>

<summary>加载发生在 \*\*\`src/utils/processUserInput/processSlashCommand.tsx:668\`\*\*：</summary>

```ts
const mod = await command.load()   // ← 到这一行才真的去读 clear.js
const result = await mod.call(args, context)
```

`clear/index.ts` 里的 `load: () => import('./clear.js')` 只是一个**没被调用的箭头函数**。启动时它躺在命令表里，什么也不做；只有用户真的敲了 `/clear`，才有人去调它。

这就是"元信息与实现分离"：启动只付几十字节的代价，实现（以及它 import 的一堆东西）推迟到用的时候。

</details>

**Q2**：`supportsNonInteractive: false` 具体会造成什么后果？是哪一行代码在管这件事？

<details>

<summary>后果：\*\*\`-p\`（headless / 管道脚本）模式下 \`/clear\` 根本不在命令列表里\*\*，敲了也匹配不到。</summary>

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

<details>

<summary>\*\*退出码 1 → 算成功。\** 查表命中 \`grep\` 条目，\`isError = exitCode >= 2\` → \`1 >= 2\` 为 false，于是不抛错，输出照常交给模型。</summary>

**退出码 2 → 算失败。**（grep 的 2 通常是正则语法错误、文件读不了这类真问题。）此时 `isError` 为 true，`BashTool.tsx:714` 会：

```ts
throw new ShellError('', outputWithSbFailures, result.code, result.interrupted)
```

所以"表里加不加一条"影响的不只是提示文案，而是**这次工具调用成不成立**。

</details>

**Q4**：`cd /tmp && grep -r foo .` 会匹配到哪条语义？`grep foo x || echo none` 为什么会被算错？

<details>

<summary>\*\*第一问\*\*：\`splitCommand_DEPRECATED\` 按 \`&&\` 拆成两段 → 取\*\*最后一段\** \`grep -r foo .\` → 取首词 \`grep\` → 命中表。取最后一段是因为 shell 的退出码 = 最后执行的那条命令。</summary>

**第二问**：`||` 的情况，最后一段是 `echo none`，于是查 `echo` → 查不到 → 走默认语义（非 0 即错）。但真实退出码是 `echo` 的 0，所以这次判断**碰巧不算错**；反过来 `grep foo x | head` 的退出码其实来自 `head`（管道最后一段），也会和直觉不同。

作者在 `heuristicallyExtractBaseCommand` 上明写了 `May get it super wrong - don't depend this for security`。这是全文件最该记住的一句：**这套解析只用来挑提示语，绝不参与权限判断**（权限走 `src/utils/permissions/` 里的真解析器）。

</details>

**顺带一个读源码才看得出的不一致**：`CommandSemantic` 返回值里的 `message`，在 Bash 侧**压根没被用过**——`PowerShellTool.tsx:649` 把它塞进了 `returnCodeInterpretation`，而 `BashTool.tsx:696/714` 只读 `isError`。所以 `'No matches found'`、`'Files differ'` 这些提示语写了但不会出现在模型眼前。（可以顺手改进，也是"文档说要怎样"和"代码实际怎样"之间的典型缝隙。）

---

## 第 3 步读完了吗？四个自测问题

`setup.ts` 有 477 行，但没有一行在做业务计算 —— 它全是"按正确顺序调用别人的函数"。所以自测题都不问"这行算什么"，只问顺序和分级。

**Q1**：为什么 `setCwd()` 必须在 `captureHooksConfigSnapshot()` 之前？如果反过来会出什么症状？

<details>

因为 hook 配置是从 \*\*\`<cwd>/.claude/settings.json\`\** 读的。cwd 没定就去抓快照，读到的可能是上一个目录的配置。

症状很隐蔽：**不报错**，只表现为"我的 hook 有时候生效、有时候不生效"，或者"在 A 项目里配的 hook 在 B 项目也触发了"。这类"顺序错了但不崩"的 bug 最难查。

源码里连写两行大写 `IMPORTANT` 就是在防这件事。


</details>

**Q2**：`main.tsx:1927` 让 `setup()` 和 `getCommands()` 并行跑，因此产生过一个 bug。那个 bug 是什么、怎么修的？

<details>

<summary>\*\*bug\*\*：内置技能/插件的注册原先写在 \`setup()\` 里，但它前面有约 20ms 的 \`await\`（UDS socket）。而并行的 \`getCommands()\` 已经跑完并 \*\*memoize\** 了结果 —— 缓存里没有内置技能。等 \`setup()\` 走到注册那一步，命令表早就定死了。</summary>

**修法**：不是加锁，而是把注册**挪到并行启动点之前**（`main.tsx:1923-1926`），让它变成纯内存的数组 push（<1ms、零 IO），必然先于 `getCommands()`。

**教训**：并行化会把"隐式顺序依赖"变成竞态；只要有 memoize，谁先算谁定终身。

同一个文件里还有第二处竞态（插件预取 vs 同步安装），那个**没法**靠调顺序解决，只能用 `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` 彻底不同时做。能靠顺序解决的用顺序，不能的用开关。

</details>

**Q3**：`void lockCurrentVersion()` 里的 `void` 到底做了什么？代价是什么？

<details>

<summary>\`void\` \*\*不改变任何运行时行为\** —— 它只是告诉读代码的人和 lint 工具："我知道这是个 Promise，我故意不等它。"</summary>

目的：让"装监听器 / 抢锁 / 预热缓存"这类工作不拖慢启动。

**代价**：没人 `catch`，失败就变成 `unhandledRejection`。所以 `main.tsx:1932` 给这些 promise 挂了 `.catch(() => {})` —— 防止启动那 28ms 窗口里的瞬时 rejection 把进程搞崩。

</details>

**Q4**：`--dangerously-skip-permissions` 会做哪些环境校验？为什么 `NODE_ENV === 'test'` 的提前返回放在校验**之后**而不是函数开头？

<details>

<summary>\*\*两道闸\*\*：</summary>

1. **root 检查**（对所有平台）：是 root 且不在沙箱（`IS_SANDBOX` / bubblewrap 都没有）→ 直接退出。
2. **沙箱 + 断网检查**（仅内部员工、排除 Desktop 两个入口）：必须 `isSandboxed && !hasInternet`。也就是"不在沙箱"或"能上网"都拒绝 —— 因为在沙箱里且离线时，模型乱来的破坏范围被容器和断网限制住了。

**为什么 test 的 return 放在最后**：如果放在函数开头，测试就永远覆盖不到这两道闸 —— 而安全逻辑恰恰最需要被测到。这在源码里也有一句对应的话：`--dangerously-skip-permissions safety gate ... must still run`，说明安全门禁**不受任何模式开关影响**。

</details>

---

## 第 4 步（`Tool.ts` 契约）读完了吗？四个自测问题

`Tool.ts` 792 行里只有 40 行是可执行代码，其余全是类型。所以自测题都不问"语法"，只问"这个字段为什么必须存在"。

**Q1**：`call()` 的第 3 个参数 `canUseTool` 为什么不放进 `ToolUseContext`？

<details>

<summary>因为它是\*\*能力凭证\*\*，不是\*\*环境\*\*。</summary>

实测：没有任何一个工具在自己的 `call()` 里调用它（5 个工具直接把它命名为 `_canUseTool`，下划线表示不用）。它真正的用途是**往下传** —— `AgentTool`、`SendMessageTool`、`SkillTool` 把它递给子代理的 `runAgent()`，因为子代理执行工具时也要过权限关。

`ToolUseContext` 的其余字段会被 `createSubagentContext` 改写（`setAppState` 甚至被改成空操作），唯独这个凭证必须**原样透传**。放进 context 就会被一起改写，权限链就断了。

</details>

**Q2**：`description()` 和 `prompt()` 都返回"说明文本"，分别给谁看？为什么一个要收 `toolPermissionContext`？

<details>

<summary>读者完全不同：</summary>

- `prompt()` → **模型**。它就是 API 请求里的 `description` 字段（`utils/api.ts:171`）。所以要长、要全、要带规则和示例。
- `description()` → **人**。实测只有两个调用点：`hooks/useCanUseTool.tsx:56`（权限对话框"这个工具要干什么"）和 `MCPToolDetailView.tsx:70`（详情页）。所以要短、是人话、能带着**具体参数**说清后果。

`description()` 收 `toolPermissionContext`，是因为同一句"将执行 `rm -rf /tmp/x`"，在 bypass 模式下该说"将直接执行"，在 default 模式下该说"将请求你批准"。**说明文本要跟着权限语境变**。

</details>

**Q3**：为什么 `Read` 的 `maxResultSizeChars` 要写 `Infinity`，写 `1e9` 不行吗？

<details>

<summary>不行，因为 `Infinity` 在这里是**哨兵值**，不是"一个很大的数"。</summary>

`query.ts:391` 是这么筛的：

```ts
.filter(t => !Number.isFinite(t.maxResultSizeChars))
```

`Number.isFinite(1e9)` 是 `true`，所以 `1e9` 会被当成普通工具参与预算计算；只有 `Infinity` 才会被排除。

为什么要排除 Read？源码注释写得很直白：Read 的结果落盘，会导致 **Read → 结果文件 → 再 Read 它** 的循环，指数级放大。而 Read 本身已经用 `fileReadingLimits` 自我约束了。

</details>

**Q4**：一个工具明明返回了 `contextModifier`，却没有任何效果，而且不报错。最可能是什么原因？

<details>

<summary>它的 \`isConcurrencySafe()\` 返回了 \`true\`。</summary>

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

## 第 4 步收尾（`bashSecurity` + `bashPermissions`）读完了吗？四个自测问题

**1. 这两个 2600 行的文件，分工到底是什么？**

`bashSecurity.ts` 回答「这条命令**能不能被可信地解析**」——22 个 validator 全在做同一件事：找出「检测器看到 A、bash 执行 B」的偏差。  
`bashPermissions.ts` 回答「解析完之后**要不要放行**」——拆子命令、查规则、看路径、问用户。  
判据只有一句话：**前者只有否决权，没有批准权**（它的 `allow` 会被降级成 `passthrough`）。

**2. 为什么 allow 规则和 deny 规则用**不同**的环境变量剥离强度？**

这是刻意的**有方向的不对称**，不是不一致：

| 规则       | 剥离强度                            | 为什么                                                            |
| -------- | ------------------------------- | -------------------------------------------------------------- |
| allow    | 只剥 `SAFE_ENV_VARS` 白名单          | 多剥一点就可能把 `DOCKER_HOST=evil docker ps` 认成 `docker ps` 而**自动放行** |
| deny／ask | `stripAllLeadingEnvVars` 剥光所有赋值 | 少剥一点就可能让 `FOO=bar rm -rf /` **绕过** `Bash(rm:*)`                |

两种错误的代价不同（误放行 vs 误拦截），所以朝不同方向偏。很多权限系统的失败就在于对两者用了同一套归一化逻辑。

**3. `pendingClassifierCheck` 为什么写成 `...(feature('BASH_CLASSIFIER') ? {...} : {})` 这种丑样子？**

因为要**删得掉**。如果写成 `pendingClassifierCheck: feature(...) ? x : undefined`，属性名还在包体里，Bun 的 DCE 只能删值、删不掉键 —— 而 UI 侧判断的正是「有没有这个键」。用对象展开，整个属性连同键一起消失，这才是真正的死代码消除。  
这个技巧和文件头那条「DCE 悬崖」是同一套知识的两面：一面是别把函数写太复杂，另一面是别把死代码写得删不掉。

**4. 为什么管道分支里 `compoundCommandHasCd` 不能硬编码 `false`？**

因为那是一次真实漏洞。`cd .claude && echo x > settings.json | echo done` 会走管道分段这条路，而分段路径把 `compoundCommandHasCd` 当 `false` → `pathValidation.ts:821` 那个「cd + 重定向」拦截不触发 → 重定向写进了 `.claude/settings.json`。  
修法不是补一个参数，而是让 `commandHasAnyCd(input.command)` 从**完整命令**重新计算 —— **能被重新计算的全局事实，就不要靠参数传递。**

<details>

<summary>点开看三个读源码才看得出的问题</summary>

1. **`speculativeChecks` 这个 Map 只增不减** —— 写入点是每次 bash 工具调用（`toolExecution.ts:746`），删除点只有「需要弹窗时取出」和「清屏／压缩后整体清空」。也就是说：**自动放行的命令会把自己的 promise 永久留在 Map 里**。长会话里跑几千条命令，它就是一处只涨不落的堆占用。顺带一提，它的键只有命令字符串、没有 cwd，而分类器的输入里是带 cwd 的。
2. **注释里有两个已经不存在的编号** —— 第 2417 行写着「这些在 step 13 已经过滤掉了」，第 2454 行写着「这和 6b 不同」。这个函数早期给每一步都编了号，后来重构删掉了大半，残留的交叉引用指向**不存在的步骤**。读到不用去找。
3. **`GH#28784` 的本质不是权限 bug，是文案 bug** —— 弹窗上写「是的，允许读取 `<dir>/`」，用户点下去批准的却是 `python3` 执行。修法是：只要有任何子命令自己产出 ask，就不让 path 的 ask 短路返回，改为合并所有非 allow 子命令的规则建议。一句话：**弹窗文案是权限决策的一部分，用户点的是「这句话所描述的事」。**

</details>

---

## 第 4 步完整清单

| 文件                                                                        | 原文    | 批注版   | 讲什么                 |
| ------------------------------------------------------------------------- | ----- | ----- | ------------------- |
| [`Tool.ts`](annotated/src/Tool.ts)                                        | 792   | 2,013 | 工具类型契约，逐字段讲「为什么必须有」 |
| [`tools.ts`](annotated/src/tools.ts)                                      | 389   | 647   | 工具注册表 + 两套条件加载      |
| [`BashTool.tsx`](annotated/src/tools/BashTool/BashTool.tsx)               | 1,143 | 1,757 | 最复杂的工具实现            |
| [`commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts) | 141   | 314   | 退出码语义判定表            |
| [`bashSecurity.ts`](annotated/src/tools/BashTool/bashSecurity.ts)         | 2,592 | 3,658 | 22 个 validator 的编排  |
| [`bashPermissions.ts`](annotated/src/tools/BashTool/bashPermissions.ts)   | 2,621 | 3,906 | 895 行主函数的权限裁决编排     |

合计 **7,678 行原文**，全部逐行保真（`scripts/check-fidelity.py` 可复算）。

---

## 第 5 步（主循环前半）读完了吗？五个自测问题

**① `getSystemPrompt()` 为什么返回 `string[]` 而不是一个大字符串？**

因为它要配合缓存边界使用。数组元素是缓存断点的单位，中间那个 `'__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'` 哨兵把「可全局缓存的前缀」和「会话专属内容」分开。拼成一个大字符串，下游就得靠字符偏移量切 —— 而偏移量随提示词增删而漂移。

**② 为什么 `process.env.USER_TYPE === 'ant'` 不能提取成 `const IS_ANT = ...`？**

因为它是构建期 `--define` 的文本替换。内联写法 `"external" === 'ant' && x` 能被打包器折叠成 `false` 并删掉整个分支；提取成变量后，`false && x` 这个分支仍留在代码里（压缩器不会跨变量删），外部版的 bundle 就白白变大了。这是 DCE 的硬约束，不是风格问题。

**③ `query()` 是递归函数吗？**

不是。它是 `while (true)` 状态机：9 个字段的 `State` 在每轮开头解构，7 个 `continue` 站点通过 `state = next` 转换。注释里到处写 "recursive call"，但那是概念上的「自己调自己」的说法。真正的递归在别处 —— 子代理调用会重新进入一个新的 `query()`。

**④ 什么叫「withheld」？为什么错误不能立刻上报？**

可恢复的错误（上下文太长、输出被截断、图片太大）先不 `yield`，等确认恢复不了才吐出来。因为 SDK 客户端一看到 `error` 字段就终止会话，而内部恢复循环还在跑 —— 结果就是「没人听了」。所以策略是：错误进内部数组（供恢复逻辑检测），但先不进外部流。

**⑤ `QueryEngine` 和 `query()` 是什么关系？**

`query()` 是**一轮**（无状态，参数进、消息出）。`QueryEngine` 是**一个会话**（有状态，跨 `submitMessage` 持久）。一个引擎实例对应 N 次 `query()` 调用。它兼任内外协议边界：9 种内部消息类型 → 5 种 `SDKMessage`。

---

## 第 5 步完整清单（已全部完成）

| 文件                                                  | 原文    | 批注版   | 讲什么                           |
| --------------------------------------------------- | ----- | ----- | ----------------------------- |
| [`prompts.ts`](annotated/src/constants/prompts.ts)  | 914   | 2,042 | 系统提示词拼装 + 缓存布局 + DCE 裁剪       |
| [`query.ts`](annotated/src/query.ts)                | 1,729 | 3,305 | `while(true)` 状态机、五层压缩、七种恢复   |
| [`QueryEngine.ts`](annotated/src/QueryEngine.ts)    | 1,295 | 2,572 | 会话状态、内外协议转换、时序正确性             |
| [`claude.ts`](annotated/src/services/api/claude.ts) | 3,419 | 4,656 | SSE 解析、缓存打点、sticky latch、三级降级 |

合计 **7,357 行原文**，全部逐行保真（`scripts/check-fidelity.py` 可复算）。

---

## `claude.ts` 读完了吗？五个自测问题

**① `queryModel` 有 1,881 行，为什么没有拆成多个函数？**

因为它围绕一组「只在流解析期间存在」的状态变量（`partialMessage` / `contentBlocks` / `usage` / `stopReason` / `newMessages`）。这些变量要跨几十个 SSE 事件存活，还要在 `catch` 和 `finally` 里被读到。拆成函数就得把它们打包成对象传来传去，或者塞进类字段 —— 前者每次调用都在重建对象，后者会把「一次请求」变成「一个有状态对象」，反而更难推理。它的复杂度不在长度，在分支密度。

**② 为什么每个 `beta` 头一旦发出去就要「锁存」（latch）整个会话？**

服务端的 prompt cache 键包含请求签名。中途翻转一个 beta 头，前面整段前缀（约 50–70K token）就按全价重算。所以做法是：**头锁存、body 参数实时**。例如 fast mode 冷却期只是不再传 `speed: 'fast'`，`FAST_MODE_BETA_HEADER` 照发。`/clear` 和 `/compact` 是两个缓存本来就要重建的时刻，顺手清 latch。

**③ 为什么 `message_delta` 里回写 `usage` 必须「原地改属性」，不能换对象？**

会话落盘有一个 100ms 延迟队列，它持有的是 `message.message` 的**引用**，真正序列化时才读值。写 `lastMsg.message = { ...lastMsg.message, usage }` 会换掉引用，队列里的旧引用仍然指向 `output_tokens: 0`、`stop_reason: null` 的版本 —— 落盘后成本统计全是 0，而且几乎无法排查。


**④ 流式失败后降级到非流式，什么情况下**不允许**降级？**

开了「流式工具执行」的时候（`inc-4258`）。流式那半截可能已经收到 `tool_use` 并开始执行工具，降级重放会让同一个工具跑第二遍 —— 写文件、发请求、删数据这类有副作用的操作被执行两次。所以宁可直接失败让 `withRetry` 重来。

**⑤ `executeNonStreamingRequest` 为什么要单独传 `initialConsecutive529Errors`？**

因为「连续撞几次 529 就切换模型」这个计数器被两条代码路径维护。流式撞了 2 次然后降级，非流式又撞 2 次，如果不把已有的事实传下去，计数器只记到 2 而不是 4 —— 那么「流式还是非流式」会改变模型降级的时机。修法是把已发生的事实显式传下去，而不是让两条路径共享一个可变全局。

---

## 第 5 步这一轮修的两个工具缺陷

批注过程中发现两处此前没被抓住的问题，已固化成硬判据：

**① 中文注释插进多行模板字符串内部**（`prompts.ts` 3 处、`bashSecurity.ts` 4 处）

模板字符串里反引号之间是**字符串字面量** —— 插进去的 `// 注：…` 不是注释，它会变成发给模型的提示词正文。这比「劈开块注释」严重一个量级：后者只是难看，前者是代码行为被改变。而 `check-fidelity.py` 的旧判据完全无感（代码行确实一行没动）。

现在 `annotate.py` 会自动检测并外移，`check-fidelity.py` 新增判据 4 拦截。

**② 中文批注插在未结束的多行表达式中间**（7 处）

`const x =` 后面插一段注释再给值，语法合法但语句被劈成两半。判据 5 只抓 `=` 和 `?` 结尾的行 —— 刻意放过 `,`、`:`、`(`、`&&`，因为「数组元素之间」「case 分支」「函数参数」「逐条解释 if 条件」这四种后面插注释都是正当写法（试宽了会让 9 个文件全部误报）。

顺带修了扫描器的一个盲区：正则字面量里也有反引号（`/^[)}`|&;(<>]/\`），不识别就会把后面几十行误判成模板内部。现在两个脚本都做了正则字面量识别。

---

## 第 6 步（服务层）读完了吗？

第 6 步体量最大（服务层约 4 万行），只批注主线相关的文件，不做全量。已完工十五个：

| 文件                                                                        | 原文    | 批注版   | 讲什么                                        |
| ------------------------------------------------------------------------- | ----- | ----- | ------------------------------------------ |
| [`withRetry.ts`](annotated/src/services/api/withRetry.ts)                 | 822   | 1,419 | 重试边界、退避曲线、529 白名单、无限重试模式                   |
| [`apiMicrocompact.ts`](annotated/src/services/compact/apiMicrocompact.ts) | 153   | 329   | 发给 API 的 `context_management` 指令（**不调模型**） |
| [`autoCompact.ts`](annotated/src/services/compact/autoCompact.ts)         | 351   | 668   | 阈值计算、四道抑制闸门、三振熔断、session memory 优先         |
| [`compact.ts`](annotated/src/services/compact/compact.ts)                 | 1,705 | 3,628 | 摘要压缩本体、PTL 逃生舱、七类附件重建                     |
| [`microCompact.ts`](annotated/src/services/compact/microCompact.ts)       | 530   | 1,352 | 缓存热不热决定改不改本地内容                            |
| [`sessionMemoryCompact.ts`](annotated/src/services/compact/sessionMemoryCompact.ts) | 630 | 1,517 | 零 API 调用的拼接式压缩、82 行索引对齐                   |
| [`mcp/client.ts`](annotated/src/services/mcp/client.ts)                   | 3,348 | 4,776 | 七种 transport、错误桥接、MCP 工具封装                |
| [`mcp/config.ts`](annotated/src/services/mcp/config.ts)                   | 1,578 | 3,077 | 六种配置来源、优先级、去重、白黑名单策略                      |
| [`compact/prompt.ts`](annotated/src/services/compact/prompt.ts)           | 374   | 723   | 压缩提示词本体，三套模板的差异与理由                         |
| [`grouping.ts`](annotated/src/services/compact/grouping.ts)               | 63    | 202   | 按 API 轮次切刀口，以及为什么只有一个判据                     |
| [`postCompactCleanup.ts`](annotated/src/services/compact/postCompactCleanup.ts) | 77 | 339   | 压缩后清什么、清哪一层、什么故意不清                         |
| [`timeBasedMCConfig.ts`](annotated/src/services/compact/timeBasedMCConfig.ts) | 43 | 228   | 缓存注定要 miss 时顺手整理上下文                        |
| [`compactWarningState.ts`](annotated/src/services/compact/compactWarningState.ts) | 18 | 71 | 一个布尔量的时序问题                                 |
| [`compactWarningHook.ts`](annotated/src/services/compact/compactWarningHook.ts) | 16 | 105 | 为什么 6 行 hook 要单独一个文件                       |
| [`mcp/auth.ts`](annotated/src/services/mcp/auth.ts)                       | 2,465 | 4,356 | OAuth 全流程、XAA、step-up 补丁、跨进程刷新锁           |
| [`mcp/xaa.ts`](annotated/src/services/mcp/xaa.ts)                         | 511   | 812   | 两跳换票：id_token → ID-JAG → access_token、三道防混淆闸 |
| [`mcp/xaaIdpLogin.ts`](annotated/src/services/mcp/xaaIdpLogin.ts)         | 487   | 709   | 一次浏览器弹窗、id_token 按 issuer 缓存、URL 拼接两个坑  |
| [`mcp/useManageMCPConnections.ts`](annotated/src/services/mcp/useManageMCPConnections.ts) | 1,141 | 1,631 | 异步事件 → AppState 的适配层、16ms 批处理、stale 清理三条引线 |

合计 **14,312 行原文**，704 处批注锚点。`src/services/compact/` 目录 11 个 `.ts` 全部批注完；MCP 这条线四段全通：`config.ts`（允不允许连）→ `client.ts`（连上怎么活）→ `auth.ts`（401 之后怎么办）→ `xaa*.ts`（不弹窗那条路怎么走），最后 `useManageMCPConnections.ts` 把它接进 UI。目录里剩下 16 个百行级小件（`utils.ts` 575、`elicitationHandler.ts` 313、`channel*.ts` 等），单独看价值不高，暂时跳过。

**① `withRetry` 里的 `attempt` 变量承担了几个角色？**

三个：第几次尝试（遥测用）、循环退出条件、以及被手动改写以阻止退出的开关（`attempt = maxRetries`）。正因为一个变量干三件事，才需要 `persistentAttempt` 这个第二计数器专门算退避。这是「用状态污染换控制流改动最小」的取舍。

**② 为什么 529 要按 querySource 白名单决定重不重试，而「未标注来源」反而重试？**

529 是服务端过载，重试会把流量放大 3–10 倍。只有用户真的在等的路径（主线程、子 agent、压缩、分类器）值得重试；摘要/标题/建议这类用户看不见的调用直接放弃。而 `undefined` 代表「来源未知」，无法判断用户在不在等，所以保守选重试 —— **已知的次要路径不重试，未知路径重试**，这两个默认值方向相反但都对。

**③ `x-should-retry: true` 为什么对订阅用户不算数？**

因为同一个 `true` 在不同计费形态下含义不同：订阅用户的 429 是配额窗口（几小时后才恢复），服务端说「可以重试」在字面上正确、在实践上无意义；企业用户是 PAYG，429 只是瞬时速率限制，重试有效。这个区别 header 里没有，只能靠 `isClaudeAISubscriber()` / `isEnterpriseSubscriber()` 补。

**④ `apiMicrocompact.ts` 是压缩器吗？**

不是。它一次模型调用都不发，只构造 `context_management.edits` 塞进请求体，让**服务端**在推理时自己清工具结果/思考轮次。好处是不破坏 prompt cache（我们这边发出去的字节不变）。这和客户端压缩（`microCompact.ts` / `compact.ts`）是两条并行的路线。

**⑤ 为什么 `autoCompact` 的四道抑制闸门比阈值计算更重要？**

阈值算错只是压缩早一点或晚一点；闸门缺失会造成实打实的故障：压缩触发压缩会死锁、`marble_origami` 压缩会通过模块级状态毁掉主线程已提交的日志、autocompact 和 context-collapse 会在 93% 这个点上抢同一段上下文。而且闸门必须加在**调用点**而不是 `isAutoCompactEnabled()` 里 —— 因为 reactive compact 会直接查那个函数，闸门塞进去会连 413 兜底一起关掉。

**⑥ 为什么「压缩」这件事本身会失败、会花钱、会卡住？**

因为压缩不是一次本地计算，而是**一次完整的 API 调用**：把整个上下文发过去让模型写摘要。所以它会花 5–10 秒、会被限流、会被用户 Esc 中断，而且它自己也会撞上上下文上限（PTL）。`compact.ts` 一半的复杂度都在处理这些失败路径，不在「怎么总结」。

**⑦ `truncateHeadForPTLRetry` 里那个必须先「剥掉自己上次插的 marker」的理由是什么？**

砍头之后 API 要求首条是 user，所以要补一条合成 user 消息。但下一轮重试进来时，这条 marker 自己会变成一个 group，20% 回退算出来「只删掉 marker」，然后又补回去 —— 净进展为零，死循环。所以每轮开头必须先剥掉上一次插的。

**⑧ 为什么主路径严禁设 `maxOutputTokens`，而备路径必须设？**

主路径靠「参数逐字节相同」命中主线程的 prompt cache。而 `maxOutputTokens` 会经 `claude.ts` 里的 `Math.min(budget, maxOutputTokens - 1)` 间接改掉 thinking 的 `budget_tokens`，thinking config 在缓存键里 —— 改了整条缓存作废。备路径本来就共享不了前缀，所以随便设。同一文件对同一参数采取相反策略。

**⑨ 微压缩和摘要压缩对「本地消息数组」的态度为什么是相反的？**

判据只有一条：**缓存热不热**。缓存热 → 用 `cache_edits` 让服务端逻辑删除，本地消息一个字节都不改（改了前缀就废）；缓存冷 → 直接改内容（反正要重建）。所以 `microCompact.ts` 里那条 `return messages` 原样返回不是漏写，是刻意保留前缀。

**⑩ `adjustIndexToPreserveAPIInvariants` 防的是哪两类「本地看不出、发 API 才 400」的错误？**

① 劈开 `tool_use` / `tool_result` 配对 —— 流式会把一次响应拆成多条同 id 消息，normalize 合并后 tool_use 消失，tool_result 成了孤儿。② 劈开同 `message.id` 的 thinking 块 —— 合并时没有容器，直接丢失，而且会破坏 signature 对应的 extended thinking 连续性。修复方向只能是「把切点往前挪」，宁可多留不可断链。

**⑪ `connectToServer` 连接失败时为什么不抛异常？**

因为它返回的是 `{ type: 'failed', error }` 这个普通对象。于是「一个服务器」成了四选一的代数类型：`connected` / `failed` / `needs-auth` / `disabled`。好处是调用方不需要 try/catch 就能遍历所有服务器，一个坏服务器不会中断整批连接 —— 在批量连接 20 个外部服务的场景里，这是必须的。代价是每个消费方都要先判 `type`。

**⑫ MCP SDK 的 transport 在连接失败时有个「缺一半」的行为，CC 怎么补的？**

SDK 会调 `client.onerror`，但**不调 `client.onclose`**。而 CC 的重连机制完全依赖 `onclose`（它负责清缓存）。后果：SSE 流被掐断后，`callTool()` 的 promise 既不 resolve 也不 reject，界面上那个工具会一直转。

补法是三件套：自己数连续 terminal 错误（阈值 3）→ 数到 3 就主动 `client.close()` → 借关闭动作触发 SDK 的 `_onclose()`，它会 reject 所有挂起的 request handler。另有两条快速路径不等三振：会话过期（404 + `-32001`）和 SDK 自己重连耗尽（`"Maximum reconnection attempts"`）。

**⑬ 为什么不能直接调 `client.onclose?.()` 来「假装关闭」？**

因为那样只清了缓存，**挂起的 promise 还挂着**。必须走 `client.close() → transport.close() → transport.onclose → SDK 的 _onclose()`，只有 `_onclose()` 会 reject 那些 pending 的 `callTool()`。直接调我们自己的 handler 等于跳过了一半。

**⑭ `fetchToolsForClient` 里为什么要把 `_meta.searchHint` 的空白压成一个空格？**

因为那个字段是**外部 MCP 服务器完全可控**的，而它最终会进「延迟工具列表」，那个列表是**按换行符拼接**的。一个 hint 里只要带一个换行，就能凭空多出几行工具描述 —— 模型会把它当成真的工具条目读。这叫结构性注入：不是转义问题，是用数据去伪造结构。

**⑮ `callMCPTool` 为什么要在 SDK 的超时之外再套一层 `Promise.race`？**

因为 SDK 内部的超时在有些情况下根本不触发 —— 比如 SSE 流中途断了，SDK 连触发定时器的机会都没有。外面这层保证调用方一定能拿到结果，而不是无限等待。注意 `finally` 里要 `clearTimeout`，否则一个早已完成的调用会在 27.8 小时后触发一个无人处理的 reject。

**⑯ 压缩提示词为什么要把「别用工具」写在最前面，而不只在末尾说？**

因为压缩走的是 fork 路径，而 fork 要共享父进程的缓存 —— 缓存按字节前缀匹配，工具 schema 在请求前部，所以**全套工具一个都不能删**。于是就出现了矛盾：我们要求它别用工具，却必须把工具摆在它面前。

光在末尾（trailer）说不够。Sonnet 4.6 的 adaptive thinking 有时会自己决定调个工具。而压缩只给 `maxTurns: 1` —— 这一轮用来调工具、工具被拒，就**什么文本都没产出**，整次压缩白跑，落到降级路径重来一次。发生率 4.5 上是 0.01%，4.6 上是 2.79%（涨 279 倍，靠线上数据发现的回归）。

修法是两件事：把禁令放到最前面（位置权重），并明说「调了会被拒、你会失败」（讲后果比讲要求有效）。

**⑰ 压缩摘要里那个 `<analysis>` 块为什么要删掉？**

它是给模型「想清楚」用的草稿纸 —— 对摘要质量有帮助，但摘要一写完就只剩坏处：占 token、里面常有被推翻的推理、后面的模型看到草稿和定稿两份表述容易抓错重点。所以提示词里明确叫它 `drafting scratchpad`，而 `formatCompactSummary()` 用 `/<analysis>[\s\S]*?<\/analysis>/` 把它剥掉。

两个正则细节都很关键：用 `[\s\S]` 而不是 `.`（`.` 不匹配换行，跨行摘要会一条都匹配不到）；用 `*?` 惰性而不是 `*` 贪婪（如果有两个 analysis 块，贪婪会把中间的 summary 一起吞掉，最终摘要变成空字符串，而且**完全静默**）。

**⑱ `groupMessagesByApiRound` 为什么只用一个 `message.id` 判据，不去追「未解决的 tool_use」？**

追了会更糟。畸形输入（resume 后悬挂的 tool_use、max_tokens 截断留下的半个调用）会让那个集合**永远非空**，于是刀口永远不开，后面所有轮次并成一大组 —— 压缩想砍头时发现「只有一组」，等于彻底失效。一个局部畸形放大成整个机制失灵，而且症状是「压缩没反应」，指不到原因。

作者的选择是让边界照常触发，把修复推给 `claude.ts` 的 `ensureToolResultPairing`（发送前的必经之路）。判据是「谁能用最少的状态、最小的爆炸半径修掉它」，而不是「谁先遇到谁修」。

另一个细节：这个函数原来按**人类轮次**分组，改成 **API 轮次**是为了让 reactive compact 能作用于 SDK / CCR / eval 这类「整个任务只有一条人类消息」的会话 —— 按人类轮次分，它们整段只有一组，压缩砍不动，而且不报错。

**⑲ `runPostCompactCleanup` 为什么必须传 `querySource`？**

因为子 agent **不是独立进程**，它跑在同一个 Node 进程里，和主线程共享所有模块级变量。子 agent 压缩时如果清掉 context-collapse 存储或 memory files 缓存，主线程的状态就被别人清掉了。症状非常诡异：主线程莫名重新读了一遍 CLAUDE.md、莫名丢掉折叠状态 —— 而触发点是「某个子 agent 恰好压缩了一次」，时间上离得很远。

参数还是可选的（`querySource?: QuerySource`），`undefined` 被当成主线程 —— 这是个「默认值恰好等于最危险情况」的设计：忘了传参数不报错，只静默多清东西。更安全的写法是让 scope 必填、默认值指向破坏性更小的那一侧。

**⑳ `getUserContext.cache.clear?.()` 那一行为什么不能只清 `getMemoryFiles` 的缓存？**

因为是**两层记忆化**：`getUserContext`（缓存①）包着 `getClaudeMds() → getMemoryFiles()`（缓存②）。只清②的话，下一轮调 `getUserContext()` 命中的是没被清的①，直接返回旧结果，**根本走不到** `getMemoryFiles()` —— 缓存② 清了个寂寞。

而「读了 memory 文件」这个动作会触发 `InstructionsLoaded` hook。走不到真正的读取，hook 永远不触发，于是「压缩后重载 CLAUDE.md」静默失效。这个 bug 难发现的原因：清了名字里带 memory 的那个看起来已经做到位了，而失败模式是「少做一件事」，没有报错。

**㉑ 时间触发微压缩的 60 分钟阈值是怎么定出来的？**

不是调参调出来的，是从「服务端 cache TTL 正好 1 小时」推出来的：超过 60 分钟，对所有用户都**保证**缓存已过期。于是这次清理**永远不会造成本来不会发生的 miss**。

设成 30 分钟就会主动制造 miss —— 大量「缓存其实还热着」的情况被误清，成本翻倍，优化变成负优化。

这个特性整体也只有 43 行：一个开关、一个阈值、一个 `keepRecent`。对比 `autoCompact.ts` 的 351 行（四道闸门、三振熔断、session memory 优先）。差别在于 **`autoCompact` 不做会错，`timeBasedMC` 不做只是贵** —— 判断一个模块该多复杂，先问「不做会怎样」。

**㉒ MCP 配置有六种来源，优先级是什么顺序？为什么 local 比 project 高？**

`plugin < claude.ai < user < project < local`，而 enterprise 一旦存在就**独占**（此时连插件都不读）。

local 比 project 高的理由：`.mcp.json`（project）会进版本控制、全组共享；local 是「我在这台机器的这个项目里自己的设置」。局部覆盖全局、个人覆盖团队 —— 这和 git 配置的层次直觉一致。

注意覆盖是**按键名**的，不是按内容。项目里有个叫 `slack` 的，就完全替换用户全局那个 `slack`，即使它们连的是不同服务。

**㉓ 企业策略里白名单和黑名单为什么不对称？**

黑名单永远从**所有来源合并**；白名单在 `allowManagedMcpServersOnly: true` 时**只读 managed 设置**。

因为两者的效果不同：加黑名单只会更严（并集更安全），没有绕过的可能；而白名单是「放宽」的机制 —— 如果用户能往白名单里加条目，他就自己给自己开了一个口子，企业限制形同虚设。

原则：**收紧永远允许（合并），放宽只在受信来源（独占）。**

还有一个必须分开写的判断：`undefined`（没配过）= 不限制；`[]`（空数组）= 全禁。写成 `if (!arr?.length) return true` 就会让「明确禁掉一切」变成「全放行」，而且不报错。

**㉔ 为什么「禁用的服务器」不能作为去重的抑制方？**

因为抑制会造出空集。用户手工配了 `slack` 但禁用了，网页端启用了 Slack 连接器 —— 如果没有 `isMcpServerDisabled(name) continue` 这条判断，禁用那个的签名会抑制掉连接器，结果两个都不跑。

同一个 bug 在插件路径上还有一份：禁用插件不能在「先加载赢」的比赛里胜出，否则它会把启用的那份顶掉。所以代码里要把插件服务器先拆成 enabled / disabled 两堆，只对 enabled 做去重，事后合并回来。

写抑制逻辑时先问一句：**被抑制的那个没了，还有谁在干活？** 答案是「没人」的话，这条抑制就是错的。

**㉕ `doesEnterpriseMcpConfigExist` 的判据为什么是 fail-open 的？**

它用 `config !== null` 判断，也就是「能否成功解析」而不是「文件是否存在」。于是文件存在但 JSON 写坏 → 判定为「不存在」→ 整个企业锁定**静默失效**，用户退回分层模式，可以自由添加服务器。

预期行为应该相反：解析失败时**假定锁定生效**并报一个显眼的错误（fail-closed）。对安全相关的开关，默认值必须指向更严的一侧。

另外它是全文件唯一 memoize 的函数，隐含假设是「企业配置在进程生命周期内不变」—— 没有 cache key，也没有手动失效的办法，改了文件只能重启。

**㉖ MCP 服务器的启停有几种「极性」？**

两种，而且方向相反：

- 普通服务器 **opt-out**：出现在 `disabledMcpServers` 里 → 禁用（默认开）
- 内置服务器（`COMPUTER_USE_MCP_SERVER_NAME`）**opt-in**：出现在 `enabledMcpServers` 里 → 启用（默认关）

`isMcpServerDisabled()` 里两个 `return` 的方向正好相反（一个 `!includes`，一个 `includes`），是全文件最容易读错的地方。

为什么内置那个要反过来？因为它能**操作你的电脑**（截图 / 点击 / 输入）。装了 CC 就自动获得「AI 可以控制我的鼠标」是不可接受的，所以必须显式打开。

**能力的危险程度决定默认值。** 同一个系统里不同服务器用不同极性，不是技术原因，是风险期望值不同。

---

## `mcp/auth.ts` 读完了吗？

**㉗ `wrapFetchWithStepUpDetection` 这个补丁到底在绕什么？**

绕一段**必然发生**的死循环。token 有效但 scope 不够 → 403 `insufficient_scope` → SDK 的 `authInternal` 看到内存里有 `refresh_token` 就去刷新 → 但 RFC 6749 §6 **禁止**用 refresh 提升 scope，服务器只能返回同样 scope 的 token → SDK 认为刷新成功、重试 → 又 403 → 放弃，报 "Server returned 403 after trying upscoping"。

关键点是：它**永远到不了** `redirectToAuthorization`，而 step-up 的 scope 正是在那里持久化的。所以下一轮重新认证时仍然不知道要申请更大 scope，同一个循环再来一次。

补丁手法：在 SDK 处理 403 之前先把 scope 记到 provider 上，然后让 `tokens()` 在 step-up 待处理时**故意不返回 `refresh_token`**。SDK 发现无路可刷，只能落回 PKCE 授权码流程，于是走到 `redirectToAuthorization`。

这是一个「用返回值的缺失改变调用方控制流」的技巧 —— 比 patch SDK 便宜，代价是 `tokens()` 的返回值和 SDK 内部分支被一条**隐式契约**绑在一起。

**㉘ `tokens()` 里为什么不能 `clearKeychainCache()`？**

因为它在**热路径**上。macOS 读 keychain 走 `spawnSync('security find-generic-password')`，而 `tokens()` 每秒被调 30–40 次（MCP SDK 的 `_commonHeaders` 每个请求都取一次 token）。CPU profile 显示仅 `spawnSync` 就占了总 CPU 的 **7.2%**（PR #19436 之后测到）。

真正的代价不是 7.2% 的 CPU，而是**同步阻塞事件循环** —— 每次 spawnSync 期间 UI 掉帧、其他回调延迟。

所以策略是分层：读的时候用缓存（最终一致）；真要读最新值时，只在**低频路径**上清（拿到刷新锁之后、遇到 `invalid_grant` 之后）；本进程自己写的由 `storage.update()` 主动失效。

「能不能这么做」的答案取决于「在哪个路径上做」—— 同一个操作在 30 次/秒 和 1 次/小时 的路径上，代价差三个数量级。

**㉙ 为什么「没有 access_token 就静默换 token」不用 `accessToken !== ''` 判断？**

因为 SDK 在认证**中途**会调 `saveClientInformation`，那里为了满足类型要求写了 `accessToken: ''`。也就是说凭据库里会留下一个「空 token 的 marker」。

如果判据是 `!== ''`：用户上次认证被打断 → marker 残留 → 下次连接认为「有 token」不走静默分支 → 走普通路径发现没 token → 401 → needs-auth → 用户点认证 → 中途又写 marker → 又被挡住。结果 **XAA 自动认证永久失效**，每次都要手工登录（注释里说 `xaa.dev` 上真发生过）。

代价是承认的「无害重复」：第一次 `tokens()` 静默换失败 → `auth()` 写 marker → 又调 `tokens()` → 又一次静默换。多一次 keychain 读（约 1ms），换「自动认证总能工作」。

**㉚ Slack 用 HTTP 200 返回 OAuth 错误，后果为什么不是「报错难看」而是「永久连不上」？**

因为 2xx 的响应不会被 SDK 当成错误去解析，它直接进 `OAuthTokensSchema.parse()` → ZodError → 被归成不透明的 `request_failed`。

于是本该走的路走不通了：`invalid_grant` → `invalidateCredentials('tokens')` → 提示重新登录（**自愈**）；`request_failed` → 重试三次 → 放弃 → **坏 token 还留在 keychain 里**。用户看到的是「这个服务器怎么点重试都连不上」。

补丁是 `normalizeOAuthErrorBody` 把「200 + error 体」重写成「400 + 同样的体」，让 SDK 既有的错误映射自动生效。配套的 `NONSTANDARD_INVALID_GRANT_ALIASES` 把 Slack 的 `invalid_refresh_token` / `expired_refresh_token` / `token_expired` 归一到 `invalid_grant`。

**错误码归一不是代码整洁问题，是功能可用性问题。**

**㉛ `saveDiscoveryState` 为什么只存两个 URL，不存完整的 `authorizationServerMetadata`？**

因为 macOS keychain 写入走 `security -i`，stdin 有 **4096 字节行限制**，而凭据库用 hex 编码，等于约 2,013 字节的 JSON 上限。完整元数据单个就有 1.5–2 KB（每种 grant type、PKCE 方法、端点全列出来），**两个** OAuth 服务器就会溢出 —— 溢出不是「这个服务器失败」，是**整个凭据库损坏**（#30337），所有 MCP 服务器的凭据一起丢。

解法：只存 `authorizationServerUrl` + `resourceMetadataUrl`。丢掉的东西能廉价重建 —— SDK 的逻辑是 `cachedState.authorizationServerMetadata ?? await discover...`，多一次幂等 GET 而已。

判断依据：**丢掉的东西能不能廉价重建？能，就丢。**

**㉜ 刷新锁重试 5 次仍拿不到时，为什么「不带锁继续刷新」而不是放弃？**

因为两种后果的量级不同：没锁的后果是「可能重复刷新」（偶发、可恢复，代价是浪费几个请求）；拒绝刷新的后果是「token 过期 → 用户被登出」（必然、需人工介入）。

锁在这里是优化，不是正确性保证。**判断一把锁能不能 fail-open，看它保护的动作做两次会不会出事** —— 刷新做两次只是浪费，所以可以。如果保护的是「扣款」或者「发消息」，就必须 fail-closed。

配套的两个细节：重试间隔带随机抖动（1–2 秒，防多进程同步重试造成惊群）；拿到锁之后必须 `clearKeychainCache()` 重读 —— 因为进锁前的判断用的是缓存，可能正是「别人刚刷好之前」的旧值。

---

## XAA 与连接管理读完了吗？

**㉝ XAA 为什么不直接用 `id_token` 换 `access_token`，非要两张票据？**

因为这是两个互不信任的域。`id_token` 是 IdP 签的，MCP 服务器的 AS 根本不知道这个 IdP 存在；反过来 IdP 也不知道自己的用户会去访问哪些 AS。所以中间必须有第三样东西：**ID-JAG（Identity Assertion Authorization Grant）**—— 一张由 IdP 签发、写明「这个用户授权你去某个 AS 拿某个 resource 的 token」的委托书。

链路是：`id_token` --RFC 8693 Token Exchange--> `ID-JAG` --RFC 7523 JWT Bearer--> `access_token`。

最容易搞混的是两个参数：`audience` 必须填 **AS 的 issuer**（因为委托书是开给 AS 的），`resource` 必须填 **MCP server 的 URL**（因为要说明凭的是哪个资源）。填反了 AS 会拒，理由是「这不是签发给我的」，而错误信息通常不会告诉你填反了。

`ID-JAG` 本身**不能访问任何东西** —— 它只是一个授权凭证，不是访问凭证。

**㉞ `xaa.ts` 里有三道校验（PRM resource 匹配、AS issuer 匹配、HTTPS 强制），前两道为什么挡不住 `http://`？**

因为前两道都是「**自洽性**」校验：PRM 说自己是谁、AS 说自己是谁。一个完全自洽的 http 配置能同时通过：

```
PRM: resource = http://evil.com/mcp
AS:  issuer = http://evil.com, token_endpoint = http://evil.com/token
```

两道比较都通过 —— 然后代码把 `id_token` 和 `client_secret` 明文 POST 出去。

所以第三道闸必须单独存在，而且判的是 **`token_endpoint`**，不是 issuer：真正承载凭据的是那一个 URL，AS 完全可以 `issuer=https` 而 `token_endpoint=http`。

这三道闸是递进的，不是重复的 —— 每一道都覆盖前两道**结构上无法覆盖**的那一类。

**㉟ `xaaIdpLogin.ts` 和 `auth.ts` 的回调服务器，为什么都坚持「先 `listen` 成功，再开浏览器」？**

因为 `listen()` 是异步的。先开浏览器再 listen 的话，端口被占（`EADDRINUSE`）时用户看到的是：一个浏览器标签页弹出来 → 然后自己关掉 → 几秒后终端里出现一行错误。用户完全不知道刚才发生了什么，而且大概率会再点一次。

把「开浏览器」放进 `server.listen` 的回调里，端口冲突就会**先于**弹窗暴露，用户只会看到一条可操作的错误（「端口 54545 被占用，运行 `lsof -ti:54545` 查看」）。

同一个文件里还有两个细节值得记：`res.writeHead(404)` 处理非 `/callback` 路径（浏览器的 favicon 请求不能把 promise reject 掉）；`xss(err)` 转义 query 参数（**127.0.0.1 不等于可信** —— 挡得住外网直连，挡不住用户自己浏览器发起的请求，那是反射型 XSS）。

**㊱ `useManageMCPConnections.ts` 里 `(rawTools ?? [])` 和 `rawTools` 有什么区别？为什么同一份 `undefined` 在一个分支表示「保留」、在另一个分支表示「清空」？**

因为 `updateServer` 的契约是「`tools === undefined` 表示保持原值」。所以：

- 非 `disabled/failed` 时传 `rawTools`：值为 `undefined` → 下游走「保留」分支
- `disabled/failed` 时传 `(rawTools ?? [])`：`undefined` 变成 `[]` → 下游走「剔除该前缀 + 追加空数组」= **清空**

用 `?? []` 两个字符，把「保持」和「清空」两种完全相反的语义折叠进了同一个变量。L293-296 的注释说了这个契约，但代码里看不出来。

验证方法：把 `?? []` 改回 `?? undefined`，然后禁用某个服务器 —— 它的工具会残留在模型上下文里，模型继续调用一个已经不存在的服务器。

**㊲ 为什么 `toggleMcpServer` 必须「先写盘，再断连」？写反了会怎样？**

死循环。

断连会触发 `onclose`，而 `onclose` 里要判断「这是不是用户主动禁用的」—— 判断依据是 `isMcpServerDisabled(name)`，**读的是磁盘上的配置文件**。为什么不读 AppState？因为 `onclose` 触发时，「把它标成 disabled」那个 setAppState 还没提交，AppState 里它还是 `connected`（源文件 342 行那段 TODO 就是在承认这个）。

所以顺序变成不可交换的：

```
写盘（disabled）→ clearServerCache（断连 → onclose 读到「已禁用」→ 不重连）
```

反过来的话：断连 → onclose 读到「还是启用」→ 启动指数退避重连 → 用户点了禁用，五秒后它自己又连上了。

这条契约横跨两处代码（342 行的 TODO 和 1093 行的注释），任何一次「先断连再写盘」的重构都会重新引入它。

---

## 第 7 步（多智能体）读完了吗？

UI 那半边（`components/` 4.2 万行 + `ink/` 1.3 万行）跳过了 —— 它们不影响理解主线。
多智能体那半边做完了，四个文件正好是一条完整的链：

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`coordinatorMode.ts`](annotated/src/coordinator/coordinatorMode.ts) | 369 | 632 | 模式开关、resume 对齐、协调者系统提示词（258 行） |
| [`AgentTool/prompt.ts`](annotated/src/tools/AgentTool/prompt.ts) | 287 | 601 | agent 清单注入策略、fork 说明、简报写法 |
| [`AgentTool.tsx`](annotated/src/tools/AgentTool/AgentTool.tsx) | 1,397 | 2,793 | schema 裁剪、十道检查、两套执行路径、结果话术 |
| [`forkSubagent.ts`](annotated/src/tools/AgentTool/forkSubagent.ts) | 210 | 559 | 缓存共享的字节级机制、身份冲突纠正 |

合计 **2,263 行原文**，133 处批注锚点。

**① CC 有哪两种多智能体形态？为什么互斥？**

`coordinator` 模式：一个主进程当包工头，通过 Agent 工具派活给 worker，worker 之间有消息通道（SendMessage），主进程负责综合结论并对用户说话。
`fork` 模式：主进程把自己的完整上下文复制给子进程，子进程干完就消失，没有消息通道也没有团队概念。

互斥不是因为技术限制，而是角色重叠 —— coordinator 本身就是「分工者」，再让它 fork 自己会变成一个人同时当包工头和工人。而且两者的成本模型相反：coordinator 假设「派活要重新建立上下文」，fork 假设「派活几乎免费」，混在一起模型会算错账。

**② CC 的多智能体设计里，什么东西是「不可外包」的？**

**理解**。协调者提示词里态度最强的一段是：

> Never write "based on your findings" or "based on the research." These phrases delegate understanding to the worker instead of doing it yourself. You never hand off understanding to another worker.

配套的示例给了正反两种写法：反例一句话，正例包含具体文件路径、行号、字段名、判断逻辑、验收动作。区别不在长短，在于正例证明了协调者真的读懂了。

整份提示词花了大量篇幅讲「不要做什么」（不要客套、不要抢答、不要派 worker 查 worker、不要外包理解、不要盖章），因为多智能体的失败模式几乎全是**协调者偷懒**。

**③ 为什么 worker 的结果要以「用户消息」的身份送达？**

因为对话协议只有 user / assistant 两种角色。要让模型「收到」一条外部消息，唯一的位置就是 user 角色。代价是模型必须靠 `<task-notification>` 这个 XML 标签区分「真人在说话」和「系统在通知」—— 标签名成了语义边界。

**④ agent 清单为什么不能内联在工具描述里？那个 10.2% 是什么？**

因为工具 schema 在请求里位于系统提示词**之前**。agent 清单是动态的（MCP 异步连上、/reload-plugins、切权限模式都会改它），清单变一个字 → 工具 schema 变 → 它后面所有内容的缓存前缀全废。在 MCP 服务器几十秒才连上的会话里，这件事在开头几分钟内会反复发生。

10.2% 是**全公司范围内「重新创建缓存」这一项开销的 10.2%**（不是 token 消耗占比，是按全价计费的那部分）。解法是把清单挪到 attachment 里（消息流末尾），工具描述从此静态。

这和 `prompts.ts` 的 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`、`claude.ts` 的 `deferred_tools_delta` 是**同一个手法的第三次出现**：把会变的东西从前缀移到后缀。

**⑤ 为什么 fork 子 agent 不换系统提示词？那它不会去做不该做的事吗？**

因为它要**共享父的缓存**，换提示词等于把 fork 的全部价值清零。

于是出现一个矛盾：子 agent 的系统提示词里写着「你应该 fork 子 agent」，而它自己就是 fork。这个矛盾无法从源头消除（改了就不共享缓存），只能在**用户消息里**用一段大写的话强行覆盖 —— `forkSubagent.ts` 第 173 行那句 `STOP. READ THIS FIRST.` 就是干这个的，规则 1 直接写 `IGNORE IT — that's for the parent. You ARE the fork.`

**⑥ fork 怎么做到「所有子进程共享前缀」？**

关键是所有可变内容都压到最后：

```
[...历史, assistant(全部 tool_use), user(相同占位的 tool_result..., 各自的指令)]
                                            ↑ 全部字节相同          ↑ 唯一的不同
```

两个细节：① 父的 assistant 消息必须**完整**保留（所有 tool_use），因为 tool_use / tool_result 必须配对；② 占位符必须是同一句话（`Fork started — processing in background`），而且那句话在语义上是真的，不是为凑字节编的假话。

**⑦ 为什么 fork 子进程的「路径全错」问题比想象中严重？**

因为它跑在独立 worktree 里（另一个目录，同一份仓库），继承的上下文里每个路径都是父进程的。

严重的地方在于**读文件不会报错** —— 父目录依然存在、文件依然可读，它会读到父进程的旧版本，基于过时内容做判断。这类问题只有合并冲突时才暴露。所以 `buildWorktreeNotice` 专门要求「改之前重读」。

**⑧ `AgentTool` 为什么声明自己是「只读」且「并发安全」？**

因为**派 agent 这个动作**不碰文件、不跑命令。真正的读写发生在子 agent 内部，那里每一次工具调用各自过权限。

但注意「并发安全」只管派活动作，不管子 agent 之间会不会冲突 —— 两个 worker 同时改同一批文件，调度器不会拦你，那是协调者提示词的职责（写重任务一次一个）。

**⑨ 同步 agent 明明会阻塞主线程，为什么还保留这条路？**

因为短任务的同步有真实价值：派一个查文件的 agent，3 秒后拿到结果就能接着干。改成异步要多等一个通知轮次（说完「我去查」→ 结束轮次 → 通知到达 → 新轮次），对短任务来说那个停顿比等待更烦。

这 500 行复杂度（race 循环 + 随时转后台 + 优雅关闭迭代器）全部来自「前台跑但随时可以放手」这一个需求。

**⑩ 转后台时那个 `agentIterator.return(undefined)` 为什么不能省？**

因为生成器的 `finally` 块里装着 MCP 连接释放、session hooks 清理、prompt cache 跟踪表摘除。直接丢弃迭代器 = 一个已启动但永不完成的异步生成器，那些资源全部泄漏，而且因为 agent 还在「跑」，看起来一切正常。

它还要 race 一个 1 秒的 sleep —— MCP 清理最坏要 500ms 以上，卡住的服务器会拖住整个转后台操作，而用户按「转后台」的期望是「立刻」。

**⑪ 哪些动作必须「先改状态、再做清理」？为什么？**

`completeAsyncAgent` 必须在 worktree 清理和 handoff 分类之前（注释点了 issue 号 gh-20236）。因为 `TaskOutput(block=true)` 的调用方靠状态判断「能不能走了」，而后两个动作可能很慢（git status 在巨大仓库要几十秒，classify 是一次完整 API 调用）。

一条通用原则：**状态转换要尽早，副作用要尽可能晚**。这个形状在本项目里反复出现（QueryEngine 的「assistant 消息不能 await」、mcp/client 的「先 reject pending 再清缓存」）。

**⑫ 子 agent 什么都没说时，为什么要硬塞一句「(Subagent completed but returned no output.)」？**

因为那时 tool_result 里只剩下 agentId 和 usage —— 一堆元数据，没有内容。模型看到会想「这没什么可回应的」，然后直接结束轮次，用户看到界面莫名停住。

问题不在逻辑错误，而在**协议的语用层**：同样的数据，有内容时模型知道该干什么，只有元数据时模型不知道该干什么。

**⑬ 为什么给 Explore / Plan 少写一段提示能省下每周十亿 token？**

那段「可以用 SendMessage 继续这个 agent」的提示约 135 字符，而 Explore 每周跑 3,400 万次。135 × 34M ≈ 每周 1–2 G tok。

但它成立有三个前提，缺一不可：① 这些 agent 确实不会被续用；② 遥测不依赖这段文本（走 logEvent，不解析 tool_result）；③ agentType 可能缺失（resume 老会话）。第 ② 条最容易被忽略 —— 如果遥测靠正则解析 tool_result 里的 `<usage>`，这个优化会悄悄搞坏数据管道，报错还会出现在完全无关的地方。

---

## 第 8 步（终端渲染器）读完了吗？

`src/ink/` 是自己实现的 Ink（不是 npm 上的官方包），1.3 万行。六个文件、6,439 行原文，读完之后「一条用户输入 → 一屏字符」这条路是通的。

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`reconciler.ts`](annotated/src/ink/reconciler.ts) | 512 | 727 | React 19 自定义 renderer 的 host config：14 个类型参数、commit 阶段算布局、release 顺序 |
| [`dom.ts`](annotated/src/ink/dom.ts) | 484 | 685 | 七个元素名的极简 DOM、yoga 桥（两棵树两套下标）、文本测量、脏标记冒泡 |
| [`ink.tsx`](annotated/src/ink/ink.tsx) | 1,722 | 2,470 | 帧循环九阶段、双缓冲、diff 与 optimize、光标定位、终端模式、退出清理 |
| [`screen.ts`](annotated/src/ink/screen.ts) | 1,486 | 2,167 | 打包格子（2 个 int 装一格）、样式池的位标签、宽字符四态、blit/shift/clear、两帧 diff |
| [`render-node-to-output.ts`](annotated/src/ink/render-node-to-output.ts) | 1,462 | 2,180 | 沿树走一遍：blit / 清空 / 重画三选一，ScrollBox 的三遍渲染与 DECSTBM 快路径 |
| [`log-update.ts`](annotated/src/ink/log-update.ts) | 773 | 1,193 | 两帧之间到底发什么字节：全量重置的四种触发、逐格补丁、虚拟光标模型 |

合计 **6,439 行原文**，286 处批注锚点。

**这个目录可以按「三加三」记**：前三份是**上半场**（React 元素 → 布局树 → 屏幕缓冲），后三份是**下半场**（屏幕缓冲 → 终端字节）。分界线是 `screen.ts` 里的 `Screen` 类型 —— 往上都是「节点和坐标」，往下都是「格子和转义序列」。

**㊳ 终端里没有排版引擎，那 `<Text>` 的高度是谁算出来的？**

是 `dom.ts` 332 行的 `measureTextNode`。yoga 只管盒子（它不知道一个汉字和一个 `i` 差多少宽），所以 `<Text>` 节点上挂了一个 measure 回调：yoga 布局时问它「给你 `width` 这么宽，你多高」，它把整棵子树的文字展平（`squashTextNodes`）、展开 tab、按宽度折行，再量一遍。

这一个回调解释了三件看起来无关的事：为什么 `<Text>` 里不能放 `<Box>`（展不平就没法量宽度）、为什么裸字符串必须包在 `<Text>` 里（没有父级就不知道该继承什么样式、也不知道放哪一行）、为什么宽字符/emoji 要单独处理。

**㊴ 为什么 `<Box>` 套在 `<Text>` 里是**运行时抛错**，而不是「不推荐」？**

因为文本测量要求把内容展平成一段连续字符串。中间插一个 flex 盒子，这段文字就不再是「一行有宽度的字符序列」——它变成了「若干块，各自的宽度要由布局决定」，而布局又要先知道文字宽度。这是一个环，没有解。

所以这不是风格检查，是**能力边界**：`<Text>` 的子树必须能被压成字符串。

**㊵ 已经画出整屏了，为什么还要 `optimize(diff)` 这一趟？**

因为 `diff` 回答的是「哪些格子变了」，输出是逐段写入指令；`optimize` 回答的是「怎么用最少的字节写出去」——相邻同色写入合并、连续光标移动合成一条、能被一次 SGR 覆盖的样式变化不重复发。

两层分开的价值在维护上：diff 逻辑可以保持直白（就是逐格比较），字节级优化单独演进，改一个不会动另一个。终端带宽不是瓶颈，但**写入次数**影响滚动流畅度。

**㊶ `prevFrameContaminated` 到底在防什么？为什么它是个布尔量而不是计数？**

它防的是「blit 快速路径拷了不该拷的东西」。blit 的前提是「上一帧这个区域的像素还是我们以为的内容」。有两类操作会破坏这个前提：往屏幕缓冲里写选区/搜索高亮（涂改了数据）、重建 frontFrame 为空白（基准本身是假的）。两者都在帧末收敛成同一个结论：**下一帧必须全量重绘一次**。

所以它是布尔量：只需要表达「下一帧别走快路径」，下一帧画完就清掉。不需要知道被污染了几次，也不需要累加。

**㊷ `ink.tsx` 一半的复杂度都在防「失步」——为什么终端这么容易失步？**

因为「屏幕上现在是什么」这个状态，我们和终端各存了一份，而外部世界一直在单方面修改终端那一份：tmux 重画状态栏、用户按 Cmd+K、SSH 断线重连、笔记本合盖睡眠、外部编辑器进出 alt screen（写 `?1049l` 把我们踢回主屏）。

具体对策分散在各处，但模式只有三种：

- **每帧重建锚点**：alt 屏每帧先发 `CSI H` 把物理光标钉回 (0,0)，于是相对移动永远从确定位置算起（568 行）
- **主动作废基准**：`forceRedraw` 把 frontFrame 清成空白，骗 diff 说「之前什么都没有」，逼它整屏重画（825 行）
- **重新宣示模式**：`reassertTerminalModes` 在 >5 秒静默或事件循环卡顿后重设 kitty 键盘/鼠标跟踪，因为终端可能被重置过而我们这边的标志位还是「已开启」（896 行）

第三条里最值得记的细节：Kitty 键盘协议是**栈**（`CSI >1u` 压栈），所以必须 pop-before-push，否则每次空闲都加一层，退出时排不干净，`Ctrl+C` 会以转义序列的形式漏给 shell。

**㊸ 一个整数的**最低位**能干什么？`screen.ts` 用它省掉了每帧几万次判断。**

`StylePool.intern` 把 ID 算成 `(rawId << 1) | 标志位`，标志位表示「这个样式画在**空格**上有没有视觉效果」（背景色、反色、下划线等）。取回时 `>>> 1` 把标签剥掉。

下游 `visibleCellAtIndex` 对整格做一次位与 `(word1 & 0x3fffc) === 0`——这一个操作同时问了三个问题：这是空格吗、有超链接吗、样式在空格上可见吗。全否就整格跳过不写。

这是「把语义塞进 ID 的冗余位」。代价是 `get()` 多一次右移，换掉的是每格每帧一次数组查找。同一套路在 `screen.ts` 里出现三次（还有 `softWrap` 把「上一行内容结束在哪」存在下一行身上、`hyperlinkId=0` 表示无链接）。

**㊹ 宽字符占两格，覆盖其中任意一格会怎样？**

三种残形态，后果不同：

| 谁被覆盖 | 残留 | 症状 |
| --- | --- | --- |
| 宽字符被窄字符顶掉 | 后面那个 `SpacerTail` 成孤儿 | 这一列**保持上一帧的内容**（渲染时跳过占位格，没人写它） |
| 占位格被顶掉 | 前面那个宽字符变成「占一格的宽字符」 | **光标模型失步** —— 终端仍按两列画，之后所有坐标都偏 |
| 宽字符盖宽字符 | 对方更靠后的占位格成孤儿 | 那一列残留旧内容 |

第二条最严重：它不是显示错，是**我们和终端对「第 x 列在哪」的理解分了叉**。所以 `setCellAt` 里那三段清理都必须发生在写入时，而不是「渲染前统一扫一遍」—— 扫描是全屏的，写入是单格的。

**㊺ blit 的前提是「上一帧这块没变」。父节点干净为什么不等于子树干净？**

正常情况下 React 的 dirty 是向上冒泡的（子脏父必脏），所以父节点干净 ⇒ 子树没变。但有三条路径**绕过冒泡**，每一条都在 `render-node-to-output.ts` 里留了一个补丁：

- **`display:none`**：`hideInstance` 的 markDirty 只往上走，子孙的 dirty 保持 false，cache 里还留着隐藏前的位置。取消隐藏时若位置恰好没变，blit 检查全过 → 从已被清空的位置拷回空白 → **内容消失**（只在位置没变时出现，挪一下窗口反而好了）
- **`pendingScrollDelta`**：滚动还没排空，位置即将变而 dirty 已被清
- **被裁剪的子节点**：cache 被删了（为了防「重新进入视口时对别人的位置发 clear」），但它不是 dirty

所以 blit 那八个条件里，有五个是在确认「我凭什么相信这块没变」，不是「这块变了吗」。

**㊻ 光标下移一行，`LF` 和 `CSI n B` 有什么区别？**

在虚拟模型里都是 `y += 1`，但真实终端里：`CSI CUD`（cursor down）**在视口底边会停住且不滚动**——规范就是这么定的，它只移动光标不改内容。而 `LF` 会滚动。

所以 `renderFrameSlice` 推进到新行时必须用 `CR + LF`。用 CUD 的后果：光标已经到底了，再要求它往下走它不动，而虚拟光标以为它动了 → 两者永久差一行 → 之后每帧都错位。

这是整个渲染层最典型的一类 bug：**两个操作在模型里等价，在终端里不等价**。同类的还有「清 N 行之后光标在哪」（少算一行就整块上移）、「写满最后一列时是否已经换行」（DEC 的 pending wrap，`moveCursorTo` 里专门要发一个 CR 把它消化掉）。

**㊼ 全量重绘会闪，那什么时候非闪不可？**

四个判据，都写在 `log-update.ts` 里，每个调用点都解释了「为什么这次躲不掉」：

| 场景 | 为什么不能增量 |
| --- | --- |
| 终端 resize | 增量更新要预测「重排后每行长什么样」，等于重算一遍换行 |
| 内容从「超出视口」缩到「视口内」 | 顶部那些行已经在 scrollback 里，而清屏指令**不能把 scrollback 拉回视野** |
| 改动落在 scrollback 区域 | 光标到不了那里 —— 跳过这一格会在历史里留一个错字，用户往回翻就看见 |
| 要清的行数 > 视口高度 | 同理，`eraseLines` 只能在视口内工作 |

函数名直接叫 `fullResetSequence_CAUSES_FLICKER`。**当某个操作有不可避免的副作用时，把副作用写进名字**，比写注释更难被忽略。

---

**㊽ 收口题：一个汉字从 React 元素到终端上的一格，中间换了几个身份？**

五次，每次都由不同的层负责：

1. **React 元素** —— `<Text>本</Text>`。此时它还只是一个「有样式的子节点」，连尺寸都没有
2. **yoga 节点** —— `dom.ts` 给它建布局盒。但 yoga **不识字宽**，所以 `<Text>` 上挂了 measure 回调，把子树展平、折行、量高度
3. **字符串片段** —— `render-node-to-output.ts` 的 `squashTextNodesToSegments` 把它变成 `{ text: '本', styles, hyperlink }`，换行、套样式、缩进之后是一个带转义序列的字符串
4. **两个 int** —— `output.write` 把它 tokenize 成格子，`setCellAt` 写进 `cells`：`word0 = charPool.intern('本')`，`word1 = styleId<<17 | hyperlinkId<<2 | Wide`，并在下一列补一个 `SpacerTail`
5. **字节** —— `log-update.ts` 比较前后两帧，发现这格变了 → 发 `CSI x;y H`（或相对移动）+ SGR 转移 + `本`，然后**光标前进两列**

每一步都有一次「信息丢失」，也都有一次「补回来」：

- 第 2 步丢了字符内容（yoga 只见盒子），靠 measure 回调补
- 第 3 步丢了「这是原文的换行还是折行的换行」，靠 `softWrap` 补
- 第 4 步丢了「这个格子是不是真的写过了」（未写和写了空格都是全 0），靠 `softWrap` 的「内容结束列」补
- 第 5 步丢了「终端认为这个字符多宽」，靠 `needsWidthCompensation` 补（老终端的 wcwidth 表更新很慢，emoji 会被算成 1 列 → 用 CHA 强制对齐光标）

读完这条链再回头看第 1～7 步，会发现同一个模式反复出现：**凡是有「两份状态」的地方（我们的模型 vs 终端的实际、客户端预算 vs 服务端预算、设计声明的数值 vs 开发落地的数值），所有复杂度都在处理两者的偏差。**

### 这一轮修的一个判据误报

`screen.ts` 的原文里有这么一行英文注释，举例时用了汉字：

```
// Scenario: [a, 💻, spacer] → [本, spacer, ORPHAN spacer] when
```

`check-fidelity.py` 判定「批注版行」的规则是「这行注释里有没有中日韩字符」。这一行有一个「本」，于是被判成中文批注、从「原文注释」那一堆里排除，然后判据 2 报「原文注释丢失 1 行」。

**这是误报，不是批注出错。** 修法是把判据从「含有中日韩字符」改成「以中日韩字符为主」（占比 ≥ 15%）：中文批注行里中文通常占 30%–80%，而英文注释夹一两个汉字不到 5%，两边分得开。

这是本项目第三次「校验工具本身出错」：前两次分别是模板字符串扫描器被布尔量骗过（46 行批注一直错位）、`check-links.py` 用 `isfile` 判目录链接。

规律很清楚：**当一个判据写成「含有某类字符」时，先想一遍「正常内容里会不会恰好含有它」。** 边界情况的误报比漏报更难发现，因为它只在特定输入上出现，而且报告的信息离真正原因很远。

同一轮还顺手清掉两个积累下来的工具问题：

- **sourceMappingURL 的例外从「手工登记文件」改成「自动识别」**。以前每批注一个带 sourcemap 的文件就要往 `KNOWN_OMIT` 里加一条，忘了就报失败。现在判据 2 自己认 `//# sourceMappingURL=` 开头且超长的行，标成 `OK*`。清掉登记表之后，全仓库一次跑通 —— 说明那三条登记早就该删了。
- **批注版的行尾统一成 LF**。原文里有些文件是 CRLF（Windows 检出的），`annotate.py` 用 `newline=''` 读，行里带着 `\r`，于是新插的批注行是 LF、原代码行是 CRLF。校验不受影响（`read_lines` 会 `rstrip`），但文件是混合行尾。修完之后 41 个文件全是纯 LF，而 git 层面零 diff —— 因为仓库里本来就存 LF，那层 `\r` 只存在于工作区。

---

## 继续往下读之前

**第 6 步的三条主线都完整了**：

- **压缩管线**：`src/services/compact/` 目录下 11 个 `.ts` 全部批注完，从「什么时候压」到「压完清什么」没有缺口
- **MCP 协议与策略**：`config.ts`（配置从哪读、允不允许连）→ `client.ts`（七种 transport、连上之后怎么活）→ `auth.ts`（OAuth 全流程、凭据存哪、什么时候刷新、什么清）→ `xaa.ts` + `xaaIdpLogin.ts`（不弹窗那条路的两次换票）→ `useManageMCPConnections.ts`（怎么接进 UI）。四段首尾相接 —— `client.ts` 里那个 `needs-auth` 状态，落到 `auth.ts` 才有答案；`auth.ts` 里那个 `xaaRefresh`，落到 `xaa.ts` 才有实现。

第 7 步的多智能体主线也收口了：4 个文件、2,263 行原文、133 处锚点。

现在整条链路是：

```
cli.tsx → setup.ts → QueryEngine → query.ts → claude.ts
                                        ├─ compact 全目录（11 个文件，含压缩提示词）
                                        ├─ withRetry（发请求的失败重试）
                                        └─ mcp/config（有哪些服务器、允不允许）
                                              └─ mcp/client（连上之后怎么活）
                                                    ├─ mcp/auth（401 之后：授权、刷新、吊销）
                                                    │     └─ mcp/xaa + xaaIdpLogin（企业 SSO：两跳换票）
                                                    ├─ useManageMCPConnections（异步事件 → AppState）
                                                    └─ AgentTool → coordinator / fork / 普通子 agent
                                                          └─ runAgent（同一套 query 循环，换个身份跑）

（以上全是「业务逻辑」。它们最终都变成 React 元素，交给下面这一层画到屏幕上：）

```
src/ink/reconciler.ts（React 认得终端 DOM）→ dom.ts（树 + yoga + 测量）
                                          → ink.tsx（一帧九阶段：渲染 → diff → 写终端）
                                                └─ render-node-to-output.ts（树 → 格子）
                                                      └─ screen.ts（打包格子 / blit / shift / 两帧 diff）
                                                            └─ log-update.ts（差异 → 终端字节）
```

**主干到此为止**。剩下的都是枝叶，不影响理解整体设计：

- [`src/ink/`](source/src/ink/) 还差 30 来个百行级小件：`parse-keypress.ts`（键序列 → 事件）、`render-border.ts`（边框字符）、`selection.ts`（拖选）、`optimizer.ts`（写入合并）、`wrapAnsi.ts` 等。它们是主线的螺丝，遇到具体问题时再翻
- [`src/ink/components/`](source/src/ink/components/) + [`src/ink/hooks/`](source/src/ink/hooks/) —— 交互原语（`<Box>` / `<Text>` / `useInput` / `ScrollBox`），比 `components/` 更薄、更接近框架
- [`src/services/mcp/`](source/src/services/mcp/) 里还有 16 个百行级小件：`utils.ts` 575、`elicitationHandler.ts` 313、`channelNotification.ts` 316、`channelPermissions.ts` 240、`types.ts` 258 等
- [`src/components/`](source/src/components/)（4.2 万行，389 个文件）—— 具体界面组件。上层的 React 组件，读它们主要是读产品逻辑，不是读架构
- [`src/commands/agents/agents.tsx`](source/src/commands/agents/agents.tsx) —— 只有 11 行，是个入口壳，真正的交互在 `components/agents/AgentsMenu.tsx`（799 行）

到这里，**第 1 到第 8 步的主线全部走完**：41 个文件、38,850 行原文（批注版 66,677 行）、2,010 处锚点。整条链从一条用户输入到它变成 API 请求、变成工具调用、变成子 agent 分工、变成一次 MCP 远端调用，最后变成一个汉字占两个 `int` 写进终端，中间没有断点了。

我的建议是**现在停下来回头读一遍索引**。特别是三处「跨文件才能看懂」的地方，它们单独看都不显眼，串起来才是设计：

1. **缓存前缀稳定性** —— `prompts.ts` 的动态边界 → `claude.ts` 的 `deferred_tools_delta` → `AgentTool/prompt.ts` 把 agent 清单挪进 attachment → `microCompact` 宁可逻辑删除也不改本地字节。同一个手法出现四次。
2. **`needs-auth` 这个状态** —— `config.ts` 决定「允不允许连」→ `client.ts` 返回 `{type:'needs-auth'}` → `auth.ts` 的 `hasMcpDiscoveryButNoToken` 判断「跳过连接直接提示授权」。一个状态的定义和使用分在三个文件里。
3. **失败归因** —— `withRetry` 的 529 白名单、`compact.ts` 的 PTL 逃生舱、`auth.ts` 的 `failureStage` 游标，本质都是「先分清是哪一类失败，再决定怎么办」。三处用了三种不同的手法（白名单 / 专用错误类 / 里程碑布尔量）。

想继续的话，说模块名就行。剩下的方向按性价比排：

- **UI 线**（`ink/` 渲染器）—— 5.5 万行，是最大的未读区。价值在于「终端里怎么做到像 GUI」，但和工作原理无关
- **`xaa.ts` / `xaaIdpLogin.ts`** —— 补完 XAA 的细节，只有 998 行，但属于「知道了很好，不知道也不影响」
- **回头重读** —— 我推荐这个

---

## 这一轮修的一个工具缺陷（第三类结构破坏）

**中文批注插在 `//` 注释段中部，把英文句子劈成两半。**

`annotate.py` 之前只防「插进 `/* */` 块注释」和「插进多行模板字符串」，但 `//` 连续注释同样成段。锚点落在段中部时，结果是：

```
// When clearAllThinking is set (>1h idle = cache miss), keep only the last
// 中文批注……
// thinking turn — the API schema requires value >= 1, and omitting the edit
```

语法完全合法，`check-fidelity.py` 也看不出来（注释一行都没少），但读的人得把上下两截英文自己接起来。这类破坏比前两类更隐蔽，因为它**不改变行为也不丢内容**，只是把一句话剪断了。

修法：`before` 自动挪到段首、`after` 自动挪到段尾（单行注释段不产生位移）。全量重新生成后共纠正 **72 处**，其中 `bashSecurity.ts` 一个文件 42 处、`query.ts` 17 处 —— 说明这个错误在之前几轮里一直在积累，只是没人从「句子被剪断」这个角度看。

顺带修了上一轮 `claude.ts` 的一处：`Options.taskBudget` 那四行英文注释被劈了（提交 `6b09281` 引入）。

---

## 这一轮修的工具缺陷（第四类：扫描器自己判错了）

写第 7 步时，`prompt.ts` 报了一个 `check-fidelity` 失败：272-286 行的中文批注「插进了多行模板字符串内部」。

查下去发现**批注位置是对的**，判错的是扫描器。它用一个布尔量 `in_tpl`，遇到反引号就翻转。而 `prompt.ts` 第 260 行有这种写法：

```ts
${forkEnabled ? 'When spawning a fresh agent (with a `subagent_type`), ...' : ''}
```

模板**表达式**里的普通字符串中出现反引号 —— 被当成模板闭合。于是模板在第 260 行「提前结束」，后面的代码进入「模板内部」状态，一直到下一个反引号才闭合，中间所有批注全部误报。

再往下查，同一类问题还有第二种形态，而且方向相反：

```
 *   whitespace + `)` for the $(cat <<'EOF'...EOF)` inline form)
```

这是 `bashSecurity.ts` 第 472 行，一条**块注释**的续行。块注释里的反引号被当成模板开启，然后一直延续到七十行之后才闭合 —— 那段里的锚点被 `annotate.py` 当成「落在模板内部」，**错误地外移了 46 行**。也就是说这个 bug 之前一直在**悄悄挪动批注位置**，而 `check-fidelity` 只报「这一段有中文」（误报），不报「批注被挪走了」。

两种错误方向相反但后果一样：校验失去意义。所以两个脚本都换成了**状态栈**词法扫描器：

| 状态 | 什么时候进 | 里面遇到什么会退 |
| --- | --- | --- |
| `code` | 栈底 | — |
| `tpl` | 遇到反引号 | 反引号（记一次 span）；`${` 则**压入** `expr` |
| `expr` | `tpl` 里的 `${` | 配对的 `}`（花括号计数，支持 `${{a:1}}`）；反引号则压入 `tpl` |
| `block` | 遇到 `/*` | `*/` |

改完重跑全量 24 个文件，`bashSecurity.ts` 有 46 行变化 —— 全是那批被错误外移的批注**回到了原位**（比如 `isSafeHeredoc` 的形态说明回到了函数声明之前，而不是被推到后面的 `for` 循环里）。

这类 bug 的教训是：**校验工具本身也要被质疑**。当一个文件报失败而目视检查合理时，先怀疑扫描器，不要急着改批注 —— 否则会把正确的批注改错。

---

## 这一轮修的第五类问题（批注数据自己的转义）

批注数据是 Python 文件里的三引号字符串，所以**批注正文也要走 Python 的转义规则**。写 `auth.ts` 那段「raw mode 下要自己处理哪些控制字符」时踩到了：

```python
//     \n / \r   提交        ← Python 把 \n \r 变成真换行，一行批注裂成三行
//     \u0003    Ctrl-C      ← 变成不可见的 ETX 控制字符
//     \b        退格         ← 变成退格符
```

结果 `check-fidelity.py` 报「第 1813 个代码行不一致：原文 `return new Promise(...)`，批注版是『提交』」—— 因为那一行裂出来的裸中文（没有 `//` 前缀）被当成了代码行。

这类问题的特点是：**批注文件本身语法合法**（Python 照常执行）、**生成脚本也正常**（它只管给每行加 `//`），只有对着「代码行序列」逐行比对的校验能发现。而报错信息指向的位置（`return new Promise`）和真正的问题（四行批注的上方）离得很远。

三条经验：

1. **批注里要写字面反斜杠，一律双写**（`\\n`）。或者干脆用文字描述（「换行符」「回车符」），反正读者是中文用户，`\n` 不比「换行」更清楚。
2. **校验脚本要能指出「哪一行是多余的」**，而不只是「第 N 个代码行不一致」。现在的报错只给了序号和两个值，定位靠人肉数。这是一个可以改进的点。
3. **写完一批批注先跑一次校验再往下写**。这次是四个分片全写完才跑，所以出问题时不知道是哪个分片 —— 只能靠 grep `^\*` 和 `\\[nrtub]` 反查。

顺带一提，同一轮还修了另一个纯排版问题：`1570` 那个锚点原本落在 `//` 注释段中部，被自动挪到段首 `1554`，于是两条批注叠在一起没有空行分隔。修法是在批注文本开头加一个空行（`render()` 会把空行输出成裸 `//`，正好当分隔线）。
