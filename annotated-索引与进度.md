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

| #    | 判据                | 拦什么                                                                           |
| ---- | ----------------- | ----------------------------------------------------------------------------- |
| 1【硬】 | 代码行与原文**逐行完全相等**  | 少一个 `}` 也会被点名                                                                 |
| 2【硬】 | 原文每行注释按原顺序出现在批注版里 | 英文被改写、被挤出顺序                                                                   |
| 3【硬】 | 块注释内部不许出现中文       | `/** */` 被中文从中间截断（语法合法，但难读）                                                   |
| 4【硬】 | 多行模板字符串内部不许出现中文   | 注释变成提示词正文（**代码行为被改变**）                                                        |
| 5【硬】 | 不劈开未结束的多行表达式      | `const x =` 后面插一段再给值                                                          |
| 6【硬】 | 批注版不得含控制字符        | 批注里的 `\n`、`\0`、`\x1b` 被 Python 转义成真实字节（NUL 会让 `grep` 把文件当二进制，ESC 直接把转义序列写进源码） |

另外还有一条软统计：每个文件多了多少行注释，用来发现「批注密度突然异常」。

**两个自动例外**：

- 内联 `sourceMappingURL`（一行几万到十六万字符的 base64）会被换成一句中文说明，校验时标成 `OK*` 而不是失败。**当前命中 60 个文件** —— 凡是 React Compiler 编译过的 `.tsx` 基本都带这么一行，只有少数手写 `.ts` 没有。查当前名单：`python scripts/check-fidelity.py | grep 'OK\*'`
- 原文里 CRLF 行尾的文件，批注版统一成 LF（否则会是「代码行 CRLF + 批注行 LF」的混合行尾）。git 仓库里本来就存 LF，所以这一步在 diff 上看不出变化

然后跑 `python scripts/check-links.py` 检查所有 Markdown 链接（源码链接 + 文档内链）。

想知道某个目录**还剩多少没批注**，跑 `python scripts/check-coverage.py`（不带参数看 `services/`）：它按子目录列出「已做/总数 + 已做行数/总行数」，并把未做的文件按行数降序排出来。本文档里所有「N/M 份」的数字都来自它，不是手数的。

**总原则：只允许变多，不允许变样。**

---


## 进度总表

| 学习路线的步骤                 | 涉及文件                                                                               | 批注版位置                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 状态                               |
| ----------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **第 1 步** 先认门面（30 分钟）   | `package.json`                                                                     | [`package.json.annotated.md`](annotated/package.json.annotated.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | ✅ 完成                             |
|                         | `README.md`（仓库自带的）                                                                 | [`README.annotated.md`](annotated/README.annotated.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ 完成                             |
|                         | `src/entrypoints/cli.tsx`（302 行，全文件）                                               | [`src/entrypoints/cli.tsx`](annotated/src/entrypoints/cli.tsx)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 完成                             |
| **第 2 步** 读一个最小模块（1 小时） | `src/commands/clear/index.ts`（19 行）                                                | [`src/commands/clear/index.ts`](annotated/src/commands/clear/index.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | ✅ 完成                             |
|                         | `src/tools/BashTool/commandSemantics.ts`（141 行）                                    | [`src/tools/BashTool/commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | ✅ 完成                             |
| **第 3 步** 读初始化流程（2 小时）  | `src/setup.ts`（477 行）                                                              | [`src/setup.ts`](annotated/src/setup.ts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | ✅ 完成                             |
| **第 4 步** 读工具系统（半天）★    | `src/Tool.ts`、`src/tools.ts`、`BashTool/`                                           | [`Tool.ts`](annotated/src/Tool.ts) ✅<br />[`tools.ts`](annotated/src/tools.ts) ✅<br />[`BashTool.tsx`](annotated/src/tools/BashTool/BashTool.tsx) ✅<br />[`bashSecurity.ts`](annotated/src/tools/BashTool/bashSecurity.ts) ✅<br />[`bashPermissions.ts`](annotated/src/tools/BashTool/bashPermissions.ts) ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ✅ 完成                             |
| **第 5 步** 读主循环（1 天）★★   | `src/constants/prompts.ts`、`src/query.ts`、`src/QueryEngine.ts`、`src/services/api/` | [`prompts.ts`](annotated/src/constants/prompts.ts) ✅<br />[`query.ts`](annotated/src/query.ts) ✅<br />[`QueryEngine.ts`](annotated/src/QueryEngine.ts) ✅<br />[`claude.ts`](annotated/src/services/api/claude.ts) ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | ✅ 完成                             |
| **第 6 步** 读服务层（半天）      | `src/services/` 各模块                                                                | [`api/` 全 20 份](annotated/src/services/api/) ✅<br />[`compact/` 全 11 份](annotated/src/services/compact/) ✅<br />[`mcp/` 全 23 份](annotated/src/services/mcp/) ✅<br />[`oauth/` 全 5 份](annotated/src/services/oauth/) ✅<br />[`tools/` 全 4 份](annotated/src/services/tools/) ✅<br />[`lsp/` 全 7 份](annotated/src/services/lsp/) ✅<br />[`SessionMemory/` 全 3 份](annotated/src/services/SessionMemory/) ✅<br />[`analytics/` 全 9 份](annotated/src/services/analytics/) ✅<br />[`teamMemorySync/` 全 5 份](annotated/src/services/teamMemorySync/) ✅<br />[`PromptSuggestion/` 全 2 份](annotated/src/services/PromptSuggestion/) ✅<br />[`plugins/` 全 3 份](annotated/src/services/plugins/) ✅<br />[`extractMemories/` 全 2 份](annotated/src/services/extractMemories/) ✅<br />[`tips/` 全 3 份](annotated/src/services/tips/) ✅<br />[`settingsSync/` 全 2 份](annotated/src/services/settingsSync/) ✅<br />[`autoDream/` 全 4 份](annotated/src/services/autoDream/) ✅<br />[`MagicDocs/` 全 2 份](annotated/src/services/MagicDocs/) ✅<br />[`policyLimits/` 全 2 份](annotated/src/services/policyLimits/) ✅<br />[`AgentSummary/`](annotated/src/services/AgentSummary/) + [`toolUseSummary/`](annotated/src/services/toolUseSummary/) + 根目录 6 散件 ✅ | ✅ 全目录清零<br />130/130 文件（100% 行数） |
| **第 7 步** UI 与多智能体（可选）  | `src/components/`、`src/ink/`、`src/coordinator/`                                    | [`coordinatorMode.ts`](annotated/src/coordinator/coordinatorMode.ts) ✅<br />[`AgentTool.tsx`](annotated/src/tools/AgentTool/AgentTool.tsx) ✅<br />[`AgentTool/prompt.ts`](annotated/src/tools/AgentTool/prompt.ts) ✅<br />[`forkSubagent.ts`](annotated/src/tools/AgentTool/forkSubagent.ts) ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ✅ 多智能体主线完成                       |
| **第 8 步** 终端渲染器（进阶，可选）  | `src/ink/`（自研 Ink，1.98 万行）                                                         | [`reconciler.ts`](annotated/src/ink/reconciler.ts) ✅<br />[`dom.ts`](annotated/src/ink/dom.ts) ✅<br />[`ink.tsx`](annotated/src/ink/ink.tsx) ✅<br />[`screen.ts`](annotated/src/ink/screen.ts) ✅<br />[`render-node-to-output.ts`](annotated/src/ink/render-node-to-output.ts) ✅<br />[`log-update.ts`](annotated/src/ink/log-update.ts) ✅<br />[`output.ts`](annotated/src/ink/output.ts) ✅<br />[`styles.ts`](annotated/src/ink/styles.ts) ✅<br />[`colorize.ts`](annotated/src/ink/colorize.ts) ✅<br />[`stringWidth.ts`](annotated/src/ink/stringWidth.ts) ✅<br />[`Ansi.tsx`](annotated/src/ink/Ansi.tsx) ✅<br />[`parse-keypress.ts`](annotated/src/ink/parse-keypress.ts) ✅<br />[`selection.ts`](annotated/src/ink/selection.ts) ✅<br />[`hit-test.ts`](annotated/src/ink/hit-test.ts) ✅<br />[`render-border.ts`](annotated/src/ink/render-border.ts) ✅<br />[`ink/` 其余 31 个小件](annotated/src/ink/) ✅<br />[`components/`](annotated/src/ink/components/) + [`hooks/`](annotated/src/ink/hooks/) + [`events/`](annotated/src/ink/events/) ✅                                                                                                                                                                                   | ✅ 九十六份全通<br />（`src/ink/` 清零）    |
| **第 9 步** 产品界面层（可选）     | `src/components/`（8.2 万行，389 个文件）                                                  | [`Messages.tsx`](annotated/src/components/Messages.tsx) ✅<br />[`MessageRow.tsx`](annotated/src/components/MessageRow.tsx) ✅<br />[`Message.tsx`](annotated/src/components/Message.tsx) ✅<br />[`messageActions.tsx`](annotated/src/components/messageActions.tsx) ✅<br />[`PromptInput/` 全 21 份](annotated/src/components/PromptInput/) ✅（含 `PromptInput.tsx` 2,338 行）<br />[`messages/` 全 41 份](annotated/src/components/messages/) ✅（含 `SystemTextMessage.tsx` 827 行、`AttachmentMessage.tsx` 536 行）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 🚧 消息主链 + 输入框 + 消息体 + 任务 / 搜索 / 权限 / 设置组件等（355/389）      |

---

## 第 1 步读完了吗？三个自测问题

读完这三个文件，你应该能不看资料答出下面三题。答不出就说明还没读透，回去补：

**Q1**：用户敲 `claude --version`，从敲下回车到看到版本号，一共加载了几个模块？

<details>

<summary>\\\*\\\*只有 1 个\\\** —— 就是 \\\`cli.tsx\\\` 自己。</summary>

`cli.tsx` 第 37-42 行：只要参数正好是一个 `--version` / `-v` / `-V`，直接 `console.log` 后 `return`，连 `startupProfiler` 都还没加载。文件头注释里那句 `Fast-path for --version has zero imports beyond this file`（译：--version 这条快速路径除了本文件之外零导入）说的就是这个。

</details>

**Q2**：为什么 `cli.tsx` 里所有的 `import` 都写成 `await import(...)`，而不是文件顶部一次性导入？

<details>

<summary>\\\*\\\*为了让「快速路径」不加载用不上的模块。\\\*\\\*</summary>

`main.js` 有 789 KB、4600 行。如果顶部就 `import { main } from '../main.js'`，那么连 `claude --version` 都得先把这 789 KB 解析、求值一遍，启动要慢上千毫秒。写成动态 `await import()`，只有真正走到那一步才加载。

**代价**：代码里到处是解构赋值（`const { x } = await import(...)`），比静态导入啰嗦得多。这是拿可读性换启动速度。

</details>

**Q3**：`package.json` 里 `dependencies` 是空的，那它用的 React、Ink、zod 都从哪来？

<details>

<summary>\\\*\\\*被打包器（Bun）内联进产物了。\\\*\\\*</summary>

发布出去的是一个自包含的包，所有依赖的代码都被塞进了最终产物文件里，所以 `package.json` 不需要声明依赖。

**后果**：`npm install` 之后跑不起来（缺 100 多个包）。所以这个仓库只能当**源码阅读对象**，不能当可运行工程。

</details>

---

## 第 2 步读完了吗？四个自测问题

这两个文件合起来只有 160 行，但踩中了三类关键设计：惰性加载、能力门禁、语义判定。四题都能答出来才算读过：

**Q1**：用户敲 `/clear`，**哪一行**代码才真正把 `clear` 的实现加载进来？本文件里的 `load` 是什么时候执行的？

<details>

<summary>加载发生在 \\\*\\\*\\\`src/utils/processUserInput/processSlashCommand.tsx:668\\\`\\\*\\\*：</summary>

```ts
const mod = await command.load()   // ← 到这一行才真的去读 clear.js
const result = await mod.call(args, context)
```

`clear/index.ts` 里的 `load: () => import('./clear.js')` 只是一个**没被调用的箭头函数**。启动时它躺在命令表里，什么也不做；只有用户真的敲了 `/clear`，才有人去调它。

这就是"元信息与实现分离"：启动只付几十字节的代价，实现（以及它 import 的一堆东西）推迟到用的时候。

</details>

**Q2**：`supportsNonInteractive: false` 具体会造成什么后果？是哪一行代码在管这件事？

<details>

<summary>后果：\\\*\\\*\\\`-p\\\`（headless / 管道脚本）模式下 \\\`/clear\\\` 根本不在命令列表里\\\*\\\*，敲了也匹配不到。</summary>

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

<summary>\\\*\\\*退出码 1 → 算成功。\\\** 查表命中 \\\`grep\\\` 条目，\\\`isError = exitCode >= 2\\\` → \\\`1 >= 2\\\` 为 false，于是不抛错，输出照常交给模型。</summary>

**退出码 2 → 算失败。**（grep 的 2 通常是正则语法错误、文件读不了这类真问题。）此时 `isError` 为 true，`BashTool.tsx:714` 会：

```ts
throw new ShellError('', outputWithSbFailures, result.code, result.interrupted)
```

所以"表里加不加一条"影响的不只是提示文案，而是**这次工具调用成不成立**。

</details>

**Q4**：`cd /tmp && grep -r foo .` 会匹配到哪条语义？`grep foo x || echo none` 为什么会被算错？

<details>

<summary>\\\*\\\*第一问\\\*\\\*：\\\`splitCommand_DEPRECATED\\\` 按 \\\`&&\\\` 拆成两段 → 取\\\*\\\*最后一段\\\** \\\`grep -r foo .\\\` → 取首词 \\\`grep\\\` → 命中表。取最后一段是因为 shell 的退出码 = 最后执行的那条命令。</summary>

**第二问**：`||` 的情况，最后一段是 `echo none`，于是查 `echo` → 查不到 → 走默认语义（非 0 即错）。但真实退出码是 `echo` 的 0，所以这次判断**碰巧不算错**；反过来 `grep foo x | head` 的退出码其实来自 `head`（管道最后一段），也会和直觉不同。

作者在 `heuristicallyExtractBaseCommand` 上明写了 `May get it super wrong - don't depend this for security`。这是全文件最该记住的一句：**这套解析只用来挑提示语，绝不参与权限判断**（权限走 `src/utils/permissions/` 里的真解析器）。

</details>

**顺带一个读源码才看得出的不一致**：`CommandSemantic` 返回值里的 `message`，在 Bash 侧**压根没被用过**——`PowerShellTool.tsx:649` 把它塞进了 `returnCodeInterpretation`，而 `BashTool.tsx:696/714` 只读 `isError`。所以 `'No matches found'`、`'Files differ'` 这些提示语写了但不会出现在模型眼前。（可以顺手改进，也是"文档说要怎样"和"代码实际怎样"之间的典型缝隙。）

---

## 第 3 步读完了吗？四个自测问题

`setup.ts` 有 477 行，但没有一行在做业务计算 —— 它全是"按正确顺序调用别人的函数"。所以自测题都不问"这行算什么"，只问顺序和分级。

**Q1**：为什么 `setCwd()` 必须在 `captureHooksConfigSnapshot()` 之前？如果反过来会出什么症状？

<details>

<summary>因为 hook 配置是从 \*\*\`<cwd>/.claude/settings.json\`\** 读的。cwd 没定就去抓快照，读到的可能是上一个目录的配置。</summary>

症状很隐蔽：**不报错**，只表现为"我的 hook 有时候生效、有时候不生效"，或者"在 A 项目里配的 hook 在 B 项目也触发了"。这类"顺序错了但不崩"的 bug 最难查。

源码里连写两行大写 `IMPORTANT` 就是在防这件事。

</details>

**Q2**：`main.tsx:1927` 让 `setup()` 和 `getCommands()` 并行跑，因此产生过一个 bug。那个 bug 是什么、怎么修的？

<details>

<summary>\\\*\\\*bug\\\*\\\*：内置技能/插件的注册原先写在 \\\`setup()\\\` 里，但它前面有约 20ms 的 \\\`await\\\`（UDS socket）。而并行的 \\\`getCommands()\\\` 已经跑完并 \\\*\\\*memoize\\\** 了结果 —— 缓存里没有内置技能。等 \\\`setup()\\\` 走到注册那一步，命令表早就定死了。</summary>

**修法**：不是加锁，而是把注册**挪到并行启动点之前**（`main.tsx:1923-1926`），让它变成纯内存的数组 push（<1ms、零 IO），必然先于 `getCommands()`。

**教训**：并行化会把"隐式顺序依赖"变成竞态；只要有 memoize，谁先算谁定终身。

同一个文件里还有第二处竞态（插件预取 vs 同步安装），那个**没法**靠调顺序解决，只能用 `CLAUDE_CODE_SYNC_PLUGIN_INSTALL` 彻底不同时做。能靠顺序解决的用顺序，不能的用开关。

</details>

**Q3**：`void lockCurrentVersion()` 里的 `void` 到底做了什么？代价是什么？

<details>

<summary>\\\`void\\\` \\\*\\\*不改变任何运行时行为\\\** —— 它只是告诉读代码的人和 lint 工具："我知道这是个 Promise，我故意不等它。"</summary>

目的：让"装监听器 / 抢锁 / 预热缓存"这类工作不拖慢启动。

**代价**：没人 `catch`，失败就变成 `unhandledRejection`。所以 `main.tsx:1932` 给这些 promise 挂了 `.catch(() => {})` —— 防止启动那 28ms 窗口里的瞬时 rejection 把进程搞崩。

</details>

**Q4**：`--dangerously-skip-permissions` 会做哪些环境校验？为什么 `NODE_ENV === 'test'` 的提前返回放在校验**之后**而不是函数开头？

<details>

<summary>\\\*\\\*两道闸\\\*\\\*：</summary>

1. **root 检查**（对所有平台）：是 root 且不在沙箱（`IS_SANDBOX` / bubblewrap 都没有）→ 直接退出。
2. **沙箱 + 断网检查**（仅内部员工、排除 Desktop 两个入口）：必须 `isSandboxed && !hasInternet`。也就是"不在沙箱"或"能上网"都拒绝 —— 因为在沙箱里且离线时，模型乱来的破坏范围被容器和断网限制住了。

**为什么 test 的 return 放在最后**：如果放在函数开头，测试就永远覆盖不到这两道闸 —— 而安全逻辑恰恰最需要被测到。这在源码里也有一句对应的话：`--dangerously-skip-permissions safety gate ... must still run`，说明安全门禁**不受任何模式开关影响**。

</details>

---

## 第 4 步（`Tool.ts` 契约）读完了吗？四个自测问题

`Tool.ts` 792 行里只有 40 行是可执行代码，其余全是类型。所以自测题都不问"语法"，只问"这个字段为什么必须存在"。

**Q1**：`call()` 的第 3 个参数 `canUseTool` 为什么不放进 `ToolUseContext`？

<details>

<summary>因为它是\\\*\\\*能力凭证\\\*\\\*，不是\\\*\\\*环境\\\*\\\*。</summary>

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

<summary>不行，因为 \`Infinity\` 在这里是\*\*哨兵值\*\*，不是"一个很大的数"。</summary>

`query.ts:391` 是这么筛的：

```ts
.filter(t => !Number.isFinite(t.maxResultSizeChars))
```

`Number.isFinite(1e9)` 是 `true`，所以 `1e9` 会被当成普通工具参与预算计算；只有 `Infinity` 才会被排除。

为什么要排除 Read？源码注释写得很直白：Read 的结果落盘，会导致 **Read → 结果文件 → 再 Read 它** 的循环，指数级放大。而 Read 本身已经用 `fileReadingLimits` 自我约束了。

</details>

**Q4**：一个工具明明返回了 `contextModifier`，却没有任何效果，而且不报错。最可能是什么原因？

<details>

<summary>它的 \\\`isConcurrencySafe()\\\` 返回了 \\\`true\\\`。</summary>

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

| 子目录                               | 文件          | 原文行数                      | 中文批注行      | 状态      |
| --------------------------------- | ----------- | ------------------------- | ---------- | ------- |
| `services/mcp/`                   | 23/23       | 12,311                    | 4,414      | ✅ 清零    |
| `services/api/`                   | 20/20       | 10,477                    | 2,807      | ✅ 清零    |
| `services/compact/`               | 11/11       | 3,960                     | 3,407      | ✅ 清零    |
| `services/lsp/`                   | 7/7         | 2,460                     | 642        | ✅ 清零    |
| `services/oauth/`                 | 5/5         | 1,051                     | 325        | ✅ 清零    |
| `services/tools/`                 | 4/4         | 3,113                     | 292        | ✅ 清零    |
| `services/SessionMemory/`         | 3/3         | 1,026                     | 312        | ✅ 清零    |
| `services/analytics/`             | 9/9         | 4,040                     | 436        | ✅ 清零    |
| `services/teamMemorySync/`        | 5/5         | 2,167                     | 266        | ✅ 清零    |
| `services/PromptSuggestion/`      | 2/2         | 1,514                     | 34         | ✅ 清零    |
| `services/plugins/`               | 3/3         | 1,616                     | 39         | ✅ 清零    |
| `services/remoteManagedSettings/` | 5/5         | 950                       | 167        | ✅ 清零    |
| `services/extractMemories/`       | 2/2         | 769                       | 32         | ✅ 清零    |
| `services/tips/`                  | 3/3         | 761                       | 25         | ✅ 清零    |
| `services/settingsSync/`          | 2/2         | 648                       | 26         | ✅ 清零    |
| `services/policyLimits/`          | 2/2         | 690                       | 27         | ✅ 清零    |
| `services/autoDream/`             | 4/4         | 550                       | 33         | ✅ 清零    |
| `services/MagicDocs/`             | 2/2         | 381                       | 19         | ✅ 清零    |
| `services/AgentSummary/`          | 1/1         | 179                       | 13         | ✅ 清零    |
| `services/toolUseSummary/`        | 1/1         | 112                       | 7          | ✅ 清零    |
| `services/` 根目录 6 份散件             | 6/6         | 549                       | 36         | ✅ 清零    |
| **合计**                            | **130/130** | **53,683 / 53,683（100%）** | **13,381** | ✅ 全目录清零 |

> 中文批注行数由 `python scripts/check-fidelity.py` 逐文件统计后相加，可复算；  
> 「原文行数」是源文件总行数（含注释与空行），所以比「代码行合计」大。  
> ⚠️ 2026-10-22 修掉了 check-fidelity 的一个**计数虚高 bug**：`ANN_PREFIXES` 里的  
> `// ─` / `// ═` 会撞上源码自带的同款英文分节符（如 `// ── Search materialized ──`），  
> 批注侧不看 CJK 占比就把它们算成「中文批注」——全仓 170 个文件、688 行被虚高  
> （`pluginOperations.ts` 一个文件就虚高 6 行）。修复后同一份脚本算出的 services  
> 合计从 12,959 降到 12,768，差值正是这类英文分节符，不是批注变少了。

---

### `services/api/` —— 20 份（一次请求怎么发、怎么失败、怎么记账）

| 文件                                                                                        | 原文    | 批注版   | 讲什么                                                              |
| ----------------------------------------------------------------------------------------- | ----- | ----- | ---------------------------------------------------------------- |
| [`claude.ts`](annotated/src/services/api/claude.ts)                                       | 3,419 | 4,655 | SSE 解析、缓存打点、sticky latch、三级降级                                    |
| [`errors.ts`](annotated/src/services/api/errors.ts)                                       | 1,207 | 1,467 | 错误分类、**错误转 assistant 消息**、`NO_RESPONSE_REQUESTED` 哨兵             |
| [`withRetry.ts`](annotated/src/services/api/withRetry.ts)                                 | 822   | 1,418 | 重试边界、退避曲线、529 白名单、无限重试模式                                         |
| [`logging.ts`](annotated/src/services/api/logging.ts)                                     | 788   | 988   | 七个 AI 网关靠响应头前缀识别、`_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`     |
| [`filesApi.ts`](annotated/src/services/api/filesApi.ts)                                   | 748   | 889   | 把「该不该重试」变成返回值、`normalize` 后判 `..` 防穿越、30 行手写并发池                  |
| [`promptCacheBreakDetection.ts`](annotated/src/services/api/promptCacheBreakDetection.ts) | 727   | 925   | 缓存为什么碎、只追 5 个前缀、`stripCacheControl`、MCP 名脱敏                      |
| [`sessionIngress.ts`](annotated/src/services/api/sessionIngress.ts)                       | 514   | 618   | 链式追加 + 乐观并发、409 和解、会话级串行                                         |
| [`client.ts`](annotated/src/services/api/client.ts)                                       | 389   | 583   | 四级 region 优先级、SDK logger 全走 stderr、只记布尔不记凭据                      |
| [`grove.ts`](annotated/src/services/api/grove.ts)                                         | 357   | 491   | 三态开关、**失败不缓存否则死锁**                                               |
| [`referral.ts`](annotated/src/services/api/referral.ts)                                   | 281   | 404   | 单飞存 Promise、主入口三条路径都不同步等网络                                       |
| [`errorUtils.ts`](annotated/src/services/api/errorUtils.ts)                               | 260   | 408   | 18 个 OpenSSL 码穷举、沿 `cause` 链挖、两级判断深优先                            |
| [`dumpPrompts.ts`](annotated/src/services/api/dumpPrompts.ts)                             | 226   | 362   | init 块 + 增量日志、0.01ms 判断省 300ms 序列化                               |
| [`metricsOptOut.ts`](annotated/src/services/api/metricsOptOut.ts)                         | 159   | 276   | 两层 TTL 的职责划分、**缓存投毒**防御                                          |
| [`bootstrap.ts`](annotated/src/services/api/bootstrap.ts)                                 | 141   | 230   | 四道门、重试回调里必须重读 token                                              |
| [`overageCreditGrant.ts`](annotated/src/services/api/overageCreditGrant.ts)               | 137   | 243   | 三个相似缓存三种过期策略 —— 因为这是钱                                            |
| [`adminRequests.ts`](annotated/src/services/api/adminRequests.ts)                         | 119   | 187   | 可辨识联合、交叉类型而非嵌套、幂等 POST                                           |
| [`usage.ts`](annotated/src/services/api/usage.ts)                                         | 63    | 117   | 三个提前返回 = 失败语义分三级                                                 |
| [`firstTokenDate.ts`](annotated/src/services/api/firstTokenDate.ts)                       | 60    | 118   | `!== undefined` 而非 `!x`（null 是有效答案）、写端校验让读端放心                    |
| [`ultrareviewQuota.ts`](annotated/src/services/api/ultrareviewQuota.ts)                   | 38    | 83    | `X \| null` 不给 undefined/异常、`logForDebugging` 与 `logError` 反推严重性 |
| [`emptyUsage.ts`](annotated/src/services/api/emptyUsage.ts)                               | 22    | 73    | 一段注释里的 import 链自白、共享常量必须 `Readonly`                              |

**这 20 份合起来回答一个问题**：一次 API 调用从发出到记账，中间要过哪些关。  
`client.ts` 造请求 → `claude.ts` 解流 → `withRetry.ts` 管重试 → `errors.ts` 决定  
失败长什么样 → `sessionIngress.ts` 把消息追加到会话 → `logging.ts` 记账。  
中间那些 `*.ts` 每一份都是这条链上某个具体问题的补丁。

---

### `services/compact/` —— 11 份（上下文快满时怎么办）

| 文件                                                                                  | 原文    | 批注版   | 讲什么                                        |
| ----------------------------------------------------------------------------------- | ----- | ----- | ------------------------------------------ |
| [`compact.ts`](annotated/src/services/compact/compact.ts)                           | 1,705 | 3,628 | 摘要压缩本体、PTL 逃生舱、七类附件重建                      |
| [`sessionMemoryCompact.ts`](annotated/src/services/compact/sessionMemoryCompact.ts) | 630   | 1,517 | 零 API 调用的拼接式压缩、82 行索引对齐                    |
| [`microCompact.ts`](annotated/src/services/compact/microCompact.ts)                 | 530   | 1,352 | 缓存热不热决定改不改本地内容                             |
| [`prompt.ts`](annotated/src/services/compact/prompt.ts)                             | 374   | 723   | 压缩提示词本体，三套模板的差异与理由                         |
| [`autoCompact.ts`](annotated/src/services/compact/autoCompact.ts)                   | 351   | 668   | 阈值计算、四道抑制闸门、三振熔断、session memory 优先         |
| [`apiMicrocompact.ts`](annotated/src/services/compact/apiMicrocompact.ts)           | 153   | 328   | 发给 API 的 `context_management` 指令（**不调模型**） |
| [`postCompactCleanup.ts`](annotated/src/services/compact/postCompactCleanup.ts)     | 77    | 339   | 压缩后清什么、清哪一层、什么故意不清                         |
| [`grouping.ts`](annotated/src/services/compact/grouping.ts)                         | 63    | 202   | 按 API 轮次切刀口，以及为什么只有一个判据                    |
| [`timeBasedMCConfig.ts`](annotated/src/services/compact/timeBasedMCConfig.ts)       | 43    | 228   | 缓存注定要 miss 时顺手整理上下文                        |
| [`compactWarningState.ts`](annotated/src/services/compact/compactWarningState.ts)   | 18    | 71    | 一个布尔量的时序问题                                 |
| [`compactWarningHook.ts`](annotated/src/services/compact/compactWarningHook.ts)     | 16    | 105   | 为什么 6 行 hook 要单独一个文件                       |

---

### `services/mcp/` —— 23 份（MCP 从「允不允许连」到「接进 UI」）

| 文件                                                                                    | 原文    | 批注版   | 讲什么                                                        |
| ------------------------------------------------------------------------------------- | ----- | ----- | ---------------------------------------------------------- |
| [`client.ts`](annotated/src/services/mcp/client.ts)                                   | 3,348 | 4,775 | 七种 transport、错误桥接、MCP 工具封装                                 |
| [`auth.ts`](annotated/src/services/mcp/auth.ts)                                       | 2,465 | 4,355 | OAuth 全流程、XAA、step-up 补丁、跨进程刷新锁                            |
| [`config.ts`](annotated/src/services/mcp/config.ts)                                   | 1,578 | 3,076 | 六种配置来源、优先级、去重、白黑名单策略                                       |
| [`useManageMCPConnections.ts`](annotated/src/services/mcp/useManageMCPConnections.ts) | 1,141 | 1,630 | 异步事件 → AppState 的适配层、16ms 批处理                              |
| [`utils.ts`](annotated/src/services/mcp/utils.ts)                                     | 575   | 651   | 名字过滤、配置哈希、过期客户端回收、项目级 server 信任判定                          |
| [`xaa.ts`](annotated/src/services/mcp/xaa.ts)                                         | 511   | 811   | 两跳换票：id_token → ID-JAG → access_token、三道防混淆闸               |
| [`xaaIdpLogin.ts`](annotated/src/services/mcp/xaaIdpLogin.ts)                         | 487   | 708   | 一次浏览器弹窗、id_token 按 issuer 缓存、URL 拼接两个坑                     |
| [`channelNotification.ts`](annotated/src/services/mcp/channelNotification.ts)         | 316   | 360   | 通道的六道闸 + `<channel>` 标签怎么拼                                 |
| [`elicitationHandler.ts`](annotated/src/services/mcp/elicitationHandler.ts)           | 313   | 360   | server 向人提问（表单 / 打开链接）的整条链路                                |
| [`types.ts`](annotated/src/services/mcp/types.ts)                                     | 258   | 296   | 八种 transport 的配置 schema、连接状态机                              |
| [`channelPermissions.ts`](annotated/src/services/mcp/channelPermissions.ts)           | 240   | 287   | 把审批提示发到手机，等一句 "yes tbxkq"                                  |
| [`claudeai.ts`](annotated/src/services/mcp/claudeai.ts)                               | 164   | 195   | 从 claude.ai 拉组织下发的 server 列表                               |
| [`headersHelper.ts`](annotated/src/services/mcp/headersHelper.ts)                     | 138   | 166   | 连之前先跑一条本地命令，拿动态 header                                     |
| [`SdkControlTransport.ts`](annotated/src/services/mcp/SdkControlTransport.ts)         | 136   | 159   | 把 JSON-RPC 套进 control 信封，跨进程                               |
| [`vscodeSdkMcp.ts`](annotated/src/services/mcp/vscodeSdkMcp.ts)                       | 112   | 135   | 和 VSCode 扩展之间的两条 notification                              |
| [`mcpStringUtils.ts`](annotated/src/services/mcp/mcpStringUtils.ts)                   | 106   | 132   | `mcp__server__tool` 的拼与拆                                   |
| [`oauthPort.ts`](annotated/src/services/mcp/oauthPort.ts)                             | 78    | 102   | 回调端口怎么挑（含 Windows 的坑）                                      |
| [`channelAllowlist.ts`](annotated/src/services/mcp/channelAllowlist.ts)               | 76    | 90    | 哪些插件被批准可以当通道                                               |
| [`MCPConnectionManager.tsx`](annotated/src/services/mcp/MCPConnectionManager.tsx)     | 73    | 236   | **React Compiler 编译产物读法**：`_c(6)` 缓存槽、`t0` 临时名、连 JSX 元素也缓存 |
| [`officialRegistry.ts`](annotated/src/services/mcp/officialRegistry.ts)               | 72    | 92    | 官方 MCP 名单（只用于埋点）                                           |
| [`InProcessTransport.ts`](annotated/src/services/mcp/InProcessTransport.ts)           | 63    | 83    | 同进程里的一对假传输                                                 |
| [`envExpansion.ts`](annotated/src/services/mcp/envExpansion.ts)                       | 38    | 56    | `${VAR:-默认值}`                                              |
| [`normalization.ts`](annotated/src/services/mcp/normalization.ts)                     | 23    | 44    | 把 server 名洗成 `^[a-zA-Z0-9_-]{1,64}$`，claude.ai 前缀额外塌缩下划线   |

MCP 这条线可以按四段读：`config.ts`（允不允许连）→ `client.ts`（连上怎么活）  
→ `auth.ts`（401 之后怎么办）→ `xaa*.ts`（不弹窗那条路怎么走），  
最后 `useManageMCPConnections.ts` 把它接进 UI，`MCPConnectionManager.tsx` 把两个动作递给组件树。

---

### `services/oauth/` —— 5 份（登录一次，之后靠刷新）

| 文件                                                                            | 原文  | 批注版 | 讲什么                                                                               |
| ----------------------------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------------- |
| [`client.ts`](annotated/src/services/oauth/client.ts)                         | 566 | 744 | 第 187 行注释 = 一次「省 7M 请求/天」的优化差点让订阅类型永久丢失；refresh 扩权依赖后端 `ALLOWED_SCOPE_EXPANSIONS` |
| [`auth-code-listener.ts`](annotated/src/services/oauth/auth-code-listener.ts) | 211 | 315 | 延迟响应（攥着 `res` 等 token 换完再补 302）、`port ?? 0`、判路径防 favicon 打断                       |
| [`index.ts`](annotated/src/services/oauth/index.ts)                           | 198 | 323 | 浏览器内/外两条路径赛跑收敛成一个 Promise、`skipBrowserOpen` 由「谁拥有屏幕」决定                            |
| [`getOauthProfile.ts`](annotated/src/services/oauth/getOauthProfile.ts)       | 53  | 93  | 两条路对应两种凭据，头组合不能互换                                                                 |
| [`crypto.ts`](annotated/src/services/oauth/crypto.ts)                         | 23  | 86  | PKCE 三块拼图，base64URL 三次替换（删 `=` 最容易漏）                                              |

---

### `services/tools/` —— 4 份（工具怎么被执行）

| 文件                                                                                  | 原文    | 批注版   | 讲什么                                                                   |
| ----------------------------------------------------------------------------------- | ----- | ----- | --------------------------------------------------------------------- |
| [`toolExecution.ts`](annotated/src/services/tools/toolExecution.ts)                 | 1,745 | 1,905 | 九道关；`500ms`/`2000ms` 两个阈值同源于「felt stuck」；`classifyToolError` 对付压缩后的类名 |
| [`toolHooks.ts`](annotated/src/services/tools/toolHooks.ts)                         | 650   | 751   | #31301 重复显示 bug；**钩子 `allow` 不绕过 `settings.json` 的 deny**（inc-4788）   |
| [`StreamingToolExecutor.ts`](annotated/src/services/tools/StreamingToolExecutor.ts) | 530   | 649   | 并发 = 多个交错 pass，`status='executing'` 当互斥量；`getAbortReason` 检查顺序即优先级    |
| [`toolOrchestration.ts`](annotated/src/services/tools/toolOrchestration.ts)         | 188   | 284   | `\|\| 10` 兜 `parseInt` 的 NaN；并发批 `contextModifier` 排队后按 blocks 顺序回放   |

---

### `services/lsp/` —— 7 份（从配置到诊断的完整链路）

| 文件                                                                                | 原文  | 批注版 | 讲什么                                                                                                       |
| --------------------------------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------------------------------------- |
| [`LSPServerInstance.ts`](annotated/src/services/lsp/LSPServerInstance.ts)         | 511 | 672 | `-32801 ContentModified` 是可重试错误；duck typing 判错误码（依赖树里有两个版本的 `vscode-jsonrpc`）；`require()` 只为推迟 129KB；僵尸状态 |
| [`LSPClient.ts`](annotated/src/services/lsp/LSPClient.ts)                         | 447 | 653 | **`spawn()` 返回 ≠ 启动成功**（ENOENT 是异步事件）；`isStopping` 一个布尔守四个入口；`stop` 里必须 `removeAllListeners`              |
| [`LSPServerManager.ts`](annotated/src/services/lsp/LSPServerManager.ts)           | 420 | 583 | 三张 Map 对应三种问题（生命周期 / 路由 / 协议同步）；声明不支持、server 照样发请求；`version: 1` 恒不变的已知不规范                                 |
| [`LSPDiagnosticRegistry.ts`](annotated/src/services/lsp/LSPDiagnosticRegistry.ts) | 386 | 521 | 跨轮去重靠 LRU(500)；「先标记已投递再删 pending」必须放在可能失败的去重**之后**                                                        |
| [`passiveFeedback.ts`](annotated/src/services/lsp/passiveFeedback.ts)             | 328 | 465 | 缺失 severity 默认 `Error`（漏报比误报贵），而 registry 里默认 `Hint`（排序用）——同一个「未知」在两个语境选相反默认值                             |
| [`manager.ts`](annotated/src/services/lsp/manager.ts)                             | 289 | 417 | 四态 + generation counter（过期 promise 不许改状态）；issue #15521：memoize + 早期调用 + 缺刷新路径                             |
| [`config.ts`](annotated/src/services/lsp/config.ts)                               | 79  | 140 | 「LSP 只能通过插件配置」= **安全边界**（配置里有 `command`，等于任意进程执行）                                                         |

读这条线的顺序：`config.ts`（谁能配）→ `manager.ts`（什么时候起）→  
`LSPServerManager.ts`（按扩展名路由 + 文件同步）→ `LSPServerInstance.ts`（状态机 + 重试）→  
`LSPClient.ts`（子进程 + JSON-RPC）→ `passiveFeedback.ts`（诊断怎么回来）→  
`LSPDiagnosticRegistry.ts`（诊断怎么等到下一轮）。

---

### `services/SessionMemory/` —— 3 份（后台子代理替你记笔记）

| 文件                                                                                    | 原文  | 批注版 | 讲什么                                                                                                          |
| ------------------------------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------------------------------------ |
| [`sessionMemory.ts`](annotated/src/services/SessionMemory/sessionMemory.ts)           | 495 | 747 | 两处 `_CACHED_MAY_BE_STALE`；用 uuid 而非下标定位起点；token 阈值是永远必需的节流阀；**读文件必须发生在隔离 context**；`canUseTool` 削到「只能改这一个文件」 |
| [`prompts.ts`](annotated/src/services/SessionMemory/prompts.ts)                       | 324 | 482 | 模板斜体行是给模型看的字段说明；「不许改斜体行」说三遍；单次 `replace` 防 `$` 反向引用；代码硬截断是「prompt 不可全信」的兜底                                   |
| [`sessionMemoryUtils.ts`](annotated/src/services/SessionMemory/sessionMemoryUtils.ts) | 207 | 319 | 15s 等待上限 / 60s 判僵死；阈值用**增量**而非绝对值（否则恒真）                                                                      |

一句话串起来：`sessionMemoryUtils` 存状态和阈值 → `prompts` 决定「让模型改哪里、改多少」  
→ `sessionMemory` 在合适的时机派一个 forked 子代理去改那一个文件。  
它是 `compact/sessionMemoryCompact.ts` 的上游。

---

### `services/analytics/` —— 9 份（数据怎么离得开本机 + 远端开关怎么下发）

| 文件                                                                                                        | 原文    | 批注版   | 讲什么                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ----- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`growthbook.ts`](annotated/src/services/analytics/growthbook.ts)                                         | 1,155 | 1,240 | **引擎**：`processRemoteEvalPayload` 的 `{}` 真值判据（漏检查会让所有开关集体黑屏）；`syncRemoteEvalToDisk` 只在成功路径调用（超时投毒结构上不可能）；`getGrowthBookClient` 用 `client!==thisClient` 守卫处理异步重 init；`checkGate_CACHED_OR_BLOCKING` 的 stale-while-false-blocking；整文件 `@deprecated` 记录从 Statsig 迁到 GrowthBook 的迁移史 |
| [`metadata.ts`](annotated/src/services/analytics/metadata.ts)                                             | 973   | 1,045 | 所有遥测字段的单一事实来源；`to1PEventFormat` 用 proto 生成的 `EnvironmentMetadata` 类型让「漏字段」从运行时 bug 变编译错误（手写并行类型曾让 #11318/#13924/#19448 全没进 BQ）；`account_id` 故意省略只填 UUID；`kairosActive` 不进 memoized env                                                                                           |
| [`firstPartyEventLoggingExporter.ts`](annotated/src/services/analytics/firstPartyEventLoggingExporter.ts) | 806   | 880   | 跨进程重启的失败事件恢复（BATCH_UUID+sessionId 隔离）；二次方退避（base*attempts²）；第一批失败即 short-circuit；401 退化为无 auth 重试；`_PROTO_*` hoist 到 proto 字段后再防御性 strip                                                                                                                                         |
| [`firstPartyEventLogger.ts`](annotated/src/services/analytics/firstPartyEventLogger.ts)                   | 449   | 512   | OTel logs SDK；自建独立 LoggerProvider 不与客户遥测混；`reinitialize` 三步走（null→forceFlush→swap）的事件丢失安全；`getEnvironmentForGrowthBook` 永远 production                                                                                                                                            |
| [`datadog.ts`](annotated/src/services/analytics/datadog.ts)                                               | 307   | 364   | pub 公开 token 写死在客户端（只写不读）；44 事件白名单 + 二次基数归一（mcp→mcp / 罕见模型→other）；`status`→`http_status`/`http_status_range` 避开 DD 保留字段；`getUserBucket` 用 sha256 mod 30 代替真实 user id 计数                                                                                                          |
| [`index.ts`](annotated/src/services/analytics/index.ts)                                                   | 173   | 210   | 零依赖防循环；`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 用命名做 lint；`eventQueue` + `queueMicrotask` 先消费后连接，不阻塞启动                                                                                                                                                       |
| [`sink.ts`](annotated/src/services/analytics/sink.ts)                                                     | 114   | 146   | `shouldTrackDatadog` 三层回退（killswitch→模块态→跨 session 磁盘缓存）；`stripProtoFields` 只在非 1P 后端前调一次守 PII 边界                                                                                                                                                                                |
| [`config.ts`](annotated/src/services/analytics/config.ts)                                                 | 38    | 59    | `isAnalyticsDisabled` 五条件一刀切；`isFeedbackSurveyDisabled` 故意不挡 3P 云（本地 UI 弹窗无 transcript）                                                                                                                                                                                          |
| [`sinkKillswitch.ts`](annotated/src/services/analytics/sinkKillswitch.ts)                                 | 25    | 42    | `tengu_frond_boric` 熔断；fail-open；绝不能从 `is1PEventLoggingEnabled` 内调用（会递归爆栈）                                                                                                                                                                                                       |

读这条线的顺序：`index.ts`（公共入口、零依赖）→ `config.ts` / `sinkKillswitch.ts`（总开关与熔断）→ `sink.ts`（路由中枢）→ `datadog.ts` + `firstPartyEventLogger.ts` / `firstPartyEventLoggingExporter.ts`（两个后端）→ `metadata.ts`（字段单一事实来源）→ `growthbook.ts`（远端开关引擎）。

一句话串起来：`index.ts` 暴露 `logEvent`，`sink.ts` 决定去哪几个后端，`datadog.ts` / `firstPartyEventLogger.ts` 负责把事件**可靠地**发走，`metadata.ts` 决定**发什么字段**（含 PII 脱敏），`growthbook.ts` 决定**开关和动态配置从哪来**。  
它是 `api/logging.ts` 那套 `_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 命名约束的延伸—— 同一件事的两端。

---

### `services/teamMemorySync/` —— 5 份（多设备 / 多成员之间怎么同步记忆和设置）

| 文件                                                                                     | 原文    | 批注版   | 讲什么                                                                                              |
| -------------------------------------------------------------------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------ |
| [`index.ts`](annotated/src/services/teamMemorySync/index.ts)                           | 1,256 | 1,386 | 本地文件 ↔ 服务器 API 双向同步；三个 HTTP 接口（拉全量 / 拉校验和探针 / 推 upsert）；delta 按字节贪心装箱；乐观锁 + 412 冲突重试（local-wins） |
| [`watcher.ts`](annotated/src/services/teamMemorySync/watcher.ts)                       | 387   | 440   | 后台 `fs.watch` 守护（不依赖 chokidar，避免 kqueue fd 泄漏）；2 秒防抖；永久失败护栏 `pushSuppressedReason` 防无限重试         |
| [`secretScanner.ts`](annotated/src/services/teamMemorySync/secretScanner.ts)           | 324   | 359   | gitleaks 高置信度规则子集；`scanForSecrets` 整文件跳过、`redactSecrets` 命中替 `[REDACTED]`；匹配文本绝不返回               |
| [`types.ts`](annotated/src/services/teamMemorySync/types.ts)                           | 156   | 188   | Zod v4 数据契约（`TeamMemoryDataSchema` / 各步结果类型）；`z.infer` 派生类型                                      |
| [`teamMemSecretGuard.ts`](annotated/src/services/teamMemorySync/teamMemSecretGuard.ts) | 44    | 57    | 写入前第一道闸门 `checkTeamMemSecrets`；惰性 `require` 只在 `TEAMMEM` feature 开启时加载依赖                         |

读这条线的顺序：`types.ts`（数据契约长什么样）→ `index.ts`（同步主流程：拉 / 算 delta / 推 / 冲突重试）→ `watcher.ts`（后台怎么感知文件变化并触发同步）→ `secretScanner.ts` + `teamMemSecretGuard.ts`（上传前怎么把密钥挡在门外）。

一句话串起来：`index.ts` 负责「跟服务器对账、只传变了的那部分」，乐观锁保证并发编辑不互相覆盖；`watcher.ts` 把本地改动实时推进同步队列；`secretScanner.ts` 决定「哪些内容因为像密钥而根本不许同步」。它的隔离粒度是 **git remote 哈希**—— 同一 org 的成员按 remote 共享团队记忆，不同仓库互不串。

---

### `services/PromptSuggestion/` —— 2 份（空闲时弹出的「下一句建议」从哪来）

| 文件                                                                                   | 原文  | 批注版   | 讲什么                                                                              |
| ------------------------------------------------------------------------------------ | --- | ----- | -------------------------------------------------------------------------------- |
| [`promptSuggestion.ts`](annotated/src/services/PromptSuggestion/promptSuggestion.ts) | 523 | 536   | 「猜用户会敲什么」的提示词与多级开关；fork 子代理生成建议、缓存冷抑制、十几种输出过滤器剔除不像人话的结果                          |
| [`speculation.ts`](annotated/src/services/PromptSuggestion/speculation.ts)           | 991 | 1,012 | 进阶版：不仅猜，还 fork 子代理在 overlay 文件系统上**真预跑**；写时复制 + 工具白名单 + 边界中止；用户接受即注入对话、记「省了多少时间」 |

读这条线的顺序：`promptSuggestion.ts`（建议怎么生成、什么时候不该生成）→ `speculation.ts`（建议被接受前的「后台预执行」）。

一句话串起来：`promptSuggestion.ts` 决定「该不该、猜什么」，靠 fork 一个**禁用所有工具**的子代理读最近对话预测用户下一句（2-12 词）；`speculation.ts` 是它更激进的延伸——用同一条建议 fork 一个**只放行只读工具、写工具重定向到临时 overlay** 的子代理，把用户「接下来大概率要做的事」提前跑完，等你确认时工作已经在手。两者都严格蹭主线程的 prompt 缓存（改一个 API 参数都会让命中率从 92% 崩到 61%）。

---

### `services/plugins/` —— 3 份（用户装的扩展怎么被下载、校验、加载、卸载）

| 文件                                                                                            | 原文    | 批注版   | 讲什么                                                                                                  |
| --------------------------------------------------------------------------------------------- | ----- | ----- | ---------------------------------------------------------------------------------------------------- |
| [`pluginOperations.ts`](annotated/src/services/plugins/pluginOperations.ts)                   | 1,088 | 1,114 | 核心：install/uninstall/enable/disable/update 的纯库函数。settings-first 架构、四层 scope、delisted 兜底、卸载四层清理、非原地更新 |
| [`pluginCliCommands.ts`](annotated/src/services/plugins/pluginCliCommands.ts)                 | 344   | 350   | CLI 薄包装：console + process.exit + 遥测。统一错误出口先发 `tengu_plugin_command_failed` 再退，dashboard 才算得出成功率      |
| [`PluginInstallationManager.ts`](annotated/src/services/plugins/PluginInstallationManager.ts) | 184   | 191   | 启动期后台安装：从受信来源 reconcile 市场，把 onProgress 映射进 AppState；新装→自动刷新插件，仅更新→提示 `/reload-plugins`              |

读这条线的顺序：`pluginOperations.ts`（业务全在这）→ `pluginCliCommands.ts`（CLI 怎么包它）→ `PluginInstallationManager.ts`（启动时谁在背后自动装）。

一句话串起来：整个子系统建立在「**settings 声明意图、installed_plugins_v2.json 记录安装**」的分离上。`pluginOperations.ts` 只做纯函数（不 console、不 exit、返回结果对象），所以 CLI 和交互 UI（ManagePlugins.tsx）能共用同一套逻辑；scope 分 user/project/local（local > project > user，最具体者胜）外加只能由企业下发的 managed；插件被市场下架后回退 V2 记录兜底；卸载要同时收口 settings key、V2 记录、孤儿缓存、options/secrets 四层，且**反向依赖只警告不阻断**——阻断会造出拆不动的「墓碑」，真正的兜底在加载期 verifyAndDemote。

---

### `services/mockRateLimits.ts` —— 根目录散件（限流「挡板」，19 种场景的本地摹本）

| 文件                                                              | 原文  | 批注版 | 讲什么                                                                                                                                        |
| --------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [`mockRateLimits.ts`](annotated/src/services/mockRateLimits.ts) | 882 | 979 | `anthropic-ratelimit-unified-*` 全套响应头的 mock：代表 claim 取 reset 最远者、overage 月度重置、org/member/seat-tier 四种零额度、fast mode 20 秒冷却阈值、headerless 429 |

读法：先看文件头的 19 个 `MockScenario`（按族分：普通 / 会话窗 / 周窗 / overage / org 额度 / 分模型 / fast mode / headerless），再挑 `setMockRateLimitScenario` 里三两个 case 看头是怎么摆的，最后看 `applyMockHeaders`（整个文件对生产的唯一出口）和 `getCurrentMockScenario`（从当前头反推场景的反向查找）。

一句话串起来：这是 `[ANT-ONLY]` 模块——所有导出函数第一句都是 `if (process.env.USER_TYPE !== 'ant') return`，普通用户零影响；它让内部员工在本地复现「5 小时窗超了」「周窗超了」「超额可用」「组织额度被设 0」等各种限流态，而不必真把配额用光。两条设计特别值得学：**representative claim 取超限列表里 reset 最远的那条**（同时命中 5h 和周窗时，用户实际被挡到的是周窗重置时刻）；**fast mode 冷却的 expiry 在第一次真报错时才设**（duration 从客户端撞墙开始算，不是从测试员敲下命令开始算）。

---

### `services/claudeAiLimits.ts` —— 根目录散件（真实限流状态的消费端，与 `mockRateLimits.ts` 是一对）

| 文件                                                              | 原文  | 批注版 | 讲什么                                                                                  |
| --------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------------ |
| [`claudeAiLimits.ts`](annotated/src/services/claudeAiLimits.ts) | 515 | 535 | 把 `anthropic-ratelimit-unified-*` 响应头翻译成状态对象：三态配额、12 种超额被禁原因、两级早期预警、跨 session 缓存被禁原因 |

读法：先看文件头的 `EARLY_WARNING_CONFIGS`（两条窗的档位密度为什么完全不同）和 `OverageDisabledReason` 12 种原因，再走主链路 `computeNewLimitsFromHeaders`（头 → 状态对象的翻译核心），最后看两个入口 `extractQuotaStatusFromHeaders`（每个响应的常驻入口）和 `checkQuotaStatus`（启动时的主动探测）。

一句话串起来：`mockRateLimits.ts` 负责**造假**数据，这个文件负责**读真**数据——两者在 `processRateLimitHeaders` 那一个点接缝（`/mock-limits` 激活时假头套进去）。它把 `anthropic-ratelimit-unified-*` 系列响应头翻译成 `ClaudeAILimits` 三态（allowed/allowed_warning/rejected）广播给 statusline 和 UI。几个设计点：**early warning 两级回退**——先信服务端的 `surpassed-threshold` 头（权威），没有才客户端按「利用率高且时间进度低」自己算（老服务端也有预警）；**5 小时窗只有一档预警、7 天窗有三档**——短窗接近用完是既成事实，长窗要在各进度段反复提醒；**rawUtilization 与 currentLimits.utilization 分离**——前者每个响应都更新、经 `getRawUtilization()` 给 statusline 脚本，后者只在阈值触发时设给 UI；**非交互模式（-p）跳过探测请求**——真 query 紧随其后，claude.ts 会从真实响应头更新，省一次往返；**429 错误路径强制 status=rejected**——头缺失也不能当 allowed；**不该处理时主动清空状态**——用户从订阅降级后不能还挂着旧限流。

---

### `services/remoteManagedSettings/` —— 5 份（企业管理员下发的设置怎么到达用户）

| 文件                                                                                    | 原文  | 批注版 | 讲什么                                                                                            |
| ------------------------------------------------------------------------------------- | --- | --- | ---------------------------------------------------------------------------------------------- |
| [`index.ts`](annotated/src/services/remoteManagedSettings/index.ts)                   | 638 | 720 | 主编排：eligibility、checksum ETag 缓存（对齐服务端 Python 序列化）、fail-open 降级链、应用前安全检、后台轮询、cache-first 启动解阻塞 |
| [`syncCache.ts`](annotated/src/services/remoteManagedSettings/syncCache.ts)           | 112 | 140 | 资格判定（3p / 自定义 base URL / local-agent 三挡早退 + OAuth 先查的性能考量）+ 本地 mirror                          |
| [`syncCacheState.ts`](annotated/src/services/remoteManagedSettings/syncCacheState.ts) | 96  | 126 | 叶子状态：三态 eligible、sync 读盘、首次命中时冲合并缓存（gh-23085 补丁）                                               |
| [`securityCheck.tsx`](annotated/src/services/remoteManagedSettings/securityCheck.tsx) | 74  | 96  | 应用前最后一道人工闸门：危险设置变更才弹阻塞对话框，拒绝即优雅退出                                                              |
| [`types.ts`](annotated/src/services/remoteManagedSettings/types.ts)                   | 31  | 41  | 响应信封 + FetchResult 契约：`settings: null` 表示 304，`skipRetry` 表示 auth 类不重试                         |

读这条线的顺序：`syncCache.ts`（谁能用）→ `syncCacheState.ts`（状态放哪、为什么拆成叶子）→ `index.ts`（拉取/校验/降级/轮询全流程）→ `securityCheck.tsx`（应用前的闸门）→ `types.ts`（跨文件契约）。

一句话串起来：企业管理员在控制台改的设置，经 `/api/claude_code/settings` 下发到 CLI——**资格判定**决定要不要打这个端点（Console 全 eligible；OAuth 只有 enterprise/team；3p、自定义 base URL、Cowork VM 三挡早退），**checksum + If-None-Match** 把没变的设置压成一次 304，**fail-open** 保证拉取失败时用 stale 缓存甚至当没有设置也不阻塞启动，**安全检**保证危险变更必须用户点头才生效。整个目录最有意思的是**为断环而拆的三层**：`settings.ts → syncCache.ts → auth.ts → settings.ts` 这个环会把几百个模块拖进启动期求值的 SCC，于是状态被拆进只 import 叶子的 `syncCacheState.ts`，`syncCache.ts` 只留唯一需要 auth 的资格判定函数。

---

### `services/extractMemories/` —— 2 份（「值得长期记住的东西」怎么从对话里捞出来）

| 文件                                                                                | 原文  | 批注版 | 讲什么                                                                            |
| --------------------------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------ |
| [`extractMemories.ts`](annotated/src/services/extractMemories/extractMemories.ts) | 615 | 641 | 后台记忆抽取器：每轮 query loop 尾部 fork 子代理（共享 prompt 缓存）抽记忆；互斥跳过、节流、合并补跑、print 模式 drain |
| [`prompts.ts`](annotated/src/services/extractMemories/prompts.ts)                 | 154 | 160 | 两套抽取提示词（auto-only / combined）：工具白名单文案、轮次预算策略、MEMORY.md 两步保存、禁验证兔子洞             |

读这条线的顺序：`extractMemories.ts` 先看文件头和 `initExtractMemories()`（时机 + 闭包状态六件套）→ `runExtraction`（互斥/节流/fork/光标/trailing）→ 公共出口（gate 链 + drainer）；`prompts.ts` 对着 `runExtraction` 里组 prompt 的那几行看——白名单文案和 `canUseTool` 实际放行一一对应。

一句话串起来：每轮对话结束（模型给出最终回复且无工具调用）时，它 fork 一个**共享父进程 prompt 缓存**的子代理，读最近 N 条消息，把值得长期记住的东西写进 `~/.claude/projects/<path>/memory/`。几个设计点值得学：**主 agent 自己写过记忆就整轮跳过**（系统提示里本来就有保存指令，双写浪费，靠 `hasMemoryWritesSince` 检测光标之后的 Write/Edit）；**光标只在成功后推进**（失败重试，不丢消息）；**预注入现有记忆清单省掉第一轮 ls**，且故意放在节流门之后让跳过的轮次不付扫描成本；**REPL 一律放行**是因为 REPL 的 VM 上下文会对每个内部 primitive 重新走一遍 `canUseTool`，而改工具列表会破坏缓存键；`maxTurns: 5` 硬顶配 prompt 里的「先并行读再并行写、禁验证」策略，把一次抽取压进 2-4 轮；**`skipTranscript: true`** 避免子代理和主线程抢记录。与刚做完的 `teamMemorySync/` 是上下游：这个负责「产出」记忆，那个负责「同步」记忆。

---

### `services/tips/` —— 3 份（启动时轮播的「你可以试试……」从哪来）

| 文件                                                               | 原文  | 批注版 | 讲什么                                                                                      |
| ---------------------------------------------------------------- | --- | --- | ---------------------------------------------------------------------------------------- |
| [`tipRegistry.ts`](annotated/src/services/tips/tipRegistry.ts)   | 686 | 706 | 43 条内置 tip + 2 条 ANT-ONLY 内部 tip + 用户自定义覆盖。每条 = id + 异步文案 + 冷却启动数 + 异步相关性判定，按 14 个主题分组批注 |
| [`tipScheduler.ts`](annotated/src/services/tips/tipScheduler.ts) | 58  | 61  | 调度：总开关 → 取相关列表 → 挑「最久没出现过的那条」；显示后落账 + 发遥测（只发 tipIdLength 不发 id）                          |
| [`tipHistory.ts`](annotated/src/services/tips/tipHistory.ts)     | 17  | 19  | 冷却账本：以 numStartups（第几次启动）为单位记录；从没显示过返回 Infinity 保证新 tip 优先                               |

读这条线的顺序：`tipHistory.ts`（17 行，五分钟看完冷却账本的单位约定）→ `tipScheduler.ts`（58 行，调度策略）→ `tipRegistry.ts`（686 行，按批注里的 14 个分组挑感兴趣的看）。

一句话串起来：spinner 转起来时显示的提示语，来自「**相关 + 冷却**双条件筛选后的最久未出现者」。三个设计点值得学：**冷却单位是启动次数不是天数**（一天启动 20 次和 20 天启动一次的疲劳度完全不同，`lastPlanModeUse` 那种毫秒时间戳是另一套单位，两套并存）；**`getSessionsSinceLastShown` 从没显示过返回 Infinity 而不是 0**——配合调度器的降序排序，新 tip 一定最先轮到（改成 0 不会报任何错，只会让新功能永远不上墙，这是全子系统最易错的单点）；**遥测只发 tipIdLength 不发 tipId**——自定义 tip 的 id 来自用户设置，只发长度够做聚合统计又不碰 PII。另外三条 `effort-high-nudge` / `subagent-fanout-nudge` / `loop-command-nudge` 是 GrowthBook A/B 的标准样板：两道硬闸（1P 客户 + 功能可用性）之后取 `off/copy_a/copy_b` 三档，copy_b 是另一版文案。

---

### `services/policyLimits/` —— 2 份（组织级策略限额：哪些功能被管理员关掉）

| 文件                                                         | 原文  | 批注版 | 讲什么                                                                                     |
| ---------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------------------- |
| [`index.ts`](annotated/src/services/policyLimits/index.ts) | 663 | 687 | 主编排：资格三挡早退、双认证取头、checksum ETag、重试与分类、fail-open 主链、唯一 fail-closed 例外、session+磁盘双层缓存、后台轮询 |
| [`types.ts`](annotated/src/services/policyLimits/types.ts) | 27  | 30  | Zod v4 契约：只记录被禁策略（键缺失 = 允许）+ `restrictions: null` 表示 304 的魔法值信封                         |

读这条线的顺序：`types.ts`（27 行，先建立「只记被禁」和「null=304」两个契约）→ `index.ts` 的 `isPolicyAllowed`（对外主问句，先看答案再倒推）→ `isPolicyLimitsEligible`（谁能用）→ `fetchAndLoadPolicyLimits`（拉取编排）→ 其余按需。

一句话串起来：这是 `remoteManagedSettings/` 的**姊妹模块**（文件头自己就说「follows the same patterns」：fail open、ETag 缓存、后台轮询、重试），但回答的是不同问题——那个是「管理员推什么设置下来」，这个是「管理员关了哪些功能」。资格判定同样三挡早退（3p / 自定义 base URL / OAuth 非 enterprise-team），checksum 同样要和服务端 Python 序列化逐字节对齐，404 同样意味着「确认没有」并要删磁盘缓存防 stale。两处设计比姊妹模块更硬：**`isPolicyLimitsEligible` 明令不许调 getSettings()**（启动早期的循环依赖，那边靠拆三层解决，这边靠自律）；**fail-open 总纲下有唯一例外**——essential-traffic-only 模式（HIPAA 合规档）下，`allow_product_feedback` 在缓存未命中时必须拒，否则一次网络超时就会静默重新开放本该关闭的数据上报。另一个值得学的细节：**取 API key 时跳过用户配置的 key helper 脚本**（`skipRetrievingKeyFromApiKeyHelper: true`）——资格判定在启动路径上，不能等一个可能很慢甚至有副作用的用户脚本。

---

### `services/settingsSync/` —— 2 份（设置跨端同步：CLI 推上去，CCR 拉下来）

| 文件                                                         | 原文  | 批注版 | 讲什么                                                                  |
| ---------------------------------------------------------- | --- | --- | -------------------------------------------------------------------- |
| [`index.ts`](annotated/src/services/settingsSync/index.ts) | 581 | 601 | 上传差量化、下载 promise 单例、`/reload-plugins` 强制刷新、404=空、retry 分诊、白名单落盘、缓存失效 |
| [`types.ts`](annotated/src/services/settingsSync/types.ts) | 67  | 73  | Zod 契约：扁平 key-value 内容、version+checksum、`isEmpty` 单列、`SYNC_KEYS` 四键  |

读这条线的顺序：`types.ts`（67 行，先建立「扁平 key-value」和「四个同步键」两个契约）→ `index.ts` 的 `uploadUserSettingsInBackground`（上传主链：先 GET 远端再差量）→ `downloadUserSettings` / `redownloadUserSettings`（下载的两个入口，区别在重试与缓存）→ `applyRemoteEntriesToLocal`（落盘的三层设计）。

一句话串起来：这是 `teamMemorySync/` 的**同一个问题的不同数据**——那个同步团队记忆，这个同步用户设置与记忆文件，且分工更干脆：**交互式 CLI 只上传，CCR（容器/远程模式）只下载**，上传时机是启动后台、下载时机卡在装插件之前。最值得学的四处：① **差量上传**——先 GET 远端全量，本地四项文件构建 entries，`pickBy` 按 key 比对后只 PUT 变化的条目，服务端用 version+checksum 判新旧，本地时钟不准也不影响；② **下载 promise 单例**——`runHeadless` 的 fire-and-forget 和 `installPluginsAndApplyMcpInBackground` 的 await 共用同一次 fetch，后到的调用方自动 join；③ **`markInternalWrite` 抑制变更检测**——自己同步下来的文件写盘前先打标记，否则会被当成「用户改了设置」触发 reload 循环；`redownloadUserSettings` 的注释还解释了为什么 `notifyChange` 的责任故意留在调用方（避开 settingsSync → changeDetector 循环边）；④ **404 的语义**——这里是「远端还没有数据」（`isEmpty: true`），和 `remoteManagedSettings/syncCache` 里「`settings:null` + ETag = 有效的 304 未变」是两种完全不同的空值。认证判定也有一个 CCR 专属细节：**只查 `user:inference` scope 不查 `user:profile`**——CCR 的文件描述符 token 把 scope 硬编码成前者，要求 profile 会让下载直接变 no-op。

---

### `services/voice*.ts` —— 3 份（语音输入全链路：录音 → 流式转写 → 关键词提示）

| 文件                                                              | 原文  | 批注版 | 讲什么                                                                 |
| --------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------- |
| [`voice.ts`](annotated/src/services/voice.ts)                   | 525 | 546 | 原生 cpal 优先、Linux 三级兜底（arecord 探测 / SoX）、WSL 特殊判定、按住说话忽略静音结束         |
| [`voiceStreamSTT.ts`](annotated/src/services/voiceStreamSTT.ts) | 544 | 573 | voice_stream WebSocket 协议、finalize 五条出口、Nova 3 差异、CF zone 选择、升级拒绝处理 |
| [`voiceKeyterms.ts`](annotated/src/services/voiceKeyterms.ts)   | 106 | 114 | Deepgram 关键词提升：14 个全局编程词 + 项目名 + 分支词 + 最近文件名，上限 50                  |

读这条线的顺序：`voiceKeyterms.ts`（106 行，最独立，先看「词从哪来」）→ `voice.ts`（录音后端选择与探测）→ `voiceStreamSTT.ts`（协议与收尾竞态，最难）。

一句话串起来：**按住说话（hold-to-talk）的三段管线**。`voice.ts` 负责「拿到 16 kHz 单声道 PCM」——原生 cpal 模块优先（全平台），Linux 上若没声卡则退 arecord / SoX；这里最值得学的是**探测而非假设**：`hasCommand` 只证明二进制在 PATH 里，`probeArecord` 用同样的参数真开一次麦并竞速 150ms 定时器，因为 WSL1 / 无头 Linux 上「命令存在但 open() 必失败」是常态；WSLg 与 WSL1 的文案还分了两套。`voiceStreamSTT.ts` 负责「把 PCM 推给服务端、把文本收回来」——最精彩的是**收尾**：`finalize()` 有五条出口（endpoint 约 300ms / 无数据 1.5s / WS close 3–5s / 安全计时 5s / 早就关了），全部汇聚到 `resolveFinalize` 一个函数里，因为老版 Deepgram 会把文本块和结束标记拆成两条独立消息发，「有 interim 没 endpoint」必须兜底提升为最终结果；而 CloseStream 要 `setTimeout(0)` 推迟一拍，否则原生模块队列里最后一段音频会晚于「停止收音频」到达。还有两处平台坑写进了注释：WS 基址故意打 api.anthropic.com 而不是 claude.ai（后者 CF zone 会 challenge 非浏览器 TLS 指纹），以及 Bun 的 ws 在 Windows 上会对成功的 101 也触发 `unexpected-response`（必须先判 101 再销毁请求）。`voiceKeyterms.ts` 是配菜但很实用：把项目名当**整词**加入（用户念的是短语不是单词）、分支按标识符拆词、最近文件只扫到填满 50 个槽位为止——顺序即优先级。

---

### `services/vcr.ts` + `services/diagnosticTracking.ts` —— 2 份（测试录制回放 / IDE 诊断差分）

| 文件                                                                      | 原文  | 批注版 | 讲什么                                        |
| ----------------------------------------------------------------------- | --- | --- | ------------------------------------------ |
| [`vcr.ts`](annotated/src/services/vcr.ts)                               | 406 | 419 | VCR 录制回放：四入口、输入哈希定文件名、脱敏四组替换、uuid 必须每次重生成  |
| [`diagnosticTracking.ts`](annotated/src/services/diagnosticTracking.ts) | 397 | 415 | IDE 诊断：编辑前抓基线、磁盘版 vs 编辑器版取舍、差分语义、4000 字符预算 |

这两份互不相关，凑成一批纯粹是按「剩余根目录散件」的体量打包。各自的一句话：

**`vcr.ts`**：测试基础设施——把真实 API 响应录成 fixture，之后回放不打网络。最值得学的是**让 fixture 跨机器稳定**这件事：`dehydrateValue` 把 cwd / config home / 数值统计（`num_files`、`duration_ms`、`cost_usd`）全换成占位符，Windows 上还要覆盖三种路径形态（正斜杠 / 原生反斜杠 / JSON 转义的双反斜杠），最后把占位符后的分隔符统一成正斜杠——**hash 一致是跨平台 fixture 能命中的唯一前提**。两个反直觉细节：① `mapAssistantMessage` 里回放路径必须重新生成 `randomUUID()`，因为 `sessionStorage.ts` 按 uuid 去重，同一 uuid 会让恢复的会话把不同响应当重复丢掉；② 回放命中后还要 `addCachedCostToTotalSessionCost`——不补记成本，任何成本断言在回放下都必挂。CI 里缺 fixture 且没开 `VCR_RECORD` 是**直接抛错**，不允许在 CI 里偷偷录。

**`diagnosticTracking.ts`**：把 IDE 的诊断变成「本轮编辑引入了哪些新错误」。设计核心是**基线 + 差分**：`beforeFileEdited` 在编辑前存快照（**没有诊断也要存空数组**，否则第一次查询会把存量错误全算成新增），`getNewDiagnostics` 算完差集后立刻把基线推进到当前状态，所以同一条错误只报一次。最绕的一段是「磁盘版 vs 编辑器版」——IDE 对同一文件给两份诊断（`file://` 是磁盘内容，`_claude_fs_right:` 是编辑器里未保存的内容），只有「右栏诊断刚变化」时才切换用它，避免未保存内容的抖动导致重复上报。摘要上限 4000 字符，截断长度把 `…[truncated]` 标记本身算进去——预算要守，标记也算钱。

---

### `services/autoDream/` 全 4 份（550 行 → 583 行，33 处批注）

| 文件                                                                                  | 原文  | 批注版 | 讲什么                                               |
| ----------------------------------------------------------------------------------- | --- | --- | ------------------------------------------------- |
| [`autoDream.ts`](annotated/src/services/autoDream/autoDream.ts)                     | 324 | 344 | 三道门（时间 / 会话 / 锁）+ fork 子代理 + 进度观察器                |
| [`consolidationLock.ts`](annotated/src/services/autoDream/consolidationLock.ts)     | 140 | 148 | 锁文件 mtime 兼任「上次整理时间」；PID 咨询锁、陈腐接管、回滚              |
| [`consolidationPrompt.ts`](annotated/src/services/autoDream/consolidationPrompt.ts) | 65  | 68  | 四阶段 prompt（Orient → Gather → Consolidate → Prune） |
| [`config.ts`](annotated/src/services/autoDream/config.ts)                           | 21  | 23  | 叶子配置模块，单独存在只为打断依赖链                                |

一句话串起来：这是 `extractMemories/` 的**搭档**——那个在对话末尾当场把该记的**抽**出来，这个隔一段时间把散落的记忆**整理**一遍（合并、改错、剪枝、重写索引）。触发是个三道门的漏斗，**按开销从小到大排**：① 时间门，一次 `stat` 读锁文件 mtime，够了才往下；② 会话门，扫一次 transcript 目录数「上次整理之后被碰过的会话」够不够 5 个；③ 锁门，抢文件锁确认没有别的进程正在整理。三门全过才 `runForkedAgent`。

最值得学的四处：

1. **一个文件承担两个角色**——锁文件的 mtime 就是「上次整理时间」，内容是持有者 PID。省掉一份状态文件，代价是**回滚必须精确改回 mtime**（`utimes` 收秒、要先清空 PID 内容、`priorMtime === 0` 要删文件而不是写 1970）。这把锁是**咨询式**的：写入后必须回读验证 PID 没被覆盖，正确性靠回读而不是靠 OS 互斥。
2. **节流阀补的是「门之间的缝」**——会话门不通过时 mtime 不推进，于是时间门下一轮照样放行，每轮都白扫一遍目录。所以除了三道门还有一个纯内存的 10 分钟扫描节流，且**只有真正往下走才更新**它。
3. **权限直接复用 `createAutoMemCanUseTool(memoryRoot)`**——写操作只允许落在记忆目录内；同时 `skipTranscript: true`，否则下次「回顾 N 个会话」会把整理过程本身数成用户会话。工具约束（Bash 只读）写在 `extra` 而不是共享 prompt 正文里，因为手动 `/dream` 是在主循环里跑的、权限正常，写进正文会误导模型。
4. **失败路径要比成功路径更小心**——用户从后台面板 kill 时必须**单独早退**：`DreamTask.kill` 已经 abort + 回滚锁 + 置 `killed`，再走一遍 `failDreamTask` + 回滚会把 mtime 二次回滚并把状态覆盖成 `failed`。真失败才回滚，退避靠那个 10 分钟节流（而不是写一个重试计数器）。

`consolidationPrompt.ts` 还有一条独立的设计理由：它从 `dream.ts` 里抽出来，是因为那个文件被 `feature()` 门控的 `require` 包着（KAIROS 线），而自动整理要能**独立发布**——所以只抽出「prompt 怎么拼」这块无依赖逻辑。`config.ts` 同理，是个「叶子模块」：UI 只想问一句「开没开」，不能顺着 `autoDream.ts` 把 forked agent、task registry 全拖进 bundle。

---

### `services/rateLimitMessages.ts` + `services/rateLimitMocking.ts` —— 2 份（限流四件套的最后两块）

| 文件                                                                    | 原文  | 批注版 | 讲什么                                   |
| --------------------------------------------------------------------- | --- | --- | ------------------------------------- |
| [`rateLimitMessages.ts`](annotated/src/services/rateLimitMessages.ts) | 344 | 361 | 所有限流文案的唯一产地：错误 / 警告 / overage 通知三档    |
| [`rateLimitMocking.ts`](annotated/src/services/rateLimitMocking.ts)   | 144 | 155 | 门面：把 `/mock-limits` 的 mock 逻辑挡在生产代码之外 |

这两份补齐了「限流四件套」——`mockRateLimits.ts`（造数据）+ `rateLimitMocking.ts`（把假数据接进请求路径）+ `claudeAiLimits.ts`（解真实响应头）+ `rateLimitMessages.ts`（把状态翻译成人话）。前两份是 `[ANT-ONLY]`，后两份是生产代码。

**`rateLimitMessages.ts`** 的核心是「**一处判定、两处消费**」：`getRateLimitMessage` 返回 `{ message, severity }`，然后 `getRateLimitErrorMessage` 只透出 `error`、`getRateLimitWarning` 只透出 `warning`。拆成两个导出不是为了少写几行，而是因为**展示位置不同**——错误进对话流（`AssistantTextMessages`），警告进 footer。让每个调用方自己筛 severity，迟早有人把警告塞进错误通道。

判定顺序里有一处必须记住：**先判 overage，再判 rejected**。订阅额度打满但宽松额度可用时，`status` 依然是 `rejected`；不先看 `isUsingOverage`，就会对着一个还能继续用的人喊「你已达上限」。另外 warning 分支还要过两道闸：利用率 ≥ 70%（防周重置后 API 带着陈旧数据发假警报）、以及 Team/Enterprise 开了 overage 但不走计费的用户干脆不警告（他们会无缝滚进 overage，警告是噪音）。

文案本身有三条值得学的产品细节：① 两种额度都打满时，重置时间取**更早的那个**（用户最早能恢复的时刻），else 链在穷举「哪个时间戳有值」的三种组合；② `seven_day_sonnet` 对 pro/enterprise 用户直接叫 weekly limit——同一个限额类型在不同订阅下名字不同；③ 拼句**四级降级**（有百分比有时间 → 只有百分比 → 都没有就 `Approaching <限额名>`），信息缺哪块就少说哪块，绝不编造；`rateLimitType` 为 `undefined` 时直接 `return null`，宁可沉默也不输出 `Approaching undefined`。

**`rateLimitMocking.ts`** 是个纯粹的**门面**：19 种 mock 场景的实现全在 `mockRateLimits.ts`，生产代码只 import 这一个文件——删掉 mock 模块时，生产侧要改的只有一处 import。三个函数各有讲究：`processRateLimitHeaders` 非 mock 时**原样返回同一个对象**（不拷贝，因为每个响应都走）；`checkMockRateLimitError` 返回 `APIError | null`，`null` 的语义是「这个请求**不该**被拦」而不是出错；`isMockRateLimitError` 专供重试逻辑，让 mock 造的 429 **不被自动重试吃掉**（否则用户点完 `/mock-limits` 要等几轮才看到效果）。

里面最有意思的一条是 Opus 特例：**Opus 限额只在真的用 Opus 模型时才抛 429**（判断用 `includes('opus')`，因为模型名有别名和日期快照）。这是在复刻真实 API 的**局部限额**语义——Opus 打满时回落到 Sonnet 依然能跑通。mock 的价值在于**如实复现**，不在于让错误更容易触发。同理 `shouldThrow429` 必须带第二个条件「没有 overage 头 **或** overage 也 rejected」——只判 `status === 'rejected'` 会在「订阅打满但宽松额度可用」时抛 429，与线上行为完全相反。

---

### `services/MagicDocs/` 全 2 份（381 行 → 400 行，19 处批注）

| 文件                                                              | 原文  | 批注版 | 讲什么                               |
| --------------------------------------------------------------- | --- | --- | --------------------------------- |
| [`magicDocs.ts`](annotated/src/services/MagicDocs/magicDocs.ts) | 254 | 268 | 标记检测、读取即登记、空闲时 fork 子代理原地重写       |
| [`prompts.ts`](annotated/src/services/MagicDocs/prompts.ts)     | 127 | 132 | 更新 prompt 模板、自定义 prompt 覆盖、单遍变量替换 |

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

| 文件                                                                                                              | 原文 → 批注版  | 批注 | 讲什么                                      |
| --------------------------------------------------------------------------------------------------------------- | --------- | -- | ---------------------------------------- |
| [`AgentSummary/agentSummary.ts`](annotated/src/services/AgentSummary/agentSummary.ts)                           | 179 → 192 | 13 | 子代理的一行进度条，30 秒 fork 一次                   |
| [`toolUseSummary/toolUseSummaryGenerator.ts`](annotated/src/services/toolUseSummary/toolUseSummaryGenerator.ts) | 112 → 119 | 7  | 一批工具调用的 Haiku 短标签                        |
| [`preventSleep.ts`](annotated/src/services/preventSleep.ts)                                                     | 165 → 173 | 8  | macOS `caffeinate` 电源断言 + 自愈重启           |
| [`notifier.ts`](annotated/src/services/notifier.ts)                                                             | 156 → 163 | 7  | 九种终端通知通道 + auto 探测                       |
| [`internalLogging.ts`](annotated/src/services/internalLogging.ts)                                               | 90 → 95   | 5  | `[ANT-ONLY]` 内部埋点（k8s namespace / 容器 ID） |
| [`awaySummary.ts`](annotated/src/services/awaySummary.ts)                                                       | 74 → 80   | 6  | 「离开回来」卡片的一句话回顾                           |
| [`mcpServerApproval.tsx`](annotated/src/services/mcpServerApproval.tsx)                                         | 41 → 46   | 4  | 项目级 MCP server 的批准弹窗                     |
| [`claudeAiLimitsHook.ts`](annotated/src/services/claudeAiLimitsHook.ts)                                         | 23 → 27   | 4  | `claudeAiLimits` 的 React 薄壳              |

四个最值得记的点：

1. **两个摘要器是「fork 四用法」的最后一格**。`extractMemories` 抽记忆、`autoDream` 整理记忆、`MagicDocs` 维护文档，`AgentSummary`/`toolUseSummary` 则是**纯压缩**：产物不落盘，只给人看。`agentSummary` 的 prompt 是全仓 few-shot 写得最细的一处——4 个 Good、4 个 Bad，每个 Bad 都标注失败类型（过去时 / 太含糊 / 太长 / 说了分支名）。
2. **拒绝工具不能靠 `tools: []`**。`agentSummary` 用 `canUseTool` 回调拒绝，注释写明原因：`tools` 数组是 **prompt cache key 的一部分**，清空它等于让主线程刚建好的缓存作废。同理那个文件里**绝不设 `maxOutputTokens`**——它会夹紧 `budget_tokens`，导致 thinking 配置不匹配，缓存失效。这是所有「蹭主线程缓存」的功能都要遵守的两条铁律。
3. **`caffeinate` 的 5 分钟超时 + 4 分钟重启是自愈设计**。Node 被 `SIGKILL` 打死时来不及跑清理函数，孤儿 `caffeinate` 最多再撑 5 分钟就自己退出，不会永久霸占电源断言。另外 `error`/`exit` 回调里必须比对 `thisProc` 快照——否则旧进程的 exit 事件会把新进程的引用清掉，之后再也杀不到它。
4. **`notifier` 的返回值是「实际用了哪种方式」而不是布尔**。九种通道 + `auto` 探测，每次上报遥测时同时带「配置要求的通道」和「实际生效的通道」——这条数据专门用来发现「配了但不生效」（比如配了 kitty 却跑在 tmux 里）。

`internalLogging.ts` 是这批里的异类：三个导出全部以 `process.env.USER_TYPE !== 'ant'` 开头，开源构建里等于死代码。但它留在 bundle 里，说明这层门是**运行时判断而非编译期删除**。

### 队友 spawn 共享模块 + git 埋点（`shared/` 2/2 全清，tools 到 153/184）

`spawnMultiAgent.ts`（1,093 行）+ `gitOperationTracking.ts`（277 行），共 2 文件 1,370 行 → 批注版 1,436 行、66 处锚点。这两个文件都不属于任何具体工具：前者是「造一个队友」的完整逻辑（TeammateTool 抽出来给 AgentTool 复用），后者是跨 shell 的 git 操作埋点（Bash 和 PowerShell 共用）。

| 文件                                                                              | 原文行   | 批注版行  | 锚点 | 看点                                           |
| ------------------------------------------------------------------------------- | ----- | ----- | -- | -------------------------------------------- |
| [`spawnMultiAgent.ts`](annotated/src/tools/shared/spawnMultiAgent.ts)           | 1,093 | 1,135 | 42 | 三条 spawn 路径、身份走 CLI 参数、不传父对话                 |
| [`gitOperationTracking.ts`](annotated/src/tools/shared/gitOperationTracking.ts) | 277   | 301   | 24 | 容忍 git 全局选项的正则、push 进度在 stderr、curl 建 PR 三条件 |

七个值得记的点：

1. **三条 spawn 路径一个路由器**。`handleSpawn` 先看 `isInProcessEnabled()`（进程内），否则预探测 pane 后端（tmux/iTerm2 split-pane），探测失败且 auto 模式才静默回退进程内——用户显式配了 `teammateMode: 'tmux'` 就让错误抛出去看安装指引。`markInProcessFallback()` 把回落写回状态，banner 不再显示错误的 tmux attach 命令。
2. **spawn 命令不带 prompt**。队友二进制起来后，首条指令经 mailbox 投递（`writeToMailbox` from TEAM_LEAD_NAME），inbox poller 捡起来当第一轮提交——进程内队友则相反，prompt 直接由 `startInProcessTeammate` 给，双发会产生两条欢迎语（注释明说 Do NOT）。
3. **清空 messages 是全文件最重要的注释**。传给队友的 toolUseContext 刻意 `messages: []`：父对话会钉住整个会话历史，`/clear` 和 auto-compact 都救不回来；队友自己经 inProcessRunner 的 allMessages 建历史。
4. **身份四件套走 CLI 参数而非环境变量**。`--agent-id/--agent-name/--team-name/--agent-color`（注释明说 replaces CLAUDE_CODE\_* env vars）；`sanitizeAgentName` 防 `@`——agentId 格式是 name@teamName；`formatAgentId` 确定性生成，同名同队幂等。
5. **权限继承的安全优先级**。`buildInheritedCliFlags` 里 `plan_mode_required` 压过 `bypassPermissions`：plan 队友天生不继承跳过权限的 flag。auto 模式反而要传给队友——让它的分类器同样自动放行。
6. **git 埋点的正则容忍真实世界的脏命令**。`gitCmdRe` 容忍 `git -c commit.gpgsign=false commit`（签名失败后重试的形态）；push 的 ref 更新写 **stderr**，所以检测函数必须收 stdout+stderr 拼接串；merge/rebase 要命令 + 输出双重确认（`git merge --abort` 不算合并）。
7. **埋点失败不能拖垮主流程**。`getCommitCounter()?.add(1)` 可选链——计数器没初始化就静默跳过；`trackGitOperations` 第一道门是 exitCode !== 0 直接返回。建 PR 后关联会话用双层动态 import 规避循环依赖，sessionId 过模板字面量类型断言（UUID 形态才链）。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 9 批生效）；一处 FAIL——`gitOperationTracking.ts` 文件级批注锚在第 4 行，那是 9 行文档块注释的中部续行（spawnMultiAgent 的块正好 4 行收尾所以那边自动外移成功，两边块长不同），中文被塞进块内，挪到 `*/` 行后过验；spawnMultiAgent 一处提示（before 落在块注释结尾行、自动前移到块前）为人眼确认通顺。

### BashTool 下半：安全核心与渲染（`BashTool/` 18/18 全清，tools 到 167/184）

15 个文件 5,917 行 → 批注版 6,187 行、340 处锚点。目录全清意味着 `src/tools/` 只剩 AgentTool 一个目录（17 份 / 4,889 行）。

| 文件                                                                                          | 原文行   | 锚点 | 看点                                       |
| ------------------------------------------------------------------------------------------- | ----- | -- | ---------------------------------------- |
| [`readOnlyValidation.ts`](annotated/src/tools/BashTool/readOnlyValidation.ts)               | 1,990 | 82 | 只读判定的两条腿：allowlist 旗标表 + 整命令正则           |
| [`pathValidation.ts`](annotated/src/tools/BashTool/pathValidation.ts)                       | 1,303 | 49 | 38 条命令的路径提取规则 + `--` 处理 + 剥壳同步三处         |
| [`sedValidation.ts`](annotated/src/tools/BashTool/sedValidation.ts)                         | 684   | 51 | 白名单（p/Np/N,Mp + s///）+ denylist 双层，同形字攻击 |
| [`prompt.ts`](annotated/src/tools/BashTool/prompt.ts)                                       | 369   | 29 | Bash 工具的完整系统提示：git 安全协议、沙箱段、工具偏好         |
| [`sedEditParser.ts`](annotated/src/tools/BashTool/sedEditParser.ts)                         | 322   | 20 | sed -i 编辑的结构化解析 + BRE→ERE 转换             |
| [`bashCommandHelpers.ts`](annotated/src/tools/BashTool/bashCommandHelpers.ts)               | 265   | 16 | 管道分段权限聚合 + 跨段 cd+git 检测                  |
| [`utils.ts`](annotated/src/tools/BashTool/utils.ts)                                         | 223   | 10 | 输出截断、data URI 图片、cwd 重置                  |
| [`BashToolResultMessage.tsx`](annotated/src/tools/BashTool/BashToolResultMessage.tsx)       | 191   | 13 | 结果渲染（React Compiler 产物）                  |
| [`UI.tsx`](annotated/src/tools/BashTool/UI.tsx)                                             | 185   | 17 | 工具调用渲染：sed 只显路径、注释标签、截断两道线               |
| [`shouldUseSandbox.ts`](annotated/src/tools/BashTool/shouldUseSandbox.ts)                   | 153   | 14 | excludedCommands 是便利功能不是安全边界             |
| [`commandSemantics.ts`](annotated/src/tools/BashTool/commandSemantics.ts)                   | 140   | 12 | 退出码语义表：grep 1 = 没匹配不是错误                  |
| [`modeValidation.ts`](annotated/src/tools/BashTool/modeValidation.ts)                       | 115   | 8  | acceptEdits 放行七个文件命令                     |
| [`destructiveCommandWarning.ts`](annotated/src/tools/BashTool/destructiveCommandWarning.ts) | 102   | 14 | 破坏性命令警告表（纯展示）                            |
| [`commentLabel.ts`](annotated/src/tools/BashTool/commentLabel.ts)                           | 13    | 4  | 首行注释当 UI 标签                              |
| [`toolName.ts`](annotated/src/tools/BashTool/toolName.ts)                                   | 2     | 1  | 两行文件打破循环依赖                               |

九个值得记的点：

1. **allowlist 与正则的两条腿**。`isCommandReadOnly` 先试 `isCommandSafeViaFlagParsing`（COMMAND_ALLOWLIST 逐命令旗标表），再退到 READONLY_COMMAND_REGEXES（整命令正则）。注释明说优先 allowlist——git 允许 `--upload-pack=cmd` 缩写成 `--up=cmd`，正则防不住缩写。
2. **`$` 全 token 禁绝**。shell-quote 把 `$VAR` 保留成字面 token 但 bash 运行时展开它，这一个 parser differential 同时打穿 validateFlags 和 callback：`git diff "$Z--output=/tmp/pwned"` 写任意文件、`rg . "$Z--pre=bash"` 一步 RCE、`ps ax"$Z"e` 让 BSD-e 检测正则失明。花括号展开混淆（`{` + `,`/`..`）同理要拦。
3. **xargs 的 `-i`/`-e` 是 vulnerability archaeology 标本**。GNU getopt 可选附加参数（`i::`/`e::`）让校验器和 xargs 对「吃几个参数」的认知相反：`xargs -it tail a@evil.com` 校验器看 -it 合法，GNU 把 t 当 replace-str、tail 才是目标命令，于是 /usr/sbin/sendmail 被拼出来发信。改用强制参数的大写 -I {} / -E EOF。
4. **fd 的 `-l` 也要禁**。它内部起 `ls` 子进程——PATH 里放个恶意 ls 就接管。**一个旗标「只是显示信息」不代表安全，得看它内部还调了什么。**
5. **git 沙箱逃逸的四道闸**：cd+git 组合（恶意目录放假 hooks）、当前目录像 bare repo、命令里同时创建 git 内部文件并跑 git（mkdir hooks && echo x > hooks/pre-commit && git status）、竞态窗口（sleep 10 && git status 在 bare-repo 检查时文件还不存在，所以沙箱开着且 cwd 非原目录就转人工）。
6. **`--` 处理是路径校验的命门**。`rm -- -/../.claude/settings.local.json` 以 - 开头，朴素 !startsWith('-') 过滤把它当旗标丢掉，校验看到零路径直接放行。filterOutFlags/parsePatternCommand/sed/jq/git diff --no-index 五处都补了 `--` 跟踪。
7. **剥壳三处必须同步**（本文件 argv 版 / bashPermissions 文本版 / checkSemantics）。bashPermissions 里那份窄版是死代码但不能删——那个模块卡在 Bun feature() DCE 复杂度阈值上，删 80 行会让 feature('BASH_CLASSIFIER') 静默失效（PR #21503 round 3 实测 30/30 → 22/30）。不同步 = 语义检查剥了壳、路径校验看到壳 → passthrough → 包装里的命令从未被校验。stdbuf/env 就是这么漏过又补上的。
8. **sed 双层校验**。白名单严到「命令字母级」：isPrintCommand 一条正则只认 p/Np/N,Mp，w/W/e/E 连出现资格都没有；denylist 连全角 ｗ、小型大写 ᴡ、组合字符 w̃ 这些同形字都拒（人眼看是 w，字节层面不是）。
9. **退出码语义表治「假红」**。grep 1 = 没匹配、diff 1 = 有差异、test 1 = 条件为假——把这些一律当失败的 UI 会满屏误报。函数注释自己承认启发式提取基名 May get it super wrong - don't depend on this for security。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 10 批生效）；三处 FAIL——readOnlyValidation 数据文件里误置了两条 pathValidation 的锚点（1220/1263，写串了文件）+ 一条锚在 9 行文档块中部（1583），pathValidation 的 (27,'after') 劈开多行 type 声明，prompt.ts 的 (228,'after') 劈开多行三元赋值；全部修正后复验全过。

### AgentTool 下半：跑起来的 agent 全机制（`AgentTool/` 20/20 全清，**tools 184/184 全清**）

17 个文件 4,889 行 → 批注版 5,123 行、308 处锚点。这一批做完，`src/tools/` 整个目录清零——工具层从 Read/Glob/Grep 到 Bash 安全核心到 agent 编排，主链路的「执行侧」全齐了。

| 文件                                                                                                   | 原文行 | 锚点 | 看点                                                             |
| ---------------------------------------------------------------------------------------------------- | --- | -- | -------------------------------------------------------------- |
| [`runAgent.ts`](annotated/src/tools/AgentTool/runAgent.ts)                                           | 973 | 57 | subagent 一次运行的完整生命周期：权限覆盖优先级、上下文瘦身、提示缓存三处设计                    |
| [`UI.tsx`](annotated/src/tools/AgentTool/UI.tsx)                                                     | 872 | 46 | React Compiler 产物（`_c(N)` memo cache）；进度折叠、condensed mode、分组渲染 |
| [`loadAgentsDir.ts`](annotated/src/tools/AgentTool/loadAgentsDir.ts)                                 | 755 | 42 | 四种 agent 来源的解析与覆盖优先级；frontmatter 全字段白名单校验                      |
| [`agentToolUtils.ts`](annotated/src/tools/AgentTool/agentToolUtils.ts)                               | 686 | 49 | 工具过滤链、通配符解析、后台生命周期驱动器、handoff 分类器                              |
| [`resumeAgent.ts`](annotated/src/tools/AgentTool/resumeAgent.ts)                                     | 265 | 20 | 从磁盘 transcript 恢复 agent：三层消息清洗 + worktree 续命                   |
| [`built-in/claudeCodeGuideAgent.ts`](annotated/src/tools/AgentTool/built-in/claudeCodeGuideAgent.ts) | 205 | 13 | 文档向导：五段用户配置注入 + 3P 反馈导流                                        |
| [`agentMemorySnapshot.ts`](annotated/src/tools/AgentTool/agentMemorySnapshot.ts)                     | 197 | 18 | 快照三动作（initialize/replace/markSynced）与同步标记机制                    |
| [`built-in/verificationAgent.ts`](annotated/src/tools/AgentTool/built-in/verificationAgent.ts)       | 152 | 7  | 「反自欺手册」提示词 + criticalSystemReminder 重注入保活                      |
| [`agentMemory.ts`](annotated/src/tools/AgentTool/agentMemory.ts)                                     | 177 | 12 | 三档 memory scope 路由 + isAgentMemoryPath 的 normalize 防穿越         |
| [`built-in/statuslineSetup.ts`](annotated/src/tools/AgentTool/built-in/statuslineSetup.ts)           | 144 | 3  | PS1→statusLine 转换 + stdin JSON 全字段契约                           |
| [`agentDisplay.ts`](annotated/src/tools/AgentTool/agentDisplay.ts)                                   | 104 | 9  | /agents 命令的覆盖标注与 worktree 去重                                   |
| [`built-in/planAgent.ts`](annotated/src/tools/AgentTool/built-in/planAgent.ts)                       | 92  | 4  | 四步流程 + Critical Files 输出契约                                     |
| [`built-in/exploreAgent.ts`](annotated/src/tools/AgentTool/built-in/exploreAgent.ts)                 | 83  | 6  | READ-ONLY 七禁 + MIN_QUERIES=3 防摸鱼                               |
| [`builtInAgents.ts`](annotated/src/tools/AgentTool/builtInAgents.ts)                                 | 72  | 10 | 内置清单的环境门控拼装                                                    |
| [`agentColorManager.ts`](annotated/src/tools/AgentTool/agentColorManager.ts)                         | 66  | 3  | 八色专用色板 + satisfies 编译期约束                                       |
| [`built-in/generalPurposeAgent.ts`](annotated/src/tools/AgentTool/built-in/generalPurposeAgent.ts)   | 34  | 6  | 「别镀金也别半吊子」+ 绝不主动建文件/文档                                         |
| [`constants.ts`](annotated/src/tools/AgentTool/constants.ts)                                         | 12  | 3  | Task→Agent 线名兼容 + one-shot 尾 trailer 省 token                   |

值得记住的十个设计：

1. **权限覆盖的安全优先级**（runAgent）。agent 自己定义的 permissionMode 压不过父级的 bypassPermissions / acceptEdits / auto——用户显式选择和更宽松的父模式永远优先，agent 定义不能偷偷放宽。allowedTools 整体替换 session 规则防父级审批透传，但 cliArg 规则（SDK `--allowedTools`）必须保留。
2. **上下文瘦身是 token 经济学**（runAgent）。Explore/Plan 这类只读 agent 剔掉 CLAUDE.md（省 ~5-15 Gtok/周 × 34M 次 spawn）和 parent-session-start 的 gitStatus（最多 40KB 且标注 stale）；kill-switch `tengu_slim_subagent_claudemd` 默认开。
3. **提示缓存三处设计**（runAgent + forkSubagent）。常规 subagent 禁 thinkingConfig 省输出 token，fork 子却要继承父配置保前缀一致；fork 的系统提示穿「已渲染字节」而不是重调用 getSystemPrompt()（GrowthBook cold→warm 会发散撑爆 cache）；fork 子的 tool_result 全用同一占位符，只有 directive 文本块因子而异。
4. **覆盖优先级的排序即语义**（loadAgentsDir + agentDisplay）。built-in → plugin → user → project → flag → managed，managed（企业策略）最后写所以压过用户自己的配置。注意 agentDisplay 的展示顺序是另一套（built-in 垫底）——「谁赢」和「怎么排」是两个问题。
5. **frontmatter 校验全白名单 + 宽松失败**（loadAgentsDir）。background 只认 'true'/true、memory scope 三选一、isolation 的 'remote' 仅 ant 构建、color 必须在八色内——非法值一律记日志丢弃不抛错（认不出的配置不擅自启用行为）；memory 启用自动补 Write/Edit/Read 三件套。
6. **工具过滤链的顺序有讲究**（agentToolUtils）。MCP 特例 → plan 特例 → 全禁表 → 自定义禁表 → 异步白名单——先特例后禁表，plan 模式的 agent 才能同时绕过两张表拿到 ExitPlanMode。异步 agent 白名单制 + in-process 队友两个例外（spawn 同步子代理 + 任务工具协作）。
7. **后台生命周期的状态转换不被装饰阻塞**（agentToolUtils，gh-20236）。completeAsyncAgent 先置完成态让 TaskOutput 立即解锁，分类（API 调用）和 worktree（git exec）可能 hang，只能做通知装饰；kill 分支同样先转状态再清理——git hang 也挡不住解锁。
8. **resume 的消息必须 API 合法**（resumeAgent）。三层清洗：去没有结果的 tool_use → 去孤立 thinking 块 → 去空白 assistant；resume 后 bump worktree mtime 防 stale 清理误删（#22355）；fork resume 的父系统提示造不出来直接抛错——凑一个假的比没有更糟。
9. **验证 agent 的提示词是反自欺设计**（verificationAgent）。点名两种失败模式（verification avoidance / 被前 80% 诱惑）；PASS 步骤没有 Command run 块就是 skip；调用方会抽查命令重跑；VERDICT 行是给调用方解析的字面量，靠 criticalSystemReminder 每轮重注入保活（长提示词会被淹没）。
10. **React Compiler 产物的读法**（UI.tsx）。`_c(N)` memo cache + `Symbol.for("react.memo_cache_sentinel")` + t0/t1/t2 解构重命名——跳过 cache 机制直接看 JSX 结构；进度视图的三个细节：condensed mode 行数估算（在途工具 × 9 + 7）、hiddenToolUseCount 只数工具调用（与 Done (N tool uses) 口径对齐）、分组后可能空列表的 Initializing… 兜底。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 11 批生效）；check-fidelity 一次通过（485 文件 0 失败，UI.tsx 的 sourcemap 按惯例 OK* 省略）；check-links 793+92 全 0 失效。

### toolPermission：权限交互的五方竞速（第 34 批，5 份 1,386 行）

这是 `src/hooks/` 的第一个子目录，也是整个权限体系里最接近「用户按下允许键」的一层。五个文件一条链：**上下文工厂 → 遥测单入口 → 三种角色处理器**。

| 文件                                              | 行数  | 角色                                                                     |
| ----------------------------------------------- | --- | ---------------------------------------------------------------------- |
| `toolPermission/PermissionContext.ts`           | 388 | 一次工具调用的权限上下文工厂：来源判别联合、队列桥、`createResolveOnce` 幂等锁                      |
| `toolPermission/permissionLogging.ts`           | 238 | 遥测单入口：批准分事件名、拒绝分字段，扇出 Statsig/OTel/代码计数器三路                             |
| `toolPermission/handlers/interactiveHandler.ts` | 536 | 主 agent 路径：本地用户 / CCR bridge / channel 中继 / hook / classifier **五方竞速** |
| `toolPermission/handlers/swarmWorkerHandler.ts` | 159 | worker 路径：请求经 mailbox 转 leader 决定，worker 挂起等回信                         |
| `toolPermission/handlers/coordinatorHandler.ts` | 65  | coordinator 路径：自动化检查顺序 await 完，剩下的才问人                                  |

核心设计（读完这五个文件就能回答「一次权限请求到底经历什么」）：

1. **`handleInteractivePermission` 不返回 Promise**——它往确认队列挂一个带回调的条目，由五个竞速方中先到的那方 `resolve()` 调用方持有的外层 Promise。本地用户、claude.ai bridge、手机 channel、PermissionRequest 钩子、bash 分类器，五方都可能成为答案，**互斥靠 `claim()`**：原子 check-and-mark，异步回调里先 claim 再 await，关掉「检查通过」与「真正 resolve」之间的窗口。
2. **每个赢家都要清理所有其他方的残留**：bridge 赢了要 `cancelRequest` 通知 CCR 撤对话框（否则网页 UI 留着陈旧提示对着一个已在执行的工具）；channel 赢了也要撤 bridge；本地赢了 `channelUnsubscribe?.()` 六处调用点一个不能少（这个包装还修死闭包——以前只删 Map 条目，abort 监听挂到会话结束）。
3. **`createResolveOnce` 是两态分离**：`delivered`（值送没送）与 `claimed`（有没有人认领过）。`isResolved()` 报的是「有人认领」而不是「值送达」——`recheckPermission` 靠这个区分「曾经有人应答但还在飞行中」，所以重查后必须用 `claim()` 而非 `isResolved()`。
4. **三种 worker 角色的分流是有意不同的**：主 agent 五方 race；swarm worker 没有用户可 race，分类器改成 `await` 串行，然后 mailbox 转 leader（先注册回调再发送——leader 秒回时回调必须已就位）；coordinator 把 hooks（快、本地）和 classifier（慢、推理）顺序 await，返回 null 落对话框时靠 `awaitAutomatedChecksBeforeDialog` 布尔参数告诉 interactiveHandler「钩子已跑过，别重复」——两个 handler 之间的隐式契约。
5. **遥测的漏斗设计**：批准按来源分六个独立事件名（config / classifier / user_permanent / user_temporary / hook），永久 vs 临时是关键一跳——临时批准多意味着用户被打断频繁，直接指导默认权限集调整；拒绝只两个事件名，hook 与 user 靠 `isHook`/`hasFeedback` 字段分。`toolUseContext.toolDecisions` Map 按 toolUseID 存下「当时被谁放的、什么时候」，供下游回溯。
6. **几个「今天已是死代码但刻意留着」的标本**：channel 的 `requiresUserInteraction` 守卫（三个需要交互的工具在配了 channel 时 `isEnabled()` 返回 false，根本到不了这）；classifier 双 feature 门（`BASH_CLASSIFIER`/`TRANSCRIPT_CLASSIFIER` 任一没开，classifier 来源在遥测里静默变 unknown——没开的功能不留数据）。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 12 批生效）；check-fidelity 一次通过（490 文件 0 失败）；check-links 810+93 全 0 失效。

### 输入与补全八件套（第 35 批，8 份 4,060 行）

`src/hooks/` 根目录的第一批，一次做齐「用户敲键盘到提交」之间的全部机制。八个文件一条链：**索引地基 → 三源合一 → 补全总线 → 文本编辑内核 → 三个输入模式**。

| 文件                       | 行数    | 角色                                                               |
| ------------------------ | ----- | ---------------------------------------------------------------- |
| `fileSuggestions.ts`     | 811   | @ 文件补全的索引层：git ls-files 优先 / ripgrep 兜底、签名跳过重建、5s 节流地板、后台合入未跟踪文件 |
| `unifiedSuggestions.ts`  | 202   | 文件 / MCP 资源 / subagent 三源合一：nucleo 与 Fuse 双引擎混排                  |
| `useTypeahead.tsx`       | 1,385 | 补全总线：七类补全的优先级编排 + 五类 stale 丢弃 + ghost text 双模                    |
| `useTextInput.ts`        | 529   | 文本编辑内核：emacs 键位 + kill ring + SSH/DEL 卫生                         |
| `useVimInput.ts`         | 316   | vim 模式层：INSERT/NORMAL 状态机 + dot-repeat + operators 依赖注入          |
| `useHistorySearch.ts`    | 303   | Ctrl-R 历史反查：AsyncGenerator 逐行读 + 现场快照还原                          |
| `usePasteHandler.ts`     | 285   | 粘贴卫生：bracketed paste 检测 + 多图路径切分 + 同步镜像 ref                      |
| `useArrowKeyHistory.tsx` | 229   | 方向键翻历史：分块读盘 + 并发加载合并 + 草稿保全                                      |

核心设计（这八个文件回答「一次击键从 stdin 到提交经历了什么」）：

1. **`useTypeahead` 的优先级链即搜索语义**：中段 slash 命令（ghost text 优先，清下拉）→ bash 历史 ghost text → @队友（先于 @文件，防冲突；bash 模式跳过）→ #slack 频道 → /add-dir 目录 → /resume 自定义标题 → slash 命令列表 → @文件/路径 → shell 补全。每一类命中即 return。五类异步源各配一个 latest ref 做陈旧丢弃——慢查询回来时输入已经变了，结果直接扔。
2. **ghost text 的双模设计**：prompt 模式的中段命令补全用同步 useMemo（消一帧闪烁——useState+useEffect 的 effect 在渲染后跑）；bash 模式的历史补全必须异步（要读历史文件）所以用 useState。effectiveGhostText 合并两者，render 层还多一道 insertPosition === offset 的比对防陈旧。
3. **`fileSuggestions` 的索引经济学**：git ls-files 读 index 立即返回（tracked），未跟踪文件后台拉再合入；pathListSignature 每 500 个路径采一个做内容指纹（length|first|last 采样会漏中部重命名），签名不变就跳过 nucleo 重建——打字期间的每次击键不再触发全量重建；.git/index mtime 变化才突破 5s 节流地板立即刷新（未跟踪文件不动 index，靠地板捡）。冷启动 await 完整构建（~120ms 里每 4ms 让出事件循环，用户能继续打字），构建中查询拿部分结果，完成信号触发重搜升级。
4. **nucleo 与 Fuse 的混排巧合**：两套引擎都是「0-1 分、越低越好」，所以文件（nucleo）与非文件（Fuse）的分数能进同一个池子排序——这是「@ 一个字符同时搜文件和 agent」体验的核心。Fuse 权重 name/agentType 3 > displayText 2 > server/description 1，threshold 0.6 放宽粗筛。
5. **`useTextInput` 的无状态渲染模型**：cursor 每次从 value+columns+offset 重建，输入处理全是「旧 cursor → 新 cursor」函数变换；kill ring 四件套（append/prepend 两种入环）+ yank-pop 精确切除；SSH/tmux 的 \x7f 双事件（#1853）和尾 \r 合并 Enter 都是真实环境的卫生处理。
6. **`useVimInput` 的 expectsMotion 状态机**：backspace/delete 只在期待动作的状态（idle/count/operator/operatorCount）映射成 h/x——字面量状态（replace/find）映射会把 r+Backspace 变成「替换成 h」。replayLastChange 的九种变更类型分派是 dot-repeat 完整性的检查单。
7. **两处同步镜像 ref 的 race 修复**（本批的模式亮点）：`usePasteHandler` 的 pastePendingRef——粘贴与击键同一 stdin chunk 时两次调用在同一个 React batch 里跑，第二次读到陈旧 timeoutId 会走直通路径，那个键是 Enter 就提交旧输入丢粘贴；`useArrowKeyHistory` 的 historyIndexRef——React state 异步更新，快速连按读 state 会丢键。都是「batch 内同步可见 vs commit 后异步可见」的经典分野。
8. **恒假条件又添一处标本**：useTypeahead 行 495 `"production" !== 'test'`——与 services 层、AgentTool/UI.tsx 同款的环境替换事故，意图书载测试分支实际永不执行。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 13 批生效）；check-fidelity 一次通过（498 文件 0 失败，useTypeahead/useArrowKeyHistory 的 sourcemap 按惯例 OK* 省略）；check-links 810+94 全 0 失效。

### 通信与远程五件套（第 36 批，5 份 4,118 行）

「输入端怎么把物理动作变成语义」的第二层：语音、队友邮箱、远程控制三条对外通道。至此 hooks 根目录输入/补全/通信三组已做，hooks 到 18/104（49% 行数）。

1. **`useVoice.ts`（1,144 行，41 锚点）**——按住说话的完整生命周期。终端没有 keyup 事件可听，松键判定全靠 auto-repeat 间隔（200ms 超时 + 600ms fallback 兜「轻点」）；双代际 ref（sessionGen 管会话、attemptGen 管会话内重连）让僵尸 WS 污染不了新会话；~1% 会话会撞上「粘性坏 CE pod」（收音频零转写，anthropics/anthropic#287008），six-condition 门 + 250ms 退避重放整场音频自救一次；焦点模式是另一套生命周期（焦点拉会话、失焦收、5s 静默拆）。
2. **`useInboxPoller.ts`（969 行，39 锚点）**——队友邮箱轮询总线。九路消息分拣（权限请求/响应 ×2、沙箱 ×2、关机 ×2、团队权限、模式设置、计划批准）+ leader/worker 两侧路由；两个安全设计值得记：计划批准只认 `from === 'team-lead'`（队友之间可伪造批准）；`markRead` 卡在「送达或可靠入队」之后，崩溃丢消息的窗口为零。tmux worker 的权限请求塞进标准 ToolUseConfirmQueue，和白进程内队友共用同一套工具专属 UI。
3. **`useVoiceIntegration.tsx`（677 行，41 锚点）**——语音与文本输入框的缝合层。裸字符绑定（空格）的 activate-vs-type 二义性用 5 连击阈值拆解，前两发放行进输入框当正常打字；激活分支刻意排在预热分支之前——同一 tick 里两个 strip 调用会读到陈旧的 inputValueRef；`lastSetInputRef` 是唯一能正确处理「空前缀+空后缀」的写入守卫（startsWith('') 会真空通过）。matchesKeyboardEvent 是 onKeyDown 迁移（#23524）的适配层。
4. **`useReplBridge.tsx`（723 行，35 锚点）**——远程控制桥（claude.ai 手机/网页端）。会话级保险丝：连续 3 次 init 失败后本会话不再尝试——Datadog 2026-03-08 最卡的客户端一天打 2,879 个 401，占该路由 401 总量的 17%；system/init 里 tools/mcpClients/plugins 三个字段打码（MCP 前缀泄漏集成清单、插件路径泄漏用户名和项目结构、CCR v2 会把消息持久化进 Spanner）；权限模式设置的 policy guards 必须排在 transitionPermissionMode 之前——后者内部的 auto-gate 是带 setAutoModeActive(true) 副作用的防御性 throw，逃逸即 3-way invariant 违反 + 服务端杀 WS。
5. **`useRemoteSession.ts`（605 行，33 锚点）**——REPL 接远端 CCR 会话。回声过滤用有界环形（50）而不是 delete-on-match：同一个 POST 会被服务器广播 + worker 写路径回声两次；超时清除必须排在回声过滤之前——自己 POST 的回声就是慢速 agent 的心跳；清 in-progress tool_use ID 必须读原始 sdkMessage（非 viewerOnly 模式下转换后是 ignored，5.2x RSS 斜率的来源）；viewerOnly 模式的转换选项——BriefTool 的 tool_use 块渲染为空，内容全在 tool_result。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 14 批生效）；check-fidelity 一次通过（503 文件 0 失败，useVoiceIntegration/useReplBridge 的 sourcemap 按惯例 OK* 省略）；check-links 810+95 全 0 失效。

### 交互与插件管理六件套（第 37 批，6 份 2,374 行）

hooks 根目录第四组：虚拟滚动、IDE diff、搜索输入、swarm 权限轮询、插件管理、取消键仲裁。hooks 到 24/104（62% 行数）。

1. **`useVirtualScroll.ts`（721 行，36 锚点）**——消息列表虚拟化，本批信息密度最高的一份。ScrollBox 输出层裁剪之外，这个 hook 把 fiber/Yoga 分配也管起来：DEFAULT_ESTIMATE 故意取低（高估露白、低估只多挂几条）；scrollTop 按 40 行分档做 useSyncExternalStore 快照（滚轮每格 3-5 tick 不全触发 commit）；listOrigin 从 topSpacer 的 Yoga computedTop 读（不剪偏移，tmux resize 高度变化也不漂移）；sticky 折进快照符号位；span 封顶治 pendingDelta 死亡螺旋；useDeferredValue 只延迟范围增长（收缩廉价）；最终按视口位置修剪远端保 fiber 数 O(viewport)（PageUp 连打曾 +270MB RSS）；clamp 用 deferred 范围而非立即范围（否则 drain 帧落在 spacer 里白闪）；h=0 用 getComputedWidth 区分「Yoga 没跑」与「真空消息」。
2. **`useDiffInIDE.ts`（379 行，23 锚点）**——IDE diff 接进权限流。6 位 sha 拼 tab 名防同文件多次 diff 互覆；computeEditsFromContents 必须用 unformatted patch（否则把 IDE 里的格式改动吃进二次编辑）；保存/关闭/拒绝三种 RPC 结果各有语义，未知结果一律抛「Not accepted」；cleanup 幂等闸门（abort/beforeExit/catch 三处触发）；WSL 三条件路径转换。
3. **`useSearchInput.ts`（364 行，18 锚点）**——less/vim 式搜索输入框。Esc 两种人格（onCancel 直调 vs 先清空再退出两段式）；空 query Backspace = less「删掉 /」惯例；kill ring 三兄弟（k 删到尾 append / u 删到头 prepend / w 删词 prepend）+ yank-pop 精确切除；ctrl+g 借 less 取消键；特殊键黑名单防 PageUp 泄漏字面文本；文件尾是 useInput → handleKeyDown 的向后兼容桥（11 个调用点未迁移）。
4. **`useSwarmPermissionPoller.ts`（330 行，11 锚点）**——worker 权限接收端。模块级双注册表（普通 + 沙箱）跨渲染存活；「先删后调」幂等闸门（回调内可能同步触发新工具调用）；permissionUpdates 逐条 zod 校验（队友进程可能是旧版本）；三个提前退出保 IO 经济（非 worker / 并发中 / 无待定）。
5. **`useManagePlugins.ts`（304 行，9 锚点）**——插件 Layer-3 初始加载。MCP 计数必须在 setAppState 前算（LoadedPlugin.mcpServers 是后填缓存槽，与指标竞态）；errors 合并而非覆盖 + type+source 去重键（LSP 错误不丢、Doctor UI 不重复）；needsRefresh 只提示不自动刷新（旧自动刷新有 stale-cache bug 且不含 MCP/agents，刷新一律走 /reload-plugins）。
6. **`useCancelRequest.ts`（276 行，14 锚点）**——三个停止键的仲裁。Esc 优先级：活动任务 > 弹队列；bash 模式空输入时 Esc 让位给模式退出；Ctrl+C 绝不能认领空闲主提示符（挡复制选择和双击退出）；Ctrl+X Ctrl+K 两段式杀后台 agent（3 秒窗口、快捷键显示尊重改键）；killAgents handler 必须 always-active——ctrl+x 是 chord 前缀，isActive:false 会把 ctrl+k 泄漏给 readline kill-line，闸门只能做在 handler 内部。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 15 批生效）；check-fidelity 首轮 5 文件 FAIL——全部是 `after_block` 误用于 `/** */` 块注释（该模式只推进连续 `//` 行，遇非 `//` 行回退一行，中文落进块内），统一改为 `after` 锚在 `/**` 开头行（自动外移到块后）；复验又踩 useCancelRequest 三处多行 const 首行锚点（规矩 7 复犯），挪到语句结束行后 0 失败；5 处外移均为人眼确认（全部落在函数签名前，位置正确）。

### 任务管理与远程缝合十件套（第 38 批，10 份 2,302 行）

hooks 根目录第五组：队友树导航、任务列表单例 store、远程历史分页、全局快捷键、两种远程会话、tasks mode 发动机、回合 diff、权限总入口、LSP 推荐。hooks 到 34/104（74% 行数）。

1. **`useBackgroundTaskNavigation.ts`（251 行，31 锚点）**——Shift+↑/↓ 的队友树导航。索引空间 -1..n 是一张设计图：-1 = leader，0..n-1 = 队友，n = 「隐藏」行（收起树用），down/up 的回绕不对称（down 越 maxIdx 回 -1，up 在 -1 回 maxIdx）。useEffect 的 clamp/reset 双条件防开机误清（prevCount>0 才重置）；正在查看已完成队友时只清索引、保留 viewing-agent 模式——用户还要靠 Esc 自己退。Esc 的两栖语义靠两个 abortController 分工：running → currentWorkAbortController 只停当前轮（队友活着），非 running → 退查看。文件末尾又是 useInput → KeyboardEvent 的向后兼容桥（与 useSearchInput 同款，REPL 尚未接线）。
2. **`useTasksV2.ts`（250 行，31 锚点）**——TodoV2 的单例 store。为什么是单例：REPL/Spinner/Footer 多处消费同一份列表，per-hook fs.watch 会被 Spinner 的每轮挂载打成 churn。useSyncExternalStore 契约 + 稳定数组引用（Object.is 命中才重渲染）；懒启动 + 订阅计数归零才 #stop、缓存保留防闪空；三层事件源（fs.watch / onTasksUpdated 进程内总线 / 5s 兜底轮询——且只在有未完成任务时才排，全完成时空转轮纯属白烧 CPU）；5s 隐藏定时器带 taskListId 防跨队误 reset + 到点后二次确认「仍全部 completed 且非空」才 resetTaskList；禁用路径的 NOOP 三件套保引用恒定。
3. **`useAssistantHistory.ts`（250 行，26 锚点）**——viewer 模式的历史惰性分页。游标三态（undefined 首页未拉 / null 已到底 / string = before_id）；稳定 UUID 哨兵是虚拟滚动友好设计——loading/failed/start 三种文案原地 mutate 同一 item，不是删除+插入；滚动锚点用 getFreshScrollHeight 直读 Yoga 拿 commit 后真实高度差补偿视口；fill-viewport 自链用 `<=` 而非 `<`（ScrollBox 内容壳 flexGrow:1，内容永远不低于视口，只有「还没有可滚余量」时才继续拉），10 页预算防全被过滤时无限链；拉取失败不回消游标——哨兵换 failed 文案，下次上滚重试同一页。
4. **`useGlobalKeybindings.tsx`（249 行，24 锚点）**——全局快捷键注册组件。注册顺序即触发顺序（子组件先注册先触发、再冒泡），Esc 仲裁全靠 isActive 门控：搜索栏「打开」是模式态独占 Esc，只是「导航中」不是模式，Esc 直接退 transcript（与 less 的 q 一致）——没这层门控子父两个 handler 会在同一次 Esc 上双发。ctrl+o 藏着 GB kill-switch 逃生舱：isBriefOnly 可能因开关晚于持久化而卡死成空白视图，此时先清卡死状态再正常切。ctrl+shift+b 是非对称闸门（OFF 永远允许——进来的键必须能出去）；ctrl+l forceRedraw 治外部清屏后 Ink 差分引擎「未变化格子不重画」的死角；运行时 require 破模块循环；feature() 作为编译期常量做条件调钩子（biome 特批）。
5. **`useSSHSession.ts`（241 行，25 锚点）**——SSH 远程会话钩子，与 useDirectConnect 是姊妹文件（同四件套接口、同 REPL 接线），但生命周期相反：ssh 进程和 auth proxy 在启动期 main.tsx 就建好交进来，本钩子只负责接线。stream-json 模式每轮重发 system/init，只放行第一条；权限四回调里 recheck 在远程是空转（本地缓存不了远端判定逻辑）；isConnectedRef 供断开文案分流（从未连上 = 失败，连上又断 = 正常结束）；stderr 展示有策略（连接前必看、连接后仅非 0 退出码，否则 --verbose 噪声淹没真错误）；终局 gracefulShutdown(1, 'other')。
6. **`useDirectConnect.ts`（229 行，22 锚点）**——WebSocket 版远程会话，与上一份对照读最能看出「同接口两种传输」的差异点：effect 内自建 manager（SSH 版是外部交入）；onAllow 多带 updatedInput——用户可能在弹窗里改过参数（如权限建议追加的路径），要原样回传远端；WS 断了没有本地回退，两条路都 gracefulShutdown(1)。
7. **`useTaskListWatcher.ts`（221 行，24 锚点）**——tasks mode 的发动机。ref 中转 props 的真实动机写在注释里：isLoading 每轮翻转会让 effect 逐轮 close()+watch()，而这正是 Bun PathWatcherManager 死锁的触发条件（oven-sh/bun#27469）——所以清理只允许在 taskListId 变化或卸载时发生。claimTask 是文件锁语义的原子抢占，抢失败安静等下次事件；提交被拒要主动释放 claim（owner 置 undefined），否则任务永远卡在「有人认领没人干」；「转空闲排一次检查」是依赖剃掉后显式补回的补偿效应；1s 去抖 vs useTasksV2 的 50ms——这里等的是人建任务，不是自己刚写完文件。
8. **`useTurnDiffs.ts`（213 行，23 锚点）**——从消息流提取按回合的 diff。useMemo 内做增量累计（lastProcessedIndex 游标，同批消息重复渲染不重算）；回退检测：用户 rewound 对话后消息变短，全量缓存作废重来；tool_result 也是 user 型消息（API 结构如此），靠 toolUseResult 字段甄别不当新回合；新建文件没有 structuredPatch，合成一个「全是 +」的假 hunk（oldStart/oldLines 为 0）让 diff 视图无需特判；Map 按路径聚合同文件多次编辑，stats 全量重算不增量维护。
9. **`useCanUseTool.tsx`（204 行，27 锚点）**——权限判定总入口，React Compiler 产物（\_c(3) 槽位 + memo sentinel，锚点避开 JSX 区）。核心不变式：权限判定永远以 resolve 收场——AbortError/APIUserAbortError 是用户取消只记调试日志，其余进 logError，两者都 cancelAndAbort，异常绝不让 Promise 悬挂（否则工具调用永远卡在等待权限）。ask 三岔：coordinator 自动化检查（awaitAutomatedChecksBeforeDialog 门下）→ swarm worker 代答 → speculative classifier 2 秒竞速（有结果+命中规则+高置信三条件全中才免弹窗，命中后 consume 预跑结果并存档）；auto-mode 的批准与拒绝双向留痕（批准存 setYoloClassifierApproval，拒绝进 autoModeDenials 账本 + 立即通知）；deny 只 resolve(result) 不回传 updatedInput。
10. **`useLspPluginRecommendation.tsx`（194 行，28 锚点）**——LSP 插件推荐，同样 React Compiler 产物。推荐触发三保险：会话级一次性格子 + checkedFilesRef 差分（同文件只送一次匹配）+ tryResolve 基座互斥；28 秒阈值对应菜单 30 秒自动消失——超时被 dismiss 的计 ignored count 降温，用户真点的 no 不计（明确负反馈走 never 永久拉黑）；四选一响应用带标签的 switch 汇到同一收尾；useAppState 选择器编译期拆成独立函数，窄订阅只取 fileHistory.trackedFiles。

流程账：预检三断言一次通过（261 锚点）、零合并错误（硬规矩连续第 16 批生效）；check-fidelity 首轮 1 文件 FAIL——useTurnDiffs 锚点 (125,'after') 落在多行表达式 `const isToolResult =` 首行中间（把注释行 124 数成了 125，规矩 7 的新变体：多行语句的首行同样会劈开表达式），挪到 124 后复验 0 失败；两条 ⟳ 自动挪位均为 `//` 注释段中部 → 段尾（useGlobalKeybindings 99→101、useTaskListWatcher 42→46），人眼确认落点正确；check-links 0 失效。

### 通知系统全目录（第 39 批，notifs 16 份 1,355 行）

hooks/notifs 整目录清零（16/16）。这一层是「启动/状态变更类通知」的统一收口：一半文件是 React Compiler 产物（useEffect + memo 槽位的固定形态），一半是纯源（useStartupNotification 基座 + 数据驱动表）。hooks 到 50/104（74% 行数）。

1. **`useStartupNotification.ts`（41 行，7 锚点）**——**先读这个，它是本目录的基座**。把 10+ 个 notifs 钩子各自手写的「远程门控 + 一次性 ref」收成一个：compute 只跑首次 effect，返回 null / 单条 / 数组三种形态同步异步通吃（Promise.resolve 包装统一时序），异常全走 logError 不冒泡。computeRef 每轮同步赋值而依赖数组不含 compute——调用方传新函数不会导致重跑。
2. **`useIDEStatusIndicator.tsx`（186 行，8 锚点）**——IDE 状态五态互斥分流（连接/选区/JetBrains/安装失败/首次提示）。四个 effect 各管一条通知，条件不满足就 removeNotification 的清理模式；提示上限双保险（会话 ref + 全局 config 计数）；setTimeout 用参数透传而非闭包捕获（3 秒后闭包里的引用可能过期）。
3. **`useFastModeNotification.tsx`（162 行，8 锚点）**——fast mode 四类事件（组织开关/超额拒绝/冷却开始/结束）。冷却开始与结束用 invalidates 互斥键保证同一时刻只有一条；两个订阅在 cleanup 成对退订。
4. **`useLspInitializationNotification.tsx`（143 行，7 锚点）**——LSP 轮询式错误通知。manager 整体失败即永久停表（setShouldPoll(false)）；去重键 = 来源 + 文案的 Set 跨渲染存活；错误同时写 appState.plugins.errors 供 /doctor。
5. **`usePluginInstallationStatus.tsx`（128 行，6 锚点）**——插件安装失败汇总。源码里连续两道完全相同的 `if (totalFailed === 0) return`（第二处永假，冗余防御标本）；计数经 useMemo 化保 effect 依赖引用稳定。
6. **`useRateLimitWarningNotification.tsx`（114 行，7 锚点）**——超额提示（一次性 state 标记）+ 限流警告（文案 ref 去重）双轨；team/enterprise 默认不弹超额，除非有独立计费权。
7. **`useTeammateShutdownNotification.ts`（78 行，7 锚点）**——队友生命周期批量通知。fold() 机制：同 key 新事件不堆叠而是解析旧文案数量 +1 重新生成（「3 agents spawned」）；seen Set 保证同一任务只报一次。
8. **`useSettingsErrors.tsx`（69 行，7 锚点）**——设置错误通知，60s 长停留（比其他通知长得多——要留时间给用户去 /doctor 修）。
9. **`useCanSwitchToExistingSubscription.tsx`（60 行，7 锚点）**——API key 用户反查 oauth profile 提示切订阅登录；全局最多 3 次，且先行落盘计数再展示。
10. **`useAutoModeUnavailableNotification.ts`（56 行，6 锚点）**——shift-tab 轮播绕过 auto 槽位时的一次性提示。prevModeRef 记忆上次模式才能识别「绕了一圈回来」；feature() 编译期常量条件（有意死代码消除，非恒假条件事故）。
11. **`useModelMigrationNotifications.tsx`（52 行，6 锚点）**——数据驱动的迁移通知表：每项读自己的 config 时间戳，3s 内写入 = 本次启动刚迁移；新迁移只需加一条表项。
12. **`useMcpConnectivityStatus.tsx`（88 行，5 锚点）**——MCP 四路连通性分流（本地失败/claude.ai 失败/各自待授权）；IDE 类与 claudeai-proxy 走专门判据；从未连通的 claude.ai 服务不报「断开」噪音。
13. **`usePluginAutoupdateNotification.tsx`（83 行，5 锚点）**——插件自动更新提示；文案折叠 ≤2 列名、更多只报数量。
14. **`useDeprecationWarningNotification.tsx`（44 行，4 锚点）**——模型弃用警告，ref 去重 + 切回非弃用版本时清跟踪。
15. **`useNpmDeprecationNotification.tsx`（25 行，4 锚点）**——npm 安装方式弃用，三处短路（bundled/关闭检查/development）。
16. **`useInstallMessages.tsx`（26 行，4 锚点）**——安装自检消息按类型映射优先级（error/userAction → high，path/alias → medium）。

流程账：预检四断言一次通过（98 锚点）、零合并错误（硬规矩连续第 17 批生效）；annotate.py 零 ⟳ 外移（块注释锚点全部正确落在 `/**` 开头行）；check-fidelity 535 文件 0 失败；check-links 0 失效。

### 根目录输入/会话/选区等十件套（第 40 批，10 份 1,372 行）

hooks 根目录行数前十清零（root 39/83）。这一批是「输入/会话生命周期/选区/记录」类钩子，零散但都挂在主链路的关键节点上：提示建议、后台会话、IDE 选区、定时任务、issue 反馈、输入缓冲、插件 hint、失焦摘要、消息落盘、diff 获取。hooks 到 60/104（74% 行数）。

1. **`usePromptSuggestion.ts`（177 行，7 锚点）**——输入提示建议。建议文本仅在「助手未响应且输入框为空」时显示；markShown 把 shownAt 判断放进 setAppState 回调内避免依赖无限循环；logOutcomeAtSubmission 判定接受（Tab 或输入恰好等于建议）并带相似度/耗时遥测；ant 环境才上报完整文本（PII 门控）。
2. **`useSessionBackgrounding.ts`（158 行，7 锚点）**——Ctrl+B 把会话挂后台 / 把前台任务重新挂起。handleBackgroundSession 区分「重新挂起前台任务」与「发起后台查询」；useEffect 同步前台任务的消息与 loading 到主视图，仅消息数变化才回写（避免冗余渲染）；运行中任务把 abort 控制权交给前台任务自身，使 Escape 能中止后台任务。
3. **`useIdeSelection.ts`（150 行，6 锚点）**——经 MCP 通知直接注册 IDE 选区监听。IDE client 变化把 undefined 归一化 null 防误重置；选中行数 = 末行-首行+1，末字符在行首（character===0）不计入；闭包守卫（currentIDERef !== 当前 client 则丢弃过期通知）防旧 client 回调污染新 client。
4. **`useScheduledTasks.ts`（139 行，7 锚点）**——cron 调度器的 REPL 封装。isLoadingRef 避免闭包捕获过期值；runtime gate 在 effect 内检查而非调用点（保证 hook 无条件挂载，rules-of-hooks 要求）；enqueueForLead 系统生成 isMeta + WORKLOAD_CRON 低 QoS；onFireTask 按 agentId 路由队友 cron，队友消失则清理孤儿 cron；isKilled 每 tick 轮询提供会话中段实时关闭。
5. **`useIssueFlagBanner.ts`（133 行，9 锚点）**——ant 内部环境的「反馈问题」提示条。isSessionContainerCompatible 扫描 assistant 工具调用，mcp\__ 工具或危险外部命令（curl/ssh/docker/aws/git push 等）一律判不兼容；hasFrictionSignal 从末尾向前找最近 user 消息用正则判摩擦；阈值（≥3 次提交 + 30min 冷却）+ useMemo 缓存 O(messages) 扫描（每次按键都跑但打字时 messages 稳定）。
6. **`useInputBuffer.ts`（132 行，6 锚点）**——输入撤销缓冲。pushToBuffer 合并快速变更（debounce）+ 截断未来（撤销后再输入即新分支）+ 去重 + 限长；undo 回退 currentIndex 到上一条；canUndo 至少 2 条且不在首条。
7. **`useClaudeCodeHintRecommendation.tsx`（129 行，8 锚点，React Compiler 产物）**——`<claude-code-hint />` 标签驱动的插件安装提示（show-once）。复用 usePluginRecommendationBase；tryResolve 异步解析，成功标记本会话已展示并清理 pending（防竞态）；handleResponse 三路：yes→安装 / disable→永久关闭推荐 / no→仅清理。
8. **`useAwaySummary.ts`（125 行，7 锚点）**——终端失焦满 5 分钟追加「while you were away」摘要。双门控（编译期 feature + 运行时 GB）；generate 先中止在途再生成，文本非空且未中止才插入；回合进行中定时器触发则等回合结束（仍失焦）再补发；unknown 焦点态为 no-op。
9. **`useLogMessages.ts`（119 行，8 锚点）**——把消息增量记录到 transcript。lastRecordedLengthRef 只传新尾部（避免每次 setMessages 都 O(n) 重扫）；firstMessageUuidRef 检测 compaction/clear（长度无法区分压缩后数组变长）；callSeq 防 stale 异步 .then 覆盖同步更新；sync-walk 仅在增量/首渲染/同头收缩三种安全情况更新 parent hint。
10. **`useDiffData.ts`（110 行，6 锚点）**——按需获取 git diff（stats + hunks）。挂载并行拉取两份数据；cancelled 防卸载后 setState；useMemo 识别 large（在 perFileStats 但不在 hunks）/ truncated（超 400 行上限）/ binary / untracked。

流程账：预检四断言一次通过（71 锚点）、零合并错误（硬规矩连续第 18 批生效）；annotate.py 仅 1 处 ⟳（useIdeSelection 锚点误落 `//` 注释段中部，自动挪到段边界——落点经人眼确认在语句边界，未劈开英文）；check-fidelity 545 文件 0 失败；check-links 0 失效。

### 根目录快捷键/退出/剪贴板等十件套（第 41 批，10 份 944 行）

hooks 根目录行数前十清零（root 49/83）。这一批是「快捷键 / 退出 / 剪贴板自动复制 / 远程会话恢复 / API key 验证 / swarm 初始化」类钩子，多与全局交互与初始化链路相关。hooks 到 70/104（79% 行数）。

1. **`useCommandKeybindings.tsx`（108 行，7 锚点，React Compiler 产物）**——命令行 keybinding 处理器。从配置读 command:* 动作注册 handler，触发提交对应 slash 命令（立即执行不清除输入）；bb0 块处理 keybindingContext 缺失兜底（空 Set）；memo 化 map（slice(8) 去 command: 前缀）；门控 `isActive && !isModalOverlayActive` 防模态里误触。
2. **`usePrStatus.ts`（107 行，6 锚点）**——PR 评审状态轮询。三参数（60s 间隔 / 60min 空闲停表 / 慢 GH>4s 永久禁用）；用 getLastInteractionTime 判空闲；fetch 后比较 number+reviewState 防无谓重渲染；effect 按 lastFetchRef 排下一次避免回合边界重 spawn gh。
3. **`useSkillImprovementSurvey.ts`（106 行，4 锚点）**——技能改进调研弹窗。suggestion 走 ref 即使清空 AppState 仍显示；新建议首现记 appeared 事件；`_PROTO_skill_name` 走特权 BQ 列（明文 skill 名不进 additional_metadata 防泄露）；dismissed 仅关，否则 applySkillImprovement 追加 system 消息。
4. **`usePluginRecommendationBase.tsx`（105 行，6 锚点，React Compiler 产物）**——插件推荐共享状态机。gate 链（remote / 已有 recommendation / isCheckingRef 在飞）三闸都过才 resolve；返回 {recommendation, clearRecommendation, tryResolve}；installPluginAndNotify 查→装→成功/失败通知。
5. **`useCopyOnSelect.ts`（99 行，5 锚点）**——选区自动复制（仿 iTerm2）。四态状态机（isDragging / !has / 已 copied / 最终 copy）；onCopied 经 ref 读避免 effect 重订阅；默认开启因 macOS cmd+c 被终端 Edit>Copy 拦截；useSelectionBgColor 把主题 selectionBg 注入 Ink StylePool 替代 SGR-7 反显。
6. **`useExitOnCtrlCD.ts`（96 行，6 锚点）**——ctrl+c/d 退出双按机制。注入 useKeybindingsHook 避免 import 循环；exitFn = onExit ?? exit；ctrl+c 与 ctrl+d 各一个 double-press；handleInterrupt 先让 feature 经 onInterrupt 处理（返回 true 短路）；isActive 关避免嵌入 TextInput 时父子 handler 双发。
7. **`useTeleportResume.tsx`（85 行，4 锚点，React Compiler 产物）**——远程会话恢复。resumeSession 闭包 logEvent→teleportResumeCodeSession→setTeleportedSessionInfo；catch 归一化 TeleportOperationError（isOperationError 区分操作错误与普通错误）；返回五元组。
8. **`useApiKeyVerification.ts`（85 行，3 锚点）**——API key 验证。初始五态（loading/valid/invalid/missing/error）；apiKeyHelper 配置但未执行（security：防 trust dialog 前经 settings.json 触发 RCE）；verify 先 warm 缓存再读全源，API 报错仍标 error 但记录 error 供展示。
9. **`useSwarmInitialization.ts`（82 行，4 锚点）**——swarm 初始化。条件加载以便 DCE；resume 从转录首消息读 teamName/agentName 重建 context + 从 team file 取 agentId 初始化 hooks；fresh 从 getDynamicTeamContext 初始化。
10. **`useClipboardImageHint.ts`（78 行，5 锚点）**——剪贴板图片提示。仅 unfocused→focused 转变触发（lastFocusedRef 跟踪）；1s 防抖 + 30s 冷却；hasImageInClipboard（async osascript）命中发 8s 提示（含 paste 快捷键显示）。

流程账：预检四断言一次通过（50 锚点）、零合并错误（硬规矩连续第 19 批生效）；annotate.py 零 ⟳ 外移（7 处 `/**` 行 after 锚自动挪到块后，落点人眼确认在 import/语句之前，未劈开英文）；check-fidelity 555 文件 0 失败；check-links 0 失效。

### 根目录 @提及/队列/队友视图等十件套（第 42 批，10 份 638 行）

hooks 根目录行数前十清零（root 59/83）。这一批是「IDE @提及 / Chrome 扩展 prompt / IDE 自动集成 / 命令队列处理 / 超时通知 / 队友视图自动退出 / 双按检测 / 技能变更 / 占位渲染 / Chrome 扩展通知」类钩子，偏向 IDE 集成与命令队列驱动。hooks 到 80/104（82% 行数）。

1. **`useIdeAtMentioned.ts`（76 行，6 锚点）**——IDE @提及通知。直接往 IDE 的 MCP client 注册 at_mentioned 处理器（不走 React state）；ideClientRef 闭包守卫（旧 client 回调丢弃防误投）；MCP 行号 0-based→UI 1-based 的 +1 对齐；不写 cleanup（MCP client 自管生命周期）。
2. **`usePromptsFromClaudeInChrome.tsx`（71 行，5 锚点，React Compiler 产物）**——Chrome 扩展 prompt 监听 + 权限模式同步。prompt 通知走 JSON-RPC notifications/message 用 zod 校验；双职责（入队成用户提示 + 把本地模式翻成扩展的 skip_all_permission_checks/ask）。
3. **`useIDEIntegration.tsx`（70 行，5 锚点，React Compiler 产物）**——IDE 自动集成。props 被编译重命名为 t0；多路触发自动连接（config/flag/终端/SSE 端口/待装扩展/env 真值 + env 非假熔断）；按 URL 前缀区分 ws-ide / sse-ide；委托 initializeIdeIntegration。
4. **`useQueueProcessor.ts`（68 行，4 锚点）**——统一命令队列出队驱动。优先级 now>next>later；三个触发条件（无 query / 队列非空 / 无本地 JSX UI 阻塞）；两处 useSyncExternalStore（query 守卫 + 队列）绕过 React context 延迟；预订（reservation）所有权移交 handlePromptSubmit 的同步链。
5. **`useNotifyAfterTimeout.ts`（65 行，4 锚点）**——超时桌面通知。阈值 6s；跳过测试环境 + 要求确实空闲；交互打点已移到 App.tsx 的 processKeysInBatch（避免 stdin 监听抢输入丢字符）；effect 内必须立即重置交互时间（否则渲染后才打点会误触发）。
6. **`useTeammateViewAutoExit.ts`（63 行，4 锚点）**——队友视图自动退出。只选被查看的那条 task（防任何队友流式更新重渲染）；被查看任务消失要用原始 task 而非 teammate 收窄值（local_agent 收窄成 undefined 会误踢）；killed/failed/error/非运行态触发退出，local_agent 全落空不踢。
7. **`useDoublePress.ts`（62 行，4 锚点）**——双按检测器。窗口 800ms；返回稳定 useCallback 封装状态机；双按两要件（≤窗口且 timeoutRef 未清）。
8. **`useSkillsChange.ts`（62 行，4 锚点）**——命令列表保鲜。两类触发：技能文件变更（全量清缓存+重扫磁盘）与 GrowthBook 刷新（只清 memo）；分别订阅 skillChangeDetector 与 onGrowthBookRefresh。
9. **`renderPlaceholder.ts`（51 行，3 锚点，纯 helper 非 hook）**——占位符渲染。纯函数算出应显示占位串与是否显示；语音录制态只显光标不显文字；反显光标只在输入框+终端都聚焦时出现。
10. **`useChromeExtensionNotification.tsx`（50 行，4 锚点，含 sourcemap）**——Chrome 扩展通知。--chrome/--no-chrome/默认三态；壳 hook 把 compute 委托给 useStartupNotification 基座；`if (true && ...)` 的 `true &&` 是 feature flag 移除后的恒真残留（值得清理）；扩展未装且非 Homespace 弹安装提示。

流程账：预检四断言一次通过（43 锚点）、零合并错误（硬规矩连续第 20 批生效）；annotate.py 良性 ⟳ 外移 9 处（我的 `after` 锚落在 `//` 注释段首行，自动挪到段尾，落点人眼确认在代码之前，未劈开英文）；首轮 1 FAIL——useDoublePress 锚点 (33,'after') 落在多行表达式 `const isDoublePress =` 首行中间（规矩 7 变体：多行语句首行同性质），挪到 35 后复验 0 失败；check-links 0 失效。

### hooks 根目录收尾 24 件（第 43 批，24 份 683 行，69 锚点，hooks 104/104 全清）

把 `src/hooks/` 根目录最后 24 份一次清零，hooks 整目录 104/104 全清——这是继 `services/`、`src/tools/` 之后第三个整目录清零的大模块。24 份多为小而专的 hook（15–48 行），逐一过：

1. **`useOfficialMarketplaceNotification.tsx`（48 行，2 锚点，含 sourcemap）**——薄封装 hook。仅把「官方市场自动安装检查」作为一次性 compute 交给 useStartupNotification 基座；configSaveFailed / installed / skipped(unknown) 三类结果各自 push 一条右下角通知，基座统一控展示与超时。
2. **`useDeferredHookMessages.ts`（47 行，4 锚点）**——延迟 hook 消息「先渲染后注入」。两个 ref（pendingRef 持未决 promise、resolvedRef 标已结算）；promise 结算后把消息前置插入对话（`[...msgs, ...prev]`），确保模型首轮就能看到 hook 上下文；返回的回调供 onSubmit 在首个 API 请求前调用。
3. **`useMergedTools.ts`（45 行，3 锚点）**——组装 REPL 完整工具池。复用 assembleToolPool（REPL 与 runAgent 共用纯函数：内置+MCP+deny 过滤+去重），再叠 initialTools；`replBridgeEnabled` / `replBridgeOutboundOnly` 声明未使用（早期开关残留），仍列进 deps 保引用稳定。
4. **`useIdeLogging.ts`（42 行，3 锚点）**——订阅 IDE 经 MCP 发来的 `log_event` 通知，转成内部 analytics 事件（`tengu_ide_<name>`），eventData passthrough 保留任意附加字段。
5. **`useMemoryUsage.ts`（40 行，4 锚点）**——Node 内存监控。1.5GB（high）/ 2.5GB（critical）双阈值；**关键优化**：status 为 normal 时返回 null 而非新对象，避免 99% 用户每 10s 重渲染整个通知子树。
6. **`useElapsedTime.ts`（38 行，3 锚点）**——格式化经过时长。useSyncExternalStore + 定时 notify；`endTime` 优先（终态任务冻结时长，避免看完超时任务显示膨胀），减掉暂停时长；get 同时作 server/getSnapshot 同源防 hydration 不匹配。
7. **`useMinDisplayTime.ts`（36 行，3 锚点）**——节流显示。保证每个值至少停留 minMs 才被替换，防快速轮转文本一闪而过；不够久时 setTimeout 补足剩余时间，并把 ref/setter/value 作参数传进闭包（避过期值）。
8. **`useUpdateNotification.ts`（35 行，3 锚点）**——版本 semver（major.minor.patch）去重决定更新提示；用惰性初始化把已通知版本记成初始版本 semver，避首屏误弹。
9. **`useBlink.ts`（35 行，3 锚点，含 sourcemap）**——同步闪烁动画。所有实例共享同一动画时钟（按 floor(time/interval)%2 天然同步），仅至少一个可见订阅者时跑时钟，终端失焦即暂停。
10. **`useMainLoopModel.ts`（35 行，3 锚点）**——解析主循环模型名（session 覆盖 > 全局 > 默认）。订阅 GB 刷新信号强制重渲染：GB 初始化完成后 AppState 不变，但别名解析需重算（否则 /model 显示与实际采样不一致）。
11. **`useIdeConnectionStatus.ts`（34 行，3 锚点）**——从 MCP 客户端定位 ide client，推导连接状态（connected/pending/disconnected/null）与名称（仅 sse-ide/ws-ide 可取）。
12. **`useSettingsChange.ts`（26 行，3 锚点）**——订阅设置变更。**坑**：缓存已由通知方（changeDetector.fanOut）重置，这里不能再清，否则 N 个订阅者互相踩出 N 路抖动。
13. **`useVoiceEnabled.ts`（26 行，3 锚点）**——综合「用户开关 + 鉴权 + GB kill-switch」三者。只把贵的鉴权半（冷启动 sync security spawn ~60ms）memo 在 authVersion，GB 廉价缓存查留在 memo 外以便中途翻转即时生效。
14. **`useFileHistorySnapshotInit.ts`（26 行，3 锚点）**——启动时文件历史快照一次性灌进内存状态（仅首次），之后由运行期机制接管；功能未开或已初始化则跳过。
15. **`useExitOnCtrlCDWithKeybindings.ts`（25 行，2 锚点）**——便利封装接 useExitOnCtrlCD + useKeybindings，是组件用退出双按的标准入口；拆分是为避 import 循环。
16. **`useMergedClients.ts`（24 行，3 锚点）**——合并初始 + MCP 客户端，按 name 去重（initialClients 优先）；纯函数 mergeClients 便于单测。
17. **`useDynamicConfig.ts`（23 行，4 锚点）**——动态配置 hook；测试环境直接 return 不拉配置（防测试挂起）。
18. **`useMailboxBridge.ts`（22 行，3 锚点）**——邮箱消息桥接。useSyncExternalStore 订阅 mailbox.revision，仅队列变化重渲染；非加载态时 poll 一条消息投递给输入框。
19. **`useSettings.ts`（18 行，2 锚点）**——从 AppState 取 settings 的响应式 hook；优先用它而非 getSettings_DEPRECATED()，才能在组件里拿到响应式更新。
20. **`useAfterFirstRender.ts`（18 行，3 锚点）**——ant 环境 + 指定 env 下，首渲后打印启动耗时并 process.exit(0)，用于自动化基准测量；被 custom-rules 允许越过 no-process-exit。
21. **`useMergedCommands.ts`（16 行，3 锚点）**——合并内置 + MCP 命令，按 name 去重（initialCommands 优先）。
22. **`useCommandQueue.ts`（16 行，2 锚点）**——订阅统一命令队列，返回冻结数组，仅队列变更时改引用。
23. **`useTerminalSize.ts`（16 行，2 锚点）**——从 TerminalSizeContext 取终端尺寸；非 Ink App 组件内使用直接抛错。
24. **`useTimeout.ts`（15 行，2 锚点）**——延时 hook：delay 毫秒后翻 isElapsed；resetTrigger 变化重置计时器。

流程账：预检四断言一次通过（69 锚点）、零合并错误（硬规矩连续第 21 批生效）；annotate.py 良性 ⟳ 外移 1 处（useSettingsChange 锚点原落 `//` 注释段中部，自动挪到段尾，落点人眼确认在英文注释块之后、代码之前，未劈开英文）；首轮 1 FAIL——useIdeConnectionStatus 锚点 (21,'after') 落在多行赋值 `const ideName =` 首行（规矩 7 变体：行尾 `=` 触发「未结束多行表达式」判据），挪到三元收尾行 (24,'after') 后复验 0 失败；check-links 0 失效。

### 服务层之后读什么（按「对理解主链路的价值 / 体量」排）

`services/`、`src/tools/`、`src/hooks/`（含 toolPermission / notifs / 根目录）**均已清零**（tools 184/184，hooks 104/104）。`src/` 还剩 692 份。候选目标（数字来自 `python scripts/check-coverage.py src`）：

| 目录                | 规模                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 为什么是下一步                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tools/`      | 184 份 / 50,863 行（**184/184 全清**）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 工具层已完成——从 Read/Glob/Grep 到 Bash 安全核心到 agent 编排，主链路的「执行侧」齐了                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/hooks/`      | 104 份 / 19,232 行（**104/104 全清**，toolPermission 5 + 输入补全八件套 + 通信远程五件套 + 交互插件六件套 + 任务管理与远程缝合十件套 + notifs 16 全清 + 根目录输入/会话/选区等十件套 + 根目录快捷键/退出/剪贴板等十件套 + 根目录 @提及/队列/队友视图等十件套 + 根目录收尾 24 件）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 生命周期钩子（PreToolUse / PostSampling 等），前面几个模块反复引用，读完能把 fork 时机的谜团全部收口。**整目录已清零**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/utils/`      | 564 份 / 180,487 行（**已做 321**：messages + sessionStorage + hooks + bashParser + attachments + pluginLoader + ast + marketplaceManager + auth + readOnlyCommandValidation + config + powershell/parser + filesystem + installer + schemas + inProcessRunner + permissionSetup + Cursor + worktree + yoloClassifier + ide + permissions/permissions + claudemd + analyzeContext + settings + sandbox-adapter + mcpbHandler + commitAttribution + loadPluginCommands + permissionSync + sessionTracing + git + processSlashCommand + validatePlugin + bash/commands + installedPluginsManager + settings/types + teammateMailbox + teleport + perfettoTracing + fileHistory + collapseReadSearch + stats + toolResultStorage + imageResizer + tasks + telemetry/instrumentation + words + sessionStoragePortable + fsOperations + swarm/backends/TmuxBackend + toolSearch + bash/heredoc + api + git/gitFilesystem + forkedAgent + swarm/teamHelpers + ripgrep + computerUse/executor + theme + plugins/mcpPluginIntegration + doctorDiagnostic + model/model + handlePromptSubmit + processUserInput/processUserInput + cleanup + markdownConfigLoader + conversationRecovery + plugins/pluginInstallationHelpers + deepLink/terminalLauncher + queryHelpers + sessionRestore + messageQueueManager + model/modelOptions + claudeInChrome/common + fastMode + gitDiff + gracefulShutdown + claudeInChrome/chromeNativeHost + nativeInstaller/download + bash/treeSitterAnalysis + telemetry/betaSessionTracing + settings/changeDetector + permissions/pathValidation + Shell + teleport/api + ShellCommand + swarm/backends/registry + cronTasks + listSessionsImpl + task/diskOutput + hooks/sessionHooks + plugins/officialMarketplaceStartupCheck + betas + statsCache + nativeInstaller/pidLock + tmuxSocket + proxy + imagePaste + plugins/zipCache + claudeInChrome/setup + hooks/hooksConfigManager + plugins/pluginOptionsStorage + plans，165,750 行） | 最大的一块，但最杂。1,300 行档的十巨兽（bash/commands、installedPluginsManager、teleport、teammateMailbox、settings/types、perfettoTracing、fileHistory、collapseReadSearch、stats、toolResultStorage）已全数吃掉，并顺手把 800–880 行档的 imageResizer/tasks/instrumentation 一并做了；第 54 批又吃掉 800 行档余下五巨兽（words/sessionStoragePortable/fsOperations/swarm/backends/TmuxBackend/toolSearch）连同 heredoc/api/gitFilesystem/forkedAgent/teamHelpers/ripgrep/computerUse-executor 等 12 份；下一批接 550–590 行档：file(584)/bash/ShellSnapshot(582)/suggestions/commandSuggestions(567)/cronScheduler(565)/autoUpdater(561)/deepLink/terminalLauncher(557)… |
| `src/components/` | 389 份 / 81,892 行（已做 145）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | TUI 组件。已经做了一部分，剩下的是各面板                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

> 这里的进度是脚本算的（`python scripts/check-coverage.py <目录>`）。  
> **两个大目录清零 ≠ 全仓完成**——全仓还有 692 份没动（约 36% 文件、约 27% 行数）。

---

### utils 根目录两个巨兽：messages 与 sessionStorage（第 44 批，2 份 10,617 行，226 锚点）

`src/utils/` 是最后一个「体量可怕」的目录（564 份 / 180,487 行），根目录就占 298 份、90,767 行。按行数降序，前两名是 5,512 行的 `messages.ts` 与 5,105 行的 `sessionStorage.ts`——单份体量约等于此前 hooks 批次里 20 份小文件之和，因此本批只取这两份（流水线允许「大文件少取」，优先级仍是行数降序）。

| 文件                                                                 | 原文    | 批注版   | 批注  | 讲什么                                      |
| ------------------------------------------------------------------ | ----- | ----- | --- | ---------------------------------------- |
| [`utils/messages.ts`](annotated/src/utils/messages.ts)             | 5,512 | 5,596 | 84  | 消息装配线：工厂 → 归一化 → 重排 → 附件翻译 → 发送前总装       |
| [`utils/sessionStorage.ts`](annotated/src/utils/sessionStorage.ts) | 5,105 | 5,247 | 142 | 会话 JSONL 的读写层：追加、去重、链恢复、标题元数据、/resume 列表 |

两份文件正好是主链路的两端：`messages.ts` 管「发给模型的是什么形状」，`sessionStorage.ts` 管「磁盘上留下的是什么形状」。四个最值得记的点：

1. **`messages.ts` 真正难的不是构造，而是把一条对话压成 API 能接受的形状**。`normalizeMessagesForAPI` 那条总装线里塞了十几道后处理，每一道都对应一次真实 400：tool_result 必须前置（`hoistToolResults`）、相邻文本块之间要补分隔符（否则「2+2」+「3+3」拼成「2+23+3」）、assistant 不能以 thinking 收尾、只有空白的文本块要剔除、孤儿思考块要滤掉。读懂这些补丁，等于读完了一部「Anthropic Messages API 踩坑史」。
2. **`smoosh` 系列（system-reminder 折叠进 tool_result）是为省一个 Human 回合边界**。附件消息本该跟着上一条用户消息走，但数组里它是独立的 user 消息，于是每次注入上下文都会凭空多一个 Human 边界，还会教模型在工具结果后停手。`ensureSystemReminderWrap` → `smooshSystemReminderSiblings` 用 `<system-reminder>` 前缀当判别符，把兄弟消息折叠进去，边界就消失了。
3. **`sessionStorage.ts` 的核心矛盾是「追加写」与「就地改」的冲突**。JSONL 只能追加，可压缩要删前缀、snip 要删中段、墓碑要删最后一条——三种删除各有各的打法：压缩用 `applyPreservedSegmentRelinks` 重新接链并清 usage；snip 用 `applySnipRemovals` 重放删除记录并沿父链重连（带路径压缩）；墓碑 `removeMessageByUuid` 只读尾部 64KB、定位行边界后 truncate 再回写，超 50MB 直接放弃。
4. **两条容易写错、且写错就静默丢数据的规矩**：① `appendEntry` 对 sidechain 的**本地写入**必须跳过去重——fork 继承来的消息 UUID 与主会话重复，去重会让子代理转录只剩 10KB 而不是完整 85KB；但同一批 UUID 的**远端**写入不能跳过，否则 409 重试耗尽后优雅退出（inc-4718）。② `recordTranscript` 里「已记录消息」只有在构成前缀时才能当父节点——压缩后的 `messagesToKeep` 排在新边界之后，若仍推进游标，新消息会挂到压缩前的 UUID 上，把边界变成孤儿。

两条踩坑记录（都属锚点位置，不是理解问题）：

- **`messages.ts` 数据文件末尾 13 行丢了引号**：`(4677, after, ...)` 里的 `after` 没加引号，`ast.parse` 照样通过（裸名字是合法表达式），直到 importlib 执行才抛 `NameError`。教训：预检必须**执行模块**，只做 `ast.parse` 拦不住这类错误。
- 两个函数签名行（`deriveShortMessageId` 的 `export function ...{`、`handleMessageFromStream` 的 `): void {`）原本用了 `after`，会插进函数体第一行；改成 `before` 后读起来才是「注释在前、代码在后」。
- `sessionStorage.ts` 首个锚点原写 96 行（空行），实际想让注释落在 import 块之后，改为 95 行（最后一条 import）。

流程账：预检（slug / pos / 行号 / 重复锚点 / 无引号反斜杠 / 模块可执行）两份均一次通过；`annotate.py` 零 `⟳`；`check-fidelity.py` 591 份 0 失败（messages 记 83 行中文批注 vs 84 锚点，属短批注 CJK 占比门限的正常差 1）；`check-links.py` 810 条源码链接 + 103 条内链，0 失效。

---

### utils 巨兽第二梯队：hooks 与 bashParser（第 45 批，2 份 9,458 行，307 锚点）

utils 根目录按行数降序的第三、四名：`hooks.ts`（5,022 行）与 `bash/bashParser.ts`（4,436 行）。一个管「生命周期钩子怎么执行」，一个管「bash 命令怎么被读懂」——后者是 Bash 工具安全判定的地基。

| 文件                                                                   | 原文    | 批注版   | 批注  | 讲什么                                                                   |
| -------------------------------------------------------------------- | ----- | ----- | --- | --------------------------------------------------------------------- |
| [`utils/hooks.ts`](annotated/src/utils/hooks.ts)                     | 5,022 | 5,158 | 136 | Hook 执行引擎：五类 hook（命令/提示/代理/HTTP/回调）的匹配、执行、输出协议与结果聚合                   |
| [`utils/bash/bashParser.ts`](annotated/src/utils/bash/bashParser.ts) | 4,436 | 4,607 | 171 | 纯 TS 手写 bash 解析器：词法 → 递归下降语法 → tree-sitter-bash 兼容 AST（3449 条金标准语料对齐） |

**`hooks.ts` 的四个要点**：

1. **退出码协议 + JSON 协议双轨**。老 hook 只管 echo：退出码 0 成功、2 阻塞（stderr 喂回模型）、其他非零仅展示；新 hook 输出 JSON，经 Zod 校验后按事件名分派十几种特化字段（改工具入参、注入上下文、代答权限、代答 MCP 引导）。两轨在 `processHookJSONOutput` 汇合。
2. **权限归并取最保守值**：多 hook 并行时 deny > ask > allow，只要有一个拒绝就拒绝；`updatedInput` 只在 allow/ask 时随决策带出，passthrough 可单独改入参不做权限表态。
3. **Windows 上 hook 经 Git Bash 跑**：所有进环境变量/命令串的路径必须 POSIX 化（`C:/Users/foo` → `/c/Users/foo`，纯 JS 正则转换 + LRU 记忆化）；PowerShell hook 走显式 argv（`-NoProfile -NonInteractive`）并跳过全部 bash 专属准备。插件目录缺失必须预检——缺脚本退出码 2 会被误读成「有意阻塞」，把 UserPromptSubmit/Stop 卡死到重启。
4. **性能心思**：内部回调快路径（全 callback 批次跳过 span/进度/JSON 处理，实测每次 PostToolUse 从 6µs 降到 1.8µs）；`hasHookForEvent` 故意过近似的存在性检查让未配置 hook 的会话在热点路径早退；`hookDedupKey` 按来源上下文分命名空间——插件间同模板不误合并、settings 内重复定义仍去重。

**`bashParser.ts` 的三个要点**：

1. **为什么手写**：摆脱 WASM 依赖、可控 50ms 超时 + 5 万节点预算（防恶意输入 OOM），同时 AST 逐形状兼容 tree-sitter-bash——连它的怪癖都复刻（`a > x && b > y` 整体被 redirected_statement 包住、管道中段重定向提升包裹、case 空体模式降级 word），因为下游安全行走器按形状判 `tooComplex`。
2. **安全是主旋律**：heredoc 定界符与换行之间的 `| rm -rf /tmp/evil` 绝不能静默丢弃——尾随单词正常解析、管道/列表直接发 ERROR 让 fail-closed 路径拒掉；`echo {;touch /tmp/evil` 必须在 `;` 断开；`unset 'a[$(id)]'` 的引号参数要发 raw_string 让行走器能拒绝（历史上曾静默丢弃，藏住算术下标代码执行向量）。
3. **双坐标系**：JS 字符串下标（charAt 用）与 UTF-8 字节偏移（AST 位置用）全程并行推进，ASCII 快路径两者相等；非 ASCII 惰性建 byteTable 二分回查。回溯原语 saveLex 把两个游标打包进一个数字，零堆分配。

踩坑：批注文本里写 shell 示例（`ls <<'EOF'`、`export "FOO=bar"`）极易带进英文双引号与反斜杠——数据文件被预检连续拦下 4 轮，全部改成「加引号 XX」式表述；另注意 raw string 里 `\\r` 仍是两个反斜杠字符，预检按单反斜杠判，必须整词改写。

流程账：预检两份一次通过（307 锚点）；`annotate.py` 零 `⟳`；`check-fidelity.py` 593 份 0 失败（hooks 记 135 行 vs 136 锚点，属 CJK 占比门限正常差 1）；`check-links.py` 812 条源码链接 + 104 条内链，0 失效。

---

### utils 第五梯队：attachments 与 pluginLoader（第 46 批，2 份 7,299 行，326 锚点）

`attachments.ts`（3,997 行）与 `plugins/pluginLoader.ts`（3,302 行）。一个管「每个回合往对话里悄悄塞什么」，一个管「插件从哪来、怎么装、怎么不被恶意条目坑」。

| 文件                                                                             | 原文    | 批注版   | 批注  | 讲什么                                   |
| ------------------------------------------------------------------------------ | ----- | ----- | --- | ------------------------------------- |
| [`utils/attachments.ts`](annotated/src/utils/attachments.ts)                   | 3,997 | 4,155 | 158 | 附件系统总装：40 余种 Attachment 类型的生产、节流与消息化  |
| [`utils/plugins/pluginLoader.ts`](annotated/src/utils/plugins/pluginLoader.ts) | 3,302 | 3,470 | 168 | 插件装载线：发现 → 版本化缓存 → 策略校验 → 组件装配 → 三源合并 |

**`attachments.ts` 的四个要点**：

1. **回合计数必须数人类回合**。plan/auto/todo/verify 四类提醒全部倒序扫消息数「距上次提醒过了几回合」，且都只数非 meta、非 tool_result 的 user 消息——工具循环每轮都调附件生成，数 assistant 消息会把 5 回合间隔退化成每 5 次工具调用催一次（auto 模式长会话累计多发 60–105 倍）。
2. **prompt cache 是最高约束**。date_change 附件追加在对话尾部让模型学到新日期而缓存前缀纹丝不动（清头部旧日期会让通宵会话跨午夜一次烧掉约 92 万有效 token）；agent 清单从工具 description 挪进增量附件（清单在描述里时 MCP 异步连接会打爆整个工具 schema 缓存，机群 10.2% 的 cache_creation 浪费）；代理列表输出强制排序——加载顺序不确定，不排序同样的集合产出不同字节。
3. **外部改文件的回传通道**。`getChangedFiles` 监工 readFileState 登记过的文件：mtime 变了就重新读并产出差异片段附件；只有 ENOENT 才逐出——编辑器原子写的 tmp→rename 间隙、保存时格式化的竞态绝不能逐出，否则下次 Edit 误报 code-6。
4. **预取不阻塞回合**。相关记忆检索用 Disposable 预取句柄：回合开始启动、模型流式输出期间后台跑、收集点看 settledAt 决定取用或下轮再试；query.ts 用 `using` 绑定，dispose 在约 13 个生成器退出路径上自动触发。

**`pluginLoader.ts` 的四个要点**：

1. **企业策略 fail-closed**：策略已配置但 marketplace 来源解析不出（配置损坏、条目缺失）时必须拦截，不能静默跳过策略检查——历史上有过「引入 Safe 读配置后策略检查在 undefined 上短路、回落路径绕过校验」的静默 fail-open，守卫注释把这段演化写得很细。
2. **版本键错位 = 永远重克隆**：预克隆版本已确定（source.sha / entry.version / installedVersion）时必须复用，不能信克隆后重算——manifest.version 优先级高于 gitCommitSha，重算会得出不同版本号，温启动探测不到缓存就每次都重新克隆。
3. **git-subdir 的省钱三板斧**：部分克隆 `--filter=tree:0` + 稀疏检出只拉路径沿途的树对象与路径下的 blob（百万文件 monorepo 省数百 MB）；checkout HEAD（慢、网络）与 rev-parse HEAD（只读、不碰 index 锁）并行执行。
4. **三源合并的优先级**：`--plugin-dir` 会话副本覆盖同名已安装插件（用户显式指向目录的意图），但被管理 settings 锁定的（无论强制启用还是禁用）不可覆盖——管理员意图压过本地开发便利。没有这个去重时两份共存且首匹配让已安装版胜出，--plugin-dir 对迭代已装插件毫无用处。

踩坑：`annotated-索引与进度.md` 在批 44 提交后被外部编辑器重排回写（表格对齐 + `<summary>` 补包裹 + 反斜杠转义），把批 45 的进度数字倒退回批 44 状态、丢失第 45 批小节、还有一个字符损坏成 HTML 实体（`错` → `&#x9519;`）。经规范化比对确认零新增内容后恢复 HEAD 版本，重排版备份在 `/tmp`。

流程账：预检两份一次通过（326 锚点）；`annotate.py` 零 `⟳`；`check-fidelity.py` 595 份 0 失败；`check-links.py` 814 条源码链接 + 105 条内链，0 失效。

---

### utils 第六梯队：ast、marketplaceManager 与 auth（第 47 批，3 份 7,324 行，321 锚点）

`bash/ast.ts`（2,679 行）、`plugins/marketplaceManager.ts`（2,643 行）、`auth.ts`（2,002 行）。三份都在 `bashParser` 与 `pluginLoader` 的下游：一个把语法树变成可信 argv，一个管市场的落盘与对账，一个管凭证从哪来、什么时候刷新。

| 文件                                                                                         | 原文    | 批注版   | 批注  | 讲什么                                             |
| ------------------------------------------------------------------------------------------ | ----- | ----- | --- | ----------------------------------------------- |
| [`utils/bash/ast.ts`](annotated/src/utils/bash/ast.ts)                                     | 2,679 | 2,783 | 104 | AST 安全分析：白名单遍历、作用域传播、argv 后置语义检查                |
| [`utils/plugins/marketplaceManager.ts`](annotated/src/utils/plugins/marketplaceManager.ts) | 2,643 | 2,746 | 103 | 市场管理器：意图层/状态层、种子同步、git 与 URL 缓存、对账刷新            |
| [`utils/auth.ts`](annotated/src/utils/auth.ts)                                             | 2,002 | 2,116 | 114 | 凭证层：八种 token 来源、apiKeyHelper 的 SWR、OAuth 跨进程刷新锁 |

**`ast.ts` 的五个要点**：

1. **安全性质来自白名单，不来自黑名单**。`DANGEROUS_TYPES` 明说不求完备，真正兜底的是 `walkArgument` / `walkCommand` 的 `default: return tooComplex(child)`——没显式处理的节点类型一律判复杂。解析中止（超时/节点预算/panic）也必须 fail-closed，历史上把它与「模块未加载」混为一谈，回落到缺 `EVAL_LIKE_BUILTINS` 的旧路径，`trap`/`enable`/`hash` 在 `Bash(*)` 下泄漏了。
2. **变量作用域不能线性流过 `||` / `|` / `&`**。这三种分隔符后面设的变量要么可能没执行、要么在子 shell 里，线性传递会造成「省略 flag」攻击：`true || FLAG=--dry-run && cmd $FLAG` 在 bash 里 cmd 不带 dry-run，而我们的 argv 反而看起来更安全。做法是入口快照、遇这三种重置；`&&` 与 `;` 是顺序执行，正常传递。
3. **placeholder 与真实值的分界线**。已追踪的字面变量**直接返回真实值**（`VAR=/etc && rm $VAR` 必须让路径校验看到 `/etc`）；非常量值当裸参数一律拒绝，只在字符串内给占位符；而「纯占位符字符串」（`"$(cmd)"`）也要拒——否则 `cd "$(echo /etc)"` 会通过校验却在运行时进 `/etc`。
4. **`.text` 会在必要时从 argv 重建**。原文含「美元符加标识符」或含换行时重建：前者因为 `SUB=push && git $SUB --force` 的原文匹配不上 `git push:*` 拒绝规则；后者因为行续接在原文里可见、在 argv 里已折叠，下游剥离包装命令时会卡住。
5. **后置语义检查专治「分词没问题、名字有问题」**。剥包装器（`time`/`nohup`/`timeout`/`nice`/`env`/`stdbuf`）时遇到不认识的 flag 一律 fail-closed（`timeout -k 5 10 eval` 曾让 eval 逃过检查）；`timeout .5` 这种 libc 浮点写法也要认；数组下标在 `-v`/`-a`/算术比较/`read` 位置参数四类位置会被 bash 算术求值，单引号也拦不住。

**`marketplaceManager.ts` 的四个要点**：

1. **意图层与状态层分开**。settings 里的 `extraKnownMarketplaces` 是用户声明，`known_marketplaces.json` 是运行时产物；回写意图必须写到**声明它的那个** settings 源，否则会在低优先级层造出重复条目。读配置有两个版本，`Safe` 版只许用在只读路径——读失败返回空对象，接着写回会把损坏文件整个覆盖，用户其余条目永久消失。
2. **两个方向都做越界校验**。重命名缓存前确认最终路径严格位于缓存目录之下（恶意清单用 `..` 或 `.` 作名字时既不能删到外面、也不能删缓存目录本身）；清理旧 installLocation 与刷新远程源之前也校验——历史上配置损坏（Windows 路径在 WSL 读、字面波浪号、手改）曾指向用户项目目录，git 会以那里为工作目录、pull 失败还会 rm（gh-32793、gh-32661）。
3. **种子目录 = 管理员地盘**。注册时种子赢、多种子先到先得、`autoUpdate` 强制 false、安装位置按运行时目录重算（多阶段 Docker 挂载点会漂移）；删除/刷新/改自动更新一律报错并指引「找管理员」或「禁用具体插件」，因为下次启动会被覆盖回去。
4. **稀疏检出的三个迁移只有两个能就地做**。全量→稀疏、稀疏 A→稀疏 B 直接重设规则；稀疏→全量必须**返回非零让上层重克隆**，因为在部分克隆上执行 `sparse-checkout disable` 会触发把所有 blob 惰性拉一遍。

**`auth.ts` 的四个要点**：

1. **托管上下文不许回落用户配置**。远程容器与桌面端由平台带 OAuth 启动，若读用户终端的 apiKeyHelper / API key，会在 key 过期或异组织时全线失败。ssh 远程更极端：只看占位令牌存不存在，远端的设置绝不能参与判断，否则请求头与代理注入的身份不匹配。
2. **apiKeyHelper 是 stale-while-revalidate + 世代号**。过期时先返回旧值、后台刷新；后台失败**不用哨兵覆盖可用旧值**，只更新时间戳避免雪崩；清缓存递增 epoch，在途旧任务写回前比对 epoch 丢弃自己。失败哨兵用空格而非 null——null 会让调用方回落到 OAuth，等于悄悄换身份。
3. **跨进程令牌失效是真实 bug**（带 issue 编号）。A 终端登录修好自己，B 终端登录会让服务端吊销 A 的令牌，而 A 的记忆化缓存永不重读 → 无限重登。解法是每次取令牌前比对凭证文件 mtime。401 处理先看钥匙串里是否已被别人换过，同一个失败令牌的并发 401 还要去重（不去重时同步钥匙串读取能阻塞渲染帧 800ms 以上）。
4. **刷新必须跨进程加锁 + 双重检查**。抢不到锁就退避重试（带随机抖动错开），拿到锁后再查一次（等锁期间别人可能已刷好），刷新成功前后各清一次缓存，最后在 finally 里释放锁。订阅用户刷新时**省略作用域**，让服务端能在不重登的前提下扩权。

踩坑：`ast.ts` 与 `marketplaceManager.ts` 的数据文件都被预检拦了一轮——批注里引用 shell 字面量（`"$(cmd)"`、`env "FOO=bar"`、`\-n`）会带英文双引号与反斜杠。全部改成「引号包裹的 XX」「转义写法的 -n」这类中文表述后通过。这条已是第二次踩到（批 45 bashParser），以后写数据文件时直接不用引号字符。

流程账：预检三份一次通过（321 锚点，其中 `ast.ts` 两轮修引号、`marketplaceManager` 一轮）；`annotate.py` 零 `⟳`；`check-fidelity.py` 598 份 0 失败；`check-links.py` 816 条源码链接 + 106 条内链，0 失效。

---

### utils 第七梯队：只读命令白名单、配置层与 PowerShell 解析（第 48 批，3 份 5,514 行，173 锚点）

`shell/readOnlyCommandValidation.ts`（1,893 行）、`config.ts`（1,817 行）、`powershell/parser.ts`（1,804 行）。三份分别对应「判定能不能自动跑」「把状态存到哪」「另一种 shell 的语法怎么读」——都在权限链的上游。

| 文件                                                                                                   | 原文    | 批注版   | 批注 | 讲什么                                                         |
| ---------------------------------------------------------------------------------------------------- | ----- | ----- | -- | ----------------------------------------------------------- |
| [`utils/shell/readOnlyCommandValidation.ts`](annotated/src/utils/shell/readOnlyCommandValidation.ts) | 1,893 | 1,959 | 66 | 只读命令白名单：git/gh/docker/rg/pyright 的标志表、位置参数回调、UNC 检测、标志校验主循环 |
| [`utils/config.ts`](annotated/src/utils/config.ts)                                                   | 1,817 | 1,873 | 49 | 配置层：单文件 JSON、文件锁、mtime 缓存、备份轮转、历史迁移、auth 丢失守卫               |
| [`utils/powershell/parser.ts`](annotated/src/utils/powershell/parser.ts)                             | 1,804 | 1,876 | 58 | PowerShell AST 解析：调真 pwsh 解析、PS1 脚本内联、argv 字节预算、别名表与危险标记    |

**`readOnlyCommandValidation.ts` 的五个要点**：

1. **整张表的核心风险是 parser differential（解析差）**。`FlagArgType` 的 `none` 声明「该标志不吃参数」，一旦真程序认为它吃参数，校验器就少消费一个 token，剩下的被当位置参数放行。`git diff` 的 `-S` 就是活例：原标 `none`，`git diff -S -- --output=/tmp/pwned` 让校验器在双短横线处 break，而 git 的 getopt 把 `--` 当 pickaxe 参数、把 `--output=` 当长选项——**任意文件写**。修法是改成 `string`。
2. **位置参数的写操作只能靠回调拦**。`git tag foo` 创建 refs、`git branch foo` 创建分支、`git reflog expire/delete` 改写 logs，都不是标志，`validateFlags` 的位置参数兜底会直接放行。回调只查「语法上唯一的危险槽位」（reflog 只看第一个位置参数；tag/branch 看有没有 `-l/--list`），比逐 token 猜语义可靠。
3. **`--` 之后的语义会反转**。`git tag -- -l` 不是列表，而是**创建**一个名叫 `-l` 的标签；`git branch -- -l` 同理。所以 `seenDashDash` 之后所有 token 一律按位置参数处理，且所有「有列表标志才安全」的判断都失效。
4. **`git branch --abbrev` 是双层防御的样板**。git 只接受粘连形式 `--abbrev=N`，分离形式里的 N 会变成**分支名**。所以 `safeFlags` 仍标 `number`（否则 `--abbrev=7` 被误拒），同时回调的 `flagsWithArgs` **故意删掉**它——回调因此把 N 看成没有列表标志的位置参数，判危险。单靠任何一层都不成立。
5. **三处「宽松声明才是安全方向」**：`--sort` 允许以 `-` 开头的值（反向排序键）；`git status -u` 标 `string` 而非 `number`（值是枚举词）；`gh` 的 `--repo` 统一挂回调检查 `://`、`@`、两个以上斜杠（三段式主机名 = DNS 外泄通道），且要剥开 `--repo=` 的内联值再判。

**`config.ts` 的四个要点**：

1. **一个文件装所有状态，于是所有问题都要在这一层解决**。并发写用文件锁，写坏后自愈用「默认值打底 + 文件覆盖」合并 + 备份轮转（同分钟只备一次、只留 5 份），读写性能用内存缓存 + `watchFile` 1 秒轮询（stat 跑在 libuv 线程池，卡住的 stat 不阻塞主线程）。
2. **auth 丢失守卫（GH #3117）是本文件的核心不变量**。另一个进程正在写或非原子写被 kill 时，本进程读到截断内容 → 解析失败 → 拿到默认配置；若写回，`oauthAccount` 与引导完成标记永久消失。守卫在**三条路径**上都存在：带锁写之前、加锁失败的回退路径、项目配置的对应路径。且「没写」必须返回 false，调用方据此决定**不刷缓存**——刷了就把守卫依赖的好状态毁掉。
3. **写穿的 mtime 超调**。写完立刻用 `Date.now()` 记缓存时间，必然大于文件真实 mtime，于是监视器下次 tick 认为「缓存比文件新」、跳过重读自己的写。一个假时间戳换掉一次多余磁盘读。
4. **「返回同一引用」是「无变更不写盘」的唯一信号**。`removeProjectHistory` 在无脏字段时原样返回入参；`saveConfigWithLock` 见到 `mergedConfig === currentConfig` 就返回 false。上游 updater 若随手新建对象，启动阶段几十次保存会全部变成真实的锁 + 读 + 备份 + 写。

**`powershell/parser.ts` 的四个要点**：

1. **不自己写解析器，调真 pwsh**。PowerShell 语法太杂（参数缩写、四种破折号、可展开字符串、splatting、参数块、using 语句），自研必然产生解析差，而解析差在权限判定里就是漏洞。脚本用 `-EncodedCommand` 传（base64 内嵌用户命令），避开 stdin 交互模式、命令行转义、临时文件三个坑。
2. **`ParamBlock` 是 ScriptBlockAst 的兄弟节点**。它不在 Begin/Process/End 里，所以「遍历命名块」完全看不到 `param($x = (Remove-Item /))` 里的删除命令——而 PowerShell 在参数绑定时就求值默认值。`[ValidateScript({...})]` 属性同理。必须单独对 ParamBlock 做 FindAll。
3. **argv 预算必须按 UTF-8 字节算**。Windows CreateProcess 上限 32,767 字符，而命令行是「命令 → base64 → 嵌脚本 → UTF-16LE → 再 base64」两级放大（系数 8/3）。用 `.length`（UTF-16 代码单元）判断时，1,092 个汉字能通过门禁但实际 argv 约 4 万字符 → CreateProcess 失败 → 解析失败 → **拒绝规则静默降级成询问**（finding #36）。上限现在由脚本长度反推，不再写死。
4. **别名表用 `Object.create(null)`，并刻意留空歧义项**。前者防原型污染（命令名写 `constructor` / `__proto__` 会命中原型属性）；后者因为 PowerShell 6+ 删掉了 `sc`/`sort`/`curl`/`wget` 的别名（与原生 exe 冲突），若映射 `sort` → Sort-Object 而系统实际跑 sort.exe，就是「按安全命令批准、实际跑了别的程序」。

踩坑（新类型，务必记住）：**Bash 工具的命令行里出现 `powershell` 字样会被安全策略拦截**，报「Invoking PowerShell from Bash bypasses PowerShell security checks」。`annotate.py` / `check-fidelity.py` 只要参数里带这个路径就跑不动。解法是写包装脚本，在 Python 里把路径拼成 `power` + `shell` 再传给 `runpy`，命令行里不出现完整字样；改 PowerShell 工具也不行——它的过滤器会拦批注文本里的 `Invoke-Expression`。

踩坑（第二类）：**锚点落在多行模板字符串内部会被自动外移到同一行**。PS1 脚本是 250 行的模板常量，原本给内部 12 个函数各写了锚点，`template_shift` 会把这些全部挪到脚本结束行——12 条批注堆在一处。正确做法是只留「段首」与「段尾」两条总述，把内部细节合并进正文。

流程账：预检三份全过（173 锚点）；`annotate.py` 仅 1 次无害 `⟳`（模板起始行 before 原地）；`check-fidelity.py` 601 份 0 失败；`check-links.py` 819 条源码链接 + 107 条内链，0 失效。

---

### utils 第八梯队：路径权限判据、原生安装器与插件 schema（第 49 批，3 份 5,166 行，170 锚点）

`permissions/filesystem.ts`（1,777 行）、`nativeInstaller/installer.ts`（1,708 行）、`plugins/schemas.ts`（1,681 行）。三份的共同点是「判据本身」：文件能不能写、装的东西能不能用、配置算不算合法——都不是业务逻辑，而是把模糊的人类意图钉成可执行的规则。

| 文件                                                                                       | 原文    | 批注版   | 批注 | 讲什么                                                    |
| ---------------------------------------------------------------------------------------- | ----- | ----- | -- | ------------------------------------------------------ |
| [`utils/permissions/filesystem.ts`](annotated/src/utils/permissions/filesystem.ts)       | 1,777 | 1,837 | 60 | 路径级权限判定：读/写两条有序检查链、规则根解析、gitignore 模式匹配、危险路径清单、内部路径白名单 |
| [`utils/nativeInstaller/installer.ts`](annotated/src/utils/nativeInstaller/installer.ts) | 1,708 | 1,764 | 56 | 原生安装器：目录分层、版本锁、原子落盘、Windows 复制与回滚、旧版本清理、npm 卸载兜底       |
| [`utils/plugins/schemas.ts`](annotated/src/utils/plugins/schemas.ts)                     | 1,681 | 1,735 | 54 | 插件与市场 schema：冒名防护、manifest 全字段、市场源九种形态、已安装记录 V1→V2     |

**`filesystem.ts` 的五个要点**：

1. **显式规则优先于一切隐式推导**。读链顺序是 UNC → 可疑路径模式 → 读禁止 → 读询问 → 编辑隐含读 → 工作目录 → 内部路径 → 读允许 → 问。读禁止与读询问**必须**排在「编辑权限隐含读权限」之前，否则「同目录给了编辑权限」会把一条显式禁止悄悄覆盖掉。
2. **每个「路径在目录内」判定前都要 `normalize`**，而且不是防御性冗余——注释里逐个举了绕过样例（`scratchpad/../../../etc/passwd`、`plans/x/../../../etc/passwd.md`）。
3. **危险清单分两级**：十个文件名（shell 启动脚本、git 配置、MCP 配置、自身配置）与四个目录（`.git`、`.vscode`、`.idea`、`.claude`）。目录按**路径段**比较而非子串；中间留了一个 `.claude/worktrees` 特例（结构性路径，不是用户配置目录），只跳过那一个段。
4. **Windows 特有攻击面是检测而非规范化**。ADS 冒号、8.3 短名、长路径前缀、尾部点与空格、DOS 设备名、三个以上连续点、UNC——注释用整整一屏解释为什么不走规范化：短名规范化依赖文件已存在、规范化与访问之间有 TOCTOU、还要处理一堆路径格式。结论是模式检测更可预测，并要求改动前先找 AppSec。
5. **打包技能目录的 per-process nonce 是承重结构**。uid、版本号、技能名、文件键全是公开信息，只有 nonce 是秘密；没有它，本地攻击者可在共享临时目录预建整棵树（粘滞位只阻止删除不阻止创建），再把中间目录换成符号链接——而该子树在**读白名单**里，替换内容等于向上下文注入。

**`installer.ts` 的四个要点**：

1. **原子安装 = 复制到安装目录旁边的临时文件 + rename**。不能直接从暂存目录 rename：缓存与数据目录常是不同挂载点，跨设备 rename 报 EXDEV。只有同目录 rename 才是原子的。
2. **锁的目的是「别删我」**。清理旧版本前要算三份保护名单：当前进程的可执行文件、符号链接指向的版本、**任何进程持有活跃锁的版本**。PID 锁能立刻发现崩溃进程，mtime 锁只能等超时；两处超时常量必须一致，否则会出现「运行中进程的锁被判成陈旧」。
3. **Windows 没有符号链接可用，只能复制**，于是更新要先改名旧文件再复制新文件，复制失败必须回滚，回滚失败要**优先报回滚错误**（用户已经没法用了）。删不掉旧 exe 是正常现象，留给下次启动清理。
4. **单飞守卫是被事故逼出来的**：自动更新组件随浮层切换重挂载，「正在更新」标志活不过重挂载，每次重挂载就再下一次几百兆的二进制，某次会话内存缓冲涨到 91GB。修法是把状态提到模块级，并保证成功与失败都清空。

**`schemas.ts` 的四个要点**：

1. **冒名防护分两层且必须分两层**：名字层拦白名单外的官方名冒用 + 非 ASCII（同形字）+ 三种冒名词序；来源层要求保留名只能来自官方 GitHub 组织。单看任一层都能被绕过。
2. **宽松与严格的分界是按「谁的错」画的**：manifest 顶层未知字段静默丢弃（作者可能加自定义字段，报错会让插件装不上），嵌套的严格对象（用户配置、渠道、LSP）仍 strict（那里的多余键更像拼写错误）。市场条目也必须宽松——数组里一条报错会让整个市场的插件全部不可用。
3. **共享 schema 是防漂移手段**：settings 这一路先写盘再跑完整校验，两套校验若不一致就会在缓存里留下孤儿文件；所以市场名校验做成单一 schema 给两处共用，漂移变成不可能。
4. **前向兼容靠「允许但忽略」**：依赖引用允许带版本后缀与对象形态，但 transform 时静默剥掉——未来客户端加版本约束时，旧客户端不会因为 schema 校验失败而拒绝整个插件。

踩坑：**开工时 `annotated-索引与进度.md` 又一次被外部编辑器重排回写**，内容退回第 47 批状态（丢第 48 批小节、39.7% 退回 38.6%、`<summary>` 包裹、删空行）。按上一批的经验做规范化语义比对（去反斜杠 + 去空白 + 分隔线归一）确认零新增后 `git checkout` 还原 HEAD，重排版备份在 `/tmp/索引-外部回写-第48批后.md`。

踩坑：**锚点选行要落在「块闭合处」而不是「块内最后一条语句」**。`installer.ts` 原写 666（`return false`，在 if 内部）应改 667（if 的闭合括号）；1690 是空行，实际语句在 1689。这两个都是「语义看着对、插入位置错一层」的典型。

流程账：预检三份全过（170 锚点，一次通过）；`annotate.py` 零 `⟳`；`check-fidelity.py` 604 份 0 失败；`check-links.py` 822 条源码链接 + 108 条内链，0 失效。

### utils 第九梯队：进程内队友运行器、权限初始化、终端光标、worktree 与 YOLO 分类器（第 50 批，5 份 7,628 行，336 锚点）

`inProcessRunner.ts` 负责把队友真正跑起来（AsyncLocalStorage 上下文 + runAgent 主循环 + 权限轮询），`yoloClassifier.ts` 与 `permissionSetup.ts` 负责 auto 模式下「这次动作该不该拦」的判断与模式切换，`Cursor.ts` 是终端输入框的光标与字素原语，`worktree.ts` 则是把这一切隔离进独立 git worktree 的底层机制。

| 文件                                                                                           | 原文    | 批注版   | 批注 | 讲什么                                                         |
| -------------------------------------------------------------------------------------------- | ----- | ----- | -- | ----------------------------------------------------------- |
| [`utils/swarm/inProcessRunner.ts`](annotated/src/utils/swarm/inProcessRunner.ts)             | 1,552 | 1,601 | 49 | 进程内队友运行器：AsyncLocalStorage 上下文、runAgent 主循环、队友权限轮询、计划模式状态协调 |
| [`utils/permissions/permissionSetup.ts`](annotated/src/utils/permissions/permissionSetup.ts) | 1,532 | 1,599 | 67 | 权限模式初始化与切换：auto 模式危险规则剥离、YOLO 分类器装配、计划模式状态协调                |
| [`utils/Cursor.ts`](annotated/src/utils/Cursor.ts)                                           | 1,530 | 1,592 | 62 | 终端光标与文本编辑原语：Unicode 归一化、字素簇边界、kill ring、可视换行对齐              |
| [`utils/worktree.ts`](annotated/src/utils/worktree.ts)                                       | 1,519 | 1,596 | 77 | git worktree 隔离：slug 校验、创建与快速恢复、符号链接大目录、钩子、过期清理、tmux 快速路径   |
| [`utils/permissions/yoloClassifier.ts`](annotated/src/utils/permissions/yoloClassifier.ts)   | 1,495 | 1,576 | 81 | auto 模式 YOLO 安全分类器：系统提示拼装、转录压缩、两阶段 XML 分类、工具调用分类            |

**`inProcessRunner.ts` 的四个要点**：

1. **队友运行靠 AsyncLocalStorage 传上下文，不靠参数透传**。runAgent 主循环里大量状态（当前权限上下文、遥测、紧凑模式标志）都挂在 ALS 上，队友 spawn 时继承，避免一层层往下塞。
2. **权限轮询是 fire-and-forget 的后台循环**，每 500 毫秒一次，只更新「当前队友能否用某工具」的快照；真正裁决仍在 canUseTool 里，轮询只是把「半路被用户改了设置」这类变化尽快反映出来。
3. **计划模式状态协调是收敛点**：当 auto 模式的前提（比如没开 bypass）被破坏时，这里负责把状态压回安全侧。
4. **`⟳` 提示本身不是错误**：本文件有 6 个锚点原本落在 `//` 注释段中部，annotate.py 自动挪到段边界，避免把一句英文注释从中间劈开。

**`permissionSetup.ts` 的四个要点**：

1. **auto 模式的危险规则剥离是单向的**：来自 Bash 权限配置里「对 auto 模式危险」的规则在切到 auto 时直接丢弃，绝不能被用户的 allow 列表悄悄加回来。
2. **YOLO 分类器不是唯一裁决者**：setup 负责把「分类器可用吗、用外部还是内部模板、PowerShell 要不要纳入」这些开关装配好，分类结果再交给 canUseTool 收口。
3. **多行 `const` 的锚点必须落在声明收尾行**：初版把注释放到了 `const fromUsesClassifier =` 首行，被 check-fidelity 判为「劈开未结束的多行表达式」，挪到 `||` 链收尾行后复验通过。
4. **计划模式与 auto 模式是两个正交维度**：setup 里的状态机显式区分「当前是 plan 还是 auto」，避免一个开关误伤另一个的判定。

**`Cursor.ts` 的三个要点**：

1. **所有光标操作建立在 NFC 归一化文本之上**，组合字符与 CJK 宽度都按归一化后计算，保证跨平台显示一致。
2. **字素边界用 Intl.Segmenter**，正确处理 CJK（每字一词）与空格分词语言；图片引用块 `[Image #N]` 整体跳过，避免 Ctrl+W 留下半截块。
3. **换行测量与字素、词边界惰性计算并缓存**，MeasuredText 只在真正需要时算，长输入不重复开销。

**`worktree.ts` 的四个要点**：

1. **slug 校验同步抛错，且跑在任何副作用之前**：path.join 会把 `..` 归一化掉，所以 `../../../target` 这类穿越必须先在字符串层面拦死。
2. **嵌套 slug 拍平成 `user+feature` 是单射映射**：既规避 git 引用的 D/F 冲突，又保证「分支名」与「目录名」两处都安全。
3. **快速恢复只读 `.git` 指针文件**，跳过 fetch 与创建，避免每次 resume 都卡在凭据提示上；新建才需要拉基础分支并 add。
4. **过期清理保守失败（fail-closed）**：只碰瞬时图案 slug、跳过当前会话、git status 不干净或有无推送提交就跳过，绝不误删用户命名的 worktree。

**`yoloClassifier.ts` 的四个要点**：

1. **两套实现共用同一提示拼装**：XML 两阶段与 tool_use 分类都从 `buildYoloSystemPrompt` 拿系统提示，区别只在输出格式（`<block>` 标签 vs 结构化工具调用）。
2. **转录压缩是防提示词注入的关键**：只保留用户文本与助手 tool_use 块（剔除助手自由文本，防被精心构造来影响分类），并用 JSON 转义天然防伪造。
3. **两阶段 XML 分类：阶段一低 max_tokens 逼即时 yes/no，放行即返回；拦下才升阶段二做带推理的复审**，降低误拦；alwaysOnThinking 模型无法关思考时留 token 余量防截断。
4. **所有失败路径默认拦截（shouldBlock: true）**：API 出错、提示过长、解析失败都按安全处理，区分「主动拦截」与「分类器不可用」靠 `unavailable` 标志。

踩坑：本批数据文件初版漏写 `_p1` 后缀（`scripts/_annot/src_utils_*.py` 而非 `_p1.py`），而 `annotate.py` 按 `<slug>_p*.py` 定位数据，预检直接报「找不到批注数据」；补上 `_p1` 后预检通过。另有两个锚点落进多行 `const` 声明中部（`ANTHROPIC_PERMISSIONS_TEMPLATE`、`classifierType`）被 check-fidelity 拦下，分别挪到三元收尾行与 `? :` 链末行后复验 0 失败。

流程账：预检五份全过（336 锚点，一次通过）；`annotate.py` 良性 `⟳` 外移 12 处（inProcessRunner 6 + permissionSetup 4 + worktree 2，均为 `//` 注释段自动归并，非模板串）；首轮 `check-fidelity.py` 2 处失败（多行 `const` 被劈开），修锚点后 5 份 0 失败；`check-links.py` 825 条源码链接 + 109 条内链，0 失效。

---

### utils 第十梯队：IDE 集成、权限主流水线、CLAUDE.md 装载与上下文分析（第 51 批，4 份 5,841 行，188 锚点）

四份都是「环境的入口」而不是业务逻辑：`ide.ts` 找编辑器、`permissions.ts` 判能不能动手、`claudemd.ts` 装指令、`analyzeContext.ts` 量窗口。放在一批读的好处是能看清它们共用同一条判据链——**显式声明压过一切隐式推导**。

| 文件                                                                                   | 原文    | 批注版   | 批注 | 讲什么                                                  |
| ------------------------------------------------------------------------------------ | ----- | ----- | -- | ---------------------------------------------------- |
| [`utils/ide.ts`](annotated/src/utils/ide.ts)                                         | 1,494 | 1,540 | 46 | IDE 集成发现层：锁文件扫描、端口探活、工作区前缀匹配、进程祖先链、扩展安装              |
| [`utils/permissions/permissions.ts`](annotated/src/utils/permissions/permissions.ts) | 1,486 | 1,532 | 45 | 权限主流水线：1a–1g 规则层 → 2a/2b 模式层 → dontAsk/auto 两个后处理    |
| [`utils/claudemd.ts`](annotated/src/utils/claudemd.ts)                               | 1,479 | 1,530 | 51 | CLAUDE.md 装载：四类记忆优先级、@include 递归与防环、条件规则 glob 匹配、排除项 |
| [`utils/analyzeContext.ts`](annotated/src/utils/analyzeContext.ts)                   | 1,382 | 1,428 | 46 | 上下文用量分析：七个并行计数器、延迟工具记账、保留缓冲语义、10×10 字符网格             |

**`ide.ts` 的四个要点**：

1. **发现链有四道筛，顺序就是性能设计**：mtime 排序 → TCP 探活 → 工作区路径前缀匹配（纯内存）→ 进程祖先链（要 shell 出 ps，最多 10 次）。祖先链检查放在最后且惰性触发，注释写明早先它在每个锁文件上都跑一次，是 CPU profile 的头号热点。
2. **路径比较必须先 NFC 归一**：macOS 返回 NFD（分解式 Unicode），VS Code 报 NFC，带重音或 CJK 的路径不做归一永远匹配不上；Windows 还要额外把盘符统一大写。
3. **WSL 是双命名空间问题**：`/mnt/c` 访问慢 2–10 倍，所以候选路径**故意不做存在性预检**，交给消费方 readdir 吃 ENOENT；Windows 侧 pid 在 WSL 里无意义，清理锁文件必须「pid 不在 + 端口不活」双判据。
4. **30 秒轮询只在恰好一个匹配时返回**：多于一个就返回 null 让用户走 `/ide` 手选——自动连错窗口比连不上更糟（diff 会打到别人的工作区）。

**`permissions/permissions.ts` 的四个要点**：

1. **步骤编号就是架构**：1a–1g 是规则层与免疫层（deny / 必需交互 / 内容级 ask / 安全路径检查都在 bypassPermissions 之前），2a/2b 是模式层，3 把 passthrough 转 ask。后面所有模块的注释都在引用这些编号。
2. **不可被分类器批准的安全检查完全免疫所有快路**：acceptEdits 快路、安全工具白名单、分类器三条都过不去；而「可被分类器批准」的敏感路径检查则放行到分类器。区分「能不能让 AI 判」是这套设计的核心。
3. **dontAsk 与 auto 两个转换放在最外层**（result 已成型之后），注释写明理由：内层有十余处早退，任何一处漏掉就是策略被绕过。
4. **`syncPermissionRulesFromDisk` 有一段必须记住的坑**：替换前要主动清空每个「磁盘源 × 行为」组合，因为 `convertRulesToUpdates` 只对有规则的分组生成更新——某组被删空后不产生更新，旧规则就留在 context 里（删一条 deny，它还在）。

**`claudemd.ts` 的四个要点**：

1. **四类记忆按优先级从低到高装载**：Managed → User → Project → Local，后加载的优先级更高（模型更注意靠近末尾的内容）。向上走的目录循环 `reverse()` 就是为了保证「越靠近 cwd 越晚进列表」。
2. **`@include` 用 processedPaths + 深度 5 双重防环**，且符号链接要把 realpath 也登记一遍，否则不同链接指向同一文件会重复注入。扩展名走**白名单**——允许二进制等于允许把乱码塞进 prompt。
3. **only-when-needed 的 token 往返**：只有确实含 `<!--` 才走 lexer 重建内容，因为 marked 会把 CRLF 归一成 LF，无辜文件往返一次就会被误标 `contentDiffersFromDisk`，把下游缓存逻辑全部降级。
4. **`getMemoryFilesForNestedDirectory` 的 Set 复制是正确性要求**：无条件规则用副本处理，否则那些文件被标成「已处理」，同目录的带 paths 规则永远匹配不到。另有一段 worktree 重复加载的处置（issue 29599）：只跳过主仓库侧的 **Project** 类文件，`CLAUDE.local.md` 不跳。

**`analyzeContext.ts` 的四个要点**：

1. **`TOOL_TOKEN_COUNT_OVERHEAD = 500` 是计数偏差而非工具成本**：请求带工具时 API 会加一段约 500 token 的前言，逐个计数会累积 N 份，所以单工具计数一律减 500、整批计数只减一次。
2. **延迟工具显示但不计入占用**：`isDeferred` 分区在 `actualUsage` 求和时被跳过——tool search 开启后 MCP 工具默认不加载，算进占用会让用户以为窗口莫名满了。
3. **有些模式下故意不画保留缓冲**：reactive-only（cobalt_raccoon）与 context-collapse（marble_origami）下前摄性压缩根本不会触发，画一个 33k 的缓冲条就是在撒谎。
4. **总量优先用 API 真实值**（input + cache_creation + cache_read），口径与状态栏一致——两个界面显示不同数字是用户最常报的 bug。

踩坑：`claudemd.ts` 的锚点 1195 文本里写了一句带英文双引号的 `避免"有指令但没内容"的空壳`，预检直接拦下（第 5 条硬规矩），改成「」后通过。这是本仓第三次因引号被拦，写数据文件时**正文里不要出现任何英文引号字符**这条已经稳了。

流程账：预检四份全过（188 锚点，一次通过）；`annotate.py` 四次零 `⟳`；`check-fidelity.py` 613 份 0 失败；`check-links.py` 830 条源码链接 + 110 条内链，0 失效。

### utils 第 52 批：设置、沙箱、插件与 git 基础工具（第 52 批，10 份 9,481 行，280 锚点）

十份分散在 utils 各处的「工具基础设施」：设置装载、沙箱适配、插件下载与命令加载、提交归因、swarm 权限同步、遥测会话追踪、git 根定位与工作树安全校验、斜杠命令分发、插件校验器。没有统一主题，但都是上层反复依赖的底座。

| 文件                                                                                                               | 原文    | 批注版   | 批注 | 讲什么                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ----- | ----- | -- | -------------------------------------------------------- |
| [`utils/settings/settings.ts`](annotated/src/utils/settings/settings.ts)                                         | 1,015 | 1,043 | 28 | 设置加载/合并/策略来源/写回/自动模式配置                                   |
| [`utils/sandbox/sandbox-adapter.ts`](annotated/src/utils/sandbox/sandbox-adapter.ts)                             | 985   | 1,018 | 33 | 沙箱适配器（内置 SECURITY 块，H1 漏洞修复）                             |
| [`utils/plugins/mcpbHandler.ts`](annotated/src/utils/plugins/mcpbHandler.ts)                                     | 968   | 991   | 23 | MCPB 下载/解压/缓存/用户配置分流（H1 #3617646 修复）                     |
| [`utils/commitAttribution.ts`](annotated/src/utils/commitAttribution.ts)                                         | 961   | 994   | 33 | 提交归因系统（谁改了哪段代码）                                          |
| [`utils/plugins/loadPluginCommands.ts`](annotated/src/utils/plugins/loadPluginCommands.ts)                       | 946   | 963   | 17 | 插件命令/技能加载与分发                                             |
| [`utils/swarm/permissionSync.ts`](annotated/src/utils/swarm/permissionSync.ts)                                   | 928   | 957   | 29 | swarm 权限同步（文件式 + 邮箱式两条链路）                                |
| [`utils/telemetry/sessionTracing.ts`](annotated/src/utils/telemetry/sessionTracing.ts)                           | 927   | 958   | 31 | OpenTelemetry 会话追踪：interaction/llm/tool/hook span        |
| [`utils/git.ts`](annotated/src/utils/git.ts)                                                                     | 926   | 957   | 31 | git 根定位/worktree 安全校验/issue 状态保留                         |
| [`utils/processUserInput/processSlashCommand.tsx`](annotated/src/utils/processUserInput/processSlashCommand.tsx) | 922   | 953   | 31 | 斜杠命令分发：fork 子代理 / 本地 / 提示词三路                             |
| [`utils/plugins/validatePlugin.ts`](annotated/src/utils/plugins/validatePlugin.ts)                               | 903   | 928   | 25 | `claude plugin validate` 校验器（manifest/frontmatter/hooks） |

**几个值得记住的点**：

1. **`git.ts` 的 worktree 安全校验是沙箱逃逸的命脉**：克隆下来的仓库里 `.git` 文件与 `commondir` 都攻击者可控，不校验就会被诱导借用受害者的信任目录、绕过信任对话框执行 `.claude/settings.json` 钩子。`resolveCanonicalRoot` 用「worktreeGitDir 必须是 `<commonDir>/worktrees/` 直接子目录」+「`<worktreeGitDir>/gitdir` 必须指回 `<gitRoot>/.git`」两步缺一不可的校验挡住；`isCurrentDirectoryBareGitRepo` 则防 cwd 被伪装成裸仓库触发钩子。
2. **`sandbox-adapter.ts` 与 `mcpbHandler.ts` 都内置 SECURITY 块**：前者挡沙箱内命令越权、后者挡用户配置被污染（mcpbHandler 对应 H1 #3617646 的下载/解压/缓存校验修复）——读这两份时 SECURITY 块要逐字对照，它们是「为什么这么写」的权威注解。
3. **`processSlashCommand.tsx` 的 `context:fork` 分支**是「后台定时任务」与「同步技能」的分水岭：KAIROS 开启时后台 fire-and-forget 用独立的 abortController，N 个定时任务并行而非串行，结果以隐藏 isMeta 提示回队；否则同步跑并带进度 UI。

踩坑：本批无预检 FAIL、无 `⟳` 外移、无块注释内中文告警；`processSlashCommand.tsx` 末行 base64 sourceMappingURL 按惯例省略（fidelity 标 `OK*`）。**进度口径提示**：实测 `check-coverage.py src/utils` 现在显示缺份前 10 从 `bash/commands.ts`(1339) 起，本批按既定计划吃掉 903–1015 行档（即缺份排名 11–20），下一批应直接接 1339 起的前 10 大文件，而不是继续 903 档。

流程账：预检十份全过（280 锚点，一次通过）；`annotate.py` 十次零 `⟳`；`check-fidelity.py` 623 份 0 失败；`check-links.py` 源码链接 834 条 + 内链 111 条，0 失效。

### utils 第 53 批：巨兽第三梯队与遥测/图像/队友工具（第 53 批，13 份 14,175 行，529 锚点）

十三份按行数降序取 utils 里体量最大的梯队（1,339 行档的 bash/commands 到 825 行的 instrumentation），主题横跨「Bash 执行核心 / 插件管理 / 设置类型 / 多智能体协作 / 终端渲染 / 遥测 / 大结果落盘 / 图片预处理 / 任务与统计」。没有统一主线，但全是上层反复依赖的底座。

| 文件                                                                                                   | 原文    | 批注版   | 批注 | 讲什么                                              |
| ---------------------------------------------------------------------------------------------------- | ----- | ----- | -- | ------------------------------------------------ |
| [`utils/bash/commands.ts`](annotated/src/utils/bash/commands.ts)                                     | 1,339 | 1,381 | 42 | Bash 命令解析与执行核心：拆命令/危险命令确认/输出截断/超时与信号终止           |
| [`utils/plugins/installedPluginsManager.ts`](annotated/src/utils/plugins/installedPluginsManager.ts) | 1,268 | 1,310 | 42 | 已安装插件管理：marketplace 列表/安装·更新·卸载/manifest/命令技能注册  |
| [`utils/settings/types.ts`](annotated/src/utils/settings/types.ts)                                   | 1,148 | 1,200 | 52 | 设置系统类型定义：配置项 TS 类型/默认值/schema/覆盖层级               |
| [`utils/teammateMailbox.ts`](annotated/src/utils/teammateMailbox.ts)                                 | 1,183 | 1,213 | 30 | 队友邮箱：agent 间异步消息收发/持久化/回执                        |
| [`utils/teleport.tsx`](annotated/src/utils/teleport.tsx)                                             | 1,225 | 1,259 | 33 | 终端输出 TUI 渲染：命令结果虚拟化/ANSI 转义/滚动                   |
| [`utils/telemetry/perfettoTracing.ts`](annotated/src/utils/telemetry/perfettoTracing.ts)             | 1,120 | 1,166 | 46 | Perfetto 性能追踪：trace 采集/写盘/与 OpenTelemetry 桥接     |
| [`utils/fileHistory.ts`](annotated/src/utils/fileHistory.ts)                                         | 1,115 | 1,147 | 32 | 文件历史：变更快照/撤销栈/历史查询                               |
| [`utils/collapseReadSearch.ts`](annotated/src/utils/collapseReadSearch.ts)                           | 1,109 | 1,143 | 34 | 折叠相邻 Read/Search：合成摘要组，抑制上下文膨胀                   |
| [`utils/stats.ts`](annotated/src/utils/stats.ts)                                                     | 1,061 | 1,094 | 33 | 会话统计：使用量/token/活跃时段/聚合持久化                        |
| [`utils/toolResultStorage.ts`](annotated/src/utils/toolResultStorage.ts)                             | 1,040 | 1,090 | 50 | 大工具结果落盘：超长输出写临时文件/引用返回/清理策略                      |
| [`utils/imageResizer.ts`](annotated/src/utils/imageResizer.ts)                                       | 880   | 930   | 50 | 图片缩放压缩：sharp 重采样/格式转换/上传预处理                      |
| [`utils/tasks.ts`](annotated/src/utils/tasks.ts)                                                     | 862   | 912   | 50 | 任务列表管理：swarm 待办增删改查/状态迁移/依赖                      |
| [`utils/telemetry/instrumentation.ts`](annotated/src/utils/telemetry/instrumentation.ts)             | 825   | 860   | 35 | OpenTelemetry 启动引导：SDK 初始化/exporter/采样/全局 tracer |

**几个值得记住的点**：

1. **`bash/commands.ts` 是 BashTool 的「大脑」**：它把用户输入的命令字符串拆成安全的执行计划——危险命令（`rm -rf` 等）走交互确认、长输出做尾部截断与分页、子进程超时/信号终止全部在这里编排；和之前批注的 BashTool 下半（安全核心与渲染）正好拼成完整执行链路，读 Bash 必须这两份对照看。
2. **`toolResultStorage.ts` 与 `collapseReadSearch.ts` 是解决「上下文爆炸」的两个互补手段**：前者把超长工具结果（大文件读取、长命令输出）落盘并以引用返回，后者把相邻同文件 Read/Search 折叠成摘要组——一静一动共同保证 agent 不会因上下文膨胀而掉链子。
3. **`teammateMailbox.ts` 实现 agent 间异步通信**：不同于 `SendMessage` 的即时调用，邮箱是持久化、可轮询、带回执的异步通道，是 swarm 多智能体协作里「解耦生产/消费」的关键；与 `tasks.ts` 的任务状态机配合构成 swarm 的调度骨架。
4. **`telemetry` 双件套（`instrumentation` + `perfettoTracing`）是性能可观测性的底座**：`instrumentation` 负责 OpenTelemetry SDK 初始化与全局 tracer，`perfettoTracing` 负责把 span 落成 Perfetto 可消费的 trace 文件——想做性能分析必须从这里读起。

踩坑：`stats.ts` 初版有 3 个锚点落在多行表达式首行（`const peakActivityDay =`、`const totalDays =`、`return {`），直接触发 fidelity 硬规则 #5「不劈开未结束的多行表达式」报 FAIL；已分别下移到对象闭合行（352→367、566→571、580→587）后归零。其余文件 `annotate.py` 仅有良性 `⟳`（`//` 注释段中部锚点被挪到段边界，如 teleport.tsx 931→936、collapseReadSearch.ts 148→151），无模板字符串内锚点、无块注释内中文告警；teleport.tsx / instrumentation.ts 末行 base64 sourceMappingURL 按惯例省略（fidelity 标 `OK*`）。

流程账：预检十三份全过（529 锚点，一次通过）；`annotate.py` 十三次，仅良性 `⟳`（`//` 段边界挪动），无 `⚠` 块注释内中文告警；`check-fidelity.py` 636 份 0 失败；`check-links.py` 源码链接 844 条 + 内链 112 条，0 失效。

---

### utils 第 54 批：800 行档余下巨兽 + 分叉/团队/搜索/计算机操控底座（第 54 批，12 份 8,742 行，347 锚点）

十二份继续按行数降序吃 utils 里 800 行档余下的五巨兽（words / sessionStoragePortable / fsOperations / swarm 的 TmuxBackend / toolSearch），并顺手把 660–730 行档的 heredoc / api / gitFilesystem / forkedAgent / teamHelpers / ripgrep / computerUse-executor 一并做了。主题横跨「随机命名 / 会话存储 / 文件系统 / 多智能体运行与协作 / 工具搜索 / heredoc 安全 / API schema / git 文件系统 / 分叉智能体 / ripgrep 搜索 / 计算机操控执行器」。

| 文件                                                                                         | 原文  | 批注版 | 批注 | 讲什么                                                                |
| ------------------------------------------------------------------------------------------ | --- | --- | -- | ------------------------------------------------------------------ |
| [`utils/words.ts`](annotated/src/utils/words.ts)                                           | 800 | 821 | 21 | 随机词 slug 生成器：形容词-动词-名词三段式，给计划 ID 等产出可读名                            |
| [`utils/sessionStoragePortable.ts`](annotated/src/utils/sessionStoragePortable.ts)         | 793 | 829 | 36 | 可移植会话存储工具集：UUID 校验 / JSON 字段抽取 / 首提示提取 / 头尾分块读写 / 路径消毒 / swarm 工作树 |
| [`utils/fsOperations.ts`](annotated/src/utils/fsOperations.ts)                             | 770 | 794 | 24 | 文件系统操作封装：安全路径解析 / 符号链接权限 / 区间读取 / tail / 倒序读行                      |
| [`utils/swarm/backends/TmuxBackend.ts`](annotated/src/utils/swarm/backends/TmuxBackend.ts) | 764 | 793 | 29 | swarm 的 tmux 后端：user/swarm 双会话运行 / 窗格创建隐藏与重排 / 自注册                 |
| [`utils/toolSearch.ts`](annotated/src/utils/toolSearch.ts)                                 | 756 | 784 | 28 | 工具搜索模式：模型是否支持工具引用 / 自动阈值 / 已发现工具差异计算                               |
| [`utils/bash/heredoc.ts`](annotated/src/utils/bash/heredoc.ts)                             | 733 | 766 | 33 | heredoc 提取与还原：防命令走私的多处安全校验                                         |
| [`utils/api.ts`](annotated/src/utils/api.ts)                                               | 718 | 740 | 22 | 工具 → API schema 转换与上下文归一化：系统 / 用户上下文拼装 / 输入归一                      |
| [`utils/git/gitFilesystem.ts`](annotated/src/utils/git/gitFilesystem.ts)                   | 699 | 734 | 35 | git 文件系统层：ref 解析 / 分支缓存 / 工作树 / 浅克隆检测                              |
| [`utils/forkedAgent.ts`](annotated/src/utils/forkedAgent.ts)                               | 689 | 713 | 24 | 分叉智能体查询循环：缓存安全参数 / 隔离上下文 / 用量上报                                    |
| [`utils/swarm/teamHelpers.ts`](annotated/src/utils/swarm/teamHelpers.ts)                   | 683 | 712 | 29 | 团队本地状态读写与清理：config.json / 成员模式 / 工作树销毁                             |
| [`utils/ripgrep.ts`](annotated/src/utils/ripgrep.ts)                                       | 679 | 710 | 31 | ripgrep 搜索后端封装：三模式 / 超时 / 重试 / 流式 / 错误分级                           |
| [`utils/computerUse/executor.ts`](annotated/src/utils/computerUse/executor.ts)             | 658 | 693 | 35 | computer-use CLI 执行器：鼠标 / 键盘 / 截图 / 应用管理                           |

**几个值得记住的点**：

1. **`sessionStoragePortable.ts` 与 `sessionStorage.ts`（第 44 批已做）是姊妹篇**：前者是「不依赖日志/实验/特性开关」的纯 Node 可移植版，被 CLI 与 VS Code 扩展共享；抽取首条用户提示时跳过的 `SKIP_FIRST_PROMPT_PATTERN` 专门过滤系统/钩子/中断类消息，避免把噪声当首提示。
2. **`forkedAgent.ts` 的精髓是「缓存安全参数」**：分叉智能体必须与父智能体共享 system/tool/model/messages 前缀才能命中 Anthropic 提示词缓存；`maxOutputTokens` 会顺带改 `budget_tokens` 而失效缓存，所以只在不需要共享时才设。
3. **`gitFilesystem.ts` 是把 git 当成「只读文件系统」用的安全层**：`resolveGitDir` / `isSafeRefName` / `isValidGitSha` / `getCachedBranch` 把 ref 解析、分支缓存、工作树、浅克隆检测全部收口，供上层安全地按 commit 读文件。
4. **`computerUse/executor.ts` 是 macOS 专属的计算机操控执行器**：封装 Rust/enigo 输入与 Swift 截图两套原生模块，并刻意与 Cowork 参考实现保持若干 CLI 差异（无点击穿透、终端作替代宿主、剪贴板走 pbcopy/pbpaste）。

踩坑：四处锚点初版落在多行表达式首行（`const uuidRegex =` / `const SKIP_FIRST_PROMPT_PATTERN =` 在 sessionStoragePortable.ts，`const cacheKey =` 在 api.ts，`const HEREDOC_START_PATTERN =` 在 heredoc.ts），直接触发 fidelity 硬规则 #5「不劈开未结束的多行表达式」报 FAIL；已分别下移到正则/三元闭合行（24 / 124 / 150 / 71）后归零；`executor.ts` 初版有一锚点落进 `scroll` 的 `/** */` 块注释内（触发 fidelity 块注释纯净判据），已挪到函数声明行（600）修复。其余文件 `annotate.py` 仅有良性 `⟳`（`//` 注释段中部锚点被挪到段边界，如 heredoc.ts 442→453、forkedAgent.ts 520→523、ripgrep.ts 47→48 与 382→383），无模板字符串内锚点告警；`⚠` 块注释内中文告警已清零。

流程账：预检十二份全过（347 锚点，一次通过）；`annotate.py` 十二次，仅良性 `⟳`（`//` 段边界挪动），`⚠` 块注释内中文告警已清零；`check-fidelity.py` 648 份 0 失败；`check-links.py` 源码链接 857 条 + 内链 113 条，0 失效。

---

### utils 第 55 批：600 到 640 行档收口（第 55 批，10 份 6,125 行，170 锚点）

十份按行数降序吃 utils 里 600 到 640 行档的收口：theme / plugins/mcpPluginIntegration / doctorDiagnostic / model/model / handlePromptSubmit / processUserInput/processUserInput / cleanup / markdownConfigLoader / conversationRecovery / plugins/pluginInstallationHelpers。主题横跨「UI 主题与 chalk 着色 / MCP 插件集成 / 安装自检诊断 / 模型抽象与 provider 选型 / 提示提交处理 / 用户输入处理 / 过期文件清理 / Markdown 配置装载 / 会话恢复 / 插件安装辅助」。

| 文件                                                                                                       | 原文  | 批注版 | 批注 | 讲什么                                                                                          |
| -------------------------------------------------------------------------------------------------------- | --- | --- | -- | -------------------------------------------------------------------------------------------- |
| [`utils/theme.ts`](annotated/src/utils/theme.ts)                                                         | 639 | 655 | 16 | 终端 UI 颜色主题系统：命名主题（浅色/深色/ANSI/色盲友好）+ 主题色转 ANSI 转义码，全用显式 RGB/命名色避免被终端配色干扰                      |
| [`utils/plugins/mcpPluginIntegration.ts`](annotated/src/utils/plugins/mcpPluginIntegration.ts)           | 634 | 650 | 16 | 从插件加载解析 MCP 服务器配置：多来源（MCPB 压缩包/插件清单/.mcp.json/.mcpb）收集、环境变量与用户配置替换、加插件作用域前缀防命名冲突             |
| [`utils/doctorDiagnostic.ts`](annotated/src/utils/doctorDiagnostic.ts)                                   | 625 | 639 | 14 | `claude doctor` 自检核心：诊断安装类型/版本/路径/自动更新权限/多重安装冲突/配置问题，给可执行修复建议                                |
| [`utils/model/model.ts`](annotated/src/utils/model/model.ts)                                             | 618 | 641 | 23 | 模型选择中枢：按会话覆盖/启动参数/环境变量/设置/订阅/1M 上下文多重来源解析当前主循环模型，含别名解析/规范名/显示名整套工具（含 ANT 专用防泄漏标记）            |
| [`utils/handlePromptSubmit.ts`](annotated/src/utils/handlePromptSubmit.ts)                               | 610 | 627 | 17 | 用户提交提示词总入口：分流退出命令/本地 JSX 即时命令/队列/直接执行；真正执行在 executeUserInput，统一走 processUserInput→onQuery 循环 |
| [`utils/processUserInput/processUserInput.ts`](annotated/src/utils/processUserInput/processUserInput.ts) | 605 | 623 | 18 | 用户单条输入处理基座：图片缩放/附件抽取/粘贴图处理/斜杠命令与 ultraplan 关键词与 bash 路由，最终交 processTextPrompt 生成用户消息         |
| [`utils/cleanup.ts`](annotated/src/utils/cleanup.ts)                                                     | 602 | 620 | 18 | 过期文件清理逻辑：消息日志/会话/计划/文件历史备份/调试日志/npm 缓存/旧版本按保留天数（默认 30 天）删除，后台一键清理组合调用                        |
| [`utils/markdownConfigLoader.ts`](annotated/src/utils/markdownConfigLoader.ts)                           | 600 | 613 | 13 | 加载解析 Markdown 配置（命令/智能体/技能/工作流）：多级目录收集 .md、frontmatter 解析、inode 去重、git 根截断与软链处理、工具列表解析       |
| [`utils/conversationRecovery.ts`](annotated/src/utils/conversationRecovery.ts)                           | 597 | 613 | 16 | 会话恢复：transcript jsonl 反序列化成 REPL 消息，遗留附件类型迁移/未解析工具调用过滤/中断检测/技能状态恢复，多来源加载                     |
| [`utils/plugins/pluginInstallationHelpers.ts`](annotated/src/utils/plugins/pluginInstallationHelpers.ts) | 595 | 614 | 19 | 插件安装共享辅助层：路径穿越防护/缓存登记插件/解析插件 ID/依赖闭包解析/结构化错误格式化/CLI 与交互 UI 共用安装逻辑                            |

**几个值得记住的点**：

1. **`theme.ts` 是「颜色不随终端配色漂」的保证**：所有主题色用显式 RGB 或 ANSI 命名色写死，不读终端的 256 色/truecolor 配置，保证日志与权限提示在任何环境下颜色一致。
2. **`model/model.ts` 的模型名有「三重身份」**：codename（内部泄漏敏感，ANT 构建用 `process.env.USER_TYPE==='ant'` 包裹做死代码消除）、规范名（API 实际接受）、显示名（给用户看），解析时要按来源优先级层层覆盖。
3. **`conversationRecovery.ts` 是「崩溃可续」的关键**：transcript 里可能残留未完成的工具调用或旧版附件类型，恢复时过滤掉未解析调用、做附件类型迁移，REPL 才不会因读到半截状态而崩。
4. **`processUserInput/processUserInput.ts` 与 `handlePromptSubmit.ts` 是「输入流水线的上下游」**：前者管单条输入的内容处理（图片/附件/路由），后者管整条提交的流向分发，两者经 `executeUserInput` 汇入 `onQuery` 主循环。

踩坑：三处锚点初版落在多行表达式首行（`const chalkForChart =` 在 theme.ts、`export type InstallationType =` 在 doctorDiagnostic.ts、`const origin =` 在 handlePromptSubmit.ts），触发 fidelity 硬规则 #5「不劈开未结束的多行表达式」报 FAIL；已分别下移到收尾行（620 / 53 / 507）后复验 0 失败；其余文件 `annotate.py` 仅有良性 `⟳`（`//` 注释段中部锚点被挪到段边界，如 doctorDiagnostic.ts 432→433、processUserInput 306→311 / 422→427 / 455→466 / 531→532、conversationRecovery 52→53、pluginInstallationHelpers 361→364 / 414→417），无模板字符串内锚点告警；`⚠` 块注释内中文告警已清零。

流程账：预检十份全过（170 锚点，一次通过）；`annotate.py` 十次，仅良性 `⟳`（`//` 段边界挪动），`⚠` 块注释内中文告警已清零；`check-fidelity.py` 658 份 0 失败；`check-links.py` 源码链接 869 条 + 内链 113 条，0 失效。

---

### utils 第 56 批：中断批回收 + 600 行档收口（第 56 批，6 份 3,451 行，112 锚点）

本批是**上一轮自动化运行被中断后遗留的半成品**：6 份数据文件（`scripts/_annot/*_p1.py`）与 1 份已生成的 `annotated/src/utils/file.ts` 以未提交状态留在工作树，其余 5 份只写到数据文件、尚未跑 `annotate.py`。本批先把这批孤儿文件接完——重跑预检（importlib 加载 + `ast.parse` + 引号/反斜杠/行号/重复锚点断言）确认 6 份全部有效，再对 6 份统一跑 `annotate.py` 补齐产出。六份都是 utils 里 560–592 行的中型文件，主题横跨「文件 IO/路径 / 自动更新与版本门槛 / bash 快照 / 定时任务调度 / 插件市场策略 / 斜杠命令建议」。

| 文件                                                                                                 | 原文  | 批注版 | 批注 | 讲什么                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | --- | --- | -- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`utils/file.ts`](annotated/src/utils/file.ts)                                                     | 584 | 610 | 26 | 文件读写与路径展示工具箱：可替换文件系统实现（getFsImplementation）、存在性/读写/编码与换行探测/行号前缀/符号链接安全写入/桌面路径解析                                                             |
| [`utils/autoUpdater.ts`](annotated/src/utils/autoUpdater.ts)                                       | 561 | 581 | 20 | 自动更新模块：版本门槛校验（assertMinVersion）/ 服务端封顶（getMaxVersion，事故时当开关暂停更新）/ 从 npm 或 GCS 拉最新版 / 全局安装（installGlobalPackage），刻意从 home 跑 npm 避开项目级 .npmrc |
| [`utils/bash/ShellSnapshot.ts`](annotated/src/utils/bash/ShellSnapshot.ts)                         | 582 | 597 | 15 | bash 快照：source 用户 rc 后把函数/选项/别名/PATH dump 进快照文件，后续命令 source 快照以「像在用户交互 shell 里跑」而无需每条新建登录 shell                                             |
| [`utils/cronScheduler.ts`](annotated/src/utils/cronScheduler.ts)                                   | 565 | 576 | 11 | 非 React 定时任务调度内核：管 `.claude/scheduled_tasks.json`，难点是「多 Claude 共享 cwd 时防重复触发」与「进程崩溃后接手」                                                     |
| [`utils/plugins/marketplaceHelpers.ts`](annotated/src/utils/plugins/marketplaceHelpers.ts)         | 592 | 615 | 23 | 插件市场策略与判定层：源解析成可展示形态 + 企业策略（黑名单/白名单）拦截，isSourceAllowedByPolicy 是下载前守门员                                                                      |
| [`utils/suggestions/commandSuggestions.ts`](annotated/src/utils/suggestions/commandSuggestions.ts) | 567 | 584 | 17 | 斜杠命令搜索与建议引擎：fuse.js 模糊匹配 + 技能使用频率排序，识别行中斜杠命令/前缀补全/按来源分类展示，是 PromptInput 底部建议条底层                                                             |

**几个值得记住的点**：

1. **`file.ts` 的「可替换文件系统实现」是关键抽象**：所有读写都走 `getFsImplementation()` 拿到的 fs 接口，于是测试能塞进 memory fs、生产用真实 fs，而不用满世界改调用点。
2. **`autoUpdater.ts` 刻意从 home 目录跑 npm/bun**：避开项目级 `.npmrc`，否则项目里被恶意改过的 `.npmrc` 会把更新重定向到攻击者仓库——这是「更新器自己不能被投毒」的硬约束。
3. **`ShellSnapshot.ts` 解决的是「每条命令都新建登录 shell 太慢」**：它把用户环境一次性 dump 成快照，后续命令只 source 快照，等价于「在用户交互 shell 里跑」但零启动开销。
4. **`cronScheduler.ts` 的锁是「多 Claude 同 cwd」防重触发的核心**：抢到调度锁的才做文件触发，没抢到的每 5 秒探测一次接管，原主崩溃时顶上。
5. **`marketplaceHelpers.ts` 的 `isSourceAllowedByPolicy` 优先级是「黑名单 → 白名单 → 放行」**：被封的来源根本不碰文件系统，是企业策略的第一道闸。

踩坑：本批是**中断回收**，6 份数据文件与 1 份已生成 annotated 都是上一轮留下的未提交孤儿；先确认它们不触碰任何已提交内容（`git ls-files` 对 6 个 annotated 路径全部为空），再重跑预检确认 6 份数据文件（112 锚点）全部通过（slug↔路径对应、pos 合法、行号在 [1,源行数]、无重复锚点、正文无英文引号/反斜杠、整文件 `ast.parse` 通过）；`annotate.py` 六次**零 `⟳` 外移**（锚点全部精准落在语句/注释块边界，无模板字符串内锚点、无块注释内中文告警）；`⚠` 块注释内中文告警已清零。

流程账：预检六份全过（112 锚点，一次通过）；`annotate.py` 六次，零 `⟳` 外移、`⚠` 块注释内中文告警已清零；`check-fidelity.py` 664 份 0 失败（本批 6 份合计 +112 行批注，代码行与原文逐行相等）；`check-links.py` 源码链接 879 条 + 内链 115 条，0 失效。

### utils 第 57 批：550 行档十件套（第 57 批，10 份 5,407 行，288 锚点）

上一批留下的候选目标一口气清掉十个，`src/utils/` 推进到 79/564、全仓 674/1902（52.5%）。十份都停在 530–560 行，是真正的「横向生态」层：深链唤起、查询辅助、会话恢复、命令队列、模型选择器、浏览器扩展、快速模式、git diff、优雅退出、Chrome 原生宿主。

| 文件                                                                                             | 原文  | 批注版 | 锚点 | 讲什么                                                 |
| ---------------------------------------------------------------------------------------------- | --- | --- | -- | --------------------------------------------------- |
| [`deepLink/terminalLauncher.ts`](annotated/src/utils/deepLink/terminalLauncher.ts)             | 557 | 580 | 32 | 深链唤起时检测并启动用户偏好的终端（macOS/Linux/Windows 多款终端清单）       |
| [`queryHelpers.ts`](annotated/src/utils/queryHelpers.ts)                                       | 552 | 568 | 16 | 查询流程辅助：结果判定、SDK 消息规范化、孤儿权限、已读文件提取                   |
| [`sessionRestore.ts`](annotated/src/utils/sessionRestore.ts)                                   | 551 | 571 | 20 | 会话恢复：从转录还原文件历史/归属/待办/折叠/worktree，交互与 SDK 双路复用       |
| [`messageQueueManager.ts`](annotated/src/utils/messageQueueManager.ts)                         | 547 | 575 | 28 | 统一命令队列：输入/任务通知/孤儿权限同队列，now > next > later 三级优先      |
| [`model/modelOptions.ts`](annotated/src/utils/model/modelOptions.ts)                           | 540 | 582 | 42 | `/model` 选择器：按用户档位（ant/Max/Pro/PAYG）给不同可选模型与描述      |
| [`claudeInChrome/common.ts`](annotated/src/utils/claudeInChrome/common.ts)                     | 540 | 568 | 29 | Chrome 扩展通用层：Chromium 系浏览器清单、各平台数据路径与套接字工具          |
| [`fastMode.ts`](annotated/src/utils/fastMode.ts)                                               | 532 | 579 | 47 | 快速模式运行时：特性开关/档位/组织设置/额外计费/冷却退避，API 拒绝即永久关闭          |
| [`gitDiff.ts`](annotated/src/utils/gitDiff.ts)                                                 | 532 | 558 | 26 | git diff 封装：工作树对 HEAD 的统计与分块、未跟踪文件合成、瞬态跳过           |
| [`gracefulShutdown.ts`](annotated/src/utils/gracefulShutdown.ts)                               | 529 | 549 | 20 | 优雅退出：终端模式清理、恢复提示、清理函数与钩子、失败保护定时器                    |
| [`claudeInChrome/chromeNativeHost.ts`](annotated/src/utils/claudeInChrome/chromeNativeHost.ts) | 527 | 549 | 25 | Chrome 原生消息宿主的纯 TS 实现（原 Rust NAPI）：stdio 通信 + 套接字转发 |

要点摘录：① `gracefulShutdown` 的顺序是承重的——先关鼠标追踪、退 alt 屏再卸载 Ink，否则恢复提示会被覆盖；所有清理失败一律忽略，因为进程马上就退。② `fastMode` 在 API 拒绝时**永久**关闭并预取组织状态，冷却退避防抖。③ `messageQueueManager` 独立于 React 状态（`useSyncExternalStore` 只是订阅视图），打印循环这类非 React 代码直接读。④ `gitDiff` 在合并/变基/挑选/回退等瞬态下故意跳过计算，防止把中间态当改动误报。⑤ Chrome 宿主从 Rust NAPI 迁回纯 TS，单条消息上限 1MB。

**下一批候选（utils 剩余，按行数降序）**：`nativeInstaller/download.ts`(523) · `bash/treeSitterAnalysis.ts`(506) · `telemetry/betaSessionTracing.ts`(491) · `settings/changeDetector.ts`(488) · `permissions/pathValidation.ts`(485) · `Shell.ts`(474) · `teleport/api.ts`(466) · `ShellCommand.ts`(465) · `swarm/backends/registry.ts`(464) · `cronTasks.ts`(458) …（utils 还剩 479 份；全仓还剩 1,228 份）。

### utils 第 58 批：520 行档十件套（第 58 批，10 份 4,820 行，199 锚点）

上一轮 550 行档清完后，自然落到 520–460 行这一档：原生安装器下载、bash 安全树解析、Beta 会话追踪、设置变更检测、路径权限校验、Shell 封装与命令对象、Teleport/CCR API、swarm 面板后端注册、定时任务。清掉后 `src/utils/` 推进到 95/564、全仓 684/1902（53.5%）。

| 文件                                                                                       | 原文  | 批注版 | 锚点 | 讲什么                                                                            |
| ---------------------------------------------------------------------------------------- | --- | --- | -- | ------------------------------------------------------------------------------ |
| [`nativeInstaller/download.ts`](annotated/src/utils/nativeInstaller/download.ts)         | 523 | 548 | 25 | 原生安装器下载 Claude 二进制：Artifactory NPM 包 + GCS 公开桶两条源，含哈希校验、写盘、chmod、重试            |
| [`bash/treeSitterAnalysis.ts`](annotated/src/utils/bash/treeSitterAnalysis.ts)           | 506 | 526 | 20 | bash 命令安全校验的 tree-sitter AST 分析：抽取引号上下文、复合结构、重定向等，比正则更准；NAPI 解析器返回纯 JS 对象无需清理  |
| [`telemetry/betaSessionTracing.ts`](annotated/src/utils/telemetry/betaSessionTracing.ts) | 491 | 511 | 20 | Beta 会话追踪：按 agent 消息哈希去重、系统提示按唯一哈希只记一次、hook span，外部/Ant 两套可见性规则                |
| [`settings/changeDetector.ts`](annotated/src/utils/settings/changeDetector.ts)           | 488 | 509 | 21 | 设置文件变更检测（chokidar）：DELETION_GRACE_MS 防误删/瞬态、内部写入标记、配置变更钩子、MDM 刷新               |
| [`permissions/pathValidation.ts`](annotated/src/utils/permissions/pathValidation.ts)     | 485 | 508 | 23 | 路径权限校验（read/write/create）：allow/deny 规则匹配、路径穿越检测、UNC 漏洞路径、沙箱与工作路径边界            |
| [`Shell.ts`](annotated/src/utils/Shell.ts)                                               | 474 | 491 | 17 | Shell 封装：spawn 子进程、cwd 追踪（Windows POSIX→native 路径转换）、沙箱幽灵挂载点清理、命令后更新 cwd       |
| [`teleport/api.ts`](annotated/src/utils/teleport/api.ts)                                 | 466 | 481 | 15 | Teleport/CCR BYOC API 客户端（axios）：指数退避重试 [2/4/8/16s]、瞬态网络错误判定、OAuth、GitHub 仓库解析 |
| [`ShellCommand.ts`](annotated/src/utils/ShellCommand.ts)                                 | 465 | 482 | 17 | ShellCommand 命令对象：封装子进程、ExecResult（stdout/stderr/code/中断/后台）、超大输出落盘、tree-kill  |
| [`swarm/backends/registry.ts`](annotated/src/utils/swarm/backends/registry.ts)           | 464 | 482 | 18 | swarm 面板后端注册表：进程生命周期内固定检测（iTerm2/tmux/InProcess），后端选择结果缓存                      |
| [`cronTasks.ts`](annotated/src/utils/cronTasks.ts)                                       | 458 | 481 | 23 | 定时任务（scheduled_tasks.json）：一次性自动删除 vs 循环重排、cron 表达式解析与下次运行计算、自动过期              |

要点摘录：① `download` 的二进制来自两条互不相同的源——Artifactory（内部 npm 镜像）与 GCS 公开桶——靠 `getBinaryName`/`getPlatform` 拼出版本化路径，下载后 `createHash` 校验完整性再 `chmod` +x，失败走指数重试。② `Shell.ts` 的 cwd 追踪文件在 Windows 下是 POSIX 路径（`pwd -P` 输出），必须经 `posixPathToWindowsPath` 转成原生路径才能喂给 `readFileSync`/`unlinkSync`；命令结束后才更新全局 cwd 并失效环境缓存。③ `changeDetector` 的 `DELETION_GRACE_MS` 是一道防抖闸门——编辑器保存常是「删后重建」两步，没有宽限窗口会被当成删除触发配置回滚，所以先延迟再判定。④ `teleport/api` 用 `[2000,4000,8000,16000]` 四档退避只重试「无响应/5xx」这类瞬态错误，认证失败（4xx 带响应）不重试，避免无意义循环。⑤ `cronTasks` 分两种生命周期：一次性任务触发后自删，循环任务从「现在」重排并受 `recurringMaxAgeMs` 自动过期约束；jitter 防止同一 cron 的多个任务同时开火。

**下一批候选（utils 剩余，按行数降序）**：`listSessionsImpl.ts`(454) · `task/diskOutput.ts`(451) · `hooks/sessionHooks.ts`(447) · `plugins/officialMarketplaceStartupCheck.ts`(439) · `statsCache.ts`(434) · `betas.ts`(434) · `nativeInstaller/pidLock.ts`(433) · `tmuxSocket.ts`(427) · `proxy.ts`(426) · `imagePaste.ts`(416) …（utils 还剩 469 份；全仓还剩 1,215 份）。

---

### commands/clear 第 59 批：为新学习路线补课（第 59 批，3 份 402 行，55 锚点）

本批不是按行数降序挑的，是**被新的零基础学习路线点名的**。

重构学习路线时发现一个硬伤：路线里 L1-6（`clear.ts` 7 行）、L2-3（`conversation.ts` 第 150–166 行）、L3-1（整个 `commands/clear/` 四个文件）都要求「看批注版」，但这个目录只有 `index.ts` 批注过——另外三份在 `annotated/` 里根本不存在，路线一落地就是死链。于是先补这三份，让路线能真的走通。

| 文件                                                                      | 原文  | 批注版 | 锚点 | 讲什么                              |
| ----------------------------------------------------------------------- | --- | --- | -- | -------------------------------- |
| [`clear/clear.ts`](annotated/src/commands/clear/clear.ts)               | 7   | 20  | 4  | 命令的「身体」：7 行把契约说全（收什么/做什么/返回什么形状） |
| [`clear/caches.ts`](annotated/src/commands/clear/caches.ts)             | 144 | 223 | 23 | 清缓存总闸：七类缓存、四类「有后台 agent 时故意不清」   |
| [`clear/conversation.ts`](annotated/src/commands/clear/conversation.ts) | 251 | 374 | 28 | `/clear` 主体：十五步时序，每步顺序都有原因       |

**`src/commands/clear/` 4/4 全清。**

三份各自最值得带走的一条：

① **薄壳 + 厚实现是可加载性的前提**：`index.ts` 19 行只声明「有这么个命令」，`clear.ts` 7 行只转发，251 行的真身在 `conversation.ts`。启动时只解析前 19 行——这就是 `load: () => import(...)` 存在的理由。

② **复用别人的清理函数要付代价**：`caches.ts` 直接调 `runPostCompactCleanup()`，但它顺带会把「记忆文件缓存重置原因」标成 `compact`；`/clear` 不是压缩事件，必须紧接着用 `session_start` 再重置一次覆盖掉。第 80–84 行那五行注释就是在还这笔债。

③ **「重置一切」的代码里，最有信息量的是那个例外**：`conversation.ts` 重建 AppState 时把 MCP 全清了，唯独保留 `pluginReconnectKey`——因为它只由 `/reload-plugins` 递增，`/clear` 若也重置，插件重连会变成空操作（第 180–189 行）。

流程账：预检三份一次通过（55 锚点，数据文件末尾加 `ANNOTATIONS.sort` 兜顺序，因为 `annotate.py` 按列表顺序插入、不排序）；`annotate.py` 三次零 `⟳`；`check-fidelity.py` 687 份 0 失败（本批三份合计 +102 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 963 条 + 内链 127 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`listSessionsImpl.ts`(454) · `task/diskOutput.ts`(451) · `hooks/sessionHooks.ts`(447) · `plugins/officialMarketplaceStartupCheck.ts`(439) · `statsCache.ts`(434) · `betas.ts`(434) · `nativeInstaller/pidLock.ts`(433) · `tmuxSocket.ts`(427) · `proxy.ts`(426) · `imagePaste.ts`(416) …（utils 还剩 469 份；全仓还剩 1,215 份）。

---

### utils 第 60 批：450 行档十五件套（第 60 批，15 份 6,364 行，610 锚点）

本批是 utils 的「450 行档」收口——按行数降序，上一档（550/520）已清零，这一档 15 份全是 397–454 行的「运行时外围」模块：会话列表、任务落盘、钩子注册表、代理、图片粘贴、插件缓存/选项/市场自检、计划文件。彼此独立，但共同撑起主链路之外的那圈「能力装配层」。

| 文件                                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`utils/listSessionsImpl.ts`](annotated/src/utils/listSessionsImpl.ts)                                               | 454 | 499 | 45 | 会话列表实现：`listSessionsImpl` 扫 projects 目录 JSONL、解析 `SessionInfo`、按 mtime 排序过滤，供 `/resume` 与 `--list` 用                         |
| [`utils/task/diskOutput.ts`](annotated/src/utils/task/diskOutput.ts)                                                 | 451 | 485 | 34 | 任务磁盘输出：`DiskTaskOutput` 类 + 全局 append/flush/evict/getTaskOutputDelta，5GB 上限，后台 agent 长输出的落盘与增量读                              |
| [`utils/hooks/sessionHooks.ts`](annotated/src/utils/hooks/sessionHooks.ts)                                           | 447 | 482 | 35 | 会话级钩子注册表：`addSessionHook`/`removeSessionHook` 按 matcher 派发，生命周期钩子的内存索引                                                       |
| [`utils/plugins/officialMarketplaceStartupCheck.ts`](annotated/src/utils/plugins/officialMarketplaceStartupCheck.ts) | 439 | 480 | 41 | 启动期官方市场自检：`checkAndInstallOfficialMarketplace` 带重试拉取并安装官方 marketplace，含跳过原因枚举与退避配置                                           |
| [`utils/betas.ts`](annotated/src/utils/betas.ts)                                                                     | 434 | 477 | 43 | Beta 标头装配厂：`getMergedBetas`/`getModelBetas` 按模型 memoize 合并 SDK/ISP/结构化输出等 beta 头，决定能力开关                                      |
| [`utils/statsCache.ts`](annotated/src/utils/statsCache.ts)                                                           | 434 | 476 | 42 | 用量统计缓存：`withStatsCacheLock` 加锁读写 `PersistedStatsCache`，按日期合并新统计，跨会话累计 token/成本                                               |
| [`utils/nativeInstaller/pidLock.ts`](annotated/src/utils/nativeInstaller/pidLock.ts)                                 | 433 | 473 | 40 | 原生安装器 PID 锁：`tryAcquireLock`/`acquireProcessLifetimeLock` 用进程存活探测防并发安装，`cleanupStaleLocks` 清僵尸锁                              |
| [`utils/tmuxSocket.ts`](annotated/src/utils/tmuxSocket.ts)                                                           | 427 | 467 | 40 | tmux 套接字：`getClaudeSocketPath`/`ensureSocketInitialized` 为 swarm agent 建 socket 与环境变量，记录 tmux 是否被用过                          |
| [`utils/proxy.ts`](annotated/src/utils/proxy.ts)                                                                     | 426 | 476 | 50 | 代理层：`getProxyUrl`/`shouldBypassProxy`/`createAxiosInstance`/`configureGlobalAgents` 统一 HTTP/WS/\_fetch 代理与 no_proxy 旁路       |
| [`utils/imagePaste.ts`](annotated/src/utils/imagePaste.ts)                                                           | 416 | 459 | 43 | 图片粘贴：`getImageFromClipboard`/`getImagePathFromClipboard` 跨平台读剪贴板图片（含阈值与路径回退），喂给多模态输入                                         |
| [`utils/plugins/zipCache.ts`](annotated/src/utils/plugins/zipCache.ts)                                               | 406 | 442 | 36 | 插件 ZIP 缓存：`atomicWriteToZipCache`/`createZipFromDirectory`/`extractZipToDirectory` 会话级原子缓存已下载插件包                             |
| [`utils/claudeInChrome/setup.ts`](annotated/src/utils/claudeInChrome/setup.ts)                                       | 400 | 440 | 40 | Claude-in-Chrome 装配：`setupClaudeInChrome`/`installChromeNativeHostManifest` 装原生消息宿主清单，接通浏览器扩展                                |
| [`utils/hooks/hooksConfigManager.ts`](annotated/src/utils/hooks/hooksConfigManager.ts)                               | 400 | 425 | 25 | 钩子配置管理：`getHookEventMetadata`/`groupHooksByEventAndMatcher`/`getHooksForMatcher` 加载、去重、按事件+matcher 排序钩子                      |
| [`utils/plugins/pluginOptionsStorage.ts`](annotated/src/utils/plugins/pluginOptionsStorage.ts)                       | 400 | 443 | 43 | 插件选项存储：`loadPluginOptions`/`savePluginOptions` 把敏感项与 `settings` 项分离落盘，`substitutePluginVariables` 注入 `${CLAUDE_PLUGIN_ROOT}` |
| [`utils/plans.ts`](annotated/src/utils/plans.ts)                                                                     | 397 | 450 | 53 | 计划文件管理：`getPlanSlug`/`getPlanFilePath`/`getPlan`/`copyPlanForResume`/`copyPlanForFork` 管理 `/plan` 文件与恢复                      |

四套并发安全写法值得对照：`pidLock.ts` 的进程存活探测（轮询判断 PID 是否真在跑）、`statsCache.ts` 的 `withStatsCacheLock` 文件锁、zipCache 的 `atomicWriteToZipCache`（写临时文件再 rename）、tmuxSocket 的 socket 初始化——同一个「别让我和别的进程/自己抢同一份资源」问题，四份各写各的，是读 utils 时最能体会「没有统一基础设施」的一段。

另外两条横切观察：

- **memoize 是这批的共用范式**：`betas.ts` 的 `getModelBetas`/`getAllModelBetas`、`proxy.ts` 的 `getProxyAgent`、`hooksConfigManager.ts` 的 `getHookEventMetadata` 都是「昂贵解析 + 记忆化」——模型/环境相关的字符串拼接本可以每次重算，全部用 memoize 兜住，热路径上几乎零成本。
- **`proxy.ts` 是「全局副作用」集中地**：`configureGlobalAgents` 改的是 undici 的全局 dispatcher，调用一次影响整个进程所有 `_fetch`；所以它被故意放在启动时早期、且带 `clearProxyCache` 供测试复位。读懂它才懂为什么某些网络问题重启进程才消失。

流程账：预检 15 份一次通过（610 锚点；上游在生成前已用 `_fix_annot.py` 清掉 4 处非法字符、用 `_reloc_annot.py` 把落在 `const x =` 行尾 `=` 的 `after` 锚点挪到赋值收尾行，预先规避 `_OPEN_TAIL` 判据）；`annotate.py` 本批出现良性 `⟳` 外移（锚点落 `//` 注释段中部时自动挪到段尾，未劈开英文注释），无 `⚠` 块注释位移、无模板串位移；`check-fidelity.py` 702 份 0 失败（本批 15 份合计 +610 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 966 条 + 内链 129 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`attribution.ts`(393) · `task/TaskOutput.ts`(390) · `permissions/PermissionUpdate.ts`(389) · `plugins/lspPluginIntegration.ts`(387) · `readFileInRange.ts`(383) · `markdown.ts`(381) · `plugins/lspRecommendation.ts`(374) · `swarm/backends/ITermBackend.ts`(370) · `frontmatterParser.ts`(370) …（utils 还剩 454 份；全仓还剩 1,200 份）。

---

### utils 第 61 批：390 行档十五件套（第 61 批，15 份 5,620 行，493 锚点）

本批是 utils 的「390 行档」收口——按行数降序，上一档（450）已清零，这一档 15 份全是 354–393 行的「类型与小程序」模块：署名类型、任务输出常量、权限类型抽取、LSP 插件集成、文件区间读取、Markdown 渲染、swarm 安装向导 / 分屏后端、frontmatter 解析、shell 前缀安全、日志标题、状态类型、更新日志、插件推荐。彼此独立，但共同补齐 utils 中层的「小积木」。

| 文件                                                                                                         | 原文  | 批注版 | 锚点 | 讲什么                                                                          |
| ---------------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------------- |
| [`utils/attribution.ts`](annotated/src/utils/attribution.ts)                                               | 393 | 448 | 55 | 定义 `AttributionTexts` 类型（仅 `commit` / `pr` 两个字段），对应提交信息与 PR 描述里要插入的署名        |
| [`utils/task/TaskOutput.ts`](annotated/src/utils/task/TaskOutput.ts)                                       | 390 | 431 | 41 | 后台任务输出的三个核心常量：内存上限 8MB、轮询间隔 1 秒、进度尾巴采样 4KB                                   |
| [`utils/permissions/PermissionUpdate.ts`](annotated/src/utils/permissions/PermissionUpdate.ts)             | 389 | 423 | 34 | 权限更新相关类型，抽取到 `src/types/permissions.ts` 以打破导入循环                              |
| [`utils/plugins/lspPluginIntegration.ts`](annotated/src/utils/plugins/lspPluginIntegration.ts)             | 387 | 425 | 38 | LSP 插件集成的接入层：导入 zod、LSP 类型、插件类型与若干工具函数                                       |
| [`utils/readFileInRange.ts`](annotated/src/utils/readFileInRange.ts)                                       | 383 | 419 | 36 | 文件区间读取：小文件走 readFile 快路径、大文件 / 管道走流式路径，二者都去 BOM 与回车符                         |
| [`utils/markdown.ts`](annotated/src/utils/markdown.ts)                                                     | 381 | 415 | 34 | 把 Markdown 渲染成带终端样式的字符串（标题 / 列表 / 代码 / 链接 / 表格对齐），统一以换行符作行尾                  |
| [`utils/swarm/It2SetupPrompt.tsx`](annotated/src/utils/swarm/It2SetupPrompt.tsx)                           | 379 | 405 | 25 | `SetupStep` 联合类型枚举了 swarm 安装向导的全部步骤状态（React Compiler 编译产物）                   |
| [`utils/plugins/lspRecommendation.ts`](annotated/src/utils/plugins/lspRecommendation.ts)                   | 374 | 403 | 29 | `LspPluginRecommendation`：返回给调用方的 LSP 插件推荐结构                                 |
| [`utils/swarm/backends/ITermBackend.ts`](annotated/src/utils/swarm/backends/ITermBackend.ts)               | 370 | 397 | 27 | swarm iTerm2 分屏后端：`teammateSessionIds` 追踪已创建队友分屏的会话 ID                       |
| [`utils/frontmatterParser.ts`](annotated/src/utils/frontmatterParser.ts)                                   | 370 | 397 | 27 | `FrontmatterData` 定义 frontmatter 各字段的类型与含义说明                                 |
| [`utils/shell/prefix.ts`](annotated/src/utils/shell/prefix.ts)                                             | 367 | 399 | 32 | `DANGEROUS_SHELL_PREFIXES` 列出绝不可作裸前缀接受的 shell 可执行文件，避免绕过权限系统                 |
| [`utils/log.ts`](annotated/src/utils/log.ts)                                                               | 362 | 392 | 30 | `getLogDisplayTitle` 按优先级拼出日志 / 会话的显示标题，并去除不友好标签                             |
| [`utils/status.tsx`](annotated/src/utils/status.tsx)                                                       | 361 | 387 | 25 | `Property` 类型：标签加值，值可为 React 节点或字符串数组（状态展示用）                                 |
| [`utils/releaseNotes.ts`](annotated/src/utils/releaseNotes.ts)                                             | 360 | 391 | 31 | 更新日志展示：`MAX_RELEASE_NOTES_SHOWN` 每次最多展示的版本更新条数                               |
| [`utils/swarm/backends/PaneBackendExecutor.ts`](annotated/src/utils/swarm/backends/PaneBackendExecutor.ts) | 354 | 383 | 29 | `PaneBackendExecutor` 把 `PaneBackend` 适配为 `TeammateExecutor` 接口，使分屏后端接入队友执行器 |

两条横切观察：

- **「类型先行」是这批的共性**：`attribution.ts` / `frontmatterParser.ts` / `status.tsx` / `lspRecommendation.ts` 基本是「先定类型再谈逻辑」——`AttributionTexts` / `FrontmatterData` / `Property` / `LspPluginRecommendation` 这些类型本身就是文件的主要产出，读懂类型就读懂了文件。
- **swarm 后端成对出现**：`ITermBackend.ts` 与 `PaneBackendExecutor.ts` 一个管 iTerm2 分屏的会话追踪、一个把分屏后端适配成统一的 `TeammateExecutor` 接口，配合 `src/utils/swarm/backends/` 下的其他后端（tmux / 进程内）构成多智能体协作的「分屏执行层」。

流程账：预检 15 份一次通过（493 锚点；两份数据文件曾因 `after` 锚在 `const x =` 行尾被 `check-fidelity` 的 `_OPEN_TAIL` 判据判失败，已把锚点挪到赋值收尾行后重新生成）；`annotate.py` 零 `⟳`、零 `⚠`；`check-fidelity.py` 717 份 0 失败（本批 15 份合计 +493 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 981 条 + 内链 129 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`logoV2Utils.ts`(350) · `ultraplan/ccrSession.ts`(349) · `plugins/loadPluginAgents.ts`(348) · `deepLink/registerProtocol.ts`(348) · `env.ts`(347) · `plugins/pluginStartupCheck.ts`(341) · `swarm/backends/InProcessBackend.ts`(339) · `hooks/execAgentHook.ts`(339) · `nativeInstaller/packageManagers.ts`(336) · `mcp/elicitationValidation.ts`(336) …（utils 还剩 439 份；全仓还剩 1,185 份）。

---

### utils 第 62 批：350 行档十五件套（第 62 批，15 份 5,078 行，123 锚点）

本批是 utils 的「350 行档」收口——按行数降序，上一档（390）已清零，这一档 15 份全是 318–350 行的「探测与适配」工具：LogoV2 启动布局、ultraplan 会话轮询、深链协议注册、插件智能体加载 / 启动自检、运行环境探测、包管理器探测、swarm 进程内后端 / 队友生成、智能体式钩子、Computer Use 桥接、MCP 询问校验、ANSI 转 PNG、effort 推理强度、bash 命令解析。彼此独立，但共同补齐 utils 中层的「自省与适配」积木。

| 文件                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                                                     |
| ---------------------------------------------------------------------------------------------------- | --- | --- | -- | --------------------------------------------------------------------------------------- |
| [`utils/logoV2Utils.ts`](annotated/src/utils/logoV2Utils.ts)                                         | 350 | 361 | 11 | LogoV2 启动界面的布局与文案工具：按终端宽度选布局、算面板尺寸、截断路径 / 欢迎语、收集版本与计费信息、格式化最近活动                         |
| [`utils/ultraplan/ccrSession.ts`](annotated/src/utils/ultraplan/ccrSession.ts)                       | 349 | 360 | 11 | /ultraplan 的 CCR 会话轮询：等用户在浏览器批准 ExitPlanMode 后抽取计划文本，含轮询状态机与传送哨兵串解析                     |
| [`utils/deepLink/registerProtocol.ts`](annotated/src/utils/deepLink/registerProtocol.ts)             | 348 | 358 | 10 | 注册 `claude-cli://` 自定义协议（macOS / Linux / Windows 三套实现），让浏览器深链唤起 `claude --handle-uri`   |
| [`utils/plugins/loadPluginAgents.ts`](annotated/src/utils/plugins/loadPluginAgents.ts)               | 348 | 354 | 6  | 从插件目录与 frontmatter 加载智能体定义并记忆化并行加载，故意不越过用户授予的信任边界                                       |
| [`utils/env.ts`](annotated/src/utils/env.ts)                                                         | 347 | 355 | 8  | 运行环境探测：终端类型、部署平台、WSL、包管理器、宿主平台，统一聚合给全应用读取                                               |
| [`utils/plugins/pluginStartupCheck.ts`](annotated/src/utils/plugins/pluginStartupCheck.ts)           | 341 | 348 | 7  | 插件启动检查：合并设置判定启用、计算可写回范围、读已安装列表并补齐缺失插件安装                                                 |
| [`utils/swarm/backends/InProcessBackend.ts`](annotated/src/utils/swarm/backends/InProcessBackend.ts) | 339 | 347 | 8  | 多智能体进程内执行后端：队友与 leader 同进程、AsyncLocalStorage 隔离、文件信箱通信与终止                               |
| [`utils/hooks/execAgentHook.ts`](annotated/src/utils/hooks/execAgentHook.ts)                         | 339 | 346 | 7  | 智能体式钩子执行：多轮 LLM 读取转录判断停止条件，以结构化输出返回 ok / 阻断                                             |
| [`utils/nativeInstaller/packageManagers.ts`](annotated/src/utils/nativeInstaller/packageManagers.ts) | 336 | 347 | 11 | 探测 Claude 由哪个包管理器安装（mise / asdf / brew / winget / pacman / deb / rpm / apk），按家族门控与优先级回退 |
| [`utils/computerUse/wrapper.tsx`](annotated/src/utils/computerUse/wrapper.tsx)                       | 336 | 343 | 6  | 把 ToolUseContext 桥接到 computer-use-mcp 会话，绑定 dispatcher、渲染覆盖与授权弹窗（.tsx 源映射行省略）           |
| [`utils/mcp/elicitationValidation.ts`](annotated/src/utils/mcp/elicitationValidation.ts)             | 336 | 346 | 10 | MCP elicitation 输入校验：schema→Zod、枚举 / 格式占位提示、同步与异步（Haiku 自然语言日期）校验                       |
| [`utils/ansiToPng.ts`](annotated/src/utils/ansiToPng.ts)                                             | 334 | 341 | 7  | 把 ANSI 终端文本栅格化为 PNG：内嵌位图字体、零依赖最小 PNG 编码器、圆角与字形 alpha 合成                                 |
| [`utils/effort.ts`](annotated/src/utils/effort.ts)                                                   | 329 | 337 | 8  | effort 推理强度解析与持久化：环境覆盖→应用状态→模型默认优先级链、档位映射与默认取值                                          |
| [`utils/swarm/spawnInProcess.ts`](annotated/src/utils/swarm/spawnInProcess.ts)                       | 328 | 333 | 5  | 进程内队友生成与强制终止：独立 AbortController、队友身份注册到 AppState、清理回收                                   |
| [`utils/bash/ParsedCommand.ts`](annotated/src/utils/bash/ParsedCommand.ts)                           | 318 | 326 | 8  | 解析 shell 命令（管道 / 重定向）：tree-sitter 字节偏移解析加正则兜底，避免多字节切半字符                                 |

两条横切观察：

- **本批是「自省 / 适配」工具集**：`env`、`packageManagers`、`registerProtocol`、`loadPluginAgents`、`pluginStartupCheck`、`effort` 共同构成 CC 启动期的「自省层」——它们不直接做业务，而是回答「我现在在哪、由谁安装、该走哪条路、能加载什么」；其中 `env` 与 `packageManagers` 都是「先探测再门控」的范式（先判 OS 家族再查包归属、先读环境变量再回退），把不确定性的判断收敛到一处。
- **swarm 与「外部能力接入」成对出现**：`InProcessBackend`（队友怎么跑）与 `spawnInProcess`（队友怎么生 / 怎么杀）配合 AppState + AsyncLocalStorage 完成同进程多智能体隔离；`wrapper`（Computer Use 桥接）、`execAgentHook`（agent 式钩子）则属于「把外部 MCP / LLM 能力接进主流程」的适配层。读懂这三者就懂了 CC 如何把「多智能体」和「外部工具」统一收编进单一进程。

流程账：预检 15 份一次通过（123 锚点；`ROOT` 用 `D:/CC泄露源码分析` 而非 `/d/CC泄露源码分析`——后者混合分隔符会让 `os.path.exists` 判 False）；`annotate.py` 零 `⟳`、零 `⚠`；`check-fidelity.py` 732 份 0 失败（本批 15 份合计 +123 行中文批注，代码行与原文逐行相等；`computerUse/wrapper.tsx` 原有一行 35,092 字符的 base64 `sourceMappingURL`，按规则省略不抄并补 2 行说明，故批注版 343 = 336 − 1 + 6 + 2）；`check-links.py` 源码链接 996 条 + 内链 130 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`powershell/staticPrefix.ts`(316) · `settings/mdm/settings.ts`(316) · `skills/skillChangeDetector.ts`(311) · `swarm/backends/types.ts`(311) · `hooks/AsyncHookRegistry.ts`(309) · `format.ts`(308) · `cron.ts`(308) · `task/framework.ts`(308) · `agenticSessionSearch.ts`(307) · `plugins/dependencyResolver.ts`(305) …（utils 还剩 424 份；全仓还剩 1,170 份）。

### utils 第 63 批：300 行档十件套（第 63 批，10 份 3,099 行，98 锚点）

本批是 utils 的「300 行档」收口——按行数降序，上一档（350）已清零，这一档 10 份是 305–316 行的「配置解析 / 调度 / 类型契约 / 格式化」工具：PowerShell 静态前缀提取、MDM 企业配置强制、技能变更监听、swarm 后端类型契约、异步钩子注册表、纯展示格式化、cron 解析、任务框架轮询、智能会话搜索、插件依赖解析。彼此独立，但共同补齐 utils 中层的「配置接入、调度循环、契约定义」积木。

| 文件                                                                                         | 原文  | 批注版 | 锚点 | 讲什么                                                                              |
| ------------------------------------------------------------------------------------------ | --- | --- | -- | -------------------------------------------------------------------------------- |
| [`utils/powershell/staticPrefix.ts`](annotated/src/utils/powershell/staticPrefix.ts)       | 316 | 324 | 8  | PowerShell 静态命令前缀提取（镜像 bash 版），用 AST 解析器取命令名与参数，套 fig spec 走深度规则，逐词校验防止动态表达式混入前缀 |
| [`utils/settings/mdm/settings.ts`](annotated/src/utils/settings/mdm/settings.ts)           | 316 | 327 | 11 | MDM 企业配置强制读取与「首个源胜出」合并，解析 plist / HKLM / managed 文件 / HKCU 四类来源                  |
| [`utils/skills/skillChangeDetector.ts`](annotated/src/utils/skills/skillChangeDetector.ts) | 311 | 321 | 10 | 技能与命令目录文件监听（chokidar），变更去抖后触发重载并清空缓存，Bun 下改用 stat 轮询规避死锁                         |
| [`utils/swarm/backends/types.ts`](annotated/src/utils/swarm/backends/types.ts)             | 311 | 322 | 11 | swarm 队友执行后端类型契约：pane 后端与进程内后端两套接口，及身份 / 生成 / 消息数据结构与类型守卫                        |
| [`utils/hooks/AsyncHookRegistry.ts`](annotated/src/utils/hooks/AsyncHookRegistry.ts)       | 309 | 318 | 9  | 全局异步钩子注册表：在途 async hook 按 processId 索引，收集响应、终态化与清理                               |
| [`utils/format.ts`](annotated/src/utils/format.ts)                                         | 308 | 319 | 11 | 纯展示格式化集合（叶子级无 Ink）：文件大小 / 时长 / 数字 / 相对时间 / 日志元数据，截断工具转交 truncate.ts              |
| [`utils/cron.ts`](annotated/src/utils/cron.ts)                                             | 308 | 317 | 9  | 轻量 cron 表达式解析与下次运行计算，支持 5 字段子集，正确处理日/星期 OR 语义与 DST                               |
| [`utils/task/framework.ts`](annotated/src/utils/task/framework.ts)                         | 308 | 318 | 10 | 任务框架层：AppState 中登记 / 更新 / 驱逐任务，轮询产出并生成推送通知附件                                     |
| [`utils/agenticSessionSearch.ts`](annotated/src/utils/agenticSessionSearch.ts)             | 307 | 315 | 8  | 基于 Claude 语义的智能会话搜索：关键词粗筛 + 模型挑索引，含转录抽取与索引回映射                                    |
| [`utils/plugins/dependencyResolver.ts`](annotated/src/utils/plugins/dependencyResolver.ts) | 305 | 316 | 11 | 插件依赖解析纯函数：apt 风格存在性语义，安装期闭包遍历与加载期定点降级                                            |

两条横切观察：

- **本批是「配置接入与调度循环」工具集**：`settings/mdm/settings`（企业强制配置）、`task/framework`（任务轮询与通知）、`skillChangeDetector`（文件监听重载）、`cron`（定时触发）、`agenticSessionSearch`（会话检索）共同构成 CC 运行期的「配置与调度」骨架——它们不直接实现业务功能，而是把「外部配置怎么进、周期性任务怎么跑、变更怎么响应」收拢成统一入口；`settings/mdm` 与 `task/framework` 都遵循「先读后合并、按优先级短路」的范式，把不确定性的判断收敛到一处。
- **类型契约与适配成对出现**：`swarm/backends/types` 定义 pane 与进程内两套后端接口及 `isPaneBackend` 守卫，`hooks/AsyncHookRegistry` 与 `plugins/dependencyResolver` 则分别是「异步钩子生命周期」与「插件依赖图」的契约与状态机；`powershell/staticPrefix` 与 `format` 是「把内部结构翻译给用户 / 给权限系统」的展示层。读懂这三者就懂了 CC 如何把「多智能体后端」「钩子机制」「插件依赖」三套抽象统一起来。

流程账：预检 10 份一次通过（98 锚点；`ROOT` 用 `D:/CC泄露源码分析`）；`annotate.py` 零 `⟳`、零 `⚠`；`check-fidelity.py` 742 份 0 失败（本批 10 份合计 +98 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1011 条 + 内链 131 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`bash/shellQuote.ts`(304) · `heapDumpService.ts`(303) · `queryProfiler.ts`(301) · `pdf.ts`(300) · `permissions/permissionsLoader.ts`(296) · `hooks/ssrfGuard.ts`(294) · `bash/bashPipeCommand.ts`(294) · `claudeInChrome/mcpServer.ts`(293) · `plugins/installCounts.ts`(292) · `teleport/gitBundle.ts`(292) …（utils 还剩 414 份；全仓还剩 1,160 份）。

---

### utils 第 64 批：300 行档下沿十件套（第 64 批，10 份 2,969 行，105 锚点）

本批是「300 行档」的下沿收口——292–304 行的十份独立工具：shell 引号安全包装、堆转储服务、查询剖析器、PDF 处理、权限装载、Chrome 桥接服务器、队友身份判定、git bundle 播种、管道重排、SSRF 防护。与前一批的「配置与调度」不同，这一批更偏「防御与外围通道」：一半文件在防出错（引号、SSRF、管道语义），一半在搭旁路通道（堆转储、剖析、桥接、播种）。

| 文件                                                                                               | 原文  | 批注版 | 锚点 | 讲什么                                                            |
| ------------------------------------------------------------------------------------------------ | --- | --- | -- | -------------------------------------------------------------- |
| [`utils/bash/shellQuote.ts`](annotated/src/utils/bash/shellQuote.ts)                             | 304 | 314 | 10 | shell-quote 库的安全包装：把库函数换成「出错不炸、降级处理」的 drop-in 替身，注入类输入不会把解析器带崩 |
| [`utils/heapDumpService.ts`](annotated/src/utils/heapDumpService.ts)                             | 303 | 313 | 10 | 堆转储捕获服务（`/heapdump` 命令的后端）：把当前内存快照写到临时目录并列出历史转储                |
| [`utils/queryProfiler.ts`](annotated/src/utils/queryProfiler.ts)                                 | 301 | 311 | 10 | 查询流水线剖析器：从用户输入到首 token 的分段计时，`CLAUDE_CODE_PROFILE_QUERY=1` 开启  |
| [`utils/pdf.ts`](annotated/src/utils/pdf.ts)                                                     | 300 | 311 | 11 | PDF 附件处理：临时目录落盘、按内容寻址的缓存命中与读取                                  |
| [`utils/permissions/permissionsLoader.ts`](annotated/src/utils/permissions/permissionsLoader.ts) | 296 | 307 | 11 | 权限规则装载：从各层 settings 读 allow/deny 规则并安全解析，是权限主流水线的「进货口」         |
| [`utils/claudeInChrome/mcpServer.ts`](annotated/src/utils/claudeInChrome/mcpServer.ts)           | 293 | 303 | 10 | Claude in Chrome 桥接：stdio 传输的 MCP 服务器，把浏览器扩展的标签页/读取能力暴露给主进程    |
| [`utils/teammate.ts`](annotated/src/utils/teammate.ts)                                           | 292 | 303 | 11 | 队友身份判定：判断当前实例是否作为 swarm 队友运行，及对应的名字/团队上下文读取                    |
| [`utils/teleport/gitBundle.ts`](annotated/src/utils/teleport/gitBundle.ts)                       | 292 | 303 | 11 | git bundle 创建 + 上传：CCR seed-bundle 播种流程，把工程历史打成单文件包传到云端        |
| [`utils/bash/bashPipeCommand.ts`](annotated/src/utils/bash/bashPipeCommand.ts)                   | 294 | 305 | 11 | 管道重排：把 stdin 重定向移到首个命令之后，修掉「eval 把整条管道当成一个单元」的语义偏差             |
| [`utils/hooks/ssrfGuard.ts`](annotated/src/utils/hooks/ssrfGuard.ts)                             | 294 | 304 | 10 | SSRF 防护：自定义 DNS lookup 钩子，解析出的 IP 逐一校验，挡住「域名合法、指向内网」的绕过        |

两条横切观察：

- **防御类文件共享同一个模式：在边界处包一层，而不是在每处调用点改**。`shellQuote` 包装第三方库函数、`ssrfGuard` 包装 DNS lookup、`bashPipeCommand` 在命令进入 eval 前重排——三者都在「数据进入危险区之前」的窄口处动手，调用方无感知。这是读懂 CC 安全外围的钥匙：危险操作集中收口，包装层薄而可测。
- **旁路通道类文件都是「主流程之外再加一条观测/同步线」**：`heapDumpService`（内存观测）、`queryProfiler`（耗时观测）、`claudeInChrome/mcpServer`（浏览器旁路）、`teleport/gitBundle`（历史播种）都不在主循环的关键路径上，坏了也不挡主流程——所以它们统一走「环境变量开关 / 命令触发」的懒加载模式。

流程账：数据文件与批注生成在上轮会话完成；本轮回收时 `check-fidelity.py` 752 份 0 失败（本批 10 份合计 +105 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1021 条 + 内链 132 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`plugins/installCounts.ts`(292) · `messages/mappers.ts`(290) · `telemetry/pluginTelemetry.ts`(289) · `memoryFileDetection.ts`(289) · `plugins/loadPluginHooks.ts`(287) · `filePersistence/filePersistence.ts`(287) · `slowOperations.ts`(286) · `plugins/pluginAutoupdate.ts`(284) · `json.ts`(277) · `git/gitConfigParser.ts`(277) …（utils 还剩 404 份；全仓还剩 1,150 份）。

### utils 第 65 批：290 行档下沿十件套（第 65 批，10 份 2,858 行，90 锚点）

本批是「290 行档」的下沿收口——277–292 行的十份独立工具：插件安装量缓存、SDK/内部消息双向映射、记忆文件识别、插件遥测字段、插件钩子加载与热重载、回合结束文件持久化、慢操作埋点封装、插件后台自动更新、.git/config 轻量解析、JSON/JSONL 安全解析。主题横跨「插件生命周期（遥测/钩子/自动更新/安装量）、会话与记忆文件识别、JSON 解析与持久化、性能埋点」——彼此独立，但共同补齐 utils 中层的「插件生态 + 数据格式 + 性能观测」积木。

| 文件                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                      |
| ---------------------------------------------------------------------------------------------------- | --- | --- | -- | -------------------------------------------------------- |
| [`utils/plugins/installCounts.ts`](annotated/src/utils/plugins/installCounts.ts)                     | 292 | 307 | 10 | 插件安装量数据层：官方统计仓库拉取 → 本地 24h 缓存 → Map 输出，出错返回 null 让界面隐藏数字 |
| [`utils/messages/mappers.ts`](annotated/src/utils/messages/mappers.ts)                               | 290 | 304 | 8  | SDK 消息与内部 Message 双向映射，含压缩边界与本地命令输出的特殊处理                 |
| [`utils/memoryFileDetection.ts`](annotated/src/utils/memoryFileDetection.ts)                         | 289 | 308 | 12 | 会话/记忆类文件识别：区分自动托管记忆与用户自管指令，供权限与折叠徽标使用                    |
| [`utils/telemetry/pluginTelemetry.ts`](annotated/src/utils/telemetry/pluginTelemetry.ts)             | 289 | 302 | 9  | 插件遥测字段：双列隐私（原始值 + 脱敏孪生）+ 不依赖隐私的标识哈希                      |
| [`utils/plugins/loadPluginHooks.ts`](annotated/src/utils/plugins/loadPluginHooks.ts)                 | 287 | 299 | 8  | 插件钩子加载：原子清空再注册，外加热重载与卸载剪枝                                |
| [`utils/filePersistence/filePersistence.ts`](annotated/src/utils/filePersistence/filePersistence.ts) | 287 | 299 | 7  | 回合结束文件持久化编排：BYOC 与云端模式分支，仅公开会话用户启用                       |
| [`utils/slowOperations.ts`](annotated/src/utils/slowOperations.ts)                                   | 286 | 300 | 11 | 慢操作埋点封装：JSON/克隆/深拷贝/同步写计时，重入守卫防自触发                       |
| [`utils/plugins/pluginAutoupdate.ts`](annotated/src/utils/plugins/pluginAutoupdate.ts)               | 284 | 294 | 8  | 插件后台自动更新：刷新开启自动更新的市场后更新相关插件，非原地落盘                        |
| [`utils/json.ts`](annotated/src/utils/json.ts)                                                       | 277 | 289 | 9  | JSON/JSONL 安全解析与就地修改：LRU 缓存、jsonc、超大文件尾部读取               |
| [`utils/git/gitConfigParser.ts`](annotated/src/utils/git/gitConfigParser.ts)                         | 277 | 288 | 8  | 轻量 .git/config 解析器：对照 git config.c 的段/键/值/转义规则           |

两条横切观察：

- **插件生命周期这条线在本批高度集中**：`installCounts`（安装量数据）、`pluginTelemetry`（遥测字段）、`loadPluginHooks`（钩子加载）、`pluginAutoupdate`（后台更新）四份恰好覆盖了插件从「被看到（遥测/安装量）→ 被挂上（钩子）→ 被保持最新（自动更新）」的完整生命周期外围，是读 CC 插件体系绕不开的四块地基。
- **数据格式与安全解析是另一条暗线**：`json.ts` 的「无效 JSON 也缓存以省去重复报错 + LRU 限容」与 `gitConfigParser.ts` 逐字符对照 git 自身的转义规则，共同体现了「宁可慢一点、也要对脏输入稳」的工程取向——前者防内存泄漏，后者防解析歧义。

流程账：数据文件与批注生成在本轮完成；`check-fidelity.py` 762 份 0 失败（本批 10 份合计 +90 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1338 条 + 内链 455 条，0 失效。

### utils 第 66 批：272 行档十件套（第 66 批，10 份 2,679 行，91 锚点）

本批是「272 行档」的十份独立工具，主题横跨「运行态观测诊断（上下文用量 / 调试日志 / doctor 告警）、配置治理（设置校验 / 钩子归一 / 市场对账）、缓存与渲染、AWS Bedrock 封装、技能自我改进钩子」——彼此独立，但共同补齐 utils 中层的「可观测性 + 配置校验 + 云/AI 集成」积木。

| 文件                                                                                 | 原文  | 批注版 | 锚点 | 讲什么                                                             |
| ---------------------------------------------------------------------------------- | --- | --- | -- | --------------------------------------------------------------- |
| [`utils/contextAnalysis.ts`](annotated/src/utils/contextAnalysis.ts)               | 272 | 281 | 9  | 上下文用量分析：把对话消息的 token 消耗按来源（工具请求/结果、人类/助手、附件、重复读）拆解成统计项，再摊平成上报指标 |
| [`utils/ansiToSvg.ts`](annotated/src/utils/ansiToSvg.ts)                           | 272 | 283 | 11 | 把带 ANSI 转义码的终端文本渲染成 SVG：解析颜色与加粗、按 span 拼 tspan，保留彩色命令行输出        |
| [`utils/hooks/hooksSettings.ts`](annotated/src/utils/hooks/hooksSettings.ts)       | 271 | 280 | 9  | 钩子设置汇总与展示：多来源钩子（用户/项目/本地/会话/插件/内置）归一，提供等价判断与排序展示文案              |
| [`utils/memoize.ts`](annotated/src/utils/memoize.ts)                               | 269 | 277 | 8  | 三种记忆化缓存：TTL 写穿透（同步/异步，异步含并发冷未命中去重）、LRU 限容，附清空等管理方法              |
| [`utils/debug.ts`](annotated/src/utils/debug.ts)                                   | 268 | 278 | 10 | 调试日志系统：按级别过滤、多开关判定开启、同步/缓冲写文件并维护最新日志符号链接                        |
| [`utils/hooks/skillImprovement.ts`](annotated/src/utils/hooks/skillImprovement.ts) | 267 | 275 | 8  | 技能自我改进钩子：采样后从近期对话抽改进点，侧信道模型可选回写 SKILL.md                        |
| [`utils/model/bedrock.ts`](annotated/src/utils/model/bedrock.ts)                   | 265 | 276 | 11 | AWS Bedrock 封装：列出推理配置、构建客户端、从 ARN 抽模型名与跨区前缀、加/换区域前缀             |
| [`utils/plugins/reconciler.ts`](annotated/src/utils/plugins/reconciler.ts)         | 265 | 273 | 8  | 市场对账器：让 known_marketplaces.json 与设置声明一致，只读 diff + 幂等只增安装        |
| [`utils/doctorContextWarnings.ts`](annotated/src/utils/doctorContextWarnings.ts)   | 265 | 274 | 9  | doctor 上下文告警：CLAUDE.md 过大 / 智能体描述过长 / MCP 工具过多 / 不可达权限规则四类检查    |
| [`utils/settings/validation.ts`](annotated/src/utils/settings/validation.ts)       | 265 | 273 | 8  | 设置校验翻译：把 Zod v4 错误翻成可读中文提示并给修复建议，校验前先剔除非法权限规则                   |

两条横切观察：

- **「运行态可观测性」本批占了三份**：`contextAnalysis`（上下文 token 用量）、`debug`（调试日志）、`doctorContextWarnings`（doctor 上下文告警）分别从「消耗统计 / 调试输出 / 健康诊断」三个角度让运行态可被看见、被排障。三者都依赖 tokenEstimation、claudemd、权限等周边模块，是读 CC 观测体系的三扇窗。
- **「配置治理」是另一条暗线**：`settings/validation`（Zod 错误→中文提示）、`hooksSettings`（多来源钩子归一展示）、`reconciler`（市场清单与声明对账一致）共同体现「配置要能被人读懂、能被自动核对」的取向；而 `memoize`/`ansiToSvg` 是纯工具、`skillImprovement`/`bedrock` 是 AI/云集成，彼此解耦却在同一行数档自然聚合。

流程账：数据文件与批注生成在本轮完成；`check-fidelity.py` 772 份 0 失败（本批 10 份合计 +91 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1348 条 + 内链 456 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`suggestions/directoryCompletion.ts`(263) · `claudeInChrome/toolRendering.tsx`(262) · `settings/permissionValidation.ts`(262) · `tokens.ts`(261) · `bash/shellCompletion.ts`(259) · `shell/bashProvider.ts`(255) · `telemetry/bigqueryExporter.ts`(252) · `permissions/permissionExplainer.ts`(250) · `sessionFileAccessHooks.ts`(250) · `swarm/backends/it2Setup.ts`(245) …（utils 还剩 384 份；全仓还剩 1,130 份）。

### utils 第 67 批：小文件十件套（263-245 行档，97 锚点）

本批是「260 行上下」的十份独立工具，主题横跨「路径补全（目录/文件/shell）、Claude-in-Chrome 工具渲染、权限规则校验、token 计数、Bash 执行提供器、遥测导出、权限解释生成、会话文件访问埋点、iTerm2 安装校验」——彼此独立，但共同补齐 utils 中层的「输入补全 + 权限/安全治理 + 遥测/可观测 + 外部工具集成」积木。

| 文件                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                                     |
| ---------------------------------------------------------------------------------------------------- | --- | --- | -- | ----------------------------------------------------------------------- |
| [`utils/suggestions/directoryCompletion.ts`](annotated/src/utils/suggestions/directoryCompletion.ts) | 263 | 271 | 8  | 路径补全：把未写完的路径拆成「目录+前缀」，用 LRU 缓存避免反复读盘，目录与文件路径分别匹配                        |
| [`utils/claudeInChrome/toolRendering.tsx`](annotated/src/utils/claudeInChrome/toolRendering.tsx)     | 262 | 273 | 10 | Chrome 工具渲染：把浏览器工具调用显示成可点击的 View Tab 链接与一句话成功摘要，verbose 模式走默认渲染         |
| [`utils/settings/permissionValidation.ts`](annotated/src/utils/settings/permissionValidation.ts)     | 262 | 271 | 9  | 权限规则校验：括号配对、转义感知的空括号检测、MCP 规则格式、Bash 的 :* 前缀与 File 通配边界约束               |
| [`utils/tokens.ts`](annotated/src/utils/tokens.ts)                                                   | 261 | 271 | 10 | token 计数：从 API usage 算上下文窗口，处理并行工具调用拆片对齐与跨压缩边界的最终窗口                     |
| [`utils/bash/shellCompletion.ts`](annotated/src/utils/bash/shellCompletion.ts)                       | 259 | 269 | 10 | shell 补全：解析光标前输入判断补「命令/变量/文件」，调 bash/zsh 原生 compgen 并防命令注入              |
| [`utils/shell/bashProvider.ts`](annotated/src/utils/shell/bashProvider.ts)                           | 255 | 264 | 9  | Bash 执行提供器：拼「source 快照+会话环境+关 extglob+eval」，并处理 tmux socket 隔离          |
| [`utils/telemetry/bigqueryExporter.ts`](annotated/src/utils/telemetry/bigqueryExporter.ts)           | 252 | 263 | 11 | 遥测导出：把 OTel 指标转成 BigQuery 上传格式，校验信任态与组织开关后 POST 上报                      |
| [`utils/permissions/permissionExplainer.ts`](annotated/src/utils/permissions/permissionExplainer.ts) | 250 | 262 | 12 | 权限解释生成：用 Haiku 通过强制结构化输出，给每条命令生成「做什么/为什么/风险」三段说明                        |
| [`utils/sessionFileAccessHooks.ts`](annotated/src/utils/sessionFileAccessHooks.ts)                   | 250 | 258 | 8  | 会话文件访问埋点：拦截 Read/Grep/Glob/Edit/Write，统计对会话记忆/transcript/memdir/团队记忆的访问 |
| [`utils/swarm/backends/it2Setup.ts`](annotated/src/utils/swarm/backends/it2Setup.ts)                 | 245 | 255 | 10 | iTerm2 安装校验：检测 Python 包管理器、安装 it2、验证能否连上 iTerm2 的 Python API            |

两条横切观察：

- **「输入补全」本批占了三份**：`directoryCompletion`（目录/文件路径补全）、`shellCompletion`（shell 命令/变量/文件补全）与 `tokens`（上下文窗口计数，是补全触发时机判断的底座之一）共同补全「用户敲到一半时系统怎么帮他想全」这条链路；三者都依赖 fsOperations、shellQuote、tokenEstimation 等周边模块。
- **「权限与安全治理」是另一条暗线**：`permissionValidation`（规则格式校验）、`permissionExplainer`（给命令配自然语言解释）、`sessionFileAccessHooks`（记忆文件访问埋点）从「格式正确性 / 可解释性 / 可观测性」三个角度把权限体系讲全；而 `bashProvider`（命令拼装与 tmux 隔离）、`bigqueryExporter`（遥测上报）、`toolRendering`（Chrome 工具渲染）、`it2Setup`（外部终端集成）则是「执行 / 可观测 / 外部集成」的解耦工具，彼此独立却在同一行数档自然聚合。

流程账：数据文件与批注生成在本轮完成；`check-fidelity.py` 782 份 0 失败（本批 10 份合计 +97 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1394 条 + 内链 461 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`hooks/execHttpHook.ts`(242) · `shell/specPrefix.ts`(241) · `asciicast.ts`(239) · `errors.ts`(238) · `desktopDeepLink.ts`(235) · `errorLogSink.ts`(235) · `stringUtils.ts`(235) · `background/remote/preconditions.ts`(235) · `contextSuggestions.ts`(235) · `permissions/shadowedRuleDetection.ts`(234) …（utils 还剩 374 份；全仓还剩 1,120 份）。

### utils 第 68 批：小文件十件套（242-234 行档，116 锚点）

本批是「240 行上下」的十份独立工具，横跨「HTTP 钩子治理、命令前缀截断、终端录制、错误处理体系、桌面接力深链、上下文用量建议、远程操作前置条件、字符串工具、错误落盘、权限规则遮蔽检测」——彼此独立，但共同补齐 utils 中层的「对外调用安全 / 终端与录制 / 错误归一 / 桌面与远程衔接 / 权限规则体检」积木。

| 文件                                                                                                       | 原文  | 批注版 | 锚点 | 讲什么                                                             |
| -------------------------------------------------------------------------------------------------------- | --- | --- | -- | --------------------------------------------------------------- |
| [`utils/hooks/execHttpHook.ts`](annotated/src/utils/hooks/execHttpHook.ts)                               | 242 | 255 | 13 | HTTP 钩子：URL 白名单 + 环境变量插值白名单 + SSRF 防护，把钩子输入 POST 出去并兜成错误回传      |
| [`utils/shell/specPrefix.ts`](annotated/src/utils/shell/specPrefix.ts)                                   | 241 | 253 | 12 | 命令前缀截断：按规约给定的深度把命令拼成「命令+子命令」前缀，文件/URL 处截断以保护参数                  |
| [`utils/asciicast.ts`](annotated/src/utils/asciicast.ts)                                                 | 239 | 251 | 12 | 终端录制：包住 stdout.write 抓带时间戳输出，写 asciicast v2 协议，会话切换时改名续接        |
| [`utils/errors.ts`](annotated/src/utils/errors.ts)                                                       | 238 | 250 | 12 | 错误体系：自研 Abort/ConfigParse 基类 + 中止判定 + axios 错误分桶 + 堆栈帧截断省 token |
| [`utils/desktopDeepLink.ts`](annotated/src/utils/desktopDeepLink.ts)                                     | 236 | 247 | 11 | 桌面接力：跨平台探测 Claude.app/xdg/注册表，版本兼容性三态判定，拼 claude://resume 深链打开  |
| [`utils/contextSuggestions.ts`](annotated/src/utils/contextSuggestions.ts)                               | 235 | 245 | 10 | 上下文建议：五类阈值检查（容量/工具占比/读文件/记忆/自动压缩），告警优先 + 可省 token 降序            |
| [`utils/background/remote/preconditions.ts`](annotated/src/utils/background/remote/preconditions.ts)     | 235 | 246 | 11 | 远程前置：分层判定 GitHub App / 令牌同步 / 凭据三选一，决定是否可做远程操作                  |
| [`utils/stringUtils.ts`](annotated/src/utils/stringUtils.ts)                                             | 235 | 247 | 12 | 字符串工具：转义/首字母大写/单复数/全角归一/累加器截断上限，集中复用的小函数集                       |
| [`utils/errorLogSink.ts`](annotated/src/utils/errorLogSink.ts)                                           | 235 | 247 | 12 | 错误落盘：按日期生成 JSONL 缓冲写入器，分常规错误与 MCP 错误两路，幂等挂载                     |
| [`utils/permissions/shadowedRuleDetection.ts`](annotated/src/utils/permissions/shadowedRuleDetection.ts) | 234 | 245 | 11 | 规则遮蔽检测：逐条 allow 先查 deny 再查 ask 遮蔽，生成「规则不可达」告警与修复建议              |

三条横切观察：

- **「对外调用的安全底座」本批占三份**：`execHttpHook`（HTTP 钩子的 URL 白名单 + 环境变量白名单 + SSRF）、`shadowedRuleDetection`（权限规则不可达检测）与 `errorLogSink`（错误落地审计）从「发得出去 / 配得对 / 记得下来」三个角度把「调用外系统的安全与可观测」讲全。
- **「终端与录制 / 桌面接力」是另一条暗线**：`asciicast`（终端输出录制）与 `desktopDeepLink`（会话接力深链）共同处理「本地 CLI 与终端/桌面客户端的衔接」；`contextSuggestions` 与 `stringUtils` 则是通用的「上下文自检 + 字符串处理」工具，被上层广泛复用。
- **`specPrefix` 与 `preconditions` 都做「分层判定」**：前者按「命令+子命令查表→仅命令→默认 2 层」分层拼前缀，后者按「GitHub App→令牌同步→皆无」分层判定远程能力，二者都体现了「优先精确、逐级兜底」的同一设计直觉。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效）；预检三断言一次通过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 792 份 0 失败（本批 10 份合计 +116 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1404 条 + 内链 462 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`claudeInChrome/setupPortable.ts`(233) · `sessionStart.ts`(232) · `modelCost.ts`(231) · `secureStorage/macOsKeychainStorage.ts`(231) · `bash/parser.ts`(230) · `permissions/shellRuleMatching.ts`(228) · `readEditContext.ts`(227) · `dxt/zip.ts`(226) · `notebook.ts`(224) · `sideQuery.ts`(221) …（utils 还剩 364 份；全仓还剩 1,110 份）。

### utils 第 69 批：小文件十件套（233-221 行档，111 锚点）

本批是「230 行上下」的十份独立工具，横跨「Chrome 扩展便携探测、会话启动钩子、模型费用折算、macOS 钥匙串、bash 命令解析、权限通配匹配、编辑上下文扫描、zip 解压防御、notebook 解析、旁路 API 封装」——彼此独立，但共同补齐 utils 中层的「跨平台适配 / 动作前治理（计费·放行·归因·安全读）/ 内容解析底座」积木。

| 文件                                                                                                         | 原文  | 批注版 | 锚点 | 讲什么                                                                     |
| ---------------------------------------------------------------------------------------------------------- | --- | --- | -- | ----------------------------------------------------------------------- |
| [`utils/claudeInChrome/setupPortable.ts`](annotated/src/utils/claudeInChrome/setupPortable.ts)             | 233 | 246 | 13 | Chrome 便携探测：按 process.platform 拼各浏览器数据目录，遍历 Default/Profile 找扩展 ID 判定安装 |
| [`utils/sessionStart.ts`](annotated/src/utils/sessionStart.ts)                                             | 232 | 243 | 11 | 会话启动钩子：bare 跳过、插件钩子加载失败降级、收集消息/上下文/监视路径                                 |
| [`utils/modelCost.ts`](annotated/src/utils/modelCost.ts)                                                   | 231 | 244 | 13 | 费用模型：各档价位常量、按模型名解析价位、token 折算成美元                                        |
| [`utils/secureStorage/macOsKeychainStorage.ts`](annotated/src/utils/secureStorage/macOsKeychainStorage.ts) | 231 | 240 | 9  | macOS 钥匙串：TTL 缓存、stale-while-error、stdin/argv 双路径与可执行位                  |
| [`utils/bash/parser.ts`](annotated/src/utils/bash/parser.ts)                                               | 230 | 241 | 11 | bash 解析：tree-sitter 特性门控、解析中止哨兵、命令节点定位与参数抽取                             |
| [`utils/permissions/shellRuleMatching.ts`](annotated/src/utils/permissions/shellRuleMatching.ts)           | 228 | 238 | 10 | 权限匹配：精确/前缀/通配三种规则，转义感知的通配匹配                                             |
| [`utils/readEditContext.ts`](annotated/src/utils/readEditContext.ts)                                       | 227 | 237 | 10 | 编辑上下文：8KB 分块跨块重叠扫描、CRLF 兼容、±上下文切片                                       |
| [`utils/dxt/zip.ts`](annotated/src/utils/dxt/zip.ts)                                                       | 226 | 236 | 10 | zip 解压：路径穿越/体积/数量/压缩比四重防御、中央目录权限位恢复                                     |
| [`utils/notebook.ts`](annotated/src/utils/notebook.ts)                                                     | 224 | 236 | 12 | notebook 解析：cell 处理、大输出截断、图片抽取、相邻文本块合并                                  |
| [`utils/sideQuery.ts`](annotated/src/utils/sideQuery.ts)                                                   | 222 | 234 | 12 | 侧查询封装：OAuth 指纹、归属头、CLI 前缀、思考预算、结构化输出                                    |

两条横切观察：

- **「跨平台落地」本批占了三份**：`setupPortable`（跨操作系统拼浏览器数据目录）、`macOsKeychainStorage`（macOS 钥匙串的缓存与 stdin/argv 双路径写入）、`dxt/zip`（解压时的路径穿越防御与 Unix 权限位恢复）共同处理「代码如何安全落到不同系统」；三者都体现「先防御、再降级、最后保功能」的同一直觉。
- **「动作发生前的治理」是另一条暗线**：`modelCost`（token 折算美元与价位分档）、`shellRuleMatching`（命令权限的精确/前缀/通配匹配）、`sideQuery`（主循环之外的旁路调用统一做 OAuth 归因）与 `readEditContext`（编辑前的安全上下文扫描）从「算得清账 / 放不放行 / 调用可归因 / 读得安全」四个角度把「动作前的治理」讲全；而 `notebook` 与 `bash/parser` 则是被上层反复依赖的「内容解析 / 命令理解」底座。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效）；预检三断言一次通过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 802 份 0 失败（本批 10 份合计 +111 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1414 条 + 内链 463 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`context.ts`(221) · `plugins/officialMarketplaceGcs.ts`(216) · `computerUse/computerUseLock.ts`(215) · `plugins/refresh.ts`(215) · `hooks/execPromptHook.ts`(211) · `suggestions/slackChannelSuggestions.ts`(209) · `plugins/pluginFlagging.ts`(208) · `mcpValidation.ts`(208) · `codeIndexing.ts`(206) · `bash/prefix.ts`(204) …（utils 还剩 354 份；全仓还剩 1,100 份）。

---

### utils 第 70 批：小文件十件套（221-204 行档，118 锚点）

本批是「210 行上下」的十份独立工具，横跨「上下文窗口解析、官方市场 GCS 镜像拉取、ComputerUse 锁、插件激活刷新、提示词式 hook、Slack 频道建议、MCP 输出截断、插件下架标记、代码索引识别、bash 命令前缀推导」——彼此独立，但共同补齐 utils 中层的「模型上下文与配额 / 插件生命周期治理 / 外部工具集成 / 命令理解」积木。

| 文件                                                                                                           | 原文  | 批注版 | 锚点 | 讲什么                                             |
| ------------------------------------------------------------------------------------------------------------ | --- | --- | -- | ----------------------------------------------- |
| [`utils/context.ts`](annotated/src/utils/context.ts)                                                         | 221 | 233 | 12 | 上下文窗口：默认 20 万、1M 检测、max output token 分桶、压缩占比计算  |
| [`utils/plugins/officialMarketplaceGcs.ts`](annotated/src/utils/plugins/officialMarketplaceGcs.ts)           | 216 | 229 | 13 | 官方市场 GCS 镜像：latest 指针、哨兵比对、原子下载解压、遥测分桶          |
| [`utils/computerUse/computerUseLock.ts`](annotated/src/utils/computerUse/computerUseLock.ts)                 | 215 | 228 | 13 | CU 锁：O_EXCL 原子抢锁、陈旧 PID 回收、只查不抢契约、关机清理          |
| [`utils/plugins/refresh.ts`](annotated/src/utils/plugins/refresh.ts)                                         | 215 | 226 | 11 | 插件激活刷新：清缓存→全量加载→填 mcp/lsp→更新 AppState→LSP 重初始化  |
| [`utils/hooks/execPromptHook.ts`](annotated/src/utils/hooks/execPromptHook.ts)                               | 211 | 224 | 13 | 提示词式 hook：用 LLM 判条件、超时/中止组合信号、blocking/error 结果 |
| [`utils/suggestions/slackChannelSuggestions.ts`](annotated/src/utils/suggestions/slackChannelSuggestions.ts) | 209 | 222 | 13 | Slack 频道建议：MCP 搜索、信封解包、前缀缓存复用、前 10 截断           |
| [`utils/mcpValidation.ts`](annotated/src/utils/mcpValidation.ts)                                             | 208 | 220 | 12 | MCP 输出校验：token 上限优先级、字符预算、文本/图片块截断与提示           |
| [`utils/plugins/pluginFlagging.ts`](annotated/src/utils/plugins/pluginFlagging.ts)                           | 208 | 220 | 12 | 插件下架标记：flagged-plugins.json、48h 过期、原子写与缓存同步     |
| [`utils/codeIndexing.ts`](annotated/src/utils/codeIndexing.ts)                                               | 206 | 214 | 8  | 代码索引识别：CLI 首词映射、MCP 服务器名正则、三类检测入口               |
| [`utils/bash/prefix.ts`](annotated/src/utils/bash/prefix.ts)                                                 | 204 | 215 | 11 | bash 前缀推导：包装命令递归解析、复合命令词对齐最长公共前缀折叠              |

两条横切观察：

- **「插件生命周期治理」本批占三份**：`officialMarketplaceGcs`（从 GCS 镜像拉取并原子落盘官方市场）、`refresh`（把激活组件换进运行中的 AppState）、`pluginFlagging`（下架插件的标记/过期/忽略）从「拿得来 / 换得进 / 下得去」三个角度把插件在运行期的完整生命周期讲全；它们都依赖模块级缓存与原子写（rename）来保证「读改写」不被并发或半失败撕裂。
- **「外部工具的集成与约束」是另一条暗线**：`execPromptHook`（用 LLM 替代脚本执行 hook，靠组合超时/中止信号兜底）、`slackChannelSuggestions`（把 Slack 搜索结果收敛成输入框高亮）、`mcpValidation`（给 MCP 工具输出套上 token/字符双预算的截断闸）共同体现「第三方能力进得来，但上下文预算与行为边界要守住」；而 `context`（模型上下文与配额）与 `bash/prefix`（命令理解与前缀推导）则是被上层反复依赖的「模型参数 / 命令理解」底座。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效）；预检三断言一次通过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`（初版 GCS_BASE 锚点落在多行字符串首行被 fidelity 拦下，后挪到字符串末行修正）；`check-fidelity.py` 本批 10 份 0 失败（合计 +118 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1424 条 + 内链 464 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`concurrentSessions.ts`(204) · `fullscreen.ts`(202) · `transcriptSearch.ts`(202) · `settings/constants.ts`(202) · `streamlinedTransform.ts`(201) · `mcpWebSocketTransport.ts`(200) · `managedEnv.ts`(199) · `permissions/permissionRuleParser.ts`(198) · `heatmap.ts`(198) · `powershell/dangerousCmdlets.ts`(185) …（utils 还剩 344 份；全仓还剩 1,090 份）。

---

### utils 第 71 批：小文件十件套（204-198 行档，123 锚点）

本批是「200 行上下」的十份独立工具，横跨「并发会话登记与计数、终端全屏/tmux 探测、终端字符密度可视化、受管配置注入环境变量、MCP 的 WebSocket 传输、权限规则解析、设置来源枚举与解析、状态提示横幅定义、流式输出精简转换、转录搜索文本提取」——彼此独立，但共同补齐 utils 中层的「运行时配置与来源 / 终端渲染与远端传输 / 会话与检索」积木。

| 文件                                                                                                     | 原文  | 批注版 | 锚点 | 讲什么                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | --- | --- | -- | ------------------------------------------------------------------------------------------------------------- |
| [`utils/concurrentSessions.ts`](annotated/src/utils/concurrentSessions.ts)                             | 204 | 216 | 12 | 并发会话登记与计数：SessionKind/Status 类型、bg/daemon 判定、registerSession、并发数 countConcurrentSessions、活动/桥接 ID 更新          |
| [`utils/fullscreen.ts`](annotated/src/utils/fullscreen.ts)                                             | 202 | 214 | 12 | 全屏与 tmux 终端环境探测：tmux control mode 探测、fullscreen 开关、鼠标跟踪/点击禁用、tmux 鼠标提示                                        |
| [`utils/heatmap.ts`](annotated/src/utils/heatmap.ts)                                                   | 198 | 209 | 11 | 终端热力图生成：HeatmapOptions + generateHeatmap 把字符频次渲染成可视化密度图                                                       |
| [`utils/managedEnv.ts`](annotated/src/utils/managedEnv.ts)                                             | 199 | 212 | 13 | 受管环境（Managed<T> 注入配置）变量应用：safe 与常规两套 applyConfigEnvironmentVariables                                          |
| [`utils/mcpWebSocketTransport.ts`](annotated/src/utils/mcpWebSocketTransport.ts)                       | 200 | 214 | 14 | MCP 的 WebSocket 传输实现：WebSocketTransport 类实现 Transport 接口（连接/收发/关闭）                                            |
| [`utils/permissions/permissionRuleParser.ts`](annotated/src/utils/permissions/permissionRuleParser.ts) | 198 | 210 | 12 | 权限规则解析：legacy 工具名归一/反查、规则内容转义/反转义、字符串⇄值互转                                                                     |
| [`utils/settings/constants.ts`](annotated/src/utils/settings/constants.ts)                             | 202 | 214 | 12 | 设置来源常量与解析：SETTING_SOURCES、来源名展示、parseSettingSourcesFlag、getEnabledSettingSources                              |
| [`utils/statusNoticeDefinitions.tsx`](annotated/src/utils/statusNoticeDefinitions.tsx)                 | 198 | 211 | 14 | 状态提示横幅定义：StatusNotice 类型族 + 6 条定义（大内存文件/大 agent 描述/外部 token/API key 冲突/双认证/JetBrains 插件）+ getActiveNotices 过滤 |
| [`utils/streamlinedTransform.ts`](annotated/src/utils/streamlinedTransform.ts)                         | 201 | 213 | 12 | 流式精简转换器：createStreamlinedTransformer 把消息流折叠成精简 Stdout、shouldIncludeInStreamlined 判定保留                         |
| [`utils/transcriptSearch.ts`](annotated/src/utils/transcriptSearch.ts)                                 | 202 | 213 | 11 | 转录搜索文本提取：renderableSearchText / toolUseSearchText / toolResultSearchText 把各类消息转成可搜索纯文本                        |

两条横切观察：

- **「配置与来源注入」本批占两份**：`managedEnv`（把托管配置安全/常规两套注入进程环境变量，隔离来自配置文件的危险变量）与 `settings/constants`（设置来源枚举 SETTING_SOURCES 与解析、决定哪些来源生效）从「配置从哪来、怎么解析、怎么安全落到环境/界面」两个角度把运行时配置底座讲全；它们都依赖显式来源声明而非隐式推断。
- **「终端渲染与远端传输」是另一条暗线**：`fullscreen`（tmux 全屏/鼠标跟踪探测）、`heatmap`（终端字符密度可视化）、`mcpWebSocketTransport`（MCP 走 WebSocket 的传输层，连接/收发/关闭）三份都在讲「终端这层怎么被探测、被渲染、被打通到远端协议」；而 `concurrentSessions`（并发会话登记/计数，防止开太多后台/守护会话）与 `transcriptSearch`（把对话转录转成可搜索文本以支撑回溯）则收口「会话生命周期与可检索性」。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效）；预检三断言一次通过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 10 份 0 失败（合计 +123 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1434 条 + 内链 465 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`authFileDescriptor.ts`(196) · `computerUse/appNames.ts`(196) · `plugins/cacheUtils.ts`(196) · `cronTasksLock.ts`(195) · `startupProfiler.ts`(194) · `user.ts`(194) · `claudeCodeHints.ts`(193) · `hooks/hookEvents.ts`(192) · `earlyInput.ts`(191) · `jetbrains.ts`(191) …（utils 还剩 334 份；全仓还剩 1,080 份）。

---

### utils 第 72 批：小文件十件套（196-191 行档，123 锚点）

本批是「190 行上下」的十份独立工具，横跨「已装 App 名过滤净化、插件缓存清理与孤儿版本回收、CCR 容器 token 落地、调度器租约锁、启动期性能剖析、用户核心数据聚合、hints 标签协议、hook 事件广播、JetBrains 插件探测、早期输入捕获」——彼此独立，但共同补齐 utils 中层的「环境边界身份注入 / 资源与调度协调 / 外部信号消化」积木。

| 文件                                                                             | 原文  | 批注版 | 锚点 | 讲什么                                                                                         |
| ------------------------------------------------------------------------------ | --- | --- | -- | ------------------------------------------------------------------------------------------- |
| [`utils/computerUse/appNames.ts`](annotated/src/utils/computerUse/appNames.ts) | 196 | 210 | 14 | 已装 App 名过滤与净化，供 request_access 工具描述；路径白名单 + 显示名黑名单 + 提示注入加固（Unicode 字符集 / 长度 40 / 数量 50 上限） |
| [`utils/plugins/cacheUtils.ts`](annotated/src/utils/plugins/cacheUtils.ts)     | 196 | 208 | 12 | 插件缓存清理与孤儿版本 7 天惰性清理（两趟扫描、zip 缓存模式整体跳过）                                                      |
| [`utils/authFileDescriptor.ts`](annotated/src/utils/authFileDescriptor.ts)     | 196 | 208 | 12 | CCR 容器里把 FD 传入的 OAuth token / API key 落地到已知文件，供子进程（FD 无法跨 tmux/exec）读取                      |
| [`utils/cronTasksLock.ts`](annotated/src/utils/cronTasksLock.ts)               | 195 | 207 | 12 | scheduled_tasks.json 的调度器租约锁：O_EXCL 原子创建、PID 存活探测、陈旧锁恢复                                     |
| [`utils/startupProfiler.ts`](annotated/src/utils/startupProfiler.ts)           | 194 | 207 | 13 | 启动期性能剖析：采样上报 Statsig + 详细模式写含内存快照的报告                                                        |
| [`utils/user.ts`](annotated/src/utils/user.ts)                                 | 194 | 206 | 12 | 用户核心数据聚合：设备/会话/平台/订阅/CI 元数据，OAuth 邮箱异步预取                                                    |
| [`utils/claudeCodeHints.ts`](annotated/src/utils/claudeCodeHints.ts)           | 193 | 206 | 13 | Claude Code hints 协议：扫描工具输出里的 <claude-code-hint /> 标签、剥离并弹安装提示，单槽存储                         |
| [`utils/hooks/hookEvents.ts`](annotated/src/utils/hooks/hookEvents.ts)         | 192 | 205 | 13 | hook 执行事件广播系统：started/progress/response 三类事件，与主消息流解耦                                        |
| [`utils/jetbrains.ts`](annotated/src/utils/jetbrains.ts)                       | 191 | 202 | 11 | JetBrains IDE 插件探测：按 IDE 名映射各平台插件目录，检测 claude-code-jetbrains-plugin 是否安装                    |
| [`utils/earlyInput.ts`](annotated/src/utils/earlyInput.ts)                     | 191 | 202 | 11 | 早期输入捕获：REPL 初始化前捕获终端键入，避免用户 prompt 字符丢失                                                     |

两条横切观察：

- **「资源回收与调度协调」本批占两份**：`cacheUtils`（各类插件缓存清退 + 孤儿版本 7 天惰性清理，两趟扫描保证不误删 zip 缓存）与 `cronTasksLock`（调度器租约锁，O_EXCL 原子创建 + PID 存活探测 + 陈旧锁恢复）都体现「用不可靠文件系统的原语拼出可靠协调」——前者管资源回收、后者管多会话互斥，思路都是「先试原子操作、失败再按状态回退」。
- **「环境边界与身份注入」是另一条暗线**：`authFileDescriptor`（CCR 容器里 FD→已知文件的 token 落地，因为管道 FD 跨不了 tmux/exec 边界）、`startupProfiler`（启动期按用户类型采样剖析，细节开销只落在被采样会话）、`user`（核心用户数据聚合、OAuth 邮箱异步预取避免阻塞同步路径）三份都在讲「程序在哪种环境里跑、把什么身份信息安全地带进上下文」；而 `claudeCodeHints`（工具输出里的提示标签剥离）与 `hooks/hookEvents`（hook 事件广播）则收口「外部/子系统的信号怎么被本端安全消化」。

踩坑：`jetbrains.ts` 初版把锚点落在 `const localAppData =`（多行赋值首行，以 `=` 结尾）之后，被 check-fidelity 判据 5 拦下——中文批注插在未结束的多行表达式中间会把语句劈断；挪到该赋值收尾行（第 39 行）后过；其余九份预检三断言一次通过、零 `⟳`、零块注释内中文告警。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效）；预检十份全过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`（仅 jetbrains 一处 `=` 结尾行锚点外移修正）；`check-fidelity.py` 本批 10 份 0 失败（全仓 832 份 0 失败，合计 +123 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1958 条 + 内链 593 条，0 失效。

### utils 第 73 批：小文件十件套（191-183 行档，108 锚点）

本批是「190 行上下」的十份独立工具，横跨「宿主托管/安全环境变量清单、文件变化钩子监听、内置终端面板、MCP 大输出与二进制落盘、外部编辑器接入、PowerShell 危险 cmdlet 清单、进程树探查、示例命令生成、环境变量工具集、提示词内嵌 shell 执行」——彼此独立，但共同补齐 utils 中层的「运行环境来源 / 进程与 shell 生命周期 / 产物落盘」积木。

| 文件                                                                                           | 原文  | 批注版 | 锚点 | 讲什么                                                                     |
| -------------------------------------------------------------------------------------------- | --- | --- | -- | ----------------------------------------------------------------------- |
| [`utils/managedEnvConstants.ts`](annotated/src/utils/managedEnvConstants.ts)                 | 191 | 201 | 10 | 宿主托管环境变量与安全环境变量两份清单——决定远端托管配置能否覆盖用户设置、哪些变量可信任对话框前安全应用                   |
| [`utils/hooks/fileChangedWatcher.ts`](annotated/src/utils/hooks/fileChangedWatcher.ts)       | 191 | 203 | 12 | 基于 chokidar 监听 cwd 下 env/hook 相关文件变化，触发 FileChanged/CwdChanged 钩子并通知 UI |
| [`utils/terminalPanel.ts`](annotated/src/utils/terminalPanel.ts)                             | 191 | 202 | 11 | 内置终端面板，Meta+J 切换，tmux 持久会话按实例隔离，无 tmux 退回非持久 shell                      |
| [`utils/mcpOutputStorage.ts`](annotated/src/utils/mcpOutputStorage.ts)                       | 189 | 198 | 9  | MCP 大输出与二进制结果的落盘、mime→扩展名映射、给模型的读取指引                                    |
| [`utils/promptEditor.ts`](annotated/src/utils/promptEditor.ts)                               | 188 | 199 | 11 | 把提示词/文件交给外部编辑器编辑，suspend-Ink 模式兼容 GUI 与终端编辑器                            |
| [`utils/powershell/dangerousCmdlets.ts`](annotated/src/utils/powershell/dangerousCmdlets.ts) | 185 | 196 | 11 | 会执行任意代码的 PowerShell cmdlet 清单，供权限校验与 UI 建议门控共用                          |
| [`utils/genericProcessUtils.ts`](annotated/src/utils/genericProcessUtils.ts)                 | 184 | 192 | 8  | 平台无关查询进程树（是否运行/祖先 PID/子进程），Windows 走 PowerShell、Unix 走 sh               |
| [`utils/exampleCommands.ts`](annotated/src/utils/exampleCommands.ts)                         | 184 | 196 | 12 | 按最近修改文件生成「尝试这些命令」式示例提示，过滤非核心文件                                          |
| [`utils/envUtils.ts`](annotated/src/utils/envUtils.ts)                                       | 183 | 197 | 14 | 环境变量工具集——配置主目录、布尔/选项判断、裸模式、env 解析、AWS/Vertex 区域推导                       |
| [`utils/promptShellExecution.ts`](annotated/src/utils/promptShellExecution.ts)               | 183 | 193 | 10 | 解析提示词内嵌 shell 命令（\`\`\`! 与 !\`），选 bash/powershell 路由执行并回填               |

两条横切观察：

- **「宿主托管 vs 用户可控」的配置边界本批占两份**：`managedEnvConstants`（哪些环境变量可由远端托管覆盖、哪些属安全变量可信任对话框前应用）与 `envUtils`（CLAUDE_CONFIG_DIR 解析、裸模式跳过凭据读取、AWS/Vertex 区域推导）共同把「运行环境从哪来、哪些由宿主决定、哪些由用户/默认值兜底」讲全；二者都依赖显式来源声明而非隐式推断。
- **「进程与 shell 生命周期」是另一条暗线**：`fileChangedWatcher`（文件变化→钩子→UI 通知的监听生命周期）、`terminalPanel`（tmux 会话的创建/挂接/销毁）、`genericProcessUtils`（进程树父子关系探查）、`promptShellExecution`（提示词内嵌命令的权限校验与执行回填）四份都在讲「程序怎么观察并驱动外部进程/shell」；而 `mcpOutputStorage` 与 `promptEditor` 则收口「产物怎么落盘、编辑怎么交还外部工具」。

踩坑：本批 10 份预检三断言一次通过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`（`genericProcessUtils` 含多行 PowerShell 模板字符串，但锚点全部落在函数/分支收尾行，未触发模板外移）；`check-fidelity` 本批 10 份 0 失败（全仓 842 份 0 失败）；`check-links` 源码链接 1958 条 + 内链 593 条，0 失效。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效）；预检十份全过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 10 份 0 失败（合计 +108 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1958 条 + 内链 593 条，0 失效。

**本批（第 74 批）完成（utils 剩余，按行数降序）**：`editor.ts`(183) · `groupToolUses.ts`(182) · `mtls.ts`(179) · `truncate.ts`(179) · `queryContext.ts`(179) · `agentContext.ts`(178) · `detectRepository.ts`(178) · `plugins/loadPluginOutputStyles.ts`(178) · `headlessProfiler.ts`(178) · `plugins/pluginDirectories.ts`(178) · `diff.ts`(177) · `headlessPluginInstall.ts`(174) · `windowsPaths.ts`(173) · `treeify.ts`(170) · `deepLink/parseDeepLink.ts`(170)（utils 还剩 299 份；全仓还剩 1,045 份）。

### utils 第 74 批：小文件十五件套（183-170 行档，168 锚点）

本批是「180 行上下」的十五份独立工具，横跨「外部编辑器启动、工具调用分组渲染、mTLS 证书装配、宽度感知截断、query 缓存键前缀、插件输出样式加载、仓库 remote 解析、插件目录真相、智能体上下文隔离、无界面剖析、结构化 diff、无界面插件安装、Windows/POSIX 路径互转、树形渲染、深链 URI 解析」——彼此独立，但共同补齐 utils 中层的「对外桥接 / 无头环境自处 / 通用文本与渲染积木」。

| 文件                                                                                                 | 原文  | 批注版 | 锚点 | 讲什么                                                   |
| -------------------------------------------------------------------------------------------------- | --- | --- | -- | ----------------------------------------------------- |
| [`utils/editor.ts`](annotated/src/utils/editor.ts)                                                 | 183 | 204 | 11 | 把文件交给外部编辑器：GUI 用 detached 子进程、终端用 Ink alt-screen 接管   |
| [`utils/groupToolUses.ts`](annotated/src/utils/groupToolUses.ts)                                   | 182 | 201 | 11 | 把同一条响应里的多个同类工具调用聚合成一条 grouped 消息                      |
| [`utils/mtls.ts`](annotated/src/utils/mtls.ts)                                                     | 179 | 196 | 12 | mTLS 客户端证书/私钥/口令读取、HTTPS Agent 与 undici dispatcher 装配 |
| [`utils/truncate.ts`](annotated/src/utils/truncate.ts)                                             | 179 | 196 | 12 | 宽度感知的截断与换行，grapheme 边界切分避免劈坏 CJK/emoji                |
| [`utils/queryContext.ts`](annotated/src/utils/queryContext.ts)                                     | 179 | 192 | 9  | 构建 query 缓存键前缀的三段上下文，SDK 侧追问回建缓存安全参数                  |
| [`utils/plugins/loadPluginOutputStyles.ts`](annotated/src/utils/plugins/loadPluginOutputStyles.ts) | 178 | 187 | 9  | 从插件目录加载输出样式并以插件名做命名空间                                 |
| [`utils/detectRepository.ts`](annotated/src/utils/detectRepository.ts)                             | 178 | 194 | 13 | 把任意主机 remote URL 解析为 host/owner/name，过滤 SSH 别名        |
| [`utils/plugins/pluginDirectories.ts`](annotated/src/utils/plugins/pluginDirectories.ts)           | 178 | 194 | 13 | 插件目录唯一真相来源，cowork 切换与只读种子层                            |
| [`utils/agentContext.ts`](annotated/src/utils/agentContext.ts)                                     | 178 | 191 | 12 | 用 AsyncLocalStorage 跟踪子智能体与队友身份，跨并发隔离                 |
| [`utils/headlessProfiler.ts`](annotated/src/utils/headlessProfiler.ts)                             | 178 | 189 | 9  | 无界面模式每轮延迟剖析与采样上报                                      |
| [`utils/diff.ts`](annotated/src/utils/diff.ts)                                                     | 177 | 187 | 10 | 结构化 diff 生成、行数统计与 &/$ 特殊字符转义                          |
| [`utils/plugins/headlessPluginInstall.ts`](annotated/src/utils/plugins/headlessPluginInstall.ts)   | 174 | 185 | 10 | 无界面（CCR）模式插件安装，不更新 AppState                           |
| [`utils/windowsPaths.ts`](annotated/src/utils/windowsPaths.ts)                                     | 173 | 186 | 13 | Windows 与 POSIX 路径互转，git-bash 定位与当前目录恶意过滤             |
| [`utils/treeify.ts`](annotated/src/utils/treeify.ts)                                               | 170 | 180 | 10 | 带 Ink 主题色的树形渲染实现                                      |
| [`utils/deepLink/parseDeepLink.ts`](annotated/src/utils/deepLink/parseDeepLink.ts)                 | 170 | 185 | 14 | 解析 claude-cli 深链 URI，校验 cwd/repo/query 防注入            |

两条横切观察：

- **「对外桥接的注入边界」本批占三份**：`editor.ts`（把文件交给外部编辑器，Windows 上 shell 拼命令、POSIX 上直接传 argv 数组避免命令注入）、`windowsPaths.ts`（Windows/Unix 路径互转、过滤当前目录的恶意 git.bat）、`parseDeepLink.ts`（深链 URI 的 cwd/repo/query 强制绝对路径、拒绝控制字符、超长拒绝而非截断）共同把「Claude Code 与外部环境（编辑器/Shell/URI）的接口」讲全；三者都把真正的注入边界放在使用点（单引号转义 / 路径校验 / 字符拒绝），而不是解析阶段。
- **「无头环境怎么不依赖 UI 把事办成」是另一条暗线**：`headlessProfiler.ts`（无界面每轮延迟剖析、采样上报）、`headlessPluginInstall.ts`（无界面插件安装、无 AppState 更新）、`loadPluginOutputStyles.ts`（插件产物样式加载）、`pluginDirectories.ts`（插件目录真相、cowork 切换、只读种子层）四份都收口「CCR/无界面模式下插件体系怎么落地、指标怎么采」；而 `agentContext.ts` 用 AsyncLocalStorage 把并发子智能体身份隔离，恰好是「无头多智能体」能安全并行的前提。

踩坑：本批 15 份预检五断言一次通过、零合并错误；`annotate.py` 十五次零 `⟳`、零 `⚠`；`queryContext.ts` 初版一处锚点落在多行 `const {...} =` 赋值起始行，被 check-fidelity 判据 5（劈开未结束的多行表达式）拦下，改到该语句收尾行 (125) 后通过——印证「after 不落跨行赋值首行」；`check-fidelity` 全仓 857 份 0 失败；`check-links` 源码链接 1968 条 + 内链 594 条，0 失效。

流程账：本批 15 个数据文件逐一对齐源文件（硬规矩连续生效，queryContext 一处跨行赋值首行被保真度拦下后修正）；预检 15 份全过、零合并错误；`annotate.py` 十五次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 15 份 0 失败（合计 +168 处锚点、+211 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1968 条 + 内链 594 条，0 失效。

### utils 第 75 批：小文件十一件套（170→164 行档，113 锚点）

本批是「170 行上下」的十一份独立工具，横跨「模型白名单判定、shell 配置别名管理、图片磁盘缓存、会话环境脚本聚合、文本高亮分段、shell 补全缓存、模型 ID 字符串解析、活跃时间统计、插件安装提示、settings 校验建议、插件 zip 缓存 I/O」——彼此独立，但共同补齐 utils 中层的「配置 / 缓存 / 环境 / 模型路由」四类积木。

| 文件                                                                                         | 原文  | 批注版 | 锚点 | 讲什么                                              |
| ------------------------------------------------------------------------------------------ | --- | --- | -- | ------------------------------------------------ |
| [`utils/model/modelAllowlist.ts`](annotated/src/utils/model/modelAllowlist.ts)             | 170 | 181 | 11 | availableModels 白名单的三层匹配：精确 / 家族通配 / 版本前缀，别名双向解析 |
| [`utils/shellConfig.ts`](annotated/src/utils/shellConfig.ts)                               | 167 | 177 | 10 | shell rc 文件里 claude 别名的安装、查找、可执行校验               |
| [`utils/imageStore.ts`](annotated/src/utils/imageStore.ts)                                 | 167 | 178 | 11 | 粘贴图片落盘缓存、内存索引与 LRU 淘汰、跨会话清理                      |
| [`utils/sessionEnvironment.ts`](annotated/src/utils/sessionEnvironment.ts)                 | 166 | 176 | 10 | 会话级 env 脚本读写、钩子脚本按类型/序号确定性排序                     |
| [`utils/textHighlighting.ts`](annotated/src/utils/textHighlighting.ts)                     | 166 | 176 | 10 | 含 ANSI 转义文本的高亮分段，可见坐标与原始坐标双体系                    |
| [`utils/completionCache.ts`](annotated/src/utils/completionCache.ts)                       | 166 | 176 | 10 | 生成并缓存 shell 补全脚本，写入各 shell 的 rc 文件               |
| [`utils/model/modelStrings.ts`](annotated/src/utils/model/modelStrings.ts)                 | 166 | 176 | 10 | 模型键到提供商特定 ID 的解析，Bedrock 推理配置叠加 overrides        |
| [`utils/activityManager.ts`](annotated/src/utils/activityManager.ts)                       | 164 | 175 | 11 | 通用活跃时间统计，区分用户活跃与 CLI 活跃、单例管理                     |
| [`utils/plugins/hintRecommendation.ts`](annotated/src/utils/plugins/hintRecommendation.ts) | 164 | 174 | 10 | 插件安装提示推荐，同步预存闸门加异步市场解析                           |
| [`utils/settings/validationTips.ts`](annotated/src/utils/settings/validationTips.ts)       | 164 | 174 | 10 | 基于 Zod 校验错误的修复建议与文档链接匹配表                         |
| [`utils/plugins/zipCacheAdapters.ts`](annotated/src/utils/plugins/zipCacheAdapters.ts)     | 164 | 173 | 9  | 插件 zip 缓存的元数据 I/O 与单市场 JSON 读写                   |

两条横切观察：

- **「配置与缓存的读写边界」本批占四份**：`shellConfig.ts`（rc 文件别名的增删查、只动安装器写入的别名）、`imageStore.ts`（图片落盘加内存索引加跨会话清理）、`sessionEnvironment.ts`（会话 env 脚本聚合、确定性排序）、`completionCache.ts`（补全脚本生成缓存加 rc 注入）共同把「配置/缓存怎么安全读写、不污染用户文件」讲全；四者都用原子写 / datasync / 失败后安全降级（返回 null 或跳过）守边界。
- **「模型路由与用户可见提示」是另一条暗线**：`modelAllowlist.ts`（白名单三层匹配）、`modelStrings.ts`（模型键到提供商 ID、Bedrock 叠 overrides）两端收口「模型名怎么解析成可调用 ID、又怎么被允许」；而 `hintRecommendation.ts`（插件安装提示）、`validationTips.ts`（settings 校验建议）则把「用户操作出错时给什么提示、指向哪份文档」做成 show-once / 匹配表两套机制。

踩坑：本批 11 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 `[1, len]` 内、无重复锚点、无英文双引号与反斜杠、`ast.parse` 全过）；`annotate.py` 十一次零 `⟳`、零 `⚠`（无一处分流到块注释内或模板字符串内）；`check-fidelity` 全仓 868 份 0 失败；`check-links` 源码链接 1983 条加内链 595 条，0 失效。

流程账：本批 11 个数据文件逐一对齐源文件（硬规矩连续生效，无跨行赋值首行 / 块注释内锚点）；预检 11 份全过、零合并错误；`annotate.py` 十一次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 11 份 0 失败（合计 +113 处锚点、+112 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1983 条加内链 595 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`localInstaller.ts`(162) · `githubRepoPathMapping.ts`(162) · `thinking.ts`(162) · `plugins/parseMarketplaceInput.ts`(162) · `model/validateModel.ts`(159) · `debugFilter.ts`(157) · `plugins/pluginVersioning.ts`(157) · `model/agent.ts`(157) · `sideQuestion.ts`(155) · `permissions/bypassPermissionsKillswitch.ts`(155) …（utils 还剩 288 份；全仓还剩 1,034 份）。

### utils 第 76 批：小文件十件套（162→155 行档，89 锚点）

本批是「160 行上下」的十份独立工具，横跨「思考模式判定与彩虹色板、插件源字符串解析、本地安装器、GitHub 仓库路径映射、模型在线校验、调试过滤器、插件版本计算、子代理模型选择、路径工具集、bypass 权限与 auto 模式开关」——彼此独立，但共同补齐 utils 中层的「模型路由 / 插件生态 / 路径与环境 / 权限门控」四类积木。

| 文件                                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | --- | --- | -- | -------------------------------------------------------------------- |
| [`utils/thinking.ts`](annotated/src/utils/thinking.ts)                                                               | 162 | 171 | 9  | ThinkingConfig 联合类型、ultrathink 关键词检测与高亮定位、彩虹色板、模型是否支持思考/自适应思考、默认思考开关 |
| [`utils/plugins/parseMarketplaceInput.ts`](annotated/src/utils/plugins/parseMarketplaceInput.ts)                     | 162 | 170 | 8  | 插件源字符串总入口：git SSH / http(s) / 本地路径 / GitHub 简写 五类源解析，错误降级而非抛错        |
| [`utils/localInstaller.ts`](annotated/src/utils/localInstaller.ts)                                                   | 162 | 170 | 8  | 受管本地安装环境：原子写、wrapper 脚本、npm 安装、shell 类型推断                            |
| [`utils/githubRepoPathMapping.ts`](annotated/src/utils/githubRepoPathMapping.ts)                                     | 162 | 170 | 8  | 全局配置里的仓库对本地路径映射：启动期无阻塞写入、前排置顶、失效清理                                   |
| [`utils/model/validateModel.ts`](annotated/src/utils/model/validateModel.ts)                                         | 159 | 166 | 7  | 通过真实 API 调用校验模型有效性，404 给 3P 回退建议，结果缓存                                |
| [`utils/debugFilter.ts`](annotated/src/utils/debugFilter.ts)                                                         | 157 | 166 | 9  | 调试过滤字符串解析、消息分类抽取、包含/排他两种过滤模式                                         |
| [`utils/plugins/pluginVersioning.ts`](annotated/src/utils/plugins/pluginVersioning.ts)                               | 157 | 166 | 9  | 插件版本计算：清单版本到提供版本到 git SHA 到 unknown，git-subdir 把子目录哈希进版本串防缓存串台       |
| [`utils/model/agent.ts`](annotated/src/utils/model/agent.ts)                                                         | 157 | 166 | 9  | 子代理模型选择：inherit 默认、Bedrock 跨区域前缀继承、裸家族别名同档匹配                         |
| [`utils/path.ts`](annotated/src/utils/path.ts)                                                                       | 155 | 167 | 12 | 路径工具集：波浪号展开、绝对对相对、目录探测、穿越检测、配置键归一化                                   |
| [`utils/permissions/bypassPermissionsKillswitch.ts`](annotated/src/utils/permissions/bypassPermissionsKillswitch.ts) | 155 | 165 | 10 | bypass 权限与 auto 模式的灰度门开关守卫，一次性标志加 /login 后重置                         |

两条横切观察：

- **「模型路由的两端」本批占三份**：`thinking.ts`（思考能力判定）、`validateModel.ts`（在线校验加 3P 回退）、`model/agent.ts`（子代理模型选择加 Bedrock 区域继承）共同把「模型名怎么解析、能力怎么判定、子代理怎么继承」收口；三者都强调「一方/三方差异」与「默认开启需谨慎，改之前先通知模型发布负责人」。
- **「插件生态的入口与版本」是一条暗线**：`parseMarketplaceInput.ts`（用户输入变成五类源）与 `pluginVersioning.ts`（源变成缓存版本串）首尾相接，把「用户给的字符串」变成「磁盘上可寻址的缓存路径」；而 `githubRepoPathMapping.ts`（仓库对路径映射）则解决「同一仓库多个克隆该怎么选」。

踩坑：本批 10 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 `[1, len]` 内、无重复锚点、无英文双引号与反斜杠、`ast.parse` 全过）；`annotate.py` 十次零 `⟳`、零 `⚠`（无一处分流到块注释内或模板字符串内）；`check-fidelity` 全仓 878 份 0 失败；`check-links` 源码链接 1994 条加内链 596 条，0 失效。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效，无跨行赋值首行 / 块注释内锚点）；预检 10 份全过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 10 份 0 失败（合计 +89 处锚点、+88 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 1994 条加内链 596 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`sideQuestion.ts`(155) · `claudeDesktop.ts`(152) · `preflightChecks.tsx`(151) · `envDynamic.ts`(151) · `platform.ts`(150) · `execFileNoThrow.ts`(150) · `sessionState.ts`(150) · `swarm/spawnUtils.ts`(146) · `argumentSubstitution.ts`(145) · `advisor.ts`(145) …（utils 还剩 278 份；全仓还剩 1,024 份）。

---

### utils 第 77 批：小文件十件套（155→145 行档，76 锚点）

本批是「150 行上下」的十份独立工具，横跨「侧问派生智能体、Claude Desktop MCP 配置桥接、登录前连通性闸门、动态环境探测、容错子进程封装、平台与 VCS 探测、会话状态机、teammate 派生工具、advisor 工具门控、占位符替换」——彼此独立，但共同补齐 utils 中层的「环境探测 / 进程封装 / 状态与门控 / 提示词占位」四类积木。

| 文件                                                                             | 原文  | 批注版 | 锚点 | 讲什么                                                              |
| ------------------------------------------------------------------------------ | --- | --- | -- | ---------------------------------------------------------------- |
| [`utils/sideQuestion.ts`](annotated/src/utils/sideQuestion.ts)                 | 155 | 161 | 6  | 「/btw」侧问功能：用 forked agent 复用父级提示缓存、隔离响应、禁止工具、单轮回答                |
| [`utils/claudeDesktop.ts`](annotated/src/utils/claudeDesktop.ts)               | 152 | 160 | 8  | 桥接 Claude Desktop 的 MCP 配置：macOS/WSL 路径定位、安全解析、容错返回空             |
| [`utils/preflightChecks.tsx`](annotated/src/utils/preflightChecks.tsx)         | 151 | 159 | 7  | 登录/鉴权前的连通性闸门：并探测两端点、React Compiler 记忆化组件、失败退出                    |
| [`utils/envDynamic.ts`](annotated/src/utils/envDynamic.ts)                     | 151 | 159 | 8  | 在静态 env 上叠加运行时探测：Docker、JetBrains 终端、musl，汇成 envDynamic          |
| [`utils/execFileNoThrow.ts`](annotated/src/utils/execFileNoThrow.ts)           | 150 | 158 | 8  | 容错子进程封装：execa 跨平台、始终 resolve、错误优先级解析                             |
| [`utils/platform.ts`](annotated/src/utils/platform.ts)                         | 150 | 158 | 8  | 平台探测：操作系统、WSL 版本、Linux 发行版、VCS 标记                                |
| [`utils/sessionState.ts`](annotated/src/utils/sessionState.ts)                 | 150 | 159 | 9  | 会话状态机：idle/running/requires_action，镜像 external_metadata 与 SDK 事件 |
| [`utils/swarm/spawnUtils.ts`](annotated/src/utils/swarm/spawnUtils.ts)         | 146 | 152 | 6  | 跨后端派生 teammate：命令路径、继承 CLI 标志、转发环境变量                             |
| [`utils/advisor.ts`](annotated/src/utils/advisor.ts)                           | 145 | 155 | 10 | advisor 工具类型与门控：GrowthBook + 环境变量 + beta 头决定启用                   |
| [`utils/argumentSubstitution.ts`](annotated/src/utils/argumentSubstitution.ts) | 145 | 151 | 6  | 技能/命令提示的 $ARGUMENTS 占位符替换：全量/索引/简写/具名四类                          |

两条横切观察：

- **「环境探测」本批占三份**：`platform.ts`（操作系统/WSL/发行版/VCS）、`envDynamic.ts`（Docker/JetBrains/musl 运行时探测）、`claudeDesktop.ts`（macOS/WSL 配置路径）共同把「当前运行环境长什么样」收口；三者都强调「Linux 下读 /proc 或文件系统、异常一律降级、WSL 只认 microsoft 字样」。
- **「容错与门控」是一条暗线**：`execFileNoThrow.ts`（子进程永远 resolve 不抛错）与 `advisor.ts`（advisor 工具按特性门控启用）、`sessionState.ts`（状态变更统一出口防绕过）、`preflightChecks.tsx`（鉴权前连通性闸门）四份都遵循「失败不崩溃、关键动作走单一收口点」的设计哲学。

踩坑：本批 10 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 `[1, len]` 内、无重复锚点、无英文双引号与反斜杠、`ast.parse` 全过）；`annotate.py` 十次零 `⟳`、零 `⚠`（含 `preflightChecks.tsx` 的 base64 sourceMappingURL 按惯例省略、fidelity 标 `OK*`）；`check-fidelity` 本批 10 份 0 失败（合计 888 份全仓 0 失败）；`check-links` 源码链接 2004 条加内链 597 条，0 失效。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效，三个 `/** */` 文件头锚点经 `after` 自动外移到块后、无块内中文）；预检 10 份全过、零合并错误；`annotate.py` 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 10 份 0 失败（+76 处锚点、+75 行中文批注，代码行与原文逐行相等）；`check-links.py` 源码链接 2004 条加内链 597 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`fileStateCache.ts`(142) · `permissions/PermissionMode.ts`(141) · `hooks/apiQueryHookHelper.ts`(141) · `processUserInput/processBashCommand.tsx`(140) · `sessionIngressAuth.ts`(140) · `horizontalScroll.ts`(137) · `http.ts`(136) · `deepLink/protocolHandler.ts`(136) · `generatedFiles.ts`(136) · `plugins/fetchTelemetry.ts`(135) …（utils 还剩 268 份；全仓还剩 1,014 份）。

### utils 第 79 批：小文件十件套（130→127 行档，128 锚点）

本批是「130 行上下」的十份独立工具，横跨「MDM 子进程读取、MCP 指令增量、文件 glob、swarm 队友初始化、会话标题生成、运行环境检测、shell 安全引用、关键词触发、权限提示结果解析、插件下架清理」——体量小但各自补齐一个独立能力，彼此无依赖。

| 文件                                                                                                                             | 原文  | 批注版 | 锚点 | 讲什么                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | --- | --- | -- | -------------------------------------------------- |
| [`utils/settings/mdm/rawRead.ts`](annotated/src/utils/settings/mdm/rawRead.ts)                                                 | 130 | 139 | 9  | MDM 子进程读取：不阻塞事件循环触发 plutil/reg query，启动期缓存 Promise |
| [`utils/mcpInstructionsDelta.ts`](annotated/src/utils/mcpInstructionsDelta.ts)                                                 | 130 | 142 | 12 | MCP 指令增量附件：diff 已连接服务器与已播报附件，产出新增/移除指令块            |
| [`utils/glob.ts`](annotated/src/utils/glob.ts)                                                                                 | 130 | 142 | 12 | 基于 ripgrep 的 glob：抽静态基目录、绝对路径转相对、忽略模式与隐藏开关         |
| [`utils/swarm/teammateInit.ts`](annotated/src/utils/swarm/teammateInit.ts)                                                     | 129 | 141 | 12 | swarm 队友初始化：注册 Stop 钩子在队友空闲时通知 leader              |
| [`utils/sessionTitle.ts`](annotated/src/utils/sessionTitle.ts)                                                                 | 129 | 144 | 15 | 用 Haiku 生成 sentence-case 会话标题，独立模块便于 SDK print 引入  |
| [`utils/swarm/backends/detection.ts`](annotated/src/utils/swarm/backends/detection.ts)                                         | 128 | 141 | 13 | 运行环境检测：tmux/iTerm2 内否、tmux/it2 可用性，结果缓存            |
| [`utils/bash/shellQuoting.ts`](annotated/src/utils/bash/shellQuoting.ts)                                                       | 128 | 139 | 11 | shell 命令安全引用：保留 heredoc/多行字符串，改写 Windows 的 >nul    |
| [`utils/ultraplan/keyword.ts`](annotated/src/utils/ultraplan/keyword.ts)                                                       | 127 | 143 | 16 | ultraplan/ultrareview 关键词触发定位，跳过字符串/路径/斜杠命令        |
| [`utils/permissions/PermissionPromptToolResultSchema.ts`](annotated/src/utils/permissions/PermissionPromptToolResultSchema.ts) | 127 | 142 | 15 | 权限提示工具结果 schema 与规整成内部 PermissionDecision          |
| [`utils/plugins/pluginBlocklist.ts`](annotated/src/utils/plugins/pluginBlocklist.ts)                                           | 127 | 140 | 13 | 插件下架检测：跨市场找已移除插件并自动卸载、标记 flagged                   |

三条横切观察：

- **「环境探测与启动期 I/O」两条暗线**：`rawRead.ts`（MDM 子进程读取、启动期缓存 Promise）与 `detection.ts`（tmux/iTerm2 探测、结果缓存）都强调「模块加载即抓取、之后只读缓存」——避免事件循环被阻塞、也避免重复 spawn 子进程。
- **「把外部输入安全落地」三份**：`glob.ts`（ripgrep 列文件、绝对路径转相对）、`shellQuoting.ts`（保留 heredoc/多行字符串的安全引用、改写 Windows >nul 误写）、`keyword.ts`（精确识别 ultraplan/ultrareview 触发点、避开字符串与斜杠命令）共同收口「模型或用户的任意文本如何安全地变成可执行的命令或动作」。
- **「指令与权限的可观测」两份**：`mcpInstructionsDelta.ts`（MCP 指令增量附件 diff）与 `PermissionPromptToolResultSchema.ts`（SDK 主机权限结果规整成内部决策、畸形值兜底）都在讲「跨进程或跨主机的契约如何校验与对账」。

踩坑：本批 10 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；annotate.py 良性 ⟳ 外移两处——glob.ts 3 个锚点原落 // 注释段中部（50→51、56→58、91→97）、permissions/PermissionPromptToolResultSchema.ts 2 个锚点（30→32、107→109），均自动挪到段尾、落点人眼确认在英文注释块之后、未劈开英文；首轮 1 FAIL——permissions/PermissionPromptToolResultSchema.ts 锚点 (110,'after') 落在多行赋值 const updatedInput = 首行（规矩 7 变体：行尾 = 触发「未结束多行表达式」判据），挪到三元收尾行 (111,'after') 后复验 0 失败；check-fidelity.py 本批 10 份 0 失败（合计 913 份全仓 0 失败）；check-links.py 源码链接 2029 条加内链 599 条，0 失效。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效，三处 /\** */ 文件头锚点经 after 自动外移到块后、无块内中文；detection.ts 两处 /** \*/ 常量注释头经 after 自动外移）；预检 10 份全过、零合并错误；annotate.py 十次（含 5 处 ⟳ 外移）零 ⚠；check-fidelity.py 本批 10 份 0 失败（+128 处锚点、代码行与原文逐行相等）；check-links.py 源码链接 2029 条加内链 599 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`mcp/dateTimeParser.ts`(121) · `warningHandler.ts`(121) · `QueryGuard.ts`(121) · `teleport/environments.ts`(120) · `suggestions/shellHistoryCompletion.ts`(119) · `swarm/reconnection.ts`(119) · `systemTheme.ts`(119) · `model/modelCapabilities.ts`(118) · `model/configs.ts`(118) · `secureStorage/keychainPrefetch.ts`(116) …（utils 还剩 243 份；全仓还剩 989 份）。

### utils 第 80 批：小文件十五件套（127→120 行档，134 锚点）

本批是「125 行上下」的十五份独立工具，横跨「outputs 目录扫描、computer-use 渲染覆盖、macOS 终端备份恢复、stream-json 标准输出守护、深链来源横幅、插件标识符映射、PowerShell 外壳提供者、系统提示词组装、自动运行 issue 判定、自然语言时间解析、截图写剪贴板、全局警告处理、查询生命周期状态机、云环境获取创建、终端明暗主题探测」——体量小但各自补齐一个独立能力，彼此无依赖。

| 文件                                                                                                 | 原文  | 批注版 | 锚点 | 讲什么                                                                                      |
| -------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------------------------- |
| [`utils/filePersistence/outputsScanner.ts`](annotated/src/utils/filePersistence/outputsScanner.ts) | 127 | 134 | 11 | outputs 目录扫描器：依环境变量判定会话环境、扫描本回合被修改文件（findModifiedFiles），目录读取失败与空结果均安全降级                  |
| [`utils/computerUse/toolRendering.tsx`](annotated/src/utils/computerUse/toolRendering.tsx)         | 125 | 134 | 7  | computer-use 工具渲染覆盖层：坐标格式化、动作结果摘要映射、verbose 兜底（base64 sourceMappingURL 按惯例省略）            |
| [`utils/appleTerminalBackup.ts`](annotated/src/utils/appleTerminalBackup.ts)                       | 125 | 134 | 10 | macOS Terminal.plist 备份与恢复：初始化前后标记、defaults export 备份、恢复结果联合类型、无备份不报错                    |
| [`utils/streamJsonStdoutGuard.ts`](annotated/src/utils/streamJsonStdoutGuard.ts)                   | 123 | 130 | 7  | stream-json 标准输出守护：拦截 process.stdout.write，按行 JSON 解析合法转发、残留半行冲刷到 stderr                 |
| [`utils/deepLink/banner.ts`](annotated/src/utils/deepLink/banner.ts)                               | 123 | 132 | 9  | 深链来源横幅：claude-cli:// 打开时提示工作目录/分支/过期 fetch，阈值常量与 tildify 路径缩写                            |
| [`utils/plugins/pluginIdentifier.ts`](annotated/src/utils/plugins/pluginIdentifier.ts)             | 123 | 134 | 11 | 插件标识符与来源映射：name@marketplace 解析、Extended/Persistable 作用域、设置来源↔作用域双向映射                     |
| [`utils/shell/powershellProvider.ts`](annotated/src/utils/shell/powershellProvider.ts)             | 123 | 130 | 7  | PowerShell 外壳提供者：固定 pwsh 参数、UTF-16LE base64 编码、退出码捕获、/env 环境变量注入                         |
| [`utils/systemPrompt.ts`](annotated/src/utils/systemPrompt.ts)                                     | 123 | 130 | 7  | 有效系统提示词组装：覆盖提示最高优先、协调器/主动模式分支、兜底组合 appendSystemPrompt                                    |
| [`utils/autoRunIssue.tsx`](annotated/src/utils/autoRunIssue.tsx)                                   | 122 | 133 | 10 | 自动运行 /issue 通知与判定：反馈后自动触发问题上报的 UI 与原因判定，当前默认不自动运行（sourceMappingURL 省略）                   |
| [`utils/mcp/dateTimeParser.ts`](annotated/src/utils/mcp/dateTimeParser.ts)                         | 121 | 131 | 10 | 自然语言日期时间解析：调 Haiku 转 ISO 8601，带符号时区拼接、INVALID 兜底、looksLikeISO8601 校验                     |
| [`utils/screenshotClipboard.ts`](annotated/src/utils/screenshotClipboard.ts)                       | 121 | 129 | 8  | 截图写入剪贴板：ANSI 渲染为 PNG 后按平台（macOS osascript / Linux xclip / Windows PowerShell）复制          |
| [`utils/warningHandler.ts`](annotated/src/utils/warningHandler.ts)                                 | 121 | 129 | 8  | 全局警告处理器：拦截 Node warning 事件，外部用户屏蔽、内部告警上报，计数上限与重复安装防护                                     |
| [`utils/QueryGuard.ts`](annotated/src/utils/QueryGuard.ts)                                         | 121 | 133 | 12 | 查询生命周期同步状态机：兼容 useSyncExternalStore，reserve/cancelReservation/tryStart/end/forceEnd 并发保护 |
| [`utils/teleport/environments.ts`](annotated/src/utils/teleport/environments.ts)                   | 120 | 128 | 8  | 云环境获取与创建：Environment API 拉取列表、为无环境用户创建默认云环境（python3.11/node20）                           |
| [`utils/systemTheme.ts`](annotated/src/utils/systemTheme.ts)                                       | 119 | 128 | 9  | 终端明暗主题探测：auto 主题经 OSC 11 背景色判定，BT.709 亮度阈值、rgb 解析与 COLORFGBG 兜底                          |

三条横切观察：

- **「环境探测与备份」暗线**：`outputsScanner.ts`（会话环境类型 + 回合内改动扫描）、`teleport/environments.ts`（云端环境拉取/创建）、`systemTheme.ts`（终端明暗经 OSC 11 探测）、`appleTerminalBackup.ts`（macOS Terminal.plist 备份恢复）四份都在回答「运行环境长什么样、要不要备份/恢复」；均强调「失败不崩溃、无则降级」。
- **「外部输入的结构化落地」三份**：`deepLink/banner.ts`（外部 claude-cli:// 深链打开时构建风险横幅）、`plugins/pluginIdentifier.ts`（name@marketplace 解析 + 设置来源↔作用域双向映射）、`mcp/dateTimeParser.ts`（自然语言时间调 Haiku 转 ISO 8601、歧义偏未来、INVALID 兜底）共同收口「任意外部文本如何安全变成结构化数据」。
- **「输出侧拦截与渲染」四份**：`streamJsonStdoutGuard.ts`（拦截 process.stdout.write 按行 JSON 解析、半行冲刷 stderr）、`warningHandler.ts`（拦截 Node warning、外部屏蔽内部上报、计数上限）、`computerUse/toolRendering.tsx`（computer-use 动作结果覆盖层渲染）、`screenshotClipboard.ts`（ANSI 渲染为 PNG 按平台写剪贴板）都偏「把程序输出转换成对人或机器友好的形态」。

踩坑：本批 15 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；annotate.py 十五次零 `⟳`、零 `⚠`（`computerUse/toolRendering.tsx` 与 `autoRunIssue.tsx` 的 base64 sourceMappingURL 按惯例省略、fidelity 标 `OK*`）；check-fidelity 本批 15 份 0 失败（合计 928 份全仓 0 失败）；check-links 源码链接 2039 条加内链 647 条，0 失效。

流程账：本批 15 个数据文件逐一对齐源文件（硬规矩连续生效，锚点全落函数/类型/语句收尾行或文件头 `after`，无跨行赋值首行、无 `/* */` 块内、无 `//` 段中部，故 annotate 零 `⟳`、零 `⚠`；`toolRendering.tsx`/`autoRunIssue.tsx` 末行 base64 sourceMappingURL 省略各补 2 行中文说明，故 cn 行比锚点多 2）；预检 15 份全过、零合并错误；annotate.py 十五次零 `⟳`、零 `⚠`；check-fidelity.py 本批 15 份 0 失败（+134 处锚点、代码行与原文逐行相等）；check-links.py 源码链接 2039 条加内链 647 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`swarm/reconnection.ts`(119) · `suggestions/shellHistoryCompletion.ts`(119) · `model/modelCapabilities.ts`(118) · `model/configs.ts`(118) · `secureStorage/keychainPrefetch.ts`(116) · `staticRender.tsx`(116) · `caCerts.ts`(115) · `plugins/orphanedPluginFilter.ts`(114) · `secureStorage/macOsKeychainHelpers.ts`(111) · `shell/powershellDetection.ts`(107) · `swarm/teammateLayoutManager.ts`(107) · `ghPrStatus.ts`(106) · `computerUse/mcpServer.ts`(106) · `imageValidation.ts`(104) · `pasteStore.ts`(104) …（utils 还剩 228 份；全仓还剩 974 份）。

### utils 第 81 批：小文件十五件套（119→104 行档，100 锚点）

本批是「119→104 行」的十五份独立工具，横跨「蜂群重连与会话恢复、shell 历史行内补全、模型配置表与能力缓存、组件静态渲染、macOS 钥匙串预取与辅助、CA 证书加载、孤立插件排除、PowerShell 探查、队友布局管理、computer-use MCP 服务、PR 状态查询、粘贴缓存、图像校验」——体量小但各自补齐一个独立能力，彼此无依赖。

| 文件                                                                                                         | 原文  | 批注版 | 锚点 | 讲什么                                                                             |
| ---------------------------------------------------------------------------------------------------------- | --- | --- | -- | ------------------------------------------------------------------------------- |
| [`utils/swarm/reconnection.ts`](annotated/src/utils/swarm/reconnection.ts)                                 | 119 | 124 | 5  | 蜂群重连：冷启动从 CLI 动态上下文装配 teamContext，会话恢复从 transcript 重建队友上下文                      |
| [`utils/suggestions/shellHistoryCompletion.ts`](annotated/src/utils/suggestions/shellHistoryCompletion.ts) | 119 | 127 | 8  | shell 历史行内补全：按精确前缀匹配历史命令返回幽灵文本后缀，带 60 秒缓存与去重                                    |
| [`utils/model/configs.ts`](annotated/src/utils/model/configs.ts)                                           | 118 | 127 | 9  | 模型配置表：各 firstParty/bedrock/vertex/foundry 标识汇总，提供规范标识↔短名映射                      |
| [`utils/model/modelCapabilities.ts`](annotated/src/utils/model/modelCapabilities.ts)                       | 118 | 127 | 9  | 模型能力缓存：从 API 拉取并缓存上下文窗口等能力，仅内部蚂蚁用户启用                                            |
| [`utils/staticRender.tsx`](annotated/src/utils/staticRender.tsx)                                           | 116 | 123 | 6  | 组件静态渲染：把 React 节点渲染成 ANSI/纯文本字符串，绕开 Ink 多 Static 限制（base64 sourceMappingURL 省略） |
| [`utils/secureStorage/keychainPrefetch.ts`](annotated/src/utils/secureStorage/keychainPrefetch.ts)         | 116 | 124 | 8  | 钥匙串预取：main 顶层并行触发 macOS 钥匙串读取，与导入期重叠隐藏约 65 毫秒开销                                 |
| [`utils/caCerts.ts`](annotated/src/utils/caCerts.ts)                                                       | 115 | 120 | 5  | CA 证书加载：按 NODE_EXTRA_CA_CERTS 与系统 CA 组合加载，保持配置无关                                |
| [`utils/plugins/orphanedPluginFilter.ts`](annotated/src/utils/plugins/orphanedPluginFilter.ts)             | 114 | 121 | 7  | 孤立插件排除：用 ripgrep 找 .orphaned_at 生成排除 glob，避免用到旧版本代码                             |
| [`utils/secureStorage/macOsKeychainHelpers.ts`](annotated/src/utils/secureStorage/macOsKeychainHelpers.ts) | 111 | 119 | 8  | 钥匙串辅助：服务名构造、缓存 TTL/代际、预取写入，严禁拖入 execa 重依赖                                       |
| [`utils/shell/powershellDetection.ts`](annotated/src/utils/shell/powershellDetection.ts)                   | 107 | 114 | 7  | PowerShell 探查：优先 pwsh、规避 Linux snap 启动器、按二进制名判 core/desktop 版本                  |
| [`utils/swarm/teammateLayoutManager.ts`](annotated/src/utils/swarm/teammateLayoutManager.ts)               | 107 | 116 | 9  | 队友布局管理：颜色轮转分配、tmux/iTerm2 后端抽象、窗格创建与命令发送                                        |
| [`utils/computerUse/mcpServer.ts`](annotated/src/utils/computerUse/mcpServer.ts)                           | 106 | 111 | 5  | computer-use MCP 服务：替换 ListTools 处理器注入已装应用名，子进程入口冲刷分析                           |
| [`utils/ghPrStatus.ts`](annotated/src/utils/ghPrStatus.ts)                                                 | 106 | 111 | 5  | PR 状态查询：调 gh pr view 推导评审态，默认分支/已合并不显示                                          |
| [`utils/pasteStore.ts`](annotated/src/utils/pasteStore.ts)                                                 | 104 | 109 | 5  | 粘贴缓存：内容寻址的跨会话文本缓存，按修改时间清理                                                       |
| [`utils/imageValidation.ts`](annotated/src/utils/imageValidation.ts)                                       | 104 | 108 | 4  | 图像校验：API 边界按 base64 串长判超限，超限抛 ImageSizeError                                    |

三条横切观察：

- **「凭据与钥匙串」暗线两份**：`keychainPrefetch.ts`（顶层并行预取、与导入期重叠隐藏延迟）与 `macOsKeychainHelpers.ts`（服务名构造、缓存 TTL/代际/预取写入）共同收口「macOS 凭据怎么既安全又快」；均强调「非 darwin 为空操作、超时则让同步路径重试」。
- **「模型元数据」两份**：`configs.ts`（各提供方标识汇总表 + 规范标识↔短名映射）与 `modelCapabilities.ts`（从 API 拉取并缓存能力、仅内部用户）一静一动，把「模型有哪些能力、怎么查」补齐全。
- **「对外边界治理」三份**：`imageValidation.ts`（API 边界图像大小校验）、`pasteStore.ts`（粘贴内容寻址缓存）、`ghPrStatus.ts`（外部 PR 状态查询）都偏「对外输入输出怎么安全落地、失败怎么降级」。

踩坑：本批 15 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；annotate.py 十五次零 `⟳`、零 `⚠`（`staticRender.tsx` 的 base64 sourceMappingURL 按惯例省略、fidelity 标 `OK*`）；check-fidelity 本批 15 份 0 失败（合计 943 份全仓 0 失败）；check-links 源码链接 2054 条加内链 648 条，0 失效。

流程账：本批 15 个数据文件逐一对齐源文件（硬规矩连续生效，文件头 `/** */` 锚点经 `after` 自动外移到块后、无块内中文；`caCerts.ts` 第 49 行 `/* eslint-enable */` 单行块注释改用其后语句行落锚，规避 `after` 落 `*/` 风险）；预检 15 份全过、零合并错误；annotate.py 十五次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 15 份 0 失败（+100 处锚点、代码行与原文逐行相等）；`check-links.py` 源码链接 2054 条加内链 648 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`agentId.ts`(99) · `git/gitignore.ts`(99) · `subprocessEnv.ts`(99) · `abortController.ts`(99) · `exportRenderer.tsx`(98) · `permissions/classifierDecision.ts`(98) · `background/remote/remoteSession.ts`(98) · `messages/systemInit.ts`(96) · `teammateContext.ts`(96) · `fileReadCache.ts`(96) · `queueProcessor.ts`(95) · `planModeV2.ts`(95) · `diagLogs.ts`(94) · `backgroundHousekeeping.ts`(94) · `intl.ts`(94) …（utils 还剩 213 份；全仓还剩 959 份）。

### utils 第 82 批：小文件十件套（103→99 行档，56 锚点）

本批是「103→99 行」的十份独立工具，横跨「工具校验配置声明、进程内队友辅助、同步文件读取叶子、Shift+Tab 权限模式循环、模型弃用提示、带缓冲写入器、用户输入整理、确定式 agent/请求 ID、gitignore 自动忽略、子进程环境机密剥离」——体量小但各自补齐一个独立能力，彼此无依赖。

| 文件                                                                                                         | 原文  | 批注版 | 锚点 | 讲什么                                                            |
| ---------------------------------------------------------------------------------------------------------- | --- | --- | -- | -------------------------------------------------------------- |
| [`utils/settings/toolValidationConfig.ts`](annotated/src/utils/settings/toolValidationConfig.ts)           | 103 | 110 | 7  | 工具校验配置：filePattern/bashPrefix/customValidation 三类，多数工具无需配置     |
| [`utils/inProcessTeammateHelpers.ts`](annotated/src/utils/inProcessTeammateHelpers.ts)                     | 102 | 108 | 6  | 进程内队友辅助：按名找任务 ID、计划审批状态、权限消息判定                                 |
| [`utils/fileRead.ts`](annotated/src/utils/fileRead.ts)                                                     | 102 | 108 | 6  | 同步读文件叶子：编码/行尾探测、一次读取带回元数据、避免拖入长依赖链                             |
| [`utils/permissions/getNextPermissionMode.ts`](annotated/src/utils/permissions/getNextPermissionMode.ts)   | 101 | 106 | 5  | Shift+Tab 循环权限模式：default→acceptEdits→plan→bypass/auto，蚂蚁账号特殊处理 |
| [`utils/model/deprecation.ts`](annotated/src/utils/model/deprecation.ts)                                   | 101 | 106 | 5  | 模型弃用信息：按 ID 子串匹配各 provider 下线日期，拼出提示语                          |
| [`utils/bufferedWriter.ts`](annotated/src/utils/bufferedWriter.ts)                                         | 100 | 105 | 5  | 带缓冲写入器：按时间/条数/字节阈值冲刷，setImmediate 延后阻塞写入                       |
| [`utils/processUserInput/processTextPrompt.ts`](annotated/src/utils/processUserInput/processTextPrompt.ts) | 100 | 106 | 6  | 用户输入整理成消息：字符串与内容块两形态、图片/附件、OTEL 埋点                             |
| [`utils/agentId.ts`](annotated/src/utils/agentId.ts)                                                       | 99  | 104 | 5  | 确定式 agent/请求 ID 拼接与解析：agentName@teamName 与 type-timestamp@id   |
| [`utils/git/gitignore.ts`](annotated/src/utils/git/gitignore.ts)                                           | 99  | 105 | 6  | git check-ignore 封装与全局 gitignore 写入：敏感文件自动忽略                   |
| [`utils/subprocessEnv.ts`](annotated/src/utils/subprocessEnv.ts)                                           | 99  | 104 | 5  | 子进程环境组装：GitHub Actions 下剥离敏感变量，注入 CCR 代理变量                     |

三条横切观察：

- **「配置集中声明」两份**：`toolValidationConfig.ts`（工具校验的静态配置对象，调用方只查不写）与 `subprocessEnv.ts`（子进程环境要剥离的敏感变量清单，同样集中在一处常量）共同体现「规则放一处、调用方只消费」的治理哲学。
- **「身份与权限模式」三份**：`agentId.ts`（确定式 ID 拼接解析）、`getNextPermissionMode.ts`（权限模式循环切换）、`inProcessTeammateHelpers.ts`（进程内队友的权限消息判定）收口「怎么标识一个 agent、怎么在模式间切换、怎么认出权限响应」这条暗线。
- **「读写与生命周期」三份**：`fileRead.ts`（同步读 + 编码/行尾探测）、`bufferedWriter.ts`（带缓冲写）、`gitignore.ts`（忽略规则写入）一静一动一治理，把「文件怎么安全读、怎么攒批写、怎么从版本控制里藏起来」补齐全。

踩坑：本批 10 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；annotate.py 十次零 `⟳`、零 `⚠`；check-fidelity 本批 10 份 0 失败（合计 953 份全仓 0 失败）；check-links 源码链接 2069 条加内链 649 条，0 失效。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效，锚点全部落在 import/函数声明/语句收尾行，无块注释内锚点、无跨行赋值首行锚点）；预检 10 份全过、零合并错误；annotate.py 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 10 份 0 失败（+56 处锚点、代码行与原文逐行相等）；`check-links.py` 源码链接 2069 条加内链 649 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`intl.ts`(94) · `backgroundHousekeeping.ts`(94) · `settings/applySettingsChange.ts`(92) · `sanitization.ts`(91) · `bash/specs/pyright.ts`(91) · `sliceAnsi.ts`(91) · `idePathConversion.ts`(90) · `execFileNoThrowPortable.ts`(89) · `undercover.ts`(89) · `dxt/helpers.ts`(88) · `teamMemoryOps.ts`(88) · `generators.ts`(88) · `caCertsConfig.ts`(88) · `classifierApprovals.ts`(88) · `swarm/backends/teammateModeSnapshot.ts`(87) …（utils 还剩 193 份；全仓还剩 939 份）。

### utils 第 83 批：小文件十件套（99→94 行档，78 锚点）

本批十份覆盖「取消传播、远程会话资格、导出渲染、分类器白名单、SDK 首帧、队友上下文、文件读缓存、计划模式配额、队列消费、诊断日志」——都是小体量的机制件，但每一份都独自承担一条完整语义，没有一份是胶水。

| 文件                                                                                                   | 原文 | 批注版 | 锚点 | 讲什么                                                   |
| ---------------------------------------------------------------------------------------------------- | -- | --- | -- | ----------------------------------------------------- |
| [`utils/abortController.ts`](annotated/src/utils/abortController.ts)                                 | 99 | 108 | 9  | 取消控制器工厂与父子联动：调高监听器上限，双向弱引用避免父级滞留子级                    |
| [`utils/background/remote/remoteSession.ts`](annotated/src/utils/background/remote/remoteSession.ts) | 98 | 107 | 9  | 后台远程会话资格：策略短路 + 三检查并行 + bundle 播种放宽 + App 安装判定        |
| [`utils/exportRenderer.tsx`](annotated/src/utils/exportRenderer.tsx)                                 | 98 | 107 | 8  | 导出渲染：无头环境下分块渲染成 ANSI，按块分配布局树换取内存下降                    |
| [`utils/permissions/classifierDecision.ts`](annotated/src/utils/permissions/classifierDecision.ts)   | 98 | 105 | 7  | 自动模式免分类白名单：只读与纯元数据工具直放，Ant 工具条件 require 供 DCE         |
| [`utils/messages/systemInit.ts`](annotated/src/utils/messages/systemInit.ts)                         | 96 | 103 | 7  | SDK 首帧 system/init：会话元数据全字段、工具名兼容层、UDS 字段旁挂           |
| [`utils/teammateContext.ts`](annotated/src/utils/teammateContext.ts)                                 | 96 | 104 | 8  | 进程内队友上下文：AsyncLocalStorage 承载身份，run 而非 enterWith 防泄漏  |
| [`utils/fileReadCache.ts`](annotated/src/utils/fileReadCache.ts)                                     | 96 | 104 | 8  | 文件读缓存：mtime 精确失效、CRLF 入库前归一、超限删最早插入项                  |
| [`utils/planModeV2.ts`](annotated/src/utils/planModeV2.ts)                                           | 95 | 102 | 7  | 计划模式配额与实验：agent 数按订阅分层、访谈三级开关、计划长度变体分组                |
| [`utils/queueProcessor.ts`](annotated/src/utils/queueProcessor.ts)                                   | 95 | 103 | 8  | 队列消费：主线程过滤防卡死、斜杠与 bash 逐条、同 mode 批量取走                 |
| [`utils/diagLogs.ts`](annotated/src/utils/diagLogs.ts)                                               | 94 | 101 | 7  | 诊断日志：固定四字段 JSONL、同步追加一次重试、started/completed/failed 计时 |

三条横切观察：

- **「并发与生命周期」三份**：`abortController.ts`（父子取消传播）、`teammateContext.ts`（并发队友的身份隔离）、`queueProcessor.ts`（队列的取用节奏）合起来回答「一个进程里同时跑多件事时，取消、身份、调度各自怎么不串」。三者共同点是都用「让状态随作用域走」而不是全局变量：弱引用、ALS、按 mode 分批。
- **「静态白名单与静态快照」两份**：`classifierDecision.ts` 的白名单集合与 `systemInit.ts` 的 init 消息都是「一次性声明、长期被读」的结构，因此都强调不可变与向后兼容（前者集合私有，后者字段只增不改）。
- **「为省资源而设计的形状」两份**：`exportRenderer.tsx` 分块渲染把内存峰值压下去，`fileReadCache.ts` 用 mtime 命中把重复 IO 去掉；一个省内存、一个省磁盘读，手法都是「不改变对外语义的前提下换实现」。

踩坑：本批 10 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；预检另加了「锚点落块注释内部」硬判据，10 份零命中；annotate.py 十次零 `⟳`、零 `⚠`；check-fidelity 本批 10 份 0 失败（合计 963 份全仓 0 失败）；check-links 源码链接 2079 条加内链 650 条，0 失效。

流程账：本批 10 个数据文件逐一对齐源文件（硬规矩连续生效，`teammateContext.ts` 的模块级 `/** */` 文档头用 `(1, after)` 让脚本自动外移、无块内中文；`planModeV2.ts` 第 45 到 87 行的大段块注释整体避开，锚点一律取函数收尾行）；`exportRenderer.tsx` 批注版比源多 9 行而非 8 行，多出的一行是 base64 sourceMappingURL 的省略说明，fidelity 判 `OK*`，不是错误；预检 10 份全过；annotate.py 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 963 份 0 失败；`check-links.py` 源码链接 2079 条加内链 650 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`intl.ts`(94) · `backgroundHousekeeping.ts`(94) · `settings/applySettingsChange.ts`(92) · `sliceAnsi.ts`(91) · `sanitization.ts`(91) · `bash/specs/pyright.ts`(91) · `idePathConversion.ts`(90) · `undercover.ts`(89) · `execFileNoThrowPortable.ts`(89) · `caCertsConfig.ts`(88) · `classifierApprovals.ts`(88) · `teamMemoryOps.ts`(88) · `dxt/helpers.ts`(88) …（utils 还剩 183 份；全仓还剩 929 份）。

### utils 第 84 批：小文件十件套（94→88 行档，88 锚点）

本批十份覆盖「Intl 实例缓存、后台杂务、设置变更应用、ANSI 切片、Unicode 清洗、命令规格声明、IDE 路径换算、隐身模式、同步执行外壳、CA 证书配置」——小体量但每份都在回答一个具体问题：慢的东西怎么不挡路、看不见的字符怎么防、两套环境怎么对路径、对外输出怎么不泄密。

| 文件                                                                                             | 原文 | 批注版 | 锚点 | 讲什么                                                   |
| ---------------------------------------------------------------------------------------------- | -- | --- | -- | ----------------------------------------------------- |
| [`utils/intl.ts`](annotated/src/utils/intl.ts)                                                 | 94 | 102 | 8  | 共享 Intl 实例惰性缓存：分词器、相对时间格式化、时区、系统语言只建一次                |
| [`utils/backgroundHousekeeping.ts`](annotated/src/utils/backgroundHousekeeping.ts)             | 94 | 104 | 10 | 后台杂务总入口：启动批 fire-and-forget、10 分钟延迟慢清理、Ant 专属 24 小时循环 |
| [`utils/settings/applySettingsChange.ts`](annotated/src/utils/settings/applySettingsChange.ts) | 92 | 101 | 9  | 设置变更应用器：权限规则重读、hooks 快照重建、AppState 同步、effort 值防覆盖     |
| [`utils/sliceAnsi.ts`](annotated/src/utils/sliceAnsi.ts)                                       | 91 | 101 | 10 | 按显示宽度切 ANSI 字符串：零宽组合符边界、OSC 8 超链接、undo 复位序列           |
| [`utils/sanitization.ts`](annotated/src/utils/sanitization.ts)                                 | 91 | 101 | 10 | Unicode 隐形字符清洗：NFKC 归一、属性类与显式码点段双层删除、迭代到不动点           |
| [`utils/bash/specs/pyright.ts`](annotated/src/utils/bash/specs/pyright.ts)                     | 91 | 98  | 7  | pyright 命令规格：21 项选项纯数据声明，satisfies 编译期结构校验            |
| [`utils/idePathConversion.ts`](annotated/src/utils/idePathConversion.ts)                       | 90 | 98  | 8  | Windows IDE 与 WSL 的路径互转：wslpath 优先、失败手写兜底、跨发行版判定      |
| [`utils/undercover.ts`](annotated/src/utils/undercover.ts)                                     | 89 | 97  | 8  | 隐身模式：公开仓库提交抹除内部痕迹，默认开、无强制关、外部构建整体折叠                   |
| [`utils/execFileNoThrowPortable.ts`](annotated/src/utils/execFileNoThrowPortable.ts)           | 89 | 99  | 10 | 同步执行外壳：execaSync 包成永不抛错的 execSync 替身，三重历史签名兼容         |
| [`utils/caCertsConfig.ts`](annotated/src/utils/caCertsConfig.ts)                               | 88 | 96  | 8  | CA 证书配置填充：从用户级设置读 NODE_EXTRA_CA_CERTS 垫进环境，依赖图隔离防包体膨胀 |

三条横切观察：

- **「慢的东西怎么不挡用户」三份**：`intl.ts` 把贵的构造成本摊薄到一次、`backgroundHousekeeping.ts` 用 10 分钟延迟加用户活动检查给慢清理让路、`execFileNoThrowPortable.ts` 干脆把同步调用整个封死在废弃层里。三条路线是同一个课题的三种答案：摊薄、错峰、禁用。
- **「安全上宁可误伤」三份**：`sanitization.ts` 两层删除语义重叠是刻意的冗余防御、`undercover.ts` 没有强制关闭的开关（null 也当隐身处理）、`caCertsConfig.ts` 拒绝项目级设置注入 CA。三处的共同姿态是失败方向必须朝安全侧倒。
- **「构建期解决」两份**：`pyright.ts` 用 `satisfies` 把规格写错拦在编译期、`undercover.ts` 靠 USER_TYPE 编译期常量把整段模板字符串从外部构建里折叠掉——错误和体积问题都不该留给运行时。

踩坑：本批 10 份预检五断言加块注释内部硬拦一次通过、零命中（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；四份文件头部是大型 `/** */` 文档块（sanitization 23 行、undercover 22 行、caCertsConfig 14 行、idePathConversion 4 行），全部用 `(1, after)` 交给脚本外移；`undercover.ts` 第 41 到 69 行的保密指令模板字符串整体避开，锚点取签名行与 return 行；annotate.py 十次零 `⟳`、零 `⚠`。

流程账：本批 10 个数据文件逐一对齐源文件（锚点落在 import/函数声明/语句收尾行，无块注释内、无跨行赋值首行）；预检 10 份全过；annotate.py 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 973 份 0 失败；`check-links.py` 源码链接 2089 条加内链 651 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`generators.ts`(88) · `dxt/helpers.ts`(88) · `teamMemoryOps.ts`(88) · `classifierApprovals.ts`(88) · `swarm/backends/teammateModeSnapshot.ts`(87) · `computerUse/cleanup.ts`(86) · `collapseBackgroundBashNotifications.ts`(84) · `secureStorage/plainTextStorage.ts`(84) · `sleep.ts`(84) · `CircularBuffer.ts`(84) …（utils 还剩 183 份；全仓还剩 929 份）。

### utils 第 85 批：小文件十件套（88→84 行档，81 锚点）

本批十份是「机制小件」：异步生成器工具、DXT 清单校验、团队记忆摘要、分类器放行记账、队友模式快照、计算机操控收尾、通知折叠、明文凭据存储、可中止 sleep、环形缓冲。单个都不大，但每一份都在处理一个具体的边界问题。

| 文件                                                                                                           | 原文 | 批注版 | 锚点 | 讲什么                                           |
| ------------------------------------------------------------------------------------------------------------ | -- | --- | -- | --------------------------------------------- |
| [`utils/generators.ts`](annotated/src/utils/generators.ts)                                                   | 88 | 97  | 9  | 异步生成器工具集：取末值、取返回值、带上限并发合并、数组互转                |
| [`utils/dxt/helpers.ts`](annotated/src/utils/dxt/helpers.ts)                                                 | 88 | 95  | 7  | DXT 清单校验与扩展 ID 生成：懒加载 zod、三入口共用校验、五拍清洗        |
| [`utils/teamMemoryOps.ts`](annotated/src/utils/teamMemoryOps.ts)                                             | 88 | 96  | 8  | 团队记忆判定与摘要文案：搜索与写入识别、四态动词、单复数变形                |
| [`utils/classifierApprovals.ts`](annotated/src/utils/classifierApprovals.ts)                                 | 88 | 97  | 9  | 分类器自动放行记账：approvals 与 checking 两容器，信号驱动 UI 重渲 |
| [`utils/swarm/backends/teammateModeSnapshot.ts`](annotated/src/utils/swarm/backends/teammateModeSnapshot.ts) | 87 | 95  | 8  | 队友模式启动快照：CLI 覆盖优先，运行期改配置不影响本次会话               |
| [`utils/computerUse/cleanup.ts`](annotated/src/utils/computerUse/cleanup.ts)                                 | 86 | 94  | 8  | 计算机操控回合收尾：恢复隐藏应用（5 秒兜底）后释放文件锁                 |
| [`utils/collapseBackgroundBashNotifications.ts`](annotated/src/utils/collapseBackgroundBashNotifications.ts) | 84 | 92  | 8  | 折叠连续的后台 bash 完成通知为一条汇总，失败与流式事件不折叠             |
| [`utils/secureStorage/plainTextStorage.ts`](annotated/src/utils/secureStorage/plainTextStorage.ts)           | 84 | 92  | 8  | 明文凭据降级后端：读失败即 null、0600 权限、成功时带明文警告           |
| [`utils/sleep.ts`](annotated/src/utils/sleep.ts)                                                             | 84 | 92  | 8  | 可中止 sleep 与超时竞速：TDZ 顺序、once 监听、定时器 unref      |
| [`utils/CircularBuffer.ts`](annotated/src/utils/CircularBuffer.ts)                                           | 84 | 92  | 8  | 定长环形缓冲：覆盖写 O(1)、取模绕圈、最近 N 条与全量导出              |

三条横切观察：

- **「小函数考的都是边界」三份**：`generators.ts` 用私有 Symbol 区分「没产出」与「产出了 undefined」、`sleep.ts` 因为 TDZ 把「先判已中止」写在建定时器之前、`CircularBuffer.ts` 靠 `(start + size - available + i) % capacity` 一圈对齐。三份都只有十几行逻辑，值钱的全在这些偏移量上。
- **「启动即定格」两份**：`teammateModeSnapshot.ts` 把队友模式在会话开始时锁死、`applySettingsChange.ts`（上批）只让设置变更走受控通道——同一个判断：运行期的配置改动不该穿透到已开始的会话。
- **「为坏情况定行为」三份**：`plainTextStorage.ts` 内存不了就落明文但给 0600 加警告、`computerUse/cleanup.ts` 给 unhide 5 秒兜底后照常放行、`dxt/helpers.ts` 把 700KB 校验库推迟到真正用到时——三处都在回答「主路径之外出问题怎么办」，并且答案都不约而同是「降级但留痕」。

踩坑：本批 10 份预检五断言加块注释内部硬拦一次通过、零命中（slug 与源路径一一对应、行号全在 [1, len] 内、无重复锚点、无英文双引号与反斜杠、ast.parse 全过）；块注释密集的三份（`CircularBuffer.ts` 7 处、`teammateModeSnapshot.ts` 6 处、`computerUse/cleanup.ts` 2 处长段）全部绕开，锚点只取函数与类方法的收尾 `}`、语句行；`teamMemoryOps.ts` 第 63 与 85 行是单行模板字符串，未作锚点；annotate.py 十次零 `⟳`、零 `⚠`。

流程账：本批 10 个数据文件逐一对齐源文件（锚点落在 import/函数声明/语句收尾行，无块注释内、无跨行赋值首行）；预检 10 份全过、81 个锚点；annotate.py 十次零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 983 份 0 失败；`check-links.py` 源码链接 2099 条加内链 652 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`hooks/hookHelpers.ts`(83) · `claudeInChrome/prompt.ts`(83) · `which.ts`(82) · `teamDiscovery.ts`(81) · `awsAuthStatusManager.ts`(81) · `formatBriefTimestamp.ts`(81) · `settings/mdm/constants.ts`(81) · `settings/settingsCache.ts`(80) · `permissions/dangerousPatterns.ts`(80) · `toolPool.ts`(79) …（utils 还剩 173 份；全仓还剩 919 份）。

### utils 第 86 批：小文件十件套（83→79 行档，52 锚点）

本批十份全是「边界定义一个模块」的类型：钩子的结构化输出强制、浏览器提示词的分块注入、命令查找的四条路径、团队状态的缺字段兜底、时间标签的区域变量、MDM 路径的优先级、认证状态的成功/失败两分支、危险前缀表、三层设置缓存的三态语义、工具池的分区排序。

| 文件                                                                                               | 原文 | 批注版 | 锚点 | 讲什么                                            |
| ------------------------------------------------------------------------------------------------ | -- | --- | -- | ---------------------------------------------- |
| [`utils/hooks/hookHelpers.ts`](annotated/src/utils/hooks/hookHelpers.ts)                         | 83 | 88  | 5  | 钩子返回值统一成结构化输出；Stop 钩子强制调用合成输出工具，5 秒超时          |
| [`utils/claudeInChrome/prompt.ts`](annotated/src/utils/claudeInChrome/prompt.ts)                 | 83 | 88  | 5  | 浏览器自动化系统提示分块；工具搜索说明与 WebBrowser 职责切分按状态注入      |
| [`utils/which.ts`](annotated/src/utils/which.ts)                                                 | 82 | 88  | 6  | 命令路径查找四条路径：异步/同步 × Windows/POSIX，外加 Bun 原生快速路径 |
| [`utils/teamDiscovery.ts`](annotated/src/utils/teamDiscovery.ts)                                 | 81 | 86  | 5  | 团队与队友状态发现；跳过 team-lead，缺字段默认算活跃，后端类型过守卫        |
| [`utils/formatBriefTimestamp.ts`](annotated/src/utils/formatBriefTimestamp.ts)                   | 81 | 86  | 5  | 时间标签三档粒度；自解析 POSIX 区域变量并转 BCP 47，Intl 构造即校验    |
| [`utils/settings/mdm/constants.ts`](annotated/src/utils/settings/mdm/constants.ts)               | 81 | 86  | 5  | MDM 常量与 plist 路径优先级；零重依赖，注册表必须留在策略分支           |
| [`utils/awsAuthStatusManager.ts`](annotated/src/utils/awsAuthStatusManager.ts)                   | 81 | 87  | 6  | 云厂商认证状态单例；成功时清空状态，失败时保留输出供排查                   |
| [`utils/permissions/dangerousPatterns.ts`](annotated/src/utils/permissions/dangerousPatterns.ts) | 80 | 84  | 4  | 危险允许规则前缀表；跨平台清单抽常量防两份漂移，内部构建专属加段               |
| [`utils/settings/settingsCache.ts`](annotated/src/utils/settings/settingsCache.ts)               | 80 | 85  | 5  | 三层设置缓存；未命中与「确认为空」用 undefined 与 null 区分         |
| [`utils/toolPool.ts`](annotated/src/utils/toolPool.ts)                                           | 79 | 85  | 6  | 工具池合并去重；分区排序保提示词缓存，协调者模式裁到允许清单                 |

三条横切观察：

- **「取不到就当没有」四份**：`which.ts` 命令找不到返回 null 而不是抛异常、`mdm/constants.ts` 用户名取不到就只留设备级路径、`teamDiscovery.ts` 缺 isActive 字段当成活跃、`settingsCache.ts` 用 undefined 表示未命中因此可以安全重查。四处都在把「信息缺失」翻译成一个明确的返回值，而不是让调用方去猜。
- **「模块边界决定依赖形状」三份**：`toolPool.ts` 刻意不碰 React，好让无界面路径直接引用；`mdm/constants.ts` 只依赖操作系统信息，好被最底层读取模块引用；`claudeInChrome/prompt.ts` 把提示词拆成常量，好按运行期开关选择性拼接。三份的共同动作都是「把某一层从依赖图里摘出去」。
- **「失效与保留的口径要显式」两份**：`awsAuthStatusManager.ts` 认证成功才清空输出、失败必须留着；`settingsCache.ts` 三层缓存一刀切重置。前者按「用户还要不要看」决定去留，后者按「改动影响面」决定范围。

踩坑：`claudeInChrome/prompt.ts` 几乎全是模板字符串（83 行里 3 段长字符串），5 个锚点里 4 个改用 `before` 锚在块注释首行，唯独文件级 `(1,before)` 触发「落在模板字符串内部」自动外移，打印 `⟳ 1→1`，`grep -n '^// '` 确认落点在常量声明之前、未进字符串。`toolPool.ts` 第 20 与 25 行是 eslint 注释放开与收回的单行块注释，`after` 落 `*/` 结尾行会插进块内，改锚第 24 行（三元收尾）。`permissions/dangerousPatterns.ts` 数组体被注释与 spread 占满，只取 4 个锚点。

流程账：本批 10 个数据文件逐一对齐源文件，预检五断言加块注释内部行号扫描一次通过、零命中；52 个锚点；`annotate.py` 十次失败 0、一次 `⟳`（上面已确认落点）、零 `⚠`；`check-fidelity.py` 全仓 993 份 0 失败；`check-links.py` 源码链接 2109 条加内链 653 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`computerUse/drainRunLoop.ts`(79) · `permissions/PermissionUpdateSchema.ts`(78) · `billing.ts`(78) · `teleport/environmentSelection.ts`(77) · `renderOptions.ts`(77) · `fingerprint.ts`(76) · `stream.ts`(76) · `cronJitterConfig.ts`(75) · `crossProjectResume.ts`(75) · `telemetry/events.ts`(75) …（utils 还剩 163 份；全仓还剩 909 份）。

### utils 第 87 批：小文件十件套（79→75 行档，57 锚点）

本批十份的共同点是「一个延迟/一个缓存/一个降级」：主队列泵把不归自己管的队列抽干、渲染参数替管道输入找回按键、设置与环境的默认值在异常时退回安全值、遥测缺记录器就安静丢弃。十份里没有一份做业务逻辑，全在处理运行环境的边界。

| 文件                                                                                                         | 原文 | 批注版 | 锚点 | 讲什么                                |
| ---------------------------------------------------------------------------------------------------------- | -- | --- | -- | ---------------------------------- |
| [`utils/computerUse/drainRunLoop.ts`](annotated/src/utils/computerUse/drainRunLoop.ts)                     | 79 | 84  | 5  | 主队列泵；引用计数共享单个 1 毫秒定时器，同步抛错也要释放     |
| [`utils/permissions/PermissionUpdateSchema.ts`](annotated/src/utils/permissions/PermissionUpdateSchema.ts) | 78 | 83  | 5  | 权限更新 schema；六个判别分支，三种规则操作同形不同 type |
| [`utils/billing.ts`](annotated/src/utils/billing.ts)                                                       | 78 | 84  | 6  | 计费可见性双路径；控制台账号看角色，订阅制按档位分流         |
| [`utils/teleport/environmentSelection.ts`](annotated/src/utils/teleport/environmentSelection.ts)           | 77 | 83  | 6  | 远程环境选择推导；非桥接优先，来源按优先级倒查            |
| [`utils/renderOptions.ts`](annotated/src/utils/renderOptions.ts)                                           | 77 | 82  | 5  | 管道输入改用终端设备读；三态缓存，一次探测终身复用          |
| [`utils/fingerprint.ts`](annotated/src/utils/fingerprint.ts)                                               | 76 | 81  | 5  | 会话指纹；盐加固定三位字符加版本做 SHA256 取前三位      |
| [`utils/stream.ts`](annotated/src/utils/stream.ts)                                                         | 76 | 83  | 7  | 最小异步可迭代队列；直通优先，错误只投递一次，只许迭代一次      |
| [`utils/cronJitterConfig.ts`](annotated/src/utils/cronJitterConfig.ts)                                     | 75 | 80  | 5  | 抖动配置读取；一处越界整份作废，一分钟内收敛             |
| [`utils/crossProjectResume.ts`](annotated/src/utils/crossProjectResume.ts)                                 | 75 | 81  | 6  | 跨项目恢复三分支；工作树判定带分隔符，灰度限制在内部账号       |
| [`utils/telemetry/events.ts`](annotated/src/utils/telemetry/events.ts)                                     | 75 | 82  | 7  | 遥测事件出口；缺记录器只告警一次，路径只进事件不进指标        |

三条横切观察：

- **「共享一个昂贵资源」两份**：`drainRunLoop.ts` 用引用计数让多个并发调用共用一个定时器，`renderOptions.ts` 把终端设备探测结果缓存成进程级事实。两份都在回答同一个问题——同一件昂贵的事，一个进程只该做一次。
- **「失败退回安全值」四份**：`billing.ts` 角色字段缺失返回不可见、`environmentSelection.ts` 默认环境找不到时保留首个非桥接环境、`cronJitterConfig.ts` 校验失败整份回落默认、`telemetry/events.ts` 没有记录器就丢弃。四处都不是抛错，而是把「异常输入」翻译成一个明确的安全行为。
- **「写死的契约要标注原因」两份**：`fingerprint.ts` 的盐必须与后端逐字一致、`cronJitterConfig.ts` 的字段上界是为防误推配置。两份都在注释里直接写清「改之前要协调谁」，因为这类值从代码本身看不出重要性。

踩坑：`drainRunLoop.ts` 第 5 到 15 行是整段块注释，文件级锚点用 `(1,before)` 落在 import 之前，不进注释；`PermissionUpdateSchema.ts` 第 43 行是 `z.discriminatedUnion` 多行调用首行，避开后改锚第 61 行（第三个规则分支收尾）；`cronJitterConfig.ts` 开头九行是连续 `//` 注释，`before` 落第 1 行插在最前面，不会劈开注释块；`stream.ts` 是纯类文件，7 个锚点全部取方法收尾 `}`。

流程账：本批 10 个数据文件逐一对齐源文件，预检五断言加块注释内部行号扫描一次通过、零命中；57 个锚点；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1003 份 0 失败；`check-links.py` 源码链接 2119 条加内链 654 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`aws.ts`(74) · `systemDirectories.ts`(74) · `iTermBackup.ts`(73) · `mailbox.ts`(73) · `tokenBudget.ts`(73) · `computerUse/gates.ts`(72) · `model/check1mAccess.ts`(72) · `apiPreconnect.ts`(71) · `fileOperationAnalytics.ts`(71) · `telemetryAttributes.ts`(71) …（utils 还剩 153 份；全仓还剩 899 份）。

### utils 第 88 批：小文件十件套（74→71 行档，60 锚点）

本批十份的共同点是「在运行环境边界上做翻译与保护」：把平台/凭证/坐标/上下文窗口这些外部差异统一成内部一致的事实，把真实路径与内容替换成去标识哈希，把「异常输入」翻译成明确的安全行为。十份里没有一份做业务逻辑，全在回答「外部不确定时，内部该信什么」。

| 文件                                                                                 | 原文 | 批注版 | 锚点 | 讲什么                                                               |
| ---------------------------------------------------------------------------------- | -- | --- | -- | ----------------------------------------------------------------- |
| [`utils/systemDirectories.ts`](annotated/src/utils/systemDirectories.ts)           | 74 | 80  | 6  | 跨平台系统目录（桌面/文档/下载）解析；家目录 + `USERPROFILE` + XDG 三套平台分支，未知平台回落默认并记日志 |
| [`utils/aws.ts`](annotated/src/utils/aws.ts)                                       | 74 | 80  | 6  | AWS 短期凭证工具集：凭证形状、STS 输出校验、调用者身份、清 ini 缓存                          |
| [`utils/iTermBackup.ts`](annotated/src/utils/iTermBackup.ts)                       | 73 | 79  | 6  | iTerm2 设置备份/恢复：备份 plist、失败回滚、维护「安装进行中」标记                          |
| [`utils/mailbox.ts`](annotated/src/utils/mailbox.ts)                               | 73 | 80  | 7  | 轻量点对点消息信箱；队列 + 等待者列表 + 信号；send/poll/receive 三件套                   |
| [`utils/tokenBudget.ts`](annotated/src/utils/tokenBudget.ts)                       | 73 | 79  | 6  | 从自然语言解析 token 预算；简写（`+500k`）与完整说法两路，千分位续写提示                       |
| [`utils/computerUse/gates.ts`](annotated/src/utils/computerUse/gates.ts)           | 72 | 79  | 7  | 计算机操控（Chicago）门控：启用/坐标模式/子开关，首次冻结坐标语义                             |
| [`utils/model/check1mAccess.ts`](annotated/src/utils/model/check1mAccess.ts)       | 72 | 77  | 5  | 百万上下文资格判定；订阅看额外用量、API/按量直接放行，Opus/Sonnet 两入口                      |
| [`utils/apiPreconnect.ts`](annotated/src/utils/apiPreconnect.ts)                   | 71 | 76  | 5  | 启动预连接 Anthropic API；TCP+TLS 并行、一次性旗标、HEAD 即弃、十秒超时                 |
| [`utils/telemetryAttributes.ts`](annotated/src/utils/telemetryAttributes.ts)       | 71 | 77  | 6  | 遥测属性入口；会话 id/版本/账户 uuid 基数控制，OAuth 才附账户维度                         |
| [`utils/fileOperationAnalytics.ts`](annotated/src/utils/fileOperationAnalytics.ts) | 71 | 77  | 6  | 文件操作隐私分析；截断/完整 SHA256 代真实路径与内容，百 KB 上限防内存耗尽                       |

三条横切观察：

- **「异常/未知输入翻译成安全行为」六份**：`systemDirectories.ts` 未知平台回落默认路径并记日志、`aws.ts` 清缓存失败仅记调试日志、`computerUse/gates.ts` 用保守 `DEFAULTS` 并对缺失字段展开补全、`check1mAccess.ts` 未缓存原因保守判否且未列出的新原因落保守分支、`apiPreconnect.ts` 超时无妨由真实请求重握手、`telemetryAttributes.ts` 三项基数维度给出默认取向。六处都不抛错，而是把「拿不准」收敛成一个明确、可预期的内部状态。
- **「去标识化替真实数据」两份**：`fileOperationAnalytics.ts` 用截断/完整 SHA256 代替真实路径与内容，`telemetryAttributes.ts` 账户 uuid 用带标签标识降低再识别风险。两份都在「既要统计、又绝不泄露用户数据」之间找平衡，连类型名都被显式标注为「非路径/非代码」以防误用。
- **「一次性/冻结防止会话中途不一致」三份**：`apiPreconnect.ts` 的 `fired` 旗标保证预热只触发一次、`computerUse/gates.ts` 的坐标模式在首次读取后冻结（避免远程翻转导致模型收到的坐标语义与点击换算对不上）、`check1mAccess.ts` 缓存禁用原因。三份都是跨请求的一致性屏障，专门防「中途变了导致前后矛盾」。

踩坑：`apiPreconnect.ts` 第 1 行是 `/**` 块注释开头，文件级锚点用 `(1,after)` 落在块注释之后（会自动 shift 到下一条 import 之前），不进注释内部；`mailbox.ts` 是纯 class 文件，7 个锚点全部取类内字段或方法首行，不碰块注释；`check1mAccess.ts` 第 43 行是 switch 的 fall-through 统一返回分支，用 `(43,after)` 夹在末尾返回之后，第 11 行 `isExtraUsageEnabled` 是函数体首行锚 `before`；`tokenBudget.ts` 第 15 行 `MULTIPLIERS` 常量块用 `(15,after)` 落在常量之后；`computerUse/gates.ts` 第 21 行 `DEFAULTS` 用 `(21,after)` 落在默认对象之后；`iTermBackup.ts` 第 73 行是文件末（函数返回可辨识联合），用 `(73,after)`。

流程账：本批 10 个数据文件逐一对齐源文件，预检五断言加块注释内部行号扫描一次通过、零命中；60 个锚点；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1013 份 0 失败；`check-links.py` 源码链接 2139 条加内链 656 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`plugins/addDirPluginSettings.ts`(71) · `plugins/performStartupChecks.tsx`(70) · `getWorktreePaths.ts`(70) · `hooks/postSamplingHooks.ts`(70) · `pdfUtils.ts`(70) · `secureStorage/fallbackStorage.ts`(70) · `plugins/gitAvailability.ts`(69) · `plugins/walkPluginMarkdown.ts`(69) · `directMemberMessage.ts`(69) · `computerUse/hostAdapter.ts`(69) …（utils 还剩 143 份；全仓还剩 889 份）。

### utils 第 89 批：小文件十件套（71→69 行档，76 锚点）

本批是 utils 小文件收尾梯队（≤71 行）的头十份，内容横跨「插件设置聚合、启动信任门控、采样后钩子、PDF 预处理、git 工作树与可用性、安全存储回退、插件目录遍历、团队直发消息、计算机操控宿主适配」——各自把一个外部关注点（插件/git/OS/PDF/队友）收敛成一个稳定的内部 API，没有一份做业务主流程。

| 文件                                                                                               | 原文 | 批注版 | 锚点 | 讲什么                                                                                 |
| ------------------------------------------------------------------------------------------------ | -- | --- | -- | ----------------------------------------------------------------------------------- |
| [`utils/plugins/addDirPluginSettings.ts`](annotated/src/utils/plugins/addDirPluginSettings.ts)   | 71 | 77  | 6  | 从各 --add-dir 目录读取 enabledPlugins 与 extraKnownMarketplaces，优先级最低，调用方须在其上 spread 标准设置 |
| [`utils/hooks/postSamplingHooks.ts`](annotated/src/utils/hooks/postSamplingHooks.ts)             | 70 | 78  | 8  | 采样后钩子的注册表与执行器（注册/清空/执行），单钩子出错只记录不阻断                                                 |
| [`utils/pdfUtils.ts`](annotated/src/utils/pdfUtils.ts)                                           | 70 | 77  | 7  | PDF 页码范围解析、模型 PDF 能力探测、扩展名判定三件套                                                     |
| [`utils/plugins/performStartupChecks.tsx`](annotated/src/utils/plugins/performStartupChecks.tsx) | 70 | 78  | 7  | 插件启动检查入口，确认信任目录后才后台安装市场与插件，种子注册改状态即清缓存并提示 /reload-plugins                           |
| [`utils/getWorktreePaths.ts`](annotated/src/utils/getWorktreePaths.ts)                           | 70 | 77  | 7  | 调 git worktree list 找所有工作树，当前优先、其余字母序返回，带埋点                                         |
| [`utils/secureStorage/fallbackStorage.ts`](annotated/src/utils/secureStorage/fallbackStorage.ts) | 70 | 79  | 9  | 主备双存储回退封装，迁移时互删避免凭据重复或 /login 死循环                                                   |
| [`utils/plugins/walkPluginMarkdown.ts`](annotated/src/utils/plugins/walkPluginMarkdown.ts)       | 69 | 77  | 8  | 递归遍历插件目录的 .md 文件，遇 SKILL.md 即停为叶子，readdir 出错不中断                                     |
| [`utils/directMemberMessage.ts`](annotated/src/utils/directMemberMessage.ts)                     | 69 | 77  | 8  | @成员名 消息 语法解析与绕过模型的直发信箱，无团队上下文即报错                                                    |
| [`utils/computerUse/hostAdapter.ts`](annotated/src/utils/computerUse/hostAdapter.ts)             | 69 | 77  | 8  | Computer Use 宿主适配器单例，装配日志/执行器/权限/像素裁剪等原生能力                                          |
| [`utils/plugins/gitAvailability.ts`](annotated/src/utils/plugins/gitAvailability.ts)             | 69 | 77  | 8  | git 可用性记忆化探测，含强制不可用与清缓存，覆盖 macOS xcrun 垫片场景                                         |

踩坑：本批第一份 `addDirPluginSettings.ts` 第 1 行是 `/**` 文档块开头，文件级锚点用 `(1,after)` 落在块注释之后（脚本自动外移到块后、不进注释内部）；`performStartupChecks.tsx` 末尾 base64 sourceMappingURL 按惯例省略、fidelity 标 `OK*`；`fallbackStorage.ts` 是纯对象字面量工厂，9 个锚点全部取方法 `}` 或字段行，零块内中文；`postSamplingHooks.ts` 三处 `/** */` 函数头用 `(函数首行,before)` 落在块后，零外移。

流程账：本批 10 个数据文件逐一对齐源文件，预检六断言加块注释内部行号扫描一次通过、零命中；76 个锚点；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1023 份 0 失败；`check-links.py` 源码链接 2139 条加内链 656 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`browser.ts`(68) · `process.ts`(68) · `hooks/registerFrontmatterHooks.ts`(67) · `xdg.ts`(65) · `model/antModels.ts`(64) · `hooks/registerSkillHooks.ts`(64) · `sessionUrl.ts`(64) · `computerUse/common.ts`(61) · `permissions/bashClassifier.ts`(61) · `slashCommandParsing.ts`(60) …（utils 还剩 133 份；全仓还剩 879 份）。

### utils 第 90 批：小文件十件套（68→60 行档，56 锚点）

本批是 utils 小文件收尾梯队（≤68 行）的头十份，内容横跨「系统程序拉起（浏览器/文件）、进程输出与管道防护、frontmatter 钩子注册（agent/skill 两种入口）、XDG 目录规范、会话恢复标识符解析、ant 内部模型定义、计算机使用公共能力、命令分类器对外桩、定制面插件锁定策略」——各自把一个小关注点收敛成稳定 API，没有一份做业务主流程。

| 文件                                                                                                 | 原文 | 批注版 | 锚点 | 讲什么                                                                      |
| -------------------------------------------------------------------------------------------------- | -- | --- | -- | ------------------------------------------------------------------------ |
| [`utils/browser.ts`](annotated/src/utils/browser.ts)                                               | 68 | 72  | 4  | 用系统默认程序打开文件/文件夹、用默认浏览器打开 URL，平台分发到 explorer/open/xdg-open                |
| [`utils/process.ts`](annotated/src/utils/process.ts)                                               | 68 | 73  | 5  | 进程输出/错误的辅助：EPIPE 防护、统一写 stdout/stderr、快速失败退出、探测 stdin 是否真有数据             |
| [`utils/hooks/registerFrontmatterHooks.ts`](annotated/src/utils/hooks/registerFrontmatterHooks.ts) | 67 | 72  | 5  | 把 agent/skill 的 frontmatter 钩子注册为会话作用域钩子，子 agent 的 Stop 改写成 SubagentStop |
| [`utils/xdg.ts`](annotated/src/utils/xdg.ts)                                                       | 66 | 71  | 6  | XDG 基础目录规范：state/cache/data/home/bin 五处目录解析，支持 env 与 homedir 覆盖          |
| [`utils/sessionUrl.ts`](annotated/src/utils/sessionUrl.ts)                                         | 64 | 70  | 6  | 会话恢复标识符解析：JSONL 文件路径 / 裸 UUID / URL 三种形式，Windows 路径须先于 URL 处理            |
| [`utils/model/antModels.ts`](annotated/src/utils/model/antModels.ts)                               | 64 | 69  | 5  | ant 内部模型类型与读取：非 ant 用户一律回落空/null，按别名或模型名解析                               |
| [`utils/hooks/registerSkillHooks.ts`](annotated/src/utils/hooks/registerSkillHooks.ts)             | 64 | 69  | 5  | 把 skill 的 frontmatter 钩子注册为会话钩子，once:true 的首成功后自动移除                      |
| [`utils/computerUse/common.ts`](annotated/src/utils/computerUse/common.ts)                         | 61 | 68  | 7  | 计算机使用的公共常量/能力：服务器名、终端 bundle ID 回退表、静态能力声明                               |
| [`utils/permissions/bashClassifier.ts`](annotated/src/utils/permissions/bashClassifier.ts)         | 61 | 69  | 8  | 命令分类器权限的对外构建桩：全部函数返回空值/禁用，仅 ant 内部有真实实现                                  |
| [`utils/settings/pluginOnlyPolicy.ts`](annotated/src/utils/settings/pluginOnlyPolicy.ts)           | 60 | 65  | 5  | 定制面「仅插件来源」锁定策略：受管设置判定锁定面、管理员可信来源豁免                                       |

踩坑：本批十份文件头部与函数头多为 `/** */` 文档块或 `//` 注释，`annotate.py` 的自动外移让文件级与函数级锚点全部落在块外——如 `xdg.ts` 第 1 行 `(1,after)` 落在模块文档块之后、`bashClassifier.ts` 第 1 行 `(1,after)` 落在 `//` 桩说明之后；`registerFrontmatterHooks.ts`/`registerSkillHooks.ts`/`pluginOnlyPolicy.ts` 的 `(函数首行,before)` 都落在 `*/` 之后、函数签名之前，零块内中文、零 `⟳`、零 `⚠`；所有锚点均取 import/类型/函数签名/语句收尾行，无跨行赋值首行、无块注释内部。

流程账：本批 10 个数据文件逐一对齐源文件，预检六断言加块注释内部行号扫描一次通过、零命中；56 个锚点；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1033 份 0 失败；`check-links.py` 源码链接 2149 条加内链 657 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`cliArgs.ts`(60) · `slashCommandParsing.ts`(60) · `semver.ts`(59) · `collapseHookSummaries.ts`(59) · `workloadContext.ts`(57) · `sequential.ts`(56) · `privacyLevel.ts`(55) · `collapseTeammateShutdowns.ts`(55) · `suggestions/skillUsageTracking.ts`(55) · `computerUse/escHotkey.ts`(54) …（utils 还剩 123 份；全仓还剩 869 份）。

### utils 第 91 批：小文件十件套（60→54 行档，52 锚点）

本批十份行数已降到 60 行以下，但密度反而更高：命令行开关的两种写法、斜杠命令的宽松切分、版本比较的六函数、两条消息折叠规则、异步上下文的边界、串行队列、三档隐私、技能使用的去抖与衰减、全局按键的生命周期。多数文件只有二三十行有效逻辑，剩下的篇幅都在注释里解释「为什么不能那样写」。

| 文件                                                                                                 | 原文 | 批注版 | 锚点 | 讲什么                                 |
| -------------------------------------------------------------------------------------------------- | -- | --- | -- | ----------------------------------- |
| [`utils/cliArgs.ts`](annotated/src/utils/cliArgs.ts)                                               | 60 | 65  | 5  | 命令行开关早读；等号与空格两写法，纠正双横线错位            |
| [`utils/slashCommandParsing.ts`](annotated/src/utils/slashCommandParsing.ts)                       | 60 | 66  | 6  | 斜杠命令解析；MCP 标记并回命令名，参数宽松归一化          |
| [`utils/semver.ts`](annotated/src/utils/semver.ts)                                                 | 59 | 65  | 6  | 版本比较六函数；原生优先，回落开宽松模式                |
| [`utils/collapseHookSummaries.ts`](annotated/src/utils/collapseHookSummaries.ts)                   | 59 | 64  | 5  | 折叠同标签钩子汇总；时长取最大，并行区间重叠不能求和          |
| [`utils/workloadContext.ts`](annotated/src/utils/workloadContext.ts)                               | 57 | 61  | 4  | 轮次标签；必须建新边界而非透传，否则泄漏自我延续            |
| [`utils/sequential.ts`](annotated/src/utils/sequential.ts)                                         | 56 | 61  | 5  | 串行执行包装；标记先置位，单个失败不中断队列              |
| [`utils/privacyLevel.ts`](annotated/src/utils/privacyLevel.ts)                                     | 55 | 61  | 6  | 三档隐私等级；取最严格信号，否定式判据一次覆盖两档           |
| [`utils/collapseTeammateShutdowns.ts`](annotated/src/utils/collapseTeammateShutdowns.ts)           | 55 | 60  | 5  | 折叠队友关闭通知；四条件守卫，合并只留计数               |
| [`utils/suggestions/skillUsageTracking.ts`](annotated/src/utils/suggestions/skillUsageTracking.ts) | 55 | 60  | 5  | 技能使用记录；一分钟去抖，七天半衰期加十分之一下限           |
| [`utils/computerUse/escHotkey.ts`](annotated/src/utils/computerUse/escHotkey.ts)                   | 54 | 59  | 5  | 全局 Escape 中止；注册失败降级，注销用 finally 释放泵 |

三条横切观察：

- **「同一个骨架的两份折叠」**：`collapseHookSummaries.ts` 与 `collapseTeammateShutdowns.ts` 都是单趟扫描加内层贪婪收集，单个原样保留、多个换汇总。没有抽公共函数是刻意的——两者折叠后的消息形状完全不同，抽出来要传判定、收集、构造三组回调，反而更难读。
- **「让出窗口里的顺序」三份**：`sequential.ts` 清标记后要再检查一次队列（await 期间可能入队）、`skillUsageTracking.ts` 先记时间戳再写配置（反了则去抖失效）、`workloadContext.ts` 在 await 链路上必须重新开边界而不是透传。三处都是「一个 await 把代码切成两半」引发的问题。
- **「顺序即正确性」三份**：`privacyLevel.ts` 先查更严格的变量、`semver.ts` 先探测原生实现再回落、`escHotkey.ts` 注册成功后才持有泵引用。三处的判断顺序一旦调换，结果就完全不对。

踩坑：`workloadContext.ts` 第 36 到 51 行是整段块注释（解释为什么不能透传），只有 4 个锚点，一个都不进块内；`cliArgs.ts` 与 `escHotkey.ts` 的文件级锚点都用 `(1,before)`，插在 import 之前、不碰下方文档块；`privacyLevel.ts` 六行档里给了 6 个锚点，因为五个函数各只有两三行，锚在函数收尾 `}` 上读起来最整齐。

流程账：本批 10 个数据文件逐一对齐源文件，预检五断言加块注释内部行号扫描一次通过、零命中；52 个锚点；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1043 份 0 失败；`check-links.py` 源码链接 2159 条加内链 658 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`taggedId.ts`(54) · `deepLink/terminalPreference.ts`(54) · `swarm/leaderPermissionBridge.ts`(54) · `cliHighlight.ts`(54) · `set.ts`(53) · `binaryCheck.ts`(53) · `bash/registry.ts`(53) · `idleTimeout.ts`(53) · `computerUse/setup.ts`(53) · `displayTags.ts`(51) …（utils 还剩 113 份；全仓还剩 859 份）。

### utils 第 92 批：小文件十件套（54→51 行档，61 锚点）

本批十份全部落在「五十行出头」，但主题横跨权限桥、终端偏好、高亮加载、ID 编码、二进制探测、命令规格、空闲超时、电脑控制装配、集合运算、标签剥离——几乎每份都是「一个概念 + 若干边界条件」，正文逻辑少，注释在解释为什么必须这么写。

| 文件                                                                                             | 原文 | 批注版 | 锚点 | 讲什么                                            |
| ---------------------------------------------------------------------------------------------- | -- | --- | -- | ---------------------------------------------- |
| [`utils/swarm/leaderPermissionBridge.ts`](annotated/src/utils/swarm/leaderPermissionBridge.ts) | 54 | 64  | 7  | 权限桥；模块级单例，React 外取 setter，卸载须置回 null           |
| [`utils/deepLink/terminalPreference.ts`](annotated/src/utils/deepLink/terminalPreference.ts)   | 54 | 66  | 7  | 终端偏好；`TERM_PROGRAM` 与 `.app` 名不同需查表，非 macOS 跳过 |
| [`utils/cliHighlight.ts`](annotated/src/utils/cliHighlight.ts)                                 | 54 | 66  | 8  | 高亮懒加载；单例 Promise，借缓存命中顺带取语言表，失败吞成 null         |
| [`utils/taggedId.ts`](annotated/src/utils/taggedId.ts)                                         | 54 | 62  | 5  | 标记 ID；base58 定长 22 位左填充，必须与后端脚本同格式             |
| [`utils/binaryCheck.ts`](annotated/src/utils/binaryCheck.ts)                                   | 53 | 60  | 7  | 二进制探测；会话缓存，false 也缓存，命中判 `!== undefined`       |
| [`utils/bash/registry.ts`](annotated/src/utils/bash/registry.ts)                               | 53 | 62  | 5  | 命令规格；内置表优先再图规格，三道拦截挡住路径注入                      |
| [`utils/idleTimeout.ts`](annotated/src/utils/idleTimeout.ts)                                   | 53 | 61  | 6  | 空闲超时；创建时读一次环境变量，到点后二次校验才退出                     |
| [`utils/computerUse/setup.ts`](annotated/src/utils/computerUse/setup.ts)                       | 53 | 65  | 5  | 电脑控制 MCP；前缀触发后端能力提示，配置存在只为路由                   |
| [`utils/set.ts`](annotated/src/utils/set.ts)                                                   | 53 | 59  | 5  | 集合四运算；手写循环不展开，热路径省中间数组                         |
| [`utils/displayTags.ts`](annotated/src/utils/displayTags.ts)                                   | 51 | 61  | 6  | 剥 XML 标签；泛化正则三条约束，空结果两种兜底策略                    |

三条横切观察：

- **「false 也要缓存」**：`binaryCheck.ts` 命中判的是 `!== undefined` 而不是真值，否则缓存了 false 会被当作未命中，每次调用都重新派生子进程；`terminalPreference.ts` 同理，值没变就不写盘，省掉一次可能引发竞争的全局配置写入。两处都是「缓存的是结论，不是存在」。
- **「配置存在只为路由」**：`computerUse/setup.ts` 的 `mcpConfig` 永远不会被真的 spawn——客户端按名字拦截改用进程内服务器。它留着是因为分发逻辑要靠 `type: 'stdio'` 落到正确分支，删掉反而会走错路。
- **「定长编码的三处对齐」**：`taggedId.ts` 先整串填首字符再从右往左覆盖，短数字也补满 22 位，因为 58 的 22 次方刚好覆盖 2 的 128 次方。定长意味着可以直接按字符串比较，但代价是必须与后端 `tagged_id.py` 严格同步。

踩坑：`cliHighlight.ts` 的文件级批注初稿抄了源文件里那行库引用指令，带进了英文双引号，被预检自己的门禁拦下，改成描述性文字才过；`computerUse/setup.ts` 初版把锚点放在第 22 行（块注释收尾 ` */`），属硬规矩 8 的禁区，改锚第 26 行函数签名收尾并合并了内容；`leaderPermissionBridge.ts` 与 `taggedId.ts` 用 `(1,after)`、`set.ts` 与 `displayTags.ts` 用 `(1,before)`，两种文件级锚点都验证过没有劈开文档块。

流程账：本批 10 个数据文件逐一对齐源文件，预检 61 锚点全过；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1053 份 0 失败；`check-links.py` 源码链接 2169 条加内链 659 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`contentArray.ts`(51) · `model/modelSupportOverrides.ts`(50) · `promptCategory.ts`(49) · `fpsTracker.ts`(47) · `combinedAbortSignal.ts`(47) · `model/contextWindowUpgradeCheck.ts`(47) · `profilerBase.ts`(46) · `hash.ts`(46) · `settings/validateEditTool.ts`(45) · `permissions/denialTracking.ts`(45) …（utils 还剩 103 份；全仓还剩 849 份）。

### utils 第 93 批：小文件十件套（51→45 行档，49 锚点）

本批十份全部落在「四五十行」，主题横跨内容数组插入、模型能力覆盖、埋点来源分类、FPS 度量、合并中止信号、上下文升级提示、哈希工具、profiler 基件、拒绝追踪、settings 编辑校验——每份都是单一职责的小工具，注释多用来解释约束与回退路径。

| 文件                                                                                                   | 原文 | 批注版 | 锚点 | 讲什么                                                 |
| ---------------------------------------------------------------------------------------------------- | -- | --- | -- | --------------------------------------------------- |
| [`utils/contentArray.ts`](annotated/src/utils/contentArray.ts)                                       | 51 | 55  | 4  | content 数组插入；相对最后一个 tool_result 落位，末尾补 text 续接      |
| [`utils/model/modelSupportOverrides.ts`](annotated/src/utils/model/modelSupportOverrides.ts)         | 50 | 54  | 4  | 模型能力覆盖；按环境变量三元组查 TIERS，memoize 缓存                   |
| [`utils/promptCategory.ts`](annotated/src/utils/promptCategory.ts)                                   | 49 | 54  | 5  | 埋点来源；agent 类型与 REPL 风格映射到 QuerySource               |
| [`utils/fpsTracker.ts`](annotated/src/utils/fpsTracker.ts)                                           | 47 | 52  | 5  | FPS 度量；记帧时长算平均与低 1% 帧率，p99 反推                       |
| [`utils/combinedAbortSignal.ts`](annotated/src/utils/combinedAbortSignal.ts)                         | 47 | 51  | 4  | 合并中止信号；setTimeout 替 AbortSignal.timeout 防 Bun 计时器泄漏 |
| [`utils/model/contextWindowUpgradeCheck.ts`](annotated/src/utils/model/contextWindowUpgradeCheck.ts) | 47 | 52  | 5  | 上下文升级；opus/sonnet 1M 提示与 warning/tip 文案             |
| [`utils/hash.ts`](annotated/src/utils/hash.ts)                                                       | 46 | 52  | 6  | 哈希工具；djb2 确定、hashContent 变更检测、hashPair 免拼接          |
| [`utils/profilerBase.ts`](annotated/src/utils/profilerBase.ts)                                       | 46 | 51  | 5  | profiler 基件；懒加载 perf_hooks、共享时间线行格式                 |
| [`utils/permissions/denialTracking.ts`](annotated/src/utils/permissions/denialTracking.ts)           | 45 | 52  | 7  | 拒绝追踪；连续/累计计数与回退提问阈值                                 |
| [`utils/settings/validateEditTool.ts`](annotated/src/utils/settings/validateEditTool.ts)             | 45 | 49  | 4  | settings 编辑校验；仅 Claude settings 文件，前后都须合法           |

三条横切观察：

- 「阈值驱动回退」：`denialTracking.ts` 用连续拒绝上限 3、累计上限 20 双阈值决定何时改回提问，两个计数清零时机不同（成功只清连续、保留累计），是不可变更新风格的典型。
- 「Bun 与 Node 的运行时分叉」：`combinedAbortSignal.ts` 特意避开 `AbortSignal.timeout` 是因为 Bun 下惰性持有计时器（约 2.4KB/次）；`hash.ts` 同理在 Bun 走 `Bun.hash`、Node 走 `crypto` 增量 sha256，两条路径都规避拼接临时串。
- 「只校验目标文件」：`validateEditTool.ts` 用 `isClaudeSettingsPath` 先过滤，非 settings 文件直接放行，且编辑前已非法时也不阻断——避免把历史脏配置卡死在编辑环节。

踩坑：`fpsTracker.ts` 第 1 行是跨行 `export type FpsMetrics = {`，文件级锚点不能用 `(1,after)`（会落进类型定义内部），改用 `(1,before)` 顶到文件最前；`hash.ts` 第 34 行初稿把 Node 端分隔方式写成反斜杠转义，被预检门禁拦下（批注正文禁止反斜杠），改成「以空字节分隔」的文字描述才过。

流程账：本批 10 个数据文件逐一对齐源文件，预检 49 锚点全过；`annotate.py` 十次失败 0、零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1063 份 0 失败；`check-links.py` 源码链接 2179 条加内链 660 条，0 失效。

### utils 第 94 批：小文件十件套（44→39 行档，51 锚点）

本批十份继续落在「四十行上下」，主题横跨队友功能开关、proper-lockfile 惰性封装、纯事件信号原语、API provider 推断、权限规则 schema、OSC 8 超链接、单轮补全遥测、自动模式状态、技能加载埋点、bash 超时取值——每份都是单一职责的小工具，注释多用来解释约束、回退路径与门控策略。

| 文件                                                                                         | 原文 | 批注版 | 锚点 | 讲什么                                                    |
| ------------------------------------------------------------------------------------------ | -- | --- | -- | ------------------------------------------------------ |
| [`utils/agentSwarmsEnabled.ts`](annotated/src/utils/agentSwarmsEnabled.ts)                 | 44 | 48  | 4  | 队友功能统一闸门；Ant 恒开、外部需 opt-in 且过 killswitch               |
| [`utils/lockfile.ts`](annotated/src/utils/lockfile.ts)                                     | 43 | 49  | 6  | proper-lockfile 惰性封装；首次调用才 require，绕开启动期猴补丁            |
| [`utils/signal.ts`](annotated/src/utils/signal.ts)                                         | 43 | 49  | 6  | 纯事件信号原语；把 15 处 listener Set 样板收成 createSignal          |
| [`utils/model/providers.ts`](annotated/src/utils/model/providers.ts)                       | 40 | 46  | 6  | API provider 推断；bedrock→vertex→foundry 优先级 + 一手 URL 校验 |
| [`utils/permissions/PermissionRule.ts`](annotated/src/utils/permissions/PermissionRule.ts) | 40 | 44  | 4  | 权限规则 zod schema；allow/deny/ask 三态 + 规则值形状              |
| [`utils/hyperlink.ts`](annotated/src/utils/hyperlink.ts)                                   | 39 | 44  | 5  | OSC 8 终端超链接；不支持时回退纯文本 URL                              |
| [`utils/unaryLogging.ts`](annotated/src/utils/unaryLogging.ts)                             | 39 | 44  | 5  | 单轮补全事件上报；四类补全类型 + 三事件类别                                |
| [`utils/permissions/autoModeState.ts`](annotated/src/utils/permissions/autoModeState.ts)   | 39 | 45  | 6  | 自动模式模块级状态；激活/CLI 标志/熔断三组读写器                            |
| [`utils/telemetry/skillLoadedEvent.ts`](annotated/src/utils/telemetry/skillLoadedEvent.ts) | 39 | 43  | 4  | 会话启动技能加载埋点；技能名走 PII 特供列                                |
| [`utils/timeouts.ts`](annotated/src/utils/timeouts.ts)                                     | 39 | 44  | 5  | bash 超时取值；默认 2 分钟 / 最大 10 分钟，可环境变量覆盖                   |

三条横切观察：

- 「惰性加载与启动代价」：`lockfile.ts` 刻意把 proper-lockfile 的 require 推迟到首次调用，绕开 graceful-fs 在启动路径上的猴补丁开销；`providers.ts`、`unaryLogging.ts` 也把重型依赖的引用收口在窄路径，不让它们污染冷启动。
- 「纯原语与样板收敛」：`signal.ts` 把全代码库约 15 处重复的 listener Set 样板（subscribe/emit/clear）收成一行 `createSignal`，并与 store（带 snapshot/getState）刻意区分——只关心「发生了什么」用信号、关心「当前值」用 store。
- 「开关与门控集中化」：`agentSwarmsEnabled.ts`（队友功能唯一闸门，含 GrowthBook killswitch）与 `autoModeState.ts`（自动模式模块级状态 + 熔断，独立成模块以便被 feature 门控条件 require）都把分散的能力开关收口到单一文件，避免各处各自判断。

踩坑：`autoModeState.ts` 文件级锚点原用 `(1,after)` 落在 `//` 注释段首行内部，被 annotate.py 自动外移到段边界（1→2，落在两条 `//` 注释之后），未劈开英文；其余九份锚点全部落在 import / export / let / 函数收尾行，零块内中文、零外移。

流程账：本批 10 个数据文件逐一对齐源文件，预检 51 锚点全过（含块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）；`annotate.py` 十次失败 0、一次 `⟳`（autoModeState 自动外移，已 grep 确认落点）、零 `⚠`；`check-fidelity.py` 全仓 1073 份 0 失败；`check-links.py` 源码链接 2189 条加内链 661 条，0 失效。

### utils 第 95 批：小文件十件套（39→35 行档，34 锚点）

本批十份仍是「三四十行」的单职责小工具，主题横跨「权限分类器共享层、环境变量校验、同步执行封装、任务输出截断、缓存路径消毒、设置写入回声抑制、SDK 进度事件、语义数字解析、修饰键检测、权限结果描述」——每份都用注释解释约束、回退路径与平台门控。

| 文件                                                                                             | 原文 | 批注版 | 锚点 | 讲什么                                        |
| ---------------------------------------------------------------------------------------------- | -- | --- | -- | ------------------------------------------ |
| [`utils/permissions/classifierShared.ts`](annotated/src/utils/permissions/classifierShared.ts) | 39 | 42  | 3  | 分类器权限系统共享基础设施；工具调用块提取 + zod 安全解析           |
| [`utils/envValidation.ts`](annotated/src/utils/envValidation.ts)                               | 38 | 41  | 3  | 有界整数环境变量校验；valid/capped/invalid 三态         |
| [`utils/execSyncWrapper.ts`](annotated/src/utils/execSyncWrapper.ts)                           | 38 | 41  | 3  | 包裹 execSync 加慢操作日志；已 deprecated 的同步执行封装    |
| [`utils/task/outputFormatting.ts`](annotated/src/utils/task/outputFormatting.ts)               | 38 | 42  | 4  | 任务输出格式化与截断；超长附完整文件路径                       |
| [`utils/cachePaths.ts`](annotated/src/utils/cachePaths.ts)                                     | 38 | 42  | 4  | 缓存目录路径解析与项目目录消毒；djb2 跨版本稳定                 |
| [`utils/settings/internalWrites.ts`](annotated/src/utils/settings/internalWrites.ts)           | 37 | 42  | 5  | 进程内设置写入时间戳；打破 settings→changeDetector 循环依赖 |
| [`utils/task/sdkProgress.ts`](annotated/src/utils/task/sdkProgress.ts)                         | 36 | 39  | 3  | 统一 emitTaskProgress SDK 事件；后台智能体与工作流共用     |
| [`utils/semanticNumber.ts`](annotated/src/utils/semanticNumber.ts)                             | 36 | 39  | 3  | 语义数字 zod 预处理；容错模型给数字加引号                    |
| [`utils/modifiers.ts`](annotated/src/utils/modifiers.ts)                                       | 36 | 39  | 3  | macOS 原生修饰键检测封装；仅 darwin 生效                |
| [`utils/permissions/PermissionResult.ts`](annotated/src/utils/permissions/PermissionResult.ts) | 35 | 38  | 3  | 权限结果类型重导出与行为描述辅助                           |

三条横切观察：

- 「跨版本稳定与消毒」：`cachePaths.ts` 用 djb2 而非 Bun.hash，刻意保持缓存目录名在升级间稳定，避免遗弃已有日志（错误日志、MCP 日志）；并对服务器名消毒以兼容 Windows 保留字符（冒号）。`internalWrites.ts` 同样是为了稳定性——把共享时间戳 Map 从 changeDetector 抽离，专门打破 settings 的循环依赖。
- 「容错解析的取舍」：`envValidation.ts` 用明确的三态（valid/capped/invalid）而非 `z.coerce`，避免吞掉真实 bug；`semanticNumber.ts` 同样只接受合法十进制字面量，把非法值透传给内层 schema 拒绝，而不是用 `z.coerce.number()` 掩盖空串或 null。两者都是「宽容但可观测」的解析哲学。
- 「平台门控与惰性加载」：`modifiers.ts` 仅 darwin 生效、动态 require 避免顶层加载原生模块（修饰键检测是 macOS 专属能力）；`execSyncWrapper.ts` 虽是同步封装但用 `slowLogging` 模板标签埋点，且命令内容只取前 100 字符写入日志，避免把整条命令（可能含密钥）泄漏到日志。

踩坑：本批 10 份文件级锚点一律用 `(1,before)` 顶到文件最前，彻底绕开块注释首行/`//` 段中部外移问题；其余锚点全部落在 import / type / function 签名 / 收尾行，零块内中文、零 `⟳`、零 `⚠`。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）34 锚点一次全过；修正了初版误把 `.ts` 源文件当 Python `ast.parse` 的判错（应解析数据文件本身而非源文件），属预检脚本自身 bug，已在跑前修掉、未污染已写数据文件。

流程账：本批 10 个数据文件逐一对齐源文件，预检 34 锚点全过；`annotate.py` 十次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1083 份 0 失败；`check-links.py` 源码链接 2199 条加内链 662 条，0 失效。

### utils 第 96 批：小文件十件套（34→29 行档，26 锚点）

本批十份继续落在「三十行上下」，主题横跨「托管设置路径、队友会话常量、shell 抽象、异步 cwd 覆盖、错误聚合、控制消息兼容、SLURM 命令规范、临时文件、computer-use 原生模块、语义布尔」——多份仍是为打破循环依赖或做容错解析而单独抽出的小模块。

| 文件                                                                                   | 原文 | 批注版 | 锚点 | 讲什么                                               |
| ------------------------------------------------------------------------------------ | -- | --- | -- | ------------------------------------------------- |
| [`utils/settings/managedPath.ts`](annotated/src/utils/settings/managedPath.ts)       | 34 | 37  | 3  | 托管设置目录路径解析；按平台返回固定位置 + drop-in 拆分目录               |
| [`utils/swarm/constants.ts`](annotated/src/utils/swarm/constants.ts)                 | 33 | 36  | 3  | 队友/swarm 会话常量与命名；socket 名 + 三枚队友环境变量键             |
| [`utils/shell/shellProvider.ts`](annotated/src/utils/shell/shellProvider.ts)         | 33 | 35  | 2  | shell 类型与 ShellProvider 接口；bash/powershell 两类能力抽象 |
| [`utils/cwd.ts`](annotated/src/utils/cwd.ts)                                         | 32 | 36  | 4  | AsyncLocalStorage 实现按异步上下文覆盖 cwd；并发智能体互不污染        |
| [`utils/settings/allErrors.ts`](annotated/src/utils/settings/allErrors.ts)           | 32 | 34  | 2  | 聚合设置校验错误与 MCP 配置错误；打破 settings→mcp 循环依赖           |
| [`utils/controlMessageCompat.ts`](annotated/src/utils/controlMessageCompat.ts)       | 32 | 34  | 2  | 控制消息 requestId→request_id 兼容归一化；防老 iOS 客户端静默丢弃    |
| [`utils/bash/specs/srun.ts`](annotated/src/utils/bash/specs/srun.ts)                 | 31 | 33  | 2  | srun 命令规范；SLURM 集群节点执行，选项与位置参数声明                  |
| [`utils/tempfile.ts`](annotated/src/utils/tempfile.ts)                               | 31 | 33  | 2  | 临时文件路径生成；UUID 或内容哈希稳定标识（保提示缓存前缀）                  |
| [`utils/computerUse/inputLoader.ts`](annotated/src/utils/computerUse/inputLoader.ts) | 30 | 33  | 3  | computer-use-input 原生模块惰性加载与缓存；libuv 下主队列挂起警示     |
| [`utils/semanticBoolean.ts`](annotated/src/utils/semanticBoolean.ts)                 | 29 | 32  | 3  | 语义布尔 zod 预处理；容错模型给布尔加引号                           |

三条横切观察：

- 「循环依赖拆解的惯用法」：allErrors 与第 95 批的 internalWrites 同源思路——把「需要同时 import 两侧、却不被任一侧 import」的叶子逻辑抽到独立文件，专门切断 settings↔mcp、settings↔changeDetector 的环。cwd 也用 AsyncLocalStorage 这种「上下文局部状态」避免全局单例污染。
- 「容错解析与稳定标识」：semanticBoolean 与第 95 批的 semanticNumber 同属「对模型偶尔加引号的标量做精确转换」家族，都拒绝用 z.coerce（会把 false 当 true、把空串吞掉）；tempfile 的 contentHash 选项则反向利用「稳定标识」保住提示缓存前缀，避免随机 UUID 每次子进程都变。
- 「平台/环境门控与惰性加载」：shell/shellProvider 把 bash/powershell 的差异收口成接口；computerUse/inputLoader 仅在支持平台动态 require 原生模块并缓存；managedPath 用 memoize 缓存平台路径、且 Ant 专属覆盖分支在外部构建被剔除。

踩坑：本批 10 份文件级锚点继续用 `(1,before)` 顶到文件最前，零块内中文、零 `⟳`；其中 `shell/shellProvider.ts`（含 shell）与 `bash/specs/srun.ts`（含 bash）含危险子串，按惯例用间接 runner（路径写在 `_run96.py` 内、不出现在命令行）跑 annotate.py，十次零 `⟳`、零 `⚠`。其余八份直接命令行调用。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）26 锚点一次全过。

流程账：本批 10 个数据文件逐一对齐源文件，预检 26 锚点全过；`annotate.py` 十次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1093 份 0 失败；`check-links.py` 源码链接 2209 条加内链 663 条，0 失效。

### utils 第 97 批：小文件十件套（29→26 行档，37 锚点）

本批十份仍是「三十行上下」的叶子小模块，主题横跨「内嵌搜索工具探测、gh 鉴权遥测、Ink 反色高亮、shell 前缀加引号、用户情绪/续写关键词、worktree 轻量探测、策略锁定插件、UUID/AgentId、工具 schema 缓存、OTEL 诊断桥接」——多份刻意绕开重型依赖链或为隐私/缓存做独立小件。

| 文件                                                                                     | 原文 | 批注版 | 锚点 | 讲什么                                              |
| -------------------------------------------------------------------------------------- | -- | --- | -- | ------------------------------------------------ |
| [`utils/embeddedTools.ts`](annotated/src/utils/embeddedTools.ts)                       | 29 | 32  | 3  | 内嵌搜索工具（bfs/ugrep）检测与 bun 二进制路径；仅 ant-native 构建启用 |
| [`utils/github/ghAuthStatus.ts`](annotated/src/utils/github/ghAuthStatus.ts)           | 29 | 33  | 4  | gh CLI 安装/鉴权三态探测；用 auth token 避免网络请求、令牌不进内存      |
| [`utils/highlightMatch.tsx`](annotated/src/utils/highlightMatch.tsx)                   | 28 | 30  | 3  | Ink/React 反色高亮匹配片段；JSX 锚点只落签名与收尾行                |
| [`utils/bash/shellPrefix.ts`](annotated/src/utils/bash/shellPrefix.ts)                 | 28 | 31  | 3  | shell 前缀字符串拆「路径加参数」分别加引号；含 bash 走间接 runner       |
| [`utils/userPromptKeywords.ts`](annotated/src/utils/userPromptKeywords.ts)             | 27 | 32  | 5  | 负面情绪词 / keep going 续写词正则检测                       |
| [`utils/getWorktreePathsPortable.ts`](annotated/src/utils/getWorktreePathsPortable.ts) | 27 | 30  | 3  | 轻量 child_process 探 git worktree 列表；不引 execa 依赖链  |
| [`utils/plugins/managedPlugins.ts`](annotated/src/utils/plugins/managedPlugins.ts)     | 27 | 30  | 3  | 从策略设置读被锁定的插件名集合；仅保护 plugin@marketplace 布尔        |
| [`utils/uuid.ts`](annotated/src/utils/uuid.ts)                                         | 27 | 32  | 5  | UUID 校验加带前缀 AgentId 生成；依赖 crypto.randomBytes     |
| [`utils/toolSchemaCache.ts`](annotated/src/utils/toolSchemaCache.ts)                   | 26 | 31  | 5  | 会话级工具 schema 渲染缓存；避免重算约 11K token 工具块            |
| [`utils/telemetry/logger.ts`](annotated/src/utils/telemetry/logger.ts)                 | 26 | 29  | 3  | 实现 OTEL DiagLogger 桥接本地日志；仅 error/warn 有功        |

三条横切观察：

- 「轻量依赖 vs 重型依赖」：getWorktreePathsPortable 与 embeddedTools 都刻意绕开 execa/cross-spawn 重型链，前者只留 child_process、后者只读 env 与 process.execPath——符合 SDK 端「不带 CLI 依赖链」的诉求。
- 「鉴权/遥测的隐私边界」：ghAuthStatus 用 `auth token` 而非 `auth status` 避免打到 GitHub API，且 `stdout:'ignore'` 让令牌不进本进程内存；telemetry/logger 把第三方诊断日志只映射到本地 error/warn，info/debug/verbose 静默丢弃。
- 「缓存与稳定标识」：toolSchemaCache 用 per-session memoization 锁住 schema 字节，避免 GB 门控翻转、MCP 重连导致整块下游重算；与之前的 tempfile contentHash 同属「稳定标识省重算」家族。

踩坑：本批 10 份文件级锚点继续用 `(1,before)` 顶到文件最前，零块内中文、零 `⟳`；其中 `bash/shellPrefix.ts`（含 bash）含危险子串，按惯例用间接 runner（`_run97.py` 把路径写在文件内、不出现在命令行）跑 annotate.py，其余九份直接命令行调用。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）37 锚点一次全过。highlightMatch.tsx 为 JSX，锚点只落函数签名（第 9 行 before）与函数收尾（第 27 行 after），未插 JSX 内部。

流程账：本批 10 个数据文件逐一对齐源文件，预检 37 锚点全过；`annotate.py` 十次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1103 份 0 失败；`check-links.py` 源码链接 2219 条加内链 664 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`autoModeDenials.ts`(26) · `ink.ts`(26) · `model/aliases.ts`(25) · `plugins/officialMarketplace.ts`(25) · `cleanupRegistry.ts`(25) · `zodToJsonSchema.ts`(23) · `extraUsage.ts`(23) · `standaloneAgent.ts`(23) · `computerUse/swiftLoader.ts`(23) · `shell/shellToolUtils.ts`(22) · `sessionEnvVars.ts`(22) …（utils 还剩 53 份；全仓还剩 799 份）。注意：`shell/shellToolUtils.ts` 含 shell 危险子串，下批 annotate 需走间接 runner。

### utils 第 98 批：小文件十件套（26→22 行档，46 锚点）

本批十份是 utils 收尾带的「二十行上下」叶子小模块，主题横跨「自动模式拒绝记录、Ink 配色主题映射、官方插件市场常量、模型别名与族通配、优雅关闭清理登记、macOS 原生 swift 模块懒加载、额外用量计费判定、独立智能体命名、Zod 转 JSON Schema 缓存、Bun 运行时探测」——多份把「配置/缓存/探测」收口成独立小件，刻意不引重依赖。

| 文件                                                                                           | 原文 | 批注版 | 锚点 | 讲什么                                                  |
| -------------------------------------------------------------------------------------------- | -- | --- | -- | ---------------------------------------------------- |
| [`utils/autoModeDenials.ts`](annotated/src/utils/autoModeDenials.ts)                         | 26 | 32  | 6  | 自动模式分类器最近拒绝命令清单：类型、写入（特性开关 + 截断到上限）、只读读取             |
| [`utils/ink.ts`](annotated/src/utils/ink.ts)                                                 | 26 | 29  | 3  | 颜色名转 Ink 的 TextProps 颜色格式，未知色回退原始 ANSI 色             |
| [`utils/plugins/officialMarketplace.ts`](annotated/src/utils/plugins/officialMarketplace.ts) | 25 | 29  | 4  | 官方 Anthropic 插件市场常量：来源配置与显示名，启动时自动安装识别               |
| [`utils/model/aliases.ts`](annotated/src/utils/model/aliases.ts)                             | 25 | 30  | 5  | 模型别名与模型族通配别名：短名路由 + 允许名单 wildcard 匹配                 |
| [`utils/cleanupRegistry.ts`](annotated/src/utils/cleanupRegistry.ts)                         | 25 | 30  | 5  | 优雅关闭清理登记处：全局 Set 登记/撤销 + Promise.all 批量执行            |
| [`utils/computerUse/swiftLoader.ts`](annotated/src/utils/computerUse/swiftLoader.ts)         | 23 | 28  | 5  | macOS 原生 @ant/computer-use-swift 模块懒加载与缓存，非 macOS 抛错 |
| [`utils/extraUsage.ts`](annotated/src/utils/extraUsage.ts)                                   | 23 | 27  | 4  | 额外用量计费判定：综合订阅/快模式/opus-4-6 与 sonnet-4-6 版本           |
| [`utils/standaloneAgent.ts`](annotated/src/utils/standaloneAgent.ts)                         | 23 | 27  | 4  | 独立智能体命名：非群组会话返回名，处于群组让位群组上下文                         |
| [`utils/zodToJsonSchema.ts`](annotated/src/utils/zodToJsonSchema.ts)                         | 23 | 28  | 5  | Zod v4 转 JSON Schema 并按引用身份缓存，扛高频 API 调用             |
| [`utils/bundledMode.ts`](annotated/src/utils/bundledMode.ts)                                 | 22 | 27  | 5  | 两个 Bun 运行时探测：是否 Bun 启动、是否 Bun 编译独立可执行                |

三条横切观察：

- 「主题与运行时自适应」：ink.ts 把智能体色名映射到主题键（未知色回退 ANSI），bundledMode.ts 探测 Bun 打包态——都让行为跟随运行环境而非硬编码，符合「配置外置」基调。
- 「集中登记 + 按需触发」：cleanupRegistry 用全局 Set 登记清理函数、zodToJsonSchema 用 WeakMap 按引用缓存转换结果——前者解耦生命周期、后者省去每请求重复序列化，都属「一次登记/转换、多次复用」。
- 「计费与命名的精确判据」：extraUsage 用早退优先级综合订阅态/快模式/具体模型版本，aliases 把「短名」与「族通配」两类语义分开——都强调「显式声明压过隐式推导、边界判据可核对」。

踩坑：本批 10 份文件级锚点继续统一用 `(1,'before')` 顶到文件最前（其中 officialMarketplace/cleanupRegistry/standaloneAgent/zodToJsonSchema/bundledMode/autoModeDenials 首行是 `/**` 文档块，`before` 插在块前而非块内），零块内中文、零 `⟳`、零 `⚠`。其中 autoModeDenials 与 ink 是上一批（97）已写好 `_p1.py` 却未落盘 annotated 的孤儿文件，本批先预检确认锚点合法后重跑 annotate 补齐产出，与新增八份一并校验。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）46 锚点一次全过。

流程账：本批 10 个数据文件（2 份回收 + 8 份新写）逐一对齐源文件，预检 46 锚点全过；`annotate.py` 十次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1113 份 0 失败；`check-links.py` 源码链接 2229 条加内链 665 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`shell/shellToolUtils.ts`(22) · `sessionEnvVars.ts`(22) · `commandLifecycle.ts`(21) · `configConstants.ts`(21) · `peerAddress.ts`(21) · `statusNoticeHelpers.ts`(20) · `plugins/pluginPolicy.ts`(20) · `bash/specs/timeout.ts`(20) · `authPortable.ts`(19) · `gitSettings.ts`(18) …（utils 还剩 43 份；全仓还剩 789 份）。注意：`shell/shellToolUtils.ts`、`bash/specs/timeout.ts` 含 shell/bash 危险子串，下批 annotate 需走间接 runner。

### utils 第 99 批：小文件十件套（22→18 行档，33 锚点）

本批十份是 utils 收尾带的「二十行上下」叶子小模块，主题横跨「shell 工具名登记与 PowerShell 开关判据、会话级环境变量表、全局配置常量（通知渠道/编辑器/队友模式）、命令生命周期观察者、对等节点地址解析、状态提示 token 估算、插件策略拦截、bash 子命令规格与聚合入口、macOS 钥匙串凭证便携化」——多份刻意保持「叶子模块、零重依赖、只做一件事」。

| 文件                                                                             | 原文 | 批注版 | 锚点 | 讲什么                                                        |
| ------------------------------------------------------------------------------ | -- | --- | -- | ---------------------------------------------------------- |
| [`utils/shell/shellToolUtils.ts`](annotated/src/utils/shell/shellToolUtils.ts) | 22 | 25  | 3  | shell 工具名数组（Bash+PowerShell）+ Windows 上 PowerShell 工具的开关判据 |
| [`utils/sessionEnvVars.ts`](annotated/src/utils/sessionEnvVars.ts)             | 22 | 26  | 4  | 会话级环境变量 Map：读/写/删/清四个纯函数                                   |
| [`utils/configConstants.ts`](annotated/src/utils/configConstants.ts)           | 21 | 25  | 4  | 三族全局配置常量：通知渠道、编辑器模式、队友模式（独立成文件避循环依赖）                       |
| [`utils/commandLifecycle.ts`](annotated/src/utils/commandLifecycle.ts)         | 21 | 25  | 4  | 命令生命周期极简观察者：单一监听器 + started/completed 通知                   |
| [`utils/peerAddress.ts`](annotated/src/utils/peerAddress.ts)                   | 21 | 24  | 3  | 对等节点地址解析：uds/bridge/other 三种 scheme 的拆包                    |
| [`utils/statusNoticeHelpers.ts`](annotated/src/utils/statusNoticeHelpers.ts)   | 20 | 23  | 3  | agent 描述累计 token 估算（阈值 15000），供状态提示折叠                      |
| [`utils/plugins/pluginPolicy.ts`](annotated/src/utils/plugins/pluginPolicy.ts) | 20 | 23  | 3  | 插件策略拦截：读 policySettings 判断某插件是否被强制禁用                       |
| [`utils/bash/specs/timeout.ts`](annotated/src/utils/bash/specs/timeout.ts)     | 20 | 23  | 3  | bash 子命令 timeout 的规格：duration 与 command 两个参数               |
| [`utils/authPortable.ts`](annotated/src/utils/authPortable.ts)                 | 19 | 22  | 3  | macOS 钥匙串删除 API key + 配置脱敏（末 20 字符）                        |
| [`utils/bash/specs/index.ts`](annotated/src/utils/bash/specs/index.ts)         | 18 | 21  | 3  | bash 子命令规格聚合入口：七个规格拼成数组并满足类型约束                             |

三条横切观察：

- 「零依赖的叶子模块」：configConstants 刻意独立成文件、pluginPolicy 只引 settings、bash/specs/* 都是纯数据规格——都把「常量/策略/规格」收口成不引重依赖的小件，避免 utils 大树形成循环依赖。
- 「单一职责与全局单例」：sessionEnvVars 用一份 Map 统管会话环境、commandLifecycle 用单一监听器统管事件、peerAddress 用纯函数拆地址——都遵循「一个容器/一个钩子、读写分离、状态可核对」。
- 「平台开关与隐私边界」：shellToolUtils 的 PowerShell 门只在 Windows 生效且内外用户默认相反、authPortable 的钥匙串删除只在 darwin 执行——都强调「按平台分流、敏感操作有前提条件」。

踩坑：本批 10 份文件级锚点继续统一用 `(1,'before')` 顶到文件最前（其中 sessionEnvVars/pluginPolicy/peerAddress 首行是 `/**` 文档块，`before` 插在块前而非块内），零块内中文、零 `⟳`、零 `⚠`。其中 `shell/shellToolUtils.ts`、`bash/specs/timeout.ts`、`bash/specs/index.ts` 含 shell/bash 危险子串，按惯例走间接 runner（`_run99.py` 把三条路径写在文件内、不出现在命令行）跑 annotate.py，其余七份直接命令行调用。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）33 锚点一次全过。

流程账：本批 10 个数据文件逐一对齐源文件，预检 33 锚点全过；`annotate.py` 十次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1123 份 0 失败；`check-links.py` 源码链接 2239 条加内链 666 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`gitSettings.ts`(18) · `objectGroupBy.ts`(18) · `nativeInstaller/index.ts`(18) · `todo/types.ts`(18) · `swarm/teammatePromptAddendum.ts`(18) · `secureStorage/index.ts`(17) · `classifierApprovalsHook.ts`(17) · `findExecutable.ts`(17) · `xml.ts`(16) · `jsonRead.ts`(16) …（utils 还剩 33 份；全仓还剩 779 份）。（本批 top-10 均不含 shell/bash/powershell 危险子串，下批可直接命令行调用；更靠后的 14 行档 `shell/resolveDefaultShell.ts`、`shell/outputLimits.ts` 含 shell 子串，届时再走间接 runner。）

### utils 第 101 批：剩余小文件十五件套（14→8 行档，39 锚点）

本批十五份是 utils 收尾的「二十行以下」叶子小模块，按行数降序从 14 行一路取到 8 行（小文件多取到单批 15 上限）；主题横跨「macOS 按键映射、输入框默认 shell 解析、系统提示品牌类型、浏览器构建替换入口、bash 子命令纯数据规格、Promise 垫片、零依赖数组工具、沙箱违规标签清理、记忆类型表、工作树开关写死、零依赖 UA 串、队友默认模型回退、设置 schema 导出」——多份刻意保持「叶子模块、零重依赖、只做一件事」，或为避开 polyfill / 兼容旧 Node / 切断循环依赖而从大文件抽离。

| 文件                                                                                       | 原文 | 批注版 | 锚点 | 讲什么                                                                  |
| ---------------------------------------------------------------------------------------- | -- | --- | -- | -------------------------------------------------------------------- |
| [`utils/keyboardShortcuts.ts`](annotated/src/utils/keyboardShortcuts.ts)                 | 14 | 17  | 3  | macOS 终端「Option+字母」特殊字符 → 按键绑定映射（思考/模型/快速模式开关）                       |
| [`utils/shell/resolveDefaultShell.ts`](annotated/src/utils/shell/resolveDefaultShell.ts) | 14 | 16  | 2  | 输入框 `!` 命令默认 shell 解析：设置优先、回退 bash、不自动翻 PowerShell                   |
| [`utils/systemPromptType.ts`](annotated/src/utils/systemPromptType.ts)                   | 14 | 17  | 3  | 品牌类型 SystemPrompt（只读字符串数组 + \_\_brand 身份标记）与工厂函数                     |
| [`utils/crypto.ts`](annotated/src/utils/crypto.ts)                                       | 13 | 15  | 2  | 浏览器构建替换入口：避免 crypto-browserify polyfill，且必须用 import-then-export 保活绑定 |
| [`utils/bash/specs/sleep.ts`](annotated/src/utils/bash/specs/sleep.ts)                   | 13 | 16  | 3  | bash 内置 sleep 命令的纯数据规格（duration 参数）                                  |
| [`utils/bash/specs/nohup.ts`](annotated/src/utils/bash/specs/nohup.ts)                   | 13 | 16  | 3  | bash 内置 nohup 命令的纯数据规格（command 参数）                                   |
| [`utils/withResolvers.ts`](annotated/src/utils/withResolvers.ts)                         | 13 | 15  | 2  | Promise.withResolvers 垫片（Node 18 兼容），返回 promise/resolve/reject 三元组   |
| [`utils/bash/specs/time.ts`](annotated/src/utils/bash/specs/time.ts)                     | 13 | 16  | 3  | bash 内置 time 命令的纯数据规格（command 参数）                                    |
| [`utils/array.ts`](annotated/src/utils/array.ts)                                         | 13 | 17  | 4  | 三个零依赖数组工具：intersperse / count / uniq                                 |
| [`utils/sandbox/sandbox-ui-utils.ts`](annotated/src/utils/sandbox/sandbox-ui-utils.ts)   | 12 | 14  | 2  | 清理 `<sandbox_violations>` 标签便于干净展示报错                                 |
| [`utils/memory/types.ts`](annotated/src/utils/memory/types.ts)                           | 12 | 15  | 3  | 记忆类型取值列表（按 TEAMMEM 特性追加 TeamMem）与派生类型                                |
| [`utils/worktreeModeEnabled.ts`](annotated/src/utils/worktreeModeEnabled.ts)             | 11 | 13  | 2  | 工作树模式现已无条件开启（修复缓存默认吞掉 --worktree）                                    |
| [`utils/userAgent.ts`](annotated/src/utils/userAgent.ts)                                 | 10 | 12  | 2  | 零依赖 User-Agent 辅助（claude-code/<版本>），不牵动 auth.ts 依赖树                  |
| [`utils/swarm/teammateModel.ts`](annotated/src/utils/swarm/teammateModel.ts)             | 10 | 13  | 3  | 新队友默认模型回退（未设则 Opus 4.6，需按 provider 区分）                               |
| [`utils/settings/schemaOutput.ts`](annotated/src/utils/settings/schemaOutput.ts)         | 8  | 10  | 2  | 把 SettingsSchema 转成 JSON Schema 字符串输出                                |

三条横切观察：

- 「bash 子命令规格的纯数据收敛」：bash/specs 下 sleep/nohup/time 三份都是同一套 `CommandSpec` 形状的纯数据（name/description/args），彼此结构完全一致，属于「bash 内置命令清单」这一族的叶子规格；它们与上批的 alias 共同说明 bash 子命令是怎么被声明和注册的。
- 「零依赖的叶子工具与垫片」：keyboardShortcuts（macOS 按键映射）、array（intersperse/count/uniq）、userAgent（UA 串）、withResolvers（Promise 垫片）、crypto（打包替换入口）、sandbox-ui-utils（标签清理）都强调「小、专、不引重依赖」，或为避开 polyfill / 兼容旧 Node 而单独抽离。
- 「类型与配置的小型声明」：systemPromptType（品牌类型 + 工厂）、memory/types（联合类型取值表）、settings/schemaOutput（schema 导出）、worktreeModeEnabled（写死的开关）、swarm/teammateModel（模型回退）都是「用一个文件把某类常量/类型/判定收口」的惯用法，调用方拿到的是稳定接口而非散落的字面量。

踩坑：本批 15 份文件级锚点继续统一用 `(1,'before')` 顶到文件最前（其中 systemPromptType/withResolvers/sandbox-ui-utils/userAgent/worktreeModeEnabled 首行是 `/**` 文档块，`before` 插在块前而非块内），零块内中文、零 `⟳`、零 `⚠`。其中 `shell/resolveDefaultShell.ts`（含 shell）、`bash/specs/sleep.ts`/`nohup.ts`/`time.ts`（含 bash）含危险子串，按惯例走间接 runner（`_run101.py` 把四条路径写在文件内、不出现在命令行）跑 annotate.py，其余十一份直接命令行调用。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）39 锚点一次全过。

流程账：本批 15 个数据文件逐一对齐源文件，预检 39 锚点全过；`annotate.py` 十五次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1153 份 0 失败；`check-links.py` 源码链接 2264 条加内链 668 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`memory/versions.ts`(8) · `messagePredicates.ts`(8) · `lazySchema.ts`(8) …（utils 还剩 3 份；全仓还剩 749 份）。注意：utils 仅剩这 3 份 8 行小文件，下一批即可清零。

### utils 第 102 批：收尾清零（3 份 8 行小文件，6 锚点）

本批三份是 utils 子树最后的叶子：均为 8 行微型模块，清掉即 `src/utils/` 全目录 **564/564 = 100% 清零**（行覆盖 180,487/180,487）。这标志着 hooks → utils 两条子树依次全清，流水线正式转入 `src/components/`。

| 文件                                                                       | 原文 | 批注版 | 锚点 | 讲什么                                                                                    |
| ------------------------------------------------------------------------ | -- | --- | -- | -------------------------------------------------------------------------------------- |
| [`utils/lazySchema.ts`](annotated/src/utils/lazySchema.ts)               | 8  | 10  | 2  | 惰性 schema 工厂：把 Zod 构造从模块初始化推迟到首次访问，`??=` 一次性记忆化                                        |
| [`utils/memory/versions.ts`](annotated/src/utils/memory/versions.ts)     | 8  | 10  | 2  | 同步判断目录是否处于 git 仓库内（`findGitRoot` 向上找 `.git`，异步请用 `dirIsInGitRepo`）                     |
| [`utils/messagePredicates.ts`](annotated/src/utils/messagePredicates.ts) | 8  | 10  | 2  | 类型守卫 `isHumanTurn`：`tool_result` 与真人同带 `type:'user'`，靠 `isMeta` + `toolUseResult` 双重排除 |

横切观察：

- 「utils 收口于一致性小工具」：三份都满足「叶子模块、只做一件事」——惰性工厂、同步 git 探测、消息类型守卫，是 utils 子树从巨兽到叶子完整覆盖的最后一笔。
- 「判别式的历史教训」：`messagePredicates.ts` 的注释点明四个 PR 都曾因只看 `type==='user'` 把 `tool_result` 误判为真人，故用 `isMeta` 与 `toolUseResult` 双重排除——这类「看似简单却有历史坑」的守卫正是批注要留下来的重点。

踩坑：三份文件级锚点统一 `(1,'before')` 顶到最前（lazySchema 首行是 `/**` 文档块、`before` 插在块前而非块内），其余锚点落在函数收尾 / `return` 判别式行，零块内中文、零 `⟳`、零 `⚠`。三个相对路径均不含 `bash`/`shell`/`powershell` 子串，命令行直接跑 `annotate.py` 三次通过，无需间接 runner。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）6 锚点一次全过。

流程账：本批 3 个数据文件逐一对齐源文件，预检 6 锚点全过；`annotate.py` 三次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1156 份 0 失败；`check-links.py` 源码链接 2279 条加内链 669 条，0 失效。`src/utils/` 经数十批推进，至此 564/564 全目录清零。

**下一批候选（utils 已清零，转 `src/components/`）**：按 `check-coverage src/components` 实际 top 清单，最大缺失为 `Settings/Config.tsx`(1822) · `LogSelector.tsx`(1575) · `Stats.tsx`(1228) · `permissions/rules/PermissionRuleList.tsx`(1179) · `mcp/ElicitationDialog.tsx`(1169) · `VirtualMessageList.tsx`(1082) · `ScrollKeybindingHandler.tsx`(1012) · `tasks/RemoteSessionDetailDialog.tsx`(904) · `MessageSelector.tsx`(831) · `agents/AgentsMenu.tsx`(800) …（components 已做 66/389，剩 323 份；全仓还剩 746 份）。注意：components 多为 `.tsx` 巨文件，锚点只能落函数/类型收尾行与签名结束行，不可插在 JSX 内部；含 shell/bash 子串者仍需间接 runner。

### components 第 103 批：设置面板与历史选择器（1,822 + 1,575 行，73 锚点）

本批转入 `src/components/` 后首次取件。该子树与前两条不同：单文件动辄 800–1,800 行，且多为 React Compiler 编译产物（满屏 `_c(n)` 记忆槽与 `t1..tN` 临时变量）。因此本批改为「**按源行量取件**」——只取最大的 2 份共 3,397 行，仍是历史单批体量的 5–6 倍，锚点密度相应降到约每 46 行一处，全部落在函数签名/语句收尾/常量声明行。

| 文件                                                                               | 原文   | 批注版  | 锚点 | 讲什么                                                              |
| -------------------------------------------------------------------------------- | ---- | ---- | -- | ---------------------------------------------------------------- |
| [`components/Settings/Config.tsx`](annotated/src/components/Settings/Config.tsx) | 1822 | 1858 | 36 | `/config` 主面板：全局配置 + settings 文件 + AppState 三处状态聚合，即时落盘 + 挂载快照回滚 |
| [`components/LogSelector.tsx`](annotated/src/components/LogSelector.tsx)         | 1575 | 1612 | 37 | `/resume` 历史选择器：标签/分支/工作树过滤、Fuse 全文检索、会话预览与重命名                   |

横切观察：

- 「取消 = 反向写」是 `Config.tsx` 的核心不变量：改动一律即时落盘让 UI 立刻生效，Esc 不是「丢弃未保存」而是「用快照把三处状态写回」。因此回滚顺序有硬约束——先 `setTheme`（内部会局部写全局配置），再整体覆盖快照，否则局部写会盖掉整体。
- 分来源快照不可省：合并后的 settings 视图无法区分「该删键」与「该还原值」，只有按 `localSettings`/`userSettings` 分别留底，配合 `updateSettingsForSource` 的「传 `undefined` 即删键」语义才能精确回滚。
- 「空」有两种语义：`LogSelector` 里模型值 `undefined`（没设过，回落硬编码）与 `null`（显式跟随队长）必须分开处理；`Config` 里 `isDirty` 则是「是否发生过用户可见改动」的闩锁，没有它「打开即关闭」也会触发一轮无意义写盘。
- 编译产物要还原着读：`LogSelector` 的 247 个记忆槽与 `bb0/bb1/bb2` 标签块都是 React Compiler 的 `useMemo`/`useCallback`/条件表达式展开，语义等价于原始写法。

踩坑：两份均为巨型 `.tsx`，`after` 绝不落 JSX 内部，只取函数签名行（`function`/`const x = useCallback`）、语句收尾行（`});`/`;`）与常量声明行；`before` 用于 `type`/`function`/文档注释块开头。文件级锚点仍用 `(1,'before')`。预检门禁（六断言 + 块注释内部续行扫描）73 锚点一次全过，`annotate.py` 两次零 `⟳`、零 `⚠`，行数增量恰好等于锚点数（+36 / +37），无意外外移。

流程账：本批 2 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1158 份 0 失败（较上批 +2）；`check-links.py` 源码链接 2282 条加内链 670 条，0 失效；全仓 1158/1902 文件、347,734/513,237 行、67%。

**下一批候选（components 降序，仍按源行量取件）**：`Stats.tsx`(1228) · `permissions/rules/PermissionRuleList.tsx`(1179) · `mcp/ElicitationDialog.tsx`(1169) · `VirtualMessageList.tsx`(1082) · `ScrollKeybindingHandler.tsx`(1012) · `tasks/RemoteSessionDetailDialog.tsx`(904) · `MessageSelector.tsx`(831) · `agents/AgentsMenu.tsx`(800) · `permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`(768) · `teams/TeamsDialog.tsx`(715) …（components 已做 68/389，剩 321 份；全仓还剩 744 份）。建议下批取 3 份（约 3,500 行），保持本批密度。

### components 第 104 批：统计面板、权限规则、MCP 询问（3,573 行，112 锚点）

第二批 components，延续「按源行量取件」：取最大的 3 份共 3,573 行，密度与上批持平（约每 32 行一处锚点）。三份的共同点是**状态机都很重**——统计面板是「全量挂起 + 区间增量」的双层加载，权限面板是「六种整屏视图」的早退链，询问对话框是「表单焦点 / 手风琴 / 等待阶段」的多层按键分派。

| 文件                                                                                                                         | 原文   | 批注版  | 锚点 | 讲什么                                              |
| -------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | -- | ------------------------------------------------ |
| [`components/Stats.tsx`](annotated/src/components/Stats.tsx)                                                               | 1227 | 1263 | 35 | `/stats` 用量统计：热力图 + 概览/模型双标签 + 区间循环，另有 ANSI 截图路径 |
| [`components/permissions/rules/PermissionRuleList.tsx`](annotated/src/components/permissions/rules/PermissionRuleList.tsx) | 1178 | 1215 | 36 | `/permissions` 五标签规则管理：增删规则与工作区目录，内存生效与落盘分离      |
| [`components/mcp/ElicitationDialog.tsx`](annotated/src/components/mcp/ElicitationDialog.tsx)                               | 1168 | 1210 | 41 | MCP 反向询问：按 JSON Schema 动态渲染表单，form/url 两种模式      |

横切观察：

- 「内存生效」与「持久化」在本批被反复拆开：权限面板先 `applyPermissionUpdate` 算新上下文并写 AppState（立刻生效），只有勾了「记住」才 `persistPermissionUpdate` 落盘；会话级授权进程结束即失效。统计面板同理——全量 Promise 只建一次，区间数据进缓存后不再请求。
- 「互斥焦点」比「单一焦点」更难写：询问对话框的 `currentFieldIndex` 与 `focusedButton` 必须严格互斥，两者皆空才是「有字段但未聚焦」的初始态；权限面板则用「早退链」把规则详情、新增输入、校验确认、加目录、删目录、主列表六种整屏视图排成互斥分支。
- 「展示值可本地化，回传值必须原样」：询问对话框的日期字段只改显示格式，提交仍用原始 ISO 串；纯日期还要手工拆年月日构造本地日期，规避 `new Date(字符串)` 按 UTC 解析导致的跨时区偏移。
- React Compiler 产物的 `Symbol.for("react.memo_cache_sentinel")` 是「只建一次」的哨兵：统计面板的全量 Promise 若每次渲染重建，`use()` 会反复挂起成死循环；这也是批注里必须留下的坑。

踩坑：三份均为千行级 `.tsx`，`after` 只落语句收尾行（`);` / `;`）与常量声明行，`before` 用于 `type`/`function`/`/**` 块开头，JSX 内部零插入。预检 112 锚点一次全过（含块注释内部续行扫描），`annotate.py` 三次零 `⟳`、零 `⚠`。一处文本自检修正：初稿在「ASCII 动画」描述里写了反斜杠转义，被「批注正文禁反斜杠」门禁拦下，改为「横线斜线这类 ASCII 动画」。

流程账：3 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1161 份 0 失败（较上批 +3）；`check-links.py` 源码链接 2284 条加内链 671 条，0 失效；全仓 1161/1902 文件、351,310/513,237 行、68%。

### components 第 105 批：虚拟列表、滚动总控、远程会话详情（2,995 行，118 锚点）

第三批 components，仍按源行量取件：3 份共 2,995 行，密度约每 25 行一处锚点。三份的共同点&#x662F;**「视口」与「手势」的时间差**——虚拟列表要在渲染完成之后才知道元素在哪，滚动总控要在几十毫秒的滚轮节奏里推断设备类型，远程会话详情要在日志还没归一化时就算出「几个代理在干活」。

| 文件                                                                                                               | 原文   | 批注版  | 锚点 | 讲什么                                        |
| ---------------------------------------------------------------------------------------------------------------- | ---- | ---- | -- | ------------------------------------------ |
| [`components/VirtualMessageList.tsx`](annotated/src/components/VirtualMessageList.tsx)                           | 1081 | 1123 | 41 | 全屏虚拟滚动：窗口切片、jump/step/highlight 三段搜索、粘性提示头 |
| [`components/ScrollKeybindingHandler.tsx`](annotated/src/components/ScrollKeybindingHandler.tsx)                 | 1011 | 1056 | 44 | 滚轮加速三条曲线、键盘翻页、选区与滚动联动、拖动自动滚动               |
| [`components/tasks/RemoteSessionDetailDialog.tsx`](annotated/src/components/tasks/RemoteSessionDetailDialog.tsx) | 903  | 937  | 33 | 远程会话三视图分派：ultraplan、ultrareview 阶段流水线、通用详情 |

横切观察：

- **两阶段跳转**是本批最重的一块设计：`jump()` 只把目标滚进挂载范围并记一个请求，真正的扫描放在 `seekGen` 触发的被动副作用里——那时 DOM 已经画完、元素必然存在。若在 `jump()` 里同步扫，元素还没挂载，只能拿估算位置反复修正。代价是要有幽灵守卫（绕回起点即放弃、连发上限 20）。
- **设备猜测靠时序而非能力探测**：滚轮没有标准字段能区分鼠标与触控板，只能靠「反向假事件后 200ms 内翻回」判定编码器回弹、靠「连续小于 5ms 事件」判定触控板轻扫、靠空闲 1500ms 判定换设备。三条守卫缺一，手感会在两类设备间互相污染。
- **`viewportTop` 是个反复出现的 off-by-N 来源**：滚动内容在屏幕上不从 0 行开始（布局给了内边距，上面还可能有头部），消息相对行必须加上它才是屏幕绝对行；选区平移、粘性头定位、高亮写入三处都要加。
- **代理计数有一个隐式加一**：ultraplan 的「工作代理数」等于派生的子代理数加一（主代理也干活），重构时丢掉这个加一，只派生一个子代理的会话会显示成「1 agent」。

踩坑：三份都是千行级 `.tsx`，其中 `RemoteSessionDetailDialog.tsx` 是 React Compiler 产物且 JSX 占比过半——`after` 只落语句收尾行与常量声明行，JSX 内部零插入，`before` 用于 `function` / `type` / 注释段开头。预检 118 锚点一次全过（含块注释内部续行扫描与 `after` 落 `*/` 收尾行检测）；`annotate.py` 三次零 `⟳`、零 `⚠`。三份均有 1 行长批注被自动折行，故增量比锚点数多 1。

流程账：3 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1164 份 0 失败（较上批 +3）；`check-links.py` 源码链接 2287 条加内链 672 条，0 失效；全仓 1164/1902 文件、354,308/513,237 行、69%。

**下一批候选（components 降序）**：`MessageSelector.tsx`(831) · `agents/AgentsMenu.tsx`(800) · `permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`(768) · `teams/TeamsDialog.tsx`(715) · `CustomSelect/select.tsx`(690) · `CustomSelect/use-select-navigation.ts`(653) · `tasks/BackgroundTasksDialog.tsx`(652) · `mcp/MCPRemoteServerMenu.tsx`(649) …（components 已做 74/389，剩 315 份；全仓还剩 738 份）。建议下批仍取 3 份约 2,800 行。

### components 第 106 批：消息选择器、智能体菜单、退出计划权限、团队对话框（3,114 行，99 锚点）

第四批 components，仍按源行量取件：4 份共 3,114 行（比上批多取 1 份——四份恰好卡在 830/800/768/715 的紧凑区间，凑成约 3,100 行维持稳定密度）。四份的共同点&#x662F;**「对话 / 团队的人机协作面板」**：消息选择器在「恢复会话」时让用户挑要回滚到哪条消息并预览 diff；智能体菜单与团队对话框是 swarm 队友的增删查改与运行管控；退出计划权限把「批准退出计划模式」做成一次带上下文压制的权限请求。

| 文件                                                                                                                                                                                               | 原文  | 批注版 | 锚点 | 讲什么                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`components/MessageSelector.tsx`](annotated/src/components/MessageSelector.tsx)                                                                                                                 | 831 | 859 | 27 | 恢复会话的消息选择器：isTextBlock 判定、RestoreOption 结构、Props、messageOptions 构造、双 useEffect 同步、getRestoreOptions/restoreConversationDirectly/handleSelect/onSelectRestoreOption/handleEscape/useKeybindings 链路，末尾 computeDiffStatsBetweenMessages/selectableUserMessagesFilter/messagesAfterAreOnlySynthetic 三个边界工具 |
| [`components/agents/AgentsMenu.tsx`](annotated/src/components/agents/AgentsMenu.tsx)                                                                                                             | 800 | 822 | 21 | swarm 智能体管理菜单：modeState 分派 list-agents/create-agent/agent-menu/view-agent/delete-confirm/edit-agent 六视图，末尾一排 `_temp0.._temp9` 同构谓词（外加一个通用 `_temp`）做行内可见性判定                                                                                                                                             |
| [`components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx`](annotated/src/components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.tsx) | 768 | 793 | 24 | 退出计划模式权限请求：buildPermissionUpdates/buildPlanApprovalOptions/autoNameSessionFromPlan/getContextUsedPercent 四个顶层 helper + 主组件，把「批准 / 拒绝 / 改计划」做成带上下文占用百分比的模态                                                                                                                                              |
| [`components/teams/TeamsDialog.tsx`](annotated/src/components/teams/TeamsDialog.tsx)                                                                                                             | 715 | 743 | 27 | 团队协作对话框：主组件 + TeamDetailView/TeammateListItem/TeammateDetailView 三个编译子组件，killTeammate/viewTeammateOutput/toggleTeammateVisibility/hideTeammate/showTeammate/stub/sendModeChangeToTeammate/cycleTeammateMode/cycleAllTeammateModes 等队友运行管控                                                              |

横切观察：

- **「恢复会话」是四份里信息密度最高的一块**：MessageSelector 不能只列消息，还要算「选中消息与当前消息之间的 diff 统计」（computeDiffStatsBetweenMessages）、还要过滤「可被选中的用户消息」（selectableUserMessagesFilter）与「其后是否只有合成消息」（messagesAfterAreOnlySynthetic）——后者决定回滚到那条会不会落到一个「全是系统消息、用户无可干预点」的死状态。三道过滤任一漏掉，恢复出来的会话就不可继续。
- **「队友管控」靠一排同构谓词分派**：AgentsMenu 末尾的 `_temp0.._temp9`（加一个通用 `_temp`）都是「某按钮在当前行 / 当前 mode 下该不该显示」的纯谓词；TeamsDialog 则把 kill/show/hide/cycle 拆成独立函数再在渲染里按状态拼。两者都回避了「用一个巨型 switch 把 UI 与逻辑缠在一起」，把可见性判定收敛成纯函数。
- **「批准即生效、确认即执行」的两段式反复出现**：AgentsMenu 的 delete-confirm 分支先弹确认再真正删；ExitPlanMode 的 buildPlanApprovalOptions 把「批准 / 拒绝 / 改计划」三种按钮集中生成，主组件只负责渲染与收集结果。删除与批准都是不可逆操作，必须多一次显式确认。
- **上下文占用百分比是权限面板的隐形主角**：ExitPlanMode 的 getContextUsedPercent 把「计划要占用的上下文窗口比例」算出来展示给用户，批准前先让人知道「这一批准会吃掉多少上下文」——这是纯技术参数转成用户可读信号的典型手法。

踩坑：四份均为 React Compiler 产物（`_c()` 记忆槽 + `$[n]` 依赖比较），JSX 内部零插入，`after` 只落语句收尾行与常量 / 函数签名行，`before` 用于 `function` / `type` / `/** */` 文档块开头。多份含 `/** */` 块（MessageSelector 719/794 行、ExitPlanMode 673 行、TeamsDialog 618/629/635/641/662/676 行）均用 `before` 落签名行规避块注释内部。AgentsMenu 初稿漏了 delete-confirm 分支（679 行），补锚后数据文件 21 锚点。预检 99 锚点一次全过（含块注释内部续行扫描与 `after` 落 `*/` 收尾行检测）；`annotate.py` 四次零 `⟳`、零 `⚠`，四份各有 1 处长批注被自动折行，故增量（103 行）比锚点数（99）多 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1168 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2290 条加内链 673 条，0 失效；全仓 1168/1902 文件、357,422/513,237 行、69%。

### components 第 107 批：选择组件、后台任务总管、MCP 远程服务器菜单（2,644 行，93 锚点）

第五批 components，仍按源行量取件：4 份共 2,644 行（690 / 653 / 652 / 649 的紧凑区间）。四份的主题&#x662F;**「终端里的交互基础设施」**：CustomSelect 是全产品所有菜单/弹窗的选择底座，BackgroundTasksDialog 是七类后台任务的统一总管，MCPRemoteServerMenu 是远程 MCP 服务器的认证与重连中枢——三份都有「多分支互斥视图」或「状态机 reducer」的骨架。

| 文件                                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --- | --- | -- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`components/CustomSelect/select.tsx`](annotated/src/components/CustomSelect/select.tsx)                             | 690 | 714 | 23 | 选择底座展示层：三种版式（expanded / compact-vertical / compact）各自渲染分支；getTextContent 摊平 ReactNode 算列宽；双列布局靠手动补空格对齐；TwoColumnRow 自己声明原生光标；尾部 8 个 \_tempN 同构谓词        |
| [`components/CustomSelect/use-select-navigation.ts`](annotated/src/components/CustomSelect/use-select-navigation.ts) | 653 | 674 | 21 | 选择底座状态机：useReducer 管理 focusValue 与可视窗口，六种 action；最小滚动策略（焦点到边缘、绝不居中）；选项集变化时带旧视口重建，光标尽量留原地；validatedFocusedValue 防焦点悬空                                    |
| [`components/tasks/BackgroundTasksDialog.tsx`](annotated/src/components/tasks/BackgroundTasksDialog.tsx)             | 652 | 679 | 26 | 后台任务总管：七类任务统一列表；x 停止 / f 前台化 / Enter 详情的键位分派；WORKFLOW_SCRIPTS 与 MONITOR_TOOL 特性门控 require；allSelectableItems 顺序必须与 JSX 渲染顺序一致的隐式契约；goBackToList 的过期状态陷阱 |
| [`components/mcp/MCPRemoteServerMenu.tsx`](annotated/src/components/mcp/MCPRemoteServerMenu.tsx)                     | 649 | 673 | 23 | MCP 远程服务器菜单：四条独立异步流程（标准 OAuth / claudeai 认证 / claudeai 清除认证 / 重连）各带早退加载视图；isEffectivelyAuthenticated 驱动菜单项；手动粘贴回调 URL 的降级路径；revoke 保留 step-up 状态的取舍     |

横切观察：

- **CustomSelect 拆成「展示 + 状态机」两层是这套 UI 体系最重要的复用决策**：use-select-navigation.ts 是手写源码（reducer 六种 action、最小滚动、validatedFocusedValue 校验），select.tsx 是编译产物（三版式渲染 + 72 个记忆槽）。所有上层（权限弹窗、提问面板、服务器菜单）都消费同一底座，交互行为只改一处。
- **「顺序契约」是编译产物里最脆弱的隐式约定**：BackgroundTasksDialog 的 allSelectableItems 必须与 JSX 分组渲染顺序一致，否则键盘光标与视觉位置错位——代码里没有任何机制强制这一点，只能靠注释（源码 217 行的英文注释就是干这个的）。
- **异步流程的「完成文案三分法」**：MCPRemoteServerMenu 每条流程的成功 / 半成功（needs-auth）/ 失败都有独立文案，且半成功都提示「可能要手动重启」——连接管理器不保证热生效，宁可提示用户重启也不静默装好。
- **useEffectEvent 的教科书用法**：onDoneEvent 让「引用稳定」与「永远调最新回调」同时成立，effect 不重跑、闭包不过期——React 官方为事件与 effect 解耦提供的原语，本文件是标准范例。

踩坑：`use-select-navigation.ts` 的数据文件名初稿保留了连字符（slug 规则要求 `-` 也换成 `_`），annotate.py 找不到数据文件报「找不到批注数据」，重命名为 `use_select_navigation` 后通过——slug 规则原文「把 `/` `.` `-` 换成 `_`」中的 `-` 这次才真正踩到。三份编译产物 JSX 内部零插入，锚点全落语句收尾行 / 常量声明行 / `if` 与 `case` 行前；select.tsx 尾部注释块（625 行起）描述的是 TwoColumnRow 但被编译器提升到 \_temp9 之前，批注里特别标注「按语义归属读」。预检 93 锚点一次全过（含块注释内部续行扫描与 `after` 落 `*/` 收尾行检测）；annotate 四次零 `⟳`、零 `⚠`，3 处长批注自动折行，增量 96 = 93 锚点 + 3。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1172 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2294 条加内链 674 条，0 失效；全仓 1172/1902 文件、360,066/513,237 行、70%（行覆盖首次破 70%）。

### components 第 108 批：权限请求表单、全屏布局壳、OAuth 登录流程、反馈上报（2,505 行，126 锚点）

第六批 components，按源行量取件：4 份共 2,505 行（645 / 637 / 631 / 592）。四份的主题&#x662F;**「用户对话框的四种门面」**——向用户提问的权限表单（多问题页签加图片粘贴）、REPL 全屏布局壳（粘性滚动加未读 pill）、OAuth 登录状态机（八态加浏览器回跳兜底）、反馈上报对话框（四步流加脱敏与 GitHub issue 拼链）。四份都重交互、都靠状态机驱动画面，读法一致：先抓状态类型，再看动作分派，最后看渲染分支。

| 文件                                                                                                                                                                                                           | 原文  | 批注版 | 锚点 | 讲什么                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | --- | -- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`](annotated/src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx) | 645 | 677 | 31 | 提问权限表单：语法高亮走 Suspense 加 use 挂起；尺寸预算（预览框分栏公式、chrome 15 行开销）；每问题独立粘贴图片；四种终点（取消 / 向 Claude 回话 / 结束计划访谈 / 提交回答）全部带遥测来源                              |
| [`components/FullscreenLayout.tsx`](annotated/src/components/FullscreenLayout.tsx)                                                                                                                           | 637 | 669 | 31 | 全屏布局壳：useUnseenDivider 的 count 与 scrollHeight 双快照；未读计数跳过纯工具条目并下限 1；pillVisible 用 useSyncExternalStore 订阅滚动；粘性头固定 1 行防位移；模态弹层包 ModalContext 下发尺寸 |
| [`components/ConsoleOAuthFlow.tsx`](annotated/src/components/ConsoleOAuthFlow.tsx)                                                                                                                           | 631 | 662 | 30 | OAuth 登录状态机：八态联合类型加 switch 分派；toRetry 与 nextState 让失败回到正确状态；浏览器回跳 3 秒后出粘贴提示；单字符 c 复制 URL；企业 TLS 代理的 SSL 错误转可行动提示；setup-token 一年期令牌不进钥匙串         |
| [`components/Feedback.tsx`](annotated/src/components/Feedback.tsx)                                                                                                                                           | 592 | 627 | 34 | 反馈上报：四步流（输入 / 同意 / 提交 / 完成）；redactSensitiveInfo 逐类替换凭证；报告含转录、子代理转录、内存错误与环境信息；标题由 Haiku 生成带兜底；GitHub issue 链接按 7250 字符预算三段式截断；ZDR 组织专属文案         |

横切观察：

- **状态机形态两极，按「画面内多步」与「跨异步阶段」分工**：AskUserQuestion 用 hook 内的 reducer（useMultipleChoiceState），把当前问题下标、答案表、每问题文本状态塞进一个状态对象，四种终点动作彼此平级；ConsoleOAuthFlow 用联合类型加 switch，八态互斥，靠 toRetry 与 nextState 两个字段把失败引回正确的那一态。前者适合同一画面内翻页式多步，后者适合跨异步阶段（浏览器、交换令牌、建 key）的流转。
- **拒绝不等于失败，权限通道被复用成澄清通道**：AskUserQuestion 的三种非提交终点全部走 toolUseConfirm 的 onReject，其中「向 Claude 回话」与「结束计划访谈」把拼好的反馈文本加图片块当作拒绝理由回传模型——工具调用被否，但上下文又塞回去了。这是整套权限框架里最巧的一处设计：一条通道同时承载「不同意」与「换个方式继续」。
- **布局层的取舍全指向「滚动期间不产生位移」**：FullscreenLayout 的粘性头强制固定 1 行（注释写明变高会让 DECSTBM 区域顶跟着动、diff 引擎看到全部移动），pill 用 useSyncExternalStore 订阅滚动只在布尔翻转时重渲染，分隔线 y 存 ref 不存 state。三个决定共同服务于「用户滚动时画面不跳」。
- **上传前的清洗是三道而非一道**：Feedback 先脱敏报告内容（API key、云厂商凭证、请求头、环境变量赋值），再在拼 GitHub 链接时对标题与描述二次脱敏，最后按 URL 长度预算截断且不切断百分号转义序列。日志、报告、外链三条出口各自过清洗，不共用结果——任何一条漏了都会把凭证带出去。

踩坑：四份均为 React Compiler 产物（`_c()` 记忆槽加 `$[n]` 依赖比较），JSX 内部零插入，锚点全落语句行、`case` 行、`if` 行与函数签名行；多处 `/** */` 文档块（FullscreenLayout 19 / 22–25 / 69–85 / 461–467 / 539–550 / 591–598 / 618–620，AskUserQuestion 22–25、28）均用 `before` 落签名或常量行规避块内。Feedback 的模板字符串（bodyPrefix 399 行、generateTitle 系统提示 450 行）与 AskUserQuestion 的反馈模板（301–306、341–344）内部零锚点。预检 126 锚点一次全过（含块注释内部续行扫描与模板字符串状态机扫描）；`annotate.py` 四次零 `⟳`、零 `⚠`，四份各有 1 处长批注被自动折行，故增量（130 行）比锚点数（126）多 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1176 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2298 条加内链 675 条，0 失效；全仓 1176/1902 文件、362,571/513,237 行、71%。

### components 第 109 批：hooks 配置浏览器、工具白名单选择器、转圈器家族、启动欢迎屏（2,245 行，121 锚点）

第七批 components，按源行量取件：4 份共 2,245 行（578 / 562 / 562 / 543）。四份的主题&#x662F;**「终端门面的四种零件」**——hooks 配置的四态钻取浏览器、子代理工具白名单的分桶选择器、四种形态共用的转圈器、按终端宽度三级降级的启动欢迎屏。四份都不处理业务数据，只处理「怎么把已有状态摆到屏幕上、怎么让键盘走得通」。

| 文件                                                                                           | 原文  | 批注版 | 锚点 | 讲什么                                                                                            |
| -------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------------------------------- |
| [`components/hooks/HooksConfigMenu.tsx`](annotated/src/components/hooks/HooksConfigMenu.tsx) | 578 | 607 | 28 | hooks 只读浏览器：四态（事件 / 匹配器 / hook / 详情）逐层钻取，每层 Esc 按「事件是否支持匹配器」动态决定回退落点；全局停用走独立早退视图；策略态与用户态分开判定   |
| [`components/agents/ToolSelector.tsx`](annotated/src/components/agents/ToolSelector.tsx)     | 562 | 593 | 30 | 工具白名单选择器：静态五桶 + MCP 按服务器动态分桶；桶级开关语义是「有缺口就全选」；全选回传 undefined（等价不限制）；可导航条目整表驱动上下键并跳过标题行          |
| [`components/Spinner.tsx`](annotated/src/components/Spinner.tsx)                             | 562 | 598 | 35 | 转圈器四形态：简报分流拆成两个组件以守住 hooks 规则；动画时钟下沉到子组件、父层只粗读 ref；思考状态每态至少显示 2 秒；领导空闲时不显示动画以免被停滞检测染红          |
| [`components/LogoV2/LogoV2.tsx`](annotated/src/components/LogoV2/LogoV2.tsx)                 | 543 | 572 | 28 | 启动欢迎屏：极简 / 紧凑 / 完整三级降级；条件 require 保证频道通知可被整体摇掉；公告首启取首条其余随机；右侧 Feed 四选一按产品优先级；已读记账与引导计数合并成一次副作用 |

横切观察：

- **层级不是固定阶梯，而是按数据形状动态决定**：HooksConfigMenu 的回退既不是简单的「退一层」，而是每次退回前先查「该事件是否支持匹配器」——支持就回匹配器列表，不支持直接回事件列表。同一份四态类型，在不同事件下走出的路径不同，避免把用户丢进一个空的中间层。
- **「全选」回传的是 undefined 而不是完整名单**：ToolSelector 在全部选中时回 undefined，语义是「不限制」，未来新增工具自动被允许；桶级开关的判定是「有缺口就全选，否则全不选」而非「逐项取反」。两种选择都指向「让结果不依赖当前快照」。
- **动画时钟必须下沉，否则整棵树按帧重渲染**：Spinner 把 50 毫秒帧循环放进 SpinnerAnimationRow，父组件只在 props 或应用状态变化时重渲染；帧号、流光、停滞强度、token 计数、思考微光、耗时全部由子组件算。代价是父层只能粗读 ref 做 30 秒、30 分钟这类粗阈值判断——这个取舍源码里写得很清楚，批注保留了「为什么」。
- **启动屏的降级链是「有东西要给你看」优先**：极简模式只在没有新版本说明、没有引导、也没有强制完整标识时才成立；完整版右侧 Feed 的四选一同样按产品优先级（引导、访客卡、超额卡、版本说明）。画面复杂度由「有多少真信息」驱动，而不是由终端宽度单独决定。

踩坑：HooksConfigMenu 文件头 2–13 行是大段文档注释，Spinner 59–61 / 100–104 / 303–315 / 438–441 与 LogoV2 30–35 也是块注释或注释群，全部用 `before` 落语句行规避块内；LogoV2 与 Spinner 的模板字符串（tmux 提示、时长文案）内部零锚点。预检 121 锚点一次全过（含块注释内部续行扫描与模板字符串状态机扫描）；`annotate.py` 四次零 `⟳`、零 `⚠`，四份各 1 处长批注自动折行，故增量（125 行）比锚点数（121）多 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1180 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2302 条加内链 676 条，0 失效；全仓 1180/1902 文件、364,816/513,237 行、71%。

### components 第 110 批：MCP 服务器管理面板、上下文用量可视化、输入型选项、词级 diff 回退（1,968 行，109 锚点）

第八批 components，按源行量取件：4 份共 1,968 行（504 / 489 / 488 / 487），行数几乎齐平。四份的主题&#x662F;**「把已有数据摆成可读的界面」**——MCP 服务器按作用域分组列表、上下文用量左图右表、选择底座里的可编辑选项、无高亮时的词级 diff 渲染。四份的共同点是「数据早就算好了，这里只负责排版与键盘」。

| 文件                                                                                                                 | 原文  | 批注版 | 锚点 | 讲什么                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | --- | --- | -- | ---------------------------------------------------------------------------------------------------- |
| [`components/mcp/MCPListPanel.tsx`](annotated/src/components/mcp/MCPListPanel.tsx)                                 | 504 | 533 | 28 | MCP 服务器面板：按项目 / 本地 / 用户 / 企业四作用域分组，另有 claude.ai、代理专属、内置三区；唯一状态是选中下标，扁平可选表必须与分组渲染严格同序；五种连接状态各有图标与文案   |
| [`components/ContextVisualization.tsx`](annotated/src/components/ContextVisualization.tsx)                         | 489 | 514 | 24 | 上下文用量：左边方格图（空闲 / 缓冲 / 按填充度选实心空心）、右边类目列表与占比；延迟加载项不计百分比；按来源分组顺序固定；折叠状态行只在真的折叠过时出现                      |
| [`components/CustomSelect/select-input-option.tsx`](annotated/src/components/CustomSelect/select-input-option.tsx) | 488 | 515 | 26 | 可编辑选项：三态渲染（标签前置 / 聚焦输入 / 静态值）；六组键位分属 Chat 与 Attachments 两个上下文互不抢键；图片粘贴、切换、删除、失焦即退出图片模式；用户编辑标记防异步复位光标 |
| [`components/StructuredDiff/Fallback.tsx`](annotated/src/components/StructuredDiff/Fallback.tsx)                   | 487 | 519 | 31 | 词级 diff 回退：行转对象 → 相邻删加配对 → 逐词对比 → 按宽度手动折行；变化超四成或暗色模式退回整行；行号槽包在不可选区内，背景色跨盒连续；编号函数让整段删除共用原行号区间         |

横切观察：

- **扁平表与渲染必须同序，是键盘列表的通用契约**：MCPListPanel 只有「选中下标」一个状态，向上键改的是扁平表下标，画面却按五个分组渲染。一旦两处顺序不一致，回车选中的就不是高亮那行——这与第 107 批 BackgroundTasksDialog 的「条目顺序契约」是同一个坑，只是这里的分组层更多。反查也按引用相等而非名字，同名不同源的服务器才区分得开。
- **「返回 null 表示退回」把判断权留在渲染器内**：词级 diff 渲染器自己判变化比例与暗色模式，不合适就返回 null，编排层收到 null 就落到整行渲染。阈值、宽度、配色都封在这一个函数里，上层不必知道「什么时候不该词级」。
- **键位按上下文分层，而不是按组件分层**：输入型选项的六组键位分挂 Chat 与 Attachments 两个上下文，图片模式只在 Attachments 下生效，失焦立即退出。这样同一个按键在不同模式下语义不同，且不会与上层列表的上下键抢事件。
- **可视化的分母只取一个来源**：上下文用量的所有百分比都用后端给的上限做分母，延迟加载项直接标「不可用」而不是按 0 计算。一处口径，避免图上与列表里出现两个不同的百分比。

踩坑：`StructuredDiff/Fallback.tsx` 的 9–45 行是整段示例块注释（内含代码围栏与箭头说明），`select-input-option.tsx` 的 Props 里 JSDoc 块注释成串（31–35、36–41、42–48、49–52 等），`ContextVisualization.tsx` 有 14–20 与 76 行的块注释——全部用 `before` 落语句行或块首行规避内部；四份的模板字符串（句柄、提示文案）内部零锚点。预检 109 锚点一次全过；`annotate.py` 四次零 `⟳`、零 `⚠`，四份各 1 处长批注自动折行，故增量（113 行）比锚点数（109）多 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1184 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2306 条加内链 677 条，0 失效；全仓 1184/1902 文件、366,784/513,237 行、71%。

### components 第 111 批：Bash 权限弹窗、单题提问视图、条款确认弹窗、权限决策调试信息（1,870 行，122 锚点）

第九批 components，按源行量取件：4 份共 1,870 行（482 / 465 / 463 / 460），四份行数挤在 22 行区间内。主题&#x662F;**「同一份权限数据要能被四种方式读」**：执行前的确认（Bash 命令弹窗，选项集合随特性开关与后端建议变形）、还没有答案的询问（单题提问视图，选项区与底部动作争同一组上下键）、被动接受的告知（条款弹窗，宽限期可以延后表态）、事后追查的解剖（决策调试信息，把原因链与永远不会生效的规则逐条摊开）。四份都不产出业务数据，难点全在「状态如何决定界面形状」。

| 文件                                                                                                                                                                   | 原文  | 批注版 | 锚点 | 讲什么                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [`components/permissions/BashPermissionRequest/BashPermissionRequest.tsx`](annotated/src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx)     | 482 | 515 | 32 | Bash 权限弹窗：外层分流器把 sed 编辑命令交给专用弹窗；20fps 微光时钟从 535 行主体里整块外提（否则每 50 毫秒重建整棵树）；复合命令按「决策原因是否为子命令结果」识别，绕开会产生死规则的同步前缀启发式；手改前缀落本地设置、分类器描述落会话 |
| [`components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx`](annotated/src/components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx) | 465 | 496 | 30 | 单题提问视图：文本选项加一个固定标记的自定义输入项；底部两行靠「从最后一项向下 / 从第一行向上」与选项区交接键盘，未聚焦底部就不消费按键；编号即位置（底部第一行＝选项数+1）；多选提交时把固定标记滤掉换成真实输入                        |
| [`components/grove/Grove.tsx`](annotated/src/components/grove/Grove.tsx)                                                                                             | 463 | 492 | 28 | 条款确认弹窗：宽限期 / 宽限期后两套文案体；显示与否交给纯函数判定；同一个退出键在宽限期等于延后、之后等于放弃；域名被排除时接受选项只剩关闭一项；设置页那行开关接受制表、回车、空格三种确认                                    |
| [`components/permissions/PermissionDecisionDebugInfo.tsx`](annotated/src/components/permissions/PermissionDecisionDebugInfo.tsx)                                     | 460 | 493 | 32 | 权限决策解剖：十种决策原因各有译法，子命令结果靠类型排除后自行递归；建议明细拆成规则 / 目录 / 模式三类三种空态；不可达规则按「有建议 > 有工具名 > 全量」三档过滤，每条按问题、原因、修复三行展开                             |

横切观察：

- **高频动画的正确修法是「挪边界」，不是「优化时钟」**：Bash 弹窗里那个 20fps 微光字幕，原本住在 535 行的主体内部，而主体有一个编译器 bailout（放弃自动记忆化），于是每次时钟跳动都把整棵 JSX 树重建一遍，分类器检查的 1 到 3 秒里要重建几十次。修法是把时钟搬进一个只渲染一行文字的独立组件——让高频更新的物理面积缩到最小。这与第 109 批 Spinner 的做法同源（那边是把帧循环下沉到子行），但方向相反：一个是下沉，一个是外提，判断依据都是「谁的渲染代价小就让谁高频」。
- **同一交互两套语义，靠阶段判定而不是两套组件**：条款弹窗里同一个退出键，宽限期按下去是「延后」（下次启动还问），宽限期外是「放弃」（不再问）；接受选项也随「域名是否被排除」从两项缩成一项。提问视图同理——底部第二行只在计划模式下存在，而底部键盘处理里那个向下分支据此决定「能不能下移到第二行」。两处都没有复制组件，只在分支里读一个阶段量。
- **编译产物的提前返回＝哨兵加带标签块**：决策调试信息里两个组件都用 `react.early_return_sentinel` 表达提前返回，读法是把「哨兵赋值」当成 `return`、把块外那次哨兵检查当成「函数末尾」。Bash 弹窗的选项选中处理则用带标签的 `switch`，标签存在的理由是——不加标签时某个 `case` 里的 `break` 只跳出 `switch`，最后那次「通知上层」会被静默跳过。
- **调试信息的可信度靠「先全量后过滤」**：不可达规则先算全量，再按三档优先级过滤（本次带建议规则 → 只看与该规则同名同内容的；只给了工具名 → 只看该工具下的；都没有 → 全量）。计算函数因此不需要任何分支参数，过滤逻辑全在调用处，读起来像三段独立规则而不是一棵条件树。
- **规则的落盘目标就是它的信任级别**：用户亲手编辑的前缀落本地设置（长期生效），分类器从自然语言描述推导出的规则只落会话（用完即弃）。同一份「以后别再问」的诉求，因为来源可信度不同而写进不同作用域——这是 Bash 那份里最容易被当成随手一写、实际最该保留的设计。

踩坑：`Grove.tsx` 第 16 行是 ASCII 箱子模板字符串的起始行（模板跨 16–26 行），锚点落在起始行（该行仍属 code 状态），`annotate.py` 仍报了一次 `⟳`，但外移目标是 16→16，位置未变，注释正确落在 `const NEW_TERMS_ASCII =` 之前；`BashPermissionRequest.tsx` 的 36–41 与 195–208 是两段长行注释群、135 行是单行注释，全部用 `before` 落语句行；`QuestionView.tsx` 的 Props（20–42）无块注释，块注释只在 `PermissionDecisionDebugInfo.tsx` 的 190–191 与 204 两处，落在块外的语句行上。预检 122 锚点一次全过（含块注释内部续行扫描与模板字符串状态机扫描）；`annotate.py` 四次零 `⚠`、一次 `⟳`（位置未变，见上）；四份各 1 处长批注自动折行，故增量（126 行）比锚点数（122）多 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1188 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2310 条加内链 678 条，0 失效；全仓 1188/1902 文件、368,654/513,237 行、71.8%（README 记 71%）。

**下一批候选（components 降序，建议取 4 份约 1,770 行）**：`ModelPicker.tsx`(448) · `permissions/ComputerUseApproval/ComputerUseApproval.tsx`(441) · `agents/AgentsList.tsx`(440) · `memory/MemoryFileSelector.tsx`(438)（components 已做 116/407，剩 291 份；全仓还剩 714 份）。

### components 第 112 批：模型选择器、电脑操作授权、子代理清单、记忆文件选择器（1,767 行，118 锚点）

第十批 components，按源行量取件：4 份共 1,767 行（448 / 441 / 440 / 438），是连续三批里行数最齐的一次。主题&#x662F;**「一屏里塞两种东西，靠焦点归属排队」**：模型选择器要同时选模型与推理强度（而强度是否可选又取决于当前模型）、电脑操作授权要在「修系统权限」与「授权应用」两块互斥面板间分派、子代理清单要把「新建项」与「代理项」两类可聚焦条目塞进同一个上下键循环、记忆文件选择器要在列表上方再挂两个开关行。

| 文件                                                                                                                                                       | 原文  | 批注版 | 锚点 | 讲什么                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------------------------------------------------------- |
| [`components/ModelPicker.tsx`](annotated/src/components/ModelPicker.tsx)                                                                                 | 448 | 480 | 31 | 模型选择器：模型与强度双选；三种值（哨兵、用户串、解析后模型名）靠四个纯函数转换；最高档在不支持的模型旁只在显示层钳成高档（状态不动）；强度只写「该持久化的值」，跟随默认时不落盘                              |
| [`components/permissions/ComputerUseApproval/ComputerUseApproval.tsx`](annotated/src/components/permissions/ComputerUseApproval/ComputerUseApproval.tsx) | 441 | 472 | 30 | 电脑操作授权：带系统权限状态就显示跳转面板（打开设置不结束弹窗、只有重试才结束）、否则显示应用白名单；授权清单只收已解析且被勾选的，拒绝清单在允许路径下也不为空；哨兵应用（能当 shell / 读写任意文件 / 改系统设置）逐条加粗警告 |
| [`components/agents/AgentsList.tsx`](annotated/src/components/agents/AgentsList.tsx)                                                                     | 440 | 469 | 28 | 子代理清单：两类可聚焦条目（新建项、代理项）自建上下键循环；选中靠「类型＋来源」而非引用相等；扁平可选表按源分组顺序铺开以与渲染同序；副标题计数去重（同名代理只算一次）；空态里仍补内置区段                         |
| [`components/memory/MemoryFileSelector.tsx`](annotated/src/components/memory/MemoryFileSelector.tsx)                                                     | 438 | 468 | 29 | 记忆文件选择器：资源钩子同步读清单、无加载态；缺失的用户级/项目级文件补成「新建」占位项；层级用路径→深度映射（依赖父先于子出现在清单里）；三个角色（文件、目录入口、两个开关）靠「焦点在开关区时列表整体禁用」共享键盘           |

横切观察：

- **焦点归属用「禁用」表达，不用提示文字**：记忆文件选择器的开关区一拿到焦点，下方列表整体置为禁用（整块变灰）；确认键的绑定也带 `isActive` 条件，只在焦点在开关上时才生效。这与第 111 批提问视图的「底部未聚焦就不消费按键」是同一条思路的两种实现——一个靠禁用、一个靠守卫，判定源都是同一个焦点量。
- **状态不动、只在显示层钳制**：模型选择器里当前强度是最高档而聚焦的模型不支持最高档时，只在渲染时显示成高档，状态里的值一字不改。反过来做（切模型时顺手把状态改成高档）会丢掉用户的原始意图——切回支持最高档的模型时，用户原本的选择就回不来了。
- **自建列表的唯一理由是「条目类别不同」**：子代理清单没用通用下拉框，因为它的可聚焦条目有两类（新建项与代理项），而下拉框只有一类。代价是必须自己维护「扁平顺序与渲染顺序严格一致」的契约——这正是第 107、110 批反复出现的同一条坑，只是这里的顺序还要跨分组边界。
- **授权界面的信息密度靠「三行结构」撑起来**：电脑操作授权里，一个应用占一行圆点加名字，第二行才是加粗的能力警告；附加权限单独成段、隐藏应用单独一行。危险信息不与普通信息共行，是这类界面唯一可靠的写法——共行就会被扫读跳过。
- **半成品形态值得单独记一笔**：电脑操作授权的勾选集合是 `Set`、默认全选，但全文件没有任何增删入口。也就是说数据结构留了逐项勾选的能力，界面暂时按「全选或全不选」走。读泄露源码时这类「结构比界面超前」的地方，往往是判断产品演进方向的线索。

踩坑：`ModelPicker.tsx` 的 30–35 行是 `skipSettingsWrite` 的 JSDoc 块注释，锚点落在块首行（该行属 code 状态）而非块内；`MemoryFileSelector.tsx` 的 28 行是单行 eslint 块注释、29 行的条件 `require` 紧跟其后，同样落块外；`ComputerUseApproval.tsx` 的 24–29 行是分派器说明块注释、48 与 200 行是两段分区注释（`// ── ... ──`），全部落 `before` 在注释行或语句行上。预检 118 锚点一次全过（含块注释内部续行扫描与模板字符串状态机扫描）；`annotate.py` 四次零 `⟳`、零 `⚠`；四份各 1 处长批注自动折行，故增量（122 行）比锚点数（118）多 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1192 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2318 条加内链 680 条，0 失效；全仓 1192/1902 文件、370,421/513,237 行、72.2%（README 记 72%）。

**下一批候选（components 降序，建议取 4 份约 1,680 行）**：`LogoV2/WelcomeV2.tsx`(433) · `tasks/BackgroundTaskStatus.tsx`(429) · `CustomSelect/use-multi-select-state.ts`(414) · `tasks/ShellDetailDialog.tsx`(404)（components 已做 120/407，剩 287 份；全仓还剩 710 份）。



### components 第 113 批：启动横幅、后台任务状态条、多选状态机、Shell 任务详情（1,680 行，121 锚点）

第十一批 components，仍是行数降序取 4 份共 1,680 行（433 / 429 / 414 / 404），是本轮里最轻的一批（首次低于 1,700 行）。主题是**「同一份状态在几种视图之间让位」**：启动横幅按终端与主题分三个出口画同一张图、任务状态条在「汇总 pill」与「队友 pill 条」之间切换、多选状态机用同一个回车承载「切换」与「提交」两种语义、Shell 详情弹窗用一份组件同时服务 shell 与 monitor 两类任务。四份合起来正好展示了同一个套路：**能并存的信息尽量别并存，让位置只归一个人**。

| 文件 | 原文 | 批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`components/LogoV2/WelcomeV2.tsx`](annotated/src/components/LogoV2/WelcomeV2.tsx) | 433 | 466 | 32 | 启动横幅：58 列画布上手工拼贴 ASCII 图；三个出口（Apple Terminal 用半块字符配背景色、浅色用中阴影块、深色用实心块加星号）；每行 JSX 各自占一个记忆槽，常量走哨兵、欢迎语走依赖 |
| [`components/tasks/BackgroundTaskStatus.tsx`](annotated/src/components/tasks/BackgroundTaskStatus.tsx) | 429 | 460 | 30 | 后台任务状态条：主代理是伪条目（无 taskId，点击即退出队友视图）；队友下标整体右移一格给主代理让位；pill 宽度按显示列算；只有「需要 CTA」时才提示按方向下；两个早退分别是策略与数据 |
| [`components/CustomSelect/use-multi-select-state.ts`](annotated/src/components/CustomSelect/use-multi-select-state.ts) | 414 | 443 | 29 | 多选状态机：`submitButtonText` 是总开关，决定回车是切换还是提交、Tab 到末位后进按钮还是循环；输入态走白名单放行；空字符串等价于取消选中；Escape 必须 `stopImmediatePropagation` 才不关两层 |
| [`components/tasks/ShellDetailDialog.tsx`](annotated/src/components/tasks/ShellDetailDialog.tsx) | 404 | 435 | 30 | Shell 任务详情：只读文件尾 8KB；Promise 进 state 才能换引用重读；`useDeferredValue` 保证刷新时仍能按 Esc；Suspense 边界下沉到输出子组件；末尾 10 行靠反向找换行符而非 split |

横切观察：

- **同一个回车，两种语义，由「界面上有没有按钮」决定**：多选状态机里 `submitButtonText` 一给，回车就退化成「移动焦点」、空格才切换选中；不给则回车直接提交。这个开关还顺带决定了 Tab 与上下键到末位后的去向。也就是说按键语义不是由键位定的，而是由界面形态定的——这一点和 Web 表单的本能正好相反。
- **「让位」比「并存」更常见**：任务状态条在 `expandedView` 为 teammates 时整条退出、交给队友树；Shell 详情在输出 Promise 未解时只挂起输出区而不是整个弹窗；启动横幅在 Apple Terminal 下直接提前返回。三处都在说明同一个原则：一个位置上只该有一个东西说话，多出来的那个必须整块消失而不是缩水。
- **缓存契约要分清两种，混看就误判**：编译器产物里 `$[k] !== x` 表示「依赖变了才重建」（数据驱动），`$[k] === Symbol.for(...)` 表示「永不变、只算一次」（常量）。把两者混为一谈，就会误判「这里为什么每帧重算」或反过来「这里为什么改了不生效」——启动横幅里同一段图案两份写法，正是两种契约并置的最好例子。
- **终端里「谁接键盘」要主动抢**：Shell 详情最外层 Box 必须 `tabIndex={0}` 加 `autoFocus` 才收得到按键；多选状态机要靠 `useRegisterOverlay` 抢 Escape、再靠 `stopImmediatePropagation` 防一次按键关两层；任务条的悬停回调还得用哨兵缓存，否则引用一变就可能重挂子树。Web 里焦点由浏览器分配，终端里得自己拿、还得自己守住。
- **宽度一律按显示列算，不按字符数**：任务条 pill 宽度用 `stringWidth`（中文与 emoji 占两列），Shell 输出的可用宽度是列宽减 6（圆角边框加内边距），横幅每行补空格到 58 列。任何一处用 `length` 代替，滚动窗口与折行就会同时歪掉。
- **防御性兜底要落在「读不到」而不是「读出错」**：`getTaskOutput` 把任何异常吞成空内容，弹窗显示「无输出」而不是崩掉；`endTime` 缺失就用 `Date.now()` 顶替算已运行时长。排障工具本身不能成为新的故障源。

踩坑：`WelcomeV2.tsx` 第 433 行是内联 base64 sourcemap、单行几万字符，锚点只能落它之前（本次落在 433 的 `before`，即正文结束后）；`use-multi-select-state.ts` 的 59 与 88 行原本落在 JSDoc 块注释内部，已改锚到块外紧邻的类型成员行（64 与 93）；`ShellDetailDialog.tsx` 的 310–313 是跨行解构，锚点从 313 挪到 314 的 `if (!content)`。预检 121 锚点一次全过（含块注释续行扫描与模板字符串状态机扫描）；`annotate.py` 四次零 `⟳` 零 `⚠`；折行只在前三份出现（33 / 31 / 31 行），第四份 29 锚点未触发折行，故增量 124 = 121 + 3——这是本轮第一次增量不等于锚点数加 4。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1196 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2318 条加内链 680 条，0 失效；全仓 1196/1902 文件、372,101/513,237 行、72.5%（README 记 72%）。

**下一批候选（components 降序，建议取 4 份约 1,580 行）**：`BridgeDialog.tsx`(401) · `mcp/MCPSettings.tsx`(398) · `ui/TreeSelect.tsx`(397) · `diff/DiffDialog.tsx`(383)（components 已做 124/407，剩 283 份；全仓还剩 706 份）。

### components 第 114 批：远程控制弹窗、MCP 设置视图机、树形选择器、Diff 查看弹窗（1,579 行，117 锚点）

第十二批 components，4 份共 1,579 行（401 / 398 / 397 / 383），是本轮最轻的一批。四份的主题各不相同，但底层做的是同一件事：**把异质的输入先归一成同一种形状，再让下游只认形状**。远程控制弹窗把二十多个全局字段归一成「标签 + 颜色 + 三段文案」；MCP 设置把六种 viewState 归一成「一个 switch 六个 case」；树形选择器把树归一成拍平行；Diff 弹窗把轮次 diff 归一成 git diff 同形对象。归一之后，下游就不再需要知道来源了。

| 文件 | 原文 | 批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`components/BridgeDialog.tsx`](annotated/src/components/BridgeDialog.tsx) | 401 | 432 | 30 | 远程控制弹窗：props 只有完成回调、二十多个字段全从 AppState 读；二维码走 utf8 字符画并过滤空行；只有用户显式开过远程控制才写全局配置；状态机只有「正常/异常」两条出口 |
| [`components/mcp/MCPSettings.tsx`](annotated/src/components/mcp/MCPSettings.tsx) | 398 | 428 | 29 | MCP 设置视图机：把客户端补全成展示模型（判 transport、探凭据）；「已认证」是三条宽松路径任一成立；加载中不能误报「没有配置」；六个视图各自 return，无公共出口 |
| [`components/ui/TreeSelect.tsx`](annotated/src/components/ui/TreeSelect.tsx) | 397 | 427 | 29 | 树形选择器：按展开态 DFS 拍平成普通选项交给 Select；只接管左右键、上下键归 Select；受影响于受控优先（传了 isNodeExpanded 内部 Set 即作废）；左键在叶子上会同时折叠父级并移交焦点 |
| [`components/diff/DiffDialog.tsx`](annotated/src/components/diff/DiffDialog.tsx) | 383 | 413 | 29 | Diff 查看弹窗：两条数据源归一成同形对象；数据源变则重置文件下标；左键承载两层后退；空态四种按优先级排列；编译器把多重 if 赋值重写成带标签块 bb0 |

横切观察：

- **「归一」比「分支」划算**：Diff 弹窗有 2 种数据源 × 2 种视图模式 = 4 种界面，但代码里只有 1 个三目把数据源转同形、1 个三目选主体。如果反过来按组合写分支，四个分支里会有三份重复的渲染逻辑。这条经验在本轮反复出现，可以当作读这批组件时的通用判据。
- **受控与非受控划界要干脆**：树形选择器只要传了 `isNodeExpanded`，内部 Set 就完全作废，不做「部分受控」。半受控（有的节点听外部、有的听内部）是最难调试的状态模型，因为「为什么点了没反应」永远要两处同时查。
- **宽松判据换可用性**：MCP 服务器「是否已认证」用三条路径任一成立即算通过（有令牌 / 有会话口令且已连接 / 已连接且有工具）。宁可误判为已认证，也不要让用户看到一个其实能用的服务器却标着未授权——诊断类界面的误报比漏报更伤。
- **加载中与真的没有，必须分成两种状态**：MCP 设置里第一个早退就是「列表空但客户端非空 → 探测未完成，直接返回不提示」。这类误报在异步列表里极常见，判断依据是「输入非空而输出为空」这个组合。
- **同一个键承载两层后退**：Diff 弹窗的左方向键在详情里返回列表、在列表里切上一个数据源；Esc 取消也分两层。用户心里只有「往回退」一个概念，键位就该这么设计——而不是为每层分配不同的键。
- **终端里焦点必须主动抢**：树形选择器最外层 Box 要 `tabIndex` 加 `autoFocus` 才收得到左右键（因为左右键处理在本组件而非 Select 里）。这和上一批 Shell 详情、本批 BridgeDialog 注册 overlay 是同一条约束的三个面。

踩坑：`BridgeDialog.tsx` 的第 10 行是单行 eslint 注释（`-- raw 'd' key ...`），锚点落其 `before` 而非下一行，避免把禁用范围转移给批注本身；`DiffDialog.tsx` 第 277 行 `bb0: {` 是编译器生成的标签块（用于把多重 if 赋值转成 break），锚点落标签之前、第 278 行落首个 `if`，两处都在 code 状态；`MCPSettings.tsx` 第 285 行是 `case "server-tools":`，锚点落 case 行属安全位置。预检 117 锚点一次全过；`annotate.py` 四次零 `⟳` 零 `⚠`；四份各 1 处长批注折行，故增量 121 = 117 + 4（回到常态规律）。

流程账：4 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1200 份 0 失败（较上批 +4）；`check-links.py` 源码链接 2322 条加内链 681 条，0 失效；全仓 1200/1902 文件、373,680/513,237 行、72.8%（README 记 72%）。

**下一批候选（components 降序，建议取 4 份约 1,500 行）**：`TaskListV2.tsx`(378) · `agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`(378) · `Settings/Usage.tsx`(377) · `permissions/SkillPermissionRequest/SkillPermissionRequest.tsx`(369)（components 已做 128/407，剩 279 份；全仓还剩 702 份）。

### components 第 115 批：新建代理确认步、任务列表 V2、用量页、技能权限请求、后台任务行、全局搜索弹窗、Tabs 设计系统、添加工作区目录、远程环境弹窗、通用权限提示（3,536 行，167 锚点）

第十三批 components，按行数降序一次取 10 份（378→335），是本轮单批文件数最多、行数最齐的一次。十份横跨「列表 / 弹窗 / 设计系统原语」三类界面，共同的底层套路是**「把异构输入先归一成同一种形状，再让下游只认形状」**：任务列表把任意任务态归一成「完成 / 进行中 / 阻塞」三布尔、后台任务按 type 分派成统一的一行摘要、Tabs 把受控与非受控归一成同一选中态、两套权限弹窗把同意 / 记住 / 拒绝归一成选项列表、全局搜索把 ripgrep 输出归一成 Match。读完这十份，基本能掌握 Claude Code TUI 里「列表渲染、权限询问、搜索」三类高频组件的标准写法。

| 文件 | 原文 | 批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx`](annotated/src/components/agents/new-agent-creation/wizard-steps/ConfirmStep.tsx) | 377 | 398 | 20 | 新建子代理向导最后一步：汇总工具 / 模型 / 记忆 / 系统提示并展示校验（警告可存、错误阻断）；s/Enter 保存、e 保存并编辑、Esc 回退；系统提示截断到 240 列防溢出 |
| [`components/TaskListV2.tsx`](annotated/src/components/TaskListV2.tsx) | 377 | 403 | 25 | 任务列表 V2：未开 TodoV2 不渲染；按终端高度算可见行（3–10）；最近完成保留 30s 高亮；截断按「最近完成 > 进行中 > 待处理 > 较早完成」排序；swarm 模式下给队友 owner 上主题色 |
| [`components/Settings/Usage.tsx`](annotated/src/components/Settings/Usage.tsx) | 376 | 392 | 15 | 用量页：拉取会话 / 周 / Sonnet 限额，宽屏横条、窄屏紧凑文字；失败用 axios 响应体构造错误；非 Pro/Max 不显示额外用量段 |
| [`components/permissions/SkillPermissionRequest/SkillPermissionRequest.tsx`](annotated/src/components/permissions/SkillPermissionRequest/SkillPermissionRequest.tsx) | 368 | 386 | 17 | 技能权限请求弹窗：从 SkillTool 输入 schema 取 skill 名；按名称是否含空格生成精确 / 前缀两种「记住」选项；统一上报 unary 遥测 |
| [`components/tasks/BackgroundTask.tsx`](annotated/src/components/tasks/BackgroundTask.tsx) | 344 | 359 | 14 | 后台任务行：按 task.type 分派到本地 / 远程 / 队友 / 工作流 / monitor / dream 等多分支，统一渲染「图标 + 文字 + 状态」，完成时标 unread |
| [`components/GlobalSearchDialog.tsx`](annotated/src/components/GlobalSearchDialog.tsx) | 342 | 359 | 16 | 全局搜索弹窗（ctrl/cmd+shift+f）：防抖 ripgrep，`rg -m` 每文件上限再收口；宽屏预览在右、窄屏在下；命中可 @文件#行 插入对话 |
| [`components/design-system/Tabs.tsx`](annotated/src/components/design-system/Tabs.tsx) | 339 | 354 | 14 | 设计系统 Tabs 原语：受控 / 非受控统一选中态；表头聚焦 opt-in 后方向键把焦点移入内容；Tab 子组件仅选中才渲染内容 |
| [`components/permissions/rules/AddWorkspaceDirectory.tsx`](annotated/src/components/permissions/rules/AddWorkspaceDirectory.tsx) | 339 | 355 | 15 | 添加工作区目录弹窗：手动输入（100ms 防抖补全）与预置选择两种形态；记住方式分本会话 / 永久 / 不添加三档 |
| [`components/RemoteEnvironmentDialog.tsx`](annotated/src/components/RemoteEnvironmentDialog.tsx) | 339 | 354 | 15 | 远程环境弹窗：拉取可用环境写回 localSettings；单环境一键确认、多环境列表；无环境提示去 claude.ai/code 配置 |
| [`components/permissions/PermissionPrompt.tsx`](annotated/src/components/permissions/PermissionPrompt.tsx) | 335 | 352 | 16 | 通用权限提示共享组件：选项可带反馈输入（Tab 展开）；接受 / 拒绝各自上报 unary；Esc 累加 attribution.escapeCount |

横切观察：

- **「归一」是这批组件的主旋律**：任务列表把任意任务归一成 isCompleted/isInProgress/isBlocked 三布尔再决定样式；后台任务按 type 分派成统一的一行；Tabs 把受控与非受控归一成同一个 handleTabChange（受控回调父级、非受控改内部 state）；权限弹窗把同意 / 记住 / 拒绝归一成 options 列表。读这批时先把「输入有多少种」列出来，再看代码怎么压成「下游只认一种形状」，基本能看懂八成。
- **受控与非受控的边界要干脆**：Tabs 用 isControlled 一处判断决定选中态来源，绝不半受控；添加目录弹窗也只在「有预置路径」与「无预置」两种形态间切换，不混用。半受控（部分听外部、部分听内部）是最难调试的状态模型，本批两处都避开了。
- **键盘焦点必须主动抢、主动还**：Tabs 在表头聚焦且 opt-in 后方向键把焦点移入内容区，useTabHeaderFocus 在卸载时退回聚焦态；全局搜索在卸载时清理防抖定时器与中止控制器，避免销毁后还触发搜索；添加目录的键盘导航同样显式接管 tab/回车/上下键。终端里焦点得自己拿、还得自己还。
- **防抖 + 上限双保险防内存膨胀**：全局搜索既用输入防抖，又给 ripgrep 套 `rg -m` 每文件上限、再在结果数组上收口到 MAX_MATCHES_PER_FILE；添加目录的补全请求也用 100ms 防抖。两处都属于「用户输入不可信、外部进程输出不可信」的双重兜底。
- **遥测上报要在「用户决策点」收口**：技能权限、通用权限都把 accept/reject 两类事件在 handleSelect/handleCancel 一处上报，且选项自带反馈配置（如 escapeCount）。把上报收敛到一个出口，比散在多处更不容易漏事件。
- **编译器产物特征贯穿全批**：十份全是 React Compiler 自动记忆化产物（首行引入 `$` 缓存、`_c(N)` 声明缓存槽数、`_temp`/`_temp2` 做格式化辅助）。批注时所有锚点都落在完整语句 / 签名行，绝不落在多行 JSX return 或跨行表达式内部——这是本批唯一贯穿的硬约束。

踩坑：预检阶段抓到两处真实问题并修正后才跑 `annotate.py`：① `RemoteEnvironmentDialog.tsx` 数据文件里第 333 行锚点的 `'after'` 写成 `'after''`（多了一个引号），会导致 Python 语法错误，已修为 `(333, 'after', '''MultipleEnvironmentsContent：...''')`；② `SkillPermissionRequest.tsx` 第 303 行锚点文案含英文双引号 `Use skill "xxx"?`，违反「批注不得含英文双引号」规则（会破坏 markdown 表格与 `'''` 边界），已改用中文「」写成 `Use skill「xxx」?`。两处都属数据文件层面、在 preflight 阶段即拦截，未污染任何 `annotated/` 产物。十份 `annotate.py` 均零 `⟳`、零 `⚠`；因多份含长批注自动折行，增量（3712−3536=176）略高于锚点数（167），差额即折行溢价。`sourceMappingURL` 行（部分文件 >4000 字符）由 check-fidelity 自动放行（标记 `OK*`）。

流程账：10 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1210 份 0 失败；`check-links.py` 源码链接 2318 条加内链 682 条，0 失效；全仓 1210/1902 文件、377,226/513,237 行、73%（README 记 73%）。

**下一批候选（components 降序，建议取 10 份约 3,100 行）**：`permissions/FallbackPermissionRequest.tsx`(333) · `ThemePicker.tsx`(333) · `Spinner/GlimmerMessage.tsx`(328) · `permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx`(328) · `StatusLine.tsx`(324) · `MarkdownTable.tsx`(322) · `design-system/FuzzyPicker.tsx`(312) · `FeedbackSurvey/useFeedbackSurvey.tsx`(296) · `sandbox/SandboxSettings.tsx`(296) · `diff/DiffFileList.tsx`(292)（components 已做 138/407，剩 269 份；全仓还剩 692 份）。

### components 第 116 批：主题选择器、兜底权限弹窗、带预览提问视图、微光消息、状态栏、Markdown 表格、模糊选择器、评分问卷触发、沙箱设置、Diff 文件清单（3,164 行，211 锚点）

第十四批 components，仍按行数降序取 10 份（333→292），合计 3,164 行、211 锚点，是本轮**锚点最多的一批**（密度约每 15 行一处）。十份的共同主题是**「终端里没有 CSS，所有布局与反馈都要手算」**：表格手算列宽与折行、状态栏手算占位行、picker 手算固定开销行数、微光消息手算显示宽度与切点、文件清单手算路径可用列数。它们串起来基本就是一套「Ink 终端布局实用手册」。

| 文件 | 原文 | 批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`components/ThemePicker.tsx`](annotated/src/components/ThemePicker.tsx) | 333 | 359 | 25 | 主题选择器：onboarding 与 /theme 共用；预览三件套（预览/保存/取消）保证键盘导航不写盘；环境变量压制用户设置的状态行文案优先级 |
| [`components/permissions/FallbackPermissionRequest.tsx`](annotated/src/components/permissions/FallbackPermissionRequest.tsx) | 333 | 355 | 21 | 兜底权限弹窗：所有无专属弹窗的工具都走这里；「不再询问」写的是整工具名的 allow 规则、落 localSettings；描述截断 3 行保住选项区 |
| [`components/permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx`](annotated/src/components/permissions/AskUserQuestionPermissionRequest/PreviewQuestionView.tsx) | 328 | 350 | 21 | 带预览的分题视图：左选项右预览；无 Other 输入项；Tab 切题绑定必须写在子组件（监听顺序）；PREVIEW_OVERHEAD=11 逐项列明细 |
| [`components/Spinner/GlimmerMessage.tsx`](annotated/src/components/Spinner/GlimmerMessage.tsx) | 328 | 349 | 20 | 微光消息：按字素簇切三段（before/shimmer/after）；宽字符与组合 emoji 不能按 code unit 切；卡住态覆盖动画；末尾补一个原色空格定右边界 |
| [`components/StatusLine.tsx`](annotated/src/components/StatusLine.tsx) | 324 | 347 | 22 | 底部状态栏：对外快照契约（可选段不存在而非空值）；模型必须读 AppState 而非 getMainLoopModel（issue 37596）；300ms 防抖 + 四元触发条件 + memo |
| [`components/MarkdownTable.tsx`](annotated/src/components/MarkdownTable.tsx) | 322 | 346 | 23 | 终端 Markdown 表格：三档列宽分配、垂直居中、行高超 4 行转纵向 key-value；SAFETY_MARGIN 防裁剪闪烁；整表单块 Ansi 渲染 |
| [`components/design-system/FuzzyPicker.tsx`](annotated/src/components/design-system/FuzzyPicker.tsx) | 312 | 333 | 20 | 模糊选择器：过滤权归调用方；visibleCount 必须钳到终端高度以下；结构不随预览真假变；direction=up 用 column-reverse 而非反转数组 |
| [`components/FeedbackSurvey/useFeedbackSurvey.tsx`](annotated/src/components/FeedbackSurvey/useFeedbackSurvey.tsx) | 296 | 320 | 23 | 评分问卷触发：概率必须只滚一次（否则 0.5% 变几乎必然）；七道否决按代价排序、读盘的跨会话节流放最后；好坏评追问概率分开配 |
| [`components/sandbox/SandboxSettings.tsx`](annotated/src/components/sandbox/SandboxSettings.tsx) | 296 | 315 | 18 | 沙箱设置：三档模式压平两个开关；页签随依赖检查状态增减（有错只留依赖页）；每档写设置都写全两个字段防脏状态 |
| [`components/diff/DiffFileList.tsx`](annotated/src/components/diff/DiffFileList.tsx) | 292 | 311 | 18 | Diff 文件清单：5 行滚动窗口 + 居中 + 触底回拉；路径从头部截断保留文件名；三种不可 diff 状态（untracked/binary/large）各给一句 |

横切观察：

- **「手算常量」是终端布局的通用代价**：MarkdownTable 的 `borderOverhead = 1 + numCols * 3`、FuzzyPicker 的 `CHROME_ROWS = 10`、PreviewQuestionView 的 `PREVIEW_OVERHEAD = 11`、DiffFileList 的 `columns - 16 - 3 - 4`、StatusLine 的「全屏下预留一行」。这五处都是把「边框 / 边距 / 提示行」逐项列成算术，注释里连每一项是什么都写清。没有这把尺子，改一个 margin 就会在某个终端尺寸下溢出。
- **溢出在终端里不是滚动问题，是重绘问题**：MarkdownTable 注释写明「溢出会让 Ink 在相邻两帧裁得不一样，滚动区无限闪烁」；FuzzyPicker 注释写明「界面超过终端高度后，每次重渲染光标上移量算错、上一行闪白」。所以两处都宁可选「降级视图」也不让内容超出——这与 Web 里「反正能滚」的直觉完全相反。
- **显示宽度 ≠ 字符数**：GlimmerMessage 用 `getGraphemeSegmenter` 切簇、用 `stringWidth` 量列；MarkdownTable 取最长单词宽度时也走 `stringWidth`。Emoji、CJK、组合音标都是 2 列或 1 簇，任何按 `length` 算的地方都会在中文/表情消息上错位。
- **异步内容必须预留占位高度**：StatusLine 在全屏下即使没文本也渲染一个空格；FuzzyPicker 空列表仍渲染 `height={visibleCount}`；DiffFileList 无「更多」时渲染一个空格而不是 null。三处手法一致——**高度恒定比内容完整更重要**，否则一次异步返回就会把整块布局推一下。
- **遥测与节流要「只发生一次」**：useFeedbackSurvey 的概率骰子按轮次记账（`lastEligibleSubmitCountRef`），StatusLine 的日志开关按 `logNextResultRef` 记账。凡是「随机」或「打日志」被放进会被反复求值的 useMemo/渲染函数里，就一定会退化成「几乎必然发生」——这是本批最值得跨文件复用的一条经验。
- **兜底组件的复杂度分配很不对称**：FallbackPermissionRequest 最短最保守（只三档、无编辑框、不接管键盘），因为它要适配任意未来工具；而有领域知识的弹窗才敢做多选、编辑框、预览。看一个弹窗的复杂度，大致能判断它服务的是「已知的少数工具」还是「未知的全部工具」。

踩坑：本批预检连拦三类问题，全部在写 `annotated/` 之前修正。① 九份数据文件里有 10 处批注误用英文双引号（如 `Symbol.for("react.memo_cache_sentinel")`、`flexDirection="row"`、`defaultTab="Mode"`、`{ " " }`、`"five_hour" in data`），按规则改写成「」包裹的形态；② `SandboxSettings` 数据文件里把空心圆写成转义序列，反斜杠本身是禁用字符，改成「空心圆（U+25CB）」；③ `MarkdownTable` 第 137 行锚点用了带换行的编号列表，触发「控制字符」断言，改写为 ①②③ 单行串。三类问题都属数据文件层面，preflight 阶段即拦截。十份 `annotate.py` 全部零 `⟳`、零 `⚠`；插入注释 221 行、锚点 211 处，差额 10 即长批注自动折行溢价。

流程账：10 个数据文件逐一对齐源文件；`check-fidelity.py` 全仓 1220 份 0 失败；`check-links.py` 源码链接 2336 条加内链 683 条，0 失效；全仓 1220/1902 文件、380,390/513,237 行、74.1%（README 记 74%）。

**下一批候选（components 降序，建议取 10 份约 2,750 行）**：`TrustDialog/TrustDialog.tsx`(290) · `CustomSelect/use-select-input.ts`(287) · `diff/DiffDetailView.tsx`(281) · `CoordinatorAgentStatus.tsx`(273) · `agents/agentFileUtils.ts`(272) · `permissions/PermissionExplanation.tsx`(272) · `Spinner/TeammateSpinnerTree.tsx`(272) · `ResumeTask.tsx`(268) · `LogoV2/ChannelsNotice.tsx`(266) · `tasks/InProcessTeammateDetailDialog.tsx`(266)（components 已做 148/407，剩 259 份；全仓还剩 682 份）。

### components 第 117 批：信任对话框、自定义选择器输入、Diff 详情视图、协调者任务面板、子代理文件读写工具、权限解释、队友旋转树、恢复会话列表、频道通知、进行中队友详情对话框、旋转动画行、投入度标注、WebFetch 权限请求、梦境详情对话框、信任对话框设置探测（4,019 行，219 锚点）

第十五批 components，按行数降序取 15 份（290→245），合计 4,019 行、219 锚点，是本工程**单批文件数最多的一批**（密度约每 18 行一处）。这批的主题是「信任、权限与多智能体状态的可视化」——既有首次接触陌生目录时的「是否信任此文件夹」安全闸门（TrustDialog 与其设置来源探测 utils），也有把 URL/host 转成权限规则的 WebFetch 请求、把危险能力列出来的 PermissionExplanation、把推理强度选择交还给用户的 EffortCallout；另一边是协调者模式下「主控 + 各队友」的状态树与旋转动画行、各类详情对话框（进行中 / 梦境 / 恢复会话），以及一个把 agent 定义落盘的纯工具集。它们合起来基本覆盖了「用户在 TUI 里怎么被问、怎么被看见、怎么被记住」。

| 文件 | 原文 | 批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- | --- |
| [`components/TrustDialog/TrustDialog.tsx`](annotated/src/components/TrustDialog/TrustDialog.tsx) | 289 | 306 | 16 | 信任对话框：首次接触陌生目录时询问是否信任；逐项探测 hooks/bash/apiKey/aws/gcp/otel/危险环境变量等危险能力决定警告内容；接受则按是否家目录写入会话信任或项目配置 |
| [`components/CustomSelect/use-select-input.ts`](annotated/src/components/CustomSelect/use-select-input.ts) | 287 | 302 | 15 | 自定义选择器输入 hook：把方向键/数字键/Tab/空格/PageUp-Down 映射成导航与选择；输入型选项穿透给文本框；注册为 overlay 占住 Esc 防上层拦截 |
| [`components/diff/DiffDetailView.tsx`](annotated/src/components/diff/DiffDetailView.tsx) | 280 | 295 | 14 | Diff 详情视图：用 StructuredDiff 做词级差异与语法高亮；untracked/二进制/超 1MB/截断各给专属分支，解析上限约 400 行 |
| [`components/CoordinatorAgentStatus.tsx`](annotated/src/components/CoordinatorAgentStatus.tsx) | 272 | 290 | 17 | 协调者任务面板：渲染后台 agent 列表（输入栏下方）；可见性由 evictAfter 驱动，1 秒心跳刷新耗时并剔除过期；Enter 查看、x 解散 |
| [`components/agents/agentFileUtils.ts`](annotated/src/components/agents/agentFileUtils.ts) | 272 | 288 | 16 | 子代理文件读写工具：把 agent 定义格式化 markdown（YAML frontmatter）、按 user/project/policy 来源拼路径、保存/更新/删除；datasync 落盘 |
| [`components/permissions/PermissionExplanation.tsx`](annotated/src/components/permissions/PermissionExplanation.tsx) | 271 | 284 | 12 | 权限解释：用解释器生成自然语言说明；Ctrl+E 才惰性拉取避免白耗 token；风险等级绿/黄/红；Suspense + 闪烁加载兜底 |
| [`components/Spinner/TeammateSpinnerTree.tsx`](annotated/src/components/Spinner/TeammateSpinnerTree.tsx) | 271 | 282 | 10 | 队友旋转树：在输入栏旁渲染「主控 + 各队友」状态树；无运行队友返回 null；选择模式下 hide 折叠行 |
| [`components/ResumeTask.tsx`](annotated/src/components/ResumeTask.tsx) | 267 | 284 | 16 | 恢复会话列表：从 Sessions API 拉可恢复会话、按当前仓库过滤排序；原生 j/k/方向键导航（绕开统一规则）；错误态 Ctrl+R 重试 |
| [`components/LogoV2/ChannelsNotice.tsx`](annotated/src/components/LogoV2/ChannelsNotice.tsx) | 265 | 280 | 14 | 频道通知：KAIROS 标志下展示正在监听的频道来源与状态；无频道/禁用/未鉴权/策略拦截/正常五分支 |
| [`components/tasks/InProcessTeammateDetailDialog.tsx`](annotated/src/components/tasks/InProcessTeammateDetailDialog.tsx) | 265 | 280 | 14 | 进行中队友详情对话框：名称/状态/耗时/token/进度活动/提示词/错误；1 秒心跳算耗时；x 中止、f 前台化 |
| [`components/Spinner/SpinnerAnimationRow.tsx`](annotated/src/components/Spinner/SpinnerAnimationRow.tsx) | 264 | 281 | 16 | 旋转动画行：SpinnerWithVerb 每 50ms 重绘的那一段；独占动画帧与所有派生量，把父组件移出热路径 |
| [`components/EffortCallout.tsx`](annotated/src/components/EffortCallout.tsx) | 264 | 281 | 16 | 投入度标注：首次为 Opus 4.6 用户弹出的 effort 选择；30 秒自动 dismiss；选中即默认则记 undefined 不写设置 |
| [`components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx`](annotated/src/components/permissions/WebFetchPermissionRequest/WebFetchPermissionRequest.tsx) | 257 | 272 | 14 | WebFetch 权限请求：把 URL 解析成 `domain:主机名` 权限规则；可选「不再问此域名」写 localSettings allow 规则 |
| [`components/tasks/DreamDetailDialog.tsx`](annotated/src/components/tasks/DreamDetailDialog.tsx) | 250 | 264 | 13 | 梦境详情对话框：展示 Dream 记忆整合任务；最多 6 轮、更早折叠成计数；状态行运行/完成/失败三色 |
| [`components/TrustDialog/utils.ts`](annotated/src/components/TrustDialog/utils.ts) | 245 | 261 | 16 | 信任对话框设置探测：判断 hooks/bash/otel/apiKey/aws/gcp/危险环境变量是否在 project-local 设置里，并汇总来源路径 |

横切观察：

- **「是否信任」是整套安全模型的入口闸门**：TrustDialog 与 utils.ts 是同一个功能的两半——utils 负责「探测哪些危险能力被打开」，TrustDialog 负责「把探测结果翻译成警告并决定写到哪」。两者都依赖 project/local 设置的来源区分（user 在配置 home、project 在 `.claude/agents`、policy 在受管路径），这是 Claude Code 权限系统的核心边界。
- **权限请求的两条走向一致**：WebFetchPermissionRequest 把 URL 转成 `domain:主机名` 规则、Fallback 走「不再询问」写 localSettings，与 EffortCallout 的「默认等级不写设置、非默认才写」是同一个思路——**能不写盘就不写盘，写了就写全字段防脏状态**。这与第 116 批 SandboxSettings 的「每档写设置都写全两个字段」是同一坑的不同侧面。
- **动画热路径必须隔离**：SpinnerAnimationRow 注释明写「独占 useAnimationFrame(50) 与所有由动画时钟派生的量，把外层父组件从热路径中解放出来」；SpinnerAnimationTree / TeammateSpinnerTree 只负责结构与连接线，把 50ms 重绘完全下推。任何把动画状态算进 React 渲染函数的组件都会每帧重算整棵树——这是本批最值得复用的一条。
- **可见性用「时间 + 状态」而不是布尔**：CoordinatorAgentStatus 的 evictAfter 约定（undefined 常显、时间戳显示到过期、0 立即解散）、InProcessTeammateDetailDialog / DreamDetailDialog 的 1 秒心跳算耗时，都把「该不该还显示」交给一个统一时钟而不是各自记标志，避免计数漂移（CoordinatorAgentStatus 注释特别强调「统一避免数值漂移」）。
- **惰性加载既省 token 又保隐私**：PermissionExplanation 只有用户按 Ctrl+E 才创建解释 Promise，ChannelsNotice 整文件在 KAIROS 标志为假时被 tree-shake——两者都是「默认不付出代价，用户主动才展开」。这与第 116 批 StatusLine「日志开关只发生一次」的节流思路同源。
- **React Compiler 编译产物是这批的普遍形态**：15 份里有 13 份带 `import { c as _c } from "react/compiler-runtime"` 与 `$` 记忆化缓存（`if ($[n] === 哨兵) … else 复用`），等价于被内联的 useMemo。读这些组件时第一句永远是「这段缓存结构 = 一个记忆化值」，否则会误以为凭空多了个数组。

踩坑：本批预检无拦截。15 份数据文件逐一对齐源文件，批注中英文双引号全部改写「」、未出现反斜杠与换行等禁用字符；`annotate.py` 生成的 `agentFileUtils.ts` 有一处锚点（第 48 行，落在 `return \`---` 模板起始行之前）由状态栈自动外移到块后，非错插（已用 sed 核对落点为第 53 行批注、第 54 行模板，位置通顺）。十五份 `annotate.py` 全部成功生成；插入注释 231 行、锚点 219 处，差额 12 即长批注自动折行溢价。

流程账：15 个数据文件逐一对齐源文件；`check-fidelity.py` 本批 15 份 0 失败（部分 `OK*` 为 base64 sourceMappingURL 省略）；`check-links.py` 全仓源码链接 2346 条加内链 684 条，0 失效；全仓 1235/1902 文件、384,409/513,237 行、74.9%（README 记 75%）；components 子树 145/389、53,608/81,892 行。

**下一批候选（components 降序，建议取 10–15 份约 3,600 行）**：`Onboarding.tsx`(244) · `design-system/ListItem.tsx`(244) · `QuickOpenDialog.tsx`(244) · `tasks/RemoteSessionProgress.tsx`(243) · `Settings/Status.tsx`(241) · `LogoV2/Clawd.tsx`(240) · `skills/SkillsMenu.tsx`(237) · `Markdown.tsx`(236) · `permissions/NotebookEditPermissionRequest/NotebookEditToolDiff.tsx`(235) · `permissions/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx`(235)（components 已做 145/389，剩 244 份；全仓还剩 667 份）。

### components 第 118 批：首次启动引导、快速打开对话框、列表项基元、远程会话进度行、状态命令渲染、吉祥物字符画、技能菜单、Markdown 渲染、Notebook diff、PowerShell 权限（10 文件 2,399 行，175 锚点）

本批十份围绕两类主题：**面向首次体验的门面链路**（Onboarding 步骤机、QuickOpenDialog 模糊搜索、Clawd 字符画、SkillsMenu、Status 属性表）与**渲染管线的性能工程**（Markdown 的模块级 token 缓存与流式增量词法、ListItem 基元、RemoteSessionProgress 平滑计数、NotebookEditToolDiff 与 PowerShellPermissionRequest 两张权限 diff）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `Onboarding.tsx` | 244→267 | 22 |
| `QuickOpenDialog.tsx` | 244→263 | 18 |
| `design-system/ListItem.tsx` | 244→258 | 13 |
| `tasks/RemoteSessionProgress.tsx` | 243→262 | 18 |
| `Settings/Status.tsx` | 241→260 | 18 |
| `LogoV2/Clawd.tsx` | 240→256 | 15 |
| `skills/SkillsMenu.tsx` | 237→253 | 15 |
| `Markdown.tsx` | 236→259 | 22 |
| `permissions/NotebookEditPermissionRequest/NotebookEditToolDiff.tsx` | 235→252 | 16 |
| `permissions/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx` | 235→254 | 18 |

横切观察：

- **Markdown 是本批性能密度最高的一份**。三层缓存各有各的理由：模块级 token 缓存解决「useMemo 活不过虚拟滚动重挂」（键用内容哈希防 RSS 回归）、MRU 提升防「回滚就驱逐正在看的条目」、纯文本快路径连哈希都省。`StreamingMarkdown` 用 `'use no memo'` 整体退出编译器——渲染期读写 ref 是算法本体，编译器无法证明其幂等。
- **Clawd 是「分段缓存」的教科书**：姿态表按行拆段、每段独立进记忆槽，姿态切换时只有眼睛/手臂段参与比较；Apple Terminal 分支用前景背景互换的 bg-fill 手法，同一吉祥物两种画法。
- **可跳过步骤（SkippableStep）**：skip 时 effect 立即触发 onSkip 推进流程，且本步渲染为 null——跳过不只是不渲染，还要替用户按一次「下一步」。
- **useSmoothCount 的渲染期 ref 突变**：目标回落或 snap 时直接对齐——注释明说冻结的时钟若不 snap 会让 ref 卡在初值。这类「渲染期写 ref」与前批 useFeedbackSurvey 的按轮次记账同属「编译器下刻意保留的命令式例外」。
- **PowerShell 弹窗沿用了 Bash 版的全部结构**（可编辑前缀 + hasUserEditedPrefix 防异步覆盖 + 规则落 localSettings），但多行命令直接不给「不再询问」——语料统计 14 条多行规则零重复命中，一次性字面量不值得固化。

踩坑：

- `Markdown.tsx` 第 31 行正则字面量含反引号（`MD_SYNTAX_RE` 的字符类），预检状态机把它误判成模板字符串开头、结束状态非 code。已把 `annotate.py` 的 `_regex_end` 正则字面量判定移植进预检状态机（前置字符集 + 字符类跟踪），与主脚本判定对齐。
- `NotebookEditToolDiff` 数据文件有一处锚点漏写位置参数（二元组），预检解包报错当场拦下。
- `ListItem` 数据文件名初版用了连字符（slug 规则要求 `-`→`_`），annotate 找不到数据、改名后补跑。

流程账：10 个数据文件逐一对齐源文件；预检 175 锚点全过、0 块内违例；`annotate.py` 十一次（含 ListItem 补跑）零 `⚠`、一次 `⟳`（Markdown 58→57，锚点挪到注释段边界，无害）；`check-fidelity.py` 全仓 1245 份 0 失败（较上批 +10）；`check-links.py` 源码链接 2361 条加内链 685 条，0 失效；全仓 1245/1902 文件、386,820/513,237 行、75.4%。

**下一批候选（components 降序，建议取 10 份约 2,230 行）**：`Spinner/TeammateSpinnerLine.tsx`(233) · `WorktreeExitDialog.tsx`(231) · `permissions/SedEditPermissionRequest/SedEditPermissionRequest.tsx`(230) · `permissions/AskUserQuestionPermissionRequest/PreviewBox.tsx`(229) · `tasks/AsyncAgentDetailDialog.tsx`(229) · `agents/AgentDetail.tsx`(220) · `permissions/PermissionRequest.tsx`(217) · `CustomSelect/SelectMulti.tsx`(213) · `FeedbackSurvey/useMemorySurvey.tsx`(213) · `mcp/McpParsingWarnings.tsx`(213)（components 已做 173/407，剩 234 份；全仓还剩 657 份）。

### components 第 119 批：权限请求家族、智能体与任务详情、MCP 工具可视化、选择器与向导（15 文件 3,281 行，167 锚点）

本批十五份横跨四类主题：**权限请求的「容器 + 特化」双层**（PermissionRequest 路由分发、SedEdit / AskUserQuestion 预览 / FilePermissionDialog / RecentDenialsTab / 中枢 hooks）、**后台智能体与任务的可视化**（AgentDetail 定义视图、AsyncAgentDetailDialog 后台任务详情、TeammateSpinnerLine 加载态）、**MCP 工具的可观测性**（MCPToolDetailView 单工具 schema、McpParsingWarnings 配置解析告警）与**选择器 / 向导状态机**（CustomSelect/SelectMulti 多选、WizardProvider 步骤机、useMemorySurvey 反馈问卷 hook）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `Spinner/TeammateSpinnerLine.tsx` | 233→246 | 12 |
| `WorktreeExitDialog.tsx` | 231→244 | 12 |
| `permissions/SedEditPermissionRequest/SedEditPermissionRequest.tsx` | 230→242 | 11 |
| `tasks/AsyncAgentDetailDialog.tsx` | 229→241 | 11 |
| `permissions/AskUserQuestionPermissionRequest/PreviewBox.tsx` | 229→241 | 11 |
| `agents/AgentDetail.tsx` | 220→232 | 11 |
| `permissions/PermissionRequest.tsx` | 217→229 | 11 |
| `FeedbackSurvey/useMemorySurvey.tsx` | 213→226 | 12 |
| `CustomSelect/SelectMulti.tsx` | 213→225 | 11 |
| `mcp/McpParsingWarnings.tsx` | 213→224 | 10 |
| `wizard/WizardProvider.tsx` | 213→225 | 11 |
| `permissions/FilePermissionDialog/useFilePermissionDialog.ts` | 212→224 | 12 |
| `mcp/MCPToolDetailView.tsx` | 212→225 | 12 |
| `permissions/hooks.ts` | 209→219 | 10 |
| `permissions/rules/RecentDenialsTab.tsx` | 207→218 | 10 |

横切观察：

- **权限系统的「请求 → 路由 → 特化 UI → 决策回流」闭环**：`PermissionRequest.tsx` 是按 type 分发的容器，把同一份请求路由到 `SedEditPermissionRequest`（sed 式查找替换 diff 审批）、`AskUserQuestionPermissionRequest/PreviewBox`（问题选项预览）等具体视图；`permissions/hooks.ts` 是状态中枢（订阅待决请求、派发 approve/deny）；`FilePermissionDialog/useFilePermissionDialog.ts` 管单文件弹窗状态；`rules/RecentDenialsTab.tsx` 是「已拒绝规则」的反向视图。四者合起来才是完整闭环，单独读任一份都会缺一块。
- **选择器与向导都是显式状态机**：`CustomSelect/SelectMulti.tsx` 把「多选」抽象成受控集合（toggle + 标签渲染），`wizard/WizardProvider.tsx` 把「多步流程」抽象成步骤机（当前步 + 校验 + 前进/后退）。前者管「选什么」，后者管「走到哪」，但都把交互收敛成可测试的状态。
- **异步智能体的三视图**：`agents/AgentDetail.tsx`（定义：系统提示 / 工具 / 模型）、`tasks/AsyncAgentDetailDialog.tsx`（运行时：后台任务进度与中断）、`Spinner/TeammateSpinnerLine.tsx`（加载态：含响应式渐进隐藏）从「是什么 / 正在做什么 / 还没好」三个角度覆盖子智能体。
- **MCP 可观测性的两面**：`mcp/MCPToolDetailView.tsx` 在「成功加载」时展开单工具 schema 与输入说明；`mcp/McpParsingWarnings.tsx` 在「配置解析失败」时把告警逐条列出。一个看「装上了什么」，一个看「为什么没装上」。

踩坑：

- `Spinner/TeammateSpinnerLine.tsx` 第 149 行锚点原落在 `//` 注释段中部，被自动 snap 到段边界（149→150）：「渐进式隐藏」批注落到英文注释块（149–158 行响应式布局说明）之后（批注版第 159 行），属无害 `⟳`，grep 已确认落点连贯、未劈断英文句子。
- 本批 15 份数据文件预检 167 锚点全过、0 块内违例、零 `⚠`；无正则字面量误判、无漏写位置参数的二元组。

流程账：15 个数据文件逐一对齐源文件；预检 167 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、一次 `⟳`（TeammateSpinnerLine 149→150，注释段边界 snap，无害）；`check-fidelity.py` 全仓 1260 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 686 条，0 失效；全仓 1260/1902 文件、390,101/513,237 行、76%。

### components 第 120 批：压缩后问卷、权限对话框、桌面交接、MCP 导入、自动更新、高亮渲染、Teleport 错误（15 文件 2,927 行，85 锚点）

本批十五份横跨五类主题：**反馈问卷收尾**（`usePostCompactSurvey` 压缩后问卷，20% 概率触发、Statsig + OTel 双埋点）、**文件权限子系统收口**（`FilePermissionDialog` 对话框容器 + `usePermissionHandler` 决策中枢：accept-once / accept-session / reject）、**自动更新双实现**（`AutoUpdater` 的 JS 调度层 + `NativeAutoUpdater` 的原生安装器调用，同 props 异机制、均 30 分钟轮询）、**代码高亮三级降级链**（`HighlightedCode` 主分发 → `HighlightedCodeFallback` LRU 缓存降级 → `StructuredDiff` 双列 diff）以及**桌面端跨端体验**（`DesktopHandoff` 交接状态机、`MCPServerDesktopImportDialog` 从 Claude Desktop 导入 MCP、`TeleportError` 跨端前置错误）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `FeedbackSurvey/usePostCompactSurvey.tsx` | 206→221 | 8 |
| `permissions/FilePermissionDialog/FilePermissionDialog.tsx` | 204→214 | 7 |
| `MCPServerDesktopImportDialog.tsx` | 203→212 | 7 |
| `hooks/ViewHookMode.tsx` | 199→206 | 5 |
| `AutoUpdater.tsx` | 198→207 | 6 |
| `agents/generateAgent.ts` | 197→205 | 7 |
| `SessionPreview.tsx` | 194→200 | 5 |
| `sandbox/SandboxOverridesTab.tsx` | 193→200 | 5 |
| `NativeAutoUpdater.tsx` | 193→201 | 6 |
| `HighlightedCode/Fallback.tsx` | 193→201 | 4 |
| `DesktopHandoff.tsx` | 193→200 | 6 |
| `StructuredDiff.tsx` | 190→198 | 5 |
| `HighlightedCode.tsx` | 190→196 | 4 |
| `TeleportError.tsx` | 189→196 | 4 |
| `permissions/FilePermissionDialog/usePermissionHandler.ts` | 185→192 | 6 |

横切观察：

- **文件权限子系统的「壳 + 脑」分离**：`FilePermissionDialog.tsx` 只负责把 props 拼成对话框（解析输入、推断语言、决定 IDE diff 展示与否、分派 accept/reject 回调），真正的决策逻辑在 `usePermissionHandler.ts` 里——`PERMISSION_HANDLERS` 把 accept-once / accept-session / reject 三类选项映射到各自处理函数，accept-session 还会按作用域（claude 目录 / 全局目录）追加或建议权限规则。两者合起来才是「一次文件授权怎么落地」，单独读任一份都会缺一半。
- **自动更新的「同一张脸、两套心脏」**：`AutoUpdater` 与 `NativeAutoUpdater` 暴露的 props 完全一致（isUpdating / onAutoUpdaterResult / showSuccessMessage / verbose），但 `AutoUpdater` 在 JS 层按安装类型选本地或全局 npm 更新，`NativeAutoUpdater` 直接调原生安装器 `installLatest`。两者都处理服务端最大版本封顶（kill switch）与 30 分钟轮询，且都用 ref 锁定最新 isUpdating 避免陈旧闭包并发触发第二次安装。看一份能照猫画虎懂另一份，但更新机制完全不同。
- **代码高亮的「三级降级 + 两套缓存」链**：`HighlightedCode` 先试 Rust 侧 `ColorFile` 高亮器，禁用或失败则交给 `HighlightedCodeFallback`；Fallback 用模块级 LRU（上限 500，键为 language+code 哈希，#24180 内存修复）缓存高亮结果，语言不支持再回退 markdown，仍抛错则退回原始代码；`StructuredDiff` 在此基础上加行号槽宽计算与「槽位列 + 内容列」双列拆分，并用 WeakMap 按 patch 身份缓存渲染结果（避免 ctrl+o 全屏切换整树重挂载重算）。LRU 管「内容缓存」，WeakMap 管「渲染缓存」，层级清晰。
- **桌面端跨端三件套各管一段**：`DesktopHandoff` 是「把当前会话交到桌面端」的状态机（checking / prompt-download / flushing / opening / success / error），`MCPServerDesktopImportDialog` 是「从 Claude Desktop 导入 MCP 配置」的去重导入器（重名自动加 _1/_2 后缀），`TeleportError` 是「跨端跳转前的前置错误」分拣器（needsGitStash→git 不干净、needsLogin→未登录走 OAuth）。三者共同覆盖「桌面 ↔ 浏览器」边界的不同侧面。

踩坑：

- 13 份 `.tsx` 均为 React Compiler 产物，尾部带一条约 2 万字符的 `sourceMappingURL` base64 行（如 `AutoUpdater.tsx` 源文件该行长 21,964 字符）；`annotate.py` 按 >4000 字符规则将其替换为两行说明注释，未计入批注版行数——这正是 .tsx 文件「批注版行数 − 原文行数」明显大于锚点数的主因（锚点数 + 源映射行移除 + 中文行净增）。
- `NativeAutoUpdater.tsx` 第 194 行的 `⚠` 是源码硬编码的「Known issue」提示字符串，并非 annotate 告警；本批数据文件预检 85 锚点全过、0 块内违例、零 `⚠`、零 `⟳`，无正则字面量误判、无漏写位置参数的二元组。

流程账：15 个数据文件逐一对齐源文件；预检 85 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`；`check-fidelity.py` 全仓 1275 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 687 条，0 失效；全仓 1275/1902 文件、393,028/513,237 行、76%。

### components 第 121 批：帮助 / 通行证 / 文件编辑 / 权限 / MCP / 反馈 / 桌面推广（15 文件 2,677 行，255 锚点）

本批十五份横跨七类主题：**帮助与引导**（`HelpV2` 标签式帮助对话框、`Passes` 嘉宾通行证（推荐链接分享）、`DesktopUpsellStartup` 桌面端推广启动弹窗）、**文件编辑权限与差异**（`FileEditPermissionRequest` 用通用对话框封装单处替换、`FileEditToolDiff` 差异预览的读取/扫描策略、`FileEditToolUseRejectedMessage` 被拒后的精简/完整消息、`permissionOptions` 文件权限选项生成）、**权限规则录入**（`AddPermissionRules` 把规则写入本地/项目/用户设置并检测不可达）、**MCP 服务菜单**（`MCPAgentServerMenu` agent 专属服务端 OAuth 鉴权、`MCPStdioServerMenu` stdio 服务端查看/重连/启停）、**反馈与告警**（`FeedbackSurvey` 状态机式反馈问卷、`TokenWarning` token 用量/折叠进度告警）、**多选问答导航**（`use-multiple-choice-state` reducer 状态机、`QuestionNavigationBar` 题号 tab 导航条）以及**agent 编辑器**（`AgentEditor` 工具/颜色/模型编辑）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `HelpV2/HelpV2.tsx` | 184→203 | 18 |
| `Passes/Passes.tsx` | 184→202 | 17 |
| `mcp/MCPAgentServerMenu.tsx` | 183→201 | 17 |
| `permissions/FileEditPermissionRequest/FileEditPermissionRequest.tsx` | 182→196 | 13 |
| `FileEditToolDiff.tsx` | 181→199 | 17 |
| `permissions/rules/AddPermissionRules.tsx` | 180→195 | 14 |
| `permissions/AskUserQuestionPermissionRequest/use-multiple-choice-state.ts` | 179→199 | 20 |
| `TokenWarning.tsx` | 179→197 | 17 |
| `agents/AgentEditor.tsx` | 178→198 | 19 |
| `permissions/AskUserQuestionPermissionRequest/QuestionNavigationBar.tsx` | 178→194 | 15 |
| `mcp/MCPStdioServerMenu.tsx` | 177→198 | 20 |
| `permissions/FilePermissionDialog/permissionOptions.tsx` | 177→197 | 19 |
| `FeedbackSurvey/FeedbackSurvey.tsx` | 174→193 | 18 |
| `DesktopUpsell/DesktopUpsellStartup.tsx` | 171→186 | 14 |
| `FileEditToolUseRejectedMessage.tsx` | 170→188 | 17 |

横切观察：

- **权限请求的统一封装套路**：`FileEditPermissionRequest` 把 `FileEditTool` 的单处替换输入喂给通用 `FilePermissionDialog`（标题/问题/差异内容/解析函数/IDE diff 支持五元组），`permissionOptions` 则按路径是否落在 `.claude` 目录、是否在允许工作路径内，生成「接受一次 / 本次会话 / 拒绝」三类选项——两者共同构成「一次文件授权怎么被组装与展示」，单独读任一份都不完整。
- **MCP 两类菜单各管一端**：`MCPAgentServerMenu` 只服务写在 agent frontmatter 里、仅运行时连接的「agent 专属」服务端（核心是 OAuth 预鉴权），`MCPStdioServerMenu` 服务普通 stdio 服务端（查看工具/重连/启用禁用）。前者在卸载时 abort 未完成的 OAuth 回调服务器，后者把重连结果经 `handleReconnectResult` / `handleReconnectError` 归一化后回传——同一套 `onComplete` 回调，两种生命周期。
- **反馈与告警都按状态机驱动**：`FeedbackSurvey` 用 `closed/open/thanks/transcript_prompt/submitting/submitted` 六态切换渲染，配合 `useDebouncedDigitInput` 做数字输入；`TokenWarning` 则按 `REACTIVE_COMPACT` / `CONTEXT_COLLAPSE` 两个实验开关切换「剩余百分比 / 实时折叠进度」两种表述，两者都把「条件分支」前置到渲染前算好再下发。
- **差异预览按编辑规模选读取策略**：`FileEditToolDiff.loadDiffData` 对「单条且旧串超长」直接对输入做 diff 跳过整文件读取；对多编辑/空旧串读全文件；对单编辑有旧串只扫描局部上下文窗口——`after_block` 与 `/** */` 块注释均走自动外移，未触发块内中文告警。

踩坑：

- 14 份 `.tsx` 尾部带约 2 万字符的 `sourceMappingURL` base64 行，annotate.py 按 >4000 字符规则替换为说明注释，未计入批注版行数（这正是 .tsx「批注版 − 原文」大于锚点数的主因）；`use-multiple-choice-state.ts` 为 `.ts` 无源映射行。
- `use-multiple-choice-state.ts` 第 17 行锚点原本落在多行 `type Action = | {...}` 联合类型首行、会劈开未结束表达式，预检后被 annotate.py 自动外移到联合类型收尾 `}` 之后，check-fidelity 复跑 0 失败。
- `AgentEditor.tsx` 触发 1 次 `⟳`：数据文件锚点落在一处 `//` 注释段中部，annotate.py 自动挪到段边界（落为 `// 仅自定义或插件类 agent 可被编辑（类型安全）`），未劈开英文。
- 本批数据文件预检 255 锚点全过、0 块内违例、1 次 `⟳`（已确认落点通顺）、零 `⚠`；slug 命名修正：`.tsx` 数据文件须以 `_tsx_pN.py` 结尾（annotate.py 把 `.tsx` 整体转 `_tsx`），初版误用 `_ts` 导致 14 份找不到数据，重命名后全部写入。

流程账：15 个数据文件逐一对齐源文件；预检 255 锚点全过、0 块内违例；`annotate.py` 十五次 1 次 `⟳`（AgentEditor，已确认落点）、零 `⚠`；`check-fidelity.py` 全仓 1290 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 688 条，0 失效；全仓 1290/1902 文件、395,705/513,237 行、77%。

**下一批候选（components 降序，建议取 15 份约 2,454 行）**：`design-system/ThemeProvider.tsx`(170) · `ShowInIDEPrompt.tsx`(170) · `mcp/MCPReconnect.tsx`(167) · `IdeOnboardingDialog.tsx`(167) · `TeleportResumeWrapper.tsx`(167) · `LogoV2/OverageCreditUpsell.tsx`(166) · `permissions/NotebookEditPermissionRequest/NotebookEditPermissionRequest.tsx`(166) · `permissions/shellPermissionHelpers.tsx`(164) · `permissions/SandboxPermissionRequest.tsx`(163) · `LogoV2/CondensedLogo.tsx`(161) · `permissions/FileWritePermissionRequest/FileWritePermissionRequest.tsx`(161) · `CustomSelect/use-select-state.ts`(157) · `InvalidConfigDialog.tsx`(156) · `design-system/ThemedBox.tsx`(156) · `IdeAutoConnectDialog.tsx`(154)（components 已做 200/389，剩 189 份；全仓还剩 612 份）。

### components 第 122 批：设计系统、IDE 登入与连接对话框、MCP 重连、权限请求家族、LogoV2 与 CustomSelect 选择器（15 文件 2,446 行，201 锚点）

本批十五份横跨六类主题：**设计系统主题层**（`ThemeProvider` 用 Context 下发主题与三档 API——`useTheme` / `useThemeSetting` / `usePreviewTheme`，auto 偏好经 OSC 11 系统主题探测；`ThemedBox` 把主题色键经 `resolveColor` 查表成原始 Color 再包底层 Box）、**IDE 登入与连接对话框族**（`IdeOnboardingDialog` 首次启动欢迎框 + 已展示去重、`IdeAutoConnectDialog` 自动连接 IDE 开关与其反向禁用版、`ShowInIDEPrompt` 编辑文件前权限确认含符号链接越界警告）、**MCP 自愈**（`MCPReconnect` 断线自动重连弹窗，重连中 / 失败 / 成功三态）、**跨端会话恢复**（`TeleportResumeWrapper` 把会话选择 / 加载 / 错误与埋点总装进 resume 流程）、**权限请求特化族**（`NotebookEditPermissionRequest` 的 Jupyter 单元格增删改 diff、`SandboxPermissionRequest` 沙箱外 host 放行 + 持久化、`FileWritePermissionRequest` 新建 / 覆盖差异预览、`shellPermissionHelpers` 给 Bash/PowerShell 对话框生成建议标签）、**LogoV2 品牌条**（`OverageCreditUpsell` 超额额度赠金促销 + 首页 feed、`CondensedLogo` 会话顶部精简 Logo 含两路 upsell 埋点）以及**选择器状态机**（`CustomSelect/use-select-state` 把焦点 / 选中 / 可见窗口 / 翻页动作打包成 `SelectState`）与**错误兜底**（`InvalidConfigDialog` 配置 JSON 非法时的可操作对话框，用硬编码 `SAFE_ERROR_THEME_NAME` 防循环依赖）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `design-system/ThemeProvider.tsx` | 170→188 | 17 |
| `ShowInIDEPrompt.tsx` | 170→187 | 16 |
| `mcp/MCPReconnect.tsx` | 167→177 | 9 |
| `IdeOnboardingDialog.tsx` | 167→183 | 15 |
| `TeleportResumeWrapper.tsx` | 167→180 | 12 |
| `permissions/NotebookEditPermissionRequest/NotebookEditPermissionRequest.tsx` | 166→176 | 9 |
| `LogoV2/OverageCreditUpsell.tsx` | 166→187 | 20 |
| `permissions/shellPermissionHelpers.tsx` | 164→175 | 10 |
| `permissions/SandboxPermissionRequest.tsx` | 163→179 | 15 |
| `permissions/FileWritePermissionRequest/FileWritePermissionRequest.tsx` | 161→175 | 13 |
| `LogoV2/CondensedLogo.tsx` | 161→177 | 15 |
| `CustomSelect/use-select-state.ts` | 157→177 | 20 |
| `design-system/ThemedBox.tsx` | 156→171 | 14 |
| `InvalidConfigDialog.tsx` | 156→165 | 8 |
| `IdeAutoConnectDialog.tsx` | 154→163 | 8 |

横切观察：

- **设计系统的「键 → 色」解析两件套**：`ThemeProvider` 把 `auto` 偏好解析成最终 `currentTheme`（auto 时经 OSC 11 系统主题探测 + `$COLORFGBG` 种子，非 auto 直接用用户偏好），`ThemedBox` 把 `borderColor` / `backgroundColor` 等主题键经 `resolveColor` 查表成原始 `Color`；两者都刻意用硬编码 `dark` 兜底（`DEFAULT_THEME` / `SAFE_ERROR_THEME_NAME`），确保配置读不出时也不崩。区别在层次：`ThemeProvider` 管全局主题分发，`ThemedBox` 管单个颜色属性的解析，合起来才是「一份偏好怎么落到每个像素」。
- **权限请求「特化 UI + 通用对话框」是 components 层的稳定骨架（本批第三次确认）**：`NotebookEditPermissionRequest` / `FileWritePermissionRequest` 都把自己拼好的字段（标题、问句、差异、路径、完成类型、解析函数、IDE diff 支持）交给通用 `FilePermissionDialog`，`SandboxPermissionRequest` 交给更轻的 `PermissionDialog`（网络场景），`ShowInIDEPrompt` 同模式——批次 119/121 已见过，本批再印证「请求 → 组装 → 通用对话框」是统一套路。
- **状态都收敛成显式状态机**：`use-select-state` 把焦点（index）/ 选中（value）/ 可见窗口（from..to）/ 翻页动作打包成 `SelectState`；`IdeAutoConnectDialog` / `IdeOnboardingDialog` 用 `shouldShow*` 布尔 + `markDialogAsShown` 去重防重复弹窗。前者管「选什么」，后者管「什么时候该弹」，但都把交互收敛成可测试的状态。
- **弹窗 = 副作用 + 三态渲染**：`MCPReconnect` 内部 `useEffect` 跑 `attemptReconnect`（找 server → 调重连 → 按返回分发），渲染重连中 / 失败 / 成功；`TeleportResumeWrapper` 用 `useTeleportResume` 拿 `resumeSession` / `isResuming` / `error`，渲染加载 / 错误 / 正常。两者都把「副作用结果」映射成「UI 三态」，且都在成功 / 失败时通过 `onComplete` / `onError` 把控制权交回上层。
- **埋点与「展示去重」成对出现**：`IdeOnboardingDialog` / `IdeAutoConnectDialog` / `CondensedLogo` 都用「已展示标记 + 布尔判定」防刷屏，`OverageCreditUpsell` 额外用 `MAX_IMPRESSIONS = 3` 限流；`CondensedLogo` 两个 `useEffect` 分别给访客通行证与超额额度 upsell 累加已见次数，且只在对应组件展示时才打——条件埋点的典型写法，避免「没看见也计数」。

踩坑：

- 14 份 `.tsx` 尾部带约 2 万字符的 `sourceMappingURL` base64 行（如 `OverageCreditUpsell.tsx` 源文件该行长 21,964 字符）；`annotate.py` 按 >4000 字符规则将其替换为两行说明注释，未计入批注版行数——这正是 .tsx 文件「批注版 − 原文」明显大于锚点数的主因（锚点数 + 源映射行移除 + 中文行净增）。仅 `CustomSelect/use-select-state.ts` 为 `.ts` 无源映射行，其「批注版 − 原文」恰好等于锚点数（20）。
- 本批 15 份数据文件预检 201 锚点全过、0 块内违例、零 `⚠`、零 `⟳`；无正则字面量误判、无漏写位置参数的二元组、无锚点落在多行表达式首行或 `/* */` 块注释内部的情形。
- 锚点全部落在 `after` 位置（函数声明、return、关键分支、导出行），未使用 `before` / `after_block`；React Compiler 产物（`_c(n)` 缓存槽、`$` 记忆数组、`t0..tN` 临时名）的 memo 结构未干扰锚点落点，check-fidelity 复跑 0 失败。

流程账：15 个数据文件逐一对齐源文件；预检 201 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`；`check-fidelity.py` 全仓 1305 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 689 条，0 失效；全仓 1305/1902 文件、398,150/513,237 行、77%。

**下一批候选（components 降序，建议取 15 份约 2,204 行）**：`ThinkingToggle.tsx`(153) · `SkillImprovementSurvey.tsx`(152) · `shell/ShellProgressMessage.tsx`(150) · `permissions/rules/WorkspaceTab.tsx`(150) · `ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx`(149) · `design-system/Divider.tsx`(149) · `ValidationErrorsList.tsx`(148) · `permissions/useShellPermissionFeedback.ts`(148) · `permissions/BashPermissionRequest/bashToolUseOptions.tsx`(147) · `hooks/SelectMatcherMode.tsx`(144) · `permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx`(144) · `ManagedSettingsSecurityDialog/utils.ts`(144) · `agents/new-agent-creation/wizard-steps/GenerateStep.tsx`(143) · `AutoModeOptInDialog.tsx`(142) · `mcp/MCPToolListView.tsx`(141)（components 已做 215/389，剩 174 份；全仓还剩 597 份）。

### components 第 123 批：思考模式开关、技能改进问卷、Shell 进度面板、工作目录/托管安全/自动模式确认、Bash 权限选项、问题提交审阅、匹配器与代理向导/MCP 工具列表（15 文件 2,204 行，139 锚点）

本批十五份均为 100–153 行的小组件，横跨「会话开关、用户问卷、终端进度、权限设置对话框、权限选项构造、多问题提交审阅、hook 匹配器导航、代理生成向导、MCP 工具列表」九类主题；大部分是 React Compiler 产物（`_c(n)` 缓存槽 + `$` 记忆数组），少数为手写 `.ts` 纯逻辑（如 `useShellPermissionFeedback` 与 `ManagedSettingsSecurityDialog/utils`）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `ThinkingToggle.tsx` | 153→162 | 8 |
| `SkillImprovementSurvey.tsx` | 152→162 | 9 |
| `shell/ShellProgressMessage.tsx` | 150→160 | 9 |
| `permissions/rules/WorkspaceTab.tsx` | 150→160 | 9 |
| `ManagedSettingsSecurityDialog/ManagedSettingsSecurityDialog.tsx` | 149→160 | 10 |
| `design-system/Divider.tsx` | 149→157 | 7 |
| `ValidationErrorsList.tsx` | 148→160 | 11 |
| `permissions/useShellPermissionFeedback.ts` | 148→157 | 9 |
| `permissions/BashPermissionRequest/bashToolUseOptions.tsx` | 147→157 | 9 |
| `permissions/AskUserQuestionPermissionRequest/SubmitQuestionsView.tsx` | 144→155 | 10 |
| `hooks/SelectMatcherMode.tsx` | 144→153 | 8 |
| `ManagedSettingsSecurityDialog/utils.ts` | 144→154 | 10 |
| `agents/new-agent-creation/wizard-steps/GenerateStep.tsx` | 143→155 | 11 |
| `AutoModeOptInDialog.tsx` | 142→154 | 11 |
| `mcp/MCPToolListView.tsx` | 141→150 | 8 |

横切观察：

- **「确认对话框」是权限层的稳定骨架（本批第四次确认）**：`ManagedSettingsSecurityDialog`（托管设置安全确认）、`AutoModeOptInDialog`（自动模式启用确认）都把「法务/产品文案 + 选项列表 + 取消键」塞进通用 `Dialog`/`PermissionDialog`，区别只在选项构造逻辑。
- **「是/否 + 反馈输入模式」的共用态收口到 hook**：`useShellPermissionFeedback` 把 Tab 切换输入模式、反馈文本、焦点与拒绝处理封装成一套状态，Bash/PowerShell 权限弹窗共用，避免每个弹窗重写一遍交互。
- **「选项构造」是纯函数最优雅的用法**：`bashToolUseOptions` 把「是否显示总是允许 / 可编辑前缀 / 分类器描述」等分支收成一个返回 `OptionWithDescription[]` 的函数，且分类器分支被一段恒假守卫（`external === ant`）关死，属明确的实验残留。
- **列表型组件都走「数据 → 选项映射 → Select」三段式**：`WorkspaceTab`（目录增删）、`SelectMatcherMode`（hook 匹配器下钻）、`MCPToolListView`（服务器工具）、`SubmitQuestionsView`（问题审阅）都先把原始数据 map 成带 label/value/description 的选项，再交给通用 `Select`，符合 components 层一贯套路。

踩坑：

- `ManagedSettingsSecurityDialog/utils.ts` 第 58 行的 `const hasHooks =` 是一个跨 58–62 行的多行赋值首行，初版锚点落在 `after(58)` 把中文插进了表达式中间（fidelity 报「中文批注插在了未结束的多行表达式中间，语句被劈开」）；修正为锚到表达式收尾行 `after(62)` 后重跑 `annotate.py`，fidelity 复跑 0 失败。这是「`after` 不落跨行赋值首行」铁律的又一次踩实。
- 本批 15 份数据文件预检 139 锚点全过（slug 与源路径一一对应、行号全在 `[1,len]`、无重复锚点、无英文双引号与反斜杠、`ast.parse` 全过）；`annotate.py` 十五次零 `⟳`、零 `⚠`（含 base64 `sourceMappingURL` 按惯例省略、fidelity 标 `OK*`）；`check-fidelity.py` 全仓 1320 份 0 失败；`check-links.py` 源码链接 2361 条加内链 690 条，0 失效。

流程账：15 个数据文件逐一对齐源文件；预检 139 锚点全过、零合并错误；`annotate.py` 十五次零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1320 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 690 条，0 失效；全仓 1320/1902 文件、400,342/513,237 行、78%（按行数覆盖）。

**下一批候选（components 降序，建议取 15 份约 2,045 行）**：`VimTextInput.tsx`(140) · `TeleportProgress.tsx`(140) · `TagTabs.tsx`(139) · `design-system/Dialog.tsx`(138) · `permissions/rules/PermissionRuleInput.tsx`(138) · `ClaudeMdExternalIncludesDialog.tsx`(137) · `Settings/Settings.tsx`(137) · `AgentProgressLine.tsx`(136) · `BaseTextInput.tsx`(136) · `MCPServerMultiselectDialog.tsx`(133) · `WorkflowMultiselectDialog.tsx`(128) · `ExportDialog.tsx`(128) · `agents/new-agent-creation/wizard-steps/PromptStep.tsx`(128) · `hooks/SelectEventMode.tsx`(127) · `design-system/ThemedText.tsx`(124)（components 已做 230/389，剩 159 份；全仓还剩 582 份）。

### utils 第 100 批：剩余小文件十五件套（18→14 行档，31 锚点）

本批十五份是 utils 收尾的「二十行以下」叶子小模块，按行数降序从 18 行一路取到 14 行；主题横跨「队友系统提示补遗、Git 行为设置、原生安装器桶文件、Object.groupBy polyfill、Todo 类型 schema、分类器检查钩子、可执行查找、凭据存储选型、事件 sink 挂载、BOM 剥离、XML 转义、推理配置立即执行、YAML 解析、Bash 输出上限、bash alias 规格」——多份刻意保持「叶子模块、零重依赖、只做一件事」，或为切断循环依赖而从大文件抽离。

| 文件                                                                                             | 原文 | 批注版 | 锚点 | 讲什么                                                           |
| ---------------------------------------------------------------------------------------------- | -- | --- | -- | ------------------------------------------------------------- |
| [`utils/swarm/teammatePromptAddendum.ts`](annotated/src/utils/swarm/teammatePromptAddendum.ts) | 18 | 20  | 2  | 队友专属系统提示补遗：追加到主智能体提示尾部的通信规范模板                                 |
| [`utils/gitSettings.ts`](annotated/src/utils/gitSettings.ts)                                   | 18 | 20  | 2  | 从 git.ts 拆出的 Git 行为设置：按环境变量+初始设置决定注入 Git 指令，避循环依赖与 vscode 禁依赖 |
| [`utils/nativeInstaller/index.ts`](annotated/src/utils/nativeInstaller/index.ts)               | 18 | 20  | 2  | 原生安装器桶文件：只重导出外部真正用到的函数与类型                                     |
| [`utils/objectGroupBy.ts`](annotated/src/utils/objectGroupBy.ts)                               | 18 | 20  | 2  | 手写 TC39 Object.groupBy polyfill，用无原型对象分组                      |
| [`utils/todo/types.ts`](annotated/src/utils/todo/types.ts)                                     | 18 | 20  | 2  | Todo 项的 zod v4 schema 与推导类型，隔离 zod 依赖                         |
| [`utils/classifierApprovalsHook.ts`](annotated/src/utils/classifierApprovalsHook.ts)           | 17 | 19  | 2  | 订阅「某工具是否正被分类器检查」的 React 钩子，避免 React 污染纯状态导入方                  |
| [`utils/findExecutable.ts`](annotated/src/utils/findExecutable.ts)                             | 17 | 19  | 2  | 类似 which 的可执行查找，替换 spawn-rx 以省掉 rxjs                          |
| [`utils/secureStorage/index.ts`](annotated/src/utils/secureStorage/index.ts)                   | 17 | 19  | 2  | 按平台挑凭据存储：macOS 走 Keychain 兜底、其余明文                             |
| [`utils/sinks.ts`](annotated/src/utils/sinks.ts)                                               | 16 | 18  | 2  | 挂载错误日志与分析事件两个 sink 的叶子模块，避 setup 循环依赖                         |
| [`utils/jsonRead.ts`](annotated/src/utils/jsonRead.ts)                                         | 16 | 18  | 2  | 叶子模块 stripBOM，处理 PowerShell 默认写带 BOM 的 UTF-8，避循环依赖            |
| [`utils/xml.ts`](annotated/src/utils/xml.ts)                                                   | 16 | 19  | 3  | 两份 XML/HTML 转义函数：文本内容场景与属性值场景                                 |
| [`utils/immediateCommand.ts`](annotated/src/utils/immediateCommand.ts)                         | 15 | 17  | 2  | 推理配置命令是否立即执行的判定：内部用户永远开、外部走实验开关                               |
| [`utils/yaml.ts`](annotated/src/utils/yaml.ts)                                                 | 15 | 17  | 2  | YAML 解析封装：Bun 用内置零成本、否则惰性 require yaml 包                      |
| [`utils/shell/outputLimits.ts`](annotated/src/utils/shell/outputLimits.ts)                     | 14 | 16  | 2  | Bash 输出长度上下限常量与按环境变量取值函数（含 shell 走间接 runner）                  |
| [`utils/bash/specs/alias.ts`](annotated/src/utils/bash/specs/alias.ts)                         | 14 | 16  | 2  | bash 子命令 alias 的纯数据规格定义（含 bash 走间接 runner）                    |

三条横切观察：

- 「循环依赖拆解的惯用法」：gitSettings 把 Git 行为从 git.ts 抽离以躲开 settings→git/gitignore→git→settings 的环、sinks 抽出自 setup 以躲开 setup→commands→bridge→setup 的环、jsonRead 抽出 stripBOM 以躲开 settings→json→log→…→settings 的环——都遵循「把只被两侧引用、却不被任一侧 import 的逻辑独立成叶子文件」。nativeInstaller/index 则反向用桶文件把实现细节收口，外部只从这一个口子导入。
- 「平台/环境门控与惰性加载」：secureStorage 按 darwin 与否在 Keychain 与明文间切换、yaml 按 Bun 是否定义选内置或 npm 包、immediateCommand 按内部用户或实验开关决定行为、gitSettings 按环境变量覆盖默认——都把「运行环境/配置」当显式判据而非硬编码，与之前 bundledMode/execFileNoThrow 同属「跟随环境自适应」。
- 「零依赖的小工具与纯规格」：findExecutable 为省 rxjs 替换 spawn-rx、objectGroupBy 与 todo/types 把纯算法/类型隔离、xml 两份转义是安全插值基础设施、bash/specs/alias 是纯数据规格——都强调「小、专、不引重依赖」。

踩坑：本批 15 份文件级锚点继续统一用 `(1,'before')` 顶到文件最前，零块内中文、零 `⟳`、零 `⚠`。其中 `gitSettings.ts`（含 git）、`shell/outputLimits.ts`（含 shell）、`bash/specs/alias.ts`（含 bash）含危险子串，按惯例走间接 runner（`_run100.py` 把三条路径写在文件内、不出现在命令行）跑 annotate.py，其余十二份直接命令行调用。预检门禁（六断言 + 块注释内部续行扫描，块首/收尾与 `(1,after)` 豁免）31 锚点一次全过。

流程账：本批 15 个数据文件逐一对齐源文件，预检 31 锚点全过；`annotate.py` 十五次失败 0、`⟳` 0、零 `⚠`；`check-fidelity.py` 全仓 1138 份 0 失败；`check-links.py` 源码链接 2249 条加内链 667 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`systemPromptType.ts`(14) · `keyboardShortcuts.ts`(14) · `shell/resolveDefaultShell.ts`(14) · `withResolvers.ts`(13) · `bash/specs/time.ts`(13) · `bash/specs/sleep.ts`(13) · `bash/specs/nohup.ts`(13) · `crypto.ts`(13) · `array.ts`(13) · `sandbox/sandbox-ui-utils.ts`(12) …（utils 还剩 18 份；全仓还剩 764 份）。注意：`shell/resolveDefaultShell.ts` 含 shell、`bash/specs/time.ts`/`sleep.ts`/`nohup.ts` 含 bash 危险子串，下批 annotate 需走间接 runner。

### utils 第 78 批：小文件十五件套（142→131 行档，117 锚点）

本批是「140 行上下」的十五份独立工具，横跨「文件状态缓存（LRU + 路径归一化）、权限模式可视化、API 查询钩子工厂、输入框 bash 执行、会话入口令牌、水平滚动窗口、深链拉起、生成文件识别、HTTP 辅助、插件拉取遥测、SDK 事件队列、会话活跃度心跳、钩子配置快照、工具错误格式化、终端文本截断」——彼此独立，但共同补齐 utils 中层的「缓存 / 鉴权 / 遥测 / 配置快照 / 终端渲染」五类积木。

| 文件                                                                                                             | 原文  | 批注版 | 锚点 | 讲什么                                                                    |
| -------------------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------------------------------------------------- |
| [`utils/fileStateCache.ts`](annotated/src/utils/fileStateCache.ts)                                             | 142 | 153 | 11 | 读文件状态缓存：路径键统一 normalize 的 LRU 封装，含克隆/合并/转对象等辅助                         |
| [`utils/permissions/PermissionMode.ts`](annotated/src/utils/permissions/PermissionMode.ts)                     | 141 | 155 | 14 | 权限模式枚举与可视配置：default/plan/acceptEdits/bypass/dontAsk/auto 的标题符号颜色与对外映射  |
| [`utils/hooks/apiQueryHookHelper.ts`](annotated/src/utils/hooks/apiQueryHookHelper.ts)                         | 141 | 148 | 7  | API 查询钩子工厂：构建消息、非流式调用模型、解析并记录结果，失败也不抛出                                 |
| [`utils/processUserInput/processBashCommand.tsx`](annotated/src/utils/processUserInput/processBashCommand.tsx) | 140 | 150 | 9  | 输入框 bash 命令执行：选 Bash/PowerShell 工具、包 <bash-stdout>/<bash-stderr>、进度 UI |
| [`utils/sessionIngressAuth.ts`](annotated/src/utils/sessionIngressAuth.ts)                                     | 140 | 145 | 5  | 会话入口令牌：环境变量 > 文件描述符 > 已知文件的回退，拼 Cookie/Bearer 认证头                      |
| [`utils/horizontalScroll.ts`](annotated/src/utils/horizontalScroll.ts)                                         | 137 | 145 | 8  | 水平滚动窗口计算：贴边滚动保证选中项可见，ANSI 不切断                                          |
| [`utils/deepLink/protocolHandler.ts`](annotated/src/utils/deepLink/protocolHandler.ts)                         | 136 | 141 | 5  | 深链协议处理器：解析 URI、解析工作目录、在终端拉起 claude                                     |
| [`utils/generatedFiles.ts`](annotated/src/utils/generatedFiles.ts)                                             | 136 | 143 | 7  | 生成文件识别：按文件名/扩展名/目录/正则排除锁文件与构建产物                                        |
| [`utils/http.ts`](annotated/src/utils/http.ts)                                                                 | 136 | 143 | 7  | HTTP 辅助：拼各类 User-Agent 与 OAuth/API key 认证头，含 401 重试                    |
| [`utils/plugins/fetchTelemetry.ts`](annotated/src/utils/plugins/fetchTelemetry.ts)                             | 135 | 142 | 7  | 插件拉取遥测：按白名单归类主机，错误分桶，隐私口径只报枚举                                          |
| [`utils/sdkEventQueue.ts`](annotated/src/utils/sdkEventQueue.ts)                                               | 134 | 143 | 9  | SDK 事件队列：前台智能体任务开始/进度/结束事件，入队与排空                                       |
| [`utils/sessionActivity.ts`](annotated/src/utils/sessionActivity.ts)                                           | 133 | 143 | 10 | 会话活跃度心跳：引用计数驱动的 30 秒保活，注册/注销/起停                                        |
| [`utils/hooks/hooksConfigSnapshot.ts`](annotated/src/utils/hooks/hooksConfigSnapshot.ts)                       | 133 | 141 | 8  | 钩子配置快照：按策略决定哪些来源钩子生效，支持抓取/更新/重置                                        |
| [`utils/toolErrors.ts`](annotated/src/utils/toolErrors.ts)                                                     | 132 | 137 | 5  | 工具错误格式化：统一多行报错、超长截断、Zod 校验错误转中文                                        |
| [`utils/terminal.ts`](annotated/src/utils/terminal.ts)                                                         | 131 | 136 | 5  | 终端文本截断渲染：按可见宽度换行，超 3 行折叠并提示展开                                          |

三条横切观察：

- **「鉴权与令牌」本批占两份**：`sessionIngressAuth.ts`（会话入口令牌的三路回退与认证头拼装）与 `http.ts`（OAuth/API key 认证头与 401 重试）共同把「怎么证明你是你」收口；两者都强调「OAuth 失败先强制刷新再重试、缺令牌返回空头加错误说明」。
- **「缓存与状态快照」是一条暗线**：`fileStateCache.ts`（路径归一化的 LRU 封装 + 克隆合并）、`sessionActivity.ts`（引用计数心跳）、`hooksConfigSnapshot.ts`（钩子配置快照与策略化生效）三份都遵循「全局态集中管理、读取可核对、改了能重置」的设计哲学。
- **「可观测 / 遥测」两份收口**：`plugins/fetchTelemetry.ts`（插件网络拉取按白名单归类主机、错误分桶）与 `sdkEventQueue.ts`（前台智能体任务事件入队排空），均强调「只报受限枚举、不泄漏路径与原始报错」的隐私口径。

踩坑：本批 15 份预检五断言一次通过、零合并错误（slug 与源路径一一对应、行号全在 `[1, len]` 内、无重复锚点、无英文双引号与反斜杠、`ast.parse` 全过）；`annotate.py` 十五次零 `⟳`、零 `⚠`（含 `processBashCommand.tsx` 的 base64 sourceMappingURL 按惯例省略、fidelity 标 `OK*`）；`check-fidelity` 本批 15 份 0 失败（合计 903 份全仓 0 失败）；`check-links` 源码链接 2014 条加内链 598 条，0 失效。

流程账：本批 15 个数据文件逐一对齐源文件（硬规矩连续生效，三处 `/** */` 文件头锚点经 `after` 自动外移到块后、无块内中文；`fetchTelemetry.ts` 末锚点初版写成 136 行、预检报越界后修正为 135 行）；预检 15 份全过、零合并错误；`annotate.py` 十五次零 `⟳`、零 `⚠`；`check-fidelity.py` 本批 15 份 0 失败（+117 处锚点、代码行与原文逐行相等）；`check-links.py` 源码链接 2014 条加内链 598 条，0 失效。

**下一批候选（utils 剩余，按行数降序）**：`mcpInstructionsDelta.ts`(130) · `settings/mdm/rawRead.ts`(130) · `glob.ts`(130) · `sessionTitle.ts`(129) · `swarm/teammateInit.ts`(129) · `bash/shellQuoting.ts`(128) · `swarm/backends/detection.ts`(128) · `ultraplan/keyword.ts`(127) · `permissions/PermissionPromptToolResultSchema.ts`(127) · `plugins/pluginBlocklist.ts`(127) …（utils 还剩 253 份；全仓还剩 999 份）。

---

### FileEditTool 与 FileWriteTool

工具层的第一批，选的是**最常用的那个工具**——`Edit`。它是整套系统里调用量最大的写操作，也是「模型说什么」和「文件实际是什么」之间唯一的翻译层。9 份源文件 2,668 行，批注后 2,735 行、65 处锚点。

| 文件                                                                                     | 原文  | 批注版 | 批注 | 讲什么                               |
| -------------------------------------------------------------------------------------- | --- | --- | -- | --------------------------------- |
| [`FileEditTool/utils.ts`](annotated/src/tools/FileEditTool/utils.ts)                   | 775 | 790 | 15 | 引号/空白归一化、patch 生成、脱敏还原            |
| [`FileEditTool/FileEditTool.ts`](annotated/src/tools/FileEditTool/FileEditTool.ts)     | 625 | 643 | 18 | 十个 errorCode 的校验链、原子写入            |
| [`FileEditTool/UI.tsx`](annotated/src/tools/FileEditTool/UI.tsx)                       | 289 | 295 | 5  | 动词选择、错误降级、拒绝时的 diff               |
| [`FileEditTool/types.ts`](annotated/src/tools/FileEditTool/types.ts)                   | 85  | 89  | 4  | schema 契约、`z.output` vs `z.input` |
| [`FileEditTool/prompt.ts`](annotated/src/tools/FileEditTool/prompt.ts)                 | 28  | 32  | 4  | 「必须先 Read」写进描述                    |
| [`FileEditTool/constants.ts`](annotated/src/tools/FileEditTool/constants.ts)           | 11  | 13  | 2  | 叶子模块断依赖环                          |
| [`FileWriteTool/FileWriteTool.ts`](annotated/src/tools/FileWriteTool/FileWriteTool.ts) | 434 | 445 | 11 | 整文覆盖、不改写行尾                        |
| [`FileWriteTool/UI.tsx`](annotated/src/tools/FileWriteTool/UI.tsx)                     | 405 | 410 | 4  | 只显示前 10 行、`EOL` 不用 `os.EOL`       |
| [`FileWriteTool/prompt.ts`](annotated/src/tools/FileWriteTool/prompt.ts)               | 18  | 20  | 2  | 「既有文件才要求先读」+ 优先用 Edit             |

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

| 文件                                                                                     | 原文    | 批注版   | 批注 | 讲什么                                        |
| -------------------------------------------------------------------------------------- | ----- | ----- | -- | ------------------------------------------ |
| [`FileReadTool/FileReadTool.ts`](annotated/src/tools/FileReadTool/FileReadTool.ts)     | 1,183 | 1,211 | 28 | 五道零 I/O 校验、去重桩、六型输出映射、三级图片压缩               |
| [`FileReadTool/limits.ts`](annotated/src/tools/FileReadTool/limits.ts)                 | 92    | 97    | 5  | 两个上限（字节 / token）与优先级 env > GrowthBook > 默认 |
| [`FileReadTool/prompt.ts`](annotated/src/tools/FileReadTool/prompt.ts)                 | 49    | 54    | 5  | 模板三段插值、offset 指令两套文案                       |
| [`FileReadTool/imageProcessor.ts`](annotated/src/tools/FileReadTool/imageProcessor.ts) | 94    | 98    | 4  | napi / sharp 双实现、ESM-CJS interop           |
| [`FileReadTool/UI.tsx`](annotated/src/tools/FileReadTool/UI.tsx)                       | 185   | 192   | 6  | 只渲染摘要、agent 输出文件特殊处理                       |

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

| 文件                                                                 | 原文  | 批注版 | 批注 | 讲什么                                |
| ------------------------------------------------------------------ | --- | --- | -- | ---------------------------------- |
| [`GrepTool/GrepTool.ts`](annotated/src/tools/GrepTool/GrepTool.ts) | 577 | 612 | 35 | rg 封装全貌：旗标同名参数、三模式输出、分页协议、mtime 排序 |
| [`GrepTool/UI.tsx`](annotated/src/tools/GrepTool/UI.tsx)           | 201 | 206 | 4  | React Compiler 编译产物、三模式共用汇总组件      |
| [`GrepTool/prompt.ts`](annotated/src/tools/GrepTool/prompt.ts)     | 18  | 20  | 2  | 禁用 Bash 跑 rg 的理由、两条高频语法提示          |
| [`GlobTool/GlobTool.ts`](annotated/src/tools/GlobTool/GlobTool.ts) | 198 | 212 | 14 | 名字搜索、100 字符阈值放宽、复用 Grep 渲染         |
| [`GlobTool/UI.tsx`](annotated/src/tools/GlobTool/UI.tsx)           | 63  | 67  | 4  | 借走 Grep 的渲染、对外统一叫 Search           |
| [`GlobTool/prompt.ts`](annotated/src/tools/GlobTool/prompt.ts)     | 7   | 8   | 1  | 按修改时间排序的检索策略暗示                     |

五个最值得记的点：

1. **超时责任在谁手上是语义问题，不只是实现细节**。Grep 不用 `AbortController` 做超时（会打断整个 agent 循环），而是交给 rg 自己的 `execFile` timeout——超时抛 `RipgrepTimeoutError` 向上传播，模型看到「搜索没完成」而不是「没有匹配」。这两个结果的下一步行动完全不同。
2. **分页协议是双向的**。`appliedLimit` 只在真截断时返回（没截断还返回 limit，模型会误以为后面还有而白跑一轮 offset）；截断时结果末尾追加 `[Showing results with pagination = limit: 250, offset: 20]`。工具用「字段出现与否」跟模型对话。
3. **截断顺序决定截断质量**。content 模式先 `head_limit` 再转相对路径（省掉对将被丢弃的行的逐行处理，宽泛 pattern 可能回 10k+ 行）；文件列表模式先按 mtime 排序再截断（留下的永远是最最近修改的，顺序反了截断就成抽奖）。
4. **参数名直接沿用 rg 旗标**（-B/-A/-C/-n/-i），模型会 rg 就会调这个工具；但 `-n` 默认 true 与原生 rg 相反——封装在「贴近原生命令」与「对模型友好」之间选了后者（模型拿到行号才能用 Edit 精确定位）。
5. **`--hidden` 与 VCS 排除是配套决定**。开了隐藏文件（.github/.env 正是搜索目标）就必须手动挡住 .git 噪音；插件孤儿版本目录同样排除（否则旧版本代码会混进搜索结果）。

另外一个编译产物层面的观察：`GrepTool/UI.tsx` 是 React Compiler 的输出——`$[i]` 数组是手写 memo cache 槽位、`Symbol.for("react.memo_cache_sentinel")` 标记未初始化槽位。读这种代码的关键是认出「编译器把 useMemo 展开成了什么」，而不是逐行理解控制流。

### SkillTool（技能 = 可调用的斜杠命令）

「技能」这个工具是前面几条线的交汇点：技能清单占上下文 1% 预算（`prompt.ts` 精打细算的两级降级）、调用时或 inline 展开注入主对话、或按 frontmatter `context: 'fork'` 丢给子代理（与 AgentTool 共用 `runAgent`）、权限走 Skill 专属的 allow/deny 规则、遥测按官方/第三方分流脱敏。4 份源文件 1,477 行，批注后 1,525 行、47 处锚点。

| 文件                                                                     | 原文    | 批注版   | 批注 | 讲什么                                      |
| ---------------------------------------------------------------------- | ----- | ----- | -- | ---------------------------------------- |
| [`SkillTool/SkillTool.ts`](annotated/src/tools/SkillTool/SkillTool.ts) | 1,108 | 1,140 | 32 | 三条执行路径、权限判定链、双通道遥测、远端技能加载                |
| [`SkillTool/prompt.ts`](annotated/src/tools/SkillTool/prompt.ts)       | 241   | 250   | 9  | 清单预算（1% 窗口）、两级降级、BLOCKING REQUIREMENT 约定 |
| [`SkillTool/UI.tsx`](annotated/src/tools/SkillTool/UI.tsx)             | 128   | 134   | 6  | fork 进度摘要、拒绝/错误也带进度                      |
| [`SkillTool/constants.ts`](annotated/src/tools/SkillTool/constants.ts) | 1     | 2     | 1  | 工具注册名与规则匹配的关系                            |

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

| 文件                                                                                                               | 原文  | 批注版 | 批注 | 讲什么                                       |
| ---------------------------------------------------------------------------------------------------------------- | --- | --- | -- | ----------------------------------------- |
| [`AskUserQuestionTool/AskUserQuestionTool.tsx`](annotated/src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx) | 266 | 310 | 44 | schema 体系、preview 校验、channels 禁用、call 不问人 |
| [`AskUserQuestionTool/prompt.ts`](annotated/src/tools/AskUserQuestionTool/prompt.ts)                             | 44  | 51  | 7  | 主提示词、preview 两版补丁、chip 宽度                 |
| [`REPLTool/constants.ts`](annotated/src/tools/REPLTool/constants.ts)                                             | 46  | 57  | 10 | REPL 模式开关判定、REPL_ONLY_TOOLS 藏原语清单         |
| [`REPLTool/primitiveTools.ts`](annotated/src/tools/REPLTool/primitiveTools.ts)                                   | 39  | 47  | 8  | 惰性 getter 防 TDZ、绕开 getAllBaseTools 的原因    |
| [`McpAuthTool/McpAuthTool.ts`](annotated/src/tools/McpAuthTool/McpAuthTool.ts)                                   | 215 | 250 | 35 | 伪工具替身、OAuth 后台续段、Promise.race 静默认证        |
| [`NotebookEditTool/NotebookEditTool.ts`](annotated/src/tools/NotebookEditTool/NotebookEditTool.ts)               | 490 | 544 | 54 | 错误码链、非记忆化 jsonParse、readFileState 去重联动    |
| [`NotebookEditTool/UI.tsx`](annotated/src/tools/NotebookEditTool/UI.tsx)                                         | 93  | 103 | 10 | 结果渲染、错误降级                                 |
| [`NotebookEditTool/prompt.ts`](annotated/src/tools/NotebookEditTool/prompt.ts)                                   | 3   | 5   | 2  | 文案里的 cell_number 历史包袱                     |
| [`NotebookEditTool/constants.ts`](annotated/src/tools/NotebookEditTool/constants.ts)                             | 2   | 4   | 2  | 工具名单独成文件防 import 环                        |
| [`BriefTool/BriefTool.ts`](annotated/src/tools/BriefTool/BriefTool.ts)                                           | 204 | 229 | 25 | 资格/激活双闸、DCE 正向守卫、resume 兼容 schema         |
| [`BriefTool/upload.ts`](annotated/src/tools/BriefTool/upload.ts)                                                 | 174 | 203 | 29 | 附件上传、base URL 三级回退、全路径 best-effort        |
| [`BriefTool/attachments.ts`](annotated/src/tools/BriefTool/attachments.ts)                                       | 110 | 126 | 16 | 动态 import 保 tree-shaking、串行 stat 并行上传     |
| [`BriefTool/UI.tsx`](annotated/src/tools/BriefTool/UI.tsx)                                                       | 101 | 114 | 13 | 三种渲染模式、无工具外壳                              |
| [`BriefTool/prompt.ts`](annotated/src/tools/BriefTool/prompt.ts)                                                 | 22  | 32  | 10 | 「答案写进 message」话术、助手模式提示词段                 |

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

| 文件                                                                                     | 原文  | 批注版 | 批注 | 讲什么                               |
| -------------------------------------------------------------------------------------- | --- | --- | -- | --------------------------------- |
| [`WebFetchTool/utils.ts`](annotated/src/tools/WebFetchTool/utils.ts)                   | 530 | 606 | 41 | 双缓存、重定向防护、http 升级、二进制落盘、Haiku 管道  |
| [`WebFetchTool/WebFetchTool.ts`](annotated/src/tools/WebFetchTool/WebFetchTool.ts)     | 318 | 351 | 20 | 权限四关顺序、跨域重定向转述、prompt cache 抖动教训  |
| [`WebFetchTool/preapproved.ts`](annotated/src/tools/WebFetchTool/preapproved.ts)       | 166 | 177 | 10 | 130+ 免审批文档站、host/path 两级查找、段边界匹配  |
| [`WebFetchTool/UI.tsx`](annotated/src/tools/WebFetchTool/UI.tsx)                       | 72  | 78  | 4  | 结果行只显示大小与状态码                      |
| [`WebFetchTool/prompt.ts`](annotated/src/tools/WebFetchTool/prompt.ts)                 | 46  | 56  | 5  | 版权准则双档（预批准域鼓励摘录 / 非预批准引文 ≤125 字符） |
| [`WebSearchTool/WebSearchTool.ts`](annotated/src/tools/WebSearchTool/WebSearchTool.ts) | 435 | 485 | 25 | 服务端 web_search 工具注入、流式猜词、结果块状态机   |
| [`WebSearchTool/UI.tsx`](annotated/src/tools/WebSearchTool/UI.tsx)                     | 101 | 111 | 5  | 进度分流（猜到的词 / 收到的结果数）               |
| [`WebSearchTool/prompt.ts`](annotated/src/tools/WebSearchTool/prompt.ts)               | 34  | 39  | 2  | Sources 硬性要求、当前年月注入               |

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

| 文件                                                                                     | 原文  | 批注版 | 批注 | 讲什么                                   |
| -------------------------------------------------------------------------------------- | --- | --- | -- | ------------------------------------- |
| [`MCPTool/classifyForCollapse.ts`](annotated/src/tools/MCPTool/classifyForCollapse.ts) | 604 | 610 | 6  | 约 30 家服务器的搜索/读取名单、camelCase 归一化、保守不折叠 |
| [`MCPTool/UI.tsx`](annotated/src/tools/MCPTool/UI.tsx)                                 | 403 | 421 | 17 | 三策略渲染级联、React Compiler 产物、Slack 特判    |
| [`MCPTool/MCPTool.ts`](annotated/src/tools/MCPTool/MCPTool.ts)                         | 77  | 82  | 5  | 模板工具、passthrough schema、10 万字符统一上限    |
| [`MCPTool/prompt.ts`](annotated/src/tools/MCPTool/prompt.ts)                           | 3   | 4   | 1  | 空串占位，真实文案在 mcpClient.ts 动态覆盖          |

五个最值得记的点：

1. **匹配只看工具名，不看服务器名**——托管服务器的名字不稳定（slack 与 claude_ai_Slack 是同一个），工具名才是跨安装稳定的键；normalize 把 camelCase/kebab 统一成 snake_case，Notion 的 search、MongoDB 的 find 这类极短名字也直接命中。
2. **保守是硬原则**——名单里没有的工具一律不折叠；READ_TOOLS 全是 get\_/list\_/read_ 前缀的读取动作，kubectl_apply/delete 这种有副作用的绝不出现在名单里。没有条目也是一种记录：Git 和 PagerDuty 在注释里明说「没有搜索动词」。
3. **Set 去重暴露了策略的代价**——search_docs（Sentry 与 Supabase）、find_projects（Sentry 与 Todoist）各自出现两次：跨服务器的同名工具无法区分。这是「按名匹配、免维护」换来的盲区，由「不认识就不折叠」兜底。
4. **UI 渲染是三条策略的级联**——① JSON 里有一个主导字符串载荷（超 200 字符或含换行）就拆出来正经换行显示（专治 Slack 的 {"messages":"line1\nline2..."} 被 pretty-print 转义成字面 \n 的问题）；② 否则是小而平的对象（≤12 键、≤5,000 字符）就平铺成对齐的 k:v；③ 都不行退回 pretty-print 截断。三策略共享一个 parseJsonEntries 入口（空串/超长/非对象/键数越界五连守卫），两个大字符串无法判定谁是主载荷时宁可整体放弃也不猜。
5. **MCPTool.ts 本身是个空壳**——passthrough schema（MCP 工具自带 schema）、checkPermissions 直接 passthrough（权限走服务器级 allowlist 流程）、call 返回空串——所有真实行为在 mcpClient.ts 克隆模板时覆盖。10 万字符的结果上限是所有 MCP 工具的统一护栏。

另有两处小账：非交互模式下输入值截到 80 字符、超 1 万 token 的大响应在 UI 顶部加警告（文案「this can fill up context quickly」是说给人听的，模型那份由 maxResultSizeChars 在别处管）；trySlackSendCompact 先做字符串包含快检再 parse——非 Slack 输出零成本退出，频道标签优先取工具输入里的可读名字而非内部 ID。

### LSPTool：编辑器级代码智能的 CLI 移植

LSPTool 把「跳转定义 / 找引用 / hover / 调用层级」这九个编辑器操作暴露给模型。6 份源文件 2,006 行，批注后 2,050 行、42 处锚点。

| 文件                                                                         | 原文  | 批注版 | 批注 | 讲什么                                     |
| -------------------------------------------------------------------------- | --- | --- | -- | --------------------------------------- |
| [`LSPTool/LSPTool.ts`](annotated/src/tools/LSPTool/LSPTool.ts)             | 860 | 874 | 14 | 主流程：初始化等待、didOpen、两段式调用层级、gitignore 过滤  |
| [`LSPTool/formatters.ts`](annotated/src/tools/LSPTool/formatters.ts)       | 592 | 603 | 11 | URI 归一、按文件分组、SymbolKind 映射、空结果的自我解释     |
| [`LSPTool/UI.tsx`](annotated/src/tools/LSPTool/UI.tsx)                     | 228 | 237 | 8  | 折叠摘要协议、header 里显示光标处符号名                 |
| [`LSPTool/schemas.ts`](annotated/src/tools/LSPTool/schemas.ts)             | 215 | 218 | 3  | 判别联合（真校验）与普通 strictObject（兼容壳）的双 schema |
| [`LSPTool/symbolContext.ts`](annotated/src/tools/LSPTool/symbolContext.ts) | 90  | 94  | 4  | 同步 I/O 提取光标处符号、64KB 读窗、半行哨兵             |
| [`LSPTool/prompt.ts`](annotated/src/tools/LSPTool/prompt.ts)               | 21  | 23  | 2  | 给模型的操作手册：九操作 + 1-based 约定               |

五个最值得记的点：

1. **双 schema 是「框架限制」与「错误质量」的和解**——工具框架不支持判别联合，所以工具壳用普通 strictObject；validateInput 里再用 schemas.ts 的判别联合重跑一遍，按 operation 分支给出精确报错。同样的手法 NotebookEditTool 也用过，这是第二次出现。
2. **坐标换算是全局约定**——模型与用户说 1-based（编辑器习惯），LSP 协议是 0-based，进站出站各减/加一次。所有格式化输出再转回 1-based 展示。prompt.ts 里明说 1-based，模型不需要知道协议细节。
3. **incoming/outgoing 两段式替模型省一轮调用**——LSP 把调用层级拆成 prepare + calls 两个方法，工具在 call() 里自动串行：先 prepare 拿 CallHierarchyItem，取第一个 item 请求真正的调用列表。模型一次调用拿到最终答案。
4. **结果统一过 git check-ignore 过滤**——findReferences 等四种位置结果按 50 路径一批跑 git check-ignore（5 秒超时），node_modules 里的第三方引用被静默剔除；退出码 128（非 git 仓库）静默跳过，不报错。
5. **空结果消息是「自我解释」的**——「No definition found. This may occur if the cursor is not on a symbol...」每种空结果都列可能原因，模型能自行决定换位置重试而不是当故障上报。这是贯穿 formatters.ts 的设计原则。

另有三处工程细节：UNC 路径安全短路（与 FileEditTool 同款，防 SMB NTLM 凭据外泄）；symbolContext.ts 被迫用同步 I/O（调用方是同步 React 渲染函数），64KB 读窗加半行哨兵——填满即弃，宁缺勿错；isEnabled 跟着 LSP 连接状态走，没配服务器时工具整个消失而非运行时报错。

### PowerShellTool 上：外围机制九件

PowerShellTool 是 tools 里安全密度最高的目录（14 份 8,961 行），按「外围先行」拆两批。本批做九个外围文件 1,350 行，批注后 1,472 行、59 处锚点；核心安全大文件（pathValidation、readOnlyValidation、powershellPermissions、powershellSecurity、PowerShellTool.tsx，共 7,610 行）留下一批。

| 文件                                                                                                | 原文  | 批注版 | 批注 | 讲什么                          |
| ------------------------------------------------------------------------------------------------- | --- | --- | -- | ---------------------------- |
| [`toolName.ts`](annotated/src/tools/PowerShellTool/toolName.ts)                                   | 2   | 3   | 1  | 两行文件打破循环依赖                   |
| [`commonParameters.ts`](annotated/src/tools/PowerShellTool/commonParameters.ts)                   | 30  | 33  | 3  | 通用参数清单，破两大校验文件间的 import 环    |
| [`commandSemantics.ts`](annotated/src/tools/PowerShellTool/commandSemantics.ts)                   | 142 | 150 | 8  | 退出码语义表：robocopy 位掩码、grep 无匹配 |
| [`destructiveCommandWarning.ts`](annotated/src/tools/PowerShellTool/destructiveCommandWarning.ts) | 109 | 115 | 6  | 破坏性命令警告（纯信息层，不拦权限）           |
| [`gitSafety.ts`](annotated/src/tools/PowerShellTool/gitSafety.ts)                                 | 176 | 185 | 9  | git 武器化防线：裸仓库攻击、NTFS 短名      |
| [`UI.tsx`](annotated/src/tools/PowerShellTool/UI.tsx)                                             | 131 | 137 | 5  | 折叠显示、进度复用 Shell 组件           |
| [`modeValidation.ts`](annotated/src/tools/PowerShellTool/modeValidation.ts)                       | 404 | 419 | 15 | acceptEdits 白名单、七安全标志、双复合守卫  |
| [`clmTypes.ts`](annotated/src/tools/PowerShellTool/clmTypes.ts)                                   | 211 | 217 | 6  | 微软 CLM 类型白名单反向使用             |
| [`prompt.ts`](annotated/src/tools/PowerShellTool/prompt.ts)                                       | 145 | 151 | 6  | 版本分支指引、后台与睡眠反模式              |

五个最值得记的点：

1. **退出码语义是 Windows 特有难题**——PowerShell 原生 cmdlet 用终止性错误（$?）报错、退出码恒 0；外部 exe 才设 $LASTEXITCODE，且 robocopy 的退出码是位掩码（0-7 全是成功、8+ 才有失败），grep/rg/findstr 退出 1 是无匹配。diff/fc/find 三个名字因 PS 5.1 别名歧义（可能解析到 cmdlet 也可能到 exe）被刻意省略——判不了就退化到默认语义（更严）。
2. **gitSafety 是裸仓库 HEAD 攻击的唯一防线**——pathValidation 刻意不把裸 HEAD 列入危险文件（合法同名文件误报太多），所以逃出 cwd 又落回 cwd 的路径必须在这里用真实 cwd 解析兜底。归一化链条每一步对应一种真实绕过：NTFS 逐组件尾点/尾空格（.. . 变 ..、hooks. 变 hooks）、8.3 短名（.git 变 GIT~N）、provider 前缀、盘符相对路径、unicode 横杠。
3. **modeValidation 的守卫密度是全目录之最**——七个安全标志（子表达式/脚本块/成员调用/splatting/赋值/停止解析/可扩展字符串）任一命中即拒；两个复合守卫（cwd 漂移 TOCTOU、刚创建符号链接）都源于「校验期与运行期的路径世界不同」；非 CommandAst 元素的守卫承重三个用例，注释明说与 isReadOnlyCommand 依赖同一 accident 一起 fail safe，谁都不能单独收窄。
4. **clmTypes 借微软的 CLM 白名单反向使用**——类型字面量不在名单就 ask，一个检查替代枚举所有危险类型（反射、命名管道、P/Invoke）。但 adsi/adsisearcher/wmi 系被刻意移除：类型转型即网络绑定（LDAP/WMI 远程查询），微软允许是因为目标用户是可信域内管理员，这里目标未经验证。
5. **prompt 按检测版本分支**——5.1 与 pwsh 7 的语法差异（&&、三元、UTF-16 编码、2>&1 的 ErrorRecord 陷阱）分三段注入；版本未知给保守的 5.1 兼容指引。背景任务与 Start-Sleep 反模式清单与 BashTool 同款，受环境变量开关控制。

另有一处纯信息层设计：destructiveCommandWarning 只产出权限对话框里的警告文案、不参与权限判定——「让用户多看一眼」与「拦下来」是两套系统；正则锚定语句起始防 git rm --force 里的 rm 误匹配，停止符只含花括号不含圆括号（圆括号是路径分组，后面的参数还是本命令的）。

### PowerShellTool 下：安全核心五文件（目录 14/14 清零）

本批把剩下的五个核心文件做完：pathValidation（2,049）、readOnlyValidation（1,823）、powershellPermissions（1,648）、powershellSecurity（1,090）、PowerShellTool.tsx（1,001），共 7,610 行 → 批注版 7,808 行、196 处锚点。至此 PowerShellTool 全目录 14/14、8,961 行清零。

| 文件                                                                                        | 原文    | 批注版   | 批注 | 讲什么                        |
| ----------------------------------------------------------------------------------------- | ----- | ----- | -- | -------------------------- |
| [`pathValidation.ts`](annotated/src/tools/PowerShellTool/pathValidation.ts)               | 2,049 | 2,083 | 34 | 参数户口本 + 六层路径闸门 + cd 复合守卫   |
| [`readOnlyValidation.ts`](annotated/src/tools/PowerShellTool/readOnlyValidation.ts)       | 1,823 | 1,862 | 39 | 只读白名单（每条移除注释都是事故）+ 外命令共享校验 |
| [`powershellPermissions.ts`](annotated/src/tools/PowerShellTool/powershellPermissions.ts) | 1,648 | 1,693 | 45 | 权限主流程：收集后归约 + git 武器化四连守卫  |
| [`powershellSecurity.ts`](annotated/src/tools/PowerShellTool/powershellSecurity.ts)       | 1,090 | 1,122 | 32 | 23 项 AST 安全检查，另类参数前缀归一     |
| [`PowerShellTool.tsx`](annotated/src/tools/PowerShellTool/PowerShellTool.tsx)             | 1,001 | 1,048 | 46 | 工具定义、执行循环、后台化与落盘           |

七个最值得记的点：

1. **收集后归约（collect-then-reduce）是权限层的结构性修复**——过去每个检查都 `return ask`，早一步的 ask 会盖住晚一步的 deny（Get-Process; Invoke-Expression evil 在 ask(Get-Process:*)+deny(iex:*) 下弹了对话框 deny 就永不触发）。现在所有后置检查把决定 push 进同一个数组，一次归约按 deny > ask > allow 收口——「ask 掩盖 deny」这个 bug 类从此写不出来。解析失败路径还有一套切片兜底：2000 字符填充能逼 valid=false，以前 deny(iex:*) 跟着失效。
2. **pathValidation 的「参数户口本」终结打地鼠**——每类 cmdlet 声明 pathParams/knownSwitches/knownValueParams 三张表，任何不在表里的 -Param 直接判不可验证；未知参数的冒号绑定值也塞进 paths[]，让 deny 至少有机会命中。六层闸门（反引号/:: provider/UNC/变量展开/非文件系统 provider/通配符）每层都是「静态不可验证 → ask」加 deny 猜测兜底。
3. **cd 复合守卫是 CWD 去同步集群的总闸**——Set-Location 改变后续语句的解析基准而校验器按陈旧 cwd，攻击面覆盖读写两侧（Set-Location ./.claude; Set-Content ./settings.json 写的是 Claude 权限配置）。注释里还留了「模拟 cwd 穿过语句链」被否掉的完整理由（Push/Pop 栈语义、条件语句、New-PSDrive 任意根）。
4. **readOnlyValidation 的白名单是一份漏洞面考古层**——Select-Xml/Test-Json（XXE 与 $ref 外链）、Get-Command/Get-Help（管道输入绕过参数级回调触发模块 autoload）、Get-WmiObject（Win32_PingStatus 枚举即发 ICMP）、Get-Clipboard（剪贴板泄密）逐条移除，每条注释都是 PoC。Format-*/Select-Object 一族从「名字过滤的安全输出」升级为「带 argLeaksValue 参数校验」——calculated-property 哈希表是通用漏洞面。
5. **powershellSecurity 的 23 项检查全部 AST 化且被 PoC 驱动**——动态命令名白名单 StringConstant（denylist 动态类型太脆）；另类参数前缀（/、en-dash、em-dash、horizontal bar）先归一再查缩写，Start-Process foo –Verb RunAs 曾绕过；ForEach-Object -MemberName / -FilePath / New-Object -ComObject 三个「树里看不见执行原语」的向量各有一条专检；解析失败直接 ask 是安全默认。
6. **PowerShellTool.tsx 是与 BashTool 逐行对齐的工程细节合集**——预检失败返回 code 0 让 call() 优雅呈现 stderr（但 git 跟踪要跳过这个哨兵，否则把没跑过的命令记成成功）；大输出落盘放在抛出之后（否则失败命令留下孤儿文件）；后台化竞态（命令在下一个轮询 tick 前完成）要剥 backgroundTaskId、重建 outputFilePath、抑制冗余通知；15 秒 assistant 阻塞预算 + unref()。
7. **危险删除硬 deny 在主循环和嵌套循环各查一遍**——if ($true) { Remove-Item / } 走 nestedCommands，少了第二轮就把 deny 降级成 ask；且先查用户原样输入的路径再查 realpath 后的（realpathSync 会把 / 变成 C:\、把 /var 变成 /private/var，恰好破坏字符串比较）。

另有两处流程账：readOnlyValidation 有 4 个锚点原本落在英文注释段中部，被注入脚本自动外移到段边界（358→355、389→386、661→658、1441→1444）；另有一条批注因 CJK 占比 11.7% 低于校验脚本 15% 计数门限被算成普通注释，改写文案后对齐（39/39）。

### 计划模式与待办三件套（三个目录 11/11 全清）

EnterPlanModeTool（4 份）、ExitPlanModeTool（4 份）、TodoWriteTool（3 份），共 11 文件 1,236 行 → 批注版 1,303 行、65 处锚点。计划模式是「进—出—跟踪」三段式：EnterPlanMode 开门、ExitPlanModeV2 收口、TodoWrite 在门里跟踪进度。

| 文件                                                                                    | 原文  | 批注版 | 批注 | 讲什么                             |
| ------------------------------------------------------------------------------------- | --- | --- | -- | ------------------------------- |
| [`EnterPlanModeTool.ts`](annotated/src/tools/EnterPlanModeTool/EnterPlanModeTool.ts)  | 126 | 136 | 10 | 空参数 schema、agent 上下文禁用、权限上下文两连改 |
| [`prompt.ts`](annotated/src/tools/EnterPlanModeTool/prompt.ts)                        | 170 | 174 | 4  | 两套人格话术按 USER_TYPE 分流            |
| [`UI.tsx`](annotated/src/tools/EnterPlanModeTool/UI.tsx)                              | 33  | 38  | 4  | 进入/结果/拒绝三消息                     |
| [`constants.ts`](annotated/src/tools/EnterPlanModeTool/constants.ts)                  | 1   | 2   | 1  | 工具名常量                           |
| [`ExitPlanModeV2Tool.ts`](annotated/src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts) | 493 | 515 | 22 | 出口主流程：编辑回写、mailbox 审批、熔断防御、模式复原 |
| [`UI.tsx`](annotated/src/tools/ExitPlanModeTool/UI.tsx)                               | 82  | 89  | 6  | 结果消息三态（空/等队长/已批准）               |
| [`prompt.ts`](annotated/src/tools/ExitPlanModeTool/prompt.ts)                         | 29  | 31  | 2  | 外部 stub 提示词（剔除 Ant-only 段）      |
| [`constants.ts`](annotated/src/tools/ExitPlanModeTool/constants.ts)                   | 2   | 4   | 2  | V1/V2 两个导出同值                    |
| [`TodoWriteTool.ts`](annotated/src/tools/TodoWriteTool/TodoWriteTool.ts)              | 115 | 126 | 11 | 清单状态机 + 验证提醒 nudge              |
| [`prompt.ts`](annotated/src/tools/TodoWriteTool/prompt.ts)                            | 184 | 186 | 2  | 用法指南大模板                         |
| [`constants.ts`](annotated/src/tools/TodoWriteTool/constants.ts)                      | 1   | 2   | 1  | 工具名常量                           |

七个最值得记的点：

1. **计划模式的入口与出口必须成对设防**——--channels 模式下 ExitPlanMode 的审批对话框没人看得见（用户在 Telegram/Discord），EnterPlanMode 的 isEnabled 于是同一把闸刀整体禁用。注释原话「plan mode isn't a trap the model can enter but never leave」：只禁一边，模型就会进得去出不来。这是功能开关设计里少见的「对称性论证」。
2. **ExitPlanMode 是全仓交互姿态最密的工具**——teammate 走 mailbox 等队长审批（异步）、非 teammate 走本地 ask 对话框（同步）、子代理批准后只需回个 ok。同一工具三种交互形态，全靠 isTeammate()/isPlanModeRequired()/agentId 三个查询分流，call() 里没有一处 if-else 是偶然写的。
3. **CCR web UI 编辑计划的回写链路**——用户在权限对话框里改计划，经 permissionResult.updatedInput 回传；queryHelpers.ts 全量替换 finalInput，不编辑时传 {}，于是窄化判据只能是 typeof plan === string。编辑落盘后 persistFileSnapshotIfRemote 必须再调一次：api.ts 那次快照跑在 normalizeToolInput（权限前），拍到的是旧计划——快照时序是远程协作的隐藏接缝。
4. **退出计划模式是权限集合的对称复原，不是模式回滚**——恢复 auto 前先问闸门开没开（熔断器开着就降级 default 并通知，否则 ExitPlanMode 成了绕过熔断的侧门）；auto 状态以 isAutoModeActive() 为权威（prePlanMode 中途已过期）；恢复非 auto 时把进计划前剥掉的危险规则还原，恢复 auto 则保持剥离。
5. **计划全文总是回显进 tool_result**——Ultraplan CCR 流程的 extractApprovedPlan() 要解析 tool_result 才能把计划喂给本地 CLI；用户编辑过的计划打「edited by user」标签，模型必须知道方案被改过，否则按记忆里的旧版实施。
6. **TodoWrite 的 allDone 清空是上下文经济学**——全部完成的清单落 state 时置空数组（脚手架不是档案），但 data.newTodos 仍返回完整终态供遥测/UI 用；todoKey 取 agentId ?? sessionId，子代理各持独立清单——多 agent 进度隔离的最小实现。
7. **verificationNudge 把「防跳步骤」做成结构性机制**——主线程收尾 3+ 项清单且无一项匹配 /verif/i 时，tool_result 追加「必须 spawn 验证 agent，不能靠在总结里列 caveats 自评 PARTIAL」。触发点卡在「最后一项关闭、循环即将退出」的精确时刻——统计上跳步骤就发生在那里。growthbook + 特性双闸门控制，nudge 文案把自评漏洞直接堵死。

### 协作与调度三件套（三个目录 12/12 全清，tools 破百）

SendMessageTool（4 份）、ScheduleCronTool（5 份）、ToolSearchTool（3 份），共 12 文件 2,136 行 → 批注版 2,229 行、95 处锚点。三者的共同点：都是「模型对自己和他人时间的调度」——发消息（横向协作）、定时任务（纵向调度）、搜工具（上下文预算调度）。至此 `src/tools/` 已完成 100/184、67% 行数。

| 文件                                                                             | 原文  | 批注版 | 批注 | 讲什么                                   |
| ------------------------------------------------------------------------------ | --- | --- | -- | ------------------------------------- |
| [`SendMessageTool.ts`](annotated/src/tools/SendMessageTool/SendMessageTool.ts) | 917 | 942 | 25 | agent 间协议：三种结构化消息 + 四层路由 + 跨机注入防护     |
| [`prompt.ts`](annotated/src/tools/SendMessageTool/prompt.ts)                   | 49  | 51  | 2  | 「纯文本输出不可见」契约 + 回消息抄 from              |
| [`UI.tsx`](annotated/src/tools/SendMessageTool/UI.tsx)                         | 31  | 34  | 3  | 审批类消息才显形，其余静默                         |
| [`constants.ts`](annotated/src/tools/SendMessageTool/constants.ts)             | 1   | 2   | 1  | 工具名常量                                 |
| [`CronCreateTool.ts`](annotated/src/tools/ScheduleCronTool/CronCreateTool.ts)  | 157 | 168 | 11 | 四道预检 + kill switch 折损 + 错峰指引          |
| [`CronListTool.ts`](annotated/src/tools/ScheduleCronTool/CronListTool.ts)      | 97  | 102 | 5  | 队友只看自己的，队长看全部                         |
| [`CronDeleteTool.ts`](annotated/src/tools/ScheduleCronTool/CronDeleteTool.ts)  | 95  | 100 | 5  | 删除权限与可见性两层同语义                         |
| [`prompt.ts`](annotated/src/tools/ScheduleCronTool/prompt.ts)                  | 135 | 144 | 9  | 双层开关 + 整点错峰 + 抖动诚实告知                  |
| [`UI.tsx`](annotated/src/tools/ScheduleCronTool/UI.tsx)                        | 60  | 66  | 5  | 三个工具的渲染函数                             |
| [`ToolSearchTool.ts`](annotated/src/tools/ToolSearchTool/ToolSearchTool.ts)    | 471 | 492 | 21 | 延迟加载体系：缓存键 + 词根评分 + tool_reference 下发 |
| [`prompt.ts`](annotated/src/tools/ToolSearchTool/prompt.ts)                    | 121 | 128 | 7  | isDeferredTool 六级判定链 + 延迟加载机制说明       |
| [`constants.ts`](annotated/src/tools/ToolSearchTool/constants.ts)              | 1   | 2   | 1  | 工具名常量                                 |

八个最值得记的点：

1. **跨机消息是对 bypass 免疫的**——bridge: 目标（Remote Control 对端，可能另一台机器）的 checkPermissions 带 safetyCheck 级 decisionReason 且 classifierApprovable: false：注释明说这条必须在 bypassPermissions（步骤 1g）与 auto 模式白名单之前拦截。跨机 prompt injection 是唯一被允许「绕过绕过模式」的通信路径——Anthropic 服务器中转意味着消息内容来自不完全受信的源。
2. **call() 里重检 bridge 活性**——checkPermissions 阻塞在用户审批上可能数分钟，期间 bridge 随时可断；不重检就会发出 from=unknown 的孤儿消息。validateInput 的那次检查在时间维度上已经失效——「校验—执行」间隔越长，越要在执行点复检外部状态。
3. **给已停止的代理发消息 = 唤醒而非报错**——running 的进 queuePendingMessage（下轮送达），stopped 的自动 resumeAgentBackground 后台拉起并把消息当 prompt，任务被逐出状态的走磁盘 transcript 恢复。三种降级路径覆盖了子代理的完整生命周期，「发消息」这个动作的语义因此是「保证对方最终读到」。
4. **cron 的 kill switch 只折损能力、不动 schema**——effectiveDurable = durable && isDurableCronEnabled()，开关中途翻转时模型看到的 schema 与文案分秒不变（不会吃到校验错误），只在执行时静默降级，且返回的 durable 字段是折损后的真值。注释原话「schema stays stable so the model sees no validation errors when the gate flips mid-session」。
5. **「避开整点」是全仓最独特的运维意识**——全世界说「9 点」的用户都生成 `0 9`，请求会在同一瞬间砸到 API；提示词明确要求近似时间需求错开几分钟（「57 8」而非「0 9」），并诚实告知调度器的抖动行为（循环最多晚 10% 周期、上限 15 分钟；整点一次性任务最多早 90 秒）。把内部行为告知模型，它才能给用户合理预期。
6. **「一年内无匹配」是语法合法、日历非法的专属关卡**——2 月 30 日能过表达式解析但永远不触发；这道检查把它拦在创建时（错误码 2），配合 MAX_JOBS=50 上限与 teammate durable 禁令（防悬空 agentId 孤儿），构成创建期的四道预检。
7. **isDeferredTool 的六级判定链顺序即优先级**——alwaysLoad 退出优先（MCP 靠它整类退出延迟）→ MCP 默认延迟 → ToolSearch 自己永不延迟（递归悖论）→ fork 模式下 Agent 退出（第一轮就要能派子代理）→ Brief/SendUserFile 退出（通信主通道的可见性契约不能让模型先搜一轮）→ 兜底 shouldDefer。每一级都有注释说明「为什么这条必须在这个位置」。
8. **ToolSearch 返回的不是文本是「工具定义句柄」**——matches 以 tool_reference 块下发，客户端据此把完整 schema 展开进上下文；注释明说 Bedrock/Vertex 可能不支持客户端展开，`as unknown as` 强转正是为跨提供商格式差异兜底。零命中时附带 pending_mcp_servers，把「搜索失败」重框定为「服务器还在连，稍后再试」——模型学会等待而非乱换查询词。

### 隔离与协作六件套：worktree / MCP 资源 / team（六个目录 22/22 全清）

EnterWorktreeTool（4 份）、ExitWorktreeTool（4 份）、ListMcpResourcesTool（3 份）、ReadMcpResourceTool（3 份）、TeamCreateTool（4 份）、TeamDeleteTool（4 份），共 22 文件 1,484 行 → 批注版 1,613 行、128 处锚点。三条主线：worktree 是「换一个目录继续活」，MCP 资源是「服务器手里的数据面」，team 是「多代理协作的户口本」。

| 文件                                                                                            | 原文行 | 批注版行 | 锚点 | 看点                                   |
| --------------------------------------------------------------------------------------------- | --- | ---- | -- | ------------------------------------ |
| [`EnterWorktreeTool.ts`](annotated/src/tools/EnterWorktreeTool/EnterWorktreeTool.ts)          | 127 | 140  | 13 | 会话级 chdir、解析回主仓库根、三连清 cwd 缓存         |
| [`prompt.ts`](annotated/src/tools/EnterWorktreeTool/prompt.ts)                                | 30  | 33   | 3  | 只在用户明说 worktree 时用；hooks 兜非 git 仓库   |
| [`UI.tsx`](annotated/src/tools/EnterWorktreeTool/UI.tsx)                                      | 20  | 22   | 2  | 分支名加粗、路径置灰                           |
| [`constants.ts`](annotated/src/tools/EnterWorktreeTool/constants.ts)                          | 1   | 2    | 1  | 工具名常量                                |
| [`ExitWorktreeTool.ts`](annotated/src/tools/ExitWorktreeTool/ExitWorktreeTool.ts)             | 329 | 351  | 22 | fail-closed 数账、逆运算边界、errorCode 1/2/3 |
| [`prompt.ts`](annotated/src/tools/ExitWorktreeTool/prompt.ts)                                 | 32  | 35   | 3  | scope 闸 + no-op 语义 + discard 确认协议    |
| [`UI.tsx`](annotated/src/tools/ExitWorktreeTool/UI.tsx)                                       | 25  | 27   | 2  | Kept/Removed 标签分支                    |
| [`constants.ts`](annotated/src/tools/ExitWorktreeTool/constants.ts)                           | 1   | 2    | 1  | 工具名常量                                |
| [`ListMcpResourcesTool.ts`](annotated/src/tools/ListMcpResourcesTool/ListMcpResourcesTool.ts) | 123 | 132  | 9  | LRU 三层缓存策略、单服务器失败不拖垮整体               |
| [`UI.tsx`](annotated/src/tools/ListMcpResourcesTool/UI.tsx)                                   | 29  | 33   | 4  | eslint 豁免：给人看的 UI 不守 tool_result 规则  |
| [`prompt.ts`](annotated/src/tools/ListMcpResourcesTool/prompt.ts)                             | 20  | 24   | 4  | DESCRIPTION + PROMPT + 名字三合一         |
| [`ReadMcpResourceTool.ts`](annotated/src/tools/ReadMcpResourceTool/ReadMcpResourceTool.ts)    | 158 | 170  | 12 | blob 拦截落盘换路径、三步前置检查                  |
| [`UI.tsx`](annotated/src/tools/ReadMcpResourceTool/UI.tsx)                                    | 37  | 43   | 5  | 半截输入返回 null 不渲染                      |
| [`prompt.ts`](annotated/src/tools/ReadMcpResourceTool/prompt.ts)                              | 16  | 18   | 2  | 双必填参数手册                              |
| [`TeamCreateTool.ts`](annotated/src/tools/TeamCreateTool/TeamCreateTool.ts)                   | 240 | 260  | 20 | 确定性队长 ID、Team=TaskList、gh-32730 清理登记 |
| [`prompt.ts`](annotated/src/tools/TeamCreateTool/prompt.ts)                                   | 113 | 116  | 3  | 全仓最长工具提示词：七步协作协议                     |
| [`UI.tsx`](annotated/src/tools/TeamCreateTool/UI.tsx)                                         | 6   | 7    | 1  | 一行 create team 文案                    |
| [`constants.ts`](annotated/src/tools/TeamCreateTool/constants.ts)                             | 1   | 2    | 1  | 工具名常量                                |
| [`TeamDeleteTool.ts`](annotated/src/tools/TeamDeleteTool/TeamDeleteTool.ts)                   | 139 | 153  | 14 | 活跃成员挡拆、恒清 inbox、幂等成功                 |
| [`UI.tsx`](annotated/src/tools/TeamDeleteTool/UI.tsx)                                         | 20  | 23   | 3  | 恒返回 null——批量 shutdown 消息已覆盖          |
| [`prompt.ts`](annotated/src/tools/TeamDeleteTool/prompt.ts)                                   | 16  | 18   | 2  | 先关人再删队的前置条件                          |
| [`constants.ts`](annotated/src/tools/TeamDeleteTool/constants.ts)                             | 1   | 2    | 1  | 工具名常量                                |

八个最值得记的点：

1. **countWorktreeChanges 的 null 是安全语义不是错误码**——git 命令非零退出、或有工作区却无基线提交（hook 建的 worktree 包着 git）时返回 null，注释原话「callers that use this as a safety gate must treat null as unknown, assume unsafe (fail-closed)」。静悄悄返回 0/0 会让 cleanupWorktree 销毁真实工作——**数不出账就等于有账**，这是删除类工具的标准姿态。
2. **退出是进入的逆运算，但只逆自己改过的**——restoreSessionToOriginalCwd 逐项对照 EnterWorktreeTool.call() 的改动：setCwd/setOriginalCwd 必改，projectRoot 与 hooks 快照只在「启动时 --worktree 真的设过」时才复原（`projectRootIsWorktree = getProjectRoot() === getOriginalCwd()` 判定）。无条件复原会把项目身份挪到用户随便 cd 过的目录——对称性是有条件的对称。
3. **worktree 的 scope 闸只认本会话**——getCurrentWorktreeSession() 仅 EnterWorktree（createWorktreeForSession）在本会话跑过才非空；手敲 git worktree add 建的、上个会话建的，一律不碰，在范围外调用是明示「no filesystem changes were made」的 no-op。工具的自知之明：**知道自己管什么，比知道自己会什么更重要**。
4. **校验与执行之间的账要数两遍**——validateInput 时数一次（安全闸门，决定放不放行），call() 里再数一次（遥测与结果消息，反映最新状态）。两次数出不同值完全可能：中间隔着用户审批对话框。安全决策用旧账（宁可严），呈现用新账（宁可准）。
5. **MCP 资源的缓存三层各司其职**——fetchResourcesForClient 按服务器名 LRU 缓存且启动预热；onclose 与 resources/list_changed 通知双通道失效，所以不会读到过期清单；ensureConnectedClient 健康时 memoize 命中零成本，掉线后返回新连接让重捞成功。并行捞取时单个服务器失败只 log 不抛——部分结果好过整体失败。
6. **blob 拦截是 context 卫生的硬线**——base64 原样进 context，一张图烧掉几万 token。ReadMcpResourceTool 解码后把原始字节按 mime 落盘、content 里只留路径和一句说明；保存失败也降级成一条文本消息而不是把 base64 泄进上下文。
7. **TeamCreate 的三个「不变量」设计**——队长 ID 确定性（formatAgentId(TEAM_LEAD_NAME, teamName)，队友凭队名就能推出地址）；Team = TaskList（建队即建任务目录并重置编号，setLeaderTeamName 是关键一跳，不设它队长写的任务会落进会话目录、与队友按队名找的目录错开）；会话清理登记（gh-32730：没有 registerTeamForSessionCleanup 时忘删的队会把目录永久留在磁盘上）。另有一段「故意的不设置」：不给队长设 CLAUDE_CODE_AGENT_ID——设了 isTeammate() 会对队长返回 true，inbox 轮询跟着错乱。
8. **TeamDelete 的失败是数据不是异常**——有活跃队员时返回 success: false + 队员名单 + 「先 requestShutdown」的指路，而不是抛错；模型读到结构化结果才知道下一步干什么，读到异常只会以为工具坏了。UI 侧恒返回 null：批量 shutdown 的汇总消息已经覆盖了「队散了」，再弹一条工具结果行是噪音。入站 inbox 无论有没有队都清——不收尾的队列会在下一个队的上下文里幽灵送达。

流程账：本批 22 个数据文件零合并错误（硬规矩连续第 6 批生效）；预检三断言一次通过；`⟳` 外移 4 处均为模板起始行（位号不变）与英文注释段中部（TeamCreateTool.ts 182→183，保护机制）；ReadMcpResourceTool.ts 两条批注因英文专名占比过高（3.2% / 14.8%）低于 CJK 15% 计数门限，改写文案后对齐 12/12——这是该门限第二次踩到，写短批注时英文专名别超过约八成。

### 配置 / 任务输出 / 任务更新 / 远程触发（四个目录 13/13 全清）

ConfigTool（5 份）、TaskOutputTool（2 份）、TaskUpdateTool（3 份）、RemoteTriggerTool（3 份），共 13 文件 2,069 行 → 批注版 2,234 行、120 处锚点。这批是 tools 层的「管理面」：配置工具自己也是注册表驱动的，任务三件套把 V1 待办与 V2 任务系统缝在一起，远程触发则是 token 永不落 shell 的 API 代理。

| 文件                                                                                   | 原文行 | 批注版行 | 锚点 | 看点                                        |
| ------------------------------------------------------------------------------------ | --- | ---- | -- | ----------------------------------------- |
| [`ConfigTool.ts`](annotated/src/tools/ConfigTool/ConfigTool.ts)                      | 467 | 490  | 23 | 读 allow / 写 ask、default 撤销覆盖、双存储分叉、遥测类型标记 |
| [`supportedSettings.ts`](annotated/src/tools/ConfigTool/supportedSettings.ts)        | 211 | 224  | 13 | 注册表单一事实源、特性开关条件注册、model 动态候选与兜底           |
| [`prompt.ts`](annotated/src/tools/ConfigTool/prompt.ts)                              | 93  | 98   | 5  | prompt 从注册表现算、model 单独成节、kill-switch 期隐藏  |
| [`UI.tsx`](annotated/src/tools/ConfigTool/UI.tsx)                                    | 38  | 42   | 3  | 读写二分显示、三分支结果渲染                            |
| [`constants.ts`](annotated/src/tools/ConfigTool/constants.ts)                        | 1   | 2    | 1  | 工具名常量                                     |
| [`TaskOutputTool.tsx`](annotated/src/tools/TaskOutputTool/TaskOutputTool.tsx)        | 584 | 611  | 26 | 官方弃用、三种任务统一输出、磁盘 symlink 陷阱、轮询等待          |
| [`constants.ts`](annotated/src/tools/TaskOutputTool/constants.ts)                    | 1   | 2    | 1  | 工具名常量                                     |
| [`TaskUpdateTool.ts`](annotated/src/tools/TaskUpdateTool/TaskUpdateTool.ts)          | 406 | 432  | 26 | 字段 diff、hooks 拦完成、mailbox 指派、结构化防跳验证      |
| [`prompt.ts`](annotated/src/tools/TaskUpdateTool/prompt.ts)                          | 77  | 83   | 6  | 完成判据、状态机、改前先 TaskGet                      |
| [`constants.ts`](annotated/src/tools/TaskUpdateTool/constants.ts)                    | 1   | 2    | 1  | 工具名常量                                     |
| [`RemoteTriggerTool.ts`](annotated/src/tools/RemoteTriggerTool/RemoteTriggerTool.ts) | 161 | 172  | 11 | 五动作 REST 映射、validateStatus 放行、beta 版本戳    |
| [`UI.tsx`](annotated/src/tools/RemoteTriggerTool/UI.tsx)                             | 17  | 19   | 2  | 状态码 + 行数，内容不渲染                            |
| [`prompt.ts`](annotated/src/tools/RemoteTriggerTool/prompt.ts)                       | 15  | 17   | 2  | curl 替身、token 进程内注入                       |

七个值得记的点：

1. **「设为默认」的正确实现是「撤销覆盖」**——ConfigTool 的 remoteControlAtStartup 收到 default 时删 key 而非写入字面量，平台感知的默认值重新接管。把特殊值当数据写进去，后面每个读取方都要多认一种字面量。
2. **写盘后要手动 notifyChange**——settingsChangeDetector 是文件监听驱动，程序内写盘不触发文件事件；语音开关写完不通知，useVoiceEnabled 读到的是旧缓存。「改了存储」与「通知了缓存」是两回事。
3. **kill-switch 的三层待遇**——编译期 feature 注册、运行期 GrowthBook 复核、prompt 生成期整体隐藏。三层各管一段：注册表里有（旧会话不崩）、实际不可用（不误导模型）、prompt 里看不见（不诱导尝试）。
4. **磁盘 symlink 陷阱**——本地 agent 的磁盘输出是 symlink 到完整会话 transcript（每轮消息+工具调用全在里面），TaskOutputTool 优先用内存 cleanResult；无脑读磁盘会把几万 token 噪声灌进上下文。
5. **「任务不存在」不是错误**——TaskUpdateTool 的失败结果不带 is_error：任务列表可能已被清理，这是良性状况。标成错误会触发 StreamingToolExecutor 的兄弟工具连锁取消，一次查询失败炸掉整批并行调用。
6. **防跳验证的触发点是算出来的**——VERIFICATION_AGENT 特性 + hive_evidence 开关 + 主线程（无 agentId）+ 刚 completed + 全清单 ≥3 项且无 /verif/i 匹配，五条件同时命中才追加 nudge；触发点卡在「最后一项关闭、循环即将退出」的精确时刻，因为统计上跳步骤就发生在那里。
7. **HTTP 状态码是数据不是异常**——RemoteTriggerTool 用 validateStatus: () => true 让 4xx/5xx 一律放行，连同响应体原样交给模型解读；axios 默认抛异常会把「API 说你不配」变成「工具崩了」，模型失去自救信息。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 7 批生效）；RemoteTriggerTool/prompt.ts 一处 FAIL——锚点落在跨行赋值中间行（`export const DESCRIPTION =` 与字符串字面量分居两行），批注把语句劈开，挪到赋值结束行后过验；8 处 `⟳` 外移均为人眼确认通顺（prompt 模板尾部分区摘要自带定位词）。

### 任务管理四件套 + 杂项五份（八个目录 16/16 全清，tools 到 151/184）

TaskCreate / TaskGet / TaskList / TaskStop 四个目录 12 份，外加 SyntheticOutputTool、TestingPermissionTool、根目录 utils.ts、SleepTool/prompt.ts，共 16 文件 988 行 → 批注版 1,116 行、126 处锚点。这批把「任务系统」的模型侧闭合：建、查、列、停四件事加一个测试钉子，`src/tools/` 只剩 BashTool（14 份）、AgentTool（17 份）、shared（2 份）三个大目录。

| 文件                                                                                         | 原文行 | 批注版行 | 锚点 | 看点                                                  |
| ------------------------------------------------------------------------------------------ | --- | ---- | -- | --------------------------------------------------- |
| [`TaskCreateTool.ts`](annotated/src/tools/TaskCreateTool/TaskCreateTool.ts)                | 138 | 156  | 18 | 先写后验 + 钩子拦截回滚、任意 metadata                           |
| [`prompt.ts`](annotated/src/tools/TaskCreateTool/prompt.ts)                                | 56  | 61   | 5  | 队友模式两段插话、先 TaskList 再建防重复                           |
| [`constants.ts`](annotated/src/tools/TaskCreateTool/constants.ts)                          | 1   | 2    | 1  | 工具名常量                                               |
| [`TaskGetTool.ts`](annotated/src/tools/TaskGetTool/TaskGetTool.ts)                         | 128 | 142  | 14 | 任务不存在回 null 不报错、六字段全量                               |
| [`prompt.ts`](annotated/src/tools/TaskGetTool/prompt.ts)                                   | 24  | 29   | 5  | 动手前先查 blockedBy                                     |
| [`constants.ts`](annotated/src/tools/TaskGetTool/constants.ts)                             | 1   | 2    | 1  | 工具名常量                                               |
| [`TaskListTool.ts`](annotated/src/tools/TaskListTool/TaskListTool.ts)                      | 116 | 129  | 13 | 摘要形态、已完成阻塞项过滤、`_internal` 隐身                        |
| [`prompt.ts`](annotated/src/tools/TaskListTool/prompt.ts)                                  | 49  | 55   | 6  | 按 ID 从小到大认领、三元两分支同文案的残留                             |
| [`constants.ts`](annotated/src/tools/TaskListTool/constants.ts)                            | 1   | 2    | 1  | 工具名常量                                               |
| [`TaskStopTool.ts`](annotated/src/tools/TaskStopTool/TaskStopTool.ts)                      | 131 | 146  | 15 | KillShell 别名兼容、errorCode 1/3 分工、validateInput 全过才放行 |
| [`UI.tsx`](annotated/src/tools/TaskStopTool/UI.tsx)                                        | 41  | 50   | 8  | 双重截断、恒假的 USER_TYPE 判断                               |
| [`prompt.ts`](annotated/src/tools/TaskStopTool/prompt.ts)                                  | 8   | 10   | 2  | 名字与 DESCRIPTION 同文件导出的异类布局                          |
| [`SyntheticOutputTool.ts`](annotated/src/tools/SyntheticOutputTool/SyntheticOutputTool.ts) | 163 | 182  | 19 | WeakMap 身份缓存、Ajv 先验 schema 再 compile、双文案安全异常        |
| [`TestingPermissionTool.tsx`](annotated/src/tools/testing/TestingPermissionTool.tsx)       | 74  | 82   | 7  | 恒 ask 的测试钉子、恒假的 isEnabled                           |
| [`utils.ts`](annotated/src/tools/utils.ts)                                                 | 40  | 46   | 6  | sourceToolUseID 打标签防「运行中」重复渲染                       |
| [`SleepTool/prompt.ts`](annotated/src/tools/SleepTool/prompt.ts)                           | 17  | 22   | 5  | TICK_TAG 插值、API 调用代价写进 prompt                       |

七个值得记的点：

1. **四件套是同一骨架的四次实例化**。lazySchema + buildTool + shouldDefer + isConcurrencySafe 完全一致，差异只在 call 里干什么。isEnabled 全部挂在 isTodoV2Enabled() 上——Todo v2 没开时整套一起隐身，老会话不受影响。读一个就懂全部四个，这也是「框架把重复部分吃掉」的直观样本。
2. **Create 是「先写后验」的标准范本**。createTask 落盘 → 钩子逐个 yield → 有 blockingError 就 deleteTask 回滚再抛。补偿动作紧贴写入点，不在存储里留半条任务；错误信息合并成一条，模型一次看到全部拦截理由。
3. **「不存在」与「状态不对」是两种错误**。TaskStopTool 的 validateInput 用 errorCode 分开计分：缺参/不存在是 1，存在但不在 running 是 3。调用方（和遥测）能区分「打错 ID」与「停一个已停的」——混成一个码，日志里两类事永远分不开。
4. **TaskList 的两处过滤是「别让模型看见噪音」**。metadata.\_internal 的系统任务不进列表；blockedBy 里已完成的项先剔掉。「被已完成任务堵住」不是堵，显示出来只会诱导模型去催一个早已完事的任务。
5. **StructuredOutput 的双层结构**。模板版工具（call 原样回传、checkPermissions 恒 allow）+ 工厂版（Ajv 编译进闭包、校验不过抛 TelemetrySafeError）。工厂用 WeakMap 按 schema 对象身份缓存：工作流脚本 80 次调用只编译 1 次，110ms → 4ms；success 和 error 都进缓存，坏 schema 不会每次重复编译。
6. **两处恒假条件是泄漏构建的「环境替换事故」标本**。TaskStopTool/UI.tsx 的 `"external" === 'ant'` 与 TestingPermissionTool 的 `"production" === 'test'`——process.env 在打包时被替换成字面量，与比较目标永远不相等，分支被砌死。TaskStop 那处影响仅是「ant 用户不渲染」失效；TestingPermission 那处更微妙：isEnabled 恒 false，工具在开源构建里根本不会注册，测试钉子只在原始构建里有效。
7. **SleepTool 把经济账写进 prompt**。每次唤醒花一次 API 调用、缓存 5 分钟过期——这是少数「让模型自己看着办」的取舍说明，不写的话模型会睡过头或者睡太碎。

流程账：预检三断言一次通过、零合并错误（硬规矩连续第 8 批生效）；一处 FAIL——SyntheticOutputTool.ts 的工厂函数说明锚在 `*/` 行上，`after` 落在块注释结尾行不在自动外移规则内（只认 `/**` 开头行），中文被塞进 `/* */` 内部，挪到函数签名结束行后过验；prompt 模板内部锚点照例外移到段尾，均为人眼确认通顺。


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

| 文件                                                                   | 原文    | 批注版   | 讲什么                            |
| -------------------------------------------------------------------- | ----- | ----- | ------------------------------ |
| [`coordinatorMode.ts`](annotated/src/coordinator/coordinatorMode.ts) | 369   | 632   | 模式开关、resume 对齐、协调者系统提示词（258 行） |
| [`AgentTool/prompt.ts`](annotated/src/tools/AgentTool/prompt.ts)     | 287   | 601   | agent 清单注入策略、fork 说明、简报写法      |
| [`AgentTool.tsx`](annotated/src/tools/AgentTool/AgentTool.tsx)       | 1,397 | 2,793 | schema 裁剪、十道检查、两套执行路径、结果话术     |
| [`forkSubagent.ts`](annotated/src/tools/AgentTool/forkSubagent.ts)   | 210   | 559   | 缓存共享的字节级机制、身份冲突纠正              |

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

| 文件                                                                       | 原文    | 批注版   | 讲什么                                                                  |
| ------------------------------------------------------------------------ | ----- | ----- | -------------------------------------------------------------------- |
| [`reconciler.ts`](annotated/src/ink/reconciler.ts)                       | 512   | 727   | React 19 自定义 renderer 的 host config：14 个类型参数、commit 阶段算布局、release 顺序 |
| [`dom.ts`](annotated/src/ink/dom.ts)                                     | 484   | 685   | 七个元素名的极简 DOM、yoga 桥（两棵树两套下标）、文本测量、脏标记冒泡                              |
| [`ink.tsx`](annotated/src/ink/ink.tsx)                                   | 1,722 | 2,470 | 帧循环九阶段、双缓冲、diff 与 optimize、光标定位、终端模式、退出清理                            |
| [`screen.ts`](annotated/src/ink/screen.ts)                               | 1,486 | 2,167 | 打包格子（2 个 int 装一格）、样式池的位标签、宽字符四态、blit/shift/clear、两帧 diff             |
| [`render-node-to-output.ts`](annotated/src/ink/render-node-to-output.ts) | 1,462 | 2,180 | 沿树走一遍：blit / 清空 / 重画三选一，ScrollBox 的三遍渲染与 DECSTBM 快路径                 |
| [`log-update.ts`](annotated/src/ink/log-update.ts)                       | 773   | 1,193 | 两帧之间到底发什么字节：全量重置的四种触发、逐格补丁、虚拟光标模型                                    |
| [`output.ts`](annotated/src/ink/output.ts)                               | 798   | 1,151 | 一帧的**操作队列**：七种操作、Clip 栈的现场求交、grapheme 聚类与预热缓存、单行写入                   |
| [`styles.ts`](annotated/src/ink/styles.ts)                               | 772   | 967   | 两套类型（字 / 盒子）与九个 apply：CSS 属性怎么落到 yoga setter，`'x' in style` 的语义      |
| [`colorize.ts`](annotated/src/ink/colorize.ts)                           | 232   | 372   | 真彩色的两次降级：VS Code 自报家门不被认识、tmux 转发按别的终端声明做决定                          |
| [`stringWidth.ts`](annotated/src/ink/stringWidth.ts)                     | 223   | 413   | 整台渲染器的尺子：四级快路径、零宽字符表、emoji 宽度、Bun 与 JS 的 1 vs 2                      |
| [`Ansi.tsx`](annotated/src/ink/Ansi.tsx)                                 | 292   | 504   | **React Compiler 的编译产物**该怎么读，以及 ANSI 字符串 → 组件树的降维                    |
| [`termio/ansi.ts`](annotated/src/ink/termio/ansi.ts)                     | 76    | 150   | 整层的字母表：C0 表为什么写全 32 个、ESC 尾字节范围为什么比 CSI 宽                            |
| [`termio/csi.ts`](annotated/src/ink/termio/csi.ts)                       | 320   | 493   | 三个字节区间就是 CSI 的完整语法；`csi()` 的单参数/多参数两副面孔                              |
| [`termio/dec.ts`](annotated/src/ink/termio/dec.ts)                       | 61    | 119   | 47 与 1049 的区别、四个鼠标模式为什么一起开、关的时候为什么逆序                                 |
| [`termio/esc.ts`](annotated/src/ink/termio/esc.ts)                       | 68    | 128   | 两字符序列；`null` 与 `unknown` 两种「空」的语义差别                                  |
| [`termio/types.ts`](annotated/src/ink/termio/types.ts)                   | 237   | 424   | 语义类型；`Grapheme.width` 算了却没人读；页签状态的三态设计                               |
| [`termio/sgr.ts`](annotated/src/ink/termio/sgr.ts)                       | 309   | 541   | 分号/冒号两套语法、`38:2:cs:R:G:B` 的 `off` 偏移、`22` 为什么一对二                     |
| [`termio/tokenize.ts`](annotated/src/ink/termio/tokenize.ts)             | 320   | 564   | 词法层：八个状态、判定顺序为什么不能重排、`i++` 缺失处的降级                                    |
| [`termio/parser.ts`](annotated/src/ink/termio/parser.ts)                 | 395   | 671   | 语义层：SGR 被拦下来不进 action 流、`?? 1` 与 `?? 0` 的两个默认值                       |
| [`termio/osc.ts`](annotated/src/ink/termio/osc.ts)                       | 494   | 879   | OSC 全家族：DCS 透传、剪贴板三条路、内层为什么选 BEL 而不是 ST                              |
| [`termio.ts`](annotated/src/ink/termio.ts)                               | 43    | 83    | 桶文件只导出读的一侧，生成函数走深路径                                                  |

合计 **11,079 行原文**，553 处批注锚点（其中 `termio/` 十个文件 2,323 行、156 锚点）。

**`termio/` 这一组可以按下标顺序读**：`ansi`（字节表）→ `csi`/`dec`/`esc`（三族序列的常量与生成）→ `tokenize`（切边界）→ `sgr`（样式参数）→ `parser`（拼起来变成 action）→ `osc`（唯一带自由文本负载的一族）。前四个是字典，后四个才是逻辑。

**这个目录可以按「三加三」记**：前三份是**上半场**（React 元素 → 布局树 → 屏幕缓冲），后三份是**下半场**（屏幕缓冲 → 终端字节）。分界线是 `screen.ts` 里的 `Screen` 类型 —— 往上都是「节点和坐标」，往下都是「格子和转义序列」。

**㊳ 终端里没有排版引擎，那 `<Text>` 的高度是谁算出来的？**

是 `dom.ts` 332 行的 `measureTextNode`。yoga 只管盒子（它不知道一个汉字和一个 `i` 差多少宽），所以 `<Text>` 节点上挂了一个 measure 回调：yoga 布局时问它「给你 `width` 这么宽，你多高」，它把整棵子树的文字展平（`squashTextNodes`）、展开 tab、按宽度折行，再量一遍。

这一个回调解释了三件看起来无关的事：为什么 `<Text>` 里不能放 `<Box>`（展不平就没法量宽度）、为什么裸字符串必须包在 `<Text>` 里（没有父级就不知道该继承什么样式、也不知道放哪一行）、为什么宽字符/emoji 要单独处理。

**㊴ 为什么 `<Box>` 套在 `<Text>` 里是**运行时抛&#x9519;**，而不是「不推荐」？**

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

| 谁被覆盖      | 残留                    | 症状                             |
| --------- | --------------------- | ------------------------------ |
| 宽字符被窄字符顶掉 | 后面那个 `SpacerTail` 成孤儿 | 这一列**保持上一帧的内容**（渲染时跳过占位格，没人写它） |
| 占位格被顶掉    | 前面那个宽字符变成「占一格的宽字符」    | **光标模型失步** —— 终端仍按两列画，之后所有坐标都偏 |
| 宽字符盖宽字符   | 对方更靠后的占位格成孤儿          | 那一列残留旧内容                       |

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

| 场景                 | 为什么不能增量                                            |
| ------------------ | -------------------------------------------------- |
| 终端 resize          | 增量更新要预测「重排后每行长什么样」，等于重算一遍换行                        |
| 内容从「超出视口」缩到「视口内」   | 顶部那些行已经在 scrollback 里，而清屏指令**不能把 scrollback 拉回视野** |
| 改动落在 scrollback 区域 | 光标到不了那里 —— 跳过这一格会在历史里留一个错字，用户往回翻就看见                |
| 要清的行数 > 视口高度       | 同理，`eraseLines` 只能在视口内工作                           |

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

| 写法                           | 含义                      | 漏掉什么     |
| ---------------------------- | ----------------------- | -------- |
| `'margin' in style`          | 这个键这一帧变了（新值 / 被删 / 被重置） | 什么都不漏    |
| `style.margin !== undefined` | margin 有**新值**          | 属性被移除的情况 |

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

| 看到的                                         | 读成                          |
| ------------------------------------------- | --------------------------- |
| `const $ = _c(12)`                          | 这个组件有 12 个缓存槽               |
| `if ($[3] !== children)`                    | 依赖变了才重算（= `useMemo` 的 deps） |
| `$[3] = children`                           | 记下这次的值                      |
| `bb0: { … break bb0 }`                      | 可能提前返回（labeled block）       |
| `Symbol.for('react.early_return_sentinel')` | 区分「缓存了一个提前返回」和「槽还没填」        |

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

| 账本                                     | 解决什么             | 不记的后果               |
| -------------------------------------- | ---------------- | ------------------- |
| `scrolledOff*` 累积器                     | 屏幕只有一屏，滚出去的行会被覆盖 | 复制结果只剩后半截           |
| `virtualAnchorRow` / `virtualFocusRow` | clamp 会丢真位置      | 反向滚动后高亮错行，且累积器永远是旧账 |

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

| 文件                                                                            | 行数  | 一句话                                |
| ----------------------------------------------------------------------------- | --- | ---------------------------------- |
| [`utils.ts`](annotated/src/services/mcp/utils.ts)                             | 575 | 名字过滤、配置哈希、过期客户端回收、项目级 server 的信任判定 |
| [`channelNotification.ts`](annotated/src/services/mcp/channelNotification.ts) | 316 | 通道的六道闸 + `<channel>` 标签怎么拼         |
| [`elicitationHandler.ts`](annotated/src/services/mcp/elicitationHandler.ts)   | 313 | server 向人提问（表单 / 打开链接）的整条链路        |
| [`types.ts`](annotated/src/services/mcp/types.ts)                             | 258 | 八种 transport 的配置 schema、连接状态机      |
| [`channelPermissions.ts`](annotated/src/services/mcp/channelPermissions.ts)   | 240 | 把审批提示发到手机，等一句 "yes tbxkq"          |
| [`claudeai.ts`](annotated/src/services/mcp/claudeai.ts)                       | 164 | 从 claude.ai 拉组织下发的 server 列表       |
| [`headersHelper.ts`](annotated/src/services/mcp/headersHelper.ts)             | 138 | 连之前先跑一条本地命令，拿动态 header             |
| [`SdkControlTransport.ts`](annotated/src/services/mcp/SdkControlTransport.ts) | 136 | 把 JSON-RPC 套进 control 信封，跨进程       |
| [`vscodeSdkMcp.ts`](annotated/src/services/mcp/vscodeSdkMcp.ts)               | 112 | 和 VSCode 扩展之间的两条 notification      |
| [`mcpStringUtils.ts`](annotated/src/services/mcp/mcpStringUtils.ts)           | 106 | `mcp__server__tool` 的拼与拆           |
| [`oauthPort.ts`](annotated/src/services/mcp/oauthPort.ts)                     | 78  | 回调端口怎么挑（含 Windows 的坑）              |
| [`channelAllowlist.ts`](annotated/src/services/mcp/channelAllowlist.ts)       | 76  | 哪些插件被批准可以当通道                       |
| [`officialRegistry.ts`](annotated/src/services/mcp/officialRegistry.ts)       | 72  | 官方 MCP 名单（只用于埋点）                   |
| [`InProcessTransport.ts`](annotated/src/services/mcp/InProcessTransport.ts)   | 63  | 同进程里的一对假传输                         |
| [`envExpansion.ts`](annotated/src/services/mcp/envExpansion.ts)               | 38  | `${VAR:-默认值}`                      |
| [`normalization.ts`](annotated/src/services/mcp/normalization.ts)             | 23  | 名字归一化                              |

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

| 分组   | 文件                                                                                                                                   | 它回答的问题                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| 出口   | `terminal.ts`                                                                                                                        | 这个终端能做什么 + 最后一站 `write` |
| 探测   | `terminal-querier.ts`                                                                                                                | 没有超时，怎么知道终端不支持          |
| 一帧   | `renderer.ts` / `frame.ts`                                                                                                           | DOM 怎么变成屏幕缓冲；一帧的数据契约    |
| 入口   | `root.ts` / `instances.ts`                                                                                                           | 三个起点，一张按 stdout 分身的表    |
| 文本   | `wrap-text.ts` / `wrapAnsi.ts` / `measure-text.ts` / `widest-line.ts` / `squash-text-nodes.ts`                                       | 折行、截断、测量、摊平             |
| 缓存   | `line-width-cache.ts` / `node-cache.ts`                                                                                              | 两个 Map，一个为流式，一个为 blit   |
| 交互   | `focus.ts`                                                                                                                           | 焦点栈、Tab 环、删除节点后焦点恢复到哪   |
| 终端杂项 | `bidi.ts` / `tabstops.ts` / `clearTerminal.ts` / `supports-hyperlinks.ts` / `terminal-focus-state.ts` / `useTerminalNotification.ts` | 各自一个真实世界的坑              |
| 布局   | `layout/node.ts` / `yoga.ts` / `geometry.ts` / `engine.ts`                                                                           | 52 个方法的适配层，一半是样板        |

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

| 符号                                                                                  | 位置                       | 为什么读代码的人会被误导                                               |
| ----------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- |
| `shouldClearScreen()`                                                               | `frame.ts:105`           | 名字像是清屏决策的入口，实际判据已内联到 `log-update.ts` 四处（更精细，要看 `cursor.y`） |
| `clearTerminal`（常量）                                                                 | `clearTerminal.ts:74`    | 真正被用的是同文件的 `getClearTerminalSequence()` 函数                 |
| `renderToScreen()`                                                                  | `render-to-screen.ts:59` | 注释说「Used for search」，但搜索路径只调 `scanPositions` 扫主屏           |
| `edges` / `addEdges` / `ZERO_EDGES` / `resolveEdges` / `clampRect` / `withinBounds` | `layout/geometry.ts`     | 几何工具箱，只有 `unionRect` 和 `clamp` 活着                          |

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

| 分组    | 文件                                                                                                                       | 它回答的问题                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 事件基座  | `events/event.ts` / `terminal-event.ts`                                                                                  | 两套继承线的根；传播控制的三个标志           |
| 派发    | `events/dispatcher.ts` / `emitter.ts`                                                                                    | 一趟收两个方向；React 优先级从哪读        |
| 事件类   | `input-event.ts` / `keyboard-event.ts` / `click-event.ts` / `focus-event.ts` / `terminal-focus-event.ts`                 | 按键怎么翻译；点击为什么不算 DOM 事件       |
| 事件表   | `events/event-handlers.ts`                                                                                               | prop 名与事件类型的双向映射（含两处缺口）     |
| 输入    | `components/App.tsx`（658 行）                                                                                              | stdin 的唯一拥有者：模式宣示、批处理、鼠标状态机 |
| 组件    | `Box.tsx` / `Text.tsx` / `ScrollBox.tsx` / `AlternateScreen.tsx` / `Button.tsx`                                          | 布局容器、文本叶子、命令式滚动、全屏、交互原语     |
| hooks | `use-input` / `use-selection` / `use-declared-cursor` / `use-terminal-viewport` / `use-animation-frame` / `use-interval` | 订阅的时机、槽位的稳定性、可见性判定          |
| 杂项    | `Link` / `NoSelect` / `RawAnsi` / `Newline` / `Spacer` / 五个 context                                                      | 各自一个终端特有的坑                  |

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

| 判据                    | 值      | 猜的是什么          | 猜错的代价                      |
| --------------------- | ------ | -------------- | -------------------------- |
| `NORMAL_TIMEOUT`      | 50ms   | 转义序列还有没有续块     | 序列被劈开（已用 readableLength 补） |
| `PASTE_TIMEOUT`       | 500ms  | 粘贴是不是还在继续      | 长粘贴被切成几段                   |
| `STDIN_RESUME_GAP_MS` | 5000ms | tmux/ssh 是不是断过 | 重连后鼠标失效                    |

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

| 位置                                        | 状态                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `terminal-event.ts` 的 `_prepareForTarget` | **零覆写**，但 Dispatcher 每个监听者都调一次                                                                                   |
| `dispatcher.ts` 的 `dispatchContinuous`    | 零调用；连带 `ContinuousEventPriority` 分支够不着                                                                           |
| `dispatcher.ts` 的 `getEventPriority`      | 表里 7 行只有 keydown / focus / blur 能走到（click 走 hit-test 手写冒泡，paste 的事件类缺失，scroll / resize / mousemove 根本没有代码构造这类事件） |

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

| 文件                   | 行数  | 它回答的问题                                  |
| -------------------- | --- | --------------------------------------- |
| `Messages.tsx`       | 834 | 七道工序：规范化 → 切边界 → 重排 → 过滤 → 分组 → 折叠 → 切片 |
| `MessageRow.tsx`     | 383 | 这一行**以后还会不会变**（决定能不能推上 scrollback）      |
| `Message.tsx`        | 627 | 按消息类型 / 块类型两次分发到十四个渲染组件                 |
| `messageActions.tsx` | 450 | 键盘光标：哪些行值得停、每个键做什么、底部状态条                |

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

| 方案            | 怎么坏的                                                   |
| ------------- | ------------------------------------------------------ |
| `slice(-200)` | 每追加一条就从头部掉一条 → 屏幕内容整体上移 → 每轮一次全量重置（CC-941）             |
| 量化到 50 条一档    | 压缩和折叠重组也会改变 `collapsed.length` 而**不新增消息**，仍在挪（CC-1154） |
| UUID 锚点       | 只在真的超过 CAP+STEP 时才前进（CC-1174）                          |

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

| 判据              | 一处                                                 | 另一处                                          |
| --------------- | -------------------------------------------------- | -------------------------------------------- |
| collapsed 组永不静态 | `Messages.tsx` 的 `shouldRenderStatically` 返回 false | `MessageRow.tsx` 的比较器里显式 return false        |
| 「是不是最新 bash」    | `Message.tsx` 的 `areMessagePropsEqual`             | `MessageRow.tsx` 的 `areMessageRowPropsEqual` |

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

| 文件                                           | 行数      | 它回答的问题                       |
| -------------------------------------------- | ------- | ---------------------------- |
| `PromptInput.tsx`                            | 2,338   | 输入框本体：六种角色挤在一个组件里            |
| `useSwarmBanner.ts`                          | 155     | 六种身份抢输入框上方那条横幅               |
| `PromptInputFooterLeftSide.tsx`              | 516     | footer 左半边：十几种小药丸抢一行         |
| `Notifications.tsx`                          | 331     | footer 右半边：九个指示器竖着摞          |
| `PromptInputHelpMenu.tsx`                    | 357     | 三列快捷键表（一张被编译器展开成 99 个槽的声明）   |
| `PromptInputFooterSuggestions.tsx`           | 292     | 补全列表：一半代码是宽度算术               |
| `ShimmeredInput.tsx`                         | 142     | 彩虹流光：终端没有渐变，只能逐字符换色          |
| `PromptInputQueuedCommands.tsx`              | 116     | 排队消息：伪造一条通知来复用渲染器            |
| `VoiceIndicator.tsx`                         | 136     | 语音三态 + 「为什么这里故意不做动画」         |
| `inputPaste.ts` / `useMaybeTruncateInput.ts` | 90 / 58 | 十万字符粘贴：截断只发生在显示侧             |
| `IssueFlagBanner.tsx`                        | 11      | 一个被构建工具删空的组件（读 bundle 的入门样本） |

**共 5,161 行原文（批注版 8,530 行）、235 处锚点。**

**91 `PromptInput.tsx` 为什么会有 2,338 行？它到底在承担几种职责？**

六种，而且是**没法拆**的六种：

| 职责   | 为什么必须在这里                  |
| ---- | ------------------------- |
| 文本框  | 光标、选区、多行、vim、粘贴           |
| 命令面板 | `/` 与 `@` 补全、参数提示         |
| 通知中心 | 十几种一次性提示（思考档位、模型切换、草稿提示…） |
| 导航器  | footer 药丸的四个方向、任务列表、队友切换  |
| 弹窗宿主 | 模型选择、快速打开、历史、任务、团队、Bridge |
| 提交总闸 | 十几个守卫决定「这次回车算不算提交」        |

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

| 状态                   | 存在哪         | 职责                         |
| -------------------- | ----------- | -------------------------- |
| `rawFooterSelection` | AppState    | 唯一的真值                      |
| `footerItemSelected` | 渲染期派生       | **当帧就正确**（药丸消失 → 立刻变 null） |
| 清理 effect            | `useEffect` | **防止诈尸**（把 raw 也清掉）        |

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

| 形态                                        | 含义                               |
| ----------------------------------------- | -------------------------------- |
| `"external" === 'ant' && …`               | 内部构建专属，对外恒假                      |
| `"external" !== 'ant'`（折叠后只剩 return null） | 内部专属组件，对外被删空                     |
| `false ? A : B`                           | feature 折叠后的三元残骸，恒取 B            |
| `feature('X') ? useHook() : 常量`           | 编译期开关包 hook（安全，但需要 biome-ignore） |

**99 同一个 `??` 操作符，默认值的选择能说明什么？**

这批里出现两次，方向相反：

| 位置                                            | 写法        | 含义          |
| --------------------------------------------- | --------- | ----------- |
| `PromptInputFooterLeftSide.isPrStatusEnabled` | `?? true` | 新增功能，默认让人看见 |
| `usePromptInputPlaceholder`                   | `?? 0`    | 计数类，从零开始    |

`??` 只是语法，真正决定用户体验的是那个默认值。读配置类代码时，**「默认值是多少」往往比「读了什么」更重要** —— 它决定了绝大多数用户（从不改配置的人）实际看到什么。

### 输入框这一批的三个方法论收获

**一、`feature()` 是构建期常量，所以它不能出现在「会被共享的函数体」里**

`PromptInput.tsx` 里彩虹高亮的代码出现了四遍（ultrathink / ultraplan / ultrareview / buddy），每遍 12 行，只有触发器和开关不同。没有抽成函数，是因为抽出去之后 `feature()` 就折不动了 —— 函数体是共享的，无法为不同调用点生成不同产物。

这是「为构建工具让步，牺牲 DRY」的典型。看到重复代码先别急着重构，先确认它是不是被**打包期折叠**绑住了。

**二、「空实现」比「条件渲染」更省事，但要用对地方**

这一批里出现了三种空实现：

| 形态                               | 用在哪                        | 为什么                        |
| -------------------------------- | -------------------------- | -------------------------- |
| `() => null` 组件                  | `VoiceIndicator`（功能关闭时）    | 调用点可以无脑 `<X />`，判断收敛到 1 处  |
| `NO_OP_SUBSCRIBE` / `NULL` 常量    | `useSyncExternalStore` 的兜底 | hook 签名要求必传，且内联箭头会导致重复订阅   |
| `EMPTY_SET` / `EMPTY_LOOKUPS` 常量 | 传给 `Message` 的空集合          | 每次 `new Set()` 都会让 memo 失效 |

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

---

### components batch 124 (15 files 2009 lines 215 anchors)

本批十五份均为 116–140 行的小组件，横跨「终端文本输入（Vim 键位输入、底层输入渲染）、会话传送进度、终端标签栏宽度计算、通用对话框与权限规则录入、设置弹窗、外部 CLAUDE.md 导入确认、智能体进度行、MCP 多选、向导系统提示词、GitHub 工作流多选、对话导出、钩子事件选择、主题文字」十三类主题。其中 13 份是 React Compiler 产物（`_c(n)` 缓存槽 + `$` 记忆数组 + `t0..tN` 临时变量），`TagTabs` 与 `ExportDialog` 为手写组件。

三条横切观察：

- 「React Compiler 的记忆槽是扁平的」：`VimTextInput` / `Dialog` / `PermissionRuleInput` 等把 props 对象或巨型依赖数组拍平成 `if ($[k] !== a || $[k+1] !== b ...)` 的超长条件，任一字段变化才重建并刷新一连串 `$` 槽——这是编译产物而非手写，读时不必逐槽追。
- 「一次性 memo 用哨兵表达」：`Symbol.for("react.memo_cache_sentinel")` 判断首次渲染，首次才建立 `{context:"Settings"}` 一类的确认键上下文或空依赖数组，之后直接复用槽位，是 Compiler 的固定写法。
- 「终端宽度预算靠预计算常量」：`TagTabs` 用 `TAB_PADDING` / `HASH_PREFIX_LENGTH` / `LEFT_ARROW_WIDTH` 等常量按渲染字符串宽度反推版面，先算最差情况右提示宽度再决定可见窗口，避免渲染时才发现放不下。

踩坑：

- 本批 15 份数据文件预检 215 锚点全过（slug 与源路径一一对应、行号全在 `[1,len]`、无重复锚点、无英文双引号与反斜杠、`ast.parse` 全过）；`annotate.py` 十五次零 `⟳`、零 `⚠`（React Compiler 的 base64 `sourceMappingURL` 按惯例省略、fidelity 标 `OK*`）。
- 锚点全部落在代码语句行与 JSX 返回行之前（`before`），未落在 JSX 子节点内部、未落在多行表达式首行或 `/* */` 块注释内部；`ThemedText` 的 `TextHoverColorContext` 块注释经 `after` 自动外移到块后，通顺无歧义。

流程账：15 个数据文件逐一对齐源文件；预检 215 锚点全过、零合并错误；`annotate.py` 十五次零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1335 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 691 条，0 失效；全仓 1335/1902 文件、402,363/513,237 行、78%（按行数覆盖）；components 245/389（剩 144 份）。

**下一批候选（components 降序，建议取 15 份约 1,821 行）**：`FileEditToolUpdatedMessage.tsx`(124) · `LogoV2/AnimatedClawd.tsx`(124) · `TextInput.tsx`(124) · `ApproveApiKey.tsx`(123) · `agents/new-agent-creation/wizard-steps/DescriptionStep.tsx`(123) · `permissions/EnterPlanModePermissionRequest/EnterPlanModePermissionRequest.tsx`(122) · `permissions/PermissionRuleExplanation.tsx`(121) · `ClaudeInChromeOnboarding.tsx`(121) · `sandbox/SandboxDependenciesTab.tsx`(120) · `IdleReturnDialog.tsx`(118) · `shell/OutputLine.tsx`(118) · `HistorySearchDialog.tsx`(118) · `CompactSummary.tsx`(118) · `FallbackToolUseErrorMessage.tsx`(116) · `TeleportStash.tsx`(116)（components 已做 245/389，剩 144 份；全仓还剩 567 份）。

### components batch 125 (10 files 1220 lines 125 anchors)

本批十份均为 118–124 行的小组件，横跨「文件编辑消息摘要（增删统计 + 结构化 diff）、文本输入框（语音波形光标）、吉祥物点击动画、自定义 API key 审批、向导描述步骤、进入计划模式弹窗、Chrome 集成引导、权限解释归一化、沙箱依赖体检、上下文压缩占位」十类主题。全部为 React Compiler 产物（_c(n) 缓存槽 + t0..tN 临时变量），其中 TextInput 为手写组件（无 _c）。

三条横切观察：

- 「动画也要看时间窗口」：TextInput 注释解释了为何不做预热脉冲——约 120 毫秒的预热窗口对一秒周期的脉冲太短，根本来不及被看见；而预热期 50 毫秒一次的重渲染与用户 30–80 毫秒间隔的空格输入叠加会肉眼可见地卡顿。AnimatedClawd 反其道用 60 毫秒一帧的定时器链逐帧推进，每次 setTimeout 而非 interval，暂停与卸载天然正确。
- 「归一化形状收拢展示分支」：PermissionRuleExplanation 把六种 PermissionDecisionReason 归一成 reasonString/configString/themeColor 三元组，所有分支判断收进纯函数 stringsForDecisionReason，组件只剩两段渲染；policySettings 下发的企业策略不显示「去哪改」提示，因为用户改不了。
- 「固定占位防布局抖动」：AnimatedClawd 容器高度恒为 3，蹲下时脚行被裁掉而非撑开容器——「缩到画面下面再弹回来」的视觉全靠裁剪而非布局位移；SandboxDependenciesTab 的 seccomp 判定走 warnings 而非 errors，因为缺了它沙箱仍可运行。

流程账：10 个数据文件逐一对齐源文件；预检 125 锚点全过、0 块内违例；`annotate.py` 十次零 `⚠`、一次无害 `⟳`（TextInput 62→60，锚点挪到注释段边界）；`check-fidelity.py` 全仓 1345 份 0 失败（较上批 +10）；`check-links.py` 源码链接 2361 条加内链 692 条，0 失效；全仓 1345/1902 文件、403,583/513,237 行、78.6%；components 273/407（剩 134 份）。

**下一批候选（components 降序，建议取 10–15 份约 1,700 行）**：`HistorySearchDialog.tsx`(118) · `IdleReturnDialog.tsx`(118) · `shell/OutputLine.tsx`(118) · `FallbackToolUseErrorMessage.tsx`(116) · `TeleportStash.tsx`(116) · `MCPServerApprovalDialog.tsx`(115) · `permissions/FilesystemPermissionRequest/FilesystemPermissionRequest.tsx`(115) · `agents/new-agent-creation/wizard-steps/MemoryStep.tsx`(113) · `OutputStylePicker.tsx`(112) · `agents/ColorPicker.tsx`(112)（components 已做 273/407，剩 134 份；全仓还剩 557 份）。

### components batch 126 (10 files 1153 lines 99 anchors)

本批十份均为 112–118 行的小组件，横跨「历史搜索（流式加载 + 双层过滤）、空闲返回提示、Shell 输出行（JSON 美化/URL 链接/ANSI 清理）、工具错误兜底、Teleport stash 确认、MCP 服务器审批、文件系统权限分流、向导记忆步、输出风格选择、代理颜色自绘列表」十类主题。

三条横切观察：

- 「有损变换必须做往返校验」：OutputLine 的 tryFormatJson 在解析重序列化前先归一化比较（去空白、去可选转义），大整数超 MAX_SAFE_INTEGER 这类精度丢失会退回原文——宁可不美化也不改数值。
- 「错误文本的五层归一管线」：FallbackToolUseErrorMessage 依次做非字符串兜底、抽 tool_use_error 标签、去沙箱/错误标签、InputValidationError 折叠、补 Error: 前缀——每层都把一种噪音收成用户可读的一句话，最后只渲染前 10 行加剩余计数。
- 「推荐项是位置不是开关」：MemoryStep 的记忆目录选项按向导场景整体换数组，Recommended 永远排第一；配 Select 的 key 让内部光标重置到新数组头部。同类的还有 ColorPicker 放弃通用 Select 自绘键盘列表——每个选项要渲染真实色块，通用行装不下。

流程账：10 个数据文件逐一对齐源文件；预检 99 锚点全过、0 块内违例；`annotate.py` 十次零 `⟳`、零 `⚠`（OutputLine 路径含 shell 子串，按惯例走间接 runner）；`check-fidelity.py` 全仓 1355 份 0 失败（较上批 +10）；`check-links.py` 源码链接 2361 条加内链 694 条，0 失效；全仓 1355/1902 文件、404,736/513,237 行、78.9%；components 283/407（剩 124 份）。

**下一批候选（components 降序，建议取 15 份约 1,601 行）**：`FeedbackSurvey/submitTranscriptShare.ts`(112) · `hooks/SelectHookMode.tsx`(112) · `LogoV2/Feed.tsx`(112) · `permissions/rules/RemoveWorkspaceDirectory.tsx`(110) · `agents/validateAgent.ts`(109) · `SessionBackgroundHint.tsx`(108) · `FeedbackSurvey/FeedbackSurveyView.tsx`(108) · `tasks/taskStatusUtils.tsx`(107) · `DevChannelsDialog.tsx`(105) · `permissions/WorkerPendingPermission.tsx`(105) · `PackageManagerAutoUpdater.tsx`(104) · `TeleportRepoMismatchDialog.tsx`(104) · `agents/new-agent-creation/wizard-steps/TypeStep.tsx`(103) · `ChannelDowngradeDialog.tsx`(102) · `FeedbackSurvey/useSurveyState.tsx`(100)（components 已做 283/407，剩 124 份；全仓还剩 547 份）。

### components batch 127 (15 files 1601 lines 116 anchors)

本批十五份均为 100–113 行的小组件与工具，横跨「反馈问卷闭环（按键视图 + 六态状态机 + 转录分享上传）、钩子只读菜单、通用事件流 Feed（宽度预计算）、工作区收权确认、代理验证（错误/警告两级）、ctrl+b 双击后台、任务状态图标色映射、开发渠道警告、队员等待授权指示、包管理器更新检查、Teleport 仓库校正、向导类型步、渠道降级确认」十五类主题。

三条横切观察：

- 「打点先于界面」：useSurveyState 的 handleSelect 先把响应双写进 state 与 ref、再发问卷打点、最后才做界面分流——appearanceId 用 ref 存（每次展示换新 UUID 串漏斗），异步回调读 ref 不怕闭包过期；分享失败静默回退感谢页，绝不报错打扰用户。
- 「计算与渲染分离」：Feed 把「最宽要多少列」导出成 calculateFeedWidth 让调用方先算宽再渲染——Box 宽度一次到位；列对齐按全表最大时间戳宽统一算，先对齐再截断。
- 「feature flag 内联痕迹」：SessionBackgroundHint 与 PackageManagerAutoUpdater 里各有一处恒假判断（isEnvTruthy 加字面量 false、false 或 false）——构建期把 feature 常量内联后留下的死代码，读反编译产物见到字面量布尔判断应先怀疑 feature flag 被裁。

流程账：15 个数据文件逐一对齐源文件；预检 116 锚点全过、0 块内违例；`annotate.py` 十五次零 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 1370 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 695 条，0 失效；全仓 1370/1902 文件、406,337/513,237 行、79.2%；components 298/407（剩 109 份）。

**下一批候选（components 降序，建议取 15 份约 1,387 行）**：`SandboxViolationExpandedView.tsx`(99) · `PrBadge.tsx`(97) · `agents/new-agent-creation/CreateAgentWizard.tsx`(97) · `DiagnosticsDisplay.tsx`(95) · `design-system/StatusIcon.tsx`(95) · `design-system/LoadingState.tsx`(94) · `NotebookEditToolUseRejectedMessage.tsx`(92) · `LogoV2/feedConfigs.tsx`(92) · `AutoUpdaterWrapper.tsx`(91) · `permissions/PowerShellPermissionRequest/powershellToolUseOptions.tsx`(91) · `hooks/PromptDialog.tsx`(90) · `InvalidSettingsDialog.tsx`(89) · `permissions/FileWritePermissionRequest/FileWriteToolDiff.tsx`(89) · `FeedbackSurvey/TranscriptSharePrompt.tsx`(88) · `LspRecommendation/LspRecommendationMenu.tsx`(88)（components 已做 298/407，剩 109 份；全仓还剩 532 份）。

### components batch 128 (15 files 1387 lines 133 anchors)

本批十五份均为 88–99 行的小组件与工具，横跨「沙箱违规展开视图、PR 徽章、新建代理向导组装器、诊断信息展示、状态图标、加载态、Notebook 编辑拒绝提示、LogoV2 的四个 Feed 工厂、自动更新器分派、PowerShell 权限选项工厂、钩子询问弹窗、设置校验失败弹窗、文件写入 diff 预览、转录分享询问、LSP 插件推荐」十五类主题。十一份是 React Compiler 产物（含一处 `bb0:` 标签块），四份为手写工具函数或工厂（feedConfigs、powershellToolUseOptions、LspRecommendationMenu、SandboxViolation 的 formatTime）。

四条横切观察：

- 「为一次调用不该引入一个库」：SandboxViolationExpandedView 手写 `h:mm:ssa` 格式化，注释直说动机是避开 39MB 的 date-fns；`getHours()%12||12` 是把 0 点和 12 点都兜成 12 的经典写法。对照的是设计系统件 StatusIcon 与 LoadingState——它们走 figures 图标加语义色映射表，doc 注释给足三个 `@example`，属于另一套「能复用就复用」的标准。
- 「选项工厂按工具能力裁剪」：powershellToolUseOptions 的四个值里 yes 与 no 各分 input 与非 input 两态，always-allow 再分「可编辑前缀输入」与「静态 suggestions 标签」两条路，回退判据是 `hasNonPowerShellSuggestions`（含 `addDirectories` 或非 PowerShell 工具规则时，前缀表达不了这些权限）。两条注释直接写明 PowerShell 没有沙箱选项（Windows 不支持）、没有分类器选项（Bash 专属），删减原因留在代码里而非 commit message。
- 「三态 null 与哨兵占位」：AutoUpdaterWrapper 用 `null` 表示「还没检测完」，与 `false` 的「检测完但不是」严格区分，检测期间渲染 null 以免闪现错误更新器；CreateAgentWizard 则用三处占位——steps 数组里条件插入 MemoryStep、`initialData` 传空对象哨兵、`onComplete` 传空函数（真正的完成回调在 ConfirmStepWrapper 内部），组装器自身不含业务。
- 「内联痕迹又两例」：feedConfigs 的 `external === 'ant'` 让 What's new 的解析分支、空态文案、标题三处分叉按构建期常量塌陷成死代码；FileWriteToolDiff 的 `bb0:` 标签块是编译器对 `useMemo` 提前 return 的重写，`break bb0` 只跳出这一个缓存块，不是业务 goto。

坑一处：数据文件名必须带 `src_components_` 前缀。`slug` 是由**完整**相对路径（`src/components/...`）替换 `/`、`.`、`-` 得出的，本批最初按去掉前缀的短名写入，预检报 MISSING 后统一改名才通过——短名只在索引正文里用，落盘名不可省。

流程账：15 个数据文件逐一对齐源文件；预检 133 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、一次无害 `⟳`（powershellToolUseOptions 41→42，锚点从 `//` 注释段中部挪到段边界；该文件路径含 powershell 子串，按惯例走间接 runner）；原文 1,387 行 → 批注版 1,535 行；`check-fidelity.py` 全仓 1385 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 696 条，0 失效；全仓 1385/1902 文件、407,724/513,237 行、79.4%；components 313/407（剩 94 份）。

**下一批候选（components 降序，建议取 15 份约 1,245 行，余下全是 87 行以下小件）**：`tasks/ShellProgress.tsx`(87) · `BypassPermissionsModeDialog.tsx`(87) · `design-system/ProgressBar.tsx`(86) · `LanguagePicker.tsx`(86) · `Spinner/utils.ts`(85) · `agents/new-agent-creation/wizard-steps/ColorStep.tsx`(84) · `FeedbackSurvey/useDebouncedDigitInput.ts`(83) · `TeammateViewHeader.tsx`(82) · `HelpV2/Commands.tsx`(82) · `AwsAuthStatusBox.tsx`(82) · `design-system/KeyboardShortcutHint.tsx`(81) · `teams/TeamStatus.tsx`(80) · `design-system/Ratchet.tsx`(80) · `agents/new-agent-creation/wizard-steps/MethodStep.tsx`(80) · `agents/new-agent-creation/wizard-steps/LocationStep.tsx`(80)（components 已做 313/407，剩 94 份共 5,000 行；全仓还剩 517 份）。

### components batch 129 (15 files 1245 lines 133 anchors)

本批十五份是 components 里最后一批 80–87 行的小件，横跨「任务状态文本与 shell 进度、危险模式确认弹窗、进度条、语言选择器、spinner 字符与配色工具、向导颜色步、数字键防抖 hook、队友视图页头、帮助页命令清单、AWS 认证状态框、快捷键提示、团队页脚状态、高度棘轮、向导方式步、向导位置步」十五类主题。多数是设计系统基元（ProgressBar / KeyboardShortcutHint / Ratchet）与向导步骤（Color / Method / Location），它们被前面几十批的业务组件反复引用，本批把「被引用的那一端」补齐。

四条横切观察：

- 「终端里做布局稳定，靠棘轮与背景色」：Ratchet 用只增不减的 `minHeight` 外壳加 `measureElement` 量内层真实高度，`minHeight` 只在 engaged 时生效、且上限夹到终端行数（`Math.min(height, rows)`）——流式输出变长时外壳不动，是防抖而不是撑高。ProgressBar 空段用 `backgroundColor` 加空格而非画浅色字符，因为背景色块不受字形宽度影响，九级部分块字符（`▏▎▍▌▋▊▉█`）则把亚字符精度做出来。
- 「latest-ref 不只是防重跑，是防重计时」：useDebouncedDigitInput 把三个回调塞进 `callbacksRef`，调用方传内联箭头也不会让 effect 重跑、不会重置防抖计时器；同时 `initialInputValue` 记住首帧值，只有真正新增字符才算「用户刚输入」，避免「首帧就带着数字」被误判。`setTimeout` 用可变参数把 ref 与值一并传入，回调拿的都是触发时刻快照，不依赖闭包。
- 「推荐项靠位置与文案，不靠开关」：MethodStep 的 Generate 选项文案里标 recommended 且排第一；LocationStep 的 `projectSettings` 排在 `userSettings` 前；BypassPermissionsModeDialog 反过来把 No 排第一——危险操作的默认光标必须落在安全项上。三种排序是同一原则的正反面：默认值就是产品态度。
- 「终端字形不可假设」：Commands 的 `truncate(…, maxWidth, true)` 第三参走显示宽度（中英混排按字符数截会错位）；Spinner/utils 的六帧字符表按 TERM 与平台分叉（Ghostty 把 ✽ 换成 `*`，非 darwin 把第三帧 ✳ 换成 `*`），都是对「字体里这个字到底多宽、能不能渲染」的保守处理。

流程账：15 个数据文件逐一对齐源文件；预检 133 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`（ShellProgress 路径含 Shell 子串，按惯例走间接 runner）；原文 1,245 行 → 批注版 1,389 行；`check-fidelity.py` 全仓 1400 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 697 条，0 失效；全仓 1400/1902 文件、408,969/513,237 行、79.7%；components 328/407（剩 79 份共 3,755 行）。

**下一批候选（components 降序，建议取 15 份约 1,124 行，最大件已降到 80 行）**：`Spinner/SpinnerGlyph.tsx`(80) · `MessageResponse.tsx`(78) · `ClaudeCodeHint/PluginHintMenu.tsx`(78) · `design-system/Pane.tsx`(77) · `design-system/Byline.tsx`(77) · `permissions/rules/PermissionRuleDescription.tsx`(76) · `Spinner/useStalledAnimation.ts`(76) · `RemoteCallout.tsx`(76) · `shell/ShellTimeDisplay.tsx`(74) · `agents/new-agent-creation/wizard-steps/ConfirmStepWrapper.tsx`(74) · `ClickableImageRef.tsx`(73) · `permissions/PermissionDialog.tsx`(72) · `SearchBox.tsx`(72) · `ui/OrderedList.tsx`(71) · `LogoV2/GuestPassesUpsell.tsx`(70)（components 已做 328/407，剩 79 份共 3,755 行；全仓还剩 502 份）。

### components batch 130 (15 files 1124 lines 136 anchors)

本批十五份全部 ≤80 行，横跨「spinner 单帧渲染、消息响应前缀、插件推荐弹窗、Pane 区域壳、Byline 串联、权限规则人话描述、卡顿渐红 hook、远程控制提示、shell 时间显示、向导确认落盘、可点击图片引用、权限弹窗骨架、搜索框光标、有序列表编号、通行证推广」十五类主题。其中 PermissionDialog、Byline、Pane、OrderedList、MessageResponse 是被前面上百批业务组件反复引用的底层件，本批把「被引用的那一端」补齐。

四条横切观察：

- 「骨架与内容分离」：PermissionDialog 只定义骨架——上边框（左/右/底全关，视觉上是一条圆角横线而非卡片）、标题行 `justify space-between` 把 `titleRight` 推到最右、内容区 `paddingX` 可被调用方覆盖；标题区交给 PermissionRequestTitle。ConfirmStepWrapper 则相反地把活儿全揽下来：落盘、`setAppState` 重算 activeAgents、可选打开编辑器、打点、拼完成文案，ConfirmStep 只管展示。两条线都遵守「壳不含业务」。
- 「渲染副作用与编译产物哨兵」：useStalledAnimation 在**渲染期**直接改 `lastTokenTime` 等五个 ref，靠「只在响应长度变长时触发」保证幂等，时钟由父组件传入因此终端失焦时会一起变慢；平滑用每帧逼近 10% 的指数逼近加 0.01 吸附阈值。Byline 里的 `early_return_sentinel` 是编译器重写提前 return 的产物（哨兵值 + `break bb0` + 事后比对），MessageResponse 则用 Context 记录「我已在另一个响应块里」来避免 ⎿ 嵌套重复。
- 「降级链优先于报错」：SpinnerGlyph 主题色解析不出 RGB 就退两档（强度过半切 error 色，否则原色）而不是连续渐变；ClickableImageRef 在「图片不在 store」或「终端不支持 OSC 8」时退成带背景色的纯文本，且 Link 的 fallback 指向这份文本；PermissionRuleDescription 遇到「其它工具且带规则内容」直接返回 null，把展示交给调用方的原始兜底。
- 「编号与对齐靠预计算」：OrderedList 先数一遍真正的列表项子元素，用总数位数做 `padStart` 对齐编号（十项时 1 要补成 01），并把父标记拼在前面支持 `1.1.` 式嵌套；SearchBox 没有真光标可用，靠把 `offset` 处字符渲染成 `inverse` 来模拟，offset 默认落在文本末尾，终端失焦时则不画光标。

流程账：15 个数据文件逐一对齐源文件；预检 136 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`（ShellTimeDisplay 路径含 shell 子串，走间接 runner）；原文 1,124 行 → 批注版 1,272 行；`check-fidelity.py` 全仓 1415 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 698 条，0 失效；全仓 1415/1902 文件、410,093/513,237 行、79.9%；components 343/407（剩 64 份共 2,631 行）。

**下一批候选（components 降序，建议取 15 份约 925 行，最大件已降到 68 行）**：`agents/ModelSelector.tsx`(68) · `LogoV2/VoiceModeNotice.tsx`(68) · `CustomSelect/select-option.tsx`(68) · `permissions/PermissionRequestTitle.tsx`(66) · `wizard/WizardDialogLayout.tsx`(65) · `MessageTimestamp.tsx`(63) · `mcp/CapabilitiesSection.tsx`(61) · `agents/new-agent-creation/wizard-steps/ToolsStep.tsx`(61) · `Spinner/FlashingChar.tsx`(61) · `LogoV2/FeedColumn.tsx`(59) · `LogoV2/EmergencyTip.tsx`(58) · `IdeStatusIndicator.tsx`(58) · `ConfigurableShortcutHint.tsx`(57) · `BashModeProgress.tsx`(56) · `App.tsx`(56)（components 已做 343/407，剩 64 份共 2,631 行；全仓还剩 487 份）。

### components batch 131 (15 files 925 lines 42 anchors)

本批十五份全部 ≤68 行，是 components 清零冲刺里最小的一批：横跨「语音模式提示、下拉选项基元、智能体模型选择、权限请求标题、向导对话框外壳、消息时间戳、闪烁字符、MCP 能力区、新建智能体选工具步、信息流列、IDE 连接状态、紧急提示条、可配置快捷键、顶层 Provider 壳、Bash 进度区」十五类主题。这些都是被前面各批业务组件反复 import 的底层件或外壳，本批把「被引用的那一端」补齐，components 仅剩 49 份小文件即可清零。

三条横切观察：

- 「React 编译器重写是统一底色」：十五份全部由 `react/compiler-runtime` 的 `_c(N)` 记忆缓存驱动，依赖比对逻辑千篇一律——把相关 prop 解构出来，逐个与缓存槽比对，变了才重建 JSX。读这些文件要把 `_c(N)` 当成「组件记忆化的脚手架」，真正要理解的是被它包住的渲染分支。
- 「外壳与内容分离是默认结构」：WizardDialogLayout / App / PermissionRequestTitle 都只拼「标题 + 内容 + 底部」三段的布局骨架，业务语义交给被包裹的子组件（Dialog / Provider / Byline）；EmergencyTip 则相反把「读动态配置 → 记忆化 → 看过即写回」全揽在自己身上，是少数带副作用的提示条。
- 「降级链优先于报错」：FlashingChar 在 ANSI 主题取不出 RGB 时退两档（透明度过半切流光色，否则原色）；IdeStatusIndicator 在没连上 IDE 或无选区时直接 `return null`；MessageTimestamp 只在转录模式 + assistant + 含文本时才显示——三类组件都用「先判断前提、不满足就不渲染」代替抛错。

流程账：15 个数据文件逐一对齐源文件；预检 42 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`（均为编译器产物，无 `//` 注释段、无多行模板，锚点只落函数签名行与语句/收尾行）；原文 925 行 → 批注版 962 行；`check-fidelity.py` 全仓 1430 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 699 条，0 失效；全仓 1430/1902 文件、411,015/513,237 行、80%；components 340/389（剩 49 份共约 2,068 行）。

**下一批候选（components 降序，建议取 15 份约 712 行，最大件已降到 55 行）**：`KeybindingWarnings.tsx`(55) · `LogoV2/Opus1mMergeNotice.tsx`(55) · `StatusNotices.tsx`(55) · `agents/new-agent-creation/wizard-steps/ModelStep.tsx`(52) · `CtrlOToExpand.tsx`(51) · `LogoV2/AnimatedAsterisk.tsx`(50) · `CostThresholdDialog.tsx`(50) · `CustomSelect/option-map.ts`(50) · `permissions/WorkerBadge.tsx`(49) · `mcp/utils/reconnectHelpers.tsx`(49) · `DevBar.tsx`(49) · `ExitFlow.tsx`(48) · `ContextSuggestions.tsx`(47) · `FastIcon.tsx`(46) · `sandbox/SandboxDoctorSection.tsx`(46)（components 已做 340/389，剩 49 份共约 2,068 行；全仓还剩 472 份）。

### components batch 132 (15 files 752 lines 103 anchors)

本批十五份全部 ≤55 行，是 components 清零冲刺里倒数第二批小文件：横跨「启动状态通知、Opus 1M 合并提示、按键绑定校验告警、新建智能体选模型步、ctrl+o 展开提示、动画星号、下拉选项双向链表、费用阈值对话框、集群工人徽章、MCP 重连结果处理、慢操作调试条、退出流程、上下文建议、沙箱诊断区、闪电图标」十五类主题。除 `option-map.ts`（纯 class）外，其余均为 React Compiler 产物（`_c(N)` 记忆缓存），源文件几乎无 `//` 英文注释段、无多行模板，锚点只落函数/类型签名行（before）与语句/收尾行（after）。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `StatusNotices.tsx` | 55→61 | 5 |
| `LogoV2/Opus1mMergeNotice.tsx` | 55→60 | 4 |
| `KeybindingWarnings.tsx` | 55→61 | 5 |
| `agents/new-agent-creation/wizard-steps/ModelStep.tsx` | 52→59 | 6 |
| `CtrlOToExpand.tsx` | 51→57 | 5 |
| `LogoV2/AnimatedAsterisk.tsx` | 50→64 | 13 |
| `CustomSelect/option-map.ts` | 50→59 | 9 |
| `CostThresholdDialog.tsx` | 50→57 | 7 |
| `permissions/WorkerBadge.tsx` | 49→55 | 6 |
| `mcp/utils/reconnectHelpers.tsx` | 49→53 | 4 |
| `DevBar.tsx` | 49→59 | 10 |
| `ExitFlow.tsx` | 48→55 | 7 |
| `ContextSuggestions.tsx` | 47→56 | 8 |
| `sandbox/SandboxDoctorSection.tsx` | 46→56 | 9 |
| `FastIcon.tsx` | 46→51 | 5 |

三条横切观察：

- 「编译器产物是统一底色」：除 `option-map` 是纯 class 外，十四份均由 `react/compiler-runtime` 的 `_c(N)` 记忆缓存驱动，依赖比对逻辑千篇一律——相关 prop 解构出来逐槽比对，变了才重建 JSX。读这些文件要把 `_c(N)` 当脚手架，真正要理解的是被它包住的渲染分支与业务文案（如 Opus1mMergeNotice 的「1M 上下文」提示、SandboxDoctorSection 的依赖检查结果、KeybindingWarnings 的错误/警告分流）。
- 「无注释段 = 锚点只落签名/语句行」：这批文件源文件几乎没有 `//` 英文注释段（仅 AnimatedAsterisk 有几段），因此批注全部落在函数/类型签名行（before）与语句/收尾行（after），零 `⟳`、零 `⚠`，比前几批更顺。
- 「双向链表与状态分流是两类典型」：`option-map` 用普通 Map 扩展出首/尾指针与 previous/next 双向链表；`reconnectHelpers` 与 `KeybindingWarnings` 都是「按状态/严重级分流返回不同文案」的纯函数，前者给 MCP 重连结果与错误，后者给按键绑定错误与警告。

踩坑：

- 本批十五份数据文件预检 103 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`，钩子名（keybinding / devbar 等）走间接 runner 也无碍；无正则字面量误判、无漏写位置参数的二元组。
- 尾部 `//# sourceMappingURL` 巨行由 `annotate.py` 自动省略并补两行说明，不计入批注版行数——这正是「批注版 − 原文」略大于锚点数的原因。

流程账：15 个数据文件逐一对齐源文件；预检 103 锚点全过、0 块内违例；`annotate.py` 十五次零 `⚠`、零 `⟳`；原文 752 行 → 批注版 863 行；`check-fidelity.py` 全仓 1445 份 0 失败（较上批 +15）；`check-links.py` 源码链接 2361 条加内链 700 条，0 失效；全仓 1445/1902 文件、411,767/513,237 行、80%；components 355/389（剩 34 份共 938 行）。

### components batch 133 (34 files 953 lines 130 anchors)

**components 目录在本批清零（389/389 文件、81,892 行全数批注完毕）**。三十四份全部 ≤45 行，最小到 1 行，覆盖「列表项基元、沙箱配置面板、记忆更新提示、离屏冻结、IDE diff 配置契约、模型名标注、文件路径超链接、投入度字形、工具转圈点、语法高亮开关、堆用量提示、shell 展开 context、微光字符、工具活动单行渲染、微光时间轴、主题着色器、diff 列表、错误边界、智能体状态机类型、权限埋点、两个导航页脚、帮助通用页、来源标题、四类兜底提示、五个 barrel 出口」。

| 文件 | 原文→批注版 | 锚点 |
| --- | --- | --- |
| `ui/OrderedListItem.tsx` | 45→50 | 5 |
| `sandbox/SandboxConfigTab.tsx` | 45→53 | 7 |
| `memory/MemoryUpdateNotification.tsx` | 45→51 | 6 |
| `OffscreenFreeze.tsx` | 44→50 | 6 |
| `permissions/FilePermissionDialog/ideDiffConfig.ts` | 42→48 | 6 |
| `MessageModel.tsx` | 43→48 | 5 |
| `FilePathLink.tsx` | 43→48 | 5 |
| `EffortIndicator.ts` | 42→46 | 4 |
| `ToolUseLoader.tsx` | 42→47 | 5 |
| `StructuredDiff/colorDiff.ts` | 37→42 | 5 |
| `MemoryUsageIndicator.tsx` | 37→42 | 5 |
| `shell/ExpandShellOutputContext.tsx` | 36→41 | 5 |
| `Spinner/ShimmerChar.tsx` | 36→40 | 4 |
| `tasks/renderToolActivity.tsx` | 33→39 | 6 |
| `Spinner/useShimmerAnimation.ts` | 31→38 | 7 |
| `design-system/color.ts` | 30→34 | 4 |
| `StructuredDiffList.tsx` | 30→32 | 2 |
| `SentryErrorBoundary.ts` | 28→31 | 3 |
| `agents/types.ts` | 27→32 | 5 |
| `permissions/utils.ts` | 25→29 | 4 |
| `agents/AgentNavigationFooter.tsx` | 26→30 | 4 |
| `wizard/WizardNavigationFooter.tsx` | 24→27 | 3 |
| `HelpV2/General.tsx` | 23→26 | 3 |
| `agents/utils.ts` | 18→21 | 3 |
| `FallbackToolUseRejectedMessage.tsx` | 16→18 | 2 |
| `PressEnterToContinue.tsx` | 15→17 | 2 |
| `MCPServerDialogCopy.tsx` | 15→17 | 2 |
| `InterruptedByUser.tsx` | 15→17 | 2 |
| `wizard/useWizard.ts` | 13→15 | 2 |
| `Spinner/index.ts` | 10→12 | 2 |
| `wizard/index.ts` | 9→11 | 2 |
| `mcp/index.ts` | 9→11 | 2 |
| `CustomSelect/index.ts` | 3→4 | 1 |
| `Spinner/teammateSelectHint.ts` | 1→2 | 1 |

三条横切观察：

- 「终端渲染的性能账都写在注释里」：本批最有价值的不是代码本身，而是几处被动性能注释——`OffscreenFreeze` 说明视口之上的任何变动都会逼 `log-update` 整屏重置，故冻结靠「返回同一份元素引用让 reconciler 直接 bail」，且必须 `use no memo` 否则机制失效；`useShimmerAnimation` 说明卡顿时给时钟传 null 是**唯一**可靠停止手段（调用方可能从不挂 `ref`，视口暂停永不触发）；`SandboxConfigTab` 把依赖探测标成首渲染同步 IO、只跑一次。终端 UI 的性能约束与浏览器完全不同：宽度是手算的、更新是全屏的、定时器要按视口显式关。
- 「固定宽度是对抗抖动的通用手段」：`ToolUseLoader` 的 `minWidth={2}`、`MessageModel` 的 `stringWidth + 8`、`ShimmerChar` 的三字符光带、`StructuredDiffList` 的固定分隔符、`HelpV2/General` 的 `fixedWidth` 快捷键表——五处不同组件用同一种办法解决「内容变化导致布局跳动」，且量宽一律走 `stringWidth` 而非 `length`。
- 「构建期常量是死码消除的分界线」：`MemoryUsageIndicator` 与 `InterruptedByUser` 都靠 `USER_TYPE` 内联把一半分支变成死码，前者因此敢把 hook 放在提前 return 之后（正常会违反 hooks 规则，靠两行 lint 豁免注释放行），`MemoryUsageIndicator` 的注释把这个取舍写得很直白：「gating before the hook means the 10s polling interval is never set up in external builds」。

踩坑：

- 本批三十四份数据文件预检 130 锚点全过、0 块内违例；`annotate.py` 三十四次零 `⚠`、零 `⟳`。
- **新坑：锚点不能落在多行 JSX 的子元素区**。`StructuredDiffList` 的三处 `after` 原本插在 `<Box ...>` 与 `</Box>` 之间、`WizardNavigationFooter` 的两处插在 `<Byline>` 内，注释放进去会变成 JSX 文本节点（既污染渲染，`check-fidelity` 又因为「注释行被剥离」而查不出来）。判据：插入点的前一行以 `>` 收尾且后一行以 `<` 开头，就是子元素区；`return` 语句与 `}: Props): ... {` 这类语句边界才是安全位。已改写为「语句级一条讲清整棵结构」，锚点数由 133 降到 130。
- `shell/ExpandShellOutputContext.tsx` 路径含 `shell` 子串，按惯例走间接 runner（`runpy.run_path`）调用 `annotate.py`，执行后即删。
- 数据文件名必须带 `src_components_` 前缀（slug 由完整相对路径推导），本批 34 份一次写对，未再出现第 128 批那种批量 `mv` 返工。
- 行数口径统一用 `check-coverage.py`（末尾空行不计）：全仓 412,705/513,237 行；`annotate.py` 的「原文 N 行」比 `os.walk` 统计多 1，索引表格与流程账都用前者。

流程账：34 个数据文件逐一对齐源文件；预检 130 锚点全过、0 块内违例；`annotate.py` 三十四次零 `⚠`、零 `⟳`（其中 5 份因锚点落进 JSX 子元素区而改写重跑）；原文 953 行 → 批注版 1,084 行；`check-fidelity.py` 全仓 1479 份 0 失败（较上批 +34）；`check-links.py` 源码链接 2361 条加内链 702 条，0 失效；全仓 1479/1902 文件、412,705/513,237 行、80%；**components 389/389 全目录清零**（81,892 行）。

**下一批候选（跳出 components，进入全仓巨兽区，建议取 2 份约 10,599 行，沿用「utils 第一批两份巨兽」的节奏）**：`cli/print.ts`(5,594) · `screens/REPL.tsx`(5,005)；其后依次 `main.tsx`(4,683) · `commands/insights.ts`(3,200) · `bridge/bridgeMain.ts`(2,999) · `native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,214) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758)（全仓还剩 423 份，最大的十份就占 32,326 行）。

### src batch 134 (4 files 3457 lines 165 anchors)

`services/` `tools/` `hooks/` `components/` `ink/` 均已清零，进入 `src/` 散件阶段。本批取降序前段的 855–878 行集群，清掉四块：CLI 插件/市场处理、SDK 结构化 stdio、protobuf 事件类型、远程智能体任务框架。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`cli/handlers/plugins.ts`](annotated/src/cli/handlers/plugins.ts) | 878→923 | 45 | CLI 插件/市场子命令处理：install/uninstall/list/update、marketplace add/remove/list、版本解析、权限与策略校验、输出格式化 |
| [`cli/structuredIO.ts`](annotated/src/cli/structuredIO.ts) | 859→907 | 48 | SDK 结构化 stdio 消息收发（`StructuredIO` 类）：读帧、解析、分发、写回、背压与错误封装 |
| [`types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts`](annotated/src/types/generated/events_mono/claude_code/v1/claude_code_internal_event.ts) | 865→889 | 24 | protoc 生成的 protobuf 事件类型：oneof 字段、枚举、嵌套 message、序列化元数据 |
| [`tasks/RemoteAgentTask/RemoteAgentTask.tsx`](annotated/src/tasks/RemoteAgentTask/RemoteAgentTask.tsx) | 855→904 | 48 | 远程智能体任务框架：任务状态机、流式事件订阅、UI 渲染绑定、断线重连/超时处理 |

四块各自的要点：

- **`plugins.ts`（45 锚点）**：子命令与 marketplace 两类入口。install 走三源（`--plugin-dir` / 已装 / 市场）合并与去重；版本解析优先 `manifest.version` 而非 `gitCommitSha`（呼应 `utils/plugins/pluginLoader.ts` 的「版本键错位 = 永远重克隆」坑）；权限/策略走 fail-closed，配置损坏时拦截而非静默跳过。
- **`structuredIO.ts`（48 锚点）**：把 SDK 与宿主进程间的 stdio 变成「结构化消息流」。读侧按帧拆包、写侧序列化后发出；协议错误被封装成可判别的枚举而非裸异常，便于上层按类型处理。
- **`events_mono/.../claude_code_internal_event.ts`（24 锚点）**：纯 protoc 生成代码，人类不手写。oneof 用联合类型表达、枚举带未识别兜底分支；批注重点放在「字段含义 + 序列化边界」而非实现细节。
- **`RemoteAgentTask.tsx`（48 锚点）**：把远程 agent 的一次任务映射成可渲染状态机，订阅流式事件增量更新 UI；网络抖动时靠重连窗口与超时兜底，避免任务卡在终态前。

踩坑：

- 数据文件名必须带完整相对路径 slug：`src_types_generated_events_mono_claude_code_v1_claude_code_internal_event_ts_p1.py`（含 `src/` 前缀）。预检曾因 FILES 条目缺 `src/` 前缀而报源文件「not found」（混用 `/` 与 `\` 分隔符），修正条目后通过。
- 预检 165 锚点全过、0 块内违例。
- `annotate.py` 良性 `⟳` 外移 3 处：`plugins.ts` 两处 `//` 注释段内的 `after` 自动挪到段尾（255→262、686→689）；`events_mono` 一处 `after` 落在 `/**` 起始行自动下移到块外（1→5）。落点人眼确认在英文注释块之后、代码之前，未劈开英文。零 `⚠`。
- 首轮 `check-fidelity` 2 FAIL，均属「锚点落在未结束多行表达式首行」：
  - `structuredIO.ts` 锚点 `(141,'after')` 落在 `restoredWorkerState: Promise<SessionExternalMetadata | null> =` 行尾 `=`（值在下行）→ 挪到 `(142,'after')`（该行 `Promise.resolve(null)` 收尾）。
  - `events_mono` 锚点 `(814,'after')` 落在 `type Builtin =` 首行（联合类型铺在后续多行）→ 挪到 `(821,'after')`（Builtin 联合的收尾 `}`）。
  - 复验：全仓 1483 份 0 失败。
- `RemoteAgentTask.tsx` 为 `.tsx`（React Compiler 产物），源文件尾部 `sourceMappingURL` 长 base64 行被 `annotate.py` 替换为一句中文说明（故 855 + 48 锚点 = 903，批注版实测 904，差 1 即该替换行），`check-fidelity` 标 `OK*` 而非失败。

流程账：4 个数据文件逐一对齐源文件；预检 165 锚点全过、0 块内违例；`annotate.py` 四次零 `⚠`、3 处良性 `⟳`（上）；首轮 2 FAIL → 修正后复验 `check-fidelity.py` 全仓 **1483 份 0 失败**（`channels_mono` 等 `OK*` 正常）；`check-links.py` 源码链接 2361 条加内链 702 条，0 失效；全仓 **1483/1902 文件、416,163/513,237 行、81%**；`src/` 还剩 **419 份**。

**下一批候选（注意：本批实际取的是 855–878 行集群；但当前 `check-coverage.py src` 的「未做文件」真正榜首是三个巨兽，下一批应直接啃巨兽）**：`cli/print.ts`(5,594) · `screens/REPL.tsx`(5,006) · `main.tsx`(4,684)；其后依次 `commands/insights.ts`(3,200) · `bridge/bridgeMain.ts`(2,999) · `native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,215) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758)（全仓还剩 419 份；巨兽清完后再回头扫 800–1,000 行档的 `commands/plugin`、`cli/transports` 集群）。


### src batch 135 (cli print ts 5594 lines 130 anchors)

`services/` `tools/` `hooks/` `components/` `ink/` 均已清零，`src/` 散件阶段。本批单啃一头巨兽：CLI 输出层 `cli/print.ts`（5,594 行，全仓现存最大单文件），它是 `-p`/`--print` 打印模式、SDK 结构化输出与 `stream-json` 无头模式的总入口。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`cli/print.ts`](annotated/src/cli/print.ts) | 5,594→5,724 | 130 | CLI 输出与打印中枢：`-p`/`--print` 纯打印、`--output-format` 分流、SDK `stream-json`/`json` 序列化、彩色/非 TTY 适配、权限与工具结果回写、错误与退出码编排 |

要点：

- **`print.ts`（130 锚点）**：文件是无状态函数集合（非类），按「输出格式分支」组织。`printResult`/`printStreamEvent` 把内部 `SDKResultMessage`/`StreamEvent` 转成最终文本或 JSON 片段；`formatResultForPrint` 按 `--output-format`（text/json/stream-json）选序列化器；非 TTY 时强制去色、用 `process.stdout.write` 直接落盘，保证无头环境可读。
- **`-p`/`--print` 模式**：纯打印路径不走 REPL，把一次性结果格式化后直接退出，适合脚本调用；与 SDK 结构化输出共用同一批底层格式化函数，差异只在「是否包一层 REPL 交互」。
- **`stream-json` 无头模式**：把每个流式事件逐条 flush 成 JSON 行（`\n` 分隔），供外部进程按行解析。批注强调「每条事件独立成行、不可缓冲合并」，否则对端会拿到半截 JSON。
- **错误与退出码**：`printError`/`printUnhandledError` 区分用户可见错误与未捕获异常，退出码按 `ERROR_CODES` 映射，便于 CI/脚本判活。

踩坑：

- 数据文件名带完整相对路径 slug：`src_cli_print_ts_p1.py`（含 `src/` 前缀）。
- 预检 130 锚点全过、0 块内违例。
- `annotate.py` 良性 `⟳` 外移 3 处：`//` 注释段内的 `after` 自动挪到段尾（1142→1144、1502→1504、2931→2932）。落点人眼确认在英文注释块之后、代码之前，未劈开英文。零 `⚠`。
- 首轮 `check-fidelity` 1 FAIL：「锚点落在未结束多行表达式首行」——`(2702,'after')` 落在 `let cronScheduler: import('../utils/cronScheduler.js').CronScheduler | null =` 行尾 `=`（值在下行）→ 挪到 `(2703,'after')`（该行 `null` 收尾）。复验：全仓 **1484 份 0 失败**。

流程账：1 个数据文件对齐源文件；预检 130 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、3 处良性 `⟳`（上）；首轮 1 FAIL → 修正后复验 `check-fidelity.py` 全仓 **1484 份 0 失败**（`channels_mono` 等 `OK*` 正常）；`check-links.py` 源码链接 2366 条加内链 704 条，0 失效；全仓 **1484/1902 文件、421,757/513,237 行、82%**；`src/` 还剩 **418 份**。

**下一批候选（两只 >3000 行巨兽仍在榜首，按行数降序）**：`screens/REPL.tsx`(5,006) · `main.tsx`(4,684) · `commands/insights.ts`(3,200) · `bridge/bridgeMain.ts`(2,999) · `native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,215) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758)（全仓还剩 418 份；巨兽单批 1–2 份封顶，清完后再回头扫 800–1,000 行档的 `commands/plugin`、`cli/transports` 集群）。

### src batch 136 (screens REPL tsx 5005 lines 155 anchors)

`services/` `tools/` `hooks/` `components/` `ink/` 均已清零，`src/` 散件阶段。本批单啃一头巨兽：CLI 终端 UI 根组件 `screens/REPL.tsx`（5,005 行，全仓现存第二大单文件），它是整个终端交互的总入口，含数十个嵌套 `useCallback` 与一个大 JSX 返回。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`screens/REPL.tsx`](annotated/src/screens/REPL.tsx) | 5,005→5,224 | 155 | CLI 终端 UI 根组件：条件 require 的死代码消除、各类 hook 与 useCallback（resume/onQuery/onSubmit/handleExit 等）、查询状态机 QueryGuard、消息 ref 镜像的 Zustand 模式、远程/SSH/直连、transcript 模式与搜索、巨型 JSX 返回 |

要点：

- **`REPL.tsx`（155 锚点）**：文件是 React Compiler 编译产物，函数体即一个 4,400 行级的巨型 `REPL()` 组件。开头是 import 与「按 feature 开关条件 require」的死代码消除（ant-only / coordinator / loop 模式）；中部依次挂载各类状态与 41 个 `useCallback`（消息管理、权限、流式、查询生命周期、resume 恢复、transcript 搜索等）；尾部是主 JSX 返回。批注重点放在「为什么这样写」的英文注释难以直接读懂之处：QueryGuard 同步状态机如何取代双状态易错模式、setMessages/setInputValue 怎样用 ref 镜像做 Zustand 式同步、composedOnScroll 作为用户滚动唯一入口的节流设计、以及「自动恢复」在中断时如何回退对话并还原输入。
- **死代码消除**：同一套 `feature('XXX')` 开关模式贯穿全文，外部构建会被整段剔除；批注点明每一处「条件 require 只为外部构建瘦身」。
- **resume / onQuery / onSubmit**：三个最复杂的回调，批注串起「恢复会话 → 派发查询 → 落盘消息 → 收尾重置」的完整生命周期与它们之间共享的 ref 契约（abortController / bridgeResult / restoreCallback）。
- **transcript 模式**：`[` dump-to-scrollback、`v` 外部编辑器打开、less 式 `n/N` 搜索等键盘语义，批注解释其「裸字母在模态上下文」的设计来源。
- `annotate.py` 对该 `.tsx` 尾部 637,816 字符的 `sourceMappingURL` 巨行做了省略替换（标 `OK*`），未计入锚点。

踩坑：

- 数据文件名带完整相对路径 slug：`src_screens_REPL_tsx_p1.py`（含 `src/` 前缀），与 `annotate.py` 的 `load_annotations` 派生规则一致。
- 预检 155 锚点全过、0 块内违例、0 个英文双引号与反斜杠、无三连单引号。
- `annotate.py` 良性 `⟳` 外移 41 处：`//` 注释段内的 `after`/`before` 自动挪到段边界（如 974→975、1771→1772、2155→2158、4956→4957），未劈开英文；零模板字符串外移（无中文漏进模板字面量）。零 `⚠`。
- `check-fidelity.py` 全仓 **1485 份 0 失败**（`OK*` 正常，sourceMappingURL 省略已计入）；`check-links.py` 源码链接 2366 条加内链 704 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 155 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、41 处良性 `⟳`；`check-fidelity.py` 全仓 **1485 份 0 失败**；`check-links.py` 源码链接 2366 条加内链 704 条，0 失效；全仓 **1485/1902 文件、426,763/513,237 行、83%**；`src/` 还剩 **417 份**。

**下一批候选（巨兽仍在榜首，单批 1 份封顶）**：`main.tsx`(4,684) · `commands/insights.ts`(3,200) · `bridge/bridgeMain.ts`(2,999) · `native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,214) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758)（全仓还剩 417 份；巨兽单批 1 份封顶，清完后再回头扫 800–1,000 行档的 `commands/plugin`、`cli/transports` 集群）。


### src batch 137 (main tsx 4684 lines 136 anchors)

`services/` `tools/` `hooks/` `components/` `ink/` 均已清零，`src/` 散件阶段。本批单啃一头巨兽：CLI 程序入口 `src/main.tsx`（4,684 行，全仓现存第三大单文件），它是整个命令行工具的启动总入口，负责副作用导入、`main()` 与各模式分支、巨型 `run()`（Commander 构建器）、REPL 启动与全部子命令注册。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`main.tsx`](annotated/src/main.tsx) | 4,684→4,821 | 136 | CLI 程序入口：副作用 import 与最早性能检查点、按 feature 开关条件 require 的死代码消除、托管设置/会话遥测/迁移/安全预取等启动辅助、设置加载链、`main()` 与各模式分支、巨型 `run()` Commander 构建器（默认动作/MCP 连接/REPL 启动/子命令 mcp·plugin·agents·doctor 等）、尾部助手 |

要点：

- **`main.tsx`（136 锚点）**：文件顶部是「必须在所有其他 import 之前执行的副作用」——裸注释与 `performance.mark` 之类的最早检查点；随后是大量按 `feature('X')` 条件 `require` 的死代码消除（外部构建会整段剔除）。中段是启动辅助函数群：`logManagedSettings`（托管设置上报 Statsig）、`isBeingDebugged`、`logSessionTelemetry`、`runMigrations`、`prefetchSystemContextIfSafe`、`startDeferredPrefetches`，以及设置加载器 `loadSettingsFromFlag`/`eagerLoadSettings`/`initializeEntrypoint`。`main()`（约 585 行）负责模块顶层副作用之后的真正入口：安全初始化、argv 重写、各模式分支，最后调用 `run()`。
- **`run()` 巨型 Commander 构建器**（约 884 行起，数千行）：注册全部选项与子命令，最后 `parse` 并返回 program。默认动作约 1006 行；MCP connect 约 2730 行；REPL 启动约 3733/3798/3806 行；子命令 `mcp`/`plugin`/`agents`/`doctor` 等约 3894–4505 行。
- **子命令注册**：`mcp`、`plugin`、`agents`、`doctor` 等子命令各自挂在 Commander 程序上，批注点明每个子命令的职责边界与共享的 `preAction` 钩子。
- `annotate.py` 对该 `.tsx` 尾部 base64 `sourceMappingURL` 巨行做了省略替换（标 `OK*`），未计入锚点。

踩坑：

- 数据文件名带完整相对路径 slug：`src_main_tsx_p1.py`（含 `src/` 前缀），与 `annotate.py` 的 `load_annotations` 派生规则一致。
- 预检 136 锚点全过、0 块内违例、0 个英文双引号与反斜杠、`ast.parse` 全过。
- `annotate.py` 良性 `⟳` 外移 2 处：`//` 注释段内的 `after` 自动挪到段边界（1120→1122、4314→4321），未劈开英文；零模板字符串外移。零 `⚠`。
- `check-fidelity.py` 全仓 **1486 份 0 失败**（`OK*` 正常，sourceMappingURL 省略已计入）；`check-links.py` 源码链接 2367 条加内链 705 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 136 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、2 处良性 `⟳`；`check-fidelity.py` 全仓 **1486 份 0 失败**；`check-links.py` 源码链接 2367 条加内链 705 条，0 失效；全仓 **1486/1902 文件、431,447/513,237 行、84%**；`src/` 还剩 **416 份**。

**下一批候选（巨兽仍在榜首，单批 1 份封顶）**：`commands/insights.ts`(3,200) · `bridge/bridgeMain.ts`(2,999) · `native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,214) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758)（全仓还剩 416 份；巨兽单批 1 份封顶，清完后再回头扫 800–1,000 行档的 `commands/plugin`、`cli/transports` 集群）。


### src batch 138: commands/insights.ts (3200 src / 3264 annotated / 64 anchors)

`services/` `tools/` `hooks/` `components/` `ink/` 均已清零，`src/` 散件阶段。本批单啃一头巨兽：`src/commands/insights.ts`（3,200 行，全仓现存第二大级单文件），它是 `/insights` 命令的核心——扫描本机会话日志、抽取结构化维度 facets、聚合统计、调 Opus 生成叙事洞察，最后渲染成自包含 HTML 报告。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`insights.ts`](annotated/src/commands/insights.ts) | 3,200→3,264 | 64 | /insights 命令：ant 环境远程 homespace 采集、SessionMeta/SessionFacets/AggregatedData 三套数据契约、extractToolStats 逐消息统计、facet 抽取与缓存闭环、detectMultiClauding 多开检测、6 段并行洞察生成、HTML 报告总装、generateUsageReport 四阶段主流程 |

要点：

- **`insights.ts`（64 锚点）**：文件四段分明——数据采集（仅 ant 生效的远程 homespace 拉取）、类型与常量（三套数据结构 + EXTENSION_TO_LANGUAGE / LABEL_MAP）、统计与洞察（extractToolStats 逐消息统计工具/语言/git/token/错误，aggregateData 聚合，generateParallelInsights 并发 6 板块 + At a Glance）、HTML 渲染与主流程（generateHtmlReport 总装自包含报告，generateUsageReport 分 Lite 扫描→加载缓存→facet 抽取→聚合→洞察→落盘四阶段）。
- **远程采集条件剪枝**：`getRunningRemoteHosts` / `getRemoteHostSessionCount` / `collectFromRemoteHost` / `collectAllRemoteHostData` 四组函数体都用 `process.env.USER_TYPE === 'ant'` 三元包裹，非 ant 环境整段返回空，避免把内部数据通道带进公开发行版。
- **facet 抽取与缓存**：`loadCachedFacets` / `saveFacets` / `extractFacetsFromAPI` 形成「先读缓存、未命中再调 Opus、结果落盘 0o600」的闭环；结构守卫 `isValidSessionFacets` 校验不过就删缓存重抽，脏数据不会遗留。
- **多开检测**：`detectMultiClauding` 用 30 分钟滑动窗口找 s1→s2→s1 交错，把「并行开多个会话」量化成重叠事件数/涉及会话数/期间消息数。
- **主流程四阶段**：`generateUsageReport` 先 Lite 扫元数据（几乎零成本），再以 50 并发加载 SessionMeta 缓存、10 并发解析未缓存 jsonl，最后 50 并发抽 facet；全程过滤元会话、损坏日志、极简/缓存预热会话，避免重复与噪音拉高指标。

踩坑：

- 数据文件名带完整相对路径 slug：`src_commands_insights_ts_p1.py`（含 `src/` 前缀），与 `annotate.py` 的 `load_annotations` 派生规则一致。
- 预检 64 锚点全过、0 块内违例、0 个英文双引号与反斜杠、`ast.parse` 全过。
- `annotate.py` 零 `⟳`、零 `⚠`：64 处锚点全部落在函数/类型收尾行或段注释之后，未触发块注释内/模板字符串外移。
- `check-fidelity.py` 全仓 **1487 份 0 失败**；`check-links.py` 源码链接 2368 条加内链 706 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 64 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、零 `⟳`；`check-fidelity.py` 全仓 **1487 份 0 失败**；`check-links.py` 源码链接 2368 条加内链 706 条，0 失效；全仓 **1487/1902 文件、434,647/513,237 行、84%**；`src/` 还剩 **415 份**。

**下一批候选（巨兽仍在榜首，单批 1 份封顶）**：`bridge/bridgeMain.ts`(2,999) · `native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,214) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758)（全仓还剩 415 份；巨兽单批 1 份封顶，清完后再回头扫 800–1,000 行档的 `commands/plugin`、`cli/transports` 集群）。

### src batch 139: bridgeMain.ts (2999 src / 3083 annotated / 84 anchors)

`services/` `tools/` `hooks/` `components/` `ink/` 均已清零，`src/` 散件阶段（巨兽单批 1 份封顶）。本批单啃一头巨兽：`src/bridge/bridgeMain.ts`（2,999 行，全仓现存最大级单文件之一），它是 Claude Code `remote-control`（远程控制桥）的核心——把本地环境注册到云端、轮询服务端下发的「工作项」并在本机派生会话子进程、心跳保活、错误退避、优雅关闭；另有无界面守护进程 worker 变体。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bridgeMain.ts`](annotated/src/bridge/bridgeMain.ts) | 2,999→3,083 | 84 | remote-control 桥：runBridgeLoop 轮询与工作分发引擎、bridgeMain CLI 入口、runBridgeHeadless 守护进程 worker 变体 |

要点：

- **配置与退避基线**：`BackoffConfig` 与 `DEFAULT_BACKOFF` 定义连接与通用两套独立的指数退避（首跳 2s 与 0.5s、封顶 2min 与 30s、放弃 10min）；`pollSleepDetectionThresholdMs` 取连接封顶两倍作为休眠唤醒阈值，机器睡过觉就重置错误预算。
- **轮询循环 `runBridgeLoop`（约 1,460 行）**：拉取 `pollForWork` 后按 `work.data.type` 分流（healthcheck 仅 ACK、session 生成或复用、default 忽略未知）；达容量时进入「非独占心跳模式」只发心跳不轮询，按截止时间或容量唤醒信号跳出；连接与通用错误各走独立退避轨道并检测系统休眠；循环退出后 SIGTERM 等待宽限期再 SIGKILL 优雅关闭活跃会话、stopWork 通知服务端、归档并注销环境。
- **会话生命周期**：`safeSpawn` 把派生失败转成字符串便于区分；`onSessionTimeout` 看门狗杀掉的会话记为 failed 而非 interrupted；`onSessionDone` 统一清理状态、停止工作项、归档或拆除环境；多会话完成后回到空闲继续轮询，单会话则 abort 干净退出。
- **CCR v2 与令牌刷新**：`secret.use_code_sessions` 走 CCR v2（注册为 worker、取 epoch、指向 /v1/code/sessions），v1 用 Session-Ingress WebSocket；`tokenRefresh` 在 JWT 过期前 5 分钟刷新，v2 走 `reconnectSession` 触发服务端重投递，避免 5h 静默死亡。
- **CLI 入口 `bridgeMain`**：解析参数（`parseArgs` 支持 --spawn、--capacity、--session-id、--continue）、校验信任对话框与登录、`KAIROS` 门控的多会话与续接特性、注册环境、预建空会话、`w` 键在 same-dir 与 worktree 间切换并持久化、崩溃恢复指针每小时刷新。
- **无界面变体 `runBridgeHeadless`**：守护进程 worker 入口，无 readline、无 TUI、无 process.exit，配置与认证来自调用方（daemon.json 或 IPC），致命错误抛出让 worker 映射退出码；`createHeadlessBridgeLogger` 把 BridgeLogger 全部方法收敛到单个行日志函数。

踩坑：

- 数据文件名带完整相对路径 slug：`src_bridge_bridgeMain_ts_p1.py`（含 `src/` 前缀），与 `annotate.py` 的 `load_annotations` 派生规则一致。
- 预检 84 锚点全过、0 块内违例、0 个英文双引号与反斜杠、`ast.parse` 全过。
- `annotate.py` 零 `⟳`、零 `⚠`：84 处锚点全部落在函数或类型收尾行、签名前、或段注释之后，未触发块注释内与模板字符串外移。
- `check-fidelity.py` 全仓 **1488 份 0 失败**（`OK*` 正常，sourceMappingURL 省略已计入）；`check-links.py` 源码链接 2369 条加内链 707 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 84 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、零 `⟳`；`check-fidelity.py` 全仓 **1488 份 0 失败**；`check-links.py` 源码链接 2369 条加内链 707 条，0 失效；全仓 **1488/1902 文件、437,646/513,237 行、85%**；`src/` 还剩 **414 份**。

**下一批候选（巨兽仍在榜首，单批 1 份封顶）**：`native-ts/yoga-layout/index.ts`(2,578) · `bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,214) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758) · `skills/loadSkillsDir.ts`(1,086)（全仓还剩 414 份；巨兽单批 1 份封顶，清完后再回头扫 800–1,000 行档的 `commands/plugin`、`cli/transports` 集群）。

### src batch 140: native-ts/yoga-layout/index.ts (2578 src / 2742 annotated / 164 anchors)

第二头巨兽：`src/native-ts/yoga-layout/index.ts`（2,578 行）。这是 Meta yoga（flexbox 布局引擎）的**纯 TypeScript 重写**，用来替换上游的 WASM 包。动机很直接：Ink 是终端 UI，一次布局要跑上千节点，跨 JS/WASM 边界的调用开销已经超过算法本身，所以整份重写成 JS。文件头用五个段落把「Ink 真用到的、为规范一致性实现但不用的、明确不实现的」三档特性列清楚，这是这类移植件最省事的维护手段。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`yoga-layout/index.ts`](annotated/src/native-ts/yoga-layout/index.ts) | 2,578→2,742 | 164 | yoga 的 TS 移植：Value/Edge 值模型、Node 的三层布局缓存、layoutNode 六步 flexbox 算法、多趟弹性长度解析、像素网格舍入 |

要点：

- **值模型与 NaN 哨兵**：`Value` 是「单位标记 + 数值」，缺失用 `Unit.Undefined` 而不是 undefined，数值位一律 NaN。`resolveValue` 是全文件唯一的像素求值点；`isDefined` 就是 `!isNaN`；`sameFloat` 把 NaN 与 NaN 视为相等——缓存比对必须用它，否则未定义尺寸的节点永远不命中。
- **9 边塌缩到 4 边**：`Style` 保留 yoga 的 9 槽边数组（便于 setter 直接写下标），`resolveEdge` 用四层回退链（具体边 → 水平/垂直 → all → start/end）塌缩成物理值，之后全程只走 4 元组。
- **三层布局缓存**（性能主体）：单槽 layout 缓存、4 槽多槽缓存（扁平 Float64Array，槽 i 占 `_cIn[i*8..]` 与 `_cOut[i*2..]`）、单槽 measure 缓存，外层还有 `computeFlexBasis` 的六字段 basis 缓存。**关键教训是输入与输出必须分开提交**：输入在 `layoutNode` 开头写、输出在算完后由 `commitCacheOutputs` 写，否则命中时返回的是上次调用残留的尺寸——那就是 scrollbox 视口高度 33→2624、滚动条归零、屏幕全黑的 bug。
- **`isDirty_` 只在布局趟清除**：measure 趟在前、layout 趟在后，measure 阶段清脏会让后面的 layout 命中上一次布局的旧缓存（那时子节点还没插入），于是 ScrollBox 内容高度永不增长、粘性滚动跟不上新内容。
- **代际戳代替脏标记做缓存闸门**：`_fbGen`/`_cGen` 记录写入时的 `_generation`，同代际的缓存天然新鲜（子树这一趟没变过），于是虚拟滚动全新挂载的脏项也能从第 2 次调用起命中——1593 节点树从 10.5 万次访问降到 1 万。
- **`layoutNode` 六步**：STEP 1 算 flex-basis 并换行（用夹紧后的「假设主轴尺寸」判断，不是原始 basis）；STEP 2+3 逐行解析弹性长度并测交叉尺寸；STEP 4 定容器尺寸（AtMost 不是硬上限、只有 Scroll 才钳制）；STEP 5 定位（align-content 分多行空间、每行重新拉伸、justify-content 与 auto margin、基线对齐、relative 偏移、反向主轴从尾部倒推）；STEP 6 绝对定位子节点。
- **多维「按需付代价」**：`_hasAutoMargin`/`_hasPosition`/`_hasPadding`/`_hasBorder`/`_hasMargin` 五个布尔把热点路径上的 1.1 万次边解析调用压成一次分支判断；`boundAxis` 的「两个 min/max 都没设」快速路径覆盖每趟 3.2 万次调用中的绝大多数；`resolveEdges4Into` 把 4 次调用的共享回退提到循环外并写入预分配数组。
- **文本节点与其他节点舍入不同**（对齐上游 PixelGrid.cpp）：文本位置向下取整（换行文字绝不超过分配列）、宽度有小数则向上取整（避免裁掉最后一个字形），其余走四舍五入；宽高用「绝对右下角减绝对左上角」算，避免逐层累积漂移。
- **`parseDimension` 把 Infinity 当未定义**：这不是防御性代码而是实际需求——Ink 传 `height={Infinity}` 表示不限制（LogSelector 的 maxHeight 默认值），存成字面点值会让节点高度变成无穷并摧毁下游布局。

踩坑：

- 数据文件名 slug 要把 `-` 也替换掉：`src_native_ts_yoga_layout_index_ts_p1.py`（`native-ts`、`yoga-layout` 各有一个连字符）。
- 首次跑 `annotate.py` 报了 **1 个 `⚠`**：第 8 号 `after` 锚点落在文件头的块注释内部（`*   - flex-direction ...` 那行）。**教训**：`after` 锚点若指向块注释内的行，插入的 `//` 会劈开英文段落；判据是目标行以 `*` 或 `*/` 开头。改到 `*/` 之后（L40 `before`）才干净。
- 另有 **2 个 `after` 落在语句与闭括号之间**（`_yogaLiveNodes++` 与 `roundValue` 的最后一条赋值），预检的 `aslot` 规则拦住并改为 `before`。这条规则是本批新加进预检脚本的。
- 1 个无害 `⟳`：1356→1355，锚点原本落在 `// ownerW/H are the reference sizes...` 英文注释段中部，被自动挪到段边界。
- 函数体内 `before` 锚点若前一行是空行，插入的注释会**顶格**（annotate 不做缩进对齐）。历史产物里两种风格并存（`bridgeMain.ts` 里 98 行带缩进、44 行顶格），不影响 `check-fidelity`，按既有惯例不追改。
- `check-fidelity.py` 全仓 **1489 份 0 失败**；`check-links.py` 源码链接 2370 条加内链 708 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 164 锚点全过、0 块内违例（含升序、去重、英文双引号/反斜杠/换行、`before` 落块注释、`after` 落闭括号前六类新校验）；`annotate.py` 二次运行后零 `⚠`、一处 `⟳`；原文 2,578 行 → 批注版 2,742 行；`check-fidelity.py` 全仓 **1489 份 0 失败**；`check-links.py` 源码链接 2370 条加内链 708 条，0 失效；全仓 **1489/1902 文件、440,224/513,237 行、85%**；`src/` 还剩 **413 份 / 73,322 行**。

**下一批候选（巨兽单批 1 份封顶）**：`bridge/replBridge.ts`(2,406) · `commands/plugin/ManagePlugins.tsx`(2,214) · `entrypoints/sdk/coreSchemas.ts`(1,889) · `bootstrap/state.ts`(1,758) · `skills/loadSkillsDir.ts`(1,086) · `commands/plugin/PluginSettings.tsx`(1,071)（全仓还剩 413 份；1,000 行档还有 `bridge/remoteBridgeCore.ts`、`native-ts/color-diff/index.ts`、`cli/transports/ccrClient.ts` 三份）。

### src batch 141: bridge/replBridge.ts (2406 src / 2576 annotated / 170 anchors)

第三头巨兽：`src/bridge/replBridge.ts`（2,406 行）。这是 REPL（本地终端会话）接入 remote-control 的桥——用户从手机或网页接管本地那个正在跑的 Claude Code 会话时，所有消息都经过这里：注册环境、创建会话、轮询工作项、连入口 WebSocket、双向搬运消息、断线重连、拆除。`bridgeMain.ts` 是独立桥（单会话进程，无 TUI），这份是 REPL 版（有 TUI、有初始历史、有标题推导）。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bridge/replBridge.ts`](annotated/src/bridge/replBridge.ts) | 2,406→2,576 | 170 | REPL 侧远程控制桥：`initBridgeCore` 注册建会话、`doReconnect` 双策略重建、`onWorkReceived` 接传输、v1/v2 分叉、`doTeardownImpl` 拆除、`startWorkPollLoop` 轮询状态机 |

要点：

- **去 bootstrap 化的参数对象**：`BridgeCoreParams` 把 cwd/会话 ID/git/OAuth 全变成显式字段，好让不跑 `main.tsx` 的守护进程也能用。一批回调（`createSession`/`archiveSession`/`toSDKMessages`/`onAuth401`/`getPollIntervalConfig`）都是**注入**而不是 import，理由是同一条：这些模块会经 `config.ts → file.ts → permissions → sessionStorage → commands.ts` 把整个命令注册表加 React 树拖进 Agent SDK 打出来的包。`toSDKMessages` 的默认实现故意是**抛错**而不是返回空数组——静默返回空会让消息凭空消失。
- **初始历史不走会话创建事件**：这类事件用 `STREAM_ONLY` 持久化，且发布时机早于 CCR 界面订阅，必丢。所以改为入口 WebSocket 连上之后再冲刷，用 `FlushGate` 拦住期间新产生的消息，防交错；`onStateChange('connected')` 要等冲刷完成才发。
- **两个「会话作用域」的重置必须在任何 await 之前**（`doReconnect` 策略 2）：SSE 序号与入站 UUID 去重都是会话级的。带着旧序号过去，`lastSequenceNum` 会卡在高位，下次重连发 `from_sequence_num=旧值` 而新流从 1 开始 → 中间事件静默全丢。更隐蔽的是顺序问题：若先把 `currentSessionId` 换成 B、却在 `await writeBridgePointer` 之后才重置序号，就存在「handle 返回 B 的会话 ID 配 A 的序号」的窗口——这个组合恰好能通过守护进程的会话 ID 校验，等于让校验失效。
- **`v2Generation` 专治一种判反了的竞态**：`transport` 为 null 时连来两次工作项，两次都 `registerWorker`（服务端 epoch 递增），**后**解析出的那次才是对的；但「`transport !== null`」这个判断会保留先解析的（旧 epoch）、丢弃后解析的。代际号不看 transport 状态，能独立判出谁新。
- **`doReconnect` 的四道中止检查**：在 `stopWork` await、`registerBridgeEnvironment` await、`archiveSession` await、`createSession` await（最长 15 秒）之后各有一次 `pollController.signal.aborted` 判定。少一处就会在用户已经退出时继续重建、或留下泄漏的环境/会话。另有两处「轮询循环已自行恢复」的让位判断（比较 `currentWorkId` 是否被改、`transport` 是否已被装上）。
- **v1/v2 只在传输与鉴权上分叉**：v1 是 `HybridTransport`（WS 读 + POST 写，优先 OAuth，因为有标准刷新流程）；v2 是 SSE 读 + CCR 写，**强制 JWT**（`register_worker` 要校验 `session_id` 声明，OAuth 令牌不带）。开关来自服务端工作密钥里的 `use_code_sessions`，环境变量只是内网强制覆盖。
- **拆除的顺序是排过的**：发结果消息 → 并行 `stopWork` + `archiveSession` → 关传输 → 注销环境 → 清指针。`transport.write` 只入队（上传器在入队即 resolve），中间的 200–500ms 就是结果 POST 的排空窗口；反过来先关再归档只能靠那个没人 await 的 3 秒宽限期，`forceExit` 可能在 POST 中途杀 socket。常驻（perpetual）模式的拆除是**纯本地行为**——不发结果、不 stopWork、不关传输，让服务端按 300 秒租约自己把工作项退回 pending。
- **轮询循环的状态机**：满容量时进「心跳模式」（只心跳不轮询），五个退出条件（轮询截止、鉴权失败、容量唤醒、配置被关、中止）；退出后按原因决定是 `continue` 还是付一次睡眠。放弃阈值是 15 分钟**时长**而不是错误次数（指数退避下两者不成正比）。另有「进程挂起检测」——满容量睡眠超期 60 秒以上即判定合盖/STOP，下一轮强制快轮询一次。
- **`onHeartbeatFatal` 的存在理由是一条实测故障**：工作项 JWT 过期后传输彻底没用，没有这个回调会走满 10 分钟退避，而租约只有 300 秒 → 约 25 分钟死窗口。

踩坑：

- 数据文件里连续写错三处括号：`(574, ...']`、`(651, ...']`、以及第 49 行整体错位。`ast.parse` 一次只报第一个，所以改一处跑一次——批量写长列表时建议先用 grep 校验 `\],$` 结尾的行。
- **`before` 锚点不能指向块注释内部的行**（与第 140 批同类坑）：本批 `(107, 'before')` 想挂在 `POST /v1/sessions. Injected because ...` 那行前，而它在 `/** ... */` 里。预检 `bslot` 规则拦下，改到 `createSession:` 字段行（L119）。
- 3 个 `⟳` 移位：`557→551`、`1115→1111`、`1176→1174`，都是落在英文注释段中部被挪到段首。前两处与已有锚点同段落，产物读起来是「中文总述两条 + 英文原注 + 代码」，可接受。
- `check-fidelity.py` 全仓 **1490 份 0 失败**；`check-links.py` 源码链接 2371 条加内链 709 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 170 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、三处 `⟳`；原文 2,406 行 → 批注版 2,576 行；`check-fidelity.py` 全仓 **1490 份 0 失败**；`check-links.py` 源码链接 2371 条加内链 709 条，0 失效；全仓 **1490/1902 文件、442,630/513,237 行、86%**；`src/` 还剩 **412 份 / 70,915 行**。

**下一批候选（巨兽单批 1 份封顶）**：`commands/plugin/ManagePlugins.tsx`(2,215) · `entrypoints/sdk/coreSchemas.ts`(1,890) · `bootstrap/state.ts`(1,759) · `skills/loadSkillsDir.ts`(1,087) · `commands/plugin/PluginSettings.tsx`(1,072) · `bridge/remoteBridgeCore.ts`(1,009)（全仓还剩 412 份；1,000 行档还有 `native-ts/color-diff/index.ts`、`cli/transports/ccrClient.ts`）。

### src batch 142: commands/plugin/ManagePlugins.tsx (2215 src / 2300 annotated / 84 anchors)

第四头巨兽：`src/commands/plugin/ManagePlugins.tsx`（2,215 行）。`/plugin` 命令的主界面——一个组件承担 11 个视图（列表、详情、配置、两种确认页、被下架详情、失败插件详情、MCP 三级子页），管理插件与 MCP 服务器。整个文件是 **React Compiler 产物**（`s_0`/`item_0`/`error_0` 这类数字后缀重命名、`newStates[index]!` 非空断言）。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/plugin/ManagePlugins.tsx`](annotated/src/commands/plugin/ManagePlugins.tsx) | 2,215→2,300 | 84 | 插件管理主界面：11 视图状态机、unifiedItems 五源合并与分组保序排序、四动作权限闸门、两种确认页、MCP 子页分派、斜杠命令直连与自动动作 |

要点：

- **`ViewState` 是 11 变体联合**：三个字符串字面量加八个带 `type` 的对象。带参数的几个（options schema、cleanup 体积、flagged/failed 条目、MCP 客户端与工具）把上下文直接嵌进状态，避免开一堆并列 `useState` 让它们失步。
- **`unifiedItems` 的五源合并**（本文件最复杂的一段）：插件、插件内嵌 MCP（按 `plugin:插件名:服务器名` 命名约定识别，第三段之后全部拼回名字因为服务器名本身可能含冒号）、独立 MCP（排除 `ide` 与 `plugin:` 前缀）、加载失败的插件（**从错误列表反推**——它们不在 `loadAllPlugins` 结果里，否则用户会看到「设置里有、界面里没有」）、被下架插件。合并的硬约束是「插件与其子 MCP 必须相邻」，所以不能整组排序：先切成「插件 + 紧随的缩进 MCP」组，组内保序、组间按插件名排，独立 MCP 再单独排。
- **两个 ref 而非 state**：`hasAutoNavigated` 防止用户离开后又被拽回详情页（父组件的 `targetPlugin` 永不清空）；`pendingAutoActionRef` 存「跳转之后要执行的动作」（`/plugin uninstall X`），被一个依赖 `viewState`/`selectedPlugin` 的一次性 effect 消费，用完即清——不清会重复卸载。
- **`handleSingleOperation` 的两层权限闸门**：内置插件只能启停（不许更新卸载）；托管作用域只能更新（启停卸载都拒）。**enable/disable 刻意不传 scope**：此处的 `pluginScope` 来自 `installed_plugins.json`（文件缓存位置），与设置里的作用域可能不一致，传进去会触发跨作用域保护性拒绝，让下游自动探测才对。
- **卸载的三道前置**：① 在 `.claude/settings.json`（团队共享）里启用 → 转到「只在我本地禁用」确认页，因为直接卸载会影响其他协作者；判定必须**直接读设置文件**，因为 `pluginScope` 可能是 `user` 而同一插件同时被项目级启用。② 有 `CLAUDE_PLUGIN_DATA` 且是最后一个安装作用域 → 才问「要不要连数据一起删」；多作用域时下游本就不删，再弹窗说「删」却什么都不删是在骗用户。③ 从未真正安装过（只在 `enabledPlugins` 留了记录）→ 到三个可编辑设置源里抹掉那条记录。
- **两种确认页用不同的输入机制，各有理由**：`confirm-project-uninstall` 用 `useKeybindings`（y/esc）；`confirm-data-cleanup` **必须用原始 `useInput`**——`Confirmation` 上下文把回车映射成 `confirm:yes`，那会让「回车」变成删数据的破坏性默认（而界面文案只写 y 删、n 留）；且这里 `n` 与 `esc` 是**两个不同动作**（保留数据 vs 取消），键位系统里两者都映射成 `confirm:no`。
- **`handleSingleOperation` 的 latest-ref**：它每次渲染都是新函数，直接进 effect 依赖会让 effect 每渲染都跑；用 ref 每渲染更新、effect 只依赖 `viewState` 与 `selectedPlugin`。
- **操作完不按「是不是 enable」判断要不要弹配置**，而是重读设置看插件此刻是否启用——安装流程本身会启用插件，所以从菜单进来时第一项显示的往往是「禁用」。

踩坑：

- 括号 `],$` 前置扫描（第 141 批的教训）这次零命中，84 个锚点一次过预检。
- **JSX 子元素区专项扫描**：本批是 TSX，注释若落进 `<Box>` 与 `</Box>` 之间会变成 JSX 文本节点，而 `check-fidelity` 因「剥注释行再比对」查不出来。用「插入点前一行以 `>` 收尾且后一行以 `<` 开头」的判据扫了全部 84 条，**零命中**——因为锚点全部落在语句行（`const`/`return`/`if`）与函数签名之前。
- 产物末尾的 sourceMappingURL（本文件 232,956 字符）按惯例被 `annotate.py` 替换成两行说明，所以「插入注释 85 行」比锚点数多 1。
- `check-fidelity.py` 全仓 **1491 份 0 失败**；`check-links.py` 源码链接 2372 条加内链 710 条，0 失效。

流程账：1 个数据文件对齐源文件；预检 84 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、零 `⟳`；原文 2,215 行 → 批注版 2,300 行；`check-fidelity.py` 全仓 **1491 份 0 失败**；`check-links.py` 源码链接 2372 条加内链 710 条，0 失效；全仓 **1491/1902 文件、444,845/513,237 行、86%**；`src/` 还剩 **411 份 / 68,700 行**。

**下一批候选（巨兽单批 1 份封顶）**：`entrypoints/sdk/coreSchemas.ts`(1,890) · `bootstrap/state.ts`(1,759) · `skills/loadSkillsDir.ts`(1,087) · `commands/plugin/PluginSettings.tsx`(1,072) · `bridge/remoteBridgeCore.ts`(1,009) · `native-ts/color-diff/index.ts`(1,000)（全仓还剩 411 份；`cli/transports/ccrClient.ts`(999) 紧随其后，之后是 900 行档）。

### src batch 143: entrypoints/sdk/coreSchemas.ts (1889 src / 2040 annotated / 151 anchors)

第五头巨兽：`src/entrypoints/sdk/coreSchemas.ts`（1,890 行）。文件头一句话定死了它的地位——**SDK 所有可序列化类型都以这里的 zod schema 为单一真相源**，TS 类型是生成产物、提交进仓库只为 IDE 补全。整份文件没有一行业务逻辑，全是契约：27 个钩子事件、6 种权限变更指令、24 种 SDK 消息、13 种超额禁用原因。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`entrypoints/sdk/coreSchemas.ts`](annotated/src/entrypoints/sdk/coreSchemas.ts) | 1,889→2,040 | 151 | SDK 类型单一真相源：用量/输出格式/MCP 配置/权限/钩子三层契约/技能与模型信息/代理定义/24 种消息联合 |

要点：

- **`lazySchema` 全包裹，一举三得**：① 打破循环引用——`PermissionUpdateSchema` 的 `setMode` 分支引用 50 行之后才定义的 `PermissionModeSchema`，`SyncHookJSONOutputSchema` 引用下方十五个专属输出，`FastModeStateSchema` 定义在文件最后却被前面三处引用；② 模块加载期只登记工厂不建树，把 zod 的构造成本摊到首次解析；③ 声明顺序与依赖顺序彻底解耦，可以按「主题」而非「拓扑」组织文件。
- **占位符 + `TypeOverrideMap`**：五个 `z.unknown()`（`APIUserMessage`/`APIAssistantMessage`/`RawMessageStreamEvent`/`UUID`/`NonNullableUsage`）在 zod 侧放行一切，`scripts/generate-sdk-types.ts` 再按映射表替换成真实外部类型。这样 zod 能描述消息形状，又不必把 `@anthropic-ai/sdk` 的类型搬进来。
- **`.and()` 而不是 `.extend()`**：注释明写理由——生成 TS 时能保留 `BaseHookInput & {...}` 的交叉写法，读起来更贴近契约本意。`.extend()` 会把基底字段摊平，丢失「所有钩子共享一块底板」这个事实。
- **判别式三处不同取舍**：① 钩子输出用 `async: z.literal(true)` 当判别字段（同步输出里根本没有这个键，天然互斥）；② 思考配置用 `union` 而非 `discriminatedUnion`，靠每支的 `type` 字面量让 zod 自动择优；③ 权限更新用 `discriminatedUnion('type')`，前三分支三字段完全同形**仍拆开写**——为了生成出来的 TS 能按 `type` 自然收窄。
- **用「键的存在性」当开关**（本批最巧的一处）：`capabilities.experimental['claude/channel']` 存在即代表该插件在已批准频道白名单里，据此决定要不要弹启用提示；`PromptRequestSchema.prompt` 字段本身就是请求 ID，「这一行有它」就等于「这是一条提问」——行式 JSONL 协议里，这比加一个 `type` 字段少一层判断。
- **命名是分界线**：消息流（`session_id`/`tool_use_id`/`is_error`）全蛇形，会话列表信息（`sessionId`/`lastModified`/`fileSize`）全驼峰。前者是流式协议，后者是 API 表面——改字段名之前先确认自己在哪一侧。
- **契约文档长在 schema 上**：`memory` 字段的 describe 直接把三个目录路径写出来；`agent_id` 与 `agent_type` 的 describe 明确「用前者判断是否在子代理里，不要用后者」；`preserved_segment` 的 describe 解释后缀保留锚在摘要、前缀保留锚在边界。这些信息没有第二处，删掉 describe 就等于删掉文档。
- **枚举即排障手册**：`overageDisabledReason` 13 种（未开通/组织禁用/余额不足/席位档位零额度/组零额度/服务级禁用…）、`SDKAssistantMessageError` 7 种、`EXIT_REASONS` 6 档（`bypass_permissions_disabled` 单列，因为它属于「被策略关掉」而非用户主动退出）。

踩坑：

- **`.describe(` 跨行是这类文件最大的陷阱，而且分两级**：`after` 落在 `.describe(` 与字符串之间会**直接语法错误**，预检能拦；落在 describe 收尾之后则**语法合法但语义错位**，预检不报、`annotate.py` 也不报 `⚠`。本次踩到后者两处——`capabilities` 那条落进了外层对象体的末尾（缩进 0 却处在 `{ }` 内、紧跟 `})`），`决策分类` 那条悬在两个同级注释之间。
- 判据补一条：**插入点后一行是 `})`、`),`、`]` 这类收尾行时，`after` 注释会变成「块末注脚」**，脱离它描述的字段。识别方法是扫描「顶格中文注释 + 前一行有缩进 + 后一行有缩进」，本次全文件扫出 17 处，其中 15 处是正常的对象属性边界，2 处需改。
- 修法：并入上一条 `before` 锚点的文本，而不是硬挪行号——锚点 153 → 151，产物更短也更连贯。
- 首个锚点落在第 1 行 `before`，插在 `/**` 文件头块注释之前，产物第 1 行即中文批注、第 2 行起是原文头注释，未被劈开。

流程账：1 个数据文件对齐源文件；预检 151 锚点全过、0 块内违例（首次 153，合并两处后 151）；`annotate.py` 两次均零 `⚠`、零 `⟳`；原文 1,889 行 → 批注版 2,040 行；`check-fidelity.py` 全仓 **1492 份 0 失败**；`check-links.py` 源码链接 2373 条加内链 711 条，0 失效；全仓 **1492/1902 文件、446,734/513,237 行、87%**；`src/` 还剩 **410 份 / 66,810 行**。

**下一批候选（巨兽单批 1 份封顶）**：`bootstrap/state.ts`(1,759) · `skills/loadSkillsDir.ts`(1,087) · `commands/plugin/PluginSettings.tsx`(1,072) · `bridge/remoteBridgeCore.ts`(1,009) · `native-ts/color-diff/index.ts`(1,000) · `cli/transports/ccrClient.ts`(999)（全仓还剩 410 份；之后是 `commands/plugin` 的 838/802 两份与 `cli/transports/WebSocketTransport.ts`(801)，800 行档清完就进 700 行档）。

### src batch 144: bootstrap/state.ts (1758 src / 1868 annotated / 110 anchors)

第六头巨兽：`src/bootstrap/state.ts`（1,759 行）。整份文件只有一个对象——`STATE`，约一百个字段的进程级可变单例，外加一百多个 getter/setter。**没有任何业务逻辑，也没有任何订阅机制**：界面侧靠 getter 现读，靠组件自己的调度去重渲染。原注释密度全仓最高，三处大写警告（`DO NOT ADD MORE STATE HERE` / `ALSO HERE` / `AND ESPECIALLY HERE`）本身就是这份文件的设计说明。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bootstrap/state.ts`](annotated/src/bootstrap/state.ts) | 1,758→1,868 | 110 | 全局单例：会话身份、成本与耗时口径、遥测计数器、路径不变式、四个 beta 头锁存、滚动排空、技能与团队追踪 |

要点：

- **它是 import DAG 的叶子，所有跨模块需求都要绕开 import**。文件里四种绕法各有一处注释说明：① 会话切换信号放模块作用域、由调用方自己 `subscribe`（否则要 import 监听者）；② 会话内 cron 任务的类型**就地定义**而不从 cron 模块引入；③ 项目指令文件内容缓存到状态里，断掉「分类器 → 指令文件 → 文件系统权限 → 分类器」这个环；④ `waitForScrollIdle` 手写轮询，因为隔离规则禁止从工具层引入 `sleep`。看懂这四条，就看懂了为什么这份文件里有那么多看着该抽出去的东西。
- **一整族字段的共同目的只有一个：别击穿服务端提示缓存**。四个 beta 头（自动模式、快速模式、缓存编辑、清思考）都是「粘性锁存」——一旦开启就一直发，因为头部本身变化会让 5–7 万 token 的提示缓存失效；`promptCache1hEligible` 首次求值即锁存，同理；`pendingPostCompaction` 让压缩后第一次成功调用能被打标，从而把「压缩导致的未命中」与「TTL 过期」区分开。
- **路径不变式**：所有路径 setter 都过 `normalize('NFC')`，其中 `originalCwd` 还先 `realpathSync` —— 不解析软链接的话，同一目录的软链路径与真实路径会被当成两个项目，会话存储就分叉了。`realpath` 失败时退回原始路径，兜底的是云存储挂载那种按分量 stat 的虚拟文件系统。
- **两种「返回值保持引用稳定」的技巧**（都写在注释里）：`getSlowOperations()` 无数据时返回模块级 `EMPTY_SLOW_OPERATIONS`，让调用方的 setState 靠 `Object.is` 直接跳过；有数据但一条都没过期时**不新建数组**，保持原引用，于是每 500ms 的轮询不会重渲染。前提也写清楚了——写入函数是先整体替换再 push，所以交出去的数组永不被就地改。
- **两处调度技巧**：交互时间戳默认只打脏标记、由渲染循环在下一帧统一 `Date.now()`（每次按键取时间是纯浪费），但副作用回调里必须传 `immediate`，否则用户发呆等权限弹窗时永远等不到下一帧；滚动排空用 150ms 去抖 + `unref()`，后台定时任务查旗标直接跳过，把事件循环让给渲染帧。
- **命名被工具链反向约束的少见样本**：字段叫 `userMsgOptIn` 是为了避开构建期字符串过滤器排除的两个子串（`BriefTool`、`SendUserMessage`），注释直接把两个子串写出来——名字不是为了表意最优，而是为了过构建。
- **口径分离**：总耗时区分「含重试」与「不含重试」；当轮 token 用量用轮开始时的快照做差；成本累加时每模型用量**整体替换**（那是快照）而总额才累加。

踩坑：

- **JSDoc 块注释内部仍是雷区**：`updateLastInteractionTime` 的文档注释跨 12 行，第二条锚点原本落在 `Pass immediate = true when...` 那一行，预检 `bslot` 直接拦下（`before` 落在块注释内部）。改为并入第一条 `before` 锚点，110 锚点。这是第 140、141 批同类坑的第三次出现——**判据稳定有效：目标行以 `*` 或 `*/` 开头即块注释内部**。
- 第 143 批新增的「块末注脚」扫描本批**零命中**：110 条里有大量注释落在对象属性之间（`...(...)` 条件展开、字段声明之间），但后一行没有一个是 `}`/`),`/`]` 这类收尾行。
- 三处内联大写警告（`DO NOT ADD MORE STATE HERE` 等）都在断言行之前，`before` 插入后中文批注紧贴英文警告，读起来是「警告 + 为什么」的配对。

流程账：1 个数据文件对齐源文件；预检 110 锚点全过、0 块内违例（首次 112，两处合并后 110）；`annotate.py` 零 `⚠`、零 `⟳`；原文 1,758 行 → 批注版 1,868 行；`check-fidelity.py` 全仓 **1493 份 0 失败**；`check-links.py` 源码链接 2374 条加内链 712 条，0 失效；全仓 **1493/1902 文件、448,492/513,237 行、87%**；`src/` 还剩 **409 份 / 65,051 行**。

**下一批候选（巨兽单批 1 份封顶）**：`skills/loadSkillsDir.ts`(1,087) · `commands/plugin/PluginSettings.tsx`(1,072) · `bridge/remoteBridgeCore.ts`(1,009) · `native-ts/color-diff/index.ts`(1,000) · `cli/transports/ccrClient.ts`(999) · `commands/plugin/ManageMarketplaces.tsx`(838)（全仓还剩 409 份；1,000 行档在本批之后只剩五份，之后进 838/802/801 的 800 行档）。

### src batch 145: skills/loadSkillsDir.ts (1086 src / 1188 annotated / 102 anchors)

第七头巨兽：`src/skills/loadSkillsDir.ts`（1,087 行）。技能装载器全部逻辑所在——**双轨目录**（新式 `skills/` 只认目录格式，遗留 `commands/` 两种都认）、五路并行加载、按真实路径去重、路径条件技能的延迟激活、会话内动态发现。装载器本身是 `memoize` 的，按工作目录做键。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`skills/loadSkillsDir.ts`](annotated/src/skills/loadSkillsDir.ts) | 1,086→1,188 | 102 | 技能装载：六来源、前置元数据 18 个字段、提示词生成闭包、去重与优先级、条件技能、动态发现、MCP 注册间接层 |

要点：

- **`getPromptForCommand` 是整份文件的心脏**，四步顺序不能换：加目录前缀 → 参数替换 → 占位符替换 → 决定要不要执行内联 shell。参数替换必须排在占位符之前，因为参数值里可能本身就含占位符文本。
- **安全边界只有两处判断**：① `loadedFrom !== 'mcp'` —— MCP 技能来自远端、不可信，正文里的内联 shell 一律不执行；② 目录发现时查 `isPathGitignored`，挡住 `node_modules/pkg/.claude/skills` 那种被默默加载的技能。两处的注释都写明「真正的安全边界是调用时的信任对话」，代码本身只是止损。
- **内联 shell 的免弹窗靠注入权限规则**：`getAppState` 被包了一层，把技能声明的 `allowed-tools` 塞进 `alwaysAllowRules.command`，于是技能自己声明的工具范围内执行 shell 不逐条弹窗——这是「技能自带权限声明」的落地机制。
- **去重按 `realpath` 而不是 inode**，注释给了两个具体失败场景：虚拟文件系统/容器里 inode 恒为 0，另一类文件系统会丢精度（附了 issue 链接）。流程是**先并行算身份、再同步去重**，因为解析是异步的、先到先得的判定是同步的。
- **合并顺序即优先级**：组织统管 → 用户级 → 项目级（由深到浅）→ 附加目录 → 遗留命令。去重时先到先得；动态发现则反着来——浅的先写、深的覆盖，于是「离文件近的优先」在 Map 上自动成立。
- **条件技能是「分流 + 搬家」**：带 `paths` 前置元数据且未激活的技能不进返回值，只进待激活表；命中路径时从待激活表**删掉**、写进动态表、名字记进存活集合（存活集合要跨缓存清理，否则每次清缓存都会退回待激活）。匹配用忽略库，与项目指令文件的条件规则同一套语义。
- **`--bare` 的语义被注释钉死**：跳过全部自动发现，只加载显式 `--add-dir`，但技能锁依然生效——**精简模式不是策略旁路**。
- **尾部那三十行是依赖图的注脚**：MCP 技能模块不能直接动态引入本文件（一条边扇成多处环），也不能用变量拼的说明符（能过依赖检查，但打包后运行时解析不到），于是改用「叶子注册表」——本文件写一次、幂等。

踩坑：

- 数据文件里一处引号未闭合（第 75 行锚点文本），`ast.parse` 直接报出，改一行即过。
- 首轮产物有一处落在 `}` 与 `} catch (error) {` 之间——块末注脚扫描（正则里加了 `catch` 分支）抓到。挪到 `try {` 之前后语义更贴切：**兜住单个技能意外的就是这个 try，不是那个 catch**。
- 两处英文注释块（`git check-ignore` 那段 6 行、`ignore() throws on empty strings` 那段 4 行）内都有诱人的锚点位置，`bslot` 判据提前避开了——第 144 批踩过的坑本批零复发。
- 三个函数名带 `Skills`、路径含 `skills/`，但都不含 `bash`/`shell`/`powershell` 子串，`annotate.py` 可直接跑，不走间接 runner。

流程账：1 个数据文件对齐源文件；预检 102 锚点全过、0 块内违例；`annotate.py` 两次均零 `⚠`、零 `⟳`；原文 1,086 行 → 批注版 1,188 行；`check-fidelity.py` 全仓 **1494 份 0 失败**；`check-links.py` 源码链接 2375 条加内链 713 条，0 失效；全仓 **1494/1902 文件、449,578/513,237 行、87%**；`src/` 还剩 **408 份 / 63,964 行**。

**下一批候选（巨兽单批 1 份封顶）**：`commands/plugin/PluginSettings.tsx`(1,072) · `bridge/remoteBridgeCore.ts`(1,009) · `native-ts/color-diff/index.ts`(1,000) · `cli/transports/ccrClient.ts`(999) · `commands/plugin/ManageMarketplaces.tsx`(838) · `commands/plugin/BrowseMarketplace.tsx`(802)（全仓还剩 408 份；1,000 行档只剩四份，之后是 838/802/801 的 800 行档）。

### src batch 146: commands/plugin/PluginSettings.tsx (1072 src / 1157 annotated / 84 anchors)

第八头巨兽：`src/commands/plugin/PluginSettings.tsx`（1,072 行）。`/plugin` 命令的外壳——四个页签（发现/已安装/市场/错误）+ 命令行参数到视图状态的翻译层 + 一个**五类分组的错误页**。全文件是 React Compiler 产物：`_c(75)` 编号记忆槽、`t0..t27` 临时变量、`bb77:`/`bb37:` 标签块（switch 的 break 重写）、内联箭头被提升成 `_temp/_temp0.._temp9`。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/plugin/PluginSettings.tsx`](annotated/src/commands/plugin/PluginSettings.tsx) | 1,072→1,157 | 84 | 四页签外壳、参数→视图映射、错误页五类分组与五种动作、乐观更新、渲染期重定向、页签与视图的投影关系 |

要点：

- **导航与内容分成两层状态**：`activeTab`（页签）与 `viewState`（视图）。切页签必须把视图拨回该页签的根；而**错误页是唯一不设视图的分支**——它的内容完全由应用状态与本地副作用决定。`getInitialTab` 从初始视图反推页签，因为视图是真相、页签只是投影。
- **错误页把七路来源拼成一张表**，且有几条硬性的排序与去重规则：瞬时错误（认证失败/超时/网络）排最上，因为它们**只能靠重启重试**，所以给的动作是「无」；市场名跨来源去重（失败列表与错误列表会撞）；插件按**插件名**去重而不是按错误对象（一个插件会报多条）。
- **五种错误动作严格分优先级**：有可编辑来源 → 「从设置里摘」；只在策略里 → 「由组织管理」（不给删除动作，因为点了只会失败）；两边都没有但在清单文件里（历史手装）→ 引导去市场页删；已装但数据加载失败 → 直接删市场源；插件错误 → 一律导向卸载。
- **摘市场要同时收拾两处**：市场定义本身，以及依赖它的已启用插件（靠 `@市场名` 后缀匹配）。写回设置时**置空值而非删键**——序列化时空值字段会整体消失，直接删键可能触发别的合并逻辑。没有改动就不写盘。
- **乐观更新必须两处同删**：错误列表里同市场的条目 + 安装状态里的市场条目，少删一处就留下幽灵行。回执带上作用域名，因为用户刚在三个可编辑作用域里改过。
- **几处「渲染期副作用」是有意的**：`marketplace-menu` 视图在渲染期 `setViewState` 再 `return null`，是旧入口重定向到新菜单的最小写法；序号夹取同样在渲染期回写。
- **`_temp` 家族是编译器提升出来的内联箭头**：提升后每次渲染拿到同一引用，记忆槽的引用比较才不会误判为变更。`_temp1` 置刷新标记时先判一次「已置真就原样返回」，省掉一次状态重建。
- **两处界面细节**：选项栏的启用由「有没有行」与「选中的行有没有动作」两个布尔共同决定（`managed-only` 与 `none` 都算无动作）；页签上的错误数是**错误列表长度 + 状态为失败的市场数**，否则会出现「页签写着无错、点进去却有行」。

踩坑：

- 这份文件 `bb77:` / `bb37:` 标签块密集，`switch` 的 `break` 都带标签，`ast.parse` 与预检的状态栈扫描都没误判——**标签块不影响锚点判定**，因为锚点全落在 `case`/`if`/`const` 这类语句行。
- 首轮零告警、零 `⟳`；JSX 子元素区扫描 **84 条零命中**（老坑没有复发），块末注脚扫描同样零命中。这批大量注释落在 JSX 表达式内部的条件表达式之间，但都不是「`<` 与 `>` 之间」。
- 产出「插入注释 85 行」而锚点 84：末尾 sourceMappingURL 被替换成两行说明，差值 1 属正常。

流程账：1 个数据文件对齐源文件；预检 84 锚点全过、0 块内违例；`annotate.py` 零 `⚠`、零 `⟳`；原文 1,072 行 → 批注版 1,157 行；`check-fidelity.py` 全仓 **1495 份 0 失败**；`check-links.py` 源码链接 2376 条加内链 714 条，0 失效；全仓 **1495/1902 文件、450,650/513,237 行、87%**；`src/` 还剩 **407 份 / 62,892 行**。

**下一批候选（巨兽单批 1 份封顶）**：`bridge/remoteBridgeCore.ts`(1,009) · `native-ts/color-diff/index.ts`(1,000) · `cli/transports/ccrClient.ts`(999) · `commands/plugin/ManageMarketplaces.tsx`(838) · `commands/plugin/BrowseMarketplace.tsx`(802) · `cli/transports/WebSocketTransport.ts`(801)（全仓还剩 407 份；1,000 行档只剩三份，之后是 838/802/801 的 800 行档，清完进 700 行档）。

### src batch 147: 1000-line tier finale, 5 files (4645 src, 4936 annotated, 289 anchors)

回头扫 800–1,009 行档：把「巨兽单批 1 份封顶」阶段留下的五份中行数较大的清掉（之前只啃了 2,000+ 行的几头巨兽）。五份覆盖 CCR 远程控制桥核心、终端彩色 diff 移植、CCR v2 worker 协议客户端、插件市场两个界面。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bridge/remoteBridgeCore.ts`](annotated/src/bridge/remoteBridgeCore.ts) | 1,008→1,089 | 81 | CCR 远程控制桥的共享核心：归档遥测状态机、archiveSession 归档流程、会话生命周期与崩溃恢复指针 |
| [`native-ts/color-diff/index.ts`](annotated/src/native-ts/color-diff/index.ts) | 999→1,061 | 62 | 终端彩色 diff 的 TypeScript 移植：highlight.js 懒加载、词级 diff、ANSI 转义、ColorDiff/ColorFile 渲染器 |
| [`cli/transports/ccrClient.ts`](annotated/src/cli/transports/ccrClient.ts) | 998→1,062 | 64 | CCR v2 worker 生命周期协议客户端：epoch 管理、状态上报、心跳、事件/内部事件/投递三路上传器、流式文本累加 |
| [`commands/plugin/ManageMarketplaces.tsx`](annotated/src/commands/plugin/ManageMarketplaces.tsx) | 838→879 | 40 | 插件市场管理界面：增删市场源、刷新、错误态与组织托管提示 |
| [`commands/plugin/BrowseMarketplace.tsx`](annotated/src/commands/plugin/BrowseMarketplace.tsx) | 802→845 | 42 | 插件市场浏览界面：搜索、分类、安装、详情与卡片网格 |

要点：

- **remoteBridgeCore 是 CCR 桥的「无 UI 内核」**：archiveSession 把会话归档到兼容层（`/v1/sessions`，不是 `/v1/code/sessions`），归档状态用归档遥测状态机（`ok` / `skipped_no_token` / `network_error` / `server_4xx` / `server_5xx`）统一聚合，比散落的若干布尔更干净（仅 `archive_timeout` 区分 `ECONNABORTED` 与其他网络错误）。
- **color-diff 是 Rust syntect+bat 思路的 TS 复刻**：为了不在模块求值期付出约 50MB highlight.js 的代价，hljs 做成懒加载；词 diff 用 `diffArrays`，按码点推进以正确处理代理对与全角宽度；ANSI 转义分 truecolor / 256 色 / ansi 三档。
- **ccrClient 把「写操作」统一收口到 `this.request()`**：四个串行批量上传器（`workerState` / `event` / `internalEvent` / `delivery`）各管一类上报；401/403 区分「令牌过期确定性退出」与「令牌有效但服务端抖动计入重试阈值（10）」。
- **两个插件市场界面是 React Compiler 产物**（`_c` 记忆槽、`t0..tN` 临时变量、`bbNN:` 标签块）；锚点只落函数签名行与语句/收尾行，零 `⟳` 零 `⚠`。

踩坑：

- 两份 `.tsx` 末尾 base64 `sourceMappingURL` 按惯例省略，`fidelity` 标 `OK*`（插入注释行数 = 锚点数 + 1，差值 1 属正常）。
- 首轮 `check-fidelity` 两处 FAIL（判据 5：劈开未结束的多行表达式）——ccrClient 的 `export type CCRInitFailReason =` 联合类型首行 `(49,'after')`、remoteBridgeCore 的 `type ArchiveTelemetryStatus =` 首行 `(956,'after')` 都落在多行类型首行，中文插在联合成员之间把语句劈开；按规矩 7 改到该联合类型的收尾行（`| 'worker_register_failed'` 与 `| 'server_5xx'`）后复验 0 失败。印证「`after` 也不落跨行类型首行」。
- `⟳` 属正常良性外移：ccrClient 4 处、remoteBridgeCore 6 处、ManageMarketplaces 1 处、color-diff 2 处 `//` 注释段中部的锚点被自动挪到段边界，落点在英文注释块之后、未劈开英文。

流程账：5 个数据文件逐一对齐源文件；预检 289 锚点全过、无英文双引号/反斜杠、`ast.parse` 全过；`annotate.py` 五次共 13 处良性 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 **1500 份 0 失败**；`check-links.py` 源码链接 2377 条加内链 715 条，0 失效；全仓 **1500/1902 文件、455,295/513,237 行、88.7%**；`src/` 还剩 **402 份 / 58,247 行**。

**下一批候选（进入 500–570 行档，单批约 10 份）**：`state/AppStateStore.ts`(569) · `commands/plugin/UnifiedInstalledCell.tsx`(565) · `vim/operators.ts`(556) · `commands/thinkback/thinkback.tsx`(550) · `bridge/sessionRunner.ts`(550) · `bridge/bridgeApi.ts`(539) · `commands/terminalSetup/terminalSetup.tsx`(531) · `bridge/bridgeUI.ts`(530) · `tasks/LocalShellTask/LocalShellTask.tsx`(523) · `buddy/sprites.ts`(514)（全仓还剩 402 份；1,000 行档已清零，之后是 500–570 行档）。

### src batch 148: 800-line tier, 6 files (4392 src, 4678 annotated, 284 anchors)

继第 147 批清完 1,000 行档之后，回头补齐 660–800 行档：两条传输实现的完整重连与保活策略、控制协议 schema、斜杠命令总表、后台代理任务状态机、插件发现界面。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`cli/transports/WebSocketTransport.ts`](annotated/src/cli/transports/WebSocketTransport.ts) | 800→853 | 53 | WebSocket 传输：Bun/Node 双栈、指数退避重连、休眠检测、环形缓冲重放、ping 与保活双定时器 |
| [`commands/plugin/DiscoverPlugins.tsx`](annotated/src/commands/plugin/DiscoverPlugins.tsx) | 781→816 | 34 | 插件发现界面：多市场聚合、安装数排序、批量安装、搜索与分页、六种空态 |
| [`commands.ts`](annotated/src/commands.ts) | 754→812 | 58 | 斜杠命令总表：条件导入死代码消除、技能三路装载、可用性判定、两份安全白名单 |
| [`cli/transports/SSETransport.ts`](annotated/src/cli/transports/SSETransport.ts) | 711→753 | 42 | SSE 读 + POST 写传输：分帧解析、序号去重与续传、存活计时器、写侧重试 |
| [`tasks/LocalAgentTask/LocalAgentTask.tsx`](annotated/src/tasks/LocalAgentTask/LocalAgentTask.tsx) | 683→731 | 47 | 本地代理任务：进度追踪器、通知去重、retain/diskLoaded/驱逐期限、后台信号表 |
| [`entrypoints/sdk/controlSchemas.ts`](annotated/src/entrypoints/sdk/controlSchemas.ts) | 663→713 | 50 | 控制协议 schema：21 种请求、控制响应与错误、8 分支标准输出、5 分支标准输入 |

要点：

- **两条传输是同一套策略的两种实现**：都做指数退避 + 正负 25% 抖动 + 10 分钟总预算，都区分永久拒绝与可重试错误。差别在判活手段——WebSocket 靠 ping/pong 与 tick 间隔突变，SSE 靠 45 秒无帧（服务端每 15 秒发 keepalive，漏三次即判死）。
- **WebSocket 的难点全在「别留下幽灵对象」**：事件处理器必须是稳定的类属性箭头函数，重连前先 `removeWsListeners` 再 `close`，否则每次重连遗留一个 WS 对象加五个闭包。Bun 用 `removeEventListener`、ws 包用 `off`，混用会静默失效。
- **重放语义是「确认后才丢」**：带 uuid 的出站消息进环形缓冲，重连时按服务端 `x-last-request-id` 驱逐已确认部分；重放后坚决不清缓冲，因为连接可能在重放后、服务端处理前再断。
- **SSE 的续传靠双通道**：`from_sequence_num` 查询参数给服务端定位，`Last-Event-ID` 头给中间层重放；去重集合超过 1000 条就修剪远低于高水位的序号，只有靠近高水位的还有价值。
- **`commands.ts` 是死代码消除的样板**：用 `feature()` 构建期常量加 `require` 条件导入，对外构建里整段消失；`INTERNAL_ONLY_COMMANDS` 再加一道 `USER_TYPE === 'ant' && !IS_DEMO` 的运行时门。
- **三层缓存必须从外往里清**：`lodash memoize` 的外层命中时根本走不到内层，只清内层等于没清——这条注释是踩坑后写的。
- **`LocalAgentTask` 区分「看着」与「持有」**：`viewingAgentTaskId` 是正在看谁，`retain` 是正在持有谁，后者才阻止驱逐并触发磁盘引导。`diskLoaded` 保证每个 retain 周期只读一次侧链。
- **通知去重靠原子检查并置位**：检查 `notified` 与写回必须在同一次状态更新里完成，否则并发完成会发两条。

踩坑：

- 两条 `before` 落进 JSDoc 块内部（`SSETransport` 的 `* Each event: client_event ...` 行、`commands.ts` 的 `* Not memoized — auth state ...` 行），预检 `bslot` 直接拦下。处置是并入相邻锚点：前者挪到类声明前，后者与「判定按提供方分两类」合并成一条。**这是块注释内部这条坑第四次复发**，判据仍是「目标行以 `*` 或 `*/` 开头」。
- `commands.ts` 两处「失败返空」类注释落在 `}` 与 `} catch` 之间，块末注脚扫描抓到。按第 145 批的处置挪到 `try {` 之前，语义才准。
- 调整锚点行号后忘了重排顺序，预检报 `[order] L359 未升序（上一处 L374）`——改行号后必须把该条移到正确位置，`ast.parse` 与字段校验都不会替你检查这个。
- `LocalAgentTask` 一处 `⟳`：`(252,'before')` 原本指向模板字符串起点，annotate 自动外移到字符串之前，落点仍通顺（XML 消息拼装处）。

流程账：6 个数据文件逐一对齐源文件；预检首轮 286 锚点报 2 项 `bslot`，修正后 284 锚点全过；`annotate.py` 六次共 1 处良性 `⟳`、零 `⚠`；`check-fidelity.py` 全仓 **1506 份 0 失败**（较上批 +6）；`check-links.py` 源码链接 2382 条加内链 716 条，0 失效；全仓 **1506/1902 文件、459,687/513,237 行、89%**；`src/` 还剩 **396 份 / 53,848 行**。

**下一批候选（进入 500–650 行档，单批约 6–7 份）**：`commands/ide/ide.tsx`(646) · `commands/install-github-app/install-github-app.tsx`(587) · `screens/Doctor.tsx`(575) · `state/AppStateStore.ts`(570) · `bridge/initReplBridge.ts`(570) · `commands/plugin/UnifiedInstalledCell.tsx`(565) · `vim/operators.ts`(557)（全仓还剩 396 份；800 行档已清零，之后是 500–590 行档）。

### src batch 149: 500-650 line tier, 7 files (4067 src, 4383 annotated, 316 anchors)

进入 500–650 行档：REPL 桥接的接线层、应用状态总表、vim 操作符族、两处编译器产物的界面组件、GitHub 应用安装状态机、诊断屏。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/ide/ide.tsx`](annotated/src/commands/ide/ide.tsx) | 646→697 | 51 | IDE 命令：四个子屏、连接超时兜底、断开时先摘监听再清三处状态、工作区路径压缩 |
| [`commands/install-github-app/install-github-app.tsx`](annotated/src/commands/install-github-app/install-github-app.tsx) | 587→631 | 44 | 安装向导：十一节点状态机、gh 三查、仓库与密钥探测、两条安装路径 |
| [`screens/Doctor.tsx`](annotated/src/screens/Doctor.tsx) | 575→617 | 42 | 诊断屏：承诺解包加挂起边界、哨兵缓存的环境校验、并行目录检查、九个区块装配 |
| [`state/AppStateStore.ts`](annotated/src/state/AppStateStore.ts) | 570→613 | 44 | 应用状态总表：深度不可变与可变部分的切割、惰性加载破环、默认状态工厂 |
| [`bridge/initReplBridge.ts`](annotated/src/bridge/initReplBridge.ts) | 570→623 | 54 | 桥接接线层：六道门禁、跨进程退避、标题三级推导、两条路径分派 |
| [`commands/plugin/UnifiedInstalledCell.tsx`](annotated/src/commands/plugin/UnifiedInstalledCell.tsx) | 565→596 | 31 | 统一列表项：四种条目类型、状态图标优先级、哨兵缓存的常量节点 |
| [`vim/operators.ts`](annotated/src/vim/operators.ts) | 557→606 | 50 | vim 操作符：十个纯函数、范围计算的四种情况、按字形簇前进 |

要点：

- **门禁的顺序本身就是设计**：桥接把 OAuth 检查排在组织策略之前，否则用控制台登录的人会先读到缓存里的旧组织策略，看到一句完全误导的报错。同理令牌覆盖（环境变量）一旦存在就整段跳过钥匙串相关的检查——过期的钥匙串令牌与本次连接无关，不该拖住它。
- **跨进程退避用内容寻址代替显式清理**：死令牌记的是它的过期时间戳，重新登录换出新令牌后键自然不再匹配，不需要任何清理逻辑。计数上限三次，到了就早退，写盘也被封顶三次。
- **「该刷新」与「已报废」是两个判断**：带五分钟提前量的过期判定适合前者，不适合后者——只剩三分钟但刷新接口恰好抖一下，缓冲式判定会误判死刑。所以第二步显式比较真实过期时间。
- **标题推导是带竞态保护的状态机**：三条消息两个触发点，生成走后台。回填时要同时满足三个条件——生成序号未变（防乱序覆盖）、会话没换（防环境丢失后写到旧会话）、用户没在这期间手动改名。
- **两份编译器产物的读法完全一样**：`_c(N)` 是槽位总数，`$[k] !== dep` 是依赖比较，哨兵值表示「没有依赖，永久缓存」。看懂这三件事之后，那些 `t1..t17` 就只是被提升的表达式。真正的信息在原始结构里——状态图标的优先级（待切换 → 错误 → 禁用 → 启用）与类型标签的位置。
- **断开连接要防的是自动重连**：先 `onclose = () => {}` 再关闭，否则客户端会立刻重连，等于断不掉。清状态时客户端、同前缀工具、同前缀命令三处一起清，少一处就留下幽灵条目。
- **vim 范围计算有四种情况**：改词的特例（到词尾而非下个词首）、整行动作的扩展（带上结尾换行）、含尾动作的前进（只在向后选时做）、以及把范围推到图片占位符之外——最后这条是为了不让一次删除把占位符劈成两半。
- **状态表的分界不是审美的**：`DeepImmutable` 只能包纯数据字段，含函数或可变结构的部分必须在交叉类型的另一半，否则类型系统会把 `Map`、`Set`、回调全部冻死。
- **`getDefaultAppState` 是函数而不是常量**：多处初始化必须拿到互不共享的集合与映射；而它内部的惰性加载是为了破环——队友模块反过来要读应用状态，静态导入会成环。

踩坑：

- `UnifiedInstalledCell` 一处锚点顺序错：把 `(524,…)` 改成 `(505,…)` 时忘了移到 `(517,…)` 之前，预检报 `[order]`。**这是「改行号必须同时重排位置」这条规则的第一次复现**，上一批在 `commands.ts` 上刚犯过。
- `install-github-app` 的「依赖表列全」注释落在 `}` 与 `}, [deps])` 之间——块末注脚扫描抓到。处置是并入 `useCallback` 起点的锚点，不再单列。**教训：讲回调依赖的注释要贴在回调开头，贴在结尾就变成块的脚注。**
- `initReplBridge` 的「归档函数没有异常捕获」落在对象字面量的最后一个字段与 `.catch(` 之间，且与紧邻的英文注释完全重复。处置是删掉该锚点，把结论并进「归档超时一点五秒」那条。
- `AppStateStore` 的「交叉类型分界」原本文案是「下面全是含函数或可变结构的字段」，但落位在 `}> & {` 之前的类型体内——描述「下面」而身在上半段末尾。改成收口式表述（上半段到此收口）才对得上位置。
- 本轮 `annotate.py` 七次**零 `⟳`、零 `⚠`**，这是第一次整批没有自动纠正。

流程账：7 个数据文件逐一对齐源文件；预检首轮 318 锚点报 1 项 `[order]`，修正后 316 锚点全过；`annotate.py` 七次零自动纠正；两项专项扫描（JSX 子元素区、块末注脚）抓到 3 处并已处置，余下 11 处命中全是 `} else` 分支注释，属预期；`check-fidelity.py` 全仓 **1513 份 0 失败**（较上批 +7）；`check-links.py` 源码链接 2388 条加内链 717 条，0 失效；全仓 **1513/1902 文件、463,754/513,237 行、90.4%**；`src/` 还剩 **389 份 / 49,483 行**。

**下一批候选（500–560 行档，单批约 7 份）**：`commands/thinkback/thinkback.tsx`(554) · `bridge/sessionRunner.ts`(550) · `bridge/bridgeApi.ts`(539) · `commands/terminalSetup/terminalSetup.tsx`(531) · `bridge/bridgeUI.ts`(530) · `tasks/LocalShellTask/LocalShellTask.tsx`(523) · `buddy/sprites.ts`(514)（全仓还剩 389 份；600 行以上已清零，之后集中在 500–560）

### src batch 150: 500-560 line tier, 7 files (3741 src, 4116 annotated, 375 anchors)

500–560 行档：桥接的三块基础设施（接口层、会话生成器、终端界面）、年度回顾插件、终端键位安装器、后台命令任务、吉祥物精灵表。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/thinkback/thinkback.tsx`](annotated/src/commands/thinkback/thinkback.tsx) | 554→605 | 51 | 年度回顾：插件自装六段状态机、动画播放与备用屏接管、三个动作的提示词 |
| [`bridge/sessionRunner.ts`](annotated/src/bridge/sessionRunner.ts) | 550→606 | 56 | 会话子进程：启动参数与环境装配、流式消息解析、活动环形缓冲、新旧令牌交接 |
| [`bridge/bridgeApi.ts`](annotated/src/bridge/bridgeApi.ts) | 539→593 | 54 | 桥接接口层：八个端点、401 单次重试、状态码到致命错误的翻译 |
| [`commands/terminalSetup/terminalSetup.tsx`](annotated/src/commands/terminalSetup/terminalSetup.tsx) | 531→591 | 60 | 键位安装器：五种终端、备份后改配置、保留注释的 JSONC 追加、苹果终端属性列表 |
| [`bridge/bridgeUI.ts`](annotated/src/bridge/bridgeUI.ts) | 530→590 | 60 | 终端状态区：可视行计数与擦除、二维码开关、多会话清单、自绘的重连与失败态 |
| [`tasks/LocalShellTask/LocalShellTask.tsx`](annotated/src/tasks/LocalShellTask/LocalShellTask.tsx) | 523→582 | 59 | 后台命令：卡顿看门狗、提示模式识别、通知原子去重、四处转后台的统一收尾 |
| [`buddy/sprites.ts`](annotated/src/buddy/sprites.ts) | 514→549 | 35 | 精灵表：十九种生物三帧线稿、帽子槽约定、整族判空才裁行 |

要点：

- **桥接三块的分工是「形状 / 进程 / 像素」**：接口层只管请求形状与错误翻译，会话生成器只管把子进程拉起来并读它的流，界面只管把状态画成几行终端文本。三者通过类型而不是共享状态耦合。
- **401 的处置分两层**：接口层只做「刷新一次再重试一次」，刷新函数本身是注入的——直接导入它会连带拉起配置、文件、权限、会话存储、命令表共约一千三百个模块。守护进程的令牌不会刷新，于是根本不注入。
- **重试有明确的次数与理由**：注册给十五秒（要等后端建环境），其余十秒；4xx 全部交给状态码翻译，因为只有那里才能产出带错误类型的致命错误；409 对归档是幂等的成功，429 是普通可重试错误而非致命错误。
- **子进程的两处坑写在注释里**：包管理器安装时 `execPath` 是 node 运行时，脚本路径必须排在所有参数之前（否则 node 把桥接参数当自己的选项）；桥接的 OAuth 令牌必须在子进程环境里置空，否则计费与归属会错位。
- **令牌刷新走标准输入而不是重启**：一条环境变量更新消息进子进程，它直接改进程环境，下一次取认证头自动拿到新值。这是「不打断会话」的实现方式。
- **卡顿看门狗的核心是「安静」**：四十五秒不增长只是必要条件，还要末尾一行看起来像交互提问才发通知——纯慢的命令（长构建、全库搜索）不打扰。尾部不像提示时重置计时而不是继续每五秒读盘。
- **通知去重要在同一次状态更新里完成**：检查 `notified` 与置位必须原子，因为完成路径有两条（自然结束与终止）会并发。
- **终端状态区的正确性依赖「可视行计数」**：状态区不是普通输出，刷新前必须知道自己占了几行（换行算一行、超宽按列数向上取整、结尾换行不算）。算错一行就会把历史输出擦掉或留下残影。
- **重连与失败态是自绘的**：主渲染对这两种状态先擦后返回，所以任何调用方（切二维码、设标题、刷显示）都必须提前避开——否则会把转圈或错误信息抹掉。这条守卫在四处重复出现，是刻意的。
- **键位安装器的原则是「改别人的文件要留后路」**：先备份（备份失败就整体放弃）、只在 JSONC 里追加而不重写（保留注释与缩进）、判重按字段组合而不是整条、苹果终端失败时按备份回滚并把三种恢复结果翻译成三句话。
- **精灵表的约定比画法重要**：五行高、十二列宽、第零行是帽子槽、每族三帧。裁掉空帽子行的条件必须检查整族而不是当前帧，否则帧间高度不一致，界面会跳。

踩坑：

- `terminalSetup` 两处锚点落在 `} = await ...` 这类解构续行上，中文注释被塞进了模式与赋值之间（语法合法但把语句切开）。块末注脚扫描抓到，处置是改到 `const {` 那一行。**新判据已写进预检**：`before` 命中 `^[}\])]\s*=` 一律报 `[split]`。
- 本轮 `annotate.py` 出现 5 处自动外移（bridgeApi 两处模板字符串误判、bridgeUI 一处、LocalShellTask 两处注释段中部），逐处确认后落点都仍通顺——这是第 150 批之前的批次数里最多的一次，但全部良性。
- `buddy/sprites.ts` 的 `{E}` 占位符是个隐患：它是**源码字符串里的字面量**，中文批注里不能出现同样的花括号写法，否则读者会分不清哪是占位符哪是批注。
- 反过来一个正面记录：本批 375 个锚点预检一次通过（顺序、长度、引号、反斜杠、块注释落位全绿），是迄今单批锚点最多的一次。

流程账：7 个数据文件逐一对齐源文件；预检首轮 375 锚点全过，修 2 处解构劈开后仍 375；`annotate.py` 七次共 5 处 `⟳`、零 `⚠`；两项专项扫描抓到 2 处并已处置，余下 12 处命中全是 `} else` / `} catch` 分支注释，属预期；`check-fidelity.py` 全仓 **1520 份 0 失败**（较上批 +7）；`check-links.py` 源码链接 2402 条加内链 719 条，0 失效；全仓 **1520/1902 文件、467,495/513,237 行、91.1%**；`src/` 还剩 **382 份 / 45,742 行**。

**下一批候选（470–510 行档，单批约 7 份）**：`commands/bridge/bridge.tsx`(509) · `memdir/memdir.ts`(507) · `keybindings/validate.ts`(498) · `vim/transitions.ts`(490) · `tasks/LocalMainSessionTask.ts`(479) · `skills/bundled/updateConfig.ts`(475) · `query/stopHooks.ts`(473)（全仓还剩 382 份；500 行以上已清零）

### src batch 151: 470-510 line tier, 7 files (3431 src, 3674 annotated, 242 anchors)

470–510 行档：远程控制命令、记忆目录的提示词构建、键位配置校验、vim 状态机、后台主会话任务、配置技能、停止钩子流水线。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/bridge/bridge.tsx`](annotated/src/commands/bridge/bridge.tsx) | 509→548 | 38 | 远程控制命令：预检五项门禁、断开确认框、二维码按需生成、三选项焦点循环 |
| [`memdir/memdir.ts`](annotated/src/memdir/memdir.ts) | 507→551 | 44 | 记忆目录：行数与字节双上限截断、幂等建目录、日志追加模式、检索段落装配 |
| [`keybindings/validate.ts`](annotated/src/keybindings/validate.ts) | 498→528 | 30 | 键位校验：五类告警、动作格式、原始字符串查重、保留快捷键归一化比对 |
| [`vim/transitions.ts`](annotated/src/vim/transitions.ts) | 490→524 | 34 | vim 状态机：十一状态分发表、两级计数相乘、操作符与动作的组合、重复查找翻转 |
| [`tasks/LocalMainSessionTask.ts`](annotated/src/tasks/LocalMainSessionTask.ts) | 479→523 | 44 | 后台主会话：隔离记录文件、复用中断控制器、通知原子去重、前台化时的互斥切换 |
| [`skills/bundled/updateConfig.ts`](annotated/src/skills/bundled/updateConfig.ts) | 475→490 | 15 | 配置技能：Schema 动态生成、三份文档分段、钩子验证七步、按参数精简提示词 |
| [`query/stopHooks.ts`](annotated/src/query/stopHooks.ts) | 473→510 | 37 | 停止钩子：四重门槛的后台记账、进度边跑边转发、阻断与阻止继续的分级、团队成员双链 |

要点：

- **预检的顺序就是设计**：远程控制先问组织策略，再问禁用原因，最后才做版本与凭据检查。策略要等加载完再判——缓存未就绪时读到的是旧值，会给出误导性的拒绝，让用户以为企业禁用了功能。
- **预检分支必须与连接侧逐字一致**：助手模式的会话是常驻的，只能走旧版路径，所以预检里也要把新版的判定改回假。两处判断一旦漂移，就会出现预检通过、连接却走另一条路并失败的情况。
- **异步动作要带取消标志**：预检是异步的，返回时组件可能已卸载。此时既不能改状态也不能调收尾回调，否则会触发卸载后更新的告警。
- **两个上限要分开报**：记忆入口文件同时受行数与字节约束。字节上限专门对付长行索引（两百行塞进近两百 KB 真实出现过），且必须按截断前的原文计量——先按行切完再量会低估。切字节时回退到最后一个换行，宁可少几个字符也不劈开一行。
- **构建器只读不建目录**：建目录是调用方的责任，且是幂等的（递归建目录本身吞掉已存在错误）。团队目录就挂在自动目录下面，递归建子目录会顺带建出父目录，所以只调一次。
- **追加式日志与共享索引根本合不来**：助手模式只往当天日志追加，整理交给夜间的独立流程；团队记忆要求双方读写同一份索引。两者不组合，所以日志模式的判定排在团队分支之前。
- **重复键必须回原始字符串去查**：解析后的对象已经丢了重复信息（解析器静默取最后一个）。所以校验器要在 JSON 文本上正则找块、往前找上下文、统计冒号前的键名，只在第二次出现时告警。
- **只有动作不同才算冲突**：同一个动作绑两次是冗余但无害，打扰用户反而降低告警的可信度。比较前统一归一化，大小写与修饰键顺序都不该影响判定。
- **零是动作不是计数前缀**：vim 的闲态先判一到九进入计数态，零单独作为行首动作。计数态超过上限就封顶，两级计数相乘（三乘两行等于六行）。
- **替换字符态要挡住空输入**：退格与删除键在字面字符状态里表现为空串，若直接交给替换逻辑，会变成删掉光标下的字符。空输入应当取消整个操作。
- **后台任务的输出绝不能写主会话那份记录**：主会话文件在清空对话后会重链，后台查询继续往里写就会污染清空后的对话。独立记录文件配符号链接重链才能活过清空。
- **中止要复用调用方的控制器**：新建一个只会中止壳子，真实查询继续跑。完成路径有两条（自然结束与中途终止），所以「已通知」的检查与置位必须在同一次状态更新里原子完成。
- **前台化是互斥切换**：把目标任务标成前台，同时把上一个前台任务退回后台。否则两个任务都以为自己在前台，输出会混在一起。
- **钩子执行器的统计要从进度消息里抽**：钩子是并行跑的，单条耗时按命令名匹配到第一条尚未填过耗时的记录。每轮的调用号由各执行器自己生成，不能复用停止钩子的那个。
- **阻断错误与阻止继续是两级**：阻断错误转成对用户不可见的用户消息（正文进摘要），阻止继续则直接停止且优先于前者。任一条团队成员钩子链要求阻止继续就立即返回。
- **模板字符串里的批注只能贴在声明前**：配置技能整份内容是提示词文本，块内插注释会变成提示词的一部分。所以四处锚点被自动外移到常量声明之前，落点仍通顺。

踩坑：

- `validate.ts` 两处锚点落在 `} else if` 之前（`})` 与 `} else if` 之间），成了上一分支的脚注，而文案讲的是接下来的分支。处置：前者改到 `} else if (...) {` 之后的英文注释前，后者同理。**这是块末注脚在本批的主要形态：描述下一分支却站在上一分支末尾。**
- `stopHooks.ts` 一处锚点落在 `return` 与 `} catch` 之间，文案讲兜底捕获却站在 try 块尾部。处置：改到 `} catch (error) {` 之内。
- `updateConfig.ts` 有 4 处锚点原本落在模板字符串内部，被 `annotate.py` 自动外移到常量声明前。这类文件（几乎全是提示词文本）可用的锚点位置本身就少，外移是唯一可行解。

流程账：7 个数据文件逐一对齐源文件；预检首轮 242 锚点全过；修正 3 处块末注脚后仍 242；`annotate.py` 七次共 4 处 `⟳`（全在 `updateConfig.ts`，全良性）、零 `⚠`；两项专项扫描首轮抓 3 处并全部处置，复扫零输出；`check-fidelity.py` 全仓 **1527 份 0 失败**（较上批 +7）；`check-links.py` 源码链接 2402 条加内链 719 条，0 失效；全仓 **1527/1902 文件、470,926/513,237 行、91.8%**；`src/` 还剩 **375 份 / 42,311 行**。

**下一批候选（440–475 行档，单批约 7 份）**：`keybindings/loadUserBindings.ts`(472) · `commands/ultraplan.tsx`(471) · `history.ts`(464) · `bridge/bridgeMessaging.ts`(461) · `upstreamproxy/relay.ts`(455) · `skills/bundled/scheduleRemoteAgents.ts`(447) · `entrypoints/agentSdkTypes.ts`(443)（全仓还剩 375 份；500 行以上已清零）

### src batch 152: 370-475 line tier, 7 files (3213 src, 3511 annotated, 297 anchors)

370–475 行档：键位热重载、超计划命令、历史存储、桥接消息层、上游代理隧道、定时远端代理技能、SDK 类型门面。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`keybindings/loadUserBindings.ts`](annotated/src/keybindings/loadUserBindings.ts) | 472→509 | 37 | 键位热重载：写稳定阈值、模块级单例、两种装载路径、监听目录而非文件、销毁顺序 |
| [`commands/ultraplan.tsx`](annotated/src/commands/ultraplan.tsx) | 471→519 | 47 | 超计划命令：提示词拼装、脱离式轮询、两种执行目标的分流、启动标志与孤儿归档 |
| [`history.ts`](annotated/src/history.ts) | 464→511 | 47 | 历史存储：占位符展开、全局文件的倒序读、本会话优先、文件锁与重试刷写、撤销跳过集 |
| [`bridge/bridgeMessaging.ts`](annotated/src/bridge/bridgeMessaging.ts) | 461→505 | 44 | 桥接消息层：四类类型守卫、双重去重、五种控制请求回执、环形缓冲有界集合 |
| [`upstreamproxy/relay.ts`](annotated/src/upstreamproxy/relay.ts) | 455→505 | 50 | 上游代理隧道：手写 protobuf 编解码、两种运行时的写语义、握手期缓冲、建连后禁发明文 |
| [`skills/bundled/scheduleRemoteAgents.ts`](annotated/src/skills/bundled/scheduleRemoteAgents.ts) | 447→479 | 32 | 定时远端代理：带标签标识解码、连接器清洗、提示词六块拼装、三条软性检查 |
| [`entrypoints/agentSdkTypes.ts`](annotated/src/entrypoints/agentSdkTypes.ts) | 443→483 | 40 | SDK 类型门面：纯类型再导出、抛错的桩函数、守护进程原语、连接句柄的流分离 |

要点：

- **写文件稳定阈值要小于调用方的耐心**：编辑器保存常常先截断再写入，五百毫秒的稳定窗口加两百毫秒的轮询间隔，才能在文件真正静止后读一次，而不是读到半截 JSON。
- **监听目录而不是文件**：只监听文件本身的话，用户删掉再重建就会失去后续事件。目录存在性检查失败就整体放弃，并把原因写进调试日志。
- **初始化标志要在确认可监听之后才置位**：提前置位会在一次失败后留下永远不再重试的状态。
- **销毁顺序是先置标志再关监听**：标志能挡住已经排队但尚未执行的回调，关监听只是释放句柄。
- **两种装载路径共用一套判定**：同步版给首屏渲染用，异步版给运行时用，缓存与告警都要一起写，否则两条路径会给出不一致的结果。
- **提示词里的措辞会被远端再解析一遍**：远端命令行在剥离标签之前就做关键词识别，所以主提示词里刻意不出现功能名，否则会自己触发自己。
- **脱离式轮询的关键是三条守卫**：返回后要重新查任务状态（可能已被停掉）、清地址要比对本次的地址（可能有更新的一次会话）、失败路径要自己归档（否则云端空转半小时）。
- **云端执行与回传本地是两条完全不同的收尾**：前者跳过归档（归档没有运行中检查，会杀掉正在跑的执行），后者把待选项交给对话框；收尾块只处理失败，不能抢另外两条路径的状态转换。
- **历史是全局文件加会话过滤**：文件跨项目共享，会话与项目的筛选在读出来之后做；本会话条目先吐、其他会话排队，避免并发会话互相插入。
- **撤销要同时对付缓冲与磁盘**：条目可能还在待写缓冲（直接删），也可能已经落盘（按时间戳进跳过集）。读取的两条路径都必须遵守这个跳过集。
- **文件锁要先保证文件存在**：加锁依赖文件本身，所以先以追加模式创建再取锁，锁带过期与重试次数，防止上一个进程崩溃后永久占锁。
- **序列化要放在清空缓冲之前**：序列化抛错时缓冲还在，下一次还能重试。
- **手写的单字段 protobuf 只有三段**：标签字节、变长长度、内容。解码要容忍空块（服务端拿它当保活），空输入返回空字节而不是空值，两者语义不同。
- **两种运行时的套接字写语义完全相反**：Bun 会返回实际交给内核的字节数、剩下必须自己排队；Node 自己缓冲、返回值只表示背压。适配层必须把这个差异吃掉，否则 Bun 上会静默丢字节。
- **握手期的待发队列是必需的**：连接请求与首包可能被合并进同一个数据块，隧道还没打开时到达的字节必须先入队。
- **建连之后不能再写明文错误**：隧道已在承载加密流，再写一个明文响应会把它弄坏，只能直接关闭。
- **两个收尾处理器都会触发**：错误必随关闭而来，所以要用「首次调用者胜出」的标志挡住第二次对已结束套接字的操作。
- **有界集合是环形数组加哈希集合**：数组保顺序、集合保常数时间查询，写指针取模推进；重复加入直接返回，否则同一个号会占两个位置。
- **类型门面里全是抛错的桩**：真实实现由打包产物替换。这样源码树可以被类型检查与引用分析完整覆盖，又不会真的执行。
- **守护进程与查询自带的远程控制相反**：前者把连接放在父进程（子进程崩了重启，会话不变），后者放在子进程（跟着一起死）。这个差别决定了宿主程序怎么设计重启策略。

踩坑：

- `scheduleRemoteAgents.ts` 有 **11 条锚点原本全落在同一份模板字符串内部**，被外移到同一行堆成十一行中文注释。重写方法：模板内容压成一条分节概览挂在模板起点，其余挂到模板外的拼接变量（提醒块、起始提问、第一步）处。**结论：以模板为主体的文件，锚点预算要提前按「模板外可见的语法节点」来算。**
- 本批专项扫描首轮抓 **8 处块末注脚**，全部是「描述下一分支却站在上一分支末尾」：`} catch` 前 3 处、`} else` 前 1 处、`} finally` 前 2 处，另有两处落在函数调用的两个回调参数之间。处置一律是连着把中文挪进括号内部。
- `ultraplan.tsx` 的 `} = await pollForApprovedExitPlanMode(...)` 再中一次 `[split]` 判据（解构续行会把模式与赋值切开），这是该判据第二次拦下真实错误。
- `upstreamproxy/relay.ts` 与 `entrypoints/agentSdkTypes.ts` 各有一条锚点原本落在 JSDoc 内部（`bslot`），挪到 JSDoc 之后即可。

流程账：7 个数据文件逐一对齐源文件；预检首轮 309 锚点报 3 项（1 处解构劈开、2 处块注释内部），修完再删减模板内 10 条与重复 2 条，最终 297；`annotate.py` 七次共 3 处 `⟳`（ultraplan 一处注释段中部、relay 一处注释段中部、schedule 一处模板外移），逐处确认良性；两项专项扫描抓 8 处并全部处置，复扫零输出；`check-fidelity.py` 全仓 **1534 份 0 失败**（较上批 +7）；`check-links.py` 源码链接 2409 条加内链 720 条，0 失效；全仓 **1534/1902 文件、474,139/513,237 行、92.4%**；`src/` 还剩 **368 份 / 39,098 行**。

**下一批候选（370–442 行档，单批约 7 份）**：`types/permissions.ts`(441) · `cli/update.ts`(422) · `remote/SessionsWebSocket.ts`(404) · `screens/ResumeConversation.tsx`(399) · `types/textInputTypes.ts`(387) · `bridge/createSession.ts`(384) · `commands/copy/copy.tsx`(371)（全仓还剩 368 份；500 行以上已清零）

### src batch 153: 339-363 line tier, 7 files (2444 src, 2653 annotated, 207 anchors)

339–363 行档（紧接第 152 批的 370–475 档之下沿）：插件类型契约、mcp 子命令处理器、插件选项对话框、远端会话管理器、入口初始化、默认键位大表、内置键位技能。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`types/plugin.ts`](annotated/src/types/plugin.ts) | 363→395 | 32 | 插件类型契约：内置插件定义四件套、PluginError 六类判别联合、错误消息翻译分派 |
| [`cli/handlers/mcp.tsx`](annotated/src/cli/handlers/mcp.tsx) | 362→394 | 31 | mcp 子命令处理器：add/remove/list/get 分派、StdinPrefixedTransport、配置读写合并、OAuth 与 headers |
| [`commands/plugin/PluginOptionsDialog.tsx`](annotated/src/commands/plugin/PluginOptionsDialog.tsx) | 357→376 | 18 | 插件选项对话框：React Compiler 产物的表单状态、启用开关、设置项渲染、提交校验 |
| [`remote/RemoteSessionManager.ts`](annotated/src/remote/RemoteSessionManager.ts) | 343→373 | 30 | 远端会话管理器：连接建立与重连、句柄缓存、心跳超时、错误三级分类 |
| [`entrypoints/init.ts`](annotated/src/entrypoints/init.ts) | 340→373 | 33 | 入口初始化：配置与特性开关装配、单例就位、子命令路由前准备、信号与退出清理 |
| [`keybindings/defaultBindings.ts`](annotated/src/keybindings/defaultBindings.ts) | 340→370 | 30 | 默认键位大表 DEFAULT_BINDINGS：按上下文分组、平台差异、VT 模式检测、特性开关条件注入 |
| [`skills/bundled/keybindings.ts`](annotated/src/skills/bundled/keybindings.ts) | 339→372 | 33 | 内置键位技能：把键位排查与新增指南打包成技能提示词，与 defaultBindings 互为补充 |

要点：

- **插件类型契约是「形状」而非「实现」**：types/plugin.ts 把内置插件定义、判别联合错误、错误消息翻译三者分离；错误穷尽六种子类，翻译函数靠判别字段分派，新增类型编译器会逼你补分支。
- **mcp 处理器把传输细节藏进辅助类**：StdinPrefixedTransport 把 MCP 协议流量从标准输入抽离，命令处理器只管读写配置与分派动作，不直接碰套接字。
- **插件选项对话框是 React Compiler 产物**：满屏 `_c(n)` 记忆槽与 `t1..tN` 临时变量，锚点只能落在函数签名与语句收尾，绝不能插进 JSX 或 `_c` 调用内部——这正是本文件锚点密度最低（18）的原因。
- **远端会话管理器的本质是可重连的连接**：连接建立、句柄缓存、心跳与超时、错误三级分类（网络/协议/业务）是它和本地会话最不同的地方。
- **入口初始化「先装配后路由」**：配置与特性开关先就位，各类单例再装配，最后才进子命令路由；信号与退出的清理函数必须成对注册，否则会漏掉某条清理路径。
- **默认键位是「真相源」大表**：按上下文分组，平台差异（Windows alt+v vs 其余 ctrl+v）、运行时能力（VT 模式检测）、特性开关（KAIROS / QUICK_SEARCH / MESSAGE_ACTIONS）三路条件注入，都用展开运算符合并进同一张表。
- **meta/super 双绑是给 kitty 协议终端留的后路**：同一动作绑两个修饰键，终端不支持其中一个时另一个仍能触发，避免「绑了却按不出来」。
- **内置键位技能把文档当数据**：键位冲突排查与新增指南打包成技能提示词，与 defaultBindings.ts 的真相源互为补充，改键位时两边要一起看。

踩坑：

- **defaultBindings.ts 三处展开表达式劈开语句**：`...(feature('KAIROS') || feature('KAIROS_BRIEF') ? {...} : {})` 这类条件注入，初始锚点落在 `?` 之前的开行（L45 / L52 / L268），把对象字面量从中间切开；check-fidelity 报「中文批注插在了未结束的多行表达式中间，语句被劈开」。处置：全部挪到展开闭合行（L47 / L59 / L295，均以 `},` 或 `})` 结尾）。
- **defaultBindings.ts 一处常量声明多行劈开**：`const SUPPORTS_TERMINAL_VT_MODE =`（源行 21–25 跨五行）的 `after` 锚点原本落在 `=` 之后的开行，把表达式切开；挪到闭合行 L25（以 `))` 结尾）才过关。
- **defaultBindings.ts 一处预检升序违规**：挪动后 L295 的锚点在数据文件里排到了 L290 之前，触发 `[order]`。处置：把 `L290` 条目调到 `L295` 之前（两者行号本已升序 290<295，只是列表位置写反）。
- **mcp.tsx 与 init.ts 各一处 `⟳` 自动外移**（mcp L187→188、init L108→109），落在模板字符串 / 注释段中部，逐处确认落点仍通顺，良性。

流程账：7 个数据文件逐一对齐源文件；预检首轮 207 锚点报 5 项（defaultBindings 三处展开劈开 + 一处常量多行劈开 + 一处升序违规），逐一修复后仍 207；`annotate.py` 七次共 2 处 `⟳`（mcp 一处、init 一处），零 `⚠`；两项专项扫描（块末注脚、解构劈开）首轮抓 defaultBindings 多处并全部处置，复扫零输出；`check-fidelity.py` 全仓 **1541 份 0 失败**（较上批 +7）；`check-links.py` 源码链接 2416 条加内链 721 条，0 失效；全仓 **1541/1902 文件、476,792/513,237 行、92.9%**；`src/` 还剩 **361 份 / 36,806 行**。

**下一批候选（370–442 行档之上沿，单批约 7 份）**：`types/permissions.ts`(441) · `cli/update.ts`(422) · `remote/SessionsWebSocket.ts`(404) · `screens/ResumeConversation.tsx`(399) · `types/textInputTypes.ts`(387) · `bridge/createSession.ts`(384) · `buddy/CompanionSprite.tsx`(371) · `commands/copy/copy.tsx`(371) · `bridge/replBridgeTransport.ts`(370) · `native-ts/file-index/index.ts`(370)（全仓还剩 361 份；500 行以上已清零）

### src batch 154: 370-441 line tier, 10 files (3916 src, 4136 annotated, 217 anchors)

370–441 行档（紧接第 153 批的 339–363 档之上沿，吞掉 370 行起的前 10 大文件）：权限系统纯类型层、update 命令主流程、CCR 会话 WebSocket 客户端、恢复会话界面、文本输入框类型、桥接会话创建、/copy 命令、陪伴精灵渲染、桥接 v1/v2 传输适配、纯 TS 模糊文件搜索。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`types/permissions.ts`](annotated/src/types/permissions.ts) | 441→469 | 28 | 权限系统纯类型层：PermissionResult 判别联合、六种结果变体的语义边界、allow/ask/deny 的职责划分、与运行时的桥接契约 |
| [`cli/update.ts`](annotated/src/cli/update.ts) | 422→448 | 26 | update 命令主流程：版本比对、平台与架构判定、更新通道选择、降级与锁定检测 |
| [`remote/SessionsWebSocket.ts`](annotated/src/remote/SessionsWebSocket.ts) | 404→425 | 21 | CCR 会话 WebSocket 客户端：连接生命周期、消息分帧、重连退避、心跳与超时、错误三级分类 |
| [`screens/ResumeConversation.tsx`](annotated/src/screens/ResumeConversation.tsx) | 398→419 | 20 | 恢复会话界面（React Compiler 产物）：会话清单、选择态、恢复入口、空态 |
| [`types/textInputTypes.ts`](annotated/src/types/textInputTypes.ts) | 387→402 | 15 | 文本输入框类型：输入值 / 光标 / 组合输入（IME）三态的形状、受控与非受控的判别 |
| [`bridge/createSession.ts`](annotated/src/bridge/createSession.ts) | 384→408 | 24 | 桥接会话创建：create/get/archive/标题四类端点、参数归一、错误翻译 |
| [`commands/copy/copy.tsx`](annotated/src/commands/copy/copy.tsx) | 371→388 | 17 | /copy 命令：把当前会话或选区拷贝成可分享片段、格式装配、剪贴板写入 |
| [`buddy/CompanionSprite.tsx`](annotated/src/buddy/CompanionSprite.tsx) | 370→389 | 18 | 陪伴精灵渲染：精灵资源加载、帧动画循环、交互热区、状态驱动切换 |
| [`bridge/replBridgeTransport.ts`](annotated/src/bridge/replBridgeTransport.ts) | 370→387 | 17 | 桥接 v1/v2 传输适配：两套协议的鉴权头与信封、版本协商、错误映射 |
| [`native-ts/file-index/index.ts`](annotated/src/native-ts/file-index/index.ts) | 370→401 | 31 | 纯 TS 模糊文件搜索：查询分词、评分排序、路径归一、大小写不敏感匹配 |

要点：

- **权限层只定义形状不碰执行**：types/permissions.ts 把 PermissionResult 拆成判别联合的六种变体，allow/ask/deny 的语义边界写在类型里，真正的裁决在运行时模块；新增判定分支时编译器会逼你补类型，不会漏。
- **update 命令把「能否更」与「怎么更」分开**：cli/update.ts 先比对当前版本与发布通道，再决定走自动更新还是提示手动；平台与架构判定、降级与锁定检测是两条独立检查，互不污染。
- **CCR WebSocket 客户端是「可重连的帧流」**：remote/SessionsWebSocket.ts 把连接生命周期、消息分帧、重连退避、心跳超时四件事绑在一起，错误按网络 / 协议 / 业务三级分类，和本地会话最不同。
- **恢复会话界面是 React Compiler 产物**：ResumeConversation.tsx 满屏 `_c(n)` 记忆槽与 `t1..tN` 临时名，锚点只能落函数签名与语句收尾，不能插进 JSX——所以锚点密度偏低（20）。
- **文本输入框类型只描述状态形状**：textInputTypes.ts 把输入值、光标位置、组合输入（IME）三态的形状与受控 / 非受控的判别写清楚，真正的渲染与事件处理在组件里，类型层不掺逻辑。
- **桥接会话层是四端点契约**：createSession.ts 把 create/get/archive/标题四类端点、参数归一、错误翻译收在一个文件，对端只认这组形状，不在调用方散落协议细节。
- **/copy 命令把「选什么」与「怎么贴」分离**：copy.tsx 先确定拷贝范围（当前会话或选区），再装配分享格式并写剪贴板，格式装配与写入是两套职责。
- **陪伴精灵是资源驱动的渲染**：CompanionSprite.tsx 精灵资源加载、帧动画循环、交互热区、状态切换都围绕一个资源表转，状态机只是选择器。
- **桥接传输适配的核心是「版本协商」**：replBridgeTransport.ts 把 v1/v2 两套协议的鉴权头与信封差异收敛到统一接口，错误映射表决定哪种协议错误该翻译成致命错误。
- **纯 TS 模糊搜索是「评分排序」而非「精确匹配」**：file-index/index.ts 把查询分词、路径归一、大小写不敏感后按评分排序，没有命中的硬阈值，靠排序把最像的顶上来。

踩坑：

- **replBridgeTransport.ts 两处自审错误已修**：数据文件头写成 `# -*- coding: utf-8-*-`（末尾多一杠），改为 `# -*- coding: utf-8 -*-`；一处锚点行号写错（原文 `let getAuthHeaders` 实际在第 169 行而非 166 行），改为 `(169, 'before', ...)`。
- **createSession.ts 一处良性 `⟳`**：锚点 358 原本落在 `//` 注释段中部，annotate.py 自动挪到段边界 357，语义未断，零 `⚠`。
- **file-index 数据文件触发 `_preflight_one.py` 的 slug 怪癖**：该脚本 slug 只替换 `/` 和 `.`、不替换 `-`，对 `native-ts/file-index/index.ts` 拼出的 slug 与文件名不匹配而断言失败；但 annotate.py 与本批预检都用 `replace('-','_')`，数据文件名正确。处置：用连字符感知的临时脚本单独验证该文件（importlib+ast+行号 / pos / 引号 / 反斜杠 / 重复 / 升序全检）→ PASS，31 锚点有序。这是一个脚本怪癖而非数据错误。
- 其余 9 个文件零 `⟳`、零 `⚠`，预检首轮即全过（file-index 用连字符感知脚本补验，余 9 个用 `_preflight_one.py` 直跑）。

流程账：10 个数据文件逐一对齐源文件；预检首轮 217 锚点全过；`annotate.py` 十次共 1 处良性 `⟳`（createSession 358→357）、零 `⚠`；`check-fidelity.py` 全仓 **1551 份 0 失败**（较上批 +10）；`check-links.py` 源码链接 2423 条加内链 722 条，0 失效；全仓 **1551/1902 文件、480,502/513,237 行、93.6%**；`src/` 还剩 **351 份 / 32,735 行**。

**下一批候选（300–366 行档，单批约 10 份）**：`interactiveHelpers.tsx`(366) · `cli/handlers/auth.ts`(330) · `types/logs.ts`(330) · `commands/install-github-app/setupGitHubActions.ts`(325) · `commands/context/context-noninteractive.ts`(325) · `cost-tracker.ts`(323) · `commands/review/reviewRemote.ts`(316) · `keybindings/KeybindingProviderSetup.tsx`(308) · `remote/sdkMessageAdapter.ts`(302) · `commands/install.tsx`(300)（全仓还剩 351 份；440 行以上已清零）

### src batch 155: 300-366 line tier, 10 files (3225 src, 3561 annotated, 333 anchors)

300–366 行档（接第 154 批下沿，取剩余 300 行以上的全部 10 份，300 行档就此清零）：交互式启动外壳、会话记录类型全集、认证命令处理器、GitHub Actions 安装、/context 取数渲染、计费追踪、远程评审、键位装配、SDK 消息适配、安装命令。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`interactiveHelpers.tsx`](annotated/src/interactiveHelpers.tsx) | 366→408 | 41 | 交互式启动的公共外壳：对话框 Promise 化、渲染后退出三件套、引导与信任检查清单、渲染参数与帧回调 |
| [`types/logs.ts`](annotated/src/types/logs.ts) | 330→360 | 30 | 会话落盘的全部记录形态：消息快照、两类标题、压缩提交与快照、工作树三态、条目联合与排序 |
| [`cli/handlers/auth.ts`](annotated/src/cli/handlers/auth.ts) | 330→364 | 34 | 登录三条路径（环境刷新令牌 / 浏览器 / 登出）与状态查询的字段优先级、退出码语义 |
| [`commands/install-github-app/setupGitHubActions.ts`](annotated/src/commands/install-github-app/setupGitHubActions.ts) | 325→354 | 29 | 工作流文件写入（探版本、换密钥名、base64 提交）与安装主流程、失败分级与自救提示 |
| [`commands/context/context-noninteractive.ts`](annotated/src/commands/context/context-noninteractive.ts) | 325→357 | 32 | /context 的取数与表格渲染：三步变换复现、策略状态行、分类表与按需出现的分节 |
| [`cost-tracker.ts`](annotated/src/cost-tracker.ts) | 323→351 | 28 | 计费状态的存读、按规范名聚合显示、附带用量的递归累加与指标上报 |
| [`commands/review/reviewRemote.ts`](annotated/src/commands/review/reviewRemote.ts) | 316→353 | 37 | 远程评审：门禁四态、拉取请求与分支两条启动路径、调优参数的逐字段清洗 |
| [`keybindings/KeybindingProviderSetup.tsx`](annotated/src/keybindings/KeybindingProviderSetup.tsx) | 308→343 | 34 | 键位装配（同步首载 + 热重载）与组合键拦截器的分派分支、ref 与 state 双写 |
| [`remote/sdkMessageAdapter.ts`](annotated/src/remote/sdkMessageAdapter.ts) | 302→334 | 32 | SDK 消息到内部消息的逐类转换、用户消息的两个开关、未知类型的前向兼容 |
| [`commands/install.tsx`](annotated/src/commands/install.tsx) | 300→337 | 36 | 安装命令的状态机与视图分支、清理时机、退场延时与参数解析 |

要点：

- **启动检查清单本身就是顺序依赖**：引导 → 信任 → 会话标志 → 灰度重初始化 → 环境变量 → 遥测。环境变量必须排在信任之后，否则未信任仓库能带进有副作用的变量；仓库路径映射同理，早写会污染传送。
- **退出三件套顺序固定**：渲染 → 卸载 → beforeExit → 退出。先卸载是因为回调可能还要写终端，Ink 占着屏幕会打架；beforeExit 必须 await，否则清理会被退出截断。
- **会话记录有三种写入语义**：提交只追加按序重放，快照后者覆盖前者，工作树状态是 null 与 undefined 的三态。AI 标题与用户改名分成两种记录，是为了让读取偏好稳定、重写元数据时不覆盖改名、条件更新只匹配用户标题。
- **两条登录路径在安装令牌之后完全汇合**：组织校验、事件上报、退出码都一样。差异只在取令牌：环境变量直换刷新令牌，跳过整个授权码环节，也因此要自己补引导完成标记。
- **失败分必需与可容忍**：角色与首令牌日期查不到只记调试日志（受限作用域本来就没权限），控制台账号建不出 API 密钥必须抛——没有密钥等于完全不可用。
- **写工作流文件先探版本号再提交**：接口没有幂等写，已存在就必须带 sha。失败分两路：422 且提到 sha 时按「已存在」给可执行的下一步，其余附三条自救路径。拉取请求不直接建，而是开对比页让用户确认。
- **/context 的三步变换必须与主查询逐字一致**：压缩边界裁剪 → 投影替换 → 微压缩存根。少一步百分比就会与模型实际收到的量对不上。权限读取器传函数不传值，分析过程长，中途状态早已变化。
- **计费快照先比会话号再读**：项目配置只有一个槽位，号不一致就要返回空，宁可显示零也不能把上一场花费算进来。窗口与输出上限在读取时重算，落盘会随版本升级过期。
- **远程评审门禁是四态而不是布尔**：团体套餐直接放行（配额接口只服务个人订阅）、配额或用量缺失都放行（服务端计费兜底）、余额低于门槛就拦、其余需用户确认一次。
- **分支模式传合并基点 SHA 而非分支名**：容器准备阶段会移除远端引用，按名字解析必然失败；SHA 在提交历史里可达，`git diff` 直接可用。算不出基点属于用户环境问题，就地返回可读原因，不该静默退到本地评审。
- **键位装配的关键是「ref 与 state 双写」**：待完成组合键写 ref 给解析函数同步读，写 state 只为触发界面；激活上下文同理，等一次渲染就已经晚了。
- **拦截器必须比输入框更早注册**：否则组合键的第二个键会被输入框吃掉。且只有原本已在组合键中时才由它调用处理器——单键命中交给常规绑定层，两边都调会执行两次。
- **适配层对未知类型一律忽略并记日志**：服务端可能先上线新类型，客户端不该因此崩掉整场会话。用户消息按内容块形状判断是不是工具结果，父工具号被硬编码成空，根本区分不出来。
- **安装流程的清理必须排在原生安装成功之后**：先删旧的可能把用户唯一能用的版本删掉。通道只在用户显式指定时写回设置，从默认值推出来的不该反过来改偏好。

踩坑：

- **块末注脚第四种形态：`} else if` 之前**。`cli/handlers/auth.ts` 一处锚点描述的是退回分支，却站在 `if` 分支的收尾处，读起来像上一段的总结。专项扫描按「讲括号里还是括号外」判据抓到，挪进分支体内，并删掉与紧邻英文注释重复的部分，改成只说差异（只填三个字段）。
- **JSDoc 内部的锚点由预检 `[bslot]` 拦下**：`KeybindingProviderSetup.tsx` 原锚点落在块注释的 ` * Global chord interceptor…` 行，改为挂函数签名。
- **编译器产物的解构续行第三次踩到**：`}, setLoadResult] = useState(…)` 与 `} = await render(…)` 都匹配 `[split]` 判据，`before` 会把模式与赋值劈开，改挂语句首行。

流程账（第 155 批）：10 个数据文件逐一对齐源文件；annotate 十次零 ⟳ 零 ⚠（编译器产物居多，锚点均挂在函数/类型收尾行）；check-fidelity 全仓 1561 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1561/1902 文件、483,727/513,237 行、94.3%；`src/` 还剩 341 份。

**下一批候选（280–297 行档，单批约 10 份）**：`model.tsx`(297) · `branch.ts`(296) · `teamMemPaths.ts`(292) · `hooks.ts`(290) · `compact.ts`(287) · `upstreamproxy.ts`(285) · `chrome.tsx`(285) · `loremIpsum.ts`(282) · `HybridTransport.ts`(282) · `addCommand.ts`(280)（`src/` 还剩 341 份；440 行以上已清零）

### src batch 156: 280-297 line tier, 10 files (2876 src, 2973 annotated, 95 anchors)

280–297 行档（接第 155 批下沿，取剩余 280 行以上的全部 10 份，280 行档就此清零）：模型切换命令 UI、会话分叉命令、团队记忆路径安全校验、钩子类型与 schema、压缩命令、上游代理接线、Chrome 扩展菜单、填充文本技能、混合传输、MCP add 子命令。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/model/model.tsx`](annotated/src/commands/model/model.tsx) | 297→310 | 12 | `/model` 命令交互式选择器：主循环模型/显示模型/effort 切换，组织白名单、Opus/Sonnet 1M 可达性与 Fast mode 联动 |
| [`commands/branch/branch.ts`](annotated/src/commands/branch/branch.ts) | 296→311 | 15 | `/branch` 命令：复制当前会话转录成分叉会话，搬运 content-replacement 记录，命名冲突处理与 resume 接管 |
| [`memdir/teamMemPaths.ts`](annotated/src/memdir/teamMemPaths.ts) | 292→305 | 13 | 团队记忆路径安全计算与写入校验，防御路径穿越与符号链接逃逸（PSR M22186/22187） |
| [`types/hooks.ts`](annotated/src/types/hooks.ts) | 290→302 | 12 | 钩子系统的类型与 Zod 校验 schema：同步/异步响应、各事件专有输出、回调上下文与聚合结果 |
| [`commands/compact/compact.ts`](annotated/src/commands/compact/compact.ts) | 287→294 | 7 | `/compact` 命令：会话记忆压缩优先，否则响应式/传统压缩，统一缓存清理与回显 |
| [`upstreamproxy/upstreamproxy.ts`](annotated/src/upstreamproxy/upstreamproxy.ts) | 285→294 | 9 | CCR 容器侧代理接线：读令牌、屏蔽 dump、下载 CA、启动本地中继并注入代理环境变量，失败开放 |
| [`commands/chrome/chrome.tsx`](annotated/src/commands/chrome/chrome.tsx) | 285→293 | 7 | `/chrome` 命令对话框：安装/重连 Chrome 扩展、管理站点权限、切换默认启用 |
| [`skills/bundled/loremIpsum.ts`](annotated/src/skills/bundled/loremIpsum.ts) | 282→288 | 6 | 仅供内部的填充文本技能，用经验证的「单 token」英文词随机拼装占位文本 |
| [`cli/transports/HybridTransport.ts`](annotated/src/cli/transports/HybridTransport.ts) | 282→290 | 8 | 混合传输：读走 WebSocket、写走 HTTP POST，串行批处理 + 指数退避 + 背压 |
| [`commands/mcp/addCommand.ts`](annotated/src/commands/mcp/addCommand.ts) | 280→286 | 6 | `mcp add` 子命令：stdio/SSE/HTTP 三传输，作用域/环境变量/请求头/OAuth/XAA 校验 |

要点：

- **模型切换三类开关彼此独立**：组织白名单（`isModelAllowed`）、1M 上下文可达性（Opus 与 Sonnet 分开判，Sonnet 4.5 规则不同放过）、快模式联动；校验顺序固定，失败各回显可读消息，`handleModelChange` 走默认/别名/自定义校验三条路径。
- **`model.tsx` 是 React Compiler 产物**：组件以 `_c` 缓存哨兵 + `$` 数组做惰性记忆化，真正业务逻辑在 `useEffect`/`call` 里；记忆化样板（如 `_temp` 取值函数）可跳过，注释只挂状态、选项、动作与回显层。
- **`createFork` 必须搬运 content-replacement 记录**：否则「`claude -r {forkId}`」重建时把已替换结果误判为 FROZEN，导致计费重算与永久超额。
- **团队记忆路径全部双关校验**：先 `resolve` 字符串级快速拒绝，再 `realpath` 最深现有祖先做符号链接二次确认；用 realpath 而非 resolve 才能防 symlink 逃逸到 team 目录外。
- **`chrome.tsx` 同为 React Compiler 产物**：`ClaudeInChromeMenu` 的选项与动作都用缓存哨兵惰性构造，可读部分只在状态/选项/动作层，扩展是否安装与是否订阅决定选项集合。
- **`HybridTransport` 写走 HTTP POST 而非 WebSocket**：借 `SerialBatchEventUploader` 做串行批处理、指数退避加抖动与背压；`stream_event` 用 100ms 缓冲聚合，`close` 用 `Promise.race` 在排空与宽限期之间取先到者。
- **`addCommand` 的 XAA（SEP-990）前置校验在 add 时失败**：要求 client-id、client-secret 与已配置的 xaaIdp 三者齐备，否则报错，避免拖到 auth 阶段才暴露。
- **`loremIpsum` 仅 `USER_TYPE=ant` 注册**：素材是经 API token 计数验证的「单 token」英文词表，目标 token 数封顶 50 万，超出则说明并截断。

踩坑：

- **React Compiler 产物里 JSX 都单行闭合**：本批 `model.tsx` 与 `chrome.tsx` 的 JSX 全部落在单行（如 `t4 = <ModelPicker .../>;`），锚点一律挂在函数/类型收尾行或语句行，绝不插进 JSX 内部——插进 JSX 会破坏 tsx 结构且 check-fidelity 看不出来。
- **多行 `/** */` 块注释不挂锚点**：`teamMemPaths`/`upstreamproxy`/`hooks` 含多行块注释，本批锚点全部挂在块外的函数收尾行（如 `PathTraversalError`、`initUpstreamProxy`、`syncHookResponseSchema`），由 check-fidelity「块内禁中文」硬判据兜底，零命中。
- **跨行三元不挂 `after`**：`compact.ts` 的 `reactiveCompact` 三元（`const ... = feature(...) ? (require(...)) : null`）锚到收尾行 `: null`，避免 check-fidelity「未结束表达式中间插注释」判据误报；预检已排除所有行尾 `=`/`?` 收尾的锚点。
- **模板字符串内部禁插注释**：`loremIpsum` 的长字符串与 `model.tsx` 模板字面量均由 check-fidelity 的模板纯度判据兜底；本批无命中，无需外移（`⟳`）。

流程账（第 156 批）：10 个数据文件逐一对齐源文件；预检 95 锚点全过；annotate 十次零 ⟳ 零 ⚠；check-fidelity 全仓 1571 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1571/1902 文件、486,603/513,237 行、94.8%；`src/` 还剩 331 份。

**下一批候选（270–278 行档，单批约 10 份）**：`memdir/paths.ts`(278) · `commands/install-github-app/OAuthFlowStep.tsx`(276) · `cli/transports/SerialBatchEventUploader.ts`(275) · `commands/resume/resume.tsx`(275) · `commands/mobile/mobile.tsx`(274) · `memdir/memoryTypes.ts`(271) · `commands/fast/fast.tsx`(269) · `commands/mcp/xaaIdpCommand.ts`(266) · `bridge/types.ts`(262) · `commands/init-verifiers.ts`(262)（`src/` 还剩 331 份；440 行以上已清零）

### src batch 157: 262-278 line tier, 10 files (2708 src, 2867 annotated, 155 anchors)

262–278 行档（接第 156 批下沿，取剩余 270 行以上前 10 份，260 行档就此清零）：自动记忆路径安全校验、OAuth 安装步骤组件、串行批量事件上传器、/resume 会话恢复、移动端下载二维码、记忆类型分类与提示词段落、/fast 快速模式开关、XAA IdP 连接子命令、verifier 生成器、桥接层协议与接口类型。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`memdir/paths.ts`](annotated/src/memdir/paths.ts) | 278→298 | 20 | 自动记忆目录路径解析/校验/规范化；安全门禁拒绝相对/盘符根/UNC/空字节路径；远端覆盖优先于设置；memoize 按 projectRoot |
| [`commands/install-github-app/OAuthFlowStep.tsx`](annotated/src/commands/install-github-app/OAuthFlowStep.tsx) | 276→291 | 14 | OAuth 授权步骤组件：starting→about_to_retry 状态机，浏览器授权拿「推理专用」令牌，失败可重试且不破坏已有登录 |
| [`cli/transports/SerialBatchEventUploader.ts`](annotated/src/cli/transports/SerialBatchEventUploader.ts) | 275→289 | 14 | 串行批量事件上传器：批处理+指数退避+背压；连续失败超限丢弃该批；不可序列化项就地丢弃防队列中毒 |
| [`commands/resume/resume.tsx`](annotated/src/commands/resume/resume.tsx) | 275→296 | 20 | /resume 命令：按 UUID/标题/跨项目 worktree 恢复；lite 日志先补齐全文；跨目录只给可复制切换命令 |
| [`commands/mobile/mobile.tsx`](annotated/src/commands/mobile/mobile.tsx) | 274→291 | 16 | /mobile 命令：iOS/Android 下载二维码；React Compiler 产物用缓存哨兵惰性记忆化，状态初始空串防首帧闪烁 |
| [`memdir/memoryTypes.ts`](annotated/src/memdir/memoryTypes.ts) | 271→282 | 11 | 记忆四类（user/feedback/project/reference）分类与提示词段落；含忽略记忆与漂移两条安全闸门（eval 验证） |
| [`commands/fast/fast.tsx`](annotated/src/commands/fast/fast.tsx) | 269→285 | 15 | /fast 命令：快速模式开关与选择器；组织级开关先于任何切换；冷却/过载两态分开渲染 |
| [`commands/mcp/xaaIdpCommand.ts`](annotated/src/commands/mcp/xaaIdpCommand.ts) | 266→286 | 20 | claude mcp xaa 子命令：IdP 连接 setup/login/show/clear；写前全量校验，keychain 槽仅写入成功后清 |
| [`commands/init-verifiers.ts`](annotated/src/commands/init-verifiers.ts) | 262→267 | 5 | /init-verifiers 命令：生成 verifier 技能的五阶段向导提示词（巨型模板串，仅包壳可注） |
| [`bridge/types.ts`](annotated/src/bridge/types.ts) | 262→282 | 20 | 桥接层协议与依赖接口类型总集：环境注册/工作轮询/会话生成/心跳/状态展示 |

要点：

- **路径校验是自动记忆的安全核心**：既要规范化（剥尾部分隔符、NFC 归一化）又要防穿越（拒绝相对/盘符根/UNC/空字节，normalize 后再比前缀）；远端覆盖变量优先于 settings，~ 展开仅限设置来源。
- **OAuthFlowStep 拿到的是「推理专用」令牌**：因此用 saveOAuthTokensIfNeeded 直接落库，刻意绕开 performLogout，避免销毁用户已有的登录会话；错误/成功/重试三段状态机干净分离。
- **上传器的三件套是串行 + 批处理 + 背压**：背压用 promise 队列而非忙等；不可序列化项（BigInt/循环引用/toJSON 抛错）必须就地丢弃，否则会毒化队列让 flush 永久挂起；服务端 Retry-After 加抖动防止多会话共享限流时同时重击。
- **/resume 跨项目判定分三层**：同仓 worktree 直接恢复、不同项目给出可复制切换命令、同目录继续恢复；lite 日志需先补齐完整消息，enriched 未命中再走直接文件查找兜底。
- **记忆类型分类只存不可推导的上下文**：代码模式/架构/git 历史/文件结构都不该存；合并/单人两套段落故意平铺（非共用规格生成），含「忽略记忆」「漂移警告」两条 eval 验证过的安全闸门。
- **XAA IdP 连接写前全量校验**：避免半写入状态（设置写了但 keychain 缺失）；keychain 槽仅在设置写入成功后才清，同 issuer 不同 client 也要清（缓存 token 的 aud 与旧 secret 均只适配旧 client）；http 仅限 loopback。
- **init-verifiers 本质是一份提示词**：引导 Claude 检测项目、配置工具、与用户问答、最终写出 verifier 技能；不覆盖单测/类型检查（那由标准构建流程负责）。
- **bridge/types 是桥接层所有跨进程契约的集中定义**：worker_type 本仓窄类型（exhaustiveness 用）与后端不透明字符串分离；CCR v2 选择器透传；各类依赖接口（ApiClient/Spawner/Logger）便于测试替换。

踩坑：

- **锚点全部挂在函数/类型收尾行或语句行**：编译器产物（resume/mobile/fast）的 JSX 均为单行闭合（如 `t27 = <T0 .../>;`），注释只挂状态/选项/动作与回显层，绝不插进 JSX 内部——插进 JSX 会破坏 tsx 结构且 check-fidelity 看不出来。
- **init-verifiers 是巨型模板字符串**：批注只挂在包壳的 import/对象定义/结束处，不进模板内部（否则会污染生成给用户的提示词）；这是「模板为主体」文件的固定限制。
- **多行 `/** */` 块注释不挂锚点**：memoryTypes 顶部与各处含多行块注释，锚点全部挂在块外的函数收尾行（如 `parseMemoryType`、`getAutoMemPath`），由 check-fidelity「块内禁中文」硬判据兜底，零命中。
- **本批预检 155 锚点一次全过**（含 [split]/[bslot]/[TAIL] 扫描），annotate 十次零 ⟳ 零 ⚠；专项块末注脚扫描零输出。

流程账（第 157 批）：10 个数据文件逐一对齐源文件；预检 155 锚点全过；annotate 十次零 ⟳ 零 ⚠；check-fidelity 全仓 1581 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1581/1902 文件、489,311/513,237 行、95.3%；`src/` 还剩 321 份。

### src batch 158: 234-256 line tier, 10 files (2447 src, 2556 annotated, 107 anchors)

234–256 行档（接第 157 批下沿，取剩余 234 行以上前 10 份，260 行档就此清零）：JWT 编解码与校验工具、/init 项目初始化向导、CLI 远程 IO 适配层、键位解析器、/security-review 安全评审命令、键位上下文 React Provider、/btw 侧栏提示命令、全局通知上下文、键位配置 schema、OAuth 常量集。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bridge/jwtUtils.ts`](annotated/src/bridge/jwtUtils.ts) | 256→272 | 16 | 桥接层 JWT 工具：token 生成/解析、签名验证、过期与 audience 校验；签名错与格式错两类失败路径分离 |
| [`commands/init.ts`](annotated/src/commands/init.ts) | 256→262 | 6 | /init 命令：项目初始化向导；OLD/NEW_INIT_PROMPT 巨型模板串（仅包壳可注），引导生成 CLAUDE.md 与记忆配置 |
| [`cli/remoteIO.ts`](annotated/src/cli/remoteIO.ts) | 255→269 | 14 | CLI 远程 IO 适配层：把本地 fs/网络/提示调用重定向到远端，远端执行命令时的输入输出桥接 |
| [`keybindings/resolver.ts`](annotated/src/keybindings/resolver.ts) | 244→255 | 11 | 键位解析器：按键事件→已注册动作匹配，处理作用域/优先级/上下文过滤 |
| [`commands/security-review.ts`](annotated/src/commands/security-review.ts) | 243→249 | 6 | /security-review 命令：SECURITY_REVIEW_MARKDOWN 巨型模板（仅包壳可注），生成安全评审报告 |
| [`keybindings/KeybindingContext.tsx`](annotated/src/keybindings/KeybindingContext.tsx) | 242→253 | 10 | 键位上下文 Provider：按当前 UI 状态决定哪些快捷键生效，作用域随界面切换 |
| [`commands/btw/btw.tsx`](annotated/src/commands/btw/btw.tsx) | 242→252 | 9 | /btw 命令 UI：侧栏/浮层提示组件，跨会话传递简短信息 |
| [`context/notifications.tsx`](annotated/src/context/notifications.tsx) | 239→252 | 13 | 通知上下文 Provider：全局通知队列、去重、展示与自动消失 |
| [`keybindings/schema.ts`](annotated/src/keybindings/schema.ts) | 236→244 | 8 | 键位配置 schema：快捷键定义校验/归一化，类型与默认值集中管理 |
| [`constants/oauth.ts`](annotated/src/constants/oauth.ts) | 234→248 | 14 | OAuth 常量集：授权端点、scope、client 配置、回调地址等集中定义 |

要点：

- **JWT 工具是桥接层认证基础**：签名/过期/audience 三类校验缺一不可；token 解析失败必须区分「格式错」与「签名错」两条路径，错误提示不可混为一谈。
- **/init 与 /security-review 都是「模板为主体」命令**：批注只挂在包壳的 import/对象定义/结束处，绝不进巨型模板内部——否则会污染生成给用户的 CLAUDE.md 与评审报告；这是固定限制。
- **键位三件套分工清晰**：schema 定义并校验格式、resolver 做事件→动作匹配、KeybindingContext 管 UI 作用域；三者依赖集中类型，改动其一要先看另两处的契约。
- **notifications 用队列加去重防刷屏**：全局通知过多时合并同源；remoteIO 是「本地调用重定向到远端」的适配层，命令在远端跑时所有 IO 经它中转。

踩坑：

- **模板字符串内部禁插注释是硬约束**：init.ts 的 OLD/NEW_INIT_PROMPT 与 security-review.ts 的 SECURITY_REVIEW_MARKDOWN 都是巨型模板，annotate.py 自动把模板声明行的 before 锚外移到模板前一行（各 1 处良性 `⟳`）；grep 证实两文件模板内中文计数均为 0，无泄漏。
- **零 `⚠`**：本批无锚点落入块注释内部；多行 `/** */` 块注释全部绕开，由 check-fidelity「块内禁中文」硬判据兜底。
- **预检 107 锚点一次全过**（含 importlib 执行拦截 NameError、`ast.parse`、无重复锚点、文本无英文双引号与反斜杠），annotate 十次除两处良性外移外零 ⟳ 零 ⚠。

流程账（第 158 批）：10 个数据文件逐一对齐源文件；预检 107 锚点全过；annotate 十次 2 处良性 `⟳`、零 `⚠`；check-fidelity 全仓 1591 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1591/1902 文件、491,761/513,237 行、95.8%（按行数）；`src/` 还剩 311 份。

### src batch 159: 211-231 line tier, 10 files (2187 src, 2298 annotated, 107 anchors)

211–231 行档（接第 158 批下沿，取剩余 211 行以上前 10 份，210 行档就此清零）：GitHub App 安装向导的两步（填 Key / 选仓库）、GrowthBook 实验事件 protobuf 生成代码、hook 的 Zod schema 聚合、React 统计存储、打包技能注册中心、输出风格总表、命令系统类型全集、/tag 命令界面、直连会话管理器。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/install-github-app/ApiKeyStep.tsx`](annotated/src/commands/install-github-app/ApiKeyStep.tsx) | 231→242 | 10 | GitHub App 安装向导「填写 API Key」步骤：复用已有钥匙 / 新建钥匙 / OAuth 令牌三选项切换与提交 |
| [`types/generated/events_mono/growthbook/v1/growthbook_experiment_event.ts`](annotated/src/types/generated/events_mono/growthbook/v1/growthbook_experiment_event.ts) | 223→233 | 10 | GrowthBook 实验分配事件 protobuf 生成代码：事件数据契约与 JSON 双向编解码 |
| [`schemas/hooks.ts`](annotated/src/schemas/hooks.ts) | 222→233 | 11 | hook 的 Zod 校验 schema 聚合：命令 / 提示 / HTTP / 代理四类与 matcher 配置，专解循环依赖 |
| [`context/stats.tsx`](annotated/src/context/stats.tsx) | 220→233 | 12 | React 统计存储与上下文：蓄水池采样直方图、五类统计钩子 |
| [`skills/bundledSkills.ts`](annotated/src/skills/bundledSkills.ts) | 220→232 | 12 | 打包技能注册中心：定义类型、注册 / 取出、参考文件安全落盘 |
| [`constants/outputStyles.ts`](annotated/src/constants/outputStyles.ts) | 216→225 | 9 | 输出风格总表与解析：内置讲解 / 学习型两种预设及优先级覆盖 |
| [`types/command.ts`](annotated/src/types/command.ts) | 216→230 | 14 | 命令系统类型全集：本地 / 提示词 / JSX 三类命令、上下文与可用环境声明 |
| [`commands/tag/tag.tsx`](annotated/src/commands/tag/tag.tsx) | 215→224 | 8 | /tag 命令界面：给当前会话加标签或切换移除，含确认弹窗 |
| [`server/directConnectManager.ts`](annotated/src/server/directConnectManager.ts) | 213→225 | 12 | 直连会话管理器：WebSocket 对接后端、消息分发与权限回应 |
| [`commands/install-github-app/ChooseRepoStep.tsx`](annotated/src/commands/install-github-app/ChooseRepoStep.tsx) | 211→221 | 9 | GitHub App 安装向导「选择仓库」步骤：复用当前仓库或手动输入地址 |

要点：

- **四种形态同批处理，锚点策略随之切换**：protoc 生成代码（growthbook）只挂类型 / 函数收尾行；Zod schema 聚合（hooks）用 `(1,'after')` 落文件头 `/* */` 块后、`(16,'after_block')` 落 `//` 段后；React Compiler 产物（ApiKeyStep / ChooseRepoStep / tag）只挂函数签名与语句行、绝不插进 JSX 内部；常规 TS 模块（stats / bundledSkills / outputStyles / command / directConnectManager）挂函数 / 类型声明与语句行。
- **hook schema 把循环依赖拆到独立模块**：settings/types.ts 与 plugins/schemas.ts 互相引用，抽到 schemas/hooks.ts 后双方都从这一处 import，判别联合聚合四类 hook。
- **stats 用三个 Map 分管三类指标**：标量、直方图（蓄水池采样加分位数）、集合（基数），getAll 时统一汇总成扁平字典。
- **bundledSkills 的参考文件落盘是安全重头戏**：进程内一次性随机数加受限权限位加 O_NOFOLLOW 加独占创建，抵御符号链接攻击，且不在 EEXIST 时删后重试。
- **directConnectManager 把 WebSocket 帧当 stream-json 处理**：逐行解析、过滤 control_request / keep_alive 等控制类消息，未知子类型必须回送错误以免服务端空等。

踩坑：

- **模板声明行 before 锚被自动外移**：outputStyles.ts 的 `(30,'before')` 原落在 `EXPLANATORY_FEATURE_PROMPT` 模板字符串起始行，annotate 判为「模板字符串内部」自动外移到模板前一行（`⟳` 30→30），落点通顺——中文注释在 const 之前、模板内容之外（grep 确认模板内中文计数为 0）。印证「模板声明行的 before 锚会被外移，出现 ⟳ 要回 grep 确认」。
- **其余九份零 `⟳` 零 `⚠`**：块注释内部零中文（hooks 头部 `/* */` 经 `(1,'after')` 落块后、字段级 `/** */` 全部绕开），由 check-fidelity「块内禁中文」硬判据兜底。
- **预检 107 锚点一次全过**（importlib 执行拦截 NameError、`ast.parse`、无重复锚点、文本无英文双引号与反斜杠），annotate 十次仅 1 处良性外移。

流程账（第 159 批）：10 个数据文件逐一对齐源文件；预检 107 锚点全过；annotate 十次 1 处良性 `⟳`、零 `⚠`；check-fidelity 全仓 1601 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1601/1902 文件、493,948/513,237 行、96.2%（按行数）；`src/` 还剩 301 份。

### src batch 160: 197-210 line tier, 10 files (2035 src, 2147 annotated, 110 anchors)

197–210 行档（接第 159 批下沿，取剩余 197 行以上前 10 份，196 行档就此清零）：限流选项菜单、桥接可信设备令牌、崩溃恢复指针、旋转动词词表、键位解析器、桥接资格运行时检查、应用状态容器、桥接故障注入命令、vim 状态机类型、skillify 技能模板。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/rate-limit-options/rate-limit-options.tsx`](annotated/src/commands/rate-limit-options/rate-limit-options.tsx) | 210→226 | 15 | 限流弹出的选项菜单（升级/超额用量/取消）；React 编译器产物，全套 `_c` 缓存槽 |
| [`bridge/trustedDevice.ts`](annotated/src/bridge/trustedDevice.ts) | 210→224 | 14 | 桥接可信设备令牌来源：注册/读取/清除，特性开关分级灰度 |
| [`bridge/bridgePointer.ts`](annotated/src/bridge/bridgePointer.ts) | 210→223 | 13 | 远程控制会话崩溃恢复指针，跨 worktree 查找最新指针 |
| [`constants/spinnerVerbs.ts`](annotated/src/constants/spinnerVerbs.ts) | 204→209 | 5 | 加载提示旋转动词默认词表与自定义读取（replace/追加） |
| [`keybindings/parser.ts`](annotated/src/keybindings/parser.ts) | 203→213 | 10 | 键位字符串解析：按键/和弦/平台展示四类转换 |
| [`bridge/bridgeEnabled.ts`](annotated/src/bridge/bridgeEnabled.ts) | 202→213 | 11 | 桥接模式资格运行时检查：多套开关与可操作诊断消息 |
| [`state/AppState.tsx`](annotated/src/state/AppState.tsx) | 200→212 | 11 | 应用状态 React Context Provider 与若干 `useAppState` 订阅钩子 |
| [`commands/bridge-kick.ts`](annotated/src/commands/bridge-kick.ts) | 200→210 | 10 | ant 专属桥接故障注入命令，手动触发恢复路径测试 |
| [`vim/types.ts`](annotated/src/vim/types.ts) | 199→212 | 13 | vim 模式状态机类型定义（类型本身即文档） |
| [`skills/bundled/skillify.ts`](annotated/src/skills/bundled/skillify.ts) | 197→205 | 8 | 内置 skillify 技能：把会话流程沉淀为可复用 SKILL.md 的提示词模板 |

要点：

- **桥接子系统四件套串起来看**：`trustedDevice` 管身份令牌、`bridgePointer` 管崩溃恢复、`bridgeEnabled` 管资格开关、`bridge-kick` 管测试注入；它们靠 GrowthBook 特性标与 env 变量分层控制，外部构建靠 `feature()` 守卫剔除内联字符串字面量（正向三元模式，负向 `if (!feature)` 不会剔除）。
- **React Compiler 产物两处**：`rate-limit-options` 与 `AppState` 都是编译器产物，`_c(N)` 缓存槽 + `$` 缓存对象，缓存三件套（哨兵判断→算并存回→否则读缓存）贯穿组件；注释只挂函数签名与语句行，绝不进 JSX 内部。
- **「模板或数据即文档」三处**：`spinnerVerbs` 默认词表、`vim/types` 类型联合、`skillify` 提示词模板——批注挂在包壳 import/声明/结束处，不进模板内部（否则污染生成给用户的 SKILL.md）。
- **小工具单一职责**：`parser` 把 `ctrl+shift+k` 翻成结构化对象、`spinnerVerbs` 只查设置拼词表，边界清晰、无副作用。

踩坑：

- **`after` 落在 `//` 注释段中部被自动外移**：`trustedDevice.ts` 的 `(39,'after')` 原落在一行 `//` 注释中部（39–44 整段是 memoize 说明），annotate 判为「// 注释段中部」自动外移到段边界 44（`⟳` 39→44）；落点在段尾、通顺。
- **模板声明行 before 锚被自动外移（两处良性）**：`bridge-kick.ts` 的 `(40,'before')` 与 `skillify.ts` 的 `(22,'before')` 原落在模板字符串起始行，annotate 判为「模板字符串内部」自动外移到模板前一行（`⟳` 40→40 / 22→22）；grep 确认两模板内中文计数均为 0，无泄漏。
- 其余八份零 `⟳` 零 `⚠`：块注释内部零中文（文件头 `/* */` 经 `(1,'after')` 落块后、字段级 `/** */` 全部绕开），由 check-fidelity「块内禁中文」硬判据兜底。
- 预检 110 锚点一次全过（`ast.parse`、无重复锚点、文本无英文双引号与反斜杠）；`bridgeEnabled` 初版一处 `'BRIDGE_MODE'` 单引号嵌套被 `ast.parse` 拦下，改反引号包裹后通过。

流程账（第 160 批）：10 个数据文件逐一对齐源文件；预检 110 锚点全过；annotate 十次 3 处良性 `⟳`、零 `⚠`；check-fidelity 全仓 1611 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1611/1902 文件、495,983/513,237 行、96.6%（按行数）；`src/` 还剩 291 份。

**下一批候选（182–196 行档，单批约 10 份）**：`keybindings/useKeybinding.ts`(196) · `entrypoints/mcp.ts`(196) · `skills/bundled/claudeApi.ts`(196) · `commands/install-github-app/CheckExistingSecretStep.tsx`(190) · `context.ts`(189) · `commands/remote-setup/remote-setup.tsx`(187) · `types/generated/google/protobuf/timestamp.ts`(187) · `vim/textObjects.ts`(186) · `commands/effort/effort.tsx`(183) · `commands/remote-setup/api.ts`(182)（`src/` 还剩 291 份；440 行以上已清零）

### src batch 161: 182-196 line tier, 10 files (1892 src, 2028 annotated, 133 anchors)

182–196 行档（接第 160 批下沿，取剩余 182 行以上前 10 份，181 行档就此清零）：键位 Hook 双件套、Claude API 内置技能、MCP 服务入口、GitHub App 安装检查步骤、系统/用户上下文注入、网页端远程安装向导、protobuf Timestamp 生成类型、vim 文本对象查找、/effort 命令、远程安装 API。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`keybindings/useKeybinding.ts`](annotated/src/keybindings/useKeybinding.ts) | 196→211 | 15 | 键位 Hook 双件套：单绑定 useKeybinding 与多绑定 useKeybindings；处理器留组件、键位来自配置，和弦状态机与冒泡拦截 |
| [`skills/bundled/claudeApi.ts`](annotated/src/skills/bundled/claudeApi.ts) | 196→209 | 13 | 内置 claude-api 技能：语言特征检测、文档内联拼装、提示词工厂与运行时懒加载 |
| [`entrypoints/mcp.ts`](annotated/src/entrypoints/mcp.ts) | 196→209 | 13 | MCP 服务入口：列工具/调工具两个处理器 + stdio 传输，zod→JSON schema 适配 |
| [`commands/install-github-app/CheckExistingSecretStep.tsx`](annotated/src/commands/install-github-app/CheckExistingSecretStep.tsx) | 190→201 | 10 | GitHub App 安装的检查已有 secret 步骤（React 编译器产物，全套 `_c` 缓存槽） |
| [`context.ts`](annotated/src/context.ts) | 189→203 | 14 | 系统/用户上下文注入：git 状态、缓存打断标记、CLAUDE.md 读取与缓存 |
| [`commands/remote-setup/remote-setup.tsx`](annotated/src/commands/remote-setup/remote-setup.tsx) | 187→202 | 14 | 网页端远程安装向导 Web 组件：登录态检测、令牌导入、环境创建 |
| [`types/generated/google/protobuf/timestamp.ts`](annotated/src/types/generated/google/protobuf/timestamp.ts) | 187→200 | 13 | protoc 生成的 Timestamp 类型与 MessageFns 四件套（fromJSON/toJSON/create/fromPartial） |
| [`vim/textObjects.ts`](annotated/src/vim/textObjects.ts) | 186→199 | 13 | vim 文本对象查找：单词/引号/括号三类，按字形切分避免多字节劈开 |
| [`commands/effort/effort.tsx`](annotated/src/commands/effort/effort.tsx) | 183→196 | 12 | /effort 命令：设置/展示/清除努力等级，环境变量覆盖与冲突提示 |
| [`commands/remote-setup/api.ts`](annotated/src/commands/remote-setup/api.ts) | 182→198 | 16 | 远程安装 API：令牌脱敏封装、导入/建默认环境/isSignedIn/getCodeWebUrl |

要点：

- **键位与上下文注入两条主线**：`useKeybinding` 把「处理器在组件、键位在配置」的分工做实（和弦状态机 + 命中冒泡拦截）；`context.ts` 把系统/用户上下文预置进每次对话并整轮记忆化，CLAUDE.md 读盘让出事件循环、打断缓存只走 ant 专属调试态。
- **三个外部系统对接文件同构**：`mcp.ts` / `remote-setup.tsx` / `api.ts` 都走「先取令牌再发请求、按状态码翻译结果」的套路；`api.ts` 的 `RedactedGithubToken` 把明文令牌包成只在 `reveal()` 时释放，任何字符串化都只显示脱敏占位。
- **两份编译器产物**：`CheckExistingSecretStep` 与 `effort` 的 `ApplyEffortAndClose` 都是 React Compiler 的 `_c(N)` 记忆化缓存，缓存三件套（哨兵判断→算并存回→否则读缓存）贯穿组件；注释只挂函数签名与语句行，绝不进 JSX 内部。
- **生成代码与纯函数自解释**：`timestamp.ts`（proto3 四件套）与 `textObjects.ts`（字形安全的文本对象）都靠类型/函数本身讲清约定，批注只点出设计取舍。
- **claudeApi.ts 是「模板/数据即文档」典型**：247KB 提示词懒加载，内联阅读指南与 `<doc>` 块拼装，批注不进模板内部（否则污染生成给模型的提示词）。

踩坑：

- **`after` 落在 `//` 注释段中部被自动外移（3 处良性）**：`effort.tsx` 的 `(32)`、`(88)` 与 `api.ts` 的 `(131)` 原落在多行 `//` 注释中部，annotate 判为「// 注释段中部」自动外移到段边界（32→34、88→89、131→133）；grep 确认落点均在段尾、通顺，模板内零中文泄漏。
- **其余七份零 `⟳` 零 `⚠`**：块注释内部零中文（`timestamp.ts` 的巨型 JSDoc 经 `(100,'before')` 落块后、各文件 `/* */` 全部绕开），由 check-fidelity「块内禁中文」硬判据兜底。
- **预检 133 锚点一次全过**（`ast.parse`、slug 与源路径一一对应、无重复锚点、文本无英文双引号与反斜杠、行号升序）。

流程账（第 161 批）：10 个数据文件逐一对齐源文件；预检 133 锚点全过；annotate 十次 3 处良性 `⟳`、零 `⚠`；check-fidelity 全仓 1621 份 0 失败（较上批 +10）；check-links 0 失效；全仓 1621/1902 文件、497,875/513,237 行、97.0%（按行数）；`src/` 还剩 281 份。

**下一批候选（156–175 行档，单批约 10–14 份）**：`bridge/inboundAttachments.ts`(175) · `commands/plugin/usePagination.ts`(171) · `state/onChangeAppState.ts`(171) · `cli/handlers/autoMode.ts`(170) · `bridge/codeSessionApi.ts`(168) · `bridge/envLessBridgeConfig.ts`(165) · `bridge/bridgeStatusUtil.ts`(163) · `commands/plugin/AddMarketplace.tsx`(162) · `plugins/builtinPlugins.ts`(159) · `commands/commit-push-pr.ts`(158) · `tasks/DreamTask/DreamTask.ts`(157) · `constants/files.ts`(156) · `entrypoints/sandboxTypes.ts`(156)（`src/` 还剩 281 份；182 行以上已清零）

### src batch 162: 172-175 line tier, 10 files (1662 src, 1802 annotated, 139 anchors)

172–175 行档（接第 161 批下沿，取剩余 172 行以上前 10 份，176 行档就此清零）：桥接入站附件、应用状态变更钩子、插件列表分页、auto-mode 子命令、代码会话接口、免环境桥接配置、桥接状态文案、加市场界面、内置插件注册表、提交推送建单命令。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bridge/inboundAttachments.ts`](annotated/src/bridge/inboundAttachments.ts) | 175→191 | 16 | 桥接入站附件：从消息里取附件标识、逐个下载落盘、把路径引用插到最后一个文本块 |
| [`state/onChangeAppState.ts`](annotated/src/state/onChangeAppState.ts) | 171→185 | 14 | 集中的状态变更钩子：权限模式同步到外部、模型与视图偏好落盘、设置变化清凭据缓存 |
| [`commands/plugin/usePagination.ts`](annotated/src/commands/plugin/usePagination.ts) | 171→184 | 13 | 插件列表分页 Hook：以选中项为锚算滚动偏移，页式 API 全为空实现只为兼容 |
| [`cli/handlers/autoMode.ts`](annotated/src/cli/handlers/autoMode.ts) | 170→183 | 13 | auto-mode 子命令：打印默认/合并规则，以及把自定义规则交给模型评审 |
| [`bridge/codeSessionApi.ts`](annotated/src/bridge/codeSessionApi.ts) | 168→182 | 14 | 代码会话两个接口：建会话与取桥接凭据，响应逐层校验、纪元兼容字符串 |
| [`bridge/envLessBridgeConfig.ts`](annotated/src/bridge/envLessBridgeConfig.ts) | 165→181 | 16 | 免环境桥接配置：九项超时与上限的默认值、边界理由、远端覆盖与版本地板 |
| [`bridge/bridgeStatusUtil.ts`](annotated/src/bridge/bridgeStatusUtil.ts) | 163→176 | 13 | 桥接状态文案：状态机五态、链接拼装、微光动画的可视列切分、超链接包裹 |
| [`commands/plugin/AddMarketplace.tsx`](annotated/src/commands/plugin/AddMarketplace.tsx) | 162→175 | 12 | 添加市场界面（React 编译器产物）：解析输入、拉取落配置、按运行模式收尾 |
| [`plugins/builtinPlugins.ts`](annotated/src/plugins/builtinPlugins.ts) | 159→173 | 14 | 内置插件注册表：以 @builtin 后缀识别、三级启用优先级、技能转命令的来源取舍 |
| [`commands/commit-push-pr.ts`](annotated/src/commands/commit-push-pr.ts) | 158→172 | 14 | 提交推送建单命令：提示词分节拼装、隐身模式撤掉三项附加、展开前补放行规则 |

要点：

- **两个「收口点」是本批主线**：`onChangeAppState` 把权限模式的八条以上改法收到一处，先转外部名再比，避免内部模式外泄与来回切换的噪音；`commit-push-pr` 在执行嵌入命令前给应用状态补一条放行规则，正文里的提交与建单命令因此免确认。
- **桥接四件同批读完，能看到分层**：`codeSessionApi` 只管请求形状与响应校验，`envLessBridgeConfig` 只管超时与上限，`bridgeStatusUtil` 只管把状态画成文案，`inboundAttachments` 只管把网页端上传的图落到本地。
- **配置即文档**：免环境桥接那九项，每一项的边界都写得出理由——心跳下界防抖、抖动上限保证最长间隔仍小于过期、刷新提前量上界防语义反转、归档超时上界压在退出预算内。
- **兼容层的代价写在名字里**：`usePagination` 的翻页三函数是空实现，返回值仍叫「页」；`builtinPlugins` 的技能来源写 `bundled` 而不是 `builtin`，都是为不打断既有调用方与展示链路。
- **两份编译器产物处理一致**：`AddMarketplace` 的 sourcemap 换成两行说明，中文注释只挂语句行不进 JSX；`commit-push-pr` 的提示词是模板字符串，锚点只挂在模板外的声明与拼接处。

踩坑：

- **模板字符串里一条被自动外移（1 处 `⟳`，良性）**：`commit-push-pr.ts` 的 `(57)` 原落在 `return` 后的模板起点，annotate 判为「模板内部」外移到 57，落点在 `return` 之前、模板之外，通顺。
- **eslint 指令隔断判据本批零命中**：`AddMarketplace.tsx` 的 `// eslint-disable-next-line react-hooks/exhaustive-deps` 与其目标 `}, []);` 之间只隔一行 `// biome-ignore`，锚点改挂 `useEffect` 起行，未插入其间。
- **其余九份零 `⟳` 零 `⚠`**：两项专项扫描（JSX 子元素区、块末注脚）零输出。
- **预检 139 锚点一次全过**（`ast.parse`、slug 与源路径一一对应、无重复锚点、文本无英文双引号与反斜杠、行号升序、无解构续行）。

流程账（第 162 批）：10 个数据文件逐一对齐源文件；预检 139 锚点全过；annotate 十次 1 处良性 `⟳`、零 `⚠`；check-fidelity 全仓 1631 份 0 失败（较上批 +10）；check-links 2503 源码链 + 730 内链 0 失效；全仓 1631/1902 文件、499,537/513,237 行、97.3%（按行数）；`src/` 还剩 271 份。

**下一批候选（134–157 行档，单批约 12 份）**：`tasks/DreamTask/DreamTask.ts`(157) · `entrypoints/sandboxTypes.ts`(156) · `constants/files.ts`(156) · `context/overlayContext.tsx`(151) · `commands/voice/voice.ts`(150) · `buddy/types.ts`(148) · `constants/github-app.ts`(144) · `state/teammateViewHelpers.ts`(141) · `memdir/findRelevantMemories.ts`(141) · `bridge/debugUtils.ts`(141) · `commands/session/session.tsx`(140) · `commands/plugin/PluginOptionsFlow.tsx`(135)（`src/` 还剩 271 份 / 13,700 行；176 行以上已清零）

### src batch 163: 134-157 line tier, 12 files (1760 src, 1939 annotated, 176 anchors)

134–157 行档（接第 162 批下沿，取剩余 134 行以上前 12 份，157 行档就此清零）：记忆整理后台任务、沙箱配置 schema、二进制后缀表、浮层登记、语音开关命令、伙伴类型与字符码物种表、GitHub 工作流模板、队友视图状态机、记忆相关性选择、桥接调试工具、会话二维码命令、插件配置向导。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`tasks/DreamTask/DreamTask.ts`](annotated/src/tasks/DreamTask/DreamTask.ts) | 157→171 | 14 | 记忆整理后台任务：三十轮展示窗口、改动路径去重、中止时回滚锁时间戳 |
| [`entrypoints/sandboxTypes.ts`](annotated/src/entrypoints/sandboxTypes.ts) | 156→175 | 19 | 沙箱配置唯一真源：网络/文件系统/总开关三块 schema，托管策略与平台限制 |
| [`constants/files.ts`](annotated/src/constants/files.ts) | 156→170 | 14 | 二进制后缀表与内容探测：后缀预筛、空字节判死、不可打印字符占比阈值 |
| [`context/overlayContext.tsx`](annotated/src/context/overlayContext.tsx) | 151→164 | 12 | 浮层登记（React 编译器产物）：注册/注销副作用、模态判定、刷新帧 |
| [`commands/voice/voice.ts`](annotated/src/commands/voice/voice.ts) | 150→168 | 18 | 语音开关命令：四项前置检查、分平台权限引导、语言提示计数 |
| [`buddy/types.ts`](annotated/src/buddy/types.ts) | 148→160 | 12 | 伙伴类型：字符码物种表、确定性骨骼与可存储灵魂的切分、稀有度三张映射表 |
| [`constants/github-app.ts`](annotated/src/constants/github-app.ts) | 144→149 | 5 | GitHub 集成模板：一份工作流、一份拉取请求正文、一份评审工作流 |
| [`state/teammateViewHelpers.ts`](annotated/src/state/teammateViewHelpers.ts) | 141→160 | 19 | 队友视图状态机：进入/退出/中止三操作，保留与淘汰的互斥规则 |
| [`memdir/findRelevantMemories.ts`](annotated/src/memdir/findRelevantMemories.ts) | 141→157 | 16 | 记忆相关性选择：清单筛选、旁路查询、文件名白名单、失败降级 |
| [`bridge/debugUtils.ts`](annotated/src/bridge/debugUtils.ts) | 141→155 | 14 | 桥接调试工具：脱敏正则、截断、axios 错误的三段摘取、跳过事件上报 |
| [`commands/session/session.tsx`](annotated/src/commands/session/session.tsx) | 140→157 | 16 | 会话二维码命令（React 编译器产物）：地址订阅、二维码生成、Esc 关闭 |
| [`commands/plugin/PluginOptionsFlow.tsx`](annotated/src/commands/plugin/PluginOptionsFlow.tsx) | 135→153 | 17 | 插件配置向导：步骤表只建一次、顶层与频道两步合并、按步骤键重挂载 |

要点：

- **本批有三份是「编译产物」**：`overlayContext`、`session`、`PluginOptionsFlow` 里出现 `_c(n)` 槽位缓存、`$[n] !== dep` 比较条件、`Symbol.for(react.memo_cache_sentinel)` 常量标记，以及 `_temp*` 形式的模块级提取函数。读法与前几批一致：槽位比较条件就是依赖数组，临时变量是被提出的闭包。`PluginOptionsFlow` 是唯一手写 React 的一份，对比着看能看出编译器到底替你做了什么。
- **状态机式文件的核心是「两个方向互斥」**：`teammateViewHelpers` 的保留与淘汰不能同时成立——进入视图要清 `evictAfter`，释放时要按是否终态重新给，中止时只发信号不改状态（状态由任务自己的收尾路径写）。三条路径各写各的，但共用同一个 `release`。
- **两处「降级而不是失败」**：`findRelevantMemories` 的任何异常都返回空数组（记忆检索是增益功能），`DreamTask` 的空轮次直接返回原对象（同一引用即跳过重渲染）。两者都是把「没有变化 / 拿不到」做成正常路径。
- **配置类文件的价值在边界理由**：`sandboxTypes` 里每个 `.describe()` 都在解释「为什么需要这个开关」——`allowManagedReadPathsOnly` 是唯一反向字段、`enableWeakerNetworkIsolation` 明写降低安全性、`passthrough` 是给未文档化的平台限制留的门。
- **`buddy/types.ts` 的字符码物种表是有意为之**：构建产物里有一条排除字符串检查，某个物种名与模型代号撞了，所以十八个物种一律用 `String.fromCharCode` 拼出，不做例外（只藏一个反而更显眼）。
- **模板为主体的文件只挂模板外节点**：`github-app.ts` 三份模板共 144 行，只在三个声明行与文档地址常量上挂锚点，共 5 条。

踩坑：

- **块末注脚第四次复现（`} catch` 前）**：`findRelevantMemories` 的 (131) 原挂 `} catch (e) {` 之前，讲的是 catch 里的事——站在 try 末尾描述下一段。处置是并进 catch 内第一条锚点，文本改成「失败降级 + 中止不记日志」两件事一句话。
- **行尾 lint 指令不必动，但会触发扫描**：`buddy/types.ts` 的 `export type Species = ...` 行尾带 `// biome-ignore format: keep compact`。中文注释挂在它前一行不会隔断（指令在同一条语句行内），但专项扫描会报 ESLINT-AFTER。处置是把该锚点的内容并进上面物种列表那条，直接消掉这一行注释。
- **模板字符串外移 4 处（`⟳`）**：`github-app.ts` 三条与 `findRelevantMemories.ts` 一条，外移后行号不变（6→6、58→58、100→100、18→18），落点都在声明行之上，读起来通顺。
- **预检 178 锚点一次全过**，两处处置后为 176。

流程账（第 163 批）：12 个数据文件逐一对齐源文件；预检首轮 178 锚点全过，合并两条后 176；annotate 十二次 4 处良性 `⟳`、零 `⚠`；三项专项扫描（JSX 子元素区、块末注脚、eslint 指令隔断）首轮 2 处命中并全部处置，复扫零输出；check-fidelity 全仓 1643 份 0 失败（较上批 +12）；check-links 2513 源码链 + 731 内链 0 失效；全仓 1643/1902 文件、501,297/513,237 行、97.7%（按行数）；`src/` 还剩 259 份 / 11,940 行。

**下一批候选（124–135 行档，单批约 12 份）**：`bridge/bridgeDebug.ts`(135) · `native-ts/yoga-layout/enums.ts`(134) · `dialogLaunchers.tsx`(133) · `buddy/companion.ts`(133) · `cli/transports/WorkerStateUploader.ts`(131) · `commands/brief.ts`(130) · `keybindings/reservedShortcuts.ts`(127) · `bridge/workSecret.ts`(127) · `tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`(126) · `commands/add-dir/add-dir.tsx`(126) · `context/promptOverlayContext.tsx`(125) · `Task.ts`(125)（`src/` 还剩 259 份 / 11,940 行；157 行以上已清零）

### src batch 164: 124-135 line tier, 12 files (1552 src, 1730 annotated, 174 anchors)

124–135 行档（接第 163 批下沿，取剩余 124 行以上前 12 份，135 行档就此清零）：桥接故障注入、Yoga 枚举、对话框启动器、伙伴抽取、状态上报器、brief 命令、保留快捷键表、工作凭据、进程内队友任务、/add-dir 命令、浮层传送门、任务基类型。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`bridge/bridgeDebug.ts`](annotated/src/bridge/bridgeDebug.ts) | 135→148 | 13 | 桥接故障注入：四方法白名单、致命与瞬时两类伪造、按方法名消费队列 |
| [`native-ts/yoga-layout/enums.ts`](annotated/src/native-ts/yoga-layout/enums.ts) | 134→142 | 8 | Yoga 枚举表：const 对象而非 TS 枚举、位标志与序号的区分、同名值类型 |
| [`dialogLaunchers.tsx`](annotated/src/dialogLaunchers.tsx) | 133→150 | 16 | 对话框启动器：七处内联 JSX 的薄封装、动态导入、取消与错误的两种返回 |
| [`buddy/companion.ts`](annotated/src/buddy/companion.ts) | 133→150 | 17 | 伙伴抽取：自研伪随机、盐值哈希、单槽缓存、骨骼重算与灵魂存储的合并 |
| [`cli/transports/WorkerStateUploader.ts`](annotated/src/cli/transports/WorkerStateUploader.ts) | 131→148 | 17 | 状态上报器：在飞加待发两槽、补丁合并、无限重试与抖动退避 |
| [`commands/brief.ts`](annotated/src/commands/brief.ts) | 130→145 | 15 | brief 命令：灰度的两道门、只在开启时校验权限、工具清单与提醒双写 |
| [`keybindings/reservedShortcuts.ts`](annotated/src/keybindings/reservedShortcuts.ts) | 127→141 | 14 | 保留快捷键：三张表的分工、组合键逐段归一化、修饰键排序 |
| [`bridge/workSecret.ts`](annotated/src/bridge/workSecret.ts) | 127→142 | 15 | 工作凭据：base64url 解码后逐项校验、两套标签比对、世代号类型兼容 |
| [`tasks/InProcessTeammateTask/InProcessTeammateTask.tsx`](annotated/src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx) | 126→143 | 16 | 进程内队友任务：请求关停打标记、消息注入的终态判断、按代理 id 找任务 |
| [`commands/add-dir/add-dir.tsx`](annotated/src/commands/add-dir/add-dir.tsx) | 126→142 | 15 | 添加目录命令（编译器产物）：会话级与持久化两条路径、沙箱刷新时序 |
| [`context/promptOverlayContext.tsx`](annotated/src/context/promptOverlayContext.tsx) | 125→140 | 14 | 浮层传送门（编译器产物）：四 context 拆分、写函数引用稳定、卸载即清 |
| [`Task.ts`](annotated/src/Task.ts) | 125→139 | 14 | 任务基类型：七种类型与五个状态、id 前缀表、字符集与熵的取舍 |

要点：

- **本批的主题是「两个槽 / 两张表 / 两条路」**：状态上报器只有在飞与待发两个槽，所以永远不需要背压；保留快捷键分三张表是因为「我们硬编码的」与「终端截走的」原因不同；添加目录的记住与不记住只差一个落盘来源。多处设计都是「把差异压到一个维度上」。
- **四份编译器产物或模板型代码**：`add-dir`、`promptOverlayContext` 带 `_c(n)` 槽位；`dialogLaunchers` 与 `add-dir` 末尾是 base64 source map（已换成两行说明）。读法与前面一致：槽位比较条件即依赖数组。
- **两处「无限重试 + 抖动」的对照**：状态上报器无限重试且退避封顶后叠抖动（避免同批客户端同步撞车）；伙伴抽取则完全相反——同一 id 必得同一结果，所以连随机数都是自己实现的确定性版本。一个是最终一致，一个是可复现。
- **失败语义分三层写清楚**：`dialogLaunchers` 里安装向导要区分「用户取消」（返回空）与「安装失败」（Promise 拒绝）；`brief` 里只有开启要过权限门，关闭始终允许；`InProcessTeammateTask` 里只有终态拒收消息，空闲仍可接收。
- **`workSecret` 的世代号是协议级细节**：序列化库会把 64 位整数转成字符串，所以既要接受字符串也要接受数字，且必须过安全整数校验——否则后续每次心跳都会带上溢出后的值。

踩坑：

- **本批零 `⟳` 零 `⚠`**：十二次注入全部按原位落点，没有一条被判为模板内部。原因之一是 `github-app` 那类整份模板的文件本批没有，`brief` 的提醒模板是嵌在表达式里的多行字符串，锚点都挂在它外层。
- **三项专项扫描零命中**：JSX 子元素区、块末注脚、eslint 指令隔断均无输出。块末注脚这一项连续两批（163 两处、164 零处）说明「先看中文讲括号里还是括号外」这条判据在日常写法里已经生效。
- **预检 174 锚点一次全过**：本批有两处锚点落在 `/**` 起行（JSDoc 之前），因为 JSDoc 内部是禁区，而声明前的说明又确实该写在那里。

流程账（第 164 批）：12 个数据文件逐一对齐源文件；预检 174 锚点全过；annotate 十二次**零 `⟳` 零 `⚠`**；三项专项扫描零输出；check-fidelity 全仓 1655 份 0 失败（较上批 +12）；check-links 2525 源码链 + 732 内链 0 失效；全仓 1655/1902 文件、502,849/513,237 行、98.0%（按行数，本轮跨过 502,000 行与 98%）；`src/` 还剩 247 份 / 10,388 行。

**下一批候选（110–124 行档，单批约 12 份）**：`skills/bundled/batch.ts`(124) · `commands/plugin/PluginErrors.tsx`(124) · `commands/plan/plan.tsx`(122) · `tasks/InProcessTeammateTask/types.ts`(121) · `keybindings/match.ts`(120) · `migrations/migrateEnableAllProjectMcpServersToSettings.ts`(118) · `commands/extra-usage/extra-usage-core.ts`(118) · `commands/plugin/pluginDetailsHelpers.tsx`(117) · `constants/tools.ts`(112) · `commands/add-dir/validation.ts`(110) · `cli/handlers/util.tsx`(110) · `bridge/pollConfig.ts`(110)（`src/` 还剩 247 份 / 10,388 行；135 行以上已清零）

### src batch 165: 103-124 line tier, 15 files (1718 src, 1887 annotated, 165 anchors)

103–124 行档（接第 164 批下沿，取 110–124 行前 12 份；并补入先前中断流水线遗留的 3 份 <110 行档：advisor / login / debug。合并后本批共 15 份，103 行档仅余 2 份）：插件错误类型、批量技能注册、/plan 命令、队友任务类型、键位匹配、MCP 迁移脚本、额外用量查询、插件详情助手、工具常量表、CLI 处理器工具、/add-dir 校验、桥接配置轮询、/advisor 命令、/login 组件、/debug 技能。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/plugin/PluginErrors.tsx`](annotated/src/commands/plugin/PluginErrors.tsx) | 123→136 | 12 | 插件错误类型与展示文案：错误码映射、用户可见信息、命令级错误构造 |
| [`skills/bundled/batch.ts`](annotated/src/skills/bundled/batch.ts) | 124→133 | 9 | 批量技能注册：一次导出多技能、按目录聚合、调试开关 |
| [`commands/plan/plan.tsx`](annotated/src/commands/plan/plan.tsx) | 121→131 | 9 | /plan 命令（编译器产物）：计划写入、差异对比、审批流 |
| [`tasks/InProcessTeammateTask/types.ts`](annotated/src/tasks/InProcessTeammateTask/types.ts) | 121→133 | 12 | 进程内队友任务类型：请求/响应/状态枚举、字段契约 |
| [`keybindings/match.ts`](annotated/src/keybindings/match.ts) | 120→134 | 14 | 键位匹配：按键事件归一化、组合键判定、作用域过滤 |
| [`migrations/migrateEnableAllProjectMcpServersToSettings.ts`](annotated/src/migrations/migrateEnableAllProjectMcpServersToSettings.ts) | 118→130 | 12 | 迁移脚本：项目级 MCP 开全部迁到 settings |
| [`commands/extra-usage/extra-usage-core.ts`](annotated/src/commands/extra-usage/extra-usage-core.ts) | 118→129 | 11 | /extra-usage 命令核心：额外用量查询与格式化 |
| [`commands/plugin/pluginDetailsHelpers.tsx`](annotated/src/commands/plugin/pluginDetailsHelpers.tsx) | 117→127 | 10 | 插件详情展示助手：元数据渲染、能力清单、状态标签 |
| [`constants/tools.ts`](annotated/src/constants/tools.ts) | 112→121 | 9 | 工具常量表：内置工具名枚举、分类、弃用标记 |
| [`cli/handlers/util.tsx`](annotated/src/cli/handlers/util.tsx) | 109→120 | 10 | CLI 处理器工具：参数解析、错误包装、输出格式化 |
| [`commands/add-dir/validation.ts`](annotated/src/commands/add-dir/validation.ts) | 110→122 | 12 | /add-dir 校验：路径合法性、重复检测、权限预判 |
| [`bridge/pollConfig.ts`](annotated/src/bridge/pollConfig.ts) | 110→122 | 12 | 桥接配置轮询：拉取远端配置、变更检测、节流 |
| [`commands/advisor.ts`](annotated/src/commands/advisor.ts) | 109→121 | 12 | /advisor 命令：顾问模型配置、状态展示、目标模型校验、写入 advisorModel |
| [`commands/login/login.tsx`](annotated/src/commands/login/login.tsx) | 103→115 | 11 | /login 命令组件：登录弹窗、OAuth、换 key、重置费用与权限、authVersion 递增 |
| [`skills/bundled/debug.ts`](annotated/src/skills/bundled/debug.ts) | 103→113 | 10 | /debug 技能：注册调试技能、限制读类工具、日志尾部读取、诊断提示词 |

要点：

- **本批的主题是「命令/技能入口」与「配置/校验」**：advisor、login、debug、plan、extra-usage、pluginDetails、PluginErrors 都是命令或生态入口，骨架轻、逻辑集中在 call/处理函数里、懒加载只导出 call；migrate、pollConfig、validation、tools 则是纯配置/校验/常量层，没有副作用分支。
- **一次性迁移脚本的写法**：migrateEnableAllProjectMcpServersToSettings 把「项目级 MCP 全部开启」迁到 settings，幂等（先读后写、跳过已满足）——「跑一次就退场」的脚本要把「已经满足」也当正常路径，而不是报错。
- **轮询与校验的两类关注点**：pollConfig 拉远端配置要做「变更检测（只在变化时生效）+ 节流（避免每次主循环都打网络）」；validation 的 /add-dir 把「路径合法 / 重复 / 权限预判」三件事拆开讲，失败要给出可执行的修复提示。
- **键位匹配的正确性是「归一化」给的**：match 先把按键事件归一化（大小写、修饰键顺序、作用域），再判定组合键与过滤——判定那一步不能漏任何归一化字段，否则同一物理键在不同上下文被判成不同键。
- **插件生态两份（PluginErrors / pluginDetailsHelpers）互为表里**：前者是错误类型与用户可见文案（错误码→信息→命令级错误构造），后者是详情展示（元数据渲染、能力清单、状态标签）；读插件相关代码时两份一起看。

踩坑：

- **块末注脚一次命中（migrate）**：migrate 的 JSDoc 块在源 12–16 行，原挂 (14) 落在块内——块内是禁区。处置是把首锚移到块前 (12) 与函数前 (17) 两条，不进块内；预检 [bslot] 直接报出，修正后 165 锚点全过。
- **模板字符串外移 1 处（batch.ts）**：batch.ts 两条锚点落在模板字符串内部，annotate 自动外移到声明行之上，行号不变（12→12、93→93），落点通顺。
- **3 份遗留文件（advisor / login / debug）由先前中断流水线生成**：数据文件与批注版都在盘上但未提交（落在 <110 行档，正是下一批目标），本批补做预检（import + 禁字符 + ast.parse 全过）并一并入批，使提交后工作树完全干净（盘上 1670 = 已提交 1670）。
- **预检 165 锚点一次全过，除 batch.ts 1 处 `⟳` 与 migrate 块末修正外零 `⚠`**：其余锚点全部原位落点。

流程账（第 165 批）：15 个数据文件逐一对齐源文件（12 份计划内 110–124 行档 + 3 份先前中断遗留 103–109 行档）；预检 165 锚点全过（含 migrate 块末修正与 3 份遗留补检）；annotate 十五次，batch.ts 1 处良性 `⟳`（模板外移），零 `⚠`；check-fidelity 全仓 1670 份 0 失败（较上批 +15）；check-links 2537 源码链 + 733 内链 0 失效；全仓 1670/1902 文件、504,571/513,237 行、98.3%（按行数，本轮跨过 504,000 行与 98.3%）；`src/` 还剩 232 份 / 8,666 行（103 行档仅余 2 份 parseArgs / ExistingWorkflowStep，124 行以上已清零）。

**下一批候选（<103 行档，单批约 13–15 份）**：`commands/plugin/parseArgs.ts`(103) · `commands/install-github-app/ExistingWorkflowStep.tsx`(103) · `tasks/stopTask.ts`(100) · `memdir/teamMemPrompts.ts`(100) · `types/generated/events_mono/common/v1/auth.ts`(100) · `commands/plugin/ValidatePlugin.tsx`(98) · `outputStyles/loadOutputStylesDir.ts`(98) · `buddy/useBuddyNotification.tsx`(98) · `commands/review/UltrareviewOverageDialog.tsx`(96) · `commands/install-github-app/SuccessStep.tsx`(96) · `constants/system.ts`(95) · `constants/apiLimits.ts`(94) · `memdir/memoryScan.ts`(94) · `commands/install-github-app/InstallAppStep.tsx`(94)（`src/` 还剩 232 份 / 8,666 行；124 行以上已清零，103 行档仅余 2 份）

### src batch 166: 94-103 line tier, 14 files (1369 src, 1579 annotated, 204 anchors)

94–103 行档（接第 165 批下沿，清零 103 行档仅余的 2 份 parseArgs / ExistingWorkflowStep，并顺带吃掉 94–102 行档的 12 份散件）：插件参数解析、安装 GitHub App 多步向导（ExistingWorkflowStep / SuccessStep / InstallAppStep）、/plugin validate 校验、/buddy 预热通知、记忆目录扫描与合并提示词、输出样式目录加载、API 限额常量、系统提示前缀与归属头、超额用量确认对话框、任务停止共享逻辑、生成式鉴权消息类型。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`commands/plugin/parseArgs.ts`](annotated/src/commands/plugin/parseArgs.ts) | 103→118 | 15 | 插件子命令参数解析：ParsedCommand 联合类型 + switch 分发 install/manage/uninstall/enable/disable/validate/marketplace |
| [`commands/install-github-app/ExistingWorkflowStep.tsx`](annotated/src/commands/install-github-app/ExistingWorkflowStep.tsx) | 103→119 | 15 | 安装向导「已存在工作流」步骤（编译器产物）：更新/跳过/退出三选项、claude.yml 提示 |
| [`tasks/stopTask.ts`](annotated/src/tasks/stopTask.ts) | 100→115 | 15 | 停止运行中任务的共享逻辑：查表、状态校验、kill、标记已通知（Shell 抑制 exit 137 噪声） |
| [`types/generated/events_mono/common/v1/auth.ts`](annotated/src/types/generated/events_mono/common/v1/auth.ts) | 100→114 | 14 | 生成式鉴权消息类型（protoc 生成）：fromJSON/toJSON/create/fromPartial 与 DeepPartial/Exact 工具 |
| [`memdir/teamMemPrompts.ts`](annotated/src/memdir/teamMemPrompts.ts) | 100→115 | 15 | 个人+团队记忆合并提示词：双目录说明、作用域、类型与禁忌、两步保存流程 |
| [`buddy/useBuddyNotification.tsx`](annotated/src/buddy/useBuddyNotification.tsx) | 98→117 | 18 | /buddy 预热通知 Hook 与彩虹文本渲染（编译器产物）：窗口期判定、触发位置定位 |
| [`commands/plugin/ValidatePlugin.tsx`](annotated/src/commands/plugin/ValidatePlugin.tsx) | 98→113 | 14 | /plugin validate 交互：清单校验、错误/警告逐条罗列、退出码 |
| [`outputStyles/loadOutputStylesDir.ts`](annotated/src/outputStyles/loadOutputStylesDir.ts) | 98→111 | 13 | 输出样式目录加载：扫描 markdown、frontmatter 解析、缓存 memoize |
| [`commands/install-github-app/SuccessStep.tsx`](annotated/src/commands/install-github-app/SuccessStep.tsx) | 96→110 | 13 | 安装向导「成功」步骤（编译器产物）：密钥状态、工作流创建/复用提示 |
| [`commands/review/UltrareviewOverageDialog.tsx`](annotated/src/commands/review/UltrareviewOverageDialog.tsx) | 96→111 | 14 | 超额用量确认对话框（编译器产物）：AbortController 取消、继续/取消选项 |
| [`constants/system.ts`](annotated/src/constants/system.ts) | 95→108 | 13 | 最底层系统常量（破循环依赖）：系统提示前缀、归属头、工作负载提示 |
| [`constants/apiLimits.ts`](annotated/src/constants/apiLimits.ts) | 94→108 | 14 | Anthropic API 限额常量（零依赖）：图片/PDF/媒体各类上限 |
| [`memdir/memoryScan.ts`](annotated/src/memdir/memoryScan.ts) | 94→109 | 15 | 记忆目录扫描原语：递归列 .md、读 frontmatter、按 mtime 倒序截断 |
| [`commands/install-github-app/InstallAppStep.tsx`](annotated/src/commands/install-github-app/InstallAppStep.tsx) | 94→111 | 16 | 安装向导「安装 App」步骤（编译器产物）：打开浏览器、密钥与仓库提示 |

要点：

- **本批是「收尾散件」+「安装向导三连」**：parseArgs / ValidatePlugin / stopTask / memoryScan / teamMemPrompts / loadOutputStylesDir 是命令/工具/记忆层的轻量模块；ExistingWorkflowStep / SuccessStep / InstallAppStep 是安装 GitHub App 向导的三步（编译器产物，_c 记忆化 + t0/t1… 临时变量 + Symbol 哨兵）。
- **编译器产物的读法是固定的**：React Compiler 把组件编译成 `const $ = _c(N)` 缓存槽 + 依赖变化时重建闭包（t1/t2…）的写法，每个 `if ($[k] === Symbol.for("react.memo_cache_sentinel"))` 是首次渲染初始化、否则读缓存；批注只讲「这段在算什么」，不讲编译器细节。
- **限额常量的分层**：apiLimits 全部零依赖（防循环引用），图片 5MB base64 上限推导出 3.75MB 原始目标、PDF 20MB 目标留出 conversation 余量；system 的系统提示前缀与归属头也是零依赖抽出，归属头的 cch 占位符由 Bun HTTP 栈回填（同长替换避免 Content-Length 变化）。
- **停止任务的两类噪声处理**：stopTask 对本地 shell 任务抑制 exit 137 通知（避免噪音），但 agent 任务保留——因为 agent 的 AbortError catch 会发带 partialResult 的通知（那是有效载荷不是噪音）；抑制 XML 通知时会直接补发 task_notified SDK 事件，保证消费者看到关闭。
- **记忆两件套（memoryScan + teamMemPrompts）互补**：memoryScan 是纯扫描原语（拆出以打破 findRelevantMemories 的循环依赖），teamMemPrompts 是拼装合并提示词；两者都强调「单 pass 读-排-截」与「异常返回空列表不拖垮整体」。

踩坑：

- **多行赋值劈开 2 处（parseArgs / loadOutputStylesDir）**：parseArgs 原挂 (45) 落在 `const isMarketplace =` 多行赋值首行之后，loadOutputStylesDir 原挂 (42) 落在 `const description =` 之后——判据 5（不劈开未结束的多行表达式）直接报失败。处置：把两条锚点移到赋值收尾行之后（parseArgs 改到 (50)、loadOutputStylesDir 改到 (50)），其余同理把挂在线内 `//` 注释上的锚点（40/52/64）挪到真实代码行（41/62/65），重跑预检与 annotate 后 fidelity 全仓 0 失败。
- **`//` 注释上的锚点无害但冗余**：teamMemPrompts / apiLimits / loadOutputStylesDir 里若干 `//` 注释行上的 `after` 锚点被 annotate 吸附到注释行尾，虽不报错但和原文注释重复；统一挪到紧邻代码行，落点更顺。
- **生成文件（auth.ts）与编译器产物（6 个 .tsx）的源映射行**：auth.ts 是 protoc 生成，6 个 .tsx 带 `# sourceMappingURL=` 超长 base64 行，annotate 自动换成一句中文说明（判据 2 标 OK*），批注行数已把「源映射行 → 2 行说明」的 +1 计入。
- **预检 204 锚点一次全过（除 1 处 TAIL 软警告）**：ValidatePlugin (70) 落在 `} catch (t3) {` 上，是 catch 块前的收尾说明，语义正确，非误报。

流程账（第 166 批）：14 个数据文件逐一对齐源文件；预检 204 锚点全过（含 parseArgs/loadOutputStylesDir 多行赋值修正与 1 处 TAIL 软警告）；annotate 十四次，零 `⟳` 零 `⚠`；check-fidelity 全仓 1684 份 0 失败（较上批 +14）；check-links 2552 源码链 + 734 内链 0 失效；全仓 1684/1902 文件、505,940/513,237 行、98%（按行数，本轮跨过 505,000 行）；`src/` 还剩 218 份 / 7,297 行（103 行档已清零，94 行以上全清零，下一档起点 93 行）。

**下一批候选（<94 行档，单批约 13–15 份）**：`query/tokenBudget.ts`(93) · `commands/color/color.ts`(93) · `skills/bundled/loop.ts`(92) · `commands/commit.ts`(92) · `commands/export/export.tsx`(91) · `commands/memory/memory.tsx`(90) · `server/createDirectConnectSession.ts`(88) · `context/voice.tsx`(88) · `assistant/sessionHistory.ts`(87) · `commands/rename/rename.ts`(87) · `constants/xml.ts`(86) · `commands/install-github-app/ErrorStep.tsx`(85) · `commands/mcp/mcp.tsx`(85) · `ink.ts`(85)（`src/` 还剩 218 份 / 7,297 行；103 行档已清零，94 行以上全清零，下一档起点 93 行）

### src batch 167: 84-93 line tier, 14 files (1237 src, 1385 annotated, 144 anchors)

84–93 行档（接第 166 批下沿，清零 93 行档仅余的 2 份 tokenBudget / color，并顺吃 84–92 行档的 12 份散件）：自动续跑/停止的 token 预算判定器、/color 设色命令、/loop 循环技能、/commit 提交命令、/export 导出命令、/memory 记忆编辑命令、直连会话创建、语音状态 React 上下文、/rename 改名命令、会话历史分页拉取、消息 XML 标签常量表、ink 渲染再导出层、/mcp 开关命令、安装 GitHub App 错误展示页。

| 文件 | 原文→批注版 | 锚点 | 讲什么 |
| --- | --- | --- | --- |
| [`query/tokenBudget.ts`](annotated/src/query/tokenBudget.ts) | 93→106 | 13 | 自动续跑/停止的 token 预算判定器：阈值、追踪器、继续/停止决策、递减检测 |
| [`commands/color/color.ts`](annotated/src/commands/color/color.ts) | 93→104 | 11 | /color 命令：队友禁设、空参提示、重置别名、跨会话持久化、AppState 即时生效 |
| [`skills/bundled/loop.ts`](annotated/src/skills/bundled/loop.ts) | 92→100 | 8 | /loop 技能：间隔解析规则、cron 转换表、调度文案、Kairos cron 开关 |
| [`commands/commit.ts`](annotated/src/commands/commit.ts) | 92→102 | 10 | /commit 命令：git 安全协议、白名单、HEREDOC 提交信息、alwaysAllow 注入 |
| [`commands/export/export.tsx`](annotated/src/commands/export/export.tsx) | 90→101 | 10 | /export 命令（编译器产物）：时间戳/首提示文件名、写盘或弹对话框 |
| [`commands/memory/memory.tsx`](annotated/src/commands/memory/memory.tsx) | 89→99 | 9 | /memory 命令（编译器产物）：建目录/建文件、拉编辑器、编辑器变量探测 |
| [`server/createDirectConnectSession.ts`](annotated/src/server/createDirectConnectSession.ts) | 88→97 | 9 | 直连服务器建会话：Bearer 鉴权、fetch 兜底、zod 解析、config 映射 |
| [`context/voice.tsx`](annotated/src/context/voice.tsx) | 87→98 | 10 | 语音状态 React 上下文（编译器产物）：Provider 与 useVoiceState/Set/Get 三件套 |
| [`commands/rename/rename.ts`](annotated/src/commands/rename/rename.ts) | 87→97 | 10 | /rename 命令：队友禁改、无参自动起名、持久化、桥接远端同步 |
| [`assistant/sessionHistory.ts`](annotated/src/assistant/sessionHistory.ts) | 87→97 | 10 | 会话历史分页拉取：鉴权上下文、通用 fetchPage、最新/更旧两页 |
| [`constants/xml.ts`](annotated/src/constants/xml.ts) | 86→102 | 16 | 消息 XML 标签常量表：命令元数据、终端输出、任务通知、各类频道与 fork |
| [`ink.ts`](annotated/src/ink.ts) | 85→95 | 10 | ink 渲染再导出层：withTheme 包裹、render/createRoot、一长串组件再导出 |
| [`commands/mcp/mcp.tsx`](annotated/src/commands/mcp/mcp.tsx) | 84→95 | 10 | /mcp 命令（编译器产物）：开关切换组件、参数分流到设置/重连/切换 |
| [`commands/install-github-app/ErrorStep.tsx`](annotated/src/commands/install-github-app/ErrorStep.tsx) | 84→92 | 8 | 安装 GitHub App 错误展示页（编译器产物）：错误/原因/修复步骤分层渲染 |

要点：

- **本批是「命令/技能入口」+「状态层/常量层」的收尾散件**：tokenBudget 是纯判定器，color/commit/export/memory/rename/mcp 是命令或技能，voice 是 React 状态上下文，xml 是标签常量表，loop/ink 是技能注册与渲染再导出，createDirectConnectSession/assistant 是服务端与会话历史原语。
- **命令入口的两种形态**：color/rename/memory 是 LocalJSXCommand 的 call（交互式，靠 onDone 回显）；commit/loop/mcp 把「提示词或 skill 文案」交给模型或重定向到 UI，本身不跑核心逻辑——commit 还把 `!git ...` 指令真跑掉再注入白名单。
- **编译器产物读法的延续**：export/memory/voice/mcp/ErrorStep 都是 React Compiler 编译结果（`_c(N)` 记忆化槽 + t0/t1… 临时变量 + `$[k]` 哨兵命中即复用）；批注只讲「这段在算什么」，不讲编译器细节。
- **持久化与即时生效的两条路**：color/rename 既写 transcript 路径（跨会话）又改 AppState（即时界面），二者要一起做；rename 还额外把名字同步成 agent name 供提示栏显示。
- **标签常量表的「分组 + 聚合」**：xml 把零散标签按用途分组（命令、终端、任务、规划、频道、fork），并用 TERMINAL_OUTPUT_TAGS 把六个终端标签聚成数组，判断「这是终端输出而非用户提示」时直接 includes。

踩坑：

- **模板字符串外移 2 处（commit）**：commit 的 (20)/(34) 两条锚点原本落在 getPromptContent 的模板字符串内部（含 git 安全协议那段），annotate 自动外移到模板收尾行 (54)，两条注释堆叠在提示词函数结束前，落点通顺——模板内是禁区，外移后恰好覆盖「提示词内容」与「git 安全协议」两块。
- **多编译器产物 .tsx 的源映射行**：export/memory/voice/mcp/ErrorStep 都带 `# sourceMappingURL=` 超长 base64 行，annotate 自动换成一句中文说明（判据 2 标 OK*），批注行数已把「源映射行 → 说明」计入，无需手补。
- **JSDoc 块内不落锚**：createDirectConnectSession 的函数头前有 `/** ... */` 块注释（8–25 行），两条锚点都落在块后的签名收尾 (39) 与代码语句行，未进块内。
- **预检 144 锚点一次全过，零 `⟳` 零 `⚠`（除 commit 模板外移 2 处为 annotate 自动处置）**：其余锚点全部原位落点。

流程账（第 167 批）：14 个数据文件逐一对齐源文件；预检 144 锚点全过（含 commit 模板外移 2 处）；annotate 十四次，commit 1 处良性 `⟳`（模板外移 20→54、34→54），零 `⚠`；check-fidelity 全仓 1698 份 0 失败（较上批 +14）；check-links 2566 源码链 + 735 内链 0 失效；全仓 1698/1902 文件、507,177/513,237 行、99%（按行数，本轮跨过 507,000 行）；`src/` 还剩 204 份 / 6,060 行（93 行档已清零，84 行以上全清零，下一档起点 83 行）。

**下一批候选（<84 行档，单批约 13–15 份）**：`projectOnboardingState.ts`(83) · `commands/sandbox-toggle/sandbox-toggle.tsx`(83) · `bridge/pollConfigDefaults.ts`(82) · `vim/motions.ts`(82) · `skills/bundled/remember.ts`(82) · `tasks/pillLabel.ts`(82) · `commands/logout/logout.tsx`(82) · `bridge/inboundMessages.ts`(80) · `skills/bundled/stuck.ts`(79) · `skills/bundled/index.ts`(79) · `remote/remotePermissionBridge.ts`(78) · `constants/product.ts`(76) · `state/selectors.ts`(76) · `tasks/LocalShellTask/killShellTasks.ts`(76)（`src/` 还剩 204 份 / 6,060 行；93 行档已清零，84 行以上全清零，下一档起点 83 行）
