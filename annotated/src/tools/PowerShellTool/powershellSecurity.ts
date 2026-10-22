/**
 * PowerShell-specific security analysis for command validation.
 *
 * Detects dangerous patterns: code injection, download cradles, privilege
 * escalation, dynamic command names, COM objects, etc.
 *
 * All checks are AST-based. If parsing failed (valid=false), none of the
 * individual checks match and powershellCommandIsSafe returns 'ask'.
 */
// PowerShell 安全分析：代码注入、下载摇篮、提权、动态命令名、COM 对象等。全部基于 AST——解析失败（valid=false）时任何单项检查都不命中，powershellCommandIsSafe 直接返回 ask。

import {
  DANGEROUS_SCRIPT_BLOCK_CMDLETS,
  FILEPATH_EXECUTION_CMDLETS,
  MODULE_LOADING_CMDLETS,
} from '../../utils/powershell/dangerousCmdlets.js'
import type {
  ParsedCommandElement,
  ParsedPowerShellCommand,
} from '../../utils/powershell/parser.js'
import {
  COMMON_ALIASES,
  commandHasArgAbbreviation,
  deriveSecurityFlags,
  getAllCommands,
  getVariablesByScope,
  hasCommandNamed,
} from '../../utils/powershell/parser.js'
import { isClmAllowedType } from './clmTypes.js'

type PowerShellSecurityResult = {
  behavior: 'passthrough' | 'ask' | 'allow'
  message?: string
}

const POWERSHELL_EXECUTABLES = new Set([
  'pwsh',
  'pwsh.exe',
  'powershell',
  'powershell.exe',
])

/**
 * Extracts the base executable name from a command, handling full paths
 * like /usr/bin/pwsh, C:\Windows\...\powershell.exe, or .\pwsh.
 */
function isPowerShellExecutable(name: string): boolean {
  const lower = name.toLowerCase()
  if (POWERSHELL_EXECUTABLES.has(lower)) {
    return true
  }
  // Extract basename from paths (both / and \ separators)
  const lastSep = Math.max(lower.lastIndexOf('/'), lower.lastIndexOf('\\'))
  if (lastSep >= 0) {
    return POWERSHELL_EXECUTABLES.has(lower.slice(lastSep + 1))
  }
  return false
}
// isPowerShellExecutable 从全路径里抠基名：/usr/bin/pwsh、C:\Windows\...\powershell.exe、.\pwsh 都算。

/**
 * Alternative parameter-prefix characters that PowerShell accepts as equivalent
 * to ASCII hyphen-minus (U+002D). PowerShell's tokenizer (SpecialCharacters.IsDash)
 * and powershell.exe's CommandLineParameterParser both accept all four dash
 * characters plus Windows PowerShell 5.1's `/` parameter delimiter.
 * Extent.Text preserves the raw character; transformCommandAst uses ce.text for
 * CommandParameterAst elements, so these reach us unchanged.
 */
const PS_ALT_PARAM_PREFIXES = new Set([
  '/', // Windows PowerShell 5.1 (powershell.exe, not pwsh 7+)
  '\u2013', // en-dash
  '\u2014', // em-dash
  '\u2015', // horizontal bar
])
// PS 另类参数前缀：/（5.1 的 powershell.exe）、en-dash、em-dash、horizontal bar。PowerShell 的 tokenizer（SpecialCharacters.IsDash）与 powershell.exe 的 CommandLineParameterParser 都认这四种，Extent.Text 保留原字符——所以 Start-Process foo –Verb RunAs（en-dash）曾绕过裸 commandHasArgAbbreviation 检查。

/**
 * Wrapper around commandHasArgAbbreviation that also matches alternative
 * parameter prefixes (`/`, en-dash, em-dash, horizontal-bar). PowerShell's
 * tokenizer (SpecialCharacters.IsDash) accepts these for both powershell.exe
 * args AND cmdlet parameters, so use this for ALL PS param checks — not just
 * pwsh.exe invocations. Previously checkComObject/checkStartProcess/
 * checkDangerousFilePathExecution/checkForEachMemberName used bare
 * commandHasArgAbbreviation, so `Start-Process foo –Verb RunAs` bypassed.
 */
function psExeHasParamAbbreviation(
  cmd: ParsedCommandElement,
  fullParam: string,
  minPrefix: string,
): boolean {
  if (commandHasArgAbbreviation(cmd, fullParam, minPrefix)) {
    return true
  }
  // Normalize alternative prefixes to `-` and re-check. Build a synthetic cmd
  // with normalized args; commandHasArgAbbreviation handles colon-value split.
  const normalized: ParsedCommandElement = {
    ...cmd,
    args: cmd.args.map(a =>
      a.length > 0 && PS_ALT_PARAM_PREFIXES.has(a[0]!) ? '-' + a.slice(1) : a,
    ),
  }
  return commandHasArgAbbreviation(normalized, fullParam, minPrefix)
}
// psExeHasParamAbbreviation：把另类前缀归一成 - 再查缩写匹配，覆盖所有 PS 参数检查（不只 pwsh.exe 调用）。

/**
 * Checks if a PowerShell command uses Invoke-Expression or its alias (iex).
 * These are equivalent to eval and can execute arbitrary code.
 */
function checkInvokeExpression(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (hasCommandNamed(parsed, 'Invoke-Expression')) {
    return {
      behavior: 'ask',
      message:
        'Command uses Invoke-Expression which can execute arbitrary code',
    }
  }
  return { behavior: 'passthrough' }
}
// Invoke-Expression/iex = eval，能执行任意代码。

/**
 * Checks for dynamic command invocation where the command name itself is an
 * expression that cannot be statically resolved.
 *
 * PoCs:
 *   & ${function:Invoke-Expression} 'payload'  — VariableExpressionAst
 *   & ('iex','x')[0] 'payload'                 — IndexExpressionAst → 'Other'
 *   & ('i'+'ex') 'payload'                     — BinaryExpressionAst → 'Other'
 *
 * In all cases cmd.name is the literal extent text (e.g. "('iex','x')[0]"),
 * which doesn't match hasCommandNamed('Invoke-Expression'). At runtime
 * PowerShell evaluates the expression to a command name and invokes it.
 *
 * Legitimate command names are ALWAYS StringConstantExpressionAst (mapped to
 * 'StringConstant'): `Get-Process`, `git`, `ls`. Any other element type in
 * name position is dynamic. Rather than denylisting dynamic types (fragile —
 * mapElementType's default case maps unknown AST types to 'Other', which a
 * `=== 'Variable'` check misses), we allowlist 'StringConstant'.
 *
 * elementTypes[0] is the command-name element (transformCommandAst pushes it
 * first, before arg elements). The `!== undefined` guard preserves fail-open
 * when elementTypes is absent (parse-detail unavailable — if parsing failed
 * entirely, valid=false already returns 'ask' earlier in the chain).
 */
function checkDynamicCommandName(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    if (cmd.elementType !== 'CommandAst') {
      continue
    }
    const nameElementType = cmd.elementTypes?.[0]
    if (nameElementType !== undefined && nameElementType !== 'StringConstant') {
      return {
        behavior: 'ask',
        message:
          'Command name is a dynamic expression which cannot be statically validated',
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 动态命令名：& ${function:Invoke-Expression} 'payload'、& ('iex','x')[0]、& ('i'+'ex')——cmd.name 是字面 extent 文本，hasCommandNamed 匹配不上，运行时却求值成命令名执行。合法命令名永远是 StringConstantExpressionAst，所以白名单放行 StringConstant、其余全 ask（denylist 动态类型太脆：未知 AST 类型默认映射到 'Other'，=== 'Variable' 会漏）。

/**
 * Checks for encoded command parameters which obscure intent.
 * These are commonly used in malware to bypass security tools.
 */
function checkEncodedCommand(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    if (isPowerShellExecutable(cmd.name)) {
      if (psExeHasParamAbbreviation(cmd, '-encodedcommand', '-e')) {
        return {
          behavior: 'ask',
          message: 'Command uses encoded parameters which obscure intent',
        }
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 编码参数 -EncodedCommand/-e：恶意软件绕过安全工具的常用手法。

/**
 * Checks for PowerShell re-invocation (nested pwsh/powershell process).
 *
 * Any PowerShell executable in command position is flagged — not just
 * -Command/-File. Bare `pwsh` receiving stdin (`Get-Content x | pwsh`) or
 * a positional script path executes arbitrary code with none of the explicit
 * flags present. Same unvalidatable-nested-process reasoning as
 * checkStartProcess vector 2: we cannot statically analyze what the child
 * process will run.
 */
function checkPwshCommandOrFile(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    if (isPowerShellExecutable(cmd.name)) {
      return {
        behavior: 'ask',
        message:
          'Command spawns a nested PowerShell process which cannot be validated',
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 嵌套 PowerShell 进程：命令位出现任何 PS 可执行文件就拦——不只 -Command/-File。裸 pwsh 收 stdin（Get-Content x | pwsh）或位置脚本路径同样执行任意代码，且无显式 flag。

/**
 * Checks for download cradle patterns - common malware techniques
 * that download and execute remote code.
 *
 * Per-statement: catches piped cradles (`IWR ... | IEX`).
 * Cross-statement: catches split cradles (`$r = IWR ...; IEX $r.Content`).
 * The cross-statement case is already blocked by checkInvokeExpression (which
 * scans all statements), but this check improves the warning message.
 */
const DOWNLOADER_NAMES = new Set([
  'invoke-webrequest',
  'iwr',
  'invoke-restmethod',
  'irm',
  'new-object',
  'start-bitstransfer', // MITRE T1197
])
// 下载器名单：Invoke-WebRequest/Invoke-RestMethod/New-Object/Start-BitsTransfer（MITRE T1197）。

function isDownloader(name: string): boolean {
  return DOWNLOADER_NAMES.has(name.toLowerCase())
}

function isIex(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'invoke-expression' || lower === 'iex'
}

function checkDownloadCradles(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  // Per-statement: piped cradle (IWR ... | IEX)
  for (const statement of parsed.statements) {
    const cmds = statement.commands
    if (cmds.length < 2) {
      continue
    }
    const hasDownloader = cmds.some(cmd => isDownloader(cmd.name))
    const hasIex = cmds.some(cmd => isIex(cmd.name))
    if (hasDownloader && hasIex) {
      return {
        behavior: 'ask',
        message: 'Command downloads and executes remote code',
      }
    }
  }

  // Cross-statement: split cradle ($r = IWR ...; IEX $r.Content).
  // No new false positives: if IEX is present, checkInvokeExpression already asks.
  const all = getAllCommands(parsed)
  if (all.some(c => isDownloader(c.name)) && all.some(c => isIex(c.name))) {
    return {
      behavior: 'ask',
      message: 'Command downloads and executes remote code',
    }
  }

  return { behavior: 'passthrough' }
}
// 下载摇篮两级：管道内（IWR ... | IEX）按语句查，跨语句（$r = IWR ...; IEX $r.Content）查全部命令——跨语句场景 checkInvokeExpression 已拦，这里只是把警告消息写清楚。

/**
 * Checks for standalone download utilities — LOLBAS tools commonly used to
 * fetch payloads. Unlike checkDownloadCradles (which requires download + IEX
 * in-pipeline), this flags the download operation itself.
 *
 * Start-BitsTransfer: always a file transfer (MITRE T1197).
 * certutil -urlcache: classic LOLBAS download. Only flagged with -urlcache;
 * bare `certutil` has many legitimate cert-management uses.
 * bitsadmin /transfer: legacy BITS download (pre-PowerShell).
 */
function checkDownloadUtilities(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    // Start-BitsTransfer is purpose-built for file transfer — no safe variant.
    if (lower === 'start-bitstransfer') {
      return {
        behavior: 'ask',
        message: 'Command downloads files via BITS transfer',
      }
    }
    // certutil / certutil.exe — only when -urlcache is present. certutil has
    // many non-download uses (cert store queries, encoding, etc.).
    // certutil.exe accepts both -urlcache and /urlcache per standard Windows
    // utility convention — check both forms (bitsadmin below does the same).
    if (lower === 'certutil' || lower === 'certutil.exe') {
      const hasUrlcache = cmd.args.some(a => {
        const la = a.toLowerCase()
        return la === '-urlcache' || la === '/urlcache'
      })
      if (hasUrlcache) {
        return {
          behavior: 'ask',
          message: 'Command uses certutil to download from a URL',
        }
      }
    }
    // bitsadmin /transfer — legacy BITS CLI, same threat as Start-BitsTransfer.
    if (lower === 'bitsadmin' || lower === 'bitsadmin.exe') {
      if (cmd.args.some(a => a.toLowerCase() === '/transfer')) {
        return {
          behavior: 'ask',
          message: 'Command downloads files via BITS transfer',
        }
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 独立下载工具（LOLBAS）：Start-BitsTransfer 恒拦（就是干传输的）；certutil 只在 -urlcache 时拦（裸 certutil 有很多正当证书管理用途，且 -urlcache 与 /urlcache 两种写法都查）；bitsadmin /transfer 同理。

/**
 * Checks for Add-Type usage which compiles and loads .NET code at runtime.
 * This can be used to execute arbitrary compiled code.
 */
function checkAddType(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (hasCommandNamed(parsed, 'Add-Type')) {
    return {
      behavior: 'ask',
      message: 'Command compiles and loads .NET code',
    }
  }
  return { behavior: 'passthrough' }
}
// Add-Type 运行时编译加载 .NET 代码。

/**
 * Checks for New-Object -ComObject. COM objects like WScript.Shell,
 * Shell.Application, MMC20.Application, Schedule.Service, Msxml2.XMLHTTP
 * have their own execution/download capabilities — no IEX required.
 *
 * We can't enumerate all dangerous ProgIDs, so flag any -ComObject. Object
 * creation alone is inert, but the prompt should warn the user that COM
 * instantiation is an execution primitive. Method invocation on the result
 * (.Run(), .Exec()) is separately caught by checkMemberInvocations.
 */
function checkComObject(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    if (cmd.name.toLowerCase() !== 'new-object') {
      continue
    }
    // -ComObject min abbrev is -com (New-Object params: -TypeName, -ComObject,
    // -ArgumentList, -Property, -Strict; -co is ambiguous in PS5.1 due to
    // common params like -Confirm, so use -com).
    if (psExeHasParamAbbreviation(cmd, '-comobject', '-com')) {
      return {
        behavior: 'ask',
        message:
          'Command instantiates a COM object which may have execution capabilities',
      }
    }
    // SECURITY: checkTypeLiterals only sees [bracket] syntax from
    // parsed.typeLiterals. `New-Object System.Net.WebClient` passes the type
    // as a STRING ARG (StringConstantExpressionAst), not a TypeExpressionAst,
    // so CLM never fires. Extract -TypeName (named, colon-bound, or
    // positional-0) and run through isClmAllowedType. Closes attackVectors D4.
    let typeName: string | undefined
    for (let i = 0; i < cmd.args.length; i++) {
      const a = cmd.args[i]!
      const lower = a.toLowerCase()
      // -TypeName abbrev: -t is unambiguous (no other New-Object -t* params).
      // Handle colon-bound form first: -TypeName:Foo.Bar
      if (lower.startsWith('-t') && lower.includes(':')) {
        const colonIdx = a.indexOf(':')
        const paramPart = lower.slice(0, colonIdx)
        if ('-typename'.startsWith(paramPart)) {
          typeName = a.slice(colonIdx + 1)
          break
        }
      }
      // Space-separated form: -TypeName Foo.Bar
      if (
        lower.startsWith('-t') &&
        '-typename'.startsWith(lower) &&
        cmd.args[i + 1] !== undefined
      ) {
        typeName = cmd.args[i + 1]
        break
      }
    }
    // Positional-0 binds to -TypeName (NetParameterSet default). Named params
    // (-Strict, -ArgumentList, -Property, -ComObject) may appear before the
    // positional TypeName, so scan past them to find the first non-consumed arg.
    if (typeName === undefined) {
      // New-Object named params that consume a following value argument
      const VALUE_PARAMS = new Set(['-argumentlist', '-comobject', '-property'])
      // Switch params (no value argument)
      const SWITCH_PARAMS = new Set(['-strict'])
      for (let i = 0; i < cmd.args.length; i++) {
        const a = cmd.args[i]!
        if (a.startsWith('-')) {
          const lower = a.toLowerCase()
          // Skip -TypeName variants (already handled by named-param loop above)
          if (lower.startsWith('-t') && '-typename'.startsWith(lower)) {
            i++ // skip value
            continue
          }
          // Colon-bound form: -Param:Value (single token, no skip needed)
          if (lower.includes(':')) continue
          if (SWITCH_PARAMS.has(lower)) continue
          if (VALUE_PARAMS.has(lower)) {
            i++ // skip value
            continue
          }
          // Unknown param — skip conservatively
          continue
        }
        // First non-dash arg is the positional TypeName
        typeName = a
        break
      }
    }
    if (typeName !== undefined && !isClmAllowedType(typeName)) {
      return {
        behavior: 'ask',
        message: `New-Object instantiates .NET type '${typeName}' outside the ConstrainedLanguage allowlist`,
      }
    }
  }
  return { behavior: 'passthrough' }
}
// New-Object -ComObject：WScript.Shell、Shell.Application、MMC20.Application、Schedule.Service、Msxml2.XMLHTTP 都自带执行/下载能力，不需要 IEX。枚举不完所有危险 ProgID，任何 -ComObject 都 ask。-com 是最小无歧义缩写（-co 在 5.1 里与 -Confirm 撞）。另外 checkTypeLiterals 只看得见 [bracket] 语法，New-Object System.Net.WebClient 把类型当字符串参数传、CLM 永不触发——这里抽 -TypeName（命名/冒号/位置 0）过 isClmAllowedType 补漏（attackVectors D4）。

/**
 * Checks for DANGEROUS_SCRIPT_BLOCK_CMDLETS invoked with -FilePath (or
 * -LiteralPath). These run a script file — arbitrary code execution with no
 * ScriptBlockAst in the tree.
 *
 * checkScriptBlockInjection only fires when hasScriptBlocks is true. With
 * -FilePath there is no ScriptBlockAst, so DANGEROUS_SCRIPT_BLOCK_CMDLETS is
 * never consulted. This check closes that gap for the -FilePath vector.
 *
 * Cmdlets in DANGEROUS_SCRIPT_BLOCK_CMDLETS that accept -FilePath:
 *   Invoke-Command   -FilePath             (icm alias via COMMON_ALIASES)
 *   Start-Job        -FilePath, -LiteralPath
 *   Start-ThreadJob  -FilePath
 *   Register-ScheduledJob -FilePath
 * The *-PSSession and Register-*Event entries do not accept -FilePath.
 *
 * -f is unambiguous for -FilePath on all four (no other -f* params).
 * -l is unambiguous for -LiteralPath on Start-Job; harmless no-op on the
 * others (no -l* params to collide with).
 */

function checkDangerousFilePathExecution(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    const resolved = COMMON_ALIASES[lower]?.toLowerCase() ?? lower
    if (!FILEPATH_EXECUTION_CMDLETS.has(resolved)) {
      continue
    }
    if (
      psExeHasParamAbbreviation(cmd, '-filepath', '-f') ||
      psExeHasParamAbbreviation(cmd, '-literalpath', '-l')
    ) {
      return {
        behavior: 'ask',
        message: `${cmd.name} -FilePath executes an arbitrary script file`,
      }
    }
    // Positional binding: `Start-Job script.ps1` binds position-0 to
    // -FilePath via FilePathParameterSet resolution (ScriptBlock args select
    // ScriptBlockParameterSet instead). Same pattern as checkForEachMemberName:
    // any non-dash StringConstant is a potential -FilePath. Over-flagging
    // (e.g., `Start-Job -Name foo` where `foo` is StringConstant) is fail-safe.
    for (let i = 0; i < cmd.args.length; i++) {
      const argType = cmd.elementTypes?.[i + 1]
      const arg = cmd.args[i]
      if (argType === 'StringConstant' && arg && !arg.startsWith('-')) {
        return {
          behavior: 'ask',
          message: `${cmd.name} with positional string argument binds to -FilePath and executes a script file`,
        }
      }
    }
  }
  return { behavior: 'passthrough' }
}
// -FilePath 向量：Invoke-Command/Start-Job/Start-ThreadJob/Register-ScheduledJob 带 -FilePath 跑脚本文件，树里没有 ScriptBlockAst，checkScriptBlockInjection 永不触发。位置参数也查——Start-Job script.ps1 的位置 0 绑 -FilePath；过度标记是 fail-safe（Start-Job -Name foo 的 foo 也是 StringConstant）。

/**
 * Checks for ForEach-Object -MemberName. Invokes a method by string name on
 * every piped object — semantically equivalent to `| % { $_.Method() }` but
 * without any ScriptBlockAst or InvokeMemberExpressionAst in the tree.
 *
 * PoC: `Get-Process | ForEach-Object -MemberName Kill` → kills all processes.
 * checkScriptBlockInjection misses it (no script block); checkMemberInvocations
 * misses it (no .Method() syntax). Aliases `%` and `foreach` resolve via
 * COMMON_ALIASES.
 */
function checkForEachMemberName(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    const resolved = COMMON_ALIASES[lower]?.toLowerCase() ?? lower
    if (resolved !== 'foreach-object') {
      continue
    }
    // ForEach-Object params starting with -m: only -MemberName. -m is unambiguous.
    if (psExeHasParamAbbreviation(cmd, '-membername', '-m')) {
      return {
        behavior: 'ask',
        message:
          'ForEach-Object -MemberName invokes methods by string name which cannot be validated',
      }
    }
    // PS7+: `ForEach-Object Kill` binds a positional string arg to
    // -MemberName via MemberSet parameter-set resolution (ScriptBlock args
    // select ScriptBlockSet instead). Scan ALL args — `-Verbose Kill` or
    // `-ErrorAction Stop Kill` still binds Kill positionally. Any non-dash
    // StringConstant is a potential -MemberName; over-flagging is fail-safe.
    for (let i = 0; i < cmd.args.length; i++) {
      const argType = cmd.elementTypes?.[i + 1]
      const arg = cmd.args[i]
      if (argType === 'StringConstant' && arg && !arg.startsWith('-')) {
        return {
          behavior: 'ask',
          message:
            'ForEach-Object with positional string argument binds to -MemberName and invokes methods by name',
        }
      }
    }
  }
  return { behavior: 'passthrough' }
}
// ForEach-Object -MemberName：Get-Process | ForEach-Object -MemberName Kill 杀光进程，语义等价于 | % { $_.Method() } 但树里既无 ScriptBlockAst 也无 InvokeMemberExpressionAst。PS7+ 的位置参数也绑 -MemberName（MemberSet 参数集），扫全部参数。

/**
 * Checks for dangerous Start-Process patterns.
 *
 * Two vectors:
 * 1. `-Verb RunAs` — privilege escalation (UAC prompt).
 * 2. Launching a PowerShell executable — nested invocation.
 * `Start-Process pwsh -ArgumentList "-e <b64>"` evades
 * checkEncodedCommand/checkPwshCommandOrFile because cmd.name is
 * `Start-Process`, not `pwsh`. The `-e` lives inside the -ArgumentList
 * string value and is never parsed as a param on the outer command.
 * Rather than parse -ArgumentList contents (fragile — it's an opaque
 * string or array), flag any Start-Process whose target is a PS
 * executable: the nested invocation is unvalidatable by construction.
 */
function checkStartProcess(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    if (lower !== 'start-process' && lower !== 'saps' && lower !== 'start') {
      continue
    }
    // Vector 1: -Verb RunAs (space or colon syntax).
    // Space syntax: psExeHasParamAbbreviation finds -Verb/-v, then scan args
    // for a bare 'runas' token.
    if (
      psExeHasParamAbbreviation(cmd, '-Verb', '-v') &&
      cmd.args.some(a => a.toLowerCase() === 'runas')
    ) {
      return {
        behavior: 'ask',
        message: 'Command requests elevated privileges',
      }
    }
    // Colon syntax — two layers:
    // (a) Structural: PR #23554 added children[] for colon-bound param args.
    //     children[i] = [{type, text}] for the bound value. Check if any
    //     -v*-prefixed param has a child whose text normalizes (strip
    //     quotes/backtick/whitespace) to 'runas'. Robust against arbitrary
    //     quoting the regex can't anticipate.
    // (b) Regex fallback: for parsed output without children[] or as
    //     defense-in-depth. -Verb:'RunAs', -Verb:"RunAs", -Verb:`runas all
    //     bypassed the old /...:runas$/ pattern because the quote/tick broke
    //     the match.
    if (cmd.children) {
      for (let i = 0; i < cmd.args.length; i++) {
        // Strip backticks before matching param name (bug #14): -V`erb:RunAs
        const argClean = cmd.args[i]!.replace(/`/g, '')
        if (!/^[-\u2013\u2014\u2015/]v[a-z]*:/i.test(argClean)) continue
        const kids = cmd.children[i]
        if (!kids) continue
        for (const child of kids) {
          if (child.text.replace(/['"`\s]/g, '').toLowerCase() === 'runas') {
            return {
              behavior: 'ask',
              message: 'Command requests elevated privileges',
            }
          }
        }
      }
    }
    if (
      cmd.args.some(a => {
        // Strip backticks before matching (bug #14 / review nit #2)
        const clean = a.replace(/`/g, '')
        return /^[-\u2013\u2014\u2015/]v[a-z]*:['"` ]*runas['"` ]*$/i.test(
          clean,
        )
      })
    ) {
      return {
        behavior: 'ask',
        message: 'Command requests elevated privileges',
      }
    }
    // Vector 2: Start-Process targeting a PowerShell executable.
    // Target is either the first positional arg or the value after -FilePath.
    // Scan all args — any PS-executable token present is treated as the launch
    // target. Known false-positive: path-valued params (-WorkingDirectory,
    // -RedirectStandard*) whose basename is pwsh/powershell —
    // isPowerShellExecutable extracts basenames from paths, so
    // `-WorkingDirectory C:\projects\pwsh` triggers. Accepted trade-off:
    // Start-Process is not in CMDLET_ALLOWLIST (always prompts regardless),
    // result is ask not reject, and correctly parsing Start-Process parameter
    // binding is fragile. Strip quotes the parser may have preserved.
    for (const arg of cmd.args) {
      const stripped = arg.replace(/^['"]|['"]$/g, '')
      if (isPowerShellExecutable(stripped)) {
        return {
          behavior: 'ask',
          message:
            'Start-Process launches a nested PowerShell process which cannot be validated',
        }
      }
    }
  }
  return { behavior: 'passthrough' }
}
// Start-Process 两向量：-Verb RunAs 提权（UAC 弹窗）；目标是 PS 可执行文件——Start-Process pwsh -ArgumentList 里塞 -e <b64>，外层命令的 cmd.name 是 Start-Process，checkEncodedCommand/checkPwshCommandOrFile 全部看不见。-Verb:'RunAs' 的引号/反引号形态曾绕过旧正则，现在 structural（children 树）+ regex 双层。已知误报：-WorkingDirectory C:\projects\pwsh 的基名是 pwsh——Start-Process 本就不在白名单（恒 ask），结果只是 ask 不是 reject，认了。

/**
 * Cmdlets where script blocks are safe (filtering/output cmdlets).
 * Script blocks piped to these are just predicates or projections, not arbitrary execution.
 */
const SAFE_SCRIPT_BLOCK_CMDLETS = new Set([
  'where-object',
  'sort-object',
  'select-object',
  'group-object',
  'format-table',
  'format-list',
  'format-wide',
  'format-custom',
  // NOT foreach-object — its block is arbitrary script, not a predicate.
  // getAllCommands recurses so commands inside the block ARE checked, but
  // non-command AST nodes (AssignmentStatementAst etc.) are invisible to it.
  // See powershellPermissions.ts step-5 hasScriptBlocks guard.
])
// 安全脚本块消费者：Where/Sort/Select/Group/Format-*——喂给它们的脚本块只是谓词或投影。故意不含 foreach-object：它的块是任意脚本；getAllCommands 递归得到块内命令，但 AssignmentStatementAst 等非命令节点看不见。

/**
 * Checks for script block injection patterns where script blocks
 * appear in suspicious contexts that could execute arbitrary code.
 *
 * Script blocks used with safe filtering/output cmdlets (Where-Object,
 * Sort-Object, Select-Object, Group-Object) are allowed.
 * Script blocks used with dangerous cmdlets (Invoke-Command, Invoke-Expression,
 * Start-Job, etc.) are flagged.
 */
function checkScriptBlockInjection(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  const security = deriveSecurityFlags(parsed)
  if (!security.hasScriptBlocks) {
    return { behavior: 'passthrough' }
  }

  // Check all commands in the parsed result. If any command is in the
  // dangerous set, flag it. If all commands with script blocks are in
  // the safe set (or the allowlist), allow it.
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    if (DANGEROUS_SCRIPT_BLOCK_CMDLETS.has(lower)) {
      return {
        behavior: 'ask',
        message:
          'Command contains script block with dangerous cmdlet that may execute arbitrary code',
      }
    }
  }

  // Check if all commands are either safe script block consumers or don't use script blocks
  const allCommandsSafe = getAllCommands(parsed).every(cmd => {
    const lower = cmd.name.toLowerCase()
    // Safe filtering/output cmdlets
    if (SAFE_SCRIPT_BLOCK_CMDLETS.has(lower)) {
      return true
    }
    // Resolve aliases
    const alias = COMMON_ALIASES[lower]
    if (alias && SAFE_SCRIPT_BLOCK_CMDLETS.has(alias.toLowerCase())) {
      return true
    }
    // Unknown command with script blocks present — flag as potentially dangerous
    return false
  })

  if (allCommandsSafe) {
    return { behavior: 'passthrough' }
  }

  return {
    behavior: 'ask',
    message: 'Command contains script block that may execute arbitrary code',
  }
}
// 脚本块注入：树里有脚本块 + 任一危险 cmdlet → ask；全是安全消费者 → 放行；出现不认识的命令 → ask。

/**
 * AST-only check: Detects subexpressions $() which can hide command execution.
 */
function checkSubExpressions(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (deriveSecurityFlags(parsed).hasSubExpressions) {
    return {
      behavior: 'ask',
      message: 'Command contains subexpressions $()',
    }
  }
  return { behavior: 'passthrough' }
}
// 子表达式 $() 能藏命令执行。

/**
 * AST-only check: Detects expandable strings (double-quoted) with embedded
 * expressions like "$env:PATH" or "$(dangerous-command)". These can hide
 * command execution or variable interpolation inside string literals.
 */
function checkExpandableStrings(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (deriveSecurityFlags(parsed).hasExpandableStrings) {
    return {
      behavior: 'ask',
      message: 'Command contains expandable strings with embedded expressions',
    }
  }
  return { behavior: 'passthrough' }
}
// 可展开字符串（双引号）里的内嵌表达式：$env:PATH、$(dangerous-command)。

/**
 * AST-only check: Detects splatting (@variable) which can obscure arguments.
 */
function checkSplatting(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (deriveSecurityFlags(parsed).hasSplatting) {
    return {
      behavior: 'ask',
      message: 'Command uses splatting (@variable)',
    }
  }
  return { behavior: 'passthrough' }
}
// splatting（@variable）把参数藏进变量。

/**
 * AST-only check: Detects stop-parsing token (--%) which prevents further parsing.
 */
function checkStopParsing(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (deriveSecurityFlags(parsed).hasStopParsing) {
    return {
      behavior: 'ask',
      message: 'Command uses stop-parsing token (--%)',
    }
  }
  return { behavior: 'passthrough' }
}
// 停止解析符 --%：其后一切原样传给原生命令。

/**
 * AST-only check: Detects .NET method invocations which can access system APIs.
 */
function checkMemberInvocations(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  if (deriveSecurityFlags(parsed).hasMemberInvocations) {
    return {
      behavior: 'ask',
      message: 'Command invokes .NET methods',
    }
  }
  return { behavior: 'passthrough' }
}
// .NET 方法调用能碰系统 API。

/**
 * AST-only check: type literals outside Microsoft's ConstrainedLanguage
 * allowlist. CLM blocks all .NET type access except ~90 primitives/attributes
 * Microsoft considers safe for untrusted code. We trust that list as the
 * "safe" boundary — anything outside it (Reflection.Assembly, IO.Pipes,
 * Diagnostics.Process, InteropServices.Marshal, etc.) can access system APIs
 * that compromise the permission model.
 *
 * Runs AFTER checkMemberInvocations: that broadly flags any ::Method / .Method()
 * call; this check is the more specific "which types" signal. Both fire on
 * [Reflection.Assembly]::Load; CLM gives the precise message. Pure type casts
 * like [int]$x have no member invocation and only hit this check.
 */
function checkTypeLiterals(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const t of parsed.typeLiterals ?? []) {
    if (!isClmAllowedType(t)) {
      return {
        behavior: 'ask',
        message: `Command uses .NET type [${t}] outside the ConstrainedLanguage allowlist`,
      }
    }
  }
  return { behavior: 'passthrough' }
}
// CLM 类型字面量：微软 ConstrainedLanguage 只放行约 90 个被认为对不可信代码安全的原语/特性，名单外的一律 ask（Reflection.Assembly、IO.Pipes、Diagnostics.Process、InteropServices.Marshal……）。跑在 checkMemberInvocations 之后：那个广撒网（任何 ::Method/.Method()），这个给精确的「哪些类型」信号；纯类型转换 [int]$x 无方法调用，只命中这条。

/**
 * Invoke-Item (alias ii) opens a file with its default handler (ShellExecute
 * on Windows, open/xdg-open on Unix). On an .exe/.ps1/.bat/.cmd this is RCE.
 * Bug 008: ii is in no blocklist; passthrough prompt doesn't explain the
 * exec hazard. Always ask — there is no safe variant (even opening .txt may
 * invoke a user-configured handler that accepts arguments).
 */
function checkInvokeItem(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    if (lower === 'invoke-item' || lower === 'ii') {
      return {
        behavior: 'ask',
        message:
          'Invoke-Item opens files with the default handler (ShellExecute). On executable files this runs arbitrary code.',
      }
    }
  }
  return { behavior: 'passthrough' }
}
// Invoke-Item/ii 用默认处理器打开文件（Windows ShellExecute）：对 .exe/.ps1/.bat/.cmd 就是 RCE。没有安全变体——连打开 .txt 都可能调用接受参数的用户配置处理器，恒 ask。

/**
 * Scheduled-task persistence primitives. Register-ScheduledJob was blocked
 * (DANGEROUS_SCRIPT_BLOCK_CMDLETS); the newer Register-ScheduledTask cmdlet
 * and legacy schtasks.exe /create were not. Persistence that survives the
 * session with no explanatory prompt.
 */
const SCHEDULED_TASK_CMDLETS = new Set([
  'register-scheduledtask',
  'new-scheduledtask',
  'new-scheduledtaskaction',
  'set-scheduledtask',
])

function checkScheduledTask(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    if (SCHEDULED_TASK_CMDLETS.has(lower)) {
      return {
        behavior: 'ask',
        message: `${cmd.name} creates or modifies a scheduled task (persistence primitive)`,
      }
    }
    if (lower === 'schtasks' || lower === 'schtasks.exe') {
      if (
        cmd.args.some(a => {
          const la = a.toLowerCase()
          return (
            la === '/create' ||
            la === '/change' ||
            la === '-create' ||
            la === '-change'
          )
        })
      ) {
        return {
          behavior: 'ask',
          message:
            'schtasks with create/change modifies scheduled tasks (persistence primitive)',
        }
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 计划任务持久化：Register-ScheduledTask 及 legacy schtasks.exe /create——活得比会话长的持久化，以前无任何提示。

/**
 * AST-only check: Detects environment variable manipulation via Set-Item/New-Item on env: scope.
 */
const ENV_WRITE_CMDLETS = new Set([
  'set-item',
  'si',
  'new-item',
  'ni',
  'remove-item',
  'ri',
  'del',
  'rm',
  'rd',
  'rmdir',
  'erase',
  'clear-item',
  'cli',
  'set-content',
  // 'sc' omitted — collides with sc.exe on PS Core 7+, see COMMON_ALIASES note
  'add-content',
  'ac',
])

function checkEnvVarManipulation(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  const envVars = getVariablesByScope(parsed, 'env')
  if (envVars.length === 0) {
    return { behavior: 'passthrough' }
  }
  // Check if any command is a write cmdlet
  for (const cmd of getAllCommands(parsed)) {
    if (ENV_WRITE_CMDLETS.has(cmd.name.toLowerCase())) {
      return {
        behavior: 'ask',
        message: 'Command modifies environment variables',
      }
    }
  }
  // Also flag if there are assignments involving env vars
  if (deriveSecurityFlags(parsed).hasAssignments && envVars.length > 0) {
    return {
      behavior: 'ask',
      message: 'Command modifies environment variables',
    }
  }
  return { behavior: 'passthrough' }
}
// 环境变量操纵：Set-Item/New-Item 写 env: 作用域，或任何涉及 env 变量的赋值。'sc' 故意缺席——PS Core 7+ 上与 sc.exe 撞名。

/**
 * Module-loading cmdlets execute a .psm1's top-level script body (Import-Module)
 * or download from arbitrary repositories (Install-Module, Save-Module). A
 * wildcard allow rule like `Import-Module:*` would let an attacker-supplied
 * .psm1 execute with the user's privileges — same risk as Invoke-Expression.
 *
 * NEVER_SUGGEST (dangerousCmdlets.ts) derives from this list so the UI
 * never offers these as wildcard suggestions, but users can still manually
 * write allow rules. This check ensures the permission engine independently
 * gates these cmdlets.
 */

function checkModuleLoading(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    if (MODULE_LOADING_CMDLETS.has(lower)) {
      return {
        behavior: 'ask',
        message:
          'Command loads, installs, or downloads a PowerShell module or script, which can execute arbitrary code',
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 模块加载：Import-Module 执行 .psm1 顶层脚本体，Install-Module/Save-Module 从任意仓库下载。通配允许规则 Import-Module:* 会让攻击者给的 .ps1 以用户权限执行——与 IEX 同级。NEVER_SUGGEST 从这份名单派生（UI 永不把它们作为通配建议），但用户手写允许规则时由这里独立把门。

/**
 * Set-Alias/New-Alias can hijack future command resolution: after
 * `Set-Alias Get-Content Invoke-Expression`, any later `Get-Content $x`
 * executes arbitrary code. Set-Variable/New-Variable can poison
 * `$PSDefaultParameterValues` (e.g., `Set-Variable PSDefaultParameterValues
 * @{'*:Path'='/etc/passwd'}`) which alters every subsequent cmdlet's behavior.
 * Neither effect can be validated statically — we'd need to track all future
 * command resolutions in the session. Always ask.
 */
const RUNTIME_STATE_CMDLETS = new Set([
  'set-alias',
  'sal',
  'new-alias',
  'nal',
  'set-variable',
  'sv',
  'new-variable',
  'nv',
])

function checkRuntimeStateManipulation(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    // Strip module qualifier: `Microsoft.PowerShell.Utility\Set-Alias` → `set-alias`
    const raw = cmd.name.toLowerCase()
    const lower = raw.includes('\\')
      ? raw.slice(raw.lastIndexOf('\\') + 1)
      : raw
    if (RUNTIME_STATE_CMDLETS.has(lower)) {
      return {
        behavior: 'ask',
        message:
          'Command creates or modifies an alias or variable that can affect future command resolution',
      }
    }
  }
  return { behavior: 'passthrough' }
}
// 运行期状态操纵：Set-Alias Get-Content Invoke-Expression 之后任何 Get-Content $x 都执行任意代码；Set-Variable PSDefaultParameterValues 改 pathspec 默认值，改变之后每个 cmdlet 的行为。静态验证不了「未来所有命令解析」，恒 ask。

/**
 * Invoke-WmiMethod / Invoke-CimMethod are Start-Process equivalents via WMI.
 * `Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList "cmd /c ..."`
 * spawns an arbitrary process, bypassing checkStartProcess entirely. No narrow
 * safe usage exists — -Class and -MethodName accept arbitrary strings, so
 * gating on Win32_Process specifically would miss -Class $x or other process-
 * spawning WMI classes. Returns ask on any invocation. (security finding #34)
 */
const WMI_SPAWN_CMDLETS = new Set([
  'invoke-wmimethod',
  'iwmi',
  'invoke-cimmethod',
])

function checkWmiProcessSpawn(
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  for (const cmd of getAllCommands(parsed)) {
    const lower = cmd.name.toLowerCase()
    if (WMI_SPAWN_CMDLETS.has(lower)) {
      return {
        behavior: 'ask',
        message: `${cmd.name} can spawn arbitrary processes via WMI/CIM (Win32_Process Create)`,
      }
    }
  }
  return { behavior: 'passthrough' }
}
// WMI 进程派生：Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList "cmd /c ..." 完全绕过 checkStartProcess。-Class/-MethodName 接受任意字符串，盯着 Win32_Process 会漏 -Class $x，一律 ask（security finding #34）。

/**
 * Main entry point for PowerShell security validation.
 * Checks a PowerShell command against known dangerous patterns.
 *
 * All checks are AST-based. If the AST parse failed (parsed.valid === false),
 * none of the individual checks will match and we return 'ask' as a safe default.
 *
 * @param command - The PowerShell command to validate (unused, kept for API compat)
 * @param parsed - Parsed AST from PowerShell's native parser (required)
 * @returns Security result indicating whether the command is safe
 */
export function powershellCommandIsSafe(
  _command: string,
  parsed: ParsedPowerShellCommand,
): PowerShellSecurityResult {
  // If the AST parse failed, we cannot determine safety -- ask the user
  if (!parsed.valid) {
    return {
      behavior: 'ask',
      message: 'Could not parse command for security analysis',
    }
  }

  const validators = [
    checkInvokeExpression,
    checkDynamicCommandName,
    checkEncodedCommand,
    checkPwshCommandOrFile,
    checkDownloadCradles,
    checkDownloadUtilities,
    checkAddType,
    checkComObject,
    checkDangerousFilePathExecution,
    checkInvokeItem,
    checkScheduledTask,
    checkForEachMemberName,
    checkStartProcess,
    checkScriptBlockInjection,
    checkSubExpressions,
    checkExpandableStrings,
    checkSplatting,
    checkStopParsing,
    checkMemberInvocations,
    checkTypeLiterals,
    checkEnvVarManipulation,
    checkModuleLoading,
    checkRuntimeStateManipulation,
    checkWmiProcessSpawn,
  ]
// 检查器链表——顺序即优先级，第一个 ask 胜出。

  for (const validator of validators) {
    const result = validator(parsed)
    if (result.behavior === 'ask') {
      return result
    }
  }

  // All checks passed
  return { behavior: 'passthrough' }
}
// 主入口：解析失败直接 ask（安全默认），否则依序跑全部检查。
