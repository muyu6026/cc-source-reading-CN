# -*- coding: utf-8 -*-
"""prompts.ts 批注 3/4：MCP 说明、两个 env 版本、知识截止日、uname、子代理人格。"""

ANNOTATIONS = [
(579, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 24. MCP 说明书拼装 ──
// 这里能看清一个类型细节：先过滤出 type==='connected' 的，再用
// `(client): client is ConnectedMCPServer =>` 这个类型谓词收窄。
// 为什么要谓词？因为 MCPServerConnection 是个联合类型
// （connected / failed / needs-auth / pending 等），只有 connected
// 才有 instructions 字段。谓词让后续的 client.instructions 通过类型检查。
// ═══════════════════════════════════════════════════════════════'''),

(588, 'after', '''// 注：`clientsWithInstructions.length === 0` 返回 null，而不是返回
//     「# MCP Server Instructions\n（空）」。
//     这个细节很重要：如果返回一个只有标题的空段，它会占 token、
//     污染提示词、还可能让模型以为「有 MCP 但说明书是空的」。
//     null 才是正确的「这一段不存在」。'''),

(604, 'after', '''// 注：每个服务器的说明书用 `## 服务器名` 作二级标题，块之间空一行。
//     之所以能这么简单，是因为 MCP 规范里 instructions 就是一段
//     自由格式的 markdown —— 服务器作者自己写好的，客户端只负责拼接。
//     这也是 MCP 为什么好扩展：说明书的内容和格式由服务器自己控制，
//     Claude Code 不需要理解它。'''),

(606, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 25. 两个 env 函数并存：computeEnvInfo vs computeSimpleEnvInfo ──
//
// 这是本次分析里最能说明「代码会留下历史层」的地方。
// 两个函数做的是同一件事（告诉模型它在什么环境里跑），但输出格式不同：
//   computeEnvInfo       → XML 风格 `<env>...</env>`，信息更全
//   computeSimpleEnvInfo → Markdown 列表 `# Environment` + 条目
// 谁用哪个？
//   getSystemPrompt（主会话）        → Simple 版（行 460、500）
//   enhanceSystemPromptWithEnvDetails（子代理）→ 完整版（行 784）
// 所以「主会话用新版格式、子代理还留在旧格式」。
// 大概率是新格式先在主路径上线，子代理路径没跟着改 ——
// 而不是有意让两者不一致。
// ═══════════════════════════════════════════════════════════════'''),

(610, 'after', '''// 注：`getIsGit()` 要 spawn 一个 git 命令，`getUnameSR()` 是纯计算，
//     两者并行没坏处。注意 getIsGit 通常有缓存（不然每次请求都 spawn
//     一个 git 进程），本文件看不到实现，但这是必然的设计。'''),

(612, 'before', '''// ── 25.1 undercover（隐身）模式：把模型名从提示词里彻底抹掉 ──'''),
(619, 'after_block', '''// 译：Undercover（隐身模式）：把所有模型名/ID 从系统提示词里拿掉，
//     这样任何内部信息都不会泄露到公开的 commit/PR 里。
//     包括公开的 FRONTIER_MODEL_* 常量 —— 如果那些常量哪天指向了
//     还没发布的模型，我们也不希望它进入上下文。彻底熄灯。
//
//     DCE：`process.env.USER_TYPE === 'ant'` 是构建期 --define。
//     它**必须在每个调用点内联**（不能提取成 const），这样打包器
//     才能把它常量折叠成 false，并在外部版里删掉整个分支。
//
// 注：这段是全文件最有信息量的一段注释，两个点都值得记住。
//
// 【第一点：undercover 是干什么的】
// Anthropic 员工在公开仓库里用 Claude Code 时，如果提示词里写着
// 「你由 Claude Opus 4.6 驱动，ID 是 claude-opus-4-6」，而模型又把
// 这段内容写进了它生成的 commit message 或 PR 描述里 —— 未发布模型
// 就泄露了。所以 undercover 模式的判据是「宁可让模型不知道自己是谁，
// 也不能让名字流出去」。
// 注意它连 FRONTIER_MODEL_NAME（本来就是公开常量）都要藏 ——
// 因为「公开」是相对于「当前这一刻」的，明天它可能指向未发布模型。
//
// 【第二点：为什么不能提取成 const】
// 直觉上会觉得这样更干净：
//     const IS_ANT = process.env.USER_TYPE === 'ant'   // ✗ 不要这样
//     ...
//     if (IS_ANT && isUndercover()) { ... }
// 但 bun 的 --define 是**文本替换级别**的：它把
// `process.env.USER_TYPE` 这个表达式替换成 `"ant"` 或 `"external"`，
// 然后让压缩器做常量折叠。如果先赋值给 const，
// 折叠会发生在 `IS_ANT = "external" === 'ant'` → `IS_ANT = false`，
// 但 `false && isUndercover()` 这个分支**仍然在代码里**，
// 压缩器不一定会跨变量删除（保守起见它通常不删）。
// 而内联写法 `"external" === 'ant' && isUndercover()` 会被直接
// 折叠成 `false`，整个 if 体变成不可达代码，DCE 才敢删。
//
// 所以文件里所有 USER_TYPE 判断都是内联的（行 205、225、238、243、
// 404、433、529、621、660、694、697、700）。这不是风格问题，是正确性问题。'''),

(640, 'after', '''// 注：`<env>` XML 标签包裹环境信息。为什么用 XML 不用 markdown？
//     因为这里的核心是「结构化的键值对」，而 XML 标签给了一个明确的
//     开始/结束边界 —— 模型不会把「Is directory a git repo: Yes」
//     和下一行「Platform: darwin」误认为同一组的两个字段。
//     Markdown 列表做不到这个，因为列表项之间没有从属关系。
//
//     注意 `<env>` 里有两个条件插入：
//       additionalDirsInfo 是空字符串或一行（带尾部换行）
//       getShellInfoLine() 直接是一行
//     空字符串会被原样插入 —— 所以没有额外目录时，那一行就是空的。'''),

(648, 'after', '''// 注：modelDescription 和 knowledgeCutoffMessage 直接接在 `</env>` 后面
//     （中间一个换行都没有，因为模板是 `</env>\\n${modelDescription}${cutoff}`）。
//     所以实际输出是：
//         </env>
//         You are powered by the model named Claude Opus 4.6. ...  Assistant knowledge cutoff is May 2025.
//     两个句子之间只有 cutoff 自带的两个前导换行（行 637 的 `\\n\\n`）。
//     排版略糙，但模型能读 —— 又一次印证：这套提示词的排版标准是
//     「模型能读懂」而不是「人看着整齐」。'''),

(651, 'before', '''// ── 25.2 Simple 版：更结构化、更适合主会话 ──'''),
(667, 'after', '''// 注：和完整版唯一的实质差异：modelDescription 用 `string | null`
//     而不是 `''` 空字符串。这样它能被塞进下面的 envItems 数组里，
//     由 `.filter(item => item !== null)` 统一过滤掉。
//     完整版因为是模板字符串拼接，只能退而求其次用 `''`。
//     这个差别不是设计，是「拼接 vs 数组」两种写法的必然结果。'''),

(675, 'after', '''// 注：worktree 检测。git worktree 是一个仓库的多个工作目录
//     （比如同时开两个分支改不同功能，不用来回 stash）。
//     如果当前在 worktree 里，提示词必须告诉模型「别 cd 回主仓库」——
//     因为模型看到 git 信息里显示主仓库路径，很容易自作主张切过去，
//     结果改动落在错误的分支上。
//
//     注意这条指引的措辞是全大写：`Do NOT \\`cd\\` to the original repository root.`
//     提示词里用全大写名词（NOT / NEVER / IMPORTANT）是有意为之，
//     模型对这种强调的遵从度明显更高。'''),

(682, 'after', '''// 注：`[`Is a git repository: ${isGit}`]` —— 故意包成单元素数组，
//     而不是直接写字符串。因为 prependBullets 遇到数组会给子项加
//     两个空格缩进，遇到字符串加一个空格。
//     这里为什么要缩进？往下看 683-688：如果有额外工作目录，
//     会先输出「Additional working directories:」再输出目录列表，
//     这两项是同一组的子条目，缩进让它们视觉上从属于上面。
//     只包 git 那一行不缩进「Additional working directories」标题行 ——
//     大概是希望标题和 git 行平级，目录列表缩进。
//     实际渲染出来层级有点含糊，属于排版妥协。'''),

(694, 'before', '''// ── 25.3 三处重复的 undercover 判断 ──'''),
(696, 'after', '''// 注：从这里到行 702，同一个条件
//         process.env.USER_TYPE === 'ant' && isUndercover()
//     重复写了三次。按上一节的 DCE 原理，这**不能**提取成变量。
//     但更值得注意的是：它为什么不写成一次判断包住三行？
//     因为三个字符串是 envItems 数组的三个独立元素，如果要用
//     `...(cond ? [a,b,c] : [])` 包起来，就得把三行缩进重组，
//     还要处理它们中间可能插入的其他条目 —— 直接每行各写一次条件更省事。
//     代价是可读性：读者会疑惑「为什么重复三次」。
//     这是「构建期优化污染源码可读性」的典型代价。'''),

(712, 'before', '''// ── 26. 知识截止日：一个顺序敏感的 if-else 链 ──'''),
(715, 'after', '''// 注：⚠ 这里有个非常值得学的顺序依赖。
//     判断用的是 `canonical.includes(...)`，而从具体到笼统：
//         'claude-sonnet-4-6'  → August 2025
//         'claude-opus-4-6'    → May 2025
//         'claude-opus-4-5'    → May 2025
//         'claude-haiku-4'     → February 2025
//         'claude-opus-4' / 'claude-sonnet-4' → January 2025
//
//     如果把最后一条 `claude-opus-4` 提到最前面，那么
//     'claude-opus-4-6' 会先命中 `includes('claude-opus-4')` → 返回
//     January 2025，后面更精确的分支永远走不到。
//     所以这个链必须**由具体到笼统**排列 —— 这是一个隐式契约，
//     没有任何测试会保护它，只能靠 review。
//
//     另外注意 sonnet-4-6 排在 opus 之前，但两者互不包含，
//     所以这两条的相对顺序无所谓；真正有顺序约束的只有
//     「4-6 / 4-5 必须在 4 之前」。'''),

(730, 'after', '''// 注：返回 null 表示「这个模型我不知道它的截止日」—— 于是
//     knowledgeCutoffMessage 为空，提示词里不提截止日。
//     对于一个提示词文件来说，这是正确的降级：宁可不说，
//     也不要说一个错的日期（说错了模型会拿错误的时效性判断信息）。'''),

(732, 'before', '''// ── 27. shell 信息：Windows 上仍然要求 Unix 语法 ──'''),
(743, 'after', '''// 注：注意 shell 名的提取逻辑是 `includes('zsh')` / `includes('bash')`，
//     而不是取 basename。因为 SHELL 可能是
//     `/usr/local/bin/zsh` 或 `/bin/bash -l` 这类串，
//     用 includes 比解析路径更省事（也更容易误判，但实际值域很窄）。
//
//     更重要的一行是 win32 分支：
//         Shell: bash (use Unix shell syntax, not Windows — e.g.,
//                      /dev/null not NUL, forward slashes in paths)
//     这是给 Windows 上跑 Git Bash 的用户的。模型在 Windows 上最容易犯的错
//     就是写 `2>NUL`、`C:\\path\\to\\file`、`del /q` 这些 CMD 语法，
//     而这个提示词直接把三条最常见的坑写出来了。
//     对照第 3 步 setup.ts 里聊过的那句「Windows 编码问题」——
//     整个项目的策略是「Windows 上也用 POSIX 语义」，而不是双套支持。'''),

(745, 'before', '''// ── 28. uname：为什么 Windows 不能用 os.type() ──'''),
(756, 'after', '''// 注：这段注释解释了一个 API 选择，值得读完：
//       · POSIX 上 os.type() 和 os.release() 都包了 uname(3)，
//         输出和 `uname -sr` 逐字节一致 → "Darwin 25.3.0"、"Linux 6.6.4"
//       · Windows 没有 uname(3)，os.type() 返回 "Windows_NT"（很难看）
//       · 但 os.version() 能给 "Windows 11 Pro"（内部走 GetVersionExW /
//         RtlGetVersion）→ 所以 Windows 分支换成 osVersion()
//
//     注意平台判断用的是 `env.platform` 而不是 `process.platform` ——
//     来自 utils/env 的包装，估计是为了可测试性（能 mock）。
//     这个文件里所有平台判断都用 env.platform，是一致的。'''),

(758, 'before', '''// ═══════════════════════════════════════════════════════════════
// ── 29. 子代理的默认人格 ──
// ═══════════════════════════════════════════════════════════════'''),
(758, 'after', '''// 注：就一句话，但三个要点：
//   ① 「完成整个任务 —— 别镀金，但也别做一半」
//   ② 「完成后给一份简洁报告，覆盖做了什么和关键发现」
//   ③ 「调用方会把它转述给用户，所以只要要点」
//     第 ③ 点是最重要的设计：子代理的输出**不是给用户看的**，
//     是给调用它的那个模型看的。所以它不需要寒暄、不需要排版好看，
//     只需要信息密度。
//
//     对照行 766 的 notes（enhanceSystemPromptWithEnvDetails 加的），
//     子代理拿到的提示词 = 这个默认人格 + 调用方给的 prompt + notes + env。
//     注意子代理**不**走 getSystemPrompt()，所以它没有：
//     tone and style、output efficiency、actions 那些段落。
//     子代理的行为约束几乎全靠调用方在 prompt 里写清。'''),
]
