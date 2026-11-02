// 文件级摘要：为电脑控制能力拼出动态 MCP 配置与工具白名单，是 `setupClaudeInChrome` 的同构实现。
// 工具名必须带 `mcp__computer-use__*` 前缀——后端靠这个名字识别并往系统提示里注入能力提示，
// 换成内置工具名就触发不了。
import { buildComputerUseTools } from '@ant/computer-use-mcp'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'

import { isInBundledMode } from '../bundledMode.js'
import { CLI_CU_CAPABILITIES, COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { getChicagoCoordinateMode } from './gates.js'

/**
 * Build the dynamic MCP config + allowed tool names. Mirror of
 * `setupClaudeInChrome`. The `mcp__computer-use__*` tools are added to
 * `allowedTools` so they bypass the normal permission prompt — the package's
 * `request_access` handles approval for the whole session.
 *
 * The MCP layer isn't ceremony: the API backend detects `mcp__computer-use__*`
 * tool names and emits a CU availability hint into the system prompt
 * (COMPUTER_USE_MCP_AVAILABILITY_HINT in the anthropic repo). Built-in tools
 * with different names wouldn't trigger it. Cowork uses the same names for the
 * same reason (apps/desktop/src/main/local-agent-mode/systemPrompt.ts:314).
 */
export function setupComputerUseMCP(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
} {
// 函数返回两份东西：MCP 配置表和白名单。签名把字段逐个写出来而不是用接口，
// 是因为它只在这一处返回，就地声明比多开一个类型更好读。
  const allowedTools = buildComputerUseTools(
    CLI_CU_CAPABILITIES,
    getChicagoCoordinateMode(),
  ).map(t => buildMcpToolName(COMPUTER_USE_MCP_SERVER_NAME, t.name))
// 把能力清单和坐标模式一起交给构建器，产出工具名列表，再逐个套上 MCP 前缀。
// 坐标模式在这里读取，说明它影响的是工具集合本身（是否暴露某类坐标操作），而不只是运行时行为。
// 工具名加进 allowedTools 就绕过了常规权限弹窗——整场会话的批准由包的 request_access 一次性处理。

  // command/args are never spawned — client.ts intercepts by name and
  // uses the in-process server. The config just needs to exist with
  // type 'stdio' to hit the right branch. Mirrors Chrome's setup.
  const args = isInBundledMode()
    ? ['--computer-use-mcp']
    : [
        join(fileURLToPath(import.meta.url), '..', 'cli.js'),
        '--computer-use-mcp',
      ]
// 打包模式和源码模式的启动参数不同：打包时只有标志位，源码时还要带上 cli.js 的绝对路径。
// command 用 process.execPath，即当前 Node 解释器。

  return {
    mcpConfig: {
      [COMPUTER_USE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args,
        scope: 'dynamic',
      } as const,
    },
    allowedTools,
  }
}
// 这段配置其实永远不会真的被 spawn：客户端按名字拦截，改用进程内服务器。
// 保留它是因为分发逻辑要靠 `type: 'stdio'` 落到正确分支——配置存在的意义是路由，不是启动。
