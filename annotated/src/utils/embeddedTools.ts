// 文件级批注：`embeddedTools.ts` 负责判断当前构建是否内嵌了搜索工具（bfs/ugrep），以及返回内嵌搜索工具的 bun 二进制路径，仅用于 ant-native 构建。
import { isEnvTruthy } from './envUtils.js'

/**
 * Whether this build has bfs/ugrep embedded in the bun binary (ant-native only).
 *
 * When true:
 * - `find` and `grep` in Claude's Bash shell are shadowed by shell functions
 *   that invoke the bun binary with argv0='bfs' / argv0='ugrep' (same trick
 *   as embedded ripgrep)
 * - The dedicated Glob/Grep tools are removed from the tool registry
 * - Prompt guidance steering Claude away from find/grep is omitted
 *
 * Set as a build-time define in scripts/build-with-plugins.ts for ant-native builds.
 */
export function hasEmbeddedSearchTools(): boolean {
  if (!isEnvTruthy(process.env.EMBEDDED_SEARCH_TOOLS)) return false
  const e = process.env.CLAUDE_CODE_ENTRYPOINT
  return (
    e !== 'sdk-ts' && e !== 'sdk-py' && e !== 'sdk-cli' && e !== 'local-agent'
  )
}
// 第一个函数收尾：检测是否内嵌搜索工具——先读 `EMBEDDED_SEARCH_TOOLS` 环境变量，再排除 sdk 类入口点，本地 agent 等场景才启用。

/**
 * Path to the bun binary that contains the embedded search tools.
 * Only meaningful when hasEmbeddedSearchTools() is true.
 */
export function embeddedSearchToolsBinaryPath(): string {
  return process.execPath
}
// 第二个函数收尾：直接返回当前进程可执行路径（`process.execPath`），即承载内嵌 bfs/ugrep 的 bun 二进制。
