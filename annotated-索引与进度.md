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

- 内联 `sourceMappingURL`（一行几万到十六万字符的 base64）会被换成一句中文说明，校验时标成 `OK*` 而不是失败。**当前命中 60 个文件** —— 凡是 React Compiler 编译过的 `.tsx` 基本都带这么一行，只有少数手写 `.ts` 没有。查当前名单：`python scripts/check-fidelity.py | grep 'OK\*'`
- 原文里 CRLF 行尾的文件，批注版统一成 LF（否则会是「代码行 CRLF + 批注行 LF」的混合行尾）。git 仓库里本来就存 LF，所以这一步在 diff 上看不出变化

然后跑 `python scripts/check-links.py` 检查所有 Markdown 链接（源码链接 + 文档内链）。

想知道某个目录**还剩多少没批注**，跑 `python scripts/check-coverage.py`（不带参数看 `services/`）：它按子目录列出「已做/总数 + 已做行数/总行数」，并把未做的文件按行数降序排出来。本文档里所有「N/M 份」的数字都来自它，不是手数的。

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
| **第 6 步** 读服务层（半天）      | `src/services/` 各模块                                                                | [`api/` 全 20 份](annotated/src/services/api/) ✅<br />[`compact/` 全 11 份](annotated/src/services/compact/) ✅<br />[`mcp/` 全 23 份](annotated/src/services/mcp/) ✅<br />[`oauth/` 全 5 份](annotated/src/services/oauth/) ✅<br />[`tools/` 全 4 份](annotated/src/services/tools/) ✅<br />[`lsp/` 全 7 份](annotated/src/services/lsp/) ✅<br />[`SessionMemory/` 全 3 份](annotated/src/services/SessionMemory/) ✅<br />[`analytics/` 全 9 份](annotated/src/services/analytics/) ✅<br />[`teamMemorySync/` 全 5 份](annotated/src/services/teamMemorySync/) ✅<br />[`PromptSuggestion/` 全 2 份](annotated/src/services/PromptSuggestion/) ✅<br />[`plugins/` 全 3 份](annotated/src/services/plugins/) ✅<br />[`extractMemories/` 全 2 份](annotated/src/services/extractMemories/) ✅<br />[`tips/` 全 3 份](annotated/src/services/tips/) ✅<br />[`settingsSync/` 全 2 份](annotated/src/services/settingsSync/) ✅<br />[`autoDream/` 全 4 份](annotated/src/services/autoDream/) ✅<br />[`MagicDocs/` 全 2 份](annotated/src/services/MagicDocs/) ✅<br />[`policyLimits/` 全 2 份](annotated/src/services/policyLimits/) ✅<br />[`AgentSummary/`](annotated/src/services/AgentSummary/) + [`toolUseSummary/`](annotated/src/services/toolUseSummary/) + 根目录 6 散件 ✅ | ✅ 全目录清零<br />130/130 文件（100% 行数） |
| **第 7 步** UI 与多智能体（可选）  | `src/components/`、`src/ink/`、`src/coordinator/`                                    | [`coordinatorMode.ts`](annotated/src/coordinator/coordinatorMode.ts) ✅<br />[`AgentTool.tsx`](annotated/src/tools/AgentTool/AgentTool.tsx) ✅<br />[`AgentTool/prompt.ts`](annotated/src/tools/AgentTool/prompt.ts) ✅<br />[`forkSubagent.ts`](annotated/src/tools/AgentTool/forkSubagent.ts) ✅ | ✅ 多智能体主线完成 |
| **第 8 步** 终端渲染器（进阶，可选） | `src/ink/`（自研 Ink，1.98 万行）                                                        | [`reconciler.ts`](annotated/src/ink/reconciler.ts) ✅<br />[`dom.ts`](annotated/src/ink/dom.ts) ✅<br />[`ink.tsx`](annotated/src/ink/ink.tsx) ✅<br />[`screen.ts`](annotated/src/ink/screen.ts) ✅<br />[`render-node-to-output.ts`](annotated/src/ink/render-node-to-output.ts) ✅<br />[`log-update.ts`](annotated/src/ink/log-update.ts) ✅<br />[`output.ts`](annotated/src/ink/output.ts) ✅<br />[`styles.ts`](annotated/src/ink/styles.ts) ✅<br />[`colorize.ts`](annotated/src/ink/colorize.ts) ✅<br />[`stringWidth.ts`](annotated/src/ink/stringWidth.ts) ✅<br />[`Ansi.tsx`](annotated/src/ink/Ansi.tsx) ✅<br />[`parse-keypress.ts`](annotated/src/ink/parse-keypress.ts) ✅<br />[`selection.ts`](annotated/src/ink/selection.ts) ✅<br />[`hit-test.ts`](annotated/src/ink/hit-test.ts) ✅<br />[`render-border.ts`](annotated/src/ink/render-border.ts) ✅<br />[`ink/` 其余 31 个小件](annotated/src/ink/) ✅<br />[`components/`](annotated/src/ink/components/) + [`hooks/`](annotated/src/ink/hooks/) + [`events/`](annotated/src/ink/events/) ✅ | ✅ 九十六份全通<br />（`src/ink/` 清零） |
| **第 9 步** 产品界面层（可选） | `src/components/`（8.2 万行，389 个文件） | [`Messages.tsx`](annotated/src/components/Messages.tsx) ✅<br />[`MessageRow.tsx`](annotated/src/components/MessageRow.tsx) ✅<br />[`Message.tsx`](annotated/src/components/Message.tsx) ✅<br />[`messageActions.tsx`](annotated/src/components/messageActions.tsx) ✅<br />[`PromptInput/` 全 21 份](annotated/src/components/PromptInput/) ✅（含 `PromptInput.tsx` 2,338 行）<br />[`messages/` 全 41 份](annotated/src/components/messages/) ✅（含 `SystemTextMessage.tsx` 827 行、`AttachmentMessage.tsx` 536 行） | 🚧 消息主链 + 输入框 + 消息体（66/389） |

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

## 第 6 步（服务层）做到哪了？——全目录清零，130/130

`src/services/` 是整份源码里最大的目录：**130 个文件 / 53,683 行**。
它不是「一个模块」，而是十几个互不相干的模块挤在同一个目录名下
（API 客户端、压缩、MCP、OAuth、LSP、遥测、语音、插件管理……）。
**这一目录已 100% 完成**：20 个子目录全部清零，根目录 6 份散件也已做完。

所以这一节的进度**按子目录报，不按「第几步」报**。
之前这里写过「✅ 完成（含 16 个小件）」，那是不实的 ——
当时全目录只做了 35 份，`services/api/` 还有 18 份没动，
而「一次请求怎么发出去、怎么失败、怎么记账」这件事恰恰全在那 18 份里。
现在连根目录散件都清零了：

| 子目录                     | 文件    | 原文行数      | 中文批注行 | 状态      |
| ----------------------- | ----- | --------- | ----- | ------- |
| `services/mcp/`         | 23/23 | 12,311    | 4,414 | ✅ 清零    |
| `services/api/`         | 20/20 | 10,477    | 2,807 | ✅ 清零    |
| `services/compact/`     | 11/11 | 3,960     | 3,407 | ✅ 清零    |
| `services/lsp/`         | 7/7   | 2,460     | 642   | ✅ 清零    |
| `services/oauth/`       | 5/5   | 1,051     | 325   | ✅ 清零    |
| `services/tools/`       | 4/4   | 3,113     | 292   | ✅ 清零    |
| `services/SessionMemory/` | 3/3 | 1,026     | 312   | ✅ 清零    |
| `services/analytics/`    | 9/9   | 4,040     | 436   | ✅ 清零    |
| `services/teamMemorySync/` | 5/5 | 2,167     | 266   | ✅ 清零    |
| `services/PromptSuggestion/` | 2/2 | 1,514     | 34    | ✅ 清零    |
| `services/plugins/`         | 3/3 | 1,616     | 39    | ✅ 清零    |
| `services/remoteManagedSettings/` | 5/5 | 950     | 167   | ✅ 清零    |
| `services/extractMemories/` | 2/2 | 769     | 32    | ✅ 清零    |
| `services/tips/` | 3/3 | 761     | 25    | ✅ 清零    |
| `services/settingsSync/` | 2/2 | 648     | 26    | ✅ 清零    |
| `services/policyLimits/` | 2/2 | 690     | 27    | ✅ 清零    |
| `services/autoDream/` | 4/4 | 550     | 33    | ✅ 清零    |
| `services/MagicDocs/` | 2/2 | 381     | 19    | ✅ 清零    |
| `services/AgentSummary/` | 1/1 | 179     | 13    | ✅ 清零    |
| `services/toolUseSummary/` | 1/1 | 112     | 7     | ✅ 清零    |
| `services/` 根目录 6 份散件 | 6/6 | 549     | 36    | ✅ 清零    |
| **合计**                  | **130/130** | **53,683 / 53,683（100%）** | **13,381** | ✅ 全目录清零 |

> 中文批注行数由 `python scripts/check-fidelity.py` 逐文件统计后相加，可复算；
> 「原文行数」是源文件总行数（含注释与空行），所以比「代码行合计」大。
> ⚠️ 2026-10-22 修掉了 check-fidelity 的一个**计数虚高 bug**：`ANN_PREFIXES` 里的
> `// ─` / `// ═` 会撞上源码自带的同款英文分节符（如 `// ── Search materialized ──`），
> 批注侧不看 CJK 占比就把它们算成「中文批注」——全仓 170 个文件、688 行被虚高
> （`pluginOperations.ts` 一个文件就虚高 6 行）。修复后同一份脚本算出的 services
> 合计从 12,959 降到 12,768，差值正是这类英文分节符，不是批注变少了。

---

### `services/api/` —— 20 份（一次请求怎么发、怎么失败、怎么记账）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`claude.ts`](annotated/src/services/api/claude.ts) | 3,419 | 4,655 | SSE 解析、缓存打点、sticky latch、三级降级 |
| [`errors.ts`](annotated/src/services/api/errors.ts) | 1,207 | 1,467 | 错误分类、**错误转 assistant 消息**、`NO_RESPONSE_REQUESTED` 哨兵 |
| [`withRetry.ts`](annotated/src/services/api/withRetry.ts) | 822 | 1,418 | 重试边界、退避曲线、529 白名单、无限重试模式 |
| [`logging.ts`](annotated/src/services/api/logging.ts) | 788 | 988 | 七个 AI 网关靠响应头前缀识别、`_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` |
| [`filesApi.ts`](annotated/src/services/api/filesApi.ts) | 748 | 889 | 把「该不该重试」变成返回值、`normalize` 后判 `..` 防穿越、30 行手写并发池 |
| [`promptCacheBreakDetection.ts`](annotated/src/services/api/promptCacheBreakDetection.ts) | 727 | 925 | 缓存为什么碎、只追 5 个前缀、`stripCacheControl`、MCP 名脱敏 |
| [`sessionIngress.ts`](annotated/src/services/api/sessionIngress.ts) | 514 | 618 | 链式追加 + 乐观并发、409 和解、会话级串行 |
| [`client.ts`](annotated/src/services/api/client.ts) | 389 | 583 | 四级 region 优先级、SDK logger 全走 stderr、只记布尔不记凭据 |
| [`grove.ts`](annotated/src/services/api/grove.ts) | 357 | 491 | 三态开关、**失败不缓存否则死锁** |
| [`referral.ts`](annotated/src/services/api/referral.ts) | 281 | 404 | 单飞存 Promise、主入口三条路径都不同步等网络 |
| [`errorUtils.ts`](annotated/src/services/api/errorUtils.ts) | 260 | 408 | 18 个 OpenSSL 码穷举、沿 `cause` 链挖、两级判断深优先 |
| [`dumpPrompts.ts`](annotated/src/services/api/dumpPrompts.ts) | 226 | 362 | init 块 + 增量日志、0.01ms 判断省 300ms 序列化 |
| [`metricsOptOut.ts`](annotated/src/services/api/metricsOptOut.ts) | 159 | 276 | 两层 TTL 的职责划分、**缓存投毒**防御 |
| [`bootstrap.ts`](annotated/src/services/api/bootstrap.ts) | 141 | 230 | 四道门、重试回调里必须重读 token |
| [`overageCreditGrant.ts`](annotated/src/services/api/overageCreditGrant.ts) | 137 | 243 | 三个相似缓存三种过期策略 —— 因为这是钱 |
| [`adminRequests.ts`](annotated/src/services/api/adminRequests.ts) | 119 | 187 | 可辨识联合、交叉类型而非嵌套、幂等 POST |
| [`usage.ts`](annotated/src/services/api/usage.ts) | 63 | 117 | 三个提前返回 = 失败语义分三级 |
| [`firstTokenDate.ts`](annotated/src/services/api/firstTokenDate.ts) | 60 | 118 | `!== undefined` 而非 `!x`（null 是有效答案）、写端校验让读端放心 |
| [`ultrareviewQuota.ts`](annotated/src/services/api/ultrareviewQuota.ts) | 38 | 83 | `X \| null` 不给 undefined/异常、`logForDebugging` 与 `logError` 反推严重性 |
| [`emptyUsage.ts`](annotated/src/services/api/emptyUsage.ts) | 22 | 73 | 一段注释里的 import 链自白、共享常量必须 `Readonly` |

**这 20 份合起来回答一个问题**：一次 API 调用从发出到记账，中间要过哪些关。
`client.ts` 造请求 → `claude.ts` 解流 → `withRetry.ts` 管重试 → `errors.ts` 决定
失败长什么样 → `sessionIngress.ts` 把消息追加到会话 → `logging.ts` 记账。
中间那些 `*.ts` 每一份都是这条链上某个具体问题的补丁。

---

### `services/compact/` —— 11 份（上下文快满时怎么办）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`compact.ts`](annotated/src/services/compact/compact.ts) | 1,705 | 3,628 | 摘要压缩本体、PTL 逃生舱、七类附件重建 |
| [`sessionMemoryCompact.ts`](annotated/src/services/compact/sessionMemoryCompact.ts) | 630 | 1,517 | 零 API 调用的拼接式压缩、82 行索引对齐 |
| [`microCompact.ts`](annotated/src/services/compact/microCompact.ts) | 530 | 1,352 | 缓存热不热决定改不改本地内容 |
| [`prompt.ts`](annotated/src/services/compact/prompt.ts) | 374 | 723 | 压缩提示词本体，三套模板的差异与理由 |
| [`autoCompact.ts`](annotated/src/services/compact/autoCompact.ts) | 351 | 668 | 阈值计算、四道抑制闸门、三振熔断、session memory 优先 |
| [`apiMicrocompact.ts`](annotated/src/services/compact/apiMicrocompact.ts) | 153 | 328 | 发给 API 的 `context_management` 指令（**不调模型**） |
| [`postCompactCleanup.ts`](annotated/src/services/compact/postCompactCleanup.ts) | 77 | 339 | 压缩后清什么、清哪一层、什么故意不清 |
| [`grouping.ts`](annotated/src/services/compact/grouping.ts) | 63 | 202 | 按 API 轮次切刀口，以及为什么只有一个判据 |
| [`timeBasedMCConfig.ts`](annotated/src/services/compact/timeBasedMCConfig.ts) | 43 | 228 | 缓存注定要 miss 时顺手整理上下文 |
| [`compactWarningState.ts`](annotated/src/services/compact/compactWarningState.ts) | 18 | 71 | 一个布尔量的时序问题 |
| [`compactWarningHook.ts`](annotated/src/services/compact/compactWarningHook.ts) | 16 | 105 | 为什么 6 行 hook 要单独一个文件 |

---

### `services/mcp/` —— 23 份（MCP 从「允不允许连」到「接进 UI」）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`client.ts`](annotated/src/services/mcp/client.ts) | 3,348 | 4,775 | 七种 transport、错误桥接、MCP 工具封装 |
| [`auth.ts`](annotated/src/services/mcp/auth.ts) | 2,465 | 4,355 | OAuth 全流程、XAA、step-up 补丁、跨进程刷新锁 |
| [`config.ts`](annotated/src/services/mcp/config.ts) | 1,578 | 3,076 | 六种配置来源、优先级、去重、白黑名单策略 |
| [`useManageMCPConnections.ts`](annotated/src/services/mcp/useManageMCPConnections.ts) | 1,141 | 1,630 | 异步事件 → AppState 的适配层、16ms 批处理 |
| [`utils.ts`](annotated/src/services/mcp/utils.ts) | 575 | 651 | 名字过滤、配置哈希、过期客户端回收、项目级 server 信任判定 |
| [`xaa.ts`](annotated/src/services/mcp/xaa.ts) | 511 | 811 | 两跳换票：id_token → ID-JAG → access_token、三道防混淆闸 |
| [`xaaIdpLogin.ts`](annotated/src/services/mcp/xaaIdpLogin.ts) | 487 | 708 | 一次浏览器弹窗、id_token 按 issuer 缓存、URL 拼接两个坑 |
| [`channelNotification.ts`](annotated/src/services/mcp/channelNotification.ts) | 316 | 360 | 通道的六道闸 + `<channel>` 标签怎么拼 |
| [`elicitationHandler.ts`](annotated/src/services/mcp/elicitationHandler.ts) | 313 | 360 | server 向人提问（表单 / 打开链接）的整条链路 |
| [`types.ts`](annotated/src/services/mcp/types.ts) | 258 | 296 | 八种 transport 的配置 schema、连接状态机 |
| [`channelPermissions.ts`](annotated/src/services/mcp/channelPermissions.ts) | 240 | 287 | 把审批提示发到手机，等一句 "yes tbxkq" |
| [`claudeai.ts`](annotated/src/services/mcp/claudeai.ts) | 164 | 195 | 从 claude.ai 拉组织下发的 server 列表 |
| [`headersHelper.ts`](annotated/src/services/mcp/headersHelper.ts) | 138 | 166 | 连之前先跑一条本地命令，拿动态 header |
| [`SdkControlTransport.ts`](annotated/src/services/mcp/SdkControlTransport.ts) | 136 | 159 | 把 JSON-RPC 套进 control 信封，跨进程 |
| [`vscodeSdkMcp.ts`](annotated/src/services/mcp/vscodeSdkMcp.ts) | 112 | 135 | 和 VSCode 扩展之间的两条 notification |
| [`mcpStringUtils.ts`](annotated/src/services/mcp/mcpStringUtils.ts) | 106 | 132 | `mcp__server__tool` 的拼与拆 |
| [`oauthPort.ts`](annotated/src/services/mcp/oauthPort.ts) | 78 | 102 | 回调端口怎么挑（含 Windows 的坑） |
| [`channelAllowlist.ts`](annotated/src/services/mcp/channelAllowlist.ts) | 76 | 90 | 哪些插件被批准可以当通道 |
| [`MCPConnectionManager.tsx`](annotated/src/services/mcp/MCPConnectionManager.tsx) | 73 | 236 | **React Compiler 编译产物读法**：`_c(6)` 缓存槽、`t0` 临时名、连 JSX 元素也缓存 |
| [`officialRegistry.ts`](annotated/src/services/mcp/officialRegistry.ts) | 72 | 92 | 官方 MCP 名单（只用于埋点） |
| [`InProcessTransport.ts`](annotated/src/services/mcp/InProcessTransport.ts) | 63 | 83 | 同进程里的一对假传输 |
| [`envExpansion.ts`](annotated/src/services/mcp/envExpansion.ts) | 38 | 56 | `${VAR:-默认值}` |
| [`normalization.ts`](annotated/src/services/mcp/normalization.ts) | 23 | 44 | 把 server 名洗成 `^[a-zA-Z0-9_-]{1,64}$`，claude.ai 前缀额外塌缩下划线 |

MCP 这条线可以按四段读：`config.ts`（允不允许连）→ `client.ts`（连上怎么活）
→ `auth.ts`（401 之后怎么办）→ `xaa*.ts`（不弹窗那条路怎么走），
最后 `useManageMCPConnections.ts` 把它接进 UI，`MCPConnectionManager.tsx` 把两个动作递给组件树。

---

### `services/oauth/` —— 5 份（登录一次，之后靠刷新）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`client.ts`](annotated/src/services/oauth/client.ts) | 566 | 744 | 第 187 行注释 = 一次「省 7M 请求/天」的优化差点让订阅类型永久丢失；refresh 扩权依赖后端 `ALLOWED_SCOPE_EXPANSIONS` |
| [`auth-code-listener.ts`](annotated/src/services/oauth/auth-code-listener.ts) | 211 | 315 | 延迟响应（攥着 `res` 等 token 换完再补 302）、`port ?? 0`、判路径防 favicon 打断 |
| [`index.ts`](annotated/src/services/oauth/index.ts) | 198 | 323 | 浏览器内/外两条路径赛跑收敛成一个 Promise、`skipBrowserOpen` 由「谁拥有屏幕」决定 |
| [`getOauthProfile.ts`](annotated/src/services/oauth/getOauthProfile.ts) | 53 | 93 | 两条路对应两种凭据，头组合不能互换 |
| [`crypto.ts`](annotated/src/services/oauth/crypto.ts) | 23 | 86 | PKCE 三块拼图，base64URL 三次替换（删 `=` 最容易漏） |

---

### `services/tools/` —— 4 份（工具怎么被执行）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`toolExecution.ts`](annotated/src/services/tools/toolExecution.ts) | 1,745 | 1,905 | 九道关；`500ms`/`2000ms` 两个阈值同源于「felt stuck」；`classifyToolError` 对付压缩后的类名 |
| [`toolHooks.ts`](annotated/src/services/tools/toolHooks.ts) | 650 | 751 | #31301 重复显示 bug；**钩子 `allow` 不绕过 `settings.json` 的 deny**（inc-4788） |
| [`StreamingToolExecutor.ts`](annotated/src/services/tools/StreamingToolExecutor.ts) | 530 | 649 | 并发 = 多个交错 pass，`status='executing'` 当互斥量；`getAbortReason` 检查顺序即优先级 |
| [`toolOrchestration.ts`](annotated/src/services/tools/toolOrchestration.ts) | 188 | 284 | `\|\| 10` 兜 `parseInt` 的 NaN；并发批 `contextModifier` 排队后按 blocks 顺序回放 |

---

### `services/lsp/` —— 7 份（从配置到诊断的完整链路）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`LSPServerInstance.ts`](annotated/src/services/lsp/LSPServerInstance.ts) | 511 | 672 | `-32801 ContentModified` 是可重试错误；duck typing 判错误码（依赖树里有两个版本的 `vscode-jsonrpc`）；`require()` 只为推迟 129KB；僵尸状态 |
| [`LSPClient.ts`](annotated/src/services/lsp/LSPClient.ts) | 447 | 653 | **`spawn()` 返回 ≠ 启动成功**（ENOENT 是异步事件）；`isStopping` 一个布尔守四个入口；`stop` 里必须 `removeAllListeners` |
| [`LSPServerManager.ts`](annotated/src/services/lsp/LSPServerManager.ts) | 420 | 583 | 三张 Map 对应三种问题（生命周期 / 路由 / 协议同步）；声明不支持、server 照样发请求；`version: 1` 恒不变的已知不规范 |
| [`LSPDiagnosticRegistry.ts`](annotated/src/services/lsp/LSPDiagnosticRegistry.ts) | 386 | 521 | 跨轮去重靠 LRU(500)；「先标记已投递再删 pending」必须放在可能失败的去重**之后** |
| [`passiveFeedback.ts`](annotated/src/services/lsp/passiveFeedback.ts) | 328 | 465 | 缺失 severity 默认 `Error`（漏报比误报贵），而 registry 里默认 `Hint`（排序用）——同一个「未知」在两个语境选相反默认值 |
| [`manager.ts`](annotated/src/services/lsp/manager.ts) | 289 | 417 | 四态 + generation counter（过期 promise 不许改状态）；issue #15521：memoize + 早期调用 + 缺刷新路径 |
| [`config.ts`](annotated/src/services/lsp/config.ts) | 79 | 140 | 「LSP 只能通过插件配置」= **安全边界**（配置里有 `command`，等于任意进程执行） |

读这条线的顺序：`config.ts`（谁能配）→ `manager.ts`（什么时候起）→
`LSPServerManager.ts`（按扩展名路由 + 文件同步）→ `LSPServerInstance.ts`（状态机 + 重试）→
`LSPClient.ts`（子进程 + JSON-RPC）→ `passiveFeedback.ts`（诊断怎么回来）→
`LSPDiagnosticRegistry.ts`（诊断怎么等到下一轮）。

---

### `services/SessionMemory/` —— 3 份（后台子代理替你记笔记）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`sessionMemory.ts`](annotated/src/services/SessionMemory/sessionMemory.ts) | 495 | 747 | 两处 `_CACHED_MAY_BE_STALE`；用 uuid 而非下标定位起点；token 阈值是永远必需的节流阀；**读文件必须发生在隔离 context**；`canUseTool` 削到「只能改这一个文件」 |
| [`prompts.ts`](annotated/src/services/SessionMemory/prompts.ts) | 324 | 482 | 模板斜体行是给模型看的字段说明；「不许改斜体行」说三遍；单次 `replace` 防 `$` 反向引用；代码硬截断是「prompt 不可全信」的兜底 |
| [`sessionMemoryUtils.ts`](annotated/src/services/SessionMemory/sessionMemoryUtils.ts) | 207 | 319 | 15s 等待上限 / 60s 判僵死；阈值用**增量**而非绝对值（否则恒真） |

一句话串起来：`sessionMemoryUtils` 存状态和阈值 → `prompts` 决定「让模型改哪里、改多少」
→ `sessionMemory` 在合适的时机派一个 forked 子代理去改那一个文件。
它是 `compact/sessionMemoryCompact.ts` 的上游。

---

### `services/analytics/` —— 9 份（数据怎么离得开本机 + 远端开关怎么下发）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`growthbook.ts`](annotated/src/services/analytics/growthbook.ts) | 1,155 | 1,240 | **引擎**：`processRemoteEvalPayload` 的 `{}` 真值判据（漏检查会让所有开关集体黑屏）；`syncRemoteEvalToDisk` 只在成功路径调用（超时投毒结构上不可能）；`getGrowthBookClient` 用 `client!==thisClient` 守卫处理异步重 init；`checkGate_CACHED_OR_BLOCKING` 的 stale-while-false-blocking；整文件 `@deprecated` 记录从 Statsig 迁到 GrowthBook 的迁移史 |
| [`metadata.ts`](annotated/src/services/analytics/metadata.ts) | 973 | 1,045 | 所有遥测字段的单一事实来源；`to1PEventFormat` 用 proto 生成的 `EnvironmentMetadata` 类型让「漏字段」从运行时 bug 变编译错误（手写并行类型曾让 #11318/#13924/#19448 全没进 BQ）；`account_id` 故意省略只填 UUID；`kairosActive` 不进 memoized env |
| [`firstPartyEventLoggingExporter.ts`](annotated/src/services/analytics/firstPartyEventLoggingExporter.ts) | 806 | 880 | 跨进程重启的失败事件恢复（BATCH_UUID+sessionId 隔离）；二次方退避（base*attempts²）；第一批失败即 short-circuit；401 退化为无 auth 重试；`_PROTO_*` hoist 到 proto 字段后再防御性 strip |
| [`firstPartyEventLogger.ts`](annotated/src/services/analytics/firstPartyEventLogger.ts) | 449 | 512 | OTel logs SDK；自建独立 LoggerProvider 不与客户遥测混；`reinitialize` 三步走（null→forceFlush→swap）的事件丢失安全；`getEnvironmentForGrowthBook` 永远 production |
| [`datadog.ts`](annotated/src/services/analytics/datadog.ts) | 307 | 364 | pub 公开 token 写死在客户端（只写不读）；44 事件白名单 + 二次基数归一（mcp→mcp / 罕见模型→other）；`status`→`http_status`/`http_status_range` 避开 DD 保留字段；`getUserBucket` 用 sha256 mod 30 代替真实 user id 计数 |
| [`index.ts`](annotated/src/services/analytics/index.ts) | 173 | 210 | 零依赖防循环；`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 用命名做 lint；`eventQueue` + `queueMicrotask` 先消费后连接，不阻塞启动 |
| [`sink.ts`](annotated/src/services/analytics/sink.ts) | 114 | 146 | `shouldTrackDatadog` 三层回退（killswitch→模块态→跨 session 磁盘缓存）；`stripProtoFields` 只在非 1P 后端前调一次守 PII 边界 |
| [`config.ts`](annotated/src/services/analytics/config.ts) | 38 | 59 | `isAnalyticsDisabled` 五条件一刀切；`isFeedbackSurveyDisabled` 故意不挡 3P 云（本地 UI 弹窗无 transcript） |
| [`sinkKillswitch.ts`](annotated/src/services/analytics/sinkKillswitch.ts) | 25 | 42 | `tengu_frond_boric` 熔断；fail-open；绝不能从 `is1PEventLoggingEnabled` 内调用（会递归爆栈） |

读这条线的顺序：`index.ts`（公共入口、零依赖）→ `config.ts` / `sinkKillswitch.ts`（总开关与熔断）→ `sink.ts`（路由中枢）→ `datadog.ts` + `firstPartyEventLogger.ts` / `firstPartyEventLoggingExporter.ts`（两个后端）→ `metadata.ts`（字段单一事实来源）→ `growthbook.ts`（远端开关引擎）。

一句话串起来：`index.ts` 暴露 `logEvent`，`sink.ts` 决定去哪几个后端，`datadog.ts` / `firstPartyEventLogger.ts` 负责把事件**可靠地**发走，`metadata.ts` 决定**发什么字段**（含 PII 脱敏），`growthbook.ts` 决定**开关和动态配置从哪来**。
它是 `api/logging.ts` 那套 `_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 命名约束的延伸—— 同一件事的两端。

---

### `services/teamMemorySync/` —— 5 份（多设备 / 多成员之间怎么同步记忆和设置）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`index.ts`](annotated/src/services/teamMemorySync/index.ts) | 1,256 | 1,386 | 本地文件 ↔ 服务器 API 双向同步；三个 HTTP 接口（拉全量 / 拉校验和探针 / 推 upsert）；delta 按字节贪心装箱；乐观锁 + 412 冲突重试（local-wins） |
| [`watcher.ts`](annotated/src/services/teamMemorySync/watcher.ts) | 387 | 440 | 后台 `fs.watch` 守护（不依赖 chokidar，避免 kqueue fd 泄漏）；2 秒防抖；永久失败护栏 `pushSuppressedReason` 防无限重试 |
| [`secretScanner.ts`](annotated/src/services/teamMemorySync/secretScanner.ts) | 324 | 359 | gitleaks 高置信度规则子集；`scanForSecrets` 整文件跳过、`redactSecrets` 命中替 `[REDACTED]`；匹配文本绝不返回 |
| [`types.ts`](annotated/src/services/teamMemorySync/types.ts) | 156 | 188 | Zod v4 数据契约（`TeamMemoryDataSchema` / 各步结果类型）；`z.infer` 派生类型 |
| [`teamMemSecretGuard.ts`](annotated/src/services/teamMemorySync/teamMemSecretGuard.ts) | 44 | 57 | 写入前第一道闸门 `checkTeamMemSecrets`；惰性 `require` 只在 `TEAMMEM` feature 开启时加载依赖 |

读这条线的顺序：`types.ts`（数据契约长什么样）→ `index.ts`（同步主流程：拉 / 算 delta / 推 / 冲突重试）→ `watcher.ts`（后台怎么感知文件变化并触发同步）→ `secretScanner.ts` + `teamMemSecretGuard.ts`（上传前怎么把密钥挡在门外）。

一句话串起来：`index.ts` 负责「跟服务器对账、只传变了的那部分」，乐观锁保证并发编辑不互相覆盖；`watcher.ts` 把本地改动实时推进同步队列；`secretScanner.ts` 决定「哪些内容因为像密钥而根本不许同步」。它的隔离粒度是 **git remote 哈希**—— 同一 org 的成员按 remote 共享团队记忆，不同仓库互不串。

---

### `services/PromptSuggestion/` —— 2 份（空闲时弹出的「下一句建议」从哪来）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`promptSuggestion.ts`](annotated/src/services/PromptSuggestion/promptSuggestion.ts) | 523 | 536 | 「猜用户会敲什么」的提示词与多级开关；fork 子代理生成建议、缓存冷抑制、十几种输出过滤器剔除不像人话的结果 |
| [`speculation.ts`](annotated/src/services/PromptSuggestion/speculation.ts) | 991 | 1,012 | 进阶版：不仅猜，还 fork 子代理在 overlay 文件系统上**真预跑**；写时复制 + 工具白名单 + 边界中止；用户接受即注入对话、记「省了多少时间」 |

读这条线的顺序：`promptSuggestion.ts`（建议怎么生成、什么时候不该生成）→ `speculation.ts`（建议被接受前的「后台预执行」）。

一句话串起来：`promptSuggestion.ts` 决定「该不该、猜什么」，靠 fork 一个**禁用所有工具**的子代理读最近对话预测用户下一句（2-12 词）；`speculation.ts` 是它更激进的延伸——用同一条建议 fork 一个**只放行只读工具、写工具重定向到临时 overlay** 的子代理，把用户「接下来大概率要做的事」提前跑完，等你确认时工作已经在手。两者都严格蹭主线程的 prompt 缓存（改一个 API 参数都会让命中率从 92% 崩到 61%）。

---

### `services/plugins/` —— 3 份（用户装的扩展怎么被下载、校验、加载、卸载）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`pluginOperations.ts`](annotated/src/services/plugins/pluginOperations.ts) | 1,088 | 1,114 | 核心：install/uninstall/enable/disable/update 的纯库函数。settings-first 架构、四层 scope、delisted 兜底、卸载四层清理、非原地更新 |
| [`pluginCliCommands.ts`](annotated/src/services/plugins/pluginCliCommands.ts) | 344 | 350 | CLI 薄包装：console + process.exit + 遥测。统一错误出口先发 `tengu_plugin_command_failed` 再退，dashboard 才算得出成功率 |
| [`PluginInstallationManager.ts`](annotated/src/services/plugins/PluginInstallationManager.ts) | 184 | 191 | 启动期后台安装：从受信来源 reconcile 市场，把 onProgress 映射进 AppState；新装→自动刷新插件，仅更新→提示 `/reload-plugins` |

读这条线的顺序：`pluginOperations.ts`（业务全在这）→ `pluginCliCommands.ts`（CLI 怎么包它）→ `PluginInstallationManager.ts`（启动时谁在背后自动装）。

一句话串起来：整个子系统建立在「**settings 声明意图、installed_plugins_v2.json 记录安装**」的分离上。`pluginOperations.ts` 只做纯函数（不 console、不 exit、返回结果对象），所以 CLI 和交互 UI（ManagePlugins.tsx）能共用同一套逻辑；scope 分 user/project/local（local > project > user，最具体者胜）外加只能由企业下发的 managed；插件被市场下架后回退 V2 记录兜底；卸载要同时收口 settings key、V2 记录、孤儿缓存、options/secrets 四层，且**反向依赖只警告不阻断**——阻断会造出拆不动的「墓碑」，真正的兜底在加载期 verifyAndDemote。

---

### `services/mockRateLimits.ts` —— 根目录散件（限流「挡板」，19 种场景的本地摹本）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`mockRateLimits.ts`](annotated/src/services/mockRateLimits.ts) | 882 | 979 | `anthropic-ratelimit-unified-*` 全套响应头的 mock：代表 claim 取 reset 最远者、overage 月度重置、org/member/seat-tier 四种零额度、fast mode 20 秒冷却阈值、headerless 429 |

读法：先看文件头的 19 个 `MockScenario`（按族分：普通 / 会话窗 / 周窗 / overage / org 额度 / 分模型 / fast mode / headerless），再挑 `setMockRateLimitScenario` 里三两个 case 看头是怎么摆的，最后看 `applyMockHeaders`（整个文件对生产的唯一出口）和 `getCurrentMockScenario`（从当前头反推场景的反向查找）。

一句话串起来：这是 `[ANT-ONLY]` 模块——所有导出函数第一句都是 `if (process.env.USER_TYPE !== 'ant') return`，普通用户零影响；它让内部员工在本地复现「5 小时窗超了」「周窗超了」「超额可用」「组织额度被设 0」等各种限流态，而不必真把配额用光。两条设计特别值得学：**representative claim 取超限列表里 reset 最远的那条**（同时命中 5h 和周窗时，用户实际被挡到的是周窗重置时刻）；**fast mode 冷却的 expiry 在第一次真报错时才设**（duration 从客户端撞墙开始算，不是从测试员敲下命令开始算）。

---

### `services/claudeAiLimits.ts` —— 根目录散件（真实限流状态的消费端，与 `mockRateLimits.ts` 是一对）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`claudeAiLimits.ts`](annotated/src/services/claudeAiLimits.ts) | 515 | 535 | 把 `anthropic-ratelimit-unified-*` 响应头翻译成状态对象：三态配额、12 种超额被禁原因、两级早期预警、跨 session 缓存被禁原因 |

读法：先看文件头的 `EARLY_WARNING_CONFIGS`（两条窗的档位密度为什么完全不同）和 `OverageDisabledReason` 12 种原因，再走主链路 `computeNewLimitsFromHeaders`（头 → 状态对象的翻译核心），最后看两个入口 `extractQuotaStatusFromHeaders`（每个响应的常驻入口）和 `checkQuotaStatus`（启动时的主动探测）。

一句话串起来：`mockRateLimits.ts` 负责**造假**数据，这个文件负责**读真**数据——两者在 `processRateLimitHeaders` 那一个点接缝（`/mock-limits` 激活时假头套进去）。它把 `anthropic-ratelimit-unified-*` 系列响应头翻译成 `ClaudeAILimits` 三态（allowed/allowed_warning/rejected）广播给 statusline 和 UI。几个设计点：**early warning 两级回退**——先信服务端的 `surpassed-threshold` 头（权威），没有才客户端按「利用率高且时间进度低」自己算（老服务端也有预警）；**5 小时窗只有一档预警、7 天窗有三档**——短窗接近用完是既成事实，长窗要在各进度段反复提醒；**rawUtilization 与 currentLimits.utilization 分离**——前者每个响应都更新、经 `getRawUtilization()` 给 statusline 脚本，后者只在阈值触发时设给 UI；**非交互模式（-p）跳过探测请求**——真 query 紧随其后，claude.ts 会从真实响应头更新，省一次往返；**429 错误路径强制 status=rejected**——头缺失也不能当 allowed；**不该处理时主动清空状态**——用户从订阅降级后不能还挂着旧限流。

---

### `services/remoteManagedSettings/` —— 5 份（企业管理员下发的设置怎么到达用户）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`index.ts`](annotated/src/services/remoteManagedSettings/index.ts) | 638 | 720 | 主编排：eligibility、checksum ETag 缓存（对齐服务端 Python 序列化）、fail-open 降级链、应用前安全检、后台轮询、cache-first 启动解阻塞 |
| [`syncCache.ts`](annotated/src/services/remoteManagedSettings/syncCache.ts) | 112 | 140 | 资格判定（3p / 自定义 base URL / local-agent 三挡早退 + OAuth 先查的性能考量）+ 本地 mirror |
| [`syncCacheState.ts`](annotated/src/services/remoteManagedSettings/syncCacheState.ts) | 96 | 126 | 叶子状态：三态 eligible、sync 读盘、首次命中时冲合并缓存（gh-23085 补丁） |
| [`securityCheck.tsx`](annotated/src/services/remoteManagedSettings/securityCheck.tsx) | 74 | 96 | 应用前最后一道人工闸门：危险设置变更才弹阻塞对话框，拒绝即优雅退出 |
| [`types.ts`](annotated/src/services/remoteManagedSettings/types.ts) | 31 | 41 | 响应信封 + FetchResult 契约：`settings: null` 表示 304，`skipRetry` 表示 auth 类不重试 |

读这条线的顺序：`syncCache.ts`（谁能用）→ `syncCacheState.ts`（状态放哪、为什么拆成叶子）→ `index.ts`（拉取/校验/降级/轮询全流程）→ `securityCheck.tsx`（应用前的闸门）→ `types.ts`（跨文件契约）。

一句话串起来：企业管理员在控制台改的设置，经 `/api/claude_code/settings` 下发到 CLI——**资格判定**决定要不要打这个端点（Console 全 eligible；OAuth 只有 enterprise/team；3p、自定义 base URL、Cowork VM 三挡早退），**checksum + If-None-Match** 把没变的设置压成一次 304，**fail-open** 保证拉取失败时用 stale 缓存甚至当没有设置也不阻塞启动，**安全检**保证危险变更必须用户点头才生效。整个目录最有意思的是**为断环而拆的三层**：`settings.ts → syncCache.ts → auth.ts → settings.ts` 这个环会把几百个模块拖进启动期求值的 SCC，于是状态被拆进只 import 叶子的 `syncCacheState.ts`，`syncCache.ts` 只留唯一需要 auth 的资格判定函数。

---

### `services/extractMemories/` —— 2 份（「值得长期记住的东西」怎么从对话里捞出来）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`extractMemories.ts`](annotated/src/services/extractMemories/extractMemories.ts) | 615 | 641 | 后台记忆抽取器：每轮 query loop 尾部 fork 子代理（共享 prompt 缓存）抽记忆；互斥跳过、节流、合并补跑、print 模式 drain |
| [`prompts.ts`](annotated/src/services/extractMemories/prompts.ts) | 154 | 160 | 两套抽取提示词（auto-only / combined）：工具白名单文案、轮次预算策略、MEMORY.md 两步保存、禁验证兔子洞 |

读这条线的顺序：`extractMemories.ts` 先看文件头和 `initExtractMemories()`（时机 + 闭包状态六件套）→ `runExtraction`（互斥/节流/fork/光标/trailing）→ 公共出口（gate 链 + drainer）；`prompts.ts` 对着 `runExtraction` 里组 prompt 的那几行看——白名单文案和 `canUseTool` 实际放行一一对应。

一句话串起来：每轮对话结束（模型给出最终回复且无工具调用）时，它 fork 一个**共享父进程 prompt 缓存**的子代理，读最近 N 条消息，把值得长期记住的东西写进 `~/.claude/projects/<path>/memory/`。几个设计点值得学：**主 agent 自己写过记忆就整轮跳过**（系统提示里本来就有保存指令，双写浪费，靠 `hasMemoryWritesSince` 检测光标之后的 Write/Edit）；**光标只在成功后推进**（失败重试，不丢消息）；**预注入现有记忆清单省掉第一轮 ls**，且故意放在节流门之后让跳过的轮次不付扫描成本；**REPL 一律放行**是因为 REPL 的 VM 上下文会对每个内部 primitive 重新走一遍 `canUseTool`，而改工具列表会破坏缓存键；`maxTurns: 5` 硬顶配 prompt 里的「先并行读再并行写、禁验证」策略，把一次抽取压进 2-4 轮；**`skipTranscript: true`** 避免子代理和主线程抢记录。与刚做完的 `teamMemorySync/` 是上下游：这个负责「产出」记忆，那个负责「同步」记忆。

---

### `services/tips/` —— 3 份（启动时轮播的「你可以试试……」从哪来）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`tipRegistry.ts`](annotated/src/services/tips/tipRegistry.ts) | 686 | 706 | 43 条内置 tip + 2 条 ANT-ONLY 内部 tip + 用户自定义覆盖。每条 = id + 异步文案 + 冷却启动数 + 异步相关性判定，按 14 个主题分组批注 |
| [`tipScheduler.ts`](annotated/src/services/tips/tipScheduler.ts) | 58 | 61 | 调度：总开关 → 取相关列表 → 挑「最久没出现过的那条」；显示后落账 + 发遥测（只发 tipIdLength 不发 id） |
| [`tipHistory.ts`](annotated/src/services/tips/tipHistory.ts) | 17 | 19 | 冷却账本：以 numStartups（第几次启动）为单位记录；从没显示过返回 Infinity 保证新 tip 优先 |

读这条线的顺序：`tipHistory.ts`（17 行，五分钟看完冷却账本的单位约定）→ `tipScheduler.ts`（58 行，调度策略）→ `tipRegistry.ts`（686 行，按批注里的 14 个分组挑感兴趣的看）。

一句话串起来：spinner 转起来时显示的提示语，来自「**相关 + 冷却**双条件筛选后的最久未出现者」。三个设计点值得学：**冷却单位是启动次数不是天数**（一天启动 20 次和 20 天启动一次的疲劳度完全不同，`lastPlanModeUse` 那种毫秒时间戳是另一套单位，两套并存）；**`getSessionsSinceLastShown` 从没显示过返回 Infinity 而不是 0**——配合调度器的降序排序，新 tip 一定最先轮到（改成 0 不会报任何错，只会让新功能永远不上墙，这是全子系统最易错的单点）；**遥测只发 tipIdLength 不发 tipId**——自定义 tip 的 id 来自用户设置，只发长度够做聚合统计又不碰 PII。另外三条 `effort-high-nudge` / `subagent-fanout-nudge` / `loop-command-nudge` 是 GrowthBook A/B 的标准样板：两道硬闸（1P 客户 + 功能可用性）之后取 `off/copy_a/copy_b` 三档，copy_b 是另一版文案。

---

### `services/policyLimits/` —— 2 份（组织级策略限额：哪些功能被管理员关掉）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`index.ts`](annotated/src/services/policyLimits/index.ts) | 663 | 687 | 主编排：资格三挡早退、双认证取头、checksum ETag、重试与分类、fail-open 主链、唯一 fail-closed 例外、session+磁盘双层缓存、后台轮询 |
| [`types.ts`](annotated/src/services/policyLimits/types.ts) | 27 | 30 | Zod v4 契约：只记录被禁策略（键缺失 = 允许）+ `restrictions: null` 表示 304 的魔法值信封 |

读这条线的顺序：`types.ts`（27 行，先建立「只记被禁」和「null=304」两个契约）→ `index.ts` 的 `isPolicyAllowed`（对外主问句，先看答案再倒推）→ `isPolicyLimitsEligible`（谁能用）→ `fetchAndLoadPolicyLimits`（拉取编排）→ 其余按需。

一句话串起来：这是 `remoteManagedSettings/` 的**姊妹模块**（文件头自己就说「follows the same patterns」：fail open、ETag 缓存、后台轮询、重试），但回答的是不同问题——那个是「管理员推什么设置下来」，这个是「管理员关了哪些功能」。资格判定同样三挡早退（3p / 自定义 base URL / OAuth 非 enterprise-team），checksum 同样要和服务端 Python 序列化逐字节对齐，404 同样意味着「确认没有」并要删磁盘缓存防 stale。两处设计比姊妹模块更硬：**`isPolicyLimitsEligible` 明令不许调 getSettings()**（启动早期的循环依赖，那边靠拆三层解决，这边靠自律）；**fail-open 总纲下有唯一例外**——essential-traffic-only 模式（HIPAA 合规档）下，`allow_product_feedback` 在缓存未命中时必须拒，否则一次网络超时就会静默重新开放本该关闭的数据上报。另一个值得学的细节：**取 API key 时跳过用户配置的 key helper 脚本**（`skipRetrievingKeyFromApiKeyHelper: true`）——资格判定在启动路径上，不能等一个可能很慢甚至有副作用的用户脚本。

---

### `services/settingsSync/` —— 2 份（设置跨端同步：CLI 推上去，CCR 拉下来）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`index.ts`](annotated/src/services/settingsSync/index.ts) | 581 | 601 | 上传差量化、下载 promise 单例、`/reload-plugins` 强制刷新、404=空、retry 分诊、白名单落盘、缓存失效 |
| [`types.ts`](annotated/src/services/settingsSync/types.ts) | 67 | 73 | Zod 契约：扁平 key-value 内容、version+checksum、`isEmpty` 单列、`SYNC_KEYS` 四键 |

读这条线的顺序：`types.ts`（67 行，先建立「扁平 key-value」和「四个同步键」两个契约）→ `index.ts` 的 `uploadUserSettingsInBackground`（上传主链：先 GET 远端再差量）→ `downloadUserSettings` / `redownloadUserSettings`（下载的两个入口，区别在重试与缓存）→ `applyRemoteEntriesToLocal`（落盘的三层设计）。

一句话串起来：这是 `teamMemorySync/` 的**同一个问题的不同数据**——那个同步团队记忆，这个同步用户设置与记忆文件，且分工更干脆：**交互式 CLI 只上传，CCR（容器/远程模式）只下载**，上传时机是启动后台、下载时机卡在装插件之前。最值得学的四处：① **差量上传**——先 GET 远端全量，本地四项文件构建 entries，`pickBy` 按 key 比对后只 PUT 变化的条目，服务端用 version+checksum 判新旧，本地时钟不准也不影响；② **下载 promise 单例**——`runHeadless` 的 fire-and-forget 和 `installPluginsAndApplyMcpInBackground` 的 await 共用同一次 fetch，后到的调用方自动 join；③ **`markInternalWrite` 抑制变更检测**——自己同步下来的文件写盘前先打标记，否则会被当成「用户改了设置」触发 reload 循环；`redownloadUserSettings` 的注释还解释了为什么 `notifyChange` 的责任故意留在调用方（避开 settingsSync → changeDetector 循环边）；④ **404 的语义**——这里是「远端还没有数据」（`isEmpty: true`），和 `remoteManagedSettings/syncCache` 里「`settings:null` + ETag = 有效的 304 未变」是两种完全不同的空值。认证判定也有一个 CCR 专属细节：**只查 `user:inference` scope 不查 `user:profile`**——CCR 的文件描述符 token 把 scope 硬编码成前者，要求 profile 会让下载直接变 no-op。

---

### `services/voice*.ts` —— 3 份（语音输入全链路：录音 → 流式转写 → 关键词提示）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`voice.ts`](annotated/src/services/voice.ts) | 525 | 546 | 原生 cpal 优先、Linux 三级兜底（arecord 探测 / SoX）、WSL 特殊判定、按住说话忽略静音结束 |
| [`voiceStreamSTT.ts`](annotated/src/services/voiceStreamSTT.ts) | 544 | 573 | voice_stream WebSocket 协议、finalize 五条出口、Nova 3 差异、CF zone 选择、升级拒绝处理 |
| [`voiceKeyterms.ts`](annotated/src/services/voiceKeyterms.ts) | 106 | 114 | Deepgram 关键词提升：14 个全局编程词 + 项目名 + 分支词 + 最近文件名，上限 50 |

读这条线的顺序：`voiceKeyterms.ts`（106 行，最独立，先看「词从哪来」）→ `voice.ts`（录音后端选择与探测）→ `voiceStreamSTT.ts`（协议与收尾竞态，最难）。

一句话串起来：**按住说话（hold-to-talk）的三段管线**。`voice.ts` 负责「拿到 16 kHz 单声道 PCM」——原生 cpal 模块优先（全平台），Linux 上若没声卡则退 arecord / SoX；这里最值得学的是**探测而非假设**：`hasCommand` 只证明二进制在 PATH 里，`probeArecord` 用同样的参数真开一次麦并竞速 150ms 定时器，因为 WSL1 / 无头 Linux 上「命令存在但 open() 必失败」是常态；WSLg 与 WSL1 的文案还分了两套。`voiceStreamSTT.ts` 负责「把 PCM 推给服务端、把文本收回来」——最精彩的是**收尾**：`finalize()` 有五条出口（endpoint 约 300ms / 无数据 1.5s / WS close 3–5s / 安全计时 5s / 早就关了），全部汇聚到 `resolveFinalize` 一个函数里，因为老版 Deepgram 会把文本块和结束标记拆成两条独立消息发，「有 interim 没 endpoint」必须兜底提升为最终结果；而 CloseStream 要 `setTimeout(0)` 推迟一拍，否则原生模块队列里最后一段音频会晚于「停止收音频」到达。还有两处平台坑写进了注释：WS 基址故意打 api.anthropic.com 而不是 claude.ai（后者 CF zone 会 challenge 非浏览器 TLS 指纹），以及 Bun 的 ws 在 Windows 上会对成功的 101 也触发 `unexpected-response`（必须先判 101 再销毁请求）。`voiceKeyterms.ts` 是配菜但很实用：把项目名当**整词**加入（用户念的是短语不是单词）、分支按标识符拆词、最近文件只扫到填满 50 个槽位为止——顺序即优先级。

---

### `services/vcr.ts` + `services/diagnosticTracking.ts` —— 2 份（测试录制回放 / IDE 诊断差分）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`vcr.ts`](annotated/src/services/vcr.ts) | 406 | 419 | VCR 录制回放：四入口、输入哈希定文件名、脱敏四组替换、uuid 必须每次重生成 |
| [`diagnosticTracking.ts`](annotated/src/services/diagnosticTracking.ts) | 397 | 415 | IDE 诊断：编辑前抓基线、磁盘版 vs 编辑器版取舍、差分语义、4000 字符预算 |

这两份互不相关，凑成一批纯粹是按「剩余根目录散件」的体量打包。各自的一句话：

**`vcr.ts`**：测试基础设施——把真实 API 响应录成 fixture，之后回放不打网络。最值得学的是**让 fixture 跨机器稳定**这件事：`dehydrateValue` 把 cwd / config home / 数值统计（`num_files`、`duration_ms`、`cost_usd`）全换成占位符，Windows 上还要覆盖三种路径形态（正斜杠 / 原生反斜杠 / JSON 转义的双反斜杠），最后把占位符后的分隔符统一成正斜杠——**hash 一致是跨平台 fixture 能命中的唯一前提**。两个反直觉细节：① `mapAssistantMessage` 里回放路径必须重新生成 `randomUUID()`，因为 `sessionStorage.ts` 按 uuid 去重，同一 uuid 会让恢复的会话把不同响应当重复丢掉；② 回放命中后还要 `addCachedCostToTotalSessionCost`——不补记成本，任何成本断言在回放下都必挂。CI 里缺 fixture 且没开 `VCR_RECORD` 是**直接抛错**，不允许在 CI 里偷偷录。

**`diagnosticTracking.ts`**：把 IDE 的诊断变成「本轮编辑引入了哪些新错误」。设计核心是**基线 + 差分**：`beforeFileEdited` 在编辑前存快照（**没有诊断也要存空数组**，否则第一次查询会把存量错误全算成新增），`getNewDiagnostics` 算完差集后立刻把基线推进到当前状态，所以同一条错误只报一次。最绕的一段是「磁盘版 vs 编辑器版」——IDE 对同一文件给两份诊断（`file://` 是磁盘内容，`_claude_fs_right:` 是编辑器里未保存的内容），只有「右栏诊断刚变化」时才切换用它，避免未保存内容的抖动导致重复上报。摘要上限 4000 字符，截断长度把 `…[truncated]` 标记本身算进去——预算要守，标记也算钱。

---

### `services/autoDream/` 全 4 份（550 行 → 583 行，33 处批注）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`autoDream.ts`](annotated/src/services/autoDream/autoDream.ts) | 324 | 344 | 三道门（时间 / 会话 / 锁）+ fork 子代理 + 进度观察器 |
| [`consolidationLock.ts`](annotated/src/services/autoDream/consolidationLock.ts) | 140 | 148 | 锁文件 mtime 兼任「上次整理时间」；PID 咨询锁、陈腐接管、回滚 |
| [`consolidationPrompt.ts`](annotated/src/services/autoDream/consolidationPrompt.ts) | 65 | 68 | 四阶段 prompt（Orient → Gather → Consolidate → Prune） |
| [`config.ts`](annotated/src/services/autoDream/config.ts) | 21 | 23 | 叶子配置模块，单独存在只为打断依赖链 |

一句话串起来：这是 `extractMemories/` 的**搭档**——那个在对话末尾当场把该记的**抽**出来，这个隔一段时间把散落的记忆**整理**一遍（合并、改错、剪枝、重写索引）。触发是个三道门的漏斗，**按开销从小到大排**：① 时间门，一次 `stat` 读锁文件 mtime，够了才往下；② 会话门，扫一次 transcript 目录数「上次整理之后被碰过的会话」够不够 5 个；③ 锁门，抢文件锁确认没有别的进程正在整理。三门全过才 `runForkedAgent`。

最值得学的四处：

1. **一个文件承担两个角色**——锁文件的 mtime 就是「上次整理时间」，内容是持有者 PID。省掉一份状态文件，代价是**回滚必须精确改回 mtime**（`utimes` 收秒、要先清空 PID 内容、`priorMtime === 0` 要删文件而不是写 1970）。这把锁是**咨询式**的：写入后必须回读验证 PID 没被覆盖，正确性靠回读而不是靠 OS 互斥。
2. **节流阀补的是「门之间的缝」**——会话门不通过时 mtime 不推进，于是时间门下一轮照样放行，每轮都白扫一遍目录。所以除了三道门还有一个纯内存的 10 分钟扫描节流，且**只有真正往下走才更新**它。
3. **权限直接复用 `createAutoMemCanUseTool(memoryRoot)`**——写操作只允许落在记忆目录内；同时 `skipTranscript: true`，否则下次「回顾 N 个会话」会把整理过程本身数成用户会话。工具约束（Bash 只读）写在 `extra` 而不是共享 prompt 正文里，因为手动 `/dream` 是在主循环里跑的、权限正常，写进正文会误导模型。
4. **失败路径要比成功路径更小心**——用户从后台面板 kill 时必须**单独早退**：`DreamTask.kill` 已经 abort + 回滚锁 + 置 `killed`，再走一遍 `failDreamTask` + 回滚会把 mtime 二次回滚并把状态覆盖成 `failed`。真失败才回滚，退避靠那个 10 分钟节流（而不是写一个重试计数器）。

`consolidationPrompt.ts` 还有一条独立的设计理由：它从 `dream.ts` 里抽出来，是因为那个文件被 `feature()` 门控的 `require` 包着（KAIROS 线），而自动整理要能**独立发布**——所以只抽出「prompt 怎么拼」这块无依赖逻辑。`config.ts` 同理，是个「叶子模块」：UI 只想问一句「开没开」，不能顺着 `autoDream.ts` 把 forked agent、task registry 全拖进 bundle。

---

### `services/rateLimitMessages.ts` + `services/rateLimitMocking.ts` —— 2 份（限流四件套的最后两块）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`rateLimitMessages.ts`](annotated/src/services/rateLimitMessages.ts) | 344 | 361 | 所有限流文案的唯一产地：错误 / 警告 / overage 通知三档 |
| [`rateLimitMocking.ts`](annotated/src/services/rateLimitMocking.ts) | 144 | 155 | 门面：把 `/mock-limits` 的 mock 逻辑挡在生产代码之外 |

这两份补齐了「限流四件套」——`mockRateLimits.ts`（造数据）+ `rateLimitMocking.ts`（把假数据接进请求路径）+ `claudeAiLimits.ts`（解真实响应头）+ `rateLimitMessages.ts`（把状态翻译成人话）。前两份是 `[ANT-ONLY]`，后两份是生产代码。

**`rateLimitMessages.ts`** 的核心是「**一处判定、两处消费**」：`getRateLimitMessage` 返回 `{ message, severity }`，然后 `getRateLimitErrorMessage` 只透出 `error`、`getRateLimitWarning` 只透出 `warning`。拆成两个导出不是为了少写几行，而是因为**展示位置不同**——错误进对话流（`AssistantTextMessages`），警告进 footer。让每个调用方自己筛 severity，迟早有人把警告塞进错误通道。

判定顺序里有一处必须记住：**先判 overage，再判 rejected**。订阅额度打满但宽松额度可用时，`status` 依然是 `rejected`；不先看 `isUsingOverage`，就会对着一个还能继续用的人喊「你已达上限」。另外 warning 分支还要过两道闸：利用率 ≥ 70%（防周重置后 API 带着陈旧数据发假警报）、以及 Team/Enterprise 开了 overage 但不走计费的用户干脆不警告（他们会无缝滚进 overage，警告是噪音）。

文案本身有三条值得学的产品细节：① 两种额度都打满时，重置时间取**更早的那个**（用户最早能恢复的时刻），else 链在穷举「哪个时间戳有值」的三种组合；② `seven_day_sonnet` 对 pro/enterprise 用户直接叫 weekly limit——同一个限额类型在不同订阅下名字不同；③ 拼句**四级降级**（有百分比有时间 → 只有百分比 → 都没有就 `Approaching <限额名>`），信息缺哪块就少说哪块，绝不编造；`rateLimitType` 为 `undefined` 时直接 `return null`，宁可沉默也不输出 `Approaching undefined`。

**`rateLimitMocking.ts`** 是个纯粹的**门面**：19 种 mock 场景的实现全在 `mockRateLimits.ts`，生产代码只 import 这一个文件——删掉 mock 模块时，生产侧要改的只有一处 import。三个函数各有讲究：`processRateLimitHeaders` 非 mock 时**原样返回同一个对象**（不拷贝，因为每个响应都走）；`checkMockRateLimitError` 返回 `APIError | null`，`null` 的语义是「这个请求**不该**被拦」而不是出错；`isMockRateLimitError` 专供重试逻辑，让 mock 造的 429 **不被自动重试吃掉**（否则用户点完 `/mock-limits` 要等几轮才看到效果）。

里面最有意思的一条是 Opus 特例：**Opus 限额只在真的用 Opus 模型时才抛 429**（判断用 `includes('opus')`，因为模型名有别名和日期快照）。这是在复刻真实 API 的**局部限额**语义——Opus 打满时回落到 Sonnet 依然能跑通。mock 的价值在于**如实复现**，不在于让错误更容易触发。同理 `shouldThrow429` 必须带第二个条件「没有 overage 头 **或** overage 也 rejected」——只判 `status === 'rejected'` 会在「订阅打满但宽松额度可用」时抛 429，与线上行为完全相反。

---

### `services/MagicDocs/` 全 2 份（381 行 → 400 行，19 处批注）

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`magicDocs.ts`](annotated/src/services/MagicDocs/magicDocs.ts) | 254 | 268 | 标记检测、读取即登记、空闲时 fork 子代理原地重写 |
| [`prompts.ts`](annotated/src/services/MagicDocs/prompts.ts) | 127 | 132 | 更新 prompt 模板、自定义 prompt 覆盖、单遍变量替换 |

「后台 fork 子代理」的**第三种用法**集齐了：`extractMemories` 抽记忆、`autoDream` 整理记忆、`MagicDocs` **维护文档**。三者都挂在 `postSamplingHooks` 上，但触发条件各不相同——这个要求「上轮没有工具调用」（对话真的空闲了），因为把半成品状态写进文档等于留一份错误说明。

它的产品设计是「**零配置**」：用户不需要声明哪些是文档，只要文件头写了 `# MAGIC DOC: 标题`，**读一次就自动登记**（`registerFileReadListener` 监听所有文件读取）。想停止维护也不用找配置——把那行标题删掉即可，因为每次更新前都会重新解析头部，解析不出来就取消登记。

技术上最精巧的一处是**强制拿到真实文件内容**：`FileReadTool` 有去重机制，同一文件在缓存里没变时只返回一个 `file_unchanged` 桩、不给内容。而这里必须拿全文（要重新解析头部），所以做法是**克隆一份文件状态缓存**（不污染主线程）、把本文档的条目删掉、再用克隆的 context 去读。这个「克隆缓存再删条目」的手法在别处见不到。

另外三处值得记：

- **逐文件沙箱**：`canUseTool` 只允许 Edit、且 `input.file_path` 必须严格等于这一份文档的路径——比 `autoDream` 的「整个记忆目录可写」更窄，连同目录的别的文件都不许碰。
- **两个 hook 前置**：`querySource !== 'repl_main_thread'` 直接 return（只在主线程跑，否则 fork 出的子代理会无限自我递归）；`hasToolCallsInLastAssistantTurn` 为真也 return（只在空闲时更新）。
- **`sequential()` + 逐个 `await`**：外层防 hook 并发重入，内层让多份文档串行更新。两重保险防的是同一件事——互相引用的文档并行编辑时会各自看到对方的旧版本。

`prompts.ts` 里 `substituteVariables` 那 10 行注释值得单独读：用字符串形式 `replace` 会踩两个真实存在的坑（用户文档内容里的 `$&`/`$1` 被当成反向引用解释；内容里恰好含 `{{docTitle}}` 会被二次展开），所以必须用**单遍 + 函数式 replacer**；再加 `hasOwnProperty` 挡掉 `{{toString}}` 这类原型链键。默认 prompt 也有三条硬约束：声明「这条消息不属于用户对话」（否则子代理会在文档里写一段「我更新了文档」的元叙述）、头部原样保留、**in-place 更新不是 changelog**（禁止 `Previously...`，过期内容要删要改而不是加注）。

---

### 收尾批：最后 8 份 / 840 行，`services/` 到此清零

最后一批分三块，共同点是「**和主链路耦合最弱**」（都是辅助能力，不参与一次对话的骨架）：

| 文件 | 原文 → 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- |
| [`AgentSummary/agentSummary.ts`](annotated/src/services/AgentSummary/agentSummary.ts) | 179 → 192 | 13 | 子代理的一行进度条，30 秒 fork 一次 |
| [`toolUseSummary/toolUseSummaryGenerator.ts`](annotated/src/services/toolUseSummary/toolUseSummaryGenerator.ts) | 112 → 119 | 7 | 一批工具调用的 Haiku 短标签 |
| [`preventSleep.ts`](annotated/src/services/preventSleep.ts) | 165 → 173 | 8 | macOS `caffeinate` 电源断言 + 自愈重启 |
| [`notifier.ts`](annotated/src/services/notifier.ts) | 156 → 163 | 7 | 九种终端通知通道 + auto 探测 |
| [`internalLogging.ts`](annotated/src/services/internalLogging.ts) | 90 → 95 | 5 | `[ANT-ONLY]` 内部埋点（k8s namespace / 容器 ID） |
| [`awaySummary.ts`](annotated/src/services/awaySummary.ts) | 74 → 80 | 6 | 「离开回来」卡片的一句话回顾 |
| [`mcpServerApproval.tsx`](annotated/src/services/mcpServerApproval.tsx) | 41 → 46 | 4 | 项目级 MCP server 的批准弹窗 |
| [`claudeAiLimitsHook.ts`](annotated/src/services/claudeAiLimitsHook.ts) | 23 → 27 | 4 | `claudeAiLimits` 的 React 薄壳 |

四个最值得记的点：

1. **两个摘要器是「fork 四用法」的最后一格**。`extractMemories` 抽记忆、`autoDream` 整理记忆、`MagicDocs` 维护文档，`AgentSummary`/`toolUseSummary` 则是**纯压缩**：产物不落盘，只给人看。`agentSummary` 的 prompt 是全仓 few-shot 写得最细的一处——4 个 Good、4 个 Bad，每个 Bad 都标注失败类型（过去时 / 太含糊 / 太长 / 说了分支名）。
2. **拒绝工具不能靠 `tools: []`**。`agentSummary` 用 `canUseTool` 回调拒绝，注释写明原因：`tools` 数组是 **prompt cache key 的一部分**，清空它等于让主线程刚建好的缓存作废。同理那个文件里**绝不设 `maxOutputTokens`**——它会夹紧 `budget_tokens`，导致 thinking 配置不匹配，缓存失效。这是所有「蹭主线程缓存」的功能都要遵守的两条铁律。
3. **`caffeinate` 的 5 分钟超时 + 4 分钟重启是自愈设计**。Node 被 `SIGKILL` 打死时来不及跑清理函数，孤儿 `caffeinate` 最多再撑 5 分钟就自己退出，不会永久霸占电源断言。另外 `error`/`exit` 回调里必须比对 `thisProc` 快照——否则旧进程的 exit 事件会把新进程的引用清掉，之后再也杀不到它。
4. **`notifier` 的返回值是「实际用了哪种方式」而不是布尔**。九种通道 + `auto` 探测，每次上报遥测时同时带「配置要求的通道」和「实际生效的通道」——这条数据专门用来发现「配了但不生效」（比如配了 kitty 却跑在 tmux 里）。

`internalLogging.ts` 是这批里的异类：三个导出全部以 `process.env.USER_TYPE !== 'ant'` 开头，开源构建里等于死代码。但它留在 bundle 里，说明这层门是**运行时判断而非编译期删除**。

### 服务层之后读什么（按「对理解主链路的价值 / 体量」排）

`services/` 已清零，`src/tools/` 已开工（72/184）。`src/` 还剩 1,529 份。候选目标（数字来自 `python scripts/check-coverage.py src`）：

| 目录 | 规模 | 为什么是下一步 |
| --- | --- | --- |
| `src/tools/` | 184 份 / 50,863 行（**已做 72 / 45% 行数**） | 工具的实际实现。服务层只讲「怎么发请求」，工具层讲「一次工具调用具体干什么」，是主链路的另一半 |
| `src/hooks/` | 104 份 / 19,232 行 | 生命周期钩子（PreToolUse / PostSampling 等），前面几个模块反复引用，读完能把 fork 时机的谜团全部收口 |
| `src/utils/` | 564 份 / 180,487 行（0 已做） | 最大的一块，但最杂。适合按需读（遇到哪个函数再查），不适合线性通读 |
| `src/components/` | 389 份 / 81,892 行（已做 66） | TUI 组件。已经做了一部分，剩下的是各面板 |

> 这里的进度是脚本算的（`python scripts/check-coverage.py <目录>`）。
> **`services/` 清零 ≠ 全仓完成**——全仓还有 1,529 份没动（22% 行数）。

---

### FileEditTool 与 FileWriteTool

工具层的第一批，选的是**最常用的那个工具**——`Edit`。它是整套系统里调用量最大的写操作，也是「模型说什么」和「文件实际是什么」之间唯一的翻译层。9 份源文件 2,668 行，批注后 2,735 行、65 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`FileEditTool/utils.ts`](annotated/src/tools/FileEditTool/utils.ts) | 775 | 790 | 15 | 引号/空白归一化、patch 生成、脱敏还原 |
| [`FileEditTool/FileEditTool.ts`](annotated/src/tools/FileEditTool/FileEditTool.ts) | 625 | 643 | 18 | 十个 errorCode 的校验链、原子写入 |
| [`FileEditTool/UI.tsx`](annotated/src/tools/FileEditTool/UI.tsx) | 289 | 295 | 5 | 动词选择、错误降级、拒绝时的 diff |
| [`FileEditTool/types.ts`](annotated/src/tools/FileEditTool/types.ts) | 85 | 89 | 4 | schema 契约、`z.output` vs `z.input` |
| [`FileEditTool/prompt.ts`](annotated/src/tools/FileEditTool/prompt.ts) | 28 | 32 | 4 | 「必须先 Read」写进描述 |
| [`FileEditTool/constants.ts`](annotated/src/tools/FileEditTool/constants.ts) | 11 | 13 | 2 | 叶子模块断依赖环 |
| [`FileWriteTool/FileWriteTool.ts`](annotated/src/tools/FileWriteTool/FileWriteTool.ts) | 434 | 445 | 11 | 整文覆盖、不改写行尾 |
| [`FileWriteTool/UI.tsx`](annotated/src/tools/FileWriteTool/UI.tsx) | 405 | 410 | 4 | 只显示前 10 行、`EOL` 不用 `os.EOL` |
| [`FileWriteTool/prompt.ts`](annotated/src/tools/FileWriteTool/prompt.ts) | 18 | 20 | 2 | 「既有文件才要求先读」+ 优先用 Edit |

四个最值得记的点：

1. **`Edit` 的本质是一台双向翻译机**。模型打不出弯引号（API 会把它们规范化成直引号），但真实文件里到处是弯引号。所以匹配前把两边都归一成直引号，命中后返回**文件里的原文片段**（不是模型给的串），写回时再按文件的风格把新串的引号转回弯的。`findActualString` + `preserveQuoteStyle` 这一对就是全部机关。少了后一半，改完的句子会一半弯一半直。
2. **所有 `replace` 都必须传函数而不是字符串**。`String.replace(str, str)` 会把 `$&`、`$1`、`$$` 当反向引用解释——而模型写的 `new_string` 里完全可能有 `$&`（它在改 shell 脚本或正则）。`utils.ts` 的 `applyEditToFile` 和 `MagicDocs/prompts.ts` 的 `substituteVariables` 踩的是同一个坑，两处都用 `() => replace` 绕开。
3. **从「检查文件没被改过」到「写盘」之间不许有 `await`**。`FileEditTool.call()` 里那句注释写得很硬：中间任何一次 yield 都会让两个并发编辑各自通过陈旧检查、后写的覆盖先写的。所以读文件用的是同步版 `readFileSyncWithMetadata`，看着别扭但是刻意的；`mkdir` 也必须提到临界区外面。
4. **`Edit` 保留行尾，`Write` 不保留——这是两个相反的决定**。`Edit` 传给 `writeTextContent` 的是读到的 `encoding` + `lineEndings`（局部补丁应融入文件既有风格）；`Write` 固定传 `'LF'` 且注释解释了一次真实事故：曾经「沿用旧文件行尾 / 用 ripgrep 采样仓库风格」，结果在 Linux 上覆盖 CRLF 文件时把 bash 脚本写进了 `\r`，采样还容易被 cwd 里的二进制污染。整文覆盖时，模型给什么就写什么。

另外两个细节值得单独看：

- **UNC 路径的安全短路**在两个工具里逐字重复，位置都在**第一次碰文件系统之前**：Windows 上对 `\\server\share` 做 `stat` 会触发 SMB 认证并泄露 NTLM 哈希。之所以不抽成公共函数，是因为它是「顺序敏感」的补丁，抽出去反而容易被后人挪到 `stat` 之后。
- **`FileWriteTool` 的 `if (oldContent)`** 用真值判断，所以「已存在的空文件」会走 create 分支（`structuredPatch: []`、`originalFile: null`）。这算已知的粗糙处，但对 UI 更友好——批注里特意标了「不要当 bug 修成 `!== null`」，否则会得到一个空 patch 的 update，界面上是一片空白。

### FileReadTool（读的那一端）

写完写的一端，紧接着读的一端。`Read` 是整个系统里**调用量最大的工具**，也是 `Edit` / `Write` 那条「必须先 Read」规矩的执行者——规矩写在 `prompt.ts` 的模板里，校验落在 `FileEditTool` 里，而「什么算读过」这件事由这里写进 `readFileState`。5 份源文件 1,602 行，批注后 1,655 行、48 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`FileReadTool/FileReadTool.ts`](annotated/src/tools/FileReadTool/FileReadTool.ts) | 1,183 | 1,211 | 28 | 五道零 I/O 校验、去重桩、六型输出映射、三级图片压缩 |
| [`FileReadTool/limits.ts`](annotated/src/tools/FileReadTool/limits.ts) | 92 | 97 | 5 | 两个上限（字节 / token）与优先级 env > GrowthBook > 默认 |
| [`FileReadTool/prompt.ts`](annotated/src/tools/FileReadTool/prompt.ts) | 49 | 54 | 5 | 模板三段插值、offset 指令两套文案 |
| [`FileReadTool/imageProcessor.ts`](annotated/src/tools/FileReadTool/imageProcessor.ts) | 94 | 98 | 4 | napi / sharp 双实现、ESM-CJS interop |
| [`FileReadTool/UI.tsx`](annotated/src/tools/FileReadTool/UI.tsx) | 185 | 192 | 6 | 只渲染摘要、agent 输出文件特殊处理 |

四个最值得记的点：

1. **`validateInput` 里一行 I/O 都没有，这是刻意的架构约束**。五道检查（pages 格式 → deny 规则 → UNC 短路 → 二进制扩展名 → 设备文件）全是纯字符串和内存查询，所以它能在**用户还没授权**的阶段安全跑完。所有 `stat` / `read` 都推迟到 `call()`。这不是巧合，是把「校验」和「执行」按授权边界切开的结果。
2. **去重桩是一笔算得很清楚的账**。约 18% 的 Read 调用是「同一文件、同一范围」的碰撞（最多占舰队 `cache_creation` 的 2.64%），因为上一次的 `tool_result` 还在上下文里。所以默认返回一句「内容没变，去引用之前那次」而不是重发全文。但去重前必须确认状态来自 **Read**（`offset !== undefined`）——`Edit` / `Write` 存进去的条目 mtime 是编辑之后的，拿它去重会告诉模型「没变，去看之前那次」，而那次读到的是编辑前的旧代码。
3. **两个上限管的是两件不同的事**。`maxSizeBytes`（256KB）卡**整个文件大小**、成本一次 `stat`、读之前抛；`maxTokens`（25,000）卡**实际输出 token**、成本一次 API 往返、读之后抛。`limits.ts` 的文件头注释里还记了一次被回退的实验：把「显式给了 limit 却超字节上限」改成截断而不是抛错——工具错误率降了，但平均 token 涨了，因为抛错只花约 100 字节，截断要花满 25K。
4. **PDF 的内容不走 `tool_result`**。`tool_result` 里只有一行 `PDF file read: xxx (1.2MB)` 的元数据，真正的 PDF 通过 `newMessages` 里的 `document` block 附上去；抽页成图（`parts`）同理，图片在 `newMessages` 里。这是「工具结果」和「附件消息」两种承载方式的区别，也是为什么 `mapToolResultToToolResultBlockParam` 的六个分支里有一半只返回一句话。

另外两处值得单独看的平台坑：

- **macOS 截图的空格有两种**。AM/PM 前的那个空格可能是 U+0020 也可能是 U+202F（窄不换行空格），肉眼和终端里都看不出区别，但 `stat` 会直接 ENOENT。所以 ENOENT 时有一步专门「换一个空格字符重试」，重试再失败才走相似文件名 / cwd 建议。
- **UNC 路径必须在任何文件系统操作前短路**。Windows 上对 `\\server\share` 做 `stat` 会主动发起 SMB 认证并泄露 NTLM 哈希——模型随手编一个路径就能变成凭据泄露。这条与 `Edit` / `Write` 里逐字重复，位置都在第一次碰文件之前。

### GlobTool 与 GrepTool（搜索的两端）

只读三件套收尾：Read 读单文件、Glob 按**名字**找、Grep 按**内容**找。这批 6 份源文件 1,064 行，批注后 1,124 行、60 处锚点。两个工具是刻意的孪生设计——对外都叫「Search」、结果渲染共用同一份实现、路径权限同走通配规则、UNC 短路与 ENOENT 补救逐字对应；分化点也都有意（Glob 的 validateInput 要求目录、Grep 允许 rg 的 PATH 直接指向文件）。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`GrepTool/GrepTool.ts`](annotated/src/tools/GrepTool/GrepTool.ts) | 577 | 612 | 35 | rg 封装全貌：旗标同名参数、三模式输出、分页协议、mtime 排序 |
| [`GrepTool/UI.tsx`](annotated/src/tools/GrepTool/UI.tsx) | 201 | 206 | 4 | React Compiler 编译产物、三模式共用汇总组件 |
| [`GrepTool/prompt.ts`](annotated/src/tools/GrepTool/prompt.ts) | 18 | 20 | 2 | 禁用 Bash 跑 rg 的理由、两条高频语法提示 |
| [`GlobTool/GlobTool.ts`](annotated/src/tools/GlobTool/GlobTool.ts) | 198 | 212 | 14 | 名字搜索、100 字符阈值放宽、复用 Grep 渲染 |
| [`GlobTool/UI.tsx`](annotated/src/tools/GlobTool/UI.tsx) | 63 | 67 | 4 | 借走 Grep 的渲染、对外统一叫 Search |
| [`GlobTool/prompt.ts`](annotated/src/tools/GlobTool/prompt.ts) | 7 | 8 | 1 | 按修改时间排序的检索策略暗示 |

五个最值得记的点：

1. **超时责任在谁手上是语义问题，不只是实现细节**。Grep 不用 `AbortController` 做超时（会打断整个 agent 循环），而是交给 rg 自己的 `execFile` timeout——超时抛 `RipgrepTimeoutError` 向上传播，模型看到「搜索没完成」而不是「没有匹配」。这两个结果的下一步行动完全不同。
2. **分页协议是双向的**。`appliedLimit` 只在真截断时返回（没截断还返回 limit，模型会误以为后面还有而白跑一轮 offset）；截断时结果末尾追加 `[Showing results with pagination = limit: 250, offset: 20]`。工具用「字段出现与否」跟模型对话。
3. **截断顺序决定截断质量**。content 模式先 `head_limit` 再转相对路径（省掉对将被丢弃的行的逐行处理，宽泛 pattern 可能回 10k+ 行）；文件列表模式先按 mtime 排序再截断（留下的永远是最最近修改的，顺序反了截断就成抽奖）。
4. **参数名直接沿用 rg 旗标**（-B/-A/-C/-n/-i），模型会 rg 就会调这个工具；但 `-n` 默认 true 与原生 rg 相反——封装在「贴近原生命令」与「对模型友好」之间选了后者（模型拿到行号才能用 Edit 精确定位）。
5. **`--hidden` 与 VCS 排除是配套决定**。开了隐藏文件（.github/.env 正是搜索目标）就必须手动挡住 .git 噪音；插件孤儿版本目录同样排除（否则旧版本代码会混进搜索结果）。

另外一个编译产物层面的观察：`GrepTool/UI.tsx` 是 React Compiler 的输出——`$[i]` 数组是手写 memo cache 槽位、`Symbol.for("react.memo_cache_sentinel")` 标记未初始化槽位。读这种代码的关键是认出「编译器把 useMemo 展开成了什么」，而不是逐行理解控制流。

### SkillTool（技能 = 可调用的斜杠命令）

「技能」这个工具是前面几条线的交汇点：技能清单占上下文 1% 预算（`prompt.ts` 精打细算的两级降级）、调用时或 inline 展开注入主对话、或按 frontmatter `context: 'fork'` 丢给子代理（与 AgentTool 共用 `runAgent`）、权限走 Skill 专属的 allow/deny 规则、遥测按官方/第三方分流脱敏。4 份源文件 1,477 行，批注后 1,525 行、47 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`SkillTool/SkillTool.ts`](annotated/src/tools/SkillTool/SkillTool.ts) | 1,108 | 1,140 | 32 | 三条执行路径、权限判定链、双通道遥测、远端技能加载 |
| [`SkillTool/prompt.ts`](annotated/src/tools/SkillTool/prompt.ts) | 241 | 250 | 9 | 清单预算（1% 窗口）、两级降级、BLOCKING REQUIREMENT 约定 |
| [`SkillTool/UI.tsx`](annotated/src/tools/SkillTool/UI.tsx) | 128 | 134 | 6 | fork 进度摘要、拒绝/错误也带进度 |
| [`SkillTool/constants.ts`](annotated/src/tools/SkillTool/constants.ts) | 1 | 2 | 1 | 工具注册名与规则匹配的关系 |

六个最值得记的点：

1. **一个工具、两种执行模型、union 类型分家**——inline 把技能展开成消息注入主对话（`tool_result` 只回一句 Launching skill 回执，正文走 `newMessages` 通道）；fork 把整个 prompt 丢给子代理独立跑完，只带回最终结果（结果走 `tool_result`）。输出 schema 用 `status` 字面量在类型层面分开，消费方不用猜。
2. **条件 require 防 tree-shaking 泄漏**——远端技能模块不能用静态 import：静态引入会连带拉进 `akiBackend.ts`，它模块顶层的 `memoize()`/`lazySchema()` 常量在 tree-shaking 后幸存、变成带副作用的初始化器。所有调用点都在 feature 守卫内，`remoteSkillModules!` 的非空断言因此成立。
3. **权限判定是一条有序链**——deny 全名/`:*` 前缀规则 → 远端技能自动放行（但排在 deny 之后，用户显式否决永远优先）→ allow 规则 → safe-properties 白名单自动放行（30 个无害属性；`allowed-tools` 因扩大权限不在清单里）→ 默认 ask 并附两条一键建议（精确名 / 前缀通配）。方向是 fail-closed：将来给命令对象加新属性，默认需要权限。
4. **模型覆盖必须过 `resolveSkillModelOverride`**——技能声明 `model: opus` 时要保留会话原有的 `[1m]` 长窗口后缀，否则 opus[1m] 会话跑了个 opus 技能，有效窗口从 1M 掉回 200K，autocompact 立刻误触发。
5. **`contextModifier` 链式包装 `getAppState`**——多个 modifier 会叠着改，每个必须用 `previousGetAppState` 看到前一个的结果；直接闭包引用最外层会互相覆盖。
6. **压缩保留登记要存「已转换」的内容**——远端技能登记进 invokedSkills 时必须存 `finalContent`（带 base directory 头和变量替换），而不是原始 markdown；存错一份，压缩恢复出来的技能就是残的。这条与本地技能经 `processSlashCommand` 的做法逐字对齐。

另有两处小而精的工程判断：fork 结束后 `agentMessages.length = 0` 释放消息内存（长会话防爬升的实招）；prompt.ts 的技能清单按窗口 1% 算预算、bundled 技能描述永不截断、其余按人头均摊、均摊到不足 20 字符整体降级成只有名字——每个降级档位都打遥测。

### 交互与杂项五工具（AskUserQuestion / REPL / McpAuth / NotebookEdit / Brief）

第 21 批收的是五个「小而各有绝活」的工具：问用户要答案的、把原语工具藏进 REPL 的、给未认证 MCP 服务器当替身的、改 Jupyter 的、以及助手模式下模型对用户说话的唯一通道。14 份源文件 1,809 行，批注后 2,075 行、132 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`AskUserQuestionTool/AskUserQuestionTool.tsx`](annotated/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx) | 266 | 310 | 44 | schema 体系、preview 校验、channels 禁用、call 不问人 |
| [`AskUserQuestionTool/prompt.ts`](annotated/src/tools/AskUserQuestionTool/prompt.ts) | 44 | 51 | 7 | 主提示词、preview 两版补丁、chip 宽度 |
| [`REPLTool/constants.ts`](annotated/src/tools/REPLTool/constants.ts) | 46 | 57 | 10 | REPL 模式开关判定、REPL_ONLY_TOOLS 藏原语清单 |
| [`REPLTool/primitiveTools.ts`](annotated/src/tools/REPLTool/primitiveTools.ts) | 39 | 47 | 8 | 惰性 getter 防 TDZ、绕开 getAllBaseTools 的原因 |
| [`McpAuthTool/McpAuthTool.ts`](annotated/src/tools/McpAuthTool/McpAuthTool.ts) | 215 | 250 | 35 | 伪工具替身、OAuth 后台续段、Promise.race 静默认证 |
| [`NotebookEditTool/NotebookEditTool.ts`](annotated/src/tools/NotebookEditTool/NotebookEditTool.ts) | 490 | 544 | 54 | 错误码链、非记忆化 jsonParse、readFileState 去重联动 |
| [`NotebookEditTool/UI.tsx`](annotated/src/tools/NotebookEditTool/UI.tsx) | 93 | 103 | 10 | 结果渲染、错误降级 |
| [`NotebookEditTool/prompt.ts`](annotated/src/tools/NotebookEditTool/prompt.ts) | 3 | 5 | 2 | 文案里的 cell_number 历史包袱 |
| [`NotebookEditTool/constants.ts`](annotated/src/tools/NotebookEditTool/constants.ts) | 2 | 4 | 2 | 工具名单独成文件防 import 环 |
| [`BriefTool/BriefTool.ts`](annotated/src/tools/BriefTool/BriefTool.ts) | 204 | 229 | 25 | 资格/激活双闸、DCE 正向守卫、resume 兼容 schema |
| [`BriefTool/upload.ts`](annotated/src/tools/BriefTool/upload.ts) | 174 | 203 | 29 | 附件上传、base URL 三级回退、全路径 best-effort |
| [`BriefTool/attachments.ts`](annotated/src/tools/BriefTool/attachments.ts) | 110 | 126 | 16 | 动态 import 保 tree-shaking、串行 stat 并行上传 |
| [`BriefTool/UI.tsx`](annotated/src/tools/BriefTool/UI.tsx) | 101 | 114 | 13 | 三种渲染模式、无工具外壳 |
| [`BriefTool/prompt.ts`](annotated/src/tools/BriefTool/prompt.ts) | 22 | 32 | 10 | 「答案写进 message」话术、助手模式提示词段 |

七个最值得记的点：

1. **AskUserQuestionTool 的 `call()` 不问任何人**——answers 在权限交互阶段已被 UI 组件回填进 input，`call` 只是把数据打包回传。整个工具的「交互」发生在 `checkPermissions` 的 ask 行为里，这也是 `requiresUserInteraction: true` 的实际含义。
2. **REPL 模式靠藏工具逼批量操作**——`REPL_ONLY_TOOLS`（Read/Write/Edit/Glob/Grep/Bash/NotebookEdit/Agent）对模型隐藏，只能进 REPL VM 组合调用，一次执行顶过去八次工具往返。开关判定要区分 ant 交互 CLI（默认开）与 SDK（默认关），因为 `USER_TYPE` 是构建期常量，不查 `ENTRYPOINT` 会污染所有 SDK 子进程。
3. **McpAuthTool 是「伪工具替身」模式**——未认证的服务器顶一个 `mcp__<server>__authenticate` 占位工具，模型借此知道服务器存在并代用户发起 OAuth；认证完成后真实工具经前缀替换写回 appState，同前缀的伪工具被一并清掉。`Promise.race` 处理静默认证（XAA 带 IdP 缓存令牌时整个流程先于 URL 完成）。
4. **NotebookEditTool 的 jsonParse 必须「非记忆化」**——`safeParseJSON` 按内容字符串缓存并返回共享引用，而 call 阶段会原地改 notebook（splice、改 source）；用记忆化版本等于毒化缓存，污染 validateInput 和后续同内容调用。写后还要以 `offset: undefined` 更新 readFileState，否则同一毫秒内的 Read→NotebookEdit→Read 会被 file_unchanged 桩顶掉。
5. **同一目标（非桥构建剔除 Brief 上传链）三种 DCE 手法**——`BriefTool.ts` 用正向 ternary feature 守卫（负向 if-return 剔不掉 GB 门字符串）、`attachments.ts` 用守卫内动态 `import('./upload.js')`（静态 import 会强制模块级求值）、`isBriefEnabled` 顶层重复 feature 检查（跨函数组合会破坏 Bun 常量折叠）。三处注释都在讲「为什么这么写才能被删干净」。
6. **Brief 的输出 schema 全字段可选是 resume 兼容要求**——旧会话重放时原样回放历史输出，attachments/sentAt 设为必填会把恢复到旧版本的会话直接崩掉。类型上的不完美是兼容性的代价，注释明说「不是偷懒」。
7. **upload.ts 的 base URL 三级回退是一个真实事故教训**——staging 令牌打到 api.anthropic.com 会 401 → 静默跳过 → web 查看器只看到没有 file_uuid 的死卡片。子进程宿主传的 `ANTHROPIC_BASE_URL` 必须参与回退，否则 getOauthConfig 的 staging 判定条件（USE_STAGING_OAUTH）在宿主那里根本没人设。

另有两处顺手可记：AskUserQuestionTool 在 `--channels` 模式下整体禁用（用户在 Telegram/Discord 上，多选对话框会永远没人答）；NotebookEditTool 的 prompt 文案还在说 `cell_number` 0-indexed——schema 早已改成 `cell_id` 字符串定位，文档滞后于实现的一手标本。

### 网络两件套（WebFetch / WebSearch）

联网能力的两端：WebFetch 是「抓页面 → 转 markdown → 让 Haiku 按用户 prompt 提炼 → 只回提炼结果」的管道，WebSearch 则是「一次 API 调用、服务端自动搜索、本地只负责解析流」的包装。8 份源文件 1,702 行，批注后 1,903 行、106 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`WebFetchTool/utils.ts`](annotated/src/tools/WebFetchTool/utils.ts) | 530 | 606 | 41 | 双缓存、重定向防护、http 升级、二进制落盘、Haiku 管道 |
| [`WebFetchTool/WebFetchTool.ts`](annotated/src/tools/WebFetchTool/WebFetchTool.ts) | 318 | 351 | 20 | 权限四关顺序、跨域重定向转述、prompt cache 抖动教训 |
| [`WebFetchTool/preapproved.ts`](annotated/src/tools/WebFetchTool/preapproved.ts) | 166 | 177 | 10 | 130+ 免审批文档站、host/path 两级查找、段边界匹配 |
| [`WebFetchTool/UI.tsx`](annotated/src/tools/WebFetchTool/UI.tsx) | 72 | 78 | 4 | 结果行只显示大小与状态码 |
| [`WebFetchTool/prompt.ts`](annotated/src/tools/WebFetchTool/prompt.ts) | 46 | 56 | 5 | 版权准则双档（预批准域鼓励摘录 / 非预批准引文 ≤125 字符） |
| [`WebSearchTool/WebSearchTool.ts`](annotated/src/tools/WebSearchTool/WebSearchTool.ts) | 435 | 485 | 25 | 服务端 web_search 工具注入、流式猜词、结果块状态机 |
| [`WebSearchTool/UI.tsx`](annotated/src/tools/WebSearchTool/UI.tsx) | 101 | 111 | 5 | 进度分流（猜到的词 / 收到的结果数） |
| [`WebSearchTool/prompt.ts`](annotated/src/tools/WebSearchTool/prompt.ts) | 34 | 39 | 2 | Sources 硬性要求、当前年月注入 |

八个最值得记的点：

1. **WebFetch 的产出不是网页，是 Haiku 的读后感**——抓取 → Turndown 转 markdown → 截断到 10 万字符 → `queryHaiku` 按用户 prompt 提炼 → 工具结果只有提炼文本。唯一例外：预批准域 + `text/markdown` + 不超长时跳过小模型直返原文（官方文档站的内容本来就是给模型读的）。
2. **重定向有三层防护，最狠的一层是防挂死**——① `isPermittedRedirect` 只许加/去 `www.` 和同源改路径；② axios `maxRedirects: 0` + 手动递归跟进（PSR 明令禁止自动跟随，防开放重定向漏洞）；③ 同域跳数上限 10——没有它，恶意服务器返回重定向环时每跳都重置 60 秒超时，工具会挂到用户手动中断。跨域重定向则完全不跟，转述给模型让它带新 URL 重新审批。
3. **工具描述抖动打爆 prompt cache 的真实事故**——prompt() 顶部那段「认证 URL 必挂」警告曾按 ToolSearch 是否在工具列表里动态增删，而 ToolSearch 启用与否随 MCP 工具数阈值漂移；每次抖动 = SDK query() 之间两次缓存 miss。修法是永远无条件携带。缓存键里有什么，就别动态改什么。
4. **双缓存各司其职**——`URL_CACHE`（15 分钟 / 50MB，键=原始 URL 而非升级或重定向后的）管页面正文；`DOMAIN_CHECK_CACHE`（5 分钟，按主机名）管域预检，且只缓存 allowed——blocked 和 failed 下次重查，黑名单可能随时变化。
5. **两处内存细节**——拿到 axios 响应后主动把 `response.data` 置 null 释放 ArrayBuffer 引用，让 GC 在 Turndown 构建 3-5 倍于 HTML 的 DOM 树之前回收最多 10MB；turndown+domino 约 1.4MB 常驻堆用惰性单例推迟到第一次抓 HTML 才加载。
6. **preapproved 清单的沙箱隔离是刻意的**——免审批只覆盖 WebFetch 的纯 GET；沙箱网络限制故意不继承这份清单，因为 huggingface/kaggle/nuget 这类域允许文件上传，放开任意网络访问等于数据外带通道。路径前缀条目（github.com/anthropics）还强制段边界匹配，`/anthropics` 匹配不到 `/anthropics-evil/malware`。
7. **WebSearch 是服务端工具，不是本地实现**——`extraToolSchemas` 注入 `web_search_20250305`（`max_uses: 8`，一次调用内最多自动搜 8 次），搜索发生在 Anthropic 服务端；本地消费流式事件：用正则从 `input_json_delta` 增量里抠出已完整的 query 字段发进度（用户能在结果回来前看到实际搜索词），结果块按 `[text] (server_tool_use + web_search_tool_result + text)*` 的状态机归整。
8. **`extractSearchText` 返回空串是个原则声明**——结果 UI 只显示「Did N searches in Xs」一行 chrome，results 内容从不上屏；若让全文搜索启发式去索引字符串项，搜到的全是幻影命中。搜索层索引什么，由 UI 展示什么决定。

另有一处口径提示：`isEnabled` 按提供商分档——firstParty 恒开、foundry 恒开（只发已支持的模型）、vertex 仅 Claude 4.0+ 系列、其余关；prompt.ts 每次调用注入当前「月份 年份」，逼模型搜最近信息时带上正确年份。

### MCPTool：模板工具与折叠名单

MCP 工具的本地端一半是「模板」——MCPTool.ts 只有 77 行，name/description/prompt/call 全部标注 Overridden in mcpClient.ts，运行时按每个服务器克隆覆盖；另一半是纯数据——classifyForCollapse.ts 的 604 行里约 570 行是两份手工维护的工具名名单。4 份源文件 1,087 行，批注后 1,117 行、29 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`MCPTool/classifyForCollapse.ts`](annotated/src/tools/MCPTool/classifyForCollapse.ts) | 604 | 610 | 6 | 约 30 家服务器的搜索/读取名单、camelCase 归一化、保守不折叠 |
| [`MCPTool/UI.tsx`](annotated/src/tools/MCPTool/UI.tsx) | 403 | 421 | 17 | 三策略渲染级联、React Compiler 产物、Slack 特判 |
| [`MCPTool/MCPTool.ts`](annotated/src/tools/MCPTool/MCPTool.ts) | 77 | 82 | 5 | 模板工具、passthrough schema、10 万字符统一上限 |
| [`MCPTool/prompt.ts`](annotated/src/tools/MCPTool/prompt.ts) | 3 | 4 | 1 | 空串占位，真实文案在 mcpClient.ts 动态覆盖 |

五个最值得记的点：

1. **匹配只看工具名，不看服务器名**——托管服务器的名字不稳定（slack 与 claude_ai_Slack 是同一个），工具名才是跨安装稳定的键；normalize 把 camelCase/kebab 统一成 snake_case，Notion 的 search、MongoDB 的 find 这类极短名字也直接命中。
2. **保守是硬原则**——名单里没有的工具一律不折叠；READ_TOOLS 全是 get_/list_/read_ 前缀的读取动作，kubectl_apply/delete 这种有副作用的绝不出现在名单里。没有条目也是一种记录：Git 和 PagerDuty 在注释里明说「没有搜索动词」。
3. **Set 去重暴露了策略的代价**——search_docs（Sentry 与 Supabase）、find_projects（Sentry 与 Todoist）各自出现两次：跨服务器的同名工具无法区分。这是「按名匹配、免维护」换来的盲区，由「不认识就不折叠」兜底。
4. **UI 渲染是三条策略的级联**——① JSON 里有一个主导字符串载荷（超 200 字符或含换行）就拆出来正经换行显示（专治 Slack 的 {"messages":"line1\nline2..."} 被 pretty-print 转义成字面 \n 的问题）；② 否则是小而平的对象（≤12 键、≤5,000 字符）就平铺成对齐的 k:v；③ 都不行退回 pretty-print 截断。三策略共享一个 parseJsonEntries 入口（空串/超长/非对象/键数越界五连守卫），两个大字符串无法判定谁是主载荷时宁可整体放弃也不猜。
5. **MCPTool.ts 本身是个空壳**——passthrough schema（MCP 工具自带 schema）、checkPermissions 直接 passthrough（权限走服务器级 allowlist 流程）、call 返回空串——所有真实行为在 mcpClient.ts 克隆模板时覆盖。10 万字符的结果上限是所有 MCP 工具的统一护栏。

另有两处小账：非交互模式下输入值截到 80 字符、超 1 万 token 的大响应在 UI 顶部加警告（文案「this can fill up context quickly」是说给人听的，模型那份由 maxResultSizeChars 在别处管）；trySlackSendCompact 先做字符串包含快检再 parse——非 Slack 输出零成本退出，频道标签优先取工具输入里的可读名字而非内部 ID。

### LSPTool：编辑器级代码智能的 CLI 移植

LSPTool 把「跳转定义 / 找引用 / hover / 调用层级」这九个编辑器操作暴露给模型。6 份源文件 2,006 行，批注后 2,050 行、42 处锚点。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`LSPTool/LSPTool.ts`](annotated/src/tools/LSPTool/LSPTool.ts) | 860 | 874 | 14 | 主流程：初始化等待、didOpen、两段式调用层级、gitignore 过滤 |
| [`LSPTool/formatters.ts`](annotated/src/tools/LSPTool/formatters.ts) | 592 | 603 | 11 | URI 归一、按文件分组、SymbolKind 映射、空结果的自我解释 |
| [`LSPTool/UI.tsx`](annotated/src/tools/LSPTool/UI.tsx) | 228 | 237 | 8 | 折叠摘要协议、header 里显示光标处符号名 |
| [`LSPTool/schemas.ts`](annotated/src/tools/LSPTool/schemas.ts) | 215 | 218 | 3 | 判别联合（真校验）与普通 strictObject（兼容壳）的双 schema |
| [`LSPTool/symbolContext.ts`](annotated/src/tools/LSPTool/symbolContext.ts) | 90 | 94 | 4 | 同步 I/O 提取光标处符号、64KB 读窗、半行哨兵 |
| [`LSPTool/prompt.ts`](annotated/src/tools/LSPTool/prompt.ts) | 21 | 23 | 2 | 给模型的操作手册：九操作 + 1-based 约定 |

五个最值得记的点：

1. **双 schema 是「框架限制」与「错误质量」的和解**——工具框架不支持判别联合，所以工具壳用普通 strictObject；validateInput 里再用 schemas.ts 的判别联合重跑一遍，按 operation 分支给出精确报错。同样的手法 NotebookEditTool 也用过，这是第二次出现。
2. **坐标换算是全局约定**——模型与用户说 1-based（编辑器习惯），LSP 协议是 0-based，进站出站各减/加一次。所有格式化输出再转回 1-based 展示。prompt.ts 里明说 1-based，模型不需要知道协议细节。
3. **incoming/outgoing 两段式替模型省一轮调用**——LSP 把调用层级拆成 prepare + calls 两个方法，工具在 call() 里自动串行：先 prepare 拿 CallHierarchyItem，取第一个 item 请求真正的调用列表。模型一次调用拿到最终答案。
4. **结果统一过 git check-ignore 过滤**——findReferences 等四种位置结果按 50 路径一批跑 git check-ignore（5 秒超时），node_modules 里的第三方引用被静默剔除；退出码 128（非 git 仓库）静默跳过，不报错。
5. **空结果消息是「自我解释」的**——「No definition found. This may occur if the cursor is not on a symbol...」每种空结果都列可能原因，模型能自行决定换位置重试而不是当故障上报。这是贯穿 formatters.ts 的设计原则。

另有三处工程细节：UNC 路径安全短路（与 FileEditTool 同款，防 SMB NTLM 凭据外泄）；symbolContext.ts 被迫用同步 I/O（调用方是同步 React 渲染函数），64KB 读窗加半行哨兵——填满即弃，宁缺勿错；isEnabled 跟着 LSP 连接状态走，没配服务器时工具整个消失而非运行时报错。

### PowerShellTool 上：外围机制九件

PowerShellTool 是 tools 里安全密度最高的目录（14 份 8,961 行），按「外围先行」拆两批。本批做九个外围文件 1,350 行，批注后 1,472 行、59 处锚点；核心安全大文件（pathValidation、readOnlyValidation、powershellPermissions、powershellSecurity、PowerShellTool.tsx，共 7,610 行）留下一批。

| 文件 | 原文 | 批注版 | 批注 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`toolName.ts`](annotated/src/tools/PowerShellTool/toolName.ts) | 2 | 3 | 1 | 两行文件打破循环依赖 |
| [`commonParameters.ts`](annotated/src/tools/PowerShellTool/commonParameters.ts) | 30 | 33 | 3 | 通用参数清单，破两大校验文件间的 import 环 |
| [`commandSemantics.ts`](annotated/src/tools/PowerShellTool/commandSemantics.ts) | 142 | 150 | 8 | 退出码语义表：robocopy 位掩码、grep 无匹配 |
| [`destructiveCommandWarning.ts`](annotated/src/tools/PowerShellTool/destructiveCommandWarning.ts) | 109 | 115 | 6 | 破坏性命令警告（纯信息层，不拦权限） |
| [`gitSafety.ts`](annotated/src/tools/PowerShellTool/gitSafety.ts) | 176 | 185 | 9 | git 武器化防线：裸仓库攻击、NTFS 短名 |
| [`UI.tsx`](annotated/src/tools/PowerShellTool/UI.tsx) | 131 | 137 | 5 | 折叠显示、进度复用 Shell 组件 |
| [`modeValidation.ts`](annotated/src/tools/PowerShellTool/modeValidation.ts) | 404 | 419 | 15 | acceptEdits 白名单、七安全标志、双复合守卫 |
| [`clmTypes.ts`](annotated/src/tools/PowerShellTool/clmTypes.ts) | 211 | 217 | 6 | 微软 CLM 类型白名单反向使用 |
| [`prompt.ts`](annotated/src/tools/PowerShellTool/prompt.ts) | 145 | 151 | 6 | 版本分支指引、后台与睡眠反模式 |

五个最值得记的点：

1. **退出码语义是 Windows 特有难题**——PowerShell 原生 cmdlet 用终止性错误（$?）报错、退出码恒 0；外部 exe 才设 $LASTEXITCODE，且 robocopy 的退出码是位掩码（0-7 全是成功、8+ 才有失败），grep/rg/findstr 退出 1 是无匹配。diff/fc/find 三个名字因 PS 5.1 别名歧义（可能解析到 cmdlet 也可能到 exe）被刻意省略——判不了就退化到默认语义（更严）。
2. **gitSafety 是裸仓库 HEAD 攻击的唯一防线**——pathValidation 刻意不把裸 HEAD 列入危险文件（合法同名文件误报太多），所以逃出 cwd 又落回 cwd 的路径必须在这里用真实 cwd 解析兜底。归一化链条每一步对应一种真实绕过：NTFS 逐组件尾点/尾空格（.. . 变 ..、hooks. 变 hooks）、8.3 短名（.git 变 GIT~N）、provider 前缀、盘符相对路径、unicode 横杠。
3. **modeValidation 的守卫密度是全目录之最**——七个安全标志（子表达式/脚本块/成员调用/splatting/赋值/停止解析/可扩展字符串）任一命中即拒；两个复合守卫（cwd 漂移 TOCTOU、刚创建符号链接）都源于「校验期与运行期的路径世界不同」；非 CommandAst 元素的守卫承重三个用例，注释明说与 isReadOnlyCommand 依赖同一 accident 一起 fail safe，谁都不能单独收窄。
4. **clmTypes 借微软的 CLM 白名单反向使用**——类型字面量不在名单就 ask，一个检查替代枚举所有危险类型（反射、命名管道、P/Invoke）。但 adsi/adsisearcher/wmi 系被刻意移除：类型转型即网络绑定（LDAP/WMI 远程查询），微软允许是因为目标用户是可信域内管理员，这里目标未经验证。
5. **prompt 按检测版本分支**——5.1 与 pwsh 7 的语法差异（&&、三元、UTF-16 编码、2>&1 的 ErrorRecord 陷阱）分三段注入；版本未知给保守的 5.1 兼容指引。背景任务与 Start-Sleep 反模式清单与 BashTool 同款，受环境变量开关控制。

另有一处纯信息层设计：destructiveCommandWarning 只产出权限对话框里的警告文案、不参与权限判定——「让用户多看一眼」与「拦下来」是两套系统；正则锚定语句起始防 git rm --force 里的 rm 误匹配，停止符只含花括号不含圆括号（圆括号是路径分组，后面的参数还是本命令的）。

### 服务层自测题（答不上来就回去重读对应文件）

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

UI 那半边（`components/` 的产品界面）当时跳过了 —— 它不影响理解主线。但 `ink/` 那 1.98 万行的**渲染器本身**后来补上了（见第 8 步），因为它是「多智能体产出的文字怎么变成屏幕」的另一半；`components/` 则到了第 9 步才回头补消息渲染主链（**实测 8.2 万行、389 个文件** —— 这个数之前一直误写成 4.2 万）。
多智能体这半边四个文件正好是一条完整的链：

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

`src/ink/` 是自己实现的 Ink（不是 npm 上的官方包），19,842 行。**这个目录现已全部批注完：96 个文件、19,842 行原文**，读完之后「一条用户输入 → 一屏字符」这条路是通的；样式层回答了「一屏字符长什么样」，而 `termio/` 回答了**反过来**的问题：「给进来一段带转义序列的字符串，怎么变成结构化事件」。

| 文件 | 原文 | 批注版 | 讲什么 |
| --- | --- | --- | --- |
| [`reconciler.ts`](annotated/src/ink/reconciler.ts) | 512 | 727 | React 19 自定义 renderer 的 host config：14 个类型参数、commit 阶段算布局、release 顺序 |
| [`dom.ts`](annotated/src/ink/dom.ts) | 484 | 685 | 七个元素名的极简 DOM、yoga 桥（两棵树两套下标）、文本测量、脏标记冒泡 |
| [`ink.tsx`](annotated/src/ink/ink.tsx) | 1,722 | 2,470 | 帧循环九阶段、双缓冲、diff 与 optimize、光标定位、终端模式、退出清理 |
| [`screen.ts`](annotated/src/ink/screen.ts) | 1,486 | 2,167 | 打包格子（2 个 int 装一格）、样式池的位标签、宽字符四态、blit/shift/clear、两帧 diff |
| [`render-node-to-output.ts`](annotated/src/ink/render-node-to-output.ts) | 1,462 | 2,180 | 沿树走一遍：blit / 清空 / 重画三选一，ScrollBox 的三遍渲染与 DECSTBM 快路径 |
| [`log-update.ts`](annotated/src/ink/log-update.ts) | 773 | 1,193 | 两帧之间到底发什么字节：全量重置的四种触发、逐格补丁、虚拟光标模型 |
| [`output.ts`](annotated/src/ink/output.ts) | 798 | 1,151 | 一帧的**操作队列**：七种操作、Clip 栈的现场求交、grapheme 聚类与预热缓存、单行写入 |
| [`styles.ts`](annotated/src/ink/styles.ts) | 772 | 967 | 两套类型（字 / 盒子）与九个 apply：CSS 属性怎么落到 yoga setter，`'x' in style` 的语义 |
| [`colorize.ts`](annotated/src/ink/colorize.ts) | 232 | 372 | 真彩色的两次降级：VS Code 自报家门不被认识、tmux 转发按别的终端声明做决定 |
| [`stringWidth.ts`](annotated/src/ink/stringWidth.ts) | 223 | 413 | 整台渲染器的尺子：四级快路径、零宽字符表、emoji 宽度、Bun 与 JS 的 1 vs 2 |
| [`Ansi.tsx`](annotated/src/ink/Ansi.tsx) | 292 | 504 | **React Compiler 的编译产物**该怎么读，以及 ANSI 字符串 → 组件树的降维 |
| [`termio/ansi.ts`](annotated/src/ink/termio/ansi.ts) | 76 | 150 | 整层的字母表：C0 表为什么写全 32 个、ESC 尾字节范围为什么比 CSI 宽 |
| [`termio/csi.ts`](annotated/src/ink/termio/csi.ts) | 320 | 493 | 三个字节区间就是 CSI 的完整语法；`csi()` 的单参数/多参数两副面孔 |
| [`termio/dec.ts`](annotated/src/ink/termio/dec.ts) | 61 | 119 | 47 与 1049 的区别、四个鼠标模式为什么一起开、关的时候为什么逆序 |
| [`termio/esc.ts`](annotated/src/ink/termio/esc.ts) | 68 | 128 | 两字符序列；`null` 与 `unknown` 两种「空」的语义差别 |
| [`termio/types.ts`](annotated/src/ink/termio/types.ts) | 237 | 424 | 语义类型；`Grapheme.width` 算了却没人读；页签状态的三态设计 |
| [`termio/sgr.ts`](annotated/src/ink/termio/sgr.ts) | 309 | 541 | 分号/冒号两套语法、`38:2:cs:R:G:B` 的 `off` 偏移、`22` 为什么一对二 |
| [`termio/tokenize.ts`](annotated/src/ink/termio/tokenize.ts) | 320 | 564 | 词法层：八个状态、判定顺序为什么不能重排、`i++` 缺失处的降级 |
| [`termio/parser.ts`](annotated/src/ink/termio/parser.ts) | 395 | 671 | 语义层：SGR 被拦下来不进 action 流、`?? 1` 与 `?? 0` 的两个默认值 |
| [`termio/osc.ts`](annotated/src/ink/termio/osc.ts) | 494 | 879 | OSC 全家族：DCS 透传、剪贴板三条路、内层为什么选 BEL 而不是 ST |
| [`termio.ts`](annotated/src/ink/termio.ts) | 43 | 83 | 桶文件只导出读的一侧，生成函数走深路径 |

合计 **11,079 行原文**，553 处批注锚点（其中 `termio/` 十个文件 2,323 行、156 锚点）。

**`termio/` 这一组可以按下标顺序读**：`ansi`（字节表）→ `csi`/`dec`/`esc`（三族序列的常量与生成）→ `tokenize`（切边界）→ `sgr`（样式参数）→ `parser`（拼起来变成 action）→ `osc`（唯一带自由文本负载的一族）。前四个是字典，后四个才是逻辑。

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

**㊾ `'x' in style` 和 `style.x !== undefined`，为什么在这里不等价？**

因为 `styles.ts` 收到的 `style` 不是全量样式，是 diff。`reconciler.ts` 的 `diff()` 有一条关键行为：上一帧有、这一帧没有的键，会被写成 `{ key: undefined }` —— **键还在，值是 undefined**。

于是两种写法的语义分开了：

| 写法 | 含义 | 漏掉什么 |
| --- | --- | --- |
| `'margin' in style` | 这个键这一帧变了（新值 / 被删 / 被重置） | 什么都不漏 |
| `style.margin !== undefined` | margin 有**新值** | 属性被移除的情况 |

按后者判断的话，「把 `margin` 从 4 改回不设置」这个操作永远无法表达——屏幕会一直保留 4 格边距，而且没有任何地方报错。

所以这个代码库里的约定是：**值 `undefined` 表示「重置成默认」，「不要动」的表现形式是「这个键根本不在 diff 里」。** 这个约定没有类型系统保护，只能靠读 `diff()` 的实现才知道。

**㊿ 同一个终端，能力明明够却显示不出真彩色，有几种原因？**

两种，而且**都不是能力问题，是探测看不见真相**：

- **VS Code 系（xterm.js）** —— 从 2017 年就支持真彩色，但 `chalk` 的 `supports-color` 不认识 `TERM_PROGRAM=vscode`（它只认 `iTerm.app` 和 `Apple_Terminal`），于是退到 `-256color` 分支、`level = 2`。在这个级别下 `chalk.rgb(215,119,87)`（Claude 橙）会被映射到 6×6×6 色立方里最近的 `rgb(215,135,135)` —— 橙红变成发白的肉粉色。`colorize.ts` 的办法是：`TERM_PROGRAM === 'vscode' && level === 2` 就硬提到 3。
- **tmux** —— 它解析真彩色 SGR **完全正确**，但往外层终端重发时，只在**外层声明了 `Tc`/`RGB` 能力**的情况下才重发。默认配置不带 `terminal-overrides ,*:Tc`，于是发出去的内容里**没有背景色序列**，深色主题下就是黑底黑字。办法是反过来：`TMUX` 存在就把 level 压到 2，让 chalk 发 256 色（tmux 会原样转发），而 `grey93`（索引 255）和 `rgb(240,240,240)` 视觉上几乎一样。

两段补丁，一个向上提、一个向下压，判据都是环境变量粗判 + 已知失败模式，**没有一段是能力查询**。顺序也不能换：先 boost 再 clamp，才能让「VS Code 里套 tmux」落到 2。

判 `level === 2` 而不是 `level < 3` 也是同一个道理：`level 0` 是用户明确要求不要颜色（`NO_COLOR`、`FORCE_COLOR=0`）。**修能力，不修意愿。**

**51 `stringWidth` 有两个实现，为什么在 Node 下跑会坏？**

（带圈数字用到 ㊿ 就没了，往下改用普通编号。）

不是慢，是**算错**。以 Devanagari 的 क्ष（ka + virama + ZWJ + ssa）为例：它渲染成**一个合字字形**，但终端分配 **2 个格子**（`wcwidth` 逐个辅音求和）。

- `Bun.stringWidth` 返回 **2** —— 与终端一致
- JS fallback 按 grapheme 处理，只数第一个非零宽字符，返回 **1**

而这个返回值用来**定位光标**。算成 1 的后果是：我们以为只占一格，下一个字符写到第 x+1 列，终端却已经画在第 x+2 列——从这一格开始整行错位。

所以这里选的不是「Unicode 逻辑上正确的宽度」，是「**与终端实际格子分配一致的宽度**」。要对的不是 Unicode 语义，是终端的格子。这才是 `Bun.stringWidth` 在这个项目里不可替代的原因——性能只是附带。

两个实现还有个隐蔽分歧：选项名不同（`ambiguousIsNarrow` vs `ambiguousAsWide: false`），默认值也不同。`stringWidth.ts` 两边都显式指定了，所以 ⚠、★ 这类 Ambiguous 字符按 1 列算；只在一个实现里指定的话，换运行时就得到不同宽度。

**52 `Ansi.tsx` 是 React Compiler 的编译产物——该怎么读它？**

`import { c as _c } from "react/compiler-runtime"` 就是这个标记。人写的版本已经被自动重写过了，三条映射就够：

| 看到的 | 读成 |
| --- | --- |
| `const $ = _c(12)` | 这个组件有 12 个缓存槽 |
| `if ($[3] !== children)` | 依赖变了才重算（= `useMemo` 的 deps） |
| `$[3] = children` | 记下这次的值 |
| `bb0: { … break bb0 }` | 可能提前返回（labeled block） |
| `Symbol.for('react.early_return_sentinel')` | 区分「缓存了一个提前返回」和「槽还没填」 |

最值得注意的一处：`span.props.dim = true` 是**原地修改**（副作用），而它所在的 `map` 回调只在缓存 miss 时执行。之所以没出问题，是因为 `map` 的结果也被一起缓存了——**碰巧安全**。编译器的缓存正确性依赖函数是纯的，而这里不是。

如果想看人写的版本：文件末尾 `sourceMappingURL` 的 base64 里，除了映射表还内嵌了原始 TSX 全文（`sourcesContent` 字段）。解出来是 308 行，带注释、带类型。**编译后的代码能看懂逻辑，但「为什么这么写」的痕迹只在原文里**——这一步值得做。

**53 同一个字节串 `ESC [ M`，为什么在输出流里是「删行」、在输入流里是「鼠标事件」？**

因为**方向决定语义**。`CSI M` 是 ECMA-48 的 DL（Delete Lines）；而 X10 鼠标协议借用了同一个前缀，后面再跟三个原始字节（`Cb+32, Cx+32, Cy+32`）。

所以 `createTokenizer` 有一个 `x10Mouse` 选项，默认 `false`（输出语义，`ESC [ M` 就是删行），只有 stdin 才传 `true`。开错了方向的后果不是报错，是**静默吞掉文本**：输出方向开了 `x10Mouse`，`ESC [ M` 后面紧跟的三个字符会被当坐标吃掉。

判定条件里还有一条容易忽略的：`i - seqStart === 2`，即 `M` 必须紧跟在 `ESC [` 后面、中间没有任何参数。因为 SGR 鼠标是 `ESC [ < ... M`，`M` 出现在有参数的后面。

同一类「同序列两义」还有一处：`CSI I` 在出站方向是 CHT（水平制表），在入站方向是 `FOCUS_IN`。区分方式也是方向 —— 而 `parseCSI` 干脆只声明 CHT 不解析它，于是入站的 `CSI I` 归成 unknown 被丢掉。

**54 SGR 在仓库里有两个解析器，为什么不能合并？**

因为**一个是有损的，一个是无损的**。

`parser.ts` 的 `parseCSIParams` 是 `split(/[;:]/)` —— 冒号和分号一视同仁，空串变 0。对光标命令（`CSI 3 ; 5 H`）完全够用，而且快。

但对 SGR 就致命：`38:2::255:0:0` 被切成 `[38, 2, 0, 255, 0, 0]`，色彩空间的「空」和「0」被抹平，而且子参数的层级信息全丢了。所以 `parser.ts` 在 `finalByte === CSI.SGR` 时**不做参数解析**，直接把原始字符串交给 `sgr.ts` 的 `parseParams`（那一个会记 `colon` 标志和 `subparams` 数组）。

这是「有损版够用就别上无损版」的取舍 —— 光标命令占绝大多数调用量，为它们付无损解析的代价不值得。代价是同一个语法有两份实现，且**必须记得 SGR 走哪一份**。

**55 `applySGR` 里的 `22`，为什么一次关掉两个属性？**

因为 ECMA-48 把 bold（1）和 faint（2）归为**同一个属性**「强度」，而 22 是「normal intensity」—— 所以它必须同时清掉两者。

直觉写法是 `s.bold = false` 就收工，后果是：一段用了 `dim` 的文字，在遇到「取消加粗」之后仍然保持暗淡，而终端已经恢复正常亮度。**屏幕上的样子和终端内部状态分叉了**，之后的每一格都会跟着错。

这一组里只有 22 是一对二，其余（23/24/25/27/28/29）都是一对一。所以「每个取消码对应一个设置码」这个规律在这里有个例外，写代码时容易按规律办事。

**56 OSC 穿过 tmux 时，内层为什么故意用 BEL 而不是标准推荐的 ST？**

因为**嵌套转义**。DCS 透传要求负载里的每个 ESC 双写；如果内层 OSC 用 ST（`ESC \`）终止，那个 ESC 也要双写。tmux 解出来是一个，正确 —— 但一旦层级超过一层（tmux 里套 screen），双写次数就算不清了。

选 BEL 则彻底绕开：**内层序列里根本不含 ESC，就不存在嵌套转义**。

通用规律：设计嵌套协议时优先选一种「不需要转义的编码」，而不是把转义规则写对。前者是结构性的，后者靠纪律。同理，`wrapForMultiplexer` 的注释特意提醒「Do NOT wrap BEL」—— 因为包进 DCS 之后 tmux 就看不见那个 BEL 了，窗口的提醒标记也就没了。

**57 `tokenize.ts` 的 `escape` 分支里那五个 `if`，顺序能重排吗？**

不能。前两个（CSI/OSC/DCS/APC 和 SS3 的 `0x4f`）**必须**在 `isEscFinal` 之前，因为它们的字节全都落在尾字节区间 `0x30-0x7e` 里。

如果先判 `isEscFinal`，`ESC [ 3 1 m` 会在 `ESC [` 这一步就被判成「两字符序列」发射出去，剩下的 `31m` 变成文本 —— **所有 CSI 序列全部失效**，屏幕上直接出现可见的 `[31m`。

这种「看似随意的 if 顺序其实是正确性前提」的写法，这个仓库里反复出现：`setClipboard` 必须先 native 后 tmux（否则用户切走的窗口期里复制没完成）、`log-update` 推进行必须用 LF 不能用 CSI CUD（后者在视口底边静默失败）。共同点是**顺序错了不报错，只是行为微妙地不对**。

**58 怎么在十分钟内发现「`Grapheme.width` 算了但没人读」这种死代码？**

从「谁消费这个字段」倒着查，而不是从定义正着读。

具体做法：`grep "\.width" Ansi.tsx` —— 零结果。而 `Ansi.tsx` 是 `Parser` 唯一的调用点。于是整条链断在那里：`parser.ts` 里那几个 `isEmoji` / `isEastAsianWide` 区间判断、`graphemeWidth` 的两条分支，全都服务于一个没有读者的字段。

同一手法在这一轮还发现了 `Parser.inLink` / `linkUrl`（写而不读 —— 因为 `Ansi.tsx` 自己用局部变量管链接状态）和 `termio.ts` 导出的 `TextSegment`（全仓库零引用，而且和 `utils/textHighlighting.ts` 里的同名类型完全不同）。

**读代码时，「这个字段被谁读」比「这个字段是什么意思」更省时间。** 前者一条 grep，后者要读完整条调用链。

---

## 输入侧（`parse-keypress` + `selection`）读完了吗？六道自测题

上面二十一份都是「**画**」出去的方向。这一轮补的是反方向：用户的手怎么变成事件。

**59 同一个 ESC 字节，什么时候是「用户按了 Esc 键」，什么时候是「一个序列的开头」？**

取决于**后面还有没有字节** —— 而这个信息在收到这一刻并不完整（分块读 stdin 时 `ESC [ < 6 4` 可能正好断在中间）。

所以判定权只能给 tokenizer：它有「不完整就缓冲」的能力，解释层拿到的永远是完整序列。兜底在 `App.tsx`：50ms 还没等来续块，就当成真的 Esc 冲出去。

这个 50ms 也是这份代码里**唯一的时间假设**，而它带来一个反直觉的 bug：Node 的事件循环里 **timers 阶段先于 poll 阶段**。一次重渲染把循环阻塞超过 50ms 时，续块其实已经躺在缓冲区里了，定时器却先跑 —— 于是「Esc + 尾巴被劈开」，`parse-keypress` 里那段「孤儿鼠标尾巴重合成」就是为此写的补丁。

**60 输入侧的 `ESC [ M` 和输出侧的 `ESC [ M` 为什么不能共用一套解析？**

因为**方向决定语义**。输出侧它是 ECMA-48 的 DL（删除行）；输入侧它是 X10 鼠标，后面跟三个裸字节当坐标。

所以 `createTokenizer` 有个 `x10Mouse` 选项，全仓库只有 `parse-keypress.ts` 传 `true`。开错方向不会报错，会**静默吃字符**：输出方向误开，`ESC [ M` 后面三个字符被当坐标吞掉；输入方向误关，三个坐标字节当文本漏进输入框。

**61 `parseKeypress` 里 `modifyOtherKeys` 为什么必须排在 `FN_KEY_RE` 之前？**

老正则会**部分匹配**新序列，然后把剩下那截当垃圾。`ESC [ 27 ; mod ; code ~` 有三个参数，而 `FN_KEY_RE` 的参数分支只允许两个 —— 它能把前两个吃掉，第三个参数和 `~` 漏出去，变成输入框里的可见字符。

顺带一个容易看错的细节：`FN_KEY_RE` 里 `(?:1;)?` 那个 `1` 不是键号，是 xterm 给光标键的**固定占位**（真键号靠终结字母表达）。写成 `(\d+);` 反而会匹配上不存在的序列、算出错误的键名。

**62 双击一个汉字，为什么必须先「退回前半格」？**

宽字符占两格，**后一格（SpacerTail）的 char 是空串**。`charClass('')` 把它判成「空白」，于是双击汉字会选中一片空白而不是那个字。

同一件事还决定了左右扩展的规则**不对称**：
- 往左：遇到 SpacerTail 不能直接比类别，必须**跨过它去看前一格的 head**，用 head 的类别判断
- 往右：遇到 SpacerTail 直接**吞进来** —— 它属于刚收下的那个宽字符

判断依据是「谁是这段的成员」：head 是成员，tail 只是它的占位。

**63 选区滚出屏幕之后，复制出来的文本为什么还能完整？为什么要额外记 `virtualRow`？**

两本不同的账，缺一本就错：

| 账本 | 解决什么 | 不记的后果 |
| --- | --- | --- |
| `scrolledOff*` 累积器 | 屏幕只有一屏，滚出去的行会被覆盖 | 复制结果只剩后半截 |
| `virtualAnchorRow` / `virtualFocusRow` | clamp 会丢真位置 | 反向滚动后高亮错行，且累积器永远是旧账 |

`virtualRow` 举个数就清楚：起点在第 5 行，PgUp 上移 10 行 → `clamp` 到 0；再 PgDn 回来 10 行，从已 clamp 的 0 算会得 10，真值是 5。**高亮错 5 行，而复制出来的文本比看到的多** —— 症状和原因隔得很远。

两个累积器的操作方向还相反：`above` 用 push（最新在尾）所以从尾部截，`below` 用 unshift（最新在头）所以从头部切。

**64 高亮为什么是「改屏幕缓冲的 styleId」，而不是让 diff 认识选区？**

因为那样 `LogUpdate` 就得知道「选区」这个概念，而它目前是一个**纯粹的两帧比较器** —— 这个纯粹性很值钱：只比文字的话，「高亮变了但文字没变」会被漏掉，于是必须为它再开一条路径。

改缓冲则完全绕开：把选中格子的 `styleId` 换成「保留前景 + 实心底色」的那个 id，diff 自然把它们当普通变化捡走。`LogUpdate` 一行都不用改。

为什么不用 SGR-7 反显（老做法）：反显是**逐格交换**前景/背景，而代码是语法高亮的 —— 一交换，每个 token 变成不同背景色，整片像打了彩色马赛克。

### 顺带两个小件

`hit-test.ts`（130 行）回答「一个终端坐标落在哪个节点」。它不重算布局，只读渲染时存下的矩形 —— 所以**命中的是最后一帧的布局**，这在交互上是对的（用户点的是他看到的东西）。一处容易读漏：`if (!rect) return null` 在递归之前，所以一个节点这帧没渲染，**整棵子树都不会被命中**。

`render-border.ts`（231 行）是这一层最后一件「按字符串画」的东西：拼一条边整条 `write`，靠 `Output.write` 内部按换行分行。它有一处**真会出错**的地方 —— 边框文字太长时用 `substring(0, borderLength)` 按码元截断，而 `content` 是**已上色的字符串**，很容易把 `ESC [ 38 ; 5 ; 196 m` 切在中间，漏出半个转义序列，之后整屏着色错乱。现在没出问题，是因为唯一的调用方（`PromptInput` 的边框标题）永远比边框短 —— 属于「靠调用方保证才不出问题」的代码。

### 前几轮修的几个判据误报

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

## `services/mcp/` 十六个小件读完了吗？六道自测题

主干那六份（`config` / `client` / `auth` / `xaa` / `xaaIdpLogin` / `useManageMCPConnections`）讲的是「一个连接的一生」。这十六个小件讲的是**连接之外的一切**：名字怎么定、闸怎么设、审批怎么从手机回来、表单怎么问人。

| 文件 | 行数 | 一句话 |
| --- | --- | --- |
| [`utils.ts`](annotated/src/services/mcp/utils.ts) | 575 | 名字过滤、配置哈希、过期客户端回收、项目级 server 的信任判定 |
| [`channelNotification.ts`](annotated/src/services/mcp/channelNotification.ts) | 316 | 通道的六道闸 + `<channel>` 标签怎么拼 |
| [`elicitationHandler.ts`](annotated/src/services/mcp/elicitationHandler.ts) | 313 | server 向人提问（表单 / 打开链接）的整条链路 |
| [`types.ts`](annotated/src/services/mcp/types.ts) | 258 | 八种 transport 的配置 schema、连接状态机 |
| [`channelPermissions.ts`](annotated/src/services/mcp/channelPermissions.ts) | 240 | 把审批提示发到手机，等一句 "yes tbxkq" |
| [`claudeai.ts`](annotated/src/services/mcp/claudeai.ts) | 164 | 从 claude.ai 拉组织下发的 server 列表 |
| [`headersHelper.ts`](annotated/src/services/mcp/headersHelper.ts) | 138 | 连之前先跑一条本地命令，拿动态 header |
| [`SdkControlTransport.ts`](annotated/src/services/mcp/SdkControlTransport.ts) | 136 | 把 JSON-RPC 套进 control 信封，跨进程 |
| [`vscodeSdkMcp.ts`](annotated/src/services/mcp/vscodeSdkMcp.ts) | 112 | 和 VSCode 扩展之间的两条 notification |
| [`mcpStringUtils.ts`](annotated/src/services/mcp/mcpStringUtils.ts) | 106 | `mcp__server__tool` 的拼与拆 |
| [`oauthPort.ts`](annotated/src/services/mcp/oauthPort.ts) | 78 | 回调端口怎么挑（含 Windows 的坑） |
| [`channelAllowlist.ts`](annotated/src/services/mcp/channelAllowlist.ts) | 76 | 哪些插件被批准可以当通道 |
| [`officialRegistry.ts`](annotated/src/services/mcp/officialRegistry.ts) | 72 | 官方 MCP 名单（只用于埋点） |
| [`InProcessTransport.ts`](annotated/src/services/mcp/InProcessTransport.ts) | 63 | 同进程里的一对假传输 |
| [`envExpansion.ts`](annotated/src/services/mcp/envExpansion.ts) | 38 | `${VAR:-默认值}` |
| [`normalization.ts`](annotated/src/services/mcp/normalization.ts) | 23 | 名字归一化 |

**65 一个 23 行的名字归一化文件，凭什么单独存在？它又故意不做什么？**

单独存在是为了**破环**：它有七个引用方，而这些模块彼此有环，把共用函数拔到环外是最省事的解法。

它故意不做的是**长度校验** —— 注释里写着目标是 1~64 字符，但代码只做字符替换。超长名字会一路活到工具名里，最后由 API 拒绝。这是「信任上游」：名字是用户自己配的，报错也看得懂；反过来在这里截断，会造出两个 server 映射到同一个工具前缀的坑。

**66 `${VAR:-default}` 里 `split(':-', 2)` 的那个 `2` 在防什么？环境变量设成空串为什么不能当「没设」？**

`2` 是「最多切几段」：默认值自己也可能带冒号（`${PATH:-/usr/bin:/bin}`），不限制就会把默认值切碎。代价是**嵌套默认值**（`${A:-${B:-x}}`）会被切坏 —— 这个展开器不支持。

空串必须算「设了」：`FOO=` 是一个合法的值「我要空」。用真值判断（`if (envValue)`）会让它回落到默认值，这是这类展开器最经典的 bug。

**67 手机上的 "yes tbxkq" 能批准一次工具调用，那信任边界在终端还是在别处？5 个字母为什么要配一张屏蔽词表？**

都不在终端 —— 而在 **allowlist**（`tengu_harbor_ledger`）。文件头自己承认：一个被攻陷的通道可以伪造 "yes <id>"，人根本没看见提示。之所以接受，是因为「被攻陷的通道本来就能无限次往对话里注入内容，自批只是更快，不是更强」—— 这是**增量风险**的算法，不是绝对风险。

屏蔽词表则是在承认另一件事：25 个字母的 5 次方（约 980 万）**不够随机**，能拼出的英文词足够多，而这条消息要发到用户手机上。表永远补不全，所以真正的保险是「命中就加盐重算」。

**68 通道的六道闸为什么 killswitch 必须排在认证之前？「server 类条目永远过不了名单」那个 else 分支在防什么？**

顺序是：capability → 全局开关 → 认证 → 组织策略 → 会话名单 → 市场/名单。killswitch 排在认证前面，不只是为了「省一次检查」：如果反过来，一个 OAuth 失效的用户会看到「请登录」，而不是「功能没开」—— 他会去修一个没坏的东西。

那个 else 分支防的是**形状不匹配被当成匹配**：名单条目的 schema 是 `{marketplace, plugin}`，没有 server 这一维。不加这段，`--channels server:plugin:foo:bar` 会匹配上某个插件的运行时名，于是完全没过名单就注册成功。

**69 `AbortSignal` 已经 aborted 时，为什么还要显式判一次？abort 为什么 resolve 成 cancel 而不是 reject？**

因为 `addEventListener` 在 signal 已 aborted 时**不会补发事件**。漏了前置判断，Promise 永不 resolve，上面那个 `await` 把整个请求挂住 —— 而症状是「server 那边一直等，UI 这边什么都没发生」。

resolve 成 cancel 是协议层面的选择：MCP 那边等的是 `ElicitResult`，reject 会把「用户取消了」这个信息丢掉，只剩一个协议错误。把异常翻译成「协议表达得出来的那一种正常状态」，几乎总比让异常穿透好。

**70 `/reload-plugins` 判断「配置变没变」的哈希，为什么摘掉 `scope`、排序对象键、却不排序数组？**

- 摘掉 `scope`：它是**出身**不是**内容**。把同一个 server 从 `.mcp.json` 挪到 `settings.json`，不该被判成变了、白重连一次
- 排序对象键：`{a:1,b:2}` 和 `{b:2,a:1}` 是同一个配置
- **不**排序数组：`["-y","pkg"]` 和 `["pkg","-y"]` 是两个不同的命令。一刀切递归排序数组，会让「参数顺序改了」被判成没变，该重连的没重连

### 三个「一行注释顶一段设计」的地方

`officialRegistry.ts` 的 `isOfficialMcpUrl` 是 **fail-closed**：名单没拉到时返回 false。方向选得对 —— 这个布尔只用于给埋点打标签，误判成「非官方」只是统计少一点；反过来 fail-open 会让一次网络失败把上万个第三方 server 全记成官方，那批数据就废了，而且没人会发现。

`headersHelper.ts` 里的 `shell: true` 是关键的一行：`headersHelper` 是**一整条 shell 命令**，不是「可执行文件 + 参数」。所以这个配置字段等于任意命令执行权，上面那道「工作区信任确认了吗」是它唯一的闸。而那道闸在非交互模式下被跳过 —— 代价是 SDK / `-p` 场景下这条防线不存在，安全责任转移到「别在不可信目录里跑 `-p`」。

`vscodeSdkMcp.ts` 有两处不一致值得记：`file_updated` 那条 notification 带 `.catch`，`experiment_gates` 那条没有 —— client 已断开时后者是未处理的 rejection。一处有、一处没有，这类不一致几乎总是不小心留下的。

### 顺带倒查出两块死代码

`types.ts` 里 `TransportSchema` / `type Transport` 全仓库零读者；`SerializedTool` / `SerializedClient` / `MCPCliState` 三个 interface 只互相引用，外面没人用。判定方法还是那一条：**grep 符号名，只命中定义处**。

---

## `ink/` 剩余三十一个小件读完了吗？六道自测题

上一批把「输入侧」四份补上之后，`ink/` 根目录只剩一堆百行小件。这一批全清了：根目录 27 个 + `layout/` 四个，共 **2,997 行原文（批注版 5,117 行）、224 处锚点**。

它们不是「补细节」这么简单 —— 这一批挖出了**三处零读者的代码**和**一处注释漂移**，比任何一处实现细节都值得记。

| 分组 | 文件 | 它回答的问题 |
| --- | --- | --- |
| 出口 | `terminal.ts` | 这个终端能做什么 + 最后一站 `write` |
| 探测 | `terminal-querier.ts` | 没有超时，怎么知道终端不支持 |
| 一帧 | `renderer.ts` / `frame.ts` | DOM 怎么变成屏幕缓冲；一帧的数据契约 |
| 入口 | `root.ts` / `instances.ts` | 三个起点，一张按 stdout 分身的表 |
| 文本 | `wrap-text.ts` / `wrapAnsi.ts` / `measure-text.ts` / `widest-line.ts` / `squash-text-nodes.ts` | 折行、截断、测量、摊平 |
| 缓存 | `line-width-cache.ts` / `node-cache.ts` | 两个 Map，一个为流式，一个为 blit |
| 交互 | `focus.ts` | 焦点栈、Tab 环、删除节点后焦点恢复到哪 |
| 终端杂项 | `bidi.ts` / `tabstops.ts` / `clearTerminal.ts` / `supports-hyperlinks.ts` / `terminal-focus-state.ts` / `useTerminalNotification.ts` | 各自一个真实世界的坑 |
| 布局 | `layout/node.ts` / `yoga.ts` / `geometry.ts` / `engine.ts` | 52 个方法的适配层，一半是样板 |

**71 `optimizer` 里 `cursorMove` 可以相加、`cursorTo` 只能留最后一条，为什么 `styleStr` 一条都不能丢？**

区别在操作的性质：
- `cursorMove` 是**相对**（`CSI n A`）→ 两次相对移动等于一次合位移，可以相加
- `cursorTo` 是**绝对**（`CSI n G`）→ 后者直接覆盖前者，前面那条白写
- `styleStr` 是**转移**（transition，由 `diffAnsiCodes(from, to)` 算出），不是设置

最后一条的后果很具体：`[ESC[49m, ESC[2m]` 里第一条是「取消背景色」，第二条是「降低亮度」。看上去第二条跟背景无关，丢了应该没事 —— 但背景色会一直保持到下一个 `ESC[2J` / `ESC[2K`，而**这两个操作在有背景色的终端上会用当前背景色填充新区域**（BCE, Background Color Erase）。于是整片屏幕被涂成上一个格子的背景色。

所以「这条转移不改变我关心的位」不能作为丢弃理由 —— **下一条转移不负责复位任何东西**。同一个「相邻合并」，三条规则三种动作（相加 / 取后者 / 拼接），区别全在相对、绝对、增量。

**72 没有任何超时，怎么知道终端「不支持」某个查询？**

用一条**必定有答复**的查询当栅栏。DA1（`CSI c`）从 VT100 就有，所有终端都会答，而且终端**按接收顺序答复**。于是每一批查询后面跟一条 DA1：

- 你的答复在 DA1 之前到 → 支持
- DA1 先到 → 不支持（你的问题被静默忽略了）

这个技巧只依赖「按序答复」这一个 VT 基本约定，比任何能力探测都可靠。`flush()` 的语义因此是双重的：等 DA1 到达，同时把哨兵之前所有还没答的查询判为 `undefined`。

两处顺序不能换：`onResponse` 必须**先找精确匹配、再找哨兵**（否则显式 `send(da1())` 的答复会被哨兵抢走）；哨兵只 drain **到第一个** 为止（否则并发批次会互相判死）。

**73 tmux 明明会把 BSU/ESU 转发给外层终端，为什么反而要排除它？**

因为**中间层破坏了原子性**。tmux 会把每个字节都解析一遍，但它自己也在攒缓冲、按块刷新 —— 于是「开始同步」和「结束同步」之间插进了 tmux 的刷新时机。原子性已经在那一层断掉了，再发这两个序列只是白费 16 字节加解析开销。

这条规则可推广：**判断「上游支持某能力」时，要问的是「整条路径上每个中间层是否都不破坏它」**，而不是「最终端支持吗」。

同一份文件里的另外两种态度正好对照：`isProgressReportingAvailable` 用的是**黑名单**（排除 Windows Terminal，因为它把 OSC 9;4 当通知——语义不同），`supportsExtendedKeys` 用的是**白名单 + 事故记忆**（注释里明写「我们曾经无条件开启，结果有些终端认真执行了 enable 并发出解析不了的码点」）。

**74 `getComputedWidth()` 为什么会比 `getComputedHeight()` 对应的宽度更宽？**

yoga 测量叶子节点是**两趟**：`AtMost` 趟问「你至少要多宽」→ 决定 width；`Exactly` 趟给确定宽度问「你多高」→ 决定 height。于是 `getComputedWidth()` 反映的是宽的那一趟，`getComputedHeight()` 反映的是窄的那一趟。

什么时候真的会发生：**column 方向的 flex 父容器里**。width 是 cross axis，而 `align-items: stretch` 从不会把子节点缩到 intrinsic 尺寸以下 —— 标准 CSS 行为，不是 bug。

后果：按这个宽度折行，折出来的行数比 height 多 → 溢出。所以 `render-node-to-output.ts:568` 必须再钳一次：`Math.min(getMaxWidth(yogaNode), output.width - x)`。

**75 `bidi.ts` 为什么在 macOS 上反而要跳过（而 Windows 上要自己排）？**

因为 macOS 的终端（Terminal.app、iTerm2）**已经实现了 UBA**。你再排一遍就是**双重反转**，RTL 文本会变回错的。

所以判据是「只在没能力的平台自己补」：`win32 || WT_SESSION || TERM_PROGRAM=vscode`。最后一项容易漏 —— VS Code 的终端是 xterm.js，一个 JS 实现的终端模拟器，不实现 bidi。

这份实现里最危险的一行是「levels 数组也要跟着反转」：只反转字符不反转 levels，下一轮（层级更低的）会用错位的 levels 判断连续段 —— 一部分该翻的没翻、一部分不该翻的翻了。而且**不报错**，看起来像字体问题。

**76 这一批里有几个「零读者」的东西？怎么在十分钟内查出来？**

四个。判定方法只有一个：**每个导出符号 grep 一次，只数「定义处以外」的命中**。

| 符号 | 位置 | 为什么读代码的人会被误导 |
| --- | --- | --- |
| `shouldClearScreen()` | `frame.ts:105` | 名字像是清屏决策的入口，实际判据已内联到 `log-update.ts` 四处（更精细，要看 `cursor.y`） |
| `clearTerminal`（常量） | `clearTerminal.ts:74` | 真正被用的是同文件的 `getClearTerminalSequence()` 函数 |
| `renderToScreen()` | `render-to-screen.ts:59` | 注释说「Used for search」，但搜索路径只调 `scanPositions` 扫主屏 |
| `edges` / `addEdges` / `ZERO_EDGES` / `resolveEdges` / `clampRect` / `withinBounds` | `layout/geometry.ts` | 几何工具箱，只有 `unionRect` 和 `clamp` 活着 |

`terminal-querier.ts` 是第五种情况，值得单独说：它的**框架是活的**（哨兵机制确实在服务 `xtversion`），但七个查询构造器里六个零读者。`decrqm` / `da1` / `da2` / `kittyKeyboard` / `cursorPosition` / `oscColor` 全都没人调 —— 包括本该最合适的 `kittyKeyboard`（它比 `supportsExtendedKeys` 的环境变量白名单精确得多）。

**一处注释漂移**：`renderer.ts:152` 说 `viewport.height = terminalRows + 1` 是为了绕开 `shouldClearScreen()` 的 `screen.height >= viewport.height` 检查。但那个函数已经零读者了 —— 实际生效的是 `log-update.ts` 第 205 / 222 行的同形判断。**代码有效、理由正确、指针失效**。读代码时如果发现注释引用的符号查不到调用方，先别怀疑自己。

### 这一批还有一个「设计水位」的观察

`terminal.ts` 是整份 `ink/` 里注释质量最高的文件之一 —— 它把三种探测态度（白名单 / 黑名单+例外 / 问了才知道）摆在同一个文件里，而分界线是**错的代价**：

- 探错「支持同步输出」→ 一帧闪光
- 探错「支持进度上报」→ 弹一条通知
- 探错「扩展按键」→ 用户的按键被吃

所以最后一条用的是最保守的白名单，而且注释里带着事故记录。这种「同一个人在同一份文件里对三件事采取三种保守程度」的写法，比任何设计文档都清楚。

## `ink/` 的交互原语读完了吗？七道自测题

这一批是 `ink/` 的最后 40 个文件：`events/` 十个、`hooks/` 十二个、`components/` 十八个，**3,717 行原文（批注版 5,340 行）、177 处锚点**。

到这里 `src/ink/` **整个目录清零**：96 个文件、19,842 行，一份不剩。

它们回答的是「渲染器之上那一层」—— 前面二十几批讲的是「怎么把一个字符画到格子里」，这批讲的是「一次按键怎么落到某个组件上」「光标该停在哪一列」「滚动为什么不能走 React」。

| 分组 | 文件 | 它回答的问题 |
| --- | --- | --- |
| 事件基座 | `events/event.ts` / `terminal-event.ts` | 两套继承线的根；传播控制的三个标志 |
| 派发 | `events/dispatcher.ts` / `emitter.ts` | 一趟收两个方向；React 优先级从哪读 |
| 事件类 | `input-event.ts` / `keyboard-event.ts` / `click-event.ts` / `focus-event.ts` / `terminal-focus-event.ts` | 按键怎么翻译；点击为什么不算 DOM 事件 |
| 事件表 | `events/event-handlers.ts` | prop 名与事件类型的双向映射（含两处缺口） |
| 输入 | `components/App.tsx`（658 行） | stdin 的唯一拥有者：模式宣示、批处理、鼠标状态机 |
| 组件 | `Box.tsx` / `Text.tsx` / `ScrollBox.tsx` / `AlternateScreen.tsx` / `Button.tsx` | 布局容器、文本叶子、命令式滚动、全屏、交互原语 |
| hooks | `use-input` / `use-selection` / `use-declared-cursor` / `use-terminal-viewport` / `use-animation-frame` / `use-interval` | 订阅的时机、槽位的稳定性、可见性判定 |
| 杂项 | `Link` / `NoSelect` / `RawAnsi` / `Newline` / `Spacer` / 五个 context | 各自一个终端特有的坑 |

**77 一次按键为什么会同时触发 `useInput` 和 `onKeyDown`？两套事件继承线的根分别在哪？**

`App.tsx` 的 `processKeysInBatch` 对每个按键做两件事（第 506-510 行）：`emitter.emit('input', new InputEvent(item))` 走旧路径，`dispatchKeyboardEvent(item)` 走新路径。**同一个组件如果既用 `useInput` 又挂 `onKeyDown`，会收到两次。**

不是过渡期的疏忽，是刻意的兼容层：`useInput` 是公开 API，`onKeyDown` 是 DOM 风格的新接口。

两套继承线：

- `Event`（11 行，只有「能不能喊停」）→ `InputEvent` / `ClickEvent` / `TerminalFocusEvent`
- `TerminalEvent`（DOM 风格：target / phase / bubbles）→ `KeyboardEvent` / `FocusEvent`

`terminal-event.ts` 的类注释自己承认是半迁移：「so existing event types can migrate later」。所以 `onClick` 的冒泡是 `hit-test.ts` 里手写的 while 循环，和 `onKeyDown` 的 Dispatcher 完全不共享实现 —— 行为看着一样，代码毫无关系。

**78 `App.tsx` 里「启用扩展按键」受门控、「禁用」却不受门控 —— 为什么这是个坑？**

因为 `DISABLE_KITTY_KEYBOARD` 是 `CSI < u`，语义是 **pop**（从键盘协议栈弹一层），不是「关掉」。而 `ENABLE_KITTY_KEYBOARD` 是 `CSI > 1 u`，是 **push**。

于是：门控判成 false（白名单漏了某个终端）但我们仍然 pop 了 —— 弹出的是**外层**（用户的 shell 或上层应用）push 的那一层。症状出现在「退出 Claude Code 之后，另一个程序里键盘行为变了」，极难归因。

正确写法本该是「记录有没有 push 过」。当前不是。这一对必须对照着读，单看任何一行都合理。

**79 50ms 的 flush 定时器为什么会把机会让给 `readable`？全文件还有哪两处在「用时间猜状态」？**

因为 Node 的事件循环里 **timers 阶段先于 poll 阶段**。一次重渲染阻塞超过 50ms 时，续块明明已经在缓冲区里，定时器却先跑 —— 于是完整的鼠标序列被劈成「一个假的 Esc + 一截尾巴」。

补丁是问一句事实：`stdin.readableLength > 0` 就**重新装定时器**，让下一轮 `readable` 拿到它。比把超时调大可靠（调大只让另一个方向的延迟变差）。

三处「用时间猜状态」：

| 判据 | 值 | 猜的是什么 | 猜错的代价 |
| --- | --- | --- | --- |
| `NORMAL_TIMEOUT` | 50ms | 转义序列还有没有续块 | 序列被劈开（已用 readableLength 补） |
| `PASTE_TIMEOUT` | 500ms | 粘贴是不是还在继续 | 长粘贴被切成几段 |
| `STDIN_RESUME_GAP_MS` | 5000ms | tmux/ssh 是不是断过 | 重连后鼠标失效 |

第三个最无奈：tmux detach 再 attach、ssh 重连、合盖唤醒，终端都会重置 DEC 私有模式，但**没有任何信号到达进程**。唯一可观测的就是「安静了多久」。

**80 `bold` 和 `dim` 为什么要在类型层面互斥？**

因为 **SGR 22 一次取消两者**（"normal intensity"，一对二）。终端里没有「只关掉 dim、保留 bold」的办法 —— 这和 `termio/sgr.ts` 里那条「`22` 一对二」是同一件事，只是那边在解析时承认限制，这边在构造时就禁止。

实现手法值得记：`bold?: never` 那一支是关键。写 `bold?: boolean; dim?: boolean` 是拦不住的。

**81 `ScrollBox` 为什么绕过 React？绕过之后靠什么保证不出错？**

滚轮一次拨动几十个事件，走 state 就是几十次重渲染 + 完整 yoga 布局。所以直接改 DOM 节点上的 `scrollTop` → 标脏 → 调根节点的节流渲染，`reconciler` 一次都不跑。

代价是**没有 reducer 帮忙保证一致性**，于是有四个字段必须手工协调：

- `scrollTop` / `pendingScrollDelta`（累加器） / `scrollAnchor`（延迟读取的寻位） / `stickyScroll`（粘底）

`scrollTo` 要一次清掉另外三个，`scrollBy` 要清掉 anchor 但累加 delta。少清任何一个都会打架：比如滚轮累加时调 `scrollTo`，累加量会在渲染时又把它推开。

还有一个细节：`scrollMutated` 里用 `queueMicrotask` 合并 —— 因为 `scheduleRenderFrom` 有自己的 leading edge，每个事件都直接调的话，第一个事件就渲染了「中途状态」。

**82 这一批有几处「零读者的扩展点」？为什么会有这么多？**

三处，全是同一类：

| 位置 | 状态 |
| --- | --- |
| `terminal-event.ts` 的 `_prepareForTarget` | **零覆写**，但 Dispatcher 每个监听者都调一次 |
| `dispatcher.ts` 的 `dispatchContinuous` | 零调用；连带 `ContinuousEventPriority` 分支够不着 |
| `dispatcher.ts` 的 `getEventPriority` | 表里 7 行只有 keydown / focus / blur 能走到（click 走 hit-test 手写冒泡，paste 的事件类缺失，scroll / resize / mousemove 根本没有代码构造这类事件） |

共同点：**基础设施先建好，需求从旁边绕过去了**。`_prepareForTarget` 本想解决「点击坐标要按 handler 重算」，最后在 `hit-test.ts` 的循环里顺手做了；`dispatchContinuous` 本想给滚轮用，最后滚轮被 `parse-keypress` 当成按键处理了。

查法还是那一条：每个导出符号 grep 一次，只数「定义处以外」的命中。

**83 鼠标的 release 丢了，为什么要三个恢复点？一个不够因为谁？**

三个恢复点覆盖「用户去哪了」的三种情况：

1. **失焦**（`FOCUS_OUT`）—— 切到别的应用了
2. **无按钮移动**（mode-1003）—— 松在窗口外又回来了
3. **新的按下**（mode-1002）—— 老终端没有无按钮移动

一个不够是因为 **tmux 默认不转发焦点事件**（要 `focus-events on`），第 1 个在 tmux 里直接失效，第 2 个才是主力。而没有 release 的后果很具体：`isDragging` 卡在 true，拖选不结束，拖选滚动的定时器一直跑到边界。

### 顺带挖出来的两个「源码不完整」的证据

**一、`events/event-handlers.ts` 的两个 import 指向空气。**

第 4、5 行引用 `./paste-event.js` 与 `./resize-event.js`，但 `events/` 目录下只有十个文件，这两个**不存在**。`import type` 编译后被抹掉，所以运行时不报错，只有 `tsc` 会报 "Cannot find module"。

这是「还原过程丢了东西」的直接证据 —— 这份源码是从打包产物 + sourcemap 反推的，这两个模块要么被内联进别的 chunk 没被单独还原，要么真的没了。后果是 `onPaste` / `onResize` 有 prop 名、有映射表条目，但没有对应的事件类；而且 Dispatcher 实际只派发 keydown/focus/blur，就算补回来也没人构造它。

**二、`useHasSelection` 直接把裸方法传给了 `useSyncExternalStore`。**

`ink.hasTextSelection` 和 `ink.subscribeToSelectionChange` 在 `ink.tsx` 里是**原型方法**（`hasTextSelection(): boolean {`，不是箭头函数类字段），而 React 调 `getSnapshot()` 时没有接收者 —— 严格模式下读 `this.selection` 会抛错。

同一份文件第 71-84 行，作者对每个方法都包了一层箭头（`() => ink.hasTextSelection()`），**唯独这里没包**。是漏了，还是 `Ink` 的方法在实际构建里被绑定过（源码看不出这一点），光读源码无法判定 —— 但「同文件里两种写法并存」本身就是信号。

### 这一批还有一个观察：注释密度和坑的密度成正比

三个文件放一起看很有意思：

- `ScrollBox.tsx`：12 个方法的接口，8 个带多行说明，每一条都在解释一个踩过的坑（`scrollToElement` 为什么不能烘焙数字、`getFreshScrollHeight` 为什么需要「新鲜」版本）
- `terminal-event.ts` / `dispatcher.ts`：注释在解释「为什么和浏览器默认值相反」（`bubbles` 默认 true）
- `App.tsx`：注释里带具体数字（44 次重渲染、1402ms 帧间隔、85+32='u' 的坐标巧合）

反过来说：**注释最少的文件（`use-app.ts` / `Spacer.tsx`）恰好是没有坑的文件**。读代码时这是一个可用的信号 —— 一个 200 行的文件如果注释寥寥，通常不是「作者不爱写注释」，是「这段代码不需要解释」。

## `components/` 的消息渲染主链读完了吗？七道自测题

`src/ink/` 清零之后，`components/` 是这个仓库剩下最大的一块 —— 实测 **389 个文件、81,550 行**（不是之前估的「4.2 万行」，那个数字错了两倍，见本节末尾）。它不属于任何一条主干，是「产品逻辑长在渲染器上」的那一层。

这一批挑了最架构性的四份：**消息从数组变成一行的完整路径**。

| 文件 | 行数 | 它回答的问题 |
| --- | --- | --- |
| `Messages.tsx` | 834 | 七道工序：规范化 → 切边界 → 重排 → 过滤 → 分组 → 折叠 → 切片 |
| `MessageRow.tsx` | 383 | 这一行**以后还会不会变**（决定能不能推上 scrollback） |
| `Message.tsx` | 627 | 按消息类型 / 块类型两次分发到十四个渲染组件 |
| `messageActions.tsx` | 450 | 键盘光标：哪些行值得停、每个键做什么、底部状态条 |

**共 2,294 行原文（批注版 3,619 行）、119 处锚点。**

**84 `MessageRow` 的比较器为什么要算一个布尔「我是不是最新那条 bash 输出」，而不是直接比 `latestBashOutputUUID`？**

因为直接比字符串，会让**所有行**在这一项上失配：最新 bash 从 A 换成 B 时，2800 行的 `latestBashOutputUUID` prop 都从 A 变成了 B。

化简成布尔之后，只有 A 和 B 两行的判定结果发生变化，其余 2798 行的 `prevIsLatestBash === nextIsLatestBash` 成立，继续往下走。

同一个手法在这一批里出现三次：`lastThinkingBlockId` 也是先过一道 `hasThinkingContent(next.message)` 的门，才允许它打穿 memo。**规律是：全局值变化时，先把它折成本地判据，再比较。**

**85 `Messages.tsx` 里有一个真 bug，`Date.now()` 用错了地方 —— 它是什么？**

`isStreamingThinkingVisible` 的 useMemo 依赖是 `[streamingThinking]`，但函数体里读了 `Date.now()`：

```
Date.now() - streamingThinking.streamingEndedAt < 30000
```

只要 `streamingThinking` 的引用不变，这个 memo 就不重算，**30 秒的窗口永远不会自己过期**。

为什么平时看不出来：流式期间 Messages 几乎每帧都在重渲染（`streamingText` 在变），但那些重渲染不会让这个 useMemo 失效；而下一轮对话通常在 30 秒内就开始了，窗口根本没机会被观察到。

正确写法要么把「现在」做成一个 tick 状态，要么干脆不用 useMemo。**只要 useMemo 里读了 `Date.now()`，它就是一个会被缓存的时钟。**

**86 为什么不能用 `slice(-200)` 截断？修复之后为什么锚点要同时存 uuid 和 index？**

三种切法都试过，注释里记了三次事故编号：

| 方案 | 怎么坏的 |
| --- | --- |
| `slice(-200)` | 每追加一条就从头部掉一条 → 屏幕内容整体上移 → 每轮一次全量重置（CC-941） |
| 量化到 50 条一档 | 压缩和折叠重组也会改变 `collapsed.length` 而**不新增消息**，仍在挪（CC-1154） |
| UUID 锚点 | 只在真的超过 CAP+STEP 时才前进（CC-1174） |

而 uuid 本身也不稳定：`collapseHookSummaries` 用组里**第一条**的 uuid 当合并后的 uuid，而 `reorderMessagesInUI` 会随 tool result 到达重排 hook 的相邻关系，于是「哪条第一」会变、合并 uuid 跟着变。

所以 uuid 丢了就退回存下来的 index（clamp 过）。**优先用稳定标识，标识消失时用最后已知位置兜底，且兜底绝不倒退到 0** —— 退到 0 会让渲染窗口从 ~200 条跳到全部历史，屏幕上那些已经画出去的「进行中」徽标再也不会被更新。

**87 `MessageActionsSelectedContext.Provider` 放在 `MessageRow` 外面，可是 memo 会 bail out —— 内部组件怎么还能拿到新值？**

这是 React context 最容易被误解的一点：**memo 拦住的是 prop 驱动的重渲染，拦不住 context 传播。**

三步走：

1. Provider 的 value 变 → Provider 重渲染 → 新的 row 元素传给 MessageRow
2. MessageRow 的 memo 比较器发现 `message` 引用没变 → bail out，组件函数**不执行**
3. 但 React 的 context 更新会**穿透** bail out 的子树，直接通知那些调了 `useContext` 的组件

所以「跳过重渲染」和「拿到新值」可以同时成立。这就是注释里 "only 2 rows re-render" 的全部机制 —— 只有真正调了 `useSelectedMessageBg` 的组件更新，其余整行一个字都不重算。

如果把这个状态当 prop 传，就得加进 memo 比较器，2800 行每行比一次。

**88 `MESSAGE_ACTIONS` 里有两条动作的 key 都叫 `enter`，为什么不出问题？什么时候会出问题？**

因为两条的 `types` 没有交集：一条管 `grouped_tool_use / collapsed_read_search / attachment / system`（翻转展开），一条管 `user`（进入编辑）。`isApplicable` 先按类型过滤，所以任何时候最多一条匹配。

`useMessageActions` 里还有个 `new Set(MESSAGE_ACTIONS.map(a => a.key))` 去重 —— 不去重的话 `h['messageActions:enter']` 会被赋值两次，后一次覆盖前一次。当前**恰好无害**，因为两条的 handler 体完全一样（都是 `find(a => a.key === key && isApplicable(a, c))`）。

会出问题的地方在 `MessageActionsBar`：它用 `key={a_0.key}` 渲染。如果将来加了两条同 key 且 types 有交集的动作，React 会报 duplicate key，症状是**其中一个的提示不显示**。

**89 `Message.tsx` 的 switch 为什么没有兜底 default？漏了类型会怎样？**

外层 switch 覆盖了 `RenderableMessage` 的全部六种类型（`progress` 在上游 `Messages.tsx` 就被过滤掉了）。TypeScript 能验证这种穷尽性，但**运行时没有兜底** —— 真漏了会返回 `undefined`，React 报「渲染返回了 undefined」。

内层那个 `AssistantMessageBlock` 的 switch **有** default，而且它调 `logError`。这个差异是有意的：

- 外层是**我们自己定义的类型**，穷尽性可以靠类型系统保证
- 内层是**API 返回的块类型**，服务端随时会加新的，必须能兜住

判据可以写成：**类型定义在自己手里的，靠编译器；类型定义在协议里的，靠运行时兜底。**

**90 同一个判据在两个文件里各写了一遍 —— 这是这一批最值得警惕的结构**

有两组：

| 判据 | 一处 | 另一处 |
| --- | --- | --- |
| collapsed 组永不静态 | `Messages.tsx` 的 `shouldRenderStatically` 返回 false | `MessageRow.tsx` 的比较器里显式 return false |
| 「是不是最新 bash」 | `Message.tsx` 的 `areMessagePropsEqual` | `MessageRow.tsx` 的 `areMessageRowPropsEqual` |

它们必须**同时**成立才有意义：判成静态（推上 scrollback）但 memo 又允许跳过重渲染 → 时态永远停在 "Reading…"，没有任何东西会再重渲染它。

这类「一个不变量，两处表达」的代码，改动时最容易只改一处。而且症状不是崩溃，是**某些行的内容再也不更新** —— 极难定位。

### 这一批的三个方法论收获

**一、React Compiler 的产物怎么读（第三次总结，这次是完整版）**

`_c(64)` 建 64 个槽，每个 `if ($[n] !== x)` 是「上次算的一样就复用」。读法是：**删掉所有 `$[n]` 的赋值和读取，只看 `if` 条件里的真实变量，以及 else 分支里 `tX = $[M]` 对应回哪个原始表达式**。

`MessageRow` 第 117-128 行那段，还原之后就是一行：

```
isActiveCollapsedGroup = isCollapsed &&
  (hasAnyToolInProgress(msg, inProgressToolUseIDs) || (isLoading && !hasContentAfter))
```

另外 `Symbol.for("react.memo_cache_sentinel")` 作初值的槽是**永久缓存**（从不失效），用来存纯静态的 JSX。

**二、「按行展开成标量」不只是可读性问题**

`hasContentAfterIndex` 的注释给了一个数字：把 `renderableMessages` 数组当 prop 传给每一行，React Compiler 会把它钉在 fiber 的 memoCache 里，7 轮对话累计 1-2MB —— 而这是**每行一份**。

所以「传布尔而不是传数组」在这套代码里是内存决策，不只是 API 整洁。

**三、索引里的数字错了两倍，这是第四次**

之前几轮一直写「`src/components/` 4.2 万行」，实测是 **81,550 行、389 个文件**。错因是早期只 `ls` 了根目录 113 个文件（24,266 行），把子目录 23 个目录（5.7 万行）漏了。

这已经是第四次「既有数字是错的」（前三次：文件数 38→41、行数 4.97 万→3.89 万、锚点 829→2,010）。**报数一律脚本算，不引用上一轮的数字。**

## `PromptInput/` 读完了吗？九道自测题

`PromptInput/` 是 `components/` 里第一个**完整的子目录**（21 个文件，5,161 行），也是「按键 → 光标 → 文本 → 提交」这条链的另一半 —— 上一步读的 `Messages/Message/MessageRow` 管的是「文字怎么变成屏幕」，这一批管的是「按键怎么变成文字」。

| 文件 | 行数 | 它回答的问题 |
| --- | --- | --- |
| `PromptInput.tsx` | 2,338 | 输入框本体：六种角色挤在一个组件里 |
| `useSwarmBanner.ts` | 155 | 六种身份抢输入框上方那条横幅 |
| `PromptInputFooterLeftSide.tsx` | 516 | footer 左半边：十几种小药丸抢一行 |
| `Notifications.tsx` | 331 | footer 右半边：九个指示器竖着摞 |
| `PromptInputHelpMenu.tsx` | 357 | 三列快捷键表（一张被编译器展开成 99 个槽的声明） |
| `PromptInputFooterSuggestions.tsx` | 292 | 补全列表：一半代码是宽度算术 |
| `ShimmeredInput.tsx` | 142 | 彩虹流光：终端没有渐变，只能逐字符换色 |
| `PromptInputQueuedCommands.tsx` | 116 | 排队消息：伪造一条通知来复用渲染器 |
| `VoiceIndicator.tsx` | 136 | 语音三态 + 「为什么这里故意不做动画」 |
| `inputPaste.ts` / `useMaybeTruncateInput.ts` | 90 / 58 | 十万字符粘贴：截断只发生在显示侧 |
| `IssueFlagBanner.tsx` | 11 | 一个被构建工具删空的组件（读 bundle 的入门样本） |

**共 5,161 行原文（批注版 8,530 行）、235 处锚点。**

**91 `PromptInput.tsx` 为什么会有 2,338 行？它到底在承担几种职责？**

六种，而且是**没法拆**的六种：

| 职责 | 为什么必须在这里 |
| --- | --- |
| 文本框 | 光标、选区、多行、vim、粘贴 |
| 命令面板 | `/` 与 `@` 补全、参数提示 |
| 通知中心 | 十几种一次性提示（思考档位、模型切换、草稿提示…） |
| 导航器 | footer 药丸的四个方向、任务列表、队友切换 |
| 弹窗宿主 | 模型选择、快速打开、历史、任务、团队、Bridge |
| 提交总闸 | 十几个守卫决定「这次回车算不算提交」 |

根本原因在终端：**没有全局焦点系统**。输入框是唯一持续读 stdin 的组件，所有键都要先经过它；所有弹窗也得在它这里「让路」。所以「拆成小模块」在这里不成立 —— 拆出去的部分仍然要回到这里注册按键。

**判据：一个组件之所以巨大，是因为它处在「事件总入口」的位置，而不是因为作者不会拆。**

**92 ESC 在这个文件里有几种含义？它们靠什么共存？**

六种，按优先级：

1. 有推测在执行 → 中止推测
2. `/btw` 侧问题在显示 → 收起侧问题
3. 帮助菜单开着 → 关帮助
4. footer 有选中 → **让路**给 Footer 上下文的键位（`footer:clearSelection`）
5. 队列里有可编辑命令 → 捞回来编辑
6. 有消息 + 输入为空 + 没在加载 → 双击打开消息选择器

共存靠两点：**条件互斥**（每个条件对应一个明确模式）+ **严格的判断顺序**（先命中的赢）。

第 4 条是「让路」而不是「处理」：那里只写了一个 `return`，把键留给别处注册的处理器。**在终端 UI 里，「不处理」也是一条必须写在正确位置的逻辑** —— 少了这个 return，用户想取消选中，结果输入框里被塞进一条排队命令。

（第 7 种「加载中取消请求」不在这个文件里，由 `CancelRequestHandler` 在别的上下文处理。）

**93 `onSubmit` 开头为什么要 `store.getState()`，而不是用闭包里的值？**

因为 `footer:openSelected` 的处理是「先 `selectFooterItem(null)`，再 `onSubmit()`」，两步在**同一个 tick** 里。React 还没重渲染，闭包里的 `footerItemSelected` 还是旧值 true —— 用它会直接把这次回车吞掉。

命令式读一次就能拿到最新值。但注意它还**重跑了一遍派生判断**：

```
if (state.footerSelection && footerItems.includes(state.footerSelection)) return
```

因为 store 里的值可能是脏的（选中的药丸已经消失）。**读最新值 + 用同一判据重算**，两件事缺一不可：只读不重算会误吞回车，只重算不读会漏掉同一 tick 的变更。

**94 「选中了 footer 药丸」有三个版本的状态，各自解决什么？**

| 状态 | 存在哪 | 职责 |
| --- | --- | --- |
| `rawFooterSelection` | AppState | 唯一的真值 |
| `footerItemSelected` | 渲染期派生 | **当帧就正确**（药丸消失 → 立刻变 null） |
| 清理 effect | `useEffect` | **防止诈尸**（把 raw 也清掉） |

只用派生值：raw 会一直是脏的，药丸重新出现时焦点会凭空跳回去（注释里叫 "resurrect"）。
只用 raw：药丸消失的那一帧，UI 还显示着一个不存在的高亮。

**「立刻正确」和「迟早清理」是两个需求，需要两个状态。**

**95 React Compiler 把 `useEffect` 的依赖数组也算成了常量 —— 这会造成什么真实后果？**

`SandboxPromptFooterHint.tsx` 里 `useEffect(…, [])` 被编译成缓存好的 `t1 = []`，于是 effect 只跑一次。而它的函数体第一行是：

```
if (!SandboxManager.isSandboxingEnabled()) return
```

**这个判断只在挂载那一刻做一次。** 用户在会话中途用 `/sandbox` 打开沙箱，这个组件不会去订阅违规事件 —— 订阅是在「当时沙箱已开」的前提下建立的。

但渲染期（第 48 行）还有一个同样的判断，每次渲染都重新读。所以「沙箱关闭后提示消失」是灵的，「沙箱中途打开后开始计数」是不灵的。**两处读同一个全局值，时机不同，行为就不同。**

这是读编译产物的一个具体收益：`[]` 这个依赖数组是**结论**而不是**输入**，它告诉你作者假设了什么不变。

**96 图片胶囊为什么「反色块就是光标」，而不是额外画一个光标？**

`[Image #1]` 是不可分割的对象。光标可以停在它的**左边界**（`chip.start`）或**右边界**（`chip.end`），两者语义不同：

- 停在 start → 胶囊反色 = 「已选中，退格删掉整块」
- 停在 end → 正常光标 = 「在它后面，可以继续打字」

所以 `showCursor` 的条件里有一项是 `!cursorAtImageChip` —— 此时光标已经由反色块表达了，再画一根竖线就是两个光标。

配套还有两个机制：方向键/点击把光标送进胶囊**内部**时，吸附到更近的边界（第 594 行）；文字里的引用消失后，`pastedContents` 里的孤儿图片被清理（第 1189 行）。三处合起来才构成「对象编辑」的完整语义。

**97 粘贴 20 万字符时，数据去哪了？为什么说「截断只发生在显示侧」？**

`inputPaste.ts` 把中间那段挖出来，存进 `pastedContents` 当作一条「粘贴内容」，文本里只留一个占位符：

```
[...Truncated text #3 +2048 lines...]
```

于是三个已有机制零改动就复用了：渲染时按占位符展开、提交时还原全文、删除占位符时清理附件。

两个细节值得记：
- 它的格式刻意和普通长文本粘贴的占位符同构（`[...Pasted text #3 +12 lines]`），所以解析端不用改
- `slice(start, -end)` 的首尾各 500 字是对称切的，和原文严丝合缝 —— **无损挖洞**

而「只截一次」靠的是一个纯哨兵布尔（`hasAppliedTruncationToInput`），不是比较长度：截断结果本身仍然超长，比较长度会导致每渲染一次吃一次内容。

**98 读一个「已经被构建工具删空的组件」，能学到什么？**

`IssueFlagBanner.tsx` 只剩：

```
export function IssueFlagBanner() { return null; }
```

但文件头还 import 着 `FLAG_ICON` / `Box` / `Text`，一个都没用。这个矛盾只有一种解释：**这里原本有 JSX，被条件折叠删掉了**。证据在那一行 base64 sourcemap 里（`sourcesContent` 就是原始源码）：

```
if ("external" !== 'ant') { return null }
return (<Box …>Something off with Claude?</Box>)
```

所以读 bundle 的正确顺序是：**先看代码 → 找矛盾（死 import、恒假条件）→ 去 sourcemap 里找真相**。

顺带产出一张「构建残留指纹表」，遇到就直接当死分支处理：

| 形态 | 含义 |
| --- | --- |
| `"external" === 'ant' && …` | 内部构建专属，对外恒假 |
| `"external" !== 'ant'`（折叠后只剩 return null） | 内部专属组件，对外被删空 |
| `false ? A : B` | feature 折叠后的三元残骸，恒取 B |
| `feature('X') ? useHook() : 常量` | 编译期开关包 hook（安全，但需要 biome-ignore） |

**99 同一个 `??` 操作符，默认值的选择能说明什么？**

这批里出现两次，方向相反：

| 位置 | 写法 | 含义 |
| --- | --- | --- |
| `PromptInputFooterLeftSide.isPrStatusEnabled` | `?? true` | 新增功能，默认让人看见 |
| `usePromptInputPlaceholder` | `?? 0` | 计数类，从零开始 |

`??` 只是语法，真正决定用户体验的是那个默认值。读配置类代码时，**「默认值是多少」往往比「读了什么」更重要** —— 它决定了绝大多数用户（从不改配置的人）实际看到什么。

### 输入框这一批的三个方法论收获

**一、`feature()` 是构建期常量，所以它不能出现在「会被共享的函数体」里**

`PromptInput.tsx` 里彩虹高亮的代码出现了四遍（ultrathink / ultraplan / ultrareview / buddy），每遍 12 行，只有触发器和开关不同。没有抽成函数，是因为抽出去之后 `feature()` 就折不动了 —— 函数体是共享的，无法为不同调用点生成不同产物。

这是「为构建工具让步，牺牲 DRY」的典型。看到重复代码先别急着重构，先确认它是不是被**打包期折叠**绑住了。

**二、「空实现」比「条件渲染」更省事，但要用对地方**

这一批里出现了三种空实现：

| 形态 | 用在哪 | 为什么 |
| --- | --- | --- |
| `() => null` 组件 | `VoiceIndicator`（功能关闭时） | 调用点可以无脑 `<X />`，判断收敛到 1 处 |
| `NO_OP_SUBSCRIBE` / `NULL` 常量 | `useSyncExternalStore` 的兜底 | hook 签名要求必传，且内联箭头会导致重复订阅 |
| `EMPTY_SET` / `EMPTY_LOOKUPS` 常量 | 传给 `Message` 的空集合 | 每次 `new Set()` 都会让 memo 失效 |

共同点：**把「没有」也变成一个稳定的值**。它同时解决两个问题 —— 调用点不用判空，引用保持不变。

**三、订阅的粒度由「值的变化频率」决定，不是由「代码整洁」决定**

`PromptInputFooter` 里五个 `useAppState` 各订阅一个标量字段，而不是一次性取一个对象。因为 selector 返回新对象时，`Object.is` 永远不等 → 每次都判定为变化 → 每次重渲染。

反过来，`SuggestionItemRow` 里每行都调 `useTerminalSize()`（N 个订阅），因为终端尺寸变化的频率极低，而一旦变化必然全屏重绘 —— 多几个订阅淹没在重绘里。

**订阅越细越好，前提是那个值变化得频繁；变化很少的值，粗粒度也无所谓。**

## `messages/` 读完了吗？十道自测题

`components/messages/` 是 `Message.tsx` 那两次 switch 的**落点** —— 上一步读的 `Messages/MessageRow/Message` 决定「哪条消息交给谁画」，这一批就是那些「谁」。**这个目录现在清零了**：41 个文件（33 个顶层 + `UserToolResultMessage/` 8 个）、6,055 行原文、批注版 9,595 行、**274 处锚点**。

| 文件 | 行数 | 它回答的问题 |
| --- | --- | --- |
| `SystemTextMessage.tsx` | 827 | 十几种系统消息挤在一个 if 链里，静音规则插在中间 |
| `AttachmentMessage.tsx` | 536 | 四十多个 case 的 switch，三十个是「一行」 |
| `CollapsedReadSearchContent.tsx` | 484 | 折叠组：五个最大计数器抗抖动 + 提示最短显示 700ms |
| `AssistantToolUseMessage.tsx` | 368 | 工具调用那一行：图标 / 主进度 / 排队补充三层 |
| `UserTextMessage.tsx` | 275 | 十七个 if，顺序即协议 |
| `AssistantTextMessage.tsx` | 270 | `switch (text)` —— 拿文案本身当判别键 |
| `PlanApprovalMessage.tsx` | 222 | 计划审批：四条 return 路径，拒绝态的末句是指令 |
| `UserTeammateMessage.tsx` | 206 | 队友消息：五级串联 try + 默认只显示摘要 |
| `HighlightedThinkingText.tsx` | 162 | 逐字符彩虹 + early return 被编译成什么样 |
| 其余 32 份 | 2,705 | 每个都是一条消息类型的完整画法 |

**100 终端里的「消息类型」为什么不是一个字段？这决定了分发代码长什么样。**

在 API 那一侧消息是结构化的（`{type: 'assistant', content: [...]}`）。但到了终端这一侧，很多「消息」其实是模型吐出来的**纯文本**，类型信息混在文本里 —— `<bash-stdout>…</bash-stdout>`、`<command-message>…`、`[Request interrupted by user]`。

于是「这条是什么」只能靠**对文本做字符串判断**得出：`startsWith('<bash-stdout')`、`includes('<user-memory-input>')`、`=== INTERRUPT_MESSAGE`、`extractTag(text, TICK_TAG)`。

后果一：分发只能写成**一条 if 链，顺序即协议**。`UserTextMessage.tsx` 顶层 17 个 if（第 39–238 行），删掉任意一条、或调换任意两条的相对位置，行为都可能变 —— 因为 `<local-command-stdout>` 同时也 startsWith `<local-command`，`<bash-input>` 里可能嵌着 `<bash-stdout>`。

后果二：另一个极端是 `AssistantTextMessage.tsx` 第 75 行的 `switch (text)` —— 它的 case 全是**整段文案常量**（`PROMPT_TOO_LONG_ERROR_MESSAGE` / `INVALID_API_KEY_ERROR_MESSAGE` / `TOKEN_REVOKED_ERROR_MESSAGE` …）。拿文案当判别键，只有在「这段文本完全由程序生成」时才成立。

判据：用 `includes`、`startsWith` 还是 `===`，**反映的是这段文本由谁生产** —— 用户手打的会混在句中（`includes`），程序整条生成的必在开头（`startsWith` / `===`）。

还有一条配套手法：**分发宽、渲染严**。判断用宽的 `includes`（宁可多认），真正解析用严的 `extractTag`（必须拿到完整标签）。只宽会误认，只严会漏认，两个都得有。

**101 怎么判定一段代码是死代码？`ThinkingMessage` 给了完整判据。**

本批确认了**源码里**的第一处死代码：`SystemTextMessage.tsx` 第 733 行的 `function ThinkingMessage(t0)`，全文件只有这一处出现（没有第二个同名导入，也没有任何调用点）。

判定要三条同时成立：

| 判据 | 本文件的证据 |
| --- | --- |
| 定义存在、零调用 | 第 733 行定义，grep 全文件只有 1 处 |
| 有替代路径抢先返回 | 第 122 行 `if (message.subtype === "thinking") { return null }` |
| 它的输入已被别处消费 | 第 69 行的 `away_summary` 分支 |

任意一条单独成立都不够：只有第一条，可能只是「还没接上」；只有第二条，可能另一个分支也走这里。**三条一起，才敢说「这段代码永远不会执行」。**

这也是上一批 `IssueFlagBanner` 的反面：那个是被**构建期删空**的（只剩 `return null`），这个是**源码里就没人调用**。两种死代码判据完全不同 —— 前者查恒假条件，后者查调用点。

**102 一条「静音规则」插在 if 链中间，会造成什么不对称？**

`SystemTextMessage.tsx` 第 200 行：

```ts
const isStopHookSummary = message.subtype === "stop_hook_summary";
if (!isStopHookSummary && !verbose && message.level === "info") return null;
```

这一行**之前**有 8 个 subtype 分支（`turn_duration` / `memory_saved` / `away_summary` / `agents_killed` / `thinking` / `bridge_status` / `scheduled_task_fire` / `permission_retry`），**之后**有 2 个（`api_error` / `stop_hook_summary`）。

结论和直觉相反：**前 8 种系统消息完全不受「静音」影响** —— 它们在静音判断之前就 return 了自己的渲染结果；后 2 种会被静音吞掉。

这不是 bug（`stop_hook_summary` 被显式排除了），但它是**「规则插入点决定覆盖面」**的教科书案例：同一行判断在 if 链里的位置，等价于一份「哪些类型归它管」的隐式声明，而这份声明没有任何地方写下来。

所以读长 if 链的正确顺序是：**先找这类全局规则，再数它前面有几条分支** —— 前面的分支就是这条规则的例外集。

**103 「打包器只做常量折叠，不做死代码消除」—— 这批有七处证据。**

grep 整个目录，`true &&` / `false &&` / `=== 'ant'` 一共七处：

| 位置 | 残留形态 | 什么意思 |
| --- | --- | --- |
| `AssistantToolUseMessage.tsx:59` | `false && isClassifierCheckingRaw && …` | 分类器检查整段关掉 |
| `SystemAPIErrorMessage.tsx:27` | `true && retryAttempt < 4` | 前面曾有过一个条件 |
| `AttachmentMessage.tsx:366` | `if (false && attachment.status === "killed")` | 整个分支关掉 |
| `AttachmentMessage.tsx:116` | `"external" === 'ant' && !isDemoEnv && …` | 内部构建专属提示，对外恒假 |
| `SystemTextMessage.tsx:287 / 419 / 423` | `false && totalDurationMs > 0 ? … : ""` | hook 耗时展示三处一起关 |

为什么 `false && x` 这种明显恒假的表达式没被删干净？因为**折叠和消除是两件事**：`false && x` 会被折叠成 `false`，但要不要把 `if (false) { … }` 这整个块删掉，取决于打包器开没开 DCE、以及 DCE 有没有命中这一处。这里显然没命中。

实用结论：**在 bundle 里看到恒真恒假的条件，不要当成混淆，当成「编译期开关的历史遗留」** —— 顺着它就能反推出内部构建和外部构建的差异。

**104 「case 标签不能被条件消除，if 块可以」—— 这句话为什么重要？**

`AttachmentMessage.tsx` 第 105 行的原文注释：

> skill_discovery rendered here (not in the switch) so the 'skill_discovery' string literal stays inside a feature()-guarded block. A case label can't be conditionally eliminated; an if-body can.

`skill_discovery` 本来应该和另外三十多个类型一样待在 switch 里，它被挪到 switch 外面、包进 `if (feature('EXPERIMENTAL_SKILL_SEARCH'))`，唯一理由就是**构建产物的纯净度**。

原因是：`case 'skill_discovery':` 里的那个字符串字面量会原样留在 bundle 里，**即使整个 case 分支都被 feature 关掉** —— 因为标签是语法骨架，不是可执行语句，DCE 能删语句、删不掉标签。而 `if (feature('X')) { if (type === 'skill_discovery') … }` 在 feature 折叠成 false 之后，整个 if 块连同里面的字符串一起消失。

这条约束很少被写下来：**凡是被 feature 门控的类型，都不能出现在 switch case 里。**

推论：看到某处「明明该用 switch 却写了一串 if」，先别嫌它不整齐 —— 可能每一处 if 都在保护一个字符字面量。

**105 React Compiler 把 early return 改写成了什么？**

`HighlightedThinkingText.tsx` 是本批最干净的教学样本。原始代码是一句早退：

```ts
if (triggers.length === 0) return <Text color="text">{text}</Text>
```

编译后变成：

```js
let t1;
if ($[15] !== pointerColor || $[16] !== text) {
  t1 = Symbol.for("react.early_return_sentinel");
  bb0: {
    const triggers = isUltrathinkEnabled() ? findThinkingTriggerPositions(text) : [];
    if (triggers.length === 0) { /* … */ t1 = t4; break bb0; }
    parts = [];
    /* 逐字符彩虹切片 */
  }
  $[15] = pointerColor; $[16] = text; $[17] = parts; $[18] = t1;
} else { parts = $[17]; t1 = $[18]; }
if (t1 !== Symbol.for("react.early_return_sentinel")) return t1;
```

三个要点：

- `bb0:` 是**带标签的块**，存在的唯一目的就是让 `break bb0` 能跳到块尾。
- 为什么不直接在 if 里 `return`？因为那会**跳过块外的缓存槽赋值**（`$[17] = parts`），下次进这个块时槽是脏的。
- 所以真正的返回被推迟到块外：`if (t1 !== sentinel) return t1`。哨兵值表示「这一趟没有早退」。

注意 `bb0` **不必然和早退有关**：`SystemTextMessage` 里同样形态是用来「给不同 subtype 的变量赋不同值」的。分辨方法：看 `break bb0` 之前最后一句是不是 `t1 = …`，以及块外那句 `if (… sentinel)` 在不在。

**106 `isQueued` 为什么写成两个否定？这种定义方式的风险是什么？**

`AssistantToolUseMessage.tsx` 第 113 行：

```ts
const isQueued = !inProgressToolUseIDs.has(param.id) && !isResolved
```

翻译：不在「进行中」集合里、也不在「已完成」集合里 —— 那就是排队中。

这么写是因为**数据源只提供了这两个集合**，根本没有地方查「queued 的 id」。第三个状态是由前两个状态的**缺席**定义的。

风险很具体：**将来新增第四个状态时，它会被自动算进 queued**。比如以后加一个 `cancelledIDs`，取消掉的工具调用会显示成「排队中」，而且不报错、不崩溃，只是显示错了。

所以否定式定义成立的正当条件是「状态空间确实封闭、且是二元补集」。这时该做的不是改成肯定式（做不到），而是**在注释里写明「这里假设只有两个集合」**，让下一个加状态的人看见。

**107 渲染期写 ref 一般是错的 —— 但这批有 5 处是正当的，判据是什么？**

`CollapsedReadSearchContent.tsx` 第 171–180 行，五个计数器全在渲染期写：

```ts
const maxReadCountRef = useRef(0);
…
maxReadCountRef.current = Math.max(maxReadCountRef.current, rawReadCount);
```

它维护的是一个**单调不变量**（只增不减），并且**只用于本次渲染的输出** —— 不参与调度、不同步状态、不在 effect 里读。这种「渲染期写 ref」不是副作用，是「记住历史」。

解决的场景很具体：折叠组的计数是**边加载边涨**的（先 3 个 read，再来 2 个）。直接用当前值，用户会看到「3 reads → 5 reads」跳变；用历史最大值，「5 reads」只出现一次，且计数永不回退。

对照组是**相反**的做法 —— `UserToolSuccessMessage.tsx` 第 45–51 行的一次性读 Map：

```ts
const [classifierRule] = React.useState(() => getClassifierApproval(toolUseID));
React.useEffect(() => { deleteClassifierApproval(toolUseID); }, []);
```

三个动作缺一不可：`useState` 的惰性初始化（只读一次）、空依赖（不随渲染重读）、**删除放在 effect 里而不是渲染期**（渲染期删会因 StrictMode 双调用或重渲染被删第二次）。

判据可以压成一句：**写 ref 是「记住历史」，读 Map 是「认领所有权」，两者都必须是幂等的** —— 否则重渲染就会改变行为。

**108 终端里的「截断」有三种切法，选哪种由约束决定。**

| 切法 | 位置 | 为什么是它 |
| --- | --- | --- |
| `stringWidth` 只测量不切 | `AssistantToolUseMessage.tsx:183` | 要算 `minWidth`，需要「占几列」而不是字符数 |
| `truncateToWidth(body, N)` | `UserChannelMessage.tsx:57` | 正文要显示，得按**显示宽度**切（汉字算 2） |
| `.slice(0, N)` | `UserResourceUpdateMessage.tsx:57`、`SystemAPIErrorMessage.tsx:66` | 只要一个提示，按码元切省事 |
| `.slice(0, head)` + `.slice(-tail)` | `UserPromptMessage.tsx:66` | 长提示**首尾都要留**（头看意图、尾看结论） |

关键区别：`slice` 切的是 **UTF-16 码元**，遇到 emoji 会切出半个字符；`truncateToWidth` 切的是**终端列**，保证不超宽。

所以「切法选错」的两种症状完全不同：用 `slice` 切要显示的正文 → 偶尔冒乱码方块；用宽度切 URI → 不会出错，只是没必要（URI 不参与对齐）。

`UserPromptMessage.tsx` 第 19–27 行还有一段值得单记的注释：`MAX_DISPLAY_CHARS = 10_000`，实际显示头 2,500 + 尾 2,500。原因是 `cat 11k-line-file | claude` 会产生**一条**消息，全屏 Ink 渲染器每帧都要为这个 `<Text>` 节点做 wrap 和输出，**实测造成 500ms+ 的按键延迟** —— 而 `React.memo` 救不了，因为它只跳过 React 渲染，跳过不了 Ink 的输出遍历。非全屏模式没这个问题，因为走的是 `<Static>`（打印完就不管了）。

**109 这批最值得记的一条方法论：读编译产物，先删掉所有 `$[n]`。**

41 个文件里三十多个是 React Compiler 产物：`_c(n)` 建槽、`if ($[i] !== x)` 复用、`t1/t2` 是编号不是语义名。直接读会淹死在缓存逻辑里。三步：

1. **先把 `$[n]` 的存取全部划掉**，只留「读哪个变量、调哪个函数、返回什么」。剩下的骨架就是原始代码。
2. **再看槽的分布**。槽不是随机撒的：正则构造、JSON 解析、对象字面量会建槽；纯字符串拼接不建；被 JSX 用到的值必建；只在一处判断里用的不建。**槽的位置 ≈ 成本 × 复用频率**。
3. **最后看依赖数组**。编译后 `t5 = [a, b]` 是个变量，而且它自己也可能被缓存 —— 上一批 `SandboxPromptFooterHint` 就栽在这里：`useEffect(…, [])` 被编成缓存好的 `t1 = []`，于是 effect 只跑一次。**依赖数组是缓存的对象**，这条反直觉但必须记住。

一个已知现象（**别当成规律**）：没有 JSX 的组件一定没有 `_c`（如 `GroupedToolUseContent`），但**有 JSX 也不一定有 `_c`**（如 `UserToolSuccessMessage`，只有一个 hook、简单到不需要缓存）。我在这条上推翻过自己两次，最后只记「已知现象」。

### 消息这一批的三个方法论收获

**一、终端里没有样式继承 —— 一个句子要变色，就必须拆节点**

`<Text>` 上的 `color` / `backgroundColor` 只作用于自己这个节点，**不会传给子节点**。所以「前半句灰、后半句红」不能靠嵌套，只能写成两个并列的 `<Text>`。这条约束解释了为什么这批文件里到处是 `{a}{b}{c}` 的兄弟节点，而不是嵌套结构。

**二、排版靠「占位」和几个约定俗成的 hack**

| hack | 位置 | 作用 |
| --- | --- | --- |
| `<Box minWidth={2} />` | 多处图标槽 | 没有图标时留出位置，让下一列对齐 |
| `<Box width={5} flexShrink={0}>` | `CollapsedReadSearchContent.tsx:467` | gutter 固定宽且不许压缩 |
| `width={999}` | `SystemTextMessage.tsx:817` | Ink 里「尽可能宽」的写法（`undefined` 会按内容收缩） |
| `overflow="hidden"` | `RejectedPlanMessage.tsx:23` | Windows Terminal 的补丁（否则边框会被顶开） |
| `dimColor={false}` | `AttachmentMessage.tsx:477` | chalk 的 dim + bold 有 bug（#290），显式关掉 |

**三、计数必须建立在「看得见的东西」上**

`nullRenderingAttachments.ts` 那 70 行只做一件事：把 34 个「渲染出来什么都没有」的 attachment 类型列出来，让 `Messages.tsx` 在**计数之前**滤掉它们（工单 CC-724）。否则 200 条渲染预算会被 `hook_success` / `todo_reminder` / `date_change` 这类看不见的条目吃掉，用户感觉「滚两下就到头了」。

这条原则值得推广：**凡是「上限 / 配额 / 预算」类的计数，先确认被数的东西用户能不能看见。** 数了看不见的东西，配额就等于缩水，而且没有任何报错。

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
                                                    │     └─ 十六个小件：名字归一化 / 通道六道闸 /
                                                    │        手机审批中继 / elicitation / 动态 header
                                                    └─ AgentTool → coordinator / fork / 普通子 agent
                                                          └─ runAgent（同一套 query 循环，换个身份跑）

（以上全是「业务逻辑」。它们最终都变成 React 元素，交给下面这一层画到屏幕上：）

```
src/ink/reconciler.ts（React 认得终端 DOM）→ dom.ts（树 + yoga + 测量）
                                          → ink.tsx（一帧九阶段：渲染 → diff → 写终端）
                                                └─ render-node-to-output.ts（树 → 操作队列）
                                                      └─ output.ts（操作队列 → 屏幕格子）
                                                            └─ screen.ts（打包格子 / blit / shift / 两帧 diff）
                                                                  └─ log-update.ts（差异 → 终端字节）

旁支（不在这条主线上，但每一步都用到）：
  styles.ts        盒子样式 → yoga setter（量的那一侧）
  colorize.ts      字样式 → SGR 转义序列（画的那一侧）
  stringWidth.ts   宽度 —— dom / output / wrap 三处都调它，是整条链的尺子
  Ansi.tsx         反方向：别人的 ANSI 字符串 → 我们的组件树
       └─ termio/tokenize.ts（切边界）→ parser.ts（拼成 action）
                └─ sgr.ts（样式参数）/ osc.ts（超链接）/ esc.ts / dec.ts
                        └─ ansi.ts（字节表）+ csi.ts（参数区间与生成）

输入侧（和上面整条链方向相反，字节从外面进来）：
  stdin → parse-keypress.ts（tokenize 的输入侧消费者，唯一开 x10Mouse 的地方）
              ├─ 终端应答 → terminal-querier（兑现查询 promise，不进业务）
              ├─ ParsedKey → input-event.ts → useInput / 文本输入
              └─ ParsedMouse → App.handleMouseEvent → hit-test.ts（坐标 → 节点）
                                                    └─ selection.ts（两本账：累积器 + virtual 行）
                                                          └─ applySelectionOverlay（只改 styleId，
                                                             让上面的 diff 自己发现）
```

**两个方向在这里合上**：输出侧把「一个汉字」写成两个 `int` 加一串 SGR；输入侧把「一次拖选」还原成屏幕坐标上的一个区间。中间那块共享的东西只有一样 —— `screen.ts` 的格子布局。所以选区的坐标能直接当渲染坐标用，不需要任何换算。

**再往上一层（第 9 步，`components/`）**，消息主链是这样：

```
messages 数组（服务端原始）
  └─ Messages.tsx  七道工序（规范化 → 切边界 → 重排 → 过滤 → 分组 → 折叠 → 切片）
        ├─ 大 useMemo    只管内容：27k 条 × 6 Maps + 4 趟 filter
        ├─ 小 useMemo    只管窗口：sliceStart / renderRange
        └─ 每行 → MessageRow.tsx   ← 只回答一个问题：这一行以后还会变吗
              ├─ shouldRenderStatically  → 能变吗（决定能否推上 scrollback）
              ├─ areMessageRowPropsEqual → 要重渲染吗
              └─ Message.tsx             两次 switch：消息类型 → 块类型
                    ├─ user      → UserTextMessage 十七个 if（顺序即协议）
                    │                ├─ <bash-stdout>   → UserBashOutputMessage
                    │                ├─ <bash-input>    → UserBashInputMessage
                    │                ├─ <command-*>     → UserCommandMessage
                    │                ├─ <local-command-*> → UserLocalCommandOutputMessage
                    │                ├─ <teammate-*>    → UserTeammateMessage
                    │                ├─ <task-notification> → TaskAssignmentMessage
                    │                └─ <mcp-*-update>  → UserResourceUpdateMessage
                    ├─ assistant → AssistantTextMessage（switch (text)：十一组文案常量）
                    │                ├─ thinking        → HighlightedThinkingText
                    │                └─ tool_use        → AssistantToolUseMessage
                    │                                        ├─ 进行中 → 主进度
                    │                                        ├─ 排队   → isQueued
                    │                                        └─ 完成   → UserToolResultMessage/
                    │                                                      ├─ 成功 / 出错 / 拒绝 / 取消
                    │                                                      └─ 计划被拒 / 工具被拒
                    ├─ system    → SystemTextMessage（十种 subtype，前八个绕过静音规则）
                    └─ attachment → AttachmentMessage（四十多个 case，三十个是「一行」）
                          └─ ink 的 Box / Text / RawAnsi / NoSelect
```

这张图的最后两层是这一批补的：**`Message.tsx` 的 switch 只是「分诊台」，真正决定一句话长什么样的是这四十一个文件**。而它们共同的约束只有一个 —— 输出目标是终端，没有样式继承、没有绝对定位、宽度要自己算。

中间那条分界很清楚：**`Messages` 管「显示哪些」，`MessageRow` 管「还会不会变」，`Message` 管「怎么画」，`messages/` 里的每个组件管「画成什么样」**。前三层各自有一个 memo、一个不变量；最后一层没有 memo，因为它只被前三层决定。

反方向（按键 → 文本 → 提交）是这一批补上的：

```
stdin → parse-keypress（字节 → ParsedKey）
  └─ useInput / TextInput（焦点、光标、选区、多行编辑）
        ├─ inputFilter           ← lazySpaceInputFilter（图片后补空格）
        ├─ onChange              ← 模式字符 ! / Tab→4 空格 / 撤销快照
        ├─ combinedHighlights    ← 九个触发器各算区间，按 priority 覆盖
        └─ onSubmit（总闸）
              ├─ 建议接受 / 推测注入（speculation）
              ├─ @名字 → 队友 mailbox（不进模型）
              ├─ getActiveAgentForInput → onAgentSubmit（发给正在看的 agent）
              └─ onSubmitProp → handlePromptSubmit（进主循环）
```

`PromptInput.tsx` 在这个方向上就是**唯一入口**：终端没有全局焦点，所有键必须先经过它，所有弹窗也得在它这里让路（`isModalOverlayActive` 是那个总闸）。这解释了这个文件为什么 2,338 行 —— 不是不会拆，是位置决定的。

**主干到此为止**。剩下的都是枝叶，不影响理解整体设计：

- [`src/ink/`](source/src/ink/) **整个目录已清零**：96 个文件、19,842 行，根目录 43 + `layout/` 4 + `termio/` 9 + `events/` 10 + `hooks/` 12 + `components/` 18。渲染器、样式层、转义解析、输入侧、交互原语，一条不缺
- [`src/services/mcp/`](source/src/services/mcp/) 十六个小件已全部批注完（见上一节），这条线现在没有未读角落了
- [`src/components/`](source/src/components/)（**8.2 万行，389 个文件**）—— 具体界面组件。上层的 React 组件，读它们主要是读产品逻辑，不是读架构。已批注 66 份：消息渲染主链四份（`Messages` / `MessageRow` / `Message` / `messageActions`，2,294 行）+ 输入框整个 `PromptInput/` 子目录 21 份（5,161 行）+ 消息体整个 `messages/` 子目录 41 份（6,055 行），剩 323 个文件、7 万行

到这里，**第 1 到第 8 步的主线全部走完，输入输出两个方向也闭合了，`ink/` 一个文件不剩，界面层的三条链（消息出来、按键进去、一条消息怎么画）也都通了**：213 个文件、68,501 行原文（批注版 112,528 行）、3,503 处锚点。从一条用户输入到它变成 API 请求、变成工具调用、变成子 agent 分工、变成一次 MCP 远端调用，最后变成一个汉字占两个 `int`、变成带 SGR 的字节写进终端 —— 反方向也从一次按键、一次拖选回到同一块屏幕缓冲；而 MCP 这条线上「连接之外的一切」（名字、闸、审批、表单、动态 header）也都补齐了，中间没有断点了。

我的建议是**现在停下来回头读一遍索引**。特别是三处「跨文件才能看懂」的地方，它们单独看都不显眼，串起来才是设计：

1. **缓存前缀稳定性** —— `prompts.ts` 的动态边界 → `claude.ts` 的 `deferred_tools_delta` → `AgentTool/prompt.ts` 把 agent 清单挪进 attachment → `microCompact` 宁可逻辑删除也不改本地字节。同一个手法出现四次。
2. **`needs-auth` 这个状态** —— `config.ts` 决定「允不允许连」→ `client.ts` 返回 `{type:'needs-auth'}` → `auth.ts` 的 `hasMcpDiscoveryButNoToken` 判断「跳过连接直接提示授权」。一个状态的定义和使用分在三个文件里。
3. **失败归因** —— `withRetry` 的 529 白名单、`compact.ts` 的 PTL 逃生舱、`auth.ts` 的 `failureStage` 游标，本质都是「先分清是哪一类失败，再决定怎么办」。三处用了三种不同的手法（白名单 / 专用错误类 / 里程碑布尔量）。

想继续的话，说模块名就行。剩下的方向按性价比排：

- **回头重读** —— 我推荐这个。九条线都闭合了，界面层三条链也通了，现在重读任何一处都比第一次清楚
- **`components/` 里其余的单点组件**（剩 323 个文件、7 万行）—— 每个都是「一段产品逻辑 + 一点渲染」，读起来快。适合按需挑：对权限弹窗感兴趣就读 `permissions/`，对 diff 显示感兴趣就读 `diff/`，想搞清「文件怎么被编辑」就读 `FileEdit*`
- **`src/tools/` 里没批注的** —— 主线那批只读了 `BashTool` 等核心几个，剩下的每个工具都是「一个 schema + 一段提示词 + 一段执行」，读起来快但收获也薄
- **`src/services/` 剩下的** —— 主要是 `analytics/`（埋点）与 `oauth/`，前者是「数据怎么上报」，后者和已读的 `mcp/auth.ts` 是同一套 OAuth 的另一半

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
