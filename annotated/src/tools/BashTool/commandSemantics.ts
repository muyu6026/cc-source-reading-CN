/**
 * Command semantics configuration for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 */
// 退出码语义表：很多命令用退出码传信息而不是成败。grep 返回 1 = 没匹配，这不是错误——把退出码一律当失败的 UI 会满屏假红。

import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'

export type CommandSemantic = (
// CommandSemantic 签名：(exitCode, stdout, stderr) → { isError, message? }。stdout/stderr 参数大部分语义函数没收（下划线前缀），留给将来需要输出内容的判断。
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
// DEFAULT_SEMANTIC：只有 0 算成功。
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

/**
 * Command-specific semantics
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
// COMMAND_SEMANTICS 按基名查。注意没有管道感知——管道命令的退出码取哪段由调用方决定（见下面启发式提取）。
  // grep: 0=matches found, 1=no matches, 2+=error
// grep/rg：0=有匹配，1=无匹配（给人类消息 No matches found），2+=真错误。
  [
    'grep',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],

  // ripgrep has same semantics as grep
  [
    'rg',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'No matches found' : undefined,
    }),
  ],

  // find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
// find：1=部分目录不可访问（常见，如权限拒绝），不当错误。
  [
    'find',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message:
        exitCode === 1 ? 'Some directories were inaccessible' : undefined,
    }),
  ],

  // diff: 0=no differences, 1=differences found, 2+=error
// diff：1=文件有差异（这是 diff 的正常用途！），不当错误。
  [
    'diff',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Files differ' : undefined,
    }),
  ],

  // test/[: 0=condition true, 1=condition false, 2+=error
// test/[: 1=条件为假——test 的全部意义就在退出码里，1 是正常答案。
  [
    'test',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],

  // [ is an alias for test
  [
    '[',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Condition is false' : undefined,
    }),
  ],

  // wc, head, tail, cat, etc.: these typically only fail on real errors
  // so we use default semantics
// wc/head/tail/cat 等用默认语义（它们只会在真错误时失败）。
])

/**
 * Get the semantic interpretation for a command
 */
function getCommandSemantic(command: string): CommandSemantic {
  // Extract the base command (first word, handling pipes)
  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand)
  return semantic !== undefined ? semantic : DEFAULT_SEMANTIC
}

/**
 * Extract just the command name (first word) from a single command string.
 */
// extractBaseCommand：取第一个词。**函数注释自己承认 May get it super wrong - don't depend this for security**——仅供展示层解释退出码。
function extractBaseCommand(command: string): string {
  return command.trim().split(/\s+/)[0] || ''
}

/**
 * Extract the primary command from a complex command line;
 * May get it super wrong - don't depend on this for security
 */
// 启发式取管道**最后一段**的基名：shell 默认把最后一段的退出码当整条管道退出码。
function heuristicallyExtractBaseCommand(command: string): string {
  const segments = splitCommand_DEPRECATED(command)

  // Take the last command as that's what determines the exit code
  const lastCommand = segments[segments.length - 1] || command

  return extractBaseCommand(lastCommand)
}

/**
 * Interpret command result based on semantic rules
 */
// interpretCommandResult 是出口：command → 语义函数 → isError/message。BashToolResultMessage 的 returnCodeInterpretation 字段由它填。
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  const semantic = getCommandSemantic(command)
  const result = semantic(exitCode, stdout, stderr)

  return {
    isError: result.isError,
    message: result.message,
  }
}
