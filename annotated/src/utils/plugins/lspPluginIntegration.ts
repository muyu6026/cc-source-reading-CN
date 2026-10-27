import { readFile } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { z } from 'zod/v4'
import type {
  LspServerConfig,
  ScopedLspServerConfig,
} from '../../services/lsp/types.js'
import { expandEnvVarsInString } from '../../services/mcp/envExpansion.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import { logForDebugging } from '../debug.js'
import { isENOENT, toError } from '../errors.js'
import { logError } from '../log.js'
import { jsonParse } from '../slowOperations.js'
import { getPluginDataDir } from './pluginDirectories.js'
import {
  getPluginStorageId,
  loadPluginOptions,
  type PluginOptionValues,
  substitutePluginVariables,
  substituteUserConfigVariables,
} from './pluginOptionsStorage.js'
import { LspServerConfigSchema } from './schemas.js'

// 导入 zod、LSP 类型、插件类型与若干工具函数。
/**
 * Validate that a resolved path stays within the plugin directory.
 * Prevents path traversal attacks via .. or absolute paths.
 */
function validatePathWithinPlugin(
// `validatePathWithinPlugin` 防止通过 `..` 或绝对路径越权访问插件目录外。
  pluginPath: string,
  relativePath: string,
): string | null {
  // Resolve both paths to absolute paths
  const resolvedPluginPath = resolve(pluginPath)
// 把插件路径与文件路径都解析为绝对路径以便比较。
  const resolvedFilePath = resolve(pluginPath, relativePath)

  // Check if the resolved file path is within the plugin directory
  const rel = relative(resolvedPluginPath, resolvedFilePath)

  // If relative path starts with .. or is absolute, it's outside the plugin dir
  if (rel.startsWith('..') || resolve(rel) === rel) {
// 若相对路径以 `..` 开头或本身是绝对路径，判定为越界并返回 null。
    return null
  }

  return resolvedFilePath
}
// 越界检查通过后返回插件内的绝对文件路径。

/**
 * Load LSP server configurations from a plugin.
 * Checks for:
 * 1. .lsp.json file in plugin directory
 * 2. manifest.lspServers field
 *
 * @param plugin - The loaded plugin
 * @param errors - Array to collect any errors encountered
 * @returns Record of server name to config, or undefined if no servers
 */
export async function loadPluginLspServers(
// `loadPluginLspServers` 从 `.lsp.json` 或清单 `lspServers` 字段加载服务器配置。
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, LspServerConfig> | undefined> {
  const servers: Record<string, LspServerConfig> = {}

  // 1. Check for .lsp.json file in plugin directory
  const lspJsonPath = join(plugin.path, '.lsp.json')
// 先尝试读取插件目录下的 `.lsp.json` 文件。
  try {
    const content = await readFile(lspJsonPath, 'utf-8')
    const parsed = jsonParse(content)
    const result = z
      .record(z.string(), LspServerConfigSchema())
      .safeParse(parsed)

    if (result.success) {
// 用 `LspServerConfigSchema` 校验解析结果，成功则并入服务器表。
      Object.assign(servers, result.data)
    } else {
      const errorMsg = `LSP config validation failed for .lsp.json in plugin ${plugin.name}: ${result.error.message}`
      logError(new Error(errorMsg))
      errors.push({
        type: 'lsp-config-invalid',
        plugin: plugin.name,
        serverName: '.lsp.json',
        validationError: result.error.message,
        source: 'plugin',
      })
    }
// 校验失败时记录错误并推入 `lsp-config-invalid` 错误条目。
  } catch (error) {
    // .lsp.json is optional, ignore if it doesn't exist
    if (!isENOENT(error)) {
      const _errorMsg =
        error instanceof Error
          ? `Failed to read/parse .lsp.json in plugin ${plugin.name}: ${error.message}`
          : `Failed to read/parse .lsp.json file in plugin ${plugin.name}`

      logError(toError(error))

      errors.push({
        type: 'lsp-config-invalid',
        plugin: plugin.name,
        serverName: '.lsp.json',
        validationError:
          error instanceof Error
            ? `Failed to parse JSON: ${error.message}`
            : 'Failed to parse JSON file',
        source: 'plugin',
      })
    }
  }

  // 2. Check manifest.lspServers field
  if (plugin.manifest.lspServers) {
// 再检查清单里的 `lspServers` 字段并合并其服务器。
    const manifestServers = await loadLspServersFromManifest(
      plugin.manifest.lspServers,
      plugin.path,
      plugin.name,
      errors,
    )
    if (manifestServers) {
      Object.assign(servers, manifestServers)
    }
  }

  return Object.keys(servers).length > 0 ? servers : undefined
// 有服务器时返回映射，否则返回 undefined。
}

/**
 * Load LSP servers from manifest declaration (handles multiple formats).
 */
async function loadLspServersFromManifest(
// `loadLspServersFromManifest` 支持字符串/对象/数组多种声明格式。
  declaration:
    | string
    | Record<string, LspServerConfig>
    | Array<string | Record<string, LspServerConfig>>,
  pluginPath: string,
  pluginName: string,
  errors: PluginError[],
): Promise<Record<string, LspServerConfig> | undefined> {
  const servers: Record<string, LspServerConfig> = {}

  // Normalize to array
  const declarations = Array.isArray(declaration) ? declaration : [declaration]
// 把声明归一化为数组逐个处理。

  for (const decl of declarations) {
    if (typeof decl === 'string') {
// 字符串声明视为要加载的配置文件路径。
      // Validate path to prevent directory traversal
      const validatedPath = validatePathWithinPlugin(pluginPath, decl)
// 先校验路径，阻断目录穿越尝试。
      if (!validatedPath) {
        const securityMsg = `Security: Path traversal attempt blocked in plugin ${pluginName}: ${decl}`
        logError(new Error(securityMsg))
        logForDebugging(securityMsg, { level: 'warn' })
        errors.push({
          type: 'lsp-config-invalid',
          plugin: pluginName,
          serverName: decl,
          validationError:
            'Invalid path: must be relative and within plugin directory',
          source: 'plugin',
        })
        continue
      }

      // Load from file
// 加载并校验被引用的配置文件。
      try {
        const content = await readFile(validatedPath, 'utf-8')
        const parsed = jsonParse(content)
        const result = z
          .record(z.string(), LspServerConfigSchema())
          .safeParse(parsed)

        if (result.success) {
          Object.assign(servers, result.data)
        } else {
          const errorMsg = `LSP config validation failed for ${decl} in plugin ${pluginName}: ${result.error.message}`
          logError(new Error(errorMsg))
          errors.push({
            type: 'lsp-config-invalid',
            plugin: pluginName,
            serverName: decl,
            validationError: result.error.message,
            source: 'plugin',
          })
        }
      } catch (error) {
        const _errorMsg =
          error instanceof Error
            ? `Failed to read/parse LSP config from ${decl} in plugin ${pluginName}: ${error.message}`
            : `Failed to read/parse LSP config file ${decl} in plugin ${pluginName}`

        logError(toError(error))

        errors.push({
          type: 'lsp-config-invalid',
          plugin: pluginName,
          serverName: decl,
          validationError:
            error instanceof Error
              ? `Failed to parse JSON: ${error.message}`
              : 'Failed to parse JSON file',
          source: 'plugin',
        })
      }
    } else {
      // Inline configs
// 内联配置直接逐项用 schema 校验。
      for (const [serverName, config] of Object.entries(decl)) {
        const result = LspServerConfigSchema().safeParse(config)
        if (result.success) {
          servers[serverName] = result.data
        } else {
          const errorMsg = `LSP config validation failed for inline server "${serverName}" in plugin ${pluginName}: ${result.error.message}`
          logError(new Error(errorMsg))
          errors.push({
            type: 'lsp-config-invalid',
            plugin: pluginName,
            serverName,
            validationError: result.error.message,
            source: 'plugin',
          })
        }
      }
    }
  }

  return Object.keys(servers).length > 0 ? servers : undefined
// 返回聚合后的服务器表或 undefined。
}

/**
 * Resolve environment variables for plugin LSP servers.
 * Handles ${CLAUDE_PLUGIN_ROOT}, ${user_config.X}, and general ${VAR}
 * substitution. Tracks missing environment variables for error reporting.
 */
export function resolvePluginLspEnvironment(
// `resolvePluginLspEnvironment` 解析插件 LSP 的环境变量。
  config: LspServerConfig,
  plugin: { path: string; source: string },
  userConfig?: PluginOptionValues,
  _errors?: PluginError[],
): LspServerConfig {
  const allMissingVars: string[] = []

  const resolveValue = (value: string): string => {
    // First substitute plugin-specific variables
    let resolved = substitutePluginVariables(value, plugin)
// 先替换插件专属变量。

    // Then substitute user config variables if provided
    if (userConfig) {
      resolved = substituteUserConfigVariables(resolved, userConfig)
    }

    // Finally expand general environment variables
    const { expanded, missingVars } = expandEnvVarsInString(resolved)
// 最后展开通用环境变量并记录缺失项。
    allMissingVars.push(...missingVars)

    return expanded
  }

  const resolved = { ...config }

  // Resolve command path
  if (resolved.command) {
// 解析命令路径。
    resolved.command = resolveValue(resolved.command)
  }

  // Resolve args
  if (resolved.args) {
// 解析参数数组。
    resolved.args = resolved.args.map(arg => resolveValue(arg))
  }

  // Resolve environment variables and add CLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATA
  const resolvedEnv: Record<string, string> = {
    CLAUDE_PLUGIN_ROOT: plugin.path,
    CLAUDE_PLUGIN_DATA: getPluginDataDir(plugin.source),
    ...(resolved.env || {}),
// 注入 `CLAUDE_PLUGIN_ROOT` 与 `CLAUDE_PLUGIN_DATA` 到环境变量。
  }
  for (const [key, value] of Object.entries(resolvedEnv)) {
    if (key !== 'CLAUDE_PLUGIN_ROOT' && key !== 'CLAUDE_PLUGIN_DATA') {
      resolvedEnv[key] = resolveValue(value)
    }
  }
  resolved.env = resolvedEnv

  // Resolve workspaceFolder if present
  if (resolved.workspaceFolder) {
    resolved.workspaceFolder = resolveValue(resolved.workspaceFolder)
  }

  // Log missing variables if any were found
  if (allMissingVars.length > 0) {
// 发现缺失环境变量时记录警告。
    const uniqueMissingVars = [...new Set(allMissingVars)]
    const warnMsg = `Missing environment variables in plugin LSP config: ${uniqueMissingVars.join(', ')}`
    logError(new Error(warnMsg))
    logForDebugging(warnMsg, { level: 'warn' })
  }

  return resolved
// 返回完整解析后的配置。
}

/**
 * Add plugin scope to LSP server configs
 * This adds a prefix to server names to avoid conflicts between plugins
 */
export function addPluginScopeToLspServers(
// `addPluginScopeToLspServers` 给服务器名加插件前缀避免冲突。
  servers: Record<string, LspServerConfig>,
  pluginName: string,
): Record<string, ScopedLspServerConfig> {
  const scopedServers: Record<string, ScopedLspServerConfig> = {}

  for (const [name, config] of Object.entries(servers)) {
    // Add plugin prefix to server name to avoid conflicts
    const scopedName = `plugin:${pluginName}:${name}`
    scopedServers[scopedName] = {
      ...config,
      scope: 'dynamic', // Use dynamic scope for plugin servers
      source: pluginName,
    }
  }

  return scopedServers
}
// 返回带作用域的服务器映射。

/**
 * Get LSP servers from a specific plugin with environment variable resolution and scoping
 * This function is called when the LSP servers need to be activated and ensures they have
 * the proper environment variables and scope applied
 */
export async function getPluginLspServers(
// `getPluginLspServers` 在激活时解析并加作用域。
  plugin: LoadedPlugin,
  errors: PluginError[] = [],
): Promise<Record<string, ScopedLspServerConfig> | undefined> {
  if (!plugin.enabled) {
// 跳过被禁用的插件。
    return undefined
  }

  // Use cached servers if available
  const servers =
    plugin.lspServers || (await loadPluginLspServers(plugin, errors))
// 优先使用已缓存的服务器，否则现加载。
  if (!servers) {
    return undefined
  }

  // Resolve environment variables. Top-level manifest.userConfig values
  // become available as ${user_config.KEY} in LSP command/args/env.
  // Gate on manifest.userConfig — same rationale as buildMcpUserConfig:
  // loadPluginOptions always returns {} so without this guard userConfig is
  // truthy for every plugin and substituteUserConfigVariables throws on any
  // unresolved ${user_config.X}. Also skips unneeded keychain reads.
  const userConfig = plugin.manifest.userConfig
    ? loadPluginOptions(getPluginStorageId(plugin))
    : undefined
// 仅在清单声明 `userConfig` 时才加载用户配置，避免无谓的钥匙串读取与异常。
  const resolvedServers: Record<string, LspServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    resolvedServers[name] = resolvePluginLspEnvironment(
      config,
      plugin,
      userConfig,
      errors,
    )
  }
// 逐个解析服务器环境。

  // Add plugin scope
  return addPluginScopeToLspServers(resolvedServers, plugin.name)
// 加作用域后返回。
}

/**
 * Extract all LSP servers from loaded plugins
 */
export async function extractLspServersFromPlugins(
// `extractLspServersFromPlugins` 跨插件聚合所有 LSP 服务器。
  plugins: LoadedPlugin[],
  errors: PluginError[] = [],
): Promise<Record<string, ScopedLspServerConfig>> {
  const allServers: Record<string, ScopedLspServerConfig> = {}

  for (const plugin of plugins) {
    if (!plugin.enabled) continue
// 跳过被禁用的插件。

    const servers = await loadPluginLspServers(plugin, errors)
    if (servers) {
      const scopedServers = addPluginScopeToLspServers(servers, plugin.name)
      Object.assign(allServers, scopedServers)

      // Store the servers on the plugin for caching
      plugin.lspServers = servers
// 把服务器缓存回插件对象并记录加载数量。

      logForDebugging(
        `Loaded ${Object.keys(servers).length} LSP servers from plugin ${plugin.name}`,
      )
    }
  }

  return allServers
}
// 返回聚合后的全部服务器。
