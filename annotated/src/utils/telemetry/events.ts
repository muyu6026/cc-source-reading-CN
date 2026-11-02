// 遥测事件上报的统一出口。这里只有事件这一条通道，指标走别处，两者维度策略不同——事件可以带高基数字段，指标不行。整份文件都在处理「缺什么就安静降级、但只提醒一次」。
import type { Attributes } from '@opentelemetry/api'
import { getEventLogger, getPromptId } from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { isEnvTruthy } from '../envUtils.js'
import { getTelemetryAttributes } from '../telemetryAttributes.js'

// Monotonically increasing counter for ordering events within a session
let eventSequence = 0
// 会话内单调递增的序号，用于给同一会话里的事件定序。放在模块作用域而不是每次调用时新建，因为它要在整个进程生命周期内累积；进程重启后从头开始，这正符合「会话内有序」的语义。

// Track whether we've already warned about a null event logger to avoid spamming
let hasWarnedNoEventLogger = false

function isUserPromptLoggingEnabled() {
  return isEnvTruthy(process.env.OTEL_LOG_USER_PROMPTS)
}

export function redactIfDisabled(content: string): string {
  return isUserPromptLoggingEnabled() ? content : '<REDACTED>'
}
// 用户提示词内容默认不外传：环境变量未开启时统一替换成占位标记。判定函数单独抽出来，是为了让同一份开关语义在别处也能复用，而不是每个调用点各写一遍环境变量判断。

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  const eventLogger = getEventLogger()
  if (!eventLogger) {
    if (!hasWarnedNoEventLogger) {
      hasWarnedNoEventLogger = true
      logForDebugging(
        `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
        { level: 'warn' },
      )
    }
    return
  }
// 没有事件记录器时直接丢弃并返回，不抛错——遥测不该让主流程失败。但告警只打一次：用一个模块级标记保证同一个缺失原因不会刷满日志，否则每个事件都刷一条会把真正的问题淹掉。

  // Skip logging in test environment
  if (process.env.NODE_ENV === 'test') {
    return
  }

  const attributes: Attributes = {
    ...getTelemetryAttributes(),
    'event.name': eventName,
    'event.timestamp': new Date().toISOString(),
    'event.sequence': eventSequence++,
  }
// 属性构造分三段：先铺公共遥测属性，再加事件自身的名字、时间戳与序号，最后按需补提示词标识。序号在这里自增，所以事件顺序严格等于调用顺序，即使上报管道乱序也能在后台还原。

  // Add prompt ID to events (but not metrics, where it would cause unbounded cardinality)
  const promptId = getPromptId()
  if (promptId) {
    attributes['prompt.id'] = promptId
  }

  // Workspace directory from the desktop app (host path). Events only —
  // filesystem paths are too high-cardinality for metric dimensions, and
  // the BQ metrics pipeline must never see them.
  const workspaceDir = process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS
  if (workspaceDir) {
    attributes['workspace.host_paths'] = workspaceDir.split('|')
  }
// 工作区路径只加在事件上，加之前注释特意写明理由：文件系统路径基数太高，不适合做指标维度，指标管道永远不该看到它。路径用竖线分隔多个值后拆成数组，由后端按需展开。

  // Add metadata as attributes - all values are already strings
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      attributes[key] = value
    }
  }

  // Emit log record as an event
  eventLogger.emit({
    body: `claude_code.${eventName}`,
    attributes,
  })
}
// 上报前把业务元数据逐个合并，跳过值为 undefined 的键——属性对象里出现显式 undefined 在部分导出器里会被当成字符串化处理，产生脏维度。最后事件体加统一前缀，属性与控制台日志里的名字保持一致，方便跨管道检索。
