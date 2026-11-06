// XML tag names used to mark skill/command metadata in messages
// 本文件集中定义消息里用的 XML 标签名：命令或技能元数据、终端输入输出、任务通知等。
export const COMMAND_NAME_TAG = 'command-name'
export const COMMAND_MESSAGE_TAG = 'command-message'
export const COMMAND_ARGS_TAG = 'command-args'

// 命令元数据三标签：command-name、command-message、command-args。
// XML tag names for terminal/bash command input and output in user messages
// These wrap content that represents terminal activity, not actual user prompts
export const BASH_INPUT_TAG = 'bash-input'
export const BASH_STDOUT_TAG = 'bash-stdout'
export const BASH_STDERR_TAG = 'bash-stderr'
export const LOCAL_COMMAND_STDOUT_TAG = 'local-command-stdout'
export const LOCAL_COMMAND_STDERR_TAG = 'local-command-stderr'
export const LOCAL_COMMAND_CAVEAT_TAG = 'local-command-caveat'
// 终端输出标签组：bash 与本地命令的 input、stdout、stderr、caveat，区分真用户提示与终端活动。

// All terminal-related tags that indicate a message is terminal output, not a user prompt
export const TERMINAL_OUTPUT_TAGS = [
  BASH_INPUT_TAG,
  BASH_STDOUT_TAG,
  BASH_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
] as const
// TERMINAL_OUTPUT_TAGS：把六个终端标签聚成常量数组，判断「这是终端输出而非用户提示」时直接 includes。

export const TICK_TAG = 'tick'
// TICK_TAG：心跳或计时标签。

// XML tag names for task notifications (background task completions)
export const TASK_NOTIFICATION_TAG = 'task-notification'
export const TASK_ID_TAG = 'task-id'
export const TOOL_USE_ID_TAG = 'tool-use-id'
export const TASK_TYPE_TAG = 'task-type'
export const OUTPUT_FILE_TAG = 'output-file'
export const STATUS_TAG = 'status'
export const SUMMARY_TAG = 'summary'
export const REASON_TAG = 'reason'
export const WORKTREE_TAG = 'worktree'
// 任务通知标签组：task-notification 领衔，附 task-id、tool-use-id、type、output-file、status、summary、reason、worktree 等。
export const WORKTREE_PATH_TAG = 'worktreePath'
export const WORKTREE_BRANCH_TAG = 'worktreeBranch'

// XML tag names for ultraplan mode (remote parallel planning sessions)
export const ULTRAPLAN_TAG = 'ultraplan'
// ULTRAPLAN_TAG：远程并行规划会话的包裹标签。

// XML tag name for remote /review results (teleported review session output).
// Remote session wraps its final review in this tag; local poller extracts it.
export const REMOTE_REVIEW_TAG = 'remote-review'
// REMOTE_REVIEW_TAG：远端 slash review 结果标签，本地轮询器据此抽取。

// run_hunt.sh's heartbeat echoes the orchestrator's progress.json inside this
// tag every ~10s. Local poller parses the latest for the task-status line.
export const REMOTE_REVIEW_PROGRESS_TAG = 'remote-review-progress'
// REMOTE_REVIEW_PROGRESS_TAG：run_hunt 心跳每约十秒把进度写进这个标签，本地解析最新值。

// XML tag name for teammate messages (swarm inter-agent communication)
export const TEAMMATE_MESSAGE_TAG = 'teammate-message'
// TEAMMATE_MESSAGE_TAG：swarm 队友间通信标签。

// XML tag name for external channel messages
export const CHANNEL_MESSAGE_TAG = 'channel-message'
export const CHANNEL_TAG = 'channel'
// CHANNEL_MESSAGE_TAG：外部频道消息标签。

// XML tag name for cross-session UDS messages (another Claude session's inbox)
export const CROSS_SESSION_MESSAGE_TAG = 'cross-session-message'
// CROSS_SESSION_MESSAGE_TAG：跨会话 UDS 消息（另一个 Claude 会话的收件箱）标签。

// XML tag wrapping the rules/format boilerplate in a fork child's first message.
// Lets the transcript renderer collapse the boilerplate and show only the directive.
export const FORK_BOILERPLATE_TAG = 'fork-boilerplate'
// FORK_BOILERPLATE_TAG：fork 子进程首条消息里规则模板的包裹标签，渲染时折叠只留指令。
// Prefix before the directive text, stripped by the renderer. Keep in sync
// across buildChildMessage (generates) and UserForkBoilerplateMessage (parses).
export const FORK_DIRECTIVE_PREFIX = 'Your directive: '
// FORK_DIRECTIVE_PREFIX：指令文本前缀，生成端与解析端必须保持一致。

// Common argument patterns for slash commands that request help
export const COMMON_HELP_ARGS = ['help', '-h', '--help']
// COMMON_HELP_ARGS：help、-h、--help 三种求助写法。

// Common argument patterns for slash commands that request current state/info
export const COMMON_INFO_ARGS = [
  'list',
  'show',
  'display',
  'current',
  'view',
  'get',
  'check',
  'describe',
  'print',
  'version',
  'about',
  'status',
  '?',
]
// COMMON_INFO_ARGS：list、show、status 等一打查询写法，命中即当作「要看当前状态」。
