/**
 * Command semantics configuration for interpreting exit codes in PowerShell.
 *
 * PowerShell-native cmdlets do NOT need exit-code semantics:
 *   - Select-String (grep equivalent) exits 0 on no-match (returns $null)
 *   - Compare-Object (diff equivalent) exits 0 regardless
 *   - Test-Path exits 0 regardless (returns bool via pipeline)
 * Native cmdlets signal failure via terminating errors ($?), not exit codes.
 *
 * However, EXTERNAL executables invoked from PowerShell DO set $LASTEXITCODE,
 * and many use non-zero codes to convey information rather than failure:
 *   - grep.exe / rg.exe (Git for Windows, scoop, etc.): 1 = no match
 *   - findstr.exe (Windows native): 1 = no match
 *   - robocopy.exe (Windows native): 0-7 = success, 8+ = error (notorious!)
 *
 * Without this module, PowerShellTool throws ShellError on any non-zero exit,
 * so `robocopy` reporting "files copied successfully" (exit 1) shows as an error.
 */
// 核心洞察：PowerShell 原生 cmdlet 用终止性错误（$?）报错、退出码恒为 0；但外部 exe 会设 $LASTEXITCODE，且很多用非零码传递信息而非失败——grep 退出 1 是无匹配，robocopy 退出 1 是复制成功。没有这个模块，robocopy 报告成功也会被当成 ShellError 抛出。

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}

/**
 * Default semantic: treat only 0 as success, everything else as error
 */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})
// 默认语义只有 0 算成功——白名单之外的命令一律从严。

/**
 * grep / ripgrep: 0 = matches found, 1 = no matches, 2+ = error
 */
const GREP_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'No matches found' : undefined,
})
// grep/rg/findstr 共用一套语义：退出码 1 是「无匹配」不是错误，2 及以上才是错——与 BashTool 对 grep 的处理对齐。

/**
 * Command-specific semantics for external executables.
 * Keys are lowercase command names WITHOUT .exe suffix.
 *
 * Deliberately omitted:
 *   - 'diff': Ambiguous. Windows PowerShell 5.1 aliases `diff` → Compare-Object
 *     (exit 0 on differ), but PS Core / Git for Windows may resolve to diff.exe
 *     (exit 1 on differ). Cannot reliably interpret.
 *   - 'fc': Ambiguous. PowerShell aliases `fc` → Format-Custom (a native cmdlet),
 *     but `fc.exe` is the Windows file compare utility (exit 1 = files differ).
 *     Same aliasing problem as `diff`.
 *   - 'find': Ambiguous. Windows find.exe (text search) vs Unix find.exe
 *     (file search via Git for Windows) have different semantics.
 *   - 'test', '[': Not PowerShell constructs.
 *   - 'select-string', 'compare-object', 'test-path': Native cmdlets exit 0.
 */
// 刻意省略 diff/fc/find 三个名字：Windows PowerShell 5.1 的别名会把它们解析到 cmdlet（如 diff 指向 Compare-Object、fc 指向 Format-Custom），而 PS Core 或 Git 环境可能解析到同名 exe——退出码语义完全不同，无法可靠判定就不判定，退化到默认语义。
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // External grep/ripgrep (Git for Windows, scoop, choco)
  ['grep', GREP_SEMANTIC],
  ['rg', GREP_SEMANTIC],

  // findstr.exe: Windows native text search
  // 0 = match found, 1 = no match, 2 = error
  ['findstr', GREP_SEMANTIC],

  // robocopy.exe: Windows native robust file copy
  // Exit codes are a BITFIELD — 0-7 are success, 8+ indicates at least one failure:
  //   0 = no files copied, no mismatch, no failures (already in sync)
  //   1 = files copied successfully
  //   2 = extra files/dirs detected (no copy)
  //   4 = mismatched files/dirs detected
  //   8 = some files/dirs could not be copied (copy errors)
  //  16 = serious error (robocopy did not copy any files)
  // This is the single most common "CI failed but nothing's wrong" Windows gotcha.
  [
    'robocopy',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 8,
      message:
        exitCode === 0
          ? 'No files copied (already in sync)'
          : exitCode >= 1 && exitCode < 8
            ? exitCode & 1
              ? 'Files copied successfully'
              : 'Robocopy completed (no errors)'
            : undefined,
    }),
  ],
])
// robocopy 的退出码是位掩码：0-7 都是成功（1=复制了文件、2=发现多余文件、4=有不匹配），8 及以上才至少有一个失败。注释直言这是「CI 失败但其实没事」的头号 Windows 坑。

/**
 * Extract the command name from a single pipeline segment.
 * Strips leading `&` / `.` call operators and `.exe` suffix, lowercases.
 */
function extractBaseCommand(segment: string): string {
  // Strip PowerShell call operators: & "cmd", . "cmd"
  // (& and . at segment start followed by whitespace invoke the next token)
  const stripped = segment.trim().replace(/^[&.]\s+/, '')
  const firstToken = stripped.split(/\s+/)[0] || ''
  // Strip surrounding quotes if command was invoked as & "grep.exe"
  const unquoted = firstToken.replace(/^["']|["']$/g, '')
  // Strip path: C:\bin\grep.exe → grep.exe, .\rg.exe → rg.exe
  const basename = unquoted.split(/[\\/]/).pop() || unquoted
  // Strip .exe suffix (Windows is case-insensitive)
  return basename.toLowerCase().replace(/\.exe$/, '')
}
// 四步归一化：剥调用操作符（& 与 .）、剥引号、剥路径取 basename、剥 .exe 后缀并小写——& "C:\bin\grep.exe" 最终归一成 grep。

/**
 * Extract the primary command from a PowerShell command line.
 * Takes the LAST pipeline segment since that determines the exit code.
 *
 * Heuristic split on `;` and `|` — may get it wrong for quoted strings or
 * complex constructs. Do NOT depend on this for security; it's only used
 * for exit-code interpretation (false negatives just fall back to default).
 */
// 取最后一个管道段——退出码由最后一段决定。注释明说这是启发式：引号里的分号可能切错段，但它只用于退出码解释，切错只会退化到默认语义（更严），绝不能拿去做安全判断。
function heuristicallyExtractBaseCommand(command: string): string {
  const segments = command.split(/[;|]/).filter(s => s.trim())
  const last = segments[segments.length - 1] || command
  return extractBaseCommand(last)
}

/**
 * Interpret command result based on semantic rules
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC
  return semantic(exitCode, stdout, stderr)
}
// 查表命中用专用语义，未命中用默认——查不到不会出错、只会更严。
