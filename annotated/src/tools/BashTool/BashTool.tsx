// ══════════════════════════════════════════════════════════════════════════
//  src/tools/BashTool/BashTool.tsx —— Bash 工具本体（原文 1143 行）
//
//  这是整个项目里最复杂的一个工具，也是"AI 真的能动手"的那双手。
//  全文分五块，按顺序读：
//
//    ① 命令分类表（52-81 行）       —— 五张 Set，决定 UI 怎么显示输出
//    ② 输入/输出 schema（227-296）  —— 模型能填什么、返回什么
//    ③ BashTool 定义（420-825）     —— 工具契约的逐字段实现
//    ④ call() 主流程（624-820）     —— 一次命令调用的完整生命周期
//    ⑤ runShellCommand（826-1143）  —— 异步生成器：进度、超时、后台化
//
//  三个最值得带走的结论：
//
//  1. **stderr 根本不存在**。这个工具把子进程的 stderr 合并进了 stdout
//     （merged fd），所以 `result.stdout` 里混着错误输出，而 schema 里的
//     `stderr` 字段只用来存"shell 被重置"这类自己造的提示。这就是为什么
//     `logEvent` 里 `stderr_length: 0` 是写死的常量（第 758 行）。
//
//  2. **`_simulatedSedEdit` 是唯一被 schema 主动藏起来的字段**（254-259）。
//     它不是"内部字段不方便暴露"，而是**安全边界**：一旦模型能填它，就能
//     拿一条无害命令配一次任意文件写入，同时绕开权限检查和沙箱。
//
//  3. **后台化有三条独立路径**，都通向同一个 `backgroundTaskId`：
//     超时自动后台（967）、assistant 模式 15 秒预算（976）、用户按 Ctrl+B
//     （1090 检测 `status === 'backgrounded'`）。
//     三者的区别只在"谁触发的"，回给模型的话术不同（609-615）。
//
//  读法建议：先读 420-541（工具定义）建立轮廓，再读 624-723（call 主流程），
//  最后读 826 之后的生成器。中间那一大堆 Set 是给 UI 用的，可以快扫。
// ══════════════════════════════════════════════════════════════════════════

import { feature } from 'bun:bundle';
// 译：从 bun 的构建期模块导入 feature —— 构建期死代码消除开关。
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises';
// 注：`link` 是硬链接。第 745 行用它把大输出文件"复制"到 tool-results 目录 ——
//     能不复制就不复制，失败了才退回 copyFile。省一次全量 IO。
import * as React from 'react';
// 注：这个文件后缀是 .tsx 就是为了它 —— 第 1121 行要返回 JSX（<BackgroundHint />）。
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js';
import type { AppState } from 'src/state/AppState.js';
import { z } from 'zod/v4';
import { getKairosActive } from '../../bootstrap/state.js';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../../services/analytics/index.js';
// 注：那个长到离谱的类型名是**类型层面的免责声明** ——
//     `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 意思是
//     "我确认这个值不是代码内容、不是文件路径"，防止把用户代码传给埋点。
//     所有要进 logEvent 的字符串都得先 cast 成这个类型。
import { notifyVscodeFileUpdated } from '../../services/mcp/vscodeSdkMcp.js';
import type { SetToolJSXFn, ToolCallProgress, ToolUseContext, ValidationResult } from '../../Tool.js';
import { buildTool, type ToolDef } from '../../Tool.js';
// 注：BashTool 用了 buildTool（不是手写 `satisfies Tool`），所以能吃到
//     TOOL_DEFAULTS 的默认值 —— 但第 825 行又写了 `satisfies ToolDef<...>`，
//     两者叠加是为了让 InputSchema/Out/BashProgress 三个泛型精确落到类型上。
import { backgroundExistingForegroundTask, markTaskNotified, registerForeground, spawnShellTask, unregisterForeground } from '../../tasks/LocalShellTask/LocalShellTask.js';
// 注：这五个函数是"前台任务 ⇄ 后台任务"的状态机操作，第 904-963、1068-1118 行用到。
import type { AgentId } from '../../types/ids.js';
import type { AssistantMessage } from '../../types/message.js';
// 注：`types/message.js` 就是 docs/02 里说的「8 个缺失纯类型模块」之一 ——
//     它不存在于源码里，但因为是 `import type`，运行时不报错。
import { parseForSecurity } from '../../utils/bash/ast.js';
import { splitCommand_DEPRECATED, splitCommandWithOperators } from '../../utils/bash/commands.js';
// 注：同目录下有两个拆分函数，别混：
//     splitCommandWithOperators —— 保留 `&&` `||` `|` `>` 这些操作符（UI 分类用）
//     splitCommand_DEPRECATED   —— 只返回各段命令（日志打点用）
//     后者名字里的 DEPRECATED 是真的在劝退，但本文件还在用它做两件轻量的事。
import { extractClaudeCodeHints } from '../../utils/claudeCodeHints.js';
import { detectCodeIndexingFromCommand } from '../../utils/codeIndexing.js';
import { isEnvTruthy } from '../../utils/envUtils.js';
import { isENOENT, ShellError } from '../../utils/errors.js';
import { detectFileEncoding, detectLineEndings, getFileModificationTime, writeTextContent } from '../../utils/file.js';
import { fileHistoryEnabled, fileHistoryTrackEdit } from '../../utils/fileHistory.js';
import { truncate } from '../../utils/format.js';
import { getFsImplementation } from '../../utils/fsOperations.js';
import { lazySchema } from '../../utils/lazySchema.js';
// 注：lazySchema 是"schema 延迟构造"——模块加载时不建 zod 对象，第一次用才建。
//     启动性能优化：51 个工具各带几个 schema，全在 import 时构造会拖慢冷启动。
import { expandPath } from '../../utils/path.js';
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js';
import { maybeRecordPluginHint } from '../../utils/plugins/hintRecommendation.js';
import { exec } from '../../utils/Shell.js';
import type { ExecResult } from '../../utils/ShellCommand.js';
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js';
import { semanticBoolean } from '../../utils/semanticBoolean.js';
import { semanticNumber } from '../../utils/semanticNumber.js';
// 注：semanticNumber / semanticBoolean 是"宽容解析"包装 ——
//     模型经常把布尔值写成字符串 "true"，把数字写成 "30000"。
//     直接用 z.number() 会校验失败，包一层能自动纠正。
import { EndTruncatingAccumulator } from '../../utils/stringUtils.js';
// 注：**只保留结尾**的累加器。命令输出可能上百 MB，但模型只需要看最后一段
//     （报错通常在末尾）。所以从头丢，不是从尾截。
import { getTaskOutputPath } from '../../utils/task/diskOutput.js';
import { TaskOutput } from '../../utils/task/TaskOutput.js';
import { isOutputLineTruncated } from '../../utils/terminal.js';
import { buildLargeToolResultMessage, ensureToolResultsDir, generatePreview, getToolResultPath, PREVIEW_SIZE_BYTES } from '../../utils/toolResultStorage.js';
import { userFacingName as fileEditUserFacingName } from '../FileEditTool/UI.js';
// 注：借别家工具的显示名 —— 第 492 行把 `sed -i` 命令渲染成"文件编辑"的样子。
import { trackGitOperations } from '../shared/gitOperationTracking.js';
import { bashToolHasPermission, commandHasAnyCd, matchWildcardPattern, permissionRuleExtractPrefix } from './bashPermissions.js';
// 注：真正的权限判定在 bashPermissions.ts（2621 行，单独一批再讲）。
//     本文件只在第 540 行把 checkPermissions 转发过去。
import { interpretCommandResult } from './commandSemantics.js';
// 注：就是第 2 步批注过的那个 141 行文件 —— 退出码语义表。
import { getDefaultTimeoutMs, getMaxTimeoutMs, getSimplePrompt } from './prompt.js';
import { checkReadOnlyConstraints } from './readOnlyValidation.js';
import { parseSedEditCommand } from './sedEditParser.js';
import { shouldUseSandbox } from './shouldUseSandbox.js';
import { BASH_TOOL_NAME } from './toolName.js';
import { BackgroundHint, renderToolResultMessage, renderToolUseErrorMessage, renderToolUseMessage, renderToolUseProgressMessage, renderToolUseQueuedMessage } from './UI.js';
import { buildImageToolResult, isImageOutput, resetCwdIfOutsideProject, resizeShellImageOutput, stdErrAppendShellResetMessage, stripEmptyLines } from './utils.js';
// 注：以上两组（./UI.js、./utils.js）是这个工具的表现层，逻辑都在本文件里。
const EOL = '\n';

// ── ① 五张命令分类表：为了让 UI 少刷几行屏 ──
// 注：这些表**不参与权限判定、不参与安全判断**，只决定"结果在终端里怎么折叠显示"。
//     把它们和安全相关的表（bashSecurity.ts 里那几张）分清，是读这个文件的第一关。

// Progress display constants
// 译：进度显示常量。
const PROGRESS_THRESHOLD_MS = 2000; // Show progress after 2 seconds
// 译：超过 2 秒才显示进度。
// 注：2 秒是个经验值 —— 低于它的命令用户感觉不到等待，给进度条反而闪一下更烦。
// In assistant mode, blocking bash auto-backgrounds after this many ms in the main agent
// 译：在 assistant 模式下，主 agent 里的阻塞式 bash 会在这么多毫秒后自动转后台。
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;

// Search commands for collapsible display (grep, find, etc.)
// 译：搜索类命令（用于折叠显示）。
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis']);

// Read/view commands for collapsible display (cat, head, etc.)
// 译：读取/查看类命令（用于折叠显示）。
const BASH_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more',
// Analysis commands
// 译：分析类命令。
'wc', 'stat', 'file', 'strings',
// Data processing — commonly used to parse/transform file content in pipes
// 译：数据处理 —— 常出现在管道里解析/转换文件内容。
'jq', 'awk', 'cut', 'sort', 'uniq', 'tr']);
// 注：注意 Set 的括号是跨行写的，中间夹着注释 —— 原文如此。
//     这批命令的共同点：**只读、输出可折叠**。UI 会把它们的结果收成一行
//     "Read 3 files"，而不是刷满屏。

// Directory-listing commands for collapsible display (ls, tree, du).
// 译：列目录类命令（用于折叠显示）。
// Split from BASH_READ_COMMANDS so the summary says "Listed N directories"
// instead of the misleading "Read N files".
// 译：从 BASH_READ_COMMANDS 里拆出来，是为了让摘要说"列出了 N 个目录"，
//     而不是容易误解的"读取了 N 个文件"。
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du']);

// Commands that are semantic-neutral in any position — pure output/status commands
// that don't change the read/search nature of the overall pipeline.
// 译：在任何位置都语义中性的命令 —— 纯输出/状态类，不改变整条管道的读/搜性质。
// e.g. `ls dir && echo "---" && ls dir2` is still a read-only compound command.
// 译：例如 `ls dir && echo "---" && ls dir2` 仍然算只读复合命令。
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set(['echo', 'printf', 'true', 'false', ':' // bash no-op
]);
// 注：`:` 是 bash 的内建空操作（等同于 true），写成 `:` 加注释是原文的写法。

// Commands that typically produce no stdout on success
// 译：成功时通常不产生 stdout 的命令。
const BASH_SILENT_COMMANDS = new Set(['mv', 'cp', 'rm', 'mkdir', 'rmdir', 'chmod', 'chown', 'chgrp', 'touch', 'ln', 'cd', 'export', 'unset', 'wait']);
// 注：注意这批全是**写操作**。它们成功时没输出，所以 UI 显示 "Done" 而不是
//     "(No output)" —— 后者看起来像失败。

/**
 * Checks if a bash command is a search or read operation.
 * Used to determine if the command should be collapsed in the UI.
 * Returns an object indicating whether it's a search or read operation.
 *
 * For pipelines (e.g., `cat file | bq`), ALL parts must be search/read commands
 * for the whole command to be considered collapsible.
 *
 * Semantic-neutral commands (echo, printf, true, false, :) are skipped in any
 * position, as they're pure output/status commands that don't affect the read/search
 * nature of the pipeline (e.g. `ls dir && echo "---" && ls dir2` is still a read).
 */
// 译：判断一条 bash 命令是不是搜索/读取操作。用来决定 UI 里该不该折叠。
//     返回一个对象，标明它属于搜索、读取还是列表。
//     对管道（如 `cat file | bq`），**所有**分段都必须是搜索/读命令，整体才算可折叠。
//     语义中性命令（echo、printf、true、false、:）在任何位置都被跳过，
//     因为它们是纯输出/状态命令，不影响整条管道的读/搜性质
//     （例如 `ls dir && echo "---" && ls dir2` 仍然是读操作）。
// 注：**"全部满足"而不是"任一满足"** 是关键 —— 一条 `cat f | rm -rf x` 不该被折叠。
export function isSearchOrReadBashCommand(command: string): {
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
} {
  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(command);
  } catch {
    // If we can't parse the command due to malformed syntax,
    // it's not a search/read command
    // 译：如果因为语法畸形拆不开，就当它不是搜索/读命令。
    // 注：**失败时返回"不折叠"**，也就是保守方向 —— 解析不了就把完整输出给用户看。
    return {
      isSearch: false,
      isRead: false,
      isList: false
    };
  }
  if (partsWithOperators.length === 0) {
    return {
      isSearch: false,
      isRead: false,
      isList: false
    };
  }
  let hasSearch = false;
  let hasRead = false;
  let hasList = false;
  let hasNonNeutralCommand = false;
  let skipNextAsRedirectTarget = false;
  // 注：这个标志位是为重定向准备的 —— 见到 `>` 就跳过下一个 token，
  //     否则 `ls > out.txt` 会把 out.txt 当成一条命令去查表，查不到 → 判定失败。
  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false;
      continue;
    }
    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true;
      continue;
    }
    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      continue;
    }
    const baseCommand = part.trim().split(/\s+/)[0];
    // 注：只取第一个 token 当命令名。`grep -rn "x" .` → `grep`。
    if (!baseCommand) {
      continue;
    }
    if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }
    hasNonNeutralCommand = true;
    const isPartSearch = BASH_SEARCH_COMMANDS.has(baseCommand);
    const isPartRead = BASH_READ_COMMANDS.has(baseCommand);
    const isPartList = BASH_LIST_COMMANDS.has(baseCommand);
    if (!isPartSearch && !isPartRead && !isPartList) {
      // 注：只要有一段不属于三类之一，整体立刻判否 —— 这就是注释说的"全部满足"。
      return {
        isSearch: false,
        isRead: false,
        isList: false
      };
    }
    if (isPartSearch) hasSearch = true;
    if (isPartRead) hasRead = true;
    if (isPartList) hasList = true;
  }

  // Only neutral commands (e.g., just "echo foo") -- not collapsible
  // 译：只有中性命令（例如光一个 "echo foo"）—— 不可折叠。
  // 注：这条是防止 `echo hello` 被当成"读操作"折叠掉。它确实没读任何文件。
  if (!hasNonNeutralCommand) {
    return {
      isSearch: false,
      isRead: false,
      isList: false
    };
  }
  return {
    isSearch: hasSearch,
    isRead: hasRead,
    isList: hasList
  };
}
// 注：三个布尔可以同时为真 —— `ls dir | grep x` 既是 list 又是 search。
//     UI 会挑一个措辞显示，不是互斥枚举。

// ── ② 静默命令判定 + schema + sed 预览写入 ──

/**
 * Checks if a bash command is expected to produce no stdout on success.
 * Used to show "Done" instead of "(No output)" in the UI.
 */
// 译：判断一条 bash 命令成功时是否本来就不产生 stdout。
//     用来在 UI 里显示 "Done" 而不是 "(No output)"。
// 注：和上面那个函数长得几乎一样，但判据不同：
//     上面问"是不是读/搜"（决定折叠），这里问"是不是静默"（决定文案）。
function isSilentBashCommand(command: string): boolean {
  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(command);
  } catch {
    return false;
  }
  if (partsWithOperators.length === 0) {
    return false;
  }
  let hasNonFallbackCommand = false;
  let lastOperator: string | null = null;
  // 注：这里比上一个函数多记了 `lastOperator` —— 因为 `cmd || echo "fallback"` 里的
  //     echo 是**兜底输出**，它的存在不说明原命令会输出。所以要能区分 `||` 之后的 echo。
  let skipNextAsRedirectTarget = false;
  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false;
      continue;
    }
    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true;
      continue;
    }
    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      lastOperator = part;
      continue;
    }
    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }
    if (lastOperator === '||' && BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      // 译：`||` 之后的中性命令（典型是 `|| echo "failed"`）不算真正的输出。
      continue;
    }
    hasNonFallbackCommand = true;
    if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
      // 注：只要有一段不在静默表里，整体就不是静默 —— 又是"全部满足"。
      return false;
    }
  }
  return hasNonFallbackCommand;
  // 注：返回的是"至少有一条非兜底命令，且它们全都是静默命令"。
  //     空命令或纯 `|| echo` 都返回 false（不静默），因为确实没有可显示的动作。
}

// Commands that should not be auto-backgrounded
// 译：不应被自动转后台的命令。
const DISALLOWED_AUTO_BACKGROUND_COMMANDS = ['sleep' // Sleep should run in foreground unless explicitly backgrounded by user
];
// 译：sleep 应该在前台跑，除非用户明确让它后台。
// 注：理由很实在 —— 自动后台化是为了"别让长命令卡住对话"，
//     而 sleep 本来就是**故意**在等，转后台只会让用户看不到它在等什么。

// Check if background tasks are disabled at module load time
// 译：在模块加载时就检查后台任务是否被禁用。
const isBackgroundTasksDisabled =
// eslint-disable-next-line custom-rules/no-process-env-top-level -- Intentional: schema must be defined at module load
// 译：故意在模块顶层读环境变量 —— 因为 schema 必须在模块加载时就定下来。
// 注：这条 eslint-disable 配了一行理由，是很标准的写法：**每次屏蔽规则都要写明为什么**。
//     这里的原因下面第 254 行会看到：schema 要按这个开关决定藏不藏 run_in_background。
isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS);
const fullInputSchema = lazySchema(() => z.strictObject({
  // 注：`z.strictObject` 而不是 `z.object` —— 多传字段会直接报错，
  //     不允许多余属性混进来。这是所有工具 schema 的统一风格。
  command: z.string().describe('The command to execute'),
  // 译：要执行的命令。
  timeout: semanticNumber(z.number().optional()).describe(`Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`),
  // 译：可选超时（毫秒，上限由 getMaxTimeoutMs() 决定）。
  description: z.string().optional().describe(`Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.

For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"`),
  // 译：一句话描述这条命令干什么，用主动语态。描述里绝不能出现 "complex"、"risk"
  //     这种主观词 —— 只描述它做什么。
  //     简单命令保持简短（5-10 词）；难一眼看懂的（管道、冷门参数）要多给上下文。
  // 注：**这段 prompt 本身就是设计产物**，有三个讲究：
  //     1) 示例给的是"命令 → 描述"的成对样本，比抽象要求有效得多；
  //     2) 禁止 "complex"/"risk" 是为了**防止模型用主观词替代事实** ——
  //        写"这是一个危险的删除操作"没有信息量，写"递归删除所有 .tmp 文件"才有；
  //     3) 长度要求按命令复杂度分档，而不是一刀切。
  run_in_background: semanticBoolean(z.boolean().optional()).describe(`Set to true to run this command in the background. Use Read to read the output later.`),
  // 译：设为 true 则后台运行；之后用 Read 工具读输出。
  dangerouslyDisableSandbox: semanticBoolean(z.boolean().optional()).describe('Set this to true to dangerously override sandbox mode and run commands without sandboxing.'),
  // 译：设为 true 则危险地绕过沙箱模式，不沙箱执行。
  // 注：字段名里带 `dangerously` 前缀是刻意的 —— 这个前缀会出现在模型的
  //     schema 描述里，起到"每次看到都要多想一下"的作用。
  _simulatedSedEdit: z.object({
    filePath: z.string(),
    newContent: z.string()
  }).optional().describe('Internal: pre-computed sed edit result from preview')
  // 译：内部字段：从预览里预先算好的 sed 编辑结果。
  // 注：**这个字段马上就会被 omit 掉**（第 254 行），这里定义它只是为了
  //     让 `fullInputSchema` 的类型完整（代码要能处理它）。
}));

// Always omit _simulatedSedEdit from the model-facing schema. It is an internal-only
// field set by SedEditPermissionRequest after the user approves a sed edit preview.
// Exposing it in the schema would let the model bypass permission checks and the
// sandbox by pairing an innocuous command with an arbitrary file write.
// Also conditionally remove run_in_background when background tasks are disabled.
// 译：**永远**把 _simulatedSedEdit 从给模型看的 schema 里去掉。它是内部字段，
//     由 SedEditPermissionRequest 在用户批准 sed 预览之后设置。
//     如果暴露在 schema 里，模型就能"用一条无害命令配一次任意文件写入"，
//     从而同时绕过权限检查和沙箱。
//     另外，后台任务被禁用时，连 run_in_background 也一并去掉。
// 注：**这是全文件最重要的一处安全设计**，值得逐字读三遍。
//     思路是：模型和代码共用同一个 TypeScript 类型，但**不共用同一个 schema**。
//     `fullInputSchema` 给代码用（含全部字段），`inputSchema` 给模型用（砍掉危险字段）。
//     如果只有一份 schema，那么"内部字段"就一定会暴露给模型。
const inputSchema = lazySchema(() => isBackgroundTasksDisabled ? fullInputSchema().omit({
  run_in_background: true,
  _simulatedSedEdit: true
}) : fullInputSchema().omit({
  _simulatedSedEdit: true
}));
type InputSchema = ReturnType<typeof inputSchema>;

// Use fullInputSchema for the type to always include run_in_background
// (even when it's omitted from the schema, the code needs to handle it)
// 译：类型层面用 fullInputSchema，这样 run_in_background 始终存在于类型里 ——
//     即使它被从 schema 里 omit 了，代码仍然要能处理这个字段。
// 注：这就是"运行时 schema"和"编译期类型"分离的典型手法：
//     模型看到的字段 ⊆ 代码处理的字段。
export type BashToolInput = z.infer<ReturnType<typeof fullInputSchema>>;
const COMMON_BACKGROUND_COMMANDS = ['npm', 'yarn', 'pnpm', 'node', 'python', 'python3', 'go', 'cargo', 'make', 'docker', 'terraform', 'webpack', 'vite', 'jest', 'pytest', 'curl', 'wget', 'build', 'test', 'serve', 'watch', 'dev'] as const;
// 注：这张表**只用于埋点**（区分"后台跑的是 npm 还是 pytest"），不参与任何判定。
//     `as const` 让它变成字面量元组类型，下面 includes 才能做精确类型检查。
function getCommandTypeForLogging(command: string): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;

  // Check each part of the command to see if any match common background commands
  // 译：逐段检查，看有没有命中常见后台命令。
  for (const part of parts) {
    const baseCommand = part.split(' ')[0] || '';
    if (COMMON_BACKGROUND_COMMANDS.includes(baseCommand as (typeof COMMON_BACKGROUND_COMMANDS)[number])) {
      return baseCommand as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
    }
  }
  return 'other' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
  // 注：只返回**命令名**（如 'npm'），不返回整条命令 —— 这就是那个长类型名的意义：
  //     向埋点系统承诺"我没传用户代码"。`npm run deploy-my-secret-thing` 不会外泄。
}
const outputSchema = lazySchema(() => z.object({
  // 注：注意这里是 `z.object` 不是 strictObject —— 输出方向宽松，
  //     因为结果对象由自己构造，不需要防外部多传。
  stdout: z.string().describe('The standard output of the command'),
  stderr: z.string().describe('The standard error output of the command'),
  // 注：**这个描述是有误导性的**。实际 stderr 已被合并进 stdout（见第 687 行），
  //     这个字段在绝大多数情况下是空串，只在 "shell 被重置" 时才装内容。
  //     模型看到的 schema 描述和实际语义不一致 —— 属于历史遗留。
  rawOutputPath: z.string().optional().describe('Path to raw output file for large MCP tool outputs'),
  interrupted: z.boolean().describe('Whether the command was interrupted'),
  isImage: z.boolean().optional().describe('Flag to indicate if stdout contains image data'),
  backgroundTaskId: z.string().optional().describe('ID of the background task if command is running in background'),
  backgroundedByUser: z.boolean().optional().describe('True if the user manually backgrounded the command with Ctrl+B'),
  assistantAutoBackgrounded: z.boolean().optional().describe('True if assistant-mode auto-backgrounded a long-running blocking command'),
  dangerouslyDisableSandbox: z.boolean().optional().describe('Flag to indicate if sandbox mode was overridden'),
  returnCodeInterpretation: z.string().optional().describe('Semantic interpretation for non-error exit codes with special meaning'),
  // 注：这个字段来自 commandSemantics.ts 的 `message`。**但 Bash 侧从不使用它**
  //     （第 2 步批注过：BashTool 只读 isError，提示语只在 PowerShellTool 里出现）。
  //     它依然被塞进了输出对象、也写进了 schema 描述，模型能看到 ——
  //     算是给 PowerShell 那边留的通道。
  noOutputExpected: z.boolean().optional().describe('Whether the command is expected to produce no output on success'),
  structuredContent: z.array(z.any()).optional().describe('Structured content blocks'),
  persistedOutputPath: z.string().optional().describe('Path to the persisted full output in tool-results dir (set when output is too large for inline)'),
  persistedOutputSize: z.number().optional().describe('Total size of the output in bytes (set when output is too large for inline)')
}));
type OutputSchema = ReturnType<typeof outputSchema>;
export type Out = z.infer<OutputSchema>;

// Re-export BashProgress from centralized types to break import cycles
// 译：从集中管理的类型里再导出 BashProgress，以打破循环导入。
export type { BashProgress } from '../../types/tools.js';
// 注：`types/tools.js` 也在「8 个缺失纯类型模块」名单里 —— 不存在，但 import type 不报错。
import type { BashProgress } from '../../types/tools.js';

/**
 * Checks if a command is allowed to be automatically backgrounded
 * @param command The command to check
 * @returns false for commands that should not be auto-backgrounded (like sleep)
 */
// 译：判断一条命令是否允许被**自动**转后台。
//     返回 false 表示不该自动转（如 sleep）。
// 注：注意"自动"两个字 —— 用户显式要求（run_in_background: true）时不受此限，
//     第 987 行有专门注释说明这一点。
function isAutobackgroundingAllowed(command: string): boolean {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return true;

  // Get the first part which should be the base command
  // 译：取第一段，应该是基础命令。
  const baseCommand = parts[0]?.trim();
  if (!baseCommand) return true;
  return !DISALLOWED_AUTO_BACKGROUND_COMMANDS.includes(baseCommand);
  // 注：**只检查第一段**。所以 `sleep 5 && npm start` 会被拦（第一段是 sleep），
  //     而 `npm start && sleep 5` 不会 —— 后者整体确实是长任务，合理。
}

/**
 * Detect standalone or leading `sleep N` patterns that should use Monitor
 * instead. Catches `sleep 5`, `sleep 5 && check`, `sleep 5; check` — but
 * not sleep inside pipelines, subshells, or scripts (those are fine).
 */
// 译：检测"单独出现"或"出现在开头"的 `sleep N` 模式，这类应该改用 Monitor。
//     能抓到 `sleep 5`、`sleep 5 && check`、`sleep 5; check`，
//     但不抓管道、子 shell、脚本内部的 sleep（那些是合理的）。
export function detectBlockedSleepPattern(command: string): string | null {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return null;
  const first = parts[0]?.trim() ?? '';
  // Bare `sleep N` or `sleep N.N` as the first subcommand.
  // Float durations (sleep 0.5) are allowed — those are legit pacing, not polls.
  // 译：开头直接就是 `sleep N`（N 为整数）。浮点时长（sleep 0.5）放行 ——
  //     那是正当的节奏控制，不是轮询。
  const m = /^sleep\s+(\d+)\s*$/.exec(first);
  if (!m) return null;
  const secs = parseInt(m[1]!, 10);
  if (secs < 2) return null; // sub-2s sleeps are fine (rate limiting, pacing)
  // 译：2 秒以下的 sleep 没问题（限流、节奏控制）。

  // `sleep N` alone → "what are you waiting for?"
  // `sleep N && check` → "use Monitor { command: check }"
  // 译：光一个 `sleep N` → "你在等什么？"
  //     `sleep N && check` → "改用 Monitor { command: check }"
  // 注：返回值是**给人看的一句话**，第 526-532 行把它拼进报错信息。
  const rest = parts.slice(1).join(' ').trim();
  return rest ? `sleep ${secs} followed by: ${rest}` : `standalone sleep ${secs}`;
}

/**
 * Checks if a command contains tools that shouldn't run in sandbox
 * This includes:
 * - Dynamic config-based disabled commands and substrings (tengu_sandbox_disabled_commands)
 * - User-configured commands from settings.json (sandbox.excludedCommands)
 *
 * User-configured commands support the same pattern syntax as permission rules:
 * - Exact matches: "npm run lint"
 * - Prefix patterns: "npm run test:*"
 */
// 译：检查命令里是否含有不该在沙箱里跑的工具。包括：
//     - 动态配置里禁用的命令与子串（tengu_sandbox_disabled_commands）
//     - 用户在 settings.json 里配置的 sandbox.excludedCommands
//     用户配置的命令支持与权限规则相同的模式语法：
//     - 精确匹配："npm run lint"
//     - 前缀模式："npm run test:*"
// 注：**这段注释下面并没有函数** —— 紧接着就是两个 type 定义。
//     实现其实在 `shouldUseSandbox.ts`（153 行）里。注释留在这儿是历史原因，
//     属于"文档与代码位置脱节"的例子。读到这里别以为漏了代码。

type SimulatedSedEditResult = {
  data: Out;
};
type SimulatedSedEditContext = Pick<ToolUseContext, 'readFileState' | 'updateFileHistoryState'>;
// 注：`Pick` 而不是整个 ToolUseContext —— 这个函数只需要两样东西：
//     读过文件的记录（用于让后续写入失效）、文件历史（用于撤销）。最小依赖原则。

/**
 * Applies a simulated sed edit directly instead of running sed.
 * This is used by the permission dialog to ensure what the user previews
 * is exactly what gets written to the file.
 */
// 译：直接应用"模拟的 sed 编辑"，而不是真的跑 sed。
//     权限对话框用它来保证：用户在预览里看到的内容，与实际写进文件的内容完全一致。
// 注：**为什么需要这个**：`sed -i` 的含义依赖具体 sed 实现的细节（GNU/BSD 差异、
//     正则方言、编码）。如果先给用户看"我推测的改动"、再真的执行 sed，
//     两者可能有细微出入 —— 用户批准的和实际发生的不是一回事。
//     所以 Claude Code 干脆**自己算**改动内容，用户批准后直接写文件，不执行 sed。
//     这是"预览即事实"(what you preview is what you get) 的典型实现。
async function applySedEdit(simulatedEdit: {
  filePath: string;
  newContent: string;
}, toolUseContext: SimulatedSedEditContext, parentMessage?: AssistantMessage): Promise<SimulatedSedEditResult> {
  const {
    filePath,
    newContent
  } = simulatedEdit;
  const absoluteFilePath = expandPath(filePath);
  const fs = getFsImplementation();

  // Read original content for VS Code notification
  // 译：读原内容，供 VS Code 通知使用。
  // 注：这一步纯粹是为了 IDE 联动（第 401 行 notifyVscodeFileUpdated 需要 old/new 对比）。
  const encoding = detectFileEncoding(absoluteFilePath);
  let originalContent: string;
  try {
    originalContent = await fs.readFile(absoluteFilePath, {
      encoding
    });
  } catch (e) {
    if (isENOENT(e)) {
      // 注：**文件不存在时伪造一份 sed 的报错**。这样模型看到的输出和真的跑 sed
      //     一模一样（`sed: xxx: No such file or directory` + 退出码 1），
      //     不用为"模拟路径"单独设计一套错误话术。
      return {
        data: {
          stdout: '',
          stderr: `sed: ${filePath}: No such file or directory\nExit code 1`,
          interrupted: false
        }
      };
    }
    throw e;
  }

  // Track file history before making changes (for undo support)
  // 译：改动之前记录文件历史（支持撤销）。
  if (fileHistoryEnabled() && parentMessage) {
    await fileHistoryTrackEdit(toolUseContext.updateFileHistoryState, absoluteFilePath, parentMessage.uuid);
  }

  // Detect line endings and write new content
  // 译：检测行尾风格，写入新内容。
  // 注：**保留原有行尾**（CRLF/LF）—— 在 Windows 仓库里编辑文件时不制造满屏 diff。
  const endings = detectLineEndings(absoluteFilePath);
  writeTextContent(absoluteFilePath, newContent, encoding, endings);

  // Notify VS Code about the file change
  // 译：把文件变更通知 VS Code。
  notifyVscodeFileUpdated(absoluteFilePath, originalContent, newContent);

  // Update read timestamp to invalidate stale writes
  // 译：更新读取时间戳，使过期的写入失效。
  // 注：这是 FileEditTool 也用的机制 —— 如果模型"读完之后文件被改了"，
  //     再基于旧内容写入会被拒。这里把状态设成新内容，等于"我刚读过"。
  toolUseContext.readFileState.set(absoluteFilePath, {
    content: newContent,
    timestamp: getFileModificationTime(absoluteFilePath),
    offset: undefined,
    limit: undefined
  });

  // Return success result matching sed output format (sed produces no output on success)
  // 译：返回与 sed 输出格式一致的成功结果（sed 成功时不产生输出）。
  return {
    data: {
      stdout: '',
      stderr: '',
      interrupted: false
    }
  };
}

// ── ③ BashTool 定义：Tool 契约的逐字段实现 ──
// 注：从这里到第 825 行是 `buildTool({...})` 的一个大对象字面量。
//     Tool.ts 里那些"可选方法"，在这个工具里几乎全都实现了 ——
//     因为它是唯一一个"执行任意用户指定程序"的工具，每个钩子都得用上。

export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  // 注：`BASH_TOOL_NAME` 来自 `toolName.ts`（全文只有 2 行：`export const BASH_TOOL_NAME = 'Bash'`）。
  //     单独抽一个文件是为了避免循环依赖 —— 权限模块要判断"是不是 Bash 工具"，
  //     但又不能 import BashTool 本体（那会把整个工具模块拖进来）。
  searchHint: 'execute shell commands',
  // 注：`searchHint` 是 Tool.ts 里的字段，给 ToolSearch 用 ——
  //     工具太多时模型先搜工具，这句话是搜索索引的一部分。
  // 30K chars - tool result persistence threshold
  // 译：30K 字符 —— 工具结果持久化的阈值。
  maxResultSizeChars: 30_000,
  // 注：超过 30,000 字符的结果**不直接塞进对话**，而是落盘到 tool-results 目录，
  //     只回给模型一段预览 + 文件路径。这就是 Tool.ts 里那个
  //     "为什么用 Infinity 而不是 1e9" 的实践场景 —— 一个 `cat` 大文件就能触发。
  strict: true,
  // 注：strict 让发给模型的 JSON Schema 带上 `additionalProperties: false`
  //     （见 Tool.ts 第 531 行的解释）。Bash 工具开启它是必要的：
  //     多出来的字段有可能是模型"试探" schema 的痕迹。
  async description({
    description
  }) {
    // 注：注意参数是**解构后的 input**，不是整个 input 对象。
    //     Tool.ts 里 description 的签名是 `(input, options)`，这里只取了 input.description。
    return description || 'Run shell command';
    // 译：返回模型给的描述，没有就回退到 "Run shell command"。
    // 注：这个函数**只给人看**（权限对话框、MCP 详情页），模型看不到。
  },
  async prompt() {
    return getSimplePrompt();
    // 注：`getSimplePrompt()` 来自 `./prompt.js`（369 行）。真正的系统提示词在那儿。
    //     async 但没有 await —— 因为 Tool 接口要求返回 Promise（其他工具要异步读文件）。
  },
  isConcurrencySafe(input) {
    return this.isReadOnly?.(input) ?? false;
    // 译：只读就算并发安全，否则不算。
    // 注：**一行实现，但是全文件最关键的并发决策**。
    //     `?? false` 是 fail-closed：如果 isReadOnly 没实现，就当不安全。
    //     对比 Tool.ts 的 TOOL_DEFAULTS 里 `isConcurrencySafe: () => false` —— 一致。
    //     为什么这样定：两条只读命令并行没有副作用；但只要有一条可能写文件，
    //     并行就可能产生"读了旧内容 → 基于旧内容写"的竞态。
  },
  isReadOnly(input) {
    const compoundCommandHasCd = commandHasAnyCd(input.command);
    // 注：先单独判断"复合命令里有没有 cd"。这个信息要传给下面的校验函数 ——
    //     因为 `cd /tmp && ls` 的语义取决于 cd 之后的目录，不能脱离上下文判断。
    const result = checkReadOnlyConstraints(input, compoundCommandHasCd);
    return result.behavior === 'allow';
    // 注：`checkReadOnlyConstraints` 在 `readOnlyValidation.ts`（1990 行）里，
    //     返回的是三态结果而不是布尔 —— 这里只取"明确 allow"。
    //     'ask' 和 'deny' 都不算只读 → 不并发安全。又是 fail-closed。
  },
  toAutoClassifierInput(input) {
    return input.command;
    // 译：交给安全分类器的输入就是命令本身。
    // 注：对比 Tool.ts 里那个 `''`（跳过分类器）的默认值 ——
    //     Bash 工具**显式实现**了它，所以它的命令一定会过分类器。
    //     这也说明那条 fail-open 默认值主要影响的是"忘写这个方法"的工具。
  },
  async preparePermissionMatcher({
    command
  }) {
    // Hook `if` filtering is "no match → skip hook" (deny-like semantics), so
    // compound commands must fire the hook if ANY subcommand matches. Without
    // splitting, `ls && git push` would bypass a `Bash(git *)` security hook.
    // 译：Hook 的 `if` 过滤是"不匹配就跳过 hook"（类似 deny 的语义），
    //     所以复合命令里**只要有任一子命令匹配**，就必须触发 hook。
    //     如果不拆开，`ls && git push` 就能绕过 `Bash(git *)` 这样的安全 hook。
    // 注：**这是 hook 机制上的一个真实漏洞点**，作者在注释里写得很清楚。
    //     思路：把命令拆成子命令，逐个去匹配 hook 的模式，命中一个就返回 true。
    const parsed = await parseForSecurity(command);
    if (parsed.kind !== 'simple') {
      // parse-unavailable / too-complex: fail safe by running the hook.
      // 译：解析不了 / 太复杂 —— 安全起见，让它触发 hook。
      // 注：`() => true` 意思是"任何模式都匹配"→ hook 一定会跑。
      //     又是 fail-closed：看不懂的命令，宁可多跑一次 hook。
      return () => true;
    }
    // Match on argv (strips leading VAR=val) so `FOO=bar git push` still
    // matches `Bash(git *)`.
    // 译：用 argv 匹配（会剥掉开头的 `VAR=val`），这样 `FOO=bar git push`
    //     仍然能匹配 `Bash(git *)`。
    // 注：环境变量前缀是最常见的绕过手法之一（`X=1 rm -rf /`）。
    //     用 AST 解析出的 argv 而不是字符串切分，就是为了处理这种情况。
    const subcommands = parsed.commands.map(c => c.argv.join(' '));
    return pattern => {
      const prefix = permissionRuleExtractPrefix(pattern);
      // 注：`Bash(git *)` 会被抽出前缀 `git`。
      return subcommands.some(cmd => {
        if (prefix !== null) {
          return cmd === prefix || cmd.startsWith(`${prefix} `);
        }
        return matchWildcardPattern(pattern, cmd);
      });
      // 注：`some` 而不是 `every` —— 任一子命令命中就让 hook 跑。
      //     多跑 hook 的代价是"用户可能被打扰一次"，少跑的代价是"漏掉安全检查"。
    };
  },
  isSearchOrReadCommand(input) {
    const parsed = inputSchema().safeParse(input);
    if (!parsed.success) return {
      isSearch: false,
      isRead: false,
      isList: false
    };
    // 注：先 safeParse 一遍，因为 input 的类型是 unknown/宽松的，
    //     不知道 command 字段在不在。解析失败就当"不是搜索/读"（保守：不折叠）。
    return isSearchOrReadBashCommand(parsed.data.command);
  },
  get inputSchema(): InputSchema {
    return inputSchema();
    // 注：用 getter 而不是直接赋值 —— 这样 schema 只在**真正被访问**时才构造，
    //     配合 lazySchema 实现"模块加载零成本"。
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName(input) {
    if (!input) {
      return 'Bash';
    }
    // Render sed in-place edits as file edits
    // 译：把 sed 原地编辑渲染成"文件编辑"。
    if (input.command) {
      const sedInfo = parseSedEditCommand(input.command);
      if (sedInfo) {
        return fileEditUserFacingName({
          file_path: sedInfo.filePath,
          old_string: 'x'
        });
        // 注：`old_string: 'x'` 是个占位值 —— 这里只借 FileEditTool 的**用户名**
        //     （大概是 "Update"），不需要真实的 old_string。
        //     为什么要借：`sed -i` 在用户看来就是改文件，显示 "Bash" 会让人困惑。
      }
    }
    // Env var FIRST: shouldUseSandbox → splitCommand_DEPRECATED → shell-quote's
    // `new RegExp` per call. userFacingName runs per-render for every bash
    // message in history; with ~50 msgs + one slow-to-tokenize command, this
    // exceeds the shimmer tick → transition abort → infinite retry (#21605).
    // 译：**先查环境变量**。因为 shouldUseSandbox → splitCommand_DEPRECATED →
    //     shell-quote 每次调用都会 new RegExp。而 userFacingName 对历史里每条
    //     bash 消息都会在每次渲染时跑一遍；50 条消息加上一条难 tokenize 的命令，
    //     就会超过 shimmer 的 tick 间隔 → 过场动画被中断 → 无限重试（issue #21605）。
    // 注：**这是一个真实 P0 级性能 bug 的修复记录**，注释里写得极其具体。
    //     教训：渲染路径上的函数不能做重活，尤其不能在每次 render 都跑。
    //     解法不是"缓存"，而是**把最便宜的判断放最前面** ——
    //     环境变量没开（绝大多数用户），后面那些昂贵计算全不执行。
    return isEnvTruthy(process.env.CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR) && shouldUseSandbox(input) ? 'SandboxedBash' : 'Bash';
    // 注：`&&` 的短路顺序在这里是**语义的一部分**，不是顺手写的。
    //     改成 `shouldUseSandbox(input) && isEnvTruthy(...)` 就会让 bug 复现。
  },
  getToolUseSummary(input) {
    if (!input?.command) {
      return null;
    }
    const {
      command,
      description
    } = input;
    if (description) {
      return description;
    }
    return truncate(command, TOOL_SUMMARY_MAX_LENGTH);
    // 注：优先用模型写的 description（人话），没有就截断命令本体。
    //     这个摘要会出现在任务列表、`/tasks` 面板等"只给一行"的地方。
  },
  getActivityDescription(input) {
    if (!input?.command) {
      return 'Running command';
    }
    const desc = input.description ?? truncate(input.command, TOOL_SUMMARY_MAX_LENGTH);
    return `Running ${desc}`;
    // 注：和上面几乎一样，但**固定加了 "Running" 前缀** —— 因为这是"正在进行时"的场景
    //     （spinner 旁边的文字），需要动名词短语。
  },
  async validateInput(input: BashToolInput): Promise<ValidationResult> {
    if (feature('MONITOR_TOOL') && !isBackgroundTasksDisabled && !input.run_in_background) {
      // 注：三个条件缺一不可 —— 有这个 feature、后台任务没被禁用、
      //     而且模型没主动要求后台跑。只有"本来想前台跑"的才需要拦。
      const sleepPattern = detectBlockedSleepPattern(input.command);
      if (sleepPattern !== null) {
        return {
          result: false,
          message: `Blocked: ${sleepPattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.`,
          errorCode: 10
          // 注：**报错话术本身是 prompt 工程**。它不只说"不许"，还给了三条出路：
          //     1) 用 run_in_background 跑阻塞命令（会收到完成通知）
          //     2) 用 Monitor 工具看流式事件
          //     3) 真的要等就控制在 2 秒内
          //     errorCode: 10 让上层能识别"这是可纠正的用法错误"，而不是致命错误。
        };
      }
    }
    return {
      result: true
    };
    // 注：这是 validateInput 的典型形态 —— 绝大多数输入直接放行，
    //     只有极少数"模型常见误区"才拦。
  },
  async checkPermissions(input, context): Promise<PermissionResult> {
    return bashToolHasPermission(input, context);
    // 注：**全文件最短的一行，背后是最长的一个模块**。
    //     `bashToolHasPermission` 在 bashPermissions.ts（2621 行）里 ——
    //     那才是真正的权限判定：命令拆分、模式匹配、只读推断、沙箱决策…
    //     本文件只负责"转发"。下一批会专门讲它。
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
  renderToolResultMessage,
  // 注：四个渲染函数都是**直接引用**（来自 ./UI.js），没有在本文件里包一层。
  //     Tool.ts 要求的签名是 `(input, options) => ReactNode`，UI.js 里正好是这个形状。
  // BashToolResultMessage shows <OutputLine content={stdout}> + stderr.
  // UI never shows persistedOutputPath wrapper, backgroundInfo — those are
  // model-facing (mapToolResult... below).
  // 译：BashToolResultMessage 显示 <OutputLine content={stdout}> 和 stderr。
  //     UI **从不**显示 persistedOutputPath 包装和 backgroundInfo ——
  //     那些是给模型看的（见下面的 mapToolResult...）。
  // 注：这里点出了整个系统的一个核心分工：
  //     **UI 看 `data` 对象，模型看 `mapToolResultToToolResultBlockParam` 的返回值。**
  //     同一个执行结果，两条完全不同的呈现路径 —— 这正是 Tool.ts 里
  //     `mapToolResultToToolResultBlockParam` 存在的理由。
  extractSearchText({
    stdout,
    stderr
  }) {
    return stderr ? `${stdout}\n${stderr}` : stdout;
    // 注：Ctrl+O 的"搜索输出"功能用这个。因为 stderr 通常为空（已合并），
    //     实际上就是返回 stdout。
  },
  mapToolResultToToolResultBlockParam({
    interrupted,
    stdout,
    stderr,
    isImage,
    backgroundTaskId,
    backgroundedByUser,
    assistantAutoBackgrounded,
    structuredContent,
    persistedOutputPath,
    persistedOutputSize
  }, toolUseID): ToolResultBlockParam {
    // Handle structured content
    // 译：处理结构化内容。
    if (structuredContent && structuredContent.length > 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: structuredContent
      };
      // 注：结构化内容优先 —— 直接原样塞进 tool_result，不走文本拼接。
    }

    // For image data, format as image content block for Claude
    // 译：图像数据格式化为给 Claude 的 image 内容块。
    if (isImage) {
      const block = buildImageToolResult(stdout, toolUseID);
      if (block) return block;
      // 注：`if (block)` —— 构造失败（base64 坏了、太大了）就往下走文本路径，
      //     不抛错。这种"降级而不是失败"的写法在本文件里反复出现。
    }
    let processedStdout = stdout;
    if (stdout) {
      // Replace any leading newlines or lines with only whitespace
      // 译：去掉开头那些纯空白行。
      processedStdout = stdout.replace(/^(\s*\n)+/, '');
      // Still trim the end as before
      // 译：结尾照旧 trim。
      processedStdout = processedStdout.trimEnd();
      // 注：**只去头尾空白，不动中间** —— 中间的空行往往是输出的一部分
      //     （比如 `git status` 的分组间隔），删了反而难读。
    }

    // For large output that was persisted to disk, build <persisted-output>
    // message for the model. The UI never sees this — it uses data.stdout.
    // 译：对于已经落盘的大输出，构造 <persisted-output> 消息给模型。
    //     UI 永远看不到这个 —— 它用的是 data.stdout。
    if (persistedOutputPath) {
      const preview = generatePreview(processedStdout, PREVIEW_SIZE_BYTES);
      processedStdout = buildLargeToolResultMessage({
        filepath: persistedOutputPath,
        originalSize: persistedOutputSize ?? 0,
        isJson: false,
        preview: preview.preview,
        hasMore: preview.hasMore
      });
      // 注：**这里是"模型看到的"和"UI 看到的"分岔的具体位置**。
      //     模型收到的是"输出太大，已存到 xxx，这是前 8KB 预览"，
      //     而用户在终端里看到的是完整（或已截断）的 stdout。
    }
    let errorMessage = stderr.trim();
    if (interrupted) {
      if (stderr) errorMessage += EOL;
      errorMessage += '<error>Command was aborted before completion</error>';
      // 注：用 XML 标签 `<error>` 包住 —— 模型对这种结构标记敏感度高，
      //     比一句自然语言"命令被中断了"更容易被正确理解为状态而非内容。
    }
    let backgroundInfo = '';
    if (backgroundTaskId) {
      const outputPath = getTaskOutputPath(backgroundTaskId);
      if (assistantAutoBackgrounded) {
        backgroundInfo = `Command exceeded the assistant-mode blocking budget (${ASSISTANT_BLOCKING_BUDGET_MS / 1000}s) and was moved to the background with ID: ${backgroundTaskId}. It is still running — you will be notified when it completes. Output is being written to: ${outputPath}. In assistant mode, delegate long-running work to a subagent or use run_in_background to keep this conversation responsive.`;
      } else if (backgroundedByUser) {
        backgroundInfo = `Command was manually backgrounded by user with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}`;
      } else {
        backgroundInfo = `Command running in background with ID: ${backgroundTaskId}. Output is being written to: ${outputPath}`;
      }
      // 注：**三条后台化路径，三种话术**，区别在于"模型该怎么理解这件事"：
      //     1) assistant 自动转后台 → 明确告诉它"你超预算了"，并教育它下次怎么做
      //        （派子代理 / 主动用 run_in_background）；
      //     2) 用户按了 Ctrl+B → 强调"是人干的"，避免模型以为自己做错了什么；
      //     3) 模型自己要求后台 → 中性陈述。
      //     同样的状态码，不同的归因 —— 因为模型下一步的行为取决于它以为的原因。
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [processedStdout, errorMessage, backgroundInfo].filter(Boolean).join('\n'),
      is_error: interrupted
      // 注：`filter(Boolean)` 去掉空串，避免出现连续空行。
      //     `is_error` **只在被中断时为 true** —— 退出码非 0 但语义上"成功"的情况
      //     （如 grep 无匹配返回 1）在这里不算错误，因为 interpretCommandResult
      //     已经把那种情况排除在 ShellError 之外了（见第 714 行）。
    };
  },

  // ── ④ call()：一次命令调用的完整生命周期 ──
  // 注：这是整个工具的主干，约 200 行。读的时候抓住一条主线：
  //     准备上下文 → 消费生成器拿结果 → 解释退出码 → 抛错或落盘 → 埋点 → 组装返回值。
  async call(input: BashToolInput, toolUseContext, _canUseTool?: CanUseToolFn, parentMessage?: AssistantMessage, onProgress?: ToolCallProgress<BashProgress>) {
    // 注：`_canUseTool` 带下划线 = 声明了但不用。**这是 Tool.ts 里那个
    //     "canUseTool 没人自己用"的结论的又一个实证** —— 权限在 checkPermissions
    //     阶段已经判过了，执行阶段拿到这个函数没用，它只是"能力凭证"，往下透传给子代理。
    // Handle simulated sed edit - apply directly instead of running sed
    // This ensures what the user previewed is exactly what gets written
    // 译：处理模拟的 sed 编辑 —— 直接应用，而不是执行 sed。
    //     保证用户预览到的内容就是实际写进文件的内容。
    // 注：**这个分支在整个 call 的最前面**，早于任何 shell 执行、早于上下文解构。
    //     顺序有讲究：一旦确定是 sed 模拟，就完全不走 shell 路径，
    //     连 abortController 都不需要。
    if (input._simulatedSedEdit) {
      return applySedEdit(input._simulatedSedEdit, toolUseContext, parentMessage);
    }
    const {
      abortController,
      getAppState,
      setAppState,
      setToolJSX
    } = toolUseContext;
    const stdoutAccumulator = new EndTruncatingAccumulator();
    // 注：**只保留结尾**的累加器。为什么是结尾？因为报错、失败原因、最终结果
    //     几乎总在输出末尾。丢开头比丢结尾的信息损失小得多。
    let stderrForShellReset = '';
    // 注：注意命名 —— 这是唯一会写进 `data.stderr` 的内容，
    //     不是子进程的 stderr（那个被合并进 stdout 了）。
    let interpretationResult: ReturnType<typeof interpretCommandResult> | undefined;
    let progressCounter = 0;
    let wasInterrupted = false;
    let result: ExecResult;
    const isMainThread = !toolUseContext.agentId;
    // 注：没有 agentId = 主线程。子代理一定有 agentId。
    //     这个布尔后面控制两件事：能不能 cd（702 行）、要不要处理提示（782 行）。
    const preventCwdChanges = !isMainThread;
    // 注：**子代理不许 cd**。因为子代理和主线程共享一个进程的工作目录，
    //     子代理一 cd，主代理的相对路径全乱。这是多智能体系统里很典型的一个坑。
    try {
      // Use the new async generator version of runShellCommand
      // 译：用新版异步生成器形式的 runShellCommand。
      // 注："new" 说明以前是回调/promise 版，改成生成器是为了**在执行过程中
      //     持续 yield 进度**，而不是等到结束才拿到结果。
      const commandGenerator = runShellCommand({
        input,
        abortController,
        // Use the always-shared task channel so async agents' background
        // bash tasks are actually registered (and killable on agent exit).
        // 译：用始终共享的任务通道，这样异步 agent 的后台 bash 任务才会被真正登记
        //     （并在 agent 退出时可被杀掉）。
        // 注：`setAppStateForTasks ?? setAppState` —— 优先用专用的任务通道。
        //     如果子代理只改自己的局部状态，它的后台 shell 就成了"孤儿进程"：
        //     界面上看不到、任务列表里没有、agent 退出了它还在跑。
        setAppState: toolUseContext.setAppStateForTasks ?? setAppState,
        setToolJSX,
        preventCwdChanges,
        isMainThread,
        toolUseId: toolUseContext.toolUseId,
        agentId: toolUseContext.agentId
      });

      // Consume the generator and capture the return value
      // 译：消费生成器，并捕获它的返回值。
      // 注：**生成器的返回值（return）和 yield 值走的是两条路**：
      //     `yield` 出的是进度（每 2 秒一次），`return` 出的是最终 ExecResult。
      //     所以要用 do-while 手动 next()，才能同时拿到两者。
      let generatorResult;
      do {
        generatorResult = await commandGenerator.next();
        if (!generatorResult.done && onProgress) {
          const progress = generatorResult.value;
          onProgress({
            toolUseID: `bash-progress-${progressCounter++}`,
            data: {
              type: 'bash_progress',
              output: progress.output,
              fullOutput: progress.fullOutput,
              elapsedTimeSeconds: progress.elapsedTimeSeconds,
              totalLines: progress.totalLines,
              totalBytes: progress.totalBytes,
              taskId: progress.taskId,
              timeoutMs: progress.timeoutMs
            }
          });
          // 注：`toolUseID` 每次都是**新字符串**（带自增计数器）。
          //     因为进度是一条条独立的消息，用同一个 ID 会被 UI 当成"更新同一条"，
          //     而不是"追加一条"。
        }
      } while (!generatorResult.done);

      // Get the final result from the generator's return value
      // 译：从生成器的返回值取最终结果。
      result = generatorResult.value;
      trackGitOperations(input.command, result.code, result.stdout);
      const isInterrupt = result.interrupted && abortController.signal.reason === 'interrupt';
      // 注：**中断也分两种**：用户主动打断（reason === 'interrupt'）vs 其他中止
      //     （超时、进程被杀）。前者不该当成错误 —— 用户想停，不是命令失败。
      //     这个区分在下面 696/714 行反复用到。

      // stderr is interleaved in stdout (merged fd) — result.stdout has both
      // 译：**stderr 被交错进了 stdout（文件描述符已合并）** —— result.stdout 里两者都有。
      // 注：★★★ 全文件最该记住的一条事实 ★★★
      //     子进程是以 `stderr -> stdout` 的方式启动的（merged fd），所以：
      //     - 错误输出也在 result.stdout 里
      //     - `data.stderr` 永远是空串（除非 shell 被重置）
      //     - 埋点里 `stderr_length: 0` 是写死的（第 758 行）
      //     - 输出顺序是**真实交错顺序**，这对读日志很重要（错误出现在它实际发生的位置）
      //     为什么这么做：分开两个流会导致"错误信息与上下文错位"，
      //     模型看到一堆 stdout 然后在最末尾看到 stderr，无法对应。
      stdoutAccumulator.append((result.stdout || '').trimEnd() + EOL);
      // 注：整体再 trimEnd 一次并补一个换行 —— 保证每段输出之间至少有一个分隔。

      // Interpret the command result using semantic rules
      // 译：用语义规则解释命令结果。
      interpretationResult = interpretCommandResult(input.command, result.code, result.stdout || '', '');
      // 注：**第四个别参数是空串**。这就是第 2 步批注时发现的：
      //     interpretCommandResult 的签名大概是 (command, code, stdout, stderr)，
      //     这里 stderr 传 ''，因为 stderr 已经混在 stdout 里了 —— 传两次会重复。
      //     返回的 `message` 会进 data.returnCodeInterpretation（808 行），
      //     但 Bash 侧不读它做判断。

      // Check for git index.lock error (stderr is in stdout now)
      // 译：检查 git index.lock 错误（stderr 现在在 stdout 里）。
      if (result.stdout && result.stdout.includes(".git/index.lock': File exists")) {
        logEvent('tengu_git_index_lock_error', {});
        // 注：**纯埋点，不影响行为**。为什么要单独统计这个？
        //     因为"git index.lock 已存在"是 Claude Code 用户最高频的卡点之一
        //     （多个 agent 并行跑 git 命令时会撞）。有数据才能判断要不要做自动恢复。
        //     这也是一个"从错误日志里发现产品问题"的例子。
      }
      if (interpretationResult.isError && !isInterrupt) {
        // Only add exit code if it's actually an error
        // 译：只有真的是错误时才加退出码。
        // 注：注意这是**加到 stdoutAccumulator** 里，也就是给模型看的输出末尾。
        //     `grep` 返回 1（无匹配）不算错误，所以不会出现 "Exit code 1"。
        if (result.code !== 0) {
          stdoutAccumulator.append(`Exit code ${result.code}`);
        }
      }
      if (!preventCwdChanges) {
        const appState = getAppState();
        if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
          stderrForShellReset = stdErrAppendShellResetMessage('');
          // 注：**这里就是 stderr 唯一会被填内容的场景**。
          //     如果命令把 cwd 改到了项目目录之外（`cd /etc && ...`），
          //     主线程会被强制拉回项目根，并给模型一句"我已重置 shell 目录"。
          //     为什么要重置：否则后续所有相对路径都基于 /etc，全乱。
          //     为什么用 stderr 字段：它不是错误，但必须让模型知道状态变了。
        }
      }

      // Annotate output with sandbox violations if any (stderr is in stdout)
      // 译：如果有沙箱违规，给输出加上标注（stderr 在 stdout 里）。
      const outputWithSbFailures = SandboxManager.annotateStderrWithSandboxFailures(input.command, result.stdout || '');
      if (result.preSpawnError) {
        throw new Error(result.preSpawnError);
        // 注：**进程根本没起来**（比如 bash 不存在、沙箱初始化失败）。
        //     这种错误不带退出码，直接抛普通 Error —— 走的是"执行环境出错"路径，
        //     而不是"命令返回非零"路径。
      }
      if (interpretationResult.isError && !isInterrupt) {
        // stderr is merged into stdout (merged fd); outputWithSbFailures
        // already has the full output. Pass '' for stdout to avoid
        // duplication in getErrorParts() and processBashCommand.
        // 译：stderr 已合并进 stdout；outputWithSbFailures 已经包含完整输出。
        //     stdout 传空串，避免在 getErrorParts() 和 processBashCommand 里重复。
        // 注：**第一个参数是 stderr，第二个是 stdout** —— 这里把"完整输出"当作
        //     错误文本传进去，stdout 传 ''。因为 ShellError 最终会把两者拼接，
        //     如果都传就会打印两次。
        throw new ShellError('', outputWithSbFailures, result.code, result.interrupted);
        // 注：抛 ShellError 而不是返回 `{isError: true}` 的结果 ——
        //     这条错误会走 toolExecution.ts 的错误路径，变成 is_error 的 tool_result。
      }
      wasInterrupted = result.interrupted;
    } finally {
      if (setToolJSX) setToolJSX(null);
      // 注：**无论成功失败都要清掉自定义 JSX**（那个"按 Ctrl+B 转后台"的提示条）。
      //     如果忘了 finally，失败路径上这个提示会一直挂在屏幕上。
    }

    // Get final string from accumulator
    // 译：从累加器取出最终字符串。
    const stdout = stdoutAccumulator.toString();

    // Large output: the file on disk has more than getMaxOutputLength() bytes.
    // stdout already contains the first chunk (from getStdout()). Copy the
    // output file to the tool-results dir so the model can read it via
    // FileRead. If > 64 MB, truncate after copying.
    // 译：大输出：磁盘上的文件超过 getMaxOutputLength() 字节。stdout 已经包含第一段
    //     （来自 getStdout()）。把输出文件复制到 tool-results 目录，
    //     这样模型可以用 FileRead 去读它。超过 64 MB 就在复制后截断。
    // 注：**注意这里的数据流**：shell 输出本来就写在临时文件里（为了支持进度轮询），
    //     所以"落盘"其实是"把那个临时文件搬到持久目录"，不是重新写一遍。
    const MAX_PERSISTED_SIZE = 64 * 1024 * 1024;
    let persistedOutputPath: string | undefined;
    let persistedOutputSize: number | undefined;
    if (result.outputFilePath && result.outputTaskId) {
      try {
        const fileStat = await fsStat(result.outputFilePath);
        persistedOutputSize = fileStat.size;
        await ensureToolResultsDir();
        const dest = getToolResultPath(result.outputTaskId, false);
        if (fileStat.size > MAX_PERSISTED_SIZE) {
          await fsTruncate(result.outputFilePath, MAX_PERSISTED_SIZE);
          // 注：**先截断原文件再搬**，而不是搬完再截断 —— 省一次 64MB 的读。
          //     代价是临时文件也被截了（但反正要清理）。
        }
        try {
          await link(result.outputFilePath, dest);
          // 注：**优先硬链接**。同一个磁盘卷上，硬链接是 O(1) 的 ——
          //     不复制任何数据，只是多一个目录项。几百 MB 的输出瞬间"复制"完。
        } catch {
          await copyFile(result.outputFilePath, dest);
          // 注：跨卷/跨文件系统时硬链接会失败（EXDEV），退回真复制。
          //     这种"先试快的、失败再退回慢的"模式在本文件里出现三次
          //     （这里、745、还有 spawnBackgroundTask）。
        }
        persistedOutputPath = dest;
      } catch {
        // File may already be gone — stdout preview is sufficient
        // 译：文件可能已经不在了 —— 有 stdout 预览就够了。
        // 注：**整个落盘过程失败也不抛错**。这是刻意的降级：
        //     落盘的目的是"让模型能看完整输出"，失败了只是模型看到被截断的输出，
        //     命令本身已经执行完了，不该因为"存不下日志"而报错。
      }
    }
    const commandType = input.command.split(' ')[0];
    logEvent('tengu_bash_tool_command_executed', {
      command_type: commandType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      stdout_length: stdout.length,
      stderr_length: 0,
      exit_code: result.code,
      interrupted: wasInterrupted
      // 注：`stderr_length: 0` **写死**。不是 bug，是因为 stderr 根本不存在（已合并）。
      //     留着这个字段是为了跟历史数据保持 schema 一致。
      //     另外 `command_type` 只取 `split(' ')[0]` —— 比 getCommandTypeForLogging 更粗糙，
      //     但这里只需要"大概是哪个程序"。
    });

    // Log code indexing tool usage
    // 译：记录代码索引工具的使用。
    const codeIndexingTool = detectCodeIndexingFromCommand(input.command);
    if (codeIndexingTool) {
      logEvent('tengu_code_indexing_tool_used', {
        tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source: 'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: result.code === 0
      });
      // 注：单独统计"用户是不是在用 ctags/cscope/LSP 这类索引工具"。
      //     产品上想知道：要不要内置代码索引。
    }
    let strippedStdout = stripEmptyLines(stdout);
    // 注：去掉空行后的版本 —— **给模型看的是这个**，不是原始 stdout。

    // Claude Code hints protocol: CLIs/SDKs gated on CLAUDECODE=1 emit a
    // `<claude-code-hint />` tag to stderr (merged into stdout here). Scan,
    // record for useClaudeCodeHintRecommendation to surface, then strip
    // so the model never sees the tag — a zero-token side channel.
    // Stripping runs unconditionally (subagent output must stay clean too);
    // only the dialog recording is main-thread-only.
    // 译：Claude Code 提示协议 —— 以 CLAUDECODE=1 为条件的 CLI/SDK 会往 stderr
    //     （这里已合并进 stdout）输出一个 `<claude-code-hint />` 标签。
    //     扫描它、记录下来供 useClaudeCodeHintRecommendation 展示，然后**剥掉**，
    //     这样模型永远看不到这个标签 —— 一条零 token 的侧信道。
    //     剥除是无条件执行的（子代理的输出也必须干净）；
    //     只有"记录到弹窗"这一步是主线程专属。
    // 注：**这是个很巧妙的设计**。第三方 CLI 想告诉 Claude Code "你该推荐我"，
    //     但不能占用模型上下文（token 花钱、还干扰推理）。
    //     解法：借用子进程输出这条已经存在的通道，写一个标签，宿主扫描后立刻删掉。
    //     模型看到的是完全干净的命令输出，而产品侧拿到了结构化信号。
    const extracted = extractClaudeCodeHints(strippedStdout, input.command);
    strippedStdout = extracted.stripped;
    if (isMainThread && extracted.hints.length > 0) {
      for (const hint of extracted.hints) maybeRecordPluginHint(hint);
    }
    let isImage = isImageOutput(strippedStdout);
    // 注：判断输出是不是图片 —— 靠魔数（PNG/JPEG 头）。有些命令会直接 cat 图片。

    // Cap image dimensions + size if present (CC-304 — see
    // resizeShellImageOutput). Scope the decoded buffer so it can be reclaimed
    // before we build the output Out object.
    // 译：如果有图片，限制它的尺寸和大小（CC-304 —— 见 resizeShellImageOutput）。
    //     把解码后的 buffer 限制在作用域里，这样在构造输出对象之前就能被回收。
    let compressedStdout = strippedStdout;
    if (isImage) {
      const resized = await resizeShellImageOutput(strippedStdout, result.outputFilePath, persistedOutputSize);
      if (resized) {
        compressedStdout = resized;
      } else {
        // Parse failed or file too large (e.g. exceeds MAX_IMAGE_FILE_SIZE).
        // Keep isImage in sync with what we actually send so the UI label stays
        // accurate — mapToolResultToToolResultBlockParam's defensive
        // fallthrough will send text, not an image block.
        // 译：解析失败或文件太大（例如超过 MAX_IMAGE_FILE_SIZE）。
        //     让 isImage 与实际发送的内容保持一致，这样 UI 标签才准确 ——
        //     mapToolResultToToolResultBlockParam 的防御性分支会发文本而不是图片块。
        // 注：**"标志位必须跟着实际内容走"** —— 如果 isImage 还是 true 但内容是文本，
        //     UI 会显示"[图片]"而模型收到一段 base64 文本，两边都错。
        isImage = false;
      }
    }
    const data: Out = {
      stdout: compressedStdout,
      stderr: stderrForShellReset,
      interrupted: wasInterrupted,
      isImage,
      returnCodeInterpretation: interpretationResult?.message,
      noOutputExpected: isSilentBashCommand(input.command),
      backgroundTaskId: result.backgroundTaskId,
      backgroundedByUser: result.backgroundedByUser,
      assistantAutoBackgrounded: result.assistantAutoBackgrounded,
      dangerouslyDisableSandbox: 'dangerouslyDisableSandbox' in input ? input.dangerouslyDisableSandbox as boolean | undefined : undefined,
      // 注：`'dangerouslyDisableSandbox' in input` 这个判断是必要的 ——
      //     因为 schema 可能 omit 掉它（虽然这里没有），运行时的 input 上
      //     这个键可能不存在。直接读会是 undefined，但类型上会报错。
      persistedOutputPath,
      persistedOutputSize
    };
    return {
      data
    };
    // 注：call 的返回值是 `{ data: Out }`。`data` 就是**UI 层拿到的完整结果**。
    //     模型拿到的是 mapToolResultToToolResultBlockParam 转换后的文本。
  },

  renderToolUseErrorMessage,
  isResultTruncated(output: Out): boolean {
    return isOutputLineTruncated(output.stdout) || isOutputLineTruncated(output.stderr);
    // 注：判断"给模型的输出是否被截断过"，UI 据此显示"输出已截断"角标。
    //     这里同时看 stdout 和 stderr（虽然 stderr 基本为空）。
  }
} satisfies ToolDef<InputSchema, Out, BashProgress>);
// 注：`satisfies ToolDef<...>` 三个泛型分别是：**模型能填的输入**、**返回的数据**、
//     **进度数据类型**。用 `satisfies` 而不是 `: ToolDef<...>` 的原因，
//     在 Tool.ts 的批注里讲过：satisfies 校验形状但保留字面量类型，
//     冒号注解会把类型拓宽成联合体。

// ── ⑤ runShellCommand：异步生成器（进度 / 超时 / 后台化） ──
// 注：这是全文件最难读的一段（约 320 行）。难点不在逻辑分支多，
//     而在**它用 Promise 当条件变量**来实现"停在原地等下一批输出"。
//
//     先建立心智模型：
//       这是个 async generator  —— 它既 yield（进度），也会 return（最终结果）。
//       外部用 `await gen.next()` 一圈圈拉，拉到 done 就拿到 return 值。
//       内部用 `Promise.race([resultPromise, progressSignal])` 同时等两件事：
//          /  命令结束了 → 拿到 ExecResult，退出
//          |  有新的输出 → 被 poller 唤醒，yield 一次进度，继续等
//          \  被后台化了 → 看到一个 backgroundTaskId，立刻返回
//
//     所以"进度"不是靠定时器轮询，而是**事件驱动的唤醒**：
//     TaskOutput 的共享 poller 每秒 tick 一次，tick 里有新数据就调用
//     onProgress → 里面 resolve 掉那个 Promise → race 醒过来 → yield。
async function* runShellCommand({
  input,
  abortController,
  setAppState,
  setToolJSX,
  preventCwdChanges,
  isMainThread,
  toolUseId,
  agentId
}: {
  input: BashToolInput;
  abortController: AbortController;
  setAppState: (f: (prev: AppState) => AppState) => void;
  setToolJSX?: SetToolJSXFn;
  preventCwdChanges?: boolean;
  isMainThread?: boolean;
  toolUseId?: string;
  agentId?: AgentId;
}): AsyncGenerator<{
  type: 'progress';
  output: string;
  fullOutput: string;
  elapsedTimeSeconds: number;
  totalLines: number;
  totalBytes?: number;
  taskId?: string;
  timeoutMs?: number;
}, ExecResult, void> {
  // 注：三段泛型：[yield 的类型, return 的类型, next() 传入的类型]。
  //     yield = 进度对象；return = ExecResult；next 不收参数（void）。
  const {
    command,
    description,
    timeout,
    run_in_background
  } = input;
  const timeoutMs = timeout || getDefaultTimeoutMs();
  // 注：`||` 而不是 `??` —— 意味着传 0 也会落到默认值。
  //     这里是对的：timeout: 0 没有意义，不如当成"没传"。
  let fullOutput = '';
  let lastProgressOutput = '';
  let lastTotalLines = 0;
  let lastTotalBytes = 0;
  let backgroundShellId: string | undefined = undefined;
  let assistantAutoBackgrounded = false;

  // Progress signal: resolved by onProgress callback from the shared poller,
  // waking the generator to yield a progress update.
  // 译：进度信号 —— 由共享 poller 的 onProgress 回调 resolve，唤醒生成器去 yield 进度更新。
  let resolveProgress: (() => void) | null = null;
  function createProgressSignal(): Promise<null> {
    return new Promise<null>(resolve => {
      resolveProgress = () => resolve(null);
      // 注：**这就是"用 Promise 当条件变量"的核心**。
      //     把 resolve 存到外部变量里，让别的地方能"手动触发"这个 Promise 完成。
      //     等价于 Go 的 channel 或 Python 的 asyncio.Event。
      //     Promise 永远 resolve 成 null —— 它的值不重要，**完成这个事实**才重要。
    });
  }

  // Determine if auto-backgrounding should be enabled
  // Only enable for commands that are allowed to be auto-backgrounded
  // and when background tasks are not disabled
  // 译：判断是否启用自动转后台。只对允许自动转的命令启用，且后台任务没被禁用。
  const shouldAutoBackground = !isBackgroundTasksDisabled && isAutobackgroundingAllowed(command);
  const shellCommand = await exec(command, abortController.signal, 'bash', {
    timeout: timeoutMs,
    onProgress(lastLines, allLines, totalLines, totalBytes, isIncomplete) {
      lastProgressOutput = lastLines;
      fullOutput = allLines;
      lastTotalLines = totalLines;
      lastTotalBytes = isIncomplete ? totalBytes : 0;
      // 注：`isIncomplete ? totalBytes : 0` —— 只有输出还在增长时才报字节数。
      //     输出结束后报 0，避免 UI 显示一个持续不变的"432 KB"。
      // Wake the generator so it yields the new progress data
      // 译：唤醒生成器，让它 yield 新的进度数据。
      const resolve = resolveProgress;
      if (resolve) {
        resolveProgress = null;
        // 注：**先取出再置空**，防止重复 resolve（Promise 只能 resolve 一次，
        //     重复调用是静默无效的，但会掩盖逻辑错误）。
        resolve();
      }
    },
    preventCwdChanges,
    shouldUseSandbox: shouldUseSandbox(input),
    shouldAutoBackground
  });
  // 注：`exec` 返回的是一个"句柄"对象（ShellCommand），不是结果。
  //     句柄上有：`.result`（Promise）、`.onTimeout`（注册回调）、
  //     `.status`（running/backgrounded/exited）、`.cleanup()`、`.taskOutput`。

  // Start the command execution
  // 译：开始执行命令。
  const resultPromise = shellCommand.result;
  // 注：注意 `exec` 是 await 的，但命令**已经开始跑了** ——
  //     它返回句柄时子进程已 spawn。所以这不是"延迟执行"。

  // Helper to spawn a background task and return its ID
  // 译：辅助函数：spawn 一个后台任务并返回它的 ID。
  async function spawnBackgroundTask(): Promise<string> {
    const handle = await spawnShellTask({
      command,
      description: description || command,
      shellCommand,
      toolUseId,
      agentId
    }, {
      abortController,
      getAppState: () => {
        // We don't have direct access to getAppState here, but spawn doesn't
        // actually use it during the spawn process
        // 译：这里拿不到 getAppState，但 spawn 过程中其实不用它。
        throw new Error('getAppState not available in runShellCommand context');
        // 注：**抛错的存根函数**。这是"我知道这个接口不该被调用，所以让它炸"
        //     的防御性写法 —— 比传 undefined 好：如果将来真的调到了，
        //     会立刻暴露，而不是变成难查的 TypeError。
      },
      setAppState
    });
    return handle.taskId;
  }

  // Helper to start backgrounding with optional logging
  // 译：辅助函数：开始转后台，可选记录日志。
  function startBackgrounding(eventName: string, backgroundFn?: (shellId: string) => void): void {
    // If a foreground task is already registered (via registerForeground in the
    // progress loop), background it in-place instead of re-spawning. Re-spawning
    // would overwrite tasks[taskId], emit a duplicate task_started SDK event,
    // and leak the first cleanup callback.
    // 译：如果已经注册过前台任务（在进度循环里通过 registerForeground），
    //     就**原地转后台**，而不是重新 spawn。重新 spawn 会覆盖 tasks[taskId]、
    //     重复发出 task_started 的 SDK 事件，还会泄漏第一个清理回调。
    // 注：**这是"状态机不能有两个入口"的经典教训**。同一个任务如果既被
    //     registerForeground 登记过、又被 spawnShellTask 新建一次，
    //     就会出现两个句柄指向同一个子进程，清理逻辑互相踩。
    if (foregroundTaskId) {
      if (!backgroundExistingForegroundTask(foregroundTaskId, shellCommand, description || command, setAppState, toolUseId)) {
        return;
        // 注：原地转后台失败（比如任务已经结束）就什么都不做，让调用方继续。
      }
      backgroundShellId = foregroundTaskId;
      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command)
      });
      backgroundFn?.(foregroundTaskId);
      return;
    }

    // No foreground task registered — spawn a new background task
    // Note: spawn is essentially synchronous despite being async
    // 译：没有登记过前台任务 —— 新建一个后台任务。
    //     注意：spawn 虽然声明为 async，但实际上几乎是同步的。
    void spawnBackgroundTask().then(shellId => {
      // 注：`void` 前缀 = "我知道这是 Promise，故意不等它"。
      //     Tool.ts 批注里讲过：`void` 会丢掉异常。这里可接受，因为
      //     spawn 失败的情况下面的代码会走"命令已完成"的分支。
      backgroundShellId = shellId;

      // Wake the generator's Promise.race so it sees backgroundShellId.
      // Without this, if the poller has stopped ticking for this task
      // (no output + shared-poller race with sibling stopPolling calls)
      // and the process is hung on I/O, the race at line ~1357 never
      // resolves and the generator deadlocks despite being backgrounded.
      // 译：唤醒生成器的 Promise.race，让它看到 backgroundShellId。
      //     否则：如果这个任务的 poller 已经停止 tick（没有输出 +
      //     共享 poller 与兄弟任务的 stopPolling 抢跑），
      //     而进程又卡在 I/O 上，那么后面那个 race 永远不会 resolve，
      //     生成器就会在"已经转后台"的情况下死锁。
      // 注：**这是一处真实的死锁修复，注释精确到行号**。
      //     根因很微妙：poller 是**共享的**（多个任务共用一次 tick），
      //     兄弟任务 stopPolling 可能把整个 tick 停掉，导致本任务再也收不到 onProgress
      //     → resolveProgress 永远不会被调用 → race 卡死。
      //     解法：转后台这个动作**自己**主动 resolve 一次，不依赖 poller。
      const resolve = resolveProgress;
      if (resolve) {
        resolveProgress = null;
        resolve();
      }
      logEvent(eventName, {
        command_type: getCommandTypeForLogging(command)
      });
      if (backgroundFn) {
        backgroundFn(shellId);
      }
    });
  }

  // Set up auto-backgrounding on timeout if enabled
  // Only background commands that are allowed to be auto-backgrounded (not sleep, etc.)
  // 译：如果启用，注册"超时时自动转后台"。只对允许自动转的命令生效（不含 sleep 等）。
  if (shellCommand.onTimeout && shouldAutoBackground) {
    shellCommand.onTimeout(backgroundFn => {
      startBackgrounding('tengu_bash_command_timeout_backgrounded', backgroundFn);
      // 注：**路径一：超时**。命令跑过了 timeoutMs 还没结束，不杀它，
      //     而是转后台继续跑。这是"超时不等于失败"的设计 ——
      //     很多构建/测试就是会超时，杀掉重跑只会浪费时间。
    });
  }

  // In assistant mode, the main agent should stay responsive. Auto-background
  // blocking commands after ASSISTANT_BLOCKING_BUDGET_MS so the agent can keep
  // coordinating instead of waiting. The command keeps running — no state loss.
  // 译：在 assistant 模式下，主 agent 要保持响应。阻塞式命令超过
  //     ASSISTANT_BLOCKING_BUDGET_MS（15 秒）后自动转后台，让 agent 能继续协调，
  //     而不是干等。命令继续跑 —— 不丢状态。
  if (feature('KAIROS') && getKairosActive() && isMainThread && !isBackgroundTasksDisabled && run_in_background !== true) {
    setTimeout(() => {
      if (shellCommand.status === 'running' && backgroundShellId === undefined) {
        assistantAutoBackgrounded = true;
        startBackgrounding('tengu_bash_command_assistant_auto_backgrounded');
        // 注：**路径二：assistant 模式的 15 秒预算**。
        //     三个前置条件：KAIROS 开启、是主线程、模型没主动要求后台。
        //     `.unref()` 让这个定时器**不阻止进程退出** —— 否则一条 15 秒定时器
        //     会让程序在没事可做时也活 15 秒。
      }
    }, ASSISTANT_BLOCKING_BUDGET_MS).unref();
  }

  // Handle Claude asking to run it in the background explicitly
  // When explicitly requested via run_in_background, always honor the request
  // regardless of the command type (isAutobackgroundingAllowed only applies to automatic backgrounding)
  // Skip if background tasks are disabled - run in foreground instead
  // 译：处理 Claude 明确要求后台运行的情况。
  //     通过 run_in_background 显式请求时，无论命令类型如何都满足要求
  //     （isAutobackgroundingAllowed 只约束自动转后台）。
  //     后台任务被禁用时跳过 —— 改为前台运行。
  if (run_in_background === true && !isBackgroundTasksDisabled) {
    const shellId = await spawnBackgroundTask();
    logEvent('tengu_bash_command_explicitly_backgrounded', {
      command_type: getCommandTypeForLogging(command)
    });
    return {
      stdout: '',
      stderr: '',
      code: 0,
      interrupted: false,
      backgroundTaskId: shellId
      // 注：**返回 code: 0** —— 命令还没跑完，谈不上退出码。
      //     给 0 而不是 -1，是为了让"立即返回"不被上层当成失败。
      //     真正的结果之后通过 task_notification 异步送达。
    };
  }

  // Wait for the initial threshold before showing progress
  // 译：先等一个初始阈值（2 秒），再开始显示进度。
  const startTime = Date.now();
  let foregroundTaskId: string | undefined = undefined;
  {
    const initialResult = await Promise.race([resultPromise, new Promise<null>(resolve => {
      const t = setTimeout((r: (v: null) => void) => r(null), PROGRESS_THRESHOLD_MS, resolve);
      t.unref();
    })]);
    // 注：**第一个 race**：命令在 2 秒内跑完就直接返回，连进度循环都不进。
    //     绝大多数命令（ls、git status）走这条路 —— 完全零进度开销。
    if (initialResult !== null) {
      shellCommand.cleanup();
      return initialResult;
      // 注：**返回前必须 cleanup()** —— 释放输出文件的 watcher、清理临时文件。
      //     这条路径没进 try/finally，所以要手动清。
    }
    if (backgroundShellId) {
      return {
        stdout: '',
        stderr: '',
        code: 0,
        interrupted: false,
        backgroundTaskId: backgroundShellId,
        assistantAutoBackgrounded
        // 注：2 秒内就被后台化了（比如超时值很小）—— 直接返回后台句柄。
      };
    }
  }

  // Start polling the output file for progress. The poller's #tick calls
  // onProgress every second, which resolves progressSignal below.
  // 译：开始轮询输出文件以获取进度。poller 的 #tick 每秒调一次 onProgress，
  //     从而 resolve 下面的 progressSignal。
  TaskOutput.startPolling(shellCommand.taskOutput.taskId);
  // 注：**poller 是共享的**（前面死锁注释里提到的兄弟任务问题就源于此）。
  //     多个并发任务共用一次 tick，省 CPU。

  // Progress loop: wake is driven by the shared poller calling onProgress,
  // which resolves the progressSignal.
  // 译：进度循环 —— 唤醒由共享 poller 调 onProgress 驱动，它会 resolve progressSignal。
  try {
    while (true) {
      const progressSignal = createProgressSignal();
      const result = await Promise.race([resultPromise, progressSignal]);
      if (result !== null) {
        // Race: backgrounding fired (15s timer / onTimeout / Ctrl+B) but the
        // command completed before the next poll tick. #handleExit sets
        // backgroundTaskId but skips outputFilePath (it assumes the background
        // message or <task_notification> will carry the path). Strip
        // backgroundTaskId so the model sees a clean completed command,
        // reconstruct outputFilePath for large outputs, and suppress the
        // redundant <task_notification> from the .then() handler.
        // Check result.backgroundTaskId (not the closure var) to also cover
        // Ctrl+B, which calls shellCommand.background() directly.
        // 译：竞态 —— 后台化已经触发（15 秒定时器 / onTimeout / Ctrl+B），
        //     但命令在下一个 poll tick 之前就结束了。#handleExit 会设置
        //     backgroundTaskId 却跳过 outputFilePath（它以为后台消息或
        //     <task_notification> 会带上路径）。所以这里：
        //     剥掉 backgroundTaskId 让模型看到一个干净的"已完成"命令、
        //     为大输出重建 outputFilePath、并抑制 .then() 处理器里
        //     那条多余的 <task_notification>。
        //     检查 result.backgroundTaskId（而不是闭包变量）是为了也覆盖 Ctrl+B ——
        //     它直接调 shellCommand.background()，不经过我们的 startBackgrounding。
        // 注：**这是本文件最精妙的一段**。它处理的是"两个状态转换同时发生"：
        //     "命令完成" 和 "转后台" 撞在同一个 tick 里。
        //     如果不管，模型会收到一个"后台任务 ID"却发现那任务早结束了。
        //     处理方式是**以完成状态为准**，把后台化的痕迹擦干净。
        if (result.backgroundTaskId !== undefined) {
          markTaskNotified(result.backgroundTaskId, setAppState);
          // 注：标记"这个任务已经通知过了"，这样稍后 .then() 里的通知逻辑会跳过它。
          const fixedResult: ExecResult = {
            ...result,
            backgroundTaskId: undefined
          };
          // Mirror ShellCommand.#handleExit's large-output branch that was
          // skipped because #backgroundTaskId was set.
          // 译：补上 ShellCommand.#handleExit 里因为 backgroundTaskId 被设置
          //     而跳过的大输出分支。
          const {
            taskOutput
          } = shellCommand;
          if (taskOutput.stdoutToFile && !taskOutput.outputFileRedundant) {
            fixedResult.outputFilePath = taskOutput.path;
            fixedResult.outputFileSize = taskOutput.outputFileSize;
            fixedResult.outputTaskId = taskOutput.taskId;
          }
          shellCommand.cleanup();
          return fixedResult;
        }
        // Command has completed - return the actual result
        // If we registered as a foreground task, unregister it
        // 译：命令已完成 —— 返回真实结果。如果登记过前台任务，注销它。
        if (foregroundTaskId) {
          unregisterForeground(foregroundTaskId, setAppState);
        }
        // Clean up stream resources for foreground commands
        // (backgrounded commands are cleaned up by LocalShellTask)
        // 译：清理前台命令的流资源（已转后台的命令由 LocalShellTask 清理）。
        shellCommand.cleanup();
        return result;
      }

      // Check if command was backgrounded (either via old mechanism or new backgroundAll)
      // 译：检查命令是否已被转后台（旧机制或新的 backgroundAll 都算）。
      if (backgroundShellId) {
        return {
          stdout: '',
          stderr: '',
          code: 0,
          interrupted: false,
          backgroundTaskId: backgroundShellId,
          assistantAutoBackgrounded
        };
      }

      // Check if this foreground task was backgrounded via backgroundAll()
      // 译：检查这个前台任务是否被 backgroundAll() 转成了后台。
      if (foregroundTaskId) {
        // shellCommand.status becomes 'backgrounded' when background() is called
        // 译：调用 background() 之后，shellCommand.status 会变成 'backgrounded'。
        if (shellCommand.status === 'backgrounded') {
          return {
            stdout: '',
            stderr: '',
            code: 0,
            interrupted: false,
            backgroundTaskId: foregroundTaskId,
            backgroundedByUser: true
            // 注：**路径三：用户按 Ctrl+B**。判定靠 `status === 'backgrounded'`
            //     （状态由 ShellCommand 内部改），而不是靠回调 ——
            //     因为 Ctrl+B 是全局按键处理，不经过这个生成器。
          };
        }
      }

      // Time for a progress update
      // 译：该发一次进度了。
      const elapsed = Date.now() - startTime;
      const elapsedSeconds = Math.floor(elapsed / 1000);

      // Show minimal backgrounding UI if available
      // Skip if background tasks are disabled
      // 译：如果有条件，显示最小的"可转后台"提示 UI。后台任务禁用时跳过。
      if (!isBackgroundTasksDisabled && backgroundShellId === undefined && elapsedSeconds >= PROGRESS_THRESHOLD_MS / 1000 && setToolJSX) {
        // Register this command as a foreground task so it can be backgrounded via Ctrl+B
        // 译：把这条命令登记为前台任务，这样它才能被 Ctrl+B 转后台。
        if (!foregroundTaskId) {
          foregroundTaskId = registerForeground({
            command,
            description: description || command,
            shellCommand,
            agentId
          }, setAppState, toolUseId);
          // 注：**这里就是"前台任务"的诞生点**，也是 startBackgrounding 里
          //     那个 `if (foregroundTaskId)` 分支的由来。
          //     注意它发生在**第一次发进度时**，不是命令启动时 ——
          //     2 秒内跑完的命令从来没登记过，所以也不需要注销。
        }
        setToolJSX({
          jsx: <BackgroundHint />,
          shouldHidePromptInput: false,
          shouldContinueAnimation: true,
          showSpinner: true
          // 注：这就是为什么文件必须是 .tsx —— 直接返回 JSX 给 Ink 渲染。
          //     `shouldHidePromptInput: false` 意味着用户还能继续打字（不阻塞输入）。
        });
      }
      yield {
        type: 'progress',
        fullOutput,
        output: lastProgressOutput,
        elapsedTimeSeconds: elapsedSeconds,
        totalLines: lastTotalLines,
        totalBytes: lastTotalBytes,
        taskId: shellCommand.taskOutput.taskId,
        ...(timeout ? {
          timeoutMs
        } : undefined)
        // 注：`timeoutMs` **只在用户设了 timeout 时才带上** ——
        //     UI 据此决定要不要显示"还剩 N 秒"的倒计时。
        //     没设超时就不显示，避免暗示"这个命令有期限"。
      };
    }
  } finally {
    TaskOutput.stopPolling(shellCommand.taskOutput.taskId);
    // 注：**无论怎么退出都要停 poller**。
    //     注意这里是 stopPolling（单个任务），不是停止整个共享 poller ——
    //     但正是这个调用可能影响兄弟任务（见前面死锁注释）。
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,【原文此处为约 8 万字符的 base64 sourcemap，批注版省略】
