// ═══════════════════════════════════════════════════════════════════════════
// src/setup.ts —— 启动三棒里的第三棒「办入住」，477 行
//
// 【这个文件干什么】
//   cli.tsx（第 1 棒）只看命令行参数，main()（第 2 棒）装配整个 REPL，
//   中间的 setup()（第 3 棒）干的是「开场前的准备工作」：
//   校验运行环境 → 定工作目录 → 处理 git worktree → 抓 hook 配置 → 预热命令/插件
//   → 埋点。做完这些，界面才敢开始渲染。
//
//   注意它**没有业务算法**。整整 477 行，本质是一张「按正确顺序做 N 件事」的清单。
//   所以读这个文件的重点不是「这段代码在算什么」，而是——
//     · 一共要做哪几件事？
//     · 为什么是这个顺序？（这个文件里最值钱的知识全在顺序里）
//     · 哪几件事可以不等结果（fire-and-forget）？
//
// 【顺序为什么值钱：三个真实的依赖】
//   1. setCwd() 必须在 captureHooksConfigSnapshot() 之前
//      —— hook 配置是从「当前目录的 .claude/settings.json」读的，cwd 没定就先读，读错地方。
//      源码里连写了两行大写 IMPORTANT 强调。
//   2. worktree 处理必须在 getCommands() 之前
//      —— 注释说 "otherwise /eject won't be available"：/eject 这个命令要靠 worktree 状态
//      才决定要不要出现在命令表里。顺序错了，命令表就少一条，且之后不会自己补回来
//      （命令表是 memoized 的）。
//   3. setCwd() 必须在所有「依赖 cwd 的代码」之前
//      —— 听起来是废话，但这是启动阶段最常见的 bug 来源，所以作者干脆用注释钉死。
//
// 【两个贯穿全文的开关】
//   isBareMode()        —— `--bare` 或 CLAUDE_CODE_SIMPLE。脚本化调用：「别做交互界面的准备」。
//                          全文出现 6 次，每次都砍掉一批「只有真人坐在终端前才需要」的活。
//   getIsNonInteractiveSession() —— `-p` 模式。比 bare 更细：不是"少做事"，而是"不做终端相关的事"。
//   这两个不是同一个东西，读的时候注意区分（bare ⊂ 少做事；non-interactive = 输出走管道）。
//
// 【和别的篇目的关系】
//   docs/03-启动流程.md 的 3.3 节用表格列了 `setup()` 的 7 个步骤（略去了细节）。
//   本篇是那份表格的**逐行放大版**：同一个顺序，但解释每一步「为什么必须在这里」。
//   main() 里怎么调它：src/main.tsx:1927（和 getCommands 并行跑，见下面第 0 段）。
//
// 【阅读约定】
//   · 英文原文（含原注释）一个字都不删
//   · 紧跟其后的 `// 译：` 是中文直译
//   · `// 注：` 是我补充的解释
//   · `// ── N. xxx ──` 是我加的段落分隔（原文没有这些分段）
//
// 原文位置：source/src/setup.ts（477 行）
// ═══════════════════════════════════════════════════════════════════════════

// ── 0. 先看「谁在调它」：它并不是串行等待的一环 ──────────────────────────────
//
// main.tsx:1927 是这样调的（注意没有 await）：
//
//     const setupPromise  = setup(preSetupCwd, permissionMode, ...)
//     const commandsPromise = worktreeEnabled ? null : getCommands(preSetupCwd)
//     const agentDefsPromise = worktreeEnabled ? null : getAgentDefinitionsWithOverrides(preSetupCwd)
//     await setupPromise
//
// 也就是：setup() 和「加载命令表、加载子代理定义」**同时开跑**。作者的测量是
// setup() 约 28ms，其中约 20ms 花在 startUdsMessaging（socket bind），不是磁盘 IO，
// 所以不会和 getCommands 的文件读抢资源。
//
// 但有个条件：`--worktree` 时**不能并行**（commandsPromise 直接置 null），
// 因为 worktree 会让 setup() 里 process.chdir()，而命令表必须从 chdir 之后的目录读。
// ——这就是本文件里「顺序」问题的第一个实例，只不过它被挪到了调用方去处理。

/* eslint-disable custom-rules/no-process-exit */
// 注：整个文件豁免「禁止 process.exit」这条自定义 lint 规则。
//     为什么？因为 setup() 是**启动阶段**：这时候还没有界面、没有会话、没有可回退的状态，
//     遇到「Node 版本太低」「不是 git 仓库却要 --worktree」这种前置条件不满足，
//     唯一正确的做法就是立刻退出并打印原因。让它 throw 出去只会在没有 UI 的时候变成一堆栈。

import { feature } from 'bun:bundle'
// 译：从 bun:bundle 导入 feature()——构建期开关（见 cli.tsx 批注版的解释）
// 注：本文件用到两处：UDS_INBOX（第 95 行）、CONTEXT_COLLAPSE（第 295 行）、
//     COMMIT_ATTRIBUTION（第 350 行）、TEAMMEM（第 365 行）。
//     这些代码块在你的构建产物里可能存在、也可能被整段删掉，取决于打包时的开关。

import chalk from 'chalk'
// 译：导入 chalk —— 给终端文字上色
// 注：本文件里所有 console.log / console.error 都用它上色（红=错误，黄=警告，绿=成功）。
//     启动阶段的输出发生在 Ink 界面挂载**之前**，所以只能用最原始的 console，不能走 UI 层。

// ── 1. 导入块：按「从哪来」分四簇看，能看出这个文件的职责范围 ──────────────────
//
//   A 簇（src/ 绝对路径）—— 埋点与分析
//   B 簇（./bootstrap/state.js）—— 全局会话状态
//   C 簇（./utils/*）—— 各种「一次性初始化」工具
//   D 簇（./utils/worktree.js）—— worktree（本文件最重的一段逻辑，第 4 段）

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
// 译：从 src/services/analytics/index.js 导入 logEvent 和一个名字很长的类型
// 注：`type` 前缀写在导入列表里（TS 4.5+ 语法），表示「这个只是一个类型，编译后消失」，
//     而同一个 {} 里的 logEvent 是真实函数。这样一次 import 只保留运行时需要的那一半。
// 注：那个类型名 AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS 是全项目最长的
//     标识符之一，它不是玩笑，而是**类型层面的合规检查**：
//     埋点里不允许塞代码或文件路径（隐私/泄密风险），所以要求开发者把它写成这个类型，
//     相当于强制在代码里"签个字"说我确认过。文件末尾第 470 行就用到它。

import { getCwd } from 'src/utils/cwd.js'
// 译：导入 getCwd —— 取「当前工作目录」
// 注：注意它来自 utils/cwd.js，而不是直接 process.cwd()。项目自己维护一份 cwd 状态，
//     因为 worktree 会让进程 chdir，而 UI 里显示的路径要跟着变。setCwd() 就是它的写入口。

import { checkForReleaseNotes } from 'src/utils/releaseNotes.js'
// 译：导入 checkForReleaseNotes —— 检查有没有「没看过的更新日志」
// 注：这是纯 UI 用途（启动画面上的 "What's new"），所以在第 6 段被 !isBareMode() 挡掉了。

import { setCwd } from 'src/utils/Shell.js'
// 译：导入 setCwd —— 设置当前工作目录（写入口，和上面 getCwd 配对）

import { initSinks } from 'src/utils/sinks.js'
// 译：导入 initSinks —— 初始化「输出端」（错误日志 sink + 分析数据 sink）
// 注：这个名字容易误解。它不是终端输出的 sink，而是**埋点/日志的落地端**：
//     在它被调用之前，logEvent 产生的所有事件只是排在一个队列里；
//     调用之后队列被消费、并接到真正的上报通道上。所以第 287 行那句注释说
//     "drain queued events"（把排队的事件排空）。

import {
  getIsNonInteractiveSession,
  getProjectRoot,
  getSessionId,
  setOriginalCwd,
  setProjectRoot,
  switchSession,
} from './bootstrap/state.js'
// 译：从 ./bootstrap/state.js 导入 6 个全局会话状态读写函数
// 注：这个 state.js 是整个进程的「全局单例状态」，用 get/set 函数而不是导出变量，
//     既防止随便改，也方便加缓存失效逻辑。
// 注：六个函数各自的用途（本文件哪里用到）：
//     getIsNonInteractiveSession → 判断是不是 -p 模式（第 115、316、380 行）
//     getProjectRoot              → 项目根目录（第 322 行 getCommands 的参数）
//     getSessionId                → 当前会话 ID（第 234 行传给 createWorktreeForSession）
//     setOriginalCwd              → 记录「用户最初从哪启动」（worktree 切换后原始 cwd 会变）
//     setProjectRoot              → 项目根（worktree 模式下它就是 worktree 目录）
//     switchSession               → 换会话 ID（第 83 行，用于 --session-id 指定 ID）

import { getCommands } from './commands.js'
// 译：导入 getCommands —— 加载并缓存「所有斜杠命令」的列表
// 注：这就是那个 memoized（结果被缓存）的函数，所以第 2 段说的「worktree 必须在它之前」
//     才那么关键 —— 一旦它先跑并缓存了，后面再 chdir 也不会重新读。

import { initSessionMemory } from './services/SessionMemory/sessionMemory.js'
// 译：导入 initSessionMemory —— 初始化会话记忆
// 注：注意它在第 294 行是**同步调用**且注释写着 "registers hook, gate check happens lazily"：
//     现在只挂一个钩子，真正要不要干活（功能开没开、是不是 bare 模式）等触发时再判断。
//     这是启动阶段的标准套路：把判断推迟到「用得上」的那一刻。

import { asSessionId } from './types/ids.js'
// 译：导入 asSessionId —— 把一个普通字符串「盖章」成 SessionId 类型
// 注：branded type（品牌类型）。SessionId 在运行时就是个 string，但类型系统里是
//     `string & { __brand: 'SessionId' }`，防止你把「项目 ID」当「会话 ID」传进去。
//     代价是要显式转换一次——第 83 行那个 asSessionId(...) 就是这道手续。

import { isAgentSwarmsEnabled } from './utils/agentSwarmsEnabled.js'
// 译：导入 isAgentSwarmsEnabled —— 「智能体集群」功能是否开启
// 注：本文件里它管着两件事：抢队友模式快照（第 105 行）、iTerm2 备份恢复（第 117 行）。
//     关掉这个开关，这几段就整段不执行。

import { checkAndRestoreTerminalBackup } from './utils/appleTerminalBackup.js'
// 译：导入 checkAndRestoreTerminalBackup —— 检查并恢复 macOS Terminal.app 的设置备份
// 注：这是本文件最"意外"的一段逻辑：Claude Code 会临时改终端配色（比如做主题适配），
//     改之前先备份原设置；如果上次进程被强杀、备份没还原，这次启动就顺手还原。
//     所以它必须在**渲染界面之前**做，否则用户会看到一个配色错乱的终端。

import { prefetchApiKeyFromApiKeyHelperIfSafe } from './utils/auth.js'
// 译：导入「安全地预取 API Key」（通过 apiKeyHelper 配置的外部命令取）
// 注：函数名里那个 IfSafe 是关键：只有「用户已经确认信任这个项目」才去执行外部命令。
//     否则「打开一个恶意仓库」就等于「执行它的任意脚本」。

import { clearMemoryFileCaches } from './utils/claudemd.js'
// 译：导入 clearMemoryFileCaches —— 清空 CLAUDE.md 等记忆文件的缓存
// 注：只在 worktree 分支里用（第 280 行）：因为 cwd 变了，之前缓存的记忆文件内容全部作废。

import { getCurrentProjectConfig, getGlobalConfig } from './utils/config.js'
// 译：导入两个配置读取函数：当前项目配置、全局配置
// 注：本项目配置里存着上个会话的花费/时长（第 449 行用它补报上次的退出事件）；
//     全局配置里存着 lastReleaseNotesSeen（上次看到哪版更新日志）。

import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
// 译：导入「写诊断日志（不含个人隐私信息）」的函数
// 注：名字里的 NoPII = No Personally Identifiable Information。
//     本文件用它打了 6 个点（setup_started / hooks_captured / background_jobs_starting …），
//     作用是**排查启动慢**：每个点带 duration_ms，一眼看出哪一步拖了时间。
//     和 logEvent 的区别：这个是本地诊断日志，那个是要上报的分析事件。

import { env } from './utils/env.js'
// 译：导入 env —— 环境探测工具集
// 注：第 429 行用它判断「有没有外网」。注意这是 `env`（探测能力），
//     不是 `process.env`（读环境变量），读环境变量的是下面那个 envTruthy。

import { envDynamic } from './utils/envDynamic.js'
// 译：导入 envDynamic —— 需要动态探测的环境信息（Docker？Bubblewrap 沙箱？）
// 注：和 env 的分工：env 是「便宜且常用」的探测，envDynamic 是「可能较贵、按需才做」的探测。
//     Docker 判断要读 /proc/1/cgroup 之类，所以只在真要跳过权限时才调（第 428 行）。

import { isBareMode, isEnvTruthy } from './utils/envUtils.js'
// 译：导入两个环境判断工具：isBareMode（--bare 模式）、isEnvTruthy（环境变量是否为真）
// 注：isBareMode 的定义（envUtils.ts:60-65）就两行：
//       isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE) || process.argv.includes('--bare')
//     所以「--bare」和「设了 CLAUDE_CODE_SIMPLE」是同一件事的两种开关方式。
// 注：isEnvTruthy 比 `=== 'true'` 宽容，认 '1' / 'true' / 'yes' 等写法，
//     并且会把 '0' / 'false' 判为假 —— 避免 `if (process.env.X)` 这种「字符串 'false' 也是真」的坑。

import { errorMessage } from './utils/errors.js'
// 译：导入 errorMessage —— 从 unknown 类型的异常里安全地取出可读消息
// 注：catch 到的 error 在 TS 里是 unknown，直接 .message 会报错。这个工具做了类型收窄。

import { findCanonicalGitRoot, findGitRoot, getIsGit } from './utils/git.js'
// 译：导入三个 git 相关查询：规范仓库根、普通仓库根、是否在 git 仓库内
// 注：三者区别很关键，第 4 段（worktree）会反复用到：
//     getIsGit()           → 只是「是不是 git 仓库」（快，有缓存）
//     findGitRoot(cwd)     → 从 cwd 往上找 .git，可能是**子模块或 worktree** 的根
//     findCanonicalGitRoot → 找到**主仓库**的根（在 worktree 里跑时会跳回主仓）

import { initializeFileChangedWatcher } from './utils/hooks/fileChangedWatcher.js'
// 译：导入「文件变更监听器」的初始化函数
// 注：服务于 FileChanged 类型的 hook（用户可以在配置里写「某个文件变了就跑这个脚本」）。
//     注意它是同步的（第 172 行注释明说 sync），因为要读第 166 行刚抓好的 hook 配置快照。

import {
  captureHooksConfigSnapshot,
  updateHooksConfigSnapshot,
} from './utils/hooks/hooksConfigSnapshot.js'
// 译：导入「抓取 hook 配置快照」与「更新 hook 配置快照」
// 注：为什么需要「快照」这个概念？因为 hook 配置来自 .claude/settings.json，
//     而那个文件在会话过程中可能被改。抓一份快照放在内存里，本会话就按快照执行，
//     避免「用户中途改配置导致行为漂移」。（用户主动改时走 update 版本，见第 284 行。）
// 注：capture 与 update 的区别（hooksConfigSnapshot.ts:95-112）：
//     capture 直接读当前配置；
//     update  先 resetSettingsCache() 再读 —— 因为要确保读到磁盘上的新内容。

import { hasWorktreeCreateHook } from './utils/hooks.js'
// 译：导入 hasWorktreeCreateHook —— 用户有没有配「WorktreeCreate」hook
// 注：这是为「非 git 的版本控制」留的口子：SVN / P4 用户也可以用 --worktree，
//     只要配了这个 hook 让外部脚本去创建隔离目录。第 179 行就是这条判断。

import { checkAndRestoreITerm2Backup } from './utils/iTermBackup.js'
// 译：导入 iTerm2 设置备份的检查与恢复
// 注：和上面 Terminal.app 那个是姊妹功能，都是「上次改终端设置没来得及还原」的补救。
//     区别：这个只在 swarms 开启时做（第 117 行），Terminal.app 那个无条件做（但有 try/catch）。

import { logError } from './utils/log.js'
// 译：导入 logError —— 把错误写进本地日志（不中断程序）
// 注：注意和 logForDiagnosticsNoPII 的区别：logError 记的是**异常**，
//     diagLogs 记的是**流程节点 + 耗时**。第 156 行用它处理「恢复终端备份失败」，
//     失败就失败，不能让启动挂掉。

import { getRecentActivity } from './utils/logoV2Utils.js'
// 译：导入 getRecentActivity —— 取最近活动（给启动 logo 画面显示用）
// 注：注释说它会读最多 10 个会话 JSONL 文件（第 385 行），所以被 !isBareMode() 挡掉：
//     脚本模式没人看 logo，不该为它读 10 个文件。

import { lockCurrentVersion } from './utils/nativeInstaller/index.js'
// 译：导入 lockCurrentVersion —— 锁住当前版本，防止被别的进程删掉
// 注：原生安装版（nativeInstaller）会把不同版本放在不同目录，自动更新时可能清理旧版本。
//     当前正在跑的版本必须「占住」，否则可能跑到一半文件被删。
//     第 303 行用 `void` 调用 —— 不等结果（见第 5 段对 `void` 的解释）。

import type { PermissionMode } from './utils/permissions/PermissionMode.js'
// 译：导入 PermissionMode 类型（纯类型，编译后消失）
// 注：六种权限模式之一：default / plan / acceptEdits / bypassPermissions / dontAsk / auto。
//     本文件只用它做两个判断：第 397 行的 bypass 安全检查。

import { getPlanSlug } from './utils/plans.js'
// 译：导入 getPlanSlug —— 取「计划名」的短标识
// 注：用在 worktree 命名上（第 193 行）：没给 --worktree 名字时，用计划名当 slug。
//     想法是「一个计划一个工作树」，分支名能看出在干什么。

import { saveWorktreeState } from './utils/sessionStorage.js'
// 译：导入 saveWorktreeState —— 把 worktree 信息存进会话状态（持久化）
// 注：存下来是为了「重启/恢复会话时还能找到那个工作树」，对应 /resume。

import { profileCheckpoint } from './utils/startupProfiler.js'
// 译：导入 profileCheckpoint —— 打一个「启动性能计时点」
// 注：实现（startupProfiler.ts:65-70）第一行就是 `if (!SHOULD_PROFILE) return`，
//     所以生产环境里它几乎零开销，只在开启动剖析时才有意义。
//     本文件打了三个点：setup_before_prefetch / setup_after_prefetch / action_* 由调用方打。
//     和 logForDiagnosticsNoPII 的区别：这个是为**性能剖析**（measure 时间差），
//     那个是为**日志排查**（读文本就知道流程走到哪）。

import {
  createTmuxSessionForWorktree,
  createWorktreeForSession,
  generateTmuxSessionName,
  worktreeBranchName,
} from './utils/worktree.js'
// 译：导入四个 worktree/tmux 相关函数
// 注：这是本文件唯一有「实质逻辑」的依赖簇，第 4 段（第 174-285 行）展开。
//     四者的分工：
//     createWorktreeForSession   → 建立工作树（可能委托给用户配的 hook）
//     createTmuxSessionForWorktree → 给工作树开一个 tmux 会话（可选）
//     generateTmuxSessionName    → 生成 tmux 会话名（只取路径的 basename）
//     worktreeBranchName         → 生成分支名（形如 claude/<slug>）

// ── 2. 函数签名：九个参数，全是「调用方替用户做的决定」 ────────────────────────
//
// 先看参数表，就能猜到整个启动流程有哪些分支。九个参数可以分成四组：
//   ① 位置：cwd                       —— 在哪干
//   ② 权限：permissionMode、
//           allowDangerouslySkipPermissions —— 能干到什么程度
//   ③ 隔离：worktreeEnabled、worktreeName、
//           worktreePRNumber、tmuxEnabled   —— 要不要单开一个工作树/窗口
//   ④ 会话：customSessionId、messagingSocketPath —— 用哪个会话 ID、消息 socket 在哪
//
// 注：这个签名有个明显的坏味道 —— 9 个位置参数，其中 4 个是布尔。
//     调用处（main.tsx:1927）是一行长达 180 字符的调用，读的时候必须数位置：
//       setup(preSetupCwd, permissionMode, allowDangerouslySkipPermissions,
//             worktreeEnabled, worktreeName, tmuxEnabled, sessionId ? ... ,
//             worktreePRNumber, messagingSocketPath)
//     好在两个可选参数都排在后面（customSessionId / worktreePRNumber / messagingSocketPath），
//     必填的六个在前面。改成对象参数会更安全，但那是大范围改动。

export async function setup(
  cwd: string,
  permissionMode: PermissionMode,
  allowDangerouslySkipPermissions: boolean,
  worktreeEnabled: boolean,
  worktreeName: string | undefined,
  tmuxEnabled: boolean,
  customSessionId?: string | null,
  worktreePRNumber?: number,
  messagingSocketPath?: string,
): Promise<void> {
  // 注：返回 Promise<void> —— 不返回任何值，它的产出全在「副作用」里
  //     （改了 cwd、改了全局 state、建了 worktree、挂了监听器）。
  //     这种「全靠副作用」的函数最难测试，所以它被打扮得尽量「只做编排、逻辑都推给被调函数」。
  logForDiagnosticsNoPII('info', 'setup_started')
  // 译：写一条诊断日志：setup 开始
  // 注：整段流程的第一个计时锚点。排查「启动慢」时，从这条到 setup_hooks_captured 的间隔
  //     就是 Node 版本检查 + UDS socket + 终端备份恢复的耗时。

  // ── 3. 第一件事：校验 Node 版本（不满足就退出，后面全不执行）──────────────────

  // Check for Node.js version < 18
  // 译：检查 Node.js 版本是否低于 18
  const nodeVersion = process.version.match(/^v(\d+)\./)?.[1]
  // 注：process.version 形如 "v22.14.0"。正则只取主版本号：
  //       ^v(\d+)\.   → 匹配开头 v + 数字 + 点，捕获数字
  //       ?.[1]       → match 可能返回 null（万一格式变了），?. 防止 null 上取 [1] 报错
  //     所以结果是字符串 "22"，不是数字 —— 下一行必须再 parseInt 一次。
  if (!nodeVersion || parseInt(nodeVersion) < 18) {
    // 注：`!nodeVersion` 兜的是「正则没匹配上」的情况（比如以后的 Node 改了版本号格式）。
    //     这种「宁可误拒也不放行」的写法在启动校验里很常见。
    // biome-ignore lint/suspicious/noConsole:: intentional console output
    // 译：让下一行豁免「禁止用 console」这条 lint 规则 —— 这里是刻意的控制台输出
    // 注：为什么要豁免？因为项目里统一走 Ink 渲染，直接 console.log 会打乱界面。
    //     但此刻界面还没挂载，只能 console。所以每处都带这么一行豁免注释。
    //     全文这种 biome-ignore 一共 8 处，都在启动早期。
    console.error(
      chalk.bold.red(
        'Error: Claude Code requires Node.js version 18 or higher.',
      ),
    )
    // 译：红字加粗输出：错误 —— Claude Code 需要 Node.js 18 或更高版本
    process.exit(1)
    // 注：exit code 1 = 通用错误。用 process.exit 而不是 return，是因为
    //     调用方（main.tsx）并不知道怎么处理「版本不够」，也没有可降级的路径。
  }
  // 注：为什么卡 18？因为代码里用了全局 fetch、structuredClone、Array.at 等
  //     Node 18 才稳定的 API。18 是这里的最低线，不是推荐版本。

  // ── 4. 第二件事：如果指定了会话 ID，换到那个会话 ──────────────────────────────

  // Set custom session ID if provided
  // 译：如果调用方给了自定义会话 ID，就设置它
  if (customSessionId) {
    switchSession(asSessionId(customSessionId))
    // 注：switchSession（bootstrap/state.ts:468-478）做三件事：
    //       1. 删掉「上一个会话」的 planSlug 缓存（防止 Map 无限增长）
    //       2. 把全局 STATE.sessionId 换成新的
    //       3. 发一个 sessionSwitched 事件（让订阅者跟着换）
    //     这是 --session-id / --resume 能精确落到某个会话的实现基础。
    // 注：asSessionId() 是 branded type 的「盖章」手续，运行时什么也不做。
  }

  // ── 5. 第三件事：UDS 消息 socket（本文件最绕的一段开关逻辑）───────────────────

  // --bare / SIMPLE: skip UDS messaging server and teammate snapshot.
  // Scripted calls don't receive injected messages and don't use swarm teammates.
  // Explicit --messaging-socket-path is the escape hatch (per #23222 gate pattern).
  // 译：--bare / SIMPLE 模式下跳过 UDS 消息服务器和队友快照。
  //     脚本化调用不会收到注入消息，也不用集群队友。
  //     显式传 --messaging-socket-path 是逃生口（沿用 #23222 那次改动的门禁模式）。
  // 注：「UDS」= Unix Domain Socket，本机进程间通信用的文件式 socket。
  //     它让外部进程（比如 SDK 宿主、另一个 Claude 实例、测试脚本）能给正在跑的会话
  //     塞消息 —— 这就是「工具可以在运行中被外部注入指令」的通道。
  // 注：「escape hatch（逃生口）」这个说法值得学：默认关掉某个能力，但保留一个
  //     显式参数能强制打开。既省了脚本模式的启动时间，又不把路堵死。
  if (!isBareMode() || messagingSocketPath !== undefined) {
    // 注：条件是「不是 bare 模式」**或**「用户显式给了 socket 路径」。
    //     `||` 而不是 `&&` 正是逃生口的实现：bare 模式下一旦显式指定，仍然执行。
    // Start UDS messaging server (Mac/Linux only).
    // Enabled by default for ants — creates a socket in tmpdir if no
    // --messaging-socket-path is passed. Awaited so the server is bound
    // and $CLAUDE_CODE_MESSAGING_SOCKET is exported before any hook
    // (SessionStart in particular) can spawn and snapshot process.env.
    // 译：启动 UDS 消息服务器（仅 Mac/Linux）。
    //     对 Anthropic 内部用户（ants）默认开启 —— 没给 --messaging-socket-path 时
    //     在临时目录里创建一个 socket。这里要 await，目的是让服务器**先完成绑定**、
    //     并把 $CLAUDE_CODE_MESSAGING_SOCKET 导出到环境变量，
    //     之后任何 hook（尤其是 SessionStart）才可能被启动并快照 process.env。
    // 注：最后那句是这段 await 存在的全部理由。如果不等，SessionStart hook 可能
    //     在一个「socket 还没绑好、环境变量还没设」的时刻启动，它读到的 env 就是残缺的。
    //     这类「初始化顺序影响子进程看到的环境」的问题，在启动代码里非常典型。
    // 注：「ants」是 Anthropic 内部员工的自称（公司名里 ant = 蚂蚁）。代码里
    //     `process.env.USER_TYPE === 'ant'` 就是「内部员工版」的判断，全项目到处都是。
    if (feature('UDS_INBOX')) {
      // 注：构建期开关。外部发行版里这段可能整个不存在。
      const m = await import('./utils/udsMessaging.js')
      // 注：动态 import —— 只有真的要用 UDS 才加载这个模块（和 cli.tsx 的手法一样）。
      //     `const m = await import(...)` 这种写法叫「命名空间导入」，
      //     之后用 m.startUdsMessaging / m.getDefaultUdsSocketPath 访问。
      await m.startUdsMessaging(
        messagingSocketPath ?? m.getDefaultUdsSocketPath(),
        { isExplicit: messagingSocketPath !== undefined },
      )
      // 注：第一个参数是 socket 路径：用户给了就用用户的，否则用默认（临时目录里生成）。
      // 注：第二个参数 isExplicit 会传进下层，决定「这个 socket 是不是用户主动要的」——
      //     这影响行为：自动生成的 socket 是「被动的」（工具想注入才用），
      //     显式指定的才允许改变 stream-json 的输出形态（见 main.tsx:1938-1950 那段注释）。
    }
  }

  // Teammate snapshot — SIMPLE-only gate (no escape hatch, swarm not used in bare)
  // 译：队友模式快照 —— 只按 SIMPLE（bare）门禁，没有逃生口，因为 bare 模式下根本不用集群
  // 注：对比上面那段：这里只有 `!isBareMode()`，没有 `|| ...` 逃生口。
  //     作者的判断是「bare 模式绝不会用队友，所以连口子都不必留」。
  //     同一个文件里两段相邻的门禁，一个留口子一个不留 —— 这种差别是**有意的设计**，
  //     读的时候值得停一下想清楚为什么。
  if (!isBareMode() && isAgentSwarmsEnabled()) {
    const { captureTeammateModeSnapshot } = await import(
      './utils/swarm/backends/teammateModeSnapshot.js'
    )
    // 注：解构式动态导入，只取需要的那一个函数。
    //     文件名里 backends 说明它是「后端实现」—— 集群功能有多个后端（本机进程 / tmux / 远程），
    //     快照要记录当前用的是哪个后端，好让子代理按同样方式启动。
    captureTeammateModeSnapshot()
  }

  // ── 6. 第四件事：修上次没修完的终端设置（只在交互模式）────────────────────────

  // Terminal backup restoration — interactive only. Print mode doesn't
  // interact with terminal settings; the next interactive session will
  // detect and restore any interrupted setup.
  // 译：终端设置备份的恢复 —— 仅交互模式。print 模式不会碰终端设置；
  //     下一次交互式会话会检测并恢复任何被中断的设置。
  // 注：「print mode」就是 -p 模式。它不渲染界面、不改配色，所以不需要这套补救。
  //     这也解释了为什么这段被 !getIsNonInteractiveSession() 包住。
  if (!getIsNonInteractiveSession()) {
    // iTerm2 backup check only when swarms enabled
    // 译：iTerm2 备份检查只在集群功能开启时做
    if (isAgentSwarmsEnabled()) {
      const restoredIterm2Backup = await checkAndRestoreITerm2Backup()
      // 注：返回的是一个「判别联合」（discriminated union），status 有三种取值：
      //     'restored' / 'failed' / （其他，表示没有需要恢复的备份）。
      //     所以下面用 if / else if 处理，没写 else —— 「无事发生」不需要任何输出。
      if (restoredIterm2Backup.status === 'restored') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(
          chalk.yellow(
            'Detected an interrupted iTerm2 setup. Your original settings have been restored. You may need to restart iTerm2 for the changes to take effect.',
          ),
        )
        // 译：黄字提示：检测到上次 iTerm2 设置被中断，已恢复你的原始设置。
        //     可能需要重启 iTerm2 才能生效。
        // 注：用黄色（警告）而不是红色（错误）—— 因为这是「已经修好了」，
        //     只是需要用户动一下手（重启终端）。
      } else if (restoredIterm2Backup.status === 'failed') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(
          chalk.red(
            `Failed to restore iTerm2 settings. Please manually restore your original settings with: defaults import com.googlecode.iterm2 ${restoredIterm2Backup.backupPath}.`,
          ),
        )
        // 译：红字：恢复 iTerm2 设置失败。请手动恢复：defaults import com.googlecode.iterm2 <备份路径>
        // 注：这是本文件里少见的「把操作方法直接写进错误信息」。
        //     因为它没法自动修，只能告诉用户具体命令 —— 而且备份文件路径是现成的，
        //     拼进命令里，用户复制就能用。这种错误信息质量值得学。
      }
    }

    // Check and restore Terminal.app backup if setup was interrupted
    // 译：如果上次启动被中断，检查并恢复 Terminal.app 的备份
    try {
      // 注：注意这段有 try/catch，而上面 iTerm2 那段**没有**。
      //     差别不是疏忽：iTerm2 那段只在内部用户（swarms 开启）才走到，
      //     Terminal.app 这段对所有 macOS 用户都会走到，所以更需要兜底。
      const restoredTerminalBackup = await checkAndRestoreTerminalBackup()
      if (restoredTerminalBackup.status === 'restored') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(
          chalk.yellow(
            'Detected an interrupted Terminal.app setup. Your original settings have been restored. You may need to restart Terminal.app for the changes to take effect.',
          ),
        )
        // 译：与上面 iTerm2 同义的提示，只是换成 Terminal.app
      } else if (restoredTerminalBackup.status === 'failed') {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(
          chalk.red(
            `Failed to restore Terminal.app settings. Please manually restore your original settings with: defaults import com.apple.Terminal ${restoredTerminalBackup.backupPath}.`,
          ),
        )
        // 译：红字：恢复 Terminal.app 设置失败。请手动恢复：defaults import com.apple.Terminal <备份路径>
      }
    } catch (error) {
      // Log but don't crash if Terminal.app backup restoration fails
      // 译：如果 Terminal.app 备份恢复失败，记日志但不要崩
      logError(error)
      // 注：这是本文件里「错误严重性分级」最清楚的一处：
      //     恢复终端设置失败 ≠ 不能用 Claude Code。所以吞掉异常，只记日志。
      //     判断标准是「这件事失败会不会影响核心功能」—— 不会就绝不阻断启动。
    }
  }

  // ── 7. 第五件事：定 cwd —— 整个文件的分水岭，之后的一切都依赖它 ────────────────

  // IMPORTANT: setCwd() must be called before any other code that depends on the cwd
  // 译：重要：setCwd() 必须在任何依赖当前目录的代码之前调用
  // 注：为什么前面那几段可以不等 cwd？因为它们都不读磁盘上的项目文件：
  //     Node 版本检查（读 process.version）、UDS socket（写临时目录）、
  //     终端设置恢复（读 ~/Library/Preferences）。而下面这句之后，全是「按项目目录读配置」。
  setCwd(cwd)
  // 注：setCwd 来自 utils/Shell.js，不是 process.chdir —— 它更新的是**项目自己的 cwd 状态**。
  //     两者在本文件里都出现过，区别要注意：
  //       setCwd(x)       只改内部状态（UI 显示、后续 getCwd() 的返回值）
  //       process.chdir(x) 真的改进程工作目录（会影响子进程的继承 cwd）
  //     第 4 段的 worktree 处理里两个都调了，因为那时必须真的换目录。
  //     而这里只调 setCwd，是因为 main() 传进来的 cwd 通常就等于当前进程目录。

  // Capture hooks configuration snapshot to avoid hidden hook modifications.
  // IMPORTANT: Must be called AFTER setCwd() so hooks are loaded from the correct directory
  // 译：抓取 hook 配置快照，避免 hook 被偷偷改掉。
  //     重要：必须在 setCwd() 之后调用，这样才能从正确的目录加载 hook。
  // 注：这就是文件头说的「顺序即知识」的第一例。hook 配置来自
  //     `<cwd>/.claude/settings.json` + 用户级 + 企业托管级（多来源合并）。
  //     如果先抓快照再 setCwd，读到的可能是「上一个目录」的配置 —— 而且这种 bug
  //     不会报错，只会表现得像「我的 hook 有时生效有时不生效」。
  // 注：「avoid hidden hook modifications」这句指的是**会话期间**：
  //     抓成快照后，即使 settings.json 被别的进程改了，本会话执行 hook 也按快照走。
  const hooksStart = Date.now()
  captureHooksConfigSnapshot()
  logForDiagnosticsNoPII('info', 'setup_hooks_captured', {
    duration_ms: Date.now() - hooksStart,
  })
  // 译：记录 hook 抓取耗时（毫秒）
  // 注：这三行是标准的「性能埋点」范式：取时间 → 干活 → 带上耗时写日志。
  //     不需要 try/finally，因为这里不需要保证日志一定写出（挂了也就算了）。

  // Initialize FileChanged hook watcher — sync, reads hook config snapshot
  // 译：初始化「文件变更」hook 的监听器 —— 同步执行，读取的是上面的 hook 配置快照
  // 注：注释特意强调 sync（同步），因为这一句必须在前一句之后**同一轮**完成：
  //     监听器要读刚抓好的快照。如果它是异步的，就可能出现「监听器已启动但快照还没就绪」。
  //     另外同步也意味着它会阻塞启动 —— 所以它内部一定只做「读配置 + 装 fs.watch」，
  //     不能有网络请求。
  initializeFileChangedWatcher(cwd)

  // ── 8. 第六件事：处理 git worktree（本文件唯一有实质分支的一大段）──────────────

  // Handle worktree creation if requested
  // IMPORTANT: this must be called befiore getCommands(), otherwise /eject won't be available.
  // 译：如果请求了 worktree，就创建它。
  //     重要：这必须在 getCommands() 之前调用，否则 /eject 将不可用。
  // 注：`befiore` 是原文里的拼写错误（应为 before），按约定原样保留。
  // 注：为什么 /eject 依赖这个顺序？/eject 的功能是「从 worktree 里退出来、回到主仓库」，
  //     它只在「当前会话确实处于 worktree 中」时才该出现在命令表里。
  //     而 getCommands() 是 memoized 的 —— 谁先算谁定终身。所以要在状态就绪后再让它算。
  //     这是「隐式依赖」的典型：两个模块谁也没 import 谁，靠**调用顺序**耦合。
  if (worktreeEnabled) {
    // Mirrors bridgeMain.ts: hook-configured sessions can proceed without git
    // so createWorktreeForSession() can delegate to the hook (non-git VCS).
    // 译：与 bridgeMain.ts 的做法保持一致：配了 hook 的会话可以不是 git 仓库，
    //     这样 createWorktreeForSession() 就能把创建动作委托给 hook（支持非 git 的版本控制）。
    // 注：「Mirrors X」是这份代码里常见的注释 —— 说明同样的判断在另一个入口也有，
    //     两处必须保持一致。看到这种注释，改动时就要两边都改。
    const hasHook = hasWorktreeCreateHook()
    const inGit = await getIsGit()
    // 注：hasHook 的实现（utils/hooks.ts:4910-4920）分两级查：
    //       1. 先看第 166 行抓的 hook 配置**快照**里有没有 WorktreeCreate；
    //       2. 再看运行时注册的 hooks（插件带来的），并遵守 managed-only 模式
    //          （企业只允许托管 hook 时，插件来源的 hook 被跳过）。
    //     ——顺带又是一个顺序依赖：如果 captureHooksConfigSnapshot() 晚于这里，
    //     快照就是空的，配了 hook 的用户会被误判成「没有 hook」而直接退出。
    //     inGit 是异步的（要执行 git 命令或查缓存）。
    if (!hasHook && !inGit) {
      // 注：两者都没有 → 无路可走。注意用的是「与非」：
      //     只要**有其一**就放行（hook 能兜住非 git 场景）。
      process.stderr.write(
        chalk.red(
          `Error: Can only use --worktree in a git repository, but ${chalk.bold(cwd)} is not a git repository. ` +
            `Configure a WorktreeCreate hook in settings.json to use --worktree with other VCS systems.\n`,
        ),
      )
      // 译：红字：--worktree 只能在 git 仓库里用，但 <cwd> 不是 git 仓库。
      //     要在其他版本控制系统里用 --worktree，请在 settings.json 里配置 WorktreeCreate hook。
      // 注：这里用 process.stderr.write 而不是 console.error，因为要自己控制结尾的 \n
      //     （console.error 会再加一个换行，导致多一个空行）。
      // 注：错误信息里用 chalk.bold(cwd) 把路径加粗 —— 让用户一眼看到「它以为的目录是哪个」，
      //     因为「我明明在仓库里」的情况，多半是启动目录搞错了。
      process.exit(1)
    }

    const slug = worktreePRNumber
      ? `pr-${worktreePRNumber}`
      : (worktreeName ?? getPlanSlug())
    // 注：三优先级决定这个工作树叫什么：
    //       1. 关联 PR 号 → "pr-1234"（可以从 PR 直接拉起一个工作树去修它）
    //       2. 用户给的 --worktree <name>
    //       3. 兜底：当前计划名（getPlanSlug）
    //     这个 slug 会同时用于分支名和 tmux 会话名。

    // Git preamble runs whenever we're in a git repo — even if a hook is
    // configured — so --tmux keeps working for git users who also have a
    // WorktreeCreate hook. Only hook-only (non-git) mode skips it.
    // 译：只要在 git 仓库里就执行这段 git 前置处理 —— 即使配了 hook 也执行 ——
    //     这样「既有 WorktreeCreate hook、又在 git 仓库里」的用户 --tmux 也照常可用。
    //     只有「纯 hook（非 git）」模式才跳过它。
    // 注：这段注释在解释一个很容易写错的判断：`if (inGit)` 而不是 `else`。
    //     因为「有 hook」和「在 git 里」不是互斥的，两个都可能成立；
    //     而 git 用户需要的那部分准备（找主仓库、算 tmux 名字）在两种情况下都要做。
    let tmuxSessionName: string | undefined
    if (inGit) {
      // Resolve to main repo root (handles being invoked from within a worktree).
      // findCanonicalGitRoot is sync/filesystem-only/memoized; the underlying
      // findGitRoot cache was already warmed by getIsGit() above, so this is ~free.
      // 译：解析到**主仓库**根目录（处理「本身就在某个 worktree 里被调用」的情况）。
      //     findCanonicalGitRoot 是同步的、只碰文件系统、且有缓存；
      //     它底层的 findGitRoot 缓存已经被上面的 getIsGit() 预热过，所以这一步几乎零成本。
      const mainRepoRoot = findCanonicalGitRoot(getCwd())
      // 注：为什么非要「主仓库根」？因为 git worktree add 必须在主仓库执行 ——
      //     在一个 worktree 里再开 worktree 是行不通的（worktree 只是主仓库的一个挂载视图）。
      //     所以「用户已经在 worktree 里了，又敲 --worktree」这种情况必须跳回主仓库。
      // 注：「缓存预热」这个说法值得注意：注释在解释为什么这里可以同步调用而不担心性能，
      //     原因是**上一个调用已经把缓存填好了**。这种跨调用的隐式性能依赖，
      //     在注释里写清楚才不会被人误删成异步。
      if (!mainRepoRoot) {
        process.stderr.write(
          chalk.red(
            `Error: Could not determine the main git repository root.\n`,
          ),
        )
        process.exit(1)
        // 注：getIsGit() 说「在仓库里」，但找不到主仓库根 —— 矛盾状态
        //     （可能是 .git 文件损坏、或者是权限问题）。这种情况只能退出。
      }

      // If we're inside a worktree, switch to the main repo for worktree creation
      // 译：如果我们本身就在某个 worktree 里，切到主仓库去创建工作树
      if (mainRepoRoot !== (findGitRoot(getCwd()) ?? getCwd())) {
        // 注：这个判断的写法很紧凑，拆开看是：
        //       findGitRoot(cwd)      → 从当前目录往上找到的 .git 所在目录
        //                               （如果在 worktree 里，这是 worktree 自己的目录）
        //       ?? getCwd()           → 万一没找到就用当前目录
        //       与 mainRepoRoot 比较   → 不相等，说明「当前所在的根 ≠ 主仓库根」= 我在 worktree 里
        logForDiagnosticsNoPII('info', 'worktree_resolved_to_main_repo')
        process.chdir(mainRepoRoot)
        setCwd(mainRepoRoot)
        // 注：注意这里两个都调了 —— process.chdir 改真实进程目录（因为接下来要执行
        //     git worktree add，子进程继承这个 cwd），setCwd 同步内部状态。
        //     这就是前面第 7 段说的「两者区别」的实际用例。
      }

      tmuxSessionName = tmuxEnabled
        ? generateTmuxSessionName(mainRepoRoot, worktreeBranchName(slug))
        : undefined
      // 注：tmux 会话名 = 由「主仓库路径 + 分支名」生成（内部只取路径的 basename）。
      //     未开 --tmux 就是 undefined —— 用一个变量同时表达「名字」和「要不要建」，
      //     省掉一个额外的布尔量（后面第 249 行就用 `tmuxEnabled && tmuxSessionName` 双保险）。
    } else {
      // Non-git hook mode: no canonical root to resolve, so name the tmux
      // session from cwd — generateTmuxSessionName only basenames the path.
      // 译：非 git 的 hook 模式：没有主仓库根可解析，所以用 cwd 来命名 tmux 会话 ——
      //     generateTmuxSessionName 只会取路径的 basename。
      // 注：这一支说明「非 git 场景下 --tmux 仍然可用」，只是名字里的路径部分换成 cwd。
      tmuxSessionName = tmuxEnabled
        ? generateTmuxSessionName(getCwd(), worktreeBranchName(slug))
        : undefined
    }

    let worktreeSession: Awaited<ReturnType<typeof createWorktreeForSession>>
    // 注：这一行类型声明是本文件里最"TS 味"的一处，值得拆开看：
    //       ReturnType<typeof createWorktreeForSession>        → 那个函数返回的 Promise<X>
    //       Awaited<...>                                       → 把 Promise 剥掉，得到 X
    //     为什么不直接写 X 的类型？因为 X 没有单独导出 —— 它是函数的返回值类型。
    //     用 ReturnType + Awaited 就能「在不 import 类型的情况下拿到类型」，
    //     好处是函数改了返回结构，这里的类型自动跟着变，不会脱节。
    // 注：`let` 而不是 `const`，因为它在 try 里赋值、在 try 外用 —— 这是常见但略脏的写法
    //     （严格来说 TS 无法证明它一定被赋值，靠下面的 catch 里 process.exit 才成立）。
    try {
      worktreeSession = await createWorktreeForSession(
        getSessionId(),
        slug,
        tmuxSessionName,
        worktreePRNumber ? { prNumber: worktreePRNumber } : undefined,
      )
      // 注：四个参数：会话 ID（用于状态关联）、slug（名字）、tmux 会话名（可空）、
      //     以及可选的 PR 号对象。
      //     最后一个参数用三元写成 `cond ? {prNumber} : undefined` 而不是 `{prNumber: cond ? n : undefined}`，
      //     是为了让「没有 PR 时完全不下发这个键」—— 两者的语义在下层可能不同。
    } catch (error) {
      process.stderr.write(
        chalk.red(`Error creating worktree: ${errorMessage(error)}\n`),
      )
      process.exit(1)
      // 注：这里 catch 了所有异常并统一退出。worktree 建不起来 = 用户要的隔离环境不存在，
      //     继续跑就会在错误的目录里改代码，所以宁可不跑。
      //     注意用 errorMessage(error) 而不是 error.message：后者在 error 不是 Error 时会炸。
    }

    logEvent('tengu_worktree_created', { tmux_enabled: tmuxEnabled })
    // 译：上报事件 tengu_worktree_created（带一个字段：是否开了 tmux）
    // 注：`tengu_` 前缀贯穿全项目的分析事件名。这些事件走 analytics，不是日志；
    //     对学习来说可以当噪音跳过，但它们也透露了「作者关心什么指标」——
    //     这里关心的是「有多少人用 worktree，其中多少配了 tmux」。

    // Create tmux session for the worktree if enabled
    // 译：如果开了 tmux，就给这个工作树创建一个 tmux 会话
    if (tmuxEnabled && tmuxSessionName) {
      // 注：双条件 —— tmuxEnabled 是用户的意图，tmuxSessionName 是实际算出来的名字
      //     （理论上开了 tmux 就一定有名，但类型上 name 是可选的，所以要再收窄一次）。
      const tmuxResult = await createTmuxSessionForWorktree(
        tmuxSessionName,
        worktreeSession.worktreePath,
      )
      if (tmuxResult.created) {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.log(
          chalk.green(
            `Created tmux session: ${chalk.bold(tmuxSessionName)}\nTo attach: ${chalk.bold(`tmux attach -t ${tmuxSessionName}`)}`,
          ),
        )
        // 译：绿字：已创建 tmux 会话：<名字>
        //     接入方式：tmux attach -t <名字>
        // 注：又是「把下一步操作直接写成可复制命令」。而且命令部分加粗了，
        //     用户在终端里能一眼分辨哪段是要敲的。
      } else {
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(
          chalk.yellow(
            `Warning: Failed to create tmux session: ${tmuxResult.error}`,
          ),
        )
        // 译：黄字警告：创建 tmux 会话失败：<错误>
        // 注：注意这里是「警告 + 继续」，而不是 process.exit。
        //     对比上面 createWorktreeForSession 失败就直接退出 —— 差别在于
        //     「worktree 是不是核心诉求」：worktree 是用户要的隔离环境，没有就不该跑；
        //     tmux 只是「顺便帮我开个窗口」的便利功能，失败了照样能用。
        //     这种「按功能重要性决定错误严重级」的判断，贯穿整个启动流程。
      }
    }

    process.chdir(worktreeSession.worktreePath)
    setCwd(worktreeSession.worktreePath)
    setOriginalCwd(getCwd())
    // 注：这里三个调用，语义各不相同，是全文件最容易看糊的地方：
    //       process.chdir(...)   → 真的把进程目录搬到工作树里（子进程、相对路径全部跟着变）
    //       setCwd(...)          → 同步内部状态（UI 显示的路径、getCwd() 的返回值）
    //       setOriginalCwd(...)  → 记录「原本的起点」
    //     为什么 originalCwd 要单独记？因为之后所有「回到主目录」的操作（/eject、文件搜索回退、
    //     路径显示）都需要区分「我现在在哪」和「我最初在哪」。
    //     注意 setOriginalCwd(getCwd()) 传的是**刚设好的** cwd —— 即 worktree 目录。
    //     也就是说 worktree 模式下「原始目录」被重定义为工作树，这是有意的：
    //     本次会话的项目就是这棵树（见下一句注释）。
    // --worktree means the worktree IS the session's project, so skills/hooks/
    // cron/etc. should resolve here. (EnterWorktreeTool mid-session does NOT
    // touch projectRoot — that's a throwaway worktree, project stays stable.)
    // 译：--worktree 意味着工作树**就是**本次会话的项目，所以 skills/hooks/cron 等都应在这里解析。
    //     （会话中途的 EnterWorktreeTool 不会动 projectRoot —— 那是一次性的临时工作树，项目保持不变。）
    // 注：这段话划清了两条完全不同的 worktree 语义，很值得记：
    //     · 启动时 --worktree   → 工作树 = 项目根，所有按项目解析的东西都跟着走
    //     · 会话中途进入工作树  → 只是换了个干活的地方，项目根不动
    //     差别会导致「hooks 从哪读」这种实际行为不同，所以作者专门写注释钉住。
    setProjectRoot(getCwd())
    saveWorktreeState(worktreeSession)
    // 注：把工作树信息持久化进会话存储 —— /resume 恢复会话时才知道该回到哪棵树。
    // Clear memory files cache since originalCwd has changed
    // 译：因为 originalCwd 变了，清空记忆文件缓存
    // 注：CLAUDE.md 这类记忆文件是按目录路径缓存的。目录换了，缓存里的内容就全错，
    //     所以要主动清。这是「缓存键里含路径」时必做的收尾动作。
    clearMemoryFileCaches()
    // Settings cache was populated in init() (via applySafeConfigEnvironmentVariables)
    // and again at captureHooksConfigSnapshot() above, both from the original dir's
    // .claude/settings.json. Re-read from the worktree and re-capture hooks.
    // 译：设置缓存之前在 init() 里（通过 applySafeConfigEnvironmentVariables）读过一次，
    //     上面 captureHooksConfigSnapshot() 又从**原目录**的 .claude/settings.json 读了一次。
    //     现在要从工作树重新读设置、重新抓 hook。
    // 注：这段话把自己前面的工作否掉了一半 —— 第 166 行抓的快照是基于原目录的，
    //     现在目录变成了工作树，所以必须再抓一次。
    //     为什么不干脆等 worktree 建好再抓第一次？因为 worktree 的创建本身**可能依赖 hook**
    //     （WorktreeCreate hook），也就是必须先有快照才能建树。这是个循环依赖，
    //     解法就是「先抓一次给它用，建完再抓一次覆盖」。
    //     ——这是本文件里最不显眼、但最能体现真实工程权衡的一处。
    updateHooksConfigSnapshot()
  }

  // ── 9. 第七件事：注册必须在「第一次问模型之前」就位的东西 ──────────────────────
  //
  // 从这里开始，代码的性质变了：前面都是「准备好环境」（阻塞、必须成功），
  // 这里变成「发射一堆后台任务」（大多不等结果）。
  // 判断标准就一句注释里的 "only critical registrations that must happen before first query"
  // —— 只放「第一次请求模型之前必须就位」的注册，其余全推后。

  // Background jobs - only critical registrations that must happen before first query
  // 译：后台任务 —— 只放那些必须在第一次查询之前完成的关键注册
  logForDiagnosticsNoPII('info', 'setup_background_jobs_starting')
  // Bundled skills/plugins are registered in main.tsx before the parallel
  // getCommands() kick — see comment there. Moved out of setup() because
  // the await points above (startUdsMessaging, ~20ms) meant getCommands()
  // raced ahead and memoized an empty bundledSkills list.
  // 译：内置技能/插件在 main.tsx 里、在并行启动 getCommands() 之前就注册好了 —— 见那里的注释。
  //     之所以从 setup() 里挪出去，是因为上面那些 await 点（startUdsMessaging，约 20ms）
  //     会让并行的 getCommands() 抢先跑完，从而把一份**空的** bundledSkills 列表缓存下来。
  // 注：这是全文件最值得反复读的一段，它记录了一个真实的竞态 bug：
  //     main() 里 setup() 和 getCommands() 是并行跑的（见文件头第 0 段）。
  //     原本「注册内置技能」写在 setup() 里，但它前面有约 20ms 的 await；
  //     而 getCommands() 已经开始执行并**把结果 memoize 了** —— memoize 就是「算一次，之后永远用这份」。
  //     等 setup() 走到注册那一步，getCommands 早就缓存了一份没有内置技能的表。
  //     修法不是加锁，而是**把注册挪到并行启动点之前**（main.tsx:1923-1926），
  //     让它变成纯内存的数组 push（注释说 <1ms、零 IO），从而必然先于 getCommands。
  // 注：教训可以一句话概括：**并行化会把「隐式顺序依赖」变成竞态**。
  //     只要有 memoize，谁先算谁定终身。
  if (!isBareMode()) {
    initSessionMemory() // Synchronous - registers hook, gate check happens lazily
    // 译：同步执行 —— 只注册 hook，门禁判断推迟到真正触发时
    // 注：又是「判断推迟」的套路（和 initSinks 排队是同一思路）。
    //     现在不判断「要不要记忆」，因为判断可能要读配置、查开关；
    //     等真有对话要保存时再判断，那时才有必要付这个成本。
    if (feature('CONTEXT_COLLAPSE')) {
      // 注：上下文折叠（context collapse）—— 一种比「压缩摘要」更激进的省 token 手段。
      /* eslint-disable @typescript-eslint/no-require-imports */
      // 译：下面这段豁免「禁止用 require」规则
      ;(
        require('./services/contextCollapse/index.js') as typeof import('./services/contextCollapse/index.js')
      ).initContextCollapse()
      // 注：这段写法是本文件最怪的一行，三个技巧叠在一起，逐个拆：
      //   1. 行首那个 `;` —— 因为上一行是 `/* eslint-disable */` 注释？不是。
      //      真正的原因是：这一行以 `(` 开头，而 JS 有 ASI（自动分号插入），
      //      如果前一条语句没写分号、下一行又以 ( 开头，会被解析成「函数调用」。
      //      行首加分号是防御性写法（这个项目不写行尾分号，所以经常需要它）。
      //   2. 为什么用 require 而不是 import？因为要在**函数体内**、按 feature() 开关
      //      条件加载。`await import()` 会引入一个 await 点（又会产生竞态），
      //      而 require 是同步的 —— 这里要的正是「同步、就地、不打断流程」。
      //   3. `as typeof import(...)` —— 给 require 的结果补上类型。
      //      require 在 TS 里返回 any，这么写等于「告诉编译器：它的类型就是那个模块的类型」，
      //      于是后面的 .initContextCollapse() 有补全、有检查。
      /* eslint-enable @typescript-eslint/no-require-imports */
      // 译：恢复「禁止用 require」规则
    }
  }
  void lockCurrentVersion() // Lock current version to prevent deletion by other processes
  // 译：锁住当前版本，防止被其他进程删除
  // 注：**`void` 是本节的主角**，到这里已经出现 6 次（lockCurrentVersion、
  //     getCommands、loadPluginHooks、registerAttributionHooks、sessionFileAccess、
  //     startTeamMemoryWatcher、prefetchApiKey）。它有两个作用，都很重要：
  //       ① 显式告诉读者「我不等这个 Promise」—— 这是 fire-and-forget（发射后不管）
  //       ② 关掉 lint 的「未处理 Promise」警告
  //     为什么能不等？因为这些都是「装监听器」「抢锁」「预热缓存」，
  //     晚 20ms 完成不影响正确性，但等它就会拖慢启动。
  // 注：代价是**错误会变成 unhandledRejection**（没人 catch）。
  //     所以你会看到 main.tsx 里给这些 promise 补 `.catch(() => {})`（第 1932 行），
  //     那是为了防止「启动 28ms 窗口内的瞬时 rejection」把进程搞崩。
  logForDiagnosticsNoPII('info', 'setup_background_jobs_launched')
  // 注：这条日志的位置很讲究 —— 它在「发射」之后而不是「完成」之后。
  //     因为它标记的是「后台任务已全部发出」，从而让日志上的
  //     starting → launched 区间精确等于「发射这一段代码」的耗时，不含异步等待。

  // ── 10. 第八件事：预热（prefetch）—— 把「第一次用时要等」的东西提前拉好 ────────

  profileCheckpoint('setup_before_prefetch')
  // Pre-fetch promises - only items needed before render
  // 译：预取用的 Promise —— 只包含渲染之前就需要的东西
  // 注：「before render」是这里的判定标准，和上一段的「before first query」是两个不同的门槛：
  //     · before first query —— 更早、更硬：缺了模型就答不对（如命令表、hook）
  //     · before render      —— 晚一点也行：只是界面第一帧会闪/慢
  //     这个文件里两个门槛交替出现，读的时候留意每段属于哪个。
  logForDiagnosticsNoPII('info', 'setup_prefetch_starting')
  // When CLAUDE_CODE_SYNC_PLUGIN_INSTALL is set, skip all plugin prefetch.
  // The sync install path in print.ts calls refreshPluginState() after
  // installing, which reloads commands, hooks, and agents. Prefetching here
  // races with the install (concurrent copyPluginToVersionedCache / cachePlugin
  // on the same directories), and the hot-reload handler fires clearPluginCache()
  // mid-install when policySettings arrives.
  // 译：当设置了 CLAUDE_CODE_SYNC_PLUGIN_INSTALL 时，跳过所有插件预取。
  //     print.ts 里的同步安装路径会在装完后调用 refreshPluginState()，
  //     那一步会重新加载命令、hook 和子代理。在这里预取会与安装过程**抢跑**
  //     （两边同时对同一批目录做 copyPluginToVersionedCache / cachePlugin），
  //     而且当 policySettings 到达时，热重载处理器会在安装中途触发 clearPluginCache()。
  // 注：这是本文件第二处「竞态」记录，而且是**同一类问题的反面**：
  //     上面那处竞态是靠「把注册提前到并行点之前」解决的；
  //     这里的竞态没法靠调顺序解决（因为两边都是长任务、会交错），
  //     只能靠**一个环境变量彻底不同时做**。
  //     判断依据：能靠顺序解决的用顺序，不能的用开关。
  const skipPluginPrefetch =
    (getIsNonInteractiveSession() &&
      isEnvTruthy(process.env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL)) ||
    // --bare: loadPluginHooks → loadAllPlugins is filesystem work that's
    // wasted when executeHooks early-returns under --bare anyway.
    // 译：--bare 模式下：loadPluginHooks → loadAllPlugins 是纯文件系统劳动，
    //     而 --bare 下 executeHooks 本来就会提前返回，所以这份劳动是白费的。
    // 注：注意这里对 bare 的判断比上面那处（第 313 行第一支）更狠：
    //     第一支只挡「非交互 + 同步安装」，第二支无条件挡 bare。
    isBareMode()
  // 注：注意第一支判断用了 `getIsNonInteractiveSession() && isEnvTruthy(...)`：
  //     为什么要加 non-interactive 这个条件？因为 CLAUDE_CODE_SYNC_PLUGIN_INSTALL
  //     只在脚本/CI 场景下有意义的，交互模式下设了它也不该改变行为。
  //     ——这种「一个环境变量只在一个模式下生效」的收窄，是防止配置互相污染的好习惯。
  if (!skipPluginPrefetch) {
    void getCommands(getProjectRoot())
    // 译：不等结果，先把命令表算好（memoized，所以这一次算完后面全免费）
    // 注：注意传的是 getProjectRoot() 而不是 cwd —— 命令可能来自项目根的 .claude/commands，
    //     而 worktree 模式下 cwd ≠ projectRoot 的情况是存在的。
  }
  void import('./utils/plugins/loadPluginHooks.js').then(m => {
    if (!skipPluginPrefetch) {
      void m.loadPluginHooks() // Pre-load plugin hooks (consumed by processSessionStartHooks before render)
      // 译：预加载插件带来的 hook（会被 processSessionStartHooks 在渲染之前消费）
      // 注：「consumed by ... before render」说明这里有个**时间窗要求**：
      //     预加载必须赶在 SessionStart hook 执行之前完成。这是「预热」而不是「随便跑跑」的原因。
      m.setupPluginHookHotReload() // Set up hot reload for plugin hooks when settings change
      // 译：设置插件 hook 的热重载（设置变化时自动重载）
      // 注：这个是同步的、必须执行 —— 注意它在 if 外面吗？不，也在里面。
      //     也就是说 bare 模式下连热重载都不装（bare 模式根本不会执行 hook）。
    }
  })
  // --bare: skip attribution hook install + repo classification +
  // session-file-access analytics + team memory watcher. These are background
  // bookkeeping for commit attribution + usage metrics — scripted calls don't
  // commit code, and the 49ms attribution hook stat check (measured) is pure
  // overhead. NOT an early-return: the --dangerously-skip-permissions safety
  // gate, tengu_started beacon, and apiKeyHelper prefetch below must still run.
  // 译：--bare 模式下跳过：归属 hook 安装 + 仓库分类 + 会话文件访问分析 + 团队记忆监听。
  //     这些是给「提交归属」和「用量指标」做后台记账的 —— 脚本化调用不会提交代码，
  //     而归属 hook 那次 stat 检查实测要 49ms，纯属额外开销。
  //     注意：这里**不是提前返回**（early-return）—— 下面的
  //     --dangerously-skip-permissions 安全门禁、tengu_started 埋点、
  //     apiKeyHelper 预取仍然必须执行。
  // 注：最后那句话是在教一个很容易犯的错：想「跳过一堆东西」时，
  //     最省事的写法是函数开头 `if (bare) return`，但那会连**该做的**也一起跳掉。
  //     这里用的是「逐块包 if」，代价是缩进变深，换来的是「安全门禁不会被跳过」。
  //     安全相关的代码绝不能放在一个「可能被整体跳过」的分支后面。
  if (!isBareMode()) {
    if (process.env.USER_TYPE === 'ant') {
      // Prime repo classification cache for auto-undercover mode. Default is
      // undercover ON until proven internal; if this resolves to internal, clear
      // the prompt cache so the next turn picks up the OFF state.
      // 译：为「自动隐身模式」预热仓库分类缓存。默认是**隐身开启**，直到证明这是内部仓库；
      //     如果判定为内部仓库，就清掉提示词缓存，让下一轮用上「隐身关闭」的状态。
      // 注：这是内部员工专用逻辑（USER_TYPE === 'ant'），外部版本里整段不会执行。
      //     但它示范了一个安全默认值的写法：**默认取最保守的值（隐身），
      //     判定后如果该放松，再主动清缓存让新状态生效**。
      //     清缓存这一步是关键：不清的话，已经缓存好的系统提示词里还写着「隐身」，
      //     光改状态变量没用。
      void import('./utils/commitAttribution.js').then(async m => {
        if (await m.isInternalModelRepo()) {
          const { clearSystemPromptSections } = await import(
            './constants/systemPromptSections.js'
          )
          clearSystemPromptSections()
        }
      })
      // 注：注意 `void import(...).then(async m => ...)` 这个组合：
      //     外层 void 表示「整条链不等」，内层 async 又允许链内部再 await 别的动态导入。
      //     于是整段变成：发射 → （某时刻）判仓库类型 → （若是内部）再加载一个模块 → 清缓存。
      //     完全没有阻塞启动。
    }
    if (feature('COMMIT_ATTRIBUTION')) {
      // Dynamic import to enable dead code elimination (module contains excluded strings).
      // Defer to next tick so the git subprocess spawn runs after first render
      // rather than during the setup() microtask window.
      // 译：用动态导入以便做死代码消除（那个模块里含有需要排除的字符串）。
      //     推迟到下一个 tick，好让 git 子进程在第一次渲染之后才 spawn，
      //     而不是在 setup() 的微任务窗口里。
      // 注：两个知识点：
      //     ① 「模块含 excluded strings」——内部有不可外泄的字符串（模型代号之类），
      //        所以必须动态导入，且构建时要能被整块删掉；
      //     ② setImmediate 的作用是把工作推到**当前微任务队列排空之后**。
      //        setup() 是 async 函数，它内部所有 await 之后都还在微任务里跑；
      //        用 setImmediate 才能真正「跳出去」，让出这一轮给渲染。
      //        这是控制启动时机的实用手法：不是「晚点执行」，而是「换到下一轮事件循环」。
      setImmediate(() => {
        void import('./utils/attributionHooks.js').then(
          ({ registerAttributionHooks }) => {
            registerAttributionHooks() // Register attribution tracking hooks (ant-only feature)
            // 译：注册「提交归属」追踪 hook（内部员工专属功能）
          },
        )
      })
    }
    void import('./utils/sessionFileAccessHooks.js').then(m =>
      m.registerSessionFileAccessHooks(),
    ) // Register session file access analytics hooks
    // 译：注册「会话文件访问」分析 hook
    // 注：功能上就是「记录模型读了哪些文件」。用途是统计与产品改进；
    //     对学架构的人只需知道一点：**它是 hook，不是内嵌在工具里**，
    //     所以任何工具（包括你自己写的）读文件都会被覆盖到。
    if (feature('TEAMMEM')) {
      void import('./services/teamMemorySync/watcher.js').then(m =>
        m.startTeamMemoryWatcher(),
      ) // Start team memory sync watcher
      // 译：启动团队记忆同步监听器
      // 注：团队记忆 = 多人共享的一份 MEMORY.md 之类，靠 watcher 监听变化并同步。
      //     放在这里说明它属于「后台记账」，晚一点启动没关系。
    }
  }
  initSinks() // Attach error log + analytics sinks and drain queued events
  // 译：接上错误日志与分析数据两个 sink，并把排队中的事件排空
  // 注：**这一行是整个埋点系统的开关时刻**。机制在 analytics/index.ts:139-142：
  //       if (sink === null) { eventQueue.push(...); return }   ← 还没接就排队
  //       sink.logEvent(...)                                    ← 接了就直接送
  //     所以前面那些 logEvent 都没有丢，只是排在队列里；initSinks() 负责接上 sink 并排空队列
  //     （sinks.ts 的注释原话就是 "draining any events queued before attachment"）。
  // 注：sinks.ts 里还有一条架构痕迹值得看：它被特意拆成独立模块，注释说
  //     "kept out of setup.ts to avoid the setup → commands → bridge → setup import cycle"
  //     —— 因为它被 setup.ts 和另几个绕过 setup 的入口（daemon / bridge / 子命令）都要用，
  //     放进 setup.ts 就会形成循环导入。**判断一个模块该不该独立，看的是「谁依赖它」。**
  // 注：它也是下面那个 tengu_started 必须放在这里的原因 —— 见下一段。

  // Session-success-rate denominator. Emit immediately after the analytics
  // sink is attached — before any parsing, fetching, or I/O that could throw.
  // inc-3694 (P0 CHANGELOG crash) threw at checkForReleaseNotes below; every
  // event after this point was dead. This beacon is the earliest reliable
  // "process started" signal for release health monitoring.
  // 译：这是「会话成功率」的分母。紧接在分析 sink 接好之后立刻发出 ——
  //     早于任何可能抛错的解析、抓取或 IO。
  //     inc-3694（P0 级 CHANGELOG 崩溃）就是在这个 checkForReleaseNotes 处抛的，
  //     导致它之后的每个事件都没发出去。这个 beacon 是发布健康监控里
  //     最早期、最可靠的「进程已启动」信号。
  // 注：这段注释是整份源码里最好的「事故复盘」样本，值得逐句拆：
  //     · 什么是「分母」？会话成功率 = 发出 tengu_started 的会话数 / 启动的会话数。
  //       如果这个事件发晚了，崩在它之前的会话就不会被计入分母，
  //       于是「成功率」会假性偏高 —— 崩得越多，指标越好看。
  //     · 事故原因：它原来放在 checkForReleaseNotes（下面第 387 行）之后，
  //       而那一步在一次版本里抛异常，于是它自己也没发出去，后面的全死。
  //     · 修法：把 beacon **前移到「第一个可能抛错的 IO」之前**，紧跟 sink 接好之后。
  //     这是「监控点要放在故障点上游」的经典例子。
  logEvent('tengu_started', {})
  // 译：上报事件 tengu_started（无附加字段）
  // 注：注意它是 logEvent 而不是 void logEvent —— 但 logEvent 本身是同步入队（不返回 Promise），
  //     所以这里不需要 void。真正决定「什么时候发出去」的是上一行的 initSinks()。

  void prefetchApiKeyFromApiKeyHelperIfSafe(getIsNonInteractiveSession()) // Prefetch safely - only executes if trust already confirmed
  // 译：安全地预取 API Key —— 只有在信任关系已确认时才真正执行
  // 注：把 getIsNonInteractiveSession() 传进去，是因为两种模式下取 key 的策略不同
  //     （交互模式可以弹窗让用户确认，非交互模式只能靠已保存的信任状态）。
  //     注意函数名里 IfSafe 和注释里的 "trust already confirmed"：
  //     这里的信任判断来自前面 init() 阶段用户对项目的确认，不是这里临时问。
  profileCheckpoint('setup_after_prefetch')
  // 注：和 setup_before_prefetch 配对，这两个点之间的耗时 = 整段预热。

  // ── 11. 第九件事：给启动 logo 画面备数据（唯一一处「为了好看」的阻塞）─────────

  // Pre-fetch data for Logo v2 - await to ensure it's ready before logo renders.
  // --bare / SIMPLE: skip — release notes are interactive-UI display data,
  // and getRecentActivity() reads up to 10 session JSONL files.
  // 译：为 Logo v2 预取数据 —— 这里要 await，确保 logo 渲染之前数据就绪。
  //     --bare / SIMPLE 下跳过 —— 更新日志是交互界面的展示数据，
  //     而 getRecentActivity() 最多要读 10 个会话 JSONL 文件。
  // 注：这是本文件第二处**阻塞**的 await（第一处是终端备份恢复），
  //     而且理由很"奢侈"：为了让启动画面好看。但作者接受了，因为
  //     ① 它有明确的 UI 依赖（不 await 就会先渲染空 logo 再补内容，视觉上更糟）
  //     ② 它被 !isBareMode() 严格挡住（脚本模式一毫秒都不花）
  //     这个取舍值得记：**阻塞不是错，无条件的阻塞才是错**。
  if (!isBareMode()) {
    const { hasReleaseNotes } = await checkForReleaseNotes(
      getGlobalConfig().lastReleaseNotesSeen,
    )
    // 注：传入「上次看到哪一版」，返回「有没有新内容要展示」。
    if (hasReleaseNotes) {
      await getRecentActivity()
      // 注：第二层 await 是条件性的 —— 只有真有新日志才去读那 10 个 JSONL。
      //     这种「先便宜判断、再昂贵操作」的分层，在本文件里反复出现，是很值得抄的模式。
    }
  }

  // ── 12. 第十件事：危险模式的最后一道闸（安全相关，务必细读）───────────────────

  // If permission mode is set to bypass, verify we're in a safe environment
  // 译：如果权限模式被设为「绕过权限」，则校验我们处在一个安全的环境里
  // 注：「bypassPermissions」= 所有工具调用都不再问用户，直接执行。
  //     这是整个产品最危险的开关，所以启动时要做两道环境校验。
  //     注意它**没有被 !isBareMode() 包住** —— 前面第 9 段那句注释特意强调过：
  //     "the --dangerously-skip-permissions safety gate ... must still run"。
  //     **能跳过的是便利功能，不能跳过的是安全门禁。**
  if (
    permissionMode === 'bypassPermissions' ||
    allowDangerouslySkipPermissions
  ) {
    // 注：两个条件是「或」关系，因为它们是两条不同的入口：
    //     permissionMode 是配置/状态里设的模式（可能来自 settings.json 或 /permissions）；
    //     allowDangerouslySkipPermissions 是命令行 --dangerously-skip-permissions 的布尔量。
    //     任一条成立就得做校验 —— 少了任何一个，就等于给另一条路留了后门。
    // Check if running as root/sudo on Unix-like systems
    // Allow root if in a sandbox (e.g., TPU devspaces that require root)
    // 译：检查是否在类 Unix 系统上以 root/sudo 身份运行。
    //     如果在沙箱里则允许 root（例如某些 TPU 开发环境必须以 root 运行）。
    if (
      process.platform !== 'win32' &&
      // 注：Windows 没有 root 概念，直接跳过这一条。
      typeof process.getuid === 'function' &&
      // 注：getuid 只有类 Unix 才有。先判类型再调用，避免在 Windows 上 `process.getuid()` 直接 TypeError。
      //     这是「特性检测」而不是「平台枚举」的稳妥写法 —— 虽然上面已经有 platform 判断，
      //     双保险让这段在任何奇怪环境里都不会炸。
      process.getuid() === 0 &&
      // 注：uid 0 就是 root。
      process.env.IS_SANDBOX !== '1' &&
      !isEnvTruthy(process.env.CLAUDE_CODE_BUBBLEWRAP)
      // 注：两个豁免条件：
      //     IS_SANDBOX=1          → 明确声明「我在沙箱里」（TPU devspace 这类必须 root 的环境）
      //     CLAUDE_CODE_BUBBLEWRAP → 在 bubblewrap 沙箱里
      //     逻辑是「是 root 且**不在**任何沙箱里」才拒绝。注意用 isEnvTruthy 而不是 ==='true'，
      //     与上面 IS_SANDBOX 的 ==='1' 写法不一致 —— 这是历史遗留的小不统一（不影响正确性）。
    ) {
      // biome-ignore lint/suspicious/noConsole:: intentional console output
      console.error(
        `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`,
      )
      // 译：出于安全考虑，--dangerously-skip-permissions 不能以 root/sudo 权限使用
      // 注：为什么禁 root？因为一旦不询问权限、又以 root 跑，模型（或被注入的内容）
      //     执行一条 `rm -rf /` 或改写系统文件就没有任何拦截。
      //     普通用户身份至少还有操作系统的文件权限当最后一道墙。
      process.exit(1)
    }

    if (
      process.env.USER_TYPE === 'ant' &&
      // 注：以下整段是内部员工专属（ants）的更严格校验 —— 对外部用户不生效。
      //     但它示范的安全思路对谁都成立，值得读完。
      // Skip for Desktop's local agent mode — same trust model as CCR/BYOC
      // (trusted Anthropic-managed launcher intentionally pre-approving everything).
      // Precedent: permissionSetup.ts:861, applySettingsChange.ts:55 (PR #19116)
      // 译：Desktop 的 local agent 模式跳过此校验 —— 它与 CCR/BYOC 是同一套信任模型
      //     （可信的、由 Anthropic 管理的启动器有意预先批准一切）。
      //     先例：permissionSetup.ts:861、applySettingsChange.ts:55（PR #19116）
      process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent' &&
      // Same for CCD (Claude Code in Desktop) — apps#29127 passes the flag
      // unconditionally to unlock mid-session bypass switching
      // 译：CCD（Claude Code in Desktop）同理 —— apps#29127 会无条件传这个标志，
      //     以便在会话中途能切换到 bypass 模式
      process.env.CLAUDE_CODE_ENTRYPOINT !== 'claude-desktop'
      // 注：两个豁免都是「入口类型」判断。这里能学到一个现实：
      //     同一个安全策略，在不同**启动方式**下信任级别不同。
      //     Desktop 是 Anthropic 自己的进程拉起来的，用户可以认为"我信任这个客户端"；
      //     而 CLI 是用户自己在任意目录里敲的，上下文完全不可控。
      //     注释里给 PR 号（#19116、apps#29127）是很好的习惯 —— 后来的人能查到「为什么这么写」。
    ) {
      // Only await if permission mode is set to bypass
      // 译：只有权限模式真是 bypass 时才 await（做这两个可能较慢的探测）
      const [isDocker, hasInternet] = await Promise.all([
        envDynamic.getIsDocker(),
        env.hasInternetAccess(),
      ])
      // 注：Promise.all 并行探测两件事 —— 串行的话最坏要等两倍时间。
      //     数组解构按顺序拿结果，和 Promise.all 的参数顺序对应。
      //     这两个探测都可能读文件/发网络请求，所以放在「已经确定是 bypass」之后才做。
      const isBubblewrap = envDynamic.getIsBubblewrapSandbox()
      const isSandbox = process.env.IS_SANDBOX === '1'
      const isSandboxed = isDocker || isBubblewrap || isSandbox
      // 注：三种沙箱任一是就认为「在沙箱里」。
      if (!isSandboxed || hasInternet) {
        // 注：这是本文件逻辑最精妙的一行，两个条件都要看清：
        //       !isSandboxed → 不在沙箱里            → 拒绝
        //       hasInternet  → 在沙箱里但**能上网**  → 也拒绝
        //     也就是说进入这个 if 的所有情况都是「不该放行」的：
        //     不在沙箱 = 能摸到真实文件系统；能上网 = 被注入的指令可以把数据传出去。
        //     反过来，只有「在沙箱里且离线」才允许 bypass —— 因为那时候即使模型乱来，
        //     破坏范围也被容器和断网限制住了。
        // biome-ignore lint/suspicious/noConsole:: intentional console output
        console.error(
          `--dangerously-skip-permissions can only be used in Docker/sandbox containers with no internet access but got Docker: ${isDocker}, Bubblewrap: ${isBubblewrap}, IS_SANDBOX: ${isSandbox}, hasInternet: ${hasInternet}`,
        )
        // 译：--dangerously-skip-permissions 只能在**无网络的 Docker/沙箱容器**里使用，
        //     但检测到 Docker: <是/否>, Bubblewrap: <>, IS_SANDBOX: <>, hasInternet: <>
        // 注：把四个探测结果全部原样打出来 —— 用户一眼能看出是哪一项不满足。
        //     这比 "sandbox check failed" 有用得多，是「可诊断的错误信息」的范本。
        process.exit(1)
      }
    }
  }

  // ── 13. 第十一件事：测试环境下到此为止 ────────────────────────────────────────

  if (process.env.NODE_ENV === 'test') {
    return
    // 注：单元测试跑到这里就直接返回，跳过下面「上报上个会话退出事件」那段。
    //     为什么？因为那一段会读项目配置、发网络事件 —— 测试里既不该有副作用，也不该依赖磁盘状态。
    //     注意位置很讲究：放在安全校验**之后**。
    //     如果放在函数最开头，测试就永远覆盖不到 bypass 那两道闸 —— 而安全逻辑恰恰最需要被测到。
  }

  // ── 14. 第十二件事：替**上一个**会话补发退出事件（本文件唯一处理"历史"的地方）─────

  // Log tengu_exit event from the last session?
  // 译：要不要把**上一个**会话的退出事件补报一下？
  // 注：这个问题式的注释说明它是一个「有条件才做」的动作。
  //     为什么是"上一个会话"？因为进程被强杀（Ctrl-C 太快、崩溃、kill -9）时，
  //     退出事件来不及发。上一次的统计就丢在 projectConfig 里，等下次启动补发。
  //     这是「客户端崩溃也要保住指标」的常见补救设计。
  const projectConfig = getCurrentProjectConfig()
  if (
    projectConfig.lastCost !== undefined &&
    projectConfig.lastDuration !== undefined
  ) {
    // 注：只判两个字段是否存在就够了 —— 它们代表「上次确实正常跑过并记录过」。
    //     不判全部十几个字段，是因为那些字段可能某些版本才有；
    //     用两个最核心的（花费、时长）当「有记录」的标志。
    logEvent('tengu_exit', {
      last_session_cost: projectConfig.lastCost,
      last_session_api_duration: projectConfig.lastAPIDuration,
      last_session_tool_duration: projectConfig.lastToolDuration,
      last_session_duration: projectConfig.lastDuration,
      last_session_lines_added: projectConfig.lastLinesAdded,
      last_session_lines_removed: projectConfig.lastLinesRemoved,
      last_session_total_input_tokens: projectConfig.lastTotalInputTokens,
      last_session_total_output_tokens: projectConfig.lastTotalOutputTokens,
      last_session_total_cache_creation_input_tokens:
        projectConfig.lastTotalCacheCreationInputTokens,
      last_session_total_cache_read_input_tokens:
        projectConfig.lastTotalCacheReadInputTokens,
      last_session_fps_average: projectConfig.lastFpsAverage,
      last_session_fps_low_1_pct: projectConfig.lastFpsLow1Pct,
      last_session_id:
        projectConfig.lastSessionId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...projectConfig.lastSessionMetrics,
    })
    // 注：这一大坨字段可以当「一个会话都被记了哪些指标」的清单来读：
    //     成本、API 耗时、工具耗时、总时长、增删行数、输入/输出 token、
    //     缓存写入/读取 token、FPS 均值、FPS 1% 低值（卡顿指标）、会话 ID、以及一堆杂项指标。
    // 注：`last_session_id` 那行的类型断言（as AnalyticsMetadata_...）就是本文件第 1 段提到的
    //     「合规签字」：明确声明这个字符串不是代码也不是文件路径，才允许进埋点。
    //     注意它是**唯一**一个做了断言字段 —— 因为 ID 看起来太像任意字符串，
    //     编译器/审查都会盯着它。
    // 注：最后的 `...projectConfig.lastSessionMetrics` 是「展开一个动态对象」，
    //     意味着还有一批字段是运行时才知道名字的（版本迭代里加的指标）。
    //     TS 里允许这么写是因为 LogEventMetadata 的索引签名接受任意键。
    // Note: We intentionally don't clear these values after logging.
    // They're needed for cost restoration when resuming sessions.
    // The values will be overwritten when the next session exits.
    // 译：注意：上报之后我们**有意不**清空这些值。
    //     因为恢复会话（/resume）时需要它们来还原成本统计。
    //     下一次会话退出时这些值会被覆盖。
    // 注：这解释了一个反直觉的设计：**补报之后不清零，会导致同一个 last_session 被报两次吗？**
    //     会的 —— 如果用户连续启动又不退出，每次启动都会把上一次的数据再报一遍。
    //     作者接受这个重复，换「/resume 时成本数据不丢」。
    //     这种「指标轻微重复 vs 用户可见数据丢失」的取舍，在这个位置选了后者优先。
  }
}

// ── 15. 全文件总结：setup() 教的三件事 ────────────────────────────────────────
//
// 一、**启动代码的价值在顺序，不在算法。**
//   本文件 477 行没有一行在做业务计算，全部是「调用别人的函数，但调用次序正确」。
//   三个真实依赖（cwd → hooks → worktree → commands）都写在大写 IMPORTANT 注释里，
//   说明作者知道这类知识最容易在重构中丢失，所以用注释钉住。
//
// 二、**并行化会把隐式顺序依赖变成竞态。**
//   main() 让 setup() 和 getCommands() 并行（省时间），代价是出现了两个 bug：
//     · 内置技能注册太晚 → getCommands 缓存了空列表（解法：把注册挪到并行点之前）
//     · 插件预取和同步安装抢同一批目录（解法：用环境变量彻底不同时做）
//   能靠顺序解决的用顺序，不能的用开关。这句话可以直接套用到你自己的项目里。
//
// 三、**错误严重性要分级，安全门禁不许被任何开关跳过。**
//   全文对「失败怎么办」有四种处理，按危害递增：
//     记日志继续（终端备份恢复失败）→ 警告继续（tmux 创建失败）
//     → 致命退出（Node 版本低 / 不是 git 仓库 / worktree 创建失败）
//     → 致命退出且**不受任何模式影响**（root + bypassPermissions）
//   判断标准始终是「这件事失败会不会影响正确性/安全性」，而不是「代码在哪一段」。
//
// 顺带记住三个手法，以后写启动代码都能用：
//   void import(...)      发射后不管 —— 装监听器、预热缓存
//   setImmediate(...)     换到下一轮事件循环 —— 让出微任务窗口给渲染
//   ;(require(...) as ...)  条件同步加载 —— 避免制造新的 await 点





