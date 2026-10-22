import type { PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage, toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getPluginLspServers } from '../../utils/plugins/lspPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import type { ScopedLspServerConfig } from './types.js'

// 【第 9-14 行】一句「**LSP server 只支持通过插件配置**」值得停下来想
//
// 原文：*LSP servers are only supported via plugins, not user/project settings.*
//
// 表面上是「功能还没做完」，实际上是**安全边界**：
// LSP server 的配置里有 `command` 和 `args`，加载一个 server 就等于在本机
// `spawn` 一个任意进程。如果允许写在项目的 `.claude/settings.json` 里，
// 那么「克隆一个仓库」就等价于「允许这个仓库在你机器上执行任意命令」——
// 这是一个不需要任何社工技巧的 RCE。
//
// 插件不一样：装插件是一个**显式的、有确认步骤的**动作，而且插件本身有来源校验。
// 所以这条限制不是懒，是把「谁能决定 spawn 什么」收敛到用户明确同意过的地方。
//
// 读到任何「X 只能通过 Y 配置」的注释，先问一句：是不是在收窄一条执行路径。
/**
 * Get all configured LSP servers from plugins.
 * LSP servers are only supported via plugins, not user/project settings.
 *
 * @returns Object containing servers configuration keyed by scoped server name
 */
export async function getAllLspServers(): Promise<{
  servers: Record<string, ScopedLspServerConfig>
}> {
  const allServers: Record<string, ScopedLspServerConfig> = {}

  try {
    // Get all enabled plugins
    const { enabled: plugins } = await loadAllPluginsCacheOnly()
// 【第 22 行】`loadAllPluginsCacheOnly()` —— 函数名里的 `CacheOnly` 就是全部信息
//
// 它在启动路径上被调用（`initializeLspServerManager` → `manager.initialize()` → 这里）。
// 启动路径上**不能做 I/O 密集或可能联网的事**，所以这个变体只读已经加载好的缓存，
// 不回磁盘扫描、不检查 marketplace 更新。
//
// 代价是缓存可能是空的（见 `manager.ts` 里 issue #15521 那段注释）。
// 这就是「启动快」和「数据新」之间必须做的选择，代码选择的是「启动快 + 事后补一次重初始化」。

    // Load LSP servers from each plugin in parallel.
    // Each plugin is independent — results are merged in original order so
    // Object.assign collision precedence (later plugins win) is preserved.
// 【第 27-43 行】并行加载，但按**原顺序**合并 —— 这两件事必须同时做
//
// `plugins.map(...)` 返回的 Promise 数组，`await Promise.all(...)` 之后
// `results` 的顺序**等于输入顺序**（不是完成顺序）。这是 `Promise.all` 的保证，
// 也是这段代码能成立的前提：下面 `for` 循环里 `Object.assign` 是「后写覆盖前写」，
// 所以**谁赢完全取决于顺序**，而顺序又被并行保住了。
//
// 如果换成「谁先完成谁先合并」（比如 `Promise.race` 或手写完成回调），
// 同一个配置在两个插件里出现时，胜者会随磁盘速度变化 —— 这类 bug 只在
// 某一台机器上偶发，几乎无法复现。
//
// **一句话记住**：并发只允许改变时间，不允许改变顺序；
// 凡是有「后者覆盖前者」语义的地方，都必须保证顺序。
    const results = await Promise.all(
      plugins.map(async plugin => {
        const errors: PluginError[] = []
        try {
          const scopedServers = await getPluginLspServers(plugin, errors)
          return { plugin, scopedServers, errors }
// 【第 33-41 行】改成并行之后，必须显式吞掉单个插件的异常
//
// 注释写得很清楚：
// *Defensive: if one plugin throws, don't lose results from the others.
// The previous serial loop implicitly tolerated this.*
//
// 串行 `for + await` 时，一个插件抛错只会中断它自己那一轮，前面的结果已经在手里了；
// 换成 `Promise.all` 之后，**任何一个 reject 会让整个 Promise.all reject**，
// 于是所有已经成功的插件结果一起丢掉。
//
// 这是「串行改并行」时最容易被忽略的行为变化：
// 并发化不只是变快，它把「局部失败」升级成了「整体失败」。
// 所以每一份 `async` 映射体都必须自带 `try/catch`，把失败降级成一个
// `{ scopedServers: undefined }` 的正常返回值。
        } catch (e) {
          // Defensive: if one plugin throws, don't lose results from the
          // others. The previous serial loop implicitly tolerated this.
          logForDebugging(
            `Failed to load LSP servers for plugin ${plugin.name}: ${e}`,
            { level: 'error' },
          )
          return { plugin, scopedServers: undefined, errors }
        }
      }),
    )

    for (const { plugin, scopedServers, errors } of results) {
      const serverCount = scopedServers ? Object.keys(scopedServers).length : 0
      if (serverCount > 0) {
        // Merge into all servers (already scoped by getPluginLspServers)
        Object.assign(allServers, scopedServers)

        logForDebugging(
          `Loaded ${serverCount} LSP server(s) from plugin: ${plugin.name}`,
        )
      }

      // Log any errors encountered
      if (errors.length > 0) {
        logForDebugging(
          `${errors.length} error(s) loading LSP servers from plugin: ${plugin.name}`,
        )
      }
    }

    logForDebugging(
      `Total LSP servers loaded: ${Object.keys(allServers).length}`,
    )
  } catch (error) {
// 【第 67-74 行】外层 `catch` 只记日志、不抛 —— LSP 是可选功能
//
// LSP 提供的是诊断、跳转、hover 这些**增强能力**，没有它们 CLI 照样能用。
// 所以这里的错误处理原则是：
//
// - `logError(toError(error))` —— 上报到监控，让作者知道插件加载失败了多少次；
// - 不 `throw` —— 不让一个可选功能的失败阻断整个启动。
//
// 注意它**同时**调了两个日志函数，这是这份代码里反复出现的分工：
// `logError` 面向监控（真实错误、进聚合指标），
// `logForDebugging` 面向开发者（带上下文、只在开调试时看）。
// 两个都写 = 「这条错误既重要又需要细节」。
    // Log error for monitoring production issues.
    // LSP is optional, so we don't throw - but we need visibility
    // into why plugin loading fails to improve the feature.
    logError(toError(error))

    logForDebugging(`Error loading LSP servers: ${errorMessage(error)}`)
  }

  return {
    servers: allServers,
  }
}
