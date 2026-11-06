import { updateSessionBridgeId } from '../utils/concurrentSessions.js'
// 全局持有当前 REPL 桥接 handle 的指针：让 React 树外的调用方（tools、斜杠命令）也能调用 subscribePR 等方法；与 bridgeDebug 同样的「每进程一个桥」理由。
import type { ReplBridgeHandle } from './replBridge.js'
import { toCompatSessionId } from './sessionIdCompat.js'

/**
 * Global pointer to the active REPL bridge handle, so callers outside
 * useReplBridge's React tree (tools, slash commands) can invoke handle methods
 * like subscribePR. Same one-bridge-per-process justification as bridgeDebug.ts
 * — the handle's closure captures the sessionId and getAccessToken that created
 * the session, and re-deriving those independently (BriefTool/upload.ts pattern)
 * risks staging/prod token divergence.
 *
 * Set from useReplBridge.tsx when init completes; cleared on teardown.
 */

let handle: ReplBridgeHandle | null = null
// 模块级 handle 变量，初始为空；由 useReplBridge 初始化、拆卸时清空。

export function setReplBridgeHandle(h: ReplBridgeHandle | null): void {
// 设置 handle 时同步在会话记录里发布（或清除）本机桥接 session id，便于其他本地节点去重（优先本地）。
  handle = h
  // Publish (or clear) our bridge session ID in the session record so other
  // local peers can dedup us out of their bridge list — local is preferred.
  void updateSessionBridgeId(getSelfBridgeCompatId() ?? null).catch(() => {})
}

export function getReplBridgeHandle(): ReplBridgeHandle | null {
// 读取当前 handle。
  return handle
}

/**
 * Our own bridge session ID in the session_* compat format the API returns
 * in /v1/sessions responses — or undefined if bridge isn't connected.
 */
export function getSelfBridgeCompatId(): string | undefined {
// 把当前 handle 的桥接 session id 转成 API /v1/sessions 返回格式的兼容 id；未连接则返回 undefined。
  const h = getReplBridgeHandle()
  return h ? toCompatSessionId(h.bridgeSessionId) : undefined
}
