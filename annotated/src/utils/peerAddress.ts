// 本文件负责解析「对等节点地址」，刻意从 peerRegistry 拆出，使 SendMessageTool 在枚举工具时无需连带加载 bridge（axios）与 UDS（fs、net）等重模块。
/**
 * Peer address parsing — kept separate from peerRegistry.ts so that
 * SendMessageTool can import parseAddress without transitively loading
 * the bridge (axios) and UDS (fs, net) modules at tool-enumeration time.
 */

/** Parse a URI-style address into scheme + target. */
// parseAddress 把一个 URI 风格地址拆成 scheme 与目标两段；支持 uds、bridge、other 三种 scheme。
export function parseAddress(to: string): {
  scheme: 'uds' | 'bridge' | 'other'
  target: string
} {
  if (to.startsWith('uds:')) return { scheme: 'uds', target: to.slice(4) }
  if (to.startsWith('bridge:')) return { scheme: 'bridge', target: to.slice(7) }
  // Legacy: old-code UDS senders emit bare socket paths in from=; route them
  // through the UDS branch so replies aren't silently dropped into teammate
  // routing. (No bare-session-ID fallback — bridge messaging is new enough
  // that no old senders exist, and the prefix would hijack teammate names
  // like session_manager.)
  if (to.startsWith('/')) return { scheme: 'uds', target: to }
  return { scheme: 'other', target: to }
}
// 解析规则：以 uds: 或 / 开头走 Unix 域套接字分支；以 bridge: 开头走桥接分支；其余一律归为 other。对旧代码裸套接字路径的兼容也并入 uds 分支，避免回复被错误丢进队友路由。
