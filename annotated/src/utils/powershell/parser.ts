import { execa } from 'execa'
import { logForDebugging } from '../debug.js'
import { memoizeWithLRU } from '../memoize.js'
import { getCachedPowerShellPath } from '../shell/powershellDetection.js'
import { jsonParse } from '../slowOperations.js'

// ---------------------------------------------------------------------------
// Public types describing the parsed output returned to callers.
// These map to System.Management.Automation.Language AST classes.
// Raw internal types (RawParsedOutput etc.) are defined further below.
// ---------------------------------------------------------------------------
// 这个文件不自己写 PowerShell 词法/语法分析器，而是**调真 PowerShell**（pwsh）用它的 AST 解析器解析，再把 AST 摘成 JSON 回传。原因很实在：PowerShell 的语法极其庞杂（参数缩写、四种破折号、可展开字符串、splatting、参数块、using 语句……），任何自研解析器都会与真解析器产生解析差，而解析差在权限判定里就等于漏洞。用真解析器，语义天然一致。

/**
 * The PowerShell AST element type for pipeline elements.
 * Maps directly to CommandBaseAst derivatives in System.Management.Automation.Language.
 */
type PipelineElementType =
  | 'CommandAst'
  | 'CommandExpressionAst'
  | 'ParenExpressionAst'

/**
 * The AST node type for individual command elements (arguments, expressions).
 * Used to classify each element during the AST walk so TypeScript can derive
 * security flags without extra Find-AstNodes calls in PowerShell.
 */
type CommandElementType =
  | 'ScriptBlock'
  | 'SubExpression'
  | 'ExpandableString'
  | 'MemberInvocation'
  | 'Variable'
  | 'StringConstant'
  | 'Parameter'
  | 'Other'

/**
 * A child node of a command element (one level deep). Populated for
 * CommandParameterAst → .Argument (colon-bound parameters like
 * `-InputObject:$env:SECRET`). Consumers check `child.type` to classify
 * the bound value (Variable, StringConstant, Other) without parsing text.
 */
export type CommandElementChild = {
  type: CommandElementType
  text: string
}
// `CommandElementChild` 表示「一个参数的子节点」，深度只有一层。它专门服务冒号绑定参数，例如 `-InputObject:$env:SECRET`：整串文本是参数，但绑定的值是一个变量引用。有了 `type` 字段，消费方可以直接判「这个参数的绑定值不是字符串常量」而不必去文本里找冒号和美元符——文本匹配在转义与引号上极容易错。

/**
 * The PowerShell AST statement type.
 * Maps directly to StatementAst derivatives in System.Management.Automation.Language.
 */
type StatementType =
  | 'PipelineAst'
  | 'PipelineChainAst'
  | 'AssignmentStatementAst'
  | 'IfStatementAst'
  | 'ForStatementAst'
  | 'ForEachStatementAst'
  | 'WhileStatementAst'
  | 'DoWhileStatementAst'
  | 'DoUntilStatementAst'
  | 'SwitchStatementAst'
  | 'TryStatementAst'
  | 'TrapStatementAst'
  | 'FunctionDefinitionAst'
  | 'DataStatementAst'
  | 'UnknownStatementAst'
// `StatementType` 列了 15 种语句类型，覆盖管道、管道链（&& / ||）、赋值、if/for/foreach/while/do、switch、try、trap、函数定义、data 段，以及兜底的未知类型。每一类都必须能被识别，因为「未知类型」在权限判定里默认按最保守处理——漏一种就等于漏一条执行路径。

/**
 * A command invocation within a pipeline segment.
 */
export type ParsedCommandElement = {
  /** The command/cmdlet name (e.g., "Get-ChildItem", "git") */
  name: string
  /** The command name type: cmdlet, application (exe), or unknown */
  nameType: 'cmdlet' | 'application' | 'unknown'
  /** The AST element type from PowerShell's parser */
  elementType: PipelineElementType
  /** All arguments as strings (includes flags like "-Recurse") */
  args: string[]
  /** The full text of this command element */
  text: string
  /** AST node types for each element in this command (arguments, expressions, etc.) */
  elementTypes?: CommandElementType[]
  /**
   * Child nodes of each argument, aligned with `args[]` (so
   * `children[i]` ↔ `args[i]` ↔ `elementTypes[i+1]`). Only populated for
   * Parameter elements with a colon-bound argument. Undefined for elements
   * with no children. Lets consumers check `children[i].some(c => c.type
   * !== 'StringConstant')` instead of parsing the arg text for `:` + `$`.
   */
  children?: (CommandElementChild[] | undefined)[]
  /** Redirections on this command element (from nested commands in && / || chains) */
  redirections?: ParsedRedirection[]
}
// `ParsedCommandElement` 收尾。三个数组的索引关系必须记住：`children[i]` 对应 `args[i]`，而 `elementTypes[i+1]` 对应 `args[i]`（因为第 0 个元素是命令名本身）。这个偏移是硬约定，消费方若按 `elementTypes[i]` 去查第 i 个参数的 AST 类型，会整体错一位，把变量当成命令名。

/**
 * A redirection found in the command.
 */
type ParsedRedirection = {
  /** The redirection operator */
  operator: '>' | '>>' | '2>' | '2>>' | '*>' | '*>>' | '2>&1'
  /** The target (file path or stream number) */
  target: string
  /** Whether this is a merging redirection like 2>&1 */
  isMerging: boolean
}
// 重定向只有七种操作符，`isMerging` 区分「写文件」与「合并流」：`2>&1` 只是把错误流并入输出流，不碰文件系统；而 `>`、`>>`、`2>`、`*>` 及其追加重定向都是真实写盘。后续所有权限判定都以 `isMerging` 为界。

/**
 * A parsed statement from PowerShell.
 * Can be a pipeline, assignment, control flow statement, etc.
 */
type ParsedStatement = {
  /** The AST statement type from PowerShell's parser */
  statementType: StatementType
  /** Individual commands in this statement (for pipelines) */
  commands: ParsedCommandElement[]
  /** Redirections on this statement */
  redirections: ParsedRedirection[]
  /** Full text of the statement */
  text: string
  /**
   * For control flow statements (if, for, foreach, while, try, etc.),
   * commands found recursively inside the body blocks.
   * Uses FindAll() to extract ALL nested CommandAst nodes at any depth.
   */
  nestedCommands?: ParsedCommandElement[]
  /**
   * Security-relevant AST patterns found via FindAll() on the entire statement,
   * regardless of statement type. This catches patterns that elementTypes may
   * miss (e.g. member invocations inside assignments, subexpressions in
   * non-pipeline statements). Computed in the PS1 script using instanceof
   * checks against the PowerShell AST type system.
   */
  securityPatterns?: {
    hasMemberInvocations?: boolean
    hasSubExpressions?: boolean
    hasExpandableStrings?: boolean
    hasScriptBlocks?: boolean
  }
}
// `ParsedStatement` 里有两套互补的危险信号：`nestedCommands` 是从语句体内递归找出的所有命令（覆盖 if/for/try 等块内执行），`securityPatterns` 是对整条语句做 FindAll 得到的布尔标记（覆盖「赋值语句里的成员调用」「非管道语句里的子表达式」这类不走命令路径的形态）。前者管「还能跑什么命令」，后者管「有没有隐蔽的求值形态」，缺一不可。

/**
 * A variable reference found in the command.
 */
type ParsedVariable = {
  /** The variable path (e.g., "HOME", "env:PATH", "global:x") */
  path: string
  /** Whether this variable uses splatting (@var instead of $var) */
  isSplatted: boolean
}

/**
 * A parse error from PowerShell's parser.
 */
type ParseError = {
  message: string
  errorId: string
}
// 解析错误保留 `errorId`，因为判定逻辑要靠它区分「语法错误」与「进程级失败」：前者是确定性的（同一条命令永远同样失败，可缓存），后者是瞬时的（超时、进程起不来，必须允许重试）。

/**
 * The complete parsed result from the PowerShell AST parser.
 */
export type ParsedPowerShellCommand = {
  /** Whether the command parsed successfully (no syntax errors) */
  valid: boolean
  /** Parse errors, if any */
  errors: ParseError[]
  /** Top-level statements, separated by ; or newlines */
  statements: ParsedStatement[]
  /** All variable references found */
  variables: ParsedVariable[]
  /** Whether the token stream contains a stop-parsing (--%) token */
  hasStopParsing: boolean
  /** The original command text */
  originalCommand: string
  /**
   * All .NET type literals found anywhere in the AST (TypeExpressionAst +
   * TypeConstraintAst). TypeName.FullName — the literal text as written, NOT
   * the resolved .NET type (e.g. [int] → "int", not "System.Int32").
   * Consumed by the CLM-allowlist check in powershellSecurity.ts.
   */
  typeLiterals?: string[]
  /**
   * Whether the command contains `using module` or `using assembly` statements.
   * These load external code (modules/assemblies) and execute their top-level
   * script body or module initializers. The using statement is a sibling of
   * the named blocks on ScriptBlockAst, not a child, so it is not visible
   * to Process-BlockStatements or any downstream command walker.
   */
  hasUsingStatements?: boolean
  /**
   * Whether the command contains `#Requires` directives (ScriptRequirements).
   * `#Requires -Modules <name>` triggers module loading from PSModulePath.
   */
  hasScriptRequirements?: boolean
}
// `ParsedPowerShellCommand` 是最终产物。除了语句与变量，还带三个「不走常规命令遍历」的危险标记：`typeLiterals`（所有 .NET 类型字面量，供受限语言模式白名单比对——`[Reflection.Assembly]` 这类要能看见）、`hasUsingStatements`（`using module` / `using assembly` 会加载并执行外部代码）、`hasScriptRequirements`（`#Requires -Modules` 会从模块搜索路径加载）。这三个都写在语句之外，只靠命令遍历永远发现不了。

// ---------------------------------------------------------------------------

// Default 5s is fine for interactive use (warm pwsh spawn is ~450ms). Windows
// CI under Defender/AMSI load can exceed 5s on consecutive spawns even after
// CAN_SPAWN_PARSE_SCRIPT() warms the JIT (run 23574701241 windows-shard-5:
// attackVectors F1 hit 2×5s timeout → valid:false → 'ask' instead of 'deny').
// Override via env for tests. Read inside parsePowerShellCommandImpl, not
// top-level, per CLAUDE.md (globalSettings.env ordering).
const DEFAULT_PARSE_TIMEOUT_MS = 5_000
function getParseTimeoutMs(): number {
  const env = process.env.CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS
  if (env) {
    const parsed = parseInt(env, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_PARSE_TIMEOUT_MS
}
// 超时默认 5 秒，可用环境变量覆盖，但**必须**在函数里读而不是模块顶层读：顶层读会绕过设置系统的加载顺序（环境变量由配置注入，而配置模块可能还没初始化），拿到的是未注入的值。
// MAX_COMMAND_LENGTH is derived from PARSE_SCRIPT_BODY.length below (after the
// script body is defined) so it cannot go stale as the script grows.

/**
 * The PowerShell parse script inlined as a string constant.
 * This avoids needing to read from disk at runtime (the file may not exist
 * in bundled builds). The script uses the native PowerShell AST parser to
 * analyze a command and output structured JSON.
 */
// Raw types describing PS script JSON output (exported for testing)
export type RawCommandElement = {
  type: string // .GetType().Name e.g. "StringConstantExpressionAst"
  text: string // .Extent.Text
  value?: string // .Value if available (resolves backtick escapes)
  expressionType?: string // .Expression.GetType().Name for CommandExpressionAst
  children?: { type: string; text: string }[] // CommandParameterAst.Argument, one level
}

export type RawRedirection = {
  type: string // "FileRedirectionAst" or "MergingRedirectionAst"
  append?: boolean // .Append (FileRedirectionAst only)
  fromStream?: string // .FromStream.ToString() e.g. "Output", "Error", "All"
  locationText?: string // .Location.Extent.Text (FileRedirectionAst only)
}

export type RawPipelineElement = {
  type: string // .GetType().Name e.g. "CommandAst", "CommandExpressionAst"
  text: string // .Extent.Text
  commandElements?: RawCommandElement[]
  redirections?: RawRedirection[]
  expressionType?: string // for CommandExpressionAst: .Expression.GetType().Name
}

export type RawStatement = {
  type: string // .GetType().Name e.g. "PipelineAst", "IfStatementAst", "TrapStatementAst"
  text: string // .Extent.Text
  elements?: RawPipelineElement[] // for PipelineAst: the pipeline elements
  nestedCommands?: RawPipelineElement[] // commands found via FindAll (all statement types)
  redirections?: RawRedirection[] // FileRedirectionAst found via FindAll (non-PipelineAst only)
  securityPatterns?: {
    // Security-relevant AST node types found via FindAll on the statement
    hasMemberInvocations?: boolean
    hasSubExpressions?: boolean
    hasExpandableStrings?: boolean
    hasScriptBlocks?: boolean
  }
}
// Raw 系列类型是 PS1 脚本输出的 JSON 形状，字段名与 .NET AST 的属性一一对应（`GetType().Name`、`Extent.Text`、`Value`、`FromStream`）。它们被导出仅供测试，属于内部契约——PS1 脚本与 TS 侧的字段名必须严格同步，改名会静默丢数据。

type RawParsedOutput = {
  valid: boolean
  errors: { message: string; errorId: string }[]
  statements: RawStatement[]
  variables: { path: string; isSplatted: boolean }[]
  hasStopParsing: boolean
  originalCommand: string
  typeLiterals?: string[]
  hasUsingStatements?: boolean
  hasScriptRequirements?: boolean
}
// `RawParsedOutput` 是脚本顶层结构。注意 `valid` 与 `errors` 来自 PowerShell 自己的语法诊断，而不是我们判断的——这意味着「语法合法但危险」的命令会带着 `valid: true` 进来，危险判定完全交给下游的 AST 遍历。

// This is the canonical copy of the parse script. There is no separate .ps1 file.
/**
 * The core parse logic.
 * The command is passed via Base64-encoded $EncodedCommand variable
 * to avoid here-string injection attacks.
 *
 * SECURITY — top-level ParamBlock: ScriptBlockAst.ParamBlock is a SIBLING of
 * the named blocks (Begin/Process/End/Clean/DynamicParam), not nested inside
 * them, so Process-BlockStatements never reaches it. Commands inside param()
 * default-value expressions and attribute arguments (e.g. [ValidateScript({...})])
 * were invisible to every downstream check. PoC:
 *   param($x = (Remove-Item /)); Get-Process   → only Get-Process surfaced
 *   param([ValidateScript({rm /;$true})]$x='t') → rm invisible, runs on bind
 * Function-level param() IS covered: FindAll on the FunctionDefinitionAst
 * statement recurses into its descendants. The gap was only the script-level
 * ParamBlock. ParamBlockAst has .Parameters (not .Statements) so we FindAll
 * on it directly rather than reusing Process-BlockStatements. We only emit a
 * statement if there is something to report, to avoid noise for plain
 * param($x) declarations. (Kept compact in-script to preserve argv budget.)
 */
// 这段注释记录的是整个脚本里最贵的一条教训（也是本文件唯一一个「不看注释就会写错」的地方）：`ScriptBlockAst.ParamBlock` 是命名块的**兄弟节点**，不在 Begin/Process/End 里，所以「遍历命名块」的做法完全看不到它。于是 `param($x = (Remove-Item /))` 里的删除命令对下游完全隐形，而 PowerShell 在参数绑定时就会求值默认值；`[ValidateScript({...})]` 属性里的脚本块同理。修法是放弃复用 Process-BlockStatements，直接对 ParamBlock 做 FindAll——它有 `.Parameters` 而没有 `.Statements`，接口本来就不一样。
/**
 * PS1 parse script. Comments live here (not inline) — every char inside the
 * backticks eats into WINDOWS_MAX_COMMAND_LENGTH (argv budget).
 *
 * Structure:
 * - Get-RawCommandElements: extract CommandAst element data (type, text, value,
 *   expressionType, children for colon-bound param .Argument)
 * - Get-RawRedirections: extract FileRedirectionAst operator+target
 * - Get-SecurityPatterns: FindAll for security flags (hasSubExpressions via
 *   Sub/Array/ParenExpressionAst, hasScriptBlocks, etc.)
 * - Type literals: emit TypeExpressionAst names for CLM allowlist check
 * - --% token: PS7 MinusMinus, PS5.1 Generic kind
 * - CommandExpressionAst.Redirections: inherits from CommandBaseAst —
 *   `1 > /tmp/x` statement has FileRedirectionAst that element-iteration misses
 * - Nested commands: FindAll for ALL statement types (if/for/foreach/while/
 *   switch/try/function/assignment/PipelineChainAst) — skip direct pipeline
 *   elements already in the loop
 */
// PS1 脚本的结构说明被放在 TS 侧而不是脚本里，理由很实在：脚本内每一个字符都要进命令行参数，而 Windows 的 CreateProcess 有 32,767 字符上限。脚本里的注释必须尽量短，长解释一律写在这里——「注释也是预算」的少见案例。
// exported for testing
// `PARSE_SCRIPT_BODY` 是脚本的唯一副本（没有独立的 .ps1 文件）：打包后的产物里磁盘上可能没有那个文件，从磁盘读会失败，所以内联成字符串常量。它同时是长度预算的基准——下面的命令长度上限由它的长度反推，避免脚本变长后上限悄悄失效。整段脚本可以分三组看：
//
// 一、**三件取值工具**。`Get-RawCommandElements` 摘元素（类型名、原文、解析后的值、表达式内部类型），对 `.Value` 有三重判断（属性在、非空、是字符串）——数值常量的 `.Value` 是整数，取出来会让下游字符串处理崩。`Get-RawRedirections` 只对 FileRedirectionAst 取追加标记/来源流/目标路径，合并重定向只留类型名。`Get-SecurityPatterns` 用**一次** FindAll 同时捞六种危险节点并归类成四个布尔位，比反复 FindAll 快，也不会漏类型。
//
// 二、**三个全局收集**。变量用 FindAll 收集并记 `Splatted` 标记（`@args` 把「实际传什么参数」推迟到运行时，权限判定必须知道）。类型字面量取 `TypeName.FullName`，得到的是**书写原文**（写 `[int]` 就是 `int`），因为受限语言模式白名单要按用户写什么来判，按解析后的 .NET 全名判会漏掉别名写法。
//
// 三、**停止解析符**。`--%` 要兼容两种 token：PS7 有专门的 MinusMinus 种类，PS5.1 只给 Generic，还要把三种 Unicode 破折号归一成 ASCII 减号再比。这个符号一出现，其后所有内容不再按 PowerShell 语法解析，而是原样交给原生程序——等于退出 AST 的可见范围。
export const PARSE_SCRIPT_BODY = `
if (-not $EncodedCommand) {
    Write-Output '{"valid":false,"errors":[{"message":"No command provided","errorId":"NoInput"}],"statements":[],"variables":[],"hasStopParsing":false,"originalCommand":""}'
    exit 0
}

$Command = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($EncodedCommand))

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput(
    $Command,
    [ref]$tokens,
    [ref]$parseErrors
)

$allVariables = [System.Collections.ArrayList]::new()

function Get-RawCommandElements {
    param([System.Management.Automation.Language.CommandAst]$CmdAst)
    $elems = [System.Collections.ArrayList]::new()
    foreach ($ce in $CmdAst.CommandElements) {
        $ceData = @{ type = $ce.GetType().Name; text = $ce.Extent.Text }
        if ($ce.PSObject.Properties['Value'] -and $null -ne $ce.Value -and $ce.Value -is [string]) {
            $ceData.value = $ce.Value
        }
        if ($ce -is [System.Management.Automation.Language.CommandExpressionAst]) {
            $ceData.expressionType = $ce.Expression.GetType().Name
        }
        $a=$ce.Argument;if($a){$ceData.children=@(@{type=$a.GetType().Name;text=$a.Extent.Text})}
        [void]$elems.Add($ceData)
    }
    return $elems
}

function Get-RawRedirections {
    param($Redirections)
    $result = [System.Collections.ArrayList]::new()
    foreach ($redir in $Redirections) {
        $redirData = @{ type = $redir.GetType().Name }
        if ($redir -is [System.Management.Automation.Language.FileRedirectionAst]) {
            $redirData.append = [bool]$redir.Append
            $redirData.fromStream = $redir.FromStream.ToString()
            $redirData.locationText = $redir.Location.Extent.Text
        }
        [void]$result.Add($redirData)
    }
    return $result
}

function Get-SecurityPatterns($A) {
    $p = @{}
    foreach ($n in $A.FindAll({ param($x)
        $x -is [System.Management.Automation.Language.MemberExpressionAst] -or
        $x -is [System.Management.Automation.Language.SubExpressionAst] -or
        $x -is [System.Management.Automation.Language.ArrayExpressionAst] -or
        $x -is [System.Management.Automation.Language.ExpandableStringExpressionAst] -or
        $x -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
        $x -is [System.Management.Automation.Language.ParenExpressionAst]
    }, $true)) { switch ($n.GetType().Name) {
        'InvokeMemberExpressionAst' { $p.hasMemberInvocations = $true }
        'MemberExpressionAst' { $p.hasMemberInvocations = $true }
        'SubExpressionAst' { $p.hasSubExpressions = $true }
        'ArrayExpressionAst' { $p.hasSubExpressions = $true }
        'ParenExpressionAst' { $p.hasSubExpressions = $true }
        'ExpandableStringExpressionAst' { $p.hasExpandableStrings = $true }
        'ScriptBlockExpressionAst' { $p.hasScriptBlocks = $true }
    }}
    if ($p.Count -gt 0) { return $p }
    return $null
}

$varExprs = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst] }, $true)
foreach ($v in $varExprs) {
    [void]$allVariables.Add(@{
        path = $v.VariablePath.ToString()
        isSplatted = [bool]$v.Splatted
    })
}

$typeLiterals = [System.Collections.ArrayList]::new()
foreach ($t in $ast.FindAll({ param($n)
    $n -is [System.Management.Automation.Language.TypeExpressionAst] -or
    $n -is [System.Management.Automation.Language.TypeConstraintAst]
}, $true)) { [void]$typeLiterals.Add($t.TypeName.FullName) }

$hasStopParsing = $false
$tk = [System.Management.Automation.Language.TokenKind]
foreach ($tok in $tokens) {
    if ($tok.Kind -eq $tk::MinusMinus) { $hasStopParsing = $true; break }
    if ($tok.Kind -eq $tk::Generic -and ($tok.Text -replace '[\u2013\u2014\u2015]','-') -eq '--%') {
        $hasStopParsing = $true; break
    }
}

$statements = [System.Collections.ArrayList]::new()

function Process-BlockStatements {
    param($Block)
    if (-not $Block) { return }

    foreach ($stmt in $Block.Statements) {
        $statement = @{
            type = $stmt.GetType().Name
            text = $stmt.Extent.Text
        }

        if ($stmt -is [System.Management.Automation.Language.PipelineAst]) {
            $elements = [System.Collections.ArrayList]::new()
            foreach ($element in $stmt.PipelineElements) {
                $elemData = @{
                    type = $element.GetType().Name
                    text = $element.Extent.Text
                }

                if ($element -is [System.Management.Automation.Language.CommandAst]) {
                    $elemData.commandElements = @(Get-RawCommandElements -CmdAst $element)
                    $elemData.redirections = @(Get-RawRedirections -Redirections $element.Redirections)
                } elseif ($element -is [System.Management.Automation.Language.CommandExpressionAst]) {
                    $elemData.expressionType = $element.Expression.GetType().Name
                    $elemData.redirections = @(Get-RawRedirections -Redirections $element.Redirections)
                }

                [void]$elements.Add($elemData)
            }
            $statement.elements = @($elements)

            $allNestedCmds = $stmt.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nestedCmds = [System.Collections.ArrayList]::new()
            foreach ($cmd in $allNestedCmds) {
                if ($cmd.Parent -eq $stmt) { continue }
                $nested = @{
                    type = $cmd.GetType().Name
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                }
                [void]$nestedCmds.Add($nested)
            }
            if ($nestedCmds.Count -gt 0) {
                $statement.nestedCommands = @($nestedCmds)
            }
            $r = $stmt.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) {
                $rr = @(Get-RawRedirections -Redirections $r)
                $statement.redirections = if ($statement.redirections) { @($statement.redirections) + $rr } else { $rr }
            }
        } else {
            $nestedCmdAsts = $stmt.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nested = [System.Collections.ArrayList]::new()
            foreach ($cmd in $nestedCmdAsts) {
                [void]$nested.Add(@{
                    type = 'CommandAst'
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                })
            }
            if ($nested.Count -gt 0) {
                $statement.nestedCommands = @($nested)
            }
            $r = $stmt.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) { $statement.redirections = @(Get-RawRedirections -Redirections $r) }
        }

        $sp = Get-SecurityPatterns $stmt
        if ($sp) { $statement.securityPatterns = $sp }

        [void]$statements.Add($statement)
    }

    if ($Block.Traps) {
        foreach ($trap in $Block.Traps) {
            $statement = @{
                type = 'TrapStatementAst'
                text = $trap.Extent.Text
            }
            $nestedCmdAsts = $trap.FindAll(
                { param($node) $node -is [System.Management.Automation.Language.CommandAst] },
                $true
            )
            $nestedCmds = [System.Collections.ArrayList]::new()
            foreach ($cmd in $nestedCmdAsts) {
                $nested = @{
                    type = $cmd.GetType().Name
                    text = $cmd.Extent.Text
                    commandElements = @(Get-RawCommandElements -CmdAst $cmd)
                    redirections = @(Get-RawRedirections -Redirections $cmd.Redirections)
                }
                [void]$nestedCmds.Add($nested)
            }
            if ($nestedCmds.Count -gt 0) {
                $statement.nestedCommands = @($nestedCmds)
            }
            $r = $trap.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
            if ($r.Count -gt 0) { $statement.redirections = @(Get-RawRedirections -Redirections $r) }
            $sp = Get-SecurityPatterns $trap
            if ($sp) { $statement.securityPatterns = $sp }
            [void]$statements.Add($statement)
        }
    }
}

Process-BlockStatements -Block $ast.BeginBlock
Process-BlockStatements -Block $ast.ProcessBlock
Process-BlockStatements -Block $ast.EndBlock
Process-BlockStatements -Block $ast.CleanBlock
Process-BlockStatements -Block $ast.DynamicParamBlock

if ($ast.ParamBlock) {
  $pb = $ast.ParamBlock
  $pn = [System.Collections.ArrayList]::new()
  foreach ($c in $pb.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]}, $true)) {
    [void]$pn.Add(@{type='CommandAst';text=$c.Extent.Text;commandElements=@(Get-RawCommandElements -CmdAst $c);redirections=@(Get-RawRedirections -Redirections $c.Redirections)})
  }
  $pr = $pb.FindAll({param($n) $n -is [System.Management.Automation.Language.FileRedirectionAst]}, $true)
  $ps = Get-SecurityPatterns $pb
  if ($pn.Count -gt 0 -or $pr.Count -gt 0 -or $ps) {
    $st = @{type='ParamBlockAst';text=$pb.Extent.Text}
    if ($pn.Count -gt 0) { $st.nestedCommands = @($pn) }
    if ($pr.Count -gt 0) { $st.redirections = @(Get-RawRedirections -Redirections $pr) }
    if ($ps) { $st.securityPatterns = $ps }
    [void]$statements.Add($st)
  }
}

$hasUsingStatements = $ast.UsingStatements -and $ast.UsingStatements.Count -gt 0
$hasScriptRequirements = $ast.ScriptRequirements -ne $null

$output = @{
    valid = ($parseErrors.Count -eq 0)
    errors = @($parseErrors | ForEach-Object {
        @{
            message = $_.Message
            errorId = $_.ErrorId
        }
    })
    statements = @($statements)
    variables = @($allVariables)
    hasStopParsing = $hasStopParsing
    originalCommand = $Command
    typeLiterals = @($typeLiterals)
    hasUsingStatements = [bool]$hasUsingStatements
    hasScriptRequirements = [bool]$hasScriptRequirements
}

$output | ConvertTo-Json -Depth 10 -Compress
`
// 脚本收尾。后半段是遍历逻辑，四处非显然的处理：
//
// ① **五个命名块**依次处理（Begin/Process/End/Clean/DynamicParam），外加单独的 `Traps`——trap 块里的命令不在 `$Block.Statements` 里，只能从 `$Block.Traps` 捞，同样要带嵌套命令、重定向、危险模式三件套。
//
// ② **管道分支**的嵌套命令要先跳过 `Parent === 语句本身` 的那些：FindAll 会把管道自身的元素也找出来，不排除则同一条命令算两遍，下游「单命令才自动批准」的判断就失准。之后还要再做一次 FileRedirectionAst 深挖，因为元素级收集看不到藏在参数内部的重定向（冒号绑定参数里的、哈希表值里的）——它们的父节点是参数或表达式，不是独立管道元素。
//
// ③ **非管道分支**直接找 FileRedirectionAst，而不是「找命令再取重定向」。在 `if ($x) { 1 > /tmp/evil }` 里，字面量 1 加它的重定向是表达式节点，与 CommandAst 是**兄弟**而非子类，靠命令路径永远找不到。直接找重定向节点既简单又更能抗未来新增的节点类型。
//
// ④ **脚本末尾**：ParamBlock 单独遍历（见上面那条兄弟节点的注释），且只在「确实有东西要报」时才产出一条语句——`param($x)` 这种纯声明极常见，无条件产出会给每条正常命令加一条噪声，还会破坏下游的单命令判断。`UsingStatements` 与 `ScriptRequirements` 也只能从顶层取，它们同样不在命名块里，而两者都能在「没有任何命令」的情况下执行代码。最后 `ConvertTo-Json -Depth 10 -Compress`：深度 10 是因为结构有多层嵌套（语句 → 元素 → 子节点），默认深度会截断；压缩是为减小回传体积。

// ---------------------------------------------------------------------------
// Windows CreateProcess has a 32,767 char command-line limit. The encoding
// chain is:
//   command (N UTF-8 bytes) → Base64 (~4N/3 chars) → $EncodedCommand = '...'\n
//   → full script (wrapper + PARSE_SCRIPT_BODY) → UTF-16LE (2× bytes)
//   → Base64 (4/3× chars) → -EncodedCommand argv
// Final cmdline ≈ argv_overhead + (wrapper + 4N/3 + body) × 8/3
//
// Solving for N (UTF-8 bytes) with a 32,767 cap:
//   script_budget   = (32767 - argv_overhead) × 3/8
//   cmd_b64_budget  = script_budget - PARSE_SCRIPT_BODY.length - wrapper
//   N               = cmd_b64_budget × 3/4 - safety_margin
//
// SECURITY: N is a UTF-8 BYTE budget, not a UTF-16 code-unit budget. The
// length gate MUST measure Buffer.byteLength(command, 'utf8'), not
// command.length. A BMP character in U+0800–U+FFFF (CJK ideographs, most
// non-Latin scripts) is 1 UTF-16 code unit but 3 UTF-8 bytes. With
// PARSE_SCRIPT_BODY ≈ 10.6K, N ≈ 1,092 bytes. Comparing against .length
// permits a 1,092-code-unit pure-CJK command (≈3,276 UTF-8 bytes) → inner
// base64 ≈ 4,368 chars → final argv ≈ 40K chars, overflowing 32,767 by
// ~7.4K. CreateProcess fails → valid:false → parse-fail degradation (deny
// rules silently downgrade to ask). Finding #36.
//
// COMPUTED from PARSE_SCRIPT_BODY.length so it cannot drift. The prior
// hardcoded value (4,500) was derived from a ~6K body estimate; the body is
// actually ~11K chars, so the real ceiling was ~1,850. Commands in the
// 1,850–4,500 range passed this gate but then failed CreateProcess on
// Windows, returning valid=false and skipping all AST-based security checks.
//
// Unix argv limits are typically 2MB+ (ARG_MAX) with ~128KB per-argument
// limit (MAX_ARG_STRLEN on Linux; macOS has no per-arg limit below ARG_MAX).
// At MAX=4,500 the -EncodedCommand argument is ~45KB — well under either.
// Applying the Windows-derived limit on Unix would REGRESS: commands in the
// ~1K–4.5K range previously parsed successfully and reached the sub-command
// deny loop at powershellPermissions.ts; rejecting them pre-spawn degrades
// user-configured deny rules from deny→ask for compound commands with a
// denied cmdlet buried mid-script. So the Windows limit is platform-gated.
//
// If the Windows limit becomes too restrictive, switch to -File with a temp
// file for large inputs.
// ---------------------------------------------------------------------------
const WINDOWS_ARGV_CAP = 32_767
// pwsh path + " -NoProfile -NonInteractive -NoLogo -EncodedCommand " +
// argv quoting. A long Windows pwsh path (C:\Program Files\PowerShell\7\
// pwsh.exe) + flags is ~95 chars; 200 leaves headroom for unusual installs.
const FIXED_ARGV_OVERHEAD = 200
// "$EncodedCommand = '" + "'\n" wrapper around the user command's base64
const ENCODED_CMD_WRAPPER = `$EncodedCommand = ''\n`.length
// Margin for base64 padding rounding (≤4 chars at each of 2 levels) and minor
// estimation drift. Multibyte expansion is NOT absorbed here — the gate
// measures actual UTF-8 bytes (Buffer.byteLength), not code units.
const SAFETY_MARGIN = 100
const SCRIPT_CHARS_BUDGET = ((WINDOWS_ARGV_CAP - FIXED_ARGV_OVERHEAD) * 3) / 8
const CMD_B64_BUDGET =
  SCRIPT_CHARS_BUDGET - PARSE_SCRIPT_BODY.length - ENCODED_CMD_WRAPPER
// Exported for drift-guard tests (the drift-prone value is the Windows one).
// Unit: UTF-8 BYTES. Compare against Buffer.byteLength, not .length.
export const WINDOWS_MAX_COMMAND_LENGTH = Math.max(
  0,
  Math.floor((CMD_B64_BUDGET * 3) / 4) - SAFETY_MARGIN,
)
// `WINDOWS_MAX_COMMAND_LENGTH` 是从脚本长度反推出来的，注释里那串推导值得细读：命令行总长 = 固定开销 +（外层包装 + 内层 base64 + 脚本体）× 8/3。系数 8/3 来自两级编码——UTF-8 → base64（4/3），整段脚本再转 UTF-16LE（×2）再 base64（×4/3），合计 8/3。之前这里写死 4,500，是按「脚本约 6K」估的，实际脚本约 11K，真实上限只有约 1,850——于是 1,850 到 4,500 之间的命令通过了门禁却在 CreateProcess 处失败，返回「解析失败」，所有基于 AST 的拒绝规则静默降级成「询问」。
// Pre-existing value, known to work on Unix. See comment above re: why the
// Windows derivation must NOT be applied here. Unit: UTF-8 BYTES — for ASCII
// commands (the common case) bytes==chars so no regression; for multibyte
// commands this is slightly tighter but still far below Unix ARG_MAX (~128KB
// per-arg), so the argv spawn cannot overflow.
const UNIX_MAX_COMMAND_LENGTH = 4_500
// Unit: UTF-8 BYTES (see SECURITY note above).
export const MAX_COMMAND_LENGTH =
  process.platform === 'win32'
    ? WINDOWS_MAX_COMMAND_LENGTH
    : UNIX_MAX_COMMAND_LENGTH
// 平台分岔：Windows 用上面算出的上限，其它平台固定 4,500。注释解释了为什么不把 Windows 的严格上限套到 Unix——Unix 的单个参数上限约 128KB，4,500 字节的命令在那边一直能正常解析并进入子命令拒绝循环；若按 Windows 上限提前拒绝，1K 到 4.5K 区间的复合命令（中间藏着一个被拒绝的 cmdlet）会从「拒绝」降级成「询问」。同一个数字在两个平台上代表完全不同的安全后果。

const INVALID_RESULT_BASE: Omit<
  ParsedPowerShellCommand,
  'errors' | 'originalCommand'
> = {
  valid: false,
  statements: [],
  variables: [],
  hasStopParsing: false,
}
// `INVALID_RESULT_BASE` 是所有失败结果的公共底盘：`valid: false`、空语句、空变量、无停止解析符。失败结果必须结构完整，否则下游遍历语句时会因 undefined 抛错，把「解析失败」变成「进程崩溃」。

function makeInvalidResult(
  command: string,
  message: string,
  errorId: string,
): ParsedPowerShellCommand {
  return {
    ...INVALID_RESULT_BASE,
    errors: [{ message, errorId }],
    originalCommand: command,
  }
}
// `makeInvalidResult` 把「命令原文 + 消息 + 错误 ID」组装成合法结果。错误 ID 是机器可读的契约：上层据此区分「命令太长」「没有 PowerShell」「超时」「输出空」「JSON 坏」，并对瞬时类做重试或缓存逐出。

/**
 * Base64-encode a string as UTF-16LE, which is the encoding required by
 * PowerShell's -EncodedCommand parameter.
 */
function toUtf16LeBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf16le').toString('base64')
  }
  // Fallback for non-Node environments
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes.push(code & 0xff, (code >> 8) & 0xff)
  }
  return btoa(bytes.map(b => String.fromCharCode(b)).join(''))
}
// `toUtf16LeBase64`：PowerShell 的 `-EncodedCommand` 只接受 UTF-16LE 的 base64。Node 环境直接用 `Buffer.from(text, 'utf16le')`；非 Node 环境手写按字符取低字节/高字节，等价于手工做 UTF-16LE 编码。

/**
 * Build the full PowerShell script that parses a command.
 * The user command is Base64-encoded (UTF-8) and embedded in a variable
 * to prevent injection attacks.
 */
function buildParseScript(command: string): string {
  const encoded =
    typeof Buffer !== 'undefined'
      ? Buffer.from(command, 'utf8').toString('base64')
      : btoa(
          new TextEncoder()
            .encode(command)
            .reduce((s, b) => s + String.fromCharCode(b), ''),
        )
  return `$EncodedCommand = '${encoded}'\n${PARSE_SCRIPT_BODY}`
}
// `buildParseScript` 把用户命令**先 base64 再放进变量**，而不是直接拼进脚本文本。这是防注入的核心：PowerShell 没有「安全引用任意字符串」的通用办法（单引号里仍需处理引号本身，here-string 有终结符注入），而 base64 的字符集天然安全，脚本里再解回 UTF-8。用户命令因此永远只是数据，不会变成脚本的一部分。

/**
 * Ensure a value is an array. PowerShell 5.1's ConvertTo-Json may unwrap
 * single-element arrays into plain objects.
 */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}
// `ensureArray` 修的是 PowerShell 5.1 的一个坑：`ConvertTo-Json` 会把单元素数组解包成裸对象。于是「只有一条语句」的命令返回的是对象而非数组，TS 侧 `map` 会直接崩。所有从 JSON 来的数组字段都必须过这个函数。

/** Map raw .NET AST type name to our StatementType union */
// exported for testing
export function mapStatementType(rawType: string): StatementType {
  switch (rawType) {
    case 'PipelineAst':
      return 'PipelineAst'
    case 'PipelineChainAst':
      return 'PipelineChainAst'
    case 'AssignmentStatementAst':
      return 'AssignmentStatementAst'
    case 'IfStatementAst':
      return 'IfStatementAst'
    case 'ForStatementAst':
      return 'ForStatementAst'
    case 'ForEachStatementAst':
      return 'ForEachStatementAst'
    case 'WhileStatementAst':
      return 'WhileStatementAst'
    case 'DoWhileStatementAst':
      return 'DoWhileStatementAst'
    case 'DoUntilStatementAst':
      return 'DoUntilStatementAst'
    case 'SwitchStatementAst':
      return 'SwitchStatementAst'
    case 'TryStatementAst':
      return 'TryStatementAst'
    case 'TrapStatementAst':
      return 'TrapStatementAst'
    case 'FunctionDefinitionAst':
      return 'FunctionDefinitionAst'
    case 'DataStatementAst':
      return 'DataStatementAst'
    default:
      return 'UnknownStatementAst'
  }
}
// `mapStatementType` 是白名单映射，未知类型一律落到 `UnknownStatementAst`。这个兜底方向是对的：下游对未知语句类型走保守路径（不允许自动批准），所以新增语句类型时宁可先归到未知，也不要随手映射到一个「看起来差不多」的安全类型。

/** Map raw .NET AST type name to our CommandElementType union */
// exported for testing
export function mapElementType(
  rawType: string,
  expressionType?: string,
): CommandElementType {
  switch (rawType) {
    case 'ScriptBlockExpressionAst':
      return 'ScriptBlock'
    case 'SubExpressionAst':
    case 'ArrayExpressionAst':
      // SECURITY: ArrayExpressionAst (@()) is a sibling of SubExpressionAst,
      // not a subclass. Both evaluate arbitrary pipelines with side effects:
      // Get-ChildItem @(Remove-Item ./data) runs Remove-Item inside @().
      // Map both to SubExpression so hasSubExpressions fires and isReadOnlyCommand
      // rejects (it doesn't check nestedCommands, only pipeline.commands[]).
      return 'SubExpression'
    case 'ExpandableStringExpressionAst':
      return 'ExpandableString'
    case 'InvokeMemberExpressionAst':
    case 'MemberExpressionAst':
      return 'MemberInvocation'
    case 'VariableExpressionAst':
      return 'Variable'
    case 'StringConstantExpressionAst':
    case 'ConstantExpressionAst':
      // ConstantExpressionAst covers numeric literals (5, 3.14). For
      // permission purposes a numeric literal is as safe as a string
      // literal — it's an inert value, not code. Without this mapping,
      // `-Seconds:5` produced children[0].type='Other' and consumers
      // checking `children.some(c => c.type !== 'StringConstant')` would
      // false-positive ask on harmless numeric args.
      return 'StringConstant'
    case 'CommandParameterAst':
      return 'Parameter'
    case 'ParenExpressionAst':
      return 'SubExpression'
    case 'CommandExpressionAst':
      // Delegate to the wrapped expression type so we catch SubExpressionAst,
      // ExpandableStringExpressionAst, ScriptBlockExpressionAst, etc.
      // without maintaining a manual list. Falls through to 'Other' if the
      // inner type is unrecognised.
      if (expressionType) {
        return mapElementType(expressionType)
      }
      return 'Other'
    default:
      return 'Other'
  }
}
// `mapElementType` 里有三处值得记：① `ArrayExpressionAst`（`@(...)`）必须与 `SubExpressionAst` 同样映射成子表达式——两者在 .NET 类型树里是兄弟而非父子，但都会求值内部管道（`@(Remove-Item ./data)` 真的会删文件）；而下游只检查 `hasSubExpressions`，不查嵌套命令，漏映射等于放行。② 数值常量映射成字符串常量，因为数字字面量是惰性值，不映射会让 `-Seconds:5` 被当成可疑参数误报。③ `CommandExpressionAst` 递归到内部表达式类型，避免维护一份手工清单。

/** Classify command name as cmdlet, application, or unknown */
// exported for testing
export function classifyCommandName(
  name: string,
): 'cmdlet' | 'application' | 'unknown' {
  if (/^[A-Za-z]+-[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return 'cmdlet'
  }
  if (/[.\\/]/.test(name)) {
    return 'application'
  }
  return 'unknown'
}
// `classifyCommandName` 三条规则：形如「动词-名词」的算 cmdlet；含点、斜杠或反斜杠的算应用程序（可执行文件或路径）；其余算未知。注意顺序——先判 cmdlet 形态再判路径，因为 「模块名 + 反斜杠 + Invoke 加连字符 Expression」这种带模块前缀的写法 这种带模块前缀的写法含反斜杠，会先命中「应用程序」，而这正是想要的（它可能指向任意文件）。

/** Strip module prefix from command name (e.g. "Microsoft.PowerShell.Utility\\Invoke-Expression" -> "Invoke-Expression") */
// exported for testing
export function stripModulePrefix(name: string): string {
  const idx = name.lastIndexOf('\\')
  if (idx < 0) return name
  // Don't strip file paths: drive letters (C:\...), UNC paths (\\server\...), or relative paths (.\, ..\)
  if (
    /^[A-Za-z]:/.test(name) ||
    name.startsWith('\\\\') ||
    name.startsWith('.\\') ||
    name.startsWith('..\\')
  )
    return name
  return name.substring(idx + 1)
}
// `stripModulePrefix` 剥模块前缀（「模块名 + 反斜杠 + Invoke 加连字符 Expression」这种带模块前缀的写法 → `Invoke-Expression`），但**不能**剥文件路径：盘符开头、UNC 双反斜杠开头、`.` 或 `..` 开头的相对路径都要原样保留。判据写在函数里而不是靠调用方——这类「看起来像模块前缀其实是路径」的形态是最容易出错的地方。

/** Transform a raw CommandAst pipeline element into ParsedCommandElement */
// exported for testing
export function transformCommandAst(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const cmdElements = ensureArray(raw.commandElements)
  let name = ''
  const args: string[] = []
  const elementTypes: CommandElementType[] = []
  const children: (CommandElementChild[] | undefined)[] = []
  let hasChildren = false

  // SECURITY: nameType MUST be computed from the raw name (before
  // stripModulePrefix). classifyCommandName('scripts\\Get-Process') returns
  // 'application' (contains \\) — the correct answer, since PowerShell resolves
  // this as a file path. After stripping it becomes 'Get-Process' which
  // classifies as 'cmdlet' — wrong, and allowlist checks would trust it.
  // Auto-allow paths gate on nameType !== 'application' to catch this.
  // name (stripped) is still used for deny-rule matching symmetry, which is
  // fail-safe: deny rules over-match (Module\\Remove-Item still hits a
  // Remove-Item deny), allow rules are separately gated by nameType.
  let nameType: 'cmdlet' | 'application' | 'unknown' = 'unknown'
  if (cmdElements.length > 0) {
    const first = cmdElements[0]!
    // SECURITY: only trust .value for string-literal element types with a
    // string-typed value. Numeric ConstantExpressionAst (e.g. `& 1`) emits an
    // integer .value that crashes stripModulePrefix() → parser falls through
    // to passthrough. For non-string-literal or non-string .value, use .text.
    const isFirstStringLiteral =
      first.type === 'StringConstantExpressionAst' ||
      first.type === 'ExpandableStringExpressionAst'
    const rawNameUnstripped =
      isFirstStringLiteral && typeof first.value === 'string'
        ? first.value
        : first.text
    // SECURITY: strip surrounding quotes from the command name. When .value is
    // unavailable (no StaticType on the raw node), .text preserves quotes —
    // `& 'Invoke-Expression' 'x'` yields "'Invoke-Expression'". Stripping here
    // at the source means every downstream reader of element.name (deny-rule
    // matching, GIT_SAFETY_WRITE_CMDLETS lookup, resolveToCanonical, etc.)
    // sees the bare cmdlet name. No-op when .value already stripped.
    const rawName = rawNameUnstripped.replace(/^['"]|['"]$/g, '')
    // SECURITY: PowerShell built-in cmdlet names are ASCII-only. Non-ASCII
    // characters in cmdlet position are inherently suspicious — .NET
    // OrdinalIgnoreCase folds U+017F (ſ) → S and U+0131 (ı) → I per
    // UnicodeData.txt SimpleUppercaseMapping, so PowerShell resolves
    // `ſtart-proceſſ` → Start-Process at runtime. JS .toLowerCase() does NOT
    // fold these (ſ is already lowercase), so every downstream name
    // comparison (NEVER_SUGGEST, deny-rule strEquals, resolveToCanonical,
    // security validators) misses. Force 'application' to gate auto-allow
    // (blocks at the nameType !== 'application' checks). Finding #31.
    // Verified on Windows (pwsh 7.x, 2026-03): ſtart-proceſſ does NOT resolve.
    // Retained as defense-in-depth against future .NET/PS behavior changes
    // or module-provided command resolution hooks.
    if (/[\u0080-\uFFFF]/.test(rawName)) {
      nameType = 'application'
    } else {
      nameType = classifyCommandName(rawName)
    }
    name = stripModulePrefix(rawName)
    elementTypes.push(mapElementType(first.type, first.expressionType))

    for (let i = 1; i < cmdElements.length; i++) {
      const ce = cmdElements[i]!
      // Use resolved .value for string constants (strips quotes, resolves
      // backtick escapes like `n -> newline) but keep raw .text for parameters
      // (where .value loses the dash prefix, e.g. '-Path' -> 'Path'),
      // variables, and other non-string types.
      const isStringLiteral =
        ce.type === 'StringConstantExpressionAst' ||
        ce.type === 'ExpandableStringExpressionAst'
      args.push(isStringLiteral && ce.value != null ? ce.value : ce.text)
      elementTypes.push(mapElementType(ce.type, ce.expressionType))
      // Map raw children (CommandParameterAst.Argument) through
      // mapElementType so consumers see 'Variable', 'StringConstant', etc.
      const rawChildren = ensureArray(ce.children)
      if (rawChildren.length > 0) {
        hasChildren = true
        children.push(
          rawChildren.map(c => ({
            type: mapElementType(c.type),
            text: c.text,
          })),
        )
      } else {
        children.push(undefined)
      }
    }
  }

  const result: ParsedCommandElement = {
    name,
    nameType,
    elementType: 'CommandAst',
    args,
    text: raw.text,
    elementTypes,
    ...(hasChildren ? { children } : {}),
  }

  // Preserve redirections from nested commands (e.g., in && / || chains)
  const rawRedirs = ensureArray(raw.redirections)
  if (rawRedirs.length > 0) {
    result.redirections = rawRedirs.map(transformRedirection)
  }

  return result
}
// `transformCommandAst` 收尾。这里有三层安全约定：① `nameType` 必须用**剥前缀之前**的原始名计算——「目录名 + 反斜杠 + Get 加连字符 Process」这种路径写法 含反斜杠，应判为应用程序（PowerShell 会按文件路径解析它），若剥完再判就成了 cmdlet，白名单会信任一个任意文件；② 命令名要去掉首尾引号，否则 `& 'Invoke-Expression' x` 的 `element.name` 带着引号，所有拒绝规则都匹配不上；③ 命令名里出现非 ASCII 就强制判为应用程序——.NET 的大小写折叠比 JS 宽（例如长 s、无点 i 会折叠成普通字母），PowerShell 能把 `ſtart-proceſſ` 解析成 Start-Process，而 JS 的 `toLowerCase` 不会折叠，所有名字比较都会漏。

/** Transform a non-CommandAst pipeline element into ParsedCommandElement */
// exported for testing
export function transformExpressionElement(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const elementType: PipelineElementType =
    raw.type === 'ParenExpressionAst'
      ? 'ParenExpressionAst'
      : 'CommandExpressionAst'
  const elementTypes: CommandElementType[] = [
    mapElementType(raw.type, raw.expressionType),
  ]

  return {
    name: raw.text,
    nameType: 'unknown',
    elementType,
    args: [],
    text: raw.text,
    elementTypes,
  }
}
// `transformExpressionElement` 处理非命令的管道元素（表达式、括号表达式）：名字取原文，参数为空，但保留元素类型。这类元素的危险不在于「跑了什么命令」，而在于表达式本身可能含子表达式或成员调用，所以类型必须准确传下去。

/** Map raw redirection to ParsedRedirection */
// exported for testing
export function transformRedirection(raw: RawRedirection): ParsedRedirection {
  if (raw.type === 'MergingRedirectionAst') {
    return { operator: '2>&1', target: '', isMerging: true }
  }

  const append = raw.append ?? false
  const fromStream = raw.fromStream ?? 'Output'

  let operator: ParsedRedirection['operator']
  if (append) {
    switch (fromStream) {
      case 'Error':
        operator = '2>>'
        break
      case 'All':
        operator = '*>>'
        break
      default:
        operator = '>>'
        break
    }
  } else {
    switch (fromStream) {
      case 'Error':
        operator = '2>'
        break
      case 'All':
        operator = '*>'
        break
      default:
        operator = '>'
        break
    }
  }

  return { operator, target: raw.locationText ?? '', isMerging: false }
}
// `transformRedirection` 把「追加标记 × 来源流」组合成七种操作符之一。注意合并重定向被单独处理成 `2>&1` 且 `isMerging: true`——它是唯一的「不算写文件」的重定向，判错方向会让 `2>&1` 被当成写盘而误拒所有带错误合并的命令。

/** Transform a raw statement into ParsedStatement */
// exported for testing
export function transformStatement(raw: RawStatement): ParsedStatement {
  const statementType = mapStatementType(raw.type)
  const commands: ParsedCommandElement[] = []
  const redirections: ParsedRedirection[] = []

  if (raw.elements) {
    // PipelineAst: walk pipeline elements
    for (const elem of ensureArray(raw.elements)) {
      if (elem.type === 'CommandAst') {
        commands.push(transformCommandAst(elem))
        for (const redir of ensureArray(elem.redirections)) {
          redirections.push(transformRedirection(redir))
        }
      } else {
        commands.push(transformExpressionElement(elem))
        // SECURITY: CommandExpressionAst also carries .Redirections (inherited
        // from CommandBaseAst). `1 > /tmp/evil.txt` is a CommandExpressionAst
        // with a FileRedirectionAst. Must extract here or getFileRedirections()
        // misses it and compound commands like `Get-ChildItem; 1 > /tmp/x`
        // auto-allow at step 5 (only Get-ChildItem is checked).
        for (const redir of ensureArray(elem.redirections)) {
          redirections.push(transformRedirection(redir))
        }
      }
    }
    // SECURITY: The PS1 PipelineAst branch does a deep FindAll for
    // FileRedirectionAst to catch redirections hidden inside:
    //  - colon-bound ParenExpressionAst args: -Name:('payload' > file)
    //  - hashtable value statements: @{k='payload' > ~/.bashrc}
    // Both are invisible at the element level — the redirection's parent
    // is a child of CommandParameterAst / CommandExpressionAst, not a
    // separate pipeline element. Merge into statement-level redirections.
    //
    // The FindAll ALSO re-discovers direct-element redirections already
    // captured in the per-element loop above. Dedupe by (operator, target)
    // so tests and consumers see the real count.
    const seen = new Set(redirections.map(r => `${r.operator}\0${r.target}`))
    for (const redir of ensureArray(raw.redirections)) {
      const r = transformRedirection(redir)
      const key = `${r.operator}\0${r.target}`
      if (!seen.has(key)) {
        seen.add(key)
        redirections.push(r)
      }
    }
  } else {
    // Non-pipeline statement: add synthetic command entry with full text
    commands.push({
      name: raw.text,
      nameType: 'unknown',
      elementType: 'CommandExpressionAst',
      args: [],
      text: raw.text,
    })
    // SECURITY: The PS1 else-branch does a direct recursive FindAll on
    // FileRedirectionAst to catch expression redirections inside control flow
    // (if/for/foreach/while/switch/try/trap/&& and ||). The CommandAst FindAll
    // above CANNOT see these: in if ($x) { 1 > /tmp/evil }, the literal 1 with
    // its attached redirection is a CommandExpressionAst — a SIBLING of
    // CommandAst in the type hierarchy, not a subclass. So nestedCommands never
    // contains it, and without this hoist the redirection is invisible to
    // getFileRedirections → step 4.6 misses it → compound commands like
    // `Get-Process && 1 > /tmp/evil` auto-allow at step 5 (only Get-Process
    // is checked, allowlisted).
    //
    // Finding FileRedirectionAst DIRECTLY (rather than finding CommandExpressionAst
    // and extracting .Redirections) is both simpler and more robust: it catches
    // redirections on any node type, including ones we don't know about yet.
    //
    // Double-counts redirections already on nested CommandAst commands (those are
    // extracted at line ~395 into nestedCommands[i].redirections AND found again
    // here). Harmless: step 4.6 only checks fileRedirections.length > 0, not
    // the exact count. No code does arithmetic on redirection counts.
    //
    // PS1 SIZE NOTE: The full rationale lives here (TS), not in the PS1 script,
    // because PS1 comments bloat the -EncodedCommand payload and push the
    // Windows CreateProcess 32K limit. Keep PS1 comments terse; point them here.
    for (const redir of ensureArray(raw.redirections)) {
      redirections.push(transformRedirection(redir))
    }
  }

  let nestedCommands: ParsedCommandElement[] | undefined
  const rawNested = ensureArray(raw.nestedCommands)
  if (rawNested.length > 0) {
    nestedCommands = rawNested.map(transformCommandAst)
  }

  const result: ParsedStatement = {
    statementType,
    commands,
    redirections,
    text: raw.text,
    nestedCommands,
  }

  if (raw.securityPatterns) {
    result.securityPatterns = raw.securityPatterns
  }

  return result
}
// `transformStatement` 收尾，三处安全逻辑：① 表达式元素的重定向也要收集（`1 > /tmp/evil.txt` 就是表达式元素带文件重定向）；② 语句级重定向与元素级重定向按「操作符 + 目标」去重，因为 PS1 侧的 FindAll 会把直接的也再找一遍，不去重则同一处重定向被算两次；③ 非管道语句合成一条伪命令，让下游「每条语句至少有一条命令」的假设始终成立。

/** Transform the complete raw PS output into ParsedPowerShellCommand */
function transformRawOutput(raw: RawParsedOutput): ParsedPowerShellCommand {
  const result: ParsedPowerShellCommand = {
    valid: raw.valid,
    errors: ensureArray(raw.errors),
    statements: ensureArray(raw.statements).map(transformStatement),
    variables: ensureArray(raw.variables),
    hasStopParsing: raw.hasStopParsing,
    originalCommand: raw.originalCommand,
  }
  const tl = ensureArray(raw.typeLiterals)
  if (tl.length > 0) {
    result.typeLiterals = tl
  }
  if (raw.hasUsingStatements) {
    result.hasUsingStatements = true
  }
  if (raw.hasScriptRequirements) {
    result.hasScriptRequirements = true
  }
  return result
}
// `transformRawOutput` 把原始输出转成最终类型。三个可选项（类型字面量、using 语句、Requires 指令）只在**为真或非空**时才写入结果对象，这样下游可以用「字段存在即危险」的简易判断，而不必区分「空数组」与「未提供」。

/**
 * Parse a PowerShell command using the native AST parser.
 * Spawns pwsh to parse the command and returns structured results.
 * Results are memoized by command string.
 *
 * @param command - The PowerShell command to parse
 * @returns Parsed command structure, or a result with valid=false on failure
 */
async function parsePowerShellCommandImpl(
  command: string,
): Promise<ParsedPowerShellCommand> {
  // SECURITY: MAX_COMMAND_LENGTH is a UTF-8 BYTE budget (see derivation at the
  // constant definition). command.length counts UTF-16 code units; a CJK
  // character is 1 code unit but 3 UTF-8 bytes, so .length under-reports by
  // up to 3× and allows argv overflow on Windows → CreateProcess fails →
  // valid:false → deny rules degrade to ask. Finding #36.
  const commandBytes = Buffer.byteLength(command, 'utf8')
  if (commandBytes > MAX_COMMAND_LENGTH) {
    logForDebugging(
      `PowerShell parser: command too long (${commandBytes} bytes, max ${MAX_COMMAND_LENGTH})`,
    )
    return makeInvalidResult(
      command,
      `Command too long for parsing (${commandBytes} bytes). Maximum supported length is ${MAX_COMMAND_LENGTH} bytes.`,
      'CommandTooLong',
    )
  }
// 长度门禁用 `Buffer.byteLength(command, 'utf8')` 而不是 `command.length`。这是 finding #36 的核心：`.length` 数的是 UTF-16 代码单元，一个 CJK 字符算 1，但 UTF-8 占 3 字节。base64 与 UTF-16 两级编码按字节放大，于是 1,092 个汉字的命令能通过 `.length` 门禁（正好等于上限），实际 argv 却是约 4 万字符，超出 32,767 → CreateProcess 失败 → 解析失败 → 拒绝规则静默降级成询问。**按错误的单位做预算，等于没有预算。**

  const pwshPath = await getCachedPowerShellPath()
  if (!pwshPath) {
    return makeInvalidResult(
      command,
      'PowerShell is not available',
      'NoPowerShell',
    )
  }
// 拿不到 pwsh 路径时不抛错，返回 `valid: false` 的合法结果。这样上层仍然能工作（走保守路径），而不是让整个权限检查崩掉。

  const script = buildParseScript(command)

  // Pass the script to PowerShell via -EncodedCommand.
  // -EncodedCommand takes a Base64-encoded UTF-16LE string and executes it,
  // which avoids: (1) stdin interactive-mode issues where -File - produces
  // PS prompts and ANSI escapes in stdout, (2) command-line escaping issues,
  // (3) temp files. The script itself is large but well within OS arg limits
  // (Windows: 32K chars, Unix: typically 2MB+).
  const encodedScript = toUtf16LeBase64(script)
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-NoLogo',
    '-EncodedCommand',
    encodedScript,
  ]
// 为什么用 `-EncodedCommand` 而不是 `-File -` 或临时文件：① 从 stdin 喂脚本会让 PowerShell 进交互模式，stdout 混进提示符与 ANSI 转义；② 直接拼命令行要处理引号/反斜杠/百分号等转义，跨平台几乎不可能做对；③ 临时文件要管创建、权限、清理与并发。base64 编码的命令行是唯一没有这些副作用的路子。

  // Spawn pwsh with one retry on timeout. On loaded CI runners (Windows
  // especially), pwsh spawn + .NET JIT + ParseInput occasionally exceeds 5s
  // even after CAN_SPAWN_PARSE_SCRIPT() warms the JIT. execa kills the process
  // but exitCode is undefined, which the old code reported as the misleading
  // "pwsh exited with code 1:" with empty stderr. A single retry absorbs
  // transient load spikes; a double timeout is reported as PwshTimeout.
  const parseTimeoutMs = getParseTimeoutMs()
  let stdout = ''
  let stderr = ''
  let code: number | null = null
  let timedOut = false
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await execa(pwshPath, args, {
        timeout: parseTimeoutMs,
        reject: false,
      })
      stdout = result.stdout
      stderr = result.stderr
      timedOut = result.timedOut
      code = result.failed ? (result.exitCode ?? 1) : 0
    } catch (e: unknown) {
      logForDebugging(
        `PowerShell parser: failed to spawn pwsh: ${e instanceof Error ? e.message : e}`,
      )
      return makeInvalidResult(
        command,
        `Failed to spawn PowerShell: ${e instanceof Error ? e.message : e}`,
        'PwshSpawnError',
      )
    }
    if (!timedOut) break
    logForDebugging(
      `PowerShell parser: pwsh timed out after ${parseTimeoutMs}ms (attempt ${attempt + 1})`,
    )
  }
// 超时后重试一次，且只重试一次。注释给了根因：在负载高的 Windows CI 上，pwsh 启动 + .NET JIT + ParseInput 偶发超过 5 秒，而 execa 杀掉进程时 `exitCode` 是 undefined，旧代码会把它报成「退出码 1，stderr 为空」这种完全误导的信息。单次重试吸收瞬时抖动，两次都超时才报 PwshTimeout——**错误分类错了，排查方向就会全错**。

  if (timedOut) {
    return makeInvalidResult(
      command,
      `pwsh timed out after ${parseTimeoutMs}ms (2 attempts)`,
      'PwshTimeout',
    )
  }
// 两次都超时才报 `PwshTimeout`，这是一个瞬时错误 ID，会被缓存逐出（见文件后部的瞬时集合），所以下次同样的命令还会重试。

  if (code !== 0) {
    logForDebugging(
      `PowerShell parser: pwsh exited with code ${code}, stderr: ${stderr}`,
    )
    return makeInvalidResult(
      command,
      `pwsh exited with code ${code}: ${stderr}`,
      'PwshError',
    )
  }
// 非零退出码带上 stderr 原文返回。这里保留原始 stderr 很关键：区分「我们传的脚本有 bug」与「环境里 pwsh 有问题」全靠它，而这两类问题的修复人完全不同。

  const trimmed = stdout.trim()
  if (!trimmed) {
    logForDebugging('PowerShell parser: empty stdout from pwsh')
    return makeInvalidResult(
      command,
      'No output from PowerShell parser',
      'EmptyOutput',
    )
  }

  try {
    const raw = jsonParse(trimmed) as RawParsedOutput
    return transformRawOutput(raw)
  } catch {
    logForDebugging(
      `PowerShell parser: invalid JSON output: ${trimmed.slice(0, 200)}`,
    )
    return makeInvalidResult(
      command,
      'Invalid JSON from PowerShell parser',
      'InvalidJson',
    )
  }
// stdout 为空或 JSON 解析失败都归为失败结果，并把输出前 200 字符记进调试日志。截断是为了避免一条坏输出刷满日志——但在排查时这 200 字符往往就够定位（是混进了提示符、还是脚本报错）。
}

// Error IDs from makeInvalidResult that represent transient process failures.
// These should be evicted from the cache so subsequent calls can retry.
// Deterministic failures (CommandTooLong, syntax errors from successful parses)
// should stay cached since retrying would produce the same result.
const TRANSIENT_ERROR_IDS = new Set([
  'PwshSpawnError',
  'PwshError',
  'PwshTimeout',
  'EmptyOutput',
  'InvalidJson',
])
// `TRANSIENT_ERROR_IDS` 定义了「哪些失败可以重试」：进程起不来、非零退出、超时、空输出、坏 JSON——都是环境抖动。确定性的失败（命令太长、语法错误）不在此列，因为重试必然得到同样结果，缓存住反而省一次 pwsh 启动（约 450ms）。

const parsePowerShellCommandCached = memoizeWithLRU(
  (command: string) => {
    const promise = parsePowerShellCommandImpl(command)
    // Evict transient failures after resolution so they can be retried.
    // The current caller still receives the cached promise for this call,
    // ensuring concurrent callers share the same result.
    void promise.then(result => {
      if (
        !result.valid &&
        TRANSIENT_ERROR_IDS.has(result.errors[0]?.errorId ?? '')
      ) {
        parsePowerShellCommandCached.cache.delete(command)
      }
    })
    return promise
  },
  (command: string) => command,
  256,
)
export { parsePowerShellCommandCached as parsePowerShellCommand }
// `memoizeWithLRU` 按命令原文缓存，容量 256。关键在于「瞬时失败在 promise 完成后逐出」：当前调用方仍然拿到同一个 promise（并发调用者共享结果），但缓存里删掉，下次可以重试。这个「先返回、后逐出」的顺序保证了并发一致性与可重试性同时成立。

// ---------------------------------------------------------------------------
// Analysis helpers — derived from the parsed AST structure.
// ---------------------------------------------------------------------------

/**
 * Security-relevant flags derived from the parsed AST.
 */
type SecurityFlags = {
  /** Contains $(...) subexpression */
  hasSubExpressions: boolean
  /** Contains { ... } script block expressions */
  hasScriptBlocks: boolean
  /** Contains @variable splatting */
  hasSplatting: boolean
  /** Contains expandable strings with embedded expressions ("...$()...") */
  hasExpandableStrings: boolean
  /** Contains .NET method invocations ([Type]::Method or $obj.Method()) */
  hasMemberInvocations: boolean
  /** Contains variable assignments ($x = ...) */
  hasAssignments: boolean
  /** Uses stop-parsing token (--%) */
  hasStopParsing: boolean
}
// `SecurityFlags` 是给下游权限判定用的七个布尔量：子表达式、脚本块、splatting、可展开字符串、成员调用、赋值、停止解析符。它们不是「命令做了什么」，而是「这条命令的形态有多难静态判断」——任何一个为真，自动批准就基本不可能。

/**
 * Common PowerShell aliases mapped to their canonical cmdlet names.
 * Uses Object.create(null) to prevent prototype-chain pollution — attacker-controlled
 * command names like 'constructor' or '__proto__' must return undefined, not inherited
 * Object.prototype properties.
 */
export const COMMON_ALIASES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    // Directory listing
    ls: 'Get-ChildItem',
    dir: 'Get-ChildItem',
    gci: 'Get-ChildItem',
    // Content
    cat: 'Get-Content',
    type: 'Get-Content',
    gc: 'Get-Content',
    // Navigation
    cd: 'Set-Location',
    sl: 'Set-Location',
    chdir: 'Set-Location',
    pushd: 'Push-Location',
    popd: 'Pop-Location',
    pwd: 'Get-Location',
    gl: 'Get-Location',
    // Items
    gi: 'Get-Item',
    gp: 'Get-ItemProperty',
    ni: 'New-Item',
    mkdir: 'New-Item',
    // `md` is PowerShell's built-in alias for `mkdir`. resolveToCanonical is
    // single-hop (no md→mkdir→New-Item chaining), so it needs its own entry
    // or `md /etc/x` falls through while `mkdir /etc/x` is caught.
    md: 'New-Item',
    ri: 'Remove-Item',
    del: 'Remove-Item',
    rd: 'Remove-Item',
    rmdir: 'Remove-Item',
    rm: 'Remove-Item',
    erase: 'Remove-Item',
    mi: 'Move-Item',
    mv: 'Move-Item',
    move: 'Move-Item',
    ci: 'Copy-Item',
    cp: 'Copy-Item',
    copy: 'Copy-Item',
    cpi: 'Copy-Item',
    si: 'Set-Item',
    rni: 'Rename-Item',
    ren: 'Rename-Item',
    // Process
    ps: 'Get-Process',
    gps: 'Get-Process',
    kill: 'Stop-Process',
    spps: 'Stop-Process',
    start: 'Start-Process',
    saps: 'Start-Process',
    sajb: 'Start-Job',
    ipmo: 'Import-Module',
    // Output
    echo: 'Write-Output',
    write: 'Write-Output',
    sleep: 'Start-Sleep',
    // Help
    help: 'Get-Help',
    man: 'Get-Help',
    gcm: 'Get-Command',
    // Service
    gsv: 'Get-Service',
    // Variables
    gv: 'Get-Variable',
    sv: 'Set-Variable',
    // History
    h: 'Get-History',
    history: 'Get-History',
    // Invoke
    iex: 'Invoke-Expression',
    iwr: 'Invoke-WebRequest',
    irm: 'Invoke-RestMethod',
    icm: 'Invoke-Command',
    ii: 'Invoke-Item',
    // PSSession — remote code execution surface
    nsn: 'New-PSSession',
    etsn: 'Enter-PSSession',
    exsn: 'Exit-PSSession',
    gsn: 'Get-PSSession',
    rsn: 'Remove-PSSession',
    // Misc
    cls: 'Clear-Host',
    clear: 'Clear-Host',
    select: 'Select-Object',
    where: 'Where-Object',
    foreach: 'ForEach-Object',
    '%': 'ForEach-Object',
    '?': 'Where-Object',
    measure: 'Measure-Object',
    ft: 'Format-Table',
    fl: 'Format-List',
    fw: 'Format-Wide',
    oh: 'Out-Host',
    ogv: 'Out-GridView',
    // SECURITY: The following aliases are deliberately omitted because PS Core 6+
    // removed them (they collide with native executables). Our allowlist logic
    // resolves aliases BEFORE checking safety — if we map 'sort' → 'Sort-Object'
    // but PowerShell 7/Windows actually runs sort.exe, we'd auto-allow the wrong
    // program.
    //   'sc'   → sc.exe (Service Controller) — e.g. `sc config Svc binpath= ...`
    //   'sort' → sort.exe — e.g. `sort /O C:\evil.txt` (arbitrary file write)
    //   'curl' → curl.exe (shipped with Windows 10 1803+)
    //   'wget' → wget.exe (if installed)
    // Prefer to leave ambiguous aliases unmapped — users can write the full name.
    // If adding aliases that resolve to SAFE_OUTPUT_CMDLETS or
    // ACCEPT_EDITS_ALLOWED_CMDLETS, verify no native .exe collision on PS Core.
    ac: 'Add-Content',
    clc: 'Clear-Content',
    // Write/export: tee-object/export-csv are in
    // CMDLET_PATH_CONFIG so path-level Edit denies fire on the full cmdlet name,
    // but PowerShell's built-in aliases fell through to ask-then-approve because
    // resolveToCanonical couldn't resolve them). Neither tee-object nor
    // export-csv is in SAFE_OUTPUT_CMDLETS or ACCEPT_EDITS_ALLOWED_CMDLETS, so
    // the native-exe collision warning above doesn't apply — on Linux PS Core
    // where `tee` runs /usr/bin/tee, that binary also writes to its positional
    // file arg and we correctly extract+check it.
    tee: 'Tee-Object',
    epcsv: 'Export-Csv',
    sp: 'Set-ItemProperty',
    rp: 'Remove-ItemProperty',
    cli: 'Clear-Item',
    epal: 'Export-Alias',
    // Text search
    sls: 'Select-String',
  },
)
// `COMMON_ALIASES` 收尾，两个设计点必须记住：① 用 `Object.create(null)` 作原型，防止原型链污染——攻击者可以把命令名写成 `constructor` 或 `__proto__`，若用普通对象，查表会命中原型上的属性并当成别名；② 刻意**不**映射 `sc`、`sort`、`curl`、`wget`：PowerShell 6+ 删掉了这些别名（与原生 exe 冲突），若我们映射 `sort` → Sort-Object，而系统实际执行的是 sort.exe，就会「按安全命令批准、实际跑了别的程序」。歧义别名宁可留空，让用户写全名。

const DIRECTORY_CHANGE_CMDLETS = new Set([
  'set-location',
  'push-location',
  'pop-location',
])

const DIRECTORY_CHANGE_ALIASES = new Set(['cd', 'sl', 'chdir', 'pushd', 'popd'])
// 目录切换用两个集合分别列 cmdlet 与别名，而不是靠别名表反查。原因是判定要在**大小写与别名两个维度**都覆盖：`cd`、`sl`、`chdir`、`pushd`、`popd` 这些短名在别名表里映射到三个不同 cmdlet，反查既慢又容易漏（比如 `popd` 在表里但语义上是「切回上一处」）。

/**
 * Get all command names across all statements, pipeline segments, and nested commands.
 * Returns lowercased names for case-insensitive comparison.
 */
// exported for testing
export function getAllCommandNames(parsed: ParsedPowerShellCommand): string[] {
  const names: string[] = []
  for (const statement of parsed.statements) {
    for (const cmd of statement.commands) {
      names.push(cmd.name.toLowerCase())
    }
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        names.push(cmd.name.toLowerCase())
      }
    }
  }
  return names
}
// `getAllCommandNames` 把语句命令与嵌套命令的名字统一小写输出。小写化是全线约定：PowerShell 命令名大小写不敏感，而 JS 比较敏感，任何一处忘了小写就会出现「换个大小写就绕过拒绝规则」。

/**
 * Get all pipeline segments as flat list of commands.
 * Useful for checking each command independently.
 */
export function getAllCommands(
  parsed: ParsedPowerShellCommand,
): ParsedCommandElement[] {
  const commands: ParsedCommandElement[] = []
  for (const statement of parsed.statements) {
    for (const cmd of statement.commands) {
      commands.push(cmd)
    }
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        commands.push(cmd)
      }
    }
  }
  return commands
}
// `getAllCommands` 与上面的区别是返回完整对象而非名字——需要看参数、元素类型、重定向时用它；只需要比对名字时用前者，省一次遍历。

/**
 * Get all redirections across all statements.
 */
// exported for testing
export function getAllRedirections(
  parsed: ParsedPowerShellCommand,
): ParsedRedirection[] {
  const redirections: ParsedRedirection[] = []
  for (const statement of parsed.statements) {
    for (const redir of statement.redirections) {
      redirections.push(redir)
    }
    // Include redirections from nested commands (e.g., from && / || chains)
    if (statement.nestedCommands) {
      for (const cmd of statement.nestedCommands) {
        if (cmd.redirections) {
          for (const redir of cmd.redirections) {
            redirections.push(redir)
          }
        }
      }
    }
  }
  return redirections
}
// `getAllRedirections` 把语句级与嵌套命令级重定向合并。若只取语句级，`Get-Process && 1 > /tmp/evil` 里藏在管道链右半边的重定向就看不见了。

/**
 * Get all variables, optionally filtered by scope (e.g., 'env').
 * Variable paths in PowerShell can have scopes like "env:PATH", "global:x".
 */
export function getVariablesByScope(
  parsed: ParsedPowerShellCommand,
  scope: string,
): ParsedVariable[] {
  const prefix = scope.toLowerCase() + ':'
  return parsed.variables.filter(v => v.path.toLowerCase().startsWith(prefix))
}
// `getVariablesByScope` 按作用域前缀过滤（`env:`、`global:`、`script:`）。环境变量是最常被读来外泄的目标，`$env:` 前缀因此是安全审计的高频入口；前缀比较要小写化，因为 `$ENV:PATH` 与 `$env:PATH` 是同一个变量。

/**
 * Check if any command in the parsed result matches a given name (case-insensitive).
 * Handles common aliases too.
 */
export function hasCommandNamed(
  parsed: ParsedPowerShellCommand,
  name: string,
): boolean {
  const lowerName = name.toLowerCase()
  const canonicalFromAlias = COMMON_ALIASES[lowerName]?.toLowerCase()

  for (const cmdName of getAllCommandNames(parsed)) {
    if (cmdName === lowerName) {
      return true
    }
    // Check if the command is an alias that resolves to the requested name
    const canonical = COMMON_ALIASES[cmdName]?.toLowerCase()
    if (canonical === lowerName) {
      return true
    }
    // Check if the requested name is an alias and the command is its canonical form
    if (canonicalFromAlias && cmdName === canonicalFromAlias) {
      return true
    }
    // Check if both resolve to the same canonical cmdlet (alias-to-alias match)
    if (canonical && canonicalFromAlias && canonical === canonicalFromAlias) {
      return true
    }
  }
  return false
}
// `hasCommandNamed` 做了四路匹配：名字相等、命令名作为别名解析到目标、目标名作为别名而命令是它的规范名、两者解析到同一个规范 cmdlet（别名对别名）。四路缺任何一路都会留下绕过口：例如只做前两路时，问「有没有 Remove-Item」而命令写的是 `ri`，就查不出来。

/**
 * Check if the command contains any directory-changing commands.
 * (Set-Location, cd, sl, chdir, Push-Location, pushd, Pop-Location, popd)
 */
// exported for testing
export function hasDirectoryChange(parsed: ParsedPowerShellCommand): boolean {
  for (const cmdName of getAllCommandNames(parsed)) {
    if (
      DIRECTORY_CHANGE_CMDLETS.has(cmdName) ||
      DIRECTORY_CHANGE_ALIASES.has(cmdName)
    ) {
      return true
    }
  }
  return false
}
// `hasDirectoryChange` 单独判目录切换，因为它是「路径型权限」的前提：一旦命令里出现 cd/pushd，后续所有相对路径的基准都变了，静态路径校验全部失效，必须降级为询问。

/**
 * Check if the command is a single simple command (no pipes, no semicolons, no operators).
 */
// exported for testing
export function isSingleCommand(parsed: ParsedPowerShellCommand): boolean {
  const stmt = parsed.statements[0]
  return (
    parsed.statements.length === 1 &&
    stmt !== undefined &&
    stmt.commands.length === 1 &&
    (!stmt.nestedCommands || stmt.nestedCommands.length === 0)
  )
}
// `isSingleCommand` 要求「一条语句、一条命令、无嵌套」。这是自动批准的最基本门槛：只要出现分号、管道或多条语句，就说明这条命令有多个执行面，逐条判安全的成本与风险都上升。

/**
 * Check if a specific command has a given argument/flag (case-insensitive).
 * Useful for checking "-EncodedCommand", "-Recurse", etc.
 */
export function commandHasArg(
  command: ParsedCommandElement,
  arg: string,
): boolean {
  const lowerArg = arg.toLowerCase()
  return command.args.some(a => a.toLowerCase() === lowerArg)
}
// `commandHasArg` 是大小写不敏感的参数比对（`-Recurse` 与 `-recurse` 等价）。它只看完整匹配，不处理缩写——缩写是下面 `commandHasArgAbbreviation` 的事。

/**
 * Tokenizer-level dash characters that PowerShell's parser accepts as
 * parameter prefixes. SpecialCharacters.IsDash (CharTraits.cs) accepts exactly
 * these four: ASCII hyphen-minus, en-dash, em-dash, horizontal bar. These are
 * tokenizer-level — they apply to ALL cmdlet parameters, not just argv to
 * powershell.exe (contrast with `/` which is an argv-parser quirk of
 * powershell.exe 5.1 only; see PS_ALT_PARAM_PREFIXES in powershellSecurity.ts).
 *
 * Extent.Text preserves the raw character; transformCommandAst uses ce.text
 * for CommandParameterAst elements, so these reach callers unchanged.
 */
export const PS_TOKENIZER_DASH_CHARS = new Set([
  '-', // U+002D hyphen-minus (ASCII)
  '\u2013', // en-dash
  '\u2014', // em-dash
  '\u2015', // horizontal bar
])
// `PS_TOKENIZER_DASH_CHARS` 四种字符：ASCII 减号、短破折号、长破折号、水平线。这是 PowerShell 记号器层面的规则（不是 powershell.exe 命令行层面的怪癖），对所有 cmdlet 参数生效。四种破折号都能引出参数，所以 `–EncodedCommand`（短破折号）与 `-EncodedCommand` 等价——只按 ASCII 减号做检查的实现会被轻易绕过。

/**
 * Determines if an argument is a PowerShell parameter (flag), using the AST
 * element type as ground truth when available.
 *
 * The parser maps CommandParameterAst → 'Parameter' regardless of which dash
 * character the user typed — PowerShell's tokenizer handles that. So when
 * elementType is available, it's authoritative:
 *   - 'Parameter' → true (covers `-Path`, `–Path`, `—Path`, `―Path`)
 *   - anything else → false (a quoted "-Path" is StringConstant, not a param)
 *
 * When elementType is unavailable (backward compat / no AST detail), fall back
 * to a char check against PS_TOKENIZER_DASH_CHARS.
 */
export function isPowerShellParameter(
  arg: string,
  elementType?: CommandElementType,
): boolean {
  if (elementType !== undefined) {
    return elementType === 'Parameter'
  }
  return arg.length > 0 && PS_TOKENIZER_DASH_CHARS.has(arg[0]!)
}
// `isPowerShellParameter` 优先信 AST 元素类型：PS1 侧把 `CommandParameterAst` 映射成 `Parameter`，无论用户敲的是哪种破折号，这是权威判据。只有在没有元素类型（旧数据或未提供）时才回退到「首字符是不是四种破折号之一」。这个「优先信结构、退而查字符」的顺序，比反过来可靠得多——带引号的 `-Path` 是字符串常量而不是参数，只有 AST 能分辨。

/**
 * Check if any argument on a command is an unambiguous abbreviation of a PowerShell parameter.
 * PowerShell allows parameter abbreviation as long as the prefix is unambiguous.
 * The minPrefix is the shortest unambiguous prefix for the parameter.
 * For example, minPrefix '-en' for fullParam '-encodedcommand' matches '-en', '-enc', '-enco', etc.
 */
export function commandHasArgAbbreviation(
  command: ParsedCommandElement,
  fullParam: string,
  minPrefix: string,
): boolean {
  const lowerFull = fullParam.toLowerCase()
  const lowerMin = minPrefix.toLowerCase()
  return command.args.some(a => {
    // Strip colon-bound value (e.g., -en:base64value -> -en)
    const colonIndex = a.indexOf(':', 1)
    const paramPart = colonIndex > 0 ? a.slice(0, colonIndex) : a
    // Strip backtick escapes — PowerShell resolves `-Member`Name` to
    // `-MemberName` but Extent.Text preserves the backtick, causing
    // prefix-comparison misses on the raw text.
    const lower = paramPart.replace(/`/g, '').toLowerCase()
    return (
      lower.startsWith(lowerMin) &&
      lowerFull.startsWith(lower) &&
      lower.length <= lowerFull.length
    )
  })
}
// `commandHasArgAbbreviation` 处理 PowerShell 的参数缩写（`-en`、`-enc` 都等于 `-EncodedCommand`）。两处预处理不可省：① 去掉冒号绑定值（`-en:base64...` 只留 `-en`），② 去掉反引号转义——PowerShell 会把反引号从标识符里剥掉再解析，而 `Extent.Text` 保留原字符，不去掉就会前缀比对失败。判据是「参数名等于或长于最短唯一前缀，且是完整参数名的前缀」。

/**
 * Split a parsed command into its pipeline segments for per-segment permission checking.
 * Returns each pipeline's commands separately.
 */
export function getPipelineSegments(
  parsed: ParsedPowerShellCommand,
): ParsedStatement[] {
  return parsed.statements
}
// `getPipelineSegments` 目前就是直接返回 statements——函数名暗示「按管道分段」，实际粒度是语句。保留这层间接是有意的：权限判定按语句遍历，而语句内部可能含多条管道（`a | b; c | d` 是两条语句），调用方不必关心这个区别。

/**
 * True if a redirection target is PowerShell's `$null` automatic variable.
 * `> $null` discards output (like /dev/null) — not a filesystem write.
 * `$null` cannot be reassigned, so this is safe to treat as a no-op sink.
 * `${null}` is the same automatic variable via curly-brace syntax. Spaces
 * inside the braces (`${ null }`) name a different variable, so no regex.
 */
export function isNullRedirectionTarget(target: string): boolean {
  const t = target.trim().toLowerCase()
  return t === '$null' || t === '${null}'
}
// `isNullRedirectionTarget` 判断重定向目标是不是 `$null`（含花括号写法 `${null}`）。`> $null` 是丢弃输出（等价于 /dev/null），不是写文件；而 `$null` 是自动变量、不可重新赋值，所以按空汇处理是安全的。不用正则匹配花括号内的空白，是因为 `${ null }` 里的空格让它成了**另一个变量名**，宽松匹配会把真实写盘误判成丢弃。

/**
 * Get output redirections (file redirections, not merging redirections).
 * Returns only redirections that write to files.
 */
// exported for testing
export function getFileRedirections(
  parsed: ParsedPowerShellCommand,
): ParsedRedirection[] {
  return getAllRedirections(parsed).filter(
    r => !r.isMerging && !isNullRedirectionTarget(r.target),
  )
}
// `getFileRedirections` 只留真正的文件重定向：排除合并重定向（`2>&1`）与 `$null` 目标。这是「写盘判定」的唯一入口，错一个方向就是误批或误拒——漏掉合并重定向会误拒所有 `2>&1` 命令，放过 `$null` 会误拒所有 `> $null` 的安静命令。

/**
 * Derive security-relevant flags from the parsed command structure.
 * This replaces the previous approach of computing flags in PowerShell via
 * separate Find-AstNodes calls. Instead, the PS1 script tags each element
 * with its AST node type, and this function walks those types.
 */
// exported for testing
export function deriveSecurityFlags(
  parsed: ParsedPowerShellCommand,
): SecurityFlags {
  const flags: SecurityFlags = {
    hasSubExpressions: false,
    hasScriptBlocks: false,
    hasSplatting: false,
    hasExpandableStrings: false,
    hasMemberInvocations: false,
    hasAssignments: false,
    hasStopParsing: parsed.hasStopParsing,
  }

  function checkElements(cmd: ParsedCommandElement): void {
    if (!cmd.elementTypes) {
      return
    }
    for (const et of cmd.elementTypes) {
      switch (et) {
        case 'ScriptBlock':
          flags.hasScriptBlocks = true
          break
        case 'SubExpression':
          flags.hasSubExpressions = true
          break
        case 'ExpandableString':
          flags.hasExpandableStrings = true
          break
        case 'MemberInvocation':
          flags.hasMemberInvocations = true
          break
      }
    }
  }

  for (const stmt of parsed.statements) {
    if (stmt.statementType === 'AssignmentStatementAst') {
      flags.hasAssignments = true
    }
    for (const cmd of stmt.commands) {
      checkElements(cmd)
    }
    if (stmt.nestedCommands) {
      for (const cmd of stmt.nestedCommands) {
        checkElements(cmd)
      }
    }
    // securityPatterns provides a belt-and-suspenders check that catches
    // patterns elementTypes may miss (e.g. member invocations inside
    // assignments, subexpressions in non-pipeline statements).
    if (stmt.securityPatterns) {
      if (stmt.securityPatterns.hasMemberInvocations) {
        flags.hasMemberInvocations = true
      }
      if (stmt.securityPatterns.hasSubExpressions) {
        flags.hasSubExpressions = true
      }
      if (stmt.securityPatterns.hasExpandableStrings) {
        flags.hasExpandableStrings = true
      }
      if (stmt.securityPatterns.hasScriptBlocks) {
        flags.hasScriptBlocks = true
      }
    }
  }

  for (const v of parsed.variables) {
    if (v.isSplatted) {
      flags.hasSplatting = true
      break
    }
  }

  return flags
}
// `deriveSecurityFlags` 收尾。它走两条互补路径：先按元素类型逐条命令累加（覆盖管道与嵌套命令），再用语句级的 `securityPatterns` 做二次确认（覆盖赋值语句里的成员调用、非管道语句里的子表达式——这些不走命令元素路径）。注释把后者称为「腰带加背带」，很准确：两条路都能独立发现大部分形态，但各自的盲区不同。

// Raw types exported for testing (function exports are inline above)
