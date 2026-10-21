// ════════════════════════════════════════════════════════════════════
// 【本文件在整条权限链里的位置】
//
// BashTool 每收到一条命令，要过三道关：
//
//   ① 结构闸门   bashPermissions.ts:1692  parseCommandRaw() → parseForSecurityFromAst()
//                 用 tree-sitter 建 AST，判「这条命令能不能被安全地切分」
//   ② 危险检测   本文件（bashSecurity.ts）
//                 用正则 + 手写状态机，判「这条命令里有没有解析器差异」
//   ③ 权限判定   bashPermissions.ts:1663  bashToolHasPermission()
//                 规则匹配 / 沙箱 / 分类器 / 用户确认
//
// 本文件是 ②。但注意文件末尾那两个函数都带 `_DEPRECATED` 后缀，注释里写
// 「The primary gate is parseForSecurity (ast.ts)」—— 意思是：只要 tree-sitter
// 的 WASM 加载成功，主流程根本不会走到这里。
//
// 那它为什么还在？三个真实理由，缺一不可：
//   · tree-sitter WASM 可能加载失败（环境/平台/体积限制），必须留降级路径
//   · `readOnlyValidation.ts:1894` 和 `:1971` 是**同步**函数，拿不到 async 的
//     tree-sitter 结果，只能同步调本文件的 `bashCommandIsSafe_DEPRECATED`
//   · `CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK=1` 会关掉 AST 那条路，
//     只剩本文件兜底
//
// 所以「DEPRECATED」在这里的含义是「不再是第一道闸门」，不是「不再运行」。
// ════════════════════════════════════════════════════════════════════
import { logEvent } from 'src/services/analytics/index.js'
import { extractHeredocs } from '../../utils/bash/heredoc.js'
import { ParsedCommand } from '../../utils/bash/ParsedCommand.js'
import {
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  tryParseShellCommand,
} from '../../utils/bash/shellQuote.js'
import type { TreeSitterAnalysis } from '../../utils/bash/treeSitterAnalysis.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
// 注：只导入类型（`import type`），编译期被擦除，所以这两个模块不存在也
//     不影响运行 —— 这也是为什么 `types/permissions.ts` 里那个
//     `isBashSecurityCheckForMisparsing` 字段在源码树里找不到定义却能通过构建。

// ── 1. 解析器差异清单：凡是「parser 看到 A、bash 执行 B」的结构全在这 ──
const HEREDOC_IN_SUBSTITUTION = /\$\(.*<</
// 注：这个正则只用来做**便宜的预筛**（第 318、522、590 行都靠它快速返回），
//     真正的判定在 isSafeHeredoc 里逐行做。用 `.*` 而不是 `[\s\S]*` 是故意的：
//     它不跨行，所以 `$(cat <<EOF` 但换行在中间的情况会漏掉 → 落回主链，安全方向。

// Note: Backtick pattern is handled separately in validateDangerousPatterns
// to distinguish between escaped and unescaped backticks
// 【核心清单】COMMAND_SUBSTITUTION_PATTERNS
//
// 每一条都对应一个「解析器只看得到字面量、shell 却会执行/展开」的语法。
// 它们的共同特征：不是「危险命令」，而是「危险结构」—— 哪怕命令本身完全无害，
// 只要结构能被展开成别的东西，权限判定的前提就崩了。
const COMMAND_SUBSTITUTION_PATTERNS = [
  { pattern: /<\(/, message: 'process substitution <()' },
  { pattern: />\(/, message: 'process substitution >()' },
  { pattern: /=\(/, message: 'Zsh process substitution =()' },
  // Zsh EQUALS expansion: =cmd at word start expands to $(which cmd).
  // `=curl evil.com` → `/usr/bin/curl evil.com`, bypassing Bash(curl:*) deny
  // rules since the parser sees `=curl` as the base command, not `curl`.
  // Only matches word-initial = followed by a command-name char (not VAR=val).
// 注：这条注释值得逐字读 —— 它写的是一个真实的权限绕过：
//       `=curl evil.com` 在 zsh 里展开成 `/usr/bin/curl evil.com`，
//       但 parser 看到的 base command 是 `=curl`，于是 `Bash(curl:*)` 的 deny
//       规则匹配不上。deny 被绕过，只剩 ask 兜底 —— 而 deny 的意义就是
//       「连问都不问，直接拒」。deny 失效 = 防线降级。
//
//     正则用 `(?:^|[\s;&|])=[a-zA-Z_]` 而不是裸 `=`，是为了不误伤
//     `VAR=value` —— 那种等号左边必须有名字，右边才是值。
  {
    pattern: /(?:^|[\s;&|])=[a-zA-Z_]/,
    message: 'Zsh equals expansion (=cmd)',
  },
  { pattern: /\$\(/, message: '$() command substitution' },
  { pattern: /\$\{/, message: '${} parameter substitution' },
  { pattern: /\$\[/, message: '$[] legacy arithmetic expansion' },
  { pattern: /~\[/, message: 'Zsh-style parameter expansion' },
  { pattern: /\(e:/, message: 'Zsh-style glob qualifiers' },
  { pattern: /\(\+/, message: 'Zsh glob qualifier with command execution' },
  {
    pattern: /\}\s*always\s*\{/,
    message: 'Zsh always block (try/always construct)',
  },
  // Defense in depth: Block PowerShell comment syntax even though we don't execute in PowerShell
// 注：`<#` 这条是「为未来上锁」。当前版本不执行 PowerShell，所以这个语法
//     根本不会被解释；但一旦哪天有人加了 PowerShell 执行路径，这条已经在了。
//     这种「防御性预埋」在安全代码里很常见，代价只是一次正则匹配。
  // Added as protection against future changes that might introduce PowerShell execution
  { pattern: /<#/, message: 'PowerShell comment syntax' },
]
// 注：注意这个数组**没有反引号**（`` ` ``）。不是漏了，是必须分开处理：
//     反引号要区分「转义过的」和「没转义的」，而 \` 在 SQL 里是合法字符
//     （`mysql -e "select \`id\` from t"`）。所以反引号走
//     hasUnescapedChar(unquotedContent, '`') 单独判（第 853 行）。

// ── 2. Zsh 模块黑名单：14 个能绕过权限模型的内建命令 ──
// Zsh-specific dangerous commands that can bypass security checks.
// These are checked against the base command (first word) of each command segment.
const ZSH_DANGEROUS_COMMANDS = new Set([
  // zmodload is the gateway to many dangerous module-based attacks:
// 注：`zmodload` 是总开关。zsh 的模块系统是「按需装载能力」，
//     装上 zsh/files 就得到一个内建的 rm/mv/ln/chmod —— 它们不经过
//     PATH 上的二进制，所以「按二进制名做权限检查」的模型直接失效。
  // zsh/mapfile (invisible file I/O via array assignment),
  // zsh/system (sysopen/syswrite two-step file access),
  // zsh/zpty (pseudo-terminal command execution),
  // zsh/net/tcp (network exfiltration via ztcp),
  // zsh/files (builtin rm/mv/ln/chmod that bypass binary checks)
  'zmodload',
  // emulate with -c flag is an eval-equivalent that executes arbitrary code
  'emulate',
  // Zsh module builtins that enable dangerous operations.
  // These require zmodload first, but we block them as defense-in-depth
  // in case zmodload is somehow bypassed or the module is pre-loaded.
  'sysopen', // Opens files with fine-grained control (zsh/system)
  'sysread', // Reads from file descriptors (zsh/system)
  'syswrite', // Writes to file descriptors (zsh/system)
  'sysseek', // Seeks on file descriptors (zsh/system)
  'zpty', // Executes commands on pseudo-terminals (zsh/zpty)
  'ztcp', // Creates TCP connections for exfiltration (zsh/net/tcp)
  'zsocket', // Creates Unix/TCP sockets (zsh/net/socket)
  'mapfile', // Not actually a command, but the associative array is set via zmodload
// 注：这一条是清单里唯一的「非命令」。
//     `mapfile` 不是一个可执行命令，而是 zmodload zsh/mapfile 之后得到的
//     一个关联数组：给 `mapfile[file]=content` 赋值就直接写文件，读它就读文件。
//     把它放进「base command 黑名单」里，实际永远匹配不到 —— 除非真有人
//     装了个叫 mapfile 的命令。它的作用是文档性的：提示审阅者「这里还有个洞」。
//
//     这是安全清单常见的形态：一部分是有效拦截，一部分是写给下一位维护者的备注。
  'zf_rm', // Builtin rm from zsh/files
  'zf_mv', // Builtin mv from zsh/files
  'zf_ln', // Builtin ln from zsh/files
  'zf_chmod', // Builtin chmod from zsh/files
  'zf_chown', // Builtin chown from zsh/files
  'zf_mkdir', // Builtin mkdir from zsh/files
  'zf_rmdir', // Builtin rmdir from zsh/files
  'zf_chgrp', // Builtin chgrp from zsh/files
])

// ── 3. 埋点 ID：为什么用数字而不是字符串 ──
// Numeric identifiers for bash security checks (to avoid logging strings)
const BASH_SECURITY_CHECK_IDS = {
// 注：注释只说「to avoid logging strings」，真实理由比这更具体 ——
//     这是**埋点基数控制**。logEvent 的每个不同值都是一个独立的时间序列，
//     如果用字符串 `'incomplete_commands'`，任何一次手误（拼错、大小写、
//     改了文案）都会凭空多出一个序列，几个月后看板上全是长尾噪音。
//     固定 23 个数字 + subId，基数上界就是几十，永远不会膨胀。
//
//     实测：这 23 个 ID 全部有使用点，没有一个定义了不用。
//     用得最多的是 OBFUSCATED_FLAGS（11 处），说明「用引号藏 flag」
//     是这个文件里最活跃的攻击面。
  INCOMPLETE_COMMANDS: 1,
  JQ_SYSTEM_FUNCTION: 2,
  JQ_FILE_ARGUMENTS: 3,
  OBFUSCATED_FLAGS: 4,
  SHELL_METACHARACTERS: 5,
  DANGEROUS_VARIABLES: 6,
  NEWLINES: 7,
  DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION: 8,
  DANGEROUS_PATTERNS_INPUT_REDIRECTION: 9,
  DANGEROUS_PATTERNS_OUTPUT_REDIRECTION: 10,
  IFS_INJECTION: 11,
  GIT_COMMIT_SUBSTITUTION: 12,
  PROC_ENVIRON_ACCESS: 13,
  MALFORMED_TOKEN_INJECTION: 14,
  BACKSLASH_ESCAPED_WHITESPACE: 15,
  BRACE_EXPANSION: 16,
  CONTROL_CHARACTERS: 17,
  UNICODE_WHITESPACE: 18,
  MID_WORD_HASH: 19,
  ZSH_DANGEROUS_COMMANDS: 20,
  BACKSLASH_ESCAPED_OPERATORS: 21,
  COMMENT_QUOTE_DESYNC: 22,
  QUOTED_NEWLINE: 23,
} as const

// ── 4. 六个视图：所有 validator 都不重新解析命令 ──
//
// 设计要点：22 个 validate* 函数没有一个去重新解析命令字符串。它们只读
// ValidationContext 里预先算好的几个字符串视图。这带来两个好处：
//   · 每个 validator 变成纯函数，好读、好测、不容易写出状态 bug
//   · 「剥引号」这种容易出错的逻辑只写一遍（extractQuotedContent）
// 代价是：视图一旦算错，22 个 validator 会一起错。所以第 128 行那个
// 状态机的正确性，比任何一个 validator 都重要。
type ValidationContext = {
  originalCommand: string
  baseCommand: string
  unquotedContent: string
  fullyUnquotedContent: string
  /** fullyUnquoted before stripSafeRedirections — used by validateBraceExpansion
   * to avoid false negatives from redirection stripping creating backslash adjacencies */
  fullyUnquotedPreStrip: string
// 注：`fullyUnquotedPreStrip` 与 `fullyUnquotedContent` 只差一道
//     stripSafeRedirections。为什么要留两个？
//     因为「剥掉 `>/dev/null`」这个动作会**删除字符**，删完可能造出原本
//     不存在的邻接关系。例：`cmd \>/dev/null` 剥掉后剩 `cmd \`，
//     看起来像合法的续行符，实际藏了第二条命令。
//     所以「判断换行」必须用 strip 之前的版本（第 910 行），
//     「判断重定向」才用 strip 之后的版本（第 876 行）。
  /** Like fullyUnquotedPreStrip but preserves quote characters ('/"): e.g.,
   * echo 'x'# → echo ''# (the quote chars remain, revealing adjacency to #) */
  unquotedKeepQuoteChars: string
// 注：`unquotedKeepQuoteChars` = 保留引号字符本身、删掉引号里的内容。
//     专门给 validateMidWordHash 用（第 1920 行）。没有它的话，
//     `'x'#` 剥完只剩 `#`，看起来是词首的注释；保留引号后是 `''#`，
//     一眼就能看出 `#` 前面紧挨着东西 —— 中缀 `#` 才是解析器差异。
  /** Tree-sitter analysis data, if available. Validators can use this for
   * more accurate analysis when present, falling back to regex otherwise. */
  treeSitter?: TreeSitterAnalysis | null
}

type QuoteExtraction = {
  withDoubleQuotes: string
  fullyUnquoted: string
  /** Like fullyUnquoted but preserves quote characters ('/"): strips quoted
   * content while keeping the delimiters. Used by validateMidWordHash to detect
   * quote-adjacent # (e.g., 'x'# where quote stripping would hide adjacency). */
  unquotedKeepQuoteChars: string
}

// ── 5. extractQuotedContent：三份视图，一次扫描 ──
//
// 这是整个文件的地基。它把一条命令变成三份「剥过引号的副本」：
//   withDoubleQuotes      去单引号内容，保留双引号内容   （调用方叫它 unquotedContent）
//   fullyUnquoted         两种引号内容都去掉
//   unquotedKeepQuoteChars 引号字符保留，引号内容去掉
//
// 命名有个坑：调用方把 withDoubleQuotes 赋给了 `unquotedContent`，
// 但它的语义是「双引号内容**还留着**」。判「会不会执行」时必须用它
// （双引号里的 $() 真会执行），判「命令结构」时才用 fullyUnquoted。
function extractQuotedContent(command: string, isJq = false): QuoteExtraction {
  let withDoubleQuotes = ''
  let fullyUnquoted = ''
  let unquotedKeepQuoteChars = ''
  let inSingleQuote = false
// 注：状态机只有三个布尔。这个极简结构在本文件里被复刻了 6 次
//     （第 693、980、1266、1550、1632、2011、2125 行），每次都必须
//     逐字写对 —— 一旦某个副本漏了 `!inSingleQuote` 这个 guard，
//     它的引号状态就会永久 desync，后续所有检测全部失效。
//     第 1280 行的长注释记录的就是这样一次 desync 的完整攻击链。
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (escaped) {
      escaped = false
      if (!inSingleQuote) withDoubleQuotes += char
      if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char
      if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char
      continue
    }

    if (char === '\\' && !inSingleQuote) {
// 注：`!inSingleQuote` 这个 guard 是全文件最容易漏的一处。
//     bash 里单引号内的一切都是字面量，包括反斜杠 —— `'\'` 是一个
//     反斜杠字符，不是「转义了收尾的引号」。
//     如果这里漏掉 guard：`\` 置 escaped=true，收尾的 `'` 被 escaped
//     分支吃掉而不翻转 inSingleQuote → 状态机永远停在「单引号内」→
//     后面所有检测全部跳过。攻击样本：`jq '\' "-f" evil`。
      escaped = true
      if (!inSingleQuote) withDoubleQuotes += char
      if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char
      if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      unquotedKeepQuoteChars += char
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      unquotedKeepQuoteChars += char
      // For jq, include quotes in extraction to ensure content is properly analyzed
// 注：jq 特例。jq 的程序本身就是用双引号包字符串的（`jq ".a | .b"`），
//     如果把双引号内容剥掉，剩下的 jq 程序就是空的，validateJqCommand
//     就什么都看不见了。所以对 jq 保留双引号内容 —— 让检测器能看到
//     被双引号包住的 `system("...")`。
      if (!isJq) continue
    }

    if (!inSingleQuote) withDoubleQuotes += char
    if (!inSingleQuote && !inDoubleQuote) fullyUnquoted += char
    if (!inSingleQuote && !inDoubleQuote) unquotedKeepQuoteChars += char
  }

  return { withDoubleQuotes, fullyUnquoted, unquotedKeepQuoteChars }
}

// ── 6. stripSafeRedirections：三条正则，每条都必须有尾边界 ──
function stripSafeRedirections(content: string): string {
  // SECURITY: All three patterns MUST have a trailing boundary (?=\s|$).
// 注：这段大写 SECURITY 注释是一个**真实 bug 的复盘**，值得逐字读。
//
//     假设去掉 `(?=\s|$)`：
//       `echo hi > /dev/nullo`
//     正则 `[012]?\s*>\s*/dev/null` 会把 `> /dev/null` 当成**前缀**匹配掉，
//     剩下 `echo hi o`。
//     然后 validateRedirections 去找 `>` —— 没了，放行。
//     而「写到 /dev/nullo」这个动作会走只读路径被**自动允许**
//     （checkReadOnlyConstraints 认为 /dev/null 系列是安全的）。
//     一次任意文件写入，零提示。
//
//     注释还点明了一处不对称：主流程有 checkPathConstraints 兜底
//     （它校验的是**原命令**，没被 strip 过），但 speculation.ts
//     只调 checkReadOnlyConstraints —— 那条路上没有兜底。
//     所以这个边界不是「保险」，是唯一防线。
  // Without it, `> /dev/nullo` matches `/dev/null` as a PREFIX, strips
  // `> /dev/null` leaving `o`, so `echo hi > /dev/nullo` becomes `echo hi o`.
  // validateRedirections then sees no `>` and passes. The file write to
  // /dev/nullo is auto-allowed via the read-only path (checkReadOnlyConstraints).
  // Main bashPermissions flow is protected (checkPathConstraints validates the
  // original command), but speculation.ts uses checkReadOnlyConstraints alone.
  return content
    .replace(/\s+2\s*>&\s*1(?=\s|$)/g, '')
    .replace(/[012]?\s*>\s*\/dev\/null(?=\s|$)/g, '')
    .replace(/\s*<\s*\/dev\/null(?=\s|$)/g, '')
}

// ── 7. hasUnescapedChar：只处理单字符，这是硬约束 ──
/**
 * Checks if content contains an unescaped occurrence of a single character.
 * Handles bash escape sequences correctly where a backslash escapes the following character.
 *
 * IMPORTANT: This function only handles single characters, not strings. If you need to extend
 * this to handle multi-character strings, be EXTREMELY CAREFUL about shell ANSI-C quoting
 * (e.g., $'\n', $'\x41', $'\u0041') which can encode arbitrary characters and strings in ways
 * that are very difficult to parse correctly. Incorrect handling could introduce security
 * vulnerabilities by allowing attackers to bypass security checks.
 *
 * @param content - The string to search (typically from extractQuotedContent)
 * @param char - Single character to search for (e.g., '`')
 * @returns true if unescaped occurrence found, false otherwise
 *
 * Examples:
 *   hasUnescapedChar("test \`safe\`", '`') → false (escaped backticks)
 *   hasUnescapedChar("test `dangerous`", '`') → true (unescaped backticks)
 *   hasUnescapedChar("test\\`date`", '`') → true (escaped backslash + unescaped backtick)
 */
// 注：这段 IMPORTANT 不是客套。多字符版本会立刻踩上 ANSI-C 引用：
//     `$'\n'` 是换行，`$'\x41'` 是 A，`$'\u0041'` 也是 A。
//     一个「查找未转义字符串」的函数如果声称支持多字符，
//     就必须先实现这套解码，否则 `$'\x3b'` 能绕过所有「找 `;`」的检测。
//     结论：宁可只支持单字符，也不要写一个半对的通用版本。
function hasUnescapedChar(content: string, char: string): boolean {
// 注：两个细节。
//     1) `i += 2` 一次跳过反斜杠和被转义字符 —— 这正确处理了奇偶：
//        `\\` 是转义的反斜杠，后面紧跟的字符是独立的。
//     2) 最后一个例子 `hasUnescapedChar("test\\`date`", '`') → true`：
//        `\\` 消耗成一对，然后反引号是裸的 → 真。
//        这个例子存在的意义是提醒：数反斜杠个数比「看起来有没有转义」可靠。
  if (char.length !== 1) {
    throw new Error('hasUnescapedChar only works with single characters')
  }

  let i = 0
  while (i < content.length) {
    // If we see a backslash, skip it and the next character (they form an escape sequence)
    if (content[i] === '\\' && i + 1 < content.length) {
      i += 2 // Skip backslash and escaped character
      continue
    }

    // Check if current character matches
    if (content[i] === char) {
      return true // Found unescaped occurrence
    }

    i++
  }

  return false // No unescaped occurrences found
}

// ═══ 8. 早期 validator ═══
// 这一组（validateEmpty / validateIncompleteCommands / validateSafeCommandSubstitution
// / validateGitCommit）在主链**之前**跑，它们可以 return allow。
// 但注意第 2317 行：allow 会被调用方**降级成 passthrough**。原因见那儿。
function validateEmpty(context: ValidationContext): PermissionResult {
  if (!context.originalCommand.trim()) {
    return {
      behavior: 'allow',
      updatedInput: { command: context.originalCommand },
      decisionReason: { type: 'other', reason: 'Empty command is safe' },
    }
  }
  return { behavior: 'passthrough', message: 'Command is not empty' }
}

function validateIncompleteCommands(
// 注：三条都是「这条命令像个片段，不像完整命令」：
//       以 Tab 开头        —— 从别人的缩进代码里复制出来的
//       以 `-` 开头        —— 只剩 flag，命令名丢了
//       以 && || ; > < 开头 —— 续行被单独提交了
//
//     为什么这算安全问题？因为 prompt injection 常这么干：
//     让模型只输出后半截，拼到用户已有的命令后面。用户看到的是一条，
//     实际执行的是两条。所以「片段」本身就要问一声。
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context
  const trimmed = originalCommand.trim()

  if (/^\s*\t/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message: 'Command appears to be an incomplete fragment (starts with tab)',
    }
  }

  if (trimmed.startsWith('-')) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message:
        'Command appears to be an incomplete fragment (starts with flags)',
    }
  }

  if (/^\s*(&&|\|\||;|>>?|<)/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.INCOMPLETE_COMMANDS,
      subId: 3,
    })
    return {
      behavior: 'ask',
      message:
        'Command appears to be a continuation line (starts with operator)',
    }
  }

  return { behavior: 'passthrough', message: 'Command appears complete' }
}

// ═══ 9. isSafeHeredoc：全文件最危险的一个函数 ═══
//
// 危险在哪：它返回 true，validateSafeCommandSubstitution 就 return allow，
// 而 allow 在调用方会让 bashCommandIsSafe **直接 passthrough** ——
// 后面的 18 个 validator 一个都不跑。
//
// 所以注释写的是 "must be PROVABLY safe, not 'probably safe'"。
// 这句话是这个函数全部设计的理由：它不是「我判断它大概安全」，
// 而是「我能证明它只可能是这一种形态，其余一律 false」。
/**
 * Checks if a command is a "safe" heredoc-in-substitution pattern that can
 * bypass the generic $() validator.
 *
 * This is an EARLY-ALLOW path: returning `true` causes bashCommandIsSafe to
 * return `passthrough`, bypassing ALL subsequent validators. Given this
 * authority, the check must be PROVABLY safe, not "probably safe".
 *
 * The only pattern we allow is:
 *   [prefix] $(cat <<'DELIM'\n
 *   [body lines]\n
 *   DELIM\n
 *   ) [suffix]
 *
 * Where:
 * - The delimiter must be single-quoted ('DELIM') or escaped (\DELIM) so the
 *   body is literal text with no expansion
 * - The closing delimiter must be on a line BY ITSELF (or with only trailing
 *   whitespace + `)` for the $(cat <<'EOF'\n...\nEOF)` inline form)
 * - The closing delimiter must be the FIRST such line — matching bash's
 *   behavior exactly (no skipping past early delimiters to find EOF))
 * - There must be non-whitespace text BEFORE the $( (i.e., the substitution
 *   is used in argument position, not as a command name). Otherwise the
 *   heredoc body becomes an arbitrary command name with [suffix] as args.
 * - The remaining text (with the heredoc stripped) must pass all validators
 *
 * This implementation uses LINE-BASED matching, not regex [\s\S]*?, to
 * precisely replicate bash's heredoc-closing behavior.
 */
function isSafeHeredoc(command: string): boolean {
  if (!HEREDOC_IN_SUBSTITUTION.test(command)) return false

  // SECURITY: Use [ \t] (not \s) between << and the delimiter. \s matches
  // newlines, but bash requires the delimiter word on the same line as <<.
  // Matching across newlines could accept malformed syntax that bash rejects.
  // Handle quote variations: 'EOF', ''EOF'' (splitCommand may mangle quotes).
  const heredocPattern =
    /\$\(cat[ \t]*<<(-?)[ \t]*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/g
  let match
  type HeredocMatch = {
    start: number
    operatorEnd: number
    delimiter: string
    isDash: boolean
  }
  const safeHeredocs: HeredocMatch[] = []

  while ((match = heredocPattern.exec(command)) !== null) {
    const delimiter = match[2] || match[3]
    if (delimiter) {
      safeHeredocs.push({
        start: match.index,
        operatorEnd: match.index + match[0].length,
        delimiter,
        isDash: match[1] === '-',
      })
    }
  }

  // If no safe heredoc patterns found, it's not safe
  if (safeHeredocs.length === 0) return false

  // SECURITY: For each heredoc, find the closing delimiter using LINE-BASED
  // matching that exactly replicates bash's behavior. Bash closes a heredoc
  // at the FIRST line that exactly matches the delimiter. Any subsequent
  // occurrence of the delimiter is just content (or a new command). Regex
  // [\s\S]*? can skip past the first delimiter to find a later `DELIM)`
// 注：唯一被允许的形态就这一种。逐条拆开看它约束了什么：
//       前缀            必须有（不能在命令名位置）
//       $(cat <<'DELIM'  必须 cat，必须引号/转义分隔符
//       body            字面量文本（因为分隔符被引号了，不展开）
//       DELIM)          闭合分隔符必须独占一行
//       后缀            可选，但过完剥离后必须全部无害
//
//     为什么单拎出 heredoc？因为它是唯一「看起来像注入、实际是数据」的语法。
//     用户天天写 `git commit -m "$(cat <<'EOF' ... EOF)"`，
//     而 `$(` 在 COMMAND_SUBSTITUTION_PATTERNS 里是一律 ask 的。
//     不特判的话，每次多行提交信息都要弹窗。
// 注：`[ \t]` 而不是 `\s`。\s 包含 `\n`，但 bash 要求 heredoc 的分隔符
//     词必须和 `<<` 在**同一行**。允许跨行匹配，就等于接受一段 bash
//     会拒绝的语法 —— 而「我们接受、bash 拒绝」正是所有绕过的前提。
// 注：这里解释了为什么不用 `[\s\S]*?`。
//
//     正则的懒惰匹配会「跳过第一个 DELIM，去找后面某个 DELIM)」：
//       $(cat <<'EOF'
//       data
//       EOF
//       ; rm -rf /
//       EOF)
//     懒惰匹配能一路找到最后的 `EOF)`，把中间的 `; rm -rf /` 当成 body。
//     但 bash 在第 3 行的 EOF 就闭合了，`rm -rf /` 是真执行的命令。
//
//     所以必须逐行扫，找到**第一个**恰好等于分隔符的行就停 —— 精确复刻
//     bash 的行为。这也是这段代码不能换成一行正则的原因。
  // pattern, hiding injected commands between the two delimiters.
  type VerifiedHeredoc = { start: number; end: number }
  const verified: VerifiedHeredoc[] = []

  for (const { start, operatorEnd, delimiter, isDash } of safeHeredocs) {
    // The opening line must end immediately after the delimiter (only
    // horizontal whitespace allowed before the newline). If there's other
    // content (like `; rm -rf /`), this is not a simple safe heredoc.
    const afterOperator = command.slice(operatorEnd)
    const openLineEnd = afterOperator.indexOf('\n')
    if (openLineEnd === -1) return false // No content at all
    const openLineTail = afterOperator.slice(0, openLineEnd)
    if (!/^[ \t]*$/.test(openLineTail)) return false // Extra content on open line

    // Body starts after the newline
    const bodyStart = operatorEnd + openLineEnd + 1
    const body = command.slice(bodyStart)
    const bodyLines = body.split('\n')

    // Find the FIRST line that closes the heredoc. There are two valid forms:
    //   1. `DELIM` alone on a line (bash-standard), followed by `)` on the
// 注：两种合法闭合形式，都来自 bash 解析器的真实行为：
//       1) DELIM 独占一行，`)` 在下一行行首
//       2) DELIM) 同一行（bash 的 PST_EOFTOKEN 会同时闭合 heredoc 和替换）
//     第 2 种是 `$(cat <<'EOF'\n...\nEOF)` 这种「右括号跟着分隔符」的写法，
//     没有它的话，最常见的写法都会被拒。
    //      next line (with only whitespace before it)
    //   2. `DELIM)` on a line (the inline $(cat <<'EOF'\n...\nEOF) form,
    //      where bash's PST_EOFTOKEN closes both heredoc and substitution)
    // For <<-, leading tabs are stripped before matching.
    let closingLineIdx = -1
    let closeParenLineIdx = -1 // Line index where `)` appears
    let closeParenColIdx = -1 // Column index of `)` on that line

    for (let i = 0; i < bodyLines.length; i++) {
      const rawLine = bodyLines[i]!
      const line = isDash ? rawLine.replace(/^\t*/, '') : rawLine

      // Form 1: delimiter alone on a line
      if (line === delimiter) {
        closingLineIdx = i
        // The `)` must be on the NEXT line with only whitespace before it
        const nextLine = bodyLines[i + 1]
        if (nextLine === undefined) return false // No closing `)`
        const parenMatch = nextLine.match(/^([ \t]*)\)/)
        if (!parenMatch) return false // `)` not at start of next line
        closeParenLineIdx = i + 1
        closeParenColIdx = parenMatch[1]!.length // Position of `)`
        break
      }

      // Form 2: delimiter immediately followed by `)` (PST_EOFTOKEN form)
      // Only whitespace allowed between delimiter and `)`.
      if (line.startsWith(delimiter)) {
        const afterDelim = line.slice(delimiter.length)
        const parenMatch = afterDelim.match(/^([ \t]*)\)/)
        if (parenMatch) {
          closingLineIdx = i
          closeParenLineIdx = i
          // Column is in rawLine (pre-tab-strip), so recompute
          const tabPrefix = isDash ? (rawLine.match(/^\t*/)?.[0] ?? '') : ''
          closeParenColIdx =
            tabPrefix.length + delimiter.length + parenMatch[1]!.length
          break
        }
        // Line starts with delimiter but has other trailing content —
        // this is NOT the closing line (bash requires exact match or EOF`)`).
        // But it's also a red flag: if this were inside $(), bash might
        // close early via PST_EOFTOKEN with other shell metacharacters.
        // We already handle that case in extractHeredocs — here we just
        // reject it as not matching our safe pattern.
        if (/^[)}`|&;(<>]/.test(afterDelim)) {
// 注：这一条是「分隔符后面跟着 shell 元字符」—— 说明这一行不是干净的
//     闭合行，而是 `EOF)` 之后接了别的东西。宁可 return false 落回主链，
//     也不要去猜 bash 会怎么处理。这类「遇到歧义就退出」的判断，
//     在本函数里出现了 8 次，是这个函数能被称为 "PROVABLY safe" 的原因。
          return false // Ambiguous early-closure pattern
        }
      }
    }

    if (closingLineIdx === -1) return false // No closing delimiter found

    // Compute the absolute end position (one past the `)` character)
    let endPos = bodyStart
    for (let i = 0; i < closeParenLineIdx; i++) {
      endPos += bodyLines[i]!.length + 1 // +1 for newline
    }
    endPos += closeParenColIdx + 1 // +1 to include the `)` itself

    verified.push({ start, end: endPos })
  }

  // SECURITY: Reject nested matches. The regex finds $(cat <<'X' patterns
// 注：嵌套检测，理由值得单独讲 —— 这是一个「修 bug 引入的 bug」的复盘。
//
//     前提：外层 heredoc 用引号分隔符（<<'A'）时，body 在 bash 里是**字面量**。
//     所以 body 里写 `$(cat <<'B'` 只是一串字符，不是真 heredoc。
//     但第 324 行那个正则是在**原始文本**上跑的，两个都会匹配 → 得到嵌套区间。
//
//     然后剥离时会出事：先剥内层，外层区间的 `end` 就过期了（指向缩短后的
//     字符串之外）→ `remaining.slice(end)` 返回空串 → **外层之后的后缀
//     静默消失**。后缀里就可能是 `; rm -rf /`。
//
//     处理方式不是「算对嵌套」，而是直接 return false 落回主链 ——
//     因为合法的 heredoc 里根本不会出现嵌套（body 是字面量，没人会这么写），
//     所以「遇到嵌套就当不安全」不会误伤真实用户。
  // in RAW TEXT without understanding quoted-heredoc semantics. When the
  // outer heredoc has a quoted delimiter (<<'A'), its body is LITERAL text
  // in bash — any inner $(cat <<'B' is just characters, not a real heredoc.
  // But our regex matches both, producing NESTED ranges. Stripping nested
  // ranges corrupts indices: after stripping the inner range, the outer
  // range's `end` is stale (points past the shrunken string), causing
  // `remaining.slice(end)` to return '' and silently drop any suffix
  // (e.g., `; rm -rf /`). Since all our matched heredocs have quoted/escaped
  // delimiters, a nested match inside the body is ALWAYS literal text —
  // no legitimate user writes this pattern. Bail to safe fallback.
  for (const outer of verified) {
    for (const inner of verified) {
      if (inner === outer) continue
      if (inner.start > outer.start && inner.start < outer.end) {
        return false
      }
    }
  }

  // Strip all verified heredocs from the command, building `remaining`.
  // Process in reverse order so earlier indices stay valid.
  const sortedVerified = [...verified].sort((a, b) => b.start - a.start)
  let remaining = command
  for (const { start, end } of sortedVerified) {
    remaining = remaining.slice(0, start) + remaining.slice(end)
  }

  // SECURITY: The remaining text must NOT start with only whitespace before
// 注：这一段防的是「命令名位置」。
//
//       $(cat <<'EOF'
//       chmod
//       EOF
//       ) 777 /etc/shadow
//
//     heredoc 在**参数位置**时，body 只是数据；但在**命令名位置**时，
//     body 变成要执行的命令名，后面的后缀变成它的参数。
//     上面这条在 bash 里等价于 `chmod 777 /etc/shadow`。
//
//     判据：剥掉 heredoc 后，如果还有剩余文本，那么原命令在第一个 `$(`
//     之前也必须有非空白文本 —— 证明这个 `$(` 是参数，不是命令。
  // the (now-stripped) heredoc position IF there's non-whitespace after it.
  // If the $() is in COMMAND-NAME position (no prefix), its output becomes
  // the command to execute, with any suffix text as arguments:
  //   $(cat <<'EOF'\nchmod\nEOF\n) 777 /etc/shadow
  //   → runs `chmod 777 /etc/shadow`
  // We only allow the substitution in ARGUMENT position: there must be a
  // command word before the $(.
  // After stripping, `remaining` should look like `cmd args... [more args]`.
  // If remaining starts with only whitespace (or is empty), the $() WAS the
  // command — that's only safe if there are no trailing arguments.
  const trimmedRemaining = remaining.trim()
  if (trimmedRemaining.length > 0) {
    // There's a prefix command — good. But verify the original command
    // also had a non-whitespace prefix before the FIRST $( (the heredoc
    // could be one of several; we need the first one's prefix).
    const firstHeredocStart = Math.min(...verified.map(v => v.start))
    const prefix = command.slice(0, firstHeredocStart)
    if (prefix.trim().length === 0) {
      // $() is in command-name position but there's trailing text — UNSAFE.
      // The heredoc body becomes the command name, trailing text becomes args.
      return false
    }
  }

  // Check that remaining text contains only safe characters.
  // After stripping safe heredocs, the remaining text should only be command
  // names, arguments, quotes, and whitespace. Reject ANY shell metacharacter
  // to prevent operators (|, &, &&, ||, ;) or expansions ($, `, {, <, >) from
  // being used to chain dangerous commands after a safe heredoc.
  // SECURITY: Use explicit ASCII space/tab only — \s matches unicode whitespace
// 注：字符白名单只有 `a-zA-Z0-9 \t"'.-/_@=,:+~`。
//     显式写 ` \t` 而不用 `\s`：\s 会匹配 `\u00A0`（不换行空格）这类
//     unicode 空白，而 bash 的 IFS 里没有它们 —— 那又是一个解析器差异。
//     这里的原则是：**只放行确定无害的字节**，其余全部落回主链。
  // like \u00A0 which can be used to hide content. Newlines are also blocked
  // (they would indicate multi-line commands outside the heredoc body).
  if (!/^[a-zA-Z0-9 \t"'.\-/_@=,:+~]*$/.test(remaining)) return false

  // SECURITY: The remaining text (command with heredocs stripped) must also
// 注：最后一道 —— 剥掉 heredoc 之后的剩余文本，还要再跑一遍完整的
//     bashCommandIsSafe。理由注释写得很清楚：
//       `zmodload zsh/system $(cat <<'EOF'\nx\nEOF\n)`
//     前半段是 zsh 危险命令，但因为整条命令命中了「安全 heredoc」的形态，
//     early-allow 会让 validateZshDangerousCommands **永远不跑**。
//
//     递归风险：remaining 里已经没有 `$(` + `<<` 的组合，所以递归进去
//     的 validateSafeCommandSubstitution 立刻返回 passthrough，一层就到底。
  // pass all security validators. Without this, appending a safe heredoc to a
  // dangerous command (e.g., `zmodload zsh/system $(cat <<'EOF'\nx\nEOF\n)`)
  // causes this early-allow path to return passthrough, bypassing
  // validateZshDangerousCommands, validateProcEnvironAccess, and any other
  // main validator that checks allowlist-safe character patterns.
  // No recursion risk: `remaining` has no `$(... <<` pattern, so the recursive
  // call's validateSafeCommandSubstitution returns passthrough immediately.
  if (bashCommandIsSafe_DEPRECATED(remaining).behavior !== 'passthrough')
    return false

  return true
}

// ═══ 10. stripSafeHeredocSubstitutions：和上面几乎一样，但用途不同 ═══
//
// isSafeHeredoc 回答「这条命令能不能被证明安全」，它会 return allow。
// 这个函数只做一件事：把安全的 heredoc 片段**挖掉**，返回剩下的字符串，
// 交给调用方再检查一遍剩余部分。
//
// 调用点在 bashPermissions.ts:2100 —— 那里处理的是一个很尴尬的场景：
// 整条命令因为含 `$(` 被判为 misparsing，但原因可能只是那个合法的 heredoc。
// 挖掉 heredoc 再查剩余部分，就能区分「只有 heredoc 可疑」和「heredoc 之外还有问题」。
/**
 * Detects well-formed $(cat <<'DELIM'...DELIM) heredoc substitution patterns.
 * Returns the command with matched heredocs stripped, or null if none found.
 * Used by the pre-split gate to strip safe heredocs and re-check the remainder.
 */
export function stripSafeHeredocSubstitutions(command: string): string | null {
  if (!HEREDOC_IN_SUBSTITUTION.test(command)) return null

  const heredocPattern =
    /\$\(cat[ \t]*<<(-?)[ \t]*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/g
  let result = command
  let found = false
  let match
  const ranges: Array<{ start: number; end: number }> = []
  while ((match = heredocPattern.exec(command)) !== null) {
    if (match.index > 0 && command[match.index - 1] === '\\') continue
    const delimiter = match[2] || match[3]
    if (!delimiter) continue
    const isDash = match[1] === '-'
    const operatorEnd = match.index + match[0].length

    const afterOperator = command.slice(operatorEnd)
    const openLineEnd = afterOperator.indexOf('\n')
    if (openLineEnd === -1) continue
    if (!/^[ \t]*$/.test(afterOperator.slice(0, openLineEnd))) continue

    const bodyStart = operatorEnd + openLineEnd + 1
    const bodyLines = command.slice(bodyStart).split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      const rawLine = bodyLines[i]!
      const line = isDash ? rawLine.replace(/^\t*/, '') : rawLine
      if (line.startsWith(delimiter)) {
// 注：这里用 `line.startsWith(delimiter)`，而 isSafeHeredoc 第 389 行用的是
//     `line === delimiter`。两个函数对「分隔符后面还有内容」的处理不一致：
//       · isSafeHeredoc 严格（必须完全相等，或有 `)` 紧跟）
//       · 这里宽松（只要以分隔符开头就认）
//
//     这不是 bug，但确实是两份必须同步维护的相似逻辑。改动其中一个之前
//     先读另一个，否则会出现「一个说安全、另一个说可剥离」的分裂。
//     这类重复是本文件最大的维护成本（2592 行里，heredoc 解析做了两遍）。
        const after = line.slice(delimiter.length)
        let closePos = -1
        if (/^[ \t]*\)/.test(after)) {
          const lineStart =
            bodyStart +
            bodyLines.slice(0, i).join('\n').length +
            (i > 0 ? 1 : 0)
          closePos = command.indexOf(')', lineStart)
        } else if (after === '') {
          const nextLine = bodyLines[i + 1]
          if (nextLine !== undefined && /^[ \t]*\)/.test(nextLine)) {
            const nextLineStart =
              bodyStart + bodyLines.slice(0, i + 1).join('\n').length + 1
            closePos = command.indexOf(')', nextLineStart)
          }
        }
        if (closePos !== -1) {
          ranges.push({ start: match.index, end: closePos + 1 })
          found = true
        }
        break
      }
    }
  }
  if (!found) return null
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!
    result = result.slice(0, r.start) + result.slice(r.end)
  }
  return result
}

/** Detection-only check: does the command contain a safe heredoc substitution? */
export function hasSafeHeredocSubstitution(command: string): boolean {
  return stripSafeHeredocSubstitutions(command) !== null
}

// ═══ 11. validateSafeCommandSubstitution：把 allow 交给上层降级 ═══
function validateSafeCommandSubstitution(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  if (!HEREDOC_IN_SUBSTITUTION.test(originalCommand)) {
    return { behavior: 'passthrough', message: 'No heredoc in substitution' }
  }

  if (isSafeHeredoc(originalCommand)) {
    return {
      behavior: 'allow',
      updatedInput: { command: originalCommand },
      decisionReason: {
        type: 'other',
        reason:
          'Safe command substitution: cat with quoted/escaped heredoc delimiter',
      },
    }
  }

  return {
    behavior: 'passthrough',
    message: 'Command substitution needs validation',
  }
}

// ═══ 12. validateGitCommit：一条专用快速通道，四个 bail-out ═══
//
// 为什么需要它：`git commit -m "..."` 是最常见的合法命令之一，
// 而提交信息里经常有 `$`、反引号、双引号、括号 —— 会连续触发
// validateDangerousPatterns、validateShellMetacharacters 等一堆 ask。
// 每个都要用户点一次确认，体验崩坏。
//
// 所以给这一种形态开快速通道。但它必须**证明**自己没漏：
// 任何一个不确定的信号，都要 bail 回主链（passthrough），而不是猜。
function validateGitCommit(context: ValidationContext): PermissionResult {
  const { originalCommand, baseCommand } = context

  if (baseCommand !== 'git' || !/^git\s+commit\s+/.test(originalCommand)) {
    return { behavior: 'passthrough', message: 'Not a git commit' }
  }

  // SECURITY: Backslashes can cause our regex to mis-identify quote boundaries
// 注：bail-out ①：含反斜杠就整条交给主链。
//     理由：下面那条正则靠 `(["'])([\s\S]*?)\1` 找引号对，
//     而 `\"` 会让「引号边界」判断错位：
//       git commit -m "test\"msg" && evil
//     正则以为 `"test\"` 是完整的引号对，剩下的 `msg" && evil` 是余量。
//     合法提交信息几乎不会含反斜杠，所以直接放弃识别是最优解。
  // (e.g., `git commit -m "test\"msg" && evil`). Legitimate commit messages
  // virtually never contain backslashes, so bail to the full validator chain.
  if (originalCommand.includes('\\')) {
    return {
      behavior: 'passthrough',
      message: 'Git commit contains backslash, needs full validation',
    }
  }

  // SECURITY: The `.*?` before `-m` must NOT match shell operators. Previously
// 注：bail-out ② 的历史注释 —— 一次真实漏洞的逐行复盘。
//
//     原来的正则是 `git\s+commit\s+.*?-m\s+...`，其中 `.*?` 除了换行
//     什么都匹配，包括 `;`、`&`、`|`、反引号、`$(`。
//     于是 `git commit ; curl evil.com -m 'x'` 里，`.*?` 把
//     `; curl evil.com ` 整段吞掉，remainder 变成空串（falsy）→
//     后面的 remainder 检查被跳过 → 返回 **allow**。
//
//     而 early-allow 会跳过全部主 validator（第 1908 行附近），
//     等于 validateQuotedNewline、validateBackslashEscapedOperators
//     这些全部失效。
//
//     注释里那句话是全文的价值观：
//     "early-allow is a POSITIVE ASSERTION that the FULL command is safe"
//     —— 它断言的是「整条命令」，不是「我认识的那部分」。
//
//     修法两层：
//       · `[^;&|`$<>()\n\r]*?` 把 shell 元字符排除在 `.*?` 之外
//       · `[ \t]+` 代替 `\s+`，因为 \s 含 \n / \r，而它们是命令分隔符
  // `.*?` matched anything except `\n`, including `;`, `&`, `|`, `` ` ``, `$(`.
  // For `git commit ; curl evil.com -m 'x'`, `.*?` swallowed `; curl evil.com `
  // leaving remainder=`` (falsy → remainder check skipped) → returned `allow`
  // for a compound command. Early-allow skips ALL main validators (line ~1908),
  // nullifying validateQuotedNewline, validateBackslashEscapedOperators, etc.
  // While splitCommand currently catches this downstream, early-allow is a
  // POSITIVE ASSERTION that the FULL command is safe — which it is NOT.
  //
  // Also: `\s+` between `git` and `commit` must NOT match `\n`/`\r` (command
  // separators in bash). Use `[ \t]+` for horizontal-only whitespace.
  //
  // The `[^;&|`$<>()\n\r]*?` class excludes shell metacharacters. We also
  // exclude `<` and `>` here (redirects) — they're allowed in the REMAINDER
  // for `--author="Name <email>"` but must not appear BEFORE `-m`.
  const messageMatch = originalCommand.match(
    /^git[ \t]+commit[ \t]+[^;&|`$<>()\n\r]*?-m[ \t]+(["'])([\s\S]*?)\1(.*)$/,
  )

  if (messageMatch) {
    const [, quote, messageContent, remainder] = messageMatch

    if (quote === '"' && messageContent && /\$\(|`|\$\{/.test(messageContent)) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.GIT_COMMIT_SUBSTITUTION,
        subId: 1,
      })
      return {
        behavior: 'ask',
        message: 'Git commit message contains command substitution patterns',
      }
    }

    // SECURITY: Check remainder for shell operators that could chain commands
// 注：bail-out ③：余量里出现 `;|&()`、`$(`、`${` → 交回主链。
//     `.*?` 会吞掉 `--amend` 这类 flag，剩下的就是真正危险的部分。
    // or redirect output. The `.*` before `-m` in the regex can swallow flags
    // like `--amend`, leaving `&& evil` or `> ~/.bashrc` in the remainder.
    // Previously we only checked for $() / `` / ${} here, missing operators
    // like ; | & && || < >.
    //
    // `<` and `>` can legitimately appear INSIDE quotes in --author values
    // like `--author="Name <email>"`. An UNQUOTED `>` is a shell redirect
    // operator. Because validateGitCommit is an EARLY validator, returning
    // `allow` here short-circuits bashCommandIsSafe and SKIPS
    // validateRedirections. So we must bail to passthrough on unquoted `<>`
    // to let the main validators handle it.
    //
    // Attack: `git commit --allow-empty -m 'payload' > ~/.bashrc`
// 注：bail-out ④ 的攻击链，注释里写得最完整，值得完整读一遍：
//
//       git commit --allow-empty -m 'payload' > ~/.bashrc
//
//     `>` 没被 ③ 拦住（③ 只查 `;|&()`），于是走到这里。
//     如果这里 return allow：
//       · bashCommandIsSafe 短路 → validateRedirections **永不运行**
//       · 用户的 .bashrc 被 git 的 stdout 覆盖成 `payload`
//       · 下次登录 shell → RCE
//
//     关键区分：`--author="Name <email>"` 里的 `<>` 在引号内，是字面量；
//     未引号的 `<>` 才是重定向。所以要先剥引号再查 `<` `>`。
//
//     注释里还自己交代了这个引号追踪器的局限：它没有反斜杠处理，
//     `\'` 会让它 desync。但它指出「第 622 行已经对任何反斜杠 bail 了，
//     所以走到这里就一定没有反斜杠」—— 于是简单翻转就是正确的。
//     这种「靠上游保证」的推理是对的，但很脆：一旦 622 行的 bail 被删，
//     这里立刻出错，而且不会有任何测试报错。
    //   validateGitCommit returns allow → bashCommandIsSafe short-circuits →
    //   validateRedirections NEVER runs → ~/.bashrc overwritten with git
    //   stdout containing `payload` → RCE on next shell login.
    if (remainder && /[;|&()`]|\$\(|\$\{/.test(remainder)) {
      return {
        behavior: 'passthrough',
        message: 'Git commit remainder contains shell metacharacters',
      }
    }
    if (remainder) {
      // Strip quoted content, then check for `<` or `>`. Quoted `<>` (email
      // brackets in --author) are safe; unquoted `<>` are shell redirects.
      // NOTE: This simple quote tracker has NO backslash handling. `\'`/`\"`
      // outside quotes would desync it (bash: \' = literal ', tracker: toggles
      // SQ). BUT line 584 already bailed on ANY backslash in originalCommand,
      // so we never reach here with backslashes. For backslash-free input,
      // simple quote toggling is correct (no way to escape quotes without \\).
      let unquoted = ''
      let inSQ = false
      let inDQ = false
      for (let i = 0; i < remainder.length; i++) {
        const c = remainder[i]
        if (c === "'" && !inDQ) {
          inSQ = !inSQ
          continue
        }
        if (c === '"' && !inSQ) {
          inDQ = !inDQ
          continue
        }
        if (!inSQ && !inDQ) unquoted += c
      }
      if (/[<>]/.test(unquoted)) {
        return {
          behavior: 'passthrough',
          message: 'Git commit remainder contains unquoted redirect operator',
        }
      }
    }

    // Security hardening: block messages starting with dash
// 注：`-m "---"` 这种「引号里以 dash 开头」的内容，是用来混淆
//     「flag 边界在哪」的。合法提交信息里不会有以 `-` 开头的消息。
    // This catches potential obfuscation patterns like git commit -m "---"
    if (messageContent && messageContent.startsWith('-')) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
        subId: 5,
      })
      return {
        behavior: 'ask',
        message: 'Command contains quoted characters in flag names',
      }
    }

    return {
// 注：终于到 allow。注意它返回的是**完整的 allow**（带 updatedInput），
//     但调用方会把它降级成 passthrough —— 所以这个 updatedInput 实际
//     没人用，是纯粹的死数据。见第 2317 行。
      behavior: 'allow',
      updatedInput: { command: originalCommand },
      decisionReason: {
        type: 'other',
        reason: 'Git commit with simple quoted message is allowed',
      },
    }
  }

  return { behavior: 'passthrough', message: 'Git commit needs validation' }
}

// ═══ 13. validateJqCommand：jq 是「图灵完备的查询语言」，不是过滤器 ═══
//
// jq 能读文件、能调 system()、能加载外部库 —— 它本质上是个小型脚本引擎。
// 所以对它的检查不是「命令危不危险」，而是「这个参数会不会让 jq 变成解释器」。
function validateJqCommand(context: ValidationContext): PermissionResult {
  const { originalCommand, baseCommand } = context

  if (baseCommand !== 'jq') {
    return { behavior: 'passthrough', message: 'Not jq' }
  }

  if (/\bsystem\s*\(/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.JQ_SYSTEM_FUNCTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'jq command contains system() function which executes arbitrary commands',
    }
  }

  // File arguments are now allowed - they will be validated by path validation in readOnlyValidation.ts
// 注：这句注释记录了一次**职责移交**：
//     以前这里连「jq 读文件」都拦，后来改成只拦危险 flag，
//     把「读哪个文件」的判断交给 readOnlyValidation.ts 的路径校验。
//
//     这是对的方向（一处负责一件事），但代价是：这个 validator 现在
//     不能再声称「jq 命令在这里是安全的」。它只能说「jq 的**参数形态**没问题」。
//     读什么文件，得靠下游那道从来没被绕过的路径校验。
  // Only block dangerous flags that could read files into jq variables
  const afterJq = originalCommand.substring(3).trim()
// 注：`substring(3)` 硬编码跳过 `jq ` 三个字符。它依赖两个前提：
//       · baseCommand === 'jq'（第 745 行刚校验过）
//       · 命令恰好以 `jq ` 开头
//     如果命令是 `  jq -f x`（前导空格），baseCommand 会是 `''`（因为
//     `split(' ')[0]` 取到空串）→ 第 745 行直接 passthrough，根本走不到这。
//     所以这段代码「安全但不通用」：它只处理最规整的那种写法。
  if (
    /(?:^|\s)(?:-f\b|--from-file|--rawfile|--slurpfile|-L\b|--library-path)/.test(
      afterJq,
    )
  ) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.JQ_FILE_ARGUMENTS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'jq command contains dangerous flags that could execute code or read arbitrary files',
    }
  }

  return { behavior: 'passthrough', message: 'jq command is safe' }
}

// ═══ 14. validateShellMetacharacters：引号里的 `;&|` ═══
//
// 这一组专治「参数里带 shell 操作符」的合法写法：
//   find . -name "a;b.txt"
//   grep -regex "x|y" file
// 这些在 bash 里是字面量（引号保护），但下游工具可能把它当分隔符/正则。
// 三个子检查都是 ask，不是 deny —— 因为真假参半，交给用户判断。
function validateShellMetacharacters(
  context: ValidationContext,
): PermissionResult {
  const { unquotedContent } = context
  const message =
    'Command contains shell metacharacters (;, |, or &) in arguments'

  if (/(?:^|\s)["'][^"']*[;&][^"']*["'](?:\s|$)/.test(unquotedContent)) {
// 注：用的是 `unquotedContent`（= withDoubleQuotes，双引号内容**保留**）。
//     为什么不是 fullyUnquoted？因为要检测的恰恰是「引号包着 `;`」，
//     全剥掉就什么都看不见了。
//     这也是第 103 行那六个视图命名的坑：叫 unquoted 的东西其实留着双引号。
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
      subId: 1,
    })
    return { behavior: 'ask', message }
  }

  const globPatterns = [
    /-name\s+["'][^"']*[;|&][^"']*["']/,
    /-path\s+["'][^"']*[;|&][^"']*["']/,
    /-iname\s+["'][^"']*[;|&][^"']*["']/,
  ]

  if (globPatterns.some(p => p.test(unquotedContent))) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
      subId: 2,
    })
    return { behavior: 'ask', message }
  }

  if (/-regex\s+["'][^"']*[;&][^"']*["']/.test(unquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.SHELL_METACHARACTERS,
      subId: 3,
    })
    return { behavior: 'ask', message }
  }

  return { behavior: 'passthrough', message: 'No metacharacters' }
}

// ═══ 15. validateDangerousVariables：变量紧邻重定向/管道 ═══
//
// `$VAR` 的值在运行时才确定。`$X > file` 和 `$X | cmd` 这两种形态，
// 静态分析完全看不出最后会执行什么。所以只拦「变量出现在这两个位置」，
// 不试图分析变量的值 —— 那是不可能做对的事。
function validateDangerousVariables(
  context: ValidationContext,
): PermissionResult {
  const { fullyUnquotedContent } = context

  if (
    /[<>|]\s*\$[A-Za-z_]/.test(fullyUnquotedContent) ||
    /\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]/.test(fullyUnquotedContent)
  ) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.DANGEROUS_VARIABLES,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains variables in dangerous contexts (redirections or pipes)',
    }
  }

  return { behavior: 'passthrough', message: 'No dangerous variables' }
}

// ═══ 16. validateDangerousPatterns：命令替换的兜底 ═══
function validateDangerousPatterns(
  context: ValidationContext,
): PermissionResult {
  const { unquotedContent } = context

  // Special handling for backticks - check for UNESCAPED backticks only
  // Escaped backticks (e.g., \`) are safe and commonly used in SQL commands
  if (hasUnescapedChar(unquotedContent, '`')) {
    return {
      behavior: 'ask',
      message: 'Command contains backticks (`) for command substitution',
    }
  }

  // Other command substitution checks (include double-quoted content)
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(unquotedContent)) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId:
          BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_COMMAND_SUBSTITUTION,
        subId: 1,
      })
      return { behavior: 'ask', message: `Command contains ${message}` }
    }
  }

  return { behavior: 'passthrough', message: 'No dangerous patterns' }
}

// ═══ 17. validateRedirections：`<` 读敏感文件，`>` 写任意文件 ═══
//
// 注意用的是 `fullyUnquotedContent`（已过 stripSafeRedirections），
// 所以 `2>&1`、`> /dev/null`、`< /dev/null` 这些噪音已经被剥掉了。
// 剩下的任何一个 `<` 或 `>` 都是真的重定向。
function validateRedirections(context: ValidationContext): PermissionResult {
  const { fullyUnquotedContent } = context

  if (/</.test(fullyUnquotedContent)) {
// 注：`<` 和 `>` 分成两个 checkId 记，因为风险方向完全不同：
//       `<` = 输入重定向 = 可能读 /etc/shadow、~/.ssh/id_rsa
//       `>` = 输出重定向 = 可能覆盖 ~/.bashrc、写任意路径
//     分开记才能在数据上看清「攻击者更常用哪一头」。
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_INPUT_REDIRECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains input redirection (<) which could read sensitive files',
    }
  }

  if (/>/.test(fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.DANGEROUS_PATTERNS_OUTPUT_REDIRECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains output redirection (>) which could write to arbitrary files',
    }
  }

  return { behavior: 'passthrough', message: 'No redirections' }
}

// ═══ 18. validateNewlines：为什么必须用 strip **之前**的版本 ═══
function validateNewlines(context: ValidationContext): PermissionResult {
  // Use fullyUnquotedPreStrip (before stripSafeRedirections) to prevent bypasses
// 注：这段注释解释了一个非常细的绕过：
//       cmd \>/dev/null
//       whoami
//     剥掉 `>/dev/null` 之后剩 `cmd \` + 换行 + `whoami`，
//     看起来是「反斜杠续行」，安全。
//     但在原命令里，`\>` 是「转义的 >」，不构成重定向，所以 bash 看到的是
//     一条命令结束后接 `whoami`。
//     用 pre-strip 版本才能看见真实结构。
  // where stripping `>/dev/null` creates a phantom backslash-newline continuation.
  // E.g., `cmd \>/dev/null\nwhoami` → after stripping becomes `cmd \\nwhoami`
  // which looks like a safe continuation but actually hides a second command.
  const { fullyUnquotedPreStrip } = context

  // Check for newlines in unquoted content
  if (!/[\n\r]/.test(fullyUnquotedPreStrip)) {
    return { behavior: 'passthrough', message: 'No newlines' }
  }

  // Flag any newline/CR followed by non-whitespace, EXCEPT backslash-newline
  // continuations at word boundaries. In bash, `\<newline>` is a line
  // continuation (both chars removed), which is safe when the backslash
  // follows whitespace (e.g., `cmd \<newline>--flag`). Mid-word continuations
  // like `tr\<newline>aceroute` are still flagged because they can hide
  // dangerous command names from allowlist checks.
  // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .test() + gated by /[\n\r]/.test() above
  const looksLikeCommand = /(?<![\s]\\)[\n\r]\s*\S/.test(fullyUnquotedPreStrip)
// 注：负向后行断言 `(?<![\s]\\)` = 「前面不是『空白 + 反斜杠』」。
//     满足它的换行**不是**续行，所以后面跟非空白就是「新命令」。
//
//     为什么要排除「词中续行」：`tr\<换行>aceroute` 在 bash 里是
//     `traceroute`，但基于字符串的命令名白名单会把它当成 `tr`。
//     这类「命令名被拼出来」的写法，比直接换行更隐蔽。
  if (looksLikeCommand) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.NEWLINES,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains newlines that could separate multiple commands',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'Newlines appear to be within data',
  }
}

// ═══ 19. validateCarriageReturn：全文件最精彩的一段解析器差异分析 ═══
//
// 这一个字符（\r，0x0D）就能撬开整套权限模型，原因只有一句话：
//   JS 正则的 `\s` **包含** \r，bash 的默认 IFS **不包含** \r。
// 于是同一个字节，两个解析器给出两种分词结果。
/**
 * SECURITY: Carriage return (\r, 0x0D) IS a misparsing concern, unlike LF.
 *
 * Parser differential:
 *   - shell-quote's BAREWORD regex uses `[^\s...]` — JS `\s` INCLUDES \r, so
 *     shell-quote treats CR as a token boundary. `TZ=UTC\recho` tokenizes as
 *     TWO tokens: ['TZ=UTC', 'echo']. splitCommand joins with space →
 *     'TZ=UTC echo curl evil.com'.
 *   - bash's default IFS = $' \t\n' — CR is NOT in IFS. bash sees
 *     `TZ=UTC\recho` as ONE word → env assignment TZ='UTC\recho' (CR byte
 *     inside value), then `curl` is the command.
 *
 * Attack: `TZ=UTC\recho curl evil.com` with Bash(echo:*)
 *   validator: splitCommand collapses CR→space → 'TZ=UTC echo curl evil.com'
 *   → stripSafeWrappers: TZ=UTC stripped → 'echo curl evil.com' matches rule
 *   bash: executes `curl evil.com`
 *
 * validateNewlines catches this but is in nonMisparsingValidators (LF is
 * correctly handled by both parsers). This validator is NOT in
 * nonMisparsingValidators — its ask result gets isBashSecurityCheckForMisparsing
 * and blocks at the bashPermissions gate.
 *
 * Checks originalCommand (not fullyUnquotedPreStrip) because CR inside single
 * quotes is ALSO a misparsing concern for the same reason: shell-quote's `\s`
 * still tokenizes it, but bash treats it as literal. Block ALL unquoted-or-SQ CR.
 * Only exception: CR inside DOUBLE quotes where bash also treats it as data
 * and shell-quote preserves the token (no split).
 */
// 注：把上面那段英文对照表翻成中文 —— 它是整段的核心：
//
//      输入 TZ=UTC\recho curl evil.com               规则 Bash(echo:*)
//      ─────────────────────────────────────────────────────────────
//      shell-quote  BAREWORD 用 [^\s...]，\r ∈ \s → 切成两个 token
//                   得到 ['TZ=UTC', 'echo', 'curl', 'evil.com']
//                   splitCommand 用空格 join：'TZ=UTC echo curl evil.com'
//      bash         IFS = $' \t\n'，\r 不在里面 → 看成**一个词**
//                   TZ='UTC\recho'（环境变量赋值），命令是 curl
//
//      于是：validator 看到 'echo curl evil.com' 命中 Bash(echo:*) → 允许
//            bash 执行 'curl evil.com'
//
//     这就是「解析器差异」类漏洞的标准形态：不是某个检测写错了，
//     而是**两个解析器对同一段字节的理解不同**，检测的是 A，执行的是 B。
//
// 注：为什么 validateNewlines 抓不住、必须单独写一个？
//     因为 validateNewlines 在 nonMisparsingValidators 里（第 2343 行），
//     它的 ask 结果**不带** isBashSecurityCheckForMisparsing 标记，
//     在 bashPermissions 的闸门那儿不会被当作「解析器不可信」拦下。
//     而本函数的 ask 带标记（它不在那个集合里）→ 直接在闸门拦。
//
//     一句话：LF 两个解析器都处理正确，所以只是「可能多条命令」；
//     CR 是**解析器打架**，必须硬拦。
// 注：检查 originalCommand 而不是剥过引号的视图，理由：
//     单引号内的 \r 同样是差异点 —— shell-quote 的 `\s` 照样会切，
//     而 bash 把 `'...\r...'` 当字面量。所以单引号内的 CR 也要拦。
//     唯一例外是双引号内：两个解析器都觉得那是数据，不切。
function validateCarriageReturn(context: ValidationContext): PermissionResult {
  const { originalCommand } = context

  if (!originalCommand.includes('\r')) {
    return { behavior: 'passthrough', message: 'No carriage return' }
  }

  // Check if CR appears outside double quotes. CR outside DQ (including inside
  // SQ and unquoted) causes the shell-quote/bash tokenization differential.
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false
  for (let i = 0; i < originalCommand.length; i++) {
    const c = originalCommand[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (c === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }
    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
    if (c === '\r' && !inDoubleQuote) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.NEWLINES,
        subId: 2,
      })
      return {
        behavior: 'ask',
        message:
          'Command contains carriage return (\\r) which shell-quote and bash tokenize differently',
      }
    }
  }

  return { behavior: 'passthrough', message: 'CR only inside double quotes' }
}

// ═══ 20. validateIFSInjection：`$IFS` 是「隐形的空格」 ═══
//
// IFS 默认是空格/Tab/换行。如果能控制 IFS，就能在不出现空格的情况下
// 分隔参数：`cat$IFS/etc/passwd` 在 bash 里等价于 `cat /etc/passwd`，
// 但所有「按空格切分」的检测都会把它当成一个整体。
function validateIFSInjection(context: ValidationContext): PermissionResult {
  const { originalCommand } = context

  // Detect any usage of IFS variable which could be used to bypass regex validation
  // Check for $IFS and ${...IFS...} patterns (including parameter expansions like ${IFS:0:1}, ${#IFS}, etc.)
  // Using ${[^}]*IFS to catch all parameter expansion variations with IFS
  if (/\$IFS|\$\{[^}]*IFS/.test(originalCommand)) {
// 注：`\$\{[^}]*IFS` 这条覆盖所有参数展开变体：
//       ${IFS}       直接取
//       ${IFS:0:1}   取第一个字符（还是空格）
//       ${#IFS}      取长度（这个其实无害，但一并拦了）
//     宁可多拦一个无害的，也不要漏掉一个能构造空格的。
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.IFS_INJECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains IFS variable usage which could bypass security validation',
    }
  }

  return { behavior: 'passthrough', message: 'No IFS injection detected' }
}

// Additional hardening against reading environment variables via /proc filesystem.
// 注：`/proc/self/environ` 是一个用 `cat` 就能读的文件，里面是**进程启动时**
//     的完整环境变量 —— 包括 ANTHROPIC_API_KEY、各种 token。
//
//     路径校验本来就会拦 /proc（它不是项目目录），这里是纵深防御：
//     万一某天有人给 /proc 加了只读白名单，或者用了某种不经过路径校验的
//     读取方式（比如 `find /proc -exec cat {} \;`），这一层还在。
// Path validation typically blocks /proc access, but this provides defense-in-depth.
// Environment files in /proc can expose sensitive data like API keys and secrets.
function validateProcEnvironAccess(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  // Check for /proc paths that could expose environment variables
  // This catches patterns like:
  // - /proc/self/environ
  // - /proc/1/environ
  // - /proc/*/environ (with any PID)
  if (/\/proc\/.*\/environ/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.PROC_ENVIRON_ACCESS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command accesses /proc/*/environ which could expose sensitive environment variables',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No /proc/environ access detected',
  }
}

// ═══ 21. validateMalformedTokenInjection：HackerOne 审计的产物 ═══
//
// 这段注释点名了来源："the eval bypass discovered in HackerOne review"。
// 也就是说，这不是设计时想到的，是外部安全审计报上来的真实漏洞。
/**
 * Detects commands with malformed tokens (unbalanced delimiters) combined with
 * command separators. This catches potential injection patterns where ambiguous
 * shell syntax could be exploited.
 *
 * Security: This check catches the eval bypass discovered in HackerOne review.
 * When shell-quote parses ambiguous patterns like `echo {"hi":"hi;evil"}`,
 * it may produce unbalanced tokens (e.g., `{hi:"hi`). Combined with command
 * separators, this can lead to unintended command execution via eval re-parsing.
 *
 * By forcing user approval for these patterns, we ensure the user sees exactly
 * what will be executed before approving.
 */
// 注：攻击形态长这样：
//       echo {"hi":"hi;evil"}
//     shell-quote 解析这段时会产出**不平衡**的 token（`{hi:"hi`），
//     因为它的 BAREWORD 规则不认识 JSON 的花括号。
//     于是拿到一组畸形 token，再配上 `;` 这种分隔符，
//     下游如果用 eval 或重新拼接再解析，就能执行 `evil`。
//
//     防御策略很务实：不试图理解这些畸形 token，而是**只要同时出现
//     「分隔符」和「畸形 token」就 ask**，让用户亲眼看一遍要执行什么。
function validateMalformedTokenInjection(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  const parseResult = tryParseShellCommand(originalCommand)
  if (!parseResult.success) {
// 注：解析失败直接 passthrough，注释说 "handled elsewhere"。
//     这里有个依赖：bashToolHasPermission 自己会处理解析失败。
//     如果哪天那条路改了，这里就变成静默放行。
//     这类「靠别的模块兜底」的注释，是本文件里最需要警惕的地方。
    // Parse failed - this is handled elsewhere (bashToolHasPermission checks this)
    return {
      behavior: 'passthrough',
      message: 'Parse failed, handled elsewhere',
    }
  }

  const parsed = parseResult.tokens

  // Check for command separators (;, &&, ||)
  const hasCommandSeparator = parsed.some(
    entry =>
      typeof entry === 'object' &&
      entry !== null &&
      'op' in entry &&
      (entry.op === ';' || entry.op === '&&' || entry.op === '||'),
  )

  if (!hasCommandSeparator) {
    return { behavior: 'passthrough', message: 'No command separators' }
  }

  // Check for malformed tokens (unbalanced delimiters)
  if (hasMalformedTokens(originalCommand, parsed)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.MALFORMED_TOKEN_INJECTION,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains ambiguous syntax with command separators that could be misinterpreted',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No malformed token injection detected',
  }
}

// ═══ 22. validateObfuscatedFlags：400 行，全文件最长的 validator ═══
//
// 它要解决的问题一句话说完：**用引号把危险 flag 藏起来**。
//
//   find . "-exec" rm {} \;        引号包住整个 flag
//   find . '-'exec rm {} \;        引号只包 dash
//   find . "-""exec" rm {} \;      拆成两段引号，拼接后仍是 -exec
//   find . """-exec" rm {} \;      空引号对 + 引号包 flag
//   find . $'-\x65xec' rm {} \;    ANSI-C 引用，十六进制编码
//
// 这些都是「bash 拼完是 -exec，检测器看到的是别的」。
// 为什么必须拦：因为 -exec 的危险性判定（比如 deny 规则、危险命令识别）
// 全都建立在「能正确识别 flag 名」这个前提上。
function validateObfuscatedFlags(context: ValidationContext): PermissionResult {
  // Block shell quoting bypass patterns used to circumvent negative lookaheads we use in our regexes to block known dangerous flags

  const { originalCommand, baseCommand } = context

  // Echo is safe for obfuscated flags, BUT only for simple echo commands.
  // For compound commands (with |, &, ;), we need to check the whole command
  // because the dangerous ANSI-C quoting might be after the operator.
  const hasShellOperators = /[|&;]/.test(originalCommand)
// 注：echo 特例 + 一个精确的例外。
//     `echo` 的 flag 再危险也只是控制输出格式，所以直接放行。
//     **但只在没有 shell 操作符时**：`echo hi | find . "-exec" rm {} \;`
//     里，危险的部分在 `|` 之后，跳过整条检查就等于放它过去。
//     这是「快速通道必须连边界一起定义」的典型例子。
  if (baseCommand === 'echo' && !hasShellOperators) {
    return {
      behavior: 'passthrough',
      message: 'echo command is safe and has no dangerous flags',
    }
  }

  // COMPREHENSIVE OBFUSCATION DETECTION
  // These checks catch various ways to hide flags using shell quoting

  // 1. Block ANSI-C quoting ($'...') - can encode any character via escape sequences
// 注：ANSI-C 引用 `$'...'` 是全套混淆手段里最强的一个 ——
//     它能把任意字节写进命令，包括 `\x00`、`\x3b`（`;`）、`\n`。
//     `$'-\x65xec'` 在 bash 里就是 `-exec`，而字面上一个 `exec` 都没有。
//
//     注意这段正则是 `\$'[^']*'`：它只要求「$' 开头、' 结尾」，
//     不解析里面的转义序列。因为目的不是解码，而是「见到就拦」。
  // Simple pattern that matches $'...' anywhere. This correctly handles:
  // - grep '$' file => no match ($ is regex anchor inside quotes, no $'...' structure)
  // - 'test'$'-exec' => match (quote concatenation with ANSI-C)
  // - Zero-width space and other invisible chars => match
  // The pattern requires $' followed by content (can be empty) followed by closing '
  if (/\$'[^']*'/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 5,
    })
    return {
      behavior: 'ask',
      message: 'Command contains ANSI-C quoting which can hide characters',
    }
  }

  // 2. Block locale quoting ($"...")  - can also use escape sequences
// 注：locale 引用 `$"..."` 同理，只是用双引号。它在非英文 locale 下
//     会走 gettext 翻译，行为更难预测 —— 所以也一律拦。
  // Same simple pattern as ANSI-C quoting above
  if (/\$"[^"]*"/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 6,
    })
    return {
      behavior: 'ask',
      message: 'Command contains locale quoting which can hide characters',
    }
  }

  // 3. Block empty ANSI-C or locale quotes followed by dash
  // $''-exec or $""-exec
  if (/\$['"]{2}\s*-/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 9,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains empty special quotes before dash (potential bypass)',
    }
  }

  // 4. Block ANY sequence of empty quotes followed by dash
  // This catches: ''-  ""-  ''""-  ""''-  ''""''-  etc.
  // The pattern looks for one or more empty quote pairs followed by optional whitespace and dash
  if (/(?:^|\s)(?:''|"")+\s*-/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 7,
    })
    return {
      behavior: 'ask',
      message: 'Command contains empty quotes before dash (potential bypass)',
    }
  }

  // 4b. SECURITY: Block homogeneous empty quote pair(s) immediately adjacent
// 注：4b 这一段是本文件里「防御写得多细」的最好样本。
//     它拦的是 `"""-f"` 这种形态，并且**逐条排除了前面 4 个检测为什么都漏**：
//
//       正则 (4) `(?:''|"")+\s*-`    匹配了 `""`，然后期待可选空格 + dash，
//                                     但遇到第三个 `"` → 不匹配
//       引号内容扫描器                 看到第一对 `""` 内容为空（不以 dash 开头）→ 不报
//       引号状态机                     `""` 开关一次，第三个 `"` 又打开，
//                                     `-f` 里的 `-` 在引号内 → 跳过
//       flag 扫描器                   要求 `-` 前是 `\s`，这里前面是 `"` → 不匹配
//       fullyUnquotedContent          两段都被剥掉 → 什么都没剩
//
//     五路都漏，所以必须单独加一条 `(?:""|'')+['"]-`。
//     这段注释的价值不在结论，而在**推理过程**：它证明了「我检查过所有
//     现有手段，它们确实都漏」，而不是「我猜这里可能有问题」。
  // to a quoted dash. Patterns like `"""-f"` (empty `""` + quoted `"-f"`)
  // concatenate in bash to `-f` but slip past all the above checks:
  //   - Regex (4) above: `(?:''|"")+\s*-` matches `""` pair, then expects
  //     optional space and dash — but finds a third `"` instead. No match.
  //   - Quote-content scanner (below): Sees the first `""` pair with empty
  //     content (doesn't start with dash). The third `"` opens a new quoted
  //     region handled by the main quote-state tracker.
  //   - Quote-state tracker: `""` toggles inDoubleQuote on/off; third `"`
  //     opens it again. The `-` inside `"-f"` is INSIDE quotes → skipped.
  //   - Flag scanner: Looks for `\s` before `-`. The `-` is preceded by `"`.
  //   - fullyUnquotedContent: Both `""` and `"-f"` get stripped.
  //
  // In bash, `"""-f"` = empty string + string "-f" = `-f`. This bypass works
  // for ANY dangerous-flag check (jq -f, find -exec, fc -e) with a matching
  // prefix permission (Bash(jq:*), Bash(find:*)).
  //
  // The regex `(?:""|'')+['"]-` matches:
  //   - One or more HOMOGENEOUS empty pairs (`""` or `''`) — the concatenation
  //     point where bash joins the empty string to the flag.
  //   - Immediately followed by ANY quote char — opens the flag-quoted region.
  //   - Immediately followed by `-` — the obfuscated flag.
  //
  // POSITION-AGNOSTIC: We do NOT require word-start (`(?:^|\s)`) because
  // prefixes like `$x"""-f"` (unset/empty variable) concatenate the same way.
  // The homogeneous-empty-pair requirement filters out the `'"'"'` idiom
  // (no homogeneous empty pair — it's close, double-quoted-content, open).
  //
  // FALSE POSITIVE: Matches `echo '"""-f" text'` (pattern inside single-quoted
  // string). Extremely rare (requires echoing the literal attack). Acceptable.
  if (/(?:""|'')+['"]-/.test(originalCommand)) {
// 注：`(?:""|'')+['"]-` —— 拆开看：
//       (?:""|'')+  一个或多个**同质**空引号对（`""` 或 `''`，不能混）
//       ['"]-       紧接任意引号，再紧接 dash
//     同质要求是为了排除 `'"'"'` 这种惯用法（它是「收尾单引号 → 双引号内容 →
//     重新开单引号」，没有同质空对）。
//
//     注释还自己承认了一个误报：`echo '"""-f" text'`（把攻击字面量 echo 出来）
//     会被拦。判断是「极罕见，可接受」。
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 10,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains empty quote pair adjacent to quoted dash (potential flag obfuscation)',
    }
  }

  // 4c. SECURITY: Also block 3+ consecutive quotes at word start even without
// 注：4c 是兜底：词首 3 个以上连续引号就拦。
//     理由是「合法的命令不需要 `"""x"`，`"x"` 就够了」。
//     这类「合法场景为零」的启发式是最安全的启发式 —— 它不靠统计，
//     靠的是「人类不会这么写」。
  // an immediate dash. Broader safety net for multi-quote obfuscation patterns
  // not enumerated above (e.g., `"""x"-f` where content between quotes shifts
  // the dash position). Legitimate commands never need `"""x"` when `"x"` works.
  if (/(?:^|\s)['"]{3,}/.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 11,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains consecutive quote characters at word start (potential obfuscation)',
    }
  }

  // Track quote state to avoid false positives for flags inside quoted strings
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < originalCommand.length - 1; i++) {
    const currentChar = originalCommand[i]
    const nextChar = originalCommand[i + 1]

    // Update quote state
    if (escaped) {
      escaped = false
      continue
    }

    // SECURITY: Only treat backslash as escape OUTSIDE single quotes. In bash,
// 注：又一处 `!inSingleQuote` guard，注释给了完整的 desync 攻击链：
//
//       jq '\' "-f" evil
//
//     bash 看到的是：`'\'` 是一个反斜杠字符（单引号内反斜杠是字面量），
//     然后 `-f` 是一个独立参数。所以 jq 真的会拿到 -f（读文件执行）。
//
//     但如果这里漏了 guard：
//       `\` → escaped=true
//       收尾的 `'` → 被 escaped 分支消费，**不翻转** inSingleQuote
//       → 状态机永远停在「单引号内」
//       → 后面所有 flag 检测（第 1309 行的 continue）全部跳过
//
//     注释还补了一句「hasShellQuoteSingleQuoteBug 在 1856 行附近会先拦住
//     这个模式，但这里还是要修对」—— 这叫纵深防御，也是「不依赖别人兜底」
//     的工程习惯。
    // `\` inside `'...'` is LITERAL. Without this guard, `'\'` desyncs the
    // quote tracker: `\` sets escaped=true, closing `'` is consumed by the
    // escaped-skip above instead of toggling inSingleQuote. Parser stays in
    // single-quote mode, and the `if (inSingleQuote || inDoubleQuote) continue`
    // at line ~1121 skips ALL subsequent flag detection for the rest of the
    // command. Example: `jq '\' "-f" evil` — bash gets `-f` arg, but desynced
    // parser thinks ` "-f" evil` is inside quotes → flag detection bypassed.
    // Defense-in-depth: hasShellQuoteSingleQuoteBug catches `'\'` patterns at
    // line ~1856 before this runs. But we fix the tracker for consistency with
    // the CORRECT implementations elsewhere in this file (hasBackslashEscaped*,
    // extractQuotedContent) which all guard with `!inSingleQuote`.
    if (currentChar === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (currentChar === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (currentChar === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    // Only look for flags when not inside quoted strings
    // This prevents false positives like: make test TEST="file.py -v"
    if (inSingleQuote || inDoubleQuote) {
      continue
    }

    // Look for whitespace followed by quote that contains a dash (potential flag obfuscation)
// 注：模式 A —— 「空白 + 引号」，看引号里是不是藏着一个 flag。
//     三种形态都要认（第 1334-1339 行的注释）：
//       1) 引号内含完整 flag：`"--flag"` / `"-exec"`
//       2) 引号内含 dash、引号后接字母：`"-"exec` / `"--"output`
//       3) 引号链拼接：`"-""exec"` / `"""-"exec`
//     第 4 种「纯 dash 之后接空白」不拦 —— 那是分隔符，不是 flag。
    // SECURITY: Block ANY quoted content starting with dash - err on side of safety
    // Catches: "-"exec, "-file", "--flag", '-'output, etc.
    // Users can approve manually if legitimate (e.g., find . -name "-file")
    if (
      currentChar &&
      nextChar &&
      /\s/.test(currentChar) &&
      /['"`]/.test(nextChar)
    ) {
      const quoteChar = nextChar
      let j = i + 2 // Start after the opening quote
      let insideQuote = ''

      // Collect content inside the quote
      while (j < originalCommand.length && originalCommand[j] !== quoteChar) {
        insideQuote += originalCommand[j]!
        j++
      }

      // If we found a closing quote and the content looks like an obfuscated flag, block it.
      // Three attack patterns to catch:
      //   1. Flag name inside quotes: "--flag", "-exec", "-X" (dashes + letters inside)
      //   2. Split-quote flag: "-"exec, "--"output (dashes inside, letters continue after quote)
      //   3. Chained quotes: "-""exec" (dashes in first quote, second quote contains letters)
      // Pure-dash strings like "---" or "--" followed by whitespace/separator are separators,
      // not flags, and should not trigger this check.
      const charAfterQuote = originalCommand[j + 1]
      // Inside double quotes, $VAR and `cmd` expand at runtime, so "-$VAR" can
      // become -exec. Blocking $ and ` here over-blocks single-quoted literals
      // like grep '-$' (where $ is literal), but main's startsWith('-') already
      // blocked those — this restores status quo, not a new false positive.
      // Brace expansion ({) does NOT happen inside quotes, so { is not needed here.
      const hasFlagCharsInside = /^-+[a-zA-Z0-9$`]/.test(insideQuote)
      // Characters that can continue a flag after a closing quote. This catches:
      //   a-zA-Z0-9: "-"exec → -exec (direct concatenation)
      //   \\:        "-"\exec → -exec (backslash escape is stripped)
      //   -:         "-"-output → --output (extra dashes)
      //   {:         "-"{exec,delete} → -exec -delete (brace expansion)
      //   $:         "-"$VAR → -exec when VAR=exec (variable expansion)
      //   `:         "-"`echo exec` → -exec (command substitution)
      // Note: glob chars (*?[) are omitted — they require attacker-controlled
      // filenames in CWD to exploit, and blocking them would break patterns
      // like `ls -- "-"*` for listing files that start with dash.
      const FLAG_CONTINUATION_CHARS = /[a-zA-Z0-9\\${`-]/
// 注：`FLAG_CONTINUATION_CHARS` 是「引号闭合后，哪些字符能让 flag 继续」：
//       a-zA-Z0-9  直接拼接      "-"exec  → -exec
//       \\          反斜杠被剥      "-"\exec → -exec
//       -          再加 dash     "-"-o    → --o
//       {          brace 展开    "-"{exec,delete} → -exec -delete
//       $          变量展开      "-"$VAR  → -exec（VAR=exec）
//       `          命令替换      "-"`echo exec` → -exec
//
//     故意**不含** glob 字符（`*?[`）：利用它们需要攻击者控制当前目录下的
//     文件名，门槛高；而拦了会破坏 `ls -- "-"*`（列出以 dash 开头的文件）
//     这个合法用法。这是个明确的「收益 vs 误报」权衡，注释里写下来了。
      const hasFlagCharsContinuing =
        /^-+$/.test(insideQuote) &&
        charAfterQuote !== undefined &&
        FLAG_CONTINUATION_CHARS.test(charAfterQuote)
      // Handle adjacent quote chaining: "-""exec" or "-""-"exec or """-"exec concatenates
      // to -exec in shell. Follow the chain of adjacent quoted segments until
      // we find one containing an alphanumeric char or hit a non-quote boundary.
      // Also handles empty prefix quotes: """-"exec where "" is followed by "-"exec
      // The combined segments form a flag if they contain dash(es) followed by alphanumerics.
// 注：`hasFlagCharsInNextQuote` 处理引号链。它是个立即调用的箭头函数，
//     因为要在里面跑一个 while 循环累积多段引号内容，再判断拼接结果。
//
//     注意第 1398 行那个 `segment.length > 0 ? ... : combinedContent` 的守卫：
//     注释说「防止 slice(0, -0) 变成 slice(0, 0) 返回空串」。
//     `-0` 在 JS 里等于 `0`，所以 `slice(0, -0)` 会返回空 —— 这是个
//     真实存在的语言陷阱，作者踩过并留了注释。
      const hasFlagCharsInNextQuote =
        // Trigger when: first segment is only dashes OR empty (could be prefix for flag)
        (insideQuote === '' || /^-+$/.test(insideQuote)) &&
        charAfterQuote !== undefined &&
        /['"`]/.test(charAfterQuote) &&
        (() => {
          let pos = j + 1 // Start at charAfterQuote (an opening quote)
          let combinedContent = insideQuote // Track what the shell will see
          while (
            pos < originalCommand.length &&
            /['"`]/.test(originalCommand[pos]!)
          ) {
            const segQuote = originalCommand[pos]!
            let end = pos + 1
            while (
              end < originalCommand.length &&
              originalCommand[end] !== segQuote
            ) {
              end++
            }
            const segment = originalCommand.slice(pos + 1, end)
            combinedContent += segment

            // Check if combined content so far forms a flag pattern.
            // Include $ and ` for in-quote expansion: "-""$VAR" → -exec
            if (/^-+[a-zA-Z0-9$`]/.test(combinedContent)) return true

            // If this segment has alphanumeric/expansion and we already have dashes,
            // it's a flag. Catches "-""$*" where segment='$*' has no alnum but
            // expands to positional params at runtime.
            // Guard against segment.length === 0: slice(0, -0) → slice(0, 0) → ''.
            const priorContent =
              segment.length > 0
                ? combinedContent.slice(0, -segment.length)
                : combinedContent
            if (/^-+$/.test(priorContent)) {
              if (/[a-zA-Z0-9$`]/.test(segment)) return true
            }

            if (end >= originalCommand.length) break // Unclosed quote
            pos = end + 1 // Move past closing quote to check next segment
          }
          // Also check the unquoted char at the end of the chain
          if (
            pos < originalCommand.length &&
            FLAG_CONTINUATION_CHARS.test(originalCommand[pos]!)
          ) {
            // If we have dashes in combined content, the trailing char completes a flag
            if (/^-+$/.test(combinedContent) || combinedContent === '') {
              // Check if we're about to form a flag with the following content
              const nextChar = originalCommand[pos]!
              if (nextChar === '-') {
                // More dashes, could still form a flag
                return true
              }
              if (/[a-zA-Z0-9\\${`]/.test(nextChar) && combinedContent !== '') {
                // We have dashes and now alphanumeric/expansion follows
                return true
              }
            }
            // Original check for dashes followed by alphanumeric
            if (/^-/.test(combinedContent)) {
              return true
            }
          }
          return false
        })()
      if (
        j < originalCommand.length &&
        originalCommand[j] === quoteChar &&
        (hasFlagCharsInside ||
          hasFlagCharsContinuing ||
          hasFlagCharsInNextQuote)
      ) {
        logEvent('tengu_bash_security_check_triggered', {
          checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
          subId: 4,
        })
        return {
          behavior: 'ask',
          message: 'Command contains quoted characters in flag names',
        }
      }
    }

    // Look for whitespace followed by dash - this starts a flag
    if (currentChar && nextChar && /\s/.test(currentChar) && nextChar === '-') {
// 注：模式 B —— 「空白 + dash」，收集 flag 内容，内容里出现引号就拦。
//     这条覆盖 `-e"xec"`（引号藏在 flag 中间）。
//
//     第 1475 行有个极窄的例外：`cut -d'"'`。`cut` 的 -d 参数是分隔符，
//     分隔符本身可能就是引号（`cut -d'"'` 按双引号切）。
//     但例外必须**只给 cut 的 -d**，否则 `find -e"xec"` 会被当成
//     「flag 名 -e + 引号包的值」，从而绕过 -exec 的黑名单。
      let j = i + 1 // Start at the dash
      let flagContent = ''

      // Collect flag content
      while (j < originalCommand.length) {
        const flagChar = originalCommand[j]
        if (!flagChar) break

        // End flag content once we hit whitespace or an equals sign
        if (/[\s=]/.test(flagChar)) {
          break
        }
        // End flag collection if we hit quote followed by non-flag character. This is needed to handle cases like -d"," which should be parsed as just -d
        if (/['"`]/.test(flagChar)) {
          // Special case for cut -d flag: the delimiter value can be quoted
          // Example: cut -d'"' should parse as flag name: -d, value: '"'
          // Note: We only apply this exception to cut -d specifically to avoid bypasses.
          // Without this restriction, a command like `find -e"xec"` could be parsed as
          // flag name: -e, bypassing our blocklist for -exec. By restricting to cut -d,
          // we allow the legitimate use case while preventing obfuscation attacks on other
          // commands where quoted flag values could hide dangerous flag names.
          if (
            baseCommand === 'cut' &&
            flagContent === '-d' &&
            /['"`]/.test(flagChar)
          ) {
            // This is cut -d followed by a quoted delimiter - flagContent is already '-d'
            break
          }

          // Look ahead to see what follows the quote
          if (j + 1 < originalCommand.length) {
            const nextFlagChar = originalCommand[j + 1]
            if (nextFlagChar && !/[a-zA-Z0-9_'"-]/.test(nextFlagChar)) {
              // Quote followed by something that is clearly not part of a flag, end the parsing
              break
            }
          }
        }
        flagContent += flagChar
        j++
      }

      if (flagContent.includes('"') || flagContent.includes("'")) {
        logEvent('tengu_bash_security_check_triggered', {
          checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
          subId: 1,
        })
        return {
          behavior: 'ask',
          message: 'Command contains quoted characters in flag names',
        }
      }
    }
  }

  // Also handle flags that start with quotes: "--"output, '-'-output, etc.
  // Use fullyUnquotedContent to avoid false positives from legitimate quoted content like echo "---"
// 注：最后两条兜底用 `fullyUnquotedContent`（全剥），
//     因为这两条要抓的是「剥完之后还能看出引号 adjacency」的形态：
//       `\s['"`]-`  空白 + 引号 + dash
//       `['"`]{2}-`  两个引号 + dash
//     注释说明了为什么用全剥版本：避免把 `echo "---"` 这种合法内容误报
//     （它是引号内的三个 dash，剥完什么都不剩）。
  if (/\s['"`]-/.test(context.fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message: 'Command contains quoted characters in flag names',
    }
  }

  // Also handles cases like ""--output
  // Use fullyUnquotedContent to avoid false positives from legitimate quoted content
  if (/['"`]{2}-/.test(context.fullyUnquotedContent)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.OBFUSCATED_FLAGS,
      subId: 3,
    })
    return {
      behavior: 'ask',
      message: 'Command contains quoted characters in flag names',
    }
  }

  return { behavior: 'passthrough', message: 'No obfuscated flags detected' }
}

// ═══ 23. hasBackslashEscapedWhitespace：`echo\ test` 是一个词 ═══
//
// 这个差异的方向和前几个相反：这次是 shell-quote 「过分」了。
//
//   bash        echo\ test  →  **一个** token，命令名是 "echo test"
//   shell-quote 解码转义      →  两个 token：echo、test
//
// 于是 `echo\ test/../../../usr/bin/touch /tmp/file`：
//   parser 看到  echo test/../../../usr/bin/touch /tmp/file（echo 命令）
//   bash 执行    /usr/bin/touch /tmp/file（通过名为 "echo test" 的目录）
//
// 命令名被「路径穿越」拼出来了，而基于命令名的权限规则一条都没命中。
/**
 * Detects backslash-escaped whitespace characters (space, tab) outside of quotes.
 *
 * In bash, `echo\ test` is a single token (command named "echo test"), but
 * shell-quote decodes the escape and produces `echo test` (two separate tokens).
 * This discrepancy allows path traversal attacks like:
 *   echo\ test/../../../usr/bin/touch /tmp/file
 * which the parser sees as `echo test/.../touch /tmp/file` (an echo command)
 * but bash resolves as `/usr/bin/touch /tmp/file` (via directory "echo test").
 */
// 注：只在双引号外判定（第 1557 行 `if (!inDoubleQuote)`）。
//     因为双引号里 `\ ` 虽然也是转义，但 `\t`、`\n` 之类是字面反斜杠 + 字母，
//     判起来会产生大量误报（想想 `grep "a\tb"`）。
//     而单引号里反斜杠完全是字面量，连 escaped 都不该置 —— 所以
//     `!inSingleQuote` 这个 guard 在这里同样必须有。
function hasBackslashEscapedWhitespace(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (char === '\\' && !inSingleQuote) {
      if (!inDoubleQuote) {
        const nextChar = command[i + 1]
        if (nextChar === ' ' || nextChar === '\t') {
          return true
        }
      }
      // Skip the escaped character (both outside quotes and inside double quotes,
      // where \\, \", \$, \` are valid escape sequences)
      i++
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
  }

  return false
}

function validateBackslashEscapedWhitespace(
  context: ValidationContext,
): PermissionResult {
  if (hasBackslashEscapedWhitespace(context.originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_WHITESPACE,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains backslash-escaped whitespace that could alter command parsing',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No backslash-escaped whitespace',
  }
}

// ═══ 24. hasBackslashEscapedOperator：一个「归一化」引发的漏洞 ═══
//
// 这个 bug 的根因不在本文件，在 splitCommand：它把 `\;` 归一化成裸 `;`。
// 下游（checkReadOnlyConstraints、checkPathConstraints）拿到归一化后的
// 字符串，再解析一次 —— 这时裸 `;` 就是操作符，于是**凭空多出一个命令边界**。
/**
 * Detects a backslash immediately preceding a shell operator outside of quotes.
 *
 * SECURITY: splitCommand normalizes `\;` to a bare `;` in its output string.
 * When downstream code (checkReadOnlyConstraints, checkPathConstraints, etc.)
 * re-parses that normalized string, the bare `;` is seen as an operator and
 * causes a false split. This enables arbitrary file read bypassing path checks:
 *
 *   cat safe.txt \; echo ~/.ssh/id_rsa
 *
 * In bash: ONE cat command reading safe.txt, ;, echo, ~/.ssh/id_rsa as files.
 * After splitCommand normalizes: "cat safe.txt ; echo ~/.ssh/id_rsa"
 * Nested re-parse: ["cat safe.txt", "echo ~/.ssh/id_rsa"] — both segments
 * pass isCommandReadOnly, sensitive path hidden in echo segment is never
 * validated by path constraints. Auto-allowed. Private key leaked.
 *
 * This check flags any \<operator> regardless of backslash parity. Even counts
 * (\\;) are dangerous in bash (\\ → \, ; separates). Odd counts (\;) are safe
 * in bash but trigger the double-parse bug above. Both must be flagged.
 *
 * Known false positive: `find . -exec cmd {} \;` — users will be prompted once.
 *
 * Note: `(` and `)` are NOT in this set — splitCommand preserves `\(` and `\)`
 * in its output (round-trip safe), so they don't trigger the double-parse bug.
 * This allows `find . \( -name x -o -name y \)` to pass without false positives.
 */
// 注：完整攻击链，值得逐字读：
//
//       cat safe.txt \; echo ~/.ssh/id_rsa
//
//     bash 看到的：**一条** cat 命令，读三个文件
//                   safe.txt、`;`（字面分号）、~/.ssh/id_rsa
//                   → 私钥内容被打到 stdout
//     splitCommand 归一化后：'cat safe.txt ; echo ~/.ssh/id_rsa'
//     下游重新解析：['cat safe.txt', 'echo ~/.ssh/id_rsa'] 两条
//                   → 第二条里的 ~/.ssh/id_rsa 只是 echo 的参数
//                   → 路径校验只看第一段的 safe.txt（在 cwd 内）→ 通过
//                   → 自动允许，私钥泄露
//
//     关键：**同一个字符串，两次解析给出两种结构**。第一次（bash）是一条
//     命令读敏感文件，第二次（归一化后）是两条无害命令。
//     所有基于「第二次解析」的检查全部失效。
// 注：为什么奇偶都要拦？这是个容易被「想当然」掉的地方：
//       奇数个 `\;`（1、3、5…）  bash 里是**转义的分号**，安全；
//                                 但触发上面的双解析 bug → 必须拦
//       偶数个 `\\;`（2、4…）    bash 里 `\\`→`\`、`;` 是分隔符，
//                                 真的分两条命令 —— splitCommand 处理正确，
//                                 但**语义上仍是两条命令**，也要拦
//     所以注释说「regardless of backslash parity」。两头都堵。
// 注：`find . -exec cmd {} \;` 是明确的已知误报 —— 这是 find 的标准写法，
//     用户每次都会看到一次确认框。作者选择接受这个误报（而不是加
//     「find 的 -exec 后面允许 \;」这种特判），因为特判会引入新的绕过面：
//     一旦规则变成「find 命令里 \; 放行」，那么 `find` 被 alias、
//     或者用 `command find`、或者 find 在管道里 —— 每种都要重新论证。
//     宁可烦一次，不要留一个洞。
// 注：`(` 和 `)` 故意**不在** SHELL_OPERATORS 里。理由：
//     splitCommand 对 `\(` `\)` 是往返安全的（保留原样输出），
//     所以不会触发双解析 bug。
//     好处：`find . \( -name a -o -name b \)` 这种常用写法不误报。
//     这是个「先搞清机制，再决定拦不拦」的例子 —— 不是所有反斜杠都要拦。
const SHELL_OPERATORS = new Set([';', '|', '&', '<', '>'])

function hasBackslashEscapedOperator(command: string): boolean {
  let inSingleQuote = false
  let inDoubleQuote = false

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    // SECURITY: Handle backslash FIRST, before quote toggles. In bash, inside
// 注：处理顺序的硬要求 —— 反斜杠必须在引号翻转**之前**判断，
//     而且要**无条件** `i++` 跳过被转义的字符。
//     两个反例（都写在注释里）：
//
//     反例 1：先翻转引号
//       tac "x\"y" \; echo ~/.ssh/id_rsa
//       `\"` 在双引号内是转义的双引号，不闭合。但若先处理引号：
//       `\` 被忽略（gate 掉了）→ `"` 翻转 inDoubleQuote=false（错）
//       → 下一个 `"` 又翻回 true → 永久 desync → 漏掉后面的 `\;`
//
//     反例 2：不无条件跳过
//       cat "x\\" \; echo /etc/passwd
//       pos 处的 `\` 若去看 nextChar 是 `"` 就跳过它，
//       收尾引号永远不会触发翻转 → 同样 desync
//
//     结论：`if (char === '\\' && !inSingleQuote) { ...; i++; continue }`
//     这四行看着平淡，但每一个字符都在防一个具体攻击。
    // double quotes, `\"` is an escape sequence producing a literal `"` — it
    // does NOT close the quote. If we process quote toggles first, `\"` inside
    // `"..."` desyncs the tracker:
    //   - `\` is ignored (gated by !inDoubleQuote)
    //   - `"` toggles inDoubleQuote to FALSE (wrong — bash says still inside)
    //   - next `"` (the real closing quote) toggles BACK to TRUE — locked desync
    //   - subsequent `\;` is missed because !inDoubleQuote is false
    // Exploit: `tac "x\"y" \; echo ~/.ssh/id_rsa` — bash runs ONE tac reading
    // all args as files (leaking id_rsa), but desynced tracker misses `\;` and
    // splitCommand's double-parse normalization "sees" two safe commands.
    //
    // Fix structure matches hasBackslashEscapedWhitespace (which was correctly
    // fixed for this in commit prior to d000dfe84e): backslash check first,
    // gated only by !inSingleQuote (since backslash IS literal inside '...'),
    // unconditional i++ to skip the escaped char even inside double quotes.
    if (char === '\\' && !inSingleQuote) {
      // Only flag \<operator> when OUTSIDE double quotes (inside double quotes,
      // operators like ;|&<> are already not special, so \; is harmless there).
      if (!inDoubleQuote) {
        const nextChar = command[i + 1]
        if (nextChar && SHELL_OPERATORS.has(nextChar)) {
          return true
        }
      }
      // Skip the escaped character unconditionally. Inside double quotes, this
      // correctly consumes backslash pairs: `"x\\"` → pos 6 (`\`) skips pos 7
      // (`\`), then pos 8 (`"`) toggles inDoubleQuote off correctly. Without
      // unconditional skip, pos 7 would see `\`, see pos 8 (`"`) as nextChar,
      // skip it, and the closing quote would NEVER toggle inDoubleQuote —
      // permanently desyncing and missing subsequent `\;` outside quotes.
      // Exploit: `cat "x\\" \; echo /etc/passwd` — bash reads /etc/passwd.
      //
      // This correctly handles backslash parity: odd-count `\;` (1, 3, 5...)
      // is flagged (the unpaired `\` before `;` is detected). Even-count `\\;`
      // (2, 4...) is NOT flagged, which is CORRECT — bash treats `\\` as
      // literal `\` and `;` as a separator, so splitCommand handles it
      // normally (no double-parse bug). This matches
      // hasBackslashEscapedWhitespace line ~1340.
      i++
      continue
    }

    // Quote toggles come AFTER backslash handling (backslash already skipped
    // any escaped quote char, so these toggles only fire on unescaped quotes).
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }
  }

  return false
}

function validateBackslashEscapedOperators(
  context: ValidationContext,
): PermissionResult {
  // Tree-sitter path: if tree-sitter confirms no actual operator nodes exist
  // in the AST, then any \; is just an escaped character in a word argument
  // (e.g., `find . -exec cmd {} \;`). Skip the expensive regex check.
  if (context.treeSitter && !context.treeSitter.hasActualOperatorNodes) {
    return { behavior: 'passthrough', message: 'No operator nodes in AST' }
  }

  if (hasBackslashEscapedOperator(context.originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.BACKSLASH_ESCAPED_OPERATORS,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains a backslash before a shell operator (;, |, &, <, >) which can hide command structure',
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No backslash-escaped operators',
  }
}

// ═══ 25. isEscapedAtPosition：数反斜杠，别看相邻一个 ═══
//
// 为什么不能只看「前一个字符是不是反斜杠」：
//   `\{`   奇数个（1）→ `{` 被转义 → 字面花括号
//   `\\{`  偶数个（2）→ `\` 是转义的反斜杠，`{` **未转义**
// 只有数连续个数取奇偶才判得对。
/**
 * Checks if a character at position `pos` in `content` is escaped by counting
 * consecutive backslashes before it. An odd number means it's escaped.
 */
function isEscapedAtPosition(content: string, pos: number): boolean {
  let backslashCount = 0
  let i = pos - 1
  while (i >= 0 && content[i] === '\\') {
    backslashCount++
    i--
  }
  return backslashCount % 2 === 1
}

// ═══ 26. validateBraceExpansion：`{a,b}` 是一个参数还是两个？ ═══
//
// bash 会展开花括号，shell-quote 和 tree-sitter 都当字面量。
// 于是 `git ls-remote {--upload-pack="touch /tmp/test",test}`：
//   parser 看到  1 个参数（一个奇怪的文件名）
//   bash 展开成  2 个参数：--upload-pack="touch /tmp/test" 和 test
//   → git 执行 `touch /tmp/test`
// 又是一个「检测看 1 个、执行 2 个」。
/**
 * Detects unquoted brace expansion syntax that Bash expands but shell-quote/tree-sitter
 * treat as literal strings. This parsing discrepancy allows permission bypass:
 *   git ls-remote {--upload-pack="touch /tmp/test",test}
 * Parser sees one literal arg, but Bash expands to: --upload-pack="touch /tmp/test" test
 *
 * Brace expansion has two forms:
 *   1. Comma-separated: {a,b,c} → a b c
 *   2. Sequence: {1..5} → 1 2 3 4 5
 *
 * Both single and double quotes suppress brace expansion in Bash, so we use
 * fullyUnquotedContent which has both quote types stripped.
 * Backslash-escaped braces (\{, \}) also suppress expansion.
 */
function validateBraceExpansion(context: ValidationContext): PermissionResult {
  // Use pre-strip content to avoid false negatives from stripSafeRedirections
  // creating backslash adjacencies (e.g., `\>/dev/null{a,b}` → `\{a,b}` after
  // stripping, making isEscapedAtPosition think the brace is escaped).
  const content = context.fullyUnquotedPreStrip

  // SECURITY: Check for MISMATCHED brace counts in fullyUnquoted content.
// 注：这道检查（「`}` 比 `{` 多」）看着奇怪，但它对应一个精确的攻击签名：
//     如果**原文**里花括号是平衡的，而**剥引号后** `}` 多出来，
//     唯一的解释就是「有个 `{` 被引号包着，被剥掉了」。
//     而「引号包着单个花括号」在合法命令里几乎不存在。
  // A mismatch indicates that quoted braces (e.g., `'{'` or `"{"`) were
  // stripped by extractQuotedContent, leaving unbalanced braces in the content
  // we analyze. Our depth-matching algorithm below assumes balanced braces —
  // with a mismatch, it closes at the WRONG position, missing commas that
  // bash's algorithm WOULD find.
  //
  // Exploit: `git diff {@'{'0},--output=/tmp/pwned}`
// 注：完整攻击链，这是全文件最「零成本」的一个洞：
//
//       git diff {@'{'0},--output=/tmp/pwned}
//
//     原文：2 个 `{`、2 个 `}` —— 平衡。
//     剥引号后：`git diff {@0},--output=/tmp/pwned}` —— 1 个 `{`、2 个 `}`！
//
//     我们的深度匹配：在 `0` 后面的 `}` 就闭合了，内部是 `@0`，没有 `,` → 通过
//     bash：引号里的 `{` 是**内容**，第一个未引号 `}` 因为没有 `,` 只是字面量，
//           继续往后扫，找到 `,` 才展开 → 得到两个参数：
//             `@{0}`  和  `--output=/tmp/pwned`
//     于是 git 把 diff 写到 /tmp/pwned。
//
//     **任意文件写入，不需要任何权限。** 这就是为什么这一段的
//     「引号剥完可能破坏平衡性」值得单独写一道检查。
  //   - Original: 2 `{`, 2 `}` (quoted `'{'` counts as content, not operator)
  //   - fullyUnquoted: `git diff {@0},--output=/tmp/pwned}` — 1 `{`, 2 `}`!
  //   - Our depth-matcher: closes at first `}` (after `0`), inner=`@0`, no `,`
  //   - Bash (on original): quoted `{` is content; first unquoted `}` has no
  //     `,` yet → bash treats as literal content, keeps scanning → finds `,`
  //     → final `}` closes → expands to `@{0} --output=/tmp/pwned`
  //   - git writes diff to /tmp/pwned. ARBITRARY FILE WRITE, ZERO PERMISSIONS.
  //
  // We count ONLY unescaped braces (backslash-escaped braces are literal in
  // bash). If counts mismatch AND at least one unescaped `{` exists, block —
  // our depth-matching cannot be trusted on this content.
  let unescapedOpenBraces = 0
  let unescapedCloseBraces = 0
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{' && !isEscapedAtPosition(content, i)) {
      unescapedOpenBraces++
    } else if (content[i] === '}' && !isEscapedAtPosition(content, i)) {
      unescapedCloseBraces++
    }
  }
  // Only block when CLOSE count EXCEEDS open count — this is the specific
// 注：只拦「闭括号比开括号多」这一个方向，不拦反向。
//     理由是反向（`{` 比 `}` 多）通常就是 `{foo` 这种未闭合的字面量，
//     bash 也不会展开 —— 拦了纯属误报。
//     安全代码里「只拦精确的攻击签名」比「拦所有看起来奇怪的」更可持续：
//     后者会积累误报，最终逼用户养成「无脑点允许」的习惯，反而更危险。
  // attack signature. More `}` than `{` means a quoted `{` was stripped
  // (bash saw it as content, we see extra `}` unaccounted for). The inverse
  // (more `{` than `}`) is usually legitimate unclosed/escaped braces like
  // `{foo` or `{a,b\}` where bash doesn't expand anyway.
  if (unescapedOpenBraces > 0 && unescapedCloseBraces > unescapedOpenBraces) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message:
        'Command has excess closing braces after quote stripping, indicating possible brace expansion obfuscation',
    }
  }

  // SECURITY: Additionally, check the ORIGINAL command (before quote stripping)
// 注：第二道是「原文里有没有 `'{'` / `"{"`」。
//     这是直接抓攻击原语，不依赖平衡性推理 ——
//     即便攻击者构造出「剥完仍然平衡」的 payload，这一道也能命中。
//     典型的两层防御：一层抓结构异常（平衡性），一层抓原始特征（引号包花括号）。
  // for `'{'` or `"{"` INSIDE an unquoted brace context — this is the specific
  // attack primitive. A quoted brace inside an outer unquoted `{...}` is
  // essentially always an obfuscation attempt; legitimate commands don't nest
  // quoted braces inside brace expansion (awk/find patterns are fully quoted,
  // like `awk '{print $1}'` where the OUTER brace is inside quotes too).
  //
  // This catches the attack even if an attacker crafts a payload with balanced
  // stripped braces (defense-in-depth). We use a simple heuristic: if the
  // original command has `'{'` or `'}'` or `"{"` or `"}"` (quoted single brace)
  // AND also has an unquoted `{`, that's suspicious.
  if (unescapedOpenBraces > 0) {
    const orig = context.originalCommand
    // Look for quoted single-brace patterns: '{', '}', "{",  "}"
    // These are the attack primitive — a brace char wrapped in quotes.
    if (/['"][{}]['"]/.test(orig)) {
      logEvent('tengu_bash_security_check_triggered', {
        checkId: BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
        subId: 3,
      })
      return {
        behavior: 'ask',
        message:
          'Command contains quoted brace character inside brace context (potential brace expansion obfuscation)',
      }
    }
  }

  // Scan for unescaped `{` characters, then check if they form brace expansion.
  // We use a manual scan rather than a simple regex lookbehind because
  // lookbehinds can't handle double-escaped backslashes (\\{ is unescaped `{`).
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '{') continue
    if (isEscapedAtPosition(content, i)) continue

    // Find matching unescaped `}` by tracking nesting depth.
// 注：深度匹配，用 `depth` 而不是找第一个 `}`。
//     旧写法在嵌套时出错：`{--upload-pack="evil",{test}}` 里
//     内层 `{` 之后的第一个 `}` 是内层的，外层就看不到逗号了。
    // Previous approach broke on nested `{`, missing commas between the outer
    // `{` and the nested one (e.g., `{--upload-pack="evil",{test}}`).
    let depth = 1
    let matchingClose = -1
    for (let j = i + 1; j < content.length; j++) {
      const ch = content[j]
      if (ch === '{' && !isEscapedAtPosition(content, j)) {
        depth++
      } else if (ch === '}' && !isEscapedAtPosition(content, j)) {
        depth--
        if (depth === 0) {
          matchingClose = j
          break
        }
      }
    }

    if (matchingClose === -1) continue

    // Check for `,` or `..` at the outermost nesting level between this
// 注：只在 depth 0（最外层）找 `,` 或 `..`。
//     这精确对应 bash 的展开规则：外层逗号才分隔候选项，
//     内层的逗号属于内层展开。
//
//     注意循环结束**没有** `i = matchingClose` 跳过 —— 注释说
//     「内层对会被后续迭代自然捕获」。这是故意的：跳过会漏掉内层。
//     代价是 O(n²) 最坏情况，但 bash 命令都很短，不值得优化。
    // `{` and its matching `}`. Only depth-0 triggers matter — bash splits
    // brace expansion at outer-level commas/sequences.
    let innerDepth = 0
    for (let k = i + 1; k < matchingClose; k++) {
      const ch = content[k]
      if (ch === '{' && !isEscapedAtPosition(content, k)) {
        innerDepth++
      } else if (ch === '}' && !isEscapedAtPosition(content, k)) {
        innerDepth--
      } else if (innerDepth === 0) {
        if (
          ch === ',' ||
          (ch === '.' && k + 1 < matchingClose && content[k + 1] === '.')
        ) {
          logEvent('tengu_bash_security_check_triggered', {
            checkId: BASH_SECURITY_CHECK_IDS.BRACE_EXPANSION,
            subId: 1,
          })
          return {
            behavior: 'ask',
            message:
              'Command contains brace expansion that could alter command parsing',
          }
        }
      }
    }
    // No expansion at this level — don't skip past; inner pairs will be
    // caught by subsequent iterations of the outer loop.
  }

  return {
    behavior: 'passthrough',
    message: 'No brace expansion detected',
  }
}

// ═══ 27. validateUnicodeWhitespace：清单式防御 ═══
//
// 这里的注释自己说了：这个差异其实是「防御有利」的
// （shell-quote 把 unicode 空白当分隔符，会**过度切分**，
//  过度切分意味着检测器看到更多段，不是更少）。
// 但仍然主动拦，理由是「防止未来出现边界情况」。
// Matches Unicode whitespace characters that shell-quote treats as word
// separators but bash treats as literal word content. While this differential
// is defense-favorable (shell-quote over-splits), blocking these proactively
// prevents future edge cases.
// eslint-disable-next-line no-misleading-character-class
// 注：清单是 \u00A0（不换行空格）、\u1680、\u2000-\u200A、\u2028/\u2029
//     （行/段分隔符）、\u202F、\u205F、\u3000（全角空格）、\uFEFF（BOM）。
//
//     实测范围有个缺口：`\u200B`（零宽空格）、`\u200C`/`\u200D`（ZWNJ/ZWJ）
//     都**不在**范围内 —— 区间到 `\u200A` 就停了。
//     但这不构成漏洞：这三个字符既不是 bash 的 IFS 成员，也不是 JS 的 `\s`，
//     所以两个解析器都不当分隔符，没有差异可用。
//     它的实际影响是「不可见字符能藏进命令里」，属于混淆而非解析器差异 ——
//     而这层由其他 validator（控制字符、混淆 flag）覆盖。
//     知道清单不完整、也知道为什么不完整，比盲目相信清单更有用。
const UNICODE_WS_RE =
  /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

function validateUnicodeWhitespace(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context
  if (UNICODE_WS_RE.test(originalCommand)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.UNICODE_WHITESPACE,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains Unicode whitespace characters that could cause parsing inconsistencies',
    }
  }
  return { behavior: 'passthrough', message: 'No Unicode whitespace' }
}

// ═══ 28. validateMidWordHash：词中的 `#` ═══
//
// shell-quote 把词中 `#` 当注释开始；bash 把它当字面字符。
// 这是**又一个**分词差异：`echo a#b` 在 bash 里输出 `a#b`，
// 在 shell-quote 里变成 `echo a`（后面被当注释丢掉）。
//
// 反过来，攻击者可以利用这一点让 parser **看不到**命令的一部分。
function validateMidWordHash(context: ValidationContext): PermissionResult {
  const { unquotedKeepQuoteChars } = context
  // Match # preceded by a non-whitespace character (mid-word hash).
  // shell-quote treats mid-word # as comment-start but bash treats it as a
  // literal character, creating a parser differential.
  //
  // Uses unquotedKeepQuoteChars (which preserves quote delimiters but strips
  // quoted content) to catch quote-adjacent # like 'x'# — fullyUnquotedPreStrip
  // would strip both quotes and content, turning 'x'# into just # (word-start).
  //
  // SECURITY: Also check the CONTINUATION-JOINED version. The context is built
// 注：要检查两个版本（原文 + 续行拼接后），因为 `#` 的「前面是不是空白」
//     会在拼接后改变：
//       foo\<换行>#bar
//     拼接前：`#` 前面是 `\n`（空白）→ `\S#` 不匹配
//     拼接后：`#` 前面是 `o`（非空白）→ 匹配，是中缀 `#`
//     而 shell-quote 处理的正是**拼接后**的文本，所以差异在拼接后才显现。
//
//     第 1942 行那个 replace 很讲究：它把 `\\+\n` 里的反斜杠按奇偶处理 ——
//     奇数个表示「续行」（删掉），偶数个表示「字面反斜杠 + 换行」。
  // from the original command (pre-continuation-join). For `foo\<NL>#bar`,
  // pre-join the `#` is preceded by `\n` (whitespace → `/\S#/` doesn't match),
  // but post-join it's preceded by `o` (non-whitespace → matches). shell-quote
  // operates on the post-join text (line continuations are joined in
  // splitCommand), so the parser differential manifests on the joined text.
  // While not directly exploitable (the `#...` fragment still prompts as its
  // own subcommand), this is a defense-in-depth gap — shell-quote would drop
  // post-`#` content from path extraction.
  //
  // Exclude ${# which is bash string-length syntax (e.g., ${#var}).
// 注：排除 `${#var}` —— 那是 bash 的「取字符串长度」语法，`#` 前面是 `{`，
//     看起来像中缀 `#`，实际完全合法（`echo ${#PATH}` 天天有人写）。
//     负向后行 `(?<!\$\{)` 必须紧贴在 `#` 前，否则检查的窗口就错了 ——
//     注释里专门提了这一点，说明这里踩过坑。
  // Note: the lookbehind must be placed immediately before # (not before \S)
  // so that it checks the correct 2-char window.
  const joined = unquotedKeepQuoteChars.replace(/\\+\n/g, match => {
    const backslashCount = match.length - 1
    return backslashCount % 2 === 1 ? '\\'.repeat(backslashCount - 1) : match
  })
  if (
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- .test() with atom search: fast when # absent
    /\S(?<!\$\{)#/.test(unquotedKeepQuoteChars) ||
    // eslint-disable-next-line custom-rules/no-lookbehind-regex -- same as above
    /\S(?<!\$\{)#/.test(joined)
  ) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.MID_WORD_HASH,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains mid-word # which is parsed differently by shell-quote vs bash',
    }
  }
  return { behavior: 'passthrough', message: 'No mid-word hash' }
}

// ═══ 29. validateCommentQuoteDesync：注释里的引号 ═══
//
// 这个攻击很漂亮，思路是「让检测器的状态机跑偏」。
//
// bash：`#` 之后到行尾全是注释，里面的引号是**普通字符**。
// 本文件的引号追踪器：不认识注释，见到 `'` 就翻转状态。
//
// 于是攻击者在注释里塞几个引号，把追踪器的状态翻到「引号内」，
// 后面的真实代码就全被当成「引号里的数据」，检测全部跳过。
/**
 * Detects when a `#` comment contains quote characters that would desync
 * downstream quote trackers (like extractQuotedContent).
 *
 * In bash, everything after an unquoted `#` on a line is a comment — quote
 * characters inside the comment are literal text, not quote toggles. But our
 * quote-tracking functions don't handle comments, so a `'` or `"` after `#`
 * toggles their quote state. Attackers can craft `# ' "` sequences that
 * precisely desync the tracker, causing subsequent content (on following
 * lines) to appear "inside quotes" when it's actually unquoted in bash.
 *
 * Example attack:
 *   echo "it's" # ' " <<'MARKER'\n
 *   rm -rf /\n
 *   MARKER
 * In bash: `#` starts a comment, `rm -rf /` executes on line 2.
 * In extractQuotedContent: the `'` at position 14 (after #) opens a single
 * quote, and the `'` before MARKER closes it. But the `'` after MARKER opens
 * ANOTHER single quote, swallowing the newline and `rm -rf /`, so
 * validateNewlines sees no unquoted newlines.
 *
 * Defense: If we see an unquoted `#` followed by any quote character on the
 * same line, treat it as a misparsing concern. Legitimate commands rarely
 * have quote characters in their comments (and if they do, the user can
 * approve manually).
 */
// 注：完整例子：
//       echo "it's" # ' " <<'MARKER'
//       rm -rf /
//       MARKER
//
//     bash：`#` 开始注释，`rm -rf /` 在第二行**真的执行**。
//     追踪器：位置 14 的 `'`（在注释里）打开单引号，
//             MARKER 前的 `'` 关掉它，MARKER 后的 `'` 又打开 →
//             把换行和 `rm -rf /` 全吞进「引号内」→
//             validateNewlines 看不到未引号换行 → 通过。
//
//     注意这个攻击的巧妙处：它不攻击任何**具体**的检测，
//     它攻击的是「所有检测共同依赖的那个前提」—— 引号状态是对的。
// 注：防御选择得很克制：不实现「真正的注释解析」（那要改 6 个状态机副本），
//     而是「未引号 `#` 之后同一行有任何引号字符 → ask」。
//     理由：合法命令的注释里几乎不会有引号；真有了，用户点一次确认也不亏。
//     用 1 行检查覆盖一类攻击，而不是重构全部状态机 —— 这是很务实的取舍。
function validateCommentQuoteDesync(
  context: ValidationContext,
): PermissionResult {
  // Tree-sitter path: tree-sitter correctly identifies comment nodes and
  // quoted content. The desync concern is about regex quote tracking being
  // confused by quote characters inside comments. When tree-sitter provides
  // the quote context, this desync cannot happen — the AST is authoritative
  // regardless of whether the command contains a comment.
  if (context.treeSitter) {
// 注：tree-sitter 路径直接短跑。因为 tree-sitter 能正确识别 comment 节点，
//     AST 里注释就是注释，引号在注释里不会影响任何东西。
//     这条注释写得很准确："the AST is authoritative" —— 权威解析器给的结论
//     不需要再和正则交叉验证。
    return {
      behavior: 'passthrough',
      message: 'Tree-sitter quote context is authoritative',
    }
  }

  const { originalCommand } = context

  // Track quote state character-by-character using the same (correct) logic
  // as extractQuotedContent: single quotes don't toggle inside double quotes.
  // When we encounter an unquoted `#`, check if the rest of the line (until
  // newline) contains any quote characters.
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < originalCommand.length; i++) {
    const char = originalCommand[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (inDoubleQuote) {
      if (char === '"') inDoubleQuote = false
      // Single quotes inside double quotes are literal — no toggle
      continue
    }

    if (char === "'") {
      inSingleQuote = true
      continue
    }

    if (char === '"') {
      inDoubleQuote = true
      continue
    }

    // Unquoted `#` — in bash, this starts a comment. Check if the rest of
    // the line contains quote characters that would desync other trackers.
    if (char === '#') {
      const lineEnd = originalCommand.indexOf('\n', i)
      const commentText = originalCommand.slice(
        i + 1,
        lineEnd === -1 ? originalCommand.length : lineEnd,
      )
      if (/['"]/.test(commentText)) {
        logEvent('tengu_bash_security_check_triggered', {
          checkId: BASH_SECURITY_CHECK_IDS.COMMENT_QUOTE_DESYNC,
        })
        return {
          behavior: 'ask',
          message:
            'Command contains quote characters inside a # comment which can desync quote tracking',
        }
      }
      // Skip to end of line (rest is comment)
      if (lineEnd === -1) break
      i = lineEnd // Loop increment will move past newline
    }
  }

  return { behavior: 'passthrough', message: 'No comment quote desync' }
}

// ═══ 30. validateQuotedNewline：换行在引号**内**，但下一行会被当注释删掉 ═══
//
// 这是 29 号的反面，而且更阴险 —— 它攻击的不是检测器，是**下游的预处理**。
//
// `stripCommentLines`（在 stripSafeWrappers 里）逐行处理命令：
//   command.split('\n').filter(l => !l.trim().startsWith('#'))
// 它不看引号。所以只要能让某一行「trim 后以 # 开头」，那一行就会被整行删掉。
// 而「引号内的换行」正好提供了这个机会：bash 认为换行是数据，
// 但 stripCommentLines 认为它是行边界。
/**
 * Detects a newline inside a quoted string where the NEXT line would be
 * stripped by stripCommentLines (trimmed line starts with `#`).
 *
 * In bash, `\n` inside quotes is a literal character and part of the argument.
 * But stripCommentLines (called by stripSafeWrappers in bashPermissions before
 * path validation and rule matching) processes commands LINE-BY-LINE via
 * `command.split('\n')` without tracking quote state. A quoted newline lets an
 * attacker position the next line to start with `#` (after trim), causing
 * stripCommentLines to drop that line entirely — hiding sensitive paths or
 * arguments from path validation and permission rule matching.
 *
 * Example attack (auto-allowed in acceptEdits mode without any Bash rules):
 *   mv ./decoy '<\n>#' ~/.ssh/id_rsa ./exfil_dir
 * Bash: moves ./decoy AND ~/.ssh/id_rsa into ./exfil_dir/ (errors on `\n#`).
 * stripSafeWrappers: line 2 starts with `#` → stripped → "mv ./decoy '".
 * shell-quote: drops unbalanced trailing quote → ["mv", "./decoy"].
 * checkPathConstraints: only sees ./decoy (in cwd) → passthrough.
 * acceptEdits mode: mv with all-cwd paths → ALLOW. Zero clicks, no warning.
 *
 * Also works with cp (exfil), rm/rm -rf (delete arbitrary files/dirs).
 *
 * Defense: block ONLY the specific stripCommentLines trigger — a newline inside
 * quotes where the next line starts with `#` after trim. This is the minimal
 * check that catches the parser differential while preserving legitimate
 * multi-line quoted arguments (echo 'line1\nline2', grep patterns, etc.).
 * Safe heredocs ($(cat <<'EOF'...)) and git commit -m "..." are handled by
 * early validators and never reach this check.
 *
 * This validator is NOT in nonMisparsingValidators — its ask result gets
 * isBashSecurityCheckForMisparsing: true, causing an early block in the
 * permission flow at bashPermissions.ts before any line-based processing runs.
 */
// 注：这条攻击链是全文件最完整的一个，值得一步步跟：
//
//       mv ./decoy '<
//       >#' ~/.ssh/id_rsa ./exfil_dir
//
//     bash：把 ./decoy **和** ~/.ssh/id_rsa 都移动进 ./exfil_dir
//           （`<\n>#` 那一段是个不存在的文件名，会报错但不影响其余参数）
//     stripCommentLines：第二行 trim 后以 `#` 开头 → 整行删除
//                        → 剩下 "mv ./decoy '"
//     shell-quote：末尾引号不平衡 → 丢掉 → ["mv", "./decoy"]
//     checkPathConstraints：只看到 ./decoy（在 cwd 内）→ passthrough
//     acceptEdits 模式：mv 且所有路径都在 cwd 内 → **自动允许**
//
//     结果：零点击、零提示，任意文件被移走。
//     rm / rm -rf 同理（删任意文件）；cp 同理（外泄任意文件）。
//
//     注意这条链上有 4 个模块，每个都「按自己的规则做对了」，
//     合起来却漏了 —— 这就是为什么安全代码要盯着「边界处的假设」，
//     而不只是盯着单个函数。
// 注：这个 validator **不在** nonMisparsingValidators 里，是故意的。
//     它的 ask 会带上 isBashSecurityCheckForMisparsing → 在 bashPermissions
//     的闸门处**先拦下**，早于任何基于行的处理（包括 stripCommentLines）。
//     如果它被归到 nonMisparsing，那么 stripCommentLines 会先跑，
//     证据（那一行）就没了。**顺序在这里就是安全性的全部。**
function validateQuotedNewline(context: ValidationContext): PermissionResult {
  const { originalCommand } = context

  // Fast path: must have both a newline byte AND a # character somewhere.
// 注：快速预筛，两个条件都必须满足才继续：
//     有 `\n` **且** 有 `#`。因为 stripCommentLines 只删「trim 后以 # 开头」的行，
//     没有 `#` 就不可能触发。这一步把 99% 的多行命令直接放行（heredoc 除外，
//     但 heredoc 已经在 early validator 里处理了）。
//     「先用最便宜的条件排除绝大多数情况」是这个文件反复出现的模式。
  // stripCommentLines only strips lines where trim().startsWith('#'), so
  // no # means no possible trigger.
  if (!originalCommand.includes('\n') || !originalCommand.includes('#')) {
    return { behavior: 'passthrough', message: 'No newline or no hash' }
  }

  // Track quote state. Mirrors extractQuotedContent / validateCommentQuoteDesync:
  // - single quotes don't toggle inside double quotes
  // - backslash escapes the next char (but not inside single quotes)
  // stripCommentLines splits on '\n' (not \r), so we only treat \n as a line
  // separator. \r inside a line is removed by trim() and doesn't change the
  // trimmed-starts-with-# check.
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < originalCommand.length; i++) {
    const char = originalCommand[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    // A newline inside quotes: the NEXT line (from bash's perspective) starts
    // inside a quoted string. Check if that line would be stripped by
    // stripCommentLines — i.e., after trim(), does it start with `#`?
    // This exactly mirrors: lines.filter(l => !l.trim().startsWith('#'))
    if (char === '\n' && (inSingleQuote || inDoubleQuote)) {
      const lineStart = i + 1
      const nextNewline = originalCommand.indexOf('\n', lineStart)
      const lineEnd = nextNewline === -1 ? originalCommand.length : nextNewline
      const nextLine = originalCommand.slice(lineStart, lineEnd)
      if (nextLine.trim().startsWith('#')) {
        logEvent('tengu_bash_security_check_triggered', {
          checkId: BASH_SECURITY_CHECK_IDS.QUOTED_NEWLINE,
        })
        return {
          behavior: 'ask',
          message:
            'Command contains a quoted newline followed by a #-prefixed line, which can hide arguments from line-based permission checks',
        }
      }
    }
  }

  return { behavior: 'passthrough', message: 'No quoted newline-hash pattern' }
}

// ═══ 31. validateZshDangerousCommands：自己重新解析 base command ═══
//
// 注意它**不用** context.baseCommand。因为 context.baseCommand 是
// `command.split(' ')[0]`（第 2295 行）—— 只看第一个空格前的部分，
// 遇到 `FOO=bar command zmodload` 会得到 `FOO=bar`，完全不对。
// 所以这里自己重新分词，并且多跳过两类前缀。
/**
 * Validates that the command doesn't use Zsh-specific dangerous commands that
 * can bypass security checks. These commands provide capabilities like loading
 * kernel modules, raw file I/O, network access, and pseudo-terminal execution
 * that circumvent normal permission checks.
 *
 * Also catches `fc -e` which can execute arbitrary editors on command history,
 * and `emulate` which with `-c` is an eval-equivalent.
 */
function validateZshDangerousCommands(
  context: ValidationContext,
): PermissionResult {
  const { originalCommand } = context

  // Extract the base command from the original command, stripping leading
// 注：要跳过的两类：
//       ① 环境变量赋值   FOO=bar zmodload ...  → 真正的命令是 zmodload
//       ② zsh 前置修饰符 command / builtin / noglob / nocorrect
//          它们不改变「执行哪个命令」，只是改变查找/展开方式
//     例：`FOO=bar command builtin zmodload` → `zmodload`
//
//     这里用 `split(/\s+/)`，比 context.baseCommand 的 `split(' ')` 严谨 ——
//     能处理 Tab 和连续空格。两个地方用了两种分词方式，是历史遗留：
//     context.baseCommand 只服务于 validateGitCommit / validateJqCommand
//     这两个「认不出就 passthrough」的场景，所以粗糙也不致命。
  // whitespace, env var assignments, and Zsh precommand modifiers.
  // e.g., "FOO=bar command builtin zmodload" -> "zmodload"
  const ZSH_PRECOMMAND_MODIFIERS = new Set([
    'command',
    'builtin',
    'noglob',
    'nocorrect',
  ])
  const trimmed = originalCommand.trim()
  const tokens = trimmed.split(/\s+/)
  let baseCmd = ''
  for (const token of tokens) {
    // Skip env var assignments (VAR=value)
    if (/^[A-Za-z_]\w*=/.test(token)) continue
    // Skip Zsh precommand modifiers (they don't change what command runs)
    if (ZSH_PRECOMMAND_MODIFIERS.has(token)) continue
    baseCmd = token
    break
  }

  if (ZSH_DANGEROUS_COMMANDS.has(baseCmd)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
      subId: 1,
    })
    return {
      behavior: 'ask',
      message: `Command uses Zsh-specific '${baseCmd}' which can bypass security checks`,
    }
  }

  // Check for `fc -e` which allows executing arbitrary commands via editor
// 注：`fc -e` —— `fc` 是操作历史命令的内建，`fc` 单独用只是列历史（安全），
//     但 `fc -e editor` 会拿指定编辑器去改某条历史命令**然后执行它**。
//     等价于 eval：`fc -e "vim -c '!curl evil.com'"`。
//
//     正则 `\s-\S*e` 抓的是「某个以 - 开头的参数里含 e」——
//     能覆盖 `-e`、`-e vim`、`-se`（组合短选项）等写法。
//     代价是 `fc -l -10` 这类不该匹配的也可能命中（`-10` 里没有 e，所以不会）。
//     这里宁可宽一点，因为 fc 的合法用法本来就少。
  // fc without -e is safe (just lists history), but -e specifies an editor
  // to run on the command, effectively an eval
  if (baseCmd === 'fc' && /\s-\S*e/.test(trimmed)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.ZSH_DANGEROUS_COMMANDS,
      subId: 2,
    })
    return {
      behavior: 'ask',
      message:
        "Command uses 'fc -e' which can execute arbitrary commands via editor",
    }
  }

  return {
    behavior: 'passthrough',
    message: 'No Zsh dangerous commands',
  }
}

// ═══ 32. 控制字符：bash 会**静默丢弃** null byte ═══
//
// 这是最纯粹的「解析器差异」：bash 读到 `\x00` 直接扔掉，
// 我们的字符串处理却把它当普通字节。于是
//   echo safe\x00; rm -rf /
// bash 看到 `echo safe; rm -rf /`（两条命令），
// 而检测器看到的是一个奇怪的字符 —— 如果检测器按空格切分，
// `safe\x00;` 会是一个 token，`;` 就不在「词首」位置了。
//
// 注意排除的三个：\t(09)、\n(0A)、\r(0D) —— 它们有专门的 validator
// 处理，不在这里重复。这种「按字符集分工」的做法让每个检查的职责很清楚。
// Matches non-printable control characters that have no legitimate use in shell
// commands: 0x00-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F. Excludes tab (0x09),
// newline (0x0A), and carriage return (0x0D) which are handled by other
// validators. Bash silently drops null bytes and ignores most control chars,
// so an attacker can use them to slip metacharacters past our checks while
// bash still executes them (e.g., "echo safe\x00; rm -rf /").
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/

// ═══════════════════════════════════════════════════════════════
// ═══ 33. bashCommandIsSafe_DEPRECATED：22 个 validator 的编排 ═══
// ═══════════════════════════════════════════════════════════════
//
// 前面 32 段都是零件，从这行开始是总装。这个函数只有 160 行，
// 但它是整个文件里最容易改错的地方 —— 因为它管的是**顺序**和**短路策略**，
// 而这两样都没有类型系统保护。
//
// 读它的时候盯住三个问题：
//   ① 为什么 earlyValidators 的 allow 被降级成 passthrough？
//   ② 为什么 nonMisparsingValidators 的 ask 不能立即返回？
//   ③ 22 个 validator 的排列顺序，哪几对是有强制的先后依赖的？
/**
 * @deprecated Legacy regex/shell-quote path. Only used when tree-sitter is
 * unavailable. The primary gate is parseForSecurity (ast.ts).
 */
export function bashCommandIsSafe_DEPRECATED(
  command: string,
): PermissionResult {
  // SECURITY: Block control characters before any other processing. Null bytes
// 注：第一道 —— 控制字符。为什么放在**最前面**，而不是和其他 validator 一起？
//     因为它会让后面所有正则匹配的前提失效：
//     `echo safe\x00; rm -rf /` 里，如果检测器把 `\x00` 当普通字符，
//     `;` 就不在「空白之后」的位置，validateShellMetacharacters 之类的
//     「(?:^|\s)」前缀断言全都匹配不上。
//     bash 会把 `\x00` 扔掉然后照常执行 —— 于是检测和执行看到两条不同的命令。
//
//     这类「先清场再检查」的排序，在安全代码里叫 fail-fast precheck：
//     一旦输入本身不可信，后面的分析全部无意义。
  // and other non-printable chars are silently dropped by bash but confuse our
  // validators, allowing metacharacters adjacent to them to slip through.
  if (CONTROL_CHAR_RE.test(command)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains non-printable control characters that could be used to bypass security checks',
      isBashSecurityCheckForMisparsing: true,
    }
  }

  // SECURITY: Detect '\' patterns that exploit shell-quote's incorrect handling
  // of backslashes inside single quotes. Must run before shell-quote parsing.
// 注：第二道 —— shell-quote 自己的 bug。
//     `hasShellQuoteSingleQuoteBug` 检的是 `'\'` 这类模式：
//     在 bash 里 `'\'` 是一个反斜杠字符，但在 shell-quote 里
//     反斜杠会「转义」掉收尾的单引号 → 引号状态永久 desync。
//
//     注意这**不是**我们要防的目标程序有 bug，而是我们**自己用的解析器**有 bug。
//     所以必须在解析之前拦，而不是解析之后校验 —— 解析结果已经不可信了。
  if (hasShellQuoteSingleQuoteBug(command)) {
    return {
      behavior: 'ask',
      message:
        'Command contains single-quoted backslash pattern that could bypass security checks',
      isBashSecurityCheckForMisparsing: true,
    }
  }

  // SECURITY: Strip heredoc bodies before running security validators.
// 注：剥 heredoc body，但只剥「引号/转义分隔符」的（quotedOnly: true）。
//
//     理由很精确：
//       <<'EOF'  /  <<\EOF   → body 是**字面量**，里面的 $() 不展开
//                                 → 可以安全地剥掉，免得误报
//       <<EOF                 → body 会做完整展开，里面的 $() **真执行**
//                                 → 不能剥，必须让 validator 看见
//
//     而 extractHeredocs 解析失败时会「bail out」，原样返回命令 ——
//     注释说这是 "the safe direction"：多检查一点，不是少检查一点。
//     这种「失败时朝安全方向倒」的设计，在这个文件里出现了很多次。
  // Only strip bodies for quoted/escaped delimiters (<<'EOF', <<\EOF) where
  // the body is literal text — $(), backticks, and ${} are NOT expanded.
  // Unquoted heredocs (<<EOF) undergo full shell expansion, so their bodies
  // may contain executable command substitutions that validators must see.
  // When extractHeredocs bails out (can't parse safely), the raw command
  // goes through all validators — which is the safe direction.
  const { processedCommand } = extractHeredocs(command, { quotedOnly: true })

  const baseCommand = command.split(' ')[0] || ''
// 注：`command.split(' ')[0]` —— 只按**空格**切（不是 `\s`），
//     只取第一个。
//
//     后果一：`git\tcommit` → baseCommand 是 `git\tcommit`（整个），
//             validateGitCommit 的 `baseCommand !== 'git'` 直接 passthrough。
//             安全方向（少了快速通道，落回主链），只是没那么快。
//     后果二：`  git commit`（前导空格）→ baseCommand 是 `''` → 同样 passthrough。
//     后果三：`FOO=bar zmodload x` → baseCommand 是 `FOO=bar` → 不匹配。
//             但这个不影响安全，因为 validateZshDangerousCommands
//             自己重新分词（第 2200 行），不依赖 baseCommand。
//
//     所以这个粗糙的写法是「安全但不精确」：它让快速通道变窄，
//     但从不给出错误的「安全」结论。这是可接受的失败方向。
  const { withDoubleQuotes, fullyUnquoted, unquotedKeepQuoteChars } =
    extractQuotedContent(processedCommand, baseCommand === 'jq')

  const context: ValidationContext = {
// 注：建 context —— 三个视图都在这里定下来，后面 22 个 validator 只读不写。
//
//     注意三个字段的对应关系：
//       unquotedContent        ← withDoubleQuotes        （双引号内容保留）
//       fullyUnquotedContent   ← fullyUnquoted 再 strip   （全剥 + 去安全重定向）
//       fullyUnquotedPreStrip  ← fullyUnquoted            （全剥，不 strip）
//     没有 treeSitter 字段 —— 同步路径拿不到，所以这个字段缺席本身
//     就是「走的是降级路径」的标志。第 2487 行才填它。
    originalCommand: command,
    baseCommand,
    unquotedContent: withDoubleQuotes,
    fullyUnquotedContent: stripSafeRedirections(fullyUnquoted),
    fullyUnquotedPreStrip: fullyUnquoted,
    unquotedKeepQuoteChars,
  }

  const earlyValidators = [
// 注：earlyValidators —— 四个「有可能直接判定安全」的检查。
//     它们按顺序跑，第一个不是 passthrough 的就决定结果。
//
//     顺序有讲究：
//       validateEmpty                最便宜，先排除空命令
//       validateIncompleteCommands   三条正则，也很便宜
//       validateSafeCommandSubstitution  要跑 isSafeHeredoc（几百行逻辑），贵
//       validateGitCommit            要跑正则 + 手写状态机，也贵
//     便宜的在前，贵的在后 —— 短路掉便宜的就不用跑贵的。
    validateEmpty,
    validateIncompleteCommands,
    validateSafeCommandSubstitution,
    validateGitCommit,
  ]

  for (const validator of earlyValidators) {
    const result = validator(context)
    if (result.behavior === 'allow') {
// 注：**全文件最重要的一个设计决定** —— allow 被降级成 passthrough。
//
//     这三个 early validator 里，validateEmpty、validateSafeCommandSubstitution、
//     validateGitCommit 都会 return `behavior: 'allow'`。
//     如果这里把 allow 原样返回，会发生什么？
//
//     bashPermissions 拿到 allow，就会认为「安全检查已批准，可以执行」，
//     于是跳过规则匹配、跳过分类器、跳过用户确认。
//     也就是说：**一个误判就等于一次自动执行**。
//
//     降级成 passthrough 的语义完全不同：「我这关没意见，请继续走正常权限流程」。
//     于是安全检查的能力被限制为「只能否决，不能批准」——
//     这叫 fail-closed 的单向阀设计。
//
//     副作用的代价：`result.updatedInput` 被丢弃了。
//     validateSafeCommandSubstitution 和 validateGitCommit 都精心填了
//     `updatedInput: { command: originalCommand }`，实际没人读。
//     这是这次降级留下的死数据。
//
//     还有一处细节：message 取的是 decisionReason.reason，且要求 type 是
//     'other' 或 'safetyCheck'。为什么？因为这两个 type 的 reason 是
//     「给人看的说明文字」，可以安全地塞进 message；其他 type
//     （比如 'rule'）携带的是规则对象，塞进字符串会变成 [object Object]。
      return {
        behavior: 'passthrough',
        message:
          result.decisionReason?.type === 'other' ||
          result.decisionReason?.type === 'safetyCheck'
            ? result.decisionReason.reason
            : 'Command allowed',
      }
    }
    if (result.behavior !== 'passthrough') {
      return result.behavior === 'ask'
        ? { ...result, isBashSecurityCheckForMisparsing: true as const }
        : result
    }
  }

  // Validators that don't set isBashSecurityCheckForMisparsing — their ask
// 注：这一段的注释是全文最重要的**设计说明**，必须逐字读懂，
//     否则会以为 2343 行那个 Set 是个无害的分类标签。
//
//     核心：ask 有两种，语义完全不同。
//       · 带 isBashSecurityCheckForMisparsing 的 ask
//         = 「这个命令我**解析不了**」→ 在 bashPermissions 的闸门**直接拦**，
//           连规则匹配都不做。因为「解析不了」意味着后续所有基于解析的
//           检查（splitCommand 切分、路径校验、规则匹配）全都不可信。
//       · 不带的 ask
//         = 「这个命令**能解析**，但我觉得该问一声」→ 走正常权限流程，
//           用户可以允许、可以加规则、分类器也可能自动放行。
//
//     那为什么 validateNewlines 和 validateRedirections 属于后者？
//     因为它们检的是**正常语法**：多条命令用换行分隔、重定向到文件，
//     这些都是 bash 的标准用法，splitCommand 处理得完全正确。
//     用户写 `ls > out.txt` 不该被当成「解析失败」。
  // results go through the standard permission flow rather than being blocked
  // early. LF newlines and redirections are normal patterns that splitCommand
  // handles correctly, not misparsing concerns.
  //
  // NOTE: validateCarriageReturn is NOT here — CR IS a misparsing concern.
  // shell-quote's `[^\s]` treats CR as a word separator (JS `\s` ⊃ \r), but
  // bash IFS does NOT include CR. splitCommand collapses CR→space, which IS
  // misparsing. See validateCarriageReturn for the full attack trace.
  const nonMisparsingValidators = new Set([
// 注：只有两个成员。这个集合小得可疑，但每一处「缺席」都是刻意的：
//
//       validateCarriageReturn   **不在** —— CR 是解析器差异（见 943 行的长注释）
//       validateQuotedNewline    **不在** —— 它的 ask 必须早于 stripCommentLines
//       validateCommentQuoteDesync **不在** —— 同理，必须早于基于行的处理
//       validateBackslashEscapedOperators **不在** —— 它抓的正是双解析 bug
//
//     换句话说：这个集合的**补集**才是安全关键。加成员要极其谨慎 ——
//     往里加一个 validator，就等于把它从「硬拦」降级成「问一声」。
    validateNewlines,
    validateRedirections,
  ])

  const validators = [
// 注：主链 19 个 validator 的顺序，其中三对是**强制**的，不能重排：
//
//       ① validateCommentQuoteDesync  必须在 validateNewlines 之前
//          原因：它检的是「注释里的引号把状态机带跑」，
//                状态跑偏之后 validateNewlines 就看不到未引号换行了。
//                先修状态，再判换行。
//
//       ② validateQuotedNewline       必须在 validateNewlines 之前
//          原因：它检的是**引号内**的换行（validateNewlines 按设计忽略的那种）。
//                两者是互补的，但顺序上必须先查「被藏起来的」。
//
//       ③ validateCarriageReturn      必须在 validateNewlines 之前
//          原因：CR 是 misparsing（要硬拦），LF 不是。
//                如果 LF 的先返回非 misparsing 的 ask，就会被 defer，
//                而 CR 的结果本来应该优先。
//
//     剩下的顺序基本是「从具体到泛化」：
//       具体的模式（jq、混淆 flag、元字符、变量）在前，
//       因为它们能给出更精确的话术；
//       泛化的检测（malformed token）在最后 —— 注释里明确说了这个理由。
    validateJqCommand,
    validateObfuscatedFlags,
    validateShellMetacharacters,
    validateDangerousVariables,
    // Run comment-quote-desync BEFORE validateNewlines: it detects cases where
    // the quote tracker would miss newlines due to # comment desync.
    validateCommentQuoteDesync,
    // Run quoted-newline BEFORE validateNewlines: it detects the INVERSE case
    // (newlines INSIDE quotes, which validateNewlines ignores by design). Quoted
    // newlines let attackers split commands across lines so that line-based
    // processing (stripCommentLines) drops sensitive content.
    validateQuotedNewline,
    // CR check runs BEFORE validateNewlines — CR is a MISPARSING concern
    // (shell-quote/bash tokenization differential), LF is not.
    validateCarriageReturn,
    validateNewlines,
    validateIFSInjection,
    validateProcEnvironAccess,
    validateDangerousPatterns,
    validateRedirections,
    validateBackslashEscapedWhitespace,
    validateBackslashEscapedOperators,
    validateUnicodeWhitespace,
    validateMidWordHash,
    validateBraceExpansion,
    validateZshDangerousCommands,
    // Run malformed token check last - other validators should catch specific patterns first
    // (e.g., $() substitution, backticks, etc.) since they have more precise error messages
    validateMalformedTokenInjection,
  ]

  // SECURITY: We must NOT short-circuit when a non-misparsing validator
// 注：defer 机制 —— 全文件最反直觉的一段，也是最容易改错的一段。
//
//     问题：如果 validateRedirections（非 misparsing）先返回 ask，
//     我们**不能**立即返回。因为它不带 misparsing 标记，
//     在闸门处只值一个「问一声」，可以被用户允许。
//     而后面还没跑的 validateBackslashEscapedOperators（misparsing）
//     本来会带标记、直接硬拦。
//
//     具体 payload（注释里给的）：
//       cat safe.txt \; echo /etc/passwd > ./out
//     - 如果 validateRedirections 先看到 `>` 就返回 → 只问一声 → 用户可能允许
//     - 但 `\;` 才是真问题：它让 splitCommand 把命令切成两条，
//       第二条里的 /etc/passwd 逃过路径校验
//     所以必须**继续跑**，让 misparsing 的检测有机会说话。
//
//     策略：非 misparsing 的 ask 先**暂存**（只留第一个），继续跑；
//           遇到 misparsing 的 ask 就立即返回它（带标记）；
//           全跑完都没有，才返回暂存的那个。
//
//     这个模式的脆弱点：它靠「记得 return」和「记得最后兜底」两件事。
//     漏掉最后那个 if，所有非 misparsing 的 ask 都会静默消失（变成放行）；
//     漏掉 continue，就退化成原来的 bug。
//     这类「顺序敏感 + 无类型保护」的代码，是最该写测试的地方。
  // returns 'ask' if there are still misparsing validators later in the list.
  // Non-misparsing ask results are discarded at bashPermissions.ts:~1301-1303
  // (the gate only blocks when isBashSecurityCheckForMisparsing is set). If
  // validateRedirections (index 10, non-misparsing) fires first on `>`, it
  // returns ask-without-flag — but validateBackslashEscapedOperators (index 12,
  // misparsing) would have caught `\;` WITH the flag. Short-circuiting lets a
  // payload like `cat safe.txt \; echo /etc/passwd > ./out` slip through.
  //
  // Fix: defer non-misparsing ask results. Continue running validators; if any
  // misparsing validator fires, return THAT (with the flag). Only if we reach
  // the end without a misparsing ask, return the deferred non-misparsing ask.
  let deferredNonMisparsingResult: PermissionResult | null = null
// 注：`deferredNonMisparsingResult` 用 `=== null` 而不是 falsy 判断。
//     因为 PermissionResult 是对象，任何非 null 都算「已有暂存」。
//     用 falsy 会在某些实现返回 `false` 之类时出错 —— 这里是类型安全的，
//     但写成 `=== null` 更明确。
  for (const validator of validators) {
    const result = validator(context)
    if (result.behavior === 'ask') {
      if (nonMisparsingValidators.has(validator)) {
        if (deferredNonMisparsingResult === null) {
          deferredNonMisparsingResult = result
        }
        continue
      }
      return { ...result, isBashSecurityCheckForMisparsing: true as const }
    }
  }
  if (deferredNonMisparsingResult !== null) {
    return deferredNonMisparsingResult
  }

  return {
    behavior: 'passthrough',
    message: 'Command passed all security checks',
  }
}

// ═══════════════════════════════════════════════════════════════
// ═══ 34. bashCommandIsSafeAsync_DEPRECATED：同一套逻辑，第二遍 ═══
// ═══════════════════════════════════════════════════════════════
//
// 这个函数和上面那个有 80% 的代码是**逐字重复**的。
// 差异只有三处：
//   ① 先尝试 ParsedCommand.parse，拿 tree-sitter 的分析结果
//   ② 引号视图优先用 tree-sitter 的 quoteContext，同时用 regex 版本做分歧比对
//   ③ context 里多填一个 treeSitter 字段（让两个 validator 能走快速路径）
//
// 剩下 80% —— 两个前置检查、earlyValidators 循环、nonMisparsingValidators、
// 19 个 validator 的数组、defer 循环 —— 全是复制粘贴。
//
// 这是本文件最大的技术债，而且是有后果的：改一处必须改两处，
// 漏改一处不会报错，只会让两条路径行为不一致。
// 判断「该改哪条」的方法：看调用者是不是 async。
//   bashPermissions.ts:2089   async → 走这个
//   readOnlyValidation.ts:1894 同步 → 走上面那个
// 所以同一个命令，在「权限判定」和「只读判定」两条路上，
// 可能被不同的代码判定 —— 这是真实存在的不一致风险。
/**
 * @deprecated Legacy regex/shell-quote path. Only used when tree-sitter is
 * unavailable. The primary gate is parseForSecurity (ast.ts).
 *
 * Async version of bashCommandIsSafe that uses tree-sitter when available
 * for more accurate parsing. Falls back to the sync regex version when
 * tree-sitter is not available.
 *
 * This should be used by async callers (bashPermissions.ts, bashCommandHelpers.ts).
 * Sync callers (readOnlyValidation.ts) should continue using bashCommandIsSafe().
 */
export async function bashCommandIsSafeAsync_DEPRECATED(
  command: string,
  onDivergence?: () => void,
): Promise<PermissionResult> {
  // Try to get tree-sitter analysis
// 注：`ParsedCommand.parse` 内部会先探测 tree-sitter WASM 是否可用
//     （memoize 过的 `getTreeSitterAvailable`），不可用就返回一个
//     「getTreeSitterAnalysis() 恒为 null」的降级实现。
//     所以这里不用自己判断环境。
  const parsed = await ParsedCommand.parse(command)
  const tsAnalysis = parsed?.getTreeSitterAnalysis() ?? null

  // If no tree-sitter, fall back to sync version
// 注：拿不到 tree-sitter 就直接调同步版，整条逻辑走另一份实现。
//     注意此时**不是**简单降级 —— 而是完全交给另一个函数，
//     那个函数会重新做一遍剥 heredoc、建视图的工作。
//     所以这条路上有重复计算，但正确性由同步版保证。
  if (!tsAnalysis) {
    return bashCommandIsSafe_DEPRECATED(command)
  }

  // Run the same security checks but with tree-sitter enriched context.
// 注：两个前置检查**又写了一遍**（第 2442、2454 行），没有复用同步版。
//     为什么不能复用？因为同步版会把 19 个 validator 全跑完才返回，
//     而这里只需要那两个前置检查的结论。
//
//     这就是复制粘贴的代价：为了一点点复用，要么重构出「只跑前置检查」的
//     子函数，要么复制。作者选了复制。
  // The early checks (control chars, shell-quote bug) don't benefit from
  // tree-sitter, so we run them identically.
  if (CONTROL_CHAR_RE.test(command)) {
    logEvent('tengu_bash_security_check_triggered', {
      checkId: BASH_SECURITY_CHECK_IDS.CONTROL_CHARACTERS,
    })
    return {
      behavior: 'ask',
      message:
        'Command contains non-printable control characters that could be used to bypass security checks',
      isBashSecurityCheckForMisparsing: true,
    }
  }

  if (hasShellQuoteSingleQuoteBug(command)) {
    return {
      behavior: 'ask',
      message:
        'Command contains single-quoted backslash pattern that could bypass security checks',
      isBashSecurityCheckForMisparsing: true,
    }
  }

  const { processedCommand } = extractHeredocs(command, { quotedOnly: true })

  const baseCommand = command.split(' ')[0] || ''

  // Use tree-sitter quote context for more accurate analysis
// 注：这里的关键差异 —— 三份视图来自 tree-sitter，而不是正则。
//
//     tree-sitter 的 quoteContext 是**语法级**的：它知道哪些 span 是
//     raw_string（单引号）、string（双引号）、ansi_c_string（$'...'）、
//     heredoc_redirect。所以剥引号的结果比正则状态机可靠。
//
//     但正则版本也没删 —— 保留它做「分歧比对」，见下面。
  const tsQuote = tsAnalysis.quoteContext
  const regexQuote = extractQuotedContent(
    processedCommand,
    baseCommand === 'jq',
  )

  // Use tree-sitter quote context as primary, but keep regex as reference
  // for divergence logging
  const withDoubleQuotes = tsQuote.withDoubleQuotes
  const fullyUnquoted = tsQuote.fullyUnquoted
  const unquotedKeepQuoteChars = tsQuote.unquotedKeepQuoteChars

  const context: ValidationContext = {
    originalCommand: command,
    baseCommand,
    unquotedContent: withDoubleQuotes,
    fullyUnquotedContent: stripSafeRedirections(fullyUnquoted),
    fullyUnquotedPreStrip: fullyUnquoted,
    unquotedKeepQuoteChars,
    treeSitter: tsAnalysis,
  }

  // Log divergence between tree-sitter and regex quote extraction.
// 注：分歧日志（divergence）—— 这三个注释里藏着一个性能事故的复盘。
//
//     为什么要记分歧？因为如果 tree-sitter 和 regex 给出的剥引号结果不同，
//     说明有一方错了。而错误方向未知：可能是 tree-sitter 漏了某种语法，
//     也可能是 regex 状态机跑偏。长期收集分歧样本，能发现真实的解析器 bug。
//
//     坑一：heredoc 命令必须跳过。tree-sitter 把 heredoc body 剥成空，
//           regex 路径用占位符替换（extractHeredocs 干的）——
//           两者永远不相等。不跳过的话，每条 heredoc 命令都记一条假分歧。
//
//     坑二（CC-643，注释里点了工单号）：为什么要有 `onDivergence` 回调？
//          在 bashPermissions 的 fanout 循环里，一条命令会被拆成 N 个子命令
//           并发检查。如果每个子命令各记一条 logEvent，就是 N 次 logEvent。
//           而每次 logEvent 都会触发 getEventMetadata() → buildProcessMetrics()
//           → process.memoryUsage() → 读 /proc/self/stat。
//           这些操作被 memoize 后变成微任务，N 个微任务连续执行会**饿死事件循环**
//           —— 表现为整个 CLI 卡住。
//           解法：调用方传入 onDivergence，只累加计数，最后合并成一条 logEvent。
//
//     坑三：单命令调用者不传回调，保持逐条记录（量小，无所谓）。
//
//     这是一个很典型的「埋点反噬性能」的案例：埋点本身很便宜，
//     但它的**依赖链**很贵（读 /proc），在循环里就变成灾难。
  // Skip for heredoc commands: tree-sitter strips (quoted) heredoc bodies
  // to nothing while the regex path replaces them with placeholder strings
  // (via extractHeredocs), so the two outputs can never match. Logging
  // divergence for every heredoc command would poison the signal.
  //
  // onDivergence callback: when called in a fanout loop (bashPermissions.ts
  // Promise.all over subcommands), the caller batches divergences into a
  // single logEvent instead of N separate calls. Each logEvent triggers
  // getEventMetadata() → buildProcessMetrics() → process.memoryUsage() →
  // /proc/self/stat read; with memoized metadata these resolve as microtasks
  // and starve the event loop (CC-643). Single-command callers omit the
  // callback and get the original per-call logEvent behavior.
  if (!tsAnalysis.dangerousPatterns.hasHeredoc) {
    const hasDivergence =
      tsQuote.fullyUnquoted !== regexQuote.fullyUnquoted ||
      tsQuote.withDoubleQuotes !== regexQuote.withDoubleQuotes
    if (hasDivergence) {
      if (onDivergence) {
        onDivergence()
      } else {
        logEvent('tengu_tree_sitter_security_divergence', {
          quoteContextDivergence: true,
        })
      }
    }
  }

  const earlyValidators = [
// 注：从这里开始到函数结束，和同步版的第 2308-2407 行**逐字相同**。
//     唯一的差别是 context 里多了 treeSitter 字段。
//
//     逐字相同到什么程度？连注释都一样（同步版那里有更详细的注释）。
//     所以读这段时可以对照着看，理解一份就够。
    validateEmpty,
    validateIncompleteCommands,
    validateSafeCommandSubstitution,
    validateGitCommit,
  ]

  for (const validator of earlyValidators) {
    const result = validator(context)
    if (result.behavior === 'allow') {
      return {
        behavior: 'passthrough',
        message:
          result.decisionReason?.type === 'other' ||
          result.decisionReason?.type === 'safetyCheck'
            ? result.decisionReason.reason
            : 'Command allowed',
      }
    }
    if (result.behavior !== 'passthrough') {
      return result.behavior === 'ask'
        ? { ...result, isBashSecurityCheckForMisparsing: true as const }
        : result
    }
  }

  const nonMisparsingValidators = new Set([
    validateNewlines,
    validateRedirections,
  ])

  const validators = [
// 注：19 个 validator，顺序和同步版完全一致。
//     唯一的隐患：如果哪天有人只改了同步版的顺序（或者加了一个 validator
//     只加在一边），两条路径就会给出不同结论。
//     没有任何机制能发现这种不一致 —— 没有共享常量，没有测试比对。
//
//     改进方向（如果这是自己的项目）：把数组抽成模块级常量
//     `const VALIDATORS = [...]`，两个函数共用。这一处重构能消掉
//     本文件最危险的同源分歧。
    validateJqCommand,
    validateObfuscatedFlags,
    validateShellMetacharacters,
    validateDangerousVariables,
    validateCommentQuoteDesync,
    validateQuotedNewline,
    validateCarriageReturn,
    validateNewlines,
    validateIFSInjection,
    validateProcEnvironAccess,
    validateDangerousPatterns,
    validateRedirections,
    validateBackslashEscapedWhitespace,
    validateBackslashEscapedOperators,
    validateUnicodeWhitespace,
    validateMidWordHash,
    validateBraceExpansion,
    validateZshDangerousCommands,
    validateMalformedTokenInjection,
  ]

  let deferredNonMisparsingResult: PermissionResult | null = null
  for (const validator of validators) {
    const result = validator(context)
    if (result.behavior === 'ask') {
      if (nonMisparsingValidators.has(validator)) {
        if (deferredNonMisparsingResult === null) {
          deferredNonMisparsingResult = result
        }
        continue
      }
      return { ...result, isBashSecurityCheckForMisparsing: true as const }
    }
  }
  if (deferredNonMisparsingResult !== null) {
    return deferredNonMisparsingResult
  }

  return {
// 注：函数结束。回到文件开头那个问题 —— 为什么它叫 DEPRECATED。
//
//     结合整份源码看，这个命名其实记录了**架构迁移的过程**：
//       v1  纯正则 + shell-quote（本文件）
//       v2  加 tree-sitter 做语法级解析（ast.ts 的 parseForSecurity）
//       v2  把 v1 降级为 fallback，改名加 _DEPRECATED
//
//     但迁移没完成：readOnlyValidation.ts 还是同步的，只能调 v1；
//     本文件里 80% 的重复也没消除。
//
//     所以「DEPRECATED」在这里是**进行中的状态**，不是终点。
//     读这份源码时最有价值的收获，可能就是这个：真实的安全代码
//     不是设计出来的漂亮分层，而是「新的加上去了、旧的还不能删」
//     的堆叠状态。理解这种状态，比记住任何一个正则都有用。
    behavior: 'passthrough',
    message: 'Command passed all security checks',
  }
}
