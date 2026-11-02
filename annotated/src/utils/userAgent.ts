// 文件级。User-Agent 字符串辅助，刻意保持零依赖，方便桥接层和传输层引用而不牵动 `auth.ts` 那一整棵依赖树。
/**
 * User-Agent string helpers.
 *
 * Kept dependency-free so SDK-bundled code (bridge, cli/transports) can
 * import without pulling in auth.ts and its transitive dependency tree.
 */

export function getClaudeCodeUserAgent(): string {
  return `claude-code/${MACRO.VERSION}`
}
// 返回形如 `claude-code/<版本号>` 的标识串，版本来自编译期宏 `MACRO.VERSION`。
