import { feature } from 'bun:bundle'
// SDK 流的第一条消息：system/init 承载 cwd、工具表、模型、斜杠命令等会话元数据，远端客户端靠它渲染选择器并决定 UI 是否可用。
import { randomUUID } from 'crypto'
import { getSdkBetas, getSessionId } from 'src/bootstrap/state.js'
import { DEFAULT_OUTPUT_STYLE_NAME } from 'src/constants/outputStyles.js'
import type {
  ApiKeySource,
  PermissionMode,
  SDKMessage,
} from 'src/entrypoints/agentSdkTypes.js'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
} from 'src/tools/AgentTool/constants.js'
import { getAnthropicApiKeyWithSource } from '../auth.js'
import { getCwd } from '../cwd.js'
import { getFastModeState } from '../fastMode.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'

// TODO(next-minor): remove this translation once SDK consumers have migrated
// to the 'Agent' tool name. The wire name was renamed Task → Agent in #19647,
// but emitting the new name in init/result events broke SDK consumers on a
// patch-level release. Keep emitting 'Task' until the next minor.
export function sdkCompatToolName(name: string): string {
  return name === AGENT_TOOL_NAME ? LEGACY_AGENT_TOOL_NAME : name
}
// sdkCompatToolName 是线上协议兼容层：Agent 工具已改名，但 init 与 result 事件继续发旧名，等下一个 minor 再切换。

type CommandLike = { name: string; userInvocable?: boolean }

export type SystemInitInputs = {
  tools: ReadonlyArray<{ name: string }>
  mcpClients: ReadonlyArray<{ name: string; type: string }>
  model: string
  permissionMode: PermissionMode
  commands: ReadonlyArray<CommandLike>
  agents: ReadonlyArray<{ agentType: string }>
  skills: ReadonlyArray<CommandLike>
  plugins: ReadonlyArray<{ name: string; path: string; source: string }>
  fastMode: boolean | undefined
}
// 输入用结构最小化的只读数组描述：这里不 import 具体类型，只要调用方能提供 name 等字段即可，避免本模块被工具层反向依赖。

/**
 * Build the `system/init` SDKMessage — the first message on the SDK stream
 * carrying session metadata (cwd, tools, model, commands, etc.) that remote
 * clients use to render pickers and gate UI.
 *
 * Called from two paths that must produce identical shapes:
 *   - QueryEngine (spawn-bridge / print-mode / SDK) — yielded as the first
 *     stream message per query turn
 *   - useReplBridge (REPL Remote Control) — sent via writeSdkMessages() on
 *     bridge connect, since REPL uses query() directly and never hits the
 *     QueryEngine SDKMessage layer
 */
export function buildSystemInitMessage(inputs: SystemInitInputs): SDKMessage {
  const settings = getSettings_DEPRECATED()
  const outputStyle = settings?.outputStyle ?? DEFAULT_OUTPUT_STYLE_NAME
// outputStyle 走设置项并带默认值：老配置文件里没有这个字段，缺省时回退到内置样式名。

  const initMessage: SDKMessage = {
    type: 'system',
    subtype: 'init',
    cwd: getCwd(),
    session_id: getSessionId(),
    tools: inputs.tools.map(tool => sdkCompatToolName(tool.name)),
    mcp_servers: inputs.mcpClients.map(client => ({
      name: client.name,
      status: client.type,
    })),
    model: inputs.model,
    permissionMode: inputs.permissionMode,
    slash_commands: inputs.commands
      .filter(c => c.userInvocable !== false)
      .map(c => c.name),
    apiKeySource: getAnthropicApiKeyWithSource().source as ApiKeySource,
    betas: getSdkBetas(),
    claude_code_version: MACRO.VERSION,
    output_style: outputStyle,
    agents: inputs.agents.map(agent => agent.agentType),
    skills: inputs.skills
      .filter(s => s.userInvocable !== false)
      .map(skill => skill.name),
    plugins: inputs.plugins.map(plugin => ({
      name: plugin.name,
      path: plugin.path,
      source: plugin.source,
    })),
    uuid: randomUUID(),
  }
// init 消息的字段名全部是 SDK 线上契约（下划线命名），改动会直接破坏下游消费者，新增字段只能追加。
  // Hidden from public SDK types — ant-only UDS messaging socket path
  if (feature('UDS_INBOX')) {
// UDS 收件箱的套接字路径是 Ant 内部字段，故意不进公开 SDK 类型：靠类型断言挂上去，外部构建里整段被 DCE 掉。
    /* eslint-disable @typescript-eslint/no-require-imports */
    ;(initMessage as Record<string, unknown>).messaging_socket_path =
      require('../udsMessaging.js').getUdsMessagingSocketPath()
    /* eslint-enable @typescript-eslint/no-require-imports */
  }
  initMessage.fast_mode_state = getFastModeState(inputs.model, inputs.fastMode)
  return initMessage
// fast_mode_state 最后补：它依赖 model 与入参共同计算，放在对象构造之后赋值可以直接复用已确定的字段。
}
