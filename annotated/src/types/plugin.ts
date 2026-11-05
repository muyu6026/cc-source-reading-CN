import type { LspServerConfig } from '../services/lsp/types.js'
import type { McpServerConfig } from '../services/mcp/types.js'
import type { BundledSkillDefinition } from '../skills/bundledSkills.js'
import type {
  CommandMetadata,
  PluginAuthor,
  PluginManifest,
} from '../utils/plugins/schemas.js'
import type { HooksSettings } from '../utils/settings/types.js'

// 把三个插件相关类型从各自模块再导出，集中到一个入口，调用方不必分别 import
export type { PluginAuthor, PluginManifest, CommandMetadata }

/**
 * Definition for a built-in plugin that ships with the CLI.
 * Built-in plugins appear in the /plugin UI and can be enabled/disabled by
 * users (persisted to user settings).
 */
// 内建插件的定义：随 CLI 发布、可在「插件」界面里开关，状态落到用户设置
export type BuiltinPluginDefinition = {
  /** Plugin name (used in `{name}@builtin` identifier) */
  name: string
  /** Description shown in the /plugin UI */
  description: string
  /** Optional version string */
  version?: string
  /** Skills provided by this plugin */
  skills?: BundledSkillDefinition[]
  /** Hooks provided by this plugin */
  hooks?: HooksSettings
  /** MCP servers provided by this plugin */
  mcpServers?: Record<string, McpServerConfig>
  /** Whether this plugin is available (e.g. based on system capabilities). Unavailable plugins are hidden entirely. */
// isAvailable 决定插件是否整体出现：不满足系统能力时直接隐藏，而不是显示后报错
  isAvailable?: () => boolean
  /** Default enabled state before the user sets a preference (defaults to true) */
// 默认启用：用户没偏好时按 true 处理，但 isAvailable 可以整体隐藏不可用插件
  defaultEnabled?: boolean
}

// 插件仓库描述：从哪个 git 地址、哪个分支拉取，并缓存当时的 commit 指针
export type PluginRepository = {
  url: string
  branch: string
  lastUpdated?: string
  commitSha?: string
}

// 插件配置本质上就是一组已登记仓库的映射
export type PluginConfig = {
  repositories: Record<string, PluginRepository>
}

// 一个已加载插件的完整快照：清单、路径、来源，以及从清单展开出的各类子路径
export type LoadedPlugin = {
  name: string
  manifest: PluginManifest
  path: string
  source: string
  repository: string // Repository identifier, usually same as source
  enabled?: boolean
  isBuiltin?: boolean // true for built-in plugins that ship with the CLI
  sha?: string // Git commit SHA for version pinning (from marketplace entry source)
// sha 用于版本钉死：来自市场条目来源，确保拉到的是固定版本而不是最新
  commandsPath?: string
  commandsPaths?: string[] // Additional command paths from manifest
  commandsMetadata?: Record<string, CommandMetadata> // Metadata for named commands from object-mapping format
  agentsPath?: string
  agentsPaths?: string[] // Additional agent paths from manifest
  skillsPath?: string
  skillsPaths?: string[] // Additional skill paths from manifest
  outputStylesPath?: string
  outputStylesPaths?: string[] // Additional output style paths from manifest
  hooksConfig?: HooksSettings
  mcpServers?: Record<string, McpServerConfig>
  lspServers?: Record<string, LspServerConfig>
  settings?: Record<string, unknown>
}

// 组件种类：插件能贡献命令、智能体、技能、钩子、输出样式这五类
export type PluginComponent =
  | 'commands'
  | 'agents'
  | 'skills'
  | 'hooks'
  | 'output-styles'

/**
 * Discriminated union of plugin error types.
 * Each error type has specific contextual data for better debugging and user guidance.
 *
 * This replaces the previous string-based error matching approach with type-safe
 * error handling that can't break when error messages change.
 *
 * IMPLEMENTATION STATUS:
 * Currently used in production (2 types):
 * - generic-error: Used for various plugin loading failures
 * - plugin-not-found: Used when plugin not found in marketplace
 *
 * Planned for future use (10 types - see TODOs in pluginLoader.ts):
 * - path-not-found, git-auth-failed, git-timeout, network-error
 * - manifest-parse-error, manifest-validation-error
 * - marketplace-not-found, marketplace-load-failed
 * - mcp-config-invalid, hook-load-failed, component-load-failed
 *
 * These unused types support UI formatting and provide a clear roadmap for
 * improving error specificity. They can be incrementally implemented as
 * error creation sites are refactored.
 */
// 插件错误的判别联合：每种错误带专属上下文字段，比旧式的字符串匹配更类型安全，也更好翻译成用户提示
export type PluginError =
  | {
// path-not-found：组件文件找不到，带具体路径与组件类型，便于定位
      type: 'path-not-found'
      source: string
      plugin?: string
      path: string
      component: PluginComponent
    }
  | {
      type: 'git-auth-failed'
// git-auth-failed：克隆或拉取时的鉴权失败，区分 ssh 与 https 两种协议
      source: string
      plugin?: string
      gitUrl: string
      authType: 'ssh' | 'https'
    }
  | {
      type: 'git-timeout'
      source: string
      plugin?: string
      gitUrl: string
      operation: 'clone' | 'pull'
    }
  | {
      type: 'network-error'
// network-error：网络层失败，附带详情字符串帮助排查
      source: string
      plugin?: string
      url: string
      details?: string
    }
  | {
      type: 'manifest-parse-error'
// manifest-parse-error：市场或插件清单不是合法 JSON，给出解析错误原文
      source: string
      plugin?: string
      manifestPath: string
      parseError: string
    }
  | {
      type: 'manifest-validation-error'
      source: string
      plugin?: string
      manifestPath: string
      validationErrors: string[]
    }
  | {
      type: 'plugin-not-found'
// plugin-not-found：在市场里按 ID 找不到插件，提示来自哪个市场
      source: string
      pluginId: string
      marketplace: string
    }
  | {
      type: 'marketplace-not-found'
      source: string
      marketplace: string
      availableMarketplaces: string[]
    }
  | {
      type: 'marketplace-load-failed'
      source: string
      marketplace: string
      reason: string
    }
  | {
      type: 'mcp-config-invalid'
// mcp-config-invalid：插件声明的 MCP 服务器配置不合法，给出校验错误
      source: string
      plugin: string
      serverName: string
      validationError: string
    }
  | {
      type: 'mcp-server-suppressed-duplicate'
      source: string
      plugin: string
      serverName: string
      duplicateOf: string
    }
  | {
      type: 'lsp-config-invalid'
// lsp-config-invalid：插件声明的 LSP 服务器配置不合法
      source: string
      plugin: string
      serverName: string
      validationError: string
    }
  | {
      type: 'hook-load-failed'
      source: string
      plugin: string
      hookPath: string
      reason: string
    }
  | {
      type: 'component-load-failed'
      source: string
      plugin: string
      component: PluginComponent
      path: string
      reason: string
    }
  | {
      type: 'mcpb-download-failed'
// mcpb 相关错误：插件打包成单文件分发时的下载、解包、清单校验失败
      source: string
      plugin: string
      url: string
      reason: string
    }
  | {
      type: 'mcpb-extract-failed'
      source: string
      plugin: string
      mcpbPath: string
      reason: string
    }
  | {
      type: 'mcpb-invalid-manifest'
      source: string
      plugin: string
      mcpbPath: string
      validationError: string
    }
  | {
      type: 'lsp-config-invalid'
      source: string
      plugin: string
      serverName: string
      validationError: string
    }
  | {
      type: 'lsp-server-start-failed'
// lsp-server-crashed：记录退出码或信号，区分是崩了还是被信号打死
      source: string
      plugin: string
      serverName: string
      reason: string
    }
  | {
      type: 'lsp-server-crashed'
      source: string
      plugin: string
      serverName: string
      exitCode: number | null
      signal?: string
    }
  | {
      type: 'lsp-request-timeout'
// lsp-request-timeout：记录方法名与超时毫秒数，方便复现
      source: string
      plugin: string
      serverName: string
      method: string
      timeoutMs: number
    }
  | {
      type: 'lsp-request-failed'
      source: string
      plugin: string
      serverName: string
      method: string
      error: string
    }
  | {
      type: 'marketplace-blocked-by-policy'
// 被企业策略拦下的市场：要区分是黑名单命中还是根本不在白名单里
      source: string
      plugin?: string
      marketplace: string
      blockedByBlocklist?: boolean // true if blocked by blockedMarketplaces, false if not in strictKnownMarketplaces
      allowedSources: string[] // Formatted source strings (e.g., "github:owner/repo")
    }
  | {
      type: 'dependency-unsatisfied'
// dependency-unsatisfied：依赖的插件没启用或根本没装，给出对应提示
      source: string
      plugin: string
      dependency: string
      reason: 'not-enabled' | 'not-found'
    }
  | {
      type: 'plugin-cache-miss'
// plugin-cache-miss：本地缓存缺失，提示用户跑「插件」命令刷新
      source: string
      plugin: string
      installPath: string
    }
  | {
      type: 'generic-error'
      source: string
      plugin?: string
      error: string
    }
// 判别联合收尾：二十多种错误共用 source 与 plugin 字段，便于统一上报

// 加载结果：成功启用的、被禁用的、出错的三类各归各
export type PluginLoadResult = {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
  errors: PluginError[]
}

/**
 * Helper function to get a display message from any PluginError
 * Useful for logging and simple error displays
 */
// 把任意 PluginError 翻成一句人话，主要给日志和简单界面用
export function getPluginErrorMessage(error: PluginError): string {
  switch (error.type) {
    case 'generic-error':
// generic-error 直接透传底层错误消息，不做二次加工
      return error.error
    case 'path-not-found':
      return `Path not found: ${error.path} (${error.component})`
    case 'git-auth-failed':
      return `Git authentication failed (${error.authType}): ${error.gitUrl}`
    case 'git-timeout':
      return `Git ${error.operation} timeout: ${error.gitUrl}`
    case 'network-error':
      return `Network error: ${error.url}${error.details ? ` - ${error.details}` : ''}`
    case 'manifest-parse-error':
      return `Manifest parse error: ${error.parseError}`
    case 'manifest-validation-error':
      return `Manifest validation failed: ${error.validationErrors.join(', ')}`
    case 'plugin-not-found':
// plugin-not-found 的错误信息直接带上市场名，用户一眼知道去哪找
      return `Plugin ${error.pluginId} not found in marketplace ${error.marketplace}`
    case 'marketplace-not-found':
      return `Marketplace ${error.marketplace} not found`
    case 'marketplace-load-failed':
      return `Marketplace ${error.marketplace} failed to load: ${error.reason}`
    case 'mcp-config-invalid':
      return `MCP server ${error.serverName} invalid: ${error.validationError}`
    case 'mcp-server-suppressed-duplicate': {
// 重复 MCP 服务器：同名命令或 URL 已存在时跳过，并说明它和谁重复
      const dup = error.duplicateOf.startsWith('plugin:')
        ? `server provided by plugin "${error.duplicateOf.split(':')[1] ?? '?'}"`
        : `already-configured "${error.duplicateOf}"`
      return `MCP server "${error.serverName}" skipped — same command/URL as ${dup}`
    }
    case 'hook-load-failed':
      return `Hook load failed: ${error.reason}`
    case 'component-load-failed':
      return `${error.component} load failed from ${error.path}: ${error.reason}`
    case 'mcpb-download-failed':
      return `Failed to download MCPB from ${error.url}: ${error.reason}`
    case 'mcpb-extract-failed':
      return `Failed to extract MCPB ${error.mcpbPath}: ${error.reason}`
    case 'mcpb-invalid-manifest':
      return `MCPB manifest invalid at ${error.mcpbPath}: ${error.validationError}`
    case 'lsp-config-invalid':
      return `Plugin "${error.plugin}" has invalid LSP server config for "${error.serverName}": ${error.validationError}`
    case 'lsp-server-start-failed':
      return `Plugin "${error.plugin}" failed to start LSP server "${error.serverName}": ${error.reason}`
    case 'lsp-server-crashed':
      if (error.signal) {
        return `Plugin "${error.plugin}" LSP server "${error.serverName}" crashed with signal ${error.signal}`
      }
      return `Plugin "${error.plugin}" LSP server "${error.serverName}" crashed with exit code ${error.exitCode ?? 'unknown'}`
    case 'lsp-request-timeout':
      return `Plugin "${error.plugin}" LSP server "${error.serverName}" timed out on ${error.method} request after ${error.timeoutMs}ms`
    case 'lsp-request-failed':
      return `Plugin "${error.plugin}" LSP server "${error.serverName}" ${error.method} request failed: ${error.error}`
    case 'marketplace-blocked-by-policy':
// 被策略拦截时分流提示：黑名单命中与不在白名单是两种不同话术
      if (error.blockedByBlocklist) {
        return `Marketplace '${error.marketplace}' is blocked by enterprise policy`
      }
      return `Marketplace '${error.marketplace}' is not in the allowed marketplace list`
    case 'dependency-unsatisfied': {
// 依赖不满足时按原因给提示：没启用就建议启用，没装就说明去哪装
      const hint =
        error.reason === 'not-enabled'
          ? 'disabled — enable it or remove the dependency'
          : 'not found in any configured marketplace'
      return `Dependency "${error.dependency}" is ${hint}`
    }
    case 'plugin-cache-miss':
      return `Plugin "${error.plugin}" not cached at ${error.installPath} — run /plugins to refresh`
  }
// 函数收尾：所有分支覆盖完后返回，未匹配的类型不会走到这里
}
