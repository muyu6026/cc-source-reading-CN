import type { UUID } from 'crypto'
// 依赖：UUID 类型、会话 id、命令上下文、颜色表与工具函数、记忆存储、队友判定。
import { getSessionId } from '../../bootstrap/state.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  AGENT_COLORS,
  type AgentColorName,
} from '../../tools/AgentTool/agentColorManager.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import {
  getTranscriptPath,
  saveAgentColor,
} from '../../utils/sessionStorage.js'
import { isTeammate } from '../../utils/teammate.js'

const RESET_ALIASES = ['default', 'reset', 'none', 'gray', 'grey'] as const
// 重置别名表：default/reset/none/gray/grey 五个写法都等价于回到默认灰。

export async function call(
// 命令入口 call：返回 Promise<null>，结果都通过 onDone 以 system 显示回传。
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
  // Teammates cannot set their own color
  if (isTeammate()) {
    onDone(
      'Cannot set color: This session is a swarm teammate. Teammate colors are assigned by the team leader.',
      { display: 'system' },
    )
    return null
  }
// 队友限制：swarm 队友不能自己设颜色，颜色由队长统一分配。

  if (!args || args.trim() === '') {
    const colorList = AGENT_COLORS.join(', ')
    onDone(`Please provide a color. Available colors: ${colorList}, default`, {
      display: 'system',
    })
    return null
  }
// 空参数：列出可用颜色并提示 default，不做事直接返回。

  const colorArg = args.trim().toLowerCase()

  // Handle reset to default (gray)
  if (RESET_ALIASES.includes(colorArg as (typeof RESET_ALIASES)[number])) {
// 重置分支：命中别名就把颜色存成 default 哨兵值（不用空串，方便 truthiness 判断持久化）。
    const sessionId = getSessionId() as UUID
    const fullPath = getTranscriptPath()

    // Use "default" sentinel (not empty string) so truthiness guards
    // in sessionStorage.ts persist the reset across session restarts
    await saveAgentColor(sessionId, 'default', fullPath)

    context.setAppState(prev => ({
      ...prev,
      standaloneAgentContext: {
        ...prev.standaloneAgentContext,
        name: prev.standaloneAgentContext?.name ?? '',
        color: undefined,
      },
    }))

    onDone('Session color reset to default', { display: 'system' })
    return null
  }
// 重置完成：同时清掉 AppState 里的 color，让界面立即回到默认。

  if (!AGENT_COLORS.includes(colorArg as AgentColorName)) {
    const colorList = AGENT_COLORS.join(', ')
    onDone(
      `Invalid color "${colorArg}". Available colors: ${colorList}, default`,
      { display: 'system' },
    )
    return null
  }
// 非法颜色：不在表中就报错并列出可用项，包含 default。

  const sessionId = getSessionId() as UUID
  const fullPath = getTranscriptPath()

  // Save to transcript for persistence across sessions
  await saveAgentColor(sessionId, colorArg, fullPath)
// 正常设置：把颜色存进 transcript 路径，跨会话持久化。

  // Update AppState for immediate effect
  context.setAppState(prev => ({
    ...prev,
    standaloneAgentContext: {
      ...prev.standaloneAgentContext,
      name: prev.standaloneAgentContext?.name ?? '',
      color: colorArg as AgentColorName,
    },
  }))
// 立即生效：更新 AppState 的 standaloneAgentContext.color，下一帧就变色。

  onDone(`Session color set to: ${colorArg}`, { display: 'system' })
  return null
// 收尾：回显「已设为某色」并 return null，命令结束。
}
