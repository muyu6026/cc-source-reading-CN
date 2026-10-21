// ═══ 文件导读：这个文件回答的问题 ═══
//
// 上一个文件 bashSecurity.ts 回答的是「这条命令能不能被**可信地解析**」；
// 这个文件回答的是「解析完之后，**要不要放行**」。
//
// 一句话概括整个文件：
//     把一条 bash 命令拆成子命令 → 每个子命令查 deny/ask/allow 规则
//     → 看路径约束 / sed 约束 / 当前权限模式 → 都没结论就问用户
//
// 结构上有个非常特别的地方，读之前必须先知道，否则会觉得作者在乱抽函数：
//
//   2621 行里，主函数 `bashToolHasPermission`（第 1663 行起）独占 895 行，
//   而中间有 5 个小函数（skipTimeoutFlags / filterCdCwdSubcommands /
//   checkEarlyExitDeny / checkSemanticsDeny / buildPendingClassifierCheck）
//   都是**纯粹为了给主函数减行数**才拆出来的 —— 不是为了复用，不是为了可读性。
//
//   原因写在下面第 81 行那段注释里：Bun 打包器的 `feature()` 求值器对
//   单个函数有复杂度预算，超了就静默把 `feature('BASH_CLASSIFIER')` 判成
//   false，整段代码被当死码删掉。这是本项目最反直觉的一条约束。
import { feature } from 'bun:bundle'
// 注：`feature` 来自 'bun:bundle' —— 这不是 npm 包，是 Bun 打包器内置的虚拟模块。
//     它只在构建期存在，作用是「死代码消除开关」：feature('X') 在构建时被替换成
//     字面量 true/false，为 false 的分支整段从产物里消失。
//     所以本文件里所有 feature(...) 都是**构建期**判断，不是运行期。
import { APIUserAbortError } from '@anthropic-ai/sdk'
// 注：`APIUserAbortError` 是 SDK 层的「主动取消」异常。它和本地 AbortError 的区分
//     在下面 executeAsyncClassifierCheck 里很关键：两者都算「正常取消」，
//     不该冒出 unhandled rejection；其他错误必须重新抛。
import type { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
// 注：GrowthBook 缓存读取。注意函数名里那句 CACHED_MAY_BE_STALE ——
//     它读的是内存里的缓存值，不发起网络请求，可能已经过期。
//     用在「解析前的快速开关」上是合适的：这里要的是快，不是准确。
// 注：`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 不是一个真实类型，
//     而是一个「品牌类型」，专门用来逼调用者做自我声明：
//     你往埋点里塞字符串，就得手写这个超长类型名，等于签字确认
//     「我核对过了，这不是用户代码、不是文件路径」。
//     埋点泄露源码内容是这个项目最忌讳的事情之一，所以用类型系统当门禁。
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
// 注：`ToolPermissionContext` 是整个权限系统的中枢状态，包含三种 rule 列表
//     （allow / ask / deny）、当前 mode、以及工作目录范围等。
//     `ToolUseContext` 是更外层的「这一次工具调用」的上下文，多一个 abortController
//     和 getAppState()。区别值得记：权限判定要读前者，取消信号在后者。
import type { PendingClassifierCheck } from '../../types/permissions.js'
import { count } from '../../utils/array.js'
// 注：下面这组来自 `utils/bash/ast.ts` —— tree-sitter 解析的产物。
//     `parseForSecurityFromAst` 把语法树归约成「安全视角」的结论：
//     要么是一串可信的 SimpleCommand（引号已解析、无隐藏替换），
//     要么是 'too-complex'（结构太复杂，静态分析不可信）。
//     这个三分法是整个新权限体系的基石。
import {
  checkSemantics,
  nodeTypeId,
  type ParseForSecurityResult,
  parseForSecurityFromAst,
  type Redirect,
  type SimpleCommand,
} from '../../utils/bash/ast.js'
// 注：这里同时导入了 `splitCommand_DEPRECATED` 和下面的
//     `bashCommandIsSafeAsync_DEPRECATED`。两个 DEPRECATED 是历史包袱：
//     它们都基于正则/手写扫描，和 bash 自己的解析器有偏差（差异攻击链见
//     bashSecurity.ts 的批注）。新代码优先走 AST，走不了才回落到它们。
import {
  type CommandPrefixResult,
  extractOutputRedirections,
  getCommandSubcommandPrefix,
  splitCommand_DEPRECATED,
} from '../../utils/bash/commands.js'
import { parseCommandRaw } from '../../utils/bash/parser.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { AbortError } from '../../utils/errors.js'
import type {
  ClassifierBehavior,
  ClassifierResult,
} from '../../utils/permissions/bashClassifier.js'
import {
  classifyBashCommand,
  getBashPromptAllowDescriptions,
  getBashPromptAskDescriptions,
  getBashPromptDenyDescriptions,
  isClassifierPermissionsEnabled,
} from '../../utils/permissions/bashClassifier.js'
import type {
  PermissionDecisionReason,
  PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import type {
  PermissionRule,
  PermissionRuleValue,
} from '../../utils/permissions/PermissionRule.js'
import { extractRules } from '../../utils/permissions/PermissionUpdate.js'
import type { PermissionUpdate } from '../../utils/permissions/PermissionUpdateSchema.js'
import { permissionRuleValueToString } from '../../utils/permissions/permissionRuleParser.js'
import {
  createPermissionRequestMessage,
  getRuleByContentsForTool,
} from '../../utils/permissions/permissions.js'
import {
  parsePermissionRule,
  type ShellPermissionRule,
  matchWildcardPattern as sharedMatchWildcardPattern,
  permissionRuleExtractPrefix as sharedPermissionRuleExtractPrefix,
  suggestionForExactCommand as sharedSuggestionForExactCommand,
  suggestionForPrefix as sharedSuggestionForPrefix,
} from '../../utils/permissions/shellRuleMatching.js'
import { getPlatform } from '../../utils/platform.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { windowsPathToPosixPath } from '../../utils/windowsPaths.js'
// 注：`BashTool` 被本文件 import 进来只为了两件事：
//     ① `BashTool.name` 拼接话术和规则名；② `BashTool.isReadOnly(input)`
//     在第 1154 行做「只读命令直接放行」的判定。
//     注意这是**循环依赖**（BashTool.tsx 又 import 了本文件的 bashToolHasPermission），
//     靠 ESM 的惰性求值能成立，但任何在模块顶层就用 BashTool 的代码都会炸。
import { BashTool } from './BashTool.js'
import { checkCommandOperatorPermissions } from './bashCommandHelpers.js'
import {
  bashCommandIsSafeAsync_DEPRECATED,
  stripSafeHeredocSubstitutions,
} from './bashSecurity.js'
import { checkPermissionMode } from './modeValidation.js'
import { checkPathConstraints } from './pathValidation.js'
import { checkSedConstraints } from './sedValidation.js'
import { shouldUseSandbox } from './shouldUseSandbox.js'

// ═══ ① 这段注释是整个文件最该先读的：为什么要有那么多「莫名其妙的小函数」 ═══
// DCE cliff: Bun's feature() evaluator has a per-function complexity budget.
// bashToolHasPermission is right at the limit. `import { X as Y }` aliases
// inside the import block count toward this budget; when they push it over
// the threshold Bun can no longer prove feature('BASH_CLASSIFIER') is a
// constant and silently evaluates the ternaries to `false`, dropping every
// pendingClassifierCheck spread. Keep aliases as top-level const rebindings
// instead. (See also the comment on checkSemanticsDeny below.)
// 译：DCE 悬崖：Bun 的 feature() 求值器对**每个函数**有复杂度预算。
//     bashToolHasPermission 正好卡在边界上。import 块里的
//     `import { X as Y }` 别名也计入这个预算；一旦推过阈值，Bun 就无法证明
//     feature('BASH_CLASSIFIER') 是常量，会**静默**把那些三元表达式求值成 false，
//     从而丢掉每一处 pendingClassifierCheck 的展开。
//     所以把别名改写成顶层的 const 重绑定。（另见下面 checkSemanticsDeny 的注释。）
//
// 注：这条约束的可怕之处在于「静默」。
//     不是编译报错，不是运行时报错，而是：分类器自动放行这个功能**悄悄消失**。
//     线上表现是「以前会自动放行的命令现在都要问」，用户只会觉得烦，
//     不会想到是打包器把一个 feature 判成了 false。
//     作者的应对方式也不是重构，而是「把行数挪出去」—— 见第 630/1363/1389/1427 行
//     四处一模一样的注释，全是同一个原因。
// 注：这两行就是上面注释说的「顶层 const 重绑定」。
//     为什么不直接 `import { bashCommandIsSafeAsync_DEPRECATED as bashCommandIsSafeAsync }`？
//     因为别名会计入上面那个复杂度预算。改成 const 之后，import 语句里没有别名，
//     函数体里看到的只是一个普通标识符。
//
//     代价：读代码的人会疑惑「为什么要多这一层」。答案在打包器里，不在代码里。
const bashCommandIsSafeAsync = bashCommandIsSafeAsync_DEPRECATED
const splitCommand = splitCommand_DEPRECATED

// 注：`ENV_VAR_ASSIGN_RE` 只匹配「像环境变量赋值」的形状（NAME=...），
//     **不检查名字是否在安全白名单里**。白名单判断在三个 while 循环里各做一次。
//     这种「正则管形状、Set 管名单」的分工在本文件反复出现。
// Env-var assignment prefix (VAR=value). Shared across three while-loops that
// skip safe env vars before extracting the command name.
const ENV_VAR_ASSIGN_RE = /^[A-Za-z_]\w*=/

// ═══ ② CC-643：子命令数量上限，一个真实的性能事故 ═══
// CC-643: On complex compound commands, splitCommand_DEPRECATED can produce a
// very large subcommands array (possible exponential growth; #21405's ReDoS fix
// may have been incomplete). Each subcommand then runs tree-sitter parse +
// ~20 validators + logEvent (bashSecurity.ts), and with memoized metadata the
// resulting microtask chain starves the event loop — REPL freeze at 100% CPU,
// strace showed /proc/self/stat reads at ~127Hz with no epoll_wait. Fifty is
// generous: legitimate user commands don't split that wide. Above the cap we
// fall back to 'ask' (safe default — we can't prove safety, so we prompt).
// 译：CC-643：在复杂复合命令上，splitCommand_DEPRECATED 可能产出极长的
//     subcommands 数组（可能是指数级增长；#21405 的 ReDoS 修复也许并不完整）。
//     之后每个子命令都要跑 tree-sitter 解析 + 约 20 个 validator + logEvent，
//     配合 memoized 元数据，产生的 microtask 链会**饿死事件循环** ——
//     REPL 卡在 100% CPU，strace 显示以约 127Hz 读 /proc/self/stat 且没有 epoll_wait。
//     五十很宽松：正常用户命令不会切这么宽。超过上限就退化成 'ask'
//     （安全默认 —— 我们无法证明安全，那就问）。
//
// 注：这是本项目里少见的一份「完整事故报告」写法，值得学它记录了什么：
//     ① 触发条件（复杂复合命令）② 怀疑的根因（指数增长 + 未修完的 ReDoS）
//     ③ 放大链路（每子命令 ~20 个 validator）④ 可观测现象（100% CPU）
//     ⑤ 诊断证据（strace 的 127Hz、缺 epoll_wait）⑥ 阈值为什么取 50（宽松）
//     ⑦ 超限后的降级策略，以及为什么降级到 ask 而不是 allow。
//     一条注释把「怎么发现的」也留下了，下次同类问题能顺着 strace 线索查。
export const MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50
// 注：**超限降级到 ask 而不是 deny**，这个选择有讲究：
//     deny 会让一条合法但写法复杂的命令直接失败；
//     ask 只是多问一句，用户看得懂命令，自己判断就行。
//     安全默认 = 「让人类接一下手」，不是「一律拒绝」。

// ═══ ③ GH#11380：复合命令的「建议规则」为什么最多 5 条 ═══
// GH#11380: Cap the number of per-subcommand rules suggested for compound
// commands. Beyond this, the "Yes, and don't ask again for X, Y, Z…" label
// degrades to "similar commands" anyway, and saving 10+ rules from one prompt
// is more likely noise than intent. Users chaining this many write commands
// in one && list are rare; they can always approve once and add rules manually.
// 译：给复合命令的每条子命令建议一条规则，但设上限。
//     超过这个数量，「是的，以后 X、Y、Z… 都不用问」这个标签本身就会退化成
//     「类似的命令」，而且从一个弹窗里保存 10+ 条规则更像噪音而非意图。
//     一条 && 链里串这么多写命令的用户很少；他们随时可以先批准一次、再手动加规则。
//
// 注：这里藏着一个 UI 与权限系统的耦合点 —— 建议规则的数量会改变
//     **弹窗文案的语义**（从明确列举退化成模糊概括）。所以上限不是性能考虑，
//     是「别让用户在没看清的情况下批量授权」的可用性考虑。
export const MAX_SUGGESTED_RULES_FOR_COMPOUND = 5

// 注：[ANT-ONLY] 前缀说明这是内部员工才走的分支。
//     判断方式在函数体第一行：`process.env.USER_TYPE !== 'ant'` 直接 return。
//     这类代码在外部构建里**存在但不执行** —— 和 feature() 的构建期删除不同，
//     这里代码还在包里，只是对非员工恒假。
/**
 * [ANT-ONLY] Log classifier evaluation results for analysis.
 * This helps us understand which classifier rules are being evaluated
 * and how the classifier is deciding on commands.
 */
function logClassifierResultForAnts(
// 注：注意签名里的四个参数都是「原始材料」：命令原文、behavior、描述列表、分类器结果。
//     它不做任何判断，只负责打包成埋点事件。
//
//     第 140 行那句注释 `command contains code/filepaths - this is ANT-ONLY so it's OK`
//     是整个埋点体系里唯一出现的例外：把用户命令原文上报。
//     理由只有一个 —— 限内部。这也解释了为什么这个函数叫 ForAnts 而不是 ForAnalytics。
  command: string,
  behavior: ClassifierBehavior,
  descriptions: string[],
  result: ClassifierResult,
): void {
  if (process.env.USER_TYPE !== 'ant') {
    return
  }

  logEvent('tengu_internal_bash_classifier_result', {
    behavior:
      behavior as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    descriptions: jsonStringify(
      descriptions,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    matches: result.matches,
    matchedDescription: (result.matchedDescription ??
      '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    confidence:
      result.confidence as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    reason:
      result.reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    // Note: command contains code/filepaths - this is ANT-ONLY so it's OK
    command:
      command as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

// ═══ ④ 前缀提取：什么样的命令值得「记住这一条」 ═══
/**
 * Extract a stable command prefix (command + subcommand) from a raw command string.
 * Skips leading env var assignments only if they are in SAFE_ENV_VARS (or
 * ANT_ONLY_SAFE_ENV_VARS for ant users). Returns null if a non-safe env var is
 * encountered (to fall back to exact match), or if the second token doesn't look
 * like a subcommand (lowercase alphanumeric, e.g., "commit", "run").
 *
 * Examples:
 *   'git commit -m "fix typo"' → 'git commit'
 *   'NODE_ENV=prod npm run build' → 'npm run' (NODE_ENV is safe)
 *   'MY_VAR=val npm run build' → null (MY_VAR is not safe)
 *   'ls -la' → null (flag, not a subcommand)
 *   'cat file.txt' → null (filename, not a subcommand)
 *   'chmod 755 file' → null (number, not a subcommand)
 */
// 译：从原始命令串里提取一个稳定的前缀（命令 + 子命令）。
//     只有当开头的环境变量赋值都在 SAFE_ENV_VARS（或员工的 ANT_ONLY_SAFE_ENV_VARS）
//     里时才跳过它们。遇到非安全的环境变量就返回 null（回落到精确匹配），
//     或者第二个 token 不像子命令（小写字母数字，如 "commit"、"run"）时也返回 null。
//
// 注：这段注释的四个例子是全文最有价值的自测题，逐条对一下：
//       'git commit -m "fix typo"'  → 'git commit'    ← 标准两词前缀
//       'NODE_ENV=prod npm run build' → 'npm run'     ← NODE_ENV 在白名单里，可以跳过
//       'MY_VAR=val npm run build'  → null            ← MY_VAR 不在，不能跳
//       'ls -la'                    → null            ← 第二词是 flag
//       'cat file.txt'              → null            ← 第二词是文件名
//       'chmod 755 file'            → null            ← 第二词是数字
export function getSimpleCommandPrefix(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  // Skip env var assignments (VAR=value) at the start, but only if they are
  // in SAFE_ENV_VARS (or ANT_ONLY_SAFE_ENV_VARS for ant users). If a non-safe
  // env var is encountered, return null to fall back to exact match. This
  // prevents generating prefix rules like Bash(npm run:*) that can never match
  // at allow-rule check time, because stripSafeWrappers only strips safe vars.
// 注：这个 while 循环的**返回值语义很容易看漏** —— 遇到非安全变量不是「跳过它继续」，
//     而是 `return null` 直接放弃提取。
//     原因在第 168-169 行：如果在这里生成了 `Bash(npm run:*)` 这样的前缀规则，
//     但规则匹配时 stripSafeWrappers 又不会剥掉 MY_VAR，那么这条规则
//     **永远不可能匹配上** —— 用户点了「以后不用问」，下次照样被问，还以为功能坏了。
//     宁可返回 null、只建议精确匹配，也不要生成一条永远失效的规则。
  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i]!)) {
    const varName = tokens[i]!.split('=')[0]!
    const isAntOnlySafe =
      process.env.USER_TYPE === 'ant' && ANT_ONLY_SAFE_ENV_VARS.has(varName)
    if (!SAFE_ENV_VARS.has(varName) && !isAntOnlySafe) {
      return null
    }
    i++
  }

  const remaining = tokens.slice(i)
  if (remaining.length < 2) return null
  const subcmd = remaining[1]!
// 注：`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/` 这个形状检查排除了四类东西：
//     以大写开头（环境变量残留）、含点或斜杠（文件路径 ./script.sh、/usr/bin/x）、
//     以横杠开头（flag）、纯数字（chmod 755 里的 755）。
//     允许中间带横杠，是为了 `docker-compose`、`git-lfs` 这种名字。
  // Second token must look like a subcommand (e.g., "commit", "run", "compose"),
  // not a flag (-rf), filename (file.txt), path (/tmp), URL, or number (755).
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(subcmd)) return null
  return remaining.slice(0, 2).join(' ')
}

// ═══ ⑤ BARE_SHELL_PREFIXES：哪些「前缀」永远不能建议给用户 ═══
// Bare-prefix suggestions like `bash:*` or `sh:*` would allow arbitrary code
// via `-c`. Wrapper suggestions like `env:*` or `sudo:*` would do the same:
// `env` is NOT in SAFE_WRAPPER_PATTERNS, so `env bash -c "evil"` survives
// stripSafeWrappers unchanged and hits the startsWith("env ") check at
// the prefix-rule matcher. Shell list mirrors DANGEROUS_SHELL_PREFIXES in
// src/utils/shell/prefix.ts which guarded the old Haiku extractor.
// 译：裸前缀建议像 `bash:*` 或 `sh:*` 会通过 `-c` 放行任意代码。
//     包装器建议像 `env:*` 或 `sudo:*` 也一样：`env` 不在 SAFE_WRAPPER_PATTERNS 里，
//     所以 `env bash -c "evil"` 会原样穿过 stripSafeWrappers，
//     撞上前缀匹配器里的 startsWith("env ") 检查。
//     这份 shell 列表对应 src/utils/shell/prefix.ts 的 DANGEROUS_SHELL_PREFIXES，
//     那个常量守护的是旧的 Haiku 提取器。
const BARE_SHELL_PREFIXES = new Set([
  'sh',
  'bash',
  'zsh',
  'fish',
  'csh',
  'tcsh',
  'ksh',
  'dash',
  'cmd',
  'powershell',
  'pwsh',
  // wrappers that exec their args as a command
// 注：`env` 和 `xargs` 被归进「会把自己的参数当命令执行的包装器」这一类。
//     它们的危险不在于名字本身，而在于 `env <任意命令>` 里的 `<任意命令>` 完全自由 ——
//     一条 `Bash(env:*)` 等于 `Bash(*)`。
  'env',
  'xargs',
  // SECURITY: checkSemantics (ast.ts) strips these wrappers to check the
  // wrapped command. Suggesting `Bash(nice:*)` would be ≈ `Bash(*)` — users
  // would add it after a prompt, then `nice rm -rf /` passes semantics while
  // deny/cd+git gates see 'nice' (SAFE_WRAPPER_PATTERNS below didn't strip
  // bare `nice` until this fix). Block these from ever being suggested.
// 注：`nice` / `stdbuf` / `nohup` / `timeout` / `time` 这一组的注释更狠：
//     checkSemantics（ast.ts）会把它们**剥掉**再检查里面的命令，
//     所以建议 `Bash(nice:*)` 约等于建议 `Bash(*)`：用户批准之后，
//     `nice rm -rf /` 在语义检查层看到的是 `rm -rf /`（放行），
//     而 deny 规则和 cd+git 门禁看到的却是 `nice`（不匹配）。
//     两套视角不一致 = 绕过。
//     注释里还记了一句：在修这个问题之前，SAFE_WRAPPER_PATTERNS 并没剥裸的 `nice`。
  'nice',
  'stdbuf',
  'nohup',
  'timeout',
  'time',
  // privilege escalation — sudo:* from `sudo -u foo ...` would auto-approve
  // any future sudo invocation
// 注：`sudo` / `doas` / `pkexec` 是提权三件套。注释说得很直接：
//     `sudo -u foo ...` 建议出来的 `sudo:*` 会**自动批准未来任何** sudo 调用。
//     一句话：提权命令不存在「安全的常用前缀」。
  'sudo',
  'doas',
  'pkexec',
])

// ═══ ⑥ 只给 UI 用的降级方案：拿第一个词当天真前缀 ═══
/**
 * UI-only fallback: extract the first word alone when getSimpleCommandPrefix
 * declines. In external builds TREE_SITTER_BASH is off, so the async
 * tree-sitter refinement in BashPermissionRequest never fires — without this,
 * pipes and compounds (`python3 file.py 2>&1 | tail -20`) dump into the
 * editable field verbatim.
 *
 * Deliberately not used by suggestionForExactCommand: a backend-suggested
 * `Bash(rm:*)` is too broad to auto-generate, but as an editable starting
 * point it's what users expect (Slack C07VBSHV7EV/p1772670433193449).
 *
 * Reuses the same SAFE_ENV_VARS gate as getSimpleCommandPrefix — a rule like
 * `Bash(python3:*)` can never match `RUN=/path python3 ...` at check time
 * because stripSafeWrappers won't strip RUN.
 */
// 译：仅 UI 用的兜底：getSimpleCommandPrefix 拒绝时（比如带管道或复合结构），
//     退化成只取第一个词。外部构建里 TREE_SITTER_BASH 是关的，
//     所以 BashPermissionRequest 里那个异步的 tree-sitter 精修永远不会触发 ——
//     没有这个兜底，管道和复合命令（`python3 file.py 2>&1 | tail -20`）
//     会被原封不动倒进可编辑输入框。
//
//     刻意不被 suggestionForExactCommand 使用：后端建议的 `Bash(rm:*)` 太宽，
//     不能自动生成，但作为「可编辑的起点」正是用户想要的。
//
//     复用与 getSimpleCommandPrefix 相同的 SAFE_ENV_VARS 门禁 —— 因为
//     `Bash(python3:*)` 这样的规则在检查时永远匹配不上 `RUN=/path python3 ...`。
export function getFirstWordPrefix(command: string): string | null {
  const tokens = command.trim().split(/\s+/).filter(Boolean)

  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i]!)) {
    const varName = tokens[i]!.split('=')[0]!
    const isAntOnlySafe =
      process.env.USER_TYPE === 'ant' && ANT_ONLY_SAFE_ENV_VARS.has(varName)
    if (!SAFE_ENV_VARS.has(varName) && !isAntOnlySafe) {
      return null
    }
    i++
  }

  const cmd = tokens[i]
  if (!cmd) return null
// 注：同一个形状正则、同一个 `BARE_SHELL_PREFIXES` 检查 ——
//     也就是说这个「天真兜底」也守住了 `bash` / `sudo` 这类绝对不能进输入框的名字。
//     天真是有底线的。
  // Same shape check as the subcommand regex in getSimpleCommandPrefix:
  // rejects paths (./script.sh, /usr/bin/python), flags, numbers, filenames.
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(cmd)) return null
  if (BARE_SHELL_PREFIXES.has(cmd)) return null
  return cmd
}

// ═══ ⑦ 建议规则的三级降级链：heredoc → 多行 → 两词前缀 → 精确 ═══
function suggestionForExactCommand(command: string): PermissionUpdate[] {
  // Heredoc commands contain multi-line content that changes each invocation,
  // making exact-match rules useless (they'll never match again). Extract a
  // stable prefix before the heredoc operator and suggest a prefix rule instead.
// 注：这个函数的每一步都在回答同一个问题：
//     「把这条命令原样存成规则，下次还用得上吗？」
//     规则系统的语义是**字符串匹配**，所以任何每次都变的部分（heredoc 内容、
//     多行正文）都必须剥掉，否则存下来的规则是一次性用品。
  const heredocPrefix = extractPrefixBeforeHeredoc(command)
  if (heredocPrefix) {
    return sharedSuggestionForPrefix(BashTool.name, heredocPrefix)
  }

// 注：多行命令走「第一行当前缀」。注释里点出一个很实在的后果：
//     把整段多行文本存进规则，会产生**中间带 `:*`** 的 pattern，
//     这种 pattern 过不了权限校验，会**写坏 settings 文件**。
//     这是「建议规则」这条链上唯一的破坏性失败模式，值得单独记一笔。
  // Multiline commands without heredoc also make poor exact-match rules.
  // Saving the full multiline text can produce patterns containing `:*` in
  // the middle, which fails permission validation and corrupts the settings
  // file. Use the first line as a prefix rule instead.
  if (command.includes('\n')) {
    const firstLine = command.split('\n')[0]!.trim()
    if (firstLine) {
      return sharedSuggestionForPrefix(BashTool.name, firstLine)
    }
  }

  // Single-line commands: extract a 2-word prefix for reusable rules.
  // Without this, exact-match rules are saved that never match future
  // invocations with different arguments.
// 注：单行命令先试两词前缀（`git commit` 这种），失败才退回精确匹配。
//     最后一行 `sharedSuggestionForExactCommand` 是真正的兜底 —— 只有
//     `ls -la` 这类既没 heredoc、也没换行、又提不出前缀的命令才走到这里。
  const prefix = getSimpleCommandPrefix(command)
  if (prefix) {
    return sharedSuggestionForPrefix(BashTool.name, prefix)
  }

  return sharedSuggestionForExactCommand(BashTool.name, command)
}

// ═══ ⑧ 三个「转手」导出：本文件只是壳 ═══
/**
 * If the command contains a heredoc (<<), extract the command prefix before it.
 * Returns the first word(s) before the heredoc operator as a stable prefix,
 * or null if the command doesn't contain a heredoc.
 *
 * Examples:
 *   'git commit -m "$(cat <<\'EOF\'\n...\nEOF\n)"' → 'git commit'
 *   'cat <<EOF\nhello\nEOF' → 'cat'
 *   'echo hello' → null (no heredoc)
 */
// 译：如果命令含 heredoc（<<），提取它之前的前缀，返回 heredoc 操作符前面的
//     第一个（或前两个）词作为稳定前缀；没有 heredoc 就返回 null。
//
// 注：`command.indexOf('<<')` 是纯字符串查找，不看引号、不看上下文。
//     所以 `grep '<<' file` 也会被当成 heredoc，然后去提取 `grep` 前缀 ——
//     结果是「提出一个还算合理的前缀」，而不是崩溃。失败模式是良性的。
function extractPrefixBeforeHeredoc(command: string): string | null {
  if (!command.includes('<<')) return null

  const idx = command.indexOf('<<')
  if (idx <= 0) return null

  const before = command.substring(0, idx).trim()
  if (!before) return null

  const prefix = getSimpleCommandPrefix(before)
  if (prefix) return prefix

  // Fallback: skip safe env var assignments and take up to 2 tokens.
  // This preserves flag tokens (e.g., "python3 -c" stays "python3 -c",
  // not just "python3") and skips safe env var prefixes like "NODE_ENV=test".
  // If a non-safe env var is encountered, return null to avoid generating
  // prefix rules that can never match (same rationale as getSimpleCommandPrefix).
  const tokens = before.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i]!)) {
    const varName = tokens[i]!.split('=')[0]!
    const isAntOnlySafe =
      process.env.USER_TYPE === 'ant' && ANT_ONLY_SAFE_ENV_VARS.has(varName)
    if (!SAFE_ENV_VARS.has(varName) && !isAntOnlySafe) {
      return null
    }
    i++
  }
  if (i >= tokens.length) return null
  return tokens.slice(i, i + 2).join(' ') || null
}

function suggestionForPrefix(prefix: string): PermissionUpdate[] {
  return sharedSuggestionForPrefix(BashTool.name, prefix)
}

// 注：从这一行往下连续三个导出，全是**纯转发**：
//       permissionRuleExtractPrefix → shared
//       matchWildcardPattern       → shared
//       bashPermissionRule         → shared
//     真正实现在 utils/permissions/shellRuleMatching.ts。
//     之所以要留这一层，是因为 PowerShell 工具共用同一套规则匹配逻辑，
//     而 bash 侧需要自己的「大小写敏感」等差异；抽到 shared 之后，
//     这里的转发同时充当「兼容旧 import 路径」的垫片。
/**
 * Extract prefix from legacy :* syntax (e.g., "npm:*" -> "npm")
 * Delegates to shared implementation.
 */
export const permissionRuleExtractPrefix = sharedPermissionRuleExtractPrefix

/**
 * Match a command against a wildcard pattern (case-sensitive for Bash).
 * Delegates to shared implementation.
 */
export function matchWildcardPattern(
  pattern: string,
  command: string,
): boolean {
  return sharedMatchWildcardPattern(pattern, command)
}

/**
 * Parse a permission rule into a structured rule object.
 * Delegates to shared implementation.
 */
export const bashPermissionRule: (
  permissionRule: string,
) => ShellPermissionRule = parsePermissionRule

// ═══ ⑨ SAFE_ENV_VARS：整份文件最需要「按禁忌读」的常量 ═══
/**
 * Whitelist of environment variables that are safe to strip from commands.
 * These variables CANNOT execute code or load libraries.
 *
 * SECURITY: These must NEVER be added to the whitelist:
 * - PATH, LD_PRELOAD, LD_LIBRARY_PATH, DYLD_* (execution/library loading)
 * - PYTHONPATH, NODE_PATH, CLASSPATH, RUBYLIB (module loading)
 * - GOFLAGS, RUSTFLAGS, NODE_OPTIONS (can contain code execution flags)
 * - HOME, TMPDIR, SHELL, BASH_ENV (affect system behavior)
 */
// 译：可以安全地从命令里剥掉的环境变量白名单。这些变量**不能**执行代码或加载库。
//
//     SECURITY：以下这些**永远**不能加进白名单：
//     - PATH、LD_PRELOAD、LD_LIBRARY_PATH、DYLD_*（执行 / 库加载）
//     - PYTHONPATH、NODE_PATH、CLASSPATH、RUBYLIB（模块加载）
//     - GOFLAGS、RUSTFLAGS、NODE_OPTIONS（可以藏代码执行开关）
//     - HOME、TMPDIR、SHELL、BASH_ENV（影响系统行为）
//
// 注：读这份白名单的正确方式是看「为什么这一类能进」：
//       GO*     只影响编译目标，不改变跑什么
//       RUST_*  只影响日志
//       NODE_ENV 只是一个字符串约定（**不是** NODE_OPTIONS）
//       PYTHONUNBUFFERED / PYTHONDONTWRITEBYTECODE 只影响输出与缓存
//       LC_* / LANG / TZ / TERM / COLOR 只影响显示
//       ANTHROPIC_API_KEY 是认证 —— 剥掉它不改变执行的程序
//     而「禁忌清单」里那些的共同点只有一个：**能改变实际执行的代码**。
//     这条线划得非常干净，可以作为自己项目里同类白名单的判据。
const SAFE_ENV_VARS = new Set([
  // Go - build/runtime settings only
  'GOEXPERIMENT', // experimental features
  'GOOS', // target OS
  'GOARCH', // target architecture
  'CGO_ENABLED', // enable/disable CGO
  'GO111MODULE', // module mode

  // Rust - logging/debugging only
  'RUST_BACKTRACE', // backtrace verbosity
  'RUST_LOG', // logging filter

  // Node - environment name only (not NODE_OPTIONS!)
  'NODE_ENV',

  // Python - behavior flags only (not PYTHONPATH!)
  'PYTHONUNBUFFERED', // disable buffering
  'PYTHONDONTWRITEBYTECODE', // no .pyc files

  // Pytest - test configuration
  'PYTEST_DISABLE_PLUGIN_AUTOLOAD', // disable plugin loading
  'PYTEST_DEBUG', // debug output

  // API keys and authentication
// 注：`ANTHROPIC_API_KEY` 出现在「安全可剥」名单里，第一眼会让人紧张。
//     想清楚就明白了：剥掉它意味着命令**少了**认证能力，不会多出执行能力。
//     白名单判据是「能不能执行代码」，不是「是不是敏感信息」。
  'ANTHROPIC_API_KEY', // API authentication

  // Locale and character encoding
  'LANG', // default locale
  'LANGUAGE', // language preference list
  'LC_ALL', // override all locale settings
  'LC_CTYPE', // character classification
  'LC_TIME', // time format
  'CHARSET', // character set preference

  // Terminal and display
  'TERM', // terminal type
  'COLORTERM', // color terminal indicator
  'NO_COLOR', // disable color output (universal standard)
  'FORCE_COLOR', // force color output
  'TZ', // timezone

  // Color configuration for various tools
  'LS_COLORS', // colors for ls (GNU)
  'LSCOLORS', // colors for ls (BSD/macOS)
  'GREP_COLOR', // grep match color (deprecated)
  'GREP_COLORS', // grep color scheme
  'GCC_COLORS', // GCC diagnostic colors

  // Display formatting
  'TIME_STYLE', // time display format for ls
  'BLOCK_SIZE', // block size for du/df
  'BLOCKSIZE', // alternative block size
])

// ═══ ⑩ ANT_ONLY_SAFE_ENV_VARS：一份明确的「不能给外部用户」清单 ═══
/**
 * ANT-ONLY environment variables that are safe to strip from commands.
 * These are only enabled when USER_TYPE === 'ant'.
 *
 * SECURITY: These env vars are stripped before permission-rule matching, which
 * means `DOCKER_HOST=tcp://evil.com docker ps` matches a `Bash(docker ps:*)`
 * rule after stripping. This is INTENTIONALLY ANT-ONLY (gated at line ~380)
 * and MUST NEVER ship to external users. DOCKER_HOST redirects the Docker
 * daemon endpoint — stripping it defeats prefix-based permission restrictions
 * by hiding the network endpoint from the permission check. KUBECONFIG
 * similarly controls which cluster kubectl talks to. These are convenience
 * strippings for internal power users who accept the risk.
 *
 * Based on analysis of 30 days of tengu_internal_bash_tool_use_permission_request events.
 */
// 译：仅限员工使用的、可安全剥除的环境变量。只在 USER_TYPE === 'ant' 时生效。
//
//     SECURITY：这些变量会在权限规则匹配**之前**被剥掉，意味着
//     `DOCKER_HOST=tcp://evil.com docker ps` 会匹配上 `Bash(docker ps:*)` 规则。
//     这**刻意**只给内部用（第 590 行附近有门禁）且**绝不能**发给外部用户。
//     DOCKER_HOST 会重定向 Docker daemon 端点 —— 剥掉它等于把网络端点藏起来，
//     从而破坏基于前缀的权限限制。KUBECONFIG 同理，控制 kubectl 连哪个集群。
//     这些是给接受风险的内部高级用户的便利性剥离。
//
//     结论来自对 30 天 tengu_internal_bash_tool_use_permission_request 事件的分析。
const ANT_ONLY_SAFE_ENV_VARS = new Set([
// 注：这份名单里有几个值得单独看一眼的：
//       KUBECONFIG / DOCKER_HOST  ← 直接换目标，最危险的两个
//       GH_TOKEN / PGPASSWORD     ← 注释写「已批准的凭据子集，不改变外泄风险」
//                                    逻辑是：本来就在命令行里，剥掉不增加风险
//       CI / SKIP_NODE_VERSION_CHECK ← 纯布尔开关
//     注意 `CLUSTER` 这种泛型名字也在里面 —— 泛型名意味着「任何叫 CLUSTER 的
//     环境变量都会被剥」，包括用户自己定义的。这在员工场景可接受，外部不可接受。
  // Kubernetes and container config (config file pointers, not execution)
  'KUBECONFIG', // kubectl config file path — controls which cluster kubectl uses
  'DOCKER_HOST', // Docker daemon socket/endpoint — controls which daemon docker talks to

  // Cloud provider project/profile selection (just names/identifiers)
  'AWS_PROFILE', // AWS profile name selection
  'CLOUDSDK_CORE_PROJECT', // GCP project ID
  'CLUSTER', // generic cluster name

  // Anthropic internal cluster selection (just names/identifiers)
  'COO_CLUSTER', // coo cluster name
  'COO_CLUSTER_NAME', // coo cluster name (alternate)
  'COO_NAMESPACE', // coo namespace
  'COO_LAUNCH_YAML_DRY_RUN', // dry run mode

  // Feature flags (boolean/string flags only)
  'SKIP_NODE_VERSION_CHECK', // skip version check
  'EXPECTTEST_ACCEPT', // accept test expectations
  'CI', // CI environment indicator
  'GIT_LFS_SKIP_SMUDGE', // skip LFS downloads

  // GPU/Device selection (just device IDs)
  'CUDA_VISIBLE_DEVICES', // GPU device selection
  'JAX_PLATFORMS', // JAX platform selection

  // Display/terminal settings
  'COLUMNS', // terminal width
  'TMUX', // TMUX socket info

  // Test/debug configuration
  'POSTGRESQL_VERSION', // postgres version string
  'FIRESTORE_EMULATOR_HOST', // emulator host:port
  'HARNESS_QUIET', // quiet mode flag
  'TEST_CROSSCHECK_LISTS_MATCH_UPDATE', // test update flag
  'DBT_PER_DEVELOPER_ENVIRONMENTS', // DBT config
  'STATSIG_FORD_DB_CHECKS', // statsig DB check flag

  // Build configuration
  'ANT_ENVIRONMENT', // Anthropic environment name
  'ANT_SERVICE', // Anthropic service name
  'MONOREPO_ROOT_DIR', // monorepo root path

  // Version selectors
  'PYENV_VERSION', // Python version selection

  // Credentials (approved subset - these don't change exfil risk)
  'PGPASSWORD', // Postgres password
  'GH_TOKEN', // GitHub token
  'GROWTHBOOK_API_KEY', // self-hosted growthbook
])

// ═══ ⑪ stripCommentLines：一个「看不见引号」的行过滤器 ═══
/**
 * Strips full-line comments from a command.
 * This handles cases where Claude adds comments in bash commands, e.g.:
 *   "# Check the logs directory\nls /home/user/logs"
 * Should be stripped to: "ls /home/user/logs"
 *
 * Only strips full-line comments (lines where the entire line is a comment),
 * not inline comments that appear after a command on the same line.
 */
// 译：剥掉整行注释。处理模型爱在 bash 命令里写注释的情况，例如：
//       "# Check the logs directory\nls /home/user/logs"
//     应该被剥成 "ls /home/user/logs"。
//
//     只剥**整行**注释（整行都是注释的行），不剥行内注释（命令后面跟的 #）。
function stripCommentLines(command: string): string {
// 注：**这个函数完全不认识引号。** 它逐行 trim，然后 `startsWith('#')` 就删掉整行。
//
//     这不是疏忽，而是整个 bashSecurity「引号内换行」漏洞的另一半：
//     在 `mv ./decoy '<换行>#' ~/.ssh/id_rsa` 里，第二行以 `#` 开头，
//     于是被这里整行删掉，路径校验只看到 `./decoy`（在项目内）→ acceptEdits 自动放行。
//     而 bash 那边，引号里的换行是**内容的一部分**，两条路径都真的被 mv。
//
//     这个漏洞在上游由两层防御兜住：bashSecurity 的 validateQuotedNewline 会
//     对带引号内换行的命令直接 ask；tree-sitter AST 路径下 checkSemantics 也会
//     拒绝含换行的 argv 元素（bashPermissions.ts:1800 的注释明确提到这一点）。
//     换句话说：**这个函数不安全，但调用它的地方都先确认过安全**。
//     读到这里应该建立一个习惯 —— 看到可疑的字符串处理，先去找它的护栏在哪。
  const lines = command.split('\n')
  const nonCommentLines = lines.filter(line => {
    const trimmed = line.trim()
    // Keep lines that are not empty and don't start with #
    return trimmed !== '' && !trimmed.startsWith('#')
  })

// 注：全部行都是注释/空行时返回原始命令，而不是空字符串。
//     这个细节很重要：返回空串会让后续所有校验面对一条「空命令」，
//     空命令通常意味着「无事可做」，可能被当成 trivially safe 放行。
//     返回原文则至少让后续检查看到真实内容（哪怕它全是注释）。
  // If all lines were comments/empty, return original
  if (nonCommentLines.length === 0) {
    return command
  }

  return nonCommentLines.join('\n')
}

// ═══ ⑫ stripSafeWrappers：把「包装器」剥掉，露出真正执行的命令 ═══
//
// 为什么需要它：用户写了 `timeout 10 npm install foo`，规则里存的是
// `Bash(npm install:*)`。如果不剥掉 `timeout 10`，规则永远匹配不上 ——
// 用户会觉得「我明明允许过这个命令」。
//
// 但「剥」这件事本身就是攻击面：剥错了，检查看到的是 A，bash 执行的是 B。
// 这个函数的每一段注释几乎都是一次漏洞修复记录。
export function stripSafeWrappers(command: string): string {
  // SECURITY: Use [ \t]+ not \s+ — \s matches \n/\r which are command
  // separators in bash. Matching across a newline would strip the wrapper from
  // one line and leave a different command on the next line for bash to execute.
  //
  // SECURITY: `(?:--[ \t]+)?` consumes the wrapper's own `--` so
  // `nohup -- rm -- -/../foo` strips to `rm -- -/../foo` (not `-- rm ...`
  // which would skip path validation with `--` as an unknown baseCmd).
// 译：SECURITY：用 `[ \t]+` 而不是 `\s+` —— `\s` 会匹配 \n 和 \r，
//     而它们在 bash 里是命令分隔符。跨换行匹配会把某一行的包装器剥掉，
//     却把另一个命令留在下一行给 bash 执行。
//
// 注：这条规矩在本文件里出现了三次（第 525、570、748 行），
//     是全项目最高频的一条「安全正则纪律」：
//     **凡是匹配「命令之间的空白」，只能用 [ \t]，绝不能用 \s。**
//     原因在 bashSecurity 里已经用完整攻击链印证过：
//     `TZ=UTC\recho curl evil.com` 在 JS 的 \s 下是「两个词」，在 bash 的 IFS 下是「一个词」。
// 译：SECURITY：`(?:--[ \t]+)?` 消费掉包装器自己的 `--`，这样
//     `nohup -- rm -- -/../foo` 会剥成 `rm -- -/../foo`，
//     而不是 `-- rm ...`（后者会让路径校验以 `--` 为 baseCmd 而跳过检查）。
//
// 注：「剥完剩下的第一个词就是 baseCmd」是所有路径校验的前提。
//     如果剥离后残留一个 `--`，那么 baseCmd 就成了 `--` —— 一个不存在的命令，
//     路径校验查不到任何东西，静默通过。这类「残留 token 变成假命令」的问题
//     在剥离型代码里是最典型的失手方式。
  const SAFE_WRAPPER_PATTERNS = [
    // timeout: enumerate GNU long flags — no-value (--foreground,
    // --preserve-status, --verbose), value-taking in both =fused and
    // space-separated forms (--kill-after=5, --kill-after 5, --signal=TERM,
    // --signal TERM). Short: -v (no-arg), -k/-s with separate or fused value.
    // SECURITY: flag VALUES use allowlist [A-Za-z0-9_.+-] (signals are
    // TERM/KILL/9, durations are 5/5s/10.5). Previously [^ \t]+ matched
    // $ ( ) ` | ; & — `timeout -k$(id) 10 ls` stripped to `ls`, matched
    // Bash(ls:*), while bash expanded $(id) during word splitting BEFORE
    // timeout ran. Contrast ENV_VAR_PATTERN below which already allowlists.
// 注：timeout 那条正则是全文件最长的单个正则，值得逐段拆：
//
//     ^timeout[ \t]+
//       (?:(?:--(?:foreground|preserve-status|verbose)          ← 无值长选项
//          |--(?:kill-after|signal)=[A-Za-z0-9_.+-]+            ← 有值长选项（= 连接）
//          |--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+       ← 有值长选项（空格分隔）
//          |-v                                                  ← 无值短选项
//          |-[ks][ \t]+[A-Za-z0-9_.+-]+                         ← 有值短选项（空格分隔）
//          |-[ks][A-Za-z0-9_.+-]+)                              ← 有值短选项（融合）
//          [ \t]+)*                                            ← 可重复任意个
//       (?:--[ \t]+)?                                          ← 可选的 -- 分隔
//       \d+(?:\.\d+)?[smhd]?[ \t]+                            ← 时长，然后才是真正的命令
//
//     注意它枚举了 timeout 的**全部** GNU 选项，而不是「跳过所有以 - 开头的东西」。
//     这是刻意的保守：遇到没枚举到的选项就不剥（剥不动就交给下游的 deny 匹配，
//     反正 `timeout --weird rm -rf /` 至少不会被误解成 `rm -rf /` 而放行）。
// 注：这条是**漏洞修复现场**，值得完整理解：
//
//     原来的值模式是 `[^ \t]+`（任何非空白），于是：
//         timeout -k$(id) 10 ls
//     会剥成 `ls` → 匹配上 `Bash(ls:*)` → 自动放行。
//     但 bash 的处理顺序是：**先做词分割与命令替换**，也就是 `$(id)` 在
//     timeout 还没运行之前就已经执行了。所以「检查看到 ls、实际执行了 id」。
//
//     修法：值必须是 `[A-Za-z0-9_.+-]` —— 信号是 TERM/KILL/9，时长是 5/5s/10.5，
//     这些东西里不会出现 `$`、`(`、`)`、反引号、`|`、`;`、`&`。
//     一句话：**凡是要塞进正则的值，先问它的合法字符集是什么，别用「非空白」偷懒。**
    /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
    /^time[ \t]+(?:--[ \t]+)?/,
    // SECURITY: keep in sync with checkSemantics wrapper-strip (ast.ts
    // ~:1990-2080) AND stripWrappersFromArgv (pathValidation.ts ~:1260).
    // Previously this pattern REQUIRED `-n N`; checkSemantics already handled
    // bare `nice` and legacy `-N`. Asymmetry meant checkSemantics exposed the
    // wrapped command to semantic checks but deny-rule matching and the cd+git
    // gate saw the wrapper name. `nice rm -rf /` with Bash(rm:*) deny became
    // ask instead of deny; `cd evil && nice git status` skipped the bare-repo
    // RCE gate. PR #21503 fixed stripWrappersFromArgv; this was missed.
    // Now matches: `nice cmd`, `nice -n N cmd`, `nice -N cmd` (all forms
    // checkSemantics strips).
// 译：SECURITY：与 checkSemantics 的包装器剥离（ast.ts 约 1990-2080 行）
//     以及 stripWrappersFromArgv（pathValidation.ts 约 1260 行）保持同步。
//
//     以前这个正则**要求** `-n N`；而 checkSemantics 早已处理裸 `nice` 和旧式 `-N`。
//     这种不对称导致 checkSemantics 把被包裹的命令暴露给语义检查，
//     但 deny 规则匹配和 cd+git 门禁看到的却是包装器名。于是
//     `nice rm -rf /` 配 `Bash(rm:*)` deny 规则时，结果从 deny 降级成 ask；
//     `cd evil && nice git status` 也跳过了裸仓库 RCE 门禁。
//     PR #21503 修了 stripWrappersFromArgv，但这里被漏掉了。
//     现在匹配：`nice cmd`、`nice -n N cmd`、`nice -N cmd`（checkSemantics 会剥的全部形式）。
//
// 注：这段注释的价值不在于「nice 怎么写」，而在于它演示了一类系统性风险：
//     **同一个语义（哪些是包装器）被抄在 3 个地方实现**，
//     改一处不改另两处，就产生「一个视角剥了、另一个视角没剥」的绕过。
//     而且绕过不是崩溃，是「deny 静默降级成 ask」—— 日志里看不出来。
//     作者用「KEEP IN SYNC」注释来维护，这本质上是一种靠人记性的同步。
//     （bashSecurity.ts 里那对 DEPRECATED 函数是同一个问题的另一个案例。）
    /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
    // stdbuf: fused short flags only (-o0, -eL). checkSemantics handles more
    // (space-separated, long --output=MODE), but we fail-closed on those
    // above so not over-stripping here is safe. Main need: `stdbuf -o0 cmd`.
    /^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/,
    /^nohup[ \t]+(?:--[ \t]+)?/,
  ] as const

  // Pattern for environment variables:
  // ^([A-Za-z_][A-Za-z0-9_]*)  - Variable name (standard identifier)
  // =                           - Equals sign
  // ([A-Za-z0-9_./:-]+)         - Value: alphanumeric + safe punctuation only
  // [ \t]+                      - Required HORIZONTAL whitespace after value
  //
  // SECURITY: Only matches unquoted values with safe characters (no $(), `, $var, ;|&).
  //
  // SECURITY: Trailing whitespace MUST be [ \t]+ (horizontal only), NOT \s+.
  // \s matches \n/\r. If reconstructCommand emits an unquoted newline between
  // `TZ=UTC` and `echo`, \s+ would match across it and strip `TZ=UTC<NL>`,
  // leaving `echo curl evil.com` to match Bash(echo:*). But bash treats the
  // newline as a command separator. Defense-in-depth with needsQuoting fix.
  const ENV_VAR_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_./:-]+)[ \t]+/

  let stripped = command
  let previousStripped = ''

  // Phase 1: Strip leading env vars and comments only.
  // In bash, env var assignments before a command (VAR=val cmd) are genuine
  // shell-level assignments. These are safe to strip for permission matching.
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    const envVarMatch = stripped.match(ENV_VAR_PATTERN)
    if (envVarMatch) {
      const varName = envVarMatch[1]!
      const isAntOnlySafe =
        process.env.USER_TYPE === 'ant' && ANT_ONLY_SAFE_ENV_VARS.has(varName)
      if (SAFE_ENV_VARS.has(varName) || isAntOnlySafe) {
        stripped = stripped.replace(ENV_VAR_PATTERN, '')
      }
    }
  }

  // Phase 2: Strip wrapper commands and comments only. Do NOT strip env vars.
  // Wrapper commands (timeout, time, nice, nohup) use execvp to run their
  // arguments, so VAR=val after a wrapper is treated as the COMMAND to execute,
  // not as an env var assignment. Stripping env vars here would create a
  // mismatch between what the parser sees and what actually executes.
  // (HackerOne #3543050)
  previousStripped = ''
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    for (const pattern of SAFE_WRAPPER_PATTERNS) {
      stripped = stripped.replace(pattern, '')
    }
  }

  return stripped.trim()
}

// ═══ ⑬ 为什么 timeout 的选项解析要单独抽一个函数 ═══
// SECURITY: allowlist for timeout flag VALUES (signals are TERM/KILL/9,
// durations are 5/5s/10.5). Rejects $ ( ) ` | ; & and newlines that
// previously matched via [^ \t]+ — `timeout -k$(id) 10 ls` must NOT strip.
const TIMEOUT_FLAG_VALUE_RE = /^[A-Za-z0-9_.+-]+$/

/**
 * Parse timeout's GNU flags (long + short, fused + space-separated) and
 * return the argv index of the DURATION token, or -1 if flags are unparseable.
 * Enumerates: --foreground/--preserve-status/--verbose (no value),
 * --kill-after/--signal (value, both =fused and space-separated), -v (no
 * value), -k/-s (value, both fused and space-separated).
 *
 * Extracted from stripWrappersFromArgv to keep bashToolHasPermission under
 * Bun's feature() DCE complexity threshold — inlining this breaks
 * feature('BASH_CLASSIFIER') evaluation in classifier tests.
 */
// 译：从 stripWrappersFromArgv 里抽出来，以让 bashToolHasPermission 保持在
//     Bun 的 feature() DCE 复杂度阈值之下 —— 内联这个函数会破坏
//     classifier 测试里 feature('BASH_CLASSIFIER') 的求值。
//
// 注：这是本文件第 2 处「为打包器而重构」的痕迹（第 1 处是第 81 行那段 DCE 悬崖注释）。
//     判断依据很简单：这个函数只有 stripWrappersFromArgv 一个调用者，
//     逻辑也完全内聚，按正常工程直觉根本不需要拆出来。
//     看到「单调用者 + 注释解释为什么要拆」，基本就是撞上打包器限制了。
function skipTimeoutFlags(a: readonly string[]): number {
// 注：这个函数的返回值语义要看清 —— 它返回的是**时长 token 的下标**，不是命令下标。
//     最后一行 `return i` 之后，调用方还要自己校验 `a[i]` 是不是时长形状，
//     再 `slice(i + 1)` 才拿到命令。
//
//     `return -1` 的三种情形（未知长选项、未知短选项、其余 - 开头）都表示
//     「选项看不懂，别剥」。调用方拿到 -1 直接返回原 argv —— **fail-closed**。
//     这点很重要：看不懂就不剥，比猜着剥要安全得多。
  let i = 1
  while (i < a.length) {
    const arg = a[i]!
    const next = a[i + 1]
    if (
      arg === '--foreground' ||
      arg === '--preserve-status' ||
      arg === '--verbose'
    )
      i++
    else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (
      (arg === '--kill-after' || arg === '--signal') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (arg === '--') {
// 注：`--` 是「选项结束」标记。这里 `i++` 后立刻 break，
//     意思是把 `--` 消费掉，后面的第一个 token 就是时长。
//
//     对照 stripSafeWrappers 里那条 `(?:--[ \t]+)?` —— 两处实现的是同一个语义，
//     一处用正则、一处用下标。这也是「同一语义两份实现」的又一例。
      i++
      break
    } // end-of-options marker
    else if (arg.startsWith('--')) return -1
    else if (arg === '-v') i++
    else if (
      (arg === '-k' || arg === '-s') &&
      next &&
      TIMEOUT_FLAG_VALUE_RE.test(next)
    )
      i += 2
    else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) i++
    else if (arg.startsWith('-')) return -1
    else break
  }
  return i
}

// ═══ ⑭ stripWrappersFromArgv：正则版的「argv 版」 ═══
/**
 * Argv-level counterpart to stripSafeWrappers. Strips the same wrapper
 * commands (timeout, time, nice, nohup) from AST-derived argv. Env vars
 * are already separated into SimpleCommand.envVars so no env-var stripping.
 *
 * KEEP IN SYNC with SAFE_WRAPPER_PATTERNS above — if you add a wrapper
 * there, add it here too.
 */
// 译：stripSafeWrappers 的 argv 级对应物。从 AST 派生的 argv 里剥掉同样的包装器命令
//     （timeout、time、nice、nohup）。环境变量已经被分到 SimpleCommand.envVars 里了，
//     所以这里不需要剥环境变量。
//
//     KEEP IN SYNC：如果在上面的 SAFE_WRAPPER_PATTERNS 里加了包装器，这里也要加。
//
// 注：注释说「保持同步」，但**读代码会发现它并没有完全同步**：
//     上面 stripSafeWrappers 已经能剥裸 `nice cmd` 和旧式 `nice -N cmd`（PR #21503 之后），
//     而这里的条件只有 `a[0] === 'nice' && a[1] === '-n' && /^-?\d+$/.test(a[2])`，
//     也就是只处理 `nice -n N` 一种形式；裸 nice 会落到最后的 else 直接 return。
//     影响有限（AST 路径下 checkSemantics 自己会剥裸 nice），但这正好印证了
//     上面第 544 行那条注释的担忧：靠注释维持同步，总有一天会不同步。
export function stripWrappersFromArgv(argv: string[]): string[] {
  // SECURITY: Consume optional `--` after wrapper options, matching what the
  // wrapper does. Otherwise `['nohup','--','rm','--','-/../foo']` yields `--`
  // as baseCmd and skips path validation. See SAFE_WRAPPER_PATTERNS comment.
  let a = argv
  for (;;) {
// 注：`for (;;)` 无限循环 + 每轮只剥一层，是为了处理嵌套包装器：
//     `nohup timeout 10 nice -n 5 npm test` 要连剥三层。
//     退出条件是最后那个 else —— 第一个不是包装器的 token 出现就返回。
    if (a[0] === 'time' || a[0] === 'nohup') {
      a = a.slice(a[1] === '--' ? 2 : 1)
    } else if (a[0] === 'timeout') {
      const i = skipTimeoutFlags(a)
      if (i < 0 || !a[i] || !/^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) return a
      a = a.slice(i + 1)
    } else if (
      a[0] === 'nice' &&
      a[1] === '-n' &&
      a[2] &&
      /^-?\d+$/.test(a[2])
    ) {
      a = a.slice(a[3] === '--' ? 4 : 3)
    } else {
      return a
    }
  }
}

// ═══ ⑮ 两种剥离强度的分工：allow 严、deny 松 ═══
/**
 * Env vars that make a *different binary* run (injection or resolution hijack).
 * Heuristic only — export-&& form bypasses this, and excludedCommands isn't a
 * security boundary anyway.
 */
// 译：会让「另一个二进制」跑起来的变量（注入或解析劫持）。
//     只是启发式 —— `export && 形式` 能绕过它，而且 excludedCommands 本来就不是安全边界。
//
// 注：注释里那句「excludedCommands 不是安全边界」是这个项目反复强调的立场：
//     只有「权限提示」是安全边界，其他都是便利性优化。
//     写这种注释是为了防止后来者把它当护栏用。
export const BINARY_HIJACK_VARS = /^(LD_|DYLD_|PATH$)/

/**
 * Strip ALL leading env var prefixes from a command, regardless of whether the
 * var name is in the safe-list.
 *
 * Used for deny/ask rule matching: when a user denies `claude` or `rm`, the
 * command should stay blocked even if prefixed with arbitrary env vars like
 * `FOO=bar claude`. The safe-list restriction in stripSafeWrappers is correct
 * for allow rules (prevents `DOCKER_HOST=evil docker ps` from auto-matching
 * `Bash(docker ps:*)`), but deny rules must be harder to circumvent.
 *
 * Also used for sandbox.excludedCommands matching (not a security boundary —
 * permission prompts are), with BINARY_HIJACK_VARS as a blocklist.
 *
 * SECURITY: Uses a broader value pattern than stripSafeWrappers. The value
 * pattern excludes only actual shell injection characters ($, backtick, ;, |,
 * &, parens, redirects, quotes, backslash) and whitespace. Characters like
 * =, +, @, ~, , are harmless in unquoted env var assignment position and must
 * be matched to prevent trivial bypass via e.g. `FOO=a=b denied_command`.
 *
 * @param blocklist - optional regex tested against each var name; matching vars
 *   are NOT stripped (and stripping stops there). Omit for deny rules; pass
 *   BINARY_HIJACK_VARS for excludedCommands.
 */
// 译：剥掉命令开头的**所有**环境变量前缀，不管变量名是否在安全白名单里。
//
//     用于 deny/ask 规则匹配：用户 deny 了 `claude` 或 `rm`，
//     那么即使写成 `FOO=bar claude`，命令也应该保持被封。
//     stripSafeWrappers 里的白名单限制对 allow 规则是正确的
//     （防止 `DOCKER_HOST=evil docker ps` 自动匹配 `Bash(docker ps:*)`），
//     但 deny 规则必须更难被绕过。
//
//     也用于 sandbox.excludedCommands 匹配（不是安全边界 —— 权限提示才是），
//     用 BINARY_HIJACK_VARS 当黑名单。
//
// 注：**这是整个文件最重要的一个设计思想**，值得单独记：
//
//     allow 规则和 deny 规则用**不同的剥离强度**。
//       · allow 要「严格」—— 只剥确定的、无害的东西。多剥一点就可能把
//         `DOCKER_HOST=evil docker ps` 错认成 `docker ps` 而自动放行。
//       · deny 要「宽松」—— 尽量多剥，剥到能认出被禁命令为止。
//         因为 deny 漏判的代价（执行了被禁命令）远大于误判的代价（多问一句）。
//
//     这不是不一致，是**有方向的不对称**：两种错误代价不同，所以要朝不同方向偏。
//     很多权限系统的失败就在于对两者用了同一套归一化逻辑。
// 译：SECURITY：值模式比 stripSafeWrappers 更宽。这里只排除真正的 shell 注入字符
//     （$、反引号、;、|、&、括号、重定向、引号、反斜杠）和空白。
//     像 =、+、@、~、, 这种在未加引号的赋值位置是无害的，必须能匹配上，
//     否则 `FOO=a=b denied_command` 就能轻松绕过。
//
// 注：`FOO=a=b` 这个例子的意思是：如果值字符集不允许 `=`，
//     那么匹配会在第一个 `=` 处结束，剩下 `b denied_command` 里既没有可剥的赋值、
//     也不以 `denied_command` 开头 —— deny 规则就匹配不上，命令被放行。
//     一个字符集少写一个字符，就是一条绕过路径。
export function stripAllLeadingEnvVars(
  command: string,
  blocklist?: RegExp,
): string {
  // Broader value pattern for deny-rule stripping. Handles:
  //
  // - Standard assignment (FOO=bar), append (FOO+=bar), array (FOO[0]=bar)
  // - Single-quoted values: '[^'\n\r]*' — bash suppresses all expansion
  // - Double-quoted values with backslash escapes: "(?:\\.|[^"$`\\\n\r])*"
  //   In bash double quotes, only \$, \`, \", \\, and \newline are special.
  //   Other \x sequences are harmless, so we allow \. inside double quotes.
  //   We still exclude raw $ and ` (without backslash) to block expansion.
  // - Unquoted values: excludes shell metacharacters, allows backslash escapes
  // - Concatenated segments: FOO='x'y"z" — bash concatenates adjacent segments
  //
  // SECURITY: Trailing whitespace MUST be [ \t]+ (horizontal only), NOT \s+.
  //
  // The outer * matches one atomic unit per iteration: a complete quoted
  // string, a backslash-escape pair, or a single unquoted safe character.
  // The inner double-quote alternation (?:...|...)* is bounded by the
  // closing ", so it cannot interact with the outer * for backtracking.
  //
  // Note: $ is excluded from unquoted/double-quoted value classes to block
  // dangerous forms like $(cmd), ${var}, and $((expr)). This means
  // FOO=$VAR is not stripped — adding $VAR matching creates ReDoS risk
  // (CodeQL #671) and $VAR bypasses are low-priority.
// 注：这段注释列了 5 种赋值形式，全都要支持：
//       标准赋值 FOO=bar   ·  追加 FOO+=bar   ·  数组 FOO[0]=bar
//       单引号值 ''（bash 抑制一切展开）
//       双引号值 ""（bash 里只有 \$ \` \" \\ 和 \换行 是特殊的）
//       未加引号的值（排除 shell 元字符，允许反斜杠转义）
//       以及拼接形式 FOO='x'y"z"
//     「bash 会把相邻片段拼接起来」这一点最容易漏 —— `FOO='a'b"c"` 是一个完整的赋值。
// 注：`$` 被排除在未加引号/双引号值字符集之外，直接后果是
//     `FOO=$VAR denied_command` **不会被剥**。
//     作者明确记录了取舍：加上 $VAR 匹配会引入 ReDoS 风险（CodeQL #671），
//     而经 $VAR 绕过的优先级较低。
//
//     这是「安全 vs 可用」的典型权衡记录：知道有这个缺口，
//     评估过代价，选择了不修，并把理由写在代码里。
//     比起悄悄不修，这种写法让后来者能重新评估，而不是重新踩一遍。
  const ENV_VAR_PATTERN =
    /^([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?)\+?=(?:'[^'\n\r]*'|"(?:\\.|[^"$`\\\n\r])*"|\\.|[^ \t\n\r$`;|&()<>\\\\'"])*[ \t]+/

  let stripped = command
  let previousStripped = ''

// 注：又是 `while (stripped !== previousStripped)` 的固定点循环 ——
//     和 stripSafeWrappers 同一个套路：只要还能剥就继续剥，剥不动为止。
//     `FOO=a BAR=b BAZ=c cmd` 靠这个循环一轮剥一个。
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    const m = stripped.match(ENV_VAR_PATTERN)
    if (!m) continue
// 注：`break` 而不是 `continue` —— 命中黑名单变量时**立刻停止**整个剥离，
//     不是跳过这一个继续剥下一个。
//     语义是：「一旦看到会让另一个二进制跑起来的变量，这条命令的整体形态就不可信了，
//     后面的剥离也不再有意义。」这也是一种 fail-closed。
    if (blocklist?.test(m[1]!)) break
    stripped = stripped.slice(m[0].length)
  }

  return stripped.trim()
}

// ═══ ⑯ 规则匹配的核心：一条命令怎么对上一条规则 ═══
function filterRulesByContentsMatchingInput(
// 注：函数名直译是「按内容匹配输入来过滤规则」，但更好记的说法是：
//     **把命令加工成多个候选形态，然后拿每一条规则去试每一个形态。**
//
//     三个参数决定它的行为：
//       matchMode   'exact'（整条命令原样比）| 'prefix'（子命令级比）
//       stripAllEnvVars  只有 deny/ask 传 true（见上面 ⑮ 的不对称设计）
//       skipCompoundCheck  复合命令护栏的开关（AST 路径下可跳过）
//
//     返回值是所有命中的规则对象（可能多条）。
  input: z.infer<typeof BashTool.inputSchema>,
  rules: Map<string, PermissionRule>,
  matchMode: 'exact' | 'prefix',
  {
    stripAllEnvVars = false,
    skipCompoundCheck = false,
  }: { stripAllEnvVars?: boolean; skipCompoundCheck?: boolean } = {},
): PermissionRule[] {
  const command = input.command.trim()

  // Strip output redirections for permission matching
  // This allows rules like Bash(python:*) to match "python script.py > output.txt"
  // Security validation of redirection targets happens separately in checkPathConstraints
// 注：先剥掉「输出重定向」再匹配，这样 `Bash(python:*)` 能匹配
//     `python script.py > output.txt`。
//     重定向目标的安全性**不在这里管** —— 那由 checkPathConstraints 单独负责。
//     这种「按维度分工」在本文件很常见：规则匹配只看命令，路径约束只看路径，
//     两边互不越界，各自把一件事做好。
  const commandWithoutRedirections =
    extractOutputRedirections(command).commandWithoutRedirections

  // For exact matching, try both the original command (to preserve quotes)
  // and the command without redirections (to allow rules without redirections to match)
  // For prefix matching, only use the command without redirections
  const commandsForMatching =
// 注：精确模式下同时试两个形态（原样 + 去重定向），前缀模式只试去重定向的。
//     为什么精确模式要保留原样？因为**引号是命令的一部分** ——
//     `Bash(git commit -m "fix")` 这条精确规则里带引号，只有原样形态能匹配上。
//     如果只拿去重定向后的形态，引号可能已被改写，规则就失效了。
    matchMode === 'exact'
      ? [command, commandWithoutRedirections]
      : [commandWithoutRedirections]

  // Strip safe wrapper commands (timeout, time, nice, nohup) and env vars for matching
  // This allows rules like Bash(npm install:*) to match "timeout 10 npm install foo"
  // or "GOOS=linux go build"
  const commandsToTry = commandsForMatching.flatMap(cmd => {
// 注：如果剥包装器之后变了，就把「原样」和「剥后」**两个都留下**当候选。
//     保留原样的原因同上：用户可能显式存了带 `timeout` 的规则。
//     多留候选的代价只是多几轮比较，收益是「两种写法都能匹配」。
    const strippedCommand = stripSafeWrappers(cmd)
    return strippedCommand !== cmd ? [cmd, strippedCommand] : [cmd]
  })

  // SECURITY: For deny/ask rules, also try matching after stripping ALL leading
  // env var prefixes. This prevents bypass via `FOO=bar denied_command` where
  // FOO is not in the safe-list. The safe-list restriction in stripSafeWrappers
  // is intentional for allow rules (see HackerOne #3543050), but deny rules
  // must be harder to circumvent — a denied command should stay denied
  // regardless of env var prefixes.
  //
  // We iteratively apply both stripping operations to all candidates until no
  // new candidates are produced (fixed-point). This handles interleaved patterns
  // like `nohup FOO=bar timeout 5 claude` where:
  //   1. stripSafeWrappers strips `nohup` → `FOO=bar timeout 5 claude`
  //   2. stripAllLeadingEnvVars strips `FOO=bar` → `timeout 5 claude`
  //   3. stripSafeWrappers strips `timeout 5` → `claude` (deny match)
  //
  // Without iteration, single-pass compositions miss multi-layer interleaving.
  if (stripAllEnvVars) {
// 注：固定点迭代，注释给的例子是全文件最好的同步/异步混合案例：
//         nohup FOO=bar timeout 5 claude
//       1. stripSafeWrappers 剥 `nohup`      → FOO=bar timeout 5 claude
//       2. stripAllLeadingEnvVars 剥 `FOO=`  → timeout 5 claude
//       3. stripSafeWrappers 剥 `timeout 5`  → claude（deny 命中）
//
//     如果只做单次组合（先全剥包装器、再全剥环境变量），第 2 步之后
//     就没机会再剥包装器了。所以必须**反复应用到不再产生新候选为止**。
//     这就是「交错剥离需要固定点」的意思。
//
//     实现细节：用 `seen` 集合去重 + `startIdx` 游标只处理新增项，
//     复杂度是 O(候选数)，不会指数爆炸（因为字符串只会越剥越短）。
    const seen = new Set(commandsToTry)
    let startIdx = 0

    // Iterate until no new candidates are produced (fixed-point)
    while (startIdx < commandsToTry.length) {
      const endIdx = commandsToTry.length
      for (let i = startIdx; i < endIdx; i++) {
        const cmd = commandsToTry[i]
        if (!cmd) {
          continue
        }
        // Try stripping env vars
        const envStripped = stripAllLeadingEnvVars(cmd)
        if (!seen.has(envStripped)) {
          commandsToTry.push(envStripped)
          seen.add(envStripped)
        }
        // Try stripping safe wrappers
        const wrapperStripped = stripSafeWrappers(cmd)
        if (!seen.has(wrapperStripped)) {
          commandsToTry.push(wrapperStripped)
          seen.add(wrapperStripped)
        }
      }
      startIdx = endIdx
    }
  }

  // Precompute compound-command status for each candidate to avoid re-parsing
  // inside the rule filter loop (which would scale splitCommand calls with
  // rules.length × commandsToTry.length). The compound check only applies to
  // prefix/wildcard matching in 'prefix' mode, and only for allow rules.
  // SECURITY: deny/ask rules must match compound commands so they can't be
  // bypassed by wrapping a denied command in a compound expression.
// 注：这里预计算「这条候选是不是复合命令」，是为了避免在下面的
//     `rules.length × commandsToTry.length` 双层循环里反复调用 splitCommand。
//     注释写得很清楚：那样会让 splitCommand 的调用次数变成乘积级。
//
//     一个值得注意的取舍：只在 'prefix' 模式且**未跳过**时才算。
//     AST 路径（skipCompoundCheck=true）下不算，因为 tree-sitter 已经切好了。
// 译：SECURITY：deny/ask 规则**必须**能匹配复合命令，否则把被禁命令包进
//     一个复合表达式就能绕过。
//
// 注：这就是上面「不对称设计」在代码里的落点 ——
//     `skipCompoundCheck: true` 只对 deny/ask 传（见第 954、966 行），
//     allow 永远不传（第 978 行只传 skipCompoundCheck）。
//     也就是说：复合命令护栏是**专门拦 allow 的**，deny/ask 不受它限制。
//     方向永远是「让 deny 更容易命中、让 allow 更难命中」。
  const isCompoundCommand = new Map<string, boolean>()
  if (matchMode === 'prefix' && !skipCompoundCheck) {
    for (const cmd of commandsToTry) {
      if (!isCompoundCommand.has(cmd)) {
        isCompoundCommand.set(cmd, splitCommand(cmd).length > 1)
      }
    }
  }

  return Array.from(rules.entries())
    .filter(([ruleContent]) => {
      const bashRule = bashPermissionRule(ruleContent)

      return commandsToTry.some(cmdToMatch => {
        switch (bashRule.type) {
          case 'exact':
            return bashRule.command === cmdToMatch
          case 'prefix':
            switch (matchMode) {
              // In 'exact' mode, only return true if the command exactly matches the prefix rule
              case 'exact':
                return bashRule.prefix === cmdToMatch
              case 'prefix': {
                // SECURITY: Don't allow prefix rules to match compound commands.
                // e.g., Bash(cd:*) must NOT match "cd /path && python3 evil.py".
                // In the normal flow commands are split before reaching here, but
                // shell escaping can defeat the first splitCommand pass — e.g.,
                //   cd src\&\& python3 hello.py  →  splitCommand  →  ["cd src&& python3 hello.py"]
                // which then looks like a single command that starts with "cd ".
                // Re-splitting the candidate here catches those cases.
// 译：SECURITY：不允许前缀规则匹配复合命令。
//     例如 `Bash(cd:*)` 绝不能匹配 `cd /path && python3 evil.py`。
//
//     正常流程里命令到这一步之前已经切开了，但**shell 转义可以让第一轮切分失效**：
//         cd src\&\& python3 hello.py   →   splitCommand   →   ["cd src&& python3 hello.py"]
//     它看起来就是一条以 "cd " 开头的单命令。所以这里对候选再切一次来兜住。
                if (isCompoundCommand.get(cmdToMatch)) {
                  return false
                }
                // Ensure word boundary: prefix must be followed by space or end of string
                // This prevents "ls:*" from matching "lsof" or "lsattr"
// 注：`startsWith(prefix + ' ')` 而不是 `startsWith(prefix)` ——
//     这个空格是**词边界**，防止 `ls:*` 匹配到 `lsof` 或 `lsattr`。
//     少写这个空格，`Bash(ls:*)` 就等于把 lsof、lsattr、lsusb 全放行了。
//     这类「前缀匹配必须带词边界」的规矩，任何做规则匹配的系统都躲不掉。
                if (cmdToMatch === bashRule.prefix) {
                  return true
                }
                if (cmdToMatch.startsWith(bashRule.prefix + ' ')) {
                  return true
                }
                // Also match "xargs <prefix>" for bare xargs with no flags.
                // This allows Bash(grep:*) to match "xargs grep pattern",
                // and deny rules like Bash(rm:*) to block "xargs rm file".
                // Natural word-boundary: "xargs -n1 grep" does NOT start with
                // "xargs grep " so flagged xargs invocations are not matched.
// 注：`xargs` 的特殊处理。`Bash(grep:*)` 要能匹配 `xargs grep pattern`，
//     反过来 deny 规则 `Bash(rm:*)` 也要能拦住 `xargs rm file`。
//
//     但只匹配**裸 xargs**（没有 flag 的）：`xargs -n1 grep` 不以 "xargs grep " 开头，
//     自然不会命中。作者用「自然词边界」来避免再写一个 flag 解析器 ——
//     这个技巧很省事，前提是「带 flag 的 xargs 本来就不该被前缀规则概括」。
                const xargsPrefix = 'xargs ' + bashRule.prefix
                if (cmdToMatch === xargsPrefix) {
                  return true
                }
                return cmdToMatch.startsWith(xargsPrefix + ' ')
              }
            }
            break
          case 'wildcard':
// 注：通配符规则的两个硬约束：
//     ① **精确模式下永不匹配**。因为精确模式面对的是未拆分的整条命令，
//        `foo *` 会匹配 `foo arg && curl evil.com`（`.*` 把操作符也吃了）。
//     ② 前缀模式下也不匹配复合命令，理由同上（`Bash(cd *)` vs `cd /path && ...`）。
//
//     结论：通配符只在「已经切分成单个子命令」之后才有安全感。
//     这条约束是「匹配的上下文决定模式能不能用」的典型例子。
            // SECURITY FIX: In exact match mode, wildcards must NOT match because we're
            // checking the full unparsed command. Wildcard matching on unparsed commands
            // allows "foo *" to match "foo arg && curl evil.com" since .* matches operators.
            // Wildcards should only match after splitting into individual subcommands.
            if (matchMode === 'exact') {
              return false
            }
            // SECURITY: Same as for prefix rules, don't allow wildcard rules to match
            // compound commands in prefix mode. e.g., Bash(cd *) must not match
            // "cd /path && python3 evil.py" even though "cd *" pattern would match it.
            if (isCompoundCommand.get(cmdToMatch)) {
              return false
            }
            // In prefix mode (after splitting), wildcards can safely match subcommands
            return matchWildcardPattern(bashRule.pattern, cmdToMatch)
        }
      })
    })
    .map(([, rule]) => rule)
}

// ═══ ⑰ matchingRulesForInput：三种行为各查一遍 ═══
function matchingRulesForInput(
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
  matchMode: 'exact' | 'prefix',
  { skipCompoundCheck = false }: { skipCompoundCheck?: boolean } = {},
) {
  const denyRuleByContents = getRuleByContentsForTool(
// 注：注意这三组查询的**参数差异**，是全文不对称设计的第二处落点：
//       deny  → { stripAllEnvVars: true, skipCompoundCheck: true }
//       ask   → { stripAllEnvVars: true, skipCompoundCheck: true }
//       allow → { skipCompoundCheck }          ← 不给 stripAllEnvVars
//
//     也就是：deny/ask 会「剥光所有环境变量 + 跳过复合护栏」，
//     allow 只「跳过复合护栏」。allow 的严格性在这里体现为「不乱剥」，
//     deny 的宽松性体现为「剥到能认出来为止」。
    toolPermissionContext,
    BashTool,
    'deny',
  )
  // SECURITY: Deny/ask rules use aggressive env var stripping so that
  // `FOO=bar denied_command` still matches a deny rule for `denied_command`.
  const matchingDenyRules = filterRulesByContentsMatchingInput(
    input,
    denyRuleByContents,
    matchMode,
    { stripAllEnvVars: true, skipCompoundCheck: true },
  )

  const askRuleByContents = getRuleByContentsForTool(
    toolPermissionContext,
    BashTool,
    'ask',
  )
  const matchingAskRules = filterRulesByContentsMatchingInput(
    input,
    askRuleByContents,
    matchMode,
    { stripAllEnvVars: true, skipCompoundCheck: true },
  )

  const allowRuleByContents = getRuleByContentsForTool(
    toolPermissionContext,
    BashTool,
    'allow',
  )
  const matchingAllowRules = filterRulesByContentsMatchingInput(
    input,
    allowRuleByContents,
    matchMode,
    { skipCompoundCheck },
  )

// 注：返回三个数组而不是单个结论 —— 优先级（deny > ask > allow）由调用方决定。
//     这是有意的：stripSafeWrappers 这类函数只负责「查出事实」，
//     「按什么顺序裁决」留给上层。所以第 1000 行、第 1083 行、
//     第 1220 行能看到同一套 deny→ask→allow 的顺序被写了三遍。
//     重复是有代价的，但换来的是每个调用点都能明确表达自己的优先级。
  return {
    matchingDenyRules,
    matchingAskRules,
    matchingAllowRules,
  }
}

/**
 * Checks if the subcommand is an exact match for a permission rule
 */
// ═══ ⑱ bashToolCheckExactMatchPermission：最小的一个裁决器 ═══
//
// 它只做一件事：拿**整条命令原样**去查 deny/ask/allow，依次返回四种结果之一。
// 四种结果（deny / ask / allow / passthrough）是这个权限系统的通用词汇，
// 后面所有函数都在传递它们。先记住 passthrough 的含义：
//     「我这一关没有意见，请继续走后面的流程」—— 不是同意，也不是拒绝。
export const bashToolCheckExactMatchPermission = (
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult => {
// 注：这个函数被 export 了，但**外部调用点数量是 0**（全库 grep 确认）。
//     它只在本文件内部被调用三次：第 1059 行、第 1191 行、第 1395 行、第 2111 行。
//     导出大概是给测试用的。这类「为测试而导出」的痕迹在这个项目里不少见，
//     读的时候不要误以为它是对外 API。
  const command = input.command.trim()
  const { matchingDenyRules, matchingAskRules, matchingAllowRules } =
    matchingRulesForInput(input, toolPermissionContext, 'exact')

  // 1. Deny if exact command was denied
// 注：1/2/3 的顺序就是优先级：deny 最优先，其次 ask，最后 allow。
//     注意每一支都只取 `[0]` —— 命中多条同行为规则时只记第一条，
//     因为 `decisionReason` 只需要一条用来展示给用户看。
//     多条命中的完整信息在子命令级（subcommandResults 那个 Map）里保留。
  if (matchingDenyRules[0] !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${BashTool.name} with command ${command} has been denied.`,
      decisionReason: {
        type: 'rule',
        rule: matchingDenyRules[0],
      },
    }
  }

  // 2. Ask if exact command was in ask rules
  if (matchingAskRules[0] !== undefined) {
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(BashTool.name),
      decisionReason: {
        type: 'rule',
        rule: matchingAskRules[0],
      },
    }
  }

  // 3. Allow if exact command was allowed
  if (matchingAllowRules[0] !== undefined) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: matchingAllowRules[0],
      },
    }
  }

  // 4. Otherwise, passthrough
// 注：passthrough 分支还顺手带上了 `suggestions` —— 即使用户还没点任何东西，
//     系统也预先算好「如果你要允许，建议存成什么规则」。
//     这个建议会在 checkCommandAndSuggestRules 里被前缀建议覆盖。
  const decisionReason = {
    type: 'other' as const,
    reason: 'This command requires approval',
  }
  return {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(BashTool.name, decisionReason),
    decisionReason,
    // Suggest exact match rule to user
    // this may be overridden by prefix suggestions in `checkCommandAndSuggestRules()`
    suggestions: suggestionForExactCommand(command),
  }
}

// ═══ ⑲ bashToolCheckPermission：单条（子）命令的完整裁决链 ═══
//
// 这个函数 8 步，是理解整个权限系统的骨架。记住顺序背后的逻辑：
//     先规则（deny/ask）→ 再路径 → 再 allow → 再 sed → 再模式 → 最后只读
// 「先 deny」的理由在每一步的注释里都重复了一遍：**deny 必须最先被看到**，
// 否则任何更早返回的 ask 都会把 deny 降级。
export const bashToolCheckPermission = (
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
  compoundCommandHasCd?: boolean,
  astCommand?: SimpleCommand,
): PermissionResult => {
  const command = input.command.trim()

  // 1. Check exact match first
// 注：第 1 步先做精确匹配，但只接受 deny 和 ask，**allow 被暂时扣住**（第 1125 行才用）。
//     为什么扣住？因为第 2 步的前缀 deny 必须有机会先说话。
//     如果这里直接返回 allow，`Bash(git push:*)` 的 allow 规则会盖过
//     `Bash(git push --force:*)` 这条更具体的 deny —— 精确的 allow 反而赢了 deny。
//     这就是权限系统里最经典的一条：**allow 要等到所有 deny 都问过话之后再兑现。**
  const exactMatchResult = bashToolCheckExactMatchPermission(
    input,
    toolPermissionContext,
  )

  // 1a. Deny/ask if exact command has a rule
  if (
    exactMatchResult.behavior === 'deny' ||
    exactMatchResult.behavior === 'ask'
  ) {
    return exactMatchResult
  }

  // 2. Find all matching rules (prefix or exact)
  // SECURITY FIX: Check Bash deny/ask rules BEFORE path constraints to prevent bypass
  // via absolute paths outside the project directory (HackerOne report)
  // When AST-parsed, the subcommand is already atomic — skip the legacy
  // splitCommand re-check that misparses mid-word # as compound.
// 译：SECURITY FIX：在路径约束**之前**检查 Bash 的 deny/ask 规则，
//     以防通过项目外的绝对路径绕过（HackerOne 报告）。
//
// 注：这条注释描述了一个非常具体的绕过：
//     如果先查路径约束，`ls /home` 会因为「路径在项目外」返回 ask，
//     于是 `Bash(ls:*)` 的 deny 规则永远没机会被看到 ——
//     用户看到的是「是否允许读取 /home」，点同意就把被禁命令放行了。
//     顺序在这里不是风格问题，是安全边界。
  const { matchingDenyRules, matchingAskRules, matchingAllowRules } =
    matchingRulesForInput(input, toolPermissionContext, 'prefix', {
      skipCompoundCheck: astCommand !== undefined,
// 注：`skipCompoundCheck: astCommand !== undefined` —— 有了 AST 提供的单条子命令，
//     就不用再做那个「正则复切一遍看是不是复合命令」的检查。
//     注释说得很清楚：legacy 的 splitCommand 会把「词中间的 #」误判成复合命令。
//
//     这也是本项目迁移到 tree-sitter 的核心收益之一：**从启发式规则变成结构事实**。
    })

  // 2a. Deny if command has a deny rule
  if (matchingDenyRules[0] !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${BashTool.name} with command ${command} has been denied.`,
      decisionReason: {
        type: 'rule',
        rule: matchingDenyRules[0],
      },
    }
  }

  // 2b. Ask if command has an ask rule
  if (matchingAskRules[0] !== undefined) {
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(BashTool.name),
      decisionReason: {
        type: 'rule',
        rule: matchingAskRules[0],
      },
    }
  }

  // 3. Check path constraints
  // This check comes after deny/ask rules so explicit rules take precedence.
  // SECURITY: When AST-derived argv is available for this subcommand, pass
  // it through so checkPathConstraints uses it directly instead of re-parsing
  // with shell-quote (which has a single-quote backslash bug that causes
  // parseCommandArguments to return [] and silently skip path validation).
  const pathResult = checkPathConstraints(
// 注：这一段 6 个参数是「逐层交出证据」的典型例子：
//       astCommand?.redirects  → 重定向目标
//       astCommand ? [astCommand] : undefined  → argv
//     都是「有就给，没有就让它自己再解析一遍」。
//
//     为什么极力避免自己再解析（注释第 1109-1111 行）：
//     shell-quote 有一个单引号反斜杠的 bug，会让 parseCommandArguments 返回**空数组**，
//     而空数组会让路径校验**静默跳过**。也就是说：解析失败的表现不是报错，
//     而是「什么都没检查，直接通过」。这是最危险的一类失败。
    input,
    getCwd(),
    toolPermissionContext,
    compoundCommandHasCd,
    astCommand?.redirects,
    astCommand ? [astCommand] : undefined,
  )
  if (pathResult.behavior !== 'passthrough') {
    return pathResult
  }

  // 4. Allow if command had an exact match allow
  if (exactMatchResult.behavior === 'allow') {
    return exactMatchResult
  }

  // 5. Allow if command has an allow rule
  if (matchingAllowRules[0] !== undefined) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: matchingAllowRules[0],
      },
    }
  }

// 注：第 5b 步的 sed 约束位置很讲究 —— 它在「allow 规则命中之后、模式自动放行之前」。
//     也就是说：即使用户有 `Bash(sed:*)` 允许规则，危险的 sed 操作仍然会被这里拦住。
//     这类「更具体的约束压在通用 allow 之上」的层次，是权限系统避免被一条宽规则
//     打穿全部防护的关键设计。
  // 5b. Check sed constraints (blocks dangerous sed operations before mode auto-allow)
  const sedConstraintResult = checkSedConstraints(input, toolPermissionContext)
  if (sedConstraintResult.behavior !== 'passthrough') {
    return sedConstraintResult
  }

  // 6. Check for mode-specific permission handling
  const modeResult = checkPermissionMode(input, toolPermissionContext)
  if (modeResult.behavior !== 'passthrough') {
    return modeResult
  }

  // 7. Check read-only rules
// 注：`BashTool.isReadOnly(input)` 是最后一道「白送」的放行：
//     纯只读命令（cat、grep、ls 之类）不需要问。
//
//     注意它的位置在**所有 deny/ask 之后** —— 顺序保证了
//     即使用户显式 deny 了 `cat`，这里也不会因为「cat 是只读的」而放行。
  if (BashTool.isReadOnly(input)) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Read-only command is allowed',
      },
    }
  }

  // 8. Passthrough since no rules match, will trigger permission prompt
  const decisionReason = {
    type: 'other' as const,
    reason: 'This command requires approval',
  }
  return {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(BashTool.name, decisionReason),
    decisionReason,
    // Suggest exact match rule to user
    // this may be overridden by prefix suggestions in `checkCommandAndSuggestRules()`
    suggestions: suggestionForExactCommand(command),
  }
}

/**
 * Processes an individual subcommand and applies prefix checks & suggestions
 */
// ═══ ⑳ checkCommandAndSuggestRules：单子命令 + 建议规则 ═══
//
// 注意它和前一个函数的关系：它先自己查一次精确匹配（第 1191 行），
// 然后调用 bashToolCheckPermission（第 1200 行），而后者**内部又查了一次精确匹配**。
// 一次单命令裁决里精确匹配被查了 2～3 遍。
// 这不是 bug，原因是两个函数是不同时期加的，各自都想要「先看精确匹配」的保证。
// 代价是多次 Map 查询（便宜），换来的是任何调用顺序都不会漏掉精确规则。
export async function checkCommandAndSuggestRules(
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
  commandPrefixResult: CommandPrefixResult | null | undefined,
  compoundCommandHasCd?: boolean,
  astParseSucceeded?: boolean,
): Promise<PermissionResult> {
  // 1. Check exact match first
  const exactMatchResult = bashToolCheckExactMatchPermission(
    input,
    toolPermissionContext,
  )
  if (exactMatchResult.behavior !== 'passthrough') {
// 注：这里用 `!== 'passthrough'` 而不是 `=== 'deny' || === 'ask'` ——
//     也就是说**精确 allow 在这里直接返回**了。
//     和第 1058 行那个「扣住 allow」的写法不同，因为这里已经是最终裁决点，
//     后面没有需要保护的其他 deny 检查了。
//     同一个函数族里两种写法并存，读的时候要看清当下是「中间步骤」还是「最终裁决」。
    return exactMatchResult
  }

  // 2. Check the command prefix
  const permissionResult = bashToolCheckPermission(
    input,
    toolPermissionContext,
    compoundCommandHasCd,
  )
  // 2a. Deny/ask if command was explictly denied/asked
  if (
    permissionResult.behavior === 'deny' ||
    permissionResult.behavior === 'ask'
  ) {
    return permissionResult
  }

  // 3. Ask for permission if command injection is detected. Skip when the
  // AST parse already succeeded — tree-sitter has verified there are no
  // hidden substitutions or structural tricks, so the legacy regex-based
  // validators (backslash-escaped operators, etc.) would only add FPs.
// 译：第 3 步，如果检测到命令注入就请求权限。AST 解析成功时跳过 ——
//     tree-sitter 已经验证过没有隐藏替换和结构把戏，
//     legacy 那批基于正则的 validator（反斜杠转义操作符等）只会增加误报。
//
// 注：`astParseSucceeded` 这个参数的唯一作用就是这个开关。
//     这个 gating 在全文件出现 4 次（第 1218、1996-2003、2086、2345 行），
//     每次注释都写「与别处一致」—— 说明这是一条**需要四处同步**的规则。
//     它的含义可以概括成一句话：
//         「有了可信解析，就不要再用不可信解析得出的结论去打扰用户。」
  if (
    !astParseSucceeded &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK)
  ) {
    const safetyResult = await bashCommandIsSafeAsync(input.command)

    if (safetyResult.behavior !== 'passthrough') {
      const decisionReason: PermissionDecisionReason = {
        type: 'other' as const,
        reason:
          safetyResult.behavior === 'ask' && safetyResult.message
            ? safetyResult.message
            : 'This command contains patterns that could pose security risks and requires approval',
      }

      return {
        behavior: 'ask',
        message: createPermissionRequestMessage(BashTool.name, decisionReason),
        decisionReason,
        suggestions: [], // Don't suggest saving a potentially dangerous command
// 注：`suggestions: []` 是**刻意的空数组**，不是漏写。
//     理由在注释里：「不要建议保存可能有危险的命令」。
//     如果这里给出建议，用户点一下「以后不用问」，
//     就把一条检测到注入的命令永久放行了 —— 那等于用便利性买掉安全检查。
//     这个模式在本文件出现 3 次（第 1236、1759、2130 行），
//     可以把 `suggestions: []` 读成一句注释：「此处不放行任何记忆」。
      }
    }
  }

  // 4. Allow if command was allowed
  if (permissionResult.behavior === 'allow') {
    return permissionResult
  }

  // 5. Suggest prefix if available, otherwise exact command
  const suggestedUpdates = commandPrefixResult?.commandPrefix
// 注：前缀建议优先于精确建议 —— 因为前缀更可复用。
//     但注意 `commandPrefixResult` 在绝大多数情况下是 null（第 2393 行的逻辑：
//     只有当注入的函数不是默认实现时才去调 Haiku），
//     所以线上实际走的是 `suggestionForExactCommand`（本地计算，不调模型）。
//     这处「注释说查 Haiku、实际已改为本地算」的偏差在别处也有对照说明。
    ? suggestionForPrefix(commandPrefixResult.commandPrefix)
    : suggestionForExactCommand(input.command)

  return {
    ...permissionResult,
    suggestions: suggestedUpdates,
  }
}

// ═══ ㉑ checkSandboxAutoAllow：沙箱开着就可以不问 ═══
//
// 这个函数的语义很单纯：沙箱已启用且配置了 autoAllowBashIfSandboxed，
// 那么「没有显式规则」的命令直接放行 —— 反正沙箱会限制它的破坏力。
//
// 但它内部的顺序藏着一个真实的降级 bug 修复，非常值得读。
/**
 * Checks if a command should be auto-allowed when sandboxed.
 * Returns early if there are explicit deny/ask rules that should be respected.
 *
 * NOTE: This function should only be called when sandboxing and auto-allow are enabled.
 *
 * @param input - The bash tool input
 * @param toolPermissionContext - The permission context
 * @returns PermissionResult with:
 *   - deny/ask if explicit rule exists (exact or prefix)
 *   - allow if no explicit rules (sandbox auto-allow applies)
 *   - passthrough should not occur since we're in auto-allow mode
 */
function checkSandboxAutoAllow(
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  const command = input.command.trim()

  // Check for explicit deny/ask rules on the full command (exact + prefix)
  const { matchingDenyRules, matchingAskRules } = matchingRulesForInput(
    input,
    toolPermissionContext,
    'prefix',
  )

  // Return immediately if there's an explicit deny rule on the full command
  if (matchingDenyRules[0] !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${BashTool.name} with command ${command} has been denied.`,
      decisionReason: {
        type: 'rule',
        rule: matchingDenyRules[0],
      },
    }
  }

  // SECURITY: For compound commands, check each subcommand against deny/ask
  // rules. Prefix rules like Bash(rm:*) won't match the full compound command
  // (e.g., "echo hello && rm -rf /" doesn't start with "rm"), so we must
  // check each subcommand individually.
  // IMPORTANT: Subcommand deny checks must run BEFORE full-command ask returns.
  // Otherwise a wildcard ask rule matching the full command (e.g., Bash(*echo*))
  // would return 'ask' before a prefix deny rule on a subcommand (e.g., Bash(rm:*))
  // gets checked, downgrading a deny to an ask.
// 译：SECURITY：对复合命令，要拿每条子命令分别去查 deny/ask 规则。
//     像 `Bash(rm:*)` 这样的前缀规则匹配不上整条复合命令
//     （"echo hello && rm -rf /" 并不以 "rm" 开头），所以必须逐条查。
//
//     IMPORTANT：子命令的 deny 检查必须**在**整条命令的 ask 返回**之前**完成。
//     否则一条匹配整条命令的通配 ask 规则（如 `Bash(*echo*)`）会先返回 'ask'，
//     而子命令上的前缀 deny 规则（如 `Bash(rm:*)`）还没来得及检查 ——
//     结果把 deny 降级成了 ask。
//
// 注：这是本文件里「deny 不能被 ask 降级」这条原则最直白的一次陈述。
//     实现手法是：把第一个 ask 命中**暂存**（`firstAskRule ??= ...`），
//     继续把剩下的子命令全查完，最后才返回。
//     和第 2096-2140 行 bashSecurity 那边的 defer 机制是同一个思路：
//     **ask 可以先记下，但必须让 deny 有机会说话。**
  const subcommands = splitCommand(command)
  if (subcommands.length > 1) {
    let firstAskRule: PermissionRule | undefined
    for (const sub of subcommands) {
      const subResult = matchingRulesForInput(
        { command: sub },
        toolPermissionContext,
        'prefix',
      )
      // Deny takes priority — return immediately
      if (subResult.matchingDenyRules[0] !== undefined) {
        return {
          behavior: 'deny',
          message: `Permission to use ${BashTool.name} with command ${command} has been denied.`,
          decisionReason: {
            type: 'rule',
            rule: subResult.matchingDenyRules[0],
          },
        }
      }
      // Stash first ask match; don't return yet (deny across all subs takes priority)
      firstAskRule ??= subResult.matchingAskRules[0]
// 注：`??=` 而不是 `=` —— 只记第一条 ask。多条 ask 对用户没区别（都是问一次），
//     但保留第一条能让 decisionReason 说清楚是哪条规则触发的。
    }
    if (firstAskRule) {
      return {
        behavior: 'ask',
        message: createPermissionRequestMessage(BashTool.name),
        decisionReason: {
          type: 'rule',
          rule: firstAskRule,
        },
      }
    }
  }

  // Full-command ask check (after all deny sources have been exhausted)
  if (matchingAskRules[0] !== undefined) {
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(BashTool.name),
      decisionReason: {
        type: 'rule',
        rule: matchingAskRules[0],
      },
    }
  }
  // No explicit rules, so auto-allow with sandbox

  return {
    behavior: 'allow',
    updatedInput: input,
    decisionReason: {
      type: 'other',
      reason: 'Auto-allowed with sandbox (autoAllowBashIfSandboxed enabled)',
    },
  }
}

// ═══ ㉒ 三处「为了打包器而抽出来的函数」 ═══
//
// 下面三个函数（filterCdCwdSubcommands / checkEarlyExitDeny / checkSemanticsDeny）
// 的注释里都写着同一句话：「抽出来是为了让 bashToolHasPermission 保持在
// Bun 的 feature() DCE 复杂度阈值之下」。
//
// 读法建议：把这段注释当成「主函数已经 895 行了，再加 5 行就会出故障」的证据。
// 这不是代码异味，是一个具体的、可复现的打包器约束。
/**
 * Filter out `cd ${cwd}` prefix subcommands, keeping astCommands aligned.
 * Extracted to keep bashToolHasPermission under Bun's feature() DCE
 * complexity threshold — inlining this breaks pendingClassifierCheck
 * attachment in ~10 classifier tests.
 */
function filterCdCwdSubcommands(
// 注：这个函数做的事很小 —— 把 `cd <当前目录>` 这类前缀子命令过滤掉，
//     同时**保持 astCommands 的下标对齐**（用 astCommandsByIdx 重建数组）。
//
//     下标对齐是关键：后面 `bashToolCheckPermission(..., astCommandsByIdx[i])`
//     靠这个下标把「第 i 条子命令」和「它的 AST 版本」配对。
//     如果过滤时忘了同步 astCommands，第 i 条会配到错误的 AST ——
//     路径校验拿到别人的 redirects，静默放行。
//     写过滤型代码时，「过滤后下标还对不对」永远要单独检查一遍。
  rawSubcommands: string[],
  astCommands: SimpleCommand[] | undefined,
  cwd: string,
  cwdMingw: string,
): { subcommands: string[]; astCommandsByIdx: (SimpleCommand | undefined)[] } {
  const subcommands: string[] = []
  const astCommandsByIdx: (SimpleCommand | undefined)[] = []
  for (let i = 0; i < rawSubcommands.length; i++) {
    const cmd = rawSubcommands[i]!
    if (cmd === `cd ${cwd}` || cmd === `cd ${cwdMingw}`) continue
    subcommands.push(cmd)
    astCommandsByIdx.push(astCommands?.[i])
  }
  return { subcommands, astCommandsByIdx }
}

/**
 * Early-exit deny enforcement for the AST too-complex and checkSemantics
 * paths. Returns the exact-match result if non-passthrough (deny/ask/allow),
 * then checks prefix/wildcard deny rules. Returns null if neither matched,
 * meaning the caller should fall through to ask. Extracted to keep
 * bashToolHasPermission under Bun's feature() DCE complexity threshold.
 */
function checkEarlyExitDeny(
// 注：这个函数服务于两个「提前退出」路径：AST 判定 too-complex，
//     以及 checkSemantics 判定不安全。两条路径都必须做同一件事：
//     先尊重显式的精确规则，再看前缀 deny，最后才允许「问用户」。
//
//     返回 null 的语义是「没有 deny 命中，调用方可以继续按 ask 处理」。
//     用 null 而不是 throw/特殊行为，是为了让调用点写成
//     `if (x !== null) return x` 这种一眼能懂的早退。
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult | null {
  const exactMatchResult = bashToolCheckExactMatchPermission(
    input,
    toolPermissionContext,
  )
  if (exactMatchResult.behavior !== 'passthrough') {
    return exactMatchResult
  }
  const denyMatch = matchingRulesForInput(
    input,
    toolPermissionContext,
    'prefix',
  ).matchingDenyRules[0]
  if (denyMatch !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${BashTool.name} with command ${input.command} has been denied.`,
      decisionReason: { type: 'rule', rule: denyMatch },
    }
  }
  return null
}

/**
 * checkSemantics-path deny enforcement. Calls checkEarlyExitDeny (exact-match
 * + full-command prefix deny), then checks each individual SimpleCommand .text
 * span against prefix deny rules. The per-subcommand check is needed because
 * filterRulesByContentsMatchingInput has a compound-command guard
 * (splitCommand().length > 1 → prefix rules return false) that defeats
 * `Bash(eval:*)` matching against a full pipeline like `echo foo | eval rm`.
 * Each SimpleCommand span is a single command, so the guard doesn't fire.
 *
 * Separate helper (not folded into checkEarlyExitDeny or inlined at the call
 * site) because bashToolHasPermission is tight against Bun's feature() DCE
 * complexity threshold — adding even ~5 lines there breaks
 * feature('BASH_CLASSIFIER') evaluation and drops pendingClassifierCheck.
 */
function checkSemanticsDeny(
// 注：这个函数解释了「为什么每子命令查 deny 还要单独做一遍」：
//     `filterRulesByContentsMatchingInput` 里有个复合命令护栏
//     （splitCommand().length > 1 → 前缀规则一律返回 false），
//     它会打败 `Bash(eval:*)` 对 `echo foo | eval rm` 这种管道的匹配。
//     而每条 SimpleCommand 的源码片段本身是单条命令，护栏不会触发。
//
//     换句话说：**同一个护栏在两种上下文里一正一反**。
//     对 allow 它是保护（防止宽前缀规则匹配整条复合命令），
//     对 deny 它是障碍（必须绕过去）。所以这里手动按 AST 的片段再查一遍。
  input: z.infer<typeof BashTool.inputSchema>,
  toolPermissionContext: ToolPermissionContext,
  commands: readonly { text: string }[],
): PermissionResult | null {
  const fullCmd = checkEarlyExitDeny(input, toolPermissionContext)
  if (fullCmd !== null) return fullCmd
  for (const cmd of commands) {
    const subDeny = matchingRulesForInput(
      { ...input, command: cmd.text },
      toolPermissionContext,
      'prefix',
    ).matchingDenyRules[0]
    if (subDeny !== undefined) {
      return {
        behavior: 'deny',
        message: `Permission to use ${BashTool.name} with command ${input.command} has been denied.`,
        decisionReason: { type: 'rule', rule: subDeny },
      }
    }
  }
  return null
}

// ═══ ㉓ 分类器：让模型在用户点之前就替他做决定 ═══
//
// 这一组函数（buildPendingClassifierCheck / speculative 三件套 /
// awaitClassifierAutoApproval / executeAsyncClassifierCheck）实现的是一件
// 很有产品感的事：
//
//     当权限弹窗要弹出来的时候，后台同时问一个小模型（Haiku）
//     「这条命令是否落在用户写过的那些自然语言允许规则里？」
//     如果高置信度命中，就在用户点之前自动放行，弹窗直接消失。
//
// 「顺手」的地方在于：这个检查是**推测性**启动的 —— 在任何权限判定之前就开始跑，
// 这样等真正需要它时，结果大概率已经好了。
/**
 * Builds the pending classifier check metadata if classifier is enabled and has allow descriptions.
 * Returns undefined if classifier is disabled, in auto mode, or no allow descriptions exist.
 */
function buildPendingClassifierCheck(
// 注：四个前置条件，任意一条不满足就不做分类器检查：
//       ① 分类器权限功能没开 → 不做
//       ② auto 模式（有 TRANSCRIPT_CLASSIFIER）→ 不做（auto 模式有自己的分类器）
//       ③ bypassPermissions 模式 → 不做（本来就全放行）
//       ④ 用户没写任何 allow 描述 → 不做（没有规则可匹配）
//
//     第 ④ 条最重要：分类器不是「通用安全判断」，它只回答
//     「这条命令符不符合**用户自己写过的某句话**」。
//     没有那句话，它就没有判断依据 —— 这一点常被误解成「AI 在判断命令危不危险」。
  command: string,
  toolPermissionContext: ToolPermissionContext,
): { command: string; cwd: string; descriptions: string[] } | undefined {
  if (!isClassifierPermissionsEnabled()) {
    return undefined
  }
  // Skip in auto mode - auto mode classifier handles all permission decisions
  if (feature('TRANSCRIPT_CLASSIFIER') && toolPermissionContext.mode === 'auto')
// 注：`feature('TRANSCRIPT_CLASSIFIER') && mode === 'auto'` 这个组合条件
//     会出现在本文件 3 处，写法一模一样。
//     它表达的是「如果这个构建包含 auto 模式，且当前就在 auto 模式」——
//     feature() 是构建期常量，所以外部构建里这整个条件会被静态求值成 false，
//     auto 模式的特殊处理逻辑随之消失。
    return undefined
  if (toolPermissionContext.mode === 'bypassPermissions') return undefined

  const allowDescriptions = getBashPromptAllowDescriptions(
    toolPermissionContext,
  )
  if (allowDescriptions.length === 0) return undefined

  return {
    command,
    cwd: getCwd(),
    descriptions: allowDescriptions,
  }
}

// 注：模块级的 Map，键是**命令原文**。
//     这就是「推测性检查」的存储：先发起、后取用。
//
//     有两个细节值得盯：
//     ① 键只有命令字符串，没有 cwd。而分类器的输入里是带 cwd 的（见第 1478 行）。
//        同一会话里先 speculate 再 consume，cwd 一般没变；但如果中途 cd 过，
//        理论上会用到按旧 cwd 算出的结果。实际影响很小（分类器看的是命令语义），
//        但这是「缓存键不完整」的典型例子。
//     ② 写入点在每次 bash 工具调用（toolExecution.ts:746），
//        删除点只有 consume（仅在需要弹窗时）和 clearSpeculativeChecks
//        （只在 REPL 清屏 / 压缩后清理时）。也就是说：
//        **自动放行的命令会把自己的 promise 永久留在 Map 里。**
//        长会话里跑几千条 bash 命令，这个 Map 只增不减 —— 一处真实的内存增长点。
const speculativeChecks = new Map<string, Promise<ClassifierResult>>()

/**
 * Start a speculative bash allow classifier check early, so it runs in
 * parallel with pre-tool hooks, deny/ask classifiers, and permission dialog setup.
 * The result can be consumed later by executeAsyncClassifierCheck via
 * consumeSpeculativeClassifierCheck.
 */
// 注：peek 和 consume 的区别就是「看」和「取走」：
//     peek 不动 Map，consume 取走并删除。
//     调用方 useCanUseTool.tsx:127 用 peek 来「race」——
//     拿推测结果和用户操作赛跑，谁先到算谁赢。
export function peekSpeculativeClassifierCheck(
  command: string,
): Promise<ClassifierResult> | undefined {
  return speculativeChecks.get(command)
}

export function startSpeculativeClassifierCheck(
  command: string,
  toolPermissionContext: ToolPermissionContext,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
): boolean {
  // Same guards as buildPendingClassifierCheck
  if (!isClassifierPermissionsEnabled()) return false
  if (feature('TRANSCRIPT_CLASSIFIER') && toolPermissionContext.mode === 'auto')
    return false
  if (toolPermissionContext.mode === 'bypassPermissions') return false
  const allowDescriptions = getBashPromptAllowDescriptions(
    toolPermissionContext,
  )
  if (allowDescriptions.length === 0) return false

  const cwd = getCwd()
// 注：这里把 cwd 固定下来传给分类器，所以 promise 内部是自洽的 ——
//     问题只在于外面 Map 的键没带 cwd（见第 1483 行的注）。
//     写缓存型代码时，「键是否覆盖了值的全部输入」是要单独审的一步。
  const promise = classifyBashCommand(
    command,
    cwd,
    allowDescriptions,
    'allow',
    signal,
    isNonInteractiveSession,
  )
  // Prevent unhandled rejection if the signal aborts before this promise is consumed.
  // The original promise (which may reject) is still stored in the Map for consumers to await.
// 注：`.catch(() => {})` 这一行是**防 unhandled rejection 的技巧**，值得学：
//
//     promise 被存进 Map，但可能永远没人 await（命令自动放行时就不会被取出）。
//     如果它 reject（比如用户中断导致 API 报错），Node 会认为有未处理的 rejection，
//     在严格配置下直接让进程崩溃。
//
//     手法：对**同一个 promise** 再挂一个空 catch。注意它并不改变原 promise
//     （原 promise 仍然可能是 rejected，仍然会被消费方 await 到错误），
//     只是给自己加了一个「已处理」的观察者，从而抑制全局警告。
//     注释写得很准：`The original promise ... is still stored in the Map for consumers to await`。
  promise.catch(() => {})
  speculativeChecks.set(command, promise)
  return true
}

/**
 * Consume a speculative classifier check result for the given command.
 * Returns the promise if one exists (and removes it from the map), or undefined.
 */
export function consumeSpeculativeClassifierCheck(
  command: string,
): Promise<ClassifierResult> | undefined {
  const promise = speculativeChecks.get(command)
  if (promise) {
    speculativeChecks.delete(command)
  }
  return promise
}

export function clearSpeculativeChecks(): void {
  speculativeChecks.clear()
}

// 注：`clearSpeculativeChecks` 只有两个调用点：
//     REPL 的 /clear（REPL.tsx:1586）和压缩后的清理（postCompactCleanup.ts:64）。
//     两处都是「会话状态大清理」的时刻 —— 说明这个 Map 被当作会话级状态对待，
//     而不是逐次调用的临时缓存。这也印证了上面第 1483 行的观察：
//     它没有逐条回收机制。
/**
 * Await a pending classifier check and return a PermissionDecisionReason if
 * high-confidence allow, or undefined otherwise.
 *
 * Used by swarm agents (both tmux and in-process) to gate permission
 * forwarding: run the classifier first, and only escalate to the leader
 * if the classifier doesn't auto-approve.
 */
export async function awaitClassifierAutoApproval(
// 注：这个函数是给**群体代理（swarm）**用的：
//     子代理遇到权限问题时，先自己跑一遍分类器；只有分类器不放行，
//     才升级到 leader 那里问人。
//
//     `PendingClassifierCheck` 这个数据从 bashToolHasPermission 一路传到子代理，
//     中间跨了进程/会话边界 —— 所以它只装三个可序列化的东西：命令、cwd、描述列表。
  pendingCheck: PendingClassifierCheck,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
): Promise<PermissionDecisionReason | undefined> {
  const { command, cwd, descriptions } = pendingCheck
  const speculativeResult = consumeSpeculativeClassifierCheck(command)
  const classifierResult = speculativeResult
    ? await speculativeResult
    : await classifyBashCommand(
        command,
        cwd,
        descriptions,
        'allow',
        signal,
        isNonInteractiveSession,
      )

  logClassifierResultForAnts(command, 'allow', descriptions, classifierResult)

  if (
// 注：自动放行的门槛是 `matches && confidence === 'high'`。
//     两个条件缺一不可：分类器经常「有点像但不完全像」，
//     只有高置信度才敢替用户做决定。
//     注意这里**没有**「中等置信度就降级成 ask」之类的分支 ——
//     不满足就是返回 undefined，走正常流程。分类器只加能力，不减流程。
    feature('BASH_CLASSIFIER') &&
    classifierResult.matches &&
    classifierResult.confidence === 'high'
  ) {
    return {
      type: 'classifier',
      classifier: 'bash_allow',
      reason: `Allowed by prompt rule: "${classifierResult.matchedDescription}"`,
    }
  }
  return undefined
}

type AsyncClassifierCheckCallbacks = {
  shouldContinue: () => boolean
  onAllow: (decisionReason: PermissionDecisionReason) => void
  onComplete?: () => void
}

/**
 * Execute the bash allow classifier check asynchronously.
 * This runs in the background while the permission prompt is shown.
 * If the classifier allows with high confidence and the user hasn't interacted, auto-approves.
 *
 * @param pendingCheck - Classifier check metadata from bashToolHasPermission
 * @param signal - Abort signal
 * @param isNonInteractiveSession - Whether this is a non-interactive session
 * @param callbacks - Callbacks to check if we should continue and handle approval
 */
export async function executeAsyncClassifierCheck(
// 注：这个函数是「弹窗已经弹出来之后」继续跑的那一路：
//     弹窗出现 → 后台分类器还在跑 → 若高置信放行且用户还没动手 → 自动关掉弹窗。
//
//     和 awaitClassifierAutoApproval 的区别只在于「有没有 UI 交互」：
//     前者（swarm）阻塞等待，后者（交互式）用 callbacks 询问「还能不能继续」。
  pendingCheck: { command: string; cwd: string; descriptions: string[] },
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
  callbacks: AsyncClassifierCheckCallbacks,
): Promise<void> {
  const { command, cwd, descriptions } = pendingCheck
  const speculativeResult = consumeSpeculativeClassifierCheck(command)

  let classifierResult: ClassifierResult
  try {
    classifierResult = speculativeResult
      ? await speculativeResult
      : await classifyBashCommand(
          command,
          cwd,
          descriptions,
          'allow',
          signal,
          isNonInteractiveSession,
        )
  } catch (error: unknown) {
// 注：错误处理分两类，逻辑很干净：
//       APIUserAbortError / AbortError  → 算正常取消：回调 onComplete 后**吞掉**
//       其他错误                          → 回调 onComplete 后**重新抛出**
//
//     为什么要吞掉 abort？因为 coordinator 会话被取消时会触发 signal，
//     分类器 API 调用 reject —— 这是设计内的路径，不该表现为「程序出错」。
//     而其他错误必须冒出来：分类器挂掉是真实故障，静默吞掉会让
//     「为什么这条命令突然不自动放行了」变成无法排查的谜。
    // When the coordinator session is cancelled, the abort signal fires and the
    // classifier API call rejects with APIUserAbortError. This is expected and
    // should not surface as an unhandled promise rejection.
    if (error instanceof APIUserAbortError || error instanceof AbortError) {
      callbacks.onComplete?.()
      return
    }
    callbacks.onComplete?.()
    throw error
  }

  logClassifierResultForAnts(command, 'allow', descriptions, classifierResult)

  // Don't auto-approve if user already made a decision or has interacted
  // with the permission dialog (e.g., arrow keys, tab, typing)
  if (!callbacks.shouldContinue()) return
// 注：`shouldContinue()` 是「用户已经动手了就别抢答」的检查。
//     注释举的例子很具体：方向键、Tab、开始打字 —— 都算「用户已经在看这个弹窗了」。
//     这时候自动放行会让人感觉「我还没选它就自己决定了」，体验上很糟。
//
//     这是一个 UI 与后台任务协作的通用模式：后台任务要能被前台状态否决。
//     实现方式不是取消后台任务，而是「任务照跑完，但结果不生效」。

  if (
    feature('BASH_CLASSIFIER') &&
    classifierResult.matches &&
    classifierResult.confidence === 'high'
  ) {
    callbacks.onAllow({
      type: 'classifier',
      classifier: 'bash_allow',
      reason: `Allowed by prompt rule: "${classifierResult.matchedDescription}"`,
    })
  } else {
    // No match — notify so the checking indicator is cleared
    callbacks.onComplete?.()
  }
}

// ═══ ㉔ 主函数：895 行的权限裁决总编排 ═══
//
// 读之前先拿这张表当地图（行号都在本文件内）：
//
//   ┌──── 准备 ────────────────────────────────────────────────────
//   │ 1668  取 appState（快照）
//   │ 1678  读「禁用注入检查」环境变量
//   │ 1683  GrowthBook killswitch（影子模式）
//   │ 1688  tree-sitter 解析 → 三分：simple / too-complex / parse-unavailable
//   │ 1707  【影子模式】记录分歧，然后强制回落到 legacy
//   ├──── 三条互斥的早期出口 ──────────────────────────────────────
//   │ 1741  too-complex      → deny 优先，否则 ask（分类器可救）
//   │ 1771  simple + 语义不符 → deny 优先，否则 ask
//   │ 1811  parse-unavailable → legacy shell-quote 预检
//   ├──── 通用判定 ────────────────────────────────────────────────
//   │ 1831  沙箱自动放行（有前置条件）
//   │ 1846  精确匹配 —— 只接受 deny
//   │ 1859  Haiku 分类器 deny/ask（并行两个请求）
//   │ 1976  管道/操作符分段检查（递归回本函数）
//   │ 2085  legacy 「解析不可信」闸门
//   ├──── 拆子命令 + 逐条裁决 ────────────────────────────────────
//   │ 2147  拆子命令、过滤 cd <cwd>
//   │ 2162  子命令数量上限 50（CC-643）
//   │ 2182  多条 cd → ask
//   │ 2209  cd + git 组合 → ask（裸仓库 RCE 门禁）
//   │ 2239  逐条 bashToolCheckPermission
//   │ 2249  任一 deny → deny
//   │ 2276  **原始命令**的路径约束（重定向在这一层）
//   │ 2296  GH#28784：path-ask 不能盖过子命令的 ask
//   │ 2319  只有一个非 allow 子命令 → 直接 ask
//   │ 2334  精确 allow 兑现
//   │ 2343  全部 allow 且无注入 → allow
//   └──── 合并建议 + 提问 ────────────────────────────────────────
//     2406  单子命令走 checkCommandAndSuggestRules
//     2435  多子命令逐个走，收集建议
//     2521  建议规则上限 5 条（GH#11380）
//     2543  最终 ask / passthrough
//
// 一个贯穿全篇的问题，读的时候一直问它：
//     「在这个位置返回 ask，会不会把某个还没检查的 deny 盖掉？」
// 本函数里至少 6 处注释都在回答这个问题。
/**
 * The main implementation to check if we need to ask for user permission to call BashTool with a given input
 */
// 注：三个参数里第三个 `getCommandSubcommandPrefixFn` 是**依赖注入**：
//     默认是真实的 getCommandSubcommandPrefix（会调 Haiku），
//     但全文件多处判断 `getCommandSubcommandPrefixFn !== getCommandSubcommandPrefix`
//     来决定「要不要真的去调模型」。线上永远相等，所以那段调用其实是死代码，
//     只有测试会传自定义函数进去。
export async function bashToolHasPermission(
  input: z.infer<typeof BashTool.inputSchema>,
  context: ToolUseContext,
  getCommandSubcommandPrefixFn = getCommandSubcommandPrefix,
): Promise<PermissionResult> {
  let appState = context.getAppState()
// 注：`let` 而不是 `const` —— 因为整个函数后面会**重新取 4 次**状态
//     （2012、2038、2061、2227、2405 行），每次注释都写着同一个原因：
//     `re-compute the latest in case the user hit shift+tab`。
//
//     shift+tab 是在权限弹窗里切换权限模式（default → acceptEdits → plan）的快捷键。
//     而这个函数中间会 await 好几次（分类器 API、tree-sitter 解析），
//     期间用户完全可能改了模式。所以任何「await 之后再用状态」的地方，
//     都必须重新取值 —— 否则会拿旧模式做判断。
//     这是一个很实际的并发细节：**权限模式是可以在判定过程中变化的。**

  // 0. AST-based security parse. This replaces both tryParseShellCommand
  // (the shell-quote pre-check) and the bashCommandIsSafe misparsing gate.
  // tree-sitter produces either a clean SimpleCommand[] (quotes resolved,
  // no hidden substitutions) or 'too-complex' — which is exactly the signal
  // we need to decide whether splitCommand's output can be trusted.
  //
  // When tree-sitter WASM is unavailable OR the injection check is disabled
  // via env var, we fall back to the old path (legacy gate at ~1370 runs).
// 注：这一段注释记录了一次**架构替换**：AST 解析同时取代了两样东西 ——
//     ① `tryParseShellCommand`（shell-quote 预检）
//     ② `bashCommandIsSafe` 里的 misparsing 闸门
//     因为它们回答的是同一个问题：「splitCommand 的输出能不能信？」
//
//     旧方案的答案是「用一堆正则去猜有没有可疑结构」；
//     新方案的答案是「用真正的解析器解析一次，解析不了就说明不可信」。
//     从启发式到结构化，这是这份源码里最值得学的一次重构。
  const injectionCheckDisabled = isEnvTruthy(
    process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK,
  )
  // GrowthBook killswitch for shadow mode — when off, skip the native parse
  // entirely. Computed once; feature() must stay inline in the ternary below.
  const shadowEnabled = feature('TREE_SITTER_BASH_SHADOW')
// 注：这是「影子模式（shadow mode）」的开关。
//     名字取得很准：新解析器在跑、结论也在记，但**不生效** ——
//     只是把「新旧两套会不会给出不同答案」上报，用来评估新方案的误判率。
//
//     `getFeatureValue_CACHED_MAY_BE_STALE` 这个名字是在提醒：
//     这里读的是缓存值，可能过期。对 killswitch 来说可以接受 ——
//     晚几秒生效，比每次判定都发一个网络请求划算。
    ? getFeatureValue_CACHED_MAY_BE_STALE('tengu_birch_trellis', true)
    : false
  // Parse once here; the resulting AST feeds both parseForSecurityFromAst
  // and bashToolCheckCommandOperatorPermissions.
  let astRoot = injectionCheckDisabled
// 注：这个嵌套三元表达式把「三种情况」压成了两行，值得展开读：
//
//     注入检查被禁用           → null（不解析，走 legacy）
//     影子模式开启但 killswitch 关 → null（连解析都不做）
//     其他                     → await parseCommandRaw(command)
//
//     注意 `let astRoot` 也是可变的 —— 影子模式在下面第 1738 行会把它设回 null。
//     这种「先解析、再主动丢弃」的写法平时很少见，
//     但正是影子模式的定义：**跑一遍，只为拿结论，不为用它。**
    ? null
    : feature('TREE_SITTER_BASH_SHADOW') && !shadowEnabled
      ? null
      : await parseCommandRaw(input.command)
  let astResult: ParseForSecurityResult = astRoot
// 注：`parse-unavailable` 这个默认值选得好 —— 没有解析结果就等于「解析不可用」，
//     让下游自然回落到 legacy，而不是被当成「解析成功但没内容」。
//     一个类型的兜底值选对了，下游就不需要到处判空。
    ? parseForSecurityFromAst(input.command, astRoot)
    : { kind: 'parse-unavailable' }
  let astSubcommands: string[] | null = null
  let astRedirects: Redirect[] | undefined
  let astCommands: SimpleCommand[] | undefined
  let shadowLegacySubs: string[] | undefined

  // Shadow-test tree-sitter: record its verdict, then force parse-unavailable
  // so the legacy path stays authoritative. parseCommand stays gated on
  // TREE_SITTER_BASH (not SHADOW) so legacy internals remain pure regex.
  // One event per bash call captures both divergence AND unavailability
  // reasons; module-load failures are separately covered by the
  // session-scoped tengu_tree_sitter_load event.
// 译：影子测试 tree-sitter：记录它的结论，然后强制设成 parse-unavailable，
//     让 legacy 路径保持权威。parseCommand 仍然受 TREE_SITTER_BASH（而非 SHADOW）
//     控制，所以 legacy 内部仍然保持纯正则。
//
//     每次 bash 调用上报一个事件，同时捕获「分歧」和「不可用」两种原因；
//     模块加载失败另有会话级的 tengu_tree_sitter_load 事件覆盖。
//
// 注：这段是全文件最值得抄的一段「灰度上线脚手架」。它记录了 4 个维度的观测：
//        available      解析器能不能用
//        astTooComplex  解析成功但结构太复杂
//        astSemanticFail 解析成功但语义检查不过
//        subsDiffer     新旧切分结果不一致
//     再加 3 个上下文维度：注入检查是否被禁用、killswitch 是否关、命令是否超长。
//
//     这套设计的用意：上新解析器最大的风险不是它崩，而是它**静默地判得不一样**。
//     所以先把「不一样」变成可计数的指标，等分歧率足够低再切主路径。
//     而 `astSubcommands` 后面还会用到 `shadowLegacySubs` —— 影子模式下
//     连切分结果都留着给后面复用，避免重复调用 legacy splitCommand。
  if (feature('TREE_SITTER_BASH_SHADOW')) {
    const available = astResult.kind !== 'parse-unavailable'
    let tooComplex = false
    let semanticFail = false
    let subsDiffer = false
    if (available) {
      tooComplex = astResult.kind === 'too-complex'
      semanticFail =
        astResult.kind === 'simple' && !checkSemantics(astResult.commands).ok
      const tsSubs =
        astResult.kind === 'simple'
          ? astResult.commands.map(c => c.text)
          : undefined
      const legacySubs = splitCommand(input.command)
      shadowLegacySubs = legacySubs
      subsDiffer =
        tsSubs !== undefined &&
        (tsSubs.length !== legacySubs.length ||
          tsSubs.some((s, i) => s !== legacySubs[i]))
    }
    logEvent('tengu_tree_sitter_shadow', {
      available,
      astTooComplex: tooComplex,
      astSemanticFail: semanticFail,
      subsDiffer,
      injectionCheckDisabled,
      killswitchOff: !shadowEnabled,
      cmdOverLength: input.command.length > 10000,
    })
    // Always force legacy — shadow mode is observational only.
// 注：`astResult = { kind: 'parse-unavailable' }` + `astRoot = null`
//     这两行就是「影子模式的落地方式」：**把已经拿到的解析结果主动扔掉**。
//     所以本函数后面所有 `astResult.kind === 'parse-unavailable'` 的分支
//     在影子模式下都会走到 —— 也就是说影子模式等价于「完全回到改造前的行为」。
//     这是灰度发布里最理想的性质：开关一关，行为和上线前逐字节相同。
    astResult = { kind: 'parse-unavailable' }
    astRoot = null
  }

  if (astResult.kind === 'too-complex') {
// 注：`too-complex` 是这套设计的核心概念，它的含义在注释里写得很准确：
//     解析**成功了**，但发现的结构无法静态分析（命令替换、展开、控制流、解析器差异）。
//
//     注意它和「解析失败」的区别：
//       解析失败   → 命令本身语法就不对 → legacy 预检会 ask
//       too-complex → 语法没问题，但我们分析不了 → 这里 ask
//     两者的共同点：都**不能**信任 splitCommand 的输出。
//     这就是为什么 too-complex 要在这里直接返回，而不是继续往下走流程。
    // Parse succeeded but found structure we can't statically analyze
    // (command substitution, expansion, control flow, parser differential).
    // Respect exact-match deny/ask/allow, then prefix/wildcard deny. Only
    // fall through to ask if no deny matched — don't downgrade deny to ask.
    const earlyExit = checkEarlyExitDeny(input, appState.toolPermissionContext)
// 注：这是「deny 不能降级成 ask」原则的第 1 次落点。
//     走到这里说明结构分析不了，只能问用户 —— 但**问之前必须先把 deny 查完**。
//     否则用户配了 `Bash(curl:*)` deny，而命令是 `curl $(cat url.txt)`，
//     就会因为 too-complex 直接弹「是否允许」，用户一点就把 deny 绕过去了。
    if (earlyExit !== null) return earlyExit
    const decisionReason: PermissionDecisionReason = {
      type: 'other' as const,
      reason: astResult.reason,
    }
    logEvent('tengu_bash_ast_too_complex', {
// 注：埋点只上报 `nodeTypeId`（节点类型的数字 ID），不上报命令内容。
//     这就是那个品牌类型 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
//     存在的意义：此处传的是纯数字，天然安全；传命令原文的地方必须显式声明。
//
//     顺带一个实用价值：`nodeTypeId` 能告诉你**到底是哪种结构**让解析进了 too-complex。
//     线上如果有大量 too-complex，看这个 ID 的分布就知道该优先支持哪种语法。
      nodeTypeId: nodeTypeId(astResult.nodeType),
    })
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
      suggestions: [],
      ...(feature('BASH_CLASSIFIER')
// 注：`...(feature('BASH_CLASSIFIER') ? {...} : {})` 这个展开写法在本文件出现 8 次，
//     全是同一个目的：**让这段对象字面量在构建期就能被完整删除**。
//
//     为什么不用 `pendingClassifierCheck: feature('BASH_CLASSIFIER') ? x : undefined`？
//     因为那样属性名还在，Bun 的 DCE 只能删掉值、删不掉键，
//     而「有没有这个键」在 UI 侧是被判断的（`result.pendingClassifierCheck &&`）。
//     用对象展开，整个属性连同键一起消失 —— 这才是真正的死代码消除。
//
//     这个小技巧和第 81 行那个 DCE 悬崖是同一套知识的两面：
//     一面是「别把函数写太复杂」，另一面是「别把死代码写得删不掉」。
        ? {
            pendingClassifierCheck: buildPendingClassifierCheck(
              input.command,
              appState.toolPermissionContext,
            ),
          }
        : {}),
    }
  }

  if (astResult.kind === 'simple') {
// 注：`simple` 分支做两件事：
//     ① 用 checkSemantics 检查「切分正确但名字危险」的命令（zsh 内建、eval 等）
//     ② 把解析结果**缓存成字符串形态**给下游用
//
//     第 ② 件是关键的历史妥协，注释说得很坦白：
//     下游（规则匹配、路径提取、cd 检测）全部基于字符串，
//     所以这里把每个 SimpleCommand 的**源码片段**交出去，
//     下游会再对这些片段重新分词 —— 而那个重新分词**有已知 bug**。
//     注释还给了安全论证：这类 bug 影响不到这里，因为 checkSemantics 已经
//     拒绝过含换行的 argv 元素了（而 stripCommentLines 的 bug 正是关于换行）。
//
//     `Migrating downstream to operate on argv directly is a later commit.`
//     ——「以后会改」，是全项目最诚实的一句 TODO。
    // Clean parse: check semantic-level concerns (zsh builtins, eval, etc.)
    // that tokenize fine but are dangerous by name.
    const sem = checkSemantics(astResult.commands)
    if (!sem.ok) {
      // Same deny-rule enforcement as the too-complex path: a user with
      // `Bash(eval:*)` deny expects `eval "rm"` blocked, not downgraded.
      const earlyExit = checkSemanticsDeny(
// 注：语义检查失败时用的是 `checkSemanticsDeny`（而不是 `checkEarlyExitDeny`）——
//     区别在它多了一层「按 AST 片段逐条查前缀 deny」。
//     原因见第 1431 行那个函数的注释：复合命令护栏会挡住
//     `Bash(eval:*)` 匹配 `echo foo | eval rm`，所以必须按片段绕过护栏再查一次。
//
//     一句话：**结构不可信时（too-complex）只能查整条命令；
//     结构可信时（simple）可以查每一条片段，所以能查得更凶。**
        input,
        appState.toolPermissionContext,
        astResult.commands,
      )
      if (earlyExit !== null) return earlyExit
      const decisionReason: PermissionDecisionReason = {
        type: 'other' as const,
        reason: sem.reason,
      }
      return {
        behavior: 'ask',
        decisionReason,
        message: createPermissionRequestMessage(BashTool.name, decisionReason),
        suggestions: [],
      }
    }
    // Stash the tokenized subcommands for use below. Downstream code (rule
    // matching, path extraction, cd detection) still operates on strings, so
    // we pass the original source span for each SimpleCommand. Downstream
    // processing (stripSafeWrappers, parseCommandArguments) re-tokenizes
    // these spans — that re-tokenization has known bugs (stripCommentLines
    // mishandles newlines inside quotes), but checkSemantics already caught
    // any argv element containing a newline, so those bugs can't bite here.
    // Migrating downstream to operate on argv directly is a later commit.
    astSubcommands = astResult.commands.map(c => c.text)
// 注：三行赋值把 AST 的信息分流到三个变量，后面各管一摊：
//       astSubcommands  子命令字符串（给规则匹配用）
//       astRedirects    所有重定向（给路径校验用）
//       astCommands     SimpleCommand 对象（给逐条裁决用，按下标配对）
//
//     注意 astRedirects 用的是 `flatMap` —— 把所有子命令的 redirects 拼成一个平铺数组。
//     这意味着路径校验拿到的是「全命令的重定向集合」，不带「属于哪条子命令」的信息。
//     对「目标路径是否越界」这个判断来说够了，但如果以后要做更细的归属分析，
//     这里的信息已经丢了。
    astRedirects = astResult.commands.flatMap(c => c.redirects)
    astCommands = astResult.commands
  }

  // Legacy shell-quote pre-check. Only reached on 'parse-unavailable'
  // (tree-sitter not loaded OR TREE_SITTER_BASH feature gated off). Falls
  // through to the full legacy path below.
// 注：`parse-unavailable` 分支只在「tree-sitter 没加载」或「feature 关掉」时进入。
//     它做的事只有一件：用 shell-quote 试着解析一次，失败就问用户。
//
//     这是**唯一的兜底**，也是最弱的一道：shell-quote 不能真正解析 bash 语法，
//     它只是把字符串切成 token。切不动的会被判 malformed → ask。
//
//     注意注释里那句「Only reached on parse-unavailable」——
//     这个分支在正常构建里几乎不会走到，因为 TREE_SITTER_BASH 是开着的。
//     读这段代码时可以把它当成「历史路径」，理解它的存在意义（降级）就够了，
//     不必记住细节。
  if (astResult.kind === 'parse-unavailable') {
    logForDebugging(
      'bashToolHasPermission: tree-sitter unavailable, using legacy shell-quote path',
    )
    const parseResult = tryParseShellCommand(input.command)
    if (!parseResult.success) {
      const decisionReason = {
        type: 'other' as const,
        reason: `Command contains malformed syntax that cannot be parsed: ${parseResult.error}`,
      }
      return {
        behavior: 'ask',
        decisionReason,
        message: createPermissionRequestMessage(BashTool.name, decisionReason),
      }
    }
  }

  // Check sandbox auto-allow (which respects explicit deny/ask rules)
  // Only call this if sandboxing and auto-allow are both enabled
// 注：三个条件同时成立才考虑沙箱自动放行，缺一不可：
//       ① 沙箱功能启用
//       ② 配置里开了 autoAllowBashIfSandboxed
//       ③ 这条命令**确实会被沙箱**（shouldUseSandbox 判定）
//
//     第 ③ 条最容易忽略：不是「开了沙箱」就等于「所有命令都在沙箱里跑」——
//     有些命令（比如需要网络、需要写项目外）会被判定为不能沙箱化。
//     如果对这类命令也自动放行，就等于「以为有沙箱保护，其实没有」。
//     这类「前置条件看起来多余、其实每条都拦过真实问题」的判断，值得逐个想一遍。
  if (
    SandboxManager.isSandboxingEnabled() &&
    SandboxManager.isAutoAllowBashIfSandboxedEnabled() &&
    shouldUseSandbox(input)
  ) {
    const sandboxAutoAllowResult = checkSandboxAutoAllow(
      input,
      appState.toolPermissionContext,
    )
    if (sandboxAutoAllowResult.behavior !== 'passthrough') {
      return sandboxAutoAllowResult
    }
  }

  // Check exact match first
  const exactMatchResult = bashToolCheckExactMatchPermission(
// 注：这是精确匹配的**第 2 次**调用（第 1 次在 bashToolCheckPermission 内部，
//     但那是在逐子命令阶段）。这里是「整条命令」级别的精确匹配，而且**只接受 deny**。
//
//     为什么这次只接受 deny？因为 ask/allow 的语义在整条命令级别没有意义：
//     `Bash(git push:*)` 这种前缀规则要等拆成子命令才有意义，
//     而精确规则 `Bash(git push origin main)` 在这里 allow 也不合适 ——
//     万一命令后面还有 `&& rm -rf /` 呢。所以这里只做「否决」，不做「批准」。
    input,
    appState.toolPermissionContext,
  )

  // Exact command was denied
  if (exactMatchResult.behavior === 'deny') {
    return exactMatchResult
  }

  // Check Bash prompt deny and ask rules in parallel (both use Haiku).
  // Deny takes precedence over ask, and both take precedence over allow rules.
  // Skip when in auto mode - auto mode classifier handles all permission decisions
// 注：这一段是**模型参与的权限判定**：把用户的自然语言规则（prompt 规则）
//     和当前命令一起丢给 Haiku，让它判断这条命令是否命中某条 deny/ask 描述。
//
//     两个请求并行（`Promise.all`），因为 deny 和 ask 的规则集是不同的两套描述，
//     互不依赖。而裁决顺序仍然是 deny 优先 —— 并行是为了快，不是为了改变优先级。
//
//     这是本项目「用 LLM 做权限判定」的入口，理解它的边界很重要：
//     分类器只回答「是否符合用户写过的某句话」，不做通用的危险评估。
  if (
    isClassifierPermissionsEnabled() &&
    !(
      feature('TRANSCRIPT_CLASSIFIER') &&
      appState.toolPermissionContext.mode === 'auto'
    )
  ) {
    const denyDescriptions = getBashPromptDenyDescriptions(
      appState.toolPermissionContext,
    )
    const askDescriptions = getBashPromptAskDescriptions(
      appState.toolPermissionContext,
    )
    const hasDeny = denyDescriptions.length > 0
    const hasAsk = askDescriptions.length > 0

    if (hasDeny || hasAsk) {
      const [denyResult, askResult] = await Promise.all([
        hasDeny
          ? classifyBashCommand(
              input.command,
              getCwd(),
              denyDescriptions,
              'deny',
              context.abortController.signal,
              context.options.isNonInteractiveSession,
            )
          : null,
        hasAsk
          ? classifyBashCommand(
              input.command,
              getCwd(),
              askDescriptions,
              'ask',
              context.abortController.signal,
              context.options.isNonInteractiveSession,
            )
          : null,
      ])

      if (context.abortController.signal.aborted) {
// 注：await 回来之后**立刻**检查 aborted。这是一个必须养成的习惯：
//     任何 await 之后的第一个动作，应该是「我还该继续吗」。
//     不检查的后果是：用户已经取消了这个工具调用，代码却还在往下走，
//     可能弹出一个已经无人等待的权限框，或者返回一个会被丢弃的结果。
        throw new AbortError()
      }

      if (denyResult) {
        logClassifierResultForAnts(
          input.command,
          'deny',
          denyDescriptions,
          denyResult,
        )
      }
      if (askResult) {
        logClassifierResultForAnts(
          input.command,
          'ask',
          askDescriptions,
          askResult,
        )
      }

      // Deny takes precedence
// 注：deny 优先于 ask —— 同一段代码里两条规则都命中时，走 deny。
//     注意优先级是「规则的行为」优先，而不是「哪个先返回」优先。
//     因为两个请求是并行的，返回顺序不确定；靠比较结果而不是靠时序，才可靠。
      if (denyResult?.matches && denyResult.confidence === 'high') {
        return {
          behavior: 'deny',
          message: `Denied by Bash prompt rule: "${denyResult.matchedDescription}"`,
          decisionReason: {
            type: 'other',
            reason: `Denied by Bash prompt rule: "${denyResult.matchedDescription}"`,
          },
        }
      }

      if (askResult?.matches && askResult.confidence === 'high') {
// 注：这里有一段「跳过 Haiku 调用」的注释，反映了一次产品决策变化：
//     原来是让 Haiku 算「这条命令该建议什么前缀规则」，
//     现在改成本地计算 + 让用户在输入框里自己改。
//
//     但代码里还留着注入版本的分支（`getCommandSubcommandPrefixFn !== 默认实现`），
//     所以线上那段 `await getCommandSubcommandPrefixFn(...)` 是**死代码**。
//     这是「重构后没清理旧路径」的典型痕迹 —— 判断依据就是那个相等性比较：
//     只要它和默认实现相同，就走本地计算。
        // Skip the Haiku call — the UI computes the prefix locally
        // and lets the user edit it. Still call the injected function
        // when tests override it.
        let suggestions: PermissionUpdate[]
        if (getCommandSubcommandPrefixFn === getCommandSubcommandPrefix) {
          suggestions = suggestionForExactCommand(input.command)
        } else {
          const commandPrefixResult = await getCommandSubcommandPrefixFn(
            input.command,
            context.abortController.signal,
            context.options.isNonInteractiveSession,
          )
          if (context.abortController.signal.aborted) {
            throw new AbortError()
          }
          suggestions = commandPrefixResult?.commandPrefix
            ? suggestionForPrefix(commandPrefixResult.commandPrefix)
            : suggestionForExactCommand(input.command)
        }
        return {
          behavior: 'ask',
          message: createPermissionRequestMessage(BashTool.name),
          decisionReason: {
            type: 'other',
            reason: `Required by Bash prompt rule: "${askResult.matchedDescription}"`,
          },
          suggestions,
          ...(feature('BASH_CLASSIFIER')
            ? {
                pendingClassifierCheck: buildPendingClassifierCheck(
                  input.command,
                  appState.toolPermissionContext,
                ),
              }
            : {}),
        }
      }
    }
  }

  // Check for non-subcommand Bash operators like `>`, `|`, etc.
  // This must happen before dangerous path checks so that piped commands
  // are handled by the operator logic (which generates "multiple operations" messages)
// 注：这一步处理管道和操作符（`|`、`>`、`&&` 等），
//     而它的实现方式很激进：**对每一段重新调用本函数**（递归）。
//
//     见 bashCommandHelpers.ts:91 —— 对每个 segment 调
//     `bashToolHasPermissionFn({ ...input, command: trimmedSegment })`。
//     也就是说「拆段 → 逐段完整走一遍权限判定 → 汇总」。
//     递归的终止条件是：段里没有操作符了，于是 checkCommandOperatorPermissions 返回 passthrough。
//
//     这种「递归回自己」的写法让代码很短，但代价是：
//     ① 每一层都要重新做 AST 解析（虽然传了 astRoot 复用，但段是新字符串）
//     ② 调试栈会变深，日志要看清是第几层
//     ③ 前面那些早期出口（too-complex、语义检查）会在每一层各跑一遍
  const commandOperatorResult = await checkCommandOperatorPermissions(
    input,
    (i: z.infer<typeof BashTool.inputSchema>) =>
      bashToolHasPermission(i, context, getCommandSubcommandPrefixFn),
    { isNormalizedCdCommand, isNormalizedGitCommand },
    astRoot,
  )
  if (commandOperatorResult.behavior !== 'passthrough') {
    // SECURITY FIX: When pipe segment processing returns 'allow', we must still validate
    // the ORIGINAL command. The pipe segment processing strips redirections before
    // checking each segment, so commands like:
    //   echo 'x' | xargs printf '%s' >> /tmp/file
    // would have both segments allowed (echo and xargs printf) but the >> redirection
    // would bypass validation. We must check:
    // 1. Path constraints for output redirections
    // 2. Command safety for dangerous patterns (backticks, etc.) in redirect targets
// 译：SECURITY FIX：当管道分段处理返回 'allow' 时，我们**仍须**校验原始命令。
//     分段处理会在检查每段之前剥掉重定向，所以像
//         echo 'x' | xargs printf '%s' >> /tmp/file
//     这样的命令，两段都会通过（echo 和 xargs printf），
//     但 `>>` 重定向就绕过了校验。必须检查：
//       ① 输出重定向的路径约束
//       ② 重定向目标里的危险模式（反引号、$() 等）
//
// 注：这段注释揭示了一个**结构性漏洞类别**：
//     「先把命令拆开、逐块检查」这种模式，一定会丢掉「块与块之间」的信息。
//     这里的丢失物是重定向（被 splitCommand 剥掉了）。
//     同类问题在本函数出现 2 次（这里和第 2268 行），修法都是
//     「对**原始**命令再补一次检查」。
    if (commandOperatorResult.behavior === 'allow') {
      // Check for dangerous patterns (backticks, $(), etc.) in the original command
      // This catches cases like: echo x | xargs echo > `pwd`/evil.txt
      // where the backtick is in the redirect target (stripped from segments)
      // Gate on AST: when astSubcommands is non-null, tree-sitter already
      // validated structure (backticks/$() in redirect targets would have
      // returned too-complex). Matches gating at ~1481, ~1706, ~1755.
      // Avoids FP: `find -exec {} \; | grep x` tripping on backslash-;.
      // bashCommandIsSafe runs the full legacy regex battery (~20 patterns) —
      // only call it when we'll actually use the result.
// 注：`astSubcommands === null` 是「有没有可信解析」的判据，全函数出现 4 次
//     （这里、2086、2163、2345）。每次的含义都一样：
//         null  → 只能信 legacy，要多做检查
//         非 null → AST 已验证结构，可以跳过这些检查
//
//     这种「用一个变量当全局可信标记」的写法很省事，但也是维护风险：
//     如果有哪条路径忘了同步这个变量，检查就会被静默跳过。
//     读的时候值得逐个确认这 4 处的 null 都是从同一个地方来的。
// 注：`bashCommandIsSafeAsync` 会跑完整的 legacy 正则批次（约 20 个模式），
//     所以注释特别强调「只在真要用结果时才调用」。
//     这就是把 `null` 和「调用了但没结果」区分开的原因：
//     `astSubcommands !== null` 时根本不发起调用，而不是发起了再丢弃。
//
//     一个性能细节：这段是热路径（每次 bash 调用都走），
//     省掉一次 20 条正则的扫描是可测量的收益。
//     同一处注释还提了一个误报案例：`find -exec {} \; | grep x` 会被
//     反斜杠分号的检查误伤 —— 有了 AST 就不必再受这个误报。
      const safetyResult =
        astSubcommands === null
          ? await bashCommandIsSafeAsync(input.command)
          : null
      if (
        safetyResult !== null &&
        safetyResult.behavior !== 'passthrough' &&
        safetyResult.behavior !== 'allow'
      ) {
        // Attach pending classifier check - may auto-approve before user responds
        appState = context.getAppState()
        return {
          behavior: 'ask',
          message: createPermissionRequestMessage(BashTool.name, {
            type: 'other',
            reason:
              safetyResult.message ??
              'Command contains patterns that require approval',
          }),
          decisionReason: {
            type: 'other',
            reason:
              safetyResult.message ??
              'Command contains patterns that require approval',
          },
          ...(feature('BASH_CLASSIFIER')
            ? {
                pendingClassifierCheck: buildPendingClassifierCheck(
                  input.command,
                  appState.toolPermissionContext,
                ),
              }
            : {}),
        }
      }

      appState = context.getAppState()
// 注：又取了一次 appState。因为上面 await 了 bashCommandIsSafeAsync，
//     期间用户可能切了模式。这类「await 之后重取状态」在本函数一共 5 次，
//     每次都是同一个理由，没有一次是多余的。
// 注：这一段是**真实漏洞的修复现场**，值得完整读：
//
//     原来这里硬编码 `compoundCommandHasCd = false`。于是
//         cd .claude && echo x > settings.json | echo done
//     会走管道分段这条路（因为有 `|`），而分段路径把 compoundCommandHasCd 当 false，
//     结果 pathValidation.ts:821 那个「cd + 重定向」的拦截**不触发** ——
//     重定向就写进了 .claude/settings.json。
//
//     修法：用 `commandHasAnyCd(input.command)` 从**完整命令**里算。
//     `commandHasAnyCd` 就在本文件末尾（第 2617 行），它对每条子命令做归一化后判断。
//
//     这个 bug 的教训很普遍：**布尔标志在分支路径上被简化成常量**，
//     是最容易发生、最难发现的一类失效。
      // SECURITY: Compute compoundCommandHasCd from the full command, NOT
      // hardcode false. The pipe-handling path previously passed `false` here,
      // disabling the cd+redirect check at pathValidation.ts:821. Appending
      // `| echo done` to `cd .claude && echo x > settings.json` routed through
      // this path with compoundCommandHasCd=false, letting the redirect write
      // to .claude/settings.json without the cd+redirect block firing.
      const pathResult = checkPathConstraints(
        input,
        getCwd(),
        appState.toolPermissionContext,
        commandHasAnyCd(input.command),
        astRedirects,
        astCommands,
      )
      if (pathResult.behavior !== 'passthrough') {
        return pathResult
      }
    }

    // When pipe segments return 'ask' (individual segments not allowed by rules),
    // attach pending classifier check - may auto-approve before user responds.
    if (commandOperatorResult.behavior === 'ask') {
// 注：管道分段返回 ask 时，也要挂上 pendingClassifierCheck ——
//     让分类器有机会在用户点之前自动放行。
//
//     注意这里用了 `...commandOperatorResult` 展开而不是重新构造：
//     保留子结果里的 message、decisionReason、suggestions，
//     只额外加一个分类器检查。这种「展开 + 追加」的写法在本函数后半段反复出现，
//     好处是不会丢掉上游已经算好的信息。
      appState = context.getAppState()
      return {
        ...commandOperatorResult,
        ...(feature('BASH_CLASSIFIER')
          ? {
              pendingClassifierCheck: buildPendingClassifierCheck(
                input.command,
                appState.toolPermissionContext,
              ),
            }
          : {}),
      }
    }

    return commandOperatorResult
  }

  // SECURITY: Legacy misparsing gate. Only runs when the tree-sitter module
  // is not loaded. Timeout/abort is fail-closed via too-complex (returned
  // early above), not routed here. When the AST parse succeeded,
  // astSubcommands is non-null and we've already validated structure; this
  // block is skipped entirely. The AST's 'too-complex' result subsumes
  // everything isBashSecurityCheckForMisparsing covered — both answer the
  // same question: "can splitCommand be trusted on this input?"
// 注：这段是 legacy 的「解析不可信」闸门，历史地位很重要 ——
//     它曾经是**唯一**防止「检测器看到 A、bash 执行 B」的机制，
//     具体实现就是 bashSecurity.ts 里那 22 个 validator。
//
//     现在它的角色变成了兜底：只有当 AST 不可用（astSubcommands === null）时才跑。
//     注释里那句判断非常到位：
//         The AST''s ''too-complex'' result subsumes everything
//         isBashSecurityCheckForMisparsing covered — both answer the same question:
//         "can splitCommand be trusted on this input?"
//
//     也就是说：22 个 validator 用 2592 行代码在猜的问题，
//     tree-sitter 用一个 `too-complex` 就回答了。
//     这就是为什么这次重构值得学 —— 不是「写得更好」，而是**问题本身被消解了**。
  if (
    astSubcommands === null &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK)
  ) {
    const originalCommandSafetyResult = await bashCommandIsSafeAsync(
      input.command,
    )
    if (
      originalCommandSafetyResult.behavior === 'ask' &&
      originalCommandSafetyResult.isBashSecurityCheckForMisparsing
    ) {
      // Compound commands with safe heredoc patterns ($(cat <<'EOF'...EOF))
      // trigger the $() check on the unsplit command. Strip the safe heredocs
      // and re-check the remainder — if other misparsing patterns exist
      // (e.g. backslash-escaped operators), they must still block.
      const remainder = stripSafeHeredocSubstitutions(input.command)
// 注：`stripSafeHeredocSubstitutions` 处理的是一个具体的误报：
//     `$(cat <<'EOF' ... EOF)` 会触发 `$()` 检查，但这里 `$()` 包的是**字面量 heredoc**，
//     不构成命令替换风险。
//
//     处理方式很稳：剥掉安全的 heredoc 之后**重查一遍剩余部分**。
//     如果剩下的还有 misparsing 模式（比如反斜杠转义操作符），照样拦。
//     这是「为了减少误报而放宽，但放宽后立刻再验一次」的标准做法 ——
//     不是「看到白名单就整条放行」。
      const remainderResult =
        remainder !== null ? await bashCommandIsSafeAsync(remainder) : null
      if (
        remainder === null ||
        (remainderResult?.behavior === 'ask' &&
          remainderResult.isBashSecurityCheckForMisparsing)
      ) {
        // Allow if the exact command has an explicit allow permission — the user
        // made a conscious choice to permit this specific command.
// 注：这是 deny/allow 优先级里一个刻意的例外：
//     结构不可信时，如果用户对**这条命令原文**显式配了 allow，就放行。
//
//     理由写在注释里：`the user made a conscious choice to permit this specific command`。
//     也就是「精确 allow」被视为最强的人工授权，优先级甚至高于
//     「结构不可解析」这个安全警报。
//
//     这个例外合不合理可以讨论，但它体现了权限系统的一个隐含分级：
//       精确 allow（用户逐字批准过）> 安全警报 > 前缀 allow
//     把这条记下来，遇到「为什么这条命令没弹窗」时先查有没有精确 allow 规则。
        appState = context.getAppState()
        const exactMatchResult = bashToolCheckExactMatchPermission(
          input,
          appState.toolPermissionContext,
        )
        if (exactMatchResult.behavior === 'allow') {
          return exactMatchResult
        }
        // Attach pending classifier check - may auto-approve before user responds
        const decisionReason: PermissionDecisionReason = {
          type: 'other' as const,
          reason: originalCommandSafetyResult.message,
        }
        return {
          behavior: 'ask',
          message: createPermissionRequestMessage(
            BashTool.name,
            decisionReason,
          ),
          decisionReason,
          suggestions: [], // Don't suggest saving a potentially dangerous command
          ...(feature('BASH_CLASSIFIER')
            ? {
                pendingClassifierCheck: buildPendingClassifierCheck(
                  input.command,
                  appState.toolPermissionContext,
                ),
              }
            : {}),
        }
      }
    }
  }

  // Split into subcommands. Prefer the AST-extracted spans; fall back to
  // splitCommand only when tree-sitter was unavailable. The cd-cwd filter
  // strips the `cd ${cwd}` prefix that models like to prepend.
// 注：从这里开始进入「按子命令裁决」阶段。数据来源的优先级是：
//       astSubcommands（AST 切分，可信）
//    ?? shadowLegacySubs（影子模式下已经算过的 legacy 结果，避免重复计算）
//    ?? splitCommand（现算 legacy）
//
//     `??` 链在这里用得很恰当：三个来源都是「数组或 null/undefined」，
//     语义就是「用第一个可用的」。
  const cwd = getCwd()
// 注：Windows 上要额外算一个 mingw 形态的 cwd（`/c/Users/...`）。
//     因为模型可能把路径写成 POSIX 风格，而 `cd /c/Users/...` 也要被识别成
//     「cd 到当前目录」，才能被过滤掉。这是跨平台路径处理的常见坑：
//     同一个目录在 Windows 上有两种写法，字符串比较必须两种都比。
  const cwdMingw =
    getPlatform() === 'windows' ? windowsPathToPosixPath(cwd) : cwd
  const rawSubcommands =
    astSubcommands ?? shadowLegacySubs ?? splitCommand(input.command)
  const { subcommands, astCommandsByIdx } = filterCdCwdSubcommands(
    rawSubcommands,
    astCommands,
    cwd,
    cwdMingw,
  )

  // CC-643: Cap subcommand fanout. Only the legacy splitCommand path can
  // explode — the AST path returns a bounded list (astSubcommands !== null)
  // or short-circuits to 'too-complex' for structures it can't represent.
// 注：CC-643 的收敛点 —— 只在 legacy 路径上检查数量上限。
//     注释给了理由：AST 路径返回的是**有界**列表，或者对表示不了的结构
//     直接短路成 too-complex。所以只有 splitCommand 可能爆炸。
//
//     这个「只在可能出问题的分支上加护栏」的写法，比在入口统一加护栏更精准：
//     入口加护栏可能误伤合法的复杂命令（AST 本来能处理），
//     分支加护栏则只拦住真正危险的路径。
  if (
    astSubcommands === null &&
    subcommands.length > MAX_SUBCOMMANDS_FOR_SECURITY_CHECK
  ) {
    logForDebugging(
      `bashPermissions: ${subcommands.length} subcommands exceeds cap (${MAX_SUBCOMMANDS_FOR_SECURITY_CHECK}) — returning ask`,
      { level: 'debug' },
    )
    const decisionReason = {
      type: 'other' as const,
      reason: `Command splits into ${subcommands.length} subcommands, too many to safety-check individually`,
    }
    return {
      behavior: 'ask',
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
      decisionReason,
    }
  }

  // Ask if there are multiple `cd` commands
// 注：`cd a && cd b` 这种命令会 ask，理由是「清晰性」而不是安全 ——
//     注释写的是 `require approval for clarity`。
//     多个目录切换让人（和模型自己）难以预判最终在哪个目录执行，
//     所以干脆问一声。这是一个**可用性检查混在安全检查函数里**的例子，
//     读的时候要能分辨：不是每一条 ask 都是安全原因。
  const cdCommands = subcommands.filter(subCommand =>
    isNormalizedCdCommand(subCommand),
  )
  if (cdCommands.length > 1) {
    const decisionReason = {
      type: 'other' as const,
      reason:
        'Multiple directory changes in one command require approval for clarity',
    }
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(BashTool.name, decisionReason),
    }
  }

  // Track if compound command contains cd for security validation
  // This prevents bypassing path checks via: cd .claude/ && mv test.txt settings.json
// 注：`compoundCommandHasCd` 这个布尔值后面被传给 4 个下游
//     （逐条裁决、路径校验、两次子结果合并），是「这条命令改过目录」的唯一信号。
//
//     它存在的原因（注释第 2199 行）：没有它就能这样绕过路径检查：
//         cd .claude/ && mv test.txt settings.json
//     单看 `mv test.txt settings.json` 完全正常（都在「当前目录」内），
//     但当前目录已经被 cd 换过了。所以「改过目录」必须作为独立信号传下去，
//     让路径校验知道「相对路径的基准已经变了」。
  const compoundCommandHasCd = cdCommands.length > 0

  // SECURITY: Block compound commands that have both cd AND git
  // This prevents sandbox escape via: cd /malicious/dir && git status
  // where the malicious directory contains a bare git repo with core.fsmonitor.
  // This check must happen HERE (before subcommand-level permission checks)
  // because bashToolCheckPermission checks each subcommand independently via
  // BashTool.isReadOnly(), which would re-derive compoundCommandHasCd=false
  // from just "git status" alone, bypassing the readOnlyValidation.ts check.
// 注：cd + git 的组合门禁，是一个具体攻击的封堵：
//         cd /malicious/dir && git status
//     恶意目录里放一个裸 git 仓库，仓库的 `core.fsmonitor` 配置会在 git 执行时
//     运行任意命令 —— 于是 `git status` 这种「只读命令」变成了 RCE。
//
//     关键在注释第 2205-2208 行：这个检查**必须在这里做**，
//     不能依赖逐子命令的 `BashTool.isReadOnly()`。因为 isReadOnly 对
//     `git status` 单独判定时会重新算出 compoundCommandHasCd=false，
//     从而绕过 readOnlyValidation.ts 里那道门禁。
//
//     一句话：**安全判断不能在拆开之后做，因为拆开会丢上下文。**
  if (compoundCommandHasCd) {
    const hasGitCommand = subcommands.some(cmd =>
      isNormalizedGitCommand(cmd.trim()),
    )
    if (hasGitCommand) {
      const decisionReason = {
        type: 'other' as const,
        reason:
          'Compound commands with cd and git require approval to prevent bare repository attacks',
      }
      return {
        behavior: 'ask',
        decisionReason,
        message: createPermissionRequestMessage(BashTool.name, decisionReason),
      }
    }
  }

  appState = context.getAppState() // re-compute the latest in case the user hit shift+tab
// 注：第 5 次 re-getAppState。到这里已经 await 了好几次（分类器、管道递归），
//     用户切模式的可能性实实在在地存在。
//     注意注释只写了 `in case the user hit shift+tab`，很短 ——
//     因为同一句理由在文件里已经写了 4 遍。

  // SECURITY FIX: Check Bash deny/ask rules BEFORE path constraints
  // This ensures that explicit deny rules like Bash(ls:*) take precedence over
  // path constraint checks that return 'ask' for paths outside the project.
  // Without this ordering, absolute paths outside the project (e.g., ls /home)
  // would bypass deny rules because checkPathConstraints would return 'ask' first.
  //
  // Note: bashToolCheckPermission calls checkPathConstraints internally, which handles
  // output redirection validation on each subcommand. However, since splitCommand strips
  // redirections before we get here, we MUST validate output redirections on the ORIGINAL
  // command AFTER checking deny rules but BEFORE returning results.
  const subcommandPermissionDecisions = subcommands.map((command, i) =>
// 注：逐条子命令裁决。注意传了 `astCommandsByIdx[i]` ——
//     如果这条子命令有 AST 版本，路径校验就能直接用 AST 的 redirects 和 argv，
//     不必再用 shell-quote 重新解析（那个有单引号 bug）。
//
//     这是「有证据就交出证据」的第三处落点（前两处在 1112 和 2045）。
//     整个文件围绕这个模式组织：AST 数据一路往下传，能传到的层就不用重新解析。
    bashToolCheckPermission(
      { command },
      appState.toolPermissionContext,
      compoundCommandHasCd,
      astCommandsByIdx[i],
    ),
  )

  // Deny if any subcommands are denied
  const deniedSubresult = subcommandPermissionDecisions.find(
// 注：**任一子命令 deny → 整条命令 deny**。这是「deny 优先」在子命令级别的体现。
//
//     注意 decisionReason 的类型是 'subcommandResults'，里面是一个
//     Map<子命令, 结果>。这个 Map 会把**所有**子命令的结果都带上，
//     而不只是被拒的那一条 —— 因为 UI 需要展示整条命令每一段发生了什么。
//     这也是为什么这个 Map 在函数后半段被反复重建（2258、2377、2466、2518）。
    _ => _.behavior === 'deny',
  )
  if (deniedSubresult !== undefined) {
    return {
      behavior: 'deny',
      message: `Permission to use ${BashTool.name} with command ${input.command} has been denied.`,
      decisionReason: {
        type: 'subcommandResults',
        reasons: new Map(
          subcommandPermissionDecisions.map((result, i) => [
            subcommands[i]!,
            result,
          ]),
        ),
      },
    }
  }

  // Validate output redirections on the ORIGINAL command (before splitCommand stripped them)
  // This must happen AFTER checking deny rules but BEFORE returning results.
  // Output redirections like "> /etc/passwd" are stripped by splitCommand, so the per-subcommand
  // checkPathConstraints calls won't see them. We validate them here on the original input.
  // SECURITY: When AST data is available, pass AST-derived redirects so
  // checkPathConstraints uses them directly instead of re-parsing with
  // shell-quote (which has a known single-quote backslash misparsing bug
  // that can silently hide redirect operators).
// 注：这一段的注释是全文件最重要的一条**结构性提醒**：
//
//     splitCommand（以及它的 AST 替代）会在拆分时**剥掉输出重定向**。
//     所以「逐子命令的路径校验」永远看不到 `> /etc/passwd` 这类重定向。
//     必须在**原始命令**上单独校验一次。
//
//     而且顺序被明确写死：**在检查完 deny 规则之后、返回结果之前**。
//     太早 → deny 规则会被路径 ask 抢答（回到那个降级问题）；
//     太晚 → allow 已经返回了，重定向就没校验过。
//
//     这种「顺序本身是安全约束」的地方，注释里都用了 must happen AFTER ... BEFORE ...
//     这种句式，值得当成路标来读。
  const pathResult = checkPathConstraints(
    input,
    getCwd(),
    appState.toolPermissionContext,
    compoundCommandHasCd,
    astRedirects,
    astCommands,
  )
  if (pathResult.behavior === 'deny') {
// 注：注意这里只处理 `deny`，`ask` 被留到后面（第 2310 行）再判断。
//     原因是 GH#28784（见下一条注）：path 的 ask 有时会把子命令的 ask 盖掉，
//     导致弹窗文案只提「读取某个目录」而不提真正危险的命令。
//
//     所以这里的写法是：deny 立刻返回（必须），ask 先攒着（稍后合并）。
    return pathResult
  }

  const askSubresult = subcommandPermissionDecisions.find(
    _ => _.behavior === 'ask',
  )
  const nonAllowCount = count(
    subcommandPermissionDecisions,
    _ => _.behavior !== 'allow',
  )

  // SECURITY (GH#28784): Only short-circuit on a path-constraint 'ask' when no
  // subcommand independently produced an 'ask'. checkPathConstraints re-runs the
  // path-command loop on the full input, so `cd <outside-project> && python3 foo.py`
  // produces an ask with ONLY a Read(<dir>/**) suggestion — the UI renders it as
  // "Yes, allow reading from <dir>/" and picking that option silently approves
  // python3. When a subcommand has its own ask (e.g. the cd subcommand's own
  // path-constraint ask), fall through: either the askSubresult short-circuit
  // below fires (single non-allow subcommand) or the merge flow collects Bash
  // rule suggestions for every non-allow subcommand. The per-subcommand
  // checkPathConstraints call inside bashToolCheckPermission already captures
  // the Read rule for the cd target in that path.
  //
  // When no subcommand asked (all allow, or all passthrough like `printf > file`),
  // pathResult IS the only ask — return it so redirection checks surface.
// 注：GH#28784 是这份代码里记录得最完整的一个 UX 安全 bug，值得完整理解：
//
//     场景：`cd <项目外目录> && python3 foo.py`
//     checkPathConstraints 会在**整条命令**上重跑一遍，产出一个 ask，
//     但它只带一条 `Read(<dir>/**)` 建议。
//     于是 UI 渲染成「是的，允许读取 <dir>/」—— 用户点这个选项，
//     实际批准的是 **python3 执行**，而弹窗上根本没提这件事。
//
//     修法：只有当**没有任何子命令自己产出 ask** 时，才让 path 的 ask 短路返回。
//     否则继续往下走合并流程，把每个非 allow 子命令的规则建议都收集起来，
//     让弹窗显示完整的 Bash 规则。
//
//     这条 bug 的本质是：**弹窗文案是权限决策的一部分**。
//     用户点的不是「allow」，是「allow 这句话所描述的事」。
//     文案与真实授权不一致，就等于骗用户授权。
  if (pathResult.behavior === 'ask' && askSubresult === undefined) {
    return pathResult
  }

  // Ask if any subcommands require approval (e.g., ls/cd outside boundaries).
  // Only short-circuit when exactly ONE subcommand needs approval — if multiple
  // do (e.g. cd-outside-project ask + python3 passthrough), fall through to the
  // merge flow so the prompt surfaces Bash rule suggestions for all of them
  // instead of only the first ask's Read rule (GH#28784).
  if (askSubresult !== undefined && nonAllowCount === 1) {
// 注：`nonAllowCount === 1` 才短路。多个非 allow 时不短路，
//     同样是为了 GH#28784 的合并流程（让弹窗列出所有需要批准的命令）。
//
//     注意这里判断的是「非 allow 的数量」，而不是「ask 的数量」——
//     passthrough 也算非 allow，因为它同样需要用户决策。
//     一个巧合但有用的边界：`printf > file` 这种全是 passthrough 的命令，
//     会走合并流程而不是短路，于是路径 ask 才有机会被看到。
    return {
      ...askSubresult,
      ...(feature('BASH_CLASSIFIER')
        ? {
            pendingClassifierCheck: buildPendingClassifierCheck(
              input.command,
              appState.toolPermissionContext,
            ),
          }
        : {}),
    }
  }

  // Allow if exact command was allowed
// 注：精确 allow 的兑现点 —— 第 1 步扣住的 allow 终于在这里返回。
//     位置在「所有 deny 检查都跑完」之后，符合那句原则：
//     allow 要等到所有 deny 都问过话。
//
//     但注意它的位置在 subcommand ask 之后（2319）：也就是说
//     「某条子命令要问」优先于「整条命令被精确 allow」。
//     这个顺序其实有待商榷（精确 allow 是用户逐字批准过的），
//     但从保守角度看：多问一句比少问一句安全。
  if (exactMatchResult.behavior === 'allow') {
    return exactMatchResult
  }

  // If all subcommands are allowed via exact or prefix match, allow the
  // command — but only if no command injection is possible. When the AST
  // parse succeeded, each subcommand is already known-safe (no hidden
  // substitutions, no structural tricks); the per-subcommand re-check is
  // redundant. When on the legacy path, re-run bashCommandIsSafeAsync per sub.
  let hasPossibleCommandInjection = false
// 注：`hasPossibleCommandInjection` 的默认值是 false。这个默认值很关键：
//     AST 路径下（astSubcommands !== null）根本不会进下面那个 if，
//     于是「没有注入」这个结论是**默认成立**的，而不是**检查得出**的。
//
//     也就是说：AST 可信时，「结构已验证」这个事实替代了「逐段跑 20 条正则」。
//     这正是新架构的价值 —— 不是检查得更严，而是**用一次正确解析替代 N 次猜测**。
//     但反过来说：如果 AST 判定有 bug，这条捷径就是静默放行。
  if (
    astSubcommands === null &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK)
  ) {
    // CC-643: Batch divergence telemetry into a single logEvent. The per-sub
    // logEvent was the hot-path syscall driver (each call → /proc/self/stat
    // via process.memoryUsage()). Aggregate count preserves the signal.
// 注：CC-643 的第二个修复 —— 埋点批量化。
//     原来每个子命令一次 logEvent，而 logEvent 会触发 `process.memoryUsage()`，
//     后者读 `/proc/self/stat`。这就是上面第 95 行注释里那句
//     「strace 显示以约 127Hz 读 /proc/self/stat」的直接来源。
//
//     修法：用闭包里的计数器累计分歧次数，最后只发一个事件。
//     注释写得很准确：`Aggregate count preserves the signal` —— 保留了信号，
//     丢掉了「哪一段分歧」的细节。这是性能与可观测性之间的明确取舍。
    let divergenceCount = 0
    const onDivergence = () => {
      divergenceCount++
    }
    const results = await Promise.all(
      subcommands.map(c => bashCommandIsSafeAsync(c, onDivergence)),
    )
    hasPossibleCommandInjection = results.some(
      r => r.behavior !== 'passthrough',
    )
    if (divergenceCount > 0) {
      logEvent('tengu_tree_sitter_security_divergence', {
        quoteContextDivergence: true,
        count: divergenceCount,
      })
    }
  }
  if (
// 注：`every(allow) && !hasPossibleCommandInjection` —— 全 allow 才放行。
//
//     这个条件比它看起来严格：`every` 意味着**不允许 passthrough**。
//     一条 passthrough 的子命令（没规则匹配、也不是只读）就会让这里不成立，
//     于是走到后面的「问用户」流程。这是对的：passthrough 的定义就是
//     「我这关没意见」，不等于「同意」。
    subcommandPermissionDecisions.every(_ => _.behavior === 'allow') &&
    !hasPossibleCommandInjection
  ) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'subcommandResults',
        reasons: new Map(
          subcommandPermissionDecisions.map((result, i) => [
            subcommands[i]!,
            result,
          ]),
        ),
      },
    }
  }

  // Query Haiku for command prefixes
  // Skip the Haiku call — the UI computes the prefix locally and
  // lets the user edit it. Still call when a custom fn is injected (tests).
// 注：这里又一次出现那个「跳过 Haiku」的分支。
//     默认实现时 `commandSubcommandPrefix` 保持 null，后面
//     `commandSubcommandPrefix?.subcommandPrefixes.get(subcommand)` 就是 undefined，
//     于是 checkCommandAndSuggestRules 退回精确建议。
//
//     所以线上行为是：建议规则全部由**本地计算**给出，不调模型。
//     注释里「Query Haiku for command prefixes」这句已经过时了 ——
//     代码留在那里，但默认路径不走它。
  let commandSubcommandPrefix: Awaited<
    ReturnType<typeof getCommandSubcommandPrefixFn>
  > = null
  if (getCommandSubcommandPrefixFn !== getCommandSubcommandPrefix) {
    commandSubcommandPrefix = await getCommandSubcommandPrefixFn(
      input.command,
      context.abortController.signal,
      context.options.isNonInteractiveSession,
    )
    if (context.abortController.signal.aborted) {
      throw new AbortError()
    }
  }

  // If there is only one command, no need to process subcommands
// 注：单子命令是最常见的路径（用户 95% 的命令不复合），单独分支的好处是
//     不用建 Map、不用收集建议，直接返回结果。
//
//     注意它传了 `astSubcommands !== null` 作为 astParseSucceeded，
//     这个布尔值在 checkCommandAndSuggestRules 里决定「要不要跑 legacy 注入检查」。
//     一路传下来，来源始终是同一个判断 —— 这就是上面说的「全局可信标记」。
  appState = context.getAppState() // re-compute the latest in case the user hit shift+tab
  if (subcommands.length === 1) {
    const result = await checkCommandAndSuggestRules(
      { command: subcommands[0]! },
      appState.toolPermissionContext,
      commandSubcommandPrefix,
      compoundCommandHasCd,
      astSubcommands !== null,
    )
    // If command wasn't allowed, attach pending classifier check.
    // At this point, 'ask' can only come from bashCommandIsSafe (security check inside
    // checkCommandAndSuggestRules), NOT from explicit ask rules - those were already
    // filtered out at step 13 (askSubresult check). The classifier can bypass security.
    if (result.behavior === 'ask' || result.behavior === 'passthrough') {
      return {
        ...result,
        ...(feature('BASH_CLASSIFIER')
          ? {
              pendingClassifierCheck: buildPendingClassifierCheck(
                input.command,
                appState.toolPermissionContext,
              ),
            }
          : {}),
      }
    }
    return result
  }

  // Check subcommand permission results
// 注：多子命令路径 —— 逐个跑 checkCommandAndSuggestRules，
//     每个都要走一遍「精确匹配 → 前缀匹配 → 注入检查 → 路径校验 → sed → 模式」。
//
//     复杂度值得算一下：N 个子命令 × 每条的规则匹配（M 条规则 × K 个候选形态）。
//     这就是为什么前面要预计算 isCompoundCommand、为什么建议规则要限 5 条 ——
//     这个位置的乘法很容易失控。
  const subcommandResults: Map<string, PermissionResult> = new Map()
  for (const subcommand of subcommands) {
    subcommandResults.set(
      subcommand,
      await checkCommandAndSuggestRules(
        {
          // Pass through input params like `sandbox`
          ...input,
          command: subcommand,
        },
        appState.toolPermissionContext,
        commandSubcommandPrefix?.subcommandPrefixes.get(subcommand),
        compoundCommandHasCd,
        astSubcommands !== null,
      ),
    )
  }

  // Allow if all subcommands are allowed
  // Note that this is different than 6b because we are checking the command injection results.
// 注：注释说「这和 6b 不同，因为我们检查了命令注入结果」——
//     那句 `6b` 是**已经消失的步骤编号**。本函数早期版本给每一步都编了号
//     （现在还能看到 2417 行那句 `step 13`），后来重构把编号删了大半，
//     但遗留了这些交叉引用。读到这里不用去找「6b 在哪」，它已经不在了。
  if (
    subcommands.every(subcommand => {
      const permissionResult = subcommandResults.get(subcommand)
      return permissionResult?.behavior === 'allow'
    })
  ) {
    // Keep subcommandResults as PermissionResult for decisionReason
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'subcommandResults',
        reasons: subcommandResults,
      },
    }
  }

  // Otherwise, ask for permission
// 注：收集建议规则。三个细节值得注意：
//
//     ① 用 `permissionRuleValueToString(rule)` 当 Map 的键来做去重 ——
//        同一个规则由不同子命令建议时只留一条。
//     ② 只收集 'suggestions'，不收 mode 变更等其他 update 类型。
//        注释解释了原因：bash 子命令主要需要规则建议。
//     ③ 下面那个 GH#28784 的补丁（第 2492 行起）解决的是「弹窗只显示 cd 的
//        Read 规则、不提 rm」的问题 —— 逻辑是：安全类 ask 通常不带建议，
//        那就**合成**一条精确规则，让弹窗至少把这条命令显示出来。
  const collectedRules: Map<string, PermissionRuleValue> = new Map()

  for (const [subcommand, permissionResult] of subcommandResults) {
    if (
      permissionResult.behavior === 'ask' ||
      permissionResult.behavior === 'passthrough'
    ) {
      const updates =
        'suggestions' in permissionResult
          ? permissionResult.suggestions
          : undefined

      const rules = extractRules(updates)
      for (const rule of rules) {
        // Use string representation as key for deduplication
        const ruleKey = permissionRuleValueToString(rule)
        collectedRules.set(ruleKey, rule)
      }

      // GH#28784 follow-up: security-check asks (compound-cd+write, process
      // substitution, etc.) carry no suggestions. In a compound command like
      // `cd ~/out && rm -rf x`, that means only cd's Read rule gets collected
      // and the UI labels the prompt "Yes, allow reading from <dir>/" — never
      // mentioning rm. Synthesize a Bash(exact) rule so the UI shows the
      // chained command. Skip explicit ask rules (decisionReason.type 'rule')
      // where the user deliberately wants to review each time.
      if (
// 注：这个补丁的三个条件都必要：
//       behavior === 'ask'                ← passthrough 不需要（它本来就会显示命令）
//       rules.length === 0                ← 已经有建议的不动（避免重复）
//       decisionReason?.type !== 'rule'   ← 显式 ask 规则不加（用户就是想每次都看）
//
//     第三个条件最有意思：它区分了「系统因为不确定而问」和
//     「用户明确要求每次问」。前者需要帮忙把命令显示清楚，
//     后者本来就是用户自己配的规则，再加一条合成规则只会有噪音。
        permissionResult.behavior === 'ask' &&
        rules.length === 0 &&
        permissionResult.decisionReason?.type !== 'rule'
      ) {
        for (const rule of extractRules(
          suggestionForExactCommand(subcommand),
        )) {
          const ruleKey = permissionRuleValueToString(rule)
          collectedRules.set(ruleKey, rule)
        }
      }
      // Note: We only collect rules, not other update types like mode changes
      // This is appropriate for bash subcommands which primarily need rule suggestions
    }
  }

  const decisionReason = {
    type: 'subcommandResults' as const,
    reasons: subcommandResults,
  }

  // GH#11380: Cap at MAX_SUGGESTED_RULES_FOR_COMPOUND. Map preserves insertion
  // order (subcommand order), so slicing keeps the leftmost N.
// 注：GH#11380 的收敛点。`Array.from(collectedRules.values())` 保留了
//     Map 的插入顺序（也就是子命令顺序），所以 slice 留下的是**最左边 N 条**。
//
//     为什么是「最左边」而不是「最重要的 N 条」？因为这里没有重要性排序依据，
//     而「从左到右」至少和用户读命令的顺序一致。这类「无法排序时用自然顺序」
//     的决策，在 UI 相关代码里很常见。
  const cappedRules = Array.from(collectedRules.values()).slice(
    0,
    MAX_SUGGESTED_RULES_FOR_COMPOUND,
  )
  const suggestedUpdates: PermissionUpdate[] | undefined =
    cappedRules.length > 0
      ? [
          {
            type: 'addRules',
            rules: cappedRules,
            behavior: 'allow',
            destination: 'localSettings',
          },
        ]
      : undefined

  // Attach pending classifier check - may auto-approve before user responds.
  // Behavior is 'ask' if any subcommand was 'ask' (e.g., path constraint or ask
  // rule) — before the GH#28784 fix, ask subresults always short-circuited above
  // so this path only saw 'passthrough' subcommands and hardcoded that.
// 注：最终返回值里 `behavior` 是动态决定的：
//       askSubresult !== undefined ? 'ask' : 'passthrough'
//
//     注释解释了为什么需要这个三元：GH#28784 之前，ask 的子结果都会在上面短路返回，
//     所以能走到这里的一定全是 passthrough 子命令，于是这里曾经硬编码 'passthrough'。
//     修复之后 ask 也可能流到这里，所以必须动态判断。
//
//     这个细节说明一件事：**一个函数的返回值语义，会随着上游流程变化而腐化。**
//     注释把这段历史留下来，比只改代码更有价值。
  return {
    behavior: askSubresult !== undefined ? 'ask' : 'passthrough',
    message: createPermissionRequestMessage(BashTool.name, decisionReason),
    decisionReason,
    suggestions: suggestedUpdates,
    ...(feature('BASH_CLASSIFIER')
      ? {
          pendingClassifierCheck: buildPendingClassifierCheck(
            input.command,
            appState.toolPermissionContext,
          ),
        }
      : {}),
  }
}

// ═══ ㉕ 三个归一化器：判断「这条子命令到底是什么」 ═══
//
// 这三个函数（isNormalizedGitCommand / isNormalizedCdCommand / commandHasAnyCd）
// 服务于两个安全门禁：
//     cd + git 组合 → ask（裸仓库 core.fsmonitor RCE）
//     cd + 重定向  → 由路径校验拦截
//
// 共同点：**必须在匹配前做归一化**，否则各种写法都能绕过。
/**
 * Checks if a subcommand is a git command after normalizing away safe wrappers
 * (env vars, timeout, etc.) and shell quotes.
 *
 * SECURITY: Must normalize before matching to prevent bypasses like:
 *   'git' status    — shell quotes hide the command from a naive regex
 *   NO_COLOR=1 git status — env var prefix hides the command
 */
// 译：SECURITY：必须在匹配前归一化，以防这些绕过：
//       'git' status           —— shell 引号让朴素正则看不见命令
//       NO_COLOR=1 git status  —— 环境变量前缀把命令藏起来
//
// 注：`'git' status` 这个例子非常具体：引号里的 git 在字节层面和 git 不同，
//     但 bash 执行时引号被剥掉，跑的确实是 git。
//     朴素正则 `/^git\s/` 看不到，stripSafeWrappers 也不剥引号 ——
//     真正剥引号的是 `tryParseShellCommand`。
//     这就是为什么这个函数要「剥包装器 → 再解析 token」两步走。
export function isNormalizedGitCommand(command: string): boolean {
  // Fast path: catch the most common case before any parsing
// 注：`startsWith('git ')` 这个快路径在安全代码里出现，值得想一下是否安全：
//     它只会**多判**成 git（把 `git foo` 当 git），不会少判 ——
//     而多判的后果是「多问一次」，方向是安全的。
//
//     反之如果快路径写成 `!command.includes('git') return false`，
//     就会漏判（`'git' status` 不含裸的 git 子串？其实含……但换成别的写法就漏了）。
//     快路径的原则：**只能朝「更严格」的方向走捷径。**
  if (command.startsWith('git ') || command === 'git') {
    return true
  }
  const stripped = stripSafeWrappers(command)
  const parsed = tryParseShellCommand(stripped)
  if (parsed.success && parsed.tokens.length > 0) {
    // Direct git command
    if (parsed.tokens[0] === 'git') {
      return true
    }
    // "xargs git ..." — xargs runs git in the current directory,
    // so it must be treated as a git command for cd+git security checks.
    // This matches the xargs prefix handling in filterRulesByContentsMatchingInput.
    if (parsed.tokens[0] === 'xargs' && parsed.tokens.includes('git')) {
// 注：`xargs git ...` 也算 git 命令 —— 因为 xargs 在当前目录执行 git，
//     和 `cd /malicious && git status` 是同一个风险场景。
//     注意条件是 `parsed.tokens.includes('git')`，也就是**任意位置**出现 git 就算，
//     比前缀匹配更宽 —— 这里故意取宽，因为漏判的代价是 RCE。
//
//     这个宽容度在本文件里属于少数派（大多数地方都是宁严勿宽），
//     但方向选对了：安全门禁宁可多问。
      return true
    }
    return false
  }
  return /^git(?:\s|$)/.test(stripped)
}

// 注：这两个函数的注释都强调「必须归一化才能防绕过」，各给了一个具体例子：
//       isNormalizedGitCommand: 'git' status 与 NO_COLOR=1 git status
//       isNormalizedCdCommand:  FORCE_COLOR=1 cd sub
//     两处都用了「mirror / symmetric」这个词 ——
//     因为只要有一个归一化器漏了某类前缀，对应的门禁就能被绕过。
//     这就是「一对函数必须对称」的典型场景。
/**
 * Checks if a subcommand is a cd command after normalizing away safe wrappers
 * (env vars, timeout, etc.) and shell quotes.
 *
 * SECURITY: Must normalize before matching to prevent bypasses like:
 *   FORCE_COLOR=1 cd sub — env var prefix hides the cd from a naive /^cd / regex
 *   This mirrors isNormalizedGitCommand to ensure symmetric normalization.
 *
 * Also matches pushd/popd — they change cwd just like cd, so
 *   pushd /tmp/bare-repo && git status
 * must trigger the same cd+git guard. Mirrors PowerShell's
 * DIRECTORY_CHANGE_ALIASES (src/utils/powershell/parser.ts).
 */
// 注：`pushd` / `popd` 也算改目录 —— 这是很容易漏的一点。
//     注释提到它对齐的是 PowerShell 侧的 DIRECTORY_CHANGE_ALIASES，
//     说明两个 shell 工具的安全门禁要保持同一套语义，否则用户换个工具就能绕过。
//
//     `cd /tmp/bare-repo && git status` 用 pushd 写一遍，风险完全相同。
export function isNormalizedCdCommand(command: string): boolean {
  const stripped = stripSafeWrappers(command)
  const parsed = tryParseShellCommand(stripped)
  if (parsed.success && parsed.tokens.length > 0) {
    const cmd = parsed.tokens[0]
    return cmd === 'cd' || cmd === 'pushd' || cmd === 'popd'
  }
  return /^(?:cd|pushd|popd)(?:\s|$)/.test(stripped)
}

/**
 * Checks if a compound command contains any cd command,
 * using normalized detection that handles env var prefixes and shell quotes.
 */
// 注：这个函数是管道分支那个 bug 的修复工具（第 2044 行）：
//     它从**完整命令**里判断有没有 cd，而不是依赖「当前拆到哪一段」的局部视角。
//
//     实现只有一行，但意义不小：它把「有没有改过目录」这个全局事实，
//     变成了一个可以在任何地方重新计算的纯函数 —— 于是不会再有
//     「某个分支忘了传 compoundCommandHasCd 就传了 false」的问题。
//
//     这是本文件给出的最好的一条工程建议：
//     **能被重新计算的全局事实，就不要靠参数传递。**
export function commandHasAnyCd(command: string): boolean {
  return splitCommand(command).some(subcmd =>
    isNormalizedCdCommand(subcmd.trim()),
  )
}
