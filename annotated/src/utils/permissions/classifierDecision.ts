import { feature } from 'bun:bundle'
// 自动模式（auto/yolo）的分类器决策辅助：核心是一份「免分类白名单」，命中即跳过 API 调用直接放行。
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from '../../tools/EnterPlanModeTool/constants.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from '../../tools/ExitPlanModeTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { LIST_MCP_RESOURCES_TOOL_NAME } from '../../tools/ListMcpResourcesTool/prompt.js'
import { LSP_TOOL_NAME } from '../../tools/LSPTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from '../../tools/SendMessageTool/constants.js'
import { SLEEP_TOOL_NAME } from '../../tools/SleepTool/prompt.js'
import { TASK_CREATE_TOOL_NAME } from '../../tools/TaskCreateTool/constants.js'
import { TASK_GET_TOOL_NAME } from '../../tools/TaskGetTool/constants.js'
import { TASK_LIST_TOOL_NAME } from '../../tools/TaskListTool/constants.js'
import { TASK_OUTPUT_TOOL_NAME } from '../../tools/TaskOutputTool/constants.js'
import { TASK_STOP_TOOL_NAME } from '../../tools/TaskStopTool/prompt.js'
import { TASK_UPDATE_TOOL_NAME } from '../../tools/TaskUpdateTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '../../tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '../../tools/TeamDeleteTool/constants.js'
import { TODO_WRITE_TOOL_NAME } from '../../tools/TodoWriteTool/constants.js'
import { TOOL_SEARCH_TOOL_NAME } from '../../tools/ToolSearchTool/prompt.js'
import { YOLO_CLASSIFIER_TOOL_NAME } from './yoloClassifier.js'
// yoloClassifier 自身的工具名也进白名单：分类器调用不该再被分类一次，否则会无限递归。

// Ant-only tool names: conditional require so Bun can DCE these in external builds.
// Gates mirror tools.ts. Keeps the tool name strings out of cli.js.
// Ant 专有工具用条件 require 而不是静态 import：Bun 打包时能把整段连同工具名一起 DCE 掉，外部构建的 cli.js 里不会残留这些字符串。
/* eslint-disable @typescript-eslint/no-require-imports */
const TERMINAL_CAPTURE_TOOL_NAME = feature('TERMINAL_PANEL')
  ? (
      require('../../tools/TerminalCaptureTool/prompt.js') as typeof import('../../tools/TerminalCaptureTool/prompt.js')
    ).TERMINAL_CAPTURE_TOOL_NAME
  : null
const OVERFLOW_TEST_TOOL_NAME = feature('OVERFLOW_TEST_TOOL')
  ? (
      require('../../tools/OverflowTestTool/OverflowTestTool.js') as typeof import('../../tools/OverflowTestTool/OverflowTestTool.js')
    ).OVERFLOW_TEST_TOOL_NAME
  : null
const VERIFY_PLAN_EXECUTION_TOOL_NAME =
  process.env.USER_TYPE === 'ant'
    ? (
        require('../../tools/VerifyPlanExecutionTool/constants.js') as typeof import('../../tools/VerifyPlanExecutionTool/constants.js')
      ).VERIFY_PLAN_EXECUTION_TOOL_NAME
    : null
const WORKFLOW_TOOL_NAME = feature('WORKFLOW_SCRIPTS')
  ? (
      require('../../tools/WorkflowTool/constants.js') as typeof import('../../tools/WorkflowTool/constants.js')
    ).WORKFLOW_TOOL_NAME
  : null
// 四个 Ant 专有工具的选择都遵循「feature 开关或环境判断命中才 require」的写法，未命中时值为 null。
/* eslint-enable @typescript-eslint/no-require-imports */
// enable 之后立刻恢复 lint 规则：这一段是唯一的例外区，防止后续代码跟风用 require 逃过静态检查。

/**
 * Tools that are safe and don't need any classifier checking.
 * Used by the auto mode classifier to skip unnecessary API calls.
 * Does NOT include write/edit tools — those are handled by the
 * acceptEdits fast path (allowed in CWD, classified outside CWD).
 */
const SAFE_YOLO_ALLOWLISTED_TOOLS = new Set([
  // Read-only file operations
  FILE_READ_TOOL_NAME,
  // Search / read-only
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  LSP_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  LIST_MCP_RESOURCES_TOOL_NAME,
  'ReadMcpResourceTool', // no exported constant
  // Task management (metadata only)
  TODO_WRITE_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  TASK_OUTPUT_TOOL_NAME,
  // Plan mode / UI
  ASK_USER_QUESTION_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  // Swarm coordination (internal mailbox/team state only — teammates have
  // their own permission checks, so no actual security bypass).
  TEAM_CREATE_TOOL_NAME,
  // Agent cleanup
  TEAM_DELETE_TOOL_NAME,
  SEND_MESSAGE_TOOL_NAME,
  // Workflow orchestration — subagents go through canUseTool individually
  ...(WORKFLOW_TOOL_NAME ? [WORKFLOW_TOOL_NAME] : []),
  // Misc safe
  SLEEP_TOOL_NAME,
  // Ant-only safe tools (gates mirror tools.ts)
  ...(TERMINAL_CAPTURE_TOOL_NAME ? [TERMINAL_CAPTURE_TOOL_NAME] : []),
  ...(OVERFLOW_TEST_TOOL_NAME ? [OVERFLOW_TEST_TOOL_NAME] : []),
  ...(VERIFY_PLAN_EXECUTION_TOOL_NAME ? [VERIFY_PLAN_EXECUTION_TOOL_NAME] : []),
  // Internal classifier tool
  YOLO_CLASSIFIER_TOOL_NAME,
])
// 白名单只收只读或纯元数据类工具：写文件、改文件一律不收，它们由 acceptEdits 快路径处理——工作目录内放行，目录外仍要过分类器。

export function isAutoModeAllowlistedTool(toolName: string): boolean {
  return SAFE_YOLO_ALLOWLISTED_TOOLS.has(toolName)
}
// 对外只暴露一个 has 查询：集合是模块私有的，调用方无法增删，白名单的任何变更都必须回到源码里审。
