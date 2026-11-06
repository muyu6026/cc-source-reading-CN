/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */
// eslint 禁用 node-builtins 规则：本文件用到 Node 内置能力，先关掉那条 lint。

import { errorMessage } from '../utils/errors.js'
import { jsonStringify } from '../utils/slowOperations.js'
import type { DirectConnectConfig } from './directConnectManager.js'
import { connectResponseSchema } from './types.js'

// 依赖：错误文案、JSON 序列化、直连配置类型、响应 schema。
/**
 * Errors thrown by createDirectConnectSession when the connection fails.
 */
export class DirectConnectError extends Error {
// DirectConnectError：业务错误类型，固定 name 方便上层区分网络、HTTP、解析失败。
  constructor(message: string) {
    super(message)
    this.name = 'DirectConnectError'
  }
}

/**
 * Create a session on a direct-connect server.
 *
 * Posts to `${serverUrl}/sessions`, validates the response, and returns
 * a DirectConnectConfig ready for use by the REPL or headless runner.
 *
 * Throws DirectConnectError on network, HTTP, or response-parsing failures.
 */
export async function createDirectConnectSession({
  serverUrl,
  authToken,
  cwd,
  dangerouslySkipPermissions,
}: {
  serverUrl: string
  authToken?: string
  cwd: string
  dangerouslySkipPermissions?: boolean
}): Promise<{
  config: DirectConnectConfig
  workDir?: string
}> {
// 主函数签名收尾：serverUrl、token、cwd、跳过权限四参，返回 config 与可选 workDir。
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (authToken) {
    headers['authorization'] = `Bearer ${authToken}`
  }
// 鉴权头：有 token 就加 Bearer，否则留空，统一从 headers 表取值。

  let resp: Response
  try {
    resp = await fetch(`${serverUrl}/sessions`, {
      method: 'POST',
      headers,
      body: jsonStringify({
        cwd,
        ...(dangerouslySkipPermissions && {
          dangerously_skip_permissions: true,
        }),
      }),
    })
  } catch (err) {
    throw new DirectConnectError(
      `Failed to connect to server at ${serverUrl}: ${errorMessage(err)}`,
    )
  }
// 网络层：fetch 失败包成 DirectConnectError，带服务器地址与底层错误。

  if (!resp.ok) {
    throw new DirectConnectError(
      `Failed to create session: ${resp.status} ${resp.statusText}`,
    )
  }
// HTTP 状态：非 2xx 也抛错，文案含状态码与状态文本。

  const result = connectResponseSchema().safeParse(await resp.json())
  if (!result.success) {
    throw new DirectConnectError(
      `Invalid session response: ${result.error.message}`,
    )
  }
// 响应解析：zod 安全解析，失败报「非法响应」并附错误信息。

  const data = result.data
  return {
    config: {
      serverUrl,
      sessionId: data.session_id,
      wsUrl: data.ws_url,
      authToken,
    },
    workDir: data.work_dir,
  }
}
// 收尾：映射出 config（sessionId、wsUrl、authToken）与 workDir 返回；所有异常路径都走 DirectConnectError，调用方只需 try/catch 一类错误。
