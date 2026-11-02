// 本文件集中解析各类缓存目录路径（错误日志、消息日志、MCP 日志等），并对项目目录与服务器名做路径消毒，保证跨升级版本时缓存目录名稳定。
import envPaths from 'env-paths'
import { join } from 'path'
import { getFsImplementation } from './fsOperations.js'
import { djb2Hash } from './hash.js'

const paths = envPaths('claude-cli')

// 此处使用本地 sanitizePath（djb2 哈希），刻意不复用 sessionStoragePortable 中的共享版本（后者在可用时改用 Bun.hash / wyhash）。缓存目录名必须在升级间保持稳定的原因：已有缓存数据（错误日志、MCP 日志）不应被遗弃。
// Local sanitizePath using djb2Hash — NOT the shared version from
// sessionStoragePortable.ts which uses Bun.hash (wyhash) when available.
// Cache directory names must remain stable across upgrades so existing cache
// data (error logs, MCP logs) is not orphaned.
const MAX_SANITIZED_LENGTH = 200
// sanitizePath：把任意名称中非字母数字的字符替换成连字符；若仍超长，则截断后追加名称的 djb2 哈希（36 进制）以保证唯一性。
function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(djb2Hash(name)).toString(36)}`
}

function getProjectDir(cwd: string): string {
  return sanitizePath(cwd)
}

// CACHE_PATHS：以惰性函数形式暴露各缓存子目录路径。baseLogs 按当前工作目录定位；mcpLogs 额外对服务器名消毒（Windows 下冒号是保留字符）。
export const CACHE_PATHS = {
  baseLogs: () => join(paths.cache, getProjectDir(getFsImplementation().cwd())),
  errors: () =>
    join(paths.cache, getProjectDir(getFsImplementation().cwd()), 'errors'),
  messages: () =>
    join(paths.cache, getProjectDir(getFsImplementation().cwd()), 'messages'),
  mcpLogs: (serverName: string) =>
    join(
      paths.cache,
      getProjectDir(getFsImplementation().cwd()),
      // Sanitize server name for Windows compatibility (colons are reserved for drive letters)
      `mcp-logs-${sanitizePath(serverName)}`,
    ),
}
