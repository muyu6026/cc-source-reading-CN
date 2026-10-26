/**
 * AST-based bash command analysis using tree-sitter.
 *
 * This module replaces the shell-quote + hand-rolled char-walker approach in
 * bashSecurity.ts / commands.ts. Instead of detecting parser differentials
 * one-by-one, we parse with tree-sitter-bash and walk the tree with an
 * EXPLICIT allowlist of node types. Any node type not in the allowlist causes
 * the entire command to be classified as 'too-complex', which means it goes
 * through the normal permission prompt flow.
 *
 * The key design property is FAIL-CLOSED: we never interpret structure we
 * don't understand. If tree-sitter produces a node we haven't explicitly
 * allowlisted, we refuse to extract argv and the caller must ask the user.
 *
 * This is NOT a sandbox. It does not prevent dangerous commands from running.
 * It answers exactly one question: "Can we produce a trustworthy argv[] for
 * each simple command in this string?" If yes, downstream code can match
 * argv[0] against permission rules and flag allowlists. If no, ask the user.
 */
// 文件总述：这是 bash 的「AST 安全分析层」，用 tree-sitter 解析后按**显式白名单**走树。设计基石是 fail-closed——遇到任何没在白名单里的节点类型，整条命令判为 too-complex，交给正常权限询问流程，绝不去解释自己看不懂的结构。它不负责沙箱，只回答一个问题：能不能为这条命令里的每个 simple command 产出一个可信的 argv[]。

import { SHELL_KEYWORDS } from './bashParser.js'
import type { Node } from './parser.js'
import { PARSE_ABORTED, parseCommandRaw } from './parser.js'

// 重定向描述：`op` 是十种操作符的字面量联合，`target` 已做过引号剥离与反斜杠还原，`fd` 是可选的左值文件描述符（`2>log` 的 2）。
export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

// 一个 simple command 的三段式：`argv` 里 argv[0] 是命令名、其余是已解析引号的参数；`envVars` 是前置的 `VAR=val` 赋值（命令局部，不进全局 varScope）；`redirects` 是输入输出重定向；`text` 保留原始源码跨度供 UI 展示与下游规则匹配。
export type SimpleCommand = {
  /** argv[0] is the command name, rest are arguments with quotes already resolved */
  argv: string[]
  /** Leading VAR=val assignments */
  envVars: { name: string; value: string }[]
  /** Output/input redirects */
  redirects: Redirect[]
  /** Original source span for this command (for UI display) */
  text: string
}

// 三态结果而非布尔：`simple` 表示拿到了可信 argv；`too-complex` 带原因与节点类型（供埋点统计）；`parse-unavailable` 表示 tree-sitter WASM 没加载，调用方要回退到保守路径。
export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

/**
 * Structural node types that represent composition of commands. We recurse
 * through these to find the leaf `command` nodes. `program` is the root;
 * `list` is `a && b || c`; `pipeline` is `a | b`; `redirected_statement`
 * wraps a command with its redirects. Semicolon-separated commands appear
 * as direct siblings under `program` (no wrapper node).
 */
// 结构性节点白名单：只有这四种允许递归下钻找叶子 command。`program` 是根；`list` 是 `a && b || c`；`pipeline` 是 `a | b`；`redirected_statement` 把命令和它的重定向包在一起。分号分隔的命令在 program 下是**直接兄弟**，没有包装节点。
const STRUCTURAL_TYPES = new Set([
  'program',
  'list',
  'pipeline',
  'redirected_statement',
])

/**
 * Operator tokens that separate commands. These are leaf nodes that appear
 * between commands in `list`/`pipeline`/`program` and carry no payload.
 */
// 命令分隔符的叶子节点集合：`&&`、`||`、`|`、`;`、`&`、`|&`、换行。它们本身没有载荷，只用来切分作用域。
const SEPARATOR_TYPES = new Set(['&&', '||', '|', ';', '&', '|&', '\n'])

/**
 * Placeholder string used in outer argv when a $() is recursively extracted.
 * The actual $() output is runtime-determined; the inner command(s) are
 * checked against permission rules separately. Using a placeholder keeps
 * the outer argv clean (no multi-line heredoc bodies polluting path
 * extraction or triggering newline checks).
 */
// 命令替换占位符：外层 argv 遇到 `$()` 时放这个字符串顶位。真实输出要运行时才知道，内层命令另行单独过权限规则。用占位符能保持外层 argv 干净——多行 heredoc 正文不会污染路径提取，也不会触发换行检查。
const CMDSUB_PLACEHOLDER = '__CMDSUB_OUTPUT__'

/**
 * Placeholder for simple_expansion ($VAR) references to variables set earlier
 * in the same command via variable_assignment. Since we tracked the assignment,
 * we know the var exists and its value is either a static string or
 * __CMDSUB_OUTPUT__ (if set via $()). Either way, safe to substitute.
 */
// 变量占位符：`$VAR` 引用的是同一条命令里早先赋过值、但我们只知道「非常量」的变量（循环变量、read 变量、`$()` 赋值）。放进这个占位符既能让解析继续，又能在后续作为裸参数时被识别出来并拒绝。
const VAR_PLACEHOLDER = '__TRACKED_VAR__'

/**
 * All placeholder strings. Used for defense-in-depth: if a varScope value
 * contains ANY placeholder (exact or embedded), the value is NOT a pure
 * literal and cannot be trusted as a bare argument. Covers composites like
 * `VAR="prefix$(cmd)"` → `"prefix__CMDSUB_OUTPUT__"` — the substring check
 * catches these where exact-match Set.has() would miss.
 *
 * Also catches user-typed literals that collide with placeholder strings:
 * `VAR=__TRACKED_VAR__ && rm $VAR` — treated as non-literal (conservative).
 */
// 占位符检测必须用**子串包含**而不是集合精确匹配：`VAR=prefix$(cmd)` 的值会变成 `prefix__CMDSUB_OUTPUT__`，精确匹配漏掉的复合值要靠子串命中。副作用是用户手打的字面量若恰好等于占位符字符串也会被当成非常量——这是有意的保守。
function containsAnyPlaceholder(value: string): boolean {
  return value.includes(CMDSUB_PLACEHOLDER) || value.includes(VAR_PLACEHOLDER)
}

/**
 * Unquoted $VAR in bash undergoes word-splitting (on $IFS: space/tab/NL)
 * and pathname expansion (glob matching on * ? [). Our argv stores a
 * single string — but at runtime bash may produce MULTIPLE args, or paths
 * matched by a glob. A value containing these metacharacters cannot be
 * trusted as a bare arg: `VAR="-rf /" && rm $VAR` → bash runs `rm -rf /`
 * (two args) but our argv would have `['rm', '-rf /']` (one arg). Similarly
 * `VAR="/etc/*" && cat $VAR` → bash expands to all /etc files.
 *
 * Inside double-quotes ("$VAR"), neither splitting nor globbing applies —
 * the value IS a single literal argument.
 */
// 裸变量不安全字符集：未加引号的 `$VAR` 在 bash 里会做 word-splitting（按 IFS 切）和路径名展开（glob）。`VAR=-rf /` 加 `rm $VAR` 走的是两个参数，而我们的 argv 只有一个 `-rf /`。含空格、制表、换行、星号、问号、左方括号的值一律不可信。引号内不受此限。
const BARE_VAR_UNSAFE_RE = /[ \t\n*?[]/

// stdbuf flag forms — hoisted from the wrapper-stripping while-loop
const STDBUF_SHORT_SEP_RE = /^-[ioe]$/
const STDBUF_SHORT_FUSED_RE = /^-[ioe]./
const STDBUF_LONG_RE = /^--(input|output|error)=/

/**
 * Known-safe environment variables that bash sets automatically. Their values
 * are controlled by the shell/OS, not arbitrary user input. Referencing these
 * via $VAR is safe — the expansion is deterministic and doesn't introduce
 * injection risk. Covers `$HOME`, `$PWD`, `$USER`, `$PATH`, `$SHELL`, etc.
 * Intentionally small: only vars that are always set by bash/login and whose
 * values are paths/names (not arbitrary content).
 */
// 已知安全的环境变量白名单：bash 自动设置、值由 shell 或系统控制，不含任意用户输入。刻意保持很小——只收路径名类变量。注意 `IFS` 在列但只在字符串**内部**安全：作为裸参数时 `$IFS` 是经典注入原语，靠 resolveSimpleExpansion 的 insideString 闸门拦住。
const SAFE_ENV_VARS = new Set([
  'HOME', // user's home directory
  'PWD', // current working directory (bash maintains)
  'OLDPWD', // previous directory
  'USER', // current username
  'LOGNAME', // login name
  'SHELL', // user's login shell
  'PATH', // executable search path
  'HOSTNAME', // machine hostname
  'UID', // user id
  'EUID', // effective user id
  'PPID', // parent process id
  'RANDOM', // random number (bash builtin)
  'SECONDS', // seconds since shell start
  'LINENO', // current line number
  'TMPDIR', // temp directory
  // Special bash variables — always set, values are shell-controlled:
  'BASH_VERSION', // bash version string
  'BASHPID', // current bash process id
  'SHLVL', // shell nesting level
  'HISTFILE', // history file path
  'IFS', // field separator (NOTE: only safe INSIDE strings; as bare arg
  //       $IFS is the classic injection primitive and the insideString
  //       gate in resolveSimpleExpansion correctly blocks it)
])

/**
 * Special shell variables ($?, $$, $!, $#, $0-$9). tree-sitter uses
 * `special_variable_name` for these (not `variable_name`). Values are
 * shell-controlled: exit status, PIDs, positional args. Safe to resolve
 * ONLY inside strings (same rationale as SAFE_ENV_VARS — as bare args
 * their value IS the argument and might be a path/flag from $1 etc.).
 *
 * SECURITY: '@' and '*' are NOT in this set. Inside "...", they expand to
 * the positional params — which are EMPTY in a fresh BashTool shell (how we
 * always spawn). Returning VAR_PLACEHOLDER would lie: `git "push$*"` gives
 * argv ['git','push__TRACKED_VAR__'] while bash passes ['git','push']. Deny
 * rule Bash(git push:*) fails on both .text (raw `$*`) AND rebuilt argv
 * (placeholder). With them removed, resolveSimpleExpansion falls through to
 * tooComplex for `$*` / `$@`. `echo "args: $*"` becomes too-complex —
 * acceptable (rare in BashTool usage; `"$@"` even rarer).
 */
// 特殊 shell 变量（`$?`、`$$`、`$!`、`$#`、`$0`-`$9`、`$-`）。tree-sitter 用特殊节点名标识。安全理由同环境变量：值由 shell 控制，且只在字符串内允许。**`@` 与 `*` 被刻意排除**——在双引号里它们展开成位置参数，而 BashTool 新起的 shell 里位置参数恒为空；若返回占位符就等于撒谎（`git` 后接引号包裹的 `push$*` 我们会给出 `push<占位符>`，bash 实际给 `push`），拒绝规则两边都匹配不上，干脆走 too-complex。
const SPECIAL_VAR_NAMES = new Set([
  '?', // exit status of last command
  '$', // current shell PID
  '!', // last background PID
  '#', // number of positional params
  '0', // script name
  '-', // shell option flags
])

/**
 * Node types that mean "this command cannot be statically analyzed." These
 * either execute arbitrary code (substitutions, subshells, control flow) or
 * expand to values we can't determine statically (parameter/arithmetic
 * expansion, brace expressions).
 *
 * This set is not exhaustive — it documents KNOWN dangerous types. The real
 * safety property is the allowlist in walkArgument/walkCommand: any type NOT
 * explicitly handled there also triggers too-complex.
 */
// 已知危险节点类型清单：凡是会执行任意代码（命令替换、进程替换、子 shell、各种控制流）或展开成无法静态确定的值（参数展开、算术展开、花括号表达式）的节点。这个集合**不求完备**——真正的安全性质来自 walkArgument 与 walkCommand 的白名单，未显式处理的类型同样落到 too-complex。
const DANGEROUS_TYPES = new Set([
  'command_substitution',
  'process_substitution',
  'expansion',
  'simple_expansion',
  'brace_expression',
  'subshell',
  'compound_statement',
  'for_statement',
  'while_statement',
  'until_statement',
  'if_statement',
  'case_statement',
  'function_definition',
  'test_command',
  'ansi_c_string',
  'translated_string',
  'herestring_redirect',
  'heredoc_redirect',
])

/**
 * Numeric IDs for analytics (logEvent doesn't accept strings). Index into
 * DANGEROUS_TYPES. Append new entries at the end to keep IDs stable.
 * 0 = unknown/other, -1 = ERROR (parse failure), -2 = pre-check.
 */
// 埋点用的数字 ID：日志组件不收字符串，所以把危险类型集合转成数组做下标。约定只往末尾追加，保证历史 ID 稳定；0 表示未知、-1 表示解析错误、-2 表示解析前置阶段。
const DANGEROUS_TYPE_IDS = [...DANGEROUS_TYPES]
export function nodeTypeId(nodeType: string | undefined): number {
  if (!nodeType) return -2
  if (nodeType === 'ERROR') return -1
  const i = DANGEROUS_TYPE_IDS.indexOf(nodeType)
  return i >= 0 ? i + 1 : 0
}

/**
 * Redirect operator tokens → canonical operator. tree-sitter produces these
 * as child nodes of `file_redirect`.
 */
// 重定向操作符映射表：tree-sitter 把它们作为 file_redirect 的子节点输出，这里转成规范化的 op 字面量。
const REDIRECT_OPS: Record<string, Redirect['op']> = {
  '>': '>',
  '>>': '>>',
  '<': '<',
  '>&': '>&',
  '<&': '<&',
  '>|': '>|',
  '&>': '&>',
  '&>>': '&>>',
  '<<<': '<<<',
}

/**
 * Brace expansion pattern: {a,b} or {a..b}. Must have , or .. inside
 * braces. We deliberately do NOT try to determine whether the opening brace
 * is backslash-escaped: tree-sitter doesn't unescape backslashes, so
 * distinguishing `\{a,b}` (escaped, literal) from `\\{a,b}` (literal
 * backslash + expansion) would require reimplementing bash quote removal.
 * Reject both — the escaped-brace case is rare and trivially rewritten
 * with single quotes.
 */
// 花括号展开特征：括号内必须有逗号或双点。**刻意不去判断左括号是否被反斜杠转义**——tree-sitter 不做反斜杠还原，要区分转义的字面量与真展开就得重写 bash 的引号剥离规则，代价太大；两种都拒绝，转义写法改成单引号即可绕开。
const BRACE_EXPANSION_RE = /\{[^{}\s]*(,|\.\.)[^{}\s]*\}/

/**
 * Control characters that bash silently drops but confuse static analysis.
 * Includes CR (0x0D): tree-sitter treats CR as a word separator but bash's
 * default IFS does not include CR, so tree-sitter and bash disagree on
 * word boundaries.
 */
// eslint-disable-next-line no-control-regex
// 控制字符集，含回车（0x0D）。关键差异：tree-sitter 把回车当词分隔符，bash 的默认 IFS 却不含回车——两边对词边界的判断不一致，静态分析的所有结论都不可靠。
const CONTROL_CHAR_RE = /[\x00-\x08\x0B-\x1F\x7F]/

/**
 * Unicode whitespace beyond ASCII. These render invisibly (or as regular
 * spaces) in terminals so a user reviewing the command can't see them, but
 * bash treats them as literal word characters. Blocks NBSP, zero-width
 * spaces, line/paragraph separators, BOM.
 */
// ASCII 之外的 Unicode 空白：不换行空格、零宽空格、行分隔符、段落分隔符、字节序标记。它们在终端里不可见（或看起来就是普通空格），用户审阅时看不出差别，bash 却当成普通词字符。
const UNICODE_WHITESPACE_RE =
  /[\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]/

/**
 * Backslash immediately before whitespace. bash treats `\ ` as a literal
 * space inside the current word, but tree-sitter returns the raw text with
 * the backslash still present. argv[0] from tree-sitter is `cat\ test`
 * while bash runs `cat test` (with a literal space). Rather than
 * reimplement bash's unescaping rules, we reject these — they're rare in
 * practice and trivial to rewrite with quotes.
 *
 * Also matches `\` before newline (line continuation) when adjacent to a
 * non-whitespace char. `tr\<NL>aceroute` — bash joins to `traceroute`, but
 * tree-sitter splits into two words (differential). When `\<NL>` is preceded
 * by whitespace (e.g. `foo && \<NL>bar`), there's no word to join — both
 * parsers agree, so we allow it.
 */
// 反斜杠紧跟空白。bash 里这是「转义的字面空格」，仍属当前词；tree-sitter 保留原文本，argv[0] 会得到 `cat` 加反斜杠加空格加 `test`，而 bash 执行的是带空格的单个命令名。同样不去重写 bash 的反转义规则，直接拒绝。反斜杠加换行同理：仅当反斜杠前是非空白字符时才形成词拼接，前有空白时两个解析器结论一致，放行。
const BACKSLASH_WHITESPACE_RE = /\\[ \t]|[^ \t\n\\]\\\n/

/**
 * Zsh dynamic named directory expansion: ~[name]. In zsh this invokes the
 * zsh_directory_name hook, which can run arbitrary code. bash treats it as
 * a literal tilde followed by a glob character class. Since BashTool runs
 * via the user's default shell (often zsh), reject conservatively.
 */
// zsh 动态命名目录 `~[name]`：会触发 zsh_directory_name 钩子，可执行任意代码。bash 只当普通波浪号加 glob 字符类。BashTool 走用户默认 shell（常是 zsh），一律保守拒绝。
const ZSH_TILDE_BRACKET_RE = /~\[/

/**
 * Zsh EQUALS expansion: word-initial `=cmd` expands to the absolute path of
 * `cmd` (equivalent to `$(which cmd)`). `=curl evil.com` runs as
 * `/usr/bin/curl evil.com`. tree-sitter parses `=curl` as a literal word, so
 * a `Bash(curl:*)` deny rule matching on base command name won't see `curl`.
 * Only matches word-initial `=` followed by a command-name char — `VAR=val`
 * and `--flag=val` have `=` mid-word and are not expanded by zsh.
 */
// zsh 等号展开：词首的 `=cmd` 展开成 `cmd` 的绝对路径，等价于 `$(which cmd)`。`=curl evil.com` 实际执行系统 curl，而 tree-sitter 把 `=curl` 当字面词，针对命令名 `curl` 的拒绝规则完全看不到它。只匹配词首等号，`VAR=val` 与 `--flag=val` 的等号在词中，不受影响。
const ZSH_EQUALS_EXPANSION_RE = /(?:^|[\s;&|])=[a-zA-Z_]/

/**
 * Brace character combined with quote characters. Constructions like
 * `{a'}',b}` use quoted braces inside brace expansion context to obfuscate
 * the expansion from regex-based detection. In bash, `{a'}',b}` expands to
 * `a} b` (the quoted `}` becomes literal inside the first alternative).
 * These are hard to analyze correctly and have no legitimate use in
 * commands we'd want to auto-allow.
 *
 * This check runs on a version of the command with `{` masked out of
 * single-quoted and double-quoted spans, so JSON payloads like
 * `curl -d '{"k":"v"}'` don't trigger a false positive. Brace expansion
 * cannot occur inside quotes, so a `{` there can never start an obfuscation
 * pattern. The quote characters themselves stay visible so `{a'}',b}` and
 * `{@'{'0},...}` still match via the outer unquoted `{`.
 */
// 花括号与引号字符混排的混淆构造，如用引号包住右括号来骗过正则检测。这类写法在我们要自动放行的命令里没有正当用途。检测前先把单双引号内的左花括号遮蔽掉，避免 `curl -d` 传 JSON 载荷时误报——引号内不可能发生花括号展开。
const BRACE_WITH_QUOTE_RE = /\{[^}]*['"]/

/**
 * Mask `{` characters that appear inside single- or double-quoted contexts.
 * Uses a single-pass bash-aware quote-state scanner instead of a regex.
 *
 * A naive regex (`/'[^']*'/g`) mis-detects spans when a `'` appears inside
 * a double-quoted string: for `echo "it's" {a'}',b}`, it matches from the
 * `'` in `it's` across to the `'` in `{a'}`, masking the unquoted `{` and
 * producing a false negative. The scanner tracks actual bash quote state:
 * `'` toggles single-quote only in unquoted context; `"` toggles
 * double-quote only outside single quotes; `\` escapes the next char in
 * unquoted context and escapes `"` / `\\` inside double quotes.
 *
 * Brace expansion is impossible in both quote contexts, so masking `{` in
 * either is safe. Secondary defense: BRACE_EXPANSION_RE in walkArgument.
 */
// 手写的 bash 感知引号状态扫描器，只做一件事：把单双引号内的左花括号替换成空格。为什么不能用一个正则搞定——`'[^']*'` 这种朴素写法在「双引号里出现单引号」时会跨越到后面的单引号去，遮蔽掉真正的未加引号花括号，造成漏报。扫描器严格跟踪状态：单引号只在未加引号上下文切换，双引号只在单引号外切换，反斜杠在未加引号时转义下一个字符、在双引号内只转义引号与反斜杠。
function maskBracesInQuotedContexts(cmd: string): string {
  // Fast path: no `{` → nothing to mask. Skips the char-by-char scan for
  // the >90% of commands with no braces (`ls -la`, `git status`, etc).
  if (!cmd.includes('{')) return cmd
  const out: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (inSingle) {
      // Bash single quotes: no escapes, `'` always terminates.
      if (c === "'") inSingle = false
      out.push(c === '{' ? ' ' : c)
      i++
    } else if (inDouble) {
      // Bash double quotes: `\` escapes `"` and `\` (also `$`, backtick,
      // newline — but those don't affect quote state so we let them pass).
      if (c === '\\' && (cmd[i + 1] === '"' || cmd[i + 1] === '\\')) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === '"') inDouble = false
        out.push(c === '{' ? ' ' : c)
        i++
      }
    } else {
      // Unquoted: `\` escapes any next char.
      if (c === '\\' && i + 1 < cmd.length) {
        out.push(c, cmd[i + 1]!)
        i += 2
      } else {
        if (c === "'") inSingle = true
        else if (c === '"') inDouble = true
        out.push(c)
        i++
      }
    }
  }
  return out.join('')
}

// 美元符号常量。写成 `String.fromCharCode(0x24)` 而不是字面量，是为了让这个字符在源码里不以美元形式出现——避免被某些模板或构建步骤误当变量插值。
const DOLLAR = String.fromCharCode(0x24)

/**
 * Parse a bash command string and extract a flat list of simple commands.
 * Returns 'too-complex' if the command uses any shell feature we can't
 * statically analyze. Returns 'parse-unavailable' if tree-sitter WASM isn't
 * loaded — caller should fall back to conservative behavior.
 */
// 对外主入口：空串直接返回空命令列表（不调 trim，因为 trim 会吃掉 Unicode 空白，而前置检查必须看见并拒绝它们）；否则先原始解析，解析不可用就返回 parse-unavailable 让调用方回退。
export async function parseForSecurity(
  cmd: string,
): Promise<ParseForSecurityResult> {
  // parseCommandRaw('') returns null (falsy check), so short-circuit here.
  // Don't use .trim() — it strips Unicode whitespace (\u00a0 etc.) which the
  // pre-checks in parseForSecurityFromAst need to see and reject.
  if (cmd === '') return { kind: 'simple', commands: [] }
  const root = await parseCommandRaw(cmd)
  return root === null
    ? { kind: 'parse-unavailable' }
    : parseForSecurityFromAst(cmd, root)
}

/**
 * Same as parseForSecurity but takes a pre-parsed AST root so callers that
 * need the tree for other purposes can parse once and share. Pre-checks
 * still run on `cmd` — they catch tree-sitter/bash differentials that a
 * successful parse doesn't.
 */
// 带预解析树的版本：调用方若已为别的目的解析过，可复用同一棵树。前置检查仍跑在原字符串上——它们捕获的正是「解析成功但 tree-sitter 与 bash 结论不同」的那类差异。
export function parseForSecurityFromAst(
  cmd: string,
  root: Node | typeof PARSE_ABORTED,
): ParseForSecurityResult {
  // Pre-checks: characters that cause tree-sitter and bash to disagree on
  // word boundaries. These run before tree-sitter because they're the known
  // tree-sitter/bash differentials. Everything after this point trusts
  // tree-sitter's tokenization.
// 六道前置检查依次是：控制字符、Unicode 空白、反斜杠转义空白、zsh `~[` 动态目录、zsh `=cmd` 等号展开、花括号与引号混排。这些都是已确认的解析器差异，必须在信任 tree-sitter 分词之前拦下。
  if (CONTROL_CHAR_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains control characters' }
  }
  if (UNICODE_WHITESPACE_RE.test(cmd)) {
    return { kind: 'too-complex', reason: 'Contains Unicode whitespace' }
  }
  if (BACKSLASH_WHITESPACE_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains backslash-escaped whitespace',
    }
  }
  if (ZSH_TILDE_BRACKET_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh ~[ dynamic directory syntax',
    }
  }
  if (ZSH_EQUALS_EXPANSION_RE.test(cmd)) {
    return {
      kind: 'too-complex',
      reason: 'Contains zsh =cmd equals expansion',
    }
  }
  if (BRACE_WITH_QUOTE_RE.test(maskBracesInQuotedContexts(cmd))) {
    return {
      kind: 'too-complex',
      reason: 'Contains brace with quote character (expansion obfuscation)',
    }
  }

  const trimmed = cmd.trim()
  if (trimmed === '') {
    return { kind: 'simple', commands: [] }
  }

// 解析被中止时**必须** fail-closed 判 too-complex。历史教训：中止状态与「模块未加载」无法区分，一起走回退到旧路径，而旧路径缺 EVAL_LIKE_BUILTINS，导致 `trap`、`enable`、`hash` 在 `Bash(*)` 规则下泄漏。中止是**可被对抗性触发**的——约 2800 层数组下标就能在 10K 长度上限内打满解析超时预算。
  if (root === PARSE_ABORTED) {
    // SECURITY: module loaded but parse aborted (timeout / node budget /
    // panic). Adversarially triggerable — `(( a[0][0]... ))` with ~2800
    // subscripts hits PARSE_TIMEOUT_MICROS under the 10K length limit.
    // Previously indistinguishable from module-not-loaded → routed to
    // legacy (parse-unavailable), which lacks EVAL_LIKE_BUILTINS — `trap`,
    // `enable`, `hash` leaked with Bash(*). Fail closed: too-complex → ask.
    return {
      kind: 'too-complex',
      reason:
        'Parser aborted (timeout or resource limit) — possible adversarial input',
      nodeType: 'PARSE_ABORT',
    }
  }

  return walkProgram(root)
}

// 程序根节点的遍历入口。varScope 记录同一命令里早先赋过的变量：`NOW=$(date) && jq --arg now $NOW` 这类写法里，`$NOW` 的值虽非常量但**已知来自哪条内层命令**（已被提取），可以安全用占位符顶替而不必整体判复杂。
function walkProgram(root: Node): ParseForSecurityResult {
  // ERROR-node check folded into collectCommands — any unhandled node type
  // (including ERROR) falls through to tooComplex() in the default branch.
  // Avoids a separate full-tree walk for error detection.
  const commands: SimpleCommand[] = []
  // Track variables assigned earlier in the same command. When a
  // simple_expansion ($VAR) references a tracked var, we can substitute
  // a placeholder instead of returning too-complex. Enables patterns like
  // `NOW=$(date) && jq --arg now "$NOW" ...` — $NOW is known to be the
  // $(date) output (already extracted as inner command).
  const varScope = new Map<string, string>()
  const err = collectCommands(root, commands, varScope)
  if (err) return err
  return { kind: 'simple', commands }
}

/**
 * Recursively collect leaf `command` nodes from a structural wrapper node.
 * Returns an error result on any disallowed node type, or null on success.
 */
// 递归收集叶子 command 节点。注意 `commands` 在这里同时充当「内层命令累加器」——walkCommand 途中提取出的每个 `$()` 内层命令都会追加进来，于是外层与内层都会各自过一遍权限规则。
function collectCommands(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  if (node.type === 'command') {
    // Pass `commands` as the innerCommands accumulator — any $() extracted
    // during walkCommand gets appended alongside the outer command.
    const result = walkCommand(node, [], commands, varScope)
    if (result.kind !== 'simple') return result
    commands.push(...result.commands)
    return null
  }

  if (node.type === 'redirected_statement') {
    return walkRedirectedStatement(node, commands, varScope)
  }

  if (node.type === 'comment') {
    return null
  }

  if (STRUCTURAL_TYPES.has(node.type)) {
// 作用域传播的**核心安全规则**：`||` 右侧条件执行（变量可能没设）、`|` 与 `|&` 各段在子 shell 里跑（设了也传不出来）、`&` 左侧在后台子 shell。若让 varScope 线性流过这些分隔符就有「省略 flag」攻击：`true || FLAG=--dry-run && cmd $FLAG`，bash 跳过右侧、`$FLAG` 为空、cmd 不带 dry-run 跑；而我们按线性作用域会给出带 `--dry-run` 的 argv，看起来更安全，实际放过了真实命令。做法：进入时快照，遇这四种分隔符就重置回快照；`&&` 与 `;` 是顺序执行，正常传递。为省掉绝大多数命令（`ls`、`git status`）的 Map 分配，先用一次廉价预扫描判断是否真存在需要快照的分隔符。
    // SECURITY: `||`, `|`, `|&`, `&` must NOT carry varScope linearly. In bash:
    //   `||` RHS runs conditionally → vars set there MAY not be set
    //   `|`/`|&` stages run in subshells → vars set there are NEVER visible after
    //   `&` LHS runs in a background subshell → same as above
    // Flag-omission attack: `true || FLAG=--dry-run && cmd $FLAG` — bash skips
    // the `||` RHS (FLAG unset → $FLAG empty), runs `cmd` WITHOUT --dry-run.
    // With linear scope, our argv has ['cmd','--dry-run'] → looks SAFE → bypass.
    //
    // Fix: snapshot incoming scope at entry. After these separators, reset to
    // the snapshot — vars set in clauses between separators don't leak. `scope`
    // for clauses BETWEEN `&&`/`;` chains shares state (common `VAR=x && cmd
    // $VAR`). `scope` crosses `||`/`|`/`&` as the pre-structure snapshot only.
    //
    // `&&` and `;` DO carry scope: `VAR=x && cmd $VAR` is sequential, VAR is set.
    //
    // NOTE: `scope` and `varScope` diverge after the first `||`/`|`/`&`. The
    // caller's varScope is only mutated for the `&&`/`;` prefix — this is
    // conservative (vars set in `A && B | C && D` leak A+B into caller, not
    // C+D) but safe.
    //
    // Efficiency: snapshot is only needed if we hit `||`/`|`/`|&`/`&`. For
    // the dominant case (`ls`, `git status` — no such separators), skip the
    // Map alloc via a cheap pre-scan. For `pipeline`, node.type already tells
    // us stages are subshells — copy once at entry, no snapshot needed (each
    // reset uses the entry copy pattern via varScope, which is untouched).
    const isPipeline = node.type === 'pipeline'
    let needsSnapshot = false
    if (!isPipeline) {
      for (const c of node.children) {
        if (c && (c.type === '||' || c.type === '&')) {
          needsSnapshot = true
          break
        }
      }
    }
    const snapshot = needsSnapshot ? new Map(varScope) : null
    // For `pipeline`, ALL stages run in subshells — start with a copy so
    // nothing mutates caller's scope. For `list`/`program`, the `&&`/`;`
    // chain mutates caller's scope (sequential); fork only on `||`/`&`.
    let scope = isPipeline ? new Map(varScope) : varScope
    for (const child of node.children) {
      if (!child) continue
      if (SEPARATOR_TYPES.has(child.type)) {
        if (
          child.type === '||' ||
          child.type === '|' ||
          child.type === '|&' ||
          child.type === '&'
        ) {
          // For pipeline: varScope is untouched (we started with a copy).
          // For list/program: snapshot is non-null (pre-scan set it).
          // `|`/`|&` only appear under `pipeline` nodes; `||`/`&` under list.
          scope = new Map(snapshot ?? varScope)
        }
        continue
      }
      const err = collectCommands(child, commands, scope)
      if (err) return err
    }
    return null
  }

// `! cmd` 只反转退出码，不执行额外代码、不影响 argv。CI 里常见（`! grep err`、`! git diff --quiet`）。剥掉感叹号后递归进去即可。
  if (node.type === 'negated_command') {
    // `! cmd` inverts exit code only — doesn't execute code or affect
    // argv. Recurse into the wrapped command. Common in CI: `! grep err`,
    // `! test -f lock`, `! git diff --quiet`.
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '!') continue
      return collectCommands(child, commands, varScope)
    }
    return null
  }

// `export`、`local`、`readonly`、`declare`、`typeset` 在 tree-sitter 里是独立节点类型，以前全部落到 too-complex。这里把内建名当 argv[0]（于是 `Bash(export:*)` 这类规则能匹配），值走 walkVariableAssignment 验证——值里的 `$()` 会被递归提取，外层拿占位符。
  if (node.type === 'declaration_command') {
    // `export`/`local`/`readonly`/`declare`/`typeset`. tree-sitter emits
    // these as declaration_command, not command, so they previously fell
    // through to tooComplex. Values are validated via walkVariableAssignment:
    // `$()` in the value is recursively extracted (inner command pushed to
    // commands[], outer argv gets CMDSUB_PLACEHOLDER); other disallowed
    // expansions still reject via walkArgument. argv[0] is the builtin name so
    // `Bash(export:*)` rules match.
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'export':
        case 'local':
        case 'readonly':
        case 'declare':
        case 'typeset':
          argv.push(child.text)
          break
        case 'word':
        case 'number':
        case 'raw_string':
        case 'string':
        case 'concatenation': {
          // Flags (`declare -r`), quoted names (`export "FOO=bar"`), numbers
          // (`declare -i 42`). Mirrors walkCommand's argv handling — before
          // this, `export "FOO=bar"` hit tooComplex on the `string` child.
          // walkArgument validates each (expansions still reject).
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          // SECURITY: declare/typeset/local flags that change assignment
          // semantics break our static model. -n (nameref): `declare -n X=Y`
          // then `$X` dereferences to $Y's VALUE — varScope stores 'Y'
          // (target NAME), argv[0] shows 'Y' while bash runs whatever $Y
          // holds. -i (integer): `declare -i X='a[$(cmd)]'` arithmetically
          // evaluates the RHS at assignment time, running $(cmd) even from
          // a single-quoted raw_string (same primitive walkArithmetic
          // guards in $((…))). -a/-A (array): subscript arithmetic on
          // assignment. -r/-x/-g/-p/-f/-F are inert. Check the resolved
          // arg (not child.text) so `\-n` and quoted `-n` are caught.
          // Scope to declare/typeset/local only: `export -n` means "remove
          // export attribute" (not nameref), and export/readonly don't
          // accept -i; readonly -a/-A rejects subscripted args as invalid
          // identifiers so subscript-arith doesn't fire.
// declare 系列的语义改变型 flag 必须拒绝：`-n`（nameref，`declare -n X=Y` 后 `$X` 解引用到 `$Y` 的**值**，而我们只记住名字）；`-i`（整数，赋值时就会算术求值，`declare -i X='a[$(cmd)]'` 会在单引号字符串里就跑掉 cmd）；`-a`/`-A`（数组，赋值时下标要做算术）。`-r`/`-x`/`-g`/`-p`/`-f`/`-F` 是惰性的。检查的是**已解析**的 arg 而非原始文本，这样 转义写法与加引号写法的 `-n` 也能抓到。范围限定在 declare/typeset/local——`export -n` 是「移除导出属性」不是 nameref，readonly 不接受 `-i`。
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            /^-[a-zA-Z]*[niaA]/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare flag ${arg} changes assignment semantics (nameref/integer/array)`,
              nodeType: 'declaration_command',
            }
          }
          // SECURITY: bare positional assignment with a subscript also
          // evaluates — no -a/-i flag needed. `declare 'x[$(id)]=val'`
          // implicitly creates an array element, arithmetically evaluating
          // the subscript and running $(id). tree-sitter delivers the
          // single-quoted form as a raw_string leaf so walkArgument sees
          // only the literal text. Scoped to declare/typeset/local:
          // export/readonly reject `[` in identifiers before eval.
// 不需要任何 flag 的第二条路：裸位置赋值带下标也会求值。`declare 'x[$(id)]=val'` 隐式创建数组元素，下标按算术求值，单引号字符串照样执行。tree-sitter 把单引号形式当不透明叶子，walkArgument 只看得到字面文本。同样只限 declare/typeset/local——export 与 readonly 在求值前就会拒绝含方括号的标识符。
          if (
            (argv[0] === 'declare' ||
              argv[0] === 'typeset' ||
              argv[0] === 'local') &&
            arg[0] !== '-' &&
            /^[^=]*\[/.test(arg)
          ) {
            return {
              kind: 'too-complex',
              reason: `declare positional '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
              nodeType: 'declaration_command',
            }
          }
          argv.push(arg)
          break
        }
        case 'variable_assignment': {
          const ev = walkVariableAssignment(child, commands, varScope)
          if ('kind' in ev) return ev
          // export/declare assignments populate the scope so later $VAR refs resolve.
          applyVarToScope(varScope, ev)
          argv.push(`${ev.name}=${ev.value}`)
          break
        }
        case 'variable_name':
          // `export FOO` — bare name, no assignment.
          argv.push(child.text)
          break
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

// 语句级的裸赋值 `VAR=value`：不执行代码、不碰文件系统，**不进 commands 数组**（惰性语句不需要权限规则）。值仍走完整验证，所以 `VAR=$(evil)` 依旧会被内层命令检查拦下。这条曾经占头部五千万条命令里 too-complex 的约三成五。
  if (node.type === 'variable_assignment') {
    // Bare `VAR=value` at statement level (not a command env prefix).
    // Sets a shell variable — no code execution, no filesystem I/O.
    // The value is validated via walkVariableAssignment → walkArgument,
    // so `VAR=$(evil)` still recursively extracts/rejects based on the
    // inner command. Does NOT push to commands — a bare assignment needs
    // no permission rule (it's inert). Common pattern: `VAR=x && cmd`
    // where cmd references $VAR. ~35% of too-complex in top-5k ant cmds.
    const ev = walkVariableAssignment(node, commands, varScope)
    if ('kind' in ev) return ev
    // Populate scope so later `$VAR` references resolve.
    applyVarToScope(varScope, ev)
    return null
  }

// for 循环：正文只提取一次（每次迭代跑的是同一批命令）。**循环变量永远当未知值**（占位符），哪怕迭代词看起来是静态的——绝对路径会藏住目标、glob 解析时才展开、`-rf /` 这种还能走私 flag。后果是正文里裸 `$i` 判复杂，只有嵌进字符串（`echo` 后接引号包裹的 `item: $i`）才留 simple；这条曾经把原 PR 里一批「复杂转简单」的救援全部回退，因为每一个都是潜在的路径校验绕过。
  if (node.type === 'for_statement') {
    // `for VAR in WORD...; do BODY; done` — iterate BODY once per word.
    // Body commands extracted once; every iteration runs the same commands.
    //
    // SECURITY: Loop var is ALWAYS treated as unknown-value (VAR_PLACEHOLDER).
    // Even "static" iteration words can be:
    //  - Absolute paths: `for i in /etc/passwd; do rm $i; done` — body argv
    //    would have placeholder, path validation never sees /etc/passwd.
    //  - Globs: `for i in /etc/*; do rm $i; done` — `/etc/*` is a static word
    //    at parse time but bash expands it at runtime.
    //  - Flags: `for i in -rf /; do rm $i; done` — flag smuggling.
    //
    // VAR_PLACEHOLDER means bare `$i` in body → too-complex. Only
    // string-embedding (`echo "item: $i"`) stays simple. This reverts some
    // of the too-complex→simple rescues in the original PR — each one was a
    // potential path-validation bypass.
    let loopVar: string | null = null
    let doGroup: Node | null = null
    for (const child of node.children) {
      if (!child) continue
      if (child.type === 'variable_name') {
        loopVar = child.text
      } else if (child.type === 'do_group') {
        doGroup = child
      } else if (
        child.type === 'for' ||
        child.type === 'in' ||
        child.type === 'select' ||
        child.type === ';'
      ) {
        continue // structural tokens
      } else if (child.type === 'command_substitution') {
        // `for i in $(seq 1 3)` — inner cmd IS extracted and rule-checked.
        const err = collectCommandSubstitution(child, commands, varScope)
        if (err) return err
      } else {
        // Iteration values — validated via walkArgument. Value discarded:
        // body argv gets VAR_PLACEHOLDER regardless of the iteration words,
        // and bare `$i` in body → too-complex (see SECURITY comment above).
        // We still validate to reject e.g. `for i in $(cmd); do ...; done`
        // where the iteration word itself is a disallowed expansion.
        const arg = walkArgument(child, commands, varScope)
        if (typeof arg !== 'string') return arg
      }
    }
    if (loopVar === null || doGroup === null) return tooComplex(node)
    // SECURITY: `for PS4 in '$(id)'; do set -x; :; done` sets PS4 directly
    // via varScope.set below — walkVariableAssignment's PS4/IFS checks never
    // fire. Trace-time RCE (PS4) or word-split bypass (IFS). No legit use.
// `for PS4 in '$(id)'; do set -x; :; done` 会绕过 walkVariableAssignment 里的 PS4 检查——循环变量是直接写进作用域的。设置 PS4 等于追踪期任意代码执行，设置 IFS 等于切词规则被换掉，两者都没有正当用途。
    if (loopVar === 'PS4' || loopVar === 'IFS') {
      return {
        kind: 'too-complex',
        reason: `${loopVar} as loop variable bypasses assignment validation`,
        nodeType: 'for_statement',
      }
    }
    // SECURITY: Body uses a scope COPY — vars assigned inside the loop
    // body don't leak to commands after `done`. The loop var itself is
    // set in the REAL scope (bash semantics: $i still set after loop)
    // and copied into the body scope. ALWAYS VAR_PLACEHOLDER — see above.
    varScope.set(loopVar, VAR_PLACEHOLDER)
    const bodyScope = new Map(varScope)
    for (const c of doGroup.children) {
      if (!c) continue
      if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
      const err = collectCommands(c, commands, bodyScope)
      if (err) return err
    }
    return null
  }

// if / while：条件命令与所有分支体都提取出来逐条检查。分支体用作用域**副本**——`if false; then T=safe; fi && rm $T` 里的 `$T` 必须拒绝，因为分支可能不执行。条件部分用真实作用域，因为它总是会跑；`while read VAR` 的变量追踪正是在这里落到真实作用域，供正文副本继承。tree-sitter 的 if 子节点里条件与 then 体靠 `then` 记号区分，用一个 seenThen 布尔跟踪。
  if (node.type === 'if_statement' || node.type === 'while_statement') {
    // `if COND; then BODY; [elif...; else...;] fi`
    // `while COND; do BODY; done`
    // Extract condition command(s) + all branch/body commands. All get
    // checked against permission rules. `while read VAR` tracks VAR so
    // body can reference $VAR.
    //
    // SECURITY: Branch bodies use scope COPIES — vars assigned inside a
    // conditional branch (which may not execute) must not leak to commands
    // after fi/done. `if false; then T=safe; fi && rm $T` must reject $T.
    // Condition commands use the REAL varScope (they always run for the
    // check, so assignments there are unconditional — e.g., `while read V`
    // tracking must persist to the body copy).
    //
    // tree-sitter if_statement children: if, COND..., then, THEN-BODY...,
    // [elif_clause...], [else_clause], fi. We distinguish condition from
    // then-body by tracking whether we've seen the `then` token.
    let seenThen = false
    for (const child of node.children) {
      if (!child) continue
      if (
        child.type === 'if' ||
        child.type === 'fi' ||
        child.type === 'else' ||
        child.type === 'elif' ||
        child.type === 'while' ||
        child.type === 'until' ||
        child.type === ';'
      ) {
        continue
      }
      if (child.type === 'then') {
        seenThen = true
        continue
      }
      if (child.type === 'do_group') {
        // while body: recurse with scope COPY (body assignments don't leak
        // past done). The COPY contains any `read VAR` tracking from the
        // condition (already in real varScope at this point).
        const bodyScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (c.type === 'do' || c.type === 'done' || c.type === ';') continue
          const err = collectCommands(c, commands, bodyScope)
          if (err) return err
        }
        continue
      }
      if (child.type === 'elif_clause' || child.type === 'else_clause') {
        // elif_clause: elif, cond, ;, then, body... / else_clause: else, body...
        // Scope COPY — elif/else branch assignments don't leak past fi.
        const branchScope = new Map(varScope)
        for (const c of child.children) {
          if (!c) continue
          if (
            c.type === 'elif' ||
            c.type === 'else' ||
            c.type === 'then' ||
            c.type === ';'
          ) {
            continue
          }
          const err = collectCommands(c, commands, branchScope)
          if (err) return err
        }
        continue
      }
      // Condition (seenThen=false) or then-body (seenThen=true).
      // Condition uses REAL varScope (always runs). Then-body uses a COPY.
      // Special-case `while read VAR`: after condition `read VAR` is
      // collected, track VAR in the REAL scope so the body COPY inherits it.
      const targetScope = seenThen ? new Map(varScope) : varScope
      const before = commands.length
      const err = collectCommands(child, commands, targetScope)
      if (err) return err
      // If condition included `read VAR...`, track vars in REAL scope.
      // read var value is UNKNOWN (stdin input) → use VAR_PLACEHOLDER
      // (unknown-value sentinel, string-only).
      if (!seenThen) {
        for (let i = before; i < commands.length; i++) {
          const c = commands[i]
          if (c?.argv[0] === 'read') {
            for (const a of c.argv.slice(1)) {
              // Skip flags (-r, -d, etc.); track bare identifier args as var names.
              if (!a.startsWith('-') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(a)) {
                // SECURITY: commands[] is a flat accumulator. `true || read
                // VAR` in the condition: the list handler correctly uses a
                // scope COPY for the ||-RHS (may not run), but `read VAR`
                // IS still pushed to commands[] — we can't tell it was
                // scope-isolated from here. Same for `echo | read VAR`
                // (pipeline, subshell in bash) and `(read VAR)` (subshell).
                // Overwriting a tracked literal with VAR_PLACEHOLDER hides
                // path traversal: `VAR=../../etc/passwd && if true || read
                // VAR; then cat "/tmp/$VAR"; fi` — parser would see
                // /tmp/__TRACKED_VAR__, bash reads /etc/passwd. Fail closed
                // when a tracked literal would be overwritten. Safe case
                // (no prior value or already a placeholder) → proceed.
                const existing = varScope.get(a)
                if (
                  existing !== undefined &&
                  !containsAnyPlaceholder(existing)
                ) {
                  return {
                    kind: 'too-complex',
                    reason: `'read ${a}' in condition may not execute (||/pipeline/subshell); cannot prove it overwrites tracked literal '${existing}'`,
                    nodeType: 'if_statement',
                  }
                }
                varScope.set(a, VAR_PLACEHOLDER)
              }
            }
          }
        }
      }
    }
    return null
  }

// 子 shell `(cmd1; cmd2)`：内层命令确实会执行，必须提取出来过权限规则；但作用域隔离——用副本，外部变量可见，内部改动丢弃。
  if (node.type === 'subshell') {
    // `(cmd1; cmd2)` — run commands in a subshell. Inner commands ARE
    // executed, so extract them for permission checking. Subshell has
    // isolated scope: vars set inside don't leak out. Use a COPY of
    // varScope (outer vars visible, inner changes discarded).
    const innerScope = new Map(varScope)
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '(' || child.type === ')') continue
      const err = collectCommands(child, commands, innerScope)
      if (err) return err
    }
    return null
  }

// `[[ EXPR ]]` 与 `[ EXPR ]`：无代码执行（内层若有 `$()` 会是子节点，走 walkArgument 时被拒）。合成一条 argv[0] 为双方括号的命令推入列表，让权限规则能匹配到。
  if (node.type === 'test_command') {
    // `[[ EXPR ]]` or `[ EXPR ]` — conditional test. Evaluates to true/false
    // based on file tests (-f, -d), string comparisons (==, !=), etc.
    // No code execution (no command_substitution inside — that would be a
    // child and we'd recurse into it via walkArgument and reject it).
    // Push as a synthetic command with argv[0]='[[' so permission rules
    // can match — `Bash([[ :*)` would be unusual but legal.
    // Walk arguments to validate (no cmdsub/expansion inside operands).
    const argv: string[] = ['[[']
    for (const child of node.children) {
      if (!child) continue
      if (child.type === '[[' || child.type === ']]') continue
      if (child.type === '[' || child.type === ']') continue
      // Recurse into test expression structure: unary_expression,
      // binary_expression, parenthesized_expression, negated_expression.
      // The leaves are test_operator (-f, -d, ==) and operand words.
      const err = walkTestExpr(child, argv, commands, varScope)
      if (err) return err
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

// `unset`：只从当前 shell 删变量或函数，无代码执行、无文件 IO，以前落到 too-complex 纯属没写这个分支。**关键副作用**：删变量时必须同步从 varScope 删掉，否则 `VAR=safe && unset VAR && rm $VAR` 会把 `$VAR` 解析成 safe。
  if (node.type === 'unset_command') {
    // `unset FOO BAR`, `unset -f func`. Safe: only removes shell
    // variables/functions from the current shell — no code execution, no
    // filesystem I/O. tree-sitter emits a dedicated node type so it
    // previously fell through to tooComplex. Children: `unset` keyword,
    // `variable_name` for each name, `word` for flags like `-f`/`-v`.
    const argv: string[] = []
    for (const child of node.children) {
      if (!child) continue
      switch (child.type) {
        case 'unset':
          argv.push(child.text)
          break
        case 'variable_name':
          argv.push(child.text)
          // SECURITY: unset removes the var from bash's scope. Remove from
          // varScope so subsequent `$VAR` references correctly reject.
          // `VAR=safe && unset VAR && rm $VAR` must NOT resolve $VAR.
          varScope.delete(child.text)
          break
        case 'word': {
          const arg = walkArgument(child, commands, varScope)
          if (typeof arg !== 'string') return arg
          argv.push(arg)
          break
        }
        default:
          return tooComplex(child)
      }
    }
    commands.push({ argv, envVars: [], redirects: [], text: node.text })
    return null
  }

  return tooComplex(node)
}

/**
 * Recursively walk a test_command expression tree (unary/binary/negated/
 * parenthesized expressions). Leaves are test_operator tokens and operands
 * (word/string/number/etc). Operands are validated via walkArgument.
 */
// 测试表达式的递归遍历：一元、二元、取反、括号表达式往里钻；操作符与 pattern 叶子直接进 argv；其余操作数走 walkArgument 验证。
function walkTestExpr(
  node: Node,
  argv: string[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  switch (node.type) {
    case 'unary_expression':
    case 'binary_expression':
    case 'negated_expression':
    case 'parenthesized_expression': {
      for (const c of node.children) {
        if (!c) continue
        const err = walkTestExpr(c, argv, innerCommands, varScope)
        if (err) return err
      }
      return null
    }
    case 'test_operator':
    case '!':
    case '(':
    case ')':
    case '&&':
    case '||':
    case '==':
    case '=':
    case '!=':
    case '<':
    case '>':
    case '=~':
      argv.push(node.text)
      return null
    case 'regex':
    case 'extglob_pattern':
      // RHS of =~ or ==/!= in [[ ]]. Pattern text only — no code execution.
      // Parser emits these as leaf nodes with no children (any $(...) or ${...}
      // inside the pattern is a sibling, not a child, and is walked separately).
      argv.push(node.text)
      return null
    default: {
      // Operand — word, string, number, etc. Validate via walkArgument.
      const arg = walkArgument(node, innerCommands, varScope)
      if (typeof arg !== 'string') return arg
      argv.push(arg)
      return null
    }
  }
}

/**
 * A `redirected_statement` wraps a command (or pipeline) plus one or more
 * `file_redirect`/`heredoc_redirect` nodes. Extract redirects, walk the
 * inner command, attach redirects to the LAST command (the one whose output
 * is being redirected).
 */
// 重定向语句：先收集所有 file_redirect 与 heredoc_redirect，再遍历内部命令，最后把重定向挂到**最后一条**命令上（输出被重定向的那条）。只有重定向没有命令（`> file`）是合法 bash（截断文件），用空 argv 的合成命令表示，让下游看见这次写入。
function walkRedirectedStatement(
  node: Node,
  commands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  const redirects: Redirect[] = []
  let innerCommand: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_redirect') {
      // Thread `commands` so $() in redirect targets (e.g., `> $(mktemp)`)
      // extracts the inner command for permission checking.
      const r = walkFileRedirect(child, commands, varScope)
      if ('kind' in r) return r
      redirects.push(r)
    } else if (child.type === 'heredoc_redirect') {
      const r = walkHeredocRedirect(child)
      if (r) return r
    } else if (
      child.type === 'command' ||
      child.type === 'pipeline' ||
      child.type === 'list' ||
      child.type === 'negated_command' ||
      child.type === 'declaration_command' ||
      child.type === 'unset_command'
    ) {
      innerCommand = child
    } else {
      return tooComplex(child)
    }
  }

  if (!innerCommand) {
    // `> file` alone is valid bash (truncates file). Represent as a command
    // with empty argv so downstream sees the write.
    commands.push({ argv: [], envVars: [], redirects, text: node.text })
    return null
  }

  const before = commands.length
  const err = collectCommands(innerCommand, commands, varScope)
  if (err) return err
  if (commands.length > before && redirects.length > 0) {
    const last = commands[commands.length - 1]
    if (last) last.redirects.push(...redirects)
  }
  return null
}

/**
 * Extract operator + target from a `file_redirect` node. The target must be
 * a static word or string.
 */
// file_redirect 拆出操作符、目标、可选 fd。目标必须是静态词或字符串。
function walkFileRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): Redirect | ParseForSecurityResult {
  let op: Redirect['op'] | null = null
  let target: string | null = null
  let fd: number | undefined

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'file_descriptor') {
      fd = Number(child.text)
    } else if (child.type in REDIRECT_OPS) {
      op = REDIRECT_OPS[child.type] ?? null
    } else if (child.type === 'word' || child.type === 'number') {
// 数字节点也可能带展开子节点：tree-sitter 的算术进制语法 `NN#` 会让 `10#$(cmd)` 成为 number 节点，文本是完整字面量、子节点却是命令替换，bash 会在运行时执行它。所以只要 number 节点有子节点就拒绝。
      // SECURITY: `number` nodes can contain expansion children via the
      // `NN#<expansion>` arithmetic-base grammar quirk — same issue as
      // walkArgument's number case. `> 10#$(cmd)` runs cmd at runtime.
      // Plain word/number nodes have zero children.
      if (child.children.length > 0) return tooComplex(child)
      // Symmetry with walkArgument (~608): `echo foo > {a,b}` is an
      // ambiguous redirect in bash. tree-sitter actually emits a
      // `concatenation` node for brace targets (caught by the default
      // branch below), but check `word` text too for defense-in-depth.
      if (BRACE_EXPANSION_RE.test(child.text)) return tooComplex(child)
      // Unescape backslash sequences — same as walkArgument. Bash quote
      // removal turns `\X` → `X`. Without this, `cat < /proc/self/\environ`
      // stores target `/proc/self/\environ` which evades PROC_ENVIRON_RE,
      // but bash reads /proc/self/environ.
// 重定向目标同样要做反斜杠还原（与 walkArgument 一致的引号剥离语义）。不还原就会出现绕过：`cat < /proc/self/反斜杠加 environ` 存下的目标带反斜杠，匹配不上 environ 检测，而 bash 读的正是那个文件。
      target = child.text.replace(/\\(.)/g, '$1')
    } else if (child.type === 'raw_string') {
      target = stripRawString(child.text)
    } else if (child.type === 'string') {
      const s = walkString(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else if (child.type === 'concatenation') {
      // `echo > "foo"bar` — tree-sitter produces a concatenation of string +
      // word children. walkArgument already validates concatenation (rejects
      // expansions, checks brace syntax) and returns the joined text.
      const s = walkArgument(child, innerCommands, varScope)
      if (typeof s !== 'string') return s
      target = s
    } else {
      return tooComplex(child)
    }
  }

  if (!op || target === null) {
    return {
      kind: 'too-complex',
      reason: 'Unrecognized redirect shape',
      nodeType: node.type,
    }
  }
  return { op, target, fd }
}

/**
 * Heredoc redirect. Only quoted-delimiter heredocs (<<'EOF') are safe —
 * their bodies are literal text. Unquoted-delimiter heredocs (<<EOF)
 * undergo full parameter/command/arithmetic expansion in the body.
 *
 * SECURITY: tree-sitter-bash has a grammar gap — backticks (`...`) inside
 * an unquoted heredoc body are NOT parsed as command_substitution nodes
 * (body.children is empty, backticks are in body.text). But bash DOES
 * execute them. We cannot safely relax the quoted-delimiter requirement
 * by checking body children for expansion nodes — we'd miss backtick
 * substitution. Keep rejecting all unquoted heredocs. Users should use
 * <<'EOF' to get a literal body, which the model already prefers.
 */
// heredoc 只放行**定界符被引号包裹**的形式：正文是纯字面文本。未加引号的定界符会做完整的参数、命令、算术展开。**这里有一个无法补救的语法缺口**：tree-sitter 不把未引号 heredoc 正文里的反引号解析成命令替换节点（正文子节点为空，反引号藏在文本里），bash 却会执行——所以不能靠「检查正文子节点」来放宽要求，只能整类拒绝。
function walkHeredocRedirect(node: Node): ParseForSecurityResult | null {
  let startText: string | null = null
  let body: Node | null = null

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'heredoc_start') startText = child.text
    else if (child.type === 'heredoc_body') body = child
    else if (
      child.type === '<<' ||
      child.type === '<<-' ||
      child.type === 'heredoc_end' ||
      child.type === 'file_descriptor'
    ) {
      // expected structural tokens — safe to skip. file_descriptor
      // covers fd-prefixed heredocs (`cat 3<<'EOF'`) — walkFileRedirect
      // already treats it as a benign structural token.
// 定界符同一行后面若还跟着管道、命令、重定向，tree-sitter 会把它们挂成 heredoc_redirect 的子节点。以前这些被静默跳过，等于把 `ls 配 heredoc 接 rm x` 里的 rm 藏起来不检查。与其他所有遍历分支一致：fail-closed 拒绝。
    } else {
      // SECURITY: tree-sitter places pipeline / command / file_redirect /
      // && / etc. as children of heredoc_redirect when they follow the
      // delimiter on the same line (e.g. `ls <<'EOF' | rm x`). Previously
      // these were silently skipped, hiding the piped command from
      // permission checks. Fail closed like every other walker.
      return tooComplex(child)
    }
  }

  const isQuoted =
    startText !== null &&
    ((startText.startsWith("'") && startText.endsWith("'")) ||
      (startText.startsWith('"') && startText.endsWith('"')) ||
      startText.startsWith('\\'))

  if (!isQuoted) {
    return {
      kind: 'too-complex',
      reason: 'Heredoc with unquoted delimiter undergoes shell expansion',
      nodeType: 'heredoc_redirect',
    }
  }

  if (body) {
    for (const child of body.children) {
      if (!child) continue
      if (child.type !== 'heredoc_content') {
        return tooComplex(child)
      }
    }
  }
  return null
}

/**
 * Here-string redirect (`<<< content`). The content becomes stdin — not
 * argv, not a path. Safe when content is a literal word, raw_string, or
 * string with no expansions. Reject when content contains $()/${}/$VAR —
 * those execute arbitrary code or inject runtime values.
 *
 * Reuses walkArgument for content validation: it already rejects
 * command_substitution, expansion, and (for strings) simple_expansion
 * unless the var is tracked/safe. The result string is discarded — we only
 * care that it's statically resolvable.
 *
 * NOTE: `VAR=$(cmd) && cat <<< "$VAR"` would be safe in principle (inner
 * cmd is extracted separately, herestring content is stdin) but is
 * currently rejected conservatively — walkString's solo-placeholder guard
 * fires because it has no awareness of herestring vs argv context.
 */
// here-string（三箭头）：内容进 stdin，不是 argv 也不是路径，只要静态可解析就安全。复用 walkArgument 做验证，结果字符串**丢弃**——我们只关心它能否静态确定。另有一步：内容虽不进 argv，但仍留在原始文本里，所以要在内容上补扫「换行加井号」这条下游依赖的不变式。
function walkHerestringRedirect(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.type === '<<<') continue
    // Content node: reuse walkArgument. It returns a string on success
    // (which we discard — content is stdin, irrelevant to permissions) or
    // a too-complex result on failure (expansion found, unresolvable var).
    const content = walkArgument(child, innerCommands, varScope)
    if (typeof content !== 'string') return content
    // Herestring content is discarded (not in argv/envVars/redirects) but
    // remains in .text via raw node.text. Scan it here so checkSemantics's
    // NEWLINE_HASH invariant (bashPermissions.ts relies on it) still holds.
    if (NEWLINE_HASH_RE.test(content)) return tooComplex(child)
  }
  return null
}

/**
 * Walk a `command` node and extract argv. Children appear in order:
 * [variable_assignment...] command_name [argument...] [file_redirect...]
 * Any child type not explicitly handled triggers too-complex.
 */
// command 节点的主遍历：子节点顺序是「前置赋值... 命令名 参数... 重定向...」。白名单外任何子节点类型都判复杂。
function walkCommand(
  node: Node,
  extraRedirects: Redirect[],
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult {
  const argv: string[] = []
  const envVars: { name: string; value: string }[] = []
  const redirects: Redirect[] = [...extraRedirects]

  for (const child of node.children) {
    if (!child) continue

    switch (child.type) {
      case 'variable_assignment': {
        const ev = walkVariableAssignment(child, innerCommands, varScope)
        if ('kind' in ev) return ev
        // SECURITY: Env-prefix assignments (`VAR=x cmd`) are command-local in
        // bash — VAR is only visible to `cmd` as an env var, NOT to
        // subsequent commands. Do NOT add to global varScope — that would
        // let `VAR=safe cmd1 && rm $VAR` resolve $VAR when bash has unset it.
        envVars.push({ name: ev.name, value: ev.value })
        break
      }
      case 'command_name': {
        const arg = walkArgument(
          child.children[0] ?? child,
          innerCommands,
          varScope,
        )
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
      case 'word':
      case 'number':
      case 'raw_string':
      case 'string':
      case 'concatenation':
      case 'arithmetic_expansion': {
        const arg = walkArgument(child, innerCommands, varScope)
        if (typeof arg !== 'string') return arg
        argv.push(arg)
        break
      }
// **刻意的缺口**：裸的命令替换（不嵌在字符串里）不处理。因为 `$()` 的输出本身就是那个参数，对 `cd`、`rm`、`chmod` 这类路径敏感命令，用占位符等于把真实路径从下游检查里藏掉——`cd $(echo /etc)` 必须保持 too-complex，否则路径校验可被绕过。嵌在字符串里的 `$()`（如引号包裹的 `Timer: $(date)`）另行在 walkString 处理，因为输出与字面内容混在一起，风险低得多。
      // NOTE: command_substitution as a BARE argument (not inside a string)
      // is intentionally NOT handled here — the $() output IS the argument,
      // and for path-sensitive commands (cd, rm, chmod) the placeholder would
      // hide the real path from downstream checks. `cd $(echo /etc)` must
      // stay too-complex so the path-check can't be bypassed. $() inside
      // strings ("Timer: $(date)") is handled in walkString where the output
      // is embedded in a longer string (safer).
      case 'simple_expansion': {
        // Bare `$VAR` as an argument. Tracked static vars return the ACTUAL
        // value (e.g. VAR=/etc → '/etc'). Values with IFS/glob chars or
        // placeholders reject. See resolveSimpleExpansion.
        const v = resolveSimpleExpansion(child, varScope, false)
        if (typeof v !== 'string') return v
        argv.push(v)
        break
      }
      case 'file_redirect': {
        const r = walkFileRedirect(child, innerCommands, varScope)
        if ('kind' in r) return r
        redirects.push(r)
        break
      }
      case 'herestring_redirect': {
        // `cmd <<< "content"` — content is stdin, not argv. Validate it's
        // literal (no expansion); discard the content string.
        const err = walkHerestringRedirect(child, innerCommands, varScope)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }

  // .text is the raw source span. Downstream (bashToolCheckPermission →
  // splitCommand_DEPRECATED) re-tokenizes it via shell-quote. Normally .text
  // is used unchanged — but if we resolved a $VAR into argv, .text diverges
  // (has raw `$VAR`) and downstream RULE MATCHING would miss deny rules.
  //
  // SECURITY: `SUB=push && git $SUB --force` with `Bash(git push:*)` deny:
  //   argv = ['git', 'push', '--force']  ← correct, path validation sees 'push'
  //   .text = 'git $SUB --force'         ← deny rule 'git push:*' doesn't match
  //
  // Detection: any `$<identifier>` in node.text means a simple_expansion was
  // resolved (or we'd have returned too-complex). This catches $VAR at any
  // position — command_name, word, string interior, concatenation part.
  // `$(...)` doesn't match (paren, not identifier start). `'$VAR'` in single
  // quotes: tree-sitter's .text includes the quotes, so a naive check would
  // FP on `echo '$VAR'`. But single-quoted $ is LITERAL in bash — argv has
  // the literal `$VAR` string, so rebuilding from argv produces `'$VAR'`
  // anyway (shell-escape wraps it). Same net .text. No rule-matching error.
  //
  // Rebuild .text from argv. Shell-escape each arg: single-quote wrap with
  // `'\''` for embedded single quotes. Empty string, metacharacters, and
  // placeholders all get quoted. Downstream shell-quote re-parse is correct.
  //
  // NOTE: This does NOT include redirects/envVars in the rebuilt .text —
  // walkFileRedirect rejects simple_expansion, and envVars aren't used for
  // rule matching. If either changes, this rebuild must include them.
  //
  // SECURITY: also rebuild when node.text contains a newline. Line
  // continuations `<space>\<LF>` are invisible to argv (tree-sitter collapses
  // them) but preserved in node.text. `timeout 5 \<LF>curl evil.com` → argv
  // is correct, but raw .text → stripSafeWrappers matches `timeout 5 ` (the
  // space before \), leaving `\<LF>curl evil.com` — Bash(curl:*) deny doesn't
  // prefix-match. Rebuilt .text joins argv with ' ' → no newlines →
  // stripSafeWrappers works. Also covers heredoc-body leakage.
// **.text 重建**：若原始文本里出现「美元符加标识符」或含换行，就改用 argv 重新拼一份文本。原因有三条历史绕过：`SUB=push && git $SUB --force` 的 argv 正确（含 push）、原文却是 `git $SUB --force`，针对 `git push:*` 的拒绝规则看不到；行续接（空格加反斜杠加换行）对 argv 不可见但原文保留，下游剥离包装命令时会卡在续接符上，前缀匹配失效；heredoc 正文也可能泄漏。拼装时对每个参数做 shell 转义（单引号包裹，内部单引号转义成四字符序列），保证下游重新分词得到同样的 argv。注意这里**不含**重定向与环境变量——它们本来就不参与规则匹配。
  const text =
    /\$[A-Za-z_]/.test(node.text) || node.text.includes('\n')
      ? argv
          .map(a =>
            a === '' || /["'\\ \t\n$`;|&<>(){}*?[\]~#]/.test(a)
              ? `'${a.replace(/'/g, "'\\''")}'`
              : a,
          )
          .join(' ')
      : node.text
  return {
    kind: 'simple',
    commands: [{ argv, envVars, redirects, text }],
  }
}

/**
 * Recurse into a command_substitution node's inner command(s). If the inner
 * command(s) parse cleanly (simple), add them to the innerCommands
 * accumulator and return null (success). If the inner command is itself
 * too-complex (e.g., nested arith expansion, process sub), return the error.
 * This enables recursive permission checking: `echo $(git rev-parse HEAD)`
 * extracts BOTH `echo $(git rev-parse HEAD)` (outer) AND `git rev-parse HEAD`
 * (inner) — permission rules must match BOTH for the whole command to allow.
 */
// 递归进入命令替换的内部命令，把内层命令也加入检查队列。作用域用副本（bash 子 shell 语义：外部变量可见，内部赋值不外泄）。这样 `echo $(git rev-parse HEAD)` 会产出外层与内层两条命令，权限规则必须**两条都匹配**才放行。
function collectCommandSubstitution(
  csNode: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): ParseForSecurityResult | null {
  // Vars set BEFORE the $() are visible inside (bash subshell semantics),
  // but vars set INSIDE don't leak out. Pass a COPY of the outer scope so
  // inner assignments don't mutate the outer map.
  const innerScope = new Map(varScope)
  // command_substitution children: `$(` or `` ` ``, inner statement(s), `)`
  for (const child of csNode.children) {
    if (!child) continue
    if (child.type === '$(' || child.type === '`' || child.type === ')') {
      continue
    }
    const err = collectCommands(child, innerCommands, innerScope)
    if (err) return err
  }
  return null
}

/**
 * Convert an argument node to its literal string value. Quotes are resolved.
 * This function implements the argument-position allowlist.
 */
// 参数位置的白名单实现：把参数节点转成字面字符串，引号已剥离。这是整个模块最核心的一张白名单。
function walkArgument(
  node: Node | null,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  if (!node) {
    return { kind: 'too-complex', reason: 'Null argument node' }
  }

  switch (node.type) {
    case 'word': {
      // Unescape backslash sequences. In unquoted context, bash's quote
      // removal turns `\X` → `X` for any character X. tree-sitter preserves
      // the raw text. Required for checkSemantics: `\eval` must match
      // EVAL_LIKE_BUILTINS, `\zmodload` must match ZSH_DANGEROUS_BUILTINS.
      // Also makes argv accurate: `find -exec {} \;` → argv has `;` not
      // `\;`. (Deny-rule matching on .text already worked via downstream
      // splitCommand_DEPRECATED unescaping — see walkCommand comment.) `\<whitespace>`
      // is already rejected by BACKSLASH_WHITESPACE_RE.
// 未加引号的词要做反斜杠还原（bash 的引号剥离会把「反斜杠加 X」变成 X）。必要性：`反斜杠加 eval` 必须能匹配到 eval 类内建名单，`find -exec {} 反斜杠加分号` 的 argv 必须是分号而不是带反斜杠的形式。
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind: 'too-complex',
          reason: 'Word contains brace expansion syntax',
          nodeType: 'word',
        }
      }
      return node.text.replace(/\\(.)/g, '$1')
    }

// number 节点：如前所述，`10#$(cmd)` 会让数字节点带展开子节点，文本会走私 payload。纯数字（`10`、`16#ff`）子节点数为零。
    case 'number':
      // SECURITY: tree-sitter-bash parses `NN#<expansion>` (arithmetic base
      // syntax) as a `number` node with the expansion as a CHILD. `10#$(cmd)`
      // is a number node whose .text is the full literal but whose child is a
      // command_substitution — bash runs the substitution. .text on a node
      // with children would smuggle the expansion past permission checks.
      // Plain numbers (`10`, `16#ff`) have zero children.
      if (node.children.length > 0) {
        return {
          kind: 'too-complex',
          reason: 'Number node contains expansion (NN# arithmetic base syntax)',
          nodeType: node.children[0]?.type,
        }
      }
      return node.text

    case 'raw_string':
      return stripRawString(node.text)

    case 'string':
      return walkString(node, innerCommands, varScope)

// 拼接节点（`prefix$VAR`、`foo` 加引号再接 `bar`）：先查花括号语法，再把每个子片段的结果串起来。任一片段失败就整体失败。
    case 'concatenation': {
      if (BRACE_EXPANSION_RE.test(node.text)) {
        return {
          kind: 'too-complex',
          reason: 'Brace expansion',
          nodeType: 'concatenation',
        }
      }
      let result = ''
      for (const child of node.children) {
        if (!child) continue
        const part = walkArgument(child, innerCommands, varScope)
        if (typeof part !== 'string') return part
        result += part
      }
      return result
    }

// 算术展开：走 walkArithmetic 做递归验证，确认全是字面数字后，把整段 `$((...))` 原样放进 argv——bash 运行时算成整数，这个静态字符串匹配不上任何敏感路径或拒绝模式。
    case 'arithmetic_expansion': {
      const err = walkArithmetic(node)
      if (err) return err
      return node.text
    }

    case 'simple_expansion': {
      // `$VAR` inside a concatenation (e.g., `prefix$VAR`). Same rules
      // as the bare case in walkCommand: must be tracked or SAFE_ENV_VARS.
      // inside-concatenation counts as bare arg (the whole concat IS the arg)
      return resolveSimpleExpansion(node, varScope, false)
    }

    // NOTE: command_substitution at arg position (bare or inside concatenation)
    // is intentionally NOT handled — the output is/becomes-part-of a positional
    // argument which might be a path or flag. `rm $(foo)` or `rm $(foo)bar`
    // would hide the real path behind the placeholder. Only $() inside a
    // `string` node (walkString) is extracted, since the output is embedded
    // in a longer string rather than BEING the argument.

    default:
      return tooComplex(node)
  }
}

/**
 * Extract literal content from a double-quoted string node. A `string` node's
 * children are `"` delimiters, `string_content` literals, and possibly
 * expansion nodes.
 *
 * tree-sitter quirk: literal newlines inside double quotes are NOT included
 * in `string_content` node text. bash preserves them. For `"a\nb"`,
 * tree-sitter produces two `string_content` children (`"a"`, `"b"`) with the
 * newline in neither. For `"\n#"`, it produces ONE child (`"#"`) with the
 * leading newline eaten. Concatenating children therefore loses newlines.
 *
 * Fix: track child `startIndex` and insert one `\n` per index gap. The gap
 * between children IS the dropped newline(s). This makes the argv value
 * match what bash actually sees.
 */
// 双引号字符串：tree-sitter 的一个关键怪癖是**双引号内的字面换行不包含在内容节点文本里**，bash 却保留。所以不能简单拼接子节点文本，必须靠子节点的起止索引差补回换行——两个子节点之间的索引缺口就是被吞掉的换行。
function walkString(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): string | ParseForSecurityResult {
  let result = ''
  let cursor = -1
  // SECURITY: Track whether the string contains a runtime-unknown
  // placeholder ($() output or unknown-value tracked var) vs any literal
  // content. A string that is ONLY a placeholder (`"$(cmd)"`, `"$VAR"`
  // where VAR holds an unknown sentinel) produces an argv element that IS
  // the placeholder — which downstream path validation resolves as a
  // relative filename within cwd, bypassing the check. `cd "$(echo /etc)"`
  // would pass validation but runtime-cd into /etc. We reject
  // solo-placeholder strings; placeholders mixed with literal content
  // (`"prefix: $(cmd)"`) are safe — runtime value can't equal a bare path.
  let sawDynamicPlaceholder = false
  let sawLiteralContent = false
  for (const child of node.children) {
    if (!child) continue
    // Index gap between this child and the previous one = dropped newline(s).
    // Ignore the gap before the first non-delimiter child (cursor === -1).
    // Skip gap-fill for `"` delimiters: a gap before the closing `"` is the
    // tree-sitter whitespace-only-string quirk (space/tab, not newline) — let
    // the Fix C check below catch it as too-complex instead of mis-filling
    // with `\n` and diverging from bash.
// 换行补偿逻辑：只对非引号定界符的子节点补缺口（首个内容子节点之前不补）；闭合引号前的缺口不算，那是「仅空白字符串」怪癖，交给后面的专项检查判复杂，避免我们补成换行反而与 bash 背离。
    if (cursor !== -1 && child.startIndex > cursor && child.type !== '"') {
      result += '\n'.repeat(child.startIndex - cursor)
      sawLiteralContent = true
    }
    cursor = child.endIndex
    switch (child.type) {
      case '"':
        // Reset cursor after opening quote so the gap between `"` and the
        // first content child is captured.
        cursor = child.endIndex
        break
      case 'string_content':
        // Bash double-quote escape rules (NOT the generic /\\(.)/g used for
        // unquoted words in walkArgument): inside "...", a backslash only
        // escapes $ ` " \ — other sequences like \n stay literal. So
        // `"fix \"bug\""` → `fix "bug"`, but `"a\nb"` → `a\nb` (backslash
        // kept). tree-sitter preserves the raw escapes in .text; we resolve
        // them here so argv matches what bash actually passes.
// 双引号内的反斜杠规则**不同于**未加引号：只有 `$`、反引号、引号、反斜杠四个字符会被转义，其他如「反斜杠加 n」保持原样。所以这里用的是专用正则而非通用的「反斜杠加任意字符」还原。
        result += child.text.replace(/\\([$`"\\])/g, '$1')
        sawLiteralContent = true
        break
      case DOLLAR:
        // A bare dollar sign before closing quote or a non-name char is
        // literal in bash. tree-sitter emits it as a standalone node.
        result += DOLLAR
        sawLiteralContent = true
        break
// 字符串里的命令替换分两条路。第一条是特例：`$(cat` 加引号定界符 heredoc `)` 是安全的——正文是字面、cat 只打印，替换结果因此是已知静态字符串，这是给 `gh pr create --body` 传多行正文的惯用法。
      case 'command_substitution': {
        // Carve-out: `$(cat <<'EOF' ... EOF)` is safe. The quoted-delimiter
        // heredoc body is literal (no expansion), and `cat` just prints it.
        // The substitution result is therefore a known static string. This
        // pattern is the idiomatic way to pass multi-line content to tools
        // like `gh pr create --body`. We replace the substitution with a
        // placeholder argv value — the actual content doesn't matter for
        // permission checking, only that it IS static.
        const heredocBody = extractSafeCatHeredoc(child)
        if (heredocBody === 'DANGEROUS') return tooComplex(child)
        if (heredocBody !== null) {
          // SECURITY: the body IS the substitution result. Previously we
          // dropped it → `rm "$(cat <<'EOF'\n/etc/passwd\nEOF)"` produced
          // argv ['rm',''] while bash runs `rm /etc/passwd`. validatePath('')
          // resolves to cwd → allowed. Every path-constrained command
          // bypassed via this. Now: append the body (trailing LF trimmed —
          // bash $() strips trailing newlines).
          //
          // Tradeoff: bodies with internal newlines are multi-line text
          // (markdown, scripts) which cannot be valid paths — safe to drop
          // to avoid NEWLINE_HASH_RE false positives on `## Summary`. A
          // single-line body (like `/etc/passwd`) MUST go into argv so
          // downstream path validation sees the real target.
// 特例里的关键补丁：heredoc 正文**就是**替换结果。以前直接丢弃正文，导致 `rm` 后接引号包裹的 `$(cat` 加 heredoc 正文 `etc/passwd` 得到空 argv 元素，路径校验把空串解析成当前目录并放行，所有路径受限命令都能这么绕。现在的规则：单行正文必须进 argv（真实目标才能被看见），多行正文（markdown、脚本）不可能是合法路径，丢弃以避免「换行加井号」误报。
          const trimmed = heredocBody.replace(/\n+$/, '')
          if (trimmed.includes('\n')) {
            sawLiteralContent = true
            break
          }
          result += trimmed
          sawLiteralContent = true
          break
        }
        // General $() inside "...": recurse into inner command(s). If they
        // parse cleanly, they become additional subcommands that the
        // permission system must match rules against. The outer argv gets
        // the original $() text as placeholder (runtime-determined value).
        // `echo "SHA: $(git rev-parse HEAD)"` → extracts BOTH
        // `echo "SHA: $(...)"` AND `git rev-parse HEAD` — both must match
        // permission rules. ~27% of too-complex in top-5k ant cmds.
        const err = collectCommandSubstitution(child, innerCommands, varScope)
        if (err) return err
        result += CMDSUB_PLACEHOLDER
        sawDynamicPlaceholder = true
        break
      }
      case 'simple_expansion': {
        // `$VAR` inside "...". Tracked/safe vars resolve; untracked reject.
        const v = resolveSimpleExpansion(child, varScope, true)
        if (typeof v !== 'string') return v
        // VAR_PLACEHOLDER = runtime-unknown (loop var, read var, $() output,
        // SAFE_ENV_VARS, special vars). Any other string = actual literal
        // value from a tracked static var (e.g. VAR=/tmp → v='/tmp').
        if (v === VAR_PLACEHOLDER) sawDynamicPlaceholder = true
        else sawLiteralContent = true
        result += v
        break
      }
      case 'arithmetic_expansion': {
        const err = walkArithmetic(child)
        if (err) return err
        result += child.text
        // Validated to be literal-numeric — static content.
        sawLiteralContent = true
        break
      }
      default:
        // expansion (${...}) inside "..."
        return tooComplex(child)
    }
  }
  // SECURITY: Reject solo-placeholder strings. `"$(cmd)"` or `"$VAR"` (where
  // VAR holds an unknown value) would produce an argv element that IS the
  // placeholder — which bypasses downstream path validation (validatePath
  // resolves placeholders as relative filenames within cwd). Only allow
  // placeholders embedded alongside literal content (`"prefix: $(cmd)"`).
// 拒绝「纯占位符字符串」：`$(cmd)` 或值为未知的 `$VAR` 形式（均不带字面内容） 会产出**就是占位符本身**的 argv 元素，下游路径校验会把它当当前目录下的相对文件名解析，`cd` 后接引号包裹的 `$(echo /etc)` 因此通过校验却在运行时进了 /etc。占位符与字面内容混排（`prefix: $(cmd)` 这种字面内容与占位符混排的形式）是安全的——运行时值不可能等于一个裸路径。
  if (sawDynamicPlaceholder && !sawLiteralContent) {
    return tooComplex(node)
  }
  // SECURITY: tree-sitter-bash quirk — a double-quoted string containing
  // ONLY whitespace (` "`, `" "`, `"\t"`) produces NO string_content child;
  // the whitespace is attributed to the closing `"` node's text. Our loop
  // only adds to `result` from string_content/expansion children, so we'd
  // return "" when bash sees " ". Detect: we saw no content children
  // (both flags false — neither literal nor placeholder added) but the
  // source span is longer than bare `""`. Genuine `""` has text.length==2.
  // `"$V"` with V="" doesn't hit this — the simple_expansion child sets
  // sawLiteralContent via the `else` branch even when v is empty.
// tree-sitter 的第二个怪癖：只含空白的双引号字符串（一个空格、一个制表符）**不产生内容子节点**，空白被算进闭合引号节点的文本。我们的循环只从内容或展开子节点累积，于是返回空串而 bash 看到的是空格。检测方式：两个标志都为假（既没字面也没占位符）但源码跨度长于裸空引号（长度 2）。
  if (!sawLiteralContent && !sawDynamicPlaceholder && node.text.length > 2) {
    return tooComplex(node)
  }
  return result
}

/**
 * Safe leaf nodes inside arithmetic expansion: integer literals (decimal,
 * hex, octal, bash base#digits) and operator/paren tokens. Anything else at
 * leaf position (notably variable_name that isn't a numeric literal) rejects.
 */
const ARITH_LEAF_RE =
  /^(?:[0-9]+|0[xX][0-9a-fA-F]+|[0-9]+#[0-9a-zA-Z]+|[-+*/%^&|~!<>=?:(),]+|<<|>>|\*\*|&&|\|\||[<>=!]=|\$\(\(|\)\))$/

/**
 * Recursively validate an arithmetic_expansion node. Allows only literal
 * numeric expressions — no variables, no substitutions. Returns null if
 * safe, or a too-complex result if not.
 *
 * Variables are rejected because bash arithmetic recursively evaluates
 * variable values: if x='a[$(cmd)]' then $((x)) executes cmd. See
 * https://www.vidarholen.net/contents/blog/?p=716 (arithmetic injection).
 *
 * When safe, the caller puts the full `$((…))` span into argv as a literal
 * string. bash will expand it to an integer at runtime; the static string
 * won't match any sensitive path/deny patterns.
 */
// 算术表达式递归验证：只允许字面数字与运算符。变量一律拒绝——bash 的算术会对变量值**再递归求值**，`x` 的值为 `a[$(cmd)]` 时 `$((x))` 就执行了 cmd（经典的算术注入）。
function walkArithmetic(node: Node): ParseForSecurityResult | null {
  for (const child of node.children) {
    if (!child) continue
    if (child.children.length === 0) {
      if (!ARITH_LEAF_RE.test(child.text)) {
        return {
          kind: 'too-complex',
          reason: `Arithmetic expansion references variable or non-literal: ${child.text}`,
          nodeType: 'arithmetic_expansion',
        }
      }
      continue
    }
    switch (child.type) {
      case 'binary_expression':
      case 'unary_expression':
      case 'ternary_expression':
      case 'parenthesized_expression': {
        const err = walkArithmetic(child)
        if (err) return err
        break
      }
      default:
        return tooComplex(child)
    }
  }
  return null
}

/**
 * Check if a command_substitution node is exactly `$(cat <<'DELIM'...DELIM)`
 * and return the heredoc body if so. Any deviation (extra args to cat,
 * unquoted delimiter, additional commands) returns null.
 *
 * tree-sitter structure:
 *   command_substitution
 *     $(
 *     redirected_statement
 *       command → command_name → word "cat"    (exactly one child)
 *       heredoc_redirect
 *         <<
 *         heredoc_start 'DELIM'                (quoted)
 *         heredoc_body                         (pure heredoc_content)
 *         heredoc_end
 *     )
 */
// 识别「恰好是 cat 加引号 heredoc」的命令替换并返回正文。任何偏离（cat 带参数、定界符未加引号、还有别的命令）都返回空。结构要求很严：命令替换下只能有一个 redirect 语句，其中 command 只能有一个子节点且必须是 cat 的命令名。
function extractSafeCatHeredoc(subNode: Node): string | 'DANGEROUS' | null {
  // Expect exactly: $( + one redirected_statement + )
  let stmt: Node | null = null
  for (const child of subNode.children) {
    if (!child) continue
    if (child.type === '$(' || child.type === ')') continue
    if (child.type === 'redirected_statement' && stmt === null) {
      stmt = child
    } else {
      return null
    }
  }
  if (!stmt) return null

  // redirected_statement must be: command(cat) + heredoc_redirect (quoted)
  let sawCat = false
  let body: string | null = null
  for (const child of stmt.children) {
    if (!child) continue
    if (child.type === 'command') {
      // Must be bare `cat` — no args, no env vars
      const cmdChildren = child.children.filter(c => c)
      if (cmdChildren.length !== 1) return null
      const nameNode = cmdChildren[0]
      if (nameNode?.type !== 'command_name' || nameNode.text !== 'cat') {
        return null
      }
      sawCat = true
    } else if (child.type === 'heredoc_redirect') {
      // Reuse the existing validator: quoted delimiter, body is pure text.
      // walkHeredocRedirect returns null on success, non-null on rejection.
      if (walkHeredocRedirect(child) !== null) return null
      for (const hc of child.children) {
        if (hc?.type === 'heredoc_body') body = hc.text
      }
    } else {
      return null
    }
  }

  if (!sawCat || body === null) return null
  // SECURITY: the heredoc body becomes the outer command's argv value via
  // substitution, so a body like `/proc/self/environ` is semantically
  // `cat /proc/self/environ`. checkSemantics never sees the body (we drop it
  // at the walkString call site to avoid newline+# FPs). Returning `null`
  // here would fall through to collectCommandSubstitution in walkString,
  // which would extract the inner `cat` via walkHeredocRedirect (body text
  // not inspected there) — effectively bypassing this check. Return a
  // distinct sentinel so the caller can reject instead of falling through.
// 正文里出现 proc 环境文件路径就返回危险哨兵。为什么不能简单返回空：返回空会让调用方落到「通用命令替换」分支，那条路只提取内层 cat 而不看正文，等于绕过本检查。同样地，正文里的 jq system() 也无条件拒绝——我们不知道外层命令是什么，而 checkSemantics 只看得见 argv。
  if (PROC_ENVIRON_RE.test(body)) return 'DANGEROUS'
  // Same for jq system(): checkSemantics checks argv but never sees the
  // heredoc body. Check unconditionally (we don't know the outer command).
  if (/\bsystem\s*\(/.test(body)) return 'DANGEROUS'
  return body
}

// 变量赋值：拆出名字、值、是否追加。值分四类处理——命令替换存占位符（内层命令已单独入队检查）、简单展开按「字符串内」语义解析（赋值右侧不做切词与 glob）、其余走 walkArgument。
function walkVariableAssignment(
  node: Node,
  innerCommands: SimpleCommand[],
  varScope: Map<string, string>,
): { name: string; value: string; isAppend: boolean } | ParseForSecurityResult {
  let name: string | null = null
  let value = ''
  let isAppend = false

  for (const child of node.children) {
    if (!child) continue
    if (child.type === 'variable_name') {
      name = child.text
    } else if (child.type === '=' || child.type === '+=') {
      // `PATH+=":/new"` — tree-sitter emits `+=` as a distinct operator
      // node. Without this case it falls through to walkArgument below
      // → tooComplex on unknown type `+=`.
      isAppend = child.type === '+='
      continue
    } else if (child.type === 'command_substitution') {
      // $() as the variable's value. The output becomes a STRING stored in
      // the variable — it's NOT a positional argument (no path/flag concern).
      // `VAR=$(date)` runs `date`, stores output. `VAR=$(rm -rf /)` runs
      // `rm` — the inner command IS checked against permission rules, so
      // `rm` must match a rule. The variable just holds whatever `rm` prints.
      const err = collectCommandSubstitution(child, innerCommands, varScope)
      if (err) return err
      value = CMDSUB_PLACEHOLDER
    } else if (child.type === 'simple_expansion') {
      // `VAR=$OTHER` — assignment RHS does NOT word-split or glob-expand
      // in bash (unlike command arguments). So `A="a b"; B=$A` sets B to
      // the literal "a b". Resolve as if inside a string (insideString=true)
      // so BARE_VAR_UNSAFE_RE doesn't over-reject. The resulting value may
      // contain spaces/globs — if B is later used as a bare arg, THAT use
      // will correctly reject via BARE_VAR_UNSAFE_RE.
      const v = resolveSimpleExpansion(child, varScope, true)
      if (typeof v !== 'string') return v
      // If v is VAR_PLACEHOLDER (OTHER holds unknown), store it — combined
      // with containsAnyPlaceholder in the caller to treat as unknown.
      value = v
    } else {
      const v = walkArgument(child, innerCommands, varScope)
      if (typeof v !== 'string') return v
      value = v
    }
  }

  if (name === null) {
    return {
      kind: 'too-complex',
      reason: 'Variable assignment without name',
      nodeType: 'variable_assignment',
    }
  }
  // SECURITY: tree-sitter-bash accepts invalid var names (e.g. `1VAR=value`)
  // as variable_assignment. Bash only recognizes [A-Za-z_][A-Za-z0-9_]* —
  // anything else is run as a COMMAND. `1VAR=value` → bash tries to execute
  // `1VAR=value` from PATH. We must not treat it as an inert assignment.
// tree-sitter 接受非法变量名（如数字开头）并当成赋值，bash 却只认「字母或下划线开头」——其余会当成**命令名**去 PATH 里找。所以非法名字必须拒绝，不能当惰性赋值放过。
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return {
      kind: 'too-complex',
      reason: `Invalid variable name (bash treats as command): ${name}`,
      nodeType: 'variable_assignment',
    }
  }
  // SECURITY: Setting IFS changes word-splitting behavior for subsequent
  // unquoted $VAR expansions. `IFS=: && VAR=a:b && rm $VAR` → bash splits
  // on `:` → `rm a b`. Our BARE_VAR_UNSAFE_RE only checks default IFS
  // chars (space/tab/NL) — we can't model custom IFS. Reject.
// IFS 赋值直接拒绝：它改变后续未加引号 `$VAR` 的切词规则，而我们的不安全字符集只按默认 IFS（空格、制表、换行）判断，无法建模自定义 IFS。`IFS=: && VAR=a:b && rm $VAR` 在 bash 里是两个参数。
  if (name === 'IFS') {
    return {
      kind: 'too-complex',
      reason: 'IFS assignment changes word-splitting — cannot model statically',
      nodeType: 'variable_assignment',
    }
  }
  // SECURITY: PS4 is expanded via promptvars (default on) on every command
  // traced after `set -x`. A raw_string value containing $(cmd) or `cmd`
  // executes at trace time: `PS4='$(id)' && set -x && :` runs id, but our
  // argv is only [["set","-x"],[":"]] — the payload is invisible to
  // permission checks. PS0-3 and PROMPT_COMMAND are not expanded in
  // non-interactive shells (BashTool).
  //
  // ALLOWLIST, not blocklist. 5 rounds of bypass patches taught us that a
  // value-dependent blocklist is structurally fragile:
  //   - `+=` effective-value computation diverges from bash in multiple
  //     scope-model gaps: `||` reset, env-prefix chain (PS4='' && PS4='$'
  //     PS4+='(id)' cmd reads stale parent value), subshell.
  //   - bash's decode_prompt_string runs BEFORE promptvars, so `\044(id)`
  //     (octal for `$`) becomes `$(id)` at trace time — any literal-char
  //     check must model prompt-escape decoding exactly.
  //   - assignment paths exist outside walkVariableAssignment (for_statement
  //     sets loopVar directly, see that handler's PS4 check).
  //
  // Policy: (1) reject += outright — no scope-tracking dependency; user can
  // combine into one PS4=... (2) reject placeholders — runtime unknowable.
  // (3) allowlist remaining value: ${identifier} refs (value-read only, safe)
  // plus [A-Za-z0-9 _+:.\/=[\]-]. No bare `$` (blocks split primitive), no
  // `\` (blocks octal \044/\140), no backtick, no parens. Covers all known
  // encoding vectors and future ones — anything off the allowlist fails.
  // Legit `PS4='+${BASH_SOURCE}:${LINENO}: '` still passes.
// PS4 是**白名单**而非黑名单——五轮绕过补丁的教训是「依赖取值的黑名单在结构上脆弱」：追加赋值的有效值计算在 `||` 重置、环境前缀链、子 shell 三处都会与 bash 背离；bash 的提示符解码发生在变量展开之前，八进制写法的美元符照样还原；而且赋值路径不止这一处（for 循环直接写作用域）。策略三条：追加赋值一律拒；含占位符的值拒（运行时不可知）；剩余值只允许变量引用加一小撮字符集——不含裸美元符、不含反斜杠、不含反引号、不含括号。合法的 `PS4` 加 `${BASH_SOURCE}:${LINENO}` 写法仍能通过。
  if (name === 'PS4') {
    if (isAppend) {
      return {
        kind: 'too-complex',
        reason:
          'PS4 += cannot be statically verified — combine into a single PS4= assignment',
        nodeType: 'variable_assignment',
      }
    }
    if (containsAnyPlaceholder(value)) {
      return {
        kind: 'too-complex',
        reason: 'PS4 value derived from cmdsub/variable — runtime unknowable',
        nodeType: 'variable_assignment',
      }
    }
    if (
      !/^[A-Za-z0-9 _+:./=[\]-]*$/.test(
        value.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, ''),
      )
    ) {
      return {
        kind: 'too-complex',
        reason:
          'PS4 value outside safe charset — only ${VAR} refs and [A-Za-z0-9 _+:.=/[]-] allowed',
        nodeType: 'variable_assignment',
      }
    }
  }
  // SECURITY: Tilde expansion in assignment RHS. `VAR=~/x` (unquoted) →
  // bash expands `~` at ASSIGNMENT time → VAR='/home/user/x'. We see the
  // literal `~/x`. Later `cd $VAR` → our argv `['cd','~/x']`, bash runs
  // `cd /home/user/x`. Tilde expansion also happens after `=` and `:` in
  // assignment values (e.g. PATH=~/bin:~/sbin). We can't model it — reject
  // any value containing `~` that isn't already quoted-literal (where bash
  // doesn't expand). Conservative: any `~` in value → reject.
// 赋值值里的波浪号：`VAR=~/x` 在**赋值时**就被展开成主目录路径，我们只看到字面 `~/x`，后续 `cd $VAR` 会让 argv 与 bash 分叉。不做建模，含波浪号即拒。
  if (value.includes('~')) {
    return {
      kind: 'too-complex',
      reason: 'Tilde in assignment value — bash may expand at assignment time',
      nodeType: 'variable_assignment',
    }
  }
  return { name, value, isAppend }
}

/**
 * Resolve a `simple_expansion` ($VAR) node. Returns VAR_PLACEHOLDER if
 * resolvable, too-complex otherwise.
 *
 * @param insideString true when $VAR is inside a `string` node ("...$VAR...")
 *   rather than a bare/concatenation argument. SAFE_ENV_VARS and unknown-value
 *   tracked vars are only allowed inside strings — as bare args their runtime
 *   value IS the argument and we don't know it statically.
 *   `cd $HOME/../x` would hide the real path behind the placeholder;
 *   `echo "Home: $HOME"` just embeds text in a string. Tracked vars holding
 *   STATIC strings (VAR=literal) are allowed in both positions since their
 *   value IS known.
 */
// 解析简单展开 `$VAR`。三条分支：已追踪变量——纯字面值**直接返回真实值**（这是关键修复，`VAR=/etc && rm $VAR` 必须让路径校验看到 /etc 而不是占位符，否则占位符被当相对路径就绕过了）；非常量值——裸参数拒绝、字符串内给占位符；未追踪——只有字符串内且属于安全环境变量或特殊变量才给占位符。
function resolveSimpleExpansion(
  node: Node,
  varScope: Map<string, string>,
  insideString: boolean,
): string | ParseForSecurityResult {
  let varName: string | null = null
  let isSpecial = false
  for (const c of node.children) {
    if (c?.type === 'variable_name') {
      varName = c.text
      break
    }
    if (c?.type === 'special_variable_name') {
      varName = c.text
      isSpecial = true
      break
    }
  }
  if (varName === null) return tooComplex(node)
  // Tracked vars: check stored value. Literal strings (VAR=/tmp) are
  // returned DIRECTLY so downstream path validation sees the real path.
  // Non-literal values (containing any placeholder — loop vars, $() output,
  // read vars, composites like `VAR="prefix$(cmd)"`) are ONLY safe inside
  // strings; as bare args they'd hide the runtime path/flag from validation.
  //
  // SECURITY: Returning the actual trackedValue (not a placeholder) is the
  // critical fix. `VAR=/etc && rm $VAR` → argv ['rm', '/etc'] → validatePath
  // correctly rejects. Previously returned a placeholder → validatePath saw
  // '__LOOP_STATIC__', resolved as cwd-relative → PASSED → bypass.
  const trackedValue = varScope.get(varName)
  if (trackedValue !== undefined) {
    if (containsAnyPlaceholder(trackedValue)) {
      // Non-literal: bare → reject, inside string → VAR_PLACEHOLDER
      // (walkString's solo-placeholder gate rejects `"$VAR"` alone).
      if (!insideString) return tooComplex(node)
      return VAR_PLACEHOLDER
    }
    // Pure literal (e.g. '/tmp', 'foo') — return it directly. Downstream
    // path validation / checkSemantics operate on the REAL value.
    //
    // SECURITY: For BARE args (not inside a string), bash word-splits on
    // $IFS and glob-expands the result. `VAR="-rf /" && rm $VAR` → bash
    // runs `rm -rf /` (two args); `VAR="/etc/*" && cat $VAR` → expands to
    // all files. Reject values containing IFS/glob chars unless in "...".
    //
    // SECURITY: Empty value as bare arg. Bash word-splitting on "" produces
    // ZERO fields — the expansion disappears. `V="" && $V eval x` → bash
    // runs `eval x` (our argv would be ["","eval","x"] with name="" —
    // every EVAL_LIKE/ZSH/keyword check misses). `V="" && ls $V /etc` →
    // bash runs `ls /etc`, our argv has a phantom "" shifting positions.
    // Inside "...": `"$V"` → bash produces one empty-string arg → our ""
    // is correct, keep allowing.
// 裸参数的两个补丁。其一，空值：bash 对空串做切词产生**零个字段**，`V` 赋空串再接 `$V eval x` 实际执行 `eval x`，而我们会有个位置错位的空 argv[0]，所有 eval 类检查都会错过。其二，含 IFS 或 glob 字符的值：切词与路径展开会让一个 argv 变成多个。引号内的空值是对的（bash 会产生一个空参数），继续允许。
    if (!insideString) {
      if (trackedValue === '') return tooComplex(node)
      if (BARE_VAR_UNSAFE_RE.test(trackedValue)) return tooComplex(node)
    }
    return trackedValue
  }
  // SAFE_ENV_VARS + special vars ($?, $$, $@, $1, etc.): value unknown
  // (shell-controlled). Only safe when embedded in a string, NOT as a
  // bare argument to a path-sensitive command.
  if (insideString) {
    if (SAFE_ENV_VARS.has(varName)) return VAR_PLACEHOLDER
    if (
      isSpecial &&
      (SPECIAL_VAR_NAMES.has(varName) || /^[0-9]+$/.test(varName))
    ) {
      return VAR_PLACEHOLDER
    }
  }
  return tooComplex(node)
}

/**
 * Apply a variable assignment to the scope, handling `+=` append semantics.
 * SECURITY: If EITHER side (existing value or appended value) contains a
 * placeholder, the result is non-literal — store VAR_PLACEHOLDER so later
 * $VAR correctly rejects as bare arg.
 * `VAR=/etc && VAR+=$(cmd)` must not leave VAR looking static.
 */
// 把赋值写入作用域，处理追加语义。安全点：只要旧值或新值任一侧含占位符，合并结果就记为非常量——`VAR=/etc && VAR+=$(cmd)` 不能让 VAR 继续看起来是静态的。
function applyVarToScope(
  varScope: Map<string, string>,
  ev: { name: string; value: string; isAppend: boolean },
): void {
  const existing = varScope.get(ev.name) ?? ''
  const combined = ev.isAppend ? existing + ev.value : ev.value
  varScope.set(
    ev.name,
    containsAnyPlaceholder(combined) ? VAR_PLACEHOLDER : combined,
  )
}

function stripRawString(text: string): string {
  return text.slice(1, -1)
}

// 统一的拒绝出口：错误节点、已知危险类型、未知类型给出不同措辞，都带上节点类型供埋点统计。
function tooComplex(node: Node): ParseForSecurityResult {
  const reason =
    node.type === 'ERROR'
      ? 'Parse error'
      : DANGEROUS_TYPES.has(node.type)
        ? `Contains ${node.type}`
        : `Unhandled node type: ${node.type}`
  return { kind: 'too-complex', reason, nodeType: node.type }
}

// ────────────────────────────────────────────────────────────────────────────
// Post-argv semantic checks
//
// Everything above answers "can we tokenize?". Everything below answers
// "is the resulting argv dangerous in ways that don't involve parsing?".
// These are checks on argv[0] or argv content that the old bashSecurity.ts
// validators performed but which have nothing to do with parser
// differentials. They're here (not in bashSecurity.ts) because they operate
// on SimpleCommand and need to run for every extracted command.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Zsh module builtins. These are not binaries on PATH — they're zsh
 * internals loaded via zmodload. Since BashTool runs via the user's default
 * shell (often zsh), and these parse as plain `command` nodes with no
 * distinguishing syntax, we can only catch them by name.
 */
// zsh 模块内建：不是 PATH 上的二进制，而是通过 zmodload 加载的 zsh 内部命令，语法上与普通命令毫无区别，只能靠名字识别。含 `zf_rm`、`zf_mv` 等直接操作文件系统的模块函数。
const ZSH_DANGEROUS_BUILTINS = new Set([
  'zmodload',
  'emulate',
  'sysopen',
  'sysread',
  'syswrite',
  'sysseek',
  'zpty',
  'ztcp',
  'zsocket',
  'zf_rm',
  'zf_mv',
  'zf_ln',
  'zf_chmod',
  'zf_chown',
  'zf_mkdir',
  'zf_rmdir',
  'zf_chgrp',
])

/**
 * Shell builtins that evaluate their arguments as code or otherwise escape
 * the argv abstraction. A command like `eval "rm -rf /"` has argv
 * ['eval', 'rm -rf /'] which looks inert to flag validation but executes
 * the string. Treat these the same as command substitution.
 */
// 把参数当代码求值的内建与修饰符名单——它们逃出了 argv 抽象。逐条备注值得读：`eval`/`source`/`exec` 显然是；`coproc rm` 把 rm 当协程起，argv[0] 会是 coproc；`noglob`/`nocorrect` 是 zsh 前置修饰符，真正的命令在 argv[1]；`trap` 的代码在 EXIT 时必触发；`enable -f` 能 dlopen 任意动态库；`mapfile -C` 的回调每 N 行跑一次；`hash -p` 污染命令查找缓存；`bind`/`complete`/`compgen` 收代码字符串（其中 `compgen -C` 是立即执行，不是交互专用）；`alias` 配合开启别名展开即可生效；`let` 等于算术求值，能跑掉单引号里的下标展开。
const EVAL_LIKE_BUILTINS = new Set([
  'eval',
  'source',
  '.',
  'exec',
  'command',
  'builtin',
  'fc',
  // `coproc rm -rf /` spawns rm as a coprocess. tree-sitter parses it as
  // a plain command with argv[0]='coproc', so permission rules and path
  // validation would check 'coproc' not 'rm'.
  'coproc',
  // Zsh precommand modifiers: `noglob cmd args` runs cmd with globbing off.
  // They parse as ordinary commands (noglob is argv[0], the real command is
  // argv[1]) so permission matching against argv[0] would see 'noglob', not
  // the wrapped command.
  'noglob',
  'nocorrect',
  // `trap 'cmd' SIGNAL` — cmd runs as shell code on signal/exit. EXIT fires
  // at end of every BashTool invocation, so this is guaranteed execution.
  'trap',
  // `enable -f /path/lib.so name` — dlopen arbitrary .so as a builtin.
  // Native code execution.
  'enable',
  // `mapfile -C callback -c N` / `readarray -C callback` — callback runs as
  // shell code every N input lines.
  'mapfile',
  'readarray',
  // `hash -p /path cmd` — poisons bash's command-lookup cache. Subsequent
  // `cmd` in the same command resolves to /path instead of PATH lookup.
  'hash',
  // `bind -x '"key":cmd'` / `complete -C cmd` — interactive-only callbacks
  // but still code-string arguments. Low impact in non-interactive BashTool
  // shells, blocked for consistency. `compgen -C cmd` is NOT interactive-only:
  // it immediately executes the -C argument to generate completions.
  'bind',
  'complete',
  'compgen',
  // `alias name='cmd'` — aliases not expanded in non-interactive bash by
  // default, but `shopt -s expand_aliases` enables them. Also blocked as
  // defense-in-depth (alias followed by name use in same command).
  'alias',
  // `let EXPR` arithmetically evaluates EXPR — identical to $(( EXPR )).
  // Array subscripts in the expression expand $(cmd) at eval time even when
  // the argument arrived single-quoted: `let 'x=a[$(id)]'` executes id.
  // tree-sitter sees the raw_string as an opaque leaf. Same primitive
  // walkArithmetic guards, but `let` is a plain command node.
  'let',
])

/**
 * Builtins that re-parse a NAME operand internally and arithmetically
 * evaluate `arr[EXPR]` subscripts — including $(cmd) in the subscript —
 * even when the argv element arrived from a single-quoted raw_string.
 * `test -v 'a[$(id)]'` → tree-sitter sees an opaque leaf, bash runs id.
 * Maps: builtin name → set of flags whose next argument is a NAME.
 */
// 会**内部重新解析 NAME 操作数**并对其下标做算术求值的建内，映射为「建内名 → 其后一个参数是 NAME 的 flag 集合」。`test -v 'a[$(id)]'` 在 tree-sitter 眼里是不透明叶子，bash 会跑 id。也包括 bash 5.1+ 的 `wait -p VAR`——实测 5.3.9 下 `wait -p 'a[$(id)]'` 确实执行。
const SUBSCRIPT_EVAL_FLAGS: Record<string, Set<string>> = {
  test: new Set(['-v', '-R']),
  '[': new Set(['-v', '-R']),
  '[[': new Set(['-v', '-R']),
  printf: new Set(['-v']),
  read: new Set(['-a']),
  unset: new Set(['-v']),
  // bash 5.1+: `wait -p VAR [id...]` stores the waited PID into VAR. When VAR
  // is `arr[EXPR]`, bash arithmetically evaluates the subscript — running
  // $(cmd) even from a single-quoted raw_string. Verified bash 5.3.9:
  // `: & wait -p 'a[$(id)]' %1` executes id.
  wait: new Set(['-p']),
}

/**
 * `[[ ARG1 OP ARG2 ]]` where OP is an arithmetic comparison. bash manual:
 * "When used with [[, Arg1 and Arg2 are evaluated as arithmetic
 * expressions." Arithmetic evaluation recursively expands array subscripts,
 * so `[[ 'a[$(id)]' -eq 0 ]]` executes `id` even though tree-sitter sees
 * the operand as an opaque raw_string leaf. Unlike -v/-R (unary, NAME after
 * flag), these are binary — the subscript can appear on EITHER side, so
 * SUBSCRIPT_EVAL_FLAGS's "next arg" logic is insufficient.
 * `[` / `test` are not vulnerable (bash errors with "integer expression
 * expected"), but the test_command handler normalizes argv[0]='[[' for
 * both forms, so they get this check too — mild over-blocking, safe side.
 */
// 双中括号里的算术比较操作符。bash 手册明确：与双中括号同用时两侧操作数按算术表达式求值，会递归展开数组下标。与上面的 flag 模式不同，这是二元的——下标可能出现在**任一侧**，所以「flag 加下一个参数」的逻辑不够用。单中括号与 test 本身不易受影响（bash 会报整数表达式错误），但测试命令分支把两者都归一成双中括号的 argv[0]，于是顺带也检查了，属温和的过度拦截。
const TEST_ARITH_CMP_OPS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge'])

/**
 * Builtins where EVERY non-flag positional argument is a NAME that bash
 * re-parses and arithmetically evaluates subscripts on — no flag required.
 * `read 'a[$(id)]'` executes id: each positional is a variable name to
 * assign into, and `arr[EXPR]` is valid syntax there. `unset NAME...` is
 * the same (though tree-sitter's unset_command handler currently rejects
 * raw_string children before reaching here — this is defense-in-depth).
 * NOT printf (positional args are FORMAT/data), NOT test/[ (operands are
 * values, only -v/-R take a NAME). declare/typeset/local handled in
 * declaration_command since they never reach here as plain commands.
 */
// 每个裸位置参数都是 NAME、不需要 flag 的建内。`read 'a[$(id)]'` 的每个位置参数都是待赋值变量名，下标语法在那里合法。`unset` 同理（虽然 unset 分支现在会先拒掉原始字符串子节点，这里是纵深防御）。刻意不含 printf（位置参数是格式与数据）、不含 test（操作数是值），也不含 declare 系列（它们走不到这里）。
const BARE_SUBSCRIPT_NAME_BUILTINS = new Set(['read', 'unset'])

/**
 * `read` flags whose NEXT argument is data (prompt/delimiter/count/fd),
 * not a NAME. `read -p '[foo] ' var` must not trip on the `[` in the
 * prompt string. `-a` is intentionally absent — its operand IS a NAME.
 */
// read 里「下一个参数是数据而非 NAME」的 flag：提示串、定界符、计数、文件描述符。`read -p '[foo] ' var` 不能因为提示串里有方括号就报错。`-a` 刻意不在列——它的操作数正是 NAME。
const READ_DATA_FLAGS = new Set(['-p', '-d', '-n', '-N', '-t', '-u', '-i'])

// SHELL_KEYWORDS imported from bashParser.ts — shell reserved words can never
// be legitimate argv[0]; if they appear, the parser mis-parsed a compound
// command. Reject to avoid nonsense argv reaching downstream.

// Use `.*` not `[^/]*` — Linux resolves `..` in procfs, so
// `/proc/self/../self/environ` works and must be caught.
// proc 环境文件检测用「任意字符」而非「非斜杠」，因为 Linux 的 procfs 会解析双点：`/proc/self/../self/environ` 同样能读到，必须一并抓住。
const PROC_ENVIRON_RE = /\/proc\/.*\/environ/

/**
 * Newline followed by `#` in an argv element, env var value, or redirect target.
 * Downstream stripSafeWrappers re-tokenizes .text line-by-line and treats `#`
 * after a newline as a comment, hiding arguments that follow.
 */
// 「换行后跟井号」检测：下游剥离包装命令时会按行重新分词，并把换行后的井号当注释，于是后面的参数被藏起来。argv、环境变量值、重定向目标三处都要查。
const NEWLINE_HASH_RE = /\n[ \t]*#/

export type SemanticCheckResult = { ok: true } | { ok: false; reason: string }

/**
 * Post-argv semantic checks. Run after parseForSecurity returns 'simple' to
 * catch commands that tokenize fine but are dangerous by name or argument
 * content. Returns the first failure or {ok: true}.
 */
// argv 之后的语义检查入口：分词成功但「按名字或参数内容本身就危险」的命令在这里拦。返回第一个失败原因。
export function checkSemantics(commands: SimpleCommand[]): SemanticCheckResult {
  for (const cmd of commands) {
    // Strip safe wrapper commands (nohup, time, timeout N, nice -n N) so
    // `nohup eval "..."` and `timeout 5 jq 'system(...)'` are checked
    // against the wrapped command, not the wrapper. Inlined here to avoid
    // circular import with bashPermissions.ts.
    let a = cmd.argv
// 先剥掉安全包装命令（`time`、`nohup`、`timeout N`、`nice -n N`、`env`、`stdbuf`），这样 `nohup eval ...` 与 `timeout 5 jq system(...)` 检查的是被包装的命令而不是包装器。内联在这里写是为了避免与权限模块的循环依赖。
    for (;;) {
      if (a[0] === 'time' || a[0] === 'nohup') {
        a = a.slice(1)
      } else if (a[0] === 'timeout') {
        // `timeout 5`, `timeout 5s`, `timeout 5.5`, plus optional GNU flags
        // preceding the duration. Long: --foreground, --kill-after=N,
        // --signal=SIG, --preserve-status. Short: -k DUR, -s SIG, -v (also
        // fused: -k5, -sTERM).
        // SECURITY (SAST Mar 2026): the previous loop only skipped `--long`
        // flags, so `timeout -k 5 10 eval ...` broke out with name='timeout'
        // and the wrapped eval was never checked. Now handle known short
        // flags AND fail closed on any unrecognized flag — an unknown flag
        // means we can't locate the wrapped command, so we must not silently
        // fall through to name='timeout'.
// timeout 的 flag 解析必须 fail-closed。历史漏洞：早先只跳过长 flag，`timeout -k 5 10 eval ...` 会让剥离在中途退出、名字留在 timeout，被包装的 eval 从未被检查。现在穷举已知短 flag 与带值形式，**任何不认识的 flag 直接拒绝**——因为定位不到被包装的命令，就不能静默退回名字为 timeout。
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (
            arg === '--foreground' ||
            arg === '--preserve-status' ||
            arg === '--verbose'
          ) {
            i++ // known no-value long flags
          } else if (/^--(?:kill-after|signal)=[A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ // --kill-after=5, --signal=TERM (value fused with =)
          } else if (
            (arg === '--kill-after' || arg === '--signal') &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 // --kill-after 5, --signal TERM (space-separated)
          } else if (arg.startsWith('--')) {
            // Unknown long flag, OR --kill-after/--signal with non-allowlisted
            // value (e.g. placeholder from $() substitution). Fail closed.
            return {
              ok: false,
              reason: `timeout with ${arg} flag cannot be statically analyzed`,
            }
          } else if (arg === '-v') {
            i++ // --verbose, no argument
          } else if (
            (arg === '-k' || arg === '-s') &&
            a[i + 1] &&
            /^[A-Za-z0-9_.+-]+$/.test(a[i + 1]!)
          ) {
            i += 2 // -k DURATION / -s SIGNAL — separate value
          } else if (/^-[ks][A-Za-z0-9_.+-]+$/.test(arg)) {
            i++ // fused: -k5, -sTERM
          } else if (arg.startsWith('-')) {
            // Unknown flag OR -k/-s with non-allowlisted value — can't locate
            // wrapped cmd. Reject, don't fall through to name='timeout'.
            return {
              ok: false,
              reason: `timeout with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break // non-flag — should be the duration
          }
        }
// 时长解析。GNU timeout 用 libc 的浮点解析，接受 `.5`、`+5`、`5e-1`、`inf` 甚至十六进制浮点，这些都不匹配「数字加可选单位」的正则。以前不匹配就 break（fail-**open**），`timeout .5 eval` 后接引号包裹的 id 在 `Bash(timeout:*)` 规则下会把 eval 藏过去；现在改为 fail-closed 拒绝。
        if (a[i] && /^\d+(?:\.\d+)?[smhd]?$/.test(a[i]!)) {
          a = a.slice(i + 1)
        } else if (a[i]) {
          // SECURITY (PR #21503 round 3): a[i] exists but doesn't match our
          // duration regex. GNU timeout parses via xstrtod() (libc strtod) and
          // accepts `.5`, `+5`, `5e-1`, `inf`, `infinity`, hex floats — none
          // of which match `/^\d+(\.\d+)?[smhd]?$/`. Empirically verified:
          // `timeout .5 echo ok` works. Previously this branch `break`ed
          // (fail-OPEN) so `timeout .5 eval "id"` with `Bash(timeout:*)` left
          // name='timeout' and eval was never checked. Now fail CLOSED —
          // consistent with the unknown-FLAG handling above (lines ~1895,1912).
          return {
            ok: false,
            reason: `timeout duration '${a[i]}' cannot be statically analyzed`,
          }
        } else {
          break // no more args — `timeout` alone, inert
        }
// nice：`nice cmd`、`nice -n N cmd`、`nice -N cmd` 三种形式都要剥到真正的命令。这里同样有一条 fail-closed：`nice $((0-5)) jq ...` 的 argv[1] 是算术展开的原始文本（walkArgument 对算术展开返回 node.text），bash 会展开成 `-5` 并执行 jq，若我们按「裸命令」切一刀，命令名就成了那段文本，jq 的 system() 检查完全跳过。
      } else if (a[0] === 'nice') {
        // `nice cmd`, `nice -n N cmd`, `nice -N cmd` (legacy). All run cmd
        // at a lower priority. argv[0] check must see the wrapped cmd.
        if (a[1] === '-n' && a[2] && /^-?\d+$/.test(a[2])) {
          a = a.slice(3)
        } else if (a[1] && /^-\d+$/.test(a[1])) {
          a = a.slice(2) // `nice -10 cmd`
        } else if (a[1] && /[$(`]/.test(a[1])) {
          // SECURITY: walkArgument returns node.text for arithmetic_expansion,
          // so `nice $((0-5)) jq ...` has a[1]='$((0-5))'. Bash expands it to
          // '-5' (legacy nice syntax) and execs jq; we'd slice(1) here and
          // set name='$((0-5))' which skips the jq system() check entirely.
          // Fail closed — mirrors the timeout-duration fail-closed above.
          return {
            ok: false,
            reason: `nice argument '${a[1]}' contains expansion — cannot statically determine wrapped command`,
          }
        } else {
          a = a.slice(1) // bare `nice cmd`
        }
// env：可带若干 `VAR=val` 赋值与少量无害 flag，之后才是真命令。三条必须拒绝的：`-S` 把字符串切成 argv（等于迷你 shell）、`-C` 换工作目录、`-P` 换 PATH——被包装的命令会跑在别处。其余任何未知 flag 也拒绝，不做「退回名字为 env」的 fail-open。
      } else if (a[0] === 'env') {
        // `env [VAR=val...] [-i] [-0] [-v] [-u NAME...] cmd args` runs cmd.
        // argv[0] check must see cmd, not env. Skip known-safe forms only.
        // SECURITY: -S splits a string into argv (mini-shell) — must reject.
        // -C/-P change cwd/PATH — wrapped cmd runs elsewhere, reject.
        // Any OTHER flag → reject (fail-closed, not fail-open to name='env').
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (arg.includes('=') && !arg.startsWith('-')) {
            i++ // VAR=val assignment
          } else if (arg === '-i' || arg === '-0' || arg === '-v') {
            i++ // flags with no argument
          } else if (arg === '-u' && a[i + 1]) {
            i += 2 // -u NAME unsets; takes one arg
          } else if (arg.startsWith('-')) {
            // -S (argv splitter), -C (altwd), -P (altpath), --anything,
            // or unknown flag. Can't model — reject the whole command.
            return {
              ok: false,
              reason: `env with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break // the wrapped command
          }
        }
        if (i < a.length) {
          a = a.slice(i)
        } else {
          break // `env` alone (no wrapped cmd) — inert, name='env'
        }
// stdbuf 的三种 flag 形态：空格分隔（`-o 0`）、粘连（`-o0`）、长形式（`--output=0`）。历史漏洞是只剥一个 flag 然后对任何不认识的都切两刀，`stdbuf --output 0 eval` 会让命令名变成 `0`，eval 藏起来。现在逐个迭代已知形态，未知 flag 一律拒绝。
      } else if (a[0] === 'stdbuf') {
        // `stdbuf -o0 cmd` (fused), `stdbuf -o 0 cmd` (space-separated),
        // multiple flags (`stdbuf -o0 -eL cmd`), long forms (`--output=0`).
        // SECURITY: previous handling only stripped ONE flag and fell through
        // to slice(2) for anything unrecognized, so `stdbuf --output 0 eval`
        // → ['0','eval',...] → name='0' hid eval. Now iterate all known flag
        // forms and fail closed on any unknown flag.
        let i = 1
        while (i < a.length) {
          const arg = a[i]!
          if (STDBUF_SHORT_SEP_RE.test(arg) && a[i + 1]) {
            i += 2 // -o MODE (space-separated)
          } else if (STDBUF_SHORT_FUSED_RE.test(arg)) {
            i++ // -o0 (fused)
          } else if (STDBUF_LONG_RE.test(arg)) {
            i++ // --output=MODE (fused long)
          } else if (arg.startsWith('-')) {
            // --output MODE (space-separated long) or unknown flag. GNU
            // stdbuf long options use `=` syntax, but getopt_long also
            // accepts space-separated — we can't enumerate safely, reject.
            return {
              ok: false,
              reason: `stdbuf with ${arg} flag cannot be statically analyzed`,
            }
          } else {
            break // the wrapped command
          }
        }
        if (i > 1 && i < a.length) {
          a = a.slice(i)
        } else {
          break // `stdbuf` with no flags or no wrapped cmd — inert
        }
      } else {
        break
      }
    }
    const name = a[0]
    if (name === undefined) continue

    // SECURITY: Empty command name. Quoted empty (`"" cmd`) is harmless —
    // bash tries to exec "" and fails with "command not found". But an
    // UNQUOTED empty expansion at command position (`V="" && $V cmd`) is a
    // bypass: bash drops the empty field and runs `cmd` as argv[0], while
    // our name="" skips every builtin check below. resolveSimpleExpansion
    // rejects the $V case; this catches any other path to empty argv[0]
    // (concatenation of empties, walkString whitespace-quirk, future bugs).
// 空命令名要拒。加引号的空串（一对空引号后跟 cmd）无害——bash 会 exec 空串并报命令不存在；但**未加引号的空展开**在命令位置是绕过：`V` 赋空串再接 `$V cmd` 里 bash 丢掉空字段、把 cmd 当 argv[0] 跑，而我们的名字是空串，跳过下面所有内建检查。resolveSimpleExpansion 已拒了 `$V` 这种情况，这里是兜底，防拼接、空白怪癖或未来的 bug。
    if (name === '') {
      return {
        ok: false,
        reason: 'Empty command name — argv[0] may not reflect what bash runs',
      }
    }

    // Defense-in-depth: argv[0] should never be a placeholder after the
    // var-tracking fix (static vars return real value, unknown vars reject).
    // But if a bug upstream ever lets one through, catch it here — a
    // placeholder-as-command-name means runtime-determined command → unsafe.
    if (name.includes(CMDSUB_PLACEHOLDER) || name.includes(VAR_PLACEHOLDER)) {
      return {
        ok: false,
        reason: 'Command name is runtime-determined (placeholder argv[0])',
      }
    }

    // argv[0] starts with an operator/flag: this is a fragment, not a
    // command. Likely a line-continuation leak or a mistake.
    if (name.startsWith('-') || name.startsWith('|') || name.startsWith('&')) {
      return {
        ok: false,
        reason: 'Command appears to be an incomplete fragment',
      }
    }

    // SECURITY: builtins that re-parse a NAME operand internally. bash
    // arithmetically evaluates `arr[EXPR]` in NAME position, running $(cmd)
    // in the subscript even when the argv element arrived from a
    // single-quoted raw_string (opaque leaf to tree-sitter). Two forms:
    // separate (`printf -v NAME`) and fused (`printf -vNAME`, getopt-style).
    // `printf '[%s]' x` stays safe — `[` in format string, not after `-v`.
// NAME 操作数的下标检查覆盖三种写法：分离（`-v NAME`）、组合短 flag（`-ra` 是 `-r -a` 的简写，危险字符出现在组合串里、NAME 在下一参数）、粘连（`-vNAME`）。只对长度为 2 的短 flag 做粘连检查，因为长选项不按 getopt 规则粘连。
    const dangerFlags = SUBSCRIPT_EVAL_FLAGS[name]
    if (dangerFlags !== undefined) {
      for (let i = 1; i < a.length; i++) {
        const arg = a[i]!
        // Separate form: `-v` then NAME in next arg.
        if (dangerFlags.has(arg) && a[i + 1]?.includes('[')) {
          return {
            ok: false,
            reason: `'${name} ${arg}' operand contains array subscript — bash evaluates $(cmd) in subscripts`,
          }
        }
        // Combined short flags: `-ra` is bash shorthand for `-r -a`.
        // Check if any danger flag character appears in a combined flag
        // string. The danger flag's NAME operand is the next argument.
        if (
          arg.length > 2 &&
          arg[0] === '-' &&
          arg[1] !== '-' &&
          !arg.includes('[')
        ) {
          for (const flag of dangerFlags) {
            if (flag.length === 2 && arg.includes(flag[1]!)) {
              if (a[i + 1]?.includes('[')) {
                return {
                  ok: false,
                  reason: `'${name} ${flag}' (combined in '${arg}') operand contains array subscript — bash evaluates $(cmd) in subscripts`,
                }
              }
            }
          }
        }
        // Fused form: `-vNAME` in one arg. Only short-option flags fuse
        // (getopt), so check -v/-a/-R. `[[` uses test_operator nodes only.
        for (const flag of dangerFlags) {
          if (
            flag.length === 2 &&
            arg.startsWith(flag) &&
            arg.length > 2 &&
            arg.includes('[')
          ) {
            return {
              ok: false,
              reason: `'${name} ${flag}' (fused) operand contains array subscript — bash evaluates $(cmd) in subscripts`,
            }
          }
        }
      }
    }

    // SECURITY: `[[ ARG OP ARG ]]` arithmetic comparison. bash evaluates
    // BOTH operands as arithmetic expressions, recursively expanding
    // `arr[$(cmd)]` subscripts even from single-quoted raw_string. Check
    // the operand adjacent to each arith-cmp operator on BOTH sides —
    // SUBSCRIPT_EVAL_FLAGS's "flag then next-arg" pattern can't express
    // "either side of a binary op". String comparisons (==/!=/=~) do NOT
    // trigger arithmetic eval — `[[ 'a[x]' == y ]]` is a literal string cmp.
// 双中括号的算术比较单独一段：从下标 2 开始（0 是双中括号本身、1 是首个操作数，二元操作符不可能出现在更前），命中算术比较操作符就检查**两侧**是否含方括号。字符串比较（等号、不等号、正则匹配）不触发算术求值，不受此限。
    if (name === '[[') {
      // i starts at 2: a[0]='[[' (contains '['), a[1] is the first real
      // operand. A binary op can't appear before index 2.
      for (let i = 2; i < a.length; i++) {
        if (!TEST_ARITH_CMP_OPS.has(a[i]!)) continue
        if (a[i - 1]?.includes('[') || a[i + 1]?.includes('[')) {
          return {
            ok: false,
            reason: `'[[ ... ${a[i]} ... ]]' operand contains array subscript — bash arithmetically evaluates $(cmd) in subscripts`,
          }
        }
      }
    }

    // SECURITY: `read`/`unset` treat EVERY bare positional as a NAME —
    // no flag needed. `read 'a[$(id)]' <<< data` executes id even though
    // argv[1] arrived from a single-quoted raw_string and no -a flag is
    // present. Same primitive as SUBSCRIPT_EVAL_FLAGS but the trigger is
    // positional, not flag-gated. Skip operands of read's data-taking
    // flags (-p PROMPT etc.) to avoid blocking `read -p '[foo] ' var`.
// read / unset 的裸位置参数检查：没有 flag 门槛，每个位置参数都可能是带下标的 NAME。需要跳过 read 的取数据 flag 的操作数（否则 `read -p '[foo] ' var` 会误报）。组合短 flag 还要按 getopt 规则推断：数据 flag 字符若在末位则吃掉下一个参数，否则吃掉本参数剩余部分。
    if (BARE_SUBSCRIPT_NAME_BUILTINS.has(name)) {
      let skipNext = false
      for (let i = 1; i < a.length; i++) {
        const arg = a[i]!
        if (skipNext) {
          skipNext = false
          continue
        }
        if (arg[0] === '-') {
          if (name === 'read') {
            if (READ_DATA_FLAGS.has(arg)) {
              skipNext = true
            } else if (arg.length > 2 && arg[1] !== '-') {
              // Combined short flag like `-rp`. Getopt-style: first
              // data-flag char consumes rest-of-arg as its operand
              // (`-p[foo]` → prompt=`[foo]`), or next-arg if last
              // (`-rp '[foo]'` → prompt=`[foo]`). So skipNext iff a
              // data-flag char appears at the END after only no-arg
              // flags like `-r`/`-s`.
              for (let j = 1; j < arg.length; j++) {
                if (READ_DATA_FLAGS.has('-' + arg[j])) {
                  if (j === arg.length - 1) skipNext = true
                  break
                }
              }
            }
          }
          continue
        }
        if (arg.includes('[')) {
          return {
            ok: false,
            reason: `'${name}' positional NAME '${arg}' contains array subscript — bash evaluates $(cmd) in subscripts`,
          }
        }
      }
    }

    // SECURITY: Shell reserved keywords as argv[0] indicate a tree-sitter
    // mis-parse. `! for i in a; do :; done` parses as `command "for i in a"`
    // + `command "do :"` + `command "done"` — tree-sitter fails to recognize
    // `for` after `!` as a compound command start. Reject: keywords can never
    // be legitimate command names, and argv like ['do','false'] is nonsense.
// shell 保留字出现在 argv[0] 说明 tree-sitter 解析错了。实例：`! for i in a; do :; done` 里感叹号后的 for 没被识别成复合命令开头，被切成三条普通命令（`for i in a`、`do :`、`done`）。保留字不可能是合法命令名，这种 argv 一定是垃圾。
    if (SHELL_KEYWORDS.has(name)) {
      return {
        ok: false,
        reason: `Shell keyword '${name}' as command name — tree-sitter mis-parse`,
      }
    }

    // Check argv (not .text) to catch both single-quote (`'\n#'`) and
    // double-quote (`"\n#"`) variants. Env vars and redirects are also
    // part of the .text span so the same downstream bug applies.
    // Heredoc bodies are excluded from argv so markdown `##` headers
    // don't trigger this.
    // TODO: remove once downstream path validation operates on argv.
// 「换行加井号」在 argv、环境变量值、重定向目标三处逐一检查。查 argv 而不是原文，是为了同时覆盖单引号与双引号两种写法；heredoc 正文不在 argv 里，正好避免 markdown 的二级标题触发误报。
    for (const arg of cmd.argv) {
      if (arg.includes('\n') && NEWLINE_HASH_RE.test(arg)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside a quoted argument can hide arguments from path validation',
        }
      }
    }
    for (const ev of cmd.envVars) {
      if (ev.value.includes('\n') && NEWLINE_HASH_RE.test(ev.value)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside an env var value can hide arguments from path validation',
        }
      }
    }
    for (const r of cmd.redirects) {
      if (r.target.includes('\n') && NEWLINE_HASH_RE.test(r.target)) {
        return {
          ok: false,
          reason:
            'Newline followed by # inside a redirect target can hide arguments from path validation',
        }
      }
    }

    // jq's system() built-in executes arbitrary shell commands, and flags
    // like --from-file can read arbitrary files into jq variables. On the
    // legacy path these are caught by validateJqCommand in bashSecurity.ts,
    // but that validator is gated behind `astSubcommands === null` and
    // never runs when the AST parse succeeds. Mirror the checks here so
    // the AST path has the same defence.
// jq 的两类危险：`system()` 内建执行任意 shell 命令；`-f`、`-L`、`--from-file`、`--rawfile`、`--slurpfile`、`--library-path` 能把任意文件读进变量或加载代码。旧路径上这些由 bashSecurity 里的专门校验拦，但那个校验被「AST 子命令为空」的条件挡住，解析成功时根本不跑——这里镜像一份，让 AST 路径有同等防御。
    if (name === 'jq') {
      for (const arg of a) {
        if (/\bsystem\s*\(/.test(arg)) {
          return {
            ok: false,
            reason:
              'jq command contains system() function which executes arbitrary commands',
          }
        }
      }
      if (
        a.some(arg =>
          /^(?:-[fL](?:$|[^A-Za-z])|--(?:from-file|rawfile|slurpfile|library-path)(?:$|=))/.test(
            arg,
          ),
        )
      ) {
        return {
          ok: false,
          reason:
            'jq command contains dangerous flags that could execute code or read arbitrary files',
        }
      }
    }

// zsh 危险内建按名字拦。
    if (ZSH_DANGEROUS_BUILTINS.has(name)) {
      return {
        ok: false,
        reason: `Zsh builtin '${name}' can bypass security checks`,
      }
    }

// eval 类内建带三个精确例外，避免误报：`command -v` 与 `command -V` 只做存在性检查、只打印路径，从不执行 argv[1]（裸 `command foo` 会绕过函数与别名查找，仍然拒绝）；`fc` 只有含 `e`（调用编辑器后执行）或 `s`（重新执行上一条匹配命令）短选项时才危险，`fc -l` 是列历史；`compgen` 只有含 `C`（立即执行）、`F`（调 shell 函数）、`W`（词展开，单引号里的 `$()` 也会展开）时危险，`-c`/`-f`/`-v` 只列补全项。
    if (EVAL_LIKE_BUILTINS.has(name)) {
      // `command -v foo` / `command -V foo` are POSIX existence checks that
      // only print paths — they never execute argv[1]. Bare `command foo`
      // does bypass function/alias lookup (the concern), so keep blocking it.
      if (name === 'command' && (a[1] === '-v' || a[1] === '-V')) {
        // fall through to remaining checks
      } else if (
        name === 'fc' &&
        !a.slice(1).some(arg => /^-[^-]*[es]/.test(arg))
      ) {
        // `fc -l`, `fc -ln` list history — safe. `fc -e ed` invokes an
        // editor then executes. `fc -s [pat=rep]` RE-EXECUTES the last
        // matching command (optionally with substitution) — as dangerous
        // as eval. Block any short-opt containing `e` or `s`.
        // to avoid introducing FPs for `fc -l` (list history).
      } else if (
        name === 'compgen' &&
        !a.slice(1).some(arg => /^-[^-]*[CFW]/.test(arg))
      ) {
        // `compgen -c/-f/-v` only list completions — safe. `compgen -C cmd`
        // immediately executes cmd; `-F func` calls a shell function; `-W list`
        // word-expands its argument (including $(cmd) even from single-quoted
        // raw_string). Block any short-opt containing C/F/W (case-sensitive:
        // -c/-f are safe).
      } else {
        return {
          ok: false,
          reason: `'${name}' evaluates arguments as shell code`,
        }
      }
    }

    // /proc/*/environ exposes env vars (including secrets) of other processes.
    // Check argv and redirect targets — `cat /proc/self/environ` and
    // `cat < /proc/self/environ` both read it.
// 最后一道：argv 与重定向目标里的 proc 环境文件。`cat /proc/self/environ` 与 `cat < /proc/self/environ` 都能读到其他进程的环境变量（含密钥）。
    for (const arg of cmd.argv) {
      if (arg.includes('/proc/') && PROC_ENVIRON_RE.test(arg)) {
        return {
          ok: false,
          reason: 'Accesses /proc/*/environ which may expose secrets',
        }
      }
    }
    for (const r of cmd.redirects) {
      if (r.target.includes('/proc/') && PROC_ENVIRON_RE.test(r.target)) {
        return {
          ok: false,
          reason: 'Accesses /proc/*/environ which may expose secrets',
        }
      }
    }
  }
  return { ok: true }
// 全部命令检查完毕，返回通过。注意这里的「通过」只意味着「argv 可信且不命中已知危险模式」，命令仍要走后续的权限规则匹配与路径校验。
}
