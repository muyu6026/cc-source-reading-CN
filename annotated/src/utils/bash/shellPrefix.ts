// 文件级批注：`shellPrefix.ts` 把形如「可执行路径加参数」的 shell 前缀字符串拆开，对可执行路径与待执行命令分别加引号后拼回，避免路径含空格时破裂。
import { quote } from './shellQuote.js'

/**
 * Parses a shell prefix that may contain an executable path and arguments.
 *
 * Examples:
 * - "bash" -> quotes as 'bash'
 * - "/usr/bin/bash -c" -> quotes as '/usr/bin/bash' -c
 * - "C:\Program Files\Git\bin\bash.exe -c" -> quotes as 'C:\Program Files\Git\bin\bash.exe' -c
 *
 * @param prefix The shell prefix string containing executable and optional arguments
 * @param command The command to be executed
 * @returns The properly formatted command string with quoted components
 */
// 函数签名：`formatShellPrefixCommand` 接收前缀串与命令串，按「最后一个空格后接短横线参数」切分可执行路径与参数。
export function formatShellPrefixCommand(
  prefix: string,
  command: string,
): string {
  // Split on the last space before a dash to separate executable from arguments
  const spaceBeforeDash = prefix.lastIndexOf(' -')
  if (spaceBeforeDash > 0) {
    const execPath = prefix.substring(0, spaceBeforeDash)
    const args = prefix.substring(spaceBeforeDash + 1)
    return `${quote([execPath])} ${args} ${quote([command])}`
  } else {
    return `${quote([prefix])} ${quote([command])}`
  }
}
// 函数收尾：若前缀含 ` -` 则拆成「可执行路径、参数、命令」三段分别加引号拼接；否则整段前缀与命令各加引号拼接。
