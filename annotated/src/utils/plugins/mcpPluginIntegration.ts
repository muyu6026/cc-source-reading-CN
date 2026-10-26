// 文件级：本文件负责从插件里加载并解析 MCP 服务器配置。涵盖从 MCPB 压缩包、插件清单字段、`.mcp.json`/`.mcpb` 文件多种来源收集服务器，做环境变量与用户配置替换，最后加上插件作用域前缀避免跨插件命名冲突。
import { join } from 'path'
import { expandEnvVarsInString } from '../../services/mcp/envExpansion.js'
import {
  type McpServerConfig,
  McpServerConfigSchema,
  type ScopedMcpServerConfig,
} from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { errorMessage, isENOENT } from '../errors.js'
import { getFsImplementation } from '../fsOperations.js'
import { jsonParse } from '../slowOperations.js'
import {
  isMcpbSource,
  loadMcpbFile,
  loadMcpServerUserConfig,
  type McpbLoadResult,
  type UserConfigSchema,
  type UserConfigValues,
  validateUserConfig,
} from './mcpbHandler.js'
import { getPluginDataDir } from './pluginDirectories.js'
import {
  getPluginStorageId,
  loadPluginOptions,
  substitutePluginVariables,
  substituteUserConfigVariables,
} from './pluginOptionsStorage.js'

/**
 * Load MCP servers from an MCPB file
 * Handles downloading, extracting, and converting DXT manifest to MCP config
 */
// `loadMcpServersFromMcpb`：从 MCPB 压缩包加载服务器——下载/解压 DXT 清单并转成 MCP 配置；若需要用户配置则先返回 null 等用户填完再加载。
async function loadMcpServersFromMcpb(
  plugin: LoadedPlugin,
  mcpbPath: string,
  errors: PluginError[],
): Promise<Record<string, McpServerConfig> | null> {
  try {
    logForDebugging(`Loading MCP servers from MCPB: ${mcpbPath}`)

    // Use plugin.repository directly - it's already in "plugin@marketplace" format
    const pluginId = plugin.repository

    const result = await loadMcpbFile(
      mcpbPath,
      plugin.path,
      pluginId,
      status => {
        logForDebugging(`MCPB [${plugin.name}]: ${status}`)
      },
    )

    // Check if MCPB needs user configuration
    if ('status' in result && result.status === 'needs-config') {
// needs-config 分支：尚未配置的用户态插件正常返回 null（非错误），由 `/plugin` 菜单引导用户填写。
      // User config needed - this is normal for unconfigured plugins
      // Don't load the MCP server yet - user can configure via /plugin menu
      logForDebugging(
        `MCPB ${mcpbPath} requires user configuration. ` +
          `User can configure via: /plugin → Manage plugins → ${plugin.name} → Configure`,
      )
      // Return null to skip this server for now (not an error)
      return null
    }

    // Type guard passed - result is success type
    const successResult = result as McpbLoadResult

    // Use the DXT manifest name as the server name
    const serverName = successResult.manifest.name

    // Check for server name conflicts with existing servers
    // This will be checked later when merging all servers, but we log here for debugging
    logForDebugging(
      `Loaded MCP server "${serverName}" from MCPB (extracted to ${successResult.extractedPath})`,
    )

    return { [serverName]: successResult.mcpConfig }
// catch 段按错误信息关键词把失败分成下载失败、清单非法、解压失败三类，推入 `errors` 供 UI 展示。
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Failed to load MCPB ${mcpbPath}: ${errorMsg}`, {
      level: 'error',
    })

    // Use plugin@repository as source (consistent with other plugin errors)
    const source = `${plugin.name}@${plugin.repository}`

    // Determine error type based on error message
    const isUrl = mcpbPath.startsWith('http')
    if (
      isUrl &&
      (errorMsg.includes('download') || errorMsg.includes('network'))
    ) {
      errors.push({
        type: 'mcpb-download-failed',
        source,
        plugin: plugin.name,
        url: mcpbPath,
        reason: errorMsg,
      })
    } else if (
      errorMsg.includes('manifest') ||
      errorMsg.includes('user configuration')
    ) {
      errors.push({
        type: 'mcpb-invalid-manifest',
        source,
        plugin: plugin.name,
        mcpbPath,
        validationError: errorMsg,
      })
    } else {
      errors.push({
        type: 'mcpb-extract-failed',
        source,
        plugin: plugin.name,
        mcpbPath,
        reason: errorMsg,
      })
    }

    return null
  }
}

/**
 * Load MCP servers from a plugin's manifest
 * This function loads MCP server configurations from various sources within the plugin
 * including manifest entries, .mcp.json files, and .mcpb files
 */
// `loadPluginMcpServers`：插件级入口，按优先级合并多来源服务器——先 `.mcp.json`（最低），再清单里的 `mcpServers`（更高，支持字符串/数组/内联三种写法）。
export async function loadPluginMcpServers(
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, McpServerConfig> | undefined> {
  let servers: Record<string, McpServerConfig> = {}

  // Check for .mcp.json in plugin directory first (lowest priority)
  const defaultMcpServers = await loadMcpServersFromFile(
    plugin.path,
    '.mcp.json',
  )
  if (defaultMcpServers) {
    servers = { ...servers, ...defaultMcpServers }
  }

  // Handle manifest mcpServers if present (higher priority)
  if (plugin.manifest.mcpServers) {
// 清单 `mcpServers` 字段支持三种形态：字符串（MCPB 或 JSON 路径）、数组（并行加载后保序合并）、直接对象（内联配置）。
    const mcpServersSpec = plugin.manifest.mcpServers

    // Handle different mcpServers formats
    if (typeof mcpServersSpec === 'string') {
      // Check if it's an MCPB file
      if (isMcpbSource(mcpServersSpec)) {
        const mcpbServers = await loadMcpServersFromMcpb(
          plugin,
          mcpServersSpec,
          errors,
        )
        if (mcpbServers) {
          servers = { ...servers, ...mcpbServers }
        }
      } else {
        // Path to JSON file
        const mcpServers = await loadMcpServersFromFile(
          plugin.path,
          mcpServersSpec,
        )
        if (mcpServers) {
          servers = { ...servers, ...mcpServers }
        }
      }
    } else if (Array.isArray(mcpServersSpec)) {
      // Array of paths or inline configs.
      // Load all specs in parallel, then merge in original order so
      // last-wins collision semantics are preserved.
      const results = await Promise.all(
        mcpServersSpec.map(async spec => {
          try {
            if (typeof spec === 'string') {
              // Check if it's an MCPB file
              if (isMcpbSource(spec)) {
                return await loadMcpServersFromMcpb(plugin, spec, errors)
              }
              // Path to JSON file
              return await loadMcpServersFromFile(plugin.path, spec)
            }
            // Inline MCP server configs (sync)
            return spec
          } catch (e) {
            // Defensive: if one spec throws, don't lose results from the
            // others. The previous serial loop implicitly tolerated this.
            logForDebugging(
              `Failed to load MCP servers from spec for plugin ${plugin.name}: ${e}`,
              { level: 'error' },
            )
            return null
          }
        }),
      )
      for (const result of results) {
        if (result) {
          servers = { ...servers, ...result }
        }
      }
    } else {
      // Direct MCP server configs
      servers = { ...servers, ...mcpServersSpec }
    }
  }

  return Object.keys(servers).length > 0 ? servers : undefined
}

/**
 * Load MCP servers from a JSON file within a plugin
 * This is a simplified version that doesn't expand environment variables
 * and is specifically for plugin MCP configs
 */
// `loadMcpServersFromFile`：从插件目录内的 JSON 文件读取服务器，并用 Zod schema 逐个校验，非法条目只打日志不阻断其余。
async function loadMcpServersFromFile(
  pluginPath: string,
  relativePath: string,
): Promise<Record<string, McpServerConfig> | null> {
  const fs = getFsImplementation()
  const filePath = join(pluginPath, relativePath)

  let content: string
  try {
    content = await fs.readFile(filePath, { encoding: 'utf-8' })
  } catch (e: unknown) {
    if (isENOENT(e)) {
      return null
    }
    logForDebugging(`Failed to load MCP servers from ${filePath}: ${e}`, {
      level: 'error',
    })
    return null
  }

  try {
    const parsed = jsonParse(content)

    // Check if it's in the .mcp.json format with mcpServers key
    const mcpServers = parsed.mcpServers || parsed

    // Validate each server config
    const validatedServers: Record<string, McpServerConfig> = {}
    for (const [name, config] of Object.entries(mcpServers)) {
      const result = McpServerConfigSchema().safeParse(config)
      if (result.success) {
        validatedServers[name] = result.data
      } else {
        logForDebugging(
          `Invalid MCP server config for ${name} in ${filePath}: ${result.error.message}`,
          { level: 'error' },
        )
      }
    }

    return validatedServers
  } catch (error) {
    logForDebugging(`Failed to load MCP servers from ${filePath}: ${error}`, {
      level: 'error',
    })
    return null
  }
}

/**
 * A channel entry from a plugin's manifest whose userConfig has not yet been
 * filled in (required fields are missing from saved settings).
 */
export type UnconfiguredChannel = {
// `UnconfiguredChannel` 类型：描述插件清单里「用户配置尚未填好」的 channel 入口。
  server: string
  displayName: string
  configSchema: UserConfigSchema
}

/**
 * Find channel entries in a plugin's manifest whose required userConfig
 * fields are not yet saved. Pure function — no React, no prompting.
 * ManagePlugins.tsx calls this after a plugin is enabled to decide whether
 * to show the config dialog.
 *
 * Entries without a `userConfig` schema are skipped (nothing to prompt for).
 * Entries whose saved config already satisfies `validateUserConfig` are
 * skipped. The `configSchema` in the return value is structurally a
 * `UserConfigSchema` because the Zod schema in schemas.ts matches
 * `McpbUserConfigurationOption` field-for-field.
 */
// `getUnconfiguredChannels`：纯函数，找出哪些 channel 的必填用户配置还没保存，供 ManagePlugins 决定要不要弹配置对话框。
export function getUnconfiguredChannels(
  plugin: LoadedPlugin,
): UnconfiguredChannel[] {
  const channels = plugin.manifest.channels
  if (!channels || channels.length === 0) {
    return []
  }

  // plugin.repository is already in "plugin@marketplace" format — same key
  // loadMcpServerUserConfig / saveMcpServerUserConfig use.
  const pluginId = plugin.repository

  const unconfigured: UnconfiguredChannel[] = []
  for (const channel of channels) {
    if (!channel.userConfig || Object.keys(channel.userConfig).length === 0) {
      continue
    }
    const saved = loadMcpServerUserConfig(pluginId, channel.server) ?? {}
    const validation = validateUserConfig(saved, channel.userConfig)
    if (!validation.valid) {
      unconfigured.push({
        server: channel.server,
        displayName: channel.displayName ?? channel.server,
        configSchema: channel.userConfig,
      })
    }
  }
  return unconfigured
}

/**
 * Look up saved user config for a server, if this server is declared as a
 * channel in the plugin's manifest. Returns undefined for non-channel servers
 * or channels without a userConfig schema — resolvePluginMcpEnvironment will
 * then skip ${user_config.X} substitution for that server.
 */
// `loadChannelUserConfig`：按服务器名从插件清单定位 channel 并读已保存的用户配置；非 channel 或没有用户配置 schema 时返回 undefined，跳过变量替换。
function loadChannelUserConfig(
  plugin: LoadedPlugin,
  serverName: string,
): UserConfigValues | undefined {
  const channel = plugin.manifest.channels?.find(c => c.server === serverName)
  if (!channel?.userConfig) {
    return undefined
  }
  return loadMcpServerUserConfig(plugin.repository, serverName) ?? undefined
}

/**
 * Add plugin scope to MCP server configs
 * This adds a prefix to server names to avoid conflicts between plugins
 */
// `addPluginScopeToServers`：给服务器名加 `plugin:<插件名>:<原名>` 前缀并标记 `dynamic` 作用域，避免不同插件同名冲突。
export function addPluginScopeToServers(
  servers: Record<string, McpServerConfig>,
  pluginName: string,
  pluginSource: string,
): Record<string, ScopedMcpServerConfig> {
  const scopedServers: Record<string, ScopedMcpServerConfig> = {}

  for (const [name, config] of Object.entries(servers)) {
    // Add plugin prefix to server name to avoid conflicts
    const scopedName = `plugin:${pluginName}:${name}`
    const scoped: ScopedMcpServerConfig = {
      ...config,
      scope: 'dynamic', // Use dynamic scope for plugin servers
      pluginSource,
    }
    scopedServers[scopedName] = scoped
  }

  return scopedServers
}

/**
 * Extract all MCP servers from loaded plugins
 * NOTE: Resolves environment variables for all servers before returning
 */
// `extractMcpServersFromPlugins`：批量处理所有已启用插件——加载、逐服务器解析环境变量、缓存未解析版本、加作用域后汇总。每个服务器单独 try/catch，单个坏配置不影响整体。
export async function extractMcpServersFromPlugins(
  plugins: LoadedPlugin[],
  errors: PluginError[] = [],
): Promise<Record<string, ScopedMcpServerConfig>> {
  const allServers: Record<string, ScopedMcpServerConfig> = {}

  const scopedResults = await Promise.all(
    plugins.map(async plugin => {
      if (!plugin.enabled) return null

      const servers = await loadPluginMcpServers(plugin, errors)
      if (!servers) return null

      // Resolve environment variables before scoping. When a saved channel
      // config is missing a key (plugin update added a required field, or a
      // hand-edited settings.json), substituteUserConfigVariables throws
      // inside resolvePluginMcpEnvironment — catch per-server so one bad
      // config doesn't crash the whole plugin load via Promise.all.
      const resolvedServers: Record<string, McpServerConfig> = {}
      for (const [name, config] of Object.entries(servers)) {
        const userConfig = buildMcpUserConfig(plugin, name)
        try {
          resolvedServers[name] = resolvePluginMcpEnvironment(
            config,
            plugin,
            userConfig,
            errors,
            plugin.name,
            name,
          )
        } catch (err) {
          errors?.push({
            type: 'generic-error',
            source: name,
            plugin: plugin.name,
            error: errorMessage(err),
          })
        }
      }

      // Store the UNRESOLVED servers on the plugin for caching
      // (Environment variables will be resolved fresh each time they're needed)
      plugin.mcpServers = servers

      logForDebugging(
        `Loaded ${Object.keys(servers).length} MCP servers from plugin ${plugin.name}`,
      )

      return addPluginScopeToServers(
        resolvedServers,
        plugin.name,
        plugin.source,
      )
    }),
  )

  for (const scopedServers of scopedResults) {
    if (scopedServers) {
      Object.assign(allServers, scopedServers)
    }
  }

  return allServers
}

/**
 * Build the userConfig map for a single MCP server by merging the plugin's
 * top-level manifest.userConfig values with the channel-specific per-server
 * config (assistant-mode channels). Channel-specific wins on collision so
 * plugins that declare the same key at both levels get the more specific value.
 *
 * Returns undefined when neither source has anything — resolvePluginMcpEnvironment
 * skips substituteUserConfigVariables in that case.
 */
// `buildMcpUserConfig`：合并插件顶层 `userConfig` 与 channel 级 per-server 配置（channel 级优先），都缺失时返回 undefined 以跳过替换。
function buildMcpUserConfig(
  plugin: LoadedPlugin,
  serverName: string,
): UserConfigValues | undefined {
  // Gate on manifest.userConfig. loadPluginOptions always returns at least {}
  // (it spreads two `?? {}` fallbacks), so without this guard topLevel is never
  // undefined — the `!topLevel` check below is dead, we return {} for
  // unconfigured plugins, and resolvePluginMcpEnvironment runs
  // substituteUserConfigVariables against an empty map → throws on any
  // ${user_config.X} ref. The manifest check also skips the unconditional
  // keychain read (~50-100ms on macOS) for plugins that don't use options.
  const topLevel = plugin.manifest.userConfig
    ? loadPluginOptions(getPluginStorageId(plugin))
    : undefined
  const channelSpecific = loadChannelUserConfig(plugin, serverName)

  if (!topLevel && !channelSpecific) return undefined
  return { ...topLevel, ...channelSpecific }
}

/**
 * Resolve environment variables for plugin MCP servers
 * Handles ${CLAUDE_PLUGIN_ROOT}, ${user_config.X}, and general ${VAR} substitution
 * Tracks missing environment variables for error reporting
 */
// `resolvePluginMcpEnvironment`：核心替换函数——按插件变量 → 用户配置变量 → 通用环境变量的顺序解析命令/参数/环境变量/URL/请求头，并收集缺失变量报告。
export function resolvePluginMcpEnvironment(
  config: McpServerConfig,
  plugin: { path: string; source: string },
  userConfig?: UserConfigValues,
  errors?: PluginError[],
  pluginName?: string,
  serverName?: string,
): McpServerConfig {
  const allMissingVars: string[] = []

  const resolveValue = (value: string): string => {
    // First substitute plugin-specific variables
    let resolved = substitutePluginVariables(value, plugin)

    // Then substitute user config variables if provided
    if (userConfig) {
      resolved = substituteUserConfigVariables(resolved, userConfig)
    }

    // Finally expand general environment variables
    // This is done last so plugin-specific and user config vars take precedence
    const { expanded, missingVars } = expandEnvVarsInString(resolved)
    allMissingVars.push(...missingVars)

    return expanded
  }

  let resolved: McpServerConfig

  // Handle different server types
  switch (config.type) {
// switch 按服务器类型分支：stdio 解析命令与参数并注入 `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`；sse/http/ws 解析 URL 与请求头；其余类型原样透传。
    case undefined:
    case 'stdio': {
      const stdioConfig = { ...config }

      // Resolve command path
      if (stdioConfig.command) {
        stdioConfig.command = resolveValue(stdioConfig.command)
      }

      // Resolve args
      if (stdioConfig.args) {
        stdioConfig.args = stdioConfig.args.map(arg => resolveValue(arg))
      }

      // Resolve environment variables and add CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA
      const resolvedEnv: Record<string, string> = {
        CLAUDE_PLUGIN_ROOT: plugin.path,
        CLAUDE_PLUGIN_DATA: getPluginDataDir(plugin.source),
        ...(stdioConfig.env || {}),
      }
      for (const [key, value] of Object.entries(resolvedEnv)) {
        if (key !== 'CLAUDE_PLUGIN_ROOT' && key !== 'CLAUDE_PLUGIN_DATA') {
          resolvedEnv[key] = resolveValue(value)
        }
      }
      stdioConfig.env = resolvedEnv

      resolved = stdioConfig
      break
    }

    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = { ...config }

      // Resolve URL
      if (remoteConfig.url) {
        remoteConfig.url = resolveValue(remoteConfig.url)
      }

      // Resolve headers
      if (remoteConfig.headers) {
        const resolvedHeaders: Record<string, string> = {}
        for (const [key, value] of Object.entries(remoteConfig.headers)) {
          resolvedHeaders[key] = resolveValue(value)
        }
        remoteConfig.headers = resolvedHeaders
      }

      resolved = remoteConfig
      break
    }

    // For other types (sse-ide, ws-ide, sdk, claudeai-proxy), pass through unchanged
    case 'sse-ide':
    case 'ws-ide':
    case 'sdk':
    case 'claudeai-proxy':
      resolved = config
      break
  }

  // Log and track missing variables if any were found and errors array provided
  if (errors && allMissingVars.length > 0) {
    const uniqueMissingVars = [...new Set(allMissingVars)]
    const varList = uniqueMissingVars.join(', ')

    logForDebugging(
      `Missing environment variables in plugin MCP config: ${varList}`,
      { level: 'warn' },
    )

    // Add error to the errors array if plugin and server names are provided
    if (pluginName && serverName) {
      errors.push({
        type: 'mcp-config-invalid',
        source: `plugin:${pluginName}`,
        plugin: pluginName,
        serverName,
        validationError: `Missing environment variables: ${varList}`,
      })
    }
  }

  return resolved
}

/**
 * Get MCP servers from a specific plugin with environment variable resolution and scoping
 * This function is called when the MCP servers need to be activated and ensures they have
 * the proper environment variables and scope applied
 */
// `getPluginMcpServers`：激活单个插件时调用，优先用缓存，未命中再加载并逐服务器解析环境、加作用域后返回。
export async function getPluginMcpServers(
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, ScopedMcpServerConfig> | undefined> {
  if (!plugin.enabled) {
    return undefined
  }

  // Use cached servers if available
  const servers =
    plugin.mcpServers || (await loadPluginMcpServers(plugin, errors))
  if (!servers) {
    return undefined
  }

  // Resolve environment variables. Same per-server try/catch as
  // extractMcpServersFromPlugins above: a partial saved channel config
  // (plugin update added a required field) would make
  // substituteUserConfigVariables throw inside resolvePluginMcpEnvironment,
  // and this function runs inside Promise.all at config.ts:911 — one
  // uncaught throw crashes all plugin MCP loading.
  const resolvedServers: Record<string, McpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    const userConfig = buildMcpUserConfig(plugin, name)
    try {
      resolvedServers[name] = resolvePluginMcpEnvironment(
        config,
        plugin,
        userConfig,
        errors,
        plugin.name,
        name,
      )
    } catch (err) {
      errors?.push({
        type: 'generic-error',
        source: name,
        plugin: plugin.name,
        error: errorMessage(err),
      })
    }
  }

  // Add plugin scope
  return addPluginScopeToServers(resolvedServers, plugin.name, plugin.source)
}
