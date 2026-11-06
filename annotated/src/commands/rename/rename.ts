import type { UUID } from 'crypto'
// 依赖：UUID 类型、会话 id、桥接配置覆盖、命令上下文、消息工具、记忆存储、队友判定、名称生成。
import { getSessionId } from '../../bootstrap/state.js'
import {
  getBridgeBaseUrlOverride,
  getBridgeTokenOverride,
} from '../../bridge/bridgeConfig.js'
import type { ToolUseContext } from '../../Tool.js'
import type {
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import {
  getTranscriptPath,
  saveAgentName,
  saveCustomTitle,
} from '../../utils/sessionStorage.js'
import { isTeammate } from '../../utils/teammate.js'
import { generateSessionName } from './generateSessionName.js'
// imports 收尾；generateSessionName 在本目录内，用于无参时自动起名。

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
  args: string,
): Promise<null> {
// call 入口：接收 onDone、context、args，返回 Promise<null>。
  // Prevent teammates from renaming - their names are set by team leader
  if (isTeammate()) {
    onDone(
      'Cannot rename: This session is a swarm teammate. Teammate names are set by the team leader.',
      { display: 'system' },
    )
    return null
  }
// 队友限制：swarm 队友不能改名，名字由队长设定。

  let newName: string
  if (!args || args.trim() === '') {
    const generated = await generateSessionName(
      getMessagesAfterCompactBoundary(context.messages),
      context.abortController.signal,
    )
    if (!generated) {
      onDone(
        'Could not generate a name: no conversation context yet. Usage: /rename <name>',
        { display: 'system' },
      )
      return null
    }
    newName = generated
  } else {
    newName = args.trim()
  }
// 新名来源：无参就调用生成器按对话内容起名，有参就直接用用户输入。

  const sessionId = getSessionId() as UUID
  const fullPath = getTranscriptPath()

  // Always save the custom title (session name)
  await saveCustomTitle(sessionId, newName, fullPath)
// 持久化标题：无论哪种来源都先 saveCustomTitle 落盘。

  // Sync title to bridge session on claude.ai/code (best-effort, non-blocking).
  // v2 env-less bridge stores cse_* in replBridgeSessionId —
  // updateBridgeSessionTitle retags internally for the compat endpoint.
  const appState = context.getAppState()
  const bridgeSessionId = appState.replBridgeSessionId
  if (bridgeSessionId) {
    const tokenOverride = getBridgeTokenOverride()
    void import('../../bridge/createSession.js').then(
      ({ updateBridgeSessionTitle }) =>
        updateBridgeSessionTitle(bridgeSessionId, newName, {
          baseUrl: getBridgeBaseUrlOverride(),
          getAccessToken: tokenOverride ? () => tokenOverride : undefined,
        }).catch(() => {}),
    )
  }
// 桥接同步：有 bridgeSessionId 就动态 import 更新远端标题（best-effort 不阻塞）。

  // Also persist as the session's agent name for prompt-bar display
  await saveAgentName(sessionId, newName, fullPath)
// 同步 agent 名：同时把名字存为 agent name，供提示栏显示。
  context.setAppState(prev => ({
    ...prev,
    standaloneAgentContext: {
      ...prev.standaloneAgentContext,
      name: newName,
    },
  }))
// 更新 AppState：把 standaloneAgentContext.name 改成新名，界面即时反映。

  onDone(`Session renamed to: ${newName}`, { display: 'system' })
  return null
}
// 收尾：回显「已重命名为某名」并 return null。
