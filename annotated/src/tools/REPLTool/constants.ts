import { isEnvDefinedFalsy, isEnvTruthy } from '../../utils/envUtils.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../NotebookEditTool/constants.js'

export const REPL_TOOL_NAME = 'REPL'
// REPL 工具名：REPL 模式下 Claude 不再直接调用底层工具，
// 而是通过 REPL 工具在 VM 上下文里写 JS 批量组合这些原语。

/**
 * REPL mode is default-on for ants in the interactive CLI (opt out with
 * CLAUDE_CODE_REPL=0). The legacy CLAUDE_REPL_MODE=1 also forces it on.
 *
 * SDK entrypoints (sdk-ts, sdk-py, sdk-cli) are NOT defaulted on — SDK
 * consumers script direct tool calls (Bash, Read, etc.) and REPL mode
 * hides those tools. USER_TYPE is a build-time --define, so the ant-native
 * binary would otherwise force REPL mode on every SDK subprocess regardless
 * of the env the caller passes.
 */
// isReplModeEnabled：REPL 模式开关判定。
// 内部员工（USER_TYPE=ant）交互 CLI 默认开（CLAUDE_CODE_REPL=0 可关）；遗留变量 CLAUDE_REPL_MODE=1 强制开。
export function isReplModeEnabled(): boolean {
  if (isEnvDefinedFalsy(process.env.CLAUDE_CODE_REPL)) return false
  if (isEnvTruthy(process.env.CLAUDE_REPL_MODE)) return true
  return (
    process.env.USER_TYPE === 'ant' &&
    process.env.CLAUDE_CODE_ENTRYPOINT === 'cli'
  )
}
// SDK 入口（sdk-ts / sdk-py / sdk-cli）不默认开：SDK 用户习惯直接脚本化调用 Bash/Read，
// REPL 模式会把那些工具藏起来。USER_TYPE 是构建期 --define 常量，若不看 ENTRYPOINT，
// ant 原生二进制会强制每个 SDK 子进程都开 REPL——所以这里要求 entrypoint 必须是 cli。

/**
 * Tools that are only accessible via REPL when REPL mode is enabled.
 * When REPL mode is on, these tools are hidden from Claude's direct use,
 * forcing Claude to use REPL for batch operations.
 */
// REPL_ONLY_TOOLS：REPL 模式开启后对模型隐藏、只能进 REPL VM 用的原语工具清单
// （Read/Write/Edit/Glob/Grep/Bash/NotebookEdit/Agent）。
export const REPL_ONLY_TOOLS = new Set([
  FILE_READ_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  BASH_TOOL_NAME,
  NOTEBOOK_EDIT_TOOL_NAME,
  AGENT_TOOL_NAME,
])
// 清单到此为止。隐藏这些工具逼迫 Claude 用 REPL 做批量操作
// （一次 VM 执行可组合多次 Read+Edit），减少工具调用轮次。
