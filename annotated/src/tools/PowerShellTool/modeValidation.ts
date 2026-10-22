/**
 * PowerShell permission mode validation.
 *
 * Checks if commands should be auto-allowed based on the current permission mode.
 * In acceptEdits mode, filesystem-modifying PowerShell cmdlets are auto-allowed.
 * Follows the same patterns as BashTool/modeValidation.ts.
 */
// acceptEdits 模式的 PowerShell 版：文件系统写 cmdlet 自动放行。判定形态跟随 BashTool 的 modeValidation——两个 shell 工具在权限层刻意保持同构。

import type { ToolPermissionContext } from '../../Tool.js'
import type { PermissionResult } from '../../utils/permissions/PermissionResult.js'
import type { ParsedPowerShellCommand } from '../../utils/powershell/parser.js'
import {
  deriveSecurityFlags,
  getPipelineSegments,
  PS_TOKENIZER_DASH_CHARS,
} from '../../utils/powershell/parser.js'
import {
  argLeaksValue,
  isAllowlistedPipelineTail,
  isCwdChangingCmdlet,
  isSafeOutputCommand,
  resolveToCanonical,
} from './readOnlyValidation.js'

/**
 * Filesystem-modifying cmdlets that are auto-allowed in acceptEdits mode.
 * Stored as canonical (lowercase) cmdlet names.
 *
 * Tier 3 cmdlets with complex parameter binding removed — they fall through to
 * 'ask'. Only simple write cmdlets (first positional = -Path) are auto-allowed
 * here, and they get path validation via CMDLET_PATH_CONFIG in pathValidation.ts.
 */
// 白名单只收四个「简单写」cmdlet（set/add/clear-content、remove-item）；复杂参数绑定的 Tier 3 cmdlet（new-item、copy-item、move-item 等）故意留白落回 ask——它们能过路径校验但参数组合太复杂，宁可多问一次。
const ACCEPT_EDITS_ALLOWED_CMDLETS = new Set([
  'set-content',
  'add-content',
  'remove-item',
  'clear-content',
])

function isAcceptEditsAllowedCmdlet(name: string): boolean {
  // resolveToCanonical handles aliases via COMMON_ALIASES, so e.g. 'rm' → 'remove-item',
  // 'ac' → 'add-content'. Any alias that resolves to an allowed cmdlet is automatically
  // allowed. Tier 3 cmdlets (new-item, copy-item, move-item, etc.) and their aliases
  // (mkdir, ni, cp, mv, etc.) resolve to cmdlets NOT in the set and fall through to 'ask'.
  const canonical = resolveToCanonical(name)
  return ACCEPT_EDITS_ALLOWED_CMDLETS.has(canonical)
}
// 别名经 resolveToCanonical 解析后对等放行：rm 解析成 remove-item 自动允许；mkdir 解析成 new-item 不在集合、落回 ask——别名体系免费继承白名单语义。

/**
 * New-Item -ItemType values that create filesystem links (reparse points or
 * hard links). All three redirect path resolution at runtime — symbolic links
 * and junctions are directory/file reparse points; hard links alias a file's
 * inode. Any of these let a later relative-path write land outside the
 * validator's view.
 */
const LINK_ITEM_TYPES = new Set(['symboliclink', 'junction', 'hardlink'])
// 三种链接类型都是重解析点或硬链接——创建之后，后续相对路径写入会解析到链接目标、落在校验器视野之外。

/**
 * Check if a lowered, dash-normalized arg (colon-value stripped) is an
 * unambiguous PowerShell abbreviation of New-Item's -ItemType or -Type param.
 * Min prefixes: `-it` (avoids ambiguity with other New-Item params), `-ty`
 * (avoids `-t` colliding with `-Target`).
 */
function isItemTypeParamAbbrev(p: string): boolean {
  return (
    (p.length >= 3 && '-itemtype'.startsWith(p)) ||
    (p.length >= 3 && '-type'.startsWith(p))
  )
}
// PowerShell 参数可缩写：-it 是 -ItemType 的最短无歧义前缀（再短会与其他参数撞车），-ty 是 -Type 的（避开 -Target）。

/**
 * Detects New-Item creating a filesystem link (-ItemType SymbolicLink /
 * Junction / HardLink, or the -Type alias). Links poison subsequent path
 * resolution the same way Set-Location/New-PSDrive do: a relative path
 * through the link resolves to the link target, not the validator's view.
 * Finding #18.
 *
 * Handles PS parameter abbreviation (`-it`, `-ite`, ... `-itemtype`; `-ty`,
 * `-typ`, `-type`), unicode dash prefixes (en-dash/em-dash/horizontal-bar),
 * and colon-bound values (`-it:Junction`).
 */
export function isSymlinkCreatingCommand(cmd: {
  name: string
  args: string[]
}): boolean {
  const canonical = resolveToCanonical(cmd.name)
  if (canonical !== 'new-item') return false
  for (let i = 0; i < cmd.args.length; i++) {
    const raw = cmd.args[i] ?? ''
    if (raw.length === 0) continue
    // Normalize unicode dash prefixes (–, —, ―) and forward-slash (PS 5.1
    // parameter prefix) → ASCII `-` so prefix comparison works. PS tokenizer
    // treats all four dash chars plus `/` as parameter markers. (bug #26)
    const normalized =
      PS_TOKENIZER_DASH_CHARS.has(raw[0]!) || raw[0] === '/'
        ? '-' + raw.slice(1)
        : raw
    const lower = normalized.toLowerCase()
    // Split colon-bound value: -it:SymbolicLink → param='-it', val='symboliclink'
    const colonIdx = lower.indexOf(':', 1)
    const paramRaw = colonIdx > 0 ? lower.slice(0, colonIdx) : lower
    // Strip backtick escapes: -Item`Type → -ItemType (bug #22)
    const param = paramRaw.replace(/`/g, '')
    if (!isItemTypeParamAbbrev(param)) continue
    const rawVal =
      colonIdx > 0
        ? lower.slice(colonIdx + 1)
        : (cmd.args[i + 1]?.toLowerCase() ?? '')
    // Strip backtick escapes from colon-bound value: -it:Sym`bolicLink → symboliclink
    // Mirrors the param-name strip at L103. Space-separated args use .value
    // (backtick-resolved by .NET parser), but colon-bound uses .text (raw source).
    // Strip surrounding quotes: -it:'SymbolicLink' or -it:"Junction" (bug #6)
    const val = rawVal.replace(/`/g, '').replace(/^['"]|['"]$/g, '')
    if (LINK_ITEM_TYPES.has(val)) return true
  }
  return false
}
// 这个检测要啃掉 PS 的全部语法糖：unicode 横杠前缀（en-dash/em-dash/横线与正斜杠都是参数标记，bug #26）、冒号绑定值、反引号转义（bug #22）、引号包裹（bug #6）——finding #18（符号链接逃逸）的完整修复。

/**
 * Checks if commands should be handled differently based on the current permission mode.
 *
 * In acceptEdits mode, auto-allows filesystem-modifying PowerShell cmdlets.
 * Uses the AST to resolve aliases before checking the allowlist.
 *
 * @param input - The PowerShell command input
 * @param parsed - The parsed AST of the command
 * @param toolPermissionContext - Context containing mode and permissions
 * @returns
 * - 'allow' if the current mode permits auto-approval
 * - 'passthrough' if no mode-specific handling applies
 */
export function checkPermissionMode(
  input: { command: string },
  parsed: ParsedPowerShellCommand,
  toolPermissionContext: ToolPermissionContext,
): PermissionResult {
  // Skip bypass and dontAsk modes (handled elsewhere)
  if (
    toolPermissionContext.mode === 'bypassPermissions' ||
    toolPermissionContext.mode === 'dontAsk'
  ) {
    return {
      behavior: 'passthrough',
      message: 'Mode is handled in main permission flow',
    }
  }
// bypassPermissions 与 dontAsk 在主权限流里处理，这里直接 passthrough 不重复判定。

  if (toolPermissionContext.mode !== 'acceptEdits') {
    return {
      behavior: 'passthrough',
      message: 'No mode-specific validation required',
    }
  }

  // acceptEdits mode: check if all commands are filesystem-modifying cmdlets
  if (!parsed.valid) {
    return {
      behavior: 'passthrough',
      message: 'Cannot validate mode for unparsed command',
    }
  }

  // SECURITY: Check for subexpressions, script blocks, or member invocations
  // that could be used to smuggle arbitrary code through acceptEdits mode.
  const securityFlags = deriveSecurityFlags(parsed)
  if (
    securityFlags.hasSubExpressions ||
    securityFlags.hasScriptBlocks ||
    securityFlags.hasMemberInvocations ||
    securityFlags.hasSplatting ||
    securityFlags.hasAssignments ||
    securityFlags.hasStopParsing ||
    securityFlags.hasExpandableStrings
  ) {
    return {
      behavior: 'passthrough',
      message:
        'Command contains subexpressions, script blocks, or member invocations that require approval',
    }
  }
// 七个安全标志任一命中即拒绝自动放行：子表达式、脚本块、成员调用、splatting、赋值、停止解析符、可扩展字符串——acceptEdits 只该放行「纯写文件」这一种形状。

  const segments = getPipelineSegments(parsed)

  // SECURITY: Empty segments with valid parse = no commands to check, don't auto-allow
  if (segments.length === 0) {
    return {
      behavior: 'passthrough',
      message: 'No commands found to validate for acceptEdits mode',
    }
  }
// 解析成功但零命令=没东西可查——不自动放行，fail safe。

  // SECURITY: Compound cwd desync guard — BashTool parity.
  // When any statement in a compound contains Set-Location/Push-Location/Pop-Location
  // (or aliases like cd, sl, chdir, pushd, popd), the cwd changes between statements.
  // Path validation resolves relative paths against the stale process cwd, so a write
  // cmdlet in a later statement targets a different directory than the validator checked.
  // Example: `Set-Location ./.claude; Set-Content ./settings.json '...'` — the validator
  // sees ./settings.json as /project/settings.json, but PowerShell writes to
  // /project/.claude/settings.json. Refuse to auto-allow any write operation in a
  // compound that contains a cwd-changing command. This matches BashTool's
  // compoundCommandHasCd guard (BashTool/pathValidation.ts:630-655).
  const totalCommands = segments.reduce(
    (sum, seg) => sum + seg.commands.length,
    0,
  )
  if (totalCommands > 1) {
    let hasCdCommand = false
    let hasSymlinkCreate = false
    let hasWriteCommand = false
    for (const seg of segments) {
      for (const cmd of seg.commands) {
        if (cmd.elementType !== 'CommandAst') continue
        if (isCwdChangingCmdlet(cmd.name)) hasCdCommand = true
        if (isSymlinkCreatingCommand(cmd)) hasSymlinkCreate = true
        if (isAcceptEditsAllowedCmdlet(cmd.name)) hasWriteCommand = true
      }
    }
    if (hasCdCommand && hasWriteCommand) {
      return {
        behavior: 'passthrough',
        message:
          'Compound command contains a directory-changing command (Set-Location/Push-Location/Pop-Location) with a write operation — cannot auto-allow because path validation uses stale cwd',
      }
    }
    // SECURITY: Link-create compound guard (finding #18). Mirrors the cd
    // guard above. `New-Item -ItemType SymbolicLink -Path ./link -Value /etc;
    // Get-Content ./link/passwd` — path validation resolves ./link/passwd
    // against cwd (no link there at validation time), but runtime follows
    // the just-created link to /etc/passwd. Same TOCTOU shape as cwd desync.
    // Applies to SymbolicLink, Junction, and HardLink — all three redirect
    // path resolution at runtime.
    // No `hasWriteCommand` requirement: read-through-symlink is equally
    // dangerous (exfil via Get-Content ./link/etc/shadow), and any other
    // command using paths after a just-created link is unvalidatable.
    if (hasSymlinkCreate) {
      return {
        behavior: 'passthrough',
        message:
          'Compound command creates a filesystem link (New-Item -ItemType SymbolicLink/Junction/HardLink) — cannot auto-allow because path validation cannot follow just-created links',
      }
    }
  }
// 两个复合命令守卫：含 cd 类命令加写命令则拒（路径校验用的是过期 cwd，写入落点与校验点不同——TOCTOU；例子：Set-Location ./.claude 后写 ./settings.json 实际落在子目录里）；复合中刚创建符号链接则拒且不要求有写命令（读穿链接外传同样危险，如 Get-Content ./link/etc/shadow）。

  for (const segment of segments) {
    for (const cmd of segment.commands) {
      if (cmd.elementType !== 'CommandAst') {
        // SECURITY: This guard is load-bearing for THREE cases. Do not narrow it.
        //
        // 1. Expression pipeline sources (designed): '/etc/passwd' | Remove-Item
        //    — the string literal is CommandExpressionAst, piped value binds to
        //    -Path. We cannot statically know what path it represents.
        //
        // 2. Control-flow statements (accidental but relied upon):
        //    foreach ($x in ...) { Remove-Item $x }. Non-PipelineAst statements
        //    produce a synthetic CommandExpressionAst entry in segment.commands
        //    (parser.ts transformStatement). Without this guard, Remove-Item $x
        //    in nestedCommands would be checked below and auto-allowed — but $x
        //    is a loop-bound variable we cannot validate.
        //
        // 3. Non-PipelineAst redirection coverage (accidental): cmd && cmd2 > /tmp
        //    also produces a synthetic element here. isReadOnlyCommand relies on
        //    the same accident (its allowlist rejects the synthetic element's
        //    full-text name), so both paths fail safe together.
        return {
          behavior: 'passthrough',
          message: `Pipeline contains expression source (${cmd.elementType}) that cannot be statically validated`,
        }
      }
// 这道守卫承重三个用例：① 管道源头是表达式（字符串字面量管道给 -Path，静态无法知道路径）；② 控制流语句产生的合成元素（foreach 里 Remove-Item $x 的 $x 是循环变量）；③ 非管道语句的重定向覆盖——isReadOnlyCommand 依赖同一个 accident 一起 fail safe，两边谁都不能单独收窄。
      // SECURITY: nameType is computed from the raw name before stripModulePrefix.
      // 'application' = raw name had path chars (. \\ /). scripts\\Remove-Item
      // strips to Remove-Item and would match ACCEPT_EDITS_ALLOWED_CMDLETS below,
      // but PowerShell runs scripts\\Remove-Item.ps1. Same gate as isAllowlistedCommand.
      if (cmd.nameType === 'application') {
        return {
          behavior: 'passthrough',
          message: `Command '${cmd.name}' resolved from a path-like name and requires approval`,
        }
      }
// nameType 从剥模块前缀之前的原始名计算——scripts 加反斜杠加 Remove-Item 剥完前缀后名字与 cmdlet 相同，但 PowerShell 实际执行的是那个脚本文件；path-like 名一律要求人工批准。
      // SECURITY: elementTypes whitelist — same as isAllowlistedCommand.
      // deriveSecurityFlags above checks hasSubExpressions/etc. but does NOT
      // flag bare Variable/Other elementTypes. `Remove-Item $env:PATH`:
      //   elementTypes = ['StringConstant', 'Variable']
      //   deriveSecurityFlags: no subexpression → passes
      //   checkPathConstraints: resolves literal text '$env:PATH' as relative
      //     path → cwd/$env:PATH → inside cwd → allow
      //   RUNTIME: PowerShell expands $env:PATH → deletes actual env value path
      // isAllowlistedCommand rejects non-StringConstant/Parameter; this is the
      // acceptEdits parity gate.
      //
      // Also check colon-bound expression metachars (same as isAllowlistedCommand's
      // colon-bound check). `Remove-Item -Path:(1 > /tmp/x)`:
      //   elementTypes = ['StringConstant', 'Parameter'] — passes whitelist above
      //   deriveSecurityFlags: ParenExpressionAst in .Argument not detected by
      //     Get-SecurityPatterns (ParenExpressionAst not in FindAll filter)
      //   checkPathConstraints: literal text '-Path:(1 > /tmp/x)' not a path
      //   RUNTIME: paren evaluates, redirection writes /tmp/x → arbitrary write
      if (cmd.elementTypes) {
        for (let i = 1; i < cmd.elementTypes.length; i++) {
          const t = cmd.elementTypes[i]
          if (t !== 'StringConstant' && t !== 'Parameter') {
            return {
              behavior: 'passthrough',
              message: `Command argument has unvalidatable type (${t}) — variable paths cannot be statically resolved`,
            }
          }
          if (t === 'Parameter') {
            // elementTypes[i] ↔ args[i-1] (elementTypes[0] is the command name).
            const arg = cmd.args[i - 1] ?? ''
            const colonIdx = arg.indexOf(':')
            if (colonIdx > 0 && /[$(@{[]/.test(arg.slice(colonIdx + 1))) {
              return {
                behavior: 'passthrough',
                message:
                  'Colon-bound parameter contains an expression that cannot be statically validated',
              }
            }
          }
        }
      }
// 逐参数类型白名单（只许 StringConstant 与 Parameter）加冒号绑定表达式元字符检查。典型绕过：Remove-Item $env:PATH 的字面文本在校验期被当相对路径「成功」解析进 cwd，运行时才展开变量——按类型拒才是唯一可靠判断。
      // Safe output cmdlets (Out-Null, etc.) and allowlisted pipeline-tail
      // transformers (Format-*, Measure-Object, Select-Object, etc.) don't
      // affect the semantics of the preceding command. Skip them so
      // `Remove-Item ./foo | Out-Null` or `Set-Content ./foo hi | Format-Table`
      // auto-allows the same as the bare write cmdlet. isAllowlistedPipelineTail
      // is the narrow fallback for cmdlets moved from SAFE_OUTPUT_CMDLETS to
      // CMDLET_ALLOWLIST (argLeaksValue validates their args).
      if (
        isSafeOutputCommand(cmd.name) ||
        isAllowlistedPipelineTail(cmd, input.command)
      ) {
        continue
      }
      if (!isAcceptEditsAllowedCmdlet(cmd.name)) {
        return {
          behavior: 'passthrough',
          message: `No mode-specific handling for '${cmd.name}' in acceptEdits mode`,
        }
      }
      // SECURITY: Reject commands with unclassifiable argument types. 'Other'
      // covers HashtableAst, ConvertExpressionAst, BinaryExpressionAst — all
      // can contain nested redirections or code that the parser cannot fully
      // decompose. isAllowlistedCommand (readOnlyValidation.ts) already
      // enforces this whitelist via argLeaksValue; this closes the same gap
      // in acceptEdits mode. Without this, @{k='payload' > ~/.bashrc} as a
      // -Value argument passes because HashtableAst maps to 'Other'.
      // argLeaksValue also catches colon-bound variables (-Flag:$env:SECRET).
      if (argLeaksValue(cmd.name, cmd)) {
        return {
          behavior: 'passthrough',
          message: `Arguments in '${cmd.name}' cannot be statically validated in acceptEdits mode`,
        }
      }
// argLeaksValue 在 acceptEdits 关掉同一批缺口：Hashtable 等不可分类参数类型（可夹带重定向）、冒号绑定变量（-Flag:$env:SECRET）。与 readOnlyValidation 共用同一实现。
    }

    // Also check nested commands from control flow statements
    if (segment.nestedCommands) {
      for (const cmd of segment.nestedCommands) {
        if (cmd.elementType !== 'CommandAst') {
          // SECURITY: Same as above — non-CommandAst element in nested commands
          // (control flow bodies) cannot be statically validated as a path source.
          return {
            behavior: 'passthrough',
            message: `Nested expression element (${cmd.elementType}) cannot be statically validated`,
          }
        }
        if (cmd.nameType === 'application') {
          return {
            behavior: 'passthrough',
            message: `Nested command '${cmd.name}' resolved from a path-like name and requires approval`,
          }
        }
        if (
          isSafeOutputCommand(cmd.name) ||
          isAllowlistedPipelineTail(cmd, input.command)
        ) {
          continue
        }
        if (!isAcceptEditsAllowedCmdlet(cmd.name)) {
          return {
            behavior: 'passthrough',
            message: `No mode-specific handling for '${cmd.name}' in acceptEdits mode`,
          }
        }
        // SECURITY: Same argLeaksValue check as the main command loop above.
        if (argLeaksValue(cmd.name, cmd)) {
          return {
            behavior: 'passthrough',
            message: `Arguments in nested '${cmd.name}' cannot be statically validated in acceptEdits mode`,
          }
        }
      }
    }
  }

  // All commands are filesystem-modifying cmdlets -- auto-allow
  return {
    behavior: 'allow',
    updatedInput: input,
    decisionReason: {
      type: 'mode',
      mode: 'acceptEdits',
    },
  }
}
// 全部通过才 allow——这是白名单模式的极端形态：任何看不懂的形状都落回 ask，宁多问不放行。
