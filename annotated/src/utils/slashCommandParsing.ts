// 斜杠命令的解析入口，被各处共用：把一段以斜杠开头的原始输入拆成「命令名 + 参数字符串 + 是否 MCP 命令」三部分。拆得很浅，只按空格切一次，不做引号与转义处理——因为参数最终原样交给命令自己解析。
/**
 * Centralized utilities for parsing slash commands
 */

export type ParsedSlashCommand = {
  commandName: string
  args: string
  isMcp: boolean
}
// 返回值里参数是整串而不是数组，这符合「命令自己决定怎么分词」的分工；是否 MCP 单独给一个布尔，省得调用方去判断命令名里有没有那个后缀。

/**
 * Parses a slash command input string into its component parts
 *
 * @param input - The raw input string (should start with '/')
 * @returns Parsed command name, args, and MCP flag, or null if invalid
 *
 * @example
 * parseSlashCommand('/search foo bar')
 * // => { commandName: 'search', args: 'foo bar', isMcp: false }
 *
 * @example
 * parseSlashCommand('/mcp:tool (MCP) arg1 arg2')
 * // => { commandName: 'mcp:tool (MCP)', args: 'arg1 arg2', isMcp: true }
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmedInput = input.trim()

  // Check if input starts with '/'
  if (!trimmedInput.startsWith('/')) {
    return null
  }
// 不以斜杠开头直接返回空值，这是唯一的结构性拒绝。注意先做了首尾去空格，所以前后留空不影响判定。

  // Remove the leading '/' and split by spaces
  const withoutSlash = trimmedInput.slice(1)
  const words = withoutSlash.split(' ')

  if (!words[0]) {
    return null
  }
// 去掉斜杠后再切分，第一个词为空说明输入是「只有一个斜杠」或者「斜杠后紧跟空格」，同样返回空值。这两处早退合起来保证后面拿到的命令名一定非空。

  let commandName = words[0]
  let isMcp = false
  let argsStartIndex = 1

  // Check for MCP commands (second word is '(MCP)')
  if (words.length > 1 && words[1] === '(MCP)') {
    commandName = commandName + ' (MCP)'
    isMcp = true
    argsStartIndex = 2
  }
// MCP 命令的识别规则是「第二个词恰好是那个带括号的标记」：命中就把标记并回命令名，并把参数起点后移一位。之所以用固定字符串而不是正则，是因为这个标记由本程序自己生成，格式完全可控。

  // Extract arguments (everything after command name)
  const args = words.slice(argsStartIndex).join(' ')

  return {
    commandName,
    args,
    isMcp,
  }
}
// 参数由剩余词重新拼回空格分隔的串。这里有一处有意的宽松：多个连续空格会被压成一个，因为切分时产生的空串在重新拼接后会消失。对命令参数而言，这种归一化通常无害，但不适合需要保留原始空白的场景。
