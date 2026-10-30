import { quote } from './shellQuote.js'
// 模块摘要：对 shell 命令做「安全引用」——在保留 heredoc 与多行字符串的前提下正确加引号，并检测/改写 stdin 重定向与 Windows 的 >nul 误写。

/**
 * Detects if a command contains a heredoc pattern
 * Matches patterns like: <<EOF, <<'EOF', <<"EOF", <<-EOF, <<-'EOF', <<\EOF, etc.
 */
// 检测命令是否含 heredoc（<<EOF 等），同时排除位运算左移（如 1 << 2）造成的误判。
function containsHeredoc(command: string): boolean {
  // Match heredoc patterns: << followed by optional -, then optional quotes or backslash, then word
  // Matches: <<EOF, <<'EOF', <<"EOF", <<-EOF, <<-'EOF', <<\EOF
  // Check for bit-shift operators first and exclude them
  if (
    /\d\s*<<\s*\d/.test(command) ||
    /\[\[\s*\d+\s*<<\s*\d+\s*\]\]/.test(command) ||
    /\$\(\(.*<<.*\)\)/.test(command)
  ) {
    return false
  }

  // Now check for heredoc patterns
  const heredocRegex = /<<-?\s*(?:(['"]?)(\w+)\1|\\(\w+))/
  return heredocRegex.test(command)
}

/**
 * Detects if a command contains multiline strings in quotes
 */
// 检测引号字符串里是否真的跨了多行（处理转义引号），用于决定是否能安全地整体加引号。
function containsMultilineString(command: string): boolean {
  // Check for strings with actual newlines in them
  // Handle escaped quotes by using a more sophisticated pattern
  // Match single quotes: '...\n...' where content can include escaped quotes \'
  // Match double quotes: "...\n..." where content can include escaped quotes \"
  const singleQuoteMultiline = /'(?:[^'\\]|\\.)*\n(?:[^'\\]|\\.)*'/
  const doubleQuoteMultiline = /"(?:[^"\\]|\\.)*\n(?:[^"\\]|\\.)*"/

  return (
    singleQuoteMultiline.test(command) || doubleQuoteMultiline.test(command)
  )
}

/**
 * Quotes a shell command appropriately, preserving heredocs and multiline strings
 * @param command The command to quote
 * @param addStdinRedirect Whether to add < /dev/null
 * @returns The properly quoted command
 */
// 对外主函数：按命令类型选择合适的引用方式，保留 heredoc 与多行字符串；参数 addStdinRedirect 决定是否追加 < /dev/null。
export function quoteShellCommand(
  command: string,
  addStdinRedirect: boolean = true,
): string {
// 若含 heredoc 或多行字符串，走特殊路径（shell-quote 库会错误地把感叹号转义）。
  // If command contains heredoc or multiline strings, handle specially
  // The shell-quote library incorrectly escapes ! to \! in these cases
  if (containsHeredoc(command) || containsMultilineString(command)) {
// 若含 heredoc 或多行字符串，用单引号包裹，仅把命令里的单引号转义为 ''' 形式。
    // For heredocs and multiline strings, we need to quote for eval
    // but avoid shell-quote's aggressive escaping
    // We'll use single quotes and escape only single quotes in the command
    const escaped = command.replace(/'/g, "'\"'\"'")
    const quoted = `'${escaped}'`

    // Don't add stdin redirect for heredocs as they provide their own input
    if (containsHeredoc(command)) {
      return quoted
    }

    // For multiline strings without heredocs, add stdin redirect if needed
    return addStdinRedirect ? `${quoted} < /dev/null` : quoted
  }

  // For regular commands, use shell-quote
// 普通命令直接用 shell-quote 库加引号（库能正确处理多数转义）。
  if (addStdinRedirect) {
    return quote([command, '<', '/dev/null'])
  }

  return quote([command])
}

/**
 * Detects if a command already has a stdin redirect
 * Match patterns like: < file, </path/to/file, < /dev/null, etc.
 * But not <<EOF (heredoc), << (bit shift), or <(process substitution)
 */
// 检测命令是否已有 stdin 重定向（< file 等），但排除 <<（heredoc）、<（位移）、<(进程替换）。
export function hasStdinRedirect(command: string): boolean {
  // Look for < followed by whitespace and a filename/path
  // Negative lookahead to exclude: <<, <(
  // Must be preceded by whitespace or command separator or start of string
  return /(?:^|[\s;&|])<(?![<(])\s*\S+/.test(command)
}

/**
 * Checks if stdin redirect should be added to a command
 * @param command The command to check
 * @returns true if stdin redirect can be safely added
 */
// 判断能否安全加 stdin 重定向：heredoc 不加（会干扰结束符），命令已有重定向也不加，其余一般安全。
export function shouldAddStdinRedirect(command: string): boolean {
  // Don't add stdin redirect for heredocs as it interferes with the heredoc terminator
  if (containsHeredoc(command)) {
    return false
  }

  // Don't add stdin redirect if command already has one
  if (hasStdinRedirect(command)) {
    return false
  }

  // For other commands, stdin redirect is generally safe
  return true
}

/**
 * Rewrites Windows CMD-style `>nul` redirects to POSIX `/dev/null`.
 *
 * The model occasionally hallucinates Windows CMD syntax (e.g., `ls 2>nul`)
 * even though our bash shell is always POSIX (Git Bash / WSL on Windows).
 * When Git Bash sees `2>nul`, it creates a literal file named `nul` — a
 * Windows reserved device name that is extremely hard to delete and breaks
 * `git add .` and `git clone`. See anthropics/claude-code#4928.
 *
 * Matches: `>nul`, `> NUL`, `2>nul`, `&>nul`, `>>nul` (case-insensitive)
 * Does NOT match: `>null`, `>nullable`, `>nul.txt`, `cat nul.txt`
 *
 * Limitation: this regex does not parse shell quoting, so `echo ">nul"`
 * will also be rewritten. This is acceptable collateral — it's extremely
 * rare and rewriting to `/dev/null` inside a string is harmless.
 */
// 把 Windows CMD 风格的 >nul 重定向改写成 POSIX 的 /dev/null——模型偶尔会幻觉出 >nul，在 Git Bash 下会变成名为 nul 的难删文件（见 issue #4928）；正则不匹配 >null、>nul.txt 等。
const NUL_REDIRECT_REGEX = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g

export function rewriteWindowsNullRedirect(command: string): string {
// 真正执行替换的函数：把匹配到的 >nul 段替换为 /dev/null。
  return command.replace(NUL_REDIRECT_REGEX, '$1/dev/null')
}
